import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { jellyfin, type JfItem } from '../clients/jellyfin';
import { onConnectionChange } from '../connections';
import { mapLimit } from '../lib/async';
import { MINUTE } from '../lib/cache';
import { writeJson } from '../lib/storage';

/**
 * What everyone on the server has been watching lately: the "Popular on this server"
 * row, and a nudge in everyone's picks. Each person's recent history is noted when they
 * open Home (read with their own Jellyfin account). With Jellyfin's API key, everyone's
 * is also read straight from Jellyfin every half hour, so people who watch in other
 * apps count too. Only Jellyfin title ids and dates are kept, in Netfish's data folder.
 */

const DAY = 24 * 60 * MINUTE;
const FILE = path.join(config.dataDir, 'household.json');
/** Titles remembered per person, and for how long. */
const KEEP = 200;
const FORGET_AFTER = 120 * DAY;
/** How quickly a watch stops counting as "lately". */
const HALF_LIFE = 21 * DAY;

/** Jellyfin movie or series id → when that person last watched it (ms). */
type Watched = Record<string, number>;
let people: Record<string, Watched> = load();

function load(): Record<string, Watched> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')).people ?? {};
  } catch {
    return {};
  }
}

let saveTimer: NodeJS.Timeout | undefined;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      writeJson(FILE, { people }, 0o600);
    } catch {
      /* the storage warning in Settings already explains this */
    }
  }, 5000);
  saveTimer.unref?.();
}

/** A movie stands for itself; an episode stands for its show. */
const titleOf = (item: JfItem) => (item.Type === 'Episode' ? item.SeriesId : item.Type === 'Movie' || item.Type === 'Series' ? item.Id : undefined);

/** Remember what someone watched (their played and in-progress items, newest first). */
export function noteWatched(userId: string, items: JfItem[]) {
  const watched = { ...people[userId] };
  let changed = false;
  for (const item of items) {
    const id = titleOf(item);
    const at = Date.parse(item.UserData?.LastPlayedDate ?? '');
    if (!id || !at || (watched[id] ?? 0) >= at) continue;
    watched[id] = at;
    changed = true;
  }
  if (!changed) return;
  const cutoff = Date.now() - FORGET_AFTER;
  people[userId] = Object.fromEntries(
    Object.entries(watched)
      .filter(([, at]) => at > cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP),
  );
  saveSoon();
}

export interface HouseholdTitle {
  /** Jellyfin movie or series id. */
  id: string;
  /** How many other people watched it lately. */
  viewers: number;
  score: number;
}

/** What the others have been watching, most popular and most recent first. */
export function householdFavourites(exceptUserId: string): HouseholdTitle[] {
  const now = Date.now();
  const titles = new Map<string, HouseholdTitle>();
  for (const [userId, watched] of Object.entries(people)) {
    if (userId === exceptUserId) continue;
    for (const [id, at] of Object.entries(watched)) {
      const freshness = Math.pow(0.5, (now - at) / HALF_LIFE);
      const entry = titles.get(id) ?? { id, viewers: 0, score: 0 };
      entry.viewers++;
      entry.score += freshness;
      titles.set(id, entry);
    }
  }
  return [...titles.values()].filter((t) => t.score > 0.05).sort((a, b) => b.score - a.score);
}

// ---------- Everyone, from Jellyfin (needs its API key) ----------

let lastSync = 0;
let syncing = false;
onConnectionChange((id) => {
  if (id === 'jellyfin') lastSync = 0;
});

/** Refreshes everyone's history in the background, at most every half hour. Never waits. */
export function syncHousehold() {
  const key = config.jellyfin.apiKey;
  if (!key || !config.jellyfin.url || syncing || Date.now() - lastSync < 30 * MINUTE) return;
  lastSync = Date.now();
  syncing = true;
  void (async () => {
    const users = await jellyfin.users(key);
    await mapLimit(users, 2, async (user) => {
      const query = { userId: user.Id, recursive: true, fields: 'ProviderIds', enableImages: false };
      const [played, resume] = await Promise.all([
        jellyfin.items(key, { ...query, includeItemTypes: 'Movie,Episode', filters: 'IsPlayed', sortBy: 'DatePlayed', sortOrder: 'Descending', limit: 150 }),
        jellyfin.items(key, { ...query, includeItemTypes: 'Movie,Episode', filters: 'IsResumable', limit: 30 }),
      ]);
      noteWatched(user.Id, [...resume.Items, ...played.Items]);
    });
  })()
    .catch(() => {
      lastSync = Date.now() - 25 * MINUTE; // try again in five minutes
    })
    .finally(() => (syncing = false));
}
