#!/usr/bin/env python3
"""
page-self-consistency.py — catch OBJECTIVE internal contradictions on a person page.

Why: every defect the 2026-11 audit found by hand was visible in the page itself —
a mother who died before her child was born, an age at death that cannot match the
birth year, frontmatter listing children the body does not, a person's own name
carrying two different lifespans. None of it needs a records search; it needs a
comparison the build never made. This does that comparison at commit time.

WHAT IT CHECKS (objective only — no guesses about which source is right):
  SC1  Self lifespan drift   — the page's own subject named with two lifespans whose
                               birth years differ, outside a correction note.
  SC2  Age-at-death vs birth — "aged N" / "aged N years" in prose checked against the
                               page's own birth year (tolerance +-1 for registration slop).
  SC3  Parent/child order    — a parent's death year earlier than a child's birth year.
  SC4  Children reconcile    — frontmatter `children:` vs body Family table vs the
                               `relationships:` Children: list. Names in one but not another.
  SC5  Marriage vs birth     — spouse marriage year before the subject's birth year,
                               or before the subject's own claimed marriage age floor (12).
  SC6  Died-before-born      — death_year < birth_year, or a lifespan span written backwards.

DELIBERATELY NOT CHECKED (known false-positive classes, proven in the audit):
  * two different people sharing a name on one page (infant + namesake is correct)
  * "formerly X, corrected to Y" — that is the vault working properly
  * single-source thinness — that is not contradiction
  * which of two conflicting sources is TRUE — never arbitrated here

Exit codes: 0 clean (or only below-threshold notes), 1 findings at/above --fail-level.
"""
import os, re, sys, json, glob, argparse

BASE = "/Users/marktelfer/ObsidianVault/Family History/People"
CORRECTION = re.compile(r"formerly|corrected|previously (?:recorded|given)|was\s+\d{4}", re.I)
# A page that QUOTES a value it has already judged wrong is not self-contradictory:
# it is an audit record. This is the shape these pages actually take --
#   "FindAGrave (1882-1953) ... the death date given on this memorial is incorrect"
#   "*A Telfer Family Tree* prints 1891 in the numbered list ... the book's 1891 is wrong"
#   "Find a Grave gives ~1805 (died 1892 aged 86) ... resolved to 1810"
#   "FindAGrave's index gives the year as 1958"
# A line that RECORDS a source disagreement, a resolved-range age, or a register quote is
# adjudicated content, not a self-contradiction. Kept DELIBERATELY narrow: it must name a
# disagreeing source or an honest age range ON THE SAME LINE as the figure.
# A line that is a REGISTER EXTRACT or a LIST ROW does not assert anything about the
# page subject's lifespan: it reproduces someone else named the same way.
NOT_A_CLAIM = re.compile(
    r"\badmitted\b|\bdisease\b|\bNRS\s+ref\b|\bprisoner\b|\bconvict\b"
    r"|\bregister\b[^.]{0,60}\baged\b|^\s*\|[^|]*\|[^|]*\baged\s+\d",
    re.I)
# A second adult named on a "Died ..." line means the age may be theirs.
OTHER_PERSON = re.compile(
    r"\b(?:also|his\s+wife|her\s+husband|son|daughter|brother|sister|mother|father|"
    r"widow|widower)\b\s+(?:[A-Z][a-z]+|[Aa]n?\s+[A-Z])", re.I)
DISAGREE = re.compile(
    r"(?:sources?\s+disagree|disagree|disputed|contradicted|corrected|resolved|preferred)"
    r".{0,160}(?:aged|age\s+of|\d{4})"
    r"|(?:aged|age\s+of)\s+\d{1,3}\s*[-–\u2013]\s*\d{1,3}"      # "aged 86-87" = an honest range
    r"|(?:book|supplement|find\s*a\s*grave|ozburials|register|index|notice|memorial|cemetery)"
    r"[^.]{0,140}\baged\s+\d{1,3}",
    re.I)
