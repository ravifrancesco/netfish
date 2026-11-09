import type { MediaType, SearchResponse, ServiceStatus } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { has } from '../config';
import { listConnections, testConnection } from '../connections';
import { CARD_FIELDS, jellyfin, type JfItemsResult } from '../clients/jellyfin';
import type { DiscoverKind, SeerrPage, SeerrResult } from '../clients/seerr';
import { settle } from '../lib/async';
import { MINUTE, TTLCache } from '../lib/cache';
import { bestScore, searchWords } from '../lib/titleMatch';
import { HttpError } from '../lib/upstream';
import { jfToCard, seerrCards } from './cards';
import { catalog } from './catalog';
import { allDownloads, progressByTitle } from './downloads';
import { leftOut, playableIndex } from './manage';
import { searchPeople } from './people';
import { t } from '../lib/i18n';

const EMPTY: JfItemsResult = { Items: [], TotalRecordCount: 0 };
const EMPTY_PAGE: SeerrPage = { page: 1, totalPages: 0, totalResults: 0, results: [] };

/**
 * Library first (playable now), then everything else TMDB knows about. People
 * (directors, actors) come separately, with their work up front when the search
 * is plainly someone's name.
 */
export async function search(user: SessionUser, query: string): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { items: [], people: [] };
  const excludeItemIds = await leftOut(user);
  const [index, local, close, remote, downloads] = await Promise.all([
    playableIndex(user),
    settle(
      jellyfin.items(user.token, {
        userId: user.id,
        searchTerm: q,
        includeItemTypes: 'Movie,Series',
        recursive: true,
        limit: 30,
        excludeItemIds,
        fields: CARD_FIELDS,
      }),
      EMPTY,
    ),
    settle(closeInLibrary(user, q, excludeItemIds), []),
    has.seerr() ? settle(catalogSearch(q), EMPTY_PAGE) : Promise.resolve(EMPTY_PAGE),
    settle(allDownloads(), []),
  ]);
  // What Jellyfin's search missed ("goodwill hunting", "spiderman", a typo), then all of it closest first.
  const found = new Set(local.Items.map((i) => i.Id));
  const missed = close.filter((id) => !found.has(id));
  const more = missed.length ? await settle(jellyfin.items(user.token, { userId: user.id, ids: missed.join(','), fields: CARD_FIELDS }), EMPTY) : EMPTY;
  const items = [...local.Items, ...more.Items]
    .map((i) => ({ i, score: bestScore(q, [i.Name, i.OriginalTitle]) }))
    .sort((a, b) => b.score - a.score)
    .map(({ i }) => i);
  const progress = progressByTitle(downloads);
  const cards = items.map((i) => jfToCard(i, index));
  const seen = new Set(cards.map((c) => c.key));
  for (const card of seerrCards(remote.results, index, progress)) {
    if (!seen.has(card.key)) cards.push(card);
  }
  const people = await searchPeople(user, q, has.seerr() ? remote.results : undefined, index, progress);
  return { items: cards, ...people };
}

/** Every film's and show's names in the library, for searches Jellyfin's own would miss (kept a few minutes). */
const libraryNames = new TTLCache<Array<{ id: string; names: string[] }>>(50);

