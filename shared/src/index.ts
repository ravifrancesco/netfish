/**
 * The Netfish API contract. Everything a client (web, desktop, later phone/TV)
 * needs is described here; the server is the only thing that talks to
 * Jellyfin, Seerr, Radarr, Sonarr, Bazarr and qBittorrent.
 */

export type MediaType = 'movie' | 'tv';

/** Where a title stands, from "never heard of it" to "ready to play". */
export type Availability = 'available' | 'partial' | 'processing' | 'pending' | 'none';

export interface User {
  id: string;
  name: string;
  isAdmin: boolean;
  avatar?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  deviceId: string;
  deviceName: string;
}

export interface Features {
  /** Seerr is configured: discovery rows, search beyond the library, requests. */
  discover: boolean;
  requests: boolean;
  /** Radarr and/or Sonarr configured: live download progress. */
  downloads: boolean;
  /** Pick a specific release (any version / audio language) through Radarr/Sonarr. */
  versions: boolean;
  /** Fetch subtitles through Bazarr. */
  subtitles: boolean;
}

export interface AppConfig {
  name: 'netfish';
  version: string;
  features: Features;
  jellyfinConfigured: boolean;
  /** First run: no Jellyfin address yet, so show the setup screen instead of sign-in. */
  setupRequired: boolean;
  /** Set when Netfish can't write its data folder: how to fix it. */
  storageProblem?: string;
}

// ---------- Connections (admin) ----------

export type ServiceId = 'jellyfin' | 'seerr' | 'radarr' | 'sonarr' | 'bazarr' | 'qbittorrent' | 'mdblist' | 'trakt';

/** What the admin sees for one service. Secrets are never sent back, only a hint. */
export interface ServiceConnection {
  id: ServiceId;
  name: string;
  /** What Netfish uses it for, in a few words. */
  purpose: string;
  /** Where to find the API key in that service's UI. */
  keyHelp?: string;
  required: boolean;
  url?: string;
  defaultUrl?: string;
  /** The URL is fixed (a public API); only the key matters. */
  fixedUrl?: boolean;
  usesKey: boolean;
  usesLogin: boolean;
  /** A second secret next to the key (Trakt's client secret), kept in `password`. */
  usesSecret?: boolean;
  /** What the service calls its key and secret, when not "API key". */
  keyLabel?: string;
  secretLabel?: string;
  hasKey: boolean;
  keyHint?: string;
  username?: string;
  hasPassword: boolean;
  /** "app" = saved in Netfish, "stack" = from the Portainer stack's variables. */
  source: 'app' | 'stack' | 'none';
}

