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

const buildId = `${sha}-${Date.now()}`;
const files = walk(DIST);
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
