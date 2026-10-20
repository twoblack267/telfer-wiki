#!/usr/bin/env node
/**
 * check-photo-ratchet.mjs — photos can go UP, never silently DOWN.
 * (Skippy, 2026-10-20)
 * ──────────────────────────────────────────────────────────────────────────
 * THE HOLE THIS CLOSES
 *   All four existing photo guards answer "is what we HAVE still correct?":
 *     check-rendered-photos    — every attached photo renders
 *     check-vault-photo-parity — every published photo is reproducible from the vault
 *     image-integrity-check    — no blank/broken photo would ship
 *     validate-people-links    — links resolve
 *   None of them answers "did we LOSE one?" A photo un-embedded from a note, or
 *   an images[] entry silently dropped by a converter change, leaves every guard
 *   green: nothing is broken, there is simply LESS than yesterday. That is
 *   exactly how James Telfer (1796-1863)'s headstone died for ~2 months — the
 *   attachment vanished, and no assertion was counting.
 *
 * THE MECHANISM (a ratchet, not a rule)
 *   A floor is committed to the repo: how many photos each profile is known to
 *   carry. Any profile below its floor FAILS the build. Adding photos is free
 *   and needs no ceremony; removing one is a deliberate act that requires
 *   updating the floor, so a loss can never be an accident-of-regeneration
 *   again. The floor only rises automatically; lowering it must be explicit
 *   (--accept-removal <slug>), which puts the decision in a commit message
 *   where a human can see it.
 *
 * WHAT IT COUNTS (per profile, from people.json)
 *   photo_count = |unique images[]| + (person_photo ? 1 : 0)
 *   Counts, not filenames: renaming a file is not a loss, and a rename must not
 *   trip the guard. A genuinely dropped photo changes the count.
 *
 * USAGE
 *   node scripts/check-photo-ratchet.mjs                  # verify (build gate)
 *   node scripts/check-photo-ratchet.mjs --raise          # raise the floor after adding photos
 *   node scripts/check-photo-ratchet.mjs --accept-removal <slug>   # deliberate deletion
 *   node scripts/check-photo-ratchet.mjs --json
 */

import fs from 'node:fs';
import path from 'node:path';

const REPO = process.cwd();
const PEOPLE_JSON = path.join(REPO, 'src', 'data', 'people.json');
const FLOOR_PATH = path.join(REPO, 'scripts', 'photo-floor.json');

const args = process.argv.slice(2);
const RAISE = args.includes('--raise');
const JSON_OUT = args.includes('--json');
const acceptIdx = args.indexOf('--accept-removal');
const ACCEPT = acceptIdx >= 0 ? args[acceptIdx + 1] : null;

const people = JSON.parse(fs.readFileSync(PEOPLE_JSON, 'utf8'));

/** Unique photo count for one profile. */
function countPhotos(p) {
  const seen = new Set();
  for (const im of p.images || []) {
    const f = typeof im === 'string' ? im : im?.filename || im?.src;
    if (f) seen.add(path.basename(f));
  }
  if (p.person_photo) {
    const f = typeof p.person_photo === 'string' ? p.person_photo : p.person_photo?.filename;
    if (f) seen.add(path.basename(f));
  }
  return seen.size;
}

const current = {};
let totalPhotos = 0;
for (const p of people) {
  const n = countPhotos(p);
  if (n > 0) current[p.slug] = n;
  totalPhotos += n;
}

let floor = { _comment: '', total: 0, profiles: {} };
if (fs.existsSync(FLOOR_PATH)) {
  floor = JSON.parse(fs.readFileSync(FLOOR_PATH, 'utf8'));
}
const previous = floor.profiles || {};

// ── verify: any profile below its committed floor is a LOSS ────────────────
const losses = [];
for (const [slug, was] of Object.entries(previous)) {
  const now = current[slug] || 0;
  if (now < was) losses.push({ slug, was, now });
}

// ── also ratchet the global total, which catches a loss from a profile that   ─
// vanished from people.json entirely (a deleted page drops its photos too).
const totalLoss = previous && floor.total ? totalPhotos < floor.total : false;

