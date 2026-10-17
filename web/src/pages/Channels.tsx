import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Link } from 'react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Channel, ChannelProgram } from '@netfish/shared';
import { api } from '../api';
import { ErrorState, Empty, Modal, PageLoader, Spinner } from '../components/ui';
import { clockTime, episodeLine, programEnd, programTitle, serverNow, useChannels, useServerNow } from '../lib/channels';
import { duration } from '../lib/format';
import { useMe } from '../lib/hooks';
import { NewBadge, isStandIn } from '../components/NewBadge';
import { locale, t, tn } from '../i18n';

/**
 * The channel guide: every channel and what's on, from now to three days ahead, on one line of
 * time that scrolls sideways (a swipe, a touchpad, or the remote going past the edge); Now,
 * Tonight, Tomorrow and the day after glide straight there. A programme on now tunes in; one
 * still to come says what it is.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const HALF_HOUR = 30 * MINUTE;
/** How far ahead the guide goes (the server's limit too). */
const AHEAD = 3 * 24 * HOUR;
/** Fetched twelve hours at a time, as the guide scrolls near them. */
const CHUNK = 12 * HOUR;
/** Drawn a little past what's in view on each side (the remote's next step, smooth scrolling). */
const BUFFER = 2 * HOUR;
/** Between two programmes (px). */
const GAP = 4;
/**
 * The guide starts at the half hour a little before now (as TV guides do), with a line at the
 * minute; what's on now fills from there, so one nearly over is still readable.
 */
const liveStart = (now: number) => Math.floor((now - 20 * MINUTE) / HALF_HOUR) * HALF_HOUR;
/** The time the guide's width shows at once: three hours, an hour and a half on a phone. */
const spanFor = (width: number) => (width < 640 ? 1.5 : 3) * HOUR;

/** Seven in the evening, `days` from today: the evening line-up and the nine o'clock film. */
function evening(now: number, days: number) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(19, 0, 0, 0);
  return d.getTime();
}
const weekday = (at: number) => new Date(at).toLocaleDateString(locale, { weekday: 'long' });
/** Calendar days from one time to another (local time). */
const daysApart = (a: number, b: number) => Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / (24 * HOUR));
/** "Today", "Tomorrow", "Saturday" ("sabato" made "Sabato"). */
const dayName = (at: number, now: number) => {
  const d = daysApart(now, at);
  const name = d === 0 ? t('Today') : d === 1 ? t('Tomorrow') : weekday(at);
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
};

/** A mouse (a tap on a touch screen fires mouseenter too). */
const canHover = () => window.matchMedia?.('(hover: hover)').matches;

