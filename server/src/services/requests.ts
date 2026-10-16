import type { CreateRequest, DownloadItem, RequestItem, RequestStatus, RequestSummary } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { seerr, type SeerrRequest } from '../clients/seerr';
import { mapLimit, settle } from '../lib/async';
import { SECOND, TTLCache } from '../lib/cache';
import { HttpError } from '../lib/upstream';
import { resolveAvailability } from './cards';
import { catalog } from './catalog';
import { allDownloads, downloadsFor } from './downloads';
import { findInLibrary, libraryIndex } from './library';
import { suggestedNotes } from './suggestarr';
import { maybeSeerrUserId, seerrUserId } from './seerrUsers';
import { forgetRadarrMovie, forgetSonarrSeries, radarrMovie, sonarrSeries } from './arrLookup';
import { movieNotOut, showNotOut } from './notOut';

const STATUS: Record<number, RequestStatus> = { 1: 'pending', 2: 'approved', 3: 'declined', 4: 'failed', 5: 'completed' };

const userName = (r: SeerrRequest) =>
  r.requestedBy?.displayName || r.requestedBy?.jellyfinUsername || r.requestedBy?.username || 'Someone';

export function toSummary(r: SeerrRequest, mySeerrId?: number): RequestSummary {
  return {
    id: r.id,
    status: STATUS[r.status] ?? 'pending',
    requestedBy: userName(r),
    mine: mySeerrId !== undefined && r.requestedBy?.id === mySeerrId,
    createdAt: r.createdAt,
    seasons: r.seasons?.map((s) => s.seasonNumber),
  };
}

function summarizeDownloads(items: DownloadItem[]): RequestItem['download'] {
  if (!items.length) return undefined;
  const progress = items.reduce((sum, d) => sum + d.progress, 0) / items.length;
  const etas = items.map((d) => d.etaSeconds).filter((n): n is number => n !== undefined);
  return { progress, etaSeconds: etas.length ? Math.max(...etas) : undefined, state: items[0].state, count: items.length };
}

const lists = new TTLCache<SeerrRequest[]>(200);

async function fetchRequests(seerrId: number | undefined, all: boolean) {
  return lists.wrap(`${all ? 'all' : seerrId}`, 10 * SECOND, async () => {
    const res = await seerr.requests(
      { take: 60, skip: 0, sort: 'added', filter: 'all', requestedBy: all ? undefined : seerrId },
      all ? undefined : seerrId,
    );
    return all ? res.results : res.results.filter((r) => r.requestedBy?.id === seerrId);
  });
}

export async function listRequests(user: SessionUser, scope: 'mine' | 'all'): Promise<RequestItem[]> {
  const all = scope === 'all' && user.isAdmin;
  const seerrId = all ? await maybeSeerrUserId(user) : await seerrUserId(user);
  const [requests, index, downloads] = await Promise.all([
    fetchRequests(seerrId, all),
    settle(libraryIndex(user), undefined),
    allDownloads(),
  ]);

  const notes = await settle(suggestedNotes(user, requests.map((r) => ({ mediaType: r.type, tmdbId: r.media.tmdbId })), index), new Map());
  return mapLimit(requests, 6, async (r) => {
    const tmdbId = r.media.tmdbId;
    const info = await settle(catalog.basics(r.type, tmdbId), undefined);
    const entry = index ? findInLibrary(index, r.type, tmdbId, r.media.tvdbId) : undefined;
    const status = resolveAvailability(r.media, Boolean(entry));
    const download = summarizeDownloads(downloadsFor(downloads, r.type, tmdbId, r.media.tvdbId));
    // Approved but nothing downloading: say so when it's simply not out yet (Radarr/Sonarr lookups are cached).
    const waiting = !download && status !== 'available' && (STATUS[r.status] === 'approved' || STATUS[r.status] === 'completed');
    // Radarr/Sonarr know best; TMDB's dates cover the moment before Seerr has handed it over.
    let notOut;
    if (waiting && r.type === 'movie') {
      const managed = await settle(radarrMovie(tmdbId), null);
      notOut = movieNotOut(managed ? undefined : await settle(catalog.movie(tmdbId), undefined), managed);
    } else if (waiting) {
      const managed = await settle(sonarrSeries(r.media.tvdbId), null);
      notOut = showNotOut(managed ? undefined : await settle(catalog.tv(tmdbId), undefined), managed);
    }
    return {
      id: r.id,
      mediaType: r.type,
      tmdbId,
      title: info?.title ?? `TMDB #${tmdbId}`,
      year: info?.year,
      poster: info?.poster,
      backdrop: info?.backdrop,
      requestStatus: STATUS[r.status] ?? 'pending',
      status,
      seasons: r.seasons?.map((s) => s.seasonNumber),
      createdAt: r.createdAt,
      requestedBy: userName(r),
      mine: seerrId !== undefined && r.requestedBy?.id === seerrId,
      download,
      notOut: notOut?.kind === 'airing' && status === 'partial' ? undefined : notOut,
      suggested: notes.get(`${r.type}-${tmdbId}`),
    };
  });
}

/** `${mediaType}-${tmdbId}` of everything this user has requested — for "mine" badges. */
export async function myRequestKeys(user: SessionUser): Promise<Set<string>> {
  const seerrId = await maybeSeerrUserId(user);
  if (!seerrId) return new Set();
  const requests = await settle(fetchRequests(seerrId, false), []);
  return new Set(requests.flatMap((r) => [`${r.type}-${r.media.tmdbId}`, ...(r.media.tvdbId ? [`tvdb-${r.media.tvdbId}`] : [])]));
}

export async function createRequest(user: SessionUser, body: CreateRequest): Promise<RequestSummary> {
  if ((body.mediaType !== 'movie' && body.mediaType !== 'tv') || !Number.isInteger(body.tmdbId)) {
    throw new HttpError(400, 'mediaType and tmdbId are required');
  }
  const seerrId = await seerrUserId(user);
  const seasons =
    body.mediaType === 'tv' ? (body.seasons?.length ? body.seasons.filter((n) => Number.isInteger(n)) : 'all') : undefined;
  const created = await seerr.createRequest({ mediaType: body.mediaType, mediaId: body.tmdbId, seasons }, seerrId);
  catalog.invalidate(body.mediaType, body.tmdbId);
  // Seerr has just handed it to Radarr/Sonarr: look again instead of trusting "not managed".
  if (body.mediaType === 'movie') forgetRadarrMovie(body.tmdbId);
  else forgetSonarrSeries(created.media?.tvdbId ?? undefined);
  lists.clear();
  return toSummary(created, seerrId);
}
