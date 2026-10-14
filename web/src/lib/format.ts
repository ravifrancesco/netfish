import type { Availability, Card, DownloadState } from '@netfish/shared';
import { locale, t } from '../i18n';

/** A number with a fixed count of decimals, written the local way (7.5 / 7,5). */
export const decimal = (n: number, digits = 1) =>
  n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });

export function bytes(n?: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${decimal(n / 1024 ** i, i >= 3 ? 1 : 0)} ${units[i]}`;
}

export function duration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return t('{h}h {m}m', { h, m });
  if (m) return t('{m} min', { m });
  return t('{s}s', { s });
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
  if (diff < 60) return t('just now');
  if (diff < 3600) return t('{n} min ago', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('{n} h ago', { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 30) return t('{n} d ago', { n: Math.floor(diff / 86400) });
  return new Date(iso).toLocaleDateString(locale);
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: t('In your library'),
  partial: t('Partly in your library'),
  processing: t('On its way'),
  pending: t('Requested'),
  none: t('Not in your library'),
};

export const DOWNLOAD_LABEL: Record<DownloadState, string> = {
  downloading: t('Downloading'),
  queued: t('Queued'),
  paused: t('Paused'),
  stalled: t('Stalled'),
  importing: t('Adding to library'),
  warning: t('Needs attention'),
  failed: t('Failed'),
};

export function titleHref(card: Pick<Card, 'mediaType' | 'tmdbId' | 'jellyfinId'>): string {
  if (card.tmdbId) return `/title/${card.mediaType}/${card.tmdbId}`;
  return `/title/jf/${card.jellyfinId}`;
}
