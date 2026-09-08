#!/usr/bin/env node
/**
 * check-rendered-photos.mjs — Telfer Wiki rendered-photo guard (Skippy, 2026-09-08)
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *   A profile photo can be present in the source data (images[] / person_photo),
 *   have its FILE sitting in public/, and STILL never actually be seen on the
 *   person's page — because it got pinned to only the tiny round avatar crop, or
 *   dropped from the render pipeline entirely. That was the real symptom Mark
 *   reported ("my wedding photo only shows as my profile, not in the page"):
 *
 *     - data (people.json) HAD the photo       ✓
 *     - file on the site (public/) HAD it      ✓
 *     - image-integrity-check PASSED green     ✓   (it only verifies files exist
 *                                                    and are wired in DATA)
 *     - but the BUILT page showed it ONLY as   ✗   the small round avatar
 *
 *   image-integrity-check.mjs audits the vault/file/data layer and cannot see
 *   the RENDERED page. This guard closes that gap: it scans the built pages in
 *   dist/ and fails the build if any attached photo is missing or reduced to a
 *   bare avatar thumbnail on its own page.
 *
 * WHAT IT CHECKS (per dist/people/<slug>/index.html, non-redirect pages)
 *   For every file in person.images[] ∪ {person_photo}:
 *     A. PRESENCE  — the filename must appear on the page as an <img src>.
 *     B. NOT-AVATAR-ONLY — a photo must not exist ONLY as the round avatar crop.
 *        Concretely: look at every <img> tag referencing the file. If NONE of
 *        them is a real full-size image (object-contain / rounded-lg gallery/
 *        body display), the photo exists purely as the avatar thumbnail → FAIL.
 *        (With the canonical gallery rule — person_photo is kept in the gallery
 *        when not shown in the body — every attached photo should render at
 *        least once as a genuine photograph.)
 *
 * FAILURE MODE
 *   Non-zero exit + a clear list -> fails npm run postbuild -> blocks the GitHub
 *   Pages deploy. The build must not ship a page whose photos are invisible.
 *
 * USAGE
 *   node scripts/check-rendered-photos.mjs      (called from package.json postbuild)
 *   node scripts/check-rendered-photos.mjs --dir dist
 *   node scripts/check-rendered-photos.mjs --json
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = process.argv.includes('--dir')
  ? join(ROOT, process.argv[process.argv.indexOf('--dir') + 1])
  : join(ROOT, 'dist');
const JSON_OUT = process.argv.includes('--json');

// Load the SAME data the pages are built from.
const publicPeople = JSON.parse(
  readFileSync(join(ROOT, 'src/data/people.public.json'), 'utf8')
);
const bySlug = new Map(publicPeople.map((p) => [p.slug, p]));

const PEOPLE_DIR = join(DIST, 'people');
if (!existsSync(PEOPLE_DIR)) {
  console.error('[check-rendered-photos] no dist/people — run astro build first');
  process.exit(1);
}

// Avatar crop imgs carry the small header box signature <img class="w-full h-full
// object-cover"> — fixed height filling the round div. Genuine full-size
// gallery/body imgs use object-contain + rounded-lg (+ a max-height/style).
// A photo is "stuck as just the avatar" when EVERY render of it on the page is an
// object-cover crop and NONE reaches a real full-size display.
function isFullSizeClass(cls) {
  // full gallery tile / body figure: object-contain + rounded-lg border, or any
  // non-'cover' object-fit / max-w / max-height style. These = real photograph.
  return cls.includes('object-contain') || cls.includes('rounded-lg') ||
         /object-(?!cover)/.test(cls) || /(max-w|max-height)/.test(cls);
}

const offenders = [];
let pagesChecked = 0;
let photosChecked = 0;

const slugs = readdirSync(PEOPLE_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const slug of slugs) {
  const person = bySlug.get(slug);
  if (!person) continue; // e.g. a legacy redirect-only directory with no profile

  const file = join(PEOPLE_DIR, slug, 'index.html');
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');

  // Redirect stubs / no-h1 helper pages are intentionally tiny meta-refresh
  // stubs with no profile content — skip them (mirrors check-rendered-layout).
  if (html.includes('http-equiv="refresh"') || html.includes('http-equiv=refresh')) {
    continue;
  }

  const attached = new Set();
  for (const im of person.images || []) {
    const src = typeof im === 'string' ? im : im?.src || '';
    if (src) attached.add(src.split('/').pop().toLowerCase());
  }
  if (person.person_photo) attached.add(person.person_photo.split('/').pop().toLowerCase());
  if (attached.size === 0) continue;

  pagesChecked++;

  // Collect every <img ...src="...images/people/<file>"> tag with its class.
  const imgs = [];
  const re = /<img\b[^>]*?src="([^"]*images\/people\/[^"?]+)"[^>]*class="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    imgs.push({ file: m[1].split('/').pop().toLowerCase(), cls: m[2] });
  }

  for (const file of attached) {
    const hits = imgs.filter((i) => i.file === file);
    photosChecked++;

    // A. PRESENCE — must appear at least once.
    if (hits.length === 0) {
      offenders.push({ slug, file, reason: 'photo attached in data but NOT rendered anywhere on the page' });
      continue;
    }
    // B. NOT-AVATAR-ONLY — if no render of this photo is a real full-size image
    //    (they are ALL just the round avatar crop), it is pinned to the tiny
    //    thumbnail and never shown as an actual photograph (the wedding-photo bug).
    if (!hits.some((h) => isFullSizeClass(h.cls))) {
      offenders.push({
        slug,
        file,
        reason: 'photo renders ONLY as the small round avatar profile pic — it never appears full-size on the page',
      });
    }
  }
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ ok: offenders.length === 0, pagesChecked, photosChecked, offenders }, null, 1));
} else if (offenders.length === 0) {
  console.log(`🖼 check-rendered-photos: ${pagesChecked} photo-bearing pages / ${photosChecked} attached photos — every photo renders full-size. CLEAN`);
  process.exit(0);
} else {
  console.error(`🖼 check-rendered-photos: ${offenders.length} photo rendering problem(s) across the built site:`);
  for (const o of offenders) {
    console.error(`   ❌ ${o.slug}/${o.file}: ${o.reason}`);
  }
  console.error('\nRefusing to ship a page whose photos are invisible. Attach/surface the photo so it renders, not just as the avatar.');
  process.exit(1);
}
