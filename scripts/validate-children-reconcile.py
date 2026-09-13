#!/usr/bin/env python3
"""
validate-children-reconcile.py — tw-2026-09-12-008 / tw-2026-09-12-052

THE FAULT
  Each vault profile can carry child information in THREE places that nothing reconciled:
    1. the prose "## Children" MARKDOWN TABLE
    2. the frontmatter `children:` LIST
    3. the `Children:` segment of the frontmatter `relationships:` PIPE-STRING
  convert-markdown.mjs reads (2) and (3) separately, so both are valid YAML, both render,
  and every other gate stays green while they drift apart. Result: ~96 profiles carried
  contradictory child data (27% of the vault) with nothing reporting it.

CANONICAL SOURCE (ruled 2026-09-12)
  `relationships:` is CANONICAL for NAMED CHILDREN. It is the richer field, it is what the
  generator that populates the live site actually consumes, and it carries qualifiers such
  as "(adopted)". `children:` is a convenience mirror and the PROSE TABLE is
  human-readable decoration. Neither may introduce or drop a NAME that is not in
  `relationships:`.

WHAT THIS ENFORCES
  Compare NAMES ONLY, normalised:
    - strip the "(1832–1896)" lifespan suffix
    - strip qualifiers like "(adopted)"
    - lower-case, collapse whitespace
    - ORDER IS IGNORED
  Then:
    HARD FAIL  any name present in `children:` but absent from `relationships:`
    HARD FAIL  any name present in the prose table but absent from `relationships:`
    WARN       `relationships:` child list empty while the other two have names
               (informational — that is a genuine mirror gap, not a contradiction)
  An EMPTY `children:` or an ABSENT prose table is NOT a failure: absence is not a
  contradiction. Only an EXTRA NAME is, because that is a claim relationships: does not make.

Exit 0 = reconciled. 1 = a name appears outside the canonical field. 2 = could not read.
Fails CLOSED on an unreadable vault.

USAGE: validate-children-reconcile.py [--vault PATH] [--limit N] [--quiet] [--json]
"""
import argparse
import glob
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
DEFAULT_VAULT = os.path.join(HOME, "ObsidianVault", "Family History", "People")

LIFESPAN = re.compile(r"\s*\(\s*(?:c\.\s*)?\d{3,4}\s*[–\-—]\s*(?:c\.\s*)?(?:living|\d{3,4}|\?)\s*\)\s*")
# Qualifiers that decorate a name but are not part of it. NOTE "(m. Sloman)" and
# "(nee X)" are MARRIAGE qualifiers and must be stripped too — missing them left one
# residual false contradiction ("hannah march (m. sloman)" vs "hannah march").
QUALIFIER = re.compile(
    r"\s*\((?:adopted|step|foster|illegitimate|m\.|nee|née|married|marr\.)[^)]*\)\s*",
    re.IGNORECASE)
WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
FM = re.compile(r"^---\n(.*?)\n---", re.S)


def norm_name(raw):
    """Reduce a name to a comparable key: no lifespan, no qualifiers, no wikilink syntax."""
    s = str(raw or "")
    m = WIKILINK.search(s)
    if m:
        s = m.group(1)
    s = LIFESPAN.sub(" ", s)
    s = QUALIFIER.sub(" ", s)
    # Any REMAINING trailing parenthetical is decoration, not identity: "(m. Sloman)",
    # "(Sloman)", "(1829-1901)" already handled, etc. Drop a trailing group.
    s = re.sub(r"\s*\([^)]*\)\s*$", " ", s)
    # NICKNAMES in quotes are decoration: sydney glenroy "glen" stribling == sydney glenroy stribling
    s = re.sub(r'\s*"[^"]*"\s*', " ", s)
    s = re.sub(r"\s*'[^']*'\s*", " ", s)
    # A mid-name parenthetical is a married surname: lucy beatrice (parker) davey == lucy beatrice davey
    s = re.sub(r"\s*\([^)]*\)\s*", " ", s)
    # Trailing prose after an em-dash is annotation, not a name.
    s = re.sub(r"\s*[—-].*$", "", s)
    s = s.replace("*", "").replace("_", "").strip().strip(",")
    s = re.sub(r"\s+", " ", s)
    return s.lower()


