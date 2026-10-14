import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AppConfig,
  CreateRequest,
  GrabRequest,
  LoginRequest,
  MediaType,
  PlaybackRequest,
  ProgressReport,
  ReleaseSearch,
  ServerSettings,
  ServiceConnectionUpdate,
  SubtitleRequest,
  TraktStatus,
  User,
} from '@netfish/shared';
import {
  SESSION_COOKIE,
  forgetSession,
  rememberSession,
  requireAdmin,
  requireUser,
  toSessionUser,
  tokenFrom,
  userOf,
  type SessionUser,
} from './auth';
import { config, has } from './config';
import { getSettings, updateSettings } from './settings';
import { storageFix, storageWritable } from './lib/storage';
import { SETUP_CODE, listConnections, resetConnection, testConnection, updateConnection } from './connections';
import { jellyfin } from './clients/jellyfin';
import { settle } from './lib/async';
import { publicLanguages } from './lib/languages';
import { HttpError, UpstreamError } from './lib/upstream';
import { discoverPage, libraryPage, search, serviceStatus } from './services/browse';
import { allDownloads } from './services/downloads';
import { buildHome } from './services/home';
import { titleRatings } from './services/ratings';
import { grabRelease, grabbedKeys, searchReleases } from './services/releases';
import { jobsFor, requestSubtitles } from './services/subtitles';
import { offlineInfo, playInfo, reportProgress, startPlayback } from './services/playback';
import { personDetail } from './services/people';
import { createRequest, listRequests, myRequestKeys } from './services/requests';
import { scrobble, setScrobble, startImport, startLink, traktStatus, unlink } from './services/trakt';
import { jellyfinDetail, jellyfinSeason, movieDetail, seasonDetail, tvDetail } from './services/titles';
import { t } from './lib/i18n';

const publicUser = ({ token: _token, canDownload: _canDownload, ...user }: SessionUser): User => user;

function appConfig(): AppConfig {
  const arr = has.radarr() || has.sonarr();
  return {
    name: 'netfish',
    version: config.version,
    jellyfinConfigured: has.jellyfin(),
    setupRequired: !has.jellyfin(),
    storageProblem: storageWritable() ? undefined : storageFix(),
    features: {
      discover: has.seerr(),
      requests: has.seerr(),
      downloads: arr,
      versions: arr,
      subtitles: has.bazarr(),
    },
  };
}

type TitleParams = { type: string; id: string };

function mediaTitle(req: FastifyRequest<{ Params: TitleParams }>): { mediaType: MediaType; tmdbId: number } {
  const { type, id } = req.params;
  const tmdbId = Number(id);
  if ((type !== 'movie' && type !== 'tv') || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new HttpError(400, 'Expected /title/movie/<tmdbId> or /title/tv/<tmdbId>');
  }
  return { mediaType: type, tmdbId };
}

