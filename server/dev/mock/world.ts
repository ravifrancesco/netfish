import crypto from 'node:crypto';
import { DURATION_SECONDS } from './media';

/**
 * One consistent fake world shared by every mocked service: a small catalog,
 * two users, watch history, requests, and downloads that progress in real
 * time and land in the library when they finish.
 */

export const hex = (s: string) => crypto.createHash('md5').update(s).digest('hex');
export const TICKS = 10_000_000;
export const RUNTIME_TICKS = DURATION_SECONDS * TICKS;

export interface Title {
  tmdbId: number;
  tvdbId?: number;
  n: number;
  type: 'movie' | 'tv';
  title: string;
  year: number;
  genres: string[];
  overview: string;
  lang: string;
  seasons: number;
  rating: number;
}

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const M = (n: number, title: string, year: number, genres: string[], overview: string, lang = 'en'): Title => ({
  n, tmdbId: 900000 + n, type: 'movie', title, year, genres, overview, lang, seasons: 0, rating: 5.8 + (hash(title) % 32) / 10,
});
const T = (n: number, title: string, year: number, seasons: number, genres: string[], overview: string): Title => ({
  n, tmdbId: 910000 + n, tvdbId: 800000 + n, type: 'tv', title, year, genres, overview, lang: 'en', seasons, rating: 6.2 + (hash(title) % 27) / 10,
});

