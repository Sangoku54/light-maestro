const { unpackProject } = require('./electron/project-envelope.js');

async function main() {
    const packed = await unpackProject('C:/Users/vitte/.openclaw-autoclaw/agents/mon-codeur/workspace/light-maestro/LM/concert.lmproj');
    const proj = JSON.parse(packed.content);
    
    const fixtures = proj.showStore?.patchedFixtures || [];
    const positions = proj.showStore?.fixturePositions || {};
    
    for (const f of fixtures) {
        if (['11', '12', '17', '18', '29', '30', '35', '36'].includes(f.id)) {
            const pos = positions[f.id] || 'NO POS';
            console.log(`${f.id}: name=${f.name}, x=${pos.x}, y=${pos.y}, h=${pos.h}, heading=${pos.heading}, mountMode=${pos.mountMode}`);
        }
    }
}

main().catch(console.error);