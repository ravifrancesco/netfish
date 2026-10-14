import type { PlaybackSession, StreamTrack } from '@netfish/shared';
import type { VideoOverlay } from '../lib/desktop';

/**
 * The web player's stand-in for <video> when the app draws the film itself
 * underneath the page (mpv in the Mac app, like Jellyfin Media Player). It
 * has the same properties and events the player uses, so Netfish's own
 * controls, keys, progress reporting and "next episode" work unchanged.
 */
export class OverlayVideo extends EventTarget {
  private time = 0;
  private length = Number.NaN;
  private isPaused = true;
  private level = 1;
  private isMuted = false;
  private cacheEnd = 0;
  private loaded = false;
  private buffering = true;
  readonly textTracks: TextTrack[] = [];
  error: { message: string } | null = null;
  private readonly stopListening: () => void;

  constructor(private readonly overlay: VideoOverlay) {
    super();
    this.stopListening = overlay.onState((state) => this.apply(state));
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  private apply(state: Record<string, unknown>) {
    const num = (key: string) => (typeof state[key] === 'number' ? (state[key] as number) : undefined);
    const flag = (key: string) => (typeof state[key] === 'boolean' ? (state[key] as boolean) : undefined);

    const t = num('time-pos');
    if (t !== undefined) {
      this.time = t;
      this.emit('timeupdate');
    }
    const d = num('duration');
    if (d !== undefined) {
      this.length = d;
      this.emit('durationchange');
    }
    const cache = num('demuxer-cache-time');
    if (cache !== undefined) this.cacheEnd = cache;
    const volume = num('volume');
    if (volume !== undefined) {
      this.level = volume / 100;
      this.emit('volumechange');
    }
    const mute = flag('mute');
    if (mute !== undefined) {
      this.isMuted = mute;
      this.emit('volumechange');
    }
    const pause = flag('pause');
    if (state.loaded) {
      this.loaded = true;
      this.buffering = false;
      if (pause !== undefined) this.isPaused = pause;
      this.emit('loadedmetadata');
      this.emit('canplay');
      if (!this.isPaused) this.emit('playing');
    }
    for (const key of ['paused-for-cache', 'seeking']) {
      const busy = flag(key);
      if (busy === undefined || !this.loaded) continue;
      this.buffering = busy;
      this.emit(busy ? 'waiting' : 'canplay');
      if (!busy && !this.isPaused) this.emit('playing');
    }
    if (pause !== undefined && !state.loaded && pause !== this.isPaused) {
      this.isPaused = pause;
      if (pause) this.emit('pause');
      else if (this.loaded && !this.buffering) this.emit('playing');
    }
    if (state.ended) {
      if (typeof state.error === 'string') {
        this.error = { message: state.error };
        this.emit('error');
      } else if (state.finished) {
        this.emit('ended');
      }
    }
  }

  get currentTime() {
    return this.time;
  }
  set currentTime(t: number) {
    this.time = t;
    this.overlay.command('seek', t);
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
    this.overlay.command('volume', v);
    this.emit('volumechange');
  }
  get muted() {
    return this.isMuted;
  }
  set muted(m: boolean) {
    this.isMuted = m;
    this.overlay.command('mute', m);
    this.emit('volumechange');
  }
  get buffered() {
    const end = Math.max(this.cacheEnd, this.time);
    return { length: 1, start: () => 0, end: () => end };
  }

  play() {
    this.isPaused = false;
    this.overlay.command('play');
    if (this.loaded && !this.buffering) this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    this.isPaused = true;
    this.overlay.command('pause');
    this.emit('pause');
  }
  destroy() {
    this.stopListening();
    this.overlay.command('stop');
  }
}

/**
 * Where a Jellyfin track is in the player's own numbering: the file's tracks of
 * that kind in order, then subtitle files loaded alongside (`externals`).
 */
export function trackPositions(s: PlaybackSession) {
  const embeddedAudio = s.isHls ? [] : s.audioTracks.filter((t) => !t.external);
  const embeddedSubs = s.isHls ? [] : s.subtitleTracks.filter((t) => !t.external);
  const externals = s.subtitleTracks.filter((t) => (s.isHls || t.external) && t.vttUrl);
  return {
    externals,
    audio: (index?: number) => (s.isHls ? 1 : embeddedAudio.findIndex((t) => t.index === index) + 1 || undefined),
    subtitle: (track?: StreamTrack) => {
      if (!track) return undefined;
      const embedded = embeddedSubs.findIndex((t) => t.index === track.index);
      if (embedded >= 0) return embedded + 1;
      const external = externals.findIndex((t) => t.index === track.index);
      return external >= 0 ? embeddedSubs.length + external + 1 : undefined;
    },
  };
}
