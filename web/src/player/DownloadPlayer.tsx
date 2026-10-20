import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Trickplay } from '@netfish/shared';
import { desktop, type OfflineItem } from '../lib/desktop';
import { getPrefs } from '../lib/prefs';
import { rememberSubtitle } from '../lib/playbackPrefs';
import { startVolume } from '../lib/systemVolume';
import { OverlayVideo } from './overlay';
import { PlayerView, useVolume, type MenuTrack } from './PlayerView';
import { locale, t } from '../i18n';

/**
 * Plays a download from this device: Netfish's own player (PlayerView), with the film read
 * from the file the app keeps. The apps' downloads page runs it (built in as player.js), with
 * or without the server, so a download looks and works like anything else on Netfish, minus
 * what needs the server (Watch together, Play on, other languages).
 *
 * The Windows app plays downloads with mpv underneath the page, every track the file has;
 * the others in the page, with their audio tracks where the engine offers them (Apple's)
 * and the downloaded subtitles drawn by the page.
 */

/** A download as the apps list it, with where its files are. */
export interface DownloadedFilm extends OfflineItem {
  video: string;
  subtitles: { url: string; label: string; code?: string }[];
  durationSeconds?: number;
  /** Scrubbing previews kept with it (apps from 0.7.14 on, titles Jellyfin has them for). */
  trickplay?: Trickplay;
}

export interface DownloadPlayerProps {
  item: DownloadedFilm;
  /** Where to start (seconds). */
  start?: number;
  /** Where you got to: every few seconds while playing (`now` false), and when it stops (`now` true). */
  onPosition: (seconds: number, finished: boolean, now: boolean) => void;
  onClose: () => void;
  next?: { title?: string; go: () => void };
  /** Set to what Back does (the page's own Back, Android's Back key). */
  backRef?: { current?: () => void };
}

/** mpv's track list (Windows). */
interface EngineTrack {
  id: number;
  type: 'audio' | 'video' | 'sub';
  lang?: string;
  title?: string;
  selected?: boolean;
}

let names: Intl.DisplayNames | undefined;
function language(code?: string) {
  try {
    names ??= new Intl.DisplayNames([locale], { type: 'language' });
    const name = code && code !== 'und' ? (names.of(code) ?? '') : '';
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1); // Italian names come lowercase: "inglese"
  } catch {
    return code ?? '';
  }
}
const trackName = (id: number, lang?: string, title?: string) =>
  [language(lang), title && title !== language(lang) ? title : ''].filter(Boolean).join(' · ') || t('Track {id}', { id });

/** Audio tracks inside the file, where the page's engine lists them (Apple's does, Chromium doesn't). */
type AudioTrackList = EventTarget & { length: number; [index: number]: { id: string; label: string; language: string; enabled: boolean } };
const audioTracksOf = (v: HTMLVideoElement | null) => (v as unknown as { audioTracks?: AudioTrackList } | null)?.audioTracks;

