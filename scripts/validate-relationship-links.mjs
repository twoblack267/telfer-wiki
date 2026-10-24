/**
 * Post-build relationship-link guard
 * ==================================
 * Catches the site-wide bug class Mark found (2026-08-23): when `lookupSlug()`
 * can't resolve a relationship slug to a profile, the profile page silently
 * renders that spouse/parent/child/sibling as PLAIN TEXT (<span>) instead of a
 * clickable <a href> link. The site "builds clean", the existing link validator
 * finds nothing (there's no broken href — there's no href at all), and the whole
 * site ships dead sidebar links.
 *
 * This guard is a SENTRY, not a surgeon. It asserts the RENDERED OUTPUT:
 * every spouse / parent / child / sibling relationship slug declared in the
 * public build data must appear as a real `<a href="...people/<slug>">` link on
 * that person's built page. If even one renders as plain text or a wrong href,
 * it fails the build (non-zero exit) so nothing broken ships and the failure
 * surfaces to the nightly audit.
 *
 * Source of truth = src/data/people.public.json, the exact file the site builds
 * from. No guessing about field names; we read the same arrays the template eats.
 *
 * It does NOT auto-fix data — a relationship that won't resolve is always a DATA
 * problem (missing/ghost profile, bad slug, or a lookupSlug code regression) and
 * auto-"fixing" family facts is fabrication. That's a human call.
 *
 * Runs automatically after `npm run build` via the postbuild hook.
 * Exit code: 0 = every relationship is linked, 1 = at least one is broken.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename, dirname } from "path";
import { PRIVACY_STRIP_SLUGS } from "../src/data/privacy-exclusions.mjs";
// The template does NOT require relationship entries to already be slugs: it hands
// each one to getLinksForRelationships(), which resolves raw display names through
// lookupSlug(). This guard used to skip that step, so every raw name — all 944 of
// the `siblings` entries, which resolve-refs never converts — was reported as
// "rendered as PLAIN TEXT" even though the page rendered a correct <a href>. Read
// the href the page ACTUALLY produced by resolving the same way the page does.
import { lookupSlug } from "../src/utils/format-body.mjs";

const DIST = new URL("../dist/", import.meta.url).pathname;
const PEOPLE_FILE = new URL("../src/data/people.public.json", import.meta.url).pathname;

const BASE = process.env.BASE_PATH || "";
const basePrefix = BASE ? `/${BASE}/` : "/";

const people = JSON.parse(readFileSync(PEOPLE_FILE, "utf-8"));
const bySlug = new Map(people.map((p) => [p.slug, p]));

/**
 * A relationship entry may be either a link target (string) or a WITHDRAWN
 * relative, published as `{ plain_name }` because the person was removed from
 * publication by an owner privacy ruling (see src/data/privacy-exclusions.mjs).
 * A withdrawn relative is REQUIRED to render as plain text — that is the
 * intended state, not a broken link. Guard below asserts exactly that.
 */
function plainNameOf(rel) {
  if (rel && typeof rel === "object") return rel.plain_name || rel.name || null;
  return null;
}

// Relationship slug arrays that must all render as links on the sidebar.
const REL_FIELDS = ["spouses", "parents", "children", "siblings"];
const SECTION_LABEL = {
  spouses: "Spouse(s)",
  parents: "Parents",
  children: "Children",
  siblings: "Siblings",
};

let failures = [];
// Relations whose person has no profile at all. Not a link defect — there is no
// page to link to. Counted and reported so the gap stays visible instead of being
// silently swallowed, but it does not fail the build (failing would block every
// deploy on research that has not been done yet).
const unresolved = [];
let checkedPages = 0;
let checkedRelations = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (basename(full) === "index.html") {
      checkPage(full);
    }
  }
}

