#!/usr/bin/env bash
#
# regenerate-data.sh — ONE-SHOT safe regeneration of genealogy data.
#
# Problem it solves: running convert-markdown.mjs on its own re-imports
# first-person "Mark's X" relationship strings from the vault files back into
# src/data/*.json, which then FAILS the no-mark-refs deploy gate. This wrapper
# runs convert -> purge so regenerated data is both dedup-correct AND gate-clean.
#
# Usage:
#   ./scripts/regenerate-data.sh            # regen + purge + cleanup
#   ./scripts/regenerate-data.sh --keep-bak # keep the .bak safety copies
#
# Exits non-zero if the regenerated data still violates the gate.
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP_BAK=0
[[ "${1:-}" == "--keep-bak" ]] && KEEP_BAK=1

echo "==> Step 1/3: convert-markdown.mjs (dedupe + orphan purge)"
node scripts/convert-markdown.mjs

echo
echo "==> Step 2/3: purge-mark-refs.py --apply (strip 'Mark's X' from regenerated data)"
python3 scripts/purge-mark-refs.py --apply

if [[ "$KEEP_BAK" != "1" ]]; then
  echo
  echo "==> Cleaning up .bak safety copies (gitignored; keeping tree tidy)"
  find src/data -name "*.bak" -delete
fi

echo
echo "==> Step 3/3: verify gate-clean (validate-no-mark-refs.py)"
OUT="$(python3 scripts/validate-no-mark-refs.py src/data/people.json src/data/people.public.json 2>&1)" || {
  echo "GATE FAILED — regenerated data still contains 'Mark's' references:"
  echo "$OUT" | head -20
  echo
  echo "Fix: review purge-mark-refs.py patterns or clean affected vault files."
  exit 1
}

COUNT="$(python3 -c "import json,sys;print(len(json.load(open('src/data/people.json'))))")"
echo "OK — $COUNT profiles, no 'Mark's' references, deploy gate passes."
