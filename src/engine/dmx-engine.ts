/**
 * Unified DMX Engine — single source of truth for all DMX computation.
 *
 * Replaces duplicated logic across dmx-cues.ts and dmx-playback.ts.
 * Both computeDmxCues (waveform batch) and useDmxPlayback (real-time RAF)
 * delegate to this engine for per-fixture DMX value computation.
 *
 * Architecture:
 *   1. analyzeFixture() — one-time per-fixture channel analysis
 *   2. computeFixtureFrame() — per-fixture DMX values for a single time point
 *   3. computeDmxCues() — batch mode (used by waveform pre-render)
 *   4. useDmxPlayback — real-time mode with color fade EMA (thin wrapper)
 */

import type { PatchedFixture, FixtureGroup, FixtureTier, SavedEffect } from '../../stores/showStore';
import type {
  DmxFixtureDefinition,
  DmxFixtureCapability,
  DmxCue,
  CueInput,
} from '../../hooks/dmx-cues';

// ═══════════════════════════════════════ Types ═══════════════════════════════════

export interface ChannelAnalysis {
  fixture: PatchedFixture;
  universeIndex: number;
  channelCount: number;

  // Intensity
  intensityOffset: number | null;

  // RGB
  rgbSegments: Array<{ r: number; g: number; b: number; w: number | null }>;
  presetOverrideOffsets: number[];

  // Color wheel
  wheelOffset: number | null;
  wheelCaps: DmxFixtureCapability[];

  // Movement
  panOffsets: number[];
  tiltOffsets: number[];

  // Shutter
  shutterOffset: number | null;

  // Beam / FX channels
  goboOffset: number | null;
  goboCaps: DmxFixtureCapability[];
  prismOffset: number | null;
  zoomOffset: number | null;
  frostOffset: number | null;
  irisOffset: number | null;
  focusOffset: number | null;
}

export interface FrameInput {
  time: number;
  section: string;
  intensity: string;
  energy?: number;
  colors: string[];
  color?: string;
  forcedColor?: string;
  strobe: boolean;
  strobeProbability?: number;
  strobeSpeed?: number;
  forcedStrobe?: boolean;
  forcedDimmerVal?: number;
  forcedDimmerOverride?: number;
  colorTemp?: 'warm' | 'neutral' | 'cool';
  dimmerPulseOnBeat?: boolean;
  movement?: string;
  movementAmplitude?: number;
  movementSpeed?: number;
}

export interface FrameOutput {
  universe: number;
  channelValues: Record<number, number>;
}

export interface TierMultipliers {
  primary: number;
  secondary: number;
  tertiary: number;
  other?: number;
}

export interface EngineConfig {
  patchedFixtures: PatchedFixture[];
  fixtureDefs: Map<string, DmxFixtureDefinition>;
  universeIds: string[];
  tierMultipliers?: TierMultipliers;
  strobeLimit?: number;
  colorFadeMs?: number;
  disabledFixtures?: Set<string>;
  /** Fixture stage positions for pan/tilt stage clamping; keyed by fixture id */
  fixturePositions?: Record<string, { x: number; y: number }>;
}

// ═══════════════════════════════ Color Helpers ═══════════════════════════════════

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

export function colorDistance(hex1: string, hex2: string): number {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return Math.sqrt(2 * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + 3 * (b1 - b2) ** 2);
}

function classifyColor(r: number, g: number, b: number): string {
  if (r > 200 && g > 200 && b > 200) return 'white';
  if (r < 50 && g < 50 && b < 50) return 'black';
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

/** HSL hue rotation. Preserves saturation + lightness. */
export function applyHueShift([r, g, b]: [number, number, number], deg: number): [number, number, number] {
  if (deg === 0) return [r, g, b];
  const nr = r / 255, ng = g / 255, nb = b / 255;
  const mx = Math.max(nr, ng, nb), mn = Math.min(nr, ng, nb);
  const l = (mx + mn) / 2;
  if (mx === mn) return [r, g, b];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === nr) h = ((ng - nb) / d + (ng < nb ? 6 : 0)) * 60;
  else if (mx === ng) h = ((nb - nr) / d + 2) * 60;
  else h = ((nr - ng) / d + 4) * 60;
  h = (h + deg) % 360; if (h < 0) h += 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r2: number, g2: number, b2: number;
  if (h < 60) { r2 = c; g2 = x; b2 = 0; }
  else if (h < 120) { r2 = x; g2 = c; b2 = 0; }
  else if (h < 180) { r2 = 0; g2 = c; b2 = x; }
  else if (h < 240) { r2 = 0; g2 = x; b2 = c; }
  else if (h < 300) { r2 = x; g2 = 0; b2 = c; }
  else { r2 = c; g2 = 0; b2 = x; }
  return [Math.round((r2 + m) * 255), Math.round((g2 + m) * 255), Math.round((b2 + m) * 255)];
}

