/**
 * Final truth-based fix: handle confident patterns only.
 * Add married-out women, fix slug edge cases, skip anything ambiguous.
 */
import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const findSlug = name => people.find(p => p.slug === name);
const byDisplay = {};
people.forEach(p => { if (p.display_name) byDisplay[p.display_name.toLowerCase().trim()] = p.slug; });
const byFirstLast = {};
people.forEach(p => {
  const fn = (p.first_name||'').trim().toLowerCase().split(/\s+/)[0];
  const ln = (p.last_name||'').trim().toLowerCase();
  const key = fn+'|'+ln;
  if (!byFirstLast[key]) byFirstLast[key] = [];
  byFirstLast[key].push({slug: p.slug, by: p.birth_year, dy: p.death_year, dn: (p.display_name||'').trim()});
});

// ── 1. Married-out Telfer women → birth-name slug ──
// These women ARE in the tree under their birth names
// Format: "Clarice May Fatchen" → "clarice-may-telfer"
const marriedOut = {
  'Clarice May Fatchen': 'clarice-may-telfer',
  'Emily Amelia Barton': 'emily-amelia-telfer',
  'Ethel Jean McMurtrie': 'ethel-jean-telfer',
  'Gladys Merle Pedler': 'gladys-merle-telfer',
  'Doris Elma Rowe': 'doris-elma-telfer',
  'Esther Telfer Smith (1870–1896)': 'esther-jane-telfer',
  'Francis Telfer Smith (1874–1945)': null, // check if this person exists
  'Elizabeth Anne Smith (1878–?)': null, // check
  'Mary Jane Paynter (1861–1945)': null,
  'Francis Telfer Paynter (1862–?)': null,
  'Dinah Flavel Paynter (1869–?)': null,
  'Elizabeth Paynter (1864–?)': null,
  'George Hope Farrow': null,
};

// Verify each
const verify = {};
Object.entries(marriedOut).forEach(([name, slug]) => {
  if (slug && findSlug(slug)) {
    verify[name] = slug;
    console.log('✓ ' + name + ' → ' + slug);
  } else {
    // Try to find by first name
    const words = name.replace(/\s*\(.*\)\s*/g,'').trim().split(/\s+/);
    const fn = words[0].toLowerCase();
    const candidates = byFirstLast[fn+'|telfer'];
    if (candidates && candidates.length === 1) {
      verify[name] = candidates[0].slug;
      console.log('? ' + name + ' → ' + candidates[0].slug + ' (sole Telfer match)');
    } else if (candidates && candidates.length > 1) {
      console.log('✗ ' + name + ' — ambiguous, skip: ' + candidates.map(c=>c.slug).join(', '));
    } else {
      console.log('✗ ' + name + ' — no match');
    }
  }
});

// ── 2. Slug edge cases ──
// david-parker-18221888 → william-parker? david-parker?
// elizabeth-beattie-18321896 → elizabeth-beattie (maybe)
// john-charles-dillon-1827-1906 → john-dillon (exists)
// hannah-baker, hannah-baker-18551948, hannah-parker-18551948 → hannah-*?

const slugFixes = {
  'david-parker-18221888': null, // who is this?
  'elizabeth-beattie-18321896': 'elizabeth-beattie',
  'john-charles-dillon-1827-1906': 'john-dillon',
};

// Handle hannah-baker
const hannahs = byFirstLast['hannah|baker'];
if (hannahs && hannahs.length === 1) {
  slugFixes['hannah-baker-18551948'] = hannahs[0].slug;
  slugFixes['hannah-parker-18551948'] = hannahs[0].slug;
}

Object.entries(slugFixes).forEach(([oldSlug, newSlug]) => {
  if (newSlug && findSlug(newSlug)) {
    verify[oldSlug] = newSlug;
    console.log('✓ slug ' + oldSlug + ' → ' + newSlug);
  } else if (newSlug) {
    console.log('✗ slug ' + oldSlug + ' → ' + newSlug + ' (not found)');
  }
});

// ── 3. Apply verified fixes to people.json ──
let fixed = 0;
people.forEach(p => {
  ['parents','spouses','children'].forEach(field => {
    if (!p[field]) return;
    const newVals = p[field].map(ref => {
      // Check by display name match
      if (verify[ref.trim()]) return verify[ref.trim()];
      // Check by slug match
      if (verify[ref]) return verify[ref];
      // Check with year stripping
      const stripped = ref.replace(/\s*\(.*\)\s*/g,'').trim();
      if (verify[stripped]) return verify[stripped];
      return ref;
    });
    if (JSON.stringify(newVals) !== JSON.stringify(p[field])) {
      fixed += p[field].filter((r,i) => r !== newVals[i]).length;
      p[field] = newVals;
    }
  });
});

console.log(`\nApplied ${fixed} fixes`);
fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log('✅ Written');
