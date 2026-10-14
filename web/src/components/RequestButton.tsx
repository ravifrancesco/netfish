import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import type { TitleDetail } from '@netfish/shared';
import { api } from '../api';
import { useRefreshTitle } from '../lib/hooks';
import { Modal, Spinner, useToast } from './ui';
import { t, tn } from '../i18n';

/** Request a movie, or pick which seasons of a show to request. Goes through Seerr as the signed-in user. */
export function RequestButton({ title, className = 'btn btn--accent' }: { title: TitleDetail; className?: string }) {
  const toast = useToast();
  const refresh = useRefreshTitle();
  const [picking, setPicking] = useState(false);
  const missing = (title.seasons ?? []).filter((s) => s.seasonNumber > 0 && s.status === 'none');
  const [chosen, setChosen] = useState<number[]>(() => missing.map((s) => s.seasonNumber));

  const request = useMutation({
    mutationFn: (seasons?: number[]) => api.request({ mediaType: title.mediaType, tmdbId: title.tmdbId!, seasons }),
    onSuccess: (res) => {
      setPicking(false);
      toast(
        'ok',
        res.status === 'pending'
          ? t('Requested {title}. Waiting for approval.', { title: title.title })
          : t("Requested {title}. It'll start downloading shortly.", { title: title.title }),
      );
      refresh(title.mediaType, title.tmdbId);
    },
    onError: (err) => toast('error', (err as Error).message),
  });

  if (!title.tmdbId || !title.canRequest) return null;
  const isTv = title.mediaType === 'tv';
  const partial = isTv && (title.seasons ?? []).some((s) => s.status !== 'none');

  return (
    <>
      <button className={className} disabled={request.isPending} onClick={() => (isTv ? setPicking(true) : request.mutate(undefined))}>
        {request.isPending ? <Spinner size={18} /> : <Plus size={20} />}
        {partial ? t('Request more') : t('Request')}
      </button>
      {picking && (
        <Modal
          title={t('Request {title}', { title: title.title })}
          onClose={() => setPicking(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setPicking(false)}>
                {t('Cancel')}
              </button>
              <button className="btn btn--accent" disabled={!chosen.length || request.isPending} onClick={() => request.mutate(chosen)}>
                {request.isPending ? <Spinner size={18} /> : <Check size={18} />}
                {chosen.length === missing.length && chosen.length > 1
                  ? t('Request all seasons')
                  : tn(chosen.length, 'Request {n} season', 'Request {n} seasons')}
              </button>
            </>
          }
        >
          <p className="muted">{t("Pick the seasons you want. Ones you already have aren't listed.")}</p>
          <div className="season-picks">
            <label className="check">
              <input
                type="checkbox"
                checked={chosen.length === missing.length}
                onChange={(e) => setChosen(e.target.checked ? missing.map((s) => s.seasonNumber) : [])}
              />
              <span>{t('All missing seasons')}</span>
            </label>
            {missing.map((s) => (
              <label key={s.seasonNumber} className="check">
                <input
                  type="checkbox"
                  checked={chosen.includes(s.seasonNumber)}
                  onChange={(e) =>
                    setChosen((c) => (e.target.checked ? [...c, s.seasonNumber].sort((a, b) => a - b) : c.filter((n) => n !== s.seasonNumber)))
                  }
                />
                <span>{s.name}</span>
                <span className="muted">{tn(s.episodeCount, '{n} episode', '{n} episodes')}</span>
              </label>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
