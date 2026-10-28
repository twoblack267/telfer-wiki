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
  "elisabeth-telfer-1806": {
    // CORRECTED 2026-10-28 (parents 1 -> 0). This is a correction, not a loss.
    //
    // The one parent she was recorded as having was thomas-telfer — and it was WRONG.
    // She was born in 1806 in England; Thomas Telfer (of Broadlee) was baptising children
    // in Castleton parish, Roxburghshire, in 1774-75. The vault's page for him names his
    // daughter as "Elisabeth Telfer (bap. 10 Feb ... year recorded 1774 in the index /
    // 1776 on the register page)" and explicitly records the year discrepancy as
    // UNRESOLVED. That ref carried no parseable year (the year extractor did not know
    // `bap.`), so it fell to the bare-name path, matched the only "Elisabeth Telfer" in
    // the vault, and bound a woman from the wrong country a generation later.
    //
    // The vault also documents at length that this Elisabeth (b.~1806, England) fits a
    // 1851 widow's age and birthplace equally with Elizabeth Hutton Telfer (1774-1853)
    // and that the identification is NOT settled. Asserting Thomas as her father picked
    // one side of an open question and would have published it as fact on an ancestor's
    // page. An orphan node is the honest state until the research settles it.
    parents: 0,
    allowShrink: { parents: "wrong-parent link removed 2026-10-28 (1 → 0); she was bound to Thomas Telfer of Broadlee by name alone, born in the wrong country 32 years after his children's baptisms" },
    why:
      "Born ~1806 in England. Previously bound as a child of Thomas Telfer (of Broadlee), " +
      "who was baptising children at Castleton, Roxburghshire in 1774-75. The binding was a " +
      "name collision with a daughter whose baptism year is itself disputed.",
  },
  "william-telfer-1802": {
    // CORRECTED 2026-10-24 (children 5 -> 2; parents/spouses kept).
    // The old minimum of 5 children came from prior GENERATED data, which had wired
    // his brother Andrew (1798–1858) and a bare phantom "William Telfer" in as sons.
    // The vault's own frontmatter lists five child refs, but three of them cannot be
    // identified: "William Telfer" (year-less, four men share the name), "Andrew
    // Telfer" (the page's body table points this at his BROTHER, and the page's
    // research note explicitly warns against that conflation) and "Elizabeth Telfer
    // (Mrs Mansfield)" (no profile exists). Only two are resolvable: William 1841 and
    // Edward. Demanding 5 would force the pipeline to fabricate identity — the exact
    // sin this guard exists to prevent. Minimums come from what the VAULT can
    // actually identify, never from previously generated data.
    parents: 2,
    spouses: 1,
    children: 2,
    why:
      "Parents William Telfer (shepherd) and Janet Nichol, wife Margaret, and the two " +
      "children the vault identifies by name (William 1841, Edward). His other child " +
      "refs are ambiguous or point at his brother; refusing to guess is correct.",
  },
  "andrew-kelly-parker-1883": {
    // CORRECTED 2026-10-28 (children 8 -> 7): the eighth "child" was HIMSELF.
    // The vault frontmatter, the prose Children table and the generated data all
    // listed "Andrew Kelly Parker" among Andrew Kelly Parker's children. There is no
    // second record of that name anywhere in the vault or the dataset (checked
    // 28 Oct), and nothing in the note suggests a same-named son — the "eights
    // children" sentence in his Life Summary was the same duplication counted twice.
    // His AIF service file (62513) is the reason the frontmatter was believed, but a
    // service file lists nobody's children. The self-reference is now removed from
    // relationships:, the prose table AND the count sentence, so seven is the vault's
    // own figure. A minimum of 8 would demand the pipeline re-fabricate a man as his
    // own son; refusing is the correction, not the loss.
    children: 7,
    allowShrink: { children: "self-reference removed 2026-10-28 (8 → 7); the eighth entry was Andrew himself" },
    why: "Seven children named in the vault (Keith Cyril, Elliott William, Ira Mark, Ada Beatrice, Lucy Beatrice Davey, Betty Lorraine, Jean Mary). The old minimum of 8 counted Andrew himself as his own son.",
  },
  "andrew-telfer-1798": {
    // CORRECTED 2026-10-24 (children 4 -> 3).
    // The vault names four children, but they are "William Telfer (1847–?)", "Mary
    // (Telfer) Bowden", "Andrew Telfer" and "Elizabeth (Telfer) Bolton". The old
    // minimum of 4 was satisfied in prior generated data by counting
    // william-telfer-1802 — who this SAME vault file declares as his BROTHER
    // ("Brother: William Telfer (1802–1850)") and who is therefore not a child at
    // all. Of the genuine four, "William Telfer (1847–?)" has no profile in the tree
    // yet, so only three are resolvable today. The minimum tracks what the vault can
    // identify NOW, not a count that was inflated by a sibling miscount.
    parents: 2,
    spouses: 1,
    children: 3,
    why:
      "Parents, wife Mary Hayes, and his children — Mary (Telfer) Bowden, Andrew " +
      "Telfer, Elizabeth (Telfer) Bolton. His son William 1847 has no profile yet, " +
      "and William 1802 is his BROTHER, not his son.",
  },
  "janet-nichol": {
    // CORRECTED 2026-10-24 from 2 to 1. The vault frontmatter reads
    // "Children: William Telfer (1802–1850)" — ONE child. The old minimum of 2 was
    // taken from data that listed william-telfer-1802 twice, so the guard demanded
    // a duplicate and fired on the pipeline for correctly de-duplicating it. That
    // is a guard protecting a bug: it would have blocked every future regen until
    // someone re-corrupted the data to satisfy it. Minimums must come from the
    // VAULT, never from previously generated data.
    children: 1,
    spouses: 1,
    why: "One child (William Telfer 1802) and one spouse per the vault frontmatter.",
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

/**
 * Distinct entries in a relationship array.
 *
 * 2026-10-24: `count()` counts RAW slots (duplicates included) while `entriesIn()`
 * was returning entries that include duplicates too — but the "lost" report built
 * from it compared against distinct membership, so a duplicate silently looked
 * like a person. git HEAD carried janet-nichol → children:
 * ["william-telfer-1802","william-telfer-1802"] and janet-nichol appears TWICE in
 * the children. The pipeline de-duplicated it to one — correct behaviour — and the
 * guard called it a crown-jewel data loss, blocking the regen.
 *
 * A duplicated entry is not two people. Counting distinct entries is the only
 * measure that means "how many relatives does this person have". Every comparison
 * in this file now uses distinct counts on both sides.
 */
function distinctCount(v) {
  return new Set(entriesIn(v)).size;
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

  // ── 0. Follow declared redirects before judging a rename as data loss ───────
  // A slug can legitimately change when a NEW vault profile makes a previously
  // bare slug ambiguous. On 2026-10-25 the profile `Marion Lawrie (1838–1920)`
  // was added next to the existing `Marion Vida Lawrie (1888–1955)`; both slugify
  // to `marion-lawrie`, so the pipeline gave the 1888 woman her year-qualified
  // slug `marion-lawrie-1888` and wrote the collision to scripts/redirect-log.json.
  // Her record did not vanish — it was RENAMED, and the redirect proves it. The
  // guard used to read only raw slugs, so a legitimate rename fired
  // PROFILE_VANISHED (and the build refused to deploy) even though every person
  // was accounted for. Resolve the baseline slug through the redirect log first;
  // a rename is only excused when the redirect actually lands on a live profile,
  // so a genuine disappearance still fails loudly.
  const REDIRECT_LOG = resolvePath(HERE, "redirect-log.json");
  const redirects = new Map();
  try {
    const log = JSON.parse(readFileSync(REDIRECT_LOG, "utf-8"));
    for (const r of Array.isArray(log) ? log : []) {
      if (r && r.from && r.to) redirects.set(String(r.from), String(r.to));
    }
  } catch {
    // No redirect log — every vanished slug is judged as-is.
  }
  const redirectTarget = (slug) => {
    let cur = slug;
    const seen = new Set();
    while (redirects.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = redirects.get(cur);
    }
    return cur;
  };

  const failures = [];
  const warnings = [];
  const renames = [];
  const declaredShrinks = [];
  const withdrawn = [];
  // Declared removals with no successor. Read here (not at module load) so a malformed
  // file cannot crash the guard into a blind PASS.
  let REMOVED_ENTRIES = {};
  try {
    const raw = JSON.parse(readFileSync(resolvePath(REPO, "src/data/removed-redirects.json"), "utf-8"));
    REMOVED_ENTRIES = raw.removed || {};
  } catch (e) {
    // LOUD, not silent. A swallowed read here would make every declared withdrawal
    // look UNDECLARED — the guard would then report data loss on a correct regen, or
    // (worse, with the polarity reversed) pass blind. Say what failed.
    console.error(`⚠️  guard: could not read src/data/removed-redirects.json (${e.message}) — ` +
                 `declared withdrawals will be judged as data loss.`);
    REMOVED_ENTRIES = {};
  }

  // ── 1. Vanished profiles ────────────────────────────────────────────────────
  for (const [slug, before] of base) {
    if (now.has(slug)) continue;
    const target = redirectTarget(slug);
    if (target !== slug && now.has(target)) {
      // A declared rename that lands on a live record — not data loss. Record it
      // so the run still reports what moved.
      renames.push({ from: slug, to: target, name: before.display_name || before.name || slug });
      continue;
    }
    // ── DECLARED REMOVAL, NO SUCCESSOR (added 2026-10-28) ────────────────────
    // A slug can vanish because the PERSON never existed: `kelson-telfer-1946` was
    // manufactured by the 2008 Supplement's OCR text layer interleaving two lines
    // ("KelsonBOAL,TELFER,"), and two independent readers of the printed page agree
    // there is no child. Removing him is the CORRECTION; refusing to remove him
    // protects a falsehood. src/data/removed-redirects.json already declares such
    // removals with a written reason and date, and that declaration is what makes
    // this pass safe: `to: null` means "withdrawn, there is nobody to redirect to".
    // A declaration is required — an UNDECLARED disappearance still fails here.
    const declaredRemoval = REMOVED_ENTRIES[slug];
    if (declaredRemoval && declaredRemoval.to === null) {
      withdrawn.push({
        slug,
        name: before.display_name || before.name || slug,
        reason: declaredRemoval.reason,
      });
      continue;
    }
    failures.push({
      kind: "PROFILE_VANISHED",
      slug,
      name: before.display_name || before.name || slug,
      detail: redirects.has(slug)
        ? `profile exists in ${baseLabel} but is GONE; its redirect points to "${redirectTarget(slug)}" which is ALSO missing`
        : `profile exists in ${baseLabel} but is GONE from the working data`,
    });
  }

  // ── 2. Relationship counts that shrank ──────────────────────────────────────
  for (const [slug, before] of base) {
    const after = now.get(slug);
    if (!after) continue; // already reported as vanished

    const jewel = CROWN_JEWELS[slug];

    for (const field of RELATIONSHIP_FIELDS) {
      const b = distinctCount(before[field]);
      const a = distinctCount(after[field]);
      if (a >= b) continue; // grew or unchanged — fine

      // Was this shrink deliberately declared?
      if (opts.allowPeople.has(slug) || opts.allow.has(`${slug}:${field}`)) continue;
      // A crown jewel may DECLARE a one-off shrink in its own spec (allowShrink).
      // Declaring it keeps the floor meaningful for every other field; the reason is
      // printed with the receipt, so the exemption is visible and never silent.
      if (jewel && jewel.allowShrink && jewel.allowShrink[field]) {
        declaredShrinks.push({ slug, field, before: b, after: a, reason: jewel.allowShrink[field] });
        continue;
      }

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
      if (field === "allowShrink") continue;
      // Distinct, not raw: a duplicated entry must never satisfy a minimum. That is
      // exactly how janet-nichol's single child passed a minimum of 2 before 2026-10-24.
      const a = distinctCount(after[field]);
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
    renames,
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

    // Renames are reported, never silent: the slug moved, the person did not.
    if (renames.length > 0) {
      console.log("");
      console.log(`ℹ️  ${renames.length} profile slug RENAMED (declared in scripts/redirect-log.json):`);
      for (const r of renames) console.log(`     • ${r.from} -> ${r.to}  (${r.name})`);
    }

    // A withdrawal is a REMOVAL OF A PERSON, so it is never silent: it prints the
    // slug, the name and the declared reason on every run that applies it.
    if (withdrawn.length > 0) {
      console.log("");
      console.log(`ℹ️  ${withdrawn.length} profile(s) WITHDRAWN — declared in src/data/removed-redirects.json (to: null):`);
      for (const w of withdrawn) {
        console.log(`     • ${w.slug} (${w.name}) — record withdrawn, no successor page`);
        console.log(`       reason: ${String(w.reason).slice(0, 160)}${String(w.reason).length > 160 ? "…" : ""}`);
      }
    }

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
