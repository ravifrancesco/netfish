import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProfilesResponse } from '@netfish/shared';
import { checkToken, type SessionUser } from './auth';
import { config } from './config';
import { writeJson } from './lib/storage';
import { HttpError } from './lib/upstream';
import { t } from './lib/i18n';

/**
 * "Who's watching?": the accounts signed in on one device (a TV in the living room),
 * so switching between them takes a click (and a PIN, if that person set one) instead
 * of a password. Each device is told apart by its own cookie; the Jellyfin sign-ins
 * stay here on the server, never in the device's browser storage.
 */

export const DEVICE_COOKIE = 'netfish_device';
const FILE = path.join(config.dataDir, 'profiles.json');
const MAX_PROFILES = 8;
const FORGET_DEVICE = 400 * 24 * 3600_000;

interface Profile {
  userId: string;
  name: string;
  hasAvatar: boolean;
  token: string;
  pin?: { salt: string; hash: string };
  lastUsed: number;
}

interface Device {
  profiles: Profile[];
  /** Ask "who's watching?" when Netfish opens (only matters with two or more profiles). */
  ask: boolean;
  seen: number;
}

let devices: Record<string, Device> = (() => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
})();

function save() {
  const cutoff = Date.now() - FORGET_DEVICE;
  devices = Object.fromEntries(Object.entries(devices).filter(([, d]) => d.seen > cutoff && d.profiles.length));
  writeJson(FILE, devices, 0o600); // sign-ins: readable only by Netfish
}

export function deviceOf(req: FastifyRequest): string | undefined {
  const id = req.cookies?.[DEVICE_COOKIE];
  return id && /^[a-f0-9]{48}$/.test(id) ? id : undefined;
}

/** The device's id, giving it one the first time someone signs in on it. */
export function ensureDevice(req: FastifyRequest, reply: FastifyReply): string {
  const existing = deviceOf(req);
  if (existing) return existing;
  const id = crypto.randomBytes(24).toString('hex');
  reply.setCookie(DEVICE_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https', maxAge: 60 * 60 * 24 * 400 });
  return id;
}

/** After someone signs in on this device: add them (or refresh their sign-in). */
export function rememberProfile(deviceId: string, user: SessionUser) {
  const device = devices[deviceId] ?? { profiles: [], ask: true, seen: Date.now() };
  const previous = device.profiles.find((p) => p.userId === user.id);
  const profile: Profile = { userId: user.id, name: user.name, hasAvatar: Boolean(user.avatar), token: user.token, pin: previous?.pin, lastUsed: Date.now() };
  device.profiles = [profile, ...device.profiles.filter((p) => p.userId !== user.id)]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_PROFILES);
  device.seen = Date.now();
  devices = { ...devices, [deviceId]: device };
  save();
}

export function listProfiles(deviceId: string | undefined, currentToken: string | undefined): ProfilesResponse {
  const device = deviceId ? devices[deviceId] : undefined;
  if (!device) return { profiles: [], ask: false };
  return {
    // Same order every time, so the picker doesn't shuffle.
    profiles: [...device.profiles]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        userId: p.userId,
        name: p.name,
        avatar: p.hasAvatar ? `/api/profiles/${p.userId}/avatar` : undefined,
        locked: Boolean(p.pin),
        current: p.token === currentToken,
      })),
    ask: device.ask,
  };
}

export const hasProfile = (deviceId: string | undefined, userId: string) => Boolean(deviceId && devices[deviceId]?.profiles.some((p) => p.userId === userId));

// Wrong PINs: a few tries, then a short wait.
const misses = new Map<string, { count: number; until: number }>();

function pinHash(pin: string, salt: string) {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

/** Switches this device to another profile: checks its PIN, and that its sign-in still works. */
export async function switchProfile(deviceId: string | undefined, userId: string, pin?: string): Promise<SessionUser> {
  const device = deviceId ? devices[deviceId] : undefined;
  const profile = device?.profiles.find((p) => p.userId === userId);
  if (!device || !profile) throw new HttpError(404, t("That profile isn't on this device any more"));
  if (profile.pin) {
    const key = `${deviceId}:${userId}`;
    const miss = misses.get(key);
    if (miss && miss.until > Date.now()) throw new HttpError(429, t('Too many wrong PINs. Try again in a minute.'));
    const given = Buffer.from(pinHash(String(pin ?? ''), profile.pin.salt), 'hex');
    if (!pin || !crypto.timingSafeEqual(given, Buffer.from(profile.pin.hash, 'hex'))) {
      const count = (miss?.count ?? 0) + 1;
      misses.set(key, { count: count >= 5 ? 0 : count, until: count >= 5 ? Date.now() + 60_000 : 0 });
      throw new HttpError(403, t('Wrong PIN'));
    }
    misses.delete(key);
  }
  const user = await checkToken(profile.token);
  if (!user) {
    // Signed out elsewhere (or the password changed): this profile needs a fresh sign-in.
    device.profiles = device.profiles.filter((p) => p.userId !== userId);
    save();
    throw new HttpError(401, t('Sign in to {name} again', { name: profile.name }));
  }
  profile.lastUsed = Date.now();
  device.seen = Date.now();
  save();
  return user;
}

/** The current person's PIN on this device: four digits, or null to remove it. */
export function setPin(deviceId: string | undefined, userId: string, pin: string | null) {
  const profile = deviceId ? devices[deviceId]?.profiles.find((p) => p.userId === userId) : undefined;
  if (!profile) throw new HttpError(404, t("That profile isn't on this device any more"));
  if (pin !== null && !/^\d{4}$/.test(pin)) throw new HttpError(400, t('A PIN is four digits'));
  if (pin === null) delete profile.pin;
  else {
    const salt = crypto.randomBytes(16).toString('hex');
    profile.pin = { salt, hash: pinHash(pin, salt) };
  }
  save();
}

export function setAsk(deviceId: string | undefined, ask: boolean) {
  const device = deviceId ? devices[deviceId] : undefined;
  if (!device) return;
  device.ask = ask;
  save();
}

/** Takes a profile off this device; returns its sign-in so it can be ended too. */
export function removeProfile(deviceId: string | undefined, userId: string): string | undefined {
  const device = deviceId ? devices[deviceId] : undefined;
  const profile = device?.profiles.find((p) => p.userId === userId);
  if (!device || !profile) return undefined;
  device.profiles = device.profiles.filter((p) => p.userId !== userId);
  save();
  return profile.token;
}
