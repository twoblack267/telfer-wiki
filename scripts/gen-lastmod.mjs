#!/usr/bin/env node
/**
 * gen-lastmod.mjs — build a committed slug -> lastmod date map.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sitemap needs a <lastmod> per URL so Google knows what changed and what
 * to recrawl. The natural source is the git date of each person's own markdown
 * file in the OBSIDIAN VAULT.
 *
 * That works locally but NOT in CI: the vault is a separate git repo at an
 * absolute path (/Users/marktelfer/ObsidianVault) which is simply absent on an
 * Ubuntu runner. An earlier version called git against that path from
 * astro.config.ts; in CI every lookup failed, every person fell back to the
 * same value (the checkout time), and the published sitemap carried ONE
 * identical timestamp across all 981 URLs — measured, 2026-09-21.
 *
 * So we resolve dates HERE, on the machine that has the vault, and write them
 * into src/data/lastmod.json, which IS committed. The Astro config then just
 * reads that file: same dates locally and in CI, no git needed at build time.
 *
 * RUN:  node scripts/gen-lastmod.mjs     (after any vault change, before commit)
 *
 * FALLBACK: a person with no matching vault file simply gets no entry; the
 * config then omits <lastmod> for that page rather than inventing one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const VAULT_DIR = "/Users/marktelfer/ObsidianVault";
const VAULT_PEOPLE_DIR = "Family History/People";

/** git last-commit date (ISO) for a path inside a repo; null on any failure. */
function gitDate(repoDir, relPath) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", relPath], {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (!out) return null;
    const d = new Date(out);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** "Adam Murray (1728–1816) — Father of..." -> "adam murray" (name only). */
function personName(s) {
  return s
    .split("—")[0]
    .split(" - ")[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

/**
 * "Adam Murray (1728–1816).md" -> { name:"adam murray", first:"adam",
 * last:"murray", year:"1728" }
 */
function manifestParts(fname) {
  const bare = fname.replace(/\.md$/i, "").trim();
  const name = bare.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  const years = bare.match(/\((\d{3,4})[–\-]/);
  return { name, first: name.split(/\s+/)[0] || "", last: name.split(/\s+/).pop() || "", year: years ? years[1] : null };
}

/**
 * Match a wiki person to a vault file, using the person's OWN birth_year field.
 *
 * NOTE: do NOT extract the year from the title. Titles look like
 *   "Joel Ivory — Family & Biography"
 * with no year at all, while the record carries birth_year: 1986 separately.
 * An earlier version parsed the title and silently matched almost nothing.
 *
 * PASS 1 — exact full-name match, so nothing that already worked can regress.
 * PASS 2 — first name + last name + birth_year. Needed because some vault
 * filenames carry a middle name the wiki title omits:
 *   wiki  "Joel Ivory"  birth_year 1986   (slug joel-ivory-1986)
 *   vault "Joel Matthew Ivory (1986–?).md"
 * First+last+year rather than fuzzy matching: a near-match could stamp a LIVING
 * person's page with a stranger's date. Ambiguous candidates -> no match at all.
 */
function matchVaultFile(person, byName, byTriple) {
  const full = personName(person.title || person.name || "");
  const exact = byName.get(full);
  if (exact) return { file: exact, how: "exact" };

  const y = String(person.birth_year || "").trim();
  if (!/^\d{3,4}$/.test(y)) return null;
  const first = full.split(/\s+/)[0] || "";
  const last = full.split(/\s+/).pop() || "";
  if (!first || !last) return null;

  const cands = byTriple.get(`${first}|${last}|${y}`);
  if (!cands || cands.length !== 1) return null; // ambiguous -> no guess
  return { file: cands[0], how: "first+last+year" };
}

// 1. vault filename -> git date, once per file (cheap: ~380 git calls max).
const vaultFiles = (() => {
  try {
    const man = JSON.parse(readFileSync(resolve(ROOT, "src/data/vault-manifest.json"), "utf-8"));
    return Object.keys(man.files || {});
  } catch (e) {
    console.error("FATAL: cannot read vault-manifest.json:", e.message);
    process.exit(1);
  }
})();

const fileDate = new Map();
for (const f of vaultFiles) {
  const d = gitDate(VAULT_DIR, `${VAULT_PEOPLE_DIR}/${f}`);
  if (d) fileDate.set(f, d);
}
console.log(`vault files: ${vaultFiles.length}, with git dates: ${fileDate.size}`);

// 2. Build both lookup indexes from the vault filenames:
//    byName   : "adam murray"       -> file  (exact match, pass 1)
//    byTriple : "adam|murray|1728"  -> [file] (first+last+year, pass 2)
//
// NOTE: byName is keyed on the FULL vault name and picks the NEWEST date when
// several files share a name. An earlier rewrite used a plain .set() (last file
// won) and silently reset 16 people to the oldest date in the whole set — keep
// the "newest wins" comparison.
const byName = new Map();
const byTriple = new Map();
for (const [f, d] of fileDate) {
  const m = manifestParts(f);
  if (!m.name) continue;
  const prev = byName.get(m.name);
  if (!prev || d > fileDate.get(prev)) byName.set(m.name, f);

  if (m.year && m.first && m.last) {
    const k = `${m.first}|${m.last}|${m.year}`;
    const arr = byTriple.get(k) || [];
    arr.push(f);
    byTriple.set(k, arr);
  }
}

// 3. slug -> date, via the people data the pages actually render from.
const people = JSON.parse(readFileSync(resolve(ROOT, "src/data/people.public.json"), "utf-8"));
const out = {};
let hit = 0;
let hitExact = 0;
let hitTriple = 0;
const misses = [];
for (const p of people) {
  if (!p.slug) continue;
  const human = (p.title || p.name || "").trim();
  if (!human) continue;
  const m = matchVaultFile(p, byName, byTriple);
  const d = m ? fileDate.get(m.file) : null;
  if (d) {
    out[p.slug] = d;
    hit++;
    if (m.how === "exact") hitExact++;
    else hitTriple++;
  } else {
    misses.push(`${p.slug}  (${human})`);
  }
}

const payload = {
  generated_at: new Date().toISOString(),
  vault_dir: VAULT_DIR,
  source: "git last-commit dates of Obsidian vault person files",
  count: hit,
  people: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))),
};

const dest = resolve(ROOT, "src/data/lastmod.json");
writeFileSync(dest, JSON.stringify(payload, null, 2) + "\n");

const pct = ((100 * hit) / people.length).toFixed(1);
console.log(`matched ${hit}/${people.length} people (${pct}%)  [exact ${hitExact}, first+last+year ${hitTriple}]`);
console.log(`wrote ${dest}`);
if (misses.length) {
  console.log(`\nno vault match (${misses.length}) — these get NO <lastmod>, not a guessed one:`);
  for (const m of misses.slice(0, 20)) console.log("  " + m);
  if (misses.length > 20) console.log(`  ... and ${misses.length - 20} more`);
}
