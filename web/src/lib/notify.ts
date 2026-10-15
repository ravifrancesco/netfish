import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api';
import { titleHref } from './format';
import { desktop } from './desktop';
import { getPrefs } from './prefs';
import { t } from '../i18n';

declare global {
  interface Window {
    /** The apps call this when their notification is clicked. */
    __netfishOpen?: (path: string) => void;
  }
}

/** The Mac, Windows and Android apps notify through the system; a browser only if it was allowed to. */
export const notifySupport = (): 'app' | 'browser' | undefined =>
  desktop()?.notify ? 'app' : typeof Notification !== 'undefined' && !desktop() ? 'browser' : undefined;

function show(title: string, body: string, path: string, open: (path: string) => void) {
  const app = desktop()?.notify;
  if (app) return app({ title, body, path });
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag: path, icon: '/icon.svg' });
    n.onclick = () => {
      window.focus();
      open(path);
      n.close();
    };
  }
}

/**
 * Checks every few minutes for requests that have arrived and notifies about new ones.
 * The very first check only takes note of what's there, so nobody gets a burst of old ones.
 */
export function useReadyNotifications(userId: string) {
  const navigate = useNavigate();
  useEffect(() => {
    window.__netfishOpen = (path) => navigate(path);
    if (!getPrefs().notifyReady || !notifySupport()) return;
    const key = `netfish.readySeen.${userId}`;
    let stopped = false;
    const check = async () => {
      const { items } = await api.ready().catch(() => ({ items: [] }));
      if (stopped) return;
      let seen: string[] | null = null;
      try {
        seen = JSON.parse(localStorage.getItem(key) ?? 'null');
      } catch {
        /* first time */
      }
      if (seen) {
        for (const card of items) {
          if (!seen.includes(card.key)) show(t('Ready to watch'), t('{title} is ready to watch.', { title: card.title }), titleHref(card), navigate);
        }
      }
      try {
        localStorage.setItem(key, JSON.stringify([...new Set([...(seen ?? []), ...items.map((c) => c.key)])].slice(-200)));
      } catch {
        /* private window: notifies again next time */
      }
    };
    const first = setTimeout(() => void check(), 15_000);
    const every = setInterval(() => void check(), 5 * 60_000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Notifies when someone else opens a Watch together room (rooms already open when the app starts don't count). */
export function useTogetherNotifications(userId: string) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!getPrefs().notifyTogether || !notifySupport()) return;
    let seen: Set<string> | undefined;
    let stopped = false;
    const check = async () => {
      const { rooms } = await api.rooms().catch(() => ({ rooms: [] }));
      if (stopped) return;
      const open = rooms.filter((r) => r.hostId !== userId && !r.members.some((m) => m.userId === userId));
      if (seen) {
        for (const room of open) {
          if (seen.has(room.id)) continue;
          const body = room.subtitle ? `${room.title} · ${room.subtitle}` : room.title;
          show(t('{name} wants to watch together', { name: room.hostName }), body, `/together/${room.id}`, navigate);
        }
      }
      seen = new Set([...(seen ?? []), ...rooms.map((r) => r.id)]);
    };
    void check();
    const every = setInterval(() => void check(), 30_000);
    return () => {
      stopped = true;
      clearInterval(every);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}
