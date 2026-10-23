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
  /** An admin turned Channels on. */
  channels: boolean;
  /** An admin turned the Discover tab on: Home has only the library, Discover the rest. */
  discoverTab: boolean;
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

export type ServiceId = 'jellyfin' | 'seerr' | 'radarr' | 'sonarr' | 'bazarr' | 'qbittorrent' | 'mdblist' | 'trakt' | 'suggestarr';

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
  /** "Ready to watch": when it arrived in the library. */
  readyAt?: string;
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
  /** Always from the library; with what Play starts (a show's next episode). */
  hero?: Card & { tagline?: string; play?: { itemId: string; label: string; progress?: number } };
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
  /** In the library and watched all the way (a show: every episode). */
  watched?: boolean;
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
  /** Radarr/Sonarr's custom formats that matched the release, and their score. */
  customFormats?: string[];
  customFormatScore?: number;
  indexer?: string;
  /** qBittorrent, SABnzbd… */
  downloadClient?: string;
  protocol?: string;
  /** Requested by the current user through Seerr. */
  mine: boolean;
}

/** What Activity can tell about a download. Admins see all of it; they pick what everyone else sees. */
export type DownloadDetail = 'quality' | 'languages' | 'release' | 'formats' | 'indexer' | 'client';

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
  /** Not on disk (deleted to save space), films and shows. */
  removed: { movies: number; shows: number };
}

/** Settings → Storage: something that could go to free space, and why. */
export interface CleanupSuggestion {
  key: string;
  mediaType: MediaType;
  tmdbId?: number;
  title: string;
  year?: number;
  poster?: string;
  size: number;
  /** finished: everyone who watched it finished long ago · unwatched: nobody started it since it arrived. */
  reason: 'finished' | 'unwatched';
  /** Last watched, or when it arrived. */
  since: string;
}

/** A person signed in on this device, for "Who's watching?". */
export interface DeviceProfile {
  userId: string;
  name: string;
  avatar?: string;
  /** Needs a PIN to switch to. */
  locked: boolean;
  /** The profile this device is using now. */
  current: boolean;
}

export interface ProfilesResponse {
  profiles: DeviceProfile[];
  /** Ask who's watching when Netfish opens. */
  ask: boolean;
}

// ---------- Watch together ----------

export type TogetherAction = 'start' | 'play' | 'pause' | 'seek' | 'next';

/** Where a room's film is: playing or paused at a point, as of a moment on the server's clock. */
export interface TogetherPlayback {
  itemId: string;
  playing: boolean;
  /** Seconds into the film at `at`. */
  position: number;
  /** Server time (ms) of the last change. */
  at: number;
  /** The last change, and who made it. */
  action: TogetherAction;
  by: string;
  /** The player that made it (so it doesn't tell itself). */
  byClient?: string;
  /** Goes up with every change. */
  rev: number;
}

export interface TogetherTrack {
  index: number;
  label: string;
}

/** A player's audio and subtitle choices (so a remote can show and change them). */
export interface TogetherTracks {
  audio: TogetherTrack[];
  subtitles: TogetherTrack[];
  audioIndex?: number;
  /** null: subtitles off. */
  subtitleIndex?: number | null;
}

export interface TogetherMember {
  /** One per open player (the same person can join from two devices). */
  clientId: string;
  userId: string;
  name: string;
  avatar?: string;
  /** Has the room open right now. */
  here: boolean;
  /** Loading or buffering. */
  waiting: boolean;
  /** A remote control (Play on TV), not a player. */
  controller?: boolean;
  tracks?: TogetherTracks;
}

/** Sent to one player: change its audio or subtitles, or stop (from a remote). */
export interface TogetherCommand {
  action: 'audio' | 'subtitle' | 'stop';
  /** The track; null turns subtitles off. */
  index?: number | null;
  by: string;
}

export interface TogetherRoom {
  /** Six letters and digits: the invite code. */
  id: string;
  /** "remote": Play on TV, a film on one screen run from a phone (not listed for others). */
  kind: 'together' | 'remote';
  /** Play on TV: the screen it's playing on. */
  screenName?: string;
  hostId: string;
  hostName: string;
  /** "Dune", or the show's name for an episode. */
  title: string;
  /** For an episode: "S1:E3 · Its name". */
  subtitle?: string;
  image?: string;
  /** Jellyfin's id for the film, or for the show an episode belongs to. */
  titleId?: string;
  durationSeconds?: number;
  playback: TogetherPlayback;
  members: TogetherMember[];
  createdAt: string;
}

