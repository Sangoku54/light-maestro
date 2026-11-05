import json
with open('C:/Users/vitte/.openclaw-autoclaw/agents/mon-codeur/workspace/light-maestro/LM/concert.lmproj') as f:
    data = json.load(f)
fixtures = data.get('patchedFixtures', [])
positions = data.get('fixturePositions', {})
for f in fixtures:
    if f['id'] in ['11', '12', '17', '18', '29', '30', '35', '36']:
        pos = positions.get(f['id'], 'NO POS')
        print(f"{f['id']}: name={f['name']}, pos={pos}")