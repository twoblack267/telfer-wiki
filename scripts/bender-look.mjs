#!/usr/bin/env node
/**
 * bender-look — give Bender one page to physically look at.
 *
 * Bender (qwen3.5-bender, his own Hermes profile) cannot see. Gemma4:12b on the
 * same Ollama box CAN see (capabilities: completion, vision, audio, tools) and
 * answered a colour test in 2.5s and a real page screenshot in 9.5s.
 *
 * So: this script is Bender's EYE, not his brain. It loads the page in a real
 * Chromium, screenshots it, and asks the vision model what is actually visible.
 * Bender then reads this JSON and decides what it means, in his own words.
 *
 * This is the layer no script can fake: an actual photograph has to be VISIBLE
 * in the rendered pixels. Markup can lie (an <img> tag with a 404 src), bytes
 * can lie (a file exists but renders as a broken icon), and our own data can
 * lie (the build says the photo is there). The pixels cannot.
 *
 * Usage:
 *   node scripts/bender-look.mjs --slug amy-telfer-1884
 *   node scripts/bender-look.mjs --url http://127.0.0.1:8911/people/x/ --label broken
 *   node scripts/bender-look.mjs --slug amy-telfer-1884 --vision gemma4:12b
 *
 * Env: SENTINEL_SITE (default https://telferwiki.com), OLLAMA_URL
 * Exit: 0 = looked and answered, 2 = could not look at all
 */
import { chromium } from '/Users/marktelfer/telfer-wiki/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const SITE = process.env.SENTINEL_SITE || 'https://telferwiki.com';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const VISION_MODEL = getArg('--vision', 'gemma4:12b');
const SLUG = getArg('--slug', null);
const RAW_URL = getArg('--url', null);
const LABEL = getArg('--label', SLUG || 'page');
const OUTDIR = getArg('--outdir', path.join(process.env.HOME, '.hermes/cache/scratch/bender-eyes'));
const SETTLE = parseInt(getArg('--settle', '3000'), 10);

if (!SLUG && !RAW_URL) {
  console.error('❌ bender-look: need --slug <profile-slug> or --url <full url>');
  process.exit(2);
}
const URL_TO_LOOK_AT = RAW_URL || `${SITE.replace(/\/$/, '')}/people/${SLUG}/`;

mkdirSync(OUTDIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const base = path.join(OUTDIR, `${LABEL}-${stamp}`);

console.log(`👁️  Bender is looking at: ${URL_TO_LOOK_AT}`);

const browser = await chromium.launch();
let shotPath = null, domImages = [], title = '';
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
  const resp = await page.goto(URL_TO_LOOK_AT, { waitUntil: 'networkidle', timeout: 60000 });
  const status = resp ? resp.status() : 0;

  // ── DEFEAT LAZY LOADING, OR THE EYE LIES ──────────────────────────────────
  // Found live on alma-ida-sporer-1880: the grave photo is 2.4MB, HTTP 200, and
  // renders as NOTHING because it carries loading="lazy" and sits below the fold.
  // The screenshot then shows a blank space and the vision model honestly reports
  // "no photograph visible" - a false alarm that would file a bogus card by 7am.
  // So: scroll the whole page to trigger the lazy fetch, wait for every <img> to
  // actually decode (naturalWidth > 0), then scroll back to the top to shoot.
  await page.evaluate(async () => {
    await new Promise((res) => {
      let y = 0;
      const step = () => {
        y += window.innerHeight * 0.8;
        window.scrollTo(0, y);
        if (y < document.body.scrollHeight) setTimeout(step, 120);
        else setTimeout(res, 400);
      };
      step();
    });
  });
  await page.waitForTimeout(500);
  // Force-decode every image and wait (bounded) for them to reach a real size.
  const decoded = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('img')];
    imgs.forEach((i) => { i.loading = 'eager'; });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const pending = imgs.filter((i) => !i.complete || i.naturalWidth === 0);
      if (pending.length === 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return imgs.map((i) => ({
      src: i.getAttribute('src'),
      complete: i.complete,
      naturalWidth: i.naturalWidth,
      naturalHeight: i.naturalHeight,
    }));
  });
  await page.waitForTimeout(SETTLE);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  title = await page.title();
  // What the DOM CLAIMS — recorded for comparison, never used as the answer.
  domImages = await page.$$eval('img', (els) =>
    els.map((e) => ({ src: e.getAttribute('src'), w: e.naturalWidth, h: e.naturalHeight, alt: e.getAttribute('alt') }))
  );
  // A photo that never decoded is a REAL fault — say so before the model looks.
  const undecoded = decoded.filter((d) => !d.complete || d.naturalWidth === 0);
  if (undecoded.length) {
    console.log(`   ⚠️ ${undecoded.length} image(s) never decoded: ${undecoded.map((u) => u.src).join(', ')}`);
  }
  shotPath = `${base}.png`;
  // fullPage so a photo below the fold is actually IN the picture the model sees
  await page.screenshot({ path: shotPath, fullPage: true });
  console.log(`   page HTTP ${status} | title: ${title}`);
  console.log(`   DOM claims ${domImages.length} <img> element(s); ${domImages.filter((d) => d.w > 0).length} decoded`);
  globalThis.__undecoded = undecoded;
} catch (e) {
  console.error(`   ❌ could not load the page at all: ${String(e.message || e).slice(0, 200)}`);
  await browser.close().catch(() => {});
  console.log(JSON.stringify({ looked: false, url: URL_TO_LOOK_AT, error: String(e.message || e).slice(0, 300) }));
  process.exit(2);
} finally {
  await browser.close().catch(() => {});
}

