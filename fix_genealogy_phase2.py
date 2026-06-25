#!/usr/bin/env python3
"""
Genealogy Data Fix Script — Phase 2
Fixes additional confirmed data errors found during Phase 2 investigation.
"""
import sys
sys.path.insert(0, '/home/mark/ObsidianVault/Family History/People')
import os
import re

VAULT = '/home/mark/ObsidianVault/Family History/People'
LOG = '/home/mark/ObsidianVault/Family History/Corrections Log.md'
TODAY = '25 June 2026'
log_entries = []

def read_file(path):
    with open(path, 'r') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)
    print(f"  ✅ Wrote {path}")

def patch_yaml(person, old_string, new_string, reason, evidence="", source=""):
    path = os.path.join(VAULT, person)
    content = read_file(path)
    if old_string in content:
        write_file(path, content.replace(old_string, new_string))
        log_entries.append({
            'person': person.replace('.md', ''),
            'what': reason,
            'evidence': evidence,
            'source': source,
            'changes': f"Replaced `{old_string.strip()[:60]}...` with `{new_string.strip()[:60]}...`"
        })
        print(f"  🔧 Fixed: {reason}")
    else:
        print(f"  ⚠️ COULD NOT FIND in {person}: {old_string[:60]}...")

# ========== FIX 5: Jean Telfer (1840–1892) — Add children to relationships ==========
person = 'Jean Telfer (1840–1892).md'
old = "relationships: 'Self: Jean Telfer   |   Father: Francis Telfer (1809–1895)   |   Mother: Jean Murray (1810–1839)   |   Step-mother: Dinah Flavel (1824–1895)   | Spouse: Richard Paynter (1838–1869), Frederick Parker (1844–1928)'"
new = "relationships: 'Self: Jean Telfer | Father: Francis Telfer (1809–1895) | Mother: Jean Murray (1810–1839) | Step-mother: Dinah Flavel (1821–1844) | Spouse: Richard Paynter (1838–1869), Frederick Parker (1844–1928) | Children: Thomas Paynter (1859–1946), Mary Jane Paynter (1861–1945), Francis Telfer Paynter (1862–?), Elizabeth Paynter (1864–?), Dinah Flavel Paynter (1869–?), Margaret Eliza Parker (1872–1938), Frederick George Parker (1874–1946), Annie Parker (1875–1895), Martha Parker (1878–?), Joanna Wittita Cordley Parker (1880–?), Ethel May Parker (1881–?)'"
patch_yaml(person, old, new,
    reason="Jean Telfer (1840–1892) relationships field missing all children",
    evidence="Body text lists 11 children (Francis Telfer Paynter at line 79). None were in YAML relationships.",
    source="Internal vault body text — children of Richard Paynter and Frederick Parker with Jean Telfer")

# Also fix the step-mother's birth year (was 1824, should be 1821)
# Note: the step-mother year fix is folded into the above patch

# ========== FIX 6: Ernest John Telfer (1877–1953) — Remove mother from spouse list ==========
person = 'Ernest John Telfer (1877–1953).md'
old = "relationships: 'Self: Ernest John Telfer                      |                      Mother: Caroline Amelia Telfer (née Masters)                      |                      Father: John Telfer (1847–1929)                      |                      Siblings: Francis Charles Telfer, William James Telfer, Albert George Telfer, Walter William Telfer, Edwin Gilbert Telfer                     |    Children: Alan Dale Telfer (1890–1937), Angela Telfer, Bertha Telfer, Clara Blanche Telfer (1883–1974), Colin Roy Telfer (1889–1964), Douglas Telfer (1887–1956), Elizabeth Telfer (1868–1950), Isabella Lucieton Telfer (1880–1964), John Ernest Telfer (1877–1877), John Roland Telfer (1882–1975), Maria Clara Telfer (1878–1903), Marian Telfer Cornish (1896–1977), Martha Telfer (1873–?), Martha Telfer Cameron (1873–1964), Peter Telfer, Robert Freddy Telfer (1886–1949), Susan Telfer (1871–1952), William Telfer (1880–1880)   | Spouse: Ann Taylor (~1856–?), Caroline Masters (~1850–1929), Martha Henstridge (~1854–1921)'"
new = "relationships: 'Self: Ernest John Telfer | Mother: Caroline Amelia Telfer (née Masters) | Father: John Telfer (1847–1929) | Siblings: Francis Charles Telfer, William James Telfer, Albert George Telfer, Walter William Telfer, Edwin Gilbert Telfer | Children: Alan Dale Telfer (1890–1937), Angela Telfer, Bertha Telfer, Clara Blanche Telfer (1883–1974), Colin Roy Telfer (1889–1964), Douglas Telfer (1887–1956), Elizabeth Telfer (1868–1950), Isabella Lucieton Telfer (1880–1964), John Ernest Telfer (1877–1877), John Roland Telfer (1882–1975), Maria Clara Telfer (1878–1903), Marian Telfer Cornish (1896–1977), Martha Telfer (1873–?), Martha Telfer Cameron (1873–1964), Peter Telfer, Robert Freddy Telfer (1886–1949), Susan Telfer (1871–1952), William Telfer (1880–1880) | Spouse: Ann Taylor (~1856–?), Martha Henstridge (~1854–1921)'"
patch_yaml(person, old, new,
    reason="Ernest John Telfer (1877–1953) listed his mother Caroline Masters (~1850–1929) as 'Spouse' instead of 'Mother'",
    evidence="Body text says 'Son of John Telfer and Caroline Amelia Masters'. Caroline was his mother, not his wife.",
    source="Internal vault body text comparison — Caroline Masters was mother (married to John Telfer)")

