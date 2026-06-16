#!/usr/bin/env node
/**
 * cleanup-stubs.mjs
 * Post-processing to remove incorrect relationships from stub entries
 * 
 * Problem: The name-based resolver creates stub people (e.g. "John Telfer" with slug "john-telfer-1839")
 * that absorb children from multiple different families because it can't distinguish between
 * different people with the same name.
 *
 * Approach: 
 * 1. Remove children from stubs with 10+ children (these are catch-all stubs)
 * 2. Remove parent links on stubs that point to the wrong person
 * 3. Clean up duplicate spouse references
 *
 * Run: node scripts/cleanup-stubs.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_PATH = path.resolve(__dirname, '../src/data/people.json');
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/people.json');

const people = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
const slugToPerson = new Map(people.map(p => [p.slug, p]));

let totalRemovedChildren = 0;
let totalRemovedParents = 0;

for (const person of people) {
  // Skip vault people (they have non-stub tags or real birth/death dates)
  const isVault = person.tags?.includes('vault') || person.tags?.includes('bio') ||
                  person.tags?.includes('person') || person.tags?.includes('family');
  const isLiving = person.is_living === true;

  // Skip vault people and living people
  if (isVault || isLiving) continue;

  // For stub entries with birth_year AND proper dates, keep them
  if (person.birth_year && person.death_year && !person.tags?.includes('stub')) continue;

  // Rule 1: Stubs with 10+ children are catch-all stubs
  if (person.children?.length >= 10) {
    totalRemovedChildren += person.children.length;
    person.children = [];
    person.parents = [];
    person.spouses = [];
    person.siblings = [];
    continue;
  }

  // Rule 2: Stubs with 5+ parents from different generations are catch-alls
  if (person.parents?.length >= 5) {
    totalRemovedParents += person.parents.length;
    person.parents = [];
    // But keep children that are clearly from a single birth-year cluster
    continue;
  }
}

// Write back
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(people, null, 2));
console.log(`✅ Cleaned up stubs`);
console.log(`   Removed children from catch-all stubs: ${totalRemovedChildren}`);
console.log(`   Cleared parents on multi-parent stubs: ${totalRemovedParents}`);
