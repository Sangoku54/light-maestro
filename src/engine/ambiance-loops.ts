// ─── Ambiance Loops — fixture-driven, ambiance-classified lighting loops ───
//
// Generates a small, deterministic catalog of "loops" (one per ambiance) from
// the patched fixtures. Unlike the previous chaser-materializing auto-loops,
// a loop here is a *musical phrase*: 16 virtual measures of logical cues
// (time / section / color / intensity / movement / strobe) classified by
// ambiance (AtmosphereType), exactly like the autoscript's cue timeline — but
// without any audio. The DMX values are computed on demand from the patched
// fixtures via computeDmxCues (the same engine the autoscript uses).
//
//   generateAmbianceLoops()  → AmbianceLoop[] (7 loops, one per ambiance)
//   computeLoopDmxCues(loop) → DmxCue[]    (actual DMX for the current patch)
//
// A loop is fully serializable (sections + cues are plain data), so it can be
// saved to the show and recalled later from a Performance widget.

import type { PatchedFixture } from '../stores/showStore';
import type { TrackSection, AtmosphereType } from '../hooks/audio-analysis';
import {
  computeDmxCues,
  type CueInput,
  type DmxCue,
  type DmxFixtureDefinition,
} from '../hooks/dmx-cues';

// ─── Loop cue type ──────────────────────────────────────────
// A single logical cue on the 16-measure timeline. Compatible with both the
// TrackTimeline `Cue` shape (rendering) and `CueInput` (DMX computation).

export interface AmbianceCue {
  time: number;        // seconds within the loop
  section: string;     // section type (intro/verse/chorus/bridge/drop/outro/build)
  intensity: string;   // 'very-low' | 'low' | 'medium' | 'high' | 'very-high'
  color: string;       // primary palette color (hex)
  colors: string[];    // full palette for this loop
  strobe: boolean;     // strobe active at this cue
  movement?: string;   // movement pattern name (static/sweep/circle/figure8/…)
  effect: string;      // human label (section type)
  energy?: number;     // continuous 0-1 energy (derived from intensity)
}

// ─── Ambiance profile ───────────────────────────────────────

export interface AmbianceProfile {
  ambiance: AtmosphereType;
  labelFr: string;
  labelEn: string;
  bpm: number;
  palette: string[];
  colorTemp: 'warm' | 'neutral' | 'cool';
  /** Section structure over 16 measures: [sectionType, measureCount][] */
  structure: Array<[string, number]>;
  /** Per-section movement overrides (optional). */
  movementOverrides?: Record<string, string>;
  /** Per-section strobe overrides (optional). */
  strobeOverrides?: Record<string, boolean>;
}

export interface AmbianceLoop {
  id: string;
  name: string;
  ambiance: AtmosphereType;
  bpm: number;
  measures: number;    // always MEASURES_PER_LOOP (16)
  duration: number;    // seconds
  sections: TrackSection[];
  cues: AmbianceCue[];
  fixtureCount: number;
}

export const MEASURES_PER_LOOP = 16;
export const BEATS_PER_MEASURE = 4;

// ─── Section → base profile (mirrors the autoscript's getSectionProfile) ──

const BASE_INTENSITY: Record<string, string> = {
  intro: 'low', verse: 'medium', chorus: 'high', bridge: 'low',
  drop: 'very-high', outro: 'low', build: 'medium',
};

const BASE_MOVEMENT: Record<string, string> = {
  intro: 'static', verse: 'sweep', chorus: 'circle', bridge: 'figure8',
  drop: 'bounce', outro: 'sweep', build: 'spiral',
};

const BASE_STROBE: Record<string, boolean> = {
  intro: false, verse: false, chorus: true, bridge: false,
  drop: true, outro: false, build: false,
};

const SECTION_COLORS: Record<string, string> = {
  intro: '#4b5563', verse: '#3b82f6', chorus: '#8b5cf6', bridge: '#0ea5e9',
  drop: '#ef4444', outro: '#6b7280', build: '#f59e0b',
};

function intensityToEnergy(intensity: string): number {
  switch (intensity) {
    case 'very-high': return 0.95;
    case 'high': return 0.8;
    case 'medium': return 0.5;
    case 'low': return 0.25;
    case 'very-low': return 0.1;
    default: return 0.6;
  }
}

// ─── The 7 ambiances ────────────────────────────────────────

