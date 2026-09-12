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
/**
 * Where the vault lives. The vault is a SEPARATE directory that only exists on
 * Mark's machine and on this runner when the workflow checks it out. Resolution
 * order:
 *   1. TELFER_VAULT_PEOPLE   — explicit override (CI sets this)
 *   2. ~/ObsidianVault/...   — Mark's machine
 *   3. <repo>/vault-checkout — CI fallback when the vault is checked out here
 * If NONE exists we cannot audit. In CI that is a hard failure (a guard that
 * silently no-ops is the exact bug this guard exists to prevent). Locally we
 * still fail loudly rather than pretend.
 */
function resolveVaultPeople() {
  const cands = [
    process.env.TELFER_VAULT_PEOPLE,
    join(homedir(), "ObsidianVault", "Family History", "People"),
    join(ROOT, "vault-checkout", "Family History", "People"),
    join(ROOT, "vault-checkout", "People"),
    join(ROOT, "..", "ObsidianVault", "Family History", "People"),
  ].filter(Boolean);
  for (const c of cands) {
    try {
      if (existsSync(c) && readdirSync(c).some((f) => f.endsWith(".md"))) return c;
    } catch { /* keep looking */ }
  }
  return null;
}
// `TELFER_VAULT_PEOPLE=@snapshot` forces the committed-snapshot path, so the CI-mode audit
// can be exercised and negative-tested on the machine that owns the vault.
const FORCE_SNAPSHOT = process.env.TELFER_VAULT_PEOPLE === "@snapshot";
const VAULT_PEOPLE = FORCE_SNAPSHOT ? null : resolveVaultPeople();

/**
 * CI cannot see the vault. Rather than pass blind (or fail merely because the vault is
 * absent, which would block every deploy), the guard falls back to a COMMITTED SNAPSHOT of
 * the vault's Family rows — same rows, same labels. CI then audits FOR REAL against those
 * rows. The snapshot is refreshed locally by scripts/make-family-rows-snapshot.mjs and is
 * committed, so drift shows up in the diff instead of as silence.
 */
const SNAPSHOT = join(ROOT, "scripts/family-rows.snapshot.json");
let snapshot = null;
if (existsSync(SNAPSHOT)) {
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")).files || {};
  } catch (e) {
    console.error(`❌ FAMILY-CELL GUARD: snapshot is corrupt (${e.message}) — refusing to pass blind.`);
    process.exit(1);
  }
}
if (!VAULT_PEOPLE && !snapshot) {
  console.error(
    "❌ FAMILY-CELL GUARD: no vault People dir (tried $TELFER_VAULT_PEOPLE, " +
    "~/ObsidianVault/Family History/People, ./vault-checkout) and no committed snapshot at " +
    SNAPSHOT + ".\n" +
    "   Refusing to pass blind: a guard that cannot see the rows must not report success.\n" +
    "   Fix: run `node scripts/make-family-rows-snapshot.mjs` where the vault lives, commit the result."
  );
  process.exit(1);
}
const AUDIT_SOURCE = VAULT_PEOPLE ? "vault" : "snapshot";

// When the vault IS present, the committed snapshot must still agree with it — otherwise CI
// would audit stale rows and quietly pass. Drift is a hard failure here, not a warning.

// Family-sheet row labels. Only these rows are the sheet; other tables in a body
// are prose and not this guard's business.
import { ROW_LABELS } from "./family-row-labels.mjs";

// Cells that are legitimately not a person and must never be "fixed" into a link.
const NON_PERSON = /^(n\/?a|unknown|none|—|-|–|\?|unmarried|never married|see below|see notes|tbc|tbd)$/i;

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Strip a trailing year range or single year: "William Henry Parker (1893–1968)". */
function stripYears(s) {
  return s.replace(/\([^)]*\d{4}[^)]*\)/g, "").replace(/\b(18|19|20)\d{2}\b/g, "").replace(/[,\s]+$/, "").trim();
}

