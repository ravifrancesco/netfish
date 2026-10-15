import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Trash2 } from 'lucide-react';
import type { StorageInfo } from '@netfish/shared';
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
              ? t("The file is deleted from your server. The movie stays in your library as Not on disk, and you can download it again any time.")
              : t('The episodes are deleted from your server. The show stays in your library, and you can download them again any time.')}
          </p>
        </Modal>
      )}
    </>
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
        {s.removed > 0 && (
          <Link to="/movies?tab=removed" className="name-link">
            {tn(s.removed, '{n} title is not on disk.', '{n} titles are not on disk.')}
          </Link>
        )}
      </p>
    </div>
  );
}
