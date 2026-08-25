/**
 * Privacy exclusions — person slugs whose pages should NOT be indexed by search
 * engines (noindex) and excluded from the sitemap.
 *
 * Covers living members of the Ivory family (privacy request, 2026-08-25).
 * Paul Ivory (deceased) is deliberately NOT excluded — his page stays indexed.
 *
 * Used by both the person page template (robots noindex meta) and
 * astro.config.ts (sitemap filter). Keep this the single source of truth.
 */
export const NOINDEX_SLUGS = new Set([
  "aaron-ivory",
  "joel-ivory",
  "jared-ivory",
  "lauren-ivory",
  "karina-ivory",
]);
