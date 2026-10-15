import { useEffect, useState } from 'react';
import { api, setUnreachableHandler } from '../api';
import { desktop, type OfflineItem } from './desktop';

/**
 * The apps' downloads, while Netfish is online: Play uses a downloaded copy, where people
 * got to in a download reaches the server, and the app switches to offline mode (only
 * what's downloaded) when the server stops answering.
 */

/** This film's downloaded copy: undefined while checking, null when there's none ready. */
export function useDownloaded(itemId: string): OfflineItem | null | undefined {
  const [found, setFound] = useState<OfflineItem | null | undefined>(() => (desktop()?.offlineList ? undefined : null));
  useEffect(() => {
    const app = desktop();
    if (!app?.offlineList) return setFound(null);
    let alive = true;
    app.offlineList().then(
      (list) => alive && setFound(list.find((i) => i.itemId === itemId && i.state === 'done') ?? null),
      () => alive && setFound(null),
    );
    return () => {
      alive = false;
    };
  }, [itemId]);
  return found;
}

/** Sends where people got to in downloads (watched offline, or in the downloads player). */
async function sendPositions() {
  const app = desktop();
  const list = await app?.takePositions?.().catch(() => []);
  for (const p of list ?? []) {
    try {
      await api.setPosition(p.itemId, p.seconds, p.finished, p.at);
    } catch {
      // Not now (offline again?): keep it for next time.
      app?.savePosition?.(p.itemId, p.seconds, p.finished);
    }
  }
}

/** Is the server there? Two tries, a moment apart (one dropped request isn't "offline"). */
async function reachable() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const res = await fetch('/api/config', { signal: ctl.signal, cache: 'no-store' });
      if (res.ok || res.status < 500) return true;
    } catch {
      /* try again */
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

/** While signed in, in the apps: positions go to the server, and a lost server means offline mode. */
export function useOfflineAware() {
  useEffect(() => {
    const app = desktop();
    if (!app?.openOffline) return;
    void sendPositions();
    const every = setInterval(() => void sendPositions(), 60_000);
    const onFocus = () => void sendPositions();
    window.addEventListener('focus', onFocus);

    let checking = false;
    setUnreachableHandler(() => {
      if (checking) return;
      checking = true;
      void reachable().then((ok) => {
        checking = false;
        if (!ok) app.openOffline?.({ offline: true });
      });
    });
    return () => {
      clearInterval(every);
      window.removeEventListener('focus', onFocus);
      setUnreachableHandler(() => {});
    };
  }, []);
}
