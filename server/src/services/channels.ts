import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Channel, ChannelAdmin, ChannelDef, ChannelProgram, ChannelSettings, ChannelSource, ChannelsResponse } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config } from '../config';
import { jellyfin, ticksToSeconds, type JfItem } from '../clients/jellyfin';
import { jfImage } from '../lib/images';
import { writeJson } from '../lib/storage';
import { HttpError } from '../lib/upstream';
import { inLanguage, t } from '../lib/i18n';
import { FRESH_DEFAULTS, freshHidden, freshPlans, freshRetired, linkChannels, onFreshChange, runFresh, validFresh, type FreshPlan } from './fresh';
import { log, setLogTimeZone } from '../lib/log';

/**
 * Channels: the library as old-school TV, made only of what's already on the server. Each
 * channel's schedule is worked out two days ahead and kept, so the guide doesn't shift under
 * people and every screen on a channel shows the same minute. A short break (the fish, then
 * a look at what's next) comes between programmes. Nothing runs on the server for it: screens
 * play the file from where the schedule is.
 *
 * So it doesn't feel repetitive: shows take turns (a different one each time) and each carries
 * on episode by episode where it left off, like reruns; films are shuffled and none comes back
 * before the others have had their turn. Netfish's own channel (mix) runs a day of slots like a
 * network's, for grown-ups, new things first and nothing twice in a day: films and dramas in the
 * morning, a documentary at one, sitcoms from three, grown-up cartoons from six, a film at 9pm,
 * then late-night shows and a late film.
 */

const FILE = path.join(config.dataDir, 'channels.json');
export const BREAK_SECONDS = 15;
/** The guide is made a week ahead (new titles go in days before they're downloaded). */
const AHEAD = 7 * 24 * 3600_000;
const KEEP_BEHIND = 3 * 3600_000;
/** Too short for a programme (trailers, extras). */
const MIN_SECONDS = 60;
/** Sitcom episodes are short. */
const SITCOM_MAX = 35 * 60;
/** Shows with episodes shorter than this come in twos, back to back (The Simpsons, The Office). */
const PAIR_MAX = 40 * 60;
const DAY = 24 * 3600_000;

interface Entry {
  itemId: string;
  /** When the programme itself starts (the break is just before). */
  start: number;
  seconds: number;
  /** An episode from a run of its own (the evening line-up's). */
  track?: string;
}
/** A list that's gone through once (shuffled, unless it's in order) before anything comes round again. */
interface Round {
  order: string[];
  cursor: number;
  cycle: number;
}
/**
 * The rules schedules are made by. Raised when they change (a new timetable for Netfish's own
 * channel, say), so a week already planned is made again, from a few minutes ahead.
 */
const PLAN = 7;

interface Schedule {
  /** What the channel was built from: a different source starts a new schedule. */
  key: string;
  /** Which rules made it (PLAN). */
  plan?: number;
  seed: number;
  entries: Entry[];
  rounds: Record<string, Round>;
  /** Per show: the next episode to play (its place among the show's episodes); "evening:<show>" for the line-up's own run. */
  next: Record<string, number>;
  /** For blocks that alternate (a sitcom, then a cartoon…). */
  turn: number;
  /** A short show whose first of two episodes just went in: the second comes next ("evening:<show>" in the line-up). */
  pair?: string;
  /** Films, and when each was last on (the entries only go back a few hours). */
  films?: Record<string, number>;
  /** New titles all in the schedule now, and when their run ends (`movie-<tmdb>`, `tv-<tmdb>`). */
  freshDone?: Record<string, number>;
  /** New shows take every other turn. */
  freshTurn?: number;
  /** The show that's just been on (the next one is another, if there's any other). */
  lastShow?: string;
  /** New titles the schedule was made again for (once each), to fit them in soon. */
  freshRoom?: string[];
  /** New titles that weren't downloaded in time for their slot (they go on once they're here). */
  freshMissed?: string[];
}
interface Stored {
  settings: ChannelSettings;
  schedules: Record<string, Schedule>;
}

const DEFAULTS: ChannelSettings = { enabled: false, countWatched: false, channels: [] };

/**
 * Netfish's own channel, always first and as it is (only whether it gets new titles can change).
 * Lists from before it was fixed: their Netfish channel becomes it, or it's put back.
 */
function withNetfish(list: ChannelDef[], current?: ChannelDef): ChannelDef[] {
  if (!list.length) return list;
  const mine = current ?? list.find((c) => c.builtIn) ?? list.find((c) => c.source.kind === 'mix' && c.name.toLowerCase() === 'netfish');
  const sent = mine && list.find((c) => c.id === mine.id);
  const netfish: ChannelDef = { id: mine?.id ?? 'netfish', number: 1, name: 'Netfish', source: { kind: 'mix' }, builtIn: true, ...((sent ?? mine)?.fresh ? { fresh: true } : {}) };
  return [netfish, ...list.filter((c) => c.id !== netfish.id).map((c) => ({ ...c, builtIn: undefined }))].map((c, i) => ({ ...c, number: i + 1 }));
}

function load(): Stored {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Stored>;
    const schedules = Object.fromEntries(Object.entries(data.schedules ?? {}).filter(([, s]) => s && 'rounds' in s));
    const settings = { ...DEFAULTS, ...data.settings };
    return { settings: { ...settings, channels: withNetfish(settings.channels) }, schedules };
  } catch {
    return { settings: { ...DEFAULTS }, schedules: {} };
  }
}

let stored = load();
// The log's times are the household's (where the 9pm film is at 9pm).
setLogTimeZone(stored.settings.timeZone);
const save = () => writeJson(FILE, stored);

export const channelsEnabled = () => stored.settings.enabled;

// ---------- The library, as channels see it ----------

interface Program {
  id: string;
  /** The film's, or the episode's show's: `movie-<tmdb>`, `tv-<tmdb>`. */
  key?: string;
  type: 'Movie' | 'Episode';
  title: string;
  seconds: number;
  genres: string[];
  seriesId?: string;
  seriesTitle?: string;
  season?: number;
  episode?: number;
  year?: number;
  rating?: string;
  /** Jellyfin's community rating (out of 10). */
  score?: number;
  image?: string;
  added?: string;
}
interface Library {
  at: number;
  byId: Map<string, Program>;
  movies: Program[];
  episodes: Program[];
  /** Each show's episodes, in order. */
  bySeries: Map<string, Program[]>;
  series: Array<{ id: string; name: string; genres: string[]; rating?: string; key?: string }>;
  /** New on the channel looking (Netfish brought them in for it), due on now: first in line. */
  fresh?: { films: string[]; shows: string[] };
  /** All of this channel's new ones (due or not): they go on only as new, never in the usual turns. */
  held?: Set<string>;
  /** When each new one may go on (by id). */
  notBefore?: Map<string, number>;
  /** The slot being filled, and how soon one that isn't downloaded yet may go in. */
  slot?: number;
  soon?: number;
  /** Shows and films by the kind of thing they are (ids). */
  kinds: {
    toons: string[];
    kidsToons: string[];
    adultToons: string[];
    sitcoms: string[];
    shows: string[];
    films: string[];
    eveningFilms: string[];
    /** Friday and Saturday's films: the best-rated of the evening ones. */
    bigFilms: string[];
    animatedFilms: string[];
    /** For a weekend afternoon: comedies, family films, adventures (nothing grim or scary). */
    lightFilms: string[];
    /** Documentaries worth an evening (Our Planet, not true crime), best first. */
    docShows: string[];
    docFilms: string[];
  };
}

// Genre names as Jellyfin has them (from TMDB), in English or Italian.
const ANIMATION = ['animation', 'animazione'];
const COMEDY = ['comedy', 'commedia'];
const KIDS = ['kids', 'family', 'children', 'bambini', 'famiglia'];
/** Shows made for children ("Family" alone isn't: The Simpsons is Animation, Comedy, Family). */
const CHILDREN = ['kids', 'children', 'bambini'];
/** Ratings for children's television (Bluey is TV-Y, Avatar: The Last Airbender TV-Y7; The Simpsons is TV-PG). */
const CHILDRENS_RATING = /^TV-(Y|Y7|Y7-FV|G)$/i;
/** A show for children: by its genre, or its rating where the library has one. */
const forChildren = (s: { genres: string[]; rating?: string }) => has(s.genres, CHILDREN) || CHILDRENS_RATING.test(s.rating ?? '');
const ADVENTURE = ['adventure', 'avventura', 'action & adventure'];
const SCARY = ['horror'];
const SERIOUS = ['drama', 'dramma', 'thriller', 'crime', 'crimine', 'mystery', 'mistero', 'war', 'guerra', 'war & politics', 'history', 'storia', 'western'];
const SCIFI = ['science fiction', 'fantascienza', 'sci-fi & fantasy', 'fantasy'];
const DOCUMENTARY = ['documentary', 'documentario'];
const GRIM = ['crime', 'crimine', 'true crime', 'war', 'guerra', 'war & politics'];
const has = (genres: string[], names: string[]) => genres.some((g) => names.includes(g.toLowerCase()));
const light = (genres: string[]) =>
  has(genres, [...COMEDY, ...KIDS, ...ANIMATION, ...ADVENTURE]) && !has(genres, [...GRIM, ...SCARY, ...DOCUMENTARY]);

