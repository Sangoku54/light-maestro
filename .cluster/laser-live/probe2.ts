import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels } from '../../src/engine/fixture-analyzer';

const OFL = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();

function pf(id: string) {
  return {
    manufacturer: 'x', model: 'x', fixtureType: 'laser', modeIndex: 0, modeName: 'm',
    universeId: 'u1', startAddress: 1, channelCount: 1, name: id, id, tier: 'primary',
  };
}

for (const [mfr, file] of [
  ['cameo', 'ioda-400-rgy.json'],
  ['american-dj', 'galaxian-3d.json'],
  ['american-dj', 'boom-box-fx2.json'],
  ['jb-systems', 'inno-pocket-fusion.json'],
] as [string, string][]) {
  const p = path.join(OFL, mfr, file);
  if (!fs.existsSync(p)) { console.log(file, 'ABSENT'); continue; }
  const def = lib.parseOFLFixture(fs.readFileSync(p, 'utf8'), mfr);
  const longest = Math.max(...def.modes.map((m: any) => m.channels.length));
  const mo = def.modes.find((x: any) => x.channels.length === longest);
  const fa = analyzeFixtureChannels(pf(file), { ...def, modes: [mo] });
  console.log('=== ' + file);
  console.log('  patternOffset:', fa.patternOffset, '| patternCaps:', JSON.stringify(fa.patternCaps));
  console.log('  wheelOffset:', fa.wheelOffset, '| wheelCaps n:', fa.wheelCaps.length, '| laserColorMode:', fa.laserColorMode);
  console.log('  scanX:', fa.scanXOffset, 'scanY:', fa.scanYOffset, '| rot:', JSON.stringify(fa.laserRotationOffsets));
  console.log('  speeds pattern/scan:', fa.laserSpeedPatternOffset, fa.laserSpeedScanOffset);
  console.log('  shutterOffset:', fa.shutterOffset, '| intensityOffset:', fa.intensityOffset, '| zoomOffset:', fa.zoomOffset, '| modeOffset:', fa.laserModeOffset, '(' + (fa.laserModeCaps || []).length + ' caps)');
}