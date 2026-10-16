import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type VideoHTMLAttributes } from 'react';
import { ArrowLeft, Captions, Check, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MediaSegment } from '@netfish/shared';
import { SwimmingFish } from '../components/Logo';
import { clock } from '../lib/format';
import { getPrefs, setPrefs } from '../lib/prefs';
import { desktop } from '../lib/desktop';
import { isTV } from '../lib/tv';
import { parseVtt, type Cue } from './vtt';
import { t } from '../i18n';

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
  /** <video>'s volumechange (muted some other way). */
  onVolumeChange: () => void;
}

/** Volume and mute, remembered between films. */
export function useVolume(video: RefObject<HTMLVideoElement | null>): Volume {
  const [volume, setVolume] = useState(() => getPrefs().volume);
  const [muted, setMuted] = useState(false);
  const setVol = useCallback(
    (value: number) => {
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
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, [video]);
  const onVolumeChange = useCallback(() => setMuted(video.current?.muted ?? false), [video]);
  return { volume, muted, setVol, toggleMute, onVolumeChange };
}

/** Subtitles drawn by the page over the film, for players that can't draw them (Apple's, downloads in the page). */
export function PageSubtitles({ url, time, raised }: { url: string; time: number; raised: boolean }) {
  const [cues, setCues] = useState<Cue[]>([]);
  useEffect(() => {
    let alive = true;
    setCues([]);
    fetch(url)
      .then((r) => r.text())
      .then((text) => alive && setCues(parseVtt(text)))
      .catch(() => {});
    return () => {
      alive = false;
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
        <button className={`player__opt${props.subtitleIndex === undefined ? ' is-on' : ''}`} onClick={() => props.chooseSubtitle(undefined)}>
          <Check size={16} className="player__tick" />
          {t('Off')}
        </button>
        {props.subtitles.map((track) => (
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
  const onBarMove = (e: ReactPointerEvent) => scrub !== undefined && setScrub(fractionAt(e.clientX) * duration);
  const onBarUp = () => {
    if (scrub !== undefined) seekTo(scrub);
    setScrub(undefined);
  };
  const shownTime = scrub ?? time;

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
          role="slider"
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
          {scrub !== undefined && (
            <div className="seek__tip" style={{ left: `${(scrub / duration) * 100}%` }}>
              {clock(scrub)}
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
              onClick={() => volume.setVol(volume.muted || volume.volume === 0 ? Math.max(volume.volume, 0.5) : 0)}
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
