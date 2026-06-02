#!/usr/bin/env node
/**
 * convert-markdown.mjs
 *
 * Reads markdown profiles from the Obsidian vault (Family History/People/),
 * merges them into people.json, and preserves existing data.
 *
 * Usage: node scripts/convert-markdown.mjs
 *
 * Workflow:
 *   1. Scan ~/ObsidianVault/Family History/People/ for .md files
 *   2. Parse YAML frontmatter + body via gray-matter
 *   3. Build people.json entries with all computed fields
 *   4. Merge with existing people.json (updates existing, adds new)
 *   5. Write back to src/data/people.json
 */

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const VAULT_PEOPLE_DIR = path.resolve(process.env.HOME, 'ObsidianVault/Family History/People');
const PEOPLE_JSON = path.resolve(process.cwd(), 'src/data/people.json');

// ── Helpers ──────────────────────────────────────────────

/** Generate slug matching existing convention: firstname-lastname-birthyear */
function toSlug(firstName, lastName, birthYear) {
  let slug = `${firstName} ${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (birthYear != null) slug += '-' + birthYear;
  return slug;
}

function stripWikilinks(text) {
  return text ? text.replace(/\[\[([^\]]+)\]\]/g, '$1') : text;
}

function cleanPII(text) {
  if (!text) return text;
  text = text.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email redacted]');
  text = text.replace(/0[45]\d{1,2}\s*\d{3}\s*\d{3}/g, '[phone redacted]');
  text = text.replace(/\+61\s*[45]\d{1,2}\s*\d{3}\s*\d{3}/g, '[phone redacted]');
  // Street-level addresses: house number + street name + suffix + suburb + state + postcode
  // NO nested quantifiers — single char class to avoid catastrophic backtracking
  text = text.replace(/\b\d{1,4}\s+[A-Za-z][A-Za-z\s,.'\-]+\b(?:Street|St|Road|Rd|Drive|Dr|Avenue|Ave|Lane|Ln|Place|Pl|Court|Ct|Terrace|Tce|Crescent|Cres|Parade|Highway|Hwy|Boulevard|Blvd|Circuit|Close|Way)[.,]?\s+[A-Za-z][A-Za-z\s.'\-]*(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s+\d{4}/gi, '[address redacted]');
  // Backup: any number + letters + state + postcode (catches edge cases)
  text = text.replace(/\d+\s+[A-Za-z][A-Za-z\s,.\-']*(?:QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\s+\d{4}/g, '[address redacted]');
  return text;
}

function parseRelationships(relStr) {
  if (!relStr || typeof relStr !== 'string') return [];

  const parts = relStr.split('|').map(s => s.trim()).filter(Boolean);
  const result = [];

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const type = part.slice(0, colonIdx).trim();
    const namesStr = part.slice(colonIdx + 1).trim();
    const names = namesStr.split(',').map(s => stripWikilinks(s.trim())).filter(Boolean);
    if (names.length > 0) result.push({ type, names });
  }

  return result;
}

function extractRoles(body) {
  if (!body) return [];
  const match = body.match(/\*\*Role[:\s]+\*\*(.+?)(?:\n|$)/i);
  return match ? [match[1].trim()] : [];
}

function bioSummary(bodyMarkdown) {
  if (!bodyMarkdown) return '';
  return bodyMarkdown
    .replace(/^#\s+.*$/gm, '')
    .replace(/---+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\|/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500);
}

// ── Main ─────────────────────────────────────────────────

function main() {
  // 1. Read existing people.json
  let existingPeople = [];
  if (fs.existsSync(PEOPLE_JSON)) {
    existingPeople = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
  }
  const existingBySlug = new Map(existingPeople.map(p => [p.slug, p]));

  // Build secondary index: first_name + last_name + birth_year → existing entry
  const existingByKey = new Map();
  for (const p of existingPeople) {
    const key = `${p.first_name}|${p.last_name}|${p.birth_year ?? ''}`;
    existingByKey.set(key.toLowerCase(), p);
  }

  // 2. Scan vault markdown files
  if (!fs.existsSync(VAULT_PEOPLE_DIR)) {
    console.error(`❌ Vault directory not found: ${VAULT_PEOPLE_DIR}`);
    process.exit(1);
  }

  const mdFiles = fs.readdirSync(VAULT_PEOPLE_DIR)
    .filter(f => f.endsWith('.md') && !['_Index.md', 'Leads.md'].includes(f))
    .sort();

  console.log(`📁 Found ${mdFiles.length} markdown files in vault`);
  console.log(`📄 Existing people.json: ${existingPeople.length} entries`);

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const file of mdFiles) {
    const filePath = path.join(VAULT_PEOPLE_DIR, file);
    const raw = fs.readFileSync(filePath, 'utf-8');

    let parsed;
    try {
      parsed = matter(raw);
    } catch (e) {
      console.warn(`  ⚠️  Could not parse ${file}: ${e.message}`);
      skipped++;
      continue;
    }

    const { data: fm, content: body } = parsed;
    const firstName = (fm.first_name || '').trim();
    const lastName = (fm.last_name || '').trim();
    const middleNameRaw = (fm.middle_name || '').trim();
    const middleName = middleNameRaw && middleNameRaw !== 'null' ? middleNameRaw : null;

    if (!firstName || !lastName) {
      console.warn(`  ⚠️  Skipping ${file}: missing first_name or last_name`);
      skipped++;
      continue;
    }

    const displayName = middleName
      ? `${firstName} ${middleName} ${lastName}`
      : `${firstName} ${lastName}`;

    const birthYear = fm.birth_year != null ? Number(fm.birth_year) : null;
    const deathYear = fm.death_year != null ? Number(fm.death_year) : null;

    // Generate slug WITHOUT middle name to match existing convention
    const slug = toSlug(firstName, lastName, birthYear);

    const isLiving = deathYear == null;
    const birthYearDisplay = birthYear != null ? String(birthYear) : '?';
    const deathYearDisplay = deathYear != null ? String(deathYear) : (birthYear != null ? 'living' : '?');
    const lifespan = `${birthYearDisplay} – ${deathYearDisplay}`;

    const tags = Array.isArray(fm.tags) && fm.tags.length > 0
      ? fm.tags : ['bio', 'family', 'person'];

    // Relationships
    const relationships = parseRelationships(fm.relationships);
    const parents = [];
    const children = [];
    const siblings = [];
    const spouses = [];
    for (const rel of relationships) {
      const t = rel.type.toLowerCase();
      if (['mother', 'father', 'parent'].includes(t)) {
        parents.push(...rel.names);
      } else if (['children', 'child'].includes(t)) {
        children.push(...rel.names);
      } else if (['siblings', 'sibling', 'brother', 'sister'].includes(t)) {
        siblings.push(...rel.names);
      } else if (['spouse', 'spouses', 'husband', 'wife'].includes(t)) {
        spouses.push(...rel.names);
      }
    }

    const roles = extractRoles(body);
    const bodyClean = cleanPII(body);
    const title = fm.title || `${displayName} — Family & Biography`;
    const bodyStripped = bioSummary(bodyClean);

    const entry = {
      id: displayName,
      slug,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      birth_year: birthYear,
      death_year: deathYear,
      birth_year_display: birthYearDisplay,
      death_year_display: deathYearDisplay,
      display_name: displayName,
      title,
      tags,
      relationships,
      roles,
      body_markdown: bodyClean,
      body_stripped: bodyStripped,
      parents,
      children,
      siblings,
      spouses,
      is_living: isLiving,
      lifespan,
      related_trees: fm.related_trees || ['telfer-tree'],
      images: []
    };

    // 3. Find matching existing entry
    // Priority: first_name+last_name+birth_year key match, then slug match
    const matchKey = `${firstName}|${lastName}|${birthYear ?? ''}`.toLowerCase();
    let existing = existingByKey.get(matchKey) || existingBySlug.get(slug);

    if (existing) {
      // Update — overwrite fields from markdown, keep existing denormalized
      existing.display_name = entry.display_name;
      existing.id = entry.display_name;
      existing.title = entry.title;
      existing.first_name = entry.first_name;
      existing.middle_name = entry.middle_name;
      existing.last_name = entry.last_name;
      existing.birth_year = entry.birth_year;
      existing.death_year = entry.death_year;
      existing.birth_year_display = entry.birth_year_display;
      existing.death_year_display = entry.death_year_display;
      existing.is_living = entry.is_living;
      existing.lifespan = entry.lifespan;
      existing.tags = entry.tags;
      existing.relationships = entry.relationships;
      existing.roles = entry.roles.length > 0 ? entry.roles : existing.roles;
      if (entry.body_markdown && entry.body_markdown.trim()) {
        existing.body_markdown = entry.body_markdown;
        existing.body_stripped = entry.body_stripped;
      }
      // Keep existing denormalized fields if markdown doesn't provide them
      existing.parents = parents.length > 0 ? parents : existing.parents;
      existing.children = children.length > 0 ? children : existing.children;
      existing.siblings = siblings.length > 0 ? siblings : existing.siblings;
      existing.spouses = spouses.length > 0 ? spouses : existing.spouses;
      existing.related_trees = entry.related_trees;
      if (!existing.images) existing.images = [];
      updated++;
    } else {
      existingPeople.push(entry);
      added++;
    }
  }

  // 4. Write back
  fs.writeFileSync(PEOPLE_JSON, JSON.stringify(existingPeople, null, 2) + '\n', 'utf-8');

  console.log(`\n✅ Done! ${added} added, ${updated} updated, ${skipped} skipped`);
  console.log(`📊 Total: ${existingPeople.length} profiles in people.json`);
}

main();
