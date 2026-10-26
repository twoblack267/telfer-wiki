#!/usr/bin/env node
/**
 * META DESCRIPTION HYGIENE — card itc-20261026-1
 *
 * THE DEFECT: the <meta name="description"> for person pages was built by stripping
 * every tag out of the rendered body HTML and taking the first "sentence" of the
 * result. Markdown TABLES, HEADINGS, BLOCKQUOTES and labelled FIELD LINES all survive
 * tag stripping as plain text, so their labels were welded onto the prose:
 *
 *   "Francis Telfer (1809 – 1895). Family Relation Name Father James Telfer (1761–1845)…"
 *   "Effie Olive Telfer (1886–1969) Born: 1886 Died: 1969 Father: Adam Francis Telfer…"
 *
 * 153 of 418 built pages shipped labels, headings or provenance notes as the ONLY text
 * a searcher ever reads. That is a raw data dump in a Google snippet.
 *
 * WHY THIS TEST EXISTS: fixing it took four regex attempts, and the second attempt made
 * it WORSE (9 -> 77 pages) because a greedy label regex ate the real sentence opener.
 * Two attempts deleted the sentence's SUBJECT — "(1809 – 1895). was born on 2 February
 * 1809" — which is worse than the leak. The leak count is the only instrument that
 * caught either. Never judge this by eye.
 *
 * THE FIX: firstProseSentence() no longer strips tags. It deletes the structures that
 * are never prose (table, heading, blockquote, figure, script, style) WITH their
 * contents, splits what remains into blocks at <p>/<li>/<br> boundaries, and takes the
 * first block that is genuinely a sentence.
 *
 * WHAT COUNTS AS A LEAK — deliberately narrow, and it must STAY narrow:
 *   a structural label, heading, welded table header run, or provenance note at the
 *   START of the description.
 *
 * WHAT IS NOT A LEAK:
 *   "Born 1 March 1877 at Kersbrook"       — a real fact, well written
 *   "Mother of Penny Telfer"               — a real relationship, well written
 *   "Born: 16 January 1870 — Kersbrook"    — a DELIBERATE fallback when the profile has
 *                                            no prose at all. A factual line beats a blank.
 *   an empty description                   — correct for living-person stubs holding only
 *                                            dates and a family table; the title is used.
 *
 * A test that fails on good output gets relaxed by the next person in a hurry. Keep it
 * honest and it stays useful.
 */
import fs from "node:fs";
import path from "node:path";

const DIST = path.join(process.cwd(), "dist", "people");

const STRUCTURAL_START = [
  /^(Source|Sources|Source note|Note|Reference|References)\b/i,
  /^(AWM|Roll of Honour|CWGC)\b/,
  /^Family\b/,
  /^(Relation|Name|Child|Born|Died|Buried|Married)\s+(Name|Father|Mother)\b/,
  /^(Photos|Timeline|Family Life Summary|Life Summary|Lifespan)\b/,
];
const WELDED = /\bRelation Name\b/;
const FIELD_ECHO = /^(Also known as|Known as|Maiden name|Married name)\s+\S/;

function leakReason(desc) {
  if (!desc) return null; // empty is a legitimate outcome, not a leak
  const head = desc.slice(0, 90);
  for (const re of STRUCTURAL_START) {
    if (re.test(desc)) return `structural label at start: "${desc.slice(0, 60)}"`;
  }
  if (WELDED.test(head)) return `welded table header: "${head.slice(0, 70)}"`;
  if (desc.length < 90 && FIELD_ECHO.test(desc)) return `field echo: "${desc.slice(0, 60)}"`;
  // Three or more "Word:" labels welded into one sentence is a field run, not prose.
  if ((desc.match(/\b[A-Z][a-z]+:/g) || []).length >= 3) {
    return `welded field run: "${desc.slice(0, 70)}"`;
  }
  return null;
}

function collect(root) {
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const d of dirs) {
    const f = path.join(root, d.name, "index.html");
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, "utf8");
    const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    if (!m) continue;
    const desc = m[1]
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    out.push({ slug: d.name, desc });
  }
  return out;
}

const all = collect(DIST);
if (all.length === 0) {
  // Same rule as every other guard here: no evidence is not a pass.
  console.error("❌ meta-description-hygiene: no built person pages found at " + DIST);
  console.error("   Run `npm run build` first. A gate with nothing to read must not pass silently.");
  process.exit(1);
}

const leaks = [];
let empty = 0;
for (const { slug, desc } of all) {
  if (!desc) {
    empty++;
    continue;
  }
  const reason = leakReason(desc);
  if (reason) leaks.push({ slug, reason });
}

console.log(
  `ℹ️  meta-description-hygiene: ${all.length} page(s) scanned, ${empty} with no description (allowed)`
);

if (leaks.length > 0) {
  console.error(`❌ meta-description-hygiene: ${leaks.length} description(s) leak structural labels`);
  for (const l of leaks.slice(0, 20)) console.error(`   ❌ ${l.slug}  ${l.reason}`);
  if (leaks.length > 20) console.error(`   … and ${leaks.length - 20} more`);
  console.error("");
  console.error("   The renderer is gluing a table, heading, field line or source note onto");
  console.error("   the description. Fix firstProseSentence() in src/pages/people/[slug].astro —");
  console.error("   do NOT relax this test, and do not judge the fix by eye: this count is");
  console.error("   the only thing that catches a fix that makes it worse.");
  process.exit(1);
}

console.log("✅ meta-description-hygiene: no structural labels leak into search snippets");
process.exit(0);
