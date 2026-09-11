#!/usr/bin/env node
/**
 * validate-vault-site-parity.mjs
 *
 * THE MISSING GATE. Nothing in this repo previously compared the people the
 * VAULT says exist against the people the SITE actually published. That blind
 * spot let 3 redirect stubs ship as duplicate live pages (Elizabeth Hannah,
 * Elizabeth Telfer Farrow, Sophia Parker) — see board card tw-2026-09-12-009.
 *
 * This validator does a two-way set difference:
 *   vaultRecs  = vault People/*.md that are REAL person records
 *   pubPages   = published rows in people.json
 *
 *   MISSING  = in vault, NOT published  → a real person is invisible on the site
 *   PHANTOM  = in published, NOT a real vault record → duplicate/stub leaked
 *   DUPLICATE= one vault record producing more than one published row
 *
 * Exit codes: 0 = parity clean, 1 = violations, 2 = usage error.
 *
 * Usage:
 *   node scripts/validate-vault-site-parity.mjs          # DRY: report only
 *   node scripts/validate-vault-site-parity.mjs --strict # exit 1 on violations
 *
 * Tag-first redirect detection is shared in spirit with convert-markdown.mjs:
 * tags are authoritative, titles are prose.
 */

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const VAULT_PEOPLE_DIR = path.resolve(process.env.HOME, 'ObsidianVault/Family History/People');
const PEOPLE_JSON = path.resolve(process.cwd(), 'src/data/people.json');

