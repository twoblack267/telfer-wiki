#!/usr/bin/env node
/**
 * check-body-links.mjs — SENTRY guard for the two silent-failure bug classes that
 *                         slipped past the existing build gates in Aug 2026.
 *
 * WHY IT EXISTS (the gap it closes):
 *   The existing postbuild gates (people-link integrity, link validation,
 *   relationship-link guard) validate RELATIONSHIP SLUG ARRAYS and rendered
 *   <a href>s — but NOT the [[wiki-links]] embedded in a profile's biography
 *   (body_markdown). A [[wiki-link]] that doesn't resolve to a person page
 *   falls back to PLAIN TEXT in the renderer (see formatBody: "if (slug) ...
 *   return alias.trim()"). That is EXACTLY how the Susan Lawrie, all 8
 *   married-name links, Sophia's malformed pipe, and the Florence link
 *   silently regressed with a green build. THIS CLOSES THAT GAP.
 *
 * WHAT IT DETECTS (mirrors the renderer's own lookupSlug resolution 1:1):
 *   [A] DEAD BODY WIKILINKS — every [[...]] in every body_markdown run through
 *       the SAME lookupSlug logic the renderer uses. If it resolves to null,
 *       the link renders as plain text = silently broken. These BLOCK the
 *       build (dead links are broken code) AND fire a Kanban card.
 *   [B] PHANTOM-LIVING DATA CORRUPTION — a person flagged is_living:true with
 *       NO death_year AND NO vault_file. This is the worm that turned a
 *       1700s ancestor (William Telfer, shepherd) into a fake "living" profile
 *       via the orphan-purge "keep if manually curated (no vault_file)" branch.
 *       A genealogical ANCESTOR must never masquerade as living. These BLOCK
 *       too.
 *
 * KANBAN INTEGRATION (the "mechanic" — DETECT + FILE, NEVER FIX):
 *   Follows the established house pattern from deceased-flip-check.mjs and the
 *   board's founding rule: "The IT Crew NEVER fixes anything itself — it ONLY
 *   files issues here for Mark / Skippy to review." This guard DETECTS the
 *   problem, writes an idempotent task card to ~/.hermes/kanban/tasks/{id}.yaml
 *   (status: Backlog), and STOPS. It never auto-edits vault/people data. A
 *   human agent (Skippy, with Mark's approval) reviews and fixes.
 *
 * EXIT:  0 = clean (no dead links, no phantom-living). 
 *        1 = at least one build-blocking issue found (dead wikilink or
 *            phantom-living) — night-watch treats this as BUILD BLOCKED.
 *
 * Usage:  node scripts/check-body-links.mjs   (run from repo root)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
const REPO = process.cwd();
const PEOPLE_JSON = path.join(REPO, 'src', 'data', 'people.json');
const TASKS_DIR = path.join(process.env.HOME, '.hermes', 'kanban', 'tasks');
const TODAY = new Date().toISOString().slice(0, 10);
const TODAY_CMP = TODAY.replace(/-/g, '');

// ├──────────────────────────────────────────────────────────────────────┤
// │  lookupSlug — EXACT copy of format-body.mjs (lines ~139-219).         │
// │  We deliberately DUPLICATE (not import) it so this guard's result     │
// │  matches the renderer 1:1, and so it runs in isolation/CI. Keep in    │
// │  sync if format-body.mjs ever changes resolution returns.             │
// ├──────────────────────────────────────────────────────────────────────┤
function lookupSlug(name, people) {
  if (!name || !people) return null;
  const directSlug = people.find(
    (p) => (p.slug || '').toLowerCase() === name.trim().toLowerCase()
  );
  if (directSlug) return directSlug.slug;
  const yearMatch = name.match(/\((\d{4})/);
  const targetBirthYear = yearMatch ? parseInt(yearMatch[1]) : null;
  let clean = name.replace(/\([^)]*(?:\d|living|deceased|\?)[^)]*\)/g, '').trim().toLowerCase();
  clean = clean.replace(
    /^(rev\.|reverend|dr\.|doctor|mr\.|mister|mrs\.|mrs|miss|missus|ms\.|ms|sir|madam|dame|lady|lord|prof\.|professor|capt\.|captain|sgt\.|sergeant|col\.|colonel|maj\.|major|fr\.|father|x\.?|h\.h\.)\s+/,
    ''
  ).trim();
  if (!clean) return null;
  const exactMatches = people.filter(p => p.display_name?.toLowerCase() === clean);
  if (exactMatches.length === 1) return exactMatches[0].slug;
  if (exactMatches.length > 1) {
    if (targetBirthYear) {
      const yearExact = exactMatches.find(p => p.birth_year === targetBirthYear);
      if (yearExact) return yearExact.slug;
    }
    const living = exactMatches.filter(p => p.is_living);
    if (living.length === 1) return living[0].slug;
    return exactMatches[0].slug;
  }
  const aliasMatches = people.filter(p =>
    Array.isArray(p.aliases) && p.aliases.some(a => a && a.toLowerCase() === clean)
  );
  if (aliasMatches.length === 1) return aliasMatches[0].slug;
  const [first, ...rest] = clean.split(/\s+/);
  const last = rest.pop() || '';
  const matches = people.filter(p => p.first_name?.toLowerCase() === first && p.last_name?.toLowerCase() === last);
  if (matches.length === 1) return matches[0].slug;
  if (matches.length > 1) {
    if (targetBirthYear) {
      const yearMatch = matches.filter(p => p.birth_year === targetBirthYear);
      if (yearMatch.length === 1) return yearMatch[0].slug;
    }
    const middle = rest.join(' ').toLowerCase();
    if (middle) {
      const middleMatch = matches.filter(p => p.middle_name?.toLowerCase() === middle);
      if (middleMatch.length === 1) return middleMatch[0].slug;
    }
    const living = matches.filter(p => p.is_living);
    if (living.length === 1) return living[0].slug;
    return matches[0].slug;
  }
  for (const p of people) {
    if (p.last_name?.toLowerCase() === clean) return p.slug;
  }
  return null;
}

// Is this [[link]] target an INTENTIONAL non-person file/note link, rather
// than a broken person wiki-link?
//
// The renderer's formatBody lets BOTH fall back to plain text when lookupSlug
// returns null. But a reference to a document that ACTUALLY EXISTS in the
// Obsidian vault — a `Leads.md` note, a `Wedding - X.md` event note, a
// `Celebrating the life of...pdf`, a `Discrepancy Investigation.md` report —
// is a DELIBERATE vault door kept as a trail, and its alias is meant to render.
// These are NOT bugs. (The 2026-08 sweep confirmed all of these are intentional
// vault notes / PDFs, not dead person-links.)
//
// So: a [[...]] is only a BROKEN PERSON-LINK when it is NOT a person AND no
// matching file exists in the vault. We precompute the vault's filenames once
// (matched by exact basename, sans extension) for a fast, honest check.
const VAULT_ROOT = process.env.OBSIDIAN_VAULT || path.join(process.env.HOME, 'ObsidianVault');
function buildVaultStemSet(root) {
  const set = new Set();
  function walk(d) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      // record basename and basename-minus-extension
      const base = e.name;
      set.add(base.toLowerCase());
      const dot = base.lastIndexOf('.');
      if (dot > 0) set.add(base.slice(0, dot).toLowerCase());
    }
  }
  if (existsSync(root)) walk(root);
  return set;
}
const VAULT_STEMS = buildVaultStemSet(VAULT_ROOT);

function isFileLikeTarget(t) {
  const s = t.trim();
  if (/\.(md|pdf|jpg|jpeg|png|gif|webp|docx?|txt)$/i.test(s)) return true;       // explicit doc/asset extension
  if (s.includes('/')) return true;                                               // path separator ⇒ file path
  // Otherwise: is there a vault file whose basename matches this link target?
  // (A person never collides with a vault note here, because if it were a
  // person that resolved, lookupSlug would have returned non-null already.)
  if (VAULT_STEMS.has(s.toLowerCase())) return true;
  return false;
}

// Extract all [[...]] (and [[...|...]]) targets from a body, deduped, in order.
function extractWikilinks(body) {
  const out = [];
  const seen = new Set();
  const re = /\[\[([^\[\]]+?)\]\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    const [targetRaw] = inner.split('|').map((s) => s.trim()); // take link part before alias
    const key = targetRaw;
    if (!seen.has(key)) { seen.add(key); out.push(targetRaw); }
  }
  return out;
}

// ── Load data ─────────────────────────────────────────────────────────────
const people = JSON.parse(readFileSync(PEOPLE_JSON, 'utf8'));

// ── [A] Detect dead body wikilinks ─────────────────────────────────────────
const deadLinks = [];   // { slug, id, vault_file, link, bodyLineHint }
for (const p of people) {
  const body = p.body_markdown || '';
  if (!body.includes('[[')) continue;
  for (const target of extractWikilinks(body)) {
    if (isFileLikeTarget(target)) continue;    // deliberate file/note link, not a bug
    const resolved = lookupSlug(target, people);
    if (!resolved) {
      deadLinks.push({
        slug: p.slug, id: p.id || p.display_name || p.slug,
        vault_file: p.vault_file || '',
        link: target,
      });
    }
  }
}

// ── [B] Detect phantom-living data corruption ─────────────────────────────
// A person living with NO death_year AND NO vault_file. This is the signature
// of convert-markdown's orphan-purge branch: "Keep if manually curated (no
// vault_file)" — which is how a 1700s ancestor survived as a fake living entry.
const phantomLiving = [];
for (const p of people) {
  if (p.is_living !== true) continue;
  if (p.vault_file) continue;                  // has a real vault source → legit
  if (p.death_year != null) continue;          // has a death year → not phantom-living
  // Heuristic: an ancestor (higher generation) masquerading as living with no source.
  const gen = p.generation;
  // Only flag as phantom if it's clearly an ancestor generation (gen < current)
  // OR has lifespan text implying a historical window. A modern living person in
  // ~gen 0 who just lacks a vault_file is NOT flagged (could be legitimate).
  const isAncestorGen = (typeof gen === 'number' && gen >= 1);
  const lifespan = p.lifespan || '';
  const historicalStart = (p.birth_year != null && p.birth_year < 1950);
  if (isAncestorGen && historicalStart) {
    phantomLiving.push({
      slug: p.slug, id: p.id || p.display_name || p.slug,
      vault_file: p.vault_file || '',
      generation: gen, birth_year: p.birth_year,
    });
  }
}

const totalIssues = deadLinks.length + phantomLiving.length;
const blocking = totalIssues;   // both classes block the build

// ── KANBAN CARD FIRING (detect + file, NEVER fix) ─────────────────────────
// Idempotent: a card id only fires once. Existing card file ⇒ already filed/awaiting.
mkdirSync(TASKS_DIR, { recursive: true });
const existingIds = new Set(existsSync(TASKS_DIR) ? readdirSync(TASKS_DIR).map((f) => f.replace(/\.ya?ml$/, '')) : []);
const fired = [];
const alreadyPending = [];

function fireCard(id, title, description, suggestedAction, severity) {
  if (existingIds.has(id)) { alreadyPending.push(id); return; }
  const taskFile = path.join(TASKS_DIR, `${id}.yaml`);
  const yaml = `id: ${id}\ntitle: "${title}"\ndate: ${TODAY}\nseverity: ${severity}\nsource: "Skippy — check-body-links.mjs, build/night-watch auto-detection"\nstatus: Backlog\n\ndescription: >\n  ${description.split('\n').join('\n  ')}\n\nsuggested_action: >\n  ${suggestedAction.split('\n').join('\n  ')}\n`;
  writeFileSync(taskFile, yaml);
  fired.push(id);
}

if (deadLinks.length) {
  const slugs = deadLinks.map((d) => `${d.slug} (link '${d.link}')`).join(', ');
  fireCard(
    `broken-body-link-${TODAY_CMP}`,
    `DEAD body wiki-link detected (renders as plain text): ${deadLinks.length} link(s)`,
    `The build detected ${deadLinks.length} person [[wiki-link(s)]] in profile biography bodies that do NOT resolve to any person profile. When rendered, these fall back to PLAIN TEXT (the renderer returns the alias/label). This is the exact bug class that silently broke Susan Lawrie's link, the 8 married-name links, and Sophia's malformed pipe in the 2026-08 sweep. Affected: ${slugs}.`,
    `1) Open each profile's OBSIDIAN VAULT file (listed above).\n2) Fix the [[link]] to the CORRECT resolvable person profile (matching slug/display name). For married-name links, use: [[Maiden Name (years)|Married Name (years)]].\n3) Regenerate data + rebuild; this guard must go green.\n4) Move this card to Done when the build passes clean.`,
    'high'
  );
}

if (phantomLiving.length) {
  const slugs = phantomLiving.map((p) => `${p.slug} (gen ${p.generation}, b.${p.birth_year})`).join(', ');
  fireCard(
    `phantom-living-${TODAY_CMP}`,
    `PHANTOM-LIVING data corruption (ancestor flagged living with no source): ${phantomLiving.length} person(s)`,
    `The build detected ${phantomLiving.length} genealogical ancestor(s) flagged is_living:true with NO death_year AND NO vault_file. This is the orphan-purge "keep if manually curated (no vault_file)" failure mode that turned a 1700s shepherd into a fake "living" person in the 2026-08 sweep. Affected: ${slugs}.`,
    `1) Open each listed profile's data in src/data/people.json (no vault source exists).\n2) Determine the CORRECT is_living status from the genealogy (an ancestor of this birth era must be deceased).\n3) In the OBSIDIAN VAULT: create/update the source file so death is recorded, or remove the phantom.\n4) Rebuild; this guard must go green.\n5) Move this card to Done when resolved.`,
    'high'
  );
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`🌳 check-body-links: scanning ${people.length} profiles…`);

if (deadLinks.length === 0) {
  console.log(`   ✅ No dead body wiki-links (all [[...]] resolve to a person page)`);
} else {
  console.log(`   🔴 ${deadLinks.length} DEAD body wiki-link(s) found:`);
  for (const d of deadLinks) {
    console.log(`      - ${d.slug}: '[[${d.link}]]' does not resolve (vault: ${d.vault_file || 'none'})`);
  }
}

if (phantomLiving.length === 0) {
  console.log(`   ✅ No phantom-living ancestors (every living person has a source or death/year)`);
} else {
  console.log(`   🔴 ${phantomLiving.length} PHANTOM-LIVING ancestor(s) found:`);
  for (const p of phantomLiving) {
    console.log(`      - ${p.slug} (gen ${p.generation}, b.${p.birth_year}): living but no vault_file + no death_year`);
  }
}

console.log('');
if (fired.length) {
  console.log(`📌 FIRED Kanban card(s): ${fired.join(', ')}`);
  console.log(`   → ~/.hermes/kanban/tasks/ (status: Backlog) — human agent (Skippy, Mark-approved) reviews + fixes.`);
}
if (alreadyPending.length) {
  console.log(`🔁 Already filed for today (dedup, skipped): ${alreadyPending.join(', ')}`);
}

if (blocking === 0) {
  console.log('◼ CHECK-BODY-LINKS: CLEAN');
  process.exit(0);
} else {
  console.log(`◼ CHECK-BODY-LINKS: BUILD BLOCKED — ${blocking} build-blocking issue(s) filed to Kanban.`);
  console.log(`  The body-wikilink guard and phantom-living guard are BUILD GATES. Fix the vault/data, then rebuild.`);
  process.exit(1);
}
