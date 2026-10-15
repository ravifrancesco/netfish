import type { MediaType, NotOut } from '@netfish/shared';
import { locale, t } from '../i18n';

/** "12 March", or "12 March 2027" when it isn't this year. */
export function outDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(thisYear ? {} : { year: 'numeric' }) });
}

/** Radarr's "Not Available" (or a show that hasn't started): nothing can download yet. */
export const isNotAvailable = (n?: NotOut) => Boolean(n && n.kind !== 'airing');

/**
 * Why nothing is downloading, and what happens next, for a title page. Radarr waits until
 * a movie can be streamed or bought, Sonarr until an episode has aired.
 */
export function notOutText(n: NotOut, mediaType: MediaType, requested: boolean): string {
  const date = n.date ? outDate(n.date) : undefined;
  const now = {
    cinemas: t('Only in cinemas for now.'),
    unreleased: date ? t('Comes out {date}.', { date }) : '',
    premiere: date ? t('Starts {date}.', { date }) : '',
    airing: date ? t('Next episode {date}.', { date }) : '',
  }[n.kind];
  let next: string;
  if (mediaType === 'movie') {
    if (!requested) next = t('Request it now and it downloads by itself once it can be streamed or bought.');
    else if (n.kind === 'cinemas' && date) next = t('It downloads by itself once it can be streamed or bought, expected {date}.', { date });
    else next = t('It downloads by itself once it can be streamed or bought.');
  } else if (n.kind === 'airing') {
    next = t('It downloads by itself after it airs.');
  } else {
    next = requested ? t('Episodes download by themselves as they air.') : t('Request it now and episodes download by themselves as they air.');
  }
  return [now, next].filter(Boolean).join(' ');
}

/** One line for lists (Activity), next to a "Not available" label. */
export function notOutShort(n: NotOut): string {
  const date = n.date ? outDate(n.date) : undefined;
  if (!date) return n.kind === 'cinemas' ? t('In cinemas only for now') : '';
  switch (n.kind) {
    case 'cinemas':
      return t('In cinemas · out to stream or buy {date}', { date });
    case 'unreleased':
      return t('Comes out {date}', { date });
    case 'premiere':
      return t('Starts {date}', { date });
    case 'airing':
      return t('Next episode {date}', { date });
  }
}
