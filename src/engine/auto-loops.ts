// ─── Auto Loops — automatic looping patterns for patched fixtures ───────────
//
// Two layers:
//  1. generateAutoLoops() — one loop per kind per tier (color chase, movement,
//     dimmer pulse). Small, predictable, used as the building block.
//  2. generateLoopLibrary() — a rich, seeded "near-infinite" catalog of loop
//     variations (named palettes × movement patterns × speeds), inspired by
//     les boucles auto (LoopAuto). Re-run with a different seed → a different set.
//
// A loop is a sequence of DMX frames (absolute address → value). Each frame is
// a self-contained lighting state; the frames repeat (forward/backward/bounce)
// at `speedBpm`. materializeAutoLoops() turns loops into playable scenes +
// chasers (the existing chaser engine plays them unchanged).

import type { PatchedFixture, FixtureTier, SavedScene, SavedChaser, FixturePos } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureCapability } from '../hooks/dmx-cues';
import { analyzeChannels, type ChannelAnalysis, pickLaserModeCap } from './fixture-analyzer';
import { classifyGoboCap } from './gobo-engine';
import { movementAt, type EffectPattern } from './effect-engine';
import { zeroDmxOffset } from './dmx-movement';

export type AutoLoopKind =
  | 'color-chase' | 'movement' | 'dimmer-pulse' | 'strobe'
  | 'color-wheel' | 'gobo' | 'effect' | 'prism'
  | 'beam-zoom' | 'beam-frost' | 'beam-iris' | 'beam-focus'
  | 'laser-pattern' | 'laser-scan' | 'laser-color';

/** Libellés de catégorie (FR) — partagés entre le catalogue QuickShow et le picker widget. */
export const LOOP_KIND_LABEL: Record<AutoLoopKind, string> = {
  'color-chase': 'Couleur',
  movement: 'Mouvement',
  'dimmer-pulse': 'Ambiance',
  strobe: 'Strobe',
  'color-wheel': 'Roue couleur',
  gobo: 'Gobo',
  effect: 'Effet',
  prism: 'Prisme',
  'beam-zoom': 'Zoom',
  'beam-frost': 'Frost',
  'beam-iris': 'Iris',
  'beam-focus': 'Focus',
  'laser-pattern': 'Motif laser',
  'laser-scan': 'Balayage laser',
  'laser-color': 'Couleur laser',
};

/** Ordre d'affichage des catégories dans le catalogue. */
export const LOOP_KIND_ORDER: AutoLoopKind[] = [
  'color-chase', 'color-wheel', 'movement', 'dimmer-pulse', 'strobe',
  'gobo', 'effect', 'prism', 'beam-zoom', 'beam-frost', 'beam-iris', 'beam-focus',
  'laser-pattern', 'laser-scan', 'laser-color',
];

export interface AutoLoopStep {
  /** Absolute DMX address → value (0-255) for this loop's fixtures. */
  channels: Record<number, number>;
}

export interface AutoLoop {
  id: string;
  name: string;
  tier: FixtureTier;
  kind: AutoLoopKind;
  /** Patched fixture ids participating in this loop. */
  fixtureIds: string[];
  steps: AutoLoopStep[];
  speedBpm: number;
  direction: 'forward' | 'backward' | 'bounce';
  /** Variante identitaire pour une recette portable. */
  palette?: string; // nom de palette (color-chase)
  pattern?: string; // nom de motif (movement)
  radius?: number; // amplitude pan/tilt (movement), 0..128
  chaseSteps?: number; // nb de couleurs (color-chase)
  variant?: string; // variante : 'rotate'|'static' (gobo) · sous-canal beam (beam-*)
}

/**
 * Recette portable d'une boucle — la spec minimale rejouable sur le patch
 * courant, indépendamment des adresses DMX et des fixtures concrètes.
 * C'est ce qui est stocké dans un widget Performance.
 */
export interface LoopRecipe {
  kind: AutoLoopKind;
  name: string;
  tier: FixtureTier;
  speedBpm: number;
  direction: AutoLoop['direction'];
  palette?: string;
  pattern?: string;
  radius?: number;
  chaseSteps?: number;
  variant?: string; // variante : 'rotate'|'static' (gobo) · sous-canal beam (beam-*)
}

export interface AutoLoopOptions {
  /** Loop speed in BPM (steps per minute). Default 120. */
  speedBpm?: number;
  /** Number of colors in a color chase. Default 4. */
  chaseSteps?: number;
  /** Number of pan/tilt positions in a movement loop. Default 8. */
  movementSteps?: number;
  /** DMX amplitude (0-128) around the 128 center for movement. Default 64. */
  movementRadius?: number;
  /** Per-fixture stage positions (for the pan/tilt zero/tare). The movement
   *  loop oscillates around `128 + zeroDmxOffset(...)` instead of 128. */
  positions?: Record<string, FixturePos>;
}

export interface LoopLibraryOptions {
  /** How many loops to return. Default 32. */
  count?: number;
  /** Seed for reproducible variety. Change it to get a new set. Default 0. */
  seed?: number;
  /** Per-fixture positions — same taré semantics as AutoLoopOptions.positions. */
  positions?: Record<string, FixturePos>;
}

const TIER_ORDER: FixtureTier[] = ['primary', 'secondary', 'tertiary', 'other'];

/** Default chase palette — high-contrast hues (brand violet + cyan + amber + green).
 *  Deliberately distinct: a chase of near-identical colors reads as "static". */
const CHASE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [168, 85, 247], // violet (brand)
  [0, 200, 255], // cyan
  [255, 170, 40], // amber
  [100, 240, 120], // green
];

/** Fill color injected into movement/strobe loops so RGB movers emit visible light. */
const VISIBLE_FILL: readonly [number, number, number] = [255, 255, 255];

const DMX_CENTER = 128;

