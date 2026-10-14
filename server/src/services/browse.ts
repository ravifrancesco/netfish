import type { Card, MediaType, ServiceStatus } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { has } from '../config';
import { listConnections, testConnection } from '../connections';
import { CARD_FIELDS, jellyfin, type JfItemsResult } from '../clients/jellyfin';
import type { DiscoverKind, SeerrPage } from '../clients/seerr';
import { settle } from '../lib/async';
import { HttpError } from '../lib/upstream';
import { jfToCard, seerrCards } from './cards';
import { catalog } from './catalog';
import { allDownloads, progressByTitle } from './downloads';
import { libraryIndex } from './library';

const EMPTY: JfItemsResult = { Items: [], TotalRecordCount: 0 };
const EMPTY_PAGE: SeerrPage = { page: 1, totalPages: 0, totalResults: 0, results: [] };

/** Library first (playable now), then everything else TMDB knows about. */
export async function search(user: SessionUser, query: string): Promise<Card[]> {
  const q = query.trim();
  if (!q) return [];
  const [index, local, remote, downloads] = await Promise.all([
    libraryIndex(user),
    settle(
      jellyfin.items(user.token, {
        userId: user.id,
        searchTerm: q,
        includeItemTypes: 'Movie,Series',
        recursive: true,
        limit: 30,
        fields: CARD_FIELDS,
      }),
      EMPTY,
    ),
    has.seerr() ? settle(catalog.search(q), EMPTY_PAGE) : Promise.resolve(EMPTY_PAGE),
    settle(allDownloads(), []),
  ]);
  const cards = local.Items.map((i) => jfToCard(i, index));
  const seen = new Set(cards.map((c) => c.key));
  for (const card of seerrCards(remote.results, index, progressByTitle(downloads))) {
    if (!seen.has(card.key)) cards.push(card);
  }
  return cards;
}

const SORTS: Record<string, string> = {
  added: 'DateCreated,SortName',
  name: 'SortName',
  year: 'ProductionYear,SortName',
  rating: 'CommunityRating,SortName',
};

export async function libraryPage(user: SessionUser, mediaType: MediaType, sort: string, start: number, limit: number) {
  const sortBy = SORTS[sort] ?? SORTS.added;
  const [index, res] = await Promise.all([
    libraryIndex(user),
    jellyfin.items(user.token, {
      userId: user.id,
      includeItemTypes: mediaType === 'tv' ? 'Series' : 'Movie',
      recursive: true,
      sortBy,
      sortOrder: sort === 'name' ? 'Ascending' : 'Descending',
      startIndex: start,
      limit,
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
  if (!target) throw new HttpError(404, `Unknown list "${kind}"`);
  const [index, res, downloads] = await Promise.all([
    libraryIndex(user),
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
