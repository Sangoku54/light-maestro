/**
 * fixture-pose — Pose 3D canonique d'une fixture.
 *
 * Source de verite UNIQUE partagee par :
 *   - le renderer 3D (Stage3D) qui interprete les valeurs DMX pan/tilt,
 *   - l'outil Target (viser un point) de la modale 3D,
 *   - le playback DMX (dmx-playback) qui recalcule une cible de scene.
 *
 * Avant, ces trois chemins avaient chacun leur propre formule : l'outil Target
 * compensait le montage (-64) alors que le renderer compensait deja via
 * `_baseTilt` -> double compensation de 45 deg, et le playback recalculait la
 * pose avec une scene 10x10 et un heading different de la 3D -> la fixture
 * derivait apres le clic.
 *
 * Modele de rendu (identique au renderer Stage3D) :
 *   rawPan = ((pan/255) - 0.5) * panSpanRad + zeroPanRad
 *   phi    = headingRad + rawPan                     (rotation Y absolue)
 *   dmxTilt = ((tilt/255) - 0.5) * tiltSpanRad
 *   alpha  = mountTilt + dmxTilt + staticTilt + zeroTiltRad  (rotation X tete)
 *   dir    = (-sin(alpha)*sin(phi), -cos(alpha), -sin(alpha)*cos(phi))
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Position normalisee d'une fixture (meme forme que FixturePos du showStore). */
export interface PosePos {
  /** X normalise (0.5 = centre). */
  x: number;
  /** Y normalise (profondeur : 0 = fond de scene, 1 = public). */
  y: number;
  /** Hauteur au-dessus du plateau, en metres. */
  h: number;
  /** Heading manuel en degres (0 = non defini). */
  heading?: number;
  /** Tare statique du tilt en degres. */
  tilt?: number;
  /** Tare visuelle du pan en degres. */
  zeroPan?: number;
  /** Tare visuelle du tilt en degres. */
  zeroTilt?: number;
  /** Mode de montage. */
  mountMode?: string;
}

export interface StageDims {
  width: number;
  depth: number;
}

/** Dimensions de scene par defaut (10 x 8 m). */
export const DEFAULT_STAGE_DIMS: StageDims = { width: 10, depth: 8 };

/** Course pan/tilt par defaut quand la fixture ne declare rien (540 / 180 deg). */
export const DEFAULT_PAN_SPAN_RAD = (540 * Math.PI) / 180;
export const DEFAULT_TILT_SPAN_RAD = (180 * Math.PI) / 180;

/**
 * Compensation de montage (radians).
 *   rear / ground / hanging -> PI/2 : au neutre (DMX 128) le faisceau est
 *                              horizontal vers le public (compensation 3D).
 *   top                    -> 0    : au neutre le faisceau pointe vers le bas.
 */
export function mountTiltForMode(mode?: string): number {
  return mode === 'rear' || mode === 'ground' || mode === 'hanging' ? Math.PI / 2 : 0;
}

/** True si la fixture a au moins un canal pan/tilt DMX (fixture motorisee). */
export function hasPanTiltChannels(cm: {
  panOffsets?: number[] | null;
  panOffset?: number | null;
  tiltOffsets?: number[] | null;
  tiltOffset?: number | null;
  scanXOffset?: number | null;
  scanYOffset?: number | null;
}): boolean {
  return (cm.panOffsets?.length ?? 0) > 0 || (cm.panOffset !== null && cm.panOffset !== undefined)
    || (cm.tiltOffsets?.length ?? 0) > 0 || (cm.tiltOffset !== null && cm.tiltOffset !== undefined)
    || (cm.scanXOffset !== null && cm.scanXOffset !== undefined)
    || (cm.scanYOffset !== null && cm.scanYOffset !== undefined);
}

/**
 * Heading effectif d'une fixture (radians).
 *
 * Regle d'orientation « vue audience » (convention du projet) :
 *   - rear / ground / hanging : convergent vers le CENTRE de la scene,
 *   - top                    : heading indifferent (faisceau vers le bas).
 *
 * Pour une fixture SANS pan/tilt (par, barre), le heading manuel reste
 * l'unique outil d'aim et est donc respecte s'il est defini.
 */
