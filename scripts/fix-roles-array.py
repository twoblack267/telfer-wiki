#!/usr/bin/env python3
"""Clean the `roles` array (plural) — separate from the `role` string."""
import json, re

for fname in ['src/data/people.json', 'src/data/people.public.json']:
    with open(fname) as f:
        data = json.load(f)
    
    changes = 0
    for p in data:
        if 'roles' in p and isinstance(p['roles'], list):
            new_roles = []
            for r in p['roles']:
                nr = r.replace("Mark's ", "")
                nr = nr.replace("Mark's step-brother through Tim", "step-brother through Tim")
                if nr and nr[0].islower():
                    nr = nr[0].upper() + nr[1:]
                new_roles.append(nr)
                if nr != r:
                    changes += 1
            p['roles'] = new_roles
    
    with open(fname, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f'{fname}: {changes} role entries fixed')

# Final zero-check for BOTH source files
for fname in ['src/data/people.json', 'src/data/people.public.json']:
    with open(fname) as f:
        data = json.load(f)
    dirty = 0
    for p in data:
        for field in ['role', 'roles', 'body_markdown', 'body_stripped']:
            val = p.get(field)
            if val:
                if isinstance(val, str) and "Mark's" in val:
                    # Check it's not a false positive like "Mark Telfer (1877-1946)"
                    content_without_names = val.replace("Mark Telfer", "").replace("Mark Kenneth Telfer", "")
                    if "Mark's" in content_without_names:
                        # Get context
                        idx = content_without_names.index("Mark's")
                        print(f'  REMAINING [{fname}] {p.get("id","?")}.{field}: ...{content_without_names[max(0,idx-20):idx+40]}...')
                        dirty += 1
                elif isinstance(val, list):
                    for item in val:
                        if "Mark's" in item:
                            # Filter false positives
                            item_clean = item.replace("Mark Telfer", "")
                            if "Mark's" in item_clean:
                                print(f'  REMAINING [{fname}] {p.get("id","?")}.{field}[{val.index(item)}]: {item}')
                                dirty += 1
    if not dirty:
        print(f'✅ [{fname}] ZERO remaining "Mark\'s" in body/role/roles fields')
