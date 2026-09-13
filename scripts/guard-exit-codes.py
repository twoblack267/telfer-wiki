#!/usr/bin/env python3
"""
guard-exit-codes.py  —  card tw-2026-09-13-021

Catches the class of bug where a verification command's REAL exit status is
destroyed by piping it directly into tail/head (or any consumer).

WHY THIS EXISTS
  `node scripts/X.mjs 2>&1 | tail -20` makes $? the status of `tail`, which is
  always 0. A gate that exits 1 is then reported GREEN. Confirmed 8 times on
  2026-09-13; it produced three wrong verdicts in one session (check-body-links
  and check-live-slug-regression were both falsely reported as "exits 0").

WHAT IT SCANS
  Shell scripts (*.sh, *.bash, *.zsh) for a command piped into a masking
  consumer (tail/head/awk/sed/...) where the pipeline's status is relied upon,
  either:
    (a) on the SAME line  —  cmd | tail || exit 1   /  if cmd | tail; then
    (b) on a LATER line   —  cmd | tail -20
                             if [ $? -ne 0 ]; then ...      <-- $? is tail's!

WHAT IT DOES NOT FLAG (proven safe patterns)
  1. Capture-then-pipe:   OUT="$(cmd 2>&1)" || { echo "$OUT" | tail; exit 1; }
  2. pipefail in effect:  set -o pipefail  (status propagates through the pipe)
  3. Display-only pipes whose status is never consulted anywhere after.

USAGE
  python3 scripts/guard-exit-codes.py [paths...] [--verbose]

EXIT
  0 = no dangerous pipeline found
  1 = at least one dangerous pipeline found
  2 = could not scan (fail closed — never report a pass on no evidence)

VERIFICATION HISTORY (card -021)
  2026-09-13 first build: CONTROL B (planted bug) returned 0 — FALSE PASS.
    Cause: same-line-only status detection missed `$?` consumed on the next
    line, which is the idiomatic form of this bug. Fixed by adding a
    look-ahead window. Re-verified: A=0 B=1 C=0 D=0 E=2.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

import yaml  # noqa: F401  (unused; kept out of logic deliberately)

# Consumers that mask the upstream exit status when they terminate a pipeline.
MASKING_CONSUMERS = ("tail", "head", "cat", "awk", "sed", "grep", "wc", "cut",
                     "sort", "uniq", "tee")

PIPE_RE = re.compile(r"\|\s*(?P<consumer>" + "|".join(MASKING_CONSUMERS) + r")\b")

# Status consulted on the SAME line.
STATUS_SAME_LINE = re.compile(r"(\|\||&&|^\s*if\b|\$\(|\$\?)")

# Status consulted on a LATER line: `$?`, `PIPESTATUS`, or `if [ ... ]` on the
# pipeline's result. This is the form that fooled the first build.
STATUS_NEXT_LINE = re.compile(r"(\$\?|PIPESTATUS)")

# Patterns that make a pipeline safe.
SAFE_PIPE_FAIL = re.compile(r"set\s+-(?:\w*)?o\s+pipefail")
SAFE_CAPTURE = re.compile(r"\b\w+\s*=\s*\"?\$\(")          # OUT="$(cmd ...)"
SAFE_VAR_PIPE = re.compile(r"\$\{?\w+\}?\s*\|\s*")         # echo "$OUT" | tail
SAFE_ECHO = re.compile(r"^\s*(echo|printf)\s")
IS_COMMENT = re.compile(r"^\s*#")

LOOKAHEAD = 3  # how many following lines count as "consuming" the status


def strip_trailing_comment(line: str) -> str:
    out, in_s, in_d, prev = [], False, False, ""
    for ch in line:
        if ch == "'" and not in_d and prev != "\\":
            in_s = not in_s
        elif ch == '"' and not in_s and prev != "\\":
            in_d = not in_d
        elif ch == "#" and not in_s and not in_d:
            break
        out.append(ch)
        prev = ch
    return "".join(out).rstrip()


def scan_file(path: str, verbose: bool = False):
    findings = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError as e:
        print(f"WARN: cannot read {path}: {e}", file=sys.stderr)
        return findings

    pipefail_armed = False
    for i, raw in enumerate(lines):
        if SAFE_PIPE_FAIL.search(raw):
            pipefail_armed = True

        code = strip_trailing_comment(raw)
        if not code.strip() or IS_COMMENT.match(raw):
            continue
        if not PIPE_RE.search(code):
            continue

        if pipefail_armed:
            if verbose:
                print(f"  skip (pipefail) {path}:{i+1}: {code.strip()[:80]}")
            continue
        if SAFE_CAPTURE.search(code) or SAFE_VAR_PIPE.search(code) or SAFE_ECHO.match(code):
            if verbose:
                print(f"  skip (safe pattern) {path}:{i+1}: {code.strip()[:80]}")
            continue

        # (a) same line
        if STATUS_SAME_LINE.search(code):
            findings.append((path, i + 1, code.strip(), "same-line status use"))
            continue

        # (b) status consumed in the following lines — the bug that fooled v1
        for j in range(i + 1, min(i + 1 + LOOKAHEAD, len(lines))):
            nxt = strip_trailing_comment(lines[j])
            if not nxt.strip():
                continue
            if STATUS_NEXT_LINE.search(nxt):
                findings.append(
                    (path, i + 1,
                     f"{code.strip()[:70]}   [status read at line {j+1}: {nxt.strip()[:44]}]",
                     "next-line $? use")
                )
                break
            # Any non-blank, non-status line ends the window.
            if not nxt.strip().startswith(("#", "fi", "else", "done", "esac")):
                break
        else:
            if verbose:
                print(f"  note (display-only) {path}:{i+1}: {code.strip()[:80]}")

    return findings


def iter_targets(paths):
    exts = (".sh", ".bash", ".zsh")
    for p in paths:
        if os.path.isfile(p):
            yield p
        elif os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                dirs[:] = [d for d in dirs
                           if d not in (".git", "node_modules", "dist", ".astro")]
                for f in files:
                    if f.endswith(exts):
                        yield os.path.join(root, f)
        else:
            print(f"WARN: no such path: {p}", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()
    paths = args.paths or [os.getcwd()]

    scanned, findings = 0, []
    for f in iter_targets(paths):
        scanned += 1
        findings.extend(scan_file(f, args.verbose))

    if scanned == 0:
        print("GUARD-EXIT-CODES FAIL: scanned 0 shell scripts — no evidence, "
              "refusing to pass", file=sys.stderr)
        return 2

    if findings:
        print(f"GUARD-EXIT-CODES: {len(findings)} pipeline(s) whose exit status is "
              f"discarded (budget 0)", file=sys.stderr)
        for f, ln, txt, why in findings:
            print(f"  {f}:{ln}  [{why}]\n      {txt[:110]}", file=sys.stderr)
        print('\nFIX: capture the status BEFORE piping:\n'
              '  OUT="$(cmd 2>&1)" || { echo "$OUT" | tail -20; exit 1; }\n'
              'or arm `set -o pipefail` at the top of the script.', file=sys.stderr)
        return 1

    print(f"GUARD-EXIT-CODES OK: scanned {scanned} shell script(s), "
          f"0 discarded exit statuses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
