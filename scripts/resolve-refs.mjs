#!/usr/bin/env node
/**
 * resolve-refs.mjs — v3 (fixed lifespan parsing)
 *
 * Resolves name-based references in people.json to proper slugs.
 * Uses contextual disambiguation (birth/death years, parent/child age ranges).
 *
 * Usage: node scripts/resolve-refs.mjs [--write]
 */

import fs from 'fs';

const PEOPLE_JSON = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));

// ── Build slug set ──────────────────────────────
const slugSet = new Set(people.map(p => p.slug));

// ── Build comprehensive lookup indices ───────────

const byDisplay = new Map();           // exact display_name → slug
const byDisplayWithYears = new Map();  // "Display Name (YYYY–YYYY)" → slug
const byName = new Map();              // "first last" → [{slug, birth, death, display}, ...]
const byFullName = new Map();          // "first middle last" → [{slug, birth, death, display}, ...]
const byBirthYear = new Map();         // slug → birth_year
const bySlug = new Map();              // slug → person object

people.forEach(p => {
  bySlug.set(p.slug, p);
  const display = p.display_name?.toLowerCase().trim();
  const short = `${p.first_name} ${p.last_name}`.toLowerCase().trim();
  const full = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').toLowerCase().trim();
  const deathStr = p.death_year || '?';
  
  // Build year-annotated versions for all name forms
  if (p.birth_year) {
    // "Mark Telfer (1877–1946)", "Mark Telfer (1877–living)", etc.
    [short, full, display].filter(Boolean).forEach(nameForm => {
      if (nameForm === short || nameForm === full || nameForm === display) {
        // deduplicate — only add each unique name+year combo once
        const keyLiving = `${nameForm} (${p.birth_year}–living)`;
        const keyUnknown = `${nameForm} (${p.birth_year}–?)`;
        if (!byDisplayWithYears.has(keyLiving)) byDisplayWithYears.set(keyLiving, p.slug);
        if (!byDisplayWithYears.has(keyUnknown)) byDisplayWithYears.set(keyUnknown, p.slug);
        if (p.death_year) {
          const keyDeath = `${nameForm} (${p.birth_year}–${p.death_year})`;
          if (!byDisplayWithYears.has(keyDeath)) byDisplayWithYears.set(keyDeath, p.slug);
        }
      }
    });
  }
  
  byDisplay.set(display, p.slug);
  
  // Store all matches for short names (duplicates)
  if (!byName.has(short)) byName.set(short, []);
  byName.get(short).push({ slug: p.slug, birth: p.birth_year, death: p.death_year, display });
  
  if (full && full !== short) {
    if (!byFullName.has(full)) byFullName.set(full, []);
    byFullName.get(full).push({ slug: p.slug, birth: p.birth_year, death: p.death_year, display });
  }
  
  byBirthYear.set(p.slug, p.birth_year);
});

// ── Helpers ──────────────────────────────────────

function stripLifespan(name) {
  // Matches (1761–1845), (1761–living), (1761–?), (1840-1913), (~1731–?)
  return name.replace(/\s*\([~]?\d{4}\s*[–-]\s*[\d?living-]+\s*\)\s*$/, '').trim();
}

function extractYears(name) {
  // Extract birth from "James Telfer (1761–1845)", "Mark Telfer (1986–living)", "John Telfer (~1731–?)"
  // First try full lifespan: YYYY–YYYY or YYYY–living or YYYY–?
  const match = name.match(/\s*\(~?(\d{4})\s*[–-]\s*(\d{4}|living|\?)\)\s*$/);
  if (match) {
    const death = match[2] === 'living' || match[2] === '?' ? null : parseInt(match[2]);
    return { birth: parseInt(match[1]), death };
  }
  // Just a single year: "John Telfer (1847)"
  const single = name.match(/\s*\(~?(\d{4})\)\s*$/);
  if (single) return { birth: parseInt(single[1]), death: null };
  return null;
}

