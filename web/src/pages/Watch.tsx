import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import { Cast, Play } from 'lucide-react';
import type { PlaybackSession, ProgressReport, StreamTrack, TogetherCommand } from '@netfish/shared';
import { api } from '../api';
import { useToast } from '../components/ui';
import { FishPair, SwimmingFish } from '../components/Logo';
import { getPrefs, usePrefs } from '../lib/prefs';
import { rememberSubtitle } from '../lib/playbackPrefs';
import { desktop, type CastDevice } from '../lib/desktop';
import { CastVideo, CHROMECAST_PROFILE } from '../player/cast';
import { startVolume } from '../lib/systemVolume';
import { buildDeviceProfile } from '../player/profile';
import { OverlayVideo, trackPositions } from '../player/overlay';
import { PlayerView, useVolume } from '../player/PlayerView';
import { forcedFor, menuSubtitles, pickSubtitle } from '../player/tracks';
import { explainReasons } from '../player/reasons';
import { useTogether } from '../lib/together';
import { TogetherChip, TogetherNotes, TogetherPanel } from '../components/Together';
import { PlayOnButton, SendToScreen } from '../components/PlayOn';
import { castTarget, screenKind } from '../lib/screens';
import { useDownloaded } from '../lib/offline';
import { t } from '../i18n';
import { browserTV } from '../lib/tv';

const REPORT_EVERY = 10;

const absolute = (url: string) => new URL(url, location.origin).toString();

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
/**
 * Play, while this device is connected to another screen (the top bar's cast button): the
 * film plays there and this page becomes its remote. Otherwise, the player.
 */
export default function Watch() {
  const { itemId = '' } = useParams();
  const [params] = useSearchParams();
  // Decided once, when the player opens: handing the film over from inside the player also
  // connects to that screen, and that mustn't send it a second time.
  const [target] = useState(castTarget);
  const [here, setHere] = useState(false);
  // Downloaded on this device: the app plays its copy (no server needed, nothing to stream).
  const downloaded = useDownloaded(itemId);
  const room = params.get('room');
  if (target && !here && !room && screenKind() !== 'tv') {
    const at = params.get('t');
    return <SendToScreen key={itemId} target={target} itemId={itemId} position={at !== null ? Number(at) : undefined} onFailed={() => setHere(true)} />;
  }
  if (!room && downloaded === undefined) return <div className="player" />;
  if (!room && downloaded) return <PlayDownload key={itemId} itemId={itemId} />;
  return <Player />;
}

/**
 * Plays this device's downloaded copy in the app's own player, from where you got to (the
 * server's resume point while online). Back from it, you're on the title's page again.
 */
