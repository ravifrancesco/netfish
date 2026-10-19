import fs from 'node:fs';
import path from 'node:path';
import type { Card, DiskInfo, MediaType, RemovedInfo, StopMode, StorageInfo } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config, has } from '../config';
import { posterOf, radarr, sonarr, type ArrDisk, type ArrHistoryRecord, type ArrRootFolder, type RadarrMovie, type SonarrSeries } from '../clients/arr';
import { jellyfin } from '../clients/jellyfin';
import { seerr } from '../clients/seerr';
import { settle } from '../lib/async';
import { MINUTE, TTLCache } from '../lib/cache';
import { t } from '../lib/i18n';
import { writeJson } from '../lib/storage';
import { HttpError } from '../lib/upstream';
import { forgetRadarrMovie, forgetSonarrSeries, radarrMovie, sonarrSeries } from './arrLookup';
import { catalog } from './catalog';
import { allDownloads, forgetDownloads } from './downloads';
import { invalidateLibrary } from './library';
import { grabbedKeys, seriesFor } from './releases';
import { myRequestKeys } from './requests';
import { forgetCleanup } from './cleanup';

/**
 * Managing what's on disk, through Radarr and Sonarr: stopping a download, deleting a
 * title's files to free space while keeping it listed ("Not on disk"), and getting it
 * back. Netfish remembers what it deleted, and when, in its data folder.
 */

interface Removed extends RemovedInfo {
  mediaType: MediaType;
  tmdbId: number;
  /** A show's, to find it in Sonarr (deletions from 0.7.12 on; older ones look it up). */
  tvdbId?: number;
  title: string;
  year?: number;
}

const FILE = path.join(config.dataDir, 'removed.json');
let removed: Record<string, Removed> = (() => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
})();
const save = () => writeJson(FILE, removed);
const storageCache = new TTLCache<StorageInfo>(2);
const keyOf = (mediaType: MediaType, tmdbId: number) => `${mediaType}-${tmdbId}`;
const sum = (ns: Array<number | undefined>) => ns.reduce<number>((total, n) => total + (n ?? 0), 0);

/** Seerr still thinks a title it never hears about is downloaded or on its way; "unknown" makes it requestable again. */
async function resetSeerr(mediaType: MediaType, tmdbId: number | undefined, status: 'unknown' | 'processing' = 'unknown') {
  if (!tmdbId || !has.seerr()) return;
  const media = mediaType === 'movie' ? (await catalog.movie(tmdbId)).mediaInfo : (await catalog.tv(tmdbId)).mediaInfo;
  if (media?.id) await seerr.setMediaStatus(media.id, status);
  catalog.invalidate(mediaType, tmdbId);
}

/**
 * A request taken back: Seerr forgets the title and its requests. (Only setting it to
 * "unknown" isn't enough: Seerr checks Radarr/Sonarr every few minutes and sets anything
 * they still know without files back to "processing".)
 */
async function forgetRequest(mediaType: MediaType, tmdbId: number | undefined) {
  if (!tmdbId || !has.seerr()) return;
  const media = mediaType === 'movie' ? (await catalog.movie(tmdbId)).mediaInfo : (await catalog.tv(tmdbId)).mediaInfo;
  if (media?.id) await seerr.deleteMedia(media.id);
  catalog.invalidate(mediaType, tmdbId);
}

function forget(mediaType: MediaType, tmdbId: number, tvdbId?: number) {
  if (mediaType === 'movie') forgetRadarrMovie(tmdbId);
  else forgetSonarrSeries(tvdbId);
  catalog.invalidate(mediaType, tmdbId);
  invalidateLibrary();
  forgetDownloads();
  storageCache.clear();
  goneCache.clear();
  forgetCleanup();
}

// ---------- Stopping a download ----------

async function isMine(user: SessionUser, mediaType: MediaType, tmdbId?: number, tvdbId?: number) {
  const mine = new Set([...(await settle(myRequestKeys(user), new Set<string>())), ...grabbedKeys(user)]);
  return (tmdbId !== undefined && mine.has(keyOf(mediaType, tmdbId))) || (tvdbId !== undefined && mine.has(`tvdb-${tvdbId}`));
}