/** Seeded PRNG (mulberry32) — deterministic variety, reshuffle via seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface NamedPalette {
  name: string;
  colors: readonly (readonly [number, number, number])[];
}

/** Curated palettes for the loop library. */
const PALETTES: NamedPalette[] = [
  { name: 'vivid', colors: [[168, 85, 247], [0, 200, 255], [255, 170, 40], [100, 240, 120]] },
  { name: 'rainbow', colors: [[255, 60, 60], [255, 180, 0], [60, 220, 90], [60, 140, 255]] },
  { name: 'warm', colors: [[255, 120, 40], [255, 200, 80], [255, 80, 60], [240, 240, 200]] },
  { name: 'cool', colors: [[40, 140, 255], [80, 220, 220], [120, 80, 255], [220, 240, 255]] },
  { name: 'party', colors: [[255, 60, 120], [0, 220, 255], [255, 220, 0], [160, 60, 255]] },
  { name: 'white', colors: [[255, 255, 255], [220, 220, 235], [180, 180, 200], [140, 140, 160]] },
];

interface MovementPattern {
  name: string;
  at: (t: number, r: number) => [number, number]; // t ∈ [0,1) → [pan, tilt]
}

/** Movement shapes — délégués à EffectEngine (source unique). */
const MOVEMENT_PATTERNS: MovementPattern[] = (['circle', 'square', 'figure8', 'zigzag', 'sweep'] as EffectPattern[]).map((name) => ({
  name,
  at: (t: number, r: number) => movementAt(name, t, r),
}));

interface AnalyzedFixture {
  pf: PatchedFixture;
  analysis: ChannelAnalysis;
}

function absAddr(pf: PatchedFixture, offset: number): number {
  return pf.startAddress + offset;
}

function put(frame: Record<number, number>, addr: number, value: number): void {
  frame[addr] = Math.max(0, Math.min(255, Math.round(value)));
}

function putRgbSegments(
  frame: Record<number, number>,
  pf: PatchedFixture,
  analysis: ChannelAnalysis,
  c: readonly [number, number, number],
): void {
  const [r, g, b] = c;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  // Blanc dérivé : réservé aux couleurs quasi-neutres (désaturées). min(r,g,b)
  // allumerait la LED blanche sur des teintes saturées → on ne l'utilise que
  // lorsque la saturation < 0.3 (blanc pur, pastels, gris).
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  const white = sat < 0.3 ? mn : 0;
  // Ambre : couleurs chaudes (rouge dominant, vert moyen, peu de bleu).
  const amber = r > 150 && g > 60 && b < 90 && r - b > 70 ? Math.round((r - b) * 0.5) : 0;
  // UV : couleurs violettes/UV (bleu dominant, rouge présent, peu de vert).
  const uv = b > 140 && r > 90 && g < 90 ? Math.round(b * 0.6) : 0;
  for (const seg of analysis.rgbSegments) {
    put(frame, absAddr(pf, seg.r), r);
    put(frame, absAddr(pf, seg.g), g);
    if (seg.b !== null) put(frame, absAddr(pf, seg.b), b);
    if (seg.w !== null) put(frame, absAddr(pf, seg.w), white);
    if (seg.a != null) put(frame, absAddr(pf, seg.a), amber);
    if (seg.uv != null) put(frame, absAddr(pf, seg.uv), uv);
  }
}

/** Valeur d'activation au centre de la plage DMX d'une capacité. */
function capMid(cap: DmxFixtureCapability): number {
  return Math.round((cap.min + cap.max) / 2);
}

type BeamChannel = 'zoom' | 'frost' | 'iris' | 'focus';

function beamOffsetOf(fa: ChannelAnalysis, k: BeamChannel): number | null {
  const map: Record<BeamChannel, number | null> = {
    zoom: fa.zoomOffset,
    frost: fa.frostOffset,
    iris: fa.irisOffset,
    focus: fa.focusOffset,
  };
  return map[k];
}

function buildColorChase(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  colors: ReadonlyArray<readonly [number, number, number]>,
  speedBpm: number,
  variant?: string,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  const steps: AutoLoopStep[] = colors.map((_, stepIdx) => {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      // Rotating chase: fixture i shows color (i + stepIdx) % colors.length.
      const c = colors[(i + stepIdx) % colors.length];
      putRgbSegments(frame, pf, analysis, c);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    return { channels: frame };
  });

  return {
    id: variant ? `auto-cc-${tier}-${variant}` : `auto-cc-${tier}`,
    name: variant ? `Chase · ${variant} · ${tier}` : `Color chase · ${tier}`,
    tier,
    kind: 'color-chase',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction,
    palette: variant,
    chaseSteps: colors.length,
  };
}

function buildMovementLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  movementSteps: number,
  radius: number,
  speedBpm: number,
  pattern: MovementPattern = MOVEMENT_PATTERNS[0],
  direction: AutoLoop['direction'] = 'forward',
  positions?: Record<string, FixturePos>,
): AutoLoop {
  const amp = Math.max(0, Math.min(128, radius));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < movementSteps; step++) {
    const [pan, tilt] = pattern.at(step / movementSteps, amp);
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      // Centre du mouvement (tare) : chaque tête oscille autour de son propre
      // centre (capture). Le zéro VISUEL (zeroPan/zeroTilt) ne vit pas dans le
      // moteur — il est appliqué uniquement au rendu 3D.
      const zPan = positions ? zeroDmxOffset(positions[pf.id]?.centerPan, 'pan') : 0;
      const zTilt = positions ? zeroDmxOffset(positions[pf.id]?.centerTilt, 'tilt') : 0;
      for (const off of analysis.panOffsets) put(frame, absAddr(pf, off), pan + zPan);
      for (const off of analysis.tiltOffsets) put(frame, absAddr(pf, off), tilt + zTilt);
      // Fine 16-bit : neutralisé (0) pour éviter une valeur résiduelle « stale »
      // qui fausserait la précision du mouvement.
      if (analysis.panFineOffset !== null) put(frame, absAddr(pf, analysis.panFineOffset), 0);
      if (analysis.tiltFineOffset !== null) put(frame, absAddr(pf, analysis.tiltFineOffset), 0);
      if (analysis.rgbSegments.length > 0) putRgbSegments(frame, pf, analysis, VISIBLE_FILL);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }

  return {
    id: `auto-mv-${tier}-${pattern.name}`,
    name: `Movement · ${pattern.name} · ${tier}`,
    tier,
    kind: 'movement',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction,
    pattern: pattern.name,
    radius: amp,
  };
}

