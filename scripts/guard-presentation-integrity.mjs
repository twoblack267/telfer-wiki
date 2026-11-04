#!/usr/bin/env node
/**
 * guard-presentation-integrity.mjs — fails the build if the human-facing
 * presentation rules from 2026-11-03 are broken again.
 *
 * Mark's instruction: "let's make sure never changes back". A one-off edit to a
 * template is not a guarantee; these rules are the guarantee. Each rule below
 * names the failure it prevents and greps the BUILT dist/ output, not the
 * source, so a change anywhere in the chain that reintroduces the defect is
 * caught at the last possible moment.
 *
 * Rules
 *  P1  Footer must credit Mark Telfer by name, and must NOT credit an AI
 *      persona ("Skippy the Magnificent", "The Librarian"). A human visitor
 *      needs a human to trust.
 *  P2  The footer must render exactly ONE site-information nav. A second
 *      identical menu after it is the duplicate-navigation defect.
 *  P3  The word "Deceased" must not appear as a per-person label on index
 *      pages. Only living / dated status may be described, and unknown dates
 *      are described as unknown — never as alive.
 *  P4  Clinical phrasing "No death record" must not appear in built output.
 *  P5  Long directories must expose jump links (data-jump / data-letter) so a
 *      visitor is never forced to scroll the whole page.
 *  P6  The "Help Us Complete the Record" section must exist on the people
 *      index whenever any profile has no birth and no death year.
 *  P7  The contact page must publish the address as SELECTABLE TEXT, not only
 *      inside a mailto: link. A mailto:-only page is a dead end on any device
 *      with no mail app configured — the tap silently does nothing.
 *  P8  Every "Send in a record" call to action must name the address on the
 *      page itself, so a visitor never has to reach a working mail client
 *      before they can contribute.
 *
 * Usage: node scripts/guard-presentation-integrity.mjs [distDir]
 * Exit 0 = clean, 1 = violations (printed with file and rule).
 */
import fs from "node:fs";
import path from "node:path";

const DIST = process.argv[2] || "dist";
const violations = [];

function readIf(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// Violation paths must name the directory ACTUALLY scanned, so a run against an
// alternate dist (a negative test, a staging build) never reports a path the
// reader will look for in the wrong place.
function rel(p) {
  const root = path.resolve(DIST);
  const abs = path.resolve(p);
  return abs.startsWith(root) ? path.relative(root, abs) : p;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".html")) acc.push(p);
  }
  return acc;
}

if (!fs.existsSync(DIST)) {
  console.error(`guard-presentation-integrity: ${DIST}/ not found — run the build first.`);
  process.exit(1);
}

const htmlFiles = walk(DIST);
const home = readIf(path.join(DIST, "index.html"));
const peopleIndex = readIf(path.join(DIST, "people", "index.html"));

// ── P1 — footer attribution ────────────────────────────────────────────────
if (home) {
  if (!/compiled and maintained by Mark Telfer|Research, transcription and site development by Mark Telfer/.test(home)) {
    violations.push({
      rule: "P1",
      file: rel(path.join(DIST, "index.html")),
      msg: "Footer does not credit Mark Telfer by name.",
    });
  }
  if (/Skippy the Magnificent|The Librarian/.test(home)) {
    const m = home.match(/.{0,80}(Skippy the Magnificent|The Librarian).{0,80}/);
    violations.push({
      rule: "P1",
      file: rel(path.join(DIST, "index.html")),
      msg: `AI persona still credited in output: "${m ? m[0].replace(/\s+/g, " ").trim() : "?"}".`,
    });
  }
}

// AI persona in ANY built page's footer block (catches a second layout).
for (const f of htmlFiles) {
  const s = readIf(f) || "";
  const footer = s.slice(s.lastIndexOf("<footer"), s.lastIndexOf("</footer>") + 9 || undefined);
  if (footer && /Skippy the Magnificent|The Librarian/.test(footer)) {
    violations.push({ rule: "P1", file: rel(f), msg: "AI persona credited in a page footer." });
  }
}

// ── P2 — no duplicate navigation ───────────────────────────────────────────
// The defect Mark reported: "two identical navigation menus rendering one after
// the other". Two separate faults can cause it, so both are checked.
//
// P2a — duplicated footer block: exactly one site-information nav.
// P2b — duplicated header links: every header link target must appear ONCE in
//       the header, not once per breakpoint. Hiding a copy with CSS does not
//       make it absent from the DOM, and that is precisely what went wrong.
const HEADER_LINK = /<nav class="border-b-2[\s\S]*?<\/nav>/;

