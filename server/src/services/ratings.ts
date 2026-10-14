import type { MediaType, Ratings } from '@netfish/shared';
import { config } from '../config';
import { seerr, type SeerrIMDb, type SeerrRT } from '../clients/seerr';
import { settle } from '../lib/async';
import { request } from '../lib/upstream';
import { onConnectionChange } from '../connections';
import { HOUR, TTLCache } from '../lib/cache';
import { catalog } from './catalog';

/**
 * IMDb and Rotten Tomatoes scores come through Seerr (which looks them up the
 * same way Radarr does). Lookups are slow and scores barely move: cache a day.
 */

const cache = new TTLCache<Ratings>(2000);
onConnectionChange((id) => (id === 'seerr' || id === 'mdblist') && cache.clear());

interface MdbRating {
  source: string;
  value?: number | null;
  score?: number | null;
  votes?: number | null;
}

/** MDBList aggregates scores from many sites, Letterboxd included. Free key, ~1000 lookups/day. */
async function mdblistRatings(mediaType: MediaType, tmdbId: number): Promise<Map<string, MdbRating>> {
  if (!config.mdblist.apiKey) return new Map();
  const res = await request<{ ratings?: MdbRating[] }>('MDBList', config.mdblist.url, `/tmdb/${mediaType === 'tv' ? 'show' : 'movie'}/${tmdbId}`, {
    query: { apikey: config.mdblist.apiKey },
    timeoutMs: 8000,
  });
  return new Map((res.ratings ?? []).filter((r) => r.value !== null && r.value !== undefined).map((r) => [r.source, r]));
}

export function titleRatings(mediaType: MediaType, tmdbId: number): Promise<Ratings> {
  return cache.wrap(`${mediaType}-${tmdbId}`, 24 * HOUR, async () => {
    const details = mediaType === 'movie' ? await catalog.movie(tmdbId) : await catalog.tv(tmdbId);
    const imdbId = details.externalIds?.imdbId;

    let rt: SeerrRT | undefined;
    let imdb: SeerrIMDb | undefined;
    const [fromSeerr, mdb] = await Promise.all([
      mediaType === 'movie'
        ? settle(seerr.movieRatings(tmdbId), {} as { rt?: SeerrRT; imdb?: SeerrIMDb })
        : settle(seerr.tvRatings(tmdbId).then((r) => ({ rt: r }) as { rt?: SeerrRT; imdb?: SeerrIMDb }), {}),
      settle(mdblistRatings(mediaType, tmdbId), new Map<string, MdbRating>()),
    ]);
    rt = fromSeerr.rt;
    imdb = fromSeerr.imdb;
    const lb = mdb.get('letterboxd');
    const mc = mdb.get('metacritic');
    const mdbImdb = mdb.get('imdb');
    const mdbTomatoes = mdb.get('tomatoes');
    const mdbPopcorn = mdb.get('popcorn');

    return {
      tmdb: details.voteAverage || undefined,
      imdb: imdb?.criticsScore
        ? { score: imdb.criticsScore, votes: imdb.criticsScoreCount }
        : mdbImdb?.value
          ? { score: Number(mdbImdb.value), votes: mdbImdb.votes ?? undefined }
          : undefined,
      rottenTomatoes:
        rt && (rt.criticsScore !== undefined || rt.audienceScore !== undefined)
          ? { critics: rt.criticsScore, criticsRating: rt.criticsRating, audience: rt.audienceScore, audienceRating: rt.audienceRating }
          : mdbTomatoes?.value || mdbPopcorn?.value
            ? { critics: mdbTomatoes?.value ?? undefined, audience: mdbPopcorn?.value ?? undefined }
            : undefined,
      letterboxd: lb?.value ? { score: Number(lb.value), votes: lb.votes ?? undefined } : undefined,
      metacritic: mc?.value ? { score: Number(mc.value) } : undefined,
      links: {
        tmdb: `https://www.themoviedb.org/${mediaType}/${tmdbId}`,
        imdb: imdb?.url ?? (imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined),
        rottenTomatoes: rt?.url,
        // Letterboxd resolves TMDB ids itself; movies only.
        letterboxd: mediaType === 'movie' ? `https://letterboxd.com/tmdb/${tmdbId}/` : undefined,
      },
    };
  });
}
