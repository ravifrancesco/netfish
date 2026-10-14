import { randomUUID } from 'node:crypto';
import type { Job, MediaType, SubtitleRequest } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config } from '../config';
import { bazarr } from '../clients/bazarr';
import { jellyfin } from '../clients/jellyfin';
import { settle } from '../lib/async';
import { findLanguage, type LangDef } from '../lib/languages';
import { HttpError } from '../lib/upstream';
import { radarrMovie } from './arrLookup';
import { findInLibrary, libraryIndex } from './library';
import { seriesFor } from './releases';

/**
 * Subtitles in any language, fetched by Bazarr. Its download endpoint searches
 * providers synchronously (slow), so each request runs as a background job the
 * app can poll.
 */

const jobs = new Map<string, Job>();

function prune() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.state !== 'running' && Date.parse(job.startedAt) < cutoff) jobs.delete(id);
}

export function jobsFor(key: string): Job[] {
  prune();
  return [...jobs.values()].filter((j) => j.key === key).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function startJob(key: string, label: string, total: number, work: (job: Job) => Promise<string>): Job {
  const job: Job = { id: randomUUID(), kind: 'subtitles', key, label, state: 'running', done: 0, total, startedAt: new Date().toISOString() };
  jobs.set(job.id, job);
  work(job)
    .then((message) => Object.assign(job, { state: 'done', message }))
    .catch((err: Error) => Object.assign(job, { state: 'failed', message: err.message }));
  return job;
}

/** New subtitle files only show up in Jellyfin after the item is refreshed. */
async function refreshInJellyfin(user: SessionUser, mediaType: MediaType, tmdbId: number) {
  const token = config.jellyfin.apiKey ?? (user.isAdmin ? user.token : undefined);
  if (!token) return; // Jellyfin's own library monitor will pick the files up eventually.
  const entry = findInLibrary(await libraryIndex(user), mediaType, tmdbId);
  if (entry) await settle(jellyfin.refreshItem(token, entry.id), undefined);
}

const hasLang = (subs: Array<{ code2?: string }> | undefined, lang: LangDef) => (subs ?? []).some((s) => s.code2 === lang.bazarr);

export async function requestSubtitles(user: SessionUser, mediaType: MediaType, tmdbId: number, body: SubtitleRequest): Promise<Job> {
  const lang = findLanguage(body?.language);
  if (!lang) throw new HttpError(400, `Unknown language "${body?.language}"`);
  const key = `${mediaType}-${tmdbId}`;
  const hi = Boolean(body.hearingImpaired);

  if (mediaType === 'movie') {
    const movie = await radarrMovie(tmdbId);
    if (!movie) throw new HttpError(404, "Radarr doesn't manage this movie, so Bazarr can't fetch subtitles for it");
    return startJob(key, `${lang.name} subtitles`, 1, async (job) => {
      await bazarr.downloadMovie(movie.id, lang.bazarr, hi);
      job.done = 1;
      const found = hasLang((await settle(bazarr.movie(movie.id), undefined))?.subtitles, lang);
      if (found) await refreshInJellyfin(user, mediaType, tmdbId);
      return found ? `${lang.name} subtitles added` : `No ${lang.name} subtitles found right now`;
    });
  }

  const series = await seriesFor(user, tmdbId);
  let target: { season: number; episode?: number };
  if (body.episodeId) {
    const ep = await jellyfin.item(user.token, user.id, body.episodeId);
    target = { season: ep.ParentIndexNumber ?? 0, episode: ep.IndexNumber };
  } else if (Number.isInteger(body.seasonNumber)) {
    target = { season: body.seasonNumber! };
  } else {
    throw new HttpError(400, 'Pick a season or an episode');
  }
  const episodes = (await bazarr.episodes(series.id)).filter(
    (e) => e.season === target.season && (target.episode === undefined || e.episode === target.episode),
  );
  if (!episodes.length) throw new HttpError(404, 'Bazarr has no episode files for that yet');

  const label =
    target.episode !== undefined
      ? `${lang.name} subtitles · S${target.season}E${target.episode}`
      : `${lang.name} subtitles · Season ${target.season}`;
  return startJob(key, label, episodes.length, async (job) => {
    for (const ep of episodes) {
      if (!hasLang(ep.subtitles, lang)) await settle(bazarr.downloadEpisode(series.id, ep.sonarrEpisodeId, lang.bazarr, hi), undefined);
      job.done++;
    }
    const after = (await settle(bazarr.episodes(series.id), [])).filter((e) => episodes.some((x) => x.sonarrEpisodeId === e.sonarrEpisodeId));
    const found = after.filter((e) => hasLang(e.subtitles, lang)).length;
    if (found) await refreshInJellyfin(user, mediaType, tmdbId);
    if (episodes.length === 1) return found ? `${lang.name} subtitles added` : `No ${lang.name} subtitles found right now`;
    return `${lang.name} subtitles for ${found} of ${episodes.length} episodes`;
  });
}
