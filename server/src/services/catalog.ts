import { seerr, type DiscoverKind, type SeerrMovie, type SeerrPage, type SeerrSeason, type SeerrTv } from '../clients/seerr';
import { onConnectionChange } from '../connections';
import { HOUR, MINUTE, TTLCache } from '../lib/cache';
import { tmdbImage } from '../lib/images';

/**
 * Cached access to Seerr's TMDB data. Details stay short-lived because they
 * carry request/availability status; lists and recommendations change slowly.
 */

const movies = new TTLCache<SeerrMovie>(500);
const shows = new TTLCache<SeerrTv>(500);
const seasons = new TTLCache<SeerrSeason>(500);
const pages = new TTLCache<SeerrPage>(500);
const basics = new TTLCache<TitleBasics>(3000);
onConnectionChange((id) => {
  if (id !== 'seerr') return;
  [movies, shows, seasons, pages, basics].forEach((c) => c.clear());
});

export interface TitleBasics {
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  originalLanguage?: string;
}

const year = (d?: string | null) => (d ? Number(d.slice(0, 4)) || undefined : undefined);

export const catalog = {
  movie: (id: number) => movies.wrap(String(id), 2 * MINUTE, () => seerr.movie(id)),
  tv: (id: number) => shows.wrap(String(id), 2 * MINUTE, () => seerr.tv(id)),
  season: (id: number, n: number) => seasons.wrap(`${id}-${n}`, 30 * MINUTE, () => seerr.season(id, n)),
  recommendations: (type: 'movie' | 'tv', id: number) =>
    pages.wrap(`recs-${type}-${id}`, 6 * HOUR, () => seerr.recommendations(type, id)),
  discover: (kind: DiscoverKind, page = 1) => pages.wrap(`discover-${kind}-${page}`, 15 * MINUTE, () => seerr.discover(kind, page)),
  search: (query: string, page = 1) =>
    pages.wrap(`search-${page}-${query.toLowerCase()}`, 5 * MINUTE, () => seerr.search(query, page)),

  /** Title/poster only, cached for long: used to label request lists. */
  basics: (type: 'movie' | 'tv', id: number) =>
    basics.wrap(`${type}-${id}`, 12 * HOUR, async () => {
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
    (type === 'movie' ? movies : shows).delete(String(id));
    pages.deletePrefix('discover-');
    pages.deletePrefix('search-');
  },
};