AUDIT_NOTE = re.compile(
    r"\b(?:book|source|sources|register|index|record|records|ocr|list|narrative|"
    r"memorial|headstone|stone|inscription|grave|cemetery|wikitree|ancestry|findagrave|"
    r"find a grave|familysearch|ozburials|austcemindex|trove|book|index|supplement)\b"
    r".{0,160}?\b(?:prints?|printed|reads?|read|gives?|given|has|have|shows?|lists?|"
    r"records?|says?|carries|states?|disagree|disputed|unconfirmed|incorrect|wrong|error|"
    r"variance|mismatch|contradict\w*|accessed|source|ref|per|according)\b"
    # Citation-list form: a source is named and a lifespan follows, with no verb
    # between them -- "- Lehmann/Henschke index - Charles Telfer (1874-1954)".
    # The line is quoting what that source prints, so it cannot contradict.
    r"|(?:^|[\s\-(])(?:[A-Z][\w/.'-]*\s+){0,3}"
    r"(?:book|source|index|record|register|memorial|headstone|stone|inscription|"
    r"grave|cemetery|supplement|narrative)s?\b[^.]{0,120}?"
    r"\(\s*(?:c\.|bap\.|b\.)?\s*1[5-9]\d\d\b",
    re.I)

# A lifespan the line assigns to SOMEONE ELSE -- "Spouse | Violet Merle Crossman
# (1912-2004)", "wife Janet died ... aged 90", "brother Alexander (1876)". The subject's
# name and another person's lifespan on one line is a family list, not a contradiction.
RELATION = re.compile(r"\b(?:spouse|husband|wife|father|mother|son|daughter|child|children|"
                      r"sibling|sister|brother|parents?|widow|widower)\b", re.I)


def attributes_elsewhere(line, b, e):
    """True when the line credits this lifespan to a relative, not to the subject."""
    span = re.compile(r"\(?\s*%d\s*[–\u2013\u2014-]\s*%s\s*\)?" % (b, re.escape(str(e))))
    m = span.search(line)
    if not m:
        return False
    head = line[:m.start()]
    # nearest relation word inside this line before the span, with no sentence break
    tail = re.split(r"[.;]\s", head)[-1]
    return bool(RELATION.search(tail))
SPAN = re.compile(r"\(?\b(1[5-9]\d\d|20[0-2]\d)\s*[–—-]\s*((?:1[5-9]\d\d)|20[0-2]\d|\?|present)\b\)?")


def frontmatter(text):
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    block = text[3:end]
    fm = {}
    key = None
    for raw in block.splitlines():
        m = re.match(r"^([a-z_]+):\s*(.*)$", raw)
        if m:
            key = m.group(1)
            fm[key] = m.group(2).strip()
        elif key and raw.strip():
            # newline-join, never space-join: a block list's "- " markers are data
            fm[key] = (fm.get(key, "") + "\n" + raw.strip()).strip()
    return fm


def body_of(text):
    end = text.find("\n---", 3)
    return text[end + 4:] if end >= 0 else text


_INDEX = None


def _index():
    """{(first, last, birth, death-or-None): count} built from page filenames."""
    global _INDEX
    if _INDEX is not None:
        return _INDEX
    idx = {}
    for f in glob.glob(os.path.join(BASE, "*.md")):
        stem = os.path.basename(f)[:-3]
        m = re.match(r"^(.*?)\s*(?:\(b\.\s*)?(?:c\.)?(1[5-9]\d\d|20[0-2]\d)(?:\s*[–\u2013\u2014-]\s*((?:1[5-9]\d\d)|(?:20[0-2]\d)))?\s*\)?$", stem)
        if not m:
            continue
        nm = m.group(1).strip().lower()
        idx.setdefault((nm, int(m.group(2)), int(m.group(3)) if m.group(3) else None), 0)
        idx[(nm, int(m.group(2)), int(m.group(3)) if m.group(3) else None)] += 1
    _INDEX = idx
    return idx


_SPANS = None