function buildDimmerPulse(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
): AutoLoop {
  // Smooth sine pulse: 8 steps from 0 → 255 → 0.
  const pulseSteps = 8;
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < pulseSteps; step++) {
    const t = step / pulseSteps;
    const v = Math.round(255 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 - Math.PI / 2)));
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), v);
    }
    steps.push({ channels: frame });
  }

  return {
    id: `auto-dp-${tier}`,
    name: `Dimmer pulse · ${tier}`,
    tier,
    kind: 'dimmer-pulse',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction: 'forward',
  };
}

function buildStrobeLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
): AutoLoop {
  // Hard on/off via the shutter channel; full intensity on the "on" frames.
  const steps: AutoLoopStep[] = [0, 1].map((on) => {
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      if (on && analysis.rgbSegments.length > 0) putRgbSegments(frame, pf, analysis, VISIBLE_FILL);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), on ? 255 : 0);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), on ? 255 : 0);
    }
    return { channels: frame };
  });

  return {
    id: `auto-st-${tier}`,
    name: `Strobe · ${tier}`,
    tier,
    kind: 'strobe',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction: 'forward',
  };
}

function buildColorWheelLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  const capCount = Math.min(...fixtures.map((f) => f.analysis.wheelCaps.length));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < capCount; step++) {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      const cap = analysis.wheelCaps[(i + step) % analysis.wheelCaps.length];
      put(frame, absAddr(pf, analysis.wheelOffset!), capMid(cap));
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return {
    id: `auto-cw-${tier}`,
    name: `Color wheel · ${tier}`,
    tier,
    kind: 'color-wheel',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction,
  };
}

function buildGoboLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
  rotate: boolean,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  // Exploitation calme : chaque fixture POSE un motif statique (jamais les
  // slots animate AUTO/SPIN/CHANGE qui défilent en permanence), et la
  // rotation n'est exprimée que via le canal Speed quand il existe. La roue ne
  // défile donc jamais slot par slot (fini le "mur de gobos qui tourne").
  const staticFor = (f: AnalyzedFixture): DmxFixtureCapability => {
    const caps = f.analysis.goboCaps ?? [];
    const stat = caps.filter((c) => classifyGoboCap(c) === 'static');
    const open = caps.filter((c) => classifyGoboCap(c) === 'open');
    const pool = stat.length > 0 ? stat : open;
    return pool.length > 0 ? pool[0] : caps[0];
  };
  const steps: AutoLoopStep[] = [];
  const poses = fixtures.map((f) => ({ f, cap: staticFor(f) }));
  const capCount = Math.max(1, Math.min(...fixtures.map((f) => f.analysis.goboCaps.length)));
  for (let step = 0; step < capCount; step++) {
    const frame: Record<number, number> = {};
    for (let i = 0; i < poses.length; i++) {
      const { f, cap } = poses[i];
      const { pf, analysis } = f;
      put(frame, absAddr(pf, analysis.goboOffset!), capMid(cap));
      if (rotate && analysis.speedOffset !== null) {
        put(frame, absAddr(pf, analysis.speedOffset), 128 + Math.round(127 * (step / capCount)));
      }
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return {
    id: `auto-gb-${tier}`,
    name: `Gobo · ${tier}`,
    tier,
    kind: 'gobo',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction,
    variant: rotate ? 'rotate' : 'static',
  };
}

function buildEffectLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  const capsFor = (f: AnalyzedFixture): DmxFixtureCapability[] => {
    const all = f.analysis.effectCaps ?? [];
    const active = all.filter((c) => c.min > 0);
    return active.length > 0 ? active : all;
  };
  const capCount = Math.min(...fixtures.map((f) => capsFor(f).length));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < capCount; step++) {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      const caps = capsFor({ pf, analysis });
      const cap = caps[(i + step) % caps.length];
      put(frame, absAddr(pf, analysis.effectOffset!), capMid(cap));
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return {
    id: `auto-fx-${tier}`,
    name: `Effect · ${tier}`,
    tier,
    kind: 'effect',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction,
  };
}

function buildPrismLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
): AutoLoop {
  // 4 pas. Si une fixture a des capacités prism, on utilise off(0) puis les
  // milieux de plage (capMid) ; sinon les états conventionnels 128/170/255/0.
  const CONVENTIONAL = [128, 170, 255, 0];
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < 4; step++) {
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      let v: number;
      if (analysis.prismCaps.length > 0) {
        v = step === 0 ? 0 : capMid(analysis.prismCaps[(step - 1) % analysis.prismCaps.length]);
      } else {
        v = CONVENTIONAL[step] ?? 0;
      }
      put(frame, absAddr(pf, analysis.prismOffset!), v);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return {
    id: `auto-pr-${tier}`,
    name: `Prism · ${tier}`,
    tier,
    kind: 'prism',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction: 'forward',
  };
}

function buildBeamLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  kind: AutoLoopKind,
  speedBpm: number,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  const k = kind.slice('beam-'.length) as BeamChannel;
  const BEAM_STEPS = 8;
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < BEAM_STEPS; step++) {
    const v = Math.round(255 * (0.5 + 0.5 * Math.sin((step / BEAM_STEPS) * Math.PI * 2)));
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      const off = beamOffsetOf(analysis, k);
      if (off === null) continue;
      put(frame, absAddr(pf, off), v);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return {
    id: `auto-${k}-${tier}`,
    name: `${k} · ${tier}`,
    tier,
    kind,
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction,
  };
}

/** Baseline laser (toujours appliquée) : mode pilotable en DMX + blanking ouvert + zoom large + pleine puissance. */
function laserBaseline(frame: Record<number, number>, pf: PatchedFixture, analysis: ChannelAnalysis): void {
  if (analysis.laserModeOffset !== null) put(frame, absAddr(pf, analysis.laserModeOffset), capMid(pickLaserModeCap(analysis.laserModeCaps)));
  if (analysis.blankOffset !== null) put(frame, absAddr(pf, analysis.blankOffset), 0);
  if (analysis.zoomOffset !== null) put(frame, absAddr(pf, analysis.zoomOffset), 255);
  if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
  if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
}

function buildLaserPatternLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
  steps: number = 8,
  direction: AutoLoop['direction'] = 'forward',
  startOffset: number = 0,
): AutoLoop {
  const n = Math.max(2, steps);
  const k = Math.max(1, fixtures.length);
  const stepsArr: AutoLoopStep[] = [];
  for (let step = 0; step < n; step++) {
    const frame: Record<number, number> = {};
    const phase = 2 * Math.PI * (step / n);
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      const caps = analysis.patternCaps;
      if (analysis.patternOffset !== null && caps.length > 0) {
        put(frame, absAddr(pf, analysis.patternOffset), capMid(caps[(i + step + startOffset) % caps.length]));
      }
      // Rotations : oscillation lente, déphasée par axe ET par fixture
      // (deux lasers jumeaux ne tournent plus en parfaite synchronie).
      const rotPhase = (2 * Math.PI * i) / k;
      analysis.laserRotationOffsets.forEach((off, ri) => {
        put(frame, absAddr(pf, off), 128 + Math.round(70 * Math.sin(phase * (ri + 1) + rotPhase)));
      });
      // Vitesse de pattern : oscille par step (plus vivant qu'un 160 figé).
      if (analysis.laserSpeedPatternOffset !== null) {
        put(frame, absAddr(pf, analysis.laserSpeedPatternOffset), 128 + Math.round(64 * Math.sin(phase)));
      }
      laserBaseline(frame, pf, analysis);
    }
    stepsArr.push({ channels: frame });
  }
  return {
    id: `auto-lp-${tier}`,
    name: `Motifs laser · ${tier}`,
    tier,
    kind: 'laser-pattern',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps: stepsArr,
    speedBpm,
    direction,
  };
}

function buildLaserScanLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
  radius: number = 90,
  direction: AutoLoop['direction'] = 'forward',
  shape: 'circle' | 'lissajous' = 'circle',
): AutoLoop {
  const n = 8;
  const r = Math.max(0, Math.min(128, radius));
  const k = Math.max(1, fixtures.length);
  const stepsArr: AutoLoopStep[] = [];
  for (let step = 0; step < n; step++) {
    const t = step / n;
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      // Déphasage par fixture : des lasers identiques se répartissent
      // autour du cercle (bracketing) au lieu de se superposer.
      const phase = (2 * Math.PI * i) / k;
      const sx = 128 + Math.round(r * Math.cos(2 * Math.PI * t + phase));
      const sy = shape === 'lissajous'
        ? 128 + Math.round(r * Math.sin(2 * Math.PI * t * 2 + phase))
        : 128 + Math.round(r * Math.sin(2 * Math.PI * t + phase));
      if (analysis.scanXOffset !== null) put(frame, absAddr(pf, analysis.scanXOffset), sx);
      if (analysis.scanYOffset !== null) put(frame, absAddr(pf, analysis.scanYOffset), sy);
      // Vitesse de scan : oscille par step (vivant, jamais figé).
      if (analysis.laserSpeedScanOffset !== null) {
        put(frame, absAddr(pf, analysis.laserSpeedScanOffset), 128 + Math.round(64 * Math.sin(2 * Math.PI * t)));
      }
      laserBaseline(frame, pf, analysis);
    }
    stepsArr.push({ channels: frame });
  }
  return {
    id: `auto-ls-${tier}`,
    name: shape === 'lissajous' ? `Balayage laser ∞ · ${tier}` : `Balayage laser · ${tier}`,
    tier,
    kind: 'laser-scan',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps: stepsArr,
    speedBpm,
    direction,
    radius: r,
    variant: shape,
  };
}

function buildLaserColorLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  speedBpm: number,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  const capCount = Math.max(1, ...fixtures.map((f) => f.analysis.wheelCaps.length));
  const k = Math.max(1, fixtures.length);
  const stepsArr: AutoLoopStep[] = [];
  for (let step = 0; step < capCount; step++) {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      const caps = analysis.wheelCaps;
      if (analysis.wheelOffset !== null && caps.length > 0) {
        put(frame, absAddr(pf, analysis.wheelOffset), capMid(caps[(i + step) % caps.length]));
      }
      // Rotations animées pendant le cycle couleur, déphasées par fixture.
      const rotPhase = (2 * Math.PI * i) / k;
      analysis.laserRotationOffsets.forEach((off, ri) => {
        put(frame, absAddr(pf, off), 128 + Math.round(70 * Math.sin(2 * Math.PI * (step / capCount) * (ri + 1) + rotPhase)));
      });
      laserBaseline(frame, pf, analysis);
    }
    stepsArr.push({ channels: frame });
  }
  return {
    id: `auto-lc-${tier}`,
    name: `Couleur laser · ${tier}`,
    tier,
    kind: 'laser-color',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps: stepsArr,
    speedBpm,
    direction,
  };
}