let library: Library | undefined;
let loading: Promise<Library> | undefined;
// A new title arrived (or went): the library is looked at again next time.
onFreshChange(() => {
  if (library) library.at = 0;
});

/** The Jellyfin access for building schedules: the server's API key, or the person asking. */
const tokenFor = (user: SessionUser) => config.jellyfin.apiKey ?? user.token;

const keyOf = (item: JfItem) => {
  const tmdb = item.ProviderIds?.Tmdb;
  return tmdb ? `${item.Type === 'Series' ? 'tv' : 'movie'}-${tmdb}` : undefined;
};

function toProgram(item: JfItem, seriesGenres: Map<string, string[]>, seriesKeys: Map<string, string | undefined>): Program | undefined {
  const seconds = Math.round(ticksToSeconds(item.RunTimeTicks));
  if (seconds < MIN_SECONDS || (item.Type !== 'Movie' && item.Type !== 'Episode')) return undefined;
  // Episodes Jellyfin knows of but has no file for ("missing" ones): nothing to play.
  if (item.LocationType === 'Virtual') return undefined;
  const episode = item.Type === 'Episode';
  const image = episode
    ? (jfImage(item.Id, 'Primary', item.ImageTags?.Primary, { maxWidth: 780 }) ??
      jfImage(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags?.[0], { maxWidth: 780 }))
    : (jfImage(item.Id, 'Backdrop', item.BackdropImageTags?.[0], { maxWidth: 780 }) ?? jfImage(item.Id, 'Thumb', item.ImageTags?.Thumb, { maxWidth: 780 }));
  return {
    id: item.Id,
    key: episode ? seriesKeys.get(item.SeriesId ?? '') : keyOf(item),
    type: item.Type,
    title: item.Name,
    seconds,
    genres: episode ? (seriesGenres.get(item.SeriesId ?? '') ?? []) : (item.Genres ?? []),
    seriesId: item.SeriesId,
    seriesTitle: item.SeriesName,
    season: item.ParentIndexNumber,
    episode: item.IndexNumber,
    year: item.ProductionYear,
    rating: item.OfficialRating,
    score: item.CommunityRating,
    image,
    added: item.DateCreated,
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

async function fetchLibrary(user: SessionUser): Promise<Library> {
  const token = tokenFor(user);
  const userId = config.jellyfin.apiKey ? undefined : user.id;
  const common = { userId, recursive: true, enableImageTypes: 'Primary,Backdrop,Thumb', imageTypeLimit: 1 };
  const [movies, series, episodes] = await Promise.all([
    jellyfin.items(token, { ...common, includeItemTypes: 'Movie', fields: 'Genres,DateCreated,ProviderIds' }),
    jellyfin.items(token, { ...common, includeItemTypes: 'Series', fields: 'Genres,ProviderIds' }),
    jellyfin.items(token, { ...common, includeItemTypes: 'Episode', fields: 'DateCreated', isMissing: false }),
  ]);
  return libraryFrom(movies, series, episodes);
}

/** What channels make of the library's films, shows and episodes. */
function libraryFrom(movies: { Items: JfItem[] }, series: { Items: JfItem[] }, episodes: { Items: JfItem[] }): Library {
  const seriesGenres = new Map(series.Items.map((s) => [s.Id, s.Genres ?? []]));
  const seriesKeys = new Map(series.Items.map((s) => [s.Id, keyOf(s)]));
  const movieList = movies.Items.map((i) => toProgram(i, seriesGenres, seriesKeys)).filter((p): p is Program => Boolean(p));
  // Specials (season 0) are out: they're rarely what anyone wants on a channel.
  const episodeList = episodes.Items.map((i) => toProgram(i, seriesGenres, seriesKeys)).filter((p): p is Program => Boolean(p) && (p!.season ?? 1) > 0);
  const bySeries = new Map<string, Program[]>();
  for (const e of episodeList) if (e.seriesId) bySeries.set(e.seriesId, [...(bySeries.get(e.seriesId) ?? []), e]);
  for (const list of bySeries.values()) list.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));

  const shows = series.Items.filter((s) => bySeries.has(s.Id));
  const toons = shows.filter((s) => has(s.Genres ?? [], ANIMATION));
  const idsOf = (list: JfItem[]) => list.map((s) => s.Id);
  const childish = (s: JfItem) => forChildren({ genres: s.Genres ?? [], rating: s.OfficialRating });
  const best = <T extends { score?: number }>(list: T[]) => [...list].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const nice = (genres: string[]) => has(genres, DOCUMENTARY) && !has(genres, GRIM);
  const evening = movieList.filter((m) => !has(m.genres, ANIMATION) && !has(m.genres, KIDS) && !has(m.genres, DOCUMENTARY));
  const lib: Library = {
    at: Date.now(),
    byId: new Map(),
    movies: movieList,
    episodes: episodeList,
    bySeries,
    series: series.Items.map((s) => ({ id: s.Id, name: s.Name, genres: s.Genres ?? [], rating: s.OfficialRating, key: keyOf(s) })),
    kinds: {
      toons: idsOf(toons),
      kidsToons: idsOf(toons.filter((s) => childish(s) || !has(s.Genres ?? [], COMEDY))),
      // The Simpsons, Family Guy: animated comedy, not for children.
      adultToons: idsOf(toons.filter((s) => has(s.Genres ?? [], COMEDY) && !childish(s))),
      sitcoms: idsOf(shows.filter((s) => has(s.Genres ?? [], COMEDY) && !has(s.Genres ?? [], ANIMATION) && median(bySeries.get(s.Id)!.map((e) => e.seconds)) <= SITCOM_MAX)),
      shows: idsOf(shows),
      films: movieList.map((m) => m.id),
      // A grown-up film for 9pm: not a cartoon, not a children's film, not a documentary (they have nights of their own).
      eveningFilms: evening.map((m) => m.id),
      bigFilms: best(evening)
        .slice(0, Math.max(5, Math.ceil(evening.length / 2)))
        .map((m) => m.id),
      animatedFilms: movieList.filter((m) => has(m.genres, ANIMATION)).map((m) => m.id),
      lightFilms: movieList.filter((m) => light(m.genres)).map((m) => m.id),
      docShows: best(shows.filter((s) => nice(s.Genres ?? [])).map((s) => ({ id: s.Id, score: s.CommunityRating }))).map((s) => s.id),
      docFilms: best(movieList.filter((m) => nice(m.genres))).map((m) => m.id),
    },
  };
  for (const p of [...lib.movies, ...lib.episodes]) lib.byId.set(p.id, p);
  return lib;
}

/** The library, refreshed every half hour (what's added joins the schedule as it's extended). */
async function getLibrary(user: SessionUser, fresh = false): Promise<Library> {
  if (library && !fresh && Date.now() - library.at < 30 * 60_000) return library;
  loading ??= fetchLibrary(user).finally(() => (loading = undefined));
  library = await loading;
  return library;
}

// ---------- New titles: in the guide before they're here ----------

/** Stand-ins for new titles not downloaded yet: `fresh:movie-1`, `fresh:tv-2` (a show), `fresh:tv-2:1:3` (an episode). */
const PLACEHOLDER = 'fresh:';
const isPlaceholder = (id: string) => id.startsWith(PLACEHOLDER);
const placeholderKey = (id: string) => id.split(':')[1];

const realHas = (lib: Library, key: string) =>
  key.startsWith('movie-')
    ? lib.movies.some((m) => m.key === key && !isPlaceholder(m.id))
    : lib.series.some((x) => x.key === key && !isPlaceholder(x.id) && lib.bySeries.has(x.id));

/**
 * The library, and what's planned but not downloaded yet: stand-ins with TMDB's details, so a
 * new title is in the guide days before it's here. Swapped for the real thing once it is.
 */
