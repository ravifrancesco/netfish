import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleStop, HardDrive, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { DownloadItem, MediaType, StopMode, TitleDetail } from '@netfish/shared';
import { api } from '../api';
import { ago, bytes } from '../lib/format';
import { useRefreshTitle } from '../lib/hooks';
import { Modal, Spinner, useToast } from './ui';
import { t, tn } from '../i18n';

/** Lists that change when something is stopped, deleted or downloaded again. */
function useRefreshAll() {
  const qc = useQueryClient();
  const refresh = useRefreshTitle();
  return (mediaType?: MediaType, tmdbId?: number) => {
    refresh(mediaType, tmdbId);
    void qc.invalidateQueries({ queryKey: ['removed'] });
    void qc.invalidateQueries({ queryKey: ['storage'] });
    void qc.invalidateQueries({ queryKey: ['library'] });
  };
}

/** Stop a download: for good, or for another release. Admins, and whoever asked for it. */
export function StopDownload({ d, small }: { d: DownloadItem; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const refresh = useRefreshAll();
  const stop = useMutation({
    mutationFn: (mode: StopMode) => api.stopDownload(d.id, mode),
    onSuccess: (_r, mode) => {
      setOpen(false);
      refresh(d.mediaType, d.tmdbId);
      toast('ok', mode === 'replace' ? t('Looking for another release of {title}.', { title: d.title }) : t('Stopped {title}.', { title: d.title }));
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  return (
    <>
      <button
        type="button"
        className={small ? 'icon-btn icon-btn--sm' : 'btn btn--ghost btn--sm'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={t('Stop download')}
        title={t('Stop download')}
      >
        <CircleStop size={small ? 16 : 15} /> {!small && t('Stop')}
      </button>
      {open && (
        <Modal title={t('Stop downloading {title}?', { title: [d.title, d.mediaType === 'tv' ? d.detail : undefined].filter(Boolean).join(' · ') })} onClose={() => setOpen(false)}>
          <div className="choices">
            <button type="button" className="choice" disabled={stop.isPending} onClick={() => stop.mutate('replace')}>
              <RefreshCw size={20} />
              <span>
                <strong>{t('Try another release')}</strong>
                <span className="muted small">{t('Drops this download and finds another copy.')}</span>
              </span>
            </button>
            <button type="button" className="choice choice--danger" disabled={stop.isPending} onClick={() => stop.mutate('stop')}>
              <CircleStop size={20} />
              <span>
                <strong>{t('Stop for good')}</strong>
                <span className="muted small">
                  {d.mediaType === 'movie'
                    ? t('Cancels the download and stops looking for it.')
                    : t("Cancels the download and stops looking for these episodes.")}
                </span>
              </span>
            </button>
          </div>
          {stop.isPending && <Spinner />}
        </Modal>
      )}
    </>
  );
}

/** Admins: delete the files to free space; the title stays listed as "Not on disk". */
export function DeleteFromDisk({ d, menu }: { d: TitleDetail; menu?: boolean }) {
  const [open, setOpen] = useState(false);
  const seasonsOnDisk = d.disk?.seasons ?? [];
  const [chosen, setChosen] = useState<number[]>([]);
  const toast = useToast();
  const refresh = useRefreshAll();
  const isTv = d.mediaType === 'tv';
  const size = isTv ? seasonsOnDisk.filter((s) => chosen.includes(s.seasonNumber)).reduce((n, s) => n + s.size, 0) : (d.disk?.size ?? 0);
  const remove = useMutation({
    mutationFn: () => api.deleteFromDisk(d.mediaType, d.tmdbId!, isTv && chosen.length < seasonsOnDisk.length ? chosen : undefined),
    onSuccess: (r) => {
      setOpen(false);
      refresh(d.mediaType, d.tmdbId);
      toast('ok', t('Deleted from disk: {size} freed.', { size: bytes(r.freed) }));
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  if (!d.canManage || !d.disk || !d.tmdbId) return null;
  return (
    <>
      <button
        className={menu ? 'menu__item menu__item--danger' : 'btn btn--ghost btn--lg'}
        role={menu ? 'menuitem' : undefined}
        onClick={() => {
          setChosen(seasonsOnDisk.map((s) => s.seasonNumber));
          setOpen(true);
        }}
      >
        <Trash2 size={menu ? 18 : 20} /> {t('Delete from disk')}
      </button>
      {open && (
        <Modal
          title={t('Delete {title} from disk?', { title: d.title })}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </button>
              <button className="btn btn--danger" disabled={remove.isPending || (isTv && !chosen.length)} onClick={() => remove.mutate()}>
                {remove.isPending ? <Spinner size={16} /> : <Trash2 size={16} />} {t('Delete {size}', { size: bytes(size) })}
              </button>
            </>
          }
        >
          <div className="stack">
            {isTv && (
              <div className="seasons-pick">
                {seasonsOnDisk.map((s) => (
                  <label key={s.seasonNumber} className="check">
                    <input
                      type="checkbox"
                      checked={chosen.includes(s.seasonNumber)}
                      onChange={(e) => setChosen((list) => (e.target.checked ? [...list, s.seasonNumber] : list.filter((n) => n !== s.seasonNumber)))}
                    />
                    <span>
                      {s.seasonNumber === 0 ? t('Specials') : t('Season {n}', { n: s.seasonNumber })}{' '}
                      <span className="muted small">
                        · {tn(s.files, '{n} episode', '{n} episodes')} · {bytes(s.size)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="muted">
              {isTv
                ? t('Deletes the episodes from your server. You can download them again anytime.')
                : t('Deletes the file from your server. You can download it again anytime.')}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Admins: monitor it again in Radarr/Sonarr and search, so it comes back. */
/** Take a request back before anything is on disk: nobody looks for it any more, and it can be asked for again. */
export function CancelRequest({ d }: { d: TitleDetail }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const refresh = useRefreshAll();
  const cancel = useMutation({
    mutationFn: () => api.cancelRequest(d.mediaType, d.tmdbId!),
    onSuccess: () => {
      setOpen(false);
      refresh(d.mediaType, d.tmdbId);
      toast('ok', t('Request cancelled.'));
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  if (!d.tmdbId) return null;
  return (
    <>
      <button type="button" className="link-btn small" onClick={() => setOpen(true)}>
        {t('Cancel request')}
      </button>
      {open && (
        <Modal
          title={t('Cancel the request for {title}?', { title: d.title })}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setOpen(false)}>
                {t('Keep it')}
              </button>
              <button className="btn btn--danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                {cancel.isPending ? <Spinner size={16} /> : <CircleStop size={16} />} {t('Cancel request')}
              </button>
            </>
          }
        >
          <p className="muted">{t('Stops looking for it and withdraws the request.')}</p>
        </Modal>
      )}
    </>
  );
}

export function DownloadAgain({ d, seasons, className = 'btn btn--accent btn--sm' }: { d: TitleDetail; seasons?: number[]; className?: string }) {
  const toast = useToast();
  const refresh = useRefreshAll();
  const again = useMutation({
    mutationFn: () => api.downloadAgain(d.mediaType, d.tmdbId!, seasons),
    onSuccess: () => {
      refresh(d.mediaType, d.tmdbId);
      toast('ok', t('Looking for {title} again.', { title: d.title }));
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  if (!d.canManage || !d.tmdbId) return null;
  return (
    <button className={className} disabled={again.isPending} onClick={() => again.mutate()}>
      {again.isPending ? <Spinner size={16} /> : <RotateCcw size={16} />} {t('Download again')}
    </button>
  );
}

/** On the title page: deleted to save space, when, and how to get it back. */
export function RemovedNote({ d }: { d: TitleDetail }) {
  const r = d.removed;
  if (!r) return null;
  const which = r.seasons?.length
    ? tn(r.seasons.length, 'Season {list}', 'Seasons {list}', { list: r.seasons.join(', ') })
    : undefined;
  const text = [
    which ? t('{seasons} deleted from disk {when}', { seasons: which, when: ago(r.at) }) : t('Deleted from disk {when}', { when: ago(r.at) }),
    r.size ? t('{size} freed', { size: bytes(r.size) }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="statusbox__note statusbox__note--removed">
      <HardDrive size={16} />
      <span>
        <strong>{t('Not on disk')}</strong> · {text}.{' '}
        {!d.canManage && d.canRequest && t('Request it to download it again.')}
        {!d.canManage && !d.canRequest && t('An admin can download it again.')}
      </span>
      {/* A whole title gets its "Download again" next to Play and Trailer; a few seasons get it here. */}
      {r.seasons && <DownloadAgain d={d} seasons={r.seasons} />}
    </div>
  );
}
