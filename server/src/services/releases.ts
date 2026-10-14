import type { GrabRequest, MediaType, Release, ReleaseSearch, ReleasesResponse } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { has } from '../config';
import { radarr, sonarr, type ArrFile, type ArrRelease } from '../clients/arr';
import { settle } from '../lib/async';
import { MINUTE, TTLCache } from '../lib/cache';
import { GB, getSettings } from '../settings';
import { HttpError } from '../lib/upstream';
import { LANGUAGES, findLanguage, releaseTokens, titleHasLanguage, titleIsMulti } from '../lib/languages';
import { radarrMovie, sonarrSeries } from './arrLookup';
import { catalog } from './catalog';
import { findInLibrary, libraryIndex } from './library';

/**
 * "Versions": the same results Radarr/Sonarr's Interactive Search shows (every
 * indexer, via Prowlarr), annotated so the app can filter by language and
 * warn when a release probably won't replace the current file. Picking one
 * hands it straight to Radarr/Sonarr, which download and import it as usual.
 */

export function canChooseVersion(user: SessionUser): boolean {
  return (has.radarr() || has.sonarr()) && (getSettings().manualGrabs === 'all' || user.isAdmin);
}

/** The admin's size limit for this kind of title: whole release for movies, per episode for TV. */
function sizeLimit(mediaType: MediaType): ReleasesResponse['limit'] {
  const s = getSettings();
  const gb = mediaType === 'movie' ? s.maxMovieSizeGb : s.maxEpisodeSizeGb;
  return gb ? { bytes: gb * GB, perEpisode: mediaType === 'tv' } : undefined;
}

/**
 * The sizes we last showed for each title (guid → measured bytes), so a grab can
 * be checked against the limit. Radarr/Sonarr keep their own release cache for
 * about as long, and need a fresh search after that anyway.
 */
const shown = new TTLCache<Map<string, number>>(500);

function assertAllowed(user: SessionUser) {
  if (!canChooseVersion(user)) throw new HttpError(403, 'On this server only admins can pick specific versions');
}

/** Rough cross-profile quality ordering: resolution first, then source. */
function qualityRank(name?: string): number {
  if (!name) return 0;
  const n = name.toLowerCase();
  const res = Number(n.match(/(\d{3,4})p/)?.[1] ?? (/dvd|sdtv/.test(n) ? 480 : 0));
  const source = n.includes('remux') ? 5 : n.includes('bluray') ? 4 : /web/.test(n) ? 3 : n.includes('hdtv') ? 2 : n.includes('dvd') ? 1 : 0;
  return res * 10 + source;
}

type Current = NonNullable<ReleasesResponse['current']>;

function describeFiles(files: ArrFile[]): Current | undefined {
  if (!files.length) return undefined;
  const worst = [...files].sort((a, b) => qualityRank(a.quality?.quality?.name) - qualityRank(b.quality?.quality?.name))[0];
  return {
    quality: worst.quality?.quality?.name,
    languages: [...new Set(files.flatMap((f) => (f.languages ?? []).map((l) => l.name)))],
    customFormatScore: Math.min(...files.map((f) => f.customFormatScore ?? 0)),
  };
}

function toRelease(r: ArrRelease, current?: Current): Release {
  const tokens = releaseTokens(r.title);
  const known = (r.languages ?? []).map((l) => l.name).filter((n) => n && n !== 'Unknown');
  const codes = new Set<string>();
  for (const name of known) {
    const lang = LANGUAGES.find((l) => l.arrNames.includes(name)) ?? findLanguage(name);
    if (lang) codes.add(lang.code);
  }
  for (const lang of LANGUAGES) if (titleHasLanguage(tokens, lang)) codes.add(lang.code);

  return {
    guid: r.guid,
    indexerId: r.indexerId,
    indexer: r.indexer ?? '',
    title: r.title,
    size: r.size,
    seeders: r.seeders ?? undefined,
    leechers: r.leechers ?? undefined,
    quality: r.quality?.quality?.name ?? 'Unknown',
    resolution: r.quality?.quality?.resolution || undefined,
    languages: known,
    languageCodes: [...codes],
    // A MULTi release that Radarr/Sonarr already resolved to specific languages isn't a mystery box.
    multi: titleIsMulti(tokens) && known.length < 2,
    ageHours: r.ageHours ?? 0,
    protocol: r.protocol ?? 'unknown',
    rejected: Boolean(r.rejected),
    rejections: r.rejections ?? [],
    customFormatScore: r.customFormatScore ?? 0,
    likelyImports:
      !current ||
      (qualityRank(r.quality?.quality?.name) >= qualityRank(current.quality) &&
        (r.customFormatScore ?? 0) >= (current.customFormatScore ?? 0)),
    fullSeason: r.fullSeason,
    episodes: r.episodeNumbers?.length ? r.episodeNumbers : undefined,
  };
}

/** Same spirit as Radarr's own ordering: acceptable first, then best quality, then healthiest. */
function compare(a: Release, b: Release): number {
  return (
    Number(a.rejected) - Number(b.rejected) ||
    qualityRank(b.quality) - qualityRank(a.quality) ||
    b.customFormatScore - a.customFormatScore ||
    (b.seeders ?? 0) - (a.seeders ?? 0)
  );
}

