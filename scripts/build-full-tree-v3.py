#!/usr/bin/env python3
"""
Telfer Family Tree SVG Generator — v3 (Telfer-Only)
Filters to Telfer-line people only, normalises spouse generations,
and produces a clean, non-overlapping layout.
"""
import json, os, re, sys
from collections import defaultdict, OrderedDict, deque

# ─── COLOURS ──────────────────────────────────────────────────
BG           = "#1a2536"
BOX_BG       = "#0d1b33"
BOX_BORDER   = "#2a4a7f"
ACCENT       = "#d4a843"
HIGHLIGHT    = "#d4a843"
TEXT         = "#e8e8e8"
TEXT_DIM     = "#99aabb"
CONNECTOR    = "#556677"
FEMALE_BG    = "#1a2744"
FEMALE_BORDER = "#4a6fa5"
GREEN_BORDER = "#2d8a5f"
SECTION_CLR  = "#1a5276"
SPOUSE_LINE  = "#6a7b8c"

# ─── CONSTANTS ────────────────────────────────────────────────
BOX_W = 140
BOX_H = 45
HL_BOX_W = 150
HL_BOX_H = 55
GAP_X = 20
GEN_GAP = 80
PADDING = 30
GAP_COUPLE_H = 18

# Direct ancestor line IDs
DIRECT_LINE_IDS = [
    "James Telfer (1761–1845)",
    "Francis Telfer (1809–1895)",
    "John Telfer (1847–1929)",
    "Francis Charles Telfer (1875–1954)",
    "Murray John Telfer (1924–2009)",
    "Timothy Neil Telfer (1959–?)",
    "Mark Kenneth Telfer (1986–?)",
]


# ─── DATA LOADING ─────────────────────────────────────────────
def load_data(path):
    with open(path) as f:
        return json.load(f)


def match_person(name, by_id, by_display_name, by_display_lower, child_birth_year=None):
    """Try to match a name string to a person."""
    name = name.strip()
    if not name or name == "?":
        return []
    name_norm = name.replace('\u2013', '-').replace('\u2014', '-')
    for pid, p in by_id.items():
        if pid.replace('\u2013', '-').replace('\u2014', '-') == name_norm:
            return [p]
    if name in by_id:
        return [by_id[name]]

    def plausible_matches(matches, child_birth_year):
        if child_birth_year is None or not matches:
            return matches
        filtered = []
        for m in matches:
            pb = m.get("birth_year")
            if pb is not None and child_birth_year is not None:
                age_diff = child_birth_year - pb
                if 12 <= age_diff <= 65:
                    filtered.append(m)
        return filtered if filtered else matches

    # Try full match
    if name in by_display_name:
        return [by_display_name[name]]
    name_lower = name.lower()
    if name_lower in by_display_lower:
        return [by_display_lower[name_lower]]
    # Partial match
    matches = []
    for pid, p in by_id.items():
        dn = p.get("display_name", "")
        if name_lower in dn.lower() or dn.lower() in name_lower:
            matches.append(p)
    # Try last name + first name partial
    if not matches:
        for pid, p in by_id.items():
            fn = p.get("first_name", "").lower()
            ln = p.get("last_name", "").lower()
            parts = name_lower.split()
            for part in parts:
                if (fn and part in fn) or (ln and part in ln):
                    if p not in matches:
                        matches.append(p)
    if len(matches) > 1 and child_birth_year:
        matches = plausible_matches(matches, child_birth_year)
    return matches


def build_lookups(people):
    """Build ID, display name, child, and spouse lookup maps."""
    by_id = {}
    by_display_name = {}
    by_display_lower = {}
    child_map = defaultdict(set)
    spouse_set = defaultdict(set)

    for p in people:
        pid = p["id"]
        by_id[pid] = p
        dn = p.get("display_name", "")
        by_display_name[dn] = p
        by_display_lower[dn.lower()] = p

    # Build child_map from parents[] arrays
    for p in people:
        pid = p["id"]
        for parent_name in p.get("parents", []):
            parent_name = parent_name.strip()
            if not parent_name or parent_name in ["?", "Unknown", "[unknown]"]:
                continue
            # Clean "adoptive" markers for matching
            clean_name = re.sub(r'\s*\(adoptive\)', '', parent_name).strip()
            clean_name = re.sub(r'\s*\(adopted\)', '', clean_name).strip()
            pby = p.get("birth_year")
            matches = match_person(clean_name, by_id, by_display_name, by_display_lower, pby)
            for m in matches:
                child_map[m["id"]].add(pid)

    # Build spouse_map
    for p in people:
        pid = p["id"]
        for s in p.get("spouses", []):
            s = s.strip()
            if not s:
                continue
            s_clean = re.sub(r'\s*\(m\..*?\)', '', s).strip()
            s_clean = re.sub(r'\s*\(née.*?\)', '', s_clean).strip()
            s_clean = re.sub(r'\s*\(adoptive.*?\)', '', s_clean).strip()
            s_clean = s_clean.replace("(deceased)", "").strip()
            s_clean = re.sub(r'\s*\(divorced\)', '', s_clean).strip()
            matches = match_person(s_clean, by_id, by_display_name, by_display_lower)
            for m in matches:
                spouse_set[pid].add(m["id"])
                spouse_set[m["id"]].add(pid)

    return by_id, by_display_name, by_display_lower, dict(child_map), dict(spouse_set)


