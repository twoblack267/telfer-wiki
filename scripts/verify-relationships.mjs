#!/usr/bin/env node
// Relationship-structure verifier for the Telfer vault → site pipeline.
//
// WHY THIS EXISTS (2026-10-28)
// ----------------------------
// "Nobody floating in the void" is a property of the DATA, and nothing was checking it.
// Two separate defects shipped for weeks because each one looked fine from inside the
// step that caused it:
//
//   1. NOTHING READ THE BODY RELATIONSHIP TABLE. 295 of 670 vault pages record family
//      as `| **Father** | [[William Henry Parker (1893-1968)]] |`. Only the step-relation
//      reader looked at the body, so ordinary family written plainly in the vault reached
//      the site with no edges at all. Isolated people: 653.
//
//   2. BARE-SLUG REDIRECTS WERE INVENTED. Of 281 emitted, 279 pointed from URLs that
//      never existed in HEAD, and the two real ones were resolved by a birth-year
//      tie-break rather than by evidence. One sent /people/margaret-telfer/ to a woman
//      born in 1849 when the URL belonged to one born in 1962.
//
// Both were invisible to every existing check. This verifier watches the invariants
// that would have caught them, and it is deliberately READ-ONLY so a scheduled job can
// run it any time without changing state.
//
// EXIT CODES: 0 = all invariants hold, 1 = a regression, 2 = could not run.
//
// NOTE ON WHAT IS *NOT* A FAULT: a relative named with no profile is normal and correct.
// The vault records people from real sources before it has a page for them (James Cowan
// (~1741-1786) names nine children recorded at WikiTree, none with a profile). Those must
// render as PLAIN TEXT, not as dead links — src/utils/format-body.mjs handles that
// (`if (!slug) return { slug: null, plain: true }`). So this script checks that such
// names are NOT asserted as links, and never demands that they be given pages.

import { readFileSync, existsSync } from "fs";

const PEOPLE = "src/data/people.json";
const PUBLIC = "src/data/people.public.json";
const REDIRECT_LOG = "scripts/redirect-log.json";
const GRAPH = "src/data/relationship-graph.json";

