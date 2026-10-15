import type { ServerResponse } from 'node:http';
import type { FastifyReply } from 'fastify';
import type { Device, LiveEvent, Screen, ScreenKind, TogetherRoom } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { openLine, ping, send } from '../lib/sse';
import { HttpError } from '../lib/upstream';
import { t } from '../lib/i18n';
import { createRoom, listRooms, onRoomsChanged } from './together';

/**
 * The live line every open Netfish keeps to the server. It carries the Watch together
 * rooms (so Home and the top bar change by themselves), and it makes that Netfish a
 * screen others can play on: "Play on TV" sends it a film, and it opens the player.
 *
 * Who can play on what: your own screens (signed in as you), and any TV on the server,
 * since a TV is usually the household's.
 */

const KINDS: ScreenKind[] = ['tv', 'computer', 'phone', 'tablet', 'browser'];

interface Line {
  stream: ServerResponse;
  userId: string;
  userName: string;
  screen?: { id: string; name: string; kind: ScreenKind };
  /** The Netfish app it's open in, and its version (for Settings → Devices). */
  app?: { name: string; version: string };
  since: number;
}

const lines = new Set<Line>();

/** The newest line for each screen: the same Netfish open twice counts once, the last one opened. */
function screens(): Map<string, Line> {
  const out = new Map<string, Line>();
  for (const line of lines) {
    const id = line.screen?.id;
    if (id && (!out.has(id) || out.get(id)!.since < line.since)) out.set(id, line);
  }
  return out;
}

const canPlayOn = (userId: string, line: Line) => line.userId === userId || line.screen?.kind === 'tv';

function screensFor(userId: string): Screen[] {
  return [...screens().values()]
    .filter((line) => canPlayOn(userId, line))
    .map((line) => ({ id: line.screen!.id, name: line.screen!.name, kind: line.screen!.kind, userName: line.userName, mine: line.userId === userId }))
    .sort((a, b) => Number(b.kind === 'tv') - Number(a.kind === 'tv') || a.name.localeCompare(b.name));
}

export const listScreens = (user: SessionUser) => screensFor(user.id);

/** Every Netfish open right now, whoever's signed in, with its app and version (admins). */
export function listDevices(): Device[] {
  return [...screens().values()]
    .map((line) => ({
      id: line.screen!.id,
      name: line.screen!.name,
      kind: line.screen!.kind,
      userName: line.userName,
      app: line.app?.name,
      version: line.app?.version,
      since: new Date(line.since).toISOString(),
    }))
    .sort((a, b) => a.userName.localeCompare(b.userName) || a.name.localeCompare(b.name));
}

// Changes go out together, a moment later: a burst (a room filling up) is one message.
let pending: { rooms: boolean; screens: boolean } | undefined;
function announce(what: 'rooms' | 'screens') {
  if (pending) {
    pending[what] = true;
    return;
  }
  pending = { rooms: what === 'rooms', screens: what === 'screens' };
  setTimeout(() => {
    const { rooms: withRooms, screens: withScreens } = pending!;
    pending = undefined;
    const rooms: TogetherRoom[] | undefined = withRooms ? listRooms() : undefined;
    for (const line of lines) {
      send(line.stream, { rooms, screens: withScreens ? screensFor(line.userId) : undefined, now: Date.now() } satisfies LiveEvent);
    }
  }, 300);
}
onRoomsChanged(() => announce('rooms'));

const cleanId = (v: unknown) => (typeof v === 'string' && /^[a-z0-9-]{8,40}$/i.test(v) ? v : undefined);
const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '');
const APPS = ['mac', 'windows', 'ios', 'android', 'samsung'];
const cleanApp = (name: unknown, version: unknown) =>
  typeof name === 'string' && APPS.includes(name) && typeof version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) ? { name, version } : undefined;

/** Opens this Netfish's live line; with a screen id, name and kind it can also be played on. */
export function openLive(user: SessionUser, reply: FastifyReply, query: { screen?: string; name?: string; kind?: string; app?: string; version?: string }) {
  const id = cleanId(query.screen);
  const kind = KINDS.find((k) => k === query.kind) ?? 'browser';
  const line: Line = {
    stream: openLine(reply),
    userId: user.id,
    userName: user.name,
    screen: id ? { id, name: cleanName(query.name) || 'Netfish', kind } : undefined,
    app: cleanApp(query.app, query.version),
    since: Date.now(),
  };
  lines.add(line);
  send(line.stream, { rooms: listRooms(), screens: screensFor(user.id), now: Date.now() } satisfies LiveEvent);
  if (line.screen) announce('screens');
  line.stream.on('close', () => {
    lines.delete(line);
    if (line.screen) announce('screens');
  });
}

/** Play on TV: opens a remote room for the film and tells that screen to play it. */
export async function playOn(user: SessionUser, screenId: string, itemId: string, position?: number): Promise<TogetherRoom> {
  const target = screens().get(screenId);
  if (!target?.screen || !canPlayOn(user.id, target)) throw new HttpError(404, t("That device isn't open any more"));
  const room = await createRoom(user, itemId, position, { screen: { id: target.screen.id, name: target.screen.name } });
  send(target.stream, { open: { path: `/watch/${itemId}?room=${room.id}&remote=1`, by: user.name }, now: Date.now() } satisfies LiveEvent);
  return room;
}

setInterval(() => {
  for (const line of lines) ping(line.stream);
}, 15_000).unref();
