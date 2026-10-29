/**
 * Format person body text for display.
 * Converts [[Wiki Links]] to proper HTML anchor tags.
 */

export function formatBody(body, people) {
  if (!body) return "";

  const BASE = import.meta.env.BASE_URL || "/";

  let html = body
    // ── Drop the duplicate `**Role:**` line (itc-20261024-2) ─────────────────
    // The person template renders `person.roles` as the italic chip directly
    // under the name, and many vault profiles ALSO open their body with the same
    // sentence as a `**Role:** …` field line. The reader got the identical
    // paragraph twice, separated only by the "Biography" heading. The chip is the
    // canonical render of that field, so the body copy is the duplicate — remove
    // it here rather than deleting content from the vault. Anchored to a line that
    // STARTS with the label, so a `Role:` mentioned mid-sentence is untouched.
    .replace(/^[ \t]*\*\*Role:?\*\*[^\n]*(?:\n(?![ \t]*\n)[^\n]*)*\n?/gim, '')
    // Same duplicate in its plain/unlabelled form: an opening line that is exactly
    // the role text. Guarded by the caller having a role to render.
    .replace(/^[ \t]*Role:[^\n]*\n?/gim, '')
    // Biography field-summary separator normalisation. Some profiles were generated
    // with a single-line intro that joins labelled fields with literal pipes, e.g.
    //     **Born:** 2 Oct 1868, Tungkillo SA | **Died:** 11 Oct 1950 ... | **Mother:** ... | **Father:** ...
    // Those pipes are field SEPARATORS, not content, but they survive to render as
    // literal " | " visible text on the page. Turn each separator pipe into a real
    // line break so the fields render as separate labelled lines (matching the
    // multi-line field summaries used by better-formed profiles).
    //
    // Safety: only a " | " immediately followed by a bold label containing a colon
    // (**Label:**) is targeted — the exact field-summary signature. This can never
    // touch real markdown table rows (those are "| **Name** |" / "| [[link]] |" cell
    // syntax with NO colon after the bold), nor [[Link|Alias]] wikilinks (those carry
    // a pipe but are followed by plain alias text, not "**Label:**"). Purely presentational.
    .replace(/ \| (?=\*\*[A-Za-z][^*\n:]*?:\*\*)/g, "\n")
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
      if (slug) return `<a href="${BASE}people/${slug}/" class="wiki-link">${alias.trim()}</a>`;
      return alias.trim();
    })
    // Convert [[Link]] to <a href="${BASE}people/slug">Link</a>
    .replace(/\[\[([^\]]+)\]\]/g, (match, link) => {
      const slug = lookupSlug(link.trim(), people);
      if (slug) return `<a href="${BASE}people/${slug}/" class="wiki-link">${link.trim()}</a>`;
      return link.trim();
    })
    // Bold **text**
    // `[\s\S]` not `.`: the vault is HARD-WRAPPED at ~80 columns, so an emphasised
    // phrase routinely straddles a newline ("**Until such an entry is\nsighted**").
    // A dot matched no newline, so those pairs survived to the page as literal "**"
    // (itc-20261024-1, the last 3 of 400 pages). Tolerant match, and the captured
    // text keeps its line break so paragraph flow is unchanged.
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    // Italic *text*
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
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
        // The table MUST live inside a block-level .table-scroll div so the
        // horizontal-scroll guard in BaseLayout.astro has something to scroll.
        // Putting overflow-x:auto on the <table> itself sizes it to min-content
        // and pushes the last column off-screen on phones (see BaseLayout note).
        // Tables with 4+ columns cannot fit a phone; tag them so BaseLayout can
        // switch them to intrinsic width inside the scroll wrapper instead of
        // cramming cells into unreadable slivers.
        const wideCls = headers.length >= 4 ? ' wide-table' : '';
        // A 2-column table whose first column is a short LABEL (Relation, Mother,
        // Father, Spouse...) needs the nowrap floor in BaseLayout. A 2-column
        // table whose first column holds PERSON NAMES (Family / Children tables)
        // must wrap, or the page overflows. Distinguish by header text.
        const KV = /^(relation|relationship|role|field|attribute|item|key|detail|fact|event|date|label)$/i;
        const kvCls = headers.length === 2 && KV.test(headers[0]) ? ' kv-table' : '';
        let html = `<div class="table-scroll"><table class="w-full border-collapse my-0 text-sm${wideCls}${kvCls}"><thead><tr>`;
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
        html += '</tbody></table></div>';
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

