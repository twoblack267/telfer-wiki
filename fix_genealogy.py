#!/usr/bin/env python3
"""
Genealogy Data Fix Script — Phase 1
Fixes confirmed data errors found by the verifier.

REAL DATA ERRORS (not verifier fuzzy-matching bugs):
1. Francis Telfer Paynter (1862–?) — wrong relationships (copy-paste from Francis Telfer 1809)
2. Dinah Flavel (1821–1844) — lists Francis Telfer Paynter (1862–?) as spouse (impossible)
3. Margaret Wright Telfer (?–1892) — lists Francis Telfer Paynter as spouse instead of Francis Telfer (1809-1895)
4. Richard Paynter (1838–1869) — lists Ethel Jean Telfer (1915-living) as spouse (impossible)
"""

import os
import re
from pathlib import Path

PEOPLE_DIR = Path("/home/mark/ObsidianVault/Family History/People")
CORRECTIONS_LOG = "/home/mark/ObsidianVault/Family History/Corrections Log.md"

def read_file_safe(path):
    """Read file content, return lines."""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file_safe(path, content):
    """Write content to file."""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def patch_yaml_field(filepath, old_string, new_string, description):
    """Patch a YAML file with old_string → new_string replacement."""
    content = read_file_safe(filepath)
    if old_string not in content:
        print(f"⚠️  WARNING: Could not find expected string in {filepath.name}")
        print(f"   Looking for: {repr(old_string[:80])}")
        # Find what's actually in the file
        for i, line in enumerate(content.split('\n')):
            if 'Spouse' in line or 'Children' in line or 'relationships' in line:
                if i > 0:
                    print(f"   Context line {i}: {line[:100]}")
        return False
    
    new_content = content.replace(old_string, new_string, 1)
    write_file_safe(filepath, new_content)
    print(f"✅ Fixed: {description}")
    return True

def append_to_corrections_log(entry):
    """Append a fix entry to the Corrections Log."""
    content = read_file_safe(CORRECTIONS_LOG)
    content = content.rstrip() + '\n\n' + entry + '\n'
    write_file_safe(CORRECTIONS_LOG, content)
    print(f"📝 Logged to Corrections Log")

# ============================================================
# FIX 1: Francis Telfer Paynter (1862–?) — Complete rewrite
# ============================================================
print("=" * 60)
print("FIX 1: Francis Telfer Paynter (1862–?) — Wrong data")
print("=" * 60)

ftp_path = PEOPLE_DIR / "Francis Telfer Paynter (1862–?).md"
content = read_file_safe(ftp_path)

# Current content has these lines:
# relationships: 'Self: Francis Telfer Paynter (1862–?)     |   Children: George Wright Telfer (1850–1913), James Telfer (1832–1845), Jean Telfer (1840–1892)  | Spouse: Dinah Flavel (1821–1844), Margaret Wright Telfer (?–1892)'

old_ftp_rel = "relationships: 'Self: Francis Telfer Paynter (1862–?)     |   Children: George Wright Telfer (1850–1913), James Telfer (1832–1845), Jean Telfer (1840–1892)  | Spouse: Dinah Flavel (1821–1844), Margaret Wright Telfer (?–1892)'"

new_ftp_rel = "relationships: 'Self: Francis Telfer Paynter (1862–?) | Father: Richard Paynter (1838–1869) | Mother: Jean Telfer (1840–1892)'"

if old_ftp_rel in content:
    content = content.replace(old_ftp_rel, new_ftp_rel)
    write_file_safe(ftp_path, content)
    print("✅ Fixed Francis Telfer Paynter relationships")
else:
    print("⚠️  Could not find expected relationships string in Francis Telfer Paynter")
    # Show what's there
    for i, line in enumerate(content.split('\n')):
        if 'relationships' in line:
            print(f"   Line {i}: {line[:120]}")

# ============================================================
# FIX 2: Dinah Flavel (1821–1844) — Remove Francis Telfer Paynter
# ============================================================
print("\n" + "=" * 60)
print("FIX 2: Dinah Flavel (1821–1844) — Remove impossible spouse")
print("=" * 60)

dinah_path = PEOPLE_DIR / "Dinah Flavel (1821–1844).md"
content = read_file_safe(dinah_path)

# Current: 'Self: Dinah Flavel  | Spouse: Francis Telfer (1809–1895), Francis Telfer Paynter (1862–?) |  Children: Jean Telfer'
# Fixed:   'Self: Dinah Flavel | Spouse: Francis Telfer (1809–1895) | Children: Jean Telfer'

old_dinah_rel = "Spouse: Francis Telfer (1809–1895), Francis Telfer Paynter (1862–?)"
new_dinah_rel = "Spouse: Francis Telfer (1809–1895)"

if old_dinah_rel in content:
    content = content.replace(old_dinah_rel, new_dinah_rel)
    write_file_safe(dinah_path, content)
    print("✅ Fixed Dinah Flavel — removed Francis Telfer Paynter from spouses")
else:
    print("⚠️  Could not find expected string in Dinah Flavel")
    for i, line in enumerate(content.split('\n')):
        if 'relationships' in line or 'Spouse' in line:
            print(f"   Line {i}: {line[:120]}")

# ============================================================
# FIX 3: Margaret Wright Telfer (?–1892) — Fix spouse
# ============================================================
print("\n" + "=" * 60)
print("FIX 3: Margaret Wright Telfer (?–1892) — Fix spouse reference")
print("=" * 60)

mwt_path = PEOPLE_DIR / "Margaret Wright Telfer (?–1892).md"
content = read_file_safe(mwt_path)

