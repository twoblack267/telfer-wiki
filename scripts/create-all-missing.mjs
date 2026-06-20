#!/usr/bin/env node
/**
 * create-all-missing.mjs
 * Creates vault stub files for every person referenced but missing from the tree.
 * Does NOT touch people.json — the resolver handles that.
 *
 * Usage: node scripts/create-all-missing.mjs
 */

import fs from 'fs';
import path from 'path';

const PEOPLE_JSON = 'src/data/people.json';
const VAULT_DIR = '/home/mark/ObsidianVault/Family History/People/';

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));
const vaultFiles = new Set(
  fs.readdirSync(VAULT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.normalize('NFC').toLowerCase())
);

// ── HELPERS ──

function stripAnnotation(str) {
  return str.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function extractLifespan(str) {
  const m = str.match(/\((\d{4})\s*[–\-]\s*(\d{4}|[?])\)/);
  if (m) return { birth: parseInt(m[1]), death: m[2] === '?' ? null : parseInt(m[2]) };
  const single = str.match(/\((\d{4})\)/);
  if (single) return { birth: parseInt(single[1]), death: null };
  return { birth: null, death: null };
}

function extractNameParts(ref) {
  let clean = ref
    .replace(/\s*\(m\.\s*\d{4}\)/, '')
    .replace(/\s*\(adopted.*/, '')
    .replace(/\s*\(b\.\s*S\.A\.\)/, '')
    .trim();
  
  let ann = stripAnnotation(clean);
  let words = ann.split(/\s+/).filter(w => w && !['of', 'the'].includes(w.toLowerCase()));
  if (words.length < 1) return null;
  if (words[0] === 'Mr' || words[0] === 'Mrs' || words[0] === 'Dr') return null;
  return words;
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9 .-]/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── COLLECT ALL UNIQUE UNRESOLVED REFS ──

const unresolved = [];
for (const p of people) {
  for (const field of ['parents', 'children', 'spouses']) {
    if (!p[field]) continue;
    for (const ref of p[field]) {
      if (ref in slugSet) continue;
      if (['?','???','Unknown','[unknown]','None','None (never married)','(others unconfirmed)'].includes(ref)) continue;
      unresolved.push({ person: p.slug, field, ref });
    }
  }
}

const uniqueRefs = [...new Set(unresolved.map(u => u.ref))];
console.log(`📊 Total unique unresolved refs: ${uniqueRefs.length}`);

// ── CLASSIFY ──

const slugPattern = /^[a-z][a-z0-9-]+$/;
const bySlug = {}; // Only refs already in slug format
const byName = {}; // Named people

for (const ref of uniqueRefs) {
  if (slugPattern.test(ref) && ref !== 'unknown') {
    bySlug[ref] = { ref, contexts: unresolved.filter(u => u.ref === ref) };
  } else {
    byName[ref] = { ref, contexts: unresolved.filter(u => u.ref === ref) };
  }
}

console.log(`   Slug-format (need entry): ${Object.keys(bySlug).length}`);
console.log(`   Named people (need entry): ${Object.keys(byName).length}`);

// ── SLUG-FORMAT ENTRIES ──

const slugMeta = {
  'elizabeth-hutton-1774': { first: 'Elizabeth', last: 'Hutton', birth: 1774 },
  'hannah-peacock': { first: 'Hannah', last: 'Peacock' },
  'margaret-wright-1807': { first: 'Margaret', last: 'Wright', birth: 1807 },
  'mary-anne-mcintyre': { first: 'Mary Anne', last: 'McIntyre' },
  'susan-burton-1844': { first: 'Susan', last: 'Burton', birth: 1844 },
  'wilhelm-seebohm': { first: 'Wilhelm', last: 'Seebohm' },
};

let created = { slug: 0, named: 0, skipped: 0 };

for (const [slug, meta] of Object.entries(slugMeta)) {
  const displayBirth = meta.birth ? `(${meta.birth}–?)` : '';
  const title = `${meta.first} ${meta.last} ${displayBirth}`.trim();
  const vaultFile = `${title}.md`;
  
  if (vaultFiles.has(vaultFile.normalize('NFC').toLowerCase())) {
    created.skipped++;
    continue;
  }

  const content = `---
date: 2026-06-20
first_name: ${meta.first}
last_name: ${meta.last}
${meta.birth ? `birth_year: ${meta.birth}\n` : ''}relationships: 'Self: ${title}'
tags:
  - family
  - non-telfer
title: ${title}
children: []
---

# ${title}

> Stub entry — linked from the Telfer family tree.

## Links

- [[Family Tree]]
`;

  fs.writeFileSync(path.join(VAULT_DIR, vaultFile), content);
  created.slug++;
  console.log(`  ✅ ${vaultFile}`);
}

// ── NAMED PEOPLE ──

for (const [ref, data] of Object.entries(byName)) {
  // Skip fragments
  if (ref === 'Cornwall)' || ref.endsWith('(adopted')) continue;
  
  const words = extractNameParts(ref);
  if (!words) { created.skipped++; continue; }

  const first_name = words[0];
  const last_name = words.length > 1 ? words.slice(1).join(' ') : '';

  // Skip single names (no surname) — these are annotation-only refs
  if (!last_name) { created.skipped++; continue; }

  const { birth, death } = extractLifespan(ref);
  const dispLifespan = birth ? `(${birth}–${death || '?'})` : '';
  const title = `${first_name} ${last_name} ${dispLifespan}`.trim();
  const vaultFile = `${title}.md`;

  if (vaultFiles.has(vaultFile.normalize('NFC').toLowerCase())) {
    created.skipped++;
    continue;
  }

  // Slug: use full name, add birth year if available for disambiguation
  const slug = birth ? slugify(`${first_name} ${last_name} ${birth}`) : slugify(`${first_name} ${last_name}`);
  if (slugSet.has(slug)) { created.skipped++; continue; }

  const isTelfer = last_name === 'Telfer' || last_name.startsWith('Telfer');

  const content = `---
date: 2026-06-20
first_name: ${first_name}
last_name: ${last_name}
${birth ? `birth_year: ${birth}\n` : ''}${death ? `death_year: ${death}\n` : ''}relationships: 'Self: ${title}'
tags:
  - family
  ${isTelfer ? '- ancestor' : '- non-telfer'}
title: ${title}
children: []
---

# ${title}

> Stub entry — linked from the Telfer family tree.

## Links

- [[Family Tree]]
`;

  fs.writeFileSync(path.join(VAULT_DIR, vaultFile), content);
  created.named++;
  if (created.named % 25 === 0) console.log(`   ... ${created.named} named stubs created`);
}

console.log(`\n📝 Summary:`);
console.log(`   Created slug-format stubs: ${created.slug}`);
console.log(`   Created named-people stubs: ${created.named}`);
console.log(`   Skipped (already exist): ${created.skipped}`);
console.log(`   Total vault files now: ${fs.readdirSync(VAULT_DIR).filter(f => f.endsWith('.md')).length}`);
