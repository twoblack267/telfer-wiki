/**
 * Pass 2: Fix remaining invalid refs with smarter matching
 *
 * Patterns handled:
 * 1. Display names with years: "James Telfer (1761–1845)" → extract name, match
 * 2. Mangled slugs: "elizabeth-beattie-18021891" → try year-split variants
 * 3. Adoptive/deceased suffixes: strip "(adoptive)", "(deceased)", "(adopted)"
 * 4. Marriage dates: "Lilian Daisy Dawson (m. 1910)" → strip suffix
 * 5. née format: "Caroline Amelia Telfer (née Masters)" → try either name
 * 6. Metadata suffixes: "(brother)", "(first marriage)", "(all with ...)"
 * 7. "of place" indicator: "John Telfer (of Castleton) (~1731–?)" → complex
 * 8. Slugs with middle names: "murray-john-telfer-19111982" → "murray-telfer-1911"
 * 9. Hyphen vs non-hyphen years: "john-telfer-1840-1913" → "john-telfer-18401913"
 * 10. Extra text in slug: "james-telfer-b-1832-scotland" → "james-telfer-1832"
 * 11. "paul-ivory-19551996" → try "paul-ivory" etc.
 */

import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));

// --- Build all possible lookup tables ---

// Display name → slug (exact and lowercase)
const byDisplay = {};
people.forEach(p => {
  if (p.display_name) {
    byDisplay[p.display_name] = p.slug;
    byDisplay[p.display_name.toLowerCase()] = p.slug;
  }
});

// Name → slug: "first last", "first|last"
const byName = {};
people.forEach(p => {
  const fn = ((p.first_name || '')).toLowerCase();
  const ln = ((p.last_name || '')).toLowerCase();
  if (fn && ln) {
    // Full first+last
    byName[`${fn} ${ln}`] = p.slug;
    // First word of first name + last name
    const fn0 = fn.split(/\s+/)[0];
    byName[`${fn0} ${ln}`] = p.slug;
    byName[`${fn}|${ln}`] = p.slug;
    // Try hyphenated
    byName[`${fn0}-${ln}`] = p.slug;
  }
});

// Slug base → slug: e.g. "james-telfer" → "james-telfer-1761"
const byBase = {};
people.forEach(p => {
  const slug = p.slug;
  // Strip years
  const noYear = slug.replace(/-\d{4}(-\d{4}|-living)?$/, '');
  byBase[noYear] = byBase[noYear] || [];
  byBase[noYear].push(slug);
  
  // Also with hyphen-separated years: "john-telfer-1840-1913"
  const noHyphenYears = slug.replace(/-\d{4}-\d{4}$/, '');
  if (noHyphenYears !== slug) {
    byBase[noHyphenYears] = byBase[noHyphenYears] || [];
    byBase[noHyphenYears].push(slug);
  }
  
  // Strip "XXX" suffix from e.g. "elizabeth-telfer-1832-2"
  const noDup = slug.replace(/-\d+$/, '');
  if (noDup !== slug && noDup !== noYear) {
    byBase[noDup] = byBase[noDup] || [];
    byBase[noDup].push(slug);
  }
});

// --- Helpers ---

function tryMatchByDisplay(raw) {
  const trimmed = raw.trim();
  if (byDisplay[trimmed]) return byDisplay[trimmed];
  if (byDisplay[trimmed.toLowerCase()]) return byDisplay[trimmed.toLowerCase()];
  return null;
}

function tryMatchByName(raw) {
  const lower = raw.toLowerCase().trim();
  if (byName[lower]) return byName[lower];
  
  // Try by first+last word
  const words = lower.split(/\s+/);
  if (words.length >= 2) {
    const fn = words[0];
    const ln = words[words.length - 1];
    const key = `${fn}|${ln}`;
    if (byName[key]) return byName[key];
  }
  return null;
}

function tryMatchBySlug(raw) {
  const lower = raw.toLowerCase().trim();
  if (slugSet.has(lower)) return lower;
  
  // Try with hyphens for spaces
  const slugged = lower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (slugSet.has(slugged)) return slugged;
  
  return null;
}

function tryMatchByBase(raw) {
  const lower = raw.toLowerCase().trim();
  const slugged = lower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (byBase[slugged]) return byBase[slugged][0]; // First match
  if (byBase[lower]) return byBase[lower][0];
  return null;
}

