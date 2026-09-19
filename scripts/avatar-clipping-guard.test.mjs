/**
 * Regression test: a newspaper clipping must NEVER become a person's avatar.
 *
 * Mark's ruling, 2026-09-19: clippings are publishable content for living AND
 * deceased people, but a clipping is never the circular avatar. Before this
 * guard, only `grave|cemetery|map|scenery-plate` were excluded — so a file named
 * `john-telfer-obituary-clipping-1913.jpg` sailed through and became his face.
 *
 * Run: node scripts/avatar-clipping-guard.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'convert-markdown.mjs'), 'utf8');

// Pull the literal regex out of the real source — tests the shipped guard, not a copy.
const m = src.match(/person_photo:\s*bodyImages\.find\(img\s*=>\s*\n\s*!(\/.*?\/i)\.test\(img\.src\)/s);
if (!m) {
  console.error('FAIL: could not locate the person_photo guard in convert-markdown.mjs');
  process.exit(1);
}
const guard = eval(m[1]); // the actual regex from the file
// The shipped guard is TWO clauses: the regex, AND the _p{N} book-plate suffix.
const isRejected = (f) => guard.test(f) || /_[pP]\d+\.jpg$/.test(f);

const mustBeExcluded = [
  'john-telfer-obituary-clipping-1913.jpg',
  'newspaper-clipping-1988.jpg',
  'mark-telfer-obituary.jpg',
  'border-watch-death-notice-1925.png',
  'in-memoriam-1974.jpg',
  'in_memoriam-1974.jpg',
  'sandra-smith-wedding-clipping-1974.jpg',
  'trove-article-1913.jpg',
  'grave.jpg',
  'tantanoola-cemetery-view.jpg',
  'klemzig-sa-google-map.png',
  'Newcastleton_and_the_Liddesdale_Hills_p6.jpg',
];

const mustBeAllowed = [
  'francis-telfer-headshot.jpg',
  'amy-ellen-telfer.jpg',
  'esther-jane-telfer-smith-portrait.jpg',
  'murray-shirley-telfer-wedding-portrait-1950.jpg',
  'caroline-amelia-telfer-portrait-c1910.jpg',
];

let failed = 0;

for (const f of mustBeExcluded) {
  // isRejected(f) === true means the guard REFUSED it as an avatar (good)
  if (!isRejected(f)) {
    console.error(`FAIL: clipping/grave would become an avatar -> ${f}`);
    failed++;
  }
}
for (const f of mustBeAllowed) {
  // a real photo must NOT be rejected by the guard
  if (isRejected(f)) {
    console.error(`FAIL: a genuine portrait was rejected -> ${f}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} failure(s). Avatar clipping guard is NOT working.`);
  process.exit(1);
}
console.log(`PASS: ${mustBeExcluded.length} non-portraits excluded, ${mustBeAllowed.length} portraits allowed.`);