// Exported so the relationship-link guard (scripts/validate-relationship-links.mjs)
// resolves names through EXACTLY this function instead of re-implementing it and
// drifting. The guard asserts a href only after resolving the same way the page does.
export function lookupSlug(name, people) {
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

  // ── "b. ~1791" IS A BIRTH YEAR, NOT DECORATION (2026-10-25) ────────────
  // The strip above only removes brackets CONTAINING A DIGIT, so "Elisabeth
  // Telfer (b. ~1806, England)" kept its whole parenthetical and could never equal
  // a display_name. Worse, the year regex above is anchored to the bracket's first
  // character, so "b. ~1791" yields targetBirthYear = null even though the vault is
  // telling us exactly which John this is.
  //
  // Consequence, MEASURED not guessed: "John Telfer (b. ~1791, England)" matched no
  // exact display_name (four other men are called plain "John Telfer"), fell through
  // to array order, and returned john-telfer-1805 — a DIFFERENT MAN, born 14 years
  // later. A silently wrong link is the Neil Telfer defect.
  //
  // So: pull a birth year out of "b. YYYY" / "born YYYY" / "c. YYYY" / "~YYYY", strip
  // such an annotation from the comparable name, and use the year to pick the right
  // namesake.
  let annotatedBirth = null;
  const bMatch = name.match(/\([^)]*?\b(?:b\.|born|c\.|~|approx\.?)\s*~?\s*(\d{4})[^)]*\)/i);
  if (bMatch) {
    annotatedBirth = parseInt(bMatch[1], 10);
    clean = clean.replace(/\s*\([^)]*\b(?:b\.|born|c\.|~|approx\.?)[^)]*\)\s*/i, " ").replace(/\s+/g, " ").trim();
  }
  const wantedBirth = annotatedBirth ?? targetBirthYear;

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
    if (wantedBirth) {
      const yearExact = exactMatches.find(p => p.birth_year === wantedBirth);
      if (yearExact) return yearExact.slug;
      // The name matches several people and the ref names a year that NONE of them
      // carries. That person is not in the data: refuse rather than let array order
      // hand back a namesake (2026-10-25).
      if (annotatedBirth) return null;
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
    if (wantedBirth) {
      const yearMatch = matches.filter(p => p.birth_year === wantedBirth);
      if (yearMatch.length === 1) return yearMatch[0].slug;
      if (annotatedBirth) return null;
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


  // FIX (Skippy, 2026-09-13): the vault note IS the truth and it is named with the family
  // naming convention ("Mary Ann (Gelligen) Dillon (1887-1954)"), while display_name carries the
  // shortened form ("Mary Ann Dillon") and omits married surnames the convention appends
  // (Tuck / Hucks / Radford / Grant / Roach). The parenthetical stripper above removes only
  // brackets CONTAINING A DIGIT, so the maiden-name bracket survives and the string-match finds
  // nothing - 35 body [[wiki-links]] across 24 profiles were degrading to plain text on the live
  // site. Fall back to the vault_file stem, which is the same name the author actually wrote.
  // Deliberately LAST, so every existing resolution wins first and no current link changes.
  // Index is built per call (people arrays are small) to avoid stale caches.
  // MUST stay identical in scripts/check-body-links.mjs (guard) and src/utils/format-body.mjs
  // (renderer): if the two diverge the guard stops mirroring what actually renders.
  const stemOf = (v) => (v || "").split("/").pop().replace(/\.md$/i, "");
  // Normalise BOTH sides the same way: drop the trailing "(dates)" the convention appends, and
  // drop a bare "(living)/(deceased)/(?)". The target arriving here has ALREADY had its year
  // bracket stripped by clean(), so the stem must lose its year too or the two can never meet.
  const normStem = (s) => s
    .replace(/\s*\([^)]*(?:\d|living|deceased|\?)[^)]*\)\s*$/i, "")
    .replace(/\s*\((?:living|deceased|\?)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const targetStem = normStem(clean.trim());
  const stemMatches = people.filter((p) => normStem(stemOf(p.vault_file)) === targetStem && targetStem !== "");
  if (stemMatches.length === 1) return stemMatches[0].slug;
  if (stemMatches.length > 1) {
    if (wantedBirth) {
      const yearStem = stemMatches.find((p) => p.birth_year === wantedBirth);
      if (yearStem) return yearStem.slug;
    }
    const livingStem = stemMatches.filter((p) => p.is_living);
    if (livingStem.length === 1) return livingStem[0].slug;
    return stemMatches[0].slug;
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
/**
 * Resolve [[Wiki Links]] inside a short string (role lines, subtitles) to
 * anchors. This is the lighter equivalent of formatBody's wiki-link pass —
 * roles are one-liners and must NOT be run through the full paragraph/heading
 * pipeline. Unresolvable links degrade to plain text (brackets stripped).
 */
export function inlineLinks(text, people) {
  if (!text) return "";
  const BASE = import.meta.env.BASE_URL || "/";
  return text
    .replace(/\[\[([^\]]+)\|([^\]]+)\]\]/g, (match, link, alias) => {
      const slug = lookupSlug(link.trim(), people);
      if (slug) return `<a href="${BASE}people/${slug}/" class="wiki-link">${alias.trim()}</a>`;
      return alias.trim();
    })
    .replace(/\[\[([^\]]+)\]\]/g, (match, link) => {
      const slug = lookupSlug(link.trim(), people);
      if (slug) return `<a href="${BASE}people/${slug}/" class="wiki-link">${link.trim()}</a>`;
      return link.trim();
    })
    // Inline EMPHASIS — the role/tagline line is vault markdown like everything
    // else, but this lighter path never ran the bold/italic passes that formatBody
    // applies to paragraph bodies. So "**Role:** Daughter of … **single physical
    // link** …" reached the page with its asterisks intact, and readers saw raw
    // "**" on 26 of 400 person pages (itc-20261024-1). A one-liner is still
    // markdown; convert it here. Bold BEFORE italic so "**x**" is not eaten as
    // two nested italics. Asterisks inside an existing <a> are left alone.
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
}

