#!/usr/bin/env python3
"""Copy a vault relationships: list into raw people.json WHOLE.

WHY: people.json holds TWO representations of the same vault field — the parsed
`relationships: [{type, names}]` array (what build-relationship-graph reads) and
the derived parents/children/... slug arrays (rewritten on every regenerate).
convert-markdown.mjs parses the field once and SKIPS profiles whose .md it has
already seen, so the parsed array goes stale while the slug arrays move on.

The result is silent disagreement, exactly as the adoption-label work found on
2026-11-04: the vault said "Susan (1967-living, adopted)", the slug arrays
recorded her as a stepchild of Murray, and the parsed array still named both
Murray and Shirley as Father/Mother — so every rebuild re-derived a biological
edge, and the pre-commit crown-jewel guard reported "murray-telfer-1924 children
6 -> 5 (lost 1)" as an unexplained shrink.

Usage: sync-parsed-relationships.py "Person.md" ["Another Person.md"] ...
Vault: $OBSIDIAN_VAULT or ~/ObsidianVault
"""
import json, os, re, sys

VAULT = os.environ.get("OBSIDIAN_VAULT", os.path.expanduser("~/ObsidianVault"))
PEOPLE_MD = os.path.join(VAULT, "Family History", "People")
PEOPLE_JSON = "src/data/people.json"


def parse_relationships(rel):
    out = []
    if isinstance(rel, list):
        return rel
    if not isinstance(rel, str):
        return out
    for part in rel.split("|"):
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        names, buf, depth = [], "", 0
        for ch in v:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth = max(0, depth - 1)
            if ch == "," and depth == 0:
                names.append(buf)
                buf = ""
            else:
                buf += ch
        names.append(buf)
        out.append({"type": k.strip(), "names": [n.strip() for n in names if n.strip()]})
    return out


def main(files):
    data = json.load(open(PEOPLE_JSON))
    by_id = {p.get("id"): p for p in data}
    changed = 0
    for fn in files:
        path = fn if os.path.isabs(fn) else os.path.join(PEOPLE_MD, fn)
        txt = open(path, encoding="utf-8").read()
        fm = re.match(r"^---\n(.*?)\n---", txt, re.S)
        if not fm:
            print(f"SKIP (no frontmatter): {fn}")
            continue
        title = re.search(r"^title:\s*(.+?)\s*(?:—.*)?$", fm.group(1), re.M)
        rel = re.search(r"^relationships:\s*['\"]?(.*)$", fm.group(1), re.M | re.S)
        if not rel:
            print(f"SKIP (no relationships:): {fn}")
            continue
        # Re-read the folded scalar from YAML properly.
        import yaml
        try:
            fmdata = yaml.safe_load(fm.group(1)) or {}
        except Exception as e:  # noqa: BLE001
            print(f"SKIP (bad yaml): {fn}: {e}")
            continue
        newrel = parse_relationships(fmdata.get("relationships"))
        # ── MIRROR, DON'T REPLACE (2026-11-04) ────────────────────────────────
        # md_to_json.py writes relationships as an OBJECT {rel: [names]}; copy the
        # object over and the whole resolver silently goes blind, which is exactly
        # what happened: parents/children/siblings emptied on hundreds of profiles
        # in one regen (adam-dillon-1870 lost both parents). Refuse to overwrite a
        # shape that is not the [{type, names}] array this file exists to sync.
        existing = cands[0].get("relationships")
        if existing and not (isinstance(existing, list) and existing and isinstance(existing[0], dict)):
            print(f"REFUSED (existing relationships is {type(existing).__name__}, not a list of {{type, names}}): {fn}")
            continue
        display = os.path.splitext(os.path.basename(fn))[0]
        # The vault filename carries the death year ("(1924–2009)") but people.json's
        # id carries the BIRTH year ("Murray John Telfer (1924)") — a plain dict hit on
        # the full filename bound this script to john-telfer-1805 on its first run.
        # Match on the bare name with every bracketed year range removed, and REFUSE
        # anything that is not exactly one profile.
        bare = re.sub(r"\s*\([^)]*\)\s*", " ", display).strip()
        cands = [p for p in data
                 if re.sub(r"\s*\([^)]*\)\s*", " ", str(p.get("display_name") or "")).strip() == bare]
        if len(cands) != 1:
            print(f"SKIP (ambiguous or unknown, {len(cands)} matches): {fn} -> {bare}")
            continue
        target = cands[0]
        target["relationships"] = newrel
        changed += 1
        print(f"SYNCED {target['slug']}: " + " | ".join(f"{r['type']}: {', '.join(r['names'])}" for r in newrel))
    if changed:
        json.dump(data, open(PEOPLE_JSON, "w"), indent=2, ensure_ascii=False)
        print(f"\npeople.json updated ({changed} profile(s)). Run regenerate + build.")


if __name__ == "__main__":
    main(sys.argv[1:])
