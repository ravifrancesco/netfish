import fs from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { MediaType, ProgressReport, TraktStatus } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config, has } from '../config';
import { onConnectionChange } from '../connections';
import { jellyfin, ticksToSeconds, type JfItem } from '../clients/jellyfin';
import type { SeerrResult } from '../clients/seerr';
import { REDIRECT_URI, traktRequest, type TraktDeviceCode, type TraktIds, type TraktTokens } from '../clients/trakt';
import { mapLimit, settle } from '../lib/async';
import { HOUR, MINUTE, TTLCache } from '../lib/cache';
import { lang, t } from '../lib/i18n';
import { writeJson } from '../lib/storage';
import { HttpError, UpstreamError, type RequestOptions } from '../lib/upstream';
import { episodeLabel } from './cards';
import { catalog } from './catalog';

/**
 * One Trakt account for the whole server. An admin links it once; from then on
 * whatever anyone watches is sent to it ("scrobbled"), and its recommendations,
 * which learn from that shared history, become rows on everyone's Home.
 * The tokens live in their own file, readable only by Netfish.
 */

interface Link {
  /** The Trakt app the tokens belong to: another Client ID can't use them. */
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username?: string;
  scrobble: boolean;
  lastScrobble?: TraktStatus['lastScrobble'];
  import?: TraktStatus['import'];
}

const FILE = path.join(config.dataDir, 'trakt.json');

function load(): Link | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Link;
    return data.accessToken && data.refreshToken ? data : undefined;
  } catch {
    return undefined;
  }
}

let link = load();
let linkError: string | undefined;

function save(next: Link | undefined) {
  if (next) writeJson(FILE, next, 0o600);
  else fs.rmSync(FILE, { force: true });
  link = next;
}

const secrets = () => ({ client_id: config.trakt.apiKey, client_secret: config.trakt.password });
const tokensToLink = (tokens: TraktTokens) => ({
  accessToken: tokens.access_token,
  refreshToken: tokens.refresh_token,
  expiresAt: ((tokens.created_at || Date.now() / 1000) + tokens.expires_in) * 1000,
});

// ---------- Linking (Trakt's device flow) ----------

interface Pending {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  interval: number;
  timer?: NodeJS.Timeout;
}
let pending: Pending | undefined;

function cancelPending() {
  if (pending?.timer) clearTimeout(pending.timer);
  pending = undefined;
}

/** Shows a code to type at trakt.tv/activate; Netfish waits for it in the background. */
export async function startLink(): Promise<TraktStatus> {
  if (!has.trakt()) throw new HttpError(400, t('Save the Trakt Client ID and secret first'));
  cancelPending();
  linkError = undefined;
  const code = await traktRequest<TraktDeviceCode>('/oauth/device/code', { body: { client_id: config.trakt.apiKey } });
  pending = {
    deviceCode: code.device_code,
    userCode: code.user_code,
    verificationUrl: code.verification_url,
    expiresAt: Date.now() + code.expires_in * 1000,
    interval: Math.max(1, code.interval) * 1000,
  };
  waitForCode(pending);
  return traktStatus();
}

function waitForCode(current: Pending) {
  current.timer = setTimeout(() => void checkCode(current), current.interval);
  current.timer.unref?.();
}

const LINK_ERRORS: Record<number, string> = {
  404: "Trakt didn't recognise the code. Start again.",
  409: 'That code was already used. Start again.',
  410: 'The code expired. Start again.',
  418: 'The link was declined on trakt.tv.',
};

