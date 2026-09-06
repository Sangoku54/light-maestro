import { describe, it, expect } from 'vitest';
import {
  solvePanTilt,
  solveTiltForFixedPan,
  nearestDmx,
  clampDMX,
  PAN_FULL_SPAN,
  TILT_FULL_SPAN,
  type PanTiltOpts,
  type Vec3,
} from '../engine/aim-target';

// Modèle exact du rendu Stage3D : les valeurs DMX résolues doivent ré-émettre
// une direction colinéaire au vecteur origin → target.
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

function configs(): Array<{ name: string; o: PanTiltOpts }> {
  return [
    { name: 'top mount', o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 } },
    { name: 'top mount + heading 45°', o: { headingRad: Math.PI / 4, mountTilt: 0, staticTilt: 0, armRotX: 0 } },
    { name: 'top mount + static tilt 30°', o: { headingRad: 0, mountTilt: 0, staticTilt: Math.PI / 6, armRotX: 0 } },
    { name: 'ground mount', o: { headingRad: 0, mountTilt: Math.PI, staticTilt: 0, armRotX: 0 } },
    { name: 'rear mount', o: { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: -Math.PI / 2 } },
    { name: 'rear mount + heading 200°', o: { headingRad: (200 * Math.PI) / 180, mountTilt: 0, staticTilt: -0.1, armRotX: -Math.PI / 2 } },
  ];
}

function targets(): Vec3[] {
  return [
    { x: 0, y: 0, z: -6 },
    { x: 3.5, y: 0.1, z: -4.2 },
    { x: -4, y: 1.8, z: 3 },
    { x: 1.2, y: -0.4, z: 2.7 },
    { x: -5, y: 0.5, z: -5 },
  ];
}

describe('solvePanTilt round-trip (rendu 3D reproduit exactement)', () => {
  for (const cfg of configs()) {
    for (const tgt of targets()) {
      it(`[${cfg.name}] vise target (${tgt.x},${tgt.y},${tgt.z}) → direction colinéaire`, () => {
        const origin: Vec3 = { x: 0.4, y: 4.5, z: -0.6 };
        const res = solvePanTilt(origin, tgt, cfg.o);
        expect(res).not.toBeNull();
        if (!res) return;
        const emitted = normalize(renderDir(res.pan, res.tilt, cfg.o));
        const wanted = toTarget(origin, tgt);
        const d = dot(emitted, wanted);
        // Si le débattement moteur (±90° tilt, ±270° pan) est atteint, la
        // direction s'arrête à la butée (le rendu ne peut pas faire mieux).
        const bounded = res.pan <= 1 || res.pan >= 254 || res.tilt <= 1 || res.tilt >= 254;
        if (!bounded) expect(d).toBeGreaterThan(0.999);
      });
    }
  }
});

describe('solvePanTilt valeurs de référence', () => {
  it('target droit sous une top-mount → pan 128, tilt 128', () => {
    const o: PanTiltOpts = { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 };
    const res = solvePanTilt({ x: 0, y: 4.5, z: 0 }, { x: 0, y: 1.5, z: 0 }, o);
    expect(res?.pan).toBe(128);
    expect(res?.tilt).toBe(128);
  });

  it('target droit au-dessus d’une ground-mount → tilt 128 (faisceau vers le haut)', () => {
    const o: PanTiltOpts = { headingRad: 0, mountTilt: Math.PI, staticTilt: 0, armRotX: 0 };
    const res = solvePanTilt({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }, o);
    expect(res?.pan).toBe(128);
    expect(res?.tilt).toBe(128);
  });

  it('pan au 1/4 du span → valeur DMX cohérente avec le modèle', () => {
    const o: PanTiltOpts = { headingRad: 0, mountTilt: 0, staticTilt: 0, armRotX: 0 };
    // Cible à droite (+X) par rapport à l’axe -Z → φ = -π/2 → panDMX = -π/2 → pan ≈ 85
    const res = solvePanTilt({ x: 0, y: 3.5, z: 0 }, { x: 2.4, y: 0, z: -0.0001 }, o);
    expect(res?.phi).toBeCloseTo(-Math.PI / 2, 1);
    expect(res?.pan).toBe(85);
  });
});

describe('solveTiltForFixedPan (multi-bras)', () => {
  it('round-trip : tête avec pan fixé, tilt seul → direction colinéaire', () => {
    const o: PanTiltOpts = { headingRad: 0.2, mountTilt: 0, staticTilt: 0.05, armRotX: 0 };
    const res = solvePanTilt({ x: 0, y: 3.8, z: 0 }, { x: 2.1, y: 0.2, z: -3.1 }, o);
    expect(res).not.toBeNull();
    if (!res) return;
    const headOrigin: Vec3 = { x: 0.3, y: 3.7, z: 0.15 };
    const sub = solveTiltForFixedPan(headOrigin, { x: 2.1, y: 0.2, z: -3.1 }, res.phi, o);
    expect(sub).not.toBeNull();
    if (!sub) return;
    // La tête partage le pan résolu : dir = R_y(φ)·R_x(α_tête)·(0,-1,0)
    const alpha = o.armRotX + o.mountTilt + ((sub.tilt / 255) - 0.5) * TILT_FULL_SPAN + o.staticTilt;
    const emitted = normalize({
      x: -Math.sin(alpha) * Math.sin(res.phi),
      y: -Math.cos(alpha),
      z: -Math.sin(alpha) * Math.cos(res.phi),
    });
    const wanted = toTarget(headOrigin, { x: 2.1, y: 0.2, z: -3.1 });
    // Convergence approximative (pan partagé, tête décalée) : la tête pointe
    // le pan résolu + son tilt propre → quasi-colinéaire.
    expect(dot(emitted, wanted)).toBeGreaterThan(0.995);
  });
});

describe('nearestDmx', () => {
  it('choisit la copie équivalente la plus proche de la valeur actuelle', () => {
    // base ≈ 0 (panôt gauche extrême) mais actuel 200 → bascule vers l’autre copie
    const base = 0.0;
    const v = nearestDmx(base, 200);
    expect(v).toBeGreaterThan(150);
    expect(v).toBeLessThanOrEqual(255);
  });

  it('garde un centre stable autour de 128', () => {
    expect(nearestDmx(128, 100)).toBe(128);
  });

  it('clamp dans [0,255]', () => {
    expect(nearestDmx(-50, 128)).toBeGreaterThanOrEqual(0);
    expect(nearestDmx(400, 128)).toBeLessThanOrEqual(255);
    expect(clampDMX(-5)).toBe(0);
    expect(clampDMX(300)).toBe(255);
  });
});