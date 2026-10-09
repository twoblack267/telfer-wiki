#!/usr/bin/env node
/**
 * check-snapshot-freshness.mjs — pre-commit / pre-deploy gate for the committed
 * CI-dead-link snapshots. Closes the tw-2026-09-27-001 class (recurred as
 * 5ccb013 and 9f78e6f, then again inside tw-2026-10-09-001: three strikes).
 *
 * THE FAILURE IT PREVENTS
 *   scripts/family-rows.snapshot.json and scripts/vault-notes.snapshot.json are
 *   generated from the Obsidian vault and COMMITTED so CI (which has no vault)
 *   can audit them for real. The regen pipeline refreshes them but only PRINTS
 *   "commit it if it changed" — it never enforces that. When someone commits a
 *   vault/data change and forgets to stage the regenerated snapshot, CI audits
 *   the STALE committed snapshot and the family-cell link guard goes red on a
 *   vault that is actually correct.
 *
 * WHAT IT CHECKS (three independent failure modes, all real, none guessed)
 *   1. UNREGENERATED DRIFT — the snapshot on disk does not match what the live
 *      vault would produce. Only checkable where the vault lives (no vault in CI,
 *      and we must not fake it). When the vault IS present we regenerate and
 *      compare the parsed `files`/`notes` payload (never the formatting, and
 *      never the `generated` timestamp, which churns on every run by design).
 *   2. UNSTAGED REGEN — the snapshot file is dirty in git at commit time. This
 *      is exactly the 9f78e6f mistake. ONLY meaningful at commit time, so it is
 *      SKIPPED under --pipeline (see below).
 *   3. MISSING — the snapshot is not committed at all. Fatal everywhere.
 *
 * MODES (--pipeline)
 *   The gate is called from two places with opposite needs:
 *     • pre-commit hook / CI  — a human or a clean checkout is about to commit.
 *       A dirty snapshot here IS the bug. Run the staging check.
 *     • regenerate-data.sh    — the pipeline has JUST written the snapshot on
 *       purpose, and night-watch.sh commits with `git add -A` afterwards. The
 *       file is *always* dirty at this instant, so the staging check is not
 *       merely unhelpful, it is unsatisfiable: it guaranteed a nightly exit 1
 *       that blocked the very commit that would have staged the file.
 *       tw-2026-10-09-00X — 4th recurrence of this class, self-inflicted by the
 *       3rd fix. Under --pipeline we check CONTENT ONLY and skip the staging
 *       check; the pre-commit hook still enforces staging at the real commit.
 *
 * THIS IS A CHECK, NOT A WRITER. Mode 1 runs the maker, which rewrites the file
 * on disk. So we capture the ORIGINAL RAW BYTES before, and write those exact
 * bytes back afterwards — never a re-serialised copy (re-serialising collapsed a
 * pretty-printed file and corrupted the very artifact we guard; don't repeat it).
 *
 * EXIT CODES
 *   0 = fresh (or vault absent AND file clean — the CI-safe no-op)
 *   1 = stale / dirty — DO NOT COMMIT DEPLOY-ADJACENT WORK
 *
 * Usage:
 *   node scripts/check-snapshot-freshness.mjs            # gate
 *   node scripts/check-snapshot-freshness.mjs --quiet     # only speak on failure
 *   node scripts/check-snapshot-freshness.mjs --no-vault  # skip mode 1 (CI)
 *   node scripts/check-snapshot-freshness.mjs --pipeline  # skip mode 2 (regen)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(import.meta.dirname, "..");
const QUIET = process.argv.includes("--quiet");
const NO_VAULT = process.argv.includes("--no-vault");
// --pipeline: we were called BY the regen pipeline, which has just written the
// snapshot on purpose. The staging check (mode 2) is unsatisfiable here — see the
// header. Skip it; the pre-commit hook enforces staging at the real commit.
const PIPELINE = process.argv.includes("--pipeline");

// `payloadKey` is the field the maker writes that carries the audited content.
const SNAPSHOTS = [
  { file: "scripts/family-rows.snapshot.json", maker: "scripts/make-family-rows-snapshot.mjs", payloadKey: "files" },
  { file: "scripts/vault-notes.snapshot.json", maker: "scripts/make-vault-notes-snapshot.mjs", payloadKey: "notes" },
];

const say = (m) => { if (!QUIET) console.log(m); };
const problems = [];

// --- Mode 2: is the snapshot dirty in git? (checkable everywhere) -------------
// A file that is MODIFIED BUT STAGED belongs in the coming commit — that is the
// correct pre-commit state and must NOT be reported. What we must catch is a
// snapshot with UNSTAGED changes (regenerated on disk, not `git add`ed): that is
// the 9f78e6f mistake, because the commit then carries the stale copy.
// So the test is "is there a difference between the working tree and the INDEX?",
// not "does the file show up in git status at all".
function dirty(path) {
  try {
    // --quiet exits 1 when the working tree differs from the index (unstaged edits).
    execFileSync("git", ["-C", ROOT, "diff", "--quiet", "--", path], { stdio: "ignore" });
    return false; // exit 0 = working tree matches the index = nothing unstaged
  } catch (e) {
    // exit 1 = unstaged differences exist; anything else = we could not look.
    return e && e.status === 1;
  }
}

// --- Mode 1: does the snapshot match a fresh regeneration from the vault? -----
const CANDIDATES = [
  process.env.TELFER_VAULT_PEOPLE,
  join(ROOT, "vault-checkout", "People"),
  join(homedir(), "ObsidianVault", "Family History", "People"),
  join(ROOT, "..", "ObsidianVault", "Family History", "People"),
].filter(Boolean);

const VAULT = NO_VAULT
  ? null
  : CANDIDATES.find((c) => {
      try { return existsSync(c) && readdirSync(c).some((f) => f.endsWith(".md")); } catch { return false; }
    });

for (const snap of SNAPSHOTS) {
  const path = join(ROOT, snap.file);
  if (!existsSync(path)) {
    problems.push(`${snap.file}: MISSING (must be committed — CI audits it)`);
    continue;
  }

  if (!PIPELINE && dirty(snap.file)) {
    problems.push(
      `${snap.file}: DIRTY in git — regenerated but not staged. ` +
        `Stage it before committing (this is the 9f78e6f mistake).`
    );
  }

  if (!VAULT) {
    if (PIPELINE) {
      say(`${snap.file}: pipeline mode — staging check skipped (content-only).`);
    }
    continue;
  }

  // Capture the ORIGINAL RAW BYTES so we can restore exactly (not re-serialise).
  const originalBytes = readFileSync(path);
  let fresh;
  try {
    execFileSync("node", [snap.maker], {
      cwd: ROOT, stdio: "ignore",
      env: { ...process.env, TELFER_VAULT_PEOPLE: VAULT },
    });
    fresh = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    problems.push(`${snap.file}: could not regenerate to compare (${e.message.split("\n")[0]})`);
    writeFileSync(path, originalBytes); // restore regardless
    continue;
  }
  // Restore the artifact to its EXACT prior bytes before we judge anything.
  writeFileSync(path, originalBytes);

  const committed = JSON.parse(originalBytes.toString("utf8"));
  const a = JSON.stringify(fresh[snap.payloadKey]);
  const b = JSON.stringify(committed[snap.payloadKey]);
  if (a !== b) {
    const ca = Array.isArray(fresh[snap.payloadKey]) ? fresh[snap.payloadKey].length : Object.keys(fresh[snap.payloadKey] ?? {}).length;
    const cb = Array.isArray(committed[snap.payloadKey]) ? committed[snap.payloadKey].length : Object.keys(committed[snap.payloadKey] ?? {}).length;
    problems.push(
      `${snap.file}: STALE — '${snap.payloadKey}' does not match the live vault ` +
        `(${cb} committed vs ${ca} fresh). Run \`node ${snap.maker}\` and stage the result.`
    );
  }
}

// --- Report -------------------------------------------------------------------
if (problems.length === 0) {
  say(
    `SNAPSHOT FRESHNESS: OK — ${SNAPSHOTS.length} snapshot(s) clean in git` +
      (VAULT ? " and match the live vault." : " (vault absent — git-clean check only).")
  );
  process.exit(0);
}

console.error("");
console.error("❌ SNAPSHOT FRESHNESS GATE FAILED");
console.error("   The committed CI snapshots are stale or unstaged — CI audits the COMMITTED");
console.error("   file, so pushing this as-is turns the family-cell / body-link guards red on a");
console.error("   vault that is actually correct. (tw-2026-09-27-001 class; 3rd recurrence.)");
console.error("");
for (const p of problems) console.error(`   • ${p}`);
console.error("");
console.error("   Fix: run the maker above, then `git add scripts/*.snapshot.json && git commit`.");
console.error("");
process.exit(1);
