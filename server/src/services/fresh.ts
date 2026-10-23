import fs from 'node:fs';
import path from 'node:path';
import type { ChannelDef, ChannelSettings, ChannelSource, FreshEvent, FreshNote, FreshSettings, FreshState, FreshStatus, FreshTitle, MediaType } from '@netfish/shared';
import { config, has } from '../config';
import { posterOf, radarr, sonarr, type ArrDisk, type ArrLookup, type ArrQueueRecord, type ArrRootFolder, type RadarrMovie, type SonarrSeries } from '../clients/arr';
import { qbittorrent } from '../clients/qbittorrent';
import { seerr, type SeerrResult } from '../clients/seerr';
import { settle } from '../lib/async';
import { tmdbImage } from '../lib/images';
import { writeJson } from '../lib/storage';
import { HttpError } from '../lib/upstream';
import { t } from '../lib/i18n';

/**
 * New titles for channels. Every few minutes:
 * - picks a well-liked film (or a show's first season) nobody here has, for a channel that
 *   wants new things, and puts it in that channel's guide (the guide is a week ahead);
 * - the admin's days before it airs, adds it to Radarr/Sonarr (tagged netfish-channel), within
 *   the download hours, the space, the free-disk floor and the speed, one at a time;
 * - keeps it out of everyone's library and Activity, and deletes it once it has aired.
 * If one isn't downloaded in time, its slot gets something from the library and it goes on
 * once it's here. Never touches anything Netfish didn't add, nor anything someone requested,
 * kept, or chose to watch (then it's theirs, in the library).
 */

export const TAG = 'netfish-channel';
const FILE = path.join(config.dataDir, 'fresh.json');
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** Before a release is found, what a film or a season is taken to need. */
const GUESS: Record<MediaType, number> = { movie: 5 * GB, tv: 9 * GB };
/** No release found for this long: given up on. */
const GIVE_UP = 12 * 3600_000;
/** Deleted this long after its last airing ends. */
const AFTER_AIRING = 15 * 60_000;

export const FRESH_DEFAULTS: FreshSettings = { enabled: false, maxGb: 60, minFreeGb: 50, fromHour: 1, toHour: 8, maxSpeed: 0, perWeek: 3, aheadDays: 3 };

interface Episode {
  season: number;
  episode: number;
  title: string;
  seconds: number;
  image?: string;
}

interface Fresh {
  key: string;
  mediaType: MediaType;
  tmdbId: number;
  tvdbId?: number;
  /** Radarr's or Sonarr's id, once it's been added there. */
  arrId?: number;
  title: string;
  year?: number;
  poster?: string;
  channelId: string;
  /** When it was picked. */
  addedAt: number;
  state: FreshState;
  /** The earliest it goes on (picked a while ahead, and spread over the week). */
  notBefore: number;
  /** Where the guide has it (its first airing). */
  airAt?: number;
  /** When its download started, and finished. */
  startedAt?: number;
  readyAt?: number;
  size: number;
  progress?: number;
  airedAt?: number;
  /** Who kept it, or asked for it before it was here (it carries on as planned, then stays). */
  keptBy?: string;
  /** TMDB's details, for the guide until it's here: length, picture, genres; a show's episodes. */
  seconds: number;
  image?: string;
  genres: string[];
  episodes?: Episode[];
}

interface Stored {
  titles: Fresh[];
  /** Everything ever picked or turned down, so it isn't tried again. */
  tried: string[];
  /** When each was picked, and for which channel (the last week's, for the weekly limit). */
  log: Array<{ at: number; channelId: string }>;
  /** Downloads this stopped outside the hours (to start again, and only those). */
  stopped: string[];
  /** How many each channel has picked, ever: its turn (Netfish's own takes a documentary every other one). */
  turns: Record<string, number>;
  /** What happened lately (started, couldn't be added, nothing found), newest last. */
  events: FreshEvent[];
}

function load(): Stored {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Stored>;
    const titles = (data.titles ?? []).map((f) => ({ ...f, notBefore: f.notBefore ?? f.addedAt, seconds: f.seconds ?? 0, genres: f.genres ?? [] }));
    const log = (data.log ?? []).map((x) => (typeof x === 'number' ? { at: x, channelId: '' } : x));
    return { titles, tried: data.tried ?? [], log, stopped: data.stopped ?? [], turns: data.turns ?? {}, events: data.events ?? [] };
  } catch {
    return { titles: [], tried: [], log: [], stopped: [], turns: {}, events: [] };
  }
}
let stored = load();
const save = () => writeJson(FILE, stored);

/** Noted for Settings: what happened to a title (the last 30). */
function noteEvent(f: Fresh, what: FreshEvent['what'], now: number, detail?: string) {
  stored.events = [...stored.events, { at: new Date(now).toISOString(), title: f.title, what, ...(detail ? { detail: detail.slice(0, 300) } : {}) }].slice(-30);
}
/** The last look inside the download hours (since the server started). */
let lastInHours: { at: number; note: FreshNote; title?: string } | undefined;

// ---------- What the channels side tells this side ----------

/** Set by the channels service, which owns the settings and schedules. */
export interface ChannelsLink {
  settings(): ChannelSettings;
  /** When it's on next (its first airing still to come, or on now). */
  airAt(key: string): number | undefined;
  /** It wasn't here in time for its slot: that went to something else. */
  missed(key: string): boolean;
  /** When a title's run on its channel ends, once all of it is in the schedule. */
  doneAt(key: string): number | undefined;
  /** It's on a channel right now. */
  onAir(key: string): boolean;
  /** Takes these titles out of every schedule from their next airing on. */
  drop(keys: string[]): void;
}
let link: ChannelsLink | undefined;
export const linkChannels = (l: ChannelsLink) => {
  link = l;
};

