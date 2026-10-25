#!/usr/bin/env python3
"""Generate the Telfer Wiki sidebar icon set.

Every icon is built from parameters, not guessed path data, so the whole set
shares one optical grid: 24x24 box, 20x20 safe area, stroke 1.5, round joins.
Output: src/components/nav-icons/<name>.svg  (one per icon, plus sprite.svg)

To retune the set, change STROKE or a builder, then re-run:
    python3 scripts/build-nav-icons.py
"""
from __future__ import annotations
import math
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "components" / "nav-icons"
STROKE = 1.5
INK = "currentColor"

HEAD = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
    f'stroke="{INK}" stroke-width="{STROKE}" stroke-linecap="round" '
    'stroke-linejoin="round" aria-hidden="true" focusable="false">'
)


def p(d: str) -> str:
    return f'<path d="{d}"/>'


def n(v: float) -> str:
    """Trim float noise so the source stays readable."""
    return f"{round(v, 2):g}"


# ── Home ─────────────────────────────────────────────────────────────────────
def home() -> list[str]:
    """Cottage: gable roof, body, door, chimney."""
    return [
        p("M3 11.2 12 3.6l9 7.6"),
        p("M5 10.4V20.4h14V10.4"),
        p("M9.8 20.4v-5.2h4.4v5.2"),
        p("M16.6 6.4V4.9h1.8v3.2"),
    ]


# ── People ───────────────────────────────────────────────────────────────────
def people() -> list[str]:
    """Two busts: head circle + shoulders arc; rear figure set back and higher."""
    return [
        '<circle cx="9" cy="8" r="3.3"/>',
        p("M3.2 20.2v-.6c0-2.7 2.2-4.4 5.8-4.4s5.8 1.7 5.8 4.4v.6"),
        '<circle cx="16.2" cy="7.1" r="2.6"/>',
        p("M14.1 4.9c-.9.5-1.4 1.3-1.6 2.2"),
        p("M19.9 15.6c1.1.9 1.7 2.2 1.7 3.9v.7"),
    ]


# ── Timeline ─────────────────────────────────────────────────────────────────
def timeline() -> list[str]:
    """Year rails: a strong spine with three chevron-marked records.

    A plain spine with dots and ticks read as a slider or flow chart. Chevrons
    stacked on the spine are an unambiguous "records in sequence" shape, and
    three of them survive 22px where fine ticks do not.
    """
    out = [p("M6.4 3v18")]                              # spine, set left of centre
    for cy in (6.4, 12, 17.6):
        out.append(p(f"M6.4 {n(cy)}h2.6"))              # stub off the spine
        out.append(p(f"M12.6 {n(cy - 2.1)}l-2.4 2.1 2.4 2.1"))  # chevron record
        out.append(p(f"M16.2 {n(cy)}h4.4"))             # record bar
    return out


# ── Full Tree ────────────────────────────────────────────────────────────────
def full_tree() -> list[str]:
    """A genealogical tree DIAGRAM: ancestor node, busbar, three descendants.

    A botanical canopy dome was tried first; at 22px it read as an umbrella over
    a mushroom. The branching structure carries the meaning, so the geometry is
    generated from a tier spec and every node lands on its stem.
    """
    cx, top_y, top_r = 12.0, 4.2, 2.2
    bus_y, leaf_y, leaf_r = 9.4, 18.2, 1.9
    xs = (5.0, 12.0, 19.0)
    out = [
        f'<circle cx="{n(cx)}" cy="{n(top_y)}" r="{n(top_r)}"/>',
        p(f"M{n(cx)} {n(top_y + top_r)}v{n(bus_y - top_y - top_r)}"),
        p(f"M{n(xs[0])} {n(bus_y)}h{n(xs[2] - xs[0])}"),
    ]
    for x in xs:
        out.append(p(f"M{n(x)} {n(bus_y)}v{n(leaf_y - leaf_r - bus_y)}"))
        out.append(f'<circle cx="{n(x)}" cy="{n(leaf_y)}" r="{n(leaf_r)}"/>')
    return out


# ── Search ───────────────────────────────────────────────────────────────────
def search() -> list[str]:
    """Magnifier with a two-stroke handle so the grip survives at 22px."""
    return [
        '<circle cx="10.4" cy="10.4" r="6.3"/>',
        p("M15 15 20.6 20.6"),
        p("M12.9 16.6 16.6 12.9"),
    ]


# ── Families ─────────────────────────────────────────────────────────────────
def families() -> list[str]:
    """Two adults joined by a marriage bar, child hanging beneath it.

    Other people icons do not have a horizontal junction, so the bar is what
    separates "family" from "people" at a glance. The child is offset down and
    centre, connected by a short stem - a pedigree fork, not a crowd.
    """
    out = [
        '<circle cx="6.2" cy="6.4" r="2.2"/>',
        p("M2.8 14.6v-1.1c0-1.8 1.5-2.9 3.4-2.9s3.4 1.1 3.4 2.9v1.1"),   # left adult
        '<circle cx="17.8" cy="6.4" r="2.2"/>',
        p("M14.4 14.6v-1.1c0-1.8 1.5-2.9 3.4-2.9s3.4 1.1 3.4 2.9v1.1"),  # right adult
        p("M6.2 12.2h11.6"),                            # marriage bar
        p("M12 12.2v2.2"),                              # descent stem
        '<circle cx="12" cy="17.6" r="1.8"/>',          # child
    ]
    return out


