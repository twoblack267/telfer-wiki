/**
 * Final fixed: Year-aware, ambiguity-safe ref resolver.
 *
 * Rules:
 * 1. Ref WITH year range: extract years, find slug with matching birth/death years
 * 2. Ref WITHOUT years: only match if unambiguous (1 candidate)
 * 3. Old slug format: direct mapping table
 * 4. Name variations: comprehensive lookup via all known forms
 */

import fs from 'fs';

const FILE = './src/data/people.json';
const people = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const slugSet = new Set(people.map(p => p.slug));

// ──────────────────────────────────────────
// Build lookups
// ──────────────────────────────────────────

// first+last group: "James" + "Telfer" → [{slug, birth_year, death_year}]
const byFirstLast = {};
// Track ambiguous (multi-person) first+last groups
const ambiguousFirstLast = new Set();

// old slug → new slug (mapped from known cleanup)
const oldSlugMap = {};

// Pass 1: build byFirstLast groups + oldSlugMap
people.forEach(p => {
  const fn = (p.first_name || '').trim().toLowerCase().split(/\s+/)[0];
  const ln = (p.last_name || '').trim().toLowerCase();
  const sl = p.slug;
  const by = p.birth_year;
  const dy = p.death_year;

  const key = `${fn}|${ln}`;
  if (!byFirstLast[key]) byFirstLast[key] = [];
  byFirstLast[key].push({ slug: sl, birth: by, death: dy });

  const cleanFn = (p.first_name || '').trim().toLowerCase().replace(/\s+/g, '-');
  const cleanLn = (p.last_name || '').trim().toLowerCase();
  const middle = (p.middle_name || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (cleanFn && cleanLn) {
    if (middle) {
      oldSlugMap[`${cleanFn}-${middle}-${cleanLn}`] = sl;
      if (by || dy) oldSlugMap[`${cleanFn}-${middle}-${cleanLn}-${by || ''}${dy || ''}`] = sl;
    }
    if (by) oldSlugMap[`${cleanFn}-${cleanLn}-${by}${dy || ''}`] = sl;
    if (by && dy) oldSlugMap[`${cleanFn}-${cleanLn}-${by}-${dy}`] = sl;
    if (middle && cleanLn !== 'telfer') {
      oldSlugMap[`${cleanFn}-${middle}-${cleanLn}-${by || ''}${dy || ''}`] = sl;
    }
  }
});

// Compute ambiguous groups
Object.entries(byFirstLast).forEach(([k, v]) => { if (v.length > 1) ambiguousFirstLast.add(k); });

// Pass 2: register display names (skip ambiguous first+last)
const byDisplayExact = {};
people.forEach(p => {
  const fn = (p.first_name || '').trim().toLowerCase().split(/\s+/)[0];
  const ln = (p.last_name || '').trim().toLowerCase();
  const dn = (p.display_name || '').trim();
  const sl = p.slug;
  const by = p.birth_year;
  const dy = p.death_year;

  const register = n => { const s = n.trim().toLowerCase(); if (s && !byDisplayExact[s]) byDisplayExact[s] = sl; };

  // "firstname lastname" form — must compute key before display_name check
  const key = `${fn}|${ln}`;

  // Register display name — skip if it's just bare "first last" and that's ambiguous
  if (dn) {
    const bareName = `${p.first_name || ''} ${p.last_name || ''}`.trim().toLowerCase();
    if (dn.trim().toLowerCase() === bareName && ambiguousFirstLast.has(key)) {
      // Skip — bare "James Telfer" when there are 5 James Telfers
    } else {
      register(dn);
    }
  }

  // Only register "firstname lastname" if unambiguous
  if (fn && ln && !ambiguousFirstLast.has(key)) register(`${p.first_name.trim()} ${p.last_name.trim()}`);

  // With years: "Name (1800–1900)"
  if (dn && by) register(`${dn.replace(/\s*\(.*\)\s*/g, '').trim()} (${by}–${dy || '?'})`);
});

// ──────────────────────────────────────────
// Helper: extract years from name string
// ──────────────────────────────────────────
function extractYears(s) {
  // "(1761–1845)", "(~1731–?)", "(1847–1923)" (note: hyphen, not em-dash too)
  const m = s.match(/[（(]~?(\d{4})\s*[–—-]\s*(\d{0,4}|\?)\s*[）)]/);
  if (m) return { birth: parseInt(m[1]), death: m[2] !== '?' && m[2] ? parseInt(m[2]) : null, text: m[0] };
  return null;
}

// ──────────────────────────────────────────
// Helper: strip years from name string
// ──────────────────────────────────────────
function stripYears(s) {
  return s.replace(/\s*[（(][^）)]*[）)]\s*/g, '').replace(/\s+/g, ' ').trim();
}