# ─── TELFER-ONLY FILTER ───────────────────────────────────────
def is_telfer_name(name):
    """Return True if this person's name shows they're Telfer-line."""
    if not name:
        return False
    return "telfer" in name.lower() or "telfer" in str(name).lower()


def filter_telfer_only(people):
    """Filter to only Telfer-line people. Non-Telfer spouses become labels only."""
    # First pass: identify all Telfer-line people
    telfer_people = []
    seen_ids = set()

    for p in people:
        pid = p["id"]
        dn = p.get("display_name", pid)
        fn = p.get("first_name", "")
        ln = p.get("last_name", "")
        if is_telfer_name(dn) or is_telfer_name(fn) or is_telfer_name(ln) or is_telfer_name(pid):
            if pid not in seen_ids:
                telfer_people.append(p)
                seen_ids.add(pid)

    # Phase 2: add non-Telfer spouses who need to be in tree as boxes
    # (people who married INTO Telfer family and are parents of Telfer children)
    by_id = {p["id"]: p for p in telfer_people}
    print(f"   First pass: {len(telfer_people)} Telfer people. Checking for essential non-Telfer spouses...")
    added_in_pass2 = 0
    for p in telfer_people:
        for s in p.get("spouses", []):
            s_clean = re.sub(r'\s*\(m\..*?\)', '', s).strip()
            s_clean = re.sub(r'\s*\(née.*?\)', '', s_clean).strip()
            s_clean = re.sub(r'\s*\(adoptive.*?\)', '', s_clean).strip()
            s_clean = s_clean.replace("(deceased)", "").strip()
            s_clean = re.sub(r'\s*\(divorced\)', '', s_clean).strip()
            # See if we can match this spouse
            for op in people:
                if op["id"] not in seen_ids:
                    op_name = op.get("display_name", op["id"]).lower()
                    if s_clean.lower() in op_name or op_name in s_clean.lower():
                        # Check if they had children with the Telfer person
                        # If they'ver a parent of any person in telfer_people, add them
                        children_of_spouse = set()
                        for child_p in telfer_people:
                            for parent in child_p.get("parents", []):
                                if s_clean.lower() in parent.lower():
                                    children_of_spouse.add(child_p["id"])
                        if children_of_spouse:
                            telfer_people.append(op)
                            seen_ids.add(op["id"])
                            added_in_pass2 += 1
                            break

    print(f"   Phase 2: added {added_in_pass2} essential non-Telfer spouses")

    print(f"📊 Telfer filter: {len(telfer_people)} people kept (from {len(people)})")
    return telfer_people


# ─── TREE BUILDING ────────────────────────────────────────────
def normalize_spouse_generations(generation_map, spouse_map, by_id, child_map):
    """After BFS, make spouses the same generation (use the shallower one).
    Only adjusts pairs that are actually co-parents (share a child).
    Single pass — no cascade."""
    changes = 0
    for pid, spouses in spouse_map.items():
        if pid not in generation_map:
            continue
        p_gen = generation_map[pid]
        for spid in spouses:
            if spid not in generation_map:
                continue
            s_gen = generation_map[spid]
            if s_gen == p_gen:
                continue
            # Only adjust if they share a child (co-parents)
            p_kids = set(child_map.get(pid, []))
            s_kids = set(child_map.get(spid, []))
            if not (p_kids & s_kids):
                continue
            # Only adjust if gap ≤ 2 (bigger gaps = data error, not normalization)
            gap = abs(s_gen - p_gen)
            if gap > 2:
                continue
            # Move deeper spouse to shallower's generation
            if s_gen > p_gen:
                generation_map[spid] = p_gen
                changes += 1
            else:
                generation_map[pid] = s_gen
                changes += 1
    if changes:
        print(f"   Spouse normalization: {changes} adjustments")
    return generation_map


