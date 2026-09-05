/**
 * DMX Cue Computer - bridges AutoScript cues to DMX channel values.
 *
 * Takes patched fixtures + generated cues → computes actual DMX values
 * respecting fixture channel layouts (RGB, color wheel, dimmer, shutter, pan/tilt, gobo).
 *
 * Features an intelligent choreography engine:
 *  - Section-aware movement patterns (static, sweep, circle, figure8, bounce, wave)
 *  - Distributed color palettes across fixtures with color chase on drops
 *  - Intelligent strobe (section-aware rates, energy-gated)
 *  - Gobo rotation synced to beat boundaries
 *  - Atmosphere-aware: color temperature, strobe probability, dimmer pulse, color shift speed
 *
 * Inspired by QLC+: HTP merge on intensity channels, LTP on everything else.
 */

import type { PatchedFixture, FixtureTier } from '../stores/showStore';
import { useShowStore, type FixtureGroup } from '../stores/showStore';
import { analyzeFixture, type FixtureChannelAnalysis, capMid, pickLaserModeCap, laserGateValue } from '../engine/fixture-analyzer';

// ─── Inline fixture definition types (mirrors electron/fixtures/library.ts) ──

export interface DmxFixtureCapability {
  min: number;
  max: number;
  name: string;
  color?: string;
}

export interface DmxFixtureChannel {
  name: string;
  offset?: number;
  type:
    | 'Intensity'
    | 'Pan'
    | 'Tilt'
    | 'Colour'
    | 'Gobo'
    | 'Shutter'
    | 'Strobe'
    | 'Speed'
    | 'Prism'
    | 'Effect'
    | 'Beam'
    | 'Maintenance'
    | 'Nothing' | 'Macro' | 'Zoom' | 'Frost' | 'Focus' | 'Iris';
  capabilities?: DmxFixtureCapability[];
}

export interface DmxFixturePhysical {
  lensDegMin?: number;
  lensDegMax?: number;
  panMax?: number;
  tiltMax?: number;
}

export interface DmxFixtureMode {
  name: string;
  channels: DmxFixtureChannel[];
  physical?: DmxFixturePhysical;
}

export interface DmxFixtureDefinition {
  id: string;
  manufacturer: string;
  model: string;
  modes: DmxFixtureMode[];
  physical?: DmxFixturePhysical;
}

// ─── DMX Cue type ──────────────────────────────────────────────

export interface DmxCue {
  time: number;
  section: string;
  universe: number;
  channelValues: Record<number, number>;
  fixtureNames: string[];
  fixtureCount: number;
  effect: string;
  colors: string[];
  manual?: boolean; // true when inserted by user via waveform context menu
}

// ─── Cue input (from genCues) ──────────────────────────────────

export interface CueInput {
  time: number;
  section: string;
  effect: string;
  intensity: string;
  colors: string[];
  color: string;
  strobe: boolean;
  group?: string;
  /** NEW: Atmosphere-aware parameters */
  colorTemp?: 'warm' | 'neutral' | 'cool';
  strobeProbability?: number;
  dimmerPulseOnBeat?: boolean;
  colorShiftSpeed?: number;
  movement?: string; // MovementPattern name: 'circle'|'zigzag'|'heartbeat'|etc (not section type)
  movementAmplitude?: number; // 0-255 DMX amplitude, computed from audio features
  movementSpeed?: number; // 0-1 speed multiplier, computed from audio features
  /** Continuous 0-1 audio energy at cue time (from energyCurve).
   *  When present, overrides string intensity for DMX value computation. */
  energy?: number;
}

// ─── Movement Pattern Engine ───────────────────────────────────

export type MovementPattern =
  | 'static'
  | 'sweep'
  | 'circle'
  | 'figure8'
  | 'bounce'
  | 'wave'
  | 'pulse'
  | 'zigzag'
  | 'diamond'
  | 'spiral'
  | 'heartbeat'
  | 'randomWalk'
  | 'panOnly'
  | 'tiltOnly';

export interface MovementConfig {
  pattern: MovementPattern;
  centerX: number;
  centerY: number;
  amplitude: number;
  speed: number;
  phaseOffset: number;
}

// ─── Section → Movement config (fallback if cue.movement not set) ──

const SECTION_MOVEMENT: Record<string, MovementConfig> = {
  intro:  { pattern: 'static',   centerX: 128, centerY: 128, amplitude: 50,  speed: 0.15, phaseOffset: 0.25 },
  verse:  { pattern: 'sweep',    centerX: 128, centerY: 128, amplitude: 90,  speed: 0.3,  phaseOffset: 0.15 },
  chorus: { pattern: 'circle',   centerX: 128, centerY: 128, amplitude: 120, speed: 0.6,  phaseOffset: 0.1  },
  bridge: { pattern: 'static',   centerX: 128, centerY: 128, amplitude: 70,  speed: 0.1,  phaseOffset: 0.3  },
  drop:   { pattern: 'bounce',   centerX: 128, centerY: 128, amplitude: 140, speed: 0.9,  phaseOffset: 0.05 },
  outro:  { pattern: 'sweep',    centerX: 128, centerY: 128, amplitude: 70,  speed: 0.2,  phaseOffset: 0.2  },
};

const DEFAULT_MOVEMENT: MovementConfig = {
  pattern: 'sweep',
  centerX: 128,
  centerY: 128,
  amplitude: 80,
  speed: 0.3,
  phaseOffset: 0.15,
};

/**
 * Movement config by movement type (from atmosphere-aware cues).
 * When a cue specifies `movement`, use these presets with section-appropriate amplitude.
 */
