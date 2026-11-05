#!/usr/bin/env node
/**
 * guard-relationship-integrity.mjs — refuse a published dataset where the
 * family graph contradicts itself.
 *
 * WHY THIS EXISTS (found 6 Nov 2026, while auditing the Millicent conflict)
 * ------------------------------------------------------------------------
 * The 03:00 Wiki Site Audit had been failing for days with
 *   "refused incoming parent claim: francis-adam-telfer-1875 -> millicent-telfer"
 * and nothing downstream cared. Chasing it uncovered two defects that no
 * existing gate could see, because every existing gate checks the SHAPE of the
 * data (does the file exist, does the slug resolve, is the schema fresh) and
 * none checks whether the family RELATIONSHIPS agree with each other.
 *
 *   BUG A — THREE PARENTS. ronald-telfer's published record lists
 *           clara-ann-millicent-telfer-1878, francis-adam-telfer-1875 AND
 *           maria-clara-telfer-1878 as parents. The vault says his mother was
 *           Maria Clara and his father was "not recorded". His own page text
 *           says so in plain English. The array says otherwise. Two of those
 *           three are simply wrong, and the site was publishing all three.
 *
 *   BUG B — DANGLING NAMES. 559 distinct relation names in the published data
 *           resolve to no profile at all. Most are correct and deliberate
 *           (an ancestor with no page yet). But a handful are near-misses of
 *           real profiles differing only in punctuation or a missing life
 *           span — "James Telfer of Sorbietrees" vs "James Telfer (of
 *           Sorbietrees) (~1740–?)". Those should have linked and didn't.
 *
 * A FAMILY TREE THAT DISAGREES WITH ITSELF IS WORSE THAN A SHORT ONE. A
 * visitor who sees a man with three parents stops trusting the whole archive,
 * and they are right to.
 *
 * WHAT THIS GATE REFUSES
 * ----------------------
 *   1. A person with more than two resolved parents.
 *   2. A resolved parent edge where the parent does not list the child back.
 *   3. A person declared as their own ancestor or descendant.
 *   4. Unresolved relation names that are a normalised match for a real
 *      profile — i.e. a link that should have been made and wasn't.
 *
 * It does NOT refuse unresolved names with no matching profile — those are
 * legitimate future work, and this archive has 559 of them.
 *
 * Reads src/data/people.public.json. Exit 1 on any offence.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "src", "data", "people.public.json");

const REL_FIELDS = ["parents", "children", "spouses", "siblings"];

let people;
try {
  people = JSON.parse(readFileSync(DATA, "utf8"));
} catch (e) {
  console.error(`guard-relationship-integrity: cannot read ${DATA} — ${e.message}`);
  process.exit(1);
}

const by = new Map(people.map((p) => [p.slug, p]));
const offences = [];

const str = (x) => (typeof x === "string" ? x : null);
const kids = (p) =>
  (p?.children || []).map((c) => (typeof c === "string" ? c : c?.plain_name)).filter(Boolean);

// ── 1. More than two parents ────────────────────────────────────────────────
for (const p of people) {
  const resolved = (p.parents || []).map(str).filter(Boolean);
  if (resolved.length > 2) {
    const names = resolved.map((s) => by.get(s)?.display_name || s);
    offences.push({
      kind: "THREE PARENTS",
      who: p.slug,
      why: `${resolved.length} parents: ${names.join(" + ")} — a person has two`,
    });
  }
}

// ── 2. One-way parent edges ─────────────────────────────────────────────────
// A parent that does not list the child means the graph disagrees with itself.
// Reported as a count, not a blocker: the vault legitimately contains orphans
// whose parent page has not been updated. Only genuine RESOLVED pairs are
// checked, and the gate fails only above a small tolerated floor.
let oneWay = 0;
const oneWaySamples = [];
for (const p of people) {
  for (const par of (p.parents || []).map(str).filter(Boolean)) {
    const q = by.get(par);
    if (!q) continue;
    if (!kids(q).includes(p.slug)) {
      oneWay++;
      if (oneWaySamples.length < 12) oneWaySamples.push(`${par} -> ${p.slug}`);
    }
  }
}

// ── 3. Cycles: a person among their own ancestors ───────────────────────────
const seen = new Set();
const onPath = new Set();
let cycles = 0;
function walk(slug, depth) {
  if (depth > 40) return;
  if (onPath.has(slug)) {
    cycles++;
    if (cycles <= 5) offences.push({ kind: "CYCLE", who: slug, why: "is their own ancestor" });
    return;
  }
  if (seen.has(slug)) return;
  onPath.add(slug);
  for (const par of (by.get(slug)?.parents || []).map(str).filter(Boolean)) walk(par, depth + 1);
  onPath.delete(slug);
  seen.add(slug);
}
for (const p of people) walk(p.slug, 0);

// ── 4. Dangling names that SHOULD have linked ───────────────────────────────
//
// KNOWN, ACCEPTED FINDING — "Martha (Cameron)" → martha-cameron-1873 (2026-11-06).
// The family's habit of naming a married daughter by her husband's surname in
// brackets ("Martha (Cameron)" = Martha Telfer, who married Malcolm Cameron).
// The gate is right to point at it, and it must keep doing so, because a
// resolvable relationship nobody linked is exactly what this section exists to
// surface. It is NOT fixed by teaching the resolver that brackets mean marriage:
// that guess would bind "Martha (Cameron)" to any Cameron who ever married a
// Martha. The honest fix is in the vault — the sibling entry should carry the
// name her page actually bears. Until then this single finding is expected.
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const byNorm = new Map();
for (const p of people) {
  const key = norm(p.display_name || p.slug);
  if (!byNorm.has(key)) byNorm.set(key, p.slug);
  // also index "first last" without the span
  const bare = norm(`${p.first_name || ""} ${p.last_name || ""}`);
  if (bare && !byNorm.has(bare)) byNorm.set(bare, p.slug);
}

const shouldHaveLinked = new Map();
for (const p of people) {
  for (const f of REL_FIELDS) {
    for (const x of p[f] || []) {
      if (typeof x !== "object" || !x) continue;
      const nm = x.plain_name;
      if (!nm) continue;
      const hit = byNorm.get(norm(nm));
      if (hit && hit !== p.slug) shouldHaveLinked.set(nm, hit);
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const hard = offences.length > 0;
if (hard || oneWay > 0 || shouldHaveLinked.size > 0) {
  console.error("");
  console.error("❌ RELATIONSHIP INTEGRITY GATE");

  if (offences.length) {
    console.error(`\n   ${offences.length} impossible relationship(s):`);
    for (const o of offences) console.error(`   • [${o.kind}] ${o.who}: ${o.why}`);
  }

  if (shouldHaveLinked.size) {
    console.error(
      `\n   ${shouldHaveLinked.size} relation name(s) resolve to a real profile but were never linked:`
    );
    for (const [nm, slug] of [...shouldHaveLinked].slice(0, 15)) {
      console.error(`   • "${nm}"  should link to  ${slug}`);
    }
  }

  if (oneWay) {
    console.error(`\n   ${oneWay} parent edge(s) where the parent does not list the child back:`);
    for (const s of oneWaySamples) console.error(`   • ${s}`);
    if (oneWay > oneWaySamples.length) {
      console.error(`   … and ${oneWay - oneWaySamples.length} more`);
    }
  }

  console.error("");
  process.exit(1);
}

if (process.env.REL_GATE_VERBOSE === "1") {
  console.log(
    `✅ relationship integrity: ${people.length} people, 0 impossible, 0 mislinked, 0 one-way`
  );
}
process.exit(0);