// ── downscale so the local 12B can chew it comfortably ─────────────────────
const { execFileSync } = await import('node:child_process');
const smallJpg = `${base}-small.jpg`;
try {
  execFileSync('sips', ['-Z', '1280', '-s', 'format', 'jpeg', shotPath, '--out', smallJpg], { stdio: 'ignore' });
} catch {
  execFileSync('cp', [shotPath, smallJpg]);
}

const b64 = readFileSync(smallJpg).toString('base64');

const PROMPT = `You are inspecting a screenshot of a family-history web page. Report ONLY what you can actually SEE rendered in the picture. Do not guess from context, captions or surrounding text.

Answer in exactly this format:
VISIBLE_PHOTOS: <number of real photographs actually rendered>
PHOTO_SUBJECTS: <one line per photo: what it shows — e.g. "old portrait of a woman", "gravestone with lettering", "wedding couple", "group outdoors", "church building">
BROKEN_PLACEHOLDERS: <number of broken-image icons, empty grey boxes, or blank gaps where a picture clearly should be>
DESCRIBE_PLACEHOLDERS: <one line per broken/blank area: where on the page it is, and what caption sits beside it>
CONFIDENCE: <high|medium|low>

If you can see no photographs at all, answer VISIBLE_PHOTOS: 0. Be literal and terse.`;

console.log(`   asking ${VISION_MODEL} what it can see…`);
const started = Date.now();
let answer = '', visionErr = null;
try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 300000);
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      prompt: PROMPT,
      images: [b64],
      stream: false,
      think: false,
      options: { num_predict: 320, temperature: 0 },
    }),
    signal: ctrl.signal,
  });
  clearTimeout(timer);
  if (!r.ok) throw new Error(`ollama HTTP ${r.status}`);
  const j = await r.json();
  answer = (j.response || '').trim();
  if (!answer) throw new Error('vision model returned nothing');
} catch (e) {
  visionErr = String(e.message || e).slice(0, 200);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

// ── parse the model's own words into fields, but KEEP the raw answer ────────
function field(name) {
  const m = answer.match(new RegExp(`${name}:\\s*([^\\n]+)`, 'i'));
  return m ? m[1].trim() : null;
}
const visible = parseInt(field('VISIBLE_PHOTOS') ?? '', 10);
const broken = parseInt(field('BROKEN_PLACEHOLDERS') ?? '', 10);
const subjects = answer.match(/PHOTO_SUBJECTS:\s*([\s\S]*?)(?=BROKEN_PLACEHOLDERS:|$)/i);

const result = {
  looked: true,
  bender_eye: VISION_MODEL,
  url: URL_TO_LOOK_AT,
  slug: SLUG,
  title,
  screenshot: shotPath,
  screenshot_small: smallJpg,
  taken_at: new Date().toISOString(),
  vision_seconds: Number(elapsed),
  // WHAT A PERSON SEES — the whole point of this check
  visible_photos: Number.isFinite(visible) ? visible : null,
  broken_placeholders: Number.isFinite(broken) ? broken : null,
  photo_subjects: subjects ? subjects[1].trim() : null,
  model_says: answer,
  vision_error: visionErr,
  // what the markup claimed — for Bender to compare, never to trust
  dom_image_count: domImages.length,
  dom_images_decoded: domImages.filter((d) => d.w > 0).length,
  undecoded_images: (globalThis.__undecoded || []).map((u) => u.src),
  dom_images: domImages,
};

writeFileSync(`${base}.json`, JSON.stringify(result, null, 1));

if (visionErr) {
  console.error(`   ❌ vision failed: ${visionErr}`);
  console.log(JSON.stringify(result, null, 1));
  process.exit(0); // we DID look and screenshot; Bender must know the eye failed
}

console.log(`   ${VISION_MODEL} answered in ${elapsed}s`);
console.log('   ─── what Bender can see ───');
for (const line of answer.split('\n')) console.log(`   ${line}`);
console.log(`   screenshot: ${shotPath}`);
console.log(`   json: ${base}.json`);
