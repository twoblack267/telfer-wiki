#!/usr/bin/env node
/**
 * flag-sameas-candidates.mjs
 *
 * Generates a DRAFT list of ancestors that are strong candidates for public-tree
 * `sameAs` links (WikiTree / FamilySearch / FindAGrave / WikiData).
 *
 * READ-ONLY: this script does NOT modify people.public.json, sameas.json, or the
 * site. It writes ONE candidate report file for human (Mark) review:
 *   scripts/sameas-candidates.json
 *
 * The candidate list is built from local data only (no live scraping — the
 * genealogy-lookup worker independently verifies which profiles actually exist).
 * Mark approves the verified URLs → they go into src/data/sameas.json.
 *
 * Usage: node scripts/flag-sameas-candidates.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "src", "data", "people.public.json");
const outPath = join(__dirname, "..", "scripts", "sameas-candidates.json");

const people = JSON.parse(readFileSync(dataPath, "utf8"));

// ── Candidate window ─────────────────────────────────────────────
// Focus on deceased ancestors who have a reasonable public footprint:
// born before 1901 (i.e. >~125 years ago) so they're safely out of living-recency
// and most likely to have WikiTree/FindAGrave/records presence.
function birthYearOf(p) {
  const raw = p.birth_year_display;
  if (!raw) return null;
  const m = String(raw).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}

// Common-title removal for familyName (keeps schema familyName compatible).
function cleanFamilyName(fn) {
  return (fn || "").trim();
}

const candidates = people
  .map((p) => {
    const by = birthYearOf(p);
    return { slug: p.slug, name: p.display_name, born: by, death: p.death_year_display, familyName: cleanFamilyName(p.last_name) };
  })
  .filter((c) => c.born !== null && !Number.isNaN(c.born) && c.born < 1901)
  // Deceased-only confidence signal: has a death year or is not marked living
  .filter((c) => !!(c.death))
  .sort((a, b) => (a.born || 0) - (b.born || 0));

const report = {
  generated_at: new Date().toISOString(),
  source_data: {
    people_file: "src/data/people.public.json",
    note: "Candidate list derived from local data. Actual URL existence must be verified per profile (worker + Mark approval) before adding to sameas.json.",
  },
  policy: {
    window: "deceased, birth year < 1901, has a death year recorded",
    note: "SameAs links only for ancestors Mark has explicitly approved. Living people and unverified matches are excluded by default.",
  },
  total_candidates: candidates.length,
  candidates: candidates.map((c) => ({
    slug: c.slug,
    name: c.name,
    born: c.born,
    death: c.death,
    // Pre-filled to-help-check surface; empty until verified:
    verified_urls: [],
    status: "PENDING_REVIEW",
  })),
};

writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(`✅ Wrote ${candidates.length} sameAs candidates -> scripts/sameas-candidates.json`);
console.log("   Review + mark verified_urls, then populate src/data/sameas.json");
