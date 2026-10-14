// Bundles the server (and its dependencies) into a single CommonJS file so the
// runtime Docker image needs nothing but Node and the built web client.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  legalComments: 'none',
  define: { __NETFISH_VERSION__: JSON.stringify(version) },
  logLevel: 'info',
});