function analyzeTiers(
  patchedFixtures: PatchedFixture[],
  defs: Map<string, DmxFixtureDefinition>,
): Map<FixtureTier, AnalyzedFixture[]> {
  const byTier = new Map<FixtureTier, AnalyzedFixture[]>();
  for (const pf of patchedFixtures) {
    if (pf.enabled === false) continue;
    const list = byTier.get(pf.tier) ?? [];
    list.push({ pf, analysis: analyzeChannels(pf, defs.get(pf.fixtureDefId)) });
    byTier.set(pf.tier, list);
  }
  return byTier;
}

/**
 * Generate one loop per kind per tier for the patched fixtures. Disabled
 * fixtures (`enabled === false`) are skipped. This is the small predictable
 * building block; see generateLoopLibrary() for the rich variety catalog.
 */
export function generateAutoLoops(
  patchedFixtures: PatchedFixture[],
  defs: Map<string, DmxFixtureDefinition>,
  opts: AutoLoopOptions = {},
): AutoLoop[] {
  const speedBpm = opts.speedBpm ?? 120;
  const chaseSteps = Math.max(2, opts.chaseSteps ?? 4);
  const movementSteps = Math.max(3, opts.movementSteps ?? 8);
  const movementRadius = opts.movementRadius ?? 64;

  const byTier = analyzeTiers(patchedFixtures, defs);
  const loops: AutoLoop[] = [];

  for (const tier of TIER_ORDER) {
    const fixtures = byTier.get(tier);
    if (!fixtures || fixtures.length === 0) continue;

    const rgb = fixtures.filter((f) => f.analysis.rgbSegments.length > 0);
    const movers = fixtures.filter(
      (f) => f.analysis.panOffsets.length > 0 || f.analysis.tiltOffsets.length > 0,
    );
    const dimmers = fixtures.filter(
      (f) =>
        f.analysis.intensityOffset !== null &&
        f.analysis.rgbSegments.length === 0 &&
        f.analysis.panOffsets.length === 0 &&
        f.analysis.tiltOffsets.length === 0,
    );
    const wheels = fixtures.filter(
      (f) => f.analysis.wheelOffset !== null && f.analysis.wheelCaps.length > 0 && f.analysis.rgbSegments.length === 0 && !f.analysis.isLaser,
    );
    const gobos = fixtures.filter((f) => f.analysis.goboOffset !== null && f.analysis.goboCaps.length > 0);
    const effects = fixtures.filter((f) => f.analysis.effectOffset !== null && (f.analysis.effectCaps?.length ?? 0) > 0);
    const prisms = fixtures.filter((f) => f.analysis.prismOffset !== null);

    // Laser : pattern (motifs), scan (balayage X/Y), couleur roue — chacun
    // avec sa baseline (mode DMX + blanking + zoom).
    const laserPatterns = fixtures.filter((f) => f.analysis.isLaser && f.analysis.patternOffset !== null && f.analysis.patternCaps.length > 0);
    const laserScans = fixtures.filter((f) => f.analysis.isLaser && (f.analysis.scanXOffset !== null || f.analysis.scanYOffset !== null));
    const laserWheels = fixtures.filter((f) => f.analysis.isLaser && f.analysis.laserColorMode === 'wheel' && f.analysis.wheelOffset !== null && f.analysis.wheelCaps.length > 0);

    if (rgb.length > 0) loops.push(buildColorChase(tier, rgb, CHASE_COLORS.slice(0, chaseSteps), speedBpm));
    if (movers.length > 0) loops.push(buildMovementLoop(tier, movers, movementSteps, movementRadius, speedBpm, MOVEMENT_PATTERNS[0], 'forward', opts.positions));
    if (dimmers.length > 0) loops.push(buildDimmerPulse(tier, dimmers, speedBpm));
    if (wheels.length > 0) loops.push(buildColorWheelLoop(tier, wheels, speedBpm));
    if (gobos.length > 0) loops.push(buildGoboLoop(tier, gobos, speedBpm, true));
    if (effects.length > 0) loops.push(buildEffectLoop(tier, effects, speedBpm));
    if (prisms.length > 0) loops.push(buildPrismLoop(tier, prisms, speedBpm));
    if (laserPatterns.length > 0) loops.push(buildLaserPatternLoop(tier, laserPatterns, speedBpm));
    if (laserScans.length > 0) loops.push(buildLaserScanLoop(tier, laserScans, speedBpm));
    if (laserWheels.length > 0) loops.push(buildLaserColorLoop(tier, laserWheels, speedBpm));
    for (const k of ['zoom', 'frost', 'iris', 'focus'] as BeamChannel[]) {
      const beam = fixtures.filter((f) => beamOffsetOf(f.analysis, k) !== null);
      if (beam.length > 0) loops.push(buildBeamLoop(tier, beam, `beam-${k}` as AutoLoopKind, speedBpm));
    }
  }

  return loops;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Rich loop library: a seeded sample from the full variation space for the
 * patched fixtures — curated palettes × movement patterns × speeds ×
 * directions × radii × tiers. Every available kind appears at least once per
 * tier (guaranteed coverage), then the rest are drawn randomly, so bumping the
 * seed yields a genuinely fresh set (the "near-infinite" LoopAuto feel).
 */
export function generateLoopLibrary(
  patchedFixtures: PatchedFixture[],
  defs: Map<string, DmxFixtureDefinition>,
  opts: LoopLibraryOptions = {},
): AutoLoop[] {
  const count = Math.max(1, opts.count ?? 36);
  const rng = mulberry32(opts.seed ?? 0);

  const byTier = analyzeTiers(patchedFixtures, defs);
  const tiers = TIER_ORDER.filter((t) => (byTier.get(t)?.length ?? 0) > 0);
  if (tiers.length === 0) return [];

  const speeds = [80, 90, 100, 110, 120, 135, 150, 170];
  const directions: AutoLoop['direction'][] = ['forward', 'backward', 'bounce'];

  interface Cap {
    rgb: AnalyzedFixture[];
    movers: AnalyzedFixture[];
    dimmers: AnalyzedFixture[];
    shutters: AnalyzedFixture[];
    wheels: AnalyzedFixture[];
    gobos: AnalyzedFixture[];
    effects: AnalyzedFixture[];
    prisms: AnalyzedFixture[];
    beams: Record<BeamChannel, AnalyzedFixture[]>;
    laserPatterns: AnalyzedFixture[];
    laserScans: AnalyzedFixture[];
    laserWheels: AnalyzedFixture[];
    kinds: AutoLoopKind[];
  }
  const caps = new Map<FixtureTier, Cap>();
  for (const tier of tiers) {
    const fixtures = byTier.get(tier)!;
    const rgb = fixtures.filter((f) => f.analysis.rgbSegments.length > 0);
    const movers = fixtures.filter(
      (f) => f.analysis.panOffsets.length > 0 || f.analysis.tiltOffsets.length > 0,
    );
    const dimmers = fixtures.filter(
      (f) =>
        f.analysis.intensityOffset !== null &&
        f.analysis.rgbSegments.length === 0 &&
        f.analysis.panOffsets.length === 0 &&
        f.analysis.tiltOffsets.length === 0,
    );
    const shutters = fixtures.filter((f) => f.analysis.shutterOffset !== null);
    const wheels = fixtures.filter(
      (f) => f.analysis.wheelOffset !== null && f.analysis.wheelCaps.length > 0 && f.analysis.rgbSegments.length === 0 && !f.analysis.isLaser,
    );
    const gobos = fixtures.filter((f) => f.analysis.goboOffset !== null && f.analysis.goboCaps.length > 0);
    const effects = fixtures.filter((f) => f.analysis.effectOffset !== null && (f.analysis.effectCaps?.length ?? 0) > 0);
    const prisms = fixtures.filter((f) => f.analysis.prismOffset !== null);
    const beams: Record<BeamChannel, AnalyzedFixture[]> = {
      zoom: fixtures.filter((f) => f.analysis.zoomOffset !== null),
      frost: fixtures.filter((f) => f.analysis.frostOffset !== null),
      iris: fixtures.filter((f) => f.analysis.irisOffset !== null),
      focus: fixtures.filter((f) => f.analysis.focusOffset !== null),
    };
    const laserPatterns = fixtures.filter((f) => f.analysis.isLaser && f.analysis.patternOffset !== null && f.analysis.patternCaps.length > 0);
    const laserScans = fixtures.filter((f) => f.analysis.isLaser && (f.analysis.scanXOffset !== null || f.analysis.scanYOffset !== null));
    const laserWheels = fixtures.filter((f) => f.analysis.isLaser && f.analysis.laserColorMode === 'wheel' && f.analysis.wheelOffset !== null && f.analysis.wheelCaps.length > 0);
    const kinds: AutoLoopKind[] = [];
    if (rgb.length > 0) kinds.push('color-chase');
    if (movers.length > 0) kinds.push('movement');
    if (dimmers.length > 0) kinds.push('dimmer-pulse');
    if (shutters.length > 0) kinds.push('strobe');
    if (wheels.length > 0) kinds.push('color-wheel');
    if (gobos.length > 0) kinds.push('gobo');
    if (effects.length > 0) kinds.push('effect');
    if (prisms.length > 0) kinds.push('prism');
    if (laserPatterns.length > 0) kinds.push('laser-pattern');
    if (laserScans.length > 0) kinds.push('laser-scan');
    if (laserWheels.length > 0) kinds.push('laser-color');
    for (const k of ['zoom', 'frost', 'iris', 'focus'] as BeamChannel[]) {
      if (beams[k].length > 0) kinds.push(`beam-${k}` as AutoLoopKind);
    }
    caps.set(tier, { rgb, movers, dimmers, shutters, wheels, gobos, effects, prisms, beams, laserPatterns, laserScans, laserWheels, kinds });
  }

  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

  let seq = 0;
  const build = (tier: FixtureTier, cap: Cap, kind: AutoLoopKind): AutoLoop | undefined => {
    const speed = pick(speeds);
    const direction = pick(directions);
    let loop: AutoLoop;
    switch (kind) {
      case 'color-chase': {
        const pal = pick(PALETTES);
        loop = buildColorChase(tier, cap.rgb, pal.colors, speed, pal.name, direction);
        break;
      }
      case 'movement': {
        const pattern = pick(MOVEMENT_PATTERNS);
        const radius = 36 + Math.floor(rng() * 81); // 36..116
        loop = buildMovementLoop(tier, cap.movers, 8, radius, speed, pattern, direction, opts.positions);
        break;
      }
      case 'dimmer-pulse':
        loop = buildDimmerPulse(tier, cap.dimmers, speed);
        break;
      case 'strobe':
        loop = buildStrobeLoop(tier, cap.shutters, speed);
        break;
      case 'color-wheel':
        loop = buildColorWheelLoop(tier, cap.wheels, speed, direction);
        break;
      case 'gobo':
        loop = buildGoboLoop(tier, cap.gobos, speed, rng() < 0.5, direction);
        break;
      case 'effect':
        loop = buildEffectLoop(tier, cap.effects, speed, direction);
        break;
      case 'prism':
        loop = buildPrismLoop(tier, cap.prisms, speed);
        break;
      case 'beam-zoom':
      case 'beam-frost':
      case 'beam-iris':
      case 'beam-focus':
        loop = buildBeamLoop(tier, cap.beams[kind.slice('beam-'.length) as BeamChannel], kind, speed, direction);
        break;
      case 'laser-pattern':
        // Nombre de motifs variable (6-12) + offset de départ aléatoire : les
        // VALEURS de pattern changent vraiment d'une carte à l'autre (plus de
        // séquence 1,3,5… identique à chaque seed).
        loop = buildLaserPatternLoop(tier, cap.laserPatterns, speed, 6 + Math.floor(rng() * 7), direction, Math.floor(rng() * 8));
        break;
      case 'laser-scan':
        // Deux formes de balayage (cercle / Lissajous) : variété réelle.
        loop = buildLaserScanLoop(tier, cap.laserScans, speed, 36 + Math.floor(rng() * 81), direction, rng() < 0.5 ? 'lissajous' : 'circle');
        break;
      case 'laser-color':
        loop = buildLaserColorLoop(tier, cap.laserWheels, speed, direction);
        break;
      default:
        return undefined;
    }
    // Unique id per loop — palette/pattern alone collide across speeds/radii.
    loop.id = `${loop.id}-${seq++}`;
    return loop;
  };

  // Keep only tiers with at least one usable capability (a tier with fixtures
  // but no recognized channels — e.g. a missing def — is skipped).
  const activeTiers = tiers.filter((t) => (caps.get(t)?.kinds.length ?? 0) > 0);
  if (activeTiers.length === 0) return [];

  const loops: AutoLoop[] = [];
  const push = (loop: AutoLoop | undefined) => {
    if (loop) loops.push(loop);
  };
  // Baseline — one of each available kind per tier (guaranteed coverage).
  for (const tier of activeTiers) {
    const cap = caps.get(tier)!;
    for (const kind of cap.kinds) push(build(tier, cap, kind));
  }
  // Fill the rest with random (tier, kind) samples.
  while (loops.length < count) {
    const tier = pick(activeTiers);
    const cap = caps.get(tier)!;
    push(build(tier, cap, pick(cap.kinds)));
  }

  shuffleInPlace(loops, rng);
  return loops.slice(0, count);
}

// ─── Materialization — turn loops into playable scenes + chasers ───────────
//
// The generated loops are materialized as regular chasers: one scene per step
// (DMX channel map) and one chaser whose steps reference those scenes. The
// existing chaser engine (midi-actions / playback) plays them without any
// change. Scenes are tagged with a dedicated folder so they can be cleaned up
// and regenerated when the patch changes.

export const AUTO_LOOP_FOLDER = 'auto-loops';

/** Minimal slice of the show store needed to materialize/refresh loops. */
export interface AutoLoopStoreFacade {
  scenes: SavedScene[];
  chasers: SavedChaser[];
  createScene: (name: string) => string;
  updateScene: (
    id: string,
    updates: Partial<Pick<SavedScene, 'name' | 'channels' | 'fadeIn' | 'fadeOut' | 'duration' | 'folder'>>,
  ) => void;
  deleteScene: (id: string) => void;
  createChaser: (name: string) => string;
  updateChaser: (
    id: string,
    updates: Partial<Pick<SavedChaser, 'name' | 'steps' | 'direction' | 'speed'>>,
  ) => void;
  deleteChaser: (id: string) => void;
}

/**
 * Create one scene per loop step (tagged with AUTO_LOOP_FOLDER) and one chaser
 * referencing them. Returns the created chaser ids.
 */
export function materializeAutoLoops(loops: AutoLoop[], store: AutoLoopStoreFacade): string[] {
  const chaserIds: string[] = [];
  for (const loop of loops) {
    const holdMs = Math.max(50, Math.round(60000 / loop.speedBpm));
    const sceneIds = loop.steps.map((step, i) => {
      const sceneId = store.createScene(`${loop.name} ${i + 1}`);
      store.updateScene(sceneId, {
        name: `${loop.name} ${i + 1}`,
        channels: step.channels,
        fadeIn: 0,
        fadeOut: 0,
        duration: holdMs,
        folder: AUTO_LOOP_FOLDER,
      });
      return sceneId;
    });
    const chaserId = store.createChaser(`Auto · ${loop.name}`);
    store.updateChaser(chaserId, {
      name: `Auto · ${loop.name}`,
      steps: sceneIds.map((sceneId) => ({ sceneId, fadeIn: 0, hold: holdMs, fadeOut: 0 })),
      speed: loop.speedBpm,
      direction: loop.direction,
    });
    chaserIds.push(chaserId);
  }
  return chaserIds;
}

/**
 * Delete previously generated auto loops: scenes in AUTO_LOOP_FOLDER and the
 * chasers referencing them. Idempotent — safe to call before regenerating or
 * when the patch changes.
 */
export function purgeAutoLoops(store: AutoLoopStoreFacade): void {
  const autoSceneIds = new Set(
    store.scenes.filter((s) => s.folder === AUTO_LOOP_FOLDER).map((s) => s.id),
  );
  for (const chaser of store.chasers) {
    if (chaser.steps.some((st) => autoSceneIds.has(st.sceneId))) {
      store.deleteChaser(chaser.id);
    }
  }
  for (const sceneId of autoSceneIds) {
    store.deleteScene(sceneId);
  }
}

/**
 * Full refresh: purge previously generated auto loops, regenerate the loops
 * from the current patch and materialize them. Pure orchestration — safe to
 * call on every patch change (idempotent cleanup).
 */
export function refreshAutoLoops(
  store: AutoLoopStoreFacade,
  patchedFixtures: PatchedFixture[],
  defs: Map<string, DmxFixtureDefinition>,
  opts: AutoLoopOptions = {},
): { loops: AutoLoop[]; chaserIds: string[] } {
  purgeAutoLoops(store);
  const loops = generateAutoLoops(patchedFixtures, defs, opts);
  const chaserIds = materializeAutoLoops(loops, store);
  return { loops, chaserIds };
}

// ─── Recette portable — rejouer une boucle sur le patch courant ───────────

/** Extrait la recette portable d'une boucle générée (permet de la rejouer). */
export function loopToRecipe(loop: AutoLoop): LoopRecipe {
  return {
    kind: loop.kind,
    name: loop.name,
    tier: loop.tier,
    speedBpm: loop.speedBpm,
    direction: loop.direction,
    palette: loop.palette,
    pattern: loop.pattern,
    radius: loop.radius,
    chaseSteps: loop.chaseSteps,
    variant: loop.variant,
  };
}

/**
 * Reconstruit une boucle depuis sa recette, contre le patch courant.
 * Renvoie undefined si le tier n'a pas de fixtures capables du kind demandé
 * (ex. pas de movers pour un mouvement).
 */
export function generateLoopFromRecipe(
  recipe: LoopRecipe,
  patchedFixtures: PatchedFixture[],
  defs: Map<string, DmxFixtureDefinition>,
  positions?: Record<string, FixturePos>,
): AutoLoop | undefined {
  const byTier = analyzeTiers(patchedFixtures, defs);
  const fixtures = byTier.get(recipe.tier);
  if (!fixtures || fixtures.length === 0) return undefined;

  const rgb = fixtures.filter((f) => f.analysis.rgbSegments.length > 0);
  const movers = fixtures.filter(
    (f) => f.analysis.panOffsets.length > 0 || f.analysis.tiltOffsets.length > 0,
  );
  const dimmers = fixtures.filter(
    (f) =>
      f.analysis.intensityOffset !== null &&
      f.analysis.rgbSegments.length === 0 &&
      f.analysis.panOffsets.length === 0 &&
      f.analysis.tiltOffsets.length === 0,
  );
  const shutters = fixtures.filter((f) => f.analysis.shutterOffset !== null);

  switch (recipe.kind) {
    case 'color-chase': {
      if (rgb.length === 0) return undefined;
      const pal = PALETTES.find((p) => p.name === recipe.palette) ?? PALETTES[0];
      const colors = pal.colors.slice(0, recipe.chaseSteps ?? pal.colors.length);
      return buildColorChase(recipe.tier, rgb, colors, recipe.speedBpm, pal.name, recipe.direction);
    }
    case 'movement': {
      if (movers.length === 0) return undefined;
      const pattern = MOVEMENT_PATTERNS.find((p) => p.name === recipe.pattern) ?? MOVEMENT_PATTERNS[0];
      return buildMovementLoop(recipe.tier, movers, 8, recipe.radius ?? 64, recipe.speedBpm, pattern, recipe.direction, positions);
    }
    case 'dimmer-pulse':
      if (dimmers.length === 0) return undefined;
      return buildDimmerPulse(recipe.tier, dimmers, recipe.speedBpm);
    case 'strobe':
      if (shutters.length === 0) return undefined;
      return buildStrobeLoop(recipe.tier, shutters, recipe.speedBpm);
    case 'color-wheel': {
      const wheels = fixtures.filter(
        (f) => f.analysis.wheelOffset !== null && f.analysis.wheelCaps.length > 0 && f.analysis.rgbSegments.length === 0,
      );
      if (wheels.length === 0) return undefined;
      return buildColorWheelLoop(recipe.tier, wheels, recipe.speedBpm, recipe.direction);
    }
    case 'gobo': {
      const gobos = fixtures.filter((f) => f.analysis.goboOffset !== null && f.analysis.goboCaps.length > 0);
      if (gobos.length === 0) return undefined;
      return buildGoboLoop(recipe.tier, gobos, recipe.speedBpm, recipe.variant === 'rotate', recipe.direction);
    }
    case 'effect': {
      const effects = fixtures.filter((f) => f.analysis.effectOffset !== null && (f.analysis.effectCaps?.length ?? 0) > 0);
      if (effects.length === 0) return undefined;
      return buildEffectLoop(recipe.tier, effects, recipe.speedBpm, recipe.direction);
    }
    case 'prism': {
      const prisms = fixtures.filter((f) => f.analysis.prismOffset !== null);
      if (prisms.length === 0) return undefined;
      return buildPrismLoop(recipe.tier, prisms, recipe.speedBpm);
    }
    case 'beam-zoom':
    case 'beam-frost':
    case 'beam-iris':
    case 'beam-focus': {
      const k = recipe.kind.slice('beam-'.length) as BeamChannel;
      const beam = fixtures.filter((f) => beamOffsetOf(f.analysis, k) !== null);
      if (beam.length === 0) return undefined;
      return buildBeamLoop(recipe.tier, beam, recipe.kind, recipe.speedBpm, recipe.direction);
    }
    case 'laser-pattern': {
      const lasers = fixtures.filter((f) => f.analysis.isLaser && f.analysis.patternOffset !== null && f.analysis.patternCaps.length > 0);
      if (lasers.length === 0) return undefined;
      return buildLaserPatternLoop(recipe.tier, lasers, recipe.speedBpm, recipe.chaseSteps ?? 8, recipe.direction);
    }
    case 'laser-scan': {
      const lasers = fixtures.filter((f) => f.analysis.isLaser && (f.analysis.scanXOffset !== null || f.analysis.scanYOffset !== null));
      if (lasers.length === 0) return undefined;
      return buildLaserScanLoop(recipe.tier, lasers, recipe.speedBpm, recipe.radius ?? 90, recipe.direction, recipe.variant === 'lissajous' ? 'lissajous' : 'circle');
    }
    case 'laser-color': {
      const lasers = fixtures.filter((f) => f.analysis.isLaser && f.analysis.laserColorMode === 'wheel' && f.analysis.wheelOffset !== null && f.analysis.wheelCaps.length > 0);
      if (lasers.length === 0) return undefined;
      return buildLaserColorLoop(recipe.tier, lasers, recipe.speedBpm, recipe.direction);
    }
    default:
      return undefined;
  }
}
