/**
 * Local stand-in for the whole Pi stack (Jellyfin, Seerr, Radarr, Sonarr,
 * Bazarr, qBittorrent, Trakt) so Netfish can be developed and demoed anywhere.
 *
 *   npm run dev:mock      → mock on :7700, Netfish API on :7777, web on :5173
 *   sign in as demo/demo or sam/sam (regular users) or admin/admin
 *
 * Only the endpoints Netfish uses are implemented, with the same shapes as the
 * real services (checked against their source).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { DURATION_SECONDS, MEDIA_DIR, ensureMedia, subtitleVtt } from './mock/media';
import * as svg from './mock/svg';
import {
  EPISODES_PER_SEASON,
  RUNTIME_TICKS,
  TITLES,
  USERS,
  addedAt,
  advance,
  arrKnown,
  library,
  statusOverride,
  unmonitored,
  audio,
  downloads,
  episodeName,
  ids,
  inLibrary,
  isImporting,
  itemsById,
  librarySeasons,
  mediaStatus,
  newId,
  progressOf,
  requests,
  seasonStatus,
  seed,
  sessions,
  setUd,
  startDownload,
  subtitles,
  titleByTmdb,
  ud,
  type Item,
  type MockRequest,
  type MockUser,
  type Title,
} from './mock/world';

const PORT = Number(process.env.MOCK_PORT ?? 7700);
let SAMPLE_SIZE = 0;
const API_KEY = 'mock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Q = Record<string, string | undefined>;

const app = Fastify({ routerOptions: { caseSensitive: false, ignoreTrailingSlash: true } });
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body));
app.addHook('onRequest', async () => advance());

// ======================================================================
// Jellyfin
// ======================================================================

const ISO3_NAME: Record<string, string> = { eng: 'English', spa: 'Spanish', fre: 'French', ger: 'German', ita: 'Italian', hin: 'Hindi', tam: 'Tamil', tel: 'Telugu', jpn: 'Japanese' };
const ISO1_TO_3: Record<string, string> = { en: 'eng', es: 'spa', fr: 'fre', de: 'ger', it: 'ita', ja: 'jpn', pt: 'por', pb: 'por', nl: 'dut', hi: 'hin' };

function jfToken(req: FastifyRequest): string | undefined {
  const auth = req.headers.authorization ?? '';
  return auth.match(/Token="([^"]+)"/)?.[1] ?? (req.query as Q).ApiKey;
}
function jfUser(req: FastifyRequest): MockUser | undefined {
  const token = jfToken(req);
  if (token === API_KEY) return USERS[0];
  return token ? sessions.get(token) : undefined;
}

const date = (t: number) => new Date(t).toISOString();
const titleAdded = (t: Title) =>
  t.type === 'movie'
    ? (addedAt.get(`movie-${t.tmdbId}`) ?? 0)
    : Math.max(0, ...librarySeasons(t).map((s) => addedAt.get(`tv-${t.tmdbId}-${s}`) ?? 0));

function libraryEpisodes(t: Title, season?: number): Item[] {
  const out: Item[] = [];
  for (const s of librarySeasons(t)) {
    if (season !== undefined && s !== season) continue;
    for (let e = 1; e <= EPISODES_PER_SEASON; e++) out.push(itemsById.get(ids.episode(t, s, e))!);
  }
  return out;
}

function audioOf(t: Title) {
  return audio.get(`${t.type}-${t.tmdbId}`) ?? [t.lang === 'fr' ? 'fre' : 'eng'];
}

const containerOf = (item: Item) => (item.kind === 'movie' && item.title.n === 4 ? 'mkv' : 'mp4');

function streamsFor(item: Item) {
  const t = item.title;
  // "The Last Lighthouse" is set up like a Blu-ray remux: lossless TrueHD by default, a plain AAC
  // English track and a commentary, and a default-flagged picture (PGS) subtitle next to a text one.
  if (t.n === 5 && item.kind === 'movie') {
    return [
      { Type: 'Video', Index: 0, Codec: 'h264', DisplayTitle: '1080p H264 SDR' },
      { Type: 'Audio', Index: 1, Codec: 'truehd', Language: 'eng', Title: 'TrueHD Atmos 7.1', DisplayTitle: 'English - TrueHD - 7.1', IsDefault: true, Channels: 8 },
      { Type: 'Audio', Index: 2, Codec: 'aac', Language: 'eng', Title: 'Stereo', DisplayTitle: 'English - AAC - Stereo', Channels: 2 },
      { Type: 'Audio', Index: 3, Codec: 'aac', Language: 'eng', Title: "Director's commentary", DisplayTitle: 'English - AAC - Stereo', Channels: 2 },
      { Type: 'Subtitle', Index: 4, Codec: 'PGSSUB', Language: 'eng', DisplayTitle: 'English (PGS)', IsDefault: true, IsTextSubtitleStream: false },
      {
        Type: 'Subtitle', Index: 5, Codec: 'subrip', Language: 'eng', DisplayTitle: 'English (SRT)', IsTextSubtitleStream: true,
        IsExternal: true, DeliveryMethod: 'External', DeliveryUrl: `/Videos/${item.id}/${item.id}/Subtitles/5/0/Stream.vtt?ApiKey=leak`,
      },
    ];
  }
  const langs = audioOf(t);
  const subKey = item.kind === 'episode' ? `ep-${t.tmdbId}-${item.s}-${item.e}` : `movie-${t.tmdbId}`;
  const subs = [...(subtitles.get(subKey) ?? new Set(item.kind === 'episode' ? ['en'] : []))];
  return [
    { Type: 'Video', Index: 0, Codec: 'h264', DisplayTitle: '720p H264 SDR' },
    // "Salt & Steel" is an MKV with Dolby Digital 5.1 + DTS (sample-dolby.mkv), like a Blu-ray rip.
    ...(t.n === 4
      ? [
          { Type: 'Audio', Index: 1, Codec: 'ac3', Language: 'eng', Title: 'Dolby Digital 5.1', DisplayTitle: 'English - Dolby Digital - 5.1', IsDefault: true, Channels: 6 },
          { Type: 'Audio', Index: 2, Codec: 'dts', Language: 'eng', Title: 'DTS', DisplayTitle: 'English - DTS - Stereo', Channels: 2 },
        ]
      : langs.map((l, i) => ({ Type: 'Audio', Index: 1 + i, Codec: 'aac', Language: l, DisplayTitle: `${ISO3_NAME[l] ?? l} - AAC - Stereo`, IsDefault: i === 0, Channels: 2 }))),
    ...subs.map((code, i) => {
      const index = 1 + langs.length + i;
      return {
        Type: 'Subtitle', Index: index, Codec: 'subrip', Language: ISO1_TO_3[code] ?? code, DisplayTitle: code.toUpperCase(),
        IsExternal: true, IsTextSubtitleStream: true, DeliveryMethod: 'External',
        DeliveryUrl: `/Videos/${item.id}/${item.id}/Subtitles/${index}/0/Stream.vtt?ApiKey=leak`,
      };
    }),
  ];
}

function userDataDto(userId: string | undefined, item: Item) {
  if (!userId) return undefined;
  if (item.kind === 'series') {
    const eps = libraryEpisodes(item.title);
    const played = eps.length > 0 && eps.every((e) => ud(userId, e.id).played);
    return { Played: played, PlayedPercentage: 0, PlaybackPositionTicks: 0 };
  }
  const d = ud(userId, item.id);
  return {
    PlaybackPositionTicks: d.pos,
    PlayedPercentage: d.pos ? (d.pos / RUNTIME_TICKS) * 100 : undefined,
    Played: d.played,
    LastPlayedDate: d.lastPlayed ? date(d.lastPlayed) : undefined,
  };
}

/** Lengths as they'd be in a real library (the sample video every title plays is 3 minutes). */
const nominalMinutes = (t: Title) => (t.type === 'movie' ? 84 + ((t.n * 37) % 70) : 24 + ((t.n * 11) % 36));

function dto(item: Item, userId?: string, full = false): Record<string, unknown> {
  const t = item.title;
  const seriesId = ids.series(t);
  switch (item.kind) {
    case 'movie':
      return {
        Id: item.id, Name: t.title, Type: 'Movie', ProductionYear: t.year, PremiereDate: `${t.year}-06-01T00:00:00.0000000Z`,
        Overview: t.overview, Genres: t.genres, CommunityRating: t.rating, OfficialRating: 'PG-13', RunTimeTicks: full ? RUNTIME_TICKS : nominalMinutes(t) * 600_000_000,
        ProviderIds: { Tmdb: String(t.tmdbId) }, ImageTags: { Primary: 'p1', Thumb: 't1' }, BackdropImageTags: ['b1'],
        DateCreated: date(titleAdded(t)), UserData: userDataDto(userId, item), Taglines: [],
        People: jfPeople(t),
        ...(full ? { MediaStreams: streamsFor(item), MediaSources: [{ Id: item.id, Container: containerOf(item), Size: SAMPLE_SIZE, Bitrate: 400_000, MediaStreams: streamsFor(item) }] } : {}),
      };
    case 'series':
      return {
        Id: item.id, Name: t.title, Type: 'Series', ProductionYear: t.year, PremiereDate: `${t.year}-01-15T00:00:00.0000000Z`,
        Overview: t.overview, Genres: t.genres, CommunityRating: t.rating, OfficialRating: 'TV-14', RunTimeTicks: nominalMinutes(t) * 600_000_000,
        ProviderIds: { Tmdb: String(t.tmdbId), Tvdb: String(t.tvdbId) }, ImageTags: { Primary: 'p1' }, BackdropImageTags: ['b1'],
        DateCreated: date(titleAdded(t)), UserData: userDataDto(userId, item), People: jfPeople(t),
      };
    case 'season':
      return { Id: item.id, Name: `Season ${item.s}`, Type: 'Season', IndexNumber: item.s, SeriesId: seriesId, SeriesName: t.title, ImageTags: { Primary: 'p1' } };
    case 'episode':
      return {
        Id: item.id, Name: episodeName(t, item.s, item.e), Type: 'Episode', SeriesId: seriesId, SeriesName: t.title,
        SeasonId: ids.season(t, item.s), ParentIndexNumber: item.s, IndexNumber: item.e, RunTimeTicks: RUNTIME_TICKS,
        Overview: `${t.title}, season ${item.s} episode ${item.e}. Things get choppy.`, PremiereDate: `${t.year + item.s - 1}-0${Math.min(9, item.e)}-10T00:00:00.0000000Z`,
        ImageTags: { Primary: 'p1' }, SeriesPrimaryImageTag: 'p1', ParentBackdropItemId: seriesId, ParentBackdropImageTags: ['b1'],
        UserData: userDataDto(userId, item),
        ...(full ? { MediaStreams: streamsFor(item), MediaSources: [{ Id: item.id, Container: containerOf(item), Size: SAMPLE_SIZE, Bitrate: 400_000, MediaStreams: streamsFor(item) }] } : {}),
      };
  }
}

function jfPeople(t: Title) {
  const lead = t.type === 'movie' ? { name: directorOf(t), type: 'Director' } : { name: creatorOf(t), type: 'Writer' };
  return [
    { Id: jfPersonId(lead.name), Name: lead.name, Type: lead.type, PrimaryImageTag: 'a1' },
    ...castFor(t).slice(0, 6).map((c) => ({ Id: jfPersonId(c.name), Name: c.name, Role: c.character, Type: 'Actor', PrimaryImageTag: 'a1' })),
  ];
}
const jfPerson = (name: string) => ({ Id: jfPersonId(name), Name: name, Type: 'Person', ImageTags: { Primary: 'a1' }, Overview: `${name}, as Jellyfin knows them.` });

const result = (items: Item[], userId?: string, start = 0, limit?: number) => ({
  Items: items.slice(start, limit !== undefined ? start + limit : undefined).map((i) => dto(i, userId)),
  TotalRecordCount: items.length,
});

function lastPlayedOf(userId: string, item: Item): number {
  if (item.kind === 'series') return Math.max(0, ...libraryEpisodes(item.title).map((e) => ud(userId, e.id).lastPlayed ?? 0));
  return ud(userId, item.id).lastPlayed ?? 0;
}

function nextUpFor(userId: string, t: Title, opts: { resumable: boolean; firstEpisode: boolean }): Item | undefined {
  const eps = libraryEpisodes(t);
  let lastPlayed = -1;
  eps.forEach((e, i) => ud(userId, e.id).played && (lastPlayed = i));
  if (lastPlayed === -1 && !opts.firstEpisode) return undefined;
  for (let i = lastPlayed + 1; i < eps.length; i++) {
    const d = ud(userId, eps[i].id);
    if (d.played) continue;
    if (d.pos > 0 && !opts.resumable) return undefined;
    return eps[i];
  }
  return undefined;
}

