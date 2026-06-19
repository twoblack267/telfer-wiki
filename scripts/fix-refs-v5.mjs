/**
 * v5: Direct slug mapping for known old-format→new-format slug changes
 * Combined with smarter name matching for the remaining patterns.
 */

import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));

// ── Known old-format → new-format slug mappings ──
// These are slugs that were renamed during the cleanup
const OLD_TO_NEW = {
  'shirley-edna-telfer': 'shirley-telfer-1929',
  'kathryn-mavis-telfer-19611965': 'kathryn-telfer',
  'timothy-neil-telfer-1959': 'timothy-telfer',
  'george-wright-telfer': 'george-wright',  // skip — might not exist
  'martha-clara-henstridge-18541921': 'martha-henstridge',
  'martha-allen-d-1876': 'martha-allen',
  'john-charles-dillon-1827-1906': 'john-dillon',
  'john-charles-dillon-18271906': 'john-dillon',
  'william-henry-parker-18931968': 'william-parker',
  'hannah-baker': 'hannah-baker-18551948',  // might match
  'hannah-baker-18551948': 'hannah-baker-18551948',
  'hannah-parker-18551948': 'hannah-baker-18551948',
  'martha-telfer-cameron-18731964': 'martha-cameron',
  'isobelisabella-telfer-17981875': 'isobel',
  'francis-telfer-18091895-18091895': 'francis-telfer-1809',
  'margaret-telfer-18021884': null,  // ambiguous
  'david-parker-18221888': 'david-parker',
  'adam-telfer': null,  // ambiguous
  'james-telfer': null,  // ambiguous
  'margaret-telfer': null,  // ambiguous
  'jared-ivory': 'jared-ivory-living',
  'jared-mitchell-ivory': 'jared-ivory-living',
  'betty-hutton': 'elizabeth-hutton',
  'elizabeth-hutton': 'elizabeth-hutton',
  'beattie-family': null,
  'marian-cornish': null,
  'kenneth-cornish': null,
};

// ── Build name→slug lookup with nicknames ──
// For "Elizabeth 'Betty' Hutton" → slug
const nameLookup = {};
people.forEach(p => {
  if (p.display_name) {
    const dn = p.display_name.toLowerCase();
    // Full display name
    nameLookup[dn] = p.slug;
    
    // Remove quotes/nicknames: "Elizabeth \"Betty\" Hutton" → "elizabeth hutton"
    const cleaned = dn.replace(/"([^"]+)"/g, '').replace(/'([^']+)'/g, '').replace(/\[([^\]]+)\]/g, '').replace(/\s+/g, ' ').trim();
    if (cleaned !== dn && cleaned) nameLookup[cleaned] = p.slug;
    
    // Also handle Betty → Elizabeth Hutton
    if (p.first_name === 'Elizabeth' && p.last_name === 'Hutton') {
      nameLookup['betty hutton'] = p.slug;
    }
  }
  
  // Names with suffixes
  const nn = (p.nickname || '').toLowerCase();
  if (nn && p.last_name) {
    const nc = `${nn} ${p.last_name.toLowerCase()}`;
    nameLookup[nc] = p.slug;
  }
});

// ── Build first+last+context lookup for disambiguation ──
// For ambiguous "adam-telfer", use context person to determine which Adam
const fllookup = {};
people.forEach(p => {
  const fn = (p.first_name || '').toLowerCase().split(/\s+/)[0];
  const ln = (p.last_name || '').toLowerCase();
  const key = `${fn}|${ln}`;
  if (!fllookup[key]) fllookup[key] = [];
  fllookup[key].push({slug: p.slug, birth: p.birth_year});
});

function bestMatch(name, contextSlug) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  
  // Direct name match
  if (nameLookup[lower]) return nameLookup[lower];
  
  // Strip parentheses contents and try again (except years)
  const stripped = lower.replace(/[（(][^）)]*[)）]/g, '').replace(/\s+/g, ' ').trim();
  if (stripped !== lower && nameLookup[stripped]) return nameLookup[stripped];
  
  // "Adam Telfer" etc — first+last, maybe with context
  const words = stripped.split(/\s+/);
  if (words.length >= 2) {
    const fn = words[0];
    const ln = words[words.length - 1];
    const key = `${fn}|${ln}`;
    const candidates = fllookup[key];
    if (candidates && candidates.length === 1) return candidates[0].slug;
    if (candidates && candidates.length > 1 && contextSlug) {
      // Use context person's birth to find closest match
      const ctx = people.find(p => p.slug === contextSlug);
      if (ctx && ctx.birth_year) {
        // Find candidate with closest birth year that's plausible as parent (older)
        const older = candidates.filter(c => c.birth && c.birth < ctx.birth_year);
        if (older.length === 1) return older[0].slug;
        if (older.length > 1) {
          // Pick oldest (most likely parent)
          older.sort((a,b) => a.birth - b.birth);
          return older[0].slug;
        }
      }
    }
  }
  
  return null;
}

// ── Process each person ──
let fixed = 0;
let stillBad = 0;
const invalids = [];

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
      
      // Step 1: Direct old-to-new slug mapping
      const lowerRef = trimmed.toLowerCase();
      if (OLD_TO_NEW[lowerRef] && slugSet.has(OLD_TO_NEW[lowerRef])) {
        result = OLD_TO_NEW[lowerRef];
        console.log(`  SLUGMAP: ${p.slug}->${field}: "${trimmed}" → "${result}"`);
      }
      
      // Step 2: Name-based match with context
      if (!result) {
        result = bestMatch(trimmed, p.slug);
        if (result && result !== trimmed) console.log(`  NAMEMAP: ${p.slug}->${field}: "${trimmed}" → "${result}"`);
      }
      
      // Step 3: Split years with hyphen (regex failed earlier): "John Telfer (1840-1913)"
      if (!result) {
        const hy = trimmed.match(/^(.+?)\s*\((\d{4})-(\d{4}|\?)\)$/);
        if (hy) {
          const name = hy[1].trim();
          const birth = parseInt(hy[2]);
          result = bestMatch(name, p.slug);
          if (!result) {
            // Try "Telfer, Name" format
            const rev = trimmed.replace(/^(.+)\s+Telfer\b/, 'Telfer, $1');
            result = bestMatch(rev, p.slug);
          }
        }
      }
      
      // Step 4: Handle "Name (~1834–)" with tilde and missing death year
      if (!result) {
        const tilde = trimmed.match(/^([A-Za-z\s]+)\(~?(\d{4})[–—](\d{4}|)\)$/);
        if (tilde) {
          const name = tilde[1].trim().toLowerCase();
          result = bestMatch(name, p.slug);
          if (!result) {
            // Try "Elizabeth (~1834–)" → first name only
            const firstWord = name.split(/\s+/)[0];
            result = bestMatch(firstWord, p.slug);
          }
        }
      }
      
      if (result && slugSet.has(result)) {
        newVals.push(result);
        changed = true;
        fixed++;
      } else {
        newVals.push(trimmed);
        stillBad++;
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
const finalSlugSet = new Set(people.map(p => p.slug));
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field]) {
      p[field].forEach(ref => {
        if (!finalSlugSet.has(ref)) { invalids.push(`${p.slug}->${field}: ${ref}`); }
      });
    }
  });
});

console.log(`\n=== RESULTS ===`);
console.log(`Fixed: ${fixed}`);
console.log(`Still invalid: ${invalids.length}`);
console.log(`\nRemaining:`);
invalids.forEach(i => console.log(`  ${i}`));

// Write
fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log(`\n✅ Written`);
