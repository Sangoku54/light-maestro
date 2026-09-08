/**
 * Validation virtuelle de l'auto-aim « hanging » (fixture accrochée au-dessus
 * du pont). Le faisceau de sortie est (0,-1,0) dans la tête ; en mode hanging
 * l'arm est à π et la tête à -π/2 → au DMX neutre (pan=128, tilt=128),
 * dir_monde = R_y(headingRadForPos) · (0,0,-1) = (-sin φ, 0, -cos φ).
 * On vérifie qu'avec la convention « vue audience » le faisceau vise le centre
 * de la scène : depuis la position de la fixture, dir doit être ∝ -pos_scène.
 */
import { describe, it, expect } from 'vitest';
import { headingRadForPos } from '../views/Stage3D';

const DIMS = { width: 12, depth: 8 };
const TAU = Math.PI * 2;

function pie (a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r < -Math.PI) r += TAU;
  return r;
}

function worldBeamDir(phi: number): { x: number; z: number } {
  return { x: -Math.sin(phi), z: -Math.cos(phi) };
}

function stagePos(pos: { x: number; y: number }, dims = DIMS): { x: number; z: number } {
  return { x: (pos.x - 0.5) * dims.width, z: (pos.y - 0.5) * dims.depth };
}

function norm(a: { x: number; z: number }): { x: number; z: number } {
  const l = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / l, z: a.z / l };
}

describe('headingRadForPos — auto-aim hanging vers le public', () => {
  it('rear (fond de scène) : faisceau vers l\'avant (public)', () => {
    const pos = { x: 0.2023, y: 0.9464, h: 0.6, heading: 260 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    const dir = worldBeamDir(phi);
    const sp = stagePos(pos);
    const want = norm({ x: -sp.x, z: -sp.z }); // vers centre de scène
    // Le centre étant derrière la fixture rear, dir doit être plutôt -Z (avant).
    expect(dir.z).toBeLessThan(-0.5);
    expect(Math.abs(pie(phi - Math.atan2(-(-sp.x), -(-sp.z))))).toBeLessThan(1e-9);
    expect(Math.abs(norm(dir).x - want.x)).toBeLessThan(1e-9);
    expect(Math.abs(norm(dir).z - want.z)).toBeLessThan(1e-9);
  });

  it('gauche (vue audience) : pan vers le centre', () => {
    const pos = { x: 0.1, y: 0.5, h: 0.6, heading: 0 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    const dir = worldBeamDir(phi);
    const sp = stagePos(pos);
    // Fixture à gauche (sp.x < 0) → le faisceau doit pointer vers +X (le centre).
    expect(dir.x).toBeGreaterThan(0.5);
    const want = norm({ x: -sp.x, z: -sp.z });
    expect(Math.abs(norm(dir).x - want.x)).toBeLessThan(1e-9);
    expect(Math.abs(norm(dir).z - want.z)).toBeLessThan(1e-9);
  });

  it('droite : pan vers le centre (-X)', () => {
    const pos = { x: 0.9, y: 0.5, h: 0.6, heading: 0 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    const dir = worldBeamDir(phi);
    expect(dir.x).toBeLessThan(-0.5);
    const sp = stagePos(pos);
    const want = norm({ x: -sp.x, z: -sp.z });
    expect(Math.abs(norm(dir).x - want.x)).toBeLessThan(1e-9);
  });

  it('devant (bord avant) : vers l\'arrière (centre de scène)', () => {
    const pos = { x: 0.5, y: 0.1, h: 0.6, heading: 0 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    const dir = worldBeamDir(phi);
    // sp.z < 0 (devant) → dir +Z (vers l'arrière / centre).
    expect(dir.z).toBeGreaterThan(0.5);
    const sp = stagePos(pos);
    const want = norm({ x: -sp.x, z: -sp.z });
    expect(Math.abs(norm(dir).x - want.x)).toBeLessThan(1e-9);
    expect(Math.abs(norm(dir).z - want.z)).toBeLessThan(1e-9);
  });

  it('hors hanging : heading utilisateur inchangé (48°)', () => {
    const pos = { x: 0.5, y: 0.5, h: 0.6, heading: 48 };
    for (const mode of ['top', 'ground', 'rear']) {
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(phi).toBeCloseTo((48 * Math.PI) / 180, 9);
    }
  });
});