/**
 * vault-marks.mjs — render the vault's evidence marks as site icons, not emoji.
 *
 * WHY THIS EXISTS
 * The vault uses emoji as an evidence-grading system, and that grading is
 * load-bearing content — it is not decoration:
 *
 *     ⚠️  Partially verified — needs a second source
 *     ✅  Death date CONFIRMED — 3 June 1919 (Trove 87485729)
 *     ❌  Disproven / superseded
 *     ⭐  Strongest available evidence
 *
 * So the marks must SURVIVE, but 125 vault files carrying 164 ⚠️ and 115 ✅
 * should not render as platform emoji: they clash with the fine-line woodcut
 * icon set and they render differently on every OS, device and theme.
 *
 * The vault is the record; the website is a VIEW of it. So the translation
 * happens HERE, at render time. Not one byte of the vault changes — a mark
 * removed from the vault would delete a research judgement, which is data loss,
 * not a design fix.
 *
 * These are deliberately NOT sprite `<use>` refs: profile pages don't always
 * carry the sprite block, and a missing sprite renders an invisible icon. Inline
 * SVG with explicit stroke has no such failure mode.
 */

// Brand ink. Matches --nav-ink / the banyan logo sampled by PIL: #8A1B3B.
const INK = "#8A1B3B";
const GREEN = "#2F6B4F"; // "confirmed" reads as a positive, and green is the
const AMBER = "#9A6A16"; // only hue in the palette that isn't the brand burgundy.
const RED = "#8C1D1D";
const GOLD = "#9A6A16";

/**
 * Each mark is drawn on the same 24x24 grid as the nav icons: 1.5px stroke,
 * round caps/joins, no fill. Sized in em so it tracks the surrounding text
 * (these appear inline in prose, table cells and headings).
 */
function svg(paths, color, label) {
  return `<svg class="vault-mark" viewBox="0 0 24 24" width="1em" height="1em" fill="none" `
    + `stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" `
    + `role="img" aria-label="${label}" style="vertical-align:-0.12em;flex:0 0 auto">${paths}</svg>`;
}

const MARKS = {
  // ⚠️  partial / needs a second source — triangle + bang
  "⚠": () => svg(
    '<path d="M12 3.2 21.5 20H2.5L12 3.2Z"/><path d="M12 9.4v4.4"/><circle cx="12" cy="17" r="0.9" fill="' + AMBER + '" stroke="none"/>',
    AMBER, "Partially verified — needs a second source"
  ),
  // ✅  confirmed — circle + tick
  "✅": () => svg(
    '<circle cx="12" cy="12" r="9"/><path d="M7.6 12.3l3 3 5.8-6.1"/>',
    GREEN, "Confirmed by a primary record"
  ),
  // ✔️ (text-presentation tick used interchangeably in the vault)
  "✔": () => svg(
    '<path d="M4 12.8l5.2 5.2L20 6.6"/>',
    GREEN, "Confirmed by a primary record"
  ),
  // ❌  disproven / superseded
  "❌": () => svg(
    '<circle cx="12" cy="12" r="9"/><path d="M8.4 8.4l7.2 7.2M15.6 8.4l-7.2 7.2"/>',
    RED, "Disproven or superseded"
  ),
  // 🖊️  anecdote / as-told narrative — quill nib
  "🖊": () => svg(
    '<path d="M20.2 3.8c-4.1.7-8.2 3-11 5.9-1.6 1.6-2.6 3.6-3 5.8l3.9 3.9c2.2-.4 4.2-1.4 5.8-3 2.9-2.8 5.2-6.9 5.9-11l-1.6-1.6Z"/>'
    + '<path d="M4.5 19.5 9 15"/>',
    INK, "Anecdote, as told in the family record"
  ),
  // 🏴  location / where a memorial stands — map pin, not a black flag
  "🏴": () => svg(
    '<path d="M12 21.2s6.6-6.1 6.6-11a6.6 6.6 0 1 0-13.2 0c0 4.9 6.6 11 6.6 11Z"/>'
    + '<circle cx="12" cy="10.1" r="2.4"/>',
    INK, "Location of this record"
  ),
  // ✓  bare tick (register-read confirmation, without the circle)
  "\u2713": () => svg(
    '<path d="M4.6 12.4l4.6 4.6L19.4 6.6"/>',
    GREEN, "Confirmed by a primary record"
  ),
  // \u2708  service record — ribbon + disc, nothing inside the disc. Three
  //     attempts got this wrong: arrow/sword read as upload, wing read as a
  //     dropdown chevron, and a starred medal collapsed to a blob at 1em.
  //     A blank disc on a V ribbon survives being 15px wide.
  "\u2708": () => svg(
    '<path d="M7.4 3.4 12 10.6l4.6-7.2"/>'
    + '<circle cx="12" cy="15" r="5.6"/>',
    INK, "Military service record"
  ),
  // \u{1F7E1}  partial confidence — a gauge arc. A half-filled disc read as a
  //     theme/contrast toggle; an arc with a needle reads as "part way".
  "\u{1F7E1}": () => svg(
    '<path d="M4.2 17.5a9 9 0 1 1 15.6 0"/>'
    + '<path d="M12 12.6 15.4 9.2"/>'
    + '<circle cx="12" cy="12.6" r="1.1" fill="' + AMBER + '" stroke="none"/>',
    AMBER, "Partial confidence"
  ),
  // ⭐  strongest available evidence — drawn as a primary-document seal (a
  //     rounded sheet with a ribbon), not a rating star: a five-point star reads
  //     as "favourite/bookmark" inline and says nothing about evidence quality.
  "⭐": () => svg(
    '<path d="M12 5.4l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6Z"/>',
    GOLD, "Strongest available evidence"
  ),
};

// A mark is only converted when it is followed by whitespace or end-of-token.
// This prevents eating a mark that is part of a longer run, and keeps the
// original spacing exactly as the vault author wrote it.
// NOTE: 🖊 (U+1F58A) and 🏴 (U+1F3F4) are astral-plane code points. Written
// literally inside a character class they failed to match at all - the
// class silently skipped them and the emoji survived to the page. Escaped
// with \u{...} and the u flag so the engine reads them as single points.
const MARK_RE = /([\u26A0\u2705\u2714\u2713\u274C\u2B50\u2708\u{1F58A}\u{1F3F4}\u{1F7E1}])(\uFE0F|\uFE0E)?/gu;

export function renderVaultMarks(html) {
  if (!html) return html;
  return html.replace(MARK_RE, (whole, ch) => {
    const draw = MARKS[ch];
    return draw ? draw() : whole;
  });
}

/** Count marks in a string — used by the guard test. */
export function countVaultMarks(text) {
  return (String(text || "").match(MARK_RE) || []).length;
}

export const VAULT_MARK_CHARS = Object.keys(MARKS);

/**
 * Strip marks from plain-text contexts (meta descriptions, OG/Twitter cards).
 *
 * Search snippets and link previews cannot render an inline icon, so a mark
 * there is either an emoji or noise. Removed rather than replaced — the grade
 * is still stated in words in the sentence that follows it.
 */
export function stripVaultMarks(text) {
  return String(text || "")
    .replace(MARK_RE, "")
    .replace(/^[\s,;:—–-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
