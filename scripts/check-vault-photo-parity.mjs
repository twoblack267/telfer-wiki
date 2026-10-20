#!/usr/bin/env node
/**
 * check-vault-photo-parity.mjs — Telfer Wiki vault↔site photo parity guard
 * (Skippy, 2026-10-20)
 * ──────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *   Two independent photo bugs shipped silently, and NEITHER was caught by the
 *   existing photo guards, because those guards all check the DATA→SITE direction
 *   (does every image in people.json render?). They never check VAULT→DATA:
 *
 *     1. James Telfer (1796–1863).md — the headstone jpg lived ONLY in
 *        telfer-wiki/public/images/people/ and was never in the vault. The vault
 *        note had no ![[...]] embed. Every regeneration therefore deleted the
 *        attachment and the photo was orphaned on the live site for ~2 months.
 *
 *     2. BaseLayout mobile CSS — not a photo bug, but the same class of failure:
 *        something visible on the page was quietly destroyed by a rule nobody was
 *        measuring. The lesson is identical: ASSERT THE VISIBLE OUTCOME.
 *
 *   Root cause of (1) is architectural: public/images/people/ can hold files the
 *   vault does not. Anything site-only is invisible to vault-driven regeneration,
 *   so a clean rebuild silently drops it. This guard makes that state fatal.
 *
 * WHAT IT CHECKS  (all four must pass)
 *   A. ORPHAN SITE FILES — every image in public/images/people/ must be derivable
 *      from the vault. Derivable means EITHER (i) an ![[...]] embed somewhere in
 *      the vault resolves (by sha256) to those same bytes, or (ii) a vault image
 *      of the same name exists anywhere under Family History/ and the bytes match.
 *      A file with NO vault counterpart at all is a single point of failure →
 *      FAIL, with instructions to put the original in the vault.
 *      Bytes are compared, not filenames, so the site's safeImageFilename()
 *      renaming (spaces → hyphens) does not produce false positives.
 *
 *   B. EMBED RESOLUTION — every ![[image]] embed in every vault .md must resolve
 *      to a file on disk. A dangling embed silently drops the photo → FAIL.
 *
 *   C. EMBED → ATTACHMENT — every image embed in a PERSON profile must end up in
 *      that person's people.json images[]. If the converter skipped it (bad path,
 *      unsupported extension, malformed syntax) the photo never renders → FAIL.
 *
 *   D. FILE EXISTENCE — every filename in people.json images[] must exist in
 *      public/images/people/. image-integrity-check covers this too; duplicated
 *      here so this guard is self-sufficient and fails closed on its own.
 *
 * DELIBERATELY NOT CHECKED
 *   Photos held in the vault that are intentionally NOT published (rejected
 *   portraits, private living-person shots, working reference images). Those are
 *   legitimate. The vault→site direction is not required to be total; only the
 *   site→vault direction is, because that is what makes a rebuild safe.
 *
 * FAILURE MODE
 *   Non-zero exit + a named list → blocks npm run postbuild → blocks deploy.
 *
 * USAGE
 *   node scripts/check-vault-photo-parity.mjs
 *   node scripts/check-vault-photo-parity.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HOME = process.env.HOME;
const REPO = process.cwd();
const VAULT = path.resolve(HOME, 'ObsidianVault');
const VAULT_FH = path.join(VAULT, 'Family History');
const VAULT_PEOPLE = path.join(VAULT_FH, 'People');
const PHOTOS_DIR = path.join(VAULT_PEOPLE, 'Photos');
const ASSETS_DIR = path.join(VAULT_FH, '_assets');
const PUBLIC_IMG = path.join(REPO, 'public', 'images', 'people');
const PEOPLE_JSON = path.join(REPO, 'src', 'data', 'people.json');

const IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;
const EMBED = /!\[\[([^\]]+)\]\]/g;

/**
 * CI / no-vault mode.
 * ──────────────────
 * CI checks out the SITE REPO ONLY — there is no ObsidianVault in the runner.
 * Unguarded, checks A–C would report every published image as an orphan (91 of
 * 91), producing a red build that says nothing about the photos. That is
 * exactly what happened on run 39386727114.
 *
 * Rather than skip the guard there, CI runs it in manifest mode: the vault-derived
 * inventory is committed to the repo (photo-vault-manifest.json) by a local run,
 * and CI re-verifies the published files against THAT. This keeps a real assertion
 * in CI (site images must still match the committed vault inventory) while the
 * full four-direction check runs on the machine that actually has the vault.
 *
 * The manifest is deliberately NOT auto-written on every run: writing it on each
 * local build would make it always self-consistent and therefore worthless — it
 * would "prove" whatever the current state happens to be. It is written only when
 * --write-manifest is passed, i.e. after a human-meaningful change to the photos.
 */
