import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';
import type { PatchedFixture } from '../stores/showStore';

/** La fixture custom Tonio 6 arm (laser RG + bee-eye + beams) doit analyser
 *  ses 3 familles de canaux couleur — le laser RG sans bleu restait en
 *  couleur arbitraire (jaune) avant le routing v2. */
describe('fixture Tonio 6 arm réelle : routing couleur v2', () => {
  it('rgbSegments = bee eye + beam + laser RG (b null)', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'fixtures', 'custom', 'custom-tonio-6-arm.json'), 'utf8');
    const def = JSON.parse(raw) as DmxFixtureDefinition;
    const pf: PatchedFixture = {
      manufacturer: def.manufacturer ?? 'Tonio', model: def.model ?? 'tonio-6-arm', fixtureType: 'moving_head',
      modeIndex: 0, modeName: def.modes[0]?.name ?? '22ch', universeId: 'u1', startAddress: 1,
      channelCount: def.modes[0].channels.length, name: 'TONIO-1', tier: 'primary',
      id: 'tonio-1', fixtureDefId: 'tonio-6-arm',
    };
    const fa = analyzeFixtureChannels(pf, def);
    expect(fa.rgbSegments.length).toBe(3);
    // bee eye RGBW d'abord (première famille insérée)
    expect(fa.rgbSegments[0]).toMatchObject({ r: 11, g: 12, b: 13, w: 14 });
    // beams RGBW
    expect(fa.rgbSegments[1]).toMatchObject({ r: 15, g: 16, b: 17, w: 18 });
    // laser RG sans bleu : b null — plus jamais de couleur arbitraire
    expect(fa.rgbSegments[2]).toMatchObject({ r: 19, g: 20, b: null });
    // rgbOffsets simple : bee eye (consommateurs simples inchangés)
    expect(fa.rgbOffsets).toEqual([11, 12, 13]);
  });
});
