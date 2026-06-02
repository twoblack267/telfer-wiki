#!/usr/bin/env python3
"""
Telfer Family Tree SVG Generator — v2 (Data-Driven)
Reads people.json and generates a complete family tree SVG showing EVERY person.
Uses parents[] scanning as the primary method to find children relationships.
"""

import json
import os
import re
DEBUG = True
from collections import defaultdict, OrderedDict

# ─── COLOURS ──────────────────────────────────────────────────
BG           = "#1a2536"
BOX_BG       = "#0d1b33"
BOX_BORDER   = "#2a4a7f"
ACCENT       = "#d4a843"   # Deep gold for direct line
HIGHLIGHT    = "#d4a843"
TEXT         = "#e8e8e8"
TEXT_DIM     = "#99aabb"
CONNECTOR    = "#556677"
FEMALE_BG    = "#1a2744"
FEMALE_BORDER = "#4a6fa5"
GREEN_BORDER = "#2d8a5f"
SECTION_CLR  = "#1a5276"   # Light blue for generation labels
SPOUSE_LINE  = "#6a7b8c"

# ─── CONSTANTS ────────────────────────────────────────────────
BOX_W = 140
BOX_H = 45
HL_BOX_W = 150
HL_BOX_H = 55
GAP_X = 16          # Horizontal gap between sibling boxes
GEN_GAP = 70        # Vertical gap between generations
BAR_GAP = 30        # Space below parent box for connector bar
PADDING = 30

GAP_COUPLE_H = 18   # Horizontal gap between couple boxes

# Direct ancestor line IDs (for highlighting)
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
    """Try to match a name string to a person. Returns list of matching person dicts."""
    name = name.strip()
    if not name or name == "?":
        return []
    
    # Normalize dashes
    name_norm = name.replace('–', '-').replace('—', '-')

    # 1. Try exact ID match (with normalized dashes)
    for pid, p in by_id.items():
        if pid.replace('–', '-').replace('—', '-') == name_norm:
            return [p]
    if name in by_id:
        return [by_id[name]]

    # Helper: filter matches for biological plausibility, return single best
    def plausible_matches(matches, child_birth_year):
        """If child_birth_year given, return the single most plausible parent (15-55 years older).
        If none plausible, return empty list."""
        if child_birth_year is None or not matches:
            return matches  # Return all if no filter criteria
        plausible = []
        unknown_birth = []
        for mp in matches:
            by = mp.get("birth_year")
            if by is None:
                unknown_birth.append(mp)  # Can't rule out — unknown birth year
            elif 15 < child_birth_year - by < 55:
                plausible.append(mp)
        if len(plausible) == 1:
            return plausible
        if len(plausible) > 1:
            # Pick closest in age to the child
            plausible.sort(key=lambda mp: abs(child_birth_year - mp["birth_year"]))
            return plausible[:1]
        # If no clearly plausible but some have unknown birth, return one of those
        if unknown_birth:
            return unknown_birth[:1]
        return []  # No plausible matches

    # 2. Try exact display_name match
    if name in by_display_name:
        matches = by_display_name[name]
        filtered = plausible_matches(matches, child_birth_year)
        if filtered:
            return filtered[:1]
        # If no plausible but we have matches and no child_birth_year, return first
        if child_birth_year is None:
            return matches[:1]
        # No plausible with child_birth_year — fall through to fuzzy methods

    # 3. Try lowercase exact
    nl = name.lower()
    if nl in by_display_lower:
        matches = by_display_lower[nl]
        filtered = plausible_matches(matches, child_birth_year)
        if filtered:
            return filtered[:1]
        # If no plausible with child_birth_year, fall through to fuzzy methods
        if child_birth_year is not None:
            pass  # Keep going to step 4-6
        elif len(matches) > 0:
            return matches[:1]

    # 4. Remove parentheticals and try again
    stripped = re.sub(r'\s*\(.*?\)\s*', '', name).strip()
    if stripped and stripped != name:
        result = match_person(stripped, by_id, by_display_name, by_display_lower, child_birth_year)
        if result:
            return result

    # 5. Normalize dashes in by_display_lower keys and retry
    for dn_key, plist in list(by_display_lower.items()):
        if dn_key.replace('–', '-').replace('—', '-') == name_norm.lower():
            filtered = plausible_matches(plist, child_birth_year)
            if filtered:
                return filtered[:1]
            # No plausible match — fall through to prefix matching

    # 6. Match by first 1-3 words (try fewer words first for broader matches)
    words = name.split()
    # Collect matches from all word lengths, prefer plausible
    all_matches = []
    for n_words in range(1, min(4, len(words) + 1)):
        prefix = ' '.join(words[:n_words]).lower()
        prefix = prefix.replace('–', '-').replace('—', '-')
        for dn, plist in by_display_lower.items():
            dn_norm = dn.replace('–', '-').replace('—', '-')
            if dn_norm.startswith(prefix):
                for p in plist:
                    if p not in all_matches:
                        all_matches.append(p)
    
    if all_matches:
        filtered = plausible_matches(all_matches, child_birth_year)
        if filtered:
            return filtered[:1]
        return all_matches[:1]

    return []