LIFE_ANY = re.compile(r"\(\s*(?:c\.\s*)?\d{3,4}\s*[–\-—]\s*(?:c\.\s*)?(?:living|\d{3,4}|\?)\s*\)")


def life_key(raw):
    """
    Return the lifespan substring of a name, normalised, WITHOUT the surname.
    'Sophia March (1829–1901)' and 'Sophia Baker (1829–1901)' both -> '1829-1901'.
    Used to recognise the same person recorded under a maiden and a married surname.
    Returns '' when there is no lifespan to compare.
    """
    s = str(raw or "")
    m = WIKILINK.search(s)
    if m:
        s = m.group(1)
    lm = LIFE_ANY.search(s)
    if not lm:
        return ""
    digits = re.findall(r"(?:c\.\s*)?(\d{3,4}|living|\?)", lm.group(0))
    return "-".join(d.lower() for d in digits)


def parse_relationships(rel):
    """'Self: X | Spouse: Y | Children: A, B' -> {'children': ['A','B'], ...}"""
    out = {}
    if isinstance(rel, list):
        for r in rel:
            if isinstance(r, dict):
                t = str(r.get("type", "")).strip().lower()
                n = r.get("name") or r.get("person") or r.get("id")
                if t and n:
                    out.setdefault(t, []).append(str(n))
        return out
    if not isinstance(rel, str):
        return out
    for part in rel.split("|"):
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        k = k.strip().lower().rstrip("s")
        out.setdefault(k, []).extend(x.strip() for x in v.split(",") if x.strip())
    return out


def prose_children(body):
    """
    Names from the '## Children' section. Reads the markdown table's FIRST column
    (the child name) and any wikilinks in the section when there is no table.
    Returns a set of normalised names.
    """
    # Strip wikilink syntax to bare targets FIRST so a table cell like
    # "[[Sophia Baker (1829–1901)]]" cannot leave a stray "[sophia baker" fragment.
    m = re.search(r"\n#+\s*Children\s*\n(.*?)(?=\n#+\s|\Z)", body, re.S | re.I)
    if not m:
        return set()
    section = m.group(1)
    section = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", section)
    names = set()

    # Markdown table rows: | child | born | died | notes |
    for line in section.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not cells:
            continue
        if set(cells[0].lower()) <= set("-: "):        # separator row
            continue
        if cells[0].lower() in ("child", "children", "name"):
            continue
        n = norm_name(cells[0])
        if n and len(n) > 2:
            names.add(n)

    # Fallback / addition: wikilinks anywhere in the section.
    if not names:
        for wl in WIKILINK.findall(section):
            n = norm_name(wl)
            if n and len(n) > 2:
                names.add(n)
    return names


def prose_names_raw(body):
    """Same as prose_children() but returns the RAW cell text (lifespan intact)."""
    m = re.search(r"\n#+\s*Children\s*\n(.*?)(?=\n#+\s|\Z)", body, re.S | re.I)
    if not m:
        return []
    section = re.sub(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]", r"\1", m.group(1))
    out = []
    for line in section.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not cells:
            continue
        if set(cells[0].lower()) <= set("-: "):
            continue
        if cells[0].lower() in ("child", "children", "name"):
            continue
        if cells[0]:
            out.append(cells[0])
    return out


