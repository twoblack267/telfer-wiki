/**
 * Cell splitting for markdown tables, wikilink-aware.
 *
 * WHY THIS EXISTS (2026-11-07)
 * ----------------------------
 * `row.split("|")` is WRONG for this vault, and it failed silently on a large scale.
 * A wikilink may carry an alias: `[[William Telfer (1841)|William Telfer (1841–?)]]`.
 * That internal pipe is a perfectly legal character. Splitting on it cuts the cell in
 * half, and every reader that then uses `cells[2]` gets `"[[William Telfer (1841)"` —
 * a truncated, unresolvable ref — and throws away the rest of the cell, which held the
 * other children.
 *
 * Measured on the vault on 2026-11-07: 266 Family-table rows across 151 of 679 files
 * were being destroyed this way by the snapshot writer alone. That is the mechanism
 * behind the "~800 sibling links collapsed" graph incidents (tw-2026-11-06-008/009/010):
 * not a resolver problem, a PARSING problem. `convert-markdown.mjs` was fixed on
 * 2026-10-28 with a depth counter, but the fix was never shared, so the snapshot writer
 * and validate-family-cell-links.mjs kept the naive split and kept losing data.
 *
 * THE RULE: a pipe inside `[[...]]` is content, not a column separator. Handles
 * `[[a|b]]`, `[[a|b|c]]`, escaped `\|` inside a cell, and an unterminated `[[` (which
 * should never exist but must not make the parser eat the row).
 */

/**
 * Split one markdown table line into trimmed cells.
 * Leading and trailing empty cells (from the outer pipes) are preserved, so
 * `cells[1]` is the label and `cells[2]` is the value, as every caller expects.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitTableRow(line) {
  const cells = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      // An escaped pipe is literal content, never a separator.
      current += "|";
      i++;
      continue;
    }
    if (ch === "[") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === "]") {
      if (depth > 0) depth--;
      current += ch;
      continue;
    }
    if (ch === "|" && depth === 0) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Pull every wikilink target out of a cell value.
 * `[[a|b]]` -> "a" (the target is before the alias pipe), `[[a]]` -> "a".
 * Non-link text is ignored: it is a display name with no page behind it.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function linkTargets(value) {
  const out = [];
  const re = /\[\[([^\]]+?)\]\]/g;
  let m;
  while ((m = re.exec(value))) {
    const target = m[1].split("|")[0].trim();
    if (target) out.push(target);
  }
  return out;
}