/**
 * Strip wiki-link markup from a string down to plain text (no HTML). Used for
 * attribute values (data-role filters) where anchors are invalid — turns
 * `[[Name (y)–(z)]]` and `[[Link|Alias]]` into `Name (y)–(z)` / `Alias`.
 */
export function stripWikiLinks(text) {
  return String(text ?? "").replace(/\[\[([^\]|]+(?:\|[^\]|]+)?)\]\]/g, (m, inner) => {
    const [, alias] = inner.split("|");
    return alias || inner;
  }).replace(/[\[\]]/g, "");
}

// Derive a lifespan fresh from the display fields, so a stale stored `lifespan`
// string can never leak a wrong "?" onto a relationship row (the Allen defect:
// birth 1956 recorded but chip still read "? – 2015"). Mirrors the sanitize
// reconciliation exactly. birth_year_display / death_year_display are always
// populated (hold "~" circa, "living", "?" honestly) → lossless, never drops "~".
function derivedLifespan(p) {
  // LIVING = NO DEATH STATUS (Mark's ruling 30 Oct 2026). A blank death display is
  // not a missing value to be filled with "?" — it is the deliberate absence of a
  // claim. Show the birth year alone, or nothing at all when even that is unrecorded.
  // This must agree with dLifespan() in pages/people/[slug].astro, because the
  // relationship-links guard asserts the row's chip equals the page's lifespan.
  if (p.is_living === true && p.death_year == null) {
    const b = p.birth_year_display ?? "?";
    return b === "?" ? "" : b;
  }
  if (!p.birth_year_display && !p.death_year_display) return p.lifespan || "";
  const b = p.birth_year_display ?? "?";
  const d = p.death_year_display ?? "?";
  if (b === "?" && d === "?") return "Dates unknown";
  return `${b} – ${d}`;
}

