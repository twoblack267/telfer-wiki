#!/usr/bin/env node
/**
 * night-watch-fallback-card.mjs — LAST-RESORT card filer for Night Watch.
 *
 * WHY THIS EXISTS (2026-10-25)
 * night-watch.sh files its consolidated blocker card at STEP 9, near the end.
 * Three failure modes die BEFORE step 9 is ever reached, so no card is filed,
 * no board row appears, and Mark's 7am Morning Can Do Board Check sees nothing:
 *
 *   1. Repo dir missing          (night-watch.sh line ~20, `exit 1`)
 *   2. /usr/bin/python3 lacks PyYAML (line ~33, `exit 1`) — the 2026-10-16 failure
 *   3. Script killed / crashes hard before step 9 (OOM, timeout, unhandled throw)
 *
 * Modes 1 and 2 are the dangerous ones: they are DETERMINISTIC environment
 * faults that will fail identically every night until a human fixes the box.
 * Silence is the worst possible response to them.
 *
 * WHAT IT DOES
 * Reads the outcome of the Night Watch run from the wrapper's environment and,
 * if the run did not reach a clean success, files ONE can-do board card so the
 * problem survives to the 7am reader even when Night Watch could not speak for
 * itself. Writes nothing at all on a clean pass.
 *
 * IDEMPOTENT: card id is `night-watch-fallback-YYYYMMDD`. One per day. If the
 * card already exists this run, it notes the repeat instead of minting a twin.
 *
 * EXIT: always 0. Filing a card is not itself a failure; this must never become
 * a new way for the nightly to die.
 *
 * Usage — from a wrapper, AFTER the night-watch.sh call:
 *   bash scripts/night-watch.sh .; RC=$?
 *   NW_EXIT="$RC" node scripts/night-watch-fallback-card.mjs --stage "night-watch.sh"
 *
 * Env:
 *   NW_EXIT   exit code of the run (defaults to 0 = nothing to do)
 *   NW_STAGE  human label for where it died (default "night-watch.sh")
 *   NW_ERR    optional one-line error text to embed verbatim
 *
 * Pure Node stdlib. No PyYAML, no npm, no network — deliberately, because this
 * runs precisely when the normal toolchain is broken.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME || '/Users/marktelfer';
const KANBAN = path.join(HOME, '.hermes', 'kanban');
const TASKS_DIR = path.join(KANBAN, 'tasks');
// BOARD_FILE deliberately unused: board.yaml is only ever written by
// sync-task-cards-to-board.py. Kept as a comment so nobody re-adds string surgery.

const RAW_EXIT = (process.env.NW_EXIT ?? '0').trim();
const STAGE = (process.env.NW_STAGE || 'night-watch.sh').trim();
const ERR = (process.env.NW_ERR || '').trim().replace(/\s+/g, ' ').slice(0, 400);

const argStage = process.argv.indexOf('--stage');
const stageLabel = argStage !== -1 ? process.argv[argStage + 1] : STAGE;

// Only act on a non-zero exit. Anything else and we stay silent.
const rc = Number.parseInt(RAW_EXIT, 10);
if (!Number.isNaN(rc) && rc === 0) {
  console.log('✅ night-watch-fallback-card: run exited 0 — no fallback card needed.');
  process.exit(0);
}

// LOCAL date, not UTC. AEST is UTC+10, so toISOString() dates every card filed
// between 00:00 and 10:00 local to the PREVIOUS day — which is exactly when the
// nightly runs. Caught in test: a 03:00 run on the 25th produced card ...20261024.
const today = new Date();
const localISO = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const TODAY_STR = localISO(today);
const DAY = TODAY_STR.replace(/-/g, '');
const cardId = `night-watch-fallback-${DAY}`;

mkdirSync(TASKS_DIR, { recursive: true });

// ── Already filed by Night Watch itself? Then we are redundant. ─────────────
// night-watch.sh files a DETAILED card (night-watch-issue-YYYYMMDD-N naming the
// exact blockers) at its step 9. That card is strictly better than this
// fallback. Firing ours too would put two cards for one night in front of Mark
// at 7am — noise that trains him to ignore the board.
// So: if any night-watch-issue-YYYYMMDD-* card exists for today, stand down.
// We only exist for the nights where Night Watch DIED BEFORE step 9.
if (existsSync(TASKS_DIR)) {
  const todaysDetailed = readdirSync(TASKS_DIR).some(
    (f) => f.startsWith(`night-watch-issue-${DAY}-`) && /\.ya?ml$/.test(f),
  );
  if (todaysDetailed) {
    console.log(
      `✅ night-watch-fallback-card: night-watch.sh already filed its detailed ` +
        `night-watch-issue-${DAY}-* card for today — fallback standing down (no duplicate).`,
    );
    process.exit(0);
  }
}

// ── Already filed today? Note the repeat, never mint a twin. ────────────────
if (existsSync(TASKS_DIR)) {
  const existing = readdirSync(TASKS_DIR).map((f) => f.replace(/\.ya?ml$/, ''));
  if (existing.includes(cardId)) {
    // Append a repeat line to the existing task file (plain text append is safe).
    const tf = path.join(TASKS_DIR, `${cardId}.yaml`);
    try {
      const prev = readFileSync(tf, 'utf8');
      const stamp = today.toISOString();
      writeFileSync(tf, `${prev}\n# REPEAT ${stamp} — ${stageLabel} exited ${RAW_EXIT}${ERR ? `: ${ERR}` : ''}\n`);
      console.log(`📌 Fallback card ${cardId} already exists — noted repeat at ${stamp}.`);
    } catch (e) {
      console.error(`🟡 Could not annotate existing card ${cardId}: ${String(e.message || e).slice(0, 200)}`);
    }
    process.exit(0);
  }
}

const detail = `${stageLabel} exited ${RAW_EXIT}${ERR ? ` — ${ERR}` : ''}`;

const taskYaml = `id: ${cardId}
title: "Night Watch died before it could file a card — ${detail}"
date: ${TODAY_STR}
severity: high
source: "Skippy — night-watch-fallback-card.mjs (last-resort broadcast)"
status: Backlog

# NIGHT WATCH DID NOT COMPLETE
blocked_by: "${detail}"
night_output: "No consolidated card was filed by night-watch.sh — this fallback fired BECAUSE the run died early."

description: >
  Night Watch exited non-zero BEFORE reaching its consolidated blocker-card step,
  so the normal 'night-watch-issue-*' card was never filed. This fallback exists
  so the failure still reaches the 7am Morning Can Do Board Check instead of
  vanishing silently. The most common causes are deterministic environment
  faults that will recur every night until fixed: the telfer-wiki repo directory
  missing, /usr/bin/python3 missing PyYAML (the 2026-10-16 fault), or the script
  being killed by an OOM / timeout / unhandled crash.

suggested_action: >
  1) Reproduce by hand and read the real output: cd ~/telfer-wiki && bash scripts/night-watch.sh .
  2) If it dies immediately with "repo dir not found" — the checkout is missing
     or moved. Restore it; do not create an empty directory.
  3) If it dies with "python3 lacks PyYAML" — /usr/bin/python3 has lost PyYAML,
     which the script treats as FATAL on purpose (a PyYAML-less interpreter
     reports every profile as a false contradiction). Reinstall it:
     /usr/bin/python3 -m pip install --user PyYAML , then re-run.
  4) If it was killed (137 / OOM / timeout) — check memory pressure and the
     runtime logs in ~/telfer-wiki/runtime/.
  5) Only move this card to Done when a hand-run reaches
     "◼ NIGHT WATCH COMPLETE — ALL CLEAR" (exit 0).
`.trim();

const taskFile = path.join(TASKS_DIR, `${cardId}.yaml`);
writeFileSync(taskFile, taskYaml + '\n');

// ── Surface on board.yaml so the 7am reader actually sees it ────────────────
// CRITICAL LESSON (2026-10-25): the first version of this file hand-appended a
// YAML row to board.yaml by string surgery, inserting after the first line
// containing the word "Backlog". That inserted our row between `- name: Backlog`
// and `tasks:` and CORRUPTED the whole board — 534 cards unparseable, caught
// only when board-set.py refused to run. Never hand-edit a shared YAML board.
//
// The board has exactly one blessed writer: sync-task-cards-to-board.py, which
// takes the lock, appends a correctly-shaped row, and validates the parse. We
// delegate to it. If it cannot run (it needs python3 + PyYAML, which may be
// precisely what is broken) we degrade to task-file-only: the 7am reader also
// reads tasks/ via that same sync, so the card still surfaces on the next sync.
// A missing board row is recoverable; a corrupted board is not.
const SYNC = path.join(HOME, '.hermes', 'scripts', 'sync-task-cards-to-board.py');
try {
  if (existsSync(SYNC)) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync('/usr/bin/python3', [SYNC], { encoding: 'utf8', timeout: 60_000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    if (r.status === 0) {
      console.log(`   ✅ Board synced via sync-task-cards-to-board.py — 7am reader will surface it.`);
    } else {
      console.error(`🟡 Board sync exited ${r.status} — card is in tasks/ and will surface on next sync.`);
      if (out) console.error(`   ${out.split('\n').slice(-3).join('\n   ')}`);
    }
  } else {
    console.error(`🟡 sync-task-cards-to-board.py not found — card is in tasks/ only.`);
  }
} catch (e) {
  console.error(`🟡 Board sync could not run: ${String(e.message || e).slice(0, 200)}`);
  console.error(`   Card is in tasks/ and will surface on the next successful sync.`);
}

console.log(`📌 FIRED fallback card ${cardId} — ${detail}`);
console.log(`   Card: ~/.hermes/kanban/tasks/${cardId}.yaml`);
process.exit(0);
