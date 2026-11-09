import type { CastBridge, CastState } from '../lib/desktop';

/**
 * The web player's stand-in for <video> while a film plays on a Chromecast: the same
 * properties and events the player uses (like OverlayVideo for mpv and ExoPlayer), driven by
 * what the Android app reports, so Netfish's controls, keys, progress reporting and "next
 * episode" carry on as they are.
 */
export class CastVideo extends EventTarget {
  private time = 0;
  private length = Number.NaN;
  private isPaused = false;
  private buffering = true;
  /** "playing" said since the last pause or wait. */
  private playingSaid = false;
  private level = 1;
  private isMuted = false;
  readonly textTracks: TextTrack[] = [];
  /** `code`: the Chromecast's own reason, a number (for a bug report). */
  error: { message: string; code?: number } | null = null;
  /** Finished, or failed, already said (the Chromecast keeps repeating it while it sits idle). */
  private over = false;
  /** The film sent to it: news of any other is old news. */
  private url = '';
  /** It has said where it is in that film, so it has it. */
  private known = false;
  private readonly stopListening: () => void;

  constructor(private readonly cast: CastBridge) {
    super();
    // Only what happens from now on: the last thing reported may be about another film.
    let now = false;
    this.stopListening = cast.onState((state) => now && this.apply(state));
    now = true;
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  /** Another film on its way to the Chromecast (or already there, `at` that point): nothing playing until it says so. */
  loadingNext(url: string, at = 0) {
    this.url = url;
    this.known = false;
    this.time = at;
    this.buffering = true;
    this.over = false;
    this.error = null;
    this.playingSaid = false;
  }

  private apply(state: CastState) {
    // Connecting, devices, and the like: not about the film.
    if (typeof state.time !== 'number' || state.url !== this.url) return;
    if (!this.known) {
      this.known = true;
      this.emit('loadeddata');
    }
    this.time = state.time;
    this.emit('timeupdate');
    if (typeof state.duration === 'number' && state.duration > 0 && state.duration !== this.length) {
      this.length = state.duration;
      this.emit('durationchange');
      this.emit('loadedmetadata');
    }
    if (typeof state.volume === 'number' || typeof state.muted === 'boolean') {
      if (typeof state.volume === 'number') this.level = state.volume;
      if (typeof state.muted === 'boolean') this.isMuted = state.muted;
      this.emit('volumechange');
    }
    if (state.buffering && !this.buffering) {
      this.buffering = true;
      this.playingSaid = false;
      this.emit('waiting');
    }
    if (state.playing && !this.playingSaid) {
      this.buffering = false;
      this.isPaused = false;
      this.playingSaid = true;
      this.emit('canplay');
      this.emit('playing');
    }
    if (state.paused) {
      this.buffering = false;
      this.playingSaid = false;
      if (!this.isPaused) {
        this.isPaused = true;
        this.emit('pause');
      }
    }
    if ((state.ended || state.error) && !this.over) {
      this.over = true;
      if (state.error) {
        this.error = { message: state.error, code: state.errorCode };
        this.emit('error');
      } else this.emit('ended');
    }
  }

  get currentTime() {
    return this.time;
  }
  set currentTime(t: number) {
    this.time = t;
    this.cast.command('seek', t);
    this.emit('timeupdate');
  }
  get duration() {
    return this.length;
  }
  get paused() {
    return this.isPaused;
  }
  get volume() {
    return this.level;
  }
  set volume(v: number) {
    this.level = v;
    this.cast.command('volume', v);
    this.emit('volumechange');
  }
  get muted() {
    return this.isMuted;
  }
  set muted(m: boolean) {
    this.isMuted = m;
    this.cast.command('mute', m);
    this.emit('volumechange');
  }
  get buffered() {
    return { length: 1, start: () => 0, end: () => this.time };
  }
  play() {
    this.isPaused = false;
    this.cast.command('play');
    return Promise.resolve();
  }
  pause() {
    this.isPaused = true;
    this.playingSaid = false;
    this.cast.command('pause');
    this.emit('pause');
  }
  /** Once the Chromecast has the film: a change of subtitles sent before then gets lost. */
  whenLoaded(): Promise<void> {
    return this.known ? Promise.resolve() : new Promise((resolve) => this.addEventListener('loadeddata', () => resolve(), { once: true }));
  }
  destroy() {
    this.stopListening();
  }
}

/**
 * What a Chromecast plays as it is (the Default Media Receiver): H.264 up to 1080p in MP4,
 * VP8/VP9 in WebM, AAC/MP3/Opus/FLAC sound; anything else Jellyfin turns into H.264 and AAC
 * (HLS), and subtitles come as WebVTT files alongside.
 */
export const CHROMECAST_PROFILE = {
  Name: 'Netfish Chromecast',
  MaxStreamingBitrate: 20_000_000,
  MaxStaticBitrate: 40_000_000,
  MusicStreamingTranscodingBitrate: 192_000,
  DirectPlayProfiles: [
    { Type: 'Video', Container: 'mp4,m4v', VideoCodec: 'h264', AudioCodec: 'aac,mp3,opus,flac' },
    { Type: 'Video', Container: 'webm', VideoCodec: 'vp8,vp9', AudioCodec: 'vorbis,opus' },
    { Type: 'Audio', Container: 'mp3,m4a,aac,flac,webm', AudioCodec: 'mp3,aac,flac,opus,vorbis' },
  ],
  TranscodingProfiles: [
    { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', MinSegments: 1, BreakOnNonKeyFrames: true },
    { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming', MaxAudioChannels: '2' },
  ],
  ContainerProfiles: [],
  CodecProfiles: [
    {
      Type: 'Video',
      Codec: 'h264',
      Conditions: [
        { Condition: 'LessThanEqual', Property: 'Width', Value: '1920', IsRequired: false },
        { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '42', IsRequired: false },
        { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
      ],
    },
  ],
  SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }],
};
