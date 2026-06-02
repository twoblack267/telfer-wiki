import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://twoblack267.github.io",
  base: "/telfer-wiki/",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
});
