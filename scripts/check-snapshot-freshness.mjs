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
 * WHAT IT CHECKS (two independent failure modes, both real, neither guessed)
 *   1. UNREGENERATED DRIFT — the snapshot on disk does not match what the live
 *      vault would produce. Only checkable where the vault lives (no vault in CI,
 *      and we must not fake it). When the vault IS present we regenerate and
 *      compare the parsed `files`/`notes` payload (never the formatting).
 *   2. UNSTAGED REGEN — the snapshot file is dirty in git at commit time. This
 *      is checkable everywhere and is exactly the 9f78e6f mistake.
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
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(import.meta.dirname, "..");
const QUIET = process.argv.includes("--quiet");
const NO_VAULT = process.argv.includes("--no-vault");

// `payloadKey` is the field the maker writes that carries the audited content.
const SNAPSHOTS = [
  { file: "scripts/family-rows.snapshot.json", maker: "scripts/make-family-rows-snapshot.mjs", payloadKey: "files" },
  { file: "scripts/vault-notes.snapshot.json", maker: "scripts/make-vault-notes-snapshot.mjs", payloadKey: "notes" },
];

const say = (m) => { if (!QUIET) console.log(m); };
const problems = [];

// --- Mode 2: is the snapshot dirty in git? (checkable everywhere) -------------
function dirty(path) {
  try {
    return execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", path], { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false; // not a git repo / git missing — do not block on our own inability to look
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

  if (dirty(snap.file)) {
    problems.push(
      `${snap.file}: DIRTY in git — regenerated but not staged. ` +
        `Stage it before committing (this is the 9f78e6f mistake).`
    );
  }

  if (!VAULT) continue;

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
