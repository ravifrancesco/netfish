import type { Card, MediaType, Row } from '@netfish/shared';
import type { SeerrCredit, SeerrPage, SeerrResult } from '../clients/seerr';
import { mapLimit, settle } from '../lib/async';
import { t } from '../lib/i18n';
import { seerrCards, type ProgressMap } from './cards';
import { catalog, type PersonRef } from './catalog';
import { findInLibrary, type LibraryIndex } from './library';
import { creditLists, watchableFirst } from './people';

/**
 * Netfish's own recommendations, free and on the Pi: what someone watched says
 * which genres, directors and actors they like; TMDB (through Seerr) says what
 * people who liked those titles also liked; the rest of the server says what's
 * popular here. Each pick gets a score from all of that together.
 */

export interface Seed {
  key: string;
  mediaType: MediaType;
  tmdbId: number;
  name: string;
  /** Newer watches count more. */
  weight: number;
}

interface Fan extends PersonRef {
  weight: number;
  /** Which of the watched titles they're in. */
  titles: Set<string>;
  creator?: boolean;
}

export interface Taste {
  genres: Map<number, number>;
  directors: Map<number, Fan>;
  actors: Map<number, Fan>;
}

const add = (map: Map<number, Fan>, person: PersonRef, weight: number, seed: string, creator?: boolean) => {
  const fan = map.get(person.id) ?? { ...person, weight: 0, titles: new Set<string>(), creator };
  fan.weight += weight;
  fan.titles.add(seed);
  map.set(person.id, fan);
};

/** Genres and people across someone's recent watches (titles' details are cached for a day). */
export async function tasteOf(seeds: Seed[]): Promise<Taste> {
  const top = seeds.slice(0, 15);
  const details = await mapLimit(top, 4, (s) => settle(catalog.taste(s.mediaType, s.tmdbId), undefined));
  const taste: Taste = { genres: new Map(), directors: new Map(), actors: new Map() };
  details.forEach((d, i) => {
    if (!d) return;
    const { weight, key } = top[i];
    for (const g of d.genres) taste.genres.set(g, (taste.genres.get(g) ?? 0) + weight / Math.sqrt(d.genres.length));
    for (const p of d.directors) add(taste.directors, p, 3 * weight, key);
    for (const p of d.creators) add(taste.directors, p, 2.5 * weight, key, true);
    d.cast.forEach((p, order) => add(taste.actors, p, (1.2 - order * 0.2) * weight, key));
  });
  return taste;
}

const strongest = (map: Map<number, Fan>, minTitles: number) =>
  [...map.values()].filter((f) => f.titles.size >= minTitles).sort((a, b) => b.weight - a.weight);

// ---------- Rows about people ----------

export interface PeopleRows {
  rows: { director?: Row; actor?: Row };
  /** Their other work, as candidates for Top picks. */
  candidates: Array<{ result: SeerrResult; weight: number }>;
}

async function personRow(
  fans: Fan[],
  kind: 'director' | 'actor',
  exclude: Set<string>,
  index: LibraryIndex,
  progress: ProgressMap,
): Promise<{ row?: Row; credits: SeerrCredit[]; fan?: Fan }> {
  for (const fan of fans.slice(0, 3)) {
    const credits = await settle(catalog.personCredits(fan.id), undefined);
    if (!credits) continue;
    const lists = creditLists(credits);
    const work = kind === 'actor' ? lists.acted : fan.creator ? [...lists.created, ...lists.directed] : lists.directed;
    const items = watchableFirst(seerrCards(work, index, progress)).filter((c) => !exclude.has(c.key));
    if (items.length < 4) continue;
    const title = kind === 'actor' ? t('Because you like {name}', { name: fan.name }) : t('More from {name}', { name: fan.name });
    return { row: { id: `${kind}-${fan.id}`, title, style: 'poster', items, href: `/person/${fan.id}` }, credits: work, fan };
  }
  return { credits: [] };
}

/**
 * "More from <director>" for the director (or show creator) someone watches most,
 * and "Because you like <actor>" for an actor in at least two of their recent watches.
 */
