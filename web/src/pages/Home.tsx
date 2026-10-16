import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Play, Plug, Plus, Star, X } from 'lucide-react';
import type { HomeResponse } from '@netfish/shared';
import { api } from '../api';
import { Row, RowSkeleton } from '../components/Cards';
import { Empty, ErrorState, Img, StatusChip } from '../components/ui';
import { decimal, titleHref } from '../lib/format';
import { t } from '../i18n';
import { useConfig, useMe } from '../lib/hooks';
import { desktop } from '../lib/desktop';
import { UpdateNudge } from '../components/AppUpdate';
import { TogetherRow } from '../components/Together';
import { ChannelsRow } from '../components/ChannelsRow';

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

function Hero({ card }: { card: NonNullable<HomeResponse['hero']> }) {
  const play = card.play ?? (card.mediaType === 'movie' && card.jellyfinId && card.status === 'available' ? { itemId: card.jellyfinId, label: t('Play') } : undefined);
  return (
    <section className="hero">
      <div className="hero__media">
        <Img src={card.backdrop} className="hero__img" />
      </div>
      <div className="hero__shade" />
      <div className="hero__content">
        <span className="hero__kicker">{card.mediaType === 'tv' ? t('Series') : t('Film')}</span>
        <h1 className={`hero__title${card.title.length > 22 ? ' hero__title--long' : ''}`}>{card.title}</h1>
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
          {play ? (
            <Link to={`/watch/${play.itemId}`} className="btn btn--primary btn--lg">
              <Play size={22} fill="currentColor" /> {play.label}
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
  const me = useMe().data;
  // The apps keep a copy of Home, shown greyed out (downloads aside) when offline.
  useEffect(() => {
    const save = desktop()?.saveSnapshot;
    if (!save || !home.data) return;
    const absolute = (url?: string) => (url ? new URL(url, location.origin).toString() : undefined);
    save(
      JSON.stringify({
        at: new Date().toISOString(),
        user: me?.name,
        rows: home.data.rows.slice(0, 8).map((row) => ({
          title: row.title,
          items: row.items.slice(0, 14).map((c) => ({
            title: c.title,
            subtitle: c.subtitle ?? (c.year ? String(c.year) : undefined),
            itemId: c.playItemId ?? c.jellyfinId,
            poster: absolute(row.style === 'wide' ? (c.thumb ?? c.backdrop) : c.poster),
            wide: row.style === 'wide',
          })),
        })),
      }),
    );
  }, [home.data, me?.name]);

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
        <UpdateNudge />
        <TogetherRow />
        <ChannelsRow />
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
        {rows.length === 0 && (
          <Empty>{t('Your library is empty for now. Search for something and request it.')}</Empty>
        )}
      </div>
    </div>
  );
}
