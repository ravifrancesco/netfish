// Bundles the source needed to build the Netfish server image into release/Netfish-<version>-server.tar.gz,
// for Portainer → Images → Build a new image → Upload (builds right on the Pi).
// Portainer sends the archive as-is (no .dockerignore), so only the needed files go in.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const files = [
  'Dockerfile',
  'docker/entrypoint.sh',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'shared',
  'server/package.json',
  'server/tsconfig.json',
  'server/build.mjs',
  'server/src',
  'web',
];
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const out = `release/Netfish-${version}-server.tar.gz`;
mkdirSync('release', { recursive: true });
execFileSync(
  'tar',
  [
    '-czf',
    out,
    // macOS tags files with extended attributes (e.g. com.apple.provenance); Docker on
    // Linux tries to restore them and fails. Plain ustar can't carry any of that.
    '--format=ustar',
    '--no-xattrs',
    '--no-mac-metadata',
    '--no-acls',
    '--no-fflags',
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=.DS_Store',
    ...files,
  ],
  { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } },
);
console.log(`Created ${out}. Upload it in Portainer → Images → Build a new image (name: netfish:latest).`);
