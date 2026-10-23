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
  customFormats?: Array<{ id: number; name: string }>;
  customFormatScore?: number;
  indexer?: string;
  downloadClient?: string;
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
  /** Bytes on disk. */
  size?: number;
  quality?: ArrQuality;
  languages?: ArrLanguage[];
  customFormatScore?: number;
}

export interface RadarrMovie {
  id: number;
  title: string;
  tmdbId: number;
  hasFile?: boolean;
  /** Radarr only searches once this is true (its "minimum availability", e.g. released digitally). */
  isAvailable?: boolean;
  status?: 'tba' | 'announced' | 'inCinemas' | 'released' | 'deleted';
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  images?: ArrImage[];
  movieFile?: ArrFile;
  year?: number;
  monitored?: boolean;
  sizeOnDisk?: number;
  tags?: number[];
  qualityProfileId?: number;
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: { episodeFileCount?: number; episodeCount?: number; totalEpisodeCount?: number; sizeOnDisk?: number };
}

/** A disk as Radarr/Sonarr see it (inside their containers). */
export interface ArrDisk {
  path: string;
  label?: string;
  freeSpace: number;
  totalSpace: number;
}

/** Where the library lives: Radarr's movie folder, Sonarr's show folder. */
export interface ArrRootFolder {
  id: number;
  path: string;
  freeSpace?: number;
  totalSpace?: number;
}

export interface SonarrEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  episodeFileId?: number;
  monitored?: boolean;
}

/** Remove from the queue (and the torrent client). `skipRedownload: false` + `blocklist` makes Radarr/Sonarr look for another release. */
export interface QueueRemoval {
  blocklist: boolean;
  skipRedownload: boolean;
}

export interface SonarrSeries {
  id: number;
  title: string;
  tvdbId: number;
  tmdbId?: number;
  year?: number;
  monitored?: boolean;
  seasons?: SonarrSeason[];
  statistics?: { sizeOnDisk?: number; episodeFileCount?: number };
  status?: 'continuing' | 'ended' | 'upcoming' | 'deleted';
  firstAired?: string;
  previousAiring?: string;
  nextAiring?: string;
  images?: ArrImage[];
  tags?: number[];
  qualityProfileId?: number;
}

export interface ArrTag {
  id: number;
  label: string;
}

export interface ArrProfile {
  id: number;
  name: string;
  /** The whole profile (from /qualityprofile, and its schema): what it allows, upgrading or not. */
  upgradeAllowed?: boolean;
  cutoff?: number;
  items?: ArrProfileItem[];
}

/** A quality in a profile, or a group of them (Sonarr's and Radarr's "WEB 1080p"). */
export interface ArrProfileItem {
  id?: number;
  name?: string;
  quality?: { id: number; name?: string; resolution?: number };
  items?: ArrProfileItem[];
  allowed: boolean;
}

/** What Radarr/Sonarr's lookup returns: the title as they'd add it. */
export type ArrLookup = Record<string, unknown> & { title: string; seasons?: Array<{ seasonNumber: number; monitored?: boolean }> };

function arrRequest<T>(service: 'radarr' | 'sonarr', path: string, opts: RequestOptions = {}) {
  const name = service === 'radarr' ? 'Radarr' : 'Sonarr';
  if (!has[service]()) throw new NotConfiguredError(name);
  const svc = config[service];
  return request<T>(name, `${svc.url}/api/v3`, path, { ...opts, headers: { 'x-api-key': svc.apiKey! } });
}

// Interactive searches fan out to every indexer through Prowlarr; give them time.
const SEARCH_TIMEOUT = 180_000;

/** A history event: here, a file deleted (by hand or another tool, missing from disk, or "Upgrade": replaced by a better one). */
export interface ArrHistoryRecord {
  movieId?: number;
  seriesId?: number;
  episodeId?: number;
  eventType: string;
  date: string;
  data?: { reason?: string; size?: string | number };
}
const DELETIONS = { pageSize: 1000, sortKey: 'date', sortDirection: 'descending' };