/** The library's titles close to what was typed, closest first. */
async function closeInLibrary(user: SessionUser, q: string, excludeItemIds?: string): Promise<string[]> {
  const all = await libraryNames.wrap(user.id, 5 * MINUTE, async () => {
    const res = await jellyfin.items(user.token, {
      userId: user.id,
      includeItemTypes: 'Movie,Series',
      recursive: true,
      fields: 'OriginalTitle',
      enableImages: false,
      enableUserData: false,
    });
    return res.Items.map((i) => ({ id: i.Id, names: [i.Name, i.OriginalTitle].filter((n): n is string => Boolean(n)) }));
  });
  const hidden = new Set(excludeItemIds?.split(','));
  return all
    .flatMap(({ id, names }) => {
      const score = hidden.has(id) ? 0 : bestScore(q, names);
      return score ? [{ id, score }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(({ id }) => id);
}

/** A film, show or person in TMDB's results that's what was typed, near enough. */
const CLOSE = 0.7;
const closeness = (q: string, r: SeerrResult) => (r.mediaType === 'collection' ? 0 : bestScore(q, [r.title, r.name, r.originalTitle, r.originalName]));

/**
 * TMDB (through Seerr), which matches words as typed. Nothing close: asked again a word at a time
 * (and the start of the longest, for a typo further on), keeping what's close, closest first.
 */
async function catalogSearch(q: string): Promise<SeerrPage> {
  const first = await catalog.search(q);
  if (first.results.some((r) => closeness(q, r) >= CLOSE)) return first;
  const words = [...new Set(searchWords(q).split(' '))].filter((w) => w.length >= 3).sort((a, b) => b.length - a.length);
  const longest = words[0] ?? '';
  const tries = [...(words.length > 1 ? words.slice(0, 2) : []), ...(longest.length >= 6 ? [longest.slice(0, Math.max(4, Math.ceil(longest.length * 0.6)))] : [])];
  if (!tries.length) return first;
  const pages = await Promise.all(tries.map((x) => settle(catalog.search(x), EMPTY_PAGE)));
  const known = new Set(first.results.map((r) => `${r.mediaType}-${r.id}`));
  const close = new Map<string, { r: SeerrResult; score: number }>();
  for (const r of pages.flatMap((p) => p.results)) {
    const key = `${r.mediaType}-${r.id}`;
    const score = r.mediaType === 'movie' || r.mediaType === 'tv' ? closeness(q, r) : 0;
    if (score >= CLOSE && !known.has(key) && !close.has(key)) close.set(key, { r, score });
  }
  const found = [...close.values()].sort((a, b) => b.score - a.score || (b.r.popularity ?? 0) - (a.r.popularity ?? 0)).map(({ r }) => r);
  return { ...first, results: [...found, ...first.results] };
}

const SORTS: Record<string, string> = {
  added: 'DateCreated,SortName',
  name: 'SortName',
  year: 'ProductionYear,SortName',
  rating: 'CommunityRating,SortName',
  shortest: 'Runtime,SortName',
  longest: 'Runtime,SortName',
};
const ASCENDING = new Set(['name', 'shortest']);

export async function libraryPage(user: SessionUser, mediaType: MediaType, sort: string, start: number, limit: number) {
  const sortBy = SORTS[sort] ?? SORTS.added;
  // Left out: new titles brought in for channels, and shows with nothing in them (under "Not on disk").
  const excludeItemIds = await leftOut(user, mediaType === 'tv');
  const [index, res] = await Promise.all([
    playableIndex(user),
    jellyfin.items(user.token, {
      userId: user.id,
      includeItemTypes: mediaType === 'tv' ? 'Series' : 'Movie',
      recursive: true,
      sortBy,
      sortOrder: ASCENDING.has(sort) ? 'Ascending' : 'Descending',
      startIndex: start,
      limit,
      excludeItemIds,
      fields: CARD_FIELDS,
      enableImageTypes: 'Primary,Backdrop,Thumb',
    }),
  ]);
  return { items: res.Items.map((i) => jfToCard(i, index)), total: res.TotalRecordCount };
}

const DISCOVER: Record<string, DiscoverKind> = {
  trending: 'trending',
  movies: 'movies',
  tv: 'tv',
  'movies-upcoming': 'movies/upcoming',
  'tv-upcoming': 'tv/upcoming',
};

export async function discoverPage(user: SessionUser, kind: string, page: number) {
  const target = DISCOVER[kind];
  if (!target) throw new HttpError(404, t('Unknown list "{kind}"', { kind }));
  const [index, res, downloads] = await Promise.all([
    playableIndex(user),
    catalog.discover(target, page),
    settle(allDownloads(), []),
  ]);
  return { items: seerrCards(res.results, index, progressByTitle(downloads)), page: res.page, totalPages: res.totalPages };
}

// ---------- Service health (admin settings page) ----------

export async function serviceStatus(): Promise<ServiceStatus[]> {
  return Promise.all(
    listConnections().map(async (c): Promise<ServiceStatus> => {
      const configured = c.fixedUrl ? c.hasKey : Boolean(c.url);
      if (!configured) return { id: c.id, name: c.name, configured: false, ok: false, url: c.url };
      const test = await testConnection(c.id);
      return { id: c.id, name: c.name, configured: true, ok: test.ok, version: test.version, error: test.error, url: c.url };
    }),
  );
}
