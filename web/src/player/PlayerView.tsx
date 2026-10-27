import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type VideoHTMLAttributes } from 'react';
import { ArrowLeft, Captions, Check, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MediaSegment, Trickplay } from '@netfish/shared';
import { SwimmingFish } from '../components/Logo';
import { clock } from '../lib/format';
import { getPrefs, setPrefs } from '../lib/prefs';
import { desktop } from '../lib/desktop';
import { setSystemMuted, setSystemVolume, systemVolume, useSystemVolume } from '../lib/systemVolume';
import { isTV } from '../lib/tv';
import { parseVtt, type Cue } from './vtt';
import { menuSubtitles } from './tracks';
import { locale, t } from '../i18n';

/**
 * Netfish's player screen: the controls, the Audio and Subtitles menu, the seek bar, the
 * keys and the remote. Shared by the player that streams from the server (pages/Watch) and
 * the one that plays downloads (DownloadPlayer, also inside the apps' downloads page), so
 * a film looks and works the same either way. What plays the film is up to them.
 */

/** A choice in the Audio and Subtitles menu. */
export interface MenuTrack {
  index: number;
  label: string;
  /** After the name, dimmed. */
  note?: string;
  /** Subtitles: forced ones (signs, lines in another language) go with "Off". */
  forced?: boolean;
  code?: string;
}

export interface PlayerViewProps {
  /** The film: <video>, or the app's player drawing it underneath the page (OverlayVideo). */
  video: RefObject<HTMLVideoElement | null>;
  /** The app draws the film underneath: the page only catches clicks, and shows `backdrop` until the picture is there. */
  overlay: boolean;
  /** <video>'s own events and children (none in overlay mode). */
  videoProps?: VideoHTMLAttributes<HTMLVideoElement>;
  backdrop?: string;
  pictureShown?: boolean;
  /** Full screen is the app's whole window (Mac and Windows), not part of the page. */
  appFullscreen?: boolean;
  heading?: string;
  subheading?: string;

  playing: boolean;
  /** Loading or buffering: the fish swims. */
  waiting: boolean;
  time: number;
  duration: number;
  buffered: number;
  /** Jellyfin's scrubbing previews, when it has made them for this file. */
  trickplay?: Trickplay;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  volume: Volume;
  onBack: () => void;

  error?: { message: string; retry?: () => void };
  /** In the middle instead of the fish (Watch together's "Join in"). */
  center?: ReactNode;
  /** The top bar, after the title (Watch together, Play on, the server's badge). */
  actions?: ReactNode;
  /** Over the film (Watch together's notes and hints). */
  children?: ReactNode;
  /** Keep the controls showing (a panel of the caller's is open). */
  holdUi?: boolean;
  /** Escape: the caller closes its own panel first (true when it did). */
  onEscape?: () => boolean;

  /** Intros and credits (skip intro, the seek bar's marks, "next episode" timing). */
  segments?: MediaSegment[];
  next?: { title?: string; go: () => void };

  audio: MenuTrack[];
  audioIndex?: number;
  chooseAudio: (index: number) => void;
  subtitles: MenuTrack[];
  /** Undefined: off. */
  subtitleIndex?: number;
  chooseSubtitle: (index?: number) => void;
  /** The tracks are known (the menu has something to show). */
  tracksKnown?: boolean;
  /** Under each column of the menu (streaming: get another language, find more subtitles). */
  audioMore?: ReactNode;
  subtitlesMore?: ReactNode;
  /** Text subtitles the page draws itself, for players that can't (VTT address). */
  pageSubtitles?: string;
  /** Whether the controls are showing (the app's player lifts its subtitles above them). */
  onControls?: (showing: boolean) => void;
}

export interface Volume {
  volume: number;
  muted: boolean;
  setVol: (value: number) => void;
  toggleMute: () => void;
  /** The speaker button: silent, or back to a level you can hear (the computer's own mute when it's the computer's volume). */
  pressMute: () => void;
  /** <video>'s volumechange (muted some other way). */
  onVolumeChange: () => void;
}