const clean = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, fallback: number, min = 0, max = 1000) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export async function apiRoutes(app: FastifyInstance) {
  // ---------- Public ----------
  // Open to any page: TV apps check the address from their own start page before opening Netfish.
  app.get('/health', async (_req, reply) => {
    reply.header('access-control-allow-origin', '*');
    return { ok: true, name: 'netfish', version: config.version };
  });
  app.get('/config', async () => appConfig());

  // Nobody can sign in until Netfish knows where Jellyfin is, so this one setting can be
  // made without an account: freely on first run, and later only with the setup code
  // from the container log (in case a wrong address locks everyone out).
  app.post<{ Body: { url?: string; code?: string } }>('/setup/jellyfin', async (req) => {
    const code = clean(req.body?.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (has.jellyfin() && code !== SETUP_CODE) {
      throw new HttpError(403, code ? t("That setup code isn't right") : t('Netfish is already set up. Admins can change this in Settings → Connections.'));
    }
    const test = await testConnection('jellyfin', { url: req.body?.url ?? '' });
    if (!test.ok) throw new HttpError(400, test.error ?? t("Couldn't reach Jellyfin at that address"));
    updateConnection('jellyfin', { url: req.body?.url ?? '' });
    return test;
  });

  app.post<{ Body: Partial<LoginRequest> & { returnToken?: boolean } }>('/auth/login', async (req, reply) => {
    const username = clean(req.body?.username, 200);
    if (!username) throw new HttpError(400, t('Username is required'));
    const device = { id: clean(req.body?.deviceId, 64) || randomUUID(), name: clean(req.body?.deviceName, 64) || 'Netfish' };
    let result;
    try {
      result = await jellyfin.authenticate(username, typeof req.body?.password === 'string' ? req.body.password : '', device);
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 401 || err.status === 400)) {
        throw new HttpError(401, t('Wrong username or password'));
      }
      throw err;
    }
    const user = toSessionUser(result.User, result.AccessToken);
    rememberSession(user);
    reply.setCookie(SESSION_COOKIE, result.AccessToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 60 * 60 * 24 * 400,
    });
    return { user: publicUser(user), token: req.body?.returnToken ? result.AccessToken : undefined };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = tokenFrom(req);
    if (token) {
      await settle(jellyfin.logout(token), undefined);
      forgetSession(token);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- Signed in ----------
  await app.register(async (api) => {
    api.addHook('preHandler', requireUser);

    api.get('/auth/me', async (req) => publicUser(userOf(req)));
    api.get('/home', async (req) => buildHome(userOf(req)));
    api.get('/languages', async () => publicLanguages());

    api.get<{ Querystring: { q?: string } }>('/search', async (req) => search(userOf(req), clean(req.query.q, 200)));
    api.get<{ Params: { id: string } }>('/person/:id', async (req) => personDetail(userOf(req), clean(req.params.id, 80)));

    api.get<{ Querystring: { type?: string; sort?: string; start?: string; limit?: string } }>('/library', async (req) => {
      const type: MediaType = req.query.type === 'tv' ? 'tv' : 'movie';
      return libraryPage(userOf(req), type, req.query.sort ?? 'added', int(req.query.start, 0, 0, 100000), int(req.query.limit, 60, 1, 200));
    });

    api.get<{ Params: { kind: string }; Querystring: { page?: string } }>('/discover/:kind', async (req) =>
      discoverPage(userOf(req), req.params.kind, int(req.query.page, 1, 1, 500)),
    );

    // Titles: /title/movie/:tmdbId, /title/tv/:tmdbId, or /title/jf/:jellyfinId for items without TMDB ids.
    api.get<{ Params: TitleParams }>('/title/:type/:id', async (req) => {
      const user = userOf(req);
      if (req.params.type === 'jf') return jellyfinDetail(user, clean(req.params.id, 64));
      const { mediaType, tmdbId } = mediaTitle(req);
      return mediaType === 'movie' ? movieDetail(user, tmdbId) : tvDetail(user, tmdbId);
    });

    api.get<{ Params: TitleParams & { n: string } }>('/title/:type/:id/season/:n', async (req) => {
      const user = userOf(req);
      const n = int(req.params.n, -1, 0, 500);
      if (n < 0) throw new HttpError(400, t('Bad season number'));
      if (req.params.type === 'jf') return jellyfinSeason(user, clean(req.params.id, 64), n);
      const { tmdbId } = mediaTitle(req);
      return seasonDetail(user, tmdbId, n);
    });

    api.get<{ Params: TitleParams }>('/title/:type/:id/ratings', async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return titleRatings(mediaType, tmdbId);
    });

    api.get<{ Params: TitleParams }>('/title/:type/:id/jobs', async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return { items: jobsFor(`${mediaType}-${tmdbId}`) };
    });

    // "Versions": interactive search across all indexers, then grab a specific release.
    api.post<{ Params: TitleParams; Body: ReleaseSearch }>('/title/:type/:id/releases', async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return searchReleases(userOf(req), mediaType, tmdbId, req.body ?? {});
    });

    api.post<{ Params: TitleParams; Body: GrabRequest }>('/title/:type/:id/grab', async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return grabRelease(userOf(req), mediaType, tmdbId, req.body ?? ({} as GrabRequest));
    });

    api.post<{ Params: TitleParams; Body: SubtitleRequest }>('/title/:type/:id/subtitles', async (req, reply) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      reply.code(202);
      return requestSubtitles(userOf(req), mediaType, tmdbId, req.body ?? ({} as SubtitleRequest));
    });

    // Requests & downloads
    api.get<{ Querystring: { scope?: string } }>('/requests', async (req) => ({
      items: await listRequests(userOf(req), req.query.scope === 'all' ? 'all' : 'mine'),
    }));
    api.post<{ Body: CreateRequest }>('/requests', async (req, reply) => {
      reply.code(201);
      return createRequest(userOf(req), req.body ?? ({} as CreateRequest));
    });
    api.get('/downloads', async (req) => {
      const [items, requested] = await Promise.all([allDownloads(), myRequestKeys(userOf(req))]);
      const mine = new Set([...requested, ...grabbedKeys(userOf(req))]);
      return {
        items: items.map((d) => ({
          ...d,
          mine: mine.has(`${d.mediaType}-${d.tmdbId}`) || (d.tvdbId !== undefined && mine.has(`tvdb-${d.tvdbId}`)),
        })),
      };
    });

    // Playback
    api.get<{ Params: { itemId: string } }>('/play/:itemId', async (req) => playInfo(userOf(req), clean(req.params.itemId, 64)));
    api.get<{ Params: { itemId: string }; Querystring: { target?: string } }>('/play/:itemId/offline', async (req) =>
      offlineInfo(userOf(req), clean(req.params.itemId, 64), req.query.target === 'apple' || req.query.target === 'mp4' || req.query.target === 'original' ? req.query.target : 'desktop'),
    );
    api.post<{ Params: { itemId: string }; Body: PlaybackRequest }>('/play/:itemId/session', async (req) => {
      const user = userOf(req);
      const session = await startPlayback(user, clean(req.params.itemId, 64), req.body);
      if (session.method !== 'DirectPlay') {
        // So "why is ffmpeg busy on the Pi?" has an answer in the container log.
        const item = await settle(jellyfin.item(user.token, user.id, session.itemId), undefined);
        const audio = session.audioTracks.find((t) => t.index === session.audioStreamIndex);
        const subtitle = session.subtitleTracks.find((t) => t.index === session.subtitleStreamIndex);
        req.log.info(
          {
            title: item ? [item.SeriesName, item.Name].filter(Boolean).join(' · ') : session.itemId,
            user: user.name,
            method: session.method === 'Transcode' ? 'transcoding (heavy)' : 'repackaging (light)',
            reasons: session.transcodeReasons,
            audio: audio ? `${audio.label} [${audio.codec}]` : undefined,
            subtitles: subtitle ? `${subtitle.label} [${subtitle.codec}]` : 'off',
          },
          'Playback needs the server to work',
        );
      }
      return session;
    });
    api.post<{ Body: ProgressReport }>('/play/progress', async (req, reply) => {
      if (req.body?.itemId && req.body.playSessionId) scrobble(userOf(req), req.body, req.log);
      await reportProgress(userOf(req), req.body);
      reply.code(204);
    });

    api.get('/status', { preHandler: requireAdmin }, async () => ({ items: await serviceStatus() }));

    // Connections to the other services (addresses, API keys), editable by admins.
    api.get('/admin/connections', { preHandler: requireAdmin }, async () => ({ items: listConnections() }));
    api.put<{ Params: { id: string }; Body: ServiceConnectionUpdate }>('/admin/connections/:id', { preHandler: requireAdmin }, async (req) =>
      updateConnection(req.params.id, req.body ?? {}),
    );
    api.delete<{ Params: { id: string } }>('/admin/connections/:id', { preHandler: requireAdmin }, async (req) => resetConnection(req.params.id));
    api.post<{ Params: { id: string }; Body: ServiceConnectionUpdate }>('/admin/connections/:id/test', { preHandler: requireAdmin }, async (req) =>
      testConnection(req.params.id, req.body ?? undefined),
    );

    // The server's one Trakt account: linking, sending watches, importing past ones.
    api.get('/admin/trakt', { preHandler: requireAdmin }, async (): Promise<TraktStatus> => traktStatus());
    api.post('/admin/trakt/link', { preHandler: requireAdmin }, async () => startLink());
    api.put<{ Body: { scrobble?: boolean } }>('/admin/trakt', { preHandler: requireAdmin }, async (req) => setScrobble(req.body?.scrobble !== false));
    api.post('/admin/trakt/import', { preHandler: requireAdmin }, async (req) => startImport(userOf(req), req.log));
    api.delete('/admin/trakt', { preHandler: requireAdmin }, async () => unlink());

    // Admin settings, stored on the server.
    api.get('/admin/settings', { preHandler: requireAdmin }, async () => getSettings());
    api.put<{ Body: Partial<ServerSettings> }>('/admin/settings', { preHandler: requireAdmin }, async (req) => updateSettings(req.body ?? {}));
  });
}
