/**
 * Pass 4: Handle remaining unfixable refs with targeted knowledge
 *
 * Categories:
 * 1. Married-out Telfer women → their birth-name slug
 * 2. Missing Telfer children who need stub entries
 * 3. Non-Telfer family refs → leave as-is
 */

import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));

// ── 1. Married-out lookup: married name → birth slug ──
// These women ARE in the tree under their birth names.
// The ref used their married surname, so we map back.
const MARRIED_OUT_MAP = {
  'Clarice May Fatchen': 'clarice-may-telfer',
  'Emily Amelia Barton': 'emily-amelia-telfer',
  'Ethel Jean McMurtrie': 'ethel-jean-telfer',
  'Gladys Merle Pedler': 'gladys-merle-telfer',
  'Doris Elma Rowe': 'doris-elma-telfer',
  'Clarice May Pedler': 'clarice-may-telfer',
};

// ── 2. Hyphen-format year ranges ──
// e.g. "John Telfer (1840-1913)" with regular hyphen
// Display name matches to build year-indexed
const displayByFirstLastYear = {};
people.forEach(p => {
  if (!p.first_name || !p.last_name || !p.display_name) return;
  const fn = p.first_name.toLowerCase().split(/\s+/)[0];
  const ln = p.last_name.toLowerCase();
  const key = `${fn}|${ln}|${p.birth_year || ''}`;
  displayByFirstLastYear[key] = p.slug;
});

function resolveHyphenYear(ref) {
  // "John Telfer (1840-1913)" — note regular hyphen not em-dash
  const m = ref.match(/^(\w+(?:\s+\w+)*)\s*\((\d{4})-(\d{4}|\?)\)$/);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const birth = m[2];
  
  const words = name.split(/\s+/);
  if (words.length < 2) return null;
  const fn = words[0];
  const ln = words[words.length - 1];
  
  const key = `${fn}|${ln}|${birth}`;
  if (displayByFirstLastYear[key]) return displayByFirstLastYear[key];
  
  // Try first+last only
  const alt = people.filter(p => {
    const pf = (p.first_name || '').toLowerCase().split(/\s+/)[0];
    const pl = (p.last_name || '').toLowerCase();
    return pf === fn && pl === ln;
  });
  if (alt.length === 1) return alt[0].slug;
  return null;
}

// ── 3. Add stub entries for missing Telfer children ──
// These are people clearly referenced as children of Adam Telfer (1842)
// and other branches who need entries.
const STUB_ENTRIES = {};

function ensureStub(firstName, lastName, birthYear, deathYear, parentSlug, notes) {
  const slug = `${firstName.toLowerCase()}-${lastName.toLowerCase()}`.replace(/[^a-z0-9-]/g, '');
  let suffix = '';
  if (birthYear) suffix = `-${birthYear}`;
  const fullSlug = slug + suffix;
  
  if (slugSet.has(fullSlug)) return fullSlug;
  
  // Check if they already exist with a slightly different slug
  const existing = people.find(p => 
    (p.first_name || '').toLowerCase() === firstName.toLowerCase() &&
    (p.last_name || '').toLowerCase() === lastName.toLowerCase()
  );
  if (existing) return existing.slug;
  
  people.push({
    slug: fullSlug,
    first_name: firstName,
    last_name: lastName,
    birth_year: birthYear || null,
    death_year: deathYear || null,
    display_name: `${firstName} ${lastName}`,
    title: `${firstName} ${lastName} — Family & Biography`,
    tags: ['person', 'side-branch'],
    relationships: [],
    roles: [],
    body_markdown: `# ${firstName} ${lastName}\n\n**Branch:** Side-branch entry — added from relationship reference.\n\n*Auto-generated from family references. Stories to be added.*\n`,
    body_stripped: `**Branch:** Side-branch entry — added from relationship reference.`
  });
  slugSet.add(fullSlug);
  console.log(`  STUB ADDED: ${fullSlug}`);
  return fullSlug;
}

// ── Process each person's refs ──

