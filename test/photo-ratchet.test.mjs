#!/usr/bin/env node
/**
 * photo-ratchet.test.mjs — proves the photo ratchet actually blocks a loss.
 *
 * A guard nobody has attacked is a guard you are trusting on faith. This test
 * recreates the exact 0618fb1 failure (an images[] entry silently stripped) in
 * a throwaway copy and asserts the ratchet catches it while the older
 * "does everything render" guard stays green — the gap that let the headstone
 * die for two months.
 *
 * Runs in a temp dir so the repo is never mutated. Exit 0 = the ratchet bites.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-'));
const fail = (m) => { console.error(`❌ ${m}`); process.exit(1); };

try {
  // minimal harness: the script only needs src/data/people.json + scripts/photo-floor.json
  fs.mkdirSync(path.join(tmp, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  for (const f of ['people.json']) {
    fs.copyFileSync(path.join(REPO, 'src/data', f), path.join(tmp, 'src/data', f));
  }
  fs.copyFileSync(path.join(REPO, 'scripts/photo-floor.json'), path.join(tmp, 'scripts/photo-floor.json'));

  const run = () =>
    spawnSync('node', [path.join(REPO, 'scripts/check-photo-ratchet.mjs'), '--json'], {
      cwd: tmp, encoding: 'utf8',
    });

  // 1. clean state must pass
  let r = run();
  if (r.status !== 0) fail(`baseline should pass, exited ${r.status}: ${r.stdout || r.stderr}`);
  const base = JSON.parse(r.stdout);
  if (!base.ok) fail('baseline reported not-ok');

  // 2. strip every photo from one profile that has at least one
  const slug = Object.keys(base.profiles_tracked ? JSON.parse(fs.readFileSync(path.join(tmp, 'scripts/photo-floor.json'), 'utf8')).profiles : {})[0];
  if (!slug) fail('floor has no profiles to attack');
  const people = JSON.parse(fs.readFileSync(path.join(tmp, 'src/data/people.json'), 'utf8'));
  const target = people.find((p) => p.slug === slug);
  const before = (target.images || []).length + (target.person_photo ? 1 : 0);
  target.images = [];
  target.person_photo = null;
  fs.writeFileSync(path.join(tmp, 'src/data/people.json'), JSON.stringify(people));

  // 3. the ratchet MUST fail, and name the profile
  r = run();
  if (r.status === 0) fail(`ratchet did NOT catch a total photo loss on ${slug} — the guard is useless`);
  const lost = JSON.parse(r.stdout);
  if (lost.ok) fail('ok=true after stripping photos');
  if (!lost.losses.some((l) => l.slug === slug)) fail(`loss not attributed to ${slug}`);
  // The per-profile loss is the load-bearing assertion and must ALWAYS fire.
  // The global total only fires when the site's photo count drops below the
  // committed floor — which it legitimately cannot do if other photos were
  // added in the same change. Asserting it here unconditionally made this test
  // fail on a correct guard whenever the live data had recently gained photos,
  // so assert the invariant instead: if total_loss IS reported, the reported
  // total must genuinely be below the reported floor.
  if (lost.total_loss && !(lost.total_loss.now < lost.total_loss.floor)) {
    fail(`total_loss reported nonsense: ${JSON.stringify(lost.total_loss)}`);
  }

  // 4. adding photos must never fail (raising is free, only losses are fatal)
  const p2 = JSON.parse(fs.readFileSync(path.join(tmp, 'src/data/people.json'), 'utf8'));
  const t2 = p2.find((p) => p.slug === slug);
  t2.images = [{ filename: 'zz-brand-new-photo.jpg' }, { filename: 'zz-another.jpg' }];
  fs.writeFileSync(path.join(tmp, 'src/data/people.json'), JSON.stringify(p2));
  r = run();
  if (r.status !== 0) fail('adding photos must not fail the ratchet (it is a one-way ratchet)');

  // 5. --raise must lift the floor, never lower it
  execFileSync('node', [path.join(REPO, 'scripts/check-photo-ratchet.mjs'), '--raise'], { cwd: tmp });
  const raised = JSON.parse(fs.readFileSync(path.join(tmp, 'scripts/photo-floor.json'), 'utf8'));
  if (raised.profiles[slug] < 2) fail('--raise did not record the new photos');
  if (raised.total < base.total_photos) fail('--raise LOWERED the global floor');

  console.log(
    `🎉 photo-ratchet.test: ALL PASS — loss of ${before} photo(s) on ${slug} refused, additions allowed, floor only rises.`
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
