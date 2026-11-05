#!/usr/bin/env node
/**
 * gen-signoff.mjs — build src/data/signoff.json from the VAULT.
 *
 * WHY THE VAULT IS THE SOURCE OF TRUTH
 * A signature is a claim that a human read this page and vouched for it. If
 * that claim lived in a file only the website could see, it would be
 * un-auditable and any script — including me — could fabricate it. So the
 * ledger is derived from front matter in ~/ObsidianVault, a git repo with
 * dated history. Every sign-off is attributable and reversible.
 *
 * WHY THE SLUG COMES FROM people.public.json, NOT THE FILENAME
 * The site does not slugify the vault filename. It slugifies
 * first_name + last_name + birth_year from front matter (extract-data.mjs:84).
 * A generator that slugified `William Telfer (1802–1850).md` would produce
 * william-telfer-1802-1850-... and quietly sign a page that does not exist —
 * the signature would vanish and nobody would know why. So the person is
 * identified by their PUBLISHED identity, and the vault file is matched to it
 * by name + birth year first, filename second.
 *
 * FRONT MATTER CONTRACT — both lines required, neither alone suffices:
 *     reviewed_by: Mark Telfer
 *     reviewed_on: 2026-11-05
 *
 * reviewed_on must parse and must not be in the future. A future date is a
 * typo or a bid to look fresher than reality; either way it is not evidence,
 * so the page is skipped rather than signed.
 *
 * OUTPUT: {} when nothing is signed. An empty ledger means "no claims", which
 * is the honest state before any human review — never an error.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const VAULT = process.env.VAULT_DIR || path.join(os.homedir(), "ObsidianVault", "Family History", "People");
const PEOPLE = path.join(process.cwd(), "src", "data", "people.public.json");
const OUT = path.join(process.cwd(), "src", "data", "signoff.json");

function frontMatter(text) {
  // Front matter only — a `reviewed_by:` in the body prose is a mention, not a
  // claim. Anchoring to the opening fence is what separates the two.
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim().replace(/^["']|["']$/g, "");
    if (v) out[kv[1]] = v;
  }
  return out;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

// Build an index of published people keyed by normalised name + birth year.
const peopleRaw = JSON.parse(fs.readFileSync(PEOPLE, "utf-8"));
const people = Array.isArray(peopleRaw) ? peopleRaw : peopleRaw.people || [];
const byNameYear = new Map();
const byName = new Map();
for (const p of people) {
  if (!p.slug) continue;
  const key = `${norm(p.first_name)}|${norm(p.last_name)}`;
  if (p.birth_year) byNameYear.set(`${key}|${p.birth_year}`, p.slug);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(p);
}

const today = new Date();
today.setHours(23, 59, 59, 999); // a sign-off dated today is valid, not future

const signoff = {};
const skipped = [];
let sawAny = 0;

if (fs.existsSync(VAULT)) {
  for (const f of fs.readdirSync(VAULT)) {
    if (!f.endsWith(".md")) continue;
    const fm = frontMatter(fs.readFileSync(path.join(VAULT, f), "utf-8"));
    if (!fm.reviewed_by && !fm.reviewed_on) continue;
    sawAny++;

    // ── resolve to a published person ──
    let slug = null;
    if (fm.first_name && fm.last_name) {
      const key = `${norm(fm.first_name)}|${norm(fm.last_name)}`;
      if (fm.birth_year) slug = byNameYear.get(`${key}|${fm.birth_year}`) || null;
      if (!slug) {
        const cands = byName.get(key) || [];
        if (cands.length === 1) slug = cands[0].slug;
        else if (cands.length > 1) {
          skipped.push(
            `${f}: ambiguous — ${cands.length} published people named ` +
              `${fm.first_name} ${fm.last_name} (${cands.map((c) => c.slug).join(", ")}); ` +
              `add birth_year to disambiguate`
          );
          continue;
        }
      }
    }
    if (!slug) {
      skipped.push(`${f}: no matching published person — signature would go nowhere`);
      continue;
    }

    // ── validate the claim itself ──
    if (!fm.reviewed_by || !fm.reviewed_on) {
      skipped.push(`${f}: half a signature (need both reviewed_by AND reviewed_on)`);
      continue;
    }
    const d = new Date(fm.reviewed_on);
    if (Number.isNaN(d.getTime())) {
      skipped.push(`${f}: reviewed_on "${fm.reviewed_on}" is not a date`);
      continue;
    }
    if (d > today) {
      skipped.push(`${f}: reviewed_on ${fm.reviewed_on} is in the FUTURE`);
      continue;
    }

    signoff[slug] = {
      reviewed_by: fm.reviewed_by,
      reviewed_on: fm.reviewed_on,
      ...(fm.reviewed_note ? { note: fm.reviewed_note } : {}),
    };
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(signoff, null, 2) + "\n");

const n = Object.keys(signoff).length;
console.log(`✍️  sign-off ledger: ${n} signed page(s) of ${people.length} published`);
if (sawAny === 0) {
  console.log("   (no vault file carries reviewed_by/reviewed_on yet — nothing claimed)");
}
if (skipped.length) {
  console.log(`   ⚠️  ${skipped.length} signature(s) NOT honoured:`);
  for (const s of skipped.slice(0, 10)) console.log(`      • ${s}`);
}
