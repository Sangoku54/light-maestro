// ─── DMX Movement Utilities ───────────────────────────────
// Extracted from dmx-playback.ts — stage-aware pan/tilt clamping + smart movement patterns

export function clampPanToStage(panDmx: number, x: number): number {
   const nx = Math.max(0, Math.min(1, x)); // guard against out-of-bounds positions
   const d = panDmx - 128;
   return 128 + Math.max(-Math.round(nx * 128), Math.min(Math.round((1 - nx) * 128), d));
}

export function clampTiltToStage(tiltDmx: number, y: number): number {
  const d = tiltDmx - 128;
  return 128 + Math.max(-Math.round(Math.max(0.2, y) * 128), Math.min(Math.round(Math.min(1, y + 0.3) * 128), d));
}

/** Convert a pan/tilt half-sweep in degrees to a DMX offset from center (128).
 *  Pan full sweep = 270° each side, tilt full sweep = 90° each side (see Stage3D conversion). */
export function halfDegToDmxOffset(deg: number, axis: 'pan' | 'tilt'): number {
  const full = axis === 'pan' ? 270 : 90;
  const dmx = Math.round((deg / full) * 128);
  return Math.max(0, Math.min(128, dmx));
}

/** Point zéro (tare) pan/tilt en degrés → décalage DMX signé du centre 128.
 *  Signé (contrairement à halfDegToDmxOffset) pour exprimer un zéro à gauche/
 *  droite ou bas/haut du montage. Le mouvement autoscript oscille autour de
 *  `128 + zeroDmxOffset(...)`. 0 si non renseigné. */
export function zeroDmxOffset(deg: number | undefined, axis: 'pan' | 'tilt'): number {
    if (deg === undefined || deg === null || !Number.isFinite(deg)) return 0;
    // Inverse EXACT du décodage 3D ((byte-128)/255*540 pour pan, *180 pour tilt) :
    // le centre taré se redécode à la position capturée, sans double comptage ni dérive.
    const scale = axis === 'pan' ? 540 : 180;
    return Math.round((deg / scale) * 255);
  }

/**
 * Zone 180° côté MOTEUR (option B) — miroir EXACT du clamp 3D
 * (`clampPanZone` + tare zeroPan) appliqué aux valeurs de pan ÉCRITES :
 * le matériel ne peut physiquement pas dépasser ±90° de la direction
 * par défaut de la fixture. Bornes asymétriques quand la tare (zeroPan)
 * décale le centre — même formule que le rendu 3D.
 * Contournement : une visée délibérée (centre capturé) BYPASSE ce clamp
 * (convention identique à clampPanToStage).
 */
export function clampPanZoneDmx(panDmx: number, panMaxDeg: number, zeroPanDeg: number | undefined): number {
   const z = Number.isFinite(zeroPanDeg) ? (zeroPanDeg as number) : 0;
   const deg = Math.max(1, panMaxDeg); // avoid division by zero on malformed defs
   const up = 127.5 + ((90 - z) / deg) * 255;
   const lo = 127.5 - ((90 + z) / deg) * 255;
   return Math.max(lo, Math.min(up, panDmx));
}

/**
 * Zone TILT côté MOTEUR — miroir de `clampTiltZone` : élévation ∈ [-90°, +90°]
 * (verticale basse → haute) ; au SOL ('ground') jamais sous l'horizon.
 * staticDeg = pos.tilt (tare statique panneau), zeroTiltDeg = pos.zeroTilt.
 */
export function clampTiltZoneDmx(
  tiltDmx: number,
  tiltMaxDeg: number,
  mountMode: string | undefined,
  staticDeg: number | undefined,
  zeroTiltDeg: number | undefined,
): number {
  const s = Number.isFinite(staticDeg) ? (staticDeg as number) : 0;
   const z = Number.isFinite(zeroTiltDeg) ? (zeroTiltDeg as number) : 0;
   const deg = Math.max(1, tiltMaxDeg); // avoid division by zero on malformed defs
   // élévation (deg) = (val - 127.5) / 255 * tiltMax + s + z
   const valOf = (elev: number): number => 127.5 + ((elev - s - z) / deg) * 255;
  const lo = mountMode === 'ground' ? valOf(0) : valOf(-90);
  const up = valOf(90);
  return Math.max(lo, Math.min(up, tiltDmx));
}

