import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NOINDEX_SLUGS, isDerivedNoindex } from "./src/data/privacy-exclusions.mjs";

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

// ---------------------------------------------------------------------------
// <image:image> for person URLs (added 2026-11-08)
//
// WHY: measured 2026-11-08 — the sitemap declared the xmlns:image namespace on
// every chunk and used it ZERO times. Google's image crawler had no image
// entries and no captions; it had to infer every photo from HTML markup. That
// is the declaration gap this map closes.
//
// SOURCE OF TRUTH: people.public.json — the same file the page template reads.
// Nothing is duplicated by hand; a photo added to a person record appears here
// on the next build with no other edit anywhere. That is the point: the owner
// uploads a photo, the pipeline carries it the rest of the way unattended.
//
// CONSENT SCOPE — identical to the template's `imageSchema`: DECEASED people
// only, and never a slug on NOINDEX_SLUGS. A sitemap image entry points Google
// at a photo tied to a name; that is a deliberate push, and it is for the dead.
// Living people get their photo in the page markup for visitors and nothing in
// the sitemap. Both consumers read the same two rules — keep them in lockstep
// or the two signals contradict each other in public.
// ---------------------------------------------------------------------------
type PublicPerson = {
  slug?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  lifespan?: string;
  person_photo?: string | null;
  is_living?: boolean;
  images?: { src?: string; alt?: string }[];
};

const SITE_ORIGIN = "https://telferwiki.com";

