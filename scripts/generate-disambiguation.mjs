/**
 * generate-disambiguation.mjs — stop the silent wrong-person redirect.
 *
 * WHY (Skippy, 2026-09-20, tw-2026-09-20-004):
 *   The alias layer collapses a bare name onto ONE person. When two or more real
 *   people share a first+last name, that collapse INVENTS A FACT. Typing
 *   /people/elizabeth-beattie/ landed you on elizabeth-beattie-1802 — a different
 *   person from the prominent elizabeth-beattie-1741 the site advertises. /people/
 *   mark-telfer/ landed on mark-telfer-1877, not Mark. There was no 404 and no
 *   page saying "did you mean", so nobody could tell a choice had been made.
 *
 * WHAT THIS DOES — the three-way split, decided by Mark 2026-09-20:
 *   1. A bare name that can only mean ONE person  → keep the existing redirect.
 *      (212 of 238 bare names. Safe: the redirect states the only true answer.)
 *   2. A bare name that can mean MORE THAN ONE     → replace the redirect with a
 *      real disambiguation page listing every candidate by name, years and place,
 *      so the reader chooses. No invented fact, no dead end.  (26 names.)
 *   3. Anything else is left exactly as it was.
 *
 * WHY A DISAMBIGUATION PAGE IS SAFE FOR THE OTHER GATES:
 *   - It carries NO meta-refresh, so check-redirect-health.mjs (which only scans
 *     pages containing a refresh) does not treat it as a broken alias.
 *   - check-live-slug-regression.mjs counts a non-refresh page as a REAL page, so
 *     the previously-live bare URL is still served — no regression.
 *   - It is indexable on purpose (readers must find it), unlike an alias stub.
 *     It carries a self-referencing canonical so it is never counted as a
 *     duplicate of any candidate profile.
 *
 * Usage: node scripts/generate-disambiguation.mjs   (run in package.json postbuild,
 *        AFTER generate-redirects.mjs so it overwrites the wrong collapse)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PEOPLE_JSON = path.join(REPO, 'src/data/people.public.json');
const DIST_PEOPLE = path.join(REPO, 'dist/people');
const ABS_BASE = 'https://telferwiki.com';

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));
if (!fs.existsSync(DIST_PEOPLE)) {
  console.error('generate-disambiguation: dist/people missing — run after astro build.');
  process.exit(1);
}

/** A bare name = first_name + last_name, exactly as generate-redirects.mjs computes it. */
function bareOf(p) {
  const f = (p.first_name || '').toLowerCase();
  const l = (p.last_name || '').toLowerCase();
  return `${f}-${l}`.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
}

// Group people by bare name. Only people whose real slug carries the year suffix
// participate — that is the population the alias layer collapses.
const groups = new Map();
for (const p of people) {
  if (!p.slug || !/-\d{4}$/.test(p.slug)) continue;
  const b = bareOf(p);
  if (!b) continue;
  if (!groups.has(b)) groups.set(b, []);
  groups.get(b).push(p);
}

// A bare name that is the REAL slug of one person is NOT an alias — it is that
// person's live profile (e.g. 'william-telfer' = William Adam Francis Telfer, 1869).
// Writing a disambiguation page over it would replace a real person's page with a
// list, which is the exact silent-hijack class this work set out to remove.
// Ownership wins: a claimed slug is never touched.
const claimedSlugs = new Set(people.map((p) => p.slug));

const ambiguous = [...groups.entries()]
  .filter(([bare, list]) => list.length > 1 && !claimedSlugs.has(bare))
  .sort((a, b) => a[0].localeCompare(b[0]));

const skippedClaimed = [...groups.entries()]
  .filter(([bare, list]) => list.length > 1 && claimedSlugs.has(bare))
  .map(([bare]) => bare);
if (skippedClaimed.length) {
  console.log(`   (skipped ${skippedClaimed.length} ambiguous name(s) already owned by a real page: ${skippedClaimed.join(', ')})`);
}

/** Find the real hashed CSS bundle Astro emitted, so this hand-written page matches the site. */
function findStyleHref() {
  const astroDir = path.join(REPO, 'dist/_astro');
  if (fs.existsSync(astroDir)) {
    for (const f of fs.readdirSync(astroDir)) {
      if (f.endsWith('.css')) return `/_astro/${f}`;
    }
  }
  return '';
}
const styleHref = findStyleHref();

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One candidate row: name, dates, birthplace. Facts only — same fields the tree shows. */
function row(p) {
  const born = p.birth_year ? `b. ${p.birth_year}` : 'birth year unknown';
  const died = p.death_year ? `– d. ${p.death_year}` : '';
  const where = p.birth_place ? ` · born ${esc(p.birth_place)}` : '';
  return `      <li>
        <a href="/people/${esc(p.slug)}/">${esc(p.display_name || p.slug)}</a>
        <span class="dates">${esc(born)} ${esc(died)}${where}</span>
      </li>`;
}

function page(bare, list) {
  const title = bare.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const ordered = [...list].sort((a, b) => (a.birth_year || 9999) - (b.birth_year || 9999));
  const listHtml = ordered.map(row).join('\n');
  const canon = `${ABS_BASE}/people/${bare}/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — which one? | Telfer Family History</title>
  <meta name="description" content="${ordered.length} people named ${esc(title)} appear in the Telfer family history. Choose the one you are looking for.">
  <link rel="canonical" href="${canon}">
  <link rel="stylesheet" href="${styleHref}">
  <style>
    .disambig { max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
    .disambig h1 { margin: 0 0 .35rem; }
    .disambig .lede { color: var(--color-ink-light); margin: 0 0 1.75rem; }
    .disambig ul { list-style: none; padding: 0; margin: 0; }
    .disambig li { padding: .9rem 0; border-bottom: 1px solid var(--color-border); }
    .disambig li:last-child { border-bottom: 0; }
    .disambig a { color: var(--color-link); text-decoration-color: var(--color-border); font-weight: 600; }
    .disambig a:hover { color: var(--color-link-hover); text-decoration-color: var(--color-link-hover); }
    .disambig .dates { display: block; color: var(--color-ink-light); font-size: .9rem; margin-top: .15rem; }
    .disambig .note { margin-top: 2.5rem; font-size: .9rem; color: var(--color-ink-light); }
    .disambig { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.55; }
    .disambig h1 { font-size: 1.9rem; }
    .disambig a { text-decoration: underline; }
  </style>
</head>
<body>
  <main class="disambig">
    <h1>${esc(title)}</h1>
    <p class="lede">${ordered.length} people in this family history share the name <strong>${esc(title)}</strong>. Choose the one you are looking for:</p>
    <ul>
${listHtml}
    </ul>
    <p class="note">This page exists because the name alone does not identify one person. Nothing was guessed — every name above is a real profile.</p>
  </main>
</body>
</html>
`;
}

let written = 0;
const names = [];
for (const [bare, list] of ambiguous) {
  const dir = path.join(DIST_PEOPLE, bare);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(bare, list));
  written++;
  names.push(`${bare} (${list.length})`);
}

console.log(`\n🧭 disambiguation: wrote ${written} page(s) for ambiguous bare names → ${names.join(', ')}`);
