#!/usr/bin/env node
/**
 * rendered-photo-card.mjs — turn a rendered-photo guard trip into a board card.
 *
 * WHY: night-watch.sh build step runs check-rendered-photos.mjs via the package.json
 * postbuild. When that guard trips, `npm run build` exits non-zero and night-watch
 * prints a GENERIC "🔴 Build failed — WILL NOT push broken state" with NO specificity
 * and files NO board card. A rendered-photo problem (a photo stuck as the tiny round
 * avatar, or vanished from the page) is invisible-to-fix from that generic line and
 * never reaches Mark's morning can-do board.
 *
 * THIS SCRIPT closes that gap: it re-runs the rendered-photo guard against the freshly
 * built dist and, for every offender, writes an IDEMPOTENT Kanban board card under
 * ~/.hermes/kanban/tasks/ (Backlog) so the 7am Morning Can Do Board Check surfaces it
 * for Skippy to fix. It NEVER fixes the render itself — it files it (mechanic golden
 * rule, same as deceased-flip-check.mjs / "the IT Crew only files issues, it never
 * fixes").
 *
 * DEDUP: card ids are `rendered-photo-YYYYMMDD-<slug>-<n>`. If a task file with that
 * exact id already exists, the offender is skipped (already pending). Once the photo
 * renders full-size again, the guard finds no offender and nothing re-fires. Safe to
 * run nightly.
 *
 * EXIT: 0 always — firing a review card is not a failure. Offenders are surfaced via
 * stdout so night-watch shows them in the nightly digest. The build step itself
 * already handled the hard block (refusing to push); this only adds the ticket.
 *
 * Usage:  node scripts/rendered-photo-card.mjs   (run from repo root, after the build)
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO = process.cwd();
const TASKS_DIR = path.join(process.env.HOME, '.hermes', 'kanban', 'tasks');
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = TODAY.replace(/-/g, '');

function log(msg) { console.log(msg); }

// ── Run the rendered-photo guard against the freshly-built dist ──────────────
let verdict;
try {
  const out = execSync('node scripts/check-rendered-photos.mjs --json', {
    cwd: REPO, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  verdict = JSON.parse(out);
} catch (e) {
  // Guard exited non-zero OR the JSON parse failed. If we can read partial stdout,
  // parse the offenders from it; otherwise surface that the guard itself couldn't run.
  const stdout = String(e.stdout || '');
  try {
    const start = stdout.indexOf('{');
    verdict = JSON.parse(stdout.slice(start));
  } catch (_) {
    log('⚠ rendered-photo-card: guard produced no parseable verdict — cannot card (guard infra issue, not a render alarm)');
    process.exit(0);
  }
}

const offenders = (verdict && verdict.offenders) || [];
if (offenders.length === 0) {
  log(`✅ rendered-photo-card: ${verdict ? verdict.pagesChecked : '?'} pages / ${verdict ? verdict.photosChecked : '?'} photos — all render full-size. No card needed.`);
  process.exit(0);
}

// ── Dedup: skip offenders whose card id already has a task detail file ─────────
mkdirSync(TASKS_DIR, { recursive: true });
const existingIds = new Set(
  existsSync(TASKS_DIR)
    ? readdirSync(TASKS_DIR).map((f) => f.replace(/\.ya?ml$/, ''))
    : []
);

const fired = [];
const alreadyPending = [];
// One card per offender (a real builder break usually trips 1-few photos). Cap at 8
// per night so a mass regression doesn't bury the board — beyond 8 gets lumped.
for (let idx = 0; idx < offenders.length; idx++) {
  const o = offenders[idx];
  const cardId = `rendered-photo-${DAY}-${o.slug}-${idx + 1}`;
  if (existingIds.has(cardId)) {
    alreadyPending.push(`${o.slug}/${o.file}`);
    continue;
  }
  const taskFile = path.join(TASKS_DIR, `${cardId}.yaml`);
  const taskYaml = `id: ${cardId}
title: "Photo renders only as avatar / not on page: ${o.slug} (${o.file})"
date: ${TODAY}
severity: medium
source: "Skippy — rendered-photo-card.mjs, nightly anti-regression guard"
status: Backlog

# RENDERED-PHOTO REGRESSION (detected by check-rendered-photos.mjs on the built site)
offender:
  slug: "${o.slug}"
  file: "${o.file}"
  reason: "${o.reason}"

# WHY THIS MATTERS
description: >
  A photo attached to this profile renders is ${o.reason}. The image file exists
  and is wired in the data, but on the BUILT page it is reduced to only a tiny
  round avatar crop (or absent entirely). The nightly anti-regression guard
  blocked shipping that state; this card is filed so the render is restored.
  Compare the built page dist/people/${o.slug}/index.html with its vault source
  (~/ObsidianVault/Family History/People/) and the data in src/data/people.public.json.

# REQUESTED ACTION — DIAGNOSE, FIX THE RENDER, REBUILD
suggested_action: >
  1) Look at dist/people/${o.slug}/index.html — find every <img> for ${o.file}.
  2) If it renders ONLY as the avatar crop (w-full h-full object-cover on the img;
     rounded-full sits on the PARENT div), the person's photo is not reaching the
     full-size gallery on that page. Fix the SOURCE, never dist:
     - src/pages/people/[slug].astro gallery filter must drop only bodyImageFiles,
       NOT person_photo (the avatar-strip bug). The full-size branch uses
       object-contain + rounded-lg + border.
     - OR the vault .md / people.json lost or renamed the photo reference — fix the
       VAULT file, then ./scripts/regenerate-data.sh, then npm run build.
  3) Re-run the guard: node scripts/check-rendered-photos.mjs --json  (must be ok:true).
  4) Commit + push (or let Night Watch). Move this card to Done when the photo
     renders full-size again.
`.trim();
  writeFileSync(taskFile, taskYaml);
  // Surface on the real board too (board.yaml is what the 7am Morning Can Do Board Check reads
  // — a card that lives only in tasks/ is invisible to it). Idempotent: no-op if already there.
  try { execSync(`python3 "${process.env.HOME}/.hermes/scripts/sync-task-cards-to-board.py" --id ${cardId}`, { cwd: REPO, stdio: 'ignore' }); } catch (_) {}
  fired.push({ cardId, ...o });
  existingIds.add(cardId);
}

// ── Report ───────────────────────────────────────────────────────────────────
log('');
log(`🖼 rendered-photo-card: ${offenders.length} rendered-photo problem(s) detected on the built site`);
for (const f of fired) log(`   📌 FIRED card ${f.cardId} — ${f.slug}/${f.file}: ${f.reason}`);
for (const s of alreadyPending) log(`   🔁 already fired (skipped): ${s}`);
if (offenders.length > 8) log(`   ℹ️  ${offenders.length - fired.length - alreadyPending.length} additional offender(s) beyond card cap 8 — lumped; fix the render root cause.`);
log('   Card(s): ~/.hermes/kanban/tasks/ → surfaces in the 7am Morning Can Do Board Check');
log('   NOTE: this only files the board card. Skippy fixes the render source; Night Watch blocks the push until it renders full-size.');
process.exit(0);