const STRICT = process.argv.includes('--strict');
const REDIRECT_TAG_PATTERN = /^\s*-\s*['"]?redirect['"]?\s*$/im;
const REDIRECT_TITLE_PATTERN = /\bredirect\b/i;

function isRedirectStub(fm) {
  if (!fm) return false;
  if (REDIRECT_TITLE_PATTERN.test((fm.title || '').toString())) return true;
  const tags = fm.tags;
  if (Array.isArray(tags)) return tags.some((t) => String(t).trim().toLowerCase() === 'redirect');
  if (typeof tags === 'string') {
    return tags.split(/[,\s]+/).some((t) => t.trim().toLowerCase() === 'redirect');
  }
  return false;
}

function rawHasRedirectTag(raw) {
  const end = raw.indexOf('\n---', 3);
  const head = raw.startsWith('---') ? raw.slice(3, end === -1 ? 800 : end) : raw.slice(0, 800);
  return REDIRECT_TAG_PATTERN.test(head);
}

/** Every vault file that is a genuine person record (not stub, not empty, no malformed fm). */
function vaultRecords() {
  const real = [];
  const stubs = [];
  const empty = [];
  const malformed = [];
  for (const f of fs.readdirSync(VAULT_PEOPLE_DIR).filter((x) => x.endsWith('.md'))) {
    const abs = path.join(VAULT_PEOPLE_DIR, f);
    let raw = '';
    try { raw = fs.readFileSync(abs, 'utf-8'); } catch { malformed.push(f); continue; }
    if (!raw.trim()) { empty.push(f); continue; }
    let fm = null;
    try { fm = matter(raw).data || null; } catch { malformed.push(f); continue; }
    if (isRedirectStub(fm) || rawHasRedirectTag(raw)) { stubs.push(f); continue; }
    const fn = (fm.first_name || '').toString().trim();
    const ln = (fm.last_name || '').toString().trim();
    if (!fn || !ln) { malformed.push(f); continue; }
    real.push({ file: f, name: `${fn} ${ln}`.trim(), slug: fm.slug || null });
  }
  return { real, stubs, empty, malformed };
}

function publishedRows() {
  try {
    const rows = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.error(`❌ Cannot read ${PEOPLE_JSON}: ${e.message}`);
    process.exit(2);
  }
}

function main() {
  // CI (GitHub Actions) has no vault — it builds from the committed people.json and the
  // committed vault manifest. The vault is private and stays local, on purpose. So when the
  // vault is absent we fall back to the manifest: it carries the authoritative filename list
  // and per-file hashes, which is enough to catch phantoms, orphans and duplicates.
  const vaultPresent = fs.existsSync(VAULT_PEOPLE_DIR);
  const MANIFEST = path.resolve(process.cwd(), 'src/data/vault-manifest.json');
  let real = [], stubs = [], empty = [], malformed = [];

  if (vaultPresent) {
    ({ real, stubs, empty, malformed } = vaultRecords());
  } else if (fs.existsSync(MANIFEST)) {
    const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
    const rawFiles = man.files || man;
    const entries = Array.isArray(rawFiles)
      ? rawFiles.map((e) => (typeof e === 'string' ? { file: e } : e))
      : Object.entries(rawFiles).map(([file, v]) => ({
          file,
          hash: typeof v === 'string' ? v : (v && v.sha256) || '',
          kind: typeof v === 'object' && v ? (v.kind || '') : '',
        }));
    for (const e of entries) {
      const f = (e.file || e.path || e.name || '').toString();
      if (!f) continue;
      // The manifest records a `kind` per file (real | redirect | empty), computed where the
      // vault actually lives. Fall back to filename convention for older manifests.
      const kind = (e.kind || '').toString().toLowerCase();
      if (kind === 'redirect' || (!kind && REDIRECT_TITLE_PATTERN.test(f))) { stubs.push(f); continue; }
      if (kind === 'empty') { empty.push(f); continue; }
      real.push({ file: f, name: '', slug: null });
    }
    console.log(`  (vault absent → using committed manifest: ${entries.length} entries)`);
  } else {
    console.error(`❌ Vault absent and no manifest at ${MANIFEST} — cannot verify parity.`);
    process.exit(2);
  }
  const pub = publishedRows();

  // Published rows sourced from a redirect stub = a leaked phantom.
  const phantomStub = [];
  for (const p of pub) {
    const vf = (p.vault_file || '').toString();
    if (vf && stubs.includes(vf)) phantomStub.push({ row: p.display_name || p.slug, from: vf });
  }

  // Two-way set difference on vault_file ↔ file.
  const pubFiles = new Set(pub.map((p) => (p.vault_file || '').toString()).filter(Boolean));
  const realFiles = new Set(real.map((r) => r.file));
  const missing = real.filter((r) => !pubFiles.has(r.file));
  const orphan = pub.filter((p) => {
    const vf = (p.vault_file || '').toString();
    return vf && !realFiles.has(vf) && !stubs.includes(vf);
  });

  // One vault file → more than one published row = duplicate page.
  const byFile = new Map();
  for (const p of pub) {
    const vf = (p.vault_file || '').toString();
    if (!vf) continue;
    if (!byFile.has(vf)) byFile.set(vf, []);
    byFile.get(vf).push(p.display_name || p.slug);
  }
  const dupes = [...byFile.entries()].filter(([, v]) => v.length > 1);

  // Duplicate slugs would collide as URLs.
  const slugCount = new Map();
  for (const p of pub) {
    const s = (p.slug || '').toString();
    if (!s) continue;
    slugCount.set(s, (slugCount.get(s) || 0) + 1);
  }
  const dupSlugs = [...slugCount.entries()].filter(([, n]) => n > 1);

  const violations =
    missing.length + phantomStub.length + orphan.length + dupes.length + dupSlugs.length;

  console.log('── VAULT ↔ SITE PARITY ─────────────────────────────');
  console.log(`  vault real records : ${real.length}`);
  console.log(`  vault redirect stubs: ${stubs.length}`);
  console.log(`  vault empty files  : ${empty.length}`);
  console.log(`  vault unparseable  : ${malformed.length}`);
  console.log(`  published rows     : ${pub.length}`);
  console.log('');

  const dump = (label, arr, fmt) => {
    if (!arr.length) return;
    console.log(`❌ ${label}: ${arr.length}`);
    arr.slice(0, 25).forEach((x) => console.log(`     • ${fmt(x)}`));
    if (arr.length > 25) console.log(`     … and ${arr.length - 25} more`);
    console.log('');
  };

  dump('MISSING (real vault record with no published page)', missing,
    (r) => `${r.name}  [${r.file}]`);
  dump('PHANTOM (published from a redirect stub = duplicate page)', phantomStub,
    (x) => `${x.row}  ← stub ${x.from}`);
  dump('ORPHAN (published row whose vault record is gone)', orphan,
    (p) => `${p.display_name || p.slug}  [${p.vault_file}]`);
  dump('DUPLICATE (one vault record, multiple published rows)', dupes,
    ([f, v]) => `${f} → ${v.length} rows: ${v.join(' | ')}`);
  dump('DUPLICATE SLUG (URL collision)', dupSlugs,
    ([s, n]) => `${s} ×${n}`);

  if (!violations) {
    console.log('✅ PARITY CLEAN — every real vault record is published, no phantoms, no duplicates.');
    process.exit(0);
  }

  console.log(`⚠️  ${violations} parity violation(s).`);
  if (STRICT) {
    console.log('   --strict: failing the build.');
    process.exit(1);
  }
  console.log('   DRY mode: report only (pass --strict to fail the build).');
  process.exit(0);
}

main();
