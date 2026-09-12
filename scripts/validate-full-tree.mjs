#!/usr/bin/env node
// Guard: the full-tree page must actually RENDER a family tree.
// A tree with 1-2 nodes means the relationship graph is empty/stale — the page is busted.
// "A check that passes on the known-bad artifact is worthless." (Skippy, 2026-09-12)
import fs from "node:fs";
import path from "node:path";

const HTML = path.join(process.cwd(), "dist", "people", "full-tree", "index.html");
const MIN_NODES = Number(process.env.FULL_TREE_MIN_NODES ?? 20);

if (!fs.existsSync(HTML)) {
  console.error(`❌ full-tree guard: missing ${HTML} — was the build run?`);
  process.exit(1);
}
const html = fs.readFileSync(HTML, "utf8");
const ids = [...html.matchAll(/data-id="([^"]*)"/g)].map((m) => m[1]);
const uniq = new Set(ids);

console.log(`🌳 full-tree nodes rendered: ${uniq.size} (unique) / ${ids.length} (total)`);
if (uniq.size > 0) console.log(`   root: ${ids[0]}`);

if (uniq.size === 0) {
  console.error("❌ full-tree guard: ZERO nodes — the tree page is empty.");
  process.exit(1);
}
if (uniq.size < MIN_NODES) {
  console.error(
    `❌ full-tree guard: only ${uniq.size} nodes rendered (minimum ${MIN_NODES}).\n` +
    `   The family tree is NOT being rendered. Most likely cause: people.json relationship\n` +
    `   arrays (children/spouses/parents/siblings) are empty or stale for most records.\n` +
    `   Fix: run the vault->people.json pump (scripts/convert-markdown.mjs) and ensure the\n` +
    `   relationship refs resolve to real slugs. Do NOT lower MIN_NODES to make this pass.`
  );
  process.exit(1);
}
console.log("🎉 full-tree guard: the tree renders.");

// ── SOURCE-SIDE CHECK: the graph itself, not just the rendered page ──────────────
// Rationale (2026-09-12): the rendered symptom is "the tree is empty", but the CAUSE is always a
// hollow relationship graph in people.json. Checking the source means the failure message names the
// real problem, and it fires even if the page later learns to render without the graph.
//
// Baselines measured on a healthy build: 322/355 records carry relationships, 2041 total refs.
// Floors are set well below that so genuine growth never trips them, but the 2026-09-12 fault
// (207 records / 644 refs) fails hard.
const MIN_RECORDS_WITH_RELATIONSHIPS = Number(process.env.MIN_RECORDS_WITH_RELATIONSHIPS ?? 280);
const MIN_RELATIONSHIP_REFS = Number(process.env.MIN_RELATIONSHIP_REFS ?? 1500);
const PEOPLE = path.join(process.cwd(), "src", "data", "people.json");

if (fs.existsSync(PEOPLE)) {
  const people = JSON.parse(fs.readFileSync(PEOPLE, "utf8"));
  const FIELDS = ["parents", "children", "siblings", "spouses"];
  let refs = 0;
  let withRel = 0;
  for (const p of people) {
    let n = 0;
    for (const f of FIELDS) n += Array.isArray(p[f]) ? p[f].length : 0;
    refs += n;
    if (n > 0) withRel++;
  }
  console.log(`🔗 relationship graph: ${withRel}/${people.length} records carry relationships · ${refs} refs`);

  const problems = [];
  if (withRel < MIN_RECORDS_WITH_RELATIONSHIPS) {
    problems.push(`records with relationships ${withRel} < floor ${MIN_RECORDS_WITH_RELATIONSHIPS}`);
  }
  if (refs < MIN_RELATIONSHIP_REFS) {
    problems.push(`total relationship refs ${refs} < floor ${MIN_RELATIONSHIP_REFS}`);
  }
  if (problems.length) {
    console.error(
      `❌ full-tree guard: the RELATIONSHIP GRAPH is hollow — ${problems.join("; ")}.\n` +
      `   This is the data-layer cause of an empty tree, not a rendering bug.\n` +
      `   Known cause (fixed 2c5f897): scripts/build-relationship-graph.mjs compared a year-stripped\n` +
      `   name against a p.id that CARRIES the years, so every year-carrying vault reference fell\n` +
      `   through to return null — 1604 refs destroyed across 249 records per run.\n` +
      `   Diagnose: node scripts/convert-markdown.mjs  →  node scripts/build-relationship-graph.mjs\n` +
      `   and compare the ref count before/after. Then run bash scripts/regenerate-data.sh.\n` +
      `   Do NOT lower these floors and do NOT hand-edit people.json.`
    );
    process.exit(1);
  }
  console.log("🎉 full-tree guard: relationship graph is populated.");
} else {
  console.log("⚠️  full-tree guard: src/data/people.json not found — source check skipped.");
}