export async function stopDownload(user: SessionUser, id: string, mode: StopMode) {
  const item = (await allDownloads()).find((d) => d.id === id);
  if (!item) throw new HttpError(404, t('That download has already finished or been stopped'));
  if (!user.isAdmin && !(await isMine(user, item.mediaType, item.tmdbId, item.tvdbId))) {
    throw new HttpError(403, t('Only an admin, or whoever asked for it, can stop this download'));
  }
  // "stop": gone for good. "replace": this release is blocklisted and Radarr/Sonarr look for another one.
  const removal = mode === 'replace' ? { blocklist: true, skipRedownload: false } : { blocklist: false, skipRedownload: true };

  if (item.source === 'radarr') {
    const queueId = Number(id.slice('radarr-'.length));
    const record = (await radarr.queue()).records.find((r) => r.id === queueId);
    if (!record) throw new HttpError(404, t('That download has already finished or been stopped'));
    await radarr.removeFromQueue([queueId], removal);
    // Another release: Radarr only looks again by itself when it's set to (and not for one picked
    // by hand, as Versions does), so it's asked to search now.
    if (mode === 'replace' && record.movieId) await settle(radarr.search([record.movieId]), undefined);
    if (mode === 'stop' && record.movieId) {
      if (item.tmdbId) forgetRadarrMovie(item.tmdbId);
      const movie = item.tmdbId ? await settle(radarrMovie(item.tmdbId), undefined) : undefined;
      if (movie?.hasFile) {
        // Was replacing a copy that's already there: keep that one, stop looking for better.
        await radarr.setMonitored([record.movieId], false);
      } else {
        // Nothing on disk: take the request back, so it can be asked for again.
        await radarr.deleteMovie(record.movieId);
        await settle(forgetRequest('movie', item.tmdbId), undefined);
      }
    }
  } else {
    const records = (await sonarr.queue()).records.filter((r) => `sonarr-${r.downloadId ?? r.id}` === id);
    if (!records.length) throw new HttpError(404, t('That download has already finished or been stopped'));
    await sonarr.removeFromQueue(
      records.map((r) => r.id),
      removal,
    );
    const episodes = records.map((r) => r.episodeId).filter((n): n is number => n !== undefined);
    // Another release: searched for now, as for films.
    if (mode === 'replace' && episodes.length) await settle(sonarr.searchEpisodes(episodes), undefined);
    if (mode === 'stop' && episodes.length) await sonarr.setEpisodesMonitored(episodes, false);
    // The show's only download, and nothing of it on disk: take the request back.
    const seriesId = records[0]?.seriesId;
    if (mode === 'stop' && seriesId) {
      const left = (await sonarr.queue()).records.some((r) => r.seriesId === seriesId);
      // (Unsure what's on disk? Then nothing is forgotten.)
      const files = await sonarr.episodeFiles(seriesId).catch(() => undefined);
      if (!left && files && !files.length) {
        await sonarr.deleteSeries(seriesId);
        await settle(forgetRequest('tv', item.tmdbId), undefined);
      }
    }
  }
  if (item.tmdbId) forget(item.mediaType, item.tmdbId, item.tvdbId);
  forgetDownloads();
  return { ok: true };
}

/**
 * Cancel request: before anything is on disk, Radarr/Sonarr stop looking and forget the
 * title, and Seerr forgets the request, so it reads "not requested" and can be asked for
 * again. Whoever asked for it, or an admin.
 */
export async function cancelRequest(user: SessionUser, mediaType: MediaType, tmdbId: number) {
  if (!user.isAdmin && !(await isMine(user, mediaType, tmdbId))) {
    throw new HttpError(403, t('Only an admin, or whoever asked for it, can cancel this request'));
  }
  const stopped = { blocklist: false, skipRedownload: true };
  if (mediaType === 'movie') {
    forgetRadarrMovie(tmdbId);
    const movie = has.radarr() ? await settle(radarrMovie(tmdbId), undefined) : undefined;
    if (movie?.hasFile) throw new HttpError(409, t("It's already on disk: delete it from disk instead"));
    if (movie) {
      const queued = (await radarr.queue()).records.filter((r) => r.movieId === movie.id).map((r) => r.id);
      if (queued.length) await radarr.removeFromQueue(queued, stopped);
      await radarr.deleteMovie(movie.id);
    }
  } else {
    const series = has.sonarr() ? await settle(seriesFor(user, tmdbId), undefined) : undefined;
    if (series) {
      if (series.statistics?.episodeFileCount) throw new HttpError(409, t("It's already on disk: delete it from disk instead"));
      const queued = (await sonarr.queue()).records.filter((r) => r.seriesId === series.id).map((r) => r.id);
      if (queued.length) await sonarr.removeFromQueue(queued, stopped);
      await sonarr.deleteSeries(series.id);
    }
  }
  await forgetRequest(mediaType, tmdbId);
  forget(mediaType, tmdbId);
  return { ok: true };
}

