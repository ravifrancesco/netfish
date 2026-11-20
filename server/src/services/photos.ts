import type { Photo, PhotosPage } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin, ticksToSeconds, type JfItemsResult } from '../clients/jellyfin';
import { MINUTE, TTLCache } from '../lib/cache';
import { jfImage } from '../lib/images';

/** Jellyfin's libraries of photos (and home videos, which hold photos too). */
const KINDS = new Set(['photos', 'homevideos']);
const PAGE = 120;
const NONE: JfItemsResult = { Items: [], TotalRecordCount: 0 };

const libraries = new TTLCache<Array<{ id: string; name: string; cover?: string }>>(100);
/** The person's photo libraries, kept a few minutes. */
export const photoLibraries = (user: SessionUser) =>
  libraries.wrap(user.id, 5 * MINUTE, async () =>
    (await jellyfin.views(user.token, user.id)).Items.filter((v) => KINDS.has(v.CollectionType ?? '')).map((v) => ({
      id: v.Id,
      name: v.Name,
      cover: jfImage(v.Id, 'Primary', v.ImageTags?.Primary, { maxWidth: 640 }),
    })),
  );

/**
 * A folder of a photo library: its albums and folders by name, then its photos and videos, newest
 * first, a page at a time (`start`). At the top, the libraries, or with only one, what's in it.
 */
export async function photos(user: SessionUser, folderId: string | undefined, start = 0): Promise<PhotosPage> {
  const all = await photoLibraries(user);
  if (!all.length) return { folders: [], photos: [], total: 0 };
  if (!folderId && all.length > 1) return { folders: all, photos: [], total: 0 };
  const id = folderId ?? all[0].id;
  const fields = 'Width,Height,DateCreated,PremiereDate,ChildCount';
  const [folder, folders, files] = await Promise.all([
    jellyfin.item(user.token, user.id, id),
    start
      ? NONE
      : jellyfin.items(user.token, { userId: user.id, parentId: id, isFolder: true, sortBy: 'SortName', fields, enableImageTypes: 'Primary', imageTypeLimit: 1 }),
    jellyfin.items(user.token, {
      userId: user.id,
      parentId: id,
      isFolder: false,
      mediaTypes: 'Photo,Video',
      sortBy: 'PremiereDate,DateCreated,SortName',
      sortOrder: 'Descending',
      startIndex: start,
      limit: PAGE,
      fields,
      enableImageTypes: 'Primary',
      imageTypeLimit: 1,
      enableUserData: false,
    }),
  ]);
  // Up: to the folder above, within the library (above a library: the libraries, or Home).
  const library = all.some((l) => l.id === id);
  return {
    folder: { id, name: folder.Name, ...(!library && folder.ParentId ? { parentId: folder.ParentId } : {}) },
    folders: folders.Items.map((f) => ({
      id: f.Id,
      name: f.Name,
      cover: jfImage(f.Id, 'Primary', f.ImageTags?.Primary, { maxWidth: 640 }),
      ...(f.ChildCount !== undefined ? { count: f.ChildCount } : {}),
    })),
    photos: files.Items.map(
      (p): Photo => ({
        id: p.Id,
        name: p.Name,
        thumb: jfImage(p.Id, 'Primary', p.ImageTags?.Primary, { maxWidth: 480 }),
        full: p.MediaType === 'Video' ? undefined : jfImage(p.Id, 'Primary', p.ImageTags?.Primary, { maxWidth: 2560 }),
        ...(p.MediaType === 'Video' ? { video: true } : {}),
        date: p.PremiereDate ?? p.DateCreated,
        width: p.Width,
        height: p.Height,
        ...(p.MediaType === 'Video' && p.RunTimeTicks ? { seconds: ticksToSeconds(p.RunTimeTicks) } : {}),
      }),
    ),
    total: files.TotalRecordCount,
  };
}