function matchCapName(capName: string, targetCat: string): number {
  if (!capName) return 0;
  const n = capName.toLowerCase().trim();
  const kw: Record<string, string[]> = {
    red: ['red', 'rouge', 'dark red', 'light red', 'deep red'],
    blue: ['blue', 'bleu', 'cyan', 'dark blue', 'light blue', 'sky blue'],
    green: ['green', 'vert', 'lime', 'dark green', 'light green'],
    yellow: ['yellow', 'jaune', 'amber', 'ambre', 'gold'],
    white: ['white', 'blanc', 'open', 'warm white', 'cold white', 'neutral white'],
    magenta: ['magenta', 'pink', 'rose', 'fuchsia'],
    cyan: ['cyan', 'turquoise', 'teal', 'aqua'],
    orange: ['orange'],
    purple: ['purple', 'violet', 'pourpre', 'uv', 'lavender', 'mauve', 'indigo'],
    pink: ['pink', 'rose', 'salmon'],
    amber: ['amber', 'ambre', 'gold'],
  };
  const k = kw[targetCat] || [targetCat];
  for (const kk of k) {
    const kl = kk.toLowerCase();
    if (n === kl) return 10;
    if (n.startsWith(kl + ' ')) return 9;
    if (n.includes(kl)) return 5;
  }
  return 0;
}

function findBestWheelCap(caps: DmxFixtureCapability[], paletteHex: string): DmxFixtureCapability | null {
  if (caps.length === 0) return null;
  const [r, g, b] = hexToRgb(paletteHex);
  const cat = classifyColor(r, g, b);
  // Step 1: name matching
  let bestName: { cap: DmxFixtureCapability; score: number } | null = null;
  for (const cap of caps) {
    if (!cap.name) continue;
    const s = matchCapName(cap.name, cat);
    if (s > (bestName?.score ?? 0)) bestName = { cap, score: s };
  }
  if (bestName && bestName.score >= 5) return bestName.cap;
  // Step 2: color distance
  let bestCap: DmxFixtureCapability | null = null;
  let bestDist = Infinity;
  for (const cap of caps) {
    if (cap.color) {
      const d = colorDistance(paletteHex, cap.color);
      if (d < bestDist) { bestDist = d; bestCap = cap; }
    }
  }
  if (bestCap && bestDist < 350) return bestCap;
  // Step 3: weak name match
  if (bestName && bestName.score > 0) return bestName.cap;
  // Step 4: category → wheel position
  const catMap: Record<string, number> = {
    red: 0.10, orange: 0.20, yellow: 0.30, green: 0.42,
    cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78,
    white: 0.02, black: 0.02,
  };
  const wheelPos = catMap[cat] ?? 0.5;
  return caps[Math.floor(wheelPos * caps.length) % caps.length];
}

// ═══════════════════════════ Channel Analysis ═════════════════════════════════════

interface RgbSegment { r: number; g: number; b: number; w: number | null; }

const startsWithRgb = /^(red|green|blue|r|g|b|rouge|vert|bleu|rojo|verde|azul)(\s*\(?\d*\)?)?$/i;
const hasColorWord = /\b(red|green|blue|white|amber|uv|laser|rouge|vert|bleu|blanc|ambre|rojo|verde|azul|blanco)\b/i;
const isRed = /\b(red|r|rouge|rojo)\b/i;
const isGreen = /\b(green|g|vert|verde)\b/i;
const isBlue = /\b(blue|b|bleu|azul)\b/i;
const isWhite = /\b(white|w|blanc|blanco)\b/i;
const isPresetMode = /presets?|macro|auto|sound/i;

