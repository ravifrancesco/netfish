import { has } from '../config';
import { radarr, sonarr, type RadarrMovie, type SonarrSeries } from '../clients/arr';
import { onConnectionChange } from '../connections';
import { MINUTE, TTLCache } from '../lib/cache';

/** Find the Radarr movie / Sonarr series behind a TMDB/TVDB id (cached). */

const movies = new TTLCache<RadarrMovie | null>(500);
const series = new TTLCache<SonarrSeries | null>(500);
onConnectionChange((id) => {
  if (id === 'radarr') movies.clear();
  if (id === 'sonarr') series.clear();
});

export function radarrMovie(tmdbId: number): Promise<RadarrMovie | null> {
  if (!has.radarr()) return Promise.resolve(null);
  return movies.wrap(String(tmdbId), 2 * MINUTE, async () => (await radarr.movieByTmdb(tmdbId)) ?? null);
}

export function sonarrSeries(tvdbId: number | undefined): Promise<SonarrSeries | null> {
  if (!has.sonarr() || !tvdbId) return Promise.resolve(null);
  return series.wrap(String(tvdbId), 10 * MINUTE, async () => (await sonarr.seriesByTvdb(tvdbId)) ?? null);
}

export function forgetRadarrMovie(tmdbId: number) {
  movies.delete(String(tmdbId));
}
