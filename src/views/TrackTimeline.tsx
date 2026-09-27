/**
 * TrackTimeline — multi-track DMX timeline.
 *
 * Layout (top → bottom, scrollable):
 *   1. Header labels (24px) — fixture names
 *   2. Per-fixture tracks (30px each) — colored bars at cue times
 *   3. AutoScript track (40px) — dimmer curve + pan/tilt lines + strobe markers
 *   4. EFX tracks (28px each) — saved effect regions, right-click to insert
 *
 * Audio waveform is rendered *outside* this component (via AudioFileUpload).
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { TrackSection } from '../hooks/audio-analysis';
import type { DmxCue } from '../hooks/dmx-cues';
import type { PatchedFixture } from '../stores/showStore';
import type { FixtureTrack, ColorBlock, DimmerBlock, StrobeBlock, MovementBlock } from '../hooks/fixture-tracks';
import { useTranslation } from 'react-i18next';
import { resolveTrackTargets, createFixtureTrack } from '../hooks/fixture-tracks';
import { useAppStore } from '../stores/appStore';

// ─── Tier hue-shift helpers ────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

function hueShiftHex(hex: string, deg: number): string {
  if (deg === 0) return hex;
  const [r, g, b] = hexToRgb(hex);
  const nr = r/255, ng = g/255, nb = b/255;
  const mx = Math.max(nr,ng,nb), mn = Math.min(nr,ng,nb);
  const l = (mx+mn)/2;
  if (mx === mn) return hex;
  const d = mx-mn;
  const s = l > 0.5 ? d/(2-mx-mn) : d/(mx+mn);
  let h: number;
  if (mx===nr) h = ((ng-nb)/d + (ng<nb?6:0)) * 60;
  else if (mx===ng) h = ((nb-nr)/d + 2) * 60;
  else h = ((nr-ng)/d + 4) * 60;
  h = (h + deg) % 360; if (h < 0) h += 360;
  const c = (1-Math.abs(2*l-1))*s;
  const x = c*(1-Math.abs((h/60)%2-1));
  const m = l-c/2;
  let r2: number, g2: number, b2: number;
  if (h<60) { r2=c; g2=x; b2=0; }
  else if (h<120) { r2=x; g2=c; b2=0; }
  else if (h<180) { r2=0; g2=c; b2=x; }
  else if (h<240) { r2=0; g2=x; b2=c; }
  else if (h<300) { r2=x; g2=0; b2=c; }
  else { r2=c; g2=0; b2=x; }
  return '#' + [Math.round((r2+m)*255), Math.round((g2+m)*255), Math.round((b2+m)*255)]
    .map(v => v.toString(16).padStart(2,'0')).join('');
}

const TIER_HUE_DEG = { primary: 0, secondary: 120, tertiary: 240, other: 0 } as const;

// ─── Types ─────────────────────────────────────────────────

interface Cue {
  time: number;
  section: string;
  intensity: string;
  color: string;
  colors: string[];
  strobe: boolean;
  fixtureCount?: number;
  fixtureNames?: string[];
  movement?: 'static' | 'sweep' | 'circle' | 'pulse' | 'wave';
  effect?: string;
  energy?: number;
}

/** A single entry on an EFX track — one effect placed at a time position. */
export interface EfxTrackEntry {
  /** Stable entry id (generated on creation; old saves may lack it). */
  id?: string;
  time: number;
  endTime: number;
  effectId: string;
  effectName: string;
  pattern: string;
  fixtureNames: string[];
  /** Custom display label (renamed section); falls back to effectName. */
  label?: string;
}

