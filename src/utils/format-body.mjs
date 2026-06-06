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
    // Strip Notes and Links sections — safety net (primary strip is in convert-markdown.mjs)
    .replace(/## Notes[\s\S]*?(?=## |$)/g, '')
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
    .replace(/^### (.+)$/gm, "<h3 class='font-serif text-lg text-[var(--color-burgundy)] mt-4 mb-1'>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class='font-serif text-xl text-[var(--color-burgundy)] mt-4 mb-1'>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class='font-serif text-2xl text-[var(--color-burgundy)] mt-4 mb-1'>$1</h1>")
    // Horizontal rule
    .replace(/^---$/gm, "<hr class='my-2 border-[var(--color-border)]'>")
    // Convert bullet points
    .replace(/^[-*] (.+)$/gm, "<li class='ml-4 text-[var(--color-ink)]'>$1</li>")
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, "<ul class='space-y-1 my-2'>$1</ul>")
    // Convert numbered lists
    .replace(/^\d+\.\s+(.+)$/gm, "<li class='ml-4 list-decimal text-[var(--color-ink)]'>$1</li>")
    // Images: ![alt](path) — now handles blockquote-stripped markdown
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      if (src.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        const imgSrc = src.startsWith("/") ? `${BASE}${src.replace(/^\//, "")}` : `${BASE}${src}`;
        return `<figure class="my-4"><img src="${imgSrc}" alt="${alt}" class="rounded-lg max-w-full" loading="lazy" /><figcaption class="text-xs text-[var(--color-muted)] mt-1">${alt}</figcaption></figure>`;
      }
      return `<a href="${BASE}${src.replace(/^\//, "")}" class="wiki-link" target="_blank">${alt || src}</a>`;
    })
    // Regular links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="wiki-link">$1</a>')
    // Convert paragraphs (double newlines) — but DON'T wrap block elements
    .replace(/\n\n/g, "\n\n__PARA_BREAK__\n\n")
    // Line breaks
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
    return `<p class='mb-1 text-[var(--color-ink)] leading-relaxed'>${trimmed}</p>`;
  }).join("");

  // Fix any double <p> nesting
  html = html.replace(/<p[^>]*>\s*<p[^>]*>/g, "<p>");
  html = html.replace(/<\/p>\s*<\/p>/g, "</p>");

  // Strip leading/trailing <br> garbage
  html = html.replace(/^(<br>)+/i, "");
  html = html.replace(/(<br>)+$/i, "");

  return html;
}

function lookupSlug(name, people) {
  if (!name || !people) return null;
  const clean = name.replace(/\(.*?\)/g, "").trim().toLowerCase();

  // Try exact match first — but if the match is deceased and a living namesake exists,
  // fall through to first+last logic (which prefers living people)
  let deceasedMatch = null;
  for (const p of people) {
    if (p.display_name.toLowerCase() === clean) {
      if (p.is_living) return p.slug;
      deceasedMatch = p;
      break;
    }
  }

  // If we found an exact deceased match, check for a living namesake
  if (deceasedMatch) {
    const [first, ...rest] = clean.split(/\s+/);
    const last = rest.pop() || "";
    const livingNamesake = people.find(
      p => p.is_living
        && p.first_name?.toLowerCase() === first
        && p.last_name?.toLowerCase() === last
        && p.slug !== deceasedMatch.slug
    );
    if (livingNamesake) {
      // There's a living namesake — don't take the deceased match, let it fall through
      deceasedMatch = null;
    }
  }

  if (deceasedMatch) return deceasedMatch.slug;

  // Try first+last match
  const [first, ...rest] = clean.split(/\s+/);
  const last = rest.pop() || "";
  const matches = people.filter(p => p.first_name?.toLowerCase() === first && p.last_name?.toLowerCase() === last);
  if (matches.length === 1) return matches[0].slug;
  if (matches.length > 1) {
    // Prefer living people over deceased
    const living = matches.filter(p => p.is_living);
    if (living.length === 1) return living[0].slug;
    // Prefer people with a matching middle name
    const middle = rest.join(" ").toLowerCase();
    if (middle) {
      const middleMatch = matches.filter(p => p.middle_name?.toLowerCase() === middle);
      if (middleMatch.length === 1) return middleMatch[0].slug;
    }
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
 * Generate a map of slug → display_name for relationship lookups
 */
export function getLinksForRelationships(relationshipNames, allPeople) {
  return relationshipNames.map((name) => {
    const slug = lookupSlug(name, allPeople);
    return { name, slug };
  });
}
