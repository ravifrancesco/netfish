import fs from 'node:fs';
import path from 'node:path';
import type { CleanupSuggestion, MediaType } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config, has } from '../config';
import { posterOf, radarr, sonarr } from '../clients/arr';
import { jellyfin, type JfItem } from '../clients/jellyfin';
import { mapLimit, settle } from '../lib/async';
import { MINUTE, TTLCache } from '../lib/cache';
import { gb, log } from '../lib/log';
import { writeJson } from '../lib/storage';
import { getSettings } from '../settings';
import { freshHidden } from './fresh';
import { deleteFromDisk } from './manage';

/**
 * What could go to free space, from Radarr/Sonarr's sizes and everyone's viewing in
 * Jellyfin: titles everyone who watched them finished long ago, and titles nobody has
 * started in the year since they arrived. Anything someone is partway through is left
 * alone, and an admin can say "keep" to anything for good.
 *
 * Seasons go by themselves (Settings → Shows): one everyone who started it has finished,
 * the last of them a while ago (30 days unless an admin says otherwise), is listed here for a
 * day first (an admin can keep it), then deleted from disk; it stays listed as Not on disk,
 * ready to download again. Or it's only suggested here.
 */

const DAY = 86_400_000;
/** Finished by everyone who watched it, and untouched for this long. */
const FINISHED_FOR = 180 * DAY;
/** In the library this long and nobody has started it. */
const UNWATCHED_FOR = 365 * DAY;

const FILE = path.join(config.dataDir, 'keep.json');
let kept: Record<string, string> = (() => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
})();

const cache = new TTLCache<CleanupSuggestion[]>(2);

/** A season due to go is listed in Storage this long before it's deleted. */
const NOTICE = DAY;
/** When each season due to go (`tv-<tmdbId>-s<n>`) was first found due. */
const NOTICED_FILE = path.join(config.dataDir, 'season-cleanup.json');
let noticed: Record<string, number> = (() => {
  try {
    return JSON.parse(fs.readFileSync(NOTICED_FILE, 'utf8'));
  } catch {
    return {};
  }
})();
const seasonKey = (f: { tmdbId: number; season: number }) => `tv-${f.tmdbId}-s${f.season}`;
export const forgetCleanup = () => cache.clear();

/** `tv-<tmdbId>` keeps a whole title, `tv-<tmdbId>-s<n>` one season. */
export function keepForGood(key: string) {
  kept = { ...kept, [key]: new Date().toISOString() };
  writeJson(FILE, kept);
  cache.clear();
  return { ok: true };
}

/** Everyone's viewing of one title, folded together. */
interface Viewing {
  started: boolean;
  /** Someone stopped partway (a movie in progress, a show not finished). */
  unfinished: boolean;
  last: number;
}

