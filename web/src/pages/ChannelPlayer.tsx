import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import Hls from 'hls.js';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Captions, Check, ChevronDown, ChevronUp, LayoutList, Maximize, Minimize, Play, Volume2, VolumeX } from 'lucide-react';
import type { ChannelProgram, PlaybackSession, StreamTrack } from '@netfish/shared';
import { api } from '../api';
import { SwimmingFish } from '../components/Logo';
import { ChannelBreak, ChannelStatic, sceneFor } from '../components/ChannelBreak';
import { isStandIn, NewBadge } from '../components/NewBadge';
import { useToast } from '../components/ui';
import { clockTime, episodeLine, onNow, programEnd, programTitle, serverNow, useChannels, useServerNow } from '../lib/channels';
import { desktop } from '../lib/desktop';
import { deviceId, getPrefs, setPrefs } from '../lib/prefs';
import { screenId } from '../lib/screens';
import { buildDeviceProfile } from '../player/profile';
import { OverlayVideo, trackPositions } from '../player/overlay';
import { PageSubtitles, TrackMenu, useVolume } from '../player/PlayerView';
import { pickSubtitle } from '../player/tracks';
import { t, tn } from '../i18n';
import { browserTV } from '../lib/tv';

/**
 * A channel: the programme that's on, from the minute it's at, for everyone. No pausing or
 * skipping (that's the point). Up and down (the remote, the keyboard, a swipe, the buttons)
 * change channel, numbers jump to one, and the channel's name (or OK) lists them all with
 * what's on. Between programmes, a short break with the fish (ChannelBreak).
 * The film plays like any other: in the app's own player where there is one, else the page's.
 */

const absolute = (url: string) => new URL(url, location.origin).toString();
const LAST = 'netfish.channel';