async function checkCode(current: Pending) {
  if (pending !== current) return;
  if (Date.now() > current.expiresAt) {
    pending = undefined;
    linkError = LINK_ERRORS[410];
    return;
  }
  let tokens: TraktTokens;
  try {
    tokens = await traktRequest<TraktTokens>('/oauth/device/token', { body: { code: current.deviceCode, ...secrets() } });
  } catch (err) {
    if (pending !== current) return;
    const status = err instanceof UpstreamError ? err.status : 0;
    if (status === 429) current.interval += 1000; // "slow down"
    // 400 means not entered yet; a network blip or Trakt hiccup is worth another try too.
    if (status === 400 || status === 429 || status === 0 || status >= 500) return waitForCode(current);
    pending = undefined;
    linkError = LINK_ERRORS[status] ?? (err as Error).message;
    return;
  }
  if (pending !== current) return;
  pending = undefined;
  const settings = await settle(traktRequest<{ user?: { username?: string } }>('/users/settings', { token: tokens.access_token }), undefined);
  save({ clientId: config.trakt.apiKey ?? '', ...tokensToLink(tokens), username: settings?.user?.username, scrobble: true });
  recommendations.clear();
}

/** Signs Netfish out of Trakt (the account keeps its history). */
export async function unlink(): Promise<TraktStatus> {
  cancelPending();
  const current = link;
  save(undefined);
  linkError = undefined;
  recommendations.clear();
  sessions.clear();
  if (current) await settle(traktRequest('/oauth/revoke', { body: { token: current.accessToken, ...secrets() }, timeoutMs: 8000 }), undefined);
  return traktStatus();
}

onConnectionChange((id) => {
  if (id !== 'trakt') return;
  cancelPending();
  recommendations.clear();
  // Tokens belong to the Trakt app that made them: a different Client ID needs a new link.
  if (link && link.clientId !== config.trakt.apiKey) save(undefined);
});

export function traktStatus(): TraktStatus {
  return {
    configured: has.trakt(),
    linked: Boolean(link),
    username: link?.username,
    scrobble: link?.scrobble ?? true,
    pending: pending && { userCode: pending.userCode, verificationUrl: pending.verificationUrl, expiresAt: new Date(pending.expiresAt).toISOString() },
    linkError: linkError && t(linkError),
    lastScrobble: link?.lastScrobble,
    import: importState ?? link?.import,
  };
}

export function setScrobble(on: boolean): TraktStatus {
  if (!link) throw new HttpError(400, t('No Trakt account is linked'));
  save({ ...link, scrobble: on });
  if (!on) sessions.clear();
  return traktStatus();
}

// ---------- Calls as the linked account ----------

let refreshing: Promise<string> | undefined;

async function accessToken(): Promise<string> {
  if (!link) throw new HttpError(400, t('No Trakt account is linked'));
  if (link.expiresAt - HOUR > Date.now()) return link.accessToken;
  refreshing ??= refresh().finally(() => (refreshing = undefined));
  return refreshing;
}

async function refresh(): Promise<string> {
  const current = link!;
  try {
    const tokens = await traktRequest<TraktTokens>('/oauth/token', {
      body: { refresh_token: current.refreshToken, ...secrets(), redirect_uri: REDIRECT_URI, grant_type: 'refresh_token' },
    });
    if (link === current) save({ ...current, ...tokensToLink(tokens) });
    return tokens.access_token;
  } catch (err) {
    // The account revoked Netfish on trakt.tv (or the app was deleted): the link is over.
    if (err instanceof UpstreamError && (err.status === 400 || err.status === 401) && link === current) {
      save(undefined);
      linkError = 'Trakt ended the link. Link the account again.';
    }
    throw err;
  }
}

async function asAccount<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = await accessToken();
  try {
    return await traktRequest<T>(path, { ...opts, token });
  } catch (err) {
    if (!(err instanceof UpstreamError) || err.status !== 401 || !link) throw err;
    link.expiresAt = 0; // refused before its time: refresh and try once more
    return traktRequest<T>(path, { ...opts, token: await accessToken() });
  }
}

// Trakt allows one write a second per account; everyone's watches share this one.
let writes: Promise<unknown> = Promise.resolve();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function write<T>(path: string, body: unknown): Promise<T> {
  const run = writes.then(() => asAccount<T>(path, { body }));
  writes = run.then(
    () => pause(1100),
    () => pause(1100),
  );
  return run;
}

