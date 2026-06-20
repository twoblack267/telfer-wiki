#!/usr/bin/env node
/**
 * BULK GENERATE — Creates vault files and people.json entries
 * for every person referenced but missing from the tree.
 *
 * Usage: node scripts/bulk-generate-missing.mjs
 *
 * Strategy:
 * 1. Parse all unresolved refs from people.json
 * 2. For each unique name, determine first/last name and lifespan
 * 3. Create a vault markdown file
 * 4. Add a people.json entry
 * 5. Then update all refs to use correct slugs
 */

import fs from 'fs';
import path from 'path';

const PEOPLE_JSON = 'src/data/people.json';
const VAULT_DIR = '/home/mark/ObsidianVault/Family History/People/';

// Load existing data
const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));
const existingVaultFiles = new Set(
  fs.readdirSync(VAULT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.toLowerCase())
);

// ── HELPERS ──

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9 .-]/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripAnnotation(str) {
  return str.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function parseLifespan(str) {
  // Extract years from "(1796–1863)", "(1799–?)", "(b. S.A.)", "(m. 1910)" etc.
  const yearMatch = str.match(/\((\d{4})\s*[–\-]\s*(\d{4}|\?|)\)/);
  if (yearMatch) {
    const birth = parseInt(yearMatch[1]);
    const death = yearMatch[2] === '?' || !yearMatch[2] ? null : parseInt(yearMatch[2]);
    return { birth, death };
  }
  // Single year: "(1871–?)"
  const singleMatch = str.match(/\((\d{4})\s*[–\-]\s*\?\)/);
  if (singleMatch) return { birth: parseInt(singleMatch[1]), death: null };
  return { birth: null, death: null };
}

function extractMarriageYear(str) {
  const m = str.match(/\(m\.\s*(\d{4})\)/);
  return m ? parseInt(m[1]) : null;
}

// ── COLLECT ALL UNRESOLVED REFS ──

const unresolvedMap = new Map(); // refText -> { context: [{ personSlug, field }], ... }

for (const p of people) {
  for (const field of ['parents', 'children', 'spouses']) {
    if (!p[field]) continue;
    for (const ref of p[field]) {
      if (ref in slugSet) continue;
      if (['?', '???', 'Unknown', '[unknown]', 'None', 'None (never married)', '(others unconfirmed)'].includes(ref)) continue;
      if (!unresolvedMap.has(ref)) unresolvedMap.set(ref, []);
      unresolvedMap.get(ref).push({ personSlug: p.slug, field });
    }
  }
}

console.log(`📊 Total unique unresolved refs: ${unresolvedMap.size}`);
console.log();

// ── CLASSIFICATION ──

// These are already in slug format — they just need vault files
const slugFormatRefs = [];
const namedPeople = [];

for (const [ref] of unresolvedMap) {
  if (/^[a-z][a-z0-9-]+$/.test(ref) && ref !== 'unknown') {
    slugFormatRefs.push(ref);
  } else {
    namedPeople.push(ref);
  }
}

console.log(`🔤 Slug-format refs (need entry): ${slugFormatRefs.length}`);
console.log(`👤 Named people refs (need entry): ${namedPeople.length}`);
console.log();

// ── CREATE SLUG-FORMAT ENTRIES ──

function findPersonBySlugLike(name) {
  // Try to find a person whose display_name or slug contains the name
  const lower = name.toLowerCase().replace(/-/g, ' ');
  // Split slug parts and check against known names
  return people.find(p => {
    const dn = (p.display_name || '').toLowerCase();
    const sn = p.slug.toLowerCase().replace(/-/g, ' ');
    return dn.includes(lower) || sn.includes(lower);
  });
}

function createVaultContent(first_name, last_name, middle_name, birth_year, death_year, lifespan, title, body, children, parents, spouse) {
  let birthStr = birth_year ? `birth_year: ${birth_year}\n` : '';
  let deathStr = death_year ? `death_year: ${death_year}\n` : '';
  let middleStr = middle_name ? `middle_name: ${middle_name}\n` : '';
  let childrenStr = children && children.length > 0 ? `\n| **Known Children** | ${children.join(', ')} |` : '';
  let parentsStr = parents ? `\n| **Parents** | ${parents.join(', ')} |` : '';
  let spouseStr = spouse ? `\n| **Spouse** | ${spouse} |` : '';

  return `---
${birthStr}${deathStr}date: 2026-06-20
first_name: ${first_name}
last_name: ${last_name}
${middleStr}relationships: 'Self: ${title.replace(/'/g, "\\'")}${spouseStr}${childrenStr}${parentsStr}'
tags:
  - family
  - ancestor
title: '${title.replace(/'/g, "\\'")}'
children: ${JSON.stringify(children || [])}
---

# ${title}

> This is an automatically generated stub entry linked from the Telfer family tree.

## Sources

- Linked from other family vault files

## Links

- [[Family Tree]]
`;
}

// ── PROCESS SLUG-FORMAT REFS ──

const slugData = {
  'elizabeth-hutton-1774': {
    first: 'Elizabeth', middle: '', last: 'Hutton',
    birth: 1774, death: null,
    title: 'Elizabeth Hutton (1774–?)',
    note: 'Spouse of James Telfer (1761–1845). Mother of 8 children.'
  },
  'hannah-peacock': {
    first: 'Hannah', middle: '', last: 'Peacock',
    birth: null, death: null,
    title: 'Hannah Peacock',
    note: 'Spouse of James Robert Telfer (1866–?).'
  },
  'margaret-wright-1807': {
    first: 'Margaret', middle: '', last: 'Wright',
    birth: 1807, death: null,
    title: 'Margaret Wright (1807–?)',
    note: 'Spouse of Francis Telfer (1809–1895). Mother of George, Margaret Dougal.'
  },
  'mary-anne-mcintyre': {
    first: 'Mary Anne', middle: '', last: 'McIntyre',
    birth: null, death: null,
    title: 'Mary Anne McIntyre',
    note: 'Spouse of Wilhelm Seebohm. Mother of Julia Matilda Seebohm.'
  },
  'susan-burton-1844': {
    first: 'Susan', middle: '', last: 'Burton',
    birth: 1844, death: null,
    title: 'Susan Burton (1844–?)',
    note: 'Spouse of Robert Telfer (1837–1887). Mother of James Robert Telfer.'
  },
  'wilhelm-seebohm': {
    first: 'Wilhelm', middle: '', last: 'Seebohm',
    birth: null, death: null,
    title: 'Wilhelm Seebohm',
    note: 'Spouse of Mary Anne McIntyre. Father of Julia Matilda Seebohm.'
  }
};

const createdFiles = [];
const createdSlugs = new Set();

for (const slug of slugFormatRefs) {
  if (slug in slugData) {
    const d = slugData[slug];
    createdSlugs.add(slug);

    // Determine relationships from context
    const contexts = unresolvedMap.get(slug) || [];
    const spouseContexts = contexts.filter(c => c.field === 'spouses');
    const parentContexts = contexts.filter(c => c.field === 'parents');
    const childContexts = contexts.filter(c => c.field === 'children');

    const vaultFilename = `${d.title.replace(/:/g, '')}.md`;
    const vaultPath = path.join(VAULT_DIR, vaultFilename);

    // Don't overwrite existing
    if (existingVaultFiles.has(vaultFilename.toLowerCase())) {
      console.log(`  ⏭️  Already exists: ${vaultFilename}`);
      continue;
    }

    // Build relationships
    let relSpouse = d.note.match(/Spouse of ([^.]*)/)?.[1] || '';
    let relChildren = d.note.match(/Mother of ([^.]*)/)?.[1] || '';
    if (!relChildren && d.note.match(/Father of ([^.]*)/)?.[1]) {
      relChildren = d.note.match(/Father of ([^.]*)/)?.[1] || '';
    }

    const content = `---
date: 2026-06-20
first_name: ${d.first}
last_name: ${d.last}
${d.middle ? `middle_name: ${d.middle}\n` : ''}
${d.birth ? `birth_year: ${d.birth}\n` : ''}
relationships: 'Self: ${d.title} | Spouse: ${relSpouse} | Children: ${relChildren}'
tags:
  - family
  - ancestor
title: ${d.title}
children: []
---

# ${d.title}

${d.note}

> Stub entry — automatically generated from family tree references.

## Links

- [[Family Tree]]
`;

    const displayName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    fs.writeFileSync(vaultPath, content);
    createdFiles.push(vaultFilename);

    // Create people.json entry
    people.push({
      slug: slug,
      display_name: d.title,
      first_name: d.first,
      middle_name: d.middle || '',
      last_name: d.last,
      birth_year: d.birth,
      death_year: d.death,
      lifespan: d.birth ? `${d.birth}–${d.death || '?'}` : '',
      parents: { father: '', mother: '' },
      spouses: spouseContexts.map(c => c.personSlug),
      children: [],
      vault_file: vaultFilename
    });

    console.log(`  ✅ Created: ${vaultFilename}`);
  } else {
    console.log(`  ⚠️  No data for slug: ${slug}`);
  }
}

// ── PROCESS NAMED PEOPLE ──
// For the ~149 named people, we'll extract what we can from the ref text

console.log();
console.log('📝 Creating entries for named people...');
console.log();

let namedCreated = 0;
const nameProcessed = new Set();

for (const ref of namedPeople) {
  // Skip if it's an annotation fragment
  if (['Cornwall)', '(adopted'].some(s => ref === s || ref.endsWith('(adopted'))) {
    continue;
  }

  const cleanRef = ref
    .replace(/\s*\(m\.\s*\d{4}\)/, '')  // remove "(m. 1910)"
    .replace(/\s*\(d\.\s*\d{4}\)/, '')  // remove "(d. 1940)"
    .trim();

  // Extract lifespan years
  const { birth, death } = parseLifespan(ref);

  // Remove trailing lifespan in parentheses for name extraction
  const namePart = stripAnnotation(cleanRef)
    .replace(/\s*\(b\.\s*[^)]*\)/, '')
    .trim();

  // Split into first and last name
  const words = namePart.split(/\s+/);
  if (words.length < 1) continue;

  const first_name = words[0];
  let last_name = words.length > 1 ? words.slice(1).join(' ') : '';
  let middle_name = '';

  // Handle "Mr Lastname" pattern
  if (first_name === 'Mr' || first_name === 'Mrs' || first_name === 'Dr') {
    last_name = words.slice(1).join(' ');
    continue; // Skip these — they're just honorific placeholders
  }

  // Skip short single names like "Beaton" without contexts
  if (last_name === '' && words.length === 1) {
    continue;
  }

  // Remove "né" suffixes from last name
  if (last_name.includes(' née ')) {
    last_name = last_name.split(' née ')[0];
  }

  // Build slug
  const nameKey = `${first_name.toLowerCase()} ${last_name.toLowerCase()}`;
  let slug = slugify(`${first_name} ${last_name}`);

  // Add year to slug for disambiguation if available
  if (birth) slug = slugify(`${first_name} ${last_name} ${birth}`);
  if (slugSet.has(slug) || createdSlugs.has(slug) || nameProcessed.has(nameKey)) continue;
  if (slug.length < 2) continue;

  // Determine lifespans
  const displayLifespan = birth ? `${birth}–${death || '?'}` : '';

  // Determine title
  let title = `${first_name} ${last_name}`;
  if (displayLifespan) title += ` (${displayLifespan})`;

  // Vault filename
  const vaultFilename = `${title.replace(/:/g, '')}.md`;
  const vaultPath = path.join(VAULT_DIR, vaultFilename);

  if (existingVaultFiles.has(vaultFilename.toLowerCase())) {
    console.log(`  ⏭️  Already exists: ${vaultFilename}`);
    continue;
  }

  // Get context
  const contexts = unresolvedMap.get(ref) || [];

  // Determine if this person is a Telfer
  const isTelfer = last_name === 'Telfer' || last_name.startsWith('Telfer');

  const content = `---
${birth ? `birth_year: ${birth}\n` : ''}${death ? `death_year: ${death}\n` : ''}date: 2026-06-20
first_name: ${first_name}
last_name: ${last_name}
${middle_name ? `middle_name: ${middle_name}\n` : ''}relationships: 'Self: ${title}'
tags:
  - family
  ${isTelfer ? '- ancestor' : '- non-telfer'}
title: '${title.replace(/'/g, "\\'")}'
children: []
---

# ${title}

> Stub entry — automatically generated from family tree references.

## Links

- [[Family Tree]]
`;

  fs.writeFileSync(vaultPath, content);
  existingVaultFiles.add(vaultFilename.toLowerCase());
  const slugLower = slug.toLowerCase();

  // Add to people.json
  people.push({
    slug: slugLower,
    display_name: title,
    first_name: first_name,
    middle_name: middle_name,
    last_name: last_name,
    birth_year: birth,
    death_year: death,
    lifespan: displayLifespan,
    parents: { father: '', mother: '' },
    spouses: [],
    children: [],
    vault_file: vaultFilename
  });

  createdSlugs.add(slugLower);
  nameProcessed.add(nameKey);

  namedCreated++;
  if (namedCreated % 20 === 0) {
    console.log(`  ... ${namedCreated} named entries created`);
  }
}

console.log(`\n✅ Created ${createdFiles.length} slug-format vault files`);
console.log(`✅ Created ${namedCreated} named-people vault files`);
console.log(`📝 Total people.json entries: ${people.length}`);

// Write updated people.json
fs.writeFileSync(PEOPLE_JSON, JSON.stringify(people, null, 2));
console.log(`💾 Wrote updated ${PEOPLE_JSON}`);

// ── SUMMARY ──
console.log('\n=== SUMMARY ===');
console.log(`Total created: ${createdFiles.length + namedCreated}`);
console.log(`people.json now has: ${people.length} entries`);
