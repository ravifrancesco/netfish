import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Grid } from '../components/Cards';
import { Empty, ErrorState, Img, PageLoader } from '../components/ui';
import { locale, t } from '../i18n';

const longDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
};

/** A director, actor or writer: who they are and everything they made, what's in the library first. */
export default function PersonPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['person', id], queryFn: () => api.person(id) });
  const [fullBio, setFullBio] = useState(false);

  if (q.isError) {
    return (
      <div className="page container">
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="page container">
        <PageLoader />
      </div>
    );
  }

  const p = q.data;
  const life = [
    p.knownFor,
    p.born && p.died ? `${p.born.slice(0, 4)}–${p.died.slice(0, 4)}` : p.born ? t('Born {date}', { date: longDate(p.born) }) : undefined,
    p.birthplace,
  ].filter(Boolean);

  return (
    <div className="page container">
      <header className="ph">
        <Img src={p.photo} className="ph__img" fallback={<span>{p.name[0]}</span>} />
        <div className="ph__text">
          <h1 className="page__title">{p.name}</h1>
          {life.length > 0 && <p className="muted">{life.join(' · ')}</p>}
          {p.biography && (
            <>
              <p className={`ph__bio${fullBio ? ' is-open' : ''}`}>{p.biography}</p>
              {p.biography.length > 420 && (
                <button type="button" className="link-btn" onClick={() => setFullBio((v) => !v)}>
                  {fullBio ? t('Less') : t('More')}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {p.sections.map((s) => (
        <section key={s.kind} className="section">
          <h2>{s.title}</h2>
          <Grid cards={s.items} markAvailable />
        </section>
      ))}
      {p.sections.length === 0 && (
        <Empty>{t('Nothing by {name} to show yet.', { name: p.name })}</Empty>
      )}
    </div>
  );
}
