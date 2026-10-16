import type { Card, HomeResponse, Row } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { has } from '../config';
import { CARD_FIELDS, jellyfin, type JfItem, type JfItemsResult } from '../clients/jellyfin';
import type { SeerrPage } from '../clients/seerr';
import { settle } from '../lib/async';
import { jfPlayableCard, jfToCard, seerrCards, type ProgressMap } from './cards';
import { catalog } from './catalog';
import { allDownloads, progressByTitle } from './downloads';
import { hiddenIds, libraryIndex, type LibraryIndex } from './library';
import { listRequests } from './requests';
import { traktPicks } from './trakt';
import { isHidden } from './watched';
import { readyToWatch } from './ready';
import { householdFavourites, noteWatched, syncHousehold } from './household';
import { peopleRows, rankPicks, tasteOf, type PeopleRows, type Seed, type Taste } from './taste';
import { playTarget } from './titles';
import { suggestedFor } from './suggestarr';
import { t } from '../lib/i18n';

const EMPTY: JfItemsResult = { Items: [], TotalRecordCount: 0 };
const EMPTY_PAGE: SeerrPage = { page: 1, totalPages: 0, totalResults: 0, results: [] };

/**
 * Titles the user watched recently, newest first: the raw material for suggestions.
 * `watchedIds` are the Jellyfin movie/series ids, `watched` the TMDB keys.
 */
function seedsFrom(items: JfItem[], index: LibraryIndex): { seeds: Seed[]; watched: Set<string>; watchedIds: Set<string> } {
  const seeds: Seed[] = [];
  const watched = new Set<string>();
  const watchedIds = new Set<string>();
  for (const item of items) {
    const id = item.Type === 'Episode' ? (item.SeriesId ?? '') : item.Id;
    watchedIds.add(id);
    const entry = index.byId.get(id);
    if (!entry?.tmdbId) continue;
    const key = `${entry.mediaType}-${entry.tmdbId}`;
    if (watched.has(key)) continue;
    watched.add(key);
    seeds.push({ key, mediaType: entry.mediaType, tmdbId: entry.tmdbId, name: entry.name, weight: 1 / (1 + seeds.length / 5) });
  }
  return { seeds, watched, watchedIds };
}

