import type { MediaType, SuggestArrStatus } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { config, has } from '../config';
import { jellyfin } from '../clients/jellyfin';
import type { SeerrResult } from '../clients/seerr';
import { suggestarr, type SarrJob, type SarrRequest, type SarrRun } from '../clients/suggestarr';
import { onConnectionChange } from '../connections';
import { mapLimit, settle } from '../lib/async';
import { MINUTE, TTLCache } from '../lib/cache';
import { t } from '../lib/i18n';
import { catalog } from './catalog';
import { findInLibrary, type LibraryIndex } from './library';

/**
 * SuggestArr (optional): what it requested in Seerr for each person, from what they watched.
 * Shown as a row on that person's Home and as a note on the request in Activity; admins see
 * its jobs in Settings and can start them.
 */

/** Jellyfin user ids the way SuggestArr keeps them: 32 hex characters, no dashes. */
const idOf = (id: string) => id.replace(/-/g, '').toLowerCase();
const keyOf = (r: SarrRequest) => `${r.media_type}-${Number(r.tmdb_id)}`;
/** The title it came from, when it's one (not a tag like "discover"). */
const sourceOf = (r: SarrRequest) => (r.source_media_id && /^\d+$/.test(r.source_media_id) && r.source_media_id !== '0' ? Number(r.source_media_id) : undefined);

const requested = new TTLCache<SarrRequest[]>(2);
const names = new TTLCache<Map<string, string>>(2);
onConnectionChange((id) => {
  if (id === 'suggestarr') requested.clear();
  if (id === 'jellyfin') names.clear();
});

/** Everything SuggestArr requested, newest first (its latest 500), for a few minutes. */
function everything(): Promise<SarrRequest[]> {
  if (!has.suggestarr()) return Promise.resolve([]);
  return requested.wrap('all', 5 * MINUTE, async () => {
    const out: SarrRequest[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await suggestarr.requests(page);
      out.push(...res.data);
      if (!res.meta || page >= res.meta.pages) break;
    }
    return out;
  }).catch(() => {
    // SuggestArr unreachable: nothing from it for a minute, rather than a slow Home on every load.
    requested.set('all', [], MINUTE);
    return [];
  });
}

/** A watched title's name: from the library (it was watched there), else TMDB. */
async function titleOf(mediaType: MediaType, tmdbId: number, index?: LibraryIndex): Promise<string | undefined> {
  const entry = index && findInLibrary(index, mediaType, tmdbId);
  return entry?.name ?? (await settle(catalog.basics(mediaType, tmdbId), undefined))?.title;
}

type Suggested = { result: SeerrResult; because?: string };

/** For Home: what SuggestArr requested from this person's viewing, with the title it came from. */
export async function suggestedFor(user: SessionUser, index?: LibraryIndex): Promise<Suggested[]> {
  if (!has.suggestarr() || !has.seerr()) return [];
  const me = idOf(user.id);
  const mine = (await everything()).filter((r) => r.media_user?.id && idOf(r.media_user.id) === me).slice(0, 30);
  const out = await mapLimit(mine, 4, async (r) => {
    const id = Number(r.tmdb_id);
    const source = sourceOf(r);
    const [result, because] = await Promise.all([
      r.media_type === 'movie'
        ? settle(catalog.movie(id), undefined).then((m): SeerrResult | undefined =>
            m && { id, mediaType: 'movie', title: m.title, posterPath: m.posterPath, backdropPath: m.backdropPath, overview: m.overview, releaseDate: m.releaseDate, voteAverage: m.voteAverage, mediaInfo: m.mediaInfo },
          )
        : settle(catalog.tv(id), undefined).then((s): SeerrResult | undefined =>
            s && { id, mediaType: 'tv', name: s.name, posterPath: s.posterPath, backdropPath: s.backdropPath, overview: s.overview, firstAirDate: s.firstAirDate, voteAverage: s.voteAverage, mediaInfo: s.mediaInfo },
          ),
      source ? titleOf(r.media_type, source, index) : Promise.resolve(undefined),
    ]);
    return result ? ({ result, because } as Suggested) : undefined;
  });
  return out.filter((x): x is Suggested => Boolean(x));
}

/** Jellyfin's people by id, to say whose viewing a suggestion came from (admins only). */
function peopleNames(viewer: SessionUser): Promise<Map<string, string>> {
  const token = config.jellyfin.apiKey ?? (viewer.isAdmin ? viewer.token : undefined);
  if (!token) return Promise.resolve(new Map());
  return names.wrap('all', 10 * MINUTE, async () => new Map((await jellyfin.users(token)).map((u) => [idOf(u.Id), u.Name]))).catch(() => new Map());
}

