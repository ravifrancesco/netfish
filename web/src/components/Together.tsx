import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, LogOut, Play, Users, X } from 'lucide-react';
import type { TogetherMember, TogetherRoom } from '@netfish/shared';
import { api } from '../api';
import { clock } from '../lib/format';
import { useMe } from '../lib/hooks';
import { othersRooms, roomHref, roomPosition, useRooms, useTick, type Together } from '../lib/together';
import { Initial } from './ProfilePicker';
import { Img, Progress, Spinner, useToast } from './ui';
import { t, tn } from '../i18n';

const inviteLink = (id: string) => `${location.origin}/together/${id}`;

/** Title page: start a room for what Play would play, and go straight into it. */
export function WatchTogetherButton({ itemId, menu }: { itemId: string; menu?: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api.createRoom(itemId),
    onSuccess: (room) => navigate(roomHref(room)),
    onError: (err) => toast('error', (err as Error).message),
  });
  return (
    <button
      className={menu ? 'menu__item' : 'btn btn--ghost btn--lg'}
      role={menu ? 'menuitem' : undefined}
      disabled={start.isPending}
      onClick={() => start.mutate()}
      title={t('Watch in sync with others on this server')}
    >
      {start.isPending ? <Spinner size={16} /> : <Users size={menu ? 18 : 20} />} {t('Watch together')}
    </button>
  );
}

/** The people in a room right now, once each (the same person can be on two devices). */
const peopleIn = (room: TogetherRoom, exceptId?: string) => {
  const seen = new Map<string, TogetherMember>();
  for (const m of room.members) if (m.here && m.userId !== exceptId && !seen.has(m.userId)) seen.set(m.userId, m);
  return [...seen.values()];
};

/** "ravi", "ravi and sam", "ravi and 2 others". */
function whoText(people: TogetherMember[]) {
  const names = people.map((m) => m.name);
  if (names.length > 2) return tn(names.length - 1, '{name} and {n} other', '{name} and {n} others', { name: names[0] });
  if (names.length === 2) return t('{a} and {b}', { a: names[0], b: names[1] });
  return names[0] ?? '';
}

function Faces({ people, max = 3, className = 'room-faces' }: { people: TogetherMember[]; max?: number; className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      {people.slice(0, max).map((m) => (
        <Img key={m.userId} src={m.avatar} className="room-face" fallback={<Initial name={m.name} />} />
      ))}
      {people.length > max && <span className="room-face room-face--more">+{people.length - max}</span>}
    </span>
  );
}