// Tests only: one person signed out everywhere (as if from Jellyfin's Devices page).
app.post<{ Params: { name: string } }>('/__test/expire/:name', async (req) => {
  let ended = 0;
  for (const [token, user] of [...sessions]) if (user.name === req.params.name) sessions.delete(token), ended++;
  return { ended };
});

void app.register(
  async (jf) => {
    jf.post<{ Body: { Username: string; Pw: string } }>('/Users/AuthenticateByName', async (req, reply) => {
      const user = USERS.find((u) => u.name === req.body?.Username?.toLowerCase() && u.password === req.body?.Pw);
      if (!user) return reply.code(401).send('Error processing request.');
      const token = crypto.randomBytes(16).toString('hex');
      sessions.set(token, user);
      return { User: { Id: user.id, Name: user.name, Policy: { IsAdministrator: user.admin } }, AccessToken: token, ServerId: 'mock' };
    });
    jf.addHook('preHandler', async (req, reply) => {
      if (req.url.includes('/AuthenticateByName') || req.url.includes('/System/Info/Public') || /\/Images\//i.test(req.url)) return;
      if (!jfUser(req)) return reply.code(401).send();
    });
    jf.get('/System/Info/Public', async () => ({ ServerName: 'Mock Jellyfin', Version: '12.0.0-mock', Id: 'mock' }));
    jf.get('/System/Info', async () => ({ ServerName: 'Mock Jellyfin', Version: '12.0.0-mock', Id: 'mock' }));
    jf.get('/Users/Me', async (req) => {
      const u = jfUser(req)!;
      // Their own audio language in Jellyfin: sam's is Italian, demo's French, admin's any.
      const audio = { sam: 'ita', demo: 'fre' }[u.name] ?? '';
      return { Id: u.id, Name: u.name, PrimaryImageTag: 'a1', Policy: { IsAdministrator: u.admin }, Configuration: { AudioLanguagePreference: audio, SubtitleLanguagePreference: '' } };
    });
    jf.get('/Users', async (req, reply) =>
      jfUser(req)?.admin ? USERS.map((u) => ({ Id: u.id, Name: u.name, Policy: { IsAdministrator: u.admin } })) : reply.code(403).send(),
    );
    // Watched / not watched; a show or season marks all its episodes.
    const setPlayed = (req: FastifyRequest<{ Params: { id: string }; Querystring: Q }>, played: boolean) => {
      const user = jfUser(req)!;
      const item = itemsById.get(req.params.id);
      if (!item) return false;
      const targets = item.kind === 'series' ? libraryEpisodes(item.title) : item.kind === 'season' ? libraryEpisodes(item.title, item.s) : [item];
      for (const target of targets) setUd(user.id, target.id, { played, pos: 0, lastPlayed: played ? Date.now() : ud(user.id, target.id).lastPlayed });
      return true;
    };
    jf.post<{ Params: { id: string }; Querystring: Q }>('/UserPlayedItems/:id', async (req, reply) => (setPlayed(req, true) ? {} : reply.code(404).send()));
    jf.delete<{ Params: { id: string }; Querystring: Q }>('/UserPlayedItems/:id', async (req, reply) => (setPlayed(req, false) ? {} : reply.code(404).send()));
    jf.post<{ Params: { id: string }; Querystring: Q; Body: { PlaybackPositionTicks?: number; Played?: boolean; LastPlayedDate?: string } }>('/UserItems/:id/UserData', async (req, reply) => {
      const user = jfUser(req);
      if (!user || !itemsById.get(req.params.id)) return reply.code(404).send();
      setUd(user.id, req.params.id, {
        pos: Number(req.body?.PlaybackPositionTicks) || 0,
        played: Boolean(req.body?.Played),
        lastPlayed: req.body?.LastPlayedDate ? Date.parse(req.body.LastPlayedDate) : Date.now(),
      });
      return {};
    });
    jf.post('/Library/Refresh', async (req, reply) => (jfUser(req)?.admin ? reply.code(204).send() : reply.code(403).send()));
    jf.post('/Sessions/Logout', async (req, reply) => {
      sessions.delete(jfToken(req) ?? '');
      return reply.code(204).send();
    });

    const endedEncodings: Array<{ deviceId: string; playSessionId: string }> = [];
    jf.get<{ Querystring: Q }>('/Items', async (req) => {
      const q = req.query;
      const userId = q.userId;
      const types = (q.includeItemTypes ?? 'Movie,Series').split(',');
      let items: Item[] = [];
      for (const t of TITLES) {
        if (!inLibrary(t)) continue;
        if (t.type === 'movie' && types.includes('Movie')) items.push(itemsById.get(ids.movie(t))!);
        if (t.type === 'tv' && types.includes('Series')) items.push(itemsById.get(ids.series(t))!);
        if (t.type === 'tv' && types.includes('Episode')) items.push(...libraryEpisodes(t));
      }
      if (q.searchTerm) items = items.filter((i) => i.title.title.toLowerCase().includes(q.searchTerm!.toLowerCase()));
      if (q.personIds) {
        const types = q.personTypes?.split(',');
        items = items.filter((i) => jfPeople(i.title).some((p) => q.personIds!.split(',').includes(p.Id) && (!types || types.includes(p.Type))));
      }
      if (userId && q.filters?.includes('IsPlayed')) items = items.filter((i) => (dto(i, userId).UserData as { Played?: boolean })?.Played);
      if (userId && q.filters?.includes('IsUnplayed')) items = items.filter((i) => !(dto(i, userId).UserData as { Played?: boolean })?.Played);
      if (userId && q.filters?.includes('IsResumable')) items = items.filter((i) => i.kind !== 'series' && ud(userId, i.id).pos > 0 && !ud(userId, i.id).played);
      if (q.ids) items = items.filter((i) => q.ids!.split(',').includes(i.id));
      if (q.excludeItemIds) items = items.filter((i) => !q.excludeItemIds!.split(',').includes(i.id));
      const sort = (q.sortBy ?? 'SortName').split(',')[0];
      const key = (i: Item): number | string => {
        switch (sort) {
          case 'DateCreated':
          case 'DateLastContentAdded':
            return titleAdded(i.title);
          case 'DatePlayed':
            return userId ? lastPlayedOf(userId, i) : 0;
          case 'ProductionYear':
            return i.title.year;
          case 'CommunityRating':
            return i.title.rating;
          case 'Runtime':
            return nominalMinutes(i.title);
          case 'Random':
            return Math.random();
          default:
            return i.title.title.toLowerCase();
        }
      };
      items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      if (q.sortOrder === 'Descending') items.reverse();
      return result(items, userId, Number(q.startIndex ?? 0), q.limit ? Number(q.limit) : undefined);
    });

    jf.get<{ Querystring: Q }>('/Persons', async (req) => {
      const term = (req.query.searchTerm ?? '').toLowerCase();
      const inLib = new Set(TITLES.filter(inLibrary).flatMap((t) => jfPeople(t).map((p) => p.Name)));
      const found = [...inLib].filter((name) => name.toLowerCase().includes(term)).map(jfPerson);
      return { Items: found.slice(0, Number(req.query.limit ?? 100)), TotalRecordCount: found.length };
    });
    jf.get<{ Params: { id: string }; Querystring: Q }>('/Items/:id', async (req, reply) => {
      const person = jfPersonName(req.params.id);
      if (person) return jfPerson(person);
      const item = itemsById.get(req.params.id);
      if (!item) return reply.code(404).send();
      return dto(item, req.query.userId, true);
    });

    jf.get<{ Querystring: Q }>('/UserItems/Resume', async (req) => {
      const userId = req.query.userId!;
      const items = [...itemsById.values()].filter(
        (i) => (i.kind === 'movie' || i.kind === 'episode') && inLibrary(i.title) && ud(userId, i.id).pos > 0 && !ud(userId, i.id).played,
      );
      items.sort((a, b) => (ud(userId, b.id).lastPlayed ?? 0) - (ud(userId, a.id).lastPlayed ?? 0));
      return result(items, userId, 0, Number(req.query.limit ?? 16));
    });

    jf.get<{ Querystring: Q }>('/Shows/NextUp', async (req) => {
      const q = req.query;
      const userId = q.userId!;
      const shows = TITLES.filter((t) => t.type === 'tv' && inLibrary(t) && (!q.seriesId || ids.series(t) === q.seriesId));
      const items = shows
        .map((t) => nextUpFor(userId, t, { resumable: q.enableResumable !== 'false', firstEpisode: Boolean(q.seriesId) && q.disableFirstEpisode !== 'true' }))
        .filter((i): i is Item => Boolean(i))
        .sort((a, b) => lastPlayedOf(userId, itemsById.get(ids.series(b.title))!) - lastPlayedOf(userId, itemsById.get(ids.series(a.title))!));
      return result(items, userId, 0, Number(q.limit ?? 16));
    });

    jf.get<{ Params: { id: string }; Querystring: Q }>('/Shows/:id/Seasons', async (req) => {
      const series = itemsById.get(req.params.id);
      if (!series) return result([]);
      return result(librarySeasons(series.title).map((s) => itemsById.get(ids.season(series.title, s))!), req.query.userId);
    });

    jf.get<{ Params: { id: string }; Querystring: Q }>('/Shows/:id/Episodes', async (req) => {
      const series = itemsById.get(req.params.id);
      if (!series) return result([]);
      let eps = libraryEpisodes(series.title, req.query.season ? Number(req.query.season) : undefined);
      if (req.query.startItemId) eps = eps.slice(Math.max(0, eps.findIndex((e) => e.id === req.query.startItemId)));
      return result(eps, req.query.userId, 0, req.query.limit ? Number(req.query.limit) : undefined);
    });

    const image = async (req: FastifyRequest<{ Params: { id: string; type: string } }>, reply: import('fastify').FastifyReply) => {
      await new Promise((r) => setTimeout(r, 250)); // a Pi resizing artwork isn't instant
      reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=3600');
      const item = itemsById.get(req.params.id);
      if (!item) return svg.avatar(jfPersonName(req.params.id) ?? '?');
      const t = item.title;
      if (item.kind === 'episode') return svg.still(t.title, `S${item.s} · E${item.e}`);
      if (req.params.type === 'Backdrop' || req.params.type === 'Thumb') return svg.backdrop(t.title);
      if (item.kind === 'season') return svg.poster(t.title, `SEASON ${item.s}`);
      return svg.poster(t.title, String(t.year));
    };
    jf.get('/Items/:id/Images/:type', image);
    jf.get('/Items/:id/Images/:type/:index', image);
    jf.get<{ Params: { id: string } }>('/Users/:id/Images/Primary', async (req, reply) =>
      reply.header('content-type', 'image/svg+xml').send(svg.avatar(USERS.find((u) => u.id === req.params.id)?.name ?? '?')),
    );

    jf.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/Items/:id/PlaybackInfo', async (req, reply) => {
      const item = itemsById.get(req.params.id);
      if (!item) return reply.code(404).send();
      const body = req.body ?? {};
      const profile = body.DeviceProfile as
        | { DirectPlayProfiles?: Array<{ Container?: string; VideoCodec?: string; AudioCodec?: string }>; SubtitleProfiles?: Array<{ Format: string; Method: string }> }
        | undefined;
      // Like Jellyfin: an empty Container/VideoCodec/AudioCodec in a profile means "any".
      const container = containerOf(item);
      const anyOf = (list: string | undefined, value: string) => !list || list.split(',').includes(value);
      const mp4 = profile?.DirectPlayProfiles?.find((p) => (p as { Type?: string }).Type !== 'Audio' && anyOf(p.Container, container) && anyOf(p.VideoCodec, 'h264'));
      // Like Jellyfin: no track asked for means the default-flagged one (audio and subtitles alike).
      const streams = streamsFor(item) as Array<{ Type: string; Index: number; Codec?: string; IsDefault?: boolean }>;
      const audioIndex = Number(body.AudioStreamIndex ?? streams.find((x) => x.Type === 'Audio' && x.IsDefault)?.Index ?? 1);
      const subIndex = Number(body.SubtitleStreamIndex ?? streams.find((x) => x.Type === 'Subtitle' && x.IsDefault)?.Index ?? -1);
      const audioCodec = streams.find((x) => x.Index === audioIndex)?.Codec?.toLowerCase() ?? 'aac';
      const subCodec = streams.find((x) => x.Index === subIndex)?.Codec?.toLowerCase();
      const reasons = [
        ...(mp4 ? [] : ['ContainerNotSupported']),
        ...(mp4 && !anyOf(mp4.AudioCodec, audioCodec) ? ['AudioCodecNotSupported'] : []),
        ...(subCodec && profile?.SubtitleProfiles?.find((p) => p.Format === subCodec)?.Method === 'Encode' ? ['SubtitleCodecNotSupported'] : []),
      ];
      const direct = body.EnableDirectPlay !== false && !reasons.length;
      const playSessionId = crypto.randomBytes(8).toString('hex');
      return {
        PlaySessionId: playSessionId,
        MediaSources: [
          {
            Id: item.id, Container: containerOf(item), RunTimeTicks: RUNTIME_TICKS, SupportsDirectPlay: direct, SupportsDirectStream: direct,
            SupportsTranscoding: true, MediaStreams: streams, DefaultAudioStreamIndex: audioIndex, DefaultSubtitleStreamIndex: subIndex,
            ...(direct
              ? {}
              : {
                  TranscodingUrl: `/videos/${item.id}/master.m3u8?MediaSourceId=${item.id}&AudioStreamIndex=${audioIndex}&PlaySessionId=${playSessionId}&ApiKey=${jfToken(req)}&TranscodeReasons=${(reasons.length ? reasons : ['ContainerNotSupported']).join(',')}`,
                  TranscodingSubProtocol: 'hls',
                }),
          },
        ],
      };
    });

    const fileOf = (id: string) => (itemsById.get(id) && containerOf(itemsById.get(id)!) === 'mkv' ? 'sample-dolby.mkv' : 'sample.mp4');
    jf.get<{ Params: { id: string } }>('/Videos/:id/stream', async (req, reply) => reply.sendFile(fileOf(req.params.id)));
    jf.get<{ Params: { id: string } }>('/Items/:id/Download', async (req, reply) =>
      reply.header('content-disposition', `attachment; filename="${fileOf(req.params.id)}"`).sendFile(fileOf(req.params.id)),
    );
    jf.get('/Videos/:id/stream.:ext', async (_req, reply) => reply.sendFile('sample.mp4'));
    jf.get<{ Querystring: Q }>('/Videos/:id/master.m3u8', async (req, reply) => {
      const a = req.query.AudioStreamIndex === '2' ? 2 : 1;
      return reply
        .header('content-type', 'application/vnd.apple.mpegurl')
        .send(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"\nhls-${a}/index.m3u8\n`);
    });
    jf.get<{ Params: { a: string; file: string } }>('/Videos/:id/hls-:a/:file', async (req, reply) => {
      const file = req.params.file.replace(/[^\w.]/g, '');
      return reply.sendFile(`hls-${req.params.a === '2' ? 2 : 1}/${file}`);
    });
    jf.get<{ Params: { id: string; idx: string } }>('/Videos/:id/:ms/Subtitles/:idx/0/Stream.vtt', async (req, reply) => {
      const item = itemsById.get(req.params.id);
      const stream = item ? streamsFor(item).find((s) => s.Index === Number(req.params.idx)) : undefined;
      const code = Object.entries(ISO1_TO_3).find(([, v]) => v === (stream as { Language?: string })?.Language)?.[0] ?? 'en';
      return reply.header('content-type', 'text/vtt; charset=utf-8').send(subtitleVtt(code));
    });
    jf.get('/MediaSegments/:id', async () => ({ Items: [{ Type: 'Intro', StartTicks: 8 * 10_000_000, EndTicks: 24 * 10_000_000 }] }));

    const report = (stop: boolean) => async (req: FastifyRequest<{ Body: { ItemId: string; PositionTicks?: number } }>, reply: import('fastify').FastifyReply) => {
      const user = jfUser(req)!;
      const pos = Number(req.body?.PositionTicks ?? 0);
      if (stop && pos >= RUNTIME_TICKS * 0.9) setUd(user.id, req.body.ItemId, { pos: 0, played: true, lastPlayed: Date.now() });
      else setUd(user.id, req.body.ItemId, { pos, lastPlayed: Date.now() });
      return reply.code(204).send();
    };
    jf.post('/Sessions/Playing', report(false));
    jf.post('/Sessions/Playing/Progress', report(false));
    jf.post('/Sessions/Playing/Stopped', report(true));
    // Channels end a programme's transcode without reporting a play; the mock just counts them.
    jf.delete<{ Querystring: { deviceId?: string; playSessionId?: string } }>('/Videos/ActiveEncodings', async (req, reply) => {
      endedEncodings.push({ deviceId: req.query.deviceId ?? '', playSessionId: req.query.playSessionId ?? '' });
      return reply.code(204).send();
    });
    jf.get('/__test/ended-encodings', async () => endedEncodings);
    jf.post('/Items/:id/Refresh', async (_req, reply) => reply.code(204).send());
  },
  { prefix: '/jf' },
);

