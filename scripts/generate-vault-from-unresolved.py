#!/usr/bin/env python3
"""
Generate Obsidian vault markdown files from unresolved relationships.
Creates missing person files with proper frontmatter extracted from relationship data.
"""
import os, re, subprocess, yaml
from datetime import datetime

VAULT_DIR = '/home/mark/ObsidianVault/Family History/People/'
BUILD_SCRIPT = '/home/mark/telfer-wiki/scripts/build-people-json.mjs'

def slugify(name):
    """Generate slug from name, matching build script logic"""
    s = name.lower()
    s = re.sub(r'[\(\)]', '', s)
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'\s+', '-', s.strip())
    s = re.sub(r'-+', '-', s)
    # Truncate to reasonable length
    if len(s) > 100:
        import hashlib
        h = hashlib.md5(s.encode()).hexdigest()[:8]
        s = s[:50] + '-' + h + '-' + s[-40:]
    return s

def parse_relationship_list(name_detail, rel_type):
    """Parse a relationship value into individual names.
    Handles: 'Name (details)', 'Name1, Name2, Name3', 'Name1 and Name2', '[[Wikilink]]' """
    names = []
    # Remove (m. ...) patterns
    cleaned = re.sub(r'\s*\(m\.[^)]*\)', '', name_detail)
    cleaned = re.sub(r'\s*\([^)]*m\.[^)]*\)', '', cleaned)
    
    if rel_type.lower() in ('siblings', 'children', 'brother', 'sister', 'daughter', 'son'):
        # Split on commas and "and" for lists
        parts = re.split(r',\s*|\s+and\s+', cleaned)
        for part in parts:
            part = part.strip()
            # Extract from [[Wikilink]] - keep the full link text including dates
            wikilink_match = re.search(r'\[\[([^\]]+)\]\]', part)
            if wikilink_match:
                part = wikilink_match.group(1)
            # Keep trailing parenthetical details for slug uniqueness
            # Only remove em-dash and following text
            part = re.sub(r'\s*—.*$', '', part)
            part = part.strip()
            if part and len(part) > 2:
                names.append(part)
    else:
        # Single person relationship (spouse, father, mother, etc.)
        # Extract from [[Wikilink]] - keep full link text including dates
        wikilink_match = re.search(r'\[\[([^\]]+)\]\]', cleaned)
        if wikilink_match:
            cleaned = wikilink_match.group(1)
        # Keep trailing parenthetical details for slug uniqueness
        # Only remove em-dash and following text
        cleaned = re.sub(r'\s*—.*$', '', cleaned)
        cleaned = cleaned.strip()
        if cleaned and len(cleaned) > 2:
            names.append(cleaned)
    return names

def extract_people_from_unresolved():
    """Run build script and extract all unique person references"""
    result = subprocess.run(['node', BUILD_SCRIPT], capture_output=True, text=True, cwd='/home/mark/telfer-wiki')
    lines = [line for line in result.stdout.split('\n') if '⚠️  Unresolved:' in line]
    
    people = {}  # name -> {details}
    slugs = {}   # slug -> name
    
    for line in lines:
        # Extract source slug
        src_match = re.search(r'Unresolved:\s*(\S+)\s*→', line)
        src_slug = src_match.group(1) if src_match else None
        
        # Extract all relationships in this line
        rel_matches = re.findall(r'→\s*([A-Za-z\s]+):\s*([^→\n]+)', line)
        for rel_type, name_detail in rel_matches:
            rel_type = rel_type.strip()
            
            # Parse into individual names
            names = parse_relationship_list(name_detail, rel_type)
            
            for name in names:
                # Extract birth/death years if present in original detail
                # Look for patterns like (1842–1925), (1802-1891), (1849–?), (?–1936)
                by = None
                dy = None
                date_match = re.search(r'\((\d{4})[-\–](\d{4}|\?)\)', name_detail)
                if date_match:
                    by = int(date_match.group(1))
                    if date_match.group(2) != '?':
                        dy = int(date_match.group(2))
                        if dy == by:
                            dy = None
            
                # Also try to extract years from the individual name
                name_date_match = re.search(r'\((\d{4})[-\–](\d{4}|\?)\)', name)
                if name_date_match:
                    by = int(name_date_match.group(1))
                    if name_date_match.group(2) != '?':
                        dy = int(name_date_match.group(2))
                        if dy == by:
                            dy = None
                
                # Determine branch
                branch = 'telfer' if 'telfer' in name.lower() else 'other'
                
                # Create slug
                person_slug = slugify(name)
                
                # Store with most info
                if name not in people or (by and not people[name].get('birth_year')):
                    people[name] = {
                        'name': name,
                        'slug': person_slug,
                        'birth_year': by,
                        'death_year': dy,
                        'branch': branch,
                        'relations': [],
                        'source_slugs': set()
                    }
                people[name]['relations'].append((rel_type, src_slug))
                people[name]['source_slugs'].add(src_slug)
                slugs[person_slug] = name
                
    return people, slugs

