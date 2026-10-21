import type { MediaType } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin } from '../clients/jellyfin';
import { onConnectionChange } from '../connections';
import { MINUTE, TTLCache } from '../lib/cache';
import { warmImages } from '../lib/imageCache';
import { jfPoster } from '../lib/images';
import { freshHidden, onFreshChange } from './fresh';

/**
 * A per-user map of what's in the library, keyed by TMDB/TVDB id. This is how
 * a Seerr/TMDB result learns "you already have this, here's the Jellyfin id".
 * One cheap query (ids and poster tags) cached for a couple of minutes; any
 * poster not on Netfish's disk yet is fetched in the background.
 */

export interface LibraryEntry {
  id: string;
  mediaType: MediaType;
  name: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface LibraryIndex {
  byKey: Map<string, LibraryEntry>;
  byId: Map<string, LibraryEntry>;
  byTvdb: Map<number, LibraryEntry>;
}

const indexes = new TTLCache<LibraryIndex>(200);
const shown = new TTLCache<LibraryIndex>(200);
onConnectionChange((id) => id === 'jellyfin' && (indexes.clear(), shown.clear()));
// A new title for channels kept by someone joins the library; one deleted leaves it.
onFreshChange(() => shown.clear());

const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

/** The library as people see it: without the new titles brought in for channels (until someone keeps one). */
export function libraryIndex(user: SessionUser): Promise<LibraryIndex> {
  return shown.wrap(user.id, 2 * MINUTE, async () => {
    const all = await everything(user);
    const hidden = freshHidden();
    if (!hidden.size) return all;
    const index: LibraryIndex = { byKey: new Map(), byId: new Map(), byTvdb: new Map() };
    for (const entry of all.byId.values()) {
      if (entry.tmdbId && hidden.has(`${entry.mediaType}-${entry.tmdbId}`)) continue;
      index.byId.set(entry.id, entry);
      if (entry.tmdbId) index.byKey.set(`${entry.mediaType}-${entry.tmdbId}`, entry);
      if (entry.tvdbId && entry.mediaType === 'tv') index.byTvdb.set(entry.tvdbId, entry);
    }
    return index;
  });
}

/**
 * Jellyfin's ids for the new titles brought in for channels, for leaving them out of lists
 * (`excludeItemIds`). Undefined when there are none.
 */
export async function hiddenIds(user: SessionUser): Promise<string | undefined> {
  const hidden = freshHidden();
  if (!hidden.size) return undefined;
  const all = await everything(user);
  const ids = [...hidden].flatMap((key) => (all.byKey.has(key) ? [all.byKey.get(key)!.id] : []));
  return ids.length ? ids.join(',') : undefined;
}

function everything(user: SessionUser): Promise<LibraryIndex> {
  return indexes.wrap(user.id, 2 * MINUTE, async () => {
    const res = await jellyfin.items(user.token, {
      userId: user.id,
      includeItemTypes: 'Movie,Series',
      recursive: true,
      fields: 'ProviderIds',
      enableImageTypes: 'Primary',
      imageTypeLimit: 1,
      enableUserData: false,
    });
    warmImages(res.Items.map((item) => jfPoster(item.Id, item.ImageTags?.Primary)), user.token);
    const index: LibraryIndex = { byKey: new Map(), byId: new Map(), byTvdb: new Map() };
    for (const item of res.Items) {
      const mediaType: MediaType = item.Type === 'Series' ? 'tv' : 'movie';
      const entry: LibraryEntry = {
        id: item.Id,
        mediaType,
        name: item.Name,
        tmdbId: num(item.ProviderIds?.Tmdb),
        tvdbId: num(item.ProviderIds?.Tvdb),
      };
      index.byId.set(item.Id, entry);
      if (entry.tmdbId) index.byKey.set(`${mediaType}-${entry.tmdbId}`, entry);
      if (entry.tvdbId && mediaType === 'tv') index.byTvdb.set(entry.tvdbId, entry);
    }
    return index;
  });
}

export function findInLibrary(index: LibraryIndex, mediaType: MediaType, tmdbId?: number, tvdbId?: number) {
  return (
    (tmdbId ? index.byKey.get(`${mediaType}-${tmdbId}`) : undefined) ??
    (mediaType === 'tv' && tvdbId ? index.byTvdb.get(tvdbId) : undefined)
  );
}

/**
 * Whether Jellyfin has anything to play of a show. It keeps listing a show whose files were all
 * deleted while its folder is still there (Sonarr leaves it): a show with nothing in it.
 */
const filled = new TTLCache<boolean>(500);
export function showHasEpisodes(user: SessionUser, seriesId: string): Promise<boolean> {
  return filled.wrap(seriesId, 2 * MINUTE, async () => {
    const res = await jellyfin.episodes(user.token, user.id, seriesId, { isMissing: false, limit: 1 }).catch(() => undefined);
    // Jellyfin not answering: as it lists it.
    return !res || res.Items.length > 0;
  });
}

/**
 * Jellyfin's ids for every show it lists with no episodes in it (files deleted, folder left
 * behind), in one request: however they went (Netfish, Sonarr's own page, by hand).
 */
const hollow = new TTLCache<string[]>(200);
export function episodelessShows(user: SessionUser): Promise<string[]> {
  return hollow.wrap(user.id, MINUTE, async () => {
    const res = await jellyfin
      .items(user.token, { userId: user.id, includeItemTypes: 'Series', recursive: true, fields: 'RecursiveItemCount', enableImages: false })
      .catch(() => undefined);
    return (res?.Items ?? []).filter((i) => i.RecursiveItemCount === 0).map((i) => i.Id);
  });
}

/** Call after something lands in the library so cards flip to "Play" quickly. */
export function invalidateLibrary() {
  filled.clear();
  hollow.clear();
  indexes.clear();
  shown.clear();
}
