/**
 * aim-target — Cinématique inverse pan/tilt DMX pour viser un point 3D.
 *
 * Le moteur 3D (Stage3D) oriente un projecteur comme suit :
 *   dir = R_y(heading + panDMX) · R_x(armRotX + tiltLocal) · (0, -1, 0)
 * avec tiltLocal = _mountTilt + dmxTilt + _staticTilt.
 *
 * Ces fonctions résolvent exactement l'inverse — couvert par des tests
 * round-trip qui réémettent la direction depuis les valeurs DMX résolues.
 * Fonctions pures, sans dépendance three.js (tests déterministes).
 *
 * IMPORTANT : la course pan/tilt reelle de la fixture doit etre fournie via
 * `panSpanRad` / `tiltSpanRad` (cf. `cm.panMaxDeg` / `cm.tiltMaxDeg`), sinon
 * le solveur suppose 540/180 deg et vise de travers sur les fixtures dont la
 * mecanique est differente.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PanTiltOpts {
  /** Rotation Y du groupe (heading, radians). */
  headingRad: number;
  /**
   * Compensation de montage (radians) : PI/2 pour rear/ground/hanging
   * (au neutre le faisceau est horizontal vers le public), 0 pour top.
   */
  mountTilt: number;
  /** Tare visuelle du tilt (radians) : _staticTilt + _zeroTiltDeg. */
  staticTilt: number;
  /** Rotation X de l'arm (radians). Le renderer de production la force a 0. */
  armRotX: number;
  /** Valeur DMX pan actuelle (0-255) pour choisir la copie équivalente la plus proche. */
  panCurrent?: number;
  /**
   * Course pan TOTALE de la fixture (radians) repartie sur 0-255.
   * Defaut : 540 deg. Doit correspondre a `cm.panMaxDeg` du renderer 3D.
   */
  panSpanRad?: number;
  /**
   * Course tilt TOTALE de la fixture (radians) repartie sur 0-255.
   * Defaut : 180 deg. Doit correspondre a `cm.tiltMaxDeg` du renderer 3D.
   */
  tiltSpanRad?: number;
}

export interface PanTiltResult {
  pan: number;   // 0-255
  tilt: number;  // 0-255
  phi: number;   // rotation Y totale résolue (radians)
  alpha: number; // rotation X totale résolue (radians)
}

export const PAN_FULL_SPAN = Math.PI * 3; // 540° → 255
export const TILT_FULL_SPAN = Math.PI;    // 180° → 255
/** Un tour complet de pan (2π) en unités DMX : 2π / 3π * 255 = 170. */
export const PAN_FULL_TURN_DMX = 170;

/** Nombre d'unites DMX par tour complet pour une course pan donnee. */
export function panTurnDmxUnits(panSpanRad: number): number {
  const span = Number.isFinite(panSpanRad) && panSpanRad > 0 ? panSpanRad : PAN_FULL_SPAN;
  return Math.round((255 * 2 * Math.PI) / span);
}

/** Course pan effective (radians) avec repli sur la valeur historique. */
function resolvePanSpan(o: PanTiltOpts): number {
  const s = o.panSpanRad;
  return Number.isFinite(s) && (s as number) > 0 ? (s as number) : PAN_FULL_SPAN;
}

/** Course tilt effective (radians) avec repli sur la valeur historique. */
function resolveTiltSpan(o: PanTiltOpts): number {
  const s = o.tiltSpanRad;
  return Number.isFinite(s) && (s as number) > 0 ? (s as number) : TILT_FULL_SPAN;
}

export function clampDMX(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function wrapPi(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Normalise un angle pan DMX vers l'équivalent (modulo un tour) le plus proche de `current`. */
export function nearestDmx(base: number, current?: number, fullTurnUnits: number = PAN_FULL_TURN_DMX): number {
  let best = clampDMX(base);
  let bestDist = Infinity;
  for (let k = -4; k <= 4; k++) {
    const c = base + k * fullTurnUnits;
    if (c < 0 || c > 255) continue;
    const d = Math.abs(c - (current ?? 128));
    if (d < bestDist) {
      bestDist = d;
      best = Math.round(c);
    }
  }
  return best;
}

/**
 * Résout pan/tilt DMX (0-255) pour qu'une fixture placée en `origin` pointe
 * vers `target`. Retourne null si le point cible est confondu avec l'origine.
 */
export function solvePanTilt(origin: Vec3, target: Vec3, o: PanTiltOpts): PanTiltResult | null {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;

  // Le faisceau sort le long de -Y local → dir = (-sinα·sinφ, -cosα, -sinα·cosφ).
  const alpha = Math.acos(Math.max(-1, Math.min(1, -ny))); // valeur principale [0,π]
  let phi: number;
  if (nx * nx + nz * nz < 1e-12) {
    // Faisceau vertical : φ (et l’équivalent -π) libre → garde l’angle pan actuel.
    const curPan = o.panCurrent ?? 128;
    phi = o.headingRad + ((curPan / 255) - 0.5) * PAN_FULL_SPAN;
  } else {
    phi = Math.atan2(-nx, -nz);
  }

  const dmxTilt = alpha - o.armRotX - o.mountTilt - o.staticTilt;
  const panSpan = resolvePanSpan(o);
  const tiltSpan = resolveTiltSpan(o);
  const panBase = (wrapPi(phi - o.headingRad) / panSpan + 0.5) * 255;
  return {
    pan: nearestDmx(panBase, o.panCurrent, panTurnDmxUnits(panSpan)),
    tilt: clampDMX((dmxTilt / tiltSpan + 0.5) * 255),
    phi,
    alpha,
  };
}

/**
 * Résout le tilt d'une tête qui partage un pan déjà fixé par l'arm
 * (multi-bras type Tonio : toutes les têtes suivent le même pan).
 * `phi` = rotation Y totale (heading + pan) déjà résolue.
 */
export function solveTiltForFixedPan(
  origin: Vec3,
  target: Vec3,
  phi: number,
  o: PanTiltOpts,
): { tilt: number; alpha: number } | null {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return null;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;

  // Retirer la rotation Y totale : R_y(-φ)·d̂ → la tête ne pivote que sur X.
  const vx = nx * Math.cos(phi) - nz * Math.sin(phi);
  const vz = nx * Math.sin(phi) + nz * Math.cos(phi);
  const alpha = Math.atan2(-vz, -ny);

  const dmxTilt = alpha - o.armRotX - o.mountTilt - o.staticTilt;
  const tiltSpan = resolveTiltSpan(o);
  return {
    tilt: clampDMX((dmxTilt / tiltSpan + 0.5) * 255),
    alpha,
  };
}