def owns_span(b, e):
    """True if ANY page's filename carries this lifespan (b, e is the body's own span).
    'William Telfer (1802–1850)' mentioned on his father's page is not a contradiction."""
    global _SPANS
    if _SPANS is None:
        _SPANS = set()
        for path in glob.glob(os.path.join(BASE, "*.md")):
            stem = os.path.basename(path)[:-3]
            for mm in re.finditer(r"(1[5-9]\d\d|20[0-2]\d)\s*[–\u2013\u2014-]\s*((?:1[5-9]\d\d)|(?:20[0-2]\d))", stem):
                _SPANS.add((int(mm.group(1)), int(mm.group(2))))
    return (b, int(e)) in _SPANS if str(e).isdigit() else False


def page_claims(fn, ln, b, e):
    """How many pages' filenames claim this exact person + lifespan?"""
    idx = _index()
    nm = f"{fn} {ln}".strip().lower()
    n = idx.get((nm, b, int(e) if str(e).isdigit() else None), 0)
    if not n:  # also try matching on birth year alone
        n = sum(c for (k, kb, ke), c in idx.items() if k == nm and kb == b)
    return n


def names_from(text, key="children"):
    """Read a frontmatter key that may be an inline list, a block list, or []."""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        block = text[3:end] if end > 0 else text
    else:
        block = text
    km = re.search(r"^" + re.escape(key) + r":\s*(.*)$", block, re.M)
    if not km:
        return []
    inline = km.group(1).strip()
    items = []
    if inline and inline != "[]":
        if inline.startswith("["):
            items = re.findall(r'["\']([^"\']+)["\']', inline) or [inline.strip("[]")]
        else:
            items = [inline]
    # block-list lines that follow
    tail = block[km.end():]
    for raw in tail.splitlines():
        m = re.match(r"^\s*-\s*(.+)$", raw)
        if m:
            items.append(m.group(1))
        elif raw.strip() and not raw.startswith((" ", "\t")):
            break
    out = []
    for p in items:
        p = re.sub(r"^\s*-\s*", "", p)
        p = p.strip().strip('"\'[]').strip()
        m = re.match(r"^(.*?)\s*\(\s*b?\.?\s*[^)]*\)\s*$", p)
        if m:
            p = m.group(1).strip()
        if p:
            out.append(p)
    return out


def rel_children(fm):
    rel = fm.get("relationships", "")
    m = re.search(r"Children:\s*([^|]+)", rel)
    if not m:
        return []
    out = []
    parts, depth, cur = [], 0, ""
    for ch in m.group(1):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur); cur = ""
        else:
            cur += ch
    parts.append(cur)
    for p in parts:
        p = p.strip().strip("'\"")
        p = re.sub(r"\(\s*b?\.?\s*[^)]*\)$", "", p).strip()
        if p:
            out.append(p)
    return out


def short(name):
    """'william john baker (1861–1946)' -> 'william john baker'.
    Parens are dropped ONLY when they are a lifespan or a date; a paren that carries
    words ('adopted', 'm. john mansfield 1871') is part of the description and is
    flattened into the key so it cannot masquerade as a name."""
    n = name.replace("'", " ").replace('"', " ")
    n = re.sub(r"\((?:\s*(?:b\.?\s*)?(?:c\.\s*)?\d{4}\s*(?:[–\u2013\u2014-]\s*(?:\d{4}|\?|living))?\s*)\)", " ", n)
    n = re.sub(r"\((?=[^)]*[A-Za-z]{4})", " ", n).replace(")", " ")
    return re.sub(r"\s+", " ", n).strip()


def norm(n):
    return re.sub(r"\s+", " ", n.replace("[[", "").replace("]]", "")).strip().lower()


def find_pages(paths):
    if paths:
        return paths
    return sorted(glob.glob(os.path.join(BASE, "*.md")))


