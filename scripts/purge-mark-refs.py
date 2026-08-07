#!/usr/bin/env python3
"""
purge-mark-refs.py — Idempotent bulk cleaner for first-person "Mark" references.

Usage:
  python scripts/purge-mark-refs.py --dry-run    # preview changes
  python scripts/purge-mark-refs.py --apply      # write changes (creates .bak files)
"""

import json
import re
import sys
import shutil
from pathlib import Path
from typing import Dict, Any, List, Tuple

# Same forbidden patterns as validator
FORBIDDEN_PATTERNS = [
    (re.compile(r"\b(?:mark'?s?|my|me)\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister|uncle|aunt|nephew|niece)\b", re.IGNORECASE),
     "first-person relational"),
    (re.compile(r"\bI\s+am\s+(?:mark'?s?|his|her)\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister)\b", re.IGNORECASE),
     "I am Mark's cousin"),
    (re.compile(r"making\s+(?:him|her|them)\s+mark'?s?\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister)\b", re.IGNORECASE),
     "making someone Mark's cousin"),
]

# Canonical replacements — order matters (more specific first)

# Patterns for body fields (body_markdown, body_stripped, summary, biography, description, role)
BODY_REPLACEMENTS = [
    # Inline in body: "making her Mark's cousin..." → remove
    (re.compile(r"making her Mark's (adopted\s+)?cousin\s+and\s+sister\s+to", re.IGNORECASE),
     lambda m: "sister to"),
    (re.compile(r"making her Mark's (adopted\s+)?cousin\.", re.IGNORECASE),
     lambda m: "."),
    (re.compile(r",\s*making\s+(?:him|her|them)\s+Mark'?s?\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister|uncle|aunt|nephew|niece)\b", re.IGNORECASE),
     lambda m: ""),
    (re.compile(r"\bmaking\s+(?:him|her|them)\s+Mark'?s?\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister|uncle|aunt|nephew|niece)\b", re.IGNORECASE),
     lambda m: ""),
    # Inline relational phrases: "Mark's step-brother through Tim" → "step-brother"
    (re.compile(r"\bMark'?s?\s+(step[-\s]?brother|step[-\s]?sister|uncle|aunt|nephew|niece|adopted\s+cousin)\b", re.IGNORECASE),
     lambda m: m.group(1)),
    # "Mark's uncle" in body inline → "Uncle" (capitalized for title case after "Role:")
    (re.compile(r"\*\*Role:\*\* uncle —", re.IGNORECASE),
     lambda m: "**Role:** Uncle —"),
    (re.compile(r"\*\*Role:\*\* uncle$", re.IGNORECASE),
     lambda m: "**Role:** Uncle"),
    (re.compile(r"Role: uncle —", re.IGNORECASE),
     lambda m: "Role: Uncle —"),
    (re.compile(r"Role: uncle$", re.IGNORECASE),
     lambda m: "Role: Uncle"),
    # "Step-brother to Mark and Amy/Tim" → "Step-brother to Tim and Amy through Sheryle's marriage to Tim"
    (re.compile(r"Step-brother to Mark and (Amy|Tim)", re.IGNORECASE),
     lambda m: f"Step-brother to {m.group(1)} and through Sheryle's marriage to Tim"),
    # "Mark & Kylie's son/daughter" → "Son/Daughter of Mark and Kylie"
    (re.compile(r"\bMark\s*&\s*Kylie's\s+(son|daughter)\b", re.IGNORECASE),
     lambda m: f"{m.group(1).capitalize()} of Mark and Kylie"),
    # "Mark's father/mother/grandfather/grandmother/etc" in body text (not names) → generic
    # These appear in markdown body text, not as names — match word boundaries carefully
    # Include qualifiers: eldest, youngest, paternal, maternal, biological, adopted, step, half-
    (re.compile(r"(?<![A-Z][a-z])\bMark'?s?\s+(?:eldest|youngest|paternal|maternal|biological|adopted|step|half-)?\s*(father|mother|grandfather|grandmother|great-grandfather|great-grandmother|great-great-grandfather|great-great-grandmother|wife|husband|son|daughter|brother|sister|uncle|aunt|nephew|niece|cousin|stepfather|stepmother|stepbrother|stepsister|half-brother|half-sister)\b", re.IGNORECASE),
     lambda m: m.group(1).capitalize()),
    # "one of Mark's uncles/aunts" in narrative → "one of Tim's uncles/aunts" or generic
    (re.compile(r"\bone of Mark'?s?\s+(uncles|aunts|brothers|sisters|cousins)\b", re.IGNORECASE),
     lambda m: f"one of Tim's {m.group(1)}"),
    # "Grandfather of Mark Telfer" → "Grandfather of Mark" (preserve the name reference for clarity)
    (re.compile(r"\b(Grandfather|Grandmother|Father|Mother)\s+of\s+Mark\s+Telfer\b", re.IGNORECASE),
     lambda m: f"{m.group(1)} of Mark"),
]

