/**
 * Generate HTML redirects for slug changes
 *
 * Old slug scheme: firstname-lastname-YYYY (for everyone with birth_year)
 * New slug scheme: firstname-lastname (unique) or firstname-lastname-YYYY (conflict)
 *
 * We't need redirects from old year-suffixed slugs → new bare slugs for
 * people whose name is unique.
 *
 * We also need redirects from bare slugs → new suffixed slugs for people
 * who are in a conflict group and had the bare slug.
 *
 * Usage: node scripts/generate-redirects.mjs
 */

import fs from 'fs';
import path from 'path';

const PEOPLE_JSON = 'src/data/people.json';
const DIST_DIR = 'dist/people';
const REDIRECT_LOG = 'scripts/redirect-log.json';

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));

// Build map: old-format slug → actual person
const redirects = [];

for (const p of people) {
  const newSlug = p.slug;
  const firstName = (p.first_name || '').toLowerCase();
  const lastName = (p.last_name || '').toLowerCase();
  const birthYear = p.birth_year;

  // Old slug (as it would have been generated)
  const bareSlug = `${firstName}-${lastName}`.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
  const oldSlug = birthYear ? `${bareSlug}-${birthYear}` : bareSlug;

  // Case 1: Old year-suffixed slug is different from new slug → redirect
  if (oldSlug !== newSlug) {
    redirects.push({
      from: oldSlug,
      to: newSlug,
      reason: oldSlug.includes(String(birthYear || '')) ? 'lost-year' : 'slug-changed',
      display_name: p.display_name
    });
  }

  // Case 2: Bare slug was taken by this person before, now changed
  // e.g. 'amy-telfer' was taken by Amy Nicole, but now Amy Nicole is 'amy-telfer-nicole'
  // This is covered by Case 1 (oldSlug 'amy-telfer' !== newSlug 'amy-telfer-nicole')
}

// Deduplicate (same 'from' should only redirect to one destination)
const seen = new Set();
const uniqueRedirects = redirects.filter(r => {
  if (seen.has(r.from)) return false;
  seen.add(r.from);
  return true;
});

// Write redirect pages
console.log(`\n📝 Generating ${uniqueRedirects.length} redirect(s)...`);

function writeRedirect(from, to, displayName, isPeopleRedirect = true) {
  const baseDir = isPeopleRedirect ? DIST_DIR : 'dist';
  const dir = path.join(baseDir, from);
  const filePath = path.join(dir, 'index.html');

  // Depth from file's directory to dist/ root (number of segments past 'dist')
  const segmentsFromDist = dir.split(path.sep).filter(Boolean).length - 1;
  const prefix = '../'.repeat(Math.max(0, segmentsFromDist));

  fs.mkdirSync(dir, { recursive: true });

  const targetUrl = `${prefix}people/${to}/`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0;url=${targetUrl}">
  <link rel="canonical" href="${targetUrl}">
  <title>Redirecting...</title>
</head>
<body>
  <p>Redirecting to <a href="${targetUrl}">${displayName}</a>...</p>
</body>
</html>`;

  fs.writeFileSync(filePath, html);
  console.log(`  ${from} → ${to}  (${displayName})`);
}

for (const r of uniqueRedirects) {
  writeRedirect(r.from, r.to, r.display_name, true);
}

// Static redirect for /families/ → /people/families/
writeRedirect('families', 'families', 'Families', false);

// Write log for reference
fs.writeFileSync(REDIRECT_LOG, JSON.stringify(uniqueRedirects, null, 2));
console.log(`\n✅ ${uniqueRedirects.length} redirect(s) written to dist/\n📋 Log saved to ${REDIRECT_LOG}`);
