import { config, has } from '../config';
import { NotConfiguredError, request, type RequestOptions } from '../lib/upstream';
import { lang as requestLanguage } from '../lib/i18n';

/**
 * Seerr (Jellyseerr / Overseerr lineage) gives us TMDB discovery,
 * recommendations and the request workflow. We call it with the API key and,
 * where it matters, `X-API-User` so requests are filed as the right person.
 */

export const MediaStatus = { UNKNOWN: 1, PENDING: 2, PROCESSING: 3, PARTIALLY_AVAILABLE: 4, AVAILABLE: 5, BLOCKLISTED: 6, DELETED: 7 } as const;
export const RequestStatusCode = { PENDING: 1, APPROVED: 2, DECLINED: 3, FAILED: 4, COMPLETED: 5 } as const;

export interface SeerrUser {
  id: number;
  displayName?: string;
  username?: string;
  jellyfinUsername?: string;
  jellyfinUserId?: string;
  email?: string;
}

export interface SeerrRequest {
  id: number;
  status: number;
  type: 'movie' | 'tv';
  createdAt: string;
  is4k?: boolean;
  media: SeerrMediaInfo & { mediaType: 'movie' | 'tv' };
  requestedBy?: SeerrUser;
  seasons?: Array<{ seasonNumber: number; status: number }>;
}

export interface SeerrMediaInfo {
  id: number;
  tmdbId: number;
  tvdbId?: number;
  status: number;
  status4k?: number;
  externalServiceId?: number | null;
  jellyfinMediaId?: string | null;
  requests?: SeerrRequest[];
  seasons?: Array<{ seasonNumber: number; status: number }>;
}

export interface SeerrResult {
  id: number;
  mediaType: 'movie' | 'tv' | 'person' | 'collection';
  title?: string;
  name?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  originalLanguage?: string;
  mediaInfo?: SeerrMediaInfo;
  genreIds?: number[];
  voteCount?: number;
  popularity?: number;
  /** People only: their photo and a few titles they're known for. */
  profilePath?: string | null;
  knownFor?: SeerrResult[];
}

/** A film or show in someone's filmography. */
export interface SeerrCredit extends SeerrResult {
  character?: string;
  job?: string;
  department?: string;
}

export interface SeerrPerson {
  id: number;
  name: string;
  biography?: string;
  birthday?: string | null;
  deathday?: string | null;
  placeOfBirth?: string | null;
  profilePath?: string | null;
  knownForDepartment?: string;
}

export interface SeerrPage {
  page: number;
  totalPages: number;
  totalResults: number;
  results: SeerrResult[];
}

interface Credits {
  cast?: Array<{ id?: number; name: string; character?: string; profilePath?: string | null; order?: number }>;
  crew?: Array<{ id?: number; name: string; job?: string; department?: string; profilePath?: string | null }>;
}

interface Video {
  site?: string;
  key?: string;
  type?: string;
  name?: string;
}

export interface SeerrMovie {
  id: number;
  title: string;
  originalTitle?: string;
  overview?: string;
  tagline?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string;
  runtime?: number;
  genres?: Array<{ id: number; name: string }>;
  voteAverage?: number;
  originalLanguage?: string;
  credits?: Credits;
  relatedVideos?: Video[];
  /** TMDB release dates per country; type 2/3 = cinemas, 4 = digital, 5 = disc. */
  releases?: { results?: Array<{ iso_3166_1: string; release_dates?: Array<{ certification?: string; type?: number; release_date?: string }> }> };
  externalIds?: { imdbId?: string };
  mediaInfo?: SeerrMediaInfo;
}

export interface SeerrTv {
  id: number;
  name: string;
  nextEpisodeToAir?: { airDate?: string | null } | null;
  originalName?: string;
  overview?: string;
  tagline?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  firstAirDate?: string;
  episodeRunTime?: number[];
  genres?: Array<{ id: number; name: string }>;
  voteAverage?: number;
  originalLanguage?: string;
  credits?: Credits;
  createdBy?: Array<{ id?: number; name: string; profilePath?: string | null }>;
  networks?: Array<{ name: string }>;
  relatedVideos?: Video[];
  contentRatings?: { results?: Array<{ iso_3166_1: string; rating?: string }> };
  externalIds?: { tvdbId?: number; imdbId?: string };
  seasons?: Array<{ id: number; seasonNumber: number; name: string; episodeCount: number; airDate?: string | null; posterPath?: string | null; overview?: string }>;
  mediaInfo?: SeerrMediaInfo;
}

export interface SeerrRT {
  title: string;
  year?: number;
  url: string;
  criticsScore?: number;
  criticsRating?: string;
  audienceScore?: number;
  audienceRating?: string;
}

