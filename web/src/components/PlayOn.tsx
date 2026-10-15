import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Cast, Globe, Laptop, Pause, Play, Smartphone, Tablet, Tv, X } from 'lucide-react';
import type { Screen, ScreenKind } from '@netfish/shared';
import { api } from '../api';
import { useOtherScreens } from '../lib/screens';
import { useTogether } from '../lib/together';
import { Spinner, useToast } from './ui';
import { t } from '../i18n';

/** The Play on TV session this device is running, so the remote can be found again. */
export interface RemoteSession {
  roomId: string;
  screenName: string;
  title: string;
}
const REMOTE_KEY = 'netfish.remote';
const REMOTE_EVENT = 'netfish:remote';

export function currentRemote(): RemoteSession | undefined {
  try {
    return JSON.parse(localStorage.getItem(REMOTE_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberRemote(session: RemoteSession | undefined) {
  try {
    if (session) localStorage.setItem(REMOTE_KEY, JSON.stringify(session));
    else localStorage.removeItem(REMOTE_KEY);
  } catch {
    /* private window */
  }
  window.dispatchEvent(new Event(REMOTE_EVENT));
}

function useRemoteSession() {
  const [session, setSession] = useState(currentRemote);
  useEffect(() => {
    const update = () => setSession(currentRemote());
    window.addEventListener(REMOTE_EVENT, update);
    return () => window.removeEventListener(REMOTE_EVENT, update);
  }, []);
  return session;
}

const ICONS: Record<ScreenKind, typeof Tv> = { tv: Tv, computer: Laptop, phone: Smartphone, tablet: Tablet, browser: Globe };

/**
 * "Play on…": the other places Netfish is open (your devices, and the household's TVs).
 * Picking one plays the film there, and this device becomes its remote.
 * `position` and `onSent` let the player hand over a film it's already playing.
 */
export function PlayOnButton({ itemId, title, position, onSent, className = 'btn btn--ghost btn--lg', iconOnly }: {
  itemId: string;
  title: string;
  position?: () => number;
  onSent?: () => void;
  className?: string;
  iconOnly?: boolean;
}) {
  const screens = useOtherScreens();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: (screen: Screen) => api.playOn(screen.id, itemId, position?.()),
    onSuccess: (room, screen) => {
      setOpen(false);
      rememberRemote({ roomId: room.id, screenName: screen.name, title });
      onSent?.();
      navigate(`/remote/${room.id}`, { replace: Boolean(onSent) });
    },
    onError: (err) => toast('error', (err as Error).message),
  });
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
  if (!screens.length) return null;

  return (
    <div className="play-on" ref={ref}>
      <button className={className} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('Play on another device')} title={t('Play on another device')}>
        <Cast size={iconOnly ? 24 : 20} /> {!iconOnly && t('Play on…')}
      </button>
      {open && (
        <div className="menu play-on__menu" role="menu">
          <div className="menu__head">
            <strong>{t('Play on')}</strong>
          </div>
          {screens.map((screen) => {
            const Icon = ICONS[screen.kind];
            return (
              <button key={screen.id} className="menu__item" role="menuitem" disabled={send.isPending} onClick={() => send.mutate(screen)}>
                {send.isPending && send.variables?.id === screen.id ? <Spinner size={16} /> : <Icon size={18} />}
                <span className="play-on__name">
                  {screen.name}
                  {!screen.mine && <span className="muted small"> · {screen.userName}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** While a film plays on another device from here: a bar to get back to its remote, or stop it. */
export function RemoteBar() {
  const session = useRemoteSession();
  const together = useTogether(session?.roomId, { controller: true });
  const room = together.room;
  useEffect(() => {
    if (together.ended) rememberRemote(undefined);
  }, [together.ended]);
  if (!session || together.ended) return null;
  const playing = room?.playback.playing;
  return (
    <div className="remote-bar">
      <Link to={`/remote/${session.roomId}`} className="remote-bar__text">
        <Cast size={18} />
        <span>
          <strong>{room?.title ?? session.title}</strong>
          <span className="muted small">{t('Playing on {screen}', { screen: room?.screenName ?? session.screenName })}</span>
        </span>
      </Link>
      <button
        className="icon-btn"
        disabled={!room}
        onClick={() => together.send(playing ? 'pause' : 'play', together.expected())}
        aria-label={playing ? t('Pause') : t('Play')}
      >
        {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
      </button>
      <button
        className="icon-btn"
        onClick={() => {
          if (room) void api.endRoom(room.id).catch(() => {});
          rememberRemote(undefined);
        }}
        aria-label={t('Stop playing on {screen}', { screen: room?.screenName ?? session.screenName })}
      >
        <X size={20} />
      </button>
    </div>
  );
}
