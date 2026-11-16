import { describe, it, expect } from 'vitest';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import { computeDmxForCue } from '../hooks/dmx-playback';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel, DmxFixtureCapability } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number, caps?: DmxFixtureCapability[]): DmxFixtureChannel =>
  ({ name, type, offset, ...(caps ? { capabilities: caps } : {}) });

// Mode typique « Stage Wash 7x10W LED Moving Head » 9-channel : canal
// « Dimmer / Strobe » de type Shutter qui encode FLOU stroboscope (0-7),
// la courbe d'intensité (8-134) et le strobe (135-255).
const washDef: DmxFixtureDefinition = {
  id: 'wash-hybrid', manufacturer: 'T', model: 'Wash', modes: [{
    name: '9ch', channels: [
      ch('Pan', 'Pan', 0),
      ch('Tilt', 'Tilt', 1),
      ch('Dimmer / Strobe', 'Shutter', 2, [
        { min: 0, max: 7, name: 'ShutterStrobe' },
        { min: 8, max: 134, name: 'Intensity' },
        { min: 135, max: 255, name: 'ShutterStrobe' },
      ]),
      ch('Red', 'Colour', 3),
      ch('Green', 'Colour', 4),
      ch('Blue', 'Colour', 5),
      ch('White', 'Colour', 6),
    ],
  }],
};

const pfWash: PatchedFixture = {
  id: 'W1', fixtureDefId: 'wash-hybrid', manufacturer: 'T', model: 'Wash',
  fixtureType: 'color_changer', modeIndex: 0, modeName: '9ch', universeId: 'u1',
  startAddress: 1, channelCount: 7, name: 'W1', tier: 'primary',
};

const cue = { time: 1, intensity: 'high', section: 'verse', strobe: false, energy: 0.8 } as never;

describe('canal hybride « Dimmer/Strobe » (intensité seule + courbe)', () => {
  it('analyse : intensityOffset seul (pas shutter/strobe) + courbe 8-134 mémorisée', () => {
    const fa = analyzeFixtureChannels(pfWash, washDef);
    expect(fa.intensityOffset).toBe(2);
    expect(fa.shutterOffset).toBeNull();
    expect(fa.strobeOffset).toBeNull();
    expect(fa.intensityCapRange).toEqual({ min: 8, max: 134 });
  });

  it('dimmer track 50 % : valeur remappée dans la courbe (8-134), jamais en zone strobe', () => {
    const res = computeDmxForCue(
      cue,
      [pfWash],
      new Map([['wash-hybrid', washDef]]),
      [{ id: 'u1' }],
      undefined, undefined, undefined, undefined,
      new Map([['W1', { active: true, value: 50 }]]),
    );
    // addr = startAddress(1) + offset(2) = 3
    const v = res[0].channelValues[3];
    // 8 + round(128/255 * 126) = 8 + 63 = 71
    expect(v).toBe(71);
  });

  it('dimmer track 0 % → borne basse de la courbe ; 100 % → borne haute (jamais 255 strobe)', () => {
    const low = computeDmxForCue(cue, [pfWash], new Map([['wash-hybrid', washDef]]), [{ id: 'u1' }],
      undefined, undefined, undefined, undefined, new Map([['W1', { active: true, value: 0 }]]));
    const high = computeDmxForCue(cue, [pfWash], new Map([['wash-hybrid', washDef]]), [{ id: 'u1' }],
      undefined, undefined, undefined, undefined, new Map([['W1', { active: true, value: 100 }]]));
    expect(low[0].channelValues[3]).toBe(8);
    expect(high[0].channelValues[3]).toBe(134);
  });

  it('cue seule (sans track) : l\'intensité reste dans la courbe, pas de 255 strobe', () => {
    const res = computeDmxForCue(cue, [pfWash], new Map([['wash-hybrid', washDef]]), [{ id: 'u1' }]);
    const v = res[0].channelValues[3];
    expect(v).toBeGreaterThanOrEqual(8);
    expect(v).toBeLessThanOrEqual(134);
  });
});