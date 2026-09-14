#!/usr/bin/env node
/**
 * validate-frontmatter-years.mjs — the guard for the class every other gate cannot see.
 *
 * WHY (cards tw-2026-09-14-019 + tw-2026-09-14-020, filed by the Site Bug Hunter):
 *   Three vault profiles carry a TILDE-STRING in a NUMERIC frontmatter field:
 *
 *       People/Charles Farrow Jr.md                   birth_year: ~1865  (death_year: 1936)
 *       People/Florence Nicholas Telfer.md            birth_year: ~1885  (death_year: ~1960)
 *       People/Leslie Frank Dillon (~1892–1915).md    birth_year: ~1892  (death_year: 1915)
 *
 *   scripts/build-people-json.mjs (a plain `fm.birth_year || null`, no coercion) copies those
 *   strings straight into `birth_year` in src/data/people.json and people.public.json. So the
 *   numeric field holds a string, and every arithmetic consumer poisons itself on it:
 *
 *     - src/pages/people/families/index.astro L41-43: `Math.min(...years)` -> NaN, so the
 *       "Year Span" stat tile renders EMPTY and the subtitle shows a bare en dash ("· – ·").
 *     - src/pages/timeline.astro L57/L86: `Math.floor("~1892" / 10) * 10` -> NaN, emitting a
 *       broken "NaNs" decade chip with href="#decade-NaN" that no browser can scroll to.
 *
 *   Both are symptoms of ONE defect: a string where a number belongs. Repairing either page's
 *   render (which cards 019/020 propose) leaves the poison in the data and the next arithmetic
 *   consumer re-breaks. THIS guard fires at the SOURCE — the vault frontmatter — so the string
 *   cannot enter the pipeline at all.
 *
 * WHY NO EXISTING GATE CAUGHT IT:
 *   - validate-people.mjs          : JSON shape/ref counts, not frontmatter typing.
 *   - validate-no-mark-refs.py     : "Mark's" strings only.
 *   - scan-cross-branch.mjs        : sibling/parent contradiction only.
 *   - validate-slug-shape.mjs      : relationship-ref shape, not year typing.
 *   - validate-children-reconcile  : children vs relationships.
 *   All five exit 0 on this data. That silence IS the hazard.
 *
 * ── WHAT IS A DEFECT, AND WHAT IS NOT ───────────────────────────────────────
 * Only TWO shapes actually poison arithmetic (this is measured, not assumed):
 *
 *   HARD (fails, exit 1) — a numeric-looking value whose first character is not a digit:
 *       birth_year: ~1865        NUMBER(birth_year) = 0    -> poisoned SPREAD (Math.min/max
 *       birth_year: ~1885           over a mixed list yields NaN) AND poisoned Math.floor
 *       birth_year: ~1892
 *   SQLite's leading-numeric-prefix coercion turns "~1892" into 0, which then becomes the
 *   minimum year and a 0-decade bucket.
 *
 *   HARD — a numeric prefix followed by trailing text:
 *       death_year: 1915 (estimated)     SQLite reads 1915; JS `Number()` reads NaN. The two
 *                                        consumers disagree, which is its own defect.
 *
 *   CLEAN (reported as notes, does NOT fail) — a legitimate SQL NULL:
 *       death_year: null | None | "" | "?"      (SQLite NUMBER(...) -> NULL, and SQLite's
 *       Math.min/Math.max SKIP NULLs. `Math.min(1, 2, null)` is 1, not NaN. Measured on the
 *       real vault: only the three tildes poison the spread, and removing them yields a
 *       well-defined 1722-2019 span with zero NaN contributions.)
 *   These are records that simply have no death year. They are already excluded from the
 *   aggregate by both consumers. A guard that failed on them would be reporting a bug the
 *   site does not have — and would make the guard un-actionable, which is how guards die.
 *   They ARE surfaced (notes), because a later render change could start trusting them.
 *
 * THE `~` IS REAL INFORMATION. It marks an approximate year. The defect is only that it is
 * packed INSIDE a numeric field. The fix is a SEPARATE field, never a deletion:
 *       birth_year: ~1865   ->   birth_year: 1865
 *                                birth_year_approx: true
 *
 * SCOPE: vault People/ only, HARD FAIL (exit 1) — the same deliberate scope
 *   validate-no-mark-refs.py uses. The vault is local-only; CI has no copy, so this local
 *   pipeline (invoked from regenerate-data.sh) is the only place the source can be checked.
 *   Missing vault => SKIPPED, not failed (same contract as the no-mark-refs source scan).
 *
 * Usage: node scripts/validate-frontmatter-years.mjs [--quiet] [--vault <path>]
 *   exits 0 clean, 1 on any hard violation.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const QUIET = process.argv.includes('--quiet');
const vaultArgIdx = process.argv.indexOf('--vault');
const VAULT_ROOT =
  vaultArgIdx !== -1 && process.argv[vaultArgIdx + 1]
    ? process.argv[vaultArgIdx + 1]
    : path.join(os.homedir(), 'ObsidianVault', 'Family History');

const YEAR_FIELDS = ['birth_year', 'death_year'];

if (!fs.existsSync(VAULT_ROOT)) {
  console.log(
    `NOTE: vault not found at ${VAULT_ROOT} — frontmatter-year guard SKIPPED (CI has no vault either)`,
  );
  process.exit(0);
}

const PEOPLE_DIR = path.join(VAULT_ROOT, 'People');
if (!fs.existsSync(PEOPLE_DIR)) {
  console.log(`NOTE: ${PEOPLE_DIR} not found — frontmatter-year guard SKIPPED`);
  process.exit(0);
}

/**
 * Read the YAML frontmatter block WITHOUT a YAML parser — deliberately.
 * gray-matter already coerces `birth_year: ~1865` to the STRING "~1865" (YAML's core schema
 * has no `~` prefix operator), which is exactly how the poison gets in; but a parser would
 * also normalise away the source line this guard must report. Reading the raw block keeps the
 * report honest about what the author typed, and keeps the script dependency-free so it still
 * runs in the regen pipeline when node_modules is absent.
 */
