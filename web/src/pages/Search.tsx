import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { api } from '../api';
import { Grid } from '../components/Cards';
import { ErrorState, Spinner } from '../components/ui';

export default function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  useEffect(() => {
    setDraft(q);
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => draft !== q && navigate(`/search?q=${encodeURIComponent(draft)}`, { replace: true }), 350);
    return () => clearTimeout(t);
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
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search movies and shows" autoFocus />
      </label>
      {q.trim().length < 2 ? (
        <div className="empty">
          <p>Search your library and everything you could add to it.</p>
        </div>
      ) : results.isError ? (
        <ErrorState error={results.error} retry={() => void results.refetch()} />
      ) : !results.data ? (
        <Spinner size={28} />
      ) : results.data.items.length === 0 ? (
        <div className="empty">
          <p>Nothing found for “{q}”.</p>
        </div>
      ) : (
        <>
          <h1 className="page__title">Results for “{q}”</h1>
          <Grid cards={results.data.items} />
        </>
      )}
    </div>
  );
}