def build_lookups(people):
    """
    Build lookup structures.
    Returns (by_id, by_display_name, by_display_lower, child_map, spouse_map)
    """
    by_id = {}
    by_display_name = defaultdict(list)
    by_display_lower = defaultdict(list)

    for p in people:
        pid = p["id"]
        by_id[pid] = p
        dn = p["display_name"]
        by_display_name[dn].append(p)
        by_display_lower[dn.lower().strip()].append(p)
        by_display_lower[pid.lower().strip()].append(p)
        # Also index by normalized dashes
        by_display_lower[dn.lower().strip().replace('–', '-').replace('—', '-')].append(p)
        by_display_lower[pid.lower().strip().replace('–', '-').replace('—', '-')].append(p)

    # Build child_map by scanning EVERY person's parents[] array
    child_map = defaultdict(set)

    for p in people:
        pid = p["id"]
        child_birth = p.get("birth_year")
        for parent_name in p.get("parents", []):
            parent_name = parent_name.strip()
            if not parent_name or parent_name == "?" or parent_name.startswith("(unverified"):
                continue
            matched = match_person(parent_name, by_id, by_display_name, by_display_lower, child_birth)
            if not matched:
                print(f'  ⚠️  UNMATCHED parent: \"{parent_name}\" → child: \"{pid}\" (b.{child_birth})')
            for mp in matched:
                child_map[mp["id"]].add(pid)

    # Build spouse_map bidirectionally
    spouse_map = defaultdict(set)
    for p in people:
        pid = p["id"]
        for sname in p.get("spouses", []):
            sname_clean = re.sub(r'\s*\(m\..*?\)', '', sname).strip()
            sname_clean = re.sub(r'\s*\(née.*?\)', '', sname_clean).strip()
            sname_clean = re.sub(r'\s*\(adoptive.*?\)', '', sname_clean).strip()
            sname_clean = re.sub(r'\s*\(deceased\)', '', sname_clean).strip()
            matched = match_person(sname_clean, by_id, by_display_name, by_display_lower)
            for mp in matched:
                if mp["id"] != pid:
                    spouse_map[pid].add(mp["id"])
                    spouse_map[mp["id"]].add(pid)

    # Fallback: use children[] arrays to connect people NOT linked by parents[] scanning
    # Strategy: for each child entry, extract name and years, then try smart matching
    def extract_child_name_years(entry):
        """Extract (name_part, year_start, year_end) from a child entry like 'James (1796–1863)'"""
        m = re.match(r'^(.+?)\s*\((\d{4})\s*(?:–|-)\s*(\d{4}|\?|)\)', entry)
        if m:
            return m.group(1).strip(), int(m.group(2)), m.group(3)
        # Just a name with no years
        return entry.strip(), None, None

    def match_child_entry(entry, by_id, by_display_name, by_display_lower, parent_birth_year):
        """Smart match a child entry to a person. Returns person or None."""
        name_part, year_start, year_end = extract_child_name_years(entry)
        
        # Strategy 1: If we have a year, construct potential IDs and try exact match
        if year_start is not None:
            # Try matching by year alone first (most reliable)
            candidates = []
            for pid, p in by_id.items():
                py = p.get("birth_year")
                if py is not None and py == year_start:
                    candidates.append(p)
            if len(candidates) == 1:
                return candidates[0]
            if len(candidates) > 1:
                # Filter by name match
                name_lower = name_part.lower()
                for c in candidates:
                    if name_lower in c['id'].lower() or name_lower in c['display_name'].lower():
                        return c
        
        # Strategy 2: Try exact display_name match on the full name
        if name_part in by_display_name:
            matches = by_display_name[name_part]
            if len(matches) == 1:
                return matches[0]
            if parent_birth_year is not None:
                for m in matches:
                    by = m.get("birth_year")
                    if by is not None and 15 < by - parent_birth_year < 55:
                        return m
        
        # Strategy 3: Try fuzzy prefix matching, restricted by birth year
        name_lower = name_part.lower()
        candidates = []
        for pid, p in by_id.items():
            pid_lower = pid.lower()
            dn_lower = p['display_name'].lower()
            # Check if ALL words in name_part appear in the person's ID or display_name
            words = name_lower.split()
            all_words_match = all(w in pid_lower or w in dn_lower for w in words if len(w) > 1)
            if all_words_match:
                # Check birth year plausibility
                if parent_birth_year is not None:
                    by = p.get("birth_year")
                    if by is not None and 15 < by - parent_birth_year < 55:
                        candidates.append(p)
                    elif by is None:
                        candidates.append(p)  # Unknown birth — can't rule out
                else:
                    candidates.append(p)
        
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            # Pick closest in age to parent
            if parent_birth_year is not None:
                candidates.sort(key=lambda mp: abs(mp.get("birth_year", 0) - parent_birth_year) if mp.get("birth_year") else float('inf'))
                return candidates[0]
            return candidates[0]
        
        return None

    for p in people:
        pid = p["id"]
        parent_birth = p.get("birth_year")
        children_names = p.get("children", [])
        if not children_names:
            continue
        for child_entry in children_names:
            if not child_entry.strip():
                continue
            child_p = match_child_entry(child_entry, by_id, by_display_name, by_display_lower, parent_birth)
            if child_p is not None:
                cid = child_p["id"]
                # Only add if not already connected via parents[] scanning
                # AND child has no linked parents (root)
                if cid not in child_map.get(pid, set()):
                    child_has_linked_parents = any(
                        pn.strip() and pn.strip() != "?"
                        for pn in child_p.get("parents", [])
                    )
                    if not child_has_linked_parents:
                        child_map[pid].add(cid)
                        debug_name = child_entry
                        if DEBUG:
                            print(f'  children[]: {pid} -> {cid} (via "{debug_name}")')

    if DEBUG:
        print(f'  James children (after fallback): {len(child_map.get("James Telfer (1761–1845)", set()))}')
        for cid in sorted(child_map.get('James Telfer (1761–1845)', set())):
            print(f'    {cid}')

    # Debug: check specific connections
    if DEBUG:
        for pid in ['James Telfer (1761–1845)', 'James Telfer (1796–1863)', 
                     'Francis Telfer (1809–1895)', 'John Telfer (1847–1929)',
                     'Francis Charles Telfer (1875–1954)', 'Murray John Telfer (1924–2009)',
                     'Timothy Neil Telfer (1959–?)', 'Mark Kenneth Telfer (1986–?)']:
            kids = child_map.get(pid, set())
            print(f'  child_map[{pid[:40]}]: {len(kids)} children')
            for cid in sorted(kids):
                print(f'    {cid}')

    return by_id, by_display_name, by_display_lower, child_map, spouse_map


