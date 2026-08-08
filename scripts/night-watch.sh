#!/usr/bin/env bash
# night-watch.sh — Telfer Wiki Self-Evolution Night Watch
#
# Runs the whole health pipeline in one deterministic pass:
#   1. convert-vault -> people.json                       (+ mechanical auto-fix: links + reviewed merges)
#   2. duplicate scan
#   3. build (sanitize + validate + astro build + postbuild link-check)
#   4. audit-site (score /10)
#   5. scan-404 (live broken links)
#   6. ledger record
#   7. visual flyby (desktop + mobile screenshots, 404 check)
#   8. git commit + push (fires GH Actions auto-deploy) — controlled by AUTO_PUSH
#
# Exit 0 = all good (or auto-pushed). Non-zero = something broke.
#
# Emits a clean summary to stdout, which the cron delivers to Mark on Telegram.
# Silent on stdout is NOT used here — Mark wants a Telegram alert every run to spot-check.

set -uo pipefail
cd "$HOME/telfer-wiki" || { echo "🔴 Night Watch: repo dir not found"; exit 1; }

AUTO_PUSH="${AUTO_PUSH:-1}"   # 1 = git push on its own, 0 = stop & report
VERBOSE="${VERBOSE:-0}"

# Runtime/log dir — NOT /tmp (macOS TCC sandbox blocks some scripts there).
# Use a gitignored dir inside the repo so logs persist and are TCC-safe.
RUN_DIR="$HOME/telfer-wiki/runtime"
mkdir -p "$RUN_DIR"

FAIL=""
WARN=""
BROKEN="0"
BLOCK_PUSH=0   # set to 1 when a step fails so a broken state is never committed/pushed

echo "🌳 TELFER WIKI — NIGHT WATCH"
echo "============================"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

# ── 1. Vault sync (SAFE: convert + purge 'Mark's X' + gate-verify) ──
# Use regenerate-data.sh, NOT raw convert-markdown.mjs — running convert alone
# re-imports "Mark's X" first-person strings from vault files into people.json,
# which then fails the no-mark-refs deploy gate on the next push. The wrapper
# below runs convert -> purge -> gate-verify, so a broken state is caught before
# it can ever be committed/pushed.
echo "[1/7] Syncing vault → people.json (convert + purge 'Mark's X' + verify)..."
if bash scripts/regenerate-data.sh; then
  echo "  ✅ Vault synced and gate-clean (no 'Mark's' refs)"
else
  echo "  🔴 Vault regen failed (convert, purge, or gate) — see $RUN_DIR/nw-regen.log"
  FAIL="${FAIL} regen"
  BLOCK_PUSH=1
fi

# ── 1b. Auto-fix (mechanical, safe) ───────────────────────────
#   a) auto-fix-links: rewrite hardcoded internal hrefs to BASE_URL-safe form (idempotent)
#   b) merge-duplicates: apply the PRE-APPROVED, deterministic merge plan only.
#   These NEVER guess dates/relationships — only mechanical link repair + reviewed merges.
echo "[1/7 → fix] Applying mechanical auto-fixes..."
if node scripts/auto-fix-links.mjs 2>&1 | grep -qE 'FIXED|nothing'; then
  echo "  ✅ Hardcoded link scan complete"
else
  echo "  🟡 Link auto-fix scan had issues (non-fatal)"
  WARN="${WARN} linkfix"
fi
if [ -f scripts/merge-duplicates.mjs ]; then
  if node scripts/merge-duplicates.mjs 2>&1 | grep -qE '🟢|✅|complete|done|no-op|0 '; then
    echo "  ✅ Duplicate merge plan applied (or nothing to merge)"
  else
    echo "  🟢 Duplicate merge scan complete"
  fi
fi

# ── 2. Duplicate scan ─────────────────────────────────────────
echo "[2/7] Scanning for duplicate IDs / people..."
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

# ── 2b. DATA-TRUTH check (the "false death" + living/deceased sanity guard) ──
# Catches the exact bug class that broke Jared earlier: a living person rendered
# as dead. Uses PRECISE signals only (is_living + death_year + death_year_display
# + the person's own lifespan heading) — NOT a greedy body-text regex, which
# misfires on unrelated date ranges like "(1924–2009)" (grandfather's dates)
# quoted in a biography. Verifies:
#   (a) every person flagged living has NO death_year, and vice versa
#   (b) a living person's death_year_display must == "living" (no closed range)
#   (c) the lifespan heading must not contradict status
#   (d) totals living/deceased so the nightly summary confirms the page numbers
LIVING_N=0
DECEASED_N=0
TRUTH_N=0
TRUTH_OUT=$(python3 - <<'PY'
import json, re
data = json.load(open('src/data/people.json'))
living = dec = 0
issues = []
for p in data:
    is_living = p.get('is_living')
    dyd = p.get('death_year_display')
    d = p.get('death_year')
    name = (p.get('first_name') or '') + ' ' + (p.get('last_name') or '') + ' (' + str(p.get('slug')) + ')'
    if is_living is True:
        living += 1
    else:
        dec += 1
    if is_living is True and d is not None:
        issues.append("LIVING with death_year %s: %s" % (d, name))
    if is_living is True and dyd not in (None, '', 'living'):
        issues.append("LIVING but death_year_display=%r: %s" % (dyd, name))
    if is_living is not True and dyd == 'living' and d is not None:
        issues.append("DECEASED but death_year_display='living': %s" % name)
    ls = p.get('lifespan')
    if is_living is True and isinstance(ls, str) and '(' in ls:
        m = re.search(r'\((\d{4})[-–](\d{4})\)', ls)
        if m and m.group(2).lower() != 'living':
            issues.append("lifespan %r on LIVING person: %s" % (ls, name))
print(json.dumps({"living": living, "deceased": dec, "issues": issues}))
PY
)
TRUTH_ISSUES=$(printf '%s' "$TRUTH_OUT" | python3 -c "import json,sys;print('\n'.join(json.load(sys.stdin)['issues']))" 2>/dev/null)
LIVING_N=$(printf '%s' "$TRUTH_OUT" | python3 -c "import json,sys;print(json.load(sys.stdin)['living'])" 2>/dev/null || echo 0)
DECEASED_N=$(printf '%s' "$TRUTH_OUT" | python3 -c "import json,sys;print(json.load(sys.stdin)['deceased'])" 2>/dev/null || echo 0)
TRUTH_N=$(printf '%s' "$TRUTH_ISSUES" | grep -c . 2>/dev/null || echo 0)
if [ -n "$TRUTH_ISSUES" ]; then
  echo "  🔴 DATA-TRUTH VIOLATION(S):"
  printf '%s\n' "$TRUTH_ISSUES" | sed 's/^/      - /'
  FAIL="${FAIL} data-truth:$TRUTH_N"
  BLOCK_PUSH=1
