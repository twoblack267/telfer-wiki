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
import { PRIVACY_STRIP_SLUGS } from '../src/data/privacy-exclusions.mjs';

const PEOPLE_JSON = 'src/data/people.json';
const DIST_DIR = 'dist/people';
const REDIRECT_LOG = 'scripts/redirect-log.json';

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf-8'));

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY: every canonical slug in THIS run. A redirect whose `from` is one of
// these is not an alias — it is a LIVE PAGE, and emitting it overwrites a real
// person's profile with a meta-refresh stub that sends visitors to a DIFFERENT
// person. That is a silent wrong-person 200: no 404, so no link checker sees it.
//
// Real case (tw-2026-09-19-001): 'Francis Charles Telfer' (b.1875, d.1954) holds
// the canonical slug `francis-telfer-1875`. 'Francis Adam Telfer' (b.1875,
// d.1955) collides on first+last+birth_year, so Case 1 computed his "old slug"
// as `francis-telfer-1875` and emitted an alias straight over Charles's page.
// Same for `james-telfer-1866` (James Telfer, d.1946) hijacked by James Robert
// Telfer (d.1925). Both were live and wrong.
//
// A redirect may only ever point FROM a URL nobody currently owns. If the slug
// is claimed by a live page, the alias is not needed (the URL already resolves
// to the right person) and emitting it is destructive. This guard is deliberately
// placed here, before any emission, so no downstream stage can re-introduce it.
// ─────────────────────────────────────────────────────────────────────────────
const canonicalSlugs = new Set(people.map(p => p.slug));
const suppressed = [];
/** Aliases dropped because their destination is withdrawn (privacy strip). */
const strippedAliases = [];

// Build map: old-format slug → actual person
const redirects = [];

function pushRedirect(r) {
  if (canonicalSlugs.has(r.from)) {
    suppressed.push(r);
    return;
  }
  // PRIVACY STRIP: a withdrawn person has no page, so ANY alias pointing at
  // them would be a hard 404 and the redirect-health gate would (correctly)
  // refuse the deploy. Dropped here, at the single choke point every case
  // funnels through. Reversible — remove the slug from the privacy list and
  // the alias is regenerated on the next build. See src/data/privacy-exclusions.mjs.
  if (PRIVACY_STRIP_SLUGS.has(r.to)) {
    strippedAliases.push(r);
    return;
  }
  redirects.push(r);
}