export const radarr = {
  /** Movie files deleted, newest first (Radarr's MovieFileDeleted). */
  fileDeletions: () =>
    arrRequest<{ records: ArrHistoryRecord[] }>('radarr', '/history', { query: { ...DELETIONS, eventType: 6 }, timeoutMs: 30_000 }).then((r) =>
      (r.records ?? []).filter((h) => h.eventType === 'movieFileDeleted'),
    ),
  movieFileDeletions: (movieId: number) =>
    arrRequest<ArrHistoryRecord[]>('radarr', '/history/movie', { query: { movieId, eventType: 6 } }).then((r) =>
      (r ?? []).filter((h) => h.eventType === 'movieFileDeleted').sort((a, b) => b.date.localeCompare(a.date)),
    ),
  status: () => arrRequest<{ version: string }>('radarr', '/system/status', { timeoutMs: 5000 }),
  queue: () =>
    arrRequest<{ records: ArrQueueRecord[] }>('radarr', '/queue', {
      query: { page: 1, pageSize: 250, includeMovie: true, includeUnknownMovieItems: false },
    }),
  movieByTmdb: async (tmdbId: number) => (await arrRequest<RadarrMovie[]>('radarr', '/movie', { query: { tmdbId } }))[0],
  releases: (movieId: number) => arrRequest<ArrRelease[]>('radarr', '/release', { query: { movieId }, timeoutMs: SEARCH_TIMEOUT }),
  grab: (guid: string, indexerId: number) =>
    arrRequest<unknown>('radarr', '/release', { method: 'POST', body: { guid, indexerId }, timeoutMs: 60_000 }),
  movies: () => arrRequest<RadarrMovie[]>('radarr', '/movie', { timeoutMs: 30_000 }),
  removeFromQueue: (ids: number[], opts: QueueRemoval) =>
    arrRequest<void>('radarr', '/queue/bulk', { method: 'DELETE', query: { removeFromClient: true, ...opts }, body: { ids } }),
  setMonitored: (movieIds: number[], monitored: boolean) =>
    arrRequest<unknown>('radarr', '/movie/editor', { method: 'PUT', body: { movieIds, monitored } }),
  deleteFile: (movieFileId: number) => arrRequest<void>('radarr', `/moviefile/${movieFileId}`, { method: 'DELETE' }),
  /** Forget a movie (files kept: only used when it has none). */
  deleteMovie: (movieId: number) =>
    arrRequest<void>('radarr', `/movie/${movieId}`, { method: 'DELETE', query: { deleteFiles: false, addImportExclusion: false } }),
  search: (movieIds: number[]) => arrRequest<unknown>('radarr', '/command', { body: { name: 'MoviesSearch', movieIds } }),
  rootFolders: () => arrRequest<ArrRootFolder[]>('radarr', '/rootfolder'),
  diskSpace: () => arrRequest<ArrDisk[]>('radarr', '/diskspace'),
  tags: () => arrRequest<ArrTag[]>('radarr', '/tag'),
  addTag: (label: string) => arrRequest<ArrTag>('radarr', '/tag', { method: 'POST', body: { label } }),
  qualityProfiles: () => arrRequest<ArrProfile[]>('radarr', '/qualityprofile'),
  profileSchema: () => arrRequest<ArrProfile>('radarr', '/qualityprofile/schema'),
  addProfile: (profile: Omit<ArrProfile, 'id'>) => arrRequest<ArrProfile>('radarr', '/qualityprofile', { method: 'POST', body: profile }),
  updateProfile: (profile: ArrProfile) => arrRequest<ArrProfile>('radarr', `/qualityprofile/${profile.id}`, { method: 'PUT', body: profile }),
  setProfile: (movieIds: number[], qualityProfileId: number) =>
    arrRequest<unknown>('radarr', '/movie/editor', { method: 'PUT', body: { movieIds, qualityProfileId } }),
  lookup: (tmdbId: number) => arrRequest<ArrLookup>('radarr', '/movie/lookup/tmdb', { query: { tmdbId }, timeoutMs: 30_000 }),
  add: (movie: ArrLookup) => arrRequest<RadarrMovie>('radarr', '/movie', { method: 'POST', body: movie, timeoutMs: 30_000 }),
  /** Gone for good: the movie and its files. */
  remove: (movieId: number) =>
    arrRequest<void>('radarr', `/movie/${movieId}`, { method: 'DELETE', query: { deleteFiles: true, addImportExclusion: false } }),
};

