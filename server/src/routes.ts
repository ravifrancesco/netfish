import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  TogetherControl,
  TogetherTracks,
  ProgramAbout,
  ServerUpdate,
  SuggestArrStatus,
  TraktStatus,
  User,
} from '@netfish/shared';
import {
  SESSION_COOKIE,
  checkToken,
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
import { deviceOf, ensureDevice, hasProfile, listProfiles, rememberProfile, removeProfile, setAsk, setPin, switchProfile } from './profiles';
import { jellyfin } from './clients/jellyfin';
import { settle } from './lib/async';
import { publicLanguages } from './lib/languages';
import { HttpError, UpstreamError } from './lib/upstream';
import { discoverPage, libraryPage, search, serviceStatus } from './services/browse';
import { allDownloads, detailsFor } from './services/downloads';
import { buildHome } from './services/home';
import { titleRatings } from './services/ratings';
import { grabRelease, grabbedKeys, searchReleases } from './services/releases';
import { jobsFor, requestSubtitles } from './services/subtitles';
import { offlineInfo, playInfo, reportProgress, startPlayback } from './services/playback';
import { personDetail } from './services/people';
import { hideFromContinue, setPosition, setWatched } from './services/watched';
import { readyToWatch } from './services/ready';
import { command, control, createRoom, endRoom, getRoom, leave, listRooms, openStream, setTracks, setWaiting } from './services/together';
import { listDevices, listScreens, openLive, playOn } from './services/screens';
import { channelAdmin, channelsEnabled, keyOfItem, listChannels, resetChannels, updateChannels, watching } from './services/channels';
import { freshRequested, freshStatus, keepFresh, noteChosen, removeFresh, runFresh } from './services/fresh';
import { catalog } from './services/catalog';
import { cleanupSuggestions, keepForGood } from './services/cleanup';
import { cancelRequest, deleteFromDisk, downloadAgain, removedTitles, stopDownload, storage } from './services/manage';
import { createRequest, listRequests, myRequestKeys } from './services/requests';
import { scrobble, setScrobble, startImport, startLink, traktStatus, unlink } from './services/trakt';
import { runSuggestarr, suggestarrStatus } from './services/suggestarr';
import { trailersFor } from './services/trailers';
import { serverUpdate } from './services/serverUpdate';
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
      channels: channelsEnabled(),
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
    // One more profile on this device, for "Who's watching?".
    rememberProfile(ensureDevice(req, reply), user);
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
    // Signing out also takes this person off the device's profiles.
    const user = token ? await checkToken(token).catch(() => null) : null;
    if (user) removeProfile(deviceOf(req), user.id);
    if (token) {
      await settle(jellyfin.logout(token), undefined);
      forgetSession(token);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- Profiles on this device ("Who's watching?"): work signed out too ----------
  const setSession = (req: FastifyRequest, reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https', maxAge: 60 * 60 * 24 * 400 });
  app.get('/profiles', async (req) => listProfiles(deviceOf(req), tokenFrom(req)));
  app.post<{ Body: { userId?: string; pin?: string } }>('/profiles/switch', async (req, reply) => {
    const user = await switchProfile(deviceOf(req), clean(req.body?.userId, 64), typeof req.body?.pin === 'string' ? req.body.pin : undefined);
    rememberSession(user);
    setSession(req, reply, user.token);
    return publicUser(user);
  });
  app.delete<{ Params: { userId: string } }>('/profiles/:userId', async (req, reply) => {
    const device = deviceOf(req);
    const userId = clean(req.params.userId, 64);
    // A locked profile can only be taken off by that person (signed in as them).
    const current = tokenFrom(req) ? await checkToken(tokenFrom(req)!).catch(() => null) : null;
    if (listProfiles(device, undefined).profiles.find((p) => p.userId === userId)?.locked && current?.id !== userId) {
      throw new HttpError(403, t('Only that person can remove a profile with a PIN'));
    }
    const token = removeProfile(device, userId);
    if (token) {
      await settle(jellyfin.logout(token), undefined);
      forgetSession(token);
      if (tokenFrom(req) === token) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }
    return { ok: true };
  });
  // Profile pictures for the picker, which shows signed out too (Jellyfin serves them without a sign-in).
  app.get<{ Params: { userId: string } }>('/profiles/:userId/avatar', async (req, reply) => {
    const userId = clean(req.params.userId, 64);
    if (!/^[a-f0-9-]{32,36}$/i.test(userId) || !hasProfile(deviceOf(req), userId) || !config.jellyfin.url) throw new HttpError(404, 'Not found');
    const res = await fetch(`${config.jellyfin.url}/Users/${userId}/Images/Primary?maxWidth=256&quality=90`, { signal: AbortSignal.timeout(8000) }).catch(() => undefined);
    if (!res?.ok) throw new HttpError(404, 'Not found');
    reply.header('content-type', res.headers.get('content-type') ?? 'image/jpeg').header('cache-control', 'private, max-age=3600');
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  // ---------- Signed in ----------
  await app.register(async (api) => {
    api.addHook('preHandler', requireUser);

    api.get('/auth/me', async (req) => publicUser(userOf(req)));
    // This person's PIN on this device, and whether the device asks who's watching.
    api.put<{ Body: { pin?: string | null; ask?: boolean } }>('/profiles/me', async (req) => {
      const device = deviceOf(req);
      if (req.body && 'pin' in req.body) setPin(device, userOf(req).id, req.body.pin === null ? null : String(req.body.pin ?? ''));
      if (typeof req.body?.ask === 'boolean') setAsk(device, req.body.ask);
      return listProfiles(device, tokenFrom(req));
    });
    api.get('/home', async (req) => buildHome(userOf(req)));
    // What you asked for that has arrived (the apps poll this to notify).
    api.get('/ready', async (req) => ({ items: await readyToWatch(userOf(req)) }));
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

    api.get<{ Params: TitleParams }>('/title/:type/:id/trailers', async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return trailersFor(userOf(req), mediaType, tmdbId);
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
          ...detailsFor(userOf(req).isAdmin, d),
          mine: mine.has(`${d.mediaType}-${d.tmdbId}`) || (d.tvdbId !== undefined && mine.has(`tvdb-${d.tvdbId}`)),
        })),
      };
    });

    api.post<{ Params: { id: string }; Body: { mode?: string } }>('/downloads/:id/stop', async (req) =>
      stopDownload(userOf(req), clean(req.params.id, 120), req.body?.mode === 'replace' ? 'replace' : 'stop'),
    );

    // Files on disk (admins): delete to free space but keep the title listed, or download it again.
    const seasonsOf = (body: unknown) =>
      Array.isArray((body as { seasons?: unknown })?.seasons)
        ? ((body as { seasons: unknown[] }).seasons.filter((n) => Number.isInteger(n) && (n as number) >= 0) as number[])
        : undefined;
    api.post<{ Params: TitleParams; Body: { seasons?: number[] } }>('/title/:type/:id/delete', { preHandler: requireAdmin }, async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return deleteFromDisk(userOf(req), mediaType, tmdbId, seasonsOf(req.body));
    });
    // Cancel a request before anything is on disk: whoever asked for it, or an admin.
    api.delete<{ Params: TitleParams }>('/title/:type/:id/request', async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return cancelRequest(userOf(req), mediaType, tmdbId);
    });
    api.post<{ Params: TitleParams; Body: { seasons?: number[] } }>('/title/:type/:id/redownload', { preHandler: requireAdmin }, async (req) => {
      const { mediaType, tmdbId } = mediaTitle(req);
      return downloadAgain(userOf(req), mediaType, tmdbId, seasonsOf(req.body));
    });
    api.get<{ Querystring: { type?: string } }>('/library/removed', async (req) => ({
      items: await removedTitles(req.query.type === 'tv' ? 'tv' : 'movie'),
    }));
    api.get('/admin/storage', { preHandler: requireAdmin }, async () => storage());
    api.get('/admin/cleanup', { preHandler: requireAdmin }, async (req) => ({ items: await cleanupSuggestions(userOf(req)) }));
    api.post<{ Body: { key?: string } }>('/admin/cleanup/keep', { preHandler: requireAdmin }, async (req) => {
      const key = clean(req.body?.key, 40);
      if (!/^(movie|tv)-\d+$/.test(key)) throw new HttpError(400, 'Bad key');
      return keepForGood(key);
    });

    // Watched / not watched, and taking things off Continue Watching.
    api.post<{ Params: { itemId: string }; Body: { watched?: boolean } }>('/items/:itemId/watched', async (req) =>
      setWatched(userOf(req), clean(req.params.itemId, 64), req.body?.watched !== false),
    );
    api.post<{ Params: { itemId: string } }>('/items/:itemId/hide', async (req) => hideFromContinue(userOf(req), clean(req.params.itemId, 64)));
    // Watched a download (on a phone, on a plane): where they got to, sent when back online.
    api.post<{ Params: { itemId: string }; Body: { seconds?: number; finished?: boolean; at?: string } }>('/items/:itemId/position', async (req) =>
      setPosition(userOf(req), clean(req.params.itemId, 64), Number(req.body?.seconds), Boolean(req.body?.finished), typeof req.body?.at === 'string' ? req.body.at : undefined),
    );

    // Watch together: rooms where play, pause and seeking stay in step for everyone.
    type Room = { Params: { id: string } };
    api.get('/together', async () => ({ rooms: listRooms() }));
    // The live line every open Netfish keeps: rooms, screens, and "play this" (Play on TV).
    api.get<{ Querystring: { screen?: string; name?: string; kind?: string; app?: string; version?: string } }>('/together/live', async (req, reply) => {
      openLive(userOf(req), reply, req.query);
      return reply;
    });
    api.post<{ Body: { itemId?: string; position?: number } }>('/together', async (req) =>
      createRoom(userOf(req), clean(req.body?.itemId, 64), Number.isFinite(req.body?.position) ? Number(req.body?.position) : undefined),
    );
    api.get<Room>('/together/:id', async (req) => getRoom(clean(req.params.id, 12)));
    api.get<Room & { Querystring: { client?: string; role?: string } }>('/together/:id/events', async (req, reply) => {
      openStream(userOf(req), clean(req.params.id, 12), req.query.client, reply, req.query.role === 'remote');
      return reply;
    });
    api.post<Room & { Body: TogetherControl }>('/together/:id/control', async (req) =>
      control(userOf(req), clean(req.params.id, 12), req.body ?? ({} as TogetherControl)),
    );
    api.post<Room & { Body: { clientId?: string; waiting?: boolean } }>('/together/:id/waiting', async (req) =>
      setWaiting(userOf(req), clean(req.params.id, 12), req.body?.clientId, Boolean(req.body?.waiting)),
    );
    api.post<Room & { Body: { clientId?: string } }>('/together/:id/leave', async (req) => leave(userOf(req), clean(req.params.id, 12), req.body?.clientId));
    api.delete<Room>('/together/:id', async (req) => endRoom(userOf(req), clean(req.params.id, 12)));
    api.post<Room & { Body: { clientId?: string; tracks?: TogetherTracks } }>('/together/:id/tracks', async (req) =>
      setTracks(userOf(req), clean(req.params.id, 12), req.body?.clientId, req.body?.tracks),
    );
    api.post<Room & { Body: { clientId?: string; to?: string; action?: string; index?: number | null } }>('/together/:id/command', async (req) =>
      command(userOf(req), clean(req.params.id, 12), req.body ?? {}),
    );

    // Play on TV: the screens you can send something to, and sending it.
    api.get('/screens', async (req) => ({ screens: listScreens(userOf(req)) }));
    api.post<{ Params: { id: string }; Body: { itemId?: string; position?: number } }>('/screens/:id/play', async (req) =>
      playOn(userOf(req), clean(req.params.id, 40), clean(req.body?.itemId, 64), Number.isFinite(req.body?.position) ? Number(req.body?.position) : undefined),
    );

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
    // Channels (when they don't count as watching): the programme is over, the transcode can stop.
    api.post<{ Body: { playSessionId?: string; deviceId?: string } }>('/play/end', async (req, reply) => {
      const playSessionId = clean(req.body?.playSessionId, 64);
      const deviceId = clean(req.body?.deviceId, 64);
      if (playSessionId && deviceId) await jellyfin.endEncoding(userOf(req).token, deviceId, playSessionId).catch(() => {});
      reply.code(204);
    });
    api.post<{ Body: ProgressReport }>('/play/progress', async (req, reply) => {
      if (req.body?.itemId && req.body.playSessionId) scrobble(userOf(req), req.body, req.log);
      // A new title for channels someone chose to watch: theirs now.
      if (req.body?.itemId && !req.body.channel) noteChosen(keyOfItem(req.body.itemId), userOf(req).name);
      await reportProgress(userOf(req), req.body);
      reply.code(204);
    });

    api.get('/status', { preHandler: requireAdmin }, async () => ({ items: await serviceStatus() }));

    // Connections to the other services (addresses, API keys), editable by admins.
    api.get('/admin/connections', { preHandler: requireAdmin }, async () => ({ items: listConnections() }));
    api.get('/admin/devices', { preHandler: requireAdmin }, async () => ({ devices: listDevices() }));

    // Channels: the library as old-school TV (an admin turns them on).
    api.get<{ Querystring: { hours?: string; from?: string } }>('/channels', async (req) =>
      listChannels(userOf(req), Math.min(24, Number(req.query.hours) || 4), Date.now(), Number(req.query.from) || undefined),
    );
    api.post<{ Params: { id: string }; Body: { clientId?: string; leaving?: boolean } }>('/channels/:id/watching', async (req) => {
      watching(clean(req.params.id, 40), clean(req.body?.clientId, 64), req.body?.leaving === true);
      return { ok: true };
    });
    // A programme opened in the guide: what it's about, and where its page is.
    api.get<{ Params: { itemId: string } }>('/channels/about/:itemId', async (req): Promise<ProgramAbout> => {
      const user = userOf(req);
      const itemId = clean(req.params.itemId, 64);
      const key = keyOfItem(itemId);
      const requested = key ? freshRequested(key) : undefined;
      // A new title not downloaded yet: what TMDB says about it.
      if (itemId.startsWith('fresh:')) {
        const [type, id] = (key ?? '').split('-');
        const found = await settle<{ overview?: string } | undefined>(type === 'movie' ? catalog.movie(Number(id)) : catalog.tv(Number(id)), undefined);
        return { overview: found?.overview, requested };
      }
      const item = await jellyfin.item(user.token, user.id, itemId);
      return { overview: item.Overview, pageId: item.SeriesId ?? item.Id, requested };
    });
    // A new title on a channel: anyone can keep it, or ask for it before it's here (it joins the library).
    api.post<{ Body: { itemId?: string } }>('/channels/keep', async (req) => {
      const key = keyOfItem(clean(req.body?.itemId, 64));
      if (!key) throw new HttpError(404, t('Not a new title on a channel'));
      const kept = keepFresh(key, userOf(req).name);
      // Not here yet: it starts downloading now (not on its day).
      if (!kept.here) void runFresh();
      return { ok: true, ...kept };
    });
    api.get('/admin/channels', { preHandler: requireAdmin }, async (req) => channelAdmin(userOf(req)));
    api.get('/admin/channels/fresh', { preHandler: requireAdmin }, async () => freshStatus());
    api.post('/admin/channels/fresh/run', { preHandler: requireAdmin }, async () => {
      await runFresh();
      return freshStatus();
    });
    api.post<{ Body: { key?: string } }>('/admin/channels/fresh/keep', { preHandler: requireAdmin }, async (req) => {
      keepFresh(clean(req.body?.key, 40), userOf(req).name);
      return freshStatus();
    });
    api.post<{ Body: { key?: string } }>('/admin/channels/fresh/remove', { preHandler: requireAdmin }, async (req) => {
      await removeFresh(clean(req.body?.key, 40));
      return freshStatus();
    });
    api.put<{ Body: Record<string, unknown> }>('/admin/channels', { preHandler: requireAdmin }, async (req) => updateChannels(userOf(req), req.body ?? {}));
    api.post('/admin/channels/reset', { preHandler: requireAdmin }, async (req) => resetChannels(userOf(req)));
    api.put<{ Params: { id: string }; Body: ServiceConnectionUpdate }>('/admin/connections/:id', { preHandler: requireAdmin }, async (req) =>
      updateConnection(req.params.id, req.body ?? {}),
    );
    api.delete<{ Params: { id: string } }>('/admin/connections/:id', { preHandler: requireAdmin }, async (req) => resetConnection(req.params.id));
    api.post<{ Params: { id: string }; Body: ServiceConnectionUpdate }>('/admin/connections/:id/test', { preHandler: requireAdmin }, async (req) =>
      testConnection(req.params.id, req.body ?? undefined),
    );

    // The server's one Trakt account: linking, sending watches, importing past ones.
    api.get('/admin/trakt', { preHandler: requireAdmin }, async (): Promise<TraktStatus> => traktStatus());
    api.get('/admin/suggestarr', { preHandler: requireAdmin }, async (): Promise<SuggestArrStatus> => suggestarrStatus());
    api.post('/admin/suggestarr/run', { preHandler: requireAdmin }, async (): Promise<SuggestArrStatus> => runSuggestarr());
    api.post('/admin/trakt/link', { preHandler: requireAdmin }, async () => startLink());
    api.put<{ Body: { scrobble?: boolean } }>('/admin/trakt', { preHandler: requireAdmin }, async (req) => setScrobble(req.body?.scrobble !== false));
    api.post('/admin/trakt/import', { preHandler: requireAdmin }, async (req) => startImport(userOf(req), req.log));
    api.delete('/admin/trakt', { preHandler: requireAdmin }, async () => unlink());

    // Admin settings, stored on the server.
    api.get('/admin/settings', { preHandler: requireAdmin }, async () => getSettings());
    api.get('/admin/update', { preHandler: requireAdmin }, async (): Promise<ServerUpdate> => serverUpdate());
    api.put<{ Body: Partial<ServerSettings> }>('/admin/settings', { preHandler: requireAdmin }, async (req) => updateSettings(req.body ?? {}));
  });
}
