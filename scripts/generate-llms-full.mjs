#!/usr/bin/env node
/**
 * Generate dist/llms-full.txt — the full-text companion to llms.txt.
 *
 *   llms.txt       = the MAP (what exists, where it is). Hand-maintained.
 *   llms-full.txt  = the CONTENT (the actual pages, in full, in one fetch).
 *
 * The llms.txt convention defines both. Only the map was ever shipped, so
 * /llms-full.txt returned 404 — not a broken link (nothing on the site ever
 * pointed at it) but a missing half of the standard.
 *
 * SOURCE OF TRUTH: the built HTML in dist/, not the raw markdown. If it is not
 * published, it does not belong in a file that exists to describe what is
 * published. This also means the privacy exclusions and noindex fences are
 * honoured automatically — a page that was never built cannot be dumped.
 *
 * WHAT IS EXCLUDED, AND WHY:
 *   - Living people. The full-text dump is the single easiest way to hand an
 *     LLM a living person's details in bulk. Dist .people pages for living
 *     individuals are skipped entirely.
 *   - Withdrawn names. Their pages do not exist (honest 404), so they cannot
 *     be picked up here — that is by construction, not by filtering.
 *   - /tree/ and /people/full-tree/. Both carry robots noindex by owner ruling;
 *     dumping their contents would leak what the fence exists to protect.
 *   - Redirect stubs (pages with no body content).
 *
 * Run AFTER the astro build, BEFORE the postbuild gates.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'llms-full.txt');

const SITE = 'https://telferwiki.com';

/** Pages whose contents must never be dumped, whatever the sitemap says. */
const FENCED = ['/tree/', '/people/full-tree/'];

/** Strip an HTML document down to readable text. Crude on purpose: structure
 *  here is a navigation aid, not a promise. The source pages remain canonical. */
function htmlToText(html) {
  const body = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<h1[^>]*>/gi, '\n\n# ')
    .replace(/<h2[^>]*>/gi, '\n\n## ')
    .replace(/<h3[^>]*>/gi, '\n\n### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|ul|ol)>/gi, '\n\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;|&ndash;/g, '—')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleOf(html) {
  return (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').replace(/\s*—\s*Telfer Wiki\s*$/, '').trim();
}

/** True when the built page is a client-side redirect stub rather than content. */
function isRedirectStub(html) {
  return /http-equiv=["']refresh["']/i.test(html) || !/<main/i.test(html);
}

/** Living-person pages are identified from the data, not guessed from text. */
function livingSlugs() {
  const p = join(ROOT, 'src', 'data', 'people.public.json');
  if (!existsSync(p)) return new Set();
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.people ?? Object.values(raw));
  const out = new Set();
  for (const one of arr) {
    if (one?.is_living === true || one?.living === true) out.add(one.slug);
  }
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name === 'index.html') acc.push(p);
  }
  return acc;
}

// --- main ---------------------------------------------------------------

if (!existsSync(DIST)) {
  console.error('llms-full: dist/ not found — run the astro build first.');
  process.exit(1);
}

const living = livingSlugs();
const files = walk(DIST).sort();
let included = 0,
  skippedFenced = 0,
  skippedLiving = 0,
  skippedStub = 0;

const parts = [];

for (const file of files) {
  const rel = '/' + file.slice(DIST.length + 1).replace(/\/index\.html$/, '/');
  if (FENCED.some((f) => rel === f || rel.startsWith(f))) {
    skippedFenced++;
    continue;
  }
  const slug = rel.replace(/^\/people\//, '').replace(/\/$/, '');
  // NOT just the person page. A living person also owns their family sheet and
  // descendant chart — /people/<slug>/family-sheet/ and /people/<slug>/descendants/.
  // Matching only the exact page let 48 living people's children through.
  if (rel.startsWith('/people/') && living.has(slug.split('/')[0])) {
    skippedLiving++;
    continue;
  }
  const html = readFileSync(file, 'utf8');
  if (isRedirectStub(html)) {
    skippedStub++;
    continue;
  }
  const text = htmlToText(html);
  // A page with almost no body after chrome removal is navigation, not content.
  if (text.length < 200) {
    skippedStub++;
    continue;
  }
  const title = titleOf(html) || rel;
  parts.push(`## ${title}\n\nSource: ${SITE}${rel}\n\n${text}\n`);
  included++;
}

const header = [
  '# Telfer Wiki — full text',
  '',
  'This is the complete published text of the Telfer Wiki, a genealogy of the Telfer',
  'family from the Scottish Borders to South Australia. It is the companion to',
  `${SITE}/llms.txt, which maps the site; this file carries the content.`,
  '',
  'Generated at build time from the published pages. The individual pages remain',
  'canonical — each section below names its source URL.',
  '',
  'DELIBERATELY EXCLUDED: pages for living people (privacy), the full family tree',
  'pages (robots noindex by the owner\'s ruling), and redirect stubs. Nothing here',
  'has been invented or inferred; where the wiki does not know something, the page',
  'says so, and that wording is reproduced as written.',
  '',
  '---',
  '',
].join('\n');

writeFileSync(OUT, header + parts.join('\n'));

// --- SELF-CHECK -----------------------------------------------------------
// The first version of this script reported "skipped 48 living" while shipping
// all 48 living people's family sheets. A count is not a check. Re-read the
// artefact we just wrote and prove no living slug appears in it at all.
const written = readFileSync(OUT, 'utf8');
const leaked = [...living].filter((s) => written.includes(`/people/${s}/`));
if (leaked.length) {
  console.error(`llms-full: PRIVACY FAIL — ${leaked.length} living person(s) present in the dump.`);
  console.error('  e.g. ' + leaked.slice(0, 5).join(', '));
  process.exit(1);
}
if (written.includes('/people/full-tree') || /\nSource: https:\/\/telferwiki\.com\/tree\//.test(written)) {
  console.error('llms-full: PRIVACY FAIL — a fenced tree page was dumped.');
  process.exit(1);
}

const kb = Math.round(written.length / 1024);
console.log(
  `llms-full: wrote ${OUT} — ${included} pages, ${kb} KB ` +
    `(skipped ${skippedLiving} living, ${skippedFenced} fenced, ${skippedStub} stubs)`
);

if (included < 10) {
  console.error('llms-full: suspiciously few pages included — refusing to pass.');
  process.exit(1);
}
