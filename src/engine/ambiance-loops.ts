// ─── Ambiance Loops — fixture-driven, ambiance-classified lighting loops ───
//
// Generates a large, deterministic catalog of "loops" from the patched
// fixtures, classified along three axes — theme (style) × ambiance (mood) ×
// tempo (BPM). Each loop is a *musical phrase*: 16 virtual measures of logical
// cues (time / section / color / intensity / movement / strobe), like the
// autoscript's cue timeline but without audio. DMX values are computed on
// demand from the patched fixtures via computeDmxCues.
//
//   generateAmbianceLoops()   → AmbianceLoop[] (themes × ambiances × tempos)
//   regenerateLoopAtBpm(loop) → a new loop at a different tempo
//   computeLoopDmxCues(loop)  → DmxCue[] (actual DMX for the current patch)

import type { PatchedFixture } from '../stores/showStore';
import type { TrackSection, AtmosphereType } from '../hooks/audio-analysis';
import {
  computeDmxCues,
  type CueInput,
  type DmxCue,
  type DmxFixtureDefinition,
} from '../hooks/dmx-cues';

// ─── Loop cue type ──────────────────────────────────────────

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
  dimmerPulseOnBeat?: boolean;
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
  movementOverrides?: Record<string, string>;
  strobeOverrides?: Record<string, boolean>;
}

// ─── Theme (style) profile ──────────────────────────────────

export interface ThemeProfile {
  id: string;
  labelFr: string;
  labelEn: string;
  /** Uniform movement across the loop's sections. */
  movement: string;
  /** 'section' = strobe on drop/chorus, 'all' = strobe everywhere, 'none' = never. */
  strobeMode: 'section' | 'all' | 'none';
  /** Beat-synced dimmer breathing on every cue. */
  dimmerPulse: boolean;
}

export interface AmbianceLoop {
  id: string;
  name: string;
  theme: string;        // ThemeProfile id
  ambiance: AtmosphereType;
  bpm: number;
  measures: number;     // always MEASURES_PER_LOOP (16)
  duration: number;     // seconds
  sections: TrackSection[];
  cues: AmbianceCue[];
  fixtureCount: number;
  seed: number;         // variation seed (palette rotation offset)
}

export const MEASURES_PER_LOOP = 16;
export const BEATS_PER_MEASURE = 4;

// ─── Section → base profile ─────────────────────────────────

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

// ─── The 6 themes (styles) ──────────────────────────────────

export const THEMES: ThemeProfile[] = [
  { id: 'wash',   labelFr: 'Lavage',    labelEn: 'Wash',    movement: 'wave',    strobeMode: 'none',    dimmerPulse: false },
  { id: 'chase',  labelFr: 'Chase',     labelEn: 'Chase',   movement: 'circle',  strobeMode: 'section', dimmerPulse: false },
  { id: 'pulse',  labelFr: 'Pulsation', labelEn: 'Pulse',   movement: 'bounce',  strobeMode: 'none',    dimmerPulse: true },
  { id: 'sweep',  labelFr: 'Balayage',  labelEn: 'Sweep',   movement: 'sweep',   strobeMode: 'section', dimmerPulse: false },
  { id: 'strobe', labelFr: 'Strobe',    labelEn: 'Strobe',  movement: 'static',  strobeMode: 'all',     dimmerPulse: false },
  { id: 'build',  labelFr: 'Montée',    labelEn: 'Build',   movement: 'spiral',  strobeMode: 'section', dimmerPulse: false },
];

// ─── Tempo variants (BPM multiplier) ────────────────────────

export interface TempoVariant {
  id: 'slow' | 'mid' | 'fast';
  labelFr: string;
  labelEn: string;
  mult: number;
}

export const TEMPO_VARIANTS: TempoVariant[] = [
  { id: 'slow', labelFr: 'Lent',   labelEn: 'Slow', mult: 0.8 },
  { id: 'mid',  labelFr: 'Moyen',  labelEn: 'Mid',  mult: 1.0 },
  { id: 'fast', labelFr: 'Rapide', labelEn: 'Fast', mult: 1.25 },
];

// ─── Generation ─────────────────────────────────────────────

function findSection(sections: TrackSection[], time: number): TrackSection | undefined {
  return sections.find((s) => time >= s.startTime && time < s.endTime);
}