function PlayDownload({ itemId }: { itemId: string }) {
  const [params] = useSearchParams();
  useEffect(() => {
    let alive = true;
    void (async () => {
      const fromUrl = params.get('t');
      let start = fromUrl !== null ? Number(fromUrl) : undefined;
      let back = '/';
      try {
        const info = await api.playInfo(itemId);
        back = info.detailHref ?? '/';
        const resume = info.resumeSeconds ?? 0;
        start ??= info.durationSeconds && resume < info.durationSeconds - 60 ? resume : 0;
      } catch {
        /* offline: the app remembers where you got to */
      }
      if (!alive) return;
      // The downloads player goes back to the page it was opened from: the title, not this player.
      window.history.replaceState(window.history.state, '', back);
      desktop()?.openOffline?.({ play: itemId, start });
    })();
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="player">
      <div className="player__center">
        <SwimmingFish size={56} className="swimming-fish--player" />
      </div>
    </div>
  );
}

function Player() {
  const { itemId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const prefs = usePrefs();

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

  // Chromecast (the Android app on a phone or tablet): while casting, the film plays there, and
  // these controls drive it (through CastVideo, as they drive mpv or ExoPlayer).
  const cast = useMemo(() => desktop()?.cast, []);
  const [castDevices, setCastDevices] = useState<CastDevice[]>([]);
  /** The Chromecast in use (its name), while casting. */
  const [castingTo, setCastingTo] = useState<string>();
  const castingRef = useRef(false);
  const castVideo = useRef<CastVideo | null>(null);
  /** The page's own <video>, kept while the cast one stands in for it. */
  const pageVideo = useRef<HTMLVideoElement | null>(null);

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
  const volume = useVolume(video);
  const [why, setWhy] = useState(false);
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
  // Through a ref: a film can become a room while it plays (Watch together from the player).
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const inRoom = () => Boolean(roomIdRef.current && togetherRef.current.room && !togetherRef.current.ended);
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
  /** Turning this film into a Watch together room: the stream keeps playing, nothing reloads. */
  const becomingRoom = useRef(false);
  const toast = useToast();

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
          // What's showing now (Jellyfin remembers it per show, when the person has it do so).
          subtitleStreamIndex: subtitleRef.current?.index ?? -1,
        },
        keepalive,
      )
      .catch(() => {});
  }, []);

  // ---------- loading a stream ----------

  // mpv's events reach the same handlers <video>'s do (they change every render, so look them up late).
  const handlers = useRef<Record<string, () => void>>({});
  const wireEvents = (ov: EventTarget) => {
    const map: Record<string, string> = {
      playing: 'onPlaying', pause: 'onPause', waiting: 'onWaiting', canplay: 'onCanPlay', timeupdate: 'onTimeUpdate',
      durationchange: 'onDurationChange', ended: 'onEnded', error: 'onVideoError', volumechange: 'onVolumeChange', loadedmetadata: 'onLoaded',
    };
    for (const [event, key] of Object.entries(map)) ov.addEventListener(event, () => handlers.current[key]?.());
  };

  /** Sends the film to the Chromecast, with links it can open by itself (they carry a token for this film). */
  const attachCast = (s: PlaybackSession, start: number) => {
    let cv = castVideo.current;
    if (!cv) {
      cv = new CastVideo(cast!);
      castVideo.current = cv;
      wireEvents(cv);
    }
    if (video.current instanceof HTMLVideoElement) pageVideo.current = video.current;
    video.current = cv as unknown as HTMLVideoElement;
    setPictureShown(false);
    // The token goes in the path (/jellyfin/cast/<token>/…), so the links inside Jellyfin's
    // playlists, relative to it, carry it too.
    const linked = (url: string) => {
      const link = new URL(url, location.origin);
      if (s.castToken) link.pathname = link.pathname.replace(/^\/jellyfin\//, `/jellyfin/cast/${s.castToken}/`);
      return link.toString();
    };
    const url = linked(s.url);
    cv.loadingNext(url);
    const d = infoRef.current;
    const episode = d?.type === 'Episode';
    const sub = pickSubtitle(s, subtitleRef.current, false);
    cast!.load({
      url,
      contentType: s.isHls ? 'application/x-mpegURL' : 'video/mp4',
      startSeconds: start,
      durationSeconds: s.durationSeconds,
      title: (episode ? d?.seriesTitle : d?.title) ?? '',
      subtitle: episode ? `S${d?.seasonNumber}:E${d?.episodeNumber} · ${d?.title}` : undefined,
      image: d?.backdrop ? absolute(d.backdrop) : undefined,
      episode,
      subtitles: s.subtitleTracks.filter((tr) => tr.vttUrl).map((tr) => ({ id: tr.index, url: linked(tr.vttUrl!), label: tr.label, language: tr.code })),
      subtitleId: sub?.vttUrl ? sub.index : null,
    });
  };

  const attach = useCallback((s: PlaybackSession, start: number) => {
    // Casting: a stream asked for before it connected has no links the Chromecast can open.
    if (castingRef.current && cast) return s.castToken ? attachCast(s, start) : void latestLoad.current?.({ start, audio: s.audioStreamIndex });
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
      ov.volume = startVolume();
      return;
    }
    const v = video.current!;
    hls.current?.destroy();
    hls.current = null;
    v.removeAttribute('src');
    // TVs (Samsung, LG) play streams with their own player, as Jellyfin's apps do: it decodes the
    // Dolby sound and HEVC their profile promises, which the browser's MSE (and so hls.js) may not.
    if (s.isHls && Hls.isSupported() && !browserTV()) {
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
        const casting = castingRef.current;
        if (!casting && overlayActive.current && overlay) overlayProfile.current ??= await overlay.profile();
        const s = await api.playSession(itemId, {
          cast: casting || undefined,
          // Only mpv and ExoPlayer switch audio tracks inside a file; anything else plays its default one.
          defaultAudioOnly: casting || !(overlayActive.current && appSwitchesTracks),
          deviceProfile: casting ? CHROMECAST_PROFILE : overlayActive.current ? overlayProfile.current : buildDeviceProfile(getPrefs().maxBitrate),
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
  const latestLoad = useRef(load);
  latestLoad.current = load;

  // ---------- Chromecast ----------

  /** Connected to a Chromecast: the film carries on there, from here. */
  const startCasting = (device?: string) => {
    setCastingTo(device ?? '');
    if (castingRef.current) return;
    const at = video.current?.currentTime ?? 0;
    if (overlayVideo.current) {
      // Stops the app's player.
      overlayVideo.current.destroy();
      overlayVideo.current = null;
    } else if (video.current) {
      pageVideo.current = video.current;
      hls.current?.destroy();
      hls.current = null;
      video.current.pause();
      video.current.removeAttribute('src');
      video.current.load();
    }
    video.current = null;
    castingRef.current = true;
    if (sessionRef.current) void load({ start: at, audio: audioIndex });
  };
  /** Not casting any more: back on this device, from where the Chromecast got to. */
  const stopCasting = () => {
    setCastingTo(undefined);
    if (!castingRef.current) return;
    const at = castVideo.current?.currentTime ?? 0;
    castVideo.current?.destroy();
    castVideo.current = null;
    castingRef.current = false;
    video.current = overlayActive.current ? null : pageVideo.current;
    if (sessionRef.current) void load({ start: at, audio: audioIndex });
  };
  const casting = useRef({ startCasting, stopCasting });
  casting.current = { startCasting, stopCasting };
  useEffect(() => {
    if (!cast) return;
    cast.watch(true);
    let first = true;
    const stop = cast.onState((state) => {
      const already = first;
      first = false;
      if (state.devices) setCastDevices(state.devices);
      // Watch together and Play on TV: the room runs this player, not a Chromecast.
      if (roomIdRef.current) return;
      if (state.connected === true) {
        if (already) {
          // Already connected when the player opened: the film starts there.
          castingRef.current = true;
          setCastingTo(state.device ?? '');
        } else casting.current.startCasting(state.device);
      } else if (state.connected === false && castingRef.current) {
        casting.current.stopCasting();
      }
      // Not about a film (connecting, a device gone): said once.
      if (state.error && state.time === undefined && !already) toast('error', `${t(state.error)}${state.errorCode ? ` (${state.errorCode})` : ''}`);
    });
    return () => {
      stop();
      cast.watch(false);
    };
  }, [cast]); // eslint-disable-line react-hooks/exhaustive-deps

  // First load (and whenever the item changes, e.g. next episode). In a room, from where the room is.
  const roomKnown = !roomId || Boolean(together.room) || together.ended;
  useEffect(() => {
    if (!info.data || !roomKnown) return;
    if (becomingRoom.current) {
      becomingRoom.current = false;
      return;
    }
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
    setSubtitle((current) => pickSubtitle(session, current, !castingRef.current && overlayActive.current && appDrawsSubtitles));
  }, [session]);

  // Make the chosen text track visible (mpv: switch to it; it draws every kind, pictures too).
  useEffect(() => {
    if (castingRef.current) {
      // On the Chromecast: its WebVTT tracks, by Jellyfin's numbers.
      if (session) cast?.command('subtitle', subtitle?.vttUrl ? subtitle.index : null);
      return;
    }
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
      // Casting: the film carries on on the Chromecast (Jellyfin has been told where it got to).
      castVideo.current?.destroy();
      castVideo.current = null;
    };
  }, [itemId, report]);

  // ---------- video events ----------

  const onVideoError = () => {
    if (castingRef.current) {
      setError(video.current?.error?.message ?? t("The Chromecast couldn't play this"));
      return;
    }
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
  const onVolumeChange = volume.onVolumeChange;
  const onLoaded = () => {
    overlayLoaded.current = true;
    // On a Chromecast the picture is there, not here: the artwork stays.
    if (!castingRef.current) setPictureShown(true);
  };

  const onPlaying = () => {
    setPlaying(true);
    setWaiting(false);
    setNeedsTap(false);
    readyToSync();
    if (!started.current) {
      started.current = true;
      report('start');
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
    // Casting, the phone can sleep.
    desktop()?.keepAwake?.(playing && castingTo === undefined);
    return () => desktop()?.keepAwake?.(false);
  }, [playing, castingTo]);

  // The app's player keeps its subtitles above the controls while they show (like the web player does).
  const onControls = useCallback((showing: boolean) => useOverlay && !castingRef.current && overlay?.command('controls', showing), [useOverlay, overlay]);

  const chooseAudio = (track: StreamTrack) => {
    if (track.index === audioIndex) return;
    const s = sessionRef.current;
    if (!castingRef.current && overlayActive.current && appSwitchesTracks && s) {
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
    const wasBurned = subtitle?.burnIn;
    const s = sessionRef.current;
    const appDraws = !castingRef.current && overlayActive.current && appDrawsSubtitles;
    // Off still shows the forced ones (signs, lines in another language) for what's being heard.
    const shown = track ?? (s ? forcedFor(s, audioIndex, appDraws) : undefined);
    setSubtitle(shown);
    rememberSubtitle(track);
    if (appDraws) return; // the app's player draws every kind itself
    if (shown?.burnIn || wasBurned) {
      void load({ start: video.current?.currentTime ?? 0, audio: audioIndex, subtitle: shown?.burnIn ? shown.index : undefined, allowDirectPlay: !shown?.burnIn });
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
        // As in the player's menu: forced ones go with "Off".
        subtitles: list(menuSubtitles(session.subtitleTracks)),
        audioIndex,
        subtitleIndex: subtitle && menuSubtitles(session.subtitleTracks).some((tr) => tr.index === subtitle.index) ? subtitle.index : null,
      })
      .catch(() => {});
  }, [remote, roomId, session, joined, audioIndex, subtitle]); // eslint-disable-line react-hooks/exhaustive-deps

  // While casting, the page's own <video> (stopped) has nothing to say.
  const fromPage = (handler: () => void) => () => {
    if (!castingRef.current) handler();
  };

  const d = info.data;
  const heading = d?.type === 'Episode' ? d.seriesTitle : d?.title;
  const subheading = d?.type === 'Episode' ? `S${d.seasonNumber}:E${d.episodeNumber} · ${d.title}` : undefined;

  return (
    <PlayerView
      video={video}
      overlay={useOverlay}
      videoProps={{
        // In a paused room nothing starts it, so it's ready as soon as it knows the film.
        onLoadedMetadata: fromPage(() => startPaused.current && (setWaiting(false), readyToSync())),
        onPlaying: fromPage(onPlaying),
        onPause: fromPage(onPause),
        onWaiting: fromPage(onWaiting),
        onCanPlay: fromPage(onCanPlay),
        onTimeUpdate: fromPage(onTimeUpdate),
        onDurationChange: fromPage(onDurationChange),
        onEnded: fromPage(onEnded),
        onError: fromPage(onVideoError),
        onVolumeChange: fromPage(onVolumeChange),
        // TV browsers (Samsung's, LG's) don't draw a video's subtitle tracks: the page does (below).
        children: subtitle?.vttUrl && !browserTV() && <track key={subtitle.vttUrl} kind="subtitles" src={subtitle.vttUrl} srcLang={subtitle.code} label={subtitle.label} default />,
      }}
      backdrop={d?.backdrop}
      pictureShown={pictureShown}
      appFullscreen={useOverlay}
      heading={heading}
      subheading={subheading}
      playing={playing}
      waiting={waiting || info.isLoading}
      time={time}
      duration={duration}
      buffered={buffered}
      trickplay={session?.trickplay}
      toggle={toggle}
      seekTo={seekTo}
      volume={volume}
      onBack={() => navigate(-1)}
      error={
        error || info.isError
          ? { message: error ?? (info.error as Error).message, retry: () => void load({ start: time, audio: audioIndex, allowDirectPlay: false }) }
          : undefined
      }
      center={
        castingTo !== undefined && !error ? (
          <div className="player__casting">
            <Cast size={40} />
            <span>{castingTo ? t('Playing on {device}', { device: castingTo }) : t('Playing on the Chromecast')}</span>
          </div>
        ) : needsTap && !error ? (
          <button className="btn btn--primary btn--lg" onClick={() => (setNeedsTap(false), follow(true))}>
            <Play size={22} fill="currentColor" /> {t('Join in')}
          </button>
        ) : undefined
      }
      holdUi={roomPanel}
      onEscape={() => roomPanel && (setRoomPanel(false), true)}
      segments={d?.segments}
      next={next ? { title: d?.nextTitle, go: goNext } : undefined}
      audio={session?.audioTracks ?? []}
      audioIndex={audioIndex}
      chooseAudio={(index) => {
        const track = session?.audioTracks.find((tr) => tr.index === index);
        if (track) chooseAudio(track);
      }}
      subtitles={(session?.subtitleTracks ?? []).map((track) => ({ ...track, note: track.burnIn ? t('picture subtitles, heavy for the server') : undefined }))}
      subtitleIndex={subtitle?.index}
      chooseSubtitle={(index) => chooseSubtitle(index === undefined ? undefined : session?.subtitleTracks.find((tr) => tr.index === index))}
      tracksKnown={Boolean(session)}
      audioMore={
        d?.detailHref && (
          <Link className="player__link" to={`${d.detailHref}?sheet=versions`}>
            {t('Get another language…')}
          </Link>
        )
      }
      subtitlesMore={
        d?.detailHref && (
          <Link className="player__link" to={`${d.detailHref}?sheet=subtitles`}>
            {t('Find more subtitles…')}
          </Link>
        )
      }
      pageSubtitles={castingTo === undefined && ((useOverlay && !appDrawsSubtitles) || browserTV()) ? subtitle?.vttUrl : undefined}
      onControls={onControls}
      actions={
        <>
          {!roomId && d && castingTo === undefined && (
            // Watch together, from here: this film becomes a room, from where it is now.
            <button
              className="icon-btn icon-btn--lg"
              aria-label={t('Watch together')}
              title={t('Watch together')}
              onClick={() => {
                const at = video.current?.currentTime ?? 0;
                api.createRoom(itemId, at).then(
                  (room) => {
                    becomingRoom.current = true;
                    setRoomPanel(true);
                    navigate(`/watch/${itemId}?room=${room.id}`, { replace: true });
                  },
                  (err: Error) => toast('error', err.message),
                );
              }}
            >
              <FishPair size={30} still />
            </button>
          )}
          {!roomId && d && (
            // Hand the film over to another screen, from where it is now.
            <PlayOnButton
              itemId={itemId}
              title={heading ?? d.title}
              position={() => video.current?.currentTime ?? 0}
              onSent={() => video.current?.pause()}
              className="icon-btn icon-btn--lg"
              iconOnly
              chromecast={cast && { devices: castDevices, casting: castingTo, connect: cast.connect, disconnect: cast.disconnect }}
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
        </>
      }
    >
      {roomId && !remote && <TogetherNotes together={together} />}
      {roomId && !remote && together.room?.playback.action === 'start' && !playing && !together.ended && (
        <div className="together-hint">{t("Press play when everyone's here.")}</div>
      )}
    </PlayerView>
  );
}
