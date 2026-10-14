import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronLeft, ChevronRight, Info, Play } from 'lucide-react';
import type { Card, Row as RowData } from '@netfish/shared';
import { titleHref } from '../lib/format';
import { Img, Progress, StatusChip } from './ui';
import { t } from '../i18n';

export function PosterCard({ card }: { card: Card }) {
  const downloading = card.downloadProgress !== undefined && card.status !== 'available';
  return (
    <Link to={titleHref(card)} className="card" aria-label={`${card.title}${card.year ? ` (${card.year})` : ''}`}>
      <div className="card__frame">
        <Img src={card.poster} className="card__img" fallback={<span className="card__fallback">{card.title}</span>} />
        <div className="card__chip">
          <StatusChip status={card.status} progress={card.downloadProgress} compact />
        </div>
        {downloading && <Progress value={card.downloadProgress!} className="card__bar" />}
        <div className="card__hover">
          <span className="card__hover-title">{card.title}</span>
          {card.year && <span className="card__hover-year">{card.year}</span>}
        </div>
      </div>
    </Link>
  );
}

/** Continue watching: plays straight away; the (i) goes to the details page. */
export function WideCard({ card }: { card: Card }) {
  return (
    <div className="wide">
      <Link to={card.playItemId ? `/watch/${card.playItemId}` : titleHref(card)} className="wide__frame" aria-label={t('Play {title}', { title: card.title })}>
        <Img src={card.thumb ?? card.backdrop} className="wide__img" fallback={<span className="card__fallback">{card.title}</span>} />
        <span className="wide__play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
        {card.progress !== undefined && <Progress value={card.progress} tone="watch" className="wide__bar" />}
      </Link>
      <div className="wide__meta">
        <div className="wide__text">
          <span className="wide__title">{card.title}</span>
          {card.subtitle && <span className="wide__subtitle">{card.subtitle}</span>}
        </div>
        <Link to={titleHref(card)} className="icon-btn icon-btn--sm" aria-label={t('More about {title}', { title: card.title })}>
          <Info size={18} />
        </Link>
      </div>
    </div>
  );
}

export function Row({ row }: { row: RowData }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = () => {
    const el = track.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [row.items.length]);

  const page = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section className={`row row--${row.style}`}>
      <div className="row__head">
        <h2 className="row__title">{row.title}</h2>
        {row.href && (
          <Link to={row.href} className="row__more">
            {t('See all')} <ChevronRight size={16} />
          </Link>
        )}
      </div>
      <div className="row__viewport">
        {edges.left && (
          <button className="row__arrow row__arrow--left" onClick={() => page(-1)} aria-label={t('Scroll left')} tabIndex={-1}>
            <ChevronLeft size={32} />
          </button>
        )}
        <div className="row__track" ref={track} onScroll={update}>
          {row.items.map((card) =>
            row.style === 'wide' ? <WideCard key={card.key + (card.playItemId ?? '')} card={card} /> : <PosterCard key={card.key} card={card} />,
          )}
        </div>
        {edges.right && (
          <button className="row__arrow row__arrow--right" onClick={() => page(1)} aria-label={t('Scroll right')} tabIndex={-1}>
            <ChevronRight size={32} />
          </button>
        )}
      </div>
    </section>
  );
}

export function Grid({ cards }: { cards: Card[] }) {
  return (
    <div className="grid">
      {cards.map((card) => (
        <PosterCard key={card.key} card={card} />
      ))}
    </div>
  );
}

export function RowSkeleton({ wide }: { wide?: boolean }) {
  return (
    <section className={`row row--${wide ? 'wide' : 'poster'}`} aria-hidden="true">
      <div className="row__head">
        <div className="skeleton skeleton--text" />
      </div>
      <div className="row__track">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`skeleton ${wide ? 'skeleton--wide' : 'skeleton--poster'}`} />
        ))}
      </div>
    </section>
  );
}
