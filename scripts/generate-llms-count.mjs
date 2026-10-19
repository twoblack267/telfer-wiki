/**
 * generate-llms-count.mjs
 * ─────────────────────────
 * Build-time guard + self-heal for the person-count line in llms.txt,
 * so the "All N individuals" figure can NEVER drift from the data again.
 *
 * WHY IT EXISTS
 *   llms.txt is a hand-maintained AI/SEO reference file. Its closing line
 *   hard-codes the number of people on the site ("All 329 individuals …").
 *   Every time people.public.json grew, the hand-written count went stale
 *   (329 vs 331 — it drifted TWICE: tw-2026-08-28-itcrew-000, then
 *   tw-2026-08-30-itcrew-001). A build-time derivation removes the failure.
 *
 * WHAT IT DOES
 *   1. Reads the REAL public person count from src/data/people.public.json
 *      (same source the /people index renders from).
 *   2. Takes the static prose template from public/llms.txt.
 *   3. Rewrites the "All N individuals …" sentence with the derived count,
 *      writing the corrected file into dist/ (the shipped artifact). Astro
 *      copies public/ → dist/, then this runs in postbuild to fix the count.
 *   4. If the count @dist differs from @public (i.e. public is stale), it
 *      ALSO refreshes public/llms.txt in place so the versioned source of
 *      truth tracks reality — no third drift, no CI trip. If the repo is
 *      committed afterwards, the corrected public file ships on next build.
 *
 * This inverts the previous failure mode: instead of a human remembering to
 * bump a number, the number is recomputed every build from the data.
 *
 * USAGE
 *   node scripts/generate-llms-count.mjs   (called from package.json postbuild)
 *   Optional: --root <path>  (for CI, defaults to process.cwd()).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv.includes('--root')
  ? join(process.cwd(), process.argv[process.argv.indexOf('--root') + 1])
  : process.cwd();

const PUBLIC_LLMS = join(ROOT, 'public', 'llms.txt');
const DIST_LLMS = join(ROOT, 'dist', 'llms.txt');
const DATA = join(ROOT, 'src', 'data', 'people.public.json');
const PRIVACY = join(ROOT, 'src', 'data', 'privacy-exclusions.mjs');

/** The line in llms.txt that carries the person count. */
const COUNT_LINE = /(All) (\d+) (individuals documented on the site[^\n]*)/i;
/** The line in llms.txt that states how many pages carry robots noindex. */
const NOINDEX_LINE = /(A small number of pages can be deliberately privacy-noindexed[^\n]*?)(?: The current noindex set[^\n]*)?$/im;
const NOINDEX_STATE = /\*\*Currently \d+ person pages? (?:is|are),? carrying[^\n]*\n\n?/i;

function fail(msg) {
  console.error(`❌ generate-llms-count: ${msg}`);
  process.exit(1);
}

// ── 1. Source of truth: the real person count ──
if (!existsSync(DATA)) fail(`missing ${DATA} — run npm run sanitize / astro build first`);
let personCount;
try {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  // people.public.json is a flat array of people (mirrors src/pages/people/index.astro).
  const arr = Array.isArray(data) ? data : (data.people || []);
  personCount = arr.filter((p) => p && (p.branch === 'telfer' || !p.branch) && p.id).length;
  if (!Number.isFinite(personCount) || personCount <= 0) {
    fail(`derived person count is invalid (${personCount}) from ${DATA}`);
  }
} catch (e) {
  fail(`could not read/parse ${DATA}: ${e.message}`);
}

// ── 1b. Source of truth: how many person pages actually carry robots noindex ──
// llms.txt used to assert "As of 2026-09-08 no page is noindexed". That went stale
// the moment the Ivory privacy withdrawal landed (eb8a021) and nobody regenerated
// it, so the file an AI crawler reads contradicted the site itself — card
// tw-2026-10-19-003. The count is now DERIVED from privacy-exclusions.mjs on every
// build, exactly like the person count, so it cannot drift again.
let noindexCount = null;
try {
  const src = readFileSync(PRIVACY, 'utf8');
  // NOINDEX_SLUGS is defined as `new Set([...PRIVACY_STRIP_SLUGS])` — a SPREAD, not
  // literal strings. Matching string literals there yields zero and would silently
  // publish "no person page is noindexed" while six pages carry the tag. Resolve the
  // spread against PRIVACY_STRIP_SLUGS and only use literals when it is a real list.
  const stripMatch = src.match(/export const PRIVACY_STRIP_SLUGS\s*=\s*new Set\(([\s\S]*?)\)\s*;/);
  const literals = (body) =>
    new Set([...body.matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]));
  const m = src.match(/export const NOINDEX_SLUGS\s*=\s*new Set\(([\s\S]*?)\)\s*;/);
  if (!m) fail(`could not parse NOINDEX_SLUGS from ${PRIVACY}`);
  if (m[1].includes("PRIVACY_STRIP_SLUGS")) {
    if (!stripMatch) fail(`NOINDEX_SLUGS spreads PRIVACY_STRIP_SLUGS but that set is missing`);
    noindexCount = literals(stripMatch[1]).size;
  } else {
    noindexCount = literals(m[1]).size;
  }
  if (!Number.isFinite(noindexCount)) fail(`derived noindex count is invalid`);
} catch (e) {
  fail(`could not read ${PRIVACY}: ${e.message}`);
}

