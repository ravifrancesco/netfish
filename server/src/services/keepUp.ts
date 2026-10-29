import fs from 'node:fs';
import path from 'node:path';
import type { KeepUpState } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config, has } from '../config';
import { sonarr, type SonarrEpisode, type SonarrSeries } from '../clients/arr';
import { jellyfin, type JfItem } from '../clients/jellyfin';
import { mapLimit, settle } from '../lib/async';
import { MINUTE } from '../lib/cache';
import { gb, log } from '../lib/log';
import { writeJson } from '../lib/storage';
import { getSettings } from '../settings';
import { forgetSonarrSeries, sonarrSeries } from './arrLookup';
import { freshHidden } from './fresh';
import { createRequest } from './requests';

/**
 * Shows look after themselves (Settings → Downloads, for everyone; Settings → Playback, for
 * each person):
 *
 * - the next season, when someone is 2 episodes from the end of one they're really watching
 *   (asked of Seerr as them, so its approvals apply; without Seerr, Sonarr looks for it);
 * - new episodes of a show someone is up to date with, as they air (Sonarr watches the show
 *   and the seasons announced later);
 * - an aired episode missing ahead of where someone is, looked for again.
 *
 * Each person is asked once, the first time it would get something for them; the answer holds
 * until they change it. Checked when someone starts an episode in Netfish, and every half
 * hour for everyone (with Jellyfin's API key, so people watching in other apps count too).
 */

const DAY = 24 * 60 * MINUTE;
/** Watched within this long: a show someone is really watching. */
const RECENT = 30 * DAY;
/** The next season comes when this many episodes (or fewer) are left after the one they're on. */
const LEFT = 2;
/** Nothing new is asked for while the shows' disk has less than this free. */
const MIN_FREE = 20 * 1024 ** 3;
/** A missing episode is looked for again at most this often. */
const SEARCH_AGAIN = 12 * 60 * MINUTE;
/** A season Seerr or Sonarr wouldn't take is tried again after this long. */
const RETRY = DAY;

/** The question, and the episode it came from (so a yes picks up from there). */
type Question = NonNullable<KeepUpState['question']> & { seriesId: string; episodeId: string };

interface Stored {
  /** Each person's answer, by Jellyfin user id. */
  answers: Record<string, { answer: 'yes' | 'no'; at: string }>;
  /** The question waiting for each person who hasn't answered yet. */
  questions: Record<string, Question>;
  /** Seasons asked for (`tv-<tmdbId>-<season>`): when, and for whom. */
  fetched: Record<string, { at: string; userId: string; name: string }>;
  /** Shows followed (`tv-<tmdbId>`): when, and for whom. */
  followed: Record<string, { at: string; name: string }>;
  /** Missing episodes looked for again (Sonarr episode id): when. */
  searched: Record<string, string>;
}

const FILE = path.join(config.dataDir, 'keep-up.json');
const EMPTY: Stored = { answers: {}, questions: {}, fetched: {}, followed: {}, searched: {} };
let stored: Stored = (() => {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...EMPTY };
  }
})();

function save() {
  try {
    writeJson(FILE, stored, 0o600);
  } catch {
    /* the storage warning in Settings already explains this */
  }
}

// ---------- Each person's answer ----------

export function keepUpState(user: SessionUser): KeepUpState {
  if (!getSettings().keepUp || !has.sonarr()) return { off: true };
  const answer = stored.answers[user.id]?.answer;
  const waiting = answer ? undefined : stored.questions[user.id];
  return { answer, question: waiting && { seriesTitle: waiting.seriesTitle, tmdbId: waiting.tmdbId, season: waiting.season, kind: waiting.kind } };
}

