/**
 * Format person body text for display.
 * Converts [[Wiki Links]] to proper HTML anchor tags.
 */

export function formatBody(body, people) {
  if (!body) return "";

  const BASE = import.meta.env.BASE_URL || "/";

  let html = body
    // Strip leading blockquote markers (> ) from markdown first — fixes blockquote-wrapped images & notes
    .replace(/^>\s*/gm, "")
    // Strip social media profile URLs — safety net (primary strip is in convert-markdown.mjs)
    .replace(/https?:\/\/(www\.)?(facebook|fb)\.com\/[^\s)\]]+/gi, "[Facebook profile — redacted]")
    .replace(/https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(in|pub|company)\/[^\s)\]]+/gi, "[LinkedIn — redacted]")
    .replace(/https?:\/\/(www\.)?twitter\.com\/[^\s)\]]+/gi, "[Twitter — redacted]")
    .replace(/https?:\/\/(www\.)?instagram\.com\/[^\s)\]]+/gi, "[Instagram — redacted]")
    .replace(/https?:\/\/(www\.|vt\.)?tiktok\.com\/[^\s)\]]+/gi, "[TikTok — redacted]")
    .replace(/https?:\/\/(www\.)?snapchat\.com\/[^\s)\]]+/gi, "[Snapchat — redacted]")
    .replace(/https?:\/\/(www\.)?youtube\.com\/[^\s)\]]+/gi, "[YouTube — redacted]")
    .replace(/https?:\/\/(www\.)?pinterest\.(com|com\.au)\/[^\s)\]]+/gi, "[Pinterest — redacted]")
    // Strip Notes, Photos, and Links sections — safety net (primary strip is in convert-markdown.mjs)
    .replace(/## Notes[\s\S]*?(?=## |$)/g, '')
    .replace(/## Photos[\s\S]*?(?=## |$)/g, '')
    .replace(/## Links[\s\S]*?(?=## |$)/g, '')
    // Convert [[Link|Alias]] to <a href="${BASE}people/slug">Alias</a>
    .replace(/\[\[([^\]]+)\|([^\]]+)\]\]/g, (match, link, alias) => {
      const slug = lookupSlug(link.trim(), people);
      if (slug) return `<a href="${BASE}people/${slug}" class="wiki-link">${alias.trim()}</a>`;
      return alias.trim();
    })
    // Convert [[Link]] to <a href="${BASE}people/slug">Link</a>
    .replace(/\[\[([^\]]+)\]\]/g, (match, link) => {
      const slug = lookupSlug(link.trim(), people);
      if (slug) return `<a href="${BASE}people/${slug}" class="wiki-link">${link.trim()}</a>`;
      return link.trim();
    })
    // Bold **text**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic *text*
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Convert headings
    .replace(/^### (.+)$/gm, "<h3 class='font-serif text-lg text-[var(--color-burgundy)] mt-4 mb-0'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='font-serif text-xl text-[var(--color-burgundy)] mt-4 mb-0'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='font-serif text-2xl text-[var(--color-burgundy)] mt-4 mb-0'>$1</h1>")
    // Horizontal rule
    .replace(/^---$/gm, "<hr class='my-0 border-[var(--color-border)]'>")
    // Convert markdown tables (header | separator | rows)
    // Tolerant: accepts both GFM leading-pipe (| a | b |) and lax format
    // ( a | b |) where rows may start with whitespace instead of a pipe,
    // and the separator row may have no leading pipe. This fixes the
    // "names not in columns" ragged render seen on Castleton/Murray profiles.
    .replace(
      /^\s*\|?[^\n]+?\|\s*\n^\s*\|?[-|: ]+\|\s*\n(?:^\s*\|?[^\n]+\|\s*\n?)+/gm,
      (match) => {
        // Normalise each line: strip leading pipe + whitespace and trailing pipe + whitespace
        const rows = match.trim().split('\n').map((l) => {
          let s = l.trim();
          if (s.startsWith('|')) s = s.slice(1).trim();
          if (s.endsWith('|')) s = s.slice(0, -1).trim();
          return s;
        });
        if (rows.length < 2) return match;
        const headers = rows[0].split('|').filter((c) => c.trim()).map((c) => c.trim());
        // Only treat as a table if the 2nd line is a real separator (--- | --- pattern)
        const sep = rows[1].replace(/\|/g, '').trim();
        if (!/^[-: ]+$/.test(sep) || !sep.includes('-')) return match;
        let html = '<table class="w-full border-collapse my-0 text-sm"><thead><tr>';
        for (const h of headers) {
          html += `<th class="bg-[var(--color-heading)] text-white font-sans font-semibold text-left px-2 py-1">${h}</th>`;
        }
        html += '</tr></thead><tbody>';
        for (let i = 2; i < rows.length; i++) {
          const cells = rows[i].split('|').filter((c) => c.trim()).map((c) => c.trim());
          html += '<tr>';
          for (const c of cells) {
            html += `<td class="px-2 py-0.5 border-b border-[var(--color-border)]">${c}</td>`;
          }
          html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
      }
    )
    // Convert bullet points
    .replace(/^[-*] (.+)$/gm, "<li class='ml-4 text-[var(--color-ink)]'>$1</li>")
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, "<ul class='space-y-1 my-0'>$1</ul>")
    // Convert numbered lists
    .replace(/^\d+\.\s+(.+)$/gm, "<li class='ml-4 list-decimal text-[var(--color-ink)]'>$1</li>")
    // Images: ![alt](path) — now handles blockquote-stripped markdown
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      if (src.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        const imgSrc = src.startsWith("/") ? `${BASE}${src.replace(/^\//, "")}` : `${BASE}${src}`;
        return `<figure class="my-0"><img src="${imgSrc}" alt="${alt}" class="rounded-lg max-w-full" loading="lazy" /><figcaption class="text-xs text-[var(--color-muted)] mt-1">${alt}</figcaption></figure>`;
      }
      return `<a href="${BASE}${src.replace(/^\//, "")}" class="wiki-link" target="_blank">${alt || src}</a>`;
    })
    // Regular links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="wiki-link">$1</a>')
    // Convert paragraphs (double+ newlines) — collapse to single marker
    .replace(/\n\n+/g, "__PARA_BREAK__")
    // Line breaks (single newlines within paragraphs)
    .replace(/\n/g, "<br>");

  // Split on paragraph breaks, wrap only text segments in <p>, leave block elements alone
  const BLOCK_ELEMENTS = /^(<(?:h[1-6]|ul|ol|li|figure|blockquote|hr|table|div|p)[^>]*>)/i;
  const segments = html.split("__PARA_BREAK__");
  html = segments.map(seg => {
    const trimmed = seg.trim();
    if (!trimmed) return "";
    // If segment starts with a block element, leave it alone
    if (BLOCK_ELEMENTS.test(trimmed)) return trimmed;
    // Otherwise wrap in paragraph
    return `<p class='mb-0 text-[var(--color-ink)] leading-relaxed'>${trimmed}</p>`;
  }).join("");

  // Fix any double <p> nesting
  html = html.replace(/<p[^>]*>\s*<p[^>]*>/g, "<p>");
  html = html.replace(/<\/p>\s*<\/p>/g, "</p>");

  // Strip <br> garbage: start/end of output, inside <p> boundaries, and adjacent to block elements
  html = html.replace(/^(<br>)+/i, "");
  html = html.replace(/(<br>)+$/i, "");
  // Strip <br> from start of <p> tags
  html = html.replace(/<p([^>]*)>(<br>)+/gi, "<p$1>");
  // Strip <br> from end of <p> tags
  html = html.replace(/(<br>)+<\/p>/gi, "</p>");
  // Remove <br> immediately before/after block elements (including li siblings)
  html = html.replace(/(<br>)+\s*(<(?:h[1-6]|table|figure|ul|ol|hr|li)[^>]*>)/gi, "$2");
  html = html.replace(/(<\/(?:h[1-6]|table|figure|ul|ol|li)>)\s*(<br>)+/gi, "$1");
  // Strip <br> after <br> (consecutive break collapse)
  html = html.replace(/(<br>)+\s*(<br>)+/gi, "<br>");

  return html;
}