// ======================================================================
// Seerr
// ======================================================================

const img = (kind: string, t: Title) => `/${kind}-${t.type}-${t.tmdbId}.jpg`;
const seerrUserOf = (req: FastifyRequest) => USERS.find((u) => u.seerrId === Number(req.headers['x-api-user'] ?? 1)) ?? USERS[0];

function requestDto(r: MockRequest) {
  const t = titleByTmdb.get(`${r.type}-${r.tmdbId}`)!;
  const u = USERS.find((x) => x.seerrId === r.seerrUserId)!;
  return {
    id: r.id, status: r.status === 5 ? 2 : r.status, type: r.type, createdAt: r.createdAt, is4k: false,
    media: { id: t.tmdbId, tmdbId: t.tmdbId, tvdbId: t.tvdbId, mediaType: t.type, status: mediaStatus(t) },
    requestedBy: { id: u.seerrId, displayName: u.name, jellyfinUserId: u.id, jellyfinUsername: u.name },
    seasons: r.seasons.map((n) => ({ seasonNumber: n, status: r.status })),
  };
}

function mediaInfo(t: Title) {
  const status = mediaStatus(t);
  const reqs = requests.filter((r) => r.type === t.type && r.tmdbId === t.tmdbId);
  if (status === 1 && !reqs.length) return undefined;
  return {
    id: t.tmdbId, tmdbId: t.tmdbId, tvdbId: t.tvdbId, status, status4k: 1, externalServiceId: t.n,
    jellyfinMediaId: inLibrary(t) ? (t.type === 'movie' ? ids.movie(t) : ids.series(t)) : null,
    requests: reqs.map(requestDto),
    seasons: t.type === 'tv' ? Array.from({ length: t.seasons }, (_, i) => ({ seasonNumber: i + 1, status: seasonStatus(t, i + 1) })) : [],
  };
}

const GENRE_IDS: Record<string, number> = {
  Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14,
  Horror: 27, Mystery: 9648, Romance: 10749, 'Science Fiction': 878, Thriller: 53, War: 10752, Western: 37, History: 36, Music: 10402,
};
const genreIds = (t: Title) => t.genres.map((name) => GENRE_IDS[name] ?? 0);

function resultDto(t: Title) {
  const date = `${t.year}-06-01`;
  return {
    id: t.tmdbId, mediaType: t.type, posterPath: img('poster', t), backdropPath: img('backdrop', t), overview: t.overview,
    voteAverage: t.rating, voteCount: 150 + ((t.n * 97) % 900), popularity: t.rating * 4, genreIds: genreIds(t), originalLanguage: t.lang, mediaInfo: mediaInfo(t),
    ...(t.type === 'movie' ? { title: t.title, releaseDate: date } : { name: t.title, firstAirDate: date }),
  };
}

const page = (items: Title[]) => ({ page: 1, totalPages: 1, totalResults: items.length, results: items.map(resultDto) });
const shuffle = (items: Title[], salt: string) =>
  [...items].sort((a, b) => crypto.createHash('md5').update(salt + a.n).digest()[0] - crypto.createHash('md5').update(salt + b.n).digest()[0]);

const FIRST = ['Ada', 'Bruno', 'Chiara', 'Dev', 'Elif', 'Femi', 'Greta', 'Hiro', 'Ines', 'Jonah', 'Kaia', 'Luca', 'Mira', 'Noor', 'Omar', 'Priya'];
const LAST = ['Marlin', 'Waters', 'Gill', 'Coral', 'Fisher', 'Reed', 'Shore', 'Tidwell', 'Brooks', 'Salter', 'Pike', 'Hake'];
const castFor = (t: Title) =>
  Array.from({ length: 10 }, (_, i) => {
    const name = `${FIRST[(t.n * 3 + i * 5) % FIRST.length]} ${LAST[(t.n + i * 7) % LAST.length]}`;
    return { id: personId(name), name, character: i === 0 ? 'The Lead' : `Character ${i + 1}`, profilePath: profileOf(name), order: i };
  });

// People: a handful of directors, show creators and the actors above, each with a filmography.
const DIRECTORS = ['Greta Marlin', 'Hiro Waters', 'Ines Coral', 'Jonah Pike'];
const directorOf = (t: Title) => DIRECTORS[t.n % DIRECTORS.length];
const creatorOf = (t: Title) => `${FIRST[t.n % FIRST.length]} ${LAST[(t.n + 3) % LAST.length]}`;
const profileOf = (name: string) => `/profile-${encodeURIComponent(name)}.jpg`;
let peopleIds: Map<string, number> | undefined;
function people(): Map<string, number> {
  if (peopleIds) return peopleIds;
  peopleIds = new Map();
  const add = (name: string) => peopleIds!.has(name) || peopleIds!.set(name, 7001 + peopleIds!.size);
  for (const t of TITLES) {
    if (t.type === 'movie') add(directorOf(t));
    else add(creatorOf(t));
  }
  for (const t of TITLES) for (let i = 0; i < 10; i++) add(`${FIRST[(t.n * 3 + i * 5) % FIRST.length]} ${LAST[(t.n + i * 7) % LAST.length]}`);
  return peopleIds;
}
const personId = (name: string) => people().get(name)!;
const personName = (id: number) => [...people()].find(([, n]) => n === id)?.[0];
const jfPersonId = (name: string) => crypto.createHash('md5').update(`person-${name}`).digest('hex');
const jfPersonName = (id: string) => [...people().keys()].find((name) => jfPersonId(name) === id);
function creditsOf(name: string) {
  const votes = (t: Title) => ({ voteCount: Math.round(t.rating * 300) + t.n, popularity: t.rating * 3, genreIds: [] as number[] });
  const cast: object[] = [];
  const crew: object[] = [];
  for (const t of TITLES) {
    const role = castFor(t).find((c) => c.name === name);
    if (role) cast.push({ ...resultDto(t), ...votes(t), character: role.character });
    if (t.type === 'movie' && directorOf(t) === name) {
      crew.push({ ...resultDto(t), ...votes(t), job: 'Director', department: 'Directing' });
      crew.push({ ...resultDto(t), ...votes(t), job: 'Screenplay', department: 'Writing' });
    }
    if (t.type === 'tv' && creatorOf(t) === name) crew.push({ ...resultDto(t), ...votes(t), job: 'Creator', department: 'Writing' });
  }
  return { cast, crew };
}
const departmentOf = (name: string) => (DIRECTORS.includes(name) ? 'Directing' : TITLES.some((t) => t.type === 'tv' && creatorOf(t) === name) ? 'Writing' : 'Acting');
const personSearch = (query: string) =>
  [...people().keys()]
    .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
    .map((name) => ({ name, credits: creditsOf(name) }))
    .sort((a, b) => b.credits.cast.length + b.credits.crew.length - (a.credits.cast.length + a.credits.crew.length));

