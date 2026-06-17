#!/usr/bin/env python3
import json, re

with open('src/data/people.json') as f:
    data = json.load(f)

issues = 0
for p in data:
    body = p.get('body_markdown', '')
    for line_num, line in enumerate(body.split('\n'), 1):
        m = re.match(r'^\*\*Role:\*\*\s+(.*)$', line)
        if m:
            role_text = m.group(1)
            if role_text and role_text[0].islower():
                print(f"{p.get('id','?')}:{line_num}: **Role:** {role_text}")
                issues += 1

if not issues:
    print("✅ All **Role:** lines start with uppercase — clean.")
else:
    print(f"\n{issues} issues found")