// ---------- Deleting from disk, and getting it back ----------

async function freshMovie(tmdbId: number) {
  forgetRadarrMovie(tmdbId);
  const movie = await radarrMovie(tmdbId);
  if (!movie) throw new HttpError(404, t("Radarr doesn't manage this movie"));
  return movie;
}

async function freshSeries(user: SessionUser, tmdbId: number) {
  const series = await seriesFor(user, tmdbId);
  forgetSonarrSeries(series.tvdbId);
  return seriesFor(user, tmdbId);
}

/** Jellyfin notices deleted files on its next scan; ask for it now so the title leaves the library right away. */
async function rescan(user: SessionUser) {
  await settle(jellyfin.refreshLibrary(config.jellyfin.apiKey ?? user.token), undefined);
}

export async function deleteFromDisk(user: SessionUser, mediaType: MediaType, tmdbId: number, seasons?: number[]) {
  const key = keyOf(mediaType, tmdbId);
  let freed = 0;
  let tvdbId: number | undefined;
  if (mediaType === 'movie') {
    const movie = await freshMovie(tmdbId);
    if (!movie.movieFile) throw new HttpError(404, t("There's no file to delete"));
    freed = movie.movieFile.size ?? movie.sizeOnDisk ?? 0;
    await radarr.deleteFile(movie.movieFile.id);
    // Unmonitored, so Radarr doesn't simply download it again.
    await radarr.setMonitored([movie.id], false);
    removed[key] = { mediaType, tmdbId, title: movie.title, year: movie.year, size: freed, at: new Date().toISOString(), by: user.name };
    await settle(resetSeerr('movie', tmdbId), undefined);
  } else {
    const series = await freshSeries(user, tmdbId);
    tvdbId = series.tvdbId;
    const files = await sonarr.episodeFiles(series.id);
    const chosen = seasons?.length ? files.filter((f) => seasons.includes(f.seasonNumber ?? -1)) : files;
    if (!chosen.length) throw new HttpError(404, t("There's no file to delete"));
    freed = sum(chosen.map((f) => f.size));
    await sonarr.deleteFiles(chosen.map((f) => f.id));
    const gone = [...new Set(chosen.map((f) => f.seasonNumber ?? -1))];
    const episodes = await sonarr.episodes(series.id);
    await sonarr.setEpisodesMonitored(
      episodes.filter((e) => gone.includes(e.seasonNumber)).map((e) => e.id),
      false,
    );
    const whole = chosen.length === files.length;
    if (whole) {
      await sonarr.setSeriesMonitored([series.id], false);
      await settle(resetSeerr('tv', tmdbId), undefined);
    }
    const before = removed[key];
    removed[key] = {
      mediaType,
      tmdbId,
      tvdbId,
      title: series.title,
      year: series.year,
      size: (before?.size ?? 0) + freed,
      seasons: whole ? undefined : [...new Set([...(before?.seasons ?? []), ...gone])].sort((a, b) => a - b),
      at: new Date().toISOString(),
      by: user.name,
    };
  }
  save();
  await rescan(user);
  forget(mediaType, tmdbId, tvdbId);
  return { freed };
}

export async function downloadAgain(user: SessionUser, mediaType: MediaType, tmdbId: number, seasons?: number[]) {
  const key = keyOf(mediaType, tmdbId);
  let tvdbId: number | undefined;
  if (mediaType === 'movie') {
    const movie = await freshMovie(tmdbId);
    await radarr.setMonitored([movie.id], true);
    await radarr.search([movie.id]);
    delete removed[key];
  } else {
    const series = await freshSeries(user, tmdbId);
    tvdbId = series.tvdbId;
    const entry = removed[key];
    const all = (series.seasons ?? []).map((s) => s.seasonNumber).filter((n) => n > 0);
    const wanted = seasons?.length ? seasons : (entry?.seasons ?? all);
    const episodes = await sonarr.episodes(series.id);
    await sonarr.setEpisodesMonitored(
      episodes.filter((e) => wanted.includes(e.seasonNumber)).map((e) => e.id),
      true,
    );
    await sonarr.setSeriesMonitored([series.id], true);
    for (const season of wanted) await sonarr.searchSeason(series.id, season);
    const left = (entry?.seasons ?? []).filter((s) => !wanted.includes(s));
    if (entry && left.length) removed[key] = { ...entry, seasons: left };
    else delete removed[key];
  }
  save();
  // Seerr shows it as on its way again (it was "unknown" while off the disk).
  await settle(resetSeerr(mediaType, tmdbId, 'processing'), undefined);
  forget(mediaType, tmdbId, tvdbId);
  return { ok: true };
}

