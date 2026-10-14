import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import type { DownloadItem, RequestItem } from '@netfish/shared';
import { api } from '../api';
import { ErrorState, Img, Progress, Spinner, StatusChip } from '../components/ui';
import { AVAILABILITY_LABEL, DOWNLOAD_LABEL, ago, bytes, duration, percent } from '../lib/format';
import { useConfig, useMe } from '../lib/hooks';

function DownloadRow({ d }: { d: DownloadItem }) {
  const href = d.tmdbId ? `/title/${d.mediaType}/${d.tmdbId}` : undefined;
  const stats = [
    d.state === 'downloading' ? percent(d.progress) : undefined,
    d.size ? `${bytes(d.size - d.sizeLeft)} of ${bytes(d.size)}` : undefined,
    d.etaSeconds ? `${duration(d.etaSeconds)} left` : undefined,
    d.speed ? `${bytes(d.speed)}/s` : undefined,
  ].filter(Boolean);
  const body = (
    <>
      <Img src={d.poster} className="item__poster" fallback={<span>{d.title[0]}</span>} />
      <div className="item__body">
        <div className="item__top">
          <span className="item__title">{d.title}</span>
          <span className={`state state--${d.state}`}>{DOWNLOAD_LABEL[d.state]}</span>
        </div>
        <div className="item__sub muted">
          {[d.detail, d.quality, d.languages.join(', ')].filter(Boolean).join(' · ')}
        </div>
        <Progress value={d.progress} tone={d.state === 'stalled' || d.state === 'warning' || d.state === 'failed' ? 'warn' : 'accent'} />
        <div className="item__stats muted small">{stats.join(' · ')}</div>
        {d.message && (
          <div className="item__warn">
            <TriangleAlert size={14} /> {d.message}
          </div>
        )}
        {d.releaseTitle && <div className="item__release">{d.releaseTitle}</div>}
      </div>
    </>
  );
  return <li className="item">{href ? <Link to={href} className="item__link">{body}</Link> : <div className="item__link">{body}</div>}</li>;
}

function Downloads() {
  const q = useQuery({ queryKey: ['downloads'], queryFn: api.downloads, refetchInterval: 3000 });
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Spinner size={28} />;
  const mine = q.data.items.filter((d) => d.mine);
  const others = q.data.items.filter((d) => !d.mine);
  if (!q.data.items.length) return <div className="empty"><p>Nothing is downloading right now.</p></div>;
  return (
    <>
      {mine.length > 0 && (
        <section className="section">
          <h2>Requested by you</h2>
          <ul className="items">{mine.map((d) => <DownloadRow key={d.id} d={d} />)}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section className="section">
          <h2>{mine.length ? 'Everything else' : 'Downloading'}</h2>
          <ul className="items">{others.map((d) => <DownloadRow key={d.id} d={d} />)}</ul>
        </section>
      )}
    </>
  );
}

const REQUEST_LABEL: Record<RequestItem['requestStatus'], string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  declined: 'Declined',
  failed: 'Failed',
  completed: 'Done',
};

function Requests({ scope }: { scope: 'mine' | 'all' }) {
  const q = useQuery({ queryKey: ['requests', scope], queryFn: () => api.requests(scope), refetchInterval: 10_000 });
  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Spinner size={28} />;
  if (!q.data.items.length) return <div className="empty"><p>No requests yet. Find something and hit Request.</p></div>;
  return (
    <ul className="items">
      {q.data.items.map((r) => (
        <li key={r.id} className="item">
          <Link to={`/title/${r.mediaType}/${r.tmdbId}`} className="item__link">
            <Img src={r.poster} className="item__poster" fallback={<span>{r.title[0]}</span>} />
            <div className="item__body">
              <div className="item__top">
                <span className="item__title">
                  {r.title} {r.year && <span className="muted">({r.year})</span>}
                </span>
                {r.status === 'available' ? (
                  <span className="state state--done">{AVAILABILITY_LABEL.available}</span>
                ) : r.requestStatus === 'pending' || r.requestStatus === 'declined' ? (
                  <span className={`state state--${r.requestStatus}`}>{REQUEST_LABEL[r.requestStatus]}</span>
                ) : (
                  <StatusChip status={r.status} progress={r.download?.progress} />
                )}
              </div>
              <div className="item__sub muted">
                {r.mediaType === 'tv' && r.seasons?.length ? `Season${r.seasons.length > 1 ? 's' : ''} ${r.seasons.join(', ')} · ` : ''}
                {r.mine ? 'You' : r.requestedBy} · {ago(r.createdAt)}
              </div>
              {r.download && (
                <>
                  <Progress value={r.download.progress} />
                  <div className="item__stats muted small">
                    {[DOWNLOAD_LABEL[r.download.state], percent(r.download.progress), r.download.etaSeconds ? `${duration(r.download.etaSeconds)} left` : undefined]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ActivityPage() {
  const { data: config } = useConfig();
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? (config?.features.downloads ? 'downloads' : 'requests');
  const scope = params.get('scope') === 'all' ? 'all' : 'mine';
  const tabs = [
    ...(config?.features.downloads ? [{ value: 'downloads', label: 'Downloads' }] : []),
    ...(config?.features.requests ? [{ value: 'requests', label: 'Requests' }] : []),
  ];

  return (
    <div className="page container">
      <div className="page__head">
        <h1>Activity</h1>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.value} role="tab" aria-selected={tab === t.value} className={`tab${tab === t.value ? ' is-active' : ''}`} onClick={() => setParams({ tab: t.value }, { replace: true })}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'requests' && me?.isAdmin && (
          <label className="check">
            <input type="checkbox" checked={scope === 'all'} onChange={(e) => setParams({ tab, scope: e.target.checked ? 'all' : 'mine' }, { replace: true })} />
            <span>Everyone's requests</span>
          </label>
        )}
      </div>
      {tab === 'downloads' ? <Downloads /> : tab === 'requests' ? <Requests scope={scope} /> : <div className="empty"><p>Downloads and requests aren't set up on this server.</p></div>}
    </div>
  );
}
