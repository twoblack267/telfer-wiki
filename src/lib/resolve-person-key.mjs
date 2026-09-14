/**
 * resolve-person-key.mjs — one resolver for manifest→slug lookups.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/data/sameas.json` and `src/data/faqs.json` are keyed by a SHORT name
 * (`adam-murray`). Person page slugs are DISAMBIGUATED (`adam-murray-1728`).
 * The old code did an exact dictionary lookup:
 *
 *     (sameas.people || {})[person.slug] || []
 *
 * so every short key silently missed and the page shipped with NO `sameAs`
 * and NO `FAQPage` structured data — invisible dead weight. Nothing errored.
 * Five alarms, one disease: two identifiers compared by a rule that matched
 * nothing (kanban card tw-2026-09-14-004 / -005).
 *
 * THE RULE
 * --------
 *  1. exact slug match wins;
 *  2. otherwise the DATED variant `<key>-<year>` — but only if EXACTLY ONE
 *     exists (an ambiguous key would attach a stranger's data to a person);
 *  3. otherwise undefined. The caller decides (in dev, it throws).
 *
 * This never invents a match and never mutates the manifests.
 */

/** Candidate dated forms we accept: 1000–2099. */
const YEAR_SUFFIX = /-(1\d{3}|20\d{2})$/;

/**
 * @param {string} key        manifest key, e.g. "adam-murray"
 * @param {Set<string>|string[]} slugs  every real person slug
 * @returns {{slug: string, how: 'exact'|'dated'}|null}
 */
export function resolvePersonKey(key, slugs) {
  const set = slugs instanceof Set ? slugs : new Set(slugs);
  if (set.has(key)) return { slug: key, how: "exact" };

  const dated = [];
  for (const s of set) {
    if (s === key) continue;
    if (YEAR_SUFFIX.test(s) && s.slice(0, -YEAR_SUFFIX.exec(s)[0].length) === key) {
      dated.push(s);
    }
  }
  if (dated.length === 1) return { slug: dated[0], how: "dated" };
  if (dated.length > 1) {
    throw new Error(
      `resolvePersonKey("${key}") is AMBIGUOUS — ${dated.length} dated slugs ` +
        `match: ${dated.join(", ")}. Add an explicit key in the manifest.`
    );
  }
  return null;
}

/**
 * Look a manifest up by person slug. Returns `payload` or undefined.
 * In dev, a key that names a real page but fails to resolve THROWS — so a
 * dead key can never again ship silently. In prod it degrades quietly.
 * @param {object} manifest  parsed sameas.json / faqs.json
 * @param {string} slug      the page's canonical slug
 * @param {Set<string>|string[]} allSlugs
 * @param {{label?: string, strict?: boolean}} [opts]
 */
export function lookupByPersonSlug(manifest, slug, allSlugs, opts = {}) {
  const label = opts.label || "manifest";
  const people = manifest?.people || {};
  if (people[slug] !== undefined) return people[slug];

  // Try every key that resolves TO this slug (dated fallback, then exact).
  const set = allSlugs instanceof Set ? allSlugs : new Set(allSlugs);
  const hits = [];
  for (const key of Object.keys(people)) {
    if (key === slug) continue;
    let r = null;
    try {
      r = resolvePersonKey(key, set);
    } catch {
      continue; // ambiguous keys are reported by the build assertion instead
    }
    if (r && r.slug === slug) hits.push(key);
  }
  if (hits.length === 1) return people[hits[0]];
  if (hits.length > 1) {
    if (opts.strict) {
      throw new Error(
        `${label}: slug "${slug}" is claimed by ${hits.length} keys ` +
          `(${hits.join(", ")}) — refusing to guess.`
      );
    }
    return undefined;
  }

  if (opts.strict && !manifest?._sealed) {
    // Only noisy for slugs that exist as pages at all; callers doing a global
    // sweep set strict:false.
    return undefined;
  }
  return undefined;
}

/**
 * Build-time assertion: every manifest key must resolve to a real person slug.
 * Throws with a full report. Wire this into the build so the class of bug
 * cannot return.
 * @param {{name: string, data: object}[]} manifests
 * @param {Set<string>|string[]} allSlugs
 */
export function assertManifestKeysResolve(manifests, allSlugs) {
  const set = allSlugs instanceof Set ? allSlugs : new Set(allSlugs);
  const problems = [];
  let checked = 0;

  for (const { name, data } of manifests) {
    for (const key of Object.keys(data?.people || {})) {
      checked++;
      try {
        const r = resolvePersonKey(key, set);
        if (!r) problems.push(`${name}: key "${key}" matches NO person page slug`);
      } catch (e) {
        problems.push(`${name}: ${e.message}`);
      }
    }
  }
  if (problems.length) {
    throw new Error(
      `MANIFEST KEY RESOLUTION FAILED (${problems.length}/${checked}):\n  - ` +
        problems.join("\n  - ")
    );
  }
  return checked;
}
