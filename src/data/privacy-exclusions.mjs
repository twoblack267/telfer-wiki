/**
 * Privacy exclusions — person slugs that are NOT published on the site.
 *
 * TWO CONSUMERS, ONE SOURCE OF TRUTH:
 *   1. scripts/sanitize-people.mjs — a slug on PRIVACY_STRIP_SLUGS is omitted
 *      from the generated people.public.json entirely, and every relationship
 *      array that referenced them keeps the person's NAME as plain text.
 *   2. src/data/privacy-exclusions.mjs (this file) NOINDEX_SLUGS — kept as the
 *      explicit noindex/sitemap-fence list consumed by the page template
 *      (robots noindex meta) and astro.config.ts (sitemap filter).
 *
 * OWNER RULING — IVORY BRANCH (Mark, 16 Oct 2026):
 *   At Aaron Ivory's request (relayed by Mark), the living Ivory youngest
 *   generation and their mother are withdrawn from publication. Scope is ONE
 *   family, not a general rule change.
 *     - Living youngest generation: name + date of birth only, no page, no
 *       clickable link, no photo, out of Google, out of the sitemap.
 *     - Their NAMES REMAIN VISIBLE as plain text inside the profile pages of
 *       Paul Ivory (father, deceased), Sheryle Telfer (mother) and Timothy
 *       Telfer (stepfather) — a father's page must not read as childless.
 *     - PAUL IVORY'S PAGE IS EXEMPT: nothing about his page changes.
 *     - The vault is NOT edited. This is a website publication setting only,
 *       fully reversible by removing slugs from the list and rebuilding.
 *     - The record unlocks on death: remove the slug when the person dies.
 *
 * Prior history: an equivalent strip ran from 25 Aug 2026 and was switched off
 * on 8 Sep 2026 (commit a817c46) when the youngest generation was deliberately
 * re-indexed. This list re-enables it.
 */

/** Living Ivory youngest generation + their mother — withdrawn from publication. */
export const PRIVACY_STRIP_SLUGS = new Set([
  'aaron-ivory-1989',
  'joel-ivory-1986',
  'jared-ivory-1993',
  'lauren-ivory-1994',
  'karina-ivory',
  'sheryle-telfer-1961',
]);

/**
 * Slugs whose pages carry a robots noindex meta and are excluded from the
 * sitemap. Kept in sync with PRIVACY_STRIP_SLUGS.
 */
export const NOINDEX_SLUGS = new Set([...PRIVACY_STRIP_SLUGS]);
