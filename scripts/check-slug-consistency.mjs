#!/usr/bin/env node
/**
 * check-slug-consistency.mjs
 *
 * Dry-run of convert-markdown.mjs to detect slug drift.
 * Backs up people.json, runs the converter, compares slugs,
 * then restores the original.
 *
 * Exit code:
 *   0 = all slugs match (in sync)
 *   1 = slug mismatch found (out of sync)
 *   2 = error
 *
 * Usage: node scripts/check-slug-consistency.mjs
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PEOPLE_JSON = path.join(REPO_ROOT, 'src/data/people.json');
const BACKUP_JSON = PEOPLE_JSON + '.bak';

// ── 1. Read current slugs ──────────────────────────────
if (!fs.existsSync(PEOPLE_JSON)) {
  console.error('❌ people.json not found');
  process.exit(2);
}

const origPeople = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
console.log(`📦 Current: ${origPeople.length} profiles in people.json`);

// ── 2. Backup ───────────────────────────────────────────
fs.copyFileSync(PEOPLE_JSON, BACKUP_JSON);

// ── 3. Run converter ────────────────────────────────────
console.log('🔄 Running convert-markdown.mjs...');
const result = spawnSync('node', ['scripts/convert-markdown.mjs'], {
  cwd: REPO_ROOT,
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 30000,
});

if (result.status !== 0) {
  // Restore backup on failure
  fs.copyFileSync(BACKUP_JSON, PEOPLE_JSON);
  fs.unlinkSync(BACKUP_JSON);
  console.error(`❌ convert-markdown.mjs failed (exit ${result.status}):`);
  console.error(result.stderr.toString());
  process.exit(2);
}

// ── 4. Read new slugs ───────────────────────────────────
const newPeople = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));

// ── 5. Compare ───────────────────────────────────────────

// Build lookup maps
const origMap = new Map(origPeople.map(p => [p.display_name, p]));
const newMap = new Map(newPeople.map(p => [p.display_name, p]));

// Detect slug changes: same display_name, different slug
const slugChanged = [];
for (const [name, newP] of newMap) {
  const origP = origMap.get(name);
  if (origP && origP.slug !== newP.slug) {
    slugChanged.push({ display_name: name, old: origP.slug, new: newP.slug });

    // Also check if this was fixed from '-unknown' to something real
    if (origP.slug.endsWith('-unknown')) {
      slugChanged[slugChanged.length - 1].note = 'was unknown!';
    }
  }
}

// Detect new profiles (in new but not in orig)
const newProfiles = newPeople.filter(p => !origMap.has(p.display_name));

// Detect removed profiles (in orig but not in new)
const removedProfiles = origPeople.filter(p => !newMap.has(p.display_name));

// Detect data changes (same slug, different metadata)
const dataChanged = [];
for (const [name, newP] of newMap) {
  const origP = origMap.get(name);
  if (origP && origP.slug === newP.slug) {
    for (const key of ['display_name', 'birth_year', 'death_year', 'first_name', 'last_name', 'middle_name', 'is_living']) {
      const ov = String(origP[key] ?? '');
      const nv = String(newP[key] ?? '');
      if (ov !== nv) {
        dataChanged.push({ slug: origP.slug, key, old: ov, new: nv });
      }
    }
  }
}

// ── 6. Report ────────────────────────────────────────────
let exitCode = 0;

console.log('');
console.log('═══════════════════════════════════════');
console.log('📊 Slug Consistency Report');
console.log('═══════════════════════════════════════');

if (slugChanged.length > 0) {
  exitCode = 1;
  console.log(`\n⚠️  BUILD OUT OF SYNC — ${slugChanged.length} slug change(s) found!`);
  console.log('   Run `node scripts/convert-markdown.mjs` then rebuild:\n');
  for (const sc of slugChanged) {
    const note = sc.note ? ` (${sc.note})` : '';
    console.log(`   ${sc.display_name}: ${sc.old} → ${sc.new}${note}`);
  }
}

if (newProfiles.length > 0) {
  console.log(`\n➕ ${newProfiles.length} new profile(s) in vault: ` +
    newProfiles.map(p => p.display_name).join(', '));
}

if (removedProfiles.length > 0) {
  console.log(`\n➖ ${removedProfiles.length} removed profile(s): ` +
    removedProfiles.map(p => p.display_name).join(', '));
}

if (dataChanged.length > 0) {
  console.log(`\n📝 ${dataChanged.length} field change(s) in existing profiles:`);
  for (const c of dataChanged) {
    console.log(`   ${c.slug}: ${c.key} "${c.old}" → "${c.new}"`);
  }
}

if (slugChanged.length === 0 && newProfiles.length === 0 &&
    removedProfiles.length === 0 && dataChanged.length === 0) {
  console.log('\n✅ All slugs in sync. Vault and build are consistent. No action needed.');
}

// ── 7. Restore backup ────────────────────────────────────
fs.copyFileSync(BACKUP_JSON, PEOPLE_JSON);
fs.unlinkSync(BACKUP_JSON);
console.log(`\n♻️  people.json restored from backup.`);

process.exit(exitCode);