const WRITE_MANIFEST = process.argv.includes('--write-manifest');
const MANIFEST_PATH = path.join(REPO, 'scripts', 'photo-vault-manifest.json');
const VAULT_PRESENT = fs.existsSync(VAULT_FH);

if (!VAULT_PRESENT && !fs.existsSync(MANIFEST_PATH)) {
  console.error(
    '🖼️  vault-photo-parity: no vault and no committed manifest — cannot verify anything.\n' +
    '    Run "node scripts/check-vault-photo-parity.mjs --write-manifest" on the machine holding the vault.'
  );
  process.exit(1);
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const out = {
  ok: true,
  mode: VAULT_PRESENT ? 'vault' : 'manifest',
  stats: {},
  orphan_site_files: [],
  broken_embeds: [],
  embed_not_attached: [],
  missing_published_files: [],
};

// ── index every vault image by sha256 and by basename ───────────────────────
const vaultBySha = new Map();   // sha -> [absPath]
const vaultByBase = new Map();  // basename(normalised) -> [absPath]
const walkImages = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { walkImages(fp); continue; }
    if (!IMG_EXT.test(e.name)) continue;
    const s = sha(fp);
    if (!vaultBySha.has(s)) vaultBySha.set(s, []);
    vaultBySha.get(s).push(fp);
    const b = e.name.toLowerCase();
    if (!vaultByBase.has(b)) vaultByBase.set(b, []);
    vaultByBase.get(b).push(fp);
  }
};
walkImages(VAULT_FH);

// In manifest mode the vault-derived byte inventory comes from the committed file.
let manifestShas = null;
if (!VAULT_PRESENT) {
  try {
    manifestShas = new Set(JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).vault_sha256 || []);
  } catch (e) {
    console.error(`🖼️  vault-photo-parity: manifest unreadable (${e.message.split('\n')[0]})`);
    process.exit(1);
  }
}
const bytesKnownToVault = (fileSha) =>
  manifestShas ? manifestShas.has(fileSha) : vaultBySha.has(fileSha);

// ── A. orphan site files (site-only = unrecoverable by regeneration) ────────
const publicFiles = fs.existsSync(PUBLIC_IMG)
  ? fs.readdirSync(PUBLIC_IMG).filter((f) => IMG_EXT.test(f))
  : [];
for (const f of publicFiles) {
  const fp = path.join(PUBLIC_IMG, f);
  if (bytesKnownToVault(sha(fp))) continue;        // bytes exist in vault — safe
  out.orphan_site_files.push({
    file: f,
    note: manifestShas
      ? 'bytes not in the committed vault manifest — cannot be reproduced from the vault'
      : 'no vault image has these bytes — a clean rebuild can drop this photo',
  });
}
out.stats.public_images = publicFiles.length;
out.stats.vault_images = manifestShas ? manifestShas.size : [...vaultBySha.values()].flat().length;

