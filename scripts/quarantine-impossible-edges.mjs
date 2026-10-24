#!/usr/bin/env node
/**
 * quarantine-impossible-edges.mjs — remove wrong-generation links from people.json.
 *
 * THE PROBLEM
 * -----------
 * A bare name in a vault `relationships:` string ("Children: Adam Murray, John Murray")
 * gets resolved to whichever profile shares that name — ignoring dates. When the
 * intended person has no profile, the resolver binds a same-named relative instead.
 * On 2026-10-24 this put 21 impossible edges on the live site, e.g.
 *
 *     Esther Cowan (b.1783) → children: Adam Murray (b.1728)   ← her husband's grandfather
 *     John Lawrie (b.1810)  → children: Alexander Lawrie (b.1776)  ← his own grandfather
 *     John Lawrie (b.1810)  → children: Marion Vida Lawrie (b.1888) ← his granddaughter
 *
 * The VAULT IS CORRECT in every case. The corruption is entirely in the generated
 * people.json. So this script NEVER touches the vault.
 *
 * WHAT IT DOES
 * ------------
 * For each impossible edge, it REMOVES the wrong slug from the parent's array AND
 * from the child's reciprocal array, then records the original reference in a
 * quarantine journal. Removing the bogus link is safe: the relationship is provably
 * impossible, so no correct information is lost. Leaving it is the unsafe option —
 * it publishes a false family tree.
 *
 * It does NOT invent the missing person. The gap becomes visible (the name drops out
 * of the child list) rather than being filled with a lie. Writing the real profile is
 * a research job, tracked separately.
 *
 * Every removal is journalled to scripts/.guard-evidence/quarantine-<ts>.json so the
 * exact prior state can be restored with --restore.
 *
 * USAGE
 *   node scripts/quarantine-impossible-edges.mjs --dry-run   # show what would go
 *   node scripts/quarantine-impossible-edges.mjs             # apply
 *   node scripts/quarantine-impossible-edges.mjs --restore <journal.json>
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { checkYears } from "./lib/date-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(HERE, "..");
const PEOPLE = resolvePath(REPO, "src/data/people.json");
const PUBLIC = resolvePath(REPO, "src/data/people.public.json");
const EVIDENCE = resolvePath(REPO, "scripts/.guard-evidence");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const RESTORE_AT = argv.indexOf("--restore");

// ── Restore mode ─────────────────────────────────────────────────────────────
if (RESTORE_AT !== -1) {
  const journalPath = argv[RESTORE_AT + 1];
  if (!journalPath || !existsSync(journalPath)) {
    console.error(`quarantine: journal not found: ${journalPath}`);
    process.exit(2);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const people = JSON.parse(readFileSync(PEOPLE, "utf8"));
  const bySlug = new Map(people.map((p) => [p.slug, p]));
  let restored = 0;
  for (const r of journal.removals || []) {
    const s = bySlug.get(r.subject);
    if (s && Array.isArray(s[r.field]) && !s[r.field].includes(r.target)) {
      s[r.field].push(r.target);
      restored++;
    }
    const t = bySlug.get(r.target);
    if (t && Array.isArray(t[r.reciprocalField]) && !t[r.reciprocalField].includes(r.subject)) {
      t[r.reciprocalField].push(r.subject);
      restored++;
    }
  }
  writeFileSync(PEOPLE, JSON.stringify(people, null, 2) + "\n");
  console.log(`quarantine: restored ${restored} link(s) from ${journalPath}`);
  console.log("  Re-run the build to regenerate people.public.json.");
  process.exit(0);
}

// ── Load ─────────────────────────────────────────────────────────────────────
let people;
try {
  people = JSON.parse(readFileSync(PEOPLE, "utf8"));
} catch (e) {
  console.error(`quarantine: cannot read people.json: ${e.message}`);
  process.exit(2);
}
const bySlug = new Map(people.map((p) => [p.slug, p]));

// ── Find impossible edges ────────────────────────────────────────────────────
const removals = [];

for (const p of people) {
  if (!p.slug || p.birth_year == null) continue;

  // children: p is the parent, c is the claimed child
  if (Array.isArray(p.children)) {
    for (const cSlug of [...p.children]) {
      const c = bySlug.get(cSlug);
      if (!c || c.birth_year == null) continue;
      const res = checkYears({
        relation: "child",
        subjectBirth: p.birth_year,
        subjectDeath: p.death_year,
        candBirth: c.birth_year,
        candDeath: c.death_year,
      });
      if (res.ok) continue;
      removals.push({
        subject: p.slug,
        subjectName: p.display_name,
        field: "children",
        target: cSlug,
        targetName: c.display_name,
        reciprocalField: "parents",
        reason: res.reason,
      });
    }
  }

  // parents: p is the child, par is the claimed parent
  if (Array.isArray(p.parents)) {
    for (const parSlug of [...p.parents]) {
      const par = bySlug.get(parSlug);
      if (!par || par.birth_year == null) continue;
      const res = checkYears({
        relation: "parent",
        subjectBirth: p.birth_year,
        subjectDeath: p.death_year,
        candBirth: par.birth_year,
        candDeath: par.death_year,
      });
      if (res.ok) continue;
      // Record the same direction as the children case so de-dup works.
      removals.push({
        subject: parSlug,
        subjectName: par.display_name,
        field: "children",
        target: p.slug,
        targetName: p.display_name,
        reciprocalField: "parents",
        reason: res.reason,
      });
    }
  }
}

// De-duplicate: each edge appears from both ends.
const seen = new Set();
const unique = [];
for (const r of removals) {
  const key = `${r.subject}|${r.field}|${r.target}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(r);
}

// ── SPOUSE EDGE PROTECTION (added 2026-10-24 after a false positive) ─────────
// A married couple can share a birth year: Thomas Paynter (b.1859) married
// Elizabeth Jane Liebich (b.1859). An earlier version of this script proposed
// deleting that pair because the DATE GATE judged them as parent/child, and a
// child cannot be born the same year as its parent.
//
// But the gate was right and the PROPOSED REMOVAL was wrong — the pair IS
// impossible AS A PARENT/CHILD edge, which means the entry is not a child entry at
// all. Elizabeth's `children` array contained her husband. Deleting the pair would
// have been "correct" by the gate and destructive in fact.
//
// So: before removing, check whether the two people are ALSO recorded as spouses.
// If they are, the pair stays and the bad entry is reported for a human to place
// correctly. A provably-impossible PARENT edge must not be quietly turned into the
// deletion of a real marriage.
const keepAsSpouse = [];
const finalRemovals = [];
for (const r of unique) {
  const s = bySlug.get(r.subject);
  const t = bySlug.get(r.target);
  const married =
    (Array.isArray(s?.spouses) && s.spouses.includes(r.target)) ||
    (Array.isArray(t?.spouses) && t.spouses.includes(r.subject));
  if (married) {
    keepAsSpouse.push(r);
    continue;
  }
  finalRemovals.push(r);
}
if (keepAsSpouse.length) {
  console.log("");
  console.log(`⚠ ${keepAsSpouse.length} pair(s) are ALSO spouses — NOT removed, reported instead:`);
  for (const r of keepAsSpouse) {
    console.log(`   ${r.subject} ⇄ ${r.target}  (${r.subjectName} / ${r.targetName})`);
    console.log(`   ${r.reason}`);
    console.log(`   → They are married, so this is a MISPLACED entry, not a wrong person.`);
    console.log(`     Find which side put a spouse into '${r.field}' and fix the converter.`);
  }
}
const unique2 = finalRemovals;

if (unique2.length === 0) {
  console.log("quarantine: no impossible edges found — nothing to remove.");
  process.exit(0);
}

console.log(`── QUARANTINE ${unique2.length} IMPOSSIBLE EDGE(S) ──────────────`);
for (const r of unique2) {
  console.log(`   ✂ ${r.subject} → ${r.target}`);
  console.log(`     ${r.subjectName} → ${r.targetName}`);
  console.log(`     ${r.reason}`);
}

if (DRY) {
  console.log("");
  console.log("DRY RUN — nothing written. Re-run without --dry-run to apply.");
  process.exit(0);
}

// ── Apply ────────────────────────────────────────────────────────────────────
mkdirSync(EVIDENCE, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const journalPath = resolvePath(EVIDENCE, `quarantine-${stamp}.json`);

// Snapshot BEFORE mutating.
const before = JSON.parse(JSON.stringify(people));

let removed = 0;
for (const r of unique2) {
  const s = bySlug.get(r.subject);
  if (s && Array.isArray(s[r.field])) {
    const i = s[r.field].indexOf(r.target);
    if (i !== -1) {
      s[r.field].splice(i, 1);
      removed++;
    }
  }
  const t = bySlug.get(r.target);
  if (t && Array.isArray(t[r.reciprocalField])) {
    const i = t[r.reciprocalField].indexOf(r.subject);
    if (i !== -1) {
      t[r.reciprocalField].splice(i, 1);
      removed++;
    }
  }
}

// Verify the impossible edges are actually gone before claiming success.
let stillBad = 0;
for (const r of unique2) {
  const s = bySlug.get(r.subject);
  if (s && Array.isArray(s[r.field]) && s[r.field].includes(r.target)) stillBad++;
}

writeFileSync(
  journalPath,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      reason:
        "Wrong-generation links created by name-collision binding in resolve-refs.mjs. " +
        "Every listed edge was provably impossible on dates. Removed, not replaced — " +
        "the intended person has no profile and must not be fabricated.",
      count: unique2.length,
      linksRemoved: removed,
      removals: unique2,
      // Full pre-state so this is reversible without trusting git.
      beforeSnapshot: before,
    },
    null,
    2
  )
);

writeFileSync(PEOPLE, JSON.stringify(people, null, 2) + "\n");

console.log("");
console.log(`✅ Removed ${removed} link(s) across ${unique2.length} impossible edge(s).`);
console.log(`   Journal (reversible): ${journalPath}`);
if (stillBad > 0) {
  console.error(`❌ ${stillBad} edge(s) STILL PRESENT — the write did not take effect. Investigate.`);
  process.exit(2);
}
console.log(`   Verified: all ${unique2.length} impossible edges are gone from people.json.`);
console.log("");
console.log("   NOTE: people.public.json is regenerated by the build. Rebuild before deploying.");