function buildRgbSegments(colourChannels: Array<{ offset: number; name: string }>): RgbSegment[] {
  const segments: RgbSegment[] = [];
  const used = new Set<number>();
  for (let i = 0; i < colourChannels.length; i++) {
    if (used.has(i)) continue;
    let ri = -1; for (let j = 0; j < colourChannels.length; j++) { if (!used.has(j) && isRed.test(colourChannels[j].name)) { ri = j; break; } }
    if (ri < 0) continue;
    let gi = -1; for (let j = 0; j < colourChannels.length; j++) { if (!used.has(j) && j !== ri && isGreen.test(colourChannels[j].name)) { gi = j; break; } }
    if (gi < 0) continue;
    let bi = -1; for (let j = 0; j < colourChannels.length; j++) { if (!used.has(j) && j !== ri && j !== gi && isBlue.test(colourChannels[j].name)) { bi = j; break; } }
    if (bi < 0) continue;
    let wi = -1; for (let j = 0; j < colourChannels.length; j++) { if (!used.has(j) && j !== ri && j !== gi && j !== bi && isWhite.test(colourChannels[j].name)) { wi = j; break; } }
    used.add(ri); used.add(gi); used.add(bi);
    if (wi >= 0) used.add(wi);
    segments.push({ r: colourChannels[ri].offset, g: colourChannels[gi].offset, b: colourChannels[bi].offset, w: wi >= 0 ? colourChannels[wi].offset : null });
  }
  return segments;
}

export function analyzeFixture(
  pf: PatchedFixture,
  def: DmxFixtureDefinition | undefined,
  uniIds: string[],
): ChannelAnalysis {
  const channels = def?.modes[pf.modeIndex]?.channels ?? [];
  const uniIdx = uniIds.indexOf(pf.universeId);

  const fa: ChannelAnalysis = {
    fixture: pf,
    universeIndex: uniIdx >= 0 ? uniIdx : 0,
    channelCount: channels.length,
    intensityOffset: null,
    rgbSegments: [],
    presetOverrideOffsets: [],
    wheelOffset: null,
    wheelCaps: [],
    panOffsets: [],
    tiltOffsets: [],
    shutterOffset: null,
    goboOffset: null,
    goboCaps: [],
    prismOffset: null,
    zoomOffset: null,
    frostOffset: null,
    irisOffset: null,
    focusOffset: null,
  };

  const colourChannels: Array<{ offset: number; name: string; caps?: DmxFixtureCapability[] }> = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const off = ch.offset ?? i;
    const chName = (ch.name?.trim() ?? '');

    // Preset/Macro channels for override (must be 0 for raw RGB)
    if (isPresetMode.test(chName)) {
      fa.presetOverrideOffsets.push(off);
      continue;
    }

    // Color channels
    if (startsWithRgb.test(chName) || ch.type === 'Colour' || (ch.type === 'Beam' && hasColorWord.test(chName))) {
      colourChannels.push({ offset: off, name: chName, caps: ch.capabilities });
      continue;
    }

    switch (ch.type) {
      case 'Intensity':
        if (fa.intensityOffset === null) fa.intensityOffset = off;
        break;
      case 'Shutter':
      case 'Effect':
        if (fa.shutterOffset === null) fa.shutterOffset = off;
        break;
      case 'Pan':
        fa.panOffsets.push(off);
        break;
      case 'Tilt':
        fa.tiltOffsets.push(off);
        break;
      case 'Gobo':
        if (fa.goboOffset === null) { fa.goboOffset = off; fa.goboCaps = ch.capabilities ?? []; }
        break;
      case 'Prism':
        if (fa.prismOffset === null) fa.prismOffset = off;
        break;
      case 'Zoom':
        if (fa.zoomOffset === null) fa.zoomOffset = off;
        break;
      case 'Frost':
      case 'Focus':
        if (fa.frostOffset === null) fa.frostOffset = off;
        break;
      case 'Iris':
        if (fa.irisOffset === null) fa.irisOffset = off;
        break;
    }
  }

  // Build RGB segments from detected colour channels
  if (colourChannels.length > 0) {
    const hasRgbStart = colourChannels.some(c => startsWithRgb.test(c.name));
    const hasRgbWords = colourChannels.some(c => isRed.test(c.name)) &&
      colourChannels.some(c => isGreen.test(c.name)) &&
      colourChannels.some(c => isBlue.test(c.name));
    const hasRgbNames = (hasRgbStart || hasRgbWords) && colourChannels.length >= 3;
    const hasColorCaps = colourChannels.some(c => c.caps?.some(cap => cap.color));

    if (hasRgbNames) {
      fa.rgbSegments = buildRgbSegments(colourChannels);
    } else if (hasColorCaps) {
      const wheel = colourChannels.find(c => c.caps?.some(cap => cap.color));
      if (wheel) { fa.wheelOffset = wheel.offset; fa.wheelCaps = wheel.caps ?? []; }
    } else if (colourChannels.length >= 3) {
      fa.rgbSegments = buildRgbSegments(colourChannels);
    } else {
      fa.wheelOffset = colourChannels[0].offset;
      const ch = channels.find(c => (c.offset ?? channels.indexOf(c)) === colourChannels[0].offset);
      if (ch?.capabilities && ch.capabilities.length > 0) fa.wheelCaps = ch.capabilities;
    }
  }

  if (fa.wheelOffset !== null && fa.wheelCaps.length === 0) {
    const ch = channels.find(c => (c.offset ?? channels.indexOf(c)) === fa.wheelOffset);
    if (ch?.capabilities && ch.capabilities.length > 0) fa.wheelCaps = ch.capabilities;
  }

  return fa;
}

