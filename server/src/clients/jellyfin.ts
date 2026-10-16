import { config, has } from '../config';
import { NotConfiguredError, request, type RequestOptions } from '../lib/upstream';

/**
 * Jellyfin is Netfish's (hidden) media engine for now: logins, library,
 * streaming. Clients never see Jellyfin shapes; only this server does.
 */

export interface DeviceInfo {
  id: string;
  name: string;
}

const enc = (v: string) => encodeURIComponent(v);

/** Modern auth header. Jellyfin 12+ dropped the legacy X-Emby-* / api_key forms. */
export function authHeader(token?: string, device?: DeviceInfo): string {
  const parts = [`Client="Netfish"`, `Version="${enc(config.version)}"`];
  if (device) parts.push(`Device="${enc(device.name)}"`, `DeviceId="${enc(device.id)}"`);
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

function base(): string {
  if (!has.jellyfin()) throw new NotConfiguredError('Jellyfin');
  return config.jellyfin.url!;
}

export function jfRequest<T>(token: string | undefined, path: string, opts: RequestOptions = {}) {
  return request<T>('Jellyfin', base(), path, {
    ...opts,
    headers: { authorization: authHeader(token), ...opts.headers },
  });
}

// ---------- Shapes we actually use (subset of Jellyfin's DTOs) ----------

export interface JfUser {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  Policy?: { IsAdministrator?: boolean; EnableContentDownloading?: boolean };
  /** The person's own playback settings ("ita", "eng"…; empty for any). */
  Configuration?: { AudioLanguagePreference?: string; SubtitleLanguagePreference?: string };
}

export interface JfAuthResult {
  User: JfUser;
  AccessToken: string;
  ServerId: string;
}

export interface JfUserData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  IsFavorite?: boolean;
  LastPlayedDate?: string;
}

export interface JfMediaStream {
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage' | 'Data' | 'Lyric';
  Index: number;
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  DeliveryMethod?: 'Encode' | 'Embed' | 'External' | 'Hls' | 'Drop';
  DeliveryUrl?: string;
  Channels?: number;
}

export interface JfMediaSource {
  Id: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  TranscodeReasons?: string[] | string;
  MediaStreams?: JfMediaStream[];
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
}

export interface JfItem {
  Id: string;
  Name: string;
  OriginalTitle?: string;
  Type: 'Movie' | 'Series' | 'Season' | 'Episode' | string;
  ProductionYear?: number;
  PremiereDate?: string;
  Overview?: string;
  Taglines?: string[];
  Genres?: string[];
  CommunityRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  ProviderIds?: Record<string, string>;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeriesPrimaryImageTag?: string;
  SeasonId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  UserData?: JfUserData;
  MediaSources?: JfMediaSource[];
  MediaStreams?: JfMediaStream[];
  DateCreated?: string;
  LocationType?: string;
  IndexNumberEnd?: number;
  People?: Array<{ Id: string; Name: string; Role?: string; Type?: string; PrimaryImageTag?: string }>;
}

export interface JfItemsResult {
  Items: JfItem[];
  TotalRecordCount: number;
}

export const CARD_FIELDS = 'ProviderIds,Overview,PremiereDate,Genres';

// ---------- Calls ----------

