import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://telfer.org.au",
  base: "",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
});