export const AMBIANCE_PROFILES: AmbianceProfile[] = [
  {
    ambiance: 'energetic', labelFr: 'Énergique', labelEn: 'Energetic', bpm: 132,
    palette: ['#ff0064', '#ffc800', '#00c8ff', '#00ff88', '#ff4500', '#ffffff'],
    colorTemp: 'warm',
    structure: [['build', 4], ['chorus', 4], ['drop', 4], ['outro', 4]],
  },
  {
    ambiance: 'dark', labelFr: 'Sombre', labelEn: 'Dark', bpm: 88,
    palette: ['#14143c', '#1e1e5e', '#4b0082', '#00008b', '#2e2e6e', '#101038'],
    colorTemp: 'cool',
    structure: [['intro', 4], ['verse', 4], ['bridge', 4], ['outro', 4]],
    movementOverrides: { intro: 'wave', verse: 'sweep', bridge: 'figure8', outro: 'wave' },
    strobeOverrides: { chorus: false, drop: false },
  },
  {
    ambiance: 'uplifting', labelFr: 'Envolée', labelEn: 'Uplifting', bpm: 126,
    palette: ['#ffb347', '#ffd700', '#ff8c00', '#ff6347', '#ffec8b', '#ffffff'],
    colorTemp: 'warm',
    structure: [['intro', 4], ['build', 4], ['chorus', 4], ['drop', 4]],
  },
  {
    ambiance: 'dreamy', labelFr: 'Rêveur', labelEn: 'Dreamy', bpm: 72,
    palette: ['#ffb3ba', '#ffdfba', '#bae1ff', '#e8baff', '#baffc9', '#f5f0ff'],
    colorTemp: 'cool',
    structure: [['intro', 4], ['verse', 4], ['bridge', 4], ['outro', 4]],
    movementOverrides: { intro: 'figure8', verse: 'wave', bridge: 'static', outro: 'wave' },
    strobeOverrides: { chorus: false, drop: false },
  },
  {
    ambiance: 'aggressive', labelFr: 'Agressif', labelEn: 'Aggressive', bpm: 140,
    palette: ['#ef4444', '#ff0000', '#ffffff', '#f97316', '#dc2626', '#fecaca'],
    colorTemp: 'neutral',
    structure: [['build', 4], ['drop', 4], ['drop', 4], ['outro', 4]],
    movementOverrides: { build: 'zigzag', drop: 'heartbeat', outro: 'sweep' },
  },
  {
    ambiance: 'groovy', labelFr: 'Groove', labelEn: 'Groovy', bpm: 110,
    palette: ['#ff0064', '#ffc800', '#00ff88', '#ff6600', '#6400ff', '#ffcc00'],
    colorTemp: 'neutral',
    structure: [['intro', 4], ['verse', 4], ['chorus', 4], ['outro', 4]],
    movementOverrides: { verse: 'bounce', chorus: 'circle', outro: 'wave' },
  },
  {
    ambiance: 'epic', labelFr: 'Épique', labelEn: 'Epic', bpm: 128,
    palette: ['#ffffff', '#ffd700', '#1e90ff', '#8b5cf6', '#c084fc', '#f0f4ff'],
    colorTemp: 'neutral',
    structure: [['intro', 4], ['build', 4], ['drop', 4], ['outro', 4]],
    movementOverrides: { intro: 'spiral', build: 'spiral', drop: 'circle', outro: 'sweep' },
  },
];

// ─── Generation ─────────────────────────────────────────────

function findSection(sections: TrackSection[], time: number): TrackSection | undefined {
  return sections.find((s) => time >= s.startTime && time < s.endTime);
}

/**
 * Generate one ambiance loop per ambiance for the patched fixtures. The loops
 * are fixture-independent (logical cues over 16 measures); the DMX values are
 * computed later via computeLoopDmxCues against the current patch. Deterministic
 * — same fixtures produce the same catalog.
 */
export function generateAmbianceLoops(
  patchedFixtures: PatchedFixture[],
  opts: { beatDivision?: number } = {},
): AmbianceLoop[] {
  const beatDivision = opts.beatDivision ?? 4;
  const fixtureCount = patchedFixtures.filter((f) => f.enabled !== false).length;

  return AMBIANCE_PROFILES.map((profile) => {
    const measureSec = (60 / profile.bpm) * BEATS_PER_MEASURE;
    const duration = MEASURES_PER_LOOP * measureSec;
    const interval = (60 / profile.bpm) * (4 / beatDivision);

    // Build contiguous sections covering [0, duration).
    const sections: TrackSection[] = [];
    let cursor = 0;
    for (const [type, measures] of profile.structure) {
      const start = cursor;
      cursor += measures * measureSec;
      sections.push({
        type: type as TrackSection['type'],
        startTime: start,
        endTime: cursor,
        energy: intensityToEnergy(BASE_INTENSITY[type] ?? 'medium'),
        color: SECTION_COLORS[type] ?? '#4b5563',
      });
    }

    // One cue per beat subdivision across the 16 measures.
    const cues: AmbianceCue[] = [];
    for (let time = 0; time < duration - interval * 0.5; time += interval) {
      const section = findSection(sections, time);
      const type = section?.type ?? 'verse';
      const intensity = BASE_INTENSITY[type] ?? 'medium';
      const movement = profile.movementOverrides?.[type] ?? BASE_MOVEMENT[type] ?? 'sweep';
      const strobe = profile.strobeOverrides?.[type] ?? BASE_STROBE[type] ?? false;
      cues.push({
        time: Math.round(time * 1000) / 1000,
        section: type,
        intensity,
        color: profile.palette[0],
        colors: profile.palette,
        strobe,
        movement,
        effect: type,
        energy: intensityToEnergy(intensity),
      });
    }

    return {
      id: `amb-${profile.ambiance}`,
      name: profile.labelFr,
      ambiance: profile.ambiance,
      bpm: profile.bpm,
      measures: MEASURES_PER_LOOP,
      duration,
      sections,
      cues,
      fixtureCount,
    };
  });
}

// ─── DMX computation (fixture-aware) ────────────────────────

/**
 * Compute the actual DMX cues for a loop against the current patch. This is the
 * "from fixtures" step — the same engine the autoscript uses to turn logical
 * cues into channel values. Returns [] when there is nothing to light.
 */
export function computeLoopDmxCues(
  loop: AmbianceLoop,
  patchedFixtures: PatchedFixture[],
  fixtureDefs: Map<string, DmxFixtureDefinition>,
  universeIds: string[],
): DmxCue[] {
  if (loop.cues.length === 0 || patchedFixtures.length === 0) return [];
  return computeDmxCues({
    cues: loop.cues as CueInput[],
    patchedFixtures,
    fixtureDefs,
    universeIds,
  });
}

/**
 * Profile lookup helpers (used by the UI to show labels/colors).
 */
export function getAmbianceProfile(ambiance: AtmosphereType): AmbianceProfile {
  return AMBIANCE_PROFILES.find((p) => p.ambiance === ambiance) ?? AMBIANCE_PROFILES[0];
}
