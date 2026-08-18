// ─── Theme Loop — one deterministic auto loop, "à la façon de l'autoscript" ──
//
// Unlike the seeded chaser library (auto-loops.ts), this generates a SINGLE
// loop as a sequence of AutoScript cues (the same CueInput shape the timeline
// renders as coloured cue blocks). There is no audio analysis, no ambiance
// detection and no BPM detection: the loop is fully determined by a fixed
// theme (palette + movement + tempo).
//
// cue.color is the single source of truth: the timeline renders it as the
// block colour, and computeDmxCues() plays exactly that colour (see the
// "single source of truth" fix in dmx-cues.ts), so played colours always match
// the cue blocks.

import type { CueInput } from '../hooks/dmx-cues';

export interface ThemeLoopSpec {
  /** Display name (also used as the cue effect prefix). */
  name: string;
  /** Hex colours the loop cycles through — these ARE the cue block colours. */
  palette: string[];
  /** Movement pattern applied to every cue. Default 'sweep'. */
  movement?: string;
  /** Loop length in 4/4 bars. Default 16. */
  bars?: number;
  /** Beats per bar. Default 4. */
  beatsPerBar?: number;
  /** Tempo in BPM. Default 120. */
  bpm?: number;
  /** Base movement amplitude (0-255, centred on 128). Default 64. */
  amplitude?: number;
}

/** Ready-to-use fixed themes for the single-loop test. */
export const THEME_LOOP_PRESETS: ThemeLoopSpec[] = [
  { name: 'Violet', palette: ['#a855f7', '#8b5cf6', '#c084fc', '#ede8dc'], movement: 'sweep' },
  { name: 'Ocean', palette: ['#1e3a8a', '#0ea5e9', '#22d3ee', '#e0f2fe'], movement: 'wave' },
  { name: 'Ember', palette: ['#7f1d1d', '#ea580c', '#f59e0b', '#fef3c7'], movement: 'pulse' },
  { name: 'Forest', palette: ['#14532d', '#16a34a', '#4ade80', '#dcfce7'], movement: 'circle' },
];

/**
 * Generate ONE deterministic loop: a cue per beat, cycling the palette.
 * Deterministic — same spec always yields the identical cue list.
 */
export function generateThemeLoop(spec: ThemeLoopSpec): CueInput[] {
  const palette = spec.palette.length > 0 ? spec.palette : ['#ffffff'];
  const bpm = spec.bpm ?? 120;
  const bars = Math.max(1, spec.bars ?? 16);
  const beatsPerBar = Math.max(1, spec.beatsPerBar ?? 4);
  const beatSec = 60 / bpm;
  const totalBeats = bars * beatsPerBar;
  const cues: CueInput[] = [];

  for (let beat = 0; beat < totalBeats; beat++) {
    cues.push({
      time: Number((beat * beatSec).toFixed(3)),
      section: 'loop',
      effect: `${spec.name} #${beat + 1}`,
      intensity: 'medium',
      colors: palette,
      color: palette[beat % palette.length],
      strobe: false,
      movement: spec.movement ?? 'sweep',
      movementAmplitude: spec.amplitude ?? 64,
      movementSpeed: 0.5,
      colorTemp: 'neutral',
      energy: 0.6,
    });
  }
  return cues;
}
