import type { Card, HomeResponse, MediaType, Row } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { has } from '../config';
import { CARD_FIELDS, jellyfin, type JfItem, type JfItemsResult } from '../clients/jellyfin';
import type { SeerrPage, SeerrResult } from '../clients/seerr';
import { settle } from '../lib/async';
import { jfPlayableCard, jfToCard, seerrCards, type ProgressMap } from './cards';
import { catalog } from './catalog';
import { allDownloads, progressByTitle } from './downloads';
import { libraryIndex, type LibraryIndex } from './library';
import { listRequests } from './requests';

const EMPTY: JfItemsResult = { Items: [], TotalRecordCount: 0 };
const EMPTY_PAGE: SeerrPage = { page: 1, totalPages: 0, totalResults: 0, results: [] };

interface Seed {
  key: string;
  mediaType: MediaType;
  tmdbId: number;
  name: string;
}

/** Titles the user watched recently, newest first: the raw material for suggestions. */
function seedsFrom(items: JfItem[], index: LibraryIndex): { seeds: Seed[]; watched: Set<string> } {
  const seeds: Seed[] = [];
  const watched = new Set<string>();
  for (const item of items) {
    const entry = index.byId.get(item.Type === 'Episode' ? (item.SeriesId ?? '') : item.Id);
    if (!entry?.tmdbId) continue;
    const key = `${entry.mediaType}-${entry.tmdbId}`;
    if (watched.has(key)) continue;
    watched.add(key);
    seeds.push({ key, mediaType: entry.mediaType, tmdbId: entry.tmdbId, name: entry.name });
  }
  return { seeds, watched };
}

/** Blend recommendations from several recently watched titles, favouring newer seeds and higher ranks. */
function personalPicks(pages: Array<SeerrPage | undefined>, exclude: Set<string>): SeerrResult[] {
  const scored = new Map<string, { result: SeerrResult; score: number }>();
  pages.forEach((page, seedRank) => {
    page?.results.forEach((result, position) => {
      if (result.mediaType !== 'movie' && result.mediaType !== 'tv') return;
      const key = `${result.mediaType}-${result.id}`;
      if (exclude.has(key)) return;
      const weight = (1 / (seedRank + 1)) * (1 - position / 40);
      const hit = scored.get(key);
      scored.set(key, { result, score: (hit?.score ?? 0) + weight });
    });
  });
  return [...scored.values()].sort((a, b) => b.score - a.score).map((s) => s.result);
}

function continueWatching(resume: JfItem[], nextUp: JfItem[], index: LibraryIndex): Card[] {
  const seen = new Set<string>();
  const cards: Card[] = [];
  for (const item of [...resume, ...nextUp]) {
    const group = item.Type === 'Episode' ? (item.SeriesId ?? item.Id) : item.Id;
    if (seen.has(group)) continue;
    seen.add(group);
    cards.push(jfPlayableCard(item, index));
  }
  return cards.slice(0, 20);
}

