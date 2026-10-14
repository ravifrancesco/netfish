import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, X } from 'lucide-react';
import type { MediaType } from '@netfish/shared';
import { api } from '../api';

/** TMDB, IMDb and Rotten Tomatoes scores, each linking to its source; Letterboxd as a link. */
export function RatingsStrip({ mediaType, tmdbId }: { mediaType: MediaType; tmdbId: number }) {
  const { data } = useQuery({
    queryKey: ['ratings', mediaType, tmdbId],
    queryFn: () => api.ratings(mediaType, tmdbId),
    staleTime: 6 * 60 * 60_000,
    retry: false,
  });
  if (!data) return null;
  const rt = data.rottenTomatoes;
  const items = [
    data.tmdb !== undefined && { key: 'tmdb', label: 'TMDB', value: data.tmdb.toFixed(1), href: data.links.tmdb },
    data.imdb && { key: 'imdb', label: 'IMDb', value: data.imdb.score.toFixed(1), href: data.links.imdb, title: data.imdb.votes ? `${data.imdb.votes.toLocaleString()} votes` : undefined },
    rt?.critics !== undefined && { key: rt.critics >= 60 ? 'fresh' : 'rotten', label: 'Critics', value: `${rt.critics}%`, href: data.links.rottenTomatoes, title: `Rotten Tomatoes · ${rt.criticsRating ?? ''}` },
    rt?.audience !== undefined && { key: 'audience', label: 'Audience', value: `${rt.audience}%`, href: data.links.rottenTomatoes, title: 'Rotten Tomatoes audience score' },
    data.metacritic && { key: 'metacritic', label: 'Metacritic', value: String(data.metacritic.score), href: undefined, title: 'Metascore' },
    (data.letterboxd || data.links.letterboxd) && {
      key: 'letterboxd',
      label: 'Letterboxd',
      value: data.letterboxd ? `${data.letterboxd.score.toFixed(1)}/5` : '',
      href: data.links.letterboxd,
      title: data.letterboxd?.votes ? `${data.letterboxd.votes.toLocaleString()} ratings on Letterboxd` : 'Open on Letterboxd',
    },
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; href?: string; title?: string }>;
  if (!items.length) return null;
  return (
    <div className="scores">
      {items.map((i) => (
        <a key={i.key} className={`score score--${i.key}`} href={i.href} target={i.href ? '_blank' : undefined} rel="noreferrer" title={i.title}>
          <span className="score__label">{i.label}</span>
          {i.value ? <span className="score__value">{i.value}</span> : <ArrowUpRight size={14} />}
        </a>
      ))}
    </div>
  );
}

/** Plays a YouTube trailer inside Netfish (no API key needed for embeds). */
export function TrailerPlayer({ youtubeKey, title, onClose }: { youtubeKey: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeKey)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
  return createPortal(
    <div className="trailer" role="dialog" aria-modal="true" aria-label={`${title} trailer`}>
      <div className="trailer__backdrop" onClick={onClose} />
      <div className="trailer__frame">
        <iframe src={src} title={`${title} trailer`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      </div>
      <button className="icon-btn icon-btn--lg trailer__close" onClick={onClose} aria-label="Close trailer">
        <X size={26} />
      </button>
    </div>,
    document.body,
  );
}