# ========== FIX 7: Ethel Jean Telfer (1915–living) — Remove impossible spouses ==========
person = 'Ethel Jean Telfer (1915–living).md'
old = "relationships: 'Self: Ethel Jean Telfer   |   Mother: Amy Ellen Telfer (1884–1951)   |   Father: Francis Charles Telfer (1875–1954)   | Spouse: Mr McMurtrie, Frederick Parker (~1838–1928), Richard Paynter (1838–1869) |   Siblings: Francis Kelson Telfer (1910–1987), Clarice May Telfer (1911–1997), Emily Amelia Telfer (1913–living), Gladys Merle Telfer (1917–living), Doris Elma Telfer (1919–living), Edwin Roy Telfer (1921–2009), Reginald Masters Telfer (1923–living), Murray John Telfer (1924–2009), Ruth Telfer (1930–?)'"
new = "relationships: 'Self: Ethel Jean Telfer | Mother: Amy Ellen Telfer (1884–1951) | Father: Francis Charles Telfer (1875–1954) | Spouse: Mr McMurtrie | Siblings: Francis Kelson Telfer (1910–1987), Clarice May Telfer (1911–1997), Emily Amelia Telfer (1913–living), Gladys Merle Telfer (1917–living), Doris Elma Telfer (1919–living), Edwin Roy Telfer (1921–2009), Reginald Masters Telfer (1923–living), Murray John Telfer (1924–2009), Ruth Telfer (1930–?)'"
patch_yaml(person, old, new,
    reason="Ethel Jean Telfer (1915–living) listed Richard Paynter (d. 1869) and Frederick Parker (d. 1928) as spouses — impossible given Ethel was born ~1915",
    evidence="Richard Paynter died 1869 (46 years before Ethel's birth). Frederick Parker died 1928 (Ethel was 13). Both dates predate or barely overlap Ethel's adult life. These were likely copy-paste errors from her grandmother Jean Telfer's file.",
    source="Date analysis — cross-reference with Richard Paynter (1838–1869) and Frederick Parker (1844–1928) files")

# ========== Log everything ==========
if log_entries:
    log_content = ""
    if os.path.exists(LOG):
        log_content = read_file(LOG)
    
    for entry in log_entries:
        fix_entry = f"""
### Fix: {TODAY} — {entry['person']}
- **What was wrong:** {entry['what']}
- **Evidence:** {entry['evidence']}
- **Source:** {entry['source']}
- **Changes made:** {entry['changes']}
- **Confidence:** High (source: vault cross-reference)
"""
        log_content += fix_entry
    
    write_file(LOG, log_content)
    print(f"\n✅ Logged {len(log_entries)} fixes to Corrections Log")
else:
    print("\nNo fixes to log")

# ========== Verify ==========
print("\n=== Verifying fixes ===")
for entry in log_entries:
    person = entry['person'] + '.md'
    path = os.path.join(VAULT, person)
    if os.path.exists(path):
        content = read_file(path)
        print(f"\n📄 {person}: {len(content)} chars")
        # Extract relationships line
        for line in content.split('\n'):
            if line.strip().startswith('relationships:'):
                print(f"  → {line[:120]}...")
                break
    else:
        print(f"\n❌ {person}: FILE NOT FOUND")