const settingsOf = (s?: ChannelSettings): FreshSettings => ({ ...FRESH_DEFAULTS, ...s?.fresh });
/** Channels that bring in new titles (visible ones; a single show's channel can't). */
const freshChannels = (s: ChannelSettings) =>
  s.enabled && settingsOf(s).enabled ? s.channels.filter((c) => c.fresh && !c.hidden && c.source.kind !== 'series') : [];

// ---------- For the rest of Netfish ----------

/** A new title for a channel's guide: on that channel only, from `notBefore`. */
export interface FreshPlan {
  key: string;
  channelId: string;
  mediaType: MediaType;
  title: string;
  year?: number;
  notBefore: number;
  added: number;
  seconds: number;
  image?: string;
  genres: string[];
  episodes?: Episode[];
  /** Someone asked for it: it stays once it has aired. */
  requested: boolean;
}

/** Still to air: planned, downloading, or here. */
export function freshPlans(): FreshPlan[] {
  return stored.titles
    .filter((f) => f.state === 'planned' || f.state === 'downloading' || f.state === 'ready')
    .map((f) => ({ key: f.key, channelId: f.channelId, mediaType: f.mediaType, title: f.title, year: f.year, notBefore: f.notBefore, added: f.addedAt, seconds: f.seconds, image: f.image, genres: f.genres, episodes: f.episodes, requested: Boolean(f.keptBy) }));
}
/** Aired, on the way out: on no channel any more. */
export const freshRetired = () => new Set(stored.titles.filter((f) => f.state === 'aired').map((f) => f.key));
/** Not in anyone's library or Activity (all of them, until someone keeps one or asks for it). */
export const freshHidden = () => new Set(stored.titles.filter((f) => f.state !== 'kept' && !f.keptBy).map((f) => f.key));

/** Whether someone kept a new title, or asked for it. Undefined: it isn't one. */
export const freshRequested = (key: string) => {
  const f = stored.titles.find((x) => x.key === key);
  return f && (f.state === 'kept' || Boolean(f.keptBy));
};

/**
 * Someone keeps it: it stays, and joins the library. One not here yet (or still downloading)
 * carries on as planned, joins the library once it's here, and isn't deleted after it airs.
 */
export function keepFresh(key: string, by: string): { here: boolean } {
  const f = stored.titles.find((x) => x.key === key);
  if (!f) throw new HttpError(404, t('Not a new title on a channel'));
  if (f.state === 'kept') return { here: true };
  f.keptBy ??= by;
  const here = f.state === 'ready' || f.state === 'aired';
  if (here) f.state = 'kept';
  save();
  onChange();
  return { here };
}

/** An admin takes it off now (not one someone kept or asked for: that's theirs, deleted like anything else). */
export async function removeFresh(key: string) {
  const f = stored.titles.find((x) => x.key === key && x.state !== 'kept' && !x.keptBy);
  if (!f) throw new HttpError(404, t('Not a new title on a channel'));
  if (f.arrId !== undefined) {
    const api = f.mediaType === 'movie' ? radarr : sonarr;
    const queue = (await settle(api.queue(), { records: [] as ArrQueueRecord[] })).records;
    await remove(f, queue);
  }
  stored.titles = stored.titles.filter((x) => x !== f);
  save();
  link?.drop([key]);
  onChange();
}

/** Someone chose to watch it (not on a channel): it's theirs now, in the library. */
export function noteChosen(key: string | undefined, by: string) {
  if (key && stored.titles.some((f) => f.key === key && f.state !== 'kept' && f.state !== 'planned')) keepFresh(key, by);
}

const listeners: Array<() => void> = [];
/** Told when the new titles change (to refresh what's cached). */
export const onFreshChange = (fn: () => void) => listeners.push(fn);
const onChange = () => listeners.forEach((fn) => fn());

// ---------- Hours, space ----------

function localHour(at: number, timeZone?: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at));
  } catch {
    return new Date(at).getHours();
  }
}
export function inHours(s: FreshSettings, at: number, timeZone?: string): boolean {
  if (s.fromHour === s.toHour) return true;
  const h = localHour(at, timeZone);
  return s.fromHour < s.toHour ? h >= s.fromHour && h < s.toHour : h >= s.fromHour || h < s.toHour;
}

/** The free space where new titles would go (the disk under Radarr/Sonarr's first library folder). */
function freeOn(roots: ArrRootFolder[], disks: ArrDisk[]): number | undefined {
  const root = roots[0];
  if (!root) return undefined;
  if (typeof root.freeSpace === 'number') return root.freeSpace;
  const disk = [...disks].sort((a, b) => b.path.length - a.path.length).find((d) => root.path.startsWith(d.path));
  return disk?.freeSpace;
}

