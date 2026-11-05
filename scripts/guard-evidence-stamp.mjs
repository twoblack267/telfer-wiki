#!/usr/bin/env node
/**
 * guard-evidence-stamp.mjs — refuse a new or changed vault profile that carries
 * no evidence rating.
 *
 * WHY THIS EXISTS
 * ---------------
 * Mark, 6 Nov 2026: "we actually have to make sure when we're sourcing things
 * and their stamps and it's actually getting done when people's profiles are
 * getting made — can't just have a page and then the cron job isn't actually
 * enforcing what we're putting together."
 *
 * The 05:00 Family Verification Pass is the ONLY job permitted to write family
 * facts into the vault. Its prompt already requires an evidence rating on any
 * judgement call. A prompt is a language model being asked nicely. This gate is
 * the thing that actually says no.
 *
 * JUDGE GIT, NOT mtime  (learned the hard way, 6 Nov 2026)
 * -------------------------------------------------------
 * The first version of this gate judged file mtime inside a 24h window and
 * failed 26 profiles. Twenty-five of them had not been edited at all — a
 * surname-cleanup commit and an Obsidian touch had refreshed their timestamps.
 * A gate that accuses an innocent page teaches everyone to bypass it.
 * So the question this gate asks is: "did the CONTENT of this file change?"
 * Git is the only trustworthy answer to that, and it is also the record the
 * 05:00 job's own post-write guard already produces.
 *
 * ENFORCED FORWARD, NEVER BACKWARD
 * --------------------------------
 * 541 of the 680 vault profiles predate the convention. Retro-failing them would
 * block every build and guarantee the gate gets switched off within a week.
 * Only profiles whose content changed are judged — precisely the set the 05:00
 * job may have just written. Old profiles keep their silence; they earn a
 * rating the next time they are touched.
 *
 * THE RULE
 * --------
 * A vault profile under "Family History/People/" whose content changed must carry
 * at least one of:
 *   - evidence_level: <any value>
 *   - single_source: true|false
 * Plus, if evidence_level is soft-yes-provisional, it must carry the receipt
 * keys (provisional_on, provisional_why, provisional_receipt). A provisional
 * call that cannot be audited was never properly made.
 *
 * USAGE
 * -----
 *   node scripts/guard-evidence-stamp.mjs            # uncommitted + last commit
 *   EVIDENCE_BASE=<ref> node ...                     # everything since <ref>
 *   EVIDENCE_GATE_VERBOSE=1 node ...                 # print the all-clear
 * Exit 1 on any offence. Exit 0 silently when clean.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const VAULT = process.env.VAULT_DIR || join(homedir(), "ObsidianVault");
const PEOPLE_REL = "Family History/People";
const PEOPLE = join(VAULT, PEOPLE_REL);

const RECEIPT_KEYS = ["provisional_on", "provisional_why", "provisional_receipt"];

function git(args) {
  try {
    return execFileSync("git", ["-C", VAULT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** Paths under People/ whose CONTENT changed, compared against `base`. */
function changedSince(base) {
  const out = new Set();
  const sets = [
    ["diff", "--name-only", base, "--", PEOPLE_REL],
    ["diff", "--name-only", "--cached", base, "--", PEOPLE_REL],
  ];
  // Uncommitted work is never visible to `git diff <ref>`, so ask separately.
  sets.push(["diff", "--name-only", "--", PEOPLE_REL]);
  for (const args of sets) {
    for (const line of git(args).split("\n")) {
      if (line.endsWith(".md")) out.add(line);
    }
  }
  return out;
}

/** Untracked brand-new profiles are content changes by definition. */
function untracked() {
  const out = new Set();
  for (const line of git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    PEOPLE_REL,
  ]).split("\n")) {
    if (line.endsWith(".md")) out.add(line);
  }
  return out;
}

function frontmatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const out = {};
  for (const line of text.slice(3, end).split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

// ── Which files are judged ───────────────────────────────────────────────────
// Default base is HEAD: catches everything the 05:00 job wrote and has not yet
// committed (step A runs before step C), plus anything already staged.
const base = process.env.EVIDENCE_BASE || "HEAD";
const targets = new Set([...changedSince(base), ...untracked()]);

const offences = [];
for (const rel of [...targets].sort()) {
  const abs = join(VAULT, rel);
  let fm;
  try {
    fm = frontmatter(readFileSync(abs, "utf8"));
  } catch {
    continue; // deleted file — not our business
  }
  const name = rel.split("/").pop();

  if (!fm) {
    offences.push({ name, why: "content changed but has no YAML frontmatter at all" });
    continue;
  }

  const hasLevel = "evidence_level" in fm;
  const hasSingle = "single_source" in fm;

  if (!hasLevel && !hasSingle) {
    offences.push({
      name,
      why:
        "content changed but carries neither `evidence_level:` nor " +
        "`single_source:` — the page does not say how well it is known",
    });
    continue;
  }

  if (fm.evidence_level === "soft-yes-provisional") {
    const missing = RECEIPT_KEYS.filter((k) => !(k in fm));
    if (missing.length) {
      offences.push({
        name,
        why:
          "evidence_level: soft-yes-provisional without receipt keys — missing " +
          missing.join(", ") +
          " (a call that cannot be audited was never properly made)",
      });
    }
  }
}

if (offences.length) {
  console.error("");
  console.error("❌ EVIDENCE STAMP GATE FAILED");
  console.error(
    `   ${offences.length} changed profile(s) do not say how well they are known.`
  );
  console.error(
    `   Rule: "EVERY PAGE SAYS HOW WELL IT IS KNOWN" — How We Work (Telfer Wiki Rules).md`
  );
  console.error("");
  for (const o of offences) {
    console.error(`   • ${o.name}`);
    console.error(`     ${o.why}`);
  }
  console.error("");
  console.error("   Fix: add `evidence_level: verified|soft-yes-provisional`");
  console.error("   or `single_source: true` to the page's frontmatter before saving.");
  console.error("");
  process.exit(1);
}

if (process.env.EVIDENCE_GATE_VERBOSE === "1") {
  console.log(
    `✅ evidence stamp gate: base=${base}, ${targets.size} changed profile(s) judged, 0 offences`
  );
}
process.exit(0);
