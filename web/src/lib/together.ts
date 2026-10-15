import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiveEvent, TogetherAction, TogetherCommand, TogetherEvent, TogetherRoom } from '@netfish/shared';
import { api, ApiError } from '../api';
import { screenId, screenKind, useScreenName } from './screens';
import { thisApp } from './appVersions';

// ---------- The rooms on this server (Home, the top bar, title pages) ----------

/** The server's clock minus this device's, from the live list (0 until it's heard from). */
let roomsClock = 0;

/** Rooms with someone in them. Kept current by useLiveRooms; a slow check in case that can't connect. */
export const useRooms = () => useQuery({ queryKey: ['rooms'], queryFn: api.rooms, refetchInterval: 60_000, staleTime: 30_000 });

/** Rooms someone other than you is watching in right now. */
export const othersRooms = (rooms: TogetherRoom[] | undefined, meId: string | undefined) =>
  (rooms ?? []).filter((r) => r.members.some((m) => m.here && m.userId !== meId));

/** Where a room's film is now (seconds). */
export const roomPosition = (room: TogetherRoom) =>
  room.playback.position + (room.playback.playing ? Math.max(0, Date.now() + roomsClock - room.playback.at) / 1000 : 0);

export const roomHref = (room: TogetherRoom) => `/watch/${room.playback.itemId}?room=${room.id}`;

/**
 * The live line to the server, open as long as Netfish is: the rooms (so a room someone
 * opens shows up for everyone at once), the screens you can play on, and this device as a
 * screen, which opens the player when someone sends it something (Play on TV).
 */
export function useLive() {
  const qc = useQueryClient();
  // The router hands out a new navigate function on every page change: kept in a ref, so
  // the line isn't closed and reopened each time (browsers allow only six connections to
  // a server, and closed ones take a while to be freed).
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const name = useScreenName();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const query = new URLSearchParams({ screen: screenId(), name, kind: screenKind() });
    // Which app and version (Settings → Devices shows who needs an update).
    const app = thisApp();
    if (app) {
      query.set('app', app.name);
      query.set('version', app.version);
    }
    let source: EventSource | undefined;
    const open = () => {
      source?.close();
      source = new EventSource(`/api/together/live?${query}`);
      source.onmessage = (e) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        roomsClock = event.now - Date.now();
        if (event.rooms) qc.setQueryData(['rooms'], { rooms: event.rooms });
        if (event.screens) qc.setQueryData(['screens'], { screens: event.screens });
        if (event.open) navigateRef.current(event.open.path);
      };
      // Back from a dropped line: catch up on what was missed.
      source.onopen = () => {
        void qc.invalidateQueries({ queryKey: ['rooms'] });
        void qc.invalidateQueries({ queryKey: ['screens'] });
      };
    };
    // Leaving the page (it may be kept for the Back button): close the line, or a few such
    // pages would hold every connection the browser allows to the server.
    const hide = () => source?.close();
    const show = (e: PageTransitionEvent) => e.persisted && open();
    open();
    addEventListener('pagehide', hide);
    addEventListener('pageshow', show);
    return () => {
      removeEventListener('pagehide', hide);
      removeEventListener('pageshow', show);
      source?.close();
    };
  }, [name, qc]);
}

/** Re-renders every so often (for things that move with time, like a room's progress). */
export function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

// ---------- One room, from its player ----------

/** An id for this open player (crypto.randomUUID needs https, which a home server often isn't). */
const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface Together {
  room?: TogetherRoom;
  /** The room closed (ended by its host, or gone). */
  ended: boolean;
  clientId: string;
  /** The server's clock, as best this device can tell (ms). */
  serverNow: () => number;
  /** Where the room's film should be right now (seconds). */
  expected: () => number | undefined;
  send: (action: Exclude<TogetherAction, 'start'>, position?: number, itemId?: string) => void;
  setWaiting: (waiting: boolean) => void;
  leave: () => Promise<void>;
}

/**
 * The live line to a Watch together room: the room as it is (who's here, where the film
 * is), kept current over server-sent events, plus the calls a player makes to it. A remote
 * (Play on TV) joins as a controller, and a player hears its commands through onCommand.
 */