const guess = (type: MediaType) => {
  const sizes = stored.titles.filter((f) => f.mediaType === type && (f.state === 'ready' || f.state === 'aired' || f.state === 'kept') && f.size > 0).map((f) => f.size);
  return sizes.length ? Math.max(GUESS[type] / 2, sizes.reduce((a, b) => a + b, 0) / sizes.length) : GUESS[type];
};
/** On disk or on the way. */
const used = () => stored.titles.filter((f) => f.state === 'downloading' || f.state === 'ready' || f.state === 'aired').reduce((n, f) => n + f.size, 0);
/** And what's planned will take. */
const planned = () => stored.titles.filter((f) => f.state === 'planned').reduce((n, f) => n + guess(f.mediaType), 0);
const upcoming = () => stored.titles.filter((f) => f.state === 'planned' || f.state === 'downloading' || f.state === 'ready');
const pickedThisWeek = (now: number, channelId?: string) => stored.log.filter((x) => x.at > now - WEEK && (!channelId || x.channelId === channelId)).length;
const downloadAt = (f: Fresh, s: FreshSettings) => (f.airAt === undefined ? undefined : f.airAt - s.aheadDays * DAY);

// ---------- Finding something new ----------

/** TMDB's genre ids, from the names Jellyfin uses (English or Italian). */
const TMDB_GENRES: Record<string, number> = {
  action: 28, azione: 28, adventure: 12, avventura: 12, animation: 16, animazione: 16, comedy: 35, commedia: 35, crime: 80, crimine: 80,
  documentary: 99, documentario: 99, drama: 18, dramma: 18, family: 10751, famiglia: 10751, fantasy: 14, history: 36, storia: 36,
  horror: 27, music: 10402, musica: 10402, mystery: 9648, mistero: 9648, romance: 10749, romantico: 10749, 'science fiction': 878,
  fantascienza: 878, thriller: 53, war: 10752, guerra: 10752, western: 37, kids: 10762, bambini: 10762, 'action & adventure': 10759,
  'sci-fi & fantasy': 10765, 'war & politics': 10768,
};
const genreIds = (names: string[] = []) => [...new Set(names.map((n) => TMDB_GENRES[n.toLowerCase()]).filter((id): id is number => Boolean(id)))];

const ANIMATION = 16;
const COMEDY = 35;
const DOCUMENTARY = 99;
const FAMILY = 10751;
const KIDS = 10762;
const HORROR = 27;
const GRIM = [80, 10752, 10768];
/** Not what a nature documentary is: history, music; on TV, reality, news, talk, children's, soaps. */
const NOT_NATURE = [36, 10402, 10764, 10763, 10767, 10762, 10766];
/** What a nature documentary talks about (TMDB's text, in English or Italian). */
const NATURE =
  /\b(nature|natural world|wildlife|wild|animals?|species|planet|earth|oceans?|seas?|marine|reefs?|coral|forests?|jungles?|rainforests?|arctic|antarctic|polar|deserts?|savann?ah?|predators?|whales?|sharks?|penguins?|birds?|insects?|habitats?|ecosystems?|migration|natura|animali|fauna|selvagg\w*|pianeta|terra|ocean[oi]|mari?|forest[ae]|giungl[ae]|specie)\b/i;

interface Want {
  mediaType: MediaType;
  genres: number[];
  avoid: number[];
  /** Out in the last year or so. */
  recent?: boolean;
  /** Sitcoms: short episodes. */
  shortEpisodes?: boolean;
  /** About nature (wildlife, oceans, the planet): Netfish's documentaries. */
  nature?: boolean;
  /** How well liked, at least (TMDB's score and its number of votes): 6.8 by 200 people unless said. */
  minRating?: number;
  minVotes?: number;
}

/** What a channel would like new, given what it plays. `turn` varies Netfish's own channel. */
export function wantsOf(source: ChannelSource, turn = 0): Want[] {
  switch (source.kind) {
    case 'mix': {
      // Every other one a nature documentary, and a much-liked one: a series' first season for
      // the weekday one o'clock, or a film for the documentary nights (each in turn; the other
      // if there's none, then a film). Otherwise a film for nine o'clock.
      const series: Want = { mediaType: 'tv', genres: [DOCUMENTARY], avoid: [...GRIM, ...NOT_NATURE], nature: true, minRating: 8, minVotes: 80 };
      const film: Want = { mediaType: 'movie', genres: [DOCUMENTARY], avoid: [...GRIM, ...NOT_NATURE], nature: true, minRating: 7.5, minVotes: 150 };
      const documentaries = turn % 2 === 1 ? (Math.floor(turn / 2) % 2 ? [film, series] : [series, film]) : [];
      return [...documentaries, { mediaType: 'movie', genres: [], avoid: [ANIMATION, FAMILY, DOCUMENTARY, HORROR] }];
    }
    case 'cartoons':
      return [{ mediaType: 'tv', genres: [ANIMATION], avoid: [] }];
    case 'sitcoms':
      return [{ mediaType: 'tv', genres: [COMEDY], avoid: [ANIMATION, KIDS, DOCUMENTARY], shortEpisodes: true }];
    case 'films':
      return [{ mediaType: 'movie', genres: genreIds(source.genres), avoid: genreIds(source.avoid) }];
    case 'genre': {
      const genres = genreIds([source.genre]);
      if (!genres.length) return [];
      return [
        ...(source.movies ? [{ mediaType: 'movie' as const, genres, avoid: [] }] : []),
        ...(source.episodes ? [{ mediaType: 'tv' as const, genres, avoid: [] }] : []),
      ];
    }
    case 'recent':
      return [{ mediaType: 'movie', genres: [], avoid: [], recent: true }];
    case 'shows':
      return [{ mediaType: 'tv', genres: [], avoid: [KIDS] }];
    case 'series':
      return [];
  }
}

const dateOf = (r: SeerrResult) => Date.parse((r.mediaType === 'tv' ? r.firstAirDate : r.releaseDate) ?? r.releaseDate ?? r.firstAirDate ?? '') || 0;

