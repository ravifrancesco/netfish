import { infiniteQueryOptions, queryOptions, useQuery } from '@tanstack/react-query';
import type { PhotosPage } from '@netfish/shared';
import { api } from '../api';

/** The top of Photos (the libraries, or what's in the only one): for the menu and Home. */
export const photosTopQuery = queryOptions({ queryKey: ['photos', ''], queryFn: () => api.photos(), staleTime: 10 * 60_000 });
export const usePhotosTop = () => useQuery(photosTopQuery);

/** Any photo library at all (Jellyfin's Photos or Home videos) with something in it. */
export const hasPhotos = (top?: PhotosPage): top is PhotosPage => Boolean(top && (top.folders.length || top.photos.length));

/** A folder (or the top), a page at a time; the top is kept while Netfish is open, so it's there at once (lib/preload.ts). */
export const photosQuery = (id = '') =>
  infiniteQueryOptions({
    queryKey: ['photos', id, 'pages'],
    queryFn: ({ pageParam }) => api.photos(id || undefined, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.photos.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    ...(id ? {} : { gcTime: Infinity }),
  });
