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

  // Case 1b: COLLAPSED-first-name old slug variant.
  // Historical/legacy slug scheme used only the FIRST word of a multi-word
  // first name, e.g. 'william-parker-1850' for "William Humphrey Parker",
  // 'clara-telfer-1883' for "Clara Blanche Telfer". If a person's first name
  // has more than one word, redirect the collapsed form → the correct new slug.
  // This covers legacy links that full-first-name Case 1 misses (147 people
  // had no redirect; william-parker-* links 404'd live).
  const firstWords = (p.first_name || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (firstWords.length > 1) {
    const collapsedBare = `${firstWords[0]}-${lastName}`.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
    const collapsedOld = birthYear ? `${collapsedBare}-${birthYear}` : collapsedBare;
    if (collapsedOld !== newSlug && collapsedOld !== oldSlug) {
      redirects.push({
        from: collapsedOld,
        to: newSlug,
        reason: 'collapsed-first-name',
        display_name: p.display_name
      });
    }
  }

  // Case 2: Bare slug was taken by this person before, now changed
  // e.g. 'amy-telfer' was taken by Amy Nicole, but now Amy Nicole is 'amy-telfer-nicole'
  // This is covered by Case 1 (oldSlug 'amy-telfer' !== newSlug 'amy-telfer-nicole')
}

// Case 3: NEWLY-CONFLICTED bare slug → suffixed slug.
// When a second person with the same first+last appears, the slug disambiguator
// year-suffixes EVERY member of the conflict group (convert-markdown collision
// logic). The member who previously held the bare slug loses it. Emit a redirect
// from the now-unclaimed bare slug → their new suffixed slug, but ONLY when the
// bare slug is not claimed as the real page of another person in this run.
const bareToNew = [];
for (const p of people) {
  const firstName = (p.first_name || '').toLowerCase();
  const lastName = (p.last_name || '').toLowerCase();
  const bareSlug = `${firstName}-${lastName}`.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
  if (bareSlug !== p.slug && /-\d{4}$/.test(bareSlug) === false) {
    // bareSlug differs — someone in this group holds it; find who owns the bare slug
    const owner = people.find(q => {
      const qf = (q.first_name || '').toLowerCase();
      const ql = (q.last_name || '').toLowerCase();
      const qbare = `${qf}-${ql}`.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
      return qbare === bareSlug && q.slug === bareSlug;
    });
    // Only redirect when the bare slug is NOT a live page in this run
    if (!owner) {
      bareToNew.push({ from: bareSlug, to: p.slug, display_name: p.display_name, birth: p.birth_year });
    }
  }
}
// When a whole collision group lost their bare slug (e.g. a newly-added same-name
// ancestor), the historically-live bare URL belonged to whichever member was
// ALREADY at that slug before the conflict — deterministically the one with no
// children in this run (a leaf), since an ancestor being introduced triggers the
// conflict and owns it. Prefer that candidate for the bare-slug redirect.
const byBare = new Map();
for (const r of bareToNew) {
  if (!byBare.has(r.from)) {
    byBare.set(r.from, r);
  } else if ((r.birth || 0) >= (byBare.get(r.from).birth || 0)) {
    // equal-name conflict: the LEAF (no children) inherits the historical bare URL.
    byBare.set(r.from, r);
  }
}
// Push Case 3 redirects (dedupe: skip any 'from' already claimed by an earlier redirect)
const existingFrom = new Set(redirects.map(r => r.from));
for (const r of byBare.values()) {
  if (!existingFrom.has(r.from)) {
    redirects.push({ from: r.from, to: r.to, display_name: r.display_name });
  }
}

// Deduplicate (same 'from' should only redirect to one destination)
const seen = new Set();
const uniqueRedirects = redirects.filter(r => {
  if (seen.has(r.from)) return false;
  seen.add(r.from);
  return true;
});

// Load existing Astro-generated pages to avoid collisions
const existingPages = new Set();
if (fs.existsSync(DIST_DIR)) {
  const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pageFile = path.join(DIST_DIR, entry.name, 'index.html');
      if (fs.existsSync(pageFile)) {
        const content = fs.readFileSync(pageFile, 'utf-8');
        if (!content.includes('http-equiv="refresh"')) {
          existingPages.add(entry.name);
        }
      }
    }
  }
}

// Filter out redirects whose source slug already exists as a real page
const filteredRedirects = uniqueRedirects.filter(r => {
  if (existingPages.has(r.from)) {
    console.log(`  ⏭️  SKIP (page exists): ${r.from} → ${r.to}  (${r.display_name})`);
    return false;
  }
  return true;
});

// Write redirect pages
console.log(`\n📝 Generating ${filteredRedirects.length} redirect(s) (${uniqueRedirects.length - filteredRedirects.length} skipped)...`);

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

for (const r of filteredRedirects) {
  writeRedirect(r.from, r.to, r.display_name, true);
}

// Static redirect for /families/ → /people/families/
writeRedirect('families', 'families', 'Families', false);

// Write log for reference
fs.writeFileSync(REDIRECT_LOG, JSON.stringify(filteredRedirects, null, 2));
console.log(`\n✅ ${filteredRedirects.length} redirect(s) written to dist/\n📋 Log saved to ${REDIRECT_LOG}`);
