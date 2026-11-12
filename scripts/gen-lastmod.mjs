#!/usr/bin/env node
/**
 * gen-lastmod.mjs — build a committed slug -> lastmod date map.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sitemap needs a <lastmod> per URL so Google knows what changed and what
 * to recrawl. The natural source is the git date of each person's own markdown
 * file in the OBSIDIAN VAULT.
 *
 * That works locally but NOT in CI: the vault is a separate git repo at an
 * absolute path (/Users/marktelfer/ObsidianVault) which is simply absent on an
 * Ubuntu runner. An earlier version called git against that path from
 * astro.config.ts; in CI every lookup failed, every person fell back to the
 * same value (the checkout time), and the published sitemap carried ONE
 * identical timestamp across all 981 URLs — measured, 2026-09-21.
 *
 * So we resolve dates HERE, on the machine that has the vault, and write them
 * into src/data/lastmod.json, which IS committed. The Astro config then just
 * reads that file: same dates locally and in CI, no git needed at build time.
 *
 * RUN:  node scripts/gen-lastmod.mjs     (after any vault change, before commit)
 *
 * FALLBACK: a person with no matching vault file simply gets no entry; the
 * config then omits <lastmod> for that page rather than inventing one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const VAULT_DIR = "/Users/marktelfer/ObsidianVault";
const VAULT_PEOPLE_DIR = "Family History/People";

/** git last-commit date (ISO) for a path inside a repo; null on any failure. */
function gitDate(repoDir, relPath) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--follow", "--", relPath], {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (!out) return null;
    const d = new Date(out);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** "Adam Murray (1728–1816) — Father of..." -> "adam murray" (name only). */
