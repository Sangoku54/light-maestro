import { describe, it, expect } from 'vitest';
import { computeDmxForCue } from '../hooks/dmx-playback';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel => ({ name, type, offset });

// Barre RGB 3 canaux SANS canal intensité (ex. Wall Washer 3-channel)
const rgbOnlyDef: DmxFixtureDefinition = {
  id: 'rgb-only', manufacturer: 'T', model: 'RGB Bar', modes: [{
    name: '3ch', channels: [
      ch('Red', 'Colour', 0),
      ch('Green', 'Colour', 1),
      ch('Blue', 'Colour', 2),
    ],
  }],
};

const pfRgb: PatchedFixture = {
  id: 'RGB1', fixtureDefId: 'rgb-only', manufacturer: 'T', model: 'RGB Bar',
  fixtureType: 'led_bar', modeIndex: 0, modeName: '3ch', universeId: 'u1',
  startAddress: 1, channelCount: 3, name: 'RGB1', tier: 'other',
};

const cue = { time: 1, intensity: 'high', section: 'verse', strobe: false, energy: 0.8 } as never;

describe('dimmer sur fixtures RGB-only (scaling, sans canal intensité)', () => {
  it('piste dimmer 50 % : tous les canaux RGB scalés à 128, même sans couleur de cue', () => {
    const res = computeDmxForCue(
      cue,
      [pfRgb],
      new Map([['rgb-only', rgbOnlyDef]]),
      [{ id: 'u1' }],
      undefined, undefined, undefined, undefined,
      new Map([['RGB1', { active: true, value: 50 }]]),
    );
    const chv = res[0].channelValues;
    expect(chv[1]).toBe(128);
    expect(chv[2]).toBe(128);
    expect(chv[3]).toBe(128);
  });

  it('piste dimmer 100 % → blanc pleine intensité ; 0 % → éteint', () => {
    const full = computeDmxForCue(cue, [pfRgb], new Map([['rgb-only', rgbOnlyDef]]), [{ id: 'u1' }],
      undefined, undefined, undefined, undefined, new Map([['RGB1', { active: true, value: 100 }]]));
    const off = computeDmxForCue(cue, [pfRgb], new Map([['rgb-only', rgbOnlyDef]]), [{ id: 'u1' }],
      undefined, undefined, undefined, undefined, new Map([['RGB1', { active: true, value: 0 }]]));
    expect(full[0].channelValues[1]).toBe(255);
    expect(off[0].channelValues[1]).toBe(0);
    expect(off[0].channelValues[2]).toBe(0);
    expect(off[0].channelValues[3]).toBe(0);
  });

  it('sans piste dimmer et sans couleur de cue : aucun canal RGB écrit', () => {
    const res = computeDmxForCue(cue, [pfRgb], new Map([['rgb-only', rgbOnlyDef]]), [{ id: 'u1' }]);
    // Aucune valeur produite : la fixture RGB-only sans couleur reste éteinte.
    expect(res.length).toBe(0);
  });
});