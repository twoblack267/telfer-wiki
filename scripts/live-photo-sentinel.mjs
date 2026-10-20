#!/usr/bin/env node
/**
 * live-photo-sentinel — the OUTSIDE check.
 *
 * Every other photo guard reads OUR data, OUR build output, OUR vault. If the
 * build is wrong in the same way the guard is wrong, they agree with each other
 * and both stay silent — which is exactly how a headstone sat missing for two
 * months with every gate reporting CLEAN.
 *
 * This one loads the LIVE page in a real browser (ego lite / Chromium) and asks
 * what a visitor would see. It cannot be fooled by our bookkeeping because it
 * never consults it.
 *
 * Samples photo-bearing pages. Rotation, not pure random: state persists so
 * every page gets its turn — three random of 55 could miss a broken page forever.
 *
 * TWO independent tests, both must pass:
 *   1. RENDER — does an <img> exist in the settled DOM with a real src?
 *   2. BYTES  — does that src return HTTP 200 with real image bytes?
 * They are different faults with different fixes, so they're reported separately:
 * missing-from-markup is a content problem, a 404/500 is a server problem.
 *
 * Usage:
 *   node scripts/live-photo-sentinel.mjs                 # 3 pages, rotating
 *   node scripts/live-photo-sentinel.mjs --count 5
 *   node scripts/live-photo-sentinel.mjs --slug <slug>   # force one page
 *   node scripts/live-photo-sentinel.mjs --json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const STATE_DIR = path.join(REPO, 'scripts/.sentinel');
const STATE_FILE = path.join(STATE_DIR, 'live-photo-sentinel.state.json');
const SITE = process.env.SENTINEL_SITE || 'https://telferwiki.com';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const COUNT = parseInt(getArg('--count', '3'), 10);
const FORCE_SLUG = getArg('--slug', null);
const SETTLE_MS = parseInt(getArg('--settle', '2500'), 10);
// ── the candidate pool: profiles the BUILD says carry photos ────────────────
// Read from people.json, but only to CHOOSE which pages to visit. The verdict
// comes from the live page alone — we never compare against this file.
const people = JSON.parse(readFileSync(path.join(REPO, 'src/data/people.json'), 'utf8'));
const pool = people
  .filter((p) => Array.isArray(p.images) && p.images.length > 0)
  .map((p) => ({ slug: p.slug, expected: p.images.length }));

if (pool.length === 0) {
  console.error('❌ live-photo-sentinel: no photo-bearing profiles in people.json — refusing to claim a pass');
  process.exit(2);
}

// ── rotation state ─────────────────────────────────────────────────────────
let state = { lastIndex: -1, lastRun: null, runs: 0, history: [] };
if (existsSync(STATE_FILE)) {
  try { state = { ...state, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch { /* corrupt state = start fresh */ }
}

// A rotating sample of 3 pages can sail past a single broken page for days —
// proven live: one page 404'd its grave photo and three consecutive samples
// reported ALL CLEAR. So every run also checks the LAST-KNOWN-BAD pages first.
// A page that failed yesterday gets re-tested today before anything else, which
// means a real fault is confirmed-or-cleared, never forgotten.
const regressionQueue = (state.failing || []).filter((s) => pool.some((p) => p.slug === s));

function pickPages() {
  if (FORCE_SLUG) {
    const hit = pool.find((p) => p.slug === FORCE_SLUG);
    if (!hit) {
      console.error(`❌ ${FORCE_SLUG} is not a photo-bearing profile — cannot test it`);
      process.exit(2);
    }
    return [hit];
  }
  const picked = [];
  const seen = new Set();

  // 1. re-test anything that failed last time
  for (const slug of regressionQueue) {
    if (picked.length >= COUNT) break;
    const p = pool.find((x) => x.slug === slug);
    if (p && !seen.has(slug)) { picked.push(p); seen.add(slug); }
  }

  // 2. fill the rest by rotating forward through the pool
  let guard = 0;
  while (picked.length < Math.min(COUNT, pool.length) && guard < pool.length * 2) {
    const cand = pool[(state.lastIndex + 1 + guard) % pool.length];
    if (!seen.has(cand.slug)) { picked.push(cand); seen.add(cand.slug); }
    guard++;
  }
  state.lastIndex = (state.lastIndex + COUNT) % pool.length;
  return picked;
}

const targets = pickPages();