export function useTogether(roomId: string | undefined, options: { controller?: boolean; onCommand?: (command: TogetherCommand) => void } = {}): Together {
  const onCommand = useRef(options.onCommand);
  onCommand.current = options.onCommand;
  const clientId = useMemo(newClientId, []);
  const [room, setRoom] = useState<TogetherRoom>();
  const [ended, setEnded] = useState(false);
  const roomRef = useRef<TogetherRoom | undefined>(undefined);
  roomRef.current = room;
  // Clock difference to the server: messages arrive a little late, so the largest
  // difference seen recently is the closest to the truth.
  const offsets = useRef<number[]>([]);
  const offset = useRef(0);
  const waitingSent = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!roomId) return;
    setRoom(undefined);
    setEnded(false);
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      source = new EventSource(`/api/together/${encodeURIComponent(roomId)}/events?client=${clientId}${options.controller ? '&role=remote' : ''}`);
      source.onmessage = (e) => {
        let event: TogetherEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        offsets.current = [...offsets.current.slice(-19), event.now - Date.now()];
        offset.current = Math.max(...offsets.current);
        if (event.command) onCommand.current?.(event.command);
        if (event.ended) {
          setEnded(true);
          source?.close();
        } else if (event.room) {
          waitingSent.current = event.room.members.find((m) => m.clientId === clientId)?.waiting;
          setRoom(event.room);
        }
      };
      source.onerror = () => {
        // Dropped (network, server restart) or refused (the room is gone): find out which.
        if (source?.readyState !== EventSource.CLOSED || stopped) return;
        api.room(roomId).then(
          () => {
            if (!stopped) retry = setTimeout(connect, 2000);
          },
          (err) => {
            if (err instanceof ApiError && err.status === 404) setEnded(true);
            else if (!stopped) retry = setTimeout(connect, 4000);
          },
        );
      };
    };
    // Leaving the page (it may be kept for the Back button): close, and reconnect on return.
    const hide = () => source?.close();
    const show = (e: PageTransitionEvent) => e.persisted && !stopped && connect();
    connect();
    addEventListener('pagehide', hide);
    addEventListener('pageshow', show);
    return () => {
      stopped = true;
      clearTimeout(retry);
      removeEventListener('pagehide', hide);
      removeEventListener('pageshow', show);
      source?.close();
    };
  }, [roomId, clientId]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);
  const expected = useCallback(() => {
    const p = roomRef.current?.playback;
    if (!p) return undefined;
    return p.position + (p.playing ? Math.max(0, serverNow() - p.at) / 1000 : 0);
  }, [serverNow]);

  const send = useCallback(
    (action: Exclude<TogetherAction, 'start'>, position?: number, itemId?: string) => {
      if (!roomId) return;
      // Shown at once here; everyone else hears it from the server.
      const current = roomRef.current;
      if (current) {
        const p =
          action === 'next'
            ? { ...current.playback, itemId: itemId ?? current.playback.itemId, playing: true, position: 0 }
            : { ...current.playback, playing: action === 'play' ? true : action === 'pause' ? false : current.playback.playing, position: position ?? expected() ?? 0 };
        roomRef.current = { ...current, playback: { ...p, at: serverNow(), action, byClient: clientId } };
        setRoom(roomRef.current);
      }
      api.roomControl(roomId, { clientId, action, position, itemId }).catch(() => {});
    },
    [roomId, clientId, expected, serverNow],
  );

  const setWaiting = useCallback(
    (waiting: boolean) => {
      if (!roomId || waitingSent.current === waiting) return;
      waitingSent.current = waiting;
      api.roomWaiting(roomId, clientId, waiting).catch(() => {});
    },
    [roomId, clientId],
  );

  const leave = useCallback(async () => {
    if (roomId) await api.leaveRoom(roomId, clientId).catch(() => {});
  }, [roomId, clientId]);

  return { room, ended, clientId, serverNow, expected, send, setWaiting, leave };
}
