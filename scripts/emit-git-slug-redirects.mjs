/**
 * emit-git-slug-redirects.mjs
 *
 * WHY THIS EXISTS (Skippy, 2026-09-13, tw-2026-09-13-007):
 *
 * scripts/generate-redirects.mjs is built on a HEURISTIC: it reconstructs the "old slug"
 * from a person's CURRENT fields (firstname-lastname[-YYYY]) and redirects that guess.
 * That can only ever work when the old slug was derivable from data that still exists.
 *
 * It fails completely on the class of change where a FIELD ITSELF changed - which is
 * exactly what shipped in the unpushed regen:
 *   - Sophia Webster (1800)  ->  Sophia March (1803)   (surname changed; maiden -> married)
 *   - and a site-wide flip of the slug scheme: every bare slug gained a birth-year suffix
 *     (aaron-ivory -> aaron-ivory-1989), 216 live URLs in total.
 *
 * For the flip, the heuristic computes oldSlug = 'aaron-ivory-1989' (bare+year), sees it
 * differs from the new slug, and emits a redirect FROM A URL THAT NEVER EXISTED - while
 * never emitting one from 'aaron-ivory', the URL that is live today. 216 real URLs would
 * 404 while the log looked healthy.
 *
 * THE FIX: the old slugs are not a secret. They are a FACT, sitting in git. Read them.
 *   old data  =  git show HEAD:src/data/people.json     (== what the live site serves)
 *   new data  =  src/data/people.json                   (the working tree)
 * Diff the two slug sets and emit a redirect for every old slug that no longer exists.
 * No heuristic can lie about a slug it read directly.
 *
 * Sophistry guard: if ANY old slug cannot be matched to a successor, this script FAILS
 * LOUDLY. It must never quietly emit 215 of 216 and report success - that is the exact
 * failure mode being fixed here.
 *
 * Usage:
 *   node scripts/emit-git-slug-redirects.mjs                # report + write redirect-log-git.json
 *   node scripts/emit-git-slug-redirects.mjs --write-pages  # also write dist/people/<old>/index.html
 *   node scripts/emit-git-slug-redirects.mjs --ref <ref>    # override the "old" ref (default HEAD)
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const WRITE_PAGES = args.includes('--write-pages');
const REF_IDX = args.indexOf('--ref');
const REF = REF_IDX !== -1 ? args[REF_IDX + 1] : 'HEAD';

const OLD_JSON_REL = 'src/data/people.json';
const NEW_JSON_ABS = path.join(REPO, OLD_JSON_REL);
const DIST_DIR = path.join(REPO, 'dist/people');
const LOG_ABS = path.join(REPO, 'scripts/redirect-log-git.json');
const ABS_BASE = 'https://telferwiki.com';

function bail(msg) {
  console.error(`\n\u274c FATAL: ${msg}\n`);
  process.exit(1);
}

function asPeople(parsed) {
  if (Array.isArray(parsed)) return parsed;
  for (const k of ['people', 'profiles']) if (Array.isArray(parsed[k])) return parsed[k];
  bail('could not locate the people array in people.json');
}

// --- read the OLD data straight out of git ---------------------------------
let oldRaw;
try {
  oldRaw = execFileSync('git', ['-C', REPO, 'show', `${REF}:${OLD_JSON_REL}`], { encoding: 'utf-8', maxBuffer: 1 << 28 });
} catch (e) {
  bail(`git could not read ${REF}:${OLD_JSON_REL} (${e.message.split('\n')[0]}). Refusing to guess.`);
}
const OLD = asPeople(JSON.parse(oldRaw));
const NEW = asPeople(JSON.parse(fs.readFileSync(NEW_JSON_ABS, 'utf-8')));

const oldBySlug = new Map();
for (const p of OLD) if (p.slug) oldBySlug.set(p.slug, p);
const newBySlug = new Map();
for (const p of NEW) if (p.slug) newBySlug.set(p.slug, p);

const vanished = [...oldBySlug.keys()].filter((s) => !newBySlug.has(s)).sort();
const appeared = [...newBySlug.keys()].filter((s) => !oldBySlug.has(s)).sort();

// --- identity fallback chain -------------------------------------------------
// Not a guess: four independent signals, tried in order of decreasing strength.
// Sophia Webster needs #3, so #3 has to exist or she 404s alone.
function tagKey(p) {
  const t = (p.tags || [])
    .map((x) => String(x).toLowerCase())
    .filter((x) => x !== 'person' && x !== 'ancestor' && x !== 'brick-wall' && x !== 'australian-immigrant');
  return t.sort().join('|');
}
function nameKey(p) {
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).map(String).join(' ');
}

const idx = {
  display_name: new Map(),
  vault_file: new Map(),
  tagset: new Map(),
  namekey: new Map(),
};
// NOTE (2026-09-18, tw-2026-09-17-007): this index used to be built from `appeared`
// ONLY — slugs that are new in this regen. That made the fallback chain blind to the
// commonest rename of all: one where the OLD slug vanishes and the NEW slug is a page
// that ALREADY EXISTED (e.g. a phantom `name-~1892` twin is purged and the true
// `name` page survives). `appeared` is empty in exactly that case, so the index was
// empty, so every vanished slug became "unresolvable" and the build refused — or worse,
// on a run where `appeared` was non-empty by luck, matched against the wrong person.
// Index ALL current slugs. A slug that exists today is a legitimate redirect target
// whether it is brand new or pre-existing.
for (const s of newBySlug.keys()) {
  const p = newBySlug.get(s);
  const push = (map, key) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  };
  push(idx.display_name, (p.display_name || '').trim());
  push(idx.vault_file, p.vault_file);
  push(idx.tagset, tagKey(p));
  push(idx.namekey, nameKey(p));
}

const matched = [];
const unresolved = [];
for (const oldSlug of vanished) {
  const o = oldBySlug.get(oldSlug);
  const attempts = [
    ['display_name', (o.display_name || '').trim()],
    ['vault_file', o.vault_file],
    ['tagset', tagKey(o)],
    ['namekey', nameKey(o)],
  ];
  let found = null;
  for (const [how, key] of attempts) {
    const cands = idx[how].get(key);
    if (cands && cands.length === 1) { found = { to: cands[0], how }; break; }
  }
  if (found) matched.push({ from: oldSlug, to: found.to, matched_by: found.how, display_name: o.display_name });
  else unresolved.push({ from: oldSlug, display_name: o.display_name, vault_file: o.vault_file, tags: o.tags });
}

// --- THE GATE: refuse to be 215/216 -----------------------------------------
if (unresolved.length) {
  console.error(`\n\u274c ${unresolved.length} live URL(s) could NOT be matched to a successor:`);
  for (const u of unresolved) console.error(`   /people/${u.from}/   (${u.display_name}; ${u.vault_file})`);
  console.error(`\nRefusing to emit a partial redirect set. Every one of the ${vanished.length} live URLs`);
  console.error(`must resolve, or the rest of the set is a false sense of safety.\n`);
  process.exit(1);
}

// --- shape of the change, reported honestly ---------------------------------
console.log(`\nComparing ${REF} -> working tree  (${OLD.length} -> ${NEW.length} people)`);
console.log(`  live URLs that vanish : ${vanished.length}`);
console.log(`  new URLs appearing    : ${appeared.length}`);
const byHow = {};
for (const m of matched) byHow[m.matched_by] = (byHow[m.matched_by] || 0) + 1;
console.log(`  matched by            : ${Object.entries(byHow).map(([k, v]) => `${k}=${v}`).join(', ')}`);

const interesting = matched.filter((m) => m.matched_by !== 'display_name');
if (interesting.length) {
  console.log(`\n  (matched by a fallback signal - these are the ones a name-based diff would have dropped)`);
  for (const m of interesting) console.log(`    /people/${m.from}/ -> /people/${m.to}/   [via ${m.matched_by}]`);
}

// --- write pages -------------------------------------------------------------
fs.mkdirSync(path.dirname(LOG_ABS), { recursive: true });
fs.writeFileSync(LOG_ABS, JSON.stringify(matched, null, 2));

if (WRITE_PAGES) {
  let written = 0, skipped = 0;
  for (const r of matched) {
    const dir = path.join(DIST_DIR, r.from);
    const file = path.join(dir, 'index.html');
    // never overwrite a real page with a redirect stub
    if (fs.existsSync(file) && !fs.readFileSync(file, 'utf-8').includes('http-equiv="refresh"')) {
      skipped++;
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    const target = `${ABS_BASE}/people/${r.to}/`;
    fs.writeFileSync(file, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Redirecting to ${r.display_name}</title>
  <meta http-equiv="refresh" content="0;url=${target}">
  <link rel="canonical" href="${target}">
  <meta name="robots" content="noindex">
</head>
<body>
  <p>Redirecting to <a href="${target}">${r.display_name}</a>...</p>
</body>
</html>
<script>location.replace('${target}');</script>`);
    written++;
  }
  console.log(`\n  wrote ${written} redirect page(s) into dist/people/  (skipped ${skipped} real page(s))`);
}

console.log(`\n\u2705 ${matched.length}/${vanished.length} live URLs covered. Log: scripts/redirect-log-git.json\n`);