function RoomCard({ room }: { room: TogetherRoom }) {
  const people = peopleIn(room);
  const position = roomPosition(room);
  const who = whoText(people);
  return (
    <div className="wide room-card">
      <Link to={roomHref(room)} className="wide__frame" aria-label={t('Join {who} watching {title}', { who, title: room.title })}>
        <Img src={room.image} className="wide__img" fallback={<span className="card__fallback">{room.title}</span>} />
        <span className={`room-live${room.playback.playing ? '' : ' is-paused'}`}>{room.playback.playing ? t('Live') : t('Paused')}</span>
        <Faces people={people} />
        <span className="wide__play" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
        {room.durationSeconds ? <Progress value={Math.min(1, position / room.durationSeconds)} className="wide__bar" /> : null}
      </Link>
      <div className="wide__meta">
        <div className="wide__text">
          <span className="wide__title">{room.title}</span>
          <span className="wide__subtitle">{[room.subtitle, who].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
    </div>
  );
}

/** Home: the rooms others are watching in, as a row like the others. Appears and goes as rooms do. */
export function TogetherRow() {
  const me = useMe().data;
  const rooms = othersRooms(useRooms().data?.rooms, me?.id);
  useTick(15_000); // the progress bars move
  if (!rooms.length) return null;
  return (
    <section className="row row--wide row--together">
      <div className="row__head">
        <h2 className="row__title">
          <span className="live-dot" aria-hidden="true" /> {t('Watch together')}
        </h2>
      </div>
      <div className="row__viewport">
        <div className="row__track">
          {rooms.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** The top bar, on every page: someone is watching together; the menu lists the rooms. */
export function TogetherPill() {
  const me = useMe().data;
  const rooms = othersRooms(useRooms().data?.rooms, me?.id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!rooms.length) setOpen(false);
  }, [rooms.length]);
  if (!rooms.length) return null;

  const everyone = [...new Map(rooms.flatMap((r) => peopleIn(r, me?.id)).map((m) => [m.userId, m])).values()];
  return (
    <div className="together-pill-wrap" ref={ref}>
      <button
        className="together-pill"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={tn(rooms.length, 'Watch together: {n} room open', 'Watch together: {n} rooms open')}
        title={t('Watch together')}
      >
        <span className="live-dot" aria-hidden="true" />
        <Faces people={everyone} max={2} />
        <span className="together-pill__label">{t('Watch together')}</span>
        {rooms.length > 1 && <span className="together-pill__count">{rooms.length}</span>}
      </button>
      {open && (
        <div className="menu together-menu" role="menu">
          {rooms.map((room) => (
            <Link key={room.id} to={roomHref(room)} className="together-menu__item" role="menuitem" onClick={() => setOpen(false)}>
              <Img src={room.image} className="together-menu__art" fallback={<Users size={18} />} />
              <span className="together-menu__text">
                <strong>{room.title}</strong>
                <span className="muted small">{[room.subtitle, whoText(peopleIn(room, me?.id))].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="btn btn--accent btn--sm">{t('Join')}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** A title's page: someone is watching it together right now. */
export function TogetherOnTitle({ titleId }: { titleId?: string }) {
  const me = useMe().data;
  const rooms = othersRooms(useRooms().data?.rooms, me?.id).filter((r) => titleId && r.titleId === titleId);
  if (!rooms.length) return null;
  return (
    <div className="together-lines">
      {rooms.map((room) => {
        const people = peopleIn(room, me?.id);
        return (
          <div key={room.id} className="together-line">
            <span className="live-dot" aria-hidden="true" />
            <span>
              {tn(people.length, '{who} is watching this together', '{who} are watching this together', { who: whoText(people) })}
              {room.subtitle && <span className="muted"> · {room.subtitle}</span>}
            </span>
            <Link to={roomHref(room)} className="btn btn--accent btn--sm">
              <Play size={15} fill="currentColor" /> {t('Join')}
            </Link>
          </div>
        );
      })}
    </div>
  );
}

/** /together/CODE (the invite link): opens that room's player. */
export function JoinRoom() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['room', id], queryFn: () => api.room(id), retry: false });
  useEffect(() => {
    if (q.data) navigate(roomHref(q.data), { replace: true });
  }, [q.data, navigate]);
  if (q.isError) {
    return (
      <div className="page container empty">
        <p>{(q.error as Error).message}</p>
        <Link to="/" className="btn btn--ghost">
          {t('Home')}
        </Link>
      </div>
    );
  }
  return (
    <div className="page container empty">
      <Spinner size={32} />
    </div>
  );
}

/** The player's top bar: who's in the room. */
export function TogetherChip({ together, open, onToggle }: { together: Together; open: boolean; onToggle: () => void }) {
  const here = together.room?.members.filter((m) => m.here).length ?? 0;
  return (
    <button className={`together-chip${open ? ' is-active' : ''}`} onClick={onToggle} aria-expanded={open} aria-label={t('Watch together')}>
      <Users size={18} />
      {together.ended ? t('Room ended') : together.room ? (here > 1 ? t('{n} watching', { n: here }) : t('Just you')) : <Spinner size={14} />}
    </button>
  );
}

function CopyLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(id);
  const canCopy = typeof navigator.clipboard?.writeText === 'function';
  return (
    <div className="together-panel__link">
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t('Invite link')} />
      {canCopy && (
        <button
          className="icon-btn icon-btn--sm"
          aria-label={t('Copy link')}
          title={t('Copy link')}
          onClick={() =>
            navigator.clipboard.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      )}
    </div>
  );
}

/** The room, from the player: the invite code and link, who's here, leave or end it. */
export function TogetherPanel({ together, onLeave, onClose }: { together: Together; onLeave: () => void; onClose: () => void }) {
  const me = useMe().data;
  const room = together.room;
  const [ending, setEnding] = useState(false);
  if (!room) return null;
  const canEnd = room.hostId === me?.id || me?.isAdmin;
  return (
    <div className="together-panel" role="dialog" aria-label={t('Watch together')}>
      <div className="together-panel__head">
        <strong>{t('Watch together')}</strong>
        <span className="spacer" />
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label={t('Close')}>
          <X size={16} />
        </button>
      </div>
      <p className="muted small">{t('Play, pause and skipping happen for everyone. Anyone on this server can join from Home or with this link.')}</p>
      <CopyLink id={room.id} />
      <ul className="together-panel__members">
        {room.members.map((m) => (
          <li key={m.clientId} className={m.here ? '' : 'is-away'}>
            <Img src={m.avatar} className="together-panel__avatar" fallback={<Initial name={m.name} />} />
            <span>
              {m.name}
              {m.clientId === together.clientId && <span className="muted"> · {t('you')}</span>}
            </span>
            <span className="spacer" />
            <span className="muted small">{!m.here ? t('Away') : m.waiting ? t('Loading…') : t('Here')}</span>
          </li>
        ))}
      </ul>
      <div className="row-gap">
        <button className="btn btn--ghost btn--sm" onClick={onLeave}>
          <LogOut size={15} /> {t('Leave')}
        </button>
        {canEnd && (
          <button
            className="btn btn--danger btn--sm"
            disabled={ending}
            onClick={() => {
              setEnding(true);
              api.endRoom(room.id).catch(() => setEnding(false));
            }}
          >
            {t('End for everyone')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Says what others did ("Sam paused"), and who came and went, for a few seconds. */
export function TogetherNotes({ together }: { together: Together }) {
  const [note, setNote] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastRev = useRef<number | undefined>(undefined);
  const lastHere = useRef<Map<string, string> | undefined>(undefined);
  const room = together.room;

  const say = (text: string) => {
    setNote(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(undefined), 3500);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!room) return;
    const p = room.playback;
    if (lastRev.current !== undefined && p.rev > lastRev.current && p.byClient !== together.clientId) {
      const name = p.by;
      if (p.action === 'play') say(t('{name} pressed play', { name }));
      else if (p.action === 'pause') say(t('{name} paused', { name }));
      else if (p.action === 'seek') say(t('{name} skipped to {time}', { name, time: clock(p.position) }));
      else if (p.action === 'next') say(t('{name} moved on to the next episode', { name }));
    }
    lastRev.current = p.rev;

    const here = new Map(room.members.filter((m) => m.here && m.clientId !== together.clientId).map((m) => [m.clientId, m.name]));
    if (lastHere.current) {
      for (const [id, name] of here) if (!lastHere.current.has(id)) say(t('{name} joined', { name }));
      for (const [id, name] of lastHere.current) if (!here.has(id)) say(t('{name} left', { name }));
    }
    lastHere.current = here;
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (together.ended) say(t("The room has ended. You're watching on your own now."));
  }, [together.ended]);

  if (!note) return null;
  return (
    <div className="together-note" role="status">
      <Users size={16} /> {note}
    </div>
  );
}
