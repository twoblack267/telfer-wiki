#!/usr/bin/env node
/**
 * check-external-links.mjs — outbound citation rot check for the LIVE site.
 *
 * WHY THIS EXISTS
 * ---------------
 * scan-404.mjs checks that OUR pages exist. It never checks the sites we CITE.
 * Every genealogy page links to Trove, Scotland's People, FamilySearch,
 * WikiTree, Find a Grave and a long tail of council/parish record sites. Those
 * rot constantly: records get re-catalogued, archives reorganise, small
 * genealogy sites die. A dead citation on a family history site is worse than a
 * dead internal link — it is a broken promise to the reader that the evidence
 * exists, and it undermines the whole point of the archive.
 *
 * It is also an SEO signal: Google's quality guidance treats broken outbound
 * links as a small negative, and the page-level "reviewed" signature we just
 * added means Mark's name sits above those links. He should not be signing off
 * on citations that 404.
 *
 * DESIGN — deliberately conservative, because false alarms train people to
 * ignore the alarm:
 *   • 404/410 on the FINAL url after redirects  -> real rot (failure)
 *   • 403/429/503, bot walls, timeouts, DNS     -> NOT our finding. Archives
 *     block scripts by design. Counted separately as "unchecked", never a fail.
 *   • Only HEAD/GET status is judged. Content is not.
 *
 * A 200 that returns a soft-404 page ("record not found") is NOT detectable
 * here and this script does not pretend otherwise.
 *
 * OUTPUT: writes JSON to the --out path so Night Watch can card the offenders.
 * Exit 0 = no dead citations (regardless of unchecked). Exit 1 = dead ones.
 *
 * USAGE:
 *   node scripts/check-external-links.mjs --out runtime/nw-extlinks.json
 *   node scripts/check-external-links.mjs --limit 50 --verbose
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const OUT = arg("out", path.join(ROOT, "runtime", "nw-extlinks.json"));
const LIMIT = Number(arg("limit", 0)) || 0;
const VERBOSE = Boolean(arg("verbose", false));

/** Hosts we never check: our own site, and things that are not citations. */
const SKIP_HOSTS = new Set([
  "telferwiki.com",
  "www.telferwiki.com",
  "localhost",
]);

/** Hosts that block scripts by design — a non-200 here means nothing. */
const BOT_WALL_HOSTS = [
  "ancestry.com",
  "ancestry.co.uk",
  "familysearch.org",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "trove.nla.gov.au", // frequently 403s automated clients
  "scotlandspeople.gov.uk",
  "findagrave.com",
  "wikitree.com",
];

/** Pull every outbound http(s) href/src out of the built HTML. */
function collectOutbound() {
  const pages = new Map(); // url -> Set(page rel path)

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;

      const rel = "/" + path.relative(DIST, full).replace(/index\.html$/, "");
      const html = fs.readFileSync(full, "utf-8");
      // ONLY <a href>. Not <link href> (preconnect/dns-prefetch point at bare
      // hosts like fonts.gstatic.com which have no page and 404), and not
      // <script src>. Those are infrastructure, not citations — the first run
      // of this script flagged Google Fonts as two "dead citations", which is
      // exactly the false-alarm class that makes people ignore a checker.
      //
      // Attribute values may legally contain `>` (e.g. wikimedia File: URLs with
      // escaped spaces), so the value is matched up to the CLOSING QUOTE, and
      // the tag is then consumed to its own `>` — a `[^>]*` on the tag was
      // truncating URLs at the first `>`, inventing dead links that were fine.
      const re = /<a\b[^>]*?\bhref\s*=\s*(["'])(https?:\/\/[^"']+)\1[^>]*>/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        let u = m[2].trim();
        u = u.split("#")[0];
        if (!u) continue;
        let host;
        try {
          host = new URL(u).hostname.replace(/^www\./, "");
        } catch {
          continue;
        }
        if (SKIP_HOSTS.has(host) || SKIP_HOSTS.has("www." + host)) continue;
        if (!pages.has(u)) pages.set(u, new Set());
        pages.get(u).add(rel);
      }
    }
  }

  if (!fs.existsSync(DIST)) {
    console.error(`FATAL: no dist/ at ${DIST} — run the build first.`);
    process.exit(2);
  }
  walk(DIST);
  return pages;
}

