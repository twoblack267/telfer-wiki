#!/usr/bin/env node
/**
 * gen-verified.mjs — build a committed slug -> verified-by signature map.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every page credits "Skippy the Magnificent & The Librarian" and carries a
 * revision date that comes from file mtime / git. Neither says a HUMAN checked
 * the page. Google's 2026 guidance on scaled/AI-produced content is aimed at
 * exactly that shape: prose with no accountable person behind it and no date a
 * person stands behind. The fix is a signature, and it must be on the PAGE
 * where a crawler reads it — not only in the vault.
 *
 * AUTHORITY IS THE VAULT. A person page is signed when its own markdown
 * frontmatter carries BOTH:
 *
 *     verified_by: Mark Telfer
 *     verified_on: 2026-11-05
 *
 * and is unsigned otherwise. No default, no inheritance, no backfill, no nightly
 * stamp. A date that moves without a human moving it is a lie, and Illyes (Jul
 * 2026) is explicit that sites with inaccurate dates are "probably better off
 * without" them — one lie discounts every date on the site.
 *
 * SLUG RESOLUTION
 * ---------------
 * The vault file is named for the person; the SITE URL is a slug
 * (william-telfer-1802-1850). Those do not match by string, so this script
 * reuses gen-lastmod.mjs's matcher by importing the same name-key logic —
 * duplicated here deliberately as a copy of `personName`/`personKeys` semantics
 * is NOT enough. Instead we ask gen-lastmod for the slug<->file pairing by
 * running its matcher indirectly: we derive the mapping from a committed
 * artefact, vault-manifest.json, plus the people.public.json titles.
 *
 * Simplest correct rule, and the one used here: iterate the PEOPLE the site
 * renders (they carry both `slug` and `title`), resolve each to a vault file
 * with the same normalised-name key gen-lastmod uses, then read that file's
 * frontmatter. Refuse rather than guess on ambiguity — an unsigned page is
 * honest, a wrongly signed page is a lie with a human's name on it.
 *
 * RUN:  node scripts/gen-verified.mjs     (after any vault change, before commit)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const VAULT_DIR = "/Users/marktelfer/ObsidianVault";
const VAULT_PEOPLE_DIR = "Family History/People";
const OUT = resolve(ROOT, "src/data/verified.json");
const PEOPLE = resolve(ROOT, "src/data/people.public.json");
const MANIFEST = resolve(ROOT, "src/data/vault-manifest.json");

/** Verbatim from gen-lastmod.mjs — keep the two in step. */
function personName(s) {
  return s
    .split("—")[0]
    .split(" - ")[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function personKeys(s) {
  const bare = personName(s.replace(/['"‘’“”][^'"‘’“”]*['"‘’“”]/g, " "));
  const keys = [];
  const noBracket = bare.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (noBracket && noBracket !== bare) keys.push(noBracket);
  const noNee = bare.replace(/,\s*n(?:é|e)e\s+.*$/, "").trim();
  if (noNee) keys.push(noNee);
  if (noNee.includes("/")) {
    const parts = noNee.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const head = parts[0].split(/\s+/);
      head.pop();
      for (const alt of parts) {
        const tail = alt.split(/\s+/).pop();
        const rebuilt = [...head, tail].join(" ").trim();
        if (rebuilt) keys.push(rebuilt);
      }
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

function frontmatter(text) {
  // Tolerate \r\n, and require the closing fence so we never read body prose.
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[kv[1]] = v;
  }
  return out;
}

function main() {
  const vaultPeople = join(VAULT_DIR, VAULT_PEOPLE_DIR);
  if (!existsSync(vaultPeople)) {
    console.log("⚠️  vault not found — leaving verified.json untouched.");
    console.log("    CI has no vault; the committed map is what CI builds from.");
    return;
  }
  if (!existsSync(PEOPLE)) {
    console.error("FATAL: cannot read people.public.json");
    process.exit(1);
  }

  // byName: normalised vault name -> [files]. Ambiguity is REFUSED downstream.
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf-8"));
  const byName = new Map();
  for (const f of Object.keys(manifest.files || {})) {
    const key = personName(f.replace(/\.md$/i, ""));
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(f);
  }

  const people = JSON.parse(readFileSync(PEOPLE, "utf-8"));
  const map = {};
  let signed = 0;
  let unsigned = 0;
  let ambiguous = 0;

  for (const p of people) {
    if (!p.slug) continue;
    const human = (p.title || p.name || "").trim();
    if (!human) continue;

    let file = null;
    for (const k of personKeys(human)) {
      const cands = byName.get(k);
      if (!cands) continue;
      if (cands.length === 1) { file = cands[0]; break; }
      // Several vault files share this name — only the birth year can split
      // them, and if it cannot, this page is left UNSIGNED on purpose.
      const y = String(p.birth_year || "").trim();
      if (/^\d{3,4}$/.test(y)) {
        const byYear = cands.filter((c) => c.includes(`(${y}`));
        if (byYear.length === 1) { file = byYear[0]; break; }
      }
      ambiguous++;
      break;
    }
    if (!file) { unsigned++; continue; }

    // The manifest lists filenames; the vault dir is the source of truth.
    let text;
    try {
      text = readFileSync(join(vaultPeople, file), "utf-8");
    } catch {
      unsigned++;
      continue;
    }
    const fm = frontmatter(text);
    const by = (fm.verified_by || "").trim();
    const on = (fm.verified_on || "").trim();

    // BOTH required. Signer with no date is not a signature; a date with no
    // signer is exactly the anonymous stamp this exists to prevent.
    if (!by || !on) { unsigned++; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) {
      console.warn(`⚠️  ${file}: verified_on "${on}" is not YYYY-MM-DD — left unsigned`);
      unsigned++;
      continue;
    }

    map[p.slug] = { by, on };
    signed++;
  }

  const payload = {
    _comment:
      "slug -> { by, on }. Mirrors `verified_by` + `verified_on` frontmatter from " +
      "the Obsidian vault, keyed by the SAME slug the page is served at. Written " +
      "by scripts/gen-verified.mjs; never hand-edited, never backfilled, never " +
      "stamped nightly. A person absent from this map is UNSIGNED and their page " +
      "renders no signature block at all.",
    generated: new Date().toISOString().slice(0, 10),
    counts: { signed, unsigned, ambiguous },
    people: map,
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`✅ verified.json: ${signed} signed, ${unsigned} unsigned, ${ambiguous} ambiguous-name (left unsigned)`);
  if (!signed) console.log("   (zero signatures — the honest state until Mark signs pages)");
}

main();
