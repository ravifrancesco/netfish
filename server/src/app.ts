import Fastify, { LogController, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { JF_PREFIX } from './lib/images';
import { registerJellyfinProxy } from './lib/jellyfinProxy';
import { HttpError, NotConfiguredError, UpstreamError } from './lib/upstream';
import { apiRoutes } from './routes';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    // One line per request is noise on a Pi; errors and warnings still get logged.
    logController: new LogController({ disableRequestLogging: config.logLevel !== 'debug' }),
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof NotConfiguredError) return reply.code(503).send({ error: err.message, service: err.service });
    if (err instanceof UpstreamError) {
      // A rejected Jellyfin token means the session is over; anything else is the service's problem, not the user's.
      const status =
        err.service === 'Jellyfin' && err.status === 401 ? 401 : [400, 403, 404, 409, 422].includes(err.status) ? err.status : 502;
      if (status === 502) req.log.warn({ service: err.service, status: err.status }, err.message);
      return reply.code(status).send({ error: err.message, service: err.service });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the Netfish server' });
  });

  // Cookie-authenticated writes must come from our own app: browsers won't send this
  // header (or a JSON body) cross-site without a CORS preflight we never approve.
  app.addHook('onRequest', async (req) => {
    if (!MUTATING.has(req.method) || !req.url.startsWith('/api/')) return;
    const json = (req.headers['content-type'] ?? '').includes('application/json');
    if (json || req.headers['x-netfish'] || req.headers.authorization?.startsWith('Bearer ')) return;
    throw new HttpError(403, 'Missing X-Netfish header');
  });

  await app.register(apiRoutes, { prefix: '/api' });

  registerJellyfinProxy(app);

  if (config.publicDir) {
    await app.register(fastifyStatic, {
      root: config.publicDir,
      wildcard: false,
      setHeaders: (reply, filePath) => {
        // Vite fingerprints everything under assets/, so those can be cached forever.
        reply.header('cache-control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Client-side routes (/title/movie/123, /watch/…) all load the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url.startsWith(`${JF_PREFIX}/`)) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }

  return app;
}
