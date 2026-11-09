import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Cast, Check, Globe, Laptop, Pause, Play, Smartphone, Tablet, Tv, X } from 'lucide-react';
import type { Screen, ScreenKind } from '@netfish/shared';
import { api } from '../api';
import { screenId, screenKind, setCastTarget, useCastTarget, useOtherScreens, type CastTarget } from '../lib/screens';
import { useTogether } from '../lib/together';
import type { CastDevice } from '../lib/desktop';
import { castBusy, castItemOf, chromecast, useChromecast } from '../lib/chromecast';
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

/** Closes a menu on a click elsewhere or Escape. */
function useCloseOutside(open: boolean, setOpen: (open: boolean) => void) {
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
  }, [open, setOpen]);
  return ref;
}

/**
 * The top bar's cast button, like YouTube's: connect to a TV (or any device with Netfish
 * open), or a Chromecast (the Android app), and every Play then plays there, with this device
 * as its remote. Not on TVs.
 */
export function CastButton() {
  const target = useCastTarget();
  const q = useQuery({ queryKey: ['screens'], queryFn: api.screens, refetchInterval: 60_000, staleTime: 30_000 });
  const me = screenId();
  const screens = (q.data?.screens ?? []).filter((s) => s.id !== me);
  const [open, setOpen] = useState(false);
  const ref = useCloseOutside(open, setOpen);
  const cast = chromecast();
  // Looking for Chromecasts only while the menu is open.
  const castState = useChromecast(open);
  const castOn = Boolean(cast && castState.connected);
  const castDevices = cast ? (castState.devices ?? []) : [];
  const chromecasts = Boolean(cast && (castOn || castState.available || castDevices.length));
  // The device was turned off or closed Netfish: back to playing here.
  const gone = Boolean(target && q.data && !screens.some((s) => s.id === target.id));
  useEffect(() => {
    if (gone) setCastTarget(undefined);
  }, [gone]);
  if (screenKind() === 'tv' || (!screens.length && !target && !chromecasts)) return null;

  const pick = (next: CastTarget | undefined) => {
    setCastTarget(next);
    if (castOn) cast?.disconnect();
    setOpen(false);
  };
  const connectCast = (id: string) => {
    setCastTarget(undefined);
    cast?.connect(id);
    setOpen(false);
  };
  const castName = castState.device || 'Chromecast';
  const on = target?.name ?? (castOn ? castName : undefined);
  const label = on ? t('Connected to {screen}', { screen: on }) : t('Play on another device');
  return (
    <div className="play-on" ref={ref}>
      <button className={`cast-btn${on ? ' is-on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={label} title={label}>
        <Cast size={20} />
        {on && <span className="cast-btn__name">{on}</span>}
      </button>
      {open && (
        <div className="menu play-on__menu" role="menu">
          <div className="menu__head">
            <strong>{t('Play on')}</strong>
          </div>
          <button className="menu__item" role="menuitemradio" aria-checked={!on} onClick={() => pick(undefined)}>
            <Smartphone size={18} />
            <span className="play-on__name">{t('This device')}</span>
            {!on && <Check size={16} className="play-on__tick" />}
          </button>
          {screens.map((screen) => {
            const Icon = ICONS[screen.kind];
            const on = target?.id === screen.id;
            return (
              <button key={screen.id} className="menu__item" role="menuitemradio" aria-checked={on} onClick={() => pick({ id: screen.id, name: screen.name })}>
                <Icon size={18} />
                <span className="play-on__name">
                  {screen.name}
                  {!screen.mine && <span className="muted small"> · {screen.userName}</span>}
                </span>
                {on && <Check size={16} className="play-on__tick" />}
              </button>
            );
          })}
          {chromecasts && (
            <>
              <div className="menu__head play-on__section">
                <strong>Chromecast</strong>
              </div>
              {castOn ? (
                <>
                  <div className="menu__item play-on__current">
                    <Tv size={18} />
                    <span className="play-on__name">{castName}</span>
                    <Check size={16} className="play-on__tick" />
                  </div>
                  <button className="menu__item" role="menuitem" onClick={() => (setOpen(false), cast?.disconnect())}>
                    <X size={18} />
                    <span className="play-on__name">{t('Stop casting')}</span>
                  </button>
                </>
              ) : castDevices.length ? (
                castDevices.map((device) => (
                  <button key={device.id} className="menu__item" role="menuitemradio" aria-checked={false} onClick={() => connectCast(device.id)}>
                    <Tv size={18} />
                    <span className="play-on__name">{device.name}</span>
                  </button>
                ))
              ) : (
                <div className="menu__item play-on__current">
                  <Spinner size={16} />
                  <span className="play-on__name muted">{t('Looking for Chromecasts…')}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Pressed Play while connected to another screen: the film goes there and this page becomes
 * its remote. If the screen isn't there any more, it plays here instead (`onFailed`).
 */
export function SendToScreen({ target, itemId, position, onFailed }: { target: CastTarget; itemId: string; position?: number; onFailed: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api
      .playOn(target.id, itemId, position)
      .then((room) => {
        rememberRemote({ roomId: room.id, screenName: target.name, title: room.title });
        navigate(`/remote/${room.id}`, { replace: true });
      })
      .catch((err: Error) => {
        setCastTarget(undefined);
        toast('error', t("Couldn't play on {screen} ({reason}). Playing here instead.", { screen: target.name, reason: err.message }));
        onFailed();
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page container remote remote--ended">
      <Cast size={36} />
      <p>{t('Sending to {screen}…', { screen: target.name })}</p>
      <Spinner size={24} />
    </div>
  );
}

/** Chromecasts nearby (the Android app's player), listed under the screens. */
export interface ChromecastChoice {
  devices: CastDevice[];
  /** The one in use (its name), while casting. */
  casting?: string;
  connect: (id: string) => void;
  disconnect: () => void;
}

/**
 * "Play on…": the other places Netfish is open (your devices, and the household's TVs).
 * Picking one plays the film there, and this device becomes its remote.
 * `position` and `onSent` let the player hand over a film it's already playing; `chromecast`
 * adds the Chromecasts it can play on.
 */
export function PlayOnButton({ itemId, title, position, onSent, className = 'btn btn--ghost btn--lg', iconOnly, chromecast }: {
  itemId: string;
  title: string;
  position?: () => number;
  onSent?: () => void;
  className?: string;
  iconOnly?: boolean;
  chromecast?: ChromecastChoice;
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
      // Like casting: Play keeps going to that screen until you disconnect.
      setCastTarget({ id: screen.id, name: screen.name });
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
  const casting = chromecast?.casting !== undefined;
  // While casting, only the Chromecast's part (stop it); otherwise the screens, then the Chromecasts.
  const shown = casting ? [] : screens;
  const chromecasts = chromecast && (casting || chromecast.devices.length > 0);
  if (!shown.length && !chromecasts) return null;

  return (
    <div className="play-on" ref={ref}>
      <button
        className={`${className}${casting ? ' is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t('Play on another device')}
        title={casting ? t('Playing on {device}', { device: chromecast?.casting || 'Chromecast' }) : t('Play on another device')}
      >
        <Cast size={iconOnly ? 24 : 20} /> {!iconOnly && t('Play on…')}
      </button>
      {open && (
        <div className="menu play-on__menu" role="menu">
          {shown.length > 0 && (
            <div className="menu__head">
              <strong>{t('Play on')}</strong>
            </div>
          )}
          {shown.map((screen) => {
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
          {chromecasts && (
            <>
              <div className={`menu__head${shown.length ? ' play-on__section' : ''}`}>
                <strong>Chromecast</strong>
              </div>
              {casting ? (
                <>
                  <div className="menu__item play-on__current">
                    <Tv size={18} />
                    <span className="play-on__name">{chromecast.casting || 'Chromecast'}</span>
                    <Check size={16} className="play-on__tick" />
                  </div>
                  <button className="menu__item" role="menuitem" onClick={() => (setOpen(false), chromecast.disconnect())}>
                    <X size={18} />
                    <span className="play-on__name">{t('Stop casting')}</span>
                  </button>
                </>
              ) : (
                chromecast.devices.map((device) => (
                  <button key={device.id} className="menu__item" role="menuitem" onClick={() => (setOpen(false), chromecast.connect(device.id))}>
                    <Tv size={18} />
                    <span className="play-on__name">{device.name}</span>
                  </button>
                ))
              )}
            </>
          )}
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

/**
 * While a film plays on a Chromecast from here, away from its player: a bar back to the player
 * (which picks up where the Chromecast is, without starting the film again), pause, or stop
 * casting.
 */
export function CastBar() {
  const cast = chromecast();
  const state = useChromecast();
  const itemId = castBusy(state) ? castItemOf(state.url) : undefined;
  // Its own key: the player's ['play', id] loads the film whenever it changes.
  const info = useQuery({ queryKey: ['cast-title', itemId], queryFn: () => api.playInfo(itemId!), enabled: Boolean(itemId), staleTime: 5 * 60_000 });
  if (!cast || !itemId) return null;
  const d = info.data;
  const title = d?.type === 'Episode' ? `${d.seriesTitle ?? ''} · S${d.seasonNumber}:E${d.episodeNumber}` : d?.title;
  const device = state.device || 'Chromecast';
  const playing = Boolean(state.playing || state.buffering);
  return (
    <div className="remote-bar">
      <Link to={`/watch/${itemId}`} className="remote-bar__text">
        <Cast size={18} />
        <span>
          <strong>{title || device}</strong>
          <span className="muted small">{state.paused ? t('Paused on {screen}', { screen: device }) : t('Playing on {screen}', { screen: device })}</span>
        </span>
      </Link>
      <button className="icon-btn" onClick={() => cast.command(playing ? 'pause' : 'play')} aria-label={playing ? t('Pause') : t('Play')}>
        {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
      </button>
      <button className="icon-btn" onClick={() => cast.disconnect()} aria-label={t('Stop casting')}>
        <X size={20} />
      </button>
    </div>
  );
}
