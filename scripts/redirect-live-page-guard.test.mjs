#!/usr/bin/env node
/**
 * redirect-live-page-guard.test.mjs — tw-2026-09-19-001
 *
 * REGRESSION TEST. The bug this pins down:
 *
 *   Francis Charles Telfer (b.1875) holds the canonical slug `francis-telfer-1875`.
 *   Francis Adam Telfer   (b.1875) collides on first+last+birth_year.
 *   generate-redirects.mjs computed Adam's "old slug" as `francis-telfer-1875`
 *   and emitted a meta-refresh alias OVER Charles's live page, sending visitors
 *   to the WRONG PERSON. Same for `james-telfer-1866` (James Robert Telfer's
 *   alias replaced James Telfer's page).
 *
 *   It returned HTTP 200 the whole time. No 404 probe, no link checker, and no
 *   live-slug-regression run can see it, because nothing is missing — something
 *   is WRONG. That is why this test asserts on the emitted alias set directly.
 *
 * HOW IT RUNS: offline, in a temp dir, with a synthetic people.json. It does NOT
 * touch the real dist/ or the real redirect-log.json, so it is safe on any path
 * (including the nightly regen) and cannot dirty the working tree.
 *
 * Exit 0 = guard holds. Exit 1 = a live page is being hijacked again.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const EMITTER = path.join(REPO, 'scripts', 'generate-redirects.mjs');

// ── Synthetic fixture ────────────────────────────────────────────────────────
// Deliberately minimal and self-contained: two live pages + the two colliding
// namesakes that caused the real incident. If the guard is removed, these
// collisions reproduce the original damage exactly.
const PEOPLE = [
  {
    slug: 'francis-telfer-1875',
    first_name: 'Francis',
    last_name: 'Telfer',
    birth_year: 1875,
    death_year: 1954,
    display_name: 'Francis Charles Telfer'
  },
  {
    slug: 'francis-adam-telfer-1875',
    first_name: 'Francis',
    last_name: 'Telfer',
    birth_year: 1875,
    death_year: 1955,
    display_name: 'Francis Adam Telfer'
  },
  {
    slug: 'james-telfer-1866',
    first_name: 'James',
    last_name: 'Telfer',
    birth_year: 1866,
    death_year: 1946,
    display_name: 'James Telfer'
  },
  {
    slug: 'james-robert-telfer-1866',
    first_name: 'James',
    last_name: 'Telfer',
    birth_year: 1866,
    death_year: 1925,
    display_name: 'James Robert Telfer'
  }
];

// Slugs that MUST NEVER appear as the origin of a redirect, because they are
// live pages. Hardcoded on purpose — if the fixture changes, this assertion
// should be revisited deliberately, not silently satisfied.
const LIVE_PAGES = [
  'francis-telfer-1875',
  'francis-adam-telfer-1875',
  'james-telfer-1866',
  'james-robert-telfer-1866'
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redirect-guard-test-'));
let failures = [];

try {
  fs.mkdirSync(path.join(tmp, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'src', 'data', 'people.json'),
    JSON.stringify(PEOPLE, null, 2)
  );

  // dist/ is ABSENT on purpose. With no built pages, the existingPages filter
  // cannot mask the bug — the emitter must rely on its own guard. This is the
  // harshest realistic condition and the one that shipped the incident.
  const stdout = execFileSync('node', [EMITTER], {
    cwd: tmp,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logPath = path.join(tmp, 'scripts', 'redirect-log.json');
  if (!fs.existsSync(logPath)) {
    throw new Error('emitter did not write scripts/redirect-log.json');
  }
  const emitted = JSON.parse(fs.readFileSync(logPath, 'utf-8'));

  // ── ASSERTION 1: no emitted redirect originates from a live page ──────────
  const hijacks = emitted.filter(r => LIVE_PAGES.includes(r.from));
  if (hijacks.length > 0) {
    failures.push(
      `ASSERTION 1 FAILED — ${hijacks.length} redirect(s) originate from a LIVE page:`
    );
    for (const h of hijacks) {
      failures.push(`    ${h.from} → ${h.to}  (${h.display_name})`);
    }
  } else {
    console.log(`OK — assertion 1: no live page is a redirect origin (${emitted.length} alias(es) emitted)`);
  }

  // ── ASSERTION 2: the guard reports what it suppressed ────────────────────
  if (!stdout.includes('SUPPRESSED')) {
    failures.push(
      'ASSERTION 2 FAILED — guard reported nothing suppressed. Either the guard ' +
      'did not engage, or it failed silently. A silent guard cannot be trusted.'
    );
  } else {
    const m = stdout.match(/SUPPRESSED (\d+) redirect/);
    console.log(`OK — assertion 2: guard announced suppression (${m ? m[1] : '?'} suppressed)`);
  }

  // ── ASSERTION 3: the two real people still own their URLs ────────────────
  for (const slug of ['francis-telfer-1875', 'james-telfer-1866']) {
    const stolen = emitted.find(r => r.from === slug);
    if (stolen) {
      failures.push(
        `ASSERTION 3 FAILED — ${slug} was emitted as an alias to ${stolen.to}. ` +
        `That page belongs to a real person and must keep its own URL.`
      );
    }
  }
  if (!failures.some(f => f.startsWith('ASSERTION 3'))) {
    console.log('OK — assertion 3: both hijacked people keep their own URLs');
  }

} catch (err) {
  failures.push(`TEST ERROR — ${err.message}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('\n❌ REDIRECT LIVE-PAGE GUARD: FAILED  [tw-2026-09-19-001]');
  for (const f of failures) console.error('  ' + f);
  console.error(
    '\n  A live profile page is being replaced by a redirect to a DIFFERENT person.\n' +
    '  This is a silent wrong-person 200 — no 404 will ever reveal it.\n' +
    '  Fix the guard in scripts/generate-redirects.mjs; do NOT weaken this test.\n'
  );
  process.exit(1);
}

console.log('\n✅ REDIRECT LIVE-PAGE GUARD: PASSED  [tw-2026-09-19-001]');
process.exit(0);
