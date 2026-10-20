import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Captions, CircleCheck, CircleX } from 'lucide-react';
import type { TitleDetail } from '@netfish/shared';
import { api } from '../api';
import { useRefreshTitle } from '../lib/hooks';
import { getPrefs } from '../lib/prefs';
import { LanguageSelect } from './LanguageSelect';
import { Modal, Progress, Spinner, useToast } from './ui';
import { t } from '../i18n';

/** Ask Bazarr for subtitles in any language, for a movie, a season or one episode. */
export function SubtitlesSheet({ title, onClose, seasonNumber }: { title: TitleDetail; onClose: () => void; seasonNumber?: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefreshTitle();
  const isTv = title.mediaType === 'tv';
  const seasons = (title.seasons ?? []).filter((s) => s.status === 'available' || s.status === 'partial');
  const [language, setLanguage] = useState(getPrefs().subtitleLanguage || 'en');
  const [season, setSeason] = useState(seasonNumber ?? seasons[0]?.seasonNumber ?? 1);
  const [episodeId, setEpisodeId] = useState('');
  const [hi, setHi] = useState(false);

  const episodes = useQuery({
    queryKey: ['season', title.mediaType, String(title.tmdbId), season],
    queryFn: () => api.season({ type: 'tv', id: title.tmdbId! }, season),
    enabled: isTv,
  });

  const jobs = useQuery({
    queryKey: ['jobs', title.mediaType, title.tmdbId],
    queryFn: () => api.jobs(title.mediaType, title.tmdbId!),
    refetchInterval: (q) => (q.state.data?.items.some((j) => j.state === 'running') ? 2000 : false),
  });

  const running = jobs.data?.items.some((j) => j.state === 'running');
  useEffect(() => {
    if (jobs.data && !running) refresh(title.mediaType, title.tmdbId);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useMutation({
    mutationFn: () =>
      api.subtitles(title.mediaType, title.tmdbId!, {
        language,
        ...(isTv ? (episodeId ? { episodeId } : { seasonNumber: season }) : {}),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs', title.mediaType, title.tmdbId] }),
    onError: (err) => toast('error', (err as Error).message),
  });

  return (
    <Modal
      title={`${t('Subtitles')} · ${title.title}`}
      onClose={onClose}
      footer={
        <button className="btn btn--accent" disabled={start.isPending || !language} onClick={() => start.mutate()}>
          {start.isPending ? <Spinner size={18} /> : <Captions size={18} />}
          {t('Find subtitles')}
        </button>
      }
    >
      <div className="stack">
        {title.subtitles.length > 0 && (
          <p className="muted">
            {t('Already available: {list}', { list: title.subtitles.map((s) => (s.forced ? t('{label} (forced)', { label: s.label }) : s.label)).join(', ') })}
          </p>
        )}
        <label className="field">
          <span>{t('Language')}</span>
          <LanguageSelect value={language} onChange={setLanguage} />
        </label>
        {isTv && (
          <div className="field-row">
            <label className="field">
              <span>{t('Season')}</span>
              <select className="select" value={season} onChange={(e) => (setSeason(Number(e.target.value)), setEpisodeId(''))}>
                {seasons.map((s) => (
                  <option key={s.seasonNumber} value={s.seasonNumber}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('Episodes')}</span>
              <select className="select" value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}>
                <option value="">{t('All in this season')}</option>
                {(episodes.data?.episodes ?? [])
                  .filter((e) => e.jellyfinId)
                  .map((e) => (
                    <option key={e.jellyfinId} value={e.jellyfinId}>
                      {e.episodeNumber}. {e.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={hi} onChange={(e) => setHi(e.target.checked)} />
          <span>{t('Hearing-impaired (SDH) subtitles')}</span>
        </label>

        {(jobs.data?.items.length ?? 0) > 0 && (
          <ul className="jobs">
            {jobs.data!.items.map((j) => (
              <li key={j.id} className={`job job--${j.state}`}>
                {j.state === 'running' ? <Spinner size={16} /> : j.state === 'done' ? <CircleCheck size={16} /> : <CircleX size={16} />}
                <div className="job__body">
                  <div className="job__label">{j.label}</div>
                  {j.state === 'running' ? (
                    <>
                      <Progress value={j.total ? j.done / j.total : 0} />
                      <span className="muted small">
                        {t('{done} of {total} searched…', { done: j.done, total: j.total })}
                      </span>
                    </>
                  ) : (
                    <span className="muted small">{j.message}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