const time = (date?: string) => Date.parse(date ?? '') || 0;
const small = (url?: string) => url?.replace(/\/t\/p\/original\//, '/t/p/w185/');

export function cleanupSuggestions(admin: SessionUser): Promise<CleanupSuggestion[]> {
  return cache.wrap('all', 10 * MINUTE, async () => {
    const token = config.jellyfin.apiKey ?? admin.token;
    const [users, movies, series, library] = await Promise.all([
      jellyfin.users(token),
      has.radarr() ? settle(radarr.movies(), []) : [],
      has.sonarr() ? settle(sonarr.allSeries(), []) : [],
      jellyfin.items(token, {
        userId: admin.id,
        recursive: true,
        includeItemTypes: 'Movie,Series',
        fields: 'ProviderIds,DateCreated',
        enableImages: false,
      }),
    ]);

    // Jellyfin's ids for each TMDB/TVDB title, and when it arrived.
    const byKey = new Map<string, JfItem>();
    for (const item of library.Items) {
      const type = item.Type === 'Series' ? 'tv' : 'movie';
      if (item.ProviderIds?.Tmdb) byKey.set(`${type}-${item.ProviderIds.Tmdb}`, item);
      if (type === 'tv' && item.ProviderIds?.Tvdb) byKey.set(`tvdb-${item.ProviderIds.Tvdb}`, item);
    }

    // Everyone's viewing, per Jellyfin movie or series id.
    const viewing = new Map<string, Viewing>();
    const note = (id: string | undefined, played: boolean, inProgress: boolean, last: number) => {
      if (!id) return;
      const v = viewing.get(id) ?? { started: false, unfinished: false, last: 0 };
      v.started ||= played || inProgress || last > 0;
      v.unfinished ||= inProgress;
      v.last = Math.max(v.last, last);
      viewing.set(id, v);
    };
    await mapLimit(users, 2, async (user) => {
      const query = { userId: user.Id, recursive: true, fields: 'ProviderIds', enableImages: false };
      const [movieData, shows, episodes] = await Promise.all([
        jellyfin.items(token, { ...query, includeItemTypes: 'Movie' }),
        jellyfin.items(token, { ...query, includeItemTypes: 'Series' }),
        jellyfin.items(token, { ...query, includeItemTypes: 'Episode', sortBy: 'DatePlayed', sortOrder: 'Descending', filters: 'IsPlayed', limit: 2000 }),
      ]);
      for (const m of movieData.Items) {
        const ud = m.UserData;
        note(m.Id, Boolean(ud?.Played), Boolean(ud?.PlaybackPositionTicks) && !ud?.Played, time(ud?.LastPlayedDate));
      }
      // A show counts as unfinished for someone who watched some of it but not all.
      const lastEpisode = new Map<string, number>();
      for (const e of episodes.Items) if (e.SeriesId) lastEpisode.set(e.SeriesId, Math.max(lastEpisode.get(e.SeriesId) ?? 0, time(e.UserData?.LastPlayedDate)));
      for (const s of shows.Items) {
        const last = lastEpisode.get(s.Id) ?? 0;
        if (!last && !s.UserData?.Played) continue;
        note(s.Id, Boolean(s.UserData?.Played), !s.UserData?.Played && last > 0, last);
      }
    });

    const now = Date.now();
    const judge = (item: JfItem | undefined): Pick<CleanupSuggestion, 'reason' | 'since'> | undefined => {
      if (!item) return undefined;
      const v = viewing.get(item.Id);
      if (v?.unfinished) return undefined;
      if (v?.started) return now - v.last > FINISHED_FOR ? { reason: 'finished', since: new Date(v.last).toISOString() } : undefined;
      const added = time(item.DateCreated);
      return added && now - added > UNWATCHED_FOR ? { reason: 'unwatched', since: new Date(added).toISOString() } : undefined;
    };

    const out: CleanupSuggestion[] = [];
    // New titles for channels go by themselves once they've aired.
    const fresh = freshHidden();
    for (const m of movies) {
      if (!m.sizeOnDisk || !m.tmdbId || fresh.has(`movie-${m.tmdbId}`)) continue;
      const key = `movie-${m.tmdbId}`;
      const verdict = kept[key] ? undefined : judge(byKey.get(key));
      if (verdict) out.push({ key, mediaType: 'movie' as MediaType, tmdbId: m.tmdbId, title: m.title, year: m.year, poster: small(posterOf(m.images)), size: m.sizeOnDisk, ...verdict });
    }
    for (const s of series) {
      const size = s.statistics?.sizeOnDisk ?? 0;
      if (!size || !s.tmdbId || fresh.has(`tv-${s.tmdbId}`)) continue;
      const key = `tv-${s.tmdbId}`;
      const verdict = kept[key] ? undefined : judge(byKey.get(key) ?? byKey.get(`tvdb-${s.tvdbId}`));
      if (verdict) out.push({ key, mediaType: 'tv', tmdbId: s.tmdbId, title: s.title, year: s.year, poster: small(posterOf(s.images)), size, ...verdict });
    }
    // Seasons everyone has finished: suggested, or (deleting by themselves) when each one goes.
    const mode = getSettings().seasonCleanup;
    if (mode !== 'off') {
      const whole = new Set(out.map((o) => o.key));
      for (const f of await settle(finishedSeasons(), [])) {
        if (whole.has(`tv-${f.tmdbId}`)) continue; // the whole show is suggested already
        const deleteAt = mode === 'delete' ? new Date((noticed[seasonKey(f)] ?? Date.now()) + NOTICE).toISOString() : undefined;
        out.push({ key: `tv-${f.tmdbId}`, mediaType: 'tv', tmdbId: f.tmdbId, title: f.title, year: f.year, poster: f.poster, size: f.size, season: f.season, reason: 'finished', since: f.since, deleteAt });
      }
    }
    return out.sort((a, b) => b.size - a.size);
  });
}

// ---------- Seasons everyone has finished ----------

interface FinishedSeason {
  tmdbId: number;
  title: string;
  year?: number;
  poster?: string;
  season: number;
  size: number;
  /** When the last person who started it last watched any of it. */
  since: string;
}

const seasons = new TTLCache<FinishedSeason[]>(2);

/**
 * Seasons everyone who started them has finished, the last of them at least the days in
 * Settings ago. Needs Jellyfin's API key (everyone's viewing). Left alone: seasons nobody
 * started, anything someone is partway through, anything kept, New titles, and the latest
 * season of a show still running (its new episodes keep coming).
 */
function finishedSeasons(): Promise<FinishedSeason[]> {
  return seasons.wrap('all', 10 * MINUTE, async () => {
    const token = config.jellyfin.apiKey;
    if (!token || !has.sonarr()) return [];
    const users = await jellyfin.users(token);
    const admin = users.find((u) => u.Policy?.IsAdministrator) ?? users[0];
    if (!admin) return [];
    const [series, shows, episodes] = await Promise.all([
      sonarr.allSeries(),
      jellyfin.items(token, { userId: admin.Id, recursive: true, includeItemTypes: 'Series', fields: 'ProviderIds', enableImages: false }),
      jellyfin.items(token, { userId: admin.Id, recursive: true, includeItemTypes: 'Episode', enableImages: false }),
    ]);

    // Each season's episodes on disk, by Jellyfin series id and season number.
    const inSeason = new Map<string, string[]>();
    const seasonOf = new Map<string, string>();
    for (const e of episodes.Items) {
      if (!e.SeriesId || !e.ParentIndexNumber || e.LocationType === 'Virtual') continue;
      const key = `${e.SeriesId}:${e.ParentIndexNumber}`;
      inSeason.set(key, [...(inSeason.get(key) ?? []), e.Id]);
      seasonOf.set(e.Id, key);
    }

    // Per season: who started it, whether each of them finished it, and when they last watched.
    const started = new Map<string, Set<string>>();
    const unfinished = new Set<string>();
    const last = new Map<string, number>();
    await mapLimit(users, 2, async (user) => {
      const query = { userId: user.Id, recursive: true, includeItemTypes: 'Episode', enableImages: false };
      const [played, resuming] = await Promise.all([
        jellyfin.items(token, { ...query, filters: 'IsPlayed' }),
        jellyfin.items(token, { ...query, filters: 'IsResumable' }),
      ]);
      const playedIds = new Set(played.Items.map((e) => e.Id));
      const touched = new Set<string>();
      for (const e of [...played.Items, ...resuming.Items]) {
        const key = seasonOf.get(e.Id);
        if (!key) continue;
        touched.add(key);
        last.set(key, Math.max(last.get(key) ?? 0, time(e.UserData?.LastPlayedDate)));
      }
      for (const e of resuming.Items) {
        const key = seasonOf.get(e.Id);
        if (key) unfinished.add(key);
      }
      for (const key of touched) {
        started.set(key, (started.get(key) ?? new Set()).add(user.Id));
        if (!(inSeason.get(key) ?? []).every((id) => playedIds.has(id))) unfinished.add(key);
      }
    });

    const bySeries = new Map(series.map((x) => [x.tvdbId, x]));
    const fresh = freshHidden();
    const days = getSettings().seasonCleanupDays;
    const out: FinishedSeason[] = [];
    for (const show of shows.Items) {
      const managed = bySeries.get(Number(show.ProviderIds?.Tvdb));
      if (!managed?.tmdbId || kept[`tv-${managed.tmdbId}`] || fresh.has(`tv-${managed.tmdbId}`)) continue;
      const onDisk = (managed.seasons ?? []).filter((x) => x.seasonNumber > 0 && (x.statistics?.episodeFileCount ?? 0) > 0);
      const latest = Math.max(0, ...(managed.seasons ?? []).map((x) => x.seasonNumber));
      for (const sn of onDisk) {
        const key = `${show.Id}:${sn.seasonNumber}`;
        const when = last.get(key) ?? 0;
        if (!started.get(key)?.size || unfinished.has(key) || !when || Date.now() - when < days * DAY) continue;
        if (kept[`tv-${managed.tmdbId}-s${sn.seasonNumber}`]) continue;
        if (managed.status === 'continuing' && sn.seasonNumber === latest) continue;
        out.push({
          tmdbId: managed.tmdbId,
          title: managed.title,
          year: managed.year,
          poster: small(posterOf(managed.images)),
          season: sn.seasonNumber,
          size: sn.statistics?.sizeOnDisk ?? 0,
          since: new Date(when).toISOString(),
        });
      }
    }
    return out;
  });
}

/**
 * Deletes the seasons everyone has finished (when Settings says so), each a day after it was
 * first found due: until then it's listed in Storage, where an admin can keep it. Every 2 hours.
 */
async function cleanSeasons() {
  if (getSettings().seasonCleanup !== 'delete' || !config.jellyfin.apiKey) return;
  seasons.clear();
  const found = await finishedSeasons();
  const now = Date.now();
  // Noted when first found due; forgotten once not due any more (kept, or someone started it again).
  const next: Record<string, number> = {};
  for (const f of found) next[seasonKey(f)] = noticed[seasonKey(f)] ?? now;
  const changed = Object.keys(next).length !== Object.keys(noticed).length || Object.keys(next).some((k) => noticed[k] !== next[k]);
  noticed = next;
  if (changed) {
    try {
      writeJson(NOTICED_FILE, noticed);
    } catch {
      /* the storage warning in Settings already explains this */
    }
    cache.clear();
  }
  const due = found.filter((f) => now - noticed[seasonKey(f)] >= NOTICE);
  if (!due.length) return;
  const token = config.jellyfin.apiKey;
  const users = await jellyfin.users(token);
  const admin = users.find((u) => u.Policy?.IsAdministrator) ?? users[0];
  if (!admin) return;
  const as: SessionUser = { id: admin.Id, name: 'Netfish', isAdmin: true, token, canDownload: false };
  for (const f of due) {
    await settle(
      deleteFromDisk(as, 'tv', f.tmdbId, [f.season]).then(({ freed }) => {
        const ago = Math.round((Date.now() - Date.parse(f.since)) / DAY);
        log.info('clean-up', `deleted ${f.title} season ${f.season} from disk (${gb(freed)}): everyone who started it finished it, the last ${ago} days ago`);
      }),
      undefined,
      (err) => log.warn('clean-up', `couldn't delete ${f.title} season ${f.season}`, err),
    );
  }
  seasons.clear();
  cache.clear();
}

const timers = [setTimeout(() => void cleanSeasons(), 10 * MINUTE), setInterval(() => void cleanSeasons(), 2 * 60 * MINUTE)];
for (const timer of timers) timer.unref?.();
