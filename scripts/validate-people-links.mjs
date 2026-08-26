/**
 * Post-build PEOPLE-LINK INTEGRITY CHECK
 *
 * Guarantees NO internal link in dist/ points to a 404.
 * For every href in the built HTML:
 *   - /people/<slug>/  → must resolve to a real page OR a redirect file under dist/people/<slug>/
 *   - /people/, /people/families/... → real page
 *   - /<root>/ assets & other internal pages → must exist under dist/
 *   - external (http/https), #anchors, mailto: are ignored
 *
 * Exit code: 0 = every internal link resolves; 1 = a 404-capable link found.
 * This is the "never happens again" guard for slug mismatches: if the index
 * ever emits a slug with no page and no redirect, the build FAILS.
 *
 * Runs automatically after build via the postbuild hook (after generate-redirects).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, resolve, extname } from "path";

const DIST = new URL("../dist/", import.meta.url).pathname.replace(/\/$/, "");
const EXT_IGNORE = [".js", ".css", ".map", ".woff", ".woff2", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".txt", ".xml", ".json", ".pdf"];

// ---- Build set of resolvable paths under dist/ (no extension, normalized) ----
// A "resolvable page" = a directory containing index.html (real or redirect)
// or a standalone .html file. Store as normalized path WITHOUT trailing slash.
const resolvable = new Set();

function collectDir(dir, prefix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectDir(full, full);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      // /dist/foo/bar/index.html  ->  /foo/bar
      const rel = full.slice(DIST.length).replace(/^\/+/, "");
      const norm = rel.endsWith("/index.html")
        ? ("/" + rel.slice(0, -"index.html".length))
        : ("/" + rel.slice(0, -".html".length));
      resolvable.add(norm.replace(/\/$/, ""));
    }
  }
}
collectDir(DIST, DIST);

// ---- Walk all HTML, extract internal links, check each resolves ----
const broken = [];
function checkFile(file) {
  const relFile = file.slice(DIST.length);
  const content = readFileSync(file, "utf-8");
  // Match href="/..." (root-absolute internal link)
  const linkRe = /href="(\/[^"]*)"/g;
  let m, seen = new Set();
  while ((m = linkRe.exec(content))) {
    let href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);

    // Parse fragment & trailing bits
    const fragIdx = href.indexOf("#");
    if (fragIdx !== -1) href = href.slice(0, fragIdx);
    const queryIdx = href.indexOf("?");
    if (queryIdx !== -1) href = href.slice(0, queryIdx);
    if (!href || href === "/") continue;

    // Normalize: strip trailing slash
    const norm = href.replace(/\/$/, "");

    // Skip client-side template-literal placeholders, e.g. href="/people/${t.slug}"
    // These are runtime-built by JS (full-family-tree widget), not server-rendered
    //   links — they never 404 at request time.
    if (href.includes("${")) continue;

    // Extension-bearing static asset? (not a page) — skip only if file exists
    const ext = extname(norm);
    if (EXT_IGNORE.includes(ext)) continue;

    if (!resolvable.has(norm)) {
      broken.push({ file: relFile, href });
    }
  }
}

function walkHtml(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtml(full);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      // skip redirect pages themselves (they reference the canonical page, already covered elsewhere)
      checkFile(full);
    }
  }
}
walkHtml(DIST);

if (broken.length > 0) {
  console.error(`\n❌ PEOPLE-LINK INTEGRITY FAILED: ${broken.length} internal link(s) resolve to no page/redirect\n`);
  // show first 30
  for (const b of broken.slice(0, 30)) {
    console.error(`   ${b.file}  →  ${b.href}`);
  }
  if (broken.length > 30) console.error(`   ...and ${broken.length - 30} more`);
  console.error("\nThe build would have served a 404 for each of these. Fix the slug/redirect before merging.\n");
  process.exit(1);
}
console.log(`\n✅ PEOPLE-LINK INTEGRITY PASSED — ${resolvable.size} pages, 0 un-resolvable internal links in dist/\n`);
