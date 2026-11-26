// Writes apps/ios/sidestore.json, the source SideStore (and AltStore) reads to install the iPhone app
// and offer its updates. It points at this version's Netfish-ios.ipa on GitHub, so release.sh runs it
// once the release is published, and pushes it.
//   node scripts/sidestore-source.mjs <github owner>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const owner = process.argv[2];
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const file = `release/Netfish-${version}-ios.ipa`;
const ipa = readFileSync(file);
const plist = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: execFileSync('unzip', ['-p', file, 'Payload/*.app/Info.plist']),
  }),
);
// SideStore refuses an app whose version, size or checksum differ from the source's.
if (plist.CFBundleShortVersionString !== version) throw new Error(`${file} says ${plist.CFBundleShortVersionString}.`);

// This version's CHANGELOG.md entry ("## X.Y.Z (date)" up to the next "## "), as plain text.
const changelog = readFileSync('CHANGELOG.md', 'utf8').split('\n');
const start = changelog.findIndex((line) => line.startsWith(`## ${version} `) || line === `## ${version}`);
const end = changelog.findIndex((line, i) => i > start && line.startsWith('## '));
const date = changelog[start].match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? new Date().toISOString().slice(0, 10);
const whatsNew = changelog
  .slice(start + 1, end < 0 ? undefined : end)
  .join('\n')
  .replace(/\n {2,}(?=\S)/g, ' ')
  .replace(/^#+ /gm, '')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\*\*|`/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const downloadURL = `https://github.com/${owner}/netfish/releases/download/v${version}/Netfish-ios.ipa`;
const iconURL = `https://raw.githubusercontent.com/${owner}/netfish/main/apps/ios/Netfish/Assets.xcassets/AppIcon.appiconset/icon-1024.png`;
const source = {
  name: 'Netfish',
  identifier: 'app.netfish.source',
  subtitle: 'Your home cinema.',
  iconURL,
  website: `https://github.com/${owner}/netfish`,
  tintColor: '#36e2c6',
  apps: [
    {
      name: 'Netfish',
      bundleIdentifier: plist.CFBundleIdentifier,
      developerName: 'Netfish',
      subtitle: 'Your home cinema.',
      localizedDescription: 'Films, shows and channels from your Netfish server. Download them to watch offline.',
      iconURL,
      tintColor: '#36e2c6',
      category: 'entertainment',
      versions: [
        {
          version,
          buildVersion: plist.CFBundleVersion,
          date,
          localizedDescription: whatsNew,
          downloadURL,
          size: ipa.length,
          sha256: createHash('sha256').update(ipa).digest('hex'),
          minOSVersion: plist.MinimumOSVersion,
        },
      ],
      // Older SideStore and AltStore read these instead of versions.
      version,
      versionDate: date,
      versionDescription: whatsNew,
      downloadURL,
      size: ipa.length,
      // The .ipa is unsigned, so it carries no entitlements; the privacy prompts come from Info.plist.
      appPermissions: {
        entitlements: [],
        privacy: Object.fromEntries(Object.entries(plist).filter(([key]) => /^NS\w+UsageDescription$/.test(key))),
      },
    },
  ],
  news: [],
};
writeFileSync('apps/ios/sidestore.json', `${JSON.stringify(source, null, 2)}\n`);
console.log(`Wrote apps/ios/sidestore.json for ${version}`);
