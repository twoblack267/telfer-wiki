#!/usr/bin/env node
/**
 * build-relationship-graph.mjs
 * Resolves relationships from people.json → parents/children/spouses/siblings arrays
 * Creates adjacency lists for tree rendering
 *
 * Run: node scripts/build-relationship-graph.mjs
 * Input: src/data/people.json
 * Output: src/data/relationship-graph.json, updates people.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PEOPLE_PATH = path.resolve(__dirname, '../src/data/people.json');
const GRAPH_PATH = path.resolve(__dirname, '../src/data/relationship-graph.json');

// ─── Load Data ──────────────────────────────────────────────────────────────

const people = JSON.parse(fs.readFileSync(PEOPLE_PATH, 'utf-8'));
const slugToPerson = new Map(people.map(p => [p.slug, p]));

console.log(`📚 Loaded ${people.length} people`);

// ─── Build Slug Index (case-insensitive, fuzzy) ──────────────────────────────

// Primary index: exact slug match
const slugIndex = new Map(people.map(p => [p.slug.toLowerCase(), p.slug]));

// Secondary index: display name without dates
const nameIndex = new Map();
function setPrefersComplete(key, slug) {
  // A bare "First Last" name resolves safely ONLY when it maps to a single,
  // well-defined person. When multiple DISTINCT people share the name (e.g.
  // William Telfer 1802 / 1811 / 1841 / 1880), leave the key unset (ambiguous)
  // so a bare reference resolves to nothing rather than the WRONG person.
  const existing = nameIndex.get(key);
  if (existing === AMBIGUOUS) return;
  if (!existing) { nameIndex.set(key, slug); return; }
  if (existing === slug) return; // same person, ignore

  const existingPerson = slugToPerson.get(existing);
  const newPerson = slugToPerson.get(slug);
  const existingHasYear = !!(existingPerson && existingPerson.birth_year);
  const newHasYear = !!(newPerson && newPerson.birth_year);

  // Two DIFFERENT year-bearing people with the same bare name → genuinely
  // ambiguous. A bare reference can't pick between them. Mark as ambiguous.
  if (existingHasYear && newHasYear) {
    nameIndex.set(key, AMBIGUOUS);
    return;
  }
  // A year-less stub collides with a dated record → prefer the dated one.
  if (newHasYear && !existingHasYear) {
    nameIndex.set(key, slug);
    return;
  }
  // Existing is year-bearing, new is a stub → keep existing, ignore stub.
  if (existingHasYear && !newHasYear) {
    return;
  }
  // Both year-less stubs with the same name → ambiguous too.
  nameIndex.set(key, AMBIGUOUS);
}
const AMBIGUOUS = '__ambiguous__';
for (const person of people) {
  const name = person.id.toLowerCase(); // id has clean name
  if (!nameIndex.has(name)) nameIndex.set(name, person.slug);
  // Also try first + last name
  const parts = person.id.split(' ');
  if (parts.length >= 2) {
    const fn = parts[0].toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();
    setPrefersComplete(`${fn} ${ln}`, person.slug);
  }
}

// ─── Resolve Names to Slugs ──────────────────────────────────────────────────

function resolveNameToSlug(name, sourceSlug) {
  if (!name || name === '?' || name.toLowerCase() === 'unknown') return null;
  if (name.match(/^\(?\d{4}[\-–]\d{4}\)?$/)) return null;
  if (name.match(/^(Self|Spouse|Father|Mother|Children|Siblings)$/i)) return null;

  // Extract clean name (remove dates in parens)
  const cleanName = name.replace(/[\(（]\d{4}[\-–]\d{2,4}.{0,2}\d{0,4}[\)）]/g, '').replace(/\s*\([^)]+\)$/, '').trim();

  // Extract birth/death years from the reference if present, e.g.
  // "William Telfer (1802–1850)" or "William Telfer (1802)". Use them to
  // disambiguate between same-named people reliably.
  // Handle open-ended ranges like "Robert Telfer (1803–?)" (unknown death) and
  // "Adam Telfer (1799–?)": the 4-digit first group is the birth year. A single
  // bare `(1803)` is also a birth year.
  const yearsMatch = name.match(/(\d{4})\s*[\-–]\s*(\d{4})/);
  let refBirth = null, refDeath = null;
  if (yearsMatch) {
    refBirth = parseInt(yearsMatch[1], 10);
    refDeath = parseInt(yearsMatch[2], 10);
  } else {
    // Open-ended range "1803–?" or "1803–": birth year is the first 4-digit group.
    const openRange = name.match(/\(\s*(\d{4})\s*[\-–]\s*\?/);
    if (openRange) refBirth = parseInt(openRange[1], 10);
    else {
      const singleYear = name.match(/\(\s*(\d{4})\s*\)/);
      if (singleYear) refBirth = parseInt(singleYear[1], 10);
    }
  }

  // 1b) If the reference CARRIED years, that year disambiguation is authoritative.
  // It MUST take priority over a bare same-name slug match, so a person with the
  // ref's birth/death years is preferred — and if no such person exists, the ref is
  // null (do NOT fall through to a different-generation same-name record).
  if (refBirth) {
    // Collect every same-name candidate FIRST, then score the match. Death-year
    // matching must be a TIEBREAKER, not an early return: several same-named
    // Telfers share death years (e.g. James Telfer b1761 d1845 AND James Telfer
    // b1832 d1845), so `if (death_year === refDeath) return ...` grabbed whichever
    // appeared first in list order and wired a wrong-generation sibling/parent/
    // child. Only a *unique* same-name+death-year candidate is safe by death alone.
    const cleanedId = cleanName.toLowerCase();
    const candidates = people.filter((p) => p.id.toLowerCase() === cleanedId);

    // Exact both-years match is unequivocal.
    if (refDeath) {
      const exact = candidates.find((p) => p.birth_year === refBirth && p.death_year === refDeath);
      if (exact) return exact.slug;
    }
    // Birth-year match.
    const byBirth = candidates.filter((p) => p.birth_year === refBirth);
    if (byBirth.length === 1) return byBirth[0].slug;
    if (byBirth.length > 1) {
      // Same name + same birth year but conflicting deaths — genuinely ambiguous.
      if (refDeath) {
        const byBoth = byBirth.find((p) => p.death_year === refDeath);
        if (byBoth) return byBoth.slug;
      }
      return null;
    }
    // No birth-year match. Fall back to death-year ONLY if unique among same-name
    // candidates — otherwise we'd guess wrong generation.
    if (refDeath) {
      const byDeath = candidates.filter((p) => p.death_year && p.death_year === refDeath);
      if (byDeath.length === 1) return byDeath[0].slug;
      if (byDeath.length > 1) return null;
    }
    // GUARD (26 Aug 2026): a year-carrying ref matching NO record with those years
    // must NOT short-circuit to an exact bare-slug match on a DIFFERENT generation.
    // That unsafe fallback wired cross-branch false parents (e.g. `David Parker
    // (1856–1906)` -> david-parker 1822; Janet Dunlop 1811 as parent of John Lawrie
    // 1810 / Alexander Lawrie 1776; Margaret Wright 1810 as child of Adam 1842).
    return null;
  }

  // 1) Exact slug match (slugified clean name) — only safe when the ref carries no
  // years, because a bare slug match ignores generations entirely.
  const slugified = slugify(cleanName);
  if (slugIndex.has(slugified)) return slugIndex.get(slugified);

  // 2) Exact name match
  const exactKey = cleanName.toLowerCase();
  const exactVal = nameIndex.get(exactKey);
  if (exactVal === AMBIGUOUS) return null;
  if (nameIndex.has(exactKey)) return exactVal;

  // 3) Fuzzy: first + last name (only safe when unambiguous)
  const parts = cleanName.split(' ');
  if (parts.length >= 2) {
    const fn = parts[0].toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();
    const key = `${fn} ${ln}`;
    const fuzzyVal = nameIndex.get(key);
    if (fuzzyVal === AMBIGUOUS) return null;
    if (nameIndex.has(key)) return fuzzyVal;
  }

  // 4) Partial match on display_name
  for (const person of people) {
    if (person.id.toLowerCase() === cleanName.toLowerCase()) return person.slug;
  }

  return null;
}

function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Initialize Edge Maps ────────────────────────────────────────────────────

const parentEdges = new Map();    // childSlug -> Set(parentSlug)
const childEdges = new Map();     // parentSlug -> Set(childSlug)
const spouseEdges = new Map();    // slug -> Set(spouseSlug)
const siblingEdges = new Map();   // slug -> Set(siblingSlug)

for (const person of people) {
  const slug = person.slug;
  parentEdges.set(slug, new Set());
  childEdges.set(slug, new Set());
  spouseEdges.set(slug, new Set());
  siblingEdges.set(slug, new Set());
}

// ─── Deduplicate Parents: Keep Only Biologically Plausible ────────────────────

// Some people (esp. with common names like "John Telfer") end up with multiple
// parent candidates from stub merging. Keep only the parent(s) whose birth year
// is 15-45 years before the child's birth year.

function deduplicateParents(people, parentEdges) {
  const slugToPerson = new Map(people.map(p => [p.slug, p]));
  let removed = 0;

  for (const [childSlug, parents] of parentEdges.entries()) {
    if (parents.size <= 2) continue; // At most 2 biological parents

    const child = slugToPerson.get(childSlug);
    if (!child?.birth_year) {
      // Child has no birth year — we can't judge age plausibility. But we CAN
      // still drop year-less parent stubs (unreliable fuzzy matches) when the
      // child also has been assigned a year-bearing parent. Keeps real parents,
      // removes poisoned stub fusions like a modern "Penny" grafted onto an
      // 1884-born ancestor.
      const datedParents = [...parents].filter(p => slugToPerson.get(p)?.birth_year);
      const stubParents = [...parents].filter(p => !slugToPerson.get(p)?.birth_year);
      if (datedParents.length > 0 && stubParents.length > 0) {
        stubParents.forEach(p => parents.delete(p));
        removed += stubParents.length;
      }
      continue;
    }

    const plausible = [];
    const noBirthYear = [];
    for (const parentSlug of parents) {
      const parent = slugToPerson.get(parentSlug);
      if (!parent?.birth_year) {
        noBirthYear.push(parentSlug);
        continue;
      }
      const diff = child.birth_year - parent.birth_year;
      if (diff >= 15 && diff <= 45) {
        plausible.push(parentSlug);
      }
      // Also keep if diff < 15 (too young to be parent) or diff > 45 (too old) - flag as implausible
    }

    // A living person cannot be the parent of a deceased person. This catches
    // year-less fusions (e.g. a modern "Penny Telfer" grafted onto an 1884-born
    // ancestor) that age logic alone can't reject when every candidate parent
    // is also year-less.
    if (child.is_living === false) {
      const livingParents = [...parents].filter(
        p => slugToPerson.get(p)?.is_living === true
      );
      if (livingParents.length < parents.size) {
        livingParents.forEach(p => parents.delete(p));
        removed += livingParents.length;
      }
    }

    // If we have plausible parents, remove any parents with no birth year (stubs)
    // Also remove implausible parents (too young/old)
    if (plausible.length > 0) {
      const toRemove = [...noBirthYear];
      for (const parentSlug of parents) {
        const parent = slugToPerson.get(parentSlug);
        if (parent?.birth_year) {
          const diff = child.birth_year - parent.birth_year;
          if (diff < 15 || diff > 50) { // 50 is more generous upper bound
            toRemove.push(parentSlug);
          }
        }
      }
      if (toRemove.length > 0 && toRemove.length < parents.size) {
        toRemove.forEach(p => parents.delete(p));
        removed += toRemove.length;
      }
    }
  }
  if (removed > 0) console.log(`🧹 Deduplicated parents: removed ${removed} implausible links`);
}

let resolved = 0, unresolved = 0;

// Add a parent->child edge only if it won't create a mutual-claim 2-cycle where
// one person claims the other as BOTH parent and child (the signature of a
// bare-name collision across generations). When a mutual claim exists, keep the
// direction that is biologically plausible (parent older than child by a
// reasonable margin); if neither direction is checkable (no years), keep the
// newly-added direction.
function addParentChild(parentSlug, childSlug, sourceSlug) {
  // If child already has this parent, nothing to do.
  if (parentEdges.get(childSlug)?.has(parentSlug)) return false;
  // GUARD (26 Aug 2026): biological plausibility — a parent must be an adult when
  // the child is born. When both years are known and the parent is not ≥13y older,
  // reject the edge outright (catches cross-branch false parents like a wife or
  // cousin wired as a child, or a bare-name ref resolving across generations).
  {
    const child = slugToPerson.get(childSlug);
    const parent = slugToPerson.get(parentSlug);
    const cBy = child?.birth_year, pBy = parent?.birth_year;
    if (cBy && pBy && (cBy - pBy) < 11) {
      console.warn(`   ⚠️ rejected impossible parent edge: ${childSlug}(b${cBy}) <- ${parentSlug}(b${pBy})`);
      return false;
    }
  }
  // If the reverse (parent claims child as ITS parent) is already recorded,
  // one of these claims is a bare-name collision across generations. Keep the
  // direction that is biologically plausible (parent older than child); if
  // neither/both are plausible (no years available), keep the existing.
  if (parentEdges.get(parentSlug)?.has(childSlug)) {
    const child = slugToPerson.get(childSlug);
    const parent = slugToPerson.get(parentSlug);
    const newDiff = child?.birth_year && parent?.birth_year
      ? child.birth_year - parent.birth_year : null;
    const existingDiff = child?.birth_year && parent?.birth_year
      ? parent.birth_year - child.birth_year : null;
    const newPlausible = newDiff !== null && newDiff >= 13 && newDiff <= 55;
    const existingPlausible = existingDiff !== null && existingDiff >= 13 && existingDiff <= 55;
    // Existing direction is plausible & new isn't → keep existing (skip new).
    if (existingPlausible && !newPlausible) return false;
    // New direction is plausible & existing isn't → drop existing, take new.
    if (newPlausible && !existingPlausible) {
      parentEdges.get(parentSlug).delete(childSlug);
      childEdges.get(childSlug).delete(parentSlug);
    } else {
      return false; // ambiguous / both plausible — keep what we have
    }
  }
  parentEdges.get(childSlug).add(parentSlug);
  childEdges.get(parentSlug).add(childSlug);
  return true;
}

for (const person of people) {
  const sourceSlug = person.slug;

  // Process relationships from vault files
  for (const rel of person.relationships || []) {
    for (const name of rel.names || []) {
      const targetSlug = resolveNameToSlug(name, sourceSlug);
      if (!targetSlug) continue;

      // Skip self-references
      if (targetSlug === sourceSlug) continue;

      // Ensure target exists in maps
      if (!parentEdges.has(targetSlug)) parentEdges.set(targetSlug, new Set());
      if (!childEdges.has(targetSlug)) childEdges.set(targetSlug, new Set());
      if (!spouseEdges.has(targetSlug)) spouseEdges.set(targetSlug, new Set());
      if (!siblingEdges.has(targetSlug)) siblingEdges.set(targetSlug, new Set());

      switch (rel.type) {
        case 'Father':
        case 'Mother':
        case 'Parents':
          addParentChild(targetSlug, sourceSlug);
          resolved++;
          break;

        case 'Children':
        case 'Child':
        case 'Son':
        case 'Daughter':
          addParentChild(sourceSlug, targetSlug);
          resolved++;
          break;

        case 'Spouse':
        case 'Wife':
        case 'Husband':
          spouseEdges.get(sourceSlug).add(targetSlug);
          spouseEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        case 'Siblings':
        case 'Brother':
        case 'Sister':
        case 'Half-siblings':
          siblingEdges.get(sourceSlug).add(targetSlug);
          siblingEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        case 'Adoptive Brother':
        case 'Adoptive Sister':
        case 'Adoptive Mother':
        case 'Adoptive Father':
          // Treat as regular relationship for graph
          if (rel.type.includes('Father') || rel.type.includes('Mother')) {
            parentEdges.get(sourceSlug).add(targetSlug);
            childEdges.get(targetSlug).add(sourceSlug);
          } else {
            siblingEdges.get(sourceSlug).add(targetSlug);
            siblingEdges.get(targetSlug).add(sourceSlug);
          }
          resolved++;
          break;

        case 'Stepchildren':
          childEdges.get(sourceSlug).add(targetSlug);
          parentEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        default:
          // Other relationship types - just note
          break;
      }
    }
  }

  // Also process existing parents/children/spouses/siblings arrays (from vault files)
  for (const parentSlug of person.parents || []) {
    if (slugToPerson.has(parentSlug)) {
      addParentChild(parentSlug, sourceSlug);
      resolved++;
    }
  }
  for (const childSlug of person.children || []) {
    if (slugToPerson.has(childSlug)) {
      addParentChild(sourceSlug, childSlug);
      resolved++;
    }
  }
  for (const spouseSlug of person.spouses || []) {
    if (slugToPerson.has(spouseSlug)) {
      spouseEdges.get(sourceSlug).add(spouseSlug);
      spouseEdges.get(spouseSlug).add(sourceSlug);
      resolved++;
    }
  }
  for (const siblingSlug of person.siblings || []) {
    if (slugToPerson.has(siblingSlug)) {
      siblingEdges.get(sourceSlug).add(siblingSlug);
      siblingEdges.get(siblingSlug).add(sourceSlug);
      resolved++;
    }
  }
}

// ─── Second Pass: Infer Siblings from Shared Parents ──────────────────────────

for (const [childSlug, parents] of parentEdges) {
  const parentList = Array.from(parents);
  if (parentList.length >= 2) {
    // Find all other children of these parents
    for (const otherChild of childEdges.get(parentList[0]) || []) {
      if (otherChild !== childSlug &&
          parentList.every(p => childEdges.get(p)?.has(otherChild))) {
        siblingEdges.get(childSlug).add(otherChild);
        siblingEdges.get(otherChild).add(childSlug);
      }
    }
  }
}

// Call deduplication after all edges are built, before converting to arrays
deduplicateParents(people, parentEdges);

// ─── Deduplicate and Convert to Arrays ────────────────────────────────────────

for (const person of people) {
  const slug = person.slug;
  person.parents = Array.from(parentEdges.get(slug) || []).sort();
  person.children = Array.from(childEdges.get(slug) || []).sort();
  person.spouses = Array.from(spouseEdges.get(slug) || []).sort();
  person.siblings = Array.from(siblingEdges.get(slug) || []).sort();
}

// ─── Build Graph Output ──────────────────────────────────────────────────────

const graph = {
  nodes: people.map(p => ({ slug: p.slug, id: p.id, generation: p.generation, branch: p.branch })),
  edges: {
    parentOf: [],
    spouseOf: [],
    siblingOf: []
  }
};

for (const person of people) {
  for (const parent of person.parents) {
    graph.edges.parentOf.push({ from: parent, to: person.slug });
  }
  for (const spouse of person.spouses) {
    if (person.slug < spouse) { // avoid duplicates
      graph.edges.spouseOf.push({ from: person.slug, to: spouse });
    }
  }
  for (const sibling of person.siblings) {
    if (person.slug < sibling) {
      graph.edges.siblingOf.push({ from: person.slug, to: sibling });
    }
  }
}

// ─── Save ────────────────────────────────────────────────────────────────────

fs.writeFileSync(PEOPLE_PATH, JSON.stringify(people, null, 2));
fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));

console.log(`✅ Updated ${PEOPLE_PATH}`);
console.log(`✅ Written ${GRAPH_PATH}`);
console.log(`\n📊 Relationship Stats:`);
console.log(`   Parent edges: ${graph.edges.parentOf.length}`);
console.log(`   Spouse edges: ${graph.edges.spouseOf.length}`);
console.log(`   Sibling edges: ${graph.edges.siblingOf.length}`);