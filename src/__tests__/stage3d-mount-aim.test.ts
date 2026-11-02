/**
 * Validation des directions de faisceaux :
 * - rear / ground / hanging : visent le CENTRE de la scène
 *   phi = atan2((0.5-x)*width, |y-0.5|*depth)
 *   — pondère par les dimensions monde pour convergence correcte
 *   gauche (x < 0.5)  → phi > 0 → tourne vers la droite (+X)
 *   droite (x > 0.5)  → phi < 0 → tourne vers la gauche (-X)
 *   centre (x = 0.5)  → phi = 0 → droit devant le public (-Z)
 * - top : faisceau vers le bas (heading indifferent)
 * - heading utilisateur (sans pan/tilt) respecte si != 0
 */
import { describe, it, expect } from 'vitest';
import { headingRadForPos, clampPanZone, clampTiltZone } from '../views/Stage3D';

// Stage carrée 12x8 pour les tests unitaires
const DIMS = { width: 12, depth: 8 };
// Stage étroite 2x20 (comme tuto.lmproj) pour le test d'aspect ratio
const NARROW = { width: 2, depth: 20 };
const TAU = Math.PI * 2;

function pie(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}

function worldBeamDir(phi: number): { x: number; z: number } {
  // Beam direction after armGroup rotation around Y: (sin(phi), -cos(phi))
  return { x: Math.sin(phi), z: -Math.cos(phi) };
}

describe('headingRadForPos — rear/ground/hanging visent le centre de la scène', () => {
  it('arriere gauche (x=0.2, y=0.95, DIMS 12x8) : phi = atan2(0.36, 0.36) = PI/4', () => {
    const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      // (0.5-0.2)*12 = 0.36, |0.95-0.5|*8 = 0.36
      expect(pie(phi)).toBeCloseTo(Math.atan2(0.36, 0.36), 5);
      const dir = worldBeamDir(phi);
      expect(dir.x).toBeGreaterThan(0.5); // vers la droite
      expect(dir.z).toBeLessThan(-0.7);   // vers l'avant
    }
  });

  it('arriere droite (x=0.9, y=0.95, DIMS 12x8) : phi = atan2(-0.48, 0.36), vers gauche+avant', () => {
    const pos = { x: 0.9, y: 0.95, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      // (0.5-0.9)*12 = -0.48, |0.95-0.5|*8 = 0.36
      expect(pie(phi)).toBeCloseTo(Math.atan2(-0.48, 0.36), 5);
      const dir = worldBeamDir(phi);
      expect(dir.x).toBeLessThan(-0.5); // vers la gauche
      expect(dir.z).toBeLessThan(-0.5); // vers l'avant (z<0)
    }
  });

  it('devant centre (x=0.5, y=0.1) : phi = 0, vers l avant', () => {
    const pos = { x: 0.5, y: 0.1, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeLessThan(-0.99); // vers l'avant (-Z)
    }
    const phiTop = headingRadForPos(pos as any, 'top', DIMS);
    expect(pie(phiTop)).toBeCloseTo(0, 9);
  });

  it('cote gauche (x=0.1, y=0.5, DIMS 12x8) : phi = atan2(0.48, 0) = +PI/2', () => {
    const pos = { x: 0.1, y: 0.5, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(Math.PI / 2, 9);
      const dir = worldBeamDir(phi);
      expect(dir.x).toBeGreaterThan(0.99);
      expect(dir.z).toBeCloseTo(0, 5);
    }
  });

  it('cote droit (x=0.9, y=0.5, DIMS 12x8) : phi = atan2(-0.48, 0) = -PI/2', () => {
    const pos = { x: 0.9, y: 0.5, h: 0.6, heading: 0 };
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(-Math.PI / 2, 9);
      const dir = worldBeamDir(phi);
      expect(dir.x).toBeLessThan(-0.99);
      expect(dir.z).toBeCloseTo(0, 5);
    }
  });

  it('coins : chacun vise le centre monde', () => {
    const posFL = { x: 0.1, y: 0.1, h: 0.6, heading: 0 };
    const posBL = { x: 0.1, y: 0.95, h: 0.6, heading: 0 };
    const posFR = { x: 0.9, y: 0.1, h: 0.6, heading: 0 };
    const posBR = { x: 0.9, y: 0.95, h: 0.6, heading: 0 };
    for (const pos of [posFL, posBL, posFR, posBR]) {
      for (const mode of ['ground', 'rear', 'hanging'] as const) {
        const phi = headingRadForPos(pos as any, mode, DIMS);
        const dir = worldBeamDir(phi);
        if (pos.x < 0.5) expect(dir.x).toBeGreaterThan(0);
        if (pos.x > 0.5) expect(dir.x).toBeLessThan(0);
        expect(dir.z).toBeLessThan(-0.5);
      }
    }
  });

  it('centre (x=0.5, y=0.5) : phi = 0 pour tous les modes', () => {
    for (const mode of ['hanging', 'ground', 'rear', 'top'] as const) {
      const pos = { x: 0.5, y: 0.5, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
    }
  });

  it('fixture motorisee : heading herite IGNORE (regle centre gagne)', () => {
    const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 260 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS, true);
    expect(pie(phi)).toBeCloseTo(Math.atan2(0.36, 0.36), 5);
  });

  it('fixture SANS pan/tilt : heading utilisateur != 0 respecte', () => {
    const pos = { x: 0.1, y: 0.9, h: 0.6, heading: 48 };
    for (const mode of ['top', 'ground', 'rear', 'hanging'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS, false);
      expect(phi).toBeCloseTo((48 * Math.PI) / 180, 9);
    }
    const phi0 = headingRadForPos({ x: 0.2, y: 0.95, heading: 0 } as any, 'ground', DIMS, false);
    expect(pie(phi0)).toBeCloseTo(Math.atan2(0.36, 0.36), 5);
  });

  it('stage étroit 2x20 (tuto.lmproj) : phi faible, faisceaux quasi-parallèles', () => {
    // Positions réelles de tuto.lmproj
    const left = { x: -0.005, y: 0.056, h: 0.6, heading: 0 };
    const right = { x: 0.988, y: 0.056, h: 0.6, heading: 0 };
    // phi = atan2((0.5-x)*2, |y-0.5|*20)
    const phiL = headingRadForPos(left as any, 'hanging', NARROW, true);
    const phiR = headingRadForPos(right as any, 'hanging', NARROW, true);
    // Left: atan2(0.505*2, 0.444*20) = atan2(1.01, 8.88) ≈ 0.113
    expect(pie(phiL)).toBeCloseTo(Math.atan2(1.01, 8.88), 5);
    // Right: atan2(-0.488*2, 0.444*20) = atan2(-0.976, 8.88) ≈ -0.110
    expect(pie(phiR)).toBeCloseTo(Math.atan2(-0.976, 8.88), 5);
    // Gauche → droite, Droite → gauche, tous deux vers l'avant
    expect(Math.sin(phiL)).toBeGreaterThan(0);
    expect(Math.sin(phiR)).toBeLessThan(0);
    expect(-Math.cos(phiL)).toBeLessThan(-0.99);
    expect(-Math.cos(phiR)).toBeLessThan(-0.99);
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
