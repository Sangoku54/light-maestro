import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels } from '../../src/engine/fixture-analyzer';

async function main(): Promise<void> {
  const lib = new FixtureLibrary();
  await lib.loadOflDirectory('resources/fixtures/ofl');
  for (const id of ['panasonic-PT-RZ120', 'panasonic-PT-RZ120L', 'jb-systems-Twin-Effect-Laser', 'showtec-Dominator']) {
    const d = lib.getAll().find((x) => x.id === id);
    if (!d) { console.log(id, '-> introuvable'); continue; }
    let best = 0, len = -1;
    d.modes.forEach((m: any, i: number) => { if ((m.channels ?? []).length > len) { len = m.channels.length; best = i; } });
    const pf: any = {
      id: d.id, fixtureDefId: d.id, manufacturer: d.manufacturer, model: d.model,
      fixtureType: d.type, modeIndex: best, modeName: d.modes[best].name,
      universeId: 'U1', startAddress: 1, channelCount: d.modes[best].channels.length,
      name: d.model, tier: 'primary',
    };
    const fa = analyzeFixtureChannels(pf, d);
    console.log('RESULT', d.id, 'isLaser:', fa.isLaser,
      'mode:', fa.laserModeOffset, 'pattern:', fa.patternOffset,
      'scanX:', fa.scanXOffset, 'scanY:', fa.scanYOffset,
      'rgb:', JSON.stringify(fa.rgbOffsets), 'wheel:', fa.wheelOffset,
      'rot:', fa.laserRotationOffsets.length, 'blank:', fa.blankOffset, 'nCh:', fa.channelCount);
  }
}

main().catch((e) => { console.log('ERR', e); });