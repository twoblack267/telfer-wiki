"""Apply the new name convention to people.json and people.public.json.
Handles both full format (relationships array) and compact format (spouses slug array).
"""

import json, re

FEMALE = {
    'Elspeth', 'Margaret', 'Elizabeth', 'Betty', 'Jean', 'Jenet', 'Isobel', 'Isabella',
    'Dinah', 'Janet', 'Martha', 'Ann', 'Anne', 'Caroline', 'Julia', 'Ruth',
    'Sophia', 'Hannah', 'Susan', 'Esther', 'Clara', 'Violet', 'Eva',
    'Effie', 'Adelaide', 'Hazel', 'Floris', 'Clarice', 'Joyce', 'Emily',
    'Maifie', 'Ethel', 'Gladys', 'Doris', 'Vida', 'Lilian', 'Ruth',
    'Kathryn', 'Kylie', 'Sheryle', 'Lauren', 'Zabella', 'Maria', 'Mary',
    'Lillian', 'Rebecca', 'Robina', 'Robyn', 'Bertha', 'Carissa', 'Penny',
    'Jessie', 'Helen', 'Angela', 'Beth', 'Shirley', 'Edith',
    'Marion', 'Inez', 'Vera', 'Dorothy', 'Alberta', 'Amy', 'Avis',
    'Catherine', 'Clarice', 'Crystal', 'Elma',
}

def is_female(p):
    fn = p.get('first_name', '')
    first = fn.split()[0] if fn else ''
    return first in FEMALE

def extract_nee(title):
    m = re.search(r'née\s+(\w+)', title)
    return m.group(1) if m else None

def strip_disambiguator(dn):
    """Remove '— Family & Biography', '— First Wife of John Telfer' etc."""
    return dn.split(' — ')[0].strip()

def last_word(s):
    parts = s.split()
    return parts[-1] if parts else ''

def given_names_from_dn(dn):
    """Extract given (first + middle) names from a display_name by stripping
    the last word (surname) and any ' — ' disambiguator."""
    clean = strip_disambiguator(dn)
    parts = clean.split()
    return ' '.join(parts[:-1]) if len(parts) > 1 else clean

def telfer_spouse_slug(spouses):
    """Check if any spouse slug contains 'telfer'."""
    return any('telfer' in (sp or '').lower() for sp in spouses)

def get_spouse_telfer_from_relationships(rels):
    for rel in rels or []:
        if rel.get('type') == 'Spouse':
            for name in rel.get('names', []):
                if 'Telfer' in name:
                    return True
    return False

def new_display_name(dn, fn, mn, ln, title, spouse_is_telfer, has_parens):
    """Compute new display_name or return None if unchanged."""
    if has_parens:
        return None

    # CASE A: Non-Telfer woman married to a Telfer
    if 'Telfer' not in ln and spouse_is_telfer and is_female({'first_name': fn}):
        # Extract given names from display_name (everything except last word)
        given = given_names_from_dn(dn) or fn
        return f"{given} ({ln}) Telfer"
    
    # CASE B: Telfer last_name
    if 'Telfer' in ln:
        # Clean up disambiguators from base display_name
        base = dn.replace(' (of Castleton)', '').replace(' (of Sorbietrees)', '')
        base = base.split(' — ')[0].strip()
        base = re.sub(r'\s*\([\d–?]+\).*$', '', base).strip()
        
        if is_female({'first_name': fn}):
            # B1: Has née in title — use that as maiden
            nee = extract_nee(title)
            if nee:
                middle = f" {mn}" if mn else ""
                return f"{fn}{middle} ({nee}) Telfer"
            # B2: Married a Telfer, has middle_name = maiden
            if spouse_is_telfer and mn:
                return f"{fn} ({mn}) Telfer"
            # B3: Telfer by birth — just clean disambiguators
            if base != dn:
                return base
            return None
        else:
            # B4: Telfer man — clean disambiguators
            if base != dn:
                return base
            return None
    
    return None

# ============ Process people.json ============
with open('src/data/people.json') as f:
    people = json.load(f)

# First pass: build slug-to-telfer mapping for compact entries
telfer_slugs = {}  # slug → True for known Telfer people
for p in people:
    ln = p.get('last_name', '')
    if 'Telfer' in ln:
        slug = p.get('slug', '')
        if slug:
            telfer_slugs[slug] = True

