import { describe, it, expect } from 'vitest';
import type { TrackSection, TrackAnalysis } from '../hooks/audio-analysis';

// We import genCues from the view file — it's a pure function, no React needed
// @ts-ignore — file contains JSX in other exports, but genCues is plain TS
import { genCues } from '../views/QuickShowView';

// ─── Helpers ──────────────────────────────────────────────

function makeSection(
  type: TrackSection['type'],
  startTime: number,
  endTime: number,
  energy: number = 0.5,
): TrackSection {
  return { type, startTime, endTime, energy, color: '#888' };
}

function makeSections(): TrackSection[] {
  return [
    makeSection('intro', 0, 15, 0.3),
    makeSection('verse', 15, 35, 0.5),
    makeSection('build', 35, 45, 0.7),
    makeSection('drop', 45, 70, 0.95),
    makeSection('verse', 70, 90, 0.6),
    makeSection('build', 90, 100, 0.75),
    makeSection('chorus', 100, 120, 0.85),
    makeSection('outro', 120, 140, 0.25),
  ];
}

function defaultCfg(overrides: Record<string, any> = {}) {
  return {
    musicStyle: 'techno',
    colorScheme: 'auto',
    intensity: 'dynamic',
    movement: 'dynamic',
    beatDivision: 4,
    audioReactive: true,
    sectionAware: true,
    customPalette: [],
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    duration: 140,
    sampleRate: 44100,
    bpm: 128,
    beats: [],
    beatPositions: [],
    beatStrengths: [],
    timeSignature: '4/4',
    key: 'C',
    keyConfidence: 0.8,
    genre: JSON.stringify({ genre: 'techno' }),
    atmosphere: 'energetic',
    energyCurve: new Array(256).fill(0).map((_, i) => {
      const t = i / 255;
      // Simulate track structure: intro low → drop high → outro low
      if (t < 0.1) return 0.2 + t * 2;
      if (t < 0.5) return 0.5 + t * 0.5;
      if (t < 0.6) return 0.6 + (t - 0.5) * 4;
      if (t < 0.7) return 0.9;
      if (t < 0.85) return 0.6;
      return 0.3 - (t - 0.85) * 2;
    }),
    rmsCurve: new Array(256).fill(0.5),
    spectralCentroidCurve: new Array(256).fill(0.5),
    onsetCurve: new Array(256).fill(0),
    lowCurve: new Array(256).fill(0.3),
    midCurve: new Array(256).fill(0.3),
    highCurve: new Array(256).fill(0.3),
    downbeats: [],
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────

describe('genCues', () => {
  // ── Basic structure ──────────────────────────────────

  it('returns an array', () => {
    const cues = genCues(makeSections(), 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    expect(Array.isArray(cues)).toBe(true);
  });

  it('generates at least one cue per section', () => {
    const sections = makeSections();
    const cues = genCues(sections, 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    expect(cues.length).toBeGreaterThanOrEqual(sections.length);
  });

  it('generates more cues for faster BPM', () => {
    const sections = makeSections();
    const cuesSlow = genCues(sections, 60, 4, defaultCfg(), [], undefined, makeAnalysis({ duration: 140, bpm: 60 }));
    const cuesFast = genCues(sections, 180, 4, defaultCfg(), [], undefined, makeAnalysis({ duration: 140, bpm: 180 }));
    // Faster BPM → shorter beat interval → more cues
    expect(cuesFast.length).toBeGreaterThan(cuesSlow.length);
  });

  it('generates more cues for higher beatDivision', () => {
    const sections = makeSections();
    const cues2 = genCues(sections, 128, 2, defaultCfg(), [], undefined, makeAnalysis());
    const cues8 = genCues(sections, 128, 8, defaultCfg(), [], undefined, makeAnalysis());
    // Higher division → shorter interval → more cues
    expect(cues8.length).toBeGreaterThan(cues2.length);
  });

  // ── Cue properties ───────────────────────────────────

  it('all cues have required fields', () => {
    const cues = genCues(makeSections(), 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    for (const cue of cues) {
      expect(cue).toHaveProperty('time');
      expect(cue).toHaveProperty('section');
      expect(cue).toHaveProperty('effect');
      expect(cue).toHaveProperty('intensity');
      expect(cue).toHaveProperty('colors');
      expect(Array.isArray(cue.colors)).toBe(true);
      expect(cue.colors.length).toBeGreaterThan(0);
    }
  });

  it('cues are sorted by time', () => {
    const cues = genCues(makeSections(), 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].time).toBeGreaterThanOrEqual(cues[i - 1].time);
    }
  });

  it('all cue times are within section boundaries', () => {
    const sections = makeSections();
    const cues = genCues(sections, 128, 4, defaultCfg(), [], undefined, makeAnalysis({ duration: 140 }));
    const maxTime = sections[sections.length - 1].endTime;
    for (const cue of cues) {
      expect(cue.time).toBeGreaterThanOrEqual(0);
      expect(cue.time).toBeLessThanOrEqual(maxTime + 1); // +1 for tolerance
    }
  });

  it('each cue has a valid section type', () => {
    const validTypes = ['intro', 'verse', 'chorus', 'bridge', 'drop', 'outro', 'build', 'unknown'];
    const cues = genCues(makeSections(), 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    for (const cue of cues) {
      expect(validTypes).toContain(cue.section);
    }
  });

  // ── Colors ───────────────────────────────────────────

  it('cues have valid hex colors', () => {
    const cues = genCues(makeSections(), 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    for (const cue of cues) {
      for (const color of cue.colors) {
        expect(hexRe.test(color)).toBe(true);
      }
    }
  });

  it('regenSeed produces deterministic output', () => {
    const sections = makeSections();
    const analysis = makeAnalysis();
    const run1 = genCues(sections, 128, 4, defaultCfg(), [], 42, analysis);
    const run2 = genCues(sections, 128, 4, defaultCfg(), [], 42, analysis);
    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].time).toBe(run2[i].time);
      expect(run1[i].section).toBe(run2[i].section);
      expect(run1[i].colors).toEqual(run2[i].colors);
    }
  });

  it('different regenSeed produces different effects/movement', () => {
    const sections = makeSections();
    const analysis = makeAnalysis();
    const run1 = genCues(sections, 128, 4, defaultCfg(), [], 1, analysis);
    const run2 = genCues(sections, 128, 4, defaultCfg(), [], 999, analysis);
    // Different seeds should produce at least one difference in effects or movement
    const effects1 = run1.map((c: any) => c.effect).join(',');
    const effects2 = run2.map((c: any) => c.effect).join(',');
    const movements1 = run1.map((c: any) => c.movement || '').join(',');
    const movements2 = run2.map((c: any) => c.movement || '').join(',');
    const all1 = run1.map((c: any) => c.intensity).join(',');
    const all2 = run2.map((c: any) => c.intensity).join(',');
    // At least one dimension should differ
    const anyDiff = effects1 !== effects2 || movements1 !== movements2 || all1 !== all2;
    expect(anyDiff).toBe(true);
  });

  // ── Edge cases ───────────────────────────────────────

  it('empty sections returns empty array', () => {
    const cues = genCues([], 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    expect(Array.isArray(cues)).toBe(true);
    expect(cues.length).toBe(0);
  });

  it('works without analysis (non-audio-reactive mode)', () => {
    const cfg = defaultCfg({ audioReactive: false });
    const cues = genCues(makeSections(), 128, 4, cfg, [], undefined, null);
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.time).toBeGreaterThanOrEqual(0);
    }
  });

  it('works with zero BPM (edge case)', () => {
    const cues = genCues(makeSections(), 0, 4, defaultCfg(), [], undefined, makeAnalysis({ bpm: 0 }));
    expect(Array.isArray(cues)).toBe(true);
    // Should not crash — may produce few or no cues
  });

  it('single-section track works', () => {
    const cues = genCues(
      [makeSection('drop', 0, 30, 0.9)],
      128, 4, defaultCfg(), [], undefined,
      makeAnalysis({ duration: 30 }),
    );
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.section).toBe('drop');
    }
  });

  it('manualCues are included in output', () => {
    const manualCues = [
      { time: 10, section: 'verse', effect: 'strobe', colors: ['#ff0000'], color: '#ff0000', intensity: 'high', strobe: true } as any,
      { time: 50, section: 'drop', effect: 'static', colors: ['#00ff00'], color: '#00ff00', intensity: 'high', strobe: false } as any,
    ];
    const cues = genCues(makeSections(), 128, 4, defaultCfg(), manualCues, undefined, makeAnalysis());
    // Manual cues should appear exactly
    const manual = cues.filter((c: any) => c.manual === true);
    expect(manual.length).toBeGreaterThanOrEqual(2);
  });

  // ── Genre-specific behavior ──────────────────────────

  it('different genres influence movement pattern selection', () => {
    const sections = makeSections();
    const analysis = makeAnalysis();
    const technoCfg = defaultCfg({ musicStyle: 'techno' });
    const balladCfg = defaultCfg({ musicStyle: 'ballad' });

    const technoCues = genCues(sections, 128, 4, technoCfg, [], 1, analysis);
    const balladCues = genCues(sections, 128, 4, balladCfg, [], 1, analysis);

    // Ballad should have more 'static' movements, techno more aggressive patterns
    const techMov = technoCues.map((c: any) => c.movement || '').join(',');
    const balladMov = balladCues.map((c: any) => c.movement || '').join(',');
    // Across 100+ cues, genres with different biases should produce different patterns
    expect(techMov).not.toBe(balladMov);
  });

  // ── Movement ─────────────────────────────────────────

  it('cues have movement-related fields', () => {
    const validMovements = ['static', 'sweep', 'circle', 'pulse', 'wave', 'bounce', 'figure8', 'spiral', 'zigzag', 'heartbeat', 'randomWalk', 'diamond', 'panOnly', 'tiltOnly'];
    const cues = genCues(makeSections(), 128, 4, defaultCfg(), [], undefined, makeAnalysis());
    for (const cue of cues) {
      if (cue.movement) {
        expect(validMovements).toContain(cue.movement);
      }
      if (cue.movementAmplitude !== undefined) {
        expect(cue.movementAmplitude).toBeGreaterThanOrEqual(0);
        expect(cue.movementAmplitude).toBeLessThanOrEqual(128);
      }
    }
  });

  // ── Intensity / Movement dropdown overrides (audio-reactive) ──

  it('intensity dropdown forces the level on every cue (audio-reactive)', () => {
    const sections = makeSections();
    const analysis = makeAnalysis();
    for (const level of ['very-low', 'low', 'medium', 'high', 'very-high']) {
      const cues = genCues(sections, 128, 4, defaultCfg({ intensity: level }), [], 1, analysis);
      for (const cue of cues) {
        expect(cue.intensity).toBe(level);
      }
    }
  });

  it("intensity 'dynamic' stays audio-driven (RMS-based, not forced)", () => {
    const sections = makeSections();
    const analysis = makeAnalysis();
    const cues = genCues(sections, 128, 4, defaultCfg({ intensity: 'dynamic' }), [], 1, analysis);
    // constant RMS 0.5 → 'medium'; cues just before a drop get 'high' (anticipation) — never a forced arbitrary level
    for (const cue of cues) {
      expect(['medium', 'high']).toContain(cue.intensity);
    }
  });

  it("movement 'smooth' never produces aggressive patterns", () => {
    const sections = makeSections();
    const analysis = makeAnalysis({ genre: JSON.stringify({ genre: 'dubstep' }), atmosphere: 'aggressive' });
    const cues = genCues(sections, 128, 4, defaultCfg({ musicStyle: 'dubstep', movement: 'smooth' }), [], 1, analysis);
    const aggressive = ['zigzag', 'heartbeat', 'bounce', 'diamond'];
    for (const cue of cues) {
      if (cue.movement) expect(aggressive).not.toContain(cue.movement);
    }
  });

  it("movement 'sharp' never produces gentle patterns", () => {
    const sections = makeSections();
    const analysis = makeAnalysis();
    const cues = genCues(sections, 128, 4, defaultCfg({ movement: 'sharp' }), [], 1, analysis);
    const gentle = ['static', 'panOnly', 'wave', 'tiltOnly'];
    for (const cue of cues) {
      if (cue.movement) expect(gentle).not.toContain(cue.movement);
    }
  });
});