// Mapping: section → best suited movement patterns per fixture (ordered by energy)
export const SMART_MOVEMENTS: Record<string, string[]> = {
  intro:   ['static', 'panOnly', 'tiltOnly', 'sweep', 'wave'],
  verse:   ['sweep', 'wave', 'panOnly', 'figure8', 'randomWalk', 'panOnly'],
  chorus:  ['circle', 'sweep', 'spiral', 'diamond', 'figure8', 'bounce', 'wave'],
  bridge:  ['figure8', 'wave', 'zigzag', 'randomWalk', 'spiral', 'diamond'],
  drop:    ['bounce', 'zigzag', 'heartbeat', 'circle', 'spiral', 'diamond', 'randomWalk', 'wave'],
  outro:   ['tiltOnly', 'panOnly', 'sweep', 'static', 'wave'],
  build:   ['spiral', 'circle', 'wave', 'sweep', 'diamond', 'zigzag'],
};

export const DEFAULT_SMART_MOVEMENTS = ['sweep', 'circle', 'wave', 'figure8', 'zigzag'];

export function getSmartMovement(
  fixtureIndex: number,
  totalMobileFixtures: number,
  section: string,
  timeOffset?: number,
): string {
  const patterns = SMART_MOVEMENTS[section] || DEFAULT_SMART_MOVEMENTS;
  if (totalMobileFixtures <= 1) return patterns[0];
  let hash = 0;
  for (let i = 0; i < section.length; i++) hash = ((hash << 5) - hash) + section.charCodeAt(i);
  const timeIdx = timeOffset ? Math.floor(timeOffset / 8) : 0;
  const idx = (fixtureIndex + timeIdx + Math.abs(hash % 97)) % patterns.length;
  return patterns[idx];
}

/**
 * Pattern de mouvement PAR SECTION — identique pour TOUTES les fixtures
 * mobiles (harmonie de look). L'ancienne répartition par hash incluait
 * `fixtureIndex` : 3 têtes identiques recevaient 3 patterns sans rapport
 * (sweep / figure8 / randomWalk) → mouvement hérétique, jamais synchrone.
 * La variété vient du TEMPS (timeIdx) et la géométrie du `spatialPhaseFor`
 * (vague/rond/expand sur les positions réelles du rig) — pas du hasard par
 * tête. Les fixtures identiques bougent ENSEMBLE, déphasées sur l'espace.
 */
export function getSectionMovement(
  section: string,
  timeOffset?: number,
): string {
  const patterns = SMART_MOVEMENTS[section] || DEFAULT_SMART_MOVEMENTS;
  let hash = 0;
  for (let i = 0; i < section.length; i++) hash = ((hash << 5) - hash) + section.charCodeAt(i);
  const timeIdx = timeOffset ? Math.floor(timeOffset / 8) : 0;
  return patterns[(timeIdx + Math.abs(hash % 97)) % patterns.length];
}

// ---- Spatial choreography -------------------------------------------------
// Per-fixture phase offsets derived from real stage positions (x,y normalized 0..1).
// Turns a uniform movement pattern into a wave/circle/expand across the whole rig.

export type SpatialPattern = 'off' | 'wave' | 'circle' | 'expand' | 'contract' | 'alternate';

export const SPATIAL_BY_SECTION: Record<string, SpatialPattern> = {
  intro:   'wave',
  verse:   'wave',
  chorus:  'circle',
  bridge:  'wave',
  drop:    'expand',
  outro:   'contract',
  build:   'alternate',
};

/** Fallback stage position: same grid formula as showStore.initFixturePosition. */
export function fallbackPosition(mobileIdx: number): { x: number; y: number } {
  const col = mobileIdx % 6;
  const row = Math.floor(mobileIdx / 6);
  return { x: 0.1 + col * 0.16, y: 0.1 + row * 0.18 };
}

/**
 * Per-fixture phase offset (radians) for a spatial pattern, added to the movement phase.
 * - wave:      phase ~ -x   -> cascade sweeping left to right (lambda = full stage)
 * - circle:    phase ~ +x   -> rotating ring along the line (Lissajous circle)
 * - expand:    phase ~ -dist to center -> impulse from center to the edges (drop)
 * - contract:  phase ~ +dist to center -> converge toward the center (outro)
 * - alternate: pi on odd mobile index -> alternating pair/impair groups (build)
 * Missing position -> grid fallback by index. Unknown/off -> 0 (current behavior).
 */
export function spatialPhaseFor(
  pos: { x: number; y: number } | undefined,
  pattern: string | undefined,
  mobileIdx: number,
): number {
  if (!pattern || pattern === 'off') return 0;
  if (pattern === 'alternate') return mobileIdx % 2 === 0 ? 0 : Math.PI;
  const p = pos ?? fallbackPosition(Math.max(0, mobileIdx));
  const cx = p.x - 0.5;
  const cy = p.y - 0.5;
  switch (pattern) {
    case 'wave': return -Math.PI * 2 * cx;
    case 'circle': return Math.PI * 2 * cx;
    case 'expand': return -Math.PI * 2 * Math.sqrt(cx * cx + cy * cy);
    case 'contract': return Math.PI * 2 * Math.sqrt(cx * cx + cy * cy);
    default: return 0;
  }
}