def build_tree(people, by_id, by_display_name, by_display_lower, child_map, spouse_map):
    """Build the tree: assign generations, find roots, place everyone via BFS+revisit."""
    generation_map = {}
    tree_children = defaultdict(list)
    visited = set()
    roots = set()

    # Phase 1: Find roots (people with no known parents)
    print(f"   Phase 1: Finding roots among {len(people)} people...")
    for p in people:
        pid = p["id"]
        parents_list = p.get("parents", [])
        clean_parents = [re.sub(r'\s*\(adoptive\)', '', re.sub(r'\s*\(adopted\)', '', pp)).strip()
                         for pp in parents_list
                         if pp.strip() and pp.strip() not in ["?", "Unknown", "[unknown]"]]
        if not clean_parents:
            if pid not in child_map or not child_map[pid]:
                # Has no children either — isolated person, still a root
                pass
            roots.add(pid)
        else:
            has_known_parent = False
            for cp in clean_parents:
                matches = match_person(cp, by_id, by_display_name, by_display_lower)
                if matches:
                    has_known_parent = True
                    break
            if not has_known_parent:
                roots.add(pid)

    # Make sure James Telfer (1761) is root and first
    primary_root = "James Telfer (1761\u20131845)"
    if primary_root in by_id and primary_root not in roots:
        roots.add(primary_root)

    # Sort roots by birth year (oldest first)
    def get_by(pid):
        p = by_id.get(pid)
        return p.get("birth_year") if p and p.get("birth_year") is not None else 9999
    roots = sorted(roots, key=get_by)

    # Place primary root first
    root_list = list(roots)
    if primary_root in root_list:
        root_list.remove(primary_root)
        root_list.insert(0, primary_root)

    # Phase 2: BFS from roots — first assignment sticks, no revisit cascade
    queue = deque()
    for r in root_list:
        generation_map[r] = 0
        visited.add(r)
        queue.append(r)

    while queue:
        pid = queue.popleft()
        pgen = generation_map[pid]

        for cid in list(child_map.get(pid, set())):
            if cid not in by_id:
                continue
            if cid not in visited:
                visited.add(cid)
                generation_map[cid] = pgen + 1
                tree_children[pid].append(cid)
                queue.append(cid)
    print(f"   BFS placed {len(generation_map)} people across {len(set(generation_map.values()))} generations")

    # ── Post-BFS root spouse fix ──
    # Move roots who are spouses of already-placed people to match their partner's gen
    # This is SAFE because it only moves people who have a spouse at a deeper generation
    for pid in list(generation_map.keys()):
        pgen = generation_map[pid]
        if pgen != 0:
            continue
        spouses = spouse_map.get(pid, set())
        for spid in spouses:
            if spid not in generation_map:
                continue
            sgen = generation_map[spid]
            if sgen > pgen:
                generation_map[pid] = sgen
                # Cascade any children that were placed one below
                for cid in list(tree_children.get(pid, [])):
                    if cid in generation_map and generation_map[cid] == pgen + 1:
                        generation_map[cid] = sgen + 1

    # Also try matching spouse strings that failed ID matching (e.g. "Francis Telfer (3rd wife)")
    for p in list(by_id.values()):
        pid = p['id']
        if pid not in generation_map or generation_map[pid] != 0:
            continue
        for sp_str in p.get('spouses', []):
            # Extract clean name from strings like "Francis Telfer (3rd wife)"
            sp_clean = re.sub(r'\s*\(\d+(?:st|nd|rd|th) [^)]*\)', '', sp_str).strip()
            if sp_clean == sp_str:
                continue
            sp_norm = sp_clean.replace('\u2013', '-').replace('\u2014', '-')
            for id2, p2 in by_id.items():
                id_norm = id2.replace('\u2013', '-').replace('\u2014', '-')
                if id_norm == sp_norm and id2 in generation_map:
                    sgen = generation_map[id2]
                    if sgen > generation_map[pid]:
                        generation_map[pid] = sgen
                    break

    # Phase 3: Add children via children[] as fallback — first assignment only
    for p in people:
        pid = p["id"]
        if pid not in visited:
            continue
        for child_name in p.get("children", []):
            child_name = child_name.strip()
            if not child_name or child_name in ["?", "[unknown]"]:
                continue
            if "10 children" in child_name.lower():
                continue
            cby = None
            pp = by_id.get(pid)
            if pp:
                cby = pp.get("birth_year")
                if cby is not None:
                    cby = cby + 20
            matches = match_person(child_name, by_id, by_display_name, by_display_lower, cby)
            for cm in matches:
                cid = cm["id"]
                if cid not in visited:
                    pgen = generation_map.get(pid, 0)
                    visited.add(cid)
                    generation_map[cid] = pgen + 1
                    tree_children[pid].append(cid)
                    queue.append(cid)

    # Phase 4: Also check for adoptive parent connections
    for p in people:
        pid = p["id"]
        if pid not in visited:
            continue
        for parent_name in p.get("parents", []):
            if "(adoptive)" in parent_name.lower() or "(adopted)" in parent_name.lower():
                clean_name = re.sub(r'\s*\(adoptive\)', '', parent_name).strip()
                clean_name = re.sub(r'\s*\(adopted\)', '', clean_name).strip()
                pby = p.get("birth_year")
                matches = match_person(clean_name, by_id, by_display_name, by_display_lower, pby)
                for m in matches:
                    if m["id"] not in visited:
                        continue
                    cid = pid
                    if cid not in visited:
                        pgen = generation_map.get(m["id"], 0)
                        new_gen = pgen + 1
                        visited.add(cid)
                        generation_map[cid] = new_gen
                        tree_children[m["id"]].append(cid)
                    else:
                        pgen = generation_map.get(m["id"], 0)
                        new_gen = pgen + 1
                        existing_gen = generation_map.get(cid, 0)
                        if new_gen > existing_gen:
                            generation_map[cid] = new_gen
                            if cid not in tree_children[m["id"]]:
                                tree_children[m["id"]].append(cid)

    # Phase 4: Place unplaced spouses at their partner's generation
    # Many people have no parent link but are linked as spouses — place them alongside their partner
    for pid, spouses in spouse_map.items():
        if pid not in generation_map:
            continue
        pgen = generation_map[pid]
        for spid in spouses:
            if spid not in by_id or spid in generation_map:
                continue
            visited.add(spid)
            generation_map[spid] = pgen
            print(f"   Placed spouse {by_id[spid].get('display_name', spid)} at gen {pgen}")

    # Phase 5: Cascade — children of newly-placed spouses
    # A new generation loop until no more placements
    changed = True
    while changed:
        changed = False
        for pid in list(generation_map.keys()):
            pgen = generation_map[pid]
            for cid in list(child_map.get(pid, set())):
                if cid not in by_id or cid in generation_map:
                    continue
                visited.add(cid)
                generation_map[cid] = pgen + 1
                tree_children[pid].append(cid)
                changed = True

    # Sort children by birth year within each family
    for pid in tree_children:
        cids = tree_children[pid]
        cids.sort(key=lambda cid: (
            by_id[cid].get("birth_year") if by_id[cid].get("birth_year") is not None else 9999,
            cid
        ))

    # Normalize spouse generations — disabled due to false spouse links in data
    # causing flattening cascade. BFS already assigns correct generations.
    print(f"   Skipping spouse normalization (BFS generations are authoritative)")
    # generation_map = normalize_spouse_generations(generation_map, spouse_map, by_id, child_map)
    print(f"   Done normalizing")

    unplaced = [p["id"] for p in people if p["id"] not in visited]
    return generation_map, tree_children, root_list, unplaced