const MOVEMENT_BY_TYPE: Record<string, Omit<MovementConfig, 'amplitude'>> = {
  static:     { pattern: 'static',     centerX: 128, centerY: 128, speed: 0.05, phaseOffset: 0.3 },
  sweep:      { pattern: 'sweep',      centerX: 128, centerY: 128, speed: 0.35, phaseOffset: 0.15 },
  circle:     { pattern: 'circle',     centerX: 128, centerY: 128, speed: 0.6,  phaseOffset: 0.1 },
  pulse:      { pattern: 'bounce',     centerX: 128, centerY: 128, speed: 0.8,  phaseOffset: 0.05 },
  wave:       { pattern: 'wave',       centerX: 128, centerY: 128, speed: 0.5,  phaseOffset: 0.15 },
  figure8:    { pattern: 'figure8',    centerX: 128, centerY: 128, speed: 0.45, phaseOffset: 0.12 },
  zigzag:     { pattern: 'zigzag',     centerX: 128, centerY: 128, speed: 0.7,  phaseOffset: 0.08 },
  diamond:    { pattern: 'diamond',    centerX: 128, centerY: 128, speed: 0.55, phaseOffset: 0.1 },
  spiral:     { pattern: 'spiral',     centerX: 128, centerY: 128, speed: 0.4,  phaseOffset: 0.2 },
  heartbeat:  { pattern: 'heartbeat',  centerX: 128, centerY: 128, speed: 0.75, phaseOffset: 0.05 },
  randomWalk: { pattern: 'randomWalk', centerX: 128, centerY: 128, speed: 0.3,  phaseOffset: 0.25 },
  panOnly:    { pattern: 'panOnly',    centerX: 128, centerY: 128, speed: 0.35, phaseOffset: 0.15 },
  tiltOnly:   { pattern: 'tiltOnly',   centerX: 128, centerY: 128, speed: 0.35, phaseOffset: 0.15 },
  bounce:     { pattern: 'bounce',     centerX: 128, centerY: 128, speed: 0.8,  phaseOffset: 0.05 }, // alias for pulse
};

/** Select a movement pattern name using audio features from the cue. */
function getMovementConfig(section: string, cueMovement?: string, movAmplitude?: number, movSpeed?: number): MovementConfig {
  // If cue provides a movement type, build from the type presets
  if (cueMovement && MOVEMENT_BY_TYPE[cueMovement]) {
    const base = MOVEMENT_BY_TYPE[cueMovement];
    const secKey = section.toLowerCase();
    const secAmplitude = movAmplitude ?? SECTION_MOVEMENT[secKey]?.amplitude ?? 40;
    return {
      pattern: base.pattern as MovementPattern,
      centerX: base.centerX,
      centerY: base.centerY,
      amplitude: secAmplitude,
      speed: movSpeed ?? base.speed,
      phaseOffset: base.phaseOffset,
    };
  }
  const key = section.toLowerCase();
  const fallback = SECTION_MOVEMENT[key] ?? DEFAULT_MOVEMENT;
  return {
    ...fallback,
    amplitude: movAmplitude ?? fallback.amplitude,
    speed: movSpeed ?? fallback.speed,
  };
}

function computeMovement(
  config: MovementConfig,
  time: number,
  fixtureIndex: number,
  totalFixtures: number,
): { pan: number; tilt: number } {
  const basePhase = time * config.speed * 2 * Math.PI;
  const fixturePhase = totalFixtures > 1
    ? fixtureIndex * config.phaseOffset * 2 * Math.PI
    : 0;
  const phase = basePhase + fixturePhase;

  let panNorm = 0;
  let tiltNorm = 0;

  switch (config.pattern) {
    case 'static': {
      panNorm = Math.sin(basePhase * 0.05 + fixturePhase) * 0.5;
      tiltNorm = Math.cos(basePhase * 0.07 + fixturePhase) * 0.5;
      break;
    }
    case 'sweep': {
      panNorm = Math.sin(phase);
      tiltNorm = 0;
      break;
    }
    case 'circle': {
      panNorm = Math.sin(phase);
      tiltNorm = Math.cos(phase);
      break;
    }
    case 'figure8': {
      panNorm = Math.sin(phase);
      tiltNorm = Math.sin(2 * phase);
      break;
    }
    case 'bounce':
    case 'pulse': {
      panNorm = Math.abs(Math.sin(phase)) * 2 - 1;
      tiltNorm = 0;
      break;
    }
    case 'wave': {
      panNorm = 0;
      tiltNorm = Math.sin(phase);
      break;
    }
    case 'zigzag': {
      // Sharp linear zigzag - sawtooth wave on pan, square on tilt
      panNorm = ((phase / Math.PI) % 2) - 1; // sawtooth -1..1
      tiltNorm = Math.sin(phase) > 0 ? 0.5 : -0.5;
      break;
    }
    case 'diamond': {
      // Diamond/rhombus path - triangle waves 90° out of phase
      panNorm = ((phase / Math.PI) % 2) - 1; // triangle saw
      tiltNorm = (((phase + Math.PI/2) / Math.PI) % 2) - 1;
      break;
    }
    case 'spiral': {
      // Expanding/contracting spiral - sin/cos with amplitude modulation
      const spiralR = 0.3 + 0.7 * Math.abs(Math.sin(phase * 0.3));
      panNorm = Math.sin(phase * 2) * spiralR;
      tiltNorm = Math.cos(phase * 2) * spiralR;
      break;
    }
    case 'heartbeat': {
      // Double-pulse like a heartbeat - two quick beats, then pause
      const hbPhase = (phase / (Math.PI * 2)) % 1; // 0..1 cycle
      const hb = hbPhase < 0.15 ? 1 : hbPhase < 0.3 ? 0.6 : 0;
      panNorm = hb * Math.sin(phase * 3);
      tiltNorm = hb * Math.cos(phase * 3);
      break;
    }
    case 'randomWalk': {
      // Smooth random drift - use seeded sin with irrational frequencies for organic feel
      panNorm = Math.sin(phase * 0.7) * 0.5 + Math.sin(phase * 1.3) * 0.3 + Math.cos(phase * 2.1) * 0.2;
      tiltNorm = Math.cos(phase * 0.6) * 0.5 + Math.sin(phase * 1.7) * 0.3 + Math.sin(phase * 2.3) * 0.2;
      break;
    }
    case 'panOnly': {
      panNorm = Math.sin(phase);
      tiltNorm = 0;
      break;
    }
    case 'tiltOnly': {
      panNorm = 0;
      tiltNorm = Math.sin(phase);
      break;
    }
  }

  const pan = Math.round(config.centerX + panNorm * config.amplitude);
  const tilt = Math.round(config.centerY + tiltNorm * config.amplitude);

  return {
    pan: Math.max(0, Math.min(255, pan)),
    tilt: Math.max(0, Math.min(255, tilt)),
  };
}

// ─── Strobe configuration ──────────────────────────────────────

const STROBE_DISABLED_SECTIONS = new Set(['intro', 'verse', 'bridge', 'outro']);

const STROBE_RATES: Record<string, [number, number]> = {
  chorus: [180, 200],
  drop:   [200, 255],
};
const DEFAULT_STROBE_RATE: [number, number] = [160, 220];

