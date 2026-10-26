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
# ORDER MATTERS. postbuild gates read dist/ — running one before `npm run build`
# makes it pass on stale output or fail on no output at all. An earlier version
# of this script ran the receipt gate FIRST and filed a false "counter is
# fiction" card against a dist/ that simply had not been written yet. Build
# first; escalate on the build's own exit code. The gates already run inside
# postbuild — do not run them twice.
#
# Usage:  ./build-local.sh
set -uo pipefail
cd "$(dirname "$0")"

GATE_PY="$HOME/.hermes/scripts/gate-with-escalation.py"

echo "🔨 local build (a failure files a Can Do card, report only)"
npm run build
BUILD_RC=$?

if [ "$BUILD_RC" -eq 0 ]; then
  echo "✅ build and all postbuild gates passed (rc=0)"
  exit 0
fi

echo ""
echo "🛑 npm run build failed (rc=$BUILD_RC)"
if [ ! -f "$GATE_PY" ]; then
  echo "⚠️  escalation script missing ($GATE_PY) — the failure was NOT filed to the board"
  exit "$BUILD_RC"
fi

# Re-run the build through the escalation wrapper. It executes the command
# itself, so the model gets one clean failure to describe instead of a log tail.
echo "🧠 escalating to the Can Do board…"
python3 "$GATE_PY" \
  --gate "npm-run-build" \
  --cmd "npm run build" \
  --cwd "$PWD" \
  --source "telfer-wiki local build"
ESC_RC=$?

case "$ESC_RC" in
  0) echo "   (the gate passed on re-run — the first failure was transient)" ;;
  3) echo "   ⛔ THE CARD COULD NOT BE VERIFIED. This is itself a defect." ;;
  4) echo "   card filed with raw evidence (local model was unreachable)." ;;
  *) echo "   card filed and verified on the Can Do board." ;;
esac
exit "$BUILD_RC"