function continueWatching(userId: string, resume: JfItem[], nextUp: JfItem[], index: LibraryIndex, fresh: Set<string>): Card[] {
  const seen = new Set<string>();
  const cards: Card[] = [];
  for (const item of [...resume, ...nextUp]) {
    const group = item.Type === 'Episode' ? (item.SeriesId ?? item.Id) : item.Id;
    if (seen.has(group) || fresh.has(group) || isHidden(userId, group, item)) continue;
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
  // New titles brought in for channels aren't in anyone's library.
  const excludeItemIds = await hiddenIds(user);
  const fresh = new Set(excludeItemIds?.split(',') ?? []);
  const jfQuery = (q: Record<string, string | number | boolean>) =>
    settle(jellyfin.items(token, { userId, recursive: true, fields: CARD_FIELDS, enableImageTypes: 'Primary,Backdrop,Thumb', excludeItemIds, ...q }), EMPTY);

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

  const { seeds, watched, watchedIds } = seedsFrom([...resume.Items, ...history.Items], index);
  const topSeeds = seeds.slice(0, 6);

  // What everyone else here has been watching (and haven't seen yet), as library cards this person can open.
  noteWatched(userId, [...resume.Items, ...history.Items]);
  syncHousehold();
  const favourites = householdFavourites(userId).filter((h) => !watchedIds.has(h.id)).slice(0, 40);
  const householdKeys = new Set(
    favourites.map((h) => index.byId.get(h.id)).flatMap((e) => (e?.tmdbId ? [`${e.mediaType}-${e.tmdbId}`] : [])),
  );
  const householdCards = favourites.length
    ? settle(jfQuery({ ids: favourites.map((h) => h.id).join(','), limit: 40 }), EMPTY).then((res) => {
        const byId = new Map(res.Items.map((i) => [i.Id, i]));
        return favourites.flatMap((h) => (byId.has(h.id) ? [jfToCard(byId.get(h.id)!, index)] : []));
      })
    : Promise.resolve([] as Card[]);

  let picks: Card[] = [];
  const because: Row[] = [];
  let trending: Card[] = [];
  let popularMovies: Card[] = [];
  let popularTv: Card[] = [];
  let upcoming: Card[] = [];
  let requested: Card[] = [];
  let traktMovies: Card[] = [];
  let traktShows: Card[] = [];
  let suggested: Card[] = [];
  let people: PeopleRows['rows'] = {};

  if (has.seerr()) {
    const exclude = new Set([...watched, ...topSeeds.map((s) => s.key)]);
    const tasteAndPeople = tasteOf(seeds).then(async (taste: Taste) => ({ taste, people: await peopleRows(taste, exclude, index, progress) }));
    const [recPages, trendingP, moviesP, tvP, upcomingP, myRequests, traktM, traktS, mine, sarr] = await Promise.all([
      Promise.all(topSeeds.map((s) => settle(catalog.recommendations(s.mediaType, s.tmdbId), undefined))),
      settle(catalog.discover('trending'), EMPTY_PAGE),
      settle(catalog.discover('movies'), EMPTY_PAGE),
      settle(catalog.discover('tv'), EMPTY_PAGE),
      settle(catalog.discover('movies/upcoming'), EMPTY_PAGE),
      settle(listRequests(user, 'mine'), []),
      settle(traktPicks('movie'), []),
      settle(traktPicks('tv'), []),
      settle(tasteAndPeople, undefined),
      settle(suggestedFor(user, index), []),
    ]);
    traktMovies = seerrCards(traktM, index, progress);
    traktShows = seerrCards(traktS, index, progress);
    // SuggestArr's, from this person's viewing (what they've since watched drops off), each with what it came from.
    const cameFrom = new Map(sarr.map((s) => [`${s.result.mediaType}-${s.result.id}`, s.because]));
    suggested = seerrCards(
      sarr.map((s) => s.result),
      index,
      progress,
    )
      .filter((c) => !watched.has(c.key))
      .map((c) => {
        const name = cameFrom.get(c.key);
        return { ...c, subtitle: name ? t('Because you watched {name}', { name }) : undefined };
      });

    picks = mine
      ? rankPicks({ seeds: topSeeds, recPages, taste: mine.taste, people: mine.people.candidates, household: householdKeys, exclude, index, progress })
      : [];
    const shown = new Set(picks.slice(0, 12).map((c) => c.key));
    // Rows about people skip what Top picks already shows up front, unless that would leave them nearly empty.
    const notShown = (row?: Row) => {
      const rest = row?.items.filter((c) => !shown.has(c.key));
      return row && rest && rest.length >= 6 ? { ...row, items: rest } : row;
    };
    people = { director: notShown(mine?.people.rows.director), actor: notShown(mine?.people.rows.actor) };
    topSeeds.slice(0, 2).forEach((seed, i) => {
      const items = seerrCards(recPages[i]?.results ?? [], index, progress).filter((c) => !shown.has(c.key) && !exclude.has(c.key));
      if (items.length >= 6) because.push({ id: `because-${seed.key}`, title: t('Because you watched {name}', { name: seed.name }), style: 'poster', items });
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

  const [popularHere, ready] = await Promise.all([householdCards, settle(readyToWatch(user), [])]);
  const candidates: Row[] = [
    { id: 'ready', title: t('Ready to watch'), style: 'poster', items: ready },
    { id: 'continue', title: t('Continue Watching'), style: 'wide', items: continueWatching(userId, resume.Items, nextUp.Items, index, fresh) },
    { id: 'requested', title: t('Your requests'), style: 'poster', items: requested, href: '/activity' },
    { id: 'picks', title: t('Top picks for {name}', { name: user.name }), style: 'poster', items: picks },
    { id: 'suggestarr', title: t('SuggestArr picked for you'), style: 'poster', items: suggested },
    { id: 'popular-here', title: t('Popular on this server'), style: 'poster', items: popularHere.length >= 3 ? popularHere : [] },
    { id: 'latest-movies', title: t('Recently added movies'), style: 'poster', items: latestMovies.Items.map((i) => jfToCard(i, index)), href: '/movies' },
    { id: 'latest-shows', title: t('New episodes'), style: 'poster', items: latestShows.Items.map((i) => jfToCard(i, index)), href: '/shows' },
    { id: 'trakt-movies', title: t('Movies Trakt recommends'), style: 'poster', items: traktMovies },
    ...because.slice(0, 1),
    ...(people.director && people.director.items.length >= 4 ? [people.director] : []),
    { id: 'trakt-shows', title: t('Shows Trakt recommends'), style: 'poster', items: traktShows },
    { id: 'trending', title: t('Trending now'), style: 'poster', items: trending },
    ...(people.actor && people.actor.items.length >= 4 ? [people.actor] : []),
    ...because.slice(1),
    { id: 'popular-movies', title: t('Popular movies'), style: 'poster', items: popularMovies },
    { id: 'popular-tv', title: t('Popular shows'), style: 'poster', items: popularTv },
    { id: 'unwatched', title: t('Waiting in your library'), style: 'poster', items: unwatched.Items.map((i) => jfToCard(i, index)) },
    { id: 'upcoming', title: t('Coming soon to cinemas'), style: 'poster', items: upcoming },
  ];
  const rows = candidates.filter((row) => row.items.length > 0);

  // The big picture up top is always something to play now: from the library, never one to request.
  const have = (c: Card) => c.status === 'available' || c.status === 'partial';
  const rowItems = (id: string) => rows.find((r) => r.id === id)?.items ?? [];
  const heroPool = [...picks, ...rowItems('unwatched'), ...rowItems('latest-movies'), ...rowItems('popular-here'), ...trending]
    .filter((c, i, all) => have(c) && c.backdrop && c.overview && all.findIndex((x) => x.key === c.key) === i)
    .slice(0, 6);
  const hero = heroPool.length ? heroPool[Math.floor(Math.random() * heroPool.length)] : undefined;
  const play = hero?.jellyfinId ? await settle(playTarget(user, hero.mediaType, hero.jellyfinId), undefined) : undefined;

  return { hero: hero && { ...hero, play }, rows };
}
