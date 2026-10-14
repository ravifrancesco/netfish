import type { MediaType } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin } from '../clients/jellyfin';
import { onConnectionChange } from '../connections';
import { MINUTE, TTLCache } from '../lib/cache';
import { warmImages } from '../lib/imageCache';
import { jfPoster } from '../lib/images';

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
onConnectionChange((id) => id === 'jellyfin' && indexes.clear());

const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export function libraryIndex(user: SessionUser): Promise<LibraryIndex> {
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

/** Call after something lands in the library so cards flip to "Play" quickly. */
export function invalidateLibrary() {
  indexes.clear();
}
