/**
 * Fix invalid relationship refs in people.json — year-aware, smart matching.
 *
 * Strategy:
 * 1. Build year-indexed lookup: (display_name_lower, birth_year, death_year) → slug
 * 2. For refs with explicit year ranges like "James Telfer (1761–1845)":
 *    - Extract years, find exact year match
 * 3. For refs with mangled concatenated slugs like "james-telfer-17961863":
 *    - Split concatenated years, find matching slug
 * 4. For display-name refs like "Karina Ivory":
 *    - Match by display name or first+last
 * 5. Leave "none", "unknown", "?" pattern, non-Telfer family references as-is
 * 6. Leave "martha-allen-d-1876" style as-is (these resolve internally)
 */

import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));

// ── Build indexes ──

// Slug → person map
const slugMap = {};
// Display name + optional years → slug
// e.g. byExact["james telfer"] = [ {slug, birth, death}, ... ]
// e.g. byExact["james telfer 1761 1845"] = "james-telfer-1761"
const byName = {};  // "first|last" → [slug, ...]

people.forEach(p => {
  slugMap[p.slug] = p;
  
  // Build byName: "james|telfer" → slugs
  const fn = ((p.first_name || '')).toLowerCase().split(/\s+/)[0];
  const ln = ((p.last_name || '')).toLowerCase();
  const key = `${fn}|${ln}`;
  if (!byName[key]) byName[key] = [];
  byName[key].push(p.slug);
  
  // Also full display name (lower)
  if (p.display_name) {
    const dn = p.display_name.toLowerCase().trim();
    const birth = p.birth_year || '';
    const death = p.death_year || '';
    
    // Index by display name alone
    if (!byName['dn:' + dn]) byName['dn:' + dn] = [];
    byName['dn:' + dn].push(p.slug);
    
    // Index by display name + birth + death
    const yearKey = `dn+y:${dn}|${birth}|${death}`;
    if (!byName[yearKey]) byName[yearKey] = [];
    byName[yearKey].push(p.slug);
    
    // Index by display name stripped of years
    const clean = dn.replace(/[（(]\d{4}[–—]\d{4}[)）]/g, '').replace(/\([^)]*\)/g, '').trim();
    if (clean !== dn && clean) {
      if (!byName['dn:' + clean]) byName['dn:' + clean] = [];
      byName['dn:' + clean].push(p.slug);
    }
  }
});

// ── Helpers ──

function stripYears(ref) {
  // Remove year ranges: (1809–1895), (1761–1845), (1840-1913), etc.
  return ref.replace(/[（(]\s*(?:~?)\s*\d{4}\s*[–—]\s*(?:\?|\d{4})\s*[)）]/g, '')
            .replace(/\([^)]*?d\.\s*\d{4}[^)]*\)/g, '')
            .replace(/\(m\.\s*\d{4}\)?/g, '')
            .replace(/\(n[ée]e\s[^)]+\)/g, '')
            .replace(/\(adopted\)/gi, '')
            .replace(/\(adoptive\)/gi, '')
            .replace(/\(deceased\)/gi, '')
            .replace(/\(\d+(rd|st|nd|th)\s+(wife|husband)\)/gi, '')
            .replace(/\(brother\)/gi, '')
            .replace(/\(sister\)/gi, '')
            .replace(/\(first\s+marriage\)/gi, '')
            .replace(/\(all\s+with\s[^)]+\)/gi, '')
            .replace(/\(first\)/gi, '')
            .trim();
}

function extractYears(s) {
  // Extract years from "Name (1810–1839)", "Name (1761–1845)", "Name (1809–1895)"
  const m = s.match(/[（(]~?(\d{4})\s*[–—]\s*(\d{4}|\?)[)）]/);
  if (m) {
    return { birth: parseInt(m[1]), death: m[2] !== '?' ? parseInt(m[2]) : null };
  }
  return null;
}

function tryYearMatch(ref, nameLower) {
  const years = extractYears(ref);
  if (!years) return null;
  
  // Find all slugs with this display name
  // Try "dn:" lookup with clean name
  const clean = stripYears(ref).toLowerCase().trim();
  const dnCandidates = byName['dn:' + clean] || [];
  
  if (dnCandidates.length === 0) {
    // Try by first+last
    const words = clean.split(/\s+/);
    if (words.length >= 2) {
      const fn = words[0];
      const ln = words[words.length - 1];
      const candidates = byName[`${fn}|${ln}`] || [];
      for (const slug of candidates) {
        const p = slugMap[slug];
        if (!p) continue;
        if (p.birth_year == years.birth) return slug;
        if (p.birth_year && years.birth && Math.abs(p.birth_year - years.birth) <= 2) return slug;
      }
    }
    return null;
  }
  
  if (dnCandidates.length === 1) return dnCandidates[0];
  
  // Multiple candidates — find by year
  for (const slug of dnCandidates) {
    const p = slugMap[slug];
    if (!p) continue;
    
    // Check birth year
    if (p.birth_year && p.birth_year == years.birth) {
      if (!years.death || !p.death_year || p.death_year == years.death) return slug;
      // Accept if death is close
      if (years.death && p.death_year && Math.abs(p.death_year - years.death) <= 1) return slug;
    }
  }
  
  // No exact year match — pick closest
  let best = null;
  let bestDiff = Infinity;
  for (const slug of dnCandidates) {
    const p = slugMap[slug];
    if (!p || !p.birth_year) continue;
    const diff = Math.abs(p.birth_year - years.birth);
    if (diff < bestDiff) { bestDiff = diff; best = slug; }
  }
  
  return best;
}

