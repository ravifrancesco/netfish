import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { ArrowDownToLine, CircleCheck, FolderOpen, Play, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { appKind, canDownloadHere, desktop, useOffline, type OfflineItem } from '../lib/desktop';
import { Modal, Spinner, useToast } from './ui';
import { t } from '../i18n';

const RING = 2 * Math.PI * 23; // the round button's outline, r = 23 in a 48×48 box

/**
 * The title page's round download button. Downloading, its outline fills with the accent
 * colour as the film comes in; downloaded, the arrow turns accent. Pressed then, it offers
 * to play the copy on this device or delete it.
 */
function RoundDownload({ itemId, entry, start, starting }: { itemId: string; entry?: OfflineItem; start: () => void; starting: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  // Play goes through the player page: it opens this download from where you got to.
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const state = starting ? 'starting' : (entry?.state ?? 'none');
  const loading = state === 'downloading' || state === 'paused' || state === 'starting';
  const fraction = entry?.size ? Math.min(1, entry.received / entry.size) : undefined;
  const pct = fraction !== undefined ? Math.min(99, Math.floor(fraction * 100)) : undefined;
  const label =
    state === 'done'
      ? t('Downloaded to {device}', { device: appKind().device })
      : state === 'starting'
        ? t('Preparing…')
        : loading
          ? pct !== undefined
            ? t('Downloading {pct}%', { pct })
            : t('Downloading…')
          : entry
            ? t('Retry download')
            : t('Download');
  const remove = async () => {
    setConfirm(false);
    await desktop()?.removeOffline?.(itemId);
    toast('ok', state === 'done' ? t('Download deleted from {device}.', { device: appKind().device }) : t('Download cancelled.'));
  };

  return (
    <div className="more" ref={ref}>
      <button
        className={`round-btn${loading ? ' round-btn--ring' : ''}${state === 'done' ? ' is-done' : ''}${open ? ' is-active' : ''}`}
        data-tip={label}
        aria-label={label}
        aria-expanded={entry && (loading || state === 'done') ? open : undefined}
        onClick={() => (entry && (loading || state === 'done') ? setOpen((o) => !o) : start())}
        disabled={starting}
      >
        {state === 'failed' || state === 'interrupted' ? <RotateCcw size={20} /> : <ArrowDownToLine size={20} />}
        {loading && (
          <svg className={`round-btn__ring${fraction === undefined ? ' is-spinning' : ''}${state === 'paused' ? ' is-paused' : ''}`} viewBox="0 0 48 48" aria-hidden="true">
            <circle className="round-btn__track" cx="24" cy="24" r="23" />
            <circle
              className="round-btn__fill"
              cx="24"
              cy="24"
              r="23"
              strokeDasharray={fraction === undefined ? `${RING * 0.2} ${RING}` : `${Math.max(0.01, fraction) * RING} ${RING}`}
            />
          </svg>
        )}
      </button>
      <div className="menu more__menu" role="menu" hidden={!open} onClick={() => setOpen(false)}>
        <div className="menu__head">
          <strong>{label}</strong>
        </div>
        {state === 'done' ? (
          <>
            <button className="menu__item" role="menuitem" onClick={() => navigate(`/watch/${itemId}`)}>
              <Play size={18} /> {t('Play the download')}
            </button>
            <button className="menu__item menu__item--danger" role="menuitem" onClick={() => setConfirm(true)}>
              <Trash2 size={18} /> {t('Delete the download')}
            </button>
          </>
        ) : (
          <>
            <button className="menu__item" role="menuitem" onClick={() => desktop()?.openOffline?.()}>
              <FolderOpen size={18} /> {t('Show downloads')}
            </button>
            <button className="menu__item menu__item--danger" role="menuitem" onClick={() => void remove()}>
              <X size={18} /> {t('Cancel download')}
            </button>
          </>
        )}
      </div>
      {confirm && (
        <Modal
          title={t('Delete the download of {title}?', { title: entry?.title ?? '' })}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setConfirm(false)}>
                {t('Cancel')}
              </button>
              <button className="btn btn--danger" onClick={() => void remove()}>
                <Trash2 size={16} /> {t('Delete')}
              </button>
            </>
          }
        >
          <p className="muted">{t('Only the copy on {device} goes; the film stays on your server.', { device: appKind().device })}</p>
        </Modal>
      )}
    </div>
  );
}

/** Save a movie or episode to this device for offline viewing (desktop and iPhone/iPad apps). */
export function DownloadButton({ itemId, compact, round }: { itemId: string; compact?: boolean; round?: boolean }) {
  const list = useOffline();
  const toast = useToast();
  const entry = list.find((i) => i.itemId === itemId);
  const start = useMutation({
    mutationFn: async () => {
      if (entry && (entry.state === 'failed' || entry.state === 'interrupted')) return desktop()!.retryOffline!(itemId);
      const app = desktop()!;
      return app.download!(await api.offline(itemId, app.offlineFormat ?? (app.platform === 'ios' ? 'apple' : 'desktop')));
    },
    onSuccess: () =>
      toast('ok', t('Downloading to {device}. Find it in the Offline tab, or under Downloads in your profile menu.', { device: appKind().device })),
    onError: (err) => toast('error', (err as Error).message),
  });
  if (!canDownloadHere()) return null;

  const pct = entry?.size ? Math.min(99, Math.round((entry.received / entry.size) * 100)) : undefined;
  let icon = <ArrowDownToLine size={compact ? 16 : 20} />;
  let label = t('Download');
  let onClick = () => start.mutate();
  if (start.isPending) {
    icon = <Spinner size={compact ? 14 : 18} />;
    label = t('Preparing…');
  } else if (entry?.state === 'done') {
    icon = <CircleCheck size={compact ? 16 : 20} />;
    label = t('Downloaded');
    onClick = () => desktop()?.openOffline?.();
  } else if (entry?.state === 'downloading' || entry?.state === 'paused') {
    icon = <Spinner size={compact ? 14 : 18} />;
    label = pct !== undefined ? t('Downloading {pct}%', { pct }) : t('Downloading…');
    onClick = () => desktop()?.openOffline?.();
  } else if (entry) {
    icon = <RotateCcw size={compact ? 16 : 20} />;
    label = t('Retry download');
  }

  if (round) return <RoundDownload itemId={itemId} entry={entry} start={() => start.mutate()} starting={start.isPending} />;
  if (compact) {
    return (
      <button className={`icon-btn icon-btn--sm${entry?.state === 'done' ? ' is-done' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={start.isPending}>
        {icon}
      </button>
    );
  }
  return (
    <button className="btn btn--ghost btn--lg" onClick={onClick} disabled={start.isPending}>
      {icon} {label}
    </button>
  );
}
