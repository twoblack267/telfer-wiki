#!/usr/bin/env node
/**
 * scan-404.mjs
 *
 * Checks the live telferwiki.com for broken pages.
 * Crawls all profile slugs + known routes and reports 404s.
 *
 * Usage: node scripts/scan-404.mjs
 *   Exit 0 = all clear, Exit 1 = 404s found
 */

import fs from 'fs';
import path from 'path';

const BASE = 'https://telferwiki.com';

const KNOWN_ROUTES = [
  '/',
  '/search/',
  '/timeline/',
];

async function checkUrl(url, label) {
  try {
    const resp = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (resp.status === 404) {
      console.log(`🔴 ${resp.status}  ${label}  ${url}`);
      return false;
    }
    if (resp.status >= 400) {
      console.log(`🟡 ${resp.status}  ${label}  ${url}`);
      return null; // soft fail
    }
    return true;
  } catch (err) {
    console.log(`⚪ ERROR  ${label}  ${url}  (${err.message})`);
    return null;
  }
}

async function main() {
  const peopleJsonPath = path.resolve(import.meta.dirname, '../src/data/people.json');
  const peopleJson = JSON.parse(fs.readFileSync(peopleJsonPath, 'utf-8'));

  const slugs = [...new Set(peopleJson.map(p => p.slug).filter(Boolean))];
  console.log(`🔍 Scanning ${slugs.length} profile slugs + ${KNOWN_ROUTES.length} routes on ${BASE}`);
  console.log('');

  let checks = 0;
  let failures = 0;
  let errors = 0;

  // Check known routes
  for (const route of KNOWN_ROUTES) {
    const url = `${BASE}${route}`;
    const ok = await checkUrl(url, route);
    checks++;
    if (ok === false) failures++;
    else if (ok === null) errors++;
  }

  // Check profile pages
  for (const slug of slugs) {
    const url = `${BASE}/people/${slug}/`;
    const ok = await checkUrl(url, slug);
    checks++;
    if (ok === false) failures++;
    else if (ok === null) errors++;

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 100));
  }

  // Check redirect pages (old year-suffixed slugs that should redirect)
  const redirectTargets = slugs.filter(s => /\d{4}$/.test(s));
  for (const slug of redirectTargets) {
    const url = `${BASE}/people/${slug}/`;
    const ok = await checkUrl(url, `${slug} (redirect check)`);
    checks++;
    if (ok === false) failures++;
    else if (ok === null) errors++;
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(`📊 Live Site 404 Report`);
  console.log('═══════════════════════════════════════');
  console.log(`   Checked: ${checks} URLs`);
  console.log(`   Failures: ${failures}`);
  console.log(`   Errors: ${errors}`);

  if (failures === 0 && errors === 0) {
    console.log(`\n✅ All live URLs resolving. No broken pages.`);
    process.exit(0);
  } else if (failures > 0) {
    console.log(`\n🔴 ${failures} 404(s) found on live site — investigate!`);
    process.exit(1);
  } else {
    console.log(`\n🟡 ${errors} transient error(s) — may be network, retry manually.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