export function DownloadPlayer({ item, start = 0, onPosition, onClose, next, backRef }: DownloadPlayerProps) {
  const app = desktop();
  // Windows: mpv, underneath the page.
  const overlay = useMemo(() => (app?.offlineFormat === 'original' ? app.videoOverlay : undefined), [app]);
  const video = useRef<HTMLVideoElement>(null);
  const volume = useVolume(video);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(start);
  const [length, setLength] = useState(item.durationSeconds ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [pictureShown, setPictureShown] = useState(false);
  const [error, setError] = useState<string>();
  const [audio, setAudio] = useState<MenuTrack[]>([]);
  const [audioIndex, setAudioIndex] = useState<number>();
  const [engineSubs, setEngineSubs] = useState<MenuTrack[]>([]);
  const [subtitleIndex, setSubtitleIndex] = useState<number | undefined>(() => {
    // The page draws the downloaded subtitles: in your language, if you like subtitles on.
    if (overlay || !getPrefs().subtitlesByDefault) return undefined;
    const n = item.subtitles.findIndex((s) => s.code === getPrefs().subtitleLanguage);
    return n >= 0 ? n : undefined;
  });
  const duration = length || item.durationSeconds || 0;
  const done = useRef(false);

  // ---------- where you got to ----------

  const position = () => video.current?.currentTime ?? 0;
  const nearlyDone = (seconds: number) => Boolean(duration && seconds >= duration * 0.95);
  const positionRef = useRef(onPosition);
  positionRef.current = onPosition;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => positionRef.current(position(), false, false), 5000);
    return () => clearInterval(timer);
  }, [playing]);
  const close = useCallback(() => {
    if (!done.current) positionRef.current(position(), nearlyDone(position()), true);
    done.current = true;
    onClose();
  }, [onClose, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  if (backRef) backRef.current = close;
  // On to the next episode: this one counts as watched.
  const goNext = next && {
    title: next.title,
    go: () => {
      if (!done.current) positionRef.current(position(), true, true);
      done.current = true;
      next.go();
    },
  };

  // ---------- the film ----------

  const onPlaying = () => {
    setPlaying(true);
    setWaiting(false);
  };
  const onPause = () => {
    setPlaying(false);
    if (!done.current) positionRef.current(position(), false, true);
  };
  const onTimeUpdate = () => {
    const v = video.current;
    if (!v) return;
    setTime(v.currentTime);
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
  };
  const onDurationChange = () => {
    const d = video.current?.duration;
    if (d && Number.isFinite(d)) setLength(d);
  };
  const onEnded = () => {
    positionRef.current(duration || position(), true, true);
    done.current = true;
    if (next && getPrefs().autoplayNext) next.go();
    else onClose();
  };
  const onError = () =>
    setError(t("This download couldn't play: {error}", { error: (video.current?.error as { message?: string } | null)?.message || t("this device can't open the file") }));
  // Audio tracks Apple's engine finds in the file (it lists them a moment after the film starts).
  const readAudio = () => {
    const list = audioTracksOf(video.current);
    if (overlay || !list || list.length < 2) return;
    const tracks: MenuTrack[] = [];
    for (let i = 0; i < list.length; i++) tracks.push({ index: i, label: list[i].label || trackName(i + 1, list[i].language) });
    setAudio(tracks);
    for (let i = 0; i < list.length; i++) if (list[i].enabled) setAudioIndex(i);
  };
  const onLoaded = () => {
    setPictureShown(true);
    readAudio();
  };
  const handlers = useRef<Record<string, () => void>>({});
  handlers.current = { onPlaying, onPause, onWaiting: () => setWaiting(true), onCanPlay: () => setWaiting(false), onTimeUpdate, onDurationChange, onEnded, onError, onVolumeChange: volume.onVolumeChange, onLoaded, readAudio };

  useEffect(() => {
    if (overlay) {
      // Windows: mpv plays the file underneath; its events reach the same handlers.
      const ov = new OverlayVideo(overlay);
      video.current = ov as unknown as HTMLVideoElement;
      const map: Record<string, string> = {
        playing: 'onPlaying', pause: 'onPause', waiting: 'onWaiting', canplay: 'onCanPlay', timeupdate: 'onTimeUpdate',
        durationchange: 'onDurationChange', ended: 'onEnded', error: 'onError', volumechange: 'onVolumeChange', loadedmetadata: 'onLoaded',
      };
      for (const [event, key] of Object.entries(map)) ov.addEventListener(event, () => handlers.current[key]?.());
      // Its own list of what's in the file (and the subtitle files loaded alongside).
      const stop = overlay.onState((state) => {
        const tracks = Array.isArray(state.tracks) ? (state.tracks as EngineTrack[]) : undefined;
        if (tracks) {
          setAudio(tracks.filter((tr) => tr.type === 'audio').map((tr) => ({ index: tr.id, label: trackName(tr.id, tr.lang, tr.title) })));
          setEngineSubs(tracks.filter((tr) => tr.type === 'sub').map((tr) => ({ index: tr.id, label: trackName(tr.id, tr.lang, tr.title) })));
          const selected = tracks.find((tr) => tr.type === 'audio' && tr.selected);
          if (selected) setAudioIndex(selected.id);
        }
        if (typeof state.aid === 'number') setAudioIndex(state.aid);
        if ('sid' in state) setSubtitleIndex(typeof state.sid === 'number' ? state.sid : undefined);
      });
      ov.volume = startVolume();
      overlay
        .load({
          url: item.video,
          isHls: false,
          title: item.title,
          subtitle: item.subtitle,
          startSeconds: start,
          durationSeconds: item.durationSeconds,
          subtitles: { mode: 'off' },
          externalSubtitles: item.subtitles.map((s) => ({ url: s.url, label: s.label, language: s.code })),
          segments: [],
        })
        .catch((e: Error) => setError(t("This download couldn't play: {error}", { error: e.message })));
      document.documentElement.classList.add('is-overlay-video');
      return () => {
        stop();
        ov.destroy();
        video.current = null;
        document.documentElement.classList.remove('is-overlay-video');
      };
    }
    const v = video.current;
    if (!v) return;
    v.volume = startVolume();
    v.src = item.video;
    if (start > 0) v.addEventListener('loadedmetadata', () => (v.currentTime = start), { once: true });
    v.play().catch(() => setPlaying(false));
    const tracks = audioTracksOf(v);
    const onTracks = () => handlers.current.readAudio();
    tracks?.addEventListener?.('addtrack', onTracks);
    tracks?.addEventListener?.('removetrack', onTracks);
    return () => {
      tracks?.removeEventListener?.('addtrack', onTracks);
      tracks?.removeEventListener?.('removetrack', onTracks);
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, [item.itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // TVs: no screensaver in the middle of a film.
  useEffect(() => {
    app?.keepAwake?.(playing);
    return () => app?.keepAwake?.(false);
  }, [playing, app]);

  // ---------- controls ----------

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const seekTo = (seconds: number) => {
    const v = video.current;
    if (v) v.currentTime = Math.max(0, Math.min(seconds, (v.duration || duration || Infinity) - 0.5));
  };
  const chooseAudio = (index: number) => {
    setAudioIndex(index);
    if (overlay) return overlay.command('audio', index);
    const list = audioTracksOf(video.current);
    for (let i = 0; list && i < list.length; i++) list[i].enabled = i === index;
  };
  const chooseSubtitle = (index?: number) => {
    setSubtitleIndex(index);
    if (overlay) {
      // The app's player lists the file's own tracks (no language here): on or off is what's kept.
      rememberSubtitle(index === undefined ? undefined : {});
      return overlay.command('subtitle', index ?? null);
    }
    rememberSubtitle(index === undefined ? undefined : item.subtitles[index]);
  };
  const subtitles = overlay ? engineSubs : item.subtitles.map((s, index) => ({ index, label: s.label }));
  // mpv lifts its subtitles above the controls while they show.
  const onControls = useCallback((showing: boolean) => overlay?.command('controls', showing), [overlay]);
  const episode = item.kind === 'Episode';

  return (
    <PlayerView
      video={video}
      overlay={Boolean(overlay)}
      videoProps={{
        onPlaying: () => handlers.current.onPlaying(),
        onPause: () => handlers.current.onPause(),
        onWaiting: () => handlers.current.onWaiting(),
        onCanPlay: () => handlers.current.onCanPlay(),
        onTimeUpdate: () => handlers.current.onTimeUpdate(),
        onDurationChange: () => handlers.current.onDurationChange(),
        onEnded: () => handlers.current.onEnded(),
        onError: () => handlers.current.onError(),
        onVolumeChange: () => handlers.current.onVolumeChange(),
        onLoadedMetadata: () => handlers.current.onLoaded(),
      }}
      pictureShown={pictureShown}
      appFullscreen={Boolean(app?.toggleFullscreen)}
      heading={episode ? (item.seriesTitle ?? item.title) : item.title}
      subheading={episode && item.seasonNumber !== undefined ? `S${item.seasonNumber}:E${item.episodeNumber} · ${item.title}` : undefined}
      playing={playing}
      waiting={waiting}
      time={time}
      duration={duration}
      buffered={buffered}
      trickplay={item.trickplay}
      toggle={toggle}
      seekTo={seekTo}
      volume={volume}
      onBack={close}
      error={error ? { message: error } : undefined}
      next={goNext}
      audio={audio}
      audioIndex={audioIndex}
      chooseAudio={chooseAudio}
      subtitles={subtitles}
      subtitleIndex={subtitleIndex}
      chooseSubtitle={chooseSubtitle}
      pageSubtitles={!overlay && subtitleIndex !== undefined ? item.subtitles[subtitleIndex]?.url : undefined}
      onControls={overlay ? onControls : undefined}
    />
  );
}
