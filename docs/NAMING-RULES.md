# Naming and Linking Rules — the law of person records

**Read this before you add, rename, merge or link a person — human or agent.**

These rules exist because a family-history site is judged by whether a name on a page
belongs to the right human being. Every rule below was paid for with a real error that
reached the data. They are not style preferences. Violating one publishes a false fact
about a dead person, which is the only kind of bug this project treats as unforgivable.

Last updated: 2026-10-29.

---

## 1. Where truth lives

| Layer | File(s) | Rule |
|---|---|---|
| **Truth** | `~/ObsidianVault/Family History/People/*.md` | The vault. Only place facts are authored. |
| **Derived** | `src/data/*.json` | Rebuilt from the vault. **Never hand-edit.** |
| **Rendered** | `dist/` | Built from derived. Never hand-edit. |

If a page is wrong, the vault is wrong or the generator is wrong. Fix one of those two.
Editing JSON to make a page look right is how the vault and the site drift apart and how
a fix silently reverts on the next nightly run.

---

## 2. A name is not an identity

**THE CARDINAL RULE.** Two people can share a name. Two people can share a name *and*
a birth year. Therefore:

> Never bind a relative on name alone. Not when the name is unusual. Not when there is
> only one candidate. **Especially not when there is only one candidate.**

The single-candidate early return was the bug that bound Thomas Telfer (baptising children
at Castleton, Roxburghshire, 1774–75) to a woman born in **England in 1806**. There was
exactly one "Elisabeth Telfer" in the vault, so the resolver took her. Rarity is not proof.

### What counts as evidence of identity
1. **Life dates that agree** — birth/death, within tolerance (§4).
2. **Baptism dates** — `bap.`, `bapt.`, `baptised`, `baptized`, optional `~`/`c.`.
   A baptism is within weeks of birth, so it is birth evidence. **Parse it.**
   Missing this made every baptismal reference carry *no year at all*, blinding every
   date gate beneath it.
3. **Explicit parent/spouse naming in frontmatter** with dates, e.g.
   `Father: Francis Charles Telfer (1875–1954)`.
4. **A stated place or role** consistent with the family group.

Name similarity, alphabetical proximity, and "it's the only one" are **not evidence**.

---

## 3. Namesakes that share a birth year

Francis Adam Telfer and Francis Charles Telfer were **both born 1875**. A name match plus
a year match still did not identify them. Ruth Telfer's page bound to the wrong one.

The only thing that worked was an **exact dated reference** in her frontmatter:
`Father: Francis Charles Telfer (1875–1954)`.

**Rule:** when two people share a name and a birth year, the reference must carry a
distinguishing qualifier — the full middle name *and* dates. Never rely on order,
file order, or recency.

---

## 4. Tolerance and sanity limits

| Check | Limit | Why |
|---|---|---|
| Parent/child birth gap | refuse if the **ref's own year** differs by **> 2 years** from the candidate | A ref saying `bap. 1774` is not the 1806 woman, whatever her name. |
| Parent/child age gap | flag only above **62 years** | Late fatherhood is real. The vault itself asserts two sourced 56-year gaps (Marian Cornish → John Telfer 1840–1913; Ruth → Francis Charles). A guard that overrules the sources is worse than no guard. |
| Spouses / siblings | **no generation check** | They are peers. Applying the check destroyed 7 correct links, including Edwin Telfer b.1919 and his wife Lola b.1918. |

The ref-year check applies to **parent and child only**. It does not apply to spouses.

---

## 5. The honesty markers — honoured at EVERY layer

A researcher may record that a relative exists but has no profile. Write one of:

- `no profile`
- `do not link`
- `not the same person`

Example, taken from the vault:

> **Children:** Elisabeth Telfer (bap. 10 Feb, year recorded 1774 in the index / 1776 on
> the register page) — **no profile in this vault, do not link to any other Elisabeth Telfer**

This is a **research assertion**, not a placeholder. It must be honoured in all five
layers or it does nothing:

1. `scripts/resolve-refs.mjs` — marker checked **before** any candidate fallback
2. `scripts/build-relationship-graph.mjs` — the real child-list binder
3. `scripts/validate-slug-shape.mjs` — a marked ref may stay a bare name
4. `scripts/validate-relationship-links.mjs` — a marked ref is a *research gap*, not a broken link
5. `src/utils/format-body.mjs` — renders as plain text, never a link

