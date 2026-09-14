/**
 * Fixture Tracks — per-fixture/group override lanes on the QuickShow timeline.
 *
 * Each FixtureTrack overrides the master cues for a specific fixture or group:
 *  - Color blocks: force a specific color for a time range
 *  - Dimmer blocks: force dimmer value (0-255)
 *  - Strobe blocks: force strobe speed (Hz) for a time range
 *  - Movement type: override the master movement pattern
 *  - Effect blocks: force a saved effect for a time range
 *
 * Merge strategy: fixture track wins over master. If no block is active, fall back to master.
 */

import type { DmxCue } from './dmx-cues';
import type { PatchedFixture, SavedEffect, EfxPattern } from '../stores/showStore';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ColorBlock {
  id: string;
  time: number;
  endTime: number;
  color: string;
  endColor?: string; // gradient end color; if set, draw gradient bar
}

export interface DimmerBlock {
  id: string;
  time: number;
  endTime: number;
  value: number; // 0-255
  endValue?: number; // end value for gradient ramp
}

export interface StrobeBlock {
  id: string;
  time: number;
  endTime: number;
  speed: number; // Hz
  endSpeed?: number; // end speed for gradient ramp
}

export interface MovementBlock {
  id: string;
  time: number;
  endTime: number;
  pattern: 'static' | 'sweep' | 'circle' | 'bounce' | 'wave' | 'figure8' | 'zigzag' | 'diamond' | 'spiral' | 'heartbeat' | 'randomWalk' | 'panOnly' | 'tiltOnly';
  amplitude: number; // 0-255
  /** Vitesse du pattern (Hz). Absente = vitesse audio-reactive de l'autoscript. */
  speed?: number;
  endSpeed?: number; // end speed for gradient ramp
  endPattern?: string; // end pattern for gradient transition
  endAmplitude?: number; // end amplitude for gradient transition
}

export interface FixtureTrack {
  id: string;
  /** One of: fixture:<id>, group:<groupId>, tier:primary, tier:secondary, tier:tertiary */
  target: string;
  label: string;
  enabled: boolean;
  /** Display-only: names of fixtures targeted by this track (timeline UI). */
  fixtureNames?: string[];
  colorBlocks: ColorBlock[];
  dimmerBlocks: DimmerBlock[];
  strobeBlocks: StrobeBlock[];
  movementBlocks: MovementBlock[];
  /** Additional channel overrides: addr → value (for gobo/prism/zoom etc.) */
  channelOverrides: Record<number, number>;
}

export interface FixtureTrackDMX {
  /** Per-fixture DMX overrides: fixtureId → { address → value } */
  overrides: Map<string, Record<number, number>>;
  /** Per-fixture forced color at current time */
  forcedColors: Map<string, string>;
  /** Per-fixture forced dimmer at current time */
  forcedDimmers: Map<string, number>;
  /** Per-fixture forced strobe at current time */
  forcedStrobes: Map<string, { active: boolean; speed: number }>;
  /** Per-fixture movement override */
  forcedMovements: Map<string, { pattern: string; amplitude: number; speed?: number }>;
}

// ═══════════════════════════════════════════════════════════
// Resolve: fixture track target → list of fixture IDs
// ═══════════════════════════════════════════════════════════

export function resolveTrackTargets(
  track: FixtureTrack,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): string[] {
  if (track.target.startsWith('fixture:')) {
    const fid = track.target.slice(8);
    return patchedFixtures.some(f => f.id === fid) ? [fid] : [];
  }
  if (track.target.startsWith('group:')) {
    const gid = track.target.slice(6);
    const group = fixtureGroups.find(g => g.id === gid);
    return group ? group.fixtureIds.filter(fid => patchedFixtures.some(f => f.id === fid)) : [];
  }
  if (track.target.startsWith('tier:')) {
    const tier = track.target.slice(5) as 'primary' | 'secondary' | 'tertiary';
    return patchedFixtures.filter(f => f.tier === tier).map(f => f.id);
  }
  return [];
}

// ═══════════════════════════════════════════════════════════
// Compute active overrides at a given time
// ═══════════════════════════════════════════════════════════

