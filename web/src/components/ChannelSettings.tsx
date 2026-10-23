import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, History, Play, Plus, RadioTower, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { ChannelAdmin, ChannelDef, ChannelSettings as Settings, ChannelSource } from '@netfish/shared';
import { api } from '../api';
import { ErrorState, Modal, Spinner, Switch, useToast } from './ui';
import { FreshTitles } from './FreshTitles';
import { t, tn } from '../i18n';

/** Where this device is: the 9pm film is at 9pm here. */
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** What a channel plays, in a few words (`genres`: the library's, as it spells them). */
function describe(source: ChannelSource, genres: string[]): string {
  switch (source.kind) {
    case 'mix':
      return t('A day of TV: a documentary at 1pm, sitcoms, cartoons, a film at 9pm');
    case 'cartoons':
      return t('Animated shows, and now and then a film');
    case 'sitcoms':
      return t('Comedy shows, a different one each time');
    case 'films':
      // The channel lists genres in several languages; only the library's own show.
      return t('Films: {genres}', { genres: genres.filter((g) => source.genres.includes(g.toLowerCase())).slice(0, 4).join(', ') || source.genres[0] });
    case 'genre':
      return source.movies && source.episodes ? t('{genre}: films and episodes', { genre: source.genre }) : source.episodes ? t('{genre}: episodes', { genre: source.genre }) : t('{genre}: films', { genre: source.genre });
    case 'series':
      return t('{show}, in order', { show: source.seriesName });
    case 'recent':
      return t('The newest films');
    case 'shows':
      return t('Episodes of every show');
  }
}

type Kind = Exclude<ChannelSource['kind'], 'films'>;

function AddChannel({ data, onAdd, busy }: { data: ChannelAdmin; onAdd: (def: Pick<ChannelDef, 'name' | 'source'>) => void; busy: boolean }) {
  const [kind, setKind] = useState<Kind>('genre');
  const [genre, setGenre] = useState(data.genres[0]?.name ?? '');
  const [films, setFilms] = useState(true);
  const [episodes, setEpisodes] = useState(false);
  const [seriesId, setSeriesId] = useState(data.series[0]?.id ?? '');
  const [name, setName] = useState('');
  const series = data.series.find((s) => s.id === seriesId);
  const source: ChannelSource | undefined =
    kind === 'genre'
      ? genre && (films || episodes) ? { kind, genre, movies: films, episodes } : undefined
      : kind === 'series'
        ? series ? { kind, seriesId: series.id, seriesName: series.name } : undefined
        : ({ kind } as ChannelSource);
  return (
    <div className="chanset__add">
      <h3>{t('Add a channel')}</h3>
      <div className="chanset__fields">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label={t('What it plays')}>
          <option value="mix">{t('A day of TV, like Netfish')}</option>
          <option value="cartoons">{t('Cartoons')}</option>
          <option value="sitcoms">{t('Sitcoms')}</option>
          <option value="genre">{t('A genre')}</option>
          <option value="series">{t('One show, in order')}</option>
          <option value="recent">{t('The newest films')}</option>
          <option value="shows">{t('Episodes of every show')}</option>
        </select>
        {kind === 'genre' && (
          <>
            <select className="select" value={genre} onChange={(e) => setGenre(e.target.value)} aria-label={t('Genre')}>
              {data.genres.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name} ({[g.movies ? tn(g.movies, '{n} film', '{n} films') : '', g.episodes ? tn(g.episodes, '{n} episode', '{n} episodes') : ''].filter(Boolean).join(', ')})
                </option>
              ))}
            </select>
            <label className="check">
              <input type="checkbox" checked={films} onChange={(e) => setFilms(e.target.checked)} /> {t('Films')}
            </label>
            <label className="check">
              <input type="checkbox" checked={episodes} onChange={(e) => setEpisodes(e.target.checked)} /> {t('Episodes')}
            </label>
          </>
        )}
        {kind === 'series' && (
          <select className="select" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} aria-label={t('Show')}>
            {data.series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({tn(s.episodes, '{n} episode', '{n} episodes')})
              </option>
            ))}
          </select>
        )}
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name (optional)')} maxLength={40} aria-label={t('Name')} />
        <button
          className="btn btn--accent btn--sm"
          disabled={!source || busy}
          onClick={() => {
            if (!source) return;
            onAdd({ name: name.trim(), source });
            setName('');
          }}
        >
          <Plus size={16} /> {t('Add')}
        </button>
      </div>
    </div>
  );
}

