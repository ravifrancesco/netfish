import { config } from '../config';
import { buildQuery } from './upstream';

/** Path prefix under which Netfish proxies Jellyfin (images, streams, subtitles). */
export const JF_PREFIX = '/jellyfin';

export function tmdbImage(path: string | null | undefined, size: 'w185' | 'w300' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original') {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${config.tmdbImageBase}/${size}${path}`;
}

export function jfImage(
  itemId: string | undefined,
  type: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo',
  tag: string | undefined,
  opts: { maxWidth?: number; maxHeight?: number; index?: number } = {},
) {
  if (!itemId || !tag) return undefined;
  const index = opts.index !== undefined ? `/${opts.index}` : '';
  return `${JF_PREFIX}/Items/${itemId}/Images/${type}${index}${buildQuery({
    tag,
    maxWidth: opts.maxWidth,
    maxHeight: opts.maxHeight,
    quality: 90,
  })}`;
}

/** The poster size every card uses (one size, so one cached copy per title). */
export const jfPoster = (itemId: string | undefined, tag: string | undefined) => jfImage(itemId, 'Primary', tag, { maxHeight: 480 });
