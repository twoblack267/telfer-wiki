#!/usr/bin/env node
/**
 * emit-family-slug-redirects.mjs
 *
 * WHY THIS EXISTS (5 November 2026):
 *
 * 25 vault person notes had their WHOLE display name stuffed into `last_name`
 * ("Telfer (of Castleton)", "Jane Paynter", "Farrow Jr"). The family pages are
 * built by grouping on `last_name`, so those 25 people got 25 one-person
 * family pages whose URLs contain raw spaces and brackets:
 *
 *     /people/families/telfer%20(of%20castleton)/
 *     /people/families/paynter%20(of%20calstock)/
 *
 * Those URLs were already published and 24 of them were in the sitemap — the
 * worst possible signal: a name nobody would ever type, advertised to Google.
 * After the surname fix they are gone (Telfer, Paynter, Farrow...). A URL that
 * has been advertised must NOT 404; it must bend to the correct family page.
 *
 * WHAT IT DOES: reads src/data/history/family-slug-aliases.json (old dirty
 * slug -> true surname) and writes a redirect stub at
 * dist/people/families/<old slug>/index.html pointing at the real family page.
 * Same shape as the person-page stubs from emit-git-slug-redirects.mjs:
 * meta refresh + canonical + robots noindex + location.replace.
 *
 * WHY A DATA FILE AND NOT A HEURISTIC: the old slugs were never derivable from
 * the corrected data — that is the whole point of the fix. They are a FACT, so
 * they are recorded once, with the reason, and diffed against nothing.
 *
 * Idempotent: safe to run on every build. A missing target family page is
 * reported loudly and skipped rather than emitting a stub that lands on a 404.
 *
 * Usage: node scripts/emit-family-slug-redirects.mjs [--dist <dir>]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const distIdx = process.argv.indexOf('--dist');
const DIST = distIdx > -1 ? path.resolve(process.argv[distIdx + 1]) : path.join(REPO, 'dist');
const SITE = 'https://telferwiki.com';
const ALIASES = path.join(REPO, 'src/data/history/family-slug-aliases.json');
const OUT = path.join(DIST, 'people/families');

if (!fs.existsSync(ALIASES)) {
  console.error(`✋ missing ${path.relative(REPO, ALIASES)} — cannot emit family redirects.`);
  process.exit(1);
}
if (!fs.existsSync(OUT)) {
  console.error(`✋ no built family pages at ${path.relative(REPO, OUT)} — run 'npm run build' first.`);
  process.exit(1);
}

const aliases = JSON.parse(fs.readFileSync(ALIASES, 'utf8'));
const entries = Object.entries(aliases).filter(([k]) => k !== '_comment');

let written = 0;
let skipped = [];
for (const [oldSlug, target] of entries) {
  const targetDir = path.join(OUT, target);
  if (!fs.existsSync(path.join(targetDir, 'index.html'))) {
    skipped.push({ oldSlug, target, why: 'target family page not built' });
    continue;
  }
  const dest = `${SITE}/people/families/${encodeURI(target)}/`;
  const label = target.charAt(0).toUpperCase() + target.slice(1);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Redirecting to the ${label} family</title>
  <meta http-equiv="refresh" content="0;url=${dest}">
  <link rel="canonical" href="${dest}">
  <meta name="robots" content="noindex">
</head>
<body>
  <p>Redirecting to <a href="${dest}">the ${label} family</a>...</p>
</body>
</html>
<script>location.replace('${dest}');</script>
`;
  const dir = path.join(OUT, oldSlug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  written++;
}

if (skipped.length) {
  console.error(`\n✋ ${skipped.length} family alias(es) could not be emitted:`);
  for (const s of skipped) console.error(`   /people/families/${s.oldSlug}/ -> ${s.target}  (${s.why})`);
  process.exit(1);
}

console.log(`✅ family-slug-redirects: wrote ${written}/${entries.length} redirect stub(s) for old dirty surname URLs.`);
