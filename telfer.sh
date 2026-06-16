#!/usr/bin/env bash
# telfer.sh — Change detection & diff report for Telfer Wiki vault
# Usage: telfer.sh [--check] [--report] [--watch]
#   --check    Exit with code 1 if uncommitted changes detected (for CI)
#   --report   Show detailed diff of changes
#   --watch    Watch for changes (requires inotifywait)
#   (no args)  Quick status: shows if vault has uncommitted changes

set -euo pipefail

VAULT_DIR="${HOME}/ObsidianVault/Family History"
REPO_DIR="${HOME}/telfer-wiki"
PEOPLE_JSON="${REPO_DIR}/src/data/people.json"
PUB_JSON="${REPO_DIR}/src/data/people.public.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[telfer.sh]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err() { echo -e "${RED}[ERROR]${NC} $*"; }
ok() { echo -e "${GREEN}[OK]${NC} $*"; }

check_git_status() {
  cd "${REPO_DIR}"
  if ! git diff --quiet -- "${PEOPLE_JSON}"; then
    return 1
  fi
  if ! git diff --quiet -- "${PUB_JSON}"; then
    return 1
  fi
  return 0
}

show_diff() {
  cd "${REPO_DIR}"
  echo -e "\n=== ${PEOPLE_JSON} ==="
  git diff -- "${PEOPLE_JSON}" || true
  echo -e "\n=== ${PUB_JSON} ==="
  git diff -- "${PUB_JSON}" || true
}

show_status() {
  cd "${REPO_DIR}"
  echo "=== Telfer Wiki Change Status ==="
  echo "Vault dir:  ${VAULT_DIR}"
  echo "Repo dir:   ${REPO_DIR}"
  echo
  
  # Check if vault files exist
  if [[ ! -d "${VAULT_DIR}" ]]; then
    warn "Vault directory not found: ${VAULT_DIR}"
    return
  fi
  
  local vault_md_count=$(find "${VAULT_DIR}" -name "*.md" -type f | wc -l)
  echo "Vault .md files: ${vault_md_count}"
  
  if check_git_status; then
    ok "No uncommitted changes in tracked JSON files"
  else
    warn "UNCOMMITTED CHANGES DETECTED in people.json or people.public.json"
    echo
    show_diff
  fi
  
  # Show git status summary
  echo
  echo "=== Git Status ==="
  git status --short
}

watch_vault() {
  if ! command -v inotifywait >/dev/null 2>&1; then
    err "inotifywait not installed. Install with: sudo apt install inotify-tools"
    exit 1
  fi
  
  log "Watching ${VAULT_DIR} for changes... (Ctrl+C to stop)"
  inotifywait -m -r -e modify,create,delete,move "${VAULT_DIR}" --format '%w%f %e %T' --timefmt '%H:%M:%S' | while read file event time; do
    if [[ "${file}" == *.md ]]; then
      log "[$time] ${event}: ${file}"
      show_status
    fi
  done
}

main() {
  case "${1:-}" in
    --check)
      if check_git_status; then
        ok "Clean"
        exit 0
      else
        warn "Dirty"
        exit 1
      fi
      ;;
    --report)
      show_diff
      ;;
    --watch)
      watch_vault
      ;;
    *)
      show_status
      ;;
  esac
}

main "$@"