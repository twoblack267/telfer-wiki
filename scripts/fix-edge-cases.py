#!/usr/bin/env python3
"""
Fix edge cases from the Mark-perspective replacement.
"""
import json

with open('/home/mark/telfer-wiki/src/data/people.json', 'r') as f:
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
with open('/home/mark/telfer-wiki/src/data/people.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Fixed {len(changes)} edge cases:")
for c in changes:
    print(f"  - {c}")