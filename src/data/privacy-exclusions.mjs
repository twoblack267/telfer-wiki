/**
 * Privacy exclusions — person slugs whose pages should NOT be indexed by search
 * engines (noindex) and excluded from the sitemap.
 *
 * As of 2026-09-08 the Ivory youngest-generation members (Aaron, Joel, Jared,
 * Lauren, Karina) are no longer excluded: Mark decided on this date to let them
 * show on Google again, matching the rest of the living family whose pages are
 * already indexed. Paul Ivory (deceased) stays a normal indexed page.
 *
 * This set is intentionally EMPTY until a future privacy need arises. It is the
 * single source of truth consumed by the person page template (robots noindex
 * meta) and astro.config.ts (sitemap filter). Keep the two consumers in sync.
 */
export const NOINDEX_SLUGS = new Set([]);
