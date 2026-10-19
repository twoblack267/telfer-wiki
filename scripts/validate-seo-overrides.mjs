#!/usr/bin/env node
// Guard: every SEO_OVERRIDES key in src/pages/people/[slug].astro must be a REAL
// page slug present in src/data/people.public.json.
//
// Why: the founder-ancestor override was keyed on `john-telfer-of-castleton`, which
// is only a meta-refresh ALIAS shim. The override never reached the real page, so
// the most important ancestor page served generic template copy and nobody noticed
// for weeks. Card tw-2026-10-19-002. A dead key is a silent no-op; this makes it loud.
//
// Exit 0 = every key resolves. Exit 1 = names every offending key.
import { readFileSync } from "node:fs";

const astro = readFileSync("src/pages/people/[slug].astro", "utf8");
const people = JSON.parse(readFileSync("src/data/people.public.json", "utf8"));
const slugs = new Set(people.map((p) => p.slug).filter(Boolean));

const start = astro.indexOf("const SEO_OVERRIDES = {");
if (start === -1) {
  console.error("SEO-OVERRIDES GUARD: could not find SEO_OVERRIDES in src/pages/people/[slug].astro");
  process.exit(1);
}
const end = astro.indexOf("\n};", start);
if (end === -1) {
  console.error("SEO-OVERRIDES GUARD: could not find the end of SEO_OVERRIDES");
  process.exit(1);
}
const block = astro.slice(start, end);

const keys = [...block.matchAll(/^\s{2}"([^"]+)"\s*:\s*\{/gm)].map((m) => m[1]);
if (keys.length === 0) {
  console.error("SEO-OVERRIDES GUARD: parsed 0 keys — the block's shape changed, fix the parser");
  process.exit(1);
}

const dead = keys.filter((k) => !slugs.has(k));
if (dead.length) {
  console.error(`SEO-OVERRIDES GUARD FAIL: ${dead.length} of ${keys.length} key(s) are not real page slugs:`);
  for (const k of dead) console.error(`  - "${k}"`);
  console.error("A dead key silently disables that override. Re-key it to a slug in people.public.json.");
  process.exit(1);
}

console.log(`✅ SEO overrides: all ${keys.length} key(s) resolve to real person pages`);