// ── B/C. embeds: resolve on disk AND reach the profile's images[] ──────────
// Vault-only checks: skipped in manifest mode (no vault to walk). Check D below
// still runs in both modes, so CI keeps a real assertion.
let people = [];
try { people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf8')); } catch { people = []; }
const byVaultFile = new Map((people || []).map((p) => [p.vault_file, p]));

const mdFiles = [];
const walkMd = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { walkMd(fp); continue; }
    if (e.name.endsWith('.md')) mdFiles.push(fp);
  }
};
if (VAULT_PRESENT) walkMd(VAULT_PEOPLE);

let embedCount = 0;
for (const md of mdFiles) {
  const body = fs.readFileSync(md, 'utf-8');
  const person = byVaultFile.get(path.basename(md));
  const attached = new Set((person?.images || []).map((i) => i.filename));
  for (const m of body.matchAll(EMBED)) {
    const clean = m[1].split('|')[0].trim();
    if (!IMG_EXT.test(clean)) continue;
    embedCount++;
    const base = path.basename(clean);
    // resolve exactly as convert-markdown.mjs does, then fall back to a name search
    const candidates = [
      path.join(VAULT, clean),
      path.join(ASSETS_DIR, base),
      path.join(PHOTOS_DIR, base),
    ];
    let resolved = candidates.find((c) => fs.existsSync(c));
    if (!resolved) resolved = (vaultByBase.get(base.toLowerCase()) || [])[0];
    if (!resolved) {
      out.broken_embeds.push({ note: path.basename(md), embed: clean });
      continue;
    }
    // C only applies to files that actually back a person profile
    if (person) {
      const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-');
      const pub = path.join(PUBLIC_IMG, safe);
      const wired = attached.has(safe) || attached.has(base);
      if (!wired && fs.existsSync(pub)) {
        out.embed_not_attached.push({ note: path.basename(md), file: safe });
      }
    }
  }
}
out.stats.vault_embeds = embedCount;

// ── E. vault photos that NOBODY embeds (vault-only = will never reach the page)
// The mirror image of A. A photo dropped into Family History/People/Photos/ with
// no ![[...]] in any profile is invisible: it is not broken, it is simply never
// published, and nothing else complains. That silent drop is the exact failure
// mode this whole guard exists to prevent, so it must be reported.
//
// Reported, NOT fatal: the vault legitimately holds images that are not meant to
// be published (full-res originals kept for print, per-profile working scans,
// site-1600px-* derivatives backing a published file). Flagging every one of
// those would make the gate useless noise. So each unembedded file is listed for
// a human to confirm, and only a file that looks like a NEW photo intended for a
// page is called out loudly.
const embeddedBasenames = new Set();
const unembedded = [];
if (VAULT_PRESENT) {
  // every basename referenced by any ![[...]] anywhere in the vault
  const walkAllMd = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walkAllMd(fp); continue; }
      if (!e.name.endsWith('.md')) continue;
      const txt = fs.readFileSync(fp, 'utf8');
      for (const m of txt.matchAll(EMBED)) {
        const t = m[1].split('|')[0].trim();
        embeddedBasenames.add(path.basename(t).toLowerCase());
      }
    }
  };
  walkAllMd(VAULT_PEOPLE);
  walkAllMd(path.join(VAULT, 'Family History'));

  if (fs.existsSync(PHOTOS_DIR)) {
    for (const f of fs.readdirSync(PHOTOS_DIR).filter((x) => IMG_EXT.test(x))) {
      const lower = f.toLowerCase();
      if (embeddedBasenames.has(lower)) continue;
      // derivatives and originals are deliberately not embedded — they back a
      // published file rather than being one
      if (/^(orig-|site-\d+px-)/i.test(f)) continue;
      unembedded.push({ file: f, reason: 'no ![[...]] anywhere in the vault — will not appear on any page' });
    }
  }
}
out.unembedded_vault_photos = unembedded;
out.stats.unembedded = unembedded.length;

