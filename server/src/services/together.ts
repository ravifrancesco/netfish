import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { FastifyReply } from 'fastify';
import type { TogetherAction, TogetherCommand, TogetherControl, TogetherEvent, TogetherPlayback, TogetherRoom, TogetherTracks } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { jellyfin, ticksToSeconds } from '../clients/jellyfin';
import { jfImage } from '../lib/images';
import { openLine, send } from '../lib/sse';
import { HttpError } from '../lib/upstream';
import { t } from '../lib/i18n';
import { episodeLabel } from './cards';
import { log } from '../lib/log';

/**
 * Watch together: one person opens a room for a film or an episode, others on the server
 * join, and play, pause, seeking and "next episode" stay in step on every device. The
 * server only keeps where the film is (playing or paused, at which second, as of when);
 * each player loads its own stream from Jellyfin, so every person's progress and
 * "watched" are their own. Rooms live in memory: a restart ends them.
 *
 * Play on TV uses the same rooms ("remote" ones, not listed for others): the TV is the
 * one player, and the phone that sent it there joins as its remote control.
 */

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // nothing that reads like 0/O or 1/I
const MAX_ROOMS = 30;
const MAX_PLAYERS = 12;
/** A player that went away (closed, lost the network) is dropped after this long. */
const GONE_AFTER = 2 * 60_000;
/** A room nobody has open ends after this long. */
const EMPTY_FOR = 10 * 60_000;
const MAX_AGE = 12 * 3600_000;

interface Player {
  clientId: string;
  userId: string;
  name: string;
  avatar?: string;
  waiting: boolean;
  /** A remote (Play on TV), not a player. */
  controller: boolean;
  tracks?: TogetherTracks;
  streams: Set<ServerResponse>;
  lastSeen: number;
}

interface Room {
  id: string;
  kind: 'together' | 'remote';
  /** Play on TV: the screen it plays on. */
  screen?: { id: string; name: string };
  hostId: string;
  hostName: string;
  title: string;
  subtitle?: string;
  image?: string;
  titleId?: string;
  durationSeconds?: number;
  playback: TogetherPlayback;
  players: Map<string, Player>;
  createdAt: number;
  emptySince?: number;
}

const rooms = new Map<string, Room>();

const newCode = () => Array.from({ length: 6 }, () => CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)]).join('');
const cleanCode = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const cleanClient = (id: unknown) => (typeof id === 'string' && /^[a-z0-9-]{8,40}$/i.test(id) ? id : undefined);

function view(room: Room): TogetherRoom {
  return {
    id: room.id,
    kind: room.kind,
    screenName: room.screen?.name,
    hostId: room.hostId,
    hostName: room.hostName,
    title: room.title,
    subtitle: room.subtitle,
    image: room.image,
    titleId: room.titleId,
    durationSeconds: room.durationSeconds,
    playback: room.playback,
    members: [...room.players.values()].map((p) => ({
      clientId: p.clientId,
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      here: p.streams.size > 0,
      waiting: p.waiting,
      controller: p.controller || undefined,
      tracks: p.tracks,
    })),
    createdAt: new Date(room.createdAt).toISOString(),
  };
}

// Everyone's Home, top bar and title pages hear when rooms open, change and close (see screens.ts).
let changed: () => void = () => {};
export const onRoomsChanged = (fn: () => void) => {
  changed = fn;
};

function broadcast(room: Room) {
  const event: TogetherEvent = { room: view(room), now: Date.now() };
  for (const p of room.players.values()) for (const s of p.streams) send(s, event);
  changed();
}

function end(room: Room) {
  rooms.delete(room.id);
  changed();
  const event: TogetherEvent = { ended: true, now: Date.now() };
  for (const p of room.players.values())
    for (const s of p.streams) {
      send(s, event);
      s.end();
    }
}

/** What a title is called in a room (and its picture), as this person's Jellyfin sees it. */
async function describe(user: SessionUser, itemId: string) {
  const item = await jellyfin.item(user.token, user.id, itemId);
  if (item.Type !== 'Movie' && item.Type !== 'Episode') throw new HttpError(400, t('Only films and episodes can be watched together'));
  const episode = item.Type === 'Episode';
  const resume = ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  const length = ticksToSeconds(item.RunTimeTicks);
  return {
    titleId: (episode ? item.SeriesId : item.Id) ?? undefined,
    durationSeconds: length || undefined,
    /** Where this person left off, unless that's the end credits. */
    resume: resume && (!length || resume < length - 60) ? resume : 0,
    title: (episode ? item.SeriesName : item.Name) ?? item.Name,
    subtitle: episode ? [episodeLabel(item), item.Name].filter(Boolean).join(' · ') : undefined,
    image:
      jfImage(item.Id, 'Backdrop', item.BackdropImageTags?.[0], { maxWidth: 960 }) ??
      jfImage(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags?.[0], { maxWidth: 960 }),
  };
}

