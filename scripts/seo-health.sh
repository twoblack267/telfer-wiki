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

# ── 5. Sitemap URL count (should be ~300+ people entries) ──
CNT=$(grep -o 'telferwiki.com/people/' dist/sitemap-0.xml 2>/dev/null | wc -l | tr -d ' ')
[ "$CNT" -ge 300 ] && ok "sitemap has $CNT person URLs" || bad "sitemap only $CNT person URLs (expect ≥300)"

say ""
say "=== RESULT: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  say "ISSUES: ${ISSUES[*]}"
  exit 1
fi
exit 0
