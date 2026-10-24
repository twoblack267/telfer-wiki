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

// ── Documented unresolved names (a named exception, not a blanket pass) ──────
// A relation pointing at a person who has NO profile cannot be written as a slug —
// there is nothing to point at. That is a research gap, not a defect in the refs,
// and the guard's own contract says so ("unresolvable label"). The list is explicit
// and reviewed so every entry states who the missing person is and why the closest
// same-named profile is NOT them. Never add an entry to silence a wrong-person match.
const UNRESOLVED_OK = new Map([
  [
    'Adam Telfer (bap. 1775)',
    'Child of Thomas Telfer (of Broadlee) and Agnes Mair, baptised 1775. Not ' +
      'adam-telfer-1771 (parents: James Telfer of Sorbietrees + Margaret Armstrong) ' +
      'and not adam-telfer-1799 (parents: james-telfer-1761 + Elizabeth Hutton) — ' +
      'different families. Profile not yet written.',
  ],
]);
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
const bySlug = new Map(people.map((p) => [p.slug, p]));
const displayLower = new Map(); // lowercased display_name -> slug
const shortLower = new Map();   // "first last" (lower) -> [slug, ...]
// Some vault profiles carry a disambiguating parenthetical inside last_name:
// last_name: "Telfer (shepherd)", "Telfer (of Castleton)", "Paynter (of Calstock)".
// The bare display name "William Telfer (shepherd)" is then NOT a match for the
// key "william telfer (shepherd)", so the name is reported as unresolved and the
// guard demands a regeneration — which is how the tw-2026-09-13-034 data loss gets
// triggered. Index the SURNAME BOTH WAYS instead: qualified and stripped. Nothing
// in the data changes, and the qualified surname still disambiguates.
const splitSurname = (last) => {
  const m = String(last || '').match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { base: m[1].trim(), qualifier: m[2].trim() } : { base: String(last || '').trim(), qualifier: '' };
};
for (const p of people) {
  if (p.display_name) {
    const d = p.display_name.toLowerCase().trim();
    if (!displayLower.has(d)) displayLower.set(d, p.slug);
  }
  const { base } = splitSurname(p.last_name);
  const keys = new Set();
  const raw = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().trim();
  if (raw && raw !== ' ') keys.add(raw);
  const stripped = `${p.first_name || ''} ${base}`.toLowerCase().trim();
  if (stripped && stripped !== ' ') keys.add(stripped);
  for (const k of keys) {
    if (!shortLower.has(k)) shortLower.set(k, []);
    if (!shortLower.get(k).includes(p.slug)) shortLower.get(k).push(p.slug);
  }
}