/**
 * Volume and mute, remembered between films. In the Mac and Windows apps they're the computer's
 * own (the volume keys move the slider, the slider moves the computer's), with the film at full volume.
 */
export function useVolume(video: RefObject<HTMLVideoElement | null>): Volume {
  const system = useSystemVolume();
  const [volume, setVolume] = useState(() => getPrefs().volume);
  const [muted, setMuted] = useState(false);
  const following = Boolean(system);
  useEffect(() => {
    const v = video.current;
    if (following && v && (v.volume !== 1 || v.muted)) {
      v.volume = 1;
      v.muted = false;
    }
  }, [following, video]);
  const setVol = useCallback(
    (value: number) => {
      if (systemVolume()) return setSystemVolume(value);
      const v = video.current;
      if (v) {
        v.volume = value;
        v.muted = value === 0;
      }
      setVolume(value);
      setMuted(value === 0);
      setPrefs({ volume: value });
    },
    [video],
  );
  const toggleMute = useCallback(() => {
    const s = systemVolume();
    if (s) return setSystemMuted(!s.muted);
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, [video]);
  const onVolumeChange = useCallback(() => {
    if (!systemVolume()) setMuted(video.current?.muted ?? false);
  }, [video]);
  const pressMute = useCallback(() => {
    const s = systemVolume();
    if (s) return s.volume === 0 ? setSystemVolume(0.5) : setSystemMuted(!s.muted);
    setVol(muted || volume === 0 ? Math.max(volume, 0.5) : 0);
  }, [muted, volume, setVol]);
  return system
    ? { volume: system.volume, muted: system.muted, setVol, toggleMute, pressMute, onVolumeChange }
    : { volume, muted, setVol, toggleMute, pressMute, onVolumeChange };
}

/** How wide the preview frame is shown, whatever size Jellyfin made them. */
const FRAME_WIDTH = 200;

/** The frame at `at` seconds, from Jellyfin's scrubbing previews (pictures that each hold a grid of frames). */
function ScrubFrame({ trick, at }: { trick: Trickplay; at: number }) {
  const n = Math.min(trick.count - 1, Math.max(0, Math.floor(at / trick.interval)));
  const perPicture = trick.columns * trick.rows;
  const cell = n % perPicture;
  // Whole pixels, so no sliver of the next frame shows.
  const height = Math.round((trick.height * FRAME_WIDTH) / trick.width);
  return (
    <span
      className="seek__frame"
      aria-hidden="true"
      style={{
        width: FRAME_WIDTH,
        height,
        backgroundImage: `url("${trick.url.replace('{index}', String(Math.floor(n / perPicture)))}")`,
        backgroundSize: `${trick.columns * FRAME_WIDTH}px ${trick.rows * height}px`,
        backgroundPosition: `-${(cell % trick.columns) * FRAME_WIDTH}px -${Math.floor(cell / trick.columns) * height}px`,
      }}
    />
  );
}

/** Subtitles drawn by the page over the film, for players that can't draw them (Apple's, downloads in the page). */
export function PageSubtitles({ url, time, raised }: { url: string; time: number; raised: boolean }) {
  const [cues, setCues] = useState<Cue[]>([]);
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setCues([]);
    // The first time, Jellyfin may need a while to pull subtitles out of the file: a failure gets a few more tries.
    const load = (tries: number) =>
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then((text) => alive && setCues(parseVtt(text)))
        .catch(() => {
          if (alive && tries < 4) retry = setTimeout(() => void load(tries + 1), 5000);
        });
    void load(0);
    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, [url]);
  const showing = cues.filter((c) => time >= c.start && time <= c.end);
  if (!showing.length) return null;
  return (
    <div className={`player__cues${raised ? ' is-raised' : ''}`} aria-live="polite">
      {showing.map((c) => (
        <span key={`${c.start}-${c.text}`} className="player__cue">
          {c.text}
        </span>
      ))}
    </div>
  );
}