/**
 * ── GENERATION SANITY FOR RAW NAME REFS (2026-10-25) ──────────────────────────
 *
 * `lookupSlug` is a NAME matcher with no biology in it. The graph builder has had a
 * generation gate since the Neil Telfer defect (a father who died 59 years before
 * his son was born) — but a RAW NAME left in a relationship array never goes back
 * through that builder, so the RENDERER resolved it by name alone and linked it.
 *
 * Measured on live data, before this gate existed:
 *   • david-parker-1822 (b.1822).parents → "Hugh Parker" → hugh-parker-1859,
 *     his own SON, born 37 years after him.
 *   • robert-telfer-1835 (b.1835).children → "Francis John Burton Telfer"
 *     → francis-telfer-1768, born 67 years BEFORE him.
 *   • james-telfer-1858 (b.1858).siblings → "Margaret Rutherford Telfer"
 *     → margaret-telfer-1801, born 57 years earlier.
 *   • joseph-march-1797 (b.1797).children → "Joseph March" → joseph-march-1767,
 *     his own FATHER rendered as his child.
 *
 * Each of those printed a confident, clickable link asserting a family fact that is
 * impossible. A wrong link is worse than no link: it is a fabrication with a URL.
 *
 * Deliberately NOT a full date gate — the builder owns biology. This only catches the
 * blatant, undeniable case: a person can never be their own ancestor, a parent/child
 * edge can never run backwards, and a sibling can never be two generations away.
 * Undated people are never judged; absence of dates is not evidence.
 */
export function generationPlausible(relation, subject, candidate) {
  if (!subject || !candidate) return true;
  const sBorn = subject.birth_year, cBorn = candidate.birth_year;
  if (sBorn == null || cBorn == null) return true;   // undated: no evidence, allow
  const gap = sBorn - cBorn;                          // positive = candidate older
  // A parent must still have been ALIVE when the child was conceived. This is the
  // Neil Telfer case exactly: his father was written as "John Ernest Telfer", which
  // is john-telfer-1877 — born 1877 and died 1877 — for a boy born in 1936. The birth
  // gap alone (59 years) sat inside the window below, so the link survived. Dying
  // 59 years before the child's birth is not a large gap, it is an impossibility.
  const cDied = candidate.death_year;
  if (relation === 'parents') {
    if (cDied != null && cDied < sBorn - 1) return false;
    // A parent must be older — by at least a decade in this family's records — and
    // not so much older that the link is plainly cross-generational.
    return gap >= 10 && gap <= 60;
  }
  if (relation === 'children') {
    // The CHILD must be born while the subject was alive.
    const sDied = subject.death_year;
    if (sDied != null && cBorn > sDied + 1) return false;
    return gap <= -10 && gap >= -60;
  }
  if (relation === 'siblings') {
    return Math.abs(gap) <= 30;
  }
  return true; // spouses: age spreads are real, never judged here
}

