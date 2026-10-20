import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Sparkles, Trash2 } from 'lucide-react';
import type { CleanupSuggestion, StorageInfo } from '@netfish/shared';
import { api } from '../api';
import { bytes } from '../lib/format';
import { Img, Modal, Progress, Spinner, useToast } from './ui';
import { t, tn } from '../i18n';

type Big = StorageInfo['biggest'][number];

function DeleteBig({ item, onDone }: { item: Big; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => api.deleteFromDisk(item.mediaType, item.tmdbId!),
    onSuccess: (r) => {
      setOpen(false);
      toast('ok', t('Deleted from disk: {size} freed.', { size: bytes(r.freed) }));
      onDone();
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  if (!item.tmdbId) return null;
  return (
    <>
      <button className="icon-btn icon-btn--sm" onClick={() => setOpen(true)} aria-label={t('Delete from disk')} title={t('Delete from disk')}>
        <Trash2 size={16} />
      </button>
      {open && (
        <Modal
          title={t('Delete {title} from disk?', { title: item.title })}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </button>
              <button className="btn btn--danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? <Spinner size={16} /> : <Trash2 size={16} />} {t('Delete {size}', { size: bytes(item.size) })}
              </button>
            </>
          }
        >
          <p className="muted">
            {item.mediaType === 'movie'
              ? t("Deletes the file from your server. You can download it again anytime.")
              : t('Deletes the episodes from your server. You can download them again anytime.')}
          </p>
        </Modal>
      )}
    </>
  );
}

const monthsSince = (iso: string) => Math.max(1, Math.round((Date.now() - Date.parse(iso)) / (30.4 * 86_400_000)));

function why(s: CleanupSuggestion) {
  const n = monthsSince(s.since);
  return s.reason === 'finished'
    ? tn(n, 'Everyone finished it · last watched a month ago', 'Everyone finished it · last watched {n} months ago')
    : tn(n, 'Nobody has watched it · arrived a month ago', 'Nobody has watched it · arrived {n} months ago');
}

/** Things that could go: finished long ago, or never watched in a year. Tick and delete; or keep for good. */
function Cleanup({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['cleanup'], queryFn: api.cleanup });
  const [chosen, setChosen] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const items = q.data?.items ?? [];
  const selected = items.filter((s) => chosen.includes(s.key));
  const total = selected.reduce((n, s) => n + s.size, 0);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cleanup'] });
    onDone();
  };
  const keep = useMutation({ mutationFn: (key: string) => api.keepForGood(key), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: async () => {
      let freed = 0;
      for (const s of selected) if (s.tmdbId) freed += (await api.deleteFromDisk(s.mediaType, s.tmdbId)).freed;
      return freed;
    },
    onSuccess: (freed) => {
      setConfirming(false);
      setChosen([]);
      toast('ok', t('Deleted from disk: {size} freed.', { size: bytes(freed) }));
      refresh();
    },
    onError: (err) => {
      toast('error', (err as Error).message);
      refresh();
    },
  });

  if (!q.data || !items.length) return null;
  return (
    <div className="cleanup">
      <div className="cleanup__head">
        <Sparkles size={18} />
        <strong>{t('Could go to free space')}</strong>
        <span className="spacer" />
        <button className="btn btn--danger btn--sm" disabled={!selected.length || remove.isPending} onClick={() => setConfirming(true)}>
          <Trash2 size={15} /> {selected.length ? t('Delete {size}', { size: bytes(total) }) : t('Delete')}
        </button>
      </div>
      <ul className="bigs">
        {items.map((s) => (
          <li key={s.key} className="big">
            <input
              type="checkbox"
              checked={chosen.includes(s.key)}
              onChange={(e) => setChosen((list) => (e.target.checked ? [...list, s.key] : list.filter((k) => k !== s.key)))}
              aria-label={s.title}
            />
            <Img src={s.poster} className="big__poster" fallback={<span>{s.title[0]}</span>} />
            <span className="big__title">
              <Link to={`/title/${s.mediaType}/${s.tmdbId}`} className="name-link">
                {s.title}
              </Link>{' '}
              {s.year && <span className="muted">({s.year})</span>}
              <span className="big__why muted small">
                {why(s)}
                <span className="big__size-inline"> · {bytes(s.size)}</span>
              </span>
            </span>
            <span className="muted small big__size">{bytes(s.size)}</span>
            <button className="link-btn small" disabled={keep.isPending} onClick={() => keep.mutate(s.key)} title={t("Don't suggest it again")}>
              {t('Keep')}
            </button>
          </li>
        ))}
      </ul>
      {confirming && (
        <Modal
          title={tn(selected.length, 'Delete {n} title from disk?', 'Delete {n} titles from disk?')}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setConfirming(false)}>
                {t('Cancel')}
              </button>
              <button className="btn btn--danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? <Spinner size={16} /> : <Trash2 size={16} />} {t('Delete {size}', { size: bytes(total) })}
              </button>
            </>
          }
        >
          <p className="muted">{t('They stay in your library as Not on disk, and you can download any of them again.')}</p>
        </Modal>
      )}
    </div>
  );
}