// ── LAYER 3: EDGE-INTEGRITY CHECK (added 2026-09-12) ─────────────────────────────
// Rationale: layers 1-2 catch an EMPTY tree. They cannot catch a tree that renders but is
// SILENTLY WRONG — an edge pointing at a slug that does not exist (dangling), or a page that
// renders fewer nodes than the data declares. The 2026-09-12 fault was exactly this shape:
// the rendered page looked plausible while the underlying links had been gutted. A build that
// "passes" while pointing at ghosts is worse than a loud failure, because nobody looks.
//
// Proven necessary by negative test: injecting a single bogus endpoint into
// src/data/relationship-graph.json must make this guard EXIT 1. If it does not, the guard is
// decoration. Never lower these to make a build pass — fix the graph builder.
const GRAPH = path.join(process.cwd(), "src", "data", "relationship-graph.json");

if (fs.existsSync(PEOPLE) && fs.existsSync(GRAPH)) {
  const people = JSON.parse(fs.readFileSync(PEOPLE, "utf8"));
  const graph = JSON.parse(fs.readFileSync(GRAPH, "utf8"));
  const slugs = new Set(people.map((p) => p.slug));
  const referenced = new Set();
  let edgeCount = 0;
  for (const list of Object.values(graph.edges ?? {})) {
    for (const e of list ?? []) {
      edgeCount++;
      referenced.add(e.from);
      referenced.add(e.to);
    }
  }
  const dangling = [...referenced].filter((s) => !slugs.has(s));
  console.log(`🕸  edge integrity: ${edgeCount} edges · ${referenced.size} endpoints · ${dangling.length} dangling`);

  const probs = [];
  if (dangling.length) {
    probs.push(`${dangling.length} edge endpoint(s) point at a slug that does not exist: ${dangling.slice(0, 8).join(", ")}${dangling.length > 8 ? " …" : ""}`);
  }
  // The graph must never SHRINK the population it describes.
  const nodes = (graph.nodes ?? []).length;
  if (nodes < people.length) {
    probs.push(`graph declares ${nodes} nodes but people.json has ${people.length} records — edges were dropped for ${people.length - nodes} people`);
  }
  // A dangling endpoint is a broken link on a rendered page. Zero tolerance.
  if (probs.length) {
    console.error(
      `❌ full-tree guard: EDGE INTEGRITY FAILED — ${probs.join("; ")}\n` +
      `   A rendered tree containing ghost links is silently wrong: it looks fine and shows the\n` +
      `   wrong family. Cause is almost always the graph builder resolving a reference to a slug\n` +
      `   that no longer exists (rename, slug change, deleted page).\n` +
      `   Diagnose: node scripts/build-relationship-graph.mjs  →  re-run this script.\n` +
      `   Do NOT delete a dangling ref to silence this — either the page is missing or the slug changed.`
    );
    process.exit(1);
  }
  console.log("🎉 full-tree guard: every relationship edge points at a real person.");
} else {
  console.log("⚠️  full-tree guard: graph/people source missing — edge-integrity check skipped.");
}