/**
 * Settings → Channels (admins): turn them on, and shape the line-up. Turned on for the first
 * time, Netfish makes a starting set from the library (the biggest genres, the newest films,
 * every show); everything can be renamed, reordered, hidden, removed or added to.
 */
export function ChannelSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['channelAdmin'], queryFn: api.channelAdmin });
  const done = (data: ChannelAdmin) => {
    qc.setQueryData(['channelAdmin'], data);
    void qc.invalidateQueries({ queryKey: ['config'] });
    void qc.invalidateQueries({ queryKey: ['channels'] });
    // The server looks again straight away (starting, or removing what's no longer wanted).
    setTimeout(() => void qc.invalidateQueries({ queryKey: ['freshStatus'] }), 1500);
  };
  // Every change also says where this device is, so the timetable follows the household's clock.
  const save = useMutation({ mutationFn: (patch: Partial<Settings>) => api.saveChannels({ ...patch, timeZone: zone() }), onSuccess: done, onError: (e) => toast('error', (e as Error).message) });
  // Reading the whole library again takes a while on a big one: the button says so meanwhile.
  const reset = useMutation({
    mutationFn: api.resetChannels,
    onSuccess: (data) => {
      done(data);
      toast('ok', tn(data.channels.length, 'Started over: {n} channel, guide made again.', 'Started over: {n} channels, guide made again.'));
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  // The guide made again from now: the channels as they are.
  const rebuild = useMutation({
    mutationFn: api.rebuildGuide,
    onSuccess: (data) => {
      done(data);
      toast('ok', t('Guide made again from now.'));
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  // Start, once it's all set up: the guide made again, New titles picked and downloaded straight away.
  const start = useMutation({
    mutationFn: api.startChannels,
    onSuccess: (data) => {
      done(data);
      toast('ok', data.fresh?.enabled ? t('Started: guide made again, New titles on their way.') : t('Started: guide made again.'));
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  const [confirmReset, setConfirmReset] = useState(false);

  if (q.isError) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Spinner size={20} />;
  const data = q.data;
  const channels = data.channels;
  const setChannels = (next: ChannelDef[]) => save.mutate({ channels: next });
  const move = (i: number, by: number) => {
    const next = [...channels];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c);
    setChannels(next);
  };

  return (
    <div className="chanset">
      <div className="account">
        <RadioTower size={22} />
        <div className="chanset__about">
          <strong>{t('Channels')}</strong>
          <span className="muted small">{t('Your library as TV channels: everyone on a channel sees the same minute, with no pausing and a short break between programmes.')}</span>
        </div>
        <span className="spacer" />
        <Switch on={data.enabled} onChange={(on) => save.mutate({ enabled: on })} label={t('Channels')} disabled={save.isPending} />
      </div>
      {data.enabled && (
        <>
          <div className="account">
            <History size={22} />
            <div className="chanset__about">
              <span>{t('Count channels as watching')}</span>
              <span className="muted small">{t('Off: channels leave Continue Watching and watched marks alone.')}</span>
              {data.timeZone && <span className="muted small">{t('Times follow {zone}.', { zone: data.timeZone.replace(/_/g, ' ') })}</span>}
            </div>
            <span className="spacer" />
            <Switch on={data.countWatched} onChange={(on) => save.mutate({ countWatched: on })} label={t('Count channels as watching')} />
          </div>

          <ul className="chanset__list">
            {channels.map((c, i) => (
              <li key={c.id} className={`chanset__row${c.hidden ? ' is-hidden' : ''}`}>
                <span className="chanset__num">{c.number}</span>
                <span className="chanset__name">
                  {c.builtIn ? (
                    <strong className="chanset__fixed">{c.name}</strong>
                  ) : (
                    <input
                      className="input"
                      defaultValue={c.name}
                      maxLength={40}
                      aria-label={t('Name of channel {n}', { n: c.number })}
                      onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && setChannels(channels.map((x) => (x.id === c.id ? { ...x, name: e.target.value.trim() } : x)))}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  )}
                  <span className="muted small">
                    {describe(c.source, data.genres.map((g) => g.name))}
                    {c.hidden ? ` · ${t('hidden')}` : ''}
                    {c.builtIn ? ` · ${t('always channel 1')}` : ''}
                    {data.fresh?.enabled && c.fresh ? ` · ${t('new titles')}` : ''}
                  </span>
                </span>
                <span className="chanset__actions">
                  {data.fresh?.enabled && c.source.kind !== 'series' && (
                    <button
                      className={`icon-btn icon-btn--sm chanset__fresh${c.fresh ? ' is-on' : ''}`}
                      disabled={save.isPending}
                      aria-pressed={Boolean(c.fresh)}
                      onClick={() => setChannels(channels.map((x) => (x.id === c.id ? { ...x, fresh: !x.fresh } : x)))}
                      aria-label={t('New titles for {name}', { name: c.name })}
                      title={c.fresh ? t('Gets new titles') : t('Get new titles for this channel')}
                    >
                      <Sparkles size={16} />
                    </button>
                  )}
                  {/* Netfish's own channel stays as it is, first. */}
                  {!c.builtIn && (
                    <>
                      <button className="icon-btn icon-btn--sm" disabled={i === 0 || (i === 1 && channels[0].builtIn) || save.isPending} onClick={() => move(i, -1)} aria-label={t('Move up')}>
                        <ArrowUp size={16} />
                      </button>
                      <button className="icon-btn icon-btn--sm" disabled={i === channels.length - 1 || save.isPending} onClick={() => move(i, 1)} aria-label={t('Move down')}>
                        <ArrowDown size={16} />
                      </button>
                      <button className="icon-btn icon-btn--sm" disabled={save.isPending} onClick={() => setChannels(channels.map((x) => (x.id === c.id ? { ...x, hidden: !x.hidden } : x)))} aria-label={c.hidden ? t('Show') : t('Hide')}>
                        {c.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                      <button className="icon-btn icon-btn--sm" disabled={save.isPending} onClick={() => setChannels(channels.filter((x) => x.id !== c.id))} aria-label={t('Remove {name}', { name: c.name })}>
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <AddChannel data={data} busy={save.isPending} onAdd={(def) => setChannels([...channels, { id: '', number: channels.length + 1, ...def }])} />
          <FreshTitles data={data} busy={save.isPending} save={(patch) => save.mutate(patch)} />
          {data.fresh?.enabled && data.fresh.running === false && (
            <div className="chanset__start">
              <button className="btn btn--primary" onClick={() => start.mutate()} disabled={start.isPending || save.isPending}>
                {start.isPending ? <Spinner size={14} /> : <Play size={14} />} {start.isPending ? t('Starting…') : t('Start')}
              </button>
              <span className="muted small">
                {tn(
                  data.fresh.aheadDays,
                  'When the channels and New titles are set up: makes the guide again and catches up the next day, picking the week’s New titles now and downloading what’s on in it straight away, whatever the download hours.',
                  'When the channels and New titles are set up: makes the guide again and catches up the next {n} days, picking the week’s New titles now and downloading what’s on in them straight away, whatever the download hours.',
                )}
              </span>
            </div>
          )}
          <div className="row-gap">
            <button className="btn btn--ghost btn--sm" onClick={() => rebuild.mutate()} disabled={rebuild.isPending} title={t('Keeps your channels; what’s on now carries on')}>
              {rebuild.isPending ? <Spinner size={14} /> : <RotateCcw size={14} />} {t('Rebuild the guide')}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirmReset(true)} disabled={reset.isPending}>
              {reset.isPending ? (
                <>
                  <Spinner size={14} /> {t('Starting over…')}
                </>
              ) : (
                t('Start over with automatic channels')
              )}
            </button>
          </div>
        </>
      )}
      {confirmReset && (
        <Modal
          title={t('Start over with automatic channels?')}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button className="btn btn--ghost" onClick={() => setConfirmReset(false)}>
                {t('Cancel')}
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setConfirmReset(false);
                  reset.mutate();
                }}
              >
                {t('Start over')}
              </button>
            </>
          }
        >
          <p className="muted">{t('Your channels are replaced by a new set made from the library, and every schedule starts again.')}</p>
          {data.fresh?.enabled && <p className="muted">{t('Nothing new is picked or downloaded until you press Start.')}</p>}
          {data.fresh?.enabled && <p className="muted">{t('Channels made from the same thing keep their ✨ New titles; those of channels that go are deleted (ones someone kept stay).')}</p>}
        </Modal>
      )}
    </div>
  );
}
