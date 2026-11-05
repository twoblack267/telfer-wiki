#!/usr/bin/env node
/**
 * sign-page.mjs — the signing door.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 * Mark rejected being named as "author": he did not write 652 biographies,
 * and a personal byline on pages he did not author is both untrue and
 * self-congratulatory. But the pages still need to say a human checked them,
 * or they read as unattended machine output — the exact thing search engines
 * and AI answer engines are built to discount.
 *
 * So the claim made is narrow and true: THE ARCHIVE publishes (creator), and
 * a NAMED HUMAN REVIEWED this page (reviewedBy), only for pages he actually
 * signed. A signature is a specific act on a specific page — never a global
 * badge, never a rubber stamp applied in bulk.
 *
 * ── WHAT "SIGNING" MEANS ──────────────────────────────────────────────────
 * This writes `reviewed_by` and `reviewed_on` into the person's vault note
 * front matter. That is the ledger. Everything downstream is derived:
 *
 *     vault front matter  ->  scripts/gen-signoff.mjs  ->  src/data/signoff.json
 *                         ->  JSON-LD reviewedBy on the page
 *                         ->  visible "Reviewed" line in the footer
 *
 * Nothing is stored only on the website, so nothing can be fabricated
 * invisibly. The vault is a git repo; every signature has a dated commit.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *   node scripts/sign-page.mjs william-telfer-1802              # sign today
 *   node scripts/sign-page.mjs william-telfer-1802 --date 2026-11-05
 *   node scripts/sign-page.mjs --list                            # what is signed
 *   node scripts/sign-page.mjs william-telfer-1802 --unsign      # retract
 *
 * Deliberately NO bulk mode. There is no `--all`, and that is on purpose:
 * reviewing 652 pages is not one decision, and a tool that signs them in one
 * command would turn the only real trust signal on the site into a lie.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const VAULT = process.env.VAULT_DIR || path.join(os.homedir(), "ObsidianVault", "Family History", "People");
const PEOPLE = path.join(process.cwd(), "src", "data", "people.public.json");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));
const dateArg = (() => {
  const i = args.indexOf("--date");
  return i >= 0 ? args[i + 1] : null;
})();

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

const peopleRaw = JSON.parse(fs.readFileSync(PEOPLE, "utf-8"));
const people = Array.isArray(peopleRaw) ? peopleRaw : peopleRaw.people || [];

function vaultFiles() {
  if (!fs.existsSync(VAULT)) return [];
  return fs.readdirSync(VAULT).filter((f) => f.endsWith(".md"));
}

function readFm(file) {
  const text = fs.readFileSync(path.join(VAULT, file), "utf-8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return { text, fm: m ? m[1] : null, m };
}

function parseFm(block) {
  const out = {};
  for (const line of (block || "").split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// ── find the vault note for a slug, via the SAME identity the site uses ──
function findNote(slug) {
  const person = people.find((p) => p.slug === slug);
  if (!person) return { error: `no published person with slug "${slug}"` };
  const key = `${norm(person.first_name)}|${norm(person.last_name)}`;
  const hits = [];
  for (const f of vaultFiles()) {
    const { fm } = readFm(f);
    const p = parseFm(fm);
    if (!p.first_name || !p.last_name) continue;
    if (`${norm(p.first_name)}|${norm(p.last_name)}` !== key) continue;
    if (person.birth_year && String(p.birth_year) !== String(person.birth_year)) continue;
    hits.push(f);
  }
  if (hits.length === 1) return { file: hits[0], person };
  if (hits.length === 0) return { error: `no vault note matches ${person.first_name} ${person.last_name} (b.${person.birth_year || "?"})` };
  return { error: `ambiguous: ${hits.length} vault notes match — ${hits.join(", ")}` };
}

function setFmField(block, key, value) {
  const lines = (block || "").split(/\r?\n/);
  const re = new RegExp(`^${key}:`);
  const idx = lines.findIndex((l) => re.test(l));
  if (value === null) {
    if (idx >= 0) lines.splice(idx, 1);
    return lines.join("\n");
  }
  if (idx >= 0) lines[idx] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return lines.join("\n");
}

// ── --list ──
if (flags.has("--list")) {
  let n = 0;
  for (const f of vaultFiles()) {
    const p = parseFm(readFm(f).fm);
    if (p.reviewed_by && p.reviewed_on) {
      n++;
      console.log(`  ${f}\n      reviewed by ${p.reviewed_by} on ${p.reviewed_on}`);
    }
  }
  console.log(n ? `\n${n} signed note(s)` : "\nNo notes signed yet.");
  process.exit(0);
}

const slug = positional[0];
if (!slug) {
  console.error("usage: node scripts/sign-page.mjs <slug> [--date YYYY-MM-DD] [--unsign] | --list");
  process.exit(2);
}

const found = findNote(slug);
if (found.error) {
  console.error(`❌ ${found.error}`);
  process.exit(1);
}

const { text, fm, m } = readFm(found.file);
if (!m) {
  console.error(`❌ ${found.file} has no front matter — refusing to create some.`);
  process.exit(1);
}

const unsign = flags.has("--unsign");

// ── validate the date before touching anything ──
let when = null;
if (!unsign) {
  when = dateArg || new Date().toISOString().slice(0, 10);
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) {
    console.error(`❌ --date "${when}" is not a date`);
    process.exit(1);
  }
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (d > endOfToday) {
    console.error(`❌ ${when} is in the future. You cannot have reviewed something you have not read yet.`);
    process.exit(1);
  }
}

let block = fm;
block = setFmField(block, "reviewed_by", unsign ? null : "Mark Telfer");
block = setFmField(block, "reviewed_on", unsign ? null : when);

const updated = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${block}\n---`);
fs.writeFileSync(path.join(VAULT, found.file), updated);

console.log(
  unsign
    ? `🔓 Retracted signature on ${found.person.first_name} ${found.person.last_name} (${slug})`
    : `✍️  Signed ${found.person.first_name} ${found.person.last_name} (${slug}) — reviewed by Mark Telfer on ${when}`
);
console.log(`   vault: ${found.file}`);
console.log("   next: npm run build  (regenerates signoff.json and the page schema)");