let fixed = 0;
let stillBad = 0;
const stillBadList = [];

people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (!p[field]) return;
    const newVals = [];
    let changed = false;
    
    p[field].forEach(ref => {
      if (!ref || typeof ref !== 'string') { newVals.push(ref); return; }
      const trimmed = ref.trim();
      if (!trimmed || slugSet.has(trimmed)) { newVals.push(trimmed); return; }
      
      let result = null;
      
      // Step 1: Married-out map
      if (MARRIED_OUT_MAP[trimmed]) {
        result = MARRIED_OUT_MAP[trimmed];
        console.log(`  MARR: ${p.slug}->${field}: "${trimmed}" → "${result}"`);
      }
      
      // Step 2: Hyphen-year resolution
      if (!result) {
        result = resolveHyphenYear(trimmed);
        if (result) console.log(`  HYPHEN: ${p.slug}->${field}: "${trimmed}" → "${result}"`);
      }
      
      // Step 3: Try stripping hyphens from years in slug form
      if (!result) {
        // "john-telfer-1847-1929" → "john-telfer-18401927" etc
        const hyphenYears = trimmed.match(/^(.+?)-(\d{4})-(\d{4})$/);
        if (hyphenYears) {
          const concat = `${hyphenYears[1]}-${hyphenYears[2]}${hyphenYears[3]}`;
          if (slugSet.has(concat)) result = concat;
        }
      }
      
      // Step 4: "edwin-gilbert-telfer" or "francis-kelson-telfer" → stub
      if (!result) {
        const stubMatch = trimmed.match(/^(?:(edwin-(?:gilbert|roy))|(francis-(?:kelson|adam))|(james-[a-z]+))-telfer$/);
        if (stubMatch) {
          result = trimmed; // already slug-form, just not in slugSet
          // Create stub
          const parts = trimmed.replace(/-telfer$/, '').split('-');
          const fn = parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const stubSlug = ensureStub(fn, 'Telfer', null, null, p.slug, '');
          if (stubSlug) result = stubSlug;
        }
      }
      
      // Step 5: "Violet Hope Telfer" → needs entry
      if (!result) {
        const telferName = trimmed.match(/^([A-Za-z][a-z]+(?: [A-Za-z][a-z]+)+) Telfer$/);
        if (telferName) {
          // Try to split into first name parts
          const fullName = telferName[0];
          const words = fullName.split(/\s+/);
          if (words.length >= 2) {
            const ln = 'Telfer';
            const fn = words.slice(0, -1).join(' ');
            result = ensureStub(fn, ln, null, null, p.slug, '');
            if (result) console.log(`  STUB: ${p.slug}->${field}: "${trimmed}" → "${result}"`);
          }
        }
      }
      
      if (result && result !== trimmed) {
        newVals.push(result);
        changed = true;
        fixed++;
      } else if (result && result === trimmed && slugSet.has(result)) {
        newVals.push(result);
        fixed++;
      } else {
        newVals.push(trimmed);
        stillBad++;
        if (stillBad <= 3) stillBadList.push({person: p.slug, field, ref: trimmed});
      }
    });
    
    if (changed) {
      p[field] = newVals;
    }
  });
});

// Deduplicate
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (Array.isArray(p[field])) {
      p[field] = [...new Set(p[field])];
    }
  });
});

// Final count
const slugSetFinal = new Set(people.map(p => p.slug));
let invalidAfter = 0;
const invalids = [];
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field]) {
      p[field].forEach(ref => {
        if (!slugSetFinal.has(ref)) { invalidAfter++; invalids.push(`${p.slug}->${field}: ${ref}`); }
      });
    }
  });
});

console.log(`\n=== RESULTS ===`);
console.log(`People: ${people.length}`);
console.log(`Fixed this pass: ${fixed}`);
console.log(`Still invalid: ${invalidAfter}`);
console.log(`\nRemaining invalid:`);
invalids.forEach(i => console.log(`  ${i}`));

// Write
fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log(`\n✅ Written to ${FILE}`);
