#!/usr/bin/env python3
"""
validate-no-mark-refs.py — Detect first-person "Mark" references in Telfer Wiki data files.

Exit codes:
  0 = clean
  1 = violations found
  2 = I/O or schema error
"""

import json
import re
import sys
from pathlib import Path
from typing import Iterator, Tuple

# ─── Forbidden Patterns ───
# Each: (compiled_regex, human_description)
FORBIDDEN_PATTERNS = [
    # "Mark's cousin", "Mark's adopted cousin", "Mark's step-brother", etc.
    (re.compile(r"\b(?:mark'?s?|my|me)\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister|uncle|aunt|nephew|niece)\b", re.IGNORECASE),
     "first-person relational (Mark's/my/me + cousin/step-brother/etc.)"),
    # "I am Mark's cousin", "I am his cousin"
    (re.compile(r"\bI\s+am\s+(?:mark'?s?|his|her)\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister)\b", re.IGNORECASE),
     "first-person 'I am Mark's cousin'"),
    # "making her Mark's cousin", "making him Mark's adopted cousin"
    (re.compile(r"making\s+(?:him|her|them)\s+mark'?s?\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister)\b", re.IGNORECASE),
     "making someone Mark's cousin"),
    # "Mark's great-grandmother", "Mark's great-great-grandfather", etc.
    (re.compile(r"\bmark'?s?\s+(?:great[- ]?){0,2}grand(?:mother|father|parent|son|daughter|child|uncle|aunt)\b", re.IGNORECASE),
     "Mark's great-grandparent/aunt/uncle/etc"),
    # "Mark's wife/husband/mother/father/sister/brother/son/daughter"
    (re.compile(r"\bmark'?s?\s+(?:wife|husband|mother|father|sister|brother|son|daughter|half[- ]?brother|half[- ]?sister|step[- ]?mother|step[- ]?father|grandmother|grandfather|grandparent)\b", re.IGNORECASE),
     "Mark's nuclear/extended family role"),
    # "Mark's niece/nephew" (already partly covered but explicit)
    (re.compile(r"\bmark'?s?\s+(?:niece|nephew|great[- ]?niece|great[- ]?nephew)\b", re.IGNORECASE),
     "Mark's niece/nephew"),
    # Generic "Mark's [role]" where role indicates relationship to Mark
    (re.compile(r"\bmark'?s?\s+(?:cousin|uncle|aunt|great[- ]?cousin|removed)\b", re.IGNORECASE),
     "Mark's generic family role"),
]

# Fields to scan in each person object
TARGET_FIELDS = {
    "roles", "body_markdown", "body_stripped", "summary",
    "biography", "description", "role", "title", "display_name", "slug"
}


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

    # For line numbers, we need to parse with line tracking
    # Simpler: scan line-by-line for patterns, but also check JSON fields
    lines = content.splitlines()
    for line_no, line in enumerate(lines, 1):
        for pattern, desc in FORBIDDEN_PATTERNS:
            for match in pattern.finditer(line):
                violations.append((str(path), line_no, "raw_line", match.group(0)))

    # Also parse JSON for field-specific matches
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
                for pattern, desc in FORBIDDEN_PATTERNS:
                    for match in pattern.finditer(value):
                        violations.append((str(path), 0, field_path, match.group(0)))
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

    if all_violations:
        for file, line, field, match in all_violations:
            loc = f"{file}:{line}" if line else f"{file}:{field}"
            print(f"{loc} → {match}")
        sys.exit(1)
    else:
        print("✓ No forbidden patterns found")
        sys.exit(0)


if __name__ == "__main__":
    main()