function getStrobeRate(section: string, strobeProbability?: number): number {
  const [lo, hi] = STROBE_RATES[section.toLowerCase()] ?? DEFAULT_STROBE_RATE;
  // Scale rate based on strobe probability
  const prob = strobeProbability ?? 0.5;
  return Math.round(lo + (hi - lo) * prob);
}

/**
 * Decide whether to strobe using atmosphere-aware probability.
 * Falls back to section-based rules if strobeProbability is not provided.
 */
function shouldStrobe(section: string, strobeInput: boolean, strobeProbability?: number): boolean {
  const key = section.toLowerCase();

  // Atmosphere-aware: use probability if provided
  if (strobeProbability !== undefined) {
    if (strobeProbability <= 0.1) return false;
    if (strobeProbability >= 0.8) return true;
    // For mid-range probabilities, combine with section context
    if (STROBE_DISABLED_SECTIONS.has(key)) return strobeProbability > 0.5;
    if (key === 'drop') return true; // drop always strobes
    if (key === 'chorus') return strobeProbability > 0.3;
    return strobeProbability > 0.4;
  }

  // Legacy section-based rules
  if (STROBE_DISABLED_SECTIONS.has(key)) return false;
  if (key === 'drop') return true;
  if (key === 'chorus') return strobeInput;
  return strobeInput;
}

// ─── Gobo helpers ──────────────────────────────────────────────

const BEAT_INTERVAL = 0.5;

function getGoboValue(
  goboCaps: DmxFixtureCapability[],
  time: number,
  colorShiftSpeed?: number,
): number {
  if (goboCaps.length === 0) return 0;
  // Color shift speed accelerates gobo rotation
  const speed = 1 + (colorShiftSpeed ?? 0.5) * 3; // 1x-4x speed
  const beat = Math.floor(time * speed / BEAT_INTERVAL);
  const idx = beat % goboCaps.length;
  const cap = goboCaps[idx];
  return Math.round((cap.min + cap.max) / 2);
}

// ─── Color helpers ─────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function colorDistance(hex1: string, hex2: string): number {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}

/**
 * Apply color temperature shift to warm/cool a color.
 * warm: boost red, reduce blue
 * cool: boost blue, reduce red
 */
function applyColorTemp(rgb: [number, number, number], colorTemp?: 'warm' | 'neutral' | 'cool'): [number, number, number] {
  if (!colorTemp || colorTemp === 'neutral') return rgb;
  const TRIM = Math.floor;
  if (colorTemp === 'warm') {
    return [
      TRIM(Math.min(255, rgb[0] * 1.2)),
      TRIM(Math.max(0, rgb[1] * 0.9)),
      TRIM(Math.max(0, rgb[2] * 0.6)),
    ];
  }
  // cool
  return [
    TRIM(Math.max(0, rgb[0] * 0.7)),
    TRIM(Math.min(255, rgb[1] * 1.05)),
    TRIM(Math.min(255, rgb[2] * 1.3)),
  ];
}

/** Classify an RGB color into a named category */
function classifyColor(r: number, g: number, b: number): string {
  if (r > 200 && g > 200 && b > 200) return 'white';
  if (r < 40 && g < 40 && b < 40) return 'black';
  // Dominant channel determines category
  const max = Math.max(r, g, b);
  if (max === r) {
    if (g > b * 1.5) return 'yellow';
    if (b > g * 1.5) return 'magenta';
    if (r > g * 2 && r > b * 2) return 'red';
    return 'orange';
  }
  if (max === g) {
    if (r > b * 1.5) return 'yellow';
    return 'green';
  }
  if (max === b) {
    if (r > g * 1.5) return 'magenta';
    if (r > g * 0.6) return 'purple';
    return 'blue';
  }
  return 'white';
}

/** Score how well a capability name matches a target color category */
function colorNameMatchScore(capName: string, targetCat: string): number {
  const n = capName.toLowerCase().trim();
  const exact: Record<string, string[]> = {
    red: ['red', 'rouge'], green: ['green', 'vert'], blue: ['blue', 'bleu'],
    white: ['white', 'blanc', 'open', 'ouvert'], yellow: ['yellow', 'jaune'],
    magenta: ['magenta'], cyan: ['cyan'], orange: ['orange'],
    purple: ['purple', 'violet', 'pourpre', 'uv', 'lavender', 'mauve'],
    pink: ['pink', 'rose'], amber: ['amber', 'ambre'],
  };
  const keywords = exact[targetCat] || [targetCat];
  for (const kw of keywords) {
    if (n === kw) return 10;        // exact match
    if (n.startsWith(kw + ' ')) return 8;  // "Red something"
    if (n.includes(kw)) return 5;   // contains keyword
  }
  return 0;
}

// Section-aware absolute minimum DMX intensity.
// Lower values for dynamic sections (drop, build, outro) to allow more dramatic contrast,
// higher values for stable sections (chorus, verse) to maintain energy.
// Values are DMX 0-255 (≈% of full: 60≈23%, 128≈50%, 179≈70%).
const SECTION_MIN_INTENSITY: Record<string, number> = {
  intro: 70, // garder une lumière douce en début de morceau
  verse: 45, // énergie modérée pour les couplets
  chorus: 80, // plein énergie pour le refrain
  bridge: 40, // contraste pour le pont
  drop: 25, // très dramatique, presque coupé
  build: 35, // montée progressive
  outro: 45 // fin en douceur
};

// Safe shutter-open value: 255 is universally open on >95% of fixtures.



const SHUTTER_OPEN_SAFE = 255;

/**
 * Valeur « strobe off » pour un canal Strobe dédié (strobeOffset) :
 * - si le canal a des caps, la cap Open / No function / No effect (capMid) ;
 * - sinon 0 (off par défaut sur les bee-eye/flower).
 * Jamais 255 (sur un canal Strobe, 255 = strobe max permanent).
 */
function strobeOffValue(caps: DmxFixtureCapability[] | null | undefined): number {
  if (caps && caps.length > 0) {
    const open = caps.find((c) => /open|no function|no.?effect|neutral|steady/i.test(c.name ?? ''));
    if (open) return Math.round((open.min + open.max) / 2);
    const first = caps[0];
    if (first.min === 0 && first.max < 64) return Math.round((first.min + first.max) / 2);
  }
  return 0;
}

// ── Exploitation laser (beat-sync) ────────────────────────────
const LASER_PATTERN_BEATS = 8; // un motif toutes les 8 beats (2 bars)
const LASER_SCAN_BEATS = 4; // période du balayage X/Y (1 bar)
const LASER_COLOR_BARS = 2; // un cran de roue couleur toutes les 2 bars
const LASER_ROT_BEATS = 16; // période de base des rotations (lente)