for (const f of [path.join(DIST, "index.html"), path.join(DIST, "people", "index.html"), path.join(DIST, "about", "index.html")]) {
  const s = readIf(f);
  if (!s) continue;

  const infoNavs = (s.match(/aria-label="Site information"/g) || []).length;
  if (infoNavs !== 1) {
    violations.push({
      rule: "P2a",
      file: rel(f),
      msg: `Expected exactly 1 site-information nav in the footer, found ${infoNavs}.`,
    });
  }

  const header = s.match(HEADER_LINK);
  if (header) {
    const hrefs = [...header[0].matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    // The brand link legitimately points at home, same as the Home item.
    const counts = {};
    for (const h of hrefs) counts[h] = (counts[h] || 0) + 1;
    const dupes = Object.entries(counts).filter(([, n]) => n > 1);
    // Brand + Home is one allowed pair; anything above two is a duplicated menu.
    const realDupes = dupes.filter(([h, n]) => n > 2 || (n > 1 && h !== "/" && !h.endsWith("/index.html") && h !== "/telferwiki/"));
    if (realDupes.length) {
      violations.push({
        rule: "P2b",
        file: rel(f),
        msg: `Header renders duplicate links: ${realDupes.map(([h, n]) => `${h} x${n}`).join(", ")}.`,
      });
    }
    if (hrefs.length > 0 && hrefs.length !== new Set(hrefs).size + 1) {
      violations.push({
        rule: "P2b",
        file: rel(f),
        msg: `Header link count ${hrefs.length} exceeds distinct targets + 1 brand link — a second menu is rendered in the DOM.`,
      });
    }
  }
}

// ── P3 / P4 — vocabulary ───────────────────────────────────────────────────
// Scope: DIRECTORY pages only (the people/families indexes). Person detail
// pages legitimately contain the word inside quoted newspaper transcriptions
// ("Deceased leaves a widow...") and inside proper names of external archives
// ("Deceased Search"). Policing those would force us to alter quotations —
// which the archive must never do.
const directoryPages = htmlFiles.filter((f) =>
  /[\\/]people[\\/](index\.html|families[\\/](index\.html)?|[^\\/]+[\\/]index\.html)$/.test(f) &&
  !/families[\\/][^\\/]+[\\/]index\.html$/.test(f),
);

// A printed per-person status label looks like: a span/div whose entire text is
// "Deceased". That is the defect. Anything inside running prose is not.
const DECEASED_LABEL = />\s*Deceased\s*</;
for (const f of directoryPages) {
  const s = readIf(f) || "";
  if (DECEASED_LABEL.test(s)) {
    violations.push({ rule: "P3", file: rel(f), msg: 'Prints "Deceased" as a per-person label.' });
  }
}
for (const f of htmlFiles) {
  const s = readIf(f) || "";
  if (/No death record/.test(s)) {
    violations.push({ rule: "P4", file: rel(f), msg: 'Clinical phrasing "No death record" in output.' });
  }
}

// ── P5 — jump links on large directories ───────────────────────────────────
if (peopleIndex) {
  if (!/data-jump=/.test(peopleIndex)) {
    violations.push({
      rule: "P5",
      file: rel(path.join(DIST, "people", "index.html")),
      msg: "People index has no A–Z jump links (data-jump).",
    });
  }
}

// ── P6 — Help Us Complete the Record ───────────────────────────────────────
try {
  const people = JSON.parse(
    fs.readFileSync("src/data/people.public.json", "utf8"),
  );
  const undatedInScope = people.filter(
    (p) => (p.branch === "telfer" || !p.branch) && p.id && !p.birth_year && !p.death_year,
  );
  if (undatedInScope.length > 0 && peopleIndex) {
    if (!/Help Us Complete the Record/.test(peopleIndex)) {
      violations.push({
        rule: "P6",
        file: rel(path.join(DIST, "people", "index.html")),
        msg: `${undatedInScope.length} undated profiles exist but no "Help Us Complete the Record" section is rendered.`,
      });
    }
    if (!/id="complete-the-record"/.test(peopleIndex)) {
      violations.push({
        rule: "P6",
        file: rel(path.join(DIST, "people", "index.html")),
        msg: 'Missing anchor id="complete-the-record" for the jump link.',
      });
    }
  }
} catch {
  /* people.public.json absent in some build modes — skip P6 */
}

// ── P7 — the contact address must be visible text ──────────────────────────
// NOTE: this rule only sees the BUILD OUTPUT. Cloudflare Scrape Shield can still
// rewrite the address at the edge (Email Obfuscation) into an
// <a href="/cdn-cgi/l/email-protection" class="__cf_email__"> — which turns plain
// text back into a mailto-only dead end AFTER a green build. That setting was
// found ON for telferwiki.com on 2026-11-04 and turned OFF (zone setting
// email_obfuscation). Verify live HTML, not just dist/, with:
//   curl -s https://telferwiki.com/contact/ | grep -c __cf_email__   -> must be 0
//   curl -s https://telferwiki.com/contact/ | grep -c contact@telferwiki.com

// Verified defect 2026-11-04: /contact/ published the address only inside a
// mailto: link and a mailto: form. On a phone with no mail client configured
// the tap does nothing and the visitor concludes the site is broken. The
// address must exist as plain, selectable text on the page.
const CONTACT_EMAIL_TEXT = /contact@telferwiki\.com/;

// Cloudflare Email Obfuscation rewrites a real address into a __cf_email__ anchor at
// the edge. If it ever appears in a built file, something upstream injected it and
// the "select and copy" path is broken again.
if (process.env.GUARD_CHECK_LIVE) {
  const { execSync } = await import("node:child_process");
  const live = ["/contact/", "/people/", "/people/families/"];
  for (const p of live) {
    let body = "";
    try {
      body = execSync(`curl -s --max-time 25 https://telferwiki.com${p}`, { encoding: "utf8" });
    } catch {
      continue;
    }
    if (/__cf_email__/.test(body)) {
      violations.push({
        rule: "P7L",
        file: `live:${p}`,
        msg: "Cloudflare Email Obfuscation is rewriting the address into a __cf_email__ anchor — the address is no longer selectable text. Turn off Scrape Shield > Email Obfuscation.",
      });
    }
    if (!CONTACT_EMAIL_TEXT.test(body.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, ""))) {
      violations.push({ rule: "P7L", file: `live:${p}`, msg: "Live page does not expose the contact address as visible text." });
    }
  }
}
const contactPage = readIf(path.join(DIST, "contact", "index.html"));
if (contactPage) {
  const visible = contactPage.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "");
  if (!CONTACT_EMAIL_TEXT.test(visible)) {
    violations.push({
      rule: "P7",
      file: rel(path.join(DIST, "contact", "index.html")),
      msg: "Contact address appears only inside links — not as selectable text. A mailto:-only page fails on devices with no mail app.",
    });
  }
  if (!/What to Write|four prompts/i.test(contactPage)) {
    violations.push({
      rule: "P7",
      file: rel(path.join(DIST, "contact", "index.html")),
      msg: "No guidance on what a contributor should send (who / when / where / source).",
    });
  }
} else {
  violations.push({ rule: "P7", file: rel(path.join(DIST, "contact", "index.html")), msg: "Contact page missing from build." });
}

