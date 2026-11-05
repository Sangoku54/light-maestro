import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels, pickLaserModeCap } from '../../src/engine/fixture-analyzer';
import type { PatchedFixture } from '../../src/stores/showStore';

const OFL = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');

function pf(id: string): PatchedFixture {
  return {
    manufacturer: 'x', model: 'x', fixtureType: 'laser', modeIndex: 0, modeName: 'm',
    universeId: 'u1', startAddress: 1, channelCount: 1, name: id, id, tier: 'primary',
  };
}

function findFiles(keywords: string[]): { mfr: string; file: string }[] {
  const out: { mfr: string; file: string }[] = [];
  for (const mfr of fs.readdirSync(OFL)) {
    const dir = path.join(OFL, mfr);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      if (keywords.some((k) => file.toLowerCase().includes(k))) out.push({ mfr, file });
    }
  }
  return out;
}

const lib = new FixtureLibrary();
const targets = [
  ...findFiles(['ioda']),
  ...findFiles(['galaxian']),
  ...findFiles(['stinger']),
  ...findFiles(['fusion']),
  ...findFiles(['boom']),
];

for (const { mfr, file } of targets) {
  const raw = fs.readFileSync(path.join(OFL, mfr, file), 'utf8');
  const def = lib.parseOFLFixture(raw, mfr);
  if (!def || !def.modes.length) { console.log(file, 'parse KO'); continue; }
  const longest = Math.max(...def.modes.map((m) => m.channels.length));
  const m = def.modes.find((x) => x.channels.length === longest)!;
  const fa = analyzeFixtureChannels(pf(file), { ...def, modes: [m] });
  const modeCap = fa.laserModeOffset !== null && fa.laserModeCaps.length > 0 ? pickLaserModeCap(fa.laserModeCaps) : null;
  console.log(
    file,
    '| mode@', fa.laserModeOffset, modeCap ? `[${modeCap.name || '?'}@${modeCap.min}-${modeCap.max}]` : '',
    '| rgbOffsets', fa.rgbOffsets ? JSON.stringify(fa.rgbOffsets) : '-',
    '| wheel@', fa.wheelOffset,
    '| scanX@', fa.scanXOffset, 'scanY@', fa.scanYOffset,
    '| rot', JSON.stringify(fa.laserRotationOffsets),
    '| pattern@', fa.patternOffset,
    '| colorMode', fa.laserColorMode,
  );
}