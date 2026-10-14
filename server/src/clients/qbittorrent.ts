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

export const qbittorrent = {
  version: () => get<string>('/api/v2/app/version'),
  torrents: () => get<Torrent[]>('/api/v2/torrents/info?filter=all'),
};
