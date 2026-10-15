import { useEffect, useRef, type ReactNode } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { MediaType } from '@netfish/shared';
import { api } from '../api';
import { Grid } from '../components/Cards';
import { ErrorState, Spinner } from '../components/ui';
import { appKind, canDownloadHere, desktop, useOffline, type OfflineItem } from '../lib/desktop';
import { bytes } from '../lib/format';
import { useConfig } from '../lib/hooks';
import { t, tn } from '../i18n';
import { Img, Progress } from '../components/ui';

/** Loads the next page when the sentinel scrolls into view. */
function useAutoLoad(load: () => void, enabled: boolean) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && load(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, load]);
  return sentinel;
}

const SORTS = [
  { value: 'added', label: t('Recently added') },
  { value: 'name', label: t('A–Z') },
  { value: 'year', label: t('Release year') },
  { value: 'rating', label: t('Rating') },
  { value: 'shortest', label: t('Shortest first') },
  { value: 'longest', label: t('Longest first') },
];

function Library({ mediaType, sort }: { mediaType: MediaType; sort: string }) {
  const q = useInfiniteQuery({
    queryKey: ['library', mediaType, sort],
    queryFn: ({ pageParam }) => api.library(mediaType, sort, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const sentinel = useAutoLoad(() => void q.fetchNextPage(), Boolean(q.hasNextPage && !q.isFetchingNextPage));
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Spinner size={28} />;
  const cards = q.data.pages.flatMap((p) => p.items);
  if (!cards.length) return <div className="empty"><p>{t('Nothing here yet.')}</p></div>;
  return (
    <>
      <p className="muted small">{tn(q.data.pages[0].total, '{n} title', '{n} titles')}</p>
      <Grid cards={cards} showLength={sort === 'shortest' || sort === 'longest'} />
      <div ref={sentinel} className="sentinel">{q.isFetchingNextPage && <Spinner />}</div>
    </>
  );
}

/** Deleted from disk to save space, still part of the library. */
function NotOnDisk({ mediaType }: { mediaType: MediaType }) {
  const q = useQuery({ queryKey: ['removed', mediaType], queryFn: () => api.removed(mediaType) });
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Spinner size={28} />;
  if (!q.data.items.length) return <div className="empty"><p>{t('Everything in your library is on disk.')}</p></div>;
  return (
    <>
      <p className="muted small">{t('Deleted from disk to save space. Open one to download it again.')}</p>
      <Grid cards={q.data.items} />
    </>
  );
}

function Discover({ kind, mediaType }: { kind: string; mediaType: MediaType }) {
  const q = useInfiniteQuery({
    queryKey: ['discover', kind],
    queryFn: ({ pageParam }) => api.discover(kind, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const sentinel = useAutoLoad(() => void q.fetchNextPage(), Boolean(q.hasNextPage && !q.isFetchingNextPage));
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Spinner size={28} />;
  const seen = new Set<string>();
  const cards = q.data.pages
    .flatMap((p) => p.items)
    .filter((c) => c.mediaType === mediaType && !seen.has(c.key) && seen.add(c.key));
  return (
    <>
      <Grid cards={cards} />
      <div ref={sentinel} className="sentinel">{q.isFetchingNextPage && <Spinner />}</div>
    </>
  );
}

const showKey = (i: OfflineItem) => i.seriesId || i.seriesTitle || i.title;

interface CardAction {
  label: string;
  icon: ReactNode;
  run: () => void;
}

function OfflineCard({
  title,
  poster,
  line,
  progress,
  onOpen,
  actions,
}: {
  title: string;
  poster?: string;
  line: string;
  progress?: number;
  onOpen: () => void;
  actions: CardAction[];
}) {
  return (
    <div className="offline-card">
      <button className="card" onClick={onOpen} aria-label={title}>
        <div className="card__frame">
          <Img src={poster} className="card__img" fallback={<span className="card__fallback">{title}</span>} />
          {progress !== undefined && (
            <>
              <div className="card__chip">
                <span className="chip chip--dl">{Math.round(progress * 100)}%</span>
              </div>
              <Progress value={progress} className="card__bar" />
            </>
          )}
        </div>
      </button>
      <div className="offline-card__meta">
        <div className="offline-card__text">
          <strong>{title}</strong>
          <span className="muted small">{line}</span>
        </div>
        {actions.map((a) => (
          <button key={a.label} className="icon-btn icon-btn--sm" title={a.label} aria-label={`${a.label}: ${title}`} onClick={a.run}>
            {a.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Desktop and iPhone/iPad apps: what's saved on this device (and what's still downloading). */
function Offline({ mediaType }: { mediaType: MediaType }) {
  const list = useOffline();
  const d = desktop();
  const open = (target: { play?: string; show?: string }) => d?.openOffline?.(target);
  const pct = (i: OfflineItem) => (i.size ? Math.min(0.99, i.received / i.size) : 0);
  const busy = (i: OfflineItem) => i.state === 'downloading' || i.state === 'paused';
  const stopped = (i: OfflineItem) => i.state === 'failed' || i.state === 'interrupted';
  const cancel = (i: OfflineItem): CardAction => ({ label: t('Cancel download'), icon: <X size={17} />, run: () => void d?.removeOffline?.(i.itemId) });
  const retry = (i: OfflineItem): CardAction => ({ label: t('Try again'), icon: <RotateCcw size={16} />, run: () => void d?.retryOffline?.(i.itemId) });
  const remove = (label: string, question: string, run: () => void): CardAction => ({
    label,
    icon: <Trash2 size={16} />,
    run: () => confirm(question) && run(),
  });

  if (mediaType === 'movie') {
    const movies = list.filter((i) => i.kind === 'Movie');
    if (!movies.length) return <div className="empty"><p>{t('No movies on {device} yet. Press Download on any movie to watch it offline.', { device: appKind().device })}</p></div>;
    return (
      <div className="grid">
        {movies.map((m) => (
          <OfflineCard
            key={m.itemId}
            title={m.title}
            poster={m.poster}
            progress={busy(m) ? pct(m) : undefined}
            line={
              m.state === 'done'
                ? t('Ready · {size}', { size: bytes(m.size) })
                : busy(m)
                  ? m.size
                    ? t('Downloading · {done} of {total}', { done: bytes(m.received), total: bytes(m.size) })
                    : t('Downloading · {done}', { done: bytes(m.received) })
                  : t('Download stopped')
            }
            onOpen={() => open(m.state === 'done' ? { play: m.itemId } : {})}
            actions={
              busy(m)
                ? [cancel(m)]
                : [
                    ...(stopped(m) ? [retry(m)] : []),
                    remove(t('Delete download'), t('Delete "{title}" from this device?', { title: m.title }), () => void d?.removeOffline?.(m.itemId)),
                  ]
            }
          />
        ))}
      </div>
    );
  }

  const shows = new Map<string, OfflineItem[]>();
  for (const ep of list.filter((i) => i.kind === 'Episode')) shows.set(showKey(ep), [...(shows.get(showKey(ep)) ?? []), ep]);
  if (!shows.size) return <div className="empty"><p>{t('No episodes on {device} yet. Use the download icon next to any episode.', { device: appKind().device })}</p></div>;
  return (
    <div className="grid">
      {[...shows.entries()].map(([key, eps]) => {
        const downloading = eps.filter(busy);
        const progress = downloading.length ? downloading.reduce((n, e) => n + pct(e), 0) / downloading.length : undefined;
        const ready = eps.filter((e) => e.state === 'done').length;
        const title = eps[0].seriesTitle ?? t('Show');
        return (
          <OfflineCard
            key={key}
            title={title}
            poster={eps[0].poster}
            progress={progress}
            line={
              tn(ready, '{n} episode ready', '{n} episodes ready') +
              (downloading.length ? ` · ${t('{n} downloading', { n: downloading.length })}` : '')
            }
            onOpen={() => open({ show: key })}
            actions={[
              ...(downloading.length
                ? [{ label: t('Cancel downloads'), icon: <X size={17} />, run: () => downloading.forEach((e) => void d?.removeOffline?.(e.itemId)) }]
                : []),
              remove(
                t('Delete all episodes'),
                tn(eps.length, 'Delete all {n} downloaded episode of "{title}"?', 'Delete all {n} downloaded episodes of "{title}"?', { title }),
                () => void d?.removeOfflineSeries?.(key),
              ),
            ]}
          />
        );
      })}
    </div>
  );
}

export default function Browse({ mediaType }: { mediaType: MediaType }) {
  const { data: config } = useConfig();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'library';
  const sort = params.get('sort') ?? 'added';
  const set = (patch: Record<string, string>) => setParams({ tab, sort, ...patch }, { replace: true });
  // Only shown once something was deleted from disk.
  const removed = useQuery({ queryKey: ['removed', mediaType], queryFn: () => api.removed(mediaType), enabled: Boolean(config?.features.downloads) });
  const removedCount = removed.data?.items.length ?? 0;
  const discoverTabs =
    mediaType === 'movie'
      ? [
          { value: 'movies', label: t('Popular') },
          { value: 'trending', label: t('Trending') },
          { value: 'movies-upcoming', label: t('Coming soon') },
        ]
      : [
          { value: 'tv', label: t('Popular') },
          { value: 'trending', label: t('Trending') },
          { value: 'tv-upcoming', label: t('Coming soon') },
        ];

  return (
    <div className="page container">
      <div className="page__head">
        <h1>{mediaType === 'movie' ? t('Movies') : t('Shows')}</h1>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'library'} className={`tab${tab === 'library' ? ' is-active' : ''}`} onClick={() => set({ tab: 'library' })}>
            {t('Your library')}
          </button>
          {(removedCount > 0 || tab === 'removed') && (
            <button role="tab" aria-selected={tab === 'removed'} className={`tab${tab === 'removed' ? ' is-active' : ''}`} onClick={() => set({ tab: 'removed' })}>
              {t('Not on disk')} <span className="tab__count">{removedCount}</span>
            </button>
          )}
          {canDownloadHere() && (
            <button role="tab" aria-selected={tab === 'offline'} className={`tab${tab === 'offline' ? ' is-active' : ''}`} onClick={() => set({ tab: 'offline' })}>
              {t('Offline')}
            </button>
          )}
          {config?.features.discover &&
            discoverTabs.map((item) => (
              <button key={item.value} role="tab" aria-selected={tab === item.value} className={`tab${tab === item.value ? ' is-active' : ''}`} onClick={() => set({ tab: item.value })}>
                {item.label}
              </button>
            ))}
        </div>
        {tab === 'library' && (
          <select className="select" value={sort} onChange={(e) => set({ sort: e.target.value })} aria-label={t('Sort')}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {tab === 'library' ? (
        <Library mediaType={mediaType} sort={sort} />
      ) : tab === 'removed' ? (
        <NotOnDisk mediaType={mediaType} />
      ) : tab === 'offline' ? (
        <Offline mediaType={mediaType} />
      ) : (
        <Discover kind={tab} mediaType={mediaType} />
      )}
    </div>
  );
}
