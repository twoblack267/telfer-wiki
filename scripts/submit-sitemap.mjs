#!/usr/bin/env node
/**
 * Daily sitemap submission to search engines.
 *
 * WHAT THIS DOES
 *   Reads the freshly built dist/sitemap-0.xml, works out which URLs are new or
 *   changed since the last successful submission, and pushes them to every
 *   engine that accepts a ping. Runs once a day from GitHub Actions.
 *
 * WHY NOT JUST PING EVERY URL EVERY DAY
 *   Both IndexNow and Google treat repeated submissions of unchanged URLs as
 *   low-value noise, and IndexNow rate-limits per host. Submitting the delta
 *   keeps the signal honest and the request small.
 *
 * WHY THE STATE FILE LIVES IN THE REPO
 *   The job runs on an ephemeral GitHub runner. A state file committed back to
 *   the repo (or restored from the Actions cache) is the only way "what did we
 *   send last time" survives between runs. We commit it, because a cache miss
 *   must not cause a silent full resubmission.
 *
 * ENGINES
 *   - IndexNow (Bing, Yandex, Seznam, Naver) — one POST, shared key.
 *   - Google — Ping API was RETIRED in 2023. There is no equivalent push.
 *     Google discovers the sitemap via robots.txt and Search Console, so the
 *     sitemap must stay fresh; we assert its lastmod is current instead of
 *     pretending we can ping Google.
 *
 * EXIT CODES
 *   0 — success, or nothing to submit.
 *   1 — a submission was attempted and rejected. The workflow goes red.
 *
 * SAFETY
 *   Never throws on network failure alone; collects per-engine results and
 *   reports. A single dead engine must not stop the others.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// FIX 2026-11-05: this used to point at dist/sitemap-0.xml only. Astro caps a
// single sitemap at 1000 URLs, so the site emits sitemap-0.xml AND
// sitemap-1.xml behind sitemap-index.xml. Reading only file 0 silently skipped
// 755 pages that were never submitted to IndexNow. Read the index, then every
// child sitemap.
const SITEMAP_INDEX = path.join(ROOT, 'dist', 'sitemap-index.xml');
const SITEMAP = path.join(ROOT, 'dist', 'sitemap-0.xml'); // fallback
const STATE_FILE = path.join(ROOT, 'scripts', '.index-submission-state.json');
const HOST = 'telferwiki.com';
const ORIGIN = `https://${HOST}`;

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * IndexNow key. Must ALSO be served at https://telferwiki.com/<key>.txt
 * containing exactly the key, or IndexNow rejects the request with 403.
 * Read from the environment first (GitHub secret), then the checked-in file.
 */
function readIndexNowKey() {
  const fromEnv = (process.env.INDEXNOW_KEY || '').trim();
  if (fromEnv) return fromEnv;

  const keyFile = path.join(ROOT, 'scripts', '.indexnow-key');
  if (fs.existsSync(keyFile)) {
    const k = fs.readFileSync(keyFile, 'utf8').trim();
    if (k) return k;
  }
  return null;
}

// ─── Sitemap parsing ─────────────────────────────────────────────────────────

function readSitemapUrls(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `sitemap not found at ${file} — run \`npm run build\` first. ` +
        `This script submits what was BUILT, never what was intended.`
    );
  }
  const xml = fs.readFileSync(file, 'utf8');
  const urls = [];
  // <url><loc>…</loc></url> — lastmod optional.
  const re = /<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    urls.push({ loc: m[1].trim(), lastmod: (m[2] || '').trim() });
  }
  return urls;
}

/**
 * Read every sitemap the build emitted, not just the first one.
 *
 * Astro/MaxMind sitemap plugins split at 1000 URLs per file and emit a
 * sitemap-index.xml listing them. Reading only sitemap-0.xml is how 755 pages
 * went unsubmitted from Oct 25 to Nov 5 — no error, no warning, just a smaller
 * number on a green build. Prefer the index; fall back to file 0 if absent.
 */
function readAllSitemapUrls() {
  const files = [];
  if (fs.existsSync(SITEMAP_INDEX)) {
    const idx = fs.readFileSync(SITEMAP_INDEX, 'utf8');
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(idx)) !== null) {
      const loc = m[1].trim();
      // Only follow children we can read locally from dist/.
      const base = path.basename(loc);
      const local = path.join(ROOT, 'dist', base);
      if (fs.existsSync(local)) files.push(local);
    }
  }
  if (!files.length) files.push(SITEMAP);

  const seen = new Set();
  const urls = [];
  for (const f of files) {
    for (const u of readSitemapUrls(f)) {
      if (seen.has(u.loc)) continue;
      seen.add(u.loc);
      urls.push(u);
    }
  }
  return { urls, files };
}

