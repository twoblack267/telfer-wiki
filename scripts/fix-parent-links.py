#!/usr/bin/env python3
"""
Fix parent-child link data in people.json for the v2 SVG generator.
Adds missing parents[] arrays and handles nickname aliases.
"""
import json
import sys
import re

# Fix aliases for the v2 generator (people whose IDs differ from how they're referenced)
ALIASES = {
    "Betty Hutton": "Elizabeth Hutton Telfer (1774–1853)",
    "Betty": "Elizabeth Hutton Telfer (1774–1853)",
    "James Telfer": "James Telfer (1761–1845)",  # Robert 1803 lists "James Telfer" as parent
}

# People who should have parents[] but don't (or have incomplete data)
# Format: {person_id: ["parent_name1", "parent_name2"]}
# parent_name MUST match an existing person's `id` field
PARENT_FIXES = {
    "Francis Telfer (1809–1895)": [
        "James Telfer (1761–1845)",
        "Elizabeth Hutton Telfer (1774–1853)"
    ],
    "Robert Telfer (1803–1878)": [
        "James Telfer (1761–1845)",
        "Elizabeth Hutton Telfer (1774–1853)"
    ],
    "John Lawrie (1810–1888)": [
        "Alexander Lawrie (1780–1847)",
    ],
    "Robert Dunlop Lawrie (1850–1917)": [
        "John Lawrie (1810–1888)",
    ],
    "Caroline Edna Lawrie (1890–1957)": [
        "Robert Dunlop Lawrie (1850–1917)",
    ],
    "Joseph March (1797–1883)": [
        "Joseph March (1767–1831)",
    ],
    "Sophia Baker (1829–1901)": [
        "Joseph March (1797–1883)",
    ],
    "Hannah Parker (1855–1948)": [
        "William John Baker (1831–1919)",
        "Sophia Baker (1829–1901)"
    ],
    "William Webster (1778–1816)": [
        "John Webster (1750–1810)",
    ],
    "William John Baker (1831–1919)": [
        # Parents not in our data (James & Jane Baker) — leave as is
    ],
    "Margaret Dougal Telfer (1849–1936)": [
        "Francis Telfer (1809–1895)",
    ],
    "Susan Burton Telfer (1844–1924)": [
        "Elizabeth Beattie (1802–1891)",
        "James Telfer (1796–1863)"
    ],
}

# Fix name references in existing parents[] arrays that don't match IDs
# Format: {person_id: {old_name: new_name}}
NAME_FIXES = {
    "James Telfer (1796–1863)": {
        "Betty Hutton": "Elizabeth Hutton Telfer (1774–1853)",
    },
    "Robert Telfer (1803–1878)": {
        "Betty Hutton": "Elizabeth Hutton Telfer (1774–1853)",
        "James Telfer": "James Telfer (1761–1845)",
    },
}

def main():
    path = "src/data/people.json"
    if len(sys.argv) > 1:
        path = sys.argv[1]

    with open(path) as f:
        people = json.load(f)

    ids = set(p["id"] for p in people)
    
    # Build index of display_names for alias checking
    display_names = {}
    for p in people:
        display_names[p["id"].lower()] = p["id"]
        display_names[p.get("display_name", "").lower()] = p["id"]

    print(f"📂 Loaded {len(people)} people")
    
    changes = 0
    errors = []

    # 1. Fix name references in existing parents[] arrays
    for p in people:
        pid = p["id"]
        if pid in NAME_FIXES:
            parents = p.get("parents", [])
            old_parents = list(parents)
            for old_name, new_name in NAME_FIXES[pid].items():
                while old_name in parents:
                    idx = parents.index(old_name)
                    if new_name not in ids:
                        errors.append(f"  ❌ {pid}: target '{new_name}' not in people.json!")
                    else:
                        parents[idx] = new_name
                        print(f"  ✅ {pid}: '{old_name}' → '{new_name}'")
            if parents != old_parents:
                p["parents"] = parents
                changes += 1

    # 2. Add missing parents
    for pid, parent_ids in PARENT_FIXES.items():
        if pid not in ids:
            errors.append(f"  ❌ Person '{pid}' not found in data!")
            continue
        
        p = next(p for p in people if p["id"] == pid)
        existing = p.get("parents", [])
        
        for parent_id in parent_ids:
            if parent_id not in ids:
                errors.append(f"  ❌ Parent '{parent_id}' (for {pid}) not in people.json!")
                continue
            if parent_id in existing:
                print(f"  ⏭️  {pid}: already has parent '{parent_id}'")
                continue
            existing.append(parent_id)
            print(f"  ➕ {pid}: added parent '{parent_id}'")
            changes += 1
        
        p["parents"] = existing

    # 3. Validate — check for any referenced parent that doesn't exist as a person
    unresolved = []
    for p in people:
        for parent_name in p.get("parents", []):
            parent_name = parent_name.strip()
            if not parent_name or parent_name in ("?", "Unknown", "[unknown]"):
                continue
            if parent_name not in ids:
                # Check aliases
                if parent_name in ALIASES:
                    resolved = ALIASES[parent_name]
                    if resolved in ids:
                        # Auto-fix
                        idx = p["parents"].index(parent_name)
                        p["parents"][idx] = resolved
                        print(f"  🔄 {p['id']}: alias '{parent_name}' → '{resolved}'")
                        changes += 1
                        continue
                unresolved.append(f"  ⚠️  {p['id']}: parent '{parent_name}' unknown (no match in data)")

    # Write changes
    if changes > 0:
        with open(path, "w") as f:
            json.dump(people, f, indent=2)
        print(f"\n✅ Fixed {changes} parent links in {path}")
    else:
        print("\nℹ️  No changes needed")

    if unresolved:
        print(f"\n📋 {len(unresolved)} unresolved parent references (these people are outside our dataset — correct as roots):")
        for u in unresolved:
            print(u)
    if errors:
        print(f"\n❌ {len(errors)} errors:")
        for e in errors:
            print(e)

    # 4. Summary stats
    root_count = sum(1 for p in people if not p.get("parents") or all(not n.strip() or n.strip() == "?" for n in p["parents"]))
    print(f"\n📊 After fix: {root_count} root people (no parents listed)")
    print(f"   {len(people) - root_count} people have parent links")

if __name__ == "__main__":
    main()
