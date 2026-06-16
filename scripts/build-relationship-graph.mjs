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
for (const person of people) {
  const name = person.id.toLowerCase(); // id has clean name
  if (!nameIndex.has(name)) nameIndex.set(name, person.slug);
  // Also try first + last name
  const parts = person.id.split(' ');
  if (parts.length >= 2) {
    const fn = parts[0].toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();
    nameIndex.set(`${fn} ${ln}`, person.slug);
  }
}

// ─── Resolve Names to Slugs ──────────────────────────────────────────────────

function resolveNameToSlug(name, sourceSlug) {
  if (!name || name === '?' || name.toLowerCase() === 'unknown') return null;
  if (name.match(/^\(?\d{4}[\-–]\d{4}\)?$/)) return null;
  if (name.match(/^(Self|Spouse|Father|Mother|Children|Siblings)$/i)) return null;

  // Extract clean name (remove dates in parens)
  const cleanName = name.replace(/\s*\([^)]+\)$/, '').trim();

  // Try exact slug match (slugified clean name)
  const slugified = slugify(cleanName);
  if (slugIndex.has(slugified)) return slugIndex.get(slugified);

  // Try exact name match
  if (nameIndex.has(cleanName.toLowerCase())) return nameIndex.get(cleanName.toLowerCase());

  // Try fuzzy: first + last name
  const parts = cleanName.split(' ');
  if (parts.length >= 2) {
    const fn = parts[0].toLowerCase();
    const ln = parts[parts.length - 1].toLowerCase();
    const key = `${fn} ${ln}`;
    if (nameIndex.has(key)) return nameIndex.get(key);
  }

  // Try partial match on display_name
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
    if (!child?.birth_year) continue;

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
          parentEdges.get(sourceSlug).add(targetSlug);
          childEdges.get(targetSlug).add(sourceSlug);
          resolved++;
          break;

        case 'Children':
        case 'Child':
        case 'Son':
        case 'Daughter':
          childEdges.get(sourceSlug).add(targetSlug);
          parentEdges.get(targetSlug).add(sourceSlug);
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
      parentEdges.get(sourceSlug).add(parentSlug);
      childEdges.get(parentSlug).add(sourceSlug);
      resolved++;
    }
  }
  for (const childSlug of person.children || []) {
    if (slugToPerson.has(childSlug)) {
      childEdges.get(sourceSlug).add(childSlug);
      parentEdges.get(childSlug).add(sourceSlug);
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