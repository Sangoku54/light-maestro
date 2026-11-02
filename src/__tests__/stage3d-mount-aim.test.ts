/**
 * Validation des directions de faisceaux :
 * - rear / ground / hanging : faisceau par defaut vers le public (-Z),
 *   le pan +/-90 deg couvre les cotes.
 * - top : faisceau vers le bas (-Y).
 * - heading utilisateur (sans pan/tilt) respecte si != 0.
 */
import { describe, it, expect } from 'vitest';
import { headingRadForPos, clampPanZone, clampTiltZone } from '../views/Stage3D';

const DIMS = { width: 12, depth: 8 };
const TAU = Math.PI * 2;

function pie(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}

function worldBeamDir(phi: number): { x: number; z: number } {
  return { x: -Math.sin(phi), z: -Math.cos(phi) };
}

describe('headingRadForPos — rear/ground/hanging visent le public, top vers le bas', () => {
  it('arriere gauche (x=0.2, y=0.95) : vers le public (0) pour rear/ground/hanging', () => {
    const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeLessThan(-0.99); // vers le public (-Z)
    }
  });

  it('arriere droite (x=0.9, y=0.95) : vers le public (0) pour rear/ground/hanging', () => {
    const pos = { x: 0.9, y: 0.95, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeLessThan(-0.99);
    }
  });

  it('devant centre (x=0.5, y=0.1) : vers le public (0) pour rear/ground/hanging', () => {
    const pos = { x: 0.5, y: 0.1, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeLessThan(-0.99);
    }
    // top : vers le bas (heading indifferent)
    const phiTop = headingRadForPos(pos as any, 'top', DIMS);
    expect(pie(phiTop)).toBeCloseTo(0, 9);
  });

  it('cote gauche (x=0.1, y=0.5) : vers le public (0) pour rear/ground/hanging', () => {
    const pos = { x: 0.1, y: 0.5, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeLessThan(-0.99);
    }
  });

  it('cote droit (x=0.9, y=0.5) : vers le public (0) pour rear/ground/hanging', () => {
    const pos = { x: 0.9, y: 0.5, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeLessThan(-0.99);
    }
  });

  it('coins : vers le public (0) pour rear/ground/hanging', () => {
    const posFL = { x: 0.1, y: 0.1, h: 0.6, heading: 0 };
    const posBL = { x: 0.1, y: 0.95, h: 0.6, heading: 0 };
    for (const pos of [posFL, posBL]) {
      for (const mode of ['ground', 'rear', 'hanging'] as const) {
        const phi = headingRadForPos(pos as any, mode, DIMS);
        expect(pie(phi)).toBeCloseTo(0, 9);
        const dir = worldBeamDir(phi);
        expect(dir.z).toBeLessThan(-0.99);
      }
    }
  });

  it('centre (x=0.5, y=0.5) : vers le public (-Z) pour tous les modes', () => {
    for (const mode of ['hanging', 'ground', 'rear', 'top'] as const) {
      const pos = { x: 0.5, y: 0.5, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
    }
  });

  it('fixture motorisee : heading herite IGNORE (regle public gagne)', () => {
    const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 260 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS, true);
    expect(pie(phi)).toBeCloseTo(0, 9);
    const dir = worldBeamDir(phi);
    expect(dir.z).toBeLessThan(-0.99);
  });

  it('fixture SANS pan/tilt (par, bar) : heading utilisateur != 0 respecte', () => {
    const pos = { x: 0.1, y: 0.9, h: 0.6, heading: 48 };
    for (const mode of ['top', 'ground', 'rear', 'hanging'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS, false);
      expect(phi).toBeCloseTo((48 * Math.PI) / 180, 9);
    }
    // heading 0 -> regle public (0)
    const phi0 = headingRadForPos({ x: 0.2, y: 0.95, heading: 0 } as any, 'ground', DIMS, false);
    expect(pie(phi0)).toBeCloseTo(0, 9);
  });
});

describe('zone d eclairage utile - clamp PAN +/-90 / TILT +/-90 (sol : jamais sous l horizon)', () => {
  const H = Math.PI / 2;

  it('PAN : balayage limite a +/-90 face a eux (jamais derriere - mur du fond)', () => {
    expect(clampPanZone(0)).toBeCloseTo(0, 9);
    expect(clampPanZone(H * 0.6)).toBeCloseTo(H * 0.6, 9);
    expect(clampPanZone(H * 1.4)).toBeCloseTo(H, 9);
    expect(clampPanZone(-H * 1.4)).toBeCloseTo(-H, 9);
    expect(clampPanZone(Math.PI)).toBeCloseTo(H, 9);
  });

  it('TILT : elevation limitee a [-90, +90], sol : pas sous l horizon', () => {
    expect(clampTiltZone(0, 'rear')).toBeCloseTo(0, 9);
    expect(clampTiltZone(-H * 0.5, 'rear')).toBeCloseTo(-H * 0.5, 9);
    expect(clampTiltZone(-H, 'hanging')).toBeCloseTo(-H, 9);
    expect(clampTiltZone(H * 1.2, 'hanging')).toBeCloseTo(H, 9);
    expect(clampTiltZone(-H * 1.5, 'rear')).toBeCloseTo(-H, 9);
  });
});
