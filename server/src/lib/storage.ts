import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { HttpError } from './upstream';

/** Netfish's own small files (settings, connections) in the data folder. */

const uid = () => (typeof process.getuid === 'function' ? process.getuid() : undefined);
const gid = () => (typeof process.getgid === 'function' ? process.getgid() : undefined);

/** The fix, in words someone can paste into a terminal on the server. */
export function storageFix(): string {
  const owner = uid() !== undefined ? `${uid()}:${gid()}` : '1000:1000';
  return `Netfish can't save to its data folder (${config.dataDir} inside the container). On the server, give the folder to Netfish's user — e.g. "sudo chown -R ${owner} /docker-data-volumes/netfish-data" — or update to the latest Netfish image, which fixes this by itself.`;
}

export function storageWritable(): boolean {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.accessSync(config.dataDir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Write JSON atomically (never a half-written file); explain permission problems clearly. */
export function writeJson(file: string, data: unknown, mode = 0o644) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
    fs.renameSync(tmp, file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new HttpError(500, storageFix());
    throw err;
  }
}
