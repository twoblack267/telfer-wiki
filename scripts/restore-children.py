#!/usr/bin/env python3
"""
Restore children arrays — SECOND PASS.

In first pass, children were stored as old slug IDs (e.g. "timothy-neil-telfer-1959").
TreeView.astro uses CURRENT person IDs (e.g. "Timothy Neil Telfer") for lookups.
This pass converts child IDs from old slug format to current ID format.
"""
import json
import subprocess
import re

# ─── Load data ───────────────────────────────────────────────────
with open('src/data/people.json') as f:
    current = json.load(f)

old_raw = subprocess.check_output(
    ['git', 'show', 'bc9af88:src/data/people.json']
)
old = json.loads(old_raw)

# ─── Build current lookups ────────────────────────────────────────
cur_by_name = {}  # normalized lower name -> person
for p in current:
    name = p.get('display_name', '')
    if name:
        cur_by_name[name.lower().strip()] = p

# ─── Build old lookups ────────────────────────────────────────────
old_by_id = {}
old_by_name = {}
for p in old:
    old_by_id[p.get('id', '')] = p
    old_by_name[p.get('display_name', '').lower().strip()] = p


def match_old_to_current(slug: str) -> str | None:
    """Convert old slug ID to current person ID. Returns None if no match."""
    s = slug.lower().strip()
    # Direct match on display name
    if s in cur_by_name:
        return cur_by_name[s]['id']

    # Strip brackets
    s_clean = s.lstrip('[').rstrip(']').strip()
    if s_clean in cur_by_name:
        return cur_by_name[s_clean]['id']

    # Remove year suffix
    base = re.sub(r'-\d{4,}$', '', s_clean)

    # Build variants
    variants = set()
    variants.add(base)
    variants.add(base.replace('-adopted', ' (adopted)'))
    variants.add(base.replace('-adopted', ' (adoptive)'))
    variants.add(base.replace('-adoptive', ' (adoptive)'))
    variants.add(base.replace('-deceased', ' (deceased)'))
    variants.add(base.replace('-ne-', ' née '))
    variants.add(base.replace('-ne', ' née'))
    variants.add(s_clean.replace('-', ' '))
    variants.add(base.replace('-', ' '))
    variants.add(s_clean.replace('-', ' ').title())
    variants.add(base.replace('-', ' ').title())
    variants.add('[[ ' + base.replace('-', ' ').title())
    variants.add('[[' + base.replace('-', ' ').title())

    for v in variants:
        vn = v.strip().lower()
        if vn in cur_by_name:
            return cur_by_name[vn]['id']

    # Fuzzy: token subset matching
    base_tokens = set(base.replace('-', ' ').lower().split())
    for cn, cp in cur_by_name.items():
        dn = cp.get('display_name', '').lower()
        dn_tokens = set(re.sub(r'[\(\)\-\'\.]', '', dn).split())
        # Check if base tokens are mostly in display name tokens
        overlap = base_tokens & dn_tokens
        if len(overlap) >= max(len(base_tokens) - 1, 2):  # allow 1 mismatch
            # Also check: does the name token prefix match?
            # E.g. "kathryn" from "kathryn-mavis-telfer-19611965" should match "Kathryn" in "Kathryn Mavis Telfer"
            return cp['id']

    return None


# ─── Map all old slugs to current IDs ─────────────────────────────
slug_to_cur_id = {}
for p in old:
    for cid in p.get('children', []):
        if cid in slug_to_cur_id:
            continue
        matched_id = match_old_to_current(cid)
        if matched_id:
            slug_to_cur_id[cid] = matched_id
        else:
            slug_to_cur_id[cid] = None  # remember we tried

print(f"Old child slugs mapped: {sum(1 for v in slug_to_cur_id.values() if v)}/{len(slug_to_cur_id)}")
unmapped = [k for k, v in slug_to_cur_id.items() if v is None]
print(f"Unmapped: {len(unmapped)}")
for u in sorted(unmapped)[:20]:
    print(f"  ? {u}")
if len(unmapped) > 20:
    print(f"  ... and {len(unmapped)-20} more")

# ─── Restore children using CURRENT IDs ───────────────────────────
restored_count = 0
skipped_count = 0

for p in current:
    if p.get('children'):
        continue  # skip if already has data

    # Find old record
    pid = p.get('id', '')
    name = p.get('display_name', '')
    old_p = old_by_id.get(pid) or old_by_name.get(name.lower().strip())
    if not old_p:
        name_clean = re.sub(r'\s*\([\d–\-?]+\).*', '', name).strip().lower()
        old_p = old_by_name.get(name_clean)

    if not old_p or not old_p.get('children'):
        skipped_count += 1
        continue

    # Map old child slugs to current IDs
    mapped_children = []
    for cid in old_p['children']:
        cur_id = slug_to_cur_id.get(cid)
        if cur_id:
            mapped_children.append(cur_id)

    if mapped_children:
        # Deduplicate
        seen = set()
        unique = []
        for c in mapped_children:
            if c not in seen:
                seen.add(c)
                unique.append(c)
        p['children'] = unique
        restored_count += 1
        print(f"  ✓ {name} → {len(unique)} children")

# ─── Verify ───────────────────────────────────────────────────────
print(f"\nRestored: {restored_count}")
print(f"Skipped: {skipped_count}")

# Check key people
key_people = ['Murray John Telfer (1924–2009)', 'Timothy Neil Telfer', 
              'Mark Kenneth Telfer', 'Amy Ellen Telfer', 'Daryll William Telfer',
              'Grantley Keith Telfer', 'Kylie Isabella Telfer']
print("\nKey checks:")
for p in current:
    if p.get('display_name', '') in key_people:
        print(f"  {p['display_name']} → children: {p.get('children', [])}")

# ─── Save ─────────────────────────────────────────────────────────
with open('src/data/people.json', 'w') as f:
    json.dump(current, f, indent=2, ensure_ascii=False)

print("\n✓ Saved!")
