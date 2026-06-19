import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));

// --- Build smarter lookups ---

// Build reverse index: person data by firstname-lastname (no middle)
const bySimpleName = {};
people.forEach(p => {
  const fn = (p.first_name || '').toLowerCase();
  const fn0 = fn ? fn.split(/\s+/)[0] : '';
  const ln = (p.last_name || '').toLowerCase();
  if (fn && ln) {
    bySimpleName[`${fn}|${ln}`] = p.slug;
    bySimpleName[`${fn0}|${ln}`] = p.slug;
  }
});

// Build: display_name_main → slug (e.g. "Elizabeth Beattie" → "elizabeth-beattie")
const byDisplayMain = {};
people.forEach(p => {
  if (p.display_name) {
    // Take the main part (before birth/death years)
    const main = p.display_name.replace(/[（(]\d{4}.*?[)）]/g, '').replace(/[（(]m\..*?[)）]/g, '').replace(/[（(]née.*?[)）]/g, '').trim();
    byDisplayMain[main.toLowerCase()] = p.slug;
    // Also short first two words
    const words = main.toLowerCase().split(/\s+/);
    if (words.length >= 2) {
      byDisplayMain[`${words[0]} ${words[words.length-1]}`] = p.slug;
    }
  }
});

// Year concatenation patterns — try splitting concatenated years
function maybeFixYearConcat(target) {
  // e.g. "elizabeth-beattie-18021891" → try "elizabeth-beattie-1802"
  // Match patterns with 8 consecutive digits (birth+death or birth+birth)
  const m = target.match(/^(.*?)-(\d{4})(\d{4})$/);
  if (m) {
    const base = m[1];
    const y1 = m[2];
    const y2 = m[3];
    
    // Try just the first year
    const try1 = `${base}-${y1}`;
    if (slugSet.has(try1)) return try1;
    
    // Try just the second year
    const try2 = `${base}-${y2}`;
    if (slugSet.has(try2)) return try2;
    
    // Try the combined year (with hyphen)
    const try3 = `${base}-${y1}-${y2}`;
    if (slugSet.has(try3)) return try3;
    
    // Try the base (no year at all)
    if (slugSet.has(base)) return base;
    
    // For names like william-henry-parker, try william-parker
    const parts = base.split('-');
    if (parts.length >= 3) {
      const short = `${parts[0]}-${parts[parts.length-1]}`;
      if (slugSet.has(short)) return short;
    }
  }
  return null;
}

function resolveMangledRef(ref) {
  if (!ref || !slugSet.has(ref)) {
    const resolved = maybeFixYearConcat(ref);
    if (resolved) return resolved;
  }
  return null;
}

// --- Categorize unresolved ---
const unresolved = {};

// Collect invalid refs by person
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (!p[field]) return;
    p[field].forEach(ref => {
      if (slugSet.has(ref)) return;
      // Skip literals
      const lower = ref.trim().toLowerCase();
      if (['none', 'unknown', 'none (never married)', 'unknown - living', 'unknown - deceased', '?', '???', '[unknown]', 'adopted)'].includes(lower)) {
        return;
      }
      
      // Categorize
      let category = 'other';
      if (ref.match(/\(\d{4}.*?\)/)) category = 'name_with_years';
      else if (ref.match(/^\d{4}\D/)) category = 'year_prefix';
      else if (ref.includes('(m. ')) category = 'marriage_date';
      else if (ref.includes('(née')) category = 'nee_format';
      else if (ref.includes('(adopt')) category = 'adoptive';
      else if (ref.includes('(deceased') || ref.includes('(deceased)')) category = 'deceased';
      else if (ref.includes('(3rd') || ref.includes('(adopted')) category = 'parenthetical';
      else if (ref.match(/^[a-z]/) && ref.includes('-')) category = 'mangled_slug';
      else if (ref.match(/^\?/)) category = 'unknown';
      else if (ref.includes(' (') && ref.match(/\(brother\)|\(sister\)|\(first marriage\)|\(all with/)) category = 'metadata_suffix';
      else category = 'display_name';
      
      const key = `${category}:${ref}`;
      unresolved[key] = unresolved[key] || { category, ref, usedBy: [] };
      unresolved[key].usedBy.push(`${p.slug}->${field}`);
    });
  });
});

// Print counts by category
const byCategory = {};
Object.values(unresolved).forEach(u => {
  byCategory[u.category] = (byCategory[u.category] || 0) + u.usedBy.length;
});

console.log('=== Unresolved by category ===');
Object.entries(byCategory).sort((a,b) => b[1]-a[1]).forEach(([cat, count]) => {
  console.log(`  ${cat}: ${count}`);
});

console.log(`\nTotal unique unresolved refs: ${Object.keys(unresolved).length}`);

// --- Try matching name_with_years ---
console.log('\n=== Trying name_with_years match ===');
let fixedYears = 0;
Object.entries(unresolved).filter(([k]) => k.startsWith('name_with_years:')).forEach(([k, u]) => {
  const ref = u.ref;
  // Try to extract just the name part (strip years)
  const nameOnly = ref.replace(/[（(]\d{4}.*?[)）]/g, '').replace(/\([^)]*\)/g, '').replace(/~?\d{4}.*/, '').trim();
  const lower = nameOnly.toLowerCase();
  
  // Look up by display name
  if (byDisplayMain[lower]) {
    fixedYears++;
    console.log(`  MATCH: "${ref}" → ${byDisplayMain[lower]} (via display name "${lower}")`);
    return;
  }
  
  // Try by first+last
  const words = lower.split(/\s+/);
  if (words.length >= 2) {
    const fn = words[0];
    const ln = words[words.length-1];
    const key = `${fn}|${ln}`;
    if (bySimpleName[key]) {
      fixedYears++;
      console.log(`  MATCH: "${ref}" → ${bySimpleName[key]} (via "${fn} ${ln}")`);
      return;
    }
    
    // Try slug
    const slug = `${fn}-${ln}`.replace(/[^a-z0-9-]/g, '');
    if (slugSet.has(slug)) {
      fixedYears++;
      console.log(`  MATCH: "${ref}" → ${slug} (via slug)`);
      return;
    }
  }
  
  console.log(`  NO MATCH: "${ref}" (extracted name: "${lower}")`);
});

console.log(`\nFixed name_with_years: ${fixedYears}`);

// --- Try mangled_slug matching ---
console.log('\n=== Trying mangled_slug match ===');
let fixedMangled = 0;
Object.entries(unresolved).filter(([k]) => k.startsWith('mangled_slug:')).forEach(([k, u]) => {
  const ref = u.ref;
  const resolved = resolveMangledRef(ref);
  if (resolved) {
    fixedMangled++;
    console.log(`  MATCH: "${ref}" → ${resolved}`);
  } else {
    console.log(`  NO MATCH: "${ref}"`);
  }
});

console.log(`\nFixed mangled_slugs: ${fixedMangled}`);
