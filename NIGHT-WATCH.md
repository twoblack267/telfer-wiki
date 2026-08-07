# Night Watch — Operations Notes

## Automated pipeline (built 2026-08-07)
- `scripts/night-watch.sh` — nightly watchdog: convert-vault → dup scan → build → audit → 404 scan → ledger → git commit/push (gated by `AUTO_PUSH`).
- `scripts/evolution-ledger.mjs` — dated run-history ledger + automatic monthly pruner.
- Cron entry NOT yet scheduled (needs GitHub push auth first).
- Remote = HTTPS + osxkeychain → non-interactive push fails "Device not configured".
  Fix: `gh auth login` (terminal, once) OR add a `repo`-scope PAT to `~/.hermes/.env` as `GITHUB_TOKEN=ghp_...`.

## Data-integrity work (same session — on branch `reconcile-2026-08-07`)
Committed as `fd8e3fc` + `f17caa0`, held OFF main pending user review.

### Duplicate merges (all verified, build passes: duplicate slugs=0, critical=0, 0 broken links)
- **Amy Ellen Telfer** — keep `amy-telfer-1884` (real dates/parents/bio); folded "née Provis" into body; DELETED `amy-ellen-telfer` shell.
- **Hannah Peacock** — keep `hannah-peacock-1840`; DELETED `hannah-peacock-living` shell.
- **Mary Anne McIntyre** — keep `mary-anne-mcintyre-1836`; DELETED `mary-anne-mcintyre-anne` shell.
- **Susan Burton / Susan Burton Telfer** — TRUE MERGE. Kept `susan-telfer-1844` (full bio, Yahl SA, spouses Robert Telfer + Leslie Robert, child James Robert). Deleted BOTH stubs `susan-burton-1844` + `susan-burton-1845`. Re-pointed `james-robert-telfer.parents` "Susan Burton (1844–1924)" → "Susan Burton Telfer (1844–1924)".

### Duplicate slugs blocking build (critical) — resolved
- **Margaret Wright / Margaret Wright Telfer** — dup slugs with birth CONFLICT (1807 vs 1810). **BOOK SOURCE RESOLVES TO 1810** — Supplement-2008 p.203 "Margaret Wright (1810-1892)"; committed audit e222fce set 1810 per book. Kept the full 1810 biography record (gravestone, life summary); remove the 1807 dup. ⚠️ **OPEN for Mark**: her own gravestone age (died 1892 aged 86-87 → ~1805-6) challenges BOTH 1807 and 1810. Not to be resolved by guessing — needs verifier + Mark.
- **Amy Farrow Stribling** — deleted the redirect-shell stub (`superseded by full profile`); kept the full record.

### Naming rule (proper names, NOT "Mark's [role]")
- Ran the project's own `scripts/fix-mark-perspective.py` (curated replacements, e.g. "Mark's wife" → "Wife of Mark Telfer"; "Mark's eldest son" → "Eldest son of Mark Telfer"). Fixed 56 occurrences across 24+ people.
- `validate-no-mark-refs.py` now passes (0 violations). Nick Telfer page "Mark's cousin" → "Cousin — son of Grantley Keith Telfer" fixed.

## Host-path note
`fix-mark-perspective.py` hardcodes `/home/mark/telfer-wiki` (Linux home of the old host). On this Mac run via a path-substituted copy: `sed 's#/home/mark/telfer-wiki#/Users/marktelfer/telfer-wiki#g'`. Consider making it path-agnostic later.

## Full Tree UI fixes (on main, committed `43b9fba`)
- Removed `truncate` class -> long names (Mark, Levi, Zabella, Mitchell) no longer clipped.
- Added 9th-Gen jump (Mitchell 2008–); corrected 8th-Gen range to Mark's birth (1986).
