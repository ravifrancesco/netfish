import fs from 'node:fs';
import path from 'node:path';
import type { SessionUser } from '../auth';
import { config } from '../config';
import { jellyfin, type JfItem } from '../clients/jellyfin';
import { writeJson } from '../lib/storage';
import { HttpError } from '../lib/upstream';
import { t } from '../lib/i18n';

/**
 * Watched or not (Jellyfin's own flag), and taking something off Continue Watching.
 * Jellyfin has no "hide" for that, so Netfish remembers, per person, what they took off
 * and when: it comes back by itself once they play it again.
 */

const FILE = path.join(config.dataDir, 'hidden.json');
/** userId → movie or series id → when it was taken off Continue Watching (ms). */
let hidden: Record<string, Record<string, number>> = (() => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
})();

export async function setWatched(user: SessionUser, itemId: string, watched: boolean) {
  if (!/^[\w-]{1,64}$/.test(itemId)) throw new HttpError(400, t('Unknown item'));
  await jellyfin.setPlayed(user.token, user.id, itemId, watched);
  return { ok: true };
}

/**
 * Where someone got to in a download watched on their phone or computer (sent when the app
 * is next online): Continue Watching and "watched" follow, as if they'd streamed it.
 */
export async function setPosition(user: SessionUser, itemId: string, seconds: number, finished: boolean, at?: string) {
  if (!/^[\w-]{1,64}$/.test(itemId) || !Number.isFinite(seconds) || seconds < 0) throw new HttpError(400, t('Unknown item'));
  if (finished) await jellyfin.setPlayed(user.token, user.id, itemId, true);
  else {
    const when = new Date(at ?? Date.now());
    await jellyfin.setPosition(user.token, user.id, itemId, Math.min(seconds, 24 * 3600), Number.isNaN(when.getTime()) || when.getTime() > Date.now() ? new Date() : when);
  }
  return { ok: true };
}

export function hideFromContinue(user: SessionUser, id: string) {
  if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, t('Unknown item'));
  const mine = { ...hidden[user.id], [id]: Date.now() };
  // Only the newest few hundred matter.
  hidden = { ...hidden, [user.id]: Object.fromEntries(Object.entries(mine).sort((a, b) => b[1] - a[1]).slice(0, 300)) };
  writeJson(FILE, hidden);
  return { ok: true };
}

/** Still taken off Continue Watching: not played since. `group` is the movie or the show. */
export function isHidden(userId: string, group: string, item: JfItem) {
  const at = hidden[userId]?.[group];
  if (!at) return false;
  const played = Date.parse(item.UserData?.LastPlayedDate ?? '') || 0;
  return played <= at;
}
