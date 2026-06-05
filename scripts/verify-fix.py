import json, re

with open('src/data/people.json') as f:
    data = json.load(f)

print(f"Profiles: {len(data)}")

bad_facebook = 0
blank_field = 0
redacted_text = 0

for p in data:
    name = p.get('display_name','') or f"{p.get('first_name','')} {p.get('last_name','')}"
    body = p.get('body_markdown','') or ''
    
    if re.search(r'\[Facebook profile[ —]*redacted\]', body, re.IGNORECASE):
        redacted_text += 1
        print(f"  ❌ {name}: has [Facebook profile — redacted] text")
        
    # Check for blank Facebook: label
    if re.search(r'(?:Facebook|Profile URL|TikTok|Instagram|LinkedIn)\s*:\s*\[', body, re.IGNORECASE) or \
       re.search(r'(?:Facebook|Profile URL|TikTok|Instagram|LinkedIn)\s*:\s*(?:https?:)?\s*$', body, re.IGNORECASE):
        blank_field += 1
        print(f"  ⚠️  {name}: has blank Facebook field")

if redacted_text == 0 and blank_field == 0:
    print("✅ ALL CLEAN — no broken Facebook links or blank fields")
else:
    print(f"\n❌ {redacted_text} with redacted text, {blank_field} with blank fields")
    exit(1)
