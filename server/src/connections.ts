import { randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ConnectionTest, ServiceConnection, ServiceConnectionUpdate, ServiceId } from '@netfish/shared';
import { config } from './config';
import { writeJson } from './lib/storage';
import { HttpError, request } from './lib/upstream';
import { t } from './lib/i18n';
import { traktCheck } from './clients/trakt';

/**
 * Service addresses and API keys, editable by admins in the app. The stack's
 * environment variables are only the starting values: once a service is saved
 * here, the saved version wins (and "Reset" goes back to the stack's).
 * Stored in its own file, readable only by Netfish, and never sent back to
 * the browser in full.
 */

interface Stored {
  url?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

interface Meta {
  name: string;
  purpose: string;
  keyHelp?: string;
  required?: boolean;
  defaultUrl?: string;
  fixedUrl?: boolean;
  usesKey: boolean;
  usesLogin?: boolean;
  usesSecret?: boolean;
  keyLabel?: string;
  secretLabel?: string;
}

export const SERVICES: Record<ServiceId, Meta> = {
  jellyfin: {
    name: 'Jellyfin',
    purpose: 'Sign-in, library and playback',
    keyHelp: 'Optional. Dashboard → API Keys → +. Lets Netfish refresh items when new subtitles arrive.',
    required: true,
    defaultUrl: 'http://host.docker.internal:8096',
    usesKey: true,
  },
  seerr: {
    name: 'Seerr',
    purpose: 'Discovery, suggestions, requests and scores',
    keyHelp: 'Settings → General → API Key',
    defaultUrl: 'http://host.docker.internal:5055',
    usesKey: true,
  },
  radarr: {
    name: 'Radarr',
    purpose: 'Movie downloads, versions and audio languages',
    keyHelp: 'Settings → General → Security → API Key',
    defaultUrl: 'http://host.docker.internal:7878',
    usesKey: true,
  },
  sonarr: {
    name: 'Sonarr',
    purpose: 'Show downloads, versions and audio languages',
    keyHelp: 'Settings → General → Security → API Key',
    defaultUrl: 'http://host.docker.internal:8989',
    usesKey: true,
  },
  bazarr: {
    name: 'Bazarr',
    purpose: 'Subtitles in any language',
    keyHelp: 'Settings → General → Security → API Key',
    defaultUrl: 'http://host.docker.internal:6767',
    usesKey: true,
  },
  qbittorrent: {
    name: 'qBittorrent',
    purpose: 'Live download speed (optional)',
    keyHelp: 'Your WebUI login. Leave empty if the WebUI skips authentication on your network.',
    defaultUrl: 'http://host.docker.internal:8080',
    usesKey: false,
    usesLogin: true,
  },
  mdblist: {
    name: 'MDBList',
    purpose: 'Letterboxd and Metacritic scores (optional)',
    keyHelp: 'Free: sign in at mdblist.com → Preferences → API key',
    fixedUrl: true,
    usesKey: true,
  },
  trakt: {
    name: 'Trakt',
    purpose: 'Recommendations and a watch history for the server (optional)',
    keyHelp:
      'Needs Trakt VIP: Trakt only lets VIP accounts create API apps. On trakt.tv open Settings → Your API Apps → New Application, give it any name and the redirect URI urn:ietf:wg:oauth:2.0:oob, and save. Paste its Client ID and Client Secret here, then link the account below.',
    fixedUrl: true,
    usesKey: true,
    usesSecret: true,
    keyLabel: 'Client ID',
    secretLabel: 'Client secret',
  },
};

const IDS = Object.keys(SERVICES) as ServiceId[];

/**
 * Printed in the container log at startup. Lets whoever runs the server change
 * the Jellyfin address from the sign-in screen if it's wrong (otherwise nobody
 * could sign in to fix it).
 */
export const SETUP_CODE = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');
const FILE = path.join(config.dataDir, 'connections.json');

type Live = { url?: string; apiKey?: string; username?: string; password?: string };
const live = (id: ServiceId): Live => config[id] as Live;

/** What the stack gave us at startup, so "Reset" can go back to it. */
const fromStack = Object.fromEntries(IDS.map((id) => [id, { ...live(id) }])) as Record<ServiceId, Live>;

function load(): Partial<Record<ServiceId, Stored>> {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

let saved = load();

function apply() {
  for (const id of IDS) {
    const value = saved[id] ?? fromStack[id];
    const target = live(id);
    if (!SERVICES[id].fixedUrl) target.url = value.url || undefined;
    if ('apiKey' in target || SERVICES[id].usesKey) target.apiKey = value.apiKey || undefined;
    if (SERVICES[id].usesLogin) target.username = value.username || undefined;
    if (SERVICES[id].usesLogin || SERVICES[id].usesSecret) target.password = value.password || undefined;
  }
}
apply();

const listeners: Array<(id: ServiceId) => void> = [];
/** Caches that depend on a service (sessions, library index…) reset themselves here. */
export function onConnectionChange(fn: (id: ServiceId) => void) {
  listeners.push(fn);
}

function persist() {
  writeJson(FILE, saved, 0o600); // API keys: readable only by Netfish
}

export function normalizeUrl(input: string | undefined): string | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HttpError(400, t('"{value}" isn\'t a valid address', { value }));
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

// Only ever show the last 4 characters, and only of keys long enough that 4 reveals nothing useful.
const hint = (secret?: string) => (secret && secret.length >= 12 ? `…${secret.slice(-4)}` : secret ? "set" : undefined);

export function listConnections(): ServiceConnection[] {
  return IDS.map((id) => {
    const meta = SERVICES[id];
    const value = live(id);
    return {
      id,
      name: meta.name,
      purpose: t(meta.purpose),
      keyHelp: meta.keyHelp && t(meta.keyHelp),
      required: Boolean(meta.required),
      url: meta.fixedUrl ? undefined : value.url,
      defaultUrl: meta.defaultUrl,
      fixedUrl: meta.fixedUrl,
      usesKey: meta.usesKey,
      usesLogin: Boolean(meta.usesLogin),
      usesSecret: meta.usesSecret,
      keyLabel: meta.keyLabel && t(meta.keyLabel),
      secretLabel: meta.secretLabel && t(meta.secretLabel),
      hasKey: Boolean(value.apiKey),
      keyHint: hint(value.apiKey),
      username: value.username,
      hasPassword: Boolean(value.password),
      source: saved[id] ? 'app' : (!meta.fixedUrl && fromStack[id].url) || fromStack[id].apiKey || fromStack[id].username ? 'stack' : 'none',
    };
  });
}

function requireId(id: string): ServiceId {
  if (!IDS.includes(id as ServiceId)) throw new HttpError(404, t('Unknown service "{id}"', { id }));
  return id as ServiceId;
}

/** Current values with an update applied on top (not saved). */
function candidate(id: ServiceId, update: ServiceConnectionUpdate): Live {
  const current = live(id);
  const pick = (next: string | undefined, now: string | undefined) => (next === undefined ? now : next.trim() || undefined);
  return {
    url: SERVICES[id].fixedUrl ? current.url : update.url === undefined ? current.url : normalizeUrl(update.url),
    apiKey: pick(update.apiKey, current.apiKey),
    username: pick(update.username, current.username),
    password: update.password === undefined ? current.password : update.password || undefined,
  };
}

export function updateConnection(rawId: string, update: ServiceConnectionUpdate = {}): ServiceConnection {
  const id = requireId(rawId);
  const next = candidate(id, update);
  if (id === 'jellyfin' && !next.url) throw new HttpError(400, t('Jellyfin needs an address: Netfish signs people in through it'));
  const previous = saved;
  saved = { ...saved, [id]: { url: SERVICES[id].fixedUrl ? undefined : next.url, apiKey: next.apiKey, username: next.username, password: next.password } };
  try {
    persist();
  } catch (err) {
    saved = previous;
    throw err;
  }
  apply();
  listeners.forEach((fn) => fn(id));
  return listConnections().find((c) => c.id === id)!;
}

export function resetConnection(rawId: string): ServiceConnection {
  const id = requireId(rawId);
  const { [id]: _removed, ...rest } = saved;
  const previous = saved;
  saved = rest;
  try {
    persist();
  } catch (err) {
    saved = previous;
    throw err;
  }
  apply();
  listeners.forEach((fn) => fn(id));
  return listConnections().find((c) => c.id === id)!;
}

// ---------- Testing a connection (before or after saving) ----------

async function probe(id: ServiceId, c: Live): Promise<ConnectionTest> {
  const meta = SERVICES[id];
  if (!meta.fixedUrl && !c.url) return { ok: false, error: t('Add an address first') };
  const key = c.apiKey ?? '';
  switch (id) {
    case 'jellyfin': {
      const info = await request<{ ServerName: string; Version: string }>('Jellyfin', c.url!, '/System/Info/Public', { timeoutMs: 6000 });
      if (key) await request('Jellyfin', c.url!, '/System/Info', { headers: { authorization: `MediaBrowser Token="${key}"` }, timeoutMs: 6000 });
      return { ok: true, version: info.Version, detail: `${info.ServerName}${key ? ` · ${t('API key accepted')}` : ''}` };
    }
    case 'seerr': {
      if (!key) return { ok: false, error: t('Add the API key') };
      const status = await request<{ version: string }>('Seerr', `${c.url}/api/v1`, '/status', { headers: { 'x-api-key': key }, timeoutMs: 6000 });
      await request('Seerr', `${c.url}/api/v1`, '/auth/me', { headers: { 'x-api-key': key }, timeoutMs: 6000 });
      return { ok: true, version: status.version };
    }
    case 'radarr':
    case 'sonarr': {
      if (!key) return { ok: false, error: t('Add the API key') };
      const status = await request<{ version: string; appName?: string }>(meta.name, `${c.url}/api/v3`, '/system/status', {
        headers: { 'x-api-key': key },
        timeoutMs: 6000,
      });
      if (status.appName && status.appName.toLowerCase() !== id) return { ok: false, error: t('That address is {app}, not {name}', { app: status.appName, name: meta.name }) };
      return { ok: true, version: status.version };
    }
    case 'bazarr': {
      if (!key) return { ok: false, error: t('Add the API key') };
      const status = await request<{ data?: { bazarr_version?: string } }>('Bazarr', `${c.url}/api`, '/system/status', {
        headers: { 'x-api-key': key },
        timeoutMs: 6000,
      });
      return { ok: true, version: status.data?.bazarr_version };
    }
    case 'qbittorrent': {
      let cookie = '';
      if (c.username) {
        const res = await fetch(`${c.url}/api/v2/auth/login`, {
          method: 'POST',
          body: new URLSearchParams({ username: c.username, password: c.password ?? '' }),
          signal: AbortSignal.timeout(6000),
        });
        cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
        if (!res.ok || !cookie) return { ok: false, error: t('Wrong username or password') };
      }
      const res = await fetch(`${c.url}/api/v2/app/version`, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(6000) });
      if (res.status === 403) return { ok: false, error: t('qBittorrent wants a username and password') };
      if (!res.ok) return { ok: false, error: t('qBittorrent answered {status}', { status: res.status }) };
      return { ok: true, version: await res.text() };
    }
    case 'mdblist': {
      if (!key) return { ok: false, error: t('Add the API key') };
      const me = await request<{ api_requests?: number; api_requests_count?: number }>('MDBList', config.mdblist.url, '/user', {
        query: { apikey: key },
        timeoutMs: 8000,
      });
      return { ok: true, detail: me.api_requests ? `${me.api_requests_count ?? 0} of ${me.api_requests} lookups used today` : undefined };
    }
    case 'trakt': {
      if (!key) return { ok: false, error: t('Add the Client ID') };
      if (!c.password) return { ok: false, error: t('Add the Client secret') };
      return traktCheck(key, c.password);
    }
  }
}

export async function testConnection(rawId: string, update?: ServiceConnectionUpdate): Promise<ConnectionTest> {
  const id = requireId(rawId);
  try {
    return await probe(id, update ? candidate(id, update) : live(id));
  } catch (err) {
    const e = err as Error & { status?: number };
    const rejected = id === 'trakt' ? t('{name} rejected the Client ID', { name: SERVICES[id].name }) : t('{name} rejected the API key', { name: SERVICES[id].name });
    const message = e.status === 401 || e.status === 403 ? rejected : e.message;
    return { ok: false, error: message };
  }
}
