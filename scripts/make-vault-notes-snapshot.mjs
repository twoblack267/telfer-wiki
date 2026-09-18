#!/usr/bin/env node
/**
 * Capture the vault's NON-PERSON notes into a committed snapshot so CI can resolve them.
 *
 * WHY THIS EXISTS (2026-09-18, tw-2026-09-18-006):
 * check-body-links.mjs resolves every [[wikilink]] in a profile body against people.json.
 * A body link to a NON-PERSON vault note — e.g. [[Lawrie Family - Carslake Connection]],
 * a History/ note the author linked deliberately — resolves to null, so the guard reports
 * it as a DEAD person-link and BLOCKS the build. The vault was correct; the guard simply
 * had no way to know the note exists.
 *
 * The guard CANNOT read the vault: CI is a fresh runner with no Obsidian vault, and
 * check-body-links.mjs deliberately dropped its old vault-filesystem probe because it made
 * local (vault present -> lenient) and CI (no vault -> strict) behave DIFFERENTLY — the
 * exact blind spot that let real dead links slip through CI only (see its header, 2026-08-27).
 *
 * So the notes are committed as data, exactly like family-rows.snapshot.json already is for
 * the Family-cell guard, and BOTH local and CI resolve against the same committed list. A
 * genuinely dead link still resolves to nothing and still blocks the build.
 *
 * ── SCOPE (deliberate, privacy-bounded) ─────────────────────────────────────────
 * Only note folders that are ALREADY public-facing appear in this snapshot:
 *   History/, Reference/, Events/  + top-level index notes (_Index, Family Tree, Telfer Tree,
 *   Corrections Log, "How We Work (Telfer Wiki Rules)").
 *
 * Documents/ and Websites/ are EXCLUDED BY RULE — never scanned, never listed, so their
 * contents can never reach this file or the public repo. They are invoices, certificates,
 * affidavits and credentials; a build guard has no reason to enumerate them, and listing
 * them would publish the private family's document inventory.
 *
 * This file contains note TITLES ONLY — no note content is ever read or emitted.
 *
 * Run on the machine that owns the vault, whenever public notes are added/renamed:
 *   node scripts/make-vault-notes-snapshot.mjs
 * Then commit scripts/vault-notes.snapshot.json.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "scripts", "vault-notes.snapshot.json");

const CANDIDATES = [
  process.env.TELFER_VAULT_ROOT,
  join(ROOT, "vault-checkout"),
  join(homedir(), "ObsidianVault", "Family History"),
  join(ROOT, "..", "ObsidianVault", "Family History"),
].filter(Boolean);

const VAULT = CANDIDATES.find((c) => {
  try { return existsSync(c) && statSync(c).isDirectory(); } catch { return false; }
});

// Folders whose notes are legitimately linkable from a public profile body.
// Documents/ and Websites/ are NOT here, by rule. Do not add them without Mark's say-so.
const PUBLIC_DIRS = ["History", "Reference", "References", "Events"];

// Top-level notes (direct children of the vault root) that are public index/reference notes.
// Matched by stem, case-insensitive.
const PUBLIC_TOP_LEVEL = new Set([
  "_index",
  "family tree",
  "telfer tree",
  "corrections log",
  "how we work (telfer wiki rules)",
]);

// Never treat these as resolvable link targets even inside a public dir.
const SKIP_FILE = (name) =>
  name.startsWith(".") ||
  /\.bak-/.test(name) ||
  /\.prezabella-/.test(name) ||
  /\.seal-/.test(name) ||
  /^~/i.test(name) ||              // editor temp files
  name.toLowerCase() === "templates";

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP_FILE(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      // never descend into backup/working/private folders
      if (e.name.startsWith("_")) continue;
      if (e.name === "People") continue;
      walk(full, acc);
    } else if (e.name.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

if (!VAULT) {
  console.error("❌ Cannot find the vault root. Set TELFER_VAULT_ROOT to it. Snapshot NOT written.");
  process.exit(1);
}

const files = [];
for (const d of PUBLIC_DIRS) {
  const dir = join(VAULT, d);
  if (existsSync(dir)) walk(dir, files);
}
// top-level notes only (no recursion — deeper folders are covered by PUBLIC_DIRS)
try {
  for (const e of readdirSync(VAULT, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md") || SKIP_FILE(e.name)) continue;
    const stem = e.name.replace(/\.md$/i, "").toLowerCase();
    if (PUBLIC_TOP_LEVEL.has(stem)) files.push(join(VAULT, e.name));
  }
} catch { /* vault root unreadable */ }

// Emit note titles only. Titles are BOTH the bare stem and the vault-relative path,
// because a vault link may be written either way ([[Lawrie Family - Carslake Connection]]
// or [[History/Lawrie Family - Carslake Connection]]). No content is read.
const titles = new Set();
for (const f of files) {
  const rel = relative(VAULT, f).split(sep).join("/");
  const stem = rel.replace(/\.md$/i, "");
  const base = stem.split("/").pop();
  titles.add(stem.toLowerCase());
  titles.add(base.toLowerCase());
}

const payload = {
  generated_at: new Date().toISOString(),
  vault_root_basename: VAULT.split(sep).pop(),
  note_count: titles.size,
  scope: {
    included_dirs: PUBLIC_DIRS,
    included_top_level: [...PUBLIC_TOP_LEVEL],
    excluded_by_rule: ["Documents", "Websites", "People", "Templates"],
    note: "Titles only. No note content is read or stored. Documents/ and Websites/ are excluded by rule.",
  },
  notes: [...titles].sort(),
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(`✅ vault-notes snapshot written: ${titles.size} resolvable note title(s)`);
console.log(`   from: ${PUBLIC_DIRS.join(", ")} + ${PUBLIC_TOP_LEVEL.size} top-level note(s)`);
console.log(`   excluded by rule: Documents/, Websites/, People/, Templates/`);
console.log(`   → ${OUT}`);
