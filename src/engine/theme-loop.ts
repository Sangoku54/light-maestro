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

/**
 * Ready-to-use fixed themes for the single-loop test.
 *
 * Each palette uses 4 fully-saturated, well-separated hues (ΔE76 pairwise
 * ≥ 79, vs 10–36 for the previous monochromatic ramps) so consecutive cue
 * blocks — and the colours actually played on fixtures — are clearly
 * distinct. The previous themes were single-hue ramps (e.g. Forest had
 * ΔHue 0–3°), which made the loop look like "always the same colour".
 */
export const THEME_LOOP_PRESETS: ThemeLoopSpec[] = [
  { name: 'Neon', palette: ['#ff0055', '#00e5ff', '#7cff00', '#8b00ff'], movement: 'sweep' },
  { name: 'Rave', palette: ['#ff1a1a', '#1aff1a', '#1a1aff', '#ffcc00'], movement: 'wave' },
  { name: 'Arctic', palette: ['#ff0055', '#00ffcc', '#ffaa00', '#4400ff'], movement: 'pulse' },
  { name: 'Magma', palette: ['#ff3c00', '#ffd400', '#00ffcc', '#9b30ff'], movement: 'circle' },
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