function Block({
  program,
  channel,
  origin,
  px,
  now,
  onAbout,
}: {
  program: ChannelProgram;
  channel: Channel;
  origin: number;
  px: number;
  now: number;
  onAbout: (program: ChannelProgram, channel: Channel) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const end = programEnd(program);
  const onNowBlock = program.start <= now && now < end;
  const from = Math.max(program.start, origin);
  const left = (from - origin) * px;
  const width = Math.max(2, (end - from) * px - GAP);
  const sub = episodeLine(program);
  const minutesLeft = Math.max(0, Math.ceil((end - now) / MINUTE));
  // Too thin for a word: blank until it opens. Short: a smaller title, no time.
  const short = width < 40 && !onNowBlock ? ' is-tiny' : width < 110 ? ' is-narrow' : '';
  // Its title or line doesn't fit (titles stay on one line): it opens out over its neighbours, at
  // least as wide as it is, as far as the guide's edge allows, to read it all.
  const cutShort = () => {
    const el = ref.current;
    return Boolean(el && (short || [...el.querySelectorAll('.guide__prog-title, .guide__prog-meta')].some((c) => c.scrollWidth > c.clientWidth + 1)));
  };
  const openOut = () => {
    const el = ref.current;
    if (!el || !cutShort()) return;
    const edge = el.closest('.guide__scroller')?.getBoundingClientRect().right ?? window.innerWidth;
    el.style.setProperty('--w', `${el.offsetWidth}px`);
    el.style.setProperty('--room', `${Math.max(140, edge - el.getBoundingClientRect().left - 8)}px`);
    setOpen(true);
  };
  const className = `guide__prog${onNowBlock ? ' is-now' : ''}${short}${open ? ' is-open' : ''}`;
  const style = { left, width };
  const content = (
    <>
      <span className="guide__prog-inner">
        <span className="guide__prog-title">
          {program.isNew && <><NewBadge /> </>}
          {programTitle(program)}
        </span>
        <span className="guide__prog-meta">
          {onNowBlock ? tn(minutesLeft, '{n} min left', '{n} min left') : clockTime(program.start)}
          {sub ? ` · ${sub}` : ''}
        </span>
      </span>
      {onNowBlock && (
        <span className="guide__prog-bar" aria-hidden="true">
          <span style={{ width: `${((now - program.start) / (program.seconds * 1000)) * 100}%` }} />
        </span>
      )}
    </>
  );
  const events = {
    onMouseEnter: () => canHover() && openOut(),
    onMouseLeave: () => setOpen(false),
    onFocus: openOut,
    onBlur: () => setOpen(false),
  };
  // On now: tune in. Still to come: what it is.
  return onNowBlock ? (
    <Link
      ref={ref as Ref<HTMLAnchorElement>}
      to={`/channels/${channel.number}`}
      className={className}
      style={style}
      aria-label={t('{channel}: {title}, on now', { channel: `${channel.number} ${channel.name}`, title: programTitle(program) })}
      {...events}
    >
      {content}
    </Link>
  ) : (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      className={className}
      style={style}
      aria-label={`${programTitle(program)}, ${dayName(program.start, now)} ${clockTime(program.start)}`}
      onClick={() => onAbout(program, channel)}
      {...events}
    >
      {content}
    </button>
  );
}

/** A programme still to come, opened: when, where, what it is. */
function About({ program, channel, now, onClose }: { program: ChannelProgram; channel: Channel; now: number; onClose: () => void }) {
  const standIn = isStandIn(program.itemId);
  const about = useQuery({ queryKey: ['program-about', program.itemId], queryFn: () => api.programAbout(program.itemId), enabled: !standIn, staleTime: 10 * MINUTE });
  const sub = episodeLine(program);
  return (
    <Modal
      title={
        <>
          {programTitle(program)}
          {program.isNew && <> <NewBadge /></>}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Link to={`/channels/${channel.number}`} className="btn btn--ghost">
            {t('Watch channel {n} now', { n: channel.number })}
          </Link>
          {about.data?.pageId && (
            <Link to={`/title/jf/${about.data.pageId}`} className="btn btn--primary">
              {t('More info')}
            </Link>
          )}
        </>
      }
    >
      <div className="about">
        {program.image && <img className="about__image" src={program.image} alt="" />}
        <p className="about__when">
          {dayName(program.start, now)} {clockTime(program.start)}–{clockTime(programEnd(program))} · {channel.number} {channel.name}
        </p>
        {sub && <p className="about__episode">{sub}</p>}
        <p className="muted small">{[program.year, program.rating, duration(program.seconds)].filter(Boolean).join(' · ')}</p>
        {about.isLoading ? <Spinner size={18} /> : about.data?.overview ? <p className="about__overview">{about.data.overview}</p> : null}
      </div>
    </Modal>
  );
}

export default function ChannelsPage() {
  const live = useChannels();
  const me = useMe().data;
  const now = useServerNow(15_000);
  // Where the guide's time starts (the half hour before now when it opened), while it's open.
  const [origin] = useState(() => liveStart(serverNow()));
  const end = origin + AHEAD;

  // The guide's size: the time it shows at once follows its width; the channels' column stays put.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, chan: 0 });
  useLayoutEffect(() => {
    if (!scroller) return;
    const measure = () => setBox({ width: scroller.clientWidth, chan: parseFloat(getComputedStyle(scroller).getPropertyValue('--chan')) || 0 });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(scroller);
    return () => watch.disconnect();
  }, [scroller]);
  const span = spanFor(box.width);
  const px = box.width > box.chan ? (box.width - box.chan) / span : 0;
  const x = (at: number) => (at - origin) * px;

  // What's in view: the time at its left edge, every ten minutes of scrolling (what's drawn and
  // fetched follows it). The times along the top follow every pixel.
  const [viewStart, setViewStart] = useState(origin);
  const times = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const onScroll = () => {
    if (!scroller || !px) return;
    if (times.current) times.current.style.transform = `translateX(${-scroller.scrollLeft}px)`;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const at = origin + Math.round(scroller.scrollLeft / px / (10 * MINUTE)) * 10 * MINUTE;
      setViewStart((was) => (was === at ? was : at));
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const shownFrom = viewStart - BUFFER;
  const shownUntil = viewStart + span + BUFFER;

  // Twelve hours at a time, as they come near; what's been fetched stays.
  const [pieces, setPieces] = useState<number[]>([0]);
  const firstPiece = Math.max(0, Math.floor((shownFrom - origin) / CHUNK));
  const lastPiece = Math.min(Math.floor((shownUntil - origin) / CHUNK), Math.floor((AHEAD - 1) / CHUNK));
  useEffect(() => {
    setPieces((had) => {
      const more = Array.from({ length: lastPiece - firstPiece + 1 }, (_, i) => firstPiece + i).filter((i) => !had.includes(i));
      return more.length ? [...had, ...more] : had;
    });
  }, [firstPiece, lastPiece]);
  const fetched = useQueries({
    queries: pieces.map((i) => ({
      queryKey: ['channels', 'guide', origin + i * CHUNK],
      queryFn: () => api.channels(CHUNK / HOUR, origin + i * CHUNK),
      staleTime: MINUTE,
    })),
  });

  // Each channel's programmes from everything fetched; the newest word on a time slot wins.
  const stamp = fetched.map((q) => q.dataUpdatedAt).join();
  const programs = useMemo(() => {
    const byChannel = new Map<string, Map<number, ChannelProgram>>();
    const add = (channels?: Channel[]) =>
      channels?.forEach((c) => {
        const slots = byChannel.get(c.id) ?? new Map<number, ChannelProgram>();
        for (const p of c.programs) slots.set(p.start, p);
        byChannel.set(c.id, slots);
      });
    [...fetched].sort((a, b) => a.dataUpdatedAt - b.dataUpdatedAt).forEach((q) => add(q.data?.channels));
    add(live.data?.channels);
    return new Map(
      [...byChannel].map(([id, slots]) => {
        const list: ChannelProgram[] = [];
        for (const p of [...slots.values()].sort((a, b) => a.start - b.start)) {
          // A schedule made again since: whatever overlaps what's already placed goes.
          if (!list.length || p.start >= programEnd(list[list.length - 1]) - MINUTE) list.push(p);
        }
        return [id, list];
      }),
    );
  }, [live.data, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const [opened, setOpened] = useState<{ program: ChannelProgram; channel: Channel }>();
  const closeAbout = useCallback(() => setOpened(undefined), []);
  const openAbout = useCallback((program: ChannelProgram, channel: Channel) => setOpened({ program, channel }), []);

  if (live.isLoading) return <PageLoader />;
  if (live.isError) return <div className="page container"><ErrorState error={live.error} retry={() => void live.refetch()} /></div>;
  const channels = live.data?.channels ?? [];

  // Straight to an evening: tonight (while it's still to come), tomorrow, the day after.
  const tonight = evening(now, 0) > now + HALF_HOUR ? evening(now, 0) : undefined;
  const days = [
    { key: 'now', label: t('Now'), at: origin },
    ...(tonight ? [{ key: 'tonight', label: t('Tonight'), at: tonight }] : []),
    { key: 'tomorrow', label: t('Tomorrow'), at: evening(now, 1) },
    { key: 'after', label: weekday(evening(now, 2)), at: evening(now, 2) },
  ];
  const middle = viewStart + span / 2;
  const day = daysApart(now, middle);
  const current =
    viewStart < origin + HOUR ? 'now' : day === 0 ? (tonight && middle >= tonight - 2 * HOUR ? 'tonight' : 'now') : day === 1 ? 'tomorrow' : day === 2 ? 'after' : undefined;
  const go = (at: number) => scroller?.scrollTo({ left: Math.max(0, x(at)), behavior: 'smooth' });

  // Half-hour marks along the top (the day's name at midnight), not right next to "Now".
  const ticks: number[] = [];
  for (let at = Math.ceil(Math.max(origin, shownFrom) / HALF_HOUR) * HALF_HOUR; at < Math.min(end, shownUntil); at += HALF_HOUR) {
    if (Math.abs(at - now) > span * 0.06) ticks.push(at);
  }
  const width = box.chan + x(end);

  return (
    <div className="page container guide">
      <h1 className="page__title">{t('Channels')}</h1>
      <p className="muted guide__intro">{t('Your library as TV: everyone on a channel sees the same thing at the same time. No pausing; change channel with ↑ and ↓.')}</p>
      {channels.length === 0 ? (
        <Empty>{me?.isAdmin ? t('No channels yet. Add some in Settings → Channels.') : t('No channels yet.')}</Empty>
      ) : (
        <>
          <div className="guide__when" role="group" aria-label={t('When')}>
            <div className="tabs">
              {days.map((d) => (
                <button key={d.key} className={`tab${current === d.key ? ' is-active' : ''}`} aria-pressed={current === d.key} onClick={() => go(d.at)}>
                  {d.label}
                </button>
              ))}
            </div>
            {current !== 'now' && px > 0 && (
              <span className="muted small guide__span">
                {dayName(viewStart, now)} {clockTime(viewStart)}–{clockTime(viewStart + span)}
              </span>
            )}
          </div>
          {/* The times stay at the top while the page scrolls; they follow the guide sideways. */}
          <div className="guide__times" aria-hidden="true">
            <span className="guide__corner" />
            <div className="guide__times-track" ref={times} style={{ width }}>
              <span className="guide__spacer" />
              <span className="guide__line">
                {now >= origin && (
                  <span className="guide__tick is-now" style={{ left: x(now) }}>
                    {t('Now')}
                  </span>
                )}
                {ticks.map((at) => (
                  <span key={at} className={`guide__tick${new Date(at).getHours() === 0 && new Date(at).getMinutes() === 0 ? ' is-day' : ''}`} style={{ left: x(at) }}>
                    {new Date(at).getHours() === 0 && new Date(at).getMinutes() === 0 ? weekday(at) : clockTime(at)}
                  </span>
                ))}
              </span>
            </div>
          </div>
          <div className="guide__scroller" ref={setScroller} onScroll={onScroll} data-reveal="far" data-reveal-inset={box.chan}>
            <ul className="guide__rows" style={{ width }}>
              {channels.map((channel) => {
                const list = (programs.get(channel.id) ?? []).filter((p) => programEnd(p) > Math.max(now, shownFrom) && p.start < shownUntil);
                return (
                  <li key={channel.id} className="guide__row">
                    <Link to={`/channels/${channel.number}`} className="guide__chan" aria-label={`${channel.number} ${channel.name}`}>
                      <span className="guide__num">{channel.number}</span>
                      <span className="guide__name">
                        <span className="guide__name-text">{channel.name}</span>
                        {channel.watching > 0 && <span className="guide__watching">{tn(channel.watching, '{n} viewer', '{n} viewers')}</span>}
                      </span>
                    </Link>
                    <span className="guide__line">
                      {px > 0 &&
                        (list.length ? (
                          list.map((p) => <Block key={`${p.itemId}${p.start}`} program={p} channel={channel} origin={origin} px={px} now={now} onAbout={openAbout} />)
                        ) : (
                          <span className="guide__empty muted small" style={{ left: x(Math.max(now, viewStart)) }}>
                            {t('Nothing to play yet')}
                          </span>
                        ))}
                      {px > 0 && now >= origin && <span className="guide__nowline" style={{ left: x(now) }} aria-hidden="true" />}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
      {opened && <About program={opened.program} channel={opened.channel} now={now} onClose={closeAbout} />}
    </div>
  );
}