# ─── HELPERS ──────────────────────────────────────────────────
def is_direct_line(pid):
    return pid in DIRECT_LINE_IDS


def get_box_size(pid):
    if is_direct_line(pid):
        return HL_BOX_W, HL_BOX_H
    return BOX_W, BOX_H


def get_lifespan(p):
    by = p.get("birth_year_display", "?")
    dy = p.get("death_year_display", "?")
    if p.get("is_living", False):
        dy = "living"
    if dy == "?" and p.get("is_living"):
        dy = "living"
    lifespan = f"{by} \u2013 {dy}"
    if lifespan == "? \u2013 ?":
        return ""
    return lifespan


def get_short_name(p, max_len=20):
    dn = p.get("display_name", "?")
    if len(dn) > max_len:
        parts = dn.split()
        if len(parts) >= 2:
            dn = f"{parts[0]} {parts[-1]}"
        else:
            dn = dn[:max_len-1] + "\u2026"
    return dn


def get_spouse_names(p, by_id, by_display_name, by_display_lower):
    spouses = p.get("spouses", [])
    names = []
    for s in spouses:
        s = s.strip()
        if not s:
            continue
        s_clean = re.sub(r'\s*\(m\..*?\)', '', s).strip()
        s_clean = re.sub(r'\s*\(n\u00e9e.*?\)', '', s_clean).strip()
        s_clean = re.sub(r'\s*\(adoptive.*?\)', '', s_clean).strip()
        s_clean = s_clean.replace("(deceased)", "").strip()
        s_clean = re.sub(r'\s*\(divorced\)', '', s_clean).strip()
        matched = match_person(s_clean, by_id, by_display_name, by_display_lower)
        if matched:
            name = get_short_name(matched[0], 20)
        else:
            name = s_clean
        if len(name) > 22:
            name = name[:20] + "\u2026"
        names.append(name)
    return names


def is_female(p):
    for s in p.get("spouses", []):
        s_lower = s.lower()
        if "husband" in s_lower:
            return True
        if "wife" in s_lower:
            return False
    for rel in p.get("relationships", []):
        if rel.get("type") == "Spouse":
            for n in rel.get("names", []):
                if "(m." in n.lower() or " m." in n.lower():
                    return False
    first_name = p.get("first_name", "").lower()
    known_female = ["elizabeth", "margaret", "mary", "amy", "susan", "clarice",
                    "gladys", "ethel", "doris", "emily", "kathryn", "kylie",
                    "zabella", "shirley", "sheryle", "penny", "caroline",
                    "hannah", "sophia", "carissa", "angela", "robyn", "robin",
                    "isabella", "maria", "clara", "alma", "lauren", "kristin",
                    "jean", "agnes", "martha", "jane", "esther", "anna",
                    "amelia", "elsie", "pearl", "hope", "violet", "mabel",
                    "edna", "minnie", "fanny", "susanna", "charlotte",
                    "lilian", "may", "ada", "florence", "gertrude",
                    "catherine", "ann", "christian", "janet", "isobel",
                    "betty", "dinah", "hannah", "sarah", "sandra"]
    known_male = ["james", "john", "robert", "william", "francis", "george",
                  "charles", "edwin", "walter", "albert", "ernest", "malcolm",
                  "murray", "timothy", "mark", "mitchell", "levi", "david",
                  "grantley", "daryll", "douglas", "colin", "alan",
                  "freddy", "jared", "joel", "aaron", "paul", "peter",
                  "jono", "nick", "kristin", "rex", "amanda", "howard",
                  "sydney", "hugh", "adam", "henry", "joseph", "alexander",
                  "thomas", "andrew", "samuel", "alfred", "edward", "edwin",
                  "edgerston", "vernon", "ray", "st", "clair"]
    if first_name in known_female:
        return True
    if first_name in known_male:
        return False
    return False


