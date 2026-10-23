import type { ServerUpdate } from '@netfish/shared';
import { config } from '../config';
import { HOUR } from '../lib/cache';
import { log } from '../lib/log';

/**
 * Is there a newer Netfish than this server? GitHub's latest release, asked soon after starting
 * and every six hours (as the apps do for themselves). Admins see it in Settings, with how to
 * update the container. Development builds ("dev") are never behind.
 */

const RELEASES = process.env.NETFISH_RELEASES_URL ?? 'https://api.github.com/repos/ravifrancesco/netfish/releases/latest';
let latest: { version: string; url: string } | undefined;

/** "0.7.10" is newer than "0.7.9". */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

async function check() {
  if (config.version === 'dev') return;
  try {
    const res = await fetch(RELEASES, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `Netfish/${config.version} (server)` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;
    const release = (await res.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean };
    if (!release.tag_name || release.draft || release.prerelease) return;
    const version = release.tag_name.replace(/^v/i, '');
    // Said once for each new version.
    if (version !== latest?.version && newer(version, config.version)) log.info('updates', `Netfish ${version} is out (this server is ${config.version}): update the stack in Portainer`);
    latest = { version, url: release.html_url ?? '' };
  } catch {
    // Offline, or GitHub busy: the next check will do.
  }
}

setTimeout(() => void check(), 20_000).unref();
setInterval(() => void check(), 6 * HOUR).unref();

export function serverUpdate(): ServerUpdate {
  const ahead = latest && config.version !== 'dev' && newer(latest.version, config.version) ? latest : undefined;
  return { current: config.version, latest: ahead?.version, url: ahead?.url, newer: Boolean(ahead) };
}
