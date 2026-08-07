# Night Watch — Operations Notes

## Status (Aug 2026)
- **Built:** `scripts/night-watch.sh` (full pipeline watchdog) + `scripts/evolution-ledger.mjs` (run-history ledger + pruner). Both on `main`.
- **Deps fixed:** repo previously had NO `node_modules` → local builds impossible → live site numbers frozen. `npm install` done.
- **GitHub push auth: SOLVED** — `gh auth login` complete (twoblack267); git wired to gh credential helper (non-interactive push works). Night Watch auto-push is ON.
- **Cron job: SCHEDULED** via Hermes as **"Telfer Wiki Website Audit"** — nightly 20:00, wrapper `~/.hermes/scripts/telfer-night-watch.sh` → repo `scripts/night-watch.sh`.
- **Push-safety fix:** Night Watch never commits/pushes a broken state. If the build gate fails it leaves changes uncommitted/unpushed and reports 🔴 (commit `f52361a`).

## Merge back to main (2026-08-07) — DONE
- reconcile branch merged + pushed. Contains: 12 new vault people (Stribling/Farrow/Holloway/Latter/Drummond/Haining), duplicate merges, 56 proper-name fixes.
- **ON HOLD (open):** Margaret Wright birth-year conflict — see below. Not resolved; waiting on verifier + more information (per Mark).

## Data-integrity work
### Duplicate merges (build passes: duplicate slugs=0, critical=0)
- **Amy Ellen Telfer** — keep `amy-telfer-1884`; folded "née Provis" into body; DELETED shell.
- **Hannah Peacock** — keep `hannah-peacock-1840`; DELETED `hannah-peacock-living` shell.
- **Mary Anne McIntyre** — keep `mary-anne-mcintyre-1836`; DELETED shell.
- **Susan Burton / Susan Burton Telfer** — TRUE MERGE. Kept `susan-telfer-1844`; deleted both stubs; re-pointed `james-robert-telfer.parents`.
- **Amy Farrow Stribling** — deleted redirect-shell stub; kept full record.

### Margaret Wright birth-year CONFLICT — ⚠️ OPEN, DO NOT RESOLVE BY GUESSING
Duplicate slugs `margaret-wright-1807` / `margaret-telfer-1807` with birth CONFLICT: **book 1810** (Supplement-2008 p.203 "Margaret Wright (1810–1892)") vs **vault index 1807** vs **gravestone ~1805–06** (died 13 Sep 1892 aged 86–87). Restored the full 1810 biography record. **HOLD for Mark + verifier per 2026-08-07 ruling: wait for more information.**

### Naming rule (proper names, NOT "Mark's [role]")
Ran `scripts/fix-mark-perspective.py` — fixed 56 occurrences across 24+ people. `validate-no-mark-refs.py` passes (0 violations).

## Host-path note
`fix-mark-perspective.py` hardcodes `/home/mark/telfer-wiki` (old Linux host). On this Mac run via path-substituted copy: `sed 's#/home/mark/telfer-wiki#/Users/marktelfer/telfer-wiki#g'`.

## Full Tree UI fixes (on main, `43b9fba`)
- Removed `truncate` class → long names no longer clipped.
- Added 9th-Gen jump (Mitchell 2008–); corrected 8th-Gen range to Mark's birth (1986).
