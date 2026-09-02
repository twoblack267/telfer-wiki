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

// ── Image handling ───────────────────────────────────────

const IMAGE_PATTERN = /!\[\[([^\]]+)\]\]/g;
const VAULT_BASE = path.resolve(process.env.HOME, 'ObsidianVault');
const PUBLIC_IMAGES_DIR = path.resolve(process.cwd(), 'public/images/people');

/** Resolve an Obsidian wikilink image path to absolute vault path */
function resolveVaultImage(wikilink) {
  // Strip size suffix: ![[path|400]] -> path
  const clean = wikilink.split('|')[0].trim();

  // Try vault-relative paths
  // Could be "Family History/People/Photos/file.jpg" or "Family History/_assets/file.jpg"
  const candidates = [
    path.join(VAULT_BASE, clean),
    path.join(VAULT_BASE, 'Family History', '_assets', path.basename(clean)),
    path.join(VAULT_BASE, 'Family History', 'People', 'Photos', path.basename(clean)),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Get the filename without vault path nesting, URL-safe */
function safeImageFilename(vaultPath) {
  let name = path.basename(vaultPath);
  // Replace spaces and special chars with hyphens
  name = name.replace(/[^a-zA-Z0-9._-]/g, '-');
  return name;
}

/** Convert ![[path|size]] in body markdown to standard markdown image syntax */
function convertObsidianImages(body) {
  if (!body) return { body, images: [] };

  const images = [];
  let result = body;

  let match;
  // Reset regex state
  IMAGE_PATTERN.lastIndex = 0;

  while ((match = IMAGE_PATTERN.exec(body)) !== null) {
    const fullMatch = match[0];
    const wikilink = match[1];
    const vaultPath = resolveVaultImage(wikilink);

    if (!vaultPath) {
      console.warn(`  ⚠️  Image not found on disk: ${wikilink}`);
      continue;
    }

    const filename = safeImageFilename(vaultPath);
    const ext = path.extname(vaultPath).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) continue;

    // Derive alt text from filename
    const altBase = path.basename(filename, ext).replace(/[-_]/g, ' ');
    const alt = altBase.charAt(0).toUpperCase() + altBase.slice(1);

    const publicSrc = `images/people/${filename}`;

    images.push({
      src: publicSrc,
      alt,
      vault_path: vaultPath,
      filename
    });

    // Replace Obsidian syntax with standard markdown image
    result = result.replace(fullMatch, `![${alt}](${publicSrc})`);
  }

  return { body: result, images };
}

// ── Helpers ──────────────────────────────────────────────

/** Generate bare slug: firstname-lastname (no year suffix) */
function toSlug(firstName, lastName) {
  return `${firstName} ${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripWikilinks(text) {
  return text ? text.replace(/\[\[([^\]]+)\]\]/g, '$1') : text;
}

function stripNotesAndLinks(text) {
  if (!text) return text;
  // Remove ## Notes section (everything from "## Notes" to next ## heading or end)
  text = text.replace(/## Notes[\s\S]*?(?=## |$)/g, '');
  // Remove ## Links section (everything from "## Links" to next ## heading or end)
  text = text.replace(/## Links[\s\S]*?(?=## |$)/g, '');
  // Remove the sealed Malcolm George Telfer discrepancy blockquote (vault-only
  // investigation; Mark ruled him out and it must not surface on the public wiki).
  // Only fires on a "Note" blockquote that names Malcolm + Discrepancy, so no other
  // profile content is affected. The original stays in the vault as source of truth.
  text = text.replace(/^>\s*\*\*Note:\*\*[\s\S]*?Malcolm George Telfer[\s\S]*?\n(?=\n|## |$)/gm, '');
  // Clean up extra blank lines left behind
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function stripSocialMedia(text) {
  if (!text) return text;
  // Remove **Facebook:** [text](URL) or - Facebook: [text](URL) lines
  text = text.replace(/(?:\*\*Facebook:\*\*|- Facebook:) \[([^\]]+)\]\(https?:\/\/(?:www\.)?facebook\.com\/[^\)]+\)(?:\s*)/gi, '');
  // Remove **TikTok:** [text](URL) or - TikTok: [text](URL) lines
  text = text.replace(/(?:\*\*TikTok:\*\*|- TikTok:) \[([^\]]+)\]\(https?:\/\/(?:www\.|vt\.)?tiktok\.com\/[^\)]+\)(?:\s*)/gi, '');
  // Remove **Instagram:** [text](URL) or - Instagram: [text](URL) lines
  text = text.replace(/(?:\*\*Instagram:\*\*|- Instagram:) \[([^\]]+)\]\(https?:\/\/(?:www\.)?instagram\.com\/[^\)]+\)(?:\s*)/gi, '');
  // Remove **Snapchat:** [text](URL) or - Snapchat: [text](URL) lines
  text = text.replace(/(?:\*\*Snapchat:\*\*|- Snapchat:) \[([^\]]+)\]\(https?:\/\/(?:www\.)?snapchat\.com\/[^\)]+\)(?:\s*)/gi, '');
  // Remove bare markdown links to social media URLs (e.g. [text](facebook.com/...))
  text = text.replace(/\[([^\]]+)\]\(https?:\/\/(?:www\.)?(?:facebook|tiktok|instagram|twitter|x\.com|linkedin|snapchat|youtube|pinterest)\.com\/[^\)]+\)/gi, '');
  // Remove bare social media URLs
  text = text.replace(/https?:\/\/(?:www\.|vt\.)?(?:facebook|tiktok|instagram|twitter|x\.com|linkedin|snapchat|youtube|pinterest)\.com\/[^\s\)\]\}]*/gi, '');
  // Remove **Source:** Facebook / TikTok / Instagram lines (orphaned source labels without URLs)
  text = text.replace(/(?:\*\*|- )Source:\*\*? (?:Facebook|TikTok|Instagram|Twitter|YouTube|LinkedIn)[.,]?\s*/gi, '');
  // Remove - Facebook: / - LinkedIn: / - Instagram: / - TikTok: / - Twitter: / - YouTube: / - Snapchat: / - Pinterest: labels (list format without URL)
  text = text.replace(/^- (?:Facebook|LinkedIn|Instagram|TikTok|Twitter|YouTube|Snapchat|Pinterest|Profile URL):.*$/gim, '');
  // Clean up empty lines left behind
  return text.replace(/\n{3,}/g, '\n\n').trim();
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

  // Split name-lists on commas, but NOT commas nested inside parentheses —
  // a place-qualified single person like "Richard Paynter (of Calstock, Cornwall)"
  // must stay as ONE name, not be torn apart at the comma inside the parens.
  function splitNames(namesStr) {
    const out = [];
    let depth = 0;
    let current = '';
    for (const ch of namesStr) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        const t = current.trim();
        if (t) out.push(stripWikilinks(t));
        current = '';
      } else {
        current += ch;
      }
    }
    const last = current.trim();
    if (last) out.push(stripWikilinks(last));
    return out;
  }

  const parts = relStr.split('|').map(s => s.trim()).filter(Boolean);
  const result = [];

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const type = part.slice(0, colonIdx).trim();
    const namesStr = part.slice(colonIdx + 1).trim();
    const names = splitNames(namesStr);
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
  // Prefer year-suffixed slug (canonical over bare stub) when keys collide.
  // NOTE: concatenate first+last before lowercasing so the key is robust to
  // inconsistent first/last split points (e.g. "Mary"+"Anne McIntyre" vs
  // "Mary Anne"+"McIntyre") — otherwise a legitimate re-merge dedupes to the
  // wrong person or spawns a duplicate.
  const existingByKey = new Map();
  for (const p of existingPeople) {
    // Include middle_name in the key ONLY when birth_year is absent. Two people with
    // the same first+last AND no birth year collide under a first+last-only key (they
    // cover the same key). Adding the middle name disambiguates them (e.g. John Alick
    // Ralph Telfer vs John Robert Telfer). People WITH a birth year keep the exact
    // first+last+year key, so they are unaffected (zero regression).
    const by = p.birth_year ?? '';
    const namePart = by ? `${(p.first_name || '')}${(p.last_name || '')}` : `${(p.first_name || '')}${(p.middle_name || '')}${(p.last_name || '')}`;
    const key = `${namePart}|${by}`;
    const keyLower = key.toLowerCase().replace(/\s+/g, '');
    const existing = existingByKey.get(keyLower);
    if (!existing) {
      existingByKey.set(keyLower, p);
    } else {
      // Key collision — prefer the entry with a year-suffixed slug
      const existingHasYear = /\d{4}$/.test(existing.slug || '');
      const thisHasYear = /\d{4}$/.test(p.slug || '');
      if (thisHasYear && !existingHasYear) {
        existingByKey.set(keyLower, p);
      }
      // Otherwise keep existing (year-suffixed already, or both same type)
    }
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

    // ── Redirect stubs: skip files that are placeholders for a canonical profile ──
    // A vault file whose title marks it as a "redirect" (e.g. "... (redirect)")
    // is not a real profile — it points at a canonical entry elsewhere. Skipping
    // them prevents phantom/stub records from regenerating, and lets the orphan
    // purge below drop any previously-accumulated stub entries.
    const rawTitle = (fm.title || '').toString().toLowerCase();
    if (rawTitle.includes('redirect')) {
      console.log(`  ↩️  SKIP redirect stub: ${file}`);
      skipped++;
      continue;
    }

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

    // Safe year parsing: handle undefined, null, string 'None', NaN, and falsy values.
    // Also accept approximation prefixes ("~1885", "c.1885", "approx 1885") — the
    // vault uses "~" for estimated years, and Number() alone would yield NaN and drop
    // them, wrongly marking the person as living (e.g. Florence Nicholas ~1885/~1960).
    const safeYear = (v) => {
      if (v == null || v === false || v === '') return null;
      if (typeof v === 'number') return isFinite(v) ? v : null;
      const s = String(v).trim().replace(/^[~\s]+/, '').replace(/^c\.?\s*/i, '').replace(/^approx(imately)?\s*/i, '');
      const n = Number(s);
      return (!isNaN(n) && isFinite(n)) ? n : null;
    };
    // Track whether the source used an approximation marker (~ / c. / approx) so the
    // display can keep it, e.g. "~1885" rather than silently presenting an exact year.
    const approxYear = (v) => {
      if (v == null || v === '') return false;
      return /^[~]|^c\.?\s/i.test(String(v).trim()) || /^approx(imately)?\s/i.test(String(v).trim());
    };
    const birthYear = safeYear(fm.birth_year);
    const deathYear = safeYear(fm.death_year);
    const birthApprox = approxYear(fm.birth_year);
    const deathApprox = approxYear(fm.death_year);

    // Generate slug WITHOUT middle name to match existing convention
    const slug = toSlug(firstName, lastName);

    const currentYear = new Date().getFullYear();
    // Living status: a death year means deceased. If no death year is recorded but the
    // person is known to be deceased (frontmatter `deceased: true`), respect that —
    // some historical ancestors are clearly gone (e.g. children of people born 1827/1832)
    // yet their exact dates were never recorded. Without this flag, they'd be wrongly
    // shown as "living". This lets us mark them deceased-honestly WITHOUT inventing a
    // death year (fabrication is banned). death_year always takes precedence.
    const deceasedFlag = fm.deceased === true || fm.deceased === 'true' || fm.is_deceased === true || fm.is_deceased === 'true';
    const isLiving = deathYear != null ? false
      : deceasedFlag ? false
      : birthYear != null ? (currentYear - birthYear < 120)
      : true;
    const birthYearDisplay = birthYear != null ? (birthApprox ? `~${birthYear}` : String(birthYear)) : '?';
    const deathYearDisplay = deathYear != null ? (deathApprox ? `~${deathYear}` : String(deathYear)) : (isLiving ? 'living' : '?');
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

    // ── Flat-field schema support ─────────────────────────────────────────────
    // Some vault files store relationships as flat frontmatter fields instead of a
    // `relationships:` string: `father:`, `mother:` (singular) plus `children:`
    // and `spouse:` (arrays/lists of names). Previously these were DEAD — the
    // converter only read `fm.relationships`, so a flat-file's children/parents
    // never reached the build (e.g. Sophia Baker's children stayed empty). Merge
    // them in when present and not already supplied by the string form. Prefer
    // the explicit `relationships:` string when it defines a given role.
    const flatParent = [fm.father, fm.mother].filter(Boolean).map(String);
    const flatSpouses = Array.isArray(fm.spouse) ? fm.spouse.map(String) : (fm.spouse ? [String(fm.spouse)] : []);
    const flatChildren = Array.isArray(fm.children) ? fm.children.map(String) : (fm.children ? [String(fm.children)] : []);
    if (parents.length === 0 && flatParent.length > 0) parents.push(...flatParent);
    if (spouses.length === 0 && flatSpouses.length > 0) spouses.push(...flatSpouses);
    if (children.length === 0 && flatChildren.length > 0) children.push(...flatChildren);
    // No flat-field sibling support: sibling lists only come from the string form.


    const roles = extractRoles(body);
    const bodyClean = cleanPII(body);
    const { body: bodyWithImages, images: bodyImages } = convertObsidianImages(bodyClean);
    const bodySanitized = stripSocialMedia(stripNotesAndLinks(bodyWithImages));
    const title = fm.title || `${displayName} — Family & Biography`;
    const bodyStripped = bioSummary(bodySanitized);

    // Record vault filename for traceability
    const vaultFile = file;

    const entry = {
      id: displayName,
      slug,
      vault_file: vaultFile,
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
      body_markdown: bodySanitized,
      body_stripped: bodyStripped,
      parents,
      children,
      siblings,
      spouses,
      is_living: isLiving,
      lifespan,
      related_trees: fm.related_trees || ['telfer-tree'],
      images: bodyImages.length > 0 ? bodyImages : [],
      // person_photo = the profile's circular AVATAR. Must be a photo OF the
      // person, never a grave OR a scenery/place book-plate. Book-page scans
      // use the `_p{N}` suffix (e.g. Newcastleton_and_the_Liddesdale_Hills_p6.jpg);
      // those are historical-place illustrations for the Photos GALLERY, not a
      // portrait. If every image is a grave or scenery plate (no photograph of
      // the person survives), fall back to the initials avatar (null).
      person_photo: bodyImages.find(img => !img.src.includes('grave') && !/_[pP]\d+\.jpg$/.test(img.src))?.src || null
    };

    // 3. Find matching existing entry
    // Priority: key match first, then slug match (fallback).
    // Key must concatenate name exactly as the index builder does, so first/last
    // split inconsistencies still merge to the same person. For people with a birth
    // year the key is first+last+birth_year (unchanged). For people WITHOUT a birth
    // year the middle name is included so two no-year same-first+last people do not
    // collide (e.g. John Alick Ralph Telfer vs John Robert Telfer).
    const matchKey = (birthYear
      ? `${firstName}${lastName}|${birthYear}`
      : `${firstName}${middleName || ''}${lastName}|`
    ).toLowerCase().replace(/\s+/g, '');
    let existing = existingByKey.get(matchKey);
    // Fall back to slug match ONLY when the incoming profile has no birth year.
    // A birth-year key (first+last|YYYY) is authoritative and disambiguates
    // same-first+last people of different generations (e.g. John Watson 1851 vs
    // John Watson 1916). If the year key misses, that's a genuinely new person —
    // falling back to the bare slug would let a same-name-different-year profile
    // capture (and overwrite) the wrong generation's record. No-year profiles
    // have no year discriminator, so the bare slug is their correct match.
    if (!existing && birthYear == null) {
      existing = existingBySlug.get(slug);
    }

    if (existing) {
      // Update — overwrite fields from markdown, keep existing denormalized
      // Slug preservation: don't regress an already-disambiguated slug to a
      // bare form. Existing slugs may carry a year suffix (-1805), a descriptive
      // suffix (-robert, -of-castleton) or a living marker (-living); the incoming
      // markdown file's bare slug would collide with / sit ambiguously beside
      // genuinely distinct people. Keep the existing explicit slug so a rerun
      // never merges distinct profiles or shortens a URL the committed scheme
      // deliberately disambiguated. Rule: preserve whenever the existing slug is
      // "incoming bare slug" + a disambiguating suffix (any suffix after a dash).
      const existingIsStrictSuperset =
        existing.slug && entry.slug &&
        existing.slug.startsWith(entry.slug) &&
        existing.slug.length > entry.slug.length &&
        existing.slug[entry.slug.length] === '-';
      const incomingBare = !/-\d{4}$/.test(entry.slug || '');
      if (!(existingIsStrictSuperset && incomingBare)) {
        existing.slug = entry.slug;
      }
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
      existing.vault_file = entry.vault_file;
      existing.tags = entry.tags;
      existing.relationships = entry.relationships;
      existing.roles = entry.roles.length > 0 ? entry.roles : (existing.roles || []);
      if (entry.body_markdown && entry.body_markdown.trim()) {
        existing.body_markdown = entry.body_markdown;
        existing.body_stripped = entry.body_stripped;
      }
      // If the vault file explicitly had a relationships field, trust what we parsed
      // (even if empty — this allows removing children/spouses etc by omitting them).
      // Only fall back to existing data when relationships was entirely absent.
      if (fm.relationships && typeof fm.relationships === 'string') {
        existing.parents = parents;
        existing.children = children;
        existing.siblings = siblings;
        existing.spouses = spouses;
      } else {
        // No relationships field in vault — keep existing denormalized data
        existing.parents = parents.length > 0 ? parents : existing.parents;
        existing.children = children.length > 0 ? children : existing.children;
        existing.siblings = siblings.length > 0 ? siblings : existing.siblings;
        existing.spouses = spouses.length > 0 ? spouses : existing.spouses;
      }
      existing.related_trees = entry.related_trees;
      // Images are source-of-truth from the vault body. If the processed vault
      // file no longer references any image, clear stale images/person_photo so
      // removed photos don't persist on the live page (privacy + correctness).
      if (bodyImages.length > 0) {
        existing.images = bodyImages;
        existing.person_photo = entry.person_photo;
      } else {
        existing.images = [];
        existing.person_photo = null;
      }
      updated++;
    } else {
      existingPeople.push(entry);
      added++;
    }
  }

  // ── Orphan purge: drop entries whose vault file no longer exists ────────
  // Records carrying a vault_file that is absent from the vault AND wasn't
  // processed this run are orphans (vault file renamed/deleted but the entry
  // survived in people.json). Purge them so they don't re-accumulate. Entries
  // with no vault_file (manually curated) are always preserved.
  const vaultDirExists = fs.existsSync(VAULT_PEOPLE_DIR);
  const vaultFilesNow = vaultDirExists
    ? new Set(fs.readdirSync(VAULT_PEOPLE_DIR))
    : new Set();
  // Redirect-stub filenames: files whose title marks them as placeholders for a
  // canonical profile. Any record sourced from one of these is a phantom and
  // must be purged even though the file itself still exists on disk.
  const redirectStubFiles = new Set();
  if (vaultDirExists) {
    for (const f of vaultFilesNow) {
      if (!f.endsWith('.md')) continue;
      try {
        const fm = matter(fs.readFileSync(path.join(VAULT_PEOPLE_DIR, f), 'utf-8')).data;
        if ((fm.title || '').toString().toLowerCase().includes('redirect')) {
          redirectStubFiles.add(f);
        }
      } catch { /* unreadable/tiny stub — ignore */ }
    }
  }
  const processedFiles = new Set(mdFiles); // files we just parsed & merged
  const beforePurge = existingPeople.length;
  const keep = [];
  for (const p of existingPeople) {
    const vf = p.vault_file;
    // Keep if manually curated (no vault_file) and the file is a real,
    // non-redirect profile. Purge if: file missing, OR it's a redirect stub.
    if (!vf) {
      keep.push(p);
    } else if (vaultFilesNow.has(vf) || processedFiles.has(vf)) {
      if (redirectStubFiles.has(vf)) {
        console.log(`  🧹 PURGED phantom (redirect stub source): ${p.display_name || p.slug} [${vf}]`);
      } else {
        keep.push(p);
      }
    } else {
      console.log(`  🧹 PURGED orphan (vault file missing): ${p.display_name || p.slug} [${vf}]`);
    }
  }
  existingPeople = keep;
  const purged = beforePurge - existingPeople.length;
  if (purged > 0) {
    console.log(`  🧹 Orphan purge: removed ${purged} stale record(s)`);
  } else {
    console.log(`  🧹 Orphan purge: no stale records to remove`);
  }

  // ── Slug disambiguation: detect bare-slug conflicts, append year suffix ──
  const bareSlugCounts = {};
  for (const p of existingPeople) {
    bareSlugCounts[p.slug] = (bareSlugCounts[p.slug] || 0) + 1;
  }
  const conflictedSlugs = new Set(
    Object.entries(bareSlugCounts)
      .filter(([, count]) => count > 1)
      .map(([slug]) => slug)
  );
  if (conflictedSlugs.size > 0) {
    console.log(`⚠️  ${conflictedSlugs.size} bare slug(s) have conflicts — disambiguating:`);
    for (const p of existingPeople) {
      if (conflictedSlugs.has(p.slug)) {
        // Preference: birth_year → death_year → middle name fragment → -living
        let suffix;
        if (p.birth_year != null) {
          suffix = String(p.birth_year);
        } else if (p.death_year != null) {
          suffix = String(p.death_year);
        } else {
          // Extract middle name from display_name (e.g. "Amy Nicole Telfer" → "nicole")
          const parts = (p.display_name || '').trim().split(/\s+/);
          if (parts.length > 2) {
            suffix = parts.slice(1, -1).join('-').toLowerCase();
          } else {
            suffix = 'living';
          }
        }
        p.slug = p.slug + '-' + suffix;
        console.log(`  ${p.display_name} → ${p.slug}`);
      }
    }
  }

  // 4. Write back
  fs.writeFileSync(PEOPLE_JSON, JSON.stringify(existingPeople, null, 2) + '\n', 'utf-8');

  console.log(`\n✅ Done! ${added} added, ${updated} updated, ${skipped} skipped`);
  console.log(`📊 Total: ${existingPeople.length} profiles in people.json`);

  // 5. Copy images to public directory
  let imagesCopied = 0;
  let imagesSkipped = 0;
  if (!fs.existsSync(PUBLIC_IMAGES_DIR)) {
    fs.mkdirSync(PUBLIC_IMAGES_DIR, { recursive: true });
  }

  const seenFilenames = new Set();
  for (const p of existingPeople) {
    for (const img of p.images || []) {
      if (!img.vault_path || seenFilenames.has(img.filename)) continue;
      seenFilenames.add(img.filename);
      const dest = path.join(PUBLIC_IMAGES_DIR, img.filename);
      if (fs.existsSync(img.vault_path)) {
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(img.vault_path, dest);
          imagesCopied++;
        } else {
          imagesSkipped++;
        }
      } else {
        console.warn(`  ⚠️  Missing vault image: ${img.vault_path}`);
      }
    }
  }
  console.log(`🖼️  Images: ${imagesCopied} copied, ${imagesSkipped} already exist`);
}

main();