export function answerKeepUp(user: SessionUser, answer: 'yes' | 'no'): KeepUpState {
  const waiting = stored.questions[user.id];
  stored = { ...stored, answers: { ...stored.answers, [user.id]: { answer, at: new Date().toISOString() } } };
  delete stored.questions[user.id];
  save();
  log.info('keep up', `${user.name} ${answer === 'yes' ? 'wants' : "doesn't want"} the next seasons and new episodes by themselves`);
  // Yes to the question: what it was about comes now (from the episode it came from).
  if (answer === 'yes' && waiting) {
    void (async () => {
      const episode = await settle(jellyfin.item(user.token, user.id, waiting.episodeId), undefined);
      await settle(check(user, user.token, waiting.seriesId, episode), undefined, (err) => log.warn('keep up', `couldn't check ${waiting.seriesTitle} for ${user.name}`, err));
    })();
  }
  return keepUpState(user);
}

/** Started an episode in Netfish: that show is checked straight away. */
export async function afterEpisodeStart(user: SessionUser, itemId: string) {
  if (!getSettings().keepUp || !has.sonarr() || stored.answers[user.id]?.answer === 'no') return;
  const item = await settle(jellyfin.item(user.token, user.id, itemId), undefined);
  if (item?.Type !== 'Episode' || !item.SeriesId) return;
  await settle(check(user, user.token, item.SeriesId, item), undefined, (err) => log.warn('keep up', `couldn't check ${item.SeriesName ?? 'a show'} for ${user.name}`, err));
}

/** Whether a request was Netfish's own (the next season, for that person, about when it was made). */
export function wasAutomatic(tmdbId: number, seasons: number[] | undefined, createdAt: string): boolean {
  if (!seasons?.length) return false;
  const made = Date.parse(createdAt);
  return seasons.every((n) => {
    const at = Date.parse(stored.fetched[`tv-${tmdbId}-${n}`]?.at ?? '');
    return Boolean(at) && Math.abs(at - made) < 10 * MINUTE;
  });
}

// ---------- Checking one person's shows ----------

interface Person {
  id: string;
  name: string;
  isAdmin?: boolean;
}

const running = new Set<string>();
const failed = new Map<string, number>();
const diskWarned = new Map<string, number>();

const airedBy = (e: SonarrEpisode, now: number) => Boolean(e.airDateUtc) && Date.parse(e.airDateUtc!) <= now;
const order = (season: number, episode: number) => season * 10_000 + episode;

/**
 * One person's shows (or just one of them): what they're on, and what that calls for. `started`
 * is the episode they've just started, which Jellyfin doesn't list as watched yet.
 */
async function check(person: Person, token: string, onlySeries?: string, started?: JfItem) {
  if (!getSettings().keepUp || !has.sonarr() || running.has(person.id)) return;
  const answer = stored.answers[person.id]?.answer;
  if (answer === 'no') return;
  running.add(person.id);
  try {
    const query = { userId: person.id, recursive: true, includeItemTypes: 'Episode', enableImages: false, sortBy: 'DatePlayed', sortOrder: 'Descending' };
    const [played, resuming] = await Promise.all([
      jellyfin.items(token, { ...query, filters: 'IsPlayed', limit: 300 }),
      jellyfin.items(token, { ...query, filters: 'IsResumable', limit: 50 }),
    ]);
    const since = Date.now() - RECENT;
    const recent = [...played.Items, ...resuming.Items].filter(
      (e) => e.SeriesId && (Date.parse(e.UserData?.LastPlayedDate ?? '') || 0) >= since && (!onlySeries || e.SeriesId === onlySeries),
    );
    if (started) recent.push(started);

    // Per show: the furthest episode reached lately, and which of that season they watched.
    const shows = new Map<string, JfItem[]>();
    for (const e of recent) {
      if (!e.ParentIndexNumber || !e.IndexNumber) continue; // specials and unnumbered episodes say nothing
      shows.set(e.SeriesId!, [...(shows.get(e.SeriesId!) ?? []), e]);
    }
    for (const [seriesId, episodes] of shows) {
      await settle(checkShow(person, token, seriesId, episodes), undefined, (err) => log.warn('keep up', `couldn't check ${episodes[0].SeriesName ?? 'a show'} for ${person.name}`, err));
    }
  } finally {
    running.delete(person.id);
  }
}

