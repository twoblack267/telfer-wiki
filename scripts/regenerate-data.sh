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
echo "==> Step 2b/3: prove the purge cannot CORRUPT prose (test-purge-mark-refs.py)"
# tw-2026-09-12-043: purge-mark-refs.py rewrites "Mark's <role>" into a bare role word.
# A rule of that shape shipped broken grammar to the live site ("...was Grandfather, who
# died in 2009.") with every gate green. This test asserts the rewrites cannot delete
# adjacent words, leave doubled spaces, or strand a possessive. Run it BEFORE the
# gate-clean check so corruption is caught at the point it is introduced.
PT="$(python3 scripts/tests/test-purge-mark-refs.py 2>&1)" || {
  echo "PURGE CORRUPTION TEST FAILED — a rewrite breaks prose:"
  echo "$PT" | grep -A2 FAIL | head -20
  echo
  echo "Fix: scripts/purge-mark-refs.py — a replacement must not consume words outside"
  echo "the matched phrase, and must not collapse a mid-sentence phrase to a bare role word."
  exit 1
}
echo "OK — purge rewrites do not corrupt prose"

echo
echo "==> Step 2c/3: children reconciler (relationships: is canonical)"
# tw-2026-09-12-008 / -052: convert-markdown.mjs reads `children:` and `relationships:`
# independently, so both are valid YAML, both render, and every other gate stays green
# while they drift. ~96 profiles (27% of the vault) had contradictory child data with
# nothing reporting it. This makes that impossible.
CR="$(python3 scripts/validate-children-reconcile.py 2>&1)" || {
  echo "CHILDREN RECONCILE FAILED — a child name contradicts relationships::"
  echo "$CR" | head -30
  echo
  echo "Fix: relationships: is canonical. Add the name there, or remove it from"
  echo "children:/the prose table. Do NOT add a name to the canonical field just to"
  echo "silence this check — that would invent a child."
  exit 1
}
echo "$CR" | head -4

echo
echo "==> Step 2d/3: resolve-refs.mjs --write (name refs -> slugs) [tw-2026-09-13-034]"
# convert-markdown.mjs imports the vault's relationship frontmatter as RAW NAME STRINGS
# ("Levi Leonard Timothy Telfer (2017-?)"), not slugs. resolve-refs.mjs is the step that
# converts those names back to slugs. It was referenced by NOTHING — not this script, not
# package.json, not .github/ — so every regen silently re-imported raw names and the profiles
# stopped being interlinked, with ALL FOUR validators still exiting 0 (validate-people does not
# assert shape; children-reconcile compares two fields that both carried the same raw names).
# That is the tw-2026-09-13-034 regression. This step closes it at the source.
#
# MUST run AFTER convert-markdown (which creates the name strings) and BEFORE sanitize-people
# (people.public.json, what the site renders, is sanitized from people.json) — and before the
# slug-shape guard below, so the guard verifies the RESOLVED data, not the raw import.
RR="$(node scripts/resolve-refs.mjs --write 2>&1)" || {
  echo "RESOLVE-REFS FAILED — slug resolution could not run:"
  echo "$RR" | tail -20
  exit 1
}
echo "$RR" | grep -E 'RESOLVED|Remaining unresolved|Wrote' | head -5

echo
echo "==> Step 3/3: verify gate-clean (validate-no-mark-refs.py)"
# tw-2026-09-13-023: the gate used to run ONLY on src/data/*.json -- the GENERATED
# output. The vault markdown, which is the actual publishing source and the thing a
# human edits, was never scanned by anything: not this script, not .pre-commit-config
# (files: ^src/data/.*\.json$), not the CI workflow (src/data/). So an author could
# write "Mark's grandfather" straight into a profile, and the first place it would be
# noticed was a human reading the live site.
#
# purge-mark-refs.py does not cover this either -- it rewrites "Mark's <role>" into a
# bare role word in the GENERATED data, which is a repair, not a detection. And a
# possessive naming the archivist is not always a family role ("Mark's line",
# "Mark's decision"), so a role-shaped purge cannot see all of them.
#
# CI cannot run this scan: the vault is deliberately outside the repo (local-only, no
# third-party upload). This local pipeline is the only place both exist, so this is
# where the source check belongs.
#
# Scope is deliberate: ONLY People/ is scanned, and it is a HARD FAIL (exit 1).
# Private working notes elsewhere in the vault legitimately use "Mark's" as shorthand,
# so they are not scanned. People/ contains the published profile pages -- the ones the
# site renders verbatim -- and those must read as a record, never as a first-person
# note. Verified fail-closed 2026-09-13: a planted "Mark's grandfather" in
# People/Malcolm Duncan Cameron.md stopped the pipeline at exit 1 with the file and
# line named, and never reached Step 4.
VAULT_ROOT="${TELFER_VAULT_ROOT:-$HOME/ObsidianVault/Family History}"
if [[ -d "$VAULT_ROOT" ]]; then
  VSRC="$(python3 scripts/validate-no-mark-refs.py "$VAULT_ROOT/People" 2>&1)" || {
    echo "SOURCE GATE FAILED — a published profile page under People/ contains a 'Mark's' reference:"
    echo "$VSRC" | head -20
    echo
    echo "Fix: rewrite the sentence so it names the person instead of the archivist"
    echo "(the vault is the archive; it must read as a record, not as a first-person note)."
    exit 1
  }
  echo "OK — vault People/ is clean of archivist references"
