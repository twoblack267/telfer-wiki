#!/usr/bin/env node
/**
 * crown-jewel-alarm.mjs — turn a data-loss regression into a Can Do Board card.
 *
 * Mark's instruction (2026-10-24): "If any of those safety guards fire I wanted to
 * be thrown onto the can do board for the 7 o'clock can do board check."
 *
 * So a guard firing must NOT depend on someone reading a log. It files a card on
 * the Can Do Board, and the 07:00 Morning Can Do Board Check picks it up.
 *
 * DESIGN RULES (learned the hard way on this repo)
 * -----------------------------------------------
 * 1. File ONCE per distinct problem. A nightly job that fails every night must not
 *    produce 30 identical cards. The card key is derived from the failure SET, and
 *    the key of the last filing is recorded. Identical failure set -> no new card.
 * 2. Never report the card as filed without reading the board back and finding the
 *    real ticket id. A filing that cannot be proven did not happen.
 * 3. A guard that cannot run (missing git, unreadable file) is NOT a pass and NOT a
 *    card — it exits 2 so the caller sees the difference between "clean" and "blind".
 * 4. Never auto-fix. This files; Mark and Skippy fix. The vault is the truth and an
 *    automated repair here would be exactly the data loss the guard exists to stop.
 *
 * USAGE
 *   node scripts/crown-jewel-alarm.mjs            # check, file a card if needed
 *   node scripts/crown-jewel-alarm.mjs --dry-run  # check, report, file nothing
 *   node scripts/crown-jewel-alarm.mjs --force    # file even if the key is unchanged
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(HERE, "..");
const HOME = process.env.HOME || "/Users/marktelfer";
const BOARD = resolvePath(HOME, ".hermes/kanban/board.yaml");
const FILER = resolvePath(HOME, ".hermes/scripts/kanban-file-ticket.py");
const STATE_DIR = resolvePath(REPO, "scripts/.guard-evidence");
const STATE_FILE = resolvePath(STATE_DIR, "crown-jewel-alarm-state.json");
const SOURCE = "Crown-Jewel Guard — telfer-wiki data-loss";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// ── 1. Run the guard ─────────────────────────────────────────────────────────
let guardOut;
let guardExit = 0;
try {
  guardOut = sh("node", [resolvePath(HERE, "guard-crown-jewels.mjs"), "--json"], {
    cwd: REPO,
  });
} catch (e) {
  guardExit = e.status ?? 2;
  guardOut = e.stdout || "";
}

let result = null;
try {
  result = JSON.parse(guardOut);
} catch {
  /* handled below */
}

// Blind is not clean. Exit 2 so the caller can tell the difference.
if (!result) {
  console.error(
    "crown-jewel-alarm: the guard produced no parseable output — this is BLIND, not clean.\n" +
      `  guard exit: ${guardExit}\n  output: ${guardOut.slice(0, 400)}`
  );
  process.exit(2);
}

// ── 2. Clean or no-baseline: nothing to file ─────────────────────────────────
if (result.status === "CLEAN") {
  // Clear the dedupe state so a future identical regression files a fresh card.
  try {
    if (existsSync(STATE_FILE)) {
      const prev = readJson(STATE_FILE) || {};
      if (prev.activeKey) {
        writeFileSync(STATE_FILE, JSON.stringify({ activeKey: null, clearedAt: new Date().toISOString() }, null, 2));
        console.log("crown-jewel-alarm: CLEAN — previous regression appears resolved; dedupe state cleared.");
      } else {
        console.log("crown-jewel-alarm: CLEAN — no regression, no card needed.");
      }
    } else {
      console.log("crown-jewel-alarm: CLEAN — no regression, no card needed.");
    }
  } catch {
    /* state is a convenience */
  }
  process.exit(0);
}

if (result.status === "NO_BASELINE") {
  console.log(`crown-jewel-alarm: NO BASELINE — ${result.message || "nothing to compare"}. No card filed.`);
  process.exit(0);
}

// ── 3. Build a stable key for this failure set ───────────────────────────────
const failureLines = (result.failures || []).map((f) => {
  if (f.kind === "PROFILE_VANISHED") return `VANISHED|${f.slug}`;
  if (f.kind === "CROWN_JEWEL_SHRANK") return `SHRANK|${f.slug}|${f.field}|${f.before}->${f.after}`;
  return `MIN|${f.slug}|${f.field}|${f.actual}<${f.minimum}`;
});
failureLines.sort();
const key = createHash("sha256").update(failureLines.join("\n")).digest("hex").slice(0, 16);

