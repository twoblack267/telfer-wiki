/**
 * Family-cell link guard — the "plain text is invisible" sentry
 * ==============================================================
 * WHY THIS EXISTS (2026-09-12, Mark: "we never want this to happen again")
 * ---------------------------------------------------------------------
 * The Family sheet at the bottom of every person page is NOT generated. It is
 * VAULT-AUTHORED body markdown, converted by scripts/../src/utils/format-body.mjs
 * line ~156, which passes table cells through VERBATIM. A cell only becomes a
 * clickable link when the vault file contains an actual [[wikilink]].
 *
 * Consequence: if the author writes `| Father | William Henry Parker |`, the site
 * renders the name as DEAD TEXT. It looks perfect in the browser and is completely
 * unclickable. That is not a crash — it is a silent quality loss, which is why 222
 * of these sat in the vault undetected. Nothing in the build was watching.
 *
 * THIS GUARD watches. For every vault person file it parses the Family table and
 * finds cells whose text is a bare name (no [[wikilink]]) while a REAL person page
 * for that name exists in people.json. Those are links that should exist and don't.
 *
 * RATCHET, not a wall: the count of such cells can only go DOWN. The committed
 * baseline (scripts/family-cell-links.baseline.json) records today's debt; fixing
 * vault files lowers it. Any NEW plain-text cell that has a matching page fails the
 * build, and the floor tightens automatically when the number improves, so the
 * archive can never quietly regress back.
 *
 * It also writes .family-cell-links.json so pipeline-escalate.py auto-files a board
 * ticket when it fails in CI, where no watcher may be running.
 *
 * Exit 0 = fine. Exit 1 = a name went unlinked that has a page -> build fails.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PEOPLE = join(ROOT, "src/data/people.json");
const BASELINE = join(ROOT, "scripts/family-cell-links.baseline.json");
const REPORT = join(ROOT, ".family-cell-links.json");
const VAULT_PEOPLE = join(homedir(), "ObsidianVault", "Family History", "People");

// Family-sheet row labels. Only these rows are the sheet; other tables in a body
// are prose and not this guard's business.
const ROW_LABELS = new Set([
  "father", "mother", "parents", "spouse", "spouses", "husband", "wife",
  "children", "child", "siblings", "sibling", "brother", "sister", "brothers",
  "sisters", "son", "daughter", "sons", "daughters",
  "stepson", "stepdaughter", "stepfather", "stepmother", "stepchildren",
  "grandson", "granddaughter", "grandfather", "grandmother", "grandchildren",
  "nephew", "niece", "uncle", "aunt", "cousin", "partner", "de facto",
]);

// Cells that are legitimately not a person and must never be "fixed" into a link.
const NON_PERSON = /^(n\/?a|unknown|none|—|-|–|\?|unmarried|never married|see below|see notes|tbc|tbd)$/i;

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Strip a trailing year range or single year: "William Henry Parker (1893–1968)". */
function stripYears(s) {
  return s.replace(/\([^)]*\d{4}[^)]*\)/g, "").replace(/\b(18|19|20)\d{2}\b/g, "").replace(/[,\s]+$/, "").trim();
}

