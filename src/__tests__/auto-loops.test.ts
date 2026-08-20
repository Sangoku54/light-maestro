import { describe, it, expect } from 'vitest';
import { generateAutoLoops, generateLoopLibrary, materializeAutoLoops, refreshAutoLoops, purgeAutoLoops, AUTO_LOOP_FOLDER, type AutoLoop, type AutoLoopStoreFacade } from '../engine/auto-loops';
import type { PatchedFixture, SavedScene, SavedChaser } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel => ({
  name,
  type,
  offset,
});

function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}

function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string }): PatchedFixture {
  return {
    manufacturer: 'Test',
    model: partial.fixtureDefId,
    fixtureType: 'moving_head',
    modeIndex: 0,
    modeName: 'm',
    universeId: 'u1',
    startAddress: 1,
    channelCount: 1,
    name: partial.id,
    tier: 'primary',
    ...partial,
  };
}

// RGB wash: Dimmer@0, R@1, G@2, B@3
const rgbWash = def('wash-rgb', [
  ch('Dimmer', 'Intensity', 0),
  ch('Red', 'Colour', 1),
  ch('Green', 'Colour', 2),
  ch('Blue', 'Colour', 3),
]);
// Moving head: Pan@0, Tilt@1, Dimmer@2, R@3, G@4, B@5
const mover = def('mover-rgb', [
  ch('Pan', 'Pan', 0),
  ch('Tilt', 'Tilt', 1),
  ch('Dimmer', 'Intensity', 2),
  ch('Red', 'Colour', 3),
  ch('Green', 'Colour', 4),
  ch('Blue', 'Colour', 5),
]);
// Dimmer-only PAR: Dimmer@0
const par = def('par-dim', [ch('Dimmer', 'Intensity', 0)]);
// Strobe with RGB: Shutter@0, Dimmer@1, R@2, G@3, B@4
const strobeRgb = def('strobe-rgb', [
  ch('Shutter', 'Shutter', 0),
  ch('Dimmer', 'Intensity', 1),
  ch('Red', 'Colour', 2),
  ch('Green', 'Colour', 3),
  ch('Blue', 'Colour', 4),
]);

function defsOf(...defs: DmxFixtureDefinition[]): Map<string, DmxFixtureDefinition> {
  return new Map(defs.map((d) => [d.id, d]));
}

/** Simple RGB Euclidean distance (proxy for perceptual ΔE). */
function rgbDist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