// SoundSwitch: map intensity level + energy -> DMX value within level range
function mapIntensity(level: string, energy: number, section?: string): number {
  if (level === 'dynamic') {
    // Floor section-aware: utiliser SECTION_MIN_INTENSITY si une section est fournie
    const sectionMin = section ? (SECTION_MIN_INTENSITY[section.toLowerCase()] ?? 60) : 60;
    return Math.round(Math.max(sectionMin, 20 + energy * 235));
  }
  let lo: number, hi: number;
  switch (level) {
    case 'very-low': lo = 60; hi = 100; break;
    case 'low': lo = 100; hi = 150; break;
    case 'medium': lo = 150; hi = 200; break;
    case 'high': lo = 200; hi = 235; break;
    case 'very-high': lo = 235; hi = 255; break;
    default: lo = 120; hi = 200; break;
  }
  const clamped = Math.max(0, Math.min(1, energy));
  // Floor section-aware: utiliser SECTION_MIN_INTENSITY si une section est fournie
  const sectionMin = section ? (SECTION_MIN_INTENSITY[section.toLowerCase()] ?? 60) : 60;
  return Math.round(Math.max(sectionMin, lo + clamped * (hi - lo)));
}
export interface TierMultipliers {
  primary: number;    // 0-100 percentage
  secondary: number;  // 0-100 percentage
  tertiary: number;   // 0-100 percentage
  other?: number;     // 0-100 percentage (optional)
}

function getTierIntensityMultiplier(tier: FixtureTier, overrides?: TierMultipliers): number {
  if (overrides) {
    switch (tier) {
      case 'primary': return overrides.primary / 100;
      case 'secondary': return overrides.secondary / 100;
      case 'tertiary': return overrides.tertiary / 100;
    }
  }
  switch (tier) {
    case 'primary': return 1.0;
    case 'secondary': return 0.7;
    case 'tertiary': return 0.4;
    default: return 1.0;
  }
}

function getTierMovementMultiplier(tier: FixtureTier): number {
  switch (tier) {
    case 'primary': return 1.0;
    case 'secondary': return 0.8;
    case 'tertiary': return 0.5;
    case 'other': return 0.4;
    default: return 1.0;
  }
}

function shouldTierStrobe(tier: FixtureTier): boolean {
  return tier === 'primary';
}

function getTierColorIndex(tier: FixtureTier, paletteIndex: number, paletteLength: number): number {
  switch (tier) {
    case 'primary':
      return paletteIndex % paletteLength;
    case 'secondary':
      return paletteIndex % Math.min(2, paletteLength);
    case 'tertiary':
      return 0;
    default:
      return paletteIndex % paletteLength;
  }
}

// ─── Options ───────────────────────────────────────────────────

export interface ComputeDmxCuesOptions {
  cues: CueInput[];
  patchedFixtures: PatchedFixture[];
  fixtureDefs: Map<string, DmxFixtureDefinition>;
  strobeLimit?: number;
  fixtureGroups?: FixtureGroup[];
  tierMultipliers?: TierMultipliers;
  /** Ordered universe IDs from the DMX store (dmx.universes).
   *  Must match Stage3D's universeIndexMap ordering so DMX writes land in the correct slot. */
  universeIds?: string[];
}

// ─── Channel analysis (delegated to fixture-analyzer.ts) ──────────────────
// FixtureChannelAnalysis is now imported from ../engine/fixture-analyzer
// analyzeFixture is now imported from ../engine/fixture-analyzer

// ─── Main compute ──────────────────────────────────────────────