let merged: { lib: Library; version: string; out: Library } | undefined;
function withPlans(lib: Library): Library {
  const plans = freshPlans();
  const version = JSON.stringify(plans.map((p) => [p.key, p.channelId]));
  if (merged?.lib === lib && merged.version === version) return merged.out;
  const out: Library = { ...lib, byId: new Map(lib.byId), bySeries: new Map(lib.bySeries), movies: [...lib.movies], episodes: [...lib.episodes], series: [...lib.series] };
  const added = (plan: FreshPlan) => new Date(plan.added).toISOString();
  for (const plan of plans) {
    if (realHas(lib, plan.key)) continue;
    const id = `${PLACEHOLDER}${plan.key}`;
    if (plan.mediaType === 'movie') {
      const p: Program = { id, key: plan.key, type: 'Movie', title: plan.title, seconds: plan.seconds, genres: plan.genres, year: plan.year, image: plan.image, added: added(plan) };
      out.byId.set(id, p);
      out.movies.push(p);
      continue;
    }
    const episodes = (plan.episodes ?? []).map(
      (e): Program => ({
        id: `${id}:${e.season}:${e.episode}`,
        key: plan.key,
        type: 'Episode',
        title: e.title,
        seconds: e.seconds,
        genres: plan.genres,
        seriesId: id,
        seriesTitle: plan.title,
        season: e.season,
        episode: e.episode,
        year: plan.year,
        image: e.image,
        added: added(plan),
      }),
    );
    for (const e of episodes) out.byId.set(e.id, e);
    out.episodes.push(...episodes);
    out.bySeries.set(id, episodes);
    out.series.push({ id, name: plan.title, genres: plan.genres, key: plan.key });
  }
  merged = { lib, version, out };
  return out;
}

/**
 * What one channel may play. A new title (brought in for a channel) is on that channel only:
 * first in line from the time it's planned for, until all of it is in the schedule; then on
 * none, until it's deleted. One that isn't downloaded yet (a stand-in) goes in only a while
 * ahead, and not again once it has missed its slot.
 */
function viewFor(lib: Library, channelId: string, sched: Schedule | undefined, now: number): Library {
  const plans = new Map(freshPlans().map((p) => [p.key, p]));
  const retired = freshRetired();
  if (!plans.size && !retired.size) return lib;
  const done = sched?.freshDone ?? {};
  const missed = new Set(sched?.freshMissed ?? []);
  const keyOfId = (id: string) => lib.byId.get(id)?.key ?? lib.series.find((x) => x.id === id)?.key;
  const mine = (id: string) => {
    const key = keyOfId(id);
    const plan = key ? plans.get(key) : undefined;
    return Boolean(plan && plan.channelId === channelId && !done[key!] && !(isPlaceholder(id) && missed.has(key!)));
  };
  const ok = (id: string) => {
    const key = keyOfId(id);
    if (!key) return true;
    if (retired.has(key)) return false;
    // Not new (or kept by someone): anyone's.
    if (!plans.has(key)) return !isPlaceholder(id);
    return mine(id);
  };
  const kinds = Object.fromEntries(Object.entries(lib.kinds).map(([kind, ids]) => [kind, ids.filter(ok)])) as Library['kinds'];
  const films = lib.movies.filter((m) => mine(m.id));
  const shows = lib.series.filter((x) => mine(x.id));
  // Stand-ins sorted into kinds the way the library's own are.
  for (const m of films.filter((x) => isPlaceholder(x.id))) {
    kinds.films.push(m.id);
    if (light(m.genres)) kinds.lightFilms.push(m.id);
    if (has(m.genres, ANIMATION)) kinds.animatedFilms.push(m.id);
    else if (has(m.genres, DOCUMENTARY)) {
      if (!has(m.genres, GRIM)) kinds.docFilms.push(m.id);
    } else if (!has(m.genres, KIDS)) kinds.eveningFilms.push(m.id), kinds.bigFilms.push(m.id);
  }
  for (const x of shows.filter((y) => isPlaceholder(y.id))) {
    kinds.shows.push(x.id);
    const minutes = median(lib.bySeries.get(x.id)?.map((e) => e.seconds) ?? []);
    if (has(x.genres, ANIMATION)) {
      kinds.toons.push(x.id);
      if (has(x.genres, CHILDREN) || !has(x.genres, COMEDY)) kinds.kidsToons.push(x.id);
      if (has(x.genres, COMEDY) && !has(x.genres, CHILDREN)) kinds.adultToons.push(x.id);
    } else if (has(x.genres, COMEDY) && minutes <= SITCOM_MAX) kinds.sitcoms.push(x.id);
    if (has(x.genres, DOCUMENTARY) && !has(x.genres, GRIM)) kinds.docShows.push(x.id);
  }
  const notBefore = new Map([...films, ...shows].map((p) => [p.id, plans.get(p.key!)!.notBefore]));
  return {
    ...lib,
    kinds,
    movies: lib.movies.filter((m) => ok(m.id)),
    series: lib.series.filter((x) => ok(x.id)),
    fresh: { films: films.map((m) => m.id), shows: shows.map((x) => x.id) },
    held: new Set([...films, ...shows].map((p) => p.id)),
    notBefore,
    soon: now + 2 * 3600_000,
  };
}

/**
 * A new title may go in the slot being filled: its time has come (a slot may start a few minutes
 * early: nine o'clock at ten to), and for a stand-in, not too close.
 */
const dueNow = (lib: Library, id: string) =>
  (lib.notBefore?.get(id) ?? 0) <= (lib.slot ?? 0) + SLACK * 60_000 && (!isPlaceholder(id) || (lib.slot ?? 0) >= (lib.soon ?? 0));

/** Without this channel's new titles (they only go on as new). */
const usual = (lib: Library, ids: string[]) => (lib.held?.size ? ids.filter((id) => !lib.held!.has(id)) : ids);

/**
 * Takes a schedule back to `cut`: what starts from then is made again. What it had used up is
 * given back (shows rewind to the first episode taken out), so nothing is skipped.
 */
function truncate(sched: Schedule, lib: Library, cut: number): boolean {
  const i = sched.entries.findIndex((e) => e.start >= cut);
  if (i < 0) return false;
  const removed = sched.entries.slice(i);
  sched.entries = sched.entries.slice(0, i);
  const rewound = new Set<string>();
  for (const e of removed) {
    const p = lib.byId.get(e.itemId);
    if (!p) continue;
    if (p.seriesId) {
      const cursor = e.track ? `${e.track}:${p.seriesId}` : p.seriesId;
      if (rewound.has(cursor)) continue;
      rewound.add(cursor);
      const index = lib.bySeries.get(p.seriesId)?.findIndex((x) => x.id === p.id) ?? -1;
      if (index >= 0) sched.next[cursor] = index;
    } else if ((sched.films?.[p.id] ?? 0) >= cut) delete sched.films![p.id];
  }
  // A new title is all in only while the entry that finished it is still there.
  const ends = new Set(sched.entries.map((e) => e.start + e.seconds * 1000));
  for (const [key, end] of Object.entries(sched.freshDone ?? {})) if (!ends.has(end)) delete sched.freshDone![key];
  sched.pair = undefined;
  return true;
}

// ---------- Taking turns ----------

const sourceKey = (source: ChannelSource) => JSON.stringify(source);
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

