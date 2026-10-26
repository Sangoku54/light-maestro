/**
 * Validation des directions de faisceaux PAR DEFINITION : toutes les fixtures
 * visent le CENTRE de la scene, quelque soit leur position.
 * Heading = atan2(x - 0.5, y - 0.5).
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

describe('headingRadForPos — toutes les fixtures visent le centre de la scene', () => {
  it('arriere gauche (x=0.2, y=0.95) : diagonal vers public + centre', () => {
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(pie(Math.atan2(-0.3, 0.45)), 5);
      const dir = worldBeamDir(phi);
      expect(dir.x).toBeGreaterThan(0.5);
      expect(dir.z).toBeLessThan(-0.7);
    }
  });

  it('arriere droite (x=0.9, y=0.95) : diagonal vers public + centre', () => {
    const pos = { x: 0.9, y: 0.95, h: 0.6, heading: 0 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    expect(pie(phi)).toBeCloseTo(pie(Math.atan2(0.4, 0.45)), 5);
    const dir = worldBeamDir(phi);
    expect(dir.x).toBeLessThan(-0.5);
    expect(dir.z).toBeLessThan(-0.7);
  });

  it('devant centre (x=0.5, y=0.1) : vers l arriere de scene (+Z)', () => {
    for (const mode of ['hanging', 'ground'] as const) {
      const pos = { x: 0.5, y: 0.1, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(Math.PI, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeGreaterThan(0.99);
      expect(Math.abs(dir.x)).toBeLessThan(0.01);
    }
  });

  it('cote gauche (x=0.1, y=0.5) : PARALLELE vers +X (centre)', () => {
    for (const mode of ['hanging', 'ground'] as const) {
      const pos = { x: 0.1, y: 0.5, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(-Math.PI / 2, 9);
      const dir = worldBeamDir(phi);
      expect(dir.x).toBeGreaterThan(0.99);
      expect(Math.abs(dir.z)).toBeLessThan(0.01);
    }
  });

  it('cote droit (x=0.9, y=0.5) : PARALLELE vers -X', () => {
    const pos = { x: 0.9, y: 0.5, h: 0.6, heading: 0 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    expect(pie(phi)).toBeCloseTo(Math.PI / 2, 9);
    const dir = worldBeamDir(phi);
    expect(dir.x).toBeLessThan(-0.99);
    expect(Math.abs(dir.z)).toBeLessThan(0.01);
  });

  it('coins : faisceaux diagonaux vers le centre', () => {
    // Avant-gauche : phi = atan2(-0.4, -0.4) = -3pi/4
    const posFL = { x: 0.1, y: 0.1, h: 0.6, heading: 0 };
    const phiFL = headingRadForPos(posFL as any, 'ground', DIMS);
    expect(pie(phiFL)).toBeCloseTo(-3 * Math.PI / 4, 6);
    const dirFL = worldBeamDir(phiFL);
    expect(dirFL.x).toBeGreaterThan(0.6);
    expect(dirFL.z).toBeGreaterThan(0.6);

    // Arriere-gauche : phi = atan2(-0.4, 0.45) ~ -0.73
    const posBL = { x: 0.1, y: 0.95, h: 0.6, heading: 0 };
    const phiBL = headingRadForPos(posBL as any, 'ground', DIMS);
    expect(pie(phiBL)).toBeCloseTo(pie(Math.atan2(-0.4, 0.45)), 5);
    const dirBL = worldBeamDir(phiBL);
    expect(dirBL.x).toBeGreaterThan(0.5);
    expect(dirBL.z).toBeLessThan(-0.7);
  });

  it('centre (x=0.5, y=0.5) : vers le public (-Z)', () => {
    for (const mode of ['hanging', 'ground', 'rear', 'top'] as const) {
      const pos = { x: 0.5, y: 0.5, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
    }
  });

  it('fixture motorisee : heading herite IGNORE (regle centre gagne)', () => {
    const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 260 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS, true);
    expect(pie(phi)).toBeCloseTo(pie(Math.atan2(-0.3, 0.45)), 5);
    const dir = worldBeamDir(phi);
    expect(dir.x).toBeGreaterThan(0.5);
    expect(dir.z).toBeLessThan(-0.7);
  });

  it('fixture SANS pan/tilt (par, bar) : heading utilisateur != 0 respecte', () => {
    const pos = { x: 0.1, y: 0.9, h: 0.6, heading: 48 };
    for (const mode of ['top', 'ground', 'rear', 'hanging'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS, false);
      expect(phi).toBeCloseTo((48 * Math.PI) / 180, 9);
    }
    // heading 0 -> regle centre
    const phi0 = headingRadForPos({ x: 0.2, y: 0.95, heading: 0 } as any, 'ground', DIMS, false);
    expect(pie(phi0)).toBeCloseTo(pie(Math.atan2(-0.3, 0.45)), 5);
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
