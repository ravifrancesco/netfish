import fs from 'node:fs';
import path from 'node:path';
import type { ServerSettings } from '@netfish/shared';
import { config } from './config';
import { writeJson } from './lib/storage';
import { HttpError } from './lib/upstream';

/**
 * Settings admins change from the app, kept in a small JSON file in the data
 * directory (a Docker volume), so they survive restarts and image updates.
 */

const FILE = path.join(config.dataDir, 'settings.json');
const DEFAULTS: ServerSettings = { maxMovieSizeGb: null, maxEpisodeSizeGb: null, manualGrabs: config.manualGrabs };

function size(value: unknown, field: string): number | null {
  if (value === null || value === '' || value === 0) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new HttpError(400, `${field} must be a size in GB, or empty for no limit`);
  return Math.round(n * 100) / 100;
}

function validate(input: Partial<Record<keyof ServerSettings, unknown>>): Partial<ServerSettings> {
  const out: Partial<ServerSettings> = {};
  if ('maxMovieSizeGb' in input) out.maxMovieSizeGb = size(input.maxMovieSizeGb, 'Movie size limit');
  if ('maxEpisodeSizeGb' in input) out.maxEpisodeSizeGb = size(input.maxEpisodeSizeGb, 'Episode size limit');
  if ('manualGrabs' in input) {
    if (input.manualGrabs !== 'all' && input.manualGrabs !== 'admin') throw new HttpError(400, 'manualGrabs must be "all" or "admin"');
    out.manualGrabs = input.manualGrabs;
  }
  return out;
}

function load(): ServerSettings {
  try {
    return { ...DEFAULTS, ...validate(JSON.parse(fs.readFileSync(FILE, 'utf8'))) };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();

export const getSettings = (): ServerSettings => current;

export function updateSettings(patch: Partial<Record<keyof ServerSettings, unknown>>): ServerSettings {
  const next = { ...current, ...validate(patch ?? {}) };
  writeJson(FILE, next);
  current = next;
  return current;
}

export const GB = 1024 ** 3;
