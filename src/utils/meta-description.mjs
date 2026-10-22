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

/**
 * Fit `text` inside the snippet budget without ending mid-word.
 * @param {unknown} text
 * @param {number} max
 * @returns {string}
 */
export function clampDescription(text, max = META_DESCRIPTION_MAX) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
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
  return s.slice(0, at).replace(/[\s,;:—–-]+$/, "").trim();
}
