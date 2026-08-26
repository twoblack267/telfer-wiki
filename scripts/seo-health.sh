#!/usr/bin/env bash
# ============================================================
# seo-health.sh — SEO freshness + auto-rebuild watchdog for the
# Telfer Wiki. Complements night-watch.sh (data integrity);
# THIS one owns the SEO/site layer.
#
# What it does each run:
#   1. Verifies the SEO layer is intact in the latest build:
#        - sitemap-index.xml + sitemap-0.xml exist
#        - robots.txt 200 with a Sitemap: directive
#        - llms.txt present
#        - telferwiki-og.png present
#        - a sample person page carries a unique description,
#          Schema.org Person, canonical, and og:type
#   2. If src/data/people.public.json changed since the last
#      build (gauge: dist/timestamp), rebuild + push to main so
#      the sitemap regenerates with any new people.
#
# Emits a compact summary on stdout for the cron agent.
# ============================================================
set -uo pipefail
cd "$HOME/telfer-wiki" || exit 1

RUN_DIR="$HOME/.hermes/scripts/.seo-health-run"
mkdir -p "$RUN_DIR"
PASS=0; FAIL=0
declare -a ISSUES=()

say()  { printf '%s\n' "$*"; }
ok()   { say "  ✅ $*"; PASS=$((PASS+1)); }
bad()  { say "  ❌ $*"; FAIL=$((FAIL+1)); ISSUES+=("$*"); }

say "=== SEO health check $(date '+%Y-%m-%d %H:%M') ==="

# ── 1. Build if source is newer than current dist ──
if [ ! -f dist/.build-timestamp ] || [ "src/data/people.public.json" -nt "dist/.build-timestamp" ]; then
  say "  ⬆️  Data changed since last build — rebuilding…"
  if npm run build >/dev/null 2>&1; then
    date +%s > dist/.build-timestamp
    say "  ✅ rebuild OK"
  else
    bad "build failed"
    FAIL=$((FAIL+1))
  fi
else
  say "  ⏩ no data change — dist is current"
fi

# ── 2. Static files must exist in dist ──
for f in sitemap-index.xml sitemap-0.xml robots.txt llms.txt telferwiki-og.png; do
  [ -f "dist/$f" ] && ok "$f present" || bad "$f missing"
done

# ── 3. robots.txt Sitemap directive must point at a real, present sitemap ──
SMAP=$(grep -i '^Sitemap:' dist/robots.txt 2>/dev/null | awk '{print $2}')
if [ -n "$SMAP" ]; then
  SMFILE=$(basename "$SMAP")
  if [ -f "dist/$SMFILE" ]; then
    ok "robots.txt Sitemap -> $SMFILE (present in dist)"
  else
    bad "robots.txt Sitemap '$SMFILE' NOT found in dist (404 risk)"
  fi
else
  bad "robots.txt missing Sitemap directive"
fi

# ── 4. Sample person page: unique desc + Person schema + canonical + og:type ──
PAGE=dist/people/elizabeth-beattie-1741/index.html
if [ -f "$PAGE" ]; then
  grep -q 'name="description" content="Elizabeth Beattie' "$PAGE" && ok "unique description" || bad "description not unique/missing"
  grep -q '"@type":"Person"' "$PAGE" && ok "Schema.org Person present" || bad "Person schema missing"
  grep -q 'rel="canonical"' "$PAGE" && ok "canonical present" || bad "canonical missing"
  grep -q 'og:type' "$PAGE" && ok "og:type present" || bad "og:type missing"
else
  bad "sample person page not found: $PAGE"
fi

