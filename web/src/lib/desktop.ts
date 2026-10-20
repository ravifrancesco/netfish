import { useEffect, useState } from 'react';
import type { NativePlayRequest, OfflineDescriptor } from '@netfish/shared';
import { t } from '../i18n';

/**
 * What the Netfish apps add to the web interface: the Mac and Windows apps, the
 * iPhone/iPad app, and the Android app. Absent in a normal browser.
 */
export interface OfflineItem {
  itemId: string;
  kind: 'Movie' | 'Episode';
  title: string;
  seriesId?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  subtitle?: string;
  poster?: string;
  state: 'downloading' | 'paused' | 'done' | 'failed' | 'interrupted';
  size: number;
  received: number;
  converted: boolean;
}

/**
 * The film drawn by the app underneath the page (mpv on Mac and Windows, ExoPlayer on
 * Android, Apple's player on iPhone/iPad); the page shows the controls.
 */
export interface VideoOverlay {
  name: string;
  /** False (Apple's player): the page shows text subtitles itself; picture subtitles are burned in by the server. */
  drawsSubtitles?: boolean;
  /** False (Apple's player): another audio track needs a new stream from the server. */
  switchesTracks?: boolean;
  /** Jellyfin device profile: what the app's player plays as-is. */
  profile: () => Promise<unknown>;
  load: (request: NativePlayRequest) => Promise<unknown>;
  /** `controls`: whether the page's controls are showing (the app lifts its subtitles above them). */
  command: (name: 'play' | 'pause' | 'seek' | 'volume' | 'mute' | 'audio' | 'subtitle' | 'controls' | 'stop', value?: number | boolean | null) => void;
  onState: (callback: (state: Record<string, unknown>) => void) => () => void;
}

/** The Mac and Windows apps can update themselves from GitHub Releases. */
export interface UpdateStatus {
  current: string;
  latest?: string;
  available: boolean;
  /** The release has this app's file: it can be installed from inside the app. */
  canInstall: boolean;
  /** The release's page (what's new, manual download). */
  page?: string;
  /** "Update Netfish by itself" is on (apps from 0.4 on). */
  auto?: boolean;
  /** A newer version is downloaded and waiting: it goes in when Netfish quits. */
  ready?: string;
  /** Why updating by itself last failed. */
  autoProblem?: string;
}

/** The computer's output volume, as the Mac and Windows apps report it. */
export interface SystemVolumeState {
  /** False: this output's volume can't be set (some HDMI and digital outputs). */
  available: boolean;
  /** 0 to 1. */
  volume?: number;
  muted?: boolean;
}

/** A Chromecast on the network. */
export interface CastDevice {
  id: string;
  name: string;
  description?: string;
}

/** What the Android app says about Chromecasts: any of these, as they change. */
export interface CastState {
  devices?: CastDevice[];
  connected?: boolean;
  /** The one in use. */
  device?: string;
  time?: number;
  duration?: number;
  paused?: boolean;
  playing?: boolean;
  buffering?: boolean;
  ended?: boolean;
  error?: string;
  /** The Chromecast's own reason for an error, a number (for bug reports). */
  errorCode?: number;
  volume?: number;
  muted?: boolean;
  /** The film the rest is about (as it was sent). */
  url?: string;
}

/** A film on a Chromecast: links it can open by itself (they carry their own token). */
export interface CastLoad {
  url: string;
  contentType: string;
  startSeconds: number;
  durationSeconds?: number;
  title: string;
  subtitle?: string;
  image?: string;
  episode?: boolean;
  subtitles: Array<{ id: number; url: string; label: string; language?: string }>;
  subtitleId: number | null;
}

/** Chromecast, through the Android app. */
export interface CastBridge {
  /** Look for devices (only while the player is open). */
  watch: (on: boolean) => void;
  connect: (id: string) => void;
  disconnect: () => void;
  load: (request: CastLoad) => void;
  command: (name: 'play' | 'pause' | 'seek' | 'volume' | 'mute' | 'subtitle' | 'stop', value?: number | boolean | null) => void;
  onState: (cb: (state: CastState) => void) => () => void;
}