# ─── TREE BUILDING ─────────────────────────────────────────────

def build_tree(people, by_id, by_display_name, by_display_lower, child_map, spouse_map):
    """
    Build tree structure. Returns (generation_map, tree_children, roots, unplaced).
    """
    # Phase 1: Find roots (people with no parents listed)
    # A person is a root if they have no valid parents AND no one lists them as a child in child_map
    all_children_set = set()
    for children in child_map.values():
        all_children_set.update(children)
    roots = []
    for p in people:
        pid = p["id"]
        parents = p.get("parents", [])
        valid_parents = [n for n in parents if n.strip() and n.strip() != "?"]
        if not valid_parents and pid not in all_children_set:
            if pid not in roots:
                roots.append(pid)

    # Make sure James Telfer (1761–1845) is the primary root if he exists
    primary_root = "James Telfer (1761–1845)"
    if primary_root in by_id:
        if primary_root in roots:
            roots.remove(primary_root)
        roots.insert(0, primary_root)

    # Sort remaining roots by birth year (oldest first) so deeper lineages take priority
    def root_birth_year(pid):
        p = by_id.get(pid)
        return p.get("birth_year") if p and p.get("birth_year") is not None else 9999
    if len(roots) > 1:
        sorted_tail = sorted(roots[1:], key=root_birth_year)
        roots = [roots[0]] + sorted_tail

    if DEBUG:
        print(f"  Roots (sorted): {len(roots)}")
        for r in roots[:5]:
            by = by_id.get(r, {}).get("birth_year", "?")
            print(f"    {r} (b.{by})")
        if len(roots) > 5:
            print(f"    ... and {len(roots)-5} more")

    # Phase 2: BFS from roots to place everyone (deepest generation wins)
    generation_map = {}
    tree_children = defaultdict(list)
    visited = set()

    # Queue for BFS
    queue = []
    for root in roots:
        if root in by_id and root not in visited:
            visited.add(root)
            generation_map[root] = 0
            queue.append(root)

    # Helper: try to place or deepen a child's generation
    def place_child(pid, cid, pgen):
        """Place cid as child of pid at generation pgen+1. If already placed at a
        shallower generation, update and re-queue to propagate deeper."""
        if cid not in by_id:
            return False
        new_gen = pgen + 1
        if cid not in visited:
            visited.add(cid)
            generation_map[cid] = new_gen
            tree_children[pid].append(cid)
            queue.append(cid)
            return True
        elif new_gen > generation_map.get(cid, 0):
            # Found a deeper path — update generation and re-queue
            generation_map[cid] = new_gen
            # Add parent-child link if not already present
            if cid not in tree_children.get(pid, []):
                tree_children[pid].append(cid)
            # Re-queue to propagate deeper to this node's children
            # Only add if not already in queue (simple check)
            if cid not in queue:
                queue.append(cid)
            return True
        return False

    # BFS: expand children — deepest generation wins
    while queue:
        pid = queue.pop(0)
        pgen = generation_map[pid]

        for cid in list(child_map.get(pid, set())):
            place_child(pid, cid, pgen)

    if DEBUG:
        print('  --- BFS generation map (Phase 2):')
        for pid, g in sorted(generation_map.items(), key=lambda x: x[1]):
            if g >= 2:
                print(f'    Gen {g}: {pid}')

    # Phase 3: Add spouses of placed people
    for p in people:
        pid = p["id"]
        if pid in visited:
            continue
        for spid in spouse_map.get(pid, set()):
            if spid in visited:
                visited.add(pid)
                generation_map[pid] = generation_map[spid]
                break

    # Phase 4: Fallback - try children[] arrays for unplaced people
    for p in people:
        pid = p["id"]
        if pid not in visited:
            continue
        for child_name in p.get("children", []):
            child_name = child_name.strip()
            if not child_name:
                continue
            matched = match_person(child_name, by_id, by_display_name, by_display_lower)
            for mp in matched:
                cid = mp["id"]
                if cid not in visited:
                    pgen = generation_map.get(pid, 0)
                    place_child(pid, cid, pgen)

    # BFS to expand any newly found children (deepest generation wins)
    while queue:
        pid = queue.pop(0)
        pgen = generation_map[pid]
        for cid in list(child_map.get(pid, set())):
            place_child(pid, cid, pgen)

    # Phase 5: Add remaining unvisited as isolated roots
    for p in people:
        pid = p["id"]
        if pid not in visited:
            visited.add(pid)
            generation_map[pid] = 0
            if pid not in roots:
                roots.append(pid)

    # Sort tree_children by birth year
    for pid in tree_children:
        cids = tree_children[pid]
        cids.sort(key=lambda cid: (
            by_id[cid].get("birth_year") if by_id[cid].get("birth_year") is not None else 9999,
            cid
        ))

    unplaced = [p["id"] for p in people if p["id"] not in visited]
    visited_all = set(p["id"] for p in people)
    unplaced = list(visited_all - visited)

    return generation_map, tree_children, roots, unplaced


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
    lifespan = f"{by} – {dy}"
    if lifespan == "? – ?":
        return ""
    return lifespan


