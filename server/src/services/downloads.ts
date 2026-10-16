import type { DownloadItem, DownloadState } from '@netfish/shared';
import { has } from '../config';
import { posterOf, radarr, sonarr, type ArrQueueRecord } from '../clients/arr';
import { qbittorrent, type Torrent } from '../clients/qbittorrent';
import { onConnectionChange } from '../connections';
import { SECOND, TTLCache } from '../lib/cache';
import { languageLabel } from '../lib/languages';
import { lang, t } from '../lib/i18n';
import { getSettings } from '../settings';
import { freshHidden } from './fresh';

/**
 * Live download state, straight from Radarr/Sonarr's queues (and qBittorrent
 * for speed). Shared by everyone and cached for a few seconds so polling
 * clients don't hammer the Pi.
 */

const cache = new TTLCache<DownloadItem[]>(4);
onConnectionChange(() => cache.clear());
/** After stopping a download, so lists don't show it for another few seconds. */
export const forgetDownloads = () => cache.clear();

function parseTimeleft(t?: string): number | undefined {
  if (!t) return undefined;
  const m = t.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
  if (!m) return undefined;
  const [, d = '0', h, min, s] = m;
  return Number(d) * 86400 + Number(h) * 3600 + Number(min) * 60 + Number(s);
}

function stateOf(r: ArrQueueRecord, torrent?: Torrent): { state: DownloadState; message?: string } {
  const messages = (r.statusMessages ?? []).flatMap((m) => m.messages ?? []).filter(Boolean);
  const message = r.errorMessage || messages[0];
  const tracked = r.trackedDownloadState;
  if (tracked === 'importPending' || tracked === 'importing') return { state: 'importing' };
  if (tracked === 'importBlocked') return { state: 'warning', message: message ?? t('Downloaded, but the import needs attention') };
  if (tracked === 'failed' || tracked === 'failedPending' || r.status === 'failed') return { state: 'failed', message };
  if (r.status === 'completed') return { state: 'importing' };
  if (r.status === 'paused') return { state: 'paused' };
  if (r.status === 'queued' || r.status === 'delay') return { state: 'queued', message };
  if (torrent && /^(stalledDL|metaDL)$/.test(torrent.state)) return { state: 'stalled', message: message ?? t('Waiting for peers') };
  if (r.trackedDownloadStatus === 'warning') return { state: 'stalled', message };
  if (r.trackedDownloadStatus === 'error' || r.status === 'warning') return { state: 'warning', message };
  return { state: 'downloading', message };
}

function base(r: ArrQueueRecord, torrents: Map<string, Torrent>) {
  const torrent = r.downloadId ? torrents.get(r.downloadId.toLowerCase()) : undefined;
  const size = Number(r.size) || 0;
  const sizeLeft = Number(r.sizeleft) || 0;
  const progress = torrent ? torrent.progress : size > 0 ? Math.max(0, Math.min(1, 1 - sizeLeft / size)) : 0;
  const qbitEta = torrent && torrent.eta > 0 && torrent.eta < 8_640_000 ? torrent.eta : undefined;
  const { state, message } = stateOf(r, torrent);
  return {
    progress,
    size,
    sizeLeft,
    etaSeconds: state === 'downloading' ? (qbitEta ?? parseTimeleft(r.timeleft)) : undefined,
    speed: torrent?.dlspeed || undefined,
    state,
    message,
    quality: r.quality?.quality?.name,
    languages: (r.languages ?? []).map((l) => languageLabel(l.name) ?? l.name).filter((l) => l !== 'Unknown'),
    releaseTitle: r.title,
    customFormats: r.customFormats?.map((f) => f.name),
    customFormatScore: r.customFormatScore,
    indexer: r.indexer || undefined,
    downloadClient: r.downloadClient || undefined,
    protocol: r.protocol,
  };
}

/** A download as someone sees it: all of it for admins, the details an admin picked for everyone else. */
export function detailsFor(isAdmin: boolean, d: DownloadItem): DownloadItem {
  if (isAdmin) return d;
  const shown = new Set(getSettings().downloadDetails);
  const formats = shown.has('formats');
  const client = shown.has('client');
  return {
    ...d,
    quality: shown.has('quality') ? d.quality : undefined,
    languages: shown.has('languages') ? d.languages : [],
    releaseTitle: shown.has('release') ? d.releaseTitle : undefined,
    customFormats: formats ? d.customFormats : undefined,
    customFormatScore: formats ? d.customFormatScore : undefined,
    indexer: shown.has('indexer') ? d.indexer : undefined,
    downloadClient: client ? d.downloadClient : undefined,
    protocol: client ? d.protocol : undefined,
  };
}

