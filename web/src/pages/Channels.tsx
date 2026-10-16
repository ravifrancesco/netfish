import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Channel, ChannelProgram } from '@netfish/shared';
import { api } from '../api';
import { ErrorState, Empty, PageLoader } from '../components/ui';
import { clockTime, episodeLine, onNow, programEnd, programTitle, useChannels, useServerNow } from '../lib/channels';
import { useMe } from '../lib/hooks';
import { NewBadge } from '../components/NewBadge';
import { locale, t, tn } from '../i18n';

/**
 * The channel guide: every channel, what's on now and what's on in the next three hours,
 * like a TV listings grid; earlier and later (up to three days ahead), or straight to tonight,
 * tomorrow and the day after. Picking a channel tunes in.
 */

const SPAN = 3 * 3600_000;
const HALF_HOUR = 30 * 60_000;
/** How far ahead the guide goes (the server's limit too). */
const AHEAD = 3 * 24 * 3600_000;

/** Seven in the evening, `days` from today: the evening line-up and the nine o'clock film. */
function evening(now: number, days: number) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(19, 0, 0, 0);
  return d.getTime();
}
const weekday = (at: number) => new Date(at).toLocaleDateString(locale, { weekday: 'long' });

function Block({ program, from, until, now, index }: { program: ChannelProgram; from: number; until: number; now: number; index: number }) {
  const start = Math.max(program.start, from);
  const end = Math.min(programEnd(program), until);
  const onNowBlock = program.start <= now && now < programEnd(program);
  const left = Math.max(0, Math.ceil((programEnd(program) - now) / 60_000));
  const sub = episodeLine(program);
  const width = ((end - start) / SPAN) * 100;
  return (
    <span
      className={`guide__prog${onNowBlock ? ' is-now' : ''}${index === 1 ? ' is-next' : index > 1 ? ' is-later' : ''}${width < 4 && !onNowBlock ? ' is-tiny' : ''}`}
      style={{ left: `${((start - from) / SPAN) * 100}%`, width: `${width}%` }}
      title={programTitle(program)}
    >
      <span className="guide__prog-title">
        {program.isNew && <><NewBadge /> </>}
        {programTitle(program)}
      </span>
      <span className="guide__prog-meta">
        {onNowBlock ? tn(left, '{n} min left', '{n} min left') : clockTime(program.start)}
        {sub ? ` · ${sub}` : ''}
      </span>
      {onNowBlock && (
        <span className="guide__prog-bar" aria-hidden="true">
          <span style={{ width: `${((now - program.start) / (program.seconds * 1000)) * 100}%` }} />
        </span>
      )}
    </span>
  );
}

function Row({ channel, from, now }: { channel: Channel; from: number; now: number }) {
  const until = from + SPAN;
  const shown = channel.programs.filter((p) => programEnd(p) > from && p.start < until);
  const on = onNow(channel, now);
  const label = on.program
    ? t('{channel}: {title}, on now', { channel: `${channel.number} ${channel.name}`, title: programTitle(on.program) })
    : `${channel.number} ${channel.name}`;
  return (
    <li>
      <Link to={`/channels/${channel.number}`} className="guide__row" aria-label={label}>
        <span className="guide__chan">
          <span className="guide__num">{channel.number}</span>
          <span className="guide__name">
            {channel.name}
            {channel.watching > 0 && <span className="guide__watching">{tn(channel.watching, '{n} viewer', '{n} viewers')}</span>}
          </span>
        </span>
        <span className="guide__line">
          {shown.length ? shown.map((p, i) => <Block key={`${p.itemId}${p.start}`} program={p} from={from} until={until} now={now} index={i} />) : <span className="guide__empty muted small">{t('Nothing to play yet')}</span>}
        </span>
      </Link>
    </li>
  );
}

export default function ChannelsPage() {
  const live = useChannels();
  const me = useMe().data;
  const now = useServerNow(15_000);
  // Looking ahead: the guide from then (undefined: now).
  const [from, setFrom] = useState<number>();
  const ahead = useQuery({
    queryKey: ['channels', 'guide', from],
    queryFn: () => api.channels(3, from),
    enabled: from !== undefined,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  const q = from === undefined ? live : ahead;
  if (live.isLoading) return <PageLoader />;
  if (q.isError) return <div className="page container"><ErrorState error={q.error} retry={() => void q.refetch()} /></div>;
  const channels = q.data?.channels ?? live.data?.channels ?? [];
  const start = from ?? now;
  const last = now + AHEAD - SPAN;
  const go = (at?: number) => setFrom(at === undefined || at <= now + 15 * 60_000 ? undefined : Math.min(at, last));
  // Straight to an evening: tonight (while it's still to come), tomorrow, the day after.
  const days = [
    { label: t('Now'), at: undefined as number | undefined },
    ...(evening(now, 0) > now + HALF_HOUR ? [{ label: t('Tonight'), at: evening(now, 0) }] : []),
    { label: t('Tomorrow'), at: evening(now, 1) },
    { label: weekday(evening(now, 2)), at: evening(now, 2) },
  ];
  // Half-hour marks across the three hours shown.
  const ticks: number[] = [];
  for (let at = Math.ceil((start + 1) / HALF_HOUR) * HALF_HOUR; at < start + SPAN; at += HALF_HOUR) ticks.push(at);
  return (
    <div className="page container guide">
      <h1 className="page__title">{t('Channels')}</h1>
      <p className="muted guide__intro">{t('Your library as TV: everyone on a channel sees the same thing at the same time. No pausing; change channel with ↑ and ↓.')}</p>
      {channels.length === 0 ? (
        <Empty>{me?.isAdmin ? t('No channels yet. Add some in Settings → Channels.') : t('No channels yet.')}</Empty>
      ) : (
        <>
          <div className="guide__when" role="group" aria-label={t('When')}>
            <button className="icon-btn icon-btn--sm" onClick={() => go(start - SPAN)} disabled={from === undefined} aria-label={t('Earlier')}>
              <ChevronLeft size={18} />
            </button>
            <div className="tabs">
              {days.map((d) => {
                const on = d.at === undefined ? from === undefined : from === d.at;
                return (
                  <button key={d.label} className={`tab${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => go(d.at)}>
                    {d.label}
                  </button>
                );
              })}
            </div>
            <button className="icon-btn icon-btn--sm" onClick={() => go(start + SPAN)} disabled={start >= last} aria-label={t('Later')}>
              <ChevronRight size={18} />
            </button>
            {from !== undefined && (
              <span className="muted small guide__span">
                {weekday(start)} {clockTime(start)}–{clockTime(start + SPAN)}
              </span>
            )}
          </div>
          <div className="guide__times" aria-hidden="true">
            <span className="guide__chan" />
            <span className="guide__line">
              <span className="guide__tick is-now" style={{ left: 0 }}>
                {from === undefined ? t('Now') : clockTime(start)}
              </span>
              {ticks.map((at) => (
                <span key={at} className="guide__tick" style={{ left: `${((at - start) / SPAN) * 100}%` }}>
                  {clockTime(at)}
                </span>
              ))}
            </span>
          </div>
          <ul className={`guide__rows${ahead.isFetching && from !== undefined ? ' is-loading' : ''}`}>
            {channels.map((channel) => (
              <Row key={channel.id} channel={channel} from={start} now={now} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