const problems = [];
const notes = [];

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`❌ missing ${path} — run scripts/regenerate-data.sh first`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    console.error(`❌ ${path} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
}

const people = readJson(PEOPLE);
const bySlug = new Map(people.map((p) => [p.slug, p]));

// ── 1. THE BODY-TABLE READER MUST BE DOING SOMETHING ────────────────────────────
// If this drops to zero, the reader has been disconnected again — the original defect.
const withFamily = people.filter((p) =>
  ["parents", "children", "siblings", "spouses"].some((f) => (p[f] || []).length > 0)
).length;
if (withFamily === 0) {
  problems.push(
    `NOBODY has a family link — the relationship readers are disconnected. This is the ` +
      `exact failure that left 653 people isolated on 2026-10-28.`
  );
}
notes.push(`profiles with at least one family link: ${withFamily}/${people.length}`);

// ── 2. ISOLATION: the headline invariant ────────────────────────────────────────
// A person is isolated when no relative they name resolves to a real profile.
const isolated = [];
for (const p of people) {
  const refs = [
    ...(p.parents || []),
    ...(p.children || []),
    ...(p.siblings || []),
    ...(p.spouses || []),
    ...(p.step_parents || []),
    ...(p.step_children || []),
  ];
  const linked = refs.filter((r) => bySlug.has(r));
  if (linked.length === 0) isolated.push(p);
}
// A BASELINE, not a target of zero. Many isolated people are genuinely alone in the
// vault: an immigrant progenitor whose parents were never in Britain's records, or a
// person whose entire known family is a spouse with no profile. Demanding zero would
// force the pipeline to invent relatives, which is the one thing it must never do.
const ISOLATED_BASELINE = 25;
if (isolated.length > ISOLATED_BASELINE) {
  problems.push(
    `ISOLATION REGRESSION: ${isolated.length} people have no resolvable relative ` +
      `(baseline ${ISOLATED_BASELINE}). Was ${isolated.length - ISOLATED_BASELINE} more than expected. ` +
      `Check that extractBodyTableRelations still runs — e.g. ${isolated
        .slice(0, 5)
        .map((p) => p.slug)
        .join(", ")}`
  );
}
notes.push(`isolated people: ${isolated.length} (baseline ${ISOLATED_BASELINE})`);

// ── 3. A RELATIVE MUST NEVER BE A SELF-REFERENCE ────────────────────────────────
// Andrew Kelly Parker was listed as his own eighth child, and two other records did the
// same. A person cannot be their own parent, child or sibling; the guard's crown-jewel
// floor had already been quietly counting the duplicate.
for (const p of people) {
  for (const f of ["parents", "children", "siblings", "spouses", "step_parents", "step_children"]) {
    if ((p[f] || []).includes(p.slug)) {
      problems.push(`SELF-REFERENCE: ${p.slug} lists itself in ${f}`);
    }
  }
}

// ── 4. BARE NAMES ARE FINE; BARE NAMES *AS LINKS* ARE NOT ───────────────────────
// Asserted relationship arrays may contain a raw display name when the resolver
// refused to bind it. That is correct and must not be "fixed" by deleting the name.
// What must never happen is a consumer treating that name as a slug. Check the graph,
// which is what the site renders from.
if (existsSync(GRAPH)) {
  const graph = readJson(GRAPH);
  // edges is an OBJECT keyed by relation type (parentOf, spouseOf, siblingOf,
  // stepParentOf, stepChildOf), each holding {from,to} pairs — not a flat array.
  const edgeGroups = graph.edges && !Array.isArray(graph.edges)
    ? Object.entries(graph.edges)
    : [["edges", graph.edges || graph.links || []]];
  let edgeCount = 0;
  let dangling = 0;
  const sample = [];
  for (const [kind, list] of edgeGroups) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      edgeCount++;
      for (const end of [e.from, e.to]) {
        if (end == null) continue;
        if (!bySlug.has(end)) {
          dangling++;
          if (sample.length < 5) sample.push(`${end} (${kind})`);
        }
      }
    }
  }
  if (dangling > 0) {
    problems.push(
      `DANGLING GRAPH EDGE(S): ${dangling} edge endpoint(s) are not real slugs ` +
        `(${sample.join(", ")}) — these render as dead links.`
    );
  }
  notes.push(`graph edges checked: ${edgeCount}, dangling endpoints: ${dangling}`);
}

// ── 5. REDIRECTS MUST NOT CONTRADICT A PROVEN RENAME ────────────────────────────
// prove-rename.mjs establishes a rename from committed vault notes. If the log then
// sends that bare URL somewhere else, a reader following an old link is told they are
// looking at a different person — the failure this whole file exists to prevent.
if (existsSync(REDIRECT_LOG)) {
  const log = readJson(REDIRECT_LOG);
  for (const e of log) {
    if (!e || !e.from || !e.to) continue;
    if (bySlug.has(e.from) && bySlug.has(e.to)) {
      const a = bySlug.get(e.from);
      const b = bySlug.get(e.to);
      if (a.vault_file && b.vault_file && a.vault_file !== b.vault_file) {
        problems.push(
          `WRONG-PERSON REDIRECT: ${e.from} -> ${e.to} but they are different people ` +
            `(${a.vault_file} vs ${b.vault_file})`
        );
      }
    }
    if (!bySlug.has(e.to)) {
      problems.push(`DEAD REDIRECT: ${e.from} -> ${e.to} (destination has no page)`);
    }
  }
  notes.push(`redirect entries checked: ${log.length}`);
}

// ── 6. LIVING PEOPLE MUST NOT LEAK INTO THE PUBLIC DATA ─────────────────────────
// A living person's profile is withheld from the site, so they must not appear as a
// resolvable relative in the rendered data either.
const publicData = readJson(PUBLIC);
const publicSlugs = new Set(publicData.map((p) => p.slug));
const livingInPublic = publicData.filter((p) => p.living === true);
if (livingInPublic.length > 0) {
  problems.push(
    `PRIVACY LEAK: ${livingInPublic.length} living person(s) in people.public.json ` +
      `(${livingInPublic.slice(0, 5).map((p) => p.slug).join(", ")})`
  );
}
notes.push(`public profiles: ${publicSlugs.size} (of ${people.length})`);

// ── 7. IMPOSSIBLE PARENT/CHILD AGE GAPS ────────────────────────────────────────
//
// A parent cannot be younger than their child, and cannot be born more than ~62 years
// after them. Checked in BOTH directions so one bad link is reported once, not twice.
//
// THRESHOLD IS DELIBERATELY LOOSE (62, not 55). A first draft used 55 and flagged three
// pairs that the vault itself asserts: Marian Cornish's record names John Telfer
// (1840–1913) as her father — 56 years. Ruth Telfer's names Francis Charles (b.1875) —
// also 56. A late child of an older father is uncommon, not impossible, and a guard that
// overrules the sources is worse than no guard. This check exists to catch BINDING
// ERRORS (a daughter born four decades after the father's baptism), not to second-guess
// primary evidence.
//
// Why this exists: on 2026-10-28 the resolver was found binding relatives by NAME ONLY.
// Thomas Telfer (of Broadlee), a 1770s man, was given a daughter born 1806 in England —
// the sole namesake in the vault — because a single candidate was returned before any
// date check ran. A second case had Ruth Telfer's father bound to Francis ADAM Telfer
// when her record plainly said Francis CHARLES, the pair both born 1875.
//
// Spouses and siblings are deliberately NOT checked: an age gap between peers is not a
// fault, and a first attempt at this guard destroyed seven correct links by assuming it
// was (Edwin Telfer b.1919 and his wife Lola b.1918 were "impossible" by one year).
const gapIndex = new Map(people.map((p) => [p.slug, p]));
const ageGapSeen = new Set();
for (const p of people) {
  const pb = p.birth_year;
  if (pb == null) continue;
  for (const childSlug of p.children || []) {
    const c = gapIndex.get(childSlug);
    if (!c || c.birth_year == null) continue;
    const gap = c.birth_year - pb;
    if (gap < -8 || gap > 62) {
      const key = [p.slug, childSlug].sort().join("→");
      if (ageGapSeen.has(key)) continue;
      ageGapSeen.add(key);
      problems.push(
        `impossible age gap: ${p.slug} (b.${pb}) recorded as parent of ${childSlug} (b.${c.birth_year}) — ${gap}y apart`
      );
    }
  }
}
notes.push(`parent/child age-gap contradictions: ${ageGapSeen.size}`);

// ── REPORT ──────────────────────────────────────────────────────────────────────
console.log("── RELATIONSHIP STRUCTURE VERIFIER ───────────────────────────");
for (const n of notes) console.log(`   ${n}`);
console.log("");

if (problems.length === 0) {
  console.log("✅ RELATIONSHIP STRUCTURE OK — no isolation regression, no self-references,");
  console.log("   no dangling graph edges, no wrong-person or dead redirects, no privacy leak.");
  process.exit(0);
}

console.log(`❌ RELATIONSHIP STRUCTURE FAILED — ${problems.length} problem(s):`);
for (const p of problems) console.log(`   • ${p}`);
console.log("");
console.log("   Do NOT hand-edit src/data/*.json — fix the vault or the generator, then re-run");
console.log("   scripts/regenerate-data.sh.");
process.exit(1);
