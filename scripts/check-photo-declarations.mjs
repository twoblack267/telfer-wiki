#!/usr/bin/env node
/**
 * Photo declaration check — runs inside the build.
 *
 * WHY THIS EXISTS
 *   Mark, 2026-11-08: "How can we make it happen all people's profiles with
 *   photos are on Google constantly like the process so I don't have to remind
 *   you to do it when I upload photos." A declaration that nobody checks is a
 *   promise, not a pipeline. This is the check.
 *
 * WHAT IT ASSERTS
 *   Every person record with a `person_photo`, whose page is not noindexed,
 *   must have BOTH an `image` in its JSON-LD `Person` object AND an
 *   `<image:image>` entry in the sitemap. Counts must match exactly. No
 *   exceptions, no "close enough" — a mismatch means a photo he uploaded is
 *   invisible to Google or visible when he asked for it not to be.
 *
 * WHEN IT FAILS
 *   Exit 1 (the build goes red and the deploy stops) AND, if the failure card
 *   bridge is present, one line pushed to Mark's chat. Two deliveries on
 *   purpose: the exit code is for the machine and the record, the card is for
 *   his eyes. Silence is not a report.
 *
 *   The card is fire-and-forget. A notification that cannot be delivered must
 *   never change the exit code — the check failing is the fact, the messenger
 *   failing is a separate problem, and the build must not go green because the
 *   phone was offline.
 *
 * EXIT CODES
 *   0 — counts agree, every expected page declares.
 *   1 — a real mismatch. Details on stdout.
 *
 * USAGE
 *   node scripts/check-photo-declarations.mjs [--dist dist] [--data src/data/people.public.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const DIST = path.resolve(ROOT, argOf('dist', 'dist'));
const DATA = path.resolve(ROOT, argOf('data', 'src/data/people.public.json'));

const fail = [];
const note = (s) => console.log(`   ${s}`);

// ── 1. What SHOULD be declared ───────────────────────────────────────────────
let people;
try {
  const raw = JSON.parse(fs.readFileSync(DATA, 'utf-8'));
  people = Array.isArray(raw) ? raw : raw.people || [];
} catch (e) {
  fail.push(`cannot read ${path.relative(ROOT, DATA)}: ${e.message}`);
  people = [];
}

// Mirror the build's own exclusions. NOINDEX is the only one: the archive tells
// Google to ignore those pages, so declaring an image on one is a contradiction.
let noindex = new Set();
try {
  const mod = await import(path.join(ROOT, 'src/data/privacy-exclusions.mjs')).catch(() => null);
  const list = mod?.NOINDEX_SLUGS;
  if (list) noindex = new Set(list);
} catch { /* absence is not a failure here; the page-level check below still runs */ }

const expected = people.filter((p) => p?.slug && p.person_photo && !noindex.has(p.slug));
const expectedSlugs = new Set(expected.map((p) => p.slug));

// ── 2. What IS declared, in the sitemap ──────────────────────────────────────
let sitemapImages = 0;
const sitemapUrlsWithImage = new Set();
{
  const dir = DIST;
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^sitemap-\d+\.xml$/.test(f) || f === 'sitemap-0.xml')
    : [];
  if (!files.length) fail.push(`no sitemap found in ${path.relative(ROOT, DIST)} — did the build run?`);
  for (const f of files) {
    const xml = fs.readFileSync(path.join(dir, f), 'utf-8');
    sitemapImages += (xml.match(/<image:image>/g) || []).length;
    // Per-URL, so we can name which pages declare.
    for (const block of xml.split('<url>').slice(1)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/);
      if (!loc || !block.includes('<image:image>')) continue;
      const slug = (loc[1].match(/\/people\/([^/]+)\//) || [])[1];
      if (slug) sitemapUrlsWithImage.add(slug);
    }
  }
}

// ── 3. What is declared in the page's JSON-LD ────────────────────────────────
const jsonLdWithImage = new Set();
for (const slug of expectedSlugs) {
  const pagePath = path.join(DIST, 'people', slug, 'index.html');
  if (!fs.existsSync(pagePath)) {
    fail.push(`page missing from build: /people/${slug}/`);
    continue;
  }
  const html = fs.readFileSync(pagePath, 'utf-8');
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(m[1]);
      const nodes = Array.isArray(data) ? data : data['@graph'] || [data];
      for (const n of nodes) {
        if (n?.['@type'] === 'Person' && n.image) jsonLdWithImage.add(slug);
      }
    } catch { /* a malformed block is caught by the schema gate, not here */ }
  }
  if (!jsonLdWithImage.has(slug)) {
    fail.push(`/people/${slug}/ has a person_photo but NO "image" in its Person JSON-LD`);
  }
}

// ── 4. Cross-checks ──────────────────────────────────────────────────────────
const missingFromSitemap = [...expectedSlugs].filter((s) => !sitemapUrlsWithImage.has(s));
if (missingFromSitemap.length) {
  fail.push(
    `${missingFromSitemap.length} photo page(s) absent from the sitemap: ` +
      missingFromSitemap.map((s) => `/people/${s}/`).join(', ')
  );
}
const extraInSitemap = [...sitemapUrlsWithImage].filter((s) => !expectedSlugs.has(s));
if (extraInSitemap.length) {
  fail.push(
    `${extraInSitemap.length} sitemap image entr(ies) for pages that should NOT declare: ` +
      extraInSitemap.map((s) => `/people/${s}/`).join(', ')
  );
}
if (sitemapImages !== expected.length) {
  fail.push(`sitemap <image:image> count ${sitemapImages} != expected ${expected.length}`);
}

// ── 5. Report ────────────────────────────────────────────────────────────────
const report = {
  at: new Date().toISOString(),
  expected: expected.length,
  sitemapImages,
  jsonLdWithImage: jsonLdWithImage.size,
  ok: fail.length === 0,
  failures: fail,
};

console.log('🔎 photo declaration check');
note(`expected (person_photo, not noindexed): ${expected.length}`);
note(`sitemap <image:image>: ${sitemapImages}`);
note(`Person JSON-LD with image: ${jsonLdWithImage.size}`);

// Keep a file record every run — pass or fail. Chat is for his eyes, the file
// is for the post-mortem, and a passing run must still leave a trace.
try {
  const logDir = path.resolve(ROOT, '.photo-check');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(
    path.join(logDir, 'declarations.log'),
    `${report.at} ${report.ok ? 'OK' : 'FAIL'} expected=${report.expected} sitemap=${report.sitemapImages} jsonld=${report.jsonLdWithImage}${
      report.ok ? '' : ' :: ' + report.failures.join(' | ')
    }\n`
  );
} catch { /* a log we cannot write must not hide a real failure */ }

if (report.ok) {
  console.log('✅ Photo declarations OK — every owner-supplied photo is declared, and nothing else is.');
  process.exit(0);
}

console.error('\n❌ PHOTO DECLARATIONS BROKEN');
for (const f of fail) console.error(`   • ${f}`);
console.error('');

// ── 6. Failure card (fire-and-forget, never changes the exit code) ───────────
const cardUrl = process.env.PHOTO_FAIL_CARD_URL;
if (cardUrl) {
  const body = [
    `⚠ Photo declarations broken (${fail.length} problem${fail.length === 1 ? '' : 's'})`,
    `expected ${expected.length} · sitemap ${sitemapImages} · JSON-LD ${jsonLdWithImage.size}`,
    fail[0].slice(0, 300),
  ].join('\n');
  fetch(cardUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    signal: AbortSignal.timeout(8000),
  }).catch(() => { /* messenger failure is not a build failure */ });
}

process.exit(1);