void app.register(
  async (s) => {
    s.addHook('onRequest', async (req, reply) => {
      if (req.url.endsWith('/status')) return; // public, like the real Seerr
      if (req.headers['x-api-key'] !== API_KEY) return reply.code(403).send({ message: 'Invalid API key' });
    });
    s.get('/status', async () => ({ version: '3.2.0-mock' }));
    s.get('/auth/me', async () => ({ id: 1, displayName: 'admin' }));
    s.get<{ Querystring: Q }>('/search', async (req) => {
      const query = (req.query.query ?? '').trim();
      const titles = page(TITLES.filter((t) => t.title.toLowerCase().includes(query.toLowerCase())));
      const found = query.length >= 2 ? personSearch(query) : [];
      const persons = found.map(({ name, credits }) => ({
        id: personId(name), mediaType: 'person', name, profilePath: profileOf(name), popularity: credits.cast.length + credits.crew.length, adult: false,
        knownFor: [...credits.crew, ...credits.cast].slice(0, 3),
      }));
      return { ...titles, totalResults: titles.totalResults + persons.length, results: [...titles.results, ...persons] };
    });
    s.get<{ Params: { id: string } }>('/person/:id', async (req, reply) => {
      const name = personName(Number(req.params.id));
      if (!name) return reply.code(404).send({ message: 'Unable to retrieve person.' });
      return {
        id: Number(req.params.id), name, profilePath: profileOf(name), knownForDepartment: departmentOf(name), birthday: '1975-03-02', deathday: null,
        placeOfBirth: 'Genoa, Italy', biography: `${name} has spent a career near water: ${departmentOf(name).toLowerCase()} stories about the sea, rivers and the people who fish them.`,
      };
    });
    s.get<{ Params: { id: string } }>('/person/:id/combined_credits', async (req, reply) => {
      const name = personName(Number(req.params.id));
      return name ? { id: Number(req.params.id), ...creditsOf(name) } : reply.code(404).send({ message: 'Unable to retrieve combined credits.' });
    });
    s.get('/discover/trending', async () => page(shuffle(TITLES.filter((t) => t.year >= 2022), new Date().toDateString()).slice(0, 20)));
    s.get('/discover/movies', async () => page(TITLES.filter((t) => t.type === 'movie' && t.year < 2026).sort((a, b) => b.rating - a.rating)));
    s.get('/discover/tv', async () => page(TITLES.filter((t) => t.type === 'tv').sort((a, b) => b.rating - a.rating)));
    s.get('/discover/movies/upcoming', async () => page(TITLES.filter((t) => t.type === 'movie' && t.year >= 2026 && !inLibrary(t))));
    s.get('/discover/tv/upcoming', async () => page(TITLES.filter((t) => t.type === 'tv' && t.year >= 2026)));

    // Trailers by language, like Seerr: Blender's open-licensed films stand in. Big Buck Bunny is English
    // (and what Seerr fills in when a language has none), Sintel Italian (every other title), Tears of
    // Steel a title in its own language.
    const trailerIn = (t: Title, language: string) =>
      language === t.lang && t.lang !== 'en'
        ? { key: 'R6MlUcmOul8', name: 'Bande-annonce' }
        : language === 'it' && t.n % 2 === 0
          ? { key: 'eRsGyueVLvQ', name: 'Trailer ufficiale' }
          : { key: 'aqz-KE-bpKQ', name: 'Official Trailer' };
    const detail = (type: 'movie' | 'tv') => async (req: FastifyRequest<{ Params: { id: string }; Querystring: { language?: string } }>, reply: import('fastify').FastifyReply) => {
      const t = titleByTmdb.get(`${type}-${req.params.id}`);
      if (!t) return reply.code(404).send({ message: 'Unable to retrieve' });
      const director = directorOf(t);
      const credits = {
        cast: castFor(t),
        crew: type === 'movie' ? [{ id: personId(director), name: director, job: 'Director', department: 'Directing' }, { id: personId(director), name: director, job: 'Screenplay', department: 'Writing' }] : [],
      };
      const common = {
        id: t.tmdbId, overview: t.overview, posterPath: img('poster', t), backdropPath: img('backdrop', t), voteAverage: t.rating,
        genres: t.genres.map((name) => ({ id: GENRE_IDS[name] ?? 0, name })), originalLanguage: t.lang, credits, mediaInfo: mediaInfo(t),
        relatedVideos: [{ site: 'YouTube', type: 'Trailer', ...trailerIn(t, req.query.language ?? 'en') }],
        tagline: t.n % 3 === 0 ? 'The ocean keeps its secrets.' : '',
      };
      if (type === 'movie') {
        const out = releaseOf(t) as { inCinemas: string; digitalRelease: string };
        const releases = { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13', type: 3, release_date: out.inCinemas }, { type: 4, release_date: out.digitalRelease }] }] };
        return { ...common, title: t.title, originalTitle: t.title, releaseDate: out.inCinemas.slice(0, 10), runtime: 104 + (t.n % 30), releases, externalIds: { imdbId: `tt${9000000 + t.n}` } };
      }
      return {
        ...common, name: t.title, originalName: t.title, firstAirDate: (releaseOf(t).firstAired ?? '').slice(0, 10), episodeRunTime: [48], numberOfSeasons: t.seasons,
        nextEpisodeToAir: releaseOf(t).nextAiring ? { airDate: releaseOf(t).nextAiring!.slice(0, 10) } : null,
        createdBy: [{ id: personId(creatorOf(t)), name: creatorOf(t) }], networks: [{ name: 'Mock+' }],
        contentRatings: { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] }, externalIds: { tvdbId: t.tvdbId, imdbId: `tt${9100000 + t.n}` },
        seasons: Array.from({ length: t.seasons }, (_, i) => ({ id: t.tmdbId * 10 + i, seasonNumber: i + 1, name: `Season ${i + 1}`, episodeCount: EPISODES_PER_SEASON, airDate: `${t.year + i}-01-15`, posterPath: `/poster-season-${t.tmdbId}-${i + 1}.jpg` })),
      };
    };
    s.get('/movie/:id', detail('movie'));
    s.get('/tv/:id', detail('tv'));
    s.get<{ Params: { id: string; n: string } }>('/tv/:id/season/:n', async (req) => {
      const t = titleByTmdb.get(`tv-${req.params.id}`)!;
      const n = Number(req.params.n);
      return {
        id: t.tmdbId * 10 + n, seasonNumber: n, name: `Season ${n}`, overview: n === 1 ? 'Where it all begins.' : '',
        episodes: Array.from({ length: EPISODES_PER_SEASON }, (_, i) => ({
          id: t.tmdbId * 1000 + n * 100 + i, seasonNumber: n, episodeNumber: i + 1, name: episodeName(t, n, i + 1),
          overview: `${t.title}, season ${n} episode ${i + 1}. Things get choppy.`, stillPath: `/still-${t.tmdbId}-${n}-${i + 1}.jpg`,
          airDate: `${t.year + n - 1}-0${Math.min(9, i + 1)}-10`,
        })),
      };
    });
    const rt = (t: Title) => {
      const critics = 40 + ((t.n * 37) % 60);
      return {
        title: t.title, year: t.year, url: `https://www.rottentomatoes.com/m/${t.title.toLowerCase().replace(/\W+/g, '_')}`,
        criticsScore: critics, criticsRating: critics >= 75 ? 'Certified Fresh' : critics >= 60 ? 'Fresh' : 'Rotten',
        audienceScore: 50 + ((t.n * 23) % 50), audienceRating: (t.n * 23) % 50 >= 10 ? 'Upright' : 'Spilled',
      };
    };
    s.get<{ Params: { id: string } }>('/movie/:id/ratingscombined', async (req, reply) => {
      const t = titleByTmdb.get(`movie-${req.params.id}`);
      if (!t) return reply.code(404).send({ message: 'No ratings found.' });
      await sleep(400);
      return { rt: rt(t), imdb: { title: t.title, url: `https://www.imdb.com/title/tt${9000000 + t.n}`, criticsScore: Math.round(t.rating * 10) / 10, criticsScoreCount: 1000 * t.n } };
    });
    s.get<{ Params: { id: string } }>('/tv/:id/ratings', async (req, reply) => {
      const t = titleByTmdb.get(`tv-${req.params.id}`);
      return t ? rt(t) : reply.code(404).send({ message: 'Rotten Tomatoes ratings not found.' });
    });
    const recs = (type: 'movie' | 'tv') => async (req: FastifyRequest<{ Params: { id: string } }>) =>
      page(shuffle(TITLES.filter((t) => t.type === type && t.tmdbId !== Number(req.params.id)), req.params.id).slice(0, 12));
    s.get('/movie/:id/recommendations', recs('movie'));
    s.get('/tv/:id/recommendations', recs('tv'));

    s.post<{ Body: { mediaType: 'movie' | 'tv'; mediaId: number; seasons?: number[] | 'all' } }>('/request', async (req, reply) => {
      const user = seerrUserOf(req);
      const t = titleByTmdb.get(`${req.body.mediaType}-${req.body.mediaId}`);
      if (!t) return reply.code(404).send({ message: 'Media not found' });
      const seasons =
        t.type === 'tv'
          ? (req.body.seasons === 'all' || !req.body.seasons ? Array.from({ length: t.seasons }, (_, i) => i + 1) : req.body.seasons).filter((n) => seasonStatus(t, n) === 1)
          : [];
      if (t.type === 'tv' && !seasons.length) return reply.code(202).send({ message: 'No seasons available to request' });
      if (t.type === 'movie' && mediaStatus(t) !== 1) return reply.code(409).send({ message: 'Request for this media already exists.' });
      const r: MockRequest = { id: newId(), type: t.type, tmdbId: t.tmdbId, seasons, status: 2, seerrUserId: user.seerrId, createdAt: new Date().toISOString() };
      requests.push(r);
      // Radarr/Sonarr only find something once it's out.
      if (!isOut(t)) {
        /* waits for its release */
      } else if (t.type === 'movie') startDownload(t, { durationMs: 75_000 });
      else seasons.forEach((season, i) => startDownload(t, { season, durationMs: 90_000 + i * 30_000 }));
      return reply.code(201).send(requestDto(r));
    });
    s.get<{ Querystring: Q }>('/request', async (req) => {
      const by = req.query.requestedBy ? Number(req.query.requestedBy) : undefined;
      const list = requests.filter((r) => by === undefined || r.seerrUserId === by).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { pageInfo: { results: list.length }, results: list.map(requestDto) };
    });
    s.get<{ Params: { id: string } }>('/user/jellyfin/:id', async (req, reply) => {
      const u = USERS.find((x) => x.id === req.params.id.replace(/-/g, '').toLowerCase());
      return u ? { id: u.seerrId, displayName: u.name, jellyfinUserId: u.id } : reply.code(404).send({ message: 'User not found.' });
    });
    s.get('/user', async () => ({ results: USERS.map((u) => ({ id: u.seerrId, displayName: u.name, jellyfinUserId: u.id })) }));
    s.post('/user/import-from-jellyfin', async (_req, reply) => reply.code(201).send([]));
    s.delete<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
      const t = TITLES.find((x) => x.tmdbId === Number(req.params.id));
      if (!t) return reply.code(404).send({ message: 'Media not found' });
      for (let i = requests.length - 1; i >= 0; i--) if (requests[i].type === t.type && requests[i].tmdbId === t.tmdbId) requests.splice(i, 1);
      statusOverride.delete(`${t.type}-${t.tmdbId}`);
      return reply.code(204).send();
    });
    s.post<{ Params: { id: string; status: string } }>('/media/:id/:status', async (req, reply) => {
      const t = TITLES.find((x) => x.tmdbId === Number(req.params.id));
      const code = { unknown: 1, pending: 2, processing: 3, partial: 4, available: 5 }[req.params.status];
      if (!t || !code) return reply.code(404).send({ message: 'Media not found' });
      statusOverride.set(`${t.type}-${t.tmdbId}`, code);
      return mediaInfo(t) ?? { id: t.tmdbId, tmdbId: t.tmdbId, status: code };
    });
  },
  { prefix: '/seerr/api/v1' },
);

// ======================================================================
// Radarr / Sonarr
// ======================================================================

const LANG_IDS: Record<string, number> = { English: 1, French: 2, Spanish: 3, German: 4, Italian: 5, Japanese: 8, Hindi: 26, Tamil: 43, Telugu: 45, 'Spanish (Latino)': 37 };
const langList = (names: string[]) => names.map((name) => ({ id: LANG_IDS[name] ?? 0, name }));
const releaseCache = new Map<string, { title: Title; season?: number; release: string; quality: string; languages: string[] }>();
const posterUrl = (t: Title) => `http://127.0.0.1:${PORT}/img/w342${img('poster', t)}`;

/** Custom formats a release's name would match, with made-up scores (like a TRaSH-style profile). */
function formatsOf(release: string) {
  const all: Array<[RegExp, string, number]> = [[/BluRay/i, 'BluRay Tier 01', 1800], [/WEB-?DL/i, 'WEB Tier 02', 1650], [/HDR/i, 'HDR', 500], [/DDP|DD\+/i, 'DD+', 300], [/H\.?265|x265/i, 'x265 (HD)', -100], [/MULTi|DUAL|iTA-ENG/i, 'Multi-Audio', 50], [/720p/i, '720p', -500]];
  const hits = all.filter(([re]) => re.test(release));
  return { customFormats: hits.map(([, name], i) => ({ id: i + 1, name })), customFormatScore: hits.reduce((n, [, , score]) => n + score, 0) };
}

