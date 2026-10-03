#!/usr/bin/env python3
"""Regression pin for validate-no-mark-refs.py (card tw-2026-09-13-023).
Run:  python3 scripts/tests/test_no_mark_refs.py
Pins the 2026-10-04 false-positive fix: the ancestor Mark Telfer's (1877-1946) own
family shapes must PASS while every archivist (Mark Kenneth Telfer, b.1986) shape FAILS.
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(ROOT, "scripts", "validate-no-mark-refs.py")

ANCESTOR_LINES = [
    "Mark's daughter, Mrs. Joyce Downs, relates the story of a hold-up on Glencoe Hill.",
    "Mark's fifth child was Joyce Elizabeth Telfer. She attended the Mount Gambier Technical School.",
    "Telfer's Road runs past the Edgerston gate and leads to the farm once owned by Mark Telfer",
    "and now worked by Mark's grandson, Ian Telfer.",
    "husband Mark's 1946 death notice",
    "wife Mark's obituary",
]
ARCHIVIST_LINES = [
    "My wife is Mark's cousin.",
    "Mark Kenneth Telfer's mother-in-law was a nurse.",
    "Mark's grandfather was a farmer.",
    "He was Mark's adopted brother.",
]

def run(files):
    return subprocess.run([sys.executable, GATE] + files,
                          capture_output=True, text=True).returncode

def main():
    ok = True
    with tempfile.TemporaryDirectory() as d:
        a = os.path.join(d, "ancestor.json")
        json.dump({"biography": " ".join(ANCESTOR_LINES)}, open(a, "w"))
        if run([a]) != 0:
            print("FAIL: ancestor shapes were flagged (false positive regressed)"); ok = False
        else:
            print("PASS: ancestor shapes clear")
        for line in ARCHIVIST_LINES:
            b = os.path.join(d, "arch.json")
            json.dump({"biography": line}, open(b, "w"))
            if run([b]) == 0:
                print(f"FAIL: archivist shape NOT caught -> {line!r}"); ok = False
        if ok:
            print(f"PASS: all {len(ARCHIVIST_LINES)} archivist shapes still caught")
        # The live data directory must stay clean.
        if run([os.path.join(ROOT, "src", "data")]) != 0:
            print("FAIL: live src/data is not clean"); ok = False
        else:
            print("PASS: live src/data clean")
    print("RESULT:", "OK" if ok else "BROKEN")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
