import re, os, sys, glob

VAULT_PEOPLE = os.path.expanduser("~/ObsidianVault/Family History/People")

# Expanded relationship noun set (see references/data-quality-guardrails.md — 25 Jul 2026 session)
NOUNS = (
    r"(?:adopted\s+|eldest\s+|biological\s+|paternal\s+|maternal\s+|youngest\s+)*"
    r"(?:uncle|aunt|cousin|father|mother|son|daughter|wife|husband|brother|sister|"
    r"nephew|niece|grandfather|grandmother|great-grandfather|great-grandmother|"
    r"great-great-grandfather|great-great-grandmother|half-brother|half-sister|"
    r"step-brother|step-sister)"
)
PATTERNS = [
    re.compile(r"\bmark'?s\s+" + NOUNS + r"\b", re.I),
    re.compile(r"making\s+(?:him|her|them)\s+mark'?s\s+" + NOUNS + r"\b", re.I),
    re.compile(r"\b(?:one|two|three)\s+of\s+mark'?s\s+" + NOUNS + r"s?\b", re.I),
]

hits = {}
for path in sorted(glob.glob(os.path.join(VAULT_PEOPLE, "*.md"))):
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        continue
    found = []
    for i, line in enumerate(text.splitlines(), 1):
        for pat in PATTERNS:
            for m in pat.finditer(line):
                found.append((i, m.group(0)))
    if found:
        hits[os.path.basename(path)] = found

print(f"VAULT-LEVEL no-mark-refs scan — {VAULT_PEOPLE}")
print(f"Files with hits: {len(hits)}")
for fn, found in hits.items():
    print(f"  {fn}  ({len(found)} hit(s))")
    for ln, txt in found[:4]:
        print(f"      line {ln}: {txt}")
print()
if hits:
    total = sum(len(v) for v in hits.values())
    print(f"FAIL: {total} forbidden 'Mark's <relation>' ref(s) in {len(hits)} vault source file(s).")
    print("These WILL be republished into people.json / people.public.json by the next regenerate.")
    print("Fix the VAULT .md files (never the generated JSON), then re-run regenerate + this scan.")
    sys.exit(1)
print("PASS: no forbidden vault-level Mark references.")
sys.exit(0)
