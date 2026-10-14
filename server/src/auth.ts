import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@netfish/shared';
import { jellyfin, type JfUser } from './clients/jellyfin';
import { MINUTE, TTLCache } from './lib/cache';
import { HttpError, UpstreamError } from './lib/upstream';
import { onConnectionChange } from './connections';
import { t } from './lib/i18n';

/**
 * Netfish has no user database of its own (yet): signing in goes through
 * Jellyfin, and the Jellyfin access token is the session. It lives in an
 * HttpOnly cookie for the web app (so <video>/<img> requests through the
 * proxy are authorised too) or a Bearer header for future native clients.
 */

export const SESSION_COOKIE = 'netfish_session';

export interface SessionUser extends User {
  token: string;
  /** Jellyfin's per-user "Allow media downloading". */
  canDownload: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const sessions = new TTLCache<SessionUser | null>(2000);
// A different Jellyfin means every token we cached is meaningless.
onConnectionChange((id) => id === 'jellyfin' && sessions.clear());

export function toSessionUser(u: JfUser, token: string): SessionUser {
  return {
    id: u.Id,
    name: u.Name,
    isAdmin: Boolean(u.Policy?.IsAdministrator),
    canDownload: u.Policy?.EnableContentDownloading !== false,
    avatar: u.PrimaryImageTag ? `/jellyfin/Users/${u.Id}/Images/Primary?tag=${u.PrimaryImageTag}&maxWidth=128` : undefined,
    token,
  };
}

export function rememberSession(user: SessionUser) {
  sessions.set(user.token, user, 5 * MINUTE);
}

export function forgetSession(token: string) {
  sessions.delete(token);
}

export function tokenFrom(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || undefined;
  return req.cookies?.[SESSION_COOKIE] || undefined;
}

async function resolve(token: string): Promise<SessionUser | null> {
  return sessions.wrap(token, 5 * MINUTE, async () => {
    try {
      return toSessionUser(await jellyfin.me(token), token);
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 401) return null;
      throw err;
    }
  });
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const token = tokenFrom(req);
  const user = token ? await resolve(token) : null;
  if (!user) {
    if (token) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    throw new HttpError(401, t('Please sign in'));
  }
  req.user = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (!req.user!.isAdmin) throw new HttpError(403, t('Admins only'));
}

/** For handlers registered behind requireUser. */
export function userOf(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, t('Please sign in'));
  return req.user;
}
