/**
 * CONTRAINTE LOGICIELLE pan/tilt par zone (convention « vue audience »).
 *
 * Exigence verifiee ici, sur le CODE REEL (pas une reimplementation) :
 *   1. une fixture de l'ARRIERE (rear) pointe par defaut vers le PUBLIC (-Z) ;
 *   2. une fixture au SOL devant le public pointe par defaut vers l'ARRIERE (+Z) ;
 *   3. une fixture au SOL a GAUCHE pointe par defaut vers la DROITE (+X) ;
 *   4. une fixture au SOL a DROITE pointe par defaut vers la GAUCHE (-X).
 *
 * Ces contraintes ne sont pas decoratives : elles sont portees par les
 * CANAUX DMX pan/tilt. Le point cle est que le DMX NEUTRE (128/128) correspond
 * a la direction de zone, et que le solveur / les clamps de moteur ecrivent
 * des valeurs DMX relatives a CETTE direction :
 *   - `poseFromPos` + `renderDirFromDmx` : pose canonique (renderer 3D, Target,
 *     playback) ;
 *   - `computeAimDMX` : solveur inverse utilise par le playback DMX ;
 *   - `clampPanZoneDmx` / `clampTiltZoneDmx` : bornes ecrites dans le moteur.
 *
 * Repere 3D (Stage3D) : le public est en -Z (`lip` en -depth/2), le fond de
 * scene en +Z ; `pos.y` = 0 -> public, `pos.y` = 1 -> fond.
 */
import { describe, it, expect } from 'vitest';
import { poseFromPos, renderDirFromDmx, type PosePos } from '../utils/fixture-pose';
import { computeAimDMX } from '../utils/sceneAim';
import { clampPanZoneDmx, clampTiltZoneDmx } from '../engine/dmx-movement';
import { useShowStore } from '../stores/showStore';

const DIMS = { width: 10, depth: 8 };

/** Angle (rad) entre deux vecteurs 3D. */
function angleBetween(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  return Math.acos(Math.max(-1, Math.min(1, dot / (na * nb))));
}

/** Direction du faisceau au DMX neutre EXACT (127.5/127.5 = centre mecanique). */
function neutralDir(pos: PosePos & { mountMode?: string }, mode: string) {
  const pose = poseFromPos(pos, mode, DIMS, true);
  return renderDirFromDmx(127.5, 127.5, pose);
}

/** Direction reconstruite depuis les valeurs DMX reellement ecrites. */
function dirFromDmx(pan: number, tilt: number, pos: PosePos & { mountMode?: string }, mode: string) {
  const pose = poseFromPos(pos, mode, DIMS, true);
  return renderDirFromDmx(pan, tilt, pose);
}

describe('CONTRAINTE pan/tilt — zone arriere : le faisceau part vers le PUBLIC', () => {
  it('arriere centre (x=0.5, y=0.9) : DMX neutre => droit sur le public (-Z)', () => {
    const pos = { x: 0.5, y: 0.9, h: 4, mountMode: 'rear' };
    const d = neutralDir(pos, 'rear');
    expect(d.z).toBeLessThan(-0.99); // vers le public
    expect(Math.abs(d.x)).toBeLessThan(0.01);
    expect(Math.abs(d.y)).toBeLessThan(0.01); // faisceau horizontal
  });

  it('arriere gauche (x=0.2, y=0.9) : vers la droite ET vers le public', () => {
    const d = neutralDir({ x: 0.2, y: 0.9, h: 4, mountMode: 'rear' }, 'rear');
    expect(d.x).toBeGreaterThan(0.5); // converge vers le centre (droite)
    expect(d.z).toBeLessThan(-0.5);   // et vers le public
  });

  it('arriere droit (x=0.8, y=0.9) : vers la gauche ET vers le public', () => {
    const d = neutralDir({ x: 0.8, y: 0.9, h: 4, mountMode: 'rear' }, 'rear');
    expect(d.x).toBeLessThan(-0.5);
    expect(d.z).toBeLessThan(-0.5);
  });
});

