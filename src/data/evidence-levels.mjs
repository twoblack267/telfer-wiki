/**
 * evidence-levels.mjs — THE legal evidence rating vocabulary, defined ONCE.
 *
 * Mark, 2026-11-22 card tk-vault-evidence-level-gap: "define the legal enum in
 * ONE place and document it". The wiki rules (How We Work, section
 * EVIDENCE LEVELS) define three levels; the site additionally renders two
 * historical statuses it must not lose. Anything else in a page's
 * `evidence_level` is DRIFT — a value no filter matches, so the page silently
 * shows no banner at all. That silence is the lie this file exists to stop.
 *
 * SOURCE OF TRUTH: the vault, not this file.
 *   ~/ObsidianVault/Family History/How We Work (Telfer Wiki Rules).md
 * If the rules change, THIS FILE changes with them.
 */

/** The three levels the wiki rules define. A page should carry one of these, or `single_source: true`. */
export const RULE_LEVELS = [
  {
    value: "verified",
    tier: "verified",
    promise: "Two independent source groups agree, or one source of a class that stands alone (a civil certificate). The page may state the fact plainly.",
    provisional: false,
  },
  {
    value: "soft-yes-provisional",
    tier: "provisional",
    promise: "Certainly right on the evidence in hand, receipt attached, not yet hardened against an independent record. One source shy, and says so.",
    provisional: true,
    requires: ["provisional_on", "provisional_why", "provisional_receipt"],
  },
  {
    value: "lead-book3-direct-line",
    tier: "single",
    promise: "On the direct line, a book-3 (Supplement 2008) fact is demoted to a LEAD. Marked, not discarded.",
    provisional: false,
  },
];

/**
 * Historical statuses already printed on the site and in the vault.
 * Retained so no live page loses its banner. NOT encouraged for new pages.
 */
export const LEGACY_LEVELS = [
  {
    value: "single_source",
    tier: "single",
    promise: "Legacy spelling: one witness only. The correct modern form is the boolean `single_source: true`, but the site honours this value too.",
    legacy: true,
  },
  {
    value: "unverified",
    tier: "provisional",
    promise: "Legacy: the profile itself carries no citation. A lead, not a finding.",
    legacy: true,
  },
  {
    value: "chapter-placed",
    tier: "placed",
    promise: "Legacy: position in the family established from a book chapter rather than a vital record.",
    legacy: true,
  },
];

export const ALL_LEVELS = [...RULE_LEVELS, ...LEGACY_LEVELS];

/** Fast lookup. Unknown value => undefined => DRIFT. */
export const LEVEL_MAP = new Map(ALL_LEVELS.map((l) => [l.value, l]));

export const LEGAL_VALUES = ALL_LEVELS.map((l) => l.value);

export function isLegalLevel(value) {
  return typeof value === "string" && LEVEL_MAP.has(value.trim());
}

/**
 * Classify a page's rating.
 * Returns { state, level, value } where state is one of:
 *   "verified" | "provisional" | "single" | "placed" | "blank" | "drift"
 */
export function classifyEvidence(frontmatter, rawLevel) {
  const value = (rawLevel || "").trim();
  const singleSource = frontmatter?.single_source === true;

  if (!value && !singleSource) return { state: "blank", level: null, value: "" };
  if (singleSource && !value) return { state: "single", level: LEVEL_MAP.get("single_source"), value: "" };
  if (!value) return { state: "blank", level: null, value: "" };

  const level = LEVEL_MAP.get(value);
  if (!level) return { state: "drift", level: null, value };
  return { state: level.tier, level, value };
}
