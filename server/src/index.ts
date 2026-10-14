import { buildApp } from './app';
import { config, has } from './config';
import { SETUP_CODE } from './connections';
import { storageFix, storageWritable } from './lib/storage';

async function main() {
  const app = await buildApp();
  const services = Object.entries(has)
    .map(([name, check]) => `${name}: ${check() ? 'on' : 'off'}`)
    .join(', ');
  app.log.info(`Netfish ${config.version} — ${services}`);
  if (!has.jellyfin()) app.log.warn('No Jellyfin address yet: open Netfish in a browser to set it up.');
  if (!storageWritable()) app.log.error(storageFix());
  app.log.info(`Setup code: ${SETUP_CODE} (only needed to change the Jellyfin address from the sign-in screen)`);
  if (!config.publicDir) app.log.info('No web build found; serving the API only (use the Vite dev server for the UI).');

  await app.listen({ port: config.port, host: config.host });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