export async function peopleRows(taste: Taste, exclude: Set<string>, index: LibraryIndex, progress: ProgressMap): Promise<PeopleRows> {
  const [director, actor] = await Promise.all([
    personRow(strongest(taste.directors, 1), 'director', exclude, index, progress),
    personRow(strongest(taste.actors, 2), 'actor', exclude, index, progress),
  ]);
  const top = Math.max(director.fan?.weight ?? 0, actor.fan?.weight ?? 0, 0.0001);
  const candidates = [director, actor].flatMap(({ credits, fan }) =>
    fan ? credits.slice(0, 12).map((result) => ({ result, weight: fan.weight / top })) : [],
  );
  return { rows: { director: director.row, actor: actor.row }, candidates };
}

// ---------- Top picks ----------

interface Candidate {
  result: SeerrResult;
  /** TMDB: "people who liked your titles also liked this", summed over them. */
  rec: number;
  /** Made by or starring someone they watch a lot (0..1). */
  people: number;
  /** The watched title that brought it in, so one title can't fill the row. */
  seed: string;
}

export function rankPicks(opts: {
  seeds: Seed[];
  recPages: Array<SeerrPage | undefined>;
  taste: Taste;
  people: PeopleRows['candidates'];
  /** `movie-<tmdbId>` keys others on the server watched lately. */
  household: Set<string>;
  exclude: Set<string>;
  index: LibraryIndex;
  progress: ProgressMap;
}): Card[] {
  const { seeds, recPages, taste, household, exclude, index, progress } = opts;
  const candidates = new Map<string, Candidate>();
  const consider = (r: SeerrResult, seed: string): Candidate | undefined => {
    if (r.mediaType !== 'movie' && r.mediaType !== 'tv') return undefined;
    const key = `${r.mediaType}-${r.id}`;
    if (exclude.has(key)) return undefined;
    const c = candidates.get(key) ?? { result: r, rec: 0, people: 0, seed };
    candidates.set(key, c);
    return c;
  };
  recPages.forEach((page, i) => {
    const seed = seeds[i];
    if (!seed) return;
    page?.results.forEach((r, position) => {
      const c = consider(r, seed.key);
      if (c) c.rec += seed.weight * (1 - position / 40);
    });
  });
  for (const { result, weight } of opts.people) {
    const c = consider(result, `person-${result.id}`);
    if (c) c.people = Math.max(c.people, weight);
  }

  const maxRec = Math.max(0.0001, ...[...candidates.values()].map((c) => c.rec));
  const maxGenre = Math.max(0.0001, ...taste.genres.values());
  const score = (key: string, c: Candidate) => {
    const r = c.result;
    const genres = r.genreIds ?? [];
    const genre = genres.length ? genres.reduce((sum, g) => sum + (taste.genres.get(g) ?? 0), 0) / genres.length / maxGenre : 0;
    // Well rated by many people: a small push. Rated by a handful: no push either way.
    const quality = Math.max(-0.5, Math.min(1, ((r.voteAverage ?? 6) - 6) / 2.5)) * Math.min(1, (r.voteCount ?? 0) / 300);
    const inLibrary = Boolean(findInLibrary(index, r.mediaType as MediaType, r.id, r.mediaInfo?.tvdbId));
    return c.rec / maxRec + 0.5 * genre + 0.4 * c.people + (household.has(key) ? 0.3 : 0) + 0.15 * quality + (inLibrary ? 0.1 : 0);
  };

  // Best first, but each extra pick from the same watched title costs a little, so the row stays varied.
  const pool = [...candidates].map(([key, c]) => ({ c, s: score(key, c) }));
  const perSeed = new Map<string, number>();
  const picked: SeerrResult[] = [];
  while (pool.length && picked.length < 30) {
    let best = 0;
    let bestScore = -Infinity;
    pool.forEach((p, i) => {
      const s = p.s - 0.12 * (perSeed.get(p.c.seed) ?? 0);
      if (s > bestScore) [best, bestScore] = [i, s];
    });
    const [{ c }] = pool.splice(best, 1);
    perSeed.set(c.seed, (perSeed.get(c.seed) ?? 0) + 1);
    picked.push(c.result);
  }
  return seerrCards(picked, index, progress).slice(0, 24);
}
