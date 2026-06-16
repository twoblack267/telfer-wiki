#!/usr/bin/env python3
"""
PRECISION fix: Map old slug child IDs → current person IDs.

Strategy: convert old slugs to normalized keys, build reverse lookup
from current data, and match strictly before falling back to fuzziness.
"""
import json
import re

with open('src/data/people.json') as f:
    data = json.load(f)

cur_by_displayname = {}  # normalized -> current id
cur_by_sluglike = {}     # slug-like key -> current id
cur_by_id = {}           # current id -> exists

for p in data:
    cid = p.get('id', '')
    pn = p.get('display_name', '')
    cur_by_id[cid] = cid

    if not pn:
        continue

    n = pn.strip()
    nl = n.lower()

    # 1. Exact normalized display name
    cur_by_displayname[nl] = cid

    # 2. Display name without parenthetical suffixes
    clean = re.sub(r'\s*\(.*?\)\s*', '', n).strip()
    clean_l = clean.lower()
    if clean_l != nl:
        cur_by_displayname[clean_l] = cid

    # 3. Slug-like keys from the display name
    # e.g. "Amy Nicole Telfer (?–?)" -> "amy-nicole-telfer"
    slug = re.sub(r'[^a-z\s]', '', clean_l).strip()
    slug = re.sub(r'\s+', '-', slug)
    cur_by_sluglike[slug] = cid

    # 4. Slug with year suffix (where available in display name)
    # "Timothy Neil Telfer (1959)" -> "timothy-neil-telfer-1959"
    year_matches = re.findall(r'\((\d{4})', n)
    if year_matches:
        slug_with_year = f"{slug}-{year_matches[0]}"
        cur_by_sluglike[slug_with_year] = cid

    # 5. Bracketed versions
    bracketed = f"[[{clean}"
    cur_by_sluglike[bracketed.lower()] = cid


def find_id(slug: str) -> str | None:
    """Resolve an old child slug to a current person ID."""
    s = slug.strip().lower()
    if not s:
        return None

    # Direct ID match
    if s in cur_by_id:
        return s

    # Exact key match (with or without brackets)
    if s in cur_by_displayname:
        return cur_by_displayname[s]
    s_nobracket = s.lstrip('[').rstrip(']').strip()
    if s_nobracket in cur_by_displayname:
        return cur_by_displayname[s_nobracket]

    # Slug match (hyphenated, no parentheses)
    if s in cur_by_sluglike:
        return cur_by_sluglike[s]
    if s_nobracket in cur_by_sluglike:
        return cur_by_sluglike[s_nobracket]

    # Remove year suffix: "timothy-neil-telfer-1959" -> "timothy-neil-telfer"
    s_no_year = re.sub(r'-\d{4,}$', '', s_nobracket)
    if s_no_year != s_nobracket:
        if s_no_year in cur_by_sluglike:
            return cur_by_sluglike[s_no_year]
        # Also try as display name
        dn = s_no_year.replace('-', ' ')
        if dn in cur_by_displayname:
            return cur_by_displayname[dn]

    # Handle special suffixes
    for suffix, replacement in [
        ('-ne-', ' née '), ('-ne', ' née'),
        ('-adopted', ' (adopted)'), ('-adoptive', ' (adoptive)'),
        ('-adoptive', ' (adopted)'), ('-deceased', ' (deceased)'),
    ]:
        variant = s_nobracket.replace(suffix, replacement)
        if variant in cur_by_displayname:
            return cur_by_displayname[variant]
        dns = variant.replace('-', ' ')
        if dns in cur_by_displayname:
            return cur_by_displayname[dns]

    # Just hyphens to spaces
    spaced = s_nobracket.replace('-', ' ')
    if spaced in cur_by_displayname:
        return cur_by_displayname[spaced]

    # Title case the hyphenated version
    titled = spaced.title().lower()
    if titled in cur_by_displayname:
        return cur_by_displayname[titled]
    if titled in cur_by_sluglike:
        return cur_by_sluglike[titled]

    # Try without year AND with née replacement
    if s_no_year != s_nobracket:
        for suffix, replacement in [
            ('-ne-', ' née '), ('-ne', ' née'),
            ('-adopted', ' (adopted)'), ('-adoptive', ' (adoptive)'),
        ]:
            variant = s_no_year.replace(suffix, replacement)
            dns = variant.replace('-', ' ')
            if dns in cur_by_displayname:
                return cur_by_displayname[dns]

    # ----- FUZZY FALLBACK (last resort) -----
    # Only for 2-token slugs where we can be certain
    tokens = set(s_nobracket.replace('-', ' ').replace('(', '').replace(')', '').split())
    tokens.discard('')
    if len(tokens) < 2:
        return None

    # Check for first+last name match: e.g. "mitchell" + "telfer"
    best_match = None
    for dn, cid in cur_by_displayname.items():
        dn_tokens = set(dn.replace('(', '').replace(')', '').replace('.', '').replace("'", '').split())
        overlap = tokens & dn_tokens
        # All slug tokens must be in the display name
        if len(overlap) == len(tokens) and len(overlap) >= 2:
            if best_match is None:
                best_match = cid
            elif dn.count('(') < cur_by_displayname.get(best_match, '').count('('):
                # Prefer simpler names (fewer parentheticals)
                pass
    if best_match:
        return best_match

    return None