function roomOf(id: string): Room {
  const room = rooms.get(cleanCode(id));
  if (!room) throw new HttpError(404, t('That room has ended'));
  return room;
}

function playerOf(room: Room, user: SessionUser, clientId: unknown): Player {
  const id = cleanClient(clientId);
  const player = id ? room.players.get(id) : undefined;
  if (!player || player.userId !== user.id) throw new HttpError(403, t('Join the room first'));
  player.lastSeen = Date.now();
  return player;
}

/** Where the room's film is right now. */
const here = (room: Room) => room.playback.position + (room.playback.playing ? (Date.now() - room.playback.at) / 1000 : 0);

const setPlayback = (room: Room, change: Partial<TogetherPlayback> & { action: TogetherAction; by: string; byClient: string }) => {
  room.playback = { ...room.playback, ...change, at: Date.now(), rev: room.playback.rev + 1 };
  broadcast(room);
};

/**
 * Opens a room for a film or episode, starting paused at `position` (or where the host
 * left off). A host has one Watch together room at a time, and a screen plays one thing.
 */
export async function createRoom(
  user: SessionUser,
  itemId: string,
  position?: number,
  remote?: { screen: { id: string; name: string } },
): Promise<TogetherRoom> {
  const { resume, ...about } = await describe(user, itemId);
  for (const old of rooms.values()) {
    if (remote ? old.screen?.id === remote.screen.id : old.kind === 'together' && old.hostId === user.id) end(old);
  }
  if (rooms.size >= MAX_ROOMS) throw new HttpError(429, t('Too many rooms are open. Try again later.'));
  let id = newCode();
  while (rooms.has(id)) id = newCode();
  const room: Room = {
    id,
    kind: remote ? 'remote' : 'together',
    screen: remote?.screen,
    hostId: user.id,
    hostName: user.name,
    ...about,
    playback: { itemId, playing: false, position: Math.max(0, position ?? resume), at: Date.now(), action: 'start', by: user.name, rev: 1 },
    players: new Map(),
    createdAt: Date.now(),
    emptySince: Date.now(),
  };
  rooms.set(id, room);
  return view(room);
}

/** Watch together rooms that have someone in them (everyone signed in can see and join them). */
export function listRooms(): TogetherRoom[] {
  return [...rooms.values()]
    .filter((r) => r.kind === 'together' && [...r.players.values()].some((p) => p.streams.size > 0))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(view);
}

export const getRoom = (id: string) => view(roomOf(id));

/**
 * A player's live line to the room (server-sent events): the room now, then every change.
 * Being connected is what "here" means; the line drops when the player closes.
 */
export function openStream(user: SessionUser, id: string, clientId: unknown, reply: FastifyReply, controller = false) {
  const room = roomOf(id);
  const client = cleanClient(clientId);
  if (!client) throw new HttpError(400, 'Bad request');
  let player = room.players.get(client);
  if (player && player.userId !== user.id) throw new HttpError(403, 'Forbidden');
  if (!player) {
    if (room.players.size >= MAX_PLAYERS) throw new HttpError(429, t('This room is full'));
    player = { clientId: client, userId: user.id, name: user.name, avatar: user.avatar, waiting: !controller, controller, streams: new Set(), lastSeen: Date.now() };
    room.players.set(client, player);
  }

  const stream = openLine(reply);
  player.streams.add(stream);
  room.emptySince = undefined;
  broadcast(room);

  const me = player;
  stream.on('close', () => {
    me.streams.delete(stream);
    me.lastSeen = Date.now();
    if (!rooms.has(room.id)) return;
    if (![...room.players.values()].some((p) => p.streams.size > 0)) room.emptySince = Date.now();
    broadcast(room);
  });
}

