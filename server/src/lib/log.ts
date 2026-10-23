import { config } from '../config';

/**
 * The container log (Portainer → Containers → netfish → Logs): one readable line for each thing
 * that happened, in the household's time,
 *
 *   2026-10-22 21:04:05  info   new titles   Grabbed "Arcane.S01.1080p…" (2.6 GB) for Arcane
 *
 * Who did what (sign-ins, playing, requests, deleting), what the server did by itself (new titles,
 * channels), and what went wrong. Never tokens, keys or passwords. LOG_LEVEL: debug, info (the
 * default), warn or error.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 20, info: 30, warn: 40, error: 50 };
const FROM_PINO: Record<number, Level> = { 10: 'debug', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'error' };
const THRESHOLD: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity };
const threshold = THRESHOLD[config.logLevel] ?? ORDER.info;

let timeZone: string | undefined;
/** The household's time zone (channels' settings), for the times in the log. */
export function setLogTimeZone(zone: string | undefined) {
  timeZone = zone;
}

function stamp(at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  } catch {
    return at.toISOString().replace('T', ' ').slice(0, 19);
  }
}

function write(level: Level, area: string, message: string, err?: unknown) {
  if (ORDER[level] < threshold) return;
  const detail = err instanceof Error ? `: ${err.message}` : err !== undefined && err !== null ? `: ${String(err)}` : '';
  const out = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  out.write(`${stamp()}  ${level.padEnd(5)}  ${area.padEnd(11)}  ${message}${detail}\n`);
  // Something unexpected: where it happened too.
  if (level === 'error' && err instanceof Error && err.stack) out.write(`${err.stack.split('\n').slice(1, 8).join('\n')}\n`);
}

export const log = {
  debug: (area: string, message: string) => write('debug', area, message),
  info: (area: string, message: string) => write('info', area, message),
  warn: (area: string, message: string, err?: unknown) => write('warn', area, message, err),
  error: (area: string, message: string, err?: unknown) => write('error', area, message, err),
};

/** A time in the log: "2026-10-24 02:00" (the household's time). */
export const logTime = (at: number) => stamp(new Date(at)).slice(0, 16);

/** Sizes in the log: "2.6 GB". */
export const gb = (bytes: number | undefined) => (bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : '? GB');

// Fastify's own log (pino's JSON lines): written the same way, its extra fields after the message.
const PINO_FIELDS = new Set(['level', 'time', 'pid', 'hostname', 'reqId', 'msg', 'err', 'req', 'res', 'responseTime']);
export const fastifyLogStream = {
  write(line: string) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      process.stdout.write(line);
      return;
    }
    const level = FROM_PINO[Number(entry.level)] ?? 'info';
    const extra = Object.entries(entry)
      .filter(([k, v]) => !PINO_FIELDS.has(k) && v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    const e = entry.err as { message?: string; stack?: string } | undefined;
    const err = e ? Object.assign(new Error(e.message), { stack: e.stack }) : undefined;
    write(level, 'server', [entry.msg, extra].filter(Boolean).join(' · '), err);
  },
};
