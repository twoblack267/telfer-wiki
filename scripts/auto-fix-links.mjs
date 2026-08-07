/**
 * Self-healing link fixer script
 * Scans src/ for hardcoded absolute links missing BASE_URL and auto-fixes them.
 * Designed to run from cron to catch regressions before they break the live site.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const SRC = new URL("../src/", import.meta.url).pathname;
const FIX_PATTERN = /href="\/([a-z][^"]*?)"/g;
let fixed = 0;
let filesChanged = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else {
      const ext = extname(full);
      if (![".astro", ".mjs", ".js", ".ts", ".vue", ".svelte"].includes(ext)) continue;

      const original = readFileSync(full, "utf-8");
      const replaced = original.replace(FIX_PATTERN, (match, path) => {
        // Skip already-fixed links, external URLs, anchors, mailto
        if (
          path.includes("${") || // JS template-literal interpolation — do NOT rewrite (breaks JS strings)
          path.startsWith("telfer-wiki/") || // already has prefix
          path.startsWith("http") || // external URL
          path.startsWith("mailto:") ||
          path.startsWith("tel:") ||
          match.includes("import.meta.env.BASE_URL")
        ) {
          return match;
        }
        // Only fix links that look like internal routes (/people/..., /search/..., etc)
        if (/^(people|search|families|places|stories|timeline|about|tags)/.test(path)) {
          fixed++;
          return `href={${"`"}${"${"}import.meta.env.BASE_URL}${path}${"`}"}`;
        }
        return match;
      });

      if (replaced !== original) {
        writeFileSync(full, replaced, "utf-8");
        filesChanged++;
        console.log(`  ✏️  ${full.replace(SRC, "src/")}`);
      }
    }
  }
}

console.log("🔍 Scanning for hardcoded links...");
walk(SRC);

if (fixed > 0) {
  console.log(`\n✅ FIXED ${fixed} link(s) across ${filesChanged} file(s)`);
} else {
  console.log("\n✅ All links already correct — nothing to fix");
}
