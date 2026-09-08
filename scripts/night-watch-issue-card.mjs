#!/usr/bin/env node
/**
 * night-watch-issue-card.mjs — file ONE can-do-board card when Night Watch is blocked.
 *
 * WHY: Night Watch blocks a broken push on many classes of hard failure — vault regen
 * failed, image-integrity blockers, data-truth violations (false death), self-heal
 * needing Mark's decision, a failed build, a failed git push, broken live links, or a
 * visual flyby problem. Until now each of those printed a 🔴 line + blocked the push +
 * pinged Mark raw on Telegram, but filed NO reusable board card — so if he missed the
 * message the problem vanished. (Only two checks — deceased-flip 2d and rendered-photo
 * 3b — filed their own purpose-built cards.)
 *
 * THIS closes that gap: a single consolidated step near the end of night-watch.sh reads
 * the final $FAIL / $BLOCK_PUSH state and writes ONE catch-all Backlog card summarising
 * every blocker, pointing to the runtime logs. Robust: it lives in ONE place so it can
 * never miss a failure branch, and it automatically covers any future failure class
 * night-watch adds. The detailed Telegram digest still lands each night; this card makes
 * the problem ALSO survive to Mark's 7am Morning Can Do Board Check.
 *
 * DEDUP (idempotent): card id `night-watch-issue-YYYYMMDD-<n>`. Night Watch runs once
 * nightly, so one card per failed night. When the issues are resolved and a later run
 * is ALL CLEAR, no card is written. Requires $RUN_DIR to exist for the log pointer.
 *
 * EXIT: 0 always — filing a card is not itself a failure.
 *
 * Usage (from repo root, AFTER the build so $RUN_DIR exists, also after git push step so
 * a push failure is in $FAIL):
 *   FAIL="build data-truth:2" node scripts/night-watch-issue-card.mjs \
 *       --run-dir "$RUN_DIR"
 * Reads env: FAIL (space-separated blocker tokens), BLOCK_PUSH, and --run-dir.
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const TASKS_DIR = path.join(process.env.HOME, '.hermes', 'kanban', 'tasks');
const TODAY = new Date().toISOString().slice(0, 10);
const DAY = TODAY.replace(/-/g, '');

const argRunDir = process.argv.indexOf('--run-dir');
const RUN_DIR = argRunDir !== -1
  ? process.argv[argRunDir + 1]
  : path.join(process.env.HOME, 'telfer-wiki', 'runtime');

const FAIL = (process.env.FAIL || '').trim();
const BLOCK = process.env.BLOCK_PUSH === '1';

if (!FAIL && !BLOCK) {
  console.log('✅ night-watch-issue-card: Night Watch ALL CLEAR — no card needed.');
  process.exit(0);
}

function log(msg) { console.log(msg); }

mkdirSync(TASKS_DIR, { recursive: true });
const existingIds = new Set(
  existsSync(TASKS_DIR)
    ? readdirSync(TASKS_DIR).map((f) => f.replace(/\.ya?ml$/, ''))
    : []
);

const blockers = FAIL.split(/\s+/).filter(Boolean);

// One card per failed night. Cap the visual indent, keep it to a single clear ticket.
let n = 1;
let cardId = `night-watch-issue-${DAY}-${n}`;
while (existingIds.has(cardId)) { n++; cardId = `night-watch-issue-${DAY}-${n}`; }

const details = blockers.length
  ? blockers.join(', ')
  : 'Night Watch set BLOCK_PUSH (a check blocked shipping this state)';

const taskFile = path.join(TASKS_DIR, `${cardId}.yaml`);
const taskYaml = `id: ${cardId}
title: "Night Watch BLOCKED — issues: ${details}"
date: ${TODAY}
severity: medium
source: "Skippy — night-watch.sh consolidated blocker card"
status: Backlog

# NIGHT WATCH WAS BLOCKED (a rebuild could not be shipped)
blocked_by: "${details}"
night_output: "See the Telegram digest + runtime logs in ${RUN_DIR}/ (nw-*.log)"

# WHY THIS MATTERS
description: >
  Night Watch ran all its health checks and one or more HARD failures set BLOCK_PUSH —
  meaning a broken or unverified state was NOT committed/pushed to the live site (the
  push was intentionally stopped). This card ensures the problem survives to Mark's 7am
  brief even if the Telegram digest scrolls past. Specific failure classes (rendered
  photos, a living-to-deceased flip) file their own targeted cards; this is the
  catch-all for anything else that blocked the night.

# REQUESTED ACTION — OPEN THE DIGEST, FIX THE BLOCKER, RE-RUN
suggested_action: >
  1) Open the Night Watch digest/Telegram alert — it names each blocker verbatim.
  2) For each token in the list above, resolve the underlying cause (regen = vault sync;
     data-truth = a living/deceased or lifespan inconsistency; image-integrity = a photo
     that would drop; build = a compile/postbuild guard failure incl. the rendered-photo
     or layout guards; push = git remote failure; broken-links = live 404s; flyby = a page
     that failed the visual check). REAL diagnosis only — never guess.
  3) Fix at the SOURCE (vault .md or repo src/), never hand-edit generated JSON or dist.
  4) Re-run Night Watch: bash scripts/night-watch.sh . Only move this card to Done when
     it comes back ALL CLEAR (exit 0).
`.trim();

writeFileSync(taskFile, taskYaml);
log(`📌 FIRED card ${cardId} — Night Watch blocked on: ${details}`);
log(`   Card: ~/.hermes/kanban/tasks/${cardId}.yaml → surfaces in the 7am Morning Can Do Board Check`);
process.exit(0);
