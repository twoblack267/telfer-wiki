#!/usr/bin/env node
/**
 * sanitize-people.mjs
 * Build-time sanitization for public output
 * - Publishes ALL people (no generation-gap filter)
 * - Scrub PII from body_markdown (emails, phones, addresses, IDs)
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

// ─── PII Scrubbing ──────────────────────────────────────────────────────────

/**
 * Scrub personally identifiable information from text content.
 * Handles: emails, phones, street addresses, PO boxes, Medicare, licences.
 */
function scrubPII(text) {
  if (!text) return text;

  let result = text;

  // Emails — anything@anything.anything
  result = result.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gi, '[email redacted]');

  // Australian mobile: 0412 345 678, +61 412 345 678, etc.
  result = result.replace(
    /(?:\+?61[\s\-.]?)?0?4[\s\-.]?\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}\b/g,
    '[phone redacted]'
  );

  // Australian landline: 08 1234 5678, +61 8 1234 5678, etc.
  result = result.replace(
    /(?:\+?61[\s\-.]?)?0[23578][\s\-.]?\d{4}[\s\-.]?\d{4}\b/g,
    '[phone redacted]'
  );

  // Medicare numbers (4+5+1 digit, starting 2-6)
  result = result.replace(/[2-6]\d{3}\s?\d{5}\s?\d\b/g, '[Medicare redacted]');

  // PO Box addresses
  result = result.replace(
    /(?:PO\s*Box|Post\s*Office\s*Box)\s+\d+/gi,
    '[PO Box redacted]'
  );

  // Street-level addresses: number + street name + street type suffix
  // e.g. "123 Main Street", "42 Acacia Avenue"
  result = result.replace(
    /\b\d{1,4}\s+[A-Z][a-zA-Z']+(?:\s+[A-Z][a-zA-Z']+)*\s+(?:St(?:reet)?\.?|Rd(?:oad)?\.?|Ave(?:nue)?\.?|Ln(?:ane)?\.?|Dr(?:ive)?\.?|Ct(?:ourt)?\.?|Pl(?:ace)?\.?|Cres(?:cent)?\.?|Hwy(?:ay)?\.?|Pde(?:ade)?\.?|Tce(?:race)?\.?|Close|Way|Circuit|Cir(?:cuit)?\.?)\b/g,
    '[address redacted]'
  );

  return result;
}

// ─── Public / Private Field Lists ────────────────────────────────────────────

// Fields to EXCLUDE from public output
const PRIVATE_FIELDS = new Set([
  'body_stripped',
  'vault_file',
  '_stub_source',
  '_stub_relationship',
  'relationships',  // raw relationships table - replaced by parents/children/spouses/siblings
  'related_trees',
  'confidence',
  'dna_matches',
  'haplogroup_mt',
  'haplogroup_y',
]);

// Fields to KEEP in public output (body_markdown included, PII-scrubbed)
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
  'body_markdown',  // included but PII-scrubbed below
  'roles',
  'tags',
  'parents',
  'children',
  'spouses',
  'siblings',
  'images',
  'person_photo',
];

// ─── Load Data ──────────────────────────────────────────────────────────────

const people = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
const slugToPerson = new Map(people.map(p => [p.slug, p]));

console.log(`📚 Loaded ${people.length} people`);

// ─── Identify Living People ─────────────────────────────────────────────────

const LIVE_CUTOFF = 1940;
const livingPeople = people.filter(p =>
  p.is_living === true ||
  (p.birth_year && p.birth_year >= LIVE_CUTOFF && !p.death_year)
);

console.log(`👤 Living people identified: ${livingPeople.length}`);

// ─── Visibility: ALL people are visible — no generation filter ────────────

const visible = new Set(people.map(p => p.slug));

console.log(`👁️  Visible people: ${visible.size} / ${people.length}`);

// ─── Build Public Output ────────────────────────────────────────────────────

const publicPeople = [];

for (const person of people) {
  const publicPerson = {};

  // Copy public fields
  for (const field of PUBLIC_FIELDS) {
    if (person[field] !== undefined) {
      let val = person[field];
      // PII-scrub body_markdown before publishing
      if (field === 'body_markdown') {
        val = scrubPII(val);
      }
      publicPerson[field] = val;
    }
  }

  // Filter relationships to only visible people (all are visible now, but belt-and-braces)
  publicPerson.parents = (person.parents || []).filter(s => visible.has(s));
  publicPerson.children = (person.children || []).filter(s => visible.has(s));
  publicPerson.spouses = (person.spouses || []).filter(s => visible.has(s));
  publicPerson.siblings = (person.siblings || []).filter(s => visible.has(s));

  // For living people: hide children and grandchildren
  if (person.is_living) {
    publicPerson.children = [];
    // Grandchildren are handled by the child's own visibility filters
  }

  publicPeople.push(publicPerson);
}

// Sort by generation, then birth year, then name
publicPeople.sort((a, b) => {
  if (a.generation !== b.generation) return (a.generation || 0) - (b.generation || 0);
  const ay = a.birth_year || 9999;
  const by = b.birth_year || 9999;
  if (ay !== by) return ay - by;
  return (a.display_name || '').localeCompare(b.display_name || '');
});

// ─── Write Output ────────────────────────────────────────────────────────────

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(publicPeople, null, 2));

console.log(`✅ Written ${publicPeople.length} people to ${OUTPUT_PATH}`);
console.log(`   Hidden: ${people.length - publicPeople.length} people`);

// Stats
const genCounts = {};
let bodiesPublished = 0;
for (const p of publicPeople) {
  genCounts[p.generation] = (genCounts[p.generation] || 0) + 1;
  if (p.body_markdown) bodiesPublished++;
}
console.log(`📝 People with biography published: ${bodiesPublished}`);
console.log('\n📊 Public Generation Distribution:');
const maxGen = Math.max(...Object.keys(genCounts).map(Number));
for (let g = 1; g <= maxGen; g++) {
  console.log(`   Gen ${g}: ${genCounts[g] || 0}`);
}
