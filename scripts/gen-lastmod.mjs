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

/** "Adam Murray (1728–1816) — Father of..." -> "adam murray" */
function personKey(s) {
  return s
    .split("—")[0]
    .split(" - ")[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

/** "Adam Murray (1728–1816).md" -> "adam murray" */
function manifestKey(fname) {
  return fname
    .replace(/\.md$/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
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

// 2. name-key -> newest date across vault files carrying that name.
const dateByName = new Map();
for (const [f, d] of fileDate) {
  const k = manifestKey(f);
  if (!k) continue;
  const prev = dateByName.get(k);
  if (!prev || d > prev) dateByName.set(k, d);
}

// 3. slug -> date, via the people data the pages actually render from.
const people = JSON.parse(readFileSync(resolve(ROOT, "src/data/people.public.json"), "utf-8"));
const out = {};
let hit = 0;
const misses = [];
for (const p of people) {
  if (!p.slug) continue;
  const rawName = (p.name || p.title || "").trim();
  if (!rawName) continue;
  const d = dateByName.get(personKey(rawName));
  if (d) {
    out[p.slug] = d;
    hit++;
  } else {
    misses.push(`${p.slug}  (${rawName})`);
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
console.log(`matched ${hit}/${people.length} people (${pct}%)`);
console.log(`wrote ${dest}`);
if (misses.length) {
  console.log(`\nno vault match (${misses.length}) — these get NO <lastmod>, not a guessed one:`);
  for (const m of misses.slice(0, 20)) console.log("  " + m);
  if (misses.length > 20) console.log(`  ... and ${misses.length - 20} more`);
}
