#!/usr/bin/env bash
# live-photo-sentinel-run — the OUTSIDE photo check, on bender's profile.
#
# Runs the live browser check, then files a Can Do Board card for the 7am Morning
# Check only if a REAL photo fault is found. Exit codes from the sentinel:
#   0 = clean           -> nothing filed
#   1 = photo fault     -> card filed (model writes the diagnosis)
#   3 = site unreachable-> OUTAGE, not photo loss -> nothing filed
#
# The model (qwen3.5-bender via Ollama) is used ONLY to write the plain-English
# diagnosis. The verdict itself is deterministic: an <img> exists or it does not,
# a URL returns bytes or it does not. A language model never gets to overrule a
# measured fact.

set -uo pipefail
REPO="$HOME/telfer-wiki"
RUN_DIR="$HOME/.hermes/cache/scratch/sentinel-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR"

cd "$REPO" || { echo "❌ sentinel-run: cannot cd to $REPO"; exit 2; }

echo "◼ live-photo-sentinel run — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  profile: bender | model: qwen3.5-bender | browser: ego lite / Chromium"

# Ollama must be awake; the model is only needed for the diagnosis, but wake it
# so a failure doesn't wait 90s on a cold load.
curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || echo "  ⚠️  Ollama not responding — diagnosis will use the deterministic fallback"

SENTINEL_JSON="$RUN_DIR/sentinel.json"
# SENTINEL_SITE must survive into the child — a wrapper that silently drops the
# target URL would happily report the wrong site clean.
SENTINEL_SITE="${SENTINEL_SITE:-https://telferwiki.com}" \
  node scripts/live-photo-sentinel.mjs --count 3 --json > "$SENTINEL_JSON" 2>"$RUN_DIR/sentinel.err"
CODE=$?

echo "  sentinel exit=$CODE (0=clean, 1=photo fault, 3=site down)"

case "$CODE" in
  0)
    echo "  ✅ Live photos verified in a real browser — no card filed"
    exit 0
    ;;
  1)
    echo "  ❌ Photo fault found on the LIVE site — filing 7am card"
    node scripts/live-photo-sentinel-card.mjs --input "$SENTINEL_JSON" 2>&1 | sed 's/^/  /'
    CARD_CODE=$?
    if [ "$CARD_CODE" -ne 0 ]; then
      echo "  🟡 Card step returned $CARD_CODE — see output above" >&2
    fi
    exit 1
    ;;
  3)
    echo "  ⚠️  Site unreachable — OUTAGE, not photo loss. No card filed."
    exit 0
    ;;
  *)
    echo "  ❌ Sentinel crashed (exit $CODE)" >&2
    tail -5 "$RUN_DIR/sentinel.err" >&2
    exit 2
    ;;
esac
