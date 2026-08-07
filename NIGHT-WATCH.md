# Night Watch — Operations Notes

## Status (Aug 2026)
- **Built:** `scripts/night-watch.sh` (full pipeline watchdog) + `scripts/evolution-ledger.mjs` (run-history ledger + pruner). Both on `main`.
- **Deps fixed:** repo previously had NO `node_modules` → local builds impossible → live site numbers frozen. `npm install` done.
- **Live site healthy:** 300 people build clean, NO broken links (404 scan + link check pass), audit ~score.

## BLOCKER — GitHub auth for auto-push
- Remote is `https://github.com/twoblack267/telfer-wiki.git` (HTTPS + osxkeychain helper).
- Non-interactive push fails: `fatal: could not read Username ... Device not configured`.
- **Fix (one-time):** run `gh auth login` in a terminal on this Mac, OR store a PAT with `repo` scope as `GITHUB_TOKEN` in `~/.hermes/.env`. Until then night-watch commits locally and reports the push failure (safe default — it never pushes silently).

## PENDING — reconcile branch
- `reconcile-2026-08-07` (side branch, OFF main): 12 new vault people + a Margaret Wright naming reconciliation (women-surname convention). **NOT on main**, so won't deploy. Needs Mark's review before merge to main.
  - New: Stribling (Alfred/Amy/Arthur/Sidney-Gilbert), Farrow (Joseph/Amy/Esther), Elizabeth Telfer Farrow Holloway, Latter, Drummond, Haining, Margaret Wright.
  - Concern flagged: `margaret-wright-1807` vs `margaret-telfer-1807` (birth 1807 vs 1810; the 1810 was a prior manual fix per commit e222fce) — verify against the 1810 fix before merging.

## Merge back to main
```bash
git checkout main
git merge reconcile-2026-08-07 --no-ff -m "Merge: 12 new vault people (reviewed)"
git push origin main   # triggers GH Actions → live deploy
```

## Cron
Night Watch cron job scheduled via Hermes (`cronjob` tool). It drives `night-watch.sh`. Auto-push is disabled until GitHub auth is fixed.
