#!/usr/bin/env python3
"""Clean prune: Telfer line + spouse/child slug references + explicit Ivory family.

Usage:
  python3 prune-people.py                    # analysis only (default)
  python3 prune-people.py --fix all           # apply all data fixes
  python3 prune-people.py --fix living-detection  # fix death_year empty strings
  python3 prune-people.py --fix null-notes        # fix null body_markdown
"""
import json
import sys
import argparse

def fix_living_detection(people, dry_run=True):
    """Fix entries where death_year is '' instead of null."""
    fixed = 0
    for p in people:
        dy = p.get("death_year")
        if isinstance(dy, str) and dy.strip() == "":
            if not dry_run:
                p["death_year"] = None
            fixed += 1
    return fixed

def fix_null_notes(people, dry_run=True):
    """Fix entries where body_markdown is null instead of empty string."""
    fixed = 0
    for p in people:
        bm = p.get("body_markdown")
        if bm is None:
            if not dry_run:
                p["body_markdown"] = ""
            fixed += 1
    return fixed


def main():
    parser = argparse.ArgumentParser(description="Prune analysis & data fixes")
    parser.add_argument("--fix", choices=["living-detection", "null-notes", "all"],
                        help="Apply data fixes (default: analysis-only)")
    args = parser.parse_args()

    with open("src/data/people.json") as f:
        people = json.load(f)

    by_slug = {p["slug"]: p for p in people}

    # --- Analysis ---
    telfer_slugs = {p["slug"] for p in people if p["branch"] == "telfer"}

    referenced = set()
    for p in people:
        if p["branch"] != "telfer":
            continue
        for rel in ["spouses", "children", "parents", "siblings"]:
            for ref in p.get(rel, []):
                ref = ref.strip()
                if ref in by_slug:
                    referenced.add(ref)

    extra_keep = [
        "paul-ivory", "aaron-ivory-1989", "aaron-ivory-living",
        "jared-ivory-living", "jared-ivory-1993", "jared-ivory-1986",
        "joel-ivory-1986", "joel-ivory-living", "lauren-ivory-1994",
        "lauren-ivory-living", "karina-ivory",
    ]

    keep_slugs = telfer_slugs | referenced | set(extra_keep)
    remove = [p for p in people if p["slug"] not in keep_slugs]

    print(f"Telfer-branch: {len(telfer_slugs)}")
    print(f"Referenced by slug: {len(referenced - telfer_slugs)}")
    print(f"Explicitly kept (Ivory etc): {len(set(extra_keep) & set(p['slug'] for p in people))}")
    print(f"Total keep: {len(keep_slugs)}")
    print(f"Total remove: {len(remove)}")
    print()

    # Data integrity checks
    empty_dy = [p for p in people if isinstance(p.get("death_year"), str) and p["death_year"] == ""]
    null_bm = [p for p in people if p.get("body_markdown") is None]
    print(f"=== DATA INTEGRITY ===")
    print(f"Entries with empty-string death_year: {len(empty_dy)}")
    for p in empty_dy:
        print(f"  {p['display_name']} [{p['slug']}]")
    print(f"Entries with null body_markdown: {len(null_bm)}")
    for p in null_bm:
        print(f"  {p['display_name']} [{p['slug']}]")
    print()

    # Show non-Telfer kept
    print("=== NON-TELFER KEPT ===")
    kept_other = sorted(
        [p for p in people if p["branch"] != "telfer" and p["slug"] in keep_slugs],
        key=lambda p: (p["branch"], p["display_name"])
    )
    for p in kept_other:
        print(f"  [{p['branch']:>8}] {p['display_name']} [{p['slug']}]")
    print()

    print("=== REMOVED ===")
    remove.sort(key=lambda p: (p["branch"], p["display_name"]))
    for p in remove:
        print(f"  [{p['branch']:>8}] {p['display_name']} [{p['slug']}]")

    # --- Fix mode ---
    if args.fix:
        print()
        print("=== APPLYING FIXES ===")
        fixes_applied = 0

        if args.fix in ("living-detection", "all"):
            count = fix_living_detection(people, dry_run=False)
            if count > 0:
                print(f"  Fixed {count} empty-string death_year → null")
                fixes_applied += count
            else:
                print("  No empty-string death_year found to fix")

        if args.fix in ("null-notes", "all"):
            count = fix_null_notes(people, dry_run=False)
            if count > 0:
                print(f"  Fixed {count} null body_markdown → empty string")
                fixes_applied += count
            else:
                print("  No null body_markdown found to fix")

        if fixes_applied > 0:
            with open("src/data/people.json", "w") as f:
                json.dump(people, f, indent=2, ensure_ascii=False)
            print(f"  ✅ Wrote {len(people)} entries back to people.json")
        else:
            print("  ✅ No fixes needed — people.json unchanged")

    return len(remove)


if __name__ == "__main__":
    sys.exit(main())