function checkPage(file) {
  // A profile page lives at dist/people/<slug>/index.html. Its sidebar dir is
  // one level above dist/people. Non-profile pages (people/index.html,
  // sidebar sub-routes like things/<slug>/index.html) are skipped.
  const parent = dirname(file);
  const grandparent = dirname(parent);
  if (grandparent !== join(DIST, "people")) {
    return; // not a top-level profile page
  }

  const slug = basename(parent);
  const person = bySlug.get(slug);
  if (!person) return; // stale/unknown slug — skip

  const html = readFileSync(file, "utf-8");
  const section = extractSidebarSection(html);
  if (section === null) {
    failures.push({
      file: file.replace(DIST, ""),
      page: slug,
      field: "sidebar",
      relationship: "(page)",
      reason: "no sidebar relationship section found in rendered output",
    });
    return;
  }
  checkedPages++;

  for (const field of REL_FIELDS) {
    const slugs = person[field];
    if (!Array.isArray(slugs) || slugs.length === 0) continue;
    for (const relSlug of slugs) {
      // ── WITHDRAWN RELATIVE (owner privacy ruling) ───────────────────────
      // Published as { plain_name } because the person is deliberately not on
      // the site. The sidebar MUST show the name as unclickable text and MUST
      // NOT contain a link to a page that does not exist. Asserted here, both
      // ways — a missing name is still a failure, and a link is now the
      // failure. See src/data/privacy-exclusions.mjs (PRIVACY_STRIP_SLUGS).
      const withdrawn = plainNameOf(relSlug);
      if (withdrawn) {
        checkedRelations++;
        const nameOk = section.includes(withdrawn);
        // Look for a link whose text is the withdrawn person's name.
        const linkToThem = new RegExp(
          `<a\\s[^>]*href="[^"]*people\\/[^"]*"[^>]*>[^<]*${escapeRegExp(withdrawn)}`
        );
        const noLink = !linkToThem.test(section);
        if (!nameOk) {
          failures.push({
            file: file.replace(DIST, ""),
            page: slug,
            field: SECTION_LABEL[field],
            relationship: `${withdrawn} (withdrawn)`,
            reason: "withdrawn relative's name MISSING from the sidebar — a hidden person must still be named",
          });
        } else if (!noLink) {
          failures.push({
            file: file.replace(DIST, ""),
            page: slug,
            field: SECTION_LABEL[field],
            relationship: `${withdrawn} (withdrawn)`,
            reason: "withdrawn relative rendered as a LINK — must be plain text",
          });
        }
        continue;
      }
      checkedRelations++;
      // Resolve exactly as the template does. A raw display name is a legitimate
      // stored form; only the RESOLVED slug can be asserted against the HTML.
      const resolvedSlug = bySlug.has(relSlug) ? relSlug : lookupSlug(relSlug, people);
      if (!resolvedSlug) {
        // Genuinely unresolvable: no profile exists for this person, so the page
        // cannot link them. That is a research gap, reported separately from a
        // broken link, and it must not masquerade as a rendering defect.
        unresolved.push({ page: slug, field: SECTION_LABEL[field], relationship: relSlug });
        continue;
      }
      const name = bySlug.get(resolvedSlug)?.display_name || relSlug;
      // Correct render = an <a> whose href targets people/<relSlug>.
      const linked = new RegExp(
        `<a href="${escapeRegExp(basePrefix)}people/${escapeRegExp(resolvedSlug)}[^"]*"[^>]*>`
      );
      // Plain-text fallback = a <span> holding the relationship name.
      const asPlainText = new RegExp(
        `<span[^>]*>[\\s\\S]*?${escapeRegExp(name)}[\\s\\S]*?</span>`
      );
      if (linked.test(section)) {
        // Linked ✓ — but the whole point of the 2026-08-24 fix is that linked
        // relatives show their life DATES, not a bare name. Assert the linked
        // row carries its lifespan when the person has one in the data. If the
        // person has no lifespan/birth at all, that's a DATA gap we surface too.
        const relPerson = bySlug.get(resolvedSlug);
        const hasDates = !!(relPerson?.lifespan || relPerson?.birth_year);
        // The lifespan renders as: </a> <span class="...">(LIFESPAN)</span>
        const ls = relPerson?.lifespan;
        const withDates = ls
          ? new RegExp(
              `</a>\\s*<span[^>]*>\\(${escapeRegExp(ls)}\\)</span>`
            )
          : null;
        if (hasDates && withDates && !withDates.test(section)) {
          failures.push({
            file: file.replace(DIST, ""),
            page: slug,
            field: SECTION_LABEL[field],
            relationship: `${name} (${relSlug})`,
            reason: `linked but lifespan "${relPerson.lifespan}" NOT rendered on row`,
          });
        } else if (!hasDates) {
          failures.push({
            file: file.replace(DIST, ""),
            page: slug,
            field: SECTION_LABEL[field],
            relationship: `${name} (${relSlug})`,
            reason: "linked person has NO lifespan/birth date in data — renders as bare name",
          });
        }
        continue; // linked ✓ (subject to lifespan guard above)
      }
      if (asPlainText.test(section)) {
        failures.push({
          file: file.replace(DIST, ""),
          page: slug,
          field: SECTION_LABEL[field],
          relationship: `${name} (${relSlug})`,
          reason: "rendered as PLAIN TEXT, not a link",
        });
      } else {
        failures.push({
          file: file.replace(DIST, ""),
          page: slug,
          field: SECTION_LABEL[field],
          relationship: `${name} (${relSlug})`,
          reason: "not found as a link target in sidebar output",
        });
      }
    }
  }
}

/** Pull just the sidebar relationship section so we don't accidentally match
 *  the same name elsewhere on the page (body text, etc). */
function extractSidebarSection(html) {
  const start = html.indexOf("Relationship: Spouse");
  if (start < 0) return null;
  return html.slice(start);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

walk(DIST);

if (failures.length > 0) {
  console.error(
    `\n❌ RELATIONSHIP-LINK GUARD FAILED: ${failures.length} relationship(s) not linked ` +
      `across ${checkedPages} profile pages (${checkedRelations} checked)\n`
  );
  for (const f of failures.slice(0, 40)) {
    console.error(`   • ${f.page} — ${f.field}: "${f.relationship}" → ${f.reason}`);
  }
  if (failures.length > 40) {
    console.error(`   … and ${failures.length - 40} more`);
  }
  console.error(
    "\nA relationship that won't resolve is a DATA problem (missing/ghost profile, bad slug)\n" +
      "or a lookupSlug code regression. AUTO-FIXING family facts is fabrication — do NOT guess.\n" +
      "Investigate the real record (or the code), fix it, rebuild, and let this guard clear.\n"
  );
  process.exit(1);
}

console.log(
  `\n✅ RELATIONSHIP-LINK GUARD PASSED — all relationships linked across ` +
    `${checkedPages} profile pages (${checkedRelations} checked)\n`
);
