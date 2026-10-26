/**
 * Resolver-coverage guard — the "never a silent discard" sentry
 * ============================================================
 * WHY THIS EXISTS (2026-09-12, Mark: "we never want this to happen again")
 * ---------------------------------------------------------------------
 * scripts/build-relationship-graph.mjs resolves only ~5.6% of the relationship
 * names in the vault. The 94.4% it FAILS to resolve are dropped silently: the
 * site still looks fine because the tree limps along on a second, denormalised
 * set of fields (father/mother/children). Two inputs, one of them silently
 * discarded — and the discarded one is the readable one.
 *
 * The pre-existing guard (validate-relationship-links.mjs) checks the RENDERED
 * output of whichever slugs happen to be in the data. It cannot see this class
 * of failure: a relationship that was never built into the graph can't render
 * broken, so it checks fewer things and passes. That is exactly how a 94%
 * discard hid for months.
 *
 * THIS GUARD asserts the RESOLVER itself, not its output:
 *   1. It replays the resolver's own matching algorithm over the real
 *      people.json (the same shape build-relationship-graph.mjs consumes).
 *   2. It measures coverage against a committed baseline and fails when
 *      coverage DROPS below the floor (ratchet: floors only go up).
 *   3. Named canaries must resolve — including James Telfer (1796)'s eight
 *      children, the concrete case behind the 2026-09-12 broken-arrow bug.
 *   4. It writes .resolver-coverage.json so pipeline-escalate.py auto-files a
 *      board ticket when this fails in CI, where no watcher may be running.
 *
 * NOTE ON THE CANARY: as of 2026-09-12 the resolver matches NOTHING for these
 * children (the reference carries years, the person id carries a birth year
 * only). The canary is therefore recorded as a KNOWN GAP that must be fixed,
 * not a passing test — see board card tw-2026-09-12-011. Once the resolver is
 * fixed, set "canary_floor": 8 in resolver-coverage.baseline.json and this
 * guard will fail the build if it ever regresses.
 *
 * Exit 0 = fine. Exit 1 = coverage regressed -> build fails, ticket filed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PEOPLE = join(ROOT, "src/data/people.json");
const BASELINE = join(ROOT, "scripts/resolver-coverage.baseline.json");
const REPORT = join(ROOT, ".resolver-coverage.json");

const FLOOR_DEFAULT = 0.05;
const CANARY_FLOOR_DEFAULT = 0; // known gap; ratchets to 8 when the card is done

const REL_TYPES = ["Father", "Mother", "Spouse", "Children", "Siblings"];

const norm = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** How the real resolver keys a reference: name (no years) + birth year. */
function refKey(reference) {
  const raw = String(reference || "").trim();
  // ── FIXED 2026-10-26 (THE PARSER COULD NOT READ LIVING PEOPLE) ───────────────
  //
  // This pattern was the ONLY route by which a reference could carry a year into
  // the lookup below. It accepted `(YYYY)`, `(YYYY–YYYY)` and `(YYYY–?)` and
  // nothing else. The vault's standard form for anyone still alive is
  // `(YYYY–living)`, so EVERY living-person reference fell through to the
  // year-less path with birth = null — and the year-less path can only resolve a
  // name claimed by exactly one record. Result: a reference to a correctly
  // recorded living person was structurally un-resolvable, and every accurate
  // living-person edge ADDED to the vault LOWERED the reported coverage.
  // Measured on 2026-10-26: 1691/2593 = 65.21% (floor 66.00%) — and 1462 refs
  // take the leading-year form, most of them living people.
  //
  // The fix accepts ANY single trailing parenthetical and reads a LEADING year
  // out of it, because that is the only thing the leading year ever means here:
  //   (1938–living) -> 1938      (1938) -> 1938        (1907–1956) -> 1907
  //   (1951–)       -> 1951      (b. 1910) -> 1910     (m. 1944) -> none
  // A DEATH-only mention (`d. 16 Dec 2001`) contributes no birth year: the
  // death-year matching further down is a tiebreaker and must not be fed a date
  // of death as though it were a year of birth.
  //
  // DELIBERATELY UNCHANGED: a parenthetical with TWO OR MORE years and no leading
  // year (`c.1853–1928`, `~1836–1884`) is treated as carrying no year at all. The
  // existing year extractors below read `(\d{4})…–…(\d{4})` from anywhere in the
  // string, which would take `1853` as a birth year — and an approximate date that
  // is silently promoted to an exact one is how generations get wired wrong.
  // Those refs keep their old, conservative behaviour: ambiguous ones stay
  // unresolved rather than being guessed at.
  const m = raw.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  const LEADING_YEAR = /^(?:b\.?\s*|ca?\.?\s*|abt\.?\s*|about\s*|~+\s*)?(\d{4})\s*(?:[–\-]|$)/i;
  const stripQuotes = (s) => norm(s).replace(/\s*"(.*?)"\s*/g, " ").replace(/\s+/g, " ").trim();
  if (m) {
    const name = stripQuotes(m[1]);
    const inside = m[2].trim();
    // A DEATH-ONLY parenthetical names no birth year. `d. 16 Dec 2001` must not
    // become birth 2001 — the death-year tiebreaker below keys on `death`, never
    // on `birth`, so passing a death date here would invent a person.
    if (/^d\.?\s/i.test(inside)) {
      const dy = inside.match(/\b(\d{4})\b/);
      return { name, birth: null, death: dy ? Number(dy[1]) : null, raw };
    }
    const lead = inside.match(LEADING_YEAR);
    if (lead) {
      // A leading year is a birth year. `(1907–1956)` also carries a death year,
      // which is a tiebreaker only; `(1938–living)` and `(1951–)` carry none.
      const rest = inside.slice(lead[0].length);
      const death = rest.match(/^[–\-]?\s*(\d{4})\s*$/);
      return { name, birth: Number(lead[1]), death: death ? Number(death[1]) : null, raw };
    }
    // No leading year: `(m. 1944)`, `(never married)`, or an approximate range
    // (`c.1853–1928`, `~1836–1884`) whose years must NOT be promoted to exact.
    // Keep the name, drop the dates — conservative, unchanged from before.
    return { name, birth: null, death: null, raw };
  }
  return { name: stripQuotes(raw), birth: null, death: null, raw };
}

