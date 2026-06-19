/**
 * v6: Comprehensive final pass for remaining 176 refs.
 *
 * Patterns:
 * 1. Child refs without surname: "Esther Jane (1834–1909)" → "esther-jane-telfer"
 * 2. Ambiguous base slugs: "adam-telfer", "james-telfer" → context-based matching
 * 3. Parenthetical metadata: "(m. 1910)", "(née Telfer)", "(adopted)"
 * 4. One-name refs: "Margaret Wright", "Betty Hutton"
 * 5. née / married-name refs: "Alma Tressy Cullen (née Telfer)" → "alma-tressy-telfer"
 */

import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));

// Build comprehensive lookup: first+last → [slugs], display_name → slug, first-name → [slugs]
const byFirstLast = {};
const byDisplay = {};
const byFirstOnly = {};  // for refs without surname

people.forEach(p => {
  const fn = (p.first_name || '').toLowerCase().split(/\s+/)[0];
  const ln = (p.last_name || '').toLowerCase();
  const fullName = `${fn} ${ln}`;
  const key = `${fn}|${ln}`;
  if (!byFirstLast[key]) byFirstLast[key] = [];
  byFirstLast[key].push({slug: p.slug, birth: p.birth_year, death: p.death_year, person: p});
  
  if (p.display_name) byDisplay[p.display_name.toLowerCase()] = p.slug;
  
  if (!byFirstOnly[fn]) byFirstOnly[fn] = [];
  byFirstOnly[fn].push({slug: p.slug, birth: p.birth_year, full: fullName});
});

function pickByContext(candidates, contextSlug) {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].slug;
  
  const ctx = people.find(p => p.slug === contextSlug);
  if (!ctx || !ctx.birth_year) return candidates[0].slug;
  
  // For parents: pick someone older
  const older = candidates.filter(c => c.birth && c.birth < ctx.birth_year - 10);
  if (older.length === 1) return older[0].slug;
  
  // For spouses: pick closest in age
  const closest = candidates.reduce((best, c) => {
    if (!c.birth) return best;
    const diff = Math.abs(c.birth - ctx.birth_year);
    return (!best.diff || diff < best.diff) ? {slug: c.slug, diff} : best;
  }, {});
  if (closest.slug) return closest.slug;
  
  return candidates[0].slug;
}

