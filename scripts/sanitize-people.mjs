#!/usr/bin/env node
/**
 * sanitize-people.mjs
 *
 * Build-time privacy filter for the Telfer Wiki.
 * Reads people.json, strips PII from living entries, writes people.public.json.
 *
 * Privacy rules for living people:
 *   - Birth: year ONLY, no full date, no birthplace
 *   - Remove: residence, email, phone, address, age, profile URLs
 *   - Remove: full marriage cert transcripts, timeline sections, life summaries
 *   - Remove: photos/images (living people shouldn't have identifiable photos public)
 *   - Keep: name, role, education, occupation, family relationship table
 *   - Keep: sidebar relationships (these link to other sanitized pages)
 *
 * Usage: node scripts/sanitize-people.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PEOPLE_JSON = path.resolve(__dirname, '..', 'src/data/people.json');
const PUBLIC_JSON = path.resolve(__dirname, '..', 'src/data/people.public.json');

/**
 * Check if a string contains a full birth date (DD Month YYYY or similar)
 */
function hasExactDate(str) {
  return /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i.test(str);
}

/**
 * Sanitize a living person's body_markdown to strip PII while keeping family context.
 */
function sanitizeBody(body, person) {
  if (!body) return '';

  const name = person.display_name;
  const birthYear = person.birth_year;

  // Extract key preserved fields
  let role = '';
  let education = '';
  let occupation = '';
  let alsoKnownAs = '';

  // Extract role from body
  const roleMatch = body.match(/\*\*Role:\*\*\s*(.+?)(?:\n|$)/);
  if (roleMatch) role = roleMatch[1].trim();

  const eduMatch = body.match(/\*\*Education:\*\*\s*(.+?)(?:\n|$)/);
  if (eduMatch) education = eduMatch[1].trim();

  const occMatch = body.match(/\*\*Occupation:\*\*\s*(.+?)(?:\n|$)/);
  if (occMatch) occupation = occMatch[1].trim();

  const akaMatch = body.match(/\*\*Also known as:\*\*\s*(.+?)(?:\n|$)/);
  if (akaMatch) alsoKnownAs = akaMatch[1].trim();

  // Extract Family table section - keep this (relationships are just names)
  const familySection = body.match(/## Family[\s\S]*?(?=## |$)/);
  const familyTable = familySection ? familySection[0].trim() : '';

  // Build minimal sanitized body
  let sanitized = `# ${name}\n\n`;

  if (role) sanitized += `**Role:** ${role}\n`;
  if (alsoKnownAs) sanitized += `**Also known as:** ${alsoKnownAs}\n`;
  if (birthYear) sanitized += `**Born:** ${birthYear}\n`;
  if (education) sanitized += `**Education:** ${education}\n`;
  if (occupation) sanitized += `**Occupation:** ${occupation}\n`;

  // Add Family table if present (it only contains links to other people, not PII)
  if (familyTable) {
    sanitized += `\n---\n\n${familyTable}\n`;
  }

  return sanitized;
}

/**
 * Sanitize a single person object.
 */
function sanitizePerson(person) {
  if (!person.is_living) {
    // Deceased people: just remove vault_path from images (internal paths shouldn't leak)
    if (person.images) {
      person.images = person.images.map(img => {
        const { vault_path, ...rest } = img;
        return rest;
      });
    }
    return person;
  }

  const sanitized = { ...person };

  // Sanitize body_markdown
  sanitized.body_markdown = sanitizeBody(person.body_markdown, person);

  // Strip images entirely for living people
  delete sanitized.images;
  delete sanitized.person_photo;

  // Strip vault_file path (internal only)
  delete sanitized.vault_file;

  // Strip vault_path from any remaining image entries
  if (sanitized.images) {
    sanitized.images = sanitized.images.map(img => {
      const { vault_path, ...rest } = img;
      return rest;
    });
  }

  return sanitized;
}

// ── Main ──
try {
  const raw = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
  console.log(`📋 Loaded ${raw.length} people (${raw.filter(p => p.is_living).length} living)`);

  const sanitized = raw.map(sanitizePerson);

  fs.writeFileSync(PUBLIC_JSON, JSON.stringify(sanitized, null, 2), 'utf-8');
  console.log(`✅ Wrote ${PUBLIC_JSON} (${sanitized.length} people, sanitized living entries)`);

  // Summary
  const living = sanitized.filter(p => p.is_living);
  let strippedCount = 0;
  for (const p of living) {
    const original = raw.find(r => r.id === p.id);
    if (original && original.body_markdown.length > p.body_markdown.length) {
      strippedCount++;
      const saved = original.body_markdown.length - p.body_markdown.length;
      console.log(`  🔒 ${p.display_name}: stripped ${saved} chars`);
    }
  }
  console.log(`\n🔒 ${strippedCount}/${living.length} living people sanitized`);
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}