function queueRecords(type: 'movie' | 'tv') {
  return downloads
    .filter((d) => d.title.type === type)
    .flatMap((d): Array<Record<string, unknown>> => {
      const progress = progressOf(d);
      const importing = isImporting(d);
      const left = Math.round(d.size * (1 - progress));
      const secondsLeft = Math.max(0, Math.round(((1 - progress) * d.durationMs) / 1000));
      const base = {
        size: d.size, sizeleft: left, timeleft: `00:${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`,
        status: d.stopped ? 'paused' : importing ? 'completed' : 'downloading', trackedDownloadStatus: d.stalledAt !== undefined && !d.stopped ? 'warning' : 'ok',
        trackedDownloadState: importing ? 'importing' : 'downloading',
        statusMessages: d.stalledAt !== undefined && !d.stopped ? [{ title: d.release, messages: ['The download is stalled with no connections'] }] : [],
        downloadId: d.downloadId, protocol: 'torrent', title: d.release, quality: { quality: { name: d.quality } }, languages: langList(d.languages),
        ...formatsOf(d.release), indexer: ['FishTracker', 'ReefNZB', 'TidalTorrents'][d.id % 3], downloadClient: 'qBittorrent',
      };
      const t = d.title;
      if (type === 'movie') return [{ ...base, id: d.id, movieId: t.n, movie: { id: t.n, title: t.title, tmdbId: t.tmdbId, year: t.year, images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }] } }];
      return Array.from({ length: EPISODES_PER_SEASON }, (_, i) => ({
        ...base, id: d.id * 100 + i, seriesId: t.n, episodeId: t.n * 10000 + d.season! * 100 + i + 1, seasonNumber: d.season,
        series: { id: t.n, title: t.title, tvdbId: t.tvdbId, tmdbId: t.tmdbId, images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }] },
        episode: { seasonNumber: d.season, episodeNumber: i + 1, title: episodeName(t, d.season!, i + 1) },
      }));
    });
}

function fakeReleases(t: Title, season?: number, episode?: number) {
  const ep = episode ? `E${String(episode).padStart(2, '0')}` : '';
  const base = `${t.title.replace(/[^A-Za-z0-9]+/g, '.')}.${season ? `S${String(season).padStart(2, '0')}${ep}` : t.year}`;
  const rows: Array<[string, string[], string, number]> = [
    [`${base}.1080p.BluRay.x264-FISHY`, ['English'], 'Bluray-1080p', 120],
    [`${base}.2160p.WEB-DL.DDP5.1.HDR.H.265-REEF`, ['English'], 'WEBDL-2160p', 80],
    [`${base}.MULTi.1080p.BluRay.x264-LOST`, ['English', 'French'], 'Bluray-1080p', 35],
    [`${base}.SPANISH.1080p.WEB-DL.x264-ATLANTIS`, ['Spanish'], 'WEBDL-1080p', 22],
    [`${base}.DUAL.1080p.WEBRip.x264-KRAKEN`, ['English', 'Spanish'], 'WEBRip-1080p', 41],
    [`${base}.German.DL.1080p.BluRay.x264-WAL`, ['German', 'English'], 'Bluray-1080p', 17],
    [`${base}.FRENCH.720p.HDTV.x264-MER`, ['French'], 'HDTV-720p', 5],
    [`${base}.iTA-ENG.1080p.WEB-DL-PESCE`, ['Italian', 'English'], 'WEBDL-1080p', 9],
    [`${base}.LATINO.1080p.WEB-DL.x264-CORAL`, ['Spanish (Latino)'], 'WEBDL-1080p', 14],
    [`${base}.Hindi.Tamil.Telugu.1080p.WEB-DL-MACHLI`, ['Hindi', 'Tamil', 'Telugu'], 'WEBDL-1080p', 30],
    [`${base}.JAPANESE.1080p.BluRay-SAKANA`, ['Japanese'], 'Bluray-1080p', 0],
    [`${base}.720p.WEB-DL.x264-MINNOW`, ['English'], 'WEBDL-720p', 60],
  ];
  return rows.map(([title, languages, quality, seeders], i) => {
    const guid = `mock-${crypto.createHash('md5').update(title).digest('hex').slice(0, 12)}`;
    releaseCache.set(guid, { title: t, season, release: title, quality, languages });
    return {
      guid, indexerId: 1 + (i % 3), indexer: ['FishTracker', 'ReefNZB', 'TidalTorrents'][i % 3], title, size: (season ? 14 : 6) * 1024 ** 3 + i * 3e8,
      seeders, leechers: Math.round(seeders / 3), quality: { quality: { name: quality, resolution: Number(quality.match(/\d{3,4}/)?.[0] ?? 0) } },
      languages: langList(languages), ageHours: 24 * (i + 2), protocol: 'torrent',
      rejected: !languages.includes('English'), rejections: languages.includes('English') ? [] : ['Language is not wanted in profile'],
      customFormatScore: 0, fullSeason: Boolean(season) && !episode, seasonNumber: season, episodeNumbers: episode ? [episode] : [],
    };
  });
}

/** When titles come out: 2026 films are in cinemas (out digitally soon), 2027 ones not out yet; 2026 shows haven't started. */
const DAY_MS = 86_400_000;
const fromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
function releaseOf(t: Title) {
  if (t.type === 'movie') {
    if (t.year >= 2027) return { status: 'announced', isAvailable: false, inCinemas: fromNow(30 + t.n), digitalRelease: fromNow(120 + t.n) };
    if (t.year === 2026) return { status: 'inCinemas', isAvailable: false, inCinemas: fromNow(-20), digitalRelease: fromNow(t.n - 10) };
    return { status: 'released', isAvailable: true, inCinemas: `${t.year}-06-01T00:00:00Z`, digitalRelease: `${t.year}-09-01T00:00:00Z` };
  }
  if (t.year >= 2026) return { status: 'upcoming', firstAired: fromNow(40), nextAiring: fromNow(40) };
  return { status: 'ended', firstAired: `${t.year}-01-15T00:00:00Z`, previousAiring: `${t.year + t.seasons - 1}-03-01T00:00:00Z` };
}
const isOut = (t: Title) => (t.type === 'movie' ? releaseOf(t).isAvailable !== false : releaseOf(t).status !== 'upcoming');

const arrAuth = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
  if (req.headers['x-api-key'] !== API_KEY) return reply.code(401).send({ message: 'Unauthorized' });
};
const managed = (t: Title) =>
  inLibrary(t) || arrKnown.has(`${t.type}-${t.tmdbId}`) || requests.some((r) => r.type === t.type && r.tmdbId === t.tmdbId) || downloads.some((d) => d.title === t);
const GB = 1024 ** 3;
const fileSize = (t: Title, season?: number) => (season ? Math.round((5 + (t.n % 4)) * 1.1 * GB) : Math.round((4 + (t.n % 9) * 1.3) * GB));
const DISK = 4 * 1024 * GB;
const onDisk = (t: Title) => (t.type === 'movie' ? (inLibrary(t) ? fileSize(t) : 0) : librarySeasons(t).reduce((n, s) => n + fileSize(t, s), 0));
const freeSpace = () => Math.round(DISK - 1.3 * 1024 * GB - TITLES.reduce((n, t) => n + onDisk(t), 0));
const seasonsDto = (t: Title) =>
  Array.from({ length: t.seasons }, (_, i) => i + 1).map((s) => {
    const has = library.has(`tv-${t.tmdbId}-${s}`);
    return {
      seasonNumber: s, monitored: !unmonitored.has(`tv-${t.tmdbId}-${s}`),
      statistics: { episodeFileCount: has ? EPISODES_PER_SEASON : 0, episodeCount: EPISODES_PER_SEASON, totalEpisodeCount: EPISODES_PER_SEASON, sizeOnDisk: has ? fileSize(t, s) : 0 },
    };
  });
/** Tags, like Radarr/Sonarr's (each has its own list), and which titles carry them. */
const arrTags = { radarr: [] as Array<{ id: number; label: string }>, sonarr: [] as Array<{ id: number; label: string }> };
const titleTags = new Map<string, number[]>();
const PROFILES = [{ id: 1, name: 'Any' }, { id: 4, name: 'HD-1080p' }, { id: 6, name: 'HD-720p' }];
/** Gone for good (deleteFiles): the title, its files, its download. */
function forgetTitle(t: Title) {
  arrKnown.delete(`${t.type}-${t.tmdbId}`);
  titleTags.delete(`${t.type}-${t.tmdbId}`);
  for (const key of [...unmonitored]) if (key === `${t.type}-${t.tmdbId}` || key.startsWith(`${t.type}-${t.tmdbId}-`)) unmonitored.delete(key);
  for (const key of [...library]) if (key === `movie-${t.tmdbId}` || key.startsWith(`tv-${t.tmdbId}-`)) library.delete(key);
  for (const d of downloads.filter((x) => x.title === t)) downloads.splice(downloads.indexOf(d), 1);
}
const tagRoutes = (r: import('fastify').FastifyInstance, service: 'radarr' | 'sonarr') => {
  r.get('/tag', async () => arrTags[service]);
  r.post<{ Body: { label: string } }>('/tag', async (req) => {
    const tag = { id: arrTags[service].length + 1, label: String(req.body.label).toLowerCase() };
    arrTags[service].push(tag);
    return tag;
  });
  r.get('/qualityprofile', async () => PROFILES);
};

const fileDto = (t: Title, season?: number) => ({
  id: t.n * 100 + (season ?? 0), seasonNumber: season, size: fileSize(t, season), quality: { quality: { name: 'Bluray-1080p', resolution: 1080 } },
  languages: langList(audioOf(t).map((l) => ISO3_NAME[l] ?? 'English')), customFormatScore: 0,
});

void app.register(
  async (r) => {
    r.addHook('onRequest', arrAuth);
    r.get('/system/status', async () => ({ version: '6.0.4-mock', appName: 'Radarr' }));
    r.get('/queue', async () => ({ page: 1, totalRecords: 0, records: queueRecords('movie') }));
    const movieDto = (t: Title) => ({
      id: t.n, title: t.title, tmdbId: t.tmdbId, hasFile: inLibrary(t), images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }],
      movieFile: inLibrary(t) ? fileDto(t) : undefined, ...releaseOf(t), year: t.year,
      monitored: !unmonitored.has(`movie-${t.tmdbId}`), sizeOnDisk: inLibrary(t) ? fileSize(t) : 0, tags: titleTags.get(`movie-${t.tmdbId}`) ?? [],
    });
    r.get<{ Querystring: Q }>('/movie', async (req) =>
      TITLES.filter((t) => t.type === 'movie' && managed(t) && (!req.query.tmdbId || t.tmdbId === Number(req.query.tmdbId))).map(movieDto),
    );
    tagRoutes(r, 'radarr');
    r.get<{ Querystring: Q }>('/movie/lookup/tmdb', async (req, reply) => {
      const t = titleByTmdb.get(`movie-${req.query.tmdbId}`);
      return t ? { title: t.title, tmdbId: t.tmdbId, year: t.year, images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }] } : reply.code(404).send({ message: 'Movie not found' });
    });
    r.post<{ Body: { tmdbId: number; tags?: number[]; qualityProfileId?: number; rootFolderPath?: string; addOptions?: { searchForMovie?: boolean } } }>('/movie', async (req, reply) => {
      const t = titleByTmdb.get(`movie-${req.body.tmdbId}`);
      if (!t) return reply.code(400).send([{ errorMessage: 'Movie not found' }]);
      if (managed(t)) return reply.code(400).send([{ propertyName: 'TmdbId', errorMessage: 'This movie has already been added' }]);
      if (!req.body.qualityProfileId || !req.body.rootFolderPath) return reply.code(400).send([{ errorMessage: 'Quality profile and root folder are required' }]);
      arrKnown.add(`movie-${t.tmdbId}`);
      titleTags.set(`movie-${t.tmdbId}`, req.body.tags ?? []);
      if (req.body.addOptions?.searchForMovie && isOut(t)) startDownload(t, { durationMs: 45_000 });
      return reply.code(201).send(movieDto(t));
    });
    r.get<{ Querystring: Q }>('/release', async (req) => {
      await sleep(1500);
      const t = TITLES.find((x) => x.type === 'movie' && x.n === Number(req.query.movieId));
      if (!t) return [];
      // Like Radarr: before a movie is available, every release is turned down for it.
      return isOut(t) ? fakeReleases(t) : fakeReleases(t).map((r) => ({ ...r, rejected: true, rejections: [...(r.rejections ?? []), `Movie ${t.title} is not available`] }));
    });
    // Managing files: the queue, monitoring, deleting, searching again, and the disks.
    r.delete<{ Body: { ids: number[] }; Querystring: Q }>('/queue/bulk', async (req) => {
      for (const id of req.body.ids) {
        const d = downloads.find((x) => x.id === id && x.title.type === 'movie');
        if (!d) continue;
        downloads.splice(downloads.indexOf(d), 1);
        if (req.query.blocklist === 'true' && req.query.skipRedownload === 'false' && !d.interactive) startDownload(d.title, { durationMs: 70_000, release: `${d.release}.REPACK` });
      }
      return {};
    });
    r.put<{ Body: { movieIds: number[]; monitored: boolean } }>('/movie/editor', async (req) => {
      for (const n of req.body.movieIds) {
        const t = TITLES.find((x) => x.type === 'movie' && x.n === n);
        if (!t) continue;
        arrKnown.add(`movie-${t.tmdbId}`);
        if (req.body.monitored) unmonitored.delete(`movie-${t.tmdbId}`);
        else unmonitored.add(`movie-${t.tmdbId}`);
      }
      return [];
    });
    r.delete<{ Params: { id: string }; Querystring: Q }>('/movie/:id', async (req, reply) => {
      const t = TITLES.find((x) => x.type === 'movie' && x.n === Number(req.params.id));
      if (!t) return reply.code(404).send();
      if (req.query.deleteFiles === 'true') forgetTitle(t);
      arrKnown.delete(`movie-${t.tmdbId}`);
      unmonitored.delete(`movie-${t.tmdbId}`);
      return reply.code(200).send({});
    });
    r.delete<{ Params: { id: string } }>('/moviefile/:id', async (req, reply) => {
      const t = TITLES.find((x) => x.type === 'movie' && x.n === Math.floor(Number(req.params.id) / 100));
      if (!t || !library.delete(`movie-${t.tmdbId}`)) return reply.code(404).send({ message: 'Movie file not found' });
      arrKnown.add(`movie-${t.tmdbId}`);
      return {};
    });
    r.post<{ Body: { name: string; movieIds?: number[] } }>('/command', async (req, reply) => {
      for (const n of req.body.movieIds ?? []) {
        const t = TITLES.find((x) => x.type === 'movie' && x.n === n);
        if (t && isOut(t) && !inLibrary(t) && !downloads.some((d) => d.title === t)) startDownload(t, { durationMs: 60_000 });
      }
      return reply.code(201).send({ id: newId(), name: req.body.name, status: 'queued' });
    });
    r.get('/rootfolder', async () => [{ id: 1, path: '/data/movies', accessible: true, freeSpace: freeSpace() }]);
    r.get('/diskspace', async () => [
      { path: '/', label: 'overlay', freeSpace: 21 * GB, totalSpace: 58 * GB },
      { path: '/data', label: 'media', freeSpace: freeSpace(), totalSpace: DISK },
    ]);
    r.post<{ Body: { guid: string } }>('/release', async (req, reply) => {
      const hit = releaseCache.get(req.body.guid);
      if (!hit) return reply.code(404).send({ message: "Couldn't find requested release in cache, cache timeout probably expired." });
      startDownload(hit.title, { release: hit.release, quality: hit.quality, languages: hit.languages, durationMs: 60_000, interactive: true });
      return {};
    });
  },
  { prefix: '/radarr/api/v3' },
);

