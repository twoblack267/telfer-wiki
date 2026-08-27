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
  'aliases',          // alternate names a wiki-link may resolve to (e.g. "David Telfer")
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

// ─── Deduplicate: keep per-(first,last,birth) the entry with year in slug ────

function deduplicatePeople(arr) {
  const seen = new Map(); // key -> best entry
  const dropped = [];

  for (const p of arr) {
    const by = p.birth_year ?? '';
    // Include middle_name ONLY when birth_year is absent, matching convert-markdown.mjs.
    // Two no-year same first+last people (e.g. John Alick Ralph Telfer vs John Robert
    // Telfer) share a first+last-only key and would wrongly deduplicate — this mirrors
    // the converter's collision fix so the two Johns coexist.
    const namePart = by
      ? ((p.first_name || '') + (p.last_name || ''))
      : ((p.first_name || '') + (p.middle_name || '') + (p.last_name || ''));
    const key = (namePart + '|' + by).toLowerCase();
    const hasYear = /\d{4}$/.test(p.slug || '');
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, p);
    } else {
      const existingHasYear = /\d{4}$/.test(existing.slug || '');
      // Prefer the one with year in slug — that's the 'real' entry with full data
      if (hasYear && !existingHasYear) {
        // Current has year, existing doesn't — swap
        seen.set(key, p);
        dropped.push(existing.slug);
      } else {
        dropped.push(p.slug);
      }
    }
  }

  if (dropped.length > 0) {
    console.log(`🧹 Deduplicated: removed ${dropped.length} duplicate entries (bare-slug stubs)`);
    dropped.forEach(s => console.log(`   - ${s}`));
  }
  return Array.from(seen.values());
}

// ─── Load Data ──────────────────────────────────────────────────────────────

let people = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
console.log(`📚 Loaded ${people.length} raw people entries`);
people = deduplicatePeople(people);
console.log(`📚 After dedup: ${people.length} unique people`);

const slugToPerson = new Map(people.map(p => [p.slug, p]));

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
  return name.replace(/\s*\([^)]*\d[^)]*\)\s*/g, '').trim();
}

/** Check if a slug ends with 4 digits (year suffix) */
function hasYearInSlug(slug) { return /\d{4}$/.test(slug); }

/** Build a map from possible display-name variants to slug */
function buildNameToSlug(people) {
  const map = new Map();
  for (const p of people) {
    if (!p.slug || !p.display_name) continue;
    const thisHasYear = hasYearInSlug(p.slug);
    // Helper: prefer year-suffixed slug when multiple entries share a key
    const preferYear = (key) => {
      if (!map.has(key)) return true;
      return thisHasYear && !hasYearInSlug(map.get(key));
    };
    // Exact slug match (for entries that somehow already have slugs)
    map.set(p.slug, p.slug);
    // Exact display name — prefer year-suffixed slug
    if (preferYear(p.display_name.toLowerCase())) {
      map.set(p.display_name.toLowerCase(), p.slug);
    }
    // Display name without parenthetical dates
    const noDate = stripDates(p.display_name).toLowerCase();
    if (noDate && noDate !== p.display_name.toLowerCase()) {
      if (preferYear(noDate)) map.set(noDate, p.slug);
    }
    // First name + last name (handles middle initials in relationship data)
    // When multiple people share first+last (6 James Telfers!), prefer year-suffixed slug
    if (p.first_name && p.last_name) {
      const firstLast = `${p.first_name.toLowerCase()} ${p.last_name.toLowerCase()}`;
      if (preferYear(firstLast)) map.set(firstLast, p.slug);
    }
    // Birth-year-suffixed variants for disambiguation
    // (so "James Telfer (1761–1845)" resolves to james-telfer-1761, not a random James Telfer)
    if (p.display_name && p.birth_year) {
      const displayNameLC = p.display_name.toLowerCase();
      if (p.death_year) {
        const key = `${displayNameLC} (${p.birth_year}–${p.death_year})`;
        if (preferYear(key)) map.set(key, p.slug);
      } else {
        const key = `${displayNameLC} (${p.birth_year}–)`;
        if (preferYear(key)) map.set(key, p.slug);
      }
      // Also just birth year alone
      const birthKey = `${displayNameLC} (${p.birth_year})`;
      if (preferYear(birthKey)) map.set(birthKey, p.slug);
    }
  }
  return map;
}