/** Fields left undefined stay as they are; empty string clears them. */
export interface ServiceConnectionUpdate {
  url?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

export interface ConnectionTest {
  ok: boolean;
  version?: string;
  detail?: string;
  error?: string;
}

/** A poster/thumbnail tile. Library items and discover results share this shape. */
export interface Card {
  /** Stable key: `movie-<tmdbId>`, `tv-<tmdbId>` or `jf-<jellyfinId>`. */
  key: string;
  mediaType: MediaType;
  tmdbId?: number;
  /** Jellyfin movie or series id when it's in the library. */
  jellyfinId?: string;
  title: string;
  year?: number;
  overview?: string;
  poster?: string;
  backdrop?: string;
  rating?: number;
  status: Availability;
  /** Continue watching / next up: the playable item (movie or episode) and how far in. */
  playItemId?: string;
  progress?: number;
  /** Secondary line, e.g. "S2:E5 · The One With the Fish". */
  subtitle?: string;
  /** Landscape image for wide cards. */
  thumb?: string;
  /** Length in minutes: the movie's, or a typical episode's for a show. */
  runtimeMinutes?: number;
  /** Present while Radarr/Sonarr are downloading it. 0..1 */
  downloadProgress?: number;
}

export interface Row {
  id: string;
  title: string;
  style: 'poster' | 'wide';
  items: Card[];
  /** Optional link for "see all". */
  href?: string;
}

export interface HomeResponse {
  hero?: Card & { tagline?: string };
  rows: Row[];
}

export interface Person {
  /** Their page is /person/<id>: a TMDB person id, or `jf-<id>` for someone only Jellyfin knows. */
  id?: string;
  name: string;
  role?: string;
  photo?: string;
}

/** A person matching a search, e.g. a director or actor. */
export interface PersonResult {
  id: string;
  name: string;
  photo?: string;
  /** A few of their best-known titles. */
  knownFor?: string;
}

export type CreditKind = 'directed' | 'acted' | 'written' | 'created';

export interface SearchResponse {
  items: Card[];
  people: PersonResult[];
  /** When the search is clearly a person's name: their films and shows, ahead of everything else. */
  person?: { id: string; name: string; kind: CreditKind; title: string; items: Card[] };
}

export interface PersonDetail {
  id: string;
  name: string;
  photo?: string;
  biography?: string;
  /** "Directing", "Acting"…, in the viewer's language. */
  knownFor?: string;
  born?: string;
  died?: string;
  birthplace?: string;
  sections: Array<{ kind: CreditKind; title: string; items: Card[] }>;
}

/** An audio or subtitle track that already exists in the library file(s). */
export interface LangTrack {
  /** ISO 639-1 when known (e.g. "en"), otherwise whatever Jellyfin reported. */
  code?: string;
  label: string;
  codec?: string;
  external?: boolean;
  forced?: boolean;
  default?: boolean;
}

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'failed' | 'completed';

export interface RequestSummary {
  id: number;
  status: RequestStatus;
  requestedBy: string;
  mine: boolean;
  createdAt: string;
  seasons?: number[];
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  poster?: string;
  status: Availability;
  jellyfinId?: string;
}

/** Not out yet (Radarr's "Not Available"), so Radarr/Sonarr have nothing to download until then. */
export interface NotOut {
  /**
   * cinemas: in cinemas, not out to stream or buy yet · unreleased: not out anywhere yet ·
   * premiere: the show hasn't started · airing: more episodes still to come.
   */
  kind: 'cinemas' | 'unreleased' | 'premiere' | 'airing';
  /** When it should become downloadable: digital release, premiere, next episode, or the cinema release if that's all that's known. */
  date?: string;
}

export interface TitleDetail {
  key: string;
  mediaType: MediaType;
  tmdbId?: number;
  jellyfinId?: string;
  title: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  tagline?: string;
  runtimeMinutes?: number;
  genres: string[];
  rating?: number;
  certification?: string;
  poster?: string;
  backdrop?: string;
  originalLanguage?: string;
  status: Availability;
  cast: Person[];
  crew: Person[];
  trailerYoutubeKey?: string;
  /** What the big Play button does. Absent when nothing is playable yet. */
  play?: { itemId: string; label: string; progress?: number };
  /** Languages present in the library copy (for TV: from the next-up episode). */
  audio: LangTrack[];
  subtitles: LangTrack[];
  requests: RequestSummary[];
  downloads: DownloadItem[];
  seasons?: SeasonSummary[];
  recommendations: Card[];
  /** Radarr/Sonarr manage this title. */
  managed: boolean;
  notOut?: NotOut;
  /** Admins: what's on disk, so it can be deleted. */
  disk?: DiskInfo;
  /** Deleted from disk to save space: still listed, and can be downloaded again. */
  removed?: RemovedInfo;
  /** The current user may delete it from disk and download it again (admins, Radarr/Sonarr manage it). */
  canManage: boolean;
  /** This user may pick a specific release for it (managed + allowed by the server). */
  canChooseVersion: boolean;
  canRequest: boolean;
}

/** Scores from around the web, fetched separately because they're slow to look up. */
export interface Ratings {
  /** TMDB user score, 0–10. */
  tmdb?: number;
  imdb?: { score: number; votes?: number };
  rottenTomatoes?: {
    critics?: number;
    criticsRating?: string;
    audience?: number;
    audienceRating?: string;
  };
  /** Needs an MDBList API key on the server (Letterboxd has no public API of its own). 0–5. */
  letterboxd?: { score: number; votes?: number };
  metacritic?: { score: number };
  /** Pages to open in the browser. */
  links: { tmdb: string; imdb?: string; rottenTomatoes?: string; letterboxd?: string };
}

export interface EpisodeInfo {
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  still?: string;
  airDate?: string;
  runtimeMinutes?: number;
  jellyfinId?: string;
  available: boolean;
  progress?: number;
  played?: boolean;
  download?: { progress: number; state: DownloadState };
}

export interface SeasonDetail {
  seasonNumber: number;
  name?: string;
  overview?: string;
  episodes: EpisodeInfo[];
}

export type DownloadState =
  | 'downloading'
  | 'queued'
  | 'paused'
  | 'stalled'
  | 'importing'
  | 'warning'
  | 'failed';

export interface DownloadItem {
  id: string;
  source: 'radarr' | 'sonarr';
  mediaType: MediaType;
  tmdbId?: number;
  tvdbId?: number;
  title: string;
  /** "S02 · 8 episodes", "S01E03 · Pilot", or the quality for movies. */
  detail?: string;
  seasonNumber?: number;
  episodes?: number[];
  poster?: string;
  progress: number;
  size: number;
  sizeLeft: number;
  etaSeconds?: number;
  /** Bytes/second, when qBittorrent is configured. */
  speed?: number;
  state: DownloadState;
  message?: string;
  quality?: string;
  languages: string[];
  releaseTitle?: string;
  /** Requested by the current user through Seerr. */
  mine: boolean;
}

/** stop: cancel it for good (Radarr/Sonarr stop looking) · replace: block this release and find another. */
export type StopMode = 'stop' | 'replace';

/** What's on disk for a title, from Radarr/Sonarr. */
export interface DiskInfo {
  size: number;
  /** TV: per season, only seasons with files. */
  seasons?: Array<{ seasonNumber: number; size: number; files: number }>;
}

export interface RemovedInfo {
  at: string;
  /** Space it freed, in bytes. */
  size?: number;
  /** TV: the seasons that were deleted (all of them when absent). */
  seasons?: number[];
  by?: string;
}

/** Settings → Storage. Sizes in bytes. */
export interface StorageInfo {
  /** `path`: the library folder(s) on that disk, e.g. "/data/movies · /data/tv". */
  disks: Array<{ path: string; free: number; total: number; holds: MediaType[] }>;
  movies?: { count: number; size: number };
  shows?: { count: number; size: number };
  biggest: Array<{ key: string; mediaType: MediaType; tmdbId?: number; title: string; year?: number; poster?: string; size: number }>;
  /** Titles deleted from disk and kept in the library. */
  removed: number;
}

export interface DownloadsResponse {
  items: DownloadItem[];
}

export interface RequestItem {
  id: number;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  requestStatus: RequestStatus;
  status: Availability;
  seasons?: number[];
  createdAt: string;
  requestedBy: string;
  mine: boolean;
  download?: { progress: number; etaSeconds?: number; state: DownloadState; count: number };
  notOut?: NotOut;
}

export interface RequestsResponse {
  items: RequestItem[];
}

export interface CreateRequest {
  mediaType: MediaType;
  tmdbId: number;
  /** TV only. Omit for "all missing seasons". */
  seasons?: number[];
}

export interface Language {
  /** ISO 639-1 (or Bazarr-style variants like "pb" for Brazilian Portuguese). */
  code: string;
  name: string;
  native?: string;
}

/** One result from Radarr/Sonarr's interactive search (all indexers via Prowlarr). */
export interface Release {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  size: number;
  seeders?: number;
  leechers?: number;
  quality: string;
  resolution?: number;
  /** Language names as Radarr/Sonarr parsed them. */
  languages: string[];
  /** Language codes detected from the tags *and* the release name. */
  languageCodes: string[];
  /** MULTi / DUAL release whose exact languages are unknown. */
  multi: boolean;
  ageHours: number;
  protocol: string;
  /** Radarr/Sonarr would not pick it automatically (wrong language, size…). Still grabbable. */
  rejected: boolean;
  rejections: string[];
  customFormatScore: number;
  /** Radarr/Sonarr will most likely import it over the current file. */
  likelyImports: boolean;
  fullSeason?: boolean;
  episodes?: number[];
  /** Size divided by the episodes it contains (TV), for comparing against the per-episode limit. */
  sizePerEpisode?: number;
  /** Over the admin's size limit (only ever returned to admins who asked to see them). */
  oversized?: boolean;
}

export interface ReleaseSearch {
  /** TV only: which season (and optionally which episode) to search. */
  seasonNumber?: number;
  episodeNumber?: number;
  /** Admins only: include releases over the size limit. */
  includeOversized?: boolean;
}

export interface ReleasesResponse {
  /** What's in the library right now (for comparing). */
  current?: { quality?: string; languages: string[]; customFormatScore?: number };
  originalLanguage?: string;
  releases: Release[];
  /** The size limit that applies to this search, if any. */
  limit?: { bytes: number; perEpisode: boolean };
  /** Releases left out because they're over the limit. */
  hiddenOversized: number;
}

/** Server-wide settings admins can change from the app (stored on the server). */
export interface ServerSettings {
  /** Largest movie release users may pick, in GB. null = no limit. */
  maxMovieSizeGb: number | null;
  /** Largest size per episode for TV releases (season packs are divided by their episode count), in GB. */
  maxEpisodeSizeGb: number | null;
  /** Who may pick specific releases. */
  manualGrabs: 'all' | 'admin';
}

export interface GrabRequest {
  guid: string;
  indexerId: number;
}

export interface SubtitleRequest {
  language: string;
  seasonNumber?: number;
  /** Jellyfin episode id, to fetch subtitles for a single episode. */
  episodeId?: string;
  hearingImpaired?: boolean;
}

export interface Job {
  id: string;
  kind: 'subtitles';
  key: string;
  label: string;
  state: 'running' | 'done' | 'failed';
  message?: string;
  done: number;
  total: number;
  startedAt: string;
}

// ---------- Playback ----------

export interface MediaSegment {
  type: 'Intro' | 'Outro' | 'Recap' | 'Preview' | 'Commercial' | 'Unknown';
  start: number;
  end: number;
}

export interface PlayInfo {
  itemId: string;
  type: 'Movie' | 'Episode' | 'Other';
  title: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  backdrop?: string;
  resumeSeconds?: number;
  durationSeconds?: number;
  nextItemId?: string;
  nextTitle?: string;
  detailHref?: string;
  segments: MediaSegment[];
}

export interface StreamTrack {
  index: number;
  label: string;
  code?: string;
  codec?: string;
  default?: boolean;
  forced?: boolean;
  external?: boolean;
  /** Subtitles only: a WebVTT URL the player can attach directly. */
  vttUrl?: string;
  /** Subtitles only: image-based subtitles need a burn-in transcode. */
  burnIn?: boolean;
}

export interface PlaybackRequest {
  deviceProfile: unknown;
  startSeconds?: number;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  mediaSourceId?: string;
  maxBitrate?: number;
  /** Set false to force a remux/transcode (e.g. to switch audio track). */
  allowDirectPlay?: boolean;
}

export interface PlaybackSession {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  method: 'DirectPlay' | 'DirectStream' | 'Transcode';
  /** Same-origin URL. `.m3u8` → use HLS, otherwise a plain progressive stream. */
  url: string;
  isHls: boolean;
  durationSeconds?: number;
  audioTracks: StreamTrack[];
  subtitleTracks: StreamTrack[];
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  transcodeReasons: string[];
}

/**
 * What the web interface hands to an app's built-in player (mpv on Mac and
 * Windows, ExoPlayer on Android, Apple's player on iPhone/iPad), which draws the
 * film underneath the page's own controls.
 */
export interface NativePlayRequest {
  /** Absolute URL on the Netfish server (the app adds the session cookie). */
  url: string;
  isHls: boolean;
  title: string;
  subtitle?: string;
  startSeconds: number;
  durationSeconds?: number;
  /** The audio track: its 1-based position among the file's audio tracks (1 when the server already picked it). */
  audio?: { position: number; language?: string };
  /**
   * Subtitles: off (forced ones still show), or on. `position` is 1-based among
   * the file's own subtitle tracks followed by `externalSubtitles` in order.
   */
  subtitles: { mode: 'off' | 'on'; language?: string; position?: number };
  /** Subtitle files the player loads besides the video (sidecar files, or all of them for HLS), as WebVTT. */
  externalSubtitles: { url: string; label: string; language?: string }[];
  segments: MediaSegment[];
}

/** The one Trakt account the whole server sends watches to and takes recommendations from. */
export interface TraktStatus {
  /** Client ID and secret are saved in Connections. */
  configured: boolean;
  linked: boolean;
  username?: string;
  /** Send what everyone watches to Trakt. */
  scrobble: boolean;
  /** Linking in progress: enter `userCode` at `verificationUrl`. */
  pending?: { userCode: string; verificationUrl: string; expiresAt: string };
  /** Why the last link attempt ended, if it didn't work. */
  linkError?: string;
  lastScrobble?: { title: string; at: string };
  import?: { running: boolean; added?: number; alreadyThere?: number; notFound?: number; at?: string; error?: string };
}

export interface ProgressReport {
  event: 'start' | 'progress' | 'stop';
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  positionSeconds: number;
  isPaused: boolean;
  method: PlaybackSession['method'];
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
}

/** Everything the desktop app needs to save a movie/episode for offline viewing. */
export interface OfflineDescriptor {
  itemId: string;
  kind: 'Movie' | 'Episode';
  title: string;
  seriesId?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  subtitle?: string;
  fileName: string;
  /** Same-origin URL of the file to download. */
  url: string;
  /** Exact size for original files; an estimate when the audio is being converted. */
  size?: number;
  /** The audio is converted to AAC on the way (AC3/DTS don't play in the app). */
  converted: boolean;
  poster?: string;
  backdrop?: string;
  durationSeconds?: number;
  subtitles: Array<{ label: string; code?: string; url: string }>;
  detailHref?: string;
}

export interface ServiceStatus {
  id: string;
  name: string;
  configured: boolean;
  ok: boolean;
  version?: string;
  error?: string;
  url?: string;
}

export interface ApiError {
  error: string;
  service?: string;
}
