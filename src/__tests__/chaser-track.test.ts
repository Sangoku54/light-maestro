import { describe, it, expect } from 'vitest';
import { computeChaserTrackOverrides } from '../hooks/dmx-playback';

// Realistic data mirroring the app: scenes store DMX addresses (absolute),
// chasers reference scenes by id, fixtures are patched with startAddress.
const scenes = [
  { id: 'sc-1', name: 'Rouge', channels: { 5: 255, 6: 255, 7: 0, 8: 0 } },   // Wash 1 addr 1: dimmer@5, R@6, G@7, B@8
  { id: 'sc-2', name: 'Bleu', channels: { 5: 200, 6: 0, 7: 0, 8: 255 } },
];

const chasers = [
  {
    id: 'ch-1',
    name: 'Mon Chaser',
    steps: [
      { sceneId: 'sc-1', fadeIn: 500, hold: 1000, fadeOut: 500 },
      { sceneId: 'sc-2', fadeIn: 500, hold: 1000, fadeOut: 500 },
    ],
  },
];

const tracks = [
  {
    id: 'chaser-track-1',
    name: 'Chaser Track 1',
    entries: [{ id: 'e1', time: 0, endTime: 6, chaserId: 'ch-1', chaserName: 'Mon Chaser' }],
    targetFixtures: { type: 'all' },
  },
];

const fixtures = [
  { id: 'fx-1', name: 'Wash 1', startAddress: 1, channelCount: 10, universeId: 'u1' },
  { id: 'fx-2', name: 'Mini 1', startAddress: 43, channelCount: 12, universeId: 'u1' },
];

const groups: { id: string; fixtureIds: string[] }[] = [];

describe('computeChaserTrackOverrides', () => {
  it('does not throw and drives the chaser fixtures during the block', () => {
    for (const t of [0, 0.3, 0.5, 1.0, 2.0, 3.2, 4.0, 5.9]) {
      const map = computeChaserTrackOverrides(tracks as any, chasers as any, scenes as any, t, fixtures as any, groups as any);
      // Should not throw, and should control at least the Wash fixture
      expect(map.has('fx-1')).toBe(true);
      // Values must be valid 0-255 numbers
      for (const cmap of map.values()) {
        for (const v of Object.values(cmap)) {
          expect(typeof v).toBe('number');
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('resolves step values with coherent units (times in s, step durations in ms)', () => {
    // Block [0-6s]; steps are 500 fadeIn + 1000 hold + 500 fadeOut (2000ms each).
    // t=1.25s → 1250ms into the cycle → inside step 0's HOLD → full scene values.
    const atHold = computeChaserTrackOverrides(tracks as any, chasers as any, scenes as any, 1.25, fixtures as any, groups as any);
    expect(atHold.get('fx-1')?.[5]).toBe(255); // dimmer at full
    // t=0.25s → 250ms → 50% of fadeIn → dimmer ≈ 128
    const atFadeIn = computeChaserTrackOverrides(tracks as any, chasers as any, scenes as any, 0.25, fixtures as any, groups as any);
    expect(atFadeIn.get('fx-1')?.[5]).toBe(128);
    // t=5.9s → 5900ms → 5900 % 4000 = 1900 → step 0 fadeOut (1500-2000): 400/500 elapsed → scale 0.2 → 255*0.2=51
    const atFadeOut = computeChaserTrackOverrides(tracks as any, chasers as any, scenes as any, 5.9, fixtures as any, groups as any);
    expect(atFadeOut.get('fx-1')?.[5]).toBe(51);
  });

  it('returns empty map when no block is active', () => {
    const map = computeChaserTrackOverrides(tracks as any, chasers as any, scenes as any, 7.0, fixtures as any, groups as any);
    expect(map.size).toBe(0);
  });

  it('freezes a static focus scene: same pan/tilt across the hold (10s guitar focus)', () => {
    // Scène "focus guitariste" : pan/tilt fixes + rouge, jouée via un chaser
    // 1 step de 10s de hold. La lecture doit rester figée, pas suivre l'autoscript.
    const focusScenes = [
      { id: 'sc-focus', name: 'Focus guitare', channels: { 43: 100, 44: 150, 45: 255, 46: 0, 47: 0 } },
    ];
    const focusChasers = [
      { id: 'ch-focus', name: 'Focus', steps: [{ sceneId: 'sc-focus', fadeIn: 0, hold: 10000, fadeOut: 0 }] },
    ];
    const focusTracks = [
      { id: 't-focus', name: 'T', entries: [{ id: 'e', time: 0, endTime: 10, chaserId: 'ch-focus' }], targetFixtures: { type: 'all' } },
    ];
    const at5 = computeChaserTrackOverrides(focusTracks as any, focusChasers as any, focusScenes as any, 5.0, fixtures as any, groups as any);
    const at55 = computeChaserTrackOverrides(focusTracks as any, focusChasers as any, focusScenes as any, 5.5, fixtures as any, groups as any);
    expect(at5.get('fx-2')?.[43]).toBe(100);
    expect(at5.get('fx-2')?.[44]).toBe(150);
    expect(at5.get('fx-2')?.[45]).toBe(255);
    expect(at55.get('fx-2')).toEqual(at5.get('fx-2'));
  });

  it('still triggers with inverted entry bounds (resized block)', () => {
    const inverted = [
      { id: 't-inv', name: 'T', entries: [{ id: 'e', time: 10, endTime: 0, chaserId: 'ch-1' }], targetFixtures: { type: 'all' } },
    ];
    const map = computeChaserTrackOverrides(inverted as any, chasers as any, scenes as any, 5.0, fixtures as any, groups as any);
    expect(map.has('fx-1')).toBe(true);
  });

  it('works without targetFixtures (old presets)', () => {
    const legacy = [
      { id: 't-leg', name: 'T', entries: [{ id: 'e', time: 0, endTime: 6, chaserId: 'ch-1' }] },
    ];
    const map = computeChaserTrackOverrides(legacy as any, chasers as any, scenes as any, 1.0, fixtures as any, groups as any);
    expect(map.has('fx-1')).toBe(true);
  });

  it('returns empty map when chaser has no steps or scenes are missing', () => {
    const empty = computeChaserTrackOverrides(
      [{ id: 't', name: 't', entries: [{ id: 'e', time: 0, endTime: 10, chaserId: 'missing' }], targetFixtures: { type: 'all' } }] as any,
      chasers as any,
      scenes as any,
      1.0,
      fixtures as any,
      groups as any,
    );
    expect(empty.size).toBe(0);
  });
});
