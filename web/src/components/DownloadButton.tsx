import { useMutation } from '@tanstack/react-query';
import { ArrowDownToLine, CircleCheck, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { appKind, canDownloadHere, desktop, useOffline } from '../lib/desktop';
import { Spinner, useToast } from './ui';

/** Save a movie or episode to this device for offline viewing (desktop and iPhone/iPad apps). */
export function DownloadButton({ itemId, compact }: { itemId: string; compact?: boolean }) {
  const list = useOffline();
  const toast = useToast();
  const entry = list.find((i) => i.itemId === itemId);
  const start = useMutation({
    mutationFn: async () => {
      if (entry && (entry.state === 'failed' || entry.state === 'interrupted')) return desktop()!.retryOffline!(itemId);
      const app = desktop()!;
      return app.download!(await api.offline(itemId, app.offlineFormat ?? (app.platform === 'ios' ? 'apple' : 'desktop')));
    },
    onSuccess: () => toast('ok', `Downloading to ${appKind().device}. Find it in the Offline tab, or under Downloads in your profile menu.`),
    onError: (err) => toast('error', (err as Error).message),
  });
  if (!canDownloadHere()) return null;

  const pct = entry?.size ? Math.min(99, Math.round((entry.received / entry.size) * 100)) : undefined;
  let icon = <ArrowDownToLine size={compact ? 16 : 20} />;
  let label = 'Download';
  let onClick = () => start.mutate();
  if (start.isPending) {
    icon = <Spinner size={compact ? 14 : 18} />;
    label = 'Preparing…';
  } else if (entry?.state === 'done') {
    icon = <CircleCheck size={compact ? 16 : 20} />;
    label = 'Downloaded';
    onClick = () => desktop()?.openOffline?.();
  } else if (entry?.state === 'downloading' || entry?.state === 'paused') {
    icon = <Spinner size={compact ? 14 : 18} />;
    label = pct !== undefined ? `Downloading ${pct}%` : 'Downloading…';
    onClick = () => desktop()?.openOffline?.();
  } else if (entry) {
    icon = <RotateCcw size={compact ? 16 : 20} />;
    label = 'Retry download';
  }

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