def check(path):
    text = open(path, encoding="utf-8").read()
    fm = frontmatter(text)
    body = body_of(text)
    findings = []
    base = os.path.basename(path)
    if "redirect" in fm.get("tags", "") or "Redirect" in body[:400]:
        return base, []          # a stub that points at the canonical page, by design

    try:
        by = int(fm.get("birth_year", "") or 0)
    except ValueError:
        by = 0
    try:
        dy = int(fm.get("death_year", "") or 0)
    except ValueError:
        dy = 0

    # SC6 died before born
    if by and dy and dy < by:
        findings.append(dict(code="SC6", sev="HIGH",
                             msg=f"death_year {dy} is before birth_year {by}"))

    # SC1 self lifespan drift — the SUBJECT named with a lifespan that cannot be the
    # same person as the frontmatter one.
    #
    # NOT a finding (the audit proved these twice):
    #   * the span exactly matches another page's filename -> that is a relative with
    #     the same name, correctly rendered. Skip.
    #   * the birth years differ by more than 2 -> plainly a different generation.
    # REPORTED:
    #   * the frontmatter span also appears on some other page's filename -> the subject
    #     is ambiguous: two pages claim one person. (structural)
    #   * birth years within 2 but lifespans differ, no page matches either -> the subject
    #     carries two incompatible versions of their own life. (contradiction)
    fn = fm.get("first_name", "").strip()
    mn = fm.get("middle_name", "").strip()
    ln = fm.get("last_name", "").strip()
    subj_pat = None
    if fn and ln:
        full = f"{fn} {mn} {ln}".replace("  ", " ").strip()
        # Token form, NOT a mega-regex: find the subject's name, look ahead a short
        # window for "(1900-1920)". The old pattern silently failed to compile under
        # Python 3.14 (character-class \_) and had been vouching for every page.
        names_re = re.compile(r"\b(?:" + re.escape(full) + "|" + re.escape(fn + " " + ln) + r")\b", re.I)
        span_re = re.compile(r"\(?\s*(1[5-9]\d\d|20[0-2]\d)\s*[–\u2013\u2014-]\s*"
                             r"((?:1[5-9]\d\d)|(?:20[0-2]\d)|\?|present)", re.I)

        def adj_finditer(line):
            for nm in names_re.finditer(line):
                window = line[nm.end():nm.end() + 40]
                sm = span_re.search(window)
                if sm:
                    yield sm
        subj_pat = re.compile(r"\b" + re.escape(fn + " " + ln) + r"\b", re.I)
        # A page may carry an explicit same-name disambiguation ("distinct person from
        # [[X (1761-1845)]]"). Every other page's spans are already exempt via owns_span;
        # this page's OWN cross-reference to a namesake must be exempt the same way.
        namesake = re.compile(r"distinct person|same-name|namesake|a different (?:son|daughter|person|man|woman)", re.I)
        seen = {}
        for line in body.splitlines():
            if CORRECTION.search(line):
                continue
            for m in adj_finditer(line):
                b = int(m.group(1)); e = m.group(2)
                seen.setdefault((b, e), line.strip()[:180])
        for (b, e), line in seen.items():
            # The header's OWN lifespan is stated by BOTH ends. A match on one end only
            # is the defect SC1 exists to catch (Ernie: 1878-1953 header, 1877-1877 body),
            # so require both ends -- or the single end the header actually has.
            if by and dy:
                same = (b == by and e.isdigit() and int(e) == dy)
            elif by:
                same = (b == by)
            elif dy:
                same = (e.isdigit() and int(e) == dy)
            else:
                same = False
            if same:
                continue
            if attributes_elsewhere(line, b, e):
                continue                      # "(Spouse | Violet (1912–2004))": not ours
            if page_claims(fn, ln, b, e) or owns_span(b, e):
                continue                      # somebody's real page: correct, skip
            if namesake.search(line):
                continue                      # the line itself says: different person
            if CORRECTION.search(line):
                continue                      # the line records the OTHER value as an error
            if AUDIT_NOTE.search(line):
                continue                      # an audit note quoting the rejected value
            # An empty frontmatter lifespan is not a contradiction, it is a gap. The
            # body is allowed to know more than the header; filling it in is a job for
            # a human with a source, not for a linter to shout about.
            if not (by or dy):
                continue
            own = re.search(r"(1[5-9]\d\d|20[0-2]\d)", base)
            if own and int(own.group(1)) != b and not by:
                continue                      # filename itself disagrees; a rename, not this check
            if by and b != by and abs(b - by) > 2:
                continue                      # different generation, not our defect class
            # birth year EQUAL to the page's own -> same person by definition, so a
            # different death year is a contradiction (child-vs-adult death year, an
            # em-dash typo, a stale span). This is the Ernie-class defect.
            if by and b == by:
                pass                          # fall through to report
            findings.append(dict(code="SC1", sev="HIGH",
                                 msg=f"subject {fn} {ln} carries {b}–{e} vs frontmatter {by or '?'}–{dy or '?'} and no page owns {b}–{e}",
                                 line=line))
        # structural: does ANOTHER page's filename claim this page's own lifespan?
        if by and dy:
            owners = page_claims(fn, ln, by, dy)
            if owners > 1:
                findings.append(dict(code="SC7", sev="HIGH",
                                     msg=f"frontmatter {by}–{dy} is claimed by {owners} pages (duplicate person)",
                                     line=""))

    # SC2 age at death vs the page's OWN lifespan.
    #
    # A machine can only prove this on a line that ASSIGNS the age to the subject:
    #   * the subject is named on the line, AND
    #   * no other person's lifespan sits between the subject's name and the age, AND
    #   * the age is in whole years, not a unit ("aged 8 months").
    # Anything else is a relative's age on a shared line, a source register extract
    # ("TELFER, Susan - aged 80"), or a memorial's error already recorded on the page.
    if by and dy and subj_pat:
        for line in body.splitlines():
            if CORRECTION.search(line) or DISAGREE.search(line):
                continue
            if NOT_A_CLAIM.search(line):
                continue        # register extract / admission line / multi-person list
            if not subj_pat.search(line):
                # A vitals line ("**Died:** 3 Dec 1893, aged 0") names nobody but states
                # the SUBJECT's death by construction. Accept it only if it carries no
                # other person's lifespan and no other person's name.
                if not re.match(r"^\s*(?:[-*]\s*)?(?:\*\*)?\s*(?:Died|Death|Buried|Burial)\b",
                                line, re.I):
                    continue
                if [x for x in SPAN.finditer(line) if x.group(2).isdigit()]:
                    continue
                if OTHER_PERSON.search(line):
                    continue    # "Died ... aged 86. Buried ..." about a son, not the subject
                for a in re.finditer(r"\b(?:aged|age\s+of)\s+(\d{1,3})\b"
                                     r"(?!\s*(?:month|week|day|minute|hour|year))", line, re.I):
                    v = int(a.group(1))
                    if 1 <= v <= 115 and abs((dy - by) - v) > 1:
                        findings.append(dict(code="SC2", sev="MED",
                                             msg=f"'aged {v}' but own lifespan {by}–{dy} is {dy - by} years",
                                             line=line.strip()[:180]))
                continue
            for m in re.finditer(r"\b(?:aged|age\s+of)\s+(\d{1,3})\b"
                                 r"(?!\s*(?:month|week|day|minute|hour|year))", line, re.I):
                age = int(m.group(1))
                if age < 1 or age > 115:
                    continue
                pre = line[:m.start()]
                nm = subj_pat.search(pre)
                if not nm:
                    continue        # subject named after the age: not this age's owner
                spans = [x for x in SPAN.finditer(pre) if x.group(2).isdigit()]
                own = [x for x in spans if int(x.group(1)) == by and int(x.group(2)) == dy]
                if spans and not own:
                    continue        # another life intervenes (a child on the same row)
                other_names = re.findall(r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\b", pre[nm.end():])
                if other_names:
                    continue        # somebody else is named between: their age
                # A genealogy page often quotes a headstone or notice naming several
                # people in sequence ("JAMES TELFER ... aged 66. Also ELIZABETH BEATTIE
                # ... aged 88"). If another person's death/age statement sits between the
                # subject's name and this age, the age is theirs.
                between = pre[nm.end():]
                if re.search(r"\b(?:also|and|his\s+wife|her\s+husband|son|daughter|"
                             r"brother|sister|mother|father)\b", between, re.I):
                    continue
                # The age must be ATTRIBUTED to the subject by the words around it --
                # "... at Newcastleton aged 74", "**Died:** ... (aged 74)",
                # "died on 12 March 1909, aged 74". An "aged 18" inside a hospital
                # register line, or a headstone quote about a brother, is not a claim
                # about the subject's own lifespan and must not be scored as one.
                tail = line[m.end():m.end() + 40]
                if not re.match(r"\s*(?:\)|\]|,|;|\.|$|\s|years?\b|at\b|in\b)", tail, re.I):
                    continue
                if not re.search(r"\b(?:died|death|buried|burial|drowned|killed|deceased|"
                                 r"admitted|removed|transferred|age\s+at\s+death)\b",
                                 line, re.I):
                    continue        # no death/admission context: not a lifespan claim
                lived = dy - by
                # a page whose birth is stated as a RANGE ("about 1865-1869") cannot be
                # contradicted by an age that fits anywhere inside its own range.
                rng = re.search(r"(1[5-9]\d\d)\s*[–\u2013\u2014-]\s*(1[5-9]\d\d)", pre)
                if rng and int(rng.group(1)) <= by <= int(rng.group(2)):
                    by_lo = int(rng.group(1))
                else:
                    by_lo = by
                if abs((dy - by_lo) - age) > 1 and abs(lived - age) > 1:
                    findings.append(dict(code="SC2", sev="MED",
                                         msg=f"'aged {age}' but own lifespan {by}–{dy} is {lived} years",
                                         line=line.strip()[:180]))

    # SC3 parent died before child born
    for key in ("father", "mother"):
        val = fm.get(key, "")
        for m in re.finditer(r"\[?\[?([^\]\[\|(]+?)\s*\((\d{4})[–-](\d{4})\)", val):
            pname, pb, pd = m.group(1).strip(), int(m.group(2)), int(m.group(3))
            if by and pd and pd < by:
                findings.append(dict(code="SC3", sev="HIGH",
                                     msg=f"{key} {pname} died {pd}, subject born {by}"))

    # SC4 children reconcile
    # `children:` is a CURATED shortlist (often just the children who have their own
    # page), `relationships:` is the full list. So the only defect a machine can prove
    # is a name in `children:` that relationships does not know at all.
    def child_key(name):
        """Normalised identity of a child: name tokens, in order, with short words
        ('holly', 'telfer', 'stefanoff') all kept. A parenthetical is dropped only when
        it is a lifespan; a bracketed '(Telfer)' is part of the name, not a note."""
        s = re.sub(r"\([^)]*\d{4}[^)]*\)", " ", name)   # lifespan parens only
        s = re.sub(r"\([^)]*\)", " ", s)               # '(married Ben Stefanoff)' = a note
        s = s.replace("(", " ").replace(")", " ")
        return " ".join(w for w in re.split(r"[^a-z0-9]+", norm(s)) if w)

    def ck_set(names):
        out = set()
        for n in names:
            k = child_key(n)
            if k:
                out.add(k)
                toks = k.split()
                if toks:
                    out.add(toks[0] + " " + toks[-1])   # first+last only, the common short form
        return out

    fk = names_from(text, "children")
    rk = rel_children(fm)
    if fk and rk:
        fset = ck_set(fk)
        rset = ck_set(rk)
        # a name counts as known if its first two tokens appear in any relationships name
        rblob = " ".join(sorted(rset))
        only_f = []
        for n in fk:
            k = child_key(n)
            if k and k not in rset and k not in rblob:
                toks = k.split()
                if len(toks) >= 2 and (toks[0] + " " + toks[-1]) not in rblob:
                    only_f.append(k)
        if only_f:
            findings.append(dict(code="SC4", sev="HIGH",
                                 msg=f"children: names a child relationships does not: {only_f[:6]}"))

    # SC5 a MARRIAGE date for the SUBJECT that predates the subject's birth.
    if by and subj_pat:
        for line in body.splitlines():
            subj = subj_pat.search(line)
            if not subj or CORRECTION.search(line):
                continue
            # the marriage keyword must FOLLOW the subject's name -- "His daughter Jane
            # married Tom in 1925" is Jane's marriage, not the subject's; and the year
            # must sit after the keyword, never a number before it.
            for kw in re.finditer(r"(?:\bm\.|\bmarried)\b", line):
                if kw.start() < subj.start():
                    continue
                # "married Elizabeth Telfer (1836-1916)" -- a YEAR RANGE right after the
                # groom/bride name is that person's lifespan, not a marriage date. A bare
                # isolated year is a date. Skip any year that opens a range.
                seg = line[kw.end():]
                nm2 = None
                for cand in re.finditer(r"(\d{4})", seg):
                    after = seg[cand.end():cand.end() + 3]
                    if re.match(r"\s*[–\u2013\u2014-]", after):
                        continue        # opens a lifespan range
                    before = seg[:cand.start()].rstrip()
                    if re.search(r"\b(?:1[5-9]\d\d|20[0-2]\d)$", before):
                        continue        # closes a lifespan range
                    # THE KEY TEST. A marriage date sits on the keyword ("married 1890",
                    # "m. 23 Oct 1899", "married on 4 June 1929"): only connectors and a
                    # day-month between keyword and year. Once a NAME intervenes the year
                    # belongs to that person -- "married Clara Dunn (b. 1 Sep 1878)" is her
                    # birth, and "est. birth ... m. 16 Nov 1864" after a parent's name is
                    # the parent's marriage. Take the NEAREST qualifying year only.
                    gap = before[len(kw.group(0)) if False else 0:]
                    if re.search(r"[A-Za-z]{3,}", re.sub(
                            r"\b(?:on|the|of|and|at|in|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|"
                            r"January|February|March|April|June|July|August|September|October|November|December|"
                            r"married|marriage|m|b|born|circa|ca|about|abt|est)\b", " ", gap, flags=re.I)):
                        continue        # a name intervenes -> not the subject's date
                    nm2 = cand
                    break
                if not nm2:
                    continue
                m = nm2
                break
            else:
                m = None
            if m is not None:
                yr = int(m.group(1))
                if yr < by + 12:
                    findings.append(dict(code="SC5", sev="HIGH",
                                         msg=f"marriage {yr} vs own birth {by} (age {yr - by})",
                                         line=line.strip()[:180]))
                    break

    return base, findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-level", default="HIGH", choices=["HIGH", "MED", "NONE"])
    ap.add_argument("--code", default=None, help="only run one check, e.g. SC4")
    a = ap.parse_args()

    pages = find_pages(a.paths)
    allf = {}
    for p in pages:
        try:
            b, f = check(p)
        except Exception as e:  # never let one bad page stop the sweep
            b, f = os.path.basename(p), [dict(code="ERR", sev="MED", msg=str(e)[:120])]
        if a.code:
            f = [x for x in f if x.get("code") == a.code]
        if f:
            allf[b] = f

    if a.json:
        print(json.dumps(allf, indent=1, ensure_ascii=False))
    else:
        order = {"HIGH": 0, "MED": 1, "LOW": 2, "ERR": 1}
        for b, f in sorted(allf.items(), key=lambda kv: min(order.get(x["sev"], 3) for x in kv[1])):
            for x in f:
                print(f"{x['sev']:4} {x['code']} {b} :: {x['msg']}")

    counts = {}
    for f in allf.values():
        for x in f:
            counts[x["code"]] = counts.get(x["code"], 0) + 1
    total = sum(counts.values())
    print(f"\n{len(pages)} pages scanned | {len(allf)} flagged | {total} findings {counts}", file=sys.stderr)

    if a.fail_level == "NONE":
        return 0
    want = {"HIGH"} if a.fail_level == "HIGH" else {"HIGH", "MED"}
    return 1 if any(x["sev"] in want for f in allf.values() for x in f) else 0


if __name__ == "__main__":
    sys.exit(main())
