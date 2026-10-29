import fs from 'node:fs';
import path from 'node:path';
import type { DownloadDetail, ServerSettings } from '@netfish/shared';
import { config } from './config';
import { writeJson } from './lib/storage';
import { HttpError } from './lib/upstream';
import { t } from './lib/i18n';

/**
 * Settings admins change from the app, kept in a small JSON file in the data
 * directory (a Docker volume), so they survive restarts and image updates.
 */

const FILE = path.join(config.dataDir, 'settings.json');
/** Every detail Activity can show about a download. */
const DETAILS: DownloadDetail[] = ['quality', 'languages', 'release', 'formats', 'indexer', 'client'];
// Until an admin picks, everyone sees what Activity always showed: quality, languages and the release.
const DEFAULTS: ServerSettings = {
  maxMovieSizeGb: null,
  maxEpisodeSizeGb: null,
  manualGrabs: config.manualGrabs,
  downloadDetails: ['quality', 'languages', 'release'],
  discoverTab: false,
  keepUp: true,
  seasonCleanup: 'delete',
  seasonCleanupDays: 30,
};
const CLEANUP: ServerSettings['seasonCleanup'][] = ['delete', 'suggest', 'off'];

function size(value: unknown, field: string): number | null {
  if (value === null || value === '' || value === 0) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) throw new HttpError(400, t('{field} must be a size in GB, or empty for no limit', { field: t(field) }));
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
  if ('downloadDetails' in input) {
    const list = input.downloadDetails;
    if (!Array.isArray(list) || list.some((d) => !DETAILS.includes(d))) throw new HttpError(400, `downloadDetails must be a list of: ${DETAILS.join(', ')}`);
    out.downloadDetails = DETAILS.filter((d) => list.includes(d));
  }
  if ('discoverTab' in input) {
    if (typeof input.discoverTab !== 'boolean') throw new HttpError(400, 'discoverTab must be true or false');
    out.discoverTab = input.discoverTab;
  }
  if ('keepUp' in input) {
    if (typeof input.keepUp !== 'boolean') throw new HttpError(400, 'keepUp must be true or false');
    out.keepUp = input.keepUp;
  }
  if ('seasonCleanup' in input) {
    if (!CLEANUP.includes(input.seasonCleanup as ServerSettings['seasonCleanup'])) throw new HttpError(400, `seasonCleanup must be one of: ${CLEANUP.join(', ')}`);
    out.seasonCleanup = input.seasonCleanup as ServerSettings['seasonCleanup'];
  }
  if ('seasonCleanupDays' in input) {
    const days = Number(input.seasonCleanupDays);
    if (!Number.isInteger(days) || days < 7 || days > 365) throw new HttpError(400, t('Between 7 and 365 days'));
    out.seasonCleanupDays = days;
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