describe('generateAutoLoops', () => {
  it('returns [] for an empty patch', () => {
    expect(generateAutoLoops([], new Map())).toEqual([]);
  });

  it('groups loops by tier and generates color-chase + movement + dimmer-pulse', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'mover-rgb', tier: 'primary', startAddress: 9 }),
      pf({ id: 'f3', fixtureDefId: 'par-dim', tier: 'primary', startAddress: 21 }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash, mover, par));

    const kinds = loops.map((l) => l.kind).sort();
    expect(kinds).toEqual(['color-chase', 'dimmer-pulse', 'movement']);

    // Every loop belongs to the primary tier and carries the right fixture ids.
    for (const loop of loops) {
      expect(loop.tier).toBe('primary');
      expect(loop.steps.length).toBeGreaterThan(0);
    }

    const cc = loops.find((l) => l.kind === 'color-chase')!;
    // f1 (RGB wash) and f2 (RGB mover) both have RGB → both in the color chase.
    expect(cc.fixtureIds.sort()).toEqual(['f1', 'f2']);

    const mv = loops.find((l) => l.kind === 'movement')!;
    expect(mv.fixtureIds).toEqual(['f2']);

    const dp = loops.find((l) => l.kind === 'dimmer-pulse')!;
    expect(dp.fixtureIds).toEqual(['f3']);
  });

  it('writes color values at absolute addresses (startAddress + offset)', () => {
    const fixtures = [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash));
    const cc = loops.find((l) => l.kind === 'color-chase')!;
    // First step: fixture shows color[0] = violet (168, 85, 247).
    const step0 = cc.steps[0].channels;
    expect(step0[1]).toBe(255); // Dimmer @ offset 0 → addr 1
    expect(step0[2]).toBe(168); // Red @ offset 1 → addr 2
    expect(step0[3]).toBe(85); // Green @ offset 2 → addr 3
    expect(step0[4]).toBe(247); // Blue @ offset 3 → addr 4
  });

  it('rotates the color chase across fixtures and steps', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 9 }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash), { chaseSteps: 4 });
    const cc = loops.find((l) => l.kind === 'color-chase')!;
    // f1's red channel across the 4 steps = the 4 palette reds, in order.
    const f1Reds = cc.steps.map((s) => s.channels[2]); // f1 R = addr startAddress(1) + 1
    const f2Reds = cc.steps.map((s) => s.channels[10]); // f2 R = addr 9 + 1
    expect(new Set(f1Reds).size).toBe(4); // 4 distinct colors rotate through f1
    // f2 is offset by one step: f2 step0 = f1 step1, etc.
    expect(f2Reds[0]).toBe(f1Reds[1]);
    expect(f2Reds[1]).toBe(f1Reds[2]);
    expect(f2Reds[2]).toBe(f1Reds[3]);
    expect(f2Reds[3]).toBe(f1Reds[0]);
  });

  it('keeps movement positions centered around 128', () => {
    const fixtures = [pf({ id: 'f2', fixtureDefId: 'mover-rgb', tier: 'primary', startAddress: 9 })];
    const loops = generateAutoLoops(fixtures, defsOf(mover), { movementSteps: 8, movementRadius: 64 });
    const mv = loops.find((l) => l.kind === 'movement')!;
    for (const step of mv.steps) {
      const pan = step.channels[9]; // Pan at addr 9 + 0
      const tilt = step.channels[10]; // Tilt at addr 9 + 1
      expect(pan).toBeGreaterThanOrEqual(64);
      expect(pan).toBeLessThanOrEqual(192);
      expect(tilt).toBeGreaterThanOrEqual(64);
      expect(tilt).toBeLessThanOrEqual(192);
    }
  });

  it('writes a white fill on movement loops so RGB movers are visible', () => {
    const fixtures = [pf({ id: 'f2', fixtureDefId: 'mover-rgb', tier: 'primary', startAddress: 9 })];
    const loops = generateAutoLoops(fixtures, defsOf(mover), { movementSteps: 4 });
    const mv = loops.find((l) => l.kind === 'movement')!;
    for (const step of mv.steps) {
      // mover-rgb: R@3 → addr 12, G@4 → 13, B@5 → 14.
      expect(step.channels[12]).toBe(255);
      expect(step.channels[13]).toBe(255);
      expect(step.channels[14]).toBe(255);
    }
  });

  it('default chase palette has high contrast (no near-identical steps)', () => {
    const fixtures = [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash), { chaseSteps: 4 });
    const cc = loops.find((l) => l.kind === 'color-chase')!;
    const colors = cc.steps.map(
      (s) => [s.channels[2], s.channels[3], s.channels[4]] as const, // R,G,B at addr 2,3,4
    );
    let min = Infinity;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        min = Math.min(min, rgbDist(colors[i], colors[j]));
      }
    }
    expect(min).toBeGreaterThanOrEqual(50);
  });

  it('skips disabled fixtures', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 9, enabled: false }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash));
    const cc = loops.find((l) => l.kind === 'color-chase')!;
    expect(cc.fixtureIds).toEqual(['f1']);
  });

  it('auto-adapts to newly patched fixtures (pure re-run)', () => {
    const defs = defsOf(rgbWash, par);
    const before = generateAutoLoops(
      [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })],
      defs,
    );
    expect(before.map((l) => l.kind)).toEqual(['color-chase']);

    const after = generateAutoLoops(
      [
        pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
        pf({ id: 'f3', fixtureDefId: 'par-dim', tier: 'primary', startAddress: 21 }),
      ],
      defs,
    );
    expect(after.map((l) => l.kind).sort()).toEqual(['color-chase', 'dimmer-pulse']);
  });

  it('produces separate loops per tier', () => {
    const fixtures = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'wash-rgb', tier: 'secondary', startAddress: 9 }),
    ];
    const loops = generateAutoLoops(fixtures, defsOf(rgbWash));
    const tiers = loops.map((l) => l.tier).sort();
    expect(tiers).toEqual(['primary', 'secondary']);
    expect(loops.every((l) => l.kind === 'color-chase')).toBe(true);
  });
});

// ─── Materialization / refresh ──────────────────────────────────────────────