function stripAnnotation(name) {
  return name.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

function lowerTrim(s) {
  return s.toLowerCase().trim();
}

function pickBestMatch(candidates, context) {
  // context = { subjectBirth, relation }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].slug;
  
  const { subjectBirth, relation } = context || {};
  
  // Parent: must be born BEFORE child, and not too close (< 12 years gap)
  if (relation === 'parent' && subjectBirth != null) {
    const valid = candidates.filter(c => {
      if (c.birth == null) return true; // can't rule out
      return c.birth < subjectBirth && (subjectBirth - c.birth) >= 12;
    });
    if (valid.length === 1) return valid[0].slug;
    // Pick the one with latest birth (closest but before child)
    const sorted = valid.sort((a, b) => (b.birth ?? 0) - (a.birth ?? 0));
    if (sorted.length > 0) return sorted[0].slug;
  }
  
  // Child: must be born AFTER parent — prefer closest birth year
  if (relation === 'child' && subjectBirth != null) {
    const valid = candidates.filter(c => {
      if (c.birth == null) return true;
      return c.birth > subjectBirth;
    });
    if (valid.length === 1) return valid[0].slug;
    if (valid.length > 0) {
      // Sort by proximity to subject — closest birth after parent wins
      valid.sort((a, b) => (a.birth ?? Infinity) - (b.birth ?? Infinity));
      return valid[0].slug;
    }
  }
  
  // Spouse: should be within ~30 years of subject
  if (relation === 'spouse' && subjectBirth != null) {
    const valid = candidates.filter(c => {
      if (c.birth == null) return true;
      return Math.abs(c.birth - subjectBirth) <= 30;
    });
    if (valid.length === 1) return valid[0].slug;
    if (valid.length > 0) return valid[0].slug;
    // If none within 30, try 50
    const wide = candidates.filter(c => {
      if (c.birth == null) return true;
      return Math.abs(c.birth - subjectBirth) <= 50;
    });
    if (wide.length > 0) return wide[0].slug;
  }
  
  // Last resort: pick first
  return candidates[0].slug;
}

function getNamePieces(name) {
  // Try to extract useful name pieces for matching
  const cleaned = stripAnnotation(stripLifespan(name.trim()));
  const lower = lowerTrim(cleaned);
  
  // Handle "née" names: "Amy Ellen Telfer (née Provis)" → try "Amy Ellen Telfer" first
  const neeMatch = cleaned.match(/^(.+?)\s*\(née\s+[^)]+\)/i);
  if (neeMatch) return lowerTrim(neeMatch[1].trim());
  
  return lower;
}

function resolveRef(name, context = null) {
  if (!name || name === '?' || name === '???' || name === 'None' || name === 'None (never married)') return null;
  
  const clean = name.trim();
  
  // Already a slug?
  if (slugSet.has(clean)) return clean;
  
  const lowered = lowerTrim(clean);
  
  // 1. Try with-years lookup (most precise)
  if (byDisplayWithYears.has(lowered)) return byDisplayWithYears.get(lowered);
  
  // 2. Extract years and try with-years for the local form
  const years = extractYears(clean);
  if (years) {
    // For each known name form of this person, try to match with extracted years
    const nameClean = stripLifespan(clean);
    const nameLower = lowerTrim(nameClean);
    
    // Try short name + years
    const skLiving = `${nameLower} (${years.birth}–living)`;
    if (byDisplayWithYears.has(skLiving)) return byDisplayWithYears.get(skLiving);
    const skUnknown = `${nameLower} (${years.birth}–?)`;
    if (byDisplayWithYears.has(skUnknown)) return byDisplayWithYears.get(skUnknown);
    if (years.death) {
      const skDeath = `${nameLower} (${years.birth}–${years.death})`;
      if (byDisplayWithYears.has(skDeath)) return byDisplayWithYears.get(skDeath);
    }
    
    // Fuzzier match: extracted years might differ slightly from actual data
    // e.g. vault says "Robert Telfer (1835–1907)" but actual birth is 1837
    const namePieces = getNamePieces(clean);
    let fuzzyCandidates = [];
    if (byName.has(namePieces)) fuzzyCandidates = fuzzyCandidates.concat(byName.get(namePieces));
    if (byFullName.has(namePieces)) {
      const fnCands = byFullName.get(namePieces);
      fnCands.forEach(c => { if (!fuzzyCandidates.find(x => x.slug === c.slug)) fuzzyCandidates.push(c); });
    }
    
    if (fuzzyCandidates.length > 0) {
      // Exact birth match
      const exact = fuzzyCandidates.find(c => c.birth === years.birth);
      if (exact) return exact.slug;
      // Near match (within 2 years)
      const near = fuzzyCandidates.find(c => c.birth != null && Math.abs(c.birth - years.birth) <= 2);
      if (near) return near.slug;
    }
  }
  
  // 3. Collect all candidates (display + name-based) for context-aware resolution
  const namePieces = getNamePieces(name);
  let candidates = [];
  
  // Always collect byName candidates (first + last name)
  if (byName.has(namePieces)) {
    candidates = candidates.concat(byName.get(namePieces));
  }
  // Also try first+middle+last if different
  if (byFullName.has(namePieces)) {
    const fnCands = byFullName.get(namePieces);
    // Merge without duplicates
    const existingSlugs = new Set(candidates.map(c => c.slug));
    fnCands.forEach(c => { if (!existingSlugs.has(c.slug)) { candidates.push(c); existingSlugs.add(c.slug); } });
  }
  
  // Deduplicate candidates
  const seen = new Set();
  candidates = candidates.filter(c => {
    if (seen.has(c.slug)) return false;
    seen.add(c.slug);
    return true;
  });
  
  if (candidates.length === 0) {
    // No name match — try display_name directly
    if (byDisplay.has(namePieces)) {
      const slug = byDisplay.get(namePieces);
      // Verify with context if possible
      if (years && years.birth) {
        const candBirth = byBirthYear.get(slug);
        if (candBirth && candBirth === years.birth) return slug;
        // Birth year mismatch — it's probably wrong, keep looking
      } else {
        return slug;
      }
    }
  } else if (candidates.length === 1) {
    // Single candidate, verify with years if available
    if (years && years.birth) {
      // If years match, use it
      if (candidates[0].birth === years.birth) return candidates[0].slug;
      // If years don't match, try display match too
      if (byDisplay.has(namePieces)) {
        const dSlug = byDisplay.get(namePieces);
        const dBirth = byBirthYear.get(dSlug);
        if (dBirth === years.birth) return dSlug;
        // Neither matches exact years — prefer display but don't override
        return dSlug;
      }
    }
    return candidates[0].slug;
  } else {
    // Multiple candidates — use context
    // Check if display match matches years
    if (years && years.birth) {
      const exact = candidates.find(c => c.birth === years.birth);
      if (exact) return exact.slug;
    }
    const best = pickBestMatch(candidates, context);
    if (best) return best;
  }
  
  // 6. Try stripping lifespan (for refs where years were already stripped)
  const stripped = stripLifespan(clean);
  if (stripped !== clean) {
    const loweredStripped = lowerTrim(stripped);
    const spName = getNamePieces(stripped);
    
    if (byDisplay.has(spName)) return byDisplay.get(spName);
    if (byFullName.has(spName)) {
      const candidates = byFullName.get(spName);
      const best = pickBestMatch(candidates, context);
      if (best) return best;
    }
    if (byName.has(spName)) {
      const candidates = byName.get(spName);
      const best = pickBestMatch(candidates, context);
      if (best) return best;
    }
  }
  
  // 7. Try stripping annotation like "(adoptive)", "(deceased)", "(3rd wife)"
  const noAnnot = stripAnnotation(clean);
  if (noAnnot !== clean) {
    return resolveRef(noAnnot, context);
  }
  
  // 8. For multi-word names, try first+last
  const words = clean.split(/\s+/);
  if (words.length >= 2) {
    const filtered = words.filter(w => !['of', 'the', 'né', 'née', 'mrs', 'mr', 'dr'].includes(w.toLowerCase()));
    if (filtered.length >= 2) {
      const first = filtered[0];
      const last = filtered[filtered.length - 1];
      const firstLast = `${first} ${last}`.toLowerCase();
      const flPieces = getNamePieces(firstLast);
      if (flPieces !== namePieces && byName.has(flPieces)) {
        const candidates = byName.get(flPieces);
        const best = pickBestMatch(candidates, context);
        if (best) return best;
      }
    }
  }
  
  return null;
}