/** Replace (or append) the derived noindex-state sentence in llms.txt prose. */
const rewriteNoindex = (content) => {
  const sentence =
    noindexCount === 0
      ? `**Currently no person page is noindexed** — every individual page is publicly indexable.`
      : `**Currently ${noindexCount} person page${noindexCount === 1 ? " is" : "s are"} carrying \`noindex, nofollow\` and excluded from the sitemap** — see \`src/data/privacy-exclusions.mjs\` for the list.`;
  if (!NOINDEX_LINE.test(content)) {
    return { ok: false, detail: "no privacy-noindexed reference line found" };
  }
  const out = content
    .replace(NOINDEX_STATE, "")
    .replace(NOINDEX_LINE, (m0, base) => `${base.trim()} ${sentence}`);
  return { ok: true, out, detail: `noindex count -> ${noindexCount}` };
};

// ── 2. Template prose (from the tracked source file) ──
if (!existsSync(PUBLIC_LLMS)) fail(`missing template ${PUBLIC_LLMS}`);
const template = readFileSync(PUBLIC_LLMS, 'utf8');

const rewrite = (content, banner) => {
  if (!COUNT_LINE.test(content)) {
    return { ok: false, detail: `${banner} — no matching "All N individuals" line found` };
  }
  return { ok: true, out: content.replace(COUNT_LINE, (_m, all, _oldN, rest) => `${all} ${personCount} ${rest}`), detail: `${banner} -> set to ${personCount}` };
};

// ── 3. Write corrected artifact to dist/ ──
let ship = null;
if (!existsSync(DIST_LLMS)) {
  console.error(`⚠️ generate-llms-count: ${DIST_LLMS} not present (postbuild runs after astro build) — writing fresh copy.`);
  writeFileSync(DIST_LLMS, template.replace(COUNT_LINE, (_m, all, _oldN, rest) => `${all} ${personCount} ${rest}`), 'utf8');
  ship = `dist/llms.txt generated with count ${personCount}`;
} else {
  const cur = readFileSync(DIST_LLMS, 'utf8');
  const r = rewrite(cur, 'dist/llms.txt');
  if (!r.ok) fail(`dist/llms.txt count line malformed: ${r.detail}`);
  if (!cur.includes(`All ${personCount} individuals `)) {
    writeFileSync(DIST_LLMS, r.out, 'utf8');
    console.log(`  🔧 generate-llms-count: ${r.detail} (shipped artifact corrected)`);
    ship = `dist/llms.txt corrected to ${personCount}`;
  } else {
    console.log(`  ✅ generate-llms-count: dist/llms.txt already reports ${personCount} — clean`);
    ship = `dist/llms.txt already ${personCount}`;
  }
}

// ── 4. Keep the versioned source in sync so the NEXT build can't ship a stale number ──
let srcMsg = 'public/llms.txt already correct';
if (!template.includes(`All ${personCount} individuals `)) {
  writeFileSync(PUBLIC_LLMS, rewrite(template, 'public/llms.txt').out, 'utf8');
  console.log(`  🔧 generate-llms-count: rewrote public/llms.txt count to ${personCount} (versioned source of truth — commit this)`);
  srcMsg = `public/llms.txt refreshed to ${personCount} in place`;
}

// ── 5. Same treatment for the noindex-state sentence, in BOTH artifacts ──
// The guard previously policed only the person count, so the privacy sentence could
// rot silently for as long as nobody read that line. It is now policed too.
const NOINDEX_CLAIM = new RegExp(
  noindexCount === 0
    ? "Currently no person page is noindexed"
    : `Currently ${noindexCount} person page`
);
for (const [path, banner] of [[DIST_LLMS, 'dist/llms.txt'], [PUBLIC_LLMS, 'public/llms.txt']]) {
  if (!existsSync(path)) continue;
  const cur = readFileSync(path, 'utf8');
  const r = rewriteNoindex(cur);
  if (!r.ok) fail(`${banner} noindex line malformed: ${r.detail}`);
  if (NOINDEX_CLAIM.test(cur)) {
    console.log(`  ✅ generate-llms-count: ${banner} noindex state correct (${noindexCount})`);
  } else {
    writeFileSync(path, r.out, 'utf8');
    console.log(`  🔧 generate-llms-count: ${banner} ${r.detail} (corrected — commit this)`);
    if (path === PUBLIC_LLMS) srcMsg += `; noindex sentence corrected`;
  }
}

console.log(`🌳 generate-llms-count: real person count = ${personCount}, noindex = ${noindexCount} — ${ship}; ${srcMsg}`);
