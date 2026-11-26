import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { requestsQuery } from '../pages/Activity';
import { libraryQuery } from '../pages/Browse';
import { homeQuery } from '../pages/Home';
import { channelsQuery } from './channels';
import { useConfig } from './hooks';
import { hasPhotos, photosQuery, photosTopQuery } from './photos';

/** About a screen of posters. */
const warm = (urls: (string | undefined)[]) => {
  for (const url of urls.slice(0, 18)) if (url) new Image().src = url;
};

/**
 * Once the page Netfish opened on is in: the other pages in the menu (their code, what they show
 * first and its first pictures), so each opens at once. Their queries keep what they showed while
 * Netfish is open (gcTime), so coming back is instant too, refreshed as they open.
 */
export function usePreload() {
  const qc = useQueryClient();
  const features = useConfig().data?.features;
  const ready = Boolean(features);
  useEffect(() => {
    if (!features) return;
    const since = Date.now();
    let timer = 0;
    const run = () => {
      // The first page's own requests first (a few seconds at most).
      if (qc.isFetching() && Date.now() - since < 5000) {
        timer = window.setTimeout(run, 250);
        return;
      }
      for (const type of ['movie', 'tv'] as const) {
        const library = libraryQuery(type, 'added');
        void qc.prefetchInfiniteQuery(library).then(() => warm(qc.getQueryData(library.queryKey)?.pages[0]?.items.map((c) => c.poster) ?? []));
      }
      if (features.requests) void qc.prefetchQuery(requestsQuery('mine'));
      if (features.discoverTab) void qc.prefetchQuery(homeQuery('discover'));
      if (features.channels) {
        void import('../pages/Channels');
        void import('../pages/ChannelPlayer');
        void qc.prefetchQuery(channelsQuery);
      }
      qc.ensureQueryData(photosTopQuery).then(
        (top) => {
          if (!hasPhotos(top)) return;
          void import('../pages/Photos');
          // The same first page as the top's.
          const pages = photosQuery();
          if (!qc.getQueryData(pages.queryKey)) qc.setQueryData(pages.queryKey, { pages: [top], pageParams: [0] });
          warm([...top.folders.map((f) => f.cover), ...top.photos.map((p) => p.thumb)]);
        },
        () => undefined,
      );
    };
    timer = window.setTimeout(run, 300);
    return () => clearTimeout(timer);
  }, [qc, ready]); // eslint-disable-line react-hooks/exhaustive-deps
}