export interface DesktopBridge {
  /** darwin / win32 / linux (desktop), ios, or firetv. */
  platform: string;
  version: string;
  changeServer: () => void;
  /**
   * The computer's own volume (the volume keys', the menu bar's or the taskbar's): the player's
   * slider follows it and sets it. Mac and Windows apps from 0.7.11 on.
   */
  systemVolume?: {
    get: () => Promise<SystemVolumeState>;
    set: (volume: number) => void;
    setMuted: (muted: boolean) => void;
    onChange: (cb: (state: SystemVolumeState) => void) => () => void;
  };
  /** TV: keep the screen from dimming while a film plays. */
  keepAwake?: (on: boolean) => void;
  videoOverlay?: VideoOverlay;
  /** Chromecast (the Android app on phones and tablets with Google Play services). */
  cast?: CastBridge;
  /** The whole app window (the Mac app), rather than one element of the page. */
  toggleFullscreen?: () => void;
  /**
   * Which kind of file downloads should be: MP4 for Apple's engine or Android, what Chromium
   * plays (desktop), or the file exactly as it is (the Windows app plays downloads with mpv).
   */
  offlineFormat?: 'apple' | 'mp4' | 'desktop' | 'original';
  download?: (d: OfflineDescriptor) => Promise<OfflineItem[]>;
  offlineList?: () => Promise<OfflineItem[]>;
  onOfflineChange?: (cb: (list: OfflineItem[]) => void) => () => void;
  retryOffline?: (itemId: string) => Promise<OfflineItem[]>;
  /** Delete one download (or cancel it while it's still downloading). */
  removeOffline?: (itemId: string) => Promise<OfflineItem[]>;
  /** Delete every episode of one show (key: seriesId, else seriesTitle). */
  removeOfflineSeries?: (seriesKey: string) => Promise<OfflineItem[]>;
  offlineUsage?: () => Promise<number>;
  clearOffline?: () => Promise<OfflineItem[]>;
  /**
   * Open the downloads page, optionally straight into one movie (play, from `start`
   * seconds) or one show; `offline`: the server can't be reached (offline mode).
   */
  openOffline?: (target?: OfflineTarget) => void;
  /**
   * Where someone got to in a download (kept by the app until Netfish is online again,
   * then sent to the server by takePositions). Apps from 0.6 on.
   */
  savePosition?: (itemId: string, seconds: number, finished: boolean) => void;
  takePositions?: () => Promise<OfflinePosition[]>;
  /** What Home looked like last time (shown greyed out in offline mode). Apps from 0.6 on. */
  saveSnapshot?: (snapshot: string) => void;
  /** A system notification; clicking it opens `path` in Netfish. */
  notify?: (n: { title: string; body: string; path: string }) => void;
  /**
   * iPhone and iPad, installed from a Mac: when this install stops opening (ISO date; every
   * 7 days with a free Apple ID), or null when it doesn't expire. Apps from 0.6.3 on.
   */
  installExpires?: () => Promise<string | null>;
  update?: {
    check: () => Promise<UpdateStatus>;
    /**
     * Downloads and installs the new version: the Mac and Windows apps restart when it's done;
     * Android (asksToConfirm) hands it to the system, which asks you to confirm.
     */
    install: () => Promise<void>;
    asksToConfirm?: boolean;
    /** Turns "Update Netfish by itself" on or off (apps from 0.4 on). */
    setAuto?: (on: boolean) => Promise<void>;
    onProgress: (callback: (p: { received: number; total: number }) => void) => () => void;
  };
}

export interface OfflineTarget {
  play?: string;
  show?: string;
  start?: number;
  offline?: boolean;
}

export interface OfflinePosition {
  itemId: string;
  seconds: number;
  finished: boolean;
  /** When (ISO). */
  at: string;
}

/** The Android app's Java bridge (TVs, phones, tablets): methods only, strings in and out. */
interface AndroidNative {
  version(): string;
  /** firetv (TVs: remote, no downloads) or android (phones and tablets). Older TV versions lack it. */
  platform?(): string;
  changeServer(): void;
  keepAwake(on: boolean): void;
  videoProfile?(): string;
  videoLoad?(request: string): void;
  videoCommand?(name: string, value: string): void;
  download?(descriptor: string): string;
  offlineList?(): string;
  removeOffline?(itemId: string): string;
  removeOfflineSeries?(key: string): string;
  retryOffline?(itemId: string): string;
  clearOffline?(): string;
  offlineUsage?(): number;
  openOffline?(target: string): void;
  openServer?(): void;
  savePosition?(itemId: string, seconds: number, finished: boolean): void;
  takePositions?(): string;
  saveSnapshot?(snapshot: string): void;
  notify?(notification: string): void;
  /** Updates (apps from 0.6.3 on): both answer through window.__netfishUpdate. */
  updateCheck?(): void;
  updateInstall?(): void;
  /** Chromecast (phones and tablets with Google Play services, apps from 0.7.13 on): state through window.__netfishCast. */
  castAvailable?(): boolean;
  castWatch?(on: boolean): void;
  castConnect?(id: string): void;
  castDisconnect?(): void;
  castLoad?(request: string): void;
  castCommand?(name: string, value: string): void;
}

