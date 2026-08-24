#!/usr/bin/env node
/**
 * find-sameas-candidates.mjs
 *
 * Deterministic sameAs candidate SCANNER for the auto-check step.
 *
 * This is the MECHANICAL part of the sameAs automation. It does NOT verify
 * anything against live web sources (that needs the reasoning agent). Its job:
 *
 *   1. Scan the whole tree for deceased ancestors (birth < 1901, has death year).
 *   2. Compare against an "already checked" registry (scripts/.sameas-checked.json)
 *      so it NEVER re-proposes a slug it has already surfaced. This stops the
 *      board from being flooded with the same 182 candidates every day.
 *   3. Emit ONLY the new/unchecked slugs to stdout as a JSON array — the cron
 *      agent then live-verifies these against 2 sources and either ships
 *      (confident, per governance) or asks Mark (unsure).
 *
 * READ-ONLY except for writing the registry file scripts/.sameas-checked.json.
 * It never touches sameas.json, people.public.json, or the live site.
 *
 * Usage: node scripts/find-sameas-candidates.mjs  (echoes JSON to stdout)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "src", "data", "people.public.json");
const checkedPath = join(__dirname, ".sameas-checked.json");
const EXISTING_SAMEAS = new Set(["james-telfer-1761", "adam-murray", "elizabeth-beattie-1741"]);

// Load registry of slugs already surfaced (so we never re-propose them).
let checked = { slugs: [], updated_at: null };
if (existsSync(checkedPath)) {
  try {
    checked = JSON.parse(readFileSync(checkedPath, "utf8"));
  } catch {
    checked = { slugs: [], updated_at: null };
  }
}
const checkedSet = new Set(checked.slugs || []);

function birthYearOf(p) {
  const raw = p.birth_year_display;
  if (!raw) return null;
  const m = String(raw).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

const people = JSON.parse(readFileSync(dataPath, "utf8"));
const allCandidates = people
  .map((p) => {
    const by = birthYearOf(p);
    return {
      slug: p.slug,
      name: p.display_name,
      born: by,
      death: p.death_year_display,
      familyName: (p.last_name || "").trim(),
    };
  })
  .filter((c) => c.born !== null && !Number.isNaN(c.born) && c.born < 1901)
  .filter((c) => !!c.death) // deceased-only confidence signal
  .sort((a, b) => (a.born || 0) - (b.born || 0));

// New (unchecked) candidates = not in registry AND not already sameAs-live.
const newCandidates = allCandidates.filter(
  (c) => !checkedSet.has(c.slug) && !EXISTING_SAMEAS.has(c.slug)
);

// Append freshly-surfaced to the registry so the next run doesn't re-propose.
checked.slugs.push(...newCandidates.map((c) => c.slug));
checked.updated_at = new Date().toISOString();
writeFileSync(checkedPath, JSON.stringify(checked, null, 2), "utf8");

// Emit new candidates to stdout (JSON). cron agent consumes + live-verifies.
process.stdout.write(JSON.stringify({
  generated_at: new Date().toISOString(),
  total_scanned: allCandidates.length,
  previously_checked: allCandidates.length - newCandidates.length,
  new_candidates: newCandidates.map((c) => ({ slug: c.slug, name: c.name, born: c.born, death: c.death })),
}, null, 2));