export default function ChannelPlayer() {
  const { number = '' } = useParams();
  const navigate = useNavigate();
  const q = useChannels();
  const channels = q.data?.channels ?? [];
  const countWatched = Boolean(q.data?.countWatched);
  const channel = channels.find((c) => c.number === Number(number));
  const now = useServerNow(500);
  const on = channel ? onNow(channel, now) : undefined;
  const program = on?.program;
  const key = channel && program ? `${channel.id}:${program.itemId}:${program.start}` : undefined;

  // ---------- the film ----------

  const video = useRef<HTMLVideoElement>(null);
  const overlay = useMemo(() => desktop()?.videoOverlay, []);
  const [overlayFailed, setOverlayFailed] = useState(false);
  const useOverlay = Boolean(overlay) && !overlayFailed;
  const appDrawsSubtitles = overlay?.drawsSubtitles !== false;
  const appSwitchesTracks = overlay?.switchesTracks !== false;
  const overlayVideo = useRef<OverlayVideo | null>(null);
  const overlayProfile = useRef<unknown>(undefined);
  const hls = useRef<Hls | null>(null);
  const sessionRef = useRef<PlaybackSession | undefined>(undefined);
  const programRef = useRef<ChannelProgram | undefined>(undefined);
  const [session, setSession] = useState<PlaybackSession>();
  const [status, setStatus] = useState<'loading' | 'playing' | 'ended' | 'failed' | 'tap'>('loading');
  const statusRef = useRef(status);
  statusRef.current = status;
  /** Where in its programme the latest stream was asked to start (seconds). */
  const startedAt = useRef(0);
  const [subtitle, setSubtitle] = useState<StreamTrack>();
  const [audioIndex, setAudioIndex] = useState<number>();
  /** Subtitles chosen on this channel carry on to the next programme: a language, or off (null). */
  const wantSubs = useRef<string | null | undefined>(undefined);
  const volume = useVolume(video);
  const countRef = useRef(countWatched);
  countRef.current = countWatched;

  const position = () => (programRef.current ? Math.max(0, (serverNow() - programRef.current.start) / 1000) : 0);
  const report = useCallback((event: 'start' | 'progress' | 'stop', s = sessionRef.current) => {
    if (!s || !countRef.current) return;
    void api
      .progress({ event, itemId: s.itemId, mediaSourceId: s.mediaSourceId, playSessionId: s.playSessionId, positionSeconds: position(), isPaused: false, method: s.method, audioStreamIndex: s.audioStreamIndex, channel: true }, event === 'stop')
      .catch(() => {});
  }, []);

  /**
   * A programme is over. The server stops working on it (counting as watched, Jellyfin hears
   * where it got to). The app's own player only pauses, behind the break: stopping it would
   * turn a phone upright between programmes. `leaving`: off the channels, so it stops too.
   */
  const stopStream = useCallback(
    (leaving = false) => {
      const s = sessionRef.current;
      sessionRef.current = undefined;
      if (s) {
        if (countRef.current) report('stop', s);
        else void api.endPlayback(s.playSessionId, deviceId()).catch(() => {});
      }
      hls.current?.destroy();
      hls.current = null;
      if (overlayVideo.current) {
        if (leaving) {
          overlayVideo.current.destroy();
          overlayVideo.current = null;
          video.current = null;
        } else overlayVideo.current.pause();
      } else if (video.current) {
        const v = video.current;
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
    [report],
  );

  const choiceFor = (s: PlaybackSession) => {
    const want = wantSubs.current;
    if (want === null) return undefined;
    if (want) return s.subtitleTracks.find((tr) => tr.code === want && !tr.forced && (useOverlay ? appDrawsSubtitles || tr.vttUrl : tr.vttUrl));
    return pickSubtitle(s, undefined, useOverlay && appDrawsSubtitles);
  };

  /**
   * A programme that won't play gets one more go a moment later (a hiccup on the way), then the
   * break says it can't play here until the next one.
   */
  const [attempt, setAttempt] = useState(0);
  const retried = useRef<string>(undefined);
  const fail = useCallback(() => {
    const p = programRef.current;
    const which = p ? `${p.itemId}:${p.start}` : '';
    if (p && retried.current !== which) {
      retried.current = which;
      setTimeout(() => setAttempt((n) => n + 1), 2000);
      return;
    }
    setStatus('failed');
  }, []);

  const handlers = useRef<Record<string, () => void>>({});
  handlers.current = {
    // From static (a new channel or programme), the picture shows once the new one is really
    // moving: the apps' players can say "playing" with the last channel's picture still up.
    onPlaying: () => {
      if (statusRef.current !== 'loading') return setStatus('playing');
      const began = Date.now();
      const check = () => {
        if (statusRef.current !== 'loading') return;
        const t = video.current?.currentTime ?? 0;
        if ((t >= startedAt.current + 0.2 && t < startedAt.current + 60) || Date.now() - began > 2500) setStatus('playing');
        else setTimeout(check, 80);
      };
      check();
    },
    onLoaded: () => {},
    onEnded: () => setStatus('ended'),
    onError: () => {
      if (overlayVideo.current) {
        // The app's player couldn't: the page's own player takes over.
        overlayVideo.current.destroy();
        overlayVideo.current = null;
        video.current = null;
        setOverlayFailed(true);
      } else fail();
    },
    onVolumeChange: volume.onVolumeChange,
  };

  const attach = (s: PlaybackSession, start: number, sub: StreamTrack | undefined, p: ChannelProgram) => {
    startedAt.current = start;
    if (useOverlay && overlay) {
      // One for the whole time on the channels: each programme loads into it.
      let ov = overlayVideo.current;
      if (!ov) {
        ov = new OverlayVideo(overlay);
        overlayVideo.current = ov;
        const map: Record<string, string> = { playing: 'onPlaying', loadedmetadata: 'onLoaded', ended: 'onEnded', error: 'onError', volumechange: 'onVolumeChange' };
        for (const [event, name] of Object.entries(map)) ov.addEventListener(event, () => handlers.current[name]?.());
      }
      ov.loadingNext();
      video.current = ov as unknown as HTMLVideoElement;
      const positions = trackPositions(s);
      void overlay
        .load({
          url: absolute(s.url),
          isHls: s.isHls,
          title: programTitle(p),
          subtitle: episodeLine(p),
          startSeconds: start,
          durationSeconds: s.durationSeconds,
          audio: { position: positions.audio(s.audioStreamIndex) ?? 1 },
          subtitles: sub && appDrawsSubtitles ? { mode: 'on', position: positions.subtitle(sub) } : { mode: 'off' },
          externalSubtitles: appDrawsSubtitles ? positions.externals.map((tr) => ({ url: absolute(tr.vttUrl!), label: tr.label, language: tr.code })) : [],
          segments: [],
        })
        .catch(fail);
      ov.volume = getPrefs().volume;
      return;
    }
    const v = video.current;
    if (!v) return;
    v.volume = getPrefs().volume;
    if (s.isHls && Hls.isSupported()) {
      const h = new Hls({ startPosition: start, maxBufferLength: 40, backBufferLength: 30 });
      h.on(Hls.Events.ERROR, (_e, data) => data.fatal && fail());
      h.loadSource(s.url);
      h.attachMedia(v);
      hls.current = h;
    } else {
      v.src = s.url;
      if (start > 0) v.addEventListener('loadedmetadata', () => (v.currentTime = position()), { once: true });
    }
    // A page opened straight onto a channel may not play sound before a tap.
    v.play().catch((err: Error) => err.name === 'NotAllowedError' && setStatus('tap'));
  };

  // A new programme (or channel): play it from where the schedule is.
  useEffect(() => {
    if (!key || !program) return;
    let alive = true;
    programRef.current = program;
    setStatus('loading');
    setSession(undefined);
    void (async () => {
      try {
        // A new title that didn't download in time (rare: its slot normally goes to something else).
        if (isStandIn(program.itemId)) throw new Error('not here yet');
        if (useOverlay) overlayProfile.current ??= await overlay!.profile();
        const s = await api.playSession(program.itemId, {
          deviceProfile: useOverlay ? overlayProfile.current : buildDeviceProfile(getPrefs().maxBitrate),
          maxBitrate: getPrefs().maxBitrate || undefined,
          startSeconds: position(),
        });
        if (!alive) {
          if (countRef.current) report('stop', s);
          else void api.endPlayback(s.playSessionId, deviceId()).catch(() => {});
          return;
        }
        sessionRef.current = s;
        setSession(s);
        setAudioIndex(s.audioStreamIndex);
        const sub = choiceFor(s);
        setSubtitle(sub);
        attach(s, position(), sub, program);
        report('start', s);
      } catch {
        if (alive) fail();
      }
    })();
    return () => {
      alive = false;
      stopStream();
    };
  }, [key, useOverlay, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the channels (or the page): everything stops.
  useEffect(() => {
    const leave = () => stopStream(true);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [stopStream]);

  // Stays on the schedule: after a stall, back to where everyone is (direct play moves cheaply,
  // a re-encoded stream only when it's well off).
  useEffect(() => {
    if (status !== 'playing') return;
    const timer = setInterval(() => {
      const v = video.current;
      const s = sessionRef.current;
      if (!v || !s) return;
      const drift = Math.abs(v.currentTime - position());
      if (drift > (s.method === 'Transcode' ? 20 : 6)) v.currentTime = position();
      report('progress');
    }, 10_000);
    return () => clearInterval(timer);
  }, [status, report]);

  // Subtitles: the app's player switches inside the file; the page shows text ones.
  useEffect(() => {
    if (!session) return;
    if (useOverlay) {
      if (appDrawsSubtitles) overlay?.command('subtitle', trackPositions(session).subtitle(subtitle) ?? null);
      return;
    }
    const v = video.current;
    if (!v) return;
    for (const track of Array.from(v.textTracks)) track.mode = subtitle && track.label === subtitle.label ? 'showing' : 'disabled';
  }, [subtitle, session]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseSubtitle = (index?: number) => {
    const track = index === undefined ? undefined : session?.subtitleTracks.find((tr) => tr.index === index);
    setSubtitle(track);
    wantSubs.current = track ? (track.code ?? null) : null;
    if (track?.code) setPrefs({ subtitleLanguage: track.code });
  };
  const chooseAudio = (index: number) => {
    const s = sessionRef.current;
    if (!s || index === audioIndex) return;
    if (useOverlay && appSwitchesTracks) {
      const p = trackPositions(s).audio(index);
      if (p) overlay?.command('audio', p);
      setAudioIndex(index);
      return;
    }
    // Another language needs a new stream from the server, from where the schedule is.
    const p = programRef.current;
    if (!p) return;
    stopStream();
    void api
      .playSession(p.itemId, { deviceProfile: useOverlay ? overlayProfile.current : buildDeviceProfile(getPrefs().maxBitrate), startSeconds: position(), audioStreamIndex: index })
      .then((next) => {
        sessionRef.current = next;
        setSession(next);
        setAudioIndex(index);
        attach(next, position(), subtitle, p);
      })
      .catch(() => setStatus('failed'));
  };

  // mpv and the like draw underneath a see-through page.
  useEffect(() => {
    if (!useOverlay) return;
    document.documentElement.classList.add('is-overlay-video');
    return () => document.documentElement.classList.remove('is-overlay-video');
  }, [useOverlay]);

  // TVs: no screensaver while a channel's on.
  useEffect(() => {
    desktop()?.keepAwake?.(true);
    return () => desktop()?.keepAwake?.(false);
  }, []);

  // "3 watching": this screen counts while it's on the channel.
  const channelId = channel?.id;
  const qc = useQueryClient();
  useEffect(() => {
    if (!channelId) return;
    try {
      localStorage.setItem(LAST, number);
    } catch {
      /* private window */
    }
    const say = () => void api.channelWatching(channelId, screenId()).catch(() => {});
    say();
    const timer = setInterval(say, 30_000);
    // Gone (another channel, the guide, the app closed): not watching any more, straight away,
    // and the guide's count is fetched again.
    const leave = () =>
      void api
        .channelWatching(channelId, screenId(), true)
        .catch(() => {})
        .finally(() => void qc.invalidateQueries({ queryKey: ['channels'] }));
    window.addEventListener('pagehide', leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [channelId, number]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- changing channel ----------

  const [switching, setSwitching] = useState(false);
  const goTo = useCallback(
    (n: number) => {
      if (!channels.some((c) => c.number === n) || n === Number(number)) return;
      setSwitching(true);
      navigate(`/channels/${n}`, { replace: true });
    },
    [channels, number, navigate],
  );
  const step = useCallback(
    (by: 1 | -1) => {
      if (!channels.length) return;
      const i = channels.findIndex((c) => c.number === Number(number));
      const next = channels[(i + by + channels.length) % channels.length];
      goTo(next.number);
    },
    [channels, number, goTo],
  );
  const doneSwitching = useCallback(() => setSwitching(false), []);

  // ---------- controls ----------

  const container = useRef<HTMLDivElement>(null);
  const [showUi, setShowUi] = useState(true);
  const [menu, setMenu] = useState(false);
  /** Every channel, with what's on: pick one. */
  const [list, setList] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poke = useCallback((ms = 3500) => {
    setShowUi(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowUi(false), ms);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  // Each programme (and channel) introduces itself for a few seconds.
  useEffect(() => {
    if (key) poke(6000);
  }, [key, poke]);
  const uiVisible = showUi || menu || list || status === 'tap';
  useEffect(() => {
    if (useOverlay) overlay?.command('controls', uiVisible);
  }, [useOverlay, uiVisible, overlay]);

  const toggleFullscreen = useCallback(() => {
    if (desktop()?.toggleFullscreen) return desktop()!.toggleFullscreen!();
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

  const leave = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/channels', { replace: true });
  }, [navigate]);
  // A new title on the channel: keeping it stops it being deleted after it airs (it joins the library).
  const toast = useToast();
  const [kept, setKept] = useState<string>();
  const keep = () => {
    if (!program) return;
    const itemId = program.itemId;
    api
      .keepChannelTitle(itemId)
      .then(() => {
        setKept(itemId);
        toast('ok', t('Kept: {title} is in the library now', { title: programTitle(program) }));
        void qc.invalidateQueries({ queryKey: ['channels'] });
      })
      .catch((e) => toast('error', (e as Error).message));
  };

  // Keys: up/down change channel, numbers jump, and the usual player keys.
  const digits = useRef('');
  const digitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = (e.composedPath?.()[0] ?? e.target) as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return;
      poke();
      if (e.defaultPrevented) return;
      const onControl = uiVisible && target?.closest?.('.channel__controls button');
      // The channel list open: up and down move through it, Escape closes it.
      if (list) {
        const items = [...(container.current?.querySelectorAll<HTMLElement>('.channel__list button') ?? [])];
        if (e.key === 'Escape') {
          e.preventDefault();
          setList(false);
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const i = items.indexOf(target?.closest?.('button') as HTMLElement);
          const at = i < 0 ? items.findIndex((b) => b.classList.contains('is-on')) : i + (e.key === 'ArrowDown' ? 1 : -1);
          items[Math.max(0, Math.min(items.length - 1, at))]?.focus();
        }
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        digits.current = (digits.current + e.key).slice(-2);
        clearTimeout(digitTimer.current);
        const typed = Number(digits.current);
        // Two digits, or one that can't start a longer number: go now. Otherwise wait for a second digit.
        const done = digits.current.length === 2 || !channels.some((c) => String(c.number).startsWith(digits.current) && c.number !== typed);
        if (done) {
          digits.current = '';
          goTo(typed);
        } else digitTimer.current = setTimeout(() => {
          digits.current = '';
          goTo(typed);
        }, 1300);
        return;
      }
      switch (e.key) {
        case 'ArrowUp':
        case 'PageUp':
        case 'ChannelUp':
          e.preventDefault();
          step(1);
          break;
        case 'ArrowDown':
        case 'PageDown':
        case 'ChannelDown':
          e.preventDefault();
          step(-1);
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          // TVs: move between the buttons.
          const buttons = [...(container.current?.querySelectorAll<HTMLElement>('.channel__controls button') ?? [])];
          if (!buttons.length) break;
          e.preventDefault();
          const i = onControl ? buttons.indexOf(target.closest('button')!) : -1;
          buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowRight' ? 1 : i < 0 ? buttons.length : -1)))]?.focus();
          break;
        }
        case 'Enter':
          // A remote's OK: the list of channels, as on a TV.
          if (!onControl) {
            e.preventDefault();
            setMenu(false);
            setList(true);
          }
          break;
        case 'g':
          navigate('/channels');
          break;
        case 'm':
          volume.toggleMute();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'Escape':
          if (menu) setMenu(false);
          else if (fullscreen) toggleFullscreen();
          else leave();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Phones: a swipe up or down changes channel.
  const touchStart = useRef<{ y: number; x: number } | null>(null);
  // (Not when it starts on the controls or a list: that's a tap there, or scrolling it.)
  const onTouchStart = (e: ReactTouchEvent) =>
    (touchStart.current = (e.target as HTMLElement).closest?.('.channel__controls, .player__menu') ? null : { y: e.touches[0].clientY, x: e.touches[0].clientX });
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dy = e.changedTouches[0].clientY - start.y;
    const dx = e.changedTouches[0].clientX - start.x;
    if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.5) step(dy < 0 ? 1 : -1);
  };

  // ---------- on screen ----------

  if (q.isLoading) {
    return (
      <div className="player channel">
        <div className="player__center">
          <SwimmingFish size={56} className="swimming-fish--player" />
        </div>
      </div>
    );
  }
  if (!channel) {
    return (
      <div className="player channel channel--missing">
        <div className="player__center">
          <p>{q.isError ? (q.error as Error).message : t('No channel {n}', { n: number })}</p>
          <button className="btn btn--primary" onClick={() => navigate('/channels', { replace: true })}>
            {t('Channel guide')}
          </button>
        </div>
      </div>
    );
  }

  const next = on?.next;
  const inBreak = !program;
  const breakMs = (q.data?.breakSeconds ?? 15) * 1000;
  // A longer wait in the schedule (before the 9pm film): the sea, with what's coming, until the break itself.
  const gap = inBreak && Boolean(next) && next!.start - now > breakMs;
  const showSea = inBreak || status === 'ended' || status === 'failed';
  // A click on the picture: the controls back, any open menu closed.
  const onStage = () => {
    poke();
    setMenu(false);
    setList(false);
  };
  const left = program ? Math.max(0, Math.ceil((programEnd(program) - now) / 60_000)) : 0;
  const fraction = program ? Math.min(1, (now - program.start) / (program.seconds * 1000)) : 0;
  const breakStart = next ? next.start - breakMs : now;

  return (
    <div
      ref={container}
      className={`player channel${uiVisible ? ' show-ui' : ''}${useOverlay ? ' player--overlay' : ''}`}
      onMouseMove={() => poke()}
      onPointerDown={(e) => e.pointerType !== 'mouse' && poke()}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {useOverlay ? (
        <div className="player__surface" onClick={onStage} onDoubleClick={toggleFullscreen} />
      ) : (
        <video ref={video} className="player__video" playsInline preload="auto" onClick={onStage} onDoubleClick={toggleFullscreen}
          onPlaying={() => handlers.current.onPlaying()} onLoadedMetadata={() => handlers.current.onLoaded()} onEnded={() => handlers.current.onEnded()}
          onError={() => handlers.current.onError()} onVolumeChange={() => handlers.current.onVolumeChange()}>
          {subtitle?.vttUrl && !browserTV() && <track key={subtitle.vttUrl} kind="subtitles" src={subtitle.vttUrl} srcLang={subtitle.code} label={subtitle.label} default />}
        </video>
      )}
      {/* Drawn by the page: for the app's players that can't, and TV browsers (they don't draw a video's tracks). */}
      {((useOverlay && !appDrawsSubtitles) || browserTV()) && subtitle?.vttUrl && program && <PageSubtitles url={subtitle.vttUrl} time={position()} raised={uiVisible} />}

      {showSea && (
        <ChannelBreak
          channel={channel}
          next={next}
          breakStart={gap ? next!.start : inBreak ? breakStart : program!.start}
          now={now}
          scene={sceneFor(next)}
          filler={!inBreak || gap}
          gap={gap}
          failed={!inBreak && status === 'failed'}
        />
      )}
      {status === 'tap' && !showSea && (
        <div className="player__center">
          <button className="btn btn--primary btn--lg" onClick={() => void video.current?.play().then(() => setStatus('playing'))}>
            <Play size={22} fill="currentColor" /> {t('Tune in')}
          </button>
        </div>
      )}
      {/* Changing channel, and until the picture comes: static (not a still of what's coming). */}
      {(switching || (!showSea && status === 'loading')) && <ChannelStatic onDone={doneSwitching} />}

      {/* The last minutes of a programme: what's next, in the corner, like TV. */}
      {program && next && status === 'playing' && programEnd(program) - now <= 90_000 && (
        <div className="channel__upnext" aria-live="polite">
          {next.image && <img src={next.image} alt="" />}
          <span className="channel__upnext-text">
            <span>{t('Next at {time}', { time: clockTime(next.start) })}</span>
            <strong>
              {programTitle(next)}
              {next.isNew && <> <NewBadge /></>}
            </strong>
            {episodeLine(next) && <span className="muted small">{episodeLine(next)}</span>}
          </span>
        </div>
      )}

      {/* The channel's mark, like a broadcaster's, always in the corner. */}
      <div className="channel__bug" aria-label={t('Channel {n}: {name}', { n: channel.number, name: channel.name })}>
        <span className="channel__num">{channel.number}</span>
        <span className="channel__name">{channel.name}</span>
      </div>

      <div className="channel__top">
        <button className="icon-btn icon-btn--lg" onClick={leave} aria-label={t('Back')}>
          <ArrowLeft size={28} />
        </button>
      </div>

      <div className="channel__bottom">
        {program && (
          <div className="channel__info">
            <span className="channel__on">
              <span className="live-dot" aria-hidden="true" /> {channel.number} · {channel.name}
              {channel.watching > 1 && <span className="muted"> · {tn(channel.watching, '{n} viewer', '{n} viewers')}</span>}
            </span>
            <strong className="channel__title">
              {programTitle(program)}
              {program.isNew && kept !== program.itemId && <> <NewBadge /></>}
            </strong>
            <span className="channel__meta">
              {[episodeLine(program), program.year, program.rating, tn(left, '{n} min left', '{n} min left')].filter(Boolean).join(' · ')}
            </span>
            <div className="channel__progress" aria-hidden="true">
              <div style={{ width: `${fraction * 100}%` }} />
            </div>
            {next && <span className="channel__next">{t('Next at {time}: {title}', { time: clockTime(next.start), title: programTitle(next) })}</span>}
          </div>
        )}
        <div className="channel__controls">
          <button className="icon-btn" onClick={() => navigate('/channels')} aria-label={t('Channel guide')} title={t('Channel guide')}>
            <LayoutList size={24} />
          </button>
          <div className="volume">
            <button className="icon-btn" onClick={() => volume.setVol(volume.muted || volume.volume === 0 ? Math.max(volume.volume, 0.5) : 0)} aria-label={volume.muted ? t('Unmute') : t('Mute')}>
              {volume.muted || volume.volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
            </button>
            <input className="volume__slider" type="range" min={0} max={1} step={0.05} value={volume.muted ? 0 : volume.volume} onChange={(e) => volume.setVol(Number(e.target.value))} aria-label={t('Volume')} />
          </div>
          {session && (session.subtitleTracks.length > 0 || session.audioTracks.length > 1) && (
            <div className="player__menu-wrap">
              <button className={`icon-btn${menu ? ' is-active' : ''}`} onClick={() => (setList(false), setMenu((m) => !m))} aria-label={t('Audio and subtitles')} aria-expanded={menu}>
                <Captions size={24} />
              </button>
              {menu && (
                <TrackMenu
                  audio={session.audioTracks.length > 1 ? session.audioTracks : []}
                  audioIndex={audioIndex}
                  chooseAudio={(index) => (setMenu(false), chooseAudio(index))}
                  subtitles={session.subtitleTracks.filter((tr) => useOverlay && appDrawsSubtitles ? true : Boolean(tr.vttUrl))}
                  subtitleIndex={subtitle?.index}
                  chooseSubtitle={(index) => (setMenu(false), chooseSubtitle(index))}
                />
              )}
            </div>
          )}
          <button className="icon-btn" onClick={toggleFullscreen} aria-label={fullscreen ? t('Exit full screen') : t('Full screen')}>
            {fullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
          {program?.isNew && !isStandIn(program.itemId) && kept !== program.itemId && (
            <button className="btn btn--ghost btn--sm channel__keep" onClick={keep} title={t('Keep it: it isn’t deleted after it airs, and joins the library')}>
              <Check size={16} /> {t('Keep')}
            </button>
          )}
          <div className="channel__switch" role="group" aria-label={t('Change channel')}>
            <button className="icon-btn" onClick={() => step(1)} aria-label={t('Next channel')} title={t('Next channel')}>
              <ChevronUp size={22} />
            </button>
            <div className="player__menu-wrap">
              <button
                className={`channel__current${list ? ' is-active' : ''}`}
                onClick={() => {
                  setMenu(false);
                  setList((open) => !open);
                }}
                aria-expanded={list}
                aria-label={t('All channels')}
                title={t('All channels')}
              >
                <span className="channel__num">{channel.number}</span>
                <span className="channel__current-name">{channel.name}</span>
              </button>
              {list && (
                <div className="player__menu channel__list" ref={(el) => el?.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' })}>
                  {channels.map((c) => {
                    const on = onNow(c, now);
                    const shown = on.program ?? on.next;
                    return (
                      <button
                        key={c.id}
                        className={`player__opt channel__opt${c.number === channel.number ? ' is-on' : ''}`}
                        onClick={() => {
                          setList(false);
                          goTo(c.number);
                        }}
                      >
                        <span className="channel__num">{c.number}</span>
                        <span className="channel__opt-text">
                          <strong>{c.name}</strong>
                          <span className="muted small">
                            {shown ? programTitle(shown) : t('Nothing to play yet')}
                            {shown?.isNew && <> <NewBadge /></>}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  <button className="player__opt channel__opt-guide" onClick={() => navigate('/channels')}>
                    <LayoutList size={16} /> {t('Channel guide')}
                  </button>
                </div>
              )}
            </div>
            <button className="icon-btn" onClick={() => step(-1)} aria-label={t('Previous channel')} title={t('Previous channel')}>
              <ChevronDown size={22} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