/** Whether a TMDB result is good for this channel: well liked, out a while, and nobody's had it. */
export function suits(r: SeerrResult, want: Want, now: number): boolean {
  const genres = r.genreIds ?? [];
  if (want.genres.length && !genres.some((g) => want.genres.includes(g))) return false;
  if (genres.some((g) => want.avoid.includes(g))) return false;
  if ((r.voteAverage ?? 0) < (want.minRating ?? 6.8) || (r.voteCount ?? 0) < (want.minVotes ?? 200)) return false;
  if (want.nature && !NATURE.test(`${r.title ?? r.name ?? ''} ${r.overview ?? ''}`)) return false;
  // Unknown to Seerr (not requested, not on the server, not turned down).
  if (r.mediaInfo && r.mediaInfo.status > 1) return false;
  const out = dateOf(r);
  // Films out on disc and streaming (a few months after the cinema), shows already running.
  if (!out || out > now - (want.mediaType === 'movie' ? 120 : 30) * DAY) return false;
  if (want.recent && out < now - 540 * DAY) return false;
  return true;
}

/** Liked a lot, by a lot of people (with a little chance, so it isn't always the same order). */
const score = (r: SeerrResult, seed: number) => (r.voteAverage ?? 0) * Math.log10(10 + (r.voteCount ?? 0)) * (0.85 + ((Math.abs(seed * 31 + r.id) % 100) / 100) * 0.3);

async function candidates(want: Want, now: number): Promise<SeerrResult[]> {
  const kind = want.mediaType === 'movie' ? 'movies' : 'tv';
  // Nature documentaries: the best-rated first, and a few more pages (most documentaries aren't about nature).
  const extra: Record<string, string | number> = {
    sortBy: want.nature ? 'vote_average.desc' : 'popularity.desc',
    voteCountGte: want.minVotes ?? 200,
    voteAverageGte: want.minRating ?? 6.8,
  };
  if (want.genres.length) extra.genre = want.genres.join('|');
  const pageNumbers = want.nature ? [1, 2, 3, 4, 5] : [1, 2, 3];
  const pages = await Promise.all(pageNumbers.map((page) => settle(seerr.discover(kind, page, extra), undefined)));
  const seen = new Set<number>();
  const seed = Math.floor(now / DAY);
  return pages
    .flatMap((p) => p?.results ?? [])
    .map((r) => ({ ...r, mediaType: want.mediaType }) as SeerrResult)
    .filter((r) => !seen.has(r.id) && seen.add(r.id) && suits(r, want, now) && !stored.tried.includes(`${want.mediaType}-${r.id}`))
    .sort((a, b) => score(b, seed) - score(a, seed));
}

/** Its details for the guide (TMDB's), if nobody has it in Radarr/Sonarr already. */
async function planFor(r: SeerrResult, want: Want, channelId: string, notBefore: number, now: number): Promise<Fresh | undefined> {
  const key = `${want.mediaType}-${r.id}`;
  stored.tried.push(key);
  const base = { key, mediaType: want.mediaType, tmdbId: r.id, channelId, addedAt: now, state: 'planned' as const, notBefore, size: 0, poster: tmdbImage(r.posterPath, 'w185') };
  if (want.mediaType === 'movie') {
    if (has.radarr() && (await settle(radarr.movieByTmdb(r.id), undefined))) return undefined; // someone's
    const d = await seerr.movie(r.id);
    return {
      ...base,
      title: d.title ?? r.title ?? '',
      year: Number((d.releaseDate ?? r.releaseDate)?.slice(0, 4)) || undefined,
      seconds: (d.runtime || 110) * 60,
      image: tmdbImage(d.backdropPath ?? r.backdropPath, 'w780'),
      genres: (d.genres ?? []).map((g) => g.name),
    };
  }
  const d = await seerr.tv(r.id);
  const tvdbId = d.externalIds?.tvdbId;
  if (!tvdbId) return undefined;
  const runtime = Math.min(...(d.episodeRunTime?.length ? d.episodeRunTime : [45]));
  // Sitcoms: half-hour episodes.
  if (want.shortEpisodes && runtime > 35) return undefined;
  if (has.sonarr() && (await settle(sonarr.seriesByTvdb(tvdbId), undefined))) return undefined;
  const season = await seerr.season(r.id, 1);
  const backdrop = tmdbImage(d.backdropPath ?? r.backdropPath, 'w780');
  const episodes = season.episodes
    .filter((e) => e.episodeNumber > 0)
    .map((e) => ({ season: 1, episode: e.episodeNumber, title: e.name, seconds: (e.runtime || runtime) * 60, image: tmdbImage(e.stillPath, 'w780') ?? backdrop }));
  if (!episodes.length) return undefined;
  return {
    ...base,
    tvdbId,
    title: d.name ?? r.name ?? '',
    year: Number((d.firstAirDate ?? r.firstAirDate)?.slice(0, 4)) || undefined,
    seconds: episodes.reduce((n, e) => n + e.seconds, 0),
    image: backdrop,
    genres: (d.genres ?? []).map((g) => g.name),
    episodes,
  };
}

// ---------- Downloading ----------

const tagIds: Partial<Record<'radarr' | 'sonarr', number>> = {};
async function tagFor(service: 'radarr' | 'sonarr'): Promise<number> {
  if (tagIds[service]) return tagIds[service]!;
  const api = service === 'radarr' ? radarr : sonarr;
  const tags = await api.tags();
  const found = tags.find((x) => x.label.toLowerCase() === TAG) ?? (await api.addTag(TAG));
  tagIds[service] = found.id;
  return found.id;
}