let fixed = 0;
const stillBad = [];

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
      let words = [];
      const clean = trimmed;
      
      // ── A. Strip parenthetical metadata ──
      // "(m. 1910)", "(née Telfer)", "(adopted)", "(adoptive)", "(deceased)", "(b. S.A.)", "(b. Burra S.A.)"
      // "(3rd wife)", "(brother)", "(first marriage)"
      const stripMeta = clean
        .replace(/\s*\(m\.\s*\d{4}\)\s*/gi, '')
        .replace(/\s*\(née\s+[^)]+\)\s*/gi, '')
        .replace(/\s*\(adopted\)\s*/gi, '')
        .replace(/\s*\(adoptive\)\s*/gi, '')
        .replace(/\s*\(deceased\)\s*/gi, '')
        .replace(/\s*\([^)]*-?born\)\s*/gi, '')
        .replace(/\s*\(b\.\s*[^)]+\)\s*/gi, '')
        .replace(/\s*\(3rd\s+\w+\)\s*/gi, '')
        .replace(/\s*\(brother\)\s*/gi, '')
        .replace(/\s*\(first\s+marriage\)\s*/gi, '')
        .replace(/\s*\(of\s+[^)]+\)\s*/gi, '')  // "(of Castleton)"
        .trim();
      
      // ── B. Handle "(Telfer)" suffix (parenthetical in name) ──
      const telferSuffix = stripMeta.replace(/\s*\(Telfer\)\s*/gi, '');
      
      // ── C. Strip years "(1810–1839)" or "(~1834–)" ──
      const stripYears = telferSuffix
        .replace(/\s*\(~?\d{4}\s*[–—-]\s*\d{0,4}\??\)\s*/g, '')
        .replace(/\s*\(~\d{4}\s*[–—]?\s*\)\s*/g, '')  // "(~1834–)"
        .replace(/\s*\(\d{4}\s*[–—]?\s*\)\s*/g, '')   // "(1834–)"
        .replace(/\s*\(\d{4}[–—]\?\)\s*/g, '')         // "(1878–?)"
        .trim();
      
      // Also extract years for disambiguation
      const yearM = stripMeta.match(/(\d{4})[–—]\d{4}/);
      const refBirthYear = yearM ? parseInt(yearM[1]) : null;
      
      // ── 1. Direct display-name match ──
      const cleaned = stripYears.toLowerCase();
      if (byDisplay[cleaned]) {
        result = byDisplay[cleaned];
      }
      
      // ── 2. née pattern: "Name (née Telfer)" → extract Telfer name ──
      if (!result) {
        const neeMatch = clean.match(/^([A-Za-z\s'-]+)\(née\s+([^)]+)\)/i);
        if (neeMatch) {
          const birthName = neeMatch[2].trim();
          const fn = birthName.toLowerCase().split(/\s+/)[0];
          const ln = 'Telfer';
          const key = `${fn}|telfer`;
          if (byFirstLast[key]) {
            result = pickByContext(byFirstLast[key], p.slug);
          }
        }
      }
      
      // ── 3. "Name Telfer (Thomson)" → ignore '(Thomson)', match as "Name Telfer" ──
      if (!result && clean.match(/^([A-Za-z\s]+)\s*\([^)]*\)$/)) {
        const parenContent = clean.match(/^(.+?)\s*\([^)]+\)$/);
        if (parenContent) {
          const beforeParen = parenContent[1].trim().toLowerCase();
          if (byDisplay[beforeParen]) {
            result = byDisplay[beforeParen];
          }
        }
      }
      
      // ── 4. Full name without years ──
      if (!result) {
        words = stripYears.split(/\s+/).filter(w => w);
        if (words.length >= 2) {
          const fn = words[0].toLowerCase();
          const ln = words[words.length - 1].toLowerCase();
          const key = `${fn}|${ln}`;
          if (byFirstLast[key]) {
            if (byFirstLast[key].length === 1) {
              result = byFirstLast[key][0].slug;
            } else if (refBirthYear) {
              // Use year to disambiguate
              const match = byFirstLast[key].find(c => c.birth === refBirthYear);
              if (match) result = match.slug;
            } else {
              result = pickByContext(byFirstLast[key], p.slug);
            }
          }
        }
      }
      
      // ── 5. Child refs without surnames: "Esther Jane (1834–1909)" → assume Telfer ──
      if (!result && words && words.length >= 2) {
        // Try appending "Telfer"
        const fn = words[0].toLowerCase();
        const ln = 'telfer';
        const key = `${fn}|telfer`;
        if (byFirstLast[key]) {
          if (byFirstLast[key].length === 1) {
            result = byFirstLast[key][0].slug;
          } else if (refBirthYear) {
            const match = byFirstLast[key].find(c => c.birth === refBirthYear);
            if (match) result = match.slug;
          }
        }
      }
      
      // ── 6. One word refs: "avis", "shirley-edna" → try as Telfer child ──
      if (!result && /^[a-z][a-z-]+$/.test(clean)) {
        // It's already slug-like
        const wordsClean = clean.split('-');
        if (wordsClean.length >= 1) {
          // Try as "word Telfer"
          const fn = wordsClean[0].toLowerCase();
          const key = `${fn}|telfer`;
          if (byFirstLast[key]) {
            result = pickByContext(byFirstLast[key], p.slug);
          } else {
            // Try without middle name
            const key2 = `${wordsClean[0]}|${wordsClean[wordsClean.length-1]}`;
            if (byFirstLast[key2]) result = byFirstLast[key2][0].slug;
          }
        }
      }
      
      // ── 7. "shirley-telfer" → disambiguate ──
      if (!result && /^[a-z-]+-telfer$/.test(clean)) {
        const fn = clean.replace(/-telfer$/, '').split('-')[0];
        const key = `${fn}|telfer`;
        if (byFirstLast[key]) {
          result = pickByContext(byFirstLast[key], p.slug);
        }
      }
      
      // ── 8. Handle BAKER family ──
      if (!result) {
        // "Sophia Baker" → "sophia-baker"
        // "William John Baker" → "william-baker"? Check!
        const bakerMap = { 'sophia baker': null, 'william john baker': null };
        if (bakerMap[cleaned] !== undefined) {
          // Check if they exist
          const bakerCheck = people.find(p => p.display_name && p.display_name.toLowerCase() === cleaned);
          if (bakerCheck) result = bakerCheck.slug;
        }
      }
      
      // ── 9. david-parker-18221888 → david-parker ──
      if (!result) {
        const concatYear = clean.match(/^(.+?)-(\d{4})(\d{4})$/);
        if (concatYear) {
          const base = concatYear[1];
          if (slugSet.has(base)) result = base;
        }
      }
      
      // ── 10. "shirley-telfer" → shirley-telfer-1929 ──
      if (!result) {
        const shirleyRe = clean.match(/^shirley-?telfer$/i);
        if (shirleyRe) {
          const shirleys = people.filter(p => 
            p.display_name && p.display_name.toLowerCase().includes('shirley') && 
            p.last_name === 'Telfer');
          if (shirleys.length === 1) result = shirleys[0].slug;
          else if (shirleys.length > 1 && p.birth_year) {
            const match = shirleys.find(s => s.birth_year && s.birth_year > p.birth_year - 40 && s.birth_year < p.birth_year + 40);
            if (match) result = match.slug;
            else result = shirleys[0].slug;
          }
        }
      }
      
      if (result && slugSet.has(result) && result !== trimmed) {
        newVals.push(result);
        changed = true;
        fixed++;
        console.log(`  FIX: ${p.slug}->${field}: "${trimmed}" → "${result}"`);
      } else if (result && result === trimmed) {
        newVals.push(result);
        fixed++;
      } else {
        newVals.push(trimmed);
      }
    });
    
    if (changed) p[field] = newVals;
  });
});