for (const p of people) {
  const newSlug = p.slug;
  const firstName = (p.first_name || '').toLowerCase();
  const lastName = (p.last_name || '').toLowerCase();
  const birthYear = p.birth_year;

  // Old slug (as it would have been generated)
  const bareSlug = `${firstName}-${lastName}`.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
  const oldSlug = birthYear ? `${bareSlug}-${birthYear}` : bareSlug;

  // Case 1: Old year-suffixed slug is different from new slug → redirect
  //
  // FIXED 2026-10-25 (the redirect log claimed a direction the site never had).
  // `oldSlug` is GUESSED from first+last+birth_year; it is not a record of the URL
  // that actually existed. When `Marion Lawrie (1838–1920)` was added, the group
  // "marion lawrie" went from one member to two, so the colliding member who had
  // held the BARE slug `marion-lawrie` became `marion-lawrie-1888` — and the new
  // arrival took the bare slug. This branch then computed oldSlug
  // `marion-lawrie-1888` and "redirected" it to `marion-lawrie`: exactly BACKWARDS,
  // and it pointed a live page at a different woman. Case 3 (which exists for this
  // very situation) never fired because the bare slug was claimed in this run.
  // Still worse, `janet-lawrie` got no entry at all: her guessed oldSlug equalled
  // her new slug, so nothing was emitted and the old URL was left with no redirect.
  //
  // The rule that actually holds: the real old URL is the BARE slug when the
  // person's group is now conflicted, and the year-suffixed form when it is not.
  // Identity lives in the SLUG, never in a plausible-looking derivation.
  const groupMembers = people.filter((q) => {
    const qf = (q.first_name || '').toLowerCase();
    const ql = (q.last_name || '').toLowerCase();
    return `${qf}-${ql}`.replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-') === bareSlug;
  });
  const groupConflicted = groupMembers.length > 1;
  // In a conflicted group, the URL that used to be this person's is the bare slug —
  // unless they still hold the bare slug, in which case their URL has not changed.
  const actualOldSlug = groupConflicted && newSlug !== bareSlug ? bareSlug : oldSlug;
  if (actualOldSlug !== newSlug && !canonicalSlugs.has(actualOldSlug)) {
    pushRedirect({
      from: actualOldSlug,
      to: newSlug,
      reason: actualOldSlug.includes(String(birthYear || '')) ? 'lost-year' : 'slug-changed',
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
      pushRedirect({
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
  // PRIVACY STRIP: never manufacture an alias pointing at a withdrawn page —
  // the destination does not exist, so the alias would be a hard 404 and the
  // redirect-health gate correctly blocks the deploy. See
  // src/data/privacy-exclusions.mjs.
  if (PRIVACY_STRIP_SLUGS.has(p.slug)) continue;
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
    pushRedirect({ from: r.from, to: r.to, display_name: r.display_name });
  }
}

// Case M: MANUAL legacy aliases. These bare-name URLs were previously handled
// only by public/_redirects (a Netlify convention that GitHub Pages ignores),
// so they returned hard-404s. Emit real stub pages for them so every historical
// alias resolves to its final LIVE person page (no more 404s). Targets are all
// verified current canonical slugs (resolved to final live pages, never stubs).
const MANUAL_ALIASES = [
  { from: 'adam',           to: 'adam-telfer-1842',     display_name: 'Adam Francis Telfer' },
  { from: 'amy-nicole-telfer', to: 'amy-telfer', display_name: 'Amy Nicole Telfer' },
  { from: 'francis',        to: 'francis-telfer-1809',  display_name: 'Francis Telfer' },
  { from: 'francis-180995', to: 'francis-telfer-1809',  display_name: 'Francis Telfer' },
  { from: 'james',          to: 'james-telfer-1829',    display_name: 'James Telfer' },
  { from: 'james-17961863', to: 'james-telfer-1796',    display_name: 'James Telfer' },
  { from: 'john',           to: 'john-telfer-1840',     display_name: 'John Telfer' },  // was malformed 18401913
  // 'robert' is AMBIGUOUS: three real people share the name (robert-telfer-1803,
  // -1835, -1886). This alias previously pointed at a slug that does not exist, so it
  // emitted a redirect to a 404. Pointing a bare first name at ONE of them would be an
  // invented fact, so the alias is REMOVED. /people/robert/ 404s, which is truthful.
  // Removed 2026-09-12 (tw-2026-09-12-064).
  // Post-flip legacy year aliases (Esther Jane birth-year corrected 1835→1834).
  // These old URLs predate the correction; keep them resolving cleanly to the
  // real page rather than leaving stale relative stubs / new 404s behind.
  { from: 'esther-jane-telfer-1835', to: 'esther-jane-telfer-1834', display_name: 'Esther Jane Telfer' },
  { from: 'esther-telfer-1835',      to: 'esther-jane-telfer-1834', display_name: 'Esther Jane Telfer' },
];
for (const a of MANUAL_ALIASES) pushRedirect(a);

// Deduplicate (same 'from' should only redirect to one destination)
const seen = new Set();
const uniqueRedirects = redirects.filter(r => {
  if (seen.has(r.from)) return false;
  seen.add(r.from);
  return true;
});

// Load existing Astro-generated pages to avoid collisions
//
// FIXED 2026-10-25 (stale dist/ silently deleted a needed redirect).
// `dist/people/marion-lawrie/` still held a REAL page from the previous build,
// from when Marion Vida Lawrie held the bare slug. The new build gives that URL
// to Marion Lawrie (1838–1920), so the alias `marion-lawrie → marion-lawrie-1888`
// is exactly what legacy links need. But this scan saw the OLD file, called it a
// live page, and skipped the redirect — then wrote the SKIP into redirect-log.json,
// so the crown-jewel guard was told "nothing was renamed" and reported the person
// as VANISHED. One stale build directory, two misleading failures.
//
// The build output is a DERIVED artefact: dist/ describes the LAST build, never the
// data in hand. Treat a page as existing only when its slug is still canonical
// TODAY; a slug the current people.json no longer claims cannot be owned by the
// current build, whatever yesterday left on disk.
const DROP_IF_PAGE_EXISTS = new Set();
if (fs.existsSync(DIST_DIR)) {
  const entries = fs.readdirSync(DIST_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!canonicalSlugs.has(entry.name)) continue; // stale page — not this build's
    if (entry.isDirectory()) {
      const pageFile = path.join(DIST_DIR, entry.name, 'index.html');
      if (fs.existsSync(pageFile)) {
        const content = fs.readFileSync(pageFile, 'utf-8');
        if (!content.includes('http-equiv="refresh"')) {
          DROP_IF_PAGE_EXISTS.add(entry.name);
        }
      }
    }
  }
}

// Filter out redirects whose source slug already exists as a real page, and
// any alias pointing at a WITHDRAWN page (privacy strip) — the destination does
// not exist, so the alias would be a hard 404. Loud on purpose: the strip is
// supposed to remove these, and a silent skip rots. See
// src/data/privacy-exclusions.mjs.
const filteredRedirects = uniqueRedirects.filter(r => {
  if (DROP_IF_PAGE_EXISTS.has(r.from)) {
    console.log(`  ⏭️  SKIP (page exists): ${r.from} → ${r.to}  (${r.display_name})`);
    return false;
  }
  // A withdrawn destination (privacy strip) is handled by the declared
  // removed-redirects.json set below — that declaration supplies a LIVING
  // destination page, so the alias is not a 404. Anything else pointing at a
  // withdrawn page is dropped: the alternative is shipping a link to nothing.
  if (PRIVACY_STRIP_SLUGS.has(r.to) && !REMOVED_DECLARED.has(r.from)) {
    console.log(`  🔒 SKIP (destination withdrawn by privacy strip): ${r.from} → ${r.to}`);
    return false;
  }
  return true;
});

// ── PRIVACY-WITHDRAWN PAGES (declared destinations) ──────────────────────────
// A page withdrawn by an owner privacy ruling while the URL was live gets a
// stub pointing at the named, LIVING page that declares it (normally the
// parent). Declared in src/data/removed-redirects.json, never inferred: the
// whole point is that a person whose page was removed still resolves to a real
// page, without the site publishing them. See src/data/privacy-exclusions.mjs.
let REMOVED_DECLARED = new Set();
try {
  const removedJson = JSON.parse(fs.readFileSync('src/data/removed-redirects.json', 'utf-8')).removed || {};
  REMOVED_DECLARED = new Set(Object.keys(removedJson));
  for (const [from, decl] of Object.entries(removedJson)) {
    if (!decl || !decl.to) continue;
    if (!PRIVACY_STRIP_SLUGS.has(from)) continue;   // normal removals handled by emit-git-slug-redirects
    if (existingPages.has(from)) continue;          // the page still exists — never shadow it
    filteredRedirects.push({
      from,
      to: decl.to,
      display_name: decl.person || decl.to,
      reason: 'privacy-withdrawal',
    });
    console.log(`  🔒 alias for privacy-withdrawn page: ${from} → ${decl.to}`);
  }
} catch (e) {
  console.log(`  ⚠️  could not read src/data/removed-redirects.json (${e.message}) — no privacy aliases emitted`);
}

// Write redirect pages
console.log(`\n📝 Generating ${filteredRedirects.length} redirect(s) (${uniqueRedirects.length - filteredRedirects.length} skipped)...`);

// ── SUPPRESSED: origin slugs that belong to a LIVE page (tw-2026-09-19-001) ──
// Loud on purpose. Suppression is the fix working, but a silent fix rots: if this
// number ever jumps, a slug collision has appeared between two real people and the
// disambiguator needs looking at, not the guard. Never auto-silence this.
if (suppressed.length > 0) {
  console.log(`\n🛡️  SUPPRESSED ${suppressed.length} redirect(s) — origin slug is a LIVE page:`);
  for (const r of suppressed) {
    console.log(`   ${r.from} ✗ (would have hijacked a real page → ${r.to}, ${r.display_name})`);
  }
  console.log(`   These people KEEP their own URLs. No alias emitted.`);
}

function writeRedirect(from, to, displayName, isPeopleRedirect = true) {
  const baseDir = isPeopleRedirect ? DIST_DIR : 'dist';
  const dir = path.join(baseDir, from);
  const filePath = path.join(dir, 'index.html');

  fs.mkdirSync(dir, { recursive: true });

  // ABSOLUTE canonical (was relative ../..) so search engines treat this as an
  // alias of the real person page, NOT an independent thin page. Absolute URLs
  // are unambiguous and are what the SEO audit flagged the old relative form as.
  const absBase = 'https://telferwiki.com';
  // People redirects -> /people/<slug>/; top-level (families) -> /<slug>/
  const destPath = isPeopleRedirect ? `/people/${to}/` : `/${to}/`;
  const targetUrl = `${absBase}${destPath}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Redirecting to ${displayName}</title>
  <meta http-equiv="refresh" content="0;url=${targetUrl}">
  <link rel="canonical" href="${targetUrl}">
  <meta name="robots" content="noindex">   <!-- alias page: never index as a duplicate/pagination; the canonical profile is indexed instead -->
</head>
<body>
  <p>Redirecting to <a href="${targetUrl}">${displayName}</a>...</p>
</body>
</html>
<script>
  // Fallback if meta-refresh is disabled
  location.replace('${targetUrl}');
</script>`;

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
