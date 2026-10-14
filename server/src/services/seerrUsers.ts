import type { SessionUser } from '../auth';
import { seerr } from '../clients/seerr';
import { onConnectionChange } from '../connections';
import { MINUTE, TTLCache } from '../lib/cache';
import { HttpError } from '../lib/upstream';
import { t } from '../lib/i18n';

/**
 * Seerr keeps its own users. To file requests as the right person we find the
 * Seerr user linked to this Jellyfin account, importing it if needed — the
 * same thing an admin would click in Seerr's "Import Jellyfin users".
 */

const ids = new TTLCache<number>(500);
onConnectionChange((id) => (id === 'seerr' || id === 'jellyfin') && ids.clear());
const normalize = (id?: string) => id?.replace(/-/g, '').toLowerCase();

async function lookup(jellyfinUserId: string): Promise<number | undefined> {
  try {
    return (await seerr.userByJellyfinId(jellyfinUserId)).id;
  } catch {
    // Older Seerr builds lack the direct lookup; fall back to scanning the list.
  }
  try {
    const { results } = await seerr.users();
    return results.find((u) => normalize(u.jellyfinUserId) === normalize(jellyfinUserId))?.id;
  } catch {
    return undefined;
  }
}

export function seerrUserId(user: SessionUser): Promise<number> {
  return ids.wrap(user.id, 30 * MINUTE, async () => {
    const existing = await lookup(user.id);
    if (existing) return existing;
    try {
      const created = await seerr.importJellyfinUsers([user.id]);
      if (created?.[0]?.id) return created[0].id;
    } catch {
      /* reported below */
    }
    const afterImport = await lookup(user.id);
    if (afterImport) return afterImport;
    throw new HttpError(
      403,
      t('Your account ({name}) isn\'t linked in Seerr yet. An admin can fix this with "Import Jellyfin Users" in Seerr.', { name: user.name }),
    );
  });
}

/** Same as seerrUserId but never throws; used for "mine" badges. */
export async function maybeSeerrUserId(user: SessionUser): Promise<number | undefined> {
  try {
    return await seerrUserId(user);
  } catch {
    return undefined;
  }
}