def load_existing_vault():
    """Load existing vault names and slugs"""
    existing = {}
    for fname in os.listdir(VAULT_DIR):
        if fname.endswith('.md') and fname not in ('Leads.md', '_Index.md'):
            path = os.path.join(VAULT_DIR, fname)
            with open(path) as f:
                content = f.read()
            if content.startswith('---'):
                parts = content.split('---', 2)
                if len(parts) >= 3:
                    fm = yaml.safe_load(parts[1])
                    if fm:
                        fn = fm.get('first_name', '')
                        mn = fm.get('middle_name', '')
                        ln = fm.get('last_name', '')
                        full = ' '.join([x for x in [fn, mn, ln] if x])
                        # Add dates for matching against unresolved refs that include them
                        by = fm.get('birth_year')
                        dy = fm.get('death_year')
                        if by and dy:
                            full_with_dates = f"{full} ({by}–{dy})"
                        elif by:
                            full_with_dates = f"{full} ({by}–?)"
                        elif dy:
                            full_with_dates = f"{full} (?–{dy})"
                        else:
                            full_with_dates = full
                        if full:
                            slug = fname[:-3]
                            existing[full] = {'slug': slug, 'fm': fm}
                            if full_with_dates != full:
                                existing[full_with_dates] = {'slug': slug, 'fm': fm}
    return existing

def parse_name(full_name):
    """Parse full name into first, middle, last. Strips parenthetical dates."""
    # Remove parenthetical dates like (1796–1863), (1842–1925), etc.
    # But keep married names like (Clarke), (Lane), etc.
    # Pattern: (YYYY–YYYY), (YYYY-YYYY), (YYYY–?), (?–YYYY)
    name_clean = re.sub(r'\s*\((?:\d{4}[-\–]\d{4}|\d{4}[-\–]\?|\?[-\–]\d{4})\)\s*$', '', full_name).strip()
    parts = name_clean.split()
    if not parts:
        return '', '', ''
    first = parts[0]
    last = parts[-1] if len(parts) > 1 else ''
    middle = ' '.join(parts[1:-1]) if len(parts) > 2 else ''
    return first, middle, last

def generate_frontmatter(person, existing_fm=None):
    """Generate YAML frontmatter for a person"""
    first, middle, last = parse_name(person['name'])
    
    fm = {
        'first_name': first,
        'last_name': last,
        'tags': ['person', person['branch']]
    }
    if middle:
        fm['middle_name'] = middle
    if person['birth_year']:
        fm['birth_year'] = person['birth_year']
    if person['death_year']:
        fm['death_year'] = person['death_year']
    if existing_fm:
        # Preserve existing fields
        for k, v in existing_fm.items():
            if k not in fm:
                fm[k] = v
    return fm

def generate_markdown(person, frontmatter):
    """Generate full markdown file content"""
    yaml_str = yaml.dump(frontmatter, allow_unicode=True, sort_keys=False).strip()
    
    # Build relationships section from extracted data
    rels_by_type = {}
    for rel_type, src_slug in person['relations']:
        if rel_type not in rels_by_type:
            rels_by_type[rel_type] = set()
        rels_by_type[rel_type].add(src_slug)
    
    body = f"# {person['name']}\n\n"
    if person['birth_year'] or person['death_year']:
        by = person['birth_year'] or '?'
        dy = person['death_year'] or '?'
        body += f"**Lifespan:** {by}–{dy}\n\n"
    body += f"**Branch:** {person['branch'].title()}\n\n"
    
    if rels_by_type:
        body += "## Relationships\n\n"
        body += "| Relation | Name |\n|---|---|\n"
        for rel_type, slugs in sorted(rels_by_type.items()):
            for src in sorted(slugs):
                # Convert source slug to readable name
                src_name = src.replace('-', ' ').title()
                body += f"| {rel_type} | {src_name} |\n"
        body += "\n"
    
    body += "---\n*Auto-generated from unresolved references. Please verify and enhance.*\n"
    
    return f"---\n{yaml_str}\n---\n\n{body}"

def main():
    print("🔍 Extracting people from unresolved references...")
    unresolved_people, _ = extract_people_from_unresolved()
    print(f"Found {len(unresolved_people)} unique people in unresolved refs")
    
    print("📂 Loading existing vault...")
    existing = load_existing_vault()
    print(f"Existing vault entries: {len(existing)}")
    
    # Determine missing people
    missing = []
    for name, data in unresolved_people.items():
        # Check if already in vault (by name or slug)
        found = False
        for ex_name, ex_data in existing.items():
            if ex_name.lower() == name.lower() or ex_data['slug'] == data['slug']:
                found = True
                break
        if not found:
            missing.append((name, data))
    
    print(f"Missing from vault: {len(missing)}")
    
    # Sort by branch (Telfer first) then by birth year
    missing.sort(key=lambda x: (x[1]['branch'] != 'telfer', x[1]['birth_year'] or 9999, x[0]))
    
    # Generate files for missing people
    created = 0
    for name, data in missing:
        fname = f"{data['slug']}.md"
        fpath = os.path.join(VAULT_DIR, fname)
        
        if os.path.exists(fpath):
            continue
            
        frontmatter = generate_frontmatter(data)
        content = generate_markdown(data, frontmatter)
        
        with open(fpath, 'w') as f:
            f.write(content)
        created += 1
        if created % 20 == 0:
            print(f"  Created {created} files...")
    
    print(f"\n✅ Created {created} new vault files")
    print(f"Total vault files would be: {len(existing) + created}")

if __name__ == '__main__':
    main()