def get_short_name(p, max_len=20):
    dn = p.get("display_name", "?")
    if len(dn) > max_len:
        parts = dn.split()
        # Try to abbreviate: First Last
        if len(parts) >= 2:
            dn = f"{parts[0]} {parts[-1]}"
        else:
            dn = dn[:max_len-1] + "…"
    return dn


def get_spouse_names(p, by_id, by_display_name, by_display_lower):
    """Get short spouse names for display under a person."""
    spouses = p.get("spouses", [])
    names = []
    for s in spouses:
        s = s.strip()
        if not s:
            continue
        s_clean = re.sub(r'\s*\(m\..*?\)', '', s).strip()
        s_clean = re.sub(r'\s*\(née.*?\)', '', s_clean).strip()
        s_clean = re.sub(r'\s*\(adoptive.*?\)', '', s_clean).strip()
        s_clean = s_clean.replace("(deceased)", "").strip()
        matched = match_person(s_clean, by_id, by_display_name, by_display_lower)
        if matched:
            name = get_short_name(matched[0], 20)
        else:
            name = s_clean
        if len(name) > 22:
            name = name[:20] + "…"
        names.append(name)
    return names


def is_female(p):
    """Guess if a person is female based on available data."""
    # Check spouses field for clues
    for s in p.get("spouses", []):
        s_lower = s.lower()
        if "husband" in s_lower:
            # This person lists a husband -> they are female
            return True
        if "wife" in s_lower:
            return False
    
    # Check relationships
    for rel in p.get("relationships", []):
        if rel.get("type") == "Spouse":
            for n in rel.get("names", []):
                if "(m." in n.lower() or " m." in n.lower():
                    return False  # They married INTO the family, male
    
    # Check by name patterns
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
                  "grantley", "daryll", "douglas", "colin", "alan", "robert",
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
    """Generate SVG for a single person box. Returns list of SVG lines."""
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
    
    # Living indicator
    if living:
        lines.append(f'    <circle cx="{x + w - 10}" cy="{y + 8}" r="4" fill="{GREEN_BORDER}"/>')
    
    # Name
    display_name = ("★ " if is_hl else "") + name
    name_fs = 13 if len(display_name) <= 20 else 11
    lines.append(f'    <text x="{x + w//2}" y="{y + h//2 - 4}" text-anchor="middle" fill="{ACCENT if is_hl else TEXT}" font-family="Arial, sans-serif" font-size="{name_fs}" font-weight="bold">{display_name}</text>')
    
    # Lifespan
    if lifespan:
        span_fs = 11 if len(lifespan) <= 15 else 10
        lines.append(f'    <text x="{x + w//2}" y="{y + h//2 + 13}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="{span_fs}">{lifespan}</text>')
    
    # Spouse name
    if spouse_name:
        lines.append(f'    <text x="{x + w//2}" y="{y + h + 3}" text-anchor="middle" fill="{SPOUSE_LINE}" font-family="Arial, sans-serif" font-size="9">⚭ {spouse_name}</text>')
    
    return lines