else
  echo "NOTE: vault not found at $VAULT_ROOT — source scan skipped (CI has no vault either)"
fi

VP="$(python3 scripts/validate-no-mark-refs.py src/data/people.json src/data/people.public.json 2>&1)" || {
  echo "GATE FAILED — regenerated data still contains 'Mark's' references:"
  echo "$VP" | head -20
  echo
  echo "Fix: review purge-mark-refs.py patterns or clean affected vault files."
  exit 1
}

COUNT="$(python3 -c "import json,sys;print(len(json.load(open('src/data/people.json'))))")"
echo "OK — $COUNT profiles, no 'Mark's' references, deploy gate passes."

echo
echo "==> Step 4/5: rebuild relationship graph + generations (stale-graph fix)"
node scripts/build-relationship-graph.mjs
node scripts/compute-generations.mjs

echo "==> Step 5/5: regenerate people.public.json (sanitize from people.json)"
# MUST run sanitize, else people.public.json (what the site renders) stays stale.
node scripts/sanitize-people.mjs

echo
echo "==> GATE: scan for cross-branch sibling contamination (same-name branch leaks)"
node scripts/scan-cross-branch.mjs || {
  echo
  echo "GATE FAILED — same-name branch contamination found in regenerated data."
  echo "Fix: correct the affected VAULT profile(s) (Siblings/Children fields must not"
  echo "collide with a same-named person in another branch), then re-run this script."
  exit 1
}
echo "OK — no cross-branch sibling contamination, deploy gate passes."

echo
echo "==> Step 6/6: record vault content hashes (src/data/vault-manifest.json)"
# Content-hash truth check. data-drift-monitor.py compares each vault .md against
# this manifest instead of mtimes, so a benign touch/sync/git-checkout no longer
# raises a false DRIFT, while a genuine un-regenerated vault edit still does.
# NON-OPTIONAL (tw-2026-09-14-008): this write must NOT be allowed to fail silently.
# A swallowed failure left vault-manifest.json holding STALE hashes, which the drift
# monitor then reported as a genuine DRIFT — a false positive with no underlying change.
# Fail the regen loudly instead; a regen that cannot record truth is not a regen.
if ! python3 "$HOME/.hermes/scripts/write-vault-manifest.py"; then
  echo "FAIL — vault-manifest.json could not be written." >&2
  echo "       Refusing to report success: the drift check would compare the vault" >&2
  echo "       against STALE hashes and raise a false DRIFT (tw-2026-09-14-008)." >&2
  exit 1
fi
echo "OK — vault manifest refreshed; content-hash drift check is authoritative."

echo
echo "==> Step 7/7: refresh Family-row snapshot for the CI dead-link guard"
# The dead-link guard (scripts/validate-family-cell-links.mjs) audits Family-table rows. CI has no
# Obsidian vault, so the rows are committed as scripts/family-rows.snapshot.json and CI audits
# those FOR REAL. Regenerating here keeps the snapshot from silently going stale; the guard also
# hard-fails if the snapshot drifts from the live vault. (Added 2026-09-12.)
if node scripts/make-family-rows-snapshot.mjs; then
  echo "OK — snapshot refreshed (commit scripts/family-rows.snapshot.json if it changed)."
else
  echo "WARNING — snapshot not refreshed; CI guard will use the previously committed rows."
fi

echo
echo "==> Step 7b/8: refresh vault-notes snapshot for the body-link guard"
# The body-link guard (scripts/check-body-links.mjs) resolves [[wikilinks]] against
# people.json, but a body link may deliberately point at a NON-PERSON vault note
# (e.g. [[Lawrie Family - Carslake Connection]] in History/). CI has no Obsidian vault,
# so the resolvable note titles are committed as scripts/vault-notes.snapshot.json and
# audited FOR REAL in CI — the same pattern as the family-rows snapshot above.
# (Added 2026-09-18 for tw-2026-09-18-006.)
if node scripts/make-vault-notes-snapshot.mjs; then
  echo "OK — vault-notes snapshot refreshed (commit scripts/vault-notes.snapshot.json if it changed)."
else
  echo "WARNING — snapshot not refreshed; body-link guard will resolve against the previously committed notes."
fi

