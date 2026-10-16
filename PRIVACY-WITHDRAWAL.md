# Privacy withdrawal — how it works, and what stops it silently coming back

**Status:** active. **Decided:** 2026-10-16 by Mark Telfer (owner).
**Applied to:** the living Ivory generation — Aaron, Joel, Jared, Lauren, Karina —
and their mother **Sheryle Joy Telfer**. **Not** Paul Ivory. Not Tim Telfer.

If you are reading this because something looks odd about those six names, read
the whole page before changing anything. Every safeguard here exists because a
particular failure was foreseen, and removing one re-opens the exact hole it was
built for.

---

## 1. What was actually done

Six living people were **unpublished from the website**. Not deleted. Not
retracted. The site simply stops publishing them.

- Their profile pages are gone (397 people published → 391).
- They are out of `sitemap.xml` and carry no index entry — Google will drop them.
- Their **old URLs still resolve**. A visitor following a stale link is handed
  over to a *living, named* page rather than a dead end. Those hop pages are
  marked `noindex`.
- Their **names remain on the site as plain text**: Paul's page still lists all
  four of his children; Tim's page still lists all four stepchildren; the full
  tree still shows all six; Sheryle is still named beside both of her husbands.
  **None of those names is a link.** They appear as ordinary words.
- The two photographs that were *only* of the withdrawn people were removed from
  the published tree (the family group shot, and Jared's). The vault copies are
  untouched.
- **Paul's page is deliberately exempt.** Everything on it stays exactly as it
  was — including his photo and including the note about his death. Owner's
  ruling: *"no Paul, everything stays on his page."* Do not "tidy" it later.

### Why plain text with no link is the correct shape

If the names had simply been deleted, Paul's page would read as a childless man
and Tim's page as having no stepchildren. That is a **lie about a family**, and
it is worse than a privacy problem. Publishing a name as unclickable text tells
the truth about the family and publishes nothing about the person.

### This is a website change, not a vault change

The vault record for every one of the six is intact and complete. This is a
publication decision, and publication decisions reverse.

---

## 2. THE THREE CHECK MARKS

Three independent gates must all pass before anything reaches telferwiki.com.
They are not variations of each other; each one catches a failure the other two
cannot see. **All three must be green. Two out of three is a failed deploy.**

| # | Gate | Command | What it catches |
|---|------|---------|-----------------|
| 1 | **Living-privacy** | `node scripts/check-living-privacy.mjs` | Personal detail about living people escaping into published output |
| 2 | **Slug regression** | `node scripts/check-live-slug-regression.mjs` | A URL that used to work now 404-ing, *and* the reverse — a withdrawn page quietly reappearing |
| 3 | **Redirect health** | `node scripts/check-redirect-health.mjs` | Any redirect pointing at a page that does not exist (a "signpost to nowhere") |

Gate 3 is the one that forced the design. The first attempt at this strip
generated old-URL aliases that pointed at the withdrawn people — who, by then,
had no pages. Redirect-health correctly refused the deploy. The fix was not to
weaken the gate. The fix was to make the aliases point at a page that is real.

**Gate 2 is deliberately two-sided.** It does not merely check that nothing
vanished. It also asserts that a withdrawn page is *really gone* — if one of the
six ever reappears as a live page, the build fails loudly. A privacy withdrawal
that silently un-withdraws itself is the exact disaster this gate exists for.

---

## 3. What stops automation putting it back

This is the part that matters most, because **the night-watch job rebuilds the
published data from the vault every night — and the vault still contains all
six.**

The safeguard is that the strip is not a one-time edit. It is a **list, and every
step of the pipeline re-reads that list from scratch, every single run.**

**`src/data/privacy-exclusions.mjs` is the single source of truth.** Only one
list. There is no second copy to drift out of sync, and no place where someone
can "fix" the strip without that fix propagating everywhere.

Who reads that list, and what they do with it:

- **`scripts/sanitize-people.mjs`** — runs on *every* regenerate and rebuilds
  the published list from the vault. Withdrawn people are skipped by name, so
  the vault re-supplying them cannot re-publish them. This is the anti-regression
  core.
- **`scripts/regenerate-data.sh`** — the nightly rebuild entry point. Runs
  sanitize as a mandatory step, so there is no path through the pipeline that
  bypasses the strip.
- **`scripts/generate-redirects.mjs`** — drops any old-URL alias that would point
  at a withdrawn page, at one single choke point every alias case funnels
  through. Nobody can add a new alias case that forgets the rule.
- **`scripts/validate-relationship-links.mjs`** — permits a withdrawn relative to
  be named on a page *without* being linked.
- **`scripts/check-live-slug-regression.mjs`** — knows the six, and fails the
  build if any of them comes back.
- **Page templates** (`[slug].astro`, `full-tree.astro`, `family-sheet.astro`,
  `descendants.astro`, `DetailPanel.astro`) — render a withdrawn relative as
  plain text instead of a link.

Set against that: **the vault is the input, and the input still has everyone in
it.** So the protection is not that the data was changed. The protection is that
**the publication filter runs last, and it is impossible to publish without
passing through it.**

**If you ever need to change the strip, edit `src/data/privacy-exclusions.mjs`
and nothing else.** Editing `people.public.json` directly will be overwritten on
the next rebuild — and that overwrite is correct behaviour, not a bug.

---

## 4. The three things you must add when someone new asks to come off

If this is ever extended to another person, the strip is incomplete until all
three exist. Missing any one of them produces a *silent* partial withdrawal:
the person looks removed but is still reachable.

1. **Add the slug to `src/data/privacy-exclusions.mjs`.** Without this, the next
   nightly rebuild publishes them again.
2. **Add a declaration to `src/data/removed-redirects.json`** naming the person
   and a *living* page to send their old link to. Without this, their old URL
   becomes a 404 and gate 3 refuses the deploy — or worse, ships a dead end.
3. **Remove any photo that is only of that person** from `public/images/people/`.
   Without this the page is gone but the photograph is still served to anyone
   with the direct URL. The page never gets checked again, because it no longer
   exists for a checker to walk.

Then rebuild, confirm all three check marks green, and push.

---

## 5. How to reverse it

Mark's promise to the family was that this is temporary. It has to be genuinely
reversible, so it is deliberately easy:

1. Delete the person's slug from `src/data/privacy-exclusions.mjs`.
2. Remove their declaration from `src/data/removed-redirects.json`.
3. Put the photograph back in `public/images/people/`.
4. Rebuild and push.

Their page regenerates from the vault — the record was never touched, so nothing
has to be reconstructed. Their name on relatives' pages becomes a link again
automatically.

**The record unlocks when the person dies.** That was the ruling: their privacy
is theirs while they are alive to object, and the family's historical record
resumes afterwards. Their vault record already carries the dates; the strip does
not need to know about death. It is lifted by hand, deliberately, at the time.

---

## 6. If something goes wrong

- **Someone reappears on the site** → check whether their slug leaked out of
  `privacy-exclusions.mjs`. Gate 2 should have stopped it; if it did not, that is
  a bug in the gate and it matters more than the leak.
- **An old URL starts 404-ing** → check `removed-redirects.json` still points it
  at a page that exists.
- **A photograph reappears** → check `public/images/people/`. A photo is not
  protected by a page being absent.
- **The build refuses to deploy** → do not disable a gate to get past it. The
  gates are why the last six months did not leak. Read the failure, fix the
  cause.

---

*Written 2026-10-16, the day the strip was applied and published. Kept in the
repo, not in a chat log, because a decision that only exists in a conversation
is a decision that will be re-litigated by someone who never saw it.*

**One rule for the Ivory branch and their mother. Not a general change to who is
private — a general change to how privacy is enforced.**
