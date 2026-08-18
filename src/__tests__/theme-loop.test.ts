import { describe, it, expect } from 'vitest';
import { generateThemeLoop, THEME_LOOP_PRESETS } from '../engine/theme-loop';
import { computeDmxCues } from '../hooks/dmx-cues';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel => ({
  name,
  type,
  offset,
});

function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}

function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string }): PatchedFixture {
  return {
    manufacturer: 'Test',
    model: partial.fixtureDefId,
    fixtureType: 'moving_head',
    modeIndex: 0,
    modeName: 'm',
    universeId: 'u1',
    startAddress: 1,
    channelCount: 1,
    name: partial.id,
    tier: 'primary',
    ...partial,
  };
}

// RGB wash: Dimmer@0, R@1, G@2, B@3
const rgbWash = def('wash-rgb', [
  ch('Dimmer', 'Intensity', 0),
  ch('Red', 'Colour', 1),
  ch('Green', 'Colour', 2),
  ch('Blue', 'Colour', 3),
]);

describe('generateThemeLoop', () => {
  it('is deterministic and yields one loop (bars × beatsPerBar cues)', () => {
    const a = generateThemeLoop({ name: 'Violet', palette: ['#a855f7', '#8b5cf6'], bars: 4, bpm: 120 });
    const b = generateThemeLoop({ name: 'Violet', palette: ['#a855f7', '#8b5cf6'], bars: 4, bpm: 120 });
    expect(a.length).toBe(16);
    expect(a).toEqual(b); // deterministic — no seed, no audio
    expect(a[0].color).toBe('#a855f7');
    expect(a[1].color).toBe('#8b5cf6');
    expect(a[2].color).toBe('#a855f7'); // cycles the palette
  });

  it('ships presets', () => {
    expect(THEME_LOOP_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const p of THEME_LOOP_PRESETS) {
      expect(p.palette.length).toBeGreaterThan(0);
      const cues = generateThemeLoop(p);
      expect(cues.length).toBeGreaterThan(0);
    }
  });
});

describe('computeDmxCues plays the cue colour (single source of truth)', () => {
  it('alternates the played RGB with the cue colour, not a palette index', () => {
    // Two-colour palette: block colours alternate a855f7 / 22d3ee.
    const cues = generateThemeLoop({ name: 'Violet', palette: ['#a855f7', '#22d3ee'], bars: 1, bpm: 120 });
    expect(cues.length).toBe(4);
    const fixtures = [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })];
    const defs = new Map<string, DmxFixtureDefinition>([['wash-rgb', rgbWash]]);

    const dmxCues = computeDmxCues({ cues, patchedFixtures: fixtures, fixtureDefs: defs, universeIds: ['u1'] });
    expect(dmxCues.length).toBe(cues.length);

    const hex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    const played = dmxCues.map((dc) => {
      // rgbWash: R@addr2, G@addr3, B@addr4 (startAddress 1 + offsets 1..3)
      return hex([dc.channelValues[2] ?? 0, dc.channelValues[3] ?? 0, dc.channelValues[4] ?? 0]);
    });

    expect(played).toEqual(['#a855f7', '#22d3ee', '#a855f7', '#22d3ee']);
  });
});