export function getLinksForRelationships(relationshipNames, allPeople, context = null) {
  const subject = context?.subject || null;
  const relation = context?.relation || null;
  return relationshipNames.map((entry) => {
    // A WITHDRAWN relative (privacy strip) arrives as { plain_name } — the
    // person has no page, so this renders as plain text with NO link. Set
    // deliberately: a father's page must still name his children.
    if (entry && typeof entry === "object") {
      const plain = entry.plain_name || entry.name || "";
      return { name: plain, slug: null, lifespan: undefined, plain: true };
    }
    const person = allPeople.find((p) => (p.slug || "") === entry.trim());
    if (person) return { name: person.display_name, slug: person.slug, lifespan: derivedLifespan(person) };
    // A RAW NAME WITH EXPLICIT YEARS IS NEVER RE-RESOLVED (fixed 2026-10-24).
    // The pipeline writes a raw display name into a relationship field only when
    // it REFUSED to bind that ref. Two refusals exist and they need opposite
    // handling:
    //
    //   1. UNDATED raw name — the vault gave nothing but a name, and the name did
    //      not match exactly one profile. Nothing was disproved, it merely could
    //      not be proven: "James Cowan", "Andrew Telfer". These legitimately
    //      re-resolve; the guard below would otherwise hide 30 real relatives.
    //
    //   2. YEARS ON THE NAME — "John Ernest Telfer (1877-1877)",
    //      "Adam Murray (1812-1882)". The years ARE the evidence that let the
    //      pipeline test the candidate and reject it. Re-binding such a ref by
    //      bare name is how Neil Ronald Telfer (b.1936) was handed a father who
    //      died 59 years before he was born: `lookupSlug` is a pure NAME matcher
    //      with no dates, so it cheerfully overruled the gate. It must not.
    //
    // So: dates present ⇒ plain text, always. No dates ⇒ resolve, as before.
    //
    // FIXED 2026-10-25: the rule above was over-broad and it broke 12 real links.
    // A NON-LIFESPAN PARENTHETICAL IS PART OF THE NAME, not evidence of refusal.
    // "John Telfer (b. ~1791, England)" carries a birth PLACE and a "~" — that is a
    // disambiguator the vault author wrote to distinguish him from other Johns, and
    // `lookupSlug` resolves it correctly. But the old test (`\d{3,4}` inside any
    // parenthetical) saw the 1791, classified the ref as a REJECTED lifespan, and
    // printed the man as plain text on his sister's page — a real relative silently
    // unlinked, while his page linked fine the other way.
    //
    // Only a PROPER LIFESPAN is evidence of refusal: (1877–1877), (1812-1882),
    // (1853–1853) — year, dash, year/death-word. A "(b. ~1791, England)" or
    // "(fl. 1998)" style annotation denotes identity and must be resolved.
    const LIFESPAN_SHAPE = /\(\s*~?\d{4}\s*[–-]\s*(?:\d{4}|living|\?)\s*\)/;
    const hasYears = LIFESPAN_SHAPE.test(entry);
    if (hasYears) {
      // Show the bare name: the years belonged to the candidate the gate
      // REJECTED, so printing them beside this person would assert the very
      // match that was refused.
      //
      // FIXED 2026-10-25: the old strip removed EVERY dated parenthetical and
      // collapsed all whitespace, which turned `Jean "Jane" Lawrie (1836–1914)`
      // into `Jean "Jane" Lawrie` — and the guard's text is what a reader sees.
      // Strip only a TRAILING lifespan, so the name the vault author wrote is
      // preserved verbatim and only the refused annotation goes.
      const bare = entry.replace(/\s*\(\s*~?\d{4}\s*[–-]\s*(?:\d{4}|living|\?)\s*\)\s*$/, "").trim();
      return { name: bare || entry, slug: null, lifespan: undefined, plain: true };
    }
    // EXPLICIT "NO PROFILE" MARKER (2026-10-28). The researcher can assert in the vault
    // that a named relative has no record and must not be linked — "Elisabeth Telfer
    // (bap. 1774, no profile)". The data layer now honours that, but the render layer was
    // still resolving the name on its own and emitting a real <a href>. That is the same
    // wrong-person link one level down: Thomas Telfer's daughter, baptised 1774, rendered
    // as a link to a woman born in England in 1806. Print the name, refuse the link.
    if (/no[-\s]profile|do not link|not the same person/i.test(entry)) {
      return { name: entry, slug: null, lifespan: undefined, plain: true };
    }
    // Not a slug and not a refused dated ref — try resolving a display-name/
    // wiki-link to a slug, keep the original text as the link label.
    const slug = lookupSlug(entry, allPeople);
    let linkedLifespan;
    if (slug) {
      const linked = allPeople.find((p) => p.slug === slug);
      // ── THE LAST LINE OF DEFENCE (2026-10-25) ──────────────────────────────
      // A name match is not a relationship. If the name resolved but the DATES make
      // the claim impossible, print the name and refuse the link. This is where a
      // father stops being rendered as his son's child, and where a man born 67
      // years after another stops being his father. See generationPlausible().
      if (linked && !generationPlausible(relation, subject, linked)) {
        return { name: entry, slug: null, lifespan: undefined, plain: true };
      }
      if (linked) linkedLifespan = derivedLifespan(linked);
    }
    if (!slug) return { name: entry, slug: null, lifespan: undefined, plain: true };
    return { name: entry, slug, lifespan: linkedLifespan };
  });
}
