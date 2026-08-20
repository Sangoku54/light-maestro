// ─── DMX Movement Utilities ───────────────────────────────
// Extracted from dmx-playback.ts — stage-aware pan/tilt clamping + smart movement patterns

export function clampPanToStage(panDmx: number, x: number): number {
  const d = panDmx - 128;
  return 128 + Math.max(-Math.round(x * 128), Math.min(Math.round((1 - x) * 128), d));
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