// --- Fix a single ref with progressive matching ---
function fixRef(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  
  // Already valid
  if (slugSet.has(trimmed)) return trimmed;
  
  // Literal text to leave alone
  const lower = trimmed.toLowerCase();
  const literals = ['none', 'unknown', '?', '???', '[unknown]', 'none (never married)', 'unknown - living', 'unknown - deceased'];
  if (literals.includes(lower)) return null; // Leave as-is
  if (lower.match(/^(adopted)\)$/)) return null;
  
  // Step 1: Direct display name match
  const d = tryMatchByDisplay(trimmed);
  if (d) return d;
  
  // Step 2: Clean parenthetical metadata suffixes
  let cleaned = trimmed;
  // Strip "(m. YYYY)"
  cleaned = cleaned.replace(/\s*\(m\.\s*\d{4}\)\s*/gi, '').trim();
  // Strip "(deceased)"
  cleaned = cleaned.replace(/\s*\(deceased\)\s*/gi, '').trim();
  // Strip "(adoptive)"
  cleaned = cleaned.replace(/\s*\(adoptive\)\s*/gi, '').trim();
  // Strip "(adopted)"
  cleaned = cleaned.replace(/\s*\(adopted\)\s*/gi, '').trim();
  // Strip "(née ...)"
  cleaned = cleaned.replace(/\s*\(n[ée]e\s[^)]+\)\s*/gi, '').trim();
  // Strip "(3rd wife)", "(first wife)", etc.
  cleaned = cleaned.replace(/\s*\(\d+(?:st|nd|rd|th)\s+(?:wife|husband|child)\)\s*/gi, '').trim();
  // Strip "(brother)", "(sister)"
  cleaned = cleaned.replace(/\s*\((?:brother|sister)\)\s*/gi, '').trim();
  // Strip "(first marriage)"
  cleaned = cleaned.replace(/\s*\(first\s+marriage\)\s*/gi, '').trim();
  // Strip "(all with ...)"
  cleaned = cleaned.replace(/\s*\(all\s+with\s[^)]+\)\s*/gi, '').trim();
  // Strip (1986–?) style year ranges in parentheticals
  cleaned = cleaned.replace(/\s*\(\d{4}.*?\)\s*/g, '').trim();
  // Strip em/en-dash year ranges like "(1802–1891)"
  cleaned = cleaned.replace(/\s*[（(]\d{4}[–—]\d{4}[)）]/g, '').trim();
  // Strip trailing year+question: " (1904–?)"
  cleaned = cleaned.replace(/\s*\(\d{4}[–—]\?\)/g, '').trim();
  // Strip " (~1731–?)" etc
  cleaned = cleaned.replace(/\s*\(~\d{4}[–—]\?\)/g, '').trim();
  // Strip " (of Place)"
  cleaned = cleaned.replace(/\s*\(of\s[^)]+\)/g, '').trim();
  
  if (cleaned !== trimmed) {
    const d2 = tryMatchByDisplay(cleaned);
    if (d2) return d2;
    const n = tryMatchByName(cleaned);
    if (n) return n;
    const s = tryMatchBySlug(cleaned);
    if (s) return s;
    const b = tryMatchByBase(cleaned);
    if (b) return b;
  }
  
  // Step 3: Clean just the year ranges (keep multiple formats)
  let noYears = trimmed.replace(/[（(]\d{4}[–—]\d{4}[)）]/g, '').trim();
  noYears = noYears.replace(/\s*\(\d{4}[–—]\?\)/g, '').trim();
  noYears = noYears.replace(/\s*\(~\d{4}[–—]\?\)/g, '').trim();
  // Also handle em-dash/other separators for birth-only e.g. "(1810–1839)"
  noYears = noYears.replace(/\s*\(\d{4}[–—]\d{4}\)\s*/g, '').trim();
  
  if (noYears !== trimmed) {
    const d3 = tryMatchByDisplay(noYears);
    if (d3) return d3;
    const n3 = tryMatchByName(noYears);
    if (n3) return n3;
    const s3 = tryMatchBySlug(noYears);
    if (s3) return s3;
    const b3 = tryMatchByBase(noYears);
    if (b3) return b3;
  }
  
  // Step 4: For slugs with concatenated years (mangled_slug)
  const slugish = trimmed.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
  
  // Try mangled slug variants
  // Pattern: "elizabeth-beattie-18021891" → split years
  const concatMatch = slugish.match(/^(-[a-z]+)*?([a-z]+)-(\d{4})(\d{4})$/);
  if (concatMatch || slugish.match(/\d{8}$/)) {
    // Try various year splits
    for (let i = 4; i >= 1; i--) {
      if (slugish.length > i) {
        const trySlug = slugish.slice(0, -i);
        if (slugSet.has(trySlug)) return trySlug;
      }
    }
    // Also try: "elizabeth-beattie-18021891" → need to find the name part before years
    // The years are CONCATENATED, so strip all trailing digits
    const noDigits = slugish.replace(/-\d+$/, '');
    if (noDigits !== slugish && slugSet.has(noDigits)) return noDigits;
    
    // Try by base
    const s4 = tryMatchByBase(slugish);
    if (s4) return s4;
  }
  
  // Pattern: "john-telfer-1840-1913" (hyphen-separated years) → "john-telfer-18401913" (concat)
  const hyphenYears = slugish.match(/^(.+?)-(\d{4})-(\d{4})$/);
  if (hyphenYears) {
    const concat = `${hyphenYears[1]}-${hyphenYears[2]}${hyphenYears[3]}`;
    if (slugSet.has(concat)) return concat;
    // Also try just birth year
    const justBirth = `${hyphenYears[1]}-${hyphenYears[2]}`;
    if (slugSet.has(justBirth)) return justBirth;
  }
  
  // Pattern: "john-telfer-18401913" (concat years) → try just birth year
  const concatYears = slugish.match(/^(.+?)-(\d{4})(\d{4})$/);
  if (concatYears) {
    const justBirth = `${concatYears[1]}-${concatYears[2]}`;
    if (slugSet.has(justBirth)) return justBirth;
  }
  
  // Pattern with middle name: "murray-john-telfer-19111982" → "murray-telfer-1911"
  // Or "shirley-edna-telfer-19292017" → "shirley-telfer-1929" or "shirley-telfer-living"
  // Or "francis-charles-telfer-18751954" → "francis-telfer-1875"
  const multiNameSlug = slugish.match(/^([a-z]+)-([a-z]+-[a-z]+-\d+.*)$/);
  if (multiNameSlug) {
    // Keep dropping the second name
    let current = slugish;
    const parts = slugish.split('-');
    for (let i = 1; i < parts.length - 1; i++) {
      // Remove middle name part
      const trySlug = [...parts.slice(0, i), ...parts.slice(i + 1)].join('-');
      if (slugSet.has(trySlug)) return trySlug;
      
      // Also try removing first name
      const trySlug2 = parts.slice(1).join('-');
      if (slugSet.has(trySlug2)) return trySlug2;
    }
  }
  
  // Pattern: "james-telfer-b-1832-scotland" → strip extra text, keep first-last-year
  const extraText = slugish.match(/^([a-z]+-[a-z]+)-[a-z]+-(\d{4})-/);
  if (extraText) {
    const trySlug = `${extraText[1]}-${extraText[2]}`;
    if (slugSet.has(trySlug)) return trySlug;
  }
  
  // Pattern: "james-telfer-17961863" → "james-telfer-1796"
  const birthDeath = slugish.match(/^([a-z]+-[a-z]+)-(\d{4})(\d{4})$/);
  if (birthDeath) {
    const trySlug = `${birthDeath[1]}-${birthDeath[2]}`;
    if (slugSet.has(trySlug)) return trySlug;
  }
  
  // Pattern: "robert-telfer-18031878" → "robert-telfer-1803" or "robert-telfer"
  const baseMatch = slugish.match(/^([a-z]+)-([a-z]+)-\d+.*$/);
  if (baseMatch) {
    const tryBase = `${baseMatch[1]}-${baseMatch[2]}`;
    const matches = byBase[tryBase];
    if (matches && matches.length > 0) {
      // Pick the closest match
      return matches[0];
    }
  }
  
  // Pattern: "daryll-william-telfer" → "daryll-telfer" (middle name)
  const slugParts = slugish.split('-');
  if (slugParts.length >= 3) {
    const f0 = slugParts[0];
    const l0 = slugParts[slugParts.length - 1];
    const tryShort = `${f0}-${l0}`;
    if (slugSet.has(tryShort)) return tryShort;
  }
  
  // Final fallback: strip all numbers and try base
  const baseOnly = slugish.replace(/-\d+.*$/, '');
  if (baseOnly !== slugish && slugSet.has(baseOnly)) return baseOnly;
  
  return null;
}

