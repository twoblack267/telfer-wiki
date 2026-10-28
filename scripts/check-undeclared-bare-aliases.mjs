/**
 * check-undeclared-bare-aliases.mjs — the gate for a URL that WAS live and now 404s
 * because nobody declared its successor.
 *
 * WHY (Skippy, 2026-10-29):
 *   commit bd834e0 ("Publish a person once") retired undated duplicate pages, correctly.
 *   The law it documented: a retired profile must be declared in
 *   src/data/removed-redirects.json with `to: <survivor slug>`, because
 *   generate-redirects.mjs rebuilds redirect-log.json every run and wipes hand-added
 *   entries.
 *
 *   /people/adam-murray/ and /people/john-telfer-of-castleton/ were retired by that
 *   gate WITHOUT a declaration. Both had previously served a 301 to their alias. On the
 *   29 Oct deploy they became hard 404s while every gate stayed green:
 *
 *     - check-redirect-health.mjs  only inspects aliases that were WRITTEN.
 *     - check-live-slug-regression.mjs compares against HEAD (or ONE commit back). A
 *       removal older than that is invisible: HEAD no longer contains the slug, so it
 *       is not "expected", and nothing asks why it left.
 *
 *   Two independent blind spots with the same shape: neither asks
 *   "which URL did we serve before, and does it still resolve?"
 *
 * WHAT THIS DOES
 *   Replays every slug present in a window of past people.json commits and asserts each
 *   one is served TODAY as either a real page or an alias stub. Anything else is a live
 *   URL that silently died. Exits 1 and prints the exact declaration to paste.
 *
 * Usage:
 *   node scripts/check-undeclared-bare-aliases.mjs [--commits N] [--limit N]
 *   node scripts/check-undeclared-bare-aliases.mjs --commits 40 --limit 0   # full window
 *
 * Exit: 0 clean, 1 undeclared dead URLs found, 2 could not measure (never a false pass).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const JSON_REL = 'src/data/people.json';
const DIST = path.join(REPO, 'dist/people');
const DECL = path.join(REPO, 'src/data/removed-redirects.json');

const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : dflt;
};
const COMMITS = Number(argVal('--commits', '40'));
const LIMIT = Number(argVal('--limit', '25'));

function asPeople(p) {
  if (Array.isArray(p)) return p;
  for (const k of ['people', 'profiles']) if (Array.isArray(p[k])) return p[k];
  throw new Error('cannot locate people array');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// --- what the build serves ---------------------------------------------------
if (!fs.existsSync(DIST)) {
  console.error('✋ check-undeclared-bare-aliases: no dist/ — build first. Cannot measure.');
  process.exit(2);
}
const served = new Set(fs.readdirSync(DIST));
// A directory with an index.html is served. Files (index.html itself) are not slugs.
for (const entry of fs.readdirSync(DIST)) {
  if (!fs.statSync(path.join(DIST, entry)).isDirectory()) served.delete(entry);
}

// --- what we served before ---------------------------------------------------
let refs = [];
try {
  refs = git(['log', `-${COMMITS}`, '--format=%H', '--', JSON_REL])
    .trim()
    .split('\n')
    .filter(Boolean);
} catch (e) {
  console.error(`✋ could not read git history: ${e.message}. Cannot measure.`);
  process.exit(2);
}
if (refs.length === 0) {
  console.error('✋ no commits touched people.json. Cannot measure.');
  process.exit(2);
}

const historical = new Map(); // slug -> first commit it appeared in
for (const ref of refs) {
  let rows;
  try {
    rows = asPeople(JSON.parse(git(['show', `${ref}:${JSON_REL}`])));
  } catch {
    continue; // file absent at that ref
  }
  for (const p of rows) {
    if (p.slug && !historical.has(p.slug)) historical.set(p.slug, ref.slice(0, 8));
  }
}

// --- declared retirements are legitimate deaths ------------------------------
let declared = new Set();
try {
  const d = JSON.parse(fs.readFileSync(DECL, 'utf8'));
  declared = new Set(Object.keys(d.removed || {}));
} catch (e) {
  console.error(`✋ could not read removed-redirects.json: ${e.message}. Cannot measure.`);
  process.exit(2);
}

const dead = [];
for (const [slug, ref] of historical) {
  if (served.has(slug)) continue;
  if (declared.has(slug)) continue; // declared: generate-redirects.mjs emits it
  dead.push({ slug, ref });
}

console.log(`🔎 undeclared-alias gate: ${historical.size} slug(s) seen across ${refs.length} commit(s); build serves ${served.size}; ${declared.size} declared retirement(s)`);

if (dead.length === 0) {
  console.log('✅ clean: every slug we have ever served is still served or deliberately declared.');
  process.exit(0);
}

console.error(`\n❌ ${dead.length} URL(s) were served before and are served by nothing now, with no declaration.`);
console.error('   Each one is a live link, bookmark or search result that now 404s.\n');
for (const d of dead.slice(0, LIMIT || dead.length)) {
  const guess = served.has(`${d.slug}`) ? '' : `  (last seen at ${d.ref})`;
  console.error(`   • /people/${d.slug}/${guess}`);
}
if (LIMIT && dead.length > LIMIT) console.error(`   … ${dead.length - LIMIT} more (raise --limit)`);

console.error(`
FIX — declare each one in src/data/removed-redirects.json under "removed", with the
surviving slug (never invent one; point only at a page that exists):

  "${dead[0].slug}": {
    "to": "<survivor-slug>",
    "reason": "why the old URL moved",
    "date": "${new Date().toISOString().slice(0, 10)}",
    "corrections_log": "<Corrections Log heading>"
  }

Then re-run scripts/regenerate-data.sh. Do NOT hand-edit src/data/redirect-log.json —
generate-redirects.mjs rebuilds it every run and wipes hand-added entries.`);
process.exit(1);
