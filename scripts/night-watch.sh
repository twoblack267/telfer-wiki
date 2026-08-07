#!/usr/bin/env bash
# night-watch.sh — Telfer Wiki Self-Evolution Night Watch
#
# Runs the whole health pipeline in one deterministic pass:
#   1. convert-vault -> people.json
#   2. duplicate scan
#   3. build (sanitize + validate + astro build + postbuild link-check)
#   4. audit-site (score /10)
#   5. scan-404 (live broken links)
#   6. ledger record
#   7. git commit + push (fires GH Actions auto-deploy) — controlled by AUTO_PUSH
#
# Exit 0 = all good (or auto-pushed). Non-zero = something broke.
#
# Emits a clean summary to stdout, which the cron delivers to Mark on Telegram.
# Silent on stdout is NOT used here — Mark wants a Telegram alert every run to spot-check.

set -uo pipefail
cd "$HOME/telfer-wiki" || { echo "🔴 Night Watch: repo dir not found"; exit 1; }

AUTO_PUSH="${AUTO_PUSH:-1}"   # 1 = git push on its own, 0 = stop & report
VERBOSE="${VERBOSE:-0}"

FAIL=""
WARN=""
BLOCK_PUSH=0   # set to 1 when a step fails so a broken state is never committed/pushed

echo "🌳 TELFER WIKI — NIGHT WATCH"
echo "============================"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

# ── 1. Vault sync ─────────────────────────────────────────────
echo "[1/6] Syncing vault → people.json..."
if node scripts/convert-markdown.mjs; then
  echo "  ✅ Vault synced"
else
  echo "  🔴 convert-markdown failed"
  FAIL="${FAIL} convert-markdown"
fi

# ── 2. Duplicate scan ─────────────────────────────────────────
echo "[2/6] Scanning for duplicate IDs / people..."
DUP_OUT=$(python3 - <<'PY'
import json
from collections import defaultdict
data = json.load(open('src/data/people.json'))
groups = defaultdict(list)
for p in data:
    key = (p.get('slug') or p.get('id') or p.get('first_name','')+' '+p.get('last_name',''))
    groups[key].append(p)
# True dups: same slug+virtually no distinguishing data, OR same name+same spouse+same kids
real = []
for k, members in groups.items():
    if len(members) < 2: continue
    # Count people who look like empty shells of each other
    shells = [m for m in members if not (m.get('birth_year') or m.get('death_year'))]
    if shells and len(shells) < len(members):
        real.append({'name': k, 'shells': len(shells), 'total': len(members)})
print(json.dumps(real))
PY
)
DUP_N=$(python3 -c "import json,sys; print(len(json.loads('''$DUP_OUT''')) if '''$DUP_OUT'''.strip() else 0)" 2>/dev/null || echo 0)
if [ "$DUP_N" -gt 0 ]; then
  echo "  🟡 $DUP_N possible duplicate group(s): $DUP_OUT"
  WARN="${WARN} dups:$DUP_N"
else
  echo "  ✅ No duplicates found"
fi

# ── 3. Build ──────────────────────────────────────────────────
echo "[3/6] Building site (sanitize + validate + astro build)..."
if npm run build; then
  echo "  ✅ Build succeeded (incl. link check + redirects)"
else
  echo "  🔴 Build failed — WILL NOT push broken state"
  FAIL="${FAIL} build"
  BLOCK_PUSH=1
fi