/** Into Radarr (tagged), searching straight away. Undefined if someone has added it there since. */
async function addMovie(f: Fresh, s: FreshSettings): Promise<number | undefined> {
  if (await settle(radarr.movieByTmdb(f.tmdbId), undefined)) return undefined;
  const [lookup, roots, profiles, tag] = await Promise.all([radarr.lookup(f.tmdbId), radarr.rootFolders(), radarr.qualityProfiles(), tagFor('radarr')]);
  const profile = profiles.find((p) => p.id === s.movieProfile) ?? profiles[0];
  if (!roots[0] || !profile) throw new HttpError(502, t('Radarr has no library folder or quality profile'));
  const movie = await radarr.add({
    ...lookup,
    qualityProfileId: profile.id,
    rootFolderPath: roots[0].path,
    monitored: true,
    minimumAvailability: 'released',
    tags: [tag],
    addOptions: { searchForMovie: true },
  } as ArrLookup);
  f.poster ??= posterOf(movie.images);
  return movie.id;
}

/** Into Sonarr (tagged), the first season only, searching straight away. */
async function addShow(f: Fresh, s: FreshSettings): Promise<number | undefined> {
  if (!f.tvdbId || (await settle(sonarr.seriesByTvdb(f.tvdbId), undefined))) return undefined;
  const [found, roots, profiles, languages, tag] = await Promise.all([
    sonarr.lookup(f.tvdbId),
    sonarr.rootFolders(),
    sonarr.qualityProfiles(),
    settle(sonarr.languageProfiles(), []),
    tagFor('sonarr'),
  ]);
  const lookup = found[0];
  const profile = profiles.find((p) => p.id === s.showProfile) ?? profiles[0];
  if (!lookup || !roots[0] || !profile) throw new HttpError(502, t('Sonarr has no library folder or quality profile'));
  const series = await sonarr.add({
    ...lookup,
    qualityProfileId: profile.id,
    ...(languages[0] ? { languageProfileId: languages[0].id } : {}),
    rootFolderPath: roots[0].path,
    monitored: true,
    seasonFolder: true,
    tags: [tag],
    seasons: (lookup.seasons ?? []).map((x) => ({ seasonNumber: x.seasonNumber, monitored: x.seasonNumber === 1 })),
    addOptions: { monitor: 'firstSeason', searchForMissingEpisodes: true },
  } as ArrLookup);
  f.poster ??= posterOf(series.images);
  return series.id;
}

/** Removes it from Radarr/Sonarr with its files (and from the torrent client, if still going). */
async function remove(f: Fresh, queue: ArrQueueRecord[]) {
  if (f.arrId === undefined) return;
  const api = f.mediaType === 'movie' ? radarr : sonarr;
  const mine = queue.filter((q) => (f.mediaType === 'movie' ? q.movieId : q.seriesId) === f.arrId).map((q) => q.id);
  if (mine.length) await settle(api.removeFromQueue(mine, { blocklist: false, skipRedownload: true }), undefined);
  await api.remove(f.arrId);
}

/**
 * Whose turn it is: the channel with the least coming up, then the one that waited longest,
 * then the choosier one (a genre's channel before Netfish's own, which can take almost anything).
 */
function byTurn(defs: ChannelDef[]): ChannelDef[] {
  const usable = defs.filter((d) => wantsOf(d.source).some((w) => (w.mediaType === 'movie' ? has.radarr() : has.sonarr())));
  const count = (id: string) => upcoming().filter((f) => f.channelId === id).length;
  const last = (id: string) => Math.max(0, ...stored.titles.filter((f) => f.channelId === id).map((f) => f.addedAt));
  const broad = (d: ChannelDef) => (wantsOf(d.source).every((w) => !w.genres.length) ? 1 : 0);
  return [...usable].sort((a, b) => count(a.id) - count(b.id) || last(a.id) - last(b.id) || broad(a) - broad(b) || a.number - b.number);
}

// ---------- Every few minutes ----------

let running: Promise<void> | undefined;
let queued: Promise<void> | undefined;
let lastWaiting: FreshStatus['waiting'];
let lastFree: number | undefined;

/** One look (asked again while one is going: another straight after, with the latest settings). */
export function runFresh(now?: number): Promise<void> {
  if (running) {
    queued ??= running.then(() => {
      queued = undefined;
      return runFresh(now);
    });
    return queued;
  }
  running = step(now ?? Date.now())
    .catch((err) => console.warn('[fresh]', (err as Error).message))
    .finally(() => (running = undefined));
  return running;
}

