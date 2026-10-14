import { Link } from 'react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Play, Plug, Plus, Star, X } from 'lucide-react';
import type { Card } from '@netfish/shared';
import { api } from '../api';
import { Row, RowSkeleton } from '../components/Cards';
import { ErrorState, Img, StatusChip } from '../components/ui';
import { decimal, titleHref } from '../lib/format';
import { t } from '../i18n';
import { useConfig, useMe } from '../lib/hooks';

/** Admins: a nudge to finish connecting services until they're all there. */
function SetupNudge() {
  const { data: config } = useConfig();
  const { data: me } = useMe();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem('netfish.nudge') === '1';
    } catch {
      return false;
    }
  });
  if (!me?.isAdmin || !config || hidden) return null;
  const missing = [
    !config.features.requests && t('Seerr (discovery and requests)'),
    !config.features.downloads && t('Radarr/Sonarr (downloads and versions)'),
    !config.features.subtitles && t('Bazarr (subtitles)'),
  ].filter(Boolean);
  if (!missing.length) return null;
  return (
    <div className="nudge">
      <Plug size={18} />
      <span>{t('Finish setting up Netfish: connect {services}.', { services: missing.join(', ') })}</span>
      <Link to="/settings#connections" className="btn btn--accent btn--sm">
        {t('Connections')}
      </Link>
      <button
        className="icon-btn icon-btn--sm"
        aria-label={t('Hide')}
        onClick={() => {
          setHidden(true);
          try {
            sessionStorage.setItem('netfish.nudge', '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

function Hero({ card }: { card: Card }) {
  const playable = card.mediaType === 'movie' && card.jellyfinId && card.status === 'available';
  return (
    <section className="hero">
      <div className="hero__media">
        <Img src={card.backdrop} className="hero__img" />
      </div>
      <div className="hero__shade" />
      <div className="hero__content">
        <span className="hero__kicker">{card.mediaType === 'tv' ? t('Series') : t('Film')}</span>
        <h1 className="hero__title">{card.title}</h1>
        <div className="hero__meta">
          {card.year && <span>{card.year}</span>}
          {card.rating && (
            <span className="rating">
              <Star size={14} fill="currentColor" /> {decimal(card.rating)}
            </span>
          )}
          <StatusChip status={card.status} progress={card.downloadProgress} compact />
        </div>
        {card.overview && <p className="hero__overview">{card.overview}</p>}
        <div className="hero__actions">
          {playable ? (
            <Link to={`/watch/${card.jellyfinId}`} className="btn btn--primary btn--lg">
              <Play size={22} fill="currentColor" /> {t('Play')}
            </Link>
          ) : card.status === 'none' ? (
            <Link to={titleHref(card)} className="btn btn--accent btn--lg">
              <Plus size={22} /> {t('Request')}
            </Link>
          ) : null}
          <Link to={titleHref(card)} className="btn btn--ghost btn--lg">
            <Info size={22} /> {t('More info')}
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const home = useQuery({ queryKey: ['home'], queryFn: api.home, staleTime: 60_000, refetchInterval: 60_000 });

  if (home.isError) return <div className="page container"><ErrorState error={home.error} retry={() => void home.refetch()} /></div>;
  if (!home.data) {
    return (
      <div className="home">
        <div className="hero hero--skeleton" />
        <div className="rows">
          <RowSkeleton wide />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </div>
    );
  }

  const { hero, rows } = home.data;
  return (
    <div className="home">
      {hero ? <Hero card={hero} /> : <div className="hero hero--empty" />}
      <div className="rows">
        <SetupNudge />
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
        {rows.length === 0 && (
          <div className="empty">
            <p>{t('Your library is empty for now. Search for something and request it.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