/** Admin: how full the disks are, what takes the space, and a quick way to free some. */
export function Storage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['storage'], queryFn: api.storage });
  if (q.isError) return <p className="conn__result is-bad">{(q.error as Error).message}</p>;
  if (!q.data) return <Spinner />;
  const s = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['storage'] });
    void qc.invalidateQueries({ queryKey: ['removed'] });
  };
  const holds = (h: string[]) => (h.length > 1 ? t('Movies and shows') : h[0] === 'movie' ? t('Movies') : t('Shows'));

  return (
    <div className="storage">
      {s.disks.map((d) => (
        <div key={d.path} className="disk">
          <div className="disk__head">
            <HardDrive size={18} />
            <strong>{holds(d.holds)}</strong>
            <span className="muted small">{d.path}</span>
            <span className="spacer" />
            <span className={d.free / d.total < 0.1 ? 'disk__free is-low' : 'disk__free'}>{t('{free} free of {total}', { free: bytes(d.free), total: bytes(d.total) })}</span>
          </div>
          <Progress value={(d.total - d.free) / d.total} tone={d.free / d.total < 0.1 ? 'warn' : 'accent'} />
        </div>
      ))}
      {!s.disks.length && <p className="muted small">{t("Radarr and Sonarr didn't report any disks.")}</p>}

      <div className="storage__totals muted small">
        {s.movies && <span>{t('Movies: {count} · {size}', { count: s.movies.count, size: bytes(s.movies.size) })}</span>}
        {s.shows && <span>{t('Shows: {count} · {size}', { count: s.shows.count, size: bytes(s.shows.size) })}</span>}
      </div>

      <Cleanup onDone={refresh} />

      {s.biggest.length > 0 && (
        <>
          <strong className="small">{t('Biggest on disk')}</strong>
          <ul className="bigs">
            {s.biggest.map((b) => (
              <li key={b.key} className="big">
                <Img src={b.poster} className="big__poster" fallback={<span>{b.title[0]}</span>} />
                {b.tmdbId ? (
                  <Link to={`/title/${b.mediaType}/${b.tmdbId}`} className="big__title">
                    {b.title} {b.year && <span className="muted">({b.year})</span>}
                  </Link>
                ) : (
                  <span className="big__title">{b.title}</span>
                )}
                <span className="muted small">{bytes(b.size)}</span>
                <DeleteBig item={b} onDone={refresh} />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">
        {t('Deleting frees the space but keeps the title in your library as Not on disk, ready to download again.')}{' '}
        {s.removed.movies > 0 && (
          <Link to="/movies?gone=1" className="name-link">
            {tn(s.removed.movies, '{n} film is not on disk.', '{n} films are not on disk.')}
          </Link>
        )}{' '}
        {s.removed.shows > 0 && (
          <Link to="/shows?gone=1" className="name-link">
            {tn(s.removed.shows, '{n} show is not on disk.', '{n} shows are not on disk.')}
          </Link>
        )}
      </p>
    </div>
  );
}