void app.register(
  async (r) => {
    r.addHook('onRequest', arrAuth);
    r.get('/system/status', async () => ({ version: '4.0.15-mock', appName: 'Sonarr' }));
    r.get('/queue', async () => ({ page: 1, totalRecords: 0, records: queueRecords('tv') }));
    const seriesDto = (t: Title) => ({
      id: t.n, title: t.title, tvdbId: t.tvdbId, tmdbId: t.tmdbId, images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }], ...releaseOf(t),
      year: t.year, monitored: !unmonitored.has(`tv-${t.tmdbId}`), seasons: seasonsDto(t), tags: titleTags.get(`tv-${t.tmdbId}`) ?? [],
      statistics: { sizeOnDisk: librarySeasons(t).reduce((n, s) => n + fileSize(t, s), 0), episodeFileCount: librarySeasons(t).length * EPISODES_PER_SEASON },
    });
    r.get<{ Querystring: Q }>('/series', async (req) =>
      TITLES.filter((t) => t.type === 'tv' && managed(t) && (!req.query.tvdbId || t.tvdbId === Number(req.query.tvdbId))).map(seriesDto),
    );
    tagRoutes(r, 'sonarr');
    r.get<{ Querystring: Q }>('/series/lookup', async (req) => {
      const tvdb = Number((req.query.term ?? '').replace(/^tvdb:/, ''));
      const t = TITLES.find((x) => x.type === 'tv' && x.tvdbId === tvdb);
      return t ? [{ title: t.title, tvdbId: t.tvdbId, tmdbId: t.tmdbId, year: t.year, seasons: Array.from({ length: t.seasons }, (_, i) => ({ seasonNumber: i + 1, monitored: true })) }] : [];
    });
    r.post<{ Body: { tvdbId: number; tags?: number[]; qualityProfileId?: number; rootFolderPath?: string; seasons?: Array<{ seasonNumber: number; monitored: boolean }>; addOptions?: { searchForMissingEpisodes?: boolean } } }>(
      '/series',
      async (req, reply) => {
        const t = TITLES.find((x) => x.type === 'tv' && x.tvdbId === req.body.tvdbId);
        if (!t) return reply.code(400).send([{ errorMessage: 'Series not found' }]);
        if (managed(t)) return reply.code(400).send([{ propertyName: 'TvdbId', errorMessage: 'This series has already been added' }]);
        if (!req.body.qualityProfileId || !req.body.rootFolderPath) return reply.code(400).send([{ errorMessage: 'Quality profile and root folder are required' }]);
        arrKnown.add(`tv-${t.tmdbId}`);
        titleTags.set(`tv-${t.tmdbId}`, req.body.tags ?? []);
        const wanted = (req.body.seasons ?? []).filter((x) => x.monitored).map((x) => x.seasonNumber);
        for (let season = 1; season <= t.seasons; season++) if (!wanted.includes(season)) unmonitored.add(`tv-${t.tmdbId}-${season}`);
        if (req.body.addOptions?.searchForMissingEpisodes && isOut(t)) for (const season of wanted) startDownload(t, { season, durationMs: 50_000 });
        return reply.code(201).send(seriesDto(t));
      },
    );
    r.get<{ Querystring: Q }>('/episodefile', async (req) => {
      const t = TITLES.find((x) => x.type === 'tv' && x.n === Number(req.query.seriesId));
      return t ? librarySeasons(t).map((s) => fileDto(t, s)) : [];
    });
    r.get<{ Querystring: Q }>('/episode', async (req) => {
      const n = Number(req.query.seriesId);
      const t = TITLES.find((x) => x.type === 'tv' && x.n === n);
      const seasons = req.query.seasonNumber ? [Number(req.query.seasonNumber)] : Array.from({ length: t?.seasons ?? 1 }, (_, i) => i + 1);
      return seasons.flatMap((season) =>
        Array.from({ length: EPISODES_PER_SEASON }, (_, i) => ({
          id: n * 10000 + season * 100 + i + 1, seasonNumber: season, episodeNumber: i + 1,
          episodeFileId: t && library.has(`tv-${t.tmdbId}-${season}`) ? n * 100 + season : 0, monitored: !(t && unmonitored.has(`tv-${t.tmdbId}-${season}`)),
        })),
      );
    });
    r.delete<{ Body: { ids: number[] }; Querystring: Q }>('/queue/bulk', async (req) => {
      const ids = new Set(req.body.ids.map((id) => Math.floor(id / 100)));
      for (const d of downloads.filter((x) => ids.has(x.id) && x.title.type === 'tv')) {
        downloads.splice(downloads.indexOf(d), 1);
        if (req.query.blocklist === 'true' && req.query.skipRedownload === 'false' && !d.interactive) startDownload(d.title, { season: d.season, durationMs: 80_000, release: `${d.release}.REPACK` });
      }
      return {};
    });
    const seasonOfEpisode = (id: number) => {
      const t = TITLES.find((x) => x.type === 'tv' && x.n === Math.floor(id / 10000));
      return t && { t, season: Math.floor((id % 10000) / 100) };
    };
    r.put<{ Body: { episodeIds: number[]; monitored: boolean } }>('/episode/monitor', async (req) => {
      for (const id of req.body.episodeIds) {
        const hit = seasonOfEpisode(id);
        if (!hit) continue;
        arrKnown.add(`tv-${hit.t.tmdbId}`);
        if (req.body.monitored) unmonitored.delete(`tv-${hit.t.tmdbId}-${hit.season}`);
        else unmonitored.add(`tv-${hit.t.tmdbId}-${hit.season}`);
      }
      return [];
    });
    r.put<{ Body: { seriesIds: number[]; monitored: boolean } }>('/series/editor', async (req) => {
      for (const n of req.body.seriesIds) {
        const t = TITLES.find((x) => x.type === 'tv' && x.n === n);
        if (!t) continue;
        if (req.body.monitored) unmonitored.delete(`tv-${t.tmdbId}`);
        else unmonitored.add(`tv-${t.tmdbId}`);
      }
      return [];
    });
    r.delete<{ Params: { id: string }; Querystring: Q }>('/series/:id', async (req, reply) => {
      const t = TITLES.find((x) => x.type === 'tv' && x.n === Number(req.params.id));
      if (!t) return reply.code(404).send();
      if (req.query.deleteFiles === 'true') forgetTitle(t);
      arrKnown.delete(`tv-${t.tmdbId}`);
      for (const key of [...unmonitored]) if (key === `tv-${t.tmdbId}` || key.startsWith(`tv-${t.tmdbId}-`)) unmonitored.delete(key);
      return reply.code(200).send({});
    });
    r.delete<{ Body: { episodeFileIds: number[] } }>('/episodefile/bulk', async (req) => {
      for (const id of req.body.episodeFileIds) {
        const t = TITLES.find((x) => x.type === 'tv' && x.n === Math.floor(id / 100));
        if (!t) continue;
        library.delete(`tv-${t.tmdbId}-${id % 100}`);
        arrKnown.add(`tv-${t.tmdbId}`);
      }
      return {};
    });
    r.post<{ Body: { name: string; seriesId?: number; seasonNumber?: number; episodeIds?: number[] } }>('/command', async (req, reply) => {
      // EpisodeSearch: the episodes' season (ids are series·10000 + season·100 + episode).
      const first = req.body.episodeIds?.[0];
      const t = TITLES.find((x) => x.type === 'tv' && x.n === (first ? Math.floor(first / 10000) : req.body.seriesId));
      const season = first ? Math.floor((first % 10000) / 100) : req.body.seasonNumber;
      if (t && season && !library.has(`tv-${t.tmdbId}-${season}`) && !downloads.some((d) => d.title === t && d.season === season)) startDownload(t, { season, durationMs: 70_000 });
      return reply.code(201).send({ id: newId(), name: req.body.name, status: 'queued' });
    });
    r.get('/rootfolder', async () => [{ id: 1, path: '/data/tv', accessible: true, freeSpace: freeSpace() }]);
    r.get('/diskspace', async () => [
      { path: '/', label: 'overlay', freeSpace: 21 * GB, totalSpace: 58 * GB },
      { path: '/data', label: 'media', freeSpace: freeSpace(), totalSpace: DISK },
    ]);
    r.get<{ Querystring: Q }>('/release', async (req) => {
      await sleep(1500);
      if (req.query.episodeId) {
        const id = Number(req.query.episodeId);
        const t = TITLES.find((x) => x.type === 'tv' && x.n === Math.floor(id / 10000));
        const season = Math.floor((id % 10000) / 100);
        const episode = id % 100;
        return t ? fakeReleases(t, season, episode) : [];
      }
      const t = TITLES.find((x) => x.type === 'tv' && x.n === Number(req.query.seriesId));
      return t ? fakeReleases(t, Number(req.query.seasonNumber ?? 1)) : [];
    });
    r.post<{ Body: { guid: string } }>('/release', async (req, reply) => {
      const hit = releaseCache.get(req.body.guid);
      if (!hit) return reply.code(404).send({ message: "Couldn't find requested release in cache" });
      startDownload(hit.title, { season: hit.season, release: hit.release, quality: hit.quality, languages: hit.languages, durationMs: 60_000, interactive: true });
      return {};
    });
  },
  { prefix: '/sonarr/api/v3' },
);

// ======================================================================
// Bazarr
// ======================================================================

const subsDto = (set?: Set<string>) => [...(set ?? [])].map((code2) => ({ code2, name: code2, forced: false, hi: false, path: `/media/${code2}.srt` }));
const episodeKey = (t: Title, s: number, e: number) => `ep-${t.tmdbId}-${s}-${e}`;

