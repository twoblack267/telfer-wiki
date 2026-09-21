import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NOINDEX_SLUGS } from "./src/data/privacy-exclusions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// lastmod source (added 2026-09-21; v3)
//
// WHY: the sitemap previously carried ZERO <lastmod> entries across 981 URLs.
// Google uses <lastmod> to decide which URLs to recrawl. Without it every page
// looks equally stale forever and no update signal ever reaches Google — the
// most plausible cause of the Search Console "pages not indexed" alert.
//
// HISTORY (each version measured, not assumed):
//   v1 read the wiki's own data files  -> 1 distinct date across 981 URLs.
//   v2 shelled out to git against the OBSIDIAN VAULT from this config.
//      Worked locally (11 distinct dates) but COLLAPSED IN CI: the vault is a
//      separate repo at an absolute local path that does not exist on an Ubuntu
//      runner, so every person fell back to the wiki date. Published sitemap:
//      981 URLs, 1 identical timestamp = the CI checkout time. Fails-safe had
//      quietly become fails-silently.
//   v3 (this) reads src/data/lastmod.json — a COMMITTED map generated on the
//      machine that actually has the vault, by scripts/gen-lastmod.mjs.
//      Result: identical dates locally and in CI, no git needed at build time.
//
// REGENERATE after any vault change:   node scripts/gen-lastmod.mjs
//
// PRIVACY NOTE: lastmod.json contains only slug -> date. No vault content,
// names, or paths beyond what the sitemap already publishes.
//
// SAFETY: if the file is missing/empty the sitemap simply omits <lastmod>,
// rather than inventing a value. The build never breaks because of this.
// ---------------------------------------------------------------------------
type LastmodFile = { people?: Record<string, string> };

const LAST_MOD_BY_SLUG = (() => {
  const map = new Map<string, string>();
  try {
    const raw = readFileSync(resolve(__dirname, "src/data/lastmod.json"), "utf-8");
    const data = JSON.parse(raw) as LastmodFile;
    for (const [slug, iso] of Object.entries(data.people || {})) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) map.set(slug, d.toISOString());
    }
  } catch {
    // no map -> pages get no <lastmod>; build continues.
  }
  return map;
})();

export default defineConfig({
  site: "https://telferwiki.com",
  output: "static",
  integrations: [
    sitemap({
      entryLimit: 1000,
      // Privacy: keep living Ivory pages out of the sitemap entirely.
      // NOTE: NOINDEX_SLUGS is currently EMPTY by design (2026-09-08 decision
      // to let the youngest Ivory generation back on Google). This filter is
      // therefore a no-op today; it stays wired so re-adding a slug to the
      // set once again removes that person from the sitemap automatically.
      filter: (page) => {
        const m = page.match(/\/people\/([^/?]+)/);
        return !(m && NOINDEX_SLUGS.has(m[1]));
      },
      // Per-URL <lastmod>, from the committed slug -> date map.
      // A URL whose slug is absent (15 people have no vault file match) gets NO
      // <lastmod> at all — we omit rather than invent a date.
      serialize(item) {
        try {
          const pathname = new URL(item.url).pathname;
          const m = pathname.match(/^\/people\/([^/]+)(\/|$)/);
          if (m) {
            const iso = LAST_MOD_BY_SLUG.get(m[1]);
            if (iso) return { ...item, lastmod: iso };
          }
        } catch {
          // malformed URL -> no lastmod for this entry
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});