// ──────────────────────────────────────────
// Core resolver
// ──────────────────────────────────────────
function resolve(ref, contextSlug) {
  const trimmed = ref.trim();
  if (!trimmed || slugSet.has(trimmed)) return trimmed;

  // ── 1. Direct old-slug lookup ──
  if (oldSlugMap[trimmed.toLowerCase()]) return oldSlugMap[trimmed.toLowerCase()];

  // ── 2. Years present — extract and use for disambiguation ──
  const years = extractYears(trimmed);
  if (years) {
    const rawName = stripYears(trimmed);
    // Check if display name + years is exact match
    const withYears = `${rawName} (${years.birth}–${years.death || '?'})`;
    const exact = withYears.trim().toLowerCase();
    if (byDisplayExact[exact]) return byDisplayExact[exact];

    // Try first+last matching with year
    const words = rawName.split(/\s+/).filter(w => w);
    if (words.length >= 2) {
      const fn = words[0].toLowerCase();
      const ln = words[words.length - 1].toLowerCase();
      const key = `${fn}|${ln}`;
      const candidates = byFirstLast[key];
      if (candidates) {
        // Try birth year match
        const byMatch = candidates.find(c => c.birth === years.birth);
        if (byMatch) return byMatch.slug;
        // Try death year match
        if (years.death) {
          const dyMatch = candidates.find(c => c.death === years.death);
          if (dyMatch) return dyMatch.slug;
        }
        // Close birth year (±1)
        const close = candidates.find(c => c.birth && Math.abs(c.birth - years.birth) <= 1);
        if (close) return close.slug;
      }

      // Also try with "Telfer" appended (child ref without surname)
      if (words.length >= 2 && words[words.length - 1].toLowerCase() !== 'telfer') {
        const key2 = `${fn}|telfer`;
        const cand2 = byFirstLast[key2];
        if (cand2) {
          const byMatch2 = cand2.find(c => c.birth === years.birth);
          if (byMatch2) return byMatch2.slug;
        }
      }
    }

    // With years but couldn't resolve → leave as-is (safety)
    return null;
  }

  // ── 3. No years — match by display or first+last (unambiguous only) ──
  const rawName = stripYears(trimmed);
  const lower = rawName.toLowerCase();

  // Direct display name match
  if (byDisplayExact[lower]) return byDisplayExact[lower];

  // Strip parenthetical metadata and retry
  const cleaned = rawName
    .replace(/\s*\(m\.\s*\d{4}\)\s*/gi, '')
    .replace(/\s*\(née\s+[^)]+\)\s*/gi, '')
    .replace(/\s*\(adopted\)\s*/gi, '')
    .replace(/\s*\(adoptive\)\s*/gi, '')
    .replace(/\s*\(deceased\)\s*/gi, '')
    .replace(/\s*\(3rd\s+\w+\)\s*/gi, '')
    .replace(/\s*\(brother\)\s*/gi, '')
    .replace(/\s*\(first\s+marriage\)\s*/gi, '')
    .replace(/\s*\(b\.\s*[^)]+\)\s*/gi, '')
    .replace(/\s*\(of\s+[^)]+\)\s*/gi, '')
    .trim()
    .toLowerCase();
  if (cleaned !== lower && byDisplayExact[cleaned]) return byDisplayExact[cleaned];

  // First+last match — only if 1 candidate
  const words = rawName.split(/\s+/).filter(w => w);
  if (words.length >= 2) {
    const fn = words[0].toLowerCase();
    const ln = words[words.length - 1].toLowerCase();
    const key = `${fn}|${ln}`;
    const candidates = byFirstLast[key];
    if (candidates && candidates.length === 1) return candidates[0].slug;
  }

  // ── 4. (née Telfer) format ──
  const neeMatch = trimmed.match(/^(.+?)\s*\(née\s+Telfer\)\s*$/i);
  if (neeMatch) {
    const rawName2 = neeMatch[1].trim();
    const w2 = rawName2.split(/\s+/).filter(w => w);
    if (w2.length >= 1) {
      const fn2 = w2[0].toLowerCase();
      const key2 = `${fn2}|telfer`;
      const c2 = byFirstLast[key2];
      if (c2 && c2.length === 1) return c2[0].slug;
    }
  }

  // ── 5. "Name (Telfer)" via paren content ──
  const parenContent = trimmed.match(/^([A-Za-z\s'-]+)\s*\([^)]+\)$/);
  if (parenContent) {
    const before = parenContent[1].trim().toLowerCase();
    if (byDisplayExact[before]) return byDisplayExact[before];
    const bw = before.split(/\s+/);
    if (bw.length >= 2) {
      const key = `${bw[0]}|${bw[bw.length-1]}`;
      const c = byFirstLast[key];
      if (c && c.length === 1) return c[0].slug;
      // Try with Telfer
      if (bw[bw.length-1] !== 'telfer') {
        const key2 = `${bw[0]}|telfer`;
        const c2 = byFirstLast[key2];
        if (c2 && c2.length === 1) return c2[0].slug;
      }
    }
  }

  return null;
}

// ──────────────────────────────────────────
// Process all people
// ──────────────────────────────────────────
let fixed = 0;
let stillBad = 0;
const fixes = [];
const remaining = [];

people.forEach(p => {
  ['parents', 'spouses', 'children'].forEach(field => {
    if (!p[field]) return;
    const newVals = [];
    let changed = false;

    p[field].forEach(ref => {
      const result = resolve(ref, p.slug);
      if (result && slugSet.has(result) && result !== ref.trim()) {
        newVals.push(result);
        changed = true;
        fixed++;
        fixes.push(`${p.slug}->${field}: "${String(ref).trim()}" → "${result}"`);
      } else if (result && slugSet.has(result) && result === ref.trim()) {
        newVals.push(result);
        fixed++;
      } else {
        newVals.push(ref);
        stillBad++;
        remaining.push(`${p.slug}->${field}: ${ref}`);
      }
    });

    if (changed) p[field] = [...new Set(newVals)];
  });
});

console.log(`=== RESULTS ===`);
console.log(`Fixed: ${fixed}`);
console.log(`Still invalid: ${stillBad}`);
console.log(`\nFixes (${fixes.length}):`);
fixes.forEach(l => console.log(`  ${l}`));
console.log(`\nRemaining (${remaining.length}):`);
remaining.forEach(r => console.log(`  ${r}`));

fs.writeFileSync(FILE, JSON.stringify(people, null, 2) + '\n');
console.log(`\n✅ Written`);
