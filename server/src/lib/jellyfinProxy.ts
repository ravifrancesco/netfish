import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { FastifyInstance } from 'fastify';
import { tokenFrom } from '../auth';
import { authHeader } from '../clients/jellyfin';
import { config } from '../config';
import { castAuth } from '../services/cast';
import { cachedImage } from './imageCache';
import { JF_PREFIX } from './images';
import { t } from './i18n';

/**
 * Jellyfin, read-only, behind the user's Netfish session: images, video
 * streams (with Range), HLS playlists/segments, subtitles. The upstream address
 * is read on every request, so changing it under Settings → Connections works
 * without a restart. Clients only ever receive these URLs from the API.
 * Tagged artwork is served from Netfish's own disk cache (see imageCache).
 */

const PASS_REQUEST = ['range', 'if-range', 'if-none-match', 'if-modified-since', 'accept', 'user-agent'];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'set-cookie']);

const CAST_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-length, content-range, accept-ranges, content-type',
};

export function registerJellyfinProxy(app: FastifyInstance) {
  // A Chromecast's player asks first before fetching across origins (with a Range, say).
  app.route({
    method: 'OPTIONS',
    url: `${JF_PREFIX}/*`,
    handler: async (_req, reply) =>
      reply
        .code(204)
        .headers({ ...CAST_HEADERS, 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'range, content-type', 'access-control-max-age': '600' })
        .send(),
  });
  app.route({
    method: ['GET', 'HEAD'],
    url: `${JF_PREFIX}/*`,
    handler: async (req, reply) => {
      if (!config.jellyfin.url) return reply.code(503).send({ error: t('Jellyfin is not connected yet') });
      let rest = req.url.slice(JF_PREFIX.length);
      // A Chromecast's link: /cast/<token>/videos/…, the token in the path so that every relative
      // link in Jellyfin's playlists (variants, segments) carries it too (Jellyfin rebuilds their
      // queries without anything of ours). nfcast=… in the query still works.
      let castToken = new URL(rest, 'http://x').searchParams.get('nfcast') ?? undefined;
      const castPath = /^\/cast\/([0-9a-f]{48})(\/.*)$/i.exec(rest);
      if (castPath) {
        castToken = castPath[1];
        rest = castPath[2];
      }

      if (req.method === 'GET') {
        const image = await cachedImage(rest, tokenFrom(req));
        if (image) {
          return reply
            .header('content-type', image.type)
            .header('content-length', image.size)
            .header('cache-control', 'private, max-age=31536000, immutable')
            .send(fs.createReadStream(image.file));
        }
      }

      const base = new URL(config.jellyfin.url);
      const target = new URL(base.pathname.replace(/\/$/, '') + rest, base.origin);

      const headers: Record<string, string> = {};
      for (const name of PASS_REQUEST) {
        const value = req.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      // A Chromecast's token stands for the person, for that title (and its player fetches across
      // origins, so it's told it may).
      const forCast = castAuth(castToken, rest.split('?')[0]);
      const token = forCast ?? tokenFrom(req);
      if (token) headers.authorization = authHeader(token);
      if (forCast) for (const [name, value] of Object.entries(CAST_HEADERS)) reply.header(name, value);

      return new Promise<void>((resolve) => {
        // Answered once Jellyfin's reply is on its way: a later error belongs to that stream (Fastify
        // ends it), and a second answer would crash the server.
        let answered = false;
        const upstream = (target.protocol === 'https:' ? https : http).request(target, { method: req.method, headers }, (res) => {
          answered = true;
          reply.code(res.statusCode ?? 502);
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined && !HOP_BY_HOP.has(name)) reply.header(name, value);
          }
          reply.send(res);
          resolve();
        });
        // Subtitles inside the file: the first time, Jellyfin pulls them out with ffmpeg, which on a
        // Pi can take minutes for a big file (then it keeps them). Waiting that out, not the usual
        // half minute (giving up made Jellyfin stop too, so they never came).
        upstream.setTimeout(/\/Subtitles\//i.test(rest) ? 5 * 60_000 : 30_000, () => upstream.destroy(new Error('timed out')));
        upstream.on('error', (err) => {
          // Nobody to tell when the viewer has already gone (seeked, closed the player).
          if (!answered && !reply.sent && !reply.raw.destroyed) {
            answered = true;
            reply.code(502).send({ error: t('Jellyfin is unreachable ({reason})', { reason: err.message }) });
          }
          resolve();
        });
        // Viewer seeked or closed the player: stop pulling the old byte range from the Pi.
        reply.raw.on('close', () => {
          if (!reply.raw.writableFinished) upstream.destroy();
        });
        upstream.end();
      });
    },
  });
}
