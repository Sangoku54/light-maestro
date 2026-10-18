/**
 * Validation des directions de faisceaux PAR DÉFAUT selon la position sur le
 * plateau (convention « vue audience » : public côté -Z, arrière de scène +Z).
 *
 * Le faisceau de sortie au DMX neutre est (0,0,-1) dans le repère du groupe
 * (les compensations de fitMountRotation — rear/ground/hanging — produisent
 * toutes ce vecteur horizontal). Le heading (group.rotation.y = φ) donne :
 *   dir_monde = R_y(φ) · (0,0,-1) = (-sin φ, 0, -cos φ).
 *
 * Spécification utilisateur (point de départ de TOUTES les fixtures) :
 *   - devant   (y ≤ 0.25) → +Z (vers l'arrière de scène), parallèle au sol
 *   - arrière  (y ≥ 0.75) → -Z (vers le public), parallèle au sol
 *   - côté -X  (x ≤ 0.25) → +X (vers le centre, PARALLÈLE — pas de convergence)
 *   - côté +X  (x ≥ 0.75) → -X (vers le centre, PARALLÈLE)
 *   - centre              → -Z (vers le public)
 *   - heading utilisateur ≠ 0 → respecté dans tous les modes
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

/** Direction monde du faisceau au DMX neutre pour un yaw φ. */
function worldBeamDir(phi: number): { x: number; z: number } {
  return { x: -Math.sin(phi), z: -Math.cos(phi) };
}

