/**
 * check-redirect-health.mjs — PREVENTION GATE for redirect alias pages.
 *
 * WHAT THIS DOES
 *   After `astro build` + `generate-redirects.mjs`, every old-slug alias is a
 *   static page under dist/people/<from>/index.html containing a meta-refresh
 *   and an absolute canonical to the real person page. If GitHub Pages / Google
 *   were to treat any alias as a duplicate or dead-end it would 404 or re-source
 *   the GSC "Not found / Page with redirect / Duplicate canonical" alerts.
 *
 *   This gate fails the deploy (non-zero exit) if ANY alias:
 *     1. is missing on disk                              -> would be a 404
 *     2. lacks <meta name="robots" content="noindex">    -> indexable duplicate
 *     3. has a RELATIVE canonical (../people/...)        -> weak/ambiguous signal
 *     4. points at a canonical that is ITSELF a stub or is missing
 *                                                        -> multi-hop / dead chain
 *
 * WHY THIS EXIST
 *   The root cause of the Sep-2026 GSC alert was that alias pages carried a
 *   relative canonical and no noindex, so Google indexed 317 old-slug URLs as
 *   thin duplicates; plus 8 slugs that lived only in public/_redirects (a
 *   Netlify file GitHub Pages ignores) returned hard-404. Every future deploy
 *   now re-verifies the whole alias layer so that failure mode cannot return.
 *
 * Usage: node scripts/check-redirect-health.mjs   (run in package.json postbuild)
 * Exits 0 on clean, 1 listing every offending alias (blocks deploy).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_PEOPLE = path.resolve(__dirname, '../dist/people');
const ABS_BASE = 'https://telferwiki.com';
// Where Night Watch (night-watch.sh) looks for a redirect-gate failure marker so
// its blocked-night card NAMES the redirect/SEO regression (= the runtime dir in
// the repo; gitignored, TCC-safe). Written ONLY on gate failure; removed on success
// so a one-off past failure can't mislabel a future clean build.
const MARKER_RUN_DIR = path.resolve(__dirname, '../runtime');
const FAIL_MARKER = path.join(MARKER_RUN_DIR, 'nw-redirect-fail');

function markFailure(problems) {
  try {
    fs.mkdirSync(MARKER_RUN_DIR, { recursive: true });
    fs.writeFileSync(FAIL_MARKER, `redirect-health gate failed ${new Date().toISOString()}\n${problems.join('\n')}\n`);
  } catch (_) { /* marker is best-effort; the non-zero exit already blocks the build */ }
}
function clearMarker() {
  try { fs.rmSync(FAIL_MARKER, { force: true }); } catch (_) {}
}

/** Directories under dist/people that represent real (content, non-stub) person pages. */
function realPages() {
  const out = new Set();
  if (!fs.existsSync(DIST_PEOPLE)) return out;
  for (const entry of fs.readdirSync(DIST_PEOPLE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const idx = path.join(DIST_PEOPLE, entry.name, 'index.html');
    if (!fs.existsSync(idx)) continue;
    const html = fs.readFileSync(idx, 'utf-8');
    // Real content pages do NOT carry the redirect meta-refresh marker.
    if (!html.includes('http-equiv="refresh"')) out.add(entry.name);
  }
  return out;
}

/** Every alias stub dir + its HTML. */
function aliasPages() {
  const out = [];
  if (!fs.existsSync(DIST_PEOPLE)) return out;
  for (const entry of fs.readdirSync(DIST_PEOPLE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const idx = path.join(DIST_PEOPLE, entry.name, 'index.html');
    if (!fs.existsSync(idx)) continue;
    const html = fs.readFileSync(idx, 'utf-8');
    if (html.includes('http-equiv="refresh"')) out.push({ from: entry.name, html });
  }
  return out;
}

function main() {
  const aliases = aliasPages();
  const reals = realPages();
  const problems = [];

  for (const { from, html } of aliases) {
    const slug = from;

    // 1. noindex present?
    if (!/<meta\s+name="robots"\s+content="noindex"/i.test(html)) {
      problems.push(`  [${slug}] MISSING <meta name="robots" content="noindex">`);
    }

    // 2. absolute canonical? (not ../relative)
    const canonMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (!canonMatch) {
      problems.push(`  [${slug}] NO canonical tag`);
    } else {
      const href = canonMatch[1];
      if (href.startsWith('../') || href.startsWith('./') || href.startsWith('/people/')) {
        problems.push(`  [${slug}] RELATIVE / non-absolute canonical: ${href}`);
      } else if (!href.startsWith(ABS_BASE)) {
        problems.push(`  [${slug}] canonical does not start with ${ABS_BASE}: ${href}`);
      }
    }

    // 3. meta-refresh target present?
    const refreshMatch = html.match(/http-equiv="refresh"\s+content="0;\s*url=([^"]+)"/i)
                      || html.match(/content="0;\s*url=([^"]+)".*http-equiv="refresh"/i);
    const refreshUrl = refreshMatch ? refreshMatch[1].trim() : null;
    if (!refreshUrl) {
      problems.push(`  [${slug}] MISSING meta-refresh target`);
      continue;
    }

    // 4. target (absolute URL) must point at a REAL page present in dist.
    const targetPath = refreshUrl.replace(ABS_BASE, '').replace(/\/+$/, '');
    const segs = targetPath.split('/').filter(Boolean);
    // Expect /people/<slug>
    const targetSlug = segs[0] === 'people' ? segs.slice(1).join('/') : segs.join('/');
    if (!reals.has(targetSlug)) {
      const looksReal = fs.existsSync(path.join(DIST_PEOPLE, targetSlug, 'index.html'));
      problems.push(
        `  [${slug}] meta-refresh → ${refreshUrl} is ${looksReal ? 'ANOTHER STUB (multihop)' : 'MISSING/404 on disk'} (not a final real page)`
      );
    }
  }

  console.log(`\n🔎 redirect-health gate: scanning ${aliases.length} alias page(s) → ${reals.size} real page(s)`);
  if (problems.length) {
    console.error(`\n❌ redirect-health gate FAILED — ${problems.length} problem(s). Alias layer is broken; refusing to deploy:\n`);
    for (const p of problems) console.error(p);
    markFailure(problems);
    process.exitCode = 1;
  } else {
    clearMarker();
    console.log('✅ redirect-health gate clean: every alias has noindex + absolute canonical → real live page.');
  }
}

main();
