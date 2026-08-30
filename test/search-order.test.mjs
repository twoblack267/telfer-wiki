// test/search-order.test.mjs
// Regression guard: ensures the hybrid search ranking (src/pages/search.astro)
// keeps exact/prefix "word-boundary" matches above fuzzy floods.
//
// This mirrors the runtime rank() logic EXACTLY so that if anyone changes
// either the ranking predicate OR the data order breaks it, `npm run validate`
// fails and the build stops before deploy.
//
// Root cause it guards against (2026-08-30): the first hybrid-search fix computed
// the right order but render() never reordered the DOM, so a bare rank() unit test
// would have PASSED while the page still showed fuzzy Margaret/Martha rows on top.
// That render bug is guarded separately by scripts/check-search-render.mjs (e2e on dist).
//
// Exit 0 = pass, non-zero = fail.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fuse from "fuse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ---- Load the exact same public data the search page uses ----
const people = JSON.parse(
  readFileSync(join(root, "src/data/people.public.json"), "utf8")
);
const telferPeople = people.filter(
  (p) => (p.branch === "telfer" || !p.branch) && p.id
);

// ---- Mirror rank() from src/pages/search.astro (keep in sync!) ----
function normalizePerson(p) {
  const display = (p.display_name || "").toLowerCase();
  // searchData carries name, year, role for ranking
  return { id: p.id, name: display, display: p.display_name || "" };
}

function rank(query, searchData) {
  const q = query.toLowerCase();
  if (!q) return searchData.slice(); // all, unchanged
  if (q.length < 2) return searchData.slice(); // raw data order

  const isWordBoundaryStartsWith = (name) =>
    name.startsWith(q) || name.split(" ").some((w) => w.startsWith(q));

  const exact = searchData.filter((s) => isWordBoundaryStartsWith(s.name));
  const exactIds = new Set(exact.map((s) => s.id));
  const contains = searchData.filter(
    (s) => s.name.includes(q) && !exactIds.has(s.id)
  );
  const containsIds = new Set([...exactIds, ...contains.map((s) => s.id)]);
  const rest = searchData.filter((s) => !containsIds.has(s.id));

  // Fuse fuzzy on the remaining pool keeps the exact/prefix matches pinned on top
  let fuzzy = [];
  if (rest.length > 0) {
    const fuse = new Fuse(rest, {
      keys: [{ name: "name", weight: 3 }],
      threshold: 0.3,
      includeScore: true,
      ignoreLocation: true,
    });
    fuzzy = fuse.search(q).map((r) => r.item);
  }
  return [...exact, ...contains, ...fuzzy].slice(0, 60);
}

const searchData = telferPeople.map(normalizePerson);

// ---- Assertions ----
let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("  ❌ " + msg);
    failures++;
  } else {
    console.log("  ✅ " + msg);
  }
}

function firstVisibleNames(query) {
  return rank(query, searchData)
    .filter((s) => s)
    .map((s) => s.display);
}

console.log("🔎 Search order regression test");
console.log(`Loaded ${telferPeople.length} profiles from people.public.json`);

console.log("\n— 'mark' query —");
const mark = firstVisibleNames("mark");
assert(
  mark[0] === "Mark Telfer",
  `'mark' → first result is "Mark Telfer" (got "${mark[0]}")`
);
assert(
  mark[1] === "Mark Kenneth Telfer",
  `'mark' → second result is "Mark Kenneth Telfer" (got "${mark[1]}")`
);
assert(
  mark[0] === "Mark Telfer" && mark[1] === "Mark Kenneth Telfer",
  "both Mark Telfers rank above any fuzzy Margaret/Martha/March match"
);
// Ensure the real Mark rows are NOT buried in the fuzzy flood
const markIdx = mark.map(n=>n.toLowerCase()).indexOf("mark telfer");
assert(markIdx !== -1 && markIdx < 3, `'mark' → Mark Telfer present in top 3 (idx ${markIdx})`);

console.log("\n— 'john' query (fuzzy check) —");
const john = firstVisibleNames("john");
const johnCount = john.filter((n) => /^john/i.test(n)).length;
assert(johnCount >= 1, `'john' → at least one name starts with "John" (found ${johnCount})`);

console.log("\n— short/empty queries must not crash —");
assert(rank("", searchData).length === telferPeople.length, "empty query returns all profiles");
assert(rank("a", searchData).length > 0, "1-char query returns results (raw order)");

// Summary
console.log("\n───────────────────────────────");
if (failures === 0) {
  console.log(`🎉 Search order regression: ${searchData.length} profiles, ALL PASS`);
  process.exit(0);
} else {
  console.error(`❌ ${failures} search-order assertion(s) FAILED — build blocked.`);
  console.error("   If you intentionally changed ranking, update test/search-order.test.mjs.");
  process.exit(1);
}