export function computeDmxCues(options: ComputeDmxCuesOptions): DmxCue[] {
  const { cues, patchedFixtures, fixtureDefs, strobeLimit = 10, fixtureGroups = [], tierMultipliers } = options;
  if (cues.length === 0 || patchedFixtures.length === 0) return [];









  const groupMap = new Map<string, FixtureGroup>();
  for (const g of fixtureGroups) {
    groupMap.set(g.id, g);
  }
  const patchedIds = new Set(patchedFixtures.map((f) => f.id));

  // Use shared universe ordering when provided (matches Stage3D universeIndexMap).
  // Otherwise fall back to deriving from patched fixtures (single-universe case still works).
  const universeOrder: string[] = options.universeIds && options.universeIds.length > 0
    ? options.universeIds
    : (() => {
        const order: string[] = [];
        for (const pf of patchedFixtures) {
          if (!order.includes(pf.universeId)) {
            order.push(pf.universeId);
          }
        }
        return order;
      })();

  const analyses = patchedFixtures.map(pf => {
    const def = fixtureDefs.get(pf.fixtureDefId);
    const fa = analyzeFixture(pf, def);
    fa.universeIndex = universeOrder.indexOf(pf.universeId);
    return fa;
  });

  const dmxCues: DmxCue[] = [];

  const fixturesByUniverse = new Map<number, FixtureChannelAnalysis[]>();
  for (const fa of analyses) {
    const list = fixturesByUniverse.get(fa.universeIndex) ?? [];
    list.push(fa);
    fixturesByUniverse.set(fa.universeIndex, list);
  }

  // ─── Diagnostic: track first cue per section ───


  let cueIndex = 0;
  for (const cue of cues) {
    // ── NEW: Atmosphere-aware parameters ──────────────
    const movementConfig = getMovementConfig(cue.section, cue.movement, cue.movementAmplitude, cue.movementSpeed);
    const enableStrobe = shouldStrobe(cue.section, cue.strobe, cue.strobeProbability);
    const strobeRate = enableStrobe ? getStrobeRate(cue.section, cue.strobeProbability) : 0;
    const isDrop = cue.section.toLowerCase() === 'drop';
    const isChorus = cue.section.toLowerCase() === 'chorus';
    const sectionKey = cue.section.toLowerCase();
    // Derive energy from cue.energy (continuous from audio analysis) or fall back to string label
    const energy = cue.energy != null
      ? cue.energy  // continuous 0-1 from audio energyCurve
      : cue.intensity === 'very-high' ? 0.95
      : cue.intensity === 'high' ? 0.8
      : cue.intensity === 'medium' ? 0.5
      : cue.intensity === 'low' ? 0.25
      : cue.intensity === 'very-low' ? 0.1
      : isDrop ? 1.0 : isChorus ? 0.8
      : sectionKey === 'bridge' ? 0.6 : 0.4;

    const useDimmerPulse = cue.dimmerPulseOnBeat ?? (isDrop);

    for (const [universe, fixtureList] of fixturesByUniverse) {
      let activeList = fixtureList;
      if (cue.group) {
        if (cue.group.startsWith('tier:')) {
          const tier = cue.group.slice(5) as FixtureTier;
          activeList = fixtureList.filter((fa) => fa.fixture.tier === tier);
        } else {
          const group = groupMap.get(cue.group);
          if (group) {
            const groupFixtureIds = new Set(group.fixtureIds.filter((fid) => patchedIds.has(fid)));
            activeList = fixtureList.filter((fa) => groupFixtureIds.has(fa.fixture.id));
          }
        }
      }
      if (activeList.length === 0) continue;

      const channelValues: Record<number, number> = {};
      const fixtureNames: string[] = [];
      const allColors: string[] = [...cue.colors];















      const totalFixtures = activeList.length;

      for (let fi = 0; fi < activeList.length; fi++) {
        const fa = activeList[fi];
        const pf = fa.fixture;

        // ── 1. Intensity (HTP) - tier-scaled, dimmer-pulse aware ──
        // SoundSwitch principle: EVERY patched fixture ALWAYS gets dimmer >= absolute minimum.
        // Sections differ by movement pattern and strobe, NOT by going dark.
        let computedIntensity = 0;
        {
          let val = mapIntensity(cue.intensity, energy, cue.section);

          // Dimmer pulse: alternate high/low or use beat-synced pump
          if (useDimmerPulse) {
            const sec = cue.section.toLowerCase();
            const bpm = Math.max(60, Math.min(200, (options as any)?.bpm ?? 120));
            // Gentle BPM-synced LFO: all sections get subtle breathing
            if (sec === 'drop' || sec === 'chorus') {
              val = Math.round(val * (0.7 + 0.3 * Math.abs(Math.sin(cue.time * Math.PI * 2 / (60 / bpm)))));
            } else if (cue.dimmerPulseOnBeat) {
              val = Math.round(val * (0.6 + 0.4 * Math.abs(Math.sin(cue.time * Math.PI * 2 / (60 / bpm)))));
            } else {
              val = Math.round(val * (0.85 + 0.15 * Math.sin(cue.time * Math.PI * 2 / (60 / bpm) * 0.5)));
            }
          }

val = Math.round(val * getTierIntensityMultiplier(pf.tier, tierMultipliers));
// Section-aware floor: each section has its own minimum intensity for dramatic contrast
  const sectionMin = SECTION_MIN_INTENSITY[cue.section.toLowerCase()] ?? 60;
  val = Math.max(val, sectionMin);
  computedIntensity = val;
        }

        if (fa.intensityOffset !== null) {
          const dmxAddr = pf.startAddress + fa.intensityOffset;
          if (!channelValues[dmxAddr] || computedIntensity > channelValues[dmxAddr]) {
            channelValues[dmxAddr] = computedIntensity;

          }
        }

        // -- 2. Colour - section-stable palette rotation (SoundSwitch-style) --
        // SoundSwitch-style: color rotates slowly WITHIN section, not per-cue
        const sectionColorShift = Math.floor(cueIndex / 8) % Math.max(1, cue.colors.length);
        // Tier-aware color offset: each tier gets a different palette position
        const tierColorOffset = pf.tier === 'secondary' ? Math.floor(cue.colors.length / 3)
          : pf.tier === 'tertiary' ? Math.floor(cue.colors.length * 2 / 3)
          : 0;
        const tierColorIdx = (getTierColorIndex(pf.tier, sectionColorShift + tierColorOffset, cue.colors.length)) % cue.colors.length;
        const paletteColor = cue.colors.length > 0
          ? cue.colors[tierColorIdx]
          : undefined;

        if (fa.rgbOffsets && paletteColor) {
          let [r, g, b] = hexToRgb(paletteColor);
          const rawRgb = [r, g, b];
          // Apply color temperature shift
          if (cue.colorTemp) {
            [r, g, b] = applyColorTemp([r, g, b], cue.colorTemp);
          }
          // Paire de couleurs laser (Red/Green Laser, type Shutter OFL) : ce
          // sont des GATES ouvert/fermé — 0-31 fermé, milieu = stroboscope.
          // Pas de scaling d'intensité, jamais de valeur intermédiaire.
          const laserGate = fa.isLaser && fa.laserColorMode === 'rgb' && fa.rgbSegments.length === 0;
          if (laserGate) {
            r = laserGateValue(r);
            g = laserGateValue(g);
            b = laserGateValue(b);
            // Palette non représentable (ex. bleue/violette sur un laser R/G) :
            // ouvrir R+G plutôt que d'éteindre le laser (« ça ne fait rien »).
            const pairClosed =
              (fa.rgbOffsets[0] !== undefined ? r === 0 : true) &&
              (fa.rgbOffsets[1] !== undefined ? g === 0 : true) &&
              (fa.rgbOffsets[2] !== undefined ? b === 0 : true);
            if (pairClosed && rawRgb.some((v) => v > 22)) {
              r = 255;
              g = 255;
            }
          } else if (fa.intensityOffset === null) {
            // Scale RGB by intensity when fixture has no master dimmer (wash/par without dedicated dimmer channel)
            const scale = computedIntensity / 255;
            r = Math.round(r * scale);
            g = Math.round(g * scale);
            b = Math.round(b * scale);
          }
          if (fa.rgbOffsets[0] !== undefined) channelValues[pf.startAddress + fa.rgbOffsets[0]] = r;
          if (fa.rgbOffsets[1] !== undefined) channelValues[pf.startAddress + fa.rgbOffsets[1]] = g;
          if (fa.rgbOffsets[2] !== undefined) channelValues[pf.startAddress + fa.rgbOffsets[2]] = b;
        } else if (fa.wheelOffset !== null && paletteColor) {
          let bestCap = fa.wheelCaps?.[0] ?? null;
          let bestDist = Infinity;
          if (fa.wheelCaps) {
            for (const cap of fa.wheelCaps) {
              if (!cap.color) continue;
              const d = colorDistance(paletteColor, cap.color);
              if (d < bestDist) {
                bestDist = d;
                bestCap = cap;
              }
            }
          }
          // Fallback: name-based matching for fixtures without hex color capabilities
          if ((!bestCap || bestDist === Infinity) && fa.wheelOffset !== null) {
            const def = fixtureDefs.get(pf.fixtureDefId);
            const mode = def?.modes[pf.modeIndex];
            const wheelChannel = mode?.channels.find(ch => (ch.offset ?? mode.channels.indexOf(ch)) === fa.wheelOffset);
            const rawCaps = wheelChannel?.capabilities;
            if (rawCaps && rawCaps.length > 0) {
              // Classify palette color into a category
              const [pr, pg, pb] = hexToRgb(paletteColor);
              const cat = classifyColor(pr, pg, pb); // 'red','green','blue','white','yellow','magenta','cyan','orange','purple'
              // Find matching cap by name
              let bestMatch: { cap: any; score: number } | null = null;
              for (const cap of rawCaps) {
                if (!cap.name) continue;
                const s = colorNameMatchScore(cap.name, cat);
                if (s > (bestMatch?.score ?? 0)) bestMatch = { cap, score: s };
              }
              if (bestMatch && bestMatch.score > 0) {
                bestCap = bestMatch.cap;
              } else {
                // No name match: cycle through wheel on beats
                const bpm = Math.max(60, Math.min(200, (options as any)?.bpm ?? 120));
                const beatInterval = 60 / bpm;
                const idx = Math.floor((cue.time ?? 0) / beatInterval) % rawCaps.length;
                bestCap = rawCaps[idx];
              }
            }
          }
          const wheelVal = bestCap
            ? Math.round((bestCap.min + bestCap.max) / 2)
            : 128;
          channelValues[pf.startAddress + fa.wheelOffset] = wheelVal;
        }

        // ── 2b. LED intensity channels: fixtures with individual LED dimmers (no RGB, no color wheel)
        // Use section-stable base colors with minimal BPM-synced wave for organic feel
        if (!fa.rgbOffsets && fa.wheelOffset === null && fa.ledIntensityOffsets.length > 0) {
          const numLeds = fa.ledIntensityOffsets.length;
          let ledSectionHash = 0;
          for (let s = 0; s < sectionKey.length; s++) ledSectionHash = ((ledSectionHash << 5) - ledSectionHash) + sectionKey.charCodeAt(s);
          const ledBpm = Math.max(60, Math.min(200, (options as any)?.bpm ?? 120));
          // Minimal wave: ±6% amplitude, staggered per LED for subtle motion
          const ledWave = (ledIdx: number) => 0.94 + 0.06 * Math.sin(cue.time * Math.PI * 2 / (60 / ledBpm) * 0.5 + ledIdx * 0.8);
          for (let li = 0; li < numLeds; li++) {
            const colorIdx = cue.colors.length > 0
              ? Math.abs(ledSectionHash + li) % cue.colors.length
              : 0;
            const ledColor = cue.colors.length > 0 ? cue.colors[colorIdx] : '#ffffff';
            const [lr, lg, lb] = hexToRgb(ledColor);
            // Higher base brightness: 0.6 floor + 0.4 * brightness factor
            let ledVal = Math.round(computedIntensity * (0.6 + 0.4 * ((lr + lg + lb) / (3 * 255))));
            ledVal = Math.round(ledVal * ledWave(li));
            channelValues[pf.startAddress + fa.ledIntensityOffsets[li]] = Math.max(64, Math.min(255, ledVal));
          }
        }

        // -- 2c. Effect channel fallback: only for fixtures with effect channel but NO effect caps
        // (fixtures with effectCaps are handled by section 7 below)
        if (!fa.rgbOffsets && fa.wheelOffset === null && fa.effectOffset !== null && (!fa.effectCaps || fa.effectCaps.length === 0)) {
          const effectVal = 8 + ((cueIndex % 24) * 10);
          channelValues[pf.startAddress + fa.effectOffset] = Math.min(255, effectVal);
        }

        // Canal Strobe dédié (strobeOffset) : PAS un shutter — il ne contrôle
        // PAS la luminosité (pas de mapping intensity→shutter ici).
        // Off = valeur de la cap Open/No function si connue, sinon 0. Jamais
        // SHUTTER_OPEN_SAFE=255 : sur un canal Strobe, 255 = strobe max PERMANENT.
        if (fa.strobeOffset !== null) {
          const strobeAddr = pf.startAddress + fa.strobeOffset;
          channelValues[strobeAddr] = (enableStrobe && shouldTierStrobe(pf.tier))
            ? strobeRate
            : strobeOffValue(fa.strobeCaps);
        }

        // Always set the shutter when available: open when not strobing (DMX 8-15 = shutter open),
        // otherwise fixture stays dark even with dimmer > 0 because shutter defaults to 0 (closed).
        // For fixtures lacking a dedicated Intensity channel, use the shutter channel
        // to also control brightness (common on budget moving heads / spiders).
        if (fa.shutterOffset !== null) {
          const shutterAddr = pf.startAddress + fa.shutterOffset;
          if (enableStrobe && shouldTierStrobe(pf.tier)) {
            channelValues[shutterAddr] = strobeRate;
          } else if (fa.intensityOffset === null && computedIntensity > 0) {
            // No dedicated dimmer → map intensity to shutter range (8 = open min, 255 = open max)
            // Linear mapping: intensity 0-255 → shutter 8-255
            const shutterVal = 8 + Math.round((computedIntensity / 255) * 247);
            channelValues[shutterAddr] = Math.max(8, Math.min(255, shutterVal));
          } else {
            // SoundSwitch principle: shutter ALWAYS open, never dark.
            // 32 = safe open on all fixtures (avoids 0-15 ambiguous range).
            channelValues[shutterAddr] = SHUTTER_OPEN_SAFE;
          }

        }

        // ── 4. Pan/Tilt - choreography engine (tier-scaled) ──
        const tierMovMult = getTierMovementMultiplier(pf.tier);
        if (tierMovMult > 0 && (fa.panOffset !== null || fa.tiltOffset !== null)) {
          const movement = computeMovement(
            movementConfig,
            cue.time,
            fi,
            totalFixtures,
          );
          // Tilt-only fixtures (no pan channel): route pan movement to tilt for full sweep
          const isTiltOnly = fa.panOffset === null && fa.tiltOffset !== null;
          if (fa.panOffset !== null) {
            const centerX = movementConfig.centerX;
            const pan = Math.round(centerX + (movement.pan - centerX) * tierMovMult);
            for (const po of fa.panOffsets.length > 0 ? fa.panOffsets : [fa.panOffset]) {
              channelValues[pf.startAddress + po] = Math.max(0, Math.min(255, pan));
            }
            if (fa.panFineOffset !== null) {
              channelValues[pf.startAddress + fa.panFineOffset] = pan;
            }
          }
          if (fa.tiltOffset !== null) {
            const centerY = movementConfig.centerY;
            let tilt: number;
            if (isTiltOnly) {
              // Tilt-only fixtures (no pan): use whichever axis has more motion
              const panDelta = movement.pan - centerY;
              const tiltDelta = movement.tilt - centerY;
              const bestDelta = Math.abs(panDelta) > Math.abs(tiltDelta) ? panDelta : tiltDelta;
              // Boost ×2: single-axis fixtures need larger sweep for visible movement
              tilt = Math.round(centerY + bestDelta * tierMovMult * 2.0);
            } else {
              tilt = Math.round(centerY + (movement.tilt - centerY) * tierMovMult);
            }
            const tiltOffs = fa.tiltOffsets.length > 0 ? fa.tiltOffsets : [fa.tiltOffset];
            for (const to of tiltOffs) {
              channelValues[pf.startAddress + to] = Math.max(0, Math.min(255, tilt));
            }
            if (fa.tiltFineOffset !== null) {
              channelValues[pf.startAddress + fa.tiltFineOffset] = tilt;
            }
          } else if (fa.tiltFineOffset !== null) {
            channelValues[pf.startAddress + fa.tiltFineOffset] = 128;
          }
        }

        // ── 5. Gobo - rotate on beat boundaries, speed-aware ──
        if (fa.goboOffset !== null && fa.goboCaps && fa.goboCaps.length > 0) {
          const goboVal = getGoboValue(
            fa.goboCaps,
            isDrop ? cue.time * 2 : cue.time,
            cue.colorShiftSpeed,
          );
          channelValues[pf.startAddress + fa.goboOffset] = goboVal;
        }

        // ── 6. Prism - active on drops/chorus, rotate synced to beat ──
        if (fa.prismOffset !== null && (isDrop || isChorus)) {
          // Rotate prism on beat: cycle between prism insert + rotation
          const beatPhase = Math.floor(cue.time * 4) % 4;
          channelValues[pf.startAddress + fa.prismOffset] = beatPhase === 0 ? 255 : (beatPhase === 2 ? 128 : 0);
        }

        // ── 7. Effect macros - cycle through built-in fixture effects by section ──
        if (fa.effectOffset !== null && fa.effectCaps && fa.effectCaps.length > 0) {
          const caps = fa.effectCaps;
          // Filter out "No Effect" caps (min=0) to avoid killing light output
          const activeCaps = caps.filter(c => c.min > 0);
          if (activeCaps.length === 0) activeCaps.push(...caps);
          // Stable effect: use section type for consistent assignment (not 0 = no effect)
          let effIdx: number;
          let effSectionHash = 0;
          for (let s = 0; s < sectionKey.length; s++) effSectionHash = ((effSectionHash << 5) - effSectionHash) + sectionKey.charCodeAt(s);
          if (isDrop) effIdx = Math.floor(cue.time * 2) % activeCaps.length;
          else if (isChorus) effIdx = (Math.floor(cue.time * 0.5) + Math.abs(effSectionHash)) % activeCaps.length;
          else if (sectionKey === 'bridge') effIdx = Math.floor(cue.time * 0.3) % Math.min(3, activeCaps.length);
          else effIdx = Math.abs(effSectionHash) % activeCaps.length;
          const cap = activeCaps[effIdx];
          const effVal = cap ? Math.round((cap.min + cap.max) / 2) : 128;
          if (effVal >= 8) channelValues[pf.startAddress + fa.effectOffset] = effVal;
        }

        // ── 8. Beam - zoom/focus variation by section energy ──
        if (fa.beamOffset !== null) {
          // Wide beam on chorus/drop (high value), narrow on verse (low value)
          const beamVal = isDrop || isChorus ? 200 + Math.round(energy * 55)
            : sectionKey === 'bridge' ? 128 + Math.round(energy * 40)
            : 60 + Math.round(energy * 30);
          channelValues[pf.startAddress + fa.beamOffset] = Math.max(0, Math.min(255, beamVal));
        }

        // ── 9. Speed - vary pan/tilt & effect speed by section ──
        if (fa.speedOffset !== null) {
          const speedVal = isDrop ? 220 + Math.round(energy * 35)
            : isChorus ? 180 + Math.round(energy * 40)
            : sectionKey === 'bridge' ? 100 + Math.round(energy * 60)
            : 40 + Math.round(energy * 40);
          channelValues[pf.startAddress + fa.speedOffset] = Math.max(0, Math.min(255, speedVal));
        }

        // ── 7b. Laser exploitation - jamais statique, jamais synchrone ──
        if (fa.isLaser) {
          const bpm = Math.max(60, Math.min(200, (options as any)?.bpm ?? 120));
          const beat = (cue.time ?? 0) * bpm / 60;
          // Déphasage par fixture via l'adresse de départ : stable dans le
          // temps, décolle les lasers jumeaux (plus de superposition).
          const laserPhase = ((pf.startAddress % 16) / 16) * 2 * Math.PI;
          // Un tiers des lasers évolue en Lissajous (figure-8) : variété de
          // trajectoires au lieu d'un cercle unique.
          const lissajous = pf.startAddress % 3 === 2;

          // (a) Mode : toujours un mode pilotable en DMX (jamais sound/off).
          if (fa.laserModeOffset !== null) {
            channelValues[pf.startAddress + fa.laserModeOffset] = capMid(pickLaserModeCap(fa.laserModeCaps));
          }

          // (b) Pattern : cycle un motif toutes les LASER_PATTERN_BEATS beats.
          if (fa.patternOffset !== null && fa.patternCaps.length > 0) {
            const idx = Math.floor(beat / LASER_PATTERN_BEATS) % fa.patternCaps.length;
            channelValues[pf.startAddress + fa.patternOffset] = capMid(fa.patternCaps[idx]);
          }

          // (c) Scan X/Y : cercle ou Lissajous, phase par fixture.
          if (fa.scanXOffset !== null) {
            channelValues[pf.startAddress + fa.scanXOffset] = 128 + Math.round(90 * Math.sin(2 * Math.PI * beat / LASER_SCAN_BEATS + laserPhase));
          }
          if (fa.scanYOffset !== null) {
            const yv = lissajous
              ? Math.sin(2 * 2 * Math.PI * beat / LASER_SCAN_BEATS + laserPhase)
              : Math.cos(2 * Math.PI * beat / LASER_SCAN_BEATS + laserPhase);
            channelValues[pf.startAddress + fa.scanYOffset] = 128 + Math.round(90 * yv);
          }

          // (d) Roue couleur : cycle uniquement si aucune couleur de palette
          // n'a déjà été écrite (évite de contredire le matching de la section 2).
          if (fa.laserColorMode === 'wheel' && fa.wheelOffset !== null && fa.wheelCaps.length > 0
              && channelValues[pf.startAddress + fa.wheelOffset] === undefined) {
            const idx = Math.floor(beat / (LASER_COLOR_BARS * 4)) % fa.wheelCaps.length;
            channelValues[pf.startAddress + fa.wheelOffset] = capMid(fa.wheelCaps[idx]);
          }

          // (e) Vitesses + rotations : oscillent, déphasées par fixture.
          if (fa.laserSpeedScanOffset !== null) {
            // Borné à 0-127 : au-delà, l'OFL IODA passe en « With gaps » (faisceau troué).
            channelValues[pf.startAddress + fa.laserSpeedScanOffset] = Math.min(127, 128 + Math.round(60 * Math.sin(2 * Math.PI * beat / LASER_SCAN_BEATS + laserPhase)));
          }
          if (fa.laserSpeedPatternOffset !== null) {
            channelValues[pf.startAddress + fa.laserSpeedPatternOffset] = 128 + Math.round(64 * Math.sin(2 * Math.PI * beat / LASER_ROT_BEATS));
          }
          fa.laserRotationOffsets.forEach((off, i) => {
            channelValues[pf.startAddress + off] = 128 + Math.round(70 * Math.sin(2 * Math.PI * beat / (LASER_ROT_BEATS * (i + 1)) + laserPhase));
          });

          // (f) Blanking : ouvert (jamais de blackout par défaut), gate strobe en drop.
          if (fa.blankOffset !== null) {
            channelValues[pf.startAddress + fa.blankOffset] = enableStrobe && isDrop ? 255 : 0;
          }

          // (g) Gates 2 canaux sans palette : ouvrir R+G — jamais « rien ».
          if (fa.rgbOffsets && fa.rgbSegments.length === 0 && channelValues[pf.startAddress + fa.rgbOffsets[0]] === undefined) {
            channelValues[pf.startAddress + fa.rgbOffsets[0]] = 255;
            if (fa.rgbOffsets[1] !== undefined) channelValues[pf.startAddress + fa.rgbOffsets[1]] = 255;
          }
        }

        // Safety net: set unrecognized channels to safe neutral (128)
        // Prevents fixtures from being stuck in bad states when channel types aren't detected.
        // Macro channels are excluded - they are user-configured only.
        // Lasers : 0 (off/neutre) au lieu de 128 — sur un laser, 128 = strobe ou
        // macro autonome (Galaxian R/G et Macros), jamais un état neutre.
        if (fa.channelCount > 0) {
          const macroSet = new Set(fa.macroOffsets);
          for (let c = 0; c < fa.channelCount; c++) {
            if (macroSet.has(c)) continue;
            if (fa.strobeOffset === c) continue; // écrit par le bloc strobe dédié (off/rate)
            const addr = pf.startAddress + c;
            if (channelValues[addr] === undefined) {
              channelValues[addr] = fa.isLaser ? 0 : 128;
            }
          }
        }

        fixtureNames.push(pf.name);
      }

      // ALWAYS ensure minimum DMX output - even if no fixture channels matched.
      // Every cue must produce at least dimmer=128 on all universe fixtures.
      if (activeList.length > 0 && Object.keys(channelValues).length === 0) {
        for (const fa of activeList) {
          const pf = fa.fixture;
          if (fa.intensityOffset !== null) {
            channelValues[pf.startAddress + fa.intensityOffset] = 128;
          } else if (fa.shutterOffset !== null) {
            channelValues[pf.startAddress + fa.shutterOffset] = SHUTTER_OPEN_SAFE;
          } else if (fa.strobeOffset !== null) {
            channelValues[pf.startAddress + fa.strobeOffset] = 0;
          }
        }
      }

      if (Object.keys(channelValues).length > 0) {










        dmxCues.push({
          time: cue.time,
          section: cue.section,
          universe,
          channelValues,
          fixtureNames: [...new Set(fixtureNames)],
          fixtureCount: activeList.length,
          effect: cue.effect,
          colors: allColors,
        });
      }
    }
    cueIndex++;
  }

  return dmxCues;
}


