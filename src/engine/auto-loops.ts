// ─── Auto Loops — automatic looping patterns for patched fixtures ───────────
//
// Generates loop definitions (color chases, movement circles, dimmer pulses)
// from the show's patched fixtures, grouped by tier (primary → secondary →
// tertiary → other). Pure logic, no side effects: re-running it with a changed
// patch list naturally regenerates the loops, so "fixtures à venir" are picked
// up automatically as soon as they are patched.
//
// A loop is a sequence of DMX frames (absolute address → value). Each frame is
// a self-contained lighting state; the frames repeat (forward/backward/bounce)
// at `speedBpm`. This shape maps directly onto the existing chaser/scene model
// (a chaser step references a scene, a scene is a DMX channel map).

import type { PatchedFixture, FixtureTier, SavedScene, SavedChaser } from '../stores/showStore';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';
import { analyzeChannels, type ChannelAnalysis } from './dmx-channel';

export type AutoLoopKind = 'color-chase' | 'movement' | 'dimmer-pulse';

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

const TIER_ORDER: FixtureTier[] = ['primary', 'secondary', 'tertiary', 'other'];

/** Default chase palette — violet family + ivory, matched to the app theme. */
const CHASE_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [168, 85, 247],
  [139, 92, 246],
  [192, 132, 252],
  [237, 232, 220],
];

const DMX_CENTER = 128;

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

function buildColorChase(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  colors: ReadonlyArray<readonly [number, number, number]>,
  speedBpm: number,
): AutoLoop {
  const steps: AutoLoopStep[] = colors.map((_, stepIdx) => {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      // Rotating chase: fixture i shows color (i + stepIdx) % colors.length.
      const c = colors[(i + stepIdx) % colors.length];
      for (const seg of analysis.rgbSegments) {
        put(frame, absAddr(pf, seg.r), c[0]);
        put(frame, absAddr(pf, seg.g), c[1]);
        put(frame, absAddr(pf, seg.b), c[2]);
        if (seg.w !== null) put(frame, absAddr(pf, seg.w), 0);
      }
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      // Open the shutter so the color is actually visible.
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    return { channels: frame };
  });

  return {
    id: `auto-cc-${tier}`,
    name: `Color chase · ${tier}`,
    tier,
    kind: 'color-chase',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction: 'forward',
  };
}

function buildMovementLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],
  movementSteps: number,
  radius: number,
  speedBpm: number,
): AutoLoop {
  const amp = Math.max(0, Math.min(128, radius));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < movementSteps; step++) {
    const angle = (step / movementSteps) * Math.PI * 2;
    const pan = DMX_CENTER + amp * Math.cos(angle);
    const tilt = DMX_CENTER + amp * Math.sin(angle);
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      for (const off of analysis.panOffsets) put(frame, absAddr(pf, off), pan);
      for (const off of analysis.tiltOffsets) put(frame, absAddr(pf, off), tilt);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }

  return {
    id: `auto-mv-${tier}`,
    name: `Movement · ${tier}`,
    tier,
    kind: 'movement',
    fixtureIds: fixtures.map((f) => f.pf.id),
    steps,
    speedBpm,
    direction: 'forward',
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

/**
 * Generate automatic loops for the patched fixtures, grouped by tier.
 *
 * Disabled fixtures (`enabled === false`) are skipped. For each non-empty tier
 * up to three loops are produced: a color chase (RGB fixtures), a movement
 * circle (pan/tilt fixtures) and a dimmer pulse (intensity-only fixtures).
 * Fixtures with both RGB and pan/tilt appear in both the color chase and the
 * movement loop.
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

  const active = patchedFixtures.filter((f) => f.enabled !== false);
  const loops: AutoLoop[] = [];

  for (const tier of TIER_ORDER) {
    const fixtures: AnalyzedFixture[] = [];
    for (const pf of active) {
      if (pf.tier !== tier) continue;
      fixtures.push({ pf, analysis: analyzeChannels(pf, defs.get(pf.fixtureDefId)) });
    }
    if (fixtures.length === 0) continue;

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

    if (rgb.length > 0) {
      loops.push(buildColorChase(tier, rgb, CHASE_COLORS.slice(0, chaseSteps), speedBpm));
    }
    if (movers.length > 0) {
      loops.push(buildMovementLoop(tier, movers, movementSteps, movementRadius, speedBpm));
    }
    if (dimmers.length > 0) {
      loops.push(buildDimmerPulse(tier, dimmers, speedBpm));
    }
  }

  return loops;
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
 * Full refresh: delete previously generated auto loops (scenes in
 * AUTO_LOOP_FOLDER and the chasers referencing them), regenerate the loops
 * from the current patch and materialize them. Pure orchestration — safe to
 * call on every patch change (idempotent cleanup).
 */
export function refreshAutoLoops(
  store: AutoLoopStoreFacade,
  patchedFixtures: PatchedFixture[],
  defs: Map<string, DmxFixtureDefinition>,
  opts: AutoLoopOptions = {},
): { loops: AutoLoop[]; chaserIds: string[] } {
  const autoSceneIds = new Set(
    store.scenes.filter((s) => s.folder === AUTO_LOOP_FOLDER).map((s) => s.id),
  );

  // Delete chasers whose steps reference an auto-generated scene.
  for (const chaser of store.chasers) {
    if (chaser.steps.some((st) => autoSceneIds.has(st.sceneId))) {
      store.deleteChaser(chaser.id);
    }
  }
  for (const sceneId of autoSceneIds) {
    store.deleteScene(sceneId);
  }

  const loops = generateAutoLoops(patchedFixtures, defs, opts);
  const chaserIds = materializeAutoLoops(loops, store);
  return { loops, chaserIds };
}