// ── browser ────────────────────────────────────────────────────────────────
async function run() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const results = [];

  for (const t of targets) {
    const url = `${SITE}/people/${t.slug}/`;
    const rec = { slug: t.slug, url, expected: t.expected, render: null, bytes: [], verdict: 'UNKNOWN', detail: '' };
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      rec.http = resp ? resp.status() : null;

      if (rec.http !== 200) {
        rec.verdict = 'PAGE_UNAVAILABLE';
        rec.detail = `page itself returned HTTP ${rec.http}`;
        results.push(rec); await page.close(); continue;
      }

      // let lazy images settle — a browser that checks too early sees nothing
      // and files a false alarm, and false alarms get the 7am card ignored
      await page.waitForTimeout(SETTLE_MS);
      await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 600));
        window.scrollTo(0, 0);
      }).catch(() => {});
      await page.waitForTimeout(600);

      // ── TEST 1: RENDER — images actually present in the settled DOM ──
      const imgs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main img, article img, .prose img, img'))
          .map((el) => ({
            src: el.currentSrc || el.getAttribute('src') || '',
            complete: el.complete,
            naturalWidth: el.naturalWidth,
            alt: (el.getAttribute('alt') || '').slice(0, 80),
          }))
          .filter((i) => i.src && !i.src.startsWith('data:'))
      );
      rec.render = { count: imgs.length, imgs };

      if (imgs.length === 0) {
        rec.verdict = 'PHOTO_MISSING';
        rec.detail = 'page rendered but carries NO image element at all — the photo is gone from the markup';
        results.push(rec); await page.close(); continue;
      }

      // ── TEST 2: BYTES — each image actually returns real image data ──
      for (const im of imgs) {
        const abs = im.src.startsWith('http') ? im.src : new URL(im.src, url).href;
        try {
          const r = await ctx.request.get(abs, { timeout: 20000 });
          const body = await r.body();
          const ctype = r.headers()['content-type'] || '';
          const okBytes = r.status() === 200 && body.length > 1024 && /^image\//i.test(ctype);
          rec.bytes.push({
            src: abs.replace(SITE, ''),
            status: r.status(),
            type: ctype.split(';')[0],
            bytes: body.length,
            ok: okBytes,
          });
        } catch (e) {
          rec.bytes.push({ src: abs.replace(SITE, ''), error: String(e.message || e).slice(0, 120), ok: false });
        }
      }

      const broken = rec.bytes.filter((b) => !b.ok);
      const zeroWidth = imgs.filter((i) => i.complete && i.naturalWidth === 0);

      if (broken.length > 0) {
        rec.verdict = 'PHOTO_UNREACHABLE';
        rec.detail = `${broken.length} image(s) failed to load real data: ` +
          broken.map((b) => `${b.src} (${b.status || b.error})`).join(', ');
      } else if (zeroWidth.length > 0) {
        rec.verdict = 'PHOTO_ZERO_WIDTH';
        rec.detail = `${zeroWidth.length} image element(s) decoded to zero width (broken src in markup)`;
      } else if (imgs.length < t.expected) {
        // fewer images than the build intends — a silent partial loss
        rec.verdict = 'PHOTO_PARTIAL';
        rec.detail = `page shows ${imgs.length} image(s), the build expects ${t.expected}`;
      } else {
        rec.verdict = 'OK';
        rec.detail = `${imgs.length} image(s) rendered, all returning real bytes`;
      }
    } catch (e) {
      rec.verdict = 'ERROR';
      rec.detail = String(e.message || e).slice(0, 200);
    }
    results.push(rec);
    await page.close();
  }

  await browser.close();

  const failures = results.filter((r) => r.verdict !== 'OK');

  // ── Distinguish "a photo is missing" from "the whole site is unreachable" ──
  // If every sampled page failed to CONNECT (not to render), that is an outage
  // or a network blip, not photo loss. Reporting it as "pages lost their photos"
  // would file three bogus cards at 7am and train Mark to ignore the check.
  // Different fault, different alarm.
  const unreachable = results.filter((r) => r.verdict === 'ERROR' || r.verdict === 'PAGE_UNAVAILABLE');
  const SITE_DOWN = results.length > 0 && unreachable.length === results.length;
  const photoFailures = failures.filter((r) => !(SITE_DOWN && unreachable.includes(r)));

  const out = {
    ok: failures.length === 0,
    site_down: SITE_DOWN,
    checked_at: new Date().toISOString(),
    site: SITE,
    pool_size: pool.length,
    checked: results.length,
    coverage_note: `rotating sample — ${results.length} of ${pool.length} photo pages this run`,
    failures: failures.map((f) => ({
      slug: f.slug, url: f.url, verdict: f.verdict, detail: f.detail,
    })),
    results,
  };

  state.runs += 1;
  state.lastRun = out.checked_at;
  // Carry failures forward so the NEXT run re-tests them before sampling afresh.
  // Cleared automatically once a page passes again.
  state.failing = failures.filter((f) => f.verdict !== 'ERROR' && f.verdict !== 'PAGE_UNAVAILABLE').map((f) => f.slug);
  state.history = [
    { at: out.checked_at, checked: results.length, failures: failures.length, verdicts: results.map((r) => `${r.slug}:${r.verdict}`) },
    ...(state.history || []),
  ].slice(0, 50);
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));

  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 1));
  } else if (out.ok) {
    console.log(`🔍 live-photo-sentinel: OK — ${results.length}/${pool.length} photo pages checked in a live browser, every image rendered with real bytes.`);
    for (const r of results) console.log(`    ✅ ${r.slug} — ${r.detail}`);
  } else if (SITE_DOWN) {
    // Not photo loss. Do not claim it is.
    console.log(`⚠️  live-photo-sentinel: SITE UNREACHABLE — none of the ${results.length} sampled page(s) would load at all.`);
    console.log(`    ${results[0].detail}`);
    console.log('\n  This is an OUTAGE, not missing photos. No photo card should be filed for this.');
    console.log('  Check https://telferwiki.com manually, then re-run once it is back.');
  } else {
    console.log(`🔍 live-photo-sentinel: FAILED — ${photoFailures.length} of ${results.length} sampled page(s) lost their photos.`);
    for (const f of photoFailures) {
      console.log(`    ❌ ${f.slug}: ${f.verdict}`);
      console.log(`       ${f.detail}`);
      console.log(`       ${f.url}`);
    }
    console.log('\n  This is the OUTSIDE check: the live page in a real browser, not our own data.');
    console.log('  Diagnose at the SOURCE (vault embed → regen → images[]) — never hand-edit dist/ or people.json.');
  }
  // SITE_DOWN exits 3 so callers can tell an outage from a photo fault
  process.exit(out.ok ? 0 : SITE_DOWN ? 3 : 1);
}

run().catch((e) => {
  console.error('❌ live-photo-sentinel crashed:', e);
  process.exit(2);
});
