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
      id = randomId();
      localStorage.setItem('netfish.deviceId', id);
    }
    return id;
  } catch {
    // Can't be kept (private mode): this page's own, never one every device shares (Jellyfin
    // ends a person's older session on "the same device" when they sign in again).
    return (unkept ??= randomId());
  }
}
let unkept: string | undefined;

/**
 * A random id that works on plain http too: crypto.randomUUID only exists on https pages, and a
 * home server often isn't one.
 */
function randomId(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/NetfishDesktop/.test(ua)) return `Netfish Desktop (${/Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux'})`;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const device = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Web';
  return `Netfish ${browser} (${device})`;
}
