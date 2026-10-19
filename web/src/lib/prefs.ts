import { useSyncExternalStore } from 'react';

/** Per-device preferences. Nothing here matters to other devices or the server. */
export interface Prefs {
  /** Bits/second; 0 = automatic (no cap). */
  maxBitrate: number;
  subtitlesByDefault: boolean;
  subtitleLanguage: string;
  audioLanguage: string;
  autoplayNext: boolean;
  volume: number;
  /** Notify when something you asked for is ready to watch (apps, or a browser that allows it). */
  notifyReady: boolean;
  /** Notify when someone else opens a Watch together room. */
  notifyTogether: boolean;
}

const KEY = 'netfish.prefs';
const DEFAULTS: Prefs = {
  maxBitrate: 0,
  subtitlesByDefault: false,
  subtitleLanguage: 'en',
  audioLanguage: '',
  autoplayNext: true,
  volume: 1,
  notifyReady: true,
  notifyTogether: true,
};

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

/**
 * Subtitles chosen while watching (or turned off): from then on the default, for films and
 * channels alike (Settings shows the same switch). Forced ones (signs, foreign lines) don't
 * count as turning them on.
 */
export function rememberSubtitle(track: { code?: string; forced?: boolean } | undefined) {
  setPrefs(track ? { subtitlesByDefault: !track.forced, ...(track.code ? { subtitleLanguage: track.code } : {}) } : { subtitlesByDefault: false });
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode etc. — keep in memory */
  }
  listeners.forEach((l) => l());
}

export const getPrefs = () => current;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Stable id per browser/app install, so Jellyfin lists each device once. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('netfish.deviceId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('netfish.deviceId', id);
    }
    return id;
  } catch {
    return 'netfish-web';
  }
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/NetfishDesktop/.test(ua)) return `Netfish Desktop (${/Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux'})`;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const device = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Web';
  return `Netfish ${browser} (${device})`;
}