export interface SeerrIMDb {
  title: string;
  url: string;
  criticsScore: number;
  criticsScoreCount?: number;
}

export interface SeerrSeason {
  id: number;
  seasonNumber: number;
  name?: string;
  overview?: string;
  episodes: Array<{
    id: number;
    episodeNumber: number;
    seasonNumber: number;
    name: string;
    overview?: string;
    stillPath?: string | null;
    airDate?: string | null;
    runtime?: number;
  }>;
}

interface Options extends RequestOptions {
  /** Seerr user id to act as. */
  asUser?: number;
}

function seerrRequest<T>(path: string, opts: Options = {}) {
  if (!has.seerr()) throw new NotConfiguredError('Seerr');
  const headers: Record<string, string> = { 'x-api-key': config.seerr.apiKey! };
  if (opts.asUser) headers['x-api-user'] = String(opts.asUser);
  return request<T>('Seerr', `${config.seerr.url}/api/v1`, path, { ...opts, headers });
}

// TMDB text (titles, plots) in the person's language: Italian if they use Netfish in Italian,
// otherwise the server's METADATA_LANGUAGE.
const lang = () => ({ language: requestLanguage() === 'it' ? 'it' : config.metadataLanguage });

export type DiscoverKind = 'trending' | 'movies' | 'tv' | 'movies/upcoming' | 'tv/upcoming';

export const seerr = {
  status: () => seerrRequest<{ version: string }>('/status', { timeoutMs: 5000 }),

  search: (query: string, page = 1) => seerrRequest<SeerrPage>('/search', { query: { query, page, ...lang() } }),
  discover: (kind: DiscoverKind, page = 1, extra: Record<string, string | number> = {}) =>
    seerrRequest<SeerrPage>(`/discover/${kind}`, { query: { page, ...lang(), ...extra } }),
  /** `language`: another language than the person's (its trailers, say). */
  movie: (id: number, language?: string) => seerrRequest<SeerrMovie>(`/movie/${id}`, { query: language ? { language } : lang() }),
  tv: (id: number, language?: string) => seerrRequest<SeerrTv>(`/tv/${id}`, { query: language ? { language } : lang() }),
  season: (id: number, season: number) => seerrRequest<SeerrSeason>(`/tv/${id}/season/${season}`, { query: lang() }),
  movieRatings: (id: number) => seerrRequest<{ rt?: SeerrRT; imdb?: SeerrIMDb }>(`/movie/${id}/ratingscombined`, { timeoutMs: 20_000 }),
  tvRatings: (id: number) => seerrRequest<SeerrRT>(`/tv/${id}/ratings`, { timeoutMs: 20_000 }),
  recommendations: (type: 'movie' | 'tv', id: number, page = 1) =>
    seerrRequest<SeerrPage>(`/${type}/${id}/recommendations`, { query: { page, ...lang() } }),
  person: (id: number) => seerrRequest<SeerrPerson>(`/person/${id}`, { query: lang() }),
  personCredits: (id: number) =>
    seerrRequest<{ cast?: SeerrCredit[]; crew?: SeerrCredit[] }>(`/person/${id}/combined_credits`, { query: lang() }),

  createRequest: (
    body: { mediaType: 'movie' | 'tv'; mediaId: number; tvdbId?: number; seasons?: number[] | 'all'; is4k?: boolean },
    asUser: number,
  ) => seerrRequest<SeerrRequest>('/request', { method: 'POST', body, asUser }),
  requests: (query: Record<string, string | number | undefined>, asUser?: number) =>
    seerrRequest<{ pageInfo: { results: number }; results: SeerrRequest[] }>('/request', { query, asUser }),

  /** "unknown" makes a title requestable again (after its files were deleted, or a download stopped). */
  setMediaStatus: (mediaId: number, status: 'unknown' | 'available' | 'partial' | 'processing' | 'pending') =>
    seerrRequest<unknown>(`/media/${mediaId}/${status}`, { method: 'POST' }),
  /** Forget a title and every request for it: it reads "not requested" again. */
  deleteMedia: (mediaId: number) => seerrRequest<unknown>(`/media/${mediaId}`, { method: 'DELETE' }),
  userByJellyfinId: (jellyfinUserId: string) => seerrRequest<SeerrUser>(`/user/jellyfin/${jellyfinUserId}`),
  users: () => seerrRequest<{ results: SeerrUser[] }>('/user', { query: { take: 1000, skip: 0 } }),
  importJellyfinUsers: (jellyfinUserIds: string[]) =>
    seerrRequest<SeerrUser[]>('/user/import-from-jellyfin', { method: 'POST', body: { jellyfinUserIds } }),
};