function frontmatterFields(raw) {
  const out = [];
  if (!raw.startsWith('---')) return out;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return out;
  const block = raw.slice(3, end);
  block.split('\n').forEach((line, i) => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/); // top-level keys only
    if (!m) return;
    out.push({ key: m[1], value: m[2], line: i + 2 });
  });
  return out;
}

const hard = [];
const notes = [];
let scanned = 0;

const files = fs.readdirSync(PEOPLE_DIR).filter((f) => f.endsWith('.md')).sort();

for (const file of files) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(PEOPLE_DIR, file), 'utf-8');
  } catch {
    continue;
  }
  scanned++;
  for (const { key, value, line } of frontmatterFields(raw)) {
    if (!YEAR_FIELDS.includes(key)) continue;
    if (value === '') continue; // absent — not a value at all
    if (/^\d+$/.test(value)) continue; // the only clean form

    const at = `${file}:${line}  ${key}: ${value}`;

    // CLEAN: legitimate "no value" spellings. SQLite NUMBER() -> NULL; Math.min/max skip null.
    if (/^(null|Null|NULL|None|none|~|\?|"?"|'?'|"-"|—|-)$/i.test(value)) {
      notes.push(`${at}   (no value — SQL NULL; already excluded from aggregates)`);
      continue;
    }

    let why;
    if (/^~/.test(value))
      why =
        'tilde-approximate marker packed into a NUMERIC field — SQLite NUMBER() coerces this to 0,\n' +
        '     so it becomes the minimum year and a 0-decade bucket, and poisons the JS Math.min/max spread to NaN';
    else if (/^[^\d\s]/.test(value))
      why = 'non-numeric value in a numeric year field — poisons the JS Math.min/max spread to NaN';
    else if (/^\d+\s*\S+/.test(value))
      why =
        'numeric prefix plus trailing text — SQLite reads the leading digits, JS `Number()` reads NaN;\n' +
        '     the two consumers disagree about the same record';
    else if (/^"/.test(value))
      why = 'quote-wrapped value — YAML types this as a string, not a number';
    else if (/^\d+\.\d+$/.test(value)) why = 'decimal where an integer year is expected';
    else why = 'non-integer value in a numeric year field';

    hard.push({ at, why });
  }
}

if (!QUIET) {
  console.log('── FRONTMATTER YEAR TYPING (tw-2026-09-14-019 / -020) ────');
  console.log(`  vault profiles scanned        : ${scanned}`);
  console.log(`  year fields checked           : ${YEAR_FIELDS.join(', ')}`);
  console.log(`  arithmetic-poisoning values   : ${hard.length}`);
  console.log(`  null/absent spellings (notes) : ${notes.length}`);
  console.log('');
  for (const n of notes) console.log(`  · ${n}`);
  if (notes.length) console.log('');
}

if (hard.length) {
  console.log('❌ FRONTMATTER-YEAR GUARD FAILED:');
  for (const { at, why } of hard) {
    console.log(`  ${at}`);
    console.log(`     ${why}.`);
  }
  console.log('');
  console.log('   FIX the VAULT profile (never hand-edit src/data/*.json):');
  console.log('     birth_year: ~1865   ->   birth_year: 1865');
  console.log('                              birth_year_approx: true');
  console.log('   The `~` is real information — move it to the approx flag, do not delete it.');
  console.log('   Then: bash scripts/regenerate-data.sh');
  console.log('');
  console.log('   This guard exists because validate-people, no-mark-refs, scan-cross-branch,');
  console.log('   slug-shape and children-reconcile ALL exit 0 on a string-poisoned year field.');
  process.exit(1);
}

if (!QUIET) console.log('✅ FRONTMATTER YEARS CLEAN — no value can poison a year aggregate.');
process.exit(0);
