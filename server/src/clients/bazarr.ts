import { config, has } from '../config';
import { NotConfiguredError, request, type RequestOptions } from '../lib/upstream';

/** Bazarr fetches subtitles. Its download endpoints search providers synchronously. */

export interface BazarrSubtitle {
  code2?: string;
  name?: string;
  forced?: boolean;
  hi?: boolean;
  path?: string | null;
}

export interface BazarrEpisode {
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  season: number;
  episode: number;
  title?: string;
  subtitles?: BazarrSubtitle[];
}

export interface BazarrMovie {
  radarrId: number;
  title?: string;
  subtitles?: BazarrSubtitle[];
}

function bazarrRequest<T>(path: string, opts: RequestOptions = {}) {
  if (!has.bazarr()) throw new NotConfiguredError('Bazarr');
  return request<T>('Bazarr', `${config.bazarr.url}/api`, path, {
    ...opts,
    headers: { 'x-api-key': config.bazarr.apiKey! },
  });
}

const flag = (v: boolean) => (v ? 'True' : 'False');
const SEARCH_TIMEOUT = 180_000;

export const bazarr = {
  status: () => bazarrRequest<{ data?: { bazarr_version?: string } }>('/system/status', { timeoutMs: 5000 }),
  languages: () => bazarrRequest<Array<{ code2: string; name: string; enabled: boolean }>>('/system/languages'),
  movie: async (radarrId: number) =>
    (await bazarrRequest<{ data: BazarrMovie[] }>('/movies', { query: { 'radarrid[]': [radarrId] } })).data[0],
  episodes: async (seriesId: number) =>
    (await bazarrRequest<{ data: BazarrEpisode[] }>('/episodes', { query: { 'seriesid[]': [seriesId] } })).data,
  downloadMovie: (radarrId: number, language: string, hi = false) =>
    bazarrRequest<void>('/movies/subtitles', {
      method: 'PATCH',
      query: { radarrid: radarrId, language, forced: flag(false), hi: flag(hi) },
      timeoutMs: SEARCH_TIMEOUT,
    }),
  downloadEpisode: (seriesId: number, episodeId: number, language: string, hi = false) =>
    bazarrRequest<void>('/episodes/subtitles', {
      method: 'PATCH',
      query: { seriesid: seriesId, episodeid: episodeId, language, forced: flag(false), hi: flag(hi) },
      timeoutMs: SEARCH_TIMEOUT,
    }),
};
