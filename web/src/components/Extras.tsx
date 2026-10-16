import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, X } from 'lucide-react';
import type { MediaType } from '@netfish/shared';
import { api } from '../api';
import { locale, t, tn } from '../i18n';
import { decimal } from '../lib/format';

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
    data.tmdb !== undefined && { key: 'tmdb', label: 'TMDB', value: decimal(data.tmdb), href: data.links.tmdb },
    data.imdb && {
      key: 'imdb',
      label: 'IMDb',
      value: decimal(data.imdb.score),
      href: data.links.imdb,
      title: data.imdb.votes ? tn(data.imdb.votes, '{n} vote', '{n} votes', { n: data.imdb.votes.toLocaleString(locale) }) : undefined,
    },
    rt?.critics !== undefined && { key: rt.critics >= 60 ? 'fresh' : 'rotten', label: t('Critics'), value: `${rt.critics}%`, href: data.links.rottenTomatoes, title: `Rotten Tomatoes · ${rt.criticsRating ?? ''}` },
    rt?.audience !== undefined && { key: 'audience', label: t('Audience'), value: `${rt.audience}%`, href: data.links.rottenTomatoes, title: t('Rotten Tomatoes audience score') },
    data.metacritic && { key: 'metacritic', label: 'Metacritic', value: String(data.metacritic.score), href: undefined, title: 'Metascore' },
    (data.letterboxd || data.links.letterboxd) && {
      key: 'letterboxd',
      label: 'Letterboxd',
      value: data.letterboxd ? `${decimal(data.letterboxd.score)}/5` : '',
      href: data.links.letterboxd,
      title: data.letterboxd?.votes
        ? tn(data.letterboxd.votes, '{n} rating on Letterboxd', '{n} ratings on Letterboxd', { n: data.letterboxd.votes.toLocaleString(locale) })
        : t('Open on Letterboxd'),
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
/**
 * A title's trailer. With its TMDB id, in the person's language when there's one (their Jellyfin
 * profile's, else the app's, else English), and a switch to the other languages it has.
 */
export function TrailerPlayer({ youtubeKey, title, mediaType, tmdbId, onClose }: { youtubeKey: string; title: string; mediaType?: MediaType; tmdbId?: number; onClose: () => void }) {
  const choices = useQuery({
    queryKey: ['trailers', mediaType, tmdbId],
    queryFn: () => api.trailers(mediaType!, tmdbId!),
    enabled: Boolean(mediaType && tmdbId),
    staleTime: 60 * 60_000,
    retry: false,
  });
  const [picked, setPicked] = useState<string>();
  const options = choices.data?.options ?? [];
  const language = picked ?? choices.data?.chosen;
  const current = options.find((o) => o.language === language)?.youtubeKey;
  // Waiting for the languages (briefly): nothing plays yet, so it doesn't start over in another one.
  const waiting = choices.isLoading && Boolean(mediaType && tmdbId);
  const key = current ?? youtubeKey;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
  return createPortal(
    <div className="trailer" role="dialog" aria-modal="true" aria-label={t('{title} trailer', { title })}>
      <div className="trailer__backdrop" onClick={onClose} />
      <div className="trailer__stage">
        <div className="trailer__frame">
          {!waiting && <iframe key={key} src={src} title={t('{title} trailer', { title })} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />}
        </div>
        {options.length > 1 && (
          <div className="tabs trailer__langs" role="group" aria-label={t('Trailer language')}>
            {options.map((o) => (
              <button key={o.language} className={`tab${o.language === language ? ' is-active' : ''}`} aria-pressed={o.language === language} onClick={() => setPicked(o.language)}>
                {o.original ? t('{language} (original)', { language: o.label }) : o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="icon-btn icon-btn--lg trailer__close" onClick={onClose} aria-label={t('Close trailer')}>
        <X size={26} />
      </button>
    </div>,
    document.body,
  );
}
