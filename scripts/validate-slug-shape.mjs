#!/usr/bin/env node
/**
 * validate-slug-shape.mjs — the guard for the class every other gate cannot see.
 *
 * WHY (card tw-2026-09-13-034):
 *   On 2026-09-13 a batch process ("Zabella clobber") overwrote the BODY of 101 person
 *   profiles in the vault. An emergency recovery spliced pre-corruption bodies back from a
 *   verified snapshot, but kept the freshly regenerated FRONTMATTER. The regeneration that
 *   followed re-derived relationship fields from the vault's *name strings* (via
 *   convert-markdown.mjs) and never re-ran slug resolution — because scripts/resolve-refs.mjs
 *   was referenced by NOTHING in scripts/, package.json or .github/.
 *
 *   Effect: `children:`/`parents:`/`spouses:` silently held raw display names
 *   ("Levi Leonard Timothy Telfer") instead of slugs ("levi-telfer-2017"). The profiles
 *   stop being interlinked, but the site still renders names, so nothing visibly breaks.
 *
 * WHY NO EXISTING GATE CAUGHT IT:
 *   - validate-people.mjs        : counts invalid refs, but never asserts SHAPE.
 *   - validate-children-reconcile: compares `children:` vs `relationships:` — both carried
 *                                  the SAME raw names, so there was nothing to "reconcile".
 *   - scan-cross-branch.mjs      : sibling/parent contradiction only.
 *   - validate-no-mark-refs.py   : "Mark's" strings only.
 *   All four exit 0 on a fully slug-degraded tree. That silence IS the hazard.
 *
 * WHAT THIS ASSERTS (fails closed):
 *   A. FLOOR: the number of slug-shaped relationship entries must not drop below a committed
 *      baseline (scripts/slug-shape.baseline.json), minus a tiny tolerance. A regen that
 *      re-imports raw names drops this count hard.
 *   B. NO BARE DISPLAY NAMES: no relationship entry may be a bare display name of a person
 *      who has a resolvable slug (i.e. a name where a slug could have been used).
 *   C. BARE DUPLICATE OF A QUALIFIED SIBLING: within one person's ONE field, a bare name
 *      must not duplicate a year-qualified name of the same person ("Levi ... Telfer" next
 *      to "Levi ... Telfer (2017-?)"). This is the exact Kylie signature from the card:
 *      2 slugs regressed to 4 raw names, 2 of them bare duplicates.
 *
 * Baseline refresh (deliberate, reviewable): run with --write-baseline.
 *
 * Usage: node scripts/validate-slug-shape.mjs [--write-baseline] [--quiet]
 *   exits 0 clean, 1 on any violation.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PEOPLE_JSON = path.join(REPO, 'src/data/people.json');
const BASELINE_JSON = path.join(__dirname, 'slug-shape.baseline.json');

const WRITE_BASELINE = process.argv.includes('--write-baseline');
const QUIET = process.argv.includes('--quiet');

const FIELDS = ['children', 'parents', 'spouses'];
// Tolerance: relationship data genuinely shrinks a little when vault records are corrected
// (a disproven child removed, a merge). 3% + 5 absolute absorbs legitimate curation while
// still firing loudly on a mass regression (the card's event would have removed ~85%).
const TOL_PCT = 0.03;
const TOL_ABS = 5;

// A slug: lowercase, digits, hyphens, optional leading alphanumerics. Also tolerates the
// legitimate tilde used in approximate-year slugs (charles-farrow-jr-~1865, florence-nicholas-~1885)
// — those ARE slugs, not defects; excluding them would be the regex artefact, not the data.
const SLUG_RE = /^[a-z0-9][a-z0-9~-]*$/;

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));

// ── Index helpers ────────────────────────────────────────────────────────────
const slugSet = new Set(people.map((p) => p.slug));
const displayLower = new Map(); // lowercased display_name -> slug
const shortLower = new Map();   // "first last" (lower) -> [slug, ...]
for (const p of people) {
  if (p.display_name) {
    const d = p.display_name.toLowerCase().trim();
    if (!displayLower.has(d)) displayLower.set(d, p.slug);
  }
  const short = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().trim();
  if (short && short !== ' ') {
    if (!shortLower.has(short)) shortLower.set(short, []);
    shortLower.get(short).push(p.slug);
  }
}

const stripAnnotation = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Is this entry usable as a resolvable slug? */
const isSlug = (ref) => typeof ref === 'string' && SLUG_RE.test(ref);

