#!/usr/bin/env node
/**
 * sanitize-people.mjs
 *
 * Build-time privacy filter for the Telfer Wiki.
 * Reads people.json, strips PII from living entries, writes people.public.json.
 *
 * Privacy rules for living people (surgical — keeps everything else):
 *   - Remove: email addresses
 *   - Remove: phone numbers
 *   - Remove: birth / marriage certificate registration numbers
 *   - Remove: full street addresses (keep suburb / area / town)
 *   - Remove: Facebook, LinkedIn profile URLs
 *   - Remove: vault_path from images (internal paths shouldn't leak)
 *   - Keep EVERYTHING else: life stories, photos, timeline, DOB, residence area,
 *     marriage details (minus cert numbers), photo galleries, images array
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
 * Sanitize body_markdown with surgical lookups rather than full rebuild.
 */
function sanitizeBody(body) {
  if (!body) return '';

  let clean = body;

  // 1. Remove email addresses
  clean = clean.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email redacted]');

  // 2. Remove phone numbers (Australian)
  // Matches 04XX XXX XXX, 07XX XXX XXX, +61 4XX XXX XXX, 1800 numbers, landline patterns
  clean = clean.replace(/(?:\+?61[\s-]?)?\(?\d{2,3}\)?[\s-]?\d{3}[\s-]?\d{3,4}\b/g, '[phone redacted]');

  // 3. Remove birth / marriage certificate registration numbers
  // e.g. "Reg. No. 1981/16975", "Registration Number: 1981/16975"
  clean = clean.replace(/(?:Reg(?:istration)?\.?\s*(?:No\.|Number)?:?\s*)\d{4}\/\d+\b/gi, '[certificate registration redacted]');
  clean = clean.replace(/\*\*Registration Number:\*\*\s*\d{4}\/\d+/g, '**Registration Number:** [redacted]');

  // 4. Remove full street addresses (keep suburb/area)
  // Matches lines starting with a street number or PO Box
  clean = clean.replace(/^\d+\s+[A-Za-z\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Place|Pl|Close|Crescent|Cres|Lane|Way|Court|Ct|Highway|Hwy|Terrace|Tce)[,\s]+[A-Za-z\s]+\d{4}\b/gim, '[address redacted]');
  clean = clean.replace(/^PO\s+Box\s+\d+/gim, '[address redacted]');

  // 5. Remove Facebook URLs
  clean = clean.replace(/https?:\/\/(?:www\.)?facebook\.com\/[^\s)]+/gi, '[Facebook link redacted]');
  clean = clean.replace(/<!-- Facebook[^>]*-->/gi, '');
  clean = clean.replace(/\*\*Facebook:\*\*[^\n]*/gi, '');

  // 6. Remove LinkedIn URLs
  clean = clean.replace(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/gi, '[LinkedIn link redacted]');
  clean = clean.replace(/<!-- LinkedIn[^>]*-->/gi, '');

  // 7. Clean up empty **Field: \n** patterns left behind
  clean = clean.replace(/\*\*Facebook:\*\*\s*\n/g, '');
  clean = clean.replace(/\*\*LinkedIn:\*\*\s*\n/g, '');

  // 8. Strip vault_path from markdown image references (shouldn't happen in body, but just in case)
  clean = clean.replace(/\|?\s*vault_path:\s*"[^"]*"\s*$/gm, '');
  clean = clean.replace(/vault_path:\s*\/[^\s,}\]]+/g, '');

  return clean.trim();
}

/**
 * Sanitize a single person object.
 */
function sanitizePerson(person) {
  const sanitized = { ...person };

  // Strip vault_path from images (internal paths shouldn't leak)
  if (sanitized.images) {
    sanitized.images = sanitized.images.map(img => {
      const { vault_path, ...rest } = img;
      return rest;
    });
  }

  // Strip vault_file path for all people (internal only)
  delete sanitized.vault_file;

  if (!person.is_living) {
    // Deceased people: just removed vault_path from images above
    return sanitized;
  }

  // Living people: surgical body sanitization
  sanitized.body_markdown = sanitizeBody(person.body_markdown);

  // Strip parenthetical birth-death dates from relationship arrays
  // "Mark Kenneth Telfer (1986–?)" → "Mark Kenneth Telfer"
  // For living people only — deceased keep their dates
  const stripDatesFromName = (name) => name.replace(/\s*\(\d{4}–[^)]*\)/g, '').trim();

  for (const field of ['parents', 'spouses', 'children', 'siblings']) {
    if (sanitized[field] && Array.isArray(sanitized[field])) {
      sanitized[field] = sanitized[field].map(stripDatesFromName);
    }
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
  let changedCount = 0;
  for (const p of living) {
    const original = raw.find(r => r.id === p.id);
    if (original && original.body_markdown !== p.body_markdown) {
      changedCount++;
      const saved = original.body_markdown.length - p.body_markdown.length;
      console.log(`  🔒 ${p.display_name}: stripped ${saved} chars`);
    }
  }
  console.log(`\n🔒 ${changedCount}/${living.length} living people sanitized`);
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}