const PERSON_IMAGE_BY_SLUG = (() => {
  const map = new Map<string, { url: string; caption: string }>();
  try {
    const raw = readFileSync(resolve(__dirname, "src/data/people.public.json"), "utf-8");
    const data = JSON.parse(raw) as PublicPerson[] | { people?: PublicPerson[] };
    const people = Array.isArray(data) ? data : data.people || [];
    for (const p of people) {
      if (!p?.slug || !p.person_photo || p.is_living) continue;
      if (NOINDEX_SLUGS.has(p.slug)) continue;
      const alt = (p.images || []).find((i) => i.src === p.person_photo)?.alt;
      const name =
        (p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ")).trim() ||
        p.slug;
      const caption =
        (alt || "").trim() ||
        `${name}${p.lifespan ? ` (${p.lifespan})` : ""} — photograph`;
      map.set(p.slug, {
        url: `${SITE_ORIGIN}/${String(p.person_photo).replace(/^\/+/, "")}`,
        caption,
      });
    }
  } catch {
    // no map -> sitemap carries no image entries; the build continues and the
    // pages still declare their own images in JSON-LD. Fails quiet, not fatal.
  }
  return map;
})();

// ---------------------------------------------------------------------------
// <lastmod> for NON-PERSON pages, taken from the last git commit of the source
// file that renders them. Values are literal and dated — they are NOT computed
// at build time, because a build-time fallback would restamp every page on
// every deploy and teach Google that lastmod means nothing (the exact failure
// mode that made the 2026-09 CI sitemap worthless: 981 URLs, one timestamp).
//
// UPDATE THIS when a listed page's source file changes. An unlisted page gets
// no <lastmod> — omitting is honest, inheriting is not.
// ---------------------------------------------------------------------------
const PAGE_LAST_MOD = new Map<string, string>([
  ["/", "2026-11-04T12:00:00.000Z"], // src/pages/index.astro
  ["/about/", "2026-11-04T12:00:00.000Z"], // src/pages/about.astro
  ["/timeline/", "2026-11-04T12:00:00.000Z"], // src/pages/timeline.astro
  ["/contact/", "2026-11-04T12:00:00.000Z"], // src/pages/contact.astro
  ["/search/", "2026-11-04T12:00:00.000Z"], // src/pages/search.astro
  ["/downloads/", "2026-10-24T12:00:00.000Z"], // src/pages/downloads.astro
  ["/privacy/", "2026-10-25T12:00:00.000Z"], // src/pages/privacy.astro
  ["/terms/", "2026-10-17T12:00:00.000Z"], // src/pages/terms.astro
  ["/ballads/", "2026-10-25T12:00:00.000Z"], // src/pages/ballads/index.astro
  ["/ballads/telfers-cows/", "2026-10-25T12:00:00.000Z"], // src/pages/ballads/telfers-cows.astro
  ["/telfer-name/", "2026-10-27T12:00:00.000Z"], // src/pages/telfer-name.astro
  ["/people/", "2026-11-04T12:00:00.000Z"], // src/pages/people/index.astro
  ["/people/dna/", "2026-10-25T12:00:00.000Z"], // src/pages/people/dna.astro
  ...Object.entries(
    (JSON.parse(readFileSync(resolve(__dirname, "src/data/lastmod.json"), "utf-8")).pages ?? {}) as Record<string, string>,
  ).map(([path, iso]) => [path, iso] as [string, string]),
]);

export default defineConfig({
  site: "https://telferwiki.com",
  output: "static",
  // canonical link form (added 2026-10-17; card tw-2026-10-16-001).
  // WHY: every rendered internal href was emitted slashless (e.g.
  // "/people/william-telfer-shepherd") while canonical tags and the sitemap
  // both publish the slashed form ("/people/william-telfer-shepherd/").
  // Live measurement: the slashless URL 301s to the slashed one, so every
  // in-site click paid a redirect hop (~400+ links on the /people/ index).
  // 'always' makes Astro emit the canonical slashed form directly, so no
  // internal navigation relies on a redirect. The static host already
  // redirects slashless -> slashed, so existing external inbound links keep
  // working; only the rendered hrefs change.
  trailingSlash: "always",
  integrations: [
    sitemap({
      entryLimit: 1000,
      // Privacy: keep living Ivory pages out of the sitemap entirely.
      // NOINDEX_SLUGS is NOT empty — it holds the six privacy-withdrawn people
      // (owner's ruling 2026-10-16, reaffirmed 2026-10-26). This filter is live
      // and matters: it keeps their URLs out of sitemap.xml. It is not a no-op.
      // (The earlier "EMPTY by design, 2026-09-08" note here was stale and
      // contradicted the actual set — corrected 2026-11-03.)
      filter: (page) => {
        // `page` is a FULL URL (e.g. https://telferwiki.com/tree/), not a path —
        // @astrojs/sitemap hands the filter the same href it writes to <loc>.
        // Matching on a leading "/" silently matched nothing and let /tree/
        // through even after it was noindexed. Verified against
        // node_modules/@astrojs/sitemap/dist/index.js (line 95 passes the href).
        const treePaths = /^https?:\/\/[^/]+\/tree\/?$|^https?:\/\/[^/]+\/people\/full-tree\/?$/;
        if (treePaths.test(page)) return false;

        const m = page.match(/\/people\/([^/?]+)/);
        if (!m) return true;
        const slug = m[1];

        // 1. A withdrawn person: no page, no family sheet, nothing.
        if (NOINDEX_SLUGS.has(slug)) return false;

        // 2. Derived pages that print a withheld name. As of 5 Nov 2026 the
        //    sitemap lists a family sheet or descendant chart UNLESS the page
        //    itself is noindexed, and the noindex fence is keyed on the explicit
        //    `withheld: true` flag — never on a missing slug (that guess
        //    de-indexed 128 sheets of genuine relatives on 25 Oct 2026).
        //    Derived pages are /people/<slug>/family-sheet/ and /descendants/,
        //    so the SLUG is the second path segment in their case.
        if (/\/(?:family-sheet|descendants)\/?$/.test(page) && isDerivedNoindex(slug)) return false;

        // 3. The two whole-tree renderings. Added 26 Oct 2026 under the same
        //    ruling as case 2, and for a stronger reason: these pages are not
        //    just a second copy of the relationship table, they are the ONLY
        //    pages that emit every withdrawn name in one body, inside the
        //    client-side JSON payload as well as the markup. A crawler fetching
        //    /tree/ gets the entire withdrawn set in a single request.
        //    They also carry no unique content — both are derived views of the
        //    same people.json the profile pages already publish — so nothing is
        //    lost from the index by excluding them.
        //    Both are noindexed at the page level too (tree.astro,
        //    people/full-tree.astro); this keeps them out of the sitemap so we
        //    are not asking Google to crawl a page we then refuse to index.
        if (/^\/tree\/?$/.test(page) || /\/people\/full-tree\/?$/.test(page)) return false;

        // 4. /people/dna/ is NOT a person — it is an empty "Under Construction"
        //    stub: no genetic genealogy data has been added, and the whole
        //    content is a heading, one sentence of explanation and a "nothing
        //    here yet" notice. It still renders HTTP 200 and carries no noindex,
        //    so the sitemap was advertising it as a /people/<slug>/ profile.
        //    Measured 2026-11-06: the sitemap's 656 base /people/ URLs matched
        //    the 656 entries in people.public.json exactly EXCEPT for this one,
        //    which is why the route looked like it had "extra slugs". It does
        //    not — it has one non-person route wearing a person's URL shape.
        //    Excluded from the sitemap and noindexed on the page until it has
        //    real data (same precedent as /tree/ and /people/full-tree/).
        //    Remove this case when the page is populated, not before.
        if (/^https?:\/\/[^/]+\/people\/dna\/?$/.test(page)) return false;

        return true;
      },
      // Per-URL <lastmod>, from the committed slug -> date map.
      // A URL whose slug is absent (none as of 2026-11-05; the map covers
      // every public person) gets NO <lastmod> at all — we omit rather than
      // invent a date.
      //
      // Non-person pages fall back to their SOURCE FILE's last git commit.
      // Without this, 11 site pages (/, /about/, /timeline/, /contact/,
      // /search/, /downloads/, /privacy/, /terms/, /ballads/, /ballads/
      // telfers-cows/, /telfer-name/) shipped with no lastmod at all, so
      // Google had no recrawl signal for the very pages we most want
      // refreshed. Measured 2026-11-05.
      // The mapping is explicit (not derived) so a new top-level page gets
      // no date rather than a wrongly-inherited one.
      serialize(item) {
        try {
          const pathname = decodeURIComponent(new URL(item.url).pathname);
          const m = pathname.match(/^\/people\/([^/]+)(\/|$)/);
          if (m) {
            // A base person URL (not /family-sheet/ or /descendants/) carries
            // the person's own photograph as an <image:image> entry. Derived
            // pages do not: they print a relationship table, not a portrait,
            // and Google would be told the same photo belongs to two URLs.
            //
            // CRITICAL: the sitemap library does `item.img.forEach(...)` with
            // NO guard (node_modules/sitemap/.../sitemap-item-stream.js). An
            // item whose `img` is undefined THROWS mid-stream and silently
            // truncates the rest of that sitemap chunk. Measured 2026-11-08:
            // returning items without `img` dropped 148 <lastmod> entries and
            // the freshness gate caught it. Always emit an array, empty or not.
            const isBasePersonUrl = pathname === `/people/${m[1]}/`;
            const img = isBasePersonUrl ? PERSON_IMAGE_BY_SLUG.get(m[1]) : undefined;
            const withImage = {
              ...item,
              img: img ? [{ url: img.url, caption: img.caption }] : [],
            };
            const iso = LAST_MOD_BY_SLUG.get(m[1]);
            if (iso) return { ...withImage, lastmod: iso };
            return withImage;
          }
          const page = PAGE_LAST_MOD.get(pathname.replace(/\/?$/, "/"));
          if (page) return { ...item, lastmod: page };
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

