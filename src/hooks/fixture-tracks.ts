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
import type { PatchedFixture } from '../stores/showStore';

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
}

export interface StrobeBlock {
  id: string;
  time: number;
  endTime: number;
  speed: number; // Hz
}

export interface MovementBlock {
  id: string;
  time: number;
  endTime: number;
  pattern: 'static' | 'sweep' | 'circle' | 'bounce' | 'wave' | 'figure8';
  amplitude: number; // 0-255
}

export interface FixtureTrack {
  id: string;
  /** One of: fixture:<id>, group:<groupId>, tier:primary, tier:secondary, tier:tertiary */
  target: string;
  label: string;
  enabled: boolean;
  colorBlocks: ColorBlock[];
  dimmerBlocks: DimmerBlock[];
  strobeBlocks: StrobeBlocks[];
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
  forcedMovements: Map<string, { pattern: string; amplitude: number }>;
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
  const forcedMovements = new Map<string, { pattern: string; amplitude: number }>();

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
          const interp = '#' + [rr, rg, rb].map(v => v.toString(16).padStart(2,'0')).join('');
          forcedColors.set(fid, interp);
        } else {
          forcedColors.set(fid, activeColor.color);
        }
      }
      if (activeDimmer) forcedDimmers.set(fid, activeDimmer.value);
      if (activeStrobe) forcedStrobes.set(fid, { active: true, speed: activeStrobe.speed });
      if (activeMovement) forcedMovements.set(fid, { pattern: activeMovement.pattern, amplitude: activeMovement.amplitude });

      // Channel-level overrides
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