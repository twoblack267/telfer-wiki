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
 * SAFE BY CONSTRUCTION:
 *   - Only removes records whose slug matches /~\d{3,4}/ (a tilde directly before digits).
 *   - Refuses to remove a ghost if NO sibling record shares its (first_name,last_name) — that
 *     would mean the ghost is the only carrier of the person, so it is reported instead.
 *   - Prints a full before/after table; `--dry-run` writes nothing.
 *
 * The vault is the source of truth, so the fix belongs in the VAULT FILENAMES too:
 * run with `--vault` to rename the offending .md files to drop the annotation from the
 * filename (content untouched), so a future regeneration cannot resurrect the ghost.
 *
 * Usage:
 *   node scripts/purge-phantom-slugs.mjs --dry-run
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
const realYear = (slug) => /-\d{4}$/.test(slug || '');

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
const arr = Array.isArray(people) ? people : (people.people || []);

const keyOf = (p) =>
  `${(p.first_name || '').toLowerCase()}|${(p.last_name || '').toLowerCase()}|${p.birth_year ?? ''}`;

const counts = new Map();
for (const p of arr) counts.set(keyOf(p), (counts.get(keyOf(p)) || 0) + 1);

const ghosts = arr.filter((p) => GHOST_RE.test(String(p.slug || '')));
const removable = [];
const orphaned = [];

for (const g of ghosts) {
  // A ghost is safe to remove only when the same person exists under a clean slug.
  const sibling = arr.find(
    (p) =>
      p !== g &&
      (p.first_name || '') === (g.first_name || '') &&
      (p.last_name || '') === (g.last_name || '')
  );
  (sibling ? removable : orphaned).push({ ghost: g, sibling });
}

console.log(`👻 Phantom (tilde) slugs found: ${ghosts.length}`);
for (const { ghost, sibling } of removable) {
  console.log(
    `   REMOVE  ${ghost.slug}   (birth_year=${JSON.stringify(ghost.birth_year)}, ` +
      `${typeof ghost.birth_year})  → kept: ${sibling.slug}`
  );
}
for (const { ghost } of orphaned) {
  console.log(`   ⚠️  KEEP  ${ghost.slug} — NO clean-slug sibling; removing it would lose the person`);
}

// ── Vault filename fix: drop the annotation from the FILENAME so regen can't resurrect it.
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

if (!DRY_RUN) {
  const keep = arr.filter((p) => !removable.some(({ ghost }) => ghost.slug === p.slug));
  fs.writeFileSync(PEOPLE_JSON, JSON.stringify(Array.isArray(people) ? keep : { ...people, people: keep }, null, 2));
  console.log(`✅ people.json: ${arr.length} → ${keep.length}`);
} else {
  console.log(`🔍 DRY RUN — nothing written (would remove ${removable.length})`);
}
console.log(`   orphans kept (need a human decision): ${orphaned.length}`);