const out = {
  ok: losses.length === 0 && !totalLoss,
  mode: ACCEPT ? 'accept-removal' : RAISE ? 'raise' : 'verify',
  profiles_tracked: Object.keys(previous).length,
  profiles_with_photos: Object.keys(current).length,
  total_photos: totalPhotos,
  floor_total: floor.total || 0,
  losses,
  total_loss: totalLoss ? { floor: floor.total, now: totalPhotos } : null,
};

if (RAISE) {
  // Only ever raise: a normal --raise must not quietly lower an existing floor.
  const next = { ...previous };
  for (const [slug, n] of Object.entries(current)) next[slug] = Math.max(next[slug] || 0, n);
  const nextTotal = Math.max(floor.total || 0, totalPhotos);
  fs.writeFileSync(
    FLOOR_PATH,
    JSON.stringify(
      {
        _comment:
          'Photo ratchet floor for telfer-wiki. Photos may be ADDED freely; a profile ' +
          'below its number here means a photo was silently lost. Raise with ' +
          '"node scripts/check-photo-ratchet.mjs --raise". Lower ONLY deliberately, with ' +
          '"--accept-removal <slug>", so the removal is recorded in a commit message.',
        raised: new Date().toISOString(),
        total: nextTotal,
        profiles: Object.fromEntries(Object.entries(next).sort()),
      },
      null,
      1
    ) + '\n'
  );
  console.log(
    `🖼️  photo-ratchet: floor raised — ${Object.keys(next).length} profiles / ${nextTotal} photos`
  );
  process.exit(0);
}

if (ACCEPT) {
  if (!previous[ACCEPT]) {
    console.error(`🖼️  photo-ratchet: ${ACCEPT} is not in the floor — nothing to lower.`);
    process.exit(1);
  }
  const now = current[ACCEPT] || 0;
  if (now >= previous[ACCEPT]) {
    console.error(
      `🖼️  photo-ratchet: ${ACCEPT} currently has ${now}, floor is ${previous[ACCEPT]} — nothing to lower.`
    );
    process.exit(1);
  }
  const next = { ...previous, [ACCEPT]: now };
  if (now === 0) delete next[ACCEPT];
  const nextTotal = Object.values(next).reduce((a, b) => a + b, 0);
  fs.writeFileSync(
    FLOOR_PATH,
    JSON.stringify(
      {
        _comment: fs.existsSync(FLOOR_PATH)
          ? JSON.parse(fs.readFileSync(FLOOR_PATH, 'utf8'))._comment
          : 'Photo ratchet floor.',
        raised: new Date().toISOString(),
        total: nextTotal,
        profiles: Object.fromEntries(Object.entries(next).sort()),
      },
      null,
      1
    ) + '\n'
  );
  console.log(`🖼️  photo-ratchet: ${ACCEPT} floor lowered ${previous[ACCEPT]} → ${now} (acceptance recorded).`);
  process.exit(0);
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(out, null, 1));
  process.exit(out.ok ? 0 : 1);
}

if (out.ok) {
  console.log(
    `🖼️  photo-ratchet: OK — ${out.profiles_with_photos} profiles carry ${totalPhotos} photos; no profile is below its floor (${previous ? out.profiles_tracked : 0} tracked).`
  );
  process.exit(0);
}

console.error('🖼️  photo-ratchet FAILED — photo(s) went MISSING. Nothing is broken; there is simply less than before.');
for (const l of losses) {
  console.error(`    ❌ ${l.slug}: had ${l.was} photo(s), now ${l.now} — ${l.was - l.now} lost`);
}
if (out.total_loss) {
  console.error(`    ❌ SITE TOTAL: floor ${out.total_loss.floor}, now ${out.total_loss.now} — photos left the site entirely.`);
}
console.error('\n  FIX: restore the ![[...]] embed and/or the images[] entry in the vault note.');
console.error('  If the removal was DELIBERATE, record it:');
console.error('    node scripts/check-photo-ratchet.mjs --accept-removal <slug>');
console.error('  then commit with a message saying which photo and why.');
process.exit(1);