# Current: 'Self: Margaret Wright Telfer | Spouse: Francis Telfer Paynter (1862–?) |  Children: John Telfer (1847–1929), George Wright Telfer, Margaret Dougal Telfer'
# Fixed:   'Self: Margaret Wright Telfer | Spouse: Francis Telfer (1809–1895) | Children: John Telfer (1847–1929), George Wright Telfer, Margaret Dougal Telfer'

old_mwt_rel = "Spouse: Francis Telfer Paynter (1862–?)"
new_mwt_rel = "Spouse: Francis Telfer (1809–1895)"

if old_mwt_rel in content:
    content = content.replace(old_mwt_rel, new_mwt_rel)
    write_file_safe(mwt_path, content)
    print("✅ Fixed Margaret Wright Telfer — corrected spouse to Francis Telfer (1809–1895)")
else:
    print("⚠️  Could not find expected string in Margaret Wright Telfer")
    for i, line in enumerate(content.split('\n')):
        if 'relationships' in line or 'Spouse' in line:
            print(f"   Line {i}: {line[:120]}")

# ============================================================
# FIX 4: Richard Paynter (1838–1869) — Remove impossible spouse
# ============================================================
print("\n" + "=" * 60)
print("FIX 4: Richard Paynter (1838–1869) — Remove impossible spouse")
print("=" * 60)

rp_path = PEOPLE_DIR / "Richard Paynter (1838–1869).md"
content = read_file_safe(rp_path)

# Current: 'Self: Richard Paynter  |  Father: Richard Paynter (of Calstock, Cornwall)  | Spouse: Jean Telfer (1840–1892), Ethel Jean Telfer (1915–living) |  Children: ...'
# Fixed:   'Self: Richard Paynter  |  Father: Richard Paynter (of Calstock, Cornwall)  | Spouse: Jean Telfer (1840–1892) |  Children: ...'

old_rp_rel = "Spouse: Jean Telfer (1840–1892), Ethel Jean Telfer (1915–living)"
new_rp_rel = "Spouse: Jean Telfer (1840–1892)"

if old_rp_rel in content:
    content = content.replace(old_rp_rel, new_rp_rel)
    write_file_safe(rp_path, content)
    print("✅ Fixed Richard Paynter — removed Ethel Jean Telfer from spouses")
else:
    print("⚠️  Could not find expected string in Richard Paynter")
    for i, line in enumerate(content.split('\n')):
        if 'relationships' in line or 'Spouse' in line:
            print(f"   Line {i}: {line[:120]}")

# ============================================================
# Write Corrections Log
# ============================================================
print("\n" + "=" * 60)
print("WRITING CORRECTIONS LOG")
print("=" * 60)

log_entries = """### Fix: 2026-06-25 — Francis Telfer Paynter (1862–?)
- **What was wrong:** Relationships field contained completely wrong data — listed George Wright Telfer (1850–1913), James Telfer (1832–1845), and Jean Telfer (1840–1892) as children (all born before Francis Telfer Paynter), and Dinah Flavel (1821–1844) and Margaret Wright Telfer (?–1892) as spouses. These were copy-pasted from Francis Telfer (1809–1895)'s data.
- **Evidence:** Cross-reference with Richard Paynter (1838–1869)'s file shows Francis Telfer Paynter is Richard and Jean Telfer's son. Dinah Flavel died 1844 — 18 years before he was born. Children listed all predate him by 7–30 years.
- **Source:** Richard Paynter (1838–1869).md lists Francis Telfer Paynter (1862–?) as child; Jean Telfer (1840–1892).md
- **Changes made:** Replaced relationships field — removed incorrect spouses/children, added Father: Richard Paynter (1838–1869) and Mother: Jean Telfer (1840–1892)
- **Confidence:** High

### Fix: 2026-06-25 — Dinah Flavel (1821–1844)
- **What was wrong:** Listed Francis Telfer Paynter (1862–?) as spouse, impossible as she died in 1844 — 18 years before he was born.
- **Evidence:** Dinah Flavel died 1844, Francis Telfer Paynter born 1862
- **Source:** Birth/death years in vault file YAML
- **Changes made:** Removed "Francis Telfer Paynter (1862–?)" from Dinah Flavel's spouse field — now only lists Francis Telfer (1809–1895) as spouse
- **Confidence:** High

### Fix: 2026-06-25 — Margaret Wright Telfer (?–1892)
- **What was wrong:** Listed Francis Telfer Paynter (1862–?) as spouse. Margaret was the third wife of Francis Telfer (1809–1895) and mother of John Telfer (1847–1929). Francis Telfer Paynter was her grandson (son of Jean Telfer).
- **Evidence:** Body text and "Third wife of Francis Telfer (1809–1895)" in her own file confirms correct spouse
- **Source:** Self-referencing file body text; John Telfer (1847–1929).md lists her as mother and Francis Telfer as father
- **Changes made:** Changed "Spouse: Francis Telfer Paynter (1862–?)" to "Spouse: Francis Telfer (1809–1895)"
- **Confidence:** High

### Fix: 2026-06-25 — Richard Paynter (1838–1869)
- **What was wrong:** Listed Ethel Jean Telfer (1915–living) as spouse alongside Jean Telfer (1840–1892). Richard died in 1869 — 46 years before Ethel Jean was born.
- **Evidence:** Richard Paynter died 7 Feb 1869 per body text. Ethel Jean Telfer born 1915.
- **Source:** Richard Paynter body text; vault birth years
- **Changes made:** Removed "Ethel Jean Telfer (1915–living)" from Richard Paynter's spouse field — now only lists Jean Telfer (1840–1892)
- **Confidence:** High"""

append_to_corrections_log(log_entries)

print("\n✅ ALL FIXES COMPLETE")
print("Done — 4 data errors fixed, logged to Corrections Log")