declare global {
  interface Window {
    netfishDesktop?: DesktopBridge;
    NetfishAndroid?: AndroidNative;
    NetfishTV?: AndroidNative;
    /** The Fire TV app reports its player's state here. */
    __netfishVideo?: (state: Record<string, unknown>) => void;
    /** The Android app reports Chromecasts, and what the one in use is doing, here. */
    __netfishCast?: (state: CastState) => void;
  }
}

const videoListeners = new Set<(state: Record<string, unknown>) => void>();
/** Player state pushed in by the Fire TV app. */
function videoStateViaWindow(callback: (state: Record<string, unknown>) => void) {
  window.__netfishVideo = (state) => videoListeners.forEach((cb) => cb(state));
  videoListeners.add(callback);
  return () => void videoListeners.delete(callback);
}

const offlineListeners = new Set<(list: OfflineItem[]) => void>();
/** Download progress pushed in by the Android app. */
function offlineChangesViaWindow(callback: (list: OfflineItem[]) => void) {
  (window as { __netfishOfflineChanged?: (list: OfflineItem[]) => void }).__netfishOfflineChanged = (list) => offlineListeners.forEach((cb) => cb(list));
  offlineListeners.add(callback);
  return () => void offlineListeners.delete(callback);
}

/** What the Android app says about updates: a check's result, download progress, done or a problem. */
interface UpdateEvent {
  for: 'check' | 'install';
  status?: UpdateStatus;
  received?: number;
  total?: number;
  /** The system is asking to confirm the install. */
  done?: boolean;
  error?: string;
}
const updateListeners = new Set<(e: UpdateEvent) => void>();

/** Android's updater: the new APK from the release, handed to the system's installer. */
function androidUpdate(native: AndroidNative): NonNullable<DesktopBridge['update']> {
  (window as { __netfishUpdate?: (e: UpdateEvent) => void }).__netfishUpdate = (e) => updateListeners.forEach((cb) => cb(e));
  const ask = <T>(kind: UpdateEvent['for'], start: () => void, answer: (e: UpdateEvent) => T | undefined) =>
    new Promise<T>((resolve, reject) => {
      const listener = (e: UpdateEvent) => {
        if (e.for !== kind) return;
        const value = e.error ? undefined : answer(e);
        if (!e.error && value === undefined) return; // progress
        updateListeners.delete(listener);
        if (e.error) reject(new Error(e.error));
        else resolve(value as T);
      };
      updateListeners.add(listener);
      start();
    });
  return {
    check: () => ask('check', () => native.updateCheck!(), (e) => e.status),
    install: () => ask('install', () => native.updateInstall!(), (e) => (e.done ? true : undefined)).then(() => undefined),
    asksToConfirm: true,
    onProgress: (callback) => {
      const listener = (e: UpdateEvent) => {
        if (e.for === 'install' && e.total !== undefined) callback({ received: e.received ?? 0, total: e.total });
      };
      updateListeners.add(listener);
      return () => void updateListeners.delete(listener);
    },
  };
}

/** The bridge's answers: a JSON list, or {"error": "…"}. */
function answer(json: string): OfflineItem[] {
  const value = JSON.parse(json) as OfflineItem[] | { error: string };
  if (!Array.isArray(value)) throw new Error(value.error);
  return value;
}

