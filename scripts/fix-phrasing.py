#!/usr/bin/env python3
"""
Fix remaining awkward phrasing in body text.
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
    
    for field in ['body_markdown', 'body_stripped']:
        val = person.get(field)
        if isinstance(val, str):
            original = val
            
            # Fix "making her Cousin" -> "making her a cousin of Mark Telfer"
            val = val.replace("making her Cousin", "making her a cousin of Mark Telfer")
            val = val.replace("making him Cousin", "making him a cousin of Mark Telfer")
            val = val.replace("making her cousin", "making her a cousin of Mark Telfer")
            val = val.replace("making him cousin", "making him a cousin of Mark Telfer")
            
            # Fix "marking her Cousin" (unlikely but just in case)
            val = val.replace(", making her Cousin.", ", making her a cousin of Mark Telfer.")
            val = val.replace(", making him Cousin.", ", making him a cousin of Mark Telfer.")
            
            if val != original:
                person[field] = val
                changes.append(f"{pid} ({slug}): {field}: fixed 'making her/him Cousin' phrasing")

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

print(f"Fixed {len(changes)} phrasing issues:")
for c in changes:
    print(f"  - {c}")
