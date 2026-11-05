#!/usr/bin/env node
/**
 * verify-schema-freshness.mjs — the PERMANENCE gate.
 *
 * WHY THIS EXISTS
 * Adding dateModified + author to a template is a one-day win. A gate is forever.
 * Without this, a refactor, a merge, a well-meaning "cleanup" six months from now
 * silently drops the field and nobody notices for a year — because the site still
 * looks perfect to a human. Only a machine notices the machine block went quiet.
 *
 * THE CONTRACT (three assertions per person page):
 *   1. every /people/<slug>/ page emits dateModified
 *   2. dateModified is a valid ISO-8601 timestamp (schema.org rejects junk)
 *   3. dateModified EQUALS the same page's <lastmod> in the sitemap
 *      — footer, sitemap and JSON-LD must never disagree about freshness.
 *      Three sources, one date. If they drift, the gate names the page.
 *
 * Also asserts every page has `author` with a name — attribution cannot quietly
 * vanish either.
 *
 * FAIL-CLOSED: exits 1 and prints the offenders. A silent pass is a lie.
 */
import fs from "node:fs";
import path from "node:path";

const DIST = path.join(process.cwd(), "dist");
const SITEMAP_DIR = DIST;
const MIN_EXPECTED = 600; // below this, the build is broken — not "all clean"

const fail = [];
const notes = [];

function readJsonLd(html) {
  const m = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    let v = JSON.parse(m[1]);
    if (Array.isArray(v)) v = v.find((x) => x && x["@type"] === "Person") || v[0];
    return v;
  } catch {
    return null;
  }
}

// ── 1. gather sitemap lastmod map ────────────────────────────
// Same trap that already bit seo-index-watch: the site ships MORE THAN ONE
// sitemap file. Reading only sitemap-0.xml silently misses half the site and
// the gate would "pass" on a fraction. Enumerate every sitemap chunk.
const lastmodMap = new Map();
const sitemapFiles = fs
  .readdirSync(SITEMAP_DIR)
  .filter((f) => /^sitemap-\d+\.xml$/.test(f));
if (!sitemapFiles.length) fail.push("GATE: no sitemap-N.xml files found in dist/");
for (const f of sitemapFiles) {
  const xml = fs.readFileSync(path.join(SITEMAP_DIR, f), "utf-8");
  const re = /<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<lastmod>([^<]+)<\/lastmod>[\s\S]*?<\/url>/g;
  let m;
  while ((m = re.exec(xml))) lastmodMap.set(m[1].trim(), m[2].trim());
}
notes.push(`sitemaps read: ${sitemapFiles.length} · <lastmod> entries: ${lastmodMap.size}`);

// ── 2. walk person pages ─────────────────────────────────────
const peopleRoot = path.join(DIST, "people");
const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name === "index.html") pages.push(full);
  }
})(peopleRoot);

let checked = 0;
let withDate = 0;
let skippedNoindex = 0;
let skippedNonPerson = 0;

for (const file of pages) {
  const rel = "/" + path.relative(DIST, file).replace(/index\.html$/, "");
  // Only real person profiles: /people/<slug>/ — one level deep.
  if (!/^\/people\/[^/]+\/$/.test(rel)) continue;
  if (rel === "/people/families/") continue;

  const html = fs.readFileSync(file, "utf-8");
  // noindexed pages (privacy, living people) deliberately carry NO schema.
  if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) {
    skippedNoindex++;
    continue;
  }
  // DISAMBIGUATION PAGES are not person profiles. They exist to ask "which
  // Adam Telfer?" and link onward; they carry no Person entity, no birthDate,
  // no relatives — so demanding dateModified from them would be demanding a
  // lie about a person who has not been identified yet. Identified by title
  // shape + the .disambig container the page renders. /people/dna/ is a tool
  // page, same reasoning: not a person, so excluded by the same rule.
  // ASSERT THE SHAPE, not a hardcoded slug list: a new person added tomorrow
  // must be gated, and a hardcoded exemption list is how gates rot.
  const isDisambig =
    /class=["'][^"']*\bdisambig\b/.test(html) ||
    /—\s*which one\?/.test(html) ||
    rel === "/people/dna/";
  if (isDisambig) {
    skippedNonPerson++;
    continue;
  }

  checked++;
  const ld = readJsonLd(html);
  if (!ld) {
    fail.push(`NO JSON-LD: ${rel}`);
    continue;
  }
  if (!ld.dateModified) {
    fail.push(`NO dateModified: ${rel}`);
    continue;
  }
  const d = new Date(ld.dateModified);
  if (Number.isNaN(d.getTime())) {
    fail.push(`INVALID dateModified (${ld.dateModified}): ${rel}`);
    continue;
  }
  withDate++;

  // Attribution: the archive is the CREATOR (an Organization, not a person).
  // Mark rejected a personal author byline — he did not write these pages, and
  // a byline claiming he did was both untrue and self-congratulatory. Browser
  // Check any personal `author` here: it means the construct has crept back.
  if (!ld.creator || !ld.creator.name) {
    fail.push(`NO creator.name: ${rel}`);
  }
  if (ld.author) {
    fail.push(`personal 'author' byline present: ${rel} — the archive publishes, a human reviews`);
  }

  // Cross-check against the sitemap. Both are derived from lastmod.json, so a
  // mismatch means the two paths through the build have diverged — which is
  // exactly the class of bug that silently tells Google the wrong thing.
  const siteUrl = `https://telferwiki.com${rel}`;
  const smLast = lastmodMap.get(siteUrl);
  if (!smLast) {
    fail.push(`MISSING from sitemap (so Google has no lastmod): ${rel}`);
  } else if (new Date(smLast).getTime() !== d.getTime()) {
    fail.push(`DATE DRIFT — jsonld ${d.toISOString()} vs sitemap ${smLast}: ${rel}`);
  }
}

// ── 3. coverage sanity ───────────────────────────────────────
if (checked < MIN_EXPECTED) {
  fail.push(
    `COVERAGE COLLAPSE: only ${checked} person pages checked, expected >= ${MIN_EXPECTED}. ` +
      `A gate that checks nothing passes everything.`
  );
}

// ── SIGNATURE INTEGRITY (added 2026-11-05) ────────────────────
// reviewedBy is the only human claim on the page, so it gets the strictest
// check: every signature in the ledger must appear on its page, with a real
// reviewer name and a date that is not in the future. A signature that is
// silently dropped is worse than one never made — it means the page LOOKS
// unattended while the vault says a human reviewed it.
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  let ledger = {};
  try {
    ledger = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "src/data/signoff.json"), "utf-8")
    );
  } catch {
    ledger = {};
  }

  const signedSlugs = Object.keys(ledger);
  let ok = 0;
  const SELF = [/^mark\s*telfer$/i, /^skippy/i, /\bai\b/i, /\bbot\b/i, /language model/i, /^hermes/i];

  for (const slug of signedSlugs) {
    const rec = ledger[slug] || {};
    // The compiler naming himself is not a review, it is a self-award. It must
    // never reach a page — and if it is sitting in the ledger, that is a fault
    // worth failing on rather than quietly skipping.
    if (SELF.some((re) => re.test(rec.reviewed_by || ""))) {
      fail.push(
        `SELF-SIGNATURE in signoff.json: ${slug} reviewed_by "${rec.reviewed_by}" — the compiler cannot certify their own work`
      );
      continue;
    }
    const file = path.join(process.cwd(), "dist/people", slug, "index.html");

    if (!rec.reviewed_by || !rec.reviewed_on) {
      fail.push(`signoff.json: ${slug} has an incomplete record`);
      continue;
    }
    const when = Date.parse(rec.reviewed_on);
    if (Number.isNaN(when)) {
      fail.push(`signoff.json: ${slug} reviewed_on "${rec.reviewed_on}" is not a date`);
      continue;
    }
    if (when > Date.now()) {
      fail.push(`signoff.json: ${slug} reviewed_on ${rec.reviewed_on} is IN THE FUTURE`);
      continue;
    }
    if (!fs.existsSync(file)) {
      fail.push(`signature for a page that does not exist: /people/${slug}/`);
      continue;
    }

    const html = fs.readFileSync(file, "utf-8");
    if (!html.includes('"reviewedBy"')) {
      fail.push(`signed but emits no reviewedBy: /people/${slug}/`);
      continue;
    }
    if (!html.includes(rec.reviewed_by)) {
      fail.push(`reviewedBy present but reviewer name missing: /people/${slug}/`);
      continue;
    }

    // The byline claim Mark rejected must never come back.
    const ld = html.match(/application\/ld\+json">([\s\S]*?)<\/script>/);
    if (ld) {
      try {
        const parsed = JSON.parse(ld[1]);
        const obj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (obj && obj.author) {
          fail.push(
            `personal 'author' byline is back on /people/${slug}/ — the archive publishes, a human reviews`
          );
        }
      } catch {
        /* JSON validity is checked elsewhere; do not double-report */
      }
    }
    ok++;
  }

  console.log(
    `   ✍️  signatures: ${ok}/${signedSlugs.length} verified on their page` +
      (signedSlugs.length === 0 ? " (none claimed — honest)" : "")
  );
}

// ── report ───────────────────────────────────────────────────
console.log("🔎 schema-freshness gate");
for (const n of notes) console.log(`   ℹ️  ${n}`);
console.log(
  `   📄 person profiles checked: ${checked} · with dateModified: ${withDate}`
);
console.log(
  `   ⏭️  skipped: ${skippedNoindex} noindex (privacy) · ${skippedNonPerson} not-a-person (disambiguation/tool pages)`
);

if (fail.length) {
  console.log(`\n❌ SCHEMA FRESHNESS FAILED — ${fail.length} problem(s):`);
  for (const f of fail.slice(0, 40)) console.log(`   • ${f}`);
  if (fail.length > 40) console.log(`   … and ${fail.length - 40} more`);
  process.exit(1);
}

console.log("✅ Schema freshness OK — every person page dates itself, and agrees with the sitemap.");