function shuffle(ids: string[], seed: number): string[] {
  const out = [...ids].sort();
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The next one from a list, each going round once before any comes back (a new shuffle every
 * round, not starting with the one just played). What's added to the library joins the round;
 * what's gone leaves it.
 */
function draw(sched: Schedule, name: string, ids: string[]): string | undefined {
  if (!ids.length) return undefined;
  const seed = sched.seed + hash(name);
  let round = sched.rounds[name];
  const present = new Set(ids);
  if (!round || round.order.length !== ids.length || round.order.some((id) => !present.has(id))) {
    const kept = round ? round.order.filter((id) => present.has(id)) : [];
    const cursor = round ? round.order.slice(0, round.cursor).filter((id) => present.has(id)).length : 0;
    const fresh = ids.filter((id) => !kept.includes(id));
    round = { order: [...kept, ...shuffle(fresh, seed + kept.length)], cursor, cycle: round?.cycle ?? 0 };
    sched.rounds[name] = round;
  }
  if (round.cursor >= round.order.length) {
    round.cycle += 1;
    round.cursor = 0;
    const last = round.order.at(-1);
    round.order = shuffle(round.order, seed + round.cycle);
    if (round.order.length > 1 && round.order[0] === last) round.order.push(round.order.shift()!);
  }
  return round.order[round.cursor++];
}

/**
 * The next episode of a show, where it left off (back to the first after the last). `track`:
 * a run of its own, as the evening line-up has (reruns elsewhere in the day keep theirs).
 */
function nextEpisode(sched: Schedule, lib: Library, showId: string, take = true, track = ''): Program | undefined {
  const list = lib.bySeries.get(showId);
  if (!list?.length) return undefined;
  const key = track ? `${track}:${showId}` : showId;
  const i = (sched.next[key] ?? 0) % list.length;
  if (take) sched.next[key] = i + 1;
  return list[i];
}

/** An episode from a set of shows: a different show each time, each carrying on where it left off. */
function episodeFrom(sched: Schedule, lib: Library, name: string, shows: string[]): Program | undefined {
  // A show new on this channel: every other turn, from the start, until it's all been on.
  const fresh = lib.fresh?.shows.find((id) => shows.includes(id) && dueNow(lib, id));
  if (fresh) {
    sched.freshTurn = (sched.freshTurn ?? 0) + 1;
    if (sched.freshTurn % 2) return nextEpisode(sched, lib, fresh);
  }
  const pool = usual(lib, shows);
  let show = draw(sched, `${name}:shows`, pool);
  // Not the show that's just been on (its two episodes are enough): the next in turn instead.
  if (show && show === sched.lastShow && pool.length > 1) show = draw(sched, `${name}:shows`, pool);
  return show ? nextEpisode(sched, lib, show) : undefined;
}

/** The longest next episode, among these shows, that ends in time (`room` seconds). */
function fitting(sched: Schedule, lib: Library, room: number, shows: string[]): Program | undefined {
  let best: Program | undefined;
  const pool = [...new Set(usual(lib, shows))];
  // Not the show that's just been on, when another will do.
  const others = pool.filter((id) => id !== sched.lastShow);
  for (const show of others.length ? others : pool) {
    const ep = nextEpisode(sched, lib, show, false);
    if (ep && ep.seconds <= room && (!best || ep.seconds > best.seconds)) best = ep;
  }
  if (best?.seriesId) nextEpisode(sched, lib, best.seriesId);
  return best;
}

/**
 * A film from a list, in its turn, but none this channel has shown in the past week (with
 * few films, none from the last three days), whichever list it was in then.
 */
function film(sched: Schedule, lib: Library, name: string, ids: string[], at: number): Program | undefined {
  // A film new on this channel: the first slot that suits it (on Netfish's own, nine o'clock:
  // not the middle of the night, nor one o'clock).
  const fresh = lib.fresh?.films.find((id) => ids.includes(id) && dueNow(lib, id));
  if (fresh && !['night', 'matinee', 'noon', 'day'].includes(name)) return lib.byId.get(fresh);
  ids = usual(lib, ids);
  const since = (id: string) => at - (sched.films?.[id] ?? -Infinity);
  let first: string | undefined;
  let fallback: string | undefined;
  for (let i = 0; i < ids.length; i++) {
    const id = draw(sched, name, ids);
    if (!id) break;
    first ??= id;
    if (since(id) > 7 * DAY) return lib.byId.get(id);
    if (!fallback && since(id) > 3 * DAY) fallback = id;
  }
  return lib.byId.get(fallback ?? first ?? '');
}

// ---------- The time of day (Netfish's own channel) ----------

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Minutes past midnight, where the household is. */
function localMinutes(at: number, timeZone: string): number {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(at);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
}

const weekdays = new Map<string, Intl.DateTimeFormat>();
/** 0 (Sunday) to 6, where the household is. */
function localDay(at: number, timeZone: string): number {
  let f = weekdays.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
    weekdays.set(timeZone, f);
  }
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(f.format(at));
}

/**
 * Netfish's own day: one o'clock, sitcoms from three, grown-up cartoons from six, the film at nine.
 * Each may land a few minutes either side (rather than a long wait).
 */
const MATINEE = 13 * 60;
const SITCOMS = 15 * 60;
const CARTOONS = 18 * 60;
const PRIME = 21 * 60;
const SLACK = 10;
/** By day, programmes start on the quarter hour, like TV's (a break of up to a quarter of an hour between them). */
const QUARTER = 15 * 60_000;
/** By day, a break this long (or shorter) rather than the sitcoms or cartoons before their time, or a repeat. */
const LONG_BREAK = 45;
/** Its day runs from six in the morning to six the next: nothing is on twice in one. */
const DAY_START = 6 * 60;
/** Newly in the library, for this long: on the channel before the rest. */
const NEW_FOR = 14 * DAY;
/** Nine o'clock through the week: films, documentaries on Tuesday and Sunday, the best films at the weekend. */
const NINE: Array<'documentary' | 'film' | 'big'> = ['documentary', 'film', 'documentary', 'film', 'film', 'big', 'big'];

type Pick = { program: Program; track?: string } | { waitUntil: number } | undefined;

/** Shows, the longest-running first (six o'clock opens with the same one every evening). */
const longest = (lib: Library, ids: string[]) => [...usual(lib, ids)].sort((a, b) => (lib.bySeries.get(b)?.length ?? 0) - (lib.bySeries.get(a)?.length ?? 0));

/** Without children's shows: Netfish's own channel is for grown-ups (they have the Cartoons channel). */
function grownUpShows(lib: Library, ids: string[]): string[] {
  return ids.filter((id) => {
    const show = lib.series.find((x) => x.id === id);
    return !show || !forChildren(show);
  });
}

/**
 * A documentary: a series, one episode a night in order (all of Our Planet before the next one,
 * best-rated first), or, on Tuesdays and when there are no series (or it's been on today at one), a
 * documentary film.
 */
function documentary(sched: Schedule, lib: Library, at: number, day: number, onToday: Set<string>): Program | undefined {
  const shows = usual(lib, lib.kinds.docShows);
  const films = lib.kinds.docFilms.filter((id) => !onToday.has(id));
  if (shows.length && (day === 0 || !films.length)) {
    const i = sched.next['doc:show'] ?? 0;
    const show = shows[i % shows.length];
    if (!onToday.has(show) || !films.length) {
      const list = lib.bySeries.get(show)!;
      const last = ((sched.next[show] ?? 0) % list.length) === list.length - 1;
      const episode = nextEpisode(sched, lib, show);
      if (last) sched.next['doc:show'] = i + 1;
      return episode;
    }
  }
  return film(sched, lib, 'documentaries', films, at);
}

/**
 * Weekdays at one: a documentary. A series' next episode, in order, on a run of its own (from the
 * second-best series: Sunday nights start with the best), else a documentary film.
 */
function noonDocumentary(sched: Schedule, lib: Library, at: number, onToday: Set<string>): Pick {
  // A nature series new on the channel: one a weekday, from the first, until it's all been on.
  const fresh = lib.fresh?.shows.find((id) => lib.kinds.docShows.includes(id) && dueNow(lib, id) && !onToday.has(id));
  const first = fresh && nextEpisode(sched, lib, fresh);
  if (first) return { program: first };
  const shows = usual(lib, lib.kinds.docShows);
  if (shows.length) {
    const order = [...shows.slice(1), shows[0]];
    const i = sched.next['noon:turn'] ?? 0;
    const show = order[i % order.length];
    if (!onToday.has(show)) {
      const list = lib.bySeries.get(show)!;
      const last = (sched.next[`noon:${show}`] ?? 0) % list.length === list.length - 1;
      const episode = nextEpisode(sched, lib, show, true, 'noon');
      if (last) sched.next['noon:turn'] = i + 1;
      if (episode) return { program: episode, track: 'noon' };
    }
  }
  const doc = film(sched, lib, 'noon', lib.kinds.docFilms.filter((id) => !onToday.has(id)), at);
  return doc ? { program: doc } : undefined;
}

/**
 * Netfish's own channel: a day of slots, like a network's, for grown-ups (nothing made for
 * children: they have the Cartoons channel). New things first (a new title, then what's newly
 * in the library) and nothing twice in a day (six to six): a show is on once (a short one for two
 * episodes back to back), a film once.
 *   06:00 films and the shows that aren't sitcoms or cartoons (dramas, thrillers), taking turns
 *   · 13:00 a documentary (a film at weekends) · 15:00 sitcoms · 18:00 grown-up cartoons (the
 *   longest-running first, the same every evening) · 21:00 the film (or documentary) · then
 *   what hasn't been on (late-night animation, comedy, drama), a late film some nights.
 * Each slot lands on the next one's time, borrowing from the others when its own shows have all
 * been on today; only when everything has does something come round again.
 */
