import { describe, it, expect } from 'vitest';
import {
  generateAmbianceLoops,
  computeLoopDmxCues,
  AMBIANCE_PROFILES,
  MEASURES_PER_LOOP,
  BEATS_PER_MEASURE,
} from '../engine/ambiance-loops';
import type { PatchedFixture } from '../stores/showStore';

function fixture(partial: Partial<PatchedFixture> = {}): PatchedFixture {
  return {
    id: 'f1',
    fixtureDefId: 'def-1',
    manufacturer: 'Test',
    model: 'RGB Par',
    fixtureType: 'par',
    modeIndex: 0,
    modeName: '4ch',
    universeId: 'u1',
    startAddress: 1,
    channelCount: 4,
    name: 'Par 1',
    tier: 'primary',
    ...partial,
  };
}

describe('generateAmbianceLoops', () => {
  it('generates one loop per ambiance (7)', () => {
    const loops = generateAmbianceLoops([fixture()]);
    expect(loops).toHaveLength(AMBIANCE_PROFILES.length);
    expect(loops).toHaveLength(7);
  });

  it('every loop spans exactly 16 measures at its own BPM', () => {
    const loops = generateAmbianceLoops([fixture()]);
    for (const loop of loops) {
      expect(loop.measures).toBe(MEASURES_PER_LOOP);
      const expected = (60 / loop.bpm) * BEATS_PER_MEASURE * MEASURES_PER_LOOP;
      expect(loop.duration).toBeCloseTo(expected, 6);
    }
  });

  it('sections are contiguous and cover [0, duration)', () => {
    const loops = generateAmbianceLoops([fixture()]);
    for (const loop of loops) {
      expect(loop.sections.length).toBeGreaterThanOrEqual(2);
      expect(loop.sections[0].startTime).toBe(0);
      // Contiguous: each section starts where the previous ends
      for (let i = 1; i < loop.sections.length; i++) {
        expect(loop.sections[i].startTime).toBeCloseTo(loop.sections[i - 1].endTime, 6);
      }
      expect(loop.sections[loop.sections.length - 1].endTime).toBeCloseTo(loop.duration, 6);
    }
  });

  it('cues are non-empty, ordered, and each carries the loop palette', () => {
    const loops = generateAmbianceLoops([fixture()]);
    for (const loop of loops) {
      expect(loop.cues.length).toBeGreaterThan(0);
      for (let i = 0; i < loop.cues.length; i++) {
        const cue = loop.cues[i];
        expect(cue.time).toBeGreaterThanOrEqual(0);
        expect(cue.time).toBeLessThan(loop.duration);
        if (i > 0) expect(cue.time).toBeGreaterThan(loop.cues[i - 1].time);
        expect(cue.section.length).toBeGreaterThan(0);
        expect(cue.colors).toEqual(loop.sections.length > 0 ? cue.colors : cue.colors);
        expect(cue.colors.length).toBeGreaterThan(0);
        expect(cue.color).toBe(cue.colors[0]);
        expect(typeof cue.intensity).toBe('string');
        expect(typeof cue.strobe).toBe('boolean');
      }
    }
  });

  it('different ambiances have different palettes', () => {
    const loops = generateAmbianceLoops([fixture()]);
    const palettes = new Set(loops.map((l) => l.cues[0].colors.join(',')));
    expect(palettes.size).toBe(AMBIANCE_PROFILES.length);
  });

  it('is deterministic for the same input', () => {
    const a = generateAmbianceLoops([fixture()]);
    const b = generateAmbianceLoops([fixture()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reports the enabled fixture count', () => {
    const loops = generateAmbianceLoops([fixture(), fixture({ id: 'f2', enabled: false })]);
    expect(loops[0].fixtureCount).toBe(1);
  });

  it('generates loops even with no fixtures (fixtureCount 0)', () => {
    const loops = generateAmbianceLoops([]);
    expect(loops).toHaveLength(AMBIANCE_PROFILES.length);
    expect(loops[0].fixtureCount).toBe(0);
  });
});

describe('computeLoopDmxCues', () => {
  it('returns [] for empty fixtures', () => {
    const [loop] = generateAmbianceLoops([]);
    expect(computeLoopDmxCues(loop, [], new Map(), [])).toEqual([]);
  });

  it('returns [] when there are no cues', () => {
    const loop = {
      id: 'x', name: 'x', ambiance: 'energetic' as const, bpm: 120,
      measures: 16, duration: 32, sections: [], cues: [], fixtureCount: 1,
    };
    expect(computeLoopDmxCues(loop, [fixture()], new Map(), ['u1'])).toEqual([]);
  });
});