// ─── Fixture definition loader (async, with caching) ───────────

let _defCache: Map<string, DmxFixtureDefinition> | null = null;
let _defLoadPromise: Promise<Map<string, DmxFixtureDefinition>> | null = null;

export async function loadFixtureDefinitions(
  fixtureDefIds: string[],
): Promise<Map<string, DmxFixtureDefinition>> {
  const uniqueIds = [...new Set(fixtureDefIds)];

  // Check cache first
  if (_defCache) {
    const cachedIds = new Set(_defCache.keys());
    if (uniqueIds.every(id => cachedIds.has(id))) return _defCache;
  }

  // If a load is already in flight, wait for it then check again
  if (_defLoadPromise) {
    await _defLoadPromise;
    // After the in-flight load completes, check if all IDs are now cached
    if (_defCache) {
      const cachedIds = new Set(_defCache.keys());
      if (uniqueIds.every(id => cachedIds.has(id))) return _defCache;
    }
  }

  // Load only the IDs that aren't already cached
  const existingIds = new Set(_defCache?.keys() ?? []);
  const neededIds = uniqueIds.filter(id => !existingIds.has(id));

  if (neededIds.length === 0 && _defCache) return _defCache;

  _defLoadPromise = (async () => {
    const map = new Map<string, DmxFixtureDefinition>(_defCache ?? []);
    const api = typeof window !== 'undefined' ? (window as any).lightMaestro : null;

    for (const id of neededIds) {
      try {
        const def = api?.fixtures?.getDefinition
          ? await api.fixtures.getDefinition(id)
          : null;
        if (def) map.set(id, def as DmxFixtureDefinition);
      } catch {
        // Ignore
      }
    }

    _defCache = map;
    _defLoadPromise = null;
    return map;
  })();

  return _defLoadPromise;
}

export function clearFixtureDefCache(): void {
  _defCache = null;
  _defLoadPromise = null;
}
