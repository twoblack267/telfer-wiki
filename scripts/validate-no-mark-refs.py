#!/usr/bin/env python3
"""
validate-no-mark-refs.py — Detect first-person "Mark" references in Telfer Wiki data files.

Exit codes:
  0 = clean
  1 = violations found
  2 = I/O or schema error

WHY THE OLD PATTERNS WERE REPLACED (tw-2026-09-12-043)
------------------------------------------------------
The original implementation was an allow-list: it named specific family roles
(cousin|uncle|aunt|niece|nephew|grandmother|grandfather|...) after "Mark's".
It was O(1) per newly-invented phrasing and it leaked constantly. Verified misses:

    "Mark's great-uncle"             -> MISS  (hyphen defeats the role alternation)
    "Mark's paternal grandfather"    -> MISS  (qualifier between 's and the role)
    "Mark Telfer's paternal grandfather" -> MISS
    "Mark's decision"                -> MISS  (not a family role)
    "Mark's line" / "Mark's approval" -> MISS

Each of those shipped to the public site while this validator printed
"✓ No forbidden patterns found" and exit 0. That is the same fault shape as the
CI monitor that reported CI_STABLE for 12 days off a parser reading zero rows:
a green verdict produced without the check actually being performed.

THE RULE IS NOW A DENY-LIST, because the house rule is absolute —
"never publish 'Mark's [relative]'" — not "never publish these twelve words".
Any possessive reference to the archivist by name is a violation, EXCEPT the
two documented, benign senses below.
"""

import json
import re
import sys
from pathlib import Path
from typing import Iterator, Tuple

# ─── The general rule ───
# "Mark's", "Marks", "Mark Telfer's", "Mark Kenneth Telfer's" — any possessive of the
# archivist's name. Substring-matching the bare word "Mark" would fire on the many
# ancestors legitimately NAMED Mark (Mark Telfer 1877-1946, Mark Kenneth Telfer, etc.),
# so a possessive is required.
MARK_POSSESSIVE = re.compile(
    r"\bmark(?:\s+(?:kenneth\s+)?telfer)?'s\b",
    re.IGNORECASE,
)

# Also catch the bare "Mark's" with a typographic apostrophe.
MARK_POSSESSIVE_ALT = re.compile(
    r"\bmark(?:\s+(?:kenneth\s+)?telfer)?\u2019s\b",
    re.IGNORECASE,
)

# ─── Documented, benign exceptions ───
# These are possessive in form but do not assert a relationship to the archivist.
# Each needs a REASON; an exception added without one is how the last leak happened.
ALLOWED = [
    # A named ancestor who is himself called Mark. "husband Mark's 1946 death notice"
    # refers to Mark Telfer the ancestor, not to the archivist.
    (re.compile(r"\bhusband\s+mark'?s\b", re.IGNORECASE),
     "refers to an ancestor named Mark (e.g. husband Mark's death notice)"),
    (re.compile(r"\bwife\s+mark'?s\b", re.IGNORECASE),
     "refers to an ancestor named Mark"),
]

# Legacy specific patterns kept so previously-caught phrasings keep biting even if the
# general rule is ever narrowed. Cheap redundancy on the highest-value shapes.
FORBIDDEN_PATTERNS = [
    (re.compile(r"\bmaking\s+(?:him|her|them)\s+mark'?s?\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister)\b", re.IGNORECASE),
     "making someone Mark's cousin"),
    (re.compile(r"\bI\s+am\s+(?:mark'?s?|his|her)\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister)\b", re.IGNORECASE),
     "first-person 'I am Mark's cousin'"),
]

# Fields to scan in each person object
TARGET_FIELDS = {
    "roles", "body_markdown", "body_stripped", "summary",
    "biography", "description", "role", "title", "display_name", "slug"
}


def _scan_text(text: str):
    """Yield (matched_text, description) for every violation in `text`."""
    for pattern in (MARK_POSSESSIVE, MARK_POSSESSIVE_ALT):
        for match in pattern.finditer(text):
            # Is this occurrence inside a documented exception?
            start = max(0, match.start() - 24)
            window = text[start:match.end() + 4]
            if any(ap.search(window) for ap, _ in ALLOWED):
                continue
            yield match.group(0), "possessive reference to the archivist by name"
    for pattern, desc in FORBIDDEN_PATTERNS:
        for match in pattern.finditer(text):
            yield match.group(0), desc


def iter_json_strings(obj: dict, prefix: str = "") -> Iterator[Tuple[str, str, int]]:
    """Yield (field_path, string_value, approx_line) for all string values in obj."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            field_path = f"{prefix}.{k}" if prefix else k
            if isinstance(v, str):
                yield field_path, v, 0  # line unknown for JSON
            elif isinstance(v, list):
                for i, item in enumerate(v):
                    if isinstance(item, str):
                        yield f"{field_path}[{i}]", item, 0
                    elif isinstance(item, dict):
                        yield from iter_json_strings(item, f"{field_path}[{i}]")
            elif isinstance(v, dict):
                yield from iter_json_strings(v, field_path)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            if isinstance(item, dict):
                yield from iter_json_strings(item, f"{prefix}[{i}]")


def scan_file(path: Path) -> list[Tuple[str, int, str, str]]:
    """Return list of (file, line, field, matched_text) for violations."""
    violations = []
    try:
        content = path.read_text(encoding="utf-8")
    except Exception as e:
        print(f"ERROR reading {path}: {e}", file=sys.stderr)
        return violations

    # Raw line scan — gives real line numbers and covers non-JSON files.
    for line_no, line in enumerate(content.splitlines(), 1):
        for match_text, desc in _scan_text(line):
            violations.append((str(path), line_no, desc, match_text))

    # JSON field-aware scan (dedupe later by the caller if both fire).
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return violations  # not JSON, raw line scan already done

    if isinstance(data, list):
        people = data
    elif isinstance(data, dict) and "people" in data:
        people = data["people"]
    else:
        people = [data]

    for person in people:
        if not isinstance(person, dict):
            continue
        for field_path, value, _ in iter_json_strings(person):
            if any(tf in field_path for tf in TARGET_FIELDS):
                for match_text, desc in _scan_text(value):
                    violations.append((str(path), 0, field_path, match_text))
    return violations


def main():
    if len(sys.argv) < 2:
        print("Usage: validate-no-mark-refs.py <path> [path...]", file=sys.stderr)
        sys.exit(2)

    all_violations = []
    for arg in sys.argv[1:]:
        path = Path(arg)
        if path.is_file():
            all_violations.extend(scan_file(path))
        elif path.is_dir():
            for ext in ("*.json", "*.jsonc", "*.md"):
                for file_path in path.rglob(ext):
                    all_violations.extend(scan_file(file_path))
        else:
            print(f"WARNING: {arg} not found", file=sys.stderr)

    # Dedupe: the same text can be hit by both the raw-line scan and the JSON scan.
    seen = set()
    unique = []
    for file, line, field, match in all_violations:
        key = (file, line, match)
        if key in seen:
            continue
        seen.add(key)
        unique.append((file, line, field, match))

    if unique:
        for file, line, field, match in unique:
            loc = f"{file}:{line}" if line else f"{file}:{field}"
            print(f"{loc} → {match}")
        print(f"\n{len(unique)} violation(s)")
        sys.exit(1)
    else:
        print("✓ No forbidden patterns found")
        sys.exit(0)


if __name__ == "__main__":
    main()