const stripAnnotation = (s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Is this entry usable as a resolvable slug? */
const isSlug = (ref) => typeof ref === 'string' && SLUG_RE.test(ref);

// ── Generation sanity ────────────────────────────────────────────────────────
// A first-name+surname match that lands on a person born AFTER the referrer, or
// more than one generation away, is not a resolution — it is a collision. The
// vault is full of repeated forenames (two Hugh Parkers, two John Lawries, three
// Joseph Marches). Matching "Hugh Parker" to whichever Hugh Parker exists is how
// a father ends up born 37 years after his son. Only a year-plausible match counts.
const MAX_PARENT_GAP = 70; // years a parent may be older than their child
const MAX_CHILD_GAP = 70;  // years a child may be younger than their parent
const MIN_PARENT_GAP = 11; // a parent younger than this is impossible

/** Birth year of a person, or null. */
const birthOf = (p) => (p && typeof p.birth_year === 'number' ? p.birth_year : null);

/** Death year of a person, or null. Added 2026-10-24 — see generationPlausible. */
const deathOf = (p) => (p && typeof p.death_year === 'number' ? p.death_year : null);

/**
 * Does `candidate` make sense as the `field` relation of `person`?
 * Only used for the bare-name test, where the years are the sole evidence we have.
 * Unknown years never disqualify (they cannot contradict) — silence is not a defect.
 *
 * ADDED 2026-10-24 — DEATH DATES AND EXISTING EVIDENCE NOW COUNT.
 * This function previously read only birth_year, so it demanded bindings the resolver
 * had correctly refused. Four live false positives, and two of them were dangerous:
 *   • neil-telfer (b.1936) → "John Ernest Telfer" offered john-telfer-1877, who DIED
 *     in 1877. A man dead 59 years before the child was born is not his father.
 *   • richard-paynter-of-calstock → "Elizabeth Paynter" offered elizabeth-paynter-1864,
 *     who ALREADY has richard-paynter-1838 as her father. Binding it gives her three
 *     parents and lists her grandfather as a father.
 * A guard that demands a fabricated edge is worse than no guard: it trains you to
 * ignore it, and then it cannot protect you from anything.
 */
function generationPlausible(person, field, candidate) {
  const self = birthOf(person);
  const other = birthOf(candidate);
  const selfDeath = deathOf(person);
  const otherDeath = deathOf(candidate);

  // A parent who died before their child was born is impossible, whatever the births say.
  if (field === 'children' && selfDeath != null && other != null && other > selfDeath) return false;
  if (field === 'parents' && otherDeath != null && self != null && self > otherDeath) return false;
  // Two people whose lifespans never overlap cannot be spouses or siblings.
  if ((field === 'spouses' || field === 'siblings') &&
      self != null && selfDeath != null && other != null && otherDeath != null) {
    if (otherDeath < self || selfDeath < other) return false;
  }

  if (self == null || other == null) return true; // no evidence either way
  const gap = other - self; // positive = other is younger than person
  if (field === 'parents') {
    // parent must be older: gap should be negative
    if (gap > 0) return false;                     // parent born after the child
    return -gap >= MIN_PARENT_GAP && -gap <= MAX_PARENT_GAP;
  }
  if (field === 'children') {
    if (gap < 0) return false;                     // child born before the parent
    return gap >= MIN_PARENT_GAP && gap <= MAX_CHILD_GAP;
  }
  if (field === 'spouses' || field === 'siblings') {
    // contemporaries: no one marries or siblings someone born a century away
    return Math.abs(gap) <= MAX_PARENT_GAP;
  }
  return true;
}

/**
 * Could this raw name have been written as a slug (i.e. is there a person it points at)?
 * Only then is a raw name a DEFECT rather than a legitimately-unresolvable label.
 *
 * `person` and `field` are supplied so a name match that contradicts the years is
 * reported as UNRESOLVABLE rather than as a resolution. A bare name whose only
 * candidates are the wrong generation is a missing profile, not a slug defect.
 */
function resolvableName(ref, person, field) {
  if (!ref || typeof ref !== 'string') return null;
  const lower = ref.toLowerCase().trim();
  if (displayLower.has(lower)) {
    const slug = displayLower.get(lower);
    if (person && field && !generationPlausible(person, field, bySlug.get(slug))) return null;
    if (person && field && !evidenceFree(person, field, bySlug.get(slug))) return null;
    return { slug, how: 'display_name' };
  }
  const bare = stripAnnotation(ref).toLowerCase().trim();
  const candidates = shortLower.get(bare);
  if (!candidates) return null;
  // keep only candidates whose years do not contradict the relationship
  const plausible = person && field
    ? candidates.filter((s) => generationPlausible(person, field, bySlug.get(s)) &&
                               evidenceFree(person, field, bySlug.get(s)))
    : candidates;
  if (plausible.length === 1) return { slug: plausible[0], how: 'first+last' };
  if (plausible.length > 1) {
    return { slug: null, how: `first+last (${plausible.length} candidates)`, ambiguous: true };
  }
  return null; // every namesake is the wrong generation → this person has no profile
}

/**
 * ADDED 2026-10-24 — would binding this candidate claim something the data already
 * contradicts or already answers otherwise?
 *
 * The live case: richard-paynter-of-calstock (b.1816) lists a raw child "Elizabeth
 * Paynter", and elizabeth-paynter-1864 is the only namesake. Dates alone say the link
 * is possible (48-year gap), but she ALREADY has richard-paynter-1838 recorded as her
 * father — so of-calstock is her GRANDFATHER. Binding the raw name would give her
 * three parents and a grandparent as a father.
 *
 * The resolver refuses this because a raw name with a competing confirmed parent is
 * not evidence of a missing edge. The guard must apply the same reasoning, or it
 * spends its life demanding fabrications.
 */
function evidenceFree(person, field, candidate) {
  if (!person || !candidate) return true;
  // Accept either a slug or a person object. Callers in this file pass an already
  // resolved object (bySlug.get(s)); a version that resolved it a SECOND time here
  // silently returned true for every input, so the check never fired. Handle both.
  const target = typeof candidate === 'string' ? bySlug.get(candidate) : candidate;
  if (!target) return true;
  // Only parent/child can be "already answered". Someone can have many spouses and
  // siblings; nobody has a second biological father.
  if (field === 'children') {
    const existingParents = Array.isArray(target.parents) ? target.parents : [];
    const confirmed = existingParents.filter((s) => typeof s === 'string' && bySlug.has(s));
    if (confirmed.length && !confirmed.includes(person.slug)) return false;
  }
  if (field === 'parents') {
    const existingChildren = Array.isArray(target.children) ? target.children : [];
    const confirmed = existingChildren.filter((s) => typeof s === 'string' && bySlug.has(s));
    if (confirmed.length && !confirmed.includes(person.slug)) return false;
  }
  return true;
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
      if (UNRESOLVED_OK.has(ref)) continue; // documented missing profile — see UNRESOLVED_OK
      const res = resolvableName(ref, p, f);
      if (!res) continue; // unresolvable label (e.g. a non-person note) — not this defect
      bareTotal++;
      if (bareSamples.length < 15) {
        bareSamples.push(`${p.slug} → ${f}: "${ref}"${res.slug ? ` could be slug "${res.slug}"` : ''}`);
      }

      // C. bare name duplicating a qualified sibling in the SAME field
      const bareKey = stripAnnotation(ref).toLowerCase().replace(/[^a-z0-9]/g, '');
      // A "duplicate" needs a DIFFERENT entry in the same field. When the only
      // qualified match is this very string, the check is comparing the name to
      // itself and reporting a duplicate that does not exist — e.g. andrew-telfer-1798
      // parents ["William Telfer (shepherd)", "janet-nichol"]: one William, listed once.
      const rivals = (qualified.get(bareKey) || []).filter((q) => q !== ref);
      if (rivals.length) {
        problems.push(
          `BARE DUPLICATE: ${p.slug} → ${f} has bare "${ref}" alongside qualified ` +
          `${JSON.stringify(rivals)} — same person written twice, one unresolved.`,
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