function mix(sched: Schedule, lib: Library, at: number, timeZone: string): Pick {
  const k = lib.kinds;
  const m = localMinutes(at, timeZone);
  const day = localDay(at, timeZone);
  const weekend = day === 0 || day === 6;
  // The start of this minute, so "until nine" lands on 21:00:00; and when today's times are.
  const minute = at - (at % 60_000);
  const today = (time: number) => minute + (time - m) * 60_000;
  const roomUntil = (time: number) => (time - m) * 60 - (at % 60_000) / 1000 - BREAK_SECONDS;
  // By day (six to three), on the quarter hour (a minute past is near enough). Not the second of
  // two episodes: that follows the first straight away (pick).
  const pastQuarter = at % QUARTER;
  if (m >= DAY_START && m < SITCOMS && pastQuarter > 60_000) return { waitUntil: at - pastQuarter + QUARTER };

  // What's been on since six this morning (since six yesterday, before then): not again today.
  // Counted back in minutes, six o'clock is an hour out the day the clocks change: put right.
  const roughStart = today(DAY_START) - (m < DAY_START ? DAY : 0);
  const dayStart = roughStart - (localMinutes(roughStart, timeZone) - DAY_START) * 60_000;
  const onToday = new Set(
    sched.entries
      .filter((e) => e.start >= dayStart && e.start < at)
      .flatMap((e) => {
        const p = lib.byId.get(e.itemId);
        return p ? [p.seriesId ?? p.id] : [];
      }),
  );
  const notToday = (ids: string[]) => ids.filter((id) => !onToday.has(id));

  const genresOf = (id: string) => lib.byId.get(id)?.genres ?? [];
  const toons = grownUpShows(lib, k.toons);
  const cartoons = k.adultToons.length ? grownUpShows(lib, k.adultToons) : toons;
  const sitcoms = k.sitcoms;
  // The other shows: dramas, thrillers, comedies that aren't sitcoms (no children's shows, no documentaries).
  const others = grownUpShows(lib, k.shows).filter((id) => !k.toons.includes(id) && !sitcoms.includes(id) && !k.docShows.includes(id));
  // Films for grown-ups: the evening's (no cartoons, children's films or documentaries); light ones by day.
  const grownUpFilms = k.eveningFilms.length ? k.eveningFilms : k.films.filter((id) => !k.docFilms.includes(id));
  const lightFilms = k.lightFilms.filter((id) => !has(genresOf(id), [...KIDS, ...ANIMATION]));

  /** New to the channel: newly in the library (the last two weeks), and not on it yet. */
  const newest = (ids: string[]): Program | undefined => {
    for (const id of usual(lib, ids)) {
      const episodes = lib.bySeries.get(id);
      if (episodes) {
        if (sched.next[id] === undefined && episodes.some((e) => Date.parse(e.added ?? '') > at - NEW_FOR)) return nextEpisode(sched, lib, id);
      } else if (sched.films?.[id] === undefined && Date.parse(lib.byId.get(id)?.added ?? '') > at - NEW_FOR) return lib.byId.get(id);
    }
    return undefined;
  };
  /** An episode from these shows, none on today: a new title's, something new to the channel, else the next in turn. */
  const episodeOf = (name: string, shows: string[]): Program | undefined => {
    const ids = notToday(shows);
    if (!ids.length) return undefined;
    const fresh = lib.fresh?.shows.find((id) => ids.includes(id) && dueNow(lib, id));
    if (fresh) return nextEpisode(sched, lib, fresh);
    return newest(ids) ?? episodeFrom(sched, lib, name, ids);
  };
  /** A film from these, not on today: a new title (at nine), something new to the channel, else one in turn. */
  const filmOf = (name: string, films: string[]): Program | undefined => {
    const ids = notToday(films);
    if (!ids.length) return undefined;
    const fresh = lib.fresh?.films.some((id) => ids.includes(id) && dueNow(lib, id));
    return (!fresh && newest(ids)) || film(sched, lib, name, ids, at);
  };
  /** Anything that hasn't been on today (a show, then a film); if everything has, what comes round next. */
  const anything = () =>
    episodeOf('any', grownUpShows(lib, k.shows)) ??
    filmOf('films', grownUpFilms) ??
    episodeFrom(sched, lib, 'any', grownUpShows(lib, k.shows)) ??
    film(sched, lib, 'films', grownUpFilms, at);
  const program = (p: Program | undefined): Pick => {
    const chosen = p ?? anything();
    return chosen ? { program: chosen } : undefined;
  };
  /**
   * Something from these shows (then from `spare`), not on today, that ends by `time` (or a
   * little after); else a wait until just before it ("Coming up at 21:00"). By day, on the time
   * itself (breaks can be longer), and a break of up to LONG_BREAK before anything from `spare`.
   */
  const landOn = (time: number, shows: string[], spare: string[]): Pick => {
    const byDay = time <= SITCOMS;
    const room = roomUntil(time) + (byDay ? 0 : SLACK * 60);
    const fit = fitting(sched, lib, room, notToday(shows)) ?? (!byDay || roomUntil(time) > LONG_BREAK * 60 ? fitting(sched, lib, room, notToday(spare)) : undefined);
    return fit ? { program: fit } : { waitUntil: today(byDay ? time : time - SLACK) };
  };
  /** Films that end by `time`: one on by day mustn't run into the next slot. */
  const endingBy = (ids: string[], time: number) => ids.filter((id) => (lib.byId.get(id)?.seconds ?? Infinity) <= roomUntil(time));
  /** By day: films and the other shows, taking turns (a film only if it ends before the next slot). */
  const daytime = (until: number): Program | undefined => {
    sched.turn += 1;
    const show = () => episodeOf('other', others);
    const aFilm = () => filmOf('day', endingBy(lightFilms.length >= 5 ? lightFilms : grownUpFilms, until));
    return sched.turn % 2 ? (show() ?? aFilm()) : (aFilm() ?? show());
  };

  // Nine o'clock: a film, a documentary, or at the weekend the best films (a new one first).
  if (m >= PRIME - SLACK && m < PRIME + 30 && (k.films.length || k.docShows.length)) {
    const kind = NINE[day];
    if (kind === 'documentary' && (k.docShows.length || k.docFilms.length)) return program(documentary(sched, lib, at, day, onToday));
    if (kind === 'big' && k.bigFilms.length) return program(filmOf('big', k.bigFilms) ?? filmOf('evening', grownUpFilms));
    return program(filmOf('evening', k.eveningFilms.length ? k.eveningFilms : k.films));
  }
  // From six: grown-up cartoons, opening with the longest-running one (the same every evening), landing on nine.
  if (m >= CARTOONS - SLACK && m < PRIME - SLACK) {
    if (roomUntil(PRIME) < 75 * 60) return landOn(PRIME, cartoons, [...toons, ...sitcoms, ...others]);
    const opener = m < CARTOONS + SLACK ? longest(lib, notToday(cartoons))[0] : undefined;
    return program((opener && nextEpisode(sched, lib, opener)) || episodeOf('evening', cartoons));
  }
  // From three: sitcoms, landing on six.
  if (m >= SITCOMS - SLACK && m < CARTOONS - SLACK) {
    if (roomUntil(CARTOONS) < 75 * 60) return landOn(CARTOONS, sitcoms, others);
    return program(episodeOf('sitcoms', sitcoms));
  }
  // After the film, until one: what hasn't been on (late-night animation, comedy, drama).
  if (m >= PRIME || m < 60) return program(episodeOf('late', [...toons, ...others, ...sitcoms]));
  // Overnight: a late film (with fewer than 30 films, only on Friday and Saturday nights, so they
  // stay fresh for nine o'clock), then what hasn't been on.
  if (m < DAY_START) {
    const filmTonight = sched.entries.some((e) => e.start >= today(60) - SLACK * 60_000 && e.start < at && !lib.byId.get(e.itemId)?.seriesId);
    const lateFilm = grownUpFilms.length >= 30 || day === 6 || day === 0;
    if (lateFilm && !filmTonight) return program(filmOf('night', grownUpFilms));
    return program(episodeOf('night', [...others, ...toons, ...sitcoms]));
  }
  // One o'clock: a documentary in the week, a film at the weekend (a comedy, an adventure).
  const atOne = weekend ? lightFilms.length > 0 : k.docShows.length + k.docFilms.length > 0;
  if (atOne && m >= MATINEE - SLACK && m < MATINEE + 30) {
    const ending = endingBy(lightFilms, SITCOMS);
    const one = weekend ? program(filmOf('matinee', ending.length ? ending : lightFilms)) : noonDocumentary(sched, lib, at, onToday);
    if (one) return one;
  }
  // By day, landing on one o'clock, then on the sitcoms at three (the cartoons and sitcoms kept for their slots if possible).
  if (m < MATINEE && atOne && roomUntil(MATINEE) < 75 * 60) return landOn(MATINEE, others, [...toons, ...sitcoms]);
  if (m >= MATINEE && roomUntil(SITCOMS) < 75 * 60) return landOn(SITCOMS, others, [...toons, ...sitcoms]);
  return program(daytime(m < MATINEE && atOne ? MATINEE : SITCOMS));
}

// ---------- What each channel plays ----------

function filmsOf(source: Extract<ChannelSource, { kind: 'films' }>, lib: Library) {
  const want = source.genres.map((g) => g.toLowerCase());
  const avoid = (source.avoid ?? []).map((g) => g.toLowerCase());
  return lib.movies.filter((m) => has(m.genres, want) && !has(m.genres, avoid)).map((m) => m.id);
}

/** Whether a show's episodes are short enough to come in twos. */
const short = (lib: Library, showId?: string) => Boolean(showId && median(lib.bySeries.get(showId)?.map((e) => e.seconds) ?? []) < PAIR_MAX);

/**
 * Can a second episode go in now? Not one of a pair begun before one o'clock, the sitcoms, the
 * cartoons or nine o'clock that would start in that slot or run into it (the slot plays its own).
 */