# Patterns for roles[] array (short labels, line-by-line)
ROLES_REPLACEMENTS = [
    # "Mark's cousin — son/daughter of X" → "Son/Daughter of X"
    (re.compile(r"^Mark's cousin\s*[—-]\s*(son|daughter)\s+of\s+(.+)$", re.IGNORECASE),
     lambda m: f"{m.group(1).capitalize()} of {m.group(2).strip()}"),
    (re.compile(r"^Mark's cousin\s*$", re.IGNORECASE),
     lambda m: "Cousin (lineage unspecified)"),
    (re.compile(r"^Mark's adopted cousin\s*$", re.IGNORECASE),
     lambda m: "Adopted cousin (lineage unspecified)"),
    (re.compile(r"^Cousin\s*\(\s*adopted\s+daughter\s+of\s+(.+?)\s*\)$", re.IGNORECASE),
     lambda m: f"Adopted daughter of {m.group(1).strip()}"),
    (re.compile(r"^Adopted\s+cousin\s*\(\s*(.+?)\s*'?s?\s+daughter\s*\)$", re.IGNORECASE),
     lambda m: f"Adopted daughter of {m.group(1).strip()}"),
    # "Mark's step-brother/uncle/step-sister/etc" → generic
    (re.compile(r"^Mark's\s+step[-\s]?brother\s*[:—-]?\s*(.+)?$", re.IGNORECASE),
     lambda m: f"Step-brother" + (f" ({m.group(1).strip()})" if m.group(1) else "")),
    # Mid-string redundant clause (role already states Step-brother):
    # "Step-brother (Sheryle's son, Mark's step-brother through Tim)" → 
    # "Step-brother (Sheryle's son, through Tim's marriage)"
    (re.compile(r",\s*Mark'?s?\s+(?:step[-\s]?brother|step[-\s]?sister)\s+through\s+(.+?)\s*\)$", re.IGNORECASE),
     lambda m: f", through {m.group(1).capitalize()}'s marriage)"),
    (re.compile(r"^Mark's\s+step[-\s]?sister\s*[:—-]?\s*(.+)?$", re.IGNORECASE),
     lambda m: f"Step-sister" + (f" ({m.group(1).strip()})" if m.group(1) else "")),
    (re.compile(r"^Mark's\s+uncle\s*[:—-]?\s*(.+)?$", re.IGNORECASE),
     lambda m: f"Uncle" + (f" ({m.group(1).strip()})" if m.group(1) else "")),
    (re.compile(r"^Mark's\s+aunt\s*[:—-]?\s*(.+)?$", re.IGNORECASE),
     lambda m: f"Aunt" + (f" ({m.group(1).strip()})" if m.group(1) else "")),
    (re.compile(r"^Mark's\s+nephew\s*[:—-]?\s*(.+)?$", re.IGNORECASE),
     lambda m: f"Nephew" + (f" ({m.group(1).strip()})" if m.group(1) else "")),
    (re.compile(r"^Mark's\s+niece\s*[:—-]?\s*(.+)?$", re.IGNORECASE),
     lambda m: f"Niece" + (f" ({m.group(1).strip()})" if m.group(1) else "")),
    # Generic catch-all for "Mark's [relationship]" in roles[] — only matches at START of string
    (re.compile(r"^Mark'?s?\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*)\b"),
     lambda m: m.group(1)),
    (re.compile(r"^Mark'?s?\s+([a-z]+(?:[\s-][a-z]+)*)\b", re.IGNORECASE),
     lambda m: m.group(1).capitalize()),
    # "— Mark's [relationship]" or "; Mark's [relationship]" anywhere in roles
    (re.compile(r"[—;]\s*Mark'?s?\s+(?:eldest|youngest|paternal|maternal|biological|adopted|step|half-)?\s*(father|mother|grandfather|grandmother|great-grandfather|great-grandmother|great-great-grandfather|great-great-grandmother|wife|husband|son|daughter|brother|sister|uncle|aunt|nephew|niece|cousin|stepfather|stepmother|stepbrother|stepsister|half-brother|half-sister)\b", re.IGNORECASE),
     lambda m: f" — {m.group(1).capitalize()}"),
    (re.compile(r"[—;]\s*Mark'?s?\s+([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)*)\b"),
     lambda m: f" — {m.group(1)}"),
    (re.compile(r"[—;]\s*Mark'?s?\s+([a-z]+(?:[\s-][a-z]+)*)\b", re.IGNORECASE),
     lambda m: f" — {m.group(1).capitalize()}"),
]