/** Names are comparable once possessives and punctuation noise are gone. Years are KEPT. */
function nameKey(s) {
  return norm(s)
    .replace(/[’']s\b/g, "")
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Year digits mentioned anywhere in a string, e.g. "(~1836–)" -> [1836], "b. ~1839" -> [1839]. */
const yearsIn = (s) => (norm(s).match(/\b(1[5-9]\d{2}|20\d{2})\b/g) || []).slice();

/** Page identity: page names carry the lifespan, row text often does not. */
const pageKey = (s) => nameKey(stripYears(s));

/**
 * A row text matches a page only when the NAME agrees AND the years do not contradict.
 * e.g. row "James Telfer (~1836–)" must NOT match the page "James Telfer (1832–1845)".
 * If the page has no years on it the name alone is enough.
 */
function matchesPage(rowText, pageName) {
  const rk = nameKey(rowText);
  const pk = nameKey(pageName);
  if (rk !== pk && rk !== pageKey(pageName)) return false;
  const py = yearsIn(stripYears(pageName) === pageName ? "" : pageName);
  const ry = yearsIn(rowText);
  if (py.length && ry.length && !py.some((y) => ry.includes(y))) return false;
  // The row text gives NO year at all and several different people share this exact name
  // (e.g. "Jean Telfer" vs pages 1764-? and 1840-1892). We cannot prove WHICH person the row
  // means, so we must not claim the row is a dead link. Ambiguity is not evidence.
  if (!ry.length && ambiguousNames.has(rk)) return false;
  return true;
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
  // Identity must be the PAGE, not the bare person name. display_name/title are year-stripped
  // forms ("James Telfer"), so indexing them makes every same-named stranger a page match and
  // floods the guard with false offenders (found 2026-09-12, 5 false positives).
  for (const cand of [p.vault_file, p.h1, p.name]) {
    if (!cand) continue;
    const b = basename(String(cand)).replace(/\.md$/i, "");
    if (b) pageNames.add(b);
    // NOTE (2026-09-12): do NOT index the bare surname/year-stripped form here. Doing so made
    // "James Telfer" a matchable identity, so the guard demanded a link for unrelated children
    // who never had a page. Only the FULL page name identifies a person.
  }
}

/**
 * Full name (year-stripped) -> how many DISTINCT pages carry it. When a name maps to more than
 * one page we cannot say which person a bare-text row means, so the guard stays silent.
 */
const ambiguousNames = new Set();
{
  const byKey = new Map();
  for (const n of pageNames) {
    const k = pageKey(n);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(n);
  }
  for (const [k, pageSet] of byKey) if (pageSet.size > 1) ambiguousNames.add(k);
}

// (superseded by the snapshot fallback above — see AUDIT_SOURCE)

const files = VAULT_PEOPLE
  ? readdirSync(VAULT_PEOPLE).filter((f) => f.endsWith(".md"))
  : Object.keys(snapshot);

if (!files.length) {
  console.error(`❌ FAMILY-CELL GUARD: audit source "${AUDIT_SOURCE}" yielded no files — refusing to pass blind.`);
  process.exit(1);
}

/** Yield {file, label, value} for every Family-table row, from vault or snapshot. */
function* familyRows() {
  for (const f of files) {
    if (VAULT_PEOPLE) {
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
        if (cells.length < 4) continue;
        const label = norm(cells[1]).replace(/^\*+\s*|\s*\*+$/g, "").trim();
        if (!ROW_LABELS.has(label)) continue;
        yield { file: f, label, value: cells[2] };
      }
    } else {
      for (const r of snapshot[f] || []) yield { file: f, label: r.row, value: r.value };
    }
  }
}

if (VAULT_PEOPLE && snapshot) {
  const drift = [];
  const snapFiles = new Set(Object.keys(snapshot));
  const vaultRowsByFile = new Map();
  for (const f of readdirSync(VAULT_PEOPLE).filter((x) => x.endsWith(".md"))) {
    let txt;
    try { txt = readFileSync(join(VAULT_PEOPLE, f), "utf8"); } catch { continue; }
    const rows = [];
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length < 4) continue;
      const label = norm(cells[1]).replace(/^\*+\s*|\s*\*+$/g, "").trim();
      if (!ROW_LABELS.has(label)) continue;
      rows.push(`${label}\u0000${cells[2]}`);
    }
    if (rows.length) vaultRowsByFile.set(f, rows);
  }
  for (const [f, rows] of vaultRowsByFile) {
    const snap = snapshot[f];
    if (!snap) { drift.push(`${f}: missing from snapshot`); continue; }
    const sRows = snap.map((r) => `${r.row}\u0000${r.value}`);
    if (sRows.length !== rows.length || sRows.some((v, i) => v !== rows[i])) drift.push(`${f}: rows differ`);
  }
  for (const f of snapFiles) if (!vaultRowsByFile.has(f)) drift.push(`${f}: stale in snapshot`);
  if (drift.length) {
    console.error(
      `❌ FAMILY-CELL GUARD: committed snapshot has drifted from the vault (${drift.length} file(s)).\n` +
      "   Run `node scripts/make-family-rows-snapshot.mjs` and commit scripts/family-rows.snapshot.json.\n" +
      "   First few:\n" + drift.slice(0, 5).map((d) => `     - ${d}`).join("\n")
    );
    process.exit(1);
  }
}

const offenders = [];
let scannedRows = 0;
let linkedCells = 0;

{
  // Labels are written as `| **Spouse** | ... |` in the vault and are normalised inside
  // familyRows() (bold markers stripped), or every bolded row would be silently skipped
  // (found 2026-09-12: 729 bold-labelled rows were outside the guard).
  for (const { file: f, label, value: rawValue } of familyRows()) {
    if (/^-{2,}$/.test(String(rawValue).replace(/[:\s]/g, "-"))) continue; // |---|---|
    scannedRows++;
    const value = rawValue;
    if (!value) continue;
    // A row that already carries a wikilink is only PARTLY linked: these Family cells
    // legitimately mix people who have pages with people who never will (unresearched
    // children, spouses outside the family). A fully dead row is the real offence —
    // flagging partial rows produces noise that gets ignored, and a guard nobody reads
    // is worse than no guard. Offence = row with ZERO links whose name has a page.
    if (value.includes("[[")) { linkedCells++; continue; }
    if (NON_PERSON.test(value)) continue;

    // Does this plain-text name correspond to a real page?
    const candidates = value.split(/\s*(?:,| and | & )\s*/i).map((s) => s.trim()).filter(Boolean);
    for (const cand of candidates) {
      const k = nameKey(cand);
      if (!k || k.length < 3) continue;
      const hit = [...pageNames].find((n) => matchesPage(cand, n));
      if (hit) {
        offenders.push({ file: f, row: label, text: cand, page: hit });
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
console.log(`  audit source: ${AUDIT_SOURCE} · files: ${files.length} · family rows scanned: ${scannedRows} · already linked: ${linkedCells}`);

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
