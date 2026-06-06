#!/usr/bin/env python3
"""
Fix Mark-perspective references in people.json to make the website
a general family website instead of Mark-centric.
"""
import json
import re
from copy import deepcopy

# Load the data
with open('/home/mark/telfer-wiki/src/data/people.json', 'r') as f:
    data = json.load(f)

# Track changes
changes = []

def replace_in_text(text, person_id=""):
    """Replace Mark-perspective phrases with neutral family-relative ones."""
    if not isinstance(text, str):
        return text
    
    original = text
    
    # ===== ROLE FIELD REPLACEMENTS =====
    # These are the short role descriptions
    
    # Direct role replacements (exact matches first)
    role_replacements = {
        # Cousins
        "Mark's cousin — daughter of Grantley Keith Telfer": "Cousin — daughter of Grantley Keith Telfer",
        "Mark's cousin — son of Grantley Keith Telfer": "Cousin — son of Grantley Keith Telfer",
        "Mark's cousin": "Cousin",
        "Mark's adopted cousin": "Adopted cousin",
        
        # Aunts/Uncles
        "Mark's uncle — eldest child of Murray & Shirley": "Uncle — eldest child of Murray & Shirley",
        "Mark's uncle — brother of Timothy Neil Telfer": "Uncle — brother of Timothy Neil Telfer",
        "Mark's aunts": "Aunts",
        "Mark's uncles": "Uncles",
        "Mark's aunt": "Aunt",
        
        # Step-siblings
        "Mark's step-brother (Sheryle's son, Mark's step-brother through Tim)": "Step-brother (Sheryle's son, step-brother through Tim Telfer)",
        "Mark's step-brother (Penny's son)": "Step-brother (Penny's son)",
        "Mark's step-brother": "Step-brother",
        "Mark's step-sister": "Step-sister",
        
        # Half-siblings
        "Mark's half-brother (Penny's son)": "Half-brother (Penny's son)",
        "Mark's half-brother": "Half-brother",
        
        # Direct ancestors
        "Mark's father": "Father",
        "Mark's biological mother": "Mother",
        "Mark's biological": "Biological",
        "Mark's paternal grandfather": "Grandfather (paternal)",
        "Mark's grandfather": "Grandfather",
        "Mark's great-grandfather": "Great-grandfather",
        "Mark's great-great-grandfather — son of the Scottish immigrant": "Great-great-grandfather — son of the Scottish immigrant",
        "Mark's great-great-grandfather": "Great-great-grandfather",
        "Mark's great-grandmother": "Great-grandmother",
        "Mark's great-great-grandmother — English immigrant": "Great-great-grandmother — English immigrant",
        "Mark's great-great-grandmother": "Great-great-grandmother",
        
        # Wife
        "Mark's wife, mother of Levi & Zabella": "Wife of Mark Telfer, mother of Levi & Zabella",
        "Mark's wife": "Wife",
        
        # Children
        "Mark's eldest son": "Eldest son of Mark Telfer",
        "Mark's eldest": "Eldest child",
        
        # Patriarch
        "Patriarch of the Telfer family — Mark's paternal grandfather": "Patriarch of the Telfer family — Paternal grandfather of Mark Telfer",
    }
    
    for old, new in role_replacements.items():
        if old in text:
            text = text.replace(old, new)
    
    # ===== LIFE SUMMARY / BODY MARKDOWN REPLACEMENTS =====
    # These are sentence-level replacements
    
    # "making her/him Mark's X" -> "making her/him a cousin of Mark Telfer" or similar
    text = re.sub(r"making her Mark's cousin", "making her a cousin of Mark Telfer", text)
    text = re.sub(r"making him Mark's cousin", "making him a cousin of Mark Telfer", text)
    text = re.sub(r"making her Mark's adopted cousin", "making her an adopted cousin of Mark Telfer", text)
    text = re.sub(r"making her Mark's step-sister", "making her a step-sister of Mark Telfer", text)
    text = re.sub(r"making him Mark's step-brother", "making him a step-brother of Mark Telfer", text)
    
    # "X is Mark's Y" -> "X is the Y of Mark Telfer" or "X is Mark Telfer's Y"
    text = re.sub(r"is Mark's cousin", "is a cousin of Mark Telfer", text)
    text = re.sub(r"is Mark's uncle", "is an uncle of Mark Telfer", text)
    text = re.sub(r"is Mark's aunt", "is an aunt of Mark Telfer", text)
    text = re.sub(r"is Mark's step-brother", "is a step-brother of Mark Telfer", text)
    text = re.sub(r"is Mark's step-sister", "is a step-sister of Mark Telfer", text)
    text = re.sub(r"is Mark's half-brother", "is a half-brother of Mark Telfer", text)
    text = re.sub(r"is Mark's sister", "is a sister of Mark Telfer", text)
    text = re.sub(r"is Mark's wife", "is the wife of Mark Telfer", text)
    text = re.sub(r"is Mark's eldest son", "is the eldest son of Mark Telfer", text)
    
    # "Mark's X" in narrative context
    text = re.sub(r"Mark's cousin\b", "a cousin of Mark Telfer", text)
    text = re.sub(r"Mark's uncle\b", "an uncle of Mark Telfer", text)
    text = re.sub(r"Mark's aunt\b", "an aunt of Mark Telfer", text)
    text = re.sub(r"Mark's step-brother\b", "a step-brother of Mark Telfer", text)
    text = re.sub(r"Mark's step-sister\b", "a step-sister of Mark Telfer", text)
    text = re.sub(r"Mark's half-brother\b", "a half-brother of Mark Telfer", text)
    text = re.sub(r"Mark's sister\b", "a sister of Mark Telfer", text)
    text = re.sub(r"Mark's wife\b", "the wife of Mark Telfer", text)
    text = re.sub(r"Mark's eldest son\b", "the eldest son of Mark Telfer", text)
    text = re.sub(r"Mark's father\b", "the father of Mark Telfer", text)
    text = re.sub(r"Mark's biological mother\b", "the biological mother of Mark Telfer", text)
    text = re.sub(r"Mark's grandfather\b", "the grandfather of Mark Telfer", text)
    text = re.sub(r"Mark's great-grandfather\b", "the great-grandfather of Mark Telfer", text)
    text = re.sub(r"Mark's great-great-grandfather\b", "the great-great-grandfather of Mark Telfer", text)
    text = re.sub(r"Mark's great-grandmother\b", "the great-grandmother of Mark Telfer", text)
    text = re.sub(r"Mark's great-great-grandmother\b", "the great-great-grandmother of Mark Telfer", text)
    text = re.sub(r"Mark's paternal grandfather\b", "the paternal grandfather of Mark Telfer", text)
    
    # Special case: "Mark's cousin" in "making her Mark's cousin" already handled above
    # Also handle "Mark's adopted cousin" 
    text = re.sub(r"Mark's adopted cousin\b", "an adopted cousin of Mark Telfer", text)
    
    # In Family tables / Life Summaries: "Grandson: [[Mark Telfer...]]" - these are fine as-is
    # but "Great-great-grandson: [[Mark Telfer...]]" are also fine
    
    return text