const warnLines = (result.warnings || []).map(
  (w) => `${w.slug}.${w.field}: ${w.before} -> ${w.after} (lost ${w.lost})`
);

// ── 4. Dedupe ────────────────────────────────────────────────────────────────
let state = readJson(STATE_FILE) || {};
if (!FORCE && state.activeKey === key) {
  console.log(
    `crown-jewel-alarm: this exact regression (key ${key}) was already filed as ${state.ticketId || "a card"}.\n` +
      `  Not filing a duplicate. Use --force to file again.`
  );
  process.exit(1); // still a regression — exit 1, not 0
}

// ── 5. Compose the card ──────────────────────────────────────────────────────
const nFail = (result.failures || []).length;
const nPeople = result.people || { before: 0, after: 0 };
const profileLoss = nPeople.before - nPeople.after;

const title =
  `Crown-Jewel Guard: ${nFail} family record(s) lost from telfer-wiki data` +
  (profileLoss > 0 ? ` (+${profileLoss} profile vanished)` : "");

const descLines = [];
descLines.push("WHY THIS CARD EXISTS");
descLines.push(
  "Mark's rule (24 Oct 2026): if a data-loss safety guard fires, it lands here on the Can Do Board"
);
descLines.push("so the 07:00 Morning Can Do Board Check picks it up. It is not a log entry to be missed.");
descLines.push("");
descLines.push("WHAT FIRED");
descLines.push(`  Guard            : scripts/guard-crown-jewels.mjs`);
descLines.push(`  Baseline         : ${result.baseline}`);
descLines.push(`  Profiles         : ${nPeople.before} -> ${nPeople.after}` +
  (profileLoss > 0 ? `   ❌ ${profileLoss} LOST` : "   (no profile lost)"));
descLines.push(`  Failures         : ${nFail}`);
descLines.push(`  Regression key   : ${key}`);
descLines.push("");
descLines.push("THE ACTUAL PROBLEMS");
for (const f of result.failures || []) {
  if (f.kind === "PROFILE_VANISHED") {
    descLines.push(`  • PROFILE VANISHED: ${f.slug} (${f.name})`);
  } else if (f.kind === "CROWN_JEWEL_SHRANK") {
    descLines.push(`  • ${f.slug} → ${f.field}: ${f.before} → ${f.after}  (lost ${f.lost})`);
    for (const e of (f.lostEntries || []).slice(0, 10)) descLines.push(`        − ${e}`);
    if ((f.lostEntries || []).length > 10) {
      descLines.push(`        … and ${f.lostEntries.length - 10} more`);
    }
  } else {
    descLines.push(`  • ${f.slug} → ${f.field}: ${f.actual} (minimum ${f.minimum})`);
  }
}
if (warnLines.length) {
  descLines.push("");
  descLines.push(`NON-CROWN-JEWEL SHRINKS (${warnLines.length}) — not fatal, but review:`);
  for (const w of warnLines.slice(0, 25)) descLines.push(`  • ${w}`);
  if (warnLines.length > 25) descLines.push(`  … and ${warnLines.length - 25} more`);
}
descLines.push("");
descLines.push("CRITICAL: THE VAULT IS PROBABLY STILL CORRECT");
descLines.push(
  "This guard compares the GENERATED src/data/people.json against git HEAD. The damage is in the"
);
descLines.push(
  "generated file, not in the Obsidian vault. Do NOT 'fix' the vault to match broken data."
);

const actionLines = [];
actionLines.push("1. STOP — do not commit, push or deploy this state. A push deploys to telferwiki.com.");
actionLines.push("2. Recover the data first:  cd ~/telfer-wiki && git checkout -- src/data/people.json");
actionLines.push("3. Re-run the guard to confirm clean:  node scripts/guard-crown-jewels.mjs");
actionLines.push("4. Identify WHICH pipeline step dropped the entries. Known suspects, 24 Oct 2026:");
actionLines.push("     • scripts/resolve-refs.mjs — matches a name to the wrong person when two people");
actionLines.push("       share a name. Confirmed: 'Alexander Lawrie (1853–1853)' resolved to");
actionLines.push("       alexander-lawrie-1776, his own grandfather. It matches on name, ignores dates.");
actionLines.push("     • scripts/regenerate-data.sh — runs that resolver, so it inherits the fault.");
actionLines.push("5. Fix the RESOLVER (date/generation sanity, like validate-slug-shape.mjs already has),");
actionLines.push("   then regenerate. Never hand-edit people.json to make this card go away.");
actionLines.push("6. If the shrink is a legitimate vault correction, declare it deliberately:");
actionLines.push("     node scripts/guard-crown-jewels.mjs --allow-shrink <slug>:<field>");

