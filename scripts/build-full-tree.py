#!/usr/bin/env python3
"""
Telfer Family Tree SVG Generator — v3 (Compact Edition)
Generates a comprehensive SVG family tree from hardcoded family data.
Optimised for 1600×1850 canvas with tighter spacing.
"""

import os
import math

# ─── COLOURS ──────────────────────────────────────────────────
BG        = "#1a1a2e"
BOX_BG    = "#16213e"
BOX_BORDER= "#0f3460"
ACCENT    = "#e94560"
HIGHLIGHT = "#e94560"
TEXT      = "#e0e0e0"
TEXT_DIM  = "#999"
CONNECTOR = "#555"
FEMALE_BG = "#1a2744"
FEMALE_BORDER = "#4a6fa5"
GREEN_BORDER = "#2d6a4f"

# ─── CONSTANTS (Compact version) ──────────────────────────────
BOX_W = 135       # Was 160
BOX_H = 38        # Was 50
GAP_X = 18        # Was 30 — horizontal gap between sibling boxes
COUPLE_GAP = 25   # Space between couple boxes
SECTION_GAP = 18  # Space between sections
FONT_SIZE = 12
SMALL_FONT = 9

def box(x, y, w, h, name, meta="", highlight=False, female=False, living=False):
    """Generate SVG for a single person box."""
    stroke = GREEN_BORDER if living else (FEMALE_BORDER if female else BOX_BORDER)
    if highlight:
        stroke = HIGHLIGHT
    fill = FEMALE_BG if female else BOX_BG
    
    lines = []
    lines.append(f'    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    
    # Check if name is too long and needs smaller font
    name_font = 11 if len(name) > 18 else FONT_SIZE - 1
    if highlight:
        name = "★ " + name
    
    lines.append(f'    <text x="{x + w//2}" y="{y + h//2 - 3}" text-anchor="middle" fill="{TEXT}" font-family="Arial, sans-serif" font-size="{name_font}" font-weight="bold">{name}</text>')
    if meta:
        meta_font = 8 if len(meta) > 15 else SMALL_FONT
        lines.append(f'    <text x="{x + w//2}" y="{y + h//2 + 12}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="{meta_font}">{meta}</text>')
    
    return '\n'.join(lines) + '\n'


def build_svg():
    svg = []
    
    # ─── HEADER ────────────────────────────────────────────────
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1800" width="100%" height="100%" style="background-color:{BG};">\n')
    svg.append(f'  <defs>\n    <style>\n      .title {{ font-family: "Georgia", serif; font-size: 22px; fill: {ACCENT}; font-weight: bold; }}\n      .subtitle {{ font-family: "Arial", sans-serif; font-size: 11px; fill: {TEXT_DIM}; }}\n      .section {{ font-family: "Arial", sans-serif; font-size: 12px; fill: {ACCENT}; font-weight: bold; }}\n    </style>\n  </defs>\n')
    svg.append(f'  <rect width="1600" height="1800" fill="{BG}"/>\n')
    svg.append(f'  <text x="800" y="40" text-anchor="middle" class="title">🏴󠁧󠁢󠁳󠁣󠁴󠁿 Telfer Family Tree</text>\n')
    svg.append(f'  <text x="800" y="58" text-anchor="middle" class="subtitle">From James Telfer (1761) through to Mark, Kylie &amp; the kids — 7+ generations</text>\n')
    
    y = 72
    center = 800
    dw = BOX_W // 2  # half-width offset for centering
    
    # ═══ SECTION 1: SCOTTISH ROOTS ═══
    svg.append(f'  <text x="50" y="{y+12}" class="section">🏴󠁧󠁢󠁳󠁣󠁴󠁿 SCOTTISH ROOTS — IMMIGRANT GENERATION</text>\n')
    y += 25
    
    # James + Betty
    jx = center - dw - COUPLE_GAP
    bx = center + COUPLE_GAP
    svg += box(jx, y, BOX_W, BOX_H, "James Telfer", "(1761–1845) ★", highlight=True)
    svg += box(bx, y, BOX_W, BOX_H, "Betty Hutton", "(1774–1853)", female=True)
    svg += f'    <line x1="{jx + BOX_W}" y1="{y + BOX_H//2}" x2="{bx}" y2="{y + BOX_H//2}" stroke="{CONNECTOR}" stroke-width="1"/>\n'
    
    # Connector down
    midx = (jx + bx + BOX_W) // 2
    svg += f'    <line x1="{midx}" y1="{y + BOX_H}" x2="{midx}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 14
    
    # Francis + Margaret
    fjx = center - dw - COUPLE_GAP
    mwx = center + COUPLE_GAP
    svg += box(fjx, y, BOX_W, BOX_H, "Francis Telfer", "(1809–1895) ★", highlight=True)
    svg += box(mwx, y, BOX_W, BOX_H, "Margaret Wright", "(?–1892)", female=True)
    svg += f'    <line x1="{fjx + BOX_W}" y1="{y + BOX_H//2}" x2="{mwx}" y2="{y + BOX_H//2}" stroke="{CONNECTOR}" stroke-width="1"/>\n'
    
    midx2 = (fjx + mwx + BOX_W) // 2
    svg += f'    <line x1="{midx2}" y1="{y + BOX_H}" x2="{midx2}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 14
    
    # John + Caroline
    jhx = center - dw - COUPLE_GAP
    cax = center + COUPLE_GAP
    svg += box(jhx, y, BOX_W, BOX_H, "John Telfer", "(1847–1929) ★", highlight=True)
    svg += box(cax, y, BOX_W, BOX_H, "Caroline A. Masters", "(1842–1929)", female=True)
    svg += f'    <line x1="{jhx + BOX_W}" y1="{y + BOX_H//2}" x2="{cax}" y2="{y + BOX_H//2}" stroke="{CONNECTOR}" stroke-width="1"/>\n'
    
    midx3 = (jhx + cax + BOX_W) // 2
    svg += f'    <line x1="{midx3}" y1="{y + BOX_H}" x2="{midx3}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 18
    
    # ═══ SECTION 2: CHARLIE & AMY ═══
    svg.append(f'  <text x="50" y="{y+12}" class="section">FRANCIS CHARLES &amp; AMY — 2ND GENERATION AUSTRALIAN</text>\n')
    y += 25
    
    # Charlie + Amy
    chx = center - dw - COUPLE_GAP
    amx = center + COUPLE_GAP
    svg += box(chx, y, BOX_W, BOX_H, "Francis C. Telfer", "(1875–1954) ★", highlight=True)
    svg += box(amx, y, BOX_W, BOX_H, "Amy Ellen Provis", "(1884–1951)", female=True)
    svg += f'    <line x1="{chx + BOX_W}" y1="{y + BOX_H//2}" x2="{amx}" y2="{y + BOX_H//2}" stroke="{CONNECTOR}" stroke-width="1"/>\n'
    
    ca_midx = (chx + amx + BOX_W) // 2
    svg += f'    <line x1="{ca_midx}" y1="{y + BOX_H}" x2="{ca_midx}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 14
    
    # All 10 children of Charlie & Amy
    G4 = [
        ("Francis Kelson", "1910–1987", False, False, False),
        ("Clarice May", "1911–1997", False, True, False),
        ("Emily Amelia", "?–?", False, True, False),
        ("Ethel Jean", "?–?", False, True, False),
        ("Gladys Merle", "?–?", False, True, False),
        ("Doris Elma", "?–?", False, True, False),
        ("Edwin Roy", "?–?", False, False, False),
        ("Reginald M.", "?–?", False, False, False),
        ("☆ Murray John", "1924–2009 ★", True, False, False),
        ("Malcolm G.", "?–?", False, False, False),
    ]
    
    n_g4 = len(G4)
    g4_gap = GAP_X - 7  # Tighter gap for 10 boxes to fit canvas
    g4_w = n_g4 * BOX_W + (n_g4 - 1) * g4_gap
    g4_x0 = center - g4_w // 2 + BOX_W // 2
    
    # Connector line for all 10
    svg += f'    <line x1="{g4_x0 - BOX_W//2}" y1="{y}" x2="{g4_x0 + (n_g4-1) * (BOX_W + g4_gap) + BOX_W//2}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    svg += f'    <line x1="{ca_midx}" y1="{y - 14}" x2="{ca_midx}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    
    for i, (name, lifespan, main, female, living) in enumerate(G4):
        xx = g4_x0 + i * (BOX_W + g4_gap)
        svg += f'    <line x1="{xx + BOX_W//2}" y1="{y}" x2="{xx + BOX_W//2}" y2="{y + 8}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
        svg += box(xx, y + 8, BOX_W, BOX_H, name, f"({lifespan})", highlight=main, female=female, living=living)
    
    y += BOX_H + 16
    
    # ═══ SECTION 3: MURRAY & SHIRLEY + THEIR KIDS ═══
    svg.append(f'  <text x="50" y="{y+12}" class="section">MURRAY JOHN &amp; SHIRLEY — ALL 6 CHILDREN WITH THEIR FAMILIES</text>\n')
    y += 25
    
    # Murray + Shirley couple box
    mjx = center - dw - COUPLE_GAP
    shx = center + COUPLE_GAP
    svg += box(mjx, y, BOX_W, BOX_H, "☆ Murray John", "(1924–2009) ★", highlight=True)
    svg += box(shx, y, BOX_W, BOX_H, "Shirley E. Parker", "(1929–2017)", female=True)
    svg += f'    <line x1="{mjx + BOX_W}" y1="{y + BOX_H//2}" x2="{shx}" y2="{y + BOX_H//2}" stroke="{CONNECTOR}" stroke-width="1"/>\n'
    
    ms_midx = (mjx + shx + BOX_W) // 2
    svg += f'    <line x1="{ms_midx}" y1="{y + BOX_H}" x2="{ms_midx}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 14
    
    # G5 — 6 children of Murray & Shirley
    G5_kids = [
        ("Daryll Wm", "(?–?)", False, False, True, []),
        ("John Robert", "(?–?)", False, False, True, [
            ("+ Robyn (wife)", "?–?", False, True, True),
            ("Angela (adop)", "?–?", False, True, True),
            ("Peter (adop)", "?–?", False, False, True),
            ("Carissa (adop)", "?–2023 †", False, True, False),
        ]),
        ("Grantley Keith", "(?–?)", False, False, True, [
            ("Kristin Stefanoff", "?–?", False, True, True),
            ("Jono", "?–?", False, False, True),
            ("Nick", "?–?", False, False, True),
        ]),
        ("☆ Timothy Neil", "(1959–?) ★", True, False, True, []),
        ("Kathryn Mavis", "(1961–1965)", False, True, False, []),
        ("Susan S. Lawrie", "(née Telfer)", False, True, True, []),
    ]
    
    n_g5 = len(G5_kids)
    g5_w = n_g5 * BOX_W + (n_g5 - 1) * GAP_X
    g5_x0 = center - g5_w // 2 + BOX_W // 2
    
    svg += f'    <line x1="{g5_x0 - BOX_W//2}" y1="{y}" x2="{g5_x0 + (n_g5-1) * (BOX_W + GAP_X) + BOX_W//2}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    svg += f'    <line x1="{ms_midx}" y1="{y - 14}" x2="{ms_midx}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    
    # Render each G5 person + their children
    for i, (lname, lifespan, main, female, living, children) in enumerate(G5_kids):
        xx = g5_x0 + i * (BOX_W + GAP_X)
        svg += f'    <line x1="{xx + BOX_W//2}" y1="{y}" x2="{xx + BOX_W//2}" y2="{y + 8}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
        svg += box(xx, y + 8, BOX_W, BOX_H, lname, f"({lifespan})", highlight=main, female=female, living=living)
        
        if children:
            cy = y + 8 + BOX_H + 12
            nc = len(children)
            cw = nc * BOX_W + (nc - 1) * (GAP_X - 4)
            cx0 = xx + BOX_W//2 - cw//2 + BOX_W//2
            
            svg += f'    <line x1="{xx + BOX_W//2}" y1="{y + 8 + BOX_H}" x2="{xx + BOX_W//2}" y2="{cy - 4}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
            if nc > 1:
                svg += f'    <line x1="{cx0}" y1="{cy - 4}" x2="{cx0 + (nc-1) * (BOX_W + GAP_X - 4) + BOX_W}" y2="{cy - 4}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
            
            for j, (cname, clife, cmain, cfemale, cliving) in enumerate(children):
                cxx = cx0 + j * (BOX_W + GAP_X - 4)
                svg += f'    <line x1="{cxx + BOX_W//2}" y1="{cy - 4}" x2="{cxx + BOX_W//2}" y2="{cy}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
                is_spouse = cname.startswith("+")
                svg += box(cxx, cy, BOX_W, BOX_H, cname, f"({clife})", highlight=cmain, female=cfemale or is_spouse, living=cliving)
    
    max_kids_y = max([len(c[5]) for c in G5_kids]) if any([len(c[5]) for c in G5_kids]) else 0
    y += BOX_H + 12 + (max_kids_y * (BOX_H + 12) if max_kids_y > 0 else 0) + 14
    
    # ═══ SECTION 4: TIM'S FAMILY ═══
    svg.append(f'  <text x="50" y="{y+12}" class="section">TIMOTHY NEIL — MARK&#39;S DAD AND HIS FAMILIES</text>\n')
    y += 22
    
    # Tim + Penny
    tx = center - dw - COUPLE_GAP
    px = center + COUPLE_GAP
    svg += box(tx, y, BOX_W, BOX_H, "☆ Timothy Neil", "(1959–?) ★", highlight=True)
    svg += box(px, y, BOX_W, BOX_H, "Penny Telfer", "(bio mother)", female=True, living=True)
    svg += f'    <line x1="{tx + BOX_W}" y1="{y + BOX_H//2}" x2="{px}" y2="{y + BOX_H//2}" stroke="{ACCENT}" stroke-width="1"/>\n'
    
    t_midx = (tx + px + BOX_W) // 2
    svg += f'    <line x1="{t_midx}" y1="{y + BOX_H}" x2="{t_midx}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 14
    
    # Tim's kids with Penny
    tim_kids = [
        ("☆ Mark K Telfer", "1986–? ★", True, False, True),
        ("Amy Nicole Telfer", "?–living", False, True, True),
        ("David Telfer", "?–living", False, False, True),
    ]
    n_tk = len(tim_kids)
    tk_w = n_tk * BOX_W + (n_tk - 1) * GAP_X
    tk_x0 = center - tk_w // 2 + BOX_W // 2
    
    svg += f'    <line x1="{tk_x0 - BOX_W//2}" y1="{y}" x2="{tk_x0 + (n_tk-1) * (BOX_W + GAP_X) + BOX_W//2}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    svg += f'    <line x1="{t_midx}" y1="{y - 14}" x2="{t_midx}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    
    for i, (kname, klife, kmain, kfemale, kliving) in enumerate(tim_kids):
        kx = tk_x0 + i * (BOX_W + GAP_X)
        svg += f'    <line x1="{kx + BOX_W//2}" y1="{y}" x2="{kx + BOX_W//2}" y2="{y + 8}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
        svg += box(kx, y + 8, BOX_W, BOX_H, kname, f"({klife})", highlight=kmain, female=kfemale, living=kliving)
    
    y += BOX_H + 14
    
    # Sheryle family
    svg.append(f'  <text x="60" y="{y+12}" class="section">TIM + SHERYLE / IVORY (STEP-FAMILY)</text>\n')
    y += 22
    
    # Sheryle + Paul
    shy = center - dw - COUPLE_GAP
    paulx = center + COUPLE_GAP
    svg += box(shy, y, BOX_W, BOX_H, "Sheryle Telfer", "(1961–?) +", female=True, living=True)
    svg += box(paulx, y, BOX_W, BOX_H, "Paul Ivory", "(1955–1996)", living=False)
    svg += f'    <line x1="{shy + BOX_W}" y1="{y + BOX_H//2}" x2="{paulx}" y2="{y + BOX_H//2}" stroke="{ACCENT}" stroke-width="1"/>\n'
    
    smidx = (shy + paulx + BOX_W) // 2
    svg += f'    <line x1="{smidx}" y1="{y + BOX_H}" x2="{smidx}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 14
    
    # Ivory kids
    ivory_kids = [
        ("Aaron Ivory", "?–living", False, False, True),
        ("Jared Ivory", "?–living", False, False, True),
        ("Lauren Ivory", "?–living", False, True, True),
        ("Joel Ivory", "?–living", False, False, True),
    ]
    n_ik = len(ivory_kids)
    ik_w = n_ik * BOX_W + (n_ik - 1) * GAP_X
    ik_x0 = center - ik_w // 2 + BOX_W // 2
    
    svg += f'    <line x1="{ik_x0 - BOX_W//2}" y1="{y}" x2="{ik_x0 + (n_ik-1) * (BOX_W + GAP_X) + BOX_W//2}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    svg += f'    <line x1="{smidx}" y1="{y - 14}" x2="{smidx}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    
    for i, (kname, klife, kmain, kfemale, kliving) in enumerate(ivory_kids):
        ikx = ik_x0 + i * (BOX_W + GAP_X)
        svg += f'    <line x1="{ikx + BOX_W//2}" y1="{y}" x2="{ikx + BOX_W//2}" y2="{y + 8}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
        svg += box(ikx, y + 8, BOX_W, BOX_H, kname, f"({klife})", highlight=kmain, female=kfemale, living=kliving)
    
    y += BOX_H + 14
    
    # ═══ SECTION 5: MARK & KYLIE ═══
    svg.append(f'  <text x="50" y="{y+12}" class="section">MARK &amp; KYLIE — YOUR FAMILY</text>\n')
    y += 22
    
    # Mark + Kylie
    mk1 = center - dw - COUPLE_GAP
    mk2 = center + COUPLE_GAP
    svg += box(mk1, y, BOX_W, BOX_H, "☆ Mark Kenneth", "(1986–?) ★", highlight=True)
    svg += box(mk2, y, BOX_W, BOX_H, "Kylie I. Dance", "(1982–?)", female=True)
    svg += f'    <line x1="{mk1 + BOX_W}" y1="{y + BOX_H//2}" x2="{mk2}" y2="{y + BOX_H//2}" stroke="{HIGHLIGHT}" stroke-width="1"/>\n'
    
    mmidx = (mk1 + mk2 + BOX_W) // 2
    svg += f'    <line x1="{mmidx}" y1="{y + BOX_H}" x2="{mmidx}" y2="{y + BOX_H + 14}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += BOX_H + 14
    
    # Kids
    G7_kids = [
        ("Mitchell Telfer", "2008–? (CR)", False, False, True),
        ("Levi L. T. Telfer", "2017–?", False, False, True),
        ("Zabella V. Z. Telfer", "2019–?", False, True, True),
    ]
    n_mk = len(G7_kids)
    mk_w = n_mk * BOX_W + (n_mk - 1) * (GAP_X + 10)
    mk_x0 = center - mk_w // 2 + BOX_W // 2
    
    svg += f'    <line x1="{mk_x0 - BOX_W//2}" y1="{y}" x2="{mk_x0 + (n_mk-1) * (BOX_W + GAP_X + 10) + BOX_W//2}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    svg += f'    <line x1="{mmidx}" y1="{y - 14}" x2="{mmidx}" y2="{y}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    svg += f'    <text x="{mmidx}" y="{y-3}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="8">m. 12 Mar 2016</text>\n'
    
    for i, (kname, klife, kmain, kfemale, kliving) in enumerate(G7_kids):
        mkx = mk_x0 + i * (BOX_W + GAP_X + 10)
        svg += f'    <line x1="{mkx + BOX_W//2}" y1="{y}" x2="{mkx + BOX_W//2}" y2="{y + 8}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
        svg += box(mkx, y + 8, BOX_W, BOX_H, kname, f"({klife})", highlight=kmain, female=kfemale, living=kliving)
    
    y += BOX_H + 22
    
    # ═══ SECTION 6: SUPPORTING LINES ═══
    svg.append(f'  <text x="50" y="{y+12}" class="section">SUPPORTING LINES</text>\n')
    y += 22
    
    # Parker line (compact horizontal chain)
    svg.append(f'  <text x="60" y="{y+10}" fill="#888" font-family="Arial, sans-serif" font-size="11" font-weight="bold">PARKER LINE (Shirley&#39;s Paternal — Ayrshire Scots)</text>\n')
    y += 18
    
    parker = [
        ("David Parker", "1822–1888"),
        ("Wm Humphrey P.", "1850–1926"),
        ("+ Hannah Baker", "1855–1948"),
        ("Wm Henry Parker", "1893–1968"),
        ("+ C. Edna Lawrie", "1890–1957"),
        ("→ Shirley Parker", "1929–2017"),
    ]
    pk_x0 = center - 490
    for i, (name, lifespan) in enumerate(parker):
        px = pk_x0 + i * 170
        svg += box(px, y, 130, 35, name, f"({lifespan})", female="+" in name)
        if i < len(parker) - 1:
            svg += f'    <line x1="{px + 130}" y1="{y + 17}" x2="{px + 150}" y2="{y + 17}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += 45
    
    # Lawrie line
    svg.append(f'  <text x="60" y="{y+10}" fill="#888" font-family="Arial, sans-serif" font-size="11" font-weight="bold">LAWRIE LINE (Shirley&#39;s Maternal — Ayrshire Scots)</text>\n')
    y += 18
    
    lawrie = [
        ("Alex. Lawrie", "1780–1847"),
        ("John Lawrie", "1810–1888"),
        ("Robt. D. Lawrie", "1850–1917"),
        ("+ Caroline Hosking", "1851–1920"),
        ("Caroline E. Lawrie", "1890–1957"),
    ]
    lw_x0 = center - 420
    for i, (name, lifespan) in enumerate(lawrie):
        lx = lw_x0 + i * 170
        svg += box(lx, y, 130, 35, name, f"({lifespan})", female="+" in name)
        if i < len(lawrie) - 1:
            svg += f'    <line x1="{lx + 130}" y1="{y + 17}" x2="{lx + 150}" y2="{y + 17}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += 45
    
    # Baker/March/Webster
    svg.append(f'  <text x="60" y="{y+10}" fill="#888" font-family="Arial, sans-serif" font-size="11" font-weight="bold">BAKER / MARCH / WEBSTER (English Roots — Hannah Baker)</text>\n')
    y += 18
    
    baker = [
        ("J. Webster", "1750–1810"),
        ("Wm Webster", "1778–1816"),
        ("Sophia Webster", "1803–1892"),
        ("Joseph March", "1797–1883"),
        ("Sophia March", "1829–1901"),
        ("Wm J. Baker", "1831–1919"),
    ]
    bk_x0 = center - 470
    for i, (name, lifespan) in enumerate(baker):
        bx = bk_x0 + i * 155
        svg += box(bx, y, 125, 35, name, f"({lifespan})", female="Sophia" in name)
        if i < len(baker) - 1:
            svg += f'    <line x1="{bx + 125}" y1="{y + 17}" x2="{bx + 145}" y2="{y + 17}" stroke="{CONNECTOR}" stroke-width="1.5"/>\n'
    y += 45
    
    # Legend
    svg.append(f'  <text x="50" y="{y+10}" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="11" font-weight="bold">LEGEND</text>\n')
    y += 18
    svg.append(f'  <rect x="55" y="{y}" width="10" height="10" rx="2" fill="{BOX_BG}" stroke="{HIGHLIGHT}" stroke-width="1.5"/>\n')
    svg.append(f'  <text x="71" y="{y+9}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="9">★ = Direct ancestor / Main line</text>\n')
    y += 16
    svg.append(f'  <rect x="55" y="{y}" width="10" height="10" rx="2" fill="{FEMALE_BG}" stroke="{BOX_BORDER}" stroke-width="1.5"/>\n')
    svg.append(f'  <text x="71" y="{y+9}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="9">Blue bg = Female</text>\n')
    y += 16
    svg.append(f'  <rect x="55" y="{y}" width="10" height="10" rx="2" fill="{BOX_BG}" stroke="{GREEN_BORDER}" stroke-width="1.5"/>\n')
    svg.append(f'  <text x="71" y="{y+9}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="9">Green border = Living</text>\n')
    y += 16
    svg.append(f'  <rect x="55" y="{y}" width="10" height="10" rx="2" fill="none" stroke="#666" stroke-width="1.5"/>\n')
    svg.append(f'  <text x="71" y="{y+9}" fill="{TEXT}" font-family="Arial, sans-serif" font-size="9">+ prefix = Spouse (by marriage)</text>\n')
    
    y += 24
    svg.append(f'  <text x="800" y="{y}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="9">Telfer Family Tree — Direct ancestor line from James Telfer (1761) to Mark, Kylie &amp; the kids</text>\n')
    y += 14
    svg.append(f'  <text x="800" y="{y}" text-anchor="middle" fill="{TEXT_DIM}" font-family="Arial, sans-serif" font-size="9">Data from Telfer Wiki (people.json) — All known children and grandchildren shown for main branches</text>\n')
    
    total_h = y + 20
    svg.append('</svg>\n')
    output = ''.join(svg)
    
    # Update the viewBox to match actual content
    output = output.replace('viewBox="0 0 1600 1800"', f'viewBox="0 0 1600 {total_h}"')
    
    return output, total_h


if __name__ == "__main__":
    svg_content, total_h = build_svg()
    output_path = os.path.expanduser("~/telfer-wiki/public/images/family-tree.svg")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(svg_content)
    
    tmp_path = "/tmp/telfer-tree-compact.svg"
    with open(tmp_path, 'w') as f:
        f.write(svg_content)
    
    num_people = svg_content.count('<rect')
    print(f"✅ SVG written to {output_path}")
    print(f"📐 Canvas: 1600 × {total_h}")
    print(f"📦 Size: {len(svg_content):,} bytes")
    print(f"👥 Boxes (people): {num_people}")
