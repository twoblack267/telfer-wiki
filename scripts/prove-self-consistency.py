#!/usr/bin/env python3
"""Prove every page-self-consistency detector by EXECUTION, not by reading.

Card tk-linter-probe-debt. A detector that has never flagged a page known to be
bad is decoration: it can ship a silent miss to the live site and nothing notices.
Each probe below writes a synthetic page carrying exactly ONE defect, runs the
real script against that file, and asserts the expected code fires. A clean
control page and a redirect stub must stay SILENT -- a detector that fires on
clean pages is the same debt pointing the other way.

Deterministic. No vault writes. No network. Safe for CI.

Usage: python3 scripts/prove-self-consistency.py [-v]
Exit 0 = every detector proved. Exit 1 = at least one detector is unproven.
"""
import os, sys, subprocess, tempfile, shutil

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "page-self-consistency.py")
VERBOSE = "-v" in sys.argv


def fm(**kw):
    return "---\n" + "".join(f"{k}: {v}\n" for k, v in kw.items()) + "---\n\n"


# (probe filename, page text, expected detector code or None for must-stay-silent)
PROBES = [
    ("SC6_died_before_born.md",
     fm(first_name="Ada", last_name="Test", birth_year=1900, death_year=1890, tags="person")
     + "# Ada\n\nText.\n", "SC6"),
    ("SC1_self_lifespan_drift.md",
     fm(first_name="Ernest", last_name="Test", birth_year=1878, death_year=1953, tags="person")
     + "# Ernest Test\n\n**Ernest Test (1878\u20131877)** was born.\n\n## Life\nText.\n", "SC1"),
    ("SC2_age_at_death.md",
     fm(first_name="Bert", last_name="Test", birth_year=1900, death_year=1980, tags="person")
     + "# Bert Test\n\n**Died:** 3 Aug 1980, Bert Test aged 61 at Timbuktu.\n\n## Life\nText.\n", "SC2"),
    ("SC3_parent_died_before_birth.md",
     fm(first_name="Cecil", last_name="Test", birth_year=1890, death_year=1950,
        father="[[John Test (1850-1880)]]", tags="person")
     + "# Cecil Test\n\nText.\n", "SC3"),
    ("SC4_children_mismatch.md",
     fm(first_name="Dot", last_name="Test", birth_year=1880, death_year=1950,
        children="[Alan Test, Beatrix Unknownname]",
        relationships="### Children:\n- [[Alan Test (1905-1970)]]", tags="person")
     + "# Dot Test\n\nText.\n", "SC4"),
    ("SC5_marriage_before_birth.md",
     fm(first_name="Eve", last_name="Test", birth_year=1900, death_year=1970, tags="person")
     + "# Eve Test\n\nEve Test married 1889 in Nowhere.\n\n## Life\nText.\n", "SC5"),
    # SC7 indexes page FILENAMES: the stem must END with the year/range, and the
    # person key is "<first> <last>" lowercased. Two different stems that resolve to
    # the same name + lifespan is exactly what the detector counts.
    ("Gus Test (1880–1940).md",
     fm(first_name="Gus", last_name="Test", birth_year=1880, death_year=1940, tags="person")
     + "# Gus Test\n\nText.\n", "SC7"),
    ("Gus  Test (1880–1940).md",
     fm(first_name="Gus", last_name="Test", birth_year=1880, death_year=1940, tags="person")
     + "# Gus Test\n\nText.\n", "SC7"),
    # ---- must NOT fire ----
    ("CONTROL_clean_page.md",
     fm(first_name="Fay", last_name="Test", birth_year=1900, death_year=1970, tags="person")
     + "# Fay Test\n\n**Fay Test (1900\u20131970)** was born.\n\n## Life\nFay Test aged 70.\n", None),
    ("CONTROL_redirect_stub.md",
     "---\ntags: person, redirect\n---\n\nRedirect to the canonical page.\n", None),

    # ==== BOTH-DIRECTION PROBES (card tk-linter-probe-debt, gaps a-e) ====
    # A guard that suppresses a GENUINE defect is worse than no guard: it certifies bad
    # work. Each pair gives the same defect with and without the excusing feature, so
    # the guard is proved to suppress only what it should.

    # (a) SC5 proved twice over: a marriage before birth fires; a marriage one year
    #     after birth is grotesque but arithmetically possible and must stay silent.
    #     This kills the reading that SC5's one corpus hit is a coincidence.
    ("SC5_marriage_far_before_birth.md",
     fm(first_name="Iris", last_name="Test", birth_year=1910, death_year=1980, tags="person")
     + "# Iris Test\n\nIris Test married 1870 in Nowhere.\n\n## Life\nText.\n", "SC5"),
    # The floor is under-12: a marriage at 11 is a child marriage and MUST fire; a
    # marriage at 13 is young but possible and MUST stay silent. (A marriage 1 year
    # after birth SHOULD fire -- it is impossible -- so it is not the silent control.)
    ("SC5_child_marriage_age_11.md",
     fm(first_name="Joan", last_name="Test", birth_year=1910, death_year=1980, tags="person")
     + "# Joan Test\n\nJoan Test married 1921 in Nowhere.\n\n## Life\nText.\n", "SC5"),
    ("CONTROL_sc5_marriage_age_13.md",
     fm(first_name="Kirk", last_name="Test", birth_year=1910, death_year=1980, tags="person")
     + "# Kirk Test\n\nKirk Test married 1923 in Nowhere.\n\n## Life\nText.\n", None),

    # (b) The birth-RANGE excuse must excuse an age landing INSIDE a range stated about
    #     the page's OWN subject, and must NOT excuse a 9-year error merely because a
    #     relative's dates happen to bracket it. That second half is the exact
    #     over-suppression this rule introduced and had to be repaired.
    ("CONTROL_sc2_age_inside_stated_range.md",
     fm(first_name="Kate", last_name="Test", birth_year=1865, death_year=1894, tags="person")
     + "# Kate Test\n\nBorn 1865 to 1869 (stub keeps 1865).\n\n"
       "**Died:** 7 Sep 1894, Kate Test aged 25.\n\n## Life\nText.\n", None),
    ("SC2_age_excused_only_by_relative_dates.md",
     fm(first_name="Lena", last_name="Test", birth_year=1908, death_year=1969, tags="person",
        siblings="[[Brother Test (1875-1954)]]")
     + "# Lena Test\n\nHer brother [[Brother Test (1875-1954)]] lived long.\n\n"
       "**Died:** 2 Jun 1969, Lena Test aged 69.\n\n## Life\nText.\n", "SC2"),

    # (c) Attribution guard: an age plainly belonging to ANOTHER named person stays
    #     silent; the same kind of age on the subject fires. Both directions.
    ("CONTROL_sc2_age_belongs_to_other.md",
     fm(first_name="Maud", last_name="Test", birth_year=1890, death_year=1960, tags="person")
     + "# Maud Test\n\nHer mother Ellen Test died 1950 aged 88 years. Maud Test lived on.\n\n"
       "## Life\nText.\n", None),
    ("SC2_age_belongs_to_subject.md",
     fm(first_name="Nell", last_name="Test", birth_year=1890, death_year=1960, tags="person")
     + "# Nell Test\n\nNell Test died 1960 aged 40.\n\n## Life\nText.\n", "SC2"),

    # (d) Nearest-name guard: a DIFFERENT person's name between the subject's name and
    #     the figure silences it; the subject's own age with no intervenor still fires.
    ("CONTROL_sc2_other_name_intervenes.md",
     fm(first_name="Olive", last_name="Test", birth_year=1870, death_year=1930, tags="person")
     + "# Olive Test\n\nOlive Test married Thomas Harrow, who died aged 91 years.\n\n"
       "## Life\nText.\n", None),
    ("SC2_subject_age_no_intervening_name.md",
     fm(first_name="Pearl", last_name="Test", birth_year=1870, death_year=1930, tags="person")
     + "# Pearl Test\n\nPearl Test died aged 91 years.\n\n## Life\nText.\n", "SC2"),

    # (e) A conflict flag excuses the page that PUBLISHES the disagreement (rule line
    #     199: flag for Mark, never quietly resolve) and must NOT excuse a page that
    #     simply carries the error quietly.
    ("CONTROL_sc2_conflict_flagged.md",
     fm(first_name="Rita", last_name="Test", birth_year=1908, death_year=1969, tags="person")
     + "# Rita Test\n\n> **SOURCE CONFLICT \u2014 FLAGGED FOR MARK, NOT RESOLVED.** "
       "Death register says 69; birth register says 1908.\n\n"
       "**Died:** 2 Jun 1969, Rita Test aged 69.\n\n## Life\nText.\n", None),
    ("SC2_quiet_age_error_no_flag.md",
     fm(first_name="Stella", last_name="Test", birth_year=1908, death_year=1969, tags="person")
     + "# Stella Test\n\n**Died:** 2 Jun 1969, Stella Test aged 69.\n\n## Life\nText.\n", "SC2"),

    # A Sources block CITES a title, it does not assert it. FindAGrave's own title on a
    # 1957-born man's page reads (1958-1996); quoting a memorial's title is not the page
    # contradicting itself, so this must stay silent.
    ("CONTROL_sc1_year_only_in_sources_block.md",
     fm(first_name="Tom", last_name="Test", birth_year=1957, death_year=1996, tags="person")
     + "# Tom Test\n\n**Tom Test (1957\u20131996)** was born.\n\n## Life\nText.\n\n"
       "## Sources\n\n- **FindAGrave** \u2014 [Tom Test (1958\u20131996)](https://example.org/1)\n",
     None),

    # A page that says a value was FORMERLY wrong has fixed itself and must stay
    # silent; the same conflicting value presented as fact must still fire.
    ("CONTROL_sc1_former_value_in_correction.md",
     fm(first_name="Una", last_name="Test", birth_year=1878, death_year=1953, tags="person")
     + "# Una Test\n\n**Una Test (1878\u20131953)** was born; formerly given as 1877, "
       "corrected from the register.\n\n## Life\nText.\n", None),
    ("SC1_former_value_not_marked_as_correction.md",
     fm(first_name="Vera", last_name="Test", birth_year=1878, death_year=1953, tags="person")
     + "# Vera Test\n\n**Vera Test (1878\u20131877)** was born.\n\n## Life\nText.\n", "SC1"),
]