// Deduplicate
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(f => {
    if (Array.isArray(p[f])) p[f] = [...new Set(p[f])];
  });
});

// Final count
const finalSlugs = new Set(people.map(p => p.slug));
people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(f => {
    if (p[f]) p[f].forEach(ref => {
      if (!finalSlugs.has(ref)) stillBad.push(`${p.slug}->${f}: ${ref}`);
    });
  });
});

console.log(`\n=== RESULTS ===`);
console.log(`People: ${people.length}`);
console.log(`Fixed this pass: ${fixed}`);
console.log(`Still invalid: ${stillBad.length}`);

// Group by category
const cats = {};
stillBad.forEach(s => {
  const ref = s.split(': ')[1] || s;
  let cat = 'other';
  if (/^(Unknown|None|deceased|\?|\?\?\?|\[unknown\])/i.test(ref)) cat = 'placeholder';
  else if (/(m\.\s*\d{4})/.test(ref)) cat = 'spouse-married-meta';
  else if (/(née\s+\w+)/.test(ref)) cat = 'nee-name';
  else if (/^[a-z-]+$/.test(ref) && !ref.includes(' ')) cat = 'slug-ref';
  else if (/\d{4}[–—]\d/.test(ref)) cat = 'name-with-years';
  else cat = 'name-only';
  if (!cats[cat]) cats[cat] = [];
  cats[cat].push(s);
});

console.log(`\nBy category:`);
Object.entries(cats).forEach(([cat, items]) => {
  console.log(`  ${cat}: ${items.length}`);
  items.slice(0, 3).forEach(i => console.log(`    ${i}`));
  if (items.length > 3) console.log(`    ... +${items.length - 3} more`);
});

fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log(`\n✅ Written`);
