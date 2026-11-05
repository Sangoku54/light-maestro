import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels } from '../../src/engine/fixture-analyzer';
import { computeLaserChannels } from '../../src/hooks/dmx-playback';

const OFL = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();

function pf(id: string, addr: number, count: number, mfr: string, file: string) {
  return {
    manufacturer: mfr, model: file, fixtureType: 'Color Changer', modeIndex: 0, modeName: 'm',
    universeId: 'u1', startAddress: addr, channelCount: count, name: id, id, tier: 'primary',
  } as any;
}

for (const [mfr, file] of [['cameo', 'ioda-400-rgy.json'], ['american-dj', 'galaxian-3d.json']] as [string, string][]) {
  const def = lib.parseOFLFixture(fs.readFileSync(path.join(OFL, mfr, file), 'utf8'), mfr);
  const longest = Math.max(...def.modes.map((m: any) => m.channels.length));
  const mo = def.modes.find((x: any) => x.channels.length === longest);
  const p = pf(file, 1, longest, mfr, file);
  const fa = analyzeFixtureChannels(p, { ...def, modes: [mo] });
  console.log(`\n=== ${file} (Color Changer, addr=1, ${longest}ch) isLaser=${fa.isLaser} mode=${fa.laserColorMode}`);
  for (const palette of ['#ff0000', '#808080', '#0000ff', '#0f0f0f', undefined as any]) {
    const row: string[] = [];
    for (const t of [0, 0.5, 1, 2, 4]) {
      const chVals: Record<number, number> = {};
      computeLaserChannels(fa, p, chVals, t, 0.5, palette);
      const keys = Object.keys(chVals).map(Number).sort((a, b) => a - b);
      row.push('t' + t + '=' + keys.map((k) => `${k}:${chVals[k]}`).join(','));
    }
    console.log(`palette=${palette ?? '(sans)'} => ${row.join('  ')}`);
  }
}