import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Images, Pause, Play, X } from 'lucide-react';
import type { Photo } from '@netfish/shared';
import { api } from '../api';
import { Empty, ErrorState, Img, PageLoader } from '../components/ui';
import { clock } from '../lib/format';
import { locale, t, tn } from '../i18n';

/**
 * Photos (Jellyfin's Photos and Home videos libraries): a folder's albums, then its photos and
 * videos, newest first. A photo opens full screen (with a slideshow); a video opens in the player.
 */
export default function Photos() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['photos', id ?? '', 'pages'],
    queryFn: ({ pageParam }) => api.photos(id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.photos.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const first = q.data?.pages[0];
  const items = q.data?.pages.flatMap((p) => p.photos) ?? [];
  const pictures = items.filter((p) => !p.video);
  const [open, setOpen] = useState<{ index: number; slideshow: boolean }>();

  // More as the end of the page comes near.
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    const el = end.current;
    if (!el || !hasNextPage) return;
    const seen = new IntersectionObserver((entries) => entries[0].isIntersecting && !isFetchingNextPage && void fetchNextPage(), { rootMargin: '600px' });
    seen.observe(el);
    return () => seen.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (q.isError) return <div className="page container"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  if (!first) return <div className="page container"><PageLoader /></div>;
  const up = first.folder?.parentId ? `/photos/${first.folder.parentId}` : id ? '/photos' : undefined;
  const choose = (p: Photo) => (p.video ? navigate(`/watch/${p.id}`) : setOpen({ index: pictures.indexOf(p), slideshow: false }));
  return (
    <div className="page container photos">
      <div className="photos__head">
        {up && (
          <Link to={up} className="icon-btn" aria-label={t('Back')}>
            <ArrowLeft size={24} />
          </Link>
        )}
        <h1 className="page__title">{first.folder?.name ?? t('Photos')}</h1>
        {pictures.length > 1 && (
          <button className="btn btn--ghost btn--sm" onClick={() => setOpen({ index: 0, slideshow: true })}>
            <Play size={16} fill="currentColor" /> {t('Slideshow')}
          </button>
        )}
      </div>
      {first.folders.length > 0 && (
        <div className="photos__folders">
          {first.folders.map((f) => (
            <Link key={f.id} to={`/photos/${f.id}`} className="album">
              <Img src={f.cover} className="album__img" fallback={<span className="album__empty"><Images size={36} /></span>} />
              <span className="album__name">{f.name}</span>
              {f.count !== undefined && <span className="album__count">{tn(f.count, '{n} item', '{n} items')}</span>}
            </Link>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="photos__grid">
          {items.map((p) => (
            <button key={p.id} className="photo" onClick={() => choose(p)} aria-label={p.name}>
              <Img src={p.thumb} className="photo__img" fallback={<span className="album__empty"><Images size={28} /></span>} />
              {p.video && (
                <span className="photo__video">
                  <Play size={14} fill="currentColor" /> {p.seconds ? clock(p.seconds) : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div ref={end} />
      {isFetchingNextPage && <PageLoader />}
      {!first.folders.length && !items.length && <Empty>{t('No photos here yet.')}</Empty>}
      {open && pictures.length > 0 && (
        <PhotoViewer
          photos={pictures}
          index={Math.min(open.index, pictures.length - 1)}
          slideshow={open.slideshow}
          onChange={(index, slideshow) => setOpen({ index, slideshow })}
          onClose={() => setOpen(undefined)}
          onNearEnd={() => hasNextPage && !isFetchingNextPage && void fetchNextPage()}
        />
      )}
    </div>
  );
}

/** How long each photo stays in a slideshow. */
const SLIDE = 5000;

/**
 * A photo full screen: left and right (keys, the remote, a swipe, the arrows) for the others,
 * a slideshow, Escape or Back to close.
 */
function PhotoViewer(props: {
  photos: Photo[];
  index: number;
  slideshow: boolean;
  onChange: (index: number, slideshow: boolean) => void;
  onClose: () => void;
  onNearEnd: () => void;
}) {
  const { photos, index, slideshow, onChange, onClose, onNearEnd } = props;
  const photo = photos[index];
  const go = (step: number) => onChange((index + step + photos.length) % photos.length, slideshow);
  // Latest, for the key and timer handlers.
  const latest = useRef({ go, slideshow, index, onChange, onClose });
  latest.current = { go, slideshow, index, onChange, onClose };

  useEffect(() => {
    if (index >= photos.length - 3) onNearEnd();
    // The next one loaded ahead.
    const next = photos[(index + 1) % photos.length];
    if (next?.full) new Image().src = next.full;
  }, [index, photos, onNearEnd]);

  useEffect(() => {
    if (!slideshow) return;
    const timer = setInterval(() => latest.current.go(1), SLIDE);
    return () => clearInterval(timer);
  }, [slideshow, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = latest.current;
      if (e.key === 'ArrowRight') l.go(1);
      else if (e.key === 'ArrowLeft') l.go(-1);
      else if (e.key === 'Escape') l.onClose();
      else if (e.key === ' ' || e.key === 'Enter' || e.key === 'MediaPlayPause') l.onChange(l.index, !l.slideshow);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A swipe: the next or the one before.
  const swipe = useRef<number>(undefined);
  const date = photo.date ? new Date(photo.date) : undefined;
  return (
    <div
      className="photo-viewer"
      role="dialog"
      aria-label={photo.name}
      onPointerDown={(e) => (swipe.current = e.clientX)}
      onPointerUp={(e) => {
        const dx = e.clientX - (swipe.current ?? e.clientX);
        swipe.current = undefined;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <img key={photo.id} src={photo.full ?? photo.thumb} alt={photo.name} className="photo-viewer__img" draggable={false} />
      <div className="photo-viewer__bar">
        <span className="photo-viewer__text">
          <strong>{photo.name}</strong>
          <span className="muted small">
            {date ? `${date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })} · ` : ''}
            {index + 1} / {photos.length}
          </span>
        </span>
        <button className="icon-btn" onClick={() => onChange(index, !slideshow)} aria-label={slideshow ? t('Pause slideshow') : t('Slideshow')}>
          {slideshow ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <X size={24} />
        </button>
      </div>
      {photos.length > 1 && (
        <>
          <button className="photo-viewer__step photo-viewer__step--back" onClick={() => go(-1)} aria-label={t('Previous photo')}>
            <ChevronLeft size={36} />
          </button>
          <button className="photo-viewer__step photo-viewer__step--next" onClick={() => go(1)} aria-label={t('Next photo')}>
            <ChevronRight size={36} />
          </button>
        </>
      )}
    </div>
  );
}
