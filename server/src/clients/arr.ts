import { config, has } from '../config';
import { NotConfiguredError, request, type RequestOptions } from '../lib/upstream';

/** Radarr and Sonarr share the same v3 API style, so one small client covers both. */

export interface ArrQuality {
  quality?: { name?: string; resolution?: number; source?: string };
}

export interface ArrLanguage {
  id: number;
  name: string;
}

export interface ArrImage {
  coverType: string;
  remoteUrl?: string;
  url?: string;
}

export interface ArrQueueRecord {
  id: number;
  movieId?: number;
  seriesId?: number;
  episodeId?: number;
  seasonNumber?: number;
  movie?: { id: number; title: string; tmdbId: number; year?: number; images?: ArrImage[] };
  series?: { id: number; title: string; tvdbId: number; tmdbId?: number; images?: ArrImage[] };
  episode?: { seasonNumber: number; episodeNumber: number; title?: string };
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  status: string;
  trackedDownloadStatus?: 'ok' | 'warning' | 'error';
  trackedDownloadState?: string;
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
  errorMessage?: string;
  downloadId?: string;
  protocol?: string;
  title?: string;
  quality?: ArrQuality;
  languages?: ArrLanguage[];
}

export interface ArrRelease {
  guid: string;
  indexerId: number;
  indexer?: string;
  title: string;
  size: number;
  seeders?: number;
  leechers?: number;
  quality?: ArrQuality;
  languages?: ArrLanguage[];
  ageHours?: number;
  protocol?: string;
  rejected?: boolean;
  rejections?: string[];
  customFormatScore?: number;
  fullSeason?: boolean;
  seasonNumber?: number;
  episodeNumbers?: number[];
}

export interface ArrFile {
  id: number;
  seasonNumber?: number;
  quality?: ArrQuality;
  languages?: ArrLanguage[];
  customFormatScore?: number;
}

export interface RadarrMovie {
  id: number;
  title: string;
  tmdbId: number;
  hasFile?: boolean;
  images?: ArrImage[];
  movieFile?: ArrFile;
}

export interface SonarrSeries {
  id: number;
  title: string;
  tvdbId: number;
  tmdbId?: number;
  images?: ArrImage[];
}

function arrRequest<T>(service: 'radarr' | 'sonarr', path: string, opts: RequestOptions = {}) {
  const name = service === 'radarr' ? 'Radarr' : 'Sonarr';
  if (!has[service]()) throw new NotConfiguredError(name);
  const svc = config[service];
  return request<T>(name, `${svc.url}/api/v3`, path, { ...opts, headers: { 'x-api-key': svc.apiKey! } });
}

// Interactive searches fan out to every indexer through Prowlarr; give them time.
const SEARCH_TIMEOUT = 180_000;

export const radarr = {
  status: () => arrRequest<{ version: string }>('radarr', '/system/status', { timeoutMs: 5000 }),
  queue: () =>
    arrRequest<{ records: ArrQueueRecord[] }>('radarr', '/queue', {
      query: { page: 1, pageSize: 250, includeMovie: true, includeUnknownMovieItems: false },
    }),
  movieByTmdb: async (tmdbId: number) => (await arrRequest<RadarrMovie[]>('radarr', '/movie', { query: { tmdbId } }))[0],
  releases: (movieId: number) => arrRequest<ArrRelease[]>('radarr', '/release', { query: { movieId }, timeoutMs: SEARCH_TIMEOUT }),
  grab: (guid: string, indexerId: number) =>
    arrRequest<unknown>('radarr', '/release', { method: 'POST', body: { guid, indexerId }, timeoutMs: 60_000 }),
};

export const sonarr = {
  status: () => arrRequest<{ version: string }>('sonarr', '/system/status', { timeoutMs: 5000 }),
  queue: () =>
    arrRequest<{ records: ArrQueueRecord[] }>('sonarr', '/queue', {
      query: { page: 1, pageSize: 500, includeSeries: true, includeEpisode: true, includeUnknownSeriesItems: false },
    }),
  seriesByTvdb: async (tvdbId: number) => (await arrRequest<SonarrSeries[]>('sonarr', '/series', { query: { tvdbId } }))[0],
  episodeFiles: (seriesId: number) => arrRequest<ArrFile[]>('sonarr', '/episodefile', { query: { seriesId } }),
  episodes: (seriesId: number, seasonNumber: number) =>
    arrRequest<Array<{ id: number; seasonNumber: number; episodeNumber: number; episodeFileId?: number }>>('sonarr', '/episode', {
      query: { seriesId, seasonNumber },
    }),
  releases: (seriesId: number, seasonNumber: number) =>
    arrRequest<ArrRelease[]>('sonarr', '/release', { query: { seriesId, seasonNumber }, timeoutMs: SEARCH_TIMEOUT }),
  episodeReleases: (episodeId: number) =>
    arrRequest<ArrRelease[]>('sonarr', '/release', { query: { episodeId }, timeoutMs: SEARCH_TIMEOUT }),
  grab: (guid: string, indexerId: number) =>
    arrRequest<unknown>('sonarr', '/release', { method: 'POST', body: { guid, indexerId }, timeoutMs: 60_000 }),
};

export const posterOf = (images?: ArrImage[]) => images?.find((i) => i.coverType === 'poster')?.remoteUrl;
