import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { NOINDEX_SLUGS } from "./src/data/privacy-exclusions.mjs";

export default defineConfig({
  site: "https://telferwiki.com",
  output: "static",
  integrations: [
    sitemap({
      entryLimit: 1000,
      // Privacy: keep living Ivory pages out of the sitemap entirely.
      filter: (page) => {
        const m = page.match(/\/people\/([^/?]+)/);
        return !(m && NOINDEX_SLUGS.has(m[1]));
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
