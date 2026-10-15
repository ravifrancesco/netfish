import type { Availability, Card, MediaType } from '@netfish/shared';
import type { JfItem } from '../clients/jellyfin';
import { MediaStatus, type SeerrMediaInfo, type SeerrResult } from '../clients/seerr';
import { jfImage, jfPoster, tmdbImage } from '../lib/images';
import { findInLibrary, type LibraryIndex } from './library';

export function availabilityFromSeerr(status?: number): Availability {
  switch (status) {
    case MediaStatus.AVAILABLE:
      return 'available';
    case MediaStatus.PARTIALLY_AVAILABLE:
      return 'partial';
    case MediaStatus.PROCESSING:
      return 'processing';
    case MediaStatus.PENDING:
      return 'pending';
    default:
      return 'none';
  }
}

/** Seerr's view, corrected by what Jellyfin actually has. */
export function resolveAvailability(mediaInfo: SeerrMediaInfo | undefined, inLibrary: boolean): Availability {
  const fromSeerr = availabilityFromSeerr(mediaInfo?.status);
  if (!inLibrary) return fromSeerr;
  return fromSeerr === 'partial' ? 'partial' : 'available';
}

const yearOf = (date?: string | null) => (date ? Number(date.slice(0, 4)) || undefined : undefined);

/** Download progress per `${mediaType}-${tmdbId}`, merged into cards when present. */
export type ProgressMap = Map<string, number>;

export function seerrToCard(r: SeerrResult, index?: LibraryIndex, progress?: ProgressMap): Card | undefined {
  if (r.mediaType !== 'movie' && r.mediaType !== 'tv') return undefined;
  const mediaType: MediaType = r.mediaType;
  const entry = index ? findInLibrary(index, mediaType, r.id, r.mediaInfo?.tvdbId) : undefined;
  const key = `${mediaType}-${r.id}`;
  return {
    key,
    mediaType,
    tmdbId: r.id,
    jellyfinId: entry?.id,
    title: (r.title ?? r.name ?? 'Untitled').trim(),
    year: yearOf(r.releaseDate ?? r.firstAirDate),
    overview: r.overview,
    poster: tmdbImage(r.posterPath, 'w342'),
    backdrop: tmdbImage(r.backdropPath, 'w1280'),
    rating: r.voteAverage || undefined,
    status: resolveAvailability(r.mediaInfo, Boolean(entry)),
    downloadProgress: progress?.get(key),
  };
}

export function seerrCards(results: SeerrResult[], index?: LibraryIndex, progress?: ProgressMap): Card[] {
  const seen = new Set<string>();
  const cards: Card[] = [];
  for (const r of results) {
    const card = seerrToCard(r, index, progress);
    if (!card || seen.has(card.key) || !card.poster) continue;
    seen.add(card.key);
    cards.push(card);
  }
  return cards;
}

function keyFor(mediaType: MediaType, itemId: string, index: LibraryIndex) {
  const entry = index.byId.get(itemId);
  return entry?.tmdbId ? { key: `${mediaType}-${entry.tmdbId}`, tmdbId: entry.tmdbId } : { key: `jf-${itemId}` };
}

/** A movie or series from the library. */
export function jfToCard(item: JfItem, index: LibraryIndex): Card {
  const mediaType: MediaType = item.Type === 'Series' ? 'tv' : 'movie';
  const tmdb = Number(item.ProviderIds?.Tmdb) || undefined;
  const { key, tmdbId } = tmdb ? { key: `${mediaType}-${tmdb}`, tmdbId: tmdb } : keyFor(mediaType, item.Id, index);
  return {
    key,
    mediaType,
    tmdbId,
    jellyfinId: item.Id,
    title: item.Name,
    year: item.ProductionYear,
    overview: item.Overview,
    poster: jfPoster(item.Id, item.ImageTags?.Primary),
    backdrop: jfImage(item.Id, 'Backdrop', item.BackdropImageTags?.[0], { maxWidth: 1280 }),
    thumb:
      jfImage(item.Id, 'Thumb', item.ImageTags?.Thumb, { maxWidth: 640 }) ??
      jfImage(item.Id, 'Backdrop', item.BackdropImageTags?.[0], { maxWidth: 640 }),
    rating: item.CommunityRating,
    runtimeMinutes: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600_000_000) || undefined : undefined,
    status: 'available',
  };
}

export const episodeLabel = (item: JfItem) =>
  item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
    ? `S${item.ParentIndexNumber}:E${item.IndexNumber}`
    : undefined;

/** Continue watching / next up: a movie or an episode, shown as a wide card that plays directly. */
export function jfPlayableCard(item: JfItem, index: LibraryIndex): Card {
  if (item.Type !== 'Episode') {
    const card = jfToCard(item, index);
    return { ...card, playItemId: item.Id, progress: (item.UserData?.PlayedPercentage ?? 0) / 100 || undefined };
  }
  const seriesId = item.SeriesId ?? item.Id;
  const { key, tmdbId } = keyFor('tv', seriesId, index);
  const label = episodeLabel(item);
  return {
    key,
    mediaType: 'tv',
    tmdbId,
    jellyfinId: seriesId,
    title: item.SeriesName ?? item.Name,
    subtitle: label ? `${label} · ${item.Name}` : item.Name,
    overview: item.Overview,
    poster: jfPoster(seriesId, item.SeriesPrimaryImageTag),
    thumb:
      jfImage(item.Id, 'Primary', item.ImageTags?.Primary, { maxWidth: 640 }) ??
      jfImage(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag, { maxWidth: 640 }) ??
      jfImage(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags?.[0], { maxWidth: 640 }),
    backdrop: jfImage(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags?.[0], { maxWidth: 1280 }),
    status: 'available',
    playItemId: item.Id,
    progress: (item.UserData?.PlayedPercentage ?? 0) / 100 || undefined,
  };
}
