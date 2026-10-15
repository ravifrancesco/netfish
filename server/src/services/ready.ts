import type { Card } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { has } from '../config';
import { CARD_FIELDS, jellyfin } from '../clients/jellyfin';
import { settle } from '../lib/async';
import { jfToCard } from './cards';
import { findInLibrary, libraryIndex } from './library';
import { listRequests } from './requests';

/**
 * "Ready to watch": what someone asked for that has arrived and they haven't started yet,
 * newest first. A row on Home, and what the apps notify about.
 */
const DAY = 86_400_000;

export async function readyToWatch(user: SessionUser): Promise<Card[]> {
  if (!has.seerr()) return [];
  const [requests, index] = await Promise.all([settle(listRequests(user, 'mine'), []), libraryIndex(user)]);
  const recent = requests.filter((r) => (r.status === 'available' || r.status === 'partial') && Date.now() - Date.parse(r.createdAt) < 90 * DAY);
  const ids = [...new Set(recent.map((r) => findInLibrary(index, r.mediaType, r.tmdbId)?.id).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  const res = await jellyfin.items(user.token, {
    userId: user.id,
    ids: ids.join(','),
    fields: `${CARD_FIELDS},DateCreated`,
    enableImageTypes: 'Primary,Backdrop,Thumb',
  });
  return res.Items.filter((item) => !item.UserData?.Played && !item.UserData?.PlaybackPositionTicks && !item.UserData?.LastPlayedDate)
    .filter((item) => Date.now() - (Date.parse(item.DateCreated ?? '') || 0) < 30 * DAY)
    .sort((a, b) => (b.DateCreated ?? '').localeCompare(a.DateCreated ?? ''))
    .map((item) => ({ ...jfToCard(item, index), readyAt: item.DateCreated }));
}
