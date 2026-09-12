#!/usr/bin/env python3
"""
test-purge-mark-refs.py — prove purge-mark-refs.py cannot CORRUPT a sentence.

WHY THIS EXISTS (tw-2026-09-12-043, discovered 2026-09-12)
----------------------------------------------------------
purge-mark-refs.py rewrites `Mark's <role>` into a role word while regenerating public
data. A rule of the shape:

    r"\\bMark\\s+Telfer'?s?\\s+(?:(paternal|...)?\\s*)(father|grandfather|...)\\b"
      -> lambda m: m.group(2).capitalize()

replaces the WHOLE match with the captured role. That is fine for a label like
`**Role:** Mark's father` -> `Father`, but catastrophic inside a sentence. It shipped
broken grammar to the live site:

    vault  : ...that is a conflation — Mark Telfer's father is a *different* John Telfer...
    shipped: ...that is a conflation — Father is a *different* John Telfer...

and

    vault  : Murray John Telfer was Mark's paternal grandfather, who died in 2009.
    shipped: Murray John Telfer was Grandfather, who died in 2009.

Both on a public page, produced by a cleanup rule, with every gate green.

DESIGN NOTE — why this test drives the LIVE script instead of a copy
-------------------------------------------------------------------
The FIRST version of this file declared its own copy of the rules. Sabotaging
purge-mark-refs.py therefore did NOT trip the gate: the test was checking a stale
shadow of the rules, not the rules that actually run. That is the same fault class the
whole card is about — a check that reports green without testing the real thing.

This version IMPORTs purge-mark-refs.py and exercises `BODY_REPLACEMENTS` exactly as the
regenerator does. Verified by sabotage: reverting the destructive rule makes this file
exit 1.
"""
import importlib.util
import os
import re
import sys

REPO = os.path.expanduser("~/telfer-wiki")
SCRIPT = os.path.join(REPO, "scripts", "purge-mark-refs.py")

# (name, input, [fragments that MUST survive the rewrite])
CASES = [
    ("role label — bare collapse is CORRECT here (match is the whole unit)",
     "**Role:** Mark's father",
     None),

    ("mid-sentence: the owner must not be deleted",
     "that is a conflation — Mark Telfer's father is a *different* John Telfer",
     ["a *different* John Telfer"]),

    ("bare role word must never land mid-sentence",
     "Murray John Telfer was Mark's paternal grandfather, who died in 2009.",
     ["the paternal grandfather of the present line", "who died in 2009"]),

    ("possessive subject mid-sentence",
     "Mark's paternal grandfather farmed at Ungarra.",
     ["farmed at Ungarra"]),

    ("relative clause must survive",
     "Murray John Telfer was Mark's paternal grandfather, who died in 2009.",
     ["who died in 2009"]),

    ("no forbidden reference at all — byte-identical passthrough",
     "John Telfer was a farmer at Tantanoola.",
     ["John Telfer was a farmer at Tantanoola"]),
]

# Shapes that indicate the rewrite broke the text.
CORRUPTION_MARKERS = [
    (re.compile(r"  +"), "doubled space left behind"),
    (re.compile(r"\s+[—,;]\s*$"), "orphaned punctuation"),
    (re.compile(r"\bTelfer's father\b"), "dangling owner: 'Telfer's father' with no Telfer"),
    (re.compile(r"^\s*[A-Z][a-z]+\s*$"), "sentence reduced to a single bare word"),
    # A capitalised role noun with no determiner, straight after a copula, is the
    # signature of a bare-role collapse: "was Grandfather, who died" / "is Father, who".
    (re.compile(r"\b(?:was|is|were|are)\s+(?:Grandfather|Grandmother|Father|Mother|Uncle|"
                r"Aunt|Brother|Sister|Son|Daughter|Cousin|Wife|Husband)\b"),
     "bare role word collapsed mid-sentence (lost its determiner)"),
]


def load_live_rules():
    """Import the RUNNING rule set. Returns (rules, error)."""
    if not os.path.exists(SCRIPT):
        return None, f"not found: {SCRIPT}"
    spec = importlib.util.spec_from_file_location("_purge_live", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except SystemExit:
        pass
    except Exception as e:                                        # noqa: BLE001
        return None, f"could not import ({type(e).__name__}: {e})"
    rules = list(getattr(mod, "BODY_REPLACEMENTS", []) or [])
    rules += list(getattr(mod, "REPLACEMENTS", []) or [])
    if not rules:
        return None, "no BODY_REPLACEMENTS/REPLACEMENTS found — test would pass blind"
    return rules, None


def run_rules(text, rules):
    out = text
    for pattern, repl in rules:
        try:
            out = pattern.sub(repl, out)
        except Exception:                                          # noqa: BLE001
            continue
    return out


def main():
    rules, err = load_live_rules()
    if err:
        print(f"FAIL — cannot exercise the live purge rules: {err}")
        return 1

    print(f"# loaded {len(rules)} live rewrite rule(s) from {os.path.basename(SCRIPT)}")
    problems = []
    for name, text, must_keep in CASES:
        out = run_rules(text, rules)
        issues = []
        for pat, why in CORRUPTION_MARKERS:
            if pat.search(out):
                issues.append(f"{why} -> {out!r}")
        for frag in (must_keep or []):
            if frag not in out:
                issues.append(f"DELETED '{frag}' -> {out!r}")

        print(f"[{'PASS' if not issues else 'FAIL'}] {name}")
        print(f"        in : {text!r}")
        print(f"        out: {out!r}")
        for i in issues:
            print(f"        !  {i}")
        if issues:
            problems += issues
        print()

    if problems:
        print(f"# {len(problems)} problem(s) — purge-mark-refs.py CAN corrupt shipped prose")
        return 1
    print("# purge-mark-refs.py rewrites do not corrupt prose")
    return 0


if __name__ == "__main__":
    sys.exit(main())