function isBotWall(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return BOT_WALL_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/**
 * @returns {'ok'|'dead'|'unchecked'}
 *
 * WHY curl AND NOT fetch()
 * Node 22's bundled undici has a parser bug: a TLS socket callback can throw
 * `AssertionError: assert(!this.paused)` — not as a rejected promise but as a
 * process-killing uncaught exception from a native callback, which cannot be
 * caught by any try/catch around the await. On the first full scan it killed
 * the run dead mid-list. One hostile archive server must cost us one link, not
 * the night, so each probe is a child process: whatever curl does, the parent
 * survives.
 */
function probe(url) {
  return new Promise((resolve) => {
    const args = [
      "-sS", "-o", "/dev/null",
      "-w", "%{http_code}",
      "-L",                       // follow redirects; judge the FINAL url
      "--max-time", "15",
      "--max-redirs", "8",
      "--retry", "1", "--retry-delay", "2",
      // Identify honestly. Faking a browser UA to dodge a block we could not
      // justify would be dishonest — and archives block bots for real reasons.
      "-A", "TelferWikiLinkCheck/1.0 (+https://telferwiki.com; family history archive link audit)",
      url,
    ];
    execFile("curl", args, { timeout: 25000, maxBuffer: 1 << 20 }, (err, stdout) => {
      const code = parseInt(String(stdout || "").trim(), 10);
      if (!Number.isFinite(code) || code === 0) return resolve("unchecked"); // DNS/TLS/timeout
      if (code === 404 || code === 410) return resolve("dead");
      if (code >= 200 && code < 400) return resolve("ok");
      return resolve("unchecked"); // 401/403/429/5xx — not ours to judge
    });
  });
}

async function main() {
  const outbound = collectOutbound();
  const all = [...outbound.keys()];
  console.log(`🔗 Outbound links found: ${all.length} across the built site`);

  const target = LIMIT ? all.slice(0, LIMIT) : all;
  const dead = [];
  const unchecked = [];
  let ok = 0;

  // Bounded concurrency — polite to archives, and fast enough for a night run.
  const CONCURRENCY = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < target.length) {
      const url = target[cursor++];
      const verdict = await probe(url);
      if (verdict === "dead") {
        const pages = [...outbound.get(url)];
        dead.push({ url, pages: pages.slice(0, 3), pageCount: pages.length });
        console.log(`🔴 DEAD  ${url}`);
        if (VERBOSE) console.log(`        cited on ${pages.length} page(s): ${pages.slice(0, 3).join(", ")}`);
      } else if (verdict === "unchecked") {
        unchecked.push(url);
        if (isBotWall(url) && VERBOSE) console.log(`⚪ blocked/unknown (bot wall)  ${url}`);
      } else {
        ok++;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("📊 Outbound citation report");
  console.log("═══════════════════════════════════════");
  console.log(`   Checked:   ${target.length}`);
  console.log(`   Alive:     ${ok}`);
  console.log(`   DEAD:      ${dead.length}`);
  console.log(`   Unchecked: ${unchecked.length} (blocks us / timeout — not judged)`);

  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          checked: target.length,
          ok,
          dead,
          unchecked: unchecked.slice(0, 200),
          generated: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`   → ${OUT}`);
  }

  if (dead.length) {
    console.log(`\n🔴 ${dead.length} dead citation(s) — pages promise evidence that no longer exists.`);
    process.exit(1);
  }
  console.log("\n✅ No dead outbound citations.");
  process.exit(0);
}

main();
