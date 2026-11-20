import { useQuery } from '@tanstack/react-query';
import type { PhotosPage } from '@netfish/shared';
import { api } from '../api';

/** The top of Photos (the libraries, or what's in the only one): for the menu and Home. */
export const usePhotosTop = () => useQuery({ queryKey: ['photos', ''], queryFn: () => api.photos(), staleTime: 10 * 60_000 });

/** Any photo library at all (Jellyfin's Photos or Home videos) with something in it. */
export const hasPhotos = (top?: PhotosPage): top is PhotosPage => Boolean(top && (top.folders.length || top.photos.length));