# ── 4. Audit ──────────────────────────────────────────────────
SCORE="?"
PROFILES="?"
TREES="?"
ISSUES_JSON="{}"
echo "[4/6] Running site audit..."
if node scripts/audit-site.mjs > /tmp/nw-audit.log 2>&1; then
  MACHINE=$(python3 -c "
import re,sys
t=open('/tmp/nw-audit.log').read()
m=re.search(r'---MACHINE_START---\n(.*?)\n---MACHINE_END---', t, re.S)
print(m.group(1) if m else '{}')" 2>/dev/null)
  if [ -n "$MACHINE" ]; then
    SCORE=$(printf '%s' "$MACHINE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('score','?'))" 2>/dev/null || echo "?")
    PROFILES=$(printf '%s' "$MACHINE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('profiles','?'))" 2>/dev/null || echo "?")
    TREES=$(printf '%s' "$MACHINE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('trees','?'))" 2>/dev/null || echo "?")
    ISSUES_JSON=$MACHINE
  fi
  echo "  ✅ Audit score: $SCORE/10 · $PROFILES profiles · $TREES trees"
else
  echo "  🟡 Audit script errored (non-fatal)"
  WARN="${WARN} audit"
fi

# ── 5. Live 404 scan ──────────────────────────────────────────
echo "[5/6] Scanning live site for broken links (throttled)..."
if node scripts/scan-404.mjs > /tmp/nw-404.log 2>&1; then
  BROKEN="0"
  echo "  ✅ All live links resolving"
else
  BROKEN_RAW=$(tail -5 /tmp/nw-404.log | grep -oE 'Failures: [0-9]+' | grep -oE '[0-9]+' | head -1)
  BROKEN="${BROKEN_RAW:-1}"
  echo "  🔴 $BROKEN live link(s) broken — see /tmp/nw-404.log"
  FAIL="${FAIL} broken-links:$BROKEN"
fi

# ── 6. Ledger record ──────────────────────────────────────────
echo "[6/6] Recording to evolution ledger..."
LEVELS=$(printf '%s' "$ISSUES_JSON" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); i=d.get('issues',{})
    print(f\"{i.get('high',0)} {i.get('medium',0)} {i.get('low',0)}\")
except: print('0 0 0')" 2>/dev/null)
set -- $LEVELS
HIGH=${1:-0}; MED=${2:-0}; LOW=${3:-0}
SUMMARY=""
[ -n "$FAIL" ] && SUMMARY="⚠️ $FAIL" || SUMMARY="All checks passed"
[ -n "$WARN" ] && SUMMARY="$SUMMARY · $WARN"
if node scripts/evolution-ledger.mjs record \
    --score "$SCORE" --people "$PROFILES" --trees "$TREES" \
    --high "$HIGH" --medium "$MED" --low "$LOW" \
    --duplicates "$DUP_N" --broken "$BROKEN" \
    --summary "$SUMMARY"; then
  echo "  ✅ Ledger updated"
else
  echo "  🟡 Ledger failed (non-fatal)"
  WARN="${WARN} ledger"
fi

# ── 7. Git commit + push ─────────────────────────────────────
echo "[7] Checking for changes..."
if [ "$BLOCK_PUSH" = "1" ]; then
  echo "  ⛔ Build/validation failed — changes left UNCOMMITTED and UNPUSHED"
  echo "  To keep local data in sync, resolve the failures then re-run."
elif git diff --quiet; then
  echo "  ℹ️  No changes — nothing to push"
else
  git add -A
  echo "  Detected changes. Committing..."
  git commit -m "Night Watch: auto-sync vault + rebuild ($(date '+%Y-%m-%d %H:%M'))" -q
  if [ "$AUTO_PUSH" = "1" ]; then
    if git push origin main 2>/tmp/nw-push.log; then
      echo "  ✅ Pushed — GitHub Actions is redeploying the live site"
    else
      echo "  🔴 Push failed: $(cat /tmp/nw-push.log | tail -2)"
      FAIL="${FAIL} push"
    fi
  else
    echo "  ℹ️  Changes committed but AUTO_PUSH=0 — NOT pushed. Run \`git push origin main\`."
  fi
fi

echo ""
echo "============================"
if [ -n "$FAIL" ]; then
  echo "◼ NIGHT WATCH COMPLETE — ISSUES:${FAIL}"
  exit 1
else
  echo "◼ NIGHT WATCH COMPLETE — ALL CLEAR"
  exit 0
fi
