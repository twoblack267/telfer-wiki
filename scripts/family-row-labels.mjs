/**
 * SHARED: which body-table rows count as the "Family sheet".
 *
 * This lives in its own module because TWO things must agree on it exactly:
 *   - scripts/validate-family-cell-links.mjs  (audits the rows)
 *   - scripts/make-family-rows-snapshot.mjs   (captures the rows for CI)
 * When they disagreed, the snapshot contained `self` rows the guard never scanned, and CI
 * would have reported 40 phantom "dead link" offenders on its first honest run (2026-09-12).
 */
export const ROW_LABELS = new Set([
  "father", "mother", "parents", "spouse", "spouses", "husband", "wife",
  "children", "child", "siblings", "sibling", "brother", "sister", "brothers",
  "sisters", "son", "daughter", "sons", "daughters",
  "stepson", "stepdaughter", "stepfather", "stepmother", "stepchildren",
  "grandson", "granddaughter", "grandfather", "grandmother", "grandchildren",
  "nephew", "niece", "uncle", "aunt", "cousin", "partner", "de facto",
]);