function personName(s) {
  return s
    .split("—")[0]
    .split(" - ")[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    // Collapse runs of whitespace BEFORE returning. personKeys() strips
    // surrounding quotes to spaces, so "Francis Charles 'Charlie' Telfer"
    // became "francis charles  charlie  telfer" (double spaces) and then
    // matched NO vault filename — the one 99.8%-coverage miss, measured
    // 2026-11-05. Harmless for keys that were already single-spaced.
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Normalise a person key so a wiki title can be matched against a vault
 * filename that spells the same person differently.
 *
 * Two shapes occur in the data (measured 2026-09-24 — exactly one person each):
 *   "noela pauline virgen, née wode"  -> "noela pauline virgen"
 *   "clara blanche telfer/lane"       -> allowed as BOTH "clara blanche telfer"
 *                                        and "clara blanche lane"
 *
 * Returns an ARRAY of acceptable keys (usually one). Every key is only ever
 * ADDED to the search space; nothing that matches today can stop matching.
 */
function personKeys(s) {
  // strip a mid-string nickname before anything else:
  //   "francis charles 'charlie' telfer" -> "francis charles telfer"
  //   "william francis \"frank\" telfer"  -> "william francis telfer"
  //
  // Blank the quote CHARACTERS only; do not leave a gap behind. The previous
  // form replaced quotes with " " and relied on a later whitespace collapse,
  // which never happened inside personName() — so "Francis Charles 'Charlie'
  // Telfer" produced the key "francis charles charlie telfer" (nickname kept,
  // double spaces) and matched no vault file. Measured 2026-11-05.
  // Then drop the mid-string nickname ENTIRELY: quoted text is never part of
  // the surname a vault filename carries, and vault files are named
  // "Francis Charles Telfer (1875–1954).md" — no nickname. Deleting only the
  // quote marks left "charlie" sitting in the key and still matched nothing.
  const bare = personName(s.replace(/['"‘’“”][^'"‘’“”]*['"‘’“”]/g, " "));
  const keys = [];
  // BRACKETED EPITHETS ARE NOT PART OF THE NAME (added 2026-11-05).
  // These two were the only surname corrections that lost their <lastmod>:
  //   "James (of Sorbietrees) Telfer"  -> vault file "James Telfer (of Sorbietrees) (~1740–?).md"
  //   "William (shepherd) Telfer"      -> vault file "William Telfer (shepherd).md"
  // The epithet sat where the surname used to, so the key became
  // "james of sorbietrees telfer" and no vault name matched it. Strip the
  // bracketed run to get the plain "james telfer" key. ADDED ONLY, never
  // replaces a key: if the plain form is ambiguous the matchVaultFile
  // refusal still applies, and a suffix for the epithet means a
  // <lastmod> they did have before is never removed.
  const noBracket = bare.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (noBracket && noBracket !== bare) keys.push(noBracket);
  // strip a trailing ", née X" / ", nee X" married-name annotation
  const noNee = bare.replace(/,\s*n(?:é|e)e\s+.*$/, "").trim();
  if (noNee) keys.push(noNee);
  // "telfer/lane" -> try "… telfer" and "… lane"
  if (noNee.includes("/")) {
    const parts = noNee.split("/").map((p) => p.trim()).filter(Boolean);
    // "clara blanche telfer" + "lane"  =>  rebuild with the alternate surname
    if (parts.length >= 2) {
      const head = parts[0].split(/\s+/);
      head.pop(); // drop the first surname
      for (const alt of parts) {
        const tail = alt.split(/\s+/).pop();
        const rebuilt = [...head, tail].join(" ").trim();
        if (rebuilt) keys.push(rebuilt);
      }
    }
  }
  return [...new Set(keys.filter(Boolean))];
}

/**
 * "Adam Murray (1728–1816).md" -> { name:"adam murray", first:"adam",
 * last:"murray", tokens:[...], year:"1728" }
 */
function manifestParts(fname) {
  const bare = fname.replace(/\.md$/i, "").trim();
  const name = bare.replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase();
  const years = bare.match(/\((\d{3,4})[–\-]/);
  const tokens = name.split(/\s+/).filter(Boolean);
  return {
    name,
    first: tokens[0] || "",
    last: tokens[tokens.length - 1] || "",
    tokens,
    year: years ? years[1] : null,
  };
}

/**
 * Match a wiki person to a vault file, using the person's OWN birth_year field.
 *
 * NOTE: do NOT extract the year from the title. Titles look like
 *   "Joel Ivory — Family & Biography"
 * with no year at all, while the record carries birth_year: 1986 separately.
 * An earlier version parsed the title and silently matched almost nothing.
 *
 * PASS 1 — exact full-name match, so nothing that already worked can regress.
 * PASS 2 — first name + surname + birth_year, trying EVERY surname token of the
 * vault filename (not just the last). Needed because vault filenames carry
 * MAIDEN surnames the wiki title omits:
 *   wiki  "Martha Ann Masters"  birth_year 1839  (slug martha-masters-1839)
 *   vault "Martha Ann Masters Radford (1839–1912).md"
 * Matching on the exact triple (never fuzzy): a near-match could stamp a LIVING
 * person's page with a stranger's date. Ambiguous candidates -> no match at all.
 * This is deliberate, not a gap. Example:
 *   francis-telfer-1875 -> "francis|telfer|1875" matches BOTH
 *   "Francis Adam Telfer (1875–1955).md" and "Francis Charles Telfer (1875–1954).md".
 * Two different men, same first name, same surname, same birth year. No code can
 * tell which page belongs to which, so this page gets NO <lastmod> — honestly.
 */
function matchVaultFile(person, byName, byTriple) {
  const keys = personKeys(person.title || person.name || "");
  const year = String(person.birth_year || "").trim();

  for (const k of keys) {
    const cands = byName.get(k);
    if (!cands || cands.length === 0) continue;
    if (cands.length === 1) return { file: cands[0], how: "exact" };

    // Several vault files share this name. Disambiguate by BIRTH YEAR using the
    // year in the filename ("William Telfer (1841).md"). Without this, the
    // newest-changed namesake wins and its revision date is published on this
    // person's page — the 1841 William showed the 1847 William's date,
    // measured 2026-11-03. Prefer a single year match; if the year narrows to
    // nothing or to several, fall through to the triple/prefix passes rather
    // than guessing.
    if (/^\d{3,4}$/.test(year)) {
      const byYear = cands.filter((f) => {
        const m = f.match(/\((\d{3,4})[–\-)]/);
        return m && m[1] === year;
      });
      if (byYear.length === 1) return { file: byYear[0], how: "exact+birth-year" };
    }
    // No year to go on: the newest file is the only defensible choice, but it
    // is a WEAK match and flagged as such.
    return { file: cands[0], how: "exact-name-collision" };
  }

  const y = year;
  // NOTE (2026-11-13): this early return used to strand EVERY page without a birth_year
  // before passes 3-5 could run. "Elizabeth Mansfield" has birth_year null (her birth year
  // is genuinely unknown — the obituary age and the 1840 marriage date conflict), so she
  // could never reach the bracket pass below. A missing year is a reason to skip the
  // YEAR-based passes, not a reason to abandon name matching entirely.
  const hasYear = /^\d{3,4}$/.test(y);

  if (hasYear) {
    for (const k of keys) {
      const toks = k.split(/\s+/).filter(Boolean);
      const first = toks[0] || "";
      const last = toks[toks.length - 1] || "";
      if (!first || !last) continue;
      const cands = byTriple.get(`${first}|${last}|${y}`);
      if (!cands || cands.length !== 1) continue; // ambiguous -> try next key shape
      return { file: cands[0], how: "first+last+year" };
    }
  }

  // Pass 3 (added 2026-09-25): the wiki title may DROP the family surname that the vault
  // filename carries. "Florence Nicholas — Family & Biography" (slug florence-nicholas) is
  // Florence Nicholas TELFER on disk, so free-text matching finds neither a full-name key nor
  // a first|last|year triple. Match only when the wiki key is a PREFIX-WORD-RUN of exactly one
  // vault name key, and refuse if more than one vault file answers. Same refusal-not-guess rule.
  const prefixCands = [];
  for (const [vk, vfs] of byName) {
    const vt = vk.split(/\s+/).filter(Boolean);
    if (vt.length <= toks2len(keys)) continue;
    if (vt.slice(0, toks2len(keys)).join(" ") !== keys[0]) continue;
    // byName values are now ARRAYS of same-named files (newest first).
    for (const vf of vfs) prefixCands.push(vf);
  }
  if (prefixCands.length === 1) return { file: prefixCands[0], how: "wiki-key-is-prefix-of-vault-name" };

  // Pass 4 (added 2026-11-13): the vault filename carries a MAIDEN name where the wiki
  // key carries the MARRIED one, so neither a full-name key nor a first|last|year triple
  // can reach it. Measured on two real pages:
  //   page "Sylvia Mabel Olive Kennett"   -> file "Sylvia Mabel Olive Sparrow.md"
  //   page "Elizabeth Mansfield"          -> file "Elizabeth Telfer (Mrs Mansfield).md"
  // Both were enriched on 2026-11-13 and both silently lost <lastmod> AND their JSON-LD
  // dateModified, which failed the schema-freshness gate. Renaming the vault files was the
  // wrong fix: 6 wikilinks point at those names and the filenames are Mark's data.
  // So match on the GIVEN-NAME RUN, which both sides share, and accept ONLY when exactly
  // one vault file agrees. Every token after the first must match positionally up to the
  // point where they diverge, and the diverging token must be a single word on BOTH sides
  // (a surname swap), never a different person with extra given names.
  const wikiTokens = (keys[0] || "").split(/\s+/).filter(Boolean);
  if (wikiTokens.length >= 2) {
    const swapCands = [];
    for (const [vk, vfs] of byName) {
      // byName keys are already bracket-stripped by manifestParts, but a vault filename like
      // "Elizabeth Telfer (Mrs Mansfield).md" keeps "telfer" as its surname token — the married
      // name lives only inside the brackets. Compare on the bracket-free key, and ALSO allow the
      // page title's surname to appear anywhere in the original filename (brackets included):
      // that is the only signal that this Mansfield is the same person as that Telfer.
      const vt = vk.split(/\s+/).filter(Boolean);
      if (vt.length !== wikiTokens.length) continue;
      if (vt[0] !== wikiTokens[0]) continue;
      const diff = [];
      for (let i = 0; i < vt.length; i++) if (vt[i] !== wikiTokens[i]) diff.push(i);
      const surnameSwap =
        diff.length === 1 && diff[0] === vt.length - 1;
      const bracketCarriesSurname = diff.length === 1 && vfs.some((vf) =>
        new RegExp(`\\([^)]*\\b${wikiTokens[wikiTokens.length - 1]}\\b[^)]*\\)`, "i").test(vf),
      );
      if (!surnameSwap && !bracketCarriesSurname) continue;
      for (const vf of vfs) swapCands.push(vf);
    }
    if (swapCands.length === 1) return { file: swapCands[0], how: "given-name-run+surname-swap" };
  }

  // Pass 5 (added 2026-11-13, same day, second case): "Elizabeth Mansfield" vs
  // "Elizabeth Telfer (Mrs Mansfield).md" — the married surname exists ONLY inside the
  // bracket, and the token counts differ (2 vs 2 after bracket-strip, but the surname
  // token is "telfer" not "mansfield"). Rule: the page's surname must appear as a whole
  // word inside a parenthetical in the vault filename, and the given-name run before it
  // must match. Exactly one candidate or nothing.
  if (wikiTokens.length >= 2) {
    const surname = wikiTokens[wikiTokens.length - 1];
    const given = wikiTokens.slice(0, -1).join(" ");
    const cands = [];
    for (const [vk, vfs] of byName) {
      const vt = vk.split(/\s+/).filter(Boolean);
      if (vt.slice(0, -1).join(" ") !== given) continue;
      for (const vf of vfs) {
        const brackets = vf.match(/\([^)]*\)/g) || [];
        if (brackets.some((b) => new RegExp(`\\b${surname}\\b`, "i").test(b))) cands.push(vf);
      }
    }
    if (cands.length === 1) return { file: cands[0], how: "surname-in-bracket" };
  }

  return null;
}

function toks2len(keys) {
  return (keys[0] || "").split(/\s+/).filter(Boolean).length;
}

// 1. vault filename -> git date, once per file (cheap: ~380 git calls max).
const vaultFiles = (() => {
  try {
    const man = JSON.parse(readFileSync(resolve(ROOT, "src/data/vault-manifest.json"), "utf-8"));
    return Object.keys(man.files || {});
  } catch (e) {
    console.error("FATAL: cannot read vault-manifest.json:", e.message);
    process.exit(1);
  }
})();

/** Read `last_revision: YYYY-MM-DD` from a vault file's YAML frontmatter.
 *
 * ADDED 2026-11-03. The vault file is now the SOURCE OF TRUTH for when a record
 * last changed: every person file carries exactly one `last_revision` line,
 * rewritten by ~/.hermes/scripts/stamp-vault.py whenever a job edits the file.
 *
 * This matters because git and the file disagreed. Adam Dillon's profile said
 * `date: 2026-06-20` while its last commit was 2026-09-17 — three months stale.
 * Reading the field first means the website shows what the record itself
 * claims, and a human opening the .md in Obsidian sees the same date.
 *
 * Falls back to the git commit date only when the field is absent, so a file
 * that has not been stamped yet still gets a usable date.
 */
function revisionDate(repoDir, relPath) {
  try {
    const text = readFileSync(resolve(repoDir, relPath), "utf-8");
    const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (fm) {
      const m = fm[1].match(/^last_revision:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
      if (m) {
        // Anchor to UTC MIDDAY, not local midnight. A date is a calendar day,
        // not an instant: `new Date("2026-11-03T00:00:00+10:00")` is
        // 2026-11-02T14:00Z, and BaseLayout renders it back in Australia/
        // Brisbane on the previous day for any consumer that reads the ISO
        // string. Midday UTC survives formatting in every timezone the site
        // might be built or read in, measured 2026-11-03.
        const d = new Date(`${m[1]}T12:00:00Z`);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    }
  } catch {
    // fall through to git
  }
  return gitDate(repoDir, relPath);
}

const fileDate = new Map();
for (const f of vaultFiles) {
  const d = revisionDate(VAULT_DIR, `${VAULT_PEOPLE_DIR}/${f}`);
  if (d) fileDate.set(f, d);
}
console.log(`vault files: ${vaultFiles.length}, with git dates: ${fileDate.size}`);

// 2. Build both lookup indexes from the vault filenames:
//    byName   : "adam murray"       -> file  (exact match, pass 1)
//    byTriple : "adam|murray|1728"  -> [file] (first+surname-token+year, pass 2)
//
// NOTE: byName is keyed on the FULL vault name and picks the NEWEST date when
// several files share a name. An earlier rewrite used a plain .set() (last file
// won) and silently reset 16 people to the oldest date in the whole set — keep
// the "newest wins" comparison.
//
// byTriple indexes EVERY surname token, not just the last one, so a maiden name
// carried mid-filename is reachable:
//   "Martha Ann Masters Radford (1839–1912).md" -> martha|masters|1839  AND
//                                                  martha|radford|1839
// This was checked against all 370 people (2026-09-24): it closes 4 gaps and
// creates ZERO multiple-candidate keys. Keeping the `length !== 1` guard means a
// token that names two different people still refuses rather than guessing.
const byName = new Map();
const byTriple = new Map();
for (const [f, d] of fileDate) {
  const m = manifestParts(f);
  if (!m.name) continue;
  // Compare as TIMESTAMPS, never as strings. git %cI carries the committer's local
  // offset ("2026-10-25T19:57:39+10:00" vs "2026-10-11T12:01:44+10:00"); lexicographic
  // comparison of ISO strings with differing offsets orders them wrongly and would
  // silently pick the older date for a name shared by two files.
  //
  // Store ALL files for a name, ordered newest-first, instead of collapsing to the
  // single newest. Collapsing lost the year: five files are named "william telfer",
  // and the newest (b. 1847) was handed to the page for the 1841 man, so
  // /people/william-telfer-1841/ showed 2026-11-02 while its own vault file said
  // 2026-10-30 — one person's revision date published on another person's page,
  // measured 2026-11-03. matchVaultFile now filters these by the person's birth year.
  const arr = byName.get(m.name) || [];
  if (!arr.includes(f)) arr.push(f);
  arr.sort((a, b) => Date.parse(fileDate.get(b)) - Date.parse(fileDate.get(a)));
  byName.set(m.name, arr);

  if (m.year && m.first && m.tokens.length >= 2) {
    for (let i = 1; i < m.tokens.length; i++) {
      const k = `${m.first}|${m.tokens[i]}|${m.year}`;
      const t = byTriple.get(k) || [];
      t.push(f);
      byTriple.set(k, t);
    }
  }
}

// 3. slug -> date, via the people data the pages actually render from.
const people = JSON.parse(readFileSync(resolve(ROOT, "src/data/people.public.json"), "utf-8"));
const out = {};
let hit = 0;
let hitExact = 0;
let hitTriple = 0;
const misses = [];
for (const p of people) {
  if (!p.slug) continue;
  const human = (p.title || p.name || "").trim();
  if (!human) continue;
  const m = matchVaultFile(p, byName, byTriple);
  const d = m ? fileDate.get(m.file) : null;
  if (d) {
    out[p.slug] = d;
    hit++;
    if (m.how === "exact") hitExact++;
    else hitTriple++;
  } else {
    misses.push(`${p.slug}  (${human})`);
  }
}

const payload = {
  generated_at: new Date().toISOString(),
  vault_dir: VAULT_DIR,
  source: "git last-commit dates of Obsidian vault person files",
  count: hit,
  // Non-person pages: honest git date of the source file that renders them.
  // /people/families/<surname>/ has no vault file of its own — it is generated
  // from families/index.astro — so it inherits THAT file's date. Resolved here,
  // on the machine that has the repo history, because CI has no git history for
  // it and a build-time fallback would restamp all 164 lists on every deploy.
  // Measured 2026-11-05: all 165 families URLs shipped with no <lastmod> at all.
  pages: (() => {
    const p = {};
    const fam = gitDate(ROOT, "src/pages/people/families/index.astro");
    if (fam) {
      const FAM_DIR = resolve(ROOT, "dist/people/families");
      if (existsSync(FAM_DIR)) {
        // Old dirty surname slugs keep a redirect stub so a published URL never
        // 404s, but a stub must not be advertised as a page: it is noindex and it
        // is not the family's address. Measured 5 Nov 2026, when 25 stubs briefly
        // carried a lastmod and could have been listed.
        const STUBS = new Set(
          Object.keys(
            JSON.parse(readFileSync(resolve(ROOT, "src/data/history/family-slug-aliases.json"), "utf-8")),
          ).filter((k) => k !== "_comment"),
        );
        p["/people/families/"] = fam;
        for (const dir of readdirSync(FAM_DIR, { withFileTypes: true })) {
          if (!dir.isDirectory() || STUBS.has(dir.name)) continue;
          p[`/people/families/${dir.name}/`] = fam;
        }
      }
    }
    return p;
  })(),
  people: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))),
};

const dest = resolve(ROOT, "src/data/lastmod.json");
writeFileSync(dest, JSON.stringify(payload, null, 2) + "\n");

const pct = ((100 * hit) / people.length).toFixed(1);
console.log(`matched ${hit}/${people.length} people (${pct}%)  [exact ${hitExact}, first+last+year ${hitTriple}]`);
console.log(`wrote ${dest}`);
if (misses.length) {
  console.log(`\nno vault match (${misses.length}) — these get NO <lastmod>, not a guessed one:`);
  for (const m of misses.slice(0, 20)) console.log("  " + m);
  if (misses.length > 20) console.log(`  ... and ${misses.length - 20} more`);
}
