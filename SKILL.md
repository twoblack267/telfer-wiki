---
name: telfer-wiki-sanitize
version: 1.0.0
description: |
  Purge all first-person "Mark" references from Telfer Wiki data files and
  install a permanent structural guard so they can never re-enter the data layer.
category: data-quality
tags:
  - telfer-wiki
  - genealogy
  - data-cleaning
  - pre-commit
  - validation
---

# Telfer Wiki — First-Person Reference Sanitizer

## Problem
Human editors (and LLMs) keep leaking first-person relational language into the
canonical data files:
- "Mark's cousin", "Mark's adopted cousin"
- "making her Mark's cousin", "my step-brother"
- Any phrasing that frames a person *relative to Mark* instead of *relative to
  their actual parent/lineage*

These leak into `roles[]`, `body_markdown`, `body_stripped`, `summary`,
`biography`, and top-level `role`/`title` fields — then propagate to the public
site.

## Solution: Two-Layer Defense

### Layer 1 — One-Time Purge (`/clean-mark-refs`)
Scrub every existing occurrence across **all** data files.

### Layer 2 — Permanent Structural Guard
Three mechanisms that make re-entry **impossible** without deliberate bypass:

1. **JSON Schema** — `display_name`/`roles[]`/`body_*` fields constrained by
   `pattern` regex that rejects `Mark'?s?\s+(cousin|step.?brother|uncle|aunt)`,
   `my\s+(cousin|step)`, `making\s+(him|her)\s+Mark'?s?`.

2. **Pre-commit Hook** — Runs `validate-no-mark-refs.py` on staged files.
   Fails the commit with file:line:match context if any forbidden pattern
   appears in `src/data/**/*.json*`.

3. **CI Gate** — Same validator runs in GitHub Actions on every PR. Merge
   blocked until clean.

---

## Forbidden Patterns (Regex)

```regex
(?i)\b(?:mark'?s?|my|me|I\s+am)\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister|uncle|aunt|nephew|niece)\b
(?i)making\s+(?:him|her|them)\s+mark'?s?
(?i)mark'?s?\s+(?:adopted\s+)?(?:cousin|step[-\s]?brother|step[-\s]?sister)
```

**Allowed (canonical) replacements:**
- `Son of [Father]` / `Daughter of [Father]`
- `Adopted son of [Parent]` / `Adopted daughter of [Parent]`
- `Step-son of [Parent]` / `Step-daughter of [Parent]`
- `Brother of [Sibling]` / `Sister of [Sibling]`
- `Father of [Child]` / `Mother of [Child]`

---

## Files This Skill Manages

| Path | Purpose |
|------|---------|
| `schemas/person.schema.json` | JSON Schema with `pattern` constraints on string fields |
| `scripts/validate-no-mark-refs.py` | Standalone validator (CLI + pre-commit entry point) |
| `.pre-commit-config.yaml` | Hook registration (local repo) |
| `.github/workflows/validate-data.yml` | CI gate |
| `scripts/purge-mark-refs.py` | One-time bulk cleaner (idempotent, dry-run by default) |

---

## Usage

### One-time purge (run once, or anytime you suspect leakage)
```bash
cd /home/mark/telfer-wiki
python scripts/purge-mark-refs.py --apply   # --dry-run first to preview
```

### Install structural guard (run once)
```bash
cd /home/mark/telfer-wiki
pre-commit install --hook-type pre-commit
# CI workflow activates automatically on next push
```

### Manual validation (anytime)
```bash
python scripts/validate-no-mark-refs.py src/data/
# Exit 0 = clean, Exit 1 = violations printed with file:line:match
```

---

## Validator Behaviour

- **Scope:** `src/data/**/*.json`, `src/data/**/*.jsonc`, `src/data/**/*.md`
- **Fields checked:** `roles[]`, `body_markdown`, `body_stripped`, `summary`,
  `biography`, `description`, `role`, `title`, `display_name`, `slug`
- **Output:** `file:line:field → matched_text` (grep-style, machine-parseable)
- **Exit codes:** 0 = clean, 1 = violations, 2 = I/O or schema error

---

## Schema Constraint Example (person.schema.json snippet)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^(?!.*(?:mark'?s?|my|me|I am).*(?:cousin|step|uncle|aunt|nephew|niece)).+$"
      }
    },
    "body_markdown": {
      "type": "string",
      "pattern": "^(?!.*making.*mark'?s?(?:\\s+(?:adopted\\s+)?(?:cousin|step))).*$"
    },
    "body_stripped": { "type": "string", "pattern": "^(?!.*mark'?s?\\s+(?:adopted\\s+)?(?:cousin|step)).*$" }
  },
  "additionalProperties": true
}
```

---

## Slash Command Alias

After installing this skill, you can run:

- `/clean-mark-refs` → executes `purge-mark-refs.py --apply`
- `/validate-mark-refs` → executes `validate-no-mark-refs.py src/data/`
- `/install-mark-guard` → installs pre-commit hook + verifies CI workflow exists

---

## Maintenance Notes

- **Adding new forbidden terms:** Update the `FORBIDDEN_PATTERNS` list in
  `validate-no-mark-refs.py` AND the `pattern` regex in `person.schema.json`.
  Keep them in sync.
- **False positives:** If a legitimate name contains "Mark" (e.g., "Markham"),
  the word-boundary `\b` guards prevent matches. Test with `--dry-run`.
- **Schema validation:** Run `python -m jsonschema -i src/data/people.json schemas/person.schema.json`
  to validate the whole dataset against the schema independently.

---

## Quick Test After Install

```bash
# Should pass (clean)
echo '{"roles": ["Son of Grantley Keith Telfer"]}' | python scripts/validate-no-mark-refs.py /dev/stdin

# Should fail with line/column
echo '{"roles": ["Mark\\'s cousin"]}' | python scripts/validate-no-mark-refs.py /dev/stdin
```