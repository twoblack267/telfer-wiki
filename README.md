# telfer-wiki-sanitize — Quick Start

## 1. Copy this entire folder into your telfer-wiki repo

```bash
cp -r /home/mark/telfer-wiki-sanitize/* /home/mark/telfer-wiki/
```

## 2. Install dependencies

```bash
cd /home/mark/telfer-wiki
pip install jsonschema pre-commit
```

## 3. Run the one-time purge (dry-run first)

```bash
python scripts/purge-mark-refs.py --dry-run
python scripts/purge-mark-refs.py --apply
```

## 4. Install the structural guard (pre-commit hook)

```bash
pre-commit install --hook-type pre-commit
```

## 5. Verify CI workflow is in place

The `.github/workflows/validate-data.yml` will run automatically on next push.

## 6. Test it works

```bash
# Should pass
python scripts/validate-no-mark-refs.py src/data/

# Should fail
echo '{"roles": ["Mark'"'"'s cousin"]}' | python scripts/validate-no-mark-refs.py /dev/stdin
```

## Slash Command Aliases (after skill is loaded in Hermes)

| Command | Action |
|---------|--------|
| `/clean-mark-refs` | Run `purge-mark-refs.py --apply` |
| `/validate-mark-refs` | Run `validate-no-mark-refs.py src/data/` |
| `/install-mark-guard` | Install pre-commit hook + verify CI |

---

## File Layout After Install

```
telfer-wiki/
├── schemas/
│   └── person.schema.json          # JSON Schema with pattern constraints
├── scripts/
│   ├── validate-no-mark-refs.py    # Validator (CLI + pre-commit + CI)
│   └── purge-mark-refs.py          # Bulk cleaner (--dry-run / --apply)
├── .pre-commit-config.yaml         # Pre-commit hook registration
├── .github/workflows/
│   └── validate-data.yml           # CI gate
└── src/data/
    ├── people.json                 # Master data (validated)
    └── people.public.json          # Public variant (validated)
```

---

## How the Guard Works

1. **Pre-commit** — Runs `validate-no-mark-refs.py` on staged files. Commit fails if any forbidden pattern found.

2. **CI (GitHub Actions)** — Same validator runs on every PR. Merge blocked until clean.

3. **JSON Schema** — `person.schema.json` uses `pattern` constraints on string fields. `jsonschema` CLI validates entire dataset.

4. **Purge Script** — Idempotent, creates `.bak` files, updates all three fields (`roles`, `body_markdown`, `body_stripped`) in sync.

---

## Forbidden Patterns Caught

| Pattern | Example |
|---------|---------|
| `Mark's cousin` | `"Mark's cousin — son of Grantley"` |
| `Mark's adopted cousin` | `"making her Mark's adopted cousin"` |
| `my cousin` | `"my step-brother"` |
| `I am Mark's cousin` | `"I am his cousin"` |
| `making him/her Mark's cousin` | `"making her Mark's cousin"` |

---

## Canonical Replacements Applied by Purge

| Before | After |
|--------|-------|
| `"Mark's cousin — son of Grantley Keith Telfer"` | `"Son of Grantley Keith Telfer"` |
| `"Mark's cousin — daughter of Grantley Keith Telfer"` | `"Daughter of Grantley Keith Telfer"` |
| `"Cousin (adopted daughter of John Telfer)"` | `"Adopted daughter of John Telfer"` |
| `"Adopted cousin (John's daughter)"` | `"Adopted daughter of John Telfer"` |
| `"making her Mark's cousin and sister to"` | `"sister to"` |
| `", making her Mark's adopted cousin."` | `"."` |

---

## Maintenance

**Add new forbidden term:**
1. Add regex to `FORBIDDEN_PATTERNS` in `validate-no-mark-refs.py`
2. Add corresponding `pattern` constraint in `schemas/person.schema.json`
3. Add replacement rule to `REPLACEMENTS` in `purge-mark-refs.py`
4. Test: `python scripts/validate-no-mark-refs.py src/data/`

**False positive (e.g., "Markham"):**
- Word boundaries `\b` prevent matching inside words
- Test with `--dry-run` to verify