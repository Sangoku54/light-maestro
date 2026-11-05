import asyncio
import sys
sys.path.insert(0, 'C:/Users/vitte/.openclaw-autoclaw/agents/mon-codeur/workspace/light-maestro')

from electron.project_envelope import unpackProject

async def main():
    packed = await unpackProject('C:/Users/vitte/.openclaw-autoclaw/agents/mon-codeur/workspace/light-maestro/LM/concert.lmproj')
    import json
    proj = json.loads(packed.content)
    
    fixtures = proj.get('showStore', {}).get('patchedFixtures', [])
    positions = proj.get('showStore', {}).get('fixturePositions', {})
    
    for f in fixtures:
        if f['id'] in ['11', '12', '17', '18', '29', '30', '35', '36']:
            pos = positions.get(f['id'], 'NO POS')
            print(f"{f['id']}: name={f['name']}, x={pos.get('x')}, y={pos.get('y')}, h={pos.get('h')}, heading={pos.get('heading')}")

if __name__ == '__main__':
    import asyncio
    asyncio.run(main())