async function step(now: number) {
  if (!link) return;
  const settings = link.settings();
  const s = settingsOf(settings);
  const defs = freshChannels(settings);
  const before = JSON.stringify(stored.titles.map((f) => [f.key, f.state, f.airAt]));

  // Where everything is: Radarr/Sonarr's titles and queues.
  const added = stored.titles.filter((f) => f.arrId !== undefined);
  const movies = added.some((f) => f.mediaType === 'movie') && has.radarr();
  const shows = added.some((f) => f.mediaType === 'tv') && has.sonarr();
  const [movieList, seriesList, movieQueue, showQueue] = await Promise.all([
    movies ? radarr.movies() : Promise.resolve([] as RadarrMovie[]),
    shows ? sonarr.allSeries() : Promise.resolve([] as SonarrSeries[]),
    movies ? radarr.queue().then((q) => q.records) : Promise.resolve([] as ArrQueueRecord[]),
    shows ? sonarr.queue().then((q) => q.records) : Promise.resolve([] as ArrQueueRecord[]),
  ]);
  const movieById = new Map(movieList.map((m) => [m.id, m]));
  const seriesById = new Map(seriesList.map((x) => [x.id, x]));
  const queueOf = (f: Fresh) => (f.mediaType === 'movie' ? movieQueue.filter((q) => q.movieId === f.arrId) : showQueue.filter((q) => q.seriesId === f.arrId));
  const gone: Fresh[] = [];

  for (const f of stored.titles) {
    f.airAt = link.airAt(f.key);
    if (f.state === 'planned') {
      // Its slot went by (or went to something else) before it was even downloading: forgotten,
      // unless someone asked for it (it downloads anyway, and goes on once it's here).
      if (!f.keptBy && (link.missed(f.key) || (f.airAt === undefined && f.notBefore < now - DAY))) gone.push(f);
      continue;
    }
    if (f.arrId === undefined || (f.mediaType === 'movie' && !movies) || (f.mediaType === 'tv' && !shows)) continue;
    const managed = f.mediaType === 'movie' ? movieById.get(f.arrId) : seriesById.get(f.arrId);
    // Deleted in Radarr/Sonarr by someone: forgotten here too.
    if (!managed) {
      gone.push(f);
      continue;
    }
    const q = queueOf(f);
    const onDisk = f.mediaType === 'movie' ? ((managed as RadarrMovie).sizeOnDisk ?? 0) : ((managed as SonarrSeries).statistics?.sizeOnDisk ?? 0);
    const files = f.mediaType === 'movie' ? Boolean((managed as RadarrMovie).hasFile) : ((managed as SonarrSeries).statistics?.episodeFileCount ?? 0) > 0;
    if (q.length) {
      const size = q.reduce((n, r) => n + (Number(r.size) || 0), 0);
      const left = q.reduce((n, r) => n + (Number(r.sizeleft) || 0), 0);
      f.size = Math.max(onDisk, onDisk + left, size || f.size);
      f.progress = size > 0 ? Math.max(0, Math.min(1, 1 - left / size)) : 0;
      if (f.state === 'ready') f.state = 'downloading';
    } else {
      f.progress = undefined;
      if (onDisk) f.size = onDisk;
      if (f.state === 'downloading' && files) {
        f.state = 'ready';
        f.readyAt ??= now;
      } else if (f.state === 'downloading' && now - (f.startedAt ?? f.addedAt) > GIVE_UP) {
        // Nothing found to download in all this time: given up on.
        noteEvent(f, 'nothing-found', now);
        await settle(remove(f, []), undefined);
        gone.push(f);
      }
    }
  }
  // Bigger than the space left, now the release is known: the newest download goes.
  const limit = s.maxGb * GB;
  const newest = stored.titles.filter((f) => f.state === 'downloading' && !f.keptBy && !gone.includes(f)).sort((a, b) => b.addedAt - a.addedAt)[0];
  if (newest && used() > limit * 1.05 && used() - newest.size <= limit) {
    noteEvent(newest, 'too-big', now);
    await settle(remove(newest, queueOf(newest)), undefined);
    gone.push(newest);
  }
  // Kept a month ago: theirs for good, nothing more to note here.
  for (const f of stored.titles) if (f.state === 'kept' && f.addedAt < now - 30 * DAY) gone.push(f);
  if (gone.length) {
    stored.titles = stored.titles.filter((f) => !gone.includes(f));
    link.drop(gone.filter((f) => f.state !== 'kept').map((f) => f.key));
  }

  // Requested by someone after all: theirs.
  if (has.seerr() && stored.titles.some((f) => f.state !== 'kept' && f.state !== 'planned')) {
    const requests = await settle(seerr.requests({ take: 250, skip: 0, filter: 'all', sort: 'added' }), undefined);
    const asked = new Set((requests?.results ?? []).map((r) => `${r.type}-${r.media?.tmdbId}`));
    for (const f of stored.titles) {
      if (f.state === 'kept' || f.state === 'planned' || !asked.has(f.key)) continue;
      f.state = 'kept';
      f.keptBy = 'requested';
    }
  }

  // Aired (the whole of it): deleted. Their channel stopped wanting new titles (or they were
  // switched off): deleted now, unless on right now.
  const queue = [...movieQueue, ...showQueue];
  const removed: Fresh[] = [];
  for (const f of stored.titles) {
    if (f.state === 'kept') continue;
    const wanted = defs.some((d) => d.id === f.channelId);
    const done = link.doneAt(f.key);
    // Asked for by someone: theirs once it has aired (or once its channel stops wanting new titles).
    if (f.keptBy && f.state !== 'planned' && ((f.state === 'ready' && done && now >= done) || (!wanted && !link.onAir(f.key)))) {
      f.state = 'kept';
      continue;
    }
    // On until `done`: aired once that's past.
    if (f.state === 'ready' && done && now >= done) {
      f.state = 'aired';
      f.airedAt = done;
    }
    const due = f.state === 'aired' && now > (f.airedAt ?? now) + AFTER_AIRING;
    if (due || (!wanted && !link.onAir(f.key))) {
      const ok = await settle(remove(f, queue).then(() => true), false);
      if (ok) removed.push(f);
    }
  }
  if (removed.length) {
    stored.titles = stored.titles.filter((f) => !removed.includes(f));
    link.drop(removed.map((f) => f.key));
  }

  // How much room the disk has (where Radarr, or Sonarr, keeps the library).
  if (has.radarr() || has.sonarr()) {
    const api = has.radarr() ? radarr : sonarr;
    const [roots, disks] = await Promise.all([settle(api.rootFolders(), []), settle(api.diskSpace(), [])]);
    lastFree = freeOn(roots, disks) ?? lastFree;
  }
  const lowDisk = lastFree !== undefined && lastFree < s.minFreeGb * GB;

  // The download hours and speed, through qBittorrent (lowest priority too). A full disk stops them as well.
  const hours = inHours(s, now, settings.timeZone);
  const go = hours && !lowDisk;
  if (has.qbittorrent()) {
    // In the order they'll be on: the title that airs first, and a show's episodes from the first.
    const hashes = stored.titles
      .filter((f) => f.state === 'downloading')
      .sort((a, b) => (a.airAt ?? Infinity) - (b.airAt ?? Infinity))
      .flatMap((f) =>
        [...queueOf(f)]
          .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episode?.episodeNumber ?? 0) - (b.episode?.episodeNumber ?? 0))
          .flatMap((q) => (q.downloadId ? [q.downloadId.toLowerCase()] : [])),
      );
    const unique = [...new Set(hashes)];
    if (!go && unique.length) {
      const fresh = unique.filter((h) => !stored.stopped.includes(h));
      if (fresh.length) await settle(qbittorrent.stop(fresh), undefined);
      stored.stopped = [...new Set([...stored.stopped, ...unique])];
    } else if (go && stored.stopped.length) {
      await settle(qbittorrent.start(stored.stopped), undefined);
      stored.stopped = [];
    }
    if (unique.length) {
      await settle(qbittorrent.limit(unique, s.maxSpeed > 0 ? (s.maxSpeed * MB) / unique.length : 0), undefined);
      // Behind everyone's own, one after another: the first to air at the front of them.
      for (const hash of unique) await settle(qbittorrent.last([hash]), undefined);
      // A whole season in one download comes front to back, so its first episodes are ready first.
      await settle(qbittorrent.inOrder(unique), undefined);
    }
  }

  // The next one due to download (its airing is the admin's days away), then something new for the guide.
  stored.log = stored.log.filter((x) => x.at > now - WEEK);
  const starting = defs.length ? await startDue(s, go, lowDisk, now, hours) : undefined;
  const planning = await planOne(s, defs, now);
  lastWaiting = starting ?? planning;
  if (JSON.stringify(stored.titles.map((f) => [f.key, f.state, f.airAt])) !== before) onChange();
  save();
}

