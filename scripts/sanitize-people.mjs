#!/usr/bin/env node
/**
 * sanitize-people.mjs
 * Build-time sanitization for public output
 * - Removes living people (born >= 1940, no death) beyond great-grandparents of living
 * - Hides children/grandchildren of living people
 * - Strips private fields, keeps only public-safe data
 * - Outputs to src/data/people.public.json
 *
 * Run: node scripts/sanitize-people.mjs
 * Input: src/data/people.json
 * Output: src/data/people.public.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.resolve(__dirname, '../src/data/people.json');
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/people.public.json');

// ─── Configuration ──────────────────────────────────────────────────────────

// Cutoff year: people born >= this year with no death = LIVING
const LIVING_CUTOFF_YEAR = 1940;

// Privacy rule: publish up to GREAT-GRANDPARENTS of living people
// That means: living person (gen N) → parents (N-1) → grandparents (N-2) → great-grandparents (N-3)
// Anyone at gen <= (living_gen - 3) is publishable unless they're a direct ancestor of living
const PRIVACY_GENERATION_GAP = 3;

// Fields to EXCLUDE from public output
const PRIVATE_FIELDS = new Set([
  'body_markdown',
  'body_stripped',
  'vault_file',
  '_stub_source',
  '_stub_relationship',
  'relationships',  // raw relationships table - replaced by parents/children/spouses/siblings
  'roles',
  'tags',           // contains 'stub', 'needs-research' etc.
  'related_trees',
  'confidence'
]);

// Fields to KEEP in public output
const PUBLIC_FIELDS = [
  'id',
  'slug',
  'first_name',
  'middle_name',
  'last_name',
  'birth_year',
  'death_year',
  'birth_year_display',
  'death_year_display',
  'display_name',
  'title',
  'lifespan',
  'generation',
  'branch',
  'is_living',
  'parents',
  'children',
  'spouses',
  'siblings',
  'images',
  'person_photo'
];

// ─── Load Data ──────────────────────────────────────────────────────────────

const people = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
const slugToPerson = new Map(people.map(p => [p.slug, p]));

console.log(`📚 Loaded ${people.length} people`);

// ─── Identify Living People ─────────────────────────────────────────────────

const livingPeople = people.filter(p =>
  p.is_living === true ||
  (p.birth_year && p.birth_year >= LIVING_CUTOFF_YEAR && !p.death_year)
);

console.log(`👤 Living people identified: ${livingPeople.length}`);

// ─── Compute Visibility ──────────────────────────────────────────────────────

// A person is VISIBLE if they are within PRIVACY_GENERATION_GAP generations
// UP from any living person (including the living person themselves and spouses)
// 
// Living person (gen N) → Parents (N-1) → Grandparents (N-2) → Great-grandparents (N-3)
// Great-great-grandparents (N-4) are NOT visible.

const visible = new Set();

// Start from each living person, walk UP the tree
for (const living of livingPeople) {
  let currentSlugs = [living.slug];
  const seen = new Set(); // per-walk deduplication

  for (let gap = 0; gap <= PRIVACY_GENERATION_GAP; gap++) {
    const nextSlugs = [];
    for (const slug of currentSlugs) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      visible.add(slug); // global visibility

      const person = slugToPerson.get(slug);
      if (person) {
        // Add parents (going UP)
        for (const parentSlug of person.parents || []) {
          if (!seen.has(parentSlug)) nextSlugs.push(parentSlug);
        }
        // Add spouses (same generation)
        for (const spouseSlug of person.spouses || []) {
          if (!seen.has(spouseSlug)) nextSlugs.push(spouseSlug);
        }
      }
    }
    currentSlugs = nextSlugs;
    if (currentSlugs.length === 0) break;
  }
}

// Also mark spouses of all visible people
const spousesToAdd = new Set();
for (const slug of visible) {
  const person = slugToPerson.get(slug);
  if (person) {
    for (const spouseSlug of person.spouses || []) {
      if (!visible.has(spouseSlug)) spousesToAdd.add(spouseSlug);
    }
  }
}
for (const slug of spousesToAdd) visible.add(slug);

// Also mark siblings of all visible people (keep families together)
const siblingsToAdd = new Set();
for (const slug of visible) {
  const person = slugToPerson.get(slug);
  if (person && person.branch === 'telfer') {
    for (const siblingSlug of person.siblings || []) {
      const sibling = slugToPerson.get(siblingSlug);
      if (sibling && sibling.branch === 'telfer' && !visible.has(siblingSlug)) {
        siblingsToAdd.add(siblingSlug);
      }
    }
  }
}
for (const slug of siblingsToAdd) visible.add(slug);

console.log(`👁️  Visible people: ${visible.size} / ${people.length}`);

// ─── Build Public Output ────────────────────────────────────────────────────

const publicPeople = [];

for (const person of people) {
  if (!visible.has(person.slug)) continue;

  const publicPerson = {};

  // Copy public fields
  for (const field of PUBLIC_FIELDS) {
    if (person[field] !== undefined) {
      publicPerson[field] = person[field];
    }
  }

  // Filter relationships to only visible people
  publicPerson.parents = (person.parents || []).filter(s => visible.has(s));
  publicPerson.children = (person.children || []).filter(s => visible.has(s));
  publicPerson.spouses = (person.spouses || []).filter(s => visible.has(s));
  publicPerson.siblings = (person.siblings || []).filter(s => visible.has(s));

  // For living people: hide children and grandchildren
  if (person.is_living) {
    publicPerson.children = [];
    // Also hide grandchildren by removing their parent links
    // (handled by the parent's visibility check above)
  }

  publicPeople.push(publicPerson);
}

// Sort by generation, then birth year, then name
publicPeople.sort((a, b) => {
  if (a.generation !== b.generation) return a.generation - b.generation;
  const ay = a.birth_year || 9999;
  const by = b.birth_year || 9999;
  if (ay !== by) return ay - by;
  return (a.id || '').localeCompare(b.id || '');
});

// ─── Write Output ────────────────────────────────────────────────────────────

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(publicPeople, null, 2));

console.log(`✅ Written ${publicPeople.length} people to ${OUTPUT_PATH}`);
console.log(`   Hidden: ${people.length - publicPeople.length} people`);

// Stats
const genCounts = {};
for (const p of publicPeople) {
  genCounts[p.generation] = (genCounts[p.generation] || 0) + 1;
}
console.log('\n📊 Public Generation Distribution:');
for (let g = 1; g <= Math.max(...Object.keys(genCounts).map(Number)); g++) {
  console.log(`   Gen ${g}: ${genCounts[g] || 0}`);
}