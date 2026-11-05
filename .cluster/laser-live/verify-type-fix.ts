import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels } from '../../src/engine/fixture-analyzer';

const path = require('path');
const OFL = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();

async function main() {
  await lib.loadOflDirectory(OFL);
  const all = lib.getAll() as any[];
  const hit = all.filter((d) => /impress|ivl/i.test(d.id + ' ' + d.model));
  console.log('count:', hit.length);
  for (const d of hit) {
    console.log('\nid:', d.id, '| model:', d.model, '| type:', d.type);
    const longest = Math.max(...d.modes.map((m: any) => m.channels.length));
    const mo = d.modes.find((x: any) => x.channels.length === longest);
    const pf: any = { id: d.id, manufacturer: d.manufacturer, model: d.model, fixtureType: d.type, modeIndex: 0, modeName: mo.name, universeId: 'u1', startAddress: 1, channelCount: longest, name: d.id, tier: 'primary' };
    const fa = analyzeFixtureChannels(pf, { ...d, modes: [mo] });
    console.log('  isLaser=', fa.isLaser, '| mode=', fa.laserColorMode, '| rgbOffsets=', JSON.stringify(fa.rgbOffsets), '| modeOff=', fa.laserModeOffset, '| pattern=', fa.patternOffset, '| scan=', fa.scanXOffset + '/' + fa.scanYOffset, '| rot=', JSON.stringify(fa.laserRotationOffsets));
  }
}
main();