function roomForSecond(def: ChannelDef, program: Program, at: number, timeZone: string, firstStart: number): boolean {
  if (def.source.kind !== 'mix') return true;
  const m = localMinutes(at, timeZone);
  const began = localMinutes(firstStart, timeZone);
  const ends = m + program.seconds / 60;
  for (const time of [MATINEE, SITCOMS, CARTOONS, PRIME]) {
    if (began < time - SLACK && m < time + 60 && (m >= time - SLACK || ends > time + SLACK)) return false;
  }
  return !(m >= PRIME - SLACK && m < PRIME + 30);
}

/**
 * What's on next. Short shows come in twos: after the first episode, the second straight
 * after (when it fits before the evening line-up or nine o'clock).
 */
function pick(def: ChannelDef, sched: Schedule, lib: Library, at: number, timeZone: string): Pick {
  if (sched.pair) {
    const [show, track] = sched.pair.split(':').reverse();
    sched.pair = undefined;
    const second = nextEpisode(sched, lib, show, false, track);
    // Not round to the start of a new show again: it's been on.
    const over = lib.fresh?.shows.includes(show) && (sched.next[show] ?? 0) >= (lib.bySeries.get(show)?.length ?? 0);
    if (second && !over && roomForSecond(def, second, at, timeZone, sched.entries.at(-1)?.start ?? at)) {
      nextEpisode(sched, lib, show, true, track);
      return { program: second, track };
    }
  }
  const next = pickOne(def, sched, lib, at, timeZone);
  if (next && 'program' in next && next.program.type === 'Episode' && def.source.kind !== 'series' && short(lib, next.program.seriesId)) {
    sched.pair = next.track ? `${next.track}:${next.program.seriesId}` : next.program.seriesId;
  }
  return next;
}

function pickOne(def: ChannelDef, sched: Schedule, lib: Library, at: number, timeZone: string): Pick {
  const source = def.source;
  const one = (p: Program | undefined): Pick => (p ? { program: p } : undefined);
  switch (source.kind) {
    case 'mix':
      return mix(sched, lib, at, timeZone);
    case 'cartoons':
      // Cartoons, with an animated film every few.
      sched.turn += 1;
      if (sched.turn % 5 === 0 && lib.kinds.animatedFilms.length) return one(film(sched, lib, 'films', lib.kinds.animatedFilms, at));
      return one(episodeFrom(sched, lib, 'toons', lib.kinds.toons) ?? film(sched, lib, 'films', lib.kinds.animatedFilms, at));
    case 'sitcoms':
      return one(episodeFrom(sched, lib, 'sitcoms', lib.kinds.sitcoms));
    case 'films':
      return one(film(sched, lib, 'films', filmsOf(source, lib), at));
    case 'genre': {
      const genre = [source.genre.toLowerCase()];
      const films = source.movies ? lib.movies.filter((p) => has(p.genres, genre)).map((p) => p.id) : [];
      const shows = source.episodes ? lib.series.filter((s) => lib.bySeries.has(s.id) && has(s.genres, genre)).map((s) => s.id) : [];
      // Both: a film, then two episodes, and round again.
      if (films.length && shows.length) {
        sched.turn += 1;
        return one(sched.turn % 3 === 1 ? film(sched, lib, 'films', films, at) : episodeFrom(sched, lib, 'shows', shows));
      }
      return one(films.length ? film(sched, lib, 'films', films, at) : episodeFrom(sched, lib, 'shows', shows));
    }
    case 'series':
      return one(nextEpisode(sched, lib, source.seriesId));
    case 'recent':
      return one(film(sched, lib, 'films', [...lib.movies].sort((a, b) => (b.added ?? '').localeCompare(a.added ?? '')).slice(0, 40).map((p) => p.id), at));
    case 'shows':
      return one(episodeFrom(sched, lib, 'shows', lib.kinds.shows));
  }
}

/** Fills the channel's schedule to two days ahead, and lets go of what's long over. */
/**
 * Stand-ins whose title is here now: the real thing, at the same time (a show carries on with
 * its real episodes where the stand-ins left off). A different length: what follows is made again.
 */
function resolve(sched: Schedule, lib: Library): boolean {
  let changed = false;
  let cut: number | undefined;
  for (const e of sched.entries) {
    if (!isPlaceholder(e.itemId)) continue;
    const key = placeholderKey(e.itemId);
    if (!realHas(lib, key)) continue;
    let real: Program | undefined;
    if (key.startsWith('movie-')) real = lib.movies.find((m) => m.key === key && !isPlaceholder(m.id));
    else {
      const [season, episode] = e.itemId.split(':').slice(2).map(Number);
      const series = lib.series.find((x) => x.key === key && !isPlaceholder(x.id));
      real = series && lib.bySeries.get(series.id)?.find((p) => p.season === season && p.episode === episode);
      const standIn = `${PLACEHOLDER}${key}`;
      if (series && sched.next[standIn] !== undefined) {
        sched.next[series.id] ??= sched.next[standIn];
        delete sched.next[standIn];
      }
    }
    if (!real) continue;
    const end = e.start + e.seconds * 1000;
    e.itemId = real.id;
    changed = true;
    if (Math.abs(real.seconds - e.seconds) > 60) {
      e.seconds = real.seconds;
      if (sched.freshDone?.[key] === end) sched.freshDone[key] = e.start + real.seconds * 1000;
      cut ??= e.start + 1;
    }
  }
  if (cut !== undefined) truncate(sched, lib, cut);
  return changed;
}

function extend(def: ChannelDef, real: Library, now: number, timeZone: string): boolean {
  const lib = withPlans(real);
  const key = sourceKey(def.source);
  let sched = stored.schedules[def.id];
  let changed = false;
  if (!sched || sched.key !== key) {
    // New, or made from something else now: starts with a programme right away.
    sched = { key, plan: PLAN, seed: Math.floor(Math.random() * 2 ** 31), entries: [], rounds: {}, next: {}, turn: 0 };
    stored.schedules[def.id] = sched;
    changed = true;
  }
  // Made by older rules: what's on now and in the next quarter of an hour stays, the rest is made again.
  if (sched.plan !== PLAN) {
    truncate(sched, lib, now + 15 * 60_000);
    sched.plan = PLAN;
    changed = true;
  }
  const before = sched.entries.length;
  sched.entries = sched.entries.filter((e) => e.start + e.seconds * 1000 > now - KEEP_BEHIND);
  if (sched.entries.length !== before) changed = true;
  for (const [id, last] of Object.entries(sched.films ?? {})) if (last < now - 8 * DAY) delete sched.films![id];

  // Something deleted from the library since it went in the schedule: made again from there.
  const vanished = sched.entries.find((e) => e.start > now && !isPlaceholder(e.itemId) && !lib.byId.has(e.itemId));
  if (vanished && truncate(sched, lib, vanished.start)) changed = true;

  // New titles: the real thing for stand-ins whose title is here. One still not here an hour and a
  // half before its slot: something from the library instead (it goes on once it's here).
  if (resolve(sched, lib)) changed = true;
  const late = sched.entries.find((e) => isPlaceholder(e.itemId) && e.start > now && e.start - now < 90 * 60_000);
  if (late) {
    const missed = placeholderKey(late.itemId);
    log.warn('channels', `"${lib.byId.get(late.itemId)?.seriesTitle ?? lib.byId.get(late.itemId)?.title ?? missed}" isn't downloaded in time for its slot on ${def.name}: something from the library plays instead`);
    sched.freshMissed = [...new Set([...(sched.freshMissed ?? []), missed])];
    sched.freshRoom = sched.freshRoom?.filter((k) => k !== missed);
    truncate(sched, lib, late.start);
    changed = true;
  }
  const planned = new Set(freshPlans().map((p) => p.key));
  sched.freshMissed = sched.freshMissed?.filter((k) => planned.has(k));
  sched.freshRoom = sched.freshRoom?.filter((k) => planned.has(k));

  let view = viewFor(lib, def.id, sched, now);
  // A new title not in the guide yet whose time falls inside it: the guide is made again from
  // then (never the next six hours), so it's on when planned, not a week later. Once each.
  const keyOfId = (id: string) => lib.byId.get(id)?.key ?? lib.series.find((x) => x.id === id)?.key;
  const scheduled = new Set(sched.entries.map((e) => lib.byId.get(e.itemId)?.key));
  const tail = sched.entries.at(-1);
  const toPlace = [...(view.fresh?.films ?? []), ...(view.fresh?.shows ?? [])].filter((id) => {
    const k = keyOfId(id);
    return k && !scheduled.has(k) && !sched!.freshRoom?.includes(k);
  });
  if (toPlace.length && tail) {
    const cut = Math.min(...toPlace.map((id) => Math.max(view.notBefore?.get(id) ?? now, now + 6 * 3600_000)));
    sched.freshRoom = [...(sched.freshRoom ?? []), ...toPlace.map((id) => keyOfId(id)!)];
    if (cut < tail.start && truncate(sched, lib, cut)) view = viewFor(lib, def.id, sched, now);
    changed = true;
  }

  const last = sched.entries.at(-1);
  let at = last ? last.start + (last.seconds + BREAK_SECONDS) * 1000 : now;
  if (!last || at < now - KEEP_BEHIND) at = now; // switched off for a while: on again from now
  for (let guard = 0; at < now + AHEAD && guard < 5000; guard++) {
    view.slot = at;
    const next = pick(def, sched, view, at, timeZone);
    if (!next) break;
    if ('waitUntil' in next) {
      at = Math.max(next.waitUntil, at + 60_000);
      continue;
    }
    const program = next.program;
    sched.entries.push({ itemId: program.id, start: at, seconds: program.seconds, ...(next.track ? { track: next.track } : {}) });
    sched.lastShow = program.seriesId;
    if (!program.seriesId) (sched.films ??= {})[program.id] = at;
    const end = at + program.seconds * 1000;
    at = end + BREAK_SECONDS * 1000;
    changed = true;
    // A new title all in the schedule (a film, or a show's last episode): it'll have aired at `end`.
    const fresh = program.key && (view.fresh?.films.includes(program.id) || view.fresh?.shows.includes(program.seriesId ?? ''));
    if (fresh && (!program.seriesId || (sched.next[program.seriesId] ?? 0) >= (lib.bySeries.get(program.seriesId)?.length ?? 0))) {
      (sched.freshDone ??= {})[program.key!] = end;
      view = viewFor(lib, def.id, sched, now);
    }
  }
  return changed;
}

