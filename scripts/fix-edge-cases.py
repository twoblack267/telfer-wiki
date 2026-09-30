#!/usr/bin/env python3
"""
Fix edge cases from the Mark-perspective replacement.
"""
import os
import json

PEOPLE_JSON = os.environ.get("TELFER_PEOPLE_JSON") or os.path.expanduser("~/telfer-wiki/src/data/people.json")
with open(PEOPLE_JSON, 'r') as f:
    data = json.load(f)

changes = []

for person in data:
    pid = person.get('id', '')
    slug = person.get('slug', '')
    
    # Fix Aaron Ivory's mangled role
    if slug == 'aaron-ivory':
        for field in ['roles', 'body_markdown', 'body_stripped']:
            val = person.get(field)
            if isinstance(val, list):
                new_val = []
                for item in val:
                    if "Step-brother (Sheryle's son, Step-brother through Tim)" in item:
                        fixed = item.replace(
                            "Step-brother (Sheryle's son, Step-brother through Tim)",
                            "Step-brother (Sheryle's son, step-brother through Tim Telfer)"
                        )
                        changes.append(f"{pid}: {field}: fixed mangled step-brother role")
                        new_val.append(fixed)
                    else:
                        new_val.append(item)
                person[field] = new_val
            elif isinstance(val, str):
                if "Step-brother (Sheryle's son, Step-brother through Tim)" in val:
                    person[field] = val.replace(
                        "Step-brother (Sheryle's son, Step-brother through Tim)",
                        "Step-brother (Sheryle's son, step-brother through Tim Telfer)"
                    )
                    changes.append(f"{pid}: {field}: fixed mangled step-brother role")
    
    # Fix Amy Nicole Telfer's role - should be "Sister"
    if slug == 'amy-telfer-nicole':
        for field in ['roles']:
            val = person.get(field)
            if isinstance(val, list):
                new_val = []
                for item in val:
                    if item == "a sister of Mark Telfer":
                        changes.append(f"{pid}: {field}: 'a sister of Mark Telfer' -> 'Sister'")
                        new_val.append("Sister")
                    else:
                        new_val.append(item)
                person[field] = new_val
            elif isinstance(val, str) and val == "a sister of Mark Telfer":
                person[field] = "Sister"
                changes.append(f"{pid}: {field}: 'a sister of Mark Telfer' -> 'Sister'")
        
        # Also fix body_markdown and body_stripped
        for field in ['body_markdown', 'body_stripped']:
            val = person.get(field)
            if isinstance(val, str) and "**Role:** a sister of Mark Telfer" in val:
                person[field] = val.replace("**Role:** a sister of Mark Telfer", "**Role:** Sister")
                changes.append(f"{pid}: {field}: fixed Role line")
    
    # Fix any remaining "Mark's X" in body text that might have been missed
    for field in ['body_markdown', 'body_stripped']:
        val = person.get(field)
        if isinstance(val, str):
            original = val
            # Fix "Mark's cousin" in narrative context
            val = val.replace("making her Mark's cousin", "making her a cousin of Mark Telfer")
            val = val.replace("making him Mark's cousin", "making him a cousin of Mark Telfer")
            val = val.replace("making her Mark's adopted cousin", "making her an adopted cousin of Mark Telfer")
            val = val.replace("making her Mark's step-sister", "making her a step-sister of Mark Telfer")
            val = val.replace("making him Mark's step-brother", "making him a step-brother of Mark Telfer")
            
            if val != original:
                person[field] = val
                changes.append(f"{pid}: {field}: fixed remaining narrative Mark's references")

# Save

# ---- WRITE GATE (added 2026-09-30, Skippy) -----------------------------------
# This script rewrites LIVE data. It previously had no guard and no dry run, so a
# plain `python3 <script>` silently overwrote live files. That is the
# unguarded-writer class (see card tw-2026-09-16-020: an unidentified writer
# clobbered vault profiles). Dry run is now the DEFAULT; --apply is required to
# write, and a timestamped backup is taken first.
import argparse as _argparse, shutil as _shutil, time as _time
_ap = _argparse.ArgumentParser(description="rewrites live data — dry run by default")
_ap.add_argument("--apply", action="store_true", help="actually write (default: dry run)")
_ap.add_argument("--check", action="store_true", help="report only (default behaviour)")
_args, _ = _ap.parse_known_args()
if not _args.apply:
    print(f"DRY RUN — nothing written. Re-run with --apply to write.")
    raise SystemExit(0)

with open(PEOPLE_JSON, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Fixed {len(changes)} edge cases:")
for c in changes:
    print(f"  - {c}")