function buildLoop(
  profile: AmbianceProfile,
  theme: ThemeProfile,
  bpm: number,
  fixtureCount: number,
  opts: { beatDivision?: number; seed?: number },
): AmbianceLoop {
  const beatDivision = opts.beatDivision ?? 4;
  const seed = opts.seed ?? 0;
  const measureSec = (60 / bpm) * BEATS_PER_MEASURE;
  const duration = MEASURES_PER_LOOP * measureSec;
  const interval = (60 / bpm) * (4 / beatDivision);

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
  // The seed rotates the WHOLE palette (both what the timeline shows via
  // `color` and what computeDmxCues actually plays via `colors`), so a
  // regenerated loop keeps timeline ↔ DMX in sync for every seed.
  const cues: AmbianceCue[] = [];
  const paletteLen = Math.max(1, profile.palette.length);
  const paletteStart = ((seed % paletteLen) + paletteLen) % paletteLen;
  const rotatedPalette = paletteStart === 0
    ? profile.palette
    : [...profile.palette.slice(paletteStart), ...profile.palette.slice(0, paletteStart)];
  let cueIndex = 0;
  for (let time = 0; time < duration - interval * 0.5; time += interval) {
    const section = findSection(sections, time);
    const type = section?.type ?? 'verse';
    const intensity = BASE_INTENSITY[type] ?? 'medium';
    // Theme movement wins; ambiance overrides apply when the theme has none.
    const movement =
      (theme.movement && theme.movement !== 'static') ? theme.movement
      : profile.movementOverrides?.[type] ?? BASE_MOVEMENT[type] ?? 'sweep';
    const sectionStrobe = profile.strobeOverrides?.[type] ?? BASE_STROBE[type] ?? false;
    const strobe =
      theme.strobeMode === 'all' ? true
      : theme.strobeMode === 'none' ? false
      : sectionStrobe;
    const paletteIdx = Math.floor(cueIndex / 8) % paletteLen;
    cues.push({
      time: Math.round(time * 1000) / 1000,
      section: type,
      intensity,
      color: rotatedPalette[paletteIdx],
      colors: rotatedPalette,
      strobe,
      movement,
      effect: type,
      energy: intensityToEnergy(intensity),
      dimmerPulseOnBeat: theme.dimmerPulse,
    });
    cueIndex++;
  }

  return {
    id: `amb-${theme.id}-${profile.ambiance}-${bpm}`,
    name: `${theme.labelFr} · ${profile.labelFr} · ${bpm} BPM`,
    theme: theme.id,
    ambiance: profile.ambiance,
    bpm,
    measures: MEASURES_PER_LOOP,
    duration,
    sections,
    cues,
    fixtureCount,
    seed,
  };
}

export interface GenerateOptions {
  beatDivision?: number;
  /** Variation seed — rotates the palette start offset (0 = default). */
  seed?: number;
  /** Restrict to these theme ids. Defaults to all. */
  themes?: string[];
  /** Restrict to these ambiances. Defaults to all. */
  ambiances?: AtmosphereType[];
  /** Tempo multipliers. Defaults to [0.8, 1.0, 1.25]. */
  tempoMultipliers?: number[];
}

/**
 * Generate the full loop catalog: themes × ambiances × tempos. Deterministic —
 * same fixtures produce the same catalog. By default this yields 6 × 7 × 3 =
 * 126 loops.
 */
export function generateAmbianceLoops(
  patchedFixtures: PatchedFixture[],
  opts: GenerateOptions = {},
): AmbianceLoop[] {
  const beatDivision = opts.beatDivision ?? 4;
  const seed = opts.seed ?? 0;
  const tempoMultipliers = opts.tempoMultipliers ?? [0.8, 1.0, 1.25];
  const fixtureCount = patchedFixtures.filter((f) => f.enabled !== false).length;

  const themes = THEMES.filter((t) => !opts.themes || opts.themes.includes(t.id));
  const profiles = AMBIANCE_PROFILES.filter(
    (p) => !opts.ambiances || opts.ambiances.includes(p.ambiance),
  );

  const loops: AmbianceLoop[] = [];
  for (const profile of profiles) {
    for (const theme of themes) {
      for (const mult of tempoMultipliers) {
        const bpm = Math.max(40, Math.min(240, Math.round(profile.bpm * mult)));
        loops.push(buildLoop(profile, theme, bpm, fixtureCount, { beatDivision, seed }));
      }
    }
  }
  return loops;
}

/**
 * Rebuild a loop at a different tempo (same theme + ambiance, new BPM). Used by
 * the tempo slider in the UI.
 */
export function regenerateLoopAtBpm(loop: AmbianceLoop, bpm: number): AmbianceLoop {
  const profile = getAmbianceProfile(loop.ambiance);
  const theme = THEMES.find((t) => t.id === loop.theme) ?? THEMES[0];
  const fixtureCount = loop.fixtureCount;
  // Preserve the original id so the UI selection survives a BPM change.
  // Otherwise the regenerated loop gets a new id (theme+ambiance+newBPM) and
  // the panel's `selected = loops.find(id)` falls back to loops[0].
  return {
    ...buildLoop(profile, theme, Math.max(40, Math.min(240, Math.round(bpm))), fixtureCount, { seed: loop.seed }),
    id: loop.id,
  };
}

/**
 * Rebuild a loop with a new variation seed (same theme + ambiance + BPM, new
 * palette rotation). Used by the "régénérer" button in the UI.
 */
export function regenerateLoop(loop: AmbianceLoop, seed: number): AmbianceLoop {
  const profile = getAmbianceProfile(loop.ambiance);
  const theme = THEMES.find((t) => t.id === loop.theme) ?? THEMES[0];
  // Preserve the original id so the UI selection survives regeneration.
  return { ...buildLoop(profile, theme, loop.bpm, loop.fixtureCount, { seed }), id: loop.id };
}

// ─── DMX computation (fixture-aware) ────────────────────────

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

export function getAmbianceProfile(ambiance: AtmosphereType): AmbianceProfile {
  return AMBIANCE_PROFILES.find((p) => p.ambiance === ambiance) ?? AMBIANCE_PROFILES[0];
}

export function getThemeProfile(themeId: string): ThemeProfile {
  return THEMES.find((t) => t.id === themeId) ?? THEMES[0];
}