# ─── Load old children from git ───────────────────────────────────
import subprocess
old_raw = subprocess.check_output(['git', 'show', 'bc9af88:src/data/people.json'])
old = json.loads(old_raw)

old_by_id = {}
old_by_name = {}
for p in old:
    old_by_id[p.get('id', '')] = p
    old_by_name[p.get('display_name', '').lower().strip()] = p

# ─── Process ──────────────────────────────────────────────────────
fixed = 0
total_children = 0
unmatched = []

for p in data:
    if p.get('children'):
        p['children'] = []  # clear old slugs from previous pass

for p in data:
    pid = p.get('id', '')
    pn = p.get('display_name', '')

    old_p = old_by_id.get(pid) or old_by_name.get(pn.lower().strip())
    if not old_p:
        # Try cleaning parenthetical
        pn_clean = re.sub(r'\s*\([\d–\-?]+\)\s*', '', pn).strip().lower()
        old_p = old_by_name.get(pn_clean)

    if not old_p or not old_p.get('children'):
        continue

    mapped = []
    for child_slug in old_p['children']:
        cid = find_id(child_slug)
        if cid:
            mapped.append(cid)
        else:
            unmatched.append(child_slug)

    if mapped:
        # Deduplicate preserving order
        seen = set()
        unique = []
        for c in mapped:
            if c not in seen:
                seen.add(c)
                unique.append(c)
        p['children'] = unique
        total_children += len(unique)
        fixed += 1

print(f"Fixed: {fixed} records")
print(f"Total children: {total_children}")
print(f"Unmatched child slugs: {len(unmatched)}")
for u in sorted(unmatched)[:20]:
    print(f"  ✗ {u}")
if len(unmatched) > 20:
    print(f"  ... and {len(unmatched)-20} more")

# ─── Verify ───────────────────────────────────────────────────────
print("\nKey checks:")
for name in ['Murray John Telfer (1924–2009)', 'Timothy Neil Telfer',
             'Mark Kenneth Telfer', 'Kylie Isabella Telfer',
             'John Robert Telfer', 'Amy Ellen Telfer (née Provis)',
             'Susan Shirley Lawrie']:
    for p in data:
        if p.get('display_name', '') == name:
            kids = p.get('children', [])
            print(f"\n  {name} ({len(kids)} children):")
            for c in kids:
                cp = cur_by_id.get(c)
                if cp:
                    print(f"    ✓ {c}")
                else:
                    print(f"    ✗ {c} (no person record!)")
            break

# ─── Save ─────────────────────────────────────────────────────────
with open('src/data/people.json', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("\n✓ Saved!")
