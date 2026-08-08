#!/usr/bin/env node
/**
 * selfheal-data.mjs
 * Night Watch SELF-HEAL step — repairs ONLY reversible, data-derivable
 * consistency errors in people.json, and reports anything that genuinely
 * needs a human (never auto-fixes genealogical truth).
 *
 * SAFETY RULE (immutable): never invent, never destroy a marker.
 *   - A display field that ALREADY has any non-empty value is LEFT ALONE —
 *     "~1885", "c. 1885", "abt 1885" are legitimate approximate-date markers,
 *     NOT errors. We never strip or overwrite them.
 *   - We only DERIVE a display field when it is EMPTY/missing AND the
 *     underlying year is a clean number. That is pure consistency, no invention.
 *   - Anywhere the correct value is unknowable from the data alone = Class B,
 *     requires a human, and BLOCKS the push.
 *
 * CLASS A — auto-fixable (only when display empty + underlying known):
 *   A1. death_year_display empty but death_year set (deceased) -> String(year).
 *   A2. birth_year_display empty but birth_year set -> String(year).
 *   A3. deceased with death_year whose lifespan heading shows "– living"
 *       -> rewrite the closing tag to the known death year. (Derived.)
 *
 * CLASS B — BLOCK for human (truth unknowable, never auto-fix):
 *   B1. is_living=true but death_year set.  ("Jared false-death" class.) Mark.
 *   B2. is_living=true but lifespan has a closed birth–death range. Mark.
 *   B3. is_living=false but death_year_display="living" and no death_year.
 *
 * Exits:
 *   0 = clean (or only Class-A fixes applied)
 *   1 = Class-B issue(s) found that need a human — push must be BLOCKED.
 *
 * Idempotent: running twice yields no further changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = new URL('../src/data/people.json', import.meta.url);
const data = JSON.parse(readFileSync(PATH, 'utf8'));

const isEmpty = v => (v === null || v === undefined || (typeof v === 'string' && v.trim() === ''));
const cleanYear = v => (Number.isInteger(v) && !Number.isNaN(v));

let fixedA = 0;
const blockItems = [];

for (const p of data) {
  const name = (p.first_name || '') + ' ' + (p.last_name || '') + ' (' + (p.slug || '') + ')';
  const is_living = p.is_living === true;
  const d = p.death_year;
  const b = p.birth_year;
  const dyd = p.death_year_display;
  const byd = p.birth_year_display;
  let wrote = false;

  /* ---------- CLASS B : never auto-fix, require human ---------- */
  if (is_living && !isEmpty(d)) {
    blockItems.push(`B1 LIVING but death_year=${d} (real evidence or corruption? needs verification): ${name}`);
  } else if (is_living && typeof p.lifespan === 'string' && /\((\d{4})[-–](\d{4})\)/.test(p.lifespan)) {
    blockItems.push(`B2 LIVING but lifespan "${p.lifespan}" shows a closed death range (possible false death): ${name}`);
  } else if (!is_living && dyd === 'living' && isEmpty(d)) {
    blockItems.push(`B3 DECEASED but death_year_display="living" and death_year missing: ${name}`);
  }

  /* ---------- CLASS A : fix ONLY when display empty + year known ---------- */
  if (!is_living && cleanYear(d) && isEmpty(dyd)) {
    p.death_year_display = String(d);   // deceased, known year, display missing -> derive
    wrote = true;
  }
  if (cleanYear(b) && isEmpty(byd)) {
    p.birth_year_display = String(b);   // known year, display missing -> derive
    wrote = true;
  }
  if (!is_living && cleanYear(d) && typeof p.lifespan === 'string' && /[-–]\s*living/.test(p.lifespan)) {
    // deceased person whose lifespan heading still reads "– living"; derive closing year
    p.lifespan = p.lifespan.replace(/[-–]\s*living/, '– ' + d);
    wrote = true;
  }
  if (wrote) fixedA++;
}

if (fixedA > 0) {
  writeFileSync(PATH, JSON.stringify(data, null, 2) + '\n');
}

console.log('SELF-HEAL: auto-fixed %d reversible consistency error(s)', fixedA);
for (const b of blockItems) console.log('  ⛔ Needs human:', b);
if (fixedA === 0 && blockItems.length === 0) console.log('SELF-HEAL: data is consistent — nothing to fix');

process.exit(blockItems.length > 0 ? 1 : 0);