// ---------- New titles: what the fresh side asks ----------

const keyOfEntry = (e: Entry) => (isPlaceholder(e.itemId) ? placeholderKey(e.itemId) : library?.byId.get(e.itemId)?.key);

linkChannels({
  settings: () => stored.settings,
  airAt: (key) => {
    const now = Date.now();
    let first: number | undefined;
    for (const x of Object.values(stored.schedules)) {
      for (const e of x.entries) if (e.start + e.seconds * 1000 > now && (first === undefined || e.start < first) && keyOfEntry(e) === key) first = e.start;
    }
    return first;
  },
  missed: (key) => Object.values(stored.schedules).some((x) => x.freshMissed?.includes(key)),
  doneAt: (key) => {
    const times = Object.values(stored.schedules).flatMap((x) => (x.freshDone?.[key] ? [x.freshDone[key]] : []));
    return times.length ? Math.max(...times) : undefined;
  },
  onAir: (key) => {
    const now = Date.now();
    return Object.values(stored.schedules).some((x) => x.entries.some((e) => e.start - BREAK_SECONDS * 1000 <= now && now < e.start + e.seconds * 1000 && keyOfEntry(e) === key));
  },
  drop: (keys) => {
    const now = Date.now();
    const gone = new Set(keys);
    for (const x of Object.values(stored.schedules)) {
      // From the first time one would have been on, the schedule is made again (without them).
      const first = x.entries.find((e) => e.start > now && gone.has(keyOfEntry(e) ?? ''));
      if (first && library) truncate(x, withPlans(library), first.start);
      else if (first) x.entries = x.entries.filter((e) => e.start < first.start);
      for (const key of keys) delete x.freshDone?.[key];
      x.freshRoom = x.freshRoom?.filter((k) => !gone.has(k));
    }
    save();
  },
});

/** For telling the fresh side about a programme: its film's or show's key (a stand-in's too). */
export const keyOfItem = (itemId: string) => (isPlaceholder(itemId) ? placeholderKey(itemId) : library?.byId.get(itemId)?.key);

// ---------- Who's watching ----------

const watchers = new Map<string, Map<string, number>>();

/** A screen on a channel says so every half minute; it counts for a minute and a half, or until it says it's left. */
export function watching(channelId: string, clientId: string, leaving = false) {
  if (!stored.settings.channels.some((c) => c.id === channelId)) throw new HttpError(404, t('No such channel'));
  const id = typeof clientId === 'string' ? clientId.slice(0, 64) : '';
  if (!id) return;
  if (leaving) {
    watchers.get(channelId)?.delete(id);
    return;
  }
  for (const [, screens] of watchers) screens.delete(id); // on one channel at a time
  const screens = watchers.get(channelId) ?? new Map<string, number>();
  screens.set(id, Date.now());
  watchers.set(channelId, screens);
}

function watchingCount(channelId: string) {
  const screens = watchers.get(channelId);
  if (!screens) return 0;
  const since = Date.now() - 90_000;
  for (const [id, at] of screens) if (at < since) screens.delete(id);
  return screens.size;
}

// ---------- For screens ----------

function toChannelProgram(entry: Entry, program: Program, isNew = false): ChannelProgram {
  return {
    ...(isNew ? { isNew } : {}),
    itemId: entry.itemId,
    title: program.title,
    seriesTitle: program.type === 'Episode' ? program.seriesTitle : undefined,
    seasonNumber: program.type === 'Episode' ? program.season : undefined,
    episodeNumber: program.type === 'Episode' ? program.episode : undefined,
    year: program.year,
    rating: program.rating,
    image: program.image,
    start: entry.start,
    seconds: entry.seconds,
  };
}

const timeZone = () => stored.settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** How far ahead the guide can be looked at. */
export const GUIDE_AHEAD = 3 * 24 * 3600_000;

/**
 * Every channel: what's on now, and for the next `hours`; or, from `from` (up to three days
 * ahead), what's on then. `now`: for tests.
 */
export async function listChannels(user: SessionUser, hours = 4, now = Date.now(), from?: number): Promise<ChannelsResponse> {
  if (!stored.settings.enabled) throw new HttpError(404, t('Channels are off'));
  const real = await getLibrary(user);
  let changed = false;
  const visible = stored.settings.channels.filter((c) => !c.hidden).sort((a, b) => a.number - b.number);
  for (const def of visible) changed = extend(def, real, now, timeZone()) || changed;
  if (changed) save();
  const lib = withPlans(real);
  // The guide may look a little back too: it starts at the half hour 20 to 50 minutes ago, and
  // whatever is on from then comes (however long before it began), to fill the line up to now.
  // Three hours back at most (as far as schedules keep what's been on).
  const start = from && Number.isFinite(from) ? Math.min(Math.max(from, now - KEEP_BEHIND), now + GUIDE_AHEAD) : now;
  const until = start + Math.min(7 * 24, Math.max(1, hours)) * 3600_000;
  // New on a channel (it goes after it airs): not one someone asked for.
  const owners = new Map(freshPlans().flatMap((p) => (p.requested ? [] : [[p.key, p.channelId] as const])));
  const channels: Channel[] = visible.map((def) => {
    const entries = stored.schedules[def.id]?.entries ?? [];
    const programs = entries
      .filter((e) => e.start + e.seconds * 1000 > start && e.start < until)
      .flatMap((e) => {
        const program = lib.byId.get(e.itemId);
        return program ? [toChannelProgram(e, program, Boolean(program.key && owners.get(program.key) === def.id))] : [];
      });
    return { id: def.id, number: def.number, name: shownName(def.name), programs, watching: watchingCount(def.id) };
  });
  return { now, breakSeconds: BREAK_SECONDS, countWatched: stored.settings.countWatched, channels };
}

// ---------- Settings (admins) ----------

/**
 * A line-up from what the library has: Netfish's own channel first, then cartoons, sitcoms,
 * serious films, comedies, family films, science fiction and the newest films, each only if
 * there's enough for it.
 */
function automatic(lib: Library): ChannelDef[] {
  const k = lib.kinds;
  const episodes = (shows: string[]) => shows.reduce((n, id) => n + (lib.bySeries.get(id)?.length ?? 0), 0);
  const defs: Array<Omit<ChannelDef, 'number' | 'id'>> = [];
  if (lib.episodes.length || lib.movies.length) defs.push({ name: 'Netfish', source: { kind: 'mix' }, builtIn: true });
  if (episodes(k.toons) >= 6 || k.animatedFilms.length >= 3) defs.push({ name: t('Cartoons'), source: { kind: 'cartoons' } });
  if (episodes(k.sitcoms) >= 6) defs.push({ name: t('Sitcoms'), source: { kind: 'sitcoms' } });
  const lineup: Array<[string, Extract<ChannelSource, { kind: 'films' }>]> = [
    [t('Drama & thrillers'), { kind: 'films', genres: SERIOUS, avoid: [...COMEDY, ...ANIMATION, ...KIDS] }],
    [t('Comedy films'), { kind: 'films', genres: COMEDY, avoid: ANIMATION }],
    [t('Family films'), { kind: 'films', genres: [...KIDS, ...ANIMATION] }],
    [t('Sci-fi & fantasy'), { kind: 'films', genres: SCIFI, avoid: ANIMATION }],
  ];
  for (const [name, source] of lineup) if (filmsOf(source, lib).length >= 5) defs.push({ name, source });
  if (lib.movies.length >= 8) defs.push({ name: t('New arrivals'), source: { kind: 'recent' } });
  return defs.map((d, i) => ({ ...d, id: randomUUID().slice(0, 8), number: i + 1 }));
}

