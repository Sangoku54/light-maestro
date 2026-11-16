/**
 * Liste les lasers « muets » (isLaser=true mais aucun rôle exploitable) —
 * extraction propre sans le bruit de debug.
 */
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeFixtureChannels } from '../../src/engine/fixture-analyzer';

const p = require('path');
const OFL = p.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();

async function main() {
  await lib.loadOflDirectory(OFL);
  const defs = lib.getAll() as any[];
  const report: string[] = [];
  let lasers = 0, mute = 0, scan = 0;
  const wrongType: string[] = [];

  for (const def of defs) {
    let mo = def.modes[0];
    for (const m of def.modes) if (m.channels.length > mo.channels.length) mo = m;
    const pf: any = {
      id: def.id, manufacturer: def.manufacturer, model: def.model, fixtureType: def.type,
      modeIndex: 0, modeName: mo.name, universeId: 'u1', startAddress: 1,
      channelCount: mo.channels.length, name: def.id, tier: 'primary',
    };
    let fa: any;
    try {
      fa = analyzeFixtureChannels(pf, { ...def, modes: [mo] });
    } catch (e) { report.push('THROW ' + def.id + ': ' + (e as Error).message); continue; }
    if (!fa.isLaser) {
      // faux négatifs potentiels : type Laser OFL mais analyse non-laser, ou
      // nom/vraie nature laser évidente (scanner/effect)
      if (def.type === 'Laser' || /laser|twister/i.test(def.id)) wrongType.push(def.id);
      continue;
    }
    lasers++;
    if (fa.scanXOffset !== null || fa.scanYOffset !== null) scan++;
    const exploitable =
      fa.laserModeOffset !== null ||
      (fa.patternOffset !== null && fa.patternCaps.length > 0) ||
      fa.scanXOffset !== null || fa.scanYOffset !== null ||
      (fa.rgbOffsets !== null && fa.rgbOffsets.length >= 2) ||
      fa.wheelOffset !== null ||
      fa.laserRotationOffsets.length > 0;
    if (!exploitable) {
      mute++;
      report.push(
        `MUTE ${def.id} (${def.type}) mode=${mo.name} ch=${mo.channels.length} | ` +
        `modeOff=${fa.laserModeOffset} pattern=${fa.patternOffset}/${fa.patternCaps.length} ` +
        `scan=${fa.scanXOffset}/${fa.scanYOffset} rgb=${JSON.stringify(fa.rgbOffsets)} ` +
        `wheel=${fa.wheelOffset} shutter=${fa.shutterOffset} int=${fa.intensityOffset} rot=${fa.laserRotationOffsets.length}`,
      );
    }
  }
  console.log(`COVERAGE fixtures=${defs.length} lasers=${lasers} lasersScan=${scan} lasersMuets=${mute}`);
  console.log('FAUX_NEGATIFS_POTENTIELS:' + JSON.stringify(wrongType));
  console.log('---MUTES---');
  for (const r of report) console.log(r);
}
main();