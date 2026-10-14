import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { api } from '../api';
import { Grid } from '../components/Cards';
import { PeopleRow, personHref } from '../components/People';
import { ErrorState, Spinner } from '../components/ui';
import { t } from '../i18n';

export default function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  useEffect(() => {
    setDraft(q);
  }, [q]);
  useEffect(() => {
    const timer = setTimeout(() => draft !== q && navigate(`/search?q=${encodeURIComponent(draft)}`, { replace: true }), 350);
    return () => clearTimeout(timer);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="page container">
      {/* The nav search lives in the header on wide screens; phones get this one. */}
      <label className="input-icon page-search">
        <SearchIcon size={18} />
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('Titles, people, anything')} autoFocus />
      </label>
      {q.trim().length < 2 ? (
        <div className="empty">
          <p>{t('Search your library and everything you could add to it, or a director or actor to see their work.')}</p>
        </div>
      ) : results.isError ? (
        <ErrorState error={results.error} retry={() => void results.refetch()} />
      ) : !results.data ? (
        <Spinner size={28} />
      ) : !results.data.items.length && !results.data.people.length ? (
        <div className="empty">
          <p>{t('Nothing found for “{query}”.', { query: q })}</p>
        </div>
      ) : (
        <>
          <h1 className="page__title">{t('Results for “{query}”', { query: q })}</h1>
          {results.data.people.length > 0 && (
            <section className="search-block">
              <h2>{t('People')}</h2>
              <PeopleRow people={results.data.people} />
            </section>
          )}
          {results.data.person && (
            <section className="search-block">
              <h2>
                <Link to={personHref(results.data.person.id)} className="name-link">
                  {results.data.person.title}
                </Link>
              </h2>
              <Grid cards={results.data.person.items} />
            </section>
          )}
          {results.data.items.length > 0 && (
            <section className="search-block">
              {(results.data.people.length > 0 || results.data.person) && <h2>{t('Movies & shows')}</h2>}
              <Grid cards={results.data.items} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