def esc(text):
    """Escape XML special characters for safe SVG text content."""
    if isinstance(text, str):
        return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace("'", '&apos;')
    return str(text)

def build_svg(people, by_id, by_display_name, by_display_lower, generation_map, tree_children, roots, unplaced, spouse_map):
    """Build complete SVG tree."""
    svg_lines = []
    
    # ─── SVG header ───
    svg_lines.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2800 2000" width="100%" height="100%" style="background-color:#1a2536;">')
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
    
    # Title
    svg_lines.append(f'  <text x="1400" y="{y}" text-anchor="middle" class="title">Telfer Family Tree — Complete Edition</text>')
    y += 22
    placed_count = len(generation_map)
    svg_lines.append(f'  <text x="1400" y="{y}" text-anchor="middle" class="subtitle">Every known person in the dataset — {placed_count} people across {max(generation_map.values())+1 if generation_map else 0} generations</text>')
    y += 35
    
    # ─── Group people by generation ───
    people_by_gen = defaultdict(list)
    for pid, gen in generation_map.items():
        people_by_gen[gen].append(pid)
    
    max_gen = max(generation_map.values()) if generation_map else 0
    
    # Sort within each generation
    for gen in people_by_gen:
        people_by_gen[gen].sort(key=lambda pid: (
            by_id[pid].get("birth_year") if by_id[pid].get("birth_year") is not None else 9999,
            by_id[pid].get("display_name", "")
        ))
    
    # ─── Build family groupings ───
    # child_family_map: child_id -> parent_id (which family they belong to)
    child_family_map = {}
    for pid, cids in tree_children.items():
        for cid in cids:
            if cid not in child_family_map:
                child_family_map[cid] = pid
    
    # ─── Layout algorithm ───
    # For each generation row:
    # 1. Collect all people in this generation
    # 2. Group them into families (a parent's children + their spouses)
    # 3. Layout each family group horizontally
    # 4. Space families apart
    
    # Layout algorithm:
    # For each generation row:
    # 1. Collect all people in this generation
    # 2. Group them into families (a parent's children + their spouses)
    # 3. Layout each family group horizontally
    # 4. Space families apart

    # Track positions: person_id -> (x, y)
    x_pos = {}  # x center of each person
    y_positions = {}  # gen -> (box_top_y, box_bottom_y)

    # Subtree width with cycle detection
    def compute_subtree_width(pid, visited_set):
        """Compute total width needed for a person and all their descendants."""
        bw, _ = get_box_size(pid)
        if pid not in tree_children or not tree_children[pid]:
            return bw
        
        total = 0
        for cid in tree_children[pid]:
            if cid in visited_set:
                continue  # Skip cycles
            visited_set.add(cid)
            total += compute_subtree_width(cid, visited_set)
            visited_set.discard(cid)
        
        total += (len(tree_children[pid]) - 1) * GAP_X
        return max(total, bw)
    
    # Compute subtree widths for all
    subtree_widths = {}
    for pid in list(tree_children.keys()):
        subtree_widths[pid] = compute_subtree_width(pid, {pid})
    
    # Layout generation by generation, top to bottom
    CANVAS_CENTER = 1400
    current_y = y
    
    # For each generation, place people
    gen_info = {}  # gen -> list of (pid, x_center, box_w, box_h, is_hl, living, female, name, lifespan)
    gen_spouse_pairs = []  # (pid1, pid2)
    
    # Track which people are couples
    # For each gen, find spouse pairs
    drawn_spouse_pairs = set()
    gen_couples = defaultdict(list)  # gen -> [(pid1, pid2), ...]
    
    for gen in range(max_gen + 1):
        if gen not in people_by_gen:
            continue
        gen_people = people_by_gen[gen]
        
        # Find spouse pairs
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
    
    # First pass: lay out gen 0 (roots)
    gen0 = people_by_gen.get(0, [])
    if gen0:
        # Calculate total width needed
        total_w = 0
        items = []  # (pid, w, is_couple_pair, couple_member_idx)
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
        
        total_w -= 40  # Remove last spacing
        start_x = CANVAS_CENTER - total_w // 2
        
        cx = start_x
        for item in items:
            pid = item[0]
            w = item[1]
            x_pos[pid] = cx + w // 2  # Store center x
            cx += w + 40
    
    # For subsequent generations, place children under parents
    for gen in range(1, max_gen + 1):
        if gen not in people_by_gen:
            continue
        
        gen_people = people_by_gen[gen]
        
        # Group children by parent
        children_by_parent = defaultdict(list)
        for pid in gen_people:
            if pid in child_family_map:
                parent = child_family_map[pid]
                children_by_parent[parent].append(pid)
        
        # Place children
        placed_in_gen = set()
        
        for parent, cids in children_by_parent.items():
            if parent not in x_pos:
                continue
            px = x_pos[parent]
            bw_p, _ = get_box_size(parent)
            
            # Total children width
            c_total_w = sum(get_box_size(cid)[0] for cid in cids)
            c_total_w += (len(cids) - 1) * GAP_X
            
            # Center under parent
            c_start_x = px - c_total_w // 2
            
            for i, cid in enumerate(cids):
                bw_c, _ = get_box_size(cid)
                x_pos[cid] = c_start_x + bw_c // 2 + i * (bw_c + GAP_X)
                placed_in_gen.add(cid)
        
        # Place remaining gen members (spouses, singles without placed parent)
        remaining = [pid for pid in gen_people if pid not in placed_in_gen]
        
        # Try to place spouses next to their partner
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
        
        # Place truly remaining people at right edge
        if remaining:
            rightmost = max([x_pos.get(pid, 0) + get_box_size(pid)[0] // 2 
                           for pid in x_pos], default=CANVAS_CENTER)
            rightmost += 40
            for pid in remaining:
                bw, _ = get_box_size(pid)
                x_pos[pid] = rightmost + bw // 2
                rightmost += bw + 40
    
    # Ensure all people have x positions
    for gen in range(max_gen + 1):
        if gen not in people_by_gen:
            continue
        for pid in people_by_gen[gen]:
            if pid not in x_pos:
                bw, _ = get_box_size(pid)
                x_pos[pid] = CANVAS_CENTER
    
    # ─── Draw generation rows ───
    gen_labels = {
        0: "GEN 0 — Roots & Founders",
        1: "GEN 1 — First Generation",
        2: "GEN 2 — Second Generation",
        3: "GEN 3 — Third Generation",
        4: "GEN 4 — Fourth Generation",
        5: "GEN 5 — Fifth Generation",
        6: "GEN 6 — Sixth Generation",
        7: "GEN 7 — Seventh Generation",
    }
    
    row_positions = {}  # pid -> (x_center, y_top, y_bottom)
    
    current_y = y
    
    for gen in range(max_gen + 1):
        if gen not in people_by_gen:
            continue
        gen_people = people_by_gen[gen]
        if not gen_people:
            continue
        
        # Generation label
        label = gen_labels.get(gen, f"GEN {gen}")
        svg_lines.append(f'  <text x="30" y="{current_y + 15}" class="gen-label">{esc(label)}</text>')
        
        # Box vertical position
        max_bh = max(get_box_size(pid)[1] for pid in gen_people if pid in x_pos)
        y_box = current_y + 25
        
        # Store row positions
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
            
            # Adjust box x to be left-aligned (x_pos stores center)
            bx_adj = bx - bw // 2
            
            lines = box_svg(bx_adj, y_box, bw, bh, name, lifespan, hl, female, living, spouse_name)
            svg_lines.extend(lines)
        
        # Draw spouse connector lines
        for p1, p2 in gen_couples.get(gen, []):
            if p1 in x_pos and p2 in x_pos:
                bw1, bh1 = get_box_size(p1)
                bw2, bh2 = get_box_size(p2)
                x1 = x_pos[p1] + bw1 // 2
                x2 = x_pos[p2] - bw2 // 2
                yc = y_box + bh1 // 2
                svg_lines.append(f'    <line x1="{x1}" y1="{yc}" x2="{x2}" y2="{yc}" stroke="{SPOUSE_LINE}" stroke-width="1.5"/>')
        
        # Calculate next y
        current_y = y_box + max_bh + GEN_GAP
    
    # ─── Draw parent-child connector lines ───
    for pid, cids in tree_children.items():
        if pid not in row_positions:
            continue
        
        px, py_top, py_bottom, pbw, pbh = row_positions[pid]
        px_center = px
        
        # Find children in row_positions
        child_pos = []
        for cid in cids:
            if cid in row_positions:
                c_info = row_positions[cid]
                py_child = c_info[1]
                child_pos.append((c_info[0], py_child, c_info[3]))
        
        if not child_pos:
            continue
        
        # Bar y: halfway between parent bottom and child top
        bar_y = (py_bottom + child_pos[0][1]) // 2
        
        # Ensure minimum gap
        if bar_y - py_bottom < 10:
            bar_y = py_bottom + 10
        if child_pos[0][1] - bar_y < 10:
            bar_y = child_pos[0][1] - 10
        
        # Vertical line from parent
        svg_lines.append(f'    <line x1="{px}" y1="{py_bottom}" x2="{px}" y2="{bar_y}" stroke="{CONNECTOR}" stroke-width="1.5"/>')
        
        # Horizontal bar
        if len(child_pos) > 1:
            min_cx = min(c[0] for c in child_pos) - child_pos[0][2]//2 + child_pos[0][2]//2
            max_cx = max(c[0] for c in child_pos)
            # Adjust min_cx to be from the actual box left edge
            min_cx_full = min(c[0] - c[2]//2 for c in child_pos) + min(c[2]//2 for c in child_pos)
            max_cx_full = max(c[0] + c[2]//2 for c in child_pos) - max(c[2]//2 for c in child_pos)
            # Actually just use the centers
            all_cx = [c[0] for c in child_pos]
            min_cx = min(all_cx)
            max_cx = max(all_cx)
            svg_lines.append(f'    <line x1="{min_cx}" y1="{bar_y}" x2="{max_cx}" y2="{bar_y}" stroke="{CONNECTOR}" stroke-width="1.5"/>')
        
        # Vertical lines to each child
        for cx, cy, cw in child_pos:
            svg_lines.append(f'    <line x1="{cx}" y1="{bar_y}" x2="{cx}" y2="{cy}" stroke="{CONNECTOR}" stroke-width="1.5"/>')
    
    # Move y past all tree rows
    y_end = current_y + 20
    
    # ─── Not Placed Section ───
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
    svg_lines.append(f'  <text x="53" y="{y_end+10}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="10">★ = Direct ancestor line (James → Francis → John → Francis Charles → Murray → Timothy → Mark)</text>')
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
    svg_lines.append(f'  <text x="53" y="{y_end+10}" fill="{SPOUSE_LINE}" font-family="Arial, sans-serif" font-size="10">⚭ = Spouse name shown below person</text>')
    
    # ─── Footer ───
    y_end += 30
    svg_lines.append(f'  <text x="1400" y="{y_end}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="10">Telfer Family Tree — Complete Edition — Generated from people.json ({placed_count} placed, {len(unplaced)} unplaced)</text>')
    y_end += 20
    
    total_h = y_end + 20
    svg_lines.append('</svg>')
    
    output = '\n'.join(svg_lines)
    output = output.replace('viewBox="0 0 2800 2000"', f'viewBox="0 0 2800 {total_h}"')
    
    return output, total_h


def main():
    data_path = os.path.expanduser("~/telfer-wiki/src/data/people.json")
    output_path = os.path.expanduser("~/telfer-wiki/public/images/family-tree-v2.svg")
    
    # Load data
    print("📂 Loading people data...")
    people = load_data(data_path)
    print(f"   Loaded {len(people)} people from {data_path}")
    
    # Build lookups
    by_id, by_display_name, by_display_lower, child_map, spouse_map = build_lookups(people)
    
    print("🔍 Building tree structure...")
    print("   Scanning parents[] arrays to find children relationships...")
    
    total_child_relations = sum(len(v) for v in child_map.values())
    print(f"   Found parent-child relationships via parents[] scanning")
    print(f"   Found {len(spouse_map)} people with spouse relationships")
    
    # Build tree
    generation_map, tree_children, roots, unplaced = build_tree(
        people, by_id, by_display_name, by_display_lower, child_map, spouse_map
    )
    
    print(f"   Roots: {len(roots)}")
    print(f"   People placed in tree: {len(generation_map)}")
    print(f"   People unplaced: {len(unplaced)}")
    
    if unplaced:
        print("   Unplaced people:")
        for upid in sorted(unplaced):
            up = by_id.get(upid, {})
            print(f"     - {up.get('display_name', upid)} ({up.get('lifespan', '?')})")
    
    # Show generation distribution
    gen_dist = defaultdict(int)
    for pid, gen in generation_map.items():
        gen_dist[gen] += 1
    print("   Generation distribution:")
    for gen in sorted(gen_dist.keys()):
        print(f"     Gen {gen}: {gen_dist[gen]} people")
    
    # Build SVG
    print("\n🎨 Building SVG...")
    svg_content, total_h = build_svg(
        people, by_id, by_display_name, by_display_lower,
        generation_map, tree_children, roots, unplaced, spouse_map
    )
    
    # Write output
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(svg_content)
    
    print(f"\n✅ SVG written to {output_path}")
    print(f"📐 Canvas: 2800 × {total_h}")
    print(f"📦 Size: {len(svg_content):,} bytes")
    print(f"👥 People placed in tree: {len(generation_map)}")
    print(f"⚠️  People not placed: {len(unplaced)}")
    print(f"📊 Generations: {max(generation_map.values()) if generation_map else 0}")


if __name__ == "__main__":
    main()
