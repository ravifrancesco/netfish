import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ScreenKind } from '@netfish/shared';
import { api } from '../api';
import { desktop } from './desktop';
import { isTV } from './tv';
import { t } from '../i18n';

/**
 * This Netfish as a screen others can play on (Play on TV): an id that stays the same on
 * this device, what kind of device it is, and a name people recognise ("Fire TV",
 * "Ravi's Mac", or what you call it in Settings).
 */

const ID_KEY = 'netfish.screenId';
const NAME_KEY = 'netfish.screenName';
const NAME_EVENT = 'netfish:screen-name';

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
let fallbackId: string | undefined;

export function screenId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    // No storage (a private window): a new screen each time Netfish opens.
    return (fallbackId ??= newId());
  }
}

const ua = navigator.userAgent;
const isIPad = () => /iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
const bigScreen = () => Math.min(screen.width, screen.height) >= 600;

export function screenKind(): ScreenKind {
  if (isTV()) return 'tv';
  const platform = desktop()?.platform;
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return 'computer';
  if (platform === 'ios') return isIPad() ? 'tablet' : 'phone';
  if (platform === 'android') return bigScreen() ? 'tablet' : 'phone';
  if (/iPhone|Android.*Mobile/.test(ua)) return 'phone';
  if (isIPad() || /Android/.test(ua)) return 'tablet';
  return 'browser';
}

export function defaultScreenName(): string {
  const platform = desktop()?.platform;
  switch (screenKind()) {
    case 'tv':
      return /Tizen/.test(ua) ? 'Samsung TV' : /AFT/.test(ua) || platform === 'firetv' ? 'Fire TV' : t('TV');
    case 'computer':
      return platform === 'darwin' ? 'Mac' : platform === 'win32' ? t('Windows PC') : t('Computer');
    case 'phone':
      return /iPhone/.test(ua) || platform === 'ios' ? 'iPhone' : t('Android phone');
    case 'tablet':
      return isIPad() ? 'iPad' : t('Android tablet');
    default: {
      const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : t('A browser');
      const os = /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
      return os ? t('{browser} on {os}', { browser, os }) : browser;
    }
  }
}

/** What you called this device in Settings; empty for the automatic name. */
export function savedScreenName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export const screenName = () => savedScreenName() || defaultScreenName();

export function setScreenName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim().slice(0, 40));
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* private window: only for now */
  }
  window.dispatchEvent(new Event(NAME_EVENT));
}

/** This device's name, following changes made in Settings. */
export function useScreenName() {
  const [name, setName] = useState(screenName);
  useEffect(() => {
    const update = () => setName(screenName());
    window.addEventListener(NAME_EVENT, update);
    return () => window.removeEventListener(NAME_EVENT, update);
  }, []);
  return name;
}

/** The screens you can play on, other than this one. Kept current by the live line. */
export function useOtherScreens() {
  const q = useQuery({ queryKey: ['screens'], queryFn: api.screens, refetchInterval: 60_000, staleTime: 30_000 });
  const me = screenId();
  return (q.data?.screens ?? []).filter((s) => s.id !== me);
}

// ---------- Connected to a screen (like casting on YouTube) ----------

/** The screen Play sends things to, while this device is connected to one. */
export interface CastTarget {
  id: string;
  name: string;
}
const CAST_KEY = 'netfish.castTo';
const CAST_EVENT = 'netfish:cast';

export function castTarget(): CastTarget | undefined {
  try {
    return JSON.parse(localStorage.getItem(CAST_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

export function setCastTarget(target: CastTarget | undefined) {
  try {
    if (target) localStorage.setItem(CAST_KEY, JSON.stringify(target));
    else localStorage.removeItem(CAST_KEY);
  } catch {
    /* private window: only for now */
  }
  window.dispatchEvent(new Event(CAST_EVENT));
}

export function useCastTarget() {
  const [target, setTarget] = useState(castTarget);
  useEffect(() => {
    const update = () => setTarget(castTarget());
    window.addEventListener(CAST_EVENT, update);
    return () => window.removeEventListener(CAST_EVENT, update);
  }, []);
  return target;
}