// ═══════════════════════════ Tier Helpers ═══════════════════════════════

const TIER_HUE: Record<FixtureTier, number> = { primary: 0, secondary: 120, tertiary: 120, other: 0 };

function getTierIntensityMult(tier: FixtureTier, overrides?: TierMultipliers): number {
  if (overrides) {
    if (tier === 'primary') return overrides.primary / 100;
    if (tier === 'secondary') return overrides.secondary / 100;
    if (tier === 'tertiary') return overrides.tertiary / 100;
  }
  if (tier === 'primary') return 1.0;
  if (tier === 'secondary') return 0.7;
  if (tier === 'tertiary') return 0.4;
  return 1.0;
}

function getTierMovAmp(tier: FixtureTier): number {
  if (tier === 'primary') return 1.0;
  if (tier === 'secondary') return 0.8;
  if (tier === 'tertiary') return 0.5;
  if (tier === 'other') return 0.4;
  return 1.0;
}

// ═══════════════════════════ Movement Engine ═══════════════════════════════════

/**
 * Clamp pan/tilt DMX values to keep beams on stage based on fixture position.
 * - Fixtures on left edge (X=0) can only pan right → prevents pointing off stage left
 * - Fixtures on right edge (X=1) can only pan left → prevents pointing off stage right
 * - Fixtures at back (Y=0) can only tilt forward → prevents pointing at back wall
 * - Fixtures at front (Y=1) can tilt freely in both directions
 */
function clampPanToStage(panDmx: number, fixtureX: number): number {
  const panFromCenter = panDmx - 128; // negative = left, positive = right
  // Max pan left: proportional to how far right the fixture is (X=0 → 0 left, X=1 → full left)
  const maxLeft = Math.round(fixtureX * 128);
  // Max pan right: proportional to how far left the fixture is (X=0 → full right, X=1 → 0)
  const maxRight = Math.round((1 - fixtureX) * 128);
  const clamped = Math.max(-maxLeft, Math.min(maxRight, panFromCenter));
  return 128 + clamped;
}

function clampTiltToStage(tiltDmx: number, fixtureY: number): number {
  const tiltFromCenter = tiltDmx - 128; // negative = up/back, positive = down/forward
  // Max tilt back (negative): full at center, limited at back (Y=0 → 0 back)
  const maxBack = Math.round(Math.max(0.2, fixtureY) * 128); // minimum 20% to avoid total freeze
  // Max tilt forward (positive): full at center, full at front
  const maxForward = Math.round(Math.min(1, fixtureY + 0.3) * 128); // generous forward range
  const clamped = Math.max(-maxBack, Math.min(maxForward, tiltFromCenter));
  return 128 + clamped;
}

type MovementPattern =
  | 'static' | 'sweep' | 'circle' | 'pulse' | 'wave'
  | 'bounce' | 'figure8' | 'zigzag' | 'diamond' | 'spiral'
  | 'heartbeat' | 'randomWalk' | 'panOnly' | 'tiltOnly'
  | 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'outro' | 'build';