/** The Audio and Subtitles menu (the player's, and a channel's). */
export function TrackMenu(props: {
  audio: MenuTrack[];
  audioIndex?: number;
  chooseAudio: (index: number) => void;
  subtitles: MenuTrack[];
  subtitleIndex?: number;
  chooseSubtitle: (index?: number) => void;
  audioMore?: ReactNode;
  subtitlesMore?: ReactNode;
}) {
  const subtitles = menuSubtitles(props.subtitles);
  const off = props.subtitleIndex === undefined || !subtitles.some((track) => track.index === props.subtitleIndex);
  return (
    <div className="player__menu">
      {(props.audio.length > 0 || props.audioMore) && (
        <div className="player__menu-col">
          <h3>{t('Audio')}</h3>
          {props.audio.map((track) => (
            <button key={track.index} className={`player__opt${track.index === props.audioIndex ? ' is-on' : ''}`} onClick={() => props.chooseAudio(track.index)}>
              <Check size={16} className="player__tick" />
              {track.label}
              {track.note && <span className="muted small"> · {track.note}</span>}
            </button>
          ))}
          {props.audioMore}
        </div>
      )}
      <div className="player__menu-col">
        <h3>{t('Subtitles')}</h3>
        <button className={`player__opt${off ? ' is-on' : ''}`} onClick={() => props.chooseSubtitle(undefined)}>
          <Check size={16} className="player__tick" />
          {t('Off')}
        </button>
        {subtitles.map((track) => (
          <button key={track.index} className={`player__opt${props.subtitleIndex === track.index ? ' is-on' : ''}`} onClick={() => props.chooseSubtitle(track.index)}>
            <Check size={16} className="player__tick" />
            {track.label}
            {track.note && <span className="muted small"> · {track.note}</span>}
          </button>
        ))}
        {props.subtitlesMore}
      </div>
    </div>
  );
}

