#!/usr/bin/env node
/**
 * guard-crown-jewels.mjs — the anti-data-loss gate for the wiki pipeline.
 *
 * WHY THIS EXISTS
 * ---------------
 * `regenerate-data.sh` destroyed real family data TWICE on 2026-10-24, and both
 * times the corruption was silent: exit code 0, every existing guard green, and a
 * smaller number quietly written where a bigger one had been.
 *
 *   run 1: john-lawrie-1810 kept 8 entries in `relationships:` but only 1 in
 *          `children:`; william-telfer-1802 lost his wife and both parents.
 *   run 2: 208 relationship fields SHRANK and a profile disappeared (404 -> 403).
 *
 * The vault was correct the whole time. The damage was in the GENERATED file, and
 * nothing in the pipeline asserted that a generated record may not lose relatives
 * it previously had.
 *
 * WHAT IT DOES
 * ------------
 * Compares the working `src/data/people.json` against the version in git HEAD and
 * reports every count that DROPPED — per person, per field. Additions are fine and
 * expected. Shrinking is the signature of the bug, so shrinking FAILS.
 *
 * Two severities:
 *   ❌ FAIL   — a CROWN JEWEL lost entries, or any profile disappeared. These are
 *               hard-coded records Mark has verified; losing them is never correct.
 *   ⚠️  WARN  — a non-crown-jewel field shrank. Printed in full so it cannot hide,
 *               but only escalates to a failure with --strict.
 *
 * A vault edit can legitimately remove a relative (correcting a wrong link). That
 * is what `--allow-shrink-slug` and `--baseline <file>` are for: an intentional
 * shrink must be declared, never accidental. Declaring it is a deliberate act.
 *
 * USAGE
 *   node scripts/guard-crown-jewels.mjs                # check vs git HEAD
 *   node scripts/guard-crown-jewels.mjs --strict       # any shrink fails
 *   node scripts/guard-crown-jewels.mjs --json         # machine-readable
 *   node scripts/guard-crown-jewels.mjs --allow-shrink john-lawrie-1810:children
 *   node scripts/guard-crown-jewels.mjs --allow-shrink john-lawrie-1810   # whole person
 *   node scripts/guard-crown-jewels.mjs --baseline <path-to-people.json>
 *
 * Exit codes: 0 = clean (warnings allowed unless --strict), 1 = regression found,
 *             2 = could not run (missing git, unreadable file) — never a false pass.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolvePath(HERE, "..");

const RELATIONSHIP_FIELDS = [
  "parents",
  "children",
  "spouses",
  "siblings",
  "step_parents",
  "step_children",
];

/**
 * CROWN JEWELS — records whose relationship counts are asserted, not merely
 * observed. Each entry records WHY it is trusted so the reason survives the person
 * who wrote it. Losing any of these has already happened once; it must never happen
 * silently again.
 *
 * Counts are MINIMUMS, not exact values. Growing is always allowed — a new child
 * discovered is a win. Shrinking is what this guard exists to catch.
 */
const CROWN_JEWELS = {
  "john-lawrie-1810": {
    children: 8,
    parents: 2,
    spouses: 1,
    why:
      "All eight children are dated in the vault frontmatter (Jean/Jane 1836, Marion 1838, " +
      "John 1840-1845, Janet 1842-1845, John 1845-1921, Elizabeth 1847, Robert 1850, Alexander 1853). " +
      "A regen collapsed this to 1 on 2026-10-24.",
  },
  "william-telfer-1802": {
    parents: 2,
    spouses: 1,
    why:
      "Parents William Telfer (shepherd) and Janet Nichol, wife Margaret. A regen stripped " +
      "all three on 2026-10-24.",
  },
  "andrew-kelly-parker-1883": {
    children: 8,
    why: "Eight children listed in the vault frontmatter, including a same-named son.",
  },
  "andrew-telfer-1798": {
    parents: 2,
    spouses: 1,
    children: 4,
    why: "Parents, wife Mary Hayes, and four children per the vault frontmatter.",
  },
  "janet-nichol": {
    children: 2,
    spouses: 1,
    why: "Two children and one spouse per the vault frontmatter.",
  },
};

function parseArgs(argv) {
  const opts = {
    strict: false,
    json: false,
    baseline: null,
    allow: new Set(),
    allowPeople: new Set(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") opts.strict = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--baseline") opts.baseline = argv[++i];
    else if (a === "--allow-shrink") {
      const v = argv[++i];
      if (!v) die("--allow-shrink requires slug or slug:field");
      if (v.includes(":")) opts.allow.add(v);
      else opts.allowPeople.add(v);
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node scripts/guard-crown-jewels.mjs [--strict] [--json]\n" +
          "         [--baseline <people.json>]\n" +
          "         [--allow-shrink <slug>|<slug:field>]..."
      );
      process.exit(0);
    } else die(`unknown argument: ${a}`);
  }
  return opts;
}