# Fields that get BODY_REPLACEMENTS + ROLES_REPLACEMENTS
BODY_FIELDS = {"body_markdown", "body_stripped", "summary", "biography", "description", "role"}
# Fields that get only ROLES_REPLACEMENTS
ROLES_FIELDS = {"roles"}
# Fields that should NOT be modified at all (proper names, identifiers)
PROTECTED_FIELDS = {"display_name", "title", "slug", "id", "first_name", "middle_name", "last_name"}

APPLY = False
DRY_RUN = False


def clean_string(s: str, replacements: List[Tuple]) -> Tuple[str, List[str]]:
    """Apply all replacements to a string. Returns (cleaned, list_of_changes)."""
    original = s
    changes = []
    for pattern, repl in replacements:
        new_s = pattern.sub(repl, s)
        if new_s != s:
            changes.append(f"  {s[:80]}... → {new_s[:80]}...")
            s = new_s
    return s, changes


def clean_person(person: Dict[str, Any], path: str) -> Tuple[Dict[str, Any], List[str]]:
    """Clean all target fields in a person object."""
    changes = []
    for key, value in person.items():
        if key in PROTECTED_FIELDS:
            continue  # Never modify protected fields
        if key in BODY_FIELDS:
            replacements = BODY_REPLACEMENTS + ROLES_REPLACEMENTS
        elif key in ROLES_FIELDS:
            replacements = ROLES_REPLACEMENTS
        else:
            continue  # Skip unknown fields
        if isinstance(value, str):
            cleaned, field_changes = clean_string(value, replacements)
            if field_changes:
                person[key] = cleaned
                changes.extend([f"  {key}: {fc}" for fc in field_changes])
        elif isinstance(value, list):
            new_list = []
            for i, item in enumerate(value):
                if isinstance(item, str):
                    cleaned, item_changes = clean_string(item, replacements)
                    if item_changes:
                        changes.extend([f"  {key}[{i}]: {ic}" for ic in item_changes])
                    new_list.append(cleaned)
                else:
                    new_list.append(item)
            if new_list != value:
                person[key] = new_list
    return person, changes


def process_file(filepath: Path) -> Tuple[bool, List[str]]:
    """Process a single JSON file. Returns (changed, all_changes)."""
    try:
        content = filepath.read_text(encoding="utf-8")
        data = json.loads(content)
    except Exception as e:
        return False, [f"ERROR reading {filepath}: {e}"]

    all_changes = []
    changed = False

    if isinstance(data, list):
        people = data
        for i, person in enumerate(people):
            if isinstance(person, dict):
                cleaned_person, changes = clean_person(person, str(filepath))
                if changes:
                    changed = True
                    all_changes.append(f"  Person[{i}] ({person.get('id', person.get('slug', 'unknown'))}):")
                    all_changes.extend(changes)
    elif isinstance(data, dict) and "people" in data:
        for i, person in enumerate(data["people"]):
            if isinstance(person, dict):
                cleaned_person, changes = clean_person(person, str(filepath))
                if changes:
                    changed = True
                    all_changes.append(f"  Person[{i}] ({person.get('id', person.get('slug', 'unknown'))}):")
                    all_changes.extend(changes)
    else:
        # Single person object
        if isinstance(data, dict):
            cleaned_person, changes = clean_person(data, str(filepath))
            if changes:
                changed = True
                all_changes.append(f"  Root object:")
                all_changes.extend(changes)

    if changed and APPLY:
        # Backup
        backup = filepath.with_suffix(filepath.suffix + ".bak")
        shutil.copy2(filepath, backup)
        # Write
        filepath.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        all_changes.append(f"  → Written (backup: {backup.name})")

    return changed, all_changes


def main():
    global APPLY, DRY_RUN
    args = sys.argv[1:]
    if "--apply" in args:
        APPLY = True
    if "--dry-run" in args:
        DRY_RUN = True
    if not APPLY and not DRY_RUN:
        print("Usage: purge-mark-refs.py --dry-run | --apply", file=sys.stderr)
        sys.exit(2)

    root = Path.cwd()
    data_dir = root / "src" / "data"
    if not data_dir.exists():
        print(f"Data directory not found: {data_dir}", file=sys.stderr)
        sys.exit(2)

    files = list(data_dir.rglob("*.json")) + list(data_dir.rglob("*.jsonc"))
    print(f"Scanning {len(files)} files...\n")

    total_changed = 0
    for f in sorted(files):
        changed, changes = process_file(f)
        if changes:
            total_changed += 1
            rel = f.relative_to(root)
            print(f"{rel}: {'MODIFIED' if changed else 'check needed'}")
            for c in changes:
                print(c)
            print()

    print(f"Summary: {total_changed} file(s) with changes")
    if DRY_RUN:
        print("DRY RUN — no files modified. Re-run with --apply to write changes.")


if __name__ == "__main__":
    main()