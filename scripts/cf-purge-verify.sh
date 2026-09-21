#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Cloudflare cache purge + VERIFY, for the telferwiki.com deploy.
#
# WHY THIS EXISTS (card tw-2026-09-12-041, reopened 2026-09-21):
#   Cloudflare stamps cache-control: max-age=14400 on every response, overriding
#   the origin's `no-cache, must-revalidate` for HTML. A finished deploy —
#   including a PRIVACY fix — stays invisible at the edge for up to 4 hours.
#   Measured 2026-09-21: cf-cache-status HIT, age 3200s, last-modified pointing
#   at the PREVIOUS deploy, while the cache-busted origin already served the new
#   page. `/_astro/` (one-year immutable in the repo) was also flattened to 4h,
#   proving a blanket "Cache Everything" rule rather than origin-respecting
#   behaviour.
#
# CONTRACT:
#   1. If no token is configured, this script is a NO-OP and exits 0 with a
#      warning. It must NEVER be able to fail a deploy — same rule the existing
#      ci-escalate.py hook follows ("an alerting hook must never be a failure
#      mode"). A missing secret degrades the fix, it does not break publishing.
#   2. With a token, purge, then VERIFY by re-reading cf-cache-status. A 200 from
#      the purge API is NOT proof — the edge can and does re-serve stale objects
#      past their own `expires` (observed 2026-09-21).
#   3. If the purge works but the edge still reports HIT, WARN loudly and exit 0.
#      The deploy is what matters; the cache is a follow-up, not a blocker.
#
# USAGE:
#   CLOUDFLARE_PURGE_TOKEN=<token> scripts/cf-purge-verify.sh
#   scripts/cf-purge-verify.sh                 # no token -> no-op, exit 0
#
# SETUP (repo secret): Settings -> Secrets and variables -> Actions ->
#   New repository secret -> name: CLOUDFLARE_PURGE_TOKEN
#   value: a token with exactly Zone > Cache Purge > Purge, zone telferwiki.com
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SITE="https://telferwiki.com"
ZONE_NAME="telferwiki.com"
API="https://api.cloudflare.com/client/v4"
TOKEN="${CLOUDFLARE_PURGE_TOKEN:-}"
MAX_ATTEMPTS=12          # ~2min of polling; enough for a purge to land
SLEEP_BETWEEN=10

warn() { echo "::warning::$*"; }
note() { echo "$*"; }

if [ -z "$TOKEN" ]; then
  warn "CLOUDFLARE_PURGE_TOKEN not set — skipping cache purge. Deploy is unaffected. Set the repo secret to enable self-purging deploys (card tw-2026-09-12-041)."
  exit 0
fi

note "──────────────────────────────────────────────────────────────"
note "Cloudflare cache purge for ${ZONE_NAME}"
note "──────────────────────────────────────────────────────────────"

# --- 1. Token must authenticate -------------------------------------------------
verify_resp=$(curl -sS --max-time 30 -H "Authorization: Bearer ${TOKEN}" \
  "${API}/user/tokens/verify" 2>&1) || true
if ! printf '%s' "$verify_resp" | grep -q '"success":true'; then
  warn "Cloudflare token did not authenticate (purge skipped, deploy unaffected): $(printf '%s' "$verify_resp" | head -c 300)"
  exit 0
fi
note "✅ token authenticates"

# --- 2. Resolve the zone id -----------------------------------------------------
zone_resp=$(curl -sS --max-time 30 -H "Authorization: Bearer ${TOKEN}" \
  "${API}/zones?name=${ZONE_NAME}" 2>&1) || true
ZONE_ID=$(printf '%s' "$zone_resp" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    r=d.get("result") or []
    print(r[0]["id"] if r else "")
except Exception:
    print("")
' 2>/dev/null)

if [ -z "$ZONE_ID" ]; then
  warn "could not resolve zone id for ${ZONE_NAME} (purge skipped, deploy unaffected)"
  exit 0
fi
note "✅ zone id ${ZONE_ID}"

# --- 3. Purge EVERYTHING --------------------------------------------------------
# purge_everything is deliberate. A targeted purge needs a URL list, and the
# whole site is ~1000 pages of static output; the cost of purging everything is
# one origin re-fetch per unique visitor path. Correctness (a removal taking
# effect immediately) beats a marginal origin-load saving.
purge_resp=$(curl -sS --max-time 60 -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}' \
  "${API}/zones/${ZONE_ID}/purge_cache" 2>&1) || true

if ! printf '%s' "$purge_resp" | grep -q '"success":true'; then
  warn "purge API call did not report success: $(printf '%s' "$purge_resp" | head -c 300)"
  exit 0
fi
note "✅ purge accepted by the API (this is NOT yet proof — verifying below)"

# --- 4. VERIFY the edge actually dropped the object -----------------------------
# Check a representative set: the homepage AND a deep people page. The existing
# verify-live job only ever polls the homepage, which is exactly the blind spot
# that let a stale /people/ page sit behind a green build.
CHECK_PATHS=(
  "/"
  "/people/mitchell-telfer-2008/"
  "/sitemap-index.xml"
)

edge_state() {
  # echo "<cf-cache-status> <age> <last-modified>"
  curl -sI --max-time 30 "$1" 2>/dev/null | tr -d '\r' | python3 -c '
import sys
st=age=lm=""
for line in sys.stdin:
    low=line.lower()
    if low.startswith("cf-cache-status:"): st=line.split(":",1)[1].strip()
    elif low.startswith("age:"): age=line.split(":",1)[1].strip()
    elif low.startswith("last-modified:"): lm=line.split(":",1)[1].strip()
print(f"{st or '?'}|{age or '?'}|{lm or '?'}")
' 2>/dev/null
}

verified=1
attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  all_fresh=1
  note "  verification pass ${attempt}/${MAX_ATTEMPTS}:"
  for p in "${CHECK_PATHS[@]}"; do
    state=$(edge_state "${SITE}${p}")
    st="${state%%|*}"
    rest="${state#*|}"; age="${rest%%|*}"; lm="${rest#*|}"
    case "$(printf '%s' "$st" | tr '[:lower:]' '[:upper:]')" in
      MISS|EXPIRED|REVALIDATED|DYNAMIC|BYPASS) fresh=1 ;;
      *) fresh=0 ;;
    esac
    [ "$fresh" -eq 0 ] && all_fresh=0
    printf '    %-34s cf-cache-status=%-10s age=%-6s last-modified=%s\n' "$p" "$st" "$age" "$lm"
  done

  if [ "$all_fresh" -eq 1 ]; then
    note "✅ PURGE VERIFIED — edge is serving from origin for all checked paths"
    verified=0
    break
  fi

  sleep "$SLEEP_BETWEEN"
  attempt=$((attempt+1))
done

if [ "$verified" -ne 0 ]; then
  # Do NOT fail the deploy. The purge is best-effort protection; the root cause
  # (the CF cache rule) is the real fix and lives in the Cloudflare dashboard.
  warn "Edge still reporting a cached copy after ${MAX_ATTEMPTS} checks. The purge was accepted but has not visibly taken effect. Deploy is unaffected. Root cause is the Cloudflare 'Cache Everything' / 4h Edge Cache TTL rule — see ~/.hermes/notes/cloudflare-cache-rootcause.md (card tw-2026-09-12-041)."
fi

note "──────────────────────────────────────────────────────────────"
note "purge step complete (deploy is never blocked by this step)"
note "──────────────────────────────────────────────────────────────"
exit 0