// ---------- Not on disk ----------

/**
 * Not on disk, as Radarr and Sonarr have it: a title they still have, unmonitored (so it isn't
 * coming back by itself), without files, and with a file deleted in their history: by Netfish,
 * on their own pages or by another tool (not one replaced by a better one). A show: all of it.
 * What Netfish deleted itself it also remembers (who, when, the space freed; a show's seasons).
 */
interface Gone {
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year?: number;
  /** When its last file was deleted. */
  at: string;
}
const kept = (h: ArrHistoryRecord) => h.data?.reason !== 'Upgrade';
const goneCache = new TTLCache<Map<string, Gone>>(2);

/** Everything Radarr (movies) or Sonarr (shows) has off the disk, for the lists. */
function arrGone(mediaType: MediaType): Promise<Map<string, Gone>> {
  return goneCache.wrap(mediaType, 2 * MINUTE, async () => {
    const out = new Map<string, Gone>();
    const latest = (records: ArrHistoryRecord[], id: (h: ArrHistoryRecord) => number | undefined) => {
      const at = new Map<number, string>();
      for (const h of records) {
        const n = id(h);
        if (n !== undefined && kept(h) && (!at.has(n) || h.date > at.get(n)!)) at.set(n, h.date);
      }
      return at;
    };
    if (mediaType === 'movie') {
      if (!has.radarr()) return out;
      const [movies, deletions] = await Promise.all([radarr.movies(), radarr.fileDeletions()]);
      const at = latest(deletions, (h) => h.movieId);
      for (const m of movies) {
        const when = at.get(m.id);
        if (when && !m.hasFile && !m.monitored && m.tmdbId) out.set(keyOf('movie', m.tmdbId), { mediaType, tmdbId: m.tmdbId, title: m.title, year: m.year, at: when });
      }
    } else {
      if (!has.sonarr()) return out;
      const [series, deletions] = await Promise.all([sonarr.allSeries(), sonarr.fileDeletions()]);
      const at = latest(deletions, (h) => h.seriesId);
      for (const x of series) {
        const when = at.get(x.id);
        if (when && !x.monitored && !(x.statistics?.episodeFileCount ?? 0) && x.tmdbId) out.set(keyOf('tv', x.tmdbId), { mediaType, tmdbId: x.tmdbId, title: x.title, year: x.year, at: when });
      }
    }
    return out;
  });
}

const tvdbOf = async (tmdbId: number, known?: number) =>
  known ?? (has.seerr() ? (await settle(catalog.tv(tmdbId), undefined))?.externalIds?.tvdbId : undefined);

/**
 * Whether what Netfish remembers deleting is still off the disk (Radarr/Sonarr unreachable: as it
 * was). Back on disk, monitored again (on its way back), or gone from Radarr/Sonarr: it isn't.
 * A show with seasons deleted is kept as it is (the rest of it is in the library).
 */
async function stillGone(e: Removed): Promise<boolean> {
  if (e.mediaType === 'movie') {
    const movie = await settle(radarrMovie(e.tmdbId), undefined);
    return movie === undefined || Boolean(movie && !movie.hasFile && !movie.monitored);
  }
  if (e.seasons?.length || !has.sonarr()) return true;
  const tvdbId = await tvdbOf(e.tmdbId, e.tvdbId);
  const series = tvdbId ? await settle(sonarrSeries(tvdbId), undefined) : undefined;
  return series === undefined || Boolean(series && !(series.statistics?.episodeFileCount ?? 0) && !series.monitored);
}

