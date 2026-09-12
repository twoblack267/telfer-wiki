#!/usr/bin/env node
/**
 * Capture the vault's Family-table rows into a committed snapshot so CI can audit them.
 *
 * WHY THIS EXISTS (2026-09-12): the dead-link guard needs the vault's Family rows, but CI is
 * a fresh runner with no Obsidian vault and no vault repo to check out. Failing the build for
 * absence of the vault would block every deploy; passing blind would make the guard a lie.
 * So the rows are committed as data and CI audits them FOR REAL.
 *
 * Run this on the machine that owns the vault, whenever vault Family rows change:
 *   node scripts/make-family-rows-snapshot.mjs
 * Then commit scripts/family-rows.snapshot.json.
 *
 * It imports ROW_LABELS from family-row-labels.mjs so the snapshot and the guard can never
 * disagree about which rows count (they did, once: 40 phantom offenders).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ROW_LABELS } from "./family-row-labels.mjs";

const ROOT = join(import.meta.dirname, "..");
const CANDIDATES = [
  process.env.TELFER_VAULT_PEOPLE,
  join(ROOT, "vault-checkout", "People"),
  join(homedir(), "ObsidianVault", "Family History", "People"),
  join(ROOT, "..", "ObsidianVault", "Family History", "People"),
].filter(Boolean);

const VAULT = CANDIDATES.find((c) => { try { return existsSync(c) && readdirSync(c).some((f) => f.endsWith(".md")); } catch { return false; } });
if (!VAULT) {
  console.error("❌ Cannot find the vault People dir. Set TELFER_VAULT_PEOPLE to it. Snapshot NOT written.");
  process.exit(1);
}

const files = readdirSync(VAULT).filter((f) => f.endsWith(".md"));
const out = {};
for (const f of files) {
  const rows = [];
  for (const raw of readFileSync(join(VAULT, f), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const label = cells[1].replace(/^\*+\s*|\s*\*+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!ROW_LABELS.has(label)) continue;
    rows.push({ row: label, value: cells[2] });
  }
  if (rows.length) out[f] = rows;
}

const dest = join(ROOT, "scripts", "family-rows.snapshot.json");
writeFileSync(dest, JSON.stringify({
  note: "Family-table rows from the Obsidian vault, committed so CI can audit them for dead links. Regenerate: node scripts/make-family-rows-snapshot.mjs",
  generated: new Date().toISOString(),
  source: VAULT,
  files: out,
}, null, 0));
const n = Object.values(out).reduce((a, v) => a + v.length, 0);
console.log(`SNAPSHOT: ${Object.keys(out).length} files · ${n} rows -> ${dest}`);
