#!/usr/bin/env node
/**
 * stamp-build.mjs
 * -----------------
 * Post-build deployment guard: embeds a unique BUILD_ID (git SHA + UTC timestamp)
 * into every generated HTML file in dist/ so the deploy smoke-test can verify the
 * live site is actually serving the freshly-built artifact.
 *
 * Root-cause context: this site's deploy "succeeded" in CI for months while GitHub
 * Pages kept serving a stale gh-pages branch — the workflow published an artifact
 * that Pages ignored. Nothing compared what users actually got against what was
 * built, so it failed silently. This stamp + the smoke-test job close that gap:
 * if the live site doesn't show this BUILD_ID, the deploy did NOT publish and the
 * workflow fails loudly.
 *
 * Inject a data attribute into <html> so it survives HTML minification and is
 * greppable from a plain curl.
 */
import { readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const DIST = 'dist';

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Best-effort short git SHA without depending on git (checkout may be shallow).
let sha = 'no-git';
try {
  sha = execSync('git rev-parse --short=8 HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* no git in this env — fine, timestamp still unique */
}

const files = walk(DIST);

// ── IDEMPOTENCE (fixed 2026-09-18) ────────────────────────────────────────────
// This script must be safe to run more than once against the same dist/.
// Previously it minted a FRESH `${sha}-${Date.now()}` every invocation, while the
// HTML merge below deliberately keeps an ALREADY-PRESENT data-build-id (the
// `attrs.includes('data-build-id') ? m : ...` branch). A second run therefore
// wrote a new id into dist/.build-id while the HTML kept the FIRST one — the
// manifest and the artifact disagreed, and the CI guard (which reads
// dist/.build-id) went on to assert an id no page carried.
//
// PROVEN ROOT CAUSE of red run #35225365913 (2026-09-17) — local repro:
//   node stamp-build.mjs  -> page=no-git-…652115  .build-id=no-git-…652115
//   node stamp-build.mjs  -> page=no-git-…652115  .build-id=no-git-…653272  <-- DIVERGED
//
// Fix: if dist/ already carries a stamp, REUSE it rather than minting a new one,
// so dist/.build-id and every page's data-build-id can never diverge.
let existing = null;
try {
  existing = readFileSync(join(DIST, '.build-id'), 'utf8').trim();
} catch {
  /* first run — no manifest yet */
}

if (existing && files.length > 0) {
  const probe = readFileSync(files[0], 'utf8');
  const m = probe.match(/data-build-id="([^"]+)"/);
  if (m && m[1] === existing) {
    console.log(`[stamp-build] BUILD_ID=${existing} already stamped (idempotent re-run, ${files.length} HTML file(s)) — no change`);
    process.exit(0);
  }
  // Manifest stale relative to the pages: fall through and re-stamp everything
  // consistently with ONE new id so the two can still never disagree.
  console.log(`[stamp-build] dist/.build-id (${existing}) disagrees with pages — re-stamping consistently`);
}

const buildId = `${sha}-${Date.now()}`;
let stamped = 0;

for (const f of files) {
  const html = readFileSync(f, 'utf8');
  const stampedHtml = html.includes('<html')
    ? html.replace(/<html([^>]*)>/, (m, attrs) =>
        attrs.includes('data-build-id') ? m : `<html${attrs} data-build-id="${buildId}">`)
    : html.replace(/<!doctype html[^>]*>\s*/i, (m) => `${m}<html data-build-id="${buildId}">`);
  writeFileSync(f, stampedHtml);
  stamped++;
}

console.log(`[stamp-build] BUILD_ID=${buildId} stamped onto ${stamped} HTML file(s)`);
writeFileSync(join(DIST, '.build-id'), buildId);

// ── DATA-HASH MARKER (added 2026-09-22, card tw-2026-09-22-010) ───────────────
// Records WHICH people.public.json this dist/ was built from, so a downstream
// guard can tell a fresh build from a stale one. mtime is NOT usable for that:
// regenerate-data.sh rewrites people.public.json immediately before the gates
// run, so the data file is always newer than any existing dist/ and an
// mtime-based check skips FOREVER (measured 2026-09-22 — a permanently skipped
// gate is a silent hole, worse than the bug it was meant to fix).
// A content hash is stable across rewrites and answers the real question:
// "was this dist/ built from the data that is on disk right now?"
import { createHash } from 'node:crypto';
const PUB = 'src/data/people.public.json';
try {
  const h = createHash('sha256').update(readFileSync(PUB)).digest('hex').slice(0, 16);
  writeFileSync(join(DIST, '.data-hash'), h);
  console.log(`[stamp-build] dist/.data-hash=${h} (people.public.json)`);
} catch {
  console.log('[stamp-build] WARN — could not hash people.public.json; stale-dist guard will not run');
}