echo
echo "==> Step 8/8: slug-shape guard (relationship refs must stay slugs) [tw-2026-09-13-034]"
# Fail the regen if the slug-shaped relationship count regressed below the committed baseline,
# or if any relationship entry is a bare display name. Before this guard existed, a regen that
# dropped back to raw vault names exited 0 through every gate in this script. We fail HERE, at
# the end of a real regen, rather than leaving the degradation for a later commit to discover.
if ! node scripts/validate-slug-shape.mjs; then
  echo ""
  echo "FAIL — regenerated data lost relationship slug resolution (tw-2026-09-13-034)."
  echo "       Do NOT hand-edit src/data/people.json. Investigate why resolve-refs.mjs"
  echo "       (Step 2d) did not restore the slugs, fix that, and re-run this pipeline."
  exit 1
fi

echo
echo "==> Step 9/9: LINK-INTEGRITY GATE CHAIN (fail-closed) [tw-2026-09-18-008]"
# WHY THIS EXISTS
# ---------------
# Every link guard in this repo lives in package.json's `postbuild` chain, which only runs
# on `npm run build`. The nightly job ('Genealogy Verification Pass', 21:30) runs THIS script
# and then `git commit && git push` -- it never builds. So a regen could be committed and
# DEPLOYED to telferwiki.com while check-body-links / the redirect guard / the slug-regression
# guard were all red, and nothing on the nightly path would ever say so.
#
# That is not hypothetical: it is exactly how three ghost URLs
#   /people/charles-farrow-jr-~1865/  /people/florence-nicholas-~1885/  /people/leslie-frank-dillon-~1892/
# were purged from the data, deployed, and then orphaned. The redirect emitter refused to emit
# a partial redirect set -- but only when a human ran a build. The nightly path was silent.
#
# So: run the guards HERE, where both the generated data and the vault exist, and fail the
# regen. A regen that cannot prove its links resolve is not a regen.
#
# ORDER MATTERS: emit-git-slug-redirects.mjs must run BEFORE the guards that check redirect
# coverage -- it is what WRITES the alias pages those guards then verify. --write-pages (not
# bare) is what actually emits dist/people/<old>/index.html; without it the guard sees nothing.
LINK_GATES=(
  "redirects:node scripts/generate-redirects.mjs"
  "git-slug-redirects:node scripts/emit-git-slug-redirects.mjs --write-pages"
  "redirect-health:node scripts/check-redirect-health.mjs"
  "live-slug-regression:node scripts/check-live-slug-regression.mjs"
  "people-links:node scripts/validate-people-links.mjs"
  "links:node scripts/validate-links.mjs"
  "relationship-links:node scripts/validate-relationship-links.mjs"
  "resolver-coverage:node scripts/validate-resolver-coverage.mjs"
  "family-cell-links:node scripts/validate-family-cell-links.mjs"
  "full-tree:node scripts/validate-full-tree.mjs"
  "body-links:node scripts/check-body-links.mjs"
)

GATE_FAILED=0
for entry in "${LINK_GATES[@]}"; do
  NAME="${entry%%:*}"
  CMD="${entry#*:}"
  OUT="$($CMD 2>&1)" || {
    echo ""
    echo "GATE FAILED — $NAME"
    echo "$OUT" | tail -25
    GATE_FAILED=1
  }
  if [[ "$GATE_FAILED" == "0" ]]; then
    echo "OK — $NAME"
  fi
done

if [[ "$GATE_FAILED" != "0" ]]; then
  echo ""
  echo "LINK-INTEGRITY GATE FAILED — refusing to report success (tw-2026-09-18-008)."
  echo "Do NOT commit or push this regen: the nightly job's push deploys straight to"
  echo "telferwiki.com, and a red link guard means the site would ship broken links."
  echo "Fix the underlying cause (usually: a vault profile rename that orphaned a live URL —"
  echo "add the old->new pair to the redirect source, do NOT hand-edit src/data/*.json),"
  echo "then re-run this script."
  exit 1
fi
echo "OK — link-integrity gate chain clean."

# ---------------------------------------------------------------------------
# Sitemap <lastmod> map (added 2026-09-21).
#
# WHY HERE: gen-lastmod.mjs reads the git last-commit date of each person's
# markdown file in the Obsidian vault and writes src/data/lastmod.json. It must
# run AFTER the people data is final (so slugs exist) and BEFORE the build, so
# the published sitemap carries real per-page freshness.
#
# WHY IT MUST EXIST AT ALL: dates cannot be resolved inside the Astro build —
# CI checks out only this repo, so the vault (a separate repo at an absolute
# local path) is absent there. Resolving dates here and committing the result
# is what makes local and CI builds agree. v2 tried it in astro.config.ts and
# the published sitemap carried ONE identical timestamp across all 981 URLs.
#
# NON-FATAL: a failure here leaves the previous lastmod.json in place, which is
# stale-but-valid. It never blocks the regen or corrupts the sitemap.
# ---------------------------------------------------------------------------
echo "==> gen-lastmod.mjs (sitemap per-page lastmod)"
if node scripts/gen-lastmod.mjs; then
  echo "OK — src/data/lastmod.json refreshed"
else
  echo "WARN — gen-lastmod.mjs failed; keeping the previous src/data/lastmod.json"
  echo "       (dates will be stale until this runs clean; site still builds)"
fi
