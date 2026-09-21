#!/usr/bin/env node
/**
 * check-living-privacy.mjs — FAIL-CLOSED guard.
 *
 * Design note (learned the hard way 2026-09-21):
 *   An earlier version tried to work out WHO was living from the filename, then only
 *   checked those files. A fault-injection test proved it never matched Grantley's
 *   profile, so a planted leak passed. A file that is never checked always looks clean.
 *
 *   This version does NOT guess who is living. It flags the banned SHAPES anywhere,
 *   and an ALLOW list carries the legitimate historical uses (marriage venues, baptism
 *   churches, birthplaces, register numbers, deceased people's occupation lines).
 *
 *   Deceased people legitimately carry historical residence/occupation. Those are
 *   allowed through by the DECEASED-FILE rule: a file whose name carries a closed
 *   death range (1924–2009) or a single death year (1965) is skipped entirely.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const VAULT = join(homedir(), 'ObsidianVault', 'Family History', 'People');

// SKIP: filenames that prove a death. Handles: (1924–2009), (1834), (~1860–1936),
// (b. ~1806, England) — a person described as "b. <year>" in the name is a birth record,
// and a 19th/early-20th century birth means they are not living today.
const DEAD_FILE_PATTERNS = [
  /\(\s*~?\d{3,4}\s*[–\-—]\s*~?\d{3,4}\s*\)/,      // (1924–2009), (~1860–1936), (~1853-1930)
  /\(\s*~?\d{3,4}\s*\)\s*\.md$/,                   // (1965)
  /\(b\.\s*~?\d{3,4}/i,                            // (b. ~1806, England)
  /\(\s*of\s+[A-Z]/,                               // (of Broadlee)
  /\b(?:18|19)\d{2}\s*[–\-—]\s*[A-Z]/,             // (1875–1954) variants
];
const isDeadFile = (fn) => DEAD_FILE_PATTERNS.some(re => re.test(fn));

// files NEVER skipped even though the name looks closed (living, open-ended)
const FORCE_CHECK = /\(\d{4}[–\-—]\?\)|\(\?–living\)|\?–living/i;

const RULES = [
  ['RESIDENCE-FIELD', /^\*\*(?:Residence|Location)\s*:/i],
  ['EMPLOYER-FIELD',  /^\*\*(?:Occupation|Employer|Work|Employment)\s*:/i],
  ['SCHOOL-FIELD',    /^\*\*(?:Education|School|Schooling)\s*:/i],
  ['SOCIAL-FIELD',    /^\*\*(?:Facebook|LinkedIn|Instagram)\s*:/i],
  ['SOCIAL-URL',      /(?:facebook|instagram|linkedin)\.com/i],
  ['SOCIAL-PROSE',    /\b(?:per Facebook|on Facebook|joined Facebook|Facebook profile|relationship status)\b/i],
  ['FB-SECTION',      /^##\s*Source — Facebook Lead/i],
  ['ADDRESS-LABEL',   /^\*\*Address\s*:/i],
  ['STREET-ADDR',     /\b\d{1,4}[A-Za-z]?\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Ct|Court|Cres|Pde|Parade|Ln|Way|Tce|Hwy|Pl)\b/],
  ['POSTCODE',        /\b(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s?\d{4}\b/],
  ['RESIDENCE-PROSE', /\b(?:lives?|resides?|residing)\s+in\s+[A-Z][a-z]+/],
  ['WORKS-PROSE',     /\bworks?\s+(?:for|at)\s+[A-Z]/],
];

const ALLOW = [
  /m\.\s*\d{1,2}\s+\w+\s+\d{4}/,                        // "(m. 28 Nov 1981, ...)"
  /Married (?:at|on)/i,
  /Baptized|Baptised/i,
  /Reg(?:istered)?\.?\s*No/i,
  /(?:Church of Christ|Baptist Church|Church of England|St Mary|Chapel|Cathedral|Cemetery)/i,
  /^\*\*Born\b|^\*\*Birthplace\b|^\*\*Spouse/,
  /^#+\s*(?:Marriage|Baptism|Birth)/i,
  /Postcode.*(?:source|record|certificate)/i,
  /https?:\/\//,                                        // a URL is a citation, not an address
  /^\s*-\s*\*\*Source\b/i,                              // source/citation lines
];

const files = readdirSync(VAULT).filter(f => f.endsWith('.md') && !f.includes('.bak-'));
const problems = [];
let checked = 0, skipped = 0;

for (const fn of files) {
  if (isDeadFile(fn) && !FORCE_CHECK.test(fn)) { skipped++; continue; }
  checked++;
  const lines = readFileSync(join(VAULT, fn), 'utf8').split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ALLOW.some(re => re.test(ln))) continue;
    for (const [label, re] of RULES) {
      if (re.test(ln)) { hits.push({ line: i + 1, label, text: ln.trim().slice(0, 100) }); break; }
    }
  }
  if (hits.length) problems.push({ file: fn, hits });
}

if (problems.length) {
  console.error(`\n❌ LIVING-PRIVACY GATE FAILED — ${problems.length} profile(s) of ${checked} checked\n`);
  for (const p of problems) {
    console.error(`   ${p.file}`);
    for (const h of p.hits) console.error(`      L${h.line} [${h.label}] ${h.text}`);
  }
  console.error('\n   Living people carry no residence, employer, schooling, social profile or address.');
  console.error('   See rules: "Where the private detail actually hides".\n');
  process.exit(1);
}
console.log(`OK — living-privacy gate (${checked} living/open profiles checked, ${skipped} deceased skipped)`);
