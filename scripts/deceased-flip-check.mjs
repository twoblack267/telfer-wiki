#!/usr/bin/env node
/**
 * deceased-flip-check.mjs — detect newly-deceased people and fire a Kanban card
 *                            so a human agent reviews and uplifts the profile.
 *
 * WHY: The owner's rule (Mark, Aug 2026) is:
 *   - Living people are private-by-default (keep-list bio).
 *   - The moment someone is deceased, they're "fair game — even if your body is
 *     still warm" and their profile gets FULLY published (bios, story, photos).
 *   - The owner explicitly delegated the living/deceased call to Skippy:
 *     "you decide Skippy whether the dead or alive — leave me out of this."
 *   - It must be SEMI-AUTOMATED: the flip is detected here automatically, but it
 *     fires a KANBAN CARD (Backlog) so a human/physical agent can REVIEW and
 *     correctly uplift the vault profile (add death date, obituary, publish in
 *     full). NEVER auto-publishes a bare flip alone — matching the established
 *     "The IT Crew only files issues, it never fixes" pattern on this board.
 *
 * DETERMINATION (made from the data, no human in the loop):
 *   A person counts as a flip when, comparing git HEAD (last deployed truth) to
 *   the current working-tree people.json (new vault truth) by slug:
 *     - is_living went true -> not-true,  OR
 *     - they gained a death_year (lifespan closed) while previously living.
 *   This is the precise "false-death / newly-deceased" signal the data-truth
 *   gate and self-heal already watch; here we turn it into a review card.
 *
 * DEDUP (idempotent): A card id `deceased-flip-YYYYMMDD-<slug>` is only fired
 *   ONCE — if a task detail file for that id already exists under
 *   ~/.hermes/kanban/tasks/, the flip is already awaiting/past review and the
 *   run is a no-op. Once a human uplifts the vault (removing the flip
 *   condition), future runs won't detect the transition at all, so nothing
 *   re-fires. This makes the script safe to run nightly.
 *
 * EXIT:  0 always (firing a review card is not a failure). Flips are surfaced
 *   via stdout so night-watch can show them in the nightly digest.
 *
 * Usage:  node scripts/deceased-flip-check.mjs   (run from repo root)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO = process.cwd();
const TASKS_DIR = path.join(process.env.HOME, '.hermes', 'kanban', 'tasks');
const TODAY = new Date().toISOString().slice(0, 10);

function log(msg) { console.log(msg); }

// ── Load previous (HEAD) + current people.json ──────────────────────────────
function loadJson(src) {
  let raw;
  if (src.startsWith('git:')) {
    // people.json is ~1.2MB — must raise execSync's default 1MB maxBuffer.
    raw = execSync(`git show ${src.slice(4)}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } else {
    raw = readFileSync(src, 'utf8');
  }
  return JSON.parse(raw);
}

let prev;
try {
  prev = loadJson('git:HEAD:src/data/people.json');
} catch (e) {
  log('⚠ deceased-flip: no committed people.json baseline (first run) — nothing to compare yet');
  process.exit(0);
}
const curr = loadJson(path.join(REPO, 'src', 'data', 'people.json'));

const bySlug = (arr) => new Map(arr.map((p) => [p.slug, p]));
const prevMap = bySlug(prev);
const currMap = bySlug(curr);

// ── Detect flips ─────────────────────────────────────────────────────────────
function isLiving(p) { return p.is_living === true; }
function isDead(p)   { return p.is_living === false || (p.death_year != null); }

const flips = [];
for (const [slug, now] of currMap) {
  const before = prevMap.get(slug);
  if (!before) continue;                        // brand-new person, not a flip
  const wasLiving = isLiving(before);
  const isNowDead = isDead(now);
  const gainedDeath = before.death_year == null && now.death_year != null;
  if (wasLiving && (isNowDead || gainedDeath)) {
    flips.push({
      slug,
      id: now.id || now.display_name || slug,
      vault_file: now.vault_file || '',
      before: { is_living: before.is_living, death_year: before.death_year, lifespan: before.lifespan },
      after:  { is_living: now.is_living,   death_year: now.death_year,   lifespan: now.lifespan },
    });
  }
}

if (flips.length === 0) {
  log(`✅ deceased-flip: no living→deceased transitions (${curr.length} people scanned)`);
  process.exit(0);
}

// ── Dedup: skip flips whose card id already has a task detail file ──────────
mkdirSync(TASKS_DIR, { recursive: true });
const existingIds = new Set(existsSync(TASKS_DIR) ? readdirSync(TASKS_DIR).map((f) => f.replace(/\.ya?ml$/, '')) : []);

const fired = [];
const alreadyPending = [];
for (const f of flips) {
  const cardId = `deceased-flip-${TODAY.replace(/-/g, '')}-${f.slug}`;
  if (existingIds.has(cardId)) {
    alreadyPending.push(f.slug);
    continue;
  }
  const taskFile = path.join(TASKS_DIR, `${cardId}.yaml`);
  const taskYaml = `id: ${cardId}
title: "LIVING → DECEASED transition detected: ${f.id}"
date: ${TODAY}
severity: medium
source: "Skippy — deceased-flip-check.mjs, nightly auto-detection"
status: Backlog

# TRANSITION DETECTED (compare git HEAD vs current vault truth)
transition:
  person_id: "${f.id}"
  slug: "${f.slug}"
  vault_file: "${f.vault_file}"
  before: { is_living: ${f.before.is_living}, death_year: ${f.before.death_year}, lifespan: "${f.before.lifespan}" }
  after:  { is_living: ${f.after.is_living},  death_year: ${f.after.death_year},  lifespan: "${f.after.lifespan}" }

# WHY THIS MATTERS
description: >
  This person was previously recorded as LIVING and has now transitioned to
  DECEASED in the vault data. Per the owner's rule, deceased people are fully
  published (bios, story, photos) — "once you're dead you're fair game even if
  your body is still warm". This is semi-automated: The flip was DETECTED
  automatically, but a HUMAN AGENT must review and correctly uplift the
  profile before it is fully published.

# REQUESTED ACTION — REVIEW, VERIFY, THEN UPLIFT
suggested_action: >
  1) Open the vault file: ${f.vault_file}
  2) Verify the death. If confirmed, ensure the vault records it properly
     (is_living becomes false / death year set / lifespan closed). If NOT
     actually deceased, correct the vault record — this looks like a
     false-death alert and the data-truth gate will keep blocking the build
     until it is fixed.
  3) Once verified deceased, uplift the profile: the living-privacy strip is
     automatically REMOVED on the next deploy (deceased = fully published),
     so add the full bio/story/obituary the person deserves.
  4) Move this card to Done when uplift is complete.
`.trim();
  writeFileSync(taskFile, taskYaml);
  fired.push({ cardId, ...f });
}

// ── Report ───────────────────────────────────────────────────────────────────
log('');
log(`⚠ deceased-flip: ${flips.length} living→deceased transition${flips.length>1?'s':''} detected`);
for (const f of fired) log(`   📌 FIRED card ${f.cardId} — ${f.id}`);
for (const s of alreadyPending) log(`   🔁 already fired for today (skipped): ${s}`);
log(`   Review+uplift task file: ~/.hermes/kanban/tasks/ (written: ${fired.length})`);
log(`   NOTE: this only fires the review card. A human agent uplifts the vault profile.`);
process.exit(0);