let android: DesktopBridge | undefined;
function androidBridge(): DesktopBridge | undefined {
  const native = window.NetfishAndroid ?? window.NetfishTV;
  if (!native) return undefined;
  const phone = native.platform?.() === 'android' && Boolean(native.download);
  return (android ??= {
    platform: phone ? 'android' : 'firetv',
    version: native.version(),
    changeServer: () => native.changeServer(),
    keepAwake: (on) => native.keepAwake(on),
    // Phones and tablets: downloads, saved as MP4 for Android's player.
    ...(phone
      ? {
          offlineFormat: 'mp4' as const,
          download: async (d: OfflineDescriptor) => answer(native.download!(JSON.stringify(d))),
          offlineList: async () => answer(native.offlineList!()),
          onOfflineChange: offlineChangesViaWindow,
          removeOffline: async (id: string) => answer(native.removeOffline!(id)),
          removeOfflineSeries: async (key: string) => answer(native.removeOfflineSeries!(key)),
          retryOffline: async (id: string) => answer(native.retryOffline!(id)),
          clearOffline: async () => answer(native.clearOffline!()),
          offlineUsage: async () => Number(native.offlineUsage!()),
          openOffline: (target?: OfflineTarget) => native.openOffline!(JSON.stringify(target ?? {})),
          savePosition: native.savePosition ? (itemId: string, seconds: number, finished: boolean) => native.savePosition!(itemId, seconds, finished) : undefined,
          takePositions: native.takePositions ? async () => JSON.parse(native.takePositions!() || '[]') as OfflinePosition[] : undefined,
          saveSnapshot: native.saveSnapshot ? (snapshot: string) => native.saveSnapshot!(snapshot) : undefined,
          notify: native.notify ? (n: { title: string; body: string; path: string }) => native.notify!(JSON.stringify(n)) : undefined,
        }
      : {}),
    // Phones and TVs alike: a new version installs from inside the app.
    update: native.updateCheck && native.updateInstall ? androidUpdate(native) : undefined,
    // ExoPlayer draws the film underneath the page; the page's player drives it.
    videoOverlay: native.videoLoad
      ? {
          name: 'ExoPlayer',
          profile: async () => JSON.parse(native.videoProfile?.() ?? '{}'),
          load: async (request) => native.videoLoad?.(JSON.stringify(request)),
          command: (name, value) => native.videoCommand?.(name, JSON.stringify(value ?? null)),
          onState: videoStateViaWindow,
        }
      : undefined,
    cast: native.castAvailable?.() ? castBridge(native) : undefined,
  });
}

/** Chromecast through the Android app: one set of listeners for everything it reports (the last state kept, for whoever asks later). */
const castListeners = new Set<(state: CastState) => void>();
let castLast: CastState = {};
function castBridge(native: AndroidNative): CastBridge {
  window.__netfishCast = (state) => {
    // Kept for whoever listens later: what lasts, not what just happened.
    const { ended, error, errorCode, ...lasting } = state; // eslint-disable-line @typescript-eslint/no-unused-vars
    castLast = { ...castLast, ...lasting };
    castListeners.forEach((cb) => cb(state));
  };
  return {
    watch: (on) => native.castWatch?.(on),
    connect: (id) => native.castConnect?.(id),
    disconnect: () => native.castDisconnect?.(),
    load: (request) => native.castLoad?.(JSON.stringify(request)),
    command: (name, value) => native.castCommand?.(name, JSON.stringify(value ?? null)),
    onState: (cb) => {
      castListeners.add(cb);
      cb(castLast);
      return () => void castListeners.delete(cb);
    },
  };
}

/** The app around this page, if any (desktop, iPhone/iPad or Fire TV). */
export const desktop = (): DesktopBridge | undefined => window.netfishDesktop ?? androidBridge();

/**
 * Marks `el` with is-fullscreen while the app's window is full screen (the window's own, not
 * the page's): the Mac's window buttons are hidden then, so nothing needs to leave room for them.
 */
export function markFullscreen(el: HTMLElement) {
  desktop()?.videoOverlay?.onState((state) => {
    if (typeof state.fullscreen === 'boolean') el.classList.toggle('is-fullscreen', state.fullscreen);
  });
}

/** How to call this app in the interface. */
export function appKind(): { name: string; device: string } {
  const platform = desktop()?.platform;
  if (platform === 'ios') return { name: t('iPhone & iPad app'), device: t('this device') };
  if (platform === 'android') return { name: t('Android app'), device: t('this device') };
  if (platform === 'firetv') return { name: t('TV app'), device: t('this TV') };
  return { name: t('Desktop app'), device: t('this computer') };
}
// (desktop(), not window.netfishDesktop: the Android app's phones download too.)
export const canDownloadHere = () => Boolean(desktop()?.download);

/** Live list of downloads on this computer (desktop app only). */
export function useOffline(): OfflineItem[] {
  const [list, setList] = useState<OfflineItem[]>([]);
  useEffect(() => {
    const d = desktop();
    if (!d?.offlineList) return;
    void d.offlineList().then(setList);
    return d.onOfflineChange?.(setList);
  }, []);
  return list;
}