/** For a title's page: off the disk, and since when (and, if Netfish did it, who and how much it freed). */
export async function removedInfo(mediaType: MediaType, tmdbId?: number): Promise<RemovedInfo | undefined> {
  if (!tmdbId) return undefined;
  const entry = removed[keyOf(mediaType, tmdbId)];
  if (entry) return (await stillGone(entry)) ? { at: entry.at, size: entry.size, seasons: entry.seasons, by: entry.by } : undefined;
  // Deleted somewhere else: Radarr's or Sonarr's own word for it.
  if (mediaType === 'movie') {
    const movie = await settle(radarrMovie(tmdbId), undefined);
    if (!movie || movie.hasFile || movie.monitored) return undefined;
    const deletion = (await settle(radarr.movieFileDeletions(movie.id), [])).find(kept);
    return deletion && { at: deletion.date };
  }
  const tvdbId = await tvdbOf(tmdbId);
  const series = tvdbId ? await settle(sonarrSeries(tvdbId), undefined) : undefined;
  if (!series || series.monitored || (series.statistics?.episodeFileCount ?? 0) > 0) return undefined;
  const deletion = (await settle(sonarr.seriesFileDeletions(series.id), [])).find(kept);
  return deletion && { at: deletion.date };
}

/**
 * "Not on disk": titles deleted to save space (the whole of them: a show with a season or two
 * left is still in the library), shown after the library in the same order it's sorted by
 * ("Recently added": the most recently deleted first).
 */
export async function removedTitles(mediaType: MediaType, sort = 'added'): Promise<Card[]> {
  const entries = Object.entries(removed).filter(([, e]) => e.mediaType === mediaType);
  const [checked, fromArr] = await Promise.all([
    Promise.all(entries.map(async ([key, e]) => ((await stillGone(e)) ? e : key))),
    settle(arrGone(mediaType), new Map<string, Gone>()),
  ]);
  // What came back (or left Radarr/Sonarr) is forgotten.
  const back = checked.filter((x): x is string => typeof x === 'string');
  if (back.length) {
    for (const key of back) delete removed[key];
    save();
  }
  const ours = checked.filter((x): x is Removed => typeof x !== 'string' && !x.seasons?.length);
  const known = new Set(ours.map((e) => keyOf(e.mediaType, e.tmdbId)));
  const list: Gone[] = [...ours, ...[...fromArr.values()].filter((g) => !known.has(keyOf(g.mediaType, g.tmdbId)))].sort((a, b) => b.at.localeCompare(a.at));
  const cards = await Promise.all(
    list.map(async (e): Promise<Card> => {
      const [basics, details] = has.seerr()
        ? await Promise.all([
            settle(catalog.basics(e.mediaType, e.tmdbId), undefined),
            settle<{ voteAverage?: number; runtime?: number; episodeRunTime?: number[] } | undefined>(
              e.mediaType === 'movie' ? catalog.movie(e.tmdbId) : catalog.tv(e.tmdbId),
              undefined,
            ),
          ])
        : [undefined, undefined];
      const runtime = details?.runtime || details?.episodeRunTime?.[0];
      return {
        key: keyOf(e.mediaType, e.tmdbId),
        mediaType: e.mediaType,
        tmdbId: e.tmdbId,
        title: basics?.title ?? e.title,
        year: basics?.year ?? e.year,
        poster: basics?.poster,
        backdrop: basics?.backdrop,
        rating: details?.voteAverage || undefined,
        runtimeMinutes: runtime || undefined,
        status: 'none',
      };
    }),
  );
  return sortRemoved(cards, sort);
}

/** The library's orders, for titles that aren't in Jellyfin: unknowns last, then by name. */
function sortRemoved(cards: Card[], sort: string): Card[] {
  const byName = (a: Card, b: Card) => a.title.localeCompare(b.title);
  const by = (value: (c: Card) => number | undefined, ascending = false) => (a: Card, b: Card) => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1;
    return (ascending ? x - y : y - x) || byName(a, b);
  };
  switch (sort) {
    case 'name':
      return [...cards].sort(byName);
    case 'year':
      return [...cards].sort(by((c) => c.year));
    case 'rating':
      return [...cards].sort(by((c) => c.rating));
    case 'shortest':
      return [...cards].sort(by((c) => c.runtimeMinutes, true));
    case 'longest':
      return [...cards].sort(by((c) => c.runtimeMinutes));
    default:
      return cards; // most recently deleted first
  }
}