// ── P8 — contribution CTAs must name the address in place ──────────────────
// A CTA that leads to a page which may not work is not a contribution path.
// Wherever the "Send in a record" link is rendered, the address is printed
// alongside it, so the visitor can act without leaving the page.
// Discovered by scanning every built page, not by a hardcoded list. A hand-written
// scope silently missed people/families/index.html on the first pass — the second
// CTA site — so the scope is now whatever the build actually contains.
const CTA_PAGES = htmlFiles.filter((f) => /Send in a record/.test(readIf(f) || ""));
for (const f of CTA_PAGES) {
  const s = readIf(f) || "";
  if (!CONTACT_EMAIL_TEXT.test(s.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, ""))) {
    violations.push({
      rule: "P8",
      file: rel(f),
      msg: 'Renders "Send in a record" without printing the contact address on the page.',
    });
  }
}

// ── P9 — no bare dash as a table value ─────────────────────────────────────
// A cell holding only "—" / "–" / "-" is a database placeholder leaked into the
// page. The case that forced the rule: a boy who died at 13 had a dash forced
// into the *Married* column, which reads on the page as a note about the child
// rather than an empty field. Blank is correct; a dash is editorial.
for (const f of htmlFiles) {
  const s = readIf(f) || "";
  if (!/<table/.test(s)) continue;
  const dashes = [...s.matchAll(/<td[^>]*>\s*[—–-]\s*<\/td>/g)];
  if (dashes.length) {
    violations.push({
      rule: "P9",
      file: rel(f),
      msg: `${dashes.length} table cell(s) contain only a dash. Blank the cell instead.`,
    });
  }
}

// ── P10 — relationship tables must render as a list ────────────────────────
// "Relation | Name" is a label and a value, not tabular data. Rendered as a table
// on a phone the label column had to be pinned to a nowrap floor while the value
// column slivered. If a page still emits a kv-table for relations, the renderer
// has regressed to the old shape.
for (const f of htmlFiles) {
  const s = readIf(f) || "";
  if (/table class="[^"]*\bkv-table\b/.test(s)) {
    violations.push({
      rule: "P10",
      file: rel(f),
      msg: "Relationship facts still rendered as a kv TABLE; they must render as <dl class=\"kv-list\">.",
    });
  }
  // P10b — a Children roster must not be a table with a Married column. On a
  // phone that column sat off-screen behind a sideways scroll, so the one fact
  // a reader came for ("who did this child marry") was the one they could not
  // see. Roster of people = list of cards (see .child-list in BaseLayout).
  if (/<th[^>]*>\s*Married\s*<\/th>/i.test(s)) {
    violations.push({
      rule: "P10b",
      file: rel(f),
      msg: "Children roster still renders as a table with a Married column; use <ul class=\"child-list\">.",
    });
  }
}

