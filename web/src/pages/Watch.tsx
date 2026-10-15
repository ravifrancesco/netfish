import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import {
  ArrowLeft,
  Captions,
  Check,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { PlaybackSession, ProgressReport, StreamTrack, TogetherCommand } from '@netfish/shared';
import { api } from '../api';
import { Spinner } from '../components/ui';
import { clock } from '../lib/format';
import { getPrefs, setPrefs, usePrefs } from '../lib/prefs';
import { desktop } from '../lib/desktop';
import { isTV } from '../lib/tv';
import { buildDeviceProfile } from '../player/profile';
import { OverlayVideo, trackPositions } from '../player/overlay';
import { parseVtt, type Cue } from '../player/vtt';
import { explainReasons } from '../player/reasons';
import { useTogether } from '../lib/together';
import { TogetherChip, TogetherNotes, TogetherPanel } from '../components/Together';
import { PlayOnButton } from '../components/PlayOn';
import { t } from '../i18n';

const REPORT_EVERY = 10;

const absolute = (url: string) => new URL(url, location.origin).toString();

/** The subtitle to start with: the server's pick, else forced ones, else your language if you want subtitles. */
function pickSubtitle(s: PlaybackSession, current: StreamTrack | undefined, anyKind: boolean) {
  const usable = (t: StreamTrack) => anyKind || Boolean(t.vttUrl);
  if (current) return s.subtitleTracks.find((t) => t.index === current.index) ?? current;
  const fromServer = s.subtitleTracks.find((t) => t.index === s.subtitleStreamIndex);
  if (fromServer) return fromServer;
  if (!getPrefs().subtitlesByDefault) return s.subtitleTracks.find((t) => t.forced && usable(t));
  return s.subtitleTracks.find((t) => t.code === getPrefs().subtitleLanguage && !t.forced && usable(t));
}

/** Subtitles drawn by the page over the app's player, for players that can't draw them (Apple's). */
function PageSubtitles({ url, time, raised }: { url: string; time: number; raised: boolean }) {
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

interface LoadOptions {
  start: number;
  audio?: number;
  subtitle?: number;
  allowDirectPlay?: boolean;
}

/**
 * The player. In the apps, the app's own engine (mpv, ExoPlayer, Apple's) draws
 * the film underneath these controls, so the server sends files as they are.
 */
export default function Watch() {
  const { itemId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const prefs = usePrefs();

  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<Hls | null>(null);
  const sessionRef = useRef<PlaybackSession | undefined>(undefined);
  const started = useRef(false);
  const lastReport = useRef(0);
  const fallbackTried = useRef(false);

  // The Mac app draws the film with mpv underneath this page; these controls drive it.
  const overlay = useMemo(() => desktop()?.videoOverlay, []);
  const [overlayFailed, setOverlayFailed] = useState(false);
  const useOverlay = Boolean(overlay) && !overlayFailed;
  // mpv and ExoPlayer draw every subtitle and switch tracks inside the file; Apple's player needs help with both.
  const appDrawsSubtitles = overlay?.drawsSubtitles !== false;
  const appSwitchesTracks = overlay?.switchesTracks !== false;
  const overlayActive = useRef(useOverlay);
  overlayActive.current = useOverlay;
  const overlayVideo = useRef<OverlayVideo | null>(null);
  const overlayProfile = useRef<unknown>(undefined);
  const overlayLoaded = useRef(false);
  const fallbackAt = useRef<number | undefined>(undefined);
  const [pictureShown, setPictureShown] = useState(false);

  const info = useQuery({ queryKey: ['play', itemId], queryFn: () => api.playInfo(itemId), gcTime: 0, staleTime: 0 });
  const infoRef = useRef(info.data);
  infoRef.current = info.data;
  const [session, setSession] = useState<PlaybackSession>();
  const [audioIndex, setAudioIndex] = useState<number>();
  const [subtitle, setSubtitle] = useState<StreamTrack>();
  const [error, setError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(prefs.volume);
  const [muted, setMuted] = useState(false);
  const [showUi, setShowUi] = useState(true);
  const [menu, setMenu] = useState(false);
  const [why, setWhy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrub, setScrub] = useState<number>();
  const [nextCountdown, setNextCountdown] = useState<number>();
  const subtitleRef = useRef<StreamTrack | undefined>(undefined);
  subtitleRef.current = subtitle;

  // Watch together: this player follows the room, and tells it when you play, pause or skip.
  const roomId = params.get('room') ?? undefined;
  // Play on TV: this screen plays, run from someone's phone (a room of its own).
  const remote = Boolean(roomId) && params.get('remote') === '1';
  const roomQuery = roomId ? `?room=${roomId}${remote ? '&remote=1' : ''}` : '';
  const commandRef = useRef<(command: TogetherCommand) => void>(() => {});
  const together = useTogether(roomId, { onCommand: (command) => commandRef.current(command) });
  const togetherRef = useRef(together);
  togetherRef.current = together;
  const inRoom = () => Boolean(roomId && togetherRef.current.room && !togetherRef.current.ended);
  const itemRef = useRef(itemId);
  itemRef.current = itemId;
  /** Loaded far enough to be moved around. */
  const canSync = useRef(false);
  /** Lined up with the room once since the last load. */
  const synced = useRef(false);
  /** Changes made to follow the room (not by you) until then: they aren't passed on. */
  const followingUntil = useRef(0);
  const lastCorrection = useRef(0);
  /** Don't start on its own (the room is paused). */
  const startPaused = useRef(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [roomPanel, setRoomPanel] = useState(false);

  // ---------- reporting ----------

  const report = useCallback((event: ProgressReport['event'], s = sessionRef.current, keepalive = false) => {
    const v = video.current;
    if (!s) return;
    void api
      .progress(
        {
          event,
          itemId: s.itemId,
          mediaSourceId: s.mediaSourceId,
          playSessionId: s.playSessionId,
          positionSeconds: v?.currentTime ?? 0,
          isPaused: v?.paused ?? true,
          method: s.method,
          audioStreamIndex: s.audioStreamIndex,
          subtitleStreamIndex: s.subtitleStreamIndex,
        },
        keepalive,
      )
      .catch(() => {});
  }, []);

  // ---------- loading a stream ----------

  // mpv's events reach the same handlers <video>'s do (they change every render, so look them up late).
  const handlers = useRef<Record<string, () => void>>({});
  const wireEvents = (ov: OverlayVideo) => {
    const map: Record<string, string> = {
      playing: 'onPlaying', pause: 'onPause', waiting: 'onWaiting', canplay: 'onCanPlay', timeupdate: 'onTimeUpdate',
      durationchange: 'onDurationChange', ended: 'onEnded', error: 'onVideoError', volumechange: 'onVolumeChange', loadedmetadata: 'onLoaded',
    };
    for (const [event, key] of Object.entries(map)) ov.addEventListener(event, () => handlers.current[key]?.());
  };

  const attach = useCallback((s: PlaybackSession, start: number) => {
    if (overlayActive.current && overlay) {
      let ov = overlayVideo.current;
      if (!ov) {
        ov = new OverlayVideo(overlay);
        overlayVideo.current = ov;
        video.current = ov as unknown as HTMLVideoElement;
        wireEvents(ov);
      }
      overlayLoaded.current = false;
      setPictureShown(false);
      const positions = trackPositions(s);
      const sub = appDrawsSubtitles ? pickSubtitle(s, subtitleRef.current, true) : undefined;
      const d = infoRef.current;
      void overlay
        .load({
          url: absolute(s.url),
          isHls: s.isHls,
          title: d?.title ?? '',
          startSeconds: start,
          durationSeconds: s.durationSeconds,
          audio: { position: positions.audio(s.audioStreamIndex) ?? 1 },
          subtitles: sub ? { mode: 'on', position: positions.subtitle(sub) } : { mode: 'off' },
          externalSubtitles: appDrawsSubtitles ? positions.externals.map((t) => ({ url: absolute(t.vttUrl!), label: t.label, language: t.code })) : [],
          segments: [],
        })
        .catch((e: Error) => setError(e.message));
      ov.volume = getPrefs().volume;
      return;
    }
    const v = video.current!;
    hls.current?.destroy();
    hls.current = null;
    v.removeAttribute('src');
    if (s.isHls && Hls.isSupported()) {
      const h = new Hls({ startPosition: start, maxBufferLength: 40, backBufferLength: 30 });
      let recovered = false;
      h.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          h.recoverMediaError();
        } else {
          setError(t('The stream stopped unexpectedly.'));
        }
      });
      h.loadSource(s.url);
      h.attachMedia(v);
      hls.current = h;
    } else {
      // Progressive file, or Safari's native HLS.
      v.src = s.url;
      if (start > 0) v.addEventListener('loadedmetadata', () => (v.currentTime = start), { once: true });
    }
    if (startPaused.current) return;
    v.play().catch((err: Error) => {
      setPlaying(false);
      // The browser wants a tap before it plays sound (joined from a link, nothing clicked yet).
      if (inRoom() && err.name === 'NotAllowedError') setNeedsTap(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(
    async (opts: LoadOptions) => {
      setWaiting(true);
      setError(undefined);
      canSync.current = false;
      synced.current = false;
      togetherRef.current.setWaiting(true);
      if (sessionRef.current) report('stop');
      try {
        if (overlayActive.current && overlay) overlayProfile.current ??= await overlay.profile();
        const s = await api.playSession(itemId, {
          deviceProfile: overlayActive.current ? overlayProfile.current : buildDeviceProfile(getPrefs().maxBitrate),
          maxBitrate: getPrefs().maxBitrate || undefined,
          startSeconds: opts.start,
          audioStreamIndex: opts.audio,
          subtitleStreamIndex: opts.subtitle,
          allowDirectPlay: opts.allowDirectPlay,
        });
        sessionRef.current = s;
        started.current = false;
        setSession(s);
        setAudioIndex(s.audioStreamIndex);
        attach(s, opts.start);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [itemId, attach, report],
  );

  // First load (and whenever the item changes, e.g. next episode). In a room, from where the room is.
  const roomKnown = !roomId || Boolean(together.room) || together.ended;
  useEffect(() => {
    if (!info.data || !roomKnown) return;
    fallbackTried.current = false;
    const d = info.data;
    const room = inRoom() ? togetherRef.current.room : undefined;
    if (room && room.playback.itemId !== itemId) return; // moving to the room's episode first
    const fromUrl = params.get('t');
    const resume = d.resumeSeconds && d.durationSeconds && d.resumeSeconds < d.durationSeconds - 60 ? d.resumeSeconds : 0;
    startPaused.current = Boolean(room && !room.playback.playing);
    void load({ start: room ? (togetherRef.current.expected() ?? 0) : fromUrl !== null ? Number(fromUrl) : resume });
  }, [info.data, roomKnown]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick an initial subtitle once tracks are known.
  useEffect(() => {
    if (!session) return;
    setSubtitle((current) => pickSubtitle(session, current, overlayActive.current && appDrawsSubtitles));
  }, [session]);

  // Make the chosen text track visible (mpv: switch to it; it draws every kind, pictures too).
  useEffect(() => {
    if (overlayActive.current) {
      // The app's player draws them (mpv, ExoPlayer), or the page does (PageSubtitles below).
      if (appDrawsSubtitles && session && overlayLoaded.current) overlay?.command('subtitle', trackPositions(session).subtitle(subtitle) ?? null);
      return;
    }
    const v = video.current;
    if (!v) return;
    for (const track of Array.from(v.textTracks)) track.mode = subtitle && track.label === subtitle.label ? 'showing' : 'disabled';
  }, [subtitle, session]);

  // Stop reporting when leaving the page or closing the window.
  useEffect(() => {
    const onUnload = () => report('stop', sessionRef.current, true);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      report('stop', sessionRef.current, true);
      sessionRef.current = undefined;
      hls.current?.destroy();
      if (overlayVideo.current) {
        overlayVideo.current.destroy();
        overlayVideo.current = null;
        video.current = null;
      }
    };
  }, [itemId, report]);

  // ---------- video events ----------

  const onVideoError = () => {
    if (overlayActive.current) {
      // mpv couldn't play it: fall back to the page's own player (the server converts what it must).
      fallbackAt.current = video.current?.currentTime ?? 0;
      overlayVideo.current?.destroy();
      overlayVideo.current = null;
      video.current = null;
      setOverlayFailed(true);
      return;
    }
    const s = sessionRef.current;
    if (s?.method === 'DirectPlay' && !fallbackTried.current) {
      // The browser couldn't decode the file after all: let Jellyfin repackage it.
      fallbackTried.current = true;
      void load({ start: video.current?.currentTime ?? 0, audio: audioIndex, allowDirectPlay: false });
    } else if (!hls.current) {
      setError(t("This video can't be played in this app."));
    }
  };

  const onTimeUpdate = () => {
    const v = video.current!;
    setTime(v.currentTime);
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
    if (v.currentTime - lastReport.current >= REPORT_EVERY || v.currentTime < lastReport.current) {
      lastReport.current = v.currentTime;
      report('progress');
    }
  };

  const onPause = () => {
    setPlaying(false);
    report('progress');
    // Paused some other way (headphones out, the system's controls…): pause the room too.
    const v = video.current;
    const room = togetherRef.current.room;
    if (inRoom() && room?.playback.playing && canSync.current && Date.now() > followingUntil.current && v && !(v.duration - v.currentTime < 1)) {
      togetherRef.current.send('pause', v.currentTime);
    }
  };
  const onWaiting = () => {
    setWaiting(true);
    togetherRef.current.setWaiting(true);
  };
  const onCanPlay = () => {
    setWaiting(false);
    readyToSync();
  };
  const onDurationChange = () => setLength(video.current?.duration ?? 0);
  const onVolumeChange = () => setMuted(video.current?.muted ?? false);
  const onLoaded = () => {
    overlayLoaded.current = true;
    setPictureShown(true);
  };

  const onPlaying = () => {
    setPlaying(true);
    setWaiting(false);
    setNeedsTap(false);
    readyToSync();
    if (!started.current) {
      started.current = true;
      report('start');
      poke(); // the controls fade away a few seconds into the film
    }
  };

  const duration = (Number.isFinite(length) && length > 0 ? length : session?.durationSeconds) ?? info.data?.durationSeconds ?? 0;
  const next = info.data?.nextItemId;

  const goNext = useCallback(() => {
    if (!next) return;
    togetherRef.current.send('next', undefined, next);
    navigate(`/watch/${next}${roomQuery}`, { replace: true });
  }, [next, navigate, roomQuery]);

  const onEnded = () => {
    report('stop');
    sessionRef.current = undefined;
    if (next && getPrefs().autoplayNext) goNext();
    else if (info.data?.detailHref) navigate(info.data.detailHref, { replace: true });
  };

  handlers.current = { onPlaying, onPause, onWaiting, onCanPlay, onTimeUpdate, onDurationChange, onEnded, onVideoError, onVolumeChange, onLoaded };

  // "Next episode" countdown near the end.
  const credits = info.data?.segments.find((s) => s.type === 'Outro')?.start ?? (duration ? duration - 25 : Infinity);
  const nearEnd = Boolean(next && duration && time >= credits && time < duration - 0.5);
  useEffect(() => {
    if (!nearEnd || !getPrefs().autoplayNext) {
      setNextCountdown(undefined);
      return;
    }
    setNextCountdown((c) => c ?? 10);
    const timer = setInterval(() => setNextCountdown((c) => (c === undefined ? c : c - 1)), 1000);
    return () => clearInterval(timer);
  }, [nearEnd]);
  useEffect(() => {
    if (nextCountdown !== undefined && nextCountdown <= 0) goNext();
  }, [nextCountdown, goNext]);

  // ---------- controls ----------

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      setNeedsTap(false);
      void v.play();
      togetherRef.current.send('play', v.currentTime);
    } else {
      v.pause();
      togetherRef.current.send('pause', v.currentTime);
    }
  }, []);
  const seekTo = useCallback((t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, (v.duration || Infinity) - 0.5));
    togetherRef.current.send('seek', v.currentTime);
  }, []);

  // ---------- following the room ----------

  /** Lines this player up with the room: play or pause like it, and jump if it's drifted too far. */
  const follow = useCallback((changed: boolean) => {
    const v = video.current;
    const room = togetherRef.current.room;
    if (!inRoom() || !room || !v || !canSync.current || room.playback.itemId !== itemRef.current) return;
    // At the very end, this player is about to move on by itself (or leave).
    if (v.duration && v.currentTime > v.duration - 1) return;
    const p = room.playback;
    const want = togetherRef.current.expected() ?? 0;
    const now = Date.now();
    // Re-encoded streams take a while to seek: let them drift a little more before jumping.
    // Paused, everyone should be on the same picture.
    const slack = changed ? (p.playing ? 0.75 : 0.25) : sessionRef.current?.method === 'Transcode' ? 4 : 2;
    if (Math.abs(v.currentTime - want) > slack && (changed || now - lastCorrection.current > 6000)) {
      followingUntil.current = now + 1500;
      lastCorrection.current = now;
      // A touch ahead while playing: the jump itself takes a moment.
      v.currentTime = Math.max(0, Math.min(want + (p.playing ? 0.3 : 0), (v.duration || Infinity) - 0.5));
    }
    if (p.playing && v.paused) {
      followingUntil.current = now + 1500;
      void Promise.resolve(v.play()).catch((err: Error) => err.name === 'NotAllowedError' && setNeedsTap(true));
    } else if (!p.playing && !v.paused) {
      followingUntil.current = now + 1500;
      v.pause();
    }
  }, []);

  // Ready after loading or buffering: tell the room, and line up with it the first time.
  function readyToSync() {
    canSync.current = true;
    togetherRef.current.setWaiting(false);
    if (inRoom() && !synced.current) {
      synced.current = true;
      startPaused.current = false;
      follow(true);
      // Play on TV: the film starts by itself once it's ready here.
      const v = video.current;
      if (remote && v && togetherRef.current.room?.playback.action === 'start') {
        void Promise.resolve(v.play()).catch((err: Error) => err.name === 'NotAllowedError' && setNeedsTap(true));
        togetherRef.current.send('play', v.currentTime);
      }
    }
  }

  // Play on TV: done when the phone stops it, or when this player closes.
  const leavePlayer = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/', { replace: true });
  }, [navigate]);
  useEffect(() => {
    if (remote && together.ended) leavePlayer();
  }, [remote, together.ended, leavePlayer]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const tg = togetherRef.current;
      // A moment later: React's development mode unmounts and remounts once on purpose.
      if (remote) setTimeout(() => !alive.current && void tg.leave(), 0);
    };
  }, [remote]);

  // Someone changed something: follow it. The room moved on to another episode: go there.
  const rev = together.room?.playback.rev;
  const roomItem = together.room?.playback.itemId;
  useEffect(() => {
    if (!roomId || !roomItem || together.ended) return;
    if (roomItem !== itemId) {
      navigate(`/watch/${roomItem}${roomQuery}`, { replace: true });
      return;
    }
    follow(true);
  }, [rev, roomItem]); // eslint-disable-line react-hooks/exhaustive-deps

  // And keep checking: players drift apart slowly (different devices, a stall).
  useEffect(() => {
    if (!roomId) return;
    const timer = setInterval(() => follow(false), 2000);
    return () => clearInterval(timer);
  }, [roomId, follow]);
  const setVol = (val: number) => {
    const v = video.current!;
    v.volume = val;
    v.muted = val === 0;
    setVolume(val);
    setMuted(val === 0);
    setPrefs({ volume: val });
  };
  const toggleFullscreen = useCallback(() => {
    // The Mac app: the whole window (mpv's picture is underneath the page, not part of it).
    if (overlayActive.current && desktop()?.toggleFullscreen) return desktop()!.toggleFullscreen!();
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.current?.requestFullscreen();
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    const stop = overlay?.onState((state) => typeof state.fullscreen === 'boolean' && setFullscreen(state.fullscreen));
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      stop?.();
    };
  }, [overlay]);

  // mpv mode: the page is see-through where the picture is.
  useEffect(() => {
    if (!useOverlay) return;
    document.documentElement.classList.add('is-overlay-video');
    return () => document.documentElement.classList.remove('is-overlay-video');
  }, [useOverlay]);

  // mpv gave up on a file: carry on in the page's own player from the same spot.
  useEffect(() => {
    if (!overlayFailed || fallbackAt.current === undefined) return;
    const at = fallbackAt.current;
    fallbackAt.current = undefined;
    void load({ start: at, audio: audioIndex });
  }, [overlayFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (video.current) video.current.volume = prefs.volume;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // TV app: no screensaver in the middle of a film.
  useEffect(() => {
    desktop()?.keepAwake?.(playing);
    return () => desktop()?.keepAwake?.(false);
  }, [playing]);

  // Auto-hide the controls while playing.
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback(() => {
    setShowUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowUi(false), 3000);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const uiVisible = showUi || !playing || menu || roomPanel || Boolean(error);

  // The app's player keeps its subtitles above the controls while they show (like the web player does).
  useEffect(() => {
    if (useOverlay) overlay?.command('controls', uiVisible);
  }, [useOverlay, uiVisible, overlay]);

  const chooseAudio = (track: StreamTrack) => {
    setMenu(false);
    if (track.index === audioIndex) return;
    const s = sessionRef.current;
    if (overlayActive.current && appSwitchesTracks && s) {
      // mpv/ExoPlayer switch tracks inside the file instantly: no new stream needed.
      const position = trackPositions(s).audio(track.index);
      if (position) overlay?.command('audio', position);
      setAudioIndex(track.index);
      sessionRef.current = { ...s, audioStreamIndex: track.index };
      return;
    }
    // Browsers can't switch tracks inside a file, so ask Jellyfin for a repackaged stream with that track.
    void load({ start: video.current?.currentTime ?? 0, audio: track.index, subtitle: subtitle?.burnIn ? subtitle.index : undefined, allowDirectPlay: s?.method === 'DirectPlay' && track.default ? true : false });
  };
  const chooseSubtitle = (track?: StreamTrack) => {
    setMenu(false);
    const wasBurned = subtitle?.burnIn;
    setSubtitle(track);
    if (track) setPrefs({ subtitleLanguage: track.code ?? getPrefs().subtitleLanguage });
    if (overlayActive.current && appDrawsSubtitles) return; // the app's player draws every kind itself
    if (track?.burnIn || wasBurned) {
      void load({ start: video.current?.currentTime ?? 0, audio: audioIndex, subtitle: track?.burnIn ? track.index : undefined, allowDirectPlay: !track?.burnIn });
    }
  };

  // Play on TV: the phone changes audio and subtitles here, and sees what there is to choose.
  commandRef.current = (command) => {
    const s = sessionRef.current;
    if (command.action === 'stop') return leavePlayer();
    if (!s) return;
    if (command.action === 'audio') {
      const track = s.audioTracks.find((tr) => tr.index === command.index);
      if (track) chooseAudio(track);
    } else if (command.action === 'subtitle') {
      chooseSubtitle(command.index === null ? undefined : s.subtitleTracks.find((tr) => tr.index === command.index));
    }
  };
  const joined = Boolean(together.room);
  useEffect(() => {
    if (!remote || !roomId || !session || !joined) return;
    const list = (tracks: StreamTrack[]) => tracks.map(({ index, label }) => ({ index, label }));
    void api
      .roomTracks(roomId, together.clientId, {
        audio: list(session.audioTracks),
        subtitles: list(session.subtitleTracks),
        audioIndex,
        subtitleIndex: subtitle?.index ?? null,
      })
      .catch(() => {});
  }, [remote, roomId, session, joined, audioIndex, subtitle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
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
        const onControl = uiVisible && (e.target as HTMLElement).closest?.('button, a, [tabindex]');
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
          setVol(Math.min(1, (v?.volume ?? 1) + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVol(Math.max(0, (v?.volume ?? 1) - 0.1));
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          if (v) {
            v.muted = !v.muted;
            setMuted(v.muted);
          }
          break;
        case 'Escape':
          if (menu) setMenu(false);
          else if (roomPanel) setRoomPanel(false);
          else if (fullscreen) toggleFullscreen();
          else navigate(-1);
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
  const intro = info.data?.segments.find((s) => (s.type === 'Intro' || s.type === 'Recap') && time >= s.start && time < s.end - 1);
  const d = info.data;
  const heading = d?.type === 'Episode' ? d.seriesTitle : d?.title;
  const subheading = d?.type === 'Episode' ? `S${d.seasonNumber}:E${d.episodeNumber} · ${d.title}` : undefined;

  return (
    <div
      ref={container}
      className={`player${uiVisible ? ' show-ui' : ''}${useOverlay ? ' player--overlay' : ''}`}
      onMouseMove={poke}
      onPointerDown={(e) => e.pointerType !== 'mouse' && poke()}
    >
      {useOverlay ? (
        // mpv draws the picture underneath; this only catches clicks (and shows the artwork until it starts).
        <div
          className="player__surface"
          style={!pictureShown && d?.backdrop ? { backgroundImage: `url(${d.backdrop})` } : undefined}
          onClick={() => (uiVisible ? toggle() : poke())}
          onDoubleClick={toggleFullscreen}
        />
      ) : (
        <video
          ref={video}
          className="player__video"
          playsInline
          preload="auto"
          // In a paused room nothing starts it, so it's ready as soon as it knows the film.
          onLoadedMetadata={() => startPaused.current && (setWaiting(false), readyToSync())}
          poster={d?.backdrop}
          // While the controls are hidden, a click/tap only brings them back (like Netflix).
          onClick={() => (uiVisible ? toggle() : poke())}
          onDoubleClick={toggleFullscreen}
          onPlaying={onPlaying}
          onPause={onPause}
          onWaiting={onWaiting}
          onCanPlay={onCanPlay}
          onTimeUpdate={onTimeUpdate}
          onDurationChange={onDurationChange}
          onEnded={onEnded}
          onError={onVideoError}
          onVolumeChange={onVolumeChange}
        >
          {subtitle?.vttUrl && <track key={subtitle.vttUrl} kind="subtitles" src={subtitle.vttUrl} srcLang={subtitle.code} label={subtitle.label} default />}
        </video>
      )}
      {useOverlay && !appDrawsSubtitles && subtitle?.vttUrl && <PageSubtitles url={subtitle.vttUrl} time={time} raised={uiVisible} />}

      {needsTap && !error && (
        <div className="player__center">
          <button className="btn btn--primary btn--lg" onClick={() => (setNeedsTap(false), follow(true))}>
            <Play size={22} fill="currentColor" /> {t('Join in')}
          </button>
        </div>
      )}
      {roomId && !remote && <TogetherNotes together={together} />}

      {(waiting || info.isLoading) && !error && !needsTap && (
        <div className="player__center">
          <Spinner size={48} />
        </div>
      )}
      {(error || info.isError) && (
        <div className="player__center player__error">
          <p>{error ?? (info.error as Error).message}</p>
          <div className="row-gap">
            <button className="btn btn--primary" onClick={() => void load({ start: time, audio: audioIndex, allowDirectPlay: false })}>
              {t('Try again')}
            </button>
            <button className="btn btn--ghost" onClick={() => navigate(-1)}>
              {t('Go back')}
            </button>
          </div>
        </div>
      )}

      <div className="player__top">
        <button className="icon-btn icon-btn--lg" onClick={() => navigate(-1)} aria-label={t('Back')}>
          <ArrowLeft size={28} />
        </button>
        <div className="player__heading">
          <span className="player__title">{heading}</span>
          {subheading && <span className="player__subtitle">{subheading}</span>}
        </div>
        {!roomId && d && (
          // Hand the film over to another screen, from where it is now.
          <PlayOnButton
            itemId={itemId}
            title={heading ?? d.title}
            position={() => video.current?.currentTime ?? 0}
            onSent={() => video.current?.pause()}
            className="icon-btn icon-btn--lg"
            iconOnly
          />
        )}
        {roomId && !remote && (
          <div className="together-wrap">
            <TogetherChip together={together} open={roomPanel} onToggle={() => setRoomPanel((o) => !o)} />
            {roomPanel && (
              <TogetherPanel
                together={together}
                onClose={() => setRoomPanel(false)}
                onLeave={() => {
                  // Out of the room, still watching: the film carries on from here.
                  void together.leave();
                  setRoomPanel(false);
                  navigate(`/watch/${itemId}`, { replace: true });
                }}
              />
            )}
          </div>
        )}
        {session && session.method !== 'DirectPlay' && (
          <div className="player__why-wrap">
            <button
              className={`badge ${session.method === 'Transcode' ? 'badge--warn' : 'badge--dim'}`}
              onClick={() => setWhy((w) => !w)}
              aria-expanded={why}
              title={t('Why is the server working on this video?')}
            >
              {session.method === 'DirectStream' ? t('Repackaged') : t('Transcoding')}
            </button>
            {why && (
              <div className="player__why" role="note">
                <strong>{session.method === 'Transcode' ? t('The server is re-encoding this video') : t('The server is lightly repackaging this video')}</strong>
                <ul>
                  {explainReasons(session.transcodeReasons).map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
                {subtitle?.burnIn && (
                  <button className="btn btn--sm btn--ghost" onClick={() => (setWhy(false), chooseSubtitle(session.subtitleTracks.find((t) => !t.burnIn && t.code === subtitle.code)))}>
                    {session.subtitleTracks.some((t) => !t.burnIn && t.code === subtitle.code) ? t('Use text subtitles instead') : t('Turn subtitles off')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {roomId && !remote && together.room?.playback.action === 'start' && !playing && !together.ended && (
        <div className="together-hint">{t("Everyone's player starts together: press play when you're all here.")}</div>
      )}

      {intro && (
        <button className="player__skip btn btn--ghost" onClick={() => seekTo(intro.end)}>
          {intro.type === 'Recap' ? t('Skip recap') : t('Skip intro')} <SkipForward size={18} />
        </button>
      )}
      {nearEnd && next && (
        <div className="player__next">
          <span className="muted small">{nextCountdown !== undefined ? t('Next episode in {n}', { n: nextCountdown }) : t('Next episode')}</span>
          <strong>{d?.nextTitle}</strong>
          <div className="row-gap">
            <button className="btn btn--primary btn--sm" onClick={goNext}>
              <Play size={16} fill="currentColor" /> {t('Play now')}
            </button>
            {nextCountdown !== undefined && (
              <button className="btn btn--ghost btn--sm" onClick={() => setNextCountdown(undefined)}>
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
            <div className="seek__buffer" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            <div className="seek__fill" style={{ width: `${duration ? (shownTime / duration) * 100 : 0}%` }} />
            {d?.segments
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
            <button className="icon-btn" onClick={() => setVol(muted || volume === 0 ? Math.max(volume, 0.5) : 0)} aria-label={muted ? t('Unmute') : t('Mute')}>
              {muted || volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
            </button>
            <input className="volume__slider" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => setVol(Number(e.target.value))} aria-label={t('Volume')} />
          </div>
          <span className="player__time">
            {clock(shownTime)} <span className="muted">/ {clock(duration)}</span>
          </span>
          <span className="spacer" />
          {next && (
            <button className="icon-btn" onClick={goNext} aria-label={t('Next episode')} title={t('Next episode')}>
              <SkipForward size={24} />
            </button>
          )}
          <div className="player__menu-wrap">
            <button className={`icon-btn${menu ? ' is-active' : ''}`} onClick={() => setMenu((m) => !m)} aria-label={t('Audio and subtitles')} aria-expanded={menu}>
              <Captions size={24} />
            </button>
            {menu && session && (
              <div className="player__menu">
                <div className="player__menu-col">
                  <h3>{t('Audio')}</h3>
                  {session.audioTracks.map((track) => (
                    <button key={track.index} className={`player__opt${track.index === audioIndex ? ' is-on' : ''}`} onClick={() => chooseAudio(track)}>
                      <Check size={16} className="player__tick" />
                      {track.label}
                    </button>
                  ))}
                  {d?.detailHref && (
                    <Link className="player__link" to={`${d.detailHref}?sheet=versions`}>
                      {t('Get another language…')}
                    </Link>
                  )}
                </div>
                <div className="player__menu-col">
                  <h3>{t('Subtitles')}</h3>
                  <button className={`player__opt${!subtitle ? ' is-on' : ''}`} onClick={() => chooseSubtitle(undefined)}>
                    <Check size={16} className="player__tick" />
                    {t('Off')}
                  </button>
                  {session.subtitleTracks.map((track) => (
                    <button key={track.index} className={`player__opt${subtitle?.index === track.index ? ' is-on' : ''}`} onClick={() => chooseSubtitle(track)}>
                      <Check size={16} className="player__tick" />
                      {track.label}
                      {track.burnIn && <span className="muted small"> · {t('picture subtitles, heavy for the server')}</span>}
                    </button>
                  ))}
                  {d?.detailHref && (
                    <Link className="player__link" to={`${d.detailHref}?sheet=subtitles`}>
                      {t('Find more subtitles…')}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
          <button className="icon-btn" onClick={toggleFullscreen} aria-label={fullscreen ? t('Exit full screen') : t('Full screen')}>
            {fullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
        </div>
      </div>
    </div>
  );
}