/** For the title page (admins): the file(s) Radarr/Sonarr have for it. */
export function diskOf(mediaType: MediaType, managed: RadarrMovie | SonarrSeries | null | undefined): DiskInfo | undefined {
  if (!managed) return undefined;
  if (mediaType === 'movie') {
    const m = managed as RadarrMovie;
    return m.movieFile ? { size: m.movieFile.size ?? m.sizeOnDisk ?? 0 } : undefined;
  }
  const s = managed as SonarrSeries;
  const seasons = (s.seasons ?? [])
    .filter((x) => (x.statistics?.episodeFileCount ?? 0) > 0)
    .map((x) => ({ seasonNumber: x.seasonNumber, size: x.statistics?.sizeOnDisk ?? 0, files: x.statistics?.episodeFileCount ?? 0 }));
  return seasons.length ? { size: sum(seasons.map((x) => x.size)), seasons } : undefined;
}

// ---------- Settings → Storage ----------

/** TMDB's original-size posters are megabytes; a list only needs a small one. */
const small = (url?: string) => url?.replace(/\/t\/p\/original\//, '/t/p/w185/');

function disksFor(roots: ArrRootFolder[], disks: ArrDisk[], mediaType: MediaType) {
  return roots.map((root) => {
    // The disk a folder lives on: the mount point that's the longest start of its path.
    const disk = disks
      .filter((d) => root.path.startsWith(d.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    return {
      path: root.path,
      free: disk?.freeSpace ?? root.freeSpace ?? 0,
      total: disk?.totalSpace ?? root.totalSpace ?? 0,
      holds: [mediaType],
    };
  });
}

export function storage(): Promise<StorageInfo> {
  return storageCache.wrap('all', MINUTE, async () => {
    const empty = <T,>(): T[] => [];
    const [rRoots, rDisks, sRoots, sDisks, movies, series] = await Promise.all([
      has.radarr() ? settle(radarr.rootFolders(), empty<ArrRootFolder>()) : empty<ArrRootFolder>(),
      has.radarr() ? settle(radarr.diskSpace(), empty<ArrDisk>()) : empty<ArrDisk>(),
      has.sonarr() ? settle(sonarr.rootFolders(), empty<ArrRootFolder>()) : empty<ArrRootFolder>(),
      has.sonarr() ? settle(sonarr.diskSpace(), empty<ArrDisk>()) : empty<ArrDisk>(),
      has.radarr() ? settle(radarr.movies(), undefined) : undefined,
      has.sonarr() ? settle(sonarr.allSeries(), undefined) : undefined,
    ]);

    // Radarr and Sonarr often see the same disk (under different paths): show it once.
    const disks: StorageInfo['disks'] = [];
    for (const d of [...disksFor(rRoots, rDisks, 'movie'), ...disksFor(sRoots, sDisks, 'tv')]) {
      if (!d.total) continue;
      const same = disks.find((x) => x.total === d.total && Math.abs(x.free - d.free) < d.total * 0.005);
      if (same) {
        same.holds = [...new Set([...same.holds, ...d.holds])];
        if (!same.path.split(' · ').includes(d.path)) same.path = `${same.path} · ${d.path}`;
      } else disks.push(d);
    }

    const movieSizes = (movies ?? []).filter((m) => (m.sizeOnDisk ?? 0) > 0);
    const showSizes = (series ?? []).filter((s) => (s.statistics?.sizeOnDisk ?? 0) > 0);
    const biggest: StorageInfo['biggest'] = [
      ...movieSizes.map((m) => ({
        key: keyOf('movie', m.tmdbId),
        mediaType: 'movie' as const,
        tmdbId: m.tmdbId,
        title: m.title,
        year: m.year,
        poster: small(posterOf(m.images)),
        size: m.sizeOnDisk ?? 0,
      })),
      ...showSizes.map((s) => ({
        key: s.tmdbId ? keyOf('tv', s.tmdbId) : `tvdb-${s.tvdbId}`,
        mediaType: 'tv' as const,
        tmdbId: s.tmdbId || undefined,
        title: s.title,
        year: s.year,
        poster: small(posterOf(s.images)),
        size: s.statistics?.sizeOnDisk ?? 0,
      })),
    ]
      .sort((a, b) => b.size - a.size)
      .slice(0, 12);

    return {
      disks,
      movies: movies ? { count: movieSizes.length, size: sum(movieSizes.map((m) => m.sizeOnDisk)) } : undefined,
      shows: series ? { count: showSizes.length, size: sum(showSizes.map((s) => s.statistics?.sizeOnDisk)) } : undefined,
      biggest,
      removed: {
        movies: (await settle(removedTitles('movie'), [])).length,
        shows: (await settle(removedTitles('tv'), [])).length,
      },
    };
  });
}