/** Starts the download of the planned title whose day has come (one at a time). */
async function startDue(s: FreshSettings, go: boolean, lowDisk: boolean, now: number, hours: boolean): Promise<FreshStatus['waiting']> {
  // Inside the download hours, what came of it is kept for Settings (outside them it would only say so).
  const noted = <T,>(result: T, note: FreshNote, f?: Fresh): T => {
    if (hours) lastInHours = { at: now, note, title: f?.title };
    return result;
  };
  const busy = stored.titles.find((f) => f.state === 'downloading');
  if (busy) return noted(undefined, 'downloading', busy);
  // Asked for by someone: due now (with or without a slot of its own still to come).
  const due = stored.titles
    .filter((f) => f.state === 'planned' && (f.keptBy || (f.airAt !== undefined && now >= downloadAt(f, s)!)))
    .sort((a, b) => (a.airAt ?? now) - (b.airAt ?? now))[0];
  if (!due) return noted(undefined, 'nothing-due');
  if (lowDisk) return noted('disk', 'disk', due);
  if (!go) return 'hours';
  if (used() + guess(due.mediaType) > s.maxGb * GB) return noted('space', 'space', due);
  const api = due.mediaType === 'movie' ? has.radarr() : has.sonarr();
  if (!api) return noted('services', 'services', due);
  let failed: string | undefined;
  const id = await settle(due.mediaType === 'movie' ? addMovie(due, s) : addShow(due, s), undefined, (err) => {
    failed = (err as Error).message;
    console.warn('[fresh] adding', due.title, failed);
  });
  if (id === undefined) {
    // Someone has it in Radarr/Sonarr now, or it couldn't be added: off the guide.
    noteEvent(due, failed ? 'add-failed' : 'already-there', now, failed);
    noted(undefined, failed ? 'add-failed' : 'already-there', due);
    stored.titles = stored.titles.filter((f) => f !== due);
    link?.drop([due.key]);
    return undefined;
  }
  noteEvent(due, 'started', now);
  noted(undefined, 'started', due);
  due.arrId = id;
  due.startedAt = now;
  due.state = 'downloading';
  due.size = guess(due.mediaType);
  return undefined;
}

/**
 * A channel's turn (Netfish's own takes a documentary on odd ones): a documentary when its last
 * new title wasn't one, so it alternates from what came before (not from a count started when
 * Netfish was updated); which kind of documentary, series or film, still goes by the count.
 */
function turnOf(channelId: string): number {
  const count = stored.turns[channelId] ?? 0;
  const last = stored.titles.filter((f) => f.channelId === channelId).sort((a, b) => b.addedAt - a.addedAt)[0];
  if (!last) return count;
  const documentaryNext = !last.genres.some((g) => TMDB_GENRES[g.toLowerCase()] === DOCUMENTARY);
  return count % 2 === (documentaryNext ? 1 : 0) ? count : count + 1;
}