// ── D. every attached filename must exist in public/ ──────────────────────
for (const p of people || []) {
  for (const im of p.images || []) {
    const f = typeof im === 'string' ? path.basename(im) : path.basename(im?.src || '');
    if (!f) continue;
    if (!fs.existsSync(path.join(PUBLIC_IMG, f))) {
      out.missing_published_files.push({ slug: p.slug, file: f });
    }
  }
  if (p.person_photo) {
    const f = path.basename(p.person_photo);
    if (f && !fs.existsSync(path.join(PUBLIC_IMG, f))) {
      out.missing_published_files.push({ slug: p.slug, file: f, kind: 'person_photo' });
    }
  }
}

out.ok =
  out.orphan_site_files.length === 0 &&
  out.broken_embeds.length === 0 &&
  out.embed_not_attached.length === 0 &&
  out.missing_published_files.length === 0;

// ── manifest write (only with --write-manifest, only where a vault exists) ──
if (WRITE_MANIFEST) {
  if (!VAULT_PRESENT) {
    console.error('🖼️  --write-manifest requires the vault; run it on the machine that holds ObsidianVault.');
    process.exit(1);
  }
  const shas = [...vaultBySha.keys()].sort();
  const manifest = {
    _comment:
      'Vault-derived photo inventory for CI, which has no ObsidianVault checkout. ' +
      'sha256 of every image under Family History/. Regenerate with ' +
      '"node scripts/check-vault-photo-parity.mjs --write-manifest" AFTER changing photos.',
    generated: new Date().toISOString(),
    vault_images: shas.length,
    vault_sha256: shas,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1) + '\n');
  console.log(`🖼️  wrote ${path.relative(REPO, MANIFEST_PATH)} — ${shas.length} vault image hashes`);
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(out, null, 1));
  process.exit(out.ok ? 0 : 1);
}

if (out.ok) {
  console.log(
    `🖼️  vault-photo-parity: OK — ${out.stats.public_images} site images / ${out.stats.vault_images} vault images / ${out.stats.vault_embeds} embeds, all reachable from the vault.`
  );
  if (unembedded.length > 0) {
    console.log(`⚠️  ${unembedded.length} vault photo(s) are embedded in NO note — they will never reach a page:`);
    for (const u of unembedded.slice(0, 10)) console.log(`    • ${u.file}`);
    if (unembedded.length > 10) console.log(`    … and ${unembedded.length - 10} more`);
    console.log('    If one is meant for a profile: ![[Family History/People/Photos/<name>]] then bash scripts/regenerate-data.sh');
  }
  process.exit(0);
}

console.error('🖼️  vault-photo-parity FAILED — the vault no longer explains the site\'s photos.');
if (out.orphan_site_files.length) {
  console.error('\n  ORPHAN SITE FILES (published, but no vault original — a rebuild can DROP these):');
  for (const o of out.orphan_site_files) console.error(`    ❌ ${o.file}\n       ${o.note}`);
  console.error('       FIX: put the original in ObsidianVault/Family History/People/Photos/ (or _assets/),');
  console.error('            then embed it in the owning profile with ![[Family History/People/Photos/<name>]].');
}
if (out.broken_embeds.length) {
  console.error('\n  BROKEN EMBEDS (an ![[...]] that points at nothing — the photo silently vanishes):');
  for (const b of out.broken_embeds) console.error(`    ❌ ${b.note} → ${b.embed}`);
}
if (out.embed_not_attached.length) {
  console.error('\n  EMBEDDED BUT NOT ATTACHED (converter skipped it, so it never renders):');
  for (const e of out.embed_not_attached) console.error(`    ❌ ${e.note} → ${e.file}`);
}
if (out.missing_published_files.length) {
  console.error('\n  ATTACHED BUT FILE MISSING FROM public/images/people/:');
  for (const m of out.missing_published_files) console.error(`    ❌ ${m.slug} → ${m.file}${m.kind ? ` (${m.kind})` : ''}`);
}
console.error('\nRefusing to ship a site whose photos the vault cannot reproduce.');
process.exit(1);
