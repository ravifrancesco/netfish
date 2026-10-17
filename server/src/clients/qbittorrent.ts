import { config, has } from '../config';
import { onConnectionChange } from '../connections';
import { UpstreamError } from '../lib/upstream';

/**
 * qBittorrent is optional: Radarr/Sonarr already report progress, qBit adds
 * live speed and a better ETA. Cookie auth (or none, if the WebUI bypasses
 * auth for the local network).
 */

export interface Torrent {
  hash: string;
  name: string;
  progress: number;
  dlspeed: number;
  eta: number;
  state: string;
  num_seeds: number;
  /** Downloading front to back. */
  seq_dl?: boolean;
}

let cookie: string | undefined;
onConnectionChange((id) => id === 'qbittorrent' && (cookie = undefined));

async function login(): Promise<void> {
  const { url, username, password } = config.qbittorrent;
  if (!username) return;
  const res = await fetch(`${url}/api/v2/auth/login`, {
    method: 'POST',
    body: new URLSearchParams({ username, password: password ?? '' }),
    signal: AbortSignal.timeout(5000),
  });
  const set = res.headers.get('set-cookie');
  if (!res.ok || !set) throw new UpstreamError('qBittorrent', res.status, 'qBittorrent: login failed');
  cookie = set.split(';')[0];
}

async function get<T>(path: string, retry = true): Promise<T> {
  if (!has.qbittorrent()) throw new UpstreamError('qBittorrent', 503, 'qBittorrent is not configured');
  if (!cookie && config.qbittorrent.username) await login();
  let res: Response;
  try {
    res = await fetch(`${config.qbittorrent.url}${path}`, {
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new UpstreamError('qBittorrent', 502, `qBittorrent is unreachable (${(err as Error).message})`);
  }
  if (res.status === 403 && retry && config.qbittorrent.username) {
    cookie = undefined;
    return get<T>(path, false);
  }
  if (!res.ok) throw new UpstreamError('qBittorrent', res.status, `qBittorrent: ${res.status} ${res.statusText}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

async function post(path: string, form: Record<string, string>, retry = true): Promise<Response> {
  if (!has.qbittorrent()) throw new UpstreamError('qBittorrent', 503, 'qBittorrent is not configured');
  if (!cookie && config.qbittorrent.username) await login();
  let res: Response;
  try {
    res = await fetch(`${config.qbittorrent.url}${path}`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new UpstreamError('qBittorrent', 502, `qBittorrent is unreachable (${(err as Error).message})`);
  }
  if (res.status === 403 && retry && config.qbittorrent.username) {
    cookie = undefined;
    return post(path, form, false);
  }
  return res;
}

/** qBittorrent 5 says stop/start; 4 said pause/resume. */
async function either(paths: [string, string], form: Record<string, string>) {
  const res = await post(paths[0], form);
  if (res.status === 404) return post(paths[1], form);
  return res;
}

export const qbittorrent = {
  version: () => get<string>('/api/v2/app/version'),
  torrents: () => get<Torrent[]>('/api/v2/torrents/info?filter=all'),
  stop: (hashes: string[]) => either(['/api/v2/torrents/stop', '/api/v2/torrents/pause'], { hashes: hashes.join('|') }),
  start: (hashes: string[]) => either(['/api/v2/torrents/start', '/api/v2/torrents/resume'], { hashes: hashes.join('|') }),
  /** Bytes a second, each (0: no limit). */
  limit: (hashes: string[], bytesPerSecond: number) =>
    post('/api/v2/torrents/setDownloadLimit', { hashes: hashes.join('|'), limit: String(Math.max(0, Math.round(bytesPerSecond))) }),
  /** To the back of the queue (when qBittorrent queues downloads). */
  last: (hashes: string[]) => post('/api/v2/torrents/bottomPrio', { hashes: hashes.join('|') }),
  /** Front to back (a whole season in one download: its episodes in order), for those not already. */
  inOrder: async (hashes: string[]) => {
    const want = new Set(hashes);
    const off = (await get<Torrent[]>('/api/v2/torrents/info?filter=all')).filter((x) => want.has(x.hash.toLowerCase()) && !x.seq_dl).map((x) => x.hash);
    if (off.length) await post('/api/v2/torrents/toggleSequentialDownload', { hashes: off.join('|') });
  },
};
