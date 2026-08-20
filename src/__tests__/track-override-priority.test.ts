import { describe, it, expect } from 'vitest';
import {
  computeColorTrackColors,
  computeDimmerTrackOverrides,
  computeStrobeTrackOverrides,
} from '../hooks/dmx-playback';
import {
  computeFixtureTrackOverrides,
  computeEfxOverrides,
  resolveTrackTargets,
} from '../hooks/fixture-tracks';

// Minimal patched fixtures (same minimal shape as chaser-track.test.ts)
const fixtures = [
  { id: 'fx-1', name: 'Wash 1', startAddress: 1, channelCount: 10, universeId: 'u1', tier: 'primary' },
  { id: 'fx-2', name: 'Wash 2', startAddress: 43, channelCount: 12, universeId: 'u1', tier: 'primary' },
];
const groups = [{ id: 'g1', fixtureIds: ['fx-1'] }];

describe('Track override production (the layer that wins over AutoScript)', () => {
  it('color track forces a color on its targets only', () => {
    const colorTracks = [
      { id: 'ct1', entries: [{ id: 'e1', time: 0, endTime: 10, color: '#ff0000' }], targetFixtures: { type: 'fixture', fixtureIds: ['fx-1'] } },
    ];
    const map = computeColorTrackColors(colorTracks as any, 5, fixtures as any, groups as any);
    expect(map.get('fx-1')).toBe('#ff0000');
    expect(map.has('fx-2')).toBe(false); // fixture 2 not targeted → autoscript color stays
  });

  it('color track resolves group targets to each member fixture', () => {
    const colorTracks = [
      { id: 'ct2', entries: [{ id: 'e1', time: 0, endTime: 10, color: '#00ff00' }], targetFixtures: { type: 'group', groupId: 'g1' } },
    ];
    const map = computeColorTrackColors(colorTracks as any, 3, fixtures as any, groups as any);
    expect(map.get('fx-1')).toBe('#00ff00'); // fx-1 is in group g1
    expect(map.has('fx-2')).toBe(false);
  });

  it('dimmer track forces a dimmer value (can go down, overriding autoscript intensity)', () => {
    const dimmerTracks = [
      { id: 'dt1', entries: [{ id: 'e1', time: 0, endTime: 10, value: 10 }], targetFixtures: { type: 'fixture', fixtureIds: ['fx-1'] } },
    ];
    const map = computeDimmerTrackOverrides(dimmerTracks as any, 5, fixtures as any, groups as any);
    expect(map.get('fx-1')).toEqual({ active: true, value: 10 });
    expect(map.has('fx-2')).toBe(false);
  });

  it('strobe track forces an active strobe with its speed', () => {
    const strobeTracks = [
      { id: 'st1', entries: [{ id: 'e1', time: 0, endTime: 10, speed: 8 }], targetFixtures: { type: 'fixture', fixtureIds: ['fx-1'] } },
    ];
    const map = computeStrobeTrackOverrides(strobeTracks as any, 5, fixtures as any, groups as any);
    expect(map.get('fx-1')).toEqual({ active: true, speed: 8 });
    expect(map.has('fx-2')).toBe(false);
  });

  it('fixture track exposes color/dimmer/movement blocks for its targets', () => {
    const ft = {
      id: 'ft1',
      target: 'fixture:fx-1',
      label: 'Wash 1 lane',
      enabled: true,
      colorBlocks: [{ id: 'cb', time: 0, endTime: 10, color: '#0000ff' }],
      dimmerBlocks: [{ id: 'db', time: 0, endTime: 10, value: 200 }],
      strobeBlocks: [],
      movementBlocks: [{ id: 'mb', time: 0, endTime: 10, pattern: 'sweep', amplitude: 90 }],
      channelOverrides: {},
    };
    const fto = computeFixtureTrackOverrides([ft as any], 5, fixtures as any, groups as any);
    expect(fto.forcedColors.get('fx-1')).toBe('#0000ff');
    expect(fto.forcedDimmers.get('fx-1')).toBe(200);
    expect(fto.forcedMovements.get('fx-1')).toEqual({ pattern: 'sweep', amplitude:90 });
    // disabled track → no override
    const ftoDisabled = computeFixtureTrackOverrides([{ ...ft, enabled: false } as any], 5, fixtures as any, groups as any);
    expect(ftoDisabled.forcedColors.size).toBe(0);
  });

  it('efx track produces pan/tilt (centered on 128) for its targets', () => {
    const effects = [{ id: 'eff-1', pattern: 'Circle', speed: 0.5, width: 0.5, height: 0.5, rotation: 0, xOffset: 0, yOffset: 0 }];
    const efxTracks = [
      { id: 'et1', name: 'EFX 1', entries: [{ id: 'e1', time: 0, endTime: 10, effectId: 'eff-1', pattern: 'Circle', fixtureNames: [] }], targetFixtures: { type: 'fixture', fixtureIds: ['fx-1'] } },
    ];
    const map = computeEfxOverrides(efxTracks as any, 2, effects as any, fixtures as any, groups as any);
    expect(map.has('fx-1')).toBe(true);
    const pt = map.get('fx-1')!;
    expect(pt.pan).toBeGreaterThanOrEqual(0);
    expect(pt.pan).toBeLessThanOrEqual(255);
    expect(pt.tilt).toBeGreaterThanOrEqual(0);
    expect(pt.tilt).toBeLessThanOrEqual(255);
  });

  it('resolveTrackTargets maps fixture/group/tier/unknown correctly', () => {
    const f = resolveTrackTargets({ target: 'fixture:fx-1' } as any, fixtures as any, groups as any);
    expect(f).toEqual(['fx-1']);
    const g = resolveTrackTargets({ target: 'group:g1' } as any, fixtures as any, groups as any);
    expect(g).toEqual(['fx-1']);
    const t = resolveTrackTargets({ target: 'tier:primary' } as any, fixtures as any, groups as any);
    expect(t).toEqual(['fx-1', 'fx-2']);
    const none = resolveTrackTargets({ target: 'fixture:missing' } as any, fixtures as any, groups as any);
    expect(none).toEqual([]);
  });
});