/** How the real resolver keys a person: display name (no years) + birth year. */
function personKey(p) {
  const name = norm(p.display_name || p.id || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name, birth: p.birth_year ?? null };
}

export function measure(peopleJson) {
  const byKey = new Map();
  const byName = new Map();
  for (const p of peopleJson) {
    const k = personKey(p);
    byKey.set(`${k.name}|${k.birth ?? ""}`, p);
    if (!byName.has(k.name)) byName.set(k.name, []);
    byName.get(k.name).push(p);
  }

  let total = 0, resolved = 0, unresolved = 0;
  const misses = [];
  const perType = {};

  for (const p of peopleJson) {
    const rels = Array.isArray(p.relationships) ? p.relationships : [];
    for (const rel of rels) {
      if (!rel || !Array.isArray(rel.names)) continue;
      if (rel.type === "Self") continue;
      if (!REL_TYPES.includes(rel.type)) continue;
      for (const reference of rel.names) {
        if (!reference || !String(reference).trim()) continue;
        total++;
        const rk = refKey(reference);
        let hit = byKey.get(`${rk.name}|${rk.birth ?? ""}`) || null;
        if (!hit) {
          // the vault often omits the death year and sometimes the birth year
          const cands = byName.get(rk.name) || [];
          if (cands.length === 1) hit = cands[0];
        }
        if (hit && rk.raw !== p.id && rk.raw !== p.display_name) {
          resolved++;
          perType[rel.type] = (perType[rel.type] || 0) + 1;
        } else if (hit) {
          resolved++;
          perType[rel.type] = (perType[rel.type] || 0) + 1;
        } else {
          unresolved++;
          if (misses.length < 15)
            misses.push({ on: p.display_name || p.id, ref: rk.raw, type: rel.type });
        }
      }
    }
  }

  return { total, resolved, unresolved, coverage: total ? resolved / total : 0, misses, perType };
}