export const sonarr = {
  /** Episode files deleted, newest first (Sonarr's EpisodeFileDeleted). */
  fileDeletions: () =>
    arrRequest<{ records: ArrHistoryRecord[] }>('sonarr', '/history', { query: { ...DELETIONS, eventType: 5 }, timeoutMs: 30_000 }).then((r) =>
      (r.records ?? []).filter((h) => h.eventType === 'episodeFileDeleted'),
    ),
  seriesFileDeletions: (seriesId: number) =>
    arrRequest<ArrHistoryRecord[]>('sonarr', '/history/series', { query: { seriesId, eventType: 5 } }).then((r) =>
      (r ?? []).filter((h) => h.eventType === 'episodeFileDeleted').sort((a, b) => b.date.localeCompare(a.date)),
    ),
  status: () => arrRequest<{ version: string }>('sonarr', '/system/status', { timeoutMs: 5000 }),
  queue: () =>
    arrRequest<{ records: ArrQueueRecord[] }>('sonarr', '/queue', {
      query: { page: 1, pageSize: 500, includeSeries: true, includeEpisode: true, includeUnknownSeriesItems: false },
    }),
  seriesByTvdb: async (tvdbId: number) => (await arrRequest<SonarrSeries[]>('sonarr', '/series', { query: { tvdbId } }))[0],
  episodeFiles: (seriesId: number) => arrRequest<ArrFile[]>('sonarr', '/episodefile', { query: { seriesId } }),
  episodes: (seriesId: number, seasonNumber?: number) =>
    arrRequest<SonarrEpisode[]>('sonarr', '/episode', { query: { seriesId, seasonNumber } }),
  releases: (seriesId: number, seasonNumber: number) =>
    arrRequest<ArrRelease[]>('sonarr', '/release', { query: { seriesId, seasonNumber }, timeoutMs: SEARCH_TIMEOUT }),
  episodeReleases: (episodeId: number) =>
    arrRequest<ArrRelease[]>('sonarr', '/release', { query: { episodeId }, timeoutMs: SEARCH_TIMEOUT }),
  grab: (guid: string, indexerId: number) =>
    arrRequest<unknown>('sonarr', '/release', { method: 'POST', body: { guid, indexerId }, timeoutMs: 60_000 }),
  allSeries: () => arrRequest<SonarrSeries[]>('sonarr', '/series', { timeoutMs: 30_000 }),
  removeFromQueue: (ids: number[], opts: QueueRemoval) =>
    arrRequest<void>('sonarr', '/queue/bulk', { method: 'DELETE', query: { removeFromClient: true, ...opts }, body: { ids } }),
  setEpisodesMonitored: (episodeIds: number[], monitored: boolean) =>
    arrRequest<unknown>('sonarr', '/episode/monitor', { method: 'PUT', body: { episodeIds, monitored } }),
  setSeriesMonitored: (seriesIds: number[], monitored: boolean) =>
    arrRequest<unknown>('sonarr', '/series/editor', { method: 'PUT', body: { seriesIds, monitored } }),
  /** Forget a show (files kept: only used when it has none). */
  deleteSeries: (seriesId: number) =>
    arrRequest<void>('sonarr', `/series/${seriesId}`, { method: 'DELETE', query: { deleteFiles: false, addImportListExclusion: false } }),
  deleteFiles: (episodeFileIds: number[]) =>
    arrRequest<void>('sonarr', '/episodefile/bulk', { method: 'DELETE', body: { episodeFileIds } }),
  searchSeason: (seriesId: number, seasonNumber: number) =>
    arrRequest<unknown>('sonarr', '/command', { body: { name: 'SeasonSearch', seriesId, seasonNumber } }),
  searchEpisodes: (episodeIds: number[]) => arrRequest<unknown>('sonarr', '/command', { body: { name: 'EpisodeSearch', episodeIds } }),
  rootFolders: () => arrRequest<ArrRootFolder[]>('sonarr', '/rootfolder'),
  diskSpace: () => arrRequest<ArrDisk[]>('sonarr', '/diskspace'),
  tags: () => arrRequest<ArrTag[]>('sonarr', '/tag'),
  addTag: (label: string) => arrRequest<ArrTag>('sonarr', '/tag', { method: 'POST', body: { label } }),
  qualityProfiles: () => arrRequest<ArrProfile[]>('sonarr', '/qualityprofile'),
  profileSchema: () => arrRequest<ArrProfile>('sonarr', '/qualityprofile/schema'),
  addProfile: (profile: Omit<ArrProfile, 'id'>) => arrRequest<ArrProfile>('sonarr', '/qualityprofile', { method: 'POST', body: profile }),
  updateProfile: (profile: ArrProfile) => arrRequest<ArrProfile>('sonarr', `/qualityprofile/${profile.id}`, { method: 'PUT', body: profile }),
  setProfile: (seriesIds: number[], qualityProfileId: number) =>
    arrRequest<unknown>('sonarr', '/series/editor', { method: 'PUT', body: { seriesIds, qualityProfileId } }),
  /** Sonarr 3 needs one when adding a show; Sonarr 4 has none. */
  languageProfiles: () => arrRequest<ArrProfile[]>('sonarr', '/languageprofile'),
  lookup: (tvdbId: number) => arrRequest<ArrLookup[]>('sonarr', '/series/lookup', { query: { term: `tvdb:${tvdbId}` }, timeoutMs: 30_000 }),
  add: (series: ArrLookup) => arrRequest<SonarrSeries>('sonarr', '/series', { method: 'POST', body: series, timeoutMs: 30_000 }),
  /** Gone for good: the show and its files. */
  remove: (seriesId: number) =>
    arrRequest<void>('sonarr', `/series/${seriesId}`, { method: 'DELETE', query: { deleteFiles: true, addImportListExclusion: false } }),
};

export const posterOf = (images?: ArrImage[]) => images?.find((i) => i.coverType === 'poster')?.remoteUrl;
