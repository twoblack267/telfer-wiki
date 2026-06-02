/**
 * Post-build link validation script
 * Checks dist/ for broken absolute links missing the BASE_URL prefix.
 * Runs automatically after `npm run build` via the postbuild hook.
 * Exit code: 0 = all clean, 1 = broken links found
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const BASE = "telfer-wiki"; // Expected base path prefix
const BROKEN_PATTERN = /href="\/(?!telfer-wiki\/|https?:\/\/|#|mailto:)/g;

let found = 0;
const results = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith(".html")) {
      const content = readFileSync(full, "utf-8");
      const matches = [...content.matchAll(BROKEN_PATTERN)];
      if (matches.length > 0) {
        const relPath = full.replace(DIST, "");
        results.push({ file: relPath, count: matches.length, lines: [] });
        found += matches.length;
      }
    }
  }
}

walk(DIST);

if (found > 0) {
  console.error(`\n❌ LINK VALIDATION FAILED: ${found} broken absolute link(s) found\n`);
  for (const r of results) {
    console.error(`   ${r.file} — ${r.count} broken link(s)`);
  }
  console.error("\nBroken links are missing the /telfer-wiki/ prefix.");
  console.error("Fix source files to use import.meta.env.BASE_URL instead of hardcoded '/' paths.\n");
  process.exit(1);
} else {
  console.log("\n✅ LINK VALIDATION PASSED — 0 broken absolute links in dist/\n");
}
