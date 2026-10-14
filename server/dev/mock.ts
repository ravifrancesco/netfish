/**
 * Local stand-in for the whole Pi stack (Jellyfin, Seerr, Radarr, Sonarr,
 * Bazarr, qBittorrent) so Netfish can be developed and demoed anywhere.
 *
 *   npm run dev:mock      → mock on :7700, Netfish API on :7777, web on :5173
 *   sign in as demo/demo (regular user) or admin/admin
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

function dto(item: Item, userId?: string, full = false): Record<string, unknown> {
  const t = item.title;
  const seriesId = ids.series(t);
  switch (item.kind) {
    case 'movie':
      return {
        Id: item.id, Name: t.title, Type: 'Movie', ProductionYear: t.year, PremiereDate: `${t.year}-06-01T00:00:00.0000000Z`,
        Overview: t.overview, Genres: t.genres, CommunityRating: t.rating, OfficialRating: 'PG-13', RunTimeTicks: RUNTIME_TICKS,
        ProviderIds: { Tmdb: String(t.tmdbId) }, ImageTags: { Primary: 'p1', Thumb: 't1' }, BackdropImageTags: ['b1'],
        DateCreated: date(titleAdded(t)), UserData: userDataDto(userId, item), Taglines: [],
        People: [{ Id: crypto.createHash('md5').update(`p-${t.n}`).digest('hex'), Name: 'Mock Director', Type: 'Director' }],
        ...(full ? { MediaStreams: streamsFor(item), MediaSources: [{ Id: item.id, Container: containerOf(item), Size: SAMPLE_SIZE, Bitrate: 400_000, MediaStreams: streamsFor(item) }] } : {}),
      };
    case 'series':
      return {
        Id: item.id, Name: t.title, Type: 'Series', ProductionYear: t.year, PremiereDate: `${t.year}-01-15T00:00:00.0000000Z`,
        Overview: t.overview, Genres: t.genres, CommunityRating: t.rating, OfficialRating: 'TV-14',
        ProviderIds: { Tmdb: String(t.tmdbId), Tvdb: String(t.tvdbId) }, ImageTags: { Primary: 'p1' }, BackdropImageTags: ['b1'],
        DateCreated: date(titleAdded(t)), UserData: userDataDto(userId, item),
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
      return { Id: u.id, Name: u.name, PrimaryImageTag: 'a1', Policy: { IsAdministrator: u.admin } };
    });
    jf.post('/Sessions/Logout', async (req, reply) => {
      sessions.delete(jfToken(req) ?? '');
      return reply.code(204).send();
    });

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
      if (userId && q.filters?.includes('IsPlayed')) items = items.filter((i) => (dto(i, userId).UserData as { Played?: boolean })?.Played);
      if (userId && q.filters?.includes('IsUnplayed')) items = items.filter((i) => !(dto(i, userId).UserData as { Played?: boolean })?.Played);
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

    jf.get<{ Params: { id: string }; Querystring: Q }>('/Items/:id', async (req, reply) => {
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
      if (!item) return svg.avatar('?');
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

function resultDto(t: Title) {
  const date = `${t.year}-06-01`;
  return {
    id: t.tmdbId, mediaType: t.type, posterPath: img('poster', t), backdropPath: img('backdrop', t), overview: t.overview,
    voteAverage: t.rating, originalLanguage: t.lang, mediaInfo: mediaInfo(t),
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
    return { name, character: i === 0 ? 'The Lead' : `Character ${i + 1}`, profilePath: `/profile-${encodeURIComponent(name)}.jpg`, order: i };
  });

void app.register(
  async (s) => {
    s.addHook('onRequest', async (req, reply) => {
      if (req.url.endsWith('/status')) return; // public, like the real Seerr
      if (req.headers['x-api-key'] !== API_KEY) return reply.code(403).send({ message: 'Invalid API key' });
    });
    s.get('/status', async () => ({ version: '3.2.0-mock' }));
    s.get('/auth/me', async () => ({ id: 1, displayName: 'admin' }));
    s.get<{ Querystring: Q }>('/search', async (req) => page(TITLES.filter((t) => t.title.toLowerCase().includes((req.query.query ?? '').toLowerCase()))));
    s.get('/discover/trending', async () => page(shuffle(TITLES.filter((t) => t.year >= 2022), new Date().toDateString()).slice(0, 20)));
    s.get('/discover/movies', async () => page(TITLES.filter((t) => t.type === 'movie' && t.year < 2026).sort((a, b) => b.rating - a.rating)));
    s.get('/discover/tv', async () => page(TITLES.filter((t) => t.type === 'tv').sort((a, b) => b.rating - a.rating)));
    s.get('/discover/movies/upcoming', async () => page(TITLES.filter((t) => t.type === 'movie' && t.year >= 2026 && !inLibrary(t))));
    s.get('/discover/tv/upcoming', async () => page(TITLES.filter((t) => t.type === 'tv' && t.year >= 2026)));

    const detail = (type: 'movie' | 'tv') => async (req: FastifyRequest<{ Params: { id: string } }>, reply: import('fastify').FastifyReply) => {
      const t = titleByTmdb.get(`${type}-${req.params.id}`);
      if (!t) return reply.code(404).send({ message: 'Unable to retrieve' });
      const credits = { cast: castFor(t), crew: [{ name: `${LAST[t.n % LAST.length]} Director`, job: 'Director' }] };
      const common = {
        id: t.tmdbId, overview: t.overview, posterPath: img('poster', t), backdropPath: img('backdrop', t), voteAverage: t.rating,
        genres: t.genres.map((name, i) => ({ id: i, name })), originalLanguage: t.lang, credits, mediaInfo: mediaInfo(t),
        // Blender's open-licensed Big Buck Bunny stands in for every trailer.
        relatedVideos: [{ site: 'YouTube', key: 'aqz-KE-bpKQ', type: 'Trailer', name: 'Official Trailer' }],
        tagline: t.n % 3 === 0 ? 'The ocean keeps its secrets.' : '',
      };
      if (type === 'movie') {
        return { ...common, title: t.title, originalTitle: t.title, releaseDate: `${t.year}-06-01`, runtime: 104 + (t.n % 30), releases: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] }, externalIds: { imdbId: `tt${9000000 + t.n}` } };
      }
      return {
        ...common, name: t.title, originalName: t.title, firstAirDate: `${t.year}-01-15`, episodeRunTime: [48], numberOfSeasons: t.seasons,
        createdBy: [{ name: `${FIRST[t.n % FIRST.length]} ${LAST[(t.n + 3) % LAST.length]}` }], networks: [{ name: 'Mock+' }],
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
      if (t.type === 'movie') startDownload(t, { durationMs: 75_000 });
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
        status: importing ? 'completed' : 'downloading', trackedDownloadStatus: d.stalledAt !== undefined ? 'warning' : 'ok',
        trackedDownloadState: importing ? 'importing' : 'downloading',
        statusMessages: d.stalledAt !== undefined ? [{ title: d.release, messages: ['The download is stalled with no connections'] }] : [],
        downloadId: d.downloadId, protocol: 'torrent', title: d.release, quality: { quality: { name: d.quality } }, languages: langList(d.languages),
      };
      const t = d.title;
      if (type === 'movie') return [{ ...base, id: d.id, movieId: t.n, movie: { id: t.n, title: t.title, tmdbId: t.tmdbId, year: t.year, images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }] } }];
      return Array.from({ length: EPISODES_PER_SEASON }, (_, i) => ({
        ...base, id: d.id * 100 + i, seriesId: t.n, episodeId: t.n * 1000 + i, seasonNumber: d.season,
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

const arrAuth = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
  if (req.headers['x-api-key'] !== API_KEY) return reply.code(401).send({ message: 'Unauthorized' });
};
const managed = (t: Title) => inLibrary(t) || requests.some((r) => r.type === t.type && r.tmdbId === t.tmdbId) || downloads.some((d) => d.title === t);
const fileDto = (t: Title, season?: number) => ({
  id: t.n * 100 + (season ?? 0), seasonNumber: season, quality: { quality: { name: 'Bluray-1080p', resolution: 1080 } },
  languages: langList(audioOf(t).map((l) => ISO3_NAME[l] ?? 'English')), customFormatScore: 0,
});

void app.register(
  async (r) => {
    r.addHook('onRequest', arrAuth);
    r.get('/system/status', async () => ({ version: '6.0.4-mock', appName: 'Radarr' }));
    r.get('/queue', async () => ({ page: 1, totalRecords: 0, records: queueRecords('movie') }));
    r.get<{ Querystring: Q }>('/movie', async (req) =>
      TITLES.filter((t) => t.type === 'movie' && managed(t) && (!req.query.tmdbId || t.tmdbId === Number(req.query.tmdbId))).map((t) => ({
        id: t.n, title: t.title, tmdbId: t.tmdbId, hasFile: inLibrary(t), images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }],
        movieFile: inLibrary(t) ? fileDto(t) : undefined,
      })),
    );
    r.get<{ Querystring: Q }>('/release', async (req) => {
      await sleep(1500);
      const t = TITLES.find((x) => x.type === 'movie' && x.n === Number(req.query.movieId));
      return t ? fakeReleases(t) : [];
    });
    r.post<{ Body: { guid: string } }>('/release', async (req, reply) => {
      const hit = releaseCache.get(req.body.guid);
      if (!hit) return reply.code(404).send({ message: "Couldn't find requested release in cache, cache timeout probably expired." });
      startDownload(hit.title, { release: hit.release, quality: hit.quality, languages: hit.languages, durationMs: 60_000 });
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
    r.get<{ Querystring: Q }>('/series', async (req) =>
      TITLES.filter((t) => t.type === 'tv' && managed(t) && (!req.query.tvdbId || t.tvdbId === Number(req.query.tvdbId))).map((t) => ({
        id: t.n, title: t.title, tvdbId: t.tvdbId, tmdbId: t.tmdbId, images: [{ coverType: 'poster', remoteUrl: posterUrl(t) }],
      })),
    );
    r.get<{ Querystring: Q }>('/episodefile', async (req) => {
      const t = TITLES.find((x) => x.type === 'tv' && x.n === Number(req.query.seriesId));
      return t ? librarySeasons(t).map((s) => fileDto(t, s)) : [];
    });
    r.get<{ Querystring: Q }>('/episode', async (req) => {
      const n = Number(req.query.seriesId);
      const season = Number(req.query.seasonNumber ?? 1);
      return Array.from({ length: EPISODES_PER_SEASON }, (_, i) => ({ id: n * 10000 + season * 100 + i + 1, seasonNumber: season, episodeNumber: i + 1 }));
    });
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
      startDownload(hit.title, { season: hit.season, release: hit.release, quality: hit.quality, languages: hit.languages, durationMs: 60_000 });
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

void app.register(
  async (q) => {
    q.post('/auth/login', async (_req, reply) => reply.header('set-cookie', 'SID=mock; HttpOnly; path=/').send('Ok.'));
    q.get('/app/version', async () => 'v5.1.2');
    q.get('/torrents/info', async () =>
      downloads.map((d) => {
        const progress = progressOf(d);
        const stalled = d.stalledAt !== undefined;
        return {
          hash: d.downloadId.toLowerCase(), name: d.release, progress, num_seeds: stalled ? 0 : 23,
          dlspeed: stalled || progress >= 1 ? 0 : Math.round((d.size / (d.durationMs / 1000)) * (0.85 + Math.random() * 0.3)),
          eta: stalled ? 8_640_000 : Math.max(0, Math.round(((1 - progress) * d.durationMs) / 1000)),
          state: stalled ? 'stalledDL' : progress >= 1 ? 'uploading' : 'downloading',
        };
      }),
    );
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
const mediaReady = ensureMedia();
try {
  SAMPLE_SIZE = fs.statSync(`${MEDIA_DIR}/sample.mp4`).size;
} catch {
  /* no ffmpeg: downloads won't work in the mock */
}
void app.register(fastifyStatic, { root: MEDIA_DIR, serve: false });
app.listen({ port: PORT, host: '127.0.0.1' }).then(() => {
  console.log(`[mock] Jellyfin, Seerr, Radarr, Sonarr, Bazarr, qBittorrent on http://127.0.0.1:${PORT}`);
  console.log(`[mock] users: demo/demo, admin/admin · sample video: ${mediaReady ? `${DURATION_SECONDS}s` : 'unavailable'}`);
});