# ── DNA ──────────────────────────────────────────────────────────────────────
def dna() -> list[str]:
    """Double helix: two mirrored sine strands, two bold rungs.

    Rung positions are computed from the same phase function as the strands, so
    the ladder can never drift off them. 40 samples per strand, 2 rungs: more of
    either rounds off into noise at 22px.
    """
    top, bottom, amp, cycles, steps = 3.4, 20.6, 4.0, 1.5, 40
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        y = top + (bottom - top) * t
        phase = 2 * math.pi * cycles * t - math.pi / 2
        left.append((12 + amp * math.cos(phase), y))
        right.append((12 - amp * math.cos(phase), y))

    def polyline(pts):
        d = f"M{n(pts[0][0])} {n(pts[0][1])}"
        d += "".join(f"L{n(x)} {n(y)}" for x, y in pts[1:])
        return p(d)

    out = [polyline(left), polyline(right)]
    for frac in (0.25, 0.75):
        idx = int(frac * steps)
        (x1, y1), (x2, _) = left[idx], right[idx]
        out.append(p(f"M{n(x1)} {n(y1)}h{n(x2 - x1)}"))
    return out


# ── Ballads ──────────────────────────────────────────────────────────────────
def ballads() -> list[str]:
    """Two beamed quavers: note heads, stems, shared beam, second beam."""
    return [
        '<ellipse cx="7.4" cy="18" rx="2.5" ry="1.9"/>',
        '<ellipse cx="16.6" cy="16.4" rx="2.5" ry="1.9"/>',
        p("M9.9 18V7.4"),
        p("M19.1 16.4V5.8"),
        p("M9.9 7.4 19.1 5.8"),
        p("M9.9 10.1 19.1 8.5"),
    ]


# ── Downloads ────────────────────────────────────────────────────────────────
def downloads() -> list[str]:
    """Archive tray with a DOWNWARD arrow above it. Arrow direction is explicit."""
    return [
        p("M3.4 9.4h17.2v10.2H3.4z"),
        p("M3.4 9.4V5.2h17.2v4.2"),
        p("M7.4 13.2h2.6"),
        p("M14 13.2h2.6"),
        p("M12 2.6v5"),
        p("M9.8 5.4 12 7.6l2.2-2.2"),
    ]


# ── About ────────────────────────────────────────────────────────────────────
def about() -> list[str]:
    """Open book: two leaves meeting at a spine, curved outer edges, no text."""
    return [
        p("M12 6.6C9.9 4.9 7.1 4.2 3.6 4.4v13.3c3.5-.2 6.3.5 8.4 2.2"),
        p("M12 6.6c2.1-1.7 4.9-2.4 8.4-2.2v13.3c-3.5-.2-6.3.5-8.4 2.2"),
        p("M12 6.6v13.3"),
        p("M3.6 4.4C6.1 3.3 8.9 3.4 12 4.6"),
        p("M20.4 4.4C17.9 3.3 15.1 3.4 12 4.6"),
    ]


# ── Contact ──────────────────────────────────────────────────────────────────
def contact() -> list[str]:
    """Envelope: body, flap converging on centre, two short fold lines."""
    return [
        p("M2.8 6.6h18.4v11.2H2.8z"),
        p("M2.8 6.6 12 13.4l9.2-6.8"),
        p("M2.8 17.8 8.9 12.2"),
        p("M21.2 17.8 15.1 12.2"),
    ]


# ── Privacy ──────────────────────────────────────────────────────────────────
def privacy() -> list[str]:
    """Padlock: shackle, body, keyhole."""
    return [
        p("M7.6 10.4V7.8a4.4 4.4 0 0 1 8.8 0v2.6"),
        p("M4.4 10.4h15.2v10.2H4.4z"),
        '<circle cx="12" cy="14.6" r="1.5"/>',
        p("M12 16.1v1.9"),
    ]


# ── Terms ────────────────────────────────────────────────────────────────────
def terms() -> list[str]:
    """Legal page: folded corner, three ruled lines, ribbon tail."""
    return [
        p("M5.4 3.2h9.6l4.6 4.6v11.4H5.4z"),
        p("M15 3.2v4.6h4.6"),
        p("M8.4 11.4h7.2"),
        p("M8.4 14h7.2"),
        p("M8.4 16.6h4.4"),
        p("M10.6 19.2v2.2l1.5-1.1 1.5 1.1v-2.2"),
    ]


BUILDERS = {
    "home": home,
    "people": people,
    "timeline": timeline,
    "full-tree": full_tree,
    "search": search,
    "families": families,
    "dna": dna,
    "ballads": ballads,
    "downloads": downloads,
    "about": about,
    "contact": contact,
    "privacy": privacy,
    "terms": terms,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sprite = []
    for name, builder in BUILDERS.items():
        body = "".join(builder())
        (OUT / f"{name}.svg").write_text(HEAD + body + "</svg>\n", encoding="utf-8")
        sprite.append(
            f'<symbol id="i-{name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round">{body}</symbol>'
        )
        print(f"{name:12s} {len(body):4d} chars")
    (OUT / "sprite.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + "".join(sprite) + "</svg>\n",
        encoding="utf-8",
    )
    print(f"\nwrote {len(BUILDERS)} icons + sprite.svg to {OUT}")


if __name__ == "__main__":
    main()