function trySimpleNameMatch(ref) {
  const clean = stripYears(ref).trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  
  // Direct display name match
  const dnMatch = byName['dn:' + lower];
  if (dnMatch && dnMatch.length === 1) return dnMatch[0];
  
  // First+last match
  const words = lower.split(/\s+/);
  if (words.length >= 2) {
    const fn = words[0];
    const ln = words[words.length - 1];
    const candidates = byName[`${fn}|${ln}`] || [];
    
    // If multiple, try to match by first+last+middle
    for (const slug of candidates) {
      const p = slugMap[slug];
      if (!p) continue;
      // Check if full display name matches
      if (p.display_name && p.display_name.toLowerCase().includes(lower)) return slug;
    }
    
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return null; // Ambiguous
  }
  
  return null;
}

function tryMangledSlug(ref) {
  const slugified = ref.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slugified) return null;
  
  // Direct match
  if (slugSet.has(slugified)) return slugified;
  
  // Pattern: concat years "james-telfer-17961863" → drop last 4 digits
  const m = slugified.match(/^(.+)-(\d{4})(\d{4})$/);
  if (m) {
    const withHyphen = `${m[1]}-${m[2]}-${m[3]}`;
    if (slugSet.has(withHyphen)) return withHyphen;
    
    const justBirth = `${m[1]}-${m[2]}`;
    if (slugSet.has(justBirth)) return justBirth;
    
    const noYears = m[1];
    if (slugSet.has(noYears)) return noYears;
    
    // Strip middle names
    const parts = m[1].split('-');
    const f0 = parts[0];
    const l0 = parts[parts.length - 1];
    const shortBirth = `${f0}-${l0}-${m[2]}`;
    if (slugSet.has(shortBirth)) return shortBirth;
  }
  
  // Pattern: hypen years "john-telfer-1840-1913" → concat
  const hm = slugified.match(/^(.+)-(\d{4})-(\d{4})$/);
  if (hm) {
    const concat = `${hm[1]}-${hm[2]}${hm[3]}`;
    if (slugSet.has(concat)) return concat;
    
    const justBirth = `${hm[1]}-${hm[2]}`;
    if (slugSet.has(justBirth)) return justBirth;
  }
  
  // Pattern: extra text "james-telfer-b-1832-scotland"
  const em = slugified.match(/^([a-z]+-[a-z]+)-[a-z]+-(\d{4})-/);
  if (em) {
    const trySlug = `${em[1]}-${em[2]}`;
    if (slugSet.has(trySlug)) return trySlug;
  }
  
  // Pattern: middle name "daryll-william-telfer" → "daryll-telfer"
  const parts = slugified.split('-');
  if (parts.length >= 3) {
    // Drop middle parts
    for (let i = 1; i < parts.length - 1; i++) {
      const withoutMiddle = [...parts.slice(0, i), ...parts.slice(i + 1)].join('-');
      if (slugSet.has(withoutMiddle)) return withoutMiddle;
    }
  }
  
  // Pattern: "william-parker-18931968" → "william-parker"
  const base = slugified.replace(/-\d+.*$/, '');
  if (base !== slugified && slugSet.has(base)) return base;
  
  // Try: just first+last from slugified
  if (parts.length >= 2) {
    const short = `${parts[0]}-${parts[parts.length-1]}`;
    if (slugSet.has(short)) return short;
  }
  
  return null;
}

// ── Process ──

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
      if (!trimmed) { newVals.push(trimmed); return; }
      
      // Already valid
      if (slugSet.has(trimmed)) { newVals.push(trimmed); return; }
      
      // Literal — leave alone
      const lower = trimmed.toLowerCase();
      if (['none', 'unknown', '?', '???', '[unknown]', 'none (never married)', 'unknown - living', 'unknown - deceased', 'adopted)'].includes(lower)) {
        newVals.push(trimmed);
        return;
      }
      
      // Strategy 1: Year-based display name match (most reliable)
      let result = tryYearMatch(trimmed, lower);
      
      // Strategy 2: Simple display name match
      if (!result) result = trySimpleNameMatch(trimmed);
      
      // Strategy 3: Mang-led slug match
      if (!result) result = tryMangledSlug(trimmed);
      
      if (result && result !== trimmed) {
        newVals.push(result);
        changed = true;
        fixed++;
        // console.log(`  ${p.slug} -> ${field}: "${trimmed}" → "${result}"`);
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
let invalidAfter = 0;
const invalids = [];
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (p[field]) {
      p[field].forEach(ref => {
        if (!slugSet.has(ref)) { invalidAfter++; invalids.push(`${p.slug}->${field}: ${ref}`); }
      });
    }
  });
});

console.log(`\n=== RESULTS ===`);
console.log(`Fixed: ${fixed}`);
console.log(`Still invalid: ${invalidAfter}`);
console.log(`\nFirst ${Math.min(invalids.length, 30)} still invalid:`);
invalids.slice(0, 30).forEach(i => console.log(`  ${i}`));

// Write
fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log(`\n✅ Written to ${FILE}`);