/** Picks something new for a channel's guide, if its week has room (`perWeek` is each channel's). */
async function planOne(s: FreshSettings, defs: ChannelDef[], now: number): Promise<FreshStatus['waiting']> {
  if (!s.enabled) return 'off';
  if (!defs.length) return 'no-channels';
  if (!has.seerr() || (!has.radarr() && !has.sonarr())) return 'services';
  const mine = (id: string) => upcoming().filter((f) => f.channelId === id);
  // Channels with room this week, and less than a week's worth coming up.
  const open = defs.filter((d) => pickedThisWeek(now, d.id) < s.perWeek);
  if (!open.length) return 'week';
  const order = byTurn(open.filter((d) => mine(d.id).length < s.perWeek));
  if (!order.length) return 'enough';
  let full: FreshStatus['waiting'];
  for (const def of order) {
    // Spread over the channel's week, each far enough ahead to download in good time.
    const last = Math.max(0, ...mine(def.id).map((f) => f.notBefore));
    const notBefore = Math.max(now + s.aheadDays * DAY, last + WEEK / s.perWeek);
    const turn = turnOf(def.id);
    for (const want of wantsOf(def.source, turn)) {
      if ((want.mediaType === 'movie' && !has.radarr()) || (want.mediaType === 'tv' && !has.sonarr())) continue;
      const need = guess(want.mediaType);
      if (used() + planned() + need > s.maxGb * GB) {
        full = 'space';
        continue;
      }
      if (lastFree !== undefined && lastFree - planned() - need < s.minFreeGb * GB) {
        full = 'disk';
        continue;
      }
      for (const r of (await candidates(want, now)).slice(0, 6)) {
        const plan = await settle(planFor(r, want, def.id, notBefore, now), undefined, (err) => console.warn('[fresh] planning', r.title ?? r.name, (err as Error).message));
        if (plan) {
          stored.titles.push(plan);
          stored.log.push({ at: now, channelId: def.id });
          stored.turns[def.id] = turn + 1;
          return undefined;
        }
      }
    }
  }
  return full;
}

// ---------- Settings → Channels ----------

export async function freshStatus(): Promise<FreshStatus> {
  const settings = link?.settings();
  const s = settingsOf(settings);
  const [movieProfiles, showProfiles] = await Promise.all([
    has.radarr() ? settle(radarr.qualityProfiles(), []) : [],
    has.sonarr() ? settle(sonarr.qualityProfiles(), []) : [],
  ]);
  const iso = (at?: number) => (at === undefined ? undefined : new Date(at).toISOString());
  const titles: FreshTitle[] = stored.titles.map((f) => ({
    key: f.key,
    mediaType: f.mediaType,
    tmdbId: f.tmdbId,
    title: f.title,
    year: f.year,
    poster: f.poster,
    channelId: f.channelId,
    state: f.state,
    size: f.state === 'planned' ? guess(f.mediaType) : f.size,
    progress: f.progress,
    paused: f.state === 'downloading' && settings ? !inHours(s, Date.now(), settings.timeZone) && has.qbittorrent() : undefined,
    addedAt: new Date(f.addedAt).toISOString(),
    airAt: iso(f.airAt),
    // Asked for: as soon as it can.
    downloadAt: f.state === 'planned' ? iso(f.keptBy ? Date.now() : downloadAt(f, s)) : undefined,
    keptBy: f.keptBy,
  }));
  const order: Record<FreshState, number> = { downloading: 0, planned: 1, ready: 1, aired: 2, kept: 3 };
  return {
    usedBytes: used(),
    freeBytes: lastFree,
    addedThisWeek: pickedThisWeek(Date.now()),
    waiting: lastWaiting,
    lastInHours: lastInHours && { at: new Date(lastInHours.at).toISOString(), note: lastInHours.note, title: lastInHours.title },
    events: [...stored.events].reverse(),
    titles: titles.sort((a, b) => order[a.state] - order[b.state] || (a.airAt ?? 'z').localeCompare(b.airAt ?? 'z')),
    services: { radarr: has.radarr(), sonarr: has.sonarr(), seerr: has.seerr(), qbittorrent: has.qbittorrent() },
    profiles: { movie: movieProfiles.map((p) => ({ id: p.id, name: p.name })), show: showProfiles.map((p) => ({ id: p.id, name: p.name })) },
  };
}

export function validFresh(v: unknown, current?: FreshSettings): FreshSettings {
  const x = (v ?? {}) as Record<string, unknown>;
  const base = { ...FRESH_DEFAULTS, ...current };
  const num = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Math.round(Number(value));
    return value !== undefined && value !== null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const profile = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined);
  return {
    enabled: 'enabled' in x ? Boolean(x.enabled) : base.enabled,
    maxGb: num(x.maxGb, base.maxGb, 5, 20_000),
    minFreeGb: num(x.minFreeGb, base.minFreeGb, 0, 100_000),
    fromHour: num(x.fromHour, base.fromHour, 0, 23),
    toHour: num(x.toHour, base.toHour, 0, 23),
    maxSpeed: num(x.maxSpeed, base.maxSpeed, 0, 1000),
    perWeek: num(x.perWeek, base.perWeek, 1, 21),
    aheadDays: num(x.aheadDays, base.aheadDays, 1, 7),
    movieProfile: 'movieProfile' in x ? profile(x.movieProfile) : base.movieProfile,
    showProfile: 'showProfile' in x ? profile(x.showProfile) : base.showProfile,
  };
}

// Every ten minutes (a first look a minute after starting).
const timers = [setTimeout(() => void runFresh(), 60_000), setInterval(() => void runFresh(), 10 * 60_000)];
for (const timer of timers) timer.unref?.();
