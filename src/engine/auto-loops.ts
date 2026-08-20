// ─── Auto Loops — automatic looping patterns for patched fixtures ───────────
//
// Two layers:
//  1. generateAutoLoops() — one loop per kind per tier (color chase, movement,
//     dimmer pulse). Small, predictable, used as the building block.
//  2. generateLoopLibrary() — a rich, seeded "near-infinite" catalog of loop
//     variations (named palettes × movement patterns × speeds), inspired by
//     SoundSwitch's LoopAuto. Re-run with a different seed → a different set.
//
// A loop is a sequence of DMX frames (absolute address → value). Each frame is
// a self-contained lighting state; the frames repeat (forward/backward/bounce)
// at `speedBpm`. materializeAutoLoops() turns loops into playable scenes +
// chasers (the existing chaser engine plays them unchanged).

import type { PatchedFixture, FixtureTier, SavedScene, SavedChaser } from '../stores/showStore';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';
import { analyzeChannels, type ChannelAnalysis } from './dmx-channel';

export type AutoLoopKind = 'color-chase' | 'movement' | 'dimmer-pulse' | 'strobe';

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
}

export interface LoopLibraryOptions {
  /** How many loops to return. Default 32. */
  count?: number;
  /** Seed for reproducible variety. Change it to get a new set. Default 0. */
  seed?: number;
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

/** Movement shapes for the loop library (and generateAutoLoops default). */
const MOVEMENT_PATTERNS: MovementPattern[] = [
  { name: 'circle', at: (t, r) => [DMX_CENTER + r * Math.cos(2 * Math.PI * t), DMX_CENTER + r * Math.sin(2 * Math.PI * t)] },
  {
    name: 'square',
    at: (t, r) => {
      const c = Math.cos(2 * Math.PI * t);
      const s = Math.sin(2 * Math.PI * t);
      const m = Math.max(Math.abs(c), Math.abs(s)) || 1;
      return [DMX_CENTER + r * (c / m), DMX_CENTER + r * (s / m)];
    },
  },
  { name: 'figure8', at: (t, r) => [DMX_CENTER + r * Math.sin(2 * Math.PI * t), DMX_CENTER + r * Math.sin(4 * Math.PI * t)] },
  { name: 'zigzag', at: (t, r) => [DMX_CENTER + r * Math.sin(4 * Math.PI * t), DMX_CENTER + r * (2 * t - 1)] },
  { name: 'sweep', at: (t, r) => [DMX_CENTER + r * Math.sin(2 * Math.PI * t), DMX_CENTER] },
];

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
  for (const seg of analysis.rgbSegments) {
    put(frame, absAddr(pf, seg.r), c[0]);
    put(frame, absAddr(pf, seg.g), c[1]);
    put(frame, absAddr(pf, seg.b), c[2]);
    if (seg.w !== null) put(frame, absAddr(pf, seg.w), 0);
  }
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
): AutoLoop {
  const amp = Math.max(0, Math.min(128, radius));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < movementSteps; step++) {
    const [pan, tilt] = pattern.at(step / movementSteps, amp);
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      for (const off of analysis.panOffsets) put(frame, absAddr(pf, off), pan);
      for (const off of analysis.tiltOffsets) put(frame, absAddr(pf, off), tilt);
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

    if (rgb.length > 0) loops.push(buildColorChase(tier, rgb, CHASE_COLORS.slice(0, chaseSteps), speedBpm));
    if (movers.length > 0) loops.push(buildMovementLoop(tier, movers, movementSteps, movementRadius, speedBpm));
    if (dimmers.length > 0) loops.push(buildDimmerPulse(tier, dimmers, speedBpm));
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
    const kinds: AutoLoopKind[] = [];
    if (rgb.length > 0) kinds.push('color-chase');
    if (movers.length > 0) kinds.push('movement');
    if (dimmers.length > 0) kinds.push('dimmer-pulse');
    if (shutters.length > 0) kinds.push('strobe');
    caps.set(tier, { rgb, movers, dimmers, shutters, kinds });
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
        loop = buildMovementLoop(tier, cap.movers, 8, radius, speed, pattern, direction);
        break;
      }
      case 'dimmer-pulse':
        loop = buildDimmerPulse(tier, cap.dimmers, speed);
        break;
      case 'strobe':
        loop = buildStrobeLoop(tier, cap.shutters, speed);
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
