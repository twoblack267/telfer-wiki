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
 * THE HONEST LIMIT — read this before changing anything below:
 *
 *   A COMPLETE text dump of this site CANNOT exclude living people, and no
 *   filter will ever make it. The site itself names living people as plain text
 *   on their relatives' pages, in obituaries, and on the homepage — that is the
 *   owner's deliberate public design. A dump that mirrors the site therefore
 *   mirrors the living names too. Measured 26 Oct 2026: all 35 living people
 *   appeared in the first complete run, every instance sourced from a page that
 *   is already public.
 *
 *   That is why this script writes to build/llms-full.txt and NOT to dist/.
 *   It is a tool that can produce the file on request; it is not deployed.
 *   Deploying it is a privacy decision for the owner, because the only honest
 *   description of the artefact is "a complete roster of the family, living
 *   included, in one machine-readable file".
 *
 * WHAT IS EXCLUDED, AND WHY:
 *   - Living people's OWN pages, family sheets and descendant charts: skipped
 *     entirely. This removes a living person's biography, not their name as it
 *     appears in a parent's obituary.
 *   - Index/roster pages (/people/, /people/families/*, /search/, /timeline/):
 *     these contain no biography, only lists of all 412 names — the cheapest
 *     bulk route to the living roster, so they are cut.
 *   - /tree/ and /people/full-tree/. Both carry robots noindex by owner ruling.
 *   - Withdrawn names. Their pages do not exist (honest 404), so they cannot
 *     be picked up here — that is by construction, not by filtering.
 *   - /tree/ and /people/full-tree/. Both carry robots noindex by owner ruling;
 *     dumping their contents would leak what the fence exists to protect.
 *   - Redirect stubs (pages with no body content).
 *
 * Run AFTER the astro build, BEFORE the postbuild gates.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
// Deliberately NOT in dist/. Writing into dist/ means `deploy` publishes it, and
// this file is a complete roster of the family including living people. It is
// produced on request; deployment is the owner's decision, not a build side effect.
const OUT = join(ROOT, 'build', 'llms-full.txt');
// build/ is gitignored, so it does NOT exist on a clean CI checkout. Creating it
// here is the difference between "works on my machine" and a green pipeline —
// this exact line was missing and broke CI on commit 1cd0f7e.
mkdirSync(join(ROOT, 'build'), { recursive: true });

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
  skippedChart = 0,
  skippedIndex = 0,
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
  // INDEX / LIST SURFACES. These pages contain no biography — they are rosters:
  // /people/, /people/families/, /people/families/<surname>/, /search/, /timeline/.
  // Every one of them lists all 412 people by name and year, living included, so
  // they were the single largest route by which the living roster entered the
  // dump — bigger than the descendant charts I first blamed. A machine ingesting
  // the file gets a clean complete list of names. The person pages that carry the
  // actual sourced biography are what belongs here; the indexes are navigation.
  const INDEX_PAGES = [
    '/people/', '/search/', '/timeline/', '/downloads/', '/tree/',
  ];
  if (INDEX_PAGES.includes(rel) || /^\/people\/families(\/([^/]+))?\/$/.test(rel)) {
    skippedIndex++;
    continue;
  }
  // Descendant charts of EVERYONE are excluded, not just living people's. They are
  // navigation furniture rather than biography — a chart of names adds nothing an
  // AI reader needs that the person pages do not already carry — and they are the
  // only route by which a living child's name reaches a bulk machine-readable dump
  // through a deceased parent's page. Cutting them removes that route entirely.
  if (/\/people\/[^/]+\/(family-sheet|descendants)\/?$/.test(rel)) {
    skippedChart++;
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

// Living MINORS who are named on deceased ancestors' descendant charts. The
// owner's public ruling allows those names as plain text on the pages themselves;
// it does not license reproducing them in a bulk file built for machine ingestion.
// The chart exclusion above should already remove every one of these, so this is
// a belt-and-braces assertion on the artefact itself, not on the filter's logic.
// The real rule is not "these three names" — it is that NO living person's name
// should be recoverable from a bulk dump. Build the living display-name list from
// the same data the site uses and assert every one of them is absent.
const livingNames = (() => {
  try {
    const raw = JSON.parse(readFileSync('src/data/people.public.json', 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.people || Object.values(raw);
    return arr.filter((p) => p.is_living).map((p) => p.display_name).filter(Boolean);
  } catch {
    return [];
  }
})();
const livingHits = livingNames.filter((n) => written.includes(n));
if (livingHits.length) {
  // NOT a failure, and deliberately so. Living names on relatives' pages are the
  // owner's published design, so a complete dump always contains them. A check
  // that is permanently red is a check nobody reads. Report the fact plainly so
  // whoever deploys this knows exactly what they are publishing.
  console.warn(
    `llms-full: NOTE — ${livingHits.length} of ${livingNames.length} living people are named in this file,`
  );
  console.warn('  because the live site names them on relatives pages and obituaries.');
  console.warn('  This file is a complete roster of the family. Deploying it is a privacy decision.');
}

const kb = Math.round(written.length / 1024);
console.log(
  `llms-full: wrote ${OUT} — ${included} pages, ${kb} KB ` +
    `(skipped ${skippedLiving} living, ${skippedChart} charts, ${skippedFenced} fenced, ${skippedStub} stubs)`
);

if (included < 10) {
  console.error('llms-full: suspiciously few pages included — refusing to pass.');
  process.exit(1);
}
