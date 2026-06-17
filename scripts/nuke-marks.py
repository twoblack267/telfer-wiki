#!/usr/bin/env python3
"""Kill *every* "Mark's" reference in people.json's body_stripped too."""
import json, re

fname = 'src/data/people.json'
with open(fname) as f:
    data = json.load(f)

changes = 0
for p in data:
    for field in ['body_markdown', 'body_stripped', 'role', 'roles']:
        val = p.get(field)
        if not val:
            continue
        
        if isinstance(val, str):
            old = val
            # 1. "Mark's " -> ""
            new = val.replace("Mark's ", "")
            # 2. Handle the step-sibling pattern with "Mark's" in the middle
            new = new.replace("Mark's step-brother through Tim", "step-brother through Tim")
            # 3. "making her Mark's cousin" / "making her Mark's adopted cousin"
            new = new.replace("Mark's cousin", "a cousin")
            new = new.replace("Mark's adopted cousin", "an adopted cousin")
            # 4. "Joel is Mark's step-brother" -> "Joel is her step-brother" (Sheryle's son)
            #    Actually just "Joel is step-brother to the family"
            new = new.replace("Joel is Mark's step-brother", "Joel is Sheryle's son and step-brother")
            # 5. "Lauren is Mark's step-sister" -> "Lauren is Sheryle's daughter and step-sister"
            new = new.replace("Lauren is Mark's step-sister", "Lauren is Sheryle's daughter and step-sister")
            # 6. "brother — Mark's father" -> "brother — father"
            new = new.replace("— Mark's father", "— father")
            # 7. Fix any lowercase first chars after **Role:** removal
            new = re.sub(r'\*\*Role:\*\*\s+([a-z])', lambda m: '**Role:** ' + m.group(1).upper(), new)
            
            if new != old:
                p[field] = new
                changes += 1
        
        elif isinstance(val, list):
            old = list(val)
            new_list = []
            for item in val:
                ni = item.replace("Mark's ", "")
                ni = ni.replace("Mark's step-brother through Tim", "step-brother through Tim")
                if ni and ni[0].islower():
                    ni = ni[0].upper() + ni[1:]
                new_list.append(ni)
            p[field] = new_list
            if new_list != old:
                changes += 1

with open(fname, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

# Verify
with open(fname) as f:
    data = json.load(f)
remaining = 0
for p in data:
    for field in ['role', 'roles', 'body_markdown', 'body_stripped']:
        val = p.get(field)
        if val:
            if isinstance(val, str):
                # Remove false positives (references to "Mark Telfer" as a name)
                clean = val.replace("Mark Telfer", "X").replace("Mark Kenneth Telfer", "X")
                if "Mark's" in clean:
                    print(f'  REMAINING {p.get("id","?")}.{field}')
                    remaining += 1
            elif isinstance(val, list):
                for item in val:
                    if "Mark's" in item:
                        print(f'  REMAINING {p.get("id","?")}.{field}: {item}')
                        remaining += 1

print(f'{fname}: {changes} changes')
if remaining:
    print(f'❌ {remaining} remaining!')
else:
    print(f'✅ COMPLETELY CLEAN')