let descPath = "/tmp/crown_jewel_desc.txt";
let actionPath = "/tmp/crown_jewel_action.txt";
writeFileSync(descPath, descLines.join("\n"));
writeFileSync(actionPath, actionLines.join("\n"));

if (DRY) {
  console.log("── DRY RUN — would file this card ──────────────────────");
  console.log(`TITLE: ${title}`);
  console.log(`SEVERITY: high`);
  console.log(`KEY: ${key}`);
  console.log("");
  console.log(descLines.join("\n"));
  console.log("");
  console.log("SUGGESTED ACTION:");
  console.log(actionLines.join("\n"));
  process.exit(1); // it IS a regression
}

// ── 6. File it ───────────────────────────────────────────────────────────────
if (!existsSync(FILER)) {
  console.error(`crown-jewel-alarm: FILER NOT FOUND at ${FILER} — cannot file the card.`);
  console.error("This is a REGRESSION with no card. Tell Mark loudly.");
  process.exit(2);
}
if (!existsSync(BOARD)) {
  console.error(`crown-jewel-alarm: BOARD NOT FOUND at ${BOARD} — cannot file the card.`);
  process.exit(2);
}

const boardBefore = readFileSync(BOARD, "utf8");

let filerOut = "";
try {
  filerOut = sh("python3", [
    FILER,
    "--title", title,
    "--severity", "high",
    "--description-file", descPath,
    "--action-file", actionPath,
    "--source", SOURCE,
  ]);
} catch (e) {
  console.error("crown-jewel-alarm: the filer FAILED — no card was created.");
  console.error((e.stdout || "") + (e.stderr || ""));
  process.exit(2);
}

console.log(filerOut.trim());

// ── 7. PROVE the card exists by reading the board back ───────────────────────
const boardAfter = readFileSync(BOARD, "utf8");
if (boardAfter === boardBefore) {
  console.error(
    "crown-jewel-alarm: the filer reported success but board.yaml is UNCHANGED.\n" +
      "  Treat this as NOT FILED — a claim of filing without a card on the board is a lie."
  );
  process.exit(2);
}

// Pull the new ticket id out of the diff between the two board states.
const newIds = [];
const idRe = /\b(tw-\d{4}-\d{2}-\d{2}-\d{3})\b/g;
const beforeIds = new Set((boardBefore.match(idRe) || []));
for (const m of boardAfter.match(idRe) || []) if (!beforeIds.has(m)) newIds.push(m);

let ticketId = newIds[0] || null;

// Fall back to whatever the filer printed.
if (!ticketId) {
  const m = filerOut.match(/\b(tw-\d{4}-\d{2}-\d{2}-\d{3})\b/);
  if (m) ticketId = m[1];
}

if (!ticketId) {
  console.error(
    "crown-jewel-alarm: board.yaml changed but no new ticket id could be read.\n" +
      "  The card may exist under a malformed id. Run assert-board-integrity.py."
  );
  process.exit(2);
}

// Confirm the id really is on the board.
if (!boardAfter.includes(ticketId)) {
  console.error(`crown-jewel-alarm: claimed ticket ${ticketId} is NOT in board.yaml — NOT FILED.`);
  process.exit(2);
}

// ── 8. Record the dedupe state ───────────────────────────────────────────────
try {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        activeKey: key,
        ticketId,
        filedAt: new Date().toISOString(),
        failures: failureLines,
        profiles: nPeople,
      },
      null,
      2
    )
  );
} catch (e) {
  console.error(`crown-jewel-alarm: card ${ticketId} filed, but state could not be saved: ${e.message}`);
  console.error("  (Risk: a duplicate card on the next run. Not fatal.)");
}

console.log("");
console.log(`✅ CARD FILED: ${ticketId}`);
console.log(`   Verified present in ${BOARD}`);
console.log(`   Ready for the 07:00 Morning Can Do Board Check.`);
process.exit(1); // exit 1: there IS a regression, even though it was filed correctly