export const TITLES: Title[] = [
  M(1, 'The Deep Current', 2024, ['Drama', 'Thriller'], 'A marine biologist follows a mysterious current that seems to be pulling the whole coastline out to sea.'),
  M(2, 'Coral Kingdom', 2023, ['Animation', 'Family'], 'A young clownfish must rally a divided reef before the bleaching season wipes out its home.'),
  M(3, 'Night Tide', 2022, ['Horror'], 'Every full moon the tide brings something back to the little harbor town. This time it brings them all.'),
  M(4, 'Salt & Steel', 2021, ['Action'], 'An ex-navy diver is pulled into one last salvage job, and the cargo is not what anyone was promised.'),
  M(5, 'The Last Lighthouse', 2020, ['Drama'], 'The final keeper of an automated lighthouse refuses to leave, and a storm is coming to test him.'),
  M(6, 'Midnight Trawler', 2024, ['Thriller'], 'Twelve hours, one fishing boat, one stowaway, and a radio that only picks up a single voice.'),
  M(7, 'Abyssal', 2025, ['Science Fiction'], 'A research station at the bottom of the Mariana Trench stops answering. The rescue team is not the first to arrive.'),
  M(8, 'A Fish Called Ronda', 2019, ['Comedy'], 'Two rival aquarium owners try to steal the same very famous goldfish on the same very long weekend.'),
  M(9, 'Undertow', 2023, ['Crime'], 'A coastal detective realises the drownings she has been closing as accidents all share one witness.'),
  M(10, 'Paper Boats', 2018, ['Romance'], 'Two strangers keep finding each other’s folded notes floating down the same canal.'),
  M(11, 'Leviathan Rising', 2025, ['Action', 'Science Fiction'], 'When a creature the size of a city surfaces off Lisbon, a disgraced oceanographer is the only one with a plan.'),
  M(12, 'The Harbor Thief', 2022, ['Crime', 'Comedy'], 'A charming pickpocket works the cruise terminal — until she lifts the wrong passport.'),
  M(13, 'Heure Bleue', 2021, ['Romance', 'Drama'], 'Over one summer in Brittany, a ferry pilot and a painter measure their lives in tides.', 'fr'),
  M(14, 'Kelp Forest', 2024, ['Documentary'], 'Three years filming the fastest-growing forests on Earth, entirely underwater.'),
  M(15, 'Shoal', 2020, ['Mystery'], 'A sandbar appears overnight off a quiet island, and with it, a house nobody remembers building.'),
  M(16, 'Tidal Lock', 2026, ['Science Fiction'], 'On a planet that always shows the same face to its sun, a crew must cross the endless twilight line.'),
  M(17, 'The Angler', 2019, ['Thriller'], 'A patient man. A frozen lake. A hole in the ice and a line that goes much deeper than it should.'),
  M(18, 'Ghost Net', 2023, ['Horror'], 'Divers clearing abandoned fishing nets find that some of them are still catching things.'),
  M(19, 'Reef Break', 2022, ['Drama'], 'A surfer past her prime trains a fearless teenager for the wave that ended her career.'),
  M(20, 'Bioluminescent', 2025, ['Science Fiction', 'Romance'], 'Two scientists fall in love by the light of a glowing bay that is starting to go dark.'),
  M(21, 'Saltwater Cowboys', 2021, ['Western', 'Comedy'], 'Wild horses, wilder ponies, and the most disorganised roundup on the Atlantic coast.'),
  M(22, 'The Pearl Diver', 2018, ['Adventure'], 'A teenage free-diver in 1920s Broome holds her breath for a fortune — and her family’s freedom.'),
  M(23, 'Brine', 2024, ['Drama'], 'A pickle-factory family drama about inheritance, vinegar and the long memory of small towns.'),
  M(24, 'Fathoms Below', 2020, ['Adventure'], 'A treasure map, a leaky submarine, and three siblings who can’t agree on anything.'),
  M(25, 'Lantern Fish', 2026, ['Animation'], 'In the deep dark, the smallest light leads everyone home.'),
  M(26, 'The Mariner’s Daughter', 2023, ['Drama'], 'Grief, a stubborn sailboat and a daughter determined to finish her father’s voyage.'),
  M(27, 'Riptide', 2027, ['Action'], 'A lifeguard. A heist. A beach full of witnesses who saw absolutely nothing.'),
  M(28, 'Neon Squid', 2027, ['Animation'], 'A colour-changing squid wants to be a famous DJ. The ocean is not ready.'),
  M(29, 'Sea of Glass', 2027, ['Science Fiction'], 'The oceans froze clear overnight. Now everyone can see what was down there.'),
  M(30, 'Moonpool', 2026, ['Thriller'], 'Six engineers sealed in a drilling platform. One of them opened the moonpool.'),
  T(101, 'Depth Charge', 2022, 3, ['Drama', 'War'], 'A submarine crew in a war that never officially happened.'),
  T(102, 'Fishmongers', 2021, 2, ['Comedy'], 'The loudest family-run fish market in Glasgow, and the people who somehow keep it afloat.'),
  T(103, 'The Tide Keepers', 2024, 2, ['Fantasy'], 'An ancient order controls the tides. Their newest recruit has never seen the sea.'),
  T(104, 'Port Authority', 2020, 4, ['Crime'], 'Customs officers at Europe’s busiest port fight smugglers, bureaucracy and each other.'),
  T(105, 'Gills', 2023, 1, ['Science Fiction'], 'After an experimental treatment, a swimmer wakes up able to breathe underwater.'),
  T(106, 'Harbor Lights', 2019, 3, ['Drama'], 'Three generations of a lighthouse family on an island with one road and many secrets.'),
  T(107, 'Sunken Cities', 2025, 1, ['Documentary'], 'Archaeologists explore lost cities beneath the waves.'),
  T(108, 'Bait', 2024, 2, ['Thriller'], 'An undercover cop poses as a fisherman to catch a killer who hunts the docks.'),
  T(109, 'Salt Marsh', 2022, 2, ['Mystery'], 'A missing birdwatcher, a marsh full of secrets, and a village that would rather not know.'),
  T(110, 'Krill Chill', 2026, 1, ['Animation', 'Comedy'], 'Very small creatures, very big feelings.'),
];

export const titleByTmdb = new Map(TITLES.map((t) => [`${t.type}-${t.tmdbId}`, t]));
export const EPISODES_PER_SEASON = 8;
const EP_NAMES = ['Pilot', 'Low Tide', 'The Catch', 'Undercurrent', 'Dead Calm', 'Landfall', 'High Water', 'Return to Port'];
export const episodeName = (t: Title, s: number, e: number) => (s === 1 ? EP_NAMES[e - 1] : `${EP_NAMES[(e + s) % 8]} (Part ${s})`);

// ---------- Jellyfin ids ----------

export const ids = {
  movie: (t: Title) => hex(`movie-${t.tmdbId}`),
  series: (t: Title) => hex(`series-${t.tmdbId}`),
  season: (t: Title, s: number) => hex(`season-${t.tmdbId}-${s}`),
  episode: (t: Title, s: number, e: number) => hex(`ep-${t.tmdbId}-${s}-${e}`),
};

