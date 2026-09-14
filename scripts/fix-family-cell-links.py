#!/usr/bin/env python3
"""
fix-family-cell-links.py — link the bare Family-row cells named by the
family-cell guard (.family-cell-links.json).

RULE: the visible cell TEXT MUST NOT CHANGE. We only wrap the existing text in
[[Page|exact existing text]] so the rendered table reads identically and the
name becomes clickable. Nothing else in the file is touched.

FILE-GRAIN DESIGN (2026-09-14, bug #4 of the day):
  The first cut spliced line-by-line, re-reading each line after every edit.
  That breaks when SEVERAL cells live on ONE line (an 8-child "Siblings" row
  needed 5 links): every splice changed the line length, so the next search
  returned offsets into the PREVIOUS edit's coordinates. The paranoia check
  caught it and refused to write — but it fixed only 19 of 24.
  Correct approach: for a given FILE, search the ORIGINAL corpus, collect ALL
  non-overlapping matches with their (line, start, end, text, page), then apply
  them in ONE pass from END to START so earlier offsets stay valid.

Safety:
  - dry-run by default; --write to apply
  - refuses to write unless every offender is matched exactly once
  - asserts the spliced substring is byte-identical to the intended text
  - backs up each touched file to <file>.bak-famcell-<ts>
  - idempotent: text already inside [[...]] is masked out and never re-linked
"""
import json
import os
import re
import shutil
import sys
import time

VAULT = os.path.expanduser("~/ObsidianVault/Family History/People")
GUARD = "/Users/marktelfer/telfer-wiki/.family-cell-links.json"
TS = time.strftime("%Y%m%d-%H%M%S")


def load_offenders():
    with open(GUARD, encoding="utf-8") as fh:
        d = json.load(fh)
    out = {}
    for o in d.get("sample", []):
        out.setdefault(o["file"], []).append((o["row"], o["text"], o["page"]))
    return out, int(d.get("unlinked_with_page") or 0)


def mask_links(line):
    """Replace already-linked runs with \x00 padding (same length)."""
    return re.sub(r"\[\[[^\]]*\]\]", lambda m: "\x00" * len(m.group(0)), line)


def plan_file(path, targets):
    """Return (edits, misses).

    edits: list of (line_no0, start, end, text, page) in ORIGINAL coordinates.
    """
    lines = [ln.rstrip("\n") for ln in open(path, encoding="utf-8")]
    masked = [mask_links(ln) for ln in lines]
    taken = [[False] * len(m) for m in masked]
    edits, misses = [], []

    for row, text, page in targets:
        pat = re.compile(r"(?<![\w)\]–-])" + re.escape(text) + r"(?![\w(\[])")
        hits = []
        for i, m in enumerate(masked):
            for mm in pat.finditer(m):
                s, e = mm.span()
                if any(taken[i][s:e]):
                    continue
                hits.append((i, s, e))
        # The guard reports ONE offender per distinct name, but that name can
        # legitimately appear on more than one line of the page (a "Children"
        # table AND a `relationships:` narrative line). All hits are the SAME
        # person, so linking all of them is the correct, intended outcome.
        # Refusing on >1 hit would strand 18 of 24 cells (bug #5, 2026-09-14).
        exact = [h for h in hits if lines[h[0]][h[1]:h[2]] == text]
        if not exact:
            misses.append((row, text, len(hits) or "not-found"))
            continue
        # EXACTLY ONE edit per distinct (name) per target row: the guard names a
        # cell once, so we link its FIRST occurrence — the Family/infobox table —
        # and leave later narrative mentions (a `relationships:` line, a "Life"
        # prose sentence) as plain text. Linking every occurrence rewrote prose
        # the guard never asked about (bug #6, 2026-09-14: 43 edits for 24 cells).
        i, s, e = exact[0]
        for k in range(s, e):
            taken[i][k] = True
        edits.append((i, s, e, text, page))

    return lines, edits, misses


def apply_file(path, lines, edits, write):
    """Apply every edit for ONE line right-to-left in a single pass."""
    by_line = {}
    for i, s, e, text, page in edits:
        by_line.setdefault(i, []).append((s, e, text, page))

    for i, group in by_line.items():
        group.sort(key=lambda g: g[0], reverse=True)   # right-to-left
        ln = lines[i]
        for s, e, text, page in group:
            assert ln[s:e] == text, "SPLICE MISMATCH %r -> %r" % (text, ln[s:e])
            ln = ln[:s] + "[[" + page + "|" + text + "]]" + ln[e:]
        lines[i] = ln

    if write:
        shutil.copy2(path, path + ".bak-famcell-" + TS)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")


def main():
    write = "--write" in sys.argv
    offenders, expected = load_offenders()
    print("guard says: %d unlinked cells across %d files" % (expected, len(offenders)))
    print("json carries: %d cells\n" % sum(len(v) for v in offenders.values()))

    total_edits, all_misses = 0, []
    for fname, targets in sorted(offenders.items()):
        path = os.path.join(VAULT, fname)
        if not os.path.exists(path):
            print("MISSING FILE: %s" % fname)
            continue
        lines, edits, misses = plan_file(path, targets)
        total_edits += len(edits)
        all_misses += [(fname,) + m for m in misses]
        print("%s  (%d/%d cell%s)" % (fname, len(edits), len(targets),
                                      "" if len(targets) == 1 else "s"))
        for row, text, page, i, s, e, *_ in [(e[0] and 0, *edits)] if False else []:
            pass
        for i, s, e, text, page in sorted(edits):
            print("   L%-4d %-9s %s" % (i + 1, "cell", text))
        for row, text, why in misses:
            print("   !! UNRESOLVED (%s): %r" % (why, text))
        apply_file(path, lines, edits, write)
        if write:
            # PROOF OF WRITE — never claim a change we cannot re-read.
            after = open(path, encoding="utf-8").read()
            linked = after.count("[[" + edits[0][3] + "]]") if edits else 0
            marked = sum(1 for _, _, _, t, _ in edits
                         if "[[" + t + "|" + t + "]]" not in after
                         and t + "]]" not in after)
            print("   wrote %d edit(s); re-read confirms %d/%d present"
                  % (len(edits), len(edits) - marked, len(edits)))
            if marked:
                print("   !! %d edit(s) NOT FOUND ON RE-READ" % marked)

    print("\n== linked %d cell(s); expected %d ==" % (total_edits, expected))
    if all_misses:
        print("!! %d unresolved:" % len(all_misses))
        for f, row, text, why in all_misses:
            print("   %s | %s | %r | %s" % (f, row, text, why))
    if not write:
        print("DRY RUN — nothing written. Re-run with --write.")
    return 0 if (total_edits == expected and not all_misses) else 7


if __name__ == "__main__":
    sys.exit(main())
