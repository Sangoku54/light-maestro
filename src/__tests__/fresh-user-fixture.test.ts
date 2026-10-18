/**
 * Sonde « nouvel utilisateur » — première utilisation, zéro historique.
 *
 * Scénario : un nouvel utilisateur patche une AFX Spot 60, la place à
 * l'arrière de scène (sur totem), allume. Il ne doit PAS avoir à corriger un
 * état hérité (heading pollué, pan/tilt=0 jamais écrits, centres capturés) :
 *  1. l'analyse moteur résout pan/tilt/dimmer,
 *  2. computeDmxForCue écrit pan/tilt ≈ 128 (neutre) autour desquels le
 *     mouvement oscille — jamais 0 (fond gauche + sol),
 *  3. le décodage 3D (heading règle de zone = 0 à l'arrière, mountTilt
 *     horizontal) donne un faisceau PARALLÈLE au sol vers le public.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { headingRadForPos } from '../views/Stage3D';
import type { PatchedFixture } from '../stores/showStore';

const QXF = path.join(process.cwd(), 'resources', 'fixtures', 'AFX-Spot-60-LED.qxf');
const DIMS = { width: 12, depth: 8 };
const TAU = Math.PI * 2;

function pie(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}

/** Décodage 3D EXACT : R_y(φ) · R_x(mountTilt + dmxTilt) · (0,-1,0). */
function beamDir3D(panByte: number, tiltByte: number, phi: number, mountTilt: number): { x: number; y: number; z: number } {
  const panTarget = ((panByte / 255) - 0.5) * Math.PI * 3;
  const dmxTilt = ((tiltByte / 255) - 0.5) * Math.PI;
  const t = mountTilt + dmxTilt;
  // R_x(t)·(0,-1,0) = (0, -cos t, -sin t)
  const ly = -Math.cos(t);
  const lz = -Math.sin(t);
  // R_y(panTarget)·(0, ly, lz) = (lz·sin, ly, lz·cos)
  const p = panTarget + phi;
  return { x: lz * Math.sin(p), y: ly, z: lz * Math.cos(p) };
}

describe('nouvel utilisateur — AFX Spot 60 à l\'arrière, première utilisation', () => {
  let def: any;
  let pf: PatchedFixture;

  beforeAll(async () => {
    const lib = new FixtureLibrary();
    def = await lib.parseQLC(fs.readFileSync(QXF, 'utf-8'), QXF);
    expect(def).toBeTruthy();
    pf = {
      id: 'fx-fresh-afx', fixtureDefId: def.id,
      manufacturer: def.manufacturer, model: def.model,
      fixtureType: 'Moving Head', modeIndex: 0, modeName: def.modes[0].name,
      universeId: 'u1', startAddress: 1, channelCount: def.modes[0].channels.length,
      name: 'AFX Spot 60', tier: 'primary',
    } as unknown as PatchedFixture;
  }, 30000);

  it('analyse : pan/tilt/dimmer résolus (fixture exploitable)', () => {
    const fa = analyzeFixtureChannels(pf, def);
    expect(fa.panOffset).not.toBeNull();
    expect(fa.tiltOffset).not.toBeNull();
    expect(fa.intensityOffset).not.toBeNull();
  });

  it('moteur (scène, sans historique) : pan/tilt écrits ≈ 128, jamais 0', () => {
    const fa = analyzeFixtureChannels(pf, def);
    const res = computeDmxForCue(
      { time: 1, intensity: 'high', section: 'intro', strobe: false, energy: 0.5 } as never,
      [pf],
      new Map([[def.id, def]]),
      [{ id: 'u1' }],
      undefined, undefined, undefined, undefined, undefined,
      undefined,
      { 'fx-fresh-afx': { x: 0.5, y: 0.9, h: 0.5 } }, // arrière, AUCUN centre capturé, AUCUN zero
    );
    const chv = res[0].channelValues;
    const panByte = chv[pf.startAddress + fa.panOffset!];
    const tiltByte = chv[pf.startAddress + fa.tiltOffset!];
    expect(panByte).toBeDefined();
    expect(tiltByte).toBeDefined();
    // Mouvement 'static' (intro) : oscillation ±10% autour du neutre
    expect(Math.abs(panByte - 128)).toBeLessThanOrEqual(30);
    expect(Math.abs(tiltByte - 128)).toBeLessThanOrEqual(30);
  });

  it('décodage 3D : faisceau horizontal vers le public (parallèle au sol)', () => {
    // Règle de zone : arrière (y=0.9) → φ=0 ; motorisée → heading ignoré même pollué
    const phi = headingRadForPos({ x: 0.5, y: 0.9, heading: 260 } as any, 'ground', DIMS, true);
    expect(pie(phi)).toBeCloseTo(0, 9);
    // mountMode ground → mountTilt π/2 → faisceau horizontal au neutre
    const dir = beamDir3D(128, 128, phi, Math.PI / 2);
    expect(dir.z).toBeLessThan(-0.95);   // vers le public
    expect(Math.abs(dir.y)).toBeLessThan(0.05); // parallèle au sol (pas vers le sol !)
    expect(Math.abs(dir.x)).toBeLessThan(0.05); // droit devant (pas de côté)
  });

  it('jamais écrits ≠ 0 : le neutre 3D est 128 (pas fond gauche/sol)', () => {
    // Reproduit le bug : pan/tilt absents lus comme 0 → direction absurde.
    const dirZero = beamDir3D(0, 0, 0, Math.PI / 2);
    const dirNeutral = beamDir3D(128, 128, 0, Math.PI / 2);
    // À 0/0 le faisceau n'est ni vers le public ni horizontal — c'est le bug.
    expect(Math.abs(dirNeutral.z)).toBeGreaterThan(Math.abs(dirZero.z));
    // Le neutre pointe le public, le 0 absurde non.
    expect(dirNeutral.z).toBeLessThan(-0.95);
    expect(dirZero.z).toBeGreaterThan(-0.1);
  });
});