export type Item =
  | { kind: 'movie'; id: string; title: Title }
  | { kind: 'series'; id: string; title: Title }
  | { kind: 'season'; id: string; title: Title; s: number }
  | { kind: 'episode'; id: string; title: Title; s: number; e: number };

export const itemsById = new Map<string, Item>();
for (const t of TITLES) {
  if (t.type === 'movie') itemsById.set(ids.movie(t), { kind: 'movie', id: ids.movie(t), title: t });
  else {
    itemsById.set(ids.series(t), { kind: 'series', id: ids.series(t), title: t });
    for (let s = 1; s <= t.seasons; s++) {
      itemsById.set(ids.season(t, s), { kind: 'season', id: ids.season(t, s), title: t, s });
      for (let e = 1; e <= EPISODES_PER_SEASON; e++) itemsById.set(ids.episode(t, s, e), { kind: 'episode', id: ids.episode(t, s, e), title: t, s, e });
    }
  }
}

// ---------- Users ----------

export interface MockUser {
  name: string;
  password: string;
  admin: boolean;
  seerrId: number;
  id: string;
}
export const USERS: MockUser[] = [
  { name: 'admin', password: 'admin', admin: true, seerrId: 1, id: hex('user-admin') },
  { name: 'demo', password: 'demo', admin: false, seerrId: 2, id: hex('user-demo') },
  { name: 'sam', password: 'sam', admin: false, seerrId: 3, id: hex('user-sam') },
];
export const sessions = new Map<string, MockUser>();

// ---------- State ----------

/** Library membership: `movie-<tmdb>` or `tv-<tmdb>-<season>`, with when it was added. */
export const library = new Set<string>();
export const addedAt = new Map<string, number>();
export function addToLibrary(key: string, at = Date.now()) {
  library.add(key);
  addedAt.set(key, at);
}
/** Audio languages (ISO 639-2) per movie or show. */
export const audio = new Map<string, string[]>();
/** Subtitle languages (ISO 639-1) per `movie-<tmdb>` or `ep-<tmdb>-<s>-<e>`. */
export const subtitles = new Map<string, Set<string>>();

export interface UserData {
  pos: number;
  played: boolean;
  lastPlayed?: number;
}
export const userData = new Map<string, UserData>();
export const ud = (userId: string, itemId: string): UserData => userData.get(`${userId}:${itemId}`) ?? { pos: 0, played: false };
export const setUd = (userId: string, itemId: string, data: Partial<UserData>) =>
  userData.set(`${userId}:${itemId}`, { ...ud(userId, itemId), ...data });

export interface MockRequest {
  id: number;
  type: 'movie' | 'tv';
  tmdbId: number;
  seasons: number[];
  status: 1 | 2 | 3 | 4 | 5;
  seerrUserId: number;
  createdAt: string;
}
export const requests: MockRequest[] = [];

export interface MockDownload {
  id: number;
  downloadId: string;
  title: Title;
  season?: number;
  startedAt: number;
  durationMs: number;
  stalledAt?: number;
  size: number;
  release: string;
  quality: string;
  languages: string[];
}
export const downloads: MockDownload[] = [];

/** Titles Radarr/Sonarr still keep after their files were deleted (`movie-<tmdb>`, `tv-<tmdb>`). */
export const arrKnown = new Set<string>();
/** Not monitored in Radarr/Sonarr: `movie-<tmdb>`, `tv-<tmdb>` (the series) or `tv-<tmdb>-<season>`. */
export const unmonitored = new Set<string>();
/** Seerr statuses set by hand (POST /media/:id/:status), until something downloads. */
export const statusOverride = new Map<string, number>();

let nextId = 1;
export const newId = () => nextId++;

const ISO3: Record<string, string> = {
  English: 'eng', Spanish: 'spa', 'Spanish (Latino)': 'spa', French: 'fre', German: 'ger', Italian: 'ita', Hindi: 'hin',
  Tamil: 'tam', Telugu: 'tel', Japanese: 'jpn',
};