# Also scan all person IDs that contain Telfer
telfer_ids = set()
for p in people:
    pid = p.get('id', '')
    if 'Telfer' in pid:
        telfer_ids.add(pid)

changes_full = []
changes_compact = []

for p in people:
    dn = p['display_name']
    fn = p.get('first_name', '')
    mn = p.get('middle_name', '') or ''
    ln = p.get('last_name', '')
    title = p.get('title', '') or ''
    has_parens = '(' in dn and ')' in dn
    
    # Determine spouse_is_telfer
    spouse_is_telfer = False
    
    # Check compact format (spouses array of slugs)
    spouses = p.get('spouses', [])
    if spouses and isinstance(spouses[0], str):
        for sp in spouses:
            if sp in telfer_slugs:
                spouse_is_telfer = True
                break
            # Also check for 'telfer' in slug
            if 'telfer' in (sp or '').lower():
                spouse_is_telfer = True
                break
    
    # Check full format (relationships array)
    if not spouse_is_telfer:
        spouse_is_telfer = get_spouse_telfer_from_relationships(p.get('relationships', []))
    
    new_dn = new_display_name(dn, fn, mn, ln, title, spouse_is_telfer, has_parens)
    if new_dn:
        old_dn = dn
        p['display_name'] = new_dn
        
        # Update title
        if 'title' in p:
            p['title'] = p['title'].replace(old_dn, new_dn)
        
        # Update relationships
        for rel in p.get('relationships', []):
            for i, name in enumerate(rel['names']):
                if name == old_dn:
                    rel['names'][i] = new_dn
        
        if 'relationships' in p:
            changes_full.append((old_dn, new_dn))
        else:
            changes_compact.append((old_dn, new_dn))

# Second pass: update cross-references in relationships
for p in people:
    for rel in p.get('relationships', []):
        for i, name in enumerate(rel['names']):
            for old_dn, new_dn in changes_full:
                if name == old_dn:
                    rel['names'][i] = new_dn
                    break

with open('src/data/people.json', 'w') as f:
    json.dump(people, f, indent=2, ensure_ascii=False)

print(f"=== people.json ===")
print(f"Full-format changes: {len(changes_full)}")
for old, new in sorted(changes_full):
    print(f"  {old:55s} → {new}")

print(f"Compact-format changes: {len(changes_compact)}")
for old, new in sorted(changes_compact):
    print(f"  {old:55s} → {new}")

# ============ Process people.public.json ============
with open('src/data/people.public.json') as f:
    public = json.load(f)

# Build comprehensive slug-to-display_name map from people.json  
slug_to_dn = {}
for p in people:
    slug = p.get('slug', '')
    if slug:
        slug_to_dn[slug] = p['display_name']

# Also id-to-display_name
id_to_dn = {}
for p in people:
    pid = p.get('id', '')
    if pid:
        id_to_dn[pid] = p['display_name']

pub_changes = []
for p in public:
    slug = p.get('slug', '')
    dn = p.get('display_name', '')
    fn = p.get('first_name', '')
    mn = p.get('middle_name', '') or ''
    ln = p.get('last_name', '')
    has_parens = '(' in dn and ')' in dn
    
    # Check slug mapping for updated name
    if slug in slug_to_dn:
        new_dn = slug_to_dn[slug]
        if new_dn != dn:
            p['display_name'] = new_dn
            pub_changes.append((dn, new_dn, 'slug_map'))
            continue
    
    # Also check id
    pid = p.get('id', '')
    if pid in id_to_dn:
        new_dn = id_to_dn[pid]
        if new_dn != dn:
            p['display_name'] = new_dn
            pub_changes.append((dn, new_dn, 'id_map'))
            continue
    
    # Fallback: compute using new_display_name logic
    # Check compact format spouses
    spouse_is_telfer = False
    for sp in p.get('spouses', []):
        if sp in telfer_slugs or 'telfer' in (sp or '').lower():
            spouse_is_telfer = True
            break
    
    new_dn = new_display_name(dn, fn, mn, ln, '', spouse_is_telfer, has_parens)
    if new_dn and new_dn != dn:
        p['display_name'] = new_dn
        pub_changes.append((dn, new_dn, 'computed'))

with open('src/data/people.public.json', 'w') as f:
    json.dump(public, f, indent=2, ensure_ascii=False)

print(f"\n=== people.public.json ===")
print(f"Changes: {len(pub_changes)}")
for old, new, source in sorted(pub_changes):
    print(f"  {old:55s} → {new}  ({source})")
