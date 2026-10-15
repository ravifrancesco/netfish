import fs from 'node:fs';
import path from 'node:path';
import type { CleanupSuggestion, MediaType } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config, has } from '../config';
import { posterOf, radarr, sonarr } from '../clients/arr';
import { jellyfin, type JfItem } from '../clients/jellyfin';
import { mapLimit, settle } from '../lib/async';
import { MINUTE, TTLCache } from '../lib/cache';
import { writeJson } from '../lib/storage';

/**
 * What could go to free space, from Radarr/Sonarr's sizes and everyone's viewing in
 * Jellyfin: titles everyone who watched them finished long ago, and titles nobody has
 * started in the year since they arrived. Anything someone is partway through is left
 * alone, and an admin can say "keep" to anything for good.
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
export const forgetCleanup = () => cache.clear();

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
    for (const m of movies) {
      if (!m.sizeOnDisk || !m.tmdbId) continue;
      const key = `movie-${m.tmdbId}`;
      const verdict = kept[key] ? undefined : judge(byKey.get(key));
      if (verdict) out.push({ key, mediaType: 'movie' as MediaType, tmdbId: m.tmdbId, title: m.title, year: m.year, poster: small(posterOf(m.images)), size: m.sizeOnDisk, ...verdict });
    }
    for (const s of series) {
      const size = s.statistics?.sizeOnDisk ?? 0;
      if (!size || !s.tmdbId) continue;
      const key = `tv-${s.tmdbId}`;
      const verdict = kept[key] ? undefined : judge(byKey.get(key) ?? byKey.get(`tvdb-${s.tvdbId}`));
      if (verdict) out.push({ key, mediaType: 'tv', tmdbId: s.tmdbId, title: s.title, year: s.year, poster: small(posterOf(s.images)), size, ...verdict });
    }
    return out.sort((a, b) => b.size - a.size);
  });
}
