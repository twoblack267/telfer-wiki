#!/usr/bin/env node
/**
 * Guard: every URL advertised in dist/llms.txt must resolve to a page that the
 * build actually emitted, at the canonical (trailing-slash) form.
 *
 * WHY THIS EXISTS — card itc-20261102-2 (2026-11-02):
 *   llms.txt is HAND-MAINTAINED (public/llms.txt). It advertised nine "Key pages"
 *   as extensionless URLs (/people, /timeline, /about, /people/dna, ...) while
 *   every one of them answers 301 -> trailing-slash, and the sitemap plus every
 *   canonical tag emit the trailing-slash form. So the one file written for
 *   machine consumption was handing every crawler a pointless redirect hop on
 *   every link, and contradicting the site's own canonical form.
 *
 *   A hand-maintained file with no consumer that fails when it rots WILL rot.
 *   This is that consumer. It checks the BUILT file, so it runs in postbuild
 *   after the astro build has written dist/.
 *
 * WHAT IT CHECKS (mechanical, offline — no network):
 *   1. Every absolute telferwiki.com URL in dist/llms.txt ends in "/" (or is the
 *      bare site root), i.e. is the canonical form the sitemap and canonicals use.
 *   2. Every such URL corresponds to a real emitted file in dist/ (dist/<path>/index.html
 *      or dist/<path>), so llms.txt cannot advertise a dead path.
 *
 * Deliberately NOT checked: whether a page is noindex. /people/full-tree/ and
 * /tree/ are noindex-by-owner-ruling and are still legitimately linked for
 * humans; llms.txt states that explicitly.
 *
 * Fix the SOURCE (public/llms.txt), never the built copy.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const LLMS = join(DIST, 'llms.txt');

if (!existsSync(LLMS)) {
  console.error(`❌ llms.txt guard: missing ${LLMS} — was the build run?`);
  process.exit(1);
}

const text = readFileSync(LLMS, 'utf8');
// Only real absolute URLs. The old pattern also scooped up backtick-quoted
// inline paths like `/people/full-tree/` followed by prose, which mangled into
// a phantom URL. Anchored to a scheme + host; stops at whitespace, quotes,
// brackets, backticks, and markdown emphasis.
const urls = [...new Set(
  (text.match(/https:\/\/telferwiki\.com(?:[/?#][^\s)\]<>"'`*_]*)?/g) ?? [])
)].filter((u) => !u.endsWith('.xml')); // sitemap index is served but has no index.html

const problems = [];

for (const url of urls) {
  const path = url.replace('https://telferwiki.com', '');
  const clean = path.split('#')[0].split('?')[0];

  // (1) canonical form: must be root or end in "/"
  if (clean !== '/' && !clean.endsWith('/')) {
    problems.push(`non-canonical (301) form: ${url}  ->  should be ${url}/`);
    continue;
  }

  // (2) must exist in the build output
  const rel = clean.replace(/^\/|\/$/g, '');
  const candidates = rel === ''
    ? [join(DIST, 'index.html')]
    : [join(DIST, rel, 'index.html'), join(DIST, rel), join(DIST, `${rel}.html`)];
  if (!candidates.some((c) => existsSync(c) && statSync(c).isFile())) {
    problems.push(`dead path: ${url}  (no dist/${rel}/index.html)`);
  }
}

if (problems.length) {
  console.error(`❌ llms.txt URL guard: ${problems.length} problem(s) in dist/llms.txt`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error('\nFix public/llms.txt (the source), then rebuild. Never edit dist/llms.txt.');
  process.exit(1);
}

console.log(`✅ llms.txt URL guard: ${urls.length} advertised URL(s), all canonical and all present in the build.`);