# ─── SVG LAYOUT ───────────────────────────────────────────────
def box_svg(x, y, w, h, name, lifespan, is_hl, female, living, spouse_name=""):
    lines = []
    if is_hl:
        stroke = ACCENT
        sw = 2
    elif living:
        stroke = GREEN_BORDER
        sw = 1.5
    elif female:
        stroke = FEMALE_BORDER
        sw = 1.5
    else:
        stroke = BOX_BORDER
        sw = 1.5
    fill = FEMALE_BG if female else BOX_BG
    lines.append(f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    if living:
        lines.append(f'    <circle cx="{x + w - 10}" cy="{y + 8}" r="4" fill="{GREEN_BORDER}"/>')
    display_name = ("\u2605 " if is_hl else "") + name
    name_fs = 13 if len(display_name) <= 20 else 11
    lines.append(f'    <text x="{x + w//2}" y="{y + h//2 - 4}" text-anchor="middle" fill="{ACCENT if is_hl else TEXT}" font-family="Arial, sans-serif" font-size="{name_fs}" font-weight="bold">{esc(display_name)}</text>')
    if lifespan:
        span_fs = 11 if len(lifespan) <= 15 else 10
        lines.append(f'    <text x="{x + w//2}" y="{y + h//2 + 13}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="{span_fs}">{esc(lifespan)}</text>')
    if spouse_name:
        lines.append(f'    <text x="{x + w//2}" y="{y + h + 3}" text-anchor="middle" fill="{SPOUSE_LINE}" font-family="Arial, sans-serif" font-size="9">\u269b {esc(spouse_name)}</text>')
    return lines


def esc(text):
    if isinstance(text, str):
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&apos;')
    return str(text)


def build_svg(people, by_id, by_display_name, by_display_lower, generation_map, tree_children, roots, unplaced, spouse_map):
    svg_lines = []
    CANVAS_W = 3200

    svg_lines.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS_W} 2000" width="100%" height="100%" style="background-color:#1a2536;">')
    svg_lines.append('  <defs>')
    svg_lines.append('    <style>')
    svg_lines.append('      .title { font-family: "Georgia", serif; font-size: 24px; fill: #d4a843; font-weight: bold; }')
    svg_lines.append('      .subtitle { font-family: "Arial", sans-serif; font-size: 12px; fill: #99aabb; }')
    svg_lines.append('      .gen-label { font-family: "Arial", sans-serif; font-size: 12px; fill: #1a5276; font-weight: bold; }')
    svg_lines.append('      .not-placed { font-family: "Arial", sans-serif; font-size: 11px; fill: #ff6b6b; }')
    svg_lines.append('    </style>')
    svg_lines.append('  </defs>')
    svg_lines.append('  <rect width="100%" height="100%" fill="#1a2536"/>')

    y = PADDING
    placed_count = len(generation_map)
    max_gen = max(generation_map.values()) if generation_map else 0

    # Title
    svg_lines.append(f'  <text x="{CANVAS_W//2}" y="{y}" text-anchor="middle" class="title">Telfer Family Tree \u2014 Direct Lineage</text>')
    y += 22
    svg_lines.append(f'  <text x="{CANVAS_W//2}" y="{y}" text-anchor="middle" class="subtitle">{placed_count} Telfer-line people across {max_gen+1} generations</text>')
    y += 35

    # Group by generation
    people_by_gen = defaultdict(list)
    for pid, gen in generation_map.items():
        people_by_gen[gen].append(pid)

    for gen in people_by_gen:
        people_by_gen[gen].sort(key=lambda pid: (
            by_id[pid].get("birth_year") if by_id[pid].get("birth_year") is not None else 9999,
            by_id[pid].get("display_name", "")
        ))

    # Build child_family_map
    child_family_map = {}
    for pid, cids in tree_children.items():
        for cid in cids:
            if cid not in child_family_map:
                child_family_map[cid] = pid

    # Track positions
    x_pos = {}
    CANVAS_CENTER = CANVAS_W // 2

    # Compute subtree widths
    def compute_subtree_width(pid, visited_set):
        bw, _ = get_box_size(pid)
        if pid not in tree_children or not tree_children[pid]:
            return bw
        total = 0
        for cid in tree_children[pid]:
            if cid in visited_set:
                continue
            visited_set.add(cid)
            total += compute_subtree_width(cid, visited_set)
            visited_set.discard(cid)
        total += (len(tree_children[pid]) - 1) * GAP_X
        return max(total, bw)

    subtree_widths = {}
    for pid in list(tree_children.keys()):
        subtree_widths[pid] = compute_subtree_width(pid, {pid})

    # Find spouse pairs per generation
    drawn_spouse_pairs = set()
    gen_couples = defaultdict(list)

    for gen in range(max_gen + 1):
        if gen not in people_by_gen:
            continue
        gen_people = people_by_gen[gen]
        couples = []
        singles = list(gen_people)
        for pid in gen_people:
            for spid in spouse_map.get(pid, set()):
                if spid in gen_people and spid != pid:
                    pair = tuple(sorted([pid, spid]))
                    if pair not in drawn_spouse_pairs:
                        drawn_spouse_pairs.add(pair)
                        couples.append(pair)
                        if pid in singles:
                            singles.remove(pid)
                        if spid in singles:
                            singles.remove(spid)
        gen_couples[gen] = couples

    # ─── LAYOUT: Generation 0 (roots) ───
    gen0 = people_by_gen.get(0, [])
    if gen0:
        total_w = 0
        items = []
        placed_ids = set()
        for p1, p2 in gen_couples.get(0, []):
            w1, _ = get_box_size(p1)
            w2, _ = get_box_size(p2)
            total_w += w1 + GAP_COUPLE_H + w2 + 40
            items.append((p1, w1, True, 0))
            items.append((p2, w2, True, 1))
            placed_ids.add(p1)
            placed_ids.add(p2)
        for pid in gen0:
            if pid not in placed_ids:
                w, _ = get_box_size(pid)
                total_w += w + 40
                items.append((pid, w, False, 0))
        total_w -= 40
        start_x = CANVAS_CENTER - total_w // 2
        cx = start_x
        for item in items:
            pid = item[0]
            w = item[1]
            x_pos[pid] = cx + w // 2
            cx += w + 40

    # ─── LAYOUT: Subsequent generations under parents ───
    for gen in range(1, max_gen + 1):
        if gen not in people_by_gen:
            continue
        gen_people = people_by_gen[gen]
        children_by_parent = defaultdict(list)
        for pid in gen_people:
            if pid in child_family_map:
                parent = child_family_map[pid]
                children_by_parent[parent].append(pid)

        placed_in_gen = set()
        for parent, cids in children_by_parent.items():
            if parent not in x_pos:
                continue
            px = x_pos[parent]
            c_total_w = sum(get_box_size(cid)[0] for cid in cids)
            c_total_w += (len(cids) - 1) * GAP_X
            c_start_x = px - c_total_w // 2
            for i, cid in enumerate(cids):
                bw_c, _ = get_box_size(cid)
                x_pos[cid] = c_start_x + bw_c // 2 + i * (bw_c + GAP_X)
                placed_in_gen.add(cid)

        # Place remaining (spouses next to partners)
        remaining = [pid for pid in gen_people if pid not in placed_in_gen]
        for p1, p2 in gen_couples.get(gen, []):
            if p1 in x_pos and p2 not in x_pos:
                w1, _ = get_box_size(p1)
                w2, _ = get_box_size(p2)
                x_pos[p2] = x_pos[p1] + w1 // 2 + GAP_COUPLE_H + w2 // 2
                if p2 in remaining:
                    remaining.remove(p2)
            elif p2 in x_pos and p1 not in x_pos:
                w1, _ = get_box_size(p1)
                w2, _ = get_box_size(p2)
                x_pos[p1] = x_pos[p2] - w2 // 2 - GAP_COUPLE_H - w1 // 2
                if p1 in remaining:
                    remaining.remove(p1)

        if remaining:
            rightmost = max([x_pos.get(pid, 0) + get_box_size(pid)[0] // 2
                           for pid in x_pos], default=CANVAS_CENTER)
            rightmost += GAP_X
            for pid in remaining:
                bw, _ = get_box_size(pid)
                x_pos[pid] = rightmost + bw // 2
                rightmost += bw + GAP_X

    # Ensure all have x positions
    for gen in range(max_gen + 1):
        if gen not in people_by_gen:
            continue
        for pid in people_by_gen[gen]:
            if pid not in x_pos:
                bw, _ = get_box_size(pid)
                x_pos[pid] = CANVAS_CENTER

    # ─── AUTO-CALCULATE CANVAS WIDTH ───
    all_x = []
    for pid, pos in x_pos.items():
        bw, _ = get_box_size(pid)
        all_x.append(pos - bw // 2)   # left edge
        all_x.append(pos + bw // 2)   # right edge
    if all_x:
        min_x = min(all_x)
        max_x = max(all_x)
        CANVAS_W = max_x - min_x + 4 * PADDING  # extra breathing room
        offset = -min_x + 2 * PADDING
        # Shift all x positions so tree starts at 2*PADDING from left
        for pid in x_pos:
            x_pos[pid] += offset
        CANVAS_CENTER = CANVAS_W // 2

    # ─── RESOLVE OVERLAPS (per generation) ───
    for gen in range(max_gen + 1):
        if gen not in people_by_gen:
            continue
        gen_people_sorted = sorted(
            [p for p in people_by_gen[gen] if p in x_pos],
            key=lambda p: x_pos[p]
        )
        # Nudge overlapping boxes apart
        for i in range(1, len(gen_people_sorted)):
            prev = gen_people_sorted[i-1]
            curr = gen_people_sorted[i]
            bw_prev, _ = get_box_size(prev)
            bw_curr, _ = get_box_size(curr)
            prev_right = x_pos[prev] + bw_prev // 2
            curr_left = x_pos[curr] - bw_curr // 2
            min_gap = GAP_X
            overlap = prev_right + min_gap - curr_left
            if overlap > 0:
                x_pos[curr] += overlap

    # ─── DRAW GENERATION ROWS ───
    row_positions = {}
    current_y = y

    gen_labels = {
        0: "GEN 0 \u2014 Founder",
        1: "GEN 1",
        2: "GEN 2",
        3: "GEN 3",
        4: "GEN 4",
        5: "GEN 5",
        6: "GEN 6",
        7: "GEN 7",
        8: "GEN 8",
        9: "GEN 9",
        10: "GEN 10",
    }

    for gen in range(max_gen + 1):
        if gen not in people_by_gen:
            continue
        gen_people = people_by_gen[gen]
        if not gen_people:
            continue

        label = gen_labels.get(gen, f"GEN {gen}")
        svg_lines.append(f'  <text x="30" y="{current_y + 15}" class="gen-label">{esc(label)}</text>')

        max_bh = max(get_box_size(pid)[1] for pid in gen_people if pid in x_pos)
        y_box = current_y + 25

        for pid in gen_people:
            if pid in x_pos:
                bw, bh = get_box_size(pid)
                row_positions[pid] = (x_pos[pid], y_box, y_box + bh, bw, bh)

        # Draw boxes
        for pid in gen_people:
            if pid not in x_pos:
                continue
            p = by_id[pid]
            bx = x_pos[pid]
            bw, bh = get_box_size(pid)
            hl = is_direct_line(pid)
            female = is_female(p)
            living = p.get("is_living", False)
            name = get_short_name(p)
            lifespan = get_lifespan(p)
            spouse_names = get_spouse_names(p, by_id, by_display_name, by_display_lower)
            spouse_name = spouse_names[0] if spouse_names else ""
            bx_adj = bx - bw // 2
            lines = box_svg(bx_adj, y_box, bw, bh, name, lifespan, hl, female, living, spouse_name)
            svg_lines.extend(lines)

        # Spouse connector lines
        for p1, p2 in gen_couples.get(gen, []):
            if p1 in x_pos and p2 in x_pos:
                bw1, bh1 = get_box_size(p1)
                bw2, bh2 = get_box_size(p2)
                x1 = x_pos[p1] + bw1 // 2
                x2 = x_pos[p2] - bw2 // 2
                yc = y_box + bh1 // 2
                svg_lines.append(f'    <line x1="{x1}" y1="{yc}" x2="{x2}" y2="{yc}" stroke="{SPOUSE_LINE}" stroke-width="1.5"/>')

        current_y = y_box + max_bh + GEN_GAP

    # ─── DRAW PARENT-CHILD CONNECTOR LINES ───
    for pid, cids in tree_children.items():
        if pid not in row_positions:
            continue
        px, py_top, py_bottom, pbw, pbh = row_positions[pid]
        px_center = px
        child_pos = []
        for cid in cids:
            if cid in row_positions:
                c_info = row_positions[cid]
                py_child = c_info[1]
                child_pos.append((c_info[0], py_child, c_info[3]))
        if not child_pos:
            continue

        bar_y = (py_bottom + child_pos[0][1]) // 2
        if bar_y - py_bottom < 10:
            bar_y = py_bottom + 10
        if child_pos[0][1] - bar_y < 10:
            bar_y = child_pos[0][1] - 10

        svg_lines.append(f'    <line x1="{px}" y1="{py_bottom}" x2="{px}" y2="{bar_y}" stroke="{CONNECTOR}" stroke-width="1.5"/>')

        if len(child_pos) > 1:
            all_cx = [c[0] for c in child_pos]
            min_cx = min(all_cx)
            max_cx = max(all_cx)
            svg_lines.append(f'    <line x1="{min_cx}" y1="{bar_y}" x2="{max_cx}" y2="{bar_y}" stroke="{CONNECTOR}" stroke-width="1.5"/>')

        for cx, cy, cw in child_pos:
            svg_lines.append(f'    <line x1="{cx}" y1="{bar_y}" x2="{cx}" y2="{cy}" stroke="{CONNECTOR}" stroke-width="1.5"/>')

    y_end = current_y + 20

    # ─── Not Placed ───
    if unplaced:
        y_end += 30
        svg_lines.append(f'  <text x="30" y="{y_end}" class="not-placed" font-size="14">Not Placed in Tree ({len(unplaced)} people):</text>')
        y_end += 22
        for i, upid in enumerate(sorted(unplaced)):
            up = by_id.get(upid, {})
            dn = up.get("display_name", upid)
            lifespan = get_lifespan(up)
            info = f"{dn} ({lifespan})" if lifespan else dn
            col = i % 3
            row = i // 3
            svg_lines.append(f'  <text x="{50 + col * 600}" y="{y_end + row * 18}" fill="#ff6b6b" font-family="Arial, sans-serif" font-size="10">{esc(info)}</text>')
        y_end += ((len(unplaced) // 3) + 1) * 18 + 20

    # ─── Legend ───
    y_end += 10
    svg_lines.append(f'  <text x="30" y="{y_end}" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="12" font-weight="bold">LEGEND</text>')
    y_end += 20
    svg_lines.append(f'  <rect x="35" y="{y_end}" width="12" height="12" rx="2" fill="{BOX_BG}" stroke="{ACCENT}" stroke-width="2"/>')
    svg_lines.append(f'  <text x="53" y="{y_end+10}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="10">\u2605 = Direct line (James \u2192 Francis \u2192 John \u2192 Francis Charles \u2192 Murray \u2192 Timothy \u2192 Mark)</text>')
    y_end += 18
    svg_lines.append(f'  <rect x="35" y="{y_end}" width="12" height="12" rx="2" fill="{FEMALE_BG}" stroke="{FEMALE_BORDER}" stroke-width="1.5"/>')
    svg_lines.append(f'  <text x="53" y="{y_end+10}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="10">Blue bg = Female</text>')
    y_end += 18
    svg_lines.append(f'  <circle cx="41" cy="{y_end+6}" r="4" fill="{GREEN_BORDER}"/>')
    svg_lines.append(f'  <text x="53" y="{y_end+10}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="10">Green dot = Living person</text>')
    y_end += 18
    svg_lines.append(f'  <rect x="35" y="{y_end}" width="12" height="12" rx="2" fill="none" stroke="{GREEN_BORDER}" stroke-width="1.5"/>')
    svg_lines.append(f'  <text x="53" y="{y_end+10}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="10">Green border = Living person</text>')
    y_end += 18
    svg_lines.append(f'  <text x="53" y="{y_end+10}" fill="{SPOUSE_LINE}" font-family="Arial, sans-serif" font-size="10">\u269b = Spouse name shown below person</text>')

    y_end += 30
    svg_lines.append(f'  <text x="{CANVAS_W//2}" y="{y_end}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="10">Telfer Family Tree \u2014 Telfer Lineage Only ({placed_count} people, {max_gen+1} generations)</text>')
    y_end += 20

    total_h = y_end + 20
    svg_lines.append('</svg>')

    output = '\n'.join(svg_lines)
    output = output.replace('viewBox="0 0 3200 2000"', f'viewBox="0 0 {CANVAS_W} {total_h}"')
    return output, total_h


# ─── MAIN ─────────────────────────────────────────────────────
def main():
    TELFER_ONLY = True

    data_path = os.path.expanduser("~/telfer-wiki/src/data/people.json")
    output_path = os.path.expanduser("~/telfer-wiki/public/images/family-tree-v3.svg")

    print("\U0001f4c2 Loading people data...")
    people = load_data(data_path)
    print(f"   Loaded {len(people)} people from {data_path}")

    if TELFER_ONLY:
        people = filter_telfer_only(people)

    print("\U0001f50d Building lookups...")
    by_id, by_display_name, by_display_lower, child_map, spouse_map = build_lookups(people)

    print("\U0001f4ea Building tree structure...")
    print(f"   Total child relations found: {sum(len(v) for v in child_map.values())}")
    print(f"   People with spouse relations: {len(spouse_map)}")

    generation_map, tree_children, roots, unplaced = build_tree(
        people, by_id, by_display_name, by_display_lower, child_map, spouse_map
    )

    print(f"   Roots: {len(roots)}")
    print(f"   People placed: {len(generation_map)}")
    print(f"   People unplaced: {len(unplaced)}")

    if unplaced:
        print("   Unplaced:")
        for upid in sorted(unplaced):
            up = by_id.get(upid, {})
            print(f"     - {up.get('display_name', upid)}")

    gen_dist = defaultdict(int)
    for pid, gen in generation_map.items():
        gen_dist[gen] += 1
    print("   Generation distribution:")
    for gen in sorted(gen_dist.keys()):
        print(f"     Gen {gen}: {gen_dist[gen]} people")

    print("\n\U0001f3a8 Building SVG...")
    svg_content, total_h = build_svg(
        people, by_id, by_display_name, by_display_lower,
        generation_map, tree_children, roots, unplaced, spouse_map
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(svg_content)

    print(f"\n\u2705 SVG written to {output_path}")
    print(f"\U0001f4d0 Canvas: 3200 x {total_h}")
    print(f"\U0001f4e6 Size: {len(svg_content):,} bytes")
    print(f"\U0001f464 People placed: {len(generation_map)}")
    print(f"\u26a0\ufe0f Unplaced: {len(unplaced)}")
    print(f"\U0001f4ca Generations: {max(generation_map.values()) if generation_map else 0}")


if __name__ == "__main__":
    main()
