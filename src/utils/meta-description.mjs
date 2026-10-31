// Shared meta-description budget helper.
//
// WHY: every page in the wiki must emit a <meta name="description"> that fits the
// ~160-character search snippet budget. Before this helper existed the person
// template truncated at 158 chars but the family, timeline, homepage and a
// handful of hand-written person lines did not, so 149 pages shipped
// over-budget descriptions (card itc-20261023-7). Truncating in one shared place
// keeps the rule single-sourced: generated files are never hand-edited.
//
// The cut prefers a real word/sentence boundary so snippets never end mid-word.

export const META_DESCRIPTION_MAX = 158;

// Function words that must never be the last thing a snippet shows. Longest forms first so
// the alternation does not stop at "at" inside "at the". Applied ONLY to the clamped tail.
const DANGLING_TAIL =
  /(?:[\s,;:—–-]+(?:and|or|but|of|in|on|at|to|with|was|were|is|are|the|a|an|for|from|by|as|who|which|that|his|her|their|its|this|these|those|after|before|during|born|died))+$/i;

// Numeric and named entities that end up in a description must be DECODED before the
// layout escapes them for HTML, or Google shows the raw escape: "known as &#34;Cuth&#34;"
// instead of "known as "Cuth"". 22 pages shipped that way (card itc-20261026-2) because
// the renderer emits real quotes, the HTML escape re-encodes them on write, and nothing
// decoded at the end. Decode once, here, at the single point every description passes
// through — do not sprinkle .replace() calls across templates.
const ENTITY_MAP = [
  [/&#0*38;|&amp;/g, "&"],
  [/&#0*34;|&quot;/g, '"'],
  [/&#0*39;|&apos;|&#8216;|&#8217;|&lsquo;|&rsquo;/g, "'"],
  [/&#8212;|&mdash;/g, "\u2014"],
  [/&#8211;|&ndash;/g, "\u2013"],
  [/&#8210;|&#45;/g, "-"],
  [/&#0*60;|&lt;/g, "<"],
  [/&#0*62;|&gt;/g, ">"],
  [/&nbsp;|&#160;/g, " "],
  [/&hellip;|&#8230;/g, "\u2026"],
];
export function decodeDescriptionEntities(text) {
  let s = String(text == null ? "" : text);
  for (const [re, to] of ENTITY_MAP) s = s.replace(re, to);
  // Any remaining numeric entity: keep the real character, never the escape.
  s = s.replace(/&#(\d+);/g, (m, n) => {
    const c = Number(n);
    return Number.isFinite(c) && c > 31 && c < 0x110000 ? String.fromCodePoint(c) : " ";
  });
  return s;
}

/**
 * Fit `text` inside the snippet budget without ending mid-word.
 * @param {unknown} text
 * @param {number} max
 * @returns {string}
 */
export function clampDescription(text, max = META_DESCRIPTION_MAX) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  // Decode FIRST, both paths: the early return below previously handed back the raw
  // string with `&#34;` still in it, so every under-budget description shipped the literal
  // escape (card tw-2026-10-31-002). Length is measured on what a crawler receives.
  const d = decodeDescriptionEntities(s);
  if (d.length <= max) return d;
  const cut = d.slice(0, max + 1);
  // Prefer a sentence boundary, then a clause boundary, then a word boundary.
  const lastSentence = cut.lastIndexOf(". ");
  const lastClause = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("; "), cut.lastIndexOf(" — "));
  const lastSpace = cut.lastIndexOf(" ");
  const at =
    lastSentence > max * 0.6
      ? lastSentence + 1
      : lastClause > max * 0.6
        ? lastClause
        : lastSpace > 0
          ? lastSpace
          : max;
  // Never end a snippet on a dangling function word ("…son of Francis Telfer and").
  // 9 pages shipped that tail (card tw-2026-10-31-003). Strip trailing stopwords first,
  // then re-check for a word boundary; only trim when something real is left.
  let out = d.slice(0, at).replace(/[\s,;:—–-]+$/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(DANGLING_TAIL, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}
