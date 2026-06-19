/**
 * Fix invalid relationship references in people.json
 *
 * Invalid refs fall into categories:
 * 1. Display names used as slugs (e.g. "Sheryle Telfer" instead of "sheryle-telfer")
 * 2. Mangled slug formats (e.g. "elizabeth-beattie-18021891" instead of "elizabeth-beattie")
 * 3. Dead refs (entries removed as duplicates)
 * 4. Literal text (e.g. "None (never married)", "Unknown")
 */

import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

// --- Build lookup tables ---

// Display name → slug (exact)
const byDisplayName = {};
// First+Last lowercase → slug
const byName = {};
// Slug variants → slug
const slugVariants = {};
// All slug aliases for fuzzy matching
const allSlugs = new Set(people.map(p => p.slug));

people.forEach(p => {
  // Exact display name match
  if (p.display_name) {
    byDisplayName[p.display_name.toLowerCase()] = p.slug;
    byDisplayName[p.display_name] = p.slug;
  }

  // first_name + last_name combos
  const fn = (p.first_name || '').toLowerCase();
  const ln = (p.last_name || '').toLowerCase();
  if (fn && ln) {
    byName[`${fn} ${ln}`] = p.slug;
  }

  // Slug variants: all possible suffixes for this person
  const slug = p.slug;
  slugVariants[slug] = slug;
  slugVariants[slug.replace(/-living$/, '')] = slug;
  slugVariants[slug.replace(/-\d+$/, '')] = slug;

  // Also map by slug without the trailing birth-year conflict suffix
  // e.g. "elizabeth-telfer-1832-2" → "elizabeth-telfer"
  const noExtraSuffix = slug.replace(/-\d+$/, '');
  if (noExtraSuffix !== slug) {
    slugVariants[noExtraSuffix] = slug;
  }
});

// --- Building additional mappings ---

// For each person, also build truncated slug variants
// e.g. "elizabeth-beattie-18021891" → "elizabeth-beattie" (strip trailing year-digits)
people.forEach(p => {
  const slug = p.slug;

  // Strip trailing year digits
  const noYear = slug.replace(/-\d+$/, '');
  if (noYear !== slug) {
    slugVariants[noYear] = slug;
  }

  // Also the year-only suffix (for slugs like "john-telfer-18401913" that have birth-death)
  const birthDeathMatch = slug.match(/^(.+?)-(\d{4})(\d{4})$/);
  if (birthDeathMatch) {
    slugVariants[`${birthDeathMatch[1]}-${birthDeathMatch[2]}`] = slug;
    slugVariants[`${birthDeathMatch[1]}-${birthDeathMatch[3]}`] = slug;
  }

  // Also try with display name reversed (for "Telfer, John" formats... unlikely but safe)
});

// --- Helpers ---

function extractNameSlug(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Direct slug match
  if (allSlugs.has(trimmed)) return trimmed;

  // Display name match (case-insensitive first, then exact)
  if (byDisplayName[trimmed.toLowerCase()]) return byDisplayName[trimmed.toLowerCase()];
  if (byDisplayName[trimmed]) return byDisplayName[trimmed];

  // Lowercase version
  const lower = trimmed.toLowerCase();

  // Try as lowercase slug
  if (allSlugs.has(lower)) return lower;

  // Strip non-alphanumeric and try
  const cleaned = lower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (allSlugs.has(cleaned)) return cleaned;

  // Try by name
  if (byName[lower]) return byName[lower];
  if (byName[trimmed.toLowerCase()]) return byName[trimmed.toLowerCase()];

  // Handle "First Last" format
  const parts = trimmed.split(/[\s]+/);
  if (parts.length >= 2) {
    const fn = parts[0].toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();
    const nameKey = `${fn} ${ln}`;
    if (byName[nameKey]) return byName[nameKey];

    // Try slug: first-last
    const slugTry = `${fn}-${ln}`;
    if (allSlugs.has(slugTry)) return slugTry;
    if (slugVariants[slugTry]) return slugVariants[slugTry];
  }

  // Handle "Middle Name" format — some refs might have middle names
  // e.g. "John Robert Telfer" → try "john-robert-telfer"
  if (parts.length >= 3) {
    const fn = parts[0].toLowerCase();
    const mn = parts.slice(1, -1).join('-').toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();

    // Try with middle initial
    for (const midTry of [mn, mn[0]]) {
      const slugTry = `${fn}-${midTry}-${ln}`;
      if (allSlugs.has(slugTry)) return slugTry;
    }

    const nameKey = `${fn} ${ln}`;
    if (byName[nameKey]) return byName[nameKey];
  }

  // Handle "Adoptive" suffix — strip "(adoptive)"
  const noAdoptive = trimmed.replace(/\s*\(adoptive\)\s*/i, '').trim();
  if (noAdoptive !== trimmed) {
    return extractNameSlug(noAdoptive);
  }

  // Handle "née" — strip it
  const noNee = trimmed.replace(/\s*\(n[ée]e\s[^)]+\)\s*/i, '').trim();
  if (noNee !== trimmed) {
    return extractNameSlug(noNee);
  }

  // Handle "(m. YYYY)" suffix
  const noMarriage = trimmed.replace(/\s*\(m\.\s*\d{4}\)\s*/i, '').trim();
  if (noMarriage !== trimmed && noMarriage !== trimmed) {
    return extractNameSlug(noMarriage);
  }

  return null;
}

