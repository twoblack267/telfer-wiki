# Tagging convention — existing coverage vs. what's missing

Purpose: keep every profile findable by the tags the vault already uses. Do NOT
invent new tag vocabulary; extend what exists.

## Already in use in the vault (observed, do not rename)
- `family`
- `non-telfer` — anyone not born a Telfer (married-in spouses, Colls/Ord/etc.)
- `telfer` (implied by absence of `non-telfer`; confirm before relying on it)
- `deceased` (frontmatter flag, present on most profiles)
- `generation` (frontmatter/derived — used by compute-generations.mjs)

## Gaps found 2026-09-12 while fixing the drift monitor
1. **No branch tag.** Profiles carry no `branch` tag, so a Telfer from the
   Foveran line and one from the Broadlee line are indistinguishable by tag.
   people.json has `generation` but no branch discriminator.
2. **No confidence/provenance tag.** There is no way to filter "primary-source
   verified" vs "unverified lead" from tags alone. The vault encodes this in
   prose + `## Sources`, not machine-readable tags.
3. **`Thomas Telfer` (of Broadlee) landed with `generation: 99`** — the sentinel
   for "unplaced in the tree". Correct for now; needs an explicit
   `unplaced`/`generation_unknown` marker so it is not mistaken for a real gen.
4. **Two same-name Thomas Telfers of different branches**
   (`Thomas Telfer (of Broadlee).md` and the Broadlee-family Thomas) are a
   future contamination risk — `same-name-branch-contamination` skill applies.
   Slugs are unique today (`thomas-telfer`), but if a second Thomas Telfer is
   added with the same birth-less state the slug collides.

## Proposed (needs Mark's approval — do not apply unattended)
- `branch/foveran`, `branch/broadlee`, `branch/other` — Obsidian nested tags.
- `status/unplaced` for `generation: 99` rows.
- `source/book` for facts traceable to the three gold books
  (Brief Account 1986, Borders & Bush 1989, Supplement 2008),
  `source/primary` for registry/AWM/etc., `source/unverified` for leads.

## Migration order if approved
1. Add `status/unplaced` (mechanical, 1 row today, zero risk).
2. Add `branch/*` — requires a per-person branch decision; do in batches of ~25
   with a fresh-eyes pass, never a bulk find/replace.
3. `source/*` — only for rows that already name sources in `## Sources`;
   do NOT infer provenance from absence.

## Hard rules
- Vault is source of truth; tags are added to vault `.md`, then regenerate.
  Never hand-edit `src/data/*.json`.
- After any vault edit run: `cd ~/telfer-wiki && bash scripts/regenerate-data.sh`
  (this also refreshes `src/data/vault-manifest.json`, which the drift monitor
  uses for its content-hash truth check).
