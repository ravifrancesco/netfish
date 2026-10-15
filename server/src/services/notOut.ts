import type { NotOut } from '@netfish/shared';
import type { RadarrMovie, SonarrSeries } from '../clients/arr';
import type { SeerrMovie, SeerrTv } from '../clients/seerr';

/**
 * "Not out yet": the reason Radarr/Sonarr have nothing to download, and when that
 * changes. Radarr only searches once a movie is available (by default: out to stream
 * or buy), Sonarr only once an episode has aired. Their own view wins; TMDB's release
 * dates cover titles they don't manage yet.
 */

const DAY = 86_400_000;
const future = (date?: string | null) => (date && Date.parse(date) > Date.now() ? date : undefined);
const past = (date?: string | null) => Boolean(date && Date.parse(date) <= Date.now());
const earliest = (dates: Array<string | null | undefined>) => dates.filter((d): d is string => Boolean(d)).sort()[0];

export function movieNotOut(movie: SeerrMovie | undefined, managed: RadarrMovie | null | undefined): NotOut | undefined {
  if (managed) {
    // Radarr's "Not Available": it won't look for releases until the movie reaches its minimum availability.
    if (managed.hasFile || managed.isAvailable !== false) return undefined;
    const home = earliest([future(managed.digitalRelease), future(managed.physicalRelease)]);
    if (managed.status === 'inCinemas' || past(managed.inCinemas)) return { kind: 'cinemas', date: home };
    return { kind: 'unreleased', date: future(managed.inCinemas) ?? home };
  }
  if (!movie) return undefined;
  const dates = movie.releases?.results?.flatMap((r) => r.release_dates ?? []) ?? [];
  const of = (types: number[]) => earliest(dates.filter((d) => types.includes(d.type ?? 0)).map((d) => d.release_date));
  const cinemas = of([2, 3]) ?? movie.releaseDate;
  const home = of([4, 5]);
  if (past(home)) return undefined;
  if (future(cinemas)) return { kind: 'unreleased', date: cinemas };
  // Out in cinemas: still waiting for a digital release, unless that was long ago and TMDB just doesn't list it.
  if (cinemas && (home || Date.now() - Date.parse(cinemas) < 120 * DAY)) return { kind: 'cinemas', date: future(home) };
  return undefined;
}

/** `airing` only for shows Sonarr manages: only then does a new episode download by itself. */
export function showNotOut(tv: SeerrTv | undefined, managed: SonarrSeries | null | undefined): NotOut | undefined {
  if (managed) {
    if (managed.status === 'upcoming' || (!managed.previousAiring && managed.nextAiring)) {
      return { kind: 'premiere', date: future(managed.nextAiring) ?? future(managed.firstAired) };
    }
    return future(managed.nextAiring) ? { kind: 'airing', date: managed.nextAiring } : undefined;
  }
  if (tv && future(tv.firstAirDate)) return { kind: 'premiere', date: tv.firstAirDate };
  return undefined;
}

/** Radarr/Sonarr's reasons for not grabbing a release by themselves that mean "not out yet". */
export const NOT_OUT_REJECTION = /not (yet )?available|considered available|not (yet )?aired|hasn'?t aired|has not aired/i;