const idsOf = (p: Record<string, string> | undefined, kind: 'movie' | 'show'): TraktIds | undefined => {
  const ids: TraktIds = {
    tmdb: Number(p?.Tmdb) || undefined,
    imdb: p?.Imdb || undefined,
    tvdb: kind === 'show' ? Number(p?.Tvdb) || undefined : undefined,
  };
  return ids.tmdb || ids.imdb || ids.tvdb ? ids : undefined;
};

// ---------- Scrobbling: what anyone watches goes to the account ----------

interface Watch {
  body: Record<string, unknown>;
  title: string;
  duration: number;
  started: boolean;
  paused: boolean;
}
interface Session {
  watch?: Watch | null;
  queue: Promise<void>;
  touched: number;
}
const sessions = new Map<string, Session>();

async function describe(user: SessionUser, itemId: string): Promise<Watch | null> {
  const item = await jellyfin.item(user.token, user.id, itemId);
  const duration = ticksToSeconds(item.RunTimeTicks);
  const base = { duration, started: false, paused: false };
  if (item.Type === 'Movie') {
    const ids = idsOf(item.ProviderIds, 'movie');
    return ids ? { ...base, body: { movie: { ids } }, title: item.Name } : null;
  }
  if (item.Type === 'Episode' && item.SeriesId && item.ParentIndexNumber != null && item.IndexNumber != null) {
    const series: JfItem = await jellyfin.item(user.token, user.id, item.SeriesId);
    const ids = idsOf(series.ProviderIds, 'show');
    if (!ids) return null;
    return {
      ...base,
      body: { show: { ids }, episode: { season: item.ParentIndexNumber, number: item.IndexNumber } },
      title: `${series.Name} · ${episodeLabel(item)}`,
    };
  }
  return null; // home videos, trailers…: nothing Trakt knows
}

async function scrobbleOne(user: SessionUser, report: ProgressReport, session: Session) {
  if (session.watch === undefined) session.watch = await describe(user, report.itemId);
  const watch = session.watch;
  if (!watch || !link?.scrobble) return;
  const progress = watch.duration ? Math.min(100, Math.max(0, (report.positionSeconds / watch.duration) * 100)) : 0;
  let action: 'start' | 'pause' | 'stop' | undefined;
  if (report.event === 'stop') action = watch.started ? 'stop' : progress >= 80 ? 'stop' : undefined;
  else if (report.isPaused) action = watch.started && !watch.paused ? 'pause' : undefined;
  else action = !watch.started || watch.paused ? 'start' : undefined;
  watch.paused = Boolean(report.isPaused);
  if (!action) return;
  if (action === 'start') watch.started = true;
  await write(`/scrobble/${action}`, { ...watch.body, progress: Math.round(progress * 100) / 100 });
  if (link && (action === 'start' || progress >= 80)) save({ ...link, lastScrobble: { title: watch.title, at: new Date().toISOString() } });
}

/** Called on every playback report; never slows playback down or fails it. */
export function scrobble(user: SessionUser, report: ProgressReport, log: FastifyBaseLogger) {
  if (!link?.scrobble || !has.trakt()) return;
  const now = Date.now();
  for (const [key, s] of sessions) if (now - s.touched > 12 * HOUR) sessions.delete(key);
  const key = `${report.playSessionId}:${report.itemId}`;
  const session = sessions.get(key) ?? { queue: Promise.resolve(), touched: now };
  sessions.set(key, session);
  session.touched = now;
  // One report at a time per play session, so start/pause/stop arrive at Trakt in order.
  session.queue = session.queue
    .then(() => scrobbleOne(user, report, session))
    .catch((err: Error & { status?: number }) => {
      // 409: Trakt already has this watch from the last few minutes.
      if (err.status !== 409) log.warn({ service: 'Trakt', status: err.status }, `Couldn't send to Trakt: ${err.message}`);
    })
    .finally(() => {
      if (report.event === 'stop' && sessions.get(key) === session) sessions.delete(key);
    });
}

// ---------- Importing what was watched before Trakt was linked ----------

let importState: TraktStatus['import'];

