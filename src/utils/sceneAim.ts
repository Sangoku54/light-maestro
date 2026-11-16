import { solvePanTilt } from '../engine/aim-target';

/**
 * Scene Aim — Cibles de scène pour le ciblage précis des faisceaux.
 *
 * Permet de définir, pour chaque fixture, un point 3D (x, y, z en mètres
 * sur la scène) vers lequel son faisceau doit converger. Quand une cible
 * est active sur une fixture, le playback DMX calcule les valeurs pan/tilt
 * qui pointent vers ce point (via solvePanTilt) au lieu d'appliquer un
 * mouvement abstrait (wave/circle/etc.).
 *
 * Les cibles persistent jusqu'à ce qu'elles soient remplacées ou effacées.
 * Elles sont indépendantes du moteur 3D : c'est une donnée pure, utilisable
 * tant par la modale 3D que par le playback DMX.
 */

export interface AimTarget {
  /** X en mètres sur la scène (0 = centre, négatif = gauche, positif = droite) */
  x: number;
  /** Y en mètres (hauteur au-dessus du sol) */
  y: number;
  /** Z en mètres sur la scène (0 = centre, négatif = vers l'arrière, positif = vers le public) */
  z: number;
}

/** Cibles actives par fixture. */
const sceneAimRef = new Map<string, AimTarget>();

/** Définit (ou remplace) la cible de scène pour une fixture. */
export function setSceneAim(fixtureId: string, x: number, y: number, z: number): void {
  sceneAimRef.set(fixtureId, { x, y, z });
}

/** Retourne la cible active d'une fixture, ou undefined. */
export function getSceneAim(fixtureId: string): AimTarget | undefined {
  return sceneAimRef.get(fixtureId);
}

/** Efface la cible d'une fixture (reprise du mouvement autoscript). */
export function clearSceneAim(fixtureId: string): void {
  sceneAimRef.delete(fixtureId);
}

/** Efface toutes les cibles. */
export function clearAllSceneAims(): void {
  sceneAimRef.clear();
}

/** Retourne toutes les cibles actives (lecture seule). */
export function getAllSceneAims(): ReadonlyMap<string, AimTarget> {
  return sceneAimRef;
}

/** Vérifie si une fixture a une cible active. */
export function hasSceneAim(fixtureId: string): boolean {
  return sceneAimRef.has(fixtureId);
}

/**
 * Résultat du calcul d'aiming : valeurs DMX pan/tilt (0-255) pour viser la cible.
 */
export interface AimResult {
  pan: number;
  tilt: number;
}

/**
 * Calcule les valeurs DMX pan/tilt pour qu'une fixture positionnée sur la scène
 * vise une cible 3D donnée.
 *
 * La position de la fixture est fournie en coordonnées normalisées (0..1) sur
 * la scène (x = gauche/droite, y = arrière/avant) + hauteur h (mètres). Ces
 * coordonnées sont converties en mètres en supposant une scène de
 * `stageWidth × stageDepth` mètres centrée sur l'origine.
 *
 * Le mountMode détermine la compensation de montage (mountTilt) appliquée
 * par solvePanTilt :
 *   - rear / ground / hanging → mountTilt = π/2 (faisceau horizontal au neutre)
 *   - top → mountTilt = 0 (faisceau vers le bas)
 *
 * Retourne null si le calcul est impossible (cible = position de la fixture).
 */
export function computeAimDMX(
  fixtureX: number,      // 0..1 sur la scène (gauche/droite)
  fixtureY: number,      // 0..1 sur la scène (arrière/avant)
  fixtureH: number,      // mètres au-dessus du sol
  target: AimTarget,
  headingDeg: number,    // heading de la fixture en degrés
  mountMode: string,     // 'top' | 'ground' | 'rear' | 'hanging'
  zeroPanDeg?: number,   // tare pan en degrés
  zeroTiltDeg?: number,  // tare tilt en degrés
  stageWidth = 10,       // mètres
  stageDepth = 10,       // mètres
): AimResult | null {
  // Position de la fixture en mètres (scène centrée sur l'origine)
  const originX = (fixtureX - 0.5) * stageWidth;
  const originY = fixtureH;
  const originZ = (fixtureY - 0.5) * stageDepth;

  const origin = { x: originX, y: originY, z: originZ };
  const targetVec = { x: target.x, y: target.y, z: target.z };

  // heading en radians
  const headingRad = (headingDeg * Math.PI) / 180;

  // mountTilt selon le mode de montage
  const mountTilt =
    mountMode === 'rear' || mountMode === 'ground' || mountMode === 'hanging'
      ? Math.PI / 2
      : 0;

  // staticTilt = tare tilt
  const staticTilt = ((zeroTiltDeg ?? 0) * Math.PI) / 180;

  // panCurrent = 128 (centre, pas de préférence de tour)
  const panCurrent = 128;

  const result = solvePanTilt(origin, targetVec, {
    headingRad,
    mountTilt,
    staticTilt,
    armRotX: 0,
    panCurrent,
  });

  if (!result) return null;

  return { pan: result.pan, tilt: result.tilt };
}