/** An EFX track — a dedicated lane for placing saved effects on the timeline. */
export interface EfxTrack {
  id: string;
  name: string;
  entries: EfxTrackEntry[];
  /** Which fixtures this track targets */
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

// ─── Color Track types ──────────────────────────────────

export interface ColorTrackEntry {
  id: string;
  time: number;
  endTime: number;
  color: string;       // start color
  endColor?: string;   // end color (defaults to color if not set)
  /** Custom display label (renamed section). */
  label?: string;
}

export interface ColorTrack {
  id: string;
  name: string;
  entries: ColorTrackEntry[];
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

// ─── Strobe Track types ────────────────────────────────

export interface StrobeTrackEntry {
  id: string;
  time: number;
  endTime: number;
  speed: number;       // strobe speed (Hz, 1-25)
  endSpeed?: number;   // end speed for gradient (defaults to speed)
  /** Custom display label (renamed section). */
  label?: string;
}

export interface StrobeTrack {
  id: string;
  name: string;
  entries: StrobeTrackEntry[];
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

// ─── Dimmer Track types ────────────────────────────────

export interface DimmerTrackEntry {
  id: string;
  time: number;
  endTime: number;
  value: number;       // dimmer value (0-100%)
  endValue?: number;   // end value for gradient (defaults to value)
  /** Custom display label (renamed section). */
  label?: string;
}

export interface DimmerTrack {
  id: string;
  name: string;
  entries: DimmerTrackEntry[];
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

// ── Chaser Track types ────────────────────────────────

export interface ChaserTrackEntry {
  id: string;
  time: number;
  endTime: number;
  chaserId: string;
  chaserName?: string;
  /** Custom display label (renamed section). */
  label?: string;
}

export interface ChaserTrack {
  id: string;
  name: string;
  entries: ChaserTrackEntry[];
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

// ── Show Track types (comme chaser mais pour un show complet) ──

export interface ShowTrackEntry {
  id: string;
  time: number;
  endTime: number;
  showId: string;
  showName?: string;
  /** Custom display label (renamed section). */
  label?: string;
}

export interface ShowTrack {
  id: string;
  name: string;
  entries: ShowTrackEntry[];
}

// ── Scene Track types (scène directe : prend le dessus sur l'autoscript) ──
// Contrairement à la chaser track (scène via un chaser), la scene track joue
// les canaux statiques d'une scène telle quelle — idéal pour un focus fixe.

export interface SceneTrackEntry {
  id: string;
  time: number;
  endTime: number;
  sceneId: string;
  sceneName?: string;
  /** Custom display label (renamed section). */
  label?: string;
}

export interface SceneTrack {
  id: string;
  name: string;
  entries: SceneTrackEntry[];
}

// ── Matrix Track types (matrice RGB : prend la main via le moteur rgb-matrix
// pendant sa plage, comme chaser/show/scene) ──

export interface MatrixTrackEntry {
  id: string;
  time: number;
  endTime: number;
  matrixId: string;
  matrixName?: string;
  /** Custom display label (renamed section). */
  label?: string;
}

export interface MatrixTrack {
  id: string;
  name: string;
  entries: MatrixTrackEntry[];
}

interface TrackTimelineProps {
  cues: Cue[];
  dmxCues?: DmxCue[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  sections: TrackSection[];
  patchedFixtures: PatchedFixture[];
  bpm: number;
  /** Magnétisme : aligne les temps draggés/créés sur les beats (barres
   *  verticales). Désactivable depuis la top barre du QuickShow. Défaut ON. */
  snapToBeats?: boolean;
  /** EFX tracks to render below the AutoScript track */
  efxTracks?: EfxTrack[];
  /** Called when user right-clicks on an EFX track row */
  onEfxTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  /** Called when user left-clicks an EFX entry */
  onEfxEntryClick?: (trackId: string, entry: EfxTrackEntry) => void;
  /** Called when user drag-resizes or drag-moves an EFX entry */
  onEfxEntryChange?: (trackId: string, entryIndex: number, updates: Partial<EfxTrackEntry>) => void;
  /** Called when user right-clicks an EFX entry */
  onEfxEntryContextMenu?: (trackId: string, entry: EfxTrackEntry, clientX: number, clientY: number) => void;
  /** Color tracks to render below EFX tracks */
  colorTracks?: ColorTrack[];
  /** Called when user right-clicks on a color track row */
  onColorTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  /** Called when user left-clicks a color track entry */
  onColorEntryClick?: (trackId: string, entry: ColorTrackEntry) => void;
  /** Called when user right-clicks a color track entry */
  onColorEntryContextMenu?: (trackId: string, entry: ColorTrackEntry, clientX: number, clientY: number) => void;
  /** Called when user drag-resizes or drag-moves a color entry */
  onColorEntryChange?: (trackId: string, entryIndex: number, newTime: number, newEndTime: number) => void;
  /** Strobe tracks to render below color tracks */
  strobeTracks?: StrobeTrack[];
  /** Called when user right-clicks on a strobe track row */
  onStrobeTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  /** Called when user left-clicks a strobe entry */
  onStrobeEntryClick?: (trackId: string, entry: StrobeTrackEntry) => void;
  /** Called when user right-clicks a strobe entry */
  onStrobeEntryContextMenu?: (trackId: string, entry: StrobeTrackEntry, clientX: number, clientY: number) => void;
  /** Called when user drag-resizes or drag-moves a strobe entry */
  onStrobeEntryChange?: (trackId: string, entryIndex: number, newTime: number, newEndTime: number) => void;
  /** Dimmer tracks to render below strobe tracks */
  dimmerTracks?: DimmerTrack[];
  /** Called when user right-clicks on a dimmer track row */
  onDimmerTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  /** Called when user left-clicks a dimmer entry */
  onDimmerEntryClick?: (trackId: string, entry: DimmerTrackEntry) => void;
  /** Called when user right-clicks a dimmer entry */
  onDimmerEntryContextMenu?: (trackId: string, entry: DimmerTrackEntry, clientX: number, clientY: number) => void;
  /** Called when user drag-resizes or drag-moves a dimmer entry */
  onDimmerEntryChange?: (trackId: string, entryIndex: number, newTime: number, newEndTime: number) => void;
  /** Chaser tracks to render below dimmer tracks */
  chaserTracks?: ChaserTrack[];
  /** Called when user right-clicks on a chaser track row */
  onChaserTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  /** Called when user left-clicks a chaser entry */
  onChaserEntryClick?: (trackId: string, entry: ChaserTrackEntry) => void;
  /** Called when user right-clicks a chaser entry */
  onChaserEntryContextMenu?: (trackId: string, entry: ChaserTrackEntry, clientX: number, clientY: number) => void;
  /** Called when user drag-resizes or drag-moves a chaser entry */
  onChaserEntryChange?: (trackId: string, entryIndex: number, newTime: number, newEndTime: number) => void;
  /** Scene tracks to render below show tracks */
  sceneTracks?: SceneTrack[];
  /** Called when user right-clicks on a scene track row */
  onSceneTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  /** Called when user left-clicks a scene entry */
  onSceneEntryClick?: (trackId: string, entry: SceneTrackEntry) => void;
  /** Called when user right-clicks a scene entry */
  onSceneEntryContextMenu?: (trackId: string, entry: SceneTrackEntry, clientX: number, clientY: number) => void;
  /** Called when user drag-resizes or drag-moves a scene entry */
  onSceneEntryChange?: (trackId: string, entryIndex: number, newTime: number, newEndTime: number) => void;
  /** Matrix tracks to render below scene tracks */
  matrixTracks?: MatrixTrack[];
  /** Called when user right-clicks on a matrix track row */
  onMatrixTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  /** Called when user left-clicks a matrix entry */
  onMatrixEntryClick?: (trackId: string, entry: MatrixTrackEntry) => void;
  /** Called when user right-clicks a matrix entry */
  onMatrixEntryContextMenu?: (trackId: string, entry: MatrixTrackEntry, clientX: number, clientY: number) => void;
  /** Called when user drag-resizes or drag-moves a matrix entry */
  onMatrixEntryChange?: (trackId: string, entryIndex: number, newTime: number, newEndTime: number) => void;
  /** Show tracks — prennent le dessus sur l'autoscript (comme chaser) */
  showTracks?: ShowTrack[];
  onShowTrackContextMenu?: (trackId: string, time: number, clientX: number, clientY: number) => void;
  onShowEntryClick?: (trackId: string, entry: ShowTrackEntry) => void;
  onShowEntryContextMenu?: (trackId: string, entry: ShowTrackEntry, clientX: number, clientY: number) => void;
  onShowEntryChange?: (trackId: string, entryIndex: number, newTime: number, newEndTime: number) => void;
  /** Called when user drags a section boundary to resize */
  onSectionsChange?: (sections: TrackSection[]) => void;
  /** Called when user right-clicks on the AutoScript track to insert a section */
  onAutoScriptContextMenu?: (time: number, clientX: number, clientY: number) => void;
  /** Fixture tracks (override lanes drawn inside fixture tracks) */
  fixtureTracks?: FixtureTrack[];
  /** Called when fixture track blocks change */
  onFixtureTracksChange?: (tracks: FixtureTrack[]) => void;
  /** Color lane */
  showColorTrack?: boolean;
  showStrobeTrack?: boolean;
  forcedColors?: Record<string, string>;
  forcedDimmer?: Record<string, number>;
  forcedStrobe?: Record<string, boolean>;
  showDimmerTrack?: boolean;
  colorEntries?: Array<{ id: string; time: number; endTime: number; color: string }>;
  dimmerEntries?: Array<{ id: string; time: number; endTime: number; value: number }>;
  strobeEntries?: Array<{ id: string; time: number; endTime: number; speed: number }>;
  /** Disabled fixture IDs (checkboxes) */
  disabledFixtures?: Set<string>;
  onToggleFixture?: (fixtureId: string) => void;
  /** Energy curve for mini-waveform (values 0-1, one sample per pixel or time step) */
  energyCurve?: Float32Array | number[];
  /** Cue markers to overlay on waveform (dmxCues or genCues) */
  cueMarkers?: Array<{ time: number; tier?: string; section?: string }>;
}

// ─── Constants ────────────────────────────────────────────

const TRACK_HEIGHT = 30;
const HEADER_HEIGHT = 32;
const AUTOSCRIPT_TRACK_HEIGHT = 40;
const WAVEFORM_HEIGHT = 28;
const EFX_TRACK_HEIGHT = 28;
const COLOR_TRACK_HEIGHT = 26;
const STROBE_TRACK_HEIGHT = 26;
const DIMMER_TRACK_HEIGHT = 26;
const CHASER_TRACK_HEIGHT = 26;
const SHOW_TRACK_HEIGHT = 26;
const SCENE_TRACK_HEIGHT = 26;
const MATRIX_TRACK_HEIGHT = 26;
const LABEL_WIDTH = 90;

const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10)).padStart(1, '0')}`;

// ─── Helpers ──────────────────────────────────────────────

function intensityToValue(intensity: string): number {
  switch (intensity) {
    case 'low': return 0.3;
    case 'medium': return 0.6;
    case 'high': return 1.0;
    case 'dynamic': return 0.5;
    default: return 0.5;
  }
}

function intensityToBarHeight(intensity: string): number {
  switch (intensity) {
    case 'low': return 8;
    case 'medium': return 16;
    case 'high': return 24;
    case 'dynamic': return 16;
    default: return 14;
  }
}

/**
 * Build a lookup: (timeKey, fixtureName) → list of matching cues.
 * Used to determine which fixture tracks get a bar at each cue time.
 */
function buildFixtureCueMap(
  cues: Cue[],
  dmxCues: DmxCue[] | undefined,
): Map<string, Cue[]> {
  const map = new Map<string, Cue[]>();
  if (!dmxCues || dmxCues.length === 0) {
    // No DMX data — every cue affects all fixtures (fallback)
    for (const cue of cues) {
      const key = `t${cue.time.toFixed(2)}|*`;
      const existing = map.get(key);
      if (existing) {
        existing.push(cue);
      } else {
        map.set(key, [cue]);
      }
    }
    return map;
  }

  // Build time → fixtureNames map from DMX cues
  const dmxByTime = new Map<string, Set<string>>();
  for (const dc of dmxCues) {
    const tKey = dc.time.toFixed(2);
    let names = dmxByTime.get(tKey);
    if (!names) {
      names = new Set();
      dmxByTime.set(tKey, names);
    }
    for (const n of dc.fixtureNames) {
      names.add(n);
    }
  }

  // Map each cue's time to the fixtures that are active at that time
  for (const cue of cues) {
    const tKey = cue.time.toFixed(2);
    const affectedFixtures = dmxByTime.get(tKey);
    if (affectedFixtures && affectedFixtures.size > 0) {
      for (const fn of affectedFixtures) {
        const key = `t${tKey}|${fn}`;
        const existing = map.get(key);
        if (existing) {
          existing.push(cue);
        } else {
          map.set(key, [cue]);
        }
      }
    } else {
      // Cue didn't match any DMX time — assign to all fixtures
      const key = `t${tKey}|*`;
      const existing = map.get(key);
      if (existing) {
        existing.push(cue);
      } else {
        map.set(key, [cue]);
      }
    }
  }
  return map;
}

/** Find the EFX entry closest to a given time position within a track. */
function findEfxEntryAt(
  track: EfxTrack,
  timeAtX: number,
  duration: number,
): EfxTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: EfxTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

function findColorEntryAt(
  track: ColorTrack,
  timeAtX: number,
  duration: number,
): ColorTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: ColorTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

function findStrobeEntryAt(
  track: StrobeTrack,
  timeAtX: number,
  duration: number,
): StrobeTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: StrobeTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

function findDimmerEntryAt(
  track: DimmerTrack,
  timeAtX: number,
  duration: number,
): DimmerTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: DimmerTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

function findChaserEntryAt(
  track: ChaserTrack,
  timeAtX: number,
  duration: number,
): ChaserTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: ChaserTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

function findShowEntryAt(
  track: ShowTrack,
  timeAtX: number,
  duration: number,
): ShowTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: ShowTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

function findSceneEntryAt(
  track: SceneTrack,
  timeAtX: number,
  duration: number,
): SceneTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: SceneTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

function findMatrixEntryAt(
  track: MatrixTrack,
  timeAtX: number,
  duration: number,
): MatrixTrackEntry | null {
  const threshold = Math.min(2, duration * 0.05);
  let best: MatrixTrackEntry | null = null;
  let bestDist = Infinity;
  for (const entry of track.entries) {
    const entryMid = (entry.time + entry.endTime) / 2;
    const halfLen = (entry.endTime - entry.time) / 2 + 0.1;
    const d = Math.abs(entryMid - timeAtX);
    if (d < halfLen + threshold && d < bestDist) {
      best = entry;
      bestDist = d;
    }
  }
  return best;
}

// ─── Component ────────────────────────────────────────────

const TrackTimeline: React.FC<TrackTimelineProps> = ({
  cues,
  dmxCues,
  duration,
  currentTime,
  onSeek,
  sections,
  patchedFixtures,
  bpm,
  snapToBeats,
  efxTracks,
  onEfxTrackContextMenu,
  onEfxEntryClick,
  onEfxEntryChange,
  onEfxEntryContextMenu,
  colorTracks,
  onColorTrackContextMenu,
  onColorEntryClick,
  onColorEntryContextMenu,
  onColorEntryChange,
  strobeTracks,
  onStrobeTrackContextMenu,
  onStrobeEntryClick,
  onStrobeEntryContextMenu,
  onStrobeEntryChange,
  dimmerTracks,
  onDimmerTrackContextMenu,
  onDimmerEntryClick,
  onDimmerEntryContextMenu,
  onDimmerEntryChange,
  chaserTracks,
  onChaserTrackContextMenu,
  onChaserEntryClick,
  onChaserEntryContextMenu,
  onChaserEntryChange,
  showTracks,
  onShowTrackContextMenu,
  onShowEntryClick,
  onShowEntryContextMenu,
  onShowEntryChange,
  sceneTracks,
  onSceneTrackContextMenu,
  onSceneEntryClick,
  onSceneEntryContextMenu,
  onSceneEntryChange,
  matrixTracks,
  onMatrixTrackContextMenu,
  onMatrixEntryClick,
  onMatrixEntryContextMenu,
  onMatrixEntryChange,
  onSectionsChange,
  onAutoScriptContextMenu,
  fixtureTracks,
  onFixtureTracksChange,
  showColorTrack,
  showStrobeTrack,
  forcedColors,
  forcedDimmer,
  forcedStrobe,
  showDimmerTrack,
  colorEntries,
  dimmerEntries,
  strobeEntries,
  disabledFixtures,
  onToggleFixture,
  energyCurve,
  cueMarkers,
}) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Refs for stale-closure-safe access in callbacks
  const disabledFixturesRef2 = useRef(disabledFixtures);
  disabledFixturesRef2.current = disabledFixtures;
  const onToggleFixtureRef = useRef(onToggleFixture);
  onToggleFixtureRef.current = onToggleFixture;
  const [tooltip, setTooltip] = useState<{
    cue: Cue;
    x: number;
    y: number;
    fixtureName?: string;
    efxEntry?: EfxTrackEntry;
    trackName?: string;
  } | null>(null);
  const [hoveredCue, setHoveredCue] = useState<{ cue: Cue; fixtureName?: string } | null>(null);

  // ─── Fixture track selection — use refs for drag (stale closure safe) ──
  const [ftSelStart, setFtSelStart] = useState<number | null>(null);
  const [ftSelEnd, setFtSelEnd] = useState<number | null>(null);
  const [ftSelFixture, setFtSelFixture] = useState<number | null>(null);
  const [ftSelTrack, setFtSelTrack] = useState<FixtureTrack | null>(null);
  const [ftMenu, setFtMenu] = useState<{ x: number; y: number; trackIdx: number; timeAtX: number } | null>(null);

  const [gradientPicker, setGradientPicker] = useState(null);
  const qs = useAppStore(s => s.quickShow);
  const setQs = useAppStore(s => s.setQuickShow);
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; trackIdx: number; blockId: string; blockType: string } | null>(null);

  const [editBlock, setEditBlock] = useState<{ trackIdx: number; blockId: string; blockType: string } | null>(null);

  const [zoomLevel, setZoomLevel] = useState(1);
  // Non-passive wheel listener for Ctrl+zoom (React synthetic events are passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheelNonPassive = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoomLevel(prev => Math.max(0.25, Math.min(8, prev + (e.deltaY < 0 ? 0.25 : -0.25)))); }
    };
    el.addEventListener('wheel', onWheelNonPassive, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNonPassive);
  }, []);
  const [clipboard, setClipboard] = useState<any>(null);  const ftDragStart = useRef(0);
  const ftDragFixture = useRef(-1);
  const isFtDragging = useRef(false);
  const ftSelRef = useRef({ start: 0, end: 0, fixture: -1, track: null as FixtureTrack | null });
  const blockDragRef = useRef(null);
  const pendingBlockDrag = useRef(null);

  const numFixtures = patchedFixtures.length;
  const numEfxTracks = efxTracks?.length ?? 0;
  const numColorTracks = colorTracks?.length ?? 0;
  const numStrobeTracks = strobeTracks?.length ?? 0;
  const numDimmerTracks = dimmerTracks?.length ?? 0;
  const numChaserTracks = chaserTracks?.length ?? 0;
  const numShowTracks = showTracks?.length ?? 0;
  const numSceneTracks = sceneTracks?.length ?? 0;
  const numMatrixTracks = matrixTracks?.length ?? 0;
  const TIER_ORDER: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2, other: 3 };
  const [collapsedTiers, setCollapsedTiers] = useState<Set<string>>(new Set());
  // Sort fixtures by tier, compute header positions
  const tieredLayout = useMemo(() => {
    const sorted = [...patchedFixtures].sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99));
    const seen = new Set<string>();
    const list: ({ type: 'header'; tier: string } | { type: 'fixture'; fi: number })[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i].tier;
      if (!seen.has(t)) { seen.add(t); list.push({ type: 'header', tier: t }); }
      if (!collapsedTiers.has(t)) list.push({ type: 'fixture', fi: i });
    }
    return { sorted: sorted, list, count: list.length };
  }, [patchedFixtures, collapsedTiers]);
  const totalHeight = HEADER_HEIGHT + tieredLayout.count * TRACK_HEIGHT + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT + numColorTracks * COLOR_TRACK_HEIGHT + numStrobeTracks * STROBE_TRACK_HEIGHT + numDimmerTracks * DIMMER_TRACK_HEIGHT + numChaserTracks * CHASER_TRACK_HEIGHT + numShowTracks * SHOW_TRACK_HEIGHT + numSceneTracks * SCENE_TRACK_HEIGHT + numMatrixTracks * MATRIX_TRACK_HEIGHT;

  // Helper: resolve Y position to display row (header or fixture)
  const resolveDisplayRow = useCallback((y: number) => {
    const di = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);
    if (di < 0 || di >= tieredLayout.list.length) return null;
    const row = tieredLayout.list[di];
    if (row.type === 'header') return { type: 'header' as const, tier: row.tier, di };
    return { type: 'fixture' as const, fixture: tieredLayout.sorted[row.fi], fi: row.fi, di };
  }, [tieredLayout]);

  const fixtureAreaHeight = tieredLayout.count * TRACK_HEIGHT; // replaces fixtureAreaHeight

  // ── Fixture → cue mapping (memoized) ─────────────────
  const fixtureCueMap = useMemo(
    () => buildFixtureCueMap(cues, dmxCues),
    [cues, dmxCues],
  );

  // ── Get cues for a specific fixture ──────────────────
  const getCuesForFixture = useCallback(
    (fixtureName: string): Cue[] => {
      const result: Cue[] = [];
      for (const cue of cues) {
        const tKey = cue.time.toFixed(2);
        const specificKey = `t${tKey}|${fixtureName}`;
        const wildcardKey = `t${tKey}|*`;
        const fromMap = fixtureCueMap.get(specificKey);
        if (fromMap && fromMap.length > 0) {
          result.push(...fromMap);
        } else {
          const fromWild = fixtureCueMap.get(wildcardKey);
          if (fromWild && fromWild.length > 0) {
            result.push(...fromWild);
          }
        }
      }
      return result;
    },
    [cues, fixtureCueMap],
  );

  // ── Aggregate AutoScript data ────────────────────────
  const autoScriptData = useMemo(() => {
    if (cues.length === 0) return { dimmer: [] as { t: number; v: number }[], dimmerSecondary: [] as { t: number; v: number }[], dimmerTertiary: [] as { t: number; v: number }[], pan: [] as { t: number; v: number }[], tilt: [] as { t: number; v: number }[], strobes: [] as number[] };

    const sorted = [...cues].sort((a, b) => a.time - b.time);
    const dimmer: { t: number; v: number }[] = [];
    const dimmerSecondary: { t: number; v: number }[] = [];
    const dimmerTertiary: { t: number; v: number }[] = [];
    const pan: { t: number; v: number }[] = [];
    const tilt: { t: number; v: number }[] = [];
    const strobes: number[] = [];

    // Tier intensity multipliers (matching defaults in dmx-cues.ts)
    const TIER_PRIMARY_MULT = 1.0;
    const TIER_SECONDARY_MULT = 0.7;
    const TIER_TERTIARY_MULT = 0.4;

    // Build curves with intermediate points for smoothness
    for (let i = 0; i < sorted.length; i++) {
      const cue = sorted[i];
      const iv = intensityToValue(cue.intensity);
      dimmer.push({ t: cue.time, v: iv });
      dimmerSecondary.push({ t: cue.time, v: iv * TIER_SECONDARY_MULT });
      dimmerTertiary.push({ t: cue.time, v: iv * TIER_TERTIARY_MULT });

      // Pan / tilt derived from movement type
      const phase = (cue.time / (duration || 1)) * Math.PI * 2;
      let pv = 0.5;
      let tv = 0.5;
      switch (cue.movement) {
        case 'sweep':
          pv = 0.3 + Math.sin(phase * 3) * 0.4;
          tv = 0.5 + Math.cos(phase * 2.7) * 0.3;
          break;
        case 'circle':
          pv = 0.5 + Math.sin(phase * 2) * 0.4;
          tv = 0.5 + Math.cos(phase * 2) * 0.4;
          break;
        case 'wave':
          pv = 0.5 + Math.sin(phase * 4) * 0.35;
          tv = 0.5 + Math.cos(phase * 3.5) * 0.3;
          break;
        case 'pulse':
          pv = 0.5 + Math.sin(phase * 1.5) * 0.2;
          tv = 0.5 + Math.sin(phase * 1.5 + 0.7) * 0.2;
          break;
        case 'static':
        default:
          pv = 0.5 + Math.sin(phase * 0.5) * 0.1;
          tv = 0.5 + Math.cos(phase * 0.5) * 0.1;
          break;
      }
      pan.push({ t: cue.time, v: pv });
      tilt.push({ t: cue.time, v: tv });

      if (cue.strobe) {
        strobes.push(cue.time);
      }
    }

    return { dimmer, dimmerSecondary, dimmerTertiary, pan, tilt, strobes };
  }, [cues, duration]);

  // ── Section resize state ───────────────────────────
  const sectionResizeRef = useRef<{
    sectionIndex: number;
    edge: 'left' | 'right';
    startX: number;
    startTime: number;
    otherEdgeTime: number;
  } | null>(null);

  // ── EFX entry drag state ──────────────────────────
  const efxDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Color entry drag state (parallel to EFX drag) ──
  const colorDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Strobe entry drag state (parallel to EFX drag) ──
  const strobeDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Dimmer entry drag state (parallel to EFX drag) ──
  const dimmerDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Chaser entry drag state (parallel to EFX drag) ──
  const chaserDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Show entry drag state ──
  const showDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Scene entry drag state (parallel to chaser/show drag) ──
  const sceneDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Matrix entry drag state (parallel to scene drag) ──
  const matrixDragRef = useRef<{
    trackId: string;
    entryIndex: number;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    entryTime: number;
    entryEndTime: number;
  } | null>(null);

  // ── Cue lookup for hover/click ───────────────────────
  const getCueAtPosition = useCallback(
    (clientX: number, clientY: number): { cue: Cue; fixtureName?: string; efxEntry?: EfxTrackEntry; trackName?: string } | null => {
      const c = containerRef.current;
      if (!c) return null;
      const rect = c.getBoundingClientRect();
      const x = clientX - rect.left - LABEL_WIDTH;
      const y = clientY - rect.top + c.scrollTop;
      if (x < 0 || y < HEADER_HEIGHT) return null;

      const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
      if (drawW <= 0) return null;
      const timeAtX = (x / drawW) * duration;

      // Check which track we're on
      const displayIdx = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);

      // If on a fixture track
      if (displayIdx >= 0 && displayIdx < tieredLayout.list.length) {
        const row = tieredLayout.list[displayIdx];
        if (row.type === 'header') return null;
        const fixture = tieredLayout.sorted[row.fi];
        const fixtureCues = getCuesForFixture(fixture.name);
        let best: Cue | null = null;
        let bestDist = Infinity;
        const threshold = Math.min(2, duration * 0.05);
        for (const cue of fixtureCues) {
          const d = Math.abs(cue.time - timeAtX);
          if (d < threshold && d < bestDist) {
            best = cue;
            bestDist = d;
          }
        }
        return best ? { cue: best, fixtureName: fixture.name } : null;
      }

      // AutoScript track
      const autoTrackStart = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0);
      if (y >= autoTrackStart && y < autoTrackStart + AUTOSCRIPT_TRACK_HEIGHT) {
        let best: Cue | null = null;
        let bestDist = Infinity;
        const threshold = Math.min(2, duration * 0.05);
        for (const cue of cues) {
          const d = Math.abs(cue.time - timeAtX);
          if (d < threshold && d < bestDist) {
            best = cue;
            bestDist = d;
          }
        }
        return best ? { cue: best } : null;
      }

      // EFX tracks
      const eTracks = efxTracks || [];
      const efxTracksStart = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
      if (y >= efxTracksStart && eTracks.length > 0) {
        const eTrackIdx = Math.floor((y - efxTracksStart) / EFX_TRACK_HEIGHT);
        if (eTrackIdx >= 0 && eTrackIdx < eTracks.length) {
          const eTrack = eTracks[eTrackIdx];
          const entry = findEfxEntryAt(eTrack, timeAtX, duration);
          if (entry) {
            return {
              cue: {
                time: entry.time,
                section: 'efx',
                intensity: 'medium',
                color: '#06b6d4',
                colors: ['#06b6d4'],
                strobe: false,
                effect: entry.effectName,
              },
              efxEntry: entry,
              trackName: eTrack.name,
            };
          }
        }
      }

      return null;
    },
    [duration, tieredLayout, getCuesForFixture, cues, efxTracks],
  );

  // ── Event handlers ───────────────────────────────────
  // Magnétisme : snap des temps sur les beats (barres verticales du canvas).
  // Config via ref (valeurs toujours fraîches, aucun rebind des handlers).
  const snapCfgRef = useRef({ on: true, beat: 0.5 });
  snapCfgRef.current = {
    on: snapToBeats ?? true,
    beat: 60 / Math.max(40, Math.min(300, bpm || 120)),
  };
  const snapT = (t: number): number => {
    const cfg = snapCfgRef.current;
    if (!cfg.on || !(cfg.beat > 0)) return t;
    return Math.max(0, Math.min(duration, Math.round(t / cfg.beat) * cfg.beat));
  };
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Fixture track drag selection — use refs, never stale
      if (isFtDragging.current) {
        // Hide tooltip during drag so selection is visible
        setTooltip(null);
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const timeAtX = ((e.clientX - rect.left - LABEL_WIDTH) / drawW) * duration;
        const t = Math.max(0, Math.min(duration, timeAtX));
        setFtSelEnd(t);
        // Also update start in ref for context menu
        ftSelRef.current.start = ftDragStart.current;
        ftSelRef.current.end = t;
        ftSelRef.current.fixture = ftDragFixture.current;
        return;
      }

      // ── Block drag ──
      // 3px threshold
      if (pendingBlockDrag.current && !blockDragRef.current) {
        var dxTest = Math.abs(e.clientX - pendingBlockDrag.current.initialX);
        if (dxTest > 3) { blockDragRef.current = pendingBlockDrag.current; pendingBlockDrag.current = null; }
      }
      if (blockDragRef.current) {
        setTooltip(null);
        const drg = blockDragRef.current;
        const cb3 = containerRef.current;
        if (!cb3) return;
        const rb3 = cb3.getBoundingClientRect();
        const dwb3 = (rb3.width - LABEL_WIDTH) * zoomLevel;
        if (dwb3 <= 0) return;
        const dt = ((e.clientX - drg.initialX) / dwb3) * duration;
        const dur = drg.blockDur;
        const newStart = snapT(Math.max(0, Math.min(duration - dur, drg.startTime + dt)));
        const newEnd = newStart + dur;
        const ft = fixtureTracks[drg.trackIdx];
        if (ft) {
          const updater = (arr) => arr.map(b => b.id === drg.blockId ? { ...b, time: newStart, endTime: newEnd } : b);
          const updated = fixtureTracks.map((t, i) => {
            if (i !== drg.trackIdx) return t;
            var type = drg.blockType;
            if (type === 'color') return { ...t, colorBlocks: updater(t.colorBlocks) };
            if (type === 'dimmer') return { ...t, dimmerBlocks: updater(t.dimmerBlocks) };
            if (type === 'strobe') return { ...t, strobeBlocks: updater(t.strobeBlocks) };
            if (type === 'movement') return { ...t, movementBlocks: updater(t.movementBlocks) };
            return t;
          });
          onFixtureTracksChange(updated);
        }
        return;
      }

            // EFX entry drag/resize
      if (efxDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - efxDragRef.current.startX) / drawW * duration;
        const drag = efxDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onEfxEntryChange?.(drag.trackId, drag.entryIndex, { time: newTime, endTime: newEnd });
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onEfxEntryChange?.(drag.trackId, drag.entryIndex, { time: newTime });
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onEfxEntryChange?.(drag.trackId, drag.entryIndex, { endTime: newEnd });
        }
        return;
      }

            // Color entry drag/resize (parallel to EFX)
      if (colorDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - colorDragRef.current.startX) / drawW * duration;
        const drag = colorDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onColorEntryChange?.(drag.trackId, drag.entryIndex, newTime, newEnd);
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onColorEntryChange?.(drag.trackId, drag.entryIndex, newTime, drag.entryEndTime);
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onColorEntryChange?.(drag.trackId, drag.entryIndex, drag.entryTime, newEnd);
        }
        return;
      }

      // Strobe entry drag/resize (parallel to EFX)
      if (strobeDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - strobeDragRef.current.startX) / drawW * duration;
        const drag = strobeDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onStrobeEntryChange?.(drag.trackId, drag.entryIndex, newTime, newEnd);
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onStrobeEntryChange?.(drag.trackId, drag.entryIndex, newTime, drag.entryEndTime);
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onStrobeEntryChange?.(drag.trackId, drag.entryIndex, drag.entryTime, newEnd);
        }
        return;
      }

      // Dimmer entry drag/resize (parallel to EFX)
      if (dimmerDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - dimmerDragRef.current.startX) / drawW * duration;
        const drag = dimmerDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onDimmerEntryChange?.(drag.trackId, drag.entryIndex, newTime, newEnd);
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onDimmerEntryChange?.(drag.trackId, drag.entryIndex, newTime, drag.entryEndTime);
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onDimmerEntryChange?.(drag.trackId, drag.entryIndex, drag.entryTime, newEnd);
        }
        return;
      }

      // Chaser entry drag/resize (parallel to EFX)
      if (chaserDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - chaserDragRef.current.startX) / drawW * duration;
        const drag = chaserDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onChaserEntryChange?.(drag.trackId, drag.entryIndex, newTime, newEnd);
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onChaserEntryChange?.(drag.trackId, drag.entryIndex, newTime, drag.entryEndTime);
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onChaserEntryChange?.(drag.trackId, drag.entryIndex, drag.entryTime, newEnd);
        }
        return;
      }

      // Show entry drag/resize
      if (showDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - showDragRef.current.startX) / drawW * duration;
        const drag = showDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onShowEntryChange?.(drag.trackId, drag.entryIndex, newTime, newEnd);
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onShowEntryChange?.(drag.trackId, drag.entryIndex, newTime, drag.entryEndTime);
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onShowEntryChange?.(drag.trackId, drag.entryIndex, drag.entryTime, newEnd);
        }
        return;
      }

      // Scene entry drag/resize (parallel to show)
      if (sceneDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - sceneDragRef.current.startX) / drawW * duration;
        const drag = sceneDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onSceneEntryChange?.(drag.trackId, drag.entryIndex, newTime, newEnd);
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onSceneEntryChange?.(drag.trackId, drag.entryIndex, newTime, drag.entryEndTime);
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onSceneEntryChange?.(drag.trackId, drag.entryIndex, drag.entryTime, newEnd);
        }
        return;
      }

      // Matrix entry drag/resize (parallel to scene)
      if (matrixDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = (e.clientX - matrixDragRef.current.startX) / drawW * duration;
        const drag = matrixDragRef.current;
        if (drag.mode === 'move') {
          const newTime = snapT(Math.max(0, drag.entryTime + dx));
          const newEnd = newTime + (drag.entryEndTime - drag.entryTime);
          onMatrixEntryChange?.(drag.trackId, drag.entryIndex, newTime, newEnd);
        } else if (drag.mode === 'resize-left') {
          const rawL = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          const newTime = Math.min(drag.entryEndTime - 0.1, snapT(rawL));
          onMatrixEntryChange?.(drag.trackId, drag.entryIndex, newTime, drag.entryEndTime);
        } else if (drag.mode === 'resize-right') {
          const rawR = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          const newEnd = Math.max(drag.entryTime + 0.2, snapT(rawR));
          onMatrixEntryChange?.(drag.trackId, drag.entryIndex, drag.entryTime, newEnd);
        }
        return;
      }

      // Section resize in progress — déplace séparatrice et efface partie chevauchée
      if (sectionResizeRef.current) {
        const resize = sectionResizeRef.current;
        const c = containerRef.current;
        if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
        if (drawW <= 0) return;
        const dx = e.clientX - resize.startX;
        const dt = (dx / drawW) * duration;
        const rawTime = Math.max(0, Math.min(duration, resize.startTime + dt));
        const newTime = snapT(rawTime);
        const sorted = [...sections].sort((a,b)=>a.startTime-b.startTime);
        // retrouve l'index trié correspondant à sectionIndex (sections peut ne pas être trié, on map par id/start)
        const target = sections[resize.sectionIndex];
        let leftIdx = -1, rightIdx = -1;
        // cherche dans sorted l'élément correspondant (par référence start/end/type)
        for (let i=0;i<sorted.length;i++) if (sorted[i]===target) { if (resize.edge==='left') { leftIdx=i-1; rightIdx=i; } else { leftIdx=i; rightIdx=i+1; } break; }
        // fallback par proximité si non trouvé (sections non triés)
        if (leftIdx===-1 && rightIdx===-1) {
          if (resize.edge==='left') { rightIdx = sorted.findIndex(s=>Math.abs(s.startTime - resize.startTime)<1e-6); leftIdx = rightIdx-1; }
          else { leftIdx = sorted.findIndex(s=>Math.abs(s.endTime - resize.startTime)<1e-6); rightIdx = leftIdx+1; }
        }
        if (leftIdx < -1) leftIdx = -1;
        if (rightIdx >= sorted.length) { /* bord extrême : simple trim */ }
        const minLen = 0.05;
        let next: typeof sorted = [];
        for (let i=0;i<sorted.length;i++) {
          const s = sorted[i];
          if (i===leftIdx) {
            const ns = { ...s, endTime: newTime };
            if (ns.endTime - ns.startTime > minLen) next.push(ns);
            continue;
          }
          if (i===rightIdx) {
            const ns = { ...s, startTime: newTime };
            if (ns.endTime - ns.startTime > minLen) next.push(ns);
            continue;
          }
          if (leftIdx>=0 && rightIdx>=0 && rightIdx<sorted.length) {
            // left side clipped to [0,newTime), right side to [newTime,dur)
            if (i < leftIdx) {
              if (s.endTime <= newTime + 1e-9) next.push(s);
              else if (s.startTime < newTime - 1e-9) {
                if (s.startTime < newTime - minLen) next.push({ ...s, endTime: newTime });
              }
              // else fully beyond -> effacé
            } else if (i > rightIdx) {
              if (s.startTime >= newTime - 1e-9) next.push(s);
              else if (s.endTime > newTime + 1e-9) {
                if (newTime + minLen < s.endTime) next.push({ ...s, startTime: newTime });
              }
            }
          } else {
            // bord extrême sans voisin : simple clamp déjà fait
            next.push(s);
          }
        }
        // si séparatrice en bord (leftIdx -1 ou rightIdx out of range), on a déjà traité via left/right
        // nettoie et trie
        next = next.filter(s=>s.endTime - s.startTime > minLen).sort((a,b)=>a.startTime-b.startTime);
        onSectionsChange?.(next);
        return;
      }

      const result = getCueAtPosition(e.clientX, e.clientY);
      if (result) {
        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip({
          cue: result.cue,
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          fixtureName: result.fixtureName,
          efxEntry: result.efxEntry,
          trackName: result.trackName,
        });
      } else {
        setTooltip(null);
      }
    },
    [getCueAtPosition, duration, sections, onSectionsChange, energyCurve, onEfxEntryChange, onColorEntryChange, onStrobeEntryChange, onDimmerEntryChange, onChaserEntryChange, onShowEntryChange, onSceneEntryChange],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // ── Fixture enable/disable checkbox click (canvas-drawn) ──
      const _dtf = onToggleFixtureRef.current;
      const _dfx = disabledFixturesRef2.current;
      if (_dtf) {
        const c = containerRef.current; if (c) {
          const rect = c.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top + c.scrollTop;
          if (my >= HEADER_HEIGHT && mx < LABEL_WIDTH) {
            const di = Math.floor((my - HEADER_HEIGHT) / TRACK_HEIGHT);
            if (di >= 0 && di < tieredLayout.list.length) {
              const row = tieredLayout.list[di];
              if (row.type === 'fixture') { _dtf(tieredLayout.sorted[row.fi].id); return; }
              if (row.type === 'header') {
                setCollapsedTiers(prev => { const n=new Set(prev); n.has(row.tier)?n.delete(row.tier):n.add(row.tier); return n; });
                return;
              }
            }
          }
        }
      }

      // ── Close block menu on any click ──
if (editBlock) { setEditBlock(null); return; }
            // ── Ctrl+C ──
      if ((e.ctrlKey || e.metaKey) && fixtureTracks && onFixtureTracksChange) {
        if (editBlock) {
          const ft = fixtureTracks[editBlock.trackIdx];
          if (ft) {
            let blk = null;
            let bt = editBlock.blockType;
            if (bt === "color") blk = ft.colorBlocks.find(b => b.id === editBlock.blockId);
            else if (bt === "dimmer") blk = ft.dimmerBlocks.find(b => b.id === editBlock.blockId);
            else if (bt === "strobe") blk = ft.strobeBlocks.find(b => b.id === editBlock.blockId);
            else if (bt === "movement") blk = ft.movementBlocks.find(b => b.id === editBlock.blockId);
            if (blk) setClipboard({ ...blk, _type: bt });
          }
        }
      }
      // ── Ctrl+V ──
      if ((e.ctrlKey || e.metaKey) && clipboard && fixtureTracks && onFixtureTracksChange) {
        const dur = clipboard.endTime - clipboard.time;
        const nb = { ...clipboard, id: (clipboard._type || "cb") + "-" + Date.now(), time: currentTime, endTime: currentTime + dur };
        delete nb._type;
        if (fixtureTracks.length > 0) {
          const updated = fixtureTracks.map((t, i) => {
            if (i !== 0) return t;
            const type = clipboard._type;
            if (type === "color") return { ...t, colorBlocks: [...t.colorBlocks, nb] };
            if (type === "dimmer") return { ...t, dimmerBlocks: [...t.dimmerBlocks, nb] };
            if (type === "strobe") return { ...t, strobeBlocks: [...t.strobeBlocks, nb] };
            if (type === "movement") return { ...t, movementBlocks: [...t.movementBlocks, nb] };
            return t;
          });
          onFixtureTracksChange(updated);
        }
      }

      pendingBlockDrag.current = null;
      if (blockMenu) { setBlockMenu(null); return; }
      // ── Left-click on fixture track blocks opens edit popup ──
      if (fixtureTracks && onFixtureTracksChange && e.button === 0) {
        const canvas2 = canvasRef.current;
        if (canvas2) {
          const rect2 = canvas2.getBoundingClientRect();
          const x2 = e.clientX - rect2.left;
          const y2 = e.clientY - rect2.top;
          const duration2 = duration || 120000;
          const drawW2 = canvas2.width - LABEL_WIDTH;
          if (y2 >= HEADER_HEIGHT && x2 >= LABEL_WIDTH) {
            const di2 = Math.floor((y2 - HEADER_HEIGHT) / TRACK_HEIGHT);
            if (di2 >= 0 && di2 < tieredLayout.list.length && tieredLayout.list[di2].type === 'fixture') {
              const fixture2 = tieredLayout.sorted[(tieredLayout.list[di2] as any).fi];
              const fi2 = (tieredLayout.list[di2] as any).fi;
              const timeAtX2 = ((x2 - LABEL_WIDTH) / drawW2) * duration2;
              for (let fti2 = 0; fti2 < fixtureTracks.length; fti2++) {
                const ft2 = fixtureTracks[fti2];
                if (!ft2.enabled) continue;
                let targetsFixture2 = false;
                if (ft2.target.startsWith('fixture:')) targetsFixture2 = ft2.target.slice(8) === fixture2.id;
                else if (ft2.target.startsWith('tier:')) targetsFixture2 = ft2.target.slice(5) === fixture2.tier;
                else targetsFixture2 = true;
                if (!targetsFixture2) continue;
                // Check all block types
                for (const blk2 of ft2.colorBlocks) {
                  if (timeAtX2 >= blk2.time && timeAtX2 <= blk2.endTime) {
                    setEditBlock({ trackIdx: fti2, blockId: blk2.id, blockType: 'color' });
                    // Also select the time range
                    setFtSelStart(blk2.time);
                    setFtSelEnd(blk2.endTime);
                    setFtSelFixture(fi2);
                    setFtSelTrack({ ...ft2, fixtureNames: [fixture2.name] });
                    ftSelRef.current = { start: blk2.time, end: blk2.endTime, fixture: fi2, track: { ...ft2, fixtureNames: [fixture2.name] } };
                    return;
                  }
                }
                for (const blk2 of ft2.dimmerBlocks) {
                  if (timeAtX2 >= blk2.time && timeAtX2 <= blk2.endTime) {
                    setEditBlock({ trackIdx: fti2, blockId: blk2.id, blockType: 'dimmer' });
                    setFtSelStart(blk2.time);
                    setFtSelEnd(blk2.endTime);
                    setFtSelFixture(fi2);
                    setFtSelTrack({ ...ft2, fixtureNames: [fixture2.name] });
                    ftSelRef.current = { start: blk2.time, end: blk2.endTime, fixture: fi2, track: { ...ft2, fixtureNames: [fixture2.name] } };
                    return;
                  }
                }
                for (const blk2 of ft2.strobeBlocks) {
                  if (timeAtX2 >= blk2.time && timeAtX2 <= blk2.endTime) {
                    setEditBlock({ trackIdx: fti2, blockId: blk2.id, blockType: 'strobe' });
                    setFtSelStart(blk2.time);
                    setFtSelEnd(blk2.endTime);
                    setFtSelFixture(fi2);
                    setFtSelTrack({ ...ft2, fixtureNames: [fixture2.name] });
                    ftSelRef.current = { start: blk2.time, end: blk2.endTime, fixture: fi2, track: { ...ft2, fixtureNames: [fixture2.name] } };
                    return;
                  }
                }
                for (const blk2 of ft2.movementBlocks) {
                  if (timeAtX2 >= blk2.time && timeAtX2 <= blk2.endTime) {
                    setEditBlock({ trackIdx: fti2, blockId: blk2.id, blockType: 'movement' });
                    setFtSelStart(blk2.time);
                    setFtSelEnd(blk2.endTime);
                    setFtSelFixture(fi2);
                    setFtSelTrack({ ...ft2, fixtureNames: [fixture2.name] });
                    ftSelRef.current = { start: blk2.time, end: blk2.endTime, fixture: fi2, track: { ...ft2, fixtureNames: [fixture2.name] } };
                    return;
                  }
                }
              }
            }
          }
        }
      }

      // ── Right-click on fixture track blocks shows context menu ──
      if (fixtureTracks && onFixtureTracksChange && e.button === 2) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const trackDuration = duration || 120000; // from props
          const drawW = canvas.width - LABEL_WIDTH;
          if (y >= HEADER_HEIGHT && x >= LABEL_WIDTH) {
            const di3 = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);
            if (di3 >= 0 && di3 < tieredLayout.list.length && tieredLayout.list[di3].type === 'fixture') {
              const fixture = tieredLayout.sorted[(tieredLayout.list[di3] as any).fi];
              const timeAtX = ((x - LABEL_WIDTH) / drawW) * trackDuration;
              for (let fti = 0; fti < fixtureTracks.length; fti++) {
                const ft = fixtureTracks[fti];
                if (!ft.enabled) continue;
                let targetsFixture = false;
                if (ft.target.startsWith('fixture:')) targetsFixture = ft.target.slice(8) === fixture.id;
                else if (ft.target.startsWith('tier:')) targetsFixture = ft.target.slice(5) === fixture.tier;
                else targetsFixture = true;
                if (!targetsFixture) continue;
                for (const blk of ft.colorBlocks) {
                  if (timeAtX >= blk.time && timeAtX <= blk.endTime) {
                    e.preventDefault();
                    setBlockMenu({ x: e.clientX, y: e.clientY, trackIdx: fti, blockId: blk.id, blockType: 'color' });
                    return;
                  }
                }
                for (const blk of ft.dimmerBlocks) {
                  if (timeAtX >= blk.time && timeAtX <= blk.endTime) {
                    e.preventDefault();
                    setBlockMenu({ x: e.clientX, y: e.clientY, trackIdx: fti, blockId: blk.id, blockType: 'dimmer' });
                    return;
                  }
                }
                for (const blk of ft.strobeBlocks) {
                  if (timeAtX >= blk.time && timeAtX <= blk.endTime) {
                    e.preventDefault();
                    setBlockMenu({ x: e.clientX, y: e.clientY, trackIdx: fti, blockId: blk.id, blockType: 'strobe' });
                    return;
                  }
                }
                for (const blk of ft.movementBlocks) {
                  if (timeAtX >= blk.time && timeAtX <= blk.endTime) {
                    e.preventDefault();
                    setBlockMenu({ x: e.clientX, y: e.clientY, trackIdx: fti, blockId: blk.id, blockType: 'movement' });
                    return;
                  }
                }
              }
            }
          }
        }
      }

      // Clear fixture track selection on regular click (but NOT if context menu is open)
      if (ftSelStart !== null && !ftMenu) {
        setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null); setFtSelTrack(null);
        ftSelRef.current = { start: 0, end: 0, fixture: -1, track: null };
      }

      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const y = e.clientY - rect.top + c.scrollTop;
      if (x < 0) return;

      const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
      if (drawW <= 0) return;

      const timeAtX = (x / drawW) * duration;

      // Check if we hit a cue
      const result = getCueAtPosition(e.clientX, e.clientY);
      if (result) {
        if (result.efxEntry && onEfxEntryClick) {
          onEfxEntryClick(
            efxTracks?.find(t => t.name === result.trackName)?.id || '',
            result.efxEntry,
          );
        }
        onSeek(result.cue.time);
        return;
      }

      // Chaser entry hit test (left-click selects + seeks)
      if (chaserTracks && chaserTracks.length > 0) {
        const cT = chaserTracks;
        const eT = efxTracks || [];
        const sT = strobeTracks || [];
        const dT = dimmerTracks || [];
        const efxBase = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
        const colorBase = efxBase + eT.length * EFX_TRACK_HEIGHT;
        const strobeBase = colorBase + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
        const dimmerBase = strobeBase + sT.length * STROBE_TRACK_HEIGHT;
        const chaserBase = dimmerBase + dT.length * DIMMER_TRACK_HEIGHT;
        if (y >= chaserBase && y < chaserBase + cT.length * CHASER_TRACK_HEIGHT) {
          const cIdx = Math.floor((y - chaserBase) / CHASER_TRACK_HEIGHT);
          if (cIdx >= 0 && cIdx < cT.length) {
            const cTrack = cT[cIdx];
            const entry = cTrack.entries.find(en => timeAtX >= en.time && timeAtX <= en.endTime);
            if (entry && onChaserEntryClick) {
              onChaserEntryClick(cTrack.id, entry);
              onSeek(entry.time);
              return;
            }
          }
        }
      }

      // Scene entry hit test (left-click selects + seeks)
      if (sceneTracks && sceneTracks.length > 0) {
        const scT = sceneTracks;
        const eT = efxTracks || [];
        const sT = strobeTracks || [];
        const dT = dimmerTracks || [];
        const cT = chaserTracks || [];
        const shT = showTracks || [];
        const efxBase = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
        const colorBase = efxBase + eT.length * EFX_TRACK_HEIGHT;
        const strobeBase = colorBase + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
        const dimmerBase = strobeBase + sT.length * STROBE_TRACK_HEIGHT;
        const chaserBase = dimmerBase + dT.length * DIMMER_TRACK_HEIGHT;
        const showBase = chaserBase + cT.length * CHASER_TRACK_HEIGHT;
        const sceneBase = showBase + shT.length * SHOW_TRACK_HEIGHT;
        if (y >= sceneBase && y < sceneBase + scT.length * SCENE_TRACK_HEIGHT) {
          const sIdx = Math.floor((y - sceneBase) / SCENE_TRACK_HEIGHT);
          if (sIdx >= 0 && sIdx < scT.length) {
            const sTrack = scT[sIdx];
            const entry = sTrack.entries.find(en => timeAtX >= en.time && timeAtX <= en.endTime);
            if (entry && onSceneEntryClick) {
              onSceneEntryClick(sTrack.id, entry);
              onSeek(entry.time);
              return;
            }
          }
        }
      }

      // Matrix entry hit test (left-click selects + seeks)
      if (matrixTracks && matrixTracks.length > 0) {
        const mT = matrixTracks;
        const eT = efxTracks || [];
        const sT = strobeTracks || [];
        const dT = dimmerTracks || [];
        const cT = chaserTracks || [];
        const shT = showTracks || [];
        const scT = sceneTracks || [];
        const efxBase = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
        const colorBase = efxBase + eT.length * EFX_TRACK_HEIGHT;
        const strobeBase = colorBase + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
        const dimmerBase = strobeBase + sT.length * STROBE_TRACK_HEIGHT;
        const chaserBase = dimmerBase + dT.length * DIMMER_TRACK_HEIGHT;
        const showBase = chaserBase + cT.length * CHASER_TRACK_HEIGHT;
        const sceneBase = showBase + shT.length * SHOW_TRACK_HEIGHT;
        const matrixBase = sceneBase + scT.length * SCENE_TRACK_HEIGHT;
        if (y >= matrixBase && y < matrixBase + mT.length * MATRIX_TRACK_HEIGHT) {
          const mIdx = Math.floor((y - matrixBase) / MATRIX_TRACK_HEIGHT);
          if (mIdx >= 0 && mIdx < mT.length) {
            const mTrack = mT[mIdx];
            const entry = mTrack.entries.find(en => timeAtX >= en.time && timeAtX <= en.endTime);
            if (entry && onMatrixEntryClick) {
              onMatrixEntryClick(mTrack.id, entry);
              onSeek(entry.time);
              return;
            }
          }
        }
      }

      // Seek to position
      onSeek(Math.max(0, Math.min(duration, timeAtX)));
    },
    [duration, getCueAtPosition, onSeek, efxTracks, onEfxEntryClick, dimmerTracks, onDimmerEntryClick, chaserTracks, onChaserEntryClick, sceneTracks, onSceneEntryClick, matrixTracks, onMatrixEntryClick, showTracks, colorTracks, strobeTracks, fixtureAreaHeight, energyCurve],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const y = e.clientY - rect.top + c.scrollTop;

      const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
      if (x < 0 || drawW <= 0) return;
      const timeAtX = (x / drawW) * duration;

      // Fixture track: if we have a selection, show override menu
      if (fixtureTracks && onFixtureTracksChange && ftSelRef.current.start < ftSelRef.current.end) {
        const tDi = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);
        if (tDi >= 0 && tDi < tieredLayout.list.length && tieredLayout.list[tDi].type === 'fixture') {
          e.preventDefault();
          const fixture = tieredLayout.sorted[(tieredLayout.list[tDi] as any).fi];
          const tIdx = fixtureTracks.findIndex((ft) => {
            if (!ft.enabled) return false;
            if (ft.target.startsWith('fixture:')) return ft.target.slice(8) === fixture.id;
            if (ft.target.startsWith('tier:')) return ft.target.slice(5) === fixture.tier;
            return true;
          });
          setFtMenu({ x: e.clientX, y: e.clientY, trackIdx: tIdx >= 0 ? tIdx : 0, timeAtX });
          return;
        }
      }

      const eTracks = efxTracks || [];
      const cTracks = colorTracks || [];
      const waveformOffset = energyCurve ? WAVEFORM_HEIGHT : 0;
      const autoScriptStart = HEADER_HEIGHT + fixtureAreaHeight + waveformOffset;
      const efxTracksStart = autoScriptStart + AUTOSCRIPT_TRACK_HEIGHT;

      // AutoScript track right-click: insert section at clicked position
      if (y >= autoScriptStart && y < efxTracksStart) {
        if (onAutoScriptContextMenu) {
          e.preventDefault();
          onAutoScriptContextMenu(
            snapT(Math.max(0, Math.min(duration, timeAtX))),
            e.clientX,
            e.clientY,
          );
        }
        return;
      }

      if (y >= efxTracksStart) {
        const eTrackIdx = Math.floor((y - efxTracksStart) / EFX_TRACK_HEIGHT);
        if (eTrackIdx >= 0 && eTrackIdx < eTracks.length) {
          e.preventDefault();
          const timeAtX = (x / drawW) * duration;
          const eTrack = eTracks[eTrackIdx];
          // Check if we're clicking on an existing entry
          const entry = findEfxEntryAt(eTrack, timeAtX, duration);
          if (entry && onEfxEntryContextMenu) {
            onEfxEntryContextMenu(eTrack.id, entry, e.clientX, e.clientY);
          } else {
            onEfxTrackContextMenu?.(
              eTrack.id,
              snapT(Math.max(0, Math.min(duration, timeAtX))),
              e.clientX,
              e.clientY,
            );
          }
          return;
        }
        // Check color tracks (below EFX tracks)
        const colorTrackBaseY = efxTracksStart + eTracks.length * EFX_TRACK_HEIGHT;
        if (y >= colorTrackBaseY && cTracks.length > 0) {
          const cTrackIdx = Math.floor((y - colorTrackBaseY) / COLOR_TRACK_HEIGHT);
          if (cTrackIdx >= 0 && cTrackIdx < cTracks.length) {
            e.preventDefault();
            const timeAtXc = (x / drawW) * duration;
            const cTrack = cTracks[cTrackIdx];
            const entry = findColorEntryAt(cTrack, timeAtXc, duration);
            if (entry && onColorEntryContextMenu) {
              onColorEntryContextMenu(cTrack.id, entry, e.clientX, e.clientY);
            } else {
              onColorTrackContextMenu?.(
                cTrack.id,
                snapT(Math.max(0, Math.min(duration, timeAtXc))),
                e.clientX,
                e.clientY,
              );
            }
          }
        }
        // Check strobe tracks (below color tracks)
        const strobeTrackBaseY = colorTrackBaseY + cTracks.length * COLOR_TRACK_HEIGHT;
        const sTracks = strobeTracks || [];
        if (y >= strobeTrackBaseY && sTracks.length > 0) {
          const sTrackIdx = Math.floor((y - strobeTrackBaseY) / STROBE_TRACK_HEIGHT);
          if (sTrackIdx >= 0 && sTrackIdx < sTracks.length) {
            e.preventDefault();
            const timeAtX2 = (x / drawW) * duration;
            const sTrack = sTracks[sTrackIdx];
            const sEntry = findStrobeEntryAt(sTrack, timeAtX2, duration);
            if (sEntry && onStrobeEntryContextMenu) {
              onStrobeEntryContextMenu(sTrack.id, sEntry, e.clientX, e.clientY);
            } else {
              onStrobeTrackContextMenu?.(sTrack.id, snapT(Math.max(0, Math.min(duration, timeAtX2))), e.clientX, e.clientY);
            }
          }
        }
        // Check dimmer tracks (below strobe tracks)
        const dimmerTrackBaseY = strobeTrackBaseY + sTracks.length * STROBE_TRACK_HEIGHT;
        const dTracks = dimmerTracks || [];
        if (y >= dimmerTrackBaseY && dTracks.length > 0) {
          const dTrackIdx = Math.floor((y - dimmerTrackBaseY) / DIMMER_TRACK_HEIGHT);
          if (dTrackIdx >= 0 && dTrackIdx < dTracks.length) {
            e.preventDefault();
            const timeAtX3 = (x / drawW) * duration;
            const dTrack = dTracks[dTrackIdx];
            const dEntry = findDimmerEntryAt(dTrack, timeAtX3, duration);
            if (dEntry && onDimmerEntryContextMenu) {
              onDimmerEntryContextMenu(dTrack.id, dEntry, e.clientX, e.clientY);
            } else {
              onDimmerTrackContextMenu?.(dTrack.id, snapT(Math.max(0, Math.min(duration, timeAtX3))), e.clientX, e.clientY);
            }
          }
        }
        // Check chaser tracks (below dimmer tracks)
        const chaserTrackBaseY = dimmerTrackBaseY + dTracks.length * DIMMER_TRACK_HEIGHT;
        const chTracks = chaserTracks || [];
        if (y >= chaserTrackBaseY && chTracks.length > 0) {
          const cTrackIdx = Math.floor((y - chaserTrackBaseY) / CHASER_TRACK_HEIGHT);
          if (cTrackIdx >= 0 && cTrackIdx < chTracks.length) {
            e.preventDefault();
            const timeAtX4 = (x / drawW) * duration;
            const cTrack = chTracks[cTrackIdx];
            const cEntry = findChaserEntryAt(cTrack, timeAtX4, duration);
            if (cEntry && onChaserEntryContextMenu) {
              onChaserEntryContextMenu(cTrack.id, cEntry, e.clientX, e.clientY);
            } else {
              onChaserTrackContextMenu?.(cTrack.id, snapT(Math.max(0, Math.min(duration, timeAtX4))), e.clientX, e.clientY);
            }
            return;
          }
        }
        // Check show tracks (below chaser)
        const showTrackBaseY = chaserTrackBaseY + chTracks.length * CHASER_TRACK_HEIGHT;
        const shTracks = showTracks || [];
        if (y >= showTrackBaseY && shTracks.length > 0) {
          const sIdx = Math.floor((y - showTrackBaseY) / SHOW_TRACK_HEIGHT);
          if (sIdx >= 0 && sIdx < shTracks.length) {
            e.preventDefault();
            const timeAtX5 = (x / drawW) * duration;
            const sTrack = shTracks[sIdx];
            const sEntry = findShowEntryAt(sTrack, timeAtX5, duration);
            if (sEntry && onShowEntryContextMenu) {
              onShowEntryContextMenu(sTrack.id, sEntry, e.clientX, e.clientY);
            } else {
              onShowTrackContextMenu?.(sTrack.id, snapT(Math.max(0, Math.min(duration, timeAtX5))), e.clientX, e.clientY);
            }
            return;
          }
        }
        // Check scene tracks (below show)
        const sceneTrackBaseY = showTrackBaseY + shTracks.length * SHOW_TRACK_HEIGHT;
        const scTracks = sceneTracks || [];
        if (y >= sceneTrackBaseY && scTracks.length > 0) {
          const scIdx = Math.floor((y - sceneTrackBaseY) / SCENE_TRACK_HEIGHT);
          if (scIdx >= 0 && scIdx < scTracks.length) {
            e.preventDefault();
            const timeAtX6 = (x / drawW) * duration;
            const scTrack = scTracks[scIdx];
            const scEntry = findSceneEntryAt(scTrack, timeAtX6, duration);
            if (scEntry && onSceneEntryContextMenu) {
              onSceneEntryContextMenu(scTrack.id, scEntry, e.clientX, e.clientY);
            } else {
              onSceneTrackContextMenu?.(scTrack.id, snapT(Math.max(0, Math.min(duration, timeAtX6))), e.clientX, e.clientY);
            }
            return;
          }
        }
        // Check matrix tracks (below scene)
        const matrixTrackBaseY = sceneTrackBaseY + scTracks.length * SCENE_TRACK_HEIGHT;
        const mTracks = matrixTracks || [];
        if (y >= matrixTrackBaseY && mTracks.length > 0) {
          const mIdx = Math.floor((y - matrixTrackBaseY) / MATRIX_TRACK_HEIGHT);
          if (mIdx >= 0 && mIdx < mTracks.length) {
            e.preventDefault();
            const timeAtX7 = (x / drawW) * duration;
            const mTrack = mTracks[mIdx];
            const mEntry = findMatrixEntryAt(mTrack, timeAtX7, duration);
            if (mEntry && onMatrixEntryContextMenu) {
              onMatrixEntryContextMenu(mTrack.id, mEntry, e.clientX, e.clientY);
            } else {
              onMatrixTrackContextMenu?.(mTrack.id, snapT(Math.max(0, Math.min(duration, timeAtX7))), e.clientX, e.clientY);
            }
            return;
          }
        }
      }
    },
    [duration, efxTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks, matrixTracks, tieredLayout, energyCurve, onAutoScriptContextMenu, onEfxTrackContextMenu, onEfxEntryContextMenu, onColorTrackContextMenu, onColorEntryContextMenu, onStrobeTrackContextMenu, onStrobeEntryContextMenu, onDimmerTrackContextMenu, onDimmerEntryContextMenu, onChaserTrackContextMenu, onChaserEntryContextMenu, onShowTrackContextMenu, onShowEntryContextMenu, onSceneTrackContextMenu, onSceneEntryContextMenu, onMatrixTrackContextMenu, onMatrixEntryContextMenu],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    sectionResizeRef.current = null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Fixture track selection: Ctrl+Drag (left button) on fixture rows
    if ((e.ctrlKey || e.metaKey) && e.button === 0 && onFixtureTracksChange) {
      const c = containerRef.current; if (!c) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const y = e.clientY - rect.top + c.scrollTop;
      if (y < HEADER_HEIGHT) return;
      const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
      if (drawW <= 0) return;
      const trackIdx = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);
      if (trackIdx >= 0 && trackIdx < tieredLayout.list.length && tieredLayout.list[trackIdx].type === 'fixture') {
        const fixture = tieredLayout.sorted[(tieredLayout.list[trackIdx] as any).fi];
        const fiIdx = (tieredLayout.list[trackIdx] as any).fi;
        const timeAtX = Math.max(0, x) / drawW * duration;
        const t = Math.max(0, Math.min(duration, timeAtX));
        isFtDragging.current = true;
        ftDragStart.current = t;
        ftDragFixture.current = fiIdx;
        ftSelRef.current = { start: t, end: t, fixture: fiIdx, track: null };
        setFtSelStart(t); setFtSelEnd(t);
        setFtSelFixture(fiIdx);
        const existingFt = (fixtureTracks || []).find(ft => resolveTrackTargets(ft, patchedFixtures, []).includes(fixture.id));
        setFtSelTrack(existingFt || null);
        ftSelRef.current.track = existingFt || null;
        e.preventDefault(); e.stopPropagation();
        return;
      }
    }

    // ── Block drag start ──
    if (fixtureTracks && onFixtureTracksChange && e.button === 0) {
      var cb2 = containerRef.current;
      if (cb2) {
        var rb2 = cb2.getBoundingClientRect();
        var xb2 = e.clientX - rb2.left - LABEL_WIDTH;
        var yb2 = e.clientY - rb2.top + cb2.scrollTop;
        var dwb2 = (rb2.width - LABEL_WIDTH) * zoomLevel;
        if (yb2 >= HEADER_HEIGHT && xb2 >= 0 && dwb2 > 0) {
          var tb2 = Math.floor((yb2 - HEADER_HEIGHT) / TRACK_HEIGHT);
          if (tb2 >= 0 && tb2 < tieredLayout.list.length && tieredLayout.list[tb2].type === 'fixture') {
            var fixb2 = tieredLayout.sorted[(tieredLayout.list[tb2] as any).fi];
            var timeAtXb2 = (xb2 / dwb2) * duration;
            for (var fti2 = 0; fti2 < fixtureTracks.length; fti2++) {
              var ft2 = fixtureTracks[fti2];
              if (!ft2.enabled) continue;
              var tf2 = false;
              if (ft2.target.startsWith('fixture:')) tf2 = ft2.target.slice(8) === fixb2.id;
              else if (ft2.target.startsWith('tier:')) tf2 = ft2.target.slice(5) === fixb2.tier;
              else tf2 = true;
              if (!tf2) continue;
              var blocks = [];
              for (var ci = 0; ci < ft2.colorBlocks.length; ci++) { var b = ft2.colorBlocks[ci]; blocks.push({ id: b.id, time: b.time, endTime: b.endTime, _t: 'color' }); }
              for (var di = 0; di < ft2.dimmerBlocks.length; di++) { var d = ft2.dimmerBlocks[di]; blocks.push({ id: d.id, time: d.time, endTime: d.endTime, _t: 'dimmer' }); }
              for (var si = 0; si < ft2.strobeBlocks.length; si++) { var s = ft2.strobeBlocks[si]; blocks.push({ id: s.id, time: s.time, endTime: s.endTime, _t: 'strobe' }); }
              for (var mi = 0; mi < ft2.movementBlocks.length; mi++) { var m = ft2.movementBlocks[mi]; blocks.push({ id: m.id, time: m.time, endTime: m.endTime, _t: 'movement' }); }
              for (var bi = 0; bi < blocks.length; bi++) {
                var bl = blocks[bi];
                if (timeAtXb2 >= bl.time && timeAtXb2 <= bl.endTime) {
                  pendingBlockDrag.current = { trackIdx: fti2, blockId: bl.id, blockType: bl._t, startTime: bl.time, initialX: e.clientX, blockDur: bl.endTime - bl.time };
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
              }
            }
          }
        }
      }
    }

        // -- EFX entry drag detection (before section resize) --
    {
      const c2 = containerRef.current;
      if (c2 && onEfxEntryChange) {
        const rect2 = c2.getBoundingClientRect();
        const x2 = e.clientX - rect2.left - LABEL_WIDTH;
        const y2 = e.clientY - rect2.top;
        const drawW2 = rect2.width - LABEL_WIDTH;
        const eTracks = efxTracks || [];
        if (eTracks.length > 0 && drawW2 > 0 && x2 >= 0 && y2 >= HEADER_HEIGHT) {
          const efxTracksStartY = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          if (y2 >= efxTracksStartY) {
            const eIdx = Math.floor((y2 - efxTracksStartY) / EFX_TRACK_HEIGHT);
            if (eIdx >= 0 && eIdx < eTracks.length) {
              const eTrack = eTracks[eIdx];
              for (let ei = 0; ei < eTrack.entries.length; ei++) {
                const entry = eTrack.entries[ei];
                const ex1 = (entry.time / duration) * drawW2;
                const ex2 = (entry.endTime / duration) * drawW2;
                const EDGE = 5;
                if (Math.abs(x2 - ex1) < EDGE) {
                  efxDragRef.current = { trackId: eTrack.id, entryIndex: ei, mode: 'resize-left', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x2 - ex2) < EDGE) {
                  efxDragRef.current = { trackId: eTrack.id, entryIndex: ei, mode: 'resize-right', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x2 > ex1 + EDGE && x2 < ex2 - EDGE) {
                  efxDragRef.current = { trackId: eTrack.id, entryIndex: ei, mode: 'move', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    // -- Color entry drag detection (parallel to EFX) --
    {
      const c3 = containerRef.current;
      if (c3 && onColorEntryChange) {
        const rect3 = c3.getBoundingClientRect();
        const x3 = e.clientX - rect3.left - LABEL_WIDTH;
        const y3 = e.clientY - rect3.top;
        const drawW3 = rect3.width - LABEL_WIDTH;
        const eT = efxTracks || [];
        const cT = colorTracks || [];
        if (cT.length > 0 && drawW3 > 0 && x3 >= 0 && y3 >= HEADER_HEIGHT) {
          const efxBase = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          const colorBase = efxBase + eT.length * EFX_TRACK_HEIGHT;
          if (y3 >= colorBase) {
            const cIdx = Math.floor((y3 - colorBase) / COLOR_TRACK_HEIGHT);
            if (cIdx >= 0 && cIdx < cT.length) {
              const cTrack = cT[cIdx];
              for (let ei = 0; ei < cTrack.entries.length; ei++) {
                const entry = cTrack.entries[ei];
                const ex1 = (entry.time / duration) * drawW3;
                const ex2 = (entry.endTime / duration) * drawW3;
                const EDGE = 5;
                if (Math.abs(x3 - ex1) < EDGE) {
                  colorDragRef.current = { trackId: cTrack.id, entryIndex: ei, mode: 'resize-left', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x3 - ex2) < EDGE) {
                  colorDragRef.current = { trackId: cTrack.id, entryIndex: ei, mode: 'resize-right', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x3 > ex1 + EDGE && x3 < ex2 - EDGE) {
                  colorDragRef.current = { trackId: cTrack.id, entryIndex: ei, mode: 'move', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    // -- Strobe entry drag detection (parallel to EFX) --
    {
      const c4 = containerRef.current;
      if (c4 && onStrobeEntryChange) {
        const rect4 = c4.getBoundingClientRect();
        const x4 = e.clientX - rect4.left - LABEL_WIDTH;
        const y4 = e.clientY - rect4.top;
        const drawW4 = rect4.width - LABEL_WIDTH;
        const eT = efxTracks || [];
        const sT = strobeTracks || [];
        if (sT.length > 0 && drawW4 > 0 && x4 >= 0 && y4 >= HEADER_HEIGHT) {
          const efxBase = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          const colorBase = efxBase + eT.length * EFX_TRACK_HEIGHT;
          const strobeBase = colorBase + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
          if (y4 >= strobeBase && y4 < strobeBase + sT.length * STROBE_TRACK_HEIGHT) {
            const sIdx = Math.floor((y4 - strobeBase) / STROBE_TRACK_HEIGHT);
            if (sIdx >= 0 && sIdx < sT.length) {
              const sTrack = sT[sIdx];
              for (let ei = 0; ei < sTrack.entries.length; ei++) {
                const entry = sTrack.entries[ei];
                const ex1 = (entry.time / duration) * drawW4;
                const ex2 = (entry.endTime / duration) * drawW4;
                const EDGE = 5;
                if (Math.abs(x4 - ex1) < EDGE) {
                  strobeDragRef.current = { trackId: sTrack.id, entryIndex: ei, mode: 'resize-left', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x4 - ex2) < EDGE) {
                  strobeDragRef.current = { trackId: sTrack.id, entryIndex: ei, mode: 'resize-right', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x4 > ex1 + EDGE && x4 < ex2 - EDGE) {
                  strobeDragRef.current = { trackId: sTrack.id, entryIndex: ei, mode: 'move', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    // -- Dimmer entry drag detection (parallel to EFX) --
    {
      const c5 = containerRef.current;
      if (c5 && onDimmerEntryChange) {
        const rect5 = c5.getBoundingClientRect();
        const x5 = e.clientX - rect5.left - LABEL_WIDTH;
        const y5 = e.clientY - rect5.top;
        const drawW5 = rect5.width - LABEL_WIDTH;
        const eT = efxTracks || [];
        const sT = strobeTracks || [];
        const dT = dimmerTracks || [];
        if (dT.length > 0 && drawW5 > 0 && x5 >= 0 && y5 >= HEADER_HEIGHT) {
          const efxBase = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          const colorBase = efxBase + (efxTracks?.length ?? 0) * EFX_TRACK_HEIGHT;
          const strobeBase = colorBase + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
          const dimmerBase = strobeBase + sT.length * STROBE_TRACK_HEIGHT;
          if (y5 >= dimmerBase && y5 < dimmerBase + dT.length * DIMMER_TRACK_HEIGHT) {
            const dIdx = Math.floor((y5 - dimmerBase) / DIMMER_TRACK_HEIGHT);
            if (dIdx >= 0 && dIdx < dT.length) {
              const dTrack = dT[dIdx];
              for (let ei = 0; ei < dTrack.entries.length; ei++) {
                const entry = dTrack.entries[ei];
                const ex1 = (entry.time / duration) * drawW5;
                const ex2 = (entry.endTime / duration) * drawW5;
                const EDGE = 5;
                if (Math.abs(x5 - ex1) < EDGE) {
                  dimmerDragRef.current = { trackId: dTrack.id, entryIndex: ei, mode: 'resize-left', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x5 - ex2) < EDGE) {
                  dimmerDragRef.current = { trackId: dTrack.id, entryIndex: ei, mode: 'resize-right', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x5 > ex1 + EDGE && x5 < ex2 - EDGE) {
                  dimmerDragRef.current = { trackId: dTrack.id, entryIndex: ei, mode: 'move', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    // -- Chaser entry drag detection (parallel to EFX) --
    {
      const c6 = containerRef.current;
      if (c6 && onChaserEntryChange) {
        const rect6 = c6.getBoundingClientRect();
        const x6 = e.clientX - rect6.left - LABEL_WIDTH;
        const y6 = e.clientY - rect6.top;
        const drawW6 = rect6.width - LABEL_WIDTH;
        const eT6 = efxTracks || [];
        const sT6 = strobeTracks || [];
        const dT6 = dimmerTracks || [];
        const cT6 = chaserTracks || [];
        if (cT6.length > 0 && drawW6 > 0 && x6 >= 0 && y6 >= HEADER_HEIGHT) {
          const efxBase6 = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          const colorBase6 = efxBase6 + eT6.length * EFX_TRACK_HEIGHT;
          const strobeBase6 = colorBase6 + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
          const dimmerBase6 = strobeBase6 + sT6.length * STROBE_TRACK_HEIGHT;
          const chaserBase6 = dimmerBase6 + dT6.length * DIMMER_TRACK_HEIGHT;
          if (y6 >= chaserBase6 && y6 < chaserBase6 + cT6.length * CHASER_TRACK_HEIGHT) {
            const cIdx6 = Math.floor((y6 - chaserBase6) / CHASER_TRACK_HEIGHT);
            if (cIdx6 >= 0 && cIdx6 < cT6.length) {
              const cTrack6 = cT6[cIdx6];
              for (let ei6 = 0; ei6 < cTrack6.entries.length; ei6++) {
                const entry6 = cTrack6.entries[ei6];
                const ex1 = (entry6.time / duration) * drawW6;
                const ex2 = (entry6.endTime / duration) * drawW6;
                const EDGE = 5;
                if (Math.abs(x6 - ex1) < EDGE) {
                  chaserDragRef.current = { trackId: cTrack6.id, entryIndex: ei6, mode: 'resize-left', startX: e.clientX, entryTime: entry6.time, entryEndTime: entry6.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x6 - ex2) < EDGE) {
                  chaserDragRef.current = { trackId: cTrack6.id, entryIndex: ei6, mode: 'resize-right', startX: e.clientX, entryTime: entry6.time, entryEndTime: entry6.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x6 > ex1 + EDGE && x6 < ex2 - EDGE) {
                  chaserDragRef.current = { trackId: cTrack6.id, entryIndex: ei6, mode: 'move', startX: e.clientX, entryTime: entry6.time, entryEndTime: entry6.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    // -- Show entry drag detection --
    {
      const c7 = containerRef.current;
      if (c7 && onShowEntryChange) {
        const rect7 = c7.getBoundingClientRect();
        const x7 = e.clientX - rect7.left - LABEL_WIDTH;
        const y7 = e.clientY - rect7.top;
        const drawW7 = rect7.width - LABEL_WIDTH;
        const eT7 = efxTracks || [];
        const sT7 = strobeTracks || [];
        const dT7 = dimmerTracks || [];
        const cT7 = chaserTracks || [];
        const shT = showTracks || [];
        if (shT.length > 0 && drawW7 > 0 && x7 >= 0 && y7 >= HEADER_HEIGHT) {
          const efxBase7 = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          const colorBase7 = efxBase7 + eT7.length * EFX_TRACK_HEIGHT;
          const strobeBase7 = colorBase7 + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
          const dimmerBase7 = strobeBase7 + sT7.length * STROBE_TRACK_HEIGHT;
          const chaserBase7 = dimmerBase7 + dT7.length * DIMMER_TRACK_HEIGHT;
          const showBase7 = chaserBase7 + cT7.length * CHASER_TRACK_HEIGHT;
          if (y7 >= showBase7 && y7 < showBase7 + shT.length * SHOW_TRACK_HEIGHT) {
            const sIdx = Math.floor((y7 - showBase7) / SHOW_TRACK_HEIGHT);
            if (sIdx >= 0 && sIdx < shT.length) {
              const sTrack = shT[sIdx];
              for (let ei = 0; ei < sTrack.entries.length; ei++) {
                const entry = sTrack.entries[ei];
                const ex1 = (entry.time / duration) * drawW7;
                const ex2 = (entry.endTime / duration) * drawW7;
                const EDGE = 5;
                if (Math.abs(x7 - ex1) < EDGE) {
                  showDragRef.current = { trackId: sTrack.id, entryIndex: ei, mode: 'resize-left', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x7 - ex2) < EDGE) {
                  showDragRef.current = { trackId: sTrack.id, entryIndex: ei, mode: 'resize-right', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x7 > ex1 + EDGE && x7 < ex2 - EDGE) {
                  showDragRef.current = { trackId: sTrack.id, entryIndex: ei, mode: 'move', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    // -- Scene entry drag detection (below show) --
    {
      const c8 = containerRef.current;
      if (c8 && onSceneEntryChange) {
        const rect8 = c8.getBoundingClientRect();
        const x8 = e.clientX - rect8.left - LABEL_WIDTH;
        const y8 = e.clientY - rect8.top;
        const drawW8 = rect8.width - LABEL_WIDTH;
        const eT8 = efxTracks || [];
        const sT8 = strobeTracks || [];
        const dT8 = dimmerTracks || [];
        const cT8 = chaserTracks || [];
        const shT8 = showTracks || [];
        const scT = sceneTracks || [];
        if (scT.length > 0 && drawW8 > 0 && x8 >= 0 && y8 >= HEADER_HEIGHT) {
          const efxBase8 = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          const colorBase8 = efxBase8 + eT8.length * EFX_TRACK_HEIGHT;
          const strobeBase8 = colorBase8 + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
          const dimmerBase8 = strobeBase8 + sT8.length * STROBE_TRACK_HEIGHT;
          const chaserBase8 = dimmerBase8 + dT8.length * DIMMER_TRACK_HEIGHT;
          const showBase8 = chaserBase8 + cT8.length * CHASER_TRACK_HEIGHT;
          const sceneBase8 = showBase8 + shT8.length * SHOW_TRACK_HEIGHT;
          if (y8 >= sceneBase8 && y8 < sceneBase8 + scT.length * SCENE_TRACK_HEIGHT) {
            const scIdx = Math.floor((y8 - sceneBase8) / SCENE_TRACK_HEIGHT);
            if (scIdx >= 0 && scIdx < scT.length) {
              const scTrack = scT[scIdx];
              for (let ei = 0; ei < scTrack.entries.length; ei++) {
                const entry = scTrack.entries[ei];
                const ex1 = (entry.time / duration) * drawW8;
                const ex2 = (entry.endTime / duration) * drawW8;
                const EDGE = 5;
                if (Math.abs(x8 - ex1) < EDGE) {
                  sceneDragRef.current = { trackId: scTrack.id, entryIndex: ei, mode: 'resize-left', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x8 - ex2) < EDGE) {
                  sceneDragRef.current = { trackId: scTrack.id, entryIndex: ei, mode: 'resize-right', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x8 > ex1 + EDGE && x8 < ex2 - EDGE) {
                  sceneDragRef.current = { trackId: scTrack.id, entryIndex: ei, mode: 'move', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    // -- Matrix entry drag detection (below scene) --
    {
      const c9 = containerRef.current;
      if (c9 && onMatrixEntryChange) {
        const rect9 = c9.getBoundingClientRect();
        const x9 = e.clientX - rect9.left - LABEL_WIDTH;
        const y9 = e.clientY - rect9.top;
        const drawW9 = rect9.width - LABEL_WIDTH;
        const eT9 = efxTracks || [];
        const sT9 = strobeTracks || [];
        const dT9 = dimmerTracks || [];
        const cT9 = chaserTracks || [];
        const shT9 = showTracks || [];
        const scT9 = sceneTracks || [];
        const mT9 = matrixTracks || [];
        if (mT9.length > 0 && drawW9 > 0 && x9 >= 0 && y9 >= HEADER_HEIGHT) {
          const efxBase9 = HEADER_HEIGHT + fixtureAreaHeight + (energyCurve ? WAVEFORM_HEIGHT : 0) + AUTOSCRIPT_TRACK_HEIGHT;
          const colorBase9 = efxBase9 + eT9.length * EFX_TRACK_HEIGHT;
          const strobeBase9 = colorBase9 + (colorTracks?.length ?? 0) * COLOR_TRACK_HEIGHT;
          const dimmerBase9 = strobeBase9 + sT9.length * STROBE_TRACK_HEIGHT;
          const chaserBase9 = dimmerBase9 + dT9.length * DIMMER_TRACK_HEIGHT;
          const showBase9 = chaserBase9 + cT9.length * CHASER_TRACK_HEIGHT;
          const sceneBase9 = showBase9 + shT9.length * SHOW_TRACK_HEIGHT;
          const matrixBase9 = sceneBase9 + scT9.length * SCENE_TRACK_HEIGHT;
          if (y9 >= matrixBase9 && y9 < matrixBase9 + mT9.length * MATRIX_TRACK_HEIGHT) {
            const mIdx = Math.floor((y9 - matrixBase9) / MATRIX_TRACK_HEIGHT);
            if (mIdx >= 0 && mIdx < mT9.length) {
              const mTrack = mT9[mIdx];
              for (let ei = 0; ei < mTrack.entries.length; ei++) {
                const entry = mTrack.entries[ei];
                const ex1 = (entry.time / duration) * drawW9;
                const ex2 = (entry.endTime / duration) * drawW9;
                const EDGE = 5;
                if (Math.abs(x9 - ex1) < EDGE) {
                  matrixDragRef.current = { trackId: mTrack.id, entryIndex: ei, mode: 'resize-left', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (Math.abs(x9 - ex2) < EDGE) {
                  matrixDragRef.current = { trackId: mTrack.id, entryIndex: ei, mode: 'resize-right', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
                if (x9 > ex1 + EDGE && x9 < ex2 - EDGE) {
                  matrixDragRef.current = { trackId: mTrack.id, entryIndex: ei, mode: 'move', startX: e.clientX, entryTime: entry.time, entryEndTime: entry.endTime };
                  e.preventDefault(); e.stopPropagation(); return;
                }
              }
            }
          }
        }
      }
    }

    if (!onSectionsChange) return;
    const c = containerRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL_WIDTH;
    const y = e.clientY - rect.top + c.scrollTop;
    if (x < 0 || y < HEADER_HEIGHT) return;

    const drawW = (rect.width - LABEL_WIDTH) * zoomLevel;
    if (drawW <= 0) return;

    // Check if click is near any section boundary (6px tolerance)
    const EDGE_TOLERANCE = 6;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const x1 = LABEL_WIDTH + (s.startTime / duration) * drawW;
      const x2 = LABEL_WIDTH + (s.endTime / duration) * drawW;
      const px = e.clientX - rect.left;

      if (Math.abs(px - x1) < EDGE_TOLERANCE && i > 0) {
        sectionResizeRef.current = { sectionIndex: i, edge: 'left', startX: e.clientX, startTime: s.startTime, otherEdgeTime: s.endTime };
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (Math.abs(px - x2) < EDGE_TOLERANCE && i < sections.length - 1) {
        sectionResizeRef.current = { sectionIndex: i, edge: 'right', startX: e.clientX, startTime: s.endTime, otherEdgeTime: s.startTime };
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  }, [sections, duration, onSectionsChange, efxTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks, matrixTracks, energyCurve, onEfxEntryChange, onColorEntryChange, onStrobeEntryChange, onDimmerEntryChange, onChaserEntryChange, onShowEntryChange, onSceneEntryChange, onMatrixEntryChange, fixtureAreaHeight]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Clear EFX drag
    if (efxDragRef.current) {
      efxDragRef.current = null;
      return;
    }

    // Color entry drag end
    if (colorDragRef.current) {
      colorDragRef.current = null;
      return;
    }

    // Strobe entry drag end
    if (strobeDragRef.current) {
      strobeDragRef.current = null;
      return;
    }

    // Dimmer entry drag end
    if (dimmerDragRef.current) {
      dimmerDragRef.current = null;
      return;
    }

    // Chaser entry drag end
    if (chaserDragRef.current) {
      chaserDragRef.current = null;
      return;
    }

    // Show entry drag end
    if (showDragRef.current) {
      showDragRef.current = null;
      return;
    }

    // Scene entry drag end
    if (sceneDragRef.current) {
      sceneDragRef.current = null;
      return;
    }

    // Matrix entry drag end
    if (matrixDragRef.current) {
      matrixDragRef.current = null;
      return;
    }

    // Fixture track drag end
    if (isFtDragging.current) {
      isFtDragging.current = false;
    blockDragRef.current = null;
    pendingBlockDrag.current = null;
      const start = ftDragStart.current;
      const end = ftSelRef.current.end;
      const diff = Math.abs(end - start);
      if (diff > 0.1) {
        // Already stored in handleMouseMove; commit to state
        setFtSelStart(Math.min(start, end));
        setFtSelEnd(Math.max(start, end));
        setFtSelFixture(ftDragFixture.current);
        setFtSelTrack(ftSelRef.current.track);
        return;
      }
      // Very small drag = clear
      setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null); setFtSelTrack(null);
      ftSelRef.current = { start: 0, end: 0, fixture: -1, track: null };
      return;
    }

    if (!sectionResizeRef.current) return;
    const resize = sectionResizeRef.current;
    sectionResizeRef.current = null;

    // Already applied via mousemove — just clean up
    // Re-sort sections by startTime to maintain order
    onSectionsChange?.([...sections].sort((a, b) => a.startTime - b.startTime));
  }, [sections, onSectionsChange]);

  // ── Track container width so the canvas redraws on resize ──
  const [containerWidth, setContainerWidth] = useState<number>(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const w = container.getBoundingClientRect().width;
      setContainerWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Canvas draw ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = totalHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const drawW = (w - LABEL_WIDTH) * zoomLevel;
    if (drawW <= 0) return;

    // ── Background ──────────────────────────────────
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // ── Section backgrounds ─────────────────────────
    for (const s of sections) {
      const x1 = LABEL_WIDTH + (s.startTime / duration) * drawW;
      const x2 = LABEL_WIDTH + (s.endTime / duration) * drawW;
      if (x2 < LABEL_WIDTH || x1 > w) continue;
      ctx.fillStyle = s.color + '26'; // ~15% opacity
      ctx.fillRect(
        Math.max(LABEL_WIDTH, x1),
        HEADER_HEIGHT,
        Math.min(w, x2) - Math.max(LABEL_WIDTH, x1),
        h - HEADER_HEIGHT,
      );
    }

    // ── Vertical grid (bars) ────────────────────────
    const bpmSafe = Math.max(40, Math.min(300, bpm || 120));
    const beatInterval = 60 / bpmSafe;
    const barInterval = beatInterval * 4;
    for (let t = 0; t <= duration; t += barInterval) {
      const x = LABEL_WIDTH + (t / duration) * drawW;
      if (x < LABEL_WIDTH || x > w) continue;
      // Bar line (thick, visible)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Subtle beat sub-lines
    for (let t = 0; t <= duration; t += beatInterval) {
      if (Math.abs((t / beatInterval) % 4) < 0.001) continue; // skip bars
      const x = LABEL_WIDTH + (t / duration) * drawW;
      if (x < LABEL_WIDTH || x > w) continue;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // ── Header row ──────────────────────────────────
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, w, HEADER_HEIGHT);
    ctx.strokeStyle = 'rgba(75, 85, 99, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT);
    ctx.lineTo(w, HEADER_HEIGHT);
    ctx.stroke();

    // Vertical separator between labels and tracks
    ctx.strokeStyle = 'rgba(75, 85, 99, 0.2)';
    ctx.beginPath();
    ctx.moveTo(LABEL_WIDTH, HEADER_HEIGHT);
    ctx.lineTo(LABEL_WIDTH, h);
    ctx.stroke();

    const headerText = `${cues.length} cues  ·  ${numFixtures} fixtures  ·  ${bpmSafe} BPM` +
      (numEfxTracks > 0 ? `  ·  ${numEfxTracks} EFX track${numEfxTracks !== 1 ? 's' : ''}` : '');

    ctx.fillStyle = '#6b7280';
    ctx.font = '10px -apple-system, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(headerText, 8, 12);

    // ── Time ruler (seconds) in header ─────────────
    const secondInterval = Math.max(1, Math.floor(duration / 20)); // adaptive: ~20 ticks max
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.font = '9px -apple-system, monospace';
    ctx.textAlign = 'center';
    for (let t = 0; t <= duration; t += secondInterval) {
      const x = LABEL_WIDTH + (t / duration) * drawW;
      if (x < LABEL_WIDTH + 15 || x > w - 5) continue;
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      const label = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
      ctx.fillText(label, x, HEADER_HEIGHT - 6);
      // Tick mark (pointing down from header)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(x - 0.5, HEADER_HEIGHT - 14, 1, 8);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    }

    // ── Per-fixture tracks (tiered: headers + sorted fixtures) ──
    const barW = Math.max(3, Math.min(10, drawW / Math.max(1, cues.length) * 0.6));

    for (let di = 0; di < tieredLayout.list.length; di++) {
      const row = tieredLayout.list[di];
      const trackY = HEADER_HEIGHT + di * TRACK_HEIGHT;

      // ── Tier header row ──
      if (row.type === 'header') {
        const isCollapsed = collapsedTiers.has(row.tier);
        const tierHue = TIER_HUE_DEG[row.tier] ?? 0;
        const hc = `hsl(${tierHue}, 60%, 45%)`;
        ctx.fillStyle = hc + '10';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, TRACK_HEIGHT);
        ctx.strokeStyle = hc + '30';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + TRACK_HEIGHT);
        ctx.lineTo(w, trackY + TRACK_HEIGHT);
        ctx.stroke();
        // Chevron
        ctx.fillStyle = hc;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(isCollapsed ? '▶' : '▼', 8, trackY + TRACK_HEIGHT / 2 + 4);
        // Tier name
        ctx.fillStyle = '#d1d5db';
        ctx.font = 'bold 10px -apple-system, sans-serif';
        ctx.fillText(row.tier.charAt(0).toUpperCase() + row.tier.slice(1), 24, trackY + TRACK_HEIGHT / 2 + 4);
        // Fixture count
        const count = tieredLayout.sorted.filter(f => f.tier === row.tier).length;
        ctx.fillStyle = '#6b7280';
        ctx.font = '8px -apple-system, sans-serif';
        ctx.fillText(`(${count})`, ctx.measureText(row.tier.charAt(0).toUpperCase() + row.tier.slice(1)).width + 28, trackY + TRACK_HEIGHT / 2 + 4);
        continue;
      }

      // ── Fixture row ──
      const fi = row.fi;
      const fixture = tieredLayout.sorted[fi];
      const tierDeg = TIER_HUE_DEG[fixture.tier] ?? 0;

      // Track background (alternating)
      ctx.fillStyle = di % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.1)';
      ctx.fillRect(LABEL_WIDTH, trackY, drawW, TRACK_HEIGHT);

      // Horizontal track separator
      ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, trackY + TRACK_HEIGHT);
      ctx.lineTo(w, trackY + TRACK_HEIGHT);
      ctx.stroke();

      // ── Enable/Disable checkbox (canvas-drawn, left of name) ──
      const cbSize = 14;
      const cbX = 4;
      const cbY = trackY + (TRACK_HEIGHT - cbSize) / 2;
      const isDisabled = disabledFixtures?.has(fixture.id) ?? false;
      // Box background
      ctx.fillStyle = isDisabled ? 'rgba(100,100,100,0.3)' : 'rgba(168,85,247,0.25)';
      ctx.fillRect(cbX, cbY, cbSize, cbSize);
      // Box border
      ctx.strokeStyle = isDisabled ? 'rgba(150,150,150,0.5)' : 'rgba(168,85,247,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cbX, cbY, cbSize, cbSize);
      // Checkmark if enabled
      if (!isDisabled) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cbX + 3, cbY + cbSize / 2);
        ctx.lineTo(cbX + 5.5, cbY + cbSize - 3.5);
        ctx.lineTo(cbX + cbSize - 3, cbY + 3.5);
        ctx.stroke();
      }

      // Fixture name label (right of checkbox)
      const nameX = cbX + cbSize + 6;
      ctx.fillStyle = isDisabled ? '#4b5563' : '#6b7280';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      const displayName =
        fixture.name.length > 10
          ? fixture.name.substring(0, 9) + '…'
          : fixture.name;
      ctx.fillText(displayName, nameX, trackY + TRACK_HEIGHT / 2 + 4);

      // Tier badge
      const tierColors: Record<string, string> = {
        primary: '#a855f7',
        secondary: '#3b82f6',
        tertiary: '#6b7280',
      };
      const tierColor = tierColors[fixture.tier] || '#6b7280';
      ctx.fillStyle = tierColor + '40';
      ctx.font = '8px -apple-system, sans-serif';
      ctx.fillText(fixture.tier.substring(0, 1).toUpperCase(), nameX + ctx.measureText(displayName).width + 4, trackY + TRACK_HEIGHT / 2 + 4);

      // ── Track graying overlay when disabled ──
      if (isDisabled && drawW > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, TRACK_HEIGHT);
      }

      // ── EFX overlay: show EFX entry blocks on targeted fixture tracks ──
      // (drawn BEFORE fixture track blocks so they appear underneath)
      if (numEfxTracks > 0 && drawW > 0) {
        for (let ei = 0; ei < numEfxTracks; ei++) {
          const eTrack = efxTracks![ei];
          const tf = eTrack.targetFixtures;
          // Check if this EFX track targets this fixture
          let targets = false;
          if (!tf || tf.type === 'all') {
            targets = true;
          } else if (tf.type === 'group') {
            const store = (window as any).__useShowStore?.getState?.();
            const groups = store?.fixtureGroups || [];
            targets = groups.find((g: any) => g.id === tf.groupId)?.fixtureIds.includes(fixture.id) ?? false;
          } else if (tf.type === 'fixture') {
            targets = tf.fixtureIds?.includes(fixture.id) ?? false;
          }
          if (!targets) continue;
          // Draw each entry as a subtle cyan bar on this fixture track
          for (const entry of eTrack.entries) {
            const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
            const ee = LABEL_WIDTH + (entry.endTime / duration) * drawW;
            if (ee < LABEL_WIDTH || ex > w) continue;
            const bw = Math.max(2, ee - ex);
            // Semi-transparent cyan fill with top accent line
            ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
            ctx.fillRect(Math.max(LABEL_WIDTH, ex), trackY + 1, bw, TRACK_HEIGHT - 2);
            ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
            ctx.fillRect(Math.max(LABEL_WIDTH, ex), trackY + 1, bw, 2);
          }
        }
      }

      // ── Fixture track override blocks ──
      if (fixtureTracks && fixtureTracks.length > 0) {
        // Find fixture track that targets this fixture
        const fixtureId = fixture.id;
        for (let fti = 0; fti < fixtureTracks.length; fti++) {
          const ft = fixtureTracks[fti];
          if (!ft.enabled) continue;
          // Check if this track targets this fixture
          let targetsFixture = false;
          if (ft.target.startsWith('fixture:')) {
            targetsFixture = ft.target.slice(8) === fixtureId;
          } else if (ft.target.startsWith('tier:')) {
            targetsFixture = ft.target.slice(5) === fixture.tier;
          } else if (ft.target.startsWith('group:')) {
            // Resolved at render time — skip for now, group resolution needs access to store
            // Show blocks on all fixtures as hint
            targetsFixture = true;
          }
          if (!targetsFixture) continue;

                    // Draw color blocks
          for (const cb of ft.colorBlocks) {
            const cx = LABEL_WIDTH + (cb.time / duration) * drawW;
            const ce = LABEL_WIDTH + (cb.endTime / duration) * drawW;
            if (ce < LABEL_WIDTH || cx > w) continue;
            const bw = Math.max(3, ce - cx);
            const c1 = hueShiftHex(cb.color, tierDeg);
            let c2 = c1;
            if (cb.endColor && cb.endColor !== cb.color) {
              c2 = hueShiftHex(cb.endColor, tierDeg);
              // Gradient block: draw a color gradient bar
              const grad = ctx.createLinearGradient(Math.max(LABEL_WIDTH, cx), trackY, Math.max(LABEL_WIDTH, cx) + bw, trackY);
              grad.addColorStop(0, c1);
              grad.addColorStop(1, c2);
              ctx.fillStyle = grad;
            } else {
              ctx.fillStyle = c1 + 'CC';
            }
            ctx.fillRect(Math.max(LABEL_WIDTH, cx), trackY + 1, bw, TRACK_HEIGHT - 2);
            if (bw > 20) {
              ctx.fillStyle = '#ffffff'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
              ctx.fillText(cb.endColor ? c1 + '→' + c2 : c1, cx + bw/2, trackY + TRACK_HEIGHT - 5);
            }
          }
// Draw dimmer blocks
          for (const db of ft.dimmerBlocks) {
            const cx = LABEL_WIDTH + (db.time / duration) * drawW;
            const ce = LABEL_WIDTH + (db.endTime / duration) * drawW;
            if (ce < LABEL_WIDTH || cx > w) continue;
            const bw = Math.max(2, ce - cx);
            const alpha = 0.2 + (db.value / 255) * 0.7;
            ctx.fillStyle = `rgba(6,182,212,${alpha})`;
            ctx.fillRect(Math.max(LABEL_WIDTH, cx), trackY + TRACK_HEIGHT - 5, bw, 3);
          }

          // Draw strobe blocks
          for (const sb of ft.strobeBlocks) {
            const cx = LABEL_WIDTH + (sb.time / duration) * drawW;
            const ce = LABEL_WIDTH + (sb.endTime / duration) * drawW;
            if (ce < LABEL_WIDTH || cx > w) continue;
            const bw = Math.max(2, ce - cx);
            ctx.fillStyle = 'rgba(251,191,36,0.6)';
            ctx.fillRect(Math.max(LABEL_WIDTH, cx), trackY + TRACK_HEIGHT - 5, bw, 3);
          }

          // Draw movement indicator
          for (const mb of ft.movementBlocks) {
            const cx = LABEL_WIDTH + (mb.time / duration) * drawW;
            const ce = LABEL_WIDTH + (mb.endTime / duration) * drawW;
            if (ce < LABEL_WIDTH || cx > w) continue;
            const bw = Math.max(3, ce - cx);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(Math.max(LABEL_WIDTH, cx), trackY + 3);
            ctx.lineTo(Math.max(LABEL_WIDTH, cx) + bw, trackY + 3);
            ctx.stroke();
            ctx.setLineDash([]);
            if (bw > 30) {
              ctx.fillStyle = '#22c55e'; ctx.font = '6px sans-serif'; ctx.textAlign = 'center';
              ctx.fillText(mb.pattern, cx + bw/2, trackY + TRACK_HEIGHT - 8);
            }
          }
        }
      }

      // ── Fixture track selection highlight ──
      if (ftSelStart !== null && ftSelEnd !== null && ftSelFixture === di) {
        const ss = Math.min(ftSelStart, ftSelEnd);
        const se = Math.max(ftSelStart, ftSelEnd);
        const sx = LABEL_WIDTH + (ss / duration) * drawW;
        const sex = LABEL_WIDTH + (se / duration) * drawW;
        ctx.fillStyle = 'rgba(168,85,247,0.2)';
        ctx.fillRect(sx, trackY, sex - sx, TRACK_HEIGHT);
        ctx.strokeStyle = 'rgba(168,85,247,0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx + 0.5, trackY + 0.5, sex - sx - 1, TRACK_HEIGHT - 1);
      }

      // Draw cue bars for this fixture
      const fixtureCues = getCuesForFixture(fixture.name);
      for (const cue of fixtureCues) {
        const cx = LABEL_WIDTH + (cue.time / duration) * drawW;
        if (cx < LABEL_WIDTH - 10 || cx > w + 10) continue;

        const iH = intensityToBarHeight(cue.intensity);
        const barY = trackY + (TRACK_HEIGHT - iH) / 2;
        const sc = hueShiftHex(cue.color, tierDeg);

        // Glow
        ctx.save();
        ctx.shadowColor = sc + '66';
        ctx.shadowBlur = 4;
        ctx.fillStyle = sc + 'CC';
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, barY, barW, iH, 2);
        ctx.fill();
        ctx.restore();

        // Core bar
        ctx.fillStyle = sc;
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, barY, barW, iH, 2);
        ctx.fill();

        // Top highlight
        const grad = ctx.createLinearGradient(cx, barY, cx, barY + iH);
        grad.addColorStop(0, 'rgba(255,255,255,0.35)');
        grad.addColorStop(0.5, sc);
        grad.addColorStop(1, sc + '80');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(
          cx - barW / 2,
          barY,
          barW,
          Math.min(iH * 0.5, 8),
          [2, 2, 0, 0],
        );
        ctx.fill();

        // Strobe indicator
        if (cue.strobe) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `${Math.max(7, iH * 0.5)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('\u26a1', cx, barY - 3);
        }

