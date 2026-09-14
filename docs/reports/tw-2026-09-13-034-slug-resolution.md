# RECORD-EVERYTHING — tw-2026-09-13-034: relationship slug resolution

**Date:** 2026-09-14
**Repo:** /Users/marktelfer/telfer-wiki
**Commit:** `ec8228d` — *fix(data): wire resolve-refs into regen + add slug-shape guard (tw-2026-09-13-034)*
**Verdict:** The card's **115 → 25** regression figure **was never a committed state and is not
reproducible from git**. The *mechanism* the card describes is REAL and still latent in the
pipeline; it has now been closed at the source and guarded.

---

## 1. VERDICT — was 115 → 25 real?

**No.** Measured, not inferred.

### 1.1 Every commit that ever touched people.json was scanned (312 commits)

Definition used: a relationship entry (`children` / `parents` / `spouses`) is "slug-shaped" if it
matches `^[a-z0-9][a-z0-9~.-]*$`. This deliberately includes the two legitimate tilde slugs
(`charles-farrow-jr-~1865`, `florence-nicholas-~1885`).

Lowest counts ever committed:

| slug entries | profiles with ≥1 slug | commit | date | context |
|---|---|---|---|---|
| 437 | 0 | `5edb8ed` | 2026-06-02 | Initial commit, 81 profiles |
| 330 | 21 | `1b1f066` | 2026-06-16 | 86 profiles |
| 356 | 182 | `aa575d4` | — | — |
| 358 | 184 | `30d5f4f` | — | — |
| 988 | 324 | `36d8c7a`,`b87e9e5`,`cbd7d85` | 2026-09 | the three commits named in the card |

- **No commit ever contained 115 slug-shaped profiles.**
- **No commit ever contained 25 slug-shaped profiles.**
- The only low numbers are from **June 2026**, when the tree held 81–86 people total. Those are
  smaller-dataset artifacts, not regressions — the count climbs monotonically as the vault grew.

The `25` figure in the card corresponds to nothing in git history at any point.

### 1.2 Kylie specifically — identical across all three candidate commits

```
36d8c7a  people=360 slug_entries=988 profiles_with_slug=324
         kylie-telfer-1982 children: ['levi-telfer-2017','zabella-telfer-2019']
b87e9e5  people=360 slug_entries=988 profiles_with_slug=324
         kylie-telfer-1982 children: ['levi-telfer-2017','zabella-telfer-2019']
cbd7d85  people=360 slug_entries=988 profiles_with_slug=324
         kylie-telfer-1982 children: ['levi-telfer-2017','zabella-telfer-2019']
```

The card alleged NOW = `['Levi Leonard Timothy Telfer (2017-?)', 'Zabella Violet Zelda Telfer
(2019-?)', 'Levi Leonard Timothy Telfer', 'Zabella Violet Zelda Telfer']`. Omitting the SHA
allegedly containing that state, an exhaustive object-database search was run:

```
git cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname)' \
  | awk '$1=="blob"{print $2}'  # then grep each blob for
  'Levi Leonard Timothy Telfer (2017-?)'
→ FOUND in blob <none>
```

**No blob in the entire object database — reachable or unreachable — ever contained the degraded
form.** The degradation was never committed. The card's "HEAD" count was therefore either measured
against a filtered subset or against an uncommitted working tree mid-regen, and was recorded as if
it were a committed baseline.

### 1.3 The mechanism is real — reproduced live

Running the pipeline's first step alone reproduces the described symptom exactly:

```
$ node scripts/convert-markdown.mjs
before:  people=360 slug_shaped_total=988   (children=423 parents=417 spouses=143)
after:   people=360 slug_shaped_total=1315  (children=81  parents=132 spouses=30)
         non_slug_entries=1072
```

`convert-markdown.mjs` imports the vault's `relationships:` frontmatter verbatim, so
`children`/`parents`/`spouses` become **raw display names**. That is precisely the hazard the card
describes — it just lived in the working tree between step 1 and the (previously absent) resolve
step, never in a commit.

### 1.4 Why four validators all stayed green on degraded data

This is the finding that matters most:

| validator | why it did not catch raw names |
|---|---|
| `validate-people.mjs` | does not assert reference *shape* |
| `validate-children-reconcile.py` | compares `relationships:` against `children` — **both carried the same raw names**, so they agreed with each other |
| `scan-cross-branch.mjs` | only hunts sibling/parent collisions |
| `validate-no-mark-refs.py` | only greps for archivist references |

A fully slug-degraded tree passed **all four**. That is the silent-failure surface.

---

## 2. WHAT WAS WIRED IN

`grep -rn resolve-refs scripts/ package.json .github/` before the change returned only
`scripts/resolve-refs.mjs` itself. **Zero callers.** The only step that converts imported names back
to slugs was never invoked by any pipeline.

### 2.1 `scripts/regenerate-data.sh` — new Step 2d

Placed **after** `convert-markdown.mjs` + `purge-mark-refs.py` + `children-reconcile.py`, and
**before** the `sanitize-people` step (so both `people.json` and `people.public.json` carry slugs)
and before the new guard (so the guard verifies resolved data).

```diff
+echo
+echo "==> Step 2d/3: resolve-refs.mjs --write (name refs -> slugs) [tw-2026-09-13-034]"
+# convert-markdown.mjs imports the vault's relationship frontmatter as RAW NAME STRINGS ...
+# resolve-refs.mjs is the step that converts those names back to slugs. It was referenced by
+# NOTHING ... so every regen silently re-imported raw names ...
+RR="$(node scripts/resolve-refs.mjs --write 2>&1)" || {
+  echo "RESOLVE-REFS FAILED — slug resolution could not run:"
+  echo "$RR" | tail -20
+  exit 1
+}
+echo "$RR" | grep -E 'RESOLVED|Remaining unresolved|Wrote' | head -5
```

### 2.2 `scripts/regenerate-data.sh` — new Step 8 (end-of-regen gate)

```diff
+if ! node scripts/validate-slug-shape.mjs; then
+  echo ""
+  echo "FAIL — regenerated data lost relationship slug resolution (tw-2026-09-13-034)."
+  echo "       Do NOT hand-edit src/data/people.json. Investigate why resolve-refs.mjs"
+  echo "       (Step 2d) did not restore the slugs, fix that, and re-run this pipeline."
+  exit 1
+fi
```

### 2.3 `scripts/resolve-refs.mjs` — real bug the wiring exposed

Wiring resolve-refs in immediately **failed** `scan-cross-branch.mjs` with 4 sibling/parent
contradictions on the Masters branch:

```
GATE FAILED — same-name branch contamination found in regenerated data.
• emma-masters-1855 lists martha-masters-1839 as SIBLING but ALSO as PARENT — parent-as-sibling leak
• martha-masters-1839 lists emma-masters-1855 as SIBLING but ALSO as CHILD — child-as-sibling leak
• martha-masters-1839 lists joseph-masters-1853 as SIBLING but ALSO as CHILD — child-as-sibling leak
• martha-masters-1839 lists mary-masters-1852 as SIBLING but ALSO as CHILD — child-as-sibling leak
```

**Root cause (measured):** Emma's vault says `Mother: Martha Williams Masters (1814–1896)`. The
mother's profile records `first_name: Martha, middle_name: null, last_name: Masters`
(`display_name: "Martha Masters"`). So the reference string missed both the `byName`
(`"martha williams masters"`) and `byFullName` indexes. The lifespan was then discarded and a
**same-named sibling earlier in people.json won on insertion order**:

```
byName["martha masters"] = [
  {slug:"martha-masters-1839", birth:1839},   ← chosen (file order)
  {slug:"martha-masters-1814", birth:1814}    ← correct (ref says 1814)
]
```

Note this also put a **bogus parent edge** on `emma-masters-1855` (her own sister listed as her
parent) and a bogus child edge on `martha-masters-1839`.

Three fixes applied — all in `resolveRef`:

1. **Step 2 fallback (primary fix):** if the full-name lookup yields nothing and the ref has >2
   words, retry on first+last *with the extracted birth year still in hand*, so the existing
   exact-birth pick at line 203 can fire.
2. **Step 6 (`byFullName` / `byName` fallbacks):** honour `years.birth` before `pickBestMatch`.
3. **Step 8 (first+last fallback):** same lifespan preference before order-based picking.

