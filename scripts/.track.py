import json,subprocess,sys
def spouses():
    d=json.load(open('src/data/people.json'))
    for p in d:
        if p.get('slug')=='joseph-farrow-1814': return p.get('spouses')
    return None
print("START spouses:",spouses())
