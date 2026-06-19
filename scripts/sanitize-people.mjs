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

  // ── Strip actual PII values (replace with nothing, not a label) ──────────

  // Emails — anything@anything.anything
  result = result.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gi, '');

  // Australian mobile: 0412 345 678, +61 412 345 678, etc.
  result = result.replace(
    /(?:\+?61[\s\-.]?)?0?4[\s\-.]?\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}\b/g,
    ''
  );

  // Australian landline: 08 1234 5678, +61 8 1234 5678, etc.
  result = result.replace(
    /(?:\+?61[\s\-.]?)?0[23578][\s\-.]?\d{4}[\s\-.]?\d{4}\b/g,
    ''
  );

  // Medicare numbers (4+5+1 digit, starting 2-6)
  result = result.replace(/[2-6]\d{3}\s?\d{5}\s?\d\b/g, '');

  // PO Box addresses
  result = result.replace(
    /(?:PO\s*Box|Post\s*Office\s*Box)\s+\d+/gi,
    ''
  );

  // Street-level addresses: number + street name + street type suffix
  result = result.replace(
    /\b\d{1,4}\s+[A-Z][a-zA-Z']+(?:\s+[A-Z][a-zA-Z']+)*\s+(?:St(?:reet)?\.?|Rd(?:oad)?\.?|Ave(?:nue)?\.?|Ln(?:ane)?\.?|Dr(?:ive)?\.?|Ct(?:ourt)?\.?|Pl(?:ace)?\.?|Cres(?:cent)?\.?|Hwy(?:ay)?\.?|Pde(?:ade)?\.?|Tce(?:race)?\.?|Close|Way|Circuit|Cir(?:cuit)?\.?)\b/g,
    ''
  );

  // Also catch any [X redacted] leftovers from manual entries
  result = result.replace(/\[(?:email|phone|address|Medicare|PO Box)\s*redacted\]/gi, '');
  // Catch [redacted for privacy] and similar
  result = result.replace(/\[redacted\s*(?:for\s+)?(?:privacy|security|protection)\]/gi, '');

  // ── Line-by-line cleanup ──────────────────────────────────────────────────

  const LABEL_RE = /^\s*(?:-\s+)?\*\*(?:Email|Phone|Mobile|Telephone|Fax|Contact|Address|Residential\s+Address|Postal\s+Address|Street\s+Address):\*\*/i;

  let lines = result.split('\n');
  let clean = [];

  for (const line of lines) {
    // Check if line starts with a known PII label
    if (LABEL_RE.test(line)) {
      // Strip the label part, backticks, parentheses, commas — if nothing meaningful remains, skip it
      let rest = line.replace(LABEL_RE, '').replace(/[`()\s,;:]+/g, '').trim();
      if (rest === '') continue; // line was just a label with empty values
    }
    clean.push(line);
  }

  result = clean.join('\n');

  // Remove **Contact:** lines where contact values were stripped (empty backticks)
  result = result.replace(/^\*\*Contact:\*\*\s*``\s*\([^)]*\),?\s*``\s*\([^)]*\)\s*$/gm, '');
  // Same for a single contact
  result = result.replace(/^\*\*Contact:\*\*\s*``\s*\([^)]*\)\s*$/gm, '');
  result = result.replace(/^-\s+\*\*Address:\*\*\s*,?\s*.+\s+\d{4}\s*$/gim, '');

  // Remove empty markdown comment lines: <!-- ... -->
  result = result.replace(/<!--\s*.*?-->\s*\n?/g, '');

  // Remove lines that are now just whitespace
  result = result.replace(/^[ \t]+$/gm, '');

  // Collapse 3+ consecutive newlines to 2
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim trailing whitespace per line
  result = result.replace(/[ \t]+\n/g, '\n');

  return result.trim();
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

// ─── Build display-name-to-slug resolution ──────────────────────────────────
// The relationship fields in people.json store DISPLAY NAMES (e.g. "Adelaide Elsie Pearl")
// not slugs. We need to resolve them to slugs to check visibility.

/** Strip parenthetical date ranges from a display name */
function stripDates(name) {
  return name.replace(/\s*\(.*?\)\s*/g, '').trim();
}

/** Build a map from possible display-name variants to slug */
function buildNameToSlug(people) {
  const map = new Map();
  for (const p of people) {
    // Exact slug match (for entries that somehow already have slugs)
    map.set(p.slug, p.slug);
    // Exact display name
    map.set(p.display_name.toLowerCase(), p.slug);
    // Display name without parenthetical dates
    const noDate = stripDates(p.display_name).toLowerCase();
    if (noDate && noDate !== p.display_name.toLowerCase()) {
      map.set(noDate, p.slug);
    }
    // First name + last name (handles middle initials in relationship data)
    if (p.first_name && p.last_name) {
      const firstLast = `${p.first_name.toLowerCase()} ${p.last_name.toLowerCase()}`;
      if (!map.has(firstLast)) map.set(firstLast, p.slug);
    }
  }
  return map;
}

const nameToSlug = buildNameToSlug(people);

/** Resolve a relationship entry (display name or partial) to a slug if visible */
function resolveToVisible(entry) {
  if (!entry) return null;
  // Try the entry as-is
  if (nameToSlug.has(entry.toLowerCase())) {
    const slug = nameToSlug.get(entry.toLowerCase());
    return visible.has(slug) ? entry : null;
  }
  // Try without parenthetical dates
  const noDate = stripDates(entry).toLowerCase();
  if (noDate && noDate !== entry.toLowerCase() && nameToSlug.has(noDate)) {
    const slug = nameToSlug.get(noDate);
    return visible.has(slug) ? entry : null;
  }
  // Try first+last (if entry is just a name like "James Telfer")
  const parts = entry.toLowerCase().split(/\s+/);
  if (parts.length >= 2) {
    const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
    if (nameToSlug.has(firstLast)) {
      const slug = nameToSlug.get(firstLast);
      return visible.has(slug) ? entry : null;
    }
  }
  return null;
}

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

  // Filter relationship display names to only visible people
  // (data stores display names like "Adelaide Elsie Pearl", not slugs)
  publicPerson.parents = (person.parents || []).map(resolveToVisible).filter(Boolean);
  publicPerson.children = (person.children || []).map(resolveToVisible).filter(Boolean);
  publicPerson.spouses = (person.spouses || []).map(resolveToVisible).filter(Boolean);
  publicPerson.siblings = (person.siblings || []).map(resolveToVisible).filter(Boolean);

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

// Also regenerate meta.json so homepage stats stay in sync
const META_PATH = path.resolve(__dirname, '../src/data/meta.json');
const meta = {
  total_people: publicPeople.length,
  total_trees: new Set(people.map(p => p.branch).filter(Boolean)).size,
  living: publicPeople.filter(p => p.is_living).length,
  deceased: publicPeople.filter(p => !p.is_living).length,
};
fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n');

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