export function computeFixtureTrackOverrides(
  tracks: FixtureTrack[],
  ctime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): FixtureTrackDMX {
  const overrides = new Map<string, Record<number, number>>();
  const forcedColors = new Map<string, string>();
  const forcedDimmers = new Map<string, number>();
  const forcedStrobes = new Map<string, { active: boolean; speed: number }>();
  const forcedMovements = new Map<string, { pattern: string; amplitude: number; speed?: number }>();

  for (const track of tracks) {
    if (!track.enabled) continue;
    const targets = resolveTrackTargets(track, patchedFixtures, fixtureGroups);

    // Collect active blocks
    const activeColor = track.colorBlocks.find(b => ctime >= b.time && ctime < b.endTime);
    const activeDimmer = track.dimmerBlocks.find(b => ctime >= b.time && ctime < b.endTime);
    const activeStrobe = track.strobeBlocks.find(b => ctime >= b.time && ctime < b.endTime);
    const activeMovement = track.movementBlocks.find(b => ctime >= b.time && ctime < b.endTime);

    for (const fid of targets) {
      if (activeColor) {
        if (activeColor.endColor && activeColor.endColor !== activeColor.color) {
          // Gradient block: interpolate between start (color) and end (endColor)
          const dur = activeColor.endTime - activeColor.time;
          const t = dur > 0 ? (ctime - activeColor.time) / dur : 0;
          const sr = parseInt(activeColor.color.slice(1,3),16);
          const sg = parseInt(activeColor.color.slice(3,5),16);
          const sb = parseInt(activeColor.color.slice(5,7),16);
          const er = parseInt(activeColor.endColor.slice(1,3),16);
          const eg = parseInt(activeColor.endColor.slice(3,5),16);
          const eb = parseInt(activeColor.endColor.slice(5,7),16);
          const rr = Math.round(sr + (er - sr) * t);
          const rg = Math.round(sg + (eg - sg) * t);
          const rb = Math.round(sb + (eb - sb) * t);
          const clampedRr = Math.max(0, Math.min(255, rr));
          const clampedRg = Math.max(0, Math.min(255, rg));
          const clampedRb = Math.max(0, Math.min(255, rb));
          const interp = '#' + [clampedRr, clampedRg, clampedRb].map(v => v.toString(16).padStart(2,'0')).join('');
          forcedColors.set(fid, interp);
        } else {
          forcedColors.set(fid, activeColor.color);
        }
      }
      if (activeDimmer) forcedDimmers.set(fid, activeDimmer.value);
      if (activeStrobe && !forcedStrobes.has(fid)) forcedStrobes.set(fid, { active: true, speed: activeStrobe.speed });
      if (activeMovement) forcedMovements.set(fid, { pattern: activeMovement.pattern, amplitude: activeMovement.amplitude, speed: activeMovement.speed });

      // Channel-level overrides — statiques pour le track entier (toujours actifs si track enabled)
      if (Object.keys(track.channelOverrides).length > 0) {
        const existing = overrides.get(fid) || {};
        Object.assign(existing, track.channelOverrides);
        overrides.set(fid, existing);
      }
    }
  }

  return { overrides, forcedColors, forcedDimmers, forcedStrobes, forcedMovements };
}

// ═══════════════════════════════════════════════════════════
// Create a default track for a fixture
// ═══════════════════════════════════════════════════════════