The fixes are additive preference checks; when there is no same-name ambiguity, the candidate set
has one element and behaviour is unchanged.

### 2.4 Result

```
$ bash scripts/regenerate-data.sh
==> Step 2d/3: resolve-refs.mjs --write ...
=== RESOLVED: 916 / 558 ===
📊 Remaining unresolved: 154
...
==> GATE: scan for cross-branch sibling contamination
Scanned 360 people. FLAGGED (sibling overlapping parent/child): 0
✅ No cross-branch sibling contamination found.
...
==> Step 8/8: slug-shape guard
  slug-shaped entries            : 1146
  profiles with ≥1 slug-shaped   : 339
PIPELINE_EXIT=0
```

**Idempotent** (critical — the wiring causes no per-run churn):

```
$ md5 -q src/data/people.json
f189688317c125bab5a55daf8aae6364
$ bash scripts/regenerate-data.sh   # exit 0
$ md5 -q src/data/people.json
f189688317c125bab5a55daf8aae6364
```

Before/after on the same tree:

| | slug entries | profiles with ≥1 slug |
|---|---|---|
| HEAD (`cbd7d85`) | 988 | 324 |
| after Step 2d resolve-fix, committed (`ec8228d`) | **1146** | **339** |

The count went **up**, because resolve-refs now correctly resolves mother refs it previously
mis-resolved to siblings. This is a correctness improvement, not inflation.

---

## 3. THE GUARD — `scripts/validate-slug-shape.mjs`

**Name:** `scripts/validate-slug-shape.mjs` (+ committed baseline `scripts/slug-shape.baseline.json`)

**Fail conditions (three):**
1. `slug_shaped` count **drops below** the committed baseline.
2. Any relationship entry is a **bare display name**, when a slug exists that resolves to it.
3. **Bare display name duplicating a qualified sibling** — the exact card signature (a raw name
   sitting beside the `Name (YEAR–YEAR)` form of the same person).

**Wired in three places:**
- `scripts/regenerate-data.sh` Step 8 — fails a real regen (`exit 1`).
- `package.json` → `prebuild` → so **`npm run build` runs it**:
  `"prebuild": "node scripts/validate-slug-shape.mjs && node scripts/validate-vault-site-parity.mjs --strict"`
- `.pre-commit-config.yaml` → local hook `validate-slug-shape`, `files: ^src/data/people\.json$`

### Mutation proof A — deliberately degraded COPY (off-tree)

Kylie's `children` set to the literal card value, in a sandbox copy:

```
── RELATIONSHIP SLUG-SHAPE (tw-2026-09-13-034) ────
  relationship entries (total)   : 1148
  slug-shaped entries            : 1144
  bare display names             : 2
❌ SLUG-SHAPE GUARD FAILED:
   BARE DUPLICATE: kylie-telfer-1982 → children has bare "Levi Leonard Timothy Telfer" alongside
     qualified ["Levi Leonard Timothy Telfer (2017-?)"] — same person written twice, one unresolved.
   BARE DUPLICATE: kylie-telfer-1982 → children has bare "Zabella Violet Zelda Telfer" alongside
     qualified ["Zabella Violet Zelda Telfer (2019-?)"] — same person written twice, one unresolved.
   BARE DISPLAY NAMES IN RELATIONSHIP FIELDS: 2 entries is a raw name where a slug resolves.
     • kylie-telfer-1982 → children: "Levi Leonard Timothy Telfer" could be slug "levi-telfer-2017"
     • kylie-telfer-1982 → children: "Zabella Violet Zelda Telfer" could be slug "zabella-telfer-2019"
GUARD_EXIT=1
```

### Mutation proof B — degraded REAL tree, then `npm run prebuild`

The strongest proof: it blocks the actual build, not just a sandbox.

```
$ (degrade kylie children in src/data/people.json)
$ npm run prebuild
PREBUILD_EXIT=1
❌ SLUG-SHAPE GUARD FAILED: ... BARE DUPLICATE: kylie-telfer-1982 ...
$ cp /tmp/people_pristine.json src/data/people.json
$ node scripts/validate-slug-shape.mjs
post-restore GUARD_EXIT=0
```