/**
 * Could this raw name have been written as a slug (i.e. is there a person it points at)?
 * Only then is a raw name a DEFECT rather than a legitimately-unresolvable label.
 */
function resolvableName(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const lower = ref.toLowerCase().trim();
  if (displayLower.has(lower)) return { slug: displayLower.get(lower), how: 'display_name' };
  const bare = stripAnnotation(ref).toLowerCase().trim();
  if (shortLower.has(bare) && shortLower.get(bare).length === 1) {
    return { slug: shortLower.get(bare)[0], how: 'first+last' };
  }
  if (shortLower.has(bare) && shortLower.get(bare).length > 1) {
    // ambiguous but still name-shaped-and-resolvable-in-principle
    return { slug: null, how: `first+last (${shortLower.get(bare).length} candidates)`, ambiguous: true };
  }
  return null;
}

// ── Measure ──────────────────────────────────────────────────────────────────
let slugShaped = 0;
let totalEntries = 0;
let profilesWithSlug = 0;
for (const p of people) {
  let any = false;
  for (const f of FIELDS) {
    const v = p[f];
    if (!Array.isArray(v)) continue;
    for (const ref of v) {
      totalEntries++;
      if (isSlug(ref)) { slugShaped++; any = true; }
    }
  }
  if (any) profilesWithSlug++;
}
const profileCount = people.length;

const current = {
  people: profileCount,
  relationship_entries: totalEntries,
  slug_shaped: slugShaped,
  profiles_with_slug_shaped: profilesWithSlug,
};

