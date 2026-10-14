import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { authHeader } from '../clients/jellyfin';
import { config } from '../config';
import { JF_PREFIX } from './images';

/**
 * Jellyfin artwork, kept on Netfish's own disk. A tagged image URL never
 * changes content (Jellyfin gives a picture a new tag when it changes), so a
 * stored copy is good forever, and browsers and the apps may keep it forever
 * too. The first view of a poster costs the Pi one resize; every later one is
 * a file read. Library posters are fetched ahead of time in the background.
 */

const DIR = () => path.join(config.dataDir, 'cache', 'images');
const LIMIT = (Number(process.env.IMAGE_CACHE_MB) || 1024) * 1024 * 1024;
const WARM_CONCURRENCY = 2;

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const TYPE: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([type, ext]) => [ext, type]));

interface Entry {
  file: string;
  type: string;
  size: number;
  used: number;
}

const index = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | undefined>>();
let total = 0;
let loaded = false;
let disabled = false;

/** `/Items/{id}/Images/{type}…?tag=…` (relative to the Jellyfin prefix), without per-user keys. */
export const isCacheableImage = (pathAndQuery: string) =>
  /^\/Items\/[^/]+\/Images\/[^?]+\?(.*&)?tag=[^&]+/i.test(pathAndQuery) && !/[?&]api_?key=/i.test(pathAndQuery);

const keyOf = (pathAndQuery: string) => crypto.createHash('sha1').update(pathAndQuery).digest('hex');

function load() {
  if (loaded) return;
  loaded = true;
  try {
    for (const name of fs.readdirSync(DIR())) {
      const full = path.join(DIR(), name);
      const match = /^([0-9a-f]{40})\.(\w+)$/.exec(name);
      if (!match || !TYPE[match[2]]) {
        fs.rmSync(full, { force: true }); // a half-written file from a crash
        continue;
      }
      const stat = fs.statSync(full);
      index.set(match[1], { file: full, type: TYPE[match[2]], size: stat.size, used: stat.mtimeMs });
      total += stat.size;
    }
  } catch {
    /* nothing cached yet */
  }
}

function prune() {
  if (total <= LIMIT) return;
  for (const [key, entry] of [...index].sort((a, b) => a[1].used - b[1].used)) {
    fs.rmSync(entry.file, { force: true });
    index.delete(key);
    total -= entry.size;
    if (total < LIMIT * 0.9) break;
  }
}

async function fetchAndStore(key: string, pathAndQuery: string, token?: string): Promise<Entry | undefined> {
  if (!config.jellyfin.url) return undefined;
  const base = new URL(config.jellyfin.url);
  const url = new URL(base.pathname.replace(/\/$/, '') + pathAndQuery, base.origin);
  const headers: Record<string, string> = { accept: 'image/webp,image/*;q=0.8' };
  if (token) headers.authorization = authHeader(token);
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !EXT[type]) return undefined;
  const body = Buffer.from(await res.arrayBuffer());
  const file = path.join(DIR(), `${key}.${EXT[type]}`);
  try {
    fs.mkdirSync(DIR(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  } catch {
    disabled = true; // data folder not writable: fall back to plain proxying
    return undefined;
  }
  const entry = { file, type, size: body.length, used: Date.now() };
  index.set(key, entry);
  total += body.length;
  prune();
  return entry;
}

/** The stored copy of a Jellyfin image, fetching it first if needed. Undefined: proxy it as usual. */
export async function cachedImage(pathAndQuery: string, token?: string): Promise<Entry | undefined> {
  if (disabled || !isCacheableImage(pathAndQuery)) return undefined;
  load();
  const key = keyOf(pathAndQuery);
  const hit = index.get(key);
  if (hit) {
    hit.used = Date.now();
    if (fs.existsSync(hit.file)) return hit;
    index.delete(key);
    total -= hit.size;
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchAndStore(key, pathAndQuery, token)
      .catch(() => undefined)
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

// ---------- Fetching ahead ----------

const queue: { pathAndQuery: string; token?: string }[] = [];
const queued = new Set<string>();
let running = 0;

function pump() {
  while (running < WARM_CONCURRENCY && queue.length) {
    const next = queue.shift()!;
    running++;
    void cachedImage(next.pathAndQuery, next.token).finally(() => {
      running--;
      queued.delete(next.pathAndQuery);
      pump();
    });
  }
}

/** Fetch these image URLs (as handed to clients) into the cache in the background, two at a time. */
export function warmImages(urls: (string | undefined)[], token?: string) {
  if (disabled || !config.jellyfin.url) return;
  load();
  for (const url of urls) {
    if (!url?.startsWith(`${JF_PREFIX}/`)) continue;
    const pathAndQuery = url.slice(JF_PREFIX.length);
    if (queued.has(pathAndQuery) || !isCacheableImage(pathAndQuery) || index.has(keyOf(pathAndQuery))) continue;
    queued.add(pathAndQuery);
    queue.push({ pathAndQuery, token });
  }
  pump();
}

export function imageCacheStats() {
  load();
  return { files: index.size, bytes: total, limit: LIMIT, queued: queue.length };
}