export const jellyfin = {
  authenticate(username: string, password: string, device: DeviceInfo) {
    return request<JfAuthResult>('Jellyfin', base(), '/Users/AuthenticateByName', {
      body: { Username: username, Pw: password },
      headers: { authorization: authHeader(undefined, device) },
    });
  },
  me: (token: string) => jfRequest<JfUser>(token, '/Users/Me'),
  /** Every account on the server. Needs admin rights. */
  users: (token: string) => jfRequest<JfUser[]>(token, '/Users'),
  logout: (token: string) => jfRequest<void>(token, '/Sessions/Logout', { method: 'POST' }),
  publicInfo: () =>
    request<{ ServerName: string; Version: string; Id: string }>('Jellyfin', base(), '/System/Info/Public', {
      timeoutMs: 5000,
    }),

  items: (token: string, query: Record<string, string | number | boolean | undefined>) =>
    jfRequest<JfItemsResult>(token, '/Items', { query }),
  /** People in the library (actors, directors…), e.g. by name with `searchTerm`. */
  persons: (token: string, query: Record<string, string | number | boolean | undefined>) =>
    jfRequest<JfItemsResult>(token, '/Persons', { query }),
  item: (token: string, userId: string, itemId: string) =>
    jfRequest<JfItem>(token, `/Items/${itemId}`, { query: { userId } }),
  resume: (token: string, userId: string, limit = 16) =>
    jfRequest<JfItemsResult>(token, '/UserItems/Resume', {
      query: { userId, limit, mediaTypes: 'Video', fields: CARD_FIELDS, enableImageTypes: 'Primary,Backdrop,Thumb' },
    }),
  nextUp: (token: string, userId: string, query: Record<string, string | number | boolean | undefined> = {}) =>
    jfRequest<JfItemsResult>(token, '/Shows/NextUp', {
      query: { userId, limit: 16, fields: CARD_FIELDS, enableResumable: false, enableRewatching: false, ...query },
    }),
  seasons: (token: string, userId: string, seriesId: string) =>
    jfRequest<JfItemsResult>(token, `/Shows/${seriesId}/Seasons`, { query: { userId } }),
  episodes: (token: string, userId: string, seriesId: string, query: Record<string, string | number | boolean | undefined> = {}) =>
    jfRequest<JfItemsResult>(token, `/Shows/${seriesId}/Episodes`, { query: { userId, fields: 'Overview', ...query } }),
  playbackInfo: (token: string, itemId: string, body: Record<string, unknown>) =>
    jfRequest<{ MediaSources: JfMediaSource[]; PlaySessionId: string; ErrorCode?: string }>(
      token,
      `/Items/${itemId}/PlaybackInfo`,
      { method: 'POST', body },
    ),
  segments: (token: string, itemId: string) =>
    jfRequest<{ Items: Array<{ Type: string; StartTicks: number; EndTicks: number }> }>(token, `/MediaSegments/${itemId}`, {
      timeoutMs: 5000,
    }),
  /** "stop" also makes Jellyfin kill any transcode tied to the play session. */
  reportPlayback: (token: string, event: 'start' | 'progress' | 'stop', body: Record<string, unknown>) => {
    const path = { start: '/Sessions/Playing', progress: '/Sessions/Playing/Progress', stop: '/Sessions/Playing/Stopped' }[event];
    return jfRequest<void>(token, path, { method: 'POST', body });
  },
  /** Stops the server's work on a play session (a transcode) without saying anything about where someone got to. */
  endEncoding: (token: string, deviceId: string, playSessionId: string) =>
    jfRequest<void>(token, '/Videos/ActiveEncodings', { method: 'DELETE', query: { deviceId, playSessionId } }),
  /** Watched / not watched. A show or season marks every episode in it. */
  setPlayed: async (token: string, userId: string, itemId: string, played: boolean) => {
    const method = played ? 'POST' : 'DELETE';
    try {
      await jfRequest<unknown>(token, `/UserPlayedItems/${itemId}`, { method, query: { userId } });
    } catch (err) {
      // Jellyfin before 10.9 only has the older address.
      if ((err as { status?: number }).status !== 404) throw err;
      await jfRequest<unknown>(token, `/Users/${userId}/PlayedItems/${itemId}`, { method });
    }
  },
  /** Where this person is in a film or episode (watched elsewhere, e.g. a download on a phone). */
  setPosition: async (token: string, userId: string, itemId: string, seconds: number, at: Date) => {
    const body = { PlaybackPositionTicks: secondsToTicks(seconds), LastPlayedDate: at.toISOString(), Played: false };
    try {
      await jfRequest<unknown>(token, `/UserItems/${itemId}/UserData`, { method: 'POST', query: { userId }, body });
    } catch (err) {
      // Jellyfin before 10.9 only has the older address.
      if ((err as { status?: number }).status !== 404) throw err;
      await jfRequest<unknown>(token, `/Users/${userId}/Items/${itemId}/UserData`, { method: 'POST', body });
    }
  },
  /** Scan the libraries for changes (e.g. files deleted through Radarr/Sonarr). Needs admin rights. */
  refreshLibrary: (token: string) => jfRequest<void>(token, '/Library/Refresh', { method: 'POST' }),
  /** Re-scan one item so newly downloaded subtitle files show up. Needs admin rights. */
  refreshItem: (token: string, itemId: string) =>
    jfRequest<void>(token, `/Items/${itemId}/Refresh`, {
      method: 'POST',
      query: { metadataRefreshMode: 'Default', imageRefreshMode: 'None', replaceAllMetadata: false, replaceAllImages: false },
    }),
};

export const ticksToSeconds = (ticks?: number) => (ticks ? ticks / 10_000_000 : 0);
export const secondsToTicks = (seconds: number) => Math.round(seconds * 10_000_000);