> **This marker was inert once.** It was written into the vault, the vault said "do not
> link", and the site linked anyway. A marker that only one layer reads is not a rule,
> it is a comment. When you add a marker, grep all five files and prove the regex fires.

---

## 6. What to do when two people collide

In order of preference:

1. **Disambiguate with life dates** in the referring field.
2. **Add the middle name** if the vault knows it.
3. **Leave it as plain text** with a `no profile` marker.
4. **Never** delete the relative's name to make a count look clean.
5. **Never** invent a profile to fill a gap.
6. **Never** assume the duplicate is safe to delete — check which one carries the life
   record.

### Choosing the canonical record
When one person genuinely has two vault notes, exactly **one** must carry the `redirect`
tag in its frontmatter. The tag is authoritative; the title is only a legacy fallback.
A body line saying `**Canonical profile:** [[...]]` is **documentation for humans — no
script reads it.** Marking a stub in the body alone leaves BOTH notes generating live
pages, and the site publishes the same person twice.

> Worked example: Carissa Telfer had two notes. One held her life record, photo and
> funeral details; the other was derived from a printed book page that predated her
> death. The body said "one person, two records" and named the canonical page. No script
> read it, so both shipped. The fix is the `redirect` tag on the print-derived note.

---

## 7. Frontmatter mechanics that have broken the build

- **A closing `---` is mandatory.** A patch that drops it turns `deceased`, `tags`,
  `title` and `relationships` into body prose. `js-yaml` then throws
  `unidentified alias "*Role:**"` when a body line begins with `*`.
- **All `#` conversion notes go ABOVE `deceased:` / `relationships:`**, never after the
  closing delimiter.
- **Do not line-wrap a `relationships:` value mid-string.** It parsed in one file and
  became ambiguous in the other. Keep one line, or use a YAML block scalar.
- **`title` is a display string, not a key.** The slug comes from name + year fields.

---

## 8. Test the regex before you trust it

Written into JS source, `\\s` matches a **literal backslash followed by "s"**, not
whitespace. This bug shipped three times in one night and each time the "fix" silently
did nothing. Prove every pattern against real strings:

```js
const re = /no[-\s]profile|do not link|not the same person/i;
console.log(re.test("Elisabeth Telfer (bap. 1774, no profile)")); // want true
console.log(re.test("Elisabeth Telfer (bap. 1774)"));             // want false
```

A pattern that never matches looks exactly like a pattern that works, until data proves
otherwise. Test both directions: one positive, one near-miss negative.

---

## 9. The gates that enforce all of this

| Gate | What it catches |
|---|---|
| `scripts/verify-relationships.mjs` | isolation regression, self-references, dangling edges, dead/wrong redirects, privacy leak, impossible age gaps |
| `scripts/validate-relationship-links.mjs` | relationships rendered as plain text that should link |
| `scripts/validate-slug-shape.mjs` | malformed slugs, unmarked bare names |
| `guard-crown-jewels.mjs` | a profile or relationship count shrinking without a declared reason |

`verify-relationships.mjs` runs as **Step 4b/5** of `regenerate-data.sh` — after the graph
is rebuilt, before the public data is generated. Placing it earlier produced a false
"36 isolated" alarm because it measured a half-built graph.

A shrinking count is not automatically a bug. If it is a **correction** — a wrong link
removed — declare it in `DECLARED_SHRINKS` with the reason, so the record shows the
shrink was intended. Never silence the guard; teach it.

---

## 10. How to add a person — the checklist

1. Name the file `<First> <Middle> <Last> (<dates>).md` in `Family History/People/`.
2. Frontmatter: `first_name`, `last_name`, `middle_name` (if known), `birth_year` /
   `birth_date`, `death_year` if deceased, `tags`, `title`.
3. `relationships:` on **one line**: `Father: [[X]] | Mother: [[Y]] | Spouses: ...`
4. **Add dates to every relative you name** if any namesake exists. Assume one does.
5. If a relative has no profile, append `(no profile)` to their name in the body.
6. Close the frontmatter with `---`. Count the delimiters: there must be two.
7. Run `bash scripts/regenerate-data.sh`. It must exit 0.
8. Run `npm run build`. It must exit 0.
9. Look at the built page. Confirm the person is linked both ways, and that no namesake
   swallowed them.

---

## 11. The one-line version

> **A relative with no profile is normal and must be left as a plain name. A relative
> linked to the wrong person is a lie published about a dead human being. When in doubt,
> leave the name unlinked — and say so in the vault so the next reader knows it was a
> decision, not an oversight.**

*Trust the Awesomeness.*