export function startDownload(title: Title, opts: { season?: number; ageMs?: number; durationMs?: number; release?: string; quality?: string; languages?: string[]; stalledAt?: number } = {}) {
  statusOverride.delete(`${title.type}-${title.tmdbId}`);
  const base = title.title.replace(/[^A-Za-z0-9]+/g, '.');
  downloads.push({
    id: newId(),
    downloadId: crypto.randomBytes(20).toString('hex').toUpperCase(),
    title,
    season: opts.season,
    startedAt: Date.now() - (opts.ageMs ?? 0),
    durationMs: opts.durationMs ?? (title.type === 'movie' ? 90_000 : 120_000),
    stalledAt: opts.stalledAt,
    size: (title.type === 'movie' ? 8.4 : 14.2) * 1024 ** 3,
    release: opts.release ?? (title.type === 'movie' ? `${base}.${title.year}.1080p.BluRay.x264-FISHY` : `${base}.S${String(opts.season).padStart(2, '0')}.1080p.WEB-DL.x264-REEF`),
    quality: opts.quality ?? (title.type === 'movie' ? 'Bluray-1080p' : 'WEBDL-1080p'),
    languages: opts.languages ?? ['English'],
  });
}

export function progressOf(d: MockDownload): number {
  if (d.stalledAt !== undefined) return d.stalledAt;
  return Math.min(1, (Date.now() - d.startedAt) / d.durationMs);
}

const IMPORT_MS = 8000;
export const isImporting = (d: MockDownload) => d.stalledAt === undefined && Date.now() - d.startedAt >= d.durationMs;

/** Move the world forward: finished downloads become library items. */
export function advance() {
  for (const d of [...downloads]) {
    if (d.stalledAt !== undefined || Date.now() - d.startedAt < d.durationMs + IMPORT_MS) continue;
    downloads.splice(downloads.indexOf(d), 1);
    const t = d.title;
    const langs = d.languages.map((l) => ISO3[l]).filter(Boolean);
    if (t.type === 'movie') {
      addToLibrary(`movie-${t.tmdbId}`);
      if (langs.length) audio.set(`movie-${t.tmdbId}`, langs);
      subtitles.set(`movie-${t.tmdbId}`, subtitles.get(`movie-${t.tmdbId}`) ?? new Set(['en']));
    } else if (d.season) {
      addToLibrary(`tv-${t.tmdbId}-${d.season}`);
      if (langs.length) audio.set(`tv-${t.tmdbId}`, langs);
    }
    for (const r of requests) if (r.type === t.type && r.tmdbId === t.tmdbId && mediaStatus(t) === 5) r.status = 5;
  }
}

export const inLibrary = (t: Title) =>
  t.type === 'movie' ? library.has(`movie-${t.tmdbId}`) : Array.from({ length: t.seasons }, (_, i) => i + 1).some((s) => library.has(`tv-${t.tmdbId}-${s}`));
export const librarySeasons = (t: Title) => Array.from({ length: t.seasons }, (_, i) => i + 1).filter((s) => library.has(`tv-${t.tmdbId}-${s}`));

export function seasonStatus(t: Title, s: number): number {
  if (library.has(`tv-${t.tmdbId}-${s}`)) return 5;
  if (downloads.some((d) => d.title === t && d.season === s)) return 3;
  if (statusOverride.has(`tv-${t.tmdbId}`)) return statusOverride.get(`tv-${t.tmdbId}`)!;
  const req = requests.find((r) => r.type === 'tv' && r.tmdbId === t.tmdbId && r.seasons.includes(s) && r.status !== 3);
  if (req) return req.status === 1 ? 2 : 3;
  return 1;
}

/** Seerr MediaStatus: 1 unknown … 5 available. */
export function mediaStatus(t: Title): number {
  if (t.type === 'movie') {
    if (library.has(`movie-${t.tmdbId}`)) return 5;
    if (downloads.some((d) => d.title === t)) return 3;
    if (statusOverride.has(`movie-${t.tmdbId}`)) return statusOverride.get(`movie-${t.tmdbId}`)!;
    const req = requests.find((r) => r.type === 'movie' && r.tmdbId === t.tmdbId && r.status !== 3);
    return req ? (req.status === 1 ? 2 : 3) : 1;
  }
  const statuses = Array.from({ length: t.seasons }, (_, i) => seasonStatus(t, i + 1));
  if (statuses.every((s) => s === 5)) return 5;
  if (statuses.some((s) => s === 5)) return 4;
  if (statuses.some((s) => s === 3)) return 3;
  if (statuses.some((s) => s === 2)) return 2;
  return 1;
}