if (WRITE_BASELINE) {
  const existing = fs.existsSync(BASELINE_JSON) ? JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf-8')) : {};
  const out = {
    _comment:
      'Baseline for scripts/validate-slug-shape.mjs (card tw-2026-09-13-034). ' +
      'Refresh deliberately with --write-baseline and review the diff: a large drop is the defect, not the fix.',
    recorded_at: new Date().toISOString(),
    ...current,
    previous: existing.slug_shaped != null
      ? { slug_shaped: existing.slug_shaped, recorded_at: existing.recorded_at }
      : null,
  };
  fs.writeFileSync(BASELINE_JSON, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  console.log(`✅ wrote baseline ${path.relative(REPO, BASELINE_JSON)}: ` +
    `${slugShaped}/${totalEntries} slug-shaped across ${profileCount} profiles`);
  process.exit(0);
}

const problems = [];
const warnings = [];

// ── A. FLOOR ─────────────────────────────────────────────────────────────────
let baseline = null;
if (fs.existsSync(BASELINE_JSON)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf-8'));
  const floor = Math.max(
    Math.floor(baseline.slug_shaped * (1 - TOL_PCT)),
    baseline.slug_shaped - TOL_ABS,
  );
  if (slugShaped < floor) {
    const drop = baseline.slug_shaped - slugShaped;
    const pct = ((drop / baseline.slug_shaped) * 100).toFixed(1);
    problems.push(
      `SLUG-SHAPE FLOOR BREACHED: ${slugShaped} slug-shaped relationship entries, ` +
      `floor ${floor} (baseline ${baseline.slug_shaped} recorded ${baseline.recorded_at}). ` +
      `A drop of ${drop} (${pct}%).\n` +
      `     This is the tw-2026-09-13-034 signature: a regeneration re-imported RAW ` +
      `frontmatter names because resolve-refs.mjs did not run.\n` +
      `     FIX (never hand-edit the JSON): bash scripts/regenerate-data.sh\n` +
      `     If the drop is genuinely correct (records were corrected/removed), refresh ` +
      `deliberately: node scripts/validate-slug-shape.mjs --write-baseline`,
    );
  }
} else {
  warnings.push(
    `no baseline at ${path.relative(REPO, BASELINE_JSON)} — floor check SKIPPED ` +
    `(shape checks B and C still ran). Create it: node scripts/validate-slug-shape.mjs --write-baseline`,
  );
}

// ── B + C. Bare display names and bare-duplicate-of-qualified-sibling ────────
let bareTotal = 0;
const bareSamples = [];
for (const p of people) {
  for (const f of FIELDS) {
    const v = p[f];
    if (!Array.isArray(v)) continue;

    // index this field's entries for the sibling-duplicate test (C)
    const qualified = new Map(); // bare-alnum-key -> [raw entries with a qualifier]
    for (const ref of v) {
      if (isSlug(ref) || typeof ref !== 'string') continue;
      const m = ref.match(/^(.*\S)\s*\([^)]*\)\s*$/);
      if (m) {
        const key = m[1].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!qualified.has(key)) qualified.set(key, []);
        qualified.get(key).push(ref);
      }
    }

    for (const ref of v) {
      if (isSlug(ref) || typeof ref !== 'string') continue;
      const res = resolvableName(ref);
      if (!res) continue; // unresolvable label (e.g. a non-person note) — not this defect
      bareTotal++;
      if (bareSamples.length < 15) {
        bareSamples.push(`${p.slug} → ${f}: "${ref}"${res.slug ? ` could be slug "${res.slug}"` : ''}`);
      }

      // C. bare name duplicating a qualified sibling in the SAME field
      const bareKey = stripAnnotation(ref).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (qualified.has(bareKey)) {
        problems.push(
          `BARE DUPLICATE: ${p.slug} → ${f} has bare "${ref}" alongside qualified ` +
          `${JSON.stringify(qualified.get(bareKey))} — same person written twice, one unresolved.`,
        );
      }
    }
  }
}

if (bareTotal > 0) {
  problems.push(
    `BARE DISPLAY NAMES IN RELATIONSHIP FIELDS: ${bareTotal} entr${bareTotal === 1 ? 'y' : 'ies'} ` +
    `is a raw name where a slug resolves.\n` +
    bareSamples.map((s) => `     • ${s}`).join('\n') +
    (bareTotal > bareSamples.length ? `\n     … and ${bareTotal - bareSamples.length} more` : '') +
    `\n     FIX (never hand-edit the JSON): bash scripts/regenerate-data.sh`,
  );
}

// ── Report ───────────────────────────────────────────────────────────────────
if (!QUIET) {
  console.log('── RELATIONSHIP SLUG-SHAPE (tw-2026-09-13-034) ────');
  console.log(`  profiles                       : ${profileCount}`);
  console.log(`  relationship entries (total)   : ${totalEntries}`);
  console.log(`  slug-shaped entries            : ${slugShaped}`);
  console.log(`  profiles with ≥1 slug-shaped   : ${profilesWithSlug}`);
  console.log(`  bare display names             : ${bareTotal}`);
  console.log(`  baseline                       : ${baseline ? `${baseline.slug_shaped} (${baseline.recorded_at})` : 'ABSENT'}`);
  console.log('');
  for (const w of warnings) console.log(`⚠️  ${w}\n`);
}

if (problems.length) {
  console.log('❌ SLUG-SHAPE GUARD FAILED:');
  problems.forEach((p) => console.log(`   ${p}`));
  console.log('');
  console.log('   This guard exists because validate-people, scan-cross-branch, no-mark-refs and');
  console.log('   children-reconcile ALL exit 0 on a fully slug-degraded tree.');
  process.exit(1);
}

if (!QUIET) console.log('✅ SLUG-SHAPE CLEAN — relationship refs are slugs, above baseline.');
process.exit(0);