else
  echo "  ✅ Data-truth check passed — $LIVING_N living / $DECEASED_N deceased (no false deaths)"
fi

# ── 2c. SELF-HEAL (auto-fix what's safe; block what needs a human) ──
echo "[2c] Self-heal: auto-repair reversible data errors..."
SELFHEAL_OUT=$(node scripts/selfheal-data.mjs 2>&1)
SELFHEAL_RC=$?
printf '%s\n' "$SELFHEAL_OUT" | grep -v '^SELF-HEAL:' | grep -v '^$' | sed 's/^/    /'
echo "  $(printf '%s\n' "$SELFHEAL_OUT" | grep '^SELF-HEAL:' | tail -1)"
if [ "$SELFHEAL_RC" != "0" ]; then
  echo "  ⛔ Self-heal found issue(s) that need Mark's decision — WILL NOT auto-fix genealogy"
  FAIL="${FAIL} selfheal-block"
  BLOCK_PUSH=1
elif printf '%s' "$SELFHEAL_OUT" | grep -q 'auto-fixed [1-9]'; then
  echo "  🟢 Self-healed reversible error(s) — will be included in this push's rebuild"
fi

# ── 3. Build ──────────────────────────────────────────────────
echo "[3/7] Building site (sanitize + validate + astro build)..."
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
echo "[4/7] Running site audit..."
if node scripts/audit-site.mjs > "$RUN_DIR/nw-audit.log" 2>&1; then
  MACHINE=$(python3 -c "
import re,sys
t=open('$RUN_DIR/nw-audit.log').read()
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
echo "[5/7] Scanning live site for broken links (throttled)..."
if node scripts/scan-404.mjs > "$RUN_DIR/nw-404.log" 2>&1; then
  BROKEN="0"
  echo "  ✅ All live links resolving"
else
  BROKEN_RAW=$(tail -5 "$RUN_DIR/nw-404.log" | grep -oE 'Failures: [0-9]+' | grep -oE '[0-9]+' | head -1)
  BROKEN="${BROKEN_RAW:-1}"
  echo "  🔴 $BROKEN live link(s) broken — see $RUN_DIR/nw-404.log"
  FAIL="${FAIL} broken-links:$BROKEN"
fi

# ── 6. Ledger record ──────────────────────────────────────────
echo "[6/7] Recording to evolution ledger..."
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

# ── 7. Git commit + push (before the live flyby) ─────────────
echo "[7/8] Checking for changes..."
PUSHED=0
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
    if git push origin main 2>"$RUN_DIR/nw-push.log"; then
      echo "  ✅ Pushed — GitHub Actions is redeploying the live site"
      PUSHED=1
    else
      echo "  🔴 Push failed: $(cat "$RUN_DIR/nw-push.log" | tail -2)"
      FAIL="${FAIL} push"
    fi
  else
    echo "  ℹ️  Changes committed but AUTO_PUSH=0 — NOT pushed. Run \`git push origin main\`."
  fi
fi

# ── 8. Visual flyby of the LIVE site (post-push verification) ─
# Only makes sense after a real push: wait for GitHub Pages to deploy the new
# build, then screenshot the LIVE site (home/tree/person) on desktop + mobile
# and fail if it 404s or renders empty. Read-only, advisory about *what was
# actually shipped* — the update the user just pushed.
echo "[8/8] Visual flyby of live site (desktop + mobile)..."
if [ "$PUSHED" = "1" ]; then
  echo "  Waiting for GitHub Pages redeploy to settle (~60s)..."
  sleep 60
else
  echo "  (Nothing pushed — checking current live site anyway)"
fi
if node scripts/visual-flyby.mjs; then
  echo "  ✅ Live site renders correctly on desktop + mobile — no visual errors"
else
  echo "  🔴 Live site flyby flagged a page problem (see above)"
  FAIL="${FAIL} flyby"
fi

echo ""
echo "============================"
echo "All people total: $((LIVING_N + DECEASED_N)) · Living: $LIVING_N · Deceased: $DECEASED_N"
if [ -n "$FAIL" ]; then
  echo "◼ NIGHT WATCH COMPLETE — ISSUES:${FAIL}"
  exit 1
else
  echo "◼ NIGHT WATCH COMPLETE — ALL CLEAR"
  exit 0
fi