void app.register(
  async (b) => {
    b.addHook('onRequest', async (req, reply) => {
      if (req.headers['x-api-key'] !== API_KEY) return reply.code(401).send({ message: 'Unauthorized' });
    });
    b.get('/system/status', async () => ({ data: { bazarr_version: '1.5.3-mock' } }));
    b.get('/system/languages', async () => ['en', 'es', 'fr', 'de', 'it', 'pt'].map((code2) => ({ code2, name: code2, enabled: true })));
    b.get<{ Querystring: Record<string, string | string[]> }>('/movies', async (req) => {
      const idsWanted = [req.query['radarrid[]']].flat().map(Number);
      return {
        data: TITLES.filter((t) => t.type === 'movie' && inLibrary(t) && idsWanted.includes(t.n)).map((t) => ({
          radarrId: t.n, title: t.title, subtitles: subsDto(subtitles.get(`movie-${t.tmdbId}`)),
        })),
      };
    });
    b.get<{ Querystring: Record<string, string | string[]> }>('/episodes', async (req) => {
      const t = TITLES.find((x) => x.type === 'tv' && x.n === Number([req.query['seriesid[]']].flat()[0]));
      if (!t) return { data: [] };
      return {
        data: librarySeasons(t).flatMap((s) =>
          Array.from({ length: EPISODES_PER_SEASON }, (_, i) => ({
            sonarrSeriesId: t.n, sonarrEpisodeId: t.n * 10000 + s * 100 + i + 1, season: s, episode: i + 1,
            title: episodeName(t, s, i + 1), subtitles: subsDto(subtitles.get(episodeKey(t, s, i + 1)) ?? new Set(['en'])),
          })),
        ),
      };
    });
    const addSub = async (key: string, language: string) => {
      await sleep(1200);
      if (language === 'ja') return; // pretend nothing exists in Japanese
      const set = subtitles.get(key) ?? new Set(key.startsWith('ep-') ? ['en'] : []);
      set.add(language);
      subtitles.set(key, set);
    };
    b.patch<{ Querystring: Q }>('/movies/subtitles', async (req, reply) => {
      const t = TITLES.find((x) => x.type === 'movie' && x.n === Number(req.query.radarrid));
      if (!t) return reply.code(404).send('Movie not found');
      await addSub(`movie-${t.tmdbId}`, req.query.language ?? 'en');
      return reply.code(204).send();
    });
    b.patch<{ Querystring: Q }>('/episodes/subtitles', async (req, reply) => {
      const t = TITLES.find((x) => x.type === 'tv' && x.n === Number(req.query.seriesid));
      const epId = Number(req.query.episodeid);
      if (!t) return reply.code(404).send('Series not found');
      await addSub(episodeKey(t, Math.floor((epId % 10000) / 100), epId % 100), req.query.language ?? 'en');
      return reply.code(204).send();
    });
  },
  { prefix: '/bazarr/api' },
);

// ======================================================================
// qBittorrent
// ======================================================================

// qBittorrent's queue: torrents in the order they were added, then those sent to the back (in
// the order they were sent).
const qbitQueue: string[] = [];
const queuePosition = (hash: string) => {
  const unmoved = downloads.map((d) => d.downloadId.toLowerCase()).filter((h) => !qbitQueue.includes(h));
  const at = qbitQueue.indexOf(hash);
  return at >= 0 ? unmoved.length + at + 1 : unmoved.indexOf(hash) + 1;
};
void app.register(
  async (q) => {
    q.post('/auth/login', async (_req, reply) => reply.header('set-cookie', 'SID=mock; HttpOnly; path=/').send('Ok.'));
    q.get('/app/version', async () => 'v5.1.2');
    q.get('/torrents/info', async () =>
      downloads.map((d) => {
        const progress = progressOf(d);
        const stalled = d.stalledAt !== undefined;
        return {
          hash: d.downloadId.toLowerCase(), name: d.release, progress, num_seeds: stalled ? 0 : 23, dl_limit: d.limit ?? 0,
          dlspeed: stalled || progress >= 1 ? 0 : Math.round((d.size / (d.durationMs / 1000)) * (0.85 + Math.random() * 0.3)),
          eta: stalled ? 8_640_000 : Math.max(0, Math.round(((1 - progress) * d.durationMs) / 1000)),
          state: d.stopped ? 'stoppedDL' : stalled ? 'stalledDL' : progress >= 1 ? 'uploading' : 'downloading',
          seq_dl: Boolean(d.seq), priority: queuePosition(d.downloadId.toLowerCase()),
        };
      }),
    );
    // Like qBittorrent 5 (4 said pause/resume): hashes separated by |.
    const hashesOf = (body: unknown) => new Set(String(new URLSearchParams(String(body ?? '')).get('hashes') ?? '').toLowerCase().split('|'));
    const formOf = (body: unknown) => new URLSearchParams(String(body ?? ''));
    q.post('/torrents/stop', async (req) => {
      const hashes = hashesOf(req.body);
      for (const d of downloads) if (hashes.has(d.downloadId.toLowerCase()) && !d.stopped) Object.assign(d, { stalledAt: progressOf(d), stopped: true });
      return 'Ok.';
    });
    q.post('/torrents/start', async (req) => {
      const hashes = hashesOf(req.body);
      for (const d of downloads) {
        if (!hashes.has(d.downloadId.toLowerCase()) || !d.stopped) continue;
        Object.assign(d, { startedAt: Date.now() - (d.stalledAt ?? 0) * d.durationMs, stalledAt: undefined, stopped: false });
      }
      return 'Ok.';
    });
    q.post('/torrents/setDownloadLimit', async (req) => {
      const hashes = hashesOf(req.body);
      const limit = Number(formOf(req.body).get('limit') ?? 0);
      for (const d of downloads) if (hashes.has(d.downloadId.toLowerCase())) d.limit = limit;
      return 'Ok.';
    });
    // To the back of the queue, in the order given.
    q.post('/torrents/bottomPrio', async (req) => {
      const given = String(formOf(req.body).get('hashes') ?? '').toLowerCase().split('|').filter(Boolean);
      for (const hash of given) {
        const at = qbitQueue.indexOf(hash);
        if (at >= 0) qbitQueue.splice(at, 1);
        qbitQueue.push(hash);
      }
      return 'Ok.';
    });
    q.post('/torrents/toggleSequentialDownload', async (req) => {
      const hashes = hashesOf(req.body);
      for (const d of downloads) if (hashes.has(d.downloadId.toLowerCase())) d.seq = !d.seq;
      return 'Ok.';
    });
  },
  { prefix: '/qbit/api/v2' },
);

// ======================================================================
// MDBList (aggregated scores: Letterboxd, Metacritic…)
// ======================================================================

app.get<{ Querystring: Q }>('/mdblist/user', async (req, reply) =>
  req.query.apikey === API_KEY ? { api_requests: 1000, api_requests_count: 12, user_id: 1 } : reply.code(403).send({ error: 'Invalid API key' }),
);
app.get<{ Params: { type: string; id: string }; Querystring: Q }>('/mdblist/tmdb/:type/:id', async (req, reply) => {
  if (req.query.apikey !== API_KEY) return reply.code(403).send({ error: 'Invalid API key' });
  const t = titleByTmdb.get(`${req.params.type === 'show' ? 'tv' : 'movie'}-${req.params.id}`);
  if (!t) return reply.code(404).send({ error: 'Not found' });
  return {
    title: t.title,
    year: t.year,
    ratings: [
      { source: 'letterboxd', value: Math.round((2.6 + ((t.n * 13) % 17) / 10) * 10) / 10, score: null, votes: 4000 * t.n },
      { source: 'metacritic', value: 45 + ((t.n * 29) % 50), score: null, votes: 40 },
    ],
  };
});

// ======================================================================
// Trakt (the server's one linked account). Client ID "mock", secret "mock".
// A device code is "entered" by itself after three checks.
// ======================================================================

const traktState = {
  codes: new Map<string, { userCode: string; checks: number; used: boolean }>(),
  access: new Set<string>(),
  refresh: new Set<string>(),
  movies: new Map<number, string>(),
  episodes: new Map<string, string>(),
  scrobbles: [] as Array<{ action: string; progress: number; what: string; at: string }>,
};
const traktIds = (t: Title) => ({ trakt: t.n, slug: t.title.toLowerCase().replace(/\W+/g, '-'), tmdb: t.tmdbId, imdb: `tt${(t.type === 'movie' ? 9000000 : 9100000) + t.n}`, ...(t.type === 'tv' ? { tvdb: t.tvdbId } : {}) });
const traktTokens = () => {
  const access = crypto.randomBytes(16).toString('hex');
  const refresh = crypto.randomBytes(16).toString('hex');
  traktState.access.add(access);
  traktState.refresh.add(refresh);
  return { access_token: access, refresh_token: refresh, expires_in: 86400, created_at: Math.floor(Date.now() / 1000), token_type: 'bearer', scope: 'public' };
};
type TraktBody = Record<string, unknown> & { client_id?: string; client_secret?: string };
type TraktShowBody = { ids: { tmdb?: number; tvdb?: number }; seasons?: Array<{ number: number; episodes: Array<{ number: number; watched_at?: string }> }> };
const traktShow = (ids: { tmdb?: number; tvdb?: number }) => TITLES.find((t) => t.type === 'tv' && (t.tmdbId === ids.tmdb || t.tvdbId === ids.tvdb));