### Passing output on the real tree

```
── RELATIONSHIP SLUG-SHAPE (tw-2026-09-13-034) ────
  profiles                       : 360
  relationship entries (total)   : 1146
  slug-shaped entries            : 1146
  profiles with ≥1 slug-shaped   : 339
  bare display names             : 0
  baseline                       : 1146 (2026-09-14T03:36:18.499Z)

✅ SLUG-SHAPE CLEAN — relationship refs are slugs, above baseline.
EXIT=0
```

A guard that has never been seen to fail is not a guard. This one has been seen to fail twice, on
the exact card signature, and to pass on the restored tree.

---

## 4. FULL ACCEPTANCE CHAIN (committed tree `ec8228d`)

| command | exit |
|---|---|
| `node validate-people.mjs` | **0** |
| `node scripts/scan-cross-branch.mjs` | **0** |
| `python3 scripts/validate-no-mark-refs.py src/data/people.json src/data/people.public.json` | **0** |
| `python3 scripts/validate-children-reconcile.py` | **0** |
| `node scripts/validate-slug-shape.mjs` | **0** |
| `npm run build` | **0** |

Build detail — the guard genuinely ran inside `prebuild`, and the build completed through the e2e
search tests:

```
> node scripts/validate-slug-shape.mjs && node scripts/validate-vault-site-parity.mjs --strict
── RELATIONSHIP SLUG-SHAPE (tw-2026-09-13-034) ────
✅ SLUG-SHAPE CLEAN — relationship refs are slugs, above baseline.
...
🎉 Search render e2e: ALL PASS — Mark Telfers surface first for 'mark'
```

Selected validator bodies:

```
=== node validate-people.mjs ===
Critical issues (fail build): 0
Invalid refs (warnings, handled by redirects): 0
✅ Data is clean for build!

=== python3 scripts/validate-children-reconcile.py ===
  profiles scanned : 373
  CONTRADICTIONS   : 0
  mirror gaps      : 47  (informational)
OK — 373 profiles, no child name contradicts relationships:

=== python3 scripts/validate-no-mark-refs.py ... ===
✓ No forbidden patterns found
```

---

## 5. HONEST GAPS

- **The card's 115 and 25 figures are unexplained.** I proved no commit and no blob ever held them.
  I could not determine what produced those numbers — most likely a filtered/partial query against
  a mid-regen working tree. I did not find a source document for them.
- **`1b1f066` (330/21) and `5edb8ed` (437/0) are not regressions** — the tree held only 81–86
  people then. Inferred from the accompanying profile counts, not from a branch-specific check.
- **154 refs remain unresolved** after `resolve-refs` (916/558 resolved). This is **pre-existing**
  and unchanged by my work; most are genuinely absent/malformed vault refs. I did not attempt to
  reduce this number. The guard does not assert zero-unresolved — only that resolution does not
  *regress*, because pinning to 0 today would be a false gate.
- **Baseline was refreshed once mid-task** (988 → 1146) because the resolve-refs fix legitimately
  increased correct resolutions. Both values and the `previous` block are recorded in
  `scripts/slug-shape.baseline.json`. A future *drop* is the defect signal; a future *rise* is
  expected as the vault grows. The `--write-baseline` path is manual and prints a diff for review.
- **`mirror gaps: 47`** in `validate-children-reconcile.py` is reported as informational by that
  script itself; I left it alone and did not investigate whether those 47 are vault data gaps.
- **The `.pre-commit-config.yaml` hook was not exercised end-to-end** (no commit was made through
  a pre-commit run in this session), though its `entry` command is the same binary proven to fail
  correctly above. The `npm run build` path *was* exercised end-to-end.
- **Not pushed to remote**, per instruction. Commit is local on `main` at `ec8228d`.
- **No vault file was modified.** The Masters parent/sibling inconsistency is a genuine vault data
  ambiguity (the mother's profile omits her middle name "Williams"); I fixed the *resolver* to
  honour the birth year the reference already carried rather than editing vault markdown. The
  vault would still be improved by recording `middle_name: Williams` on
  `Martha Williams Masters (1814–1896).md` — flagged, not changed.
