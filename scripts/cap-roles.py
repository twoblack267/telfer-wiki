#!/usr/bin/env python3
"""Fix **Role:** lines that start with lowercase after Mark's removal."""
import json, re

for fname in ['src/data/people.json', 'src/data/people.public.json']:
    with open(fname) as f:
        data = json.load(f)
    
    changes = 0
    for p in data:
        for field in ['body_markdown', 'body_stripped']:
            body = p.get(field)
            if not body:
                continue
            # Replace **Role:** X where X starts lowercase -> capitalize it
            new_body = re.sub(
                r'\*\*Role:\*\*\s+(\S.*)',
                lambda m: '**Role:** ' + (m.group(1)[0].upper() + m.group(1)[1:] if m.group(1) and m.group(1)[0].islower() else m.group(1)),
                body
            )
            if new_body != body:
                p[field] = new_body
                changes += 1
        
        # Fix role field (short tag) too
        role = p.get('role')
        if role and role[0].islower():
            p['role'] = role[0].upper() + role[1:]
            changes += 1
    
    with open(fname, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f'{fname}: {changes} capitalized')

# Verify
with open('src/data/people.json') as f:
    data = json.load(f)
issues = 0
for p in data:
    body = p.get('body_markdown', '')
    for line in body.split('\n'):
        m = re.match(r'^\*\*Role:\*\*\s+(\S.*)', line)
        if m and m.group(1) and m.group(1)[0].islower():
            print(f"  STILL LOWERCASE: {p.get('id','?')}: {line.strip()}")
            issues += 1
if not issues:
    print('✅ All **Role:** lines capitalized correctly.')
