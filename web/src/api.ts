import type {
  AppConfig,
  Card,
  ChannelAdmin,
  FreshStatus,
  ChannelSettings,
  ChannelsResponse,
  CleanupSuggestion,
  ProfilesResponse,
  ConnectionTest,
  CreateRequest,
  Device,
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
  Screen,
  TogetherCommand,
  TogetherControl,
  TogetherRoom,
  TogetherTracks,
  ServiceConnection,
  ServiceConnectionUpdate,
  ServiceStatus,
  TitleDetail,
  TrailerChoices,
  SuggestArrStatus,
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

/** Told when a request couldn't reach the server at all (the apps then check, and may go offline). */
let onUnreachable: () => void = () => {};
export function setUnreachableHandler(fn: () => void) {
  onUnreachable = fn;
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
    onUnreachable();
    throw new ApiError(0, t("Can't reach the Netfish server"));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Not this device's sign-in: a wrong password, or another profile's sign-in that has run out.
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/profiles/switch')) onUnauthorized();
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
  profiles: () => call<ProfilesResponse>('/profiles'),
  switchProfile: (userId: string, pin?: string) => call<User>('/profiles/switch', { body: { userId, pin } }),
  removeProfile: (userId: string) => call<{ ok: true }>(`/profiles/${enc(userId)}`, { method: 'DELETE' }),
  updateMyProfile: (patch: { pin?: string | null; ask?: boolean }) => call<ProfilesResponse>('/profiles/me', { method: 'PUT', body: patch }),

  home: () => call<HomeResponse>('/home'),
  ready: () => call<{ items: Card[] }>('/ready'),
  search: (q: string) => call<SearchResponse>(`/search?q=${enc(q)}`),
  person: (id: string) => call<PersonDetail>(`/person/${enc(id)}`),
  library: (type: MediaType, sort: string, start: number, limit = 60) =>
    call<{ items: Card[]; total: number }>(`/library?type=${type}&sort=${sort}&start=${start}&limit=${limit}`),
  discover: (kind: string, page = 1) => call<{ items: Card[]; page: number; totalPages: number }>(`/discover/${kind}?page=${page}`),

  title: (t: TitleRef) => call<TitleDetail>(`/title/${t.type}/${enc(String(t.id))}`),
  season: (t: TitleRef, n: number) => call<SeasonDetail>(`/title/${t.type}/${enc(String(t.id))}/season/${n}`),
  ratings: (type: MediaType, tmdbId: number) => call<Ratings>(`/title/${type}/${tmdbId}/ratings`),
  trailers: (type: MediaType, tmdbId: number) => call<TrailerChoices>(`/title/${type}/${tmdbId}/trailers`),
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
  devices: () => call<{ devices: Device[] }>('/admin/devices'),
  saveConnection: (id: string, update: ServiceConnectionUpdate) => call<ServiceConnection>(`/admin/connections/${id}`, { method: 'PUT', body: update }),
  resetConnection: (id: string) => call<ServiceConnection>(`/admin/connections/${id}`, { method: 'DELETE' }),
  testConnection: (id: string, update: ServiceConnectionUpdate) => call<ConnectionTest>(`/admin/connections/${id}/test`, { body: update }),
  setupJellyfin: (url: string, code?: string) => call<ConnectionTest>('/setup/jellyfin', { body: { url, code } }),
  saveAdminSettings: (patch: Partial<ServerSettings>) => call<ServerSettings>('/admin/settings', { method: 'PUT', body: patch }),
  trakt: () => call<TraktStatus>('/admin/trakt'),
  suggestarr: () => call<SuggestArrStatus>('/admin/suggestarr'),
  suggestarrRun: () => call<SuggestArrStatus>('/admin/suggestarr/run', { method: 'POST' }),
  traktLink: () => call<TraktStatus>('/admin/trakt/link', { method: 'POST' }),
  traktScrobble: (scrobble: boolean) => call<TraktStatus>('/admin/trakt', { method: 'PUT', body: { scrobble } }),
  traktImport: () => call<TraktStatus>('/admin/trakt/import', { method: 'POST' }),
  traktUnlink: () => call<TraktStatus>('/admin/trakt', { method: 'DELETE' }),

  playInfo: (itemId: string) => call<PlayInfo>(`/play/${enc(itemId)}`),
  /** apple: MP4 for Apple's player; mp4: MP4 with AAC/Opus/FLAC sound (Android); desktop takes MKV too. */
  offline: (itemId: string, target: 'desktop' | 'apple' | 'mp4' | 'original' = 'desktop') => call<OfflineDescriptor>(`/play/${enc(itemId)}/offline?target=${target}`),
  playSession: (itemId: string, body: PlaybackRequest) => call<PlaybackSession>(`/play/${enc(itemId)}/session`, { body }),
  progress: (report: ProgressReport, keepalive = false) => call<void>('/play/progress', { body: report, keepalive }),
  /** A channel's programme is over: the server's work on it stops, without saying where anyone got to. */
  endPlayback: (playSessionId: string, deviceId: string) => call<void>('/play/end', { body: { playSessionId, deviceId }, keepalive: true }),

  // Channels
  /** `from`: the guide looking ahead (up to three days). */
  channels: (hours = 4, from?: number) => call<ChannelsResponse>(`/channels?hours=${hours}${from ? `&from=${Math.round(from)}` : ''}`),
  /** This screen is on a channel (every half minute), or has just left it (`leaving`). */
  channelWatching: (id: string, clientId: string, leaving = false) =>
    call<{ ok: true }>(`/channels/${enc(id)}/watching`, { body: { clientId, ...(leaving ? { leaving } : {}) }, keepalive: leaving }),
  channelAdmin: () => call<ChannelAdmin>('/admin/channels'),
  saveChannels: (patch: Partial<ChannelSettings>) => call<ChannelAdmin>('/admin/channels', { method: 'PUT', body: patch }),
  resetChannels: () => call<ChannelAdmin>('/admin/channels/reset', { method: 'POST' }),
  /** A new title on a channel: keep it (it joins the library). */
  keepChannelTitle: (itemId: string) => call<{ ok: true }>('/channels/keep', { body: { itemId } }),
  freshStatus: () => call<FreshStatus>('/admin/channels/fresh'),
  freshRun: () => call<FreshStatus>('/admin/channels/fresh/run', { method: 'POST' }),
  freshKeep: (key: string) => call<FreshStatus>('/admin/channels/fresh/keep', { body: { key } }),
  freshRemove: (key: string) => call<FreshStatus>('/admin/channels/fresh/remove', { body: { key } }),

  setWatched: (itemId: string, watched: boolean) => call<{ ok: true }>(`/items/${enc(itemId)}/watched`, { body: { watched } }),
  hideFromContinue: (itemId: string) => call<{ ok: true }>(`/items/${enc(itemId)}/hide`, { method: 'POST' }),
  /** Take a request back before anything is on disk. */
  cancelRequest: (mediaType: MediaType, tmdbId: number) => call<{ ok: true }>(`/title/${mediaType}/${tmdbId}/request`, { method: 'DELETE' }),
  /** Where someone got to in a download watched on this device. */
  setPosition: (itemId: string, seconds: number, finished: boolean, at: string) =>
    call<{ ok: true }>(`/items/${enc(itemId)}/position`, { body: { seconds, finished, at } }),

  // Watch together
  rooms: () => call<{ rooms: TogetherRoom[] }>('/together'),
  room: (id: string) => call<TogetherRoom>(`/together/${enc(id)}`),
  /** Without a position, the room starts where the host left off. */
  createRoom: (itemId: string, position?: number) => call<TogetherRoom>('/together', { body: { itemId, position } }),
  roomControl: (id: string, body: TogetherControl) => call<TogetherRoom>(`/together/${enc(id)}/control`, { body }),
  roomWaiting: (id: string, clientId: string, waiting: boolean) => call<{ ok: true }>(`/together/${enc(id)}/waiting`, { body: { clientId, waiting } }),
  leaveRoom: (id: string, clientId: string) => call<{ ok: true }>(`/together/${enc(id)}/leave`, { body: { clientId } }),
  endRoom: (id: string) => call<{ ok: true }>(`/together/${enc(id)}`, { method: 'DELETE' }),
  roomTracks: (id: string, clientId: string, tracks: TogetherTracks) => call<{ ok: true }>(`/together/${enc(id)}/tracks`, { body: { clientId, tracks } }),
  roomCommand: (id: string, body: { clientId: string; to: string; action: TogetherCommand['action']; index?: number | null }) =>
    call<{ ok: true }>(`/together/${enc(id)}/command`, { body }),

  // Play on TV
  screens: () => call<{ screens: Screen[] }>('/screens'),
  playOn: (screenId: string, itemId: string, position?: number) => call<TogetherRoom>(`/screens/${enc(screenId)}/play`, { body: { itemId, position } }),
  stopDownload: (id: string, mode: StopMode) => call<{ ok: true }>(`/downloads/${enc(id)}/stop`, { body: { mode } }),
  deleteFromDisk: (type: MediaType, tmdbId: number, seasons?: number[]) =>
    call<{ freed: number }>(`/title/${type}/${tmdbId}/delete`, { body: { seasons } }),
  downloadAgain: (type: MediaType, tmdbId: number, seasons?: number[]) =>
    call<{ ok: true }>(`/title/${type}/${tmdbId}/redownload`, { body: { seasons } }),
  removed: (type: MediaType) => call<{ items: Card[] }>(`/library/removed?type=${type}`),
  storage: () => call<StorageInfo>('/admin/storage'),
  cleanup: () => call<{ items: CleanupSuggestion[] }>('/admin/cleanup'),
  keepForGood: (key: string) => call<{ ok: true }>('/admin/cleanup/keep', { body: { key } }),
};
