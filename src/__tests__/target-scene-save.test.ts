import { describe, it, expect } from 'vitest';
import {
  solvePanTilt,
  solveTiltForFixedPan,
  PAN_FULL_SPAN,
  TILT_FULL_SPAN,
  type PanTiltOpts,
  type Vec3,
} from '../engine/aim-target';

// Vérifie que la boucle SAVE complète du mode Target conserve la convergence :
//   Target (écrit pan/tilt programmeur LTP 85) → Record scène (ProgrammerBar
//   crée/merge `scene.channels` aux adresses DMX absolues) → saveProject
//   (JSON du projet) → rechargement → DesignView push `scene.channels` vers
//   le moteur DMX → Stage3D lit `baseAddr + offset` et réoriente les têtes.
// Les étapes sont répliquées fidèlement (mêmes formules/adresses), sans app.

// Modèle exact du rendu Stage3D (même formule que aim-target.test.ts).
function renderDir(panVal: number, tiltVal: number, o: PanTiltOpts): Vec3 {
  const phi = o.headingRad + ((panVal / 255) - 0.5) * PAN_FULL_SPAN;
  const alpha = o.armRotX + o.mountTilt + ((tiltVal / 255) - 0.5) * TILT_FULL_SPAN + o.staticTilt;
  return {
    x: -Math.sin(alpha) * Math.sin(phi),
    y: -Math.cos(alpha),
    z: -Math.sin(alpha) * Math.cos(phi),
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function toTarget(origin: Vec3, target: Vec3): Vec3 {
  return normalize({ x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z });
}

interface ChannelMap { panOffset: number; tiltOffset: number; panOffsets?: number[] | null; tiltOffsets?: number[] | null; intensityOffset?: number | null; rgbOffsets?: number[] | null; wheelOffset?: number | null; wheelCaps?: Array<{ color?: string; min: number; max: number }> | null; strobeOffset?: number | null; shutterOffset?: number | null; }
interface ExtraHead { tiltOffset: number; origin: Vec3; mountTilt?: number }

interface Fixture {
  id: string;
  startAddress: number;
  cm: ChannelMap;
  /** Pose 3D de la tête principale. */
  o: PanTiltOpts;
  origin: Vec3;
  extraHeads?: ExtraHead[];
}

const LOOK_NULLS: Pick<ChannelMap, 'intensityOffset' | 'wheelOffset' | 'wheelCaps' | 'strobeOffset' | 'shutterOffset'> = {
  intensityOffset: null,
  wheelOffset: null,
  wheelCaps: null,
  strobeOffset: null,
  shutterOffset: null,
};

/** Réplique de `aimFixturesAtPoint` : adresses écrites = startAddress + offset. */
function targetAim(prog: Record<number, number>, fx: Fixture, point: Vec3, opts?: { live?: Record<number, number>; panCurrent?: number }) {
  if (fx.cm.panOffset === null || fx.cm.tiltOffset === null) return;
  const cm = { ...LOOK_NULLS, ...fx.cm, rgbOffsets: fx.cm.rgbOffsets ?? null, strobeOffset: fx.cm.strobeOffset ?? null };
  const curPan = prog[fx.startAddress + cm.panOffset] ?? opts?.panCurrent ?? 128;
  const solved = solvePanTilt(fx.origin, point, { ...fx.o, panCurrent: curPan });
  if (!solved) return;
  for (const off of (cm.panOffsets ?? [])) prog[fx.startAddress + off] = solved.pan;
  if (!(cm.panOffsets ?? []).includes(cm.panOffset)) prog[fx.startAddress + cm.panOffset] = solved.pan;
  for (const off of (cm.tiltOffsets ?? [])) prog[fx.startAddress + off] = solved.tilt;
  if (!(cm.tiltOffsets ?? []).includes(cm.tiltOffset)) prog[fx.startAddress + cm.tiltOffset] = solved.tilt;
  for (const eh of fx.extraHeads ?? []) {
    const sub = solveTiltForFixedPan(eh.origin, point, solved.phi, {
      headingRad: fx.o.headingRad,
      mountTilt: eh.mountTilt ?? fx.o.mountTilt,
      staticTilt: fx.o.staticTilt,
      armRotX: fx.o.armRotX,
    });
    if (sub) prog[fx.startAddress + eh.tiltOffset] = sub.tilt;
  }
  // Capture « look » (dimmer, couleur, strobe, shutter) depuis le live.
  const live = opts?.live ?? {};
  const readLive = (off: number): number | undefined => {
    const v = live[fx.startAddress + off];
    return typeof v === 'number' ? v : undefined;
  };
  if (cm.intensityOffset !== null && cm.intensityOffset !== undefined && cm.intensityOffset >= 0) {
    const v = readLive(cm.intensityOffset) ?? 0;
    prog[fx.startAddress + cm.intensityOffset] = v > 0 ? v : 255;
  }
  if (cm.rgbOffsets !== null && cm.rgbOffsets !== undefined && cm.rgbOffsets.length > 0) {
    const any = cm.rgbOffsets.some((o) => (readLive(o) ?? 0) > 0);
    for (const o of cm.rgbOffsets) prog[fx.startAddress + o] = any ? (readLive(o) ?? 0) : 255;
  } else if (cm.wheelOffset !== null && cm.wheelOffset !== undefined && cm.wheelOffset >= 0) {
    const v = readLive(cm.wheelOffset) ?? 0;
    let wv = v;
    if (v <= 2) {
      const white = cm.wheelCaps?.find((c) => {
        const n = (c.color ?? '').toLowerCase();
        return n === 'white' || n === 'open' || /^#fff/i.test(n);
      }) ?? cm.wheelCaps?.[0];
      wv = white ? Math.round((white.min + white.max) / 2) : 255;
    }
    prog[fx.startAddress + cm.wheelOffset] = wv;
  }
  if (cm.strobeOffset !== null && cm.strobeOffset !== undefined && cm.strobeOffset >= 0) {
    prog[fx.startAddress + cm.strobeOffset] = readLive(cm.strobeOffset) ?? 0;
  }
  if (cm.shutterOffset !== null && cm.shutterOffset !== undefined && cm.shutterOffset >= 0) {
    const v = readLive(cm.shutterOffset) ?? 255;
    prog[fx.startAddress + cm.shutterOffset] = v > 31 ? v : 255;
  }
}

/** Réplique de ProgrammerBar.handleStore (mode new) : scène = copie du programmeur. */
function recordNewScene(name: string, prog: Record<number, number>): { id: string; name: string; channels: Record<number, number> } {
  return { id: `sc_${Math.random().toString(36).slice(2, 8)}`, name, channels: { ...prog } };
}

/** Réplique de ProgrammerBar.handleStore (mode update) : merge des canaux programmeur. */
function updateSceneChannels(sc: { channels: Record<number, number> }, prog: Record<number, number>): void {
  const merged: Record<number, number> = { ...sc.channels };
  for (const [k, v] of Object.entries(prog)) merged[Number(k)] = v;
  sc.channels = merged;
}

/** Réplique saveProject → rechargement : les scènes survivent au JSON. */
function saveReloadScenes(scenes: Array<{ id: string; name: string; channels: Record<number, number> }>) {
  const json = JSON.stringify({ schemaVersion: 1, showStore: { scenes } });
  return (JSON.parse(json) as { showStore: { scenes: typeof scenes } }).showStore.scenes;
}

/** Réplique DesignView : push des canaux de scène vers le buffer DMX (adresses absolues). */
function pushSceneToBuffer(buffer: Uint8Array, channels: Record<number, number>): void {
  for (const [k, v] of Object.entries(channels)) buffer[Number(k)] = v;
}

/** Réplique Stage3D : lecture pan/tilt aux adresses baseAddr + offset. */
function readFixtureFromBuffer(buffer: Uint8Array, fx: Fixture) {
  const panVal = buffer[fx.startAddress + fx.cm.panOffset] ?? 128;
  const tiltVal = buffer[fx.startAddress + fx.cm.tiltOffset] ?? 128;
  return { panVal, tiltVal };
}

const TOL = 0.999;

function assertFixtureBeam(buffer: Uint8Array, fx: Fixture, point: Vec3) {
  const { panVal, tiltVal } = readFixtureFromBuffer(buffer, fx);
  const dir = renderDir(panVal, tiltVal, fx.o);
  const aim = toTarget(fx.origin, point);
  expect(dot(dir, aim)).toBeGreaterThan(TOL);
}

describe('mode Target — sauvegarde de scène conservée (Record → save → reload → convergence)', () => {
  it('nouvelle scène : pan/tilt DMX aux adresses absolues puis re-convergence après rechargement', () => {
    const fx: Fixture = {
      id: 'B1',
      startAddress: 1,
      cm: { panOffset: 6, tiltOffset: 7 },
      o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 },
      origin: { x: 0, y: 5.5, z: 0 },
    };
    const point = { x: 2.2, y: 0.3, z: -3.1 };

    const prog: Record<number, number> = {};
    targetAim(prog, fx, point);

    expect(prog[1 + 6]).toBeTypeOf('number');
    expect(prog[1 + 7]).toBeTypeOf('number');
    expect(prog[1 + 6]).toBeGreaterThanOrEqual(0);
    expect(prog[1 + 6]).toBeLessThanOrEqual(255);
    expect(prog[1 + 7]).toBeGreaterThanOrEqual(0);
    expect(prog[1 + 7]).toBeLessThanOrEqual(255);

    // Record (ProgrammerBar) puis sauvegarde / rechargement du projet.
    const scenes = recordNewScene('Scene Target 1', prog);
    const reloaded = saveReloadScenes([scenes]);
    expect(reloaded[0].channels).toEqual(scenes.channels);

    // Rejeu de la scène dans le buffer DMX puis lecture 3D.
    const buffer = new Uint8Array(513);
    pushSceneToBuffer(buffer, reloaded[0].channels);
    assertFixtureBeam(buffer, fx, point);
  });

  it('multi-bras (Tonio-like) : chaque bras re-converge après save → reload', () => {
    const fx: Fixture = {
      id: 'T1',
      startAddress: 101,
      cm: { panOffset: 0, tiltOffset: 1 },
      o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 },
      origin: { x: 5, y: 5.5, z: -1 },
      extraHeads: [
        { tiltOffset: 3, origin: { x: 4.15, y: 5.5, z: -1 } },
        { tiltOffset: 5, origin: { x: 4.85, y: 5.5, z: -1 } },
      ],
    };
    const point = { x: 0, y: 0.4, z: 0 };

    const prog: Record<number, number> = {};
    targetAim(prog, fx, point);

    // Le pan est partagé ; chaque tête a son tilt (adresses strictes de l'analyzer).
    expect(prog[101 + 0]).toBeTypeOf('number'); // pan commun
    expect(prog[101 + 1]).toBeTypeOf('number'); // tilt tête principale
    expect(prog[101 + 3]).toBeTypeOf('number'); // tilt bras 1
    expect(prog[101 + 5]).toBeTypeOf('number'); // tilt bras 2

    const reloaded = saveReloadScenes([recordNewScene('Scene Tonio', prog)]);
    const buffer = new Uint8Array(513);
    pushSceneToBuffer(buffer, reloaded[0].channels);

    assertFixtureBeam(buffer, fx, point);
    expect(dot(renderDir(readFixtureFromBuffer(buffer, fx).panVal, buffer[101 + 3], { ...fx.o, mountTilt: 0, armRotX: 0 }), toTarget(fx.extraHeads![0].origin, point))).toBeGreaterThan(TOL);
    expect(dot(renderDir(readFixtureFromBuffer(buffer, fx).panVal, buffer[101 + 5], { ...fx.o, mountTilt: 0, armRotX: 0 }), toTarget(fx.extraHeads![1].origin, point))).toBeGreaterThan(TOL);
  });

  it('mode update : merge dans une scène existante sans perdre les canaux précédents, convergence conservée', () => {
    const existing = recordNewScene('Scene A', { 5: 200, 102: 130 });
    const fx: Fixture = {
      id: 'B2',
      startAddress: 50,
      cm: { panOffset: 1, tiltOffset: 2 },
      o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 },
      origin: { x: -3, y: 5.5, z: 1 },
    };
    const point = { x: 1.5, y: 0.2, z: -2 };

    const prog: Record<number, number> = {};
    targetAim(prog, fx, point);

    updateSceneChannels(existing, prog);
    expect(existing.channels[5]).toBe(200);   // canaux non touchés conservés
    expect(existing.channels[102]).toBe(130);
    expect(existing.channels[50 + 1]).toBe(prog[50 + 1]);
    expect(existing.channels[50 + 2]).toBe(prog[50 + 2]);

    const reloaded = saveReloadScenes([existing]);
    const buffer = new Uint8Array(513);
    pushSceneToBuffer(buffer, reloaded[0].channels);
    assertFixtureBeam(buffer, fx, point);
  });

  it('anti-flip : relancer Target sur la même lyre conserve une pose proche (wrap pan) après merge', () => {
    const fx: Fixture = {
      id: 'B3',
      startAddress: 200,
      cm: { panOffset: 0, tiltOffset: 1 },
      o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 },
      origin: { x: 0, y: 5.5, z: 0 },
    };
    const a = { x: 3, y: 0.3, z: -2 };
    const b = { x: -3.2, y: 0.3, z: -1.8 };

    const prog: Record<number, number> = {};
    targetAim(prog, fx, a);
    const scene = recordNewScene('Scene flip', prog);
    const panA = scene.channels[200];

    // Deuxième Target (mise à jour de la scène) sur un point à l'opposé :
    // le pan doit rester dans la plage DMX et non "casser" (0/255).
    const prog2: Record<number, number> = {};
    targetAim(prog2, fx, b, { panCurrent: panA });
    updateSceneChannels(scene, prog2);
    const panB = scene.channels[200];
    expect(panB).toBeGreaterThanOrEqual(0);
    expect(panB).toBeLessThanOrEqual(255);

    const reloaded = saveReloadScenes([scene]);
    const buffer = new Uint8Array(513);
    pushSceneToBuffer(buffer, reloaded[0].channels);
    assertFixtureBeam(buffer, fx, b);
  });

  it('look : live éteint → Target écrit dimmer 255 + blanc + shutter ouvert + strobe 0 (scène visible)', () => {
    const fx: Fixture = {
      id: 'B4',
      startAddress: 1,
      cm: {
        panOffset: 0, tiltOffset: 1, intensityOffset: 2,
        rgbOffsets: [3, 4, 5], strobeOffset: 6, shutterOffset: 7,
      },
      o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 },
      origin: { x: 0, y: 5.5, z: 0 },
    };
    const point = { x: 2.2, y: 0.3, z: -3.1 };

    const prog: Record<number, number> = {};
    targetAim(prog, fx, point, { live: {} });
    expect(prog[1 + 2]).toBe(255);   // dimmer forcé allumé
    expect(prog[1 + 3]).toBe(255);   // R blanc
    expect(prog[1 + 4]).toBe(255);   // G blanc
    expect(prog[1 + 5]).toBe(255);   // B blanc
    expect(prog[1 + 6]).toBe(0);     // strobe absent du live → 0
    expect(prog[1 + 7]).toBe(255);   // shutter ouvert

    const reloaded = saveReloadScenes([recordNewScene('Scene look off', prog)]);
    const buffer = new Uint8Array(513);
    pushSceneToBuffer(buffer, reloaded[0].channels);
    assertFixtureBeam(buffer, fx, point);
    // Le look complet survit au JSON.
    expect(reloaded[0].channels[1 + 2]).toBe(255);
    expect(reloaded[0].channels[1 + 3]).toBe(255);
    expect(reloaded[0].channels[1 + 6]).toBe(0);
    expect(reloaded[0].channels[1 + 7]).toBe(255);
  });

  it('look : live allumé → Target copie dimmer/couleur/strobe existants tels quels', () => {
    const fx: Fixture = {
      id: 'B5',
      startAddress: 50,
      cm: { panOffset: 0, tiltOffset: 1, intensityOffset: 2, rgbOffsets: [3, 4, 5], strobeOffset: 6 },
      o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 },
      origin: { x: -3, y: 5.5, z: 1 },
    };
    const point = { x: 1.5, y: 0.2, z: -2 };
    const live: Record<number, number> = { [50 + 2]: 120, [50 + 3]: 10, [50 + 4]: 0, [50 + 5]: 200, [50 + 6]: 100 };

    const prog: Record<number, number> = {};
    targetAim(prog, fx, point, { live });
    expect(prog[50 + 2]).toBe(120); // dimmer live conservé
    expect(prog[50 + 3]).toBe(10);  // R live
    expect(prog[50 + 4]).toBe(0);   // G live (0 mais la couleur est déjà "présente")
    expect(prog[50 + 5]).toBe(200); // B live
    expect(prog[50 + 6]).toBe(100); // strobe live

    const reloaded = saveReloadScenes([recordNewScene('Scene look live', prog)]);
    const buffer = new Uint8Array(513);
    pushSceneToBuffer(buffer, reloaded[0].channels);
    assertFixtureBeam(buffer, fx, point);
    expect(reloaded[0].channels[50 + 2]).toBe(120);
    expect(reloaded[0].channels[50 + 5]).toBe(200);
    expect(reloaded[0].channels[50 + 6]).toBe(100);
  });

  it('look roue de couleur : live éteint → cap blanc/ouvert si connu, sinon 255', () => {
    const fx: Fixture = {
      id: 'B6',
      startAddress: 20,
      cm: {
        panOffset: 0, tiltOffset: 1, intensityOffset: 2, wheelOffset: 3,
        wheelCaps: [
          { color: 'Red', min: 0, max: 30 },
          { color: 'Green', min: 31, max: 60 },
          { color: 'White', min: 61, max: 90 },
        ],
      },
      o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 },
      origin: { x: 0, y: 5.5, z: 0 },
    };
    const point = { x: 1, y: 0.3, z: -2 };

    const prog: Record<number, number> = {};
    targetAim(prog, fx, point, { live: {} });
    expect(prog[20 + 3]).toBe(Math.round((61 + 90) / 2)); // milieu du cap White
    expect(prog[20 + 2]).toBe(255);

    const reloaded = saveReloadScenes([recordNewScene('Scene wheel', prog)]);
    const buffer = new Uint8Array(513);
    pushSceneToBuffer(buffer, reloaded[0].channels);
    assertFixtureBeam(buffer, fx, point);
  });
});