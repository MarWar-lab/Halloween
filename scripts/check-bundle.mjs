/**
 * Look at what the build actually emitted.
 *
 * This exists because of one bug that got all the way to production. The entry
 * used to read:
 *
 *   lazy(() => isSurvival ? import('./survival/Survival') : import('./App'))
 *
 * The bundler reads an import() call site to work out which files that chunk
 * needs, and a ternary gives it two answers. It stapled App.css to the entry —
 * so Campfire's stylesheet loaded on every page — and emitted survival.css as a
 * chunk that nothing referenced, so it never loaded at all. The deployed
 * survival screen rendered in Campfire's colours.
 *
 * Types passed. Tests passed. Lint passed. The build printed the orphaned file
 * on its own summary line and said nothing was wrong. Only opening the deployed
 * page found it, which is the most expensive place to find anything.
 *
 *   node scripts/check-bundle.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');

let pass = 0;
const fail = [];
const check = (label, ok, detail = '') => {
  if (ok) pass += 1;
  else fail.push(label);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

if (!existsSync(assets)) {
  console.error('No dist/assets. Run `npm run build` first.');
  process.exit(1);
}

const files = readdirSync(assets);
const styles = files.filter((f) => f.endsWith('.css'));
const scripts = files.filter((f) => f.endsWith('.js'));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const code = scripts.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

console.log('\n=== every stylesheet has something that loads it ===');

for (const style of styles) {
  // Either linked from the page, or named inside a chunk so the preload helper
  // can inject it when that chunk loads. Neither means it is dead weight that
  // ships and never applies.
  const linked = html.includes(style);
  const referenced = code.includes(style);
  check(`${style} is reachable`, linked || referenced,
    linked ? 'linked from index.html' : referenced ? 'loaded by a chunk' : 'ORPHANED');
}

console.log('\n=== the two games keep their stylesheets apart ===');

const gameStyles = styles.filter((f) => /^(App|Survival)-/.test(f));
check('both games emit their own stylesheet', gameStyles.length === 2,
  gameStyles.join(', ') || 'none found');

// index.html must not hard-link either game's CSS: whichever it linked would
// load on both pages, and the generic class names would collide.
for (const style of gameStyles) {
  check(`${style} is not forced onto every page`, !html.includes(style));
}

console.log(`\n${'='.repeat(60)}\n  ${pass} passed, ${fail.length} failed`);
if (fail.length) {
  for (const f of fail) console.log(`    FAILED: ${f}`);
  process.exit(1);
}
