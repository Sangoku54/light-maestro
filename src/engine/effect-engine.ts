/**
 * EffectEngine — moteur d'effets paramétriques unifié.
 *
 * Remplace les 3 duplications (auto-loops.ts / dmx-playback.ts / PerformanceView)
 * par un seul calcul : pattern(t, spread, offset) → [pan, tilt] ∈ [-1,1].
 * L'appelant mappe ensuite -1..1 → 0..255 (128 ± amp).
 */

export type EffectPattern =
  | 'circle' | 'square' | 'figure8' | 'zigzag' | 'sweep'
  | 'wave' | 'bounce' | 'pulse' | 'static' | 'spiral' | 'heartbeat'
  | 'randomWalk' | 'panOnly' | 'tiltOnly' | 'diamond'
  | 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'outro';

export interface EffectParams {
  pattern: EffectPattern;
  phase: number; // 0..2π, déjà t*2π*speed + spread
  spread?: number; // per-fixture phase offset (0..2π)
}

const DMX_CENTER = 128;

/**
 * Calcule le couple pan/tilt normalisé (-1..1) pour un pattern donné.
 * `phase` est déjà `ct*2π*speed + spread` (ou `step/movementSteps*2π` pour auto-loops).
 */
export function evalEffect(pattern: EffectPattern, phase: number, spread = 0): [number, number] {
  const p = phase + spread;
  const seg = (p / (Math.PI * 2) + 1) % 1;
  let px = 0, py = 0;
  switch (pattern) {
    case 'circle': px = Math.cos(p); py = Math.sin(p); break;
    case 'square': {
      const s = seg * 4; const sIdx = Math.floor(s) % 4; const sFrac = s - Math.floor(s);
      const cs: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      const ce: [number, number][] = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
      px = cs[sIdx][0] + (ce[sIdx][0] - cs[sIdx][0]) * sFrac;
      py = cs[sIdx][1] + (ce[sIdx][1] - cs[sIdx][1]) * sFrac;
      break;
    }
    case 'figure8': px = Math.sin(p); py = Math.sin(p * 2) * 0.5; break;
    case 'zigzag': { const saw = ((p / Math.PI) % 2) - 1; px = saw * 0.8; py = Math.sin(p) > 0 ? 0.5 : -0.5; break; }
    case 'sweep': px = Math.sin(p * 0.35) * 0.7; py = Math.cos(p * 0.3) * 0.5; break; // kept for autoscript compat
    case 'wave': px = Math.sin(p * 0.6) * 0.5; py = Math.sin(p * 0.35) * 0.5; break;
    case 'bounce': px = Math.sin(p * 0.4) * 0.5; py = Math.abs(Math.sin(p * 0.8)) * 0.8; break;
    case 'pulse': px = Math.sin(p * 0.9) * 0.25; py = Math.abs(Math.sin(p * 1.8)) * 0.85; break;
    case 'static': px = Math.sin(p * 0.05) * 0.1; py = Math.cos(p * 0.05) * 0.1; break;
    case 'spiral': { const r = 0.3 + 0.7 * Math.abs(Math.sin(p * 0.3)); px = Math.sin(p * 2) * r; py = Math.cos(p * 2) * r; break; }
    case 'heartbeat': { const hp = ((p / (Math.PI * 2)) % 1); const hb = hp < 0.15 ? 1 : hp < 0.3 ? 0.6 : 0; px = hb * Math.sin(p * 3); py = hb * Math.cos(p * 3); break; }
    case 'randomWalk': px = Math.sin(p * 0.7) * 0.5 + Math.sin(p * 1.3) * 0.3 + Math.cos(p * 2.1) * 0.2; py = Math.cos(p * 0.6) * 0.5 + Math.sin(p * 1.7) * 0.3 + Math.sin(p * 2.3) * 0.2; break;
    case 'panOnly': px = Math.sin(p); py = 0; break;
    case 'tiltOnly': px = 0; py = Math.sin(p); break;
    case 'diamond': { px = (((p / Math.PI) % 2) - 1) * 0.8; py = ((((p + Math.PI / 2) / Math.PI) % 2) - 1) * 0.8; break; }
    // Section aliases (autoscript)
    case 'intro': px = Math.sin(p * 0.1) * 0.3; py = Math.cos(p * 0.08) * 0.3; break;
    case 'verse': px = Math.sin(p * 0.25) * 0.5; py = Math.cos(p * 0.2) * 0.4; break;
    case 'chorus': px = Math.sin(p * 0.5) * 0.7; py = Math.cos(p * 0.5) * 0.7; break;
    case 'bridge': px = Math.sin(p * 0.3) * 0.5; py = Math.sin(p * 0.6) * 0.5; break;
    case 'drop': px = Math.sin(p * 0.8) * 0.9; py = Math.cos(p * 1.2) * 0.6; break;
    case 'outro': px = Math.sin(p * 0.15) * 0.2; py = Math.cos(p * 0.12) * 0.2; break;
    default: px = Math.sin(p * 0.35) * 0.4; py = Math.cos(p * 0.3) * 0.4; break;
  }
  return [px, py];
}

/** Mappe -1..1 → DMX 0..255 autour de 128 avec amplitude 0..128 et clamp stage. */
export function toDmx(v: number, amp: number): number {
  return Math.max(0, Math.min(255, Math.round(DMX_CENTER + v * Math.max(0, Math.min(128, amp)))));
}

/** Alias pour auto-loops : pattern.at(t, r) où t ∈ [0,1), r ∈ [0,128]. */
export function movementAt(pattern: EffectPattern, t: number, r: number): [number, number] {
  const phase = t * Math.PI * 2;
  const [px, py] = evalEffect(pattern, phase, 0);
  return [DMX_CENTER + px * r, DMX_CENTER + py * r];
}
