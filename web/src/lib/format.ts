import type { Availability, Card, DownloadState } from '@netfish/shared';

export function bytes(n?: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

export function duration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m} min`;
  return `${s}s`;
}

/** 1:02:03 / 4:05 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const percent = (p?: number) => `${Math.round((p ?? 0) * 100)}%`;

export function ago(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'In your library',
  partial: 'Partly in your library',
  processing: 'On its way',
  pending: 'Requested',
  none: 'Not in your library',
};

export const DOWNLOAD_LABEL: Record<DownloadState, string> = {
  downloading: 'Downloading',
  queued: 'Queued',
  paused: 'Paused',
  stalled: 'Stalled',
  importing: 'Adding to library',
  warning: 'Needs attention',
  failed: 'Failed',
};

export function titleHref(card: Pick<Card, 'mediaType' | 'tmdbId' | 'jellyfinId'>): string {
  if (card.tmdbId) return `/title/${card.mediaType}/${card.tmdbId}`;
  return `/title/jf/${card.jellyfinId}`;
}