async function checkShow(person: Person, token: string, seriesId: string, watched: JfItem[]) {
  const at = watched.reduce((a, b) => (order(b.ParentIndexNumber!, b.IndexNumber!) > order(a.ParentIndexNumber!, a.IndexNumber!) ? b : a));
  const season = at.ParentIndexNumber!;
  const seenThisSeason = new Set(watched.filter((e) => e.ParentIndexNumber === season).map((e) => e.Id)).size;

  const show = await jellyfin.item(token, person.id, seriesId);
  const tvdbId = Number(show.ProviderIds?.Tvdb) || undefined;
  const series = await sonarrSeries(tvdbId);
  if (!series) return; // Sonarr doesn't have it: nothing it can get
  const tmdbId = series.tmdbId ?? (Number(show.ProviderIds?.Tmdb) || undefined);
  if (!tmdbId || freshHidden().has(`tv-${tmdbId}`)) return; // New titles look after themselves
  const now = Date.now();
  const episodes = (await sonarr.episodes(series.id)).filter((e) => e.seasonNumber > 0);
  const here = order(season, at.IndexNumber!);
  const thisSeason = episodes.filter((e) => e.seasonNumber === season);
  const left = Math.max(0, ...thisSeason.map((e) => e.episodeNumber)) - at.IndexNumber!;

  // Missing ahead of them in this season: the next episode, and any gap before the furthest one
  // on disk. (A whole later season missing comes as a season, below, when they near its start.)
  const furthest = Math.max(0, ...thisSeason.filter((e) => e.hasFile).map((e) => e.episodeNumber));
  const holes = thisSeason.filter(
    (e) => e.episodeNumber > at.IndexNumber! && (e.episodeNumber < furthest || e.episodeNumber === at.IndexNumber! + 1) && airedBy(e, now) && !e.hasFile,
  );
  await fillHoles(person, series, holes);

  // Near the end of a season they're really watching: the next one, if it's out and not here.
  const next = episodes.filter((e) => e.seasonNumber === season + 1);
  const wantsNext =
    thisSeason.length > 0 &&
    left <= LEFT &&
    (seenThisSeason >= 2 || thisSeason.length <= 3) &&
    next.some((e) => airedBy(e, now)) &&
    !next.some((e) => e.hasFile || e.monitored) &&
    !stored.fetched[`tv-${tmdbId}-${season + 1}`] &&
    (failed.get(`tv-${tmdbId}-${season + 1}`) ?? 0) < now - RETRY;

  // Up to date with a show still running: its new episodes from now on.
  const ahead = episodes.filter((e) => order(e.seasonNumber, e.episodeNumber) > here);
  const upToDate = series.status === 'continuing' && !ahead.some((e) => airedBy(e, now));
  const unwatchedLater = ahead.filter((e) => !airedBy(e, now) && !e.monitored);
  const wantsFollow = upToDate && !stored.followed[`tv-${tmdbId}`] && (series.monitorNewItems !== 'all' || unwatchedLater.length > 0 || !series.monitored);

  if (!wantsNext && !wantsFollow) return;
  if (!stored.answers[person.id]) {
    // The first time: ask them, and wait for the answer.
    if (!stored.questions[person.id]) {
      stored.questions[person.id] = wantsNext
        ? { seriesId, episodeId: at.Id, seriesTitle: series.title, tmdbId, season: season + 1, kind: 'season' }
        : { seriesId, episodeId: at.Id, seriesTitle: series.title, tmdbId, kind: 'follow' };
      save();
    }
    return;
  }
  if (wantsNext) await fetchSeason(person, token, series, tmdbId, season, next);
  if (wantsFollow) await follow(person, series, tmdbId, unwatchedLater);
}

