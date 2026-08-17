import { describe, it, expect } from 'vitest';
import { generateAutoLoops, type AutoLoop } from '../engine/auto-loops';
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
// Moving head: Pan@0, Tilt@1, Dimmer@2, R@3, G@4, B@5
const mover = def('mover-rgb', [
  ch('Pan', 'Pan', 0),
  ch('Tilt', 'Tilt', 1),
  ch('Dimmer', 'Intensity', 2),
  ch('Red', 'Colour', 3),
  ch('Green', 'Colour', 4),
  ch('Blue', 'Colour', 5),
]);
// Dimmer-only PAR: Dimmer@0
const par = def('par-dim', [ch('Dimmer', 'Intensity', 0)]);

function defsOf(...defs: DmxFixtureDefinition[]): Map<string, DmxFixtureDefinition> {
  return new Map(defs.map((d) => [d.id, d]));
}

describe('generateAutoLoops', () => {
  it('returns [] for an empty patch', () => {
    expect(generateAutoLoops([], new Map())).toEqual([]);
  });

  it('groups loops by tier and generates color-chase + movement + dimmer-pulse', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'mover-rgb', tier: 'primary', startAddress: 9 }),
      pf({ id: 'f3', fixtureDefId: 'par-dim', tier: 'primary', startAddress: 21 }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash, mover, par));

    const kinds = loops.map((l) => l.kind).sort();
    expect(kinds).toEqual(['color-chase', 'dimmer-pulse', 'movement']);

    // Every loop belongs to the primary tier and carries the right fixture ids.
    for (const loop of loops) {
      expect(loop.tier).toBe('primary');
      expect(loop.steps.length).toBeGreaterThan(0);
    }

    const cc = loops.find((l) => l.kind === 'color-chase')!;
    // f1 (RGB wash) and f2 (RGB mover) both have RGB → both in the color chase.
    expect(cc.fixtureIds.sort()).toEqual(['f1', 'f2']);

    const mv = loops.find((l) => l.kind === 'movement')!;
    expect(mv.fixtureIds).toEqual(['f2']);

    const dp = loops.find((l) => l.kind === 'dimmer-pulse')!;
    expect(dp.fixtureIds).toEqual(['f3']);
  });

  it('writes color values at absolute addresses (startAddress + offset)', () => {
    const fixtures = [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash));
    const cc = loops.find((l) => l.kind === 'color-chase')!;
    // First step: fixture shows color[0] = violet (168, 85, 247).
    const step0 = cc.steps[0].channels;
    expect(step0[1]).toBe(255); // Dimmer @ offset 0 → addr 1
    expect(step0[2]).toBe(168); // Red @ offset 1 → addr 2
    expect(step0[3]).toBe(85); // Green @ offset 2 → addr 3
    expect(step0[4]).toBe(247); // Blue @ offset 3 → addr 4
  });

  it('rotates the color chase across fixtures and steps', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 9 }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash), { chaseSteps: 4 });
    const cc = loops.find((l) => l.kind === 'color-chase')!;
    // Step 0: f1 = color0, f2 = color1 (Red at addr startAddress + 1)
    expect(cc.steps[0].channels[2]).toBe(168); // f1 R = color0.r
    expect(cc.steps[0].channels[10]).toBe(139); // f2 R (addr 9+1) = color1.r
    // Step 1: f1 = color1, f2 = color2
    expect(cc.steps[1].channels[2]).toBe(139);
    expect(cc.steps[1].channels[10]).toBe(192);
  });

  it('keeps movement positions centered around 128', () => {
    const fixtures = [pf({ id: 'f2', fixtureDefId: 'mover-rgb', tier: 'primary', startAddress: 9 })];
    const loops = generateAutoLoops(fixtures, defsOf(mover), { movementSteps: 8, movementRadius: 64 });
    const mv = loops.find((l) => l.kind === 'movement')!;
    for (const step of mv.steps) {
      const pan = step.channels[9]; // Pan at addr 9 + 0
      const tilt = step.channels[10]; // Tilt at addr 9 + 1
      expect(pan).toBeGreaterThanOrEqual(64);
      expect(pan).toBeLessThanOrEqual(192);
      expect(tilt).toBeGreaterThanOrEqual(64);
      expect(tilt).toBeLessThanOrEqual(192);
    }
  });

  it('skips disabled fixtures', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 9, enabled: false }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash));
    const cc = loops.find((l) => l.kind === 'color-chase')!;
    expect(cc.fixtureIds).toEqual(['f1']);
  });

  it('auto-adapts to newly patched fixtures (pure re-run)', () => {
    const defs = defsOf(rgbWash, par);
    const before = generateAutoLoops(
      [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })],
      defs,
    );
    expect(before.map((l) => l.kind)).toEqual(['color-chase']);

    const after = generateAutoLoops(
      [
        pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
        pf({ id: 'f3', fixtureDefId: 'par-dim', tier: 'primary', startAddress: 21 }),
      ],
      defs,
    );
    expect(after.map((l) => l.kind).sort()).toEqual(['color-chase', 'dimmer-pulse']);
  });

  it('produces separate loops per tier', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'wash-rgb', tier: 'secondary', startAddress: 9 }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash));
    const tiers = loops.map((l) => l.tier).sort();
    expect(tiers).toEqual(['primary', 'secondary']);
    expect(loops.every((l) => l.kind === 'color-chase')).toBe(true);
  });
});