// --- Process ---

const slugSet2 = new Set(people.map(p => p.slug));
let fixed = 0;
let stillBad = 0;
const stillBadList = [];

people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (!p[field]) return;
    const newVals = [];
    let changed = false;
    
    p[field].forEach(ref => {
      if (slugSet2.has(ref)) {
        newVals.push(ref);
        return;
      }
      
      const fixedRef = fixRef(ref);
      if (fixedRef && fixedRef !== ref) {
        newVals.push(fixedRef);
        changed = true;
        fixed++;
        console.log(`  FIXED: ${p.slug} -> ${field}: "${ref}" → "${fixedRef}"`);
      } else if (fixedRef && fixedRef === ref) {
        newVals.push(ref);
      } else {
        newVals.push(ref);
        stillBad++;
        if (stillBad <= 50) {
          stillBadList.push({ person: p.slug, field, ref });
        }
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
    if (p[field] && Array.isArray(p[field])) {
      p[field] = [...new Set(p[field])];
    }
  });
});

// --- Stats ---
let invalidAfter = 0;
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field]) {
      p[field].forEach(ref => {
        if (!slugSet2.has(ref)) invalidAfter++;
      });
    }
  });
});

console.log(`\n=== RESULTS ===`);
console.log(`Fixed in pass 2: ${fixed}`);
console.log(`Still invalid after: ${invalidAfter}`);

if (stillBadList.length > 0) {
  console.log(`\n=== TOP UNRESOLVED (${stillBadList.length} shown) ===`);
  stillBadList.forEach(n => console.log(`  ${n.person} -> ${n.field}: "${n.ref}"`));
}

// Write
fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log(`\n✅ Written to ${FILE}`);