/** Names are comparable once years, possessives and punctuation noise are gone. */
function nameKey(s) {
  return norm(stripYears(s))
    .replace(/[’']s\b/g, "")
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

if (!existsSync(PEOPLE)) {
  console.error(`❌ FAMILY-CELL GUARD: cannot read ${PEOPLE} — refusing to pass blind.`);
  process.exit(1);
}
const people = JSON.parse(readFileSync(PEOPLE, "utf8"));
const list = Array.isArray(people) ? people : Object.values(people);

// Build the set of names that HAVE a page. Filename, H1 and display_name all count,
// because the resolver matches filenames/H1 (NOT the frontmatter title) — see
// board card tw-2026-09-12-011 notes.
const pageNames = new Set();
for (const p of list) {
  for (const cand of [p.vault_file, p.h1, p.display_name, p.title, p.name]) {
    if (!cand) continue;
    const b = basename(String(cand)).replace(/\.md$/i, "");
    const k = nameKey(b);
    if (k) pageNames.add(k);
    // Also index the name WITHOUT the trailing years, for "Parker (1893–1968)" -> "parker"
    for (const piece of String(b).split(/\s{2,}|,\s*/)) {
      const kk = nameKey(piece);
      if (kk) pageNames.add(kk);
    }
  }
}

if (!existsSync(VAULT_PEOPLE)) {
  console.error(`❌ FAMILY-CELL GUARD: vault people dir not found at ${VAULT_PEOPLE} — refusing to pass blind.`);
  process.exit(1);
}

const files = readdirSync(VAULT_PEOPLE).filter((f) => f.endsWith(".md"));
if (!files.length) {
  console.error(`❌ FAMILY-CELL GUARD: no .md files in ${VAULT_PEOPLE} — refusing to pass blind.`);
  process.exit(1);
}

const offenders = [];
let scannedRows = 0;
let linkedCells = 0;

for (const f of files) {
  let txt;
  try {
    txt = readFileSync(join(VAULT_PEOPLE, f), "utf8");
  } catch {
    continue;
  }
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // A body table row: | Label | Value |
    if (cells.length < 4) continue;
    const label = norm(cells[1]);
    if (!ROW_LABELS.has(label)) continue;
    // separator row (|---|---|)
    if (/^-{2,}$/.test(cells[2].replace(/[:\s]/g, "-"))) continue;

    scannedRows++;
    const value = cells[2];
    if (!value) continue;
    if (value.includes("[[")) { linkedCells++; continue; }   // already a wikilink
    if (NON_PERSON.test(value)) continue;

    // Does this plain-text name correspond to a real page?
    const candidates = value.split(/\s*(?:,| and | & )\s*/i).map((s) => s.trim()).filter(Boolean);
    for (const cand of candidates) {
      const k = nameKey(cand);
      if (!k || k.length < 3) continue;
      if (pageNames.has(k)) {
        offenders.push({ file: f, row: label, text: cand });
        break;
      }
    }
  }
}

offenders.sort((a, b) => (a.file + a.row + a.text).localeCompare(b.file + b.row + b.text));

// ---- ratchet -------------------------------------------------------------
let baseline = { unlinked_with_page: null, note: "" };
if (existsSync(BASELINE)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch (e) {
    console.error(`❌ FAMILY-CELL GUARD: baseline is corrupt (${e.message}) — refusing to pass blind.`);
    process.exit(1);
  }
}

const count = offenders.length;
const prev = baseline.unlinked_with_page;

const report = {
  at: new Date().toISOString(),
  vault_files: files.length,
  family_rows_scanned: scannedRows,
  cells_already_linked: linkedCells,
  unlinked_with_page: count,
  baseline: prev,
  files_with_offenders: [...new Set(offenders.map((o) => o.file))].length,
  sample: offenders.slice(0, 40),
  failures: [],
};

const failures = [];
// First run: record the debt, do not fail (we cannot fix history in one step).
if (prev === null || prev === undefined) {
  baseline.unlinked_with_page = count;
  baseline.note =
    "Ratchet baseline recorded " + new Date().toISOString().slice(0, 10) +
    ". This number may only go DOWN. Fix vault Family rows by linking " +
    "[[Page Name|Cell Text]]; never hand-edit people.json.";
  try {
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`FAMILY-CELL GUARD: baseline recorded (${count} unlinked cells with a matching page).`);
  } catch (e) {
    console.error(`❌ could not write baseline: ${e.message}`);
    process.exit(1);
  }
} else if (count > prev) {
  failures.push(
    `unlinked Family cells with a matching page rose ${prev} -> ${count} — a name that HAS a page was left as dead plain text`
  );
} else if (count < prev) {
  // Improvement: tighten the ratchet so it can never come back.
  baseline.unlinked_with_page = count;
  try {
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`FAMILY-CELL GUARD: ratchet tightened ${prev} -> ${count}. Nice.`);
  } catch (e) {
    console.error(`(could not tighten baseline: ${e.message})`);
  }
}

report.failures = failures;
try {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
} catch (e) {
  console.error(`(could not write ${REPORT}: ${e.message})`);
}

console.log(`\nFAMILY-CELL LINKS: ${count} unlinked cell(s) whose name HAS a page — budget ${prev === null ? count : prev}`);
console.log(`  vault files: ${files.length} · family rows scanned: ${scannedRows} · already linked: ${linkedCells}`);

if (failures.length) {
  console.error(`\n❌ FAMILY-CELL LINK GUARD FAILED (${failures.length})`);
  for (const f of failures) console.error(`   • ${f}`);
  console.error("\n   worst files:");
  const byFile = {};
  for (const o of offenders) byFile[o.file] = (byFile[o.file] || 0) + 1;
  const worst = Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [f, n] of worst) console.error(`     - ${f} (${n})`);
  console.error(
    "\nDo NOT hand-edit people.json. Fix the VAULT .md Family row:\n" +
      "  | Father | [[William Henry Parker (1893–1968)|William Henry Parker]] |\n" +
      "then regenerate. Escalation: npm run escalate\n"
  );
  process.exit(1);
}

process.exit(0);
