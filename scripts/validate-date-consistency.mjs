#!/usr/bin/env node
/**
 * validate-date-consistency.mjs — catch IMPOSSIBLE parent/child edges already in the data.
 *
 * WHY THIS EXISTS AND WHY IT IS SEPARATE FROM THE RESOLVER FIX
 * ------------------------------------------------------------
 * Fixing `resolve-refs.mjs` stops NEW bad edges being created. It does nothing about
 * edges that are already written into people.json as SLUGS — the resolver skips
 * anything that is already a slug ("if (slugSet.has(ref)) return ref"), so a wrong
 * bind becomes permanent the moment it is written.
 *
 * On 2026-10-24 the live site carried three of them:
 *   john-lawrie-1810 (b.1810) → child alexander-lawrie-1776 (b.1776)  ← his grandfather
 *   john-lawrie-1810 (b.1810) → child marion-lawrie (b.1888)          ← his granddaughter
 *   john-lawrie-1810 (b.1810) → child janet-lawrie (b.1881)           ← his granddaughter
 *
 * This walks every parent→child edge in both directions and applies the same
 * date-gate the resolver now uses. One rule, one implementation, no drift.
 *
 * USAGE
 *   node scripts/validate-date-consistency.mjs            # report
 *   node scripts/validate-date-consistency.mjs --fail     # exit 1 if any impossible edge
 *   node scripts/validate-date-consistency.mjs --json
 *
 * Exit: 0 clean / 1 impossible edges found (with --fail or always for HARD cases) / 2 blind
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { checkYears } from "./lib/date-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(HERE, "..");
const PEOPLE = resolvePath(REPO, "src/data/people.json");

const argv = process.argv.slice(2);
const FAIL_HARD = argv.includes("--fail");
const AS_JSON = argv.includes("--json");

let people;
try {
  people = JSON.parse(readFileSync(PEOPLE, "utf8"));
} catch (e) {
  console.error(`validate-date-consistency: cannot read ${PEOPLE}: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(people) || people.length === 0) {
  console.error("validate-date-consistency: people.json is empty or not an array — BLIND, not clean.");
  process.exit(2);
}

const bySlug = new Map(people.map((p) => [p.slug, p]));
const isSlug = (s) => bySlug.has(s);

const problems = [];
const unlinked = [];

/** Record a judgment for one directed edge. */
function judgeEdge(subjectSlug, otherSlug, field, label) {
  if (!isSlug(otherSlug)) {
    unlinked.push({ subjectSlug, field, ref: otherSlug });
    return;
  }
  const s = bySlug.get(subjectSlug);
  const o = bySlug.get(otherSlug);

  // Only edges where BOTH have a birth year can be judged.
  if (s.birth_year == null || o.birth_year == null) return;

  const res = checkYears({
    relation: label, // 'child' when reading a children[] entry, 'parent' for parents[]
    subjectBirth: s.birth_year,
    subjectDeath: s.death_year,
    candBirth: o.birth_year,
    candDeath: o.death_year,
  });
  if (res.ok) return;

  problems.push({
    kind: "IMPOSSIBLE_EDGE",
    subject: subjectSlug,
    subjectName: s.display_name || subjectSlug,
    subjectYears: `${s.birth_year ?? "?"}–${s.death_year ?? "?"}`,
    field,
    relation: label,
    target: otherSlug,
    targetName: o.display_name || otherSlug,
    targetYears: `${o.birth_year ?? "?"}–${o.death_year ?? "?"}`,
    reason: res.reason,
  });
}

for (const p of people) {
  if (!p.slug) continue;
  if (Array.isArray(p.children)) {
    for (const c of p.children) judgeEdge(p.slug, c, "children", "child");
  }
  if (Array.isArray(p.parents)) {
    for (const par of p.parents) judgeEdge(p.slug, par, "parents", "parent");
  }
}

// De-duplicate: an edge is stored from both ends, so the same impossibility appears
// twice with the roles swapped. Report one line per distinct pair.
const seen = new Set();
const distinct = [];
for (const pr of problems) {
  const key = [pr.subject, pr.target].sort().join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  distinct.push(pr);
}

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        status: distinct.length ? "IMPOSSIBLE_EDGES" : "CLEAN",
        people: people.length,
        impossible: distinct,
        unresolvedRefs: unlinked.length,
      },
      null,
      2
    )
  );
} else {
  console.log("── DATE-CONSISTENCY GUARD (parent/child generations) ─────");
  console.log(`  profiles checked : ${people.length}`);
  console.log(`  edges judged     : ${problems.length} impossible readings`);
  console.log(`  DISTINCT bad     : ${distinct.length}`);
  console.log("");

  if (distinct.length === 0) {
    console.log("✅ NO IMPOSSIBLE EDGES — every dated parent/child pair is generationally possible.");
  } else {
    console.log(`❌ ${distinct.length} IMPOSSIBLE relationship(s) in the data:`);
    for (const pr of distinct) {
      console.log("");
      console.log(`   • ${pr.subject} (${pr.subjectYears}) — ${pr.field}: ${pr.target} (${pr.targetYears})`);
      console.log(`     ${pr.subjectName} → ${pr.targetName}`);
      console.log(`     ${pr.reason}`);
    }
    console.log("");
    console.log("  These are WRONG LINKS, not missing data. The named person's real profile");
    console.log("  does not exist, so the ref bound to a same-named relative instead.");
    console.log("  Fix by writing the missing profile, or by reverting the ref to the raw");
    console.log("  name so the gap stays visible. Do NOT leave a wrong-generation link live.");
  }
}

if (distinct.length > 0 && FAIL_HARD) process.exit(1);
process.exit(0);
