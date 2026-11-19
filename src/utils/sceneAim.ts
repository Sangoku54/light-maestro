import { solvePanTilt } from '../engine/aim-target';
import {
  headingRadForPos,
  mountTiltForMode,
  DEFAULT_PAN_SPAN_RAD,
  DEFAULT_TILT_SPAN_RAD,
  type PosePos,
  type StageDims,
} from './fixture-pose';

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
 *
 * ⚠ Le calcul DOIT utiliser exactement la même pose que le renderer 3D
 * (voir utils/fixture-pose.ts). Avant, ce fichier recalculait la pose avec
 * une scène 10×10 (au lieu de 10×8), sans la hauteur du plateau et avec le
 * `headingDeg` manuel au lieu du heading effectif par zone : la fixture
 * convergeait au clic puis dérivait dès que le playback reprenait la main.
 */

export interface AimTarget {
  /** X en mètres sur la scène (0 = centre, négatif = gauche, positif = droite) */
  x: number;
  /** Y en mètres (hauteur au-dessus du sol) */
  y: number;
  /**
   * Z en mètres sur la scène (0 = centre).
   * Repère monde Stage3D : négatif = vers le PUBLIC (-Z), positif = vers le fond
   * de scène (+Z). La caméra « audience » est en -depth/2 - 4.
   */
  z: number;
}

/** Cibles actives par fixture. */
const sceneAimRef = new Map<string, AimTarget>();

/** Définit (ou remplace) la cible de scène pour une fixture. */
export function setSceneAim(fixtureId: string, x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
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
 * Contexte de calcul : tout ce qui décrit la pose RÉELLE de la fixture dans
 * la scène 3D (mêmes données que le renderer).
 */
export interface AimFixtureContext {
  /** Position normalisée de la fixture (x, y, h, tares, mode de montage). */
  pos: PosePos & { mountMode?: string };
  /** Dimensions réelles de la scène (mètres). */
  stageDims: StageDims;
  /** Hauteur du plateau sous la fixture (mètres) — `deckTopAt`. */
  deckHeight?: number;
  /** La fixture a-t-elle des canaux pan/tilt ? (sinon le heading manuel prime). */
  hasPanTilt?: boolean;
  /** Course pan réelle (degrés) — `cm.panMaxDeg`. */
  panMaxDeg?: number;
  /** Course tilt réelle (degrés) — `cm.tiltMaxDeg`. */
  tiltMaxDeg?: number;
  /** Pan DMX courant, pour choisir la copie équivalente la plus proche. */
  panCurrent?: number;
}

/**
 * Position monde (mètres) de la fixture — identique au calcul du renderer 3D :
 *   x = (pos.x - 0.5) * largeur
 *   y = hauteur du plateau + pos.h
 *   z = (pos.y - 0.5) * profondeur   (public en -Z, fond de scène en +Z)
 */
export function aimOriginMeters(
  pos: PosePos,
  stageDims: StageDims,
  deckHeight = 0,
): { x: number; y: number; z: number } {
  return {
    x: (pos.x - 0.5) * stageDims.width,
    y: deckHeight + (pos.h ?? 0),
    z: (pos.y - 0.5) * stageDims.depth,
  };
}

/**
 * Calcule les valeurs DMX pan/tilt pour qu'une fixture positionnée sur la scène
 * vise une cible 3D donnée.
 *
 * La pose employée est STRICTEMENT celle du renderer 3D :
 *   - heading  = `headingRadForPos(...)` (heading effectif par zone),
 *   - mountTilt= `mountTiltForMode(...)` (π/2 pour rear/ground/hanging),
 *   - tares    = `pos.tilt` + `pos.zeroTilt` (tilt), `pos.zeroPan` (pan),
 *   - courses  = `panMaxDeg` / `tiltMaxDeg` réels de la fixture.
 *
 * Retourne null si le calcul est impossible (cible = position de la fixture).
 */
export function computeAimDMX(target: AimTarget, ctx: AimFixtureContext): AimResult | null {
  const { pos, stageDims } = ctx;
  const mountMode = pos.mountMode ?? 'top';
  const headingRad = headingRadForPos(pos, mountMode, stageDims, ctx.hasPanTilt ?? true);
  const mountTilt = mountTiltForMode(mountMode);
  const staticTilt = ((pos.tilt ?? 0) * Math.PI) / 180;
  const zeroPanRad = ((pos.zeroPan ?? 0) * Math.PI) / 180;
  const zeroTiltRad = ((pos.zeroTilt ?? 0) * Math.PI) / 180;
  const panSpanRad = ctx.panMaxDeg && ctx.panMaxDeg > 0 ? (ctx.panMaxDeg * Math.PI) / 180 : DEFAULT_PAN_SPAN_RAD;
  const tiltSpanRad = ctx.tiltMaxDeg && ctx.tiltMaxDeg > 0 ? (ctx.tiltMaxDeg * Math.PI) / 180 : DEFAULT_TILT_SPAN_RAD;

  const origin = aimOriginMeters(pos, stageDims, ctx.deckHeight ?? 0);

  const result = solvePanTilt(origin, target, {
    // Le heading absorbé par le solveur doit INCLURE la tare pan : le renderer
    // calcule `panAbs = headingRad + zeroPanRad + offsetDMX`.
    headingRad: headingRad + zeroPanRad,
    mountTilt,
    staticTilt: staticTilt + zeroTiltRad,
    armRotX: 0,
    panCurrent: ctx.panCurrent ?? 128,
    panSpanRad,
    tiltSpanRad,
  });

  if (!result) return null;
  return { pan: result.pan, tilt: result.tilt };
}