/** Concrete canary: does each of James Telfer (1796)'s eight children resolve TO HIM? */
export function canaries(peopleJson) {
  const james = peopleJson.find((p) => p.birth_year === 1796 && p.slug === "james-telfer-1796")
    || peopleJson.find((p) => p.birth_year === 1796);
  if (!james) return { found: false, hits: 0, total: 0, resolved: [] };

  const named = (james.relationships || []).find((r) => r.type === "Children");
  const refs = named && Array.isArray(named.names) ? named.names : [];

  const norm2 = (s) => norm(s).replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const index = new Map();
  for (const p of peopleJson) index.set(`${norm2(p.display_name || p.id)}|${p.birth_year ?? ""}`, p);

  const resolved = [];
  const broken = [];
  for (const r of refs) {
    const rk = refKey(r);
    const hit = index.get(`${rk.name}|${rk.birth ?? ""}`)
      || (peopleJson.filter((p) => norm2(p.display_name || p.id) === rk.name).length === 1
        ? peopleJson.filter((p) => norm2(p.display_name || p.id) === rk.name)[0]
        : null);
    if (hit) resolved.push(`${r} -> ${hit.slug}`);
    else broken.push(r);
  }
  return { found: true, hits: resolved.length, total: refs.length, resolved, broken };
}

// ── run ──────────────────────────────────────────────────────────────────────
const peopleJson = JSON.parse(readFileSync(PEOPLE, "utf-8"));
const m = measure(peopleJson);
const c = canaries(peopleJson);

let baseline = { floor: FLOOR_DEFAULT, canary_floor: CANARY_FLOOR_DEFAULT };
if (existsSync(BASELINE)) baseline = { ...baseline, ...JSON.parse(readFileSync(BASELINE, "utf-8")) };

const floor = Math.max(baseline.floor ?? FLOOR_DEFAULT, FLOOR_DEFAULT);
const canaryFloor = baseline.canary_floor ?? CANARY_FLOOR_DEFAULT;
const failures = [];

if (m.coverage + 1e-9 < floor) {
  failures.push(
    `resolver coverage ${(m.coverage * 100).toFixed(2)}% is BELOW the floor ${(floor * 100).toFixed(2)}% — links are being discarded silently`
  );
}
if (!c.found) failures.push("canary: James Telfer (1796) not found in people.json — data pipeline regression");
if (c.found && c.hits < canaryFloor) {
  failures.push(`canary: ${c.hits}/${c.total} of James Telfer (1796)'s children resolve (needs ${canaryFloor})`);
}

const report = {
  at: new Date().toISOString(),
  coverage: +m.coverage.toFixed(4),
  resolved: m.resolved,
  unresolved: m.unresolved,
  total: m.total,
  floor: +floor.toFixed(4),
  per_type_resolved: m.perType,
  canary: { found: c.found, hits: c.hits, total: c.total, broken: c.broken || [] },
  canary_floor: canaryFloor,
  known_gap: canaryFloor === 0 && c.total > 0 && c.hits < c.total,
  sample_misses: m.misses,
  failures,
};

try {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
} catch (e) {
  console.error(`(could not write ${REPORT}: ${e.message})`);
}

console.log(
  `\nRESOLVER COVERAGE: ${(m.coverage * 100).toFixed(2)}% (${m.resolved}/${m.total}) — floor ${(floor * 100).toFixed(2)}%`
);
console.log(`CANARY James Telfer (1796) children: ${c.hits}/${c.total} resolve (required ${canaryFloor})`);
if (report.known_gap) {
  console.log(
    `⚠️  KNOWN GAP (carded tw-2026-09-12-011): ${c.total - c.hits} of those children do not resolve yet.` +
      `\n   When that card is fixed, raise "canary_floor" to ${c.total} in scripts/resolver-coverage.baseline.json.`
  );
}

if (failures.length) {
  console.error(`\n❌ RESOLVER-COVERAGE GUARD FAILED (${failures.length})`);
  for (const f of failures) console.error(`   • ${f}`);
  if (m.misses.length) {
    console.error("\n   first unresolved references:");
    for (const x of m.misses.slice(0, 8)) console.error(`     - ${x.on} -> "${x.ref}" (${x.type})`);
  }
  console.error(
    "\nDo NOT paper over this by hand-editing JSON. Fix the resolver in" +
      "\nscripts/build-relationship-graph.mjs (it strips the years off the" +
      "\nreference and then compares against keys that still carry them), rebuild," +
      "\nand let this guard clear. Escalation: npm run escalate\n"
  );
  process.exit(1);
}

console.log(`✅ RESOLVER-COVERAGE GUARD PASSED\n`);
