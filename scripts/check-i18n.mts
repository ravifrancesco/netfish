// Lists interface text that has no Italian yet: every t('…') / tn(n, '…', '…') in web/src
// whose English isn't a key of the dictionaries in web/src/i18n/it/.
//   npx tsx scripts/check-i18n.mts            (all of web/src)
//   npx tsx scripts/check-i18n.mts Watch.tsx  (only files whose path contains this)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', 'web', 'src');
const only = process.argv[2];

const italian: Record<string, string> = {};
for (const file of readdirSync(path.join(root, 'i18n', 'it'))) {
  const mod = await import(path.join(root, 'i18n', 'it', file));
  Object.assign(italian, mod.default);
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'i18n') yield* files(full);
    } else if (/\.(tsx?|mts)$/.test(name)) yield full;
  }
}

// A string literal in any of the three quote styles (no ${…} interpolation inside backticks).
const literal = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\x60((?:[^\x60\\$]|\\.)*)\x60`;
const tCall = new RegExp(String.raw`\bt\(\s*(?:${literal})`, 'g');
const tnCall = new RegExp(String.raw`\btn\(\s*[^,]+,\s*(?:${literal})\s*,\s*(?:${literal})`, 'g');
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');

let missing = 0;
let total = 0;
for (const file of files(root)) {
  if (only && !file.includes(only)) continue;
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const m of text.matchAll(tCall)) found.push(m[1] ?? m[2] ?? m[3]);
  for (const m of text.matchAll(tnCall)) found.push(m[1] ?? m[2] ?? m[3], m[4] ?? m[5] ?? m[6]);
  for (const raw of found) {
    total++;
    const english = unescape(raw);
    if (!(english in italian)) {
      missing++;
      console.log(`${path.relative(root, file)}: ${JSON.stringify(english)}`);
    }
  }
}
console.log(`${total} texts, ${missing} without Italian, ${Object.keys(italian).length} Italian entries`);
process.exitCode = missing ? 1 : 0;