/** Play, pause, seek or move on to the next episode, for everyone in the room. */
export async function control(user: SessionUser, id: string, body: TogetherControl): Promise<TogetherRoom> {
  const room = roomOf(id);
  const player = playerOf(room, user, body.clientId);
  const position = Number(body.position);
  const at = Number.isFinite(position) ? Math.max(0, Math.min(position, 24 * 3600)) : undefined;
  switch (body.action) {
    case 'play':
    case 'pause':
      setPlayback(room, { action: body.action, by: player.name, byClient: player.clientId, playing: body.action === 'play', position: at ?? here(room) });
      break;
    case 'seek':
      if (at === undefined) throw new HttpError(400, 'Bad request');
      setPlayback(room, { action: 'seek', by: player.name, byClient: player.clientId, position: at });
      break;
    case 'next': {
      const itemId = String(body.itemId ?? '').slice(0, 64);
      // Everyone's player reaches the end at about the same time: the first one moves the room on.
      if (!itemId || itemId === room.playback.itemId) break;
      const { resume: _resume, ...about } = await describe(user, itemId);
      Object.assign(room, about);
      for (const p of room.players.values()) p.waiting = true;
      setPlayback(room, { action: 'next', by: player.name, byClient: player.clientId, itemId, position: 0, playing: true });
      break;
    }
    default:
      throw new HttpError(400, 'Bad request');
  }
  return view(room);
}

/** A player is loading or buffering (or ready again): shown to the others. */
export function setWaiting(user: SessionUser, id: string, clientId: unknown, waiting: boolean) {
  const room = roomOf(id);
  const player = playerOf(room, user, clientId);
  if (player.waiting !== waiting) {
    player.waiting = waiting;
    broadcast(room);
  }
  return { ok: true };
}

export function leave(user: SessionUser, id: string, clientId: unknown) {
  const room = rooms.get(cleanCode(id));
  if (!room) return { ok: true };
  const player = playerOf(room, user, clientId);
  room.players.delete(player.clientId);
  for (const s of player.streams) s.end();
  // Play on TV is over once the TV stops playing.
  const players = [...room.players.values()].filter((p) => !p.controller);
  if (!room.players.size || (room.kind === 'remote' && !player.controller && !players.length)) {
    end(room);
    if (room.kind === 'together') log.info('together', `The room for "${room.title}" closed: ${user.name} was the last to leave`);
  } else broadcast(room);
  return { ok: true };
}

/** Ends the room for everyone: whoever opened it, or an admin (Play on TV: the TV or the remote too). */
export function endRoom(user: SessionUser, id: string) {
  const room = roomOf(id);
  const inIt = [...room.players.values()].some((p) => p.userId === user.id);
  if (room.hostId !== user.id && !user.isAdmin && !(room.kind === 'remote' && inIt)) {
    throw new HttpError(403, t('Only {name} can end this room', { name: room.hostName }));
  }
  end(room);
  return { ok: true };
}

const cleanTracks = (list: unknown) =>
  (Array.isArray(list) ? list : [])
    .slice(0, 60)
    .map((t) => ({ index: Number((t as { index?: unknown })?.index), label: String((t as { label?: unknown })?.label ?? '').slice(0, 80) }))
    .filter((t) => Number.isInteger(t.index));

/** A player's audio and subtitle tracks, for a remote to show. */
export function setTracks(user: SessionUser, id: string, clientId: unknown, tracks: Partial<TogetherTracks> | undefined) {
  const room = roomOf(id);
  const player = playerOf(room, user, clientId);
  player.tracks = {
    audio: cleanTracks(tracks?.audio),
    subtitles: cleanTracks(tracks?.subtitles),
    audioIndex: Number.isInteger(tracks?.audioIndex) ? tracks!.audioIndex : undefined,
    subtitleIndex: tracks?.subtitleIndex === null ? null : Number.isInteger(tracks?.subtitleIndex) ? tracks!.subtitleIndex : undefined,
  };
  broadcast(room);
  return { ok: true };
}

/** From a remote to one player in its room: change audio or subtitles, or stop. */
export function command(user: SessionUser, id: string, body: { clientId?: string; to?: string; action?: string; index?: number | null }) {
  const room = roomOf(id);
  const from = playerOf(room, user, body.clientId);
  const target = room.players.get(cleanClient(body.to) ?? '');
  if (!target || !['audio', 'subtitle', 'stop'].includes(String(body.action))) throw new HttpError(400, 'Bad request');
  const index = body.index === null ? null : Number.isInteger(body.index) ? body.index : undefined;
  const event: TogetherEvent = { command: { action: body.action as TogetherCommand['action'], index, by: from.name }, now: Date.now() };
  for (const s of target.streams) send(s, event);
  return { ok: true };
}

// Keeps the lines open through proxies, tells players the time, and tidies up.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    let changed = false;
    for (const p of room.players.values()) {
      if (!p.streams.size && now - p.lastSeen > GONE_AFTER) {
        room.players.delete(p.clientId);
        changed = true;
      }
      for (const s of p.streams) send(s, { now });
    }
    if ((room.emptySince && now - room.emptySince > EMPTY_FOR) || now - room.createdAt > MAX_AGE) end(room);
    else if (changed) broadcast(room);
  }
}, 15_000).unref();
