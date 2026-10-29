import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tv } from 'lucide-react';
import type { ServerSettings } from '@netfish/shared';
import { api } from '../api';
import { t } from '../i18n';
import { Modal, Spinner, Switch, useToast } from './ui';

/**
 * Shows look after themselves: the next season when someone is 2 episodes from the end of
 * one, new episodes of shows they're up to date with. Each person is asked once (here, on Home
 * and on a title's page), and can change it in Settings; admins turn it on or off for everyone.
 */

const useKeepUp = () => useQuery({ queryKey: ['keep-up'], queryFn: api.keepUp, staleTime: 60_000 });

function useAnswer() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (answer: 'yes' | 'no') => api.setKeepUp(answer),
    onSuccess: (data) => qc.setQueryData(['keep-up'], data),
    onError: (err) => toast('error', (err as Error).message),
  });
}

/** Closed without an answer: not asked again until Netfish is opened again. */
let dismissed = false;

/** The question, the first time Netfish would get something for this person. */
export function KeepUpQuestion() {
  const q = useKeepUp();
  const answer = useAnswer();
  const [closed, setClosed] = useState(dismissed);
  const question = q.data?.question;
  if (!question || q.data?.answer || q.data?.off || closed) return null;
  const close = () => {
    dismissed = true;
    setClosed(true);
  };
  const title =
    question.kind === 'season'
      ? t('Get season {n} of {title} by itself?', { n: question.season ?? '', title: question.seriesTitle })
      : t('Get new episodes of {title} as they come out?', { title: question.seriesTitle });
  return (
    <Modal
      title={title}
      onClose={close}
      footer={
        <>
          <button className="btn btn--ghost" disabled={answer.isPending} onClick={() => answer.mutate('no')}>
            {t('No thanks')}
          </button>
          <button className="btn btn--accent" disabled={answer.isPending} onClick={() => answer.mutate('yes')}>
            {answer.isPending ? <Spinner size={16} /> : null} {t('Yes, get them')}
          </button>
        </>
      }
    >
      <p>{t('When you’re 2 episodes from the end of a season, Netfish gets the next one, and shows you’re up to date with get their new episodes as they come out. This is for all your shows.')}</p>
      <p className="muted small">{t('You can change it any time in Settings → Playback on this device.')}</p>
    </Modal>
  );
}

/** Settings → Playback: this person's answer. */
export function KeepUpSetting() {
  const q = useKeepUp();
  const answer = useAnswer();
  if (!q.data || q.data.off) return null;
  return (
    <div className="field">
      <label className="check">
        <input type="checkbox" checked={q.data.answer === 'yes'} disabled={answer.isPending} onChange={(e) => answer.mutate(e.target.checked ? 'yes' : 'no')} />
        <span>{t('Get the next season by itself')}</span>
      </label>
      <small className="muted">
        {t('When you’re 2 episodes from the end of a season, Netfish gets the next one, and shows you’re up to date with get their new episodes as they come out. For all your shows, on every device.')}
      </small>
    </div>
  );
}

const DAYS = [7, 14, 30, 60, 90, 180];

/** Settings → Shows (admins): for everyone, and what happens to seasons everyone has finished. */
export function ShowsUpkeep() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: api.adminSettings });
  const connections = useQuery({ queryKey: ['connections'], queryFn: api.connections });
  const save = useMutation({
    mutationFn: (patch: Partial<ServerSettings>) => api.saveAdminSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(['admin-settings'], data);
      void qc.invalidateQueries({ queryKey: ['keep-up'] });
      void qc.invalidateQueries({ queryKey: ['cleanup'] });
    },
    onError: (err) => toast('error', (err as Error).message),
  });
  if (!q.data) return <Spinner />;
  const s = q.data;
  const noKey = connections.data && !connections.data.items.find((c) => c.id === 'jellyfin')?.hasKey;
  return (
    <div className="stack">
      <div className="account">
        <Tv size={22} />
        <div className="chanset__about">
          <strong>{t('Next seasons and new episodes by themselves')}</strong>
          <span className="muted small">
            {t('When someone is 2 episodes from the end of a season, Netfish gets the next one (through Seerr, as them). Shows they’re up to date with get new episodes as they air. Each person says yes or no the first time.')}
          </span>
        </div>
        <span className="spacer" />
        <Switch on={s.keepUp} onChange={(on) => save.mutate({ keepUp: on })} label={t('Next seasons and new episodes by themselves')} disabled={save.isPending} />
      </div>
      <div className="field-row">
        <label className="field">
          <span>{t('Seasons everyone has finished')}</span>
          <select className="select" value={s.seasonCleanup} disabled={save.isPending} onChange={(e) => save.mutate({ seasonCleanup: e.target.value as ServerSettings['seasonCleanup'] })}>
            <option value="delete">{t('Delete from disk')}</option>
            <option value="suggest">{t('Only suggest them in Storage')}</option>
            <option value="off">{t('Leave them')}</option>
          </select>
        </label>
        {s.seasonCleanup !== 'off' && (
          <label className="field">
            <span>{t('After')}</span>
            <select className="select" value={s.seasonCleanupDays} disabled={save.isPending} onChange={(e) => save.mutate({ seasonCleanupDays: Number(e.target.value) })}>
              {(DAYS.includes(s.seasonCleanupDays) ? DAYS : [...DAYS, s.seasonCleanupDays].sort((a, b) => a - b)).map((n) => (
                <option key={n} value={n}>
                  {t('{n} days', { n })}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <small className="muted">
        {t(
          'A season everyone who started it has finished, the last of them that long ago. It’s listed in Storage for a day first, where you can keep it, and stays in the library as Not on disk, ready to download again. Never touched: anything kept, anything someone is partway through, New titles, and the latest season of a show still running.',
        )}
      </small>
      {noKey && s.seasonCleanup !== 'off' && <div className="item__warn">{t('Needs Jellyfin’s API key (Connections), to see what everyone has watched.')}</div>}
    </div>
  );
}

