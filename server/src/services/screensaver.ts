import type { ScreensaverResponse } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin } from '../clients/jellyfin';
import { settle } from '../lib/async';
import { jfImage } from '../lib/images';
import { listChannels } from './channels';
import { leftOut } from './manage';

/**
 * The screensaver (Android TV's, through the app): forty of the library's films and shows with a
 * backdrop, in no order, and what's on Netfish's own channel (the first) now.
 */
export async function screensaver(user: SessionUser): Promise<ScreensaverResponse> {
  const [res, guide] = await Promise.all([
    jellyfin.items(user.token, {
      userId: user.id,
      includeItemTypes: 'Movie,Series',
      recursive: true,
      imageTypes: 'Backdrop',
      sortBy: 'Random',
      limit: 40,
      excludeItemIds: await leftOut(user),
      enableImageTypes: 'Backdrop,Logo',
      imageTypeLimit: 1,
      enableUserData: false,
    }),
    // (Channels off: nothing on.)
    settle(listChannels(user, 1), undefined),
  ]);
  const items = res.Items.flatMap((i) => {
    const backdrop = jfImage(i.Id, 'Backdrop', i.BackdropImageTags?.[0], { maxWidth: 1920 });
    return backdrop ? [{ title: i.Name, year: i.ProductionYear, backdrop, logo: jfImage(i.Id, 'Logo', i.ImageTags?.Logo, { maxWidth: 600 }) }] : [];
  });
  const now = Date.now();
  const first = guide?.channels[0];
  const on = first?.programs.find((p) => p.start <= now && now < p.start + p.seconds * 1000);
  return { items, ...(first && on ? { onNow: { channel: first.name, title: on.seriesTitle ?? on.title, until: on.start + on.seconds * 1000 } } : {}) };
}
