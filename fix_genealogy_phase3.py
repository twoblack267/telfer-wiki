#!/usr/bin/env python3
"""
Genealogy Data Fix Script — Phase 3
Fixes remaining 4 actionable issues.
"""
import os

VAULT = '/home/mark/ObsidianVault/Family History/People'
LOG = '/home/mark/ObsidianVault/Family History/Corrections Log.md'
TODAY = '25 June 2026'

def read_file(path):
    with open(path, 'r') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)
    print(f"  ✅ Wrote {path}")

def fix_person(filename, old, new, reason, evidence, source):
    path = os.path.join(VAULT, filename)
    content = read_file(path)
    if old in content:
        write_file(path, content.replace(old, new))
        print(f"  🔧 Fixed {filename}: {reason}")
        return {'person': filename.replace('.md',''), 'what': reason, 'evidence': evidence, 'source': source, 'changes': f"String replaced in {filename}"}
    else:
        print(f"  ⚠️ Could not find pattern in {filename}")
        return None

log_entries = []

# FIX A: Frederick Parker — remove Ethel Jean Telfer from spouse list
e = fix_person(
    'Frederick Parker (~1838–1928).md',
    "relationships: 'Self: Frederick Parker  |  Father: George Parker  | Spouse: Jean Telfer (1840–1892), Ethel Jean Telfer (1915–living)'",
    "relationships: 'Self: Frederick Parker | Father: George Parker | Spouse: Jean Telfer (1840–1892)'",
    "Frederick Parker (~1838–1928) listed Ethel Jean Telfer (1915–living) as spouse — she was born ~1915, he died 1928, and she was his step-granddaughter.",
    "Frederick Parker died 1928. Ethel Jean Telfer born ~1915, was his step-granddaughter (granddaughter of Jean Telfer and Frederick Parker via Francis Charles Telfer). Their age gap (77 vs 13 at marriage?) and relation make this impossible.",
    "Cross-reference: Francis Charles Telfer (1875–1954) is Frederick's step-son and Ethel's father. Ethel is Frederick's step-granddaughter."
)
if e: log_entries.append(e)

# FIX B: Margaret Wright stub — remove Francis Telfer Paynter from spouse list
e = fix_person(
    'Margaret Wright.md',
    "relationships: 'Self: Margaret Wright     |   Children: George Wright Telfer (1850–1913), John Telfer (1847–1929), Margaret Dougal Telfer (1849–1936)  | Spouse: Francis Telfer (1809–1895), Francis Telfer Paynter (1862–?)'",
    "relationships: 'Self: Margaret Wright | Children: George Wright Telfer (1850–1913), John Telfer (1847–1929), Margaret Dougal Telfer (1849–1936) | Spouse: Francis Telfer (1809–1895)'",
    "Margaret Wright stub listed Francis Telfer Paynter (1862–?) as spouse — impossible. Margaret Wright (born ~1807) was his grandmother, not his wife.",
    "Margaret Wright (1807–1892) was the third wife of Francis Telfer (1809–1895). Francis Telfer Paynter (1862–?) was her grandson (son of Jean Telfer).",
    "Cross-reference: John Telfer (1847–1929) lists Margaret Wright Telfer as mother and Francis Telfer (1809–1895) as father."
)
if e: log_entries.append(e)

# FIX C: Francis Telfer (1809–1895) — update Margaret Wright reference to use canonical vault name
e = fix_person(
    'Francis Telfer (1809–1895).md',
    "Spouse: Jean Murray (1810–1839), Dinah Flavel (1821–1844), Margaret Wright (?–1892)",
    "Spouse: Jean Murray (1810–1839), Dinah Flavel (1821–1844), Margaret Wright Telfer (?–1892)",
    "Francis Telfer (1809–1895) referenced 'Margaret Wright (?–1892)' but the vault file is 'Margaret Wright Telfer (?–1892).md'. Updated to match canonical filename.",
    "Vault has two Margaret Wright files: 'Margaret Wright.md' (stub with children) and 'Margaret Wright Telfer (?–1892).md' (full bio, same person). Francis Telfer was married to the full-featured one.",
    "Internal vault file comparison — 'Margaret Wright Telfer (?–1892).md' has body text confirming 'third wife of Francis Telfer (1809–1895)'"
)
if e: log_entries.append(e)

# Append to corrections log
if log_entries:
    log_content = read_file(LOG)
    for entry in log_entries:
        log_content += f"""
### Fix: {TODAY} — {entry['person']}
- **What was wrong:** {entry['what']}
- **Evidence:** {entry['evidence']}
- **Source:** {entry['source']}
- **Changes made:** {entry['changes']}
- **Confidence:** High
"""
    write_file(LOG, log_content)
    print(f"\n✅ Logged {len(log_entries)} fixes to Corrections Log")
else:
    print("\nNo fixes to log")

print("\nDone!")
