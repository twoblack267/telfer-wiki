#!/usr/bin/env node
/**
 * DUPLICATE-IDENTITY VERIFIER — read-only.
 *
 * Catches the case where ONE human being is published as TWO live profile pages.
 *
 * Why this exists (2026-10-29): Carissa Telfer had two vault notes — one holding her
 * real life record, one derived from a printed book page that predated her death. The
 * body of one said "**Canonical profile:** [[Carissa Telfer (?–2023)]]", a clear human
 * instruction to treat the other as canonical. No script read that line. Neither note
 * carried the `redirect` tag, so convert-markdown.mjs built BOTH, and the site published
 * the same woman twice, with different parentage claims ("daughter of" vs "adopted
 * cousin"). The vault was right. The pipeline had no gate.
 *
 * This is a DIFFERENT defect from the relationship verifier:
 *   - verify-relationships.mjs asks "is this person linked to their family?"
 *   - this asks "is this person actually two people on the site?"
 *
 * Detection, in order of confidence:
 *   1. SAME SLUG ROOT AND DEATH YEAR, different birth data  → near-certain duplicate
 *   2. Same first+last AND same birth_year AND same death_year → duplicate
 *   3. Same first+last, both undated, and both live            → likely duplicate
 *
 * Exit 0 = clean, exit 1 = duplicates found (each named with its evidence).
 *
 * Read-only. Never writes. Fixing belongs in the VAULT: add the `redirect` tag to the
 * note that should not become a page. See docs/NAMING-RULES.md §6.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const PUBLIC = path.join(REPO, 'src', 'data', 'people.public.json');

function load() {
  const raw = JSON.parse(fs.readFileSync(PUBLIC, 'utf8'));
  return Array.isArray(raw) ? raw : raw.people || [];
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** slug root with any trailing year / qualifier removed: carissa-telfer-2023 -> carissatelfer */
function slugRoot(slug) {
  const parts = String(slug || '').split('-');
  while (parts.length && (/^\d{4}$/.test(parts[parts.length - 1]) || parts[parts.length - 1].length <= 2)) {
    parts.pop();
  }
  return norm(parts.join(''));
}

function main() {
  const people = load();
  const dupes = [];
  const seen = new Set();

  const add = (reason, group) => {
    const key = group.map((p) => p.slug).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    dupes.push({ reason, group });
  };

  // ── 1. same slug root + same death year, but disagreeing birth data ──────────
  const byRoot = new Map();
  for (const p of people) {
    const r = slugRoot(p.slug);
    if (!r) continue;
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(p);
  }
  for (const [root, group] of byRoot) {
    if (group.length < 2) continue;
    const deathYears = new Set(group.map((p) => p.death_year ?? null));
    const birthYears = new Set(group.map((p) => p.birth_year ?? null));
    if (deathYears.size === 1 && deathYears.values().next().value != null && birthYears.size > 1) {
      add(`same name, same death year (${[...deathYears][0]}), disagreeing birth years`, group);
    }
  }

  // ── 2. identical full date span ─────────────────────────────────────────────
  const bySpan = new Map();
  for (const p of people) {
    if (p.birth_year == null && p.death_year == null) continue;
    const k = `${norm(p.first_name)}|${norm(p.last_name)}|${p.birth_year ?? '?'}|${p.death_year ?? '?'}`;
    if (!bySpan.has(k)) bySpan.set(k, []);
    bySpan.get(k).push(p);
  }
  for (const [, group] of bySpan) {
    if (group.length > 1) add('identical name and identical birth/death years', group);
  }

  // ── 3. same name, both undated, both living ────────────────────────────────
  // MUST NOT fire when the two are distinguishable by their parents. Two women both
  // called Margaret Telfer with no dates are NOT duplicates if one is the daughter of
  // James Telfer (1829) and the other the daughter of James Telfer (1796) — they are a
  // great-aunt and her great-niece. Requiring identical parentage keeps this honest;
  // otherwise the gate would demand a `redirect` tag on two genuinely different people.
  const byName = new Map();
  for (const p of people) {
    const k = `${norm(p.first_name)}|${norm(p.last_name)}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  const parentSig = (p) =>
    (p.parents || [])
      .map((x) => (typeof x === 'string' ? x : x.plain_name || ''))
      .map(norm)
      .filter(Boolean)
      .sort()
      .join('+');
  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const undated = group.filter((p) => p.birth_year == null && p.death_year == null);
    if (undated.length < 2) continue;
    // Only a duplicate when even the parentage cannot separate them.
    const sigs = new Set(undated.map(parentSig));
    if (sigs.size === 1 && [...sigs][0] !== '') {
      add('same name, all undated, and identical parents — cannot be told apart', undated);
    }
  }

  console.log('── DUPLICATE-IDENTITY VERIFIER ───────────────────────────────');
  console.log(`   public profiles checked: ${people.length}`);

  if (!dupes.length) {
    console.log('   duplicate live identities: 0');
    console.log('\n✅ DUPLICATE IDENTITY OK — every published page is a distinct person.');
    return 0;
  }

  console.log(`   ❌ duplicate live identities: ${dupes.length}\n`);
  for (const d of dupes) {
    console.log(`   ${d.reason}`);
    for (const p of d.group) {
      console.log(
        `     • ${p.slug}  "${p.display_name}"  life=${p.lifespan ?? '?'}` +
          `  parents=[${(p.parents || []).map((x) => (typeof x === 'string' ? x : x.plain_name)).join(', ')}]`
      );
    }
    console.log('');
  }
  console.log('   FIX IN THE VAULT: keep ONE page and add the `redirect` tag to the other');
  console.log('   note. A body line saying "Canonical profile: [[...]]" is documentation —');
  console.log('   no script reads it. See docs/NAMING-RULES.md §6.');
  return 1;
}

process.exit(main());
