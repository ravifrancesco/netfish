import { TICKS, hex } from './world';

/**
 * Photo libraries, as Jellyfin has them: a Photos library with two albums and some loose photos,
 * and a Home videos library with photos and a video. Each "photo" is a drawing of hills.
 */
export interface PhotoItem {
  id: string;
  name: string;
  type: 'CollectionFolder' | 'PhotoAlbum' | 'Photo' | 'Video';
  parentId?: string;
  collectionType?: 'photos' | 'homevideos';
  date?: string;
  portrait?: boolean;
}

const items: PhotoItem[] = [];
const add = (p: Omit<PhotoItem, 'id'>) => {
  const item = { ...p, id: hex(`photo-${p.parentId ?? ''}-${p.name}`) };
  items.push(item);
  return item.id;
};
const family = add({ name: 'Family photos', type: 'CollectionFolder', collectionType: 'photos' });
const summer = add({ name: 'Summer in Liguria', type: 'PhotoAlbum', parentId: family });
const nonna = add({ name: "Nonna's 90th", type: 'PhotoAlbum', parentId: family });
for (let i = 1; i <= 7; i++) add({ name: `IMG_20250${7 + (i % 2)}${10 + i}_0${i}`, type: 'Photo', parentId: summer, date: `2025-0${7 + (i % 2)}-${10 + i}T1${i}:00:00Z`, portrait: i % 3 === 0 });
for (let i = 1; i <= 5; i++) add({ name: `Party ${i}`, type: 'Photo', parentId: nonna, date: `2024-11-0${i}T20:0${i}:00Z`, portrait: i === 2 });
for (let i = 1; i <= 4; i++) add({ name: `Garden ${i}`, type: 'Photo', parentId: family, date: `2026-0${i}-02T09:00:00Z` });
const videos = add({ name: 'Home videos', type: 'CollectionFolder', collectionType: 'homevideos' });
add({ name: 'First steps', type: 'Video', parentId: videos, date: '2023-05-01T10:00:00Z' });
add({ name: 'Beach', type: 'Photo', parentId: videos, date: '2023-08-12T16:00:00Z' });

export const PHOTO_ITEMS = items;
export const photoById = new Map(items.map((p) => [p.id, p]));
export const photoLibraries = items.filter((p) => p.type === 'CollectionFolder');
export const isPhotoFolder = (p: PhotoItem) => p.type === 'CollectionFolder' || p.type === 'PhotoAlbum';
export const childrenOf = (id: string) => items.filter((p) => p.parentId === id);

/** As Jellyfin's /Items gives it. */
export const photoDto = (p: PhotoItem) => ({
  Id: p.id,
  Name: p.name,
  Type: p.type,
  IsFolder: isPhotoFolder(p),
  ...(p.type === 'Photo' || p.type === 'Video' ? { MediaType: p.type } : {}),
  ...(p.parentId ? { ParentId: p.parentId } : {}),
  ...(p.collectionType ? { CollectionType: p.collectionType } : {}),
  ImageTags: { Primary: 'p1' },
  ...(p.date ? { DateCreated: p.date, PremiereDate: p.date } : {}),
  ...(p.type === 'Photo' ? (p.portrait ? { Width: 3024, Height: 4032 } : { Width: 4032, Height: 3024 }) : {}),
  ...(isPhotoFolder(p) ? { ChildCount: childrenOf(p.id).length } : {}),
  ...(p.type === 'Video' ? { RunTimeTicks: 95 * TICKS } : {}),
});

/** A "photo": sky, sun and hills in the photo's own colours, its name in a corner. */
export function photoSvg(p: PhotoItem): string {
  let h = 0;
  for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const [w, ht] = p.portrait ? [900, 1200] : [1200, 900];
  const name = p.name.replace(/[&<>"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}" viewBox="0 0 ${w} ${ht}">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 80% 80%)"/></linearGradient></defs>
<rect width="${w}" height="${ht}" fill="url(#s)"/>
<circle cx="${w * 0.72}" cy="${ht * 0.3}" r="${w * 0.08}" fill="hsl(${(hue + 180) % 360} 90% 85%)"/>
<path d="M0 ${ht * 0.7} Q ${w * 0.3} ${ht * 0.5} ${w * 0.6} ${ht * 0.68} T ${w} ${ht * 0.62} V ${ht} H 0 Z" fill="hsl(${(hue + 120) % 360} 45% 30%)"/>
<path d="M0 ${ht * 0.82} Q ${w * 0.4} ${ht * 0.7} ${w} ${ht * 0.86} V ${ht} H 0 Z" fill="hsl(${(hue + 140) % 360} 50% 20%)"/>
<text x="24" y="${ht - 24}" font-family="sans-serif" font-size="${Math.round(w / 24)}" fill="#fff" opacity="0.85">${name}</text>
</svg>`;
}