async function tvdbFor(user: SessionUser, tmdbId: number): Promise<number | undefined> {
  if (has.seerr()) {
    const tv = await settle(catalog.tv(tmdbId), undefined);
    if (tv?.externalIds?.tvdbId) return tv.externalIds.tvdbId;
  }
  return findInLibrary(await libraryIndex(user), 'tv', tmdbId)?.tvdbId;
}

export async function seriesFor(user: SessionUser, tmdbId: number) {
  const series = await sonarrSeries(await tvdbFor(user, tmdbId));
  if (!series) throw new HttpError(404, "Sonarr doesn't manage this show yet — request it first");
  return series;
}

export async function searchReleases(
  user: SessionUser,
  mediaType: MediaType,
  tmdbId: number,
  body: ReleaseSearch,
): Promise<ReleasesResponse> {
  assertAllowed(user);
  const basics = has.seerr() ? await settle(catalog.basics(mediaType, tmdbId), undefined) : undefined;

  let raw: ArrRelease[];
  let current: Current | undefined;
  let seasonEpisodes: number | undefined;
  if (mediaType === 'movie') {
    const movie = await radarrMovie(tmdbId);
    if (!movie) throw new HttpError(404, "Radarr doesn't manage this movie yet — request it first");
    current = movie.movieFile ? describeFiles([movie.movieFile]) : undefined;
    raw = await radarr.releases(movie.id);
  } else {
    const season = body.seasonNumber;
    if (!Number.isInteger(season)) throw new HttpError(400, 'Pick a season');
    const series = await seriesFor(user, tmdbId);
    const files = (await settle(sonarr.episodeFiles(series.id), [])).filter((f) => f.seasonNumber === season);
    current = describeFiles(files);
    const episodes = await settle(sonarr.episodes(series.id, season!), []);
    seasonEpisodes = episodes.length || undefined;
    if (Number.isInteger(body.episodeNumber)) {
      const episode = episodes.find((e) => e.episodeNumber === body.episodeNumber);
      if (!episode) throw new HttpError(404, "Sonarr doesn't know that episode");
      raw = await sonarr.episodeReleases(episode.id);
    } else {
      raw = await sonarr.releases(series.id, season!);
    }
  }

  // Size limit: movies by total size; TV per episode, so season packs aren't unfairly blocked.
  const limit = sizeLimit(mediaType);
  const showOversized = Boolean(body.includeOversized && user.isAdmin);
  const all = raw.map((r) => {
    const release = toRelease(r, current);
    if (mediaType === 'tv') {
      const count = release.episodes?.length || (release.fullSeason ? (seasonEpisodes ?? 1) : 1);
      release.sizePerEpisode = Math.round(release.size / count);
    }
    release.oversized = limit ? (release.sizePerEpisode ?? release.size) > limit.bytes : false;
    return release;
  });
  shown.set(`${mediaType}-${tmdbId}`, new Map(all.map((r) => [r.guid, r.sizePerEpisode ?? r.size])), 30 * MINUTE);
  const visible = all.filter((r) => showOversized || !r.oversized);

  return {
    current,
    originalLanguage: findLanguage(basics?.originalLanguage)?.code ?? basics?.originalLanguage,
    releases: visible.sort(compare).slice(0, 300),
    limit,
    hiddenOversized: all.length - visible.length,
  };
}

/** Titles each user grabbed by hand recently, so Activity can list them under "Requested by you". */
const grabs = new Map<string, Map<string, number>>();
const GRAB_MEMORY = 3 * 24 * 60 * 60 * 1000;

export function grabbedKeys(user: SessionUser): Set<string> {
  const mine = grabs.get(user.id);
  if (!mine) return new Set();
  for (const [key, at] of mine) if (Date.now() - at > GRAB_MEMORY) mine.delete(key);
  return new Set(mine.keys());
}

export async function grabRelease(user: SessionUser, mediaType: MediaType, tmdbId: number, body: GrabRequest) {
  assertAllowed(user);
  if (typeof body?.guid !== 'string' || !Number.isInteger(body.indexerId)) throw new HttpError(400, 'guid and indexerId are required');
  // Enforce the size limit here too, not just by hiding releases. Admins may override it.
  const limit = sizeLimit(mediaType);
  if (limit && !user.isAdmin) {
    const measured = shown.get(`${mediaType}-${tmdbId}`)?.get(body.guid);
    if (measured === undefined) throw new HttpError(409, 'That search has expired. Search again and pick the release.');
    if (measured > limit.bytes) throw new HttpError(403, `That release is over the ${limit.bytes / GB} GB${limit.perEpisode ? ' per episode' : ''} limit set by your admin`);
  }
  await (mediaType === 'movie' ? radarr : sonarr).grab(body.guid, body.indexerId);
  const mine = grabs.get(user.id) ?? new Map<string, number>();
  mine.set(`${mediaType}-${tmdbId}`, Date.now());
  grabs.set(user.id, mine);
  return { ok: true };
}
