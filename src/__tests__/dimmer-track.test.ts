import { describe, it, expect } from 'vitest';
import { computeDmxForCue } from '../hooks/dmx-playback';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel => ({ name, type, offset });

function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}

function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string }): PatchedFixture {
  return {
    manufacturer: 'Test', model: partial.fixtureDefId, fixtureType: 'moving_head', modeIndex: 0, modeName: 'm',
    universeId: 'u1', startAddress: 1, channelCount: 1, name: partial.id, tier: 'primary', ...partial,
  };
}

// Fixture multi-têtes : 3 canaux Intensity (LED 1, LED 2, LED 3)
const multiLed = def('multi-led', [
  ch('LED 1', 'Intensity', 0),
  ch('LED 2', 'Intensity', 1),
  ch('LED 3', 'Intensity', 2),
]);

describe('track dimmer : priorité sur l\'autoscript (toutes fixtures)', () => {
  it('l\'override force le dimmer et se propage aux LED 2..N (multi-têtes)', () => {
    const res = computeDmxForCue(
      { time: 1, intensity: 'high', section: 'verse', strobe: false, energy: 0.8 } as never,
      [pf({ id: 'M1', fixtureDefId: 'multi-led', fixtureType: 'moving_head', startAddress: 1, channelCount: 3 })],
      new Map([['multi-led', multiLed]]),
      [{ id: 'u1' }],
      undefined,
      undefined,
      undefined,
      undefined,
      new Map([['M1', { active: true, value: 50 }]]), // dimmerTrackOverrides
    );
    const chv = res[0].channelValues;
    // 50 % => 128 forcé sur TOUTES les têtes LED (canaux 1, 2, 3),
    // même si la cue « high » calculerait plus (la track diminue et gagne).
    expect(chv[1]).toBe(128);
    expect(chv[2]).toBe(128);
    expect(chv[3]).toBe(128);
  });

  it('sans override : les LED 2..N reçoivent quand même l\'intensité de la cue', () => {
    const res = computeDmxForCue(
      { time: 1, intensity: 'high', section: 'verse', strobe: false, energy: 0.8 } as never,
      [pf({ id: 'M1', fixtureDefId: 'multi-led', fixtureType: 'moving_head', startAddress: 1, channelCount: 3 })],
      new Map([['multi-led', multiLed]]),
      [{ id: 'u1' }],
    );
    const chv = res[0].channelValues;
    expect(chv[1]).toBeGreaterThan(0); // canal principal piloté par la cue
    // LED 2..N doivent être écrites avec la même intensité (fix multi-head spider)
    expect(chv[2]).toBe(chv[1]);
    expect(chv[3]).toBe(chv[1]);
  });
});
