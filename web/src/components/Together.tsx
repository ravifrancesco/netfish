import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, LogOut, Play, Users, X } from 'lucide-react';
import type { TogetherRoom } from '@netfish/shared';
import { api } from '../api';
import { clock } from '../lib/format';
import { useMe } from '../lib/hooks';
import type { Together } from '../lib/together';
import { Initial } from './ProfilePicker';
import { Img, Spinner, useToast } from './ui';
import { t, tn } from '../i18n';

const roomHref = (room: TogetherRoom) => `/watch/${room.playback.itemId}?room=${room.id}`;
const inviteLink = (id: string) => `${location.origin}/together/${id}`;

/** Title page: start a room for what Play would play, and go straight into it. */
export function WatchTogetherButton({ itemId, className = 'btn btn--ghost btn--lg' }: { itemId: string; className?: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const start = useMutation({
    mutationFn: () => api.createRoom(itemId),
    onSuccess: (room) => navigate(roomHref(room)),
    onError: (err) => toast('error', (err as Error).message),
  });
  return (
    <button className={className} disabled={start.isPending} onClick={() => start.mutate()} title={t('Watch in sync with others on this server')}>
      {start.isPending ? <Spinner size={18} /> : <Users size={20} />} {t('Watch together')}
    </button>
  );
}

/** Home: rooms other people have open, to join with one click. */
export function TogetherBanner() {
  const me = useMe().data;
  const q = useQuery({ queryKey: ['rooms'], queryFn: api.rooms, refetchInterval: 30_000, staleTime: 15_000 });
  const rooms = (q.data?.rooms ?? []).filter((r) => r.members.some((m) => m.here && m.userId !== me?.id));
  if (!rooms.length) return null;
  return (
    <div className="together-rooms">
      {rooms.map((room) => {
        const here = room.members.filter((m) => m.here);
        const names = [...new Set(here.map((m) => m.name))];
        const who =
          names.length > 2
            ? tn(names.length - 1, '{name} and {n} other', '{name} and {n} others', { name: names[0] })
            : names.length === 2
              ? t('{a} and {b}', { a: names[0], b: names[1] })
              : names[0];
        return (
          <div key={room.id} className="together-room">
            <Img src={room.image} className="together-room__art" fallback={<Users size={22} />} />
            <div className="together-room__text">
              <span className="muted small">
                <Users size={14} /> {t('Watch together')}
              </span>
              <strong>{room.title}</strong>
              <span className="muted small">
                {room.subtitle ? `${room.subtitle} · ` : ''}
                {who}
              </span>
            </div>
            <Link to={roomHref(room)} className="btn btn--accent btn--sm">
              <Play size={16} fill="currentColor" /> {t('Join')}
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
