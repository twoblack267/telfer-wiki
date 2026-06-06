#!/usr/bin/env python3
"""
Fix remaining awkward phrasing in body text.
"""
import json

with open('/home/mark/telfer-wiki/src/data/people.json', 'r') as f:
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
with open('/home/mark/telfer-wiki/src/data/people.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Fixed {len(changes)} phrasing issues:")
for c in changes:
    print(f"  - {c}")