export function PlayerView(props: PlayerViewProps) {
  const { video, overlay, playing, time, duration, toggle, seekTo, volume, segments = [], next, error } = props;
  const container = useRef<HTMLDivElement>(null);
  const [showUi, setShowUi] = useState(true);
  const [menu, setMenu] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrub, setScrub] = useState<number>();
  const [countdown, setCountdown] = useState<number>();

  // ---------- full screen ----------

  const toggleFullscreen = useCallback(() => {
    // The Mac and Windows apps: the whole window (their player is underneath the page, not part of it).
    if (props.appFullscreen && desktop()?.toggleFullscreen) return desktop()!.toggleFullscreen!();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
  }, [props.appFullscreen]);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    const stop = desktop()?.videoOverlay?.onState((state) => typeof state.fullscreen === 'boolean' && setFullscreen(state.fullscreen));
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      stop?.();
    };
  }, []);

  // ---------- the controls fade away while playing ----------

  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setShowUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowUi(false), 3000);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  // A few seconds into the film (and after each pause), out of the way.
  useEffect(() => {
    if (playing) poke();
  }, [playing, poke]);
  const uiVisible = showUi || !playing || menu || Boolean(props.holdUi) || Boolean(error);
  const onControls = props.onControls;
  useEffect(() => {
    onControls?.(uiVisible);
  }, [uiVisible, onControls]);

  // ---------- intro, credits, next episode ----------

  const intro = segments.find((s) => (s.type === 'Intro' || s.type === 'Recap') && time >= s.start && time < s.end - 1);
  const credits = segments.find((s) => s.type === 'Outro')?.start ?? (duration ? duration - 25 : Infinity);
  const nearEnd = Boolean(next && duration && time >= credits && time < duration - 0.5);
  useEffect(() => {
    if (!nearEnd || !getPrefs().autoplayNext) {
      setCountdown(undefined);
      return;
    }
    setCountdown((c) => c ?? 10);
    const timer = setInterval(() => setCountdown((c) => (c === undefined ? c : c - 1)), 1000);
    return () => clearInterval(timer);
  }, [nearEnd]);
  const goNext = next?.go;
  useEffect(() => {
    if (countdown !== undefined && countdown <= 0) goNext?.();
  }, [countdown, goNext]);

  // ---------- keys and the remote ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // What was really pressed on (inside the downloads page's player, events arrive from its shadow root).
      const target = (e.composedPath?.()[0] ?? e.target) as HTMLElement;
      if (target?.tagName === 'INPUT') return;
      const v = video.current;
      poke();
      if (e.defaultPrevented) return; // TV: focus moved between the controls
      switch (e.key) {
        case 'MediaPlayPause':
          toggle();
          return;
        case 'MediaPlay':
          if (!playing) toggle();
          return;
        case 'MediaPause':
          if (playing) toggle();
          return;
        case 'MediaFastForward':
          seekTo((v?.currentTime ?? 0) + 30);
          return;
        case 'MediaRewind':
          seekTo((v?.currentTime ?? 0) - 30);
          return;
      }
      if (isTV() && target?.classList?.contains('seek')) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          stepScrub(e.key === 'ArrowRight' ? 1 : -1, e.repeat);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          commitScrub();
          return;
        }
      }
      if (isTV()) {
        // Remote: with the controls hidden (or nothing chosen), Select pauses, left/right
        // skip 10 s, and up/down bring up the controls on the most useful button.
        const onControl = uiVisible && target.closest?.('button, a, [tabindex]');
        if (!onControl) {
          if (e.key === 'Enter') {
            e.preventDefault();
            toggle();
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            container.current?.querySelector<HTMLElement>('.player__skip, .player__next .btn--primary, .player__controls button')?.focus();
            return;
          }
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekTo((v?.currentTime ?? 0) - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekTo((v?.currentTime ?? 0) + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          volume.setVol(Math.min(1, (v?.volume ?? 1) + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          volume.setVol(Math.max(0, (v?.volume ?? 1) - 0.1));
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          volume.toggleMute();
          break;
        case 'Escape':
          if (menu) setMenu(false);
          else if (props.onEscape?.()) break;
          else if (fullscreen) toggleFullscreen();
          else props.onBack();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bind every render: cheap and always sees current state

  // ---------- seek bar ----------

  const bar = useRef<HTMLDivElement>(null);
  const fractionAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const onBarDown = (e: ReactPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setScrub(fractionAt(e.clientX) * duration);
  };
  // A mouse over the timeline: where it points, with the preview (like Jellyscrub).
  const [hoverAt, setHoverAt] = useState<number>();
  const onBarMove = (e: ReactPointerEvent) => {
    if (scrub !== undefined) setScrub(fractionAt(e.clientX) * duration);
    else if (e.pointerType === 'mouse' && props.trickplay) setHoverAt(fractionAt(e.clientX) * duration);
  };
  const onBarUp = () => {
    if (scrub !== undefined) seekTo(scrub);
    setScrub(undefined);
  };
  const shownTime = scrub ?? time;

  // TV: the timeline, chosen with the remote: left/right move along it (further each step the
  // longer they're held), and the film goes there on Select, or a moment after the last press.
  const tvScrub = useRef<{ to?: number; held: number; timer?: number }>({ held: 0 });
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;
  const commitScrub = useCallback(() => {
    const s = tvScrub.current;
    window.clearTimeout(s.timer);
    if (s.to !== undefined) seekRef.current(s.to);
    s.to = undefined;
    setScrub(undefined);
  }, []);
  const stepScrub = useCallback(
    (dir: 1 | -1, repeat: boolean) => {
      const s = tvScrub.current;
      s.held = repeat ? s.held + 1 : 0;
      const step = s.held < 4 ? 10 : s.held < 12 ? 30 : 60;
      const from = s.to ?? video.current?.currentTime ?? 0;
      s.to = Math.max(0, Math.min(Math.max(0, durationRef.current - 1), from + dir * step));
      setScrub(s.to);
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(commitScrub, 1200);
    },
    [video, commitScrub],
  );

  const choose = (pick: () => void) => {
    setMenu(false);
    pick();
  };
  const hasMenu = props.audio.length > 1 || props.subtitles.length > 0 || Boolean(props.audioMore || props.subtitlesMore);
  // While the controls are hidden, a click or tap only brings them back (like Netflix). As they
  // were when the finger went down: a touch shows them at once, before its click arrives.
  const shownAtPress = useRef(true);
  const onSurfaceClick = () => (shownAtPress.current ? toggle() : poke());

  return (
    <div
      ref={container}
      className={`player${uiVisible ? ' show-ui' : ''}${overlay ? ' player--overlay' : ''}`}
      onMouseMove={poke}
      onPointerDown={(e) => {
        shownAtPress.current = uiVisible;
        if (e.pointerType !== 'mouse') poke();
      }}
    >
      {overlay ? (
        // The app draws the picture underneath; this only catches clicks (and shows the artwork until it starts).
        <div
          className="player__surface"
          style={!props.pictureShown && props.backdrop ? { backgroundImage: `url(${props.backdrop})` } : undefined}
          onClick={onSurfaceClick}
          onDoubleClick={toggleFullscreen}
        />
      ) : (
        <video
          ref={video}
          className="player__video"
          playsInline
          preload="auto"
          poster={props.backdrop}
          {...props.videoProps}
          onClick={onSurfaceClick}
          onDoubleClick={toggleFullscreen}
        />
      )}
      {props.pageSubtitles && <PageSubtitles url={props.pageSubtitles} time={time} raised={uiVisible} />}

      {props.children}
      {props.center ? (
        <div className="player__center">{props.center}</div>
      ) : (
        props.waiting &&
        !error && (
          <div className="player__center">
            <SwimmingFish size={56} className="swimming-fish--player" />
          </div>
        )
      )}
      {error && (
        <div className="player__center player__error">
          <p>{error.message}</p>
          <div className="row-gap">
            {error.retry && (
              <button className="btn btn--primary" onClick={error.retry}>
                {t('Try again')}
              </button>
            )}
            <button className="btn btn--ghost" onClick={props.onBack}>
              {t('Go back')}
            </button>
          </div>
        </div>
      )}

      <div className="player__top">
        <button className="icon-btn icon-btn--lg" onClick={props.onBack} aria-label={t('Back')}>
          <ArrowLeft size={28} />
        </button>
        <div className="player__heading">
          <span className="player__title">{props.heading}</span>
          {props.subheading && <span className="player__subtitle">{props.subheading}</span>}
        </div>
        {props.actions}
      </div>

      {intro && (
        <button className="player__skip btn btn--ghost" onClick={() => seekTo(intro.end)}>
          {intro.type === 'Recap' ? t('Skip recap') : t('Skip intro')} <SkipForward size={18} />
        </button>
      )}
      {nearEnd && next && (
        <div className="player__next">
          <span className="muted small">{countdown !== undefined ? t('Next episode in {n}', { n: countdown }) : t('Next episode')}</span>
          <strong>{next.title}</strong>
          <div className="row-gap">
            <button className="btn btn--primary btn--sm" onClick={next.go}>
              <Play size={16} fill="currentColor" /> {t('Play now')}
            </button>
            {countdown !== undefined && (
              <button className="btn btn--ghost btn--sm" onClick={() => setCountdown(undefined)}>
                {t('Cancel')}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="player__bottom">
        <div
          ref={bar}
          className="seek"
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={onBarUp}
          onPointerLeave={() => setHoverAt(undefined)}
          role="slider"
          tabIndex={isTV() ? 0 : undefined}
          onBlur={() => tvScrub.current.to !== undefined && commitScrub()}
          aria-label={t('Seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(shownTime)}
        >
          <div className="seek__track">
            <div className="seek__buffer" style={{ width: `${duration ? (props.buffered / duration) * 100 : 0}%` }} />
            <div className="seek__fill" style={{ width: `${duration ? (shownTime / duration) * 100 : 0}%` }} />
            {segments
              .filter((s) => s.type === 'Intro')
              .map((s) => (
                <div key={s.start} className="seek__segment" style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }} />
              ))}
          </div>
          <div className="seek__thumb" style={{ left: `${duration ? (shownTime / duration) * 100 : 0}%` }} />
          {(scrub ?? hoverAt) !== undefined && (
            <div
              className={`seek__tip${props.trickplay ? ' seek__tip--frame' : ''}`}
              style={{
                // Kept on screen at either end (the preview is wider than the time).
                left: props.trickplay
                  ? `clamp(${FRAME_WIDTH / 2 + 8}px, ${(((scrub ?? hoverAt)!) / duration) * 100}%, calc(100% - ${FRAME_WIDTH / 2 + 8}px))`
                  : `${(((scrub ?? hoverAt)!) / duration) * 100}%`,
              }}
            >
              {props.trickplay && <ScrubFrame trick={props.trickplay} at={(scrub ?? hoverAt)!} />}
              {clock((scrub ?? hoverAt)!)}
            </div>
          )}
        </div>

        <div className="player__controls">
          <button className="icon-btn icon-btn--lg" onClick={toggle} aria-label={playing ? t('Pause') : t('Play')}>
            {playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => seekTo(time - 10)} aria-label={t('Back 10 seconds')}>
            <RotateCcw size={24} />
          </button>
          <button className="icon-btn" onClick={() => seekTo(time + 10)} aria-label={t('Forward 10 seconds')}>
            <RotateCw size={24} />
          </button>
          <div className="volume">
            <button
              className="icon-btn"
              onClick={volume.pressMute}
              aria-label={volume.muted ? t('Unmute') : t('Mute')}
            >
              {volume.muted || volume.volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
            </button>
            <input
              className="volume__slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume.muted ? 0 : volume.volume}
              onChange={(e) => volume.setVol(Number(e.target.value))}
              aria-label={t('Volume')}
            />
          </div>
          <span className="player__time">
            {clock(shownTime)} <span className="muted">/ {clock(duration)}</span>
            {/* When it'll be over, watched from here on (the clock where you are). */}
            {duration > 0 && duration - shownTime > 30 && (
              <span className="muted player__ends"> · {t('ends {time}', { time: new Date(Date.now() + (duration - shownTime) * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</span>
            )}
          </span>
          <span className="spacer" />
          {next && (
            <button className="icon-btn" onClick={next.go} aria-label={t('Next episode')} title={t('Next episode')}>
              <SkipForward size={24} />
            </button>
          )}
          {hasMenu && (
            <div className="player__menu-wrap">
              <button className={`icon-btn${menu ? ' is-active' : ''}`} onClick={() => setMenu((m) => !m)} aria-label={t('Audio and subtitles')} aria-expanded={menu}>
                <Captions size={24} />
              </button>
              {menu && props.tracksKnown !== false && (
                <TrackMenu
                  audio={props.audio}
                  audioIndex={props.audioIndex}
                  chooseAudio={(index) => choose(() => props.chooseAudio(index))}
                  subtitles={props.subtitles}
                  subtitleIndex={props.subtitleIndex}
                  chooseSubtitle={(index) => choose(() => props.chooseSubtitle(index))}
                  audioMore={props.audioMore}
                  subtitlesMore={props.subtitlesMore}
                />
              )}
            </div>
          )}
          <button className="icon-btn" onClick={toggleFullscreen} aria-label={fullscreen ? t('Exit full screen') : t('Full screen')}>
            {fullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
        </div>
      </div>
    </div>
  );
}