const nameToSlug = buildNameToSlug(people);

/** Resolve a relationship entry (display name or partial) to a slug if visible */
function resolveToVisible(entry) {
  if (!entry) return null;
  // Already a slug / person id — pass through directly if that person is visible.
  // Some relationships store slugs (e.g. "adam-telfer-1799") instead of display
  // names; previously these fell through every name-match and were dropped.
  const entryLC = entry.toLowerCase();
  if (slugToPerson.has(entryLC) || slugToPerson.has(entry)) {
    const exists = slugToPerson.has(entry) ? slugToPerson.get(entry) : slugToPerson.get(entryLC);
    const slug = exists ? (exists.slug || entry) : entry;
    return visible.has(slug) ? entry : null;
  }
  // Try the entry as-is
  if (nameToSlug.has(entryLC)) {
    const slug = nameToSlug.get(entryLC);
    return visible.has(slug) ? entry : null;
  }
  // Try without parenthetical dates
  const noDate = stripDates(entry).toLowerCase();
  if (noDate && noDate !== entryLC && nameToSlug.has(noDate)) {
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

// ─── Age-Gate Privacy Guardian ────────────────────────────────────────────────
//
// Owner decision (Aug 2026): anyone UNDER 18 must not have school, occupation,
// or any locating detail published — only name + relationships + DOB. A build
// time-of-run date makes the gate recompute automatically as people age past 18.
const BUILD_DATE = new Date(); // set at build; recomputes the gate each regenerate

/**
 * Strip locator detail (school/occupation/location) from a minor's bio.
 * Works at line level so a "School: Riverview HS" line is removed whole.
 * Only drops lines that clearly NAME a school/occupation/place for the minor,
 * leaving generic biographical statements intact.
 */
function guardMinorBio(text) {
  if (!text) return text;
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw;
    const trimmed = line.replace(/^\s*[-*+]\s*/, '').trim();
    // Drop explicitly-labelled locator/occupation lines (drop whole line)
    if (/^\*\*\s*(School|College|Occupation|Job|Work|Employer|Workplace|Residence|Resides|Lives|Lives at|Address|Worked at)\b/i.test(trimmed)) {
      continue;
    }
    // Drop bullet/line only when it NAMES a specific school/institution or a
    // specific residence for the minor — e.g. "at St John's College" —
    // but keep generic lines like "He attends school in Brisbane."
    if (/^\*\*\s*(School|College|Attends|Studied|S)|(attends|studies|studied|works|worked|employed)\b.*?\b(school|college|university|tafe)/i.test(line) &&
        /[A-Z][a-z]{2,}/.test(line)) {
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Redact exact street addresses from a LIVING person's public bio while leaving
 * suburban/town/state/region intact.
 *
 * Owner decision (Mark, Aug 2026): for adults, schools and workplaces are fine
 * to publish — the one thing we must NOT post is an EXACT street address.
 * Minors (<18) are handled separately by guardMinorBio (schools + workplaces +
 * addresses). Deceased people are never touched.
 *
 * SAFETY: we do NOT regex over free prose (too risky — dates like "28 August"
 * and years get misread as addresses). Instead we drop whole lines that are
 * EXPLICITLY labelled as an address, using the same line-level pattern
 * guardMinorBio already trusts. This is deterministic and can never mangle a
 * biography sentence. Suburbs/towns/states ("Redcliffe, Queensland") are kept.
 */
function redactLivingAddresses(text) {
  if (!text) return text;
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw;
    const trimmed = line.replace(/^\s*[-*+]\s*/, '').trim();
    // Drop a whole line that explicitly labels a physical address.
    // Matches: **Address:** 41 Brookfield Rd, Kenmore 4069
    //          - **Address:** 1 Chrystal St, Kippa Ring 4020
    //          Address: PO Box 1234  /  Postal address: ...
    // Does NOT touch suburb/state plain text or marriage "at [venue]".
    if (/^\*\*\s*(Address|Postal\s*Address)\b/i.test(trimmed) ||
        /^Address\s*:/i.test(trimmed)) {
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strip private/personal detail from a LIVING person's public bio down to the
 * owner-approved keep-list (owner decision, Mark, Aug 2026):
 *   KEEP   — full name, full DOB, family relationships (parents/siblings/
 *            spouse/children), marriage/divorce status, photos + captions.
 *   STRIP  — narrative bios (Life Summary / Notable Event / Family Stories),
 *            residence/locality (current OR listed), education/school,
 *            occupation/employer, diagnoses / mental-health, aliases /
 *            "also known as", personality, SOCIAL (facebook/instagram/etc.),
 *            and research-provenance (Source / Evidence / Facebook-Lead /
 *            Profile URL / who provided the lead + when).
 *
 * Applied to EVERY living person (after PII scrub, minor gate, and
 * living-address redaction). Deceased people are NEVER touched — per the
 * owner rule "once you're dead you're fair game even if your body is still
 * warm", deceased profiles keep their full published content.
 *
 * Deterministic + line/section based (same style as the existing address
 * guard): we drop whole labelled field-lines (bolded `**X:**`, bare `- X:`
 * bullets) and whole `## Section`s. We never regex over free prose (dates/
 * places get misread). Marriage/divorce survives because the `## Family`
 * table + `## Marriage` sections (spouse row, "m. date", ceremony) are
 * untouched. Family-table rows are pipe-delimited — never matched by the
 * dash-bullet field drops.
 */
function stripLivingPrivateContent(text) {
  if (!text) return text;

  // Sections dropped wholesale for living people (narrative/residence/
  // occupation/research-provenance).
  const DROP_SECTIONS = /^##\s*(Life Summary|Notable Event|Family Stories|Timeline|Timeline\s*\([^)]*\)|Notes|Residence|Residences|Residency|Occupations?|Qualifications?|Career|Employment|Work History|Education|Diagnoses?|Health|Aliases?|Also Known As|Source|Sources|Evidence|Research Notes|Research Notes[\s&]*Decisions|Leads?|Tracking|Facebook Lead|Profile URL|Citations?|References)\b/i;

  // Explicitly-labelled bolded field lines dropped wholesale (covers
  // `**Field:**`, `- **Field:**`).
  const DROP_FIELDS = /^\s*(?:-\s*)?\*\*\s*(Residence|Resides|Lives?|Lived|Located|Location|Address|Postal Address|Education|Studied|School|College|Occupation|Occupation\(s\)|Employer|Employer\(s\)|Work|Worked at|Job|Workplace|Diagnoses?|Diagnosis|Mental health|Health|Also known as|Alias|Aka|Nickname|Facebook|Facebook profile|Instagram|TikTok|Twitter|LinkedIn|Website|Social|Social media|Contact|Phone|Mobile|Profile URL|Access Date|Provided By|Evidence chain)[^:]*:/i;
  const DROP_FIELDS_BARE = /^\s*(?:-\s*)?\b(Residence|Resides|Lives?|Lived|Location|Address|Occupation|Education|Employer|School|Schooling|Contact|Phone|Mobile|Facebook|Instagram|TikTok|Twitter|LinkedIn|Website|Profile URL|Access Date|Provided By)\s*:/i;
  // Drop named-academic-qualification bullets (e.g. `- **Bachelor of Music
  //   Education** — University of Adelaide (2004–2007)`) which leak education
  //   detail that isn't a labelled `**Education:**` field line.
  const DROP_QUAL = /^\s*-\s*\*\*(Bachelor|Master|Masters|Diploma|Certificate|Degree|Graduate|Postgraduate|Studied|Ph\.?D|B\.\s?\w+|M\.\s?\w+|A\.\s?\w+)[^*]*\*\*/i;
  // Bare `- Social:` / `- Location:` bullets (label not bolded).
  const DROP_BARE_BULLET = /^\s*-\s*(Location|Employer|Occupation|Residence|Address|School|Schooling|Phone|Mobile|Facebook profile|Facebook|Instagram|TikTok|Twitter|LinkedIn|Website|Profile URL)\s*:/i;

  const out = [];
  let inDropSection = false;

  for (const raw of text.split('\n')) {
    const trimmed = raw.replace(/^\s*[-*+]\s*/, '').trim();

    // Enter/exit section stripping at `## ` headings.
    if (/^##\s/.test(trimmed)) {
      inDropSection = DROP_SECTIONS.test(trimmed);
      if (inDropSection) continue;         // heading itself dropped
    } else if (inDropSection) {
      continue;                            // content inside a dropped section
    }

    // Drop labelled sensitive field-lines (bolded, bare, or bullet forms).
    if (DROP_FIELDS.test(raw) || DROP_FIELDS_BARE.test(raw) || DROP_QUAL.test(raw) || DROP_BARE_BULLET.test(raw)) continue;

    out.push(raw);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Build Public Output ────────────────────────────────────────────────────
// buildPublicPeople() is exported + run-guarded so tests can import
// stripLivingPrivateContent without triggering the side-effectful write.

export function buildPublicPeople() {
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

  // ── Age gate (owner decision, Aug 2026): UNDER-18s get school/occupation/
  //    location detail stripped from their public bio. Gate recomputes every
  //    build as people age; unknown birth_year ⇒ treated as normal (no guess).
  const by = person.birth_year;
  if (typeof by === 'number') {
    const age = BUILD_DATE.getFullYear() - by;
    if (age < 18 && publicPerson.body_markdown) {
      publicPerson.body_markdown = guardMinorBio(publicPerson.body_markdown);
    }
  }

  // ── Living-ADDRESS gate (owner decision, Aug 2026): for adults, schools and
  //    workplaces are fine to publish — but NO EXACT STREET ADDRESS anywhere on
  //    a living person (suburb/town/state stays). Deceased people keep records.
  //    Runs for every living person (adult or minor) as a second pass after the
  //    minor gate, so any street address the minor gate missed is also caught.
  if (person.is_living && publicPerson.body_markdown) {
    publicPerson.body_markdown = redactLivingAddresses(publicPerson.body_markdown);
  }

  // ── LIVING-PRIVACY gate (owner decision, Aug 2026): every living person's
  //    public bio is stripped down to the keep-list (name, DOB, family
  //    relationships, marriage/divorce, photos w/ captions). Narrative bios,
  //    residence, education, occupation, diagnoses, aliases are dropped.
  //    Runs last, for every living person, after PII/minor/address passes.
  //    Deceased people are never touched.
  if (person.is_living && publicPerson.body_markdown) {
    publicPerson.body_markdown = stripLivingPrivateContent(publicPerson.body_markdown);
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
  total_trees: new Set(people.map(p => p.branch).filter(Boolean)).size || 1,
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

return publicPeople;
}

// ── Export the strip function so it can be unit-tested WITHOUT running the
//    side-effectful build (the write only happens on direct node execution). ──
export { stripLivingPrivateContent };

// ── Run directly (`node scripts/sanitize-people.mjs`) → build + write outputs.
//    Importing the module DOES NOT run the build (script/test-safe).
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  buildPublicPeople();
}
