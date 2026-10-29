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

// ── Redirect-stub detection (SINGLE SOURCE OF TRUTH) ─────────────────────
// A redirect stub is a vault file that exists only to point at a canonical
// profile elsewhere — it is NOT a person. It must never be published.
//
// Detection is TAG-FIRST, title second:
//   • frontmatter `tags:` contains an exact `redirect` entry  → authoritative
//   • else `title` contains the word "redirect"               → legacy fallback
//
// Why tag-first: tags are structured data authored deliberately; titles are
// free prose. Three stubs (`Elizabeth Hannah (1836–1916)`, `Elizabeth Telfer
// Farrow`, `Sophia Parker`) carried the `redirect` TAG but a title with no
// "redirect" word, so the old title-only test leaked them live as duplicate
// person pages. Never test the title alone.
const REDIRECT_TAG_PATTERN = /^\s*-\s*['"]?redirect['"]?\s*$/im;
const REDIRECT_TITLE_PATTERN = /\bredirect\b/i;

/** True if frontmatter marks this file as a redirect stub (tag-first). */
function isRedirectStub(fm) {
  if (!fm) return false;
  const title = (fm.title || '').toString();
  // Explicit title marker (legacy, but unambiguous when present).
  if (REDIRECT_TITLE_PATTERN.test(title)) return true;
  // Tag marker — authoritative. Handles `tags: [a, redirect]` and block lists.
  const tags = fm.tags;
  if (Array.isArray(tags)) {
    return tags.some((t) => String(t).trim().toLowerCase() === 'redirect');
  }
  if (typeof tags === 'string') {
    return tags.split(/[,\s]+/).some((t) => t.trim().toLowerCase() === 'redirect');
  }
  return false;
}

/** Parse a vault file's frontmatter, or null when unreadable/tiny. */
function readFrontmatter(absPath) {
  try {
    return matter(fs.readFileSync(absPath, 'utf-8')).data || null;
  } catch {
    return null;
  }
}

/**
 * True if the raw frontmatter text contains a `- redirect` tag entry.
 * Used for stubs whose YAML fails to parse (grey-matter returns tags as a
 * raw string) so a malformed stub can still never leak.
 */
function rawHasRedirectTag(raw) {
  const end = raw.indexOf('\n---', 3);
  const head = raw.startsWith('---') ? raw.slice(3, end === -1 ? 800 : end) : raw.slice(0, 800);
  return REDIRECT_TAG_PATTERN.test(head);
}

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

/** Extract a human-readable alt/caption for an image from the vault source.
 *
 * Precedence:
 *   1. An italic caption line (`*Grave of ... — Cemetery ...*`) sitting on the
 *      line IMMEDIATELY after the image embed. The headstone batch job (2026-09-08)
 *      writes captions naming cemetery + location directly under each grave photo,
 *      and those captions should surface on the live site — not a filename-derived
 *      stub. Use the caption text (stripped of its outer `*` emphasis markers) as alt.
 *   2. Fall back to the current filename-derived text when no adjacent caption exists
 *      (covers portraits / scenery plates / letter scans that embed without a caption).
 *
 * `nextLineRaw` must be the raw source line immediately following this image's embed
 * (empty "" when the embed is the last line). Returns the alt string.
 */
function captionOrFilenameAlt(filename, nextLineRaw) {
  const trimmed = (nextLineRaw || '').trim();
  // Only adopt the caption when the whole next line is ONE italic phrase and does
  // NOT itself start another embed (`![[`) — avoids stealing a neighbouring image's
  // caption and avoids folding unrelated prose into the image label.
  const italicCaption = /^\*(?!\*)((.+?))\*$/.exec(trimmed);
  if (italicCaption && !trimmed.includes('![[[') && !/^!\[\[/.test(trimmed) && !/^\*?\!\[/.test(trimmed)) {
    const cap = italicCaption[1].trim();
    if (cap) return cap;
  }
  const ext = path.extname(filename);
  const altBase = path.basename(filename, ext).replace(/[-_]/g, ' ');
  return altBase.charAt(0).toUpperCase() + altBase.slice(1);
}

/** Convert ![[path|size]] in body markdown to standard markdown image syntax */
function convertObsidianImages(body) {
  if (!body) return { body, images: [] };

  const images = [];
  // Process line-by-line so we can peek the line that FOLLOWS each embed for a caption.
  const srcLines = String(body).split('\n');
  const outLines = [];

  for (let i = 0; i < srcLines.length; i++) {
    const line = srcLines[i];
    outLines.push(line);

    let match;
    // Reset regex state for this line
    IMAGE_PATTERN.lastIndex = 0;
    const lineHasEmbed = IMAGE_PATTERN.test(line);
    IMAGE_PATTERN.lastIndex = 0;
    if (!lineHasEmbed) continue;

    // One embed per line is the vault convention; handle the first embed on the line.
    const m = IMAGE_PATTERN.exec(line);
    if (!m) continue;
    const fullMatch = m[0];
    const wikilink = m[1];
    const vaultPath = resolveVaultImage(wikilink);

    if (!vaultPath) {
      console.warn(`  ⚠️  Image not found on disk: ${wikilink}`);
      continue;
    }

    const filename = safeImageFilename(vaultPath);
    const ext2 = path.extname(vaultPath).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext2)) continue;

    const nextLineRaw = (i + 1 < srcLines.length) ? srcLines[i + 1] : '';
    const alt = captionOrFilenameAlt(filename, nextLineRaw);

    const publicSrc = `images/people/${filename}`;

    images.push({
      src: publicSrc,
      alt,
      vault_path: vaultPath,
      filename
    });

    // Remove this line's Obsidian embed so it isn't double-processed if the caption
    // line (which never embeds) were somehow on the same physical line.
    outLines[i] = outLines[i].replace(fullMatch, `![${alt}](${publicSrc})`);
    // Clean up any leftover size bars that weren't part of the matched wikilink
    outLines[i] = outLines[i].replace(/\|400\b|\|300\b|\|380\b|\|450\b/g, '').trim();

    // Consume the caption SOURCE line when we adopted it as the alt (2026-09-25).
    //
    // The alt becomes the <figcaption>, but the original italic line was left in the
    // body, so every captioned photo rendered its caption TWICE: once under the image
    // and once again as a stray italic paragraph beneath it. Measured on the live page
    // for all four Stribling images before this fix.
    //
    // Only blank the line when captionOrFilenameAlt actually ADOPTED it (the alt is
    // exactly the caption text, stripped of its outer asterisks). When the alt fell
    // back to the filename stub the italic line is genuine prose and must be kept.
    // NOTE: outLines is built with push(), so outLines[i + 1] does not exist yet at this
    // (outLines is push()-built, so outLines[i + 1] does not exist yet at this point.)
    const capLine = (srcLines[i + 1] || '').trim();
    const capMatch = /^\*(?!\*)(.+?)\*$/.exec(capLine);
    // Mutate the SOURCE line in place rather than skipping an outLines slot: outLines is
    // push()-built but indexed as outLines[i] further up, so it must stay 1:1 with srcLines.
    // (First attempt used a skip marker; that desynced the indexes and threw on line 195.)
    if (capMatch && capMatch[1].trim() === alt) {
      srcLines[i + 1] = '';
    }
  }

  return { body: outLines.join('\n'), images };
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

/**
 * Generate a UNIQUE identity key for a person entry.
 *
 * Historically this was just the bare display_name, so same-named people
 * (7x "James Telfer", 4x "John Telfer", ...) collided and id-based lookups
 * silently resolved to whichever duplicate won. `display_name` and `slug`
 * remain available and unchanged for the consumers that key off those.
 *
 * Disambiguation mirrors the slug/dedup preference:
 *   birth_year → death_year → bare display_name.
 * Verified to yield 100% unique ids across the current vault (357/357); the
 * bare-name fallback is kept only for people with no year yet recorded, and is
 * safe because such collisions do not currently exist.
 */
function toPersonId(displayName, birthYear, deathYear) {
  if (birthYear != null && birthYear !== '') return `${displayName} (${birthYear})`;
  if (deathYear != null && deathYear !== '') return `${displayName} (d.${deathYear})`;
  return displayName;
}

function stripWikilinks(text) {
  if (!text) return text;
  // A wikilink may carry an alias: [[Target|Label]] -> Target. The old version only
  // removed the brackets, so an alias leaked "Target|Label" into the data — and a
  // DANGLING "[[" (the fragment left behind by a wikilink torn at its pipe) survived
  // as part of a person's name. Both are corruption that renders as a broken page,
  // so this returns the TARGET and refuses to pass a half-link through.
  const out = text.replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1');
  return out;
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
  // AU mobile: 04XX XXX XXX / 05XX XXX XXX. Separators may be space, hyphen or NONE,
  // and mixed (0424-583-669, 0424583669). A blocked prefix (0450) stays blocked if written
  // unspaced, so the optional separators are mandatory to carry.
  text = text.replace(/0[45]\d{1,2}[ -]?\d{3}[ -]?\d{3}/g, '[phone redacted]');
  text = text.replace(/\+61[ -]?[45]\d{1,2}[ -]?\d{3}[ -]?\d{3}/g, '[phone redacted]');
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
  // Also NOT commas inside a [[wikilink]] target.
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

  // SPLIT ON '|' OUTSIDE WIKILINKS (fixed 2026-10-28).
  // A wikilink can legitimately contain a pipe: [[Francis Kelson Telfer (1910–1953)|Francis Kelson Telfer]].
  // The old `relStr.split('|')` cut the string at that pipe, so the segment after it
  // ("Francis Kelson Telfer]] | Siblings: Emily Amelia, Ethel Jean, …") lost its "Key:"
  // prefix and was discarded entirely — SILENTLY DELETING every remaining sibling.
  // Measured: Clarice May Telfer lost 8 of her 9 siblings and her record kept the
  // fragment "[[Francis Kelson Telfer (1910–1953]" as a name.
  const parts = [];
  {
    let depth = 0;
    let current = '';
    for (const ch of relStr) {
      if (ch === '[') depth++;
      else if (ch === ']') depth = Math.max(0, depth - 1);
      if (ch === '|' && depth === 0) {
        const t = current.trim();
        if (t) parts.push(t);
        current = '';
      } else {
        current += ch;
      }
    }
    const last = current.trim();
    if (last) parts.push(last);
  }
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

// Body-table BIOLOGICAL relationships (added 2026-10-28).
//
// THE HOLE: 295 of the vault's 670 people pages record their family in a
// relationship table — `| **Father** | [[William Henry Parker (1893–1968)]] |` —
// and NOT in frontmatter. The only body reader in this file was
// extractBodyStepRelations below, which by design returns ONLY step relations.
// So the table was invisible to the build: those profiles shipped with empty
// parents/children/siblings/spouses, and because reciprocal edges are derived
// from them, they were invisible FROM the other side too.
//
// Measured 2026-10-28 before this reader existed: 5 of 655 records had NO family
// edge at all (sydney-parker-1922, lilian-parker-1922, john-watson-1916,
// richard-watson-1910, susan-lawrie) and 16 more had frontmatter relations that
// never reached an array. Those five were on the live site as isolated people.
//
// RULES (deliberate, do not relax):
//  1. Wikilinks ONLY. A bare name in a cell ("May Bailey, of Hobart (m. 1907)")
//     is NOT asserted — prose is not a link, and this vault writes bare names in
//     cells precisely when the person has no page. No wikilink, no edge.
//  2. "None"/"Unknown" cells are silence, not data. Never emit a person called None.
//  3. Biological labels only. Step* labels are left to extractBodyStepRelations so
//     a step-parent can never be asserted as a biological one.
//  4. Multiple rows for the same label accumulate (vault sometimes splits Spouse).
function extractBodyTableRelations(body) {
  const out = { parents: [], children: [], siblings: [], spouses: [] };
  if (!body) return out;

  const BIOLOGICAL = {
    father: 'parents', mother: 'parents', parent: 'parents', parents: 'parents',
    children: 'children', child: 'children', son: 'children', daughter: 'children',
    siblings: 'siblings', sibling: 'siblings', brother: 'siblings', sister: 'siblings',
    spouse: 'spouses', spouses: 'spouses', husband: 'spouses', wife: 'spouses',
    partner: 'spouses',
  };

  const rowRe = /^\s*\|([^|\n]*)\|([^\n]*)$/gm;
  let row;
  while ((row = rowRe.exec(body)) !== null) {
    const rawLabel = row[1].replace(/\*+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    // Strip a trailing qualifier, e.g. "father (adoptive)" -> "father".
    const label = rawLabel.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const bucket = BIOLOGICAL[label];
    if (!bucket) continue;
    const cell = row[2];
    if (/^\s*(none|unknown|n\/?a|nil)\s*$/i.test(cell.replace(/\[\[.*?\]\]/g, ''))) continue;
    const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = re.exec(cell)) !== null) {
      const name = m[1].trim();
      if (name && !/^(none|unknown|n\/?a|nil)$/i.test(name)) out[bucket].push(name);
    }
  }

  const uniq = (a) => [...new Set(a)];
  return {
    parents: uniq(out.parents),
    children: uniq(out.children),
    siblings: uniq(out.siblings),
    spouses: uniq(out.spouses),
  };
}

// Body-table step relationships (added 2026-09-22).
// Some vault profiles record a step relation ONLY in the body's relationship table
// ("| **Stepfather** | [[Allen Merrick]] |") or as a prose line ("Stepfather: [[X]]"),
// while the frontmatter `relationships:` string omits it. Those links were previously
// invisible to the converter, so the step relation vanished from the build.
//
// SCOPE: this reader ONLY ever returns step relations, and its results are only ever
// pushed into step_parents/step_children. It can never assert a biological link, so
// it is safe to run over prose. Wikilinks are preferred when present (they are the
// vault's own unambiguous form); a bare "Stepfather: Name" line is also accepted.
function extractBodyStepRelations(body) {
  const out = { stepParents: [], stepChildren: [] };
  if (!body) return out;

  const pushWikilinks = (target, text) => {
    const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      if (name) target.push(name);
    }
  };

  // 1) Table rows:  | **Stepfather** | [[X]] |   or   | Stepchildren | [[A]], [[B]] |
  const rowRe = /^\s*\|[^|\n]*\*{0,2}(Step(?:father|mother|parent|children|child|son|daughter)s?)\*{0,2}[^|\n]*\|([^\n]*)\|/gim;
  let row;
  while ((row = rowRe.exec(body)) !== null) {
    const label = row[1].toLowerCase();
    const cell = row[2];
    if (label.startsWith('stepchild') || label.startsWith('stepson') || label.startsWith('stepdaughter')) {
      pushWikilinks(out.stepChildren, cell);
    } else {
      pushWikilinks(out.stepParents, cell);
    }
  }

  // 2) Prose lines:  Stepfather: [[X]]  /  **Stepfather:** [[X]]  /  Stepmother: X (annotation)
  //    The markdown-bold form (`**Stepfather:** [[X]]`, colon INSIDE the bold) is the
  //    style used by Mark's own profile and by most modern pages in this vault. The
  //    original pattern required the label to be immediately followed by ":", so every
  //    bolded declaration was invisible — which is how Mark Kenneth Telfer's two
  //    step-parents vanished from the data despite being written plainly in the vault.
  const lineRe = /^\s*\*{0,2}(Step(?:father|mother|parent|children|child)s?)\s*:?\*{0,2}\s*:\s*(.+)$/gim;
  let line;
  while ((line = lineRe.exec(body)) !== null) {
    const label = line[1].toLowerCase();
    const rest = line[2].trim().replace(/^\*{1,2}\s*/, '').replace(/\s*\*{1,2}$/, '');
    const names = [];
    pushWikilinks(names, rest);
    if (names.length === 0) {
      // Bare name, possibly with a trailing "(...)" annotation — strip the annotation.
      const bare = rest.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (bare && /^[A-Z]/.test(bare)) names.push(bare);
    }
    if (label.startsWith('stepchild') || label.startsWith('stepchild')) out.stepChildren.push(...names);
    else out.stepParents.push(...names);
  }

  const uniq = (a) => [...new Set(a)];
  return { stepParents: uniq(out.stepParents), stepChildren: uniq(out.stepChildren) };
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
  const keyColonies = new Map();   // key -> EVERY record on that key (see collision note)
  for (const p of existingPeople) {
    // ALWAYS include middle_name, including when a birth_year is present.
    // Reason (2026-09-18): the vault frontmatter splits given names into
    // first_name + middle_name, but older people.json records still hold the
    // COMBINED form (first_name="Maria Clara", middle_name=null). With the old
    // year-bearing key (first+last|year) the two forms produced DIFFERENT keys
    // ("maria"+"telfer" vs "mariaclaratelfer"), so a body-only vault edit was
    // treated as a brand-new person: the new record was appended and the
    // duplicate-twin purge then discarded the CORRECT (longer) body, silently
    // reverting the edit. Including middle_name makes both forms collapse to the
    // same key. Measured 2026-09-18: this also removes the single remaining key
    // collision in people.json (1 -> 0), so it is strictly more specific.
    const by = p.birth_year ?? '';
    const namePart = `${(p.first_name || '')}${(p.middle_name || '')}${(p.last_name || '')}`;
    const key = `${namePart}|${by}`;
    const keyLower = key.toLowerCase().replace(/\s+/g, '');
    // ── COLLISION COLONY (2026-10-28) ─────────────────────────────────────────
    // Two DIFFERENT people can build the identical key: Mark Andrew Telfer
    // (b. 1976) and Mark David Telfer (1950–1990) both reduce to `marktelfer|`
    // because neither carries a birth_year in people.json. The old code kept
    // whichever record happened to win — so the loser became UNMATCHABLE, its
    // file fell through every fallback, and (worse) the winner's record was
    // merged with the loser's vault content, publishing one man under the
    // other's identity while a real vault profile got no page at all.
    //
    // keep ALL colliding records on the key. `existingByKey` still holds the
    // preferred one (year-suffixed slug wins, unchanged), and `keyColonies`
    // holds every record on that key so the match site can prefer the one whose
    // vault_file IS the file being converted — ONE VAULT FILE = ONE PERSON.
    if (!keyColonies.has(keyLower)) keyColonies.set(keyLower, []);
    keyColonies.get(keyLower).push(p);

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

  // ── Name-only index (added 2026-09-18, card tw-2026-09-18-009) ───────────
  // Used ONLY as the vault-file-anchored fallback at the match site: it recovers
  // a record whose birth_year the vault has since CORRECTED (the year-bearing key
  // then misses). Never used on its own — a candidate is accepted only when it is
  // the unique record whose vault_file is the file currently being converted.
  const nameOnlyIndex = new Map();
  for (const p of existingPeople) {
    const k = `${(p.first_name || '')}${(p.middle_name || '')}${(p.last_name || '')}|`
      .toLowerCase().replace(/\s+/g, '');
    if (!nameOnlyIndex.has(k)) nameOnlyIndex.set(k, []);
    nameOnlyIndex.get(k).push(p);
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
  const mdFileSet = new Set(mdFiles);   // rename-recovery guard needs the live file list
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
    // A vault file marked as a "redirect" is not a real profile — it points at a
    // canonical entry elsewhere. Skipping them prevents phantom/stub records from
    // regenerating, and lets the orphan purge below drop any previously-accumulated
    // stub entries.
    //
    // Detection is tag-first: the `redirect` TAG is authoritative, the title is
    // only a fallback. (Title-only detection shipped 3 duplicate live pages —
    // see isRedirectStub() at the top of this file.)
    const isStub = isRedirectStub(fm) || rawHasRedirectTag(raw);
    if (isStub) {
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
    // ── Full date of birth ──────────────────────────────────────────────
    // SAME RULE for living and deceased: record the full date whenever the
    // vault has one; fall back to the year when a year is all there is.
    // Only a date that carries a day AND a month counts as a full date —
    // a bare year (e.g. "1797") or an approximate ("~1800") is NOT a DOB.
    const rawBirthDate = fm.birth_date || fm.birth || null;
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const normaliseDate = (v) => {
      if (v == null) return null;

      // YAML auto-parses `1989-01-17` into a JS Date. Convert back to a
      // clean ISO day, using LOCAL parts so a UTC shift can't move the day.
      if (v instanceof Date && !isNaN(v)) {
        const y = v.getFullYear();
        const m = String(v.getMonth() + 1).padStart(2, '0');
        const d = String(v.getDate()).padStart(2, '0');
        return `${d} ${MONTHS[v.getMonth()]} ${y}`;
      }

      const str = String(v).trim().replace(/^["']|["']$/g, '');
      if (!str) return null;
      // Approximations and bare years are YEARS, not dates of birth.
      if (/^[~c]\.?\s*/i.test(str) || /^approx/i.test(str)) return null;
      if (/^\d{4}$/.test(str)) return null;
      // ISO date (also catches a stringified Date)
      const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/;
      const mi = str.match(ISO);
      if (mi) {
        const y = +mi[1], mo = +mi[2], d = +mi[3];
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${d} ${MONTHS[mo-1]} ${y}`;
        return null;
      }
      // "D Mon YYYY" / "D Month YYYY"
      const dm = str.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/);
      if (dm) {
        const d = +dm[1];
        const idx = MONTHS.findIndex(mn => mn.toLowerCase().startsWith(dm[2].toLowerCase().slice(0,3)));
        if (idx >= 0 && d >= 1 && d <= 31) return `${d} ${MONTHS[idx]} ${+dm[3]}`;
      }
      return null; // anything else is not a full date of birth
    };
    const birthDate = normaliseDate(rawBirthDate);
    const rawDeathDate = fm.death_date || fm.death || null;
    const deathDate = normaliseDate(rawDeathDate);

    const birthYearDisplay = birthYear != null ? (birthApprox ? `~${birthYear}` : String(birthYear)) : '?';
    // A missing death year prints "" (NOTHING) — never "?" and never "living".
    // "1840 – living" is an unfounded claim (the absence of a death record is not
    // evidence of life), and "1840 – ?" is an unfounded SUGGESTION (it reads as a
    // death that is merely missing). Mark's ruling 30 Oct 2026: strip the status,
    // call it what it is, leave it blank. A deceased person with no recorded year
    // keeps "?" because there the death itself is established. See rules L306-L308.
    const deathYearDisplay = deathYear != null ? (deathApprox ? `~${deathYear}` : String(deathYear))
      : (isLiving ? '' : '?');
    // A living person shows the birth year alone: "1989", never "1989 – " and never
    // "1989 – ?". The dash implies a closing date exists and is missing.
    const lifespan = deathYearDisplay === '' ? birthYearDisplay
      : `${birthYearDisplay} – ${deathYearDisplay}`;

    const tags = Array.isArray(fm.tags) && fm.tags.length > 0
      ? fm.tags : ['bio', 'family', 'person'];

    // Relationships
    const relationships = parseRelationships(fm.relationships);
    const parents = [];
    const children = [];
    const siblings = [];
    const spouses = [];

    // Parent refs recorded but NOT asserted, because frontmatter says the
    // parentage is unproven. See the parentageUnproven block below.
    const disputedParentRefs = [];

    // ── Disputed parentage (card tw-2026-09-13-031) ───────────────────────────
    // The vault may declare `parentage_status: unproven` with the reasoning in
    // `relationship_notes` (e.g. Agnes Telfer (1848-?), who appears in NONE of the
    // three gold family books and NOT in the 1851 Jedburgh census). The vault page
    // deliberately keeps the relationship NAMES clean so links resolve, and records
    // the doubt in structured frontmatter instead.
    //
    // That doubt must survive into the generated data. Previously it did not:
    // parentage_status was never read, so `parents[]` asserted an unproven pair as
    // fact and the dispute lived only in prose. Option (b), chosen 13 Sep 2026:
    // do NOT emit unproven parent links into the structured array. The body still
    // carries the full dispute text, so nothing is hidden — it simply is not
    // asserted as a machine-readable relationship.
    //
    // NOTE: never edit the VAULT to fix this. The vault is the source of truth and
    // it is correct; this is a generator/schema gap.
    const parentageUnproven = String(fm.parentage_status || '').trim().toLowerCase() === 'unproven';

    const stepParents = [];
    const stepChildren = [];

    for (const rel of relationships) {
      const t = rel.type.toLowerCase();
      if (['mother', 'father', 'parent'].includes(t)) {
        if (parentageUnproven) {
          // recorded, not asserted
          disputedParentRefs.push(...rel.names);
          continue;
        }
        parents.push(...rel.names);
      } else if (['children', 'child'].includes(t)) {
        children.push(...rel.names);
      } else if (['siblings', 'sibling', 'brother', 'sister'].includes(t)) {
        siblings.push(...rel.names);
      } else if (['spouse', 'spouses', 'husband', 'wife'].includes(t)) {
        spouses.push(...rel.names);
      } else if (['stepfather', 'stepmother', 'stepparent', 'step-parent'].includes(t)) {
        // FIXED 2026-09-22: step-parents were UNHANDLED and silently dropped, or —
        // where a body table supplied the link — flattened into `parents`, which
        // asserts a biological parent that the vault explicitly denies. Rex's file
        // literally reads "Robert is his STEPFATHER, not his father", yet the graph
        // listed Robert as a parent. Step relationships are their own thing: keep
        // them out of the biological arrays so nothing false is asserted.
        stepParents.push(...rel.names);
      } else if (['stepchildren', 'stepchild', 'step-children'].includes(t)) {
        stepChildren.push(...rel.names);
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

    // Step-relationship flat fields (added 2026-09-22). Sheryle's file carries a
    // `stepchildren:` frontmatter list; others carry no frontmatter key at all and
    // record the relation only in the body table (read further down). Accept both,
    // array or string. Deduplicated after all three sources have contributed.
    const toArr = (v) => (Array.isArray(v) ? v.map(String) : (v ? [String(v)] : []));
    stepChildren.push(...toArr(fm.stepchildren));
    stepParents.push(...toArr(fm.stepfather), ...toArr(fm.stepmother));
    // Flat-field siblings (added 2026-10-24). Sibling lists previously came ONLY from
    // the `relationships:` string, so with the derived arrays no longer re-ingested
    // there was no way to rebuild them for flat-schema files. Accept `siblings:` in
    // frontmatter, array or string, and merge only when the string form is silent.
    const flatSiblings = toArr(fm.siblings);
    if (siblings.length === 0 && flatSiblings.length > 0) siblings.push(...flatSiblings);

    // Body relationship TABLE (added 2026-10-28). Runs on the raw body so the
    // wikilinks are intact. This is the vault's dominant convention (295 of 670
    // pages) and it was previously read by NOTHING, which is why families written
    // plainly in the vault arrived on the site as isolated people. Merge rule: the
    // table contributes only where the other sources said nothing, so a deliberate
    // frontmatter declaration is never overridden by a stale table row.
    {
      const fromTable = extractBodyTableRelations(body);
      if (parents.length === 0) parents.push(...fromTable.parents);
      if (children.length === 0) children.push(...fromTable.children);
      if (siblings.length === 0) siblings.push(...fromTable.siblings);
      if (spouses.length === 0) spouses.push(...fromTable.spouses);
    }


    const roles = extractRoles(body);
    const bodyClean = cleanPII(body);
    const { body: bodyWithImages, images: bodyImages } = convertObsidianImages(bodyClean);
    const bodySanitized = stripSocialMedia(stripNotesAndLinks(bodyWithImages));
    const title = fm.title || `${displayName} — Family & Biography`;
    const bodyStripped = bioSummary(bodySanitized);

    // Step relations recorded only in the BODY (table row or prose line) — added
    // 2026-09-22. Runs on the raw body so wikilinks are still intact. Pushed into
    // the step arrays only; never into parents/children.
    {
      const fromBody = extractBodyStepRelations(body);
      stepParents.push(...fromBody.stepParents);
      stepChildren.push(...fromBody.stepChildren);
    }

    // Deduplicate the step arrays: the frontmatter string, the flat fields and the
    // body reader can each report the same relation. One person, one entry.
    // NOTE: dedupe into a NEW array BEFORE clearing in place. Clearing first and
    // then spreading from the same (now empty) array silently wipes the data.
    {
      const dedupe = (a) => [...new Set(a.map(s => String(s).trim()).filter(Boolean))];
      const dp = dedupe(stepParents);
      const dc = dedupe(stepChildren);
      stepParents.length = 0; stepParents.push(...dp);
      stepChildren.length = 0; stepChildren.push(...dc);
    }

    // Record vault filename for traceability
    const vaultFile = file;

    const entry = {
      id: toPersonId(displayName, birthYear, deathYear),
      slug,
      vault_file: vaultFile,
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      birth_year: birthYear,
      death_year: deathYear,
      birth_date: birthDate,
      death_date: deathDate,
      birth_place: fm.birth_place ? String(fm.birth_place).trim() : undefined,
      death_place: fm.death_place ? String(fm.death_place).trim() : undefined,
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
      // Card tw-2026-09-13-031: surface the dispute so downstream consumers can
      // tell "no parents recorded" apart from "parents recorded but disputed".
      parentage_status: parentageUnproven ? 'unproven' : undefined,
      disputed_parent_refs: disputedParentRefs.length > 0 ? disputedParentRefs : undefined,
      children,
      siblings,
      spouses,
      // Step relationships (added 2026-09-22). Kept SEPARATE from the biological
      // arrays on purpose: asserting a step-parent as a biological parent is a
      // factual error the vault explicitly contradicts, and silently dropping the
      // link loses family truth. Names here are resolved to slugs downstream
      // (resolve-refs.mjs) and rendered in their own labelled section.
      step_parents: stepParents,
      step_children: stepChildren,
      is_living: isLiving,
      // is_deceased = FACT: a death is recorded (death year, or a deceased flag on the
      // vault note). This is the ONLY status the site is permitted to assert. Pages
      // badge "Deceased" from this and say NOTHING when it is false — an unrecorded
      // death is unknown, not "Living". Do not derive it from is_living: that flag is
      // the PRIVACY posture and flips for anyone born >120 years ago.
      is_deceased: deathYear != null || deceasedFlag,
      // ── Evidence provenance (added 2026-10-28) ─────────────────────────────
      // The vault has recorded its own confidence for months: 239 person files
      // carry `single_source: true`, 99 carry `evidence_level: single_source`, and
      // 13 carry a `provisional_why` explaining in the author's own words that the
      // page rests on one printed page and nothing else. NONE of it reached the
      // site, because this converter dropped every one of those keys — so a reader
      // saw a confident-looking profile whose backing was, in the vault's own
      // assessment, a single typed-up family-tree report.
      //
      // Mark's rule, 28 Oct 2026: "I just don't want anyone floating off on their own
      // with no sauce, just a document." The cure is not deletion — the evidence
      // exists and is sound as far as it goes — it is carrying the caveat to the page
      // so the reader is told exactly how thin the ice is. Passed through verbatim;
      // never inferred, never upgraded here.
      evidence_level: fm.evidence_level || null,
      single_source: fm.single_source === true || fm.single_source === 'true',
      provisional_why: fm.provisional_why || null,
      lifespan,
      related_trees: fm.related_trees || ['telfer-tree'],
      images: bodyImages.length > 0 ? bodyImages : [],
      // person_photo = the profile's circular AVATAR. Must be a photo OF the
      // person, never a grave OR a scenery/place book-plate. Book-page scans
      // use the `_p{N}` suffix (e.g. Newcastleton_and_the_Liddesdale_Hills_p6.jpg);
      // those are historical-place illustrations for the Photos GALLERY, not a
      // portrait. If every image is a grave or scenery plate (no photograph of
      // the person survives), fall back to the initials avatar (null).
      // A photo OF the person only. Never a grave, cemetery view, map, or a
      // scenery/place book-plate (_p{N} suffix). If nothing qualifies, null ->
      // initials avatar. (Widened 2026-09-18: 'cemetery'/'map'/'scenery-plate'
      // were slipping through and being promoted to the circular avatar.)
      // (Widened 2026-09-19: newspaper clippings/obituaries are now publishable
      // content for living AND deceased people — Mark's ruling — so they MUST be
      // excluded here or a column of newsprint becomes somebody's face. Per the
      // rules file: a clipping is never an avatar; fall back to initials.)
      person_photo: bodyImages.find(img =>
        !/grave|cemetery|map|scenery[-_]plate|clipping|newspaper|obituar|trove|in[-_]?memoriam|death[-_]?notice/i.test(img.src) &&
        !/_[pP]\d+\.jpg$/.test(img.src)
      )?.src || null
    };

    // 3. Find matching existing entry
    // Priority: key match first, then slug match (fallback).
    // Key must concatenate name exactly as the index builder does, so first/last
    // split inconsistencies still merge to the same person.
    // CRITICAL (fixed 2026-09-18): middle_name MUST be included in BOTH branches,
    // for exactly the same reason the index builder includes it unconditionally.
    // The vault frontmatter splits given names (first_name="Maria",
    // middle_name="Clara") while older people.json records hold the COMBINED form
    // (first_name="Maria Clara", middle_name=null). Those two forms must collapse
    // to ONE key. The year-bearing branch previously omitted middle_name, so
    // `mariaclaratelfer|1878` (index) != `mariatelfer|1878` (lookup) -> the lookup
    // missed -> a body-only vault edit was appended as a brand-new person -> the
    // duplicate-twin purge then discarded the CORRECT (longer) body, silently
    // reverting the edit every single run.
    const matchKey = (birthYear
      ? `${firstName}${middleName || ''}${lastName}|${birthYear}`
      : `${firstName}${middleName || ''}${lastName}|`
    ).toLowerCase().replace(/\s+/g, '');
    let existing = existingByKey.get(matchKey);
    // ── DISAMBIGUATE THE COLONY BY VAULT FILE (2026-10-28) ────────────────────
    // The identity key cannot tell two same-named people apart when neither has
    // a birth_year. The vault file CAN — it is unique by definition. When the
    // key resolves to a record that belongs to a DIFFERENT file, look for the
    // record that belongs to THIS file; if there isn't one, treat the person as
    // new rather than merging two humans into one record.
    {
      const colony = keyColonies.get(matchKey) || (existing ? [existing] : []);
      if (existing && (existing.vault_file || '').trim() !== vaultFile) {
        const mine = colony.find((p) => (p.vault_file || '').trim() === vaultFile);
        if (mine) {
          existing = mine;
        } else {
          // ── ONE VAULT FILE = ONE PERSON (hardened 2026-10-28) ──────────────
          // A vault file is unique by definition; no two files describe the same
          // person. So if the key's occupant belongs to a DIFFERENT file, and no
          // record in the colony owns THIS file, then this file's person has no
          // record yet — they are NEW. Do NOT merge them into the occupant.
          //
          // The previous `colony.length > 1` requirement was wrong: it assumed a
          // collision must be visible in the colony before we could act. But the
          // colony only holds records from the PREVIOUS build. Mark Andrew Telfer
          // (b. 1976, no birth_year, key `marktelfer|`) collided with Mark David
          // Telfer (no birth_year, same key) on the FIRST build, when the colony
          // held only the single winner — so the guard refused to split them, the
          // loser was absorbed, and his vault file silently got no page at all
          // (build gate: ❌ MISSING real vault record). A colony of one is still
          // proof: that one belongs to someone else's file.
          existing = null;
        }
      }
    }
    // Fall back to slug match ONLY when the incoming profile has no birth year.
    // A birth-year key (first+last|YYYY) is authoritative and disambiguates
    // same-first+last people of different generations (e.g. John Watson 1851 vs
    // John Watson 1916). If the year key misses, that's a genuinely new person —
    // falling back to the bare slug would let a same-name-different-year profile
    // capture (and overwrite) the wrong generation's record. No-year profiles
    // have no year discriminator, so the bare slug is their correct match.
    // ── BIRTH-YEAR-CORRECTION FALLBACK (added 2026-09-18, card tw-2026-09-18-009) ─
    // The identity key includes birth_year, so a vault edit that CORRECTS a birth
    // year breaks its own matching: the vault now builds `name|1893` while the
    // stored record still builds `name|1892` -> miss -> the update path never runs
    // -> the correction is silently discarded on every regen, forever.
    // Measured 2026-09-18: Leslie Frank Dillon, vault `birth_year: 1893` vs
    // published 1892 — the ONLY mismatch in 362 records, but the mechanism is
    // general (any future year correction, and every same-name record).
    //
    // A name-only fallback is normally UNSAFE (see the note above: it would let a
    // same-name-different-generation profile capture the wrong record). It becomes
    // safe when anchored to the vault file, because ONE VAULT FILE = ONE PERSON:
    // we accept the name-only candidate only when it is UNIQUE, it is not already
    // claimed by a different vault file, and its vault_file is the very file being
    // converted. The year key still takes priority, so distinct same-name people
    // of different generations can never be conflated.
    // ── VAULT-FILE FALLBACK (added 2026-09-22, card tw-2026-09-22-011) ─────────
    // ONE VAULT FILE = ONE PERSON. When the identity key misses, the vault file
    // itself is the strongest available match — a record whose vault_file is the
    // very file being converted IS this person, whatever the name fields say.
    //
    // WHY THIS IS NEEDED: the identity key includes middle_name. Adding a middle
    // name to a vault file therefore breaks its own record match. Observed live:
    // the vault gained `middle_name: Joy` for Sheryle, so the vault now builds
    // "sherylejoytelfer|1961" while the stored record still built
    // "sheryletelfer|1961" -> miss -> no merge -> the entry was pushed as a NEW
    // record -> the duplicate-twin purge discarded it -> every field only present
    // in her file (step_children) was silently lost every run.
    //
    // The existing year-correction fallback below covers this shape only when
    // birthYear is null; this person HAS a birth year, so it never fired.
    //
    // SAFETY: matched on vault_file equality, which is unique by definition — the
    // file list has no duplicates. It cannot conflate two same-name people,
    // because two people cannot share one file.
    if (!existing) {
      const byFile = existingPeople.filter(
        (p) => (p.vault_file || '').trim() && (p.vault_file || '').trim() === vaultFile
      );
      if (byFile.length === 1) {
        existing = byFile[0];
        console.log(
          `  ↻ Vault-file merge: ${entry.display_name || slug} — re-joined record ` +
          `${existing.slug} via vault_file (identity key missed)`
        );
      }
    }
    // ── VAULT-FILE RENAME RECOVERY (added 2026-10-27) ─────────────────────────
    // The converter never sees git history, so a pure RENAME in the vault
    // (`James Robert Telfer (1866–1925).md` → `(1866–1930).md`,
    // `Helen Telfer.md` → `Harriett Helen Telfer (1873–1929).md`,
    // `Susan Telfer (1871–1952).md` → `(1871–1954).md`) leaves the OLD row in
    // people.json carrying a vault_file that no longer exists. The identity key
    // misses (name/middle changed), the vault-file fallback above misses (the
    // filename is new), and the name-only fallback is gated on birthYear == null —
    // so a NEW row is pushed AND the old row is orphan-purged in the same run,
    // silently DESTROYING the curated body, sources and photo of a person who
    // never changed. Observed 2026-10-27: the vault's 06:33 rename commit produced
    // 7 MISSING / 3 ORPHAN parity violations and failed the build the next morning.
    //
    // SAFETY: a candidate is accepted only when it is UNIQUE on
    // (first_name + last_name + birth_year) AND its file no longer exists in the
    // vault AND that record is not already claimed by a live file. A rename keeps
    // all three identifying fields; a genuinely different person does not.
    if (!existing) {
      const stillOnDisk = (name) => name && fs.existsSync(path.join(VAULT_PEOPLE_DIR, name));
      const nameKey = (p) =>
        `${(p.first_name || '')}${(p.last_name || '')}`.toLowerCase().replace(/\s+/g, '');
      const thisKey = `${firstName}${lastName}`.toLowerCase().replace(/\s+/g, '');
      const renamedCands = existingPeople.filter((p) => {
        const vf = (p.vault_file || '').trim();
        if (!vf || stillOnDisk(vf)) return false;              // file must be GONE
        if (mdFileSet.has(vf)) return false;                   // and not republished
        if (nameKey(p) !== thisKey) return false;              // same person's names
        return String(p.birth_year ?? '') === String(birthYear ?? '');
      });
      if (renamedCands.length === 1) {
        existing = renamedCands[0];
        console.log(
          `  ↻ Vault-file RENAME: ${entry.display_name || slug} — re-joined record ` +
          `${existing.slug} from vanished ${existing.vault_file}`
        );
      }
    }
    // ── CLAIM THE BARE SLUG (2026-10-28) ──────────────────────────────────────
    // A passing record with NO existing match must still mark its bare slug as
    // TAKEN. Without this, two different people who share first+last (Mark Andrew
    // Telfer b.1976 and Mark David Telfer 1950–1990) both arrive at
    // `mark-telfer`, neither sees a conflict, and the disambiguation pass below
    // then appends its last-resort `-living` suffix to BOTH — publishing one URL
    // for two men and sending every "Mark Telfer" reference to whichever record
    // won the write. Registering the claim keeps the disambiguator honest.
    if (!existing && !existingBySlug.has(slug)) {
      existingBySlug.set(slug, { slug, vault_file: vaultFile, _pending: true });
    }

    if (!existing) {
      const nameOnlyKey = `${firstName}${middleName || ''}${lastName}|`
        .toLowerCase().replace(/\s+/g, '');
      const cands = (nameOnlyIndex.get(nameOnlyKey) || []).filter(
        (c) => (c.vault_file || '').trim() === vaultFile
      );
      if (cands.length === 1) {
        existing = cands[0];
        console.log(
          `  ↻ Year-correction merge: ${entry.display_name || slug} — vault ${birthYear} ` +
          `re-joined record ${existing.slug} (was ${existing.birth_year}) via vault_file`
        );
      }
    }

    // ── FILE-ANCHORED LAST RESORT (2026-10-28) ────────────────────────────────
    // Everything above can miss when two same-named people share an identity key
    // and the index kept the wrong one. This branch cannot miss for the right
    // reason: a record whose vault_file IS this file is this person, full stop.
    // There is no name guessing and no rate of false positives — one file, one
    // person — so it is safe even for a living person with no birth year.
    if (!existing) {
      const mineByFile = existingPeople.filter(
        (p) => (p.vault_file || '').trim() === vaultFile
      );
      if (mineByFile.length === 1) {
        existing = mineByFile[0];
      }
    }

    // ── END OF MATCHING (2026-10-28) ────────────────────────────────────────
    // NOTHING may look this file up by bare slug without checking it belongs to
    // this file. Every branch above is anchored (identity key, name-key+vault_file,
    // vault_file equality, rename recovery). The bare-slug lookup that used to sit
    // here was NOT: it matched `mark-telfer-living` (vault_file = Mark David
    // Telfer 1950–1990) for Mark Andrew Telfer (b. 1976), both being Mark + Telfer
    // with no birth year. The merge then overwrote Mark David's record with Mark
    // Andrew's body and never created Mark Andrew's row, so one man was published
    // under the other's identity and the parity gate lost a page. A slug is a
    // URL, not an identity — see the file-anchored rules above.
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
      // ── SLUG PRESERVATION (Option 1, decided 2026-09-18) ─────────────────
      // When this entry matched an EXISTING record — by identity key OR by slug
      // fallback — that record's slug is authoritative and is NEVER overwritten.
      //
      // Root cause (measured 2026-09-18): toSlug() builds the bare form from
      // firstName+lastName ONLY, with no disambiguating suffix. people.json
      // carries TWO kinds of suffix the vault cannot reproduce:
      //   (a) combined given names — vault frontmatter splits
      //       (first_name="Maria", middle_name="Clara") while the stored record
      //       holds the COMBINED form (first_name="Maria Clara"), so toSlug emits
      //       "maria-telfer" against a stored "maria-clara-telfer-1878".
      //   (b) approximate year markers — the stored record may hold the year as a
      //       STRING with a tilde (birth_year="~1892", "~1885", "~1865") while the
      //       vault now carries a plain numeric year (1893, 1885, 1865). The
      //       identity key compares year textually, so "…dillon|~1892" != "…dillon|1893"
      //       and the key MISSES; the entry then matched by the slug fallback and its
      //       stored slug "leslie-frank-dillon-~1892" was replaced by the bare
      //       "leslie-frank-dillon" — a live URL change on a page with real inbound
      //       links. Same class as (a).
      // In both cases letting entry.slug win renames a live URL. Measured: a full
      // rebuild renamed 99 slugs in one run before this guard; after it, 0.
      //
      // New people (no existing match) still get entry.slug from toSlug(), and the
      // later bare-slug disambiguation pass still year-suffixes genuine conflicts.
      if (!existing.slug) {
        existing.slug = entry.slug;
      }
      existing.display_name = entry.display_name;
      existing.id = entry.id;
      existing.title = entry.title;
      existing.first_name = entry.first_name;
      existing.middle_name = entry.middle_name;
      existing.last_name = entry.last_name;
      existing.birth_year = entry.birth_year;
      existing.death_year = entry.death_year;
      existing.birth_date = entry.birth_date;
      existing.death_date = entry.death_date;
      existing.birth_place = entry.birth_place;
      existing.death_place = entry.death_place;
      existing.birth_year_display = entry.birth_year_display;
      existing.death_year_display = entry.death_year_display;
      existing.is_living = entry.is_living;
      // is_deceased = FACT (a death is recorded), distinct from is_living = PRIVACY
      // posture. Must be copied here or the merge silently drops it and every page
      // falls back to guessing status from the privacy flag — the original defect.
      existing.is_deceased = entry.is_deceased;
      existing.lifespan = entry.lifespan;
      // 2026-10-28: evidence provenance copied unconditionally, same as is_living.
      // Mark's rule: "I don't want anyone floating off on their own with no sauce,
      // just a document." The vault records its own confidence (239 files say
      // single_source: true, 99 say evidence_level: single_source, 13 carry a written
      // provisional_why) and none of it was reaching the site, so a single-witness
      // profile rendered as confidently as a certified one. Written on EVERY run —
      // including null/false — so a caveat disappears automatically the day an
      // independent record is found, and never lingers stale.
      existing.evidence_level = fm.evidence_level || null;
      existing.single_source = fm.single_source === true || fm.single_source === 'true';
      existing.provisional_why = fm.provisional_why || null;
      existing.vault_file = entry.vault_file;
      existing.tags = entry.tags;
      existing.relationships = entry.relationships;
      existing.roles = entry.roles.length > 0 ? entry.roles : (existing.roles || []);
      if (entry.body_markdown && entry.body_markdown.trim()) {
        existing.body_markdown = entry.body_markdown;
        existing.body_stripped = entry.body_stripped;
      }
      // THE VAULT IS TRUTH — ALWAYS (2026-10-24).
      //
      // This used to fall back to `existing.*` whenever the file had no
      // `relationships:` string, e.g. the 7 Baker files that use the older flat
      // schema (`father:` / `mother:`). That fallback kept a *stale derived* value
      // alive whenever the vault legitimately resolved to nothing, so a wrong
      // parent/sibling could never be cleaned up by editing the vault — the merge
      // quietly reinstated it. Combined with build-relationship-graph.mjs
      // re-ingesting the same arrays (removed the same day), those arrays had become
      // self-confirming: derived values feeding themselves back as evidence.
      //
      // A vault file is the source of truth for what it does and does not declare,
      // whether it declares that in the `relationships:` string, in flat
      // `father:`/`mother:`/`children:` fields, or not at all. An empty result is a
      // real answer, not a reason to restore yesterday's guess. Everything in these
      // four arrays is either an unresolved raw name (preserved on the record) or a
      // slug rebuilt from the vault this run.
      existing.parents = parents;
      existing.children = children;
      existing.siblings = siblings;
      existing.spouses = spouses;
      // Step arrays carry the same trust rule as the biological ones: a vault file
      // that declares relationships is authoritative for what it omits (2026-09-22).
      existing.step_parents = stepParents;
      existing.step_children = stepChildren;
      existing.related_trees = entry.related_trees;
      // Card tw-2026-09-13-031: this merge is an ALLOWLIST of copied fields, so a
      // new field must be listed here or it is silently dropped. parentage_status
      // describes the CURRENT vault frontmatter, so it must be overwritten each run
      // (including to undefined, which allows a dispute to be cleared later).
      //
      // 2026-10-28: evidence provenance added to the allowlist. These three keys are
      // copied from the vault frontmatter every run so a caveat can never go stale,
      // and can be CLEARED the day a second witness is found (the fresh value is
      // written unconditionally, including null/false). Leaving them off this
      // allowlist is exactly why 239 single-source caveats never reached the site.
      existing.evidence_level = entry.evidence_level ?? null;
      existing.single_source = entry.single_source === true;
      existing.provisional_why = entry.provisional_why ?? null;
      if (parentageUnproven) {
        existing.parentage_status = 'unproven';
        // disputed_parent_refs is (re)derived as SLUGS by build-relationship-graph.mjs,
        // which is the stage that actually holds the slug map. Set a placeholder here
        // so the merge never leaves a stale/false value behind.
        existing.disputed_parent_refs = [];
        // the disputed parent links are recorded, never asserted
        existing.parents = [];
      } else if (existing.parentage_status) {
        delete existing.parentage_status;
        delete existing.disputed_parent_refs;
      }
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
  // Redirect-stub filenames: files marked as placeholders for a canonical
  // profile. Any record sourced from one of these is a phantom and must be
  // purged even though the file itself still exists on disk.
  // Tag-first detection (shared helper) so the purge set matches the skip set.
  const redirectStubFiles = new Set();

  if (vaultDirExists) {
    for (const f of vaultFilesNow) {
      if (!f.endsWith('.md')) continue;
      const abs = path.join(VAULT_PEOPLE_DIR, f);
      let raw = '';
      try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
      if (isRedirectStub(readFrontmatter(abs)) || rawHasRedirectTag(raw)) {
        redirectStubFiles.add(f);
      }
    }
  }
  // ── 2026-10-28: REDIRECT STUBS LEAVE DANGLING REFS ────────────────────────
  // A stub is purged AFTER resolution, so any relationship written as the stub's
  // name resolves to nothing the moment the stub disappears. `Martha Telfer`
  // floated for exactly this reason: the stub `Martha Telfer (1873–?)` declares
  // itself the same person as `Martha Telfer Cameron (1873–1964)`, but nothing
  // ever carried that fact to the resolvers.
  //
  // Emit the mapping so a stub's name can be indexed as an ALIAS for its canonical
  // target. Extraction is deliberately conservative — `redirect_to:` frontmatter
  // first, then an explicit "canonical record lives at [[...]]" sentence — and any
  // stub whose target can't be read is simply left out. An alias is never guessed.
  const redirectAliases = {};
  if (vaultDirExists) {
    for (const f of redirectStubFiles) {
      const abs = path.join(VAULT_PEOPLE_DIR, f);
      let raw = '';
      try { raw = fs.readFileSync(abs, 'utf-8'); } catch { continue; }
      const fm = readFrontmatter(abs) || {};

      // The stub's own name: its title, minus any trailing "— redirect ..." tail
      // and any "(1973–?)" date suffix, so it matches how relatives write it.
      const rawTitle = String(fm.title || f.replace(/\.md$/, ''));
      const stubName = rawTitle
        .replace(/\s+[—–-]\s+.*\bredirect\b.*$/i, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      if (!stubName) continue;

      // Where it points. Frontmatter wins; else the stub's own prose, which in
      // practice names the target as plain text — "the same person as Martha
      // Telfer Cameron (1873–1964)" — not as a [[wikilink]]. Accept both.
      let target = '';
      const rt = fm.redirect_to;
      if (rt) {
        target = String(rt).replace(/^\s*\[\[|\]\]\s*$/g, '').trim();
      } else {
        const m = raw.match(/(?:SAME person as|same person as|same individual as)\s*\[?\[?([A-Z][^.\n\[\]]*?)\]?\]?(?=[.,;\n])/);
        if (m) target = m[1].trim();
      }
      if (!target) continue;
      target = target.split('|')[0].replace(/[[\]]/g, '').trim();
      // Strip a trailing ", wife of ..." / " (the) ..." clause the prose adds.
      target = target.replace(/\s*,\s*(?:wife|husband|son|daughter|mother|father)\b.*$/i, '').trim();
      if (target.toLowerCase() === stubName.toLowerCase()) continue;

      redirectAliases[stubName.toLowerCase()] = target;
    }
    console.log(`  🔀 redirect aliases: ${Object.keys(redirectAliases).length} stub name(s) mapped to canonical records`);
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

  // ── Duplicate-twin purge: one vault file must yield exactly ONE record ──
  // ROOT CAUSE (tw-2026-09-12-011): when a profile is upgraded in place (a stub
  // is replaced with a full record, or the disambiguation suffix moves the slug
  // to `name-year`), the OLD row survives in people.json under its previous slot
  // and the NEW row is pushed alongside it. Both carry the SAME vault_file, so
  // one human gets two live pages — e.g. Andrew Telfer.md (1798–1858, deceased)
  // was published BOTH as /andrew-telfer-living/ (blank, generation 99, marked
  // living) and /andrew-telfer-1798/. Same for Eva Agnes Farrow.
  //
  // A vault file is one person. Merge any group of records sharing a vault_file
  // into the richest single record, preferring: known birth year > no birth year,
  // then real generation over the 99 placeholder, then non-living over living.
  const byVaultFile = new Map();
  const noVaultFile = [];
  for (const p of existingPeople) {
    const vf = (p.vault_file || '').trim();
    if (!vf) { noVaultFile.push(p); continue; }
    if (!byVaultFile.has(vf)) byVaultFile.set(vf, []);
    byVaultFile.get(vf).push(p);
  }
  const mergedPeople = [];
  let twinsKilled = 0;
  for (const [vf, group] of byVaultFile) {
    if (group.length === 1) { mergedPeople.push(group[0]); continue; }
    const scored = [...group].sort((a, b) => {
      const aBorn = a.birth_year != null ? 1 : 0;
      const bBorn = b.birth_year != null ? 1 : 0;
      if (aBorn !== bBorn) return bBorn - aBorn;            // prefer known birth year
      const aReal = a.generation !== 99 && a.generation != null ? 1 : 0;
      const bReal = b.generation !== 99 && b.generation != null ? 1 : 0;
      if (aReal !== bReal) return bReal - aReal;            // prefer a real generation
      const aDead = a.is_living ? 0 : 1;
      const bDead = b.is_living ? 0 : 1;
      if (aDead !== bDead) return bDead - aDead;            // prefer confirmed-deceased
      return (b.body_markdown || '').length - (a.body_markdown || '').length;
    });
    const winner = scored[0];
    const losers = scored.slice(1);
    for (const l of losers) {
      console.log(`  🧹 PURGED duplicate twin: ${l.display_name || l.slug} [${l.slug}] — same vault file as [${winner.slug}] [${vf}]`);
    }
    twinsKilled += losers.length;
    mergedPeople.push(winner);
  }
  existingPeople = [...mergedPeople, ...noVaultFile];
  if (twinsKilled > 0) {
    console.log(`  🧹 Duplicate-twin purge: removed ${twinsKilled} record(s) that duplicated a vault file`);
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
    // slugs already spoken for by records that are NOT being re-slugged, so a new
    // suffix can never land on a live URL
    const claimed = new Set(
      existingPeople.filter((p) => !conflictedSlugs.has(p.slug)).map((p) => p.slug)
    );
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
        // ── COLLISION-AWARE SUFFIX (2026-10-28) ───────────────────────────────
        // Two records can resolve to the SAME suffix — two Marks with no middle
        // name and no birth year both landed on `mark-telfer-living`, and two
        // people who differ only by a name they share produced the same
        // middle-fragment. A suffix that is already taken by a DIFFERENT vault
        // file is not a disambiguator; escalate to `-2`, `-3`, … until it is
        // unique, so every person keeps their own URL.
        let candidate = p.slug + '-' + suffix;
        if (claimed.has(candidate)) {
          let n = 2;
          while (claimed.has(candidate + '-' + n)) n++;
          candidate = candidate + '-' + n;
        }
        claimed.add(candidate);
        p.slug = candidate;
        console.log(`  ${p.display_name} → ${p.slug}`);
      }
    }
  }

  // 4. Write back
  fs.writeFileSync(PEOPLE_JSON, JSON.stringify(existingPeople, null, 2) + '\n', 'utf-8');

  // Persist the sanitised name→canonical-name map for the resolvers. Written every
  // run (including an empty map) so a deleted stub can never leave a stale alias
  // binding somebody to the wrong record.
  fs.writeFileSync(
    path.resolve(process.cwd(), 'src/data/redirect-aliases.json'),
    JSON.stringify(redirectAliases, null, 2) + '\n',
    'utf-8'
  );

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