// --- Also build name→slug for "Telfer, John" surname-first format ---
people.forEach(p => {
  const fn = (p.first_name || '').toLowerCase();
  const ln = (p.last_name || '').toLowerCase();
  if (fn && ln) {
    byName[`${ln}, ${fn}`] = p.slug;
  }
});

// --- Add reversed ---
people.forEach(p => {
  const fn = (p.first_name || '').toLowerCase();
  const ln = (p.last_name || '').toLowerCase();
  if (fn && ln && fn !== 'unknown' && ln !== 'unknown') {
    byName[`${fn}-${ln}`] = p.slug;
  }
});

// --- Stats before ---
let totalRefs = 0;
let invalidRefs = 0;
const slugSet = new Set(people.map(p => p.slug));

people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field]) {
      p[field].forEach(ref => {
        totalRefs++;
        if (!slugSet.has(ref)) invalidRefs++;
      });
    }
  });
});
console.log(`Before fix: ${invalidRefs} invalid refs out of ${totalRefs} total`);

// --- Categorize and fix ---
const fixed = { display_name: 0, mangled: 0, literal: 0, not_found: 0 };
const notFound = [];

people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (!p[field]) return;
    const newVals = [];
    let changed = false;

    p[field].forEach(ref => {
      // Check if it's a literal text value like "None", "Unknown"
      const lower = ref.trim().toLowerCase();
      if (['none', 'unknown', 'none (never married)', 'unknown - living', 'unknown - deceased'].includes(lower)) {
        newVals.push(ref);
        return; // Keep as-is (these are metadata, not refs)
      }

      // Already a valid slug
      if (slugSet.has(ref)) {
        newVals.push(ref);
        return;
      }

      // Try to resolve
      const resolved = extractNameSlug(ref);
      if (resolved && resolved !== ref) {
        newVals.push(resolved);
        changed = true;
        if (ref.includes('(') || ref.includes(',')) {
          fixed.mangled++;
        } else if (ref.match(/^[a-z]/)) {
          fixed.mangled++;
        } else {
          fixed.display_name++;
        }
        console.log(`  FIXED: ${p.slug} -> ${field}: "${ref}" → "${resolved}"`);
      } else if (resolved) {
        newVals.push(resolved);
      } else {
        // Could not resolve - keep original but flag
        newVals.push(ref);
        notFound.push({ person: p.slug, field, ref });
        fixed.not_found++;
        console.log(`  !!! NOT FOUND: ${p.slug} -> ${field}: "${ref}"`);
      }
    });

    if (changed) {
      p[field] = newVals;
    }
  });
});

// --- Deduplicate refs after fix ---
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field] && Array.isArray(p[field])) {
      p[field] = [...new Set(p[field])];
    }
  });
});

// --- Stats after ---
let invalidAfter = 0;
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field]) {
      p[field].forEach(ref => {
        if (!slugSet.has(ref)) invalidAfter++;
      });
    }
  });
});

console.log(`\n=== RESULTS ===`);
console.log(`Fixed by display name match: ${fixed.display_name}`);
console.log(`Fixed by mangled slug match: ${fixed.mangled}`);
console.log(`Literals kept as-is: ${fixed.literal}`);
console.log(`Could not resolve: ${fixed.not_found}`);
console.log(`After fix: ${invalidAfter} invalid refs remaining`);

if (notFound.length > 0) {
  console.log(`\n=== UNRESOLVED (${notFound.length}) ===`);
  notFound.forEach(n => console.log(`  ${n.person} -> ${n.field}: "${n.ref}"`));
}

// Write if changes made
const changed = fixed.display_name + fixed.mangled + fixed.literal;
if (changed > 0 || notFound.length > 0) {
  fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
  console.log(`\n✅ Written to ${FILE}`);
} else {
  console.log(`\nℹ️ No changes needed`);
}