describe('headingRadForPos — directions par défaut par zone (faisceaux parallèles au sol)', () => {
  it('arrière (y ≥ 0.75) : faisceau droit vers le public (-Z), quel que soit le mode', () => {
    for (const mode of ['hanging', 'rear', 'ground'] as const) {
      const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeLessThan(-0.99);
      expect(Math.abs(dir.x)).toBeLessThan(0.01);
    }
  });

  it('arrière décentré (x=0.9) : TOUJOURS droit vers le public, pas de convergence vers le centre', () => {
    const pos = { x: 0.9, y: 0.95, h: 0.6, heading: 0 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    const dir = worldBeamDir(phi);
    expect(dir.z).toBeLessThan(-0.99);
    expect(Math.abs(dir.x)).toBeLessThan(0.01);
  });

  it('devant (y ≤ 0.25) : faisceau vers l\'arrière de scène (+Z), sol ou accroché', () => {
    for (const mode of ['hanging', 'ground'] as const) {
      const pos = { x: 0.5, y: 0.1, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(Math.PI, 9);
      const dir = worldBeamDir(phi);
      expect(dir.z).toBeGreaterThan(0.99);
      expect(Math.abs(dir.x)).toBeLessThan(0.01);
    }
  });

  it('côté -X (x ≤ 0.25) : faisceau PARALLÈLE vers +X (centre en face, pas de convergence)', () => {
    for (const mode of ['hanging', 'ground'] as const) {
      const pos = { x: 0.1, y: 0.5, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(-Math.PI / 2, 9);
      const dir = worldBeamDir(phi);
      expect(dir.x).toBeGreaterThan(0.99);
      expect(Math.abs(dir.z)).toBeLessThan(0.01);
    }
  });

  it('côté +X (x ≥ 0.75) : faisceau PARALLÈLE vers -X', () => {
    const pos = { x: 0.9, y: 0.5, h: 0.6, heading: 0 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS);
    expect(pie(phi)).toBeCloseTo(Math.PI / 2, 9);
    const dir = worldBeamDir(phi);
    expect(dir.x).toBeLessThan(-0.99);
    expect(Math.abs(dir.z)).toBeLessThan(0.01);
  });

  it('deux fixtures du même côté à profondeurs différentes : faisceaux PARALLÈLES (même direction)', () => {
    const a = headingRadForPos({ x: 0.1, y: 0.3, h: 0.6, heading: 0 } as any, 'hanging', DIMS);
    const b = headingRadForPos({ x: 0.1, y: 0.7, h: 0.6, heading: 0 } as any, 'hanging', DIMS);
    expect(pie(a - b)).toBeCloseTo(0, 9);
  });

  it('centre : vers le public (-Z)', () => {
    for (const mode of ['hanging', 'ground', 'rear', 'top'] as const) {
      const pos = { x: 0.5, y: 0.5, h: 0.6, heading: 0 };
      const phi = headingRadForPos(pos as any, mode, DIMS);
      expect(pie(phi)).toBeCloseTo(0, 9);
    }
  });

  it('fixture motorisée : heading hérité IGNORÉ (règle de zone gagne toujours)', () => {
    // Un heading pollué d'une ancienne session (260°) ne doit JAMAIS renvoyer
    // une fixture motorisée dos au public : la visée fine passe par pan/tilt DMX.
    const pos = { x: 0.2, y: 0.95, h: 0.6, heading: 260 };
    const phi = headingRadForPos(pos as any, 'hanging', DIMS, true);
    expect(pie(phi)).toBeCloseTo(0, 9); // arrière → droit vers le public
    const dir = worldBeamDir(phi);
    expect(dir.z).toBeLessThan(-0.99);
  });

  it('fixture SANS pan/tilt (par, bar) : heading utilisateur ≠ 0 respecté (outil d\'aim)', () => {
    const pos = { x: 0.1, y: 0.9, h: 0.6, heading: 48 };
    for (const mode of ['top', 'ground', 'rear', 'hanging'] as const) {
      const phi = headingRadForPos(pos as any, mode, DIMS, false);
      expect(phi).toBeCloseTo((48 * Math.PI) / 180, 9);
    }
    // heading 0 → règle de zone quand même
    const phi0 = headingRadForPos({ x: 0.2, y: 0.95, heading: 0 } as any, 'ground', DIMS, false);
    expect(pie(phi0)).toBeCloseTo(0, 9);
  });
});

describe('zone d\'éclairage utile — clamp PAN ±90° / TILT ±90° (sol : jamais sous l\'horizon)', () => {
  const H = Math.PI / 2;

  it('PAN : balayage limité à ±90° face à eux (jamais derrière — mur du fond)', () => {
    expect(clampPanZone(0)).toBeCloseTo(0, 9);          // neutre inchangé
    expect(clampPanZone(H * 0.6)).toBeCloseTo(H * 0.6, 9); // dans la zone
    expect(clampPanZone(H * 1.4)).toBeCloseTo(H, 9);    // +126° → bloqué à +90°
    expect(clampPanZone(-H * 1.4)).toBeCloseTo(-H, 9);  // -126° → bloqué à -90°
    expect(clampPanZone(Math.PI)).toBeCloseTo(H, 9);    // 180° (derrière) → +90° max
  });

  it('TILT fixtures en hauteur (rear/hanging) : ±90° complet (le sol est éclairable)', () => {
    expect(clampTiltZone(0, 'rear')).toBeCloseTo(0, 9);
    expect(clampTiltZone(-H * 0.5, 'rear')).toBeCloseTo(-H * 0.5, 9); // vers le sol OK
    expect(clampTiltZone(-H, 'hanging')).toBeCloseTo(-H, 9);          // verticale basse OK
    expect(clampTiltZone(H * 1.2, 'hanging')).toBeCloseTo(H, 9);      // au-delà verticale → bloqué
    expect(clampTiltZone(-H * 1.5, 'rear')).toBeCloseTo(-H, 9);
  });

  it('TILT fixtures au sol (ground) : JAMAIS sous l\'horizon (rien à éclairer dans le plancher)', () => {
    expect(clampTiltZone(0, 'ground')).toBeCloseTo(0, 9);        // horizon OK
    expect(clampTiltZone(H * 0.5, 'ground')).toBeCloseTo(H * 0.5, 9); // vers le haut OK
    expect(clampTiltZone(-H * 0.3, 'ground')).toBeCloseTo(0, 9); // sous l'horizon → ramené à l'horizon
    expect(clampTiltZone(-H, 'ground')).toBeCloseTo(0, 9);       // verticale basse → horizon
    expect(clampTiltZone(H, 'ground')).toBeCloseTo(H, 9);        // verticale haute OK
  });
});