export function headingRadForPos(
  pos: PosePos,
  mountMode: string,
  stageDims: StageDims,
  hasPanTilt = true,
): number {
  if (!hasPanTilt && pos.heading) return ((pos.heading ?? 0) * Math.PI) / 180;
  // mountMode peut etre obsolete (fixtures creees avant ce fix) : on le
  // re-derive depuis la position quand c'est une valeur par defaut.
  let mode = mountMode;
  if (mode !== 'top' && mode !== 'rear') {
    if (pos.y > 0.75) mode = 'rear';
    else if (pos.y < 0.25) mode = 'ground';
    else if (pos.x < 0.25 || pos.x > 0.75) mode = 'ground';
    // sinon reste hanging
  }
  if (mode === 'top') {
    return 0;
  }
  // Convergence vers le centre, bornee pour ne jamais partir a l'arriere.
  const lateral = (pos.x - 0.5) * stageDims.width;
  const longitudinal = Math.abs(pos.y - 0.5) * stageDims.depth;
  const floor = Math.min(stageDims.width, stageDims.depth) * 0.4;
  let phi = Math.atan2(lateral, Math.max(longitudinal, floor));
  const maxPhiRad = Math.atan2(stageDims.width, Math.max(1, stageDims.width / stageDims.depth));
  phi = Math.max(-maxPhiRad, Math.min(maxPhiRad, phi));
  // Fixture au sol devant (y < 0.25) : vise l'arriere (centre de scene).
  if (mode === 'ground' && pos.y < 0.25) {
    phi = Math.PI - phi;
    while (phi > Math.PI) phi -= 2 * Math.PI;
    while (phi < -Math.PI) phi += 2 * Math.PI;
  }
  return phi;
}

/** Pose de visee : tout ce qu'il faut pour interpréter/calculer pan+tilt. */
export interface FixtureAimPose {
  /** Heading du groupe (rad), SANS la tare pan. */
  headingRad: number;
  /** Compensation de montage (rad). */
  mountTilt: number;
  /** Tare statique du tilt (rad) — `pos.tilt`. */
  staticTilt: number;
  /** Tare visuelle du pan (rad) — `pos.zeroPan`. */
  zeroPanRad: number;
  /** Tare visuelle du tilt (rad) — `pos.zeroTilt`. */
  zeroTiltRad: number;
  /** Rotation X de l'arm (rad). */
  armRotX: number;
  /** Course pan totale (rad) repartie sur 0-255. */
  panSpanRad: number;
  /** Course tilt totale (rad) repartie sur 0-255. */
  tiltSpanRad: number;
}

/** Construit la pose de visee a partir de la position en store. */
export function poseFromPos(
  pos: PosePos,
  mountMode: string,
  stageDims: StageDims,
  hasPanTilt: boolean,
  spans?: { panMaxDeg?: number | null; tiltMaxDeg?: number | null },
): FixtureAimPose {
  const panMax = spans?.panMaxDeg;
  const tiltMax = spans?.tiltMaxDeg;
  return {
    headingRad: headingRadForPos(pos, mountMode, stageDims, hasPanTilt),
    mountTilt: mountTiltForMode(mountMode),
    staticTilt: ((pos.tilt ?? 0) * Math.PI) / 180,
    zeroPanRad: ((pos.zeroPan ?? 0) * Math.PI) / 180,
    zeroTiltRad: ((pos.zeroTilt ?? 0) * Math.PI) / 180,
    armRotX: 0,
    panSpanRad: panMax && panMax > 0 ? (panMax * Math.PI) / 180 : DEFAULT_PAN_SPAN_RAD,
    tiltSpanRad: tiltMax && tiltMax > 0 ? (tiltMax * Math.PI) / 180 : DEFAULT_TILT_SPAN_RAD,
  };
}

/**
 * Direction du faisceau telle que le renderer 3D la calcule.
 * Fonction de reference : sert aux tests ET a la validation croisee.
 */
export function renderDirFromDmx(panVal: number, tiltVal: number, pose: FixtureAimPose): Vec3 {
  const rawPan = ((panVal / 255) - 0.5) * pose.panSpanRad + pose.zeroPanRad;
  const phi = pose.headingRad + rawPan;
  const dmxTilt = ((tiltVal / 255) - 0.5) * pose.tiltSpanRad;
  const alpha = pose.mountTilt + dmxTilt + pose.staticTilt + pose.zeroTiltRad;
  return {
    x: -Math.sin(alpha) * Math.sin(phi),
    y: -Math.cos(alpha),
    z: -Math.sin(alpha) * Math.cos(phi),
  };
}