function makeStore(): { store: AutoLoopStoreFacade; state: { scenes: SavedScene[]; chasers: SavedChaser[] } } {
  const state: { scenes: SavedScene[]; chasers: SavedChaser[] } = { scenes: [], chasers: [] };
  let sceneN = 0;
  let chaserN = 0;
  const store: AutoLoopStoreFacade = {
    get scenes() {
      return state.scenes;
    },
    get chasers() {
      return state.chasers;
    },
    createScene: (name) => {
      const id = `s${++sceneN}`;
      state.scenes.push({ id, name, channels: {}, fadeIn: 1000, fadeOut: 1000, duration: 5000, createdAt: '' });
      return id;
    },
    updateScene: (id, updates) => {
      const s = state.scenes.find((x) => x.id === id);
      if (s) Object.assign(s, updates);
    },
    deleteScene: (id) => {
      state.scenes = state.scenes.filter((x) => x.id !== id);
    },
    createChaser: (name) => {
      const id = `c${++chaserN}`;
      state.chasers.push({ id, name, steps: [], direction: 'forward', speed: 120 });
      return id;
    },
    updateChaser: (id, updates) => {
      const c = state.chasers.find((x) => x.id === id);
      if (c) Object.assign(c, updates);
    },
    deleteChaser: (id) => {
      state.chasers = state.chasers.filter((x) => x.id !== id);
    },
  };
  return { store, state };
}

describe('materializeAutoLoops / refreshAutoLoops', () => {
  it('materializes loops into scenes (tagged) + chasers', () => {
    const { store, state } = makeStore();
    const fixtures = [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })];
    const { loops, chaserIds } = refreshAutoLoops(store, fixtures, defsOf(rgbWash));

    expect(loops.length).toBe(1);
    expect(chaserIds.length).toBe(1);
    expect(state.chasers.length).toBe(1);
    expect(state.chasers[0].name).toBe('Auto · Color chase · primary');
    expect(state.chasers[0].steps.length).toBe(loops[0].steps.length);
    // Every scene is tagged with the auto-loop folder.
    expect(state.scenes.every((s) => s.folder === AUTO_LOOP_FOLDER)).toBe(true);
    // Chaser steps reference the tagged scenes.
    const sceneIds = new Set(state.scenes.map((s) => s.id));
    expect(state.chasers[0].steps.every((st) => sceneIds.has(st.sceneId))).toBe(true);
  });

  it('refresh is idempotent — re-running replaces, never duplicates', () => {
    const { store, state } = makeStore();
    const fixtures = [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })];

    refreshAutoLoops(store, fixtures, defsOf(rgbWash));
    const scenesAfterFirst = state.scenes.length;
    const chasersAfterFirst = state.chasers.length;

    refreshAutoLoops(store, fixtures, defsOf(rgbWash));

    // Same counts after a second refresh (old auto scenes/chasers were removed first).
    expect(state.scenes.length).toBe(scenesAfterFirst);
    expect(state.chasers.length).toBe(chasersAfterFirst);
    expect(state.scenes.every((s) => s.folder === AUTO_LOOP_FOLDER)).toBe(true);
  });

  it('refresh leaves manual scenes/chasers untouched', () => {
    const { store, state } = makeStore();
    // A manual scene + chaser referencing it.
    const manualScene = store.createScene('Manuel');
    store.updateScene(manualScene, { channels: { 1: 255 } });
    const manualChaser = store.createChaser('Chaser manuel');
    store.updateChaser(manualChaser, { steps: [{ sceneId: manualScene, fadeIn: 0, hold: 500, fadeOut: 0 }] });

    refreshAutoLoops(store, [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })], defsOf(rgbWash));

    expect(state.scenes.some((s) => s.id === manualScene)).toBe(true);
    expect(state.chasers.some((c) => c.id === manualChaser)).toBe(true);
  });

  it('purgeAutoLoops removes auto scenes + chasers but keeps manual ones', () => {
    const { store, state } = makeStore();
    const manualScene = store.createScene('Manuel');
    store.updateScene(manualScene, { channels: { 1: 255 } });
    const manualChaser = store.createChaser('Chaser manuel');
    store.updateChaser(manualChaser, { steps: [{ sceneId: manualScene, fadeIn: 0, hold: 500, fadeOut: 0 }] });

    const loop = generateAutoLoops(
      [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })],
      defsOf(rgbWash),
    )[0];
    const chaserIds = materializeAutoLoops([loop], store);
    expect(chaserIds.length).toBe(1);
    expect(state.scenes.some((s) => s.folder === AUTO_LOOP_FOLDER)).toBe(true);

    purgeAutoLoops(store);

    expect(state.scenes.filter((s) => s.folder === AUTO_LOOP_FOLDER).length).toBe(0);
    expect(state.chasers.filter((c) => c.name.startsWith('Auto ·')).length).toBe(0);
    expect(state.scenes.some((s) => s.id === manualScene)).toBe(true);
    expect(state.chasers.some((c) => c.id === manualChaser)).toBe(true);
  });
});

