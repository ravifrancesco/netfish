import { useEffect, useRef, type ReactNode } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { MediaType } from '@netfish/shared';
import { api } from '../api';
import { Grid } from '../components/Cards';
import { ErrorState, Spinner } from '../components/ui';
import { appKind, canDownloadHere, desktop, useOffline, type OfflineItem } from '../lib/desktop';
import { bytes } from '../lib/format';
import { useConfig } from '../lib/hooks';
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
  { value: 'added', label: 'Recently added' },
  { value: 'name', label: 'A–Z' },
  { value: 'year', label: 'Release year' },
  { value: 'rating', label: 'Rating' },
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
  if (!cards.length) return <div className="empty"><p>Nothing here yet.</p></div>;
  return (
    <>
      <p className="muted small">{q.data.pages[0].total} titles</p>
      <Grid cards={cards} />
      <div ref={sentinel} className="sentinel">{q.isFetchingNextPage && <Spinner />}</div>
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
  const cancel = (i: OfflineItem): CardAction => ({ label: 'Cancel download', icon: <X size={17} />, run: () => void d?.removeOffline?.(i.itemId) });
  const retry = (i: OfflineItem): CardAction => ({ label: 'Try again', icon: <RotateCcw size={16} />, run: () => void d?.retryOffline?.(i.itemId) });
  const remove = (label: string, question: string, run: () => void): CardAction => ({
    label,
    icon: <Trash2 size={16} />,
    run: () => confirm(question) && run(),
  });

  if (mediaType === 'movie') {
    const movies = list.filter((i) => i.kind === 'Movie');
    if (!movies.length) return <div className="empty"><p>No movies on {appKind().device} yet. Press Download on any movie to watch it offline.</p></div>;
    return (
      <div className="grid">
        {movies.map((m) => (
          <OfflineCard
            key={m.itemId}
            title={m.title}
            poster={m.poster}
            progress={busy(m) ? pct(m) : undefined}
            line={m.state === 'done' ? `Ready · ${bytes(m.size)}` : busy(m) ? `Downloading · ${bytes(m.received)}${m.size ? ` of ${bytes(m.size)}` : ''}` : 'Download stopped'}
            onOpen={() => open(m.state === 'done' ? { play: m.itemId } : {})}
            actions={
              busy(m)
                ? [cancel(m)]
                : [
                    ...(stopped(m) ? [retry(m)] : []),
                    remove('Delete download', `Delete "${m.title}" from this device?`, () => void d?.removeOffline?.(m.itemId)),
                  ]
            }
          />
        ))}
      </div>
    );
  }

  const shows = new Map<string, OfflineItem[]>();
  for (const ep of list.filter((i) => i.kind === 'Episode')) shows.set(showKey(ep), [...(shows.get(showKey(ep)) ?? []), ep]);
  if (!shows.size) return <div className="empty"><p>No episodes on {appKind().device} yet. Use the download icon next to any episode.</p></div>;
  return (
    <div className="grid">
      {[...shows.entries()].map(([key, eps]) => {
        const downloading = eps.filter(busy);
        const progress = downloading.length ? downloading.reduce((n, e) => n + pct(e), 0) / downloading.length : undefined;
        const ready = eps.filter((e) => e.state === 'done').length;
        const title = eps[0].seriesTitle ?? 'Show';
        return (
          <OfflineCard
            key={key}
            title={title}
            poster={eps[0].poster}
            progress={progress}
            line={`${ready} episode${ready === 1 ? '' : 's'} ready${downloading.length ? ` · ${downloading.length} downloading` : ''}`}
            onOpen={() => open({ show: key })}
            actions={[
              ...(downloading.length
                ? [{ label: 'Cancel downloads', icon: <X size={17} />, run: () => downloading.forEach((e) => void d?.removeOffline?.(e.itemId)) }]
                : []),
              remove('Delete all episodes', `Delete all ${eps.length} downloaded episode${eps.length === 1 ? '' : 's'} of "${title}"?`, () => void d?.removeOfflineSeries?.(key)),
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
  const discoverTabs =
    mediaType === 'movie'
      ? [
          { value: 'movies', label: 'Popular' },
          { value: 'trending', label: 'Trending' },
          { value: 'movies-upcoming', label: 'Coming soon' },
        ]
      : [
          { value: 'tv', label: 'Popular' },
          { value: 'trending', label: 'Trending' },
          { value: 'tv-upcoming', label: 'Coming soon' },
        ];

  return (
    <div className="page container">
      <div className="page__head">
        <h1>{mediaType === 'movie' ? 'Movies' : 'Shows'}</h1>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'library'} className={`tab${tab === 'library' ? ' is-active' : ''}`} onClick={() => set({ tab: 'library' })}>
            Your library
          </button>
          {canDownloadHere() && (
            <button role="tab" aria-selected={tab === 'offline'} className={`tab${tab === 'offline' ? ' is-active' : ''}`} onClick={() => set({ tab: 'offline' })}>
              Offline
            </button>
          )}
          {config?.features.discover &&
            discoverTabs.map((t) => (
              <button key={t.value} role="tab" aria-selected={tab === t.value} className={`tab${tab === t.value ? ' is-active' : ''}`} onClick={() => set({ tab: t.value })}>
                {t.label}
              </button>
            ))}
        </div>
        {tab === 'library' && (
          <select className="select" value={sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort">
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
      ) : tab === 'offline' ? (
        <Offline mediaType={mediaType} />
      ) : (
        <Discover kind={tab} mediaType={mediaType} />
      )}
    </div>
  );
}