describe('CONTRAINTE pan/tilt — zone sol devant le public : le faisceau part vers l’ARRIERE', () => {
  it('le DMX 128 ecrit par le moteur reste dans la zone (ecart mecanique ~1 deg)', () => {
    // Le centre exact d une course 0..255 est 127.5 ; le moteur ecrit 128.
    // Sur une course pan de 540 deg, 128 => 1.06 deg de la direction de zone.
    const pose = poseFromPos({ x: 0.5, y: 0.9, h: 4, mountMode: 'rear' }, 'rear', DIMS, true);
    const d = renderDirFromDmx(128, 128, pose);
    expect(d.z).toBeLessThan(-0.99); // toujours plein avant, vers le public
    expect(Math.abs(d.x)).toBeLessThan(0.02);
  });

  it('sol centre devant (x=0.5, y=0.1) : DMX neutre => vers l’arriere (+Z)', () => {
    const d = neutralDir({ x: 0.5, y: 0.1, h: 0, mountMode: 'ground' }, 'ground');
    expect(d.z).toBeGreaterThan(0.99); // vers le fond de scene
    expect(Math.abs(d.x)).toBeLessThan(0.01);
  });

  it('sol avant gauche (x=0.2, y=0.1) : vers la droite ET vers l’arriere', () => {
    const d = neutralDir({ x: 0.2, y: 0.1, h: 0, mountMode: 'ground' }, 'ground');
    expect(d.x).toBeGreaterThan(0.5);
    expect(d.z).toBeGreaterThan(0.5);
  });

  it('sol avant droit (x=0.8, y=0.1) : vers la gauche ET vers l’arriere', () => {
    const d = neutralDir({ x: 0.8, y: 0.1, h: 0, mountMode: 'ground' }, 'ground');
    expect(d.x).toBeLessThan(-0.5);
    expect(d.z).toBeGreaterThan(0.5);
  });
});

describe('CONTRAINTE pan/tilt — zones laterales au sol', () => {
  it('sol gauche (x=0.1, y=0.5) : DMX neutre => vers la droite', () => {
    const d = neutralDir({ x: 0.1, y: 0.5, h: 0, mountMode: 'ground' }, 'ground');
    expect(d.x).toBeGreaterThan(0.5); // vers la droite
  });

  it('sol droit (x=0.9, y=0.5) : DMX neutre => vers la gauche', () => {
    const d = neutralDir({ x: 0.9, y: 0.5, h: 0, mountMode: 'ground' }, 'ground');
    expect(d.x).toBeLessThan(-0.5); // vers la gauche
  });

  it('fixture pendue au centre : DMX neutre => vers le public, horizontal', () => {
    const d = neutralDir({ x: 0.5, y: 0.5, h: 4, mountMode: 'hanging' }, 'hanging');
    expect(d.z).toBeLessThan(-0.99);
    expect(Math.abs(d.y)).toBeLessThan(0.01);
  });

  it('fixture au plafond (top) : DMX neutre => faisceau vers le bas', () => {
    const d = neutralDir({ x: 0.5, y: 0.5, h: 4, mountMode: 'top' }, 'top');
    expect(d.y).toBeLessThan(-0.99);
  });
});