export function createFixtureTrack(
  target: string,
  label: string,
): FixtureTrack {
  return {
    id: `ft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    target,
    label,
    enabled: true,
    colorBlocks: [],
    dimmerBlocks: [],
    strobeBlocks: [],
    movementBlocks: [],
    channelOverrides: {},
  };
}

// ═══════════════════════════════════════════════════════════
// Generate DMX cues from fixture tracks (standalone)
// ═══════════════════════════════════════════════════════════

export function generateTrackDmxCues(
  tracks: FixtureTrack[],
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
  universes: { id: string }[],
): DmxCue[] {
  const cues: DmxCue[] = [];
  const uniIds = universes.map(u => String(u.id));

  // Collect all block time points
  const timePoints = new Set<number>();
  for (const track of tracks) {
    if (!track.enabled) continue;
    for (const b of track.colorBlocks) { timePoints.add(b.time); timePoints.add(b.endTime); }
    for (const b of track.dimmerBlocks) { timePoints.add(b.time); timePoints.add(b.endTime); }
    for (const b of track.strobeBlocks) { timePoints.add(b.time); timePoints.add(b.endTime); }
    for (const b of track.movementBlocks) { timePoints.add(b.time); timePoints.add(b.endTime); }
  }
  const sortedTimes = [...timePoints].sort((a, b) => a - b);

  for (const t of sortedTimes) {
    const fto = computeFixtureTrackOverrides(tracks, t, patchedFixtures, fixtureGroups);

    for (const pf of patchedFixtures) {
      const uniIdx = uniIds.indexOf(pf.universeId);
      const uniNum = uniIdx >= 0 ? uniIdx : 0;
      const chVals: Record<number, number> = {};

      const overrideCh = fto.overrides.get(pf.id);
      if (overrideCh) Object.assign(chVals, overrideCh);

      const forcedColor = fto.forcedColors.get(pf.id);
      const forcedDimmer = fto.forcedDimmers.get(pf.id);
      const forcedStrobe = fto.forcedStrobes.get(pf.id);

      // We can't compute full DMX without fixture definitions here,
      // so we emit minimal cues with just the override info.
      // The actual DMX merge happens in useDmxPlayback/computeDmxForCue.
      if (forcedColor || forcedDimmer !== undefined || forcedStrobe || Object.keys(chVals).length > 0) {
        cues.push({
          time: t,
          section: 'override',
          universe: uniNum,
          channelValues: chVals,
          fixtureNames: [pf.name],
          fixtureCount: 1,
          effect: 'Fixture Track',
          colors: forcedColor ? [forcedColor] : [],
        });
      }
    }
  }

  return cues;
}

// ═══════════════════════════════════════════════════════════
// EFX Track Overlays — generate DMX pan/tilt from saved effects
// ═══════════════════════════════════════════════════════════

/** Minimal EFX track entry interface matching EfxTrackEntry */
export interface EfxEntryRef {
  time: number;
  endTime: number;
  effectId: string;
  pattern: string;
  fixtureNames: string[];
}

/** Minimal EFX track interface for the DMX engine */
export interface EfxTrackRef {
  id: string;
  name: string;
  entries: EfxEntryRef[];
  targetFixtures: { type: 'all' | 'group' | 'fixture'; groupId?: string; fixtureIds?: string[] };
}

/**
 * Forme normalisée d'un pattern EFX (-1..1, avant mise à l'échelle DMX).
 *
 * C'est LA math de référence, partagée par le moteur du show, le preview SVG,
 * la boucle live de l'éditeur et le snapshot 3D : un seul endroit à maintenir
 * pour que le preview soit rigoureusement identique aux projecteurs.
 * Ordre fixe : rotation du point brut (degrés → radians), puis mise à
 * l'échelle (width/height) et offsets (xOffset/yOffset en unités /255).
 */
export function evalEfxNormalized(
  pattern: EfxPattern,
  t: number,        // relative time in cycles (0 = start, scales with speed)
  width: number,
  height: number,
  rotation: number,  // degrees (SavedEffect.rotation est en degrés)
  xOffset: number,
  yOffset: number,
): { x: number; y: number } {
  const twoPi = Math.PI * 2;
  const seg = ((t % 1) + 1) % 1;
  const phase = t * twoPi;
  let rawPan = 0;
  let rawTilt = 0;

  switch (pattern) {
    case 'Circle': rawPan = Math.cos(phase); rawTilt = Math.sin(phase); break;
    case 'Line': { const lp = seg; const lx = lp < 0.5 ? (lp * 2) * 2 - 1 : (1 - (lp - 0.5) * 2) * 2 - 1; rawPan = lx; rawTilt = 0; break; }
    case 'Eight': rawPan = Math.sin(phase); rawTilt = Math.sin(phase * 2) * 0.5; break;
    case 'Square': { const s = seg * 4; const sIdx = Math.floor(s) % 4; const sFrac = s - Math.floor(s); const cs: [number, number][] = [[1,1],[-1,1],[-1,-1],[1,-1]]; const ce: [number, number][] = [[-1,1],[-1,-1],[1,-1],[1,1]]; rawPan = cs[sIdx][0] + (ce[sIdx][0] - cs[sIdx][0]) * sFrac; rawTilt = cs[sIdx][1] + (ce[sIdx][1] - cs[sIdx][1]) * sFrac; break; }
    case 'Triangle': { const ta = seg * 3; const ti = Math.floor(ta) % 3; const tf = ta - Math.floor(ta); const tv: [number, number][] = [[0,-1],[-0.866,0.5],[0.866,0.5]]; const tn = tv[(ti+1)%3]; rawPan = tv[ti][0] + (tn[0]-tv[ti][0])*tf; rawTilt = tv[ti][1] + (tn[1]-tv[ti][1])*tf; break; }
    case 'Infinity': rawPan = Math.cos(phase); rawTilt = Math.sin(phase * 2) * 0.5; break;
    case 'Zigzag': { const z = seg * 2 - 1; rawPan = z; const zs = seg * 8; const zi = Math.floor(zs); const zf = zs - zi; rawTilt = zi % 2 === 0 ? -1 + zf * 2 : 1 - zf * 2; break; }
    case 'Spiral': { const sr = 0.2 + seg * 0.8; rawPan = Math.cos(phase) * sr; rawTilt = Math.sin(phase) * sr; break; }
    case 'DoubleCircle': { const dc = Math.cos(phase), ds = Math.sin(phase); const dc2 = Math.cos(phase + Math.PI) * 0.5, ds2 = Math.sin(phase + Math.PI) * 0.5; const b = (Math.sin(phase*3)+1)/2; rawPan = dc*(1-b)+dc2*b; rawTilt = ds*(1-b)+ds2*b; break; }
    case 'Heart': { const hx = 16*Math.pow(Math.sin(phase),3); const hy = 13*Math.cos(phase)-5*Math.cos(2*phase)-2*Math.cos(3*phase)-Math.cos(4*phase); rawPan = hx/16; rawTilt = -hy/16; break; }
    default: rawPan = Math.cos(phase); rawTilt = Math.sin(phase); break;
  }

  // rotation est en degrés → radians
  const rotRad = rotation * Math.PI / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const rx = rawPan * cosR - rawTilt * sinR;
  const ry = rawPan * sinR + rawTilt * cosR;

  // Scale and offset (unités normalisées ; le passage DMX multiplie par 127)
  const w = width ?? 1; const h = height ?? 1;
  const ox = (xOffset || 0) / 255;
  const oy = (yOffset || 0) / 255;
  return { x: rx * w + ox, y: ry * h + oy };
}

/**
 * Generate pan/tilt DMX values from an EFX pattern at a given relative time.
 * Returns { pan, tilt } in 0-255 range.
 */
export function generateEfxPanTilt(
  pattern: EfxPattern,
  t: number,        // relative time in cycles (0 = start, scales with speed)
  width: number,
  height: number,
  rotation: number,  // degrees (SavedEffect.rotation est en degrés)
  xOffset: number,
  yOffset: number,
): { pan: number; tilt: number } {
  const { x, y } = evalEfxNormalized(pattern, t, width, height, rotation, xOffset, yOffset);
  const prePan = Math.round(128 + x * 127);
  const preTilt = Math.round(128 + y * 127);

  return {
    pan: Math.max(0, Math.min(255, prePan)),
    tilt: Math.max(0, Math.min(255, preTilt)),
  };
}

/**
 * Compute active EFX pan/tilt overrides for all fixtures at a given time.
 * Returns Map<fixtureId, { pan, tilt }> with DMX values (0-255).
 */
export function computeEfxOverrides(
  efxTracks: EfxTrackRef[],
  currentTime: number,
  effects: SavedEffect[],
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
  fixturePositions?: Record<string, { x: number; y: number; h: number }>,
): Map<string, { pan: number; tilt: number }> {
  const result = new Map<string, { pan: number; tilt: number }>();
  const effectMap = new Map(effects.map(e => [e.id, e]));

  for (const track of efxTracks) {
    // Resolve targets
    let targetIds: string[];
    if (track.targetFixtures.type === 'fixture') {
      targetIds = track.targetFixtures.fixtureIds || [];
    } else if (track.targetFixtures.type === 'group') {
      const g = fixtureGroups.find(g => g.id === track.targetFixtures.groupId);
      targetIds = g ? g.fixtureIds.filter(fid => patchedFixtures.some(f => f.id === fid)) : [];
    } else {
      targetIds = patchedFixtures.map(f => f.id);
    }

    // Find active EFX entry — dernier entré gagne si chevauchement
    // Normalise les bornes (certains blocs créés par drag ont endTime <= time)
    const actives = track.entries.filter(e => {
      const s = Math.min(e.time, e.endTime);
      const en = Math.max(e.time, e.endTime);
      return currentTime >= s && currentTime < en;
    });
    const activeEntry = actives.length > 0 ? actives[actives.length - 1] : undefined;
    if (!activeEntry) continue;
    const s = Math.min(activeEntry.time, activeEntry.endTime);
    const en = Math.max(activeEntry.time, activeEntry.endTime);

    // Look up the effect definition
    const effect = effectMap.get(activeEntry.effectId);
    if (!effect) continue;

    const speed = effect.speed || 0.5;
    // Base de temps CONTINUE sur l'horloge absolue du show — identique à
    // l'aperçu live de l'éditeur et à ShowManager (phase = t·speed·2 rad, soit
    // speed/π Hz, l'unité affichée dans l'éditeur). L'ancienne formule
    // entry-relative (((currentTime - s) / dur) * speed) ne bouclait jamais un
    // cycle complet par entrée et rendait la vitesse dépendante de la longueur
    // du bloc — le show ne ressemblait pas au preview. s/en bornent toujours
    // l'entrée active, seule la phase est désormais absolue (sans saut : la
    // position est continue en t, seule la pente change si speed change).
    const relTime = (currentTime * speed * 2) / (Math.PI * 2);

    // Generate pan/tilt for this effect
    const pt = generateEfxPanTilt(
      effect.pattern,
      relTime,
      effect.width,
      effect.height,
      effect.rotation,
      effect.xOffset,
      effect.yOffset,
    );

    // Apply to all targets
    for (const fid of targetIds) {
      result.set(fid, pt);
    }
  }

  return result;
}