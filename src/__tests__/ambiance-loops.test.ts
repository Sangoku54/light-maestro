import { describe, it, expect } from 'vitest';
import {
  generateAmbianceLoops,
  regenerateLoopAtBpm,
  regenerateLoop,
  computeLoopDmxCues,
  AMBIANCE_PROFILES,
  THEMES,
  MEASURES_PER_LOOP,
  BEATS_PER_MEASURE,
} from '../engine/ambiance-loops';
import type { PatchedFixture } from '../stores/showStore';
import { paletteColorForTier } from '../hooks/dmx-cues';

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

describe('generateAmbianceLoops (catalog)', () => {
  it('generates themes × ambiances × tempos loops (126 by default)', () => {
    const loops = generateAmbianceLoops([fixture()]);
    expect(loops).toHaveLength(THEMES.length * AMBIANCE_PROFILES.length * 3); // 6 × 7 × 3
    expect(loops.length).toBeGreaterThan(50);
  });

  it('classifies every loop by theme, ambiance and tempo', () => {
    const loops = generateAmbianceLoops([fixture()]);
    const themes = new Set(loops.map((l) => l.theme));
    const ambiances = new Set(loops.map((l) => l.ambiance));
    expect(themes.size).toBe(THEMES.length);
    expect(ambiances.size).toBe(AMBIANCE_PROFILES.length);
    // At least 3 distinct BPM values (slow/mid/fast)
    expect(new Set(loops.map((l) => l.bpm)).size).toBeGreaterThanOrEqual(3);
  });

  it('produces multiple tempos per (ambiance, theme) pair', () => {
    const loops = generateAmbianceLoops([fixture()]);
    const pair = loops.filter((l) => l.ambiance === 'energetic' && l.theme === 'chase');
    expect(pair.length).toBeGreaterThanOrEqual(2);
    expect(new Set(pair.map((l) => l.bpm)).size).toBe(pair.length);
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
    for (const loop of generateAmbianceLoops([fixture()])) {
      expect(loop.sections.length).toBeGreaterThanOrEqual(2);
      expect(loop.sections[0].startTime).toBe(0);
      for (let i = 1; i < loop.sections.length; i++) {
        expect(loop.sections[i].startTime).toBeCloseTo(loop.sections[i - 1].endTime, 6);
      }
      expect(loop.sections[loop.sections.length - 1].endTime).toBeCloseTo(loop.duration, 6);
    }
  });

  it('cues are non-empty, ordered, and carry the loop palette', () => {
    for (const loop of generateAmbianceLoops([fixture()])) {
      expect(loop.cues.length).toBeGreaterThan(0);
      for (let i = 0; i < loop.cues.length; i++) {
        const cue = loop.cues[i];
        expect(cue.time).toBeGreaterThanOrEqual(0);
        expect(cue.time).toBeLessThan(loop.duration);
        if (i > 0) expect(cue.time).toBeGreaterThan(loop.cues[i - 1].time);
        expect(cue.colors.length).toBeGreaterThan(0);
        expect(cue.colors).toContain(cue.color);
      }
    }
  });

  it('cue colour rotates through the palette (matches computeDmxCues shift)', () => {
    const [loop] = generateAmbianceLoops([fixture()], {
      themes: ['chase'], ambiances: ['energetic'], tempoMultipliers: [1.0],
    });
    const len = loop.cues[0].colors.length;
    // First 8 cues share the first palette colour; the 9th advances.
    expect(loop.cues[0].color).toBe(loop.cues[0].colors[0]);
    expect(loop.cues[7].color).toBe(loop.cues[0].colors[0]);
    expect(loop.cues[8].color).toBe(loop.cues[0].colors[1 % len]);
  });

  it('themes produce distinct movement/strobe signatures', () => {
    const loops = generateAmbianceLoops([fixture()]);
    const wash = loops.find((l) => l.theme === 'wash')!;
    const strobe = loops.find((l) => l.theme === 'strobe')!;
    // Strobe theme → every cue strobes; wash theme → none.
    expect(strobe.cues.every((c) => c.strobe)).toBe(true);
    expect(wash.cues.every((c) => !c.strobe)).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const a = generateAmbianceLoops([fixture()]);
    const b = generateAmbianceLoops([fixture()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reports the enabled fixture count and generates even with no fixtures', () => {
    const loops = generateAmbianceLoops([fixture(), fixture({ id: 'f2', enabled: false })]);
    expect(loops[0].fixtureCount).toBe(1);
    const empty = generateAmbianceLoops([]);
    expect(empty.length).toBeGreaterThan(50);
    expect(empty[0].fixtureCount).toBe(0);
  });

  it('supports filters (themes / ambiances / tempoMultipliers)', () => {
    const loops = generateAmbianceLoops([fixture()], {
      themes: ['chase'],
      ambiances: ['dark'],
      tempoMultipliers: [1.0],
    });
    expect(loops).toHaveLength(1);
    expect(loops[0].theme).toBe('chase');
    expect(loops[0].ambiance).toBe('dark');
  });
});

describe('regenerateLoopAtBpm', () => {
  it('rebuilds the loop at a new tempo, preserving theme + ambiance', () => {
    const [loop] = generateAmbianceLoops([fixture()], {
      themes: ['chase'], ambiances: ['dark'], tempoMultipliers: [1.0],
    });
    const faster = regenerateLoopAtBpm(loop, 160);
    expect(faster.bpm).toBe(160);
    expect(faster.id).toBe(loop.id); // selection must survive a BPM change
    expect(faster.theme).toBe('chase');
    expect(faster.ambiance).toBe('dark');
    expect(faster.duration).toBeLessThan(loop.duration);
    expect(faster.cues.length).toBeGreaterThan(0);
    expect(faster.seed).toBe(loop.seed);
  });

  it('clamps out-of-range BPM', () => {
    const [loop] = generateAmbianceLoops([fixture()], {
      themes: ['chase'], ambiances: ['dark'], tempoMultipliers: [1.0],
    });
    expect(regenerateLoopAtBpm(loop, 9999).bpm).toBe(240);
    expect(regenerateLoopAtBpm(loop, 1).bpm).toBe(40);
  });
});

describe('regenerateLoop (seed variation)', () => {
  it('rebuilds with a new seed, same theme/ambiance/bpm', () => {
    const [loop] = generateAmbianceLoops([fixture()], {
      themes: ['chase'], ambiances: ['dark'], tempoMultipliers: [1.0],
    });
    const rolled = regenerateLoop(loop, 3);
    expect(rolled.seed).toBe(3);
    expect(rolled.id).toBe(loop.id); // selection must survive regeneration
    expect(rolled.theme).toBe(loop.theme);
    expect(rolled.ambiance).toBe(loop.ambiance);
    expect(rolled.bpm).toBe(loop.bpm);
    expect(rolled.duration).toBeCloseTo(loop.duration, 6);
  });

  it('different seeds produce different leading palette colours', () => {
    const [loop] = generateAmbianceLoops([fixture()], {
      themes: ['chase'], ambiances: ['energetic'], tempoMultipliers: [1.0],
    });
    const a = regenerateLoop(loop, 0);
    const b = regenerateLoop(loop, 1);
    expect(a.cues[0].color).not.toBe(b.cues[0].color);
  });

  it('keeps cue.color aligned with the DMX palette rotation for any seed', () => {
    const [loop] = generateAmbianceLoops([fixture()], {
      themes: ['chase'], ambiances: ['energetic'], tempoMultipliers: [1.0],
    });
    for (const seed of [0, 1, 2, 5]) {
      const rolled = regenerateLoop(loop, seed);
      const len = rolled.cues[0].colors.length;
      rolled.cues.forEach((cue, i) => {
        const expectedIdx = Math.floor(i / 8) % len;
        expect(cue.color).toBe(cue.colors[expectedIdx]);
      });
    }
  });
});

describe('computeLoopDmxCues', () => {
  it('returns [] for empty fixtures', () => {
    const [loop] = generateAmbianceLoops([]);
    expect(computeLoopDmxCues(loop, [], new Map(), [])).toEqual([]);
  });
});

describe('paletteColorForTier (timeline ↔ DMX consistency)', () => {
  const palette = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

  it('primary rotates through the full palette every 8 cues', () => {
    expect(paletteColorForTier(palette, 'primary', 0)).toBe('#ff0000');
    expect(paletteColorForTier(palette, 'primary', 7)).toBe('#ff0000');
    expect(paletteColorForTier(palette, 'primary', 8)).toBe('#00ff00');
    expect(paletteColorForTier(palette, 'primary', 16)).toBe('#0000ff');
  });

  it('secondary alternates between the first two palette colours (binary, SoundSwitch-style)', () => {
    const seen = new Set([
      paletteColorForTier(palette, 'secondary', 0),
      paletteColorForTier(palette, 'secondary', 8),
      paletteColorForTier(palette, 'secondary', 16),
    ]);
    expect([...seen].sort()).toEqual(['#00ff00', '#ff0000']);
  });

  it('tertiary stays on the first palette colour', () => {
    expect(paletteColorForTier(palette, 'tertiary', 0)).toBe('#ff0000');
    expect(paletteColorForTier(palette, 'tertiary', 40)).toBe('#ff0000');
  });

  it('returns undefined for an empty palette', () => {
    expect(paletteColorForTier([], 'primary', 0)).toBeUndefined();
  });
});