type WatchedMovie = { movie: { ids: TraktIds } };
type WatchedShow = { show: { ids: TraktIds }; seasons?: Array<{ number: number; episodes: Array<{ number: number }> }> };
interface HistoryResult {
  added?: { movies?: number; episodes?: number };
  not_found?: { movies?: unknown[]; shows?: unknown[]; episodes?: unknown[] };
}

const later = (a: string | undefined, b: string | undefined) => (!a ? b : !b ? a : a > b ? a : b);
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/**
 * Adds everything people have already watched in Jellyfin to the account, once, so
 * recommendations start from the whole history. Titles already on Trakt are skipped;
 * a title watched by several people counts once, on the latest date.
 */
export function startImport(admin: SessionUser, log: FastifyBaseLogger): TraktStatus {
  if (!link) throw new HttpError(400, t('No Trakt account is linked'));
  if (importState?.running) return traktStatus();
  importState = { running: true };
  void runImport(admin)
    .then((result) => {
      importState = undefined;
      if (link) save({ ...link, import: { running: false, ...result, at: new Date().toISOString() } });
      recommendations.clear();
    })
    .catch((err: Error) => {
      log.warn({ service: 'Trakt' }, `Trakt import failed: ${err.message}`);
      importState = { running: false, error: err.message, at: new Date().toISOString() };
    });
  return traktStatus();
}

async function runImport(admin: SessionUser) {
  const [users, series, watchedMovies, watchedShows] = await Promise.all([
    jellyfin.users(admin.token),
    jellyfin.items(admin.token, { userId: admin.id, recursive: true, includeItemTypes: 'Series', fields: 'ProviderIds', enableImages: false }),
    asAccount<WatchedMovie[]>('/sync/watched/movies'),
    asAccount<WatchedShow[]>('/sync/watched/shows'),
  ]);

  const have = new Set<string>();
  for (const { movie } of watchedMovies) {
    if (movie.ids.tmdb) have.add(`m:tmdb:${movie.ids.tmdb}`);
    if (movie.ids.imdb) have.add(`m:imdb:${movie.ids.imdb}`);
  }
  for (const { show, seasons } of watchedShows) {
    for (const season of seasons ?? []) {
      for (const ep of season.episodes) {
        if (show.ids.tmdb) have.add(`e:tmdb:${show.ids.tmdb}:${season.number}:${ep.number}`);
        if (show.ids.tvdb) have.add(`e:tvdb:${show.ids.tvdb}:${season.number}:${ep.number}`);
      }
    }
  }
  const seriesIds = new Map(series.Items.map((s) => [s.Id, idsOf(s.ProviderIds, 'show')]));

  const movies = new Map<string, { ids: TraktIds; watched_at?: string }>();
  const episodes = new Map<string, { ids: TraktIds; season: number; number: number; watched_at?: string }>();
  let alreadyThere = 0;
  const query = { recursive: true, filters: 'IsPlayed', fields: 'ProviderIds', enableImages: false };
  await mapLimit(users, 2, async (user) => {
    const [playedMovies, playedEpisodes] = await Promise.all([
      jellyfin.items(admin.token, { ...query, userId: user.Id, includeItemTypes: 'Movie' }),
      jellyfin.items(admin.token, { ...query, userId: user.Id, includeItemTypes: 'Episode' }),
    ]);
    for (const item of playedMovies.Items) {
      const ids = idsOf(item.ProviderIds, 'movie');
      if (!ids) continue;
      const key = ids.tmdb ? `m:tmdb:${ids.tmdb}` : `m:imdb:${ids.imdb}`;
      if (have.has(key) || (ids.imdb && have.has(`m:imdb:${ids.imdb}`))) {
        if (!movies.has(key)) alreadyThere++;
        have.add(key);
        continue;
      }
      movies.set(key, { ids, watched_at: later(movies.get(key)?.watched_at, item.UserData?.LastPlayedDate) });
    }
    for (const item of playedEpisodes.Items) {
      const ids = item.SeriesId ? seriesIds.get(item.SeriesId) : undefined;
      if (!ids || item.ParentIndexNumber == null || item.IndexNumber == null) continue;
      const tail = `${item.ParentIndexNumber}:${item.IndexNumber}`;
      const key = ids.tmdb ? `e:tmdb:${ids.tmdb}:${tail}` : `e:tvdb:${ids.tvdb}:${tail}`;
      if (have.has(key) || (ids.tvdb && have.has(`e:tvdb:${ids.tvdb}:${tail}`))) {
        if (!episodes.has(key)) alreadyThere++;
        have.add(key);
        continue;
      }
      const previous = episodes.get(key);
      episodes.set(key, { ids, season: item.ParentIndexNumber, number: item.IndexNumber, watched_at: later(previous?.watched_at, item.UserData?.LastPlayedDate) });
    }
  });

  // Episodes grouped per show and season, the way Trakt takes them.
  const shows = new Map<string, { ids: TraktIds; seasons: Map<number, Array<{ number: number; watched_at?: string }>> }>();
  for (const ep of episodes.values()) {
    const key = JSON.stringify(ep.ids);
    const show = shows.get(key) ?? { ids: ep.ids, seasons: new Map() };
    shows.set(key, show);
    const season = show.seasons.get(ep.season) ?? [];
    show.seasons.set(ep.season, season);
    season.push({ number: ep.number, watched_at: ep.watched_at });
  }

  let added = 0;
  let notFound = 0;
  const send = async (body: object) => {
    const result = await write<HistoryResult>('/sync/history', body);
    added += (result?.added?.movies ?? 0) + (result?.added?.episodes ?? 0);
    notFound += (result?.not_found?.movies?.length ?? 0) + (result?.not_found?.shows?.length ?? 0) + (result?.not_found?.episodes?.length ?? 0);
  };
  for (const batch of chunks([...movies.values()], 200)) await send({ movies: batch });
  const showList = [...shows.values()].map((s) => ({
    ids: s.ids,
    seasons: [...s.seasons].map(([number, eps]) => ({ number, episodes: eps })),
  }));
  for (const batch of chunks(showList, 25)) await send({ shows: batch });
  return { added, alreadyThere, notFound };
}