        // Color dots at bottom of taller bars
        if (cue.colors.length > 0 && iH >= 12) {
          const dotR = 1.5;
          const dotY = barY + iH - 4;
          const totalDotsW = cue.colors.length * (dotR * 2 + 2) - 2;
          let dotX = cx - totalDotsW / 2 + dotR;
          for (const cc of cue.colors) {
            const sc2 = hueShiftHex(cc, tierDeg);
            ctx.fillStyle = sc2;
            ctx.beginPath();
            ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 0.3;
            ctx.stroke();
            dotX += dotR * 2 + 2;
          }
        }
      }
    }

    // ── Mini-waveform with cue markers (above auto-script) ──
    if (energyCurve && energyCurve.length > 0) {
      const waveformY = HEADER_HEIGHT + tieredLayout.count * TRACK_HEIGHT;
      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(LABEL_WIDTH, waveformY, drawW, WAVEFORM_HEIGHT);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, waveformY + WAVEFORM_HEIGHT / 2);
      ctx.lineTo(w, waveformY + WAVEFORM_HEIGHT / 2);
      ctx.stroke();
      // Waveform envelope
      const curveLen = energyCurve.length;
      if (curveLen > 1) {
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < curveLen; i++) {
          const t = i / (curveLen - 1);
          const xPos = LABEL_WIDTH + t * drawW;
          const v = Math.max(0, Math.min(1, energyCurve[i]));
          const yPos = waveformY + WAVEFORM_HEIGHT - v * WAVEFORM_HEIGHT;
          if (i === 0) ctx.moveTo(xPos, yPos);
          else ctx.lineTo(xPos, yPos);
        }
        ctx.stroke();
        // Filled area
        ctx.lineTo(LABEL_WIDTH + drawW, waveformY + WAVEFORM_HEIGHT);
        ctx.lineTo(LABEL_WIDTH, waveformY + WAVEFORM_HEIGHT);
        ctx.closePath();
        const wfGrad = ctx.createLinearGradient(0, waveformY, 0, waveformY + WAVEFORM_HEIGHT);
        wfGrad.addColorStop(0, 'rgba(139, 92, 246, 0.25)');
        wfGrad.addColorStop(1, 'rgba(139, 92, 246, 0.02)');
        ctx.fillStyle = wfGrad;
        ctx.fill();
      }
      // Cue markers
      if (cueMarkers && cueMarkers.length > 0) {
        for (const marker of cueMarkers) {
          if (marker.time < 0 || marker.time > duration) continue;
          const mx = LABEL_WIDTH + (marker.time / duration) * drawW;
          const tier = marker.tier || '';
          const sec = marker.section || '';
          let mColor = '#8b5cf6';
          if (sec === 'drop') mColor = '#ef4444';
          else if (sec === 'chorus') mColor = '#f59e0b';
          else if (sec === 'build') mColor = '#22d3ee';
          else if (sec === 'intro' || sec === 'outro') mColor = '#a1a1aa';
          else if (sec === 'verse') mColor = '#22c55e';
          if (tier === 'secondary') mColor = '#3b82f6';
          else if (tier === 'tertiary') mColor = '#71717a';
          const mSize = tier === 'primary' ? 3 : 2;
          ctx.fillStyle = mColor;
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.arc(mx, waveformY + 4, mSize, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // ── AutoScript track ────────────────────────────
    const autoY = HEADER_HEIGHT + tieredLayout.count * TRACK_HEIGHT + (energyCurve ? WAVEFORM_HEIGHT : 0);

    // Track background
    ctx.fillStyle = 'rgba(139, 92, 246, 0.04)';
    ctx.fillRect(LABEL_WIDTH, autoY, drawW, AUTOSCRIPT_TRACK_HEIGHT);

    // Track label
    ctx.fillStyle = '#8b5cf6';
    ctx.font = '9px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('AutoScript', 6, autoY + 12);

    // Top separator
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_WIDTH, autoY);
    ctx.lineTo(w, autoY);
    ctx.stroke();

    // Dimmer curves (per-tier)
    const { dimmer, dimmerSecondary, dimmerTertiary, pan, tilt, strobes } = autoScriptData;
    if (dimmer.length > 0) {
      // Draw filled area (primary — purple)
      ctx.beginPath();
      const firstX = LABEL_WIDTH + (dimmer[0].t / duration) * drawW;
      ctx.moveTo(firstX, autoY + AUTOSCRIPT_TRACK_HEIGHT);
      for (const dp of dimmer) {
        const dx = LABEL_WIDTH + (dp.t / duration) * drawW;
        const dy = autoY + AUTOSCRIPT_TRACK_HEIGHT - dp.v * AUTOSCRIPT_TRACK_HEIGHT;
        ctx.lineTo(dx, dy);
      }
      const lastX =
        LABEL_WIDTH + (dimmer[dimmer.length - 1].t / duration) * drawW;
      ctx.lineTo(lastX, autoY + AUTOSCRIPT_TRACK_HEIGHT);
      ctx.closePath();

      const dimmerGrad = ctx.createLinearGradient(0, autoY, 0, autoY + AUTOSCRIPT_TRACK_HEIGHT);
      dimmerGrad.addColorStop(0, 'rgba(168, 85, 247, 0.5)');
      dimmerGrad.addColorStop(1, 'rgba(168, 85, 247, 0.05)');
      ctx.fillStyle = dimmerGrad;
      ctx.fill();

      // Primary line (purple)
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const firstDY = autoY + AUTOSCRIPT_TRACK_HEIGHT - dimmer[0].v * AUTOSCRIPT_TRACK_HEIGHT;
      ctx.moveTo(firstX, firstDY);
      for (let i = 1; i < dimmer.length; i++) {
        const dx = LABEL_WIDTH + (dimmer[i].t / duration) * drawW;
        const dy = autoY + AUTOSCRIPT_TRACK_HEIGHT - dimmer[i].v * AUTOSCRIPT_TRACK_HEIGHT;
        ctx.lineTo(dx, dy);
      }
      ctx.stroke();

      // Secondary line (blue)
      if (dimmerSecondary.length > 0) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        const sFirstY = autoY + AUTOSCRIPT_TRACK_HEIGHT - dimmerSecondary[0].v * AUTOSCRIPT_TRACK_HEIGHT;
        ctx.moveTo(firstX, sFirstY);
        for (let i = 1; i < dimmerSecondary.length; i++) {
          const dx = LABEL_WIDTH + (dimmerSecondary[i].t / duration) * drawW;
          const dy = autoY + AUTOSCRIPT_TRACK_HEIGHT - dimmerSecondary[i].v * AUTOSCRIPT_TRACK_HEIGHT;
          ctx.lineTo(dx, dy);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Tertiary line (grey)
      if (dimmerTertiary.length > 0) {
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        const tFirstY = autoY + AUTOSCRIPT_TRACK_HEIGHT - dimmerTertiary[0].v * AUTOSCRIPT_TRACK_HEIGHT;
        ctx.moveTo(firstX, tFirstY);
        for (let i = 1; i < dimmerTertiary.length; i++) {
          const dx = LABEL_WIDTH + (dimmerTertiary[i].t / duration) * drawW;
          const dy = autoY + AUTOSCRIPT_TRACK_HEIGHT - dimmerTertiary[i].v * AUTOSCRIPT_TRACK_HEIGHT;
          ctx.lineTo(dx, dy);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Tilt line (green)
    if (tilt.length > 0) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (let i = 0; i < tilt.length; i++) {
        const tx = LABEL_WIDTH + (tilt[i].t / duration) * drawW;
        const ty = autoY + AUTOSCRIPT_TRACK_HEIGHT - tilt[i].v * AUTOSCRIPT_TRACK_HEIGHT;
        if (i === 0) ctx.moveTo(tx, ty);
        else ctx.lineTo(tx, ty);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Strobe markers on AutoScript track
    for (const st of strobes) {
      const sx = LABEL_WIDTH + (st / duration) * drawW;
      if (sx < LABEL_WIDTH || sx > w) continue;
      ctx.fillStyle = 'rgba(250, 204, 21, 0.7)';
      ctx.fillRect(sx - 1, autoY + 2, 3, AUTOSCRIPT_TRACK_HEIGHT - 4);

      // Small label
      ctx.fillStyle = '#facc15';
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('\u26a1', sx, autoY + 10);
    }

    // ── Legend in AutoScript track ───────────────────
    ctx.font = '7px -apple-system, sans-serif';
    ctx.fillStyle = '#a855f7';
    ctx.textAlign = 'left';
    ctx.fillText('1P dim', w - 160, autoY + 10);
    ctx.fillStyle = '#3b82f6';
    ctx.fillText('2S dim', w - 114, autoY + 10);
    ctx.fillStyle = '#6b7280';
    ctx.fillText('3T dim', w - 72, autoY + 10);
    ctx.fillStyle = '#22c55e';
    ctx.fillText('\u2500 tilt', w - 44, autoY + 10);

    // ── EFX tracks ──────────────────────────────────
    if (numEfxTracks > 0) {
      for (let ei = 0; ei < numEfxTracks; ei++) {
        const eTrack = efxTracks![ei];
        const trackY = autoY + AUTOSCRIPT_TRACK_HEIGHT + ei * EFX_TRACK_HEIGHT;

        // Track background
        ctx.fillStyle = ei % 2 === 0 ? 'rgba(6, 182, 212, 0.04)' : 'rgba(6, 182, 212, 0.02)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, EFX_TRACK_HEIGHT);

        // Top separator
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY);
        ctx.lineTo(w, trackY);
        ctx.stroke();

        // Track label
        ctx.fillStyle = '#06b6d4';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const eLabel = eTrack.name.length > 11 ? eTrack.name.substring(0, 10) + '\u2026' : eTrack.name;
        ctx.fillText('EFX: ' + eLabel, 6, trackY + 12);

        // Target badge
        const tf = eTrack.targetFixtures;
        let targetLabel = '';
        if (tf?.type === 'group') {
          const store = (window as any).__useShowStore?.getState?.();
          const groups = store?.fixtureGroups || [];
          const g = groups.find((g: any) => g.id === tf.groupId);
          targetLabel = g ? '📁 ' + (g.name.length > 8 ? g.name.slice(0,7)+'…' : g.name) : '📁 ?';
        } else if (tf?.type === 'fixture') {
          targetLabel = '💡 ×1';
        } else {
          targetLabel = '🌐 all';
        }
        if (targetLabel) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '8px -apple-system, sans-serif';
          ctx.fillText(targetLabel, 72, trackY + 12);
        }

        // Bottom separator
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + EFX_TRACK_HEIGHT);
        ctx.lineTo(w, trackY + EFX_TRACK_HEIGHT);
        ctx.stroke();

        // Draw entries
        for (const entry of eTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;

          const pad = 4;
          const barY = trackY + pad;
          const barH = EFX_TRACK_HEIGHT - pad * 2;

          // Entry background bar
          ctx.fillStyle = '#06b6d4';
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.roundRect(ex, barY, entryW, barH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Left edge accent (pattern indicator)
          ctx.fillStyle = '#22d3ee';
          ctx.beginPath();
          ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]);
          ctx.fill();

          // Entry label (pattern + name if room)
          if (entryW > 40) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '7px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            const maxLabel = Math.floor(entryW / 6);
            let label = entry.pattern.substring(0, 3);
            if (maxLabel > 8) {
              const src = entry.label || entry.effectName;
              label = src.length > maxLabel - 4
                ? src.substring(0, maxLabel - 5) + '\u2026'
                : src;
            }
            ctx.fillText(label, ex + entryW / 2, trackY + EFX_TRACK_HEIGHT / 2 + 3);
          }

          // Start/end diamonds
          ctx.fillStyle = '#ffffff';
          const diamondSize = 3;
          ctx.beginPath();
          ctx.moveTo(ex, barY + barH / 2 - diamondSize);
          ctx.lineTo(ex + diamondSize, barY + barH / 2);
          ctx.lineTo(ex, barY + barH / 2 + diamondSize);
          ctx.lineTo(ex - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(endX, barY + barH / 2 - diamondSize);
          ctx.lineTo(endX + diamondSize, barY + barH / 2);
          ctx.lineTo(endX, barY + barH / 2 + diamondSize);
          ctx.lineTo(endX - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ── Color tracks ────────────────────────────────
    if (numColorTracks > 0) {
      const colorTrackBaseY = autoY + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;
      for (let ci = 0; ci < numColorTracks; ci++) {
        const cTrack = colorTracks![ci];
        const trackY = colorTrackBaseY + ci * COLOR_TRACK_HEIGHT;

        // Track background
        ctx.fillStyle = ci % 2 === 0 ? 'rgba(236, 72, 153, 0.04)' : 'rgba(236, 72, 153, 0.02)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, COLOR_TRACK_HEIGHT);

        // Top separator
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY);
        ctx.lineTo(w, trackY);
        ctx.stroke();

        // Track label
        ctx.fillStyle = '#ec4899';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const cLabel = cTrack.name.length > 11 ? cTrack.name.substring(0, 10) + '\u2026' : cTrack.name;
        ctx.fillText('CLR: ' + cLabel, 6, trackY + 12);

        // Target badge
        const tf = cTrack.targetFixtures;
        let targetLabel = '';
        if (tf?.type === 'group') {
          const store = (window as any).__useShowStore?.getState?.();
          const groups = store?.fixtureGroups || [];
          const g = groups.find((gg: any) => gg.id === tf.groupId);
          targetLabel = g ? '📁 ' + (g.name.length > 8 ? g.name.slice(0,7)+'…' : g.name) : '📁 ?';
        } else if (tf?.type === 'fixture') {
          targetLabel = '💡 ×1';
        } else {
          targetLabel = '🌐 all';
        }
        if (targetLabel) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '8px -apple-system, sans-serif';
          ctx.fillText(targetLabel, 72, trackY + 12);
        }

        // Bottom separator
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + COLOR_TRACK_HEIGHT);
        ctx.lineTo(w, trackY + COLOR_TRACK_HEIGHT);
        ctx.stroke();

        // Draw entries
        for (const entry of cTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;

          const pad = 3;
          const barY = trackY + pad;
          const barH = COLOR_TRACK_HEIGHT - pad * 2;

          const endColor = entry.endColor || entry.color;

          // Gradient bar from start color to end color
          if (entryW > 2) {
            const grad = ctx.createLinearGradient(ex, 0, endX, 0);
            grad.addColorStop(0, entry.color);
            grad.addColorStop(1, endColor);
            ctx.fillStyle = grad;
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.roundRect(ex, barY, entryW, barH, 3);
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          // Left edge accent
          ctx.fillStyle = entry.color;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Right edge accent
          ctx.fillStyle = endColor;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.roundRect(endX - 3, barY, 3, barH, [0, 3, 3, 0]);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Color hex label
          if (entryW > 50) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '7px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            const lbl = entry.label || (entry.color === endColor ? entry.color : entry.color + ' → ' + endColor);
            ctx.fillText(lbl, ex + entryW / 2, trackY + COLOR_TRACK_HEIGHT / 2 + 3);
          }

          // Start/end diamonds
          ctx.fillStyle = '#ffffff';
          const diamondSize = 3;
          ctx.beginPath();
          ctx.moveTo(ex, barY + barH / 2 - diamondSize);
          ctx.lineTo(ex + diamondSize, barY + barH / 2);
          ctx.lineTo(ex, barY + barH / 2 + diamondSize);
          ctx.lineTo(ex - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(endX, barY + barH / 2 - diamondSize);
          ctx.lineTo(endX + diamondSize, barY + barH / 2);
          ctx.lineTo(endX, barY + barH / 2 + diamondSize);
          ctx.lineTo(endX - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ── Strobe tracks ───────────────────────────────
    if (numStrobeTracks > 0) {
      const eT = efxTracks || [];
      const cT = colorTracks || [];
      const efxBase = autoY + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;
      const colorBase = efxBase + cT.length * COLOR_TRACK_HEIGHT;
      const strobeTrackBaseY = colorBase;
      for (let si = 0; si < numStrobeTracks; si++) {
        const sTrack = strobeTracks![si];
        const trackY = strobeTrackBaseY + si * STROBE_TRACK_HEIGHT;

        // Track background
        ctx.fillStyle = si % 2 === 0 ? 'rgba(168, 85, 247, 0.04)' : 'rgba(168, 85, 247, 0.02)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, STROBE_TRACK_HEIGHT);

        // Top separator
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY);
        ctx.lineTo(w, trackY);
        ctx.stroke();

        // Track label
        ctx.fillStyle = '#a855f7';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const sLabel = sTrack.name.length > 11 ? sTrack.name.substring(0, 10) + '\u2026' : sTrack.name;
        ctx.fillText('STR: ' + sLabel, 6, trackY + 12);

        // Target badge
        const tf = sTrack.targetFixtures;
        let targetLabel = '';
        if (tf?.type === 'group') {
          const store = (window as any).__useShowStore?.getState?.();
          const groups = store?.fixtureGroups || [];
          const g = groups.find((gg: any) => gg.id === tf.groupId);
          targetLabel = g ? '📁 ' + (g.name.length > 8 ? g.name.slice(0,7)+'…' : g.name) : '📁 ?';
        } else if (tf?.type === 'fixture') {
          targetLabel = '💡 ×1';
        } else {
          targetLabel = '🌐 all';
        }
        if (targetLabel) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '8px -apple-system, sans-serif';
          ctx.fillText(targetLabel, 72, trackY + 12);
        }

        // Bottom separator
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + STROBE_TRACK_HEIGHT);
        ctx.lineTo(w, trackY + STROBE_TRACK_HEIGHT);
        ctx.stroke();

        // Draw entries (strobe blocks)
        for (const entry of sTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;

          const pad = 3;
          const barY = trackY + pad;
          const barH = STROBE_TRACK_HEIGHT - pad * 2;

          // Purple bar with opacity based on speed
          const speedAlpha = Math.min(1, 0.3 + (entry.speed / 25) * 0.7);
          ctx.fillStyle = '#a855f7';
          ctx.globalAlpha = speedAlpha;
          ctx.beginPath();
          ctx.roundRect(ex, barY, entryW, barH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Edge accents
          ctx.fillStyle = '#c084fc';
          ctx.beginPath();
          ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(endX - 3, barY, 3, barH, [0, 3, 3, 0]);
          ctx.fill();

          // Speed label
          if (entryW > 40) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(entry.label || (entry.speed + ' Hz'), ex + entryW / 2, trackY + STROBE_TRACK_HEIGHT / 2 + 3);
          }

          // Start/end diamonds
          ctx.fillStyle = '#c084fc';
          const diamondSize = 3;
          ctx.beginPath();
          ctx.moveTo(ex, barY + barH / 2 - diamondSize);
          ctx.lineTo(ex + diamondSize, barY + barH / 2);
          ctx.lineTo(ex, barY + barH / 2 + diamondSize);
          ctx.lineTo(ex - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(endX, barY + barH / 2 - diamondSize);
          ctx.lineTo(endX + diamondSize, barY + barH / 2);
          ctx.lineTo(endX, barY + barH / 2 + diamondSize);
          ctx.lineTo(endX - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ── Dimmer tracks ───────────────────────────────
    if (numDimmerTracks > 0) {
      const eT = efxTracks || [];
      const cT = colorTracks || [];
      const sT = strobeTracks || [];
      const efxBase = autoY + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;
      const colorBase = efxBase + cT.length * COLOR_TRACK_HEIGHT;
      const strobeBase = colorBase + sT.length * STROBE_TRACK_HEIGHT;
      const dimmerTrackBaseY = strobeBase;
      for (let di = 0; di < numDimmerTracks; di++) {
        const dTrack = dimmerTracks![di];
        const trackY = dimmerTrackBaseY + di * DIMMER_TRACK_HEIGHT;

        // Track background
        ctx.fillStyle = di % 2 === 0 ? 'rgba(249, 115, 22, 0.04)' : 'rgba(249, 115, 22, 0.02)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, DIMMER_TRACK_HEIGHT);

        // Top separator
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY);
        ctx.lineTo(w, trackY);
        ctx.stroke();

        // Track label
        ctx.fillStyle = '#f97316';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const dLabel = dTrack.name.length > 11 ? dTrack.name.substring(0, 10) + '\u2026' : dTrack.name;
        ctx.fillText('DIM: ' + dLabel, 6, trackY + 12);

        // Target badge
        const tf = dTrack.targetFixtures;
        let targetLabel = '';
        if (tf?.type === 'group') {
          const store = (window as any).__useShowStore?.getState?.();
          const groups = store?.fixtureGroups || [];
          const g = groups.find((gg: any) => gg.id === tf.groupId);
          targetLabel = g ? '📁 ' + (g.name.length > 8 ? g.name.slice(0,7)+'…' : g.name) : '📁 ?';
        } else if (tf?.type === 'fixture') {
          targetLabel = '💡 ×1';
        } else {
          targetLabel = '🌐 all';
        }
        if (targetLabel) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '8px -apple-system, sans-serif';
          ctx.fillText(targetLabel, 72, trackY + 12);
        }

        // Bottom separator
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + DIMMER_TRACK_HEIGHT);
        ctx.lineTo(w, trackY + DIMMER_TRACK_HEIGHT);
        ctx.stroke();

        // Draw entries (dimmer blocks)
        for (const entry of dTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;

          const pad = 3;
          const barY = trackY + pad;
          const barH = DIMMER_TRACK_HEIGHT - pad * 2;

          // Orange bar with opacity based on value
          const valueAlpha = Math.min(1, 0.3 + (entry.value / 100) * 0.7);
          ctx.fillStyle = '#f97316';
          ctx.globalAlpha = valueAlpha;
          ctx.beginPath();
          ctx.roundRect(ex, barY, entryW, barH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Edge accents
          ctx.fillStyle = '#fb923c';
          ctx.beginPath();
          ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(endX - 3, barY, 3, barH, [0, 3, 3, 0]);
          ctx.fill();

          // Value label
          if (entryW > 40) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(entry.label || (entry.value + '%'), ex + entryW / 2, trackY + DIMMER_TRACK_HEIGHT / 2 + 3);
          }

          // Start/end diamonds
          ctx.fillStyle = '#fb923c';
          const diamondSize = 3;
          ctx.beginPath();
          ctx.moveTo(ex, barY + barH / 2 - diamondSize);
          ctx.lineTo(ex + diamondSize, barY + barH / 2);
          ctx.lineTo(ex, barY + barH / 2 + diamondSize);
          ctx.lineTo(ex - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(endX, barY + barH / 2 - diamondSize);
          ctx.lineTo(endX + diamondSize, barY + barH / 2);
          ctx.lineTo(endX, barY + barH / 2 + diamondSize);
          ctx.lineTo(endX - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ── Chaser tracks ────────────────────────────────
    if (numChaserTracks > 0) {
      const eT = efxTracks || [];
      const cT = colorTracks || [];
      const sT = strobeTracks || [];
      const dT = dimmerTracks || [];
      const efxBase = autoY + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;
      const colorBase = efxBase + cT.length * COLOR_TRACK_HEIGHT;
      const strobeBase = colorBase + sT.length * STROBE_TRACK_HEIGHT;
      const dimmerBase = strobeBase + dT.length * DIMMER_TRACK_HEIGHT;
      const chaserTrackBaseY = dimmerBase;
      for (let ci = 0; ci < numChaserTracks; ci++) {
        const cTrack = chaserTracks![ci];
        const trackY = chaserTrackBaseY + ci * CHASER_TRACK_HEIGHT;

        // Track background
        ctx.fillStyle = ci % 2 === 0 ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.02)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, CHASER_TRACK_HEIGHT);

        // Top separator
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY);
        ctx.lineTo(w, trackY);
        ctx.stroke();

        // Track label
        ctx.fillStyle = '#10b981';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const cLabel = cTrack.name.length > 11 ? cTrack.name.substring(0, 10) + '\u2026' : cTrack.name;
        ctx.fillText('CHS: ' + cLabel, 6, trackY + 12);

        // Chaser info badge (the chaser plays its own fixtures)
        const cEntry0 = cTrack.entries[0];
        let cTargetLabel = '';
        if (cEntry0) {
          cTargetLabel = '🎬 ' + (cEntry0.label || cEntry0.chaserName || '').slice(0, 10);
        } else {
          cTargetLabel = 'clic droit pour importer';
        }
        if (cTargetLabel) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '8px -apple-system, sans-serif';
          ctx.fillText(cTargetLabel, 72, trackY + 12);
        }

        // Bottom separator
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + CHASER_TRACK_HEIGHT);
        ctx.lineTo(w, trackY + CHASER_TRACK_HEIGHT);
        ctx.stroke();

        // Draw entries (chaser blocks)
        for (const entry of cTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;

          const pad = 3;
          const barY = trackY + pad;
          const barH = CHASER_TRACK_HEIGHT - pad * 2;

          // Green bar
          ctx.fillStyle = '#10b981';
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.roundRect(ex, barY, entryW, barH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Edge accents
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(endX - 3, barY, 3, barH, [0, 3, 3, 0]);
          ctx.fill();

          // Chaser name label
          if (entryW > 44) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            const nameLabel = (entry.label || entry.chaserName || 'chaser').length > 14 ? (entry.label || entry.chaserName || 'chaser').substring(0, 13) + '…' : (entry.label || entry.chaserName || 'chaser');
            ctx.fillText(nameLabel, ex + entryW / 2, trackY + CHASER_TRACK_HEIGHT / 2 + 3);
          }

          // Start/end diamonds
          ctx.fillStyle = '#34d399';
          const diamondSize = 3;
          ctx.beginPath();
          ctx.moveTo(ex, barY + barH / 2 - diamondSize);
          ctx.lineTo(ex + diamondSize, barY + barH / 2);
          ctx.lineTo(ex, barY + barH / 2 + diamondSize);
          ctx.lineTo(ex - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(endX, barY + barH / 2 - diamondSize);
          ctx.lineTo(endX + diamondSize, barY + barH / 2);
          ctx.lineTo(endX, barY + barH / 2 + diamondSize);
          ctx.lineTo(endX - diamondSize, barY + barH / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ── Show tracks — prennent le dessus sur l'autoscript ──
    if (numShowTracks > 0) {
      const eT = efxTracks || [];
      const cT = colorTracks || [];
      const sT = strobeTracks || [];
      const dT = dimmerTracks || [];
      const cChT = chaserTracks || [];
      const efxBase = autoY + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;
      const colorBase = efxBase + cT.length * COLOR_TRACK_HEIGHT;
      const strobeBase = colorBase + sT.length * STROBE_TRACK_HEIGHT;
      const dimmerBase = strobeBase + dT.length * DIMMER_TRACK_HEIGHT;
      const chaserBase = dimmerBase + cChT.length * CHASER_TRACK_HEIGHT;
      const showTrackBaseY = chaserBase;
      for (let si = 0; si < numShowTracks; si++) {
        const sTrack = showTracks![si];
        const trackY = showTrackBaseY + si * SHOW_TRACK_HEIGHT;
        ctx.fillStyle = si % 2 === 0 ? 'rgba(245, 158, 11, 0.07)' : 'rgba(245, 158, 11, 0.03)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, SHOW_TRACK_HEIGHT);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(LABEL_WIDTH, trackY); ctx.lineTo(w, trackY); ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const sLabel = sTrack.name.length > 11 ? sTrack.name.substring(0, 10) + '\u2026' : sTrack.name;
        ctx.fillText('SHOW: ' + sLabel, 6, trackY + 12);
        const sEntry0 = sTrack.entries[0];
        let sTargetLabel = sEntry0 ? ('🎬 ' + (sEntry0.label || sEntry0.showName || '').slice(0, 10)) : 'clic droit pour importer';
        if (sTargetLabel) { ctx.fillStyle = '#6b7280'; ctx.font = '8px -apple-system, sans-serif'; ctx.fillText(sTargetLabel, 72, trackY + 12); }
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(LABEL_WIDTH, trackY + SHOW_TRACK_HEIGHT); ctx.lineTo(w, trackY + SHOW_TRACK_HEIGHT); ctx.stroke();
        for (const entry of sTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;
          const pad = 3; const barY = trackY + pad; const barH = SHOW_TRACK_HEIGHT - pad * 2;
          ctx.fillStyle = '#f59e0b'; ctx.globalAlpha = 0.88; ctx.beginPath(); ctx.roundRect(ex, barY, entryW, barH, 3); ctx.fill(); ctx.globalAlpha = 1;
          ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]); ctx.fill(); ctx.beginPath(); ctx.roundRect(endX - 3, barY, 3, barH, [0, 3, 3, 0]); ctx.fill();
          if (entryW > 44) { ctx.fillStyle = '#ffffff'; ctx.font = 'bold 7px -apple-system, sans-serif'; ctx.textAlign = 'center'; const nameLabel = (entry.label || entry.showName || 'show').length > 14 ? (entry.label || entry.showName || 'show').substring(0, 13) + '…' : (entry.label || entry.showName || 'show'); ctx.fillText(nameLabel, ex + entryW / 2, trackY + SHOW_TRACK_HEIGHT / 2 + 3); }
          ctx.fillStyle = '#fbbf24'; const diamondSize = 3; ctx.beginPath(); ctx.moveTo(ex, barY + barH / 2 - diamondSize); ctx.lineTo(ex + diamondSize, barY + barH / 2); ctx.lineTo(ex, barY + barH / 2 + diamondSize); ctx.lineTo(ex - diamondSize, barY + barH / 2); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(endX, barY + barH / 2 - diamondSize); ctx.lineTo(endX + diamondSize, barY + barH / 2); ctx.lineTo(endX, barY + barH / 2 + diamondSize); ctx.lineTo(endX - diamondSize, barY + barH / 2); ctx.closePath(); ctx.fill();
        }
      }
    }

    // ── Scene tracks — scène directe, prend le dessus sur l'autoscript ──
    if (numSceneTracks > 0) {
      const eT = efxTracks || [];
      const cT = colorTracks || [];
      const sT = strobeTracks || [];
      const dT = dimmerTracks || [];
      const cChT = chaserTracks || [];
      const shT = showTracks || [];
      const efxBase = autoY + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;
      const colorBase = efxBase + cT.length * COLOR_TRACK_HEIGHT;
      const strobeBase = colorBase + sT.length * STROBE_TRACK_HEIGHT;
      const dimmerBase = strobeBase + dT.length * DIMMER_TRACK_HEIGHT;
      const chaserBase = dimmerBase + cChT.length * CHASER_TRACK_HEIGHT;
      const showTrackBaseY = chaserBase;
      const sceneTrackBaseY = showTrackBaseY + shT.length * SHOW_TRACK_HEIGHT;
      for (let ci = 0; ci < numSceneTracks; ci++) {
        const cTrack = sceneTracks![ci];
        const trackY = sceneTrackBaseY + ci * SCENE_TRACK_HEIGHT;
        ctx.fillStyle = ci % 2 === 0 ? 'rgba(168, 85, 247, 0.06)' : 'rgba(168, 85, 247, 0.03)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, SCENE_TRACK_HEIGHT);
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY);
        ctx.lineTo(w, trackY);
        ctx.stroke();
        ctx.fillStyle = '#a78bfa';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const cLabel = cTrack.name.length > 11 ? cTrack.name.substring(0, 10) + '…' : cTrack.name;
        ctx.fillText('SCN: ' + cLabel, 6, trackY + 12);
        const cEntry0 = cTrack.entries[0];
        let cTargetLabel = '';
        if (cEntry0) {
          cTargetLabel = '🎭 ' + (cEntry0.label || cEntry0.sceneName || '').slice(0, 10);
        } else {
          cTargetLabel = 'clic droit pour importer';
        }
        if (cTargetLabel) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '8px -apple-system, sans-serif';
          ctx.fillText(cTargetLabel, 72, trackY + 12);
        }
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + SCENE_TRACK_HEIGHT);
        ctx.lineTo(w, trackY + SCENE_TRACK_HEIGHT);
        ctx.stroke();
        for (const entry of cTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;
          const pad = 3;
          const barY = trackY + pad;
          const barH = SCENE_TRACK_HEIGHT - pad * 2;
          ctx.fillStyle = '#8b5cf6';
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.roundRect(ex, barY, entryW, barH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#c4b5fd';
          ctx.beginPath();
          ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(endX - 3, barY, 3, barH, [0, 3, 3, 0]);
          ctx.fill();
          if (entryW > 44) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            const nameLabel = (entry.label || entry.sceneName || 'scene').length > 14 ? (entry.label || entry.sceneName || 'scene').substring(0, 13) + '…' : (entry.label || entry.sceneName || 'scene');
            ctx.fillText(nameLabel, ex + entryW / 2, trackY + SCENE_TRACK_HEIGHT / 2 + 3);
          }
          ctx.fillStyle = '#c4b5fd'; const diamondSize = 3; ctx.beginPath(); ctx.moveTo(ex, barY + barH / 2 - diamondSize); ctx.lineTo(ex + diamondSize, barY + barH / 2); ctx.lineTo(ex, barY + barH / 2 + diamondSize); ctx.lineTo(ex - diamondSize, barY + barH / 2); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(endX, barY + barH / 2 - diamondSize); ctx.lineTo(endX + diamondSize, barY + barH / 2); ctx.lineTo(endX, barY + barH / 2 + diamondSize); ctx.lineTo(endX - diamondSize, barY + barH / 2); ctx.closePath(); ctx.fill();
        }
      }
    }

    // ── Matrix tracks — matrice RGB via le moteur global ──
    if (numMatrixTracks > 0) {
      const eT = efxTracks || [];
      const cT = colorTracks || [];
      const sT = strobeTracks || [];
      const dT = dimmerTracks || [];
      const cChT = chaserTracks || [];
      const shT = showTracks || [];
      const scT = sceneTracks || [];
      const efxBase = autoY + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;
      const colorBase = efxBase + cT.length * COLOR_TRACK_HEIGHT;
      const strobeBase = colorBase + sT.length * STROBE_TRACK_HEIGHT;
      const dimmerBase = strobeBase + dT.length * DIMMER_TRACK_HEIGHT;
      const chaserBase = dimmerBase + cChT.length * CHASER_TRACK_HEIGHT;
      const showTrackBaseY = chaserBase;
      const sceneTrackBaseY = showTrackBaseY + shT.length * SHOW_TRACK_HEIGHT;
      const matrixTrackBaseY = sceneTrackBaseY + scT.length * SCENE_TRACK_HEIGHT;
      for (let ci = 0; ci < numMatrixTracks; ci++) {
        const cTrack = matrixTracks![ci];
        const trackY = matrixTrackBaseY + ci * MATRIX_TRACK_HEIGHT;
        ctx.fillStyle = ci % 2 === 0 ? 'rgba(236, 72, 153, 0.06)' : 'rgba(236, 72, 153, 0.03)';
        ctx.fillRect(LABEL_WIDTH, trackY, drawW, MATRIX_TRACK_HEIGHT);
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY);
        ctx.lineTo(w, trackY);
        ctx.stroke();
        ctx.fillStyle = '#f472b6';
        ctx.font = '9px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        const cLabel = cTrack.name.length > 11 ? cTrack.name.substring(0, 10) + '…' : cTrack.name;
        ctx.fillText('MTX: ' + cLabel, 6, trackY + 12);
        const cEntry0 = cTrack.entries[0];
        let cTargetLabel = '';
        if (cEntry0) {
          cTargetLabel = '🔳 ' + (cEntry0.label || cEntry0.matrixName || '').slice(0, 10);
        } else {
          cTargetLabel = 'clic droit pour importer';
        }
        if (cTargetLabel) {
          ctx.fillStyle = '#6b7280';
          ctx.font = '8px -apple-system, sans-serif';
          ctx.fillText(cTargetLabel, 72, trackY + 12);
        }
        ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, trackY + MATRIX_TRACK_HEIGHT);
        ctx.lineTo(w, trackY + MATRIX_TRACK_HEIGHT);
        ctx.stroke();
        for (const entry of cTrack.entries) {
          const ex = LABEL_WIDTH + (entry.time / duration) * drawW;
          const endX = LABEL_WIDTH + (entry.endTime / duration) * drawW;
          const entryW = Math.max(4, endX - ex);
          if (ex < LABEL_WIDTH - 10 || ex > w + 10) continue;
          const pad = 3;
          const barY = trackY + pad;
          const barH = MATRIX_TRACK_HEIGHT - pad * 2;
          ctx.fillStyle = '#ec4899';
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.roundRect(ex, barY, entryW, barH, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#f9a8d4';
          ctx.beginPath();
          ctx.roundRect(ex, barY, 3, barH, [3, 0, 0, 3]);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(endX - 3, barY, 3, barH, [0, 3, 3, 0]);
          ctx.fill();
          if (entryW > 44) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            const nameLabel = (entry.label || entry.matrixName || 'matrix').length > 14 ? (entry.label || entry.matrixName || 'matrix').substring(0, 13) + '…' : (entry.label || entry.matrixName || 'matrix');
            ctx.fillText(nameLabel, ex + entryW / 2, trackY + MATRIX_TRACK_HEIGHT / 2 + 3);
          }
          ctx.fillStyle = '#f9a8d4'; const diamondSize = 3; ctx.beginPath(); ctx.moveTo(ex, barY + barH / 2 - diamondSize); ctx.lineTo(ex + diamondSize, barY + barH / 2); ctx.lineTo(ex, barY + barH / 2 + diamondSize); ctx.lineTo(ex - diamondSize, barY + barH / 2); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(endX, barY + barH / 2 - diamondSize); ctx.lineTo(endX + diamondSize, barY + barH / 2); ctx.lineTo(endX, barY + barH / 2 + diamondSize); ctx.lineTo(endX - diamondSize, barY + barH / 2); ctx.closePath(); ctx.fill();
        }
      }
    }

    // ── Section separators (vertical lines) ─────────
    // Une ligne verticale bien visible à chaque frontière de section, comme les
    // séparations de la piste audio. Halo sombre + trait coloré plein pour
    // ressortir sur les pistes d'entrées.
    for (const s of sections) {
      const x = LABEL_WIDTH + (s.startTime / duration) * drawW;
      if (x < LABEL_WIDTH + 1 || x > w) continue; // pas de ligne à t=0
      // Halo de contraste (sombre, large)
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, HEADER_HEIGHT);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();
      // Trait coloré plein, net
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, HEADER_HEIGHT);
      ctx.lineTo(Math.round(x) + 0.5, h);
      ctx.stroke();
    }

    // ── Playhead — un seul trait vertical blanc (1px, sans ombre ni doublon)
    if (currentTime >= 0 && currentTime <= duration) {
      const px = Math.round(LABEL_WIDTH + (currentTime / duration) * drawW) + 0.5;
      if (px >= LABEL_WIDTH && px <= w) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, HEADER_HEIGHT);
        ctx.lineTo(px, h);
        ctx.stroke();

        // Triangle at top
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(px, HEADER_HEIGHT);
        ctx.lineTo(px - 5, HEADER_HEIGHT - 6);
        ctx.lineTo(px + 5, HEADER_HEIGHT - 6);
        ctx.closePath();
        ctx.fill();

        // Time label
        ctx.fillStyle = '#ffffff';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fmt(currentTime), Math.round(px), h - 2);
      }
    }
  }, [
    cues,
    sections,
    duration,
    currentTime,
    patchedFixtures,
    tieredLayout,
    bpm,
    totalHeight,
    containerWidth,
    autoScriptData,
    getCuesForFixture,
    efxTracks,
    numEfxTracks,
    colorTracks,
    numColorTracks,
    strobeTracks,
    numStrobeTracks,
    dimmerTracks,
    numDimmerTracks,
    chaserTracks,
    numChaserTracks,
    sceneTracks,
    numSceneTracks,
    matrixTracks,
    numMatrixTracks,
    fixtureTracks,
    disabledFixtures,
    ftSelStart,
    ftSelEnd,
    ftSelFixture,
  ]);

  // (RAF playhead supprimé — doublon + ombre noire : le trait unique est dessiné dans le canvas principal)

  return (
    <div className="relative">
      {/* ── Fixture Enable/Disable Checkboxes ── */}
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-x-hidden overflow-y-auto border border-gray-800/50 cursor-pointer select-none relative"
        style={{ height: `${totalHeight}px`, maxHeight: '56vh', backgroundColor: '#0a0a0f' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>

      {/* ── Fixture Track Context Menu ── */}
      {ftMenu && ftSelRef.current.start < ftSelRef.current.end && onFixtureTracksChange && fixtureTracks && (
        <div
          className="fixed z-50 bg-[#1a1a2e] border border-purple-700/50 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ left: ftMenu.x, top: ftMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-purple-400 uppercase tracking-wider border-b border-gray-800">
            {fmt(ftSelRef.current.start)} → {fmt(ftSelRef.current.end)} · {tieredLayout.sorted[ftMenu.trackIdx]?.name}
          </div>
          {/* Color */}
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
            onClick={() => {
              setFtMenu(null);
              setGradientPicker({ sectionType: 'fixture', colorIdx: 0, startColor: '#ff0064', endColor: '#ff0064', constantColor: false, trackIdx: ftMenu.trackIdx });
            }}
          ><span className="text-[14px]">🎨</span> Color</button>
          {/* Dimmer */}
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
            onClick={() => {
              const popup = document.createElement('div');
              popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);min-width:280px';
              popup.innerHTML = '<div style="color:#06b6d4;font-size:13px;font-weight:600;margin-bottom:8px">Dimmer</div><div style="padding:8px 10px;background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.2);border-radius:8px;margin-bottom:12px"><p style="margin:0 0 4px 0;font-size:11px;color:#cbd5e1"><b style="color:#06b6d4">Départ</b> : intensité au début du bloc (0 = éteint, 255 = plein).</p><p style="margin:0;font-size:11px;color:#cbd5e1"><b style="color:#06b6d4">Arrivée</b> : intensité cible en fin de bloc. Différente = fondu progressif.</p></div><div style="display:flex;gap:16px;justify-content:center"><div style="text-align:center"><div style="color:#9ca3af;font-size:10px;margin-bottom:4px">Départ</div><div id="__dv1" style="color:#06b6d4;font-size:20px;font-weight:700;margin:4px 0">200</div><input id="__dr1" type="range" min="0" max="255" value="200" style="width:100%;accent-color:#06b6d4" /></div><div style="text-align:center"><div style="color:#9ca3af;font-size:10px;margin-bottom:4px">Arrivée</div><div id="__dv2" style="color:#06b6d4;font-size:20px;font-weight:700;margin:4px 0">200</div><input id="__dr2" type="range" min="0" max="255" value="200" style="width:100%;accent-color:#06b6d4" /></div></div><div style="display:flex;gap:8px;margin-top:16px;justify-content:center"><button id="__dc" style="background:#06b6d4;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">OK</button><button id="__dx" style="background:#374151;color:#9ca3af;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer">Cancel</button></div>';
              document.body.appendChild(popup);
              const rng1 = popup.querySelector('#__dr1') as HTMLInputElement;
              const rng2 = popup.querySelector('#__dr2') as HTMLInputElement;
              const lbl1 = popup.querySelector('#__dv1')!;
              const lbl2 = popup.querySelector('#__dv2')!;
              rng1.oninput = () => { lbl1.textContent = rng1.value; };
              rng2.oninput = () => { lbl2.textContent = rng2.value; };
              popup.querySelector('#__dc')!.addEventListener('click', () => {
                document.body.removeChild(popup);
                const startVal = Number(rng1.value);
                const endVal = Number(rng2.value);
                const block: DimmerBlock = { id: `db-${Date.now()}`, time: ftSelRef.current.start, endTime: ftSelRef.current.end, value: startVal, endValue: startVal !== endVal ? endVal : undefined };
                const fixture = tieredLayout.sorted[ftMenu.trackIdx];
                const existing = fixtureTracks.find(ft => resolveTrackTargets(ft, patchedFixtures, []).includes(fixture.id));
                if (existing) {
                  onFixtureTracksChange(fixtureTracks.map(ft => ft.id === existing.id ? { ...existing, dimmerBlocks: [...existing.dimmerBlocks, block] } : ft));
                } else {
                  
                  onFixtureTracksChange([...fixtureTracks, createFixtureTrack(`fixture:${fixture.id}`, fixture.name)]);
                }
                setFtMenu(null); setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null);
              });
              popup.querySelector('#__dx')!.addEventListener('click', () => document.body.removeChild(popup));
            }}
          ><span className="text-[14px]">💡</span> Dimmer</button>
          {/* Strobe */}
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
            onClick={() => {
              const popup = document.createElement('div');
              popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);min-width:280px';
              popup.innerHTML = '<div style="color:#fbbf24;font-size:13px;font-weight:600;margin-bottom:8px">Strobe Speed</div><div style="padding:8px 10px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.2);border-radius:8px;margin-bottom:12px"><p style="margin:0 0 4px 0;font-size:11px;color:#cbd5e1"><b style="color:#fbbf24">Départ</b> : fréquence au début du bloc (Hz).</p><p style="margin:0;font-size:11px;color:#cbd5e1"><b style="color:#fbbf24">Arrivée</b> : fréquence cible en fin de bloc. Accélération ou ralentissement progressif.</p></div><div style="display:flex;gap:16px;justify-content:center"><div style="text-align:center"><div style="color:#9ca3af;font-size:10px;margin-bottom:4px">Départ</div><div id="__sv1" style="color:#fbbf24;font-size:20px;font-weight:700;margin:4px 0">8 Hz</div><input id="__sr1" type="range" min="1" max="25" value="8" style="width:100%;accent-color:#f59e0b" /></div><div style="text-align:center"><div style="color:#9ca3af;font-size:10px;margin-bottom:4px">Arrivée</div><div id="__sv2" style="color:#fbbf24;font-size:20px;font-weight:700;margin:4px 0">8 Hz</div><input id="__sr2" type="range" min="1" max="25" value="8" style="width:100%;accent-color:#f59e0b" /></div></div><div style="display:flex;gap:8px;margin-top:16px;justify-content:center"><button id="__sc" style="background:#f59e0b;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">OK</button><button id="__sx" style="background:#374151;color:#9ca3af;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer">Cancel</button></div>';
              document.body.appendChild(popup);
              const rng1 = popup.querySelector('#__sr1') as HTMLInputElement;
              const rng2 = popup.querySelector('#__sr2') as HTMLInputElement;
              const lbl1 = popup.querySelector('#__sv1')!;
              const lbl2 = popup.querySelector('#__sv2')!;
              rng1.oninput = () => { lbl1.textContent = rng1.value + ' Hz'; if ((popup.querySelector('#__sr2') as HTMLInputElement).value === (popup.querySelector('#__sr1') as HTMLInputElement).defaultValue) { rng2.value = rng1.value; lbl2.textContent = rng1.value + ' Hz'; } };
              rng2.oninput = () => { lbl2.textContent = rng2.value + ' Hz'; };
              popup.querySelector('#__sc')!.addEventListener('click', () => {
                document.body.removeChild(popup);
                const startSpeed = Number(rng1.value);
                const endSpeed = Number(rng2.value);
                const block: StrobeBlock = { id: `sb-${Date.now()}`, time: ftSelRef.current.start, endTime: ftSelRef.current.end, speed: startSpeed, endSpeed: startSpeed !== endSpeed ? endSpeed : undefined };
                const fixture = tieredLayout.sorted[ftMenu.trackIdx];
                const existing = fixtureTracks.find(ft => resolveTrackTargets(ft, patchedFixtures, []).includes(fixture.id));
                if (existing) {
                  onFixtureTracksChange(fixtureTracks.map(ft => ft.id === existing.id ? { ...existing, strobeBlocks: [...existing.strobeBlocks, block] } : ft));
                } else {
                  
                  onFixtureTracksChange([...fixtureTracks, createFixtureTrack(`fixture:${fixture.id}`, fixture.name)]);
                }
                setFtMenu(null); setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null);
              });
              popup.querySelector('#__sx')!.addEventListener('click', () => document.body.removeChild(popup));
            }}
          ><span className="text-[14px]">⚡</span> Strobe</button>
          {/* Movement */}
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
            onClick={() => {
              const popup = document.createElement('div');
              popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);min-width:360px';
              popup.innerHTML = '<div style="color:#22c55e;font-size:13px;font-weight:600;margin-bottom:8px">Movement</div><div style="padding:8px 10px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);border-radius:8px;margin-bottom:12px"><p style="margin:0 0 4px 0;font-size:11px;color:#cbd5e1"><b style="color:#22c55e">Départ</b> : pattern et amplitude au début du bloc.</p><p style="margin:0;font-size:11px;color:#cbd5e1"><b style="color:#22c55e">Arrivée</b> : cible en fin de bloc. Pattern différent = changement à mi-temps.</p></div><div style="display:flex;gap:16px;justify-content:center"><div style="text-align:center;flex:1"><div style="color:#9ca3af;font-size:10px;margin-bottom:4px">Départ</div><select id="__mp1" style="width:100%;background:#1f1f2e;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db;font-size:12px;margin-bottom:8px"><option value="sweep">Sweep</option><option value="circle">Circle</option><option value="bounce">Bounce</option><option value="wave">Wave</option><option value="figure8">Figure-8</option><option value="zigzag">Zigzag</option><option value="diamond">Diamond</option><option value="spiral">Spiral</option><option value="heartbeat">Heartbeat</option><option value="randomWalk">Random Walk</option><option value="panOnly">Pan Only</option><option value="tiltOnly">Tilt Only</option><option value="static">Static</option></select><div id="__mv1" style="color:#22c55e;font-size:16px;font-weight:700;margin:4px 0">80</div><input id="__ma1" type="range" min="20" max="200" value="80" style="width:100%;accent-color:#22c55e" /></div><div style="text-align:center;flex:1"><div style="color:#9ca3af;font-size:10px;margin-bottom:4px">Arrivée</div><select id="__mp2" style="width:100%;background:#1f1f2e;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db;font-size:12px;margin-bottom:8px"><option value="sweep">Sweep</option><option value="circle">Circle</option><option value="bounce">Bounce</option><option value="wave">Wave</option><option value="figure8">Figure-8</option><option value="zigzag">Zigzag</option><option value="diamond">Diamond</option><option value="spiral">Spiral</option><option value="heartbeat">Heartbeat</option><option value="randomWalk">Random Walk</option><option value="panOnly">Pan Only</option><option value="tiltOnly">Tilt Only</option><option value="static">Static</option></select><div id="__mv2" style="color:#22c55e;font-size:16px;font-weight:700;margin:4px 0">80</div><input id="__ma2" type="range" min="20" max="200" value="80" style="width:100%;accent-color:#22c55e" /></div></div><div style="display:flex;gap:8px;margin-top:12px;justify-content:center"><button id="__mc" style="background:#22c55e;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">OK</button><button id="__mx" style="background:#374151;color:#9ca3af;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer">Cancel</button></div>';
              document.body.appendChild(popup);
              const sel1 = popup.querySelector('#__mp1') as HTMLSelectElement;
              const sel2 = popup.querySelector('#__mp2') as HTMLSelectElement;
              const rng1 = popup.querySelector('#__ma1') as HTMLInputElement;
              const rng2 = popup.querySelector('#__ma2') as HTMLInputElement;
              const lbl1 = popup.querySelector('#__mv1')!;
              const lbl2 = popup.querySelector('#__mv2')!;
              rng1.oninput = () => { lbl1.textContent = rng1.value; };
              rng2.oninput = () => { lbl2.textContent = rng2.value; };
              popup.querySelector('#__mc')!.addEventListener('click', () => {
                document.body.removeChild(popup);
                const p1 = sel1.value, p2 = sel2.value, a1 = Number(rng1.value), a2 = Number(rng2.value);
                const block: MovementBlock = { id: `mb-${Date.now()}`, time: ftSelRef.current.start, endTime: ftSelRef.current.end, pattern: p1 as MovementBlock['pattern'], amplitude: a1, endPattern: p1 !== p2 ? p2 : undefined, endAmplitude: a1 !== a2 ? a2 : undefined };
                const fixture = tieredLayout.sorted[ftMenu.trackIdx];
                const existing = fixtureTracks.find(ft => resolveTrackTargets(ft, patchedFixtures, []).includes(fixture.id));
                if (existing) {
                  onFixtureTracksChange(fixtureTracks.map(ft => ft.id === existing.id ? { ...existing, movementBlocks: [...existing.movementBlocks, block] } : ft));
                } else {
                  
                  onFixtureTracksChange([...fixtureTracks, createFixtureTrack(`fixture:${fixture.id}`, fixture.name)]);
                }
                setFtMenu(null); setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null);
              });
              popup.querySelector('#__mx')!.addEventListener('click', () => document.body.removeChild(popup));
            }}
          ><span className="text-[14px]">↕</span> Movement</button>
          {/* Remove block */}
          <div className="border-t border-gray-800 my-0.5" />
          <button className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 flex items-center gap-2"
            onClick={() => {
              const fixture = tieredLayout.sorted[ftMenu.trackIdx];
              const existing = fixtureTracks.find(ft => resolveTrackTargets(ft, patchedFixtures, []).includes(fixture.id));
              if (existing) {
                const s = ftSelRef.current.start;
                const e = ftSelRef.current.end;
                onFixtureTracksChange(fixtureTracks.map(ft => ft.id === existing.id ? {
                  ...existing,
                  colorBlocks: existing.colorBlocks.filter(b => !(b.time >= s && b.time <= e && b.endTime >= s && b.endTime <= e)),
                  dimmerBlocks: existing.dimmerBlocks.filter(b => !(b.time >= s && b.time <= e && b.endTime >= s && b.endTime <= e)),
                  strobeBlocks: existing.strobeBlocks.filter(b => !(b.time >= s && b.time <= e && b.endTime >= s && b.endTime <= e)),
                  movementBlocks: existing.movementBlocks.filter(b => !(b.time >= s && b.time <= e && b.endTime >= s && b.endTime <= e)),
                } : ft));
              }
              setFtMenu(null); setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null);
            }}
          ><span className="text-[14px]">🗑</span> Clear blocks in selection</button>
          <button className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800"
            onClick={() => { setFtMenu(null); setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null); }}
          >Cancel</button>
        </div>
      )}

      {/* ── Tooltip ────────────────────────────────── */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl px-3 py-2 text-xs"
          style={{
            left: Math.min(
              tooltip.x + 12,
              (containerRef.current?.getBoundingClientRect().width ?? 400) - 200,
            ),
            top: Math.max(-80, tooltip.y - 80),
          }}
        >
          {tooltip.efxEntry ? (
            <>
              <div className="text-[9px] text-cyan-400 mb-1 font-medium flex items-center gap-1">
                <span>{tooltip.trackName ? `EFX · ${tooltip.trackName}` : 'EFX'}</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#06b6d4' }} />
                <span className="text-gray-300 font-medium">{tooltip.efxEntry.label || tooltip.efxEntry.effectName}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <span className="font-mono">{fmt(tooltip.efxEntry.time)} → {fmt(tooltip.efxEntry.endTime)}</span>
                <span>{tooltip.efxEntry.pattern}</span>
              </div>
              {tooltip.efxEntry.fixtureNames.length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {tooltip.efxEntry.fixtureNames.slice(0, 6).map((name, i) => (
                    <span key={i} className="text-[8px] text-cyan-500 bg-cyan-500/10 px-1 rounded">
                      {name}
                    </span>
                  ))}
                  {tooltip.efxEntry.fixtureNames.length > 6 && (
                    <span className="text-[8px] text-gray-600">+{tooltip.efxEntry.fixtureNames.length - 6}</span>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {tooltip.fixtureName && (
                <div className="text-[9px] text-purple-400 mb-1 font-medium">
                  🎚 {tooltip.fixtureName}
                </div>
              )}
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: tooltip.cue.color }}
                />
                <span className="text-gray-300 font-medium">
                  {tooltip.cue.effect || 'Cue'}
                </span>
                {tooltip.cue.strobe && (
                  <span className="text-yellow-400 text-[9px]">⚡ STROBE</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <span className="font-mono">{fmt(tooltip.cue.time)}</span>
                <span className="capitalize">{tooltip.cue.intensity}</span>
                <span className="capitalize text-gray-600">
                  {tooltip.cue.section}
                </span>
              </div>
              {tooltip.cue.movement && tooltip.cue.movement !== 'static' && (
                <div className="text-[9px] text-gray-500 mt-1 capitalize">
                  ↕ {tooltip.cue.movement}
                </div>
              )}
              <div className="flex gap-1 mt-1.5">
                {tooltip.cue.colors.map((cc, j) => (
                  <div
                    key={j}
                    className="w-3 h-3 rounded-full border border-gray-600"
                    style={{ backgroundColor: cc }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {/* ── Gradient Color Picker Modal ── */}
      {gradientPicker !== null && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative z-10 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-6 w-[420px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-gradient-to-r from-purple-500 to-cyan-400" /><span className="text-sm font-semibold text-gray-200">Choix de couleur</span></div>
              <button className="text-gray-500 hover:text-white text-lg px-1" onClick={() => setGradientPicker(null)}>✕</button>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 mb-4">
              <div className="flex items-start gap-2 mb-2"><span className="w-5 h-5 rounded-full bg-purple-500/30 text-purple-300 text-[10px] flex items-center justify-center font-bold shrink-0 mt-0.5">1</span><p className="text-[11px] text-gray-400 leading-relaxed">Choisissez la <b className="text-purple-300">couleur de départ</b>. Elle servira de teinte dominante pour ce bloc.</p></div>
              <div className="flex items-start gap-2"><span className="w-5 h-5 rounded-full bg-cyan-500/30 text-cyan-300 text-[10px] flex items-center justify-center font-bold shrink-0 mt-0.5">2</span><p className="text-[11px] text-gray-400 leading-relaxed">Choisissez une <b className="text-cyan-300">couleur d'arrivée</b> pour un dégradé progressif, ou la même pour une teinte constante.</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Départ</label><div className="flex items-center gap-2"><input type="color" value={gradientPicker.startColor} onChange={e => setGradientPicker(prev => prev ? { ...prev, startColor: e.target.value, endColor: prev.constantColor ? e.target.value : prev.endColor } : null)} className="w-10 h-10 rounded-lg border-2 border-gray-700 cursor-pointer" /><span className="text-xs text-gray-300 font-mono">{gradientPicker.startColor}</span></div></div>
              <div><label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Arrivée</label><div className="flex items-center gap-2"><input type="color" value={gradientPicker.endColor} onChange={e => setGradientPicker(prev => prev ? { ...prev, endColor: e.target.value } : null)} disabled={gradientPicker.constantColor} className={'w-10 h-10 rounded-lg border-2 border-purple-700 cursor-pointer ' + (gradientPicker.constantColor ? 'opacity-30 cursor-not-allowed' : '')} /><span className="text-xs text-gray-300 font-mono">{gradientPicker.endColor}</span></div></div>
            </div>
            <div className="h-3 rounded-full mb-4" style={{ background: 'linear-gradient(90deg, ' + gradientPicker.startColor + ', ' + gradientPicker.endColor + ')' }} />
            <div className="flex flex-wrap gap-1.5 mb-4">
              {['#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#ffffff','#ff8800'].map(hex => (
                <button key={hex} onClick={() => setGradientPicker(prev => prev ? { ...prev, endColor: hex } : null)} className="w-6 h-6 rounded-full border border-gray-700 hover:scale-125 transition-transform" style={{ background: hex }} title={hex} />
              ))}
            </div>
            <label className="flex items-center gap-2 text-[10px] text-gray-500 mb-4 cursor-pointer">
              <input type="checkbox" checked={gradientPicker.endColor === gradientPicker.startColor} onChange={e => { if (e.target.checked) setGradientPicker(prev => prev ? { ...prev, endColor: prev.startColor, constantColor: true } : null); else setGradientPicker(prev => prev ? { ...prev, constantColor: false } : null); }} className="accent-purple-500" />
              Couleur constante (départ = arrivée)
            </label>
{/* ── Presets ── */}
{qs?.gradientPresets && qs.gradientPresets.length > 0 && (
  <div className="mb-3">
    <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">Presets sauvegardés</div>
    <div className="flex flex-wrap gap-1">
      {qs.gradientPresets.map((p: any) => (
        <button key={p.id} className="px-2 py-1 rounded text-[9px] border border-gray-700 hover:border-purple-500 transition-colors"
          style={{ background: 'linear-gradient(90deg, ' + p.start + ', ' + p.end + ')' }}
          title={p.name}
          onClick={() => { const same = p.start === p.end; setGradientPicker((prev: any) => prev ? { ...prev, startColor: p.start, endColor: p.end, constantColor: same } : null); }}
        >
          <span className="drop-shadow-[0_0_3px_rgba(0,0,0,0.9)]">{p.name}</span>
        </button>
      ))}
    </div>
  </div>
)}
<div className="mb-3">
  <button className="w-full text-[10px] text-gray-500 border border-dashed border-gray-700 rounded-md py-1 hover:border-purple-500 hover:text-purple-300 transition-colors"
    onClick={() => {
      if (!gradientPicker) return;
      const name = prompt('Nom du preset :');
      if (!name || !(name.trim())) return;
      const presets = qs?.gradientPresets ? [...qs.gradientPresets] : [];
      presets.push({ id: 'gp-' + Date.now(), name, start: gradientPicker.startColor, end: gradientPicker.endColor });
      setQs({ ...qs, gradientPresets: presets });
    }}
  >+ Sauvegarder ce dégradé</button>
</div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setGradientPicker(null)} className="px-4 py-2 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">{t('common.cancel')}</button>
              <button onClick={() => {
                if (!gradientPicker) return;
                const { endColor, startColor } = gradientPicker;
                const block = { id: 'cb-' + Date.now(), time: ftSelRef.current.start, endTime: ftSelRef.current.end, color: startColor, endColor: startColor !== endColor ? endColor : undefined };
                const fixture = tieredLayout.sorted[gradientPicker.trackIdx];
                const existing = fixtureTracks.find(ft => resolveTrackTargets(ft, patchedFixtures, []).includes(fixture.id));
                if (existing) {
                  onFixtureTracksChange(fixtureTracks.map(ft => ft.id === existing.id ? { ...existing, colorBlocks: [...existing.colorBlocks, block] } : ft));
                } else {
                  onFixtureTracksChange([...fixtureTracks, createFixtureTrack('fixture:' + fixture.id, fixture.name)]);
                }
                setGradientPicker(null);
                setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null);
              }} className="px-4 py-2 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500">Appliquer</button>
            </div>
          </div>
        </div>
      )}
            {/* ── Edit Color Block ── */}
      {editBlock && editBlock.blockType === 'color' && fixtureTracks && (() => {
        const ft = fixtureTracks[editBlock.trackIdx];
        const cb = ft?.colorBlocks.find(b => b.id === editBlock.blockId);
        const fixture = tieredLayout.sorted[ftSelRef.current.fixture];
        if (!cb || !fixture) return null;
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setEditBlock(null)} />
            <div className="relative z-10 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-6 w-[420px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-gradient-to-r from-purple-500 to-cyan-400" /><span className="text-sm font-semibold text-gray-200">Modifier couleur</span></div>
                <button className="text-gray-500 hover:text-white text-lg px-1" onClick={() => setEditBlock(null)}>✕</button>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 mb-4">
                <div className="flex gap-4">
                  <div><label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Départ</label><div className="flex items-center gap-2"><input type="color" value={cb.color} onChange={e => {}} id="__edit_cs" className="w-10 h-10 rounded-lg border-2 border-purple-700 cursor-pointer" /><span className="text-xs text-gray-300 font-mono">{cb.color}</span></div></div>
                  <div><label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Arrivée</label><div className="flex items-center gap-2"><input type="color" value={cb.endColor || cb.color} onChange={e => {}} id="__edit_ce" className="w-10 h-10 rounded-lg border-2 border-purple-700 cursor-pointer" /><span className="text-xs text-gray-300 font-mono">{cb.endColor || cb.color}</span></div></div>
                </div>
                <div className="h-3 rounded-full mt-3" style={{ background: 'linear-gradient(90deg, ' + cb.color + ', ' + (cb.endColor || cb.color) + ')' }} />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {['#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#ffffff','#ff8800'].map(hex => (
                  <button key={hex} onClick={() => { const e2 = document.getElementById('__edit_ce') as HTMLInputElement; if(e2){e2.value=hex;e2.dispatchEvent(new Event('input',{bubbles:true}));} (e2?.nextElementSibling as HTMLElement).textContent=hex; }} className="w-6 h-6 rounded-full border border-gray-700 hover:scale-125 transition-transform" style={{ background: hex }} title={hex} />
                ))}
              </div>
              <label className="flex items-center gap-2 text-[10px] text-gray-500 mb-4 cursor-pointer">
                <input type="checkbox" id="__edit_const" checked={!cb.endColor || cb.endColor === cb.color} onChange={e => { const val = e.target.checked ? (document.getElementById('__edit_cs') as HTMLInputElement).value : ''; const ce = document.getElementById('__edit_ce') as HTMLInputElement; if(ce){ce.value=val;ce.dispatchEvent(new Event('input',{bubbles:true}));} }} className="accent-purple-500" />
                Couleur constante (départ = arrivée)
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditBlock(null)} className="px-4 py-2 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">{t('common.cancel')}</button>
                <button onClick={() => {
                  const cs = (document.getElementById('__edit_cs') as HTMLInputElement).value;
                  const ce = (document.getElementById('__edit_ce') as HTMLInputElement).value;
                  const same = cs === ce;
                  onFixtureTracksChange(fixtureTracks.map((t, i) => i === editBlock.trackIdx ? { ...t, colorBlocks: t.colorBlocks.map(b => b.id === editBlock.blockId ? { ...b, color: cs, endColor: same ? undefined : ce } : b) } : t));
                  setEditBlock(null);
                }} className="px-4 py-2 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500">Appliquer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Edit Dimmer Block ── */}
      {editBlock && editBlock.blockType === 'dimmer' && fixtureTracks && (() => {
        const ft = fixtureTracks[editBlock.trackIdx];
        const db = ft?.dimmerBlocks.find(b => b.id === editBlock.blockId);
        if (!db) return null;
        return (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setEditBlock(null)} />
            <div className="relative z-10 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-6 w-[340px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-cyan-300">💡 Modifier dimmer</span>
              <div className="mt-3 mb-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-2"><p className="text-[10px] text-gray-300 m-0"><b className="text-cyan-400">Départ</b> : intensité au début • <b className="text-cyan-400">Arrivée</b> : fondu progressif si différente.</p></div>
                <button className="text-gray-500 hover:text-white text-lg px-1" onClick={() => setEditBlock(null)}>✕</button>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Départ</div>
                  <div id="__ed_dim_v1" className="text-cyan-300 text-lg font-bold mb-2">{db.value}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const el = document.getElementById('__ed_dim_s1') as HTMLInputElement; if (!el) return; const v = Math.max(0, Math.min(255, Number(el.value) - 1)); el.value = String(v); document.getElementById('__ed_dim_v1')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                    <input type="range" id="__ed_dim_s1" min="0" max="255" defaultValue={db.value} onChange={e => { document.getElementById('__ed_dim_v1')!.textContent = e.target.value; }} style={{ flex: 1, accentColor: '#22d3ee' }} />
                    <button onClick={() => { const el = document.getElementById('__ed_dim_s1') as HTMLInputElement; if (!el) return; const v = Math.max(0, Math.min(255, Number(el.value) + 1)); el.value = String(v); document.getElementById('__ed_dim_v1')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                  </div>
                </div>
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Arrivée</div>
                  <div id="__ed_dim_v2" className="text-cyan-300 text-lg font-bold mb-2">{db.endValue ?? db.value}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const el = document.getElementById('__ed_dim_s2') as HTMLInputElement; if (!el) return; const v = Math.max(0, Math.min(255, Number(el.value) - 1)); el.value = String(v); document.getElementById('__ed_dim_v2')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                    <input type="range" id="__ed_dim_s2" min="0" max="255" defaultValue={db.endValue ?? db.value} onChange={e => { document.getElementById('__ed_dim_v2')!.textContent = e.target.value; }} style={{ flex: 1, accentColor: '#22d3ee' }} />
                    <button onClick={() => { const el = document.getElementById('__ed_dim_s2') as HTMLInputElement; if (!el) return; const v = Math.max(0, Math.min(255, Number(el.value) + 1)); el.value = String(v); document.getElementById('__ed_dim_v2')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEditBlock(null)} className="px-4 py-2 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">{t('common.cancel')}</button>
                <button onClick={() => {
                  const v1 = Number((document.getElementById('__ed_dim_s1') as HTMLInputElement).value);
                  const v2 = Number((document.getElementById('__ed_dim_s2') as HTMLInputElement).value);
                  onFixtureTracksChange(fixtureTracks.map((t, i) => i === editBlock.trackIdx ? { ...t, dimmerBlocks: t.dimmerBlocks.map(b => b.id === editBlock.blockId ? { ...b, value: v1, endValue: v1 !== v2 ? v2 : undefined } : b) } : t));
                  setEditBlock(null);
                }} className="px-4 py-2 rounded-lg text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-500">Appliquer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Edit Strobe Block ── */}
      {editBlock && editBlock.blockType === 'strobe' && fixtureTracks && (() => {
        const ft = fixtureTracks[editBlock.trackIdx];
        const sb = ft?.strobeBlocks.find(b => b.id === editBlock.blockId);
        if (!sb) return null;
        return (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setEditBlock(null)} />
            <div className="relative z-10 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-6 w-[340px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-yellow-400">⚡ Modifier strobe</span>
              <div className="mt-3 mb-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2"><p className="text-[10px] text-gray-300 m-0"><b className="text-yellow-400">Départ</b> : fréquence Hz au début • <b className="text-yellow-400">Arrivée</b> : accélération/réduction.</p></div>
                <button className="text-gray-500 hover:text-white text-lg px-1" onClick={() => setEditBlock(null)}>✕</button>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Départ (Hz)</div>
                  <div id="__ed_sb_v1" className="text-yellow-400 text-lg font-bold mb-2">{sb.speed}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const el = document.getElementById('__ed_sb_s1') as HTMLInputElement; if (!el) return; const v = Math.max(1, Math.min(30, Number(el.value) - 1)); el.value = String(v); document.getElementById('__ed_sb_v1')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                    <input type="range" id="__ed_sb_s1" min="1" max="30" step="0.5" defaultValue={sb.speed} onChange={e => { document.getElementById('__ed_sb_v1')!.textContent = e.target.value; }} style={{ flex: 1, accentColor: '#facc15' }} />
                    <button onClick={() => { const el = document.getElementById('__ed_sb_s1') as HTMLInputElement; if (!el) return; const v = Math.max(1, Math.min(30, Number(el.value) + 1)); el.value = String(v); document.getElementById('__ed_sb_v1')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                  </div>
                </div>
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Arrivée (Hz)</div>
                  <div id="__ed_sb_v2" className="text-yellow-400 text-lg font-bold mb-2">{sb.endSpeed ?? sb.speed}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const el = document.getElementById('__ed_sb_s2') as HTMLInputElement; if (!el) return; const v = Math.max(1, Math.min(30, Number(el.value) - 1)); el.value = String(v); document.getElementById('__ed_sb_v2')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                    <input type="range" id="__ed_sb_s2" min="1" max="30" step="0.5" defaultValue={sb.endSpeed ?? sb.speed} onChange={e => { document.getElementById('__ed_sb_v2')!.textContent = e.target.value; }} style={{ flex: 1, accentColor: '#facc15' }} />
                    <button onClick={() => { const el = document.getElementById('__ed_sb_s2') as HTMLInputElement; if (!el) return; const v = Math.max(1, Math.min(30, Number(el.value) + 1)); el.value = String(v); document.getElementById('__ed_sb_v2')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEditBlock(null)} className="px-4 py-2 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">{t('common.cancel')}</button>
                <button onClick={() => {
                  const s1 = Number((document.getElementById('__ed_sb_s1') as HTMLInputElement).value);
                  const s2 = Number((document.getElementById('__ed_sb_s2') as HTMLInputElement).value);
                  onFixtureTracksChange(fixtureTracks.map((t, i) => i === editBlock.trackIdx ? { ...t, strobeBlocks: t.strobeBlocks.map(b => b.id === editBlock.blockId ? { ...b, speed: s1, endSpeed: s1 !== s2 ? s2 : undefined } : b) } : t));
                  setEditBlock(null);
                }} className="px-4 py-2 rounded-lg text-xs font-medium bg-yellow-600 text-black hover:bg-yellow-500">Appliquer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Edit Movement Block ── */}
      {editBlock && editBlock.blockType === 'movement' && fixtureTracks && (() => {
        const ft = fixtureTracks[editBlock.trackIdx];
        const mb = ft?.movementBlocks.find(b => b.id === editBlock.blockId);
        if (!mb) return null;
        const patterns = ['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static'];
        return (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setEditBlock(null)} />
            <div className="relative z-10 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-6 w-[380px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-green-400">↕ Modifier mouvement</span>
              <div className="mt-3 mb-3 bg-green-500/10 border border-green-500/20 rounded-lg p-2"><p className="text-[10px] text-gray-300 m-0"><b className="text-green-400">Départ</b> : pattern + amplitude au début • <b className="text-green-400">Arrivée</b> : transition.</p></div>
                <button className="text-gray-500 hover:text-white text-lg px-1" onClick={() => setEditBlock(null)}>✕</button>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Départ</div>
                  <select id="__ed_mv_p1" defaultValue={mb.pattern} className="w-full bg-[#1f1f2e] border border-gray-700 rounded-md p-1.5 text-gray-300 text-xs mb-2">
                    {patterns.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div id="__ed_mv_v1" className="text-green-400 text-lg font-bold mb-2">{mb.amplitude}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const el = document.getElementById('__ed_mv_a1') as HTMLInputElement; if (!el) return; const v = Math.max(20, Math.min(200, Number(el.value) - 1)); el.value = String(v); document.getElementById('__ed_mv_v1')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                    <input type="range" id="__ed_mv_a1" min="20" max="200" defaultValue={mb.amplitude} onChange={e => { document.getElementById('__ed_mv_v1')!.textContent = e.target.value; }} style={{ flex: 1, accentColor: '#22c55e' }} />
                    <button onClick={() => { const el = document.getElementById('__ed_mv_a1') as HTMLInputElement; if (!el) return; const v = Math.max(20, Math.min(200, Number(el.value) + 1)); el.value = String(v); document.getElementById('__ed_mv_v1')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                  </div>
                </div>
                <div className="flex-1 text-center">
                  <div className="text-[10px] text-gray-500 mb-1">Arrivée</div>
                  <select id="__ed_mv_p2" defaultValue={mb.endPattern || mb.pattern} className="w-full bg-[#1f1f2e] border border-gray-700 rounded-md p-1.5 text-gray-300 text-xs mb-2">
                    {patterns.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div id="__ed_mv_v2" className="text-green-400 text-lg font-bold mb-2">{mb.endAmplitude ?? mb.amplitude}</div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { const el = document.getElementById('__ed_mv_a2') as HTMLInputElement; if (!el) return; const v = Math.max(20, Math.min(200, Number(el.value) - 1)); el.value = String(v); document.getElementById('__ed_mv_v2')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                    <input type="range" id="__ed_mv_a2" min="20" max="200" defaultValue={mb.endAmplitude ?? mb.amplitude} onChange={e => { document.getElementById('__ed_mv_v2')!.textContent = e.target.value; }} style={{ flex: 1, accentColor: '#22c55e' }} />
                    <button onClick={() => { const el = document.getElementById('__ed_mv_a2') as HTMLInputElement; if (!el) return; const v = Math.max(20, Math.min(200, Number(el.value) + 1)); el.value = String(v); document.getElementById('__ed_mv_v2')!.textContent = String(v); }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEditBlock(null)} className="px-4 py-2 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">{t('common.cancel')}</button>
                <button onClick={() => {
                  const p1 = (document.getElementById('__ed_mv_p1') as HTMLSelectElement).value as MovementBlock['pattern'];
                  const p2 = (document.getElementById('__ed_mv_p2') as HTMLSelectElement).value as MovementBlock['pattern'];
                  const a1 = Number((document.getElementById('__ed_mv_a1') as HTMLInputElement).value);
                  const a2 = Number((document.getElementById('__ed_mv_a2') as HTMLInputElement).value);
                  onFixtureTracksChange(fixtureTracks.map((t, i) => i === editBlock.trackIdx ? { ...t, movementBlocks: t.movementBlocks.map(b => b.id === editBlock.blockId ? { ...b, pattern: p1, amplitude: a1, endPattern: p1 !== p2 ? p2 : undefined, endAmplitude: a1 !== a2 ? a2 : undefined } : b) } : t));
                  setEditBlock(null);
                }} className="px-4 py-2 rounded-lg text-xs font-medium bg-green-600 text-black hover:bg-green-500">Appliquer</button>
              </div>
            </div>
          </div>
        );
      })()}

{/* ── Block Context Menu ── */}
      {blockMenu && onFixtureTracksChange && fixtureTracks && (
        <div
          className="fixed z-50 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: blockMenu.x, top: blockMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-800">
            {blockMenu.blockType}
          </div>
          <button className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-gray-800 flex items-center gap-2"
            onClick={() => {
              const ft = fixtureTracks[blockMenu.trackIdx];
              if (!ft) return;
              const filterBlock = (arr: any[]) => arr.filter((b: any) => b.id !== blockMenu.blockId);
              const updated = fixtureTracks.map((t, i) => {
                if (i !== blockMenu.trackIdx) return t;
                switch (blockMenu.blockType) {
                  case 'color': return { ...t, colorBlocks: filterBlock(t.colorBlocks) };
                  case 'dimmer': return { ...t, dimmerBlocks: filterBlock(t.dimmerBlocks) };
                  case 'strobe': return { ...t, strobeBlocks: filterBlock(t.strobeBlocks) };
                  case 'movement': return { ...t, movementBlocks: filterBlock(t.movementBlocks) };
                  default: return t;
                }
              });
              onFixtureTracksChange(updated);
              setBlockMenu(null);
            }}
          ><span className="text-[14px]">🗑</span> Supprimer</button>
        </div>
      )}

    </div>
  );
};

export default TrackTimeline;