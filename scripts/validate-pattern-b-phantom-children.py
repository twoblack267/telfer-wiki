#!/usr/bin/env python3
"""
validate-pattern-b-phantom-children.py

PATTERN B — a woman placed in the MOTHER slot creates a PHANTOM CHILD.

The shape: a person whose MOTHER's surname equals their OWN surname, while their
FATHER's surname differs. Under the naming convention this archive follows, that is
almost always a slot error rather than a real matrilineal case: the "mother" named is
in fact a same-surname relative (sibling, aunt, cousin) or the child themselves, and
the reference invents a person who never existed.

Written 2026-09-13 to satisfy card tw-2026-09-12-061 (3rd occurrence of this shape).

It reads the VAULT as source of truth. It does NOT read or write people.json.

Exit 0 = no violations. Exit 1 = violations found (BUILD GATE).
"""
import os, re, sys, glob

VAULT = os.path.join(os.path.expanduser("~"), "ObsidianVault", "Family History", "People")

def parse_frontmatter(path):
    try:
        txt = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return None
    if not txt.startswith("---"):
        return None
    end = txt.find("\n---", 3)
    if end == -1:
        return None
    fm = txt[3:end]
    out = {}
    for line in fm.splitlines():
        m = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip("'\"")
    return out

def surnames(name):
    """Return the set of surname-ish tokens. Last token that is capitalised."""
    name = re.sub(r"\([^)]*\)", " ", name or "").strip()
    name = re.sub(r"\b(née|nee|of|the)\b.*$", "", name, flags=re.I).strip()
    parts = [p for p in re.split(r"\s+", name) if p]
    if not parts:
        return set()
    return {parts[-1].lower()}

def rel_names(fm, kind):
    rel = fm.get("relationships") or ""
    m = re.search(r"\b" + kind + r":\s*([^|]+)", rel, re.I)
    if not m:
        return []
    return [x.strip() for x in m.group(1).split(",") if x.strip()]

def main():
    files = sorted(glob.glob(os.path.join(VAULT, "*.md")))
    files = [f for f in files if not os.path.basename(f).startswith(".")]
    violations = []
    scanned = 0

    for f in files:
        fm = parse_frontmatter(f)
        if not fm:
            continue
        first = fm.get("first_name", "")
        last = fm.get("last_name", "")
        if not first and not last:
            continue
        scanned += 1
        self_sur = {last.lower()} if last else surnames(first)
        if not self_sur or self_sur == {""}:
            continue

        mothers = rel_names(fm, "Mother")
        fathers = rel_names(fm, "Father")
        # Need BOTH slots present to compare surnames.
        if not mothers or not fathers:
            continue

        mo_sur = set()
        for m in mothers:
            mo_sur |= surnames(m)
        fa_sur = set()
        for x in fathers:
            fa_sur |= surnames(x)

        if not mo_sur or not fa_sur:
            continue

        # PATTERN B: mother's surname == child's surname, father's surname differs.
        # GUARD: the father reference MUST actually carry a surname, otherwise this
        # fires on every legitimate mother-line case. "Father: Timothy" (one token,
        # no surname) makes an ordinary child look like a phantom. Require >= 2 tokens.
        fa_tokens = [t for x in fathers for t in re.split(r"\s+", x) if t and t[0].isalpha()]
        if len(fa_tokens) < 2:
            continue
        if (mo_sur & self_sur) and not (fa_sur & self_sur):
            violations.append({
                "file": os.path.basename(f),
                "child": f"{first} {last}".strip(),
                "mother": ", ".join(mothers),
                "father": ", ".join(fathers),
            })

    print(f"PATTERN-B PHANTOM-CHILD SCAN — {VAULT}")
    print(f"  files scanned  : {scanned}")
    print(f"  candidates     : {len(violations)}")
    if violations:
        print()
        for v in violations:
            print(f"  • {v['child']}")
            print(f"      file   : {v['file']}")
            print(f"      Mother : {v['mother']}   <- same surname as child")
            print(f"      Father : {v['father']}   <- different surname")
        print()
        print(f"❌ PATTERN-B GUARD FAILED — {len(violations)} phantom-child candidate(s).")
        print("   Fix the vault Family rows: the Mother slot names a same-surname relative.")
        return 1
    print("\n✅ Pattern-B guard clean: no phantom-child shape found.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