function computeMovement(phase: number, motorPhase: number, pattern: string): { px: number; py: number } {
  let px = 0, py = 0;
  switch (pattern) {
    case 'intro': px = Math.sin(phase * .1) * .3; py = Math.cos(phase * .08 + motorPhase) * .3; break;
    case 'verse': px = Math.sin(phase * .25) * .5; py = Math.cos(phase * .2 + motorPhase) * .4; break;
    case 'chorus': px = Math.sin(phase * .5) * .7; py = Math.cos(phase * .5 + motorPhase) * .7; break;
    case 'bridge': px = Math.sin(phase * .3) * .5; py = Math.sin(phase * .6 + motorPhase) * .5; break;
    case 'drop': px = Math.sin(phase * .8) * .9; py = Math.cos(phase * 1.2 + motorPhase) * .6; break;
    case 'outro': px = Math.sin(phase * .15) * .2; py = Math.cos(phase * .12 + motorPhase) * .2; break;
    case 'sweep': px = Math.sin(phase * .35 + motorPhase) * .7; py = Math.cos(phase * .3 + motorPhase) * .5; break;
    case 'circle': px = Math.sin(phase * .5 + motorPhase) * .7; py = Math.cos(phase * .5 + motorPhase) * .7; break;
    case 'bounce': px = Math.sin(phase * .4 + motorPhase) * .5; py = Math.abs(Math.sin(phase * .8 + motorPhase)) * .8; break;
    case 'wave': px = Math.sin(phase * .6 + motorPhase) * .5; py = Math.sin(phase * .35 + motorPhase * 1.5) * .5; break;
    case 'figure8': px = Math.sin(phase * .4 + motorPhase) * .6; py = Math.sin(phase * .8 + motorPhase) * .5; break;
    case 'static': px = Math.sin(phase * .05 + motorPhase) * .1; py = Math.cos(phase * .05 + motorPhase) * .1; break;
    case 'zigzag': { const saw = ((phase / Math.PI) % 2) - 1; px = saw * .8; py = Math.sin(phase) > 0 ? .5 : -.5; } break;
    case 'diamond': { px = (((phase / Math.PI) % 2) - 1) * .8; py = ((((phase + Math.PI / 2) / Math.PI) % 2) - 1) * .8; } break;
    case 'spiral': { const r = .3 + .7 * Math.abs(Math.sin(phase * .3)); px = Math.sin(phase * 2) * r; py = Math.cos(phase * 2) * r; } break;
    case 'heartbeat': { const hp = ((phase / (Math.PI * 2)) % 1); const hb = hp < .15 ? 1 : hp < .3 ? .6 : 0; px = hb * Math.sin(phase * 3); py = hb * Math.cos(phase * 3); } break;
    case 'randomWalk': px = Math.sin(phase * .7) * .5 + Math.sin(phase * 1.3) * .3 + Math.cos(phase * 2.1) * .2; py = Math.cos(phase * .6) * .5 + Math.sin(phase * 1.7) * .3 + Math.sin(phase * 2.3) * .2; break;
    case 'panOnly': px = Math.sin(phase); py = 0; break;
    case 'tiltOnly': px = 0; py = Math.sin(phase); break;
    case 'pulse': px = Math.abs(Math.sin(phase)) * 2 - 1; py = 0; break;
    default: px = Math.sin(phase * .35) * .4; py = Math.cos(phase * .3 + motorPhase) * .4; break;
  }
  return { px, py };
}

// ═══════════════════════════ Intensity Engine ════════════════════════════════════

const ABSOLUTE_MIN = 60;

function mapIntensity(level: string, energy: number, tier: FixtureTier, tierMults?: TierMultipliers): number {
  let val: number;
  if (level === 'dynamic') {
    val = Math.round(Math.max(ABSOLUTE_MIN, 20 + energy * 235));
  } else {
    let lo: number, hi: number;
    switch (level) {
      case 'very-low': lo = 40; hi = 130; break;
      case 'low': lo = 100; hi = 200; break;
      case 'medium': lo = 140; hi = 240; break;
      case 'high': lo = 180; hi = 255; break;
      case 'very-high': lo = 200; hi = 255; break;
      default: lo = 120; hi = 220; break;
    }
    val = Math.round(Math.max(ABSOLUTE_MIN, lo + Math.max(0, Math.min(1, energy)) * (hi - lo)));
  }
  return Math.round(val * getTierIntensityMult(tier, tierMults));
}

// ═══════════════════════════ Core: Per-Fixture Frame ═════════════════════════════

export interface ComputeFrameOptions {
  fa: ChannelAnalysis;
  input: FrameInput;
  tierMultipliers?: TierMultipliers;
  strobeLimit: number;
  movementPhase: number;
  /** EMA fade amount for smooth color transitions (0 = no fade, ~0.98 = ~250ms) */
  fadeAlpha?: number;
  /** Per-fixture fade state (keyed by `${fixtureId}_${rgbOffset}`) */
  fadeState?: Map<string, { r: number; g: number; b: number }>;
  /** Fixture stage position for pan/tilt clamping {x: 0-1, y: 0-1} */
  fixturePosition?: { x: number; y: number };
}