void app.register(
  async (tr) => {
    tr.addHook('preHandler', async (req, reply) => {
      const body = (req.body ?? {}) as TraktBody;
      if (req.url.includes('/oauth/')) {
        if (body.client_id !== API_KEY) return reply.code(401).send({ error: 'invalid_client', error_description: 'Client authentication failed' });
        if (!req.url.includes('/device/code') && body.client_secret !== API_KEY) return reply.code(401).send({ error: 'invalid_client', error_description: 'Client authentication failed' });
        return;
      }
      if (req.headers['trakt-api-key'] !== API_KEY) return reply.code(403).send({ error: 'Invalid API key or unapproved app' });
      if (req.url.includes('/trending')) return;
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (!traktState.access.has(token)) return reply.code(401).send({ error: 'invalid_token' });
    });
    tr.get('/movies/trending', async () => TITLES.filter((t) => t.type === 'movie').slice(0, 1).map((t) => ({ watchers: 3, movie: { title: t.title, year: t.year, ids: traktIds(t) } })));

    tr.post('/oauth/device/code', async () => {
      const deviceCode = crypto.randomBytes(16).toString('hex');
      const userCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      traktState.codes.set(deviceCode, { userCode, checks: 0, used: false });
      return { device_code: deviceCode, user_code: userCode, verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 1 };
    });
    tr.post<{ Body: TraktBody & { code?: string } }>('/oauth/device/token', async (req, reply) => {
      const entry = traktState.codes.get(req.body.code ?? '');
      if (!entry) return reply.code(404).send();
      if (entry.used) return reply.code(409).send();
      if (++entry.checks < 3) return reply.code(400).send();
      entry.used = true;
      return traktTokens();
    });
    tr.post<{ Body: TraktBody & { refresh_token?: string } }>('/oauth/token', async (req, reply) => {
      if (!traktState.refresh.delete(req.body.refresh_token ?? '')) return reply.code(400).send({ error: 'invalid_grant', error_description: 'The provided authorization grant is invalid' });
      return traktTokens();
    });
    tr.post<{ Body: TraktBody & { token?: string } }>('/oauth/revoke', async (req) => {
      traktState.access.delete(req.body.token ?? '');
      return {};
    });

    tr.get('/users/settings', async () => ({ user: { username: 'netfish-mock', name: 'Netfish Mock' } }));
    const recommend = (type: 'movie' | 'tv') => async () =>
      shuffle(
        TITLES.filter((t) => t.type === type && !(type === 'movie' ? traktState.movies.has(t.tmdbId) : [...traktState.episodes.keys()].some((k) => k.startsWith(`${t.tmdbId}:`)))),
        `trakt-${type}`,
      )
        .slice(0, 10)
        .map((t) => ({ title: t.title, year: t.year, ids: traktIds(t) }));
    tr.get('/recommendations/movies', recommend('movie'));
    tr.get('/recommendations/shows', recommend('tv'));

    tr.post<{ Params: { action: string }; Body: { progress?: number; movie?: { ids: { tmdb?: number } }; show?: { ids: { tmdb?: number; tvdb?: number } }; episode?: { season: number; number: number } } }>(
      '/scrobble/:action',
      async (req, reply) => {
        const { progress = 0, movie, show, episode } = req.body;
        const t = movie ? titleByTmdb.get(`movie-${movie.ids.tmdb}`) : show ? traktShow(show.ids) : undefined;
        if (!t || (show && !episode)) return reply.code(404).send();
        const what = movie ? t.title : `${t.title} S${episode!.season}E${episode!.number}`;
        const action = req.params.action === 'stop' && progress < 80 ? 'pause' : req.params.action === 'stop' ? 'scrobble' : req.params.action;
        traktState.scrobbles.push({ action, progress, what, at: new Date().toISOString() });
        if (action === 'scrobble') {
          if (movie) traktState.movies.set(t.tmdbId, new Date().toISOString());
          else traktState.episodes.set(`${t.tmdbId}:${episode!.season}:${episode!.number}`, new Date().toISOString());
        }
        return reply.code(201).send({ id: traktState.scrobbles.length, action, progress, ...(movie ? { movie: { title: t.title, ids: traktIds(t) } } : { show: { title: t.title, ids: traktIds(t) }, episode }) });
      },
    );

    tr.get('/sync/watched/movies', async () =>
      [...traktState.movies].map(([tmdb, at]) => ({ plays: 1, last_watched_at: at, movie: { title: titleByTmdb.get(`movie-${tmdb}`)?.title, ids: traktIds(titleByTmdb.get(`movie-${tmdb}`)!) } })),
    );
    tr.get('/sync/watched/shows', async () => {
      const shows = new Map<number, Map<number, number[]>>();
      for (const key of traktState.episodes.keys()) {
        const [tmdb, season, number] = key.split(':').map(Number);
        const seasons = shows.get(tmdb) ?? new Map<number, number[]>();
        shows.set(tmdb, seasons);
        seasons.set(season, [...(seasons.get(season) ?? []), number]);
      }
      return [...shows].map(([tmdb, seasons]) => ({
        show: { title: titleByTmdb.get(`tv-${tmdb}`)?.title, ids: traktIds(titleByTmdb.get(`tv-${tmdb}`)!) },
        seasons: [...seasons].map(([number, eps]) => ({ number, episodes: eps.map((n) => ({ number: n, plays: 1 })) })),
      }));
    });
    tr.post<{ Body: { movies?: Array<{ ids: { tmdb?: number }; watched_at?: string }>; shows?: TraktShowBody[] } }>('/sync/history', async (req, reply) => {
      const result = { added: { movies: 0, episodes: 0 }, not_found: { movies: [] as unknown[], shows: [] as unknown[], seasons: [], episodes: [] } };
      for (const m of req.body.movies ?? []) {
        if (!titleByTmdb.has(`movie-${m.ids.tmdb}`)) result.not_found.movies.push(m);
        else {
          traktState.movies.set(m.ids.tmdb!, m.watched_at ?? new Date().toISOString());
          result.added.movies++;
        }
      }
      for (const show of req.body.shows ?? []) {
        const t = traktShow(show.ids);
        if (!t) {
          result.not_found.shows.push({ ids: show.ids });
          continue;
        }
        for (const season of show.seasons ?? []) {
          for (const ep of season.episodes) {
            traktState.episodes.set(`${t.tmdbId}:${season.number}:${ep.number}`, ep.watched_at ?? new Date().toISOString());
            result.added.episodes++;
          }
        }
      }
      return reply.code(201).send(result);
    });
  },
  { prefix: '/trakt' },
);
// GitHub's latest Netfish release (the server's "a newer one is out" check).
app.get('/github/repos/ravifrancesco/netfish/releases/latest', async () => ({
  tag_name: 'v0.7.4', html_url: 'https://github.com/ravifrancesco/netfish/releases/tag/v0.7.4', draft: false, prerelease: false,
}));

// What reached the mock Trakt, for checking scrobbles by hand.
app.get('/trakt-state', async () => ({ ...traktState, codes: undefined, access: undefined, refresh: undefined, movies: [...traktState.movies], episodes: [...traktState.episodes] }));

// ======================================================================
// SuggestArr (its public API, v1): what it requested for whom, its jobs and their runs
// ======================================================================

interface SarrMockRequest {
  tmdb_id: string;
  media_type: 'movie' | 'tv';
  title: string;
  source_media_id: string | null;
  source_origin: string | null;
  requested_at: string;
  requested_by: 'SuggestArr';
  media_user: { id: string } | null;
  metadata: { poster_path: string | null; rating: number | null };
}
interface SarrMockRun {
  id: number;
  job_id: number;
  job_name: string;
  status: 'running' | 'completed';
  trigger_source: string | null;
  results_count: number;
  requested_count: number;
  error_message: null;
  started_at: string;
  finished_at: string | null;
  endsAt: number;
}
const sarrJobs = [
  { id: 1, name: 'Recommendations', job_type: 'recommendation', enabled: true, media_type: 'both', schedule_type: 'preset', schedule_value: 'daily', user_ids: [] },
  { id: 2, name: 'Weekend discover', job_type: 'discover', enabled: false, media_type: 'movie', schedule_type: 'cron', schedule_value: '0 4 * * 6', user_ids: [] },
];
const sarr = { requests: [] as SarrMockRequest[], runs: [] as SarrMockRun[], nextRun: 1 };
const titleN = (n: number) => TITLES.find((t) => t.n === n)!;
/** Like SuggestArr's database (UTC, no zone) and its run log (its server's clock, no zone). */
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const localTime = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
/**
 * SuggestArr asks Seerr as the person themselves (its "user" identity mode). `seerr: false` when Seerr
 * has the request already. The seeded ones are titles the library has or someone asked for already,
 * so they don't change what Netfish's own new titles for channels can pick.
 */
function sarrRequest(n: number, because: number | string, user: MockUser | null, agoMs: number, opts: { seerr?: boolean } = {}) {
  const t = titleN(n);
  const source = typeof because === 'number' ? String(titleN(because).tmdbId) : because;
  sarr.requests.unshift({
    tmdb_id: String(t.tmdbId), media_type: t.type, title: t.title, source_media_id: source, source_origin: null, requested_at: sqlTime(Date.now() - agoMs),
    requested_by: 'SuggestArr', media_user: user && { id: user.id }, metadata: { poster_path: `/poster-${t.type}-${t.tmdbId}.jpg`, rating: 7.2 },
  });
  if (opts.seerr === false) return;
  requests.push({ id: newId(), type: t.type, tmdbId: t.tmdbId, seasons: t.type === 'tv' ? [1] : [], status: inLibrary(t) ? 5 : 2, seerrUserId: (user ?? USERS[0]).seerrId, createdAt: new Date(Date.now() - agoMs).toISOString() });
}
function seedSuggestarr() {
  const [admin, , sam] = USERS;
  sarrRequest(16, 'discover', null, 6 * DAY_MS, { seerr: false }); // Tidal Lock (demo asked for it too)
  sarrRequest(109, 104, admin, 5 * DAY_MS); // Salt Marsh, here now, because admin watched Port Authority
  sarrRequest(19, 5, admin, 4 * DAY_MS); // Reef Break, here now, because The Last Lighthouse
  sarrRequest(20, 10, admin, DAY_MS, { seerr: false }); // Bioluminescent (admin's request, downloading), because Paper Boats
  sarrRequest(15, 3, sam, 3 * DAY_MS); // Shoal, here now, because sam watched Night Tide
  sarrRequest(106, 102, sam, 2 * DAY_MS); // Harbor Lights, here now, because Fishmongers
  sarr.runs.unshift({ id: sarr.nextRun++, job_id: 1, job_name: 'Recommendations', status: 'completed', trigger_source: null, results_count: 18, requested_count: 2, error_message: null, started_at: localTime(Date.now() - 9 * 3600_000), finished_at: localTime(Date.now() - 9 * 3600_000 + 95_000), endsAt: 0 });
}
/** A run takes a few seconds; the first one asked for here finds Sunken Cities for admin. */
function settleRuns() {
  for (const run of sarr.runs.filter((r) => r.status === 'running' && Date.now() >= r.endsAt)) {
    const found = !sarr.requests.some((r) => r.tmdb_id === String(titleN(107).tmdbId));
    if (found) sarrRequest(107, 104, USERS[0], 0);
    Object.assign(run, { status: 'completed', results_count: 14, requested_count: found ? 1 : 0, finished_at: localTime(Date.now()) });
  }
}
void app.register(
  async (sa) => {
    sa.addHook('preHandler', async (req, reply) => {
      if (req.url.endsWith('/status')) return;
      if (req.headers['x-api-key'] !== API_KEY) return reply.code(401).send({ error: 'Invalid or missing API key' });
    });
    sa.get('/status', async () => ({ data: { service: 'SuggestArr', api_version: 'v1', status: 'ok' } }));
    sa.get('/me', async () => ({
      data: { id: 1, username: 'admin', role: 'admin', permissions: { can_manage_ai: true }, authentication: { method: 'api_key', api_key_id: 'mock', api_key_name: 'Netfish' } },
    }));
    sa.get('/jobs', async () => ({ data: sarrJobs, meta: { page: 1, per_page: 50, total: sarrJobs.length, pages: 1 } }));
    sa.get<{ Querystring: { job_id?: string; status?: string; per_page?: string } }>('/runs', async (req) => {
      settleRuns();
      const list = sarr.runs.filter((r) => (!req.query.job_id || r.job_id === Number(req.query.job_id)) && (!req.query.status || r.status === req.query.status));
      const per = Number(req.query.per_page ?? 20);
      return { data: list.slice(0, per).map(({ endsAt: _, ...r }) => r), meta: { page: 1, per_page: per, total: list.length, pages: Math.max(1, Math.ceil(list.length / per)) } };
    });
    sa.post<{ Params: { id: string } }>('/jobs/:id/runs', async (req, reply) => {
      const job = sarrJobs.find((j) => j.id === Number(req.params.id));
      if (!job) return reply.code(404).send({ error: { code: 'not_found', message: 'Job not found' } });
      const run: SarrMockRun = { id: sarr.nextRun++, job_id: job.id, job_name: job.name, status: 'running', trigger_source: 'api', results_count: 0, requested_count: 0, error_message: null, started_at: localTime(Date.now()), finished_at: null, endsAt: Date.now() + 6000 };
      sarr.runs.unshift(run);
      const { endsAt: _, ...data } = run;
      return reply.code(202).header('location', `/api/v1/runs/${run.id}`).send({ data });
    });
    sa.get<{ Querystring: { page?: string; per_page?: string; user_id?: string } }>('/requests', async (req) => {
      settleRuns();
      const per = Math.min(100, Number(req.query.per_page ?? 20));
      const page = Number(req.query.page ?? 1);
      const list = sarr.requests.filter((r) => !req.query.user_id || r.media_user?.id === req.query.user_id).map((r) => ({ id: r.tmdb_id, ...r }));
      return { data: list.slice((page - 1) * per, page * per), meta: { page, per_page: per, total: list.length, pages: Math.max(1, Math.ceil(list.length / per)) } };
    });
  },
  { prefix: '/suggestarr/api/v1' },
);

// ======================================================================
// TMDB-style images
// ======================================================================

app.get<{ Params: { file: string } }>('/img/:size/:file', async (req, reply) => {
  reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=3600');
  const f = decodeURIComponent(req.params.file.replace(/\.jpg$/, ''));
  const [kind, ...rest] = f.split('-');
  if (kind === 'profile') return svg.avatar(rest.join('-'));
  if (kind === 'still') {
    const [tmdb, s, e] = rest.map(Number);
    return svg.still(titleByTmdb.get(`tv-${tmdb}`)?.title ?? '', `S${s} · E${e}`);
  }
  if (kind === 'poster' && rest[0] === 'season') return svg.poster(titleByTmdb.get(`tv-${rest[1]}`)?.title ?? '', `SEASON ${rest[2]}`);
  const t = titleByTmdb.get(`${rest[0]}-${rest[1]}`);
  if (!t) return svg.avatar('?');
  return kind === 'backdrop' ? svg.backdrop(t.title) : svg.poster(t.title, String(t.year));
});

// ======================================================================

seed();
seedSuggestarr();
const mediaReady = ensureMedia();
try {
  SAMPLE_SIZE = fs.statSync(`${MEDIA_DIR}/sample.mp4`).size;
} catch {
  /* no ffmpeg: downloads won't work in the mock */
}
void app.register(fastifyStatic, { root: MEDIA_DIR, serve: false });
app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`[mock] Jellyfin, Seerr, Radarr, Sonarr, Bazarr, qBittorrent, Trakt, SuggestArr on http://127.0.0.1:${PORT}`);
  console.log(`[mock] users: demo/demo, sam/sam, admin/admin · sample video: ${mediaReady ? `${DURATION_SECONDS}s` : 'unavailable'}`);
});
