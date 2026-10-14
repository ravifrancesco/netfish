import { seerr, type DiscoverKind, type SeerrCredit, type SeerrMovie, type SeerrPage, type SeerrPerson, type SeerrSeason, type SeerrTv } from '../clients/seerr';
import { onConnectionChange } from '../connections';
import { HOUR, MINUTE, TTLCache } from '../lib/cache';
import { tmdbImage } from '../lib/images';
import { lang, type Language } from '../lib/i18n';

const LANGUAGES: Language[] = ['en', 'it'];

/**
 * Cached access to Seerr's TMDB data. Details stay short-lived because they
 * carry request/availability status; lists and recommendations change slowly.
 * Every entry is kept per language (key ends in ":en" / ":it"): titles and plots differ.
 */

const movies = new TTLCache<SeerrMovie>(500);
const shows = new TTLCache<SeerrTv>(500);
const seasons = new TTLCache<SeerrSeason>(500);
const pages = new TTLCache<SeerrPage>(500);
const basics = new TTLCache<TitleBasics>(3000);
const people = new TTLCache<SeerrPerson>(300);
const tastes = new TTLCache<TitleTaste>(3000);
const credits = new TTLCache<{ cast?: SeerrCredit[]; crew?: SeerrCredit[] }>(300);
onConnectionChange((id) => {
  if (id !== 'seerr') return;
  [movies, shows, seasons, pages, basics, people, credits, tastes].forEach((c) => c.clear());
});

export interface PersonRef {
  id: number;
  name: string;
}

/** What a title says about someone's taste: its genres and the people who made it. */
export interface TitleTaste {
  genres: number[];
  directors: PersonRef[];
  creators: PersonRef[];
  /** Top-billed only. */
  cast: PersonRef[];
}

const refs = (list: Array<{ id?: number; name: string }> | undefined) =>
  (list ?? []).filter((p): p is PersonRef => Boolean(p.id)).map(({ id, name }) => ({ id, name }));

export interface TitleBasics {
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  originalLanguage?: string;
}

const year = (d?: string | null) => (d ? Number(d.slice(0, 4)) || undefined : undefined);

export const catalog = {
  movie: (id: number) => movies.wrap(`${id}:${lang()}`, 2 * MINUTE, () => seerr.movie(id)),
  tv: (id: number) => shows.wrap(`${id}:${lang()}`, 2 * MINUTE, () => seerr.tv(id)),
  season: (id: number, n: number) => seasons.wrap(`${id}-${n}:${lang()}`, 30 * MINUTE, () => seerr.season(id, n)),
  recommendations: (type: 'movie' | 'tv', id: number) =>
    pages.wrap(`recs-${type}-${id}:${lang()}`, 6 * HOUR, () => seerr.recommendations(type, id)),
  discover: (kind: DiscoverKind, page = 1) =>
    pages.wrap(`discover-${kind}-${page}:${lang()}`, 15 * MINUTE, () => seerr.discover(kind, page)),
  search: (query: string, page = 1) =>
    pages.wrap(`search-${page}-${query.toLowerCase()}:${lang()}`, 5 * MINUTE, () => seerr.search(query, page)),
  person: (id: number) => people.wrap(`${id}:${lang()}`, 6 * HOUR, () => seerr.person(id)),
  /** Filmographies carry availability too, so they stay fresh-ish. */
  personCredits: (id: number) => credits.wrap(`${id}:${lang()}`, 20 * MINUTE, () => seerr.personCredits(id)),

  /** Genres and people of a title, kept for a day (they don't change, and Home asks for many). */
  taste: (type: 'movie' | 'tv', id: number) =>
    tastes.wrap(`${type}-${id}`, 24 * HOUR, async (): Promise<TitleTaste> => {
      const d = type === 'movie' ? await catalog.movie(id) : await catalog.tv(id);
      const cast = [...(d.credits?.cast ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).slice(0, 5);
      return {
        genres: (d.genres ?? []).map((g) => g.id),
        directors: type === 'movie' ? refs(d.credits?.crew?.filter((c) => c.job === 'Director')) : [],
        creators: 'createdBy' in d ? refs(d.createdBy) : [],
        cast: refs(cast),
      };
    }),

  /** Title/poster only, cached for long: used to label request lists. */
  basics: (type: 'movie' | 'tv', id: number) =>
    basics.wrap(`${type}-${id}:${lang()}`, 12 * HOUR, async () => {
      if (type === 'movie') {
        const m = await catalog.movie(id);
        return {
          title: m.title,
          year: year(m.releaseDate),
          poster: tmdbImage(m.posterPath, 'w342'),
          backdrop: tmdbImage(m.backdropPath, 'w1280'),
          originalLanguage: m.originalLanguage,
        };
      }
      const t = await catalog.tv(id);
      return {
        title: t.name,
        year: year(t.firstAirDate),
        poster: tmdbImage(t.posterPath, 'w342'),
        backdrop: tmdbImage(t.backdropPath, 'w1280'),
        originalLanguage: t.originalLanguage,
      };
    }),

  /** Drop cached status after we change something (e.g. a new request). */
  invalidate(type: 'movie' | 'tv', id: number) {
    for (const language of LANGUAGES) (type === 'movie' ? movies : shows).delete(`${id}:${language}`);
    pages.deletePrefix('discover-');
    pages.deletePrefix('search-');
  },
};