export async function channelAdmin(user: SessionUser): Promise<ChannelAdmin> {
  // What there is to make channels from: the library (new titles for channels aren't part of it).
  const hidden = freshHidden();
  const all = await getLibrary(user);
  const lib = hidden.size
    ? { ...all, movies: all.movies.filter((m) => !hidden.has(m.key ?? '')), episodes: all.episodes.filter((e) => !hidden.has(e.key ?? '')), series: all.series.filter((x) => !hidden.has(x.key ?? '')) }
    : all;
  const genres = new Map<string, { movies: number; episodes: number }>();
  for (const m of lib.movies) for (const g of m.genres) genres.set(g, { movies: (genres.get(g)?.movies ?? 0) + 1, episodes: genres.get(g)?.episodes ?? 0 });
  for (const e of lib.episodes) for (const g of e.genres) genres.set(g, { movies: genres.get(g)?.movies ?? 0, episodes: (genres.get(g)?.episodes ?? 0) + 1 });
  return {
    ...stored.settings,
    fresh: { ...FRESH_DEFAULTS, ...stored.settings.fresh },
    channels: stored.settings.channels.map((c) => ({ ...c, name: shownName(c.name) })),
    genres: [...genres.entries()].map(([name, n]) => ({ name, ...n })).sort((a, b) => a.name.localeCompare(b.name)),
    series: lib.series
      .filter((s) => lib.bySeries.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, episodes: lib.bySeries.get(s.id)!.length }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');
const names = (v: unknown) => (Array.isArray(v) ? v.map((g) => clean(g, 60)).filter(Boolean).slice(0, 30) : []);

function validSource(v: unknown): ChannelSource {
  const s = (v ?? {}) as Record<string, unknown>;
  switch (s.kind) {
    case 'genre': {
      const genre = clean(s.genre, 80);
      if (!genre) break;
      const movies = s.movies !== false;
      const episodes = Boolean(s.episodes);
      return { kind: 'genre', genre, movies: movies || !episodes, episodes };
    }
    case 'series': {
      const seriesId = clean(s.seriesId, 64);
      if (!seriesId) break;
      return { kind: 'series', seriesId, seriesName: clean(s.seriesName, 120) };
    }
    case 'films': {
      const genres = names(s.genres);
      if (!genres.length) break;
      const avoid = names(s.avoid);
      return avoid.length ? { kind: 'films', genres, avoid } : { kind: 'films', genres };
    }
    case 'mix':
    case 'cartoons':
    case 'sitcoms':
    case 'recent':
    case 'shows':
      return { kind: s.kind };
  }
  throw new HttpError(400, t('A channel needs something to play'));
}

/** The names Netfish gives channels: each viewer sees them in their own language, until the admin renames one. */
const GIVEN_NAMES = ['Cartoons', 'Sitcoms', 'Drama & thrillers', 'Comedy films', 'Family films', 'Sci-fi & fantasy', 'New arrivals'];
function shownName(name: string): string {
  for (const given of GIVEN_NAMES) if (name === given || name === inLanguage('it', () => t(given))) return t(given);
  const n = /^(?:Channel|Canale) (\d+)$/.exec(name)?.[1];
  return n ? t('Channel {n}', { n }) : name;
}

function defaultName(source: ChannelSource, n: number) {
  switch (source.kind) {
    case 'mix':
      return 'Netfish';
    case 'cartoons':
      return t('Cartoons');
    case 'sitcoms':
      return t('Sitcoms');
    case 'genre':
      return source.genre;
    case 'series':
      return source.seriesName;
    case 'recent':
      return t('New arrivals');
    default:
      return t('Channel {n}', { n });
  }
}

function validChannels(v: unknown): ChannelDef[] {
  if (!Array.isArray(v) || v.length > 99) throw new HttpError(400, t('Up to 99 channels'));
  const seen = new Set<string>();
  return v.map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    let id = clean(c.id, 40) || randomUUID().slice(0, 8);
    if (seen.has(id)) id = randomUUID().slice(0, 8);
    seen.add(id);
    const source = validSource(c.source);
    const fresh = Boolean(c.fresh) && source.kind !== 'series';
    return { id, number: i + 1, name: clean(c.name, 40) || defaultName(source, i + 1), source, hidden: Boolean(c.hidden) || undefined, fresh: fresh || undefined };
  });
}

function validTimeZone(v: unknown): string | undefined {
  const zone = clean(v, 64);
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

export async function updateChannels(user: SessionUser, patch: Partial<Record<keyof ChannelSettings, unknown>>): Promise<ChannelAdmin> {
  const next: ChannelSettings = { ...stored.settings };
  if ('countWatched' in patch) next.countWatched = Boolean(patch.countWatched);
  if ('channels' in patch) next.channels = withNetfish(validChannels(patch.channels), stored.settings.channels.find((c) => c.builtIn));
  if ('timeZone' in patch) next.timeZone = validTimeZone(patch.timeZone) ?? next.timeZone;
  setLogTimeZone(next.timeZone);
  if ('fresh' in patch) next.fresh = validFresh(patch.fresh, next.fresh);
  if ('enabled' in patch) {
    next.enabled = Boolean(patch.enabled);
    // Turned on for the first time: a line-up of its own to start with.
    if (next.enabled && !next.channels.length) next.channels = automatic(await getLibrary(user, true));
  }
  // Schedules of channels that are gone go with them; a new time zone starts them all again.
  const ids = new Set(next.channels.map((c) => c.id));
  const movedZone = next.timeZone !== stored.settings.timeZone;
  for (const id of Object.keys(stored.schedules)) if (!ids.has(id) || movedZone) delete stored.schedules[id];
  stored = { ...stored, settings: next };
  save();
  // New titles follow the settings straight away (starting, or deleting what's no longer wanted).
  void runFresh();
  return channelAdmin(user);
}

/**
 * Makes the guide again from now, channels and settings as they are: what's on now carries on,
 * everything after it is picked again (new titles placed again too).
 */
export async function rebuildGuide(user: SessionUser): Promise<ChannelAdmin> {
  if (!stored.settings.enabled) throw new HttpError(404, t('Channels are off'));
  const now = Date.now();
  const real = await getLibrary(user, true);
  const lib = withPlans(real);
  for (const sched of Object.values(stored.schedules)) {
    truncate(sched, lib, now + 1);
    sched.freshRoom = [];
  }
  const visible = stored.settings.channels.filter((c) => !c.hidden);
  for (const def of visible) extend(def, real, now, timeZone());
  save();
  // The new titles' times follow the new guide straight away.
  void runFresh();
  return channelAdmin(user);
}

/** Starts over with the automatic line-up (the library has changed a lot, or to undo edits). */
export async function resetChannels(user: SessionUser): Promise<ChannelAdmin> {
  const channels = automatic(await getLibrary(user, true));
  stored = { settings: { ...stored.settings, channels }, schedules: {} };
  save();
  return channelAdmin(user);
}

/**
 * For checking schedules without a server (scripts and tests): what a channel would play
 * over `hours` from `from`, made from these films, shows and episodes.
 */
export function scheduleFor(source: ChannelSource, items: { movies: JfItem[]; series: JfItem[]; episodes: JfItem[] }, from: number, hours: number, timeZone: string) {
  const lib = libraryFrom({ Items: items.movies }, { Items: items.series }, { Items: items.episodes });
  const def: ChannelDef = { id: 'preview', number: 1, name: 'Preview', source };
  const saved = stored.schedules[def.id];
  delete stored.schedules[def.id];
  const until = from + hours * 3600_000;
  const kept = new Map<number, Entry>();
  // A day at a time, as the server would, keeping what's played (the schedule lets go of the past).
  for (let at = from; at < until; at += 12 * 3600_000) {
    extend(def, lib, at, timeZone);
    for (const e of stored.schedules[def.id]?.entries ?? []) if (e.start < until) kept.set(e.start, e);
  }
  const out = [...kept.values()]
    .sort((a, b) => a.start - b.start)
    .map((e) => {
      const p = lib.byId.get(e.itemId)!;
      return { start: e.start, seconds: e.seconds, title: p.title, show: p.seriesTitle, type: p.type, genres: p.genres };
    });
  if (saved) stored.schedules[def.id] = saved;
  else delete stored.schedules[def.id];
  return out;
}