/** One message on a room's live stream: the room as it is now, that it ended, or a command for this player. */
export interface TogetherEvent {
  room?: TogetherRoom;
  ended?: boolean;
  command?: TogetherCommand;
  /** The server's clock (ms), so players agree on where the film is. */
  now: number;
}

// ---------- Screens (Play on TV) ----------

export type ScreenKind = 'tv' | 'computer' | 'phone' | 'tablet' | 'browser';

/** A Netfish that's open somewhere and can be told to play something. */
export interface Screen {
  id: string;
  name: string;
  kind: ScreenKind;
  /** Who's signed in there. */
  userName: string;
  /** Signed in as you. */
  mine: boolean;
}

/** Settings → Devices (admins): every Netfish open right now, and which app it runs. */
export interface Device {
  id: string;
  name: string;
  kind: ScreenKind;
  userName: string;
  /** The Netfish app around it (mac, windows, ios, android, samsung); none in a browser. */
  app?: string;
  version?: string;
  /** Open since (ISO). */
  since: string;
}

/**
 * The live line every open Netfish keeps to the server: the rooms (Home, the top bar and
 * title pages follow them), the screens you can play on, and "open this" when someone
 * sends this screen something to play.
 */
export interface LiveEvent {
  rooms?: TogetherRoom[];
  screens?: Screen[];
  open?: { path: string; by: string };
  now: number;
}