describe('CONTRAINTE portee par les CANAUX DMX (et pas seulement par le rendu 3D)', () => {
  it('viser un point calcule des valeurs pan/tilt qui reproduisent la visee (aller-retour)', () => {
    // Fixture arriere gauche : visee explicite vers le public devant elle.
    const pos = { x: 0.2, y: 0.9, h: 4, mountMode: 'rear' as const, tilt: 0, zeroPan: 0, zeroTilt: 0 };
    const target = { x: 0, y: 1.5, z: -4 }; // public, devant la scene
    const aim = computeAimDMX(target, {
      pos,
      stageDims: DIMS,
      deckHeight: 0,
      hasPanTilt: true,
      panMaxDeg: 540,
      tiltMaxDeg: 180,
      panCurrent: 128,
    });
    expect(aim).not.toBeNull();
    const d = dirFromDmx(aim!.pan, aim!.tilt, pos, 'rear');
    const wanted = {
      x: target.x - (pos.x - 0.5) * DIMS.width,
      y: target.y - pos.h,
      z: target.z - (pos.y - 0.5) * DIMS.depth,
    };
    const len = Math.hypot(wanted.x, wanted.y, wanted.z);
    expect(angleBetween(d, { x: wanted.x / len, y: wanted.y / len, z: wanted.z / len })).toBeLessThan(0.01);
  });

  it('le pan ecrit reste a +/-90 de la direction de zone (le materiel ne va jamais derriere)', () => {
    // Course 540 deg : +/-90 deg => +/-42.5 unites DMX autour de 128.
    expect(clampPanZoneDmx(255, 540, 0)).toBeCloseTo(170, 5);
    expect(clampPanZoneDmx(0, 540, 0)).toBeCloseTo(85, 5);
    // Course 270 deg : +/-90 deg => +/-85 unites DMX autour de 128.
    expect(clampPanZoneDmx(255, 270, 0)).toBeCloseTo(212.5, 5);
    expect(clampPanZoneDmx(0, 270, 0)).toBeCloseTo(42.5, 5);
    // Une valeur dans la zone passe inchangee.
    expect(clampPanZoneDmx(128, 540, 0)).toBeCloseTo(128, 5);
  });

  it('au sol, le tilt ecrit ne descend jamais sous l’horizon', () => {
    // ground : elevation ∈ [0, +90] => DMX ∈ [127.5, 255]
    expect(clampTiltZoneDmx(0, 180, 'ground', 0, 0)).toBeCloseTo(127.5, 5);
    expect(clampTiltZoneDmx(255, 180, 'ground', 0, 0)).toBeCloseTo(255, 5);
    // rear / hanging : elevation ∈ [-90, +90] => DMX ∈ [0, 255]
    expect(clampTiltZoneDmx(0, 180, 'rear', 0, 0)).toBeCloseTo(0, 5);
    expect(clampTiltZoneDmx(255, 180, 'hanging', 0, 0)).toBeCloseTo(255, 5);
  });
});

describe('Placement par defaut : le store attribue le mountMode coherent avec la zone', () => {
  it('initFixturePosition : avant => ground, fond => rear, cotes => ground, centre => hanging', () => {
    const store = useShowStore.getState();
    // index 0 : col 0 -> x=0.1, row 0 -> y=0.1 (bord public) => ground
    store.initFixturePosition('f-front', 'moving_head', 0);
    // index 30 : row 5 -> y=1.0 (fond de scene) => rear
    store.initFixturePosition('f-back', 'moving_head', 30);
    // index 6 : row 1 -> y=0.28, col 0 -> x=0.1 (cote gauche) => ground
    store.initFixturePosition('f-left', 'moving_head', 6);
    // index 12 : row 2 -> y=0.46, col 0 -> x=0.1 (cote gauche) => ground
    store.initFixturePosition('f-left2', 'moving_head', 12);

    const pos = useShowStore.getState().fixturePositions;
    expect(pos['f-front'].mountMode).toBe('ground');
    expect(pos['f-back'].mountMode).toBe('rear');
    expect(pos['f-left'].mountMode).toBe('ground');
    expect(pos['f-left2'].mountMode).toBe('ground');

    // Et la direction par defaut de la fixture du fond va bien vers le public.
    const back = pos['f-back'];
    const d = neutralDir({ ...back, mountMode: back.mountMode }, 'rear');
    expect(d.z).toBeLessThan(-0.5);
  });
});
