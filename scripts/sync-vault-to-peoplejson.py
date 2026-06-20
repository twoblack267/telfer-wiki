#!/usr/bin/env python3
"""
sync-vault-to-peoplejson.py
For every .md file in the vault directory, ensure a matching entry exists in people.json.
Reads the vault file's YAML frontmatter to populate the entry.
"""
import json, os, glob, re, yaml
from collections import OrderedDict

VAULT_DIR = '/home/mark/ObsidianVault/Family History/People/'
PEOPLE_JSON = '/home/mark/telfer-wiki/src/data/people.json'

# Load existing people.json
with open(PEOPLE_JSON) as f:
    people = json.load(f)

existing_slugs = {p['slug'] for p in people}
vault_files = sorted(glob.glob(os.path.join(VAULT_DIR, '*.md')))

print(f'📂 Vault files: {len(vault_files)}')
print(f'📝 People.json entries: {len(people)}')

added = 0
for vf in vault_files:
    with open(vf) as f:
        content = f.read()
    
    # Try to parse YAML frontmatter
    m = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not m:
        continue
    
    try:
        fm = yaml.safe_load(m.group(1))
    except:
        continue
    
    if not fm or not isinstance(fm, dict):
        continue
    
    # Generate slug from filename
    filename = os.path.basename(vf)
    title = fm.get('title', filename.replace('.md', ''))
    
    first = fm.get('first_name', '')
    last = fm.get('last_name', '')
    
    if not first and not last:
        continue
    
    # Build slug
    birth = fm.get('birth_year')
    slug = first.lower() if first else ''
    if last:
        slug += '-' + last.lower().replace(' ', '-')
    if birth:
        slug += f'-{birth}'
    slug = re.sub(r'[^a-z0-9-]', '', slug)
    slug = re.sub(r'-+', '-', slug).strip('-')
    
    if not slug or slug in existing_slugs:
        continue
    
    death = fm.get('death_year')
    lifespans = f"{birth}–{death}" if birth and death else (f"{birth}–?" if birth else '')
    
    # Parse relationships for parents/spouses/children
    rel_text = fm.get('relationships', '')
    if isinstance(rel_text, list):
        rel_text = '\n'.join(str(x) for x in rel_text)
    rel_text = str(rel_text) if rel_text else ''
    rel_self = ''
    rel_spouse = ''
    rel_children = ''
    rel_parents = ''
    
    if rel_text:
        parts = [p.strip() for p in rel_text.split('|')]
        for part in parts:
            if part.startswith('Self:'): rel_self = part.replace('Self:', '').strip()
            elif part.startswith('Spouse:'): rel_spouse = part.replace('Spouse:', '').strip()
            elif part.startswith('Children:'): rel_children = part.replace('Children:', '').strip()
            elif part.startswith('Parents:') or part.startswith('Father:') or part.startswith('Mother:'):
                rel_parents = part.split(':', 1)[1].strip() if ':' in part else ''
    
    # Build display name
    display = title
    
    entry = OrderedDict([
        ('slug', slug),
        ('display_name', display),
        ('first_name', first),
        ('middle_name', fm.get('middle_name', '')),
        ('last_name', last),
        ('birth_year', birth),
        ('death_year', death),
        ('lifespan', lifespans),
        ('parents', {'father': '', 'mother': ''}),
        ('spouses', [s.strip() for s in rel_spouse.split(',') if s.strip()] if rel_spouse else []),
        ('children', [c.strip() for c in rel_children.split(',') if c.strip()] if rel_children else []),
        ('vault_file', filename)
    ])
    
    people.append(entry)
    existing_slugs.add(slug)
    added += 1

print(f'✅ Added {added} new entries to people.json')
print(f'📝 Total: {len(people)} entries')

with open(PEOPLE_JSON, 'w') as f:
    json.dump(people, f, indent=2, ensure_ascii=False)

print(f'💾 Saved to {PEOPLE_JSON}')
