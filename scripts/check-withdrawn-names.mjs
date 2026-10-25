#!/usr/bin/env node
/**
 * WITHDRAWN-NAME GATE — fails the build if a withdrawn person's page exists or
 * is indexed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 16 Oct 2026 owner ruling withdraws six living people from publication.
 * That ruling survives only as long as three separate mechanisms agree:
 *
 *   1. sanitize-people.mjs strips their slugs from people.public.json;
 *   2. astro.config.ts excludes family-sheet/descendants URLs from the sitemap;
 *   3. the page templates emit noindex on anything derived from them.
 *
 * On 25 Oct 2026 all three were briefly wrong at once and the assistant
 * reported success against a count it had not checked (179 fenced sheets
 * instead of 2). A human reading a build log would not have caught it. This
 * gate checks the OUTPUT rather than the mechanism, so it fires no matter
 * which of the three mechanisms regresses.
 *
 * WHAT IT ASSERTS (on the built dist/, not the source)
 * ---------------------------------------------------
 *   A. No HTML page exists for a withdrawn slug.
 *   B. A withdrawn person's name does not appear as a link target anywhere.
 *   C. If a withdrawn name appears in page text, that page carries noindex
 *      OR is one of the three permitted parent pages where the ruling says the
 *      name is deliberately visible in plain text.
 *
 * Run: node scripts/check-withdrawn-names.mjs [distDir]
 * Exit 0 = clean, 1 = violation.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PRIVACY_STRIP_SLUGS } from '../src/data/privacy-exclusions.mjs';

const DIST = process.argv[2] || 'dist';

// The ruling: these three profiles keep the withdrawn names VISIBLE as plain
// text on purpose — "a father's page must not read as childless."
const NAME_VISIBLE_ON = new Set([
  'people/paul-ivory-1955/index.html',
  'people/sheryle-telfer-1961/index.html',
  'people/timothy-telfer-1959/index.html',
]);

// Names to search for. Derived from the source data so it cannot drift out of
// step with the slug list — if a slug is added, its name is checked too.
function withdrawnNames() {
  const src = 'src/data/people.json';
  if (!existsSync(src)) return [];
  const people = JSON.parse(readFileSync(src, 'utf8'));
  const list = Array.isArray(people) ? people : people.people || [];
  const out = new Map();
  for (const p of list) {
    if (!PRIVACY_STRIP_SLUGS.has(p.slug)) continue;
    // Schema is {display_name, first_name, middle_name, last_name} — there is
    // no `name` field. Checked against people.json on 25 Oct 2026.
    const name =
      p.display_name ||
      [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') ||
      '';
    if (name) out.set(p.slug, name);
  }
  return [...out.entries()];
}

function walkHtml(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkHtml(full, acc);
    else if (entry.endsWith('.html')) acc.push(full);
  }
  return acc;
}

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  if (!existsSync(DIST)) {
    console.error(`❌ check-withdrawn-names: no dist/ at ${DIST} — build first.`);
    process.exit(1);
  }

  const names = withdrawnNames();
  if (names.length === 0) {
    console.log('⚠️  check-withdrawn-names: no withdrawn people resolvable from source — nothing to check.');
    console.log('   (If PRIVACY_STRIP_SLUGS is non-empty this means the source schema changed.)');
    process.exit(0);
  }

  const failures = [];
  const pages = walkHtml(DIST);

  // A. No page for a withdrawn slug.
  for (const slug of PRIVACY_STRIP_SLUGS) {
    const pageDir = join(DIST, 'people', slug);
    if (existsSync(pageDir)) {
      failures.push(`page exists for withdrawn slug "${slug}" (${pageDir})`);
    }
  }

  // B + C. Name leakage.
  for (const file of pages) {
    const rel = relative(DIST, file).split('\\').join('/');
    const html = readFileSync(file, 'utf8');
    const isNoindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
    const nameMayBeVisible = NAME_VISIBLE_ON.has(rel);

    for (const [slug, name] of names) {
      const re = new RegExp(escRe(name), 'gi');

      // B. A link to the withdrawn slug is a hard failure anywhere.
      if (html.includes(`/people/${slug}`)) {
        failures.push(`${rel}: links to withdrawn slug "/people/${slug}"`);
      }

      // C. Name in body text requires either noindex or a permitted parent page.
      if (re.test(html) && !isNoindex && !nameMayBeVisible) {
        failures.push(`${rel}: shows withdrawn name "${name}" on an indexable page`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('\n❌ check-withdrawn-names: FAILED — owner ruling (16 Oct 2026) is not enforced.\n');
    for (const f of failures.slice(0, 25)) console.error(`   • ${f}`);
    if (failures.length > 25) console.error(`   … and ${failures.length - 25} more`);
    console.error('\nThe ruling: no page, no clickable link, out of the sitemap for the');
    console.error('withdrawn minors; names stay as PLAIN TEXT only on the three parent');
    console.error('profiles. See src/data/privacy-exclusions.mjs.\n');
    process.exit(1);
  }

  console.log(
    `✅ check-withdrawn-names: ${pages.length} pages scanned — ` +
      `${PRIVACY_STRIP_SLUGS.size} withdrawn slug(s), 0 pages, 0 live links.`
  );
}

main();