// ---------- Recommendations for Home ----------

const recommendations = new TTLCache<SeerrResult[]>(10);

/**
 * Trakt's picks for the account, as TMDB titles (so they open, request and show
 * availability like any other card). The same for everyone; kept for hours since
 * each one costs a Seerr lookup on the Pi.
 */
export async function traktPicks(mediaType: MediaType): Promise<SeerrResult[]> {
  if (!link || !has.trakt() || !has.seerr()) return [];
  const key = `${mediaType}:${lang()}`;
  return recommendations.wrap(key, 6 * HOUR, async () => {
    const list = await asAccount<Array<{ ids: TraktIds }>>(`/recommendations/${mediaType === 'movie' ? 'movies' : 'shows'}`, {
      query: { limit: 30 },
      timeoutMs: 8000,
    }).catch(() => {
      // Trakt unreachable: an empty row for a few minutes, rather than a slow Home on every load.
      recommendations.set(key, [], 5 * MINUTE);
      return [];
    });
    const ids = [...new Set(list.map((r) => r.ids.tmdb).filter((id): id is number => Boolean(id)))];
    const titles = await mapLimit(ids, 4, async (id): Promise<SeerrResult | undefined> => {
      if (mediaType === 'movie') {
        const m = await settle(catalog.movie(id), undefined);
        return m && { id, mediaType, title: m.title, posterPath: m.posterPath, backdropPath: m.backdropPath, overview: m.overview, releaseDate: m.releaseDate, voteAverage: m.voteAverage, mediaInfo: m.mediaInfo };
      }
      const s = await settle(catalog.tv(id), undefined);
      return s && { id, mediaType, name: s.name, posterPath: s.posterPath, backdropPath: s.backdropPath, overview: s.overview, firstAirDate: s.firstAirDate, voteAverage: s.voteAverage, mediaInfo: s.mediaInfo };
    });
    return titles.filter((r): r is SeerrResult => Boolean(r));
  });
}
