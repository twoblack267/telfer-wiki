#!/usr/bin/env python3
import json, re, sys
from collections import defaultdict

people_path = sys.argv[1] if len(sys.argv) > 1 else "src/data/people.json"
with open(people_path) as f:
    people = json.load(f)

by_id = {p['id']: p for p in people}

def is_telfer(name):
    if not name: return False
    return "telfer" in name.lower()

telfer_people = [p for p in people if is_telfer(p['id']) or is_telfer(p.get('display_name',''))]
print(f"Telfer people: {len(telfer_people)}")

# Check parents[] for all Telfer people
print("\n=== Telfer people with parents ===")
for p in telfer_people:
    pid = p['id']
    parents = p.get('parents', [])
    if parents and parents[0] not in ['?', 'Unknown', '[unknown]', '']:
        print(f"  {pid} -> parents: {parents}")

by_display_name = {p.get('display_name', ''): p for p in people}
by_display_lower = {p.get('display_name', '').lower(): p for p in people}

child_map = defaultdict(set)
print("\n=== Parent matching ===")
for p in people:
    for parent_name in p.get('parents', []):
        clean = parent_name.strip()
        if not clean or clean in ['?', 'Unknown', '[unknown]']:
            continue
        if clean in by_id:
            child_map[clean].add(p['id'])
        elif clean in by_display_name:
            matched = by_display_name[clean]
            child_map[matched['id']].add(p['id'])
        elif clean.lower() in by_display_lower:
            matched = by_display_lower[clean.lower()]
            child_map[matched['id']].add(p['id'])
        else:
            matched = False
            for pid2, p2 in by_id.items():
                dn = p2.get('display_name', '')
                if clean.lower() in dn.lower() or dn.lower() in clean.lower():
                    child_map[pid2].add(p['id'])
                    matched = True
                    break
            if not matched:
                print(f"  NO MATCH: {p['id']}'s parent '{clean}'")

print(f"\n=== Telfer people with children in child_map ===")
for p in telfer_people:
    pid = p['id']
    kids = child_map.get(pid, set())
    if kids:
        print(f"  {pid} -> {list(kids)}")

# Count gen 0 people
print(f"\nTotal child_map entries: {len(child_map)}")
print(f"Total people: {len(people)}")
print(f"Total Telfer: {len(telfer_people)}")
print(f"Telfer in child_map: {sum(1 for p in telfer_people if p['id'] in child_map)}")