function lookupSlug(name, people) {
  if (!name || !people) return null;

  // Relationship fields (parents/children/spouses/siblings) store SLUGS, not display
  // names (e.g. "john-smith", "francis-telfer-1809"). Resolve a direct slug match
  // first so sidebar relationship links work. Safe for body [[wiki-links]] too:
  // a display name like "John Smith" never equals a lowercase hyphenated slug.
  const directSlug = people.find(
    (p) => (p.slug || "").toLowerCase() === name.trim().toLowerCase()
  );
  if (directSlug) return directSlug.slug;

  // Extract birth year from name BEFORE stripping (e.g. "James Telfer (1796–1863)" → 1796)
  const yearMatch = name.match(/\((\d{4})/);
  const targetBirthYear = yearMatch ? parseInt(yearMatch[1]) : null;

  let clean = name.replace(/\([^)]*(?:\d|living|deceased|\?)[^)]*\)/g, "").trim().toLowerCase();
  // Strip leading honorific titles so "Rev. Robert Haining" matches profile "Robert Haining".
  // Titles include a trailing period + space OR a bare space. Safe: only strips at the very
  // start; "Rev. Robert Haining" → "robert haining", never touches a surname or middle name.
  clean = clean.replace(
    /^(rev\.|reverend|dr\.|doctor|mr\.|mister|mrs\.|mrs|miss|missus|ms\.|ms|sir|madam|dame|lady|lord|prof\.|professor|capt\.|captain|sgt\.|sergeant|col\.|colonel|maj\.|major|fr\.|father|x\.?|h\.h\.)\s+/,
    ""
  ).trim();
  if (!clean) return null;

  // Collect ALL exact display_name matches first
  const exactMatches = people.filter(p => p.display_name?.toLowerCase() === clean);
  if (exactMatches.length === 1) return exactMatches[0].slug;
  if (exactMatches.length > 1) {
    // Among multiple exact matches, prefer by target birth year
    if (targetBirthYear) {
      const yearExact = exactMatches.find(p => p.birth_year === targetBirthYear);
      if (yearExact) return yearExact.slug;
    }
    // Prefer living over deceased
    const living = exactMatches.filter(p => p.is_living);
    if (living.length === 1) return living[0].slug;
    // Fall back to first (by slug sort / array order)
    return exactMatches[0].slug;
  }

  // Check aliases: a profile may carry alternate names that a wiki-link should
  // resolve to (e.g. "David Telfer" → profile "David Mark Kenneth Telfer-Merrick").
  // An alias is essentially another exact name, so match clean (post-trim) against it.
  const aliasMatches = people.filter(p =>
    Array.isArray(p.aliases) && p.aliases.some(a => a && a.toLowerCase() === clean)
  );
  if (aliasMatches.length === 1) return aliasMatches[0].slug;

  // Try first+last match
  const [first, ...rest] = clean.split(/\s+/);
  const last = rest.pop() || "";
  const matches = people.filter(p => p.first_name?.toLowerCase() === first && p.last_name?.toLowerCase() === last);
  if (matches.length === 1) return matches[0].slug;
  if (matches.length > 1) {
    // Prefer by birth year if we have one from the name
    if (targetBirthYear) {
      const yearMatch = matches.filter(p => p.birth_year === targetBirthYear);
      if (yearMatch.length === 1) return yearMatch[0].slug;
    }
    // Prefer people with a matching middle name
    const middle = rest.join(" ").toLowerCase();
    if (middle) {
      const middleMatch = matches.filter(p => p.middle_name?.toLowerCase() === middle);
      if (middleMatch.length === 1) return middleMatch[0].slug;
    }
    // Prefer living people over deceased
    const living = matches.filter(p => p.is_living);
    if (living.length === 1) return living[0].slug;
    // Fall back to first match (alphabetical order in array)
    return matches[0].slug;
  }

  // Try last name match (for "Telfer" links etc.)
  for (const p of people) {
    if (p.last_name?.toLowerCase() === clean) return p.slug;
  }

  return null;
}

/**
 * Generate relationship sidebar link objects ({ name, slug }) for a person's
 * parents/children/spouses/siblings arrays.
 *
 * Those arrays store SLUGS (e.g. "kylie-telfer"). We resolve each slug to its
 * person so the link href is clean AND the link TEXT shows the display name
 * (not the raw slug) — the same readable name format used everywhere else on
 * the site. Unresolvable slugs fall back gracefully (name=slug, no link).
 */
export function getLinksForRelationships(relationshipNames, allPeople) {
  return relationshipNames.map((entry) => {
    const person = allPeople.find((p) => (p.slug || "") === entry.trim());
    if (person) return { name: person.display_name, slug: person.slug, lifespan: person.lifespan };
    // Not a slug — try resolving a display-name/wiki-link to a slug, keep the
    // original text as the link label.
    const slug = lookupSlug(entry, allPeople);
    let linkedLifespan;
    if (slug) {
      const linked = allPeople.find((p) => p.slug === slug);
      if (linked) linkedLifespan = linked.lifespan;
    }
    return { name: entry, slug, lifespan: linkedLifespan };
  });
}