export interface TogetherControl {
  clientId: string;
  action: Exclude<TogetherAction, 'start'>;
  /** Where this player is (seconds). */
  position?: number;
  /** For "next": the episode everyone moves on to. */
  itemId?: string;
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
  /** SuggestArr asked for it: because of what someone watched (who, for admins; the title, when it's yours or you're an admin). */
  suggested?: { because?: string; forName?: string };
  /** Deleted from disk since (not coming back by itself). */
  removed?: boolean;
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
/**
 * A title's trailers in the languages that matter to this person (their profile's, the app's, the
 * title's own, English), and the one to start with.
 */
export interface TrailerChoices {
  options: Array<{ language: string; label: string; youtubeKey: string; original: boolean }>;
  chosen?: string;
}

/** Settings (admins): this server's version, and a newer one when there is (the container to update). */
export interface ServerUpdate {
  current: string;
  latest?: string;
  /** The newer one's release page. */
  url?: string;
  newer: boolean;
}

/** Settings → Connections → SuggestArr (admins): whose key it is, and its jobs. */
export interface SuggestArrStatus {
  user?: { name: string; admin: boolean };
  jobs: Array<{
    id: number;
    name: string;
    /** "Every day at midnight", "0 4 * * 6"… */
    schedule: string;
    running: boolean;
    lastRun?: { status: 'completed' | 'failed' | 'skipped' | 'running' | 'queued'; at?: string; requested?: number; error?: string };
  }>;
  error?: string;
}

export interface ServerSettings {
  /** Largest movie release users may pick, in GB. null = no limit. */
  maxMovieSizeGb: number | null;
  /** Largest size per episode for TV releases (season packs are divided by their episode count), in GB. */
  maxEpisodeSizeGb: number | null;
  /** Who may pick specific releases. */
  manualGrabs: 'all' | 'admin';
  /** What people who aren't admins see about a download in Activity. */
  downloadDetails: DownloadDetail[];
  /** A Discover tab after Home with what isn't in the library; Home then shows only what is. */
  discoverTab: boolean;
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
  /** For a Chromecast: the session comes with a castToken for its links. */
  cast?: boolean;
  /**
   * The player only plays a file's default audio track (browsers, TVs, Apple's player): another
   * track has to come as a repackaged stream, not the file as it is.
   */
  defaultAudioOnly?: boolean;
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
  /**
   * subtitleStreamIndex is Jellyfin's choice for this person (their subtitle settings, and what it
   * remembers per show): follow it, -1 (none) included.
   */
  subtitleChosen?: boolean;
  /** Pictures to show while scrubbing (Jellyfin's trickplay), when Jellyfin has made them. */
  trickplay?: Trickplay;
  /** Asked for a Chromecast: add it to this session's links as nfcast=… (it can't sign in). */
  castToken?: string;
  transcodeReasons: string[];
}

/**
 * A title's scrubbing previews: pictures each holding `columns`×`rows` frames of `width`×`height`,
 * one frame every `interval` seconds; `url` with {index} for the picture's number.
 */
export interface Trickplay {
  url: string;
  width: number;
  height: number;
  columns: number;
  rows: number;
  count: number;
  interval: number;
}

/** Jellyfin's subtitle modes: as the file says, always, only forced ones, never, or when the audio isn't your language. */
export type SubtitleMode = 'Default' | 'Always' | 'OnlyForced' | 'None' | 'Smart';

/** A person's audio and subtitle settings: Jellyfin's own (the same on every device, and in Jellyfin's apps). */
export interface PlaybackPrefs {
  /** ISO 639-1; empty: the file's own. */
  audioLanguage: string;
  subtitleMode: SubtitleMode;
  /** ISO 639-1; empty: any. */
  subtitleLanguage: string;
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
  /** Watched on a channel (not someone choosing to watch it). */
  channel?: boolean;
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
  /** Scrubbing previews to keep with it (Jellyfin's trickplay): the pictures to fetch, in order, for `url`'s {index}. */
  trickplay?: Trickplay & { sheets: string[] };
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

// ---------- Channels ----------

/**
 * What a channel plays:
 * - mix: Netfish's own channel, a day like a TV network's (cartoons in the morning, sitcoms,
 *   grown-up cartoons in the evening, a film at 9pm, late-night comedy, films overnight);
 * - cartoons, sitcoms: those shows, a different one each time, each carrying on where it left off;
 * - films: films of some genres (and none of `avoid`);
 * - genre: films and/or episodes of one genre; series: one show in order;
 * - recent: the newest films; shows: episodes of every show.
 */
export type ChannelSource =
  | { kind: 'mix' }
  | { kind: 'cartoons' }
  | { kind: 'sitcoms' }
  | { kind: 'films'; genres: string[]; avoid?: string[] }
  | { kind: 'genre'; genre: string; movies: boolean; episodes: boolean }
  | { kind: 'series'; seriesId: string; seriesName: string }
  | { kind: 'recent' }
  | { kind: 'shows' };

export interface ChannelDef {
  id: string;
  number: number;
  name: string;
  source: ChannelSource;
  hidden?: boolean;
  /** Brings in new titles for itself (Settings → Channels → New titles). */
  fresh?: boolean;
  /** Netfish's own channel: always there, always channel 1, as it is. */
  builtIn?: boolean;
}

/**
 * New titles for channels: Netfish picks films and first seasons for a channel and puts them in
 * its guide (a week ahead), downloads each a few days before it airs (Radarr/Sonarr, tagged
 * netfish-channel), keeps them out of everyone's library and Activity, then deletes them once
 * aired. Never anything someone requested, kept or started watching.
 */
export interface FreshSettings {
  enabled: boolean;
  /** The most space they may take (GB), downloading ones included. */
  maxGb: number;
  /** Nothing new while the disk has less free than this (GB). */
  minFreeGb: number;
  /** Downloads only between these hours (0–23, the household's time); the same hour twice: any time. */
  fromHour: number;
  toHour: number;
  /** Their download speed, at most (MB/s; 0: no limit). Needs qBittorrent. */
  maxSpeed: number;
  /** New titles a week for each channel, at most. */
  perWeek: number;
  /** How long before it airs each one is downloaded (days: 1, 3, 7), in case a download has trouble. */
  aheadDays: number;
  /** Radarr's and Sonarr's quality profiles for them (their first one otherwise). */
  movieProfile?: number;
  showProfile?: number;
  /**
   * Which release: the smallest that Radarr/Sonarr would take at 720p, 1080p ("smallest") or 4K
   * (Netfish picks it from what they find), or the one they'd pick themselves (the best their
   * profile allows).
   */
  pick?: 'smallest-720' | 'smallest' | 'smallest-2160' | 'profile';
}

/** planned: in the guide, not downloading yet. */
export type FreshState = 'planned' | 'downloading' | 'ready' | 'aired' | 'kept';

export interface FreshTitle {
  key: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year?: number;
  poster?: string;
  channelId: string;
  state: FreshState;
  /** Bytes on disk, or being downloaded. */
  size: number;
  /** While downloading (0–1). */
  progress?: number;
  /** Paused outside the download hours. */
  paused?: boolean;
  addedAt: string;
  /** When it's on (first). */
  airAt?: string;
  /** The earliest it may start downloading (its days ahead before the earliest it can be on). */
  downloadAt?: string;
  /** When it will start: the first moment from then inside the download hours (one due then waits its turn). */
  startsAt?: string;
  /** Who kept it, if someone did ("watched" when someone chose to watch it, "requested"). */
  keptBy?: string;
}

/** Settings → Channels → New titles: what they take and where they are. */
export interface FreshStatus {
  usedBytes: number;
  freeBytes?: number;
  addedThisWeek: number;
  /** Why nothing's being added right now. */
  waiting?: 'off' | 'no-channels' | 'hours' | 'space' | 'disk' | 'week' | 'enough' | 'services';
  titles: FreshTitle[];
  /** The last look inside the download hours: what happened then (outside them, "outside the hours" says little). */
  lastInHours?: { at: string; note: FreshNote; title?: string };
  /** What it can use: Radarr for films, Sonarr for shows, Seerr to find them, qBittorrent for hours and speed. */
  services: { radarr: boolean; sonarr: boolean; seerr: boolean; qbittorrent: boolean };
  profiles: { movie: Array<{ id: number; name: string }>; show: Array<{ id: number; name: string }> };
}

/** Settings → "Download now": what started, and what couldn't (and why). */
export interface FreshNowResult {
  status: FreshStatus;
  started: string[];
  /** Added already, nothing found yet: Radarr/Sonarr asked to look again. */
  searched: string[];
  failed: Array<{ title: string; reason: string }>;
}

/** What a look inside the download hours came to. */
export type FreshNote = 'started' | 'downloading' | 'nothing-due' | 'disk' | 'space' | 'services' | 'add-failed' | 'already-there';

/** Settings → Channels (admins). */
export interface ChannelSettings {
  enabled: boolean;
  /** Watching a channel counts like watching the film (Continue Watching, watched). Off: it leaves no trace. */
  countWatched: boolean;
  channels: ChannelDef[];
  /** Where the household is (the admin's device's time zone): the 9pm film is at 9pm there. */
  timeZone?: string;
  fresh?: FreshSettings;
}

export interface ChannelAdmin extends ChannelSettings {
  /** What there is to make channels from. */
  genres: Array<{ name: string; movies: number; episodes: number }>;
  series: Array<{ id: string; name: string; episodes: number }>;
}

export interface ChannelProgram {
  itemId: string;
  /** The film's title, or the episode's. */
  title: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  year?: number;
  /** PG-13, TV-14… */
  rating?: string;
  /** Landscape artwork. */
  image?: string;
  /** When it starts (ms since 1970). The break before it ends there. */
  start: number;
  seconds: number;
  /** New on this channel: brought in for it, deleted after it airs (unless someone keeps it). */
  isNew?: boolean;
}

/** A programme in the guide, opened: what it's about, and the page of its film or show. */
export interface ProgramAbout {
  overview?: string;
  /** The Jellyfin id of the film, or of the show an episode is from (none for a new title still on its way). */
  pageId?: string;
  /** Its page in Netfish: the library's, or for a new title still on its way TMDB's (trailer, cast, Request). */
  href?: string;
  /** A new title on a channel that someone has kept, or asked for: it stays, in the library. */
  requested?: boolean;
}

export interface Channel {
  id: string;
  number: number;
  name: string;
  /** From the one on now, a few hours ahead. */
  programs: ChannelProgram[];
  /** Netfish screens on it right now. */
  watching: number;
}

export interface ChannelsResponse {
  /** The server's clock (ms), so every screen agrees on what's on. */
  now: number;
  /** The break between programmes (seconds), before each one starts. */
  breakSeconds: number;
  /** Watching counts like watching the film (otherwise Jellyfin isn't told). */
  countWatched: boolean;
  channels: Channel[];
}