// ── P11 — no AI working notes in a profile body ────────────────────────────
// Mark, 4 Nov 2026: a profile body is for family, not a research log. The
// reasoning belongs in the vault's Corrections Log. These markers are the
// fingerprints of a job writing its process into the published page.
const AI_NOTE_PATTERNS = [
  /Checked on \d{1,2} \w+ 20\d\d/i,
  /DATE DISCREPANCY/i,
  /⚠️/,
  /\b(OPEN|CLOSED)\b\s*[—-]\s*(Discrepancy|DATE)/i,
  /the blocker was never/i,
  /nobody had read the row/i,
  /\bVerifier,\s*\d/i,
];
for (const f of htmlFiles) {
  if (!/\/people\/[^/]+\/index\.html$/.test(f.replace(/\\/g, "/"))) continue;
  const s = readIf(f) || "";
  for (const rx of AI_NOTE_PATTERNS) {
    const m = s.match(rx);
    if (m) {
      violations.push({
        rule: "P11",
        file: rel(f),
        msg: `Profile body contains a research working note ("${m[0]}"). Move it to the Corrections Log.`,
      });
      break;
    }
  }
}

// ── P12 — timeline rows must not repeat the name ───────────────────────────
// A row used to read "Born · John Telfer · John Telfer born". The badge and the
// duplicated detail were removed; this catches a regression to that shape.
for (const f of htmlFiles) {
  if (!/timeline\/index\.html$/.test(f.replace(/\\/g, "/"))) continue;
  const s = readIf(f) || "";
  if (/\bborn<\/span>|>Born<\/span>|>Died<\/span>/.test(s) && /\bborn\b[^<]{0,80}\bborn\b/i.test(s)) {
    violations.push({ rule: "P12", file: rel(f), msg: "Timeline row repeats the person's name or the birth event." });
  }
}

// ── P13 — the top-bar menu must fit its container ──────────────────────────
// 2026-11-04: the primary nav had grown to 14 items needing ~1347px inside the
// 1024px max-w-5xl wrapper. Nothing wrapped, so the bar burst the container and
// the whole document grew to 1641px wide — the "menu floating in the middle"
// defect, which also made the All People page scroll sideways. A budget rule is
// the only real guarantee: if someone adds links back in, the build fails here.
//
// Budget: 10 items. Measured average label+icon+padding ≈ 93px, so 10 items
// ≈ 930px; with the 104px brand and 44px theme toggle that is 1078px against a
// 1024px container — so 10 is the hard ceiling, not a target. Nine items measures
// 988px and leaves 36px headroom. Policy links belong in the footer.
const NAV_MAX_ITEMS = 10;
for (const f of htmlFiles) {
  const s = readIf(f) || "";
  const m = s.match(/<div id="nav-desktop"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) continue;
  const count = (m[1].match(/<a\s/g) || []).length;
  if (count > NAV_MAX_ITEMS) {
    violations.push({
      rule: "P13",
      file: rel(f),
      msg: `Top-bar menu has ${count} items (budget ${NAV_MAX_ITEMS}). It will overflow the 1024px container and force page-wide horizontal scroll. Move policy links to the footer.`,
    });
    break;
  }
}

// ── P14 — footer-only destinations must stay reachable ─────────────────────
// P13 moved Downloads/About/Contact/Privacy/Terms out of the top bar. They were
// already linked in the footer, but a future edit could drop them from BOTH and
// leave a visitor with no route to the contact page. Every one of them must
// still appear somewhere in the built home page.
const FOOTER_REACHABLE = ["/downloads/", "/about/", "/contact/", "/privacy/", "/terms/"];
{
  const homePath = path.join(DIST, "index.html");
  const home = readIf(homePath);
  if (home) {
    for (const href of FOOTER_REACHABLE) {
      if (!home.includes(href)) {
        violations.push({
          rule: "P14",
          file: rel(homePath),
          msg: `Navigation destination ${href} is not reachable from the home page. It was removed from the top bar; it must remain in the footer.`,
        });
      }
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
if (violations.length) {
  console.error("\nGATE FAILED — presentation integrity:");
  for (const v of violations) console.error(`  [${v.rule}] ${v.file}: ${v.msg}`);
  console.error(`\n${violations.length} violation(s). See scripts/guard-presentation-integrity.mjs for the rules.\n`);
  process.exit(1);
}

console.log("✓ Presentation integrity: footer attribution, single nav, no clinical labels, jump links, Help Us Complete section, reachable contact path.");
process.exit(0);