# Process each person
for person in data:
    pid = person.get('id', '')
    slug = person.get('slug', '')
    modified = False
    
    # Fix roles array
    if 'roles' in person and person['roles']:
        new_roles = []
        for role in person['roles']:
            new_role = replace_in_text(role, pid)
            if new_role != role:
                changes.append(f"{pid} ({slug}): role: '{role}' -> '{new_role}'")
                modified = True
            new_roles.append(new_role)
        person['roles'] = new_roles
    
    # Fix body_markdown
    if 'body_markdown' in person and person['body_markdown']:
        new_body = replace_in_text(person['body_markdown'], pid)
        if new_body != person['body_markdown']:
            changes.append(f"{pid} ({slug}): body_markdown modified")
            modified = True
        person['body_markdown'] = new_body
    
    # Fix body_stripped
    if 'body_stripped' in person and person['body_stripped']:
        new_stripped = replace_in_text(person['body_stripped'], pid)
        if new_stripped != person['body_stripped']:
            changes.append(f"{pid} ({slug}): body_stripped modified")
            modified = True
        person['body_stripped'] = new_stripped

# ===== SAVE THE FIXED DATA =====
output_path = '/home/mark/telfer-wiki/src/data/people.json'
with open(output_path, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Fixed {len(changes)} occurrences across {len(data)} people")
for change in changes:
    print(f"  - {change}")

print(f"\nWritten to {output_path}")