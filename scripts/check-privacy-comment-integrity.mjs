#!/usr/bin/env node
/**
 * check-privacy-comment-integrity.mjs
 *
 * STANDING GATE — card tw-2026-10-20-001.
 *
 * The rule: a page must never *say* it is excluded from search engines unless it
 * actually carries the exclusion. On 2026-10-20 /tree/ shipped an inline HTML
 * comment claiming "keep this page out of search engine indexes (living persons)"
 * while the rendered head carried no robots meta at all — and /tree/ was listed in
 * the sitemap, actively inviting the crawlers the comment said were fenced out.
 *
 * Root cause: BaseLayout.astro emitted the privacy COMMENT unconditionally while
 * only the <meta name="robots"> was gated on the `noindex` prop. Any page that did
 * not opt in still advertised the intent. The comment is now emitted inside the
 * same conditional as the tag, and this gate proves it from BUILD OUTPUT rather
 * than from source — a source-only check would have passed on the broken build.
 *
 * Scope note: /people/full-tree/ deliberately exposes only deceased people and is
 * indexed on purpose. /tree/ is indexed on purpose too (it is a navigation page).
 * This gate does not fence either of them — it only forbids the lie.
 *
 * Usage: node scripts/check-privacy-comment-integrity.mjs [--dir dist]
 * Exit:  0 = every privacy claim is backed by a robots tag
 *        1 = a document claims exclusion it does not carry
 *        2 = harness could not find enough pages to be meaningful
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PRIVACY_CLAIM = /keep this page out of search engine indexes|this page IS excluded from search engine indexes/i;
const ROBOTS_META = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i;

const argDir = process.argv.indexOf("--dir");
const ROOT = argDir !== -1 ? process.argv[argDir + 1] : "dist";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(ROOT);
} catch (e) {
  console.error(`❌ privacy-comment-integrity: cannot read ${ROOT} — build first (${e.message})`);
  process.exit(2);
}

const offenders = [];
const claims = [];
for (const f of files) {
  const html = readFileSync(f, "utf8");
  if (!PRIVACY_CLAIM.test(html)) continue;
  const rel = relative(ROOT, f);
  claims.push(rel);
  if (!ROBOTS_META.test(html)) offenders.push(rel);
}

// A gate that scanned almost nothing is not evidence of health.
const MIN_EXPECTED_PAGES = 50;
if (files.length < MIN_EXPECTED_PAGES) {
  console.error(
    `❌ privacy-comment-integrity: only ${files.length} HTML files under ${ROOT} ` +
    `(expected >= ${MIN_EXPECTED_PAGES}). This is not a clean result, it is a blind gate.`
  );
  process.exit(2);
}

if (offenders.length) {
  console.error("❌ privacy-comment-integrity: page(s) CLAIM search exclusion but carry no robots noindex:");
  for (const o of offenders.slice(0, 40)) console.error(`   • ${o}`);
  if (offenders.length > 40) console.error(`   … and ${offenders.length - 40} more`);
  console.error(
    "\n   A privacy comment must never be emitted unconditionally — gate it on the same\n" +
    "   condition as the <meta name=\"robots\" content=\"noindex, nofollow\"> tag.\n" +
    "   Card tw-2026-10-20-001."
  );
  process.exit(1);
}

console.log(
  `✅ privacy-comment-integrity: ${files.length} pages scanned, ` +
  `${claims.length} privacy claim(s), all backed by robots noindex.`
);
