import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { ChannelAdmin, ChannelSettings, FreshEvent, FreshSettings, FreshStatus, FreshTitle } from '@netfish/shared';
import { api } from '../api';
import { Progress, Switch, useToast } from './ui';
import { bytes } from '../lib/format';
import { locale, t, tn } from '../i18n';

/**
 * Settings → Channels → New titles (admins): Netfish brings in films and first seasons for the
 * channels picked, within a space, a free-disk floor, download hours, a speed and a number a
 * week; shows what's there now, and lets an admin keep or remove any of them.
 */

/** 1 AM, or 1:00 where clocks go to 24. */
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(locale, { hour: 'numeric', ...(locale.startsWith('en') ? {} : { minute: '2-digit' }) });
/** Thu 21:00 */
const when = (iso: string) => new Date(iso).toLocaleString(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** A number, saved when you leave the box. */
function NumberField({ label, value, min, max, unit, hint, disabled, onSave }: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  hint?: string;
  disabled?: boolean;
  onSave: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (text.trim() && Number.isFinite(n) && n !== value) onSave(Math.min(max, Math.max(min, n)));
    else setText(String(value));
  };
  return (
    <label className="fresh__field">
      <span>{label}</span>
      <span className="fresh__input">
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {unit && <span className="muted small">{unit}</span>}
      </span>
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

function stateLabel(f: FreshTitle, fromHour: number): string {
  const text = stateText(f, fromHour);
  // Asked for before it was here: it carries on as planned, then stays.
  return f.keptBy && f.state !== 'kept' ? `${text} · ${t('Requested by {name}', { name: f.keptBy })}` : text;
}

function stateText(f: FreshTitle, fromHour: number): string {
  switch (f.state) {
    case 'planned':
      return f.airAt && f.downloadAt
        ? t('On {when} · downloads {download}', { when: when(f.airAt), download: when(f.downloadAt) })
        : t('Waiting for a slot');
    case 'downloading':
      return f.paused ? t('Paused until {time}', { time: hourLabel(fromHour) }) : t('Downloading, {n}%', { n: Math.round((f.progress ?? 0) * 100) });
    case 'ready':
      return f.airAt ? t('Ready · on {when}', { when: when(f.airAt) }) : t('Ready');
    case 'aired':
      return t('Aired · deleting');
    case 'kept':
      return f.keptBy === 'requested' ? t('Kept (requested)') : t('Kept by {name}', { name: f.keptBy ?? '' });
  }
}

/** What the last look inside the download hours came to. */
function hoursText(last: NonNullable<FreshStatus['lastInHours']>): string {
  const title = last.title ?? '';
  switch (last.note) {
    case 'started':
      return t('started {title}', { title });
    case 'downloading':
      return t('{title} was still downloading', { title });
    case 'nothing-due':
      return t('nothing was due yet');
    case 'disk':
      return t('disk nearly full, {title} waited', { title });
    case 'space':
      return t('no space left for {title}', { title });
    case 'services':
      return t('Radarr or Sonarr not set up');
    case 'add-failed':
      return t('{title} couldn’t be added', { title });
    case 'already-there':
      return t('{title} was already in Radarr or Sonarr', { title });
  }
}

/** Something that happened to a new title. */
function eventText(e: FreshEvent): string {
  switch (e.what) {
    case 'started':
      return t('{title}: started downloading', { title: e.title });
    case 'add-failed':
      return t('{title}: couldn’t be added', { title: e.title });
    case 'already-there':
      return t('{title}: already in Radarr or Sonarr, dropped', { title: e.title });
    case 'nothing-found':
      return t('{title}: nothing found to download in 12 hours, dropped', { title: e.title });
    case 'too-big':
      return t('{title}: bigger than the space left, dropped', { title: e.title });
  }
}

function waitingText(waiting: FreshStatus['waiting']): string | undefined {
  switch (waiting) {
    case 'no-channels':
      return t('Pick channels with ✨ above.');
    case 'hours':
      return t('Outside download hours.');
    case 'space':
      return t('Space full until some air.');
    case 'disk':
      return t('Disk nearly full.');
    case 'week':
      return t('Done for this week.');
    case 'enough':
      return t('A week’s worth planned.');
    case 'services':
      return t('Needs Seerr (to find them), and Radarr or Sonarr.');
    default:
      return undefined;
  }
}

export function FreshTitles({ data, save, busy }: { data: ChannelAdmin; save: (patch: Partial<ChannelSettings>) => void; busy: boolean }) {
  const fresh = data.fresh as FreshSettings;
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({ queryKey: ['freshStatus'], queryFn: api.freshStatus, refetchInterval: fresh.enabled ? 15_000 : false });
  const act = useMutation({
    mutationFn: (fn: () => Promise<FreshStatus>) => fn(),
    onSuccess: (next) => {
      qc.setQueryData(['freshStatus'], next);
      void qc.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  const set = (patch: Partial<FreshSettings>) => save({ fresh: { ...fresh, ...patch } });
  const s = status.data;
  // "Check now": a look straight away, and what it found.
  const check = useMutation({
    mutationFn: api.freshRun,
    onSuccess: (next) => {
      const before = new Set((s?.titles ?? []).map((x) => `${x.key}:${x.state}`));
      const changed = next.titles.filter((x) => !before.has(`${x.key}:${x.state}`));
      qc.setQueryData(['freshStatus'], next);
      void qc.invalidateQueries({ queryKey: ['channels'] });
      const said = changed.length
        ? changed.map((x) => `${x.title}: ${stateLabel(x, fresh.fromHour)}`).join(' · ')
        : (waitingText(next.waiting) ?? t('Up to date: nothing new right now.'));
      toast('ok', said);
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  // "Download now": what's past its download time (or kept) and what's paused outside the hours.
  const now = useMutation({
    mutationFn: api.freshNow,
    onSuccess: (r) => {
      qc.setQueryData(['freshStatus'], r.status);
      void qc.invalidateQueries({ queryKey: ['channels'] });
      const said = [
        r.started.length ? t('Started: {list}.', { list: r.started.join(', ') }) : '',
        ...r.failed.map((f) => t('{title}: {reason}', { title: f.title, reason: f.reason })),
      ].filter(Boolean);
      toast(r.failed.length && !r.started.length ? 'error' : 'ok', said.join(' ') || t('Nothing to start: everything due is downloading.'));
    },
    onError: (e) => toast('error', (e as Error).message),
  });
  const dueNow = (s?.titles ?? []).filter((f) => (f.state === 'planned' && f.downloadAt && Date.parse(f.downloadAt) <= Date.now()) || (f.state === 'downloading' && f.paused)).length;
  const services = s?.services;
  const canFind = services ? services.seerr && (services.radarr || services.sonarr) : true;
  const names = new Map(data.channels.map((c) => [c.id, `${c.number} · ${c.name}`]));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const note = waitingText(s?.waiting);

  return (
    <div className="fresh">
      <div className="account">
        <Sparkles size={22} />
        <div className="chanset__about">
          <strong>{t('New titles')}</strong>
          <span className="muted small">{t('Fresh films and shows for your channels, deleted after they air.')}</span>
          {!canFind && <span className="muted small">{t('Needs Seerr (to find them), and Radarr or Sonarr.')}</span>}
        </div>
        <span className="spacer" />
        <Switch on={fresh.enabled} onChange={(on) => set({ enabled: on })} label={t('New titles')} disabled={busy || (!canFind && !fresh.enabled)} />
      </div>
      {fresh.enabled && (
        <>
          <div className="fresh__grid">
            <NumberField label={t('Space for them')} unit="GB" value={fresh.maxGb} min={5} max={20000} hint={s ? t('{used} used', { used: bytes(s.usedBytes) }) : undefined} onSave={(maxGb) => set({ maxGb })} />
            <NumberField
              label={t('Always leave free')}
              unit="GB"
              value={fresh.minFreeGb}
              min={0}
              max={100000}
              hint={s?.freeBytes !== undefined ? t('{free} free', { free: bytes(s.freeBytes) }) : undefined}
              onSave={(minFreeGb) => set({ minFreeGb })}
            />
            <label className="fresh__field">
              <span>{t('Download between')}</span>
              <span className="fresh__input">
                <select className="select" value={fresh.fromHour} onChange={(e) => set({ fromHour: Number(e.target.value) })} aria-label={t('From')}>
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                <span className="muted">–</span>
                <select className="select" value={fresh.toHour} onChange={(e) => set({ toHour: Number(e.target.value) })} aria-label={t('Until')}>
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </span>
              {fresh.fromHour === fresh.toHour && <span className="muted small">{t('Any time')}</span>}
            </label>
            <NumberField
              label={t('Speed, at most')}
              unit="MB/s"
              value={fresh.maxSpeed}
              min={0}
              max={1000}
              disabled={services?.qbittorrent === false}
              hint={services?.qbittorrent === false ? t('Needs qBittorrent') : t('0 = no limit')}
              onSave={(maxSpeed) => set({ maxSpeed })}
            />
            <NumberField label={t('Per channel, per week')} value={fresh.perWeek} min={1} max={21} hint={s ? tn(s.addedThisWeek, '{n} this week', '{n} this week') : undefined} onSave={(perWeek) => set({ perWeek })} />
            <label className="fresh__field">
              <span>{t('Download ahead')}</span>
              <select className="select" value={fresh.aheadDays} onChange={(e) => set({ aheadDays: Number(e.target.value) })}>
                {[1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>
                    {d === 7 ? t('A week before') : tn(d, '{n} day before', '{n} days before')}
                  </option>
                ))}
              </select>
            </label>
            {services?.radarr && Boolean(s?.profiles.movie.length) && (
              <label className="fresh__field">
                <span>{t('Film quality')}</span>
                <select className="select" value={fresh.movieProfile ?? s!.profiles.movie[0].id} onChange={(e) => set({ movieProfile: Number(e.target.value) })}>
                  {s!.profiles.movie.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {services?.sonarr && Boolean(s?.profiles.show.length) && (
              <label className="fresh__field">
                <span>{t('Show quality')}</span>
                <select className="select" value={fresh.showProfile ?? s!.profiles.show[0].id} onChange={(e) => set({ showProfile: Number(e.target.value) })}>
                  {s!.profiles.show.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="fresh__status">
            <span className="muted small">
              {note ?? (s?.titles.length ? '' : t('Nothing yet.'))}
              {/* Outside the hours, what the last look inside them found: why nothing's downloading. */}
              {s?.waiting === 'hours' && s.lastInHours && (
                <> {t('Last check in the download hours ({when}): {what}.', { when: when(s.lastInHours.at), what: hoursText(s.lastInHours) })}</>
              )}
            </span>
            <span className="spacer" />
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => now.mutate()}
              disabled={now.isPending || !dueNow}
              title={t('Starts what’s past its download time now, whatever the hours')}
            >
              <Download size={14} /> {now.isPending ? t('Starting…') : dueNow ? tn(dueNow, 'Download {n} now', 'Download {n} now') : t('Nothing due')}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => check.mutate()} disabled={check.isPending}>
              <RefreshCw size={14} className={check.isPending ? 'spin' : undefined} /> {check.isPending ? t('Checking…') : t('Check now')}
            </button>
          </div>
          {Boolean(s?.titles.length) && (
            <ul className="fresh__list">
              {s!.titles.map((f) => (
                <li key={f.key} className={`fresh__item is-${f.state}`}>
                  {f.poster ? <img src={f.poster} alt="" loading="lazy" /> : <span className="fresh__poster" />}
                  <span className="fresh__text">
                    <strong>
                      {f.title}
                      {f.year ? ` (${f.year})` : ''}
                    </strong>
                    <span className="muted small">
                      {names.get(f.channelId) ?? t('No channel')} · {f.state === 'planned' ? t('about {size}', { size: bytes(f.size) }) : bytes(f.size)}
                    </span>
                    <span className="small fresh__state">{stateLabel(f, fresh.fromHour)}</span>
                    {f.state === 'downloading' && !f.paused && <Progress value={f.progress ?? 0} />}
                  </span>
                  {/* Kept, or asked for: someone's, not to take off. */}
                  {f.state !== 'kept' && !f.keptBy && (
                    <span className="fresh__actions">
                      <button className="btn btn--ghost btn--sm" disabled={act.isPending} onClick={() => act.mutate(() => api.freshKeep(f.key))} title={t('Keep it: it joins the library')}>
                        <Check size={14} /> {t('Keep')}
                      </button>
                      <button className="icon-btn icon-btn--sm" disabled={act.isPending} onClick={() => act.mutate(() => api.freshRemove(f.key))} aria-label={t('Remove {name}', { name: f.title })}>
                        <Trash2 size={16} />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {Boolean(s?.events.length) && (
            <div className="fresh__events">
              <strong className="small">{t('Lately')}</strong>
              <ul>
                {s!.events.slice(0, 10).map((e) => (
                  <li key={`${e.at}${e.title}${e.what}`} className="small">
                    <span className="muted">{when(e.at)}</span> {eventText(e)}
                    {e.detail && <span className="muted"> · {e.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
