#!/usr/bin/env node
/**
 * emit-recent-profiles.mjs — generate src/data/recent-profiles.json
 *
 * WHY THIS EXISTS
 * ---------------
 * The home page used to derive "Recently Added" from the LAST SIX RECORDS IN THE
 * DATA FILE, i.e. file order. That is not "recent" — it is "whatever the converter
 * happened to emit last". Karla Telfer was created on 2026-10-25 and did not appear,
 * because the ordering was accidental. A label that lies is worse than no label.
 *
 * WHAT THIS DOES
 * --------------
 * Asks the Obsidian vault's git history when each person page was first ADDED
 * (git log --diff-filter=A), converts the vault filename to a slug, and writes the
 * true creation order. Newest first.
 *
 * The vault holds the truth; the wiki is downstream of it. If the vault is not a
 * git repo, this script FAILS LOUDLY rather than silently reverting to file order.
 *
 * Usage:  node scripts/emit-recent-profiles.mjs [--limit N]
 * Output: src/data/recent-profiles.json
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const VAULT = process.env.TELFER_VAULT || "/Users/marktelfer/ObsidianVault";
const PEOPLE_DIR = "Family History/People";
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  const n = i > -1 ? parseInt(process.argv[i + 1], 10) : 12;
  return Number.isFinite(n) && n > 0 ? n : 12;
})();

function fail(msg) {
  console.error(`❌ emit-recent-profiles: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(VAULT, ".git"))) {
  fail(`${VAULT} is not a git repo — cannot determine real creation dates. Refusing to guess.`);
}

// One git call: commit date + added file paths, newest commits first.
let raw;
try {
  raw = execFileSync(
    "git",
    ["-C", VAULT, "log", "--diff-filter=A", "--name-only", "--format=@@%ad", "--date=short", "--", PEOPLE_DIR],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
} catch (e) {
  fail(`git log failed in ${VAULT}: ${e.message}`);
}

// Parse. A file renamed later means git log may show the OLD path in an old commit;
// resolve every path to its CURRENT name so retitled pages are not emitted under a
// title that no longer exists (e.g. a birth-year correction from (b. 1983) to (b. 1993)).
let currentDate = null;
const firstSeen = new Map(); // path -> date (first sighting = latest add)

for (const line of raw.split("\n")) {
  const t = line.trim();
  if (!t) continue;
  if (t.startsWith("@@")) {
    currentDate = t.slice(2);
    continue;
  }
  if (!currentDate || !t.endsWith(".md")) continue;
  if (!firstSeen.has(t)) firstSeen.set(t, currentDate);
}

if (firstSeen.size === 0) {
  fail("parsed zero person files from vault git history — parsing or path is wrong.");
}

// Rename map: follow git history so an old path reports its current filename.
// `git log --follow --name-status` per file would be slow; instead ask git once for
// every rename it has recorded, which is cheap and complete for this vault.
const renames = new Map(); // oldPath -> newPath
try {
  const rs = execFileSync(
    "git",
    ["-C", VAULT, "log", "--diff-filter=R", "--name-status", "--format=", "-M", "--", PEOPLE_DIR],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  for (const line of rs.split("\n")) {
    const parts = line.trim().split("\t");
    if (parts.length === 3 && parts[0].startsWith("R")) renames.set(parts[1], parts[2]);
  }
} catch {
  // Renames are an enhancement; a vault with none must not be treated as an error.
}

function currentName(p19) {
  const file = p19.split("/").pop();
  // An UNCOMMITTED rename has no git record yet, so also check the working tree:
  // if the historical filename no longer exists on disk, the page was retitled and
  // the current name is the authority.
  if (!existsSync(join(VAULT, p19))) {
    const stem = file.replace(/\.md$/, "");
    // Try to find a live file that starts with the same person's leading names.
    const lead = stem.split("(")[0].trim();
    if (lead.length > 4) {
      try {
        const live = execFileSync("ls", [join(VAULT, PEOPLE_DIR)], { encoding: "utf8" })
          .split("\n")
          .filter((f) => f.endsWith(".md") && f !== file && f.startsWith(lead));
        if (live.length === 1) return join(PEOPLE_DIR, live[0]);
      } catch {
        /* fall through to git rename map */
      }
    }
  }
  let cur = p19;
  const seen = new Set();
  while (renames.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = renames.get(cur);
  }
  return cur;
}

const entries = [...firstSeen.entries()].map(([path, date]) => {
  const file = currentName(path).split("/").pop();
  return {
    file,
    title: file.replace(/\.md$/, ""),
    added: date,
  };
});

// Newest first; tie-break alphabetically so the order is deterministic, not random.
entries.sort((a, b) => (a.added === b.added ? a.title.localeCompare(b.title) : b.added.localeCompare(a.added)));

const out = {
  generated: new Date().toISOString(),
  source: `${VAULT} (git log --diff-filter=A -- ${PEOPLE_DIR})`,
  total_person_files: entries.length,
  people: entries.slice(0, LIMIT),
};

const dest = join(REPO_ROOT, "src", "data", "recent-profiles.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n", "utf8");

console.log(`✅ recent-profiles.json — ${entries.length} person files in vault history, emitting newest ${out.people.length}`);
for (const p of out.people.slice(0, 5)) console.log(`   ${p.added}  ${p.title}`);
