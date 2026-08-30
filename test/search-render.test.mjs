// test/search-render.test.mjs
// END-TO-END guard for the search render pipeline.
//
// This is the test that WOULD HAVE CAUGHT the real bug on 2026-08-30:
//   rank() computed the right order ("mark telfer" first), but render()
//   only toggled display:none and never reordered the DOM — so the page
//   showed fuzzy Margaret/Martha rows on top while Mark Telfer sat buried
//   at index 22. A pure rank()-logic test (search-order.test.mjs) PASSED
//   the whole time; only a test that drives the real built page catches it.
//
// It launches the built dist/ search page in headless Chromium, types a
// query into the real search input, lets the client-side JS run, then reads
// the actual VISIBLE row order and asserts the Mark Telfers surface first.
//
// Requires: playwright (npm). Run via `npm run postbuild` (in CI) or
// `node test/search-render.test.mjs` (after `npm run build`).
//
// Exit 0 = pass, non-zero = fail.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const DIST = join(root, "dist");
const SEARCH_FILE = join(DIST, "search", "index.html");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("  ❌ " + msg);
    failures++;
  } else {
    console.log("  ✅ " + msg);
  }
}

// Serve dist/ statically so the page + its JS bundle load over http
function serve(distDir) {
  return new Promise((resolve) => {
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
    const server = createServer((req, res) => {
      let file = join(distDir, decodeURIComponent(req.url.split("?")[0]));
      if (file.endsWith("/")) file = join(file, "index.html");
      try {
        const data = readFileSync(file);
        const ext = file.slice(file.lastIndexOf("."));
        res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, () => resolve(server));
  });
}

async function visibleNames(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll("#results [data-search-item]"))
      .filter((e) => e.style.display !== "none" && e.offsetParent !== null)
      .map((e) => (e.querySelector(".flex-1.min-w-0 div") || {}).textContent || e.getAttribute("data-name"))
      .map((s) => (s || "").trim());
  });
}

console.log("🔎 Search RENDER regression test (e2e on built page)");

// Bail fast with a clear message if the build isn't present
try {
  readFileSync(SEARCH_FILE, "utf8");
} catch {
  console.error("  ❌ dist/search/index.html not found. Run `npm run build` first.");
  process.exit(1);
}

let server;
let browser;
try {
  server = await serve(DIST);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/search/`;

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  // Confirm the client-side search JS actually loaded and bound
  const inputBound = await page.evaluate(() => !!document.getElementById("search-input"));
  assert(inputBound, "search input present after navigation");

  // Empty state: full count visible
  const allCount = (await visibleNames(page)).length;
  assert(allCount > 100, `empty query shows all profiles (visible=${allCount})`);

  // — DOM-integrity guard: NO orphan ghost rows —
  // The role caption previously used set:html inlineLinks() which emitted a NESTED
  // <a> inside the row's <a data-search-item>. The HTML parser can't nest anchors, so
  // it split those rows apart: an empty <a> shell stayed in the list while the role,
  // badge and arrow were orphaned as bare #results children — rendering 15 visible
  // "badge-only" ghost rows on top of the real results. This is the bug Mark kept
  // seeing as "still playing up". Guard: the #results container must contain only
  // <a data-search-item> rows (plus the empty-state/etc outside it) — zero loose
  // .shrink-0 badges/arrows/role divs and zero anchor shells missing their name.
  const integrity = await page.evaluate(() => {
    const results = document.getElementById("results");
    const anchors = Array.from(results.querySelectorAll("a[data-search-item]"));
    const orphanBadges = Array.from(results.querySelectorAll(":scope > div.shrink-0")).length;
    const orphanArrows = Array.from(results.querySelectorAll(":scope > span.shrink-0")).length;
    const orphanRoles = Array.from(results.querySelectorAll(":scope > div.hidden.md\\:block")).length;
    const emptyShells = anchors.filter(
      (a) => !a.querySelector(".font-medium") || !a.querySelector(".font-medium").textContent.trim()
    ).length;
    return { orphanBadges, orphanArrows, orphanRoles, emptyShells, anchors: anchors.length };
  });
  assert(integrity.orphanBadges === 0 && integrity.orphanArrows === 0 && integrity.orphanRoles === 0,
    `no orphan badge/arrow/role ghost rows (badges=${integrity.orphanBadges}, arrows=${integrity.orphanArrows}, roles=${integrity.orphanRoles})`);
  assert(integrity.emptyShells === 0,
    `no empty <a data-search-item> shells (found ${integrity.emptyShells})`);
  assert(integrity.orphanBadges + integrity.orphanArrows + integrity.orphanRoles + integrity.emptyShells === 0,
    `#results rows are all intact single anchor rows (anchors=${integrity.anchors})`);


  // — THE critical test: type "mark", read the real visible order —
  await page.fill("#search-input", "mark");
  await page.waitForTimeout(400); // let the input handler + reorder run

  const visible = await visibleNames(page);
  console.log(`  → top 5 visible for 'mark': ${JSON.stringify(visible.slice(0, 5))}`);

  assert(
    visible[0] === "Mark Telfer",
    `'mark' → first VISIBLE row is "Mark Telfer" (got "${visible[0]}")`
  );
  assert(
    visible[1] === "Mark Kenneth Telfer",
    `'mark' → second VISIBLE row is "Mark Kenneth Telfer" (got "${visible[1]}")`
  );

  const markIdx = visible.findIndex((n) => n.toLowerCase() === "mark telfer");
  assert(markIdx === 0 || markIdx === 1, `'mark' → "Mark Telfer" does NOT sit buried (visible idx ${markIdx})`);

  // Sanity: a fuzzy-only query still returns rows (fuse alive)
  await page.fill("#search-input", "margaret");
  await page.waitForTimeout(400);
  const margaret = await visibleNames(page);
  assert(margaret.length > 0 && margaret[0].toLowerCase().includes("margaret"),
    `'margaret' → fuzzy results still appear (first="${margaret[0]}")`);

  // Sanity: clear query restores everything
  await page.fill("#search-input", "");
  await page.waitForTimeout(300);
  const cleared = (await visibleNames(page)).length;
  assert(cleared === allCount, `clearing input restores all ${allCount} rows (got ${cleared})`);
} catch (err) {
  console.error("  ❌ e2e error:", err.message);
  failures++;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
}

console.log("\n───────────────────────────────");
if (failures === 0) {
  console.log("🎉 Search render e2e: ALL PASS — Mark Telfers surface first for 'mark'");
  process.exit(0);
} else {
  console.error(`❌ ${failures} render-assertion(s) FAILED — build blocked.`);
  process.exit(1);
}
