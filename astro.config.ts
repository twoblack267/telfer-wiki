import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NOINDEX_SLUGS } from "./src/data/privacy-exclusions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// lastmod source (added 2026-09-21, revised same day)
//
// WHY: the sitemap previously carried ZERO <lastmod> entries across 981 URLs.
// Google uses <lastmod> to decide which URLs to recrawl. Without it every page
// looks equally stale forever and no update signal ever reaches Google — the
// most plausible cause of the Search Console "pages not indexed" alert.
//
// HOW (revised): v1 read only the wiki's own data files, so every one of 981
// URLs got the SAME timestamp (measured: 1 distinct value x981). That is barely
// better than no dates. v2 resolves each person to the markdown file that
// actually holds their content, in the OBSIDIAN VAULT (a separate git repo),
// and stamps that file's last-commit date. Result: genuinely varied per-page
// dates, so Google can tell what actually changed.
//
// Mapping: vault-manifest.json (path with a space, hence quoted execFileSync
// args) keys files as "<Name> (<years>).md". pages -> slug is done by matching
// the person's display name against the manifest key prefix, which is what the
// generator does. Unmatched pages fall back to the wiki data file date.
//
// SAFETY: any git failure (no repo, no history, shallow clone, CI) returns the
// fallback and the entry keeps a sane date; a total failure omits <lastmod>
// rather than failing the build. Build never breaks because of this.
// ---------------------------------------------------------------------------
const WIKI_DATA_FILES = [
  "src/data/people.public.json",
  "src/data/site-meta.json",
];

const VAULT_DIR = "/Users/marktelfer/ObsidianVault";
const VAULT_PEOPLE_DIR = "Family History/People";

/** git last-commit date for a path inside a given repo. undefined on any failure. */
function gitDate(repoDir: string, relPath: string): Date | undefined {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", relPath], {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (!out) return undefined;
    const d = new Date(out);
    return Number.isNaN(d.getTime()) ? undefined : d;
  } catch {
    return undefined;
  }
}

/** most recent git date across the wiki's own data files. */
const WIKI_DATA_LATEST = (() => {
  let latest: Date | undefined;
  for (const f of WIKI_DATA_FILES) {
    const d = gitDate(__dirname, f);
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
})();

// Build slug -> vault filename once, from the manifest (cheap, one read).
// Manifest files are keyed "Name (years).md" / "Name.md"; we index by the
// name-part so a person's display name can find their file.
const VAULT_BY_NAME = (() => {
  const map = new Map<string, string>();
  try {
    const raw = readFileSync(resolve(__dirname, "src/data/vault-manifest.json"), "utf-8");
    const man = JSON.parse(raw) as { files?: Record<string, unknown> };
    for (const fname of Object.keys(man.files || {})) {
      // "Aaron Paul Ivory (1989–?).md" -> "Aaron Paul Ivory"
      const name = fname.replace(/\.md$/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (name) map.set(name.toLowerCase(), fname);
    }
  } catch {
    // no manifest -> every person falls back to the wiki data date; fine.
  }
  return map;
})();

/** per-person vault file git date, by display name. */
function vaultDateForName(name: string | undefined): Date | undefined {
  if (!name) return undefined;
  const fname = VAULT_BY_NAME.get(name.trim().toLowerCase());
  if (!fname) return undefined;
  return gitDate(VAULT_DIR, `${VAULT_PEOPLE_DIR}/${fname}`);
}

// slug -> display name, straight from the data the pages render from.
// NOTE: people.public.json uses `title` (not `name`) and titles look like
//   "Adam Murray (1728–1816) — Father of John Murray of Langshawburn"
// so we take everything BEFORE the em-dash, then strip a trailing "(years)".
// (v2 of this function used p.name||p.title and matched only 17% of people.)
const PERSON_NAME_BY_SLUG = (() => {
  const map = new Map<string, string>();
  const clean = (s: string) =>
    s.split("—")[0].split(" - ")[0].replace(/\s*\([^)]*\)\s*$/, "").trim();
  try {
    const raw = readFileSync(resolve(__dirname, "src/data/people.public.json"), "utf-8");
    const arr = JSON.parse(raw) as Array<{ slug?: string; name?: string; title?: string }>;
    for (const p of arr) {
      if (!p.slug) continue;
      const rawName = (p.name || p.title || "").trim();
      if (rawName) map.set(p.slug, clean(rawName));
    }
  } catch {
    // no data -> all person pages fall back to the wiki data date; fine.
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
      // Per-URL <lastmod>: each person is stamped with the date their own vault
      // markdown file last changed (a different git repo), so dates genuinely
      // vary per page. Non-person pages use the wiki data-file date.
      serialize(item) {
        let best = WIKI_DATA_LATEST;
        try {
          const pathname = new URL(item.url).pathname;
          const m = pathname.match(/^\/people\/([^/]+)\//);
          if (m) {
            // Resolve the slug to its display name via the public people data,
            // then to its vault file. Both lookups are cached maps.
            const name = PERSON_NAME_BY_SLUG.get(m[1]);
            const d = vaultDateForName(name);
            if (d) best = d;
          }
        } catch {
          // any lookup problem -> keep the wiki data-file fallback
        }
        return best ? { ...item, lastmod: best.toISOString() } : item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});

