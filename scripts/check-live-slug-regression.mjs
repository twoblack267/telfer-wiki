/**
 * check-live-slug-regression.mjs — the gate for the failure the OTHER gate cannot see.
 *
 * WHY (Skippy, 2026-09-13, tw-2026-09-13-007):
 *   scripts/check-redirect-health.mjs validates every alias page that EXISTS:
 *   noindex present, canonical absolute, target is a real page. It is good at that job.
 *   But it can only inspect aliases that were WRITTEN. It never asks the inverse question:
 *
 *       "Which URLs are live TODAY that this build will stop serving?"
 *
 *   An alias that was never generated is not a broken alias — it is INVISIBLE.
 *   So the redirect-health gate reported clean while (in the Sep-2026 regen) two live
 *   URLs - /people/sophia-webster/ and /people/amy-telfer-nicole/ - would have 404'd.
 *   A URL that has been linked, bookmarked or indexed is content. Silent loss of it is a
 *   content regression, and nothing in the pipeline was measuring it.
 *
 * WHAT THIS DOES
 *   For every slug that the LIVE-GOOD reference ref (default: last deploy tag / HEAD)
 *   documented as a person, require that this build serves it as EITHER:
 *       (a) a real person page  dist/people/<slug>/index.html   (not a meta-refresh stub), OR
 *       (b) an alias/redirect stub pointing at a real page.
 *   If a slug is neither, the URL is about to 404 and the deploy is blocked.
 *
 *   Deliberately compares against a REF, not against src/data: the question is not
 *   "did the data change" (it changed on purpose) but "will an address that used to work
 *   still work". Those are different questions and only the second one protects readers.
 *
 * Usage: node scripts/check-live-slug-regression.mjs [--ref <git-ref>]
 *   exits 0 clean, 1 listing every URL about to 404
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DIST_PEOPLE = path.join(REPO, 'dist/people');
const OLD_JSON_REL = 'src/data/people.json';
const MARKER = path.join(REPO, 'runtime', 'nw-slug-regression-fail');

const args = process.argv.slice(2);
const REF_IDX = args.indexOf('--ref');
const REF = REF_IDX !== -1 ? args[REF_IDX + 1] : 'HEAD';

function asPeople(p) {
  if (Array.isArray(p)) return p;
  for (const k of ['people', 'profiles']) if (Array.isArray(p[k])) return p[k];
  throw new Error('cannot locate people array');
}

// --- what SHOULD still be reachable (the live-good reference) ----------------
let expected = new Set();
try {
  const raw = execFileSync('git', ['-C', REPO, 'show', `${REF}:${OLD_JSON_REL}`], { encoding: 'utf-8', maxBuffer: 1 << 28 });
  for (const p of asPeople(JSON.parse(raw))) if (p.slug) expected.add(p.slug);
} catch (e) {
  // No ref / no git: cannot make an assertion. Do not pretend to have checked.
  console.log(`\n\u26a0\ufe0f  slug-regression gate SKIPPED: cannot read ${REF}:${OLD_JSON_REL} (${e.message.split('\n')[0]})`);
  process.exit(0);
}

// --- what this build WILL serve ---------------------------------------------
const real = new Set();
const stubs = new Set();
if (!fs.existsSync(DIST_PEOPLE)) {
  console.log('\n\u26a0\ufe0f  slug-regression gate SKIPPED: dist/people not found (run after astro build)');
  process.exit(0);
}
for (const entry of fs.readdirSync(DIST_PEOPLE, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const idx = path.join(DIST_PEOPLE, entry.name, 'index.html');
  if (!fs.existsSync(idx)) continue;
  const html = fs.readFileSync(idx, 'utf-8');
  if (html.includes('http-equiv="refresh"')) stubs.add(entry.name);
  else real.add(entry.name);
}

const lost = [...expected].filter((s) => !real.has(s) && !stubs.has(s)).sort();

function markFailure(list) {
  try {
    fs.mkdirSync(path.dirname(MARKER), { recursive: true });
    fs.writeFileSync(MARKER, `slug-regression gate failed ${new Date().toISOString()}\n${list.join('\n')}\n`);
  } catch (_) {}
}
function clearMarker() { try { fs.rmSync(MARKER, { force: true }); } catch (_) {} }

console.log(`\n\ud83d\udd0e slug-regression gate: ref ${REF} expects ${expected.size} live slug(s); build serves ${real.size} real + ${stubs.size} alias`);
if (lost.length) {
  console.error(`\n\u274c ${lost.length} URL(s) that are live in ${REF} will 404 after this build:\n`);
  for (const s of lost) console.error(`   /people/${s}/`);
  console.error('\nFix by generating an alias for each: node scripts/emit-git-slug-redirects.mjs --write-pages');
  console.error('(A live URL that people linked to is content. Losing it silently is a regression.)\n');
  markFailure(lost);
  process.exitCode = 1;
} else {
  clearMarker();
  console.log('\u2705 slug-regression gate clean: every URL live in the reference is still served.\n');
}