/**
 * For Activity → Requests: which of these SuggestArr asked for, and because of what. The title it
 * came from is shown to the person who watched it, and to admins (with who it was); not to others.
 */
export async function suggestedNotes(
  viewer: SessionUser,
  items: Array<{ mediaType: MediaType; tmdbId: number }>,
  index?: LibraryIndex,
): Promise<Map<string, { because?: string; forName?: string }>> {
  const notes = new Map<string, { because?: string; forName?: string }>();
  if (!has.suggestarr() || !items.length) return notes;
  const byKey = new Map((await everything()).map((r) => [keyOf(r), r]));
  const wanted = items.filter((i) => byKey.has(`${i.mediaType}-${i.tmdbId}`));
  if (!wanted.length) return notes;
  const people = viewer.isAdmin ? await peopleNames(viewer) : new Map<string, string>();
  const me = idOf(viewer.id);
  await mapLimit(wanted, 4, async (i) => {
    const key = `${i.mediaType}-${i.tmdbId}`;
    const r = byKey.get(key)!;
    const who = r.media_user?.id ? idOf(r.media_user.id) : undefined;
    const source = sourceOf(r);
    const mine = who === me;
    if (!mine && !viewer.isAdmin) return notes.set(key, {});
    notes.set(key, {
      because: source ? await titleOf(i.mediaType, source, index) : undefined,
      forName: mine || !who ? undefined : (people.get(who) ?? t('someone')),
    });
  });
  return notes;
}

// ---------- Settings (admins) ----------

function scheduleText(job: SarrJob): string {
  if (job.schedule_type === 'cron') return t('Cron: {expression}', { expression: job.schedule_value ?? '' });
  switch (job.schedule_value) {
    case 'daily':
      return t('Every day at midnight');
    case 'weekly':
      return t('Mondays at midnight');
    case 'every_12h':
      return t('Every 12 hours');
    case 'every_6h':
      return t('Every 6 hours');
    case 'every_hour':
      return t('Every hour');
    default:
      return job.schedule_value ?? '';
  }
}

/**
 * A run's time. SuggestArr gives its own server's clock time without a zone: passed on as it is,
 * so the browser reads it as local time (the same house, the same time zone). Others become ISO.
 */
function timeOf(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return value.replace(' ', 'T').slice(0, 19);
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

const busy = (runs: SarrRun[]) => runs.some((r) => r.status === 'running' || r.status === 'queued');
let lastFinished = '';

export async function suggestarrStatus(): Promise<SuggestArrStatus> {
  if (!has.suggestarr()) return { jobs: [], error: t('Add the address and API key first') };
  try {
    const [me, jobs] = await Promise.all([suggestarr.me(), suggestarr.jobs()]);
    const list = await mapLimit(
      jobs.filter((j) => j.enabled),
      3,
      async (job) => {
        const [last, running, queued] = await Promise.all([
          suggestarr.runs(job.id),
          suggestarr.runs(job.id, { status: 'running' }),
          suggestarr.runs(job.id, { status: 'queued' }),
        ]);
        const run = last[0];
        return {
          id: job.id,
          name: job.name,
          schedule: scheduleText(job),
          running: busy([...running, ...queued]),
          lastRun: run && {
            status: run.status,
            at: timeOf(run.finished_at ?? run.started_at),
            requested: run.requested_count,
            error: run.error_message ?? undefined,
          },
        };
      },
    );
    // A run just finished: what it requested shows up now, not in five minutes.
    const finished = list.map((j) => (j.lastRun?.status === 'completed' ? `${j.id}:${j.lastRun.at}` : '')).join();
    if (finished !== lastFinished) {
      if (lastFinished) requested.clear();
      lastFinished = finished;
    }
    return { user: { name: me.username, admin: me.role === 'admin' }, jobs: list };
  } catch (err) {
    const e = err as Error & { status?: number };
    return { jobs: [], error: e.status === 401 || e.status === 403 ? t('SuggestArr rejected the API key') : e.message };
  }
}

/** Starts every enabled job that isn't already running. */
export async function runSuggestarr(): Promise<SuggestArrStatus> {
  const status = await suggestarrStatus();
  if (status.error) return status;
  await Promise.all(status.jobs.filter((j) => !j.running).map((j) => suggestarr.run(j.id)));
  return suggestarrStatus();
}
