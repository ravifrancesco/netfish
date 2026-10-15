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

export interface DesktopBridge {
  /** darwin / win32 / linux (desktop), ios, or firetv. */
  platform: string;
  version: string;
  changeServer: () => void;
  /** TV: keep the screen from dimming while a film plays. */
  keepAwake?: (on: boolean) => void;
  videoOverlay?: VideoOverlay;
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
  /** Open the downloads page, optionally straight into one movie (play) or one show. */
  openOffline?: (target?: { play?: string; show?: string }) => void;
  /** A system notification; clicking it opens `path` in Netfish. */
  notify?: (n: { title: string; body: string; path: string }) => void;
  update?: {
    check: () => Promise<UpdateStatus>;
    /** Downloads and installs the new version; the app restarts when it's done. */
    install: () => Promise<void>;
    /** Turns "Update Netfish by itself" on or off (apps from 0.4 on). */
    setAuto?: (on: boolean) => Promise<void>;
    onProgress: (callback: (p: { received: number; total: number }) => void) => () => void;
  };
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
  notify?(notification: string): void;
}

declare global {
  interface Window {
    netfishDesktop?: DesktopBridge;
    NetfishAndroid?: AndroidNative;
    NetfishTV?: AndroidNative;
    /** The Fire TV app reports its player's state here. */
    __netfishVideo?: (state: Record<string, unknown>) => void;
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
          openOffline: (target?: { play?: string; show?: string }) => native.openOffline!(JSON.stringify(target ?? {})),
          notify: native.notify ? (n: { title: string; body: string; path: string }) => native.notify!(JSON.stringify(n)) : undefined,
        }
      : {}),
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
  });
}

/** The app around this page, if any (desktop, iPhone/iPad or Fire TV). */
export const desktop = (): DesktopBridge | undefined => window.netfishDesktop ?? androidBridge();

/** How to call this app in the interface. */
export function appKind(): { name: string; device: string } {
  const platform = desktop()?.platform;
  if (platform === 'ios') return { name: t('iPhone & iPad app'), device: t('this device') };
  if (platform === 'android') return { name: t('Android app'), device: t('this device') };
  if (platform === 'firetv') return { name: t('TV app'), device: t('this TV') };
  return { name: t('Desktop app'), device: t('this computer') };
}
export const canDownloadHere = () => Boolean(window.netfishDesktop?.download);

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