// ─── State ───────────────────────────────────────────────────────────────────

function readState() {
  if (!fs.existsSync(STATE_FILE)) return { submitted: {}, lastRun: null };
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { submitted: raw.submitted || {}, lastRun: raw.lastRun || null };
  } catch {
    // A corrupt state file must not wedge the job forever. Treat as empty.
    console.warn('⚠️  state file unreadable — treating as first run');
    return { submitted: {}, lastRun: null };
  }
}

function writeState(state) {
  const payload = {
    _comment:
      'URL -> lastmod last ACCEPTED by the search engines. Committed so the ' +
      'daily delta survives an ephemeral CI runner. Safe to reset to {} to ' +
      'force a full resubmission.',
    lastRun: new Date().toISOString(),
    submitted: state.submitted,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2) + '\n');
}

// ─── Delta ───────────────────────────────────────────────────────────────────

/**
 * A URL needs submitting when it is new, or when its lastmod moved forward.
 * When lastmod is absent (the common case for this sitemap), a URL that has
 * already been submitted is considered unchanged — which is exactly right:
 * without a lastmod there is no evidence anything changed.
 */
function computeDelta(urls, state, { forceFull = false } = {}) {
  if (forceFull) return urls;
  return urls.filter((u) => {
    const prev = state.submitted[u.loc];
    if (!prev) return true;
    if (u.lastmod && u.lastmod !== prev) return true;
    return false;
  });
}

// ─── Submitters ──────────────────────────────────────────────────────────────

async function submitIndexNow(key, urls) {
  if (!urls.length) return { engine: 'IndexNow', skipped: 'no urls' };
  if (!key) return { engine: 'IndexNow', skipped: 'no key configured' };

  // IndexNow limit is 10,000 URLs per POST.
  const BATCH = 10000;
  const results = [];

  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH).map((u) => u.loc);
    const body = {
      host: HOST,
      key,
      keyLocation: `${ORIGIN}/${key}.txt`,
      urlList: batch,
    };

    try {
      const res = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
      // 200 = accepted, 202 = accepted pending key validation.
      results.push({
        engine: 'IndexNow',
        status: res.status,
        ok: res.status === 200 || res.status === 202,
        count: batch.length,
      });
    } catch (err) {
      results.push({
        engine: 'IndexNow',
        ok: false,
        error: err.message,
        count: batch.length,
      });
    }
  }

  return results.every((r) => r.ok)
    ? { engine: 'IndexNow', ok: true, count: urls.length, detail: results }
    : { engine: 'IndexNow', ok: false, count: urls.length, detail: results };
}

/**
 * Google has no ping endpoint since 2023. What we CAN do is assert the sitemap
 * is live and current — which is how Google actually discovers new URLs. This
 * turns a silent failure (sitemap 404s after a bad deploy) into a red build.
 */
async function verifySitemapLive() {
  const candidates = [`${ORIGIN}/sitemap-index.xml`, `${ORIGIN}/sitemap-0.xml`];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (res.ok) {
        const text = await res.text();
        const count = (text.match(/<loc>/g) || []).length;
        return { engine: 'Google (sitemap liveness)', ok: true, url, count };
      }
    } catch {
      // try next candidate
    }
  }
  return {
    engine: 'Google (sitemap liveness)',
    ok: false,
    error: 'sitemap unreachable at /sitemap-index.xml and /sitemap-0.xml',
  };
}

/**
 * PRE-FLIGHT 200 CHECK (added 2026-11-05).
 *
 * Every other live check in this project verifies the LOCAL build. This is the
 * last place where we ask whether the deployed site actually serves the URL
 * before we tell Bing and Yandex that it exists.
 *
 * Why it matters: a build can succeed while the deploy that serves it is still
 * in flight, failed, or serving a stale artefact. Submitting a URL that 404s
 * teaches the search engine the page is dead. That is worse than silence — a
 * dead URL can be un-indexed while a URL never announced is simply unknown.
 *
 * Deliberately a SAMPLE, not all 1,755: two URLs (the newest and the oldest in
 * the delta) catch "deploy not live yet" and "whole site down". Probing every
 * URL would add minutes and get us rate-limited by our own host, which proves
 * nothing extra — if the deploy is live, the pages are there; if it is not, the
 * two probes both fail.
 *
 * Honest about uncertainty: a network error is reported as UNREACHABLE, not as
 * a dead page, and unreachable is treated as fatal here because we cannot
 * distinguish it from a real 404 from this vantage point. Refusing to submit is
 * the safe failure — it costs one night, and tomorrow retries.
 */
