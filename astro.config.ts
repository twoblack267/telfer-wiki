import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://telferwiki.com",
  output: "static",
  integrations: [
    sitemap({
      entryLimit: 1000,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