def check_profile(path):
    """Return (problems, warnings) for one profile."""
    try:
        txt = open(path, "r", encoding="utf-8").read()
    except OSError as e:
        return [f"unreadable: {e}"], []

    fm = FM.match(txt)
    if not fm:
        return [], []                      # not a frontmatter profile; out of scope
    body = txt[fm.end():]

    try:
        import yaml
        fmdata = yaml.safe_load(fm.group(1)) or {}
    except Exception as e:                                             # noqa: BLE001
        return [f"frontmatter did not parse: {e}"], []
    if not isinstance(fmdata, dict):
        return [], []

    rel = parse_relationships(fmdata.get("relationships"))
    canon_raw = rel.get("child", []) + rel.get("children", [])
    canon = {norm_name(x) for x in canon_raw}
    canon.discard("")

    ch_raw = fmdata.get("children")
    ch = {norm_name(x) for x in ch_raw} if isinstance(ch_raw, list) else set()
    ch.discard("")

    prose = prose_children(body)

    problems, warnings = [], []

    # LIFESPAN-KEY MATCH (tw-2026-09-12-008): the same woman may appear under a maiden
    # and a married surname — "Sophia March (1829–1901)" vs "Sophia Baker (1829–1901)".
    # An IDENTICAL lifespan is a strong identity signal, so a surname-only difference is
    # not a contradiction. A different lifespan still IS one, so this cannot mask a real
    # mismatch by accident.
    # Build the index from the RAW fields (canon_raw and the raw children list), because
    # norm_name() strips the lifespan — keying off the normalised sets made this check
    # impossible to fire.
    canon_life = {}                      # lifespan -> first name(s) seen
    for raw in canon_raw:
        lk = life_key(raw)
        if lk:
            first = norm_name(raw).split()[0] if norm_name(raw) else ""
            canon_life.setdefault(lk, set()).add(first)

    def explained(raw):
        """Same first name AND identical lifespan => same person, surname changed by marriage."""
        lk = life_key(raw)
        if not lk or lk not in canon_life:
            return False
        first = norm_name(raw).split()[0] if norm_name(raw) else ""
        return bool(first) and first in canon_life[lk]

    ch_raw_list = ch_raw if isinstance(ch_raw, list) else []
    extra_ch = sorted(norm_name(x) for x in ch_raw_list
                      if norm_name(x) and norm_name(x) not in canon and not explained(x))
    extra_ch = sorted(set(extra_ch))
    if extra_ch:
        problems.append(
            "children: carries name(s) absent from relationships:: " + ", ".join(extra_ch))

    prose_raw_names = prose_names_raw(body)
    extra_prose = sorted(set(
        norm_name(x) for x in prose_raw_names
        if norm_name(x) and norm_name(x) not in canon and not explained(x)))
    if extra_prose:
        problems.append(
            "prose Children table carries name(s) absent from relationships:: "
            + ", ".join(extra_prose))

    if canon and not ch and not prose:
        warnings.append("relationships: lists children but children: and the prose table are both empty")

    return problems, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", default=DEFAULT_VAULT)
    ap.add_argument("--limit", type=int, default=0, help="Print at most N problem profiles.")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not os.path.isdir(args.vault):
        print(f"CHILDREN RECONCILE FAILED: {args.vault} is not a directory — refusing to pass",
              file=sys.stderr)
        return 2

    files = sorted(glob.glob(os.path.join(args.vault, "*.md")))
    if not files:
        print(f"CHILDREN RECONCILE FAILED: {args.vault} contains zero .md files — refusing "
              f"to pass blind", file=sys.stderr)
        return 2

    offenders, warners, scanned = {}, {}, 0
    for f in files:
        problems, warnings = check_profile(f)
        if problems or warnings:
            scanned += 1
        if problems:
            offenders[os.path.basename(f)] = problems
        if warnings:
            warners[os.path.basename(f)] = warnings

    if args.json:
        print(json.dumps({"offenders": offenders, "warnings": warners,
                          "profiles": len(files)}, indent=1))
        return 1 if offenders else 0

    if not args.quiet:
        print("# children reconciliation (relationships: is canonical)")
        print(f"  profiles scanned : {len(files)}")
        print(f"  CONTRADICTIONS   : {len(offenders)}")
        print(f"  mirror gaps      : {len(warners)}  (informational)")
        print()

    if offenders:
        shown = 0
        for name in sorted(offenders):
            if args.limit and shown >= args.limit:
                print(f"  ... and {len(offenders) - shown} more")
                break
            print(f"CONTRADICTION {name}")
            for p in offenders[name]:
                print(f"    - {p}")
            shown += 1
        print("\nFix: relationships: is canonical. Either add the name there, or remove it"
              "\nfrom children: / the prose table. Do NOT add a name to the canonical field"
              "\nmerely to silence this check — that would invent a child.")
        return 1

    print(f"OK — {len(files)} profiles, no child name contradicts relationships:"
          f" ({len(warners)} informational mirror gap(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
