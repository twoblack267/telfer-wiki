#!/usr/bin/env bash
# Local build with board escalation.
#
# WHY THIS IS NOT IN package.json postbuild:
# The escalation needs ~/.hermes/scripts/gate-with-escalation.py and a running
# Ollama. Neither exists on a GitHub runner, and wiring it into postbuild broke
# CI with "can't open file '/home/runner/.hermes/scripts/...'". CI stays
# portable and runs the plain test; THIS script is the local gate, where the
# model actually lives.
#
# Mark's ask: a failed gate must wake the local model and drop a card on the
# Can Do board so the breakage gets fixed. Report only — the model explains,
# it never fixes. The exit code always comes from the gate command.
#
# Usage:  ./build-local.sh          (full build, escalate on any gate failure)
set -uo pipefail
cd "$(dirname "$0")"

GATE_PY="$HOME/.hermes/scripts/gate-with-escalation.py"

if [ ! -f "$GATE_PY" ]; then
  echo "⚠️  escalation script missing ($GATE_PY) — running plain build, failures will NOT reach the board"
  exec npm run build
fi

echo "🔨 build with board escalation (failures produce a Can Do card)"
python3 "$GATE_PY" \
  --gate "redirect-receipt-honesty" \
  --cmd "node scripts/test-redirect-receipt-honesty.mjs" \
  --cwd "$PWD" \
  --source "telfer-wiki local build"
GATE_RC=$?

if [ "$GATE_RC" -ne 0 ]; then
  echo ""
  echo "🛑 gate failed (rc=$GATE_RC) — NOT running the rest of the build."
  case "$GATE_RC" in
    1) echo "   card filed and verified on the Can Do board." ;;
    3) echo "   ⛔ THE CARD COULD NOT BE VERIFIED. This is itself a defect." ;;
    4) echo "   card filed with raw evidence (local model was unreachable)." ;;
  esac
  exit "$GATE_RC"
fi

# Gate passed — do the real build.
npm run build
BUILD_RC=$?
if [ "$BUILD_RC" -ne 0 ]; then
  echo ""
  echo "🛑 npm run build failed (rc=$BUILD_RC) — escalating to the board"
  python3 "$GATE_PY" \
    --gate "npm-run-build" \
    --cmd "npm run build" \
    --cwd "$PWD" \
    --source "telfer-wiki local build" || true
fi
exit "$BUILD_RC"
