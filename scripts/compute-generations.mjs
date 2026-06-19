#!/usr/bin/env node
/**
 * compute-generations.mjs
 * BFS from root(s) to assign generation numbers
 *
 * Run: node scripts/compute-generations.mjs
 * Input: src/data/people.json
 * Output: src/data/generation-index.json, updates people.json with generation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PEOPLE_PATH = path.resolve(__dirname, '../src/data/people.json');
const GEN_INDEX_PATH = path.resolve(__dirname, '../src/data/generation-index.json');
const GRAPH_PATH = path.resolve(__dirname, '../src/data/relationship-graph.json');

// ─── Load Data ──────────────────────────────────────────────────────────────

const people = JSON.parse(fs.readFileSync(PEOPLE_PATH, 'utf-8'));
const slugToPerson = new Map(people.map(p => [p.slug, p]));

// Build adjacency from people.json relationships
const childrenMap = new Map();
const parentsMap = new Map();
const spousesMap = new Map();

for (const person of people) {
  const slug = person.slug;
  childrenMap.set(slug, person.children || []);
  parentsMap.set(slug, person.parents || []);
  spousesMap.set(slug, person.spouses || []);
}

// ─── Find Root(s) ───────────────────────────────────────────────────────────

// Primary root: John Telfer of Castleton (1731)
const ROOT_CANDIDATES = [
  'john-telfer-of-castleton',  // actual slug
  'john-telfer-1731s',  // slug from vault file "John Telfer (of Castleton) (1731–?).md"
  'john-telfer-of-castleton-1731'
];

let rootSlug = null;
for (const candidate of ROOT_CANDIDATES) {
  if (slugToPerson.has(candidate)) {
    rootSlug = candidate;
    break;
  }
}

// Fallback: find person with birth_year ~1731, no parents in data
if (!rootSlug) {
  for (const person of people) {
    if (person.birth_year && person.birth_year <= 1740 &&
        person.parents && person.parents.length === 0) {
      rootSlug = person.slug;
      break;
    }
  }
}

if (!rootSlug) {
  console.error('❌ Could not find root ancestor!');
  process.exit(1);
}

console.log(`🌱 Root ancestor: ${slugToPerson.get(rootSlug).display_name} (${rootSlug})`);

// ─── Display Name Lookup ────────────────────────────────────────────────────

// Fallback: resolve display-name references (children/parents/spouses arrays
// often contain display names like 'James Telfer (1761–1845)' instead of slugs)
function resolveReference(ref, contextSlug) {
  // 1. Already a valid slug
  if (slugToPerson.has(ref)) return ref;

  // 2. Extract birth_year from lifespan in reference, e.g. "(1761–1845)", "(~1731–?)"
  const lifespanMatch = ref.match(/\(~?(\d{4})[–-]/);
  const refBirthYear = lifespanMatch ? parseInt(lifespanMatch[1]) : null;

  // 3. Strip all parenthetical content (lifespans, née, etc.)
  const stripped = ref.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
  const strippedLower = stripped.toLowerCase();

  const candidates = [];

  for (const person of people) {
    const dn = person.display_name;
    const dnLower = dn.toLowerCase();

    // a) Exact display_name match
    if (ref.toLowerCase() === dnLower) {
      candidates.push(person);
      continue;
    }

    // b) Stripped display_name vs stripped reference
    const dnStripped = dn.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (strippedLower === dnStripped) {
      candidates.push(person);
      continue;
    }

    // c) first_name + last_name match (handles 'Mark Telfer' → 'Mark Kenneth Telfer')
    const parts = stripped.split(/\s+/);
    if (parts.length >= 2 && person.first_name && person.last_name) {
      const firstName = parts[0];
      const lastName = parts[parts.length - 1];
      if (person.first_name.toLowerCase() === firstName.toLowerCase() &&
          person.last_name.toLowerCase() === lastName.toLowerCase()) {
        candidates.push(person);
        continue;
      }
    }

    // d) Single name (after stripping lifespan) + "Telfer" surname
    //    e.g. "Francis (1809–1895)" → stripped "Francis" → Francis Telfer
    if (parts.length === 1 && person.first_name && person.last_name) {
      if (person.first_name.toLowerCase() === strippedLower &&
          person.last_name.toLowerCase() === 'telfer') {
        candidates.push(person);
      }
    }
  }

  if (candidates.length === 1) {
    return candidates[0].slug;
  } else if (candidates.length > 1 && refBirthYear !== null) {
    // Disambiguate by birth year from lifespan in reference
    for (const c of candidates) {
      if (c.birth_year === refBirthYear) return c.slug;
    }
  } else if (candidates.length > 1 && contextSlug) {
    // Disambiguate using parent context
    // 1st pass: prefer candidate that has contextSlug in their parents array
    const withParent = candidates.filter(c => {
      const parents = c.parents || [];
      return parents.some(p => {
        // Check both slug and resolved reference
        const resolved = resolveReference(p);
        return resolved === contextSlug;
      });
    });
    if (withParent.length === 1) return withParent[0].slug;
    if (withParent.length > 1) {
      // 2nd pass: prefer candidate with FEWER parents (less likely aggregate/duplicate)
      withParent.sort((a, b) => (a.parents || []).length - (b.parents || []).length);
      return withParent[0].slug;
    }
    // 3rd pass: use birth year proximity
    const contextPerson = slugToPerson.get(contextSlug);
    if (contextPerson && contextPerson.birth_year) {
      const expectedBirth = contextPerson.birth_year + 30;
      let best = null;
      let bestDelta = Infinity;
      for (const c of candidates) {
        if (c.birth_year) {
          const delta = Math.abs(c.birth_year - expectedBirth);
          if (delta < bestDelta) {
            bestDelta = delta;
            best = c;
          }
        }
      }
      if (best) return best.slug;
    }
  }

  return null; // could not resolve
}

// ─── BFS Generation Assignment ──────────────────────────────────────────────

// Only traverse DOWN from root: children (gen + 1), spouses (same gen)
// NO parent traversal (causes cycles)

const generation = new Map();
const visited = new Set();
const queue = [{ slug: rootSlug, gen: 1 }];
const unresolved = [];

while (queue.length > 0) {
  const { slug, gen } = queue.shift();

  if (visited.has(slug)) continue;
  visited.add(slug);

  // Assign generation if not already assigned (or if lower)
  if (!generation.has(slug) || gen < generation.get(slug)) {
    generation.set(slug, gen);
  }

  // Enqueue children (gen + 1) — resolve display-name references
  const children = childrenMap.get(slug) || [];
  for (const childRef of children) {
    const resolved = resolveReference(childRef, slug);
    if (resolved) {
      queue.push({ slug: resolved, gen: gen + 1 });
    } else {
      unresolved.push({ from: slug, ref: childRef, role: 'child' });
    }
  }

  // Enqueue spouses (same generation) — resolve display-name references
  const spouses = spousesMap.get(slug) || [];
  for (const spouseRef of spouses) {
    const resolved = resolveReference(spouseRef, slug);
    if (resolved && !visited.has(resolved)) {
      queue.push({ slug: resolved, gen: gen });
    } else if (!resolved) {
      unresolved.push({ from: slug, ref: spouseRef, role: 'spouse' });
    }
  }
}

if (unresolved.length > 0) {
  console.log(`\n⚠️  ${unresolved.length} references could not be resolved (will use birth-year estimation):`);
  for (const u of unresolved.slice(0, 15)) {
    const from = slugToPerson.get(u.from);
    console.log(`   ${from ? from.display_name : u.from} → ${u.role}: "${u.ref}"`);
  }
  if (unresolved.length > 15) console.log(`   ... and ${unresolved.length - 15} more`);
}

// ─── Post-BFS: Sync Spouse Generations ────────────────────────────────────────

// Track which slugs were reached by BFS from root (connected)
const connected = new Set(visited);

// For each person reached by BFS, give their spouses the same generation
// (if spouse wasn't already reached by BFS with a different generation)
for (const personSlug of connected) {
  const personGen = generation.get(personSlug);
  const spouses = spousesMap.get(personSlug) || [];
  for (const spouseRef of spouses) {
    const spouseSlug = resolveReference(spouseRef, personSlug);
    if (spouseSlug && !connected.has(spouseSlug)) {
      // Spouse not connected to root - give them the connected spouse's generation
      generation.set(spouseSlug, personGen);
    }
  }
}

// ─── Assign Generations for Disconnected People ────────────────────────────

// People not reached by BFS get generation estimated by birth year
// Those WITHOUT birth year AND no links get gen 99 (unassigned)

const ROOT_BIRTH_YEAR = 1731;

for (const person of people) {
  if (generation.has(person.slug)) continue; // already assigned

  if (person.birth_year) {
    // Estimate: every 30 years = 1 generation
    const est = Math.max(1, Math.round((person.birth_year - ROOT_BIRTH_YEAR) / 30) + 1);
    generation.set(person.slug, est);
  } else {
    // Truly unknown - assign gen 99
    generation.set(person.slug, 99);
  }
}

// ─── Update People Objects ──────────────────────────────────────────────────

for (const person of people) {
  person.generation = generation.get(person.slug) || 1;
}

// ─── Build Generation Index ─────────────────────────────────────────────────

const genIndex = {};
for (const [slug, gen] of generation) {
  if (!genIndex[gen]) genIndex[gen] = [];
  genIndex[gen].push(slug);
}

// Sort each generation by birth year
for (const gen of Object.keys(genIndex)) {
  genIndex[gen].sort((a, b) => {
    const pa = slugToPerson.get(a);
    const pb = slugToPerson.get(b);
    return (pa.birth_year || 9999) - (pb.birth_year || 9999);
  });
}

// ─── Save Outputs ───────────────────────────────────────────────────────────

fs.writeFileSync(PEOPLE_PATH, JSON.stringify(people, null, 2));
fs.writeFileSync(GEN_INDEX_PATH, JSON.stringify(genIndex, null, 2));

console.log(`✅ Updated ${PEOPLE_PATH}`);
console.log(`✅ Written ${GEN_INDEX_PATH}`);

// Stats
const maxGen = Math.max(...generation.values());
const genCounts = {};
for (const g of generation.values()) genCounts[g] = (genCounts[g] || 0) + 1;

console.log(`\n📊 Generation Distribution:`);
for (let g = 1; g <= maxGen; g++) {
  console.log(`   Gen ${g}: ${genCounts[g] || 0} people`);
}
console.log(`   Max generation: ${maxGen}`);
console.log(`   Total assigned: ${generation.size}`);