async function fetchSeason(person: Person, token: string, series: SonarrSeries, tmdbId: number, season: number, episodes: SonarrEpisode[]) {
  const key = `tv-${tmdbId}-${season + 1}`;
  const free = Math.min(...(await settle(sonarr.rootFolders(), [])).map((f) => f.freeSpace ?? Infinity));
  if (free < MIN_FREE) {
    if ((diskWarned.get(key) ?? 0) < Date.now() - DAY) {
      diskWarned.set(key, Date.now());
      log.warn('keep up', `not getting ${series.title} season ${season + 1} for ${person.name}: the disk is nearly full (${gb(free)} free)`);
    }
    return;
  }
  const user: SessionUser = { id: person.id, name: person.name, isAdmin: Boolean(person.isAdmin), token, canDownload: false };
  try {
    if (has.seerr()) {
      await createRequest(user, { mediaType: 'tv', tmdbId, seasons: [season + 1] });
    } else {
      await sonarr.setEpisodesMonitored(episodes.map((e) => e.id), true);
      if (!series.monitored) await sonarr.setSeriesMonitored([series.id], true);
      await sonarr.searchSeason(series.id, season + 1);
    }
  } catch (err) {
    failed.set(key, Date.now());
    log.warn('keep up', `couldn't get ${series.title} season ${season + 1} for ${person.name}`, err);
    return;
  }
  stored.fetched[key] = { at: new Date().toISOString(), userId: person.id, name: person.name };
  save();
  forgetSonarrSeries(series.tvdbId);
  log.info('keep up', `${person.name} is near the end of ${series.title} season ${season}: asked ${has.seerr() ? 'Seerr' : 'Sonarr'} for season ${season + 1}`);
}

async function follow(person: Person, series: SonarrSeries, tmdbId: number, unwatchedLater: SonarrEpisode[]) {
  await sonarr.followSeries([series.id]);
  if (unwatchedLater.length) await sonarr.setEpisodesMonitored(unwatchedLater.map((e) => e.id), true);
  stored.followed[`tv-${tmdbId}`] = { at: new Date().toISOString(), name: person.name };
  save();
  forgetSonarrSeries(series.tvdbId);
  log.info('keep up', `${person.name} is up to date with ${series.title}: new episodes will come as they air`);
}

async function fillHoles(person: Person, series: SonarrSeries, holes: SonarrEpisode[]) {
  const due = holes.filter((e) => (Date.parse(stored.searched[e.id] ?? '') || 0) < Date.now() - SEARCH_AGAIN).slice(0, 5);
  if (!due.length) return;
  const unmonitored = due.filter((e) => !e.monitored).map((e) => e.id);
  if (unmonitored.length) await sonarr.setEpisodesMonitored(unmonitored, true);
  await sonarr.searchEpisodes(due.map((e) => e.id));
  const now = new Date().toISOString();
  for (const e of due) stored.searched[e.id] = now;
  save();
  const which = due.map((e) => `S${e.seasonNumber}:E${e.episodeNumber}`).join(', ');
  log.info('keep up', `looking again for ${series.title} ${which}: missing ahead of where ${person.name} is`);
}

// ---------- Everyone, every half hour (needs Jellyfin's API key) ----------

async function everyone() {
  const key = config.jellyfin.apiKey;
  if (!key || !config.jellyfin.url || !getSettings().keepUp || !has.sonarr()) return;
  const users = await settle(jellyfin.users(key), []);
  await mapLimit(users, 2, (u) =>
    settle(check({ id: u.Id, name: u.Name, isAdmin: Boolean(u.Policy?.IsAdministrator) }, key), undefined, (err) =>
      log.warn('keep up', `couldn't check ${u.Name}'s shows`, err),
    ),
  );
}

const timers = [setTimeout(() => void everyone(), 2 * MINUTE), setInterval(() => void everyone(), 30 * MINUTE)];
for (const timer of timers) timer.unref?.();