def main():
    tmp = tempfile.mkdtemp(prefix="sc-probe-")
    try:
        paths = []
        for name, text, _ in PROBES:
            p = os.path.join(tmp, name)
            open(p, "w", encoding="utf-8").write(text)
            paths.append(p)

        failed = []
        for name, _, want in PROBES:
            # Scan the WHOLE temp dir, not just this one file: SC7 counts how many
            # pages claim the same person + lifespan, so a duplicate pair is only
            # visible when both files are in the same sweep. Per-file invocation
            # makes ">1 page" impossible by construction.
            env = dict(os.environ, TELFER_PEOPLE_DIR=tmp)
            r = subprocess.run([sys.executable, SCRIPT, tmp], capture_output=True,
                               text=True, env=env)
            fired = sorted({ln.split()[1] for ln in r.stdout.splitlines()
                            if len(ln.split()) > 1 and ln.split()[1].startswith("SC")
                            and name in ln})
            if want is None:
                ok = not fired
                label = "MUST STAY SILENT"
            else:
                ok = want in fired
                label = f"expects {want}"
            if VERBOSE or not ok:
                print(f"{'PASS' if ok else 'FAIL'}  {name:38s} {label:20s} fired={fired}")
            if not ok:
                failed.append((name, want, fired, r.stdout.strip()[:400]))

        print()
        if failed:
            print(f"UNPROVEN: {len(failed)} of {len(PROBES)} probes failed")
            for name, want, fired, out in failed:
                print(f"  - {name}: wanted {want}, got {fired}\n    {out}")
            return 1
        print(f"ALL {len(PROBES)} PROBES PASS \u2014 every detector fires on its own defect "
              f"and stays silent on a clean page and a redirect stub")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
