import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { FastifyInstance } from 'fastify';
import { tokenFrom } from '../auth';
import { authHeader } from '../clients/jellyfin';
import { config } from '../config';
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

export function registerJellyfinProxy(app: FastifyInstance) {
  app.route({
    method: ['GET', 'HEAD'],
    url: `${JF_PREFIX}/*`,
    handler: async (req, reply) => {
      if (!config.jellyfin.url) return reply.code(503).send({ error: t('Jellyfin is not connected yet') });
      const rest = req.url.slice(JF_PREFIX.length);

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
      const token = tokenFrom(req);
      if (token) headers.authorization = authHeader(token);

      return new Promise<void>((resolve) => {
        const upstream = (target.protocol === 'https:' ? https : http).request(target, { method: req.method, headers }, (res) => {
          reply.code(res.statusCode ?? 502);
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined && !HOP_BY_HOP.has(name)) reply.header(name, value);
          }
          reply.send(res);
          resolve();
        });
        upstream.setTimeout(30_000, () => upstream.destroy(new Error('timed out')));
        upstream.on('error', (err) => {
          if (!reply.sent) reply.code(502).send({ error: t('Jellyfin is unreachable ({reason})', { reason: err.message }) });
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