// ---------- Seed ----------

const byN = (n: number) => TITLES.find((t) => t.n === n)!;
const DAY = 86_400_000;

export function seed() {
  [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 22, 24, 26].forEach((n, i) => {
    addToLibrary(`movie-${byN(n).tmdbId}`, Date.now() - (i + 1) * 9 * 3600_000);
    subtitles.set(`movie-${byN(n).tmdbId}`, new Set(['en']));
  });
  for (const [n, seasons] of [[101, [1, 2]], [102, [1, 2]], [104, [1, 2]], [106, [1, 2, 3]], [109, [1]]] as const) {
    for (const s of seasons) addToLibrary(`tv-${byN(n).tmdbId}-${s}`, Date.now() - (n - 100) * 20 * 3600_000 + s * 3600_000);
  }
  audio.set(`movie-${byN(1).tmdbId}`, ['eng', 'spa']);
  audio.set(`movie-${byN(4).tmdbId}`, ['eng', 'spa']);
  audio.set(`movie-${byN(13).tmdbId}`, ['fre']);

  const [admin, demo] = USERS;
  const ago = (ms: number) => Date.now() - ms;
  setUd(demo.id, ids.movie(byN(1)), { played: true, lastPlayed: ago(3 * DAY) });
  setUd(demo.id, ids.movie(byN(9)), { played: true, lastPlayed: ago(10 * DAY) });
  setUd(demo.id, ids.movie(byN(2)), { pos: 0.4 * RUNTIME_TICKS, lastPlayed: ago(DAY) });
  for (let e = 1; e <= 3; e++) setUd(demo.id, ids.episode(byN(101), 1, e), { played: true, lastPlayed: ago((5 - e) * 3600_000) });
  setUd(demo.id, ids.episode(byN(101), 1, 4), { pos: 0.25 * RUNTIME_TICKS, lastPlayed: ago(3600_000) });
  for (let e = 1; e <= 8; e++) setUd(demo.id, ids.episode(byN(106), 1, e), { played: true, lastPlayed: ago(7 * DAY - e * 3600_000) });
  setUd(admin.id, ids.movie(byN(4)), { pos: 0.6 * RUNTIME_TICKS, lastPlayed: ago(2 * DAY) });
  // The rest of the household, for "Popular on this server".
  const sam = USERS[2];
  [[admin, [1, 5, 10, 12]], [sam, [5, 12, 14, 3]]].forEach(([user, films]) =>
    (films as number[]).forEach((n, i) => setUd((user as MockUser).id, ids.movie(byN(n)), { played: true, lastPlayed: ago((i + 1) * 2 * DAY) })),
  );
  for (let e = 1; e <= 6; e++) setUd(admin.id, ids.episode(byN(104), 1, e), { played: true, lastPlayed: ago(4 * DAY - e * 3600_000) });
  for (let e = 1; e <= 5; e++) setUd(sam.id, ids.episode(byN(102), 1, e), { played: true, lastPlayed: ago(DAY - e * 3600_000) });
  setUd(sam.id, ids.movie(byN(10)), { pos: 0.3 * RUNTIME_TICKS, lastPlayed: ago(3600_000) });

  const req = (type: 'movie' | 'tv', n: number, status: MockRequest['status'], user: MockUser, seasons: number[] = [], agoMs = DAY) =>
    requests.push({ id: newId(), type, tmdbId: byN(n).tmdbId, seasons, status, seerrUserId: user.seerrId, createdAt: new Date(ago(agoMs)).toISOString() });
  req('movie', 7, 2, demo, [], 2 * 3600_000);
  startDownload(byN(7), { ageMs: 30_000, durationMs: 150_000 });
  req('movie', 16, 1, demo, [], 5 * 3600_000);
  req('tv', 103, 2, demo, [1], 3600_000);
  startDownload(byN(103), { season: 1, ageMs: 20_000, durationMs: 240_000 });
  req('movie', 20, 2, admin, [], DAY);
  startDownload(byN(20), { stalledAt: 0.12 });
  req('movie', 1, 5, demo, [], 30 * DAY);
}
