import type {
  AppConfig,
  Card,
  ConnectionTest,
  CreateRequest,
  DownloadsResponse,
  HomeResponse,
  Job,
  Language,
  LoginRequest,
  MediaType,
  OfflineDescriptor,
  PersonDetail,
  PlayInfo,
  PlaybackRequest,
  PlaybackSession,
  ProgressReport,
  Ratings,
  ReleaseSearch,
  ReleasesResponse,
  RequestSummary,
  RequestsResponse,
  SearchResponse,
  SeasonDetail,
  ServerSettings,
  StopMode,
  StorageInfo,
  ServiceConnection,
  ServiceConnectionUpdate,
  ServiceStatus,
  TitleDetail,
  TraktStatus,
  User,
} from '@netfish/shared';
import { language, t } from './i18n';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly service?: string,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function call<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      // The server answers in the interface's language (error messages, track names…).
      headers: { 'x-netfish': '1', 'x-netfish-lang': language, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      keepalive: init.keepalive,
    });
  } catch {
    throw new ApiError(0, t("Can't reach the Netfish server"));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, data.error ?? res.statusText, data.service);
  }
  return data as T;
}

const enc = encodeURIComponent;
export type TitleRef = { type: MediaType | 'jf'; id: string | number };

export const api = {
  config: () => call<AppConfig>('/config'),
  me: () => call<User>('/auth/me'),
  login: (body: LoginRequest) => call<{ user: User }>('/auth/login', { body }),
  logout: () => call<{ ok: true }>('/auth/logout', { method: 'POST' }),

  home: () => call<HomeResponse>('/home'),
  search: (q: string) => call<SearchResponse>(`/search?q=${enc(q)}`),
  person: (id: string) => call<PersonDetail>(`/person/${enc(id)}`),
  library: (type: MediaType, sort: string, start: number, limit = 60) =>
    call<{ items: Card[]; total: number }>(`/library?type=${type}&sort=${sort}&start=${start}&limit=${limit}`),
  discover: (kind: string, page = 1) => call<{ items: Card[]; page: number; totalPages: number }>(`/discover/${kind}?page=${page}`),

  title: (t: TitleRef) => call<TitleDetail>(`/title/${t.type}/${enc(String(t.id))}`),
  season: (t: TitleRef, n: number) => call<SeasonDetail>(`/title/${t.type}/${enc(String(t.id))}/season/${n}`),
  ratings: (type: MediaType, tmdbId: number) => call<Ratings>(`/title/${type}/${tmdbId}/ratings`),
  jobs: (type: MediaType, tmdbId: number) => call<{ items: Job[] }>(`/title/${type}/${tmdbId}/jobs`),
  releases: (type: MediaType, tmdbId: number, body: ReleaseSearch) => call<ReleasesResponse>(`/title/${type}/${tmdbId}/releases`, { body }),
  grab: (type: MediaType, tmdbId: number, guid: string, indexerId: number) =>
    call<{ ok: true }>(`/title/${type}/${tmdbId}/grab`, { body: { guid, indexerId } }),
  subtitles: (type: MediaType, tmdbId: number, body: { language: string; seasonNumber?: number; episodeId?: string }) =>
    call<Job>(`/title/${type}/${tmdbId}/subtitles`, { body }),

  requests: (scope: 'mine' | 'all' = 'mine') => call<RequestsResponse>(`/requests?scope=${scope}`),
  request: (body: CreateRequest) => call<RequestSummary>('/requests', { body }),
  downloads: () => call<DownloadsResponse>('/downloads'),
  languages: () => call<Language[]>('/languages'),
  status: () => call<{ items: ServiceStatus[] }>('/status'),
  adminSettings: () => call<ServerSettings>('/admin/settings'),
  connections: () => call<{ items: ServiceConnection[] }>('/admin/connections'),
  saveConnection: (id: string, update: ServiceConnectionUpdate) => call<ServiceConnection>(`/admin/connections/${id}`, { method: 'PUT', body: update }),
  resetConnection: (id: string) => call<ServiceConnection>(`/admin/connections/${id}`, { method: 'DELETE' }),
  testConnection: (id: string, update: ServiceConnectionUpdate) => call<ConnectionTest>(`/admin/connections/${id}/test`, { body: update }),
  setupJellyfin: (url: string, code?: string) => call<ConnectionTest>('/setup/jellyfin', { body: { url, code } }),
  saveAdminSettings: (patch: Partial<ServerSettings>) => call<ServerSettings>('/admin/settings', { method: 'PUT', body: patch }),
  trakt: () => call<TraktStatus>('/admin/trakt'),
  traktLink: () => call<TraktStatus>('/admin/trakt/link', { method: 'POST' }),
  traktScrobble: (scrobble: boolean) => call<TraktStatus>('/admin/trakt', { method: 'PUT', body: { scrobble } }),
  traktImport: () => call<TraktStatus>('/admin/trakt/import', { method: 'POST' }),
  traktUnlink: () => call<TraktStatus>('/admin/trakt', { method: 'DELETE' }),

  playInfo: (itemId: string) => call<PlayInfo>(`/play/${enc(itemId)}`),
  /** apple: MP4 for Apple's player; mp4: MP4 with AAC/Opus/FLAC sound (Android); desktop takes MKV too. */
  offline: (itemId: string, target: 'desktop' | 'apple' | 'mp4' | 'original' = 'desktop') => call<OfflineDescriptor>(`/play/${enc(itemId)}/offline?target=${target}`),
  playSession: (itemId: string, body: PlaybackRequest) => call<PlaybackSession>(`/play/${enc(itemId)}/session`, { body }),
  progress: (report: ProgressReport, keepalive = false) => call<void>('/play/progress', { body: report, keepalive }),

  stopDownload: (id: string, mode: StopMode) => call<{ ok: true }>(`/downloads/${enc(id)}/stop`, { body: { mode } }),
  deleteFromDisk: (type: MediaType, tmdbId: number, seasons?: number[]) =>
    call<{ freed: number }>(`/title/${type}/${tmdbId}/delete`, { body: { seasons } }),
  downloadAgain: (type: MediaType, tmdbId: number, seasons?: number[]) =>
    call<{ ok: true }>(`/title/${type}/${tmdbId}/redownload`, { body: { seasons } }),
  removed: (type: MediaType) => call<{ items: Card[] }>(`/library/removed?type=${type}`),
  storage: () => call<StorageInfo>('/admin/storage'),
};