export function computeFixtureFrame(opts: ComputeFrameOptions): Record<number, number> {
  const { fa, input, tierMultipliers, strobeLimit, movementPhase, fadeAlpha, fadeState } = opts;
  const pf = fa.fixture;
  const ct = input.time;
  const chVals: Record<number, number> = {};

  // ── Energy ──
  const energy = input.energy ?? (
    input.intensity === 'very-high' ? 0.95 :
    input.intensity === 'high' ? 0.8 :
    input.intensity === 'medium' ? 0.5 :
    input.intensity === 'low' ? 0.25 : 0.1
  );

  const sec = input.section.toLowerCase();
  const isDrop = sec === 'drop';
  const isChorus = sec === 'chorus';

  // ── Dimmer ──
  let dimmerVal = input.forcedDimmerOverride ?? input.forcedDimmerVal ?? mapIntensity(input.intensity, energy, pf.tier, tierMultipliers);

  if (fa.intensityOffset !== null) {
    const addr = pf.startAddress + fa.intensityOffset;
    if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
  }

  // ── Color ──
  let paletteColor = input.forcedColor || input.color || input.colors[0] || undefined;

  if (fa.rgbSegments.length > 0 && paletteColor) {
    let [r, g, b] = hexToRgb(paletteColor);
    [r, g, b] = applyHueShift([r, g, b], TIER_HUE[pf.tier]);

    // Zero preset/macro channels
    for (const po of fa.presetOverrideOffsets) chVals[pf.startAddress + po] = 0;
    if (fa.intensityOffset !== null) {
      const addr = pf.startAddress + fa.intensityOffset;
      if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
    }

    // EMA color fade (real-time)
    if (fadeAlpha !== undefined && fadeAlpha < 1 && fadeState) {
      for (const seg of fa.rgbSegments) {
        const key = pf.id + '_' + seg.r;
        let cur = fadeState.get(key);
        if (!cur) { cur = { r, g, b }; fadeState.set(key, cur); }
        else {
          cur.r = Math.round(cur.r + (r - cur.r) * fadeAlpha);
          cur.g = Math.round(cur.g + (g - cur.g) * fadeAlpha);
          cur.b = Math.round(cur.b + (b - cur.b) * fadeAlpha);
        }
        chVals[pf.startAddress + seg.r] = cur.r;
        chVals[pf.startAddress + seg.g] = cur.g;
        chVals[pf.startAddress + seg.b] = cur.b;
        if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
      }
    } else {
      // Direct write (batch mode)
      for (const seg of fa.rgbSegments) {
        chVals[pf.startAddress + seg.r] = r;
        chVals[pf.startAddress + seg.g] = g;
        chVals[pf.startAddress + seg.b] = b;
        if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
      }
    }

    // Scale RGB when no intensity channel
    if (fa.intensityOffset === null) {
      const dScale = dimmerVal / 255;
      for (const seg of fa.rgbSegments) {
        chVals[pf.startAddress + seg.r] = Math.round((chVals[pf.startAddress + seg.r] ?? 0) * dScale);
        chVals[pf.startAddress + seg.g] = Math.round((chVals[pf.startAddress + seg.g] ?? 0) * dScale);
        chVals[pf.startAddress + seg.b] = Math.round((chVals[pf.startAddress + seg.b] ?? 0) * dScale);
        if (seg.w !== null) chVals[pf.startAddress + seg.w] = Math.round((chVals[pf.startAddress + seg.w] ?? 0) * dScale);
      }
    }
  } else if (fa.wheelOffset !== null && paletteColor) {
    const caps = fa.wheelCaps;
    let wheelVal: number;
    if (caps.length > 0) {
      const bestCap = findBestWheelCap(caps, paletteColor);
      wheelVal = bestCap ? Math.round((bestCap.min + bestCap.max) / 2) : (() => {
        const [r, g, b] = hexToRgb(paletteColor);
        const cat2 = classifyColor(r, g, b);
        const catMap: Record<string, number> = { red: 0.10, orange: 0.20, yellow: 0.30, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 };
        const wPos = catMap[cat2] ?? 0.5;
        const capIdx = Math.floor(wPos * caps.length) % caps.length;
        return Math.round((caps[capIdx].min + caps[capIdx].max) / 2);
      })();
    } else {
      const [r, g, b] = hexToRgb(paletteColor);
      const cat2 = classifyColor(r, g, b);
      const catMap: Record<string, number> = { red: 0.10, orange: 0.20, yellow: 0.30, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 };
      const wPos = catMap[cat2] ?? 0.5;
      wheelVal = Math.round(wPos * 255);
    }
    chVals[pf.startAddress + fa.wheelOffset] = wheelVal;
  }

  // ── Shutter ──
  if (fa.shutterOffset !== null) {
    const sAddr = pf.startAddress + fa.shutterOffset;
    const useStrobe = input.forcedStrobe ?? ((isDrop || isChorus) && input.strobe && pf.tier === 'primary');
    if (useStrobe) {
      const speed = Math.min(input.strobeSpeed || 10, strobeLimit);
      chVals[sAddr] = Math.min(255, 180 + Math.floor(speed * 3));
    } else if (fa.intensityOffset === null) {
      chVals[sAddr] = Math.max(8, Math.min(255, 8 + Math.round((dimmerVal / 255) * 247)));
    } else {
      chVals[sAddr] = 255;
    }
  }

  // ── Pan/Tilt ──
  const panCount = fa.panOffsets.length;
  const tiltCount = fa.tiltOffsets.length;
  const motorCount = Math.max(panCount, tiltCount, 1);

  if (panCount > 0 || tiltCount > 0) {
    const speedMult = input.movementSpeed ?? 1;
    const phase = (ct * Math.PI * 2 * speedMult) + movementPhase;

    // Get movement pattern from section or explicit
    let movPattern = input.movement || sec;
    const explicitPatterns = new Set(['sweep', 'circle', 'bounce', 'wave', 'figure8', 'zigzag', 'diamond', 'spiral', 'heartbeat', 'randomWalk', 'panOnly', 'tiltOnly', 'static', 'pulse']);

    // Amplitude per tier
    let amplitude: number;
    if (input.movementAmplitude !== undefined) {
      // genCues outputs DMX-scale amplitude; cap at 128 (= full edge-to-edge sweep from center)
      amplitude = Math.min(128, Math.max(0, Math.round(input.movementAmplitude)));
    } else {
      if (pf.tier === 'primary') amplitude = 90;
      else if (pf.tier === 'secondary') amplitude = 70;
      else amplitude = 40;
    }
    amplitude = Math.round(amplitude * getTierMovAmp(pf.tier));

    if (amplitude > 0) {
      // Stage-aware pan/tilt clamping: use fixture position to keep beams on stage
      const fxPos = opts.fixturePosition || { x: 0.5, y: 0.3 };
      for (let m = 0; m < motorCount; m++) {
        const motorPhase = m * (Math.PI * 2 / motorCount);
        const { px, py } = computeMovement(phase, motorPhase, movPattern);
        if (m < panCount) {
          const rawPan = Math.round(128 + px * amplitude);
          const clampedPan = clampPanToStage(rawPan, fxPos.x);
          chVals[pf.startAddress + fa.panOffsets[m]] = Math.max(0, Math.min(255, clampedPan));
        }
        if (m < tiltCount) {
          const rawTilt = Math.round(128 + py * amplitude);
          const clampedTilt = clampTiltToStage(rawTilt, fxPos.y);
          chVals[pf.startAddress + fa.tiltOffsets[m]] = Math.max(0, Math.min(255, clampedTilt));
        }
      }
    } else {
      for (const po of fa.panOffsets) chVals[pf.startAddress + po] = 128;
      for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = 128;
    }
  }

  // ── GOBO / PRISM / ZOOM / FROST / IRIS / FOCUS ──
  const fxEnergy = energy;
  const fxPhase = ct * Math.PI * 2 * (input.movementSpeed ?? 1);

  if (fa.goboOffset !== null) {
    const gAddr = pf.startAddress + fa.goboOffset;
    if (fa.goboCaps.length > 0) {
      const gc = Math.max(1, fa.goboCaps.length);
      const gi = Math.floor((fxPhase * 0.5) % gc);
      chVals[gAddr] = Math.round((fa.goboCaps[gi].min + fa.goboCaps[gi].max) / 2);
    } else {
      chVals[gAddr] = Math.round(fxEnergy * 255);
    }
  }

  if (fa.prismOffset !== null) {
    chVals[pf.startAddress + fa.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase * 0.7) * 128 * fxEnergy)));
  }

  if (fa.zoomOffset !== null) {
    chVals[pf.startAddress + fa.zoomOffset] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * fxEnergy + 64 * fxEnergy);
  }

  if (fa.frostOffset !== null) {
    chVals[pf.startAddress + fa.frostOffset] = Math.round(Math.max(0, 255 - (fxEnergy * 255)));
  }

  if (fa.irisOffset !== null) {
    chVals[pf.startAddress + fa.irisOffset] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase * 0.5) * 15 * fxEnergy);
  }

  if (fa.focusOffset !== null) {
    chVals[pf.startAddress + fa.focusOffset] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase * 0.3) * 30);
  }

  return chVals;
}