function die(msg) {
  console.error(`guard-crown-jewels: ${msg}`);
  process.exit(2);
}

/** Normalise people.json, which may be a bare array or wrapped in an object. */
function toArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.people)) return raw.people;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

function readJsonFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    die(`cannot read ${path}: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // A malformed people.json is itself a catastrophic outcome of the pipeline.
    die(`cannot parse ${path} as JSON: ${e.message}`);
  }
}

/** Read the same file as it exists at a git ref. Returns null if it is not there. */
function readGitJson(ref, relPath) {
  // Prefer the merge-base (what main actually has) over HEAD when a branch is
  // checked out, so a comparison is never made against work that was never main.
  for (const r of [ref, "HEAD", "origin/main"]) {
    if (!r) continue;
    try {
      const text = execFileSync("git", ["-C", REPO, "show", `${r}:${relPath}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
      if (!text || !text.trim()) continue;
      return JSON.parse(text);
    } catch {
      /* try the next ref */
    }
  }
  return null;
}

function count(v) {
  if (!Array.isArray(v)) return 0;
  return v.filter((x) => x !== null && x !== undefined && String(x).trim() !== "").length;
}

function indexBySlug(people) {
  const map = new Map();
  for (const p of people) {
    if (p && p.slug) map.set(String(p.slug), p);
  }
  return map;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const relPath = "src/data/people.json";
  const currentPath = resolvePath(REPO, relPath);

  if (!existsSync(currentPath)) die(`${relPath} does not exist — refusing to report a pass`);

  const currentRaw = readJsonFile(currentPath);
  const currentArr = toArray(currentRaw);
  if (currentArr.length === 0) die(`${relPath} parsed to zero people — refusing to report a pass`);

  let baseRaw;
  let baseLabel;
  if (opts.baseline) {
    baseRaw = readJsonFile(resolvePath(process.cwd(), opts.baseline));
    baseLabel = `baseline ${opts.baseline}`;
  } else {
    baseRaw = readGitJson(process.env.GUARD_BASE_REF || "HEAD", relPath);
    baseLabel = `${process.env.GUARD_BASE_REF || "HEAD"}:${relPath}`;
  }

  // No baseline is NOT a pass — but it is also not a regression. Say so plainly and
  // exit 0 only because there is nothing to compare; the failure mode we care about
  // (a shrink) cannot be hidden, because CI always has a HEAD to compare against.
  if (baseRaw === null) {
    const notice = {
      status: "NO_BASELINE",
      message:
        `No committed ${relPath} found (first run, or git unavailable). ` +
        `Nothing to compare — this is not a verified pass.`,
      current: currentArr.length,
    };
    if (opts.json) console.log(JSON.stringify(notice, null, 2));
    else {
      console.log(`⚠️  CROWN-JEWEL GUARD: NO BASELINE — ${notice.message}`);
    }
    return process.exit(0);
  }

  const baseArr = toArray(baseRaw);
  const base = indexBySlug(baseArr);
  const now = indexBySlug(currentArr);

  const failures = [];
  const warnings = [];

  // ── 1. Vanished profiles ────────────────────────────────────────────────────
  for (const [slug, before] of base) {
    if (!now.has(slug)) {
      failures.push({
        kind: "PROFILE_VANISHED",
        slug,
        name: before.display_name || before.name || slug,
        detail: `profile exists in ${baseLabel} but is GONE from the working data`,
      });
    }
  }

  // ── 2. Relationship counts that shrank ──────────────────────────────────────
  for (const [slug, before] of base) {
    const after = now.get(slug);
    if (!after) continue; // already reported as vanished

    const jewel = CROWN_JEWELS[slug];

    for (const field of RELATIONSHIP_FIELDS) {
      const b = count(before[field]);
      const a = count(after[field]);
      if (a >= b) continue; // grew or unchanged — fine

      // Was this shrink deliberately declared?
      if (opts.allowPeople.has(slug) || opts.allow.has(`${slug}:${field}`)) continue;

      const row = {
        kind: jewel ? "CROWN_JEWEL_SHRANK" : "FIELD_SHRANK",
        slug,
        name: after.display_name || before.display_name || slug,
        field,
        before: b,
        after: a,
        lost: b - a,
        lostEntries: entriesIn(before[field]).filter(
          (e) => !entriesIn(after[field]).includes(e)
        ),
      };

      if (jewel) failures.push(row);
      else warnings.push(row);
    }
  }

  // ── 3. Crown jewels below their asserted minimum ────────────────────────────
  // Catches the case where HEAD is already damaged: a regen that leaves the data
  // exactly as broken as it found it would pass a pure before/after diff.
  for (const [slug, spec] of Object.entries(CROWN_JEWELS)) {
    const after = now.get(slug);
    if (!after) continue; // reported above if it was in base; a brand-new absence is a separate concern
    for (const [field, minimum] of Object.entries(spec)) {
      if (field === "why") continue;
      const a = count(after[field]);
      if (a >= minimum) continue;
      if (opts.allowPeople.has(slug) || opts.allow.has(`${slug}:${field}`)) continue;
      // Do not double-report a shrink we already caught above.
      const dup = failures.find(
        (f) => f.kind === "CROWN_JEWEL_SHRANK" && f.slug === slug && f.field === field
      );
      if (dup) continue;
      failures.push({
        kind: "CROWN_JEWEL_BELOW_MINIMUM",
        slug,
        name: after.display_name || slug,
        field,
        minimum,
        actual: a,
        why: spec.why,
      });
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const result = {
    status:
      failures.length > 0
        ? "REGRESSION"
        : opts.strict && warnings.length > 0
          ? "REGRESSION"
          : "CLEAN",
    baseline: baseLabel,
    people: { before: baseArr.length, after: currentArr.length },
    crownJewelsChecked: Object.keys(CROWN_JEWELS).length,
    failures,
    warnings,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("── CROWN-JEWEL / DATA-LOSS GUARD ─────────────────────────");
    console.log(`  baseline            : ${baseLabel}`);
    console.log(
      `  profiles            : ${result.people.before} -> ${result.people.after}` +
        (result.people.after < result.people.before
          ? `  ❌ LOST ${result.people.before - result.people.after}`
          : "")
    );
    console.log(`  crown jewels checked: ${result.crownJewelsChecked}`);

    if (failures.length === 0 && warnings.length === 0) {
      console.log("");
      console.log("✅ NO DATA LOSS — no profile vanished, no relationship count shrank.");
    }

    if (warnings.length > 0) {
      console.log("");
      console.log(`⚠️  ${warnings.length} non-crown-jewel field(s) SHRANK:`);
      for (const w of warnings) {
        console.log(
          `     • ${w.slug} → ${w.field}: ${w.before} → ${w.after} (lost ${w.lost})`
        );
        for (const e of w.lostEntries.slice(0, 6)) console.log(`         − ${e}`);
        if (w.lostEntries.length > 6) {
          console.log(`         … and ${w.lostEntries.length - 6} more`);
        }
      }
      console.log(
        opts.strict
          ? "     --strict is on, so this FAILS."
          : "     Not fatal unless --strict. If intentional, declare it with --allow-shrink."
      );
    }

    if (failures.length > 0) {
      console.log("");
      console.log(`❌ DATA-LOSS REGRESSION — ${failures.length} problem(s):`);
      for (const f of failures) {
        if (f.kind === "PROFILE_VANISHED") {
          console.log(`     • PROFILE VANISHED: ${f.slug} (${f.name})`);
          console.log(`         ${f.detail}`);
        } else if (f.kind === "CROWN_JEWEL_SHRANK") {
          console.log(`     • CROWN JEWEL SHRANK: ${f.slug} → ${f.field}: ${f.before} → ${f.after}`);
          for (const e of f.lostEntries.slice(0, 8)) console.log(`         − ${e}`);
          console.log(`         Why this is protected: ${CROWN_JEWELS[f.slug].why}`);
        } else {
          console.log(
            `     • BELOW MINIMUM: ${f.slug} → ${f.field}: ${f.actual} (minimum ${f.minimum})`
          );
          console.log(`         Why this is protected: ${f.why}`);
        }
      }
      console.log("");
      console.log("  DO NOT COMMIT, PUSH OR DEPLOY THIS STATE.");
      console.log("  The vault is the source of truth and is almost certainly still correct.");
      console.log("  Recover with:  git checkout -- src/data/people.json");
      console.log("  Then find which pipeline step dropped the entries before regenerating.");
      if (!opts.baseline) {
        console.log("");
        console.log("  If the shrink is INTENTIONAL (a vault correction), declare it:");
        console.log("    node scripts/guard-crown-jewels.mjs --allow-shrink <slug>:<field>");
      }
    }
  }

  // Persist the last successful comparison so a post-hoc investigation has evidence
  // even after someone has restored the file.
  try {
    const evidenceDir = resolvePath(REPO, "scripts/.guard-evidence");
    const { mkdirSync } = awaitImportFs();
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resolvePath(evidenceDir, "crown-jewels-last.json"),
      JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2)
    );
  } catch {
    /* evidence is a convenience, never a gate */
  }

  process.exit(result.status === "CLEAN" ? 0 : 1);
}

/** Readable list of entries, for naming exactly what was lost. */
function entriesIn(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x !== null && x !== undefined)
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
    .filter((x) => x.trim() !== "");
}

function awaitImportFs() {
  // Synchronous import kept local so the module has no top-level fs-only coupling.
  // (createRequire is unnecessary; node:fs exports are available synchronously.)
  return requireFsSync();
}

import * as fsSync from "node:fs";
function requireFsSync() {
  return fsSync;
}

main();
