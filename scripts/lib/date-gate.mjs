/**
 * date-gate.mjs — the year-consistency gate shared by the resolver and the guards.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `resolve-refs.mjs` matched display names to slugs by NAME and treated birth/death
 * years as a mere PREFERENCE. When the years did not match any candidate, it fell
 * through and bound a namesake anyway. On 2026-10-24 that produced three wrong-
 * generation links on the live site:
 *
 *   john-lawrie-1810 (b.1810) listed as father of alexander-lawrie-1776 (b.1776)
 *        — his own grandfather, attached as his CHILD
 *   john-lawrie-1810 listed as father of marion-lawrie (Marion Vida, b.1888)
 *        — his granddaughter
 *   john-lawrie-1810 listed as father of janet-lawrie (Janet Stevenson, b.1881)
 *        — his granddaughter
 *
 * A link that contradicts the dates is not a judgement call. It is wrong, and the
 * correct behaviour is to REFUSE it and leave the raw name visible as a research
 * gap — exactly the principle already adopted in resolve-refs.mjs on 2026-09-22
 * ("a missing link can be researched later; a fabricated one silently corrupts
 * the tree").
 *
 * This module is deliberately pure: no file I/O, no globals, no side effects, so
 * the resolver, the pre-commit guard and the tests can all call the SAME logic.
 * A duplicated rule drifts, and a drifted rule is how the 762 phantom link-guard
 * failures happened on the same day.
 */

/**
 * Bounds measured against this dataset, not guessed.
 *
 * YOUNGEST_PARENT_GAP = 11
 *   The youngest plausible parent-child birth gap. Below this, "parent" cannot
 *   be true. (Sets the lower bound on a parent's birth relative to a child.)
 *
 * MAX_CHILD_SPAN = 60
 *   MEASURED 2026-09-22 against the live tree: the LARGEST genuine father-child
 *   birth gap in the dataset is 51 years (adam-murray-1728 -> john-murray-1779);
 *   median 33, n=9 dated pairs. 60 sits safely above every real gap while
 *   rejecting the collision cases (67y, 95y, 108y).
 *
 * SIBLING_SPAN = 40
 *   Widest plausible spread of births between siblings.
 *
 * SPOUSE_SPAN = 50
 *   Widest plausible age gap between spouses in this data. Kept generous — a
 *   large age gap between spouses is unusual but real, whereas a parent born
 *   after their child is impossible.
 */
export const YOUNGEST_PARENT_GAP = 11;
export const MAX_CHILD_SPAN = 60;
export const SIBLING_SPAN = 40;
export const SPOUSE_SPAN = 50;

/** Relations whose dates can be judged. Anything else returns ok. */
const JUDGEABLE = new Set(["parent", "child", "sibling", "spouse"]);

/**
 * Can `candidate` (with birth/death years) stand in `relation` to `subject`?
 *
 * Returns { ok: true } or { ok: false, reason: "..." }.
 *
 * UNDATED IS ALWAYS ACCEPTABLE. A person with no birth year cannot be ruled out
 * by dates, and refusing an undated match would strand real relationships — the
 * very failure the generation PREFERENCE was introduced to avoid on 2026-09-22.
 * This gate only ever rejects a link the dates actively CONTRADICT.
 */