// ═══════════════════════════ Batch Engine ════════════════════════════════════════

export interface BatchInput extends CueInput {
  energy?: number;
  forcedColor?: string;
  forcedStrobe?: boolean;
  forcedDimmerVal?: number;
  strobeSpeed?: number;
  movementAmplitude?: number;
  movementSpeed?: number;
}

export function computeDmxCuesUnified(
  cues: BatchInput[],
  patchedFixtures: PatchedFixture[],
  fixtureDefs: Map<string, DmxFixtureDefinition>,
  universeIds: string[],
  options?: {
    tierMultipliers?: TierMultipliers;
    strobeLimit?: number;
    disabledFixtures?: Set<string>;
    fixturePositions?: Record<string, { x: number; y: number }>;
  },
): DmxCue[] {
  if (cues.length === 0 || patchedFixtures.length === 0) return [];

  const { tierMultipliers, strobeLimit = 10, disabledFixtures, fixturePositions } = options || {};

  // Analyze all fixtures
  const analyses = patchedFixtures
    .filter(pf => !disabledFixtures?.has(pf.id))
    .map(pf => analyzeFixture(pf, fixtureDefs.get(pf.fixtureDefId), universeIds));

  const byUniverse = new Map<number, ChannelAnalysis[]>();
  for (const a of analyses) {
    const list = byUniverse.get(a.universeIndex) ?? [];
    list.push(a);
    byUniverse.set(a.universeIndex, list);
  }

  const results: DmxCue[] = [];
  const movementPhase = 0; // deterministic seed for batch

  for (const cue of cues) {
    const input: FrameInput = {
      time: cue.time,
      section: cue.section,
      intensity: cue.intensity,
      energy: (cue as any).energy,
      colors: cue.colors,
      color: cue.color,
      forcedColor: (cue as any).forcedColor,
      strobe: cue.strobe,
      strobeProbability: cue.strobeProbability,
      strobeSpeed: (cue as any).strobeSpeed,
      forcedStrobe: (cue as any).forcedStrobe,
      forcedDimmerVal: (cue as any).forcedDimmerVal,
      dimmerPulseOnBeat: cue.dimmerPulseOnBeat,
      movement: cue.movement,
      movementAmplitude: (cue as any).movementAmplitude,
      movementSpeed: (cue as any).movementSpeed,
    };

    for (const [universe, fixtures] of byUniverse) {
      const chVals: Record<number, number> = {};

      for (const fa of fixtures) {
        const fxPos = fixturePositions?.[fa.fixture.id];
        const fixtureVals = computeFixtureFrame({
          fa, input, tierMultipliers, strobeLimit, movementPhase,
          fixturePosition: fxPos,
        });
        Object.assign(chVals, fixtureVals);
      }

      if (Object.keys(chVals).length > 0) {
        results.push({
          time: cue.time,
          section: cue.section,
          universe,
          channelValues: chVals,
          fixtureNames: fixtures.map(f => f.fixture.name),
          fixtureCount: fixtures.length,
          effect: cue.effect,
          colors: cue.colors,
        });
      }
    }
  }

  return results;
}

// ═══════════════════════ Universe Dispatch ═══════════════════════════════════════

export function dispatchChannelsByFixture(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: { id: string }[],
): Map<number, Record<number, number>> {
  const uniIds = universes.map(u => String(u.id));
  const dispatched = new Map<number, Record<number, number>>();

  for (const pf of patchedFixtures) {
    const uniIdx = uniIds.indexOf(pf.universeId);
    const uniNum = uniIdx >= 0 ? uniIdx : 0;
    const base = pf.startAddress;
    const endAddr = base + pf.channelCount;

    const uniVals = dispatched.get(uniNum) || {};
    for (const [addrStr, val] of Object.entries(channelValues)) {
      const addr = Number(addrStr);
      if (addr >= base && addr < endAddr) {
        const existing = uniVals[addr];
        if (existing === undefined || val > existing) uniVals[addr] = val;
      }
    }
    if (Object.keys(uniVals).length > 0) dispatched.set(uniNum, uniVals);
  }
  return dispatched;
}