# ── 5. Sitemap person-page coverage (privacy-aware) ──
# Count EXACT /people/<slug>/ person pages in the live sitemap and compare
# against the actual public person count minus the deliberately NOINDEX'd
# living people (privacy-exclusions.mjs). This replaces the old magic "≥300"
# check, which could NOT know that 5 living Ivory people are intentionally
# kept out of the sitemap (privacy request 2026-08-25) — the source of a
# recurring false-positive. It also separates person pages from the
# /people/<slug>/family-sheet/ sub-pages and the special /people/{dna,
# families,full-tree}/ views, so the count is honest.
EXPECTED_MIN=$(node -e '
  const d = require("./src/data/people.public.json");
  // privacy-exclusions.mjs is an ES module; re-read its slug list directly.
  const fs = require("fs");
  const src = fs.readFileSync("./src/data/privacy-exclusions.mjs", "utf8");
  const noindex = new Set([...src.matchAll(/"([a-z0-9-]+)"/g)].map(m => m[1]));
  const real = (d || []).filter(p => p && p.slug && p.slug !== "dna" &&
    p.slug !== "families" && p.slug !== "full-tree" && !noindex.has(p.slug));
  console.log(real.length);
' 2>/dev/null || echo 0)
CNT=$(grep -oE 'telferwiki\.com/people/[a-z0-9-]+/' dist/sitemap-0.xml 2>/dev/null | grep -vE '/family-sheet|/descendants' | sort -u | wc -l | tr -d ' ')
PRIVACY_OK=1
for s in aaron-ivory joel-ivory jared-ivory lauren-ivory karina-ivory; do
  grep -qE "telferwiki\.com/people/$s/" dist/sitemap-0.xml 2>/dev/null && PRIVACY_OK=0
done
if [ "$EXPECTED_MIN" -gt 0 ] && [ "$CNT" -ge "$EXPECTED_MIN" ] && [ "$PRIVACY_OK" -eq 1 ]; then
  ok "sitemap covers $CNT person pages (≥ $EXPECTED_MIN expected post-privacy); 5 Ivory noindex'ed"
elif [ "$EXPECTED_MIN" -eq 0 ]; then
  bad "could not compute expected person count from people.public.json (step 5 can't validate)"
else
  bad "sitemap person-page mismatch: found $CNT, expected ≥ $EXPECTED_MIN, privacy_excluded_ok=$PRIVACY_OK"
fi

# ── 6. Data-driven SEO manifests: valid JSON + well-formed URLs ──
# sameas.json and faqs.json are the only places that inject external entity links
# (sameAs) and FAQ content into person pages. A malformed entry silently degrades
# SEO/AI, so the IT Crew watcher validates them every run.
check_manifest() {
  local f="$1"
  if [ ! -f "src/data/$f" ]; then bad "src/data/$f missing"; return; fi
  if node -e "const d=require('./src/data/$f'); if(!d||typeof d.people!=='object')process.exit(1)" 2>/dev/null; then
    ok "$f valid JSON with people map"
  else
    bad "$f invalid or missing people map"
  fi
}
check_manifest sameas.json
# every sameAs URL must be a well-formed https link (blocks typos / injection)
if node -e '
  const d=require("./src/data/sameas.json").people||{};
  for (const [s,urls] of Object.entries(d))
    for (const u of (urls||[]))
      if (!/^https:\/\/[^ ]+$/.test(u)) { console.error("BAD "+s+": "+u); process.exit(1); }
' 2>/dev/null; then
  ok "all sameAs URLs well-formed https"
else
  bad "one or more sameAs URLs malformed (see check output)"
fi
check_manifest faqs.json
# FAQ entries: { slug: { blurb: string, faqs: [{q,a},...] } }
if node -e '
  const d=require("./src/data/faqs.json").people||{};
  for (const [s,e] of Object.entries(d)) {
    if (e.blurb && typeof e.blurb!=="string") { console.error("BAD blurb "+s); process.exit(1); }
    const items = e.faqs || e || [];
    if (!Array.isArray(items)) { console.error("BAD faqs not array "+s); process.exit(1); }
    for (const it of items)
      if (!it.q || !it.a || typeof it.q!=="string" || typeof it.a!=="string")
        { console.error("BAD "+s+": "+JSON.stringify(it)); process.exit(1); }
  }
' 2>/dev/null; then
  ok "all FAQ items valid (q+a strings)"
else
  bad "one or more FAQ items malformed (see check output)"
fi

say ""
say "=== RESULT: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  say "ISSUES: ${ISSUES[*]}"
  exit 1
fi
exit 0