async function preflightSample(delta) {
  if (!delta.length) return { ok: true, checked: 0, detail: [] };

  // Newest and oldest by lastmod, falling back to first/last in the delta.
  const withDates = delta.filter((u) => u.lastmod).sort((a, b) => (a.lastmod < b.lastmod ? -1 : 1));
  const sample =
    withDates.length >= 2
      ? [withDates[0], withDates[withDates.length - 1]]
      : [delta[0], delta[delta.length - 1]].filter((v, i, a) => v && a.indexOf(v) === i);

  const detail = [];
  for (const u of sample) {
    try {
      const res = await fetch(u.loc, {
        method: 'GET',
        headers: { 'cache-control': 'no-cache' },
      });
      detail.push({ url: u.loc, status: res.status, ok: res.ok });
    } catch (err) {
      detail.push({ url: u.loc, status: null, ok: false, error: err.message });
    }
  }
  return { ok: detail.every((d) => d.ok), checked: detail.length, detail };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const forceFull = process.argv.includes('--full');
  const dryRun = process.argv.includes('--dry-run');

  const { urls, files } = readAllSitemapUrls();
  const state = readState();
  const delta = computeDelta(urls, state, { forceFull });
  const key = readIndexNowKey();

  console.log(`📑 sitemap files:       ${files.map((f) => path.basename(f)).join(', ')}`);
  console.log(`📑 sitemap URLs:        ${urls.length}`);
  console.log(`🔁 new/changed URLs:    ${delta.length}${forceFull ? ' (--full)' : ''}`);
  console.log(`🔑 IndexNow key:        ${key ? 'configured' : 'MISSING'}`);
  console.log(`🕓 last run:            ${state.lastRun || 'never'}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing submitted.');
    console.log('First 5 in delta:');
    delta.slice(0, 5).forEach((u) => console.log(`  - ${u.loc}`));
    return 0;
  }

  if (!delta.length && key) {
    // Still worth proving the sitemap is live even when nothing changed.
    const live = await verifySitemapLive();
    console.log(`\n↻ ${live.engine}: ${live.ok ? `OK (${live.count} locs)` : 'FAILED'}`);
    console.log('Nothing new to submit — exiting clean.');
    writeState(state);
    return live.ok ? 0 : 1;
  }

  // ── PRE-FLIGHT: is the deployed site actually serving these URLs? ──
  // Runs BEFORE submitIndexNow, because once IndexNow accepts a 404 we cannot
  // un-tell it. Failing here exits 1 and the workflow goes red — the next
  // night's run retries with the same delta, so nothing is lost but a night.
  const pre = await preflightSample(delta);
  if (pre.checked) {
    console.log('\n── Pre-flight (deployed site) ──');
    for (const d of pre.detail) {
      console.log(
        d.status
          ? `  ${d.ok ? '✅' : '❌'} ${d.status} ${d.url}`
          : `  ❌ UNREACHABLE ${d.url} — ${d.error}`
      );
    }
  }
  if (!pre.ok) {
    console.log(
      '\n🛑 ABORTING SUBMISSION — the deployed site is not serving these URLs.' +
        '\n   Submitting a 404 tells the search engine the page is dead, which is' +
        '\n   worse than never announcing it. State not updated; next run retries.'
    );
    return 1;
  }

  const results = [];
  results.push(await submitIndexNow(key, delta));
  results.push(await verifySitemapLive());

  console.log('\n── Results ──');
  let anyFailed = false;
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ⊘ ${r.engine}: skipped (${r.skipped})`);
      continue;
    }
    if (r.ok) {
      console.log(`  ✅ ${r.engine}: OK${r.count !== undefined ? ` — ${r.count} urls` : ''}`);
    } else {
      anyFailed = true;
      console.log(`  ❌ ${r.engine}: FAILED — ${r.error || JSON.stringify(r.detail)}`);
    }
  }

  // Only record URLs as submitted if IndexNow actually accepted them.
  const indexNow = results.find((r) => r.engine === 'IndexNow');
  if (indexNow && indexNow.ok) {
    for (const u of delta) state.submitted[u.loc] = u.lastmod || 'submitted';
    writeState(state);
    console.log(`\n💾 state updated: ${Object.keys(state.submitted).length} urls tracked`);
  } else {
    console.log('\n⚠️  state NOT updated — IndexNow did not accept, so the next run will retry.');
  }

  return anyFailed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('💥 fatal:', err.message);
    process.exit(1);
  });