export async function buildHome(user: SessionUser): Promise<HomeResponse> {
  const { token, id: userId } = user;
  const index = await libraryIndex(user);
  const downloads = await settle(allDownloads(), []);
  const progress: ProgressMap = progressByTitle(downloads);
  const jfQuery = (q: Record<string, string | number | boolean>) =>
    settle(jellyfin.items(token, { userId, recursive: true, fields: CARD_FIELDS, enableImageTypes: 'Primary,Backdrop,Thumb', ...q }), EMPTY);

  const [resume, nextUp, latestMovies, latestShows, unwatched, history] = await Promise.all([
    settle(jellyfin.resume(token, userId), EMPTY),
    settle(jellyfin.nextUp(token, userId), EMPTY),
    jfQuery({ includeItemTypes: 'Movie', sortBy: 'DateCreated', sortOrder: 'Descending', limit: 24 }),
    jfQuery({ includeItemTypes: 'Series', sortBy: 'DateLastContentAdded', sortOrder: 'Descending', limit: 24 }),
    jfQuery({ includeItemTypes: 'Movie,Series', filters: 'IsUnplayed', sortBy: 'Random', limit: 24 }),
    settle(
      jellyfin.items(token, {
        userId,
        recursive: true,
        includeItemTypes: 'Movie,Episode',
        filters: 'IsPlayed',
        sortBy: 'DatePlayed',
        sortOrder: 'Descending',
        limit: 60,
        fields: 'ProviderIds',
        enableImages: false,
      }),
      EMPTY,
    ),
  ]);

  const { seeds, watched } = seedsFrom([...resume.Items, ...history.Items], index);
  const topSeeds = seeds.slice(0, 6);

  let picks: Card[] = [];
  const because: Row[] = [];
  let trending: Card[] = [];
  let popularMovies: Card[] = [];
  let popularTv: Card[] = [];
  let upcoming: Card[] = [];
  let requested: Card[] = [];

  if (has.seerr()) {
    const [recPages, trendingP, moviesP, tvP, upcomingP, myRequests] = await Promise.all([
      Promise.all(topSeeds.map((s) => settle(catalog.recommendations(s.mediaType, s.tmdbId), undefined))),
      settle(catalog.discover('trending'), EMPTY_PAGE),
      settle(catalog.discover('movies'), EMPTY_PAGE),
      settle(catalog.discover('tv'), EMPTY_PAGE),
      settle(catalog.discover('movies/upcoming'), EMPTY_PAGE),
      settle(listRequests(user, 'mine'), []),
    ]);

    const exclude = new Set([...watched, ...topSeeds.map((s) => s.key)]);
    picks = seerrCards(personalPicks(recPages, exclude), index, progress).slice(0, 24);
    const shown = new Set(picks.slice(0, 12).map((c) => c.key));
    topSeeds.slice(0, 2).forEach((seed, i) => {
      const items = seerrCards(recPages[i]?.results ?? [], index, progress).filter((c) => !shown.has(c.key) && !exclude.has(c.key));
      if (items.length >= 6) because.push({ id: `because-${seed.key}`, title: `Because you watched ${seed.name}`, style: 'poster', items });
    });
    trending = seerrCards(trendingP.results, index, progress);
    popularMovies = seerrCards(moviesP.results, index, progress);
    popularTv = seerrCards(tvP.results, index, progress);
    upcoming = seerrCards(upcomingP.results, index, progress);
    requested = myRequests
      .filter((r) => r.status !== 'available' && r.requestStatus !== 'declined')
      .map((r) => ({
        key: `${r.mediaType}-${r.tmdbId}`,
        mediaType: r.mediaType,
        tmdbId: r.tmdbId,
        title: r.title,
        year: r.year,
        poster: r.poster,
        backdrop: r.backdrop,
        status: r.status,
        downloadProgress: r.download?.progress,
      }));
  }

  const candidates: Row[] = [
    { id: 'continue', title: 'Continue Watching', style: 'wide', items: continueWatching(resume.Items, nextUp.Items, index) },
    { id: 'requested', title: 'Your requests', style: 'poster', items: requested, href: '/activity' },
    { id: 'picks', title: `Top picks for ${user.name}`, style: 'poster', items: picks },
    { id: 'latest-movies', title: 'Recently added movies', style: 'poster', items: latestMovies.Items.map((i) => jfToCard(i, index)), href: '/movies' },
    { id: 'latest-shows', title: 'New episodes', style: 'poster', items: latestShows.Items.map((i) => jfToCard(i, index)), href: '/shows' },
    ...because.slice(0, 1),
    { id: 'trending', title: 'Trending now', style: 'poster', items: trending },
    ...because.slice(1),
    { id: 'popular-movies', title: 'Popular movies', style: 'poster', items: popularMovies },
    { id: 'popular-tv', title: 'Popular shows', style: 'poster', items: popularTv },
    { id: 'unwatched', title: 'Waiting in your library', style: 'poster', items: unwatched.Items.map((i) => jfToCard(i, index)) },
    { id: 'upcoming', title: 'Coming soon to cinemas', style: 'poster', items: upcoming },
  ];
  const rows = candidates.filter((row) => row.items.length > 0);

  const heroPool = [...picks.filter((c) => c.status === 'available'), ...picks, ...rows.find((r) => r.id === 'latest-movies')?.items ?? [], ...trending]
    .filter((c) => c.backdrop && c.overview)
    .slice(0, 6);
  const hero = heroPool.length ? heroPool[Math.floor(Math.random() * heroPool.length)] : undefined;

  return { hero, rows };
}