export function checkYears({ relation, subjectBirth, subjectDeath, candBirth, candDeath }) {
  if (!JUDGEABLE.has(relation)) return { ok: true };

  // No subject birth year: nothing to judge against.
  //
  // 2026-10-24 CORRECTION — this check alone is NOT enough, and its absence caused
  // a real data loss. The subject having a birth year does not make the pairing
  // judgeable: when the subject is a PARENT with no dates (janet-nichol, undated)
  // and the candidate is a CHILD with dates, the first version of this gate still
  // ran, rejected every candidate, and the child was dropped from a crown jewel.
  //
  // Rule adopted: A JUDGEMENT REQUIRES BOTH SIDES DATED. If either the subject or
  // the candidate lacks a birth year, the gate returns ok and the link stands.
  // Absence of evidence must never be treated as evidence of impossibility — that
  // is how a "safety" check silently becomes the data-loss event it was built to
  // prevent. The caller (resolve-refs.mjs) applies the same rule by only filtering
  // when a DATED candidate exists; this function must agree, or the two drift and
  // undo each other.
  if (subjectBirth == null) return { ok: true };

  const sb = Number(subjectBirth);
  if (!Number.isFinite(sb)) return { ok: true };

  const cb = candBirth == null ? null : Number(candBirth);
  const cd = candDeath == null ? null : Number(candDeath);

  // ── Parent ────────────────────────────────────────────────────────────────
  if (relation === "parent") {
    // Undated candidate cannot be ruled out.
    if (cb == null) return { ok: true };
    // A parent must be born before their child, with a plausible gap.
    if (cb >= sb) {
      return {
        ok: false,
        reason:
          `candidate born ${cb} but the child was born ${sb} — ` +
          `a parent cannot be born on or after their own child`,
      };
    }
    if (sb - cb < YOUNGEST_PARENT_GAP) {
      return {
        ok: false,
        reason:
          `candidate born ${cb} is only ${sb - cb}y older than the child (${sb}); ` +
          `minimum plausible parent-child gap is ${YOUNGEST_PARENT_GAP}y`,
      };
    }
    // A parent who died before the child was born is impossible.
    if (cd != null && cd < sb) {
      return {
        ok: false,
        reason: `candidate died ${cd}, before the child was born ${sb}`,
      };
    }
    return { ok: true };
  }

  // ── Child ─────────────────────────────────────────────────────────────────
  if (relation === "child") {
    if (cb == null) return { ok: true };
    // A child born before an UNDATED parent cannot be judged: the parent has no
    // birth year, so there is no lower bound to test against. Without this, a
    // dated child of an undated parent was rejected for every candidate, and
    // janet-nichol (undated) lost william-telfer-1802 from a crown jewel on
    // 2026-10-24. Both sides must be dated before a parent/child call is made.
    if (sb == null || !Number.isFinite(sb)) return { ok: true };
    if (cb <= sb) {
      return {
        ok: false,
        reason:
          `candidate born ${cb} but the subject was born ${sb} — ` +
          `a child cannot be born before or with their own parent ` +
          `(this is the 1776-as-child-of-1810 case)`,
      };
    }
    if (cb - sb > MAX_CHILD_SPAN) {
      return {
        ok: false,
        reason:
          `candidate born ${cb} is ${cb - sb}y younger than the subject (${sb}); ` +
          `the widest genuine parent-child gap in this dataset is 51y (limit ${MAX_CHILD_SPAN})`,
      };
    }
    // Subject died before the child was born — unless a posthumous birth, which
    // is real but rare enough to refuse rather than assume.
    const sd = subjectDeath == null ? null : Number(subjectDeath);
    if (sd != null && Number.isFinite(sd) && cb > sd) {
      return {
        ok: false,
        reason: `candidate born ${cb}, after the subject died ${sd}`,
      };
    }
    return { ok: true };
  }

  // ── Sibling ───────────────────────────────────────────────────────────────
  if (relation === "sibling") {
    if (cb == null) return { ok: true };
    if (Math.abs(cb - sb) > SIBLING_SPAN) {
      return {
        ok: false,
        reason:
          `candidate born ${cb} is ${Math.abs(cb - sb)}y from the subject (${sb}); ` +
          `widest plausible sibling spread is ${SIBLING_SPAN}y`,
      };
    }
    return { ok: true };
  }

  // ── Spouse ────────────────────────────────────────────────────────────────
  if (relation === "spouse") {
    if (cb == null) return { ok: true };
    if (Math.abs(cb - sb) > SPOUSE_SPAN) {
      return {
        ok: false,
        reason:
          `candidate born ${cb} is ${Math.abs(cb - sb)}y from the subject (${sb}); ` +
          `widest plausible spouse gap is ${SPOUSE_SPAN}y`,
      };
    }
    return { ok: true };
  }

  return { ok: true };
}

/**
 * Can every DATED candidate still stand in this relation?
 * Used by the resolver before it decides whether a ref is even resolvable: if dates
 * rule out the whole pool, the ref must stay raw rather than bind to a wrong person.
 */
export function anyYearsConsistent({ relation, subjectBirth, subjectDeath, candidates }) {
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  return candidates.some((c) =>
    checkYears({
      relation,
      subjectBirth,
      subjectDeath,
      candBirth: c.birth ?? c.birth_year ?? null,
      candDeath: c.death ?? c.death_year ?? null,
    }).ok
  );
}
