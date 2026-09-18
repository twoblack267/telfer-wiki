#!/usr/bin/env node
/**
 * purge-phantom-slugs.mjs — evict "ghost" people whose slug carries the tilde-approx
 * annotation from the display name (e.g. `leslie-frank-dillon-~1892`).
 *
 * WHY (site bug-hunter cards tw-2026-09-14-019 / -020, 2026-09-14):
 *   People whose lifespan is written with a tilde — `Leslie Frank Dillon (~1892–1915).md` —
 *   got a slug containing the tilde. Those ghosts then competed with the genuine record in
 *   sanitize-people.mjs's dedupe, and the old `/^\d{4}$/` test scored the ghost as "has a
 *   year", so the GHOST won and the real entry was dropped, leaving `birth_year: "~1892"`
 *   — a STRING in a numeric field — on the live site.
 *
 *   The dedupe guard is fixed in sanitize-people.mjs (hasRealYearSuffix). This script removes
 *   the ghosts at source so the vault and data layer stay clean and the tilde only ever
 *   appears in the *display* lifespan, never in a slug or a numeric field.
 *
 * ── REWRITTEN 2026-09-18 (card tw-2026-09-17-007) ──────────────────────────────
 * The first version deleted ghost records WITHOUT repairing references to them.
 * Measured on the live data 2026-09-18, that would have left:
 *     charles-farrow-jr-~1865  → 12 dangling inbound refs
 *     florence-nicholas-~1885  →  3 dangling inbound refs
 *     leslie-frank-dillon-~1892 → 0 (the only genuinely orphan-free ghost)
 * i.e. the "0 orphans" dry-run was measuring ONE direction only (who points AT the
 * ghost). It never asked whether the surviving clean twin still pointed BACK at the
 * ghost — and for Charles Farrow Jr the clean record listed the ghost as its own
 * sibling, making him his own brother.
 *
 * This version RECONCILES BEFORE IT DELETES:
 *   1. For every ghost, find its clean twin by (first_name, last_name) — excluding ghosts.
 *   2. Copy the ghost's family links (parents/children/spouses/siblings) into the twin,
 *      de-duplicated, skipping any link that is the twin's own slug.
 *   3. Rewrite every OTHER record that points at the ghost so it points at the twin.
 *   4. Strip self-references (a record must never list its own slug as family).
 *   5. Only then delete the ghost.
 *   6. If any ghost has no clean twin, or any inbound ref cannot be reconciled, EXIT
 *      NON-ZERO and change nothing — a hard fail, not a silent skip.
 *
 * SAFE BY CONSTRUCTION:
 *   - Only removes records whose slug matches /~\d{3,4}/ (a tilde directly before digits).
 *   - Refuses (exit 1) if a ghost has no clean-slug twin.
 *   - Refuses (exit 1) if any reference to a ghost cannot be resolved to a twin.
 *   - Prints a full before/after table; `--dry-run` writes nothing.
 *
 * The vault is the source of truth, so the fix belongs in the VAULT FILENAMES too:
 * run with `--vault` to rename the offending .md files to drop the annotation from the
 * filename (content untouched), so a future regeneration cannot resurrect the ghost.
 *
 * NOTE ON THE SOURCE: renaming the vault file does NOT stop the ghost recurring. The
 * recurrence is a MERGE-KEY defect in convert-markdown.mjs (~line 663: key is
 * first+last|birthYear, so changing a birth year misses the key and appends a new
 * record; ~line 839 re-appends any record with no vault_file unconditionally). This
 * script is the DATA-layer net; the code-layer fix is a separate change.
 *
 * Usage:
 *   node scripts/purge-phantom-slugs.mjs --dry-run
 *   node scripts/purge-phantom-slugs.mjs
 *   node scripts/purge-phantom-slugs.mjs --vault
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PEOPLE_JSON = path.join(ROOT, 'src/data/people.json');
const PEOPLE_VAULT = path.resolve(
  process.env.TELFER_VAULT || path.join(process.env.HOME || '', 'ObsidianVault'),
  'Family History/People'
);

const DRY_RUN = process.argv.includes('--dry-run');
const DO_VAULT = process.argv.includes('--vault');

const GHOST_RE = /~\d{3,4}/;                 // tilde immediately before 3-4 digits
const FAMILY_FIELDS = ['parents', 'children', 'spouses', 'siblings'];

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
const arr = Array.isArray(people) ? people : (people.people || []);

const isGhost = (p) => GHOST_RE.test(String(p.slug || ''));
const ghosts = arr.filter(isGhost);

console.log(`👻 Phantom (tilde) slugs found: ${ghosts.length}`);

if (ghosts.length === 0) {
  console.log('✅ Nothing to do — data is clean.');
  process.exit(0);
}

// ── 1. Pair each ghost with its clean twin (same name, non-ghost, non-self). ──────────
const pairs = [];
const failures = [];
for (const g of ghosts) {
  const twin = arr.find(
    (p) =>
      p !== g &&
      !isGhost(p) &&
      (p.first_name || '') === (g.first_name || '') &&
      (p.last_name || '') === (g.last_name || '')
  );
  if (!twin) {
    failures.push(`KEEP ${g.slug} — NO clean-slug twin; removing it would lose the person`);
    continue;
  }
  pairs.push({ ghost: g, twin });
}

// ── 2. Build a slug->slug remap, then verify every inbound ref is reconcilable. ───────
const remap = new Map(pairs.map(({ ghost, twin }) => [ghost.slug, twin.slug]));

const unresolved = [];
for (const { ghost } of pairs) {
  for (const p of arr) {
    if (p.slug === ghost.slug) continue;
    for (const f of FAMILY_FIELDS) {
      const v = p[f];
      if (!Array.isArray(v)) continue;
      for (const ref of v) {
        if (ref === ghost.slug && !remap.has(ref)) unresolved.push(`${p.slug}.${f} -> ${ref}`);
      }
    }
  }
}

if (failures.length || unresolved.length) {
  console.log('\n❌ REFUSING TO PURGE — references could not be reconciled:');
  for (const f of failures) console.log(`   ⚠️  ${f}`);
  for (const u of unresolved) console.log(`   ⚠️  unresolvable ref: ${u}`);
  console.log('\nNothing was changed. Fix the twin/ref problem above first.');
  process.exit(1);
}

// ── 3. Report the plan. ──────────────────────────────────────────────────────────────
const inboundCount = (slug) => {
  let n = 0;
  for (const p of arr) {
    if (p.slug === slug) continue;
    for (const f of FAMILY_FIELDS) {
      const v = p[f];
      if (Array.isArray(v) && v.includes(slug)) n++;
    }
  }
  return n;
};

for (const { ghost, twin } of pairs) {
  const copied = [];
  for (const f of FAMILY_FIELDS) {
    const refs = (ghost[f] || []).filter((r) => r !== twin.slug);
    if (refs.length) copied.push(`${f}:${refs.length}`);
  }
  const rewired = inboundCount(ghost.slug);
  console.log(
    `   REMOVE  ${ghost.slug}  (birth_year=${JSON.stringify(ghost.birth_year)})  → kept: ${twin.slug}\n` +
      `           links merged into twin: ${copied.length ? copied.join(' ') : 'none'}` +
      `   inbound refs rewired: ${rewired}`
  );
}

// ── 4. Apply: merge links into twin, rewire inbound, strip self-refs, delete ghosts. ──
const keep = arr.filter((p) => !isGhost(p));
const ghostSlugs = new Set(ghosts.map((g) => g.slug));

for (const { ghost, twin } of pairs) {
  for (const f of FAMILY_FIELDS) {
    const existing = Array.isArray(twin[f]) ? twin[f] : [];
    const add = (ghost[f] || []).filter((r) => r !== twin.slug && !existing.includes(r));
    if (add.length) twin[f] = [...existing, ...add];
  }
}

for (const p of keep) {
  for (const f of FAMILY_FIELDS) {
    if (!Array.isArray(p[f])) continue;
    const seen = new Set();
    p[f] = p[f]
      .map((r) => remap.get(r) || r)          // ghost -> twin
      .filter((r) => r !== p.slug && !ghostSlugs.has(r))  // drop self-refs
      .filter((r) => (seen.has(r) ? false : seen.add(r)));  // dedupe
  }
}

// ── 5. Vault filename fix: drop the annotation from the FILENAME. ─────────────────────
if (DO_VAULT) {
  let renamed = 0;
  const files = fs.existsSync(PEOPLE_VAULT) ? fs.readdirSync(PEOPLE_VAULT) : [];
  for (const f of files) {
    if (!f.endsWith('.md') || !GHOST_RE.test(f)) continue;
    // `Name (~1892–1915).md`  →  `Name (1892–1915).md`
    const clean = f.replace(/\(~\s*/g, '(').replace(/(\d)\s*–\s*~\s*(\d)/g, '$1–$2');
    if (clean === f) continue;
    const from = path.join(PEOPLE_VAULT, f);
    const to = path.join(PEOPLE_VAULT, clean);
    if (fs.existsSync(to)) {
      console.log(`   ⚠️  SKIP rename — target exists: ${clean}`);
      continue;
    }
    console.log(`   RENAME  ${f}  →  ${clean}`);
    if (!DRY_RUN) fs.renameSync(from, to);
    renamed++;
  }
  console.log(`📁 Vault filenames ${DRY_RUN ? 'would be' : ''} renamed: ${renamed}`);
}

// ── 6. Write. ────────────────────────────────────────────────────────────────────────
if (!DRY_RUN) {
  const out = Array.isArray(people) ? keep : { ...people, people: keep };
  fs.writeFileSync(PEOPLE_JSON, JSON.stringify(out, null, 2));
  console.log(`✅ people.json: ${arr.length} → ${keep.length}`);
} else {
  console.log(`🔍 DRY RUN — nothing written (would remove ${ghosts.length})`);
}