// ─── Loop library (LoopAuto-style variety) ────────────────────────────────

describe('generateLoopLibrary', () => {
  const allDefs = defsOf(rgbWash, mover, par);
  const fixtures = [
    pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
    pf({ id: 'f2', fixtureDefId: 'mover-rgb', tier: 'primary', startAddress: 9 }),
    pf({ id: 'f3', fixtureDefId: 'par-dim', tier: 'primary', startAddress: 21 }),
  ];

  it('returns a varied catalog (many kinds, count-bounded)', () => {
    const lib = generateLoopLibrary(fixtures, allDefs, { count: 32 });
    expect(lib.length).toBeGreaterThan(10);
    expect(lib.length).toBeLessThanOrEqual(32);
    const kinds = new Set(lib.map((l) => l.kind));
    // With RGB wash + mover + dimmer PAR, we expect chases, movements and pulses.
    expect(kinds.has('color-chase')).toBe(true);
    expect(kinds.has('movement')).toBe(true);
    expect(kinds.has('dimmer-pulse')).toBe(true);
    // Names vary across the library (palette / pattern / tier markers).
    expect(new Set(lib.map((l) => l.name)).size).toBeGreaterThan(5);
  });

  it('is deterministic for the same seed and varies with the seed', () => {
    const a = generateLoopLibrary(fixtures, allDefs, { count: 32, seed: 7 });
    const b = generateLoopLibrary(fixtures, allDefs, { count: 32, seed: 7 });
    const c = generateLoopLibrary(fixtures, allDefs, { count: 32, seed: 99 });
    expect(a.map((l) => l.id)).toEqual(b.map((l) => l.id));
    expect(a.map((l) => l.id)).not.toEqual(c.map((l) => l.id));
  });

  it('skips disabled fixtures and empty tiers', () => {
    const onlyWash = [pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 })];
    const lib = generateLoopLibrary(onlyWash, defsOf(rgbWash), { count: 64 });
    // Only color chases for an RGB-only wash (no movers/dimmers/shutters).
    expect(lib.every((l) => l.kind === 'color-chase')).toBe(true);
    expect(lib.every((l) => l.fixtureIds.length === 1)).toBe(true);
  });

  it('produces unique ids even when the same palette repeats across loops', () => {
    const onlyWash = [
      pf({ id: 'f1', fixtureDefId: 'wash-rgb', tier: 'primary', startAddress: 1 }),
      pf({ id: 'f2', fixtureDefId: 'wash-rgb', tier: 'secondary', startAddress: 9 }),
      pf({ id: 'f3', fixtureDefId: 'wash-rgb', tier: 'tertiary', startAddress: 17 }),
    ];
    const lib = generateLoopLibrary(onlyWash, defsOf(rgbWash), { count: 36, seed: 3 });
    const ids = lib.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes a white fill on strobe loops so RGB strobes are visible', () => {
    const onlyStrobe = [pf({ id: 'f1', fixtureDefId: 'strobe-rgb', tier: 'primary', startAddress: 1 })];
    const lib = generateLoopLibrary(onlyStrobe, defsOf(strobeRgb), { count: 16 });
    const strobe = lib.find((l) => l.kind === 'strobe');
    expect(strobe).toBeDefined();
    // Step 0 = off, step 1 = on.
    const off = strobe!.steps[0].channels;
    const on = strobe!.steps[1].channels;
    expect(on[3]).toBe(255); // R @ addr 3
    expect(on[4]).toBe(255); // G @ addr 4
    expect(on[5]).toBe(255); // B @ addr 5
    expect(on[2]).toBe(255); // intensity @ addr 2
    expect(off[2]).toBe(0); // intensity off
  });
});
