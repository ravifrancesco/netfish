import { randomBytes } from 'node:crypto';
import type { SessionUser } from '../auth';

/**
 * Links a Chromecast can open. It can't sign in, so each link carries a token that stands for
 * the person, for one title only, for a while; Jellyfin repeats a stream's query in the
 * playlists and segments it links to, so the token travels with all of them.
 */

const LIFETIME = 12 * 3600_000;
const tokens = new Map<string, { jellyfinToken: string; itemId: string; expires: number }>();

export function castToken(user: SessionUser, itemId: string): string {
  const now = Date.now();
  for (const [key, t] of tokens) if (t.expires < now) tokens.delete(key);
  const token = randomBytes(24).toString('hex');
  tokens.set(token, { jellyfinToken: user.token, itemId, expires: now + LIFETIME });
  return token;
}

/** The person's Jellyfin token, when `token` is good for this path (that title's files). */
export function castAuth(token: string | undefined, path: string): string | undefined {
  const t = token ? tokens.get(token) : undefined;
  if (!t || t.expires < Date.now()) return undefined;
  // The path as it will be sent on (../, %2e%2e and \ resolved: no way out of the film's files).
  // Jellyfin writes it either way: /Videos/ for files, /videos/ in its HLS links.
  if (/%2f|%5c/i.test(path)) return undefined;
  const resolved = new URL(path, 'http://x').pathname.toLowerCase();
  return resolved.startsWith(`/videos/${t.itemId.toLowerCase()}/`) ? t.jellyfinToken : undefined;
}
