import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TogetherAction, TogetherEvent, TogetherRoom, TogetherRoomsEvent } from '@netfish/shared';
import { api, ApiError } from '../api';

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
 * Follows the server's live list of rooms, so a room someone opens shows up for everyone
 * at once, without reloading. Off while watching (the player has its own line, and
 * browsers allow only a few open connections to one server).
 */
export function useLiveRooms(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/together/live');
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as TogetherRoomsEvent;
        if (!event.rooms) return;
        roomsClock = event.now - Date.now();
        qc.setQueryData(['rooms'], { rooms: event.rooms });
      } catch {
        /* not for us */
      }
    };
    // Back from a dropped line: catch up on what was missed.
    source.onopen = () => void qc.invalidateQueries({ queryKey: ['rooms'] });
    return () => source.close();
  }, [enabled, qc]);
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
 * is), kept current over server-sent events, plus the calls a player makes to it.
 */
export function useTogether(roomId: string | undefined): Together {
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
      source = new EventSource(`/api/together/${encodeURIComponent(roomId)}/events?client=${clientId}`);
      source.onmessage = (e) => {
        let event: TogetherEvent;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        offsets.current = [...offsets.current.slice(-19), event.now - Date.now()];
        offset.current = Math.max(...offsets.current);
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
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
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