// ── Main ─────────────────────────────────────────

let totalFixed = 0;
const fields = ['parents', 'children', 'spouses'];
const changes = [];
const selfRefs = [];

people.forEach(p => {
  const subjectBirth = p.birth_year;
  
  fields.forEach(field => {
    if (!p[field] || !Array.isArray(p[field])) return;
    
    const relation = field === 'parents' ? 'parent' : field === 'children' ? 'child' : 'spouse';
    
    const newRefs = p[field].map(ref => {
      if (slugSet.has(ref)) return ref;
      
      const resolved = resolveRef(ref, { subjectBirth, relation });
      
      if (resolved && resolved !== ref) {
        // Check for self-reference
        if (resolved === p.slug) {
          selfRefs.push({ person: p.slug, field, old: ref, new: resolved, relation });
          return ref; // DON'T fix self-references
        }
        totalFixed++;
        changes.push({ person: p.slug, field, old: ref, new: resolved, relation });
        return resolved;
      }
      
      return ref;
    });
    
    p[field] = newRefs;
  });
});

// Print summary
console.log(`\n=== RESOLVED: ${totalFixed} / 558 ===\n`);

if (totalFixed > 0) {
  const byPerson = {};
  changes.forEach(c => {
    if (!byPerson[c.person]) byPerson[c.person] = [];
    byPerson[c.person].push(c);
  });

  for (const [person, refs] of Object.entries(byPerson)) {
    console.log(`📋 ${person} (${refs.length}):`);
    refs.forEach(r => console.log(`   ${r.field}: "${r.old}" → "${r.new}"`));
  }
}

// ── Report self-references ──────────────────────

if (selfRefs.length > 0) {
  console.log(`\n⚠️  SKIPPED ${selfRefs.length} SELF-REFERENCES (not applied):`);
  selfRefs.forEach(r => console.log(`   ${r.person} -> ${r.field}: "${r.old}" (would point to itself)`));
}

// ── Write if --write flag ────────────────────────

const writeFlag = process.argv.includes('--write');
if (writeFlag && totalFixed > 0) {
  fs.writeFileSync(PEOPLE_JSON, JSON.stringify(people, null, 2) + '\n', 'utf-8');
  console.log(`\n✅ Wrote ${PEOPLE_JSON}`);
} else if (totalFixed > 0) {
  console.log(`\nℹ️  Dry-run only. Use --write to apply changes.`);
}

// ── Remaining count ─────────────────────────────

let remaining = 0;
people.forEach(p => {
  fields.forEach(field => {
    if (!p[field]) return;
    p[field].forEach(ref => {
      if (!slugSet.has(ref)) remaining++;
    });
  });
});
console.log(`\n📊 Remaining unresolved: ${remaining}`);
