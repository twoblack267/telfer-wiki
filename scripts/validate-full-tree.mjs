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