function fromRadarr(records: ArrQueueRecord[], torrents: Map<string, Torrent>): DownloadItem[] {
  return records.map((r) => ({
    id: `radarr-${r.id}`,
    source: 'radarr',
    mediaType: 'movie',
    tmdbId: r.movie?.tmdbId,
    title: r.movie?.title ?? r.title ?? t('Unknown movie'),
    detail: r.movie?.year ? String(r.movie.year) : undefined,
    poster: posterOf(r.movie?.images),
    mine: false,
    ...base(r, torrents),
  }));
}

function fromSonarr(records: ArrQueueRecord[], torrents: Map<string, Torrent>): DownloadItem[] {
  // A season pack shows up once per episode; collapse it back into one download.
  const groups = new Map<string, ArrQueueRecord[]>();
  for (const r of records) {
    const key = r.downloadId ?? `id-${r.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((group) => {
    const r = group[0];
    const episodes = group
      .map((g) => g.episode?.episodeNumber)
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b);
    const season = r.episode?.seasonNumber ?? r.seasonNumber;
    const pad = (n?: number) => String(n ?? 0).padStart(2, '0');
    const detail =
      episodes.length > 1
        ? `S${pad(season)} · ${episodes.length} episodes`
        : r.episode
          ? `S${pad(season)}E${pad(r.episode.episodeNumber)}${r.episode.title ? ` · ${r.episode.title}` : ''}`
          : undefined;
    return {
      id: `sonarr-${r.downloadId ?? r.id}`,
      source: 'sonarr',
      mediaType: 'tv',
      tmdbId: r.series?.tmdbId || undefined,
      tvdbId: r.series?.tvdbId,
      title: r.series?.title ?? r.title ?? t('Unknown show'),
      detail,
      seasonNumber: season,
      episodes,
      poster: posterOf(r.series?.images),
      mine: false,
      ...base(r, torrents),
    } satisfies DownloadItem;
  });
}

const ORDER: Record<DownloadState, number> = {
  downloading: 0,
  stalled: 1,
  importing: 2,
  warning: 3,
  queued: 4,
  paused: 5,
  failed: 6,
};

/** All active downloads (not the new titles brought in for channels). Never throws: a dead service just contributes nothing. */
export async function allDownloads(): Promise<DownloadItem[]> {
  const items = await everyDownload();
  const fresh = freshHidden();
  return fresh.size ? items.filter((d) => !d.tmdbId || !fresh.has(`${d.mediaType}-${d.tmdbId}`)) : items;
}

function everyDownload(): Promise<DownloadItem[]> {
  // Kept per language: the list carries messages and language names for people.
  return cache.wrap(`all:${lang()}`, 3 * SECOND, async () => {
    const [movies, shows, torrents] = await Promise.allSettled([
      has.radarr() ? radarr.queue() : Promise.resolve({ records: [] }),
      has.sonarr() ? sonarr.queue() : Promise.resolve({ records: [] }),
      has.qbittorrent() ? qbittorrent.torrents() : Promise.resolve([] as Torrent[]),
    ]);
    const byHash = new Map<string, Torrent>(
      (torrents.status === 'fulfilled' ? torrents.value : []).map((t) => [t.hash.toLowerCase(), t]),
    );
    const items = [
      ...(movies.status === 'fulfilled' ? fromRadarr(movies.value.records, byHash) : []),
      ...(shows.status === 'fulfilled' ? fromSonarr(shows.value.records, byHash) : []),
    ];
    return items.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.progress - a.progress);
  });
}

export function downloadsFor(items: DownloadItem[], mediaType: 'movie' | 'tv', tmdbId?: number, tvdbId?: number) {
  return items.filter(
    (d) => d.mediaType === mediaType && ((tmdbId && d.tmdbId === tmdbId) || (tvdbId && d.tvdbId === tvdbId)),
  );
}

/** Average progress per title, for the little bars on cards. */
export function progressByTitle(items: DownloadItem[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const d of items) {
    if (!d.tmdbId) continue;
    const key = `${d.mediaType}-${d.tmdbId}`;
    const s = sums.get(key) ?? { total: 0, n: 0 };
    sums.set(key, { total: s.total + d.progress, n: s.n + 1 });
  }
  return new Map([...sums].map(([k, s]) => [k, s.total / s.n]));
}
