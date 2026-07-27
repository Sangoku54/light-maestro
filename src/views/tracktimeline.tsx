/**
 * TrackTimeline — multi-track DMX timeline inspired by SoundSwitch.
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
import { resolveTrackTargets, createFixtureTrack } from '../hooks/fixture-tracks';

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
  time: number;
  endTime: number;
  effectId: string;
  effectName: string;
  pattern: string;
  fixtureNames: string[];
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

interface TrackTimelineProps {
  cues: Cue[];
  dmxCues?: DmxCue[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  sections: TrackSection[];
  patchedFixtures: PatchedFixture[];
  bpm: number;
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
  /** Called when user drags a section boundary to resize */
  onSectionsChange?: (sections: TrackSection[]) => void;
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
}

// ─── Constants ────────────────────────────────────────────

const TRACK_HEIGHT = 30;
const HEADER_HEIGHT = 32;
const AUTOSCRIPT_TRACK_HEIGHT = 40;
const EFX_TRACK_HEIGHT = 28;
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
  efxTracks,
  onEfxTrackContextMenu,
  onEfxEntryClick,
  onEfxEntryChange,
  onEfxEntryContextMenu,
  onSectionsChange,
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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  const [gradientPicker, setGradientPicker] = useState(null);  const ftDragStart = useRef(0);
  const ftDragFixture = useRef(-1);
  const isFtDragging = useRef(false);
  const ftSelRef = useRef({ start: 0, end: 0, fixture: -1, track: null as FixtureTrack | null });

  const numFixtures = patchedFixtures.length;
  const numEfxTracks = efxTracks?.length ?? 0;
  const totalHeight = HEADER_HEIGHT + numFixtures * TRACK_HEIGHT + AUTOSCRIPT_TRACK_HEIGHT + numEfxTracks * EFX_TRACK_HEIGHT;

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

  // ── Cue lookup for hover/click ───────────────────────
  const getCueAtPosition = useCallback(
    (clientX: number, clientY: number): { cue: Cue; fixtureName?: string; efxEntry?: EfxTrackEntry; trackName?: string } | null => {
      const c = containerRef.current;
      if (!c) return null;
      const rect = c.getBoundingClientRect();
      const x = clientX - rect.left - LABEL_WIDTH;
      const y = clientY - rect.top;
      if (x < 0 || y < HEADER_HEIGHT) return null;

      const drawW = rect.width - LABEL_WIDTH;
      if (drawW <= 0) return null;
      const timeAtX = (x / drawW) * duration;

      // Check which track we're on
      const trackIdx = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);

      // If on a fixture track
      if (trackIdx >= 0 && trackIdx < numFixtures) {
        const fixture = patchedFixtures[trackIdx];
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
      const autoTrackStart = HEADER_HEIGHT + numFixtures * TRACK_HEIGHT;
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
      const efxTracksStart = HEADER_HEIGHT + numFixtures * TRACK_HEIGHT + AUTOSCRIPT_TRACK_HEIGHT;
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
    [duration, numFixtures, patchedFixtures, getCuesForFixture, cues, efxTracks],
  );

  // ── Event handlers ───────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Fixture track drag selection — use refs, never stale
      if (isFtDragging.current) {
        // Hide tooltip during drag so selection is visible
        setTooltip(null);
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = rect.width - LABEL_WIDTH;
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

      // EFX entry drag/resize
      if (efxDragRef.current) {
        const c = containerRef.current; if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = rect.width - LABEL_WIDTH;
        if (drawW <= 0) return;
        const dx = (e.clientX - efxDragRef.current.startX) / drawW * duration;
        const drag = efxDragRef.current;
        if (drag.mode === 'move') {
          const newTime = Math.max(0, drag.entryTime + dx);
          const newEnd = drag.entryEndTime + dx;
          onEfxEntryChange?.(drag.trackId, drag.entryIndex, { time: newTime, endTime: newEnd });
        } else if (drag.mode === 'resize-left') {
          const newTime = Math.max(0, Math.min(drag.entryEndTime - 0.1, drag.entryTime + dx));
          onEfxEntryChange?.(drag.trackId, drag.entryIndex, { time: newTime });
        } else if (drag.mode === 'resize-right') {
          const newEnd = Math.max(drag.entryTime + 0.2, drag.entryEndTime + dx);
          onEfxEntryChange?.(drag.trackId, drag.entryIndex, { endTime: newEnd });
        }
        return;
      }

      // Section resize in progress
      if (sectionResizeRef.current) {
        const resize = sectionResizeRef.current;
        const c = containerRef.current;
        if (!c) return;
        const rect = c.getBoundingClientRect();
        const drawW = rect.width - LABEL_WIDTH;
        if (drawW <= 0) return;
        const dx = e.clientX - resize.startX;
        const dt = (dx / drawW) * duration;
        const newTime = Math.max(0, Math.min(duration, resize.startTime + dt));

        // Don't let edge cross the other edge
        const minSep = 0.1; // minimum section width
        const clamped = resize.edge === 'left'
          ? Math.min(newTime, resize.otherEdgeTime - minSep)
          : Math.max(newTime, resize.otherEdgeTime + minSep);

        sections[resize.sectionIndex] = {
          ...sections[resize.sectionIndex],
          [resize.edge === 'left' ? 'startTime' : 'endTime']: clamped,
        };
        // Trigger re-render by updating the prop
        onSectionsChange?.([...sections]);
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
    [getCueAtPosition, duration, sections, onSectionsChange, onEfxEntryChange],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Clear fixture track selection on regular click (but NOT if context menu is open)
      if (ftSelStart !== null && !ftMenu) {
        setFtSelStart(null); setFtSelEnd(null); setFtSelFixture(null); setFtSelTrack(null);
        ftSelRef.current = { start: 0, end: 0, fixture: -1, track: null };
      }

      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      if (x < 0) return;

      const drawW = rect.width - LABEL_WIDTH;
      if (drawW <= 0) return;

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

      // Seek to position
      const timeAtX = (x / drawW) * duration;
      onSeek(Math.max(0, Math.min(duration, timeAtX)));
    },
    [duration, getCueAtPosition, onSeek, efxTracks, onEfxEntryClick],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left - LABEL_WIDTH;
      const y = e.clientY - rect.top;

      const drawW = rect.width - LABEL_WIDTH;
      if (x < 0 || drawW <= 0) return;
      const timeAtX = (x / drawW) * duration;

      // Fixture track: if we have a selection, show override menu
      if (fixtureTracks && onFixtureTracksChange && ftSelRef.current.start < ftSelRef.current.end) {
        const tIdx = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);
        if (tIdx >= 0 && tIdx < numFixtures) {
          e.preventDefault();
          setFtMenu({ x: e.clientX, y: e.clientY, trackIdx: tIdx, timeAtX });
          return;
        }
      }

      const eTracks = efxTracks || [];
      if (eTracks.length === 0) return;
      const efxTracksStart = HEADER_HEIGHT + numFixtures * TRACK_HEIGHT + AUTOSCRIPT_TRACK_HEIGHT;

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
              Math.max(0, Math.min(duration, timeAtX)),
              e.clientX,
              e.clientY,
            );
          }
        }
      }
    },
    [duration, efxTracks, numFixtures, onEfxTrackContextMenu, onEfxEntryContextMenu],
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
      const y = e.clientY - rect.top;
      if (y < HEADER_HEIGHT) return;
      const drawW = rect.width - LABEL_WIDTH;
      if (drawW <= 0) return;
      const trackIdx = Math.floor((y - HEADER_HEIGHT) / TRACK_HEIGHT);
      if (trackIdx >= 0 && trackIdx < numFixtures) {
        const timeAtX = Math.max(0, x) / drawW * duration;
        const t = Math.max(0, Math.min(duration, timeAtX));
        isFtDragging.current = true;
        ftDragStart.current = t;
        ftDragFixture.current = trackIdx;
        ftSelRef.current = { start: t, end: t, fixture: trackIdx, track: null };
        setFtSelStart(t); setFtSelEnd(t);
        setFtSelFixture(trackIdx);
        const fixture = patchedFixtures[trackIdx];
        const existingFt = (fixtureTracks || []).find(ft => resolveTrackTargets(ft, patchedFixtures, []).includes(fixture.id));
        setFtSelTrack(existingFt || null);
        ftSelRef.current.track = existingFt || null;
        e.preventDefault(); e.stopPropagation();
        return;
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
          const efxTracksStartY = HEADER_HEIGHT + numFixtures * TRACK_HEIGHT + AUTOSCRIPT_TRACK_HEIGHT;
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

    if (!onSectionsChange) return;
    const c = containerRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL_WIDTH;
    const y = e.clientY - rect.top;
    if (x < 0 || y < HEADER_HEIGHT) return;

    const drawW = rect.width - LABEL_WIDTH;
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
  }, [sections, duration, onSectionsChange]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Clear EFX drag
    if (efxDragRef.current) {
      efxDragRef.current = null;
      return;
    }

    // Fixture track drag end
    if (isFtDragging.current) {
      isFtDragging.current = false;
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

    const drawW = w - LABEL_WIDTH;
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

    // ── Per-fixture tracks ──────────────────────────
    const barW = Math.max(3, Math.min(10, drawW / Math.max(1, cues.length) * 0.6));

    for (let fi = 0; fi < numFixtures; fi++) {
      const fixture = patchedFixtures[fi];
      const trackY = HEADER_HEIGHT + fi * TRACK_HEIGHT;

      // Track background (alternating)
      ctx.fillStyle = fi % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.1)';
      ctx.fillRect(LABEL_WIDTH, trackY, drawW, TRACK_HEIGHT);

      // Horizontal track separator
      ctx.strokeStyle = 'rgba(75, 85, 99, 0.1)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(LABEL_WIDTH, trackY + TRACK_HEIGHT);
      ctx.lineTo(w, trackY + TRACK_HEIGHT);
      ctx.stroke();

      // Fixture name label
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      const displayName =
        fixture.name.length > 12
          ? fixture.name.substring(0, 11) + '\u2026'
          : fixture.name;
      ctx.fillText(displayName, 6, trackY + TRACK_HEIGHT / 2 + 4);

      // Tier badge
      const tierColors: Record<string, string> = {
        primary: '#a855f7',
        secondary: '#3b82f6',
        tertiary: '#6b7280',
      };
      const tierColor = tierColors[fixture.tier] || '#6b7280';
      ctx.fillStyle = tierColor + '40';
      ctx.font = '8px -apple-system, sans-serif';
      ctx.fillText(fixture.tier.substring(0, 1).toUpperCase(), 72, trackY + TRACK_HEIGHT / 2 + 4);

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
            ctx.fillStyle = cb.color + 'CC';
            ctx.fillRect(Math.max(LABEL_WIDTH, cx), trackY + 1, bw, TRACK_HEIGHT - 2);
            if (bw > 20) {
              ctx.fillStyle = '#ffffff'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
              ctx.fillText(cb.color, cx + bw/2, trackY + TRACK_HEIGHT - 5);
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
      if (ftSelStart !== null && ftSelEnd !== null && ftSelFixture === fi) {
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

        // Glow
        ctx.save();
        ctx.shadowColor = cue.color + '66';
        ctx.shadowBlur = 4;
        ctx.fillStyle = cue.color + 'CC';
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, barY, barW, iH, 2);
        ctx.fill();
        ctx.restore();

        // Core bar
        ctx.fillStyle = cue.color;
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, barY, barW, iH, 2);
        ctx.fill();

        // Top highlight
        const grad = ctx.createLinearGradient(cx, barY, cx, barY + iH);
        grad.addColorStop(0, 'rgba(255,255,255,0.35)');
        grad.addColorStop(0.5, cue.color);
        grad.addColorStop(1, cue.color + '80');
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
            ctx.fillStyle = cc;
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

    // ── AutoScript track ────────────────────────────
    const autoY = HEADER_HEIGHT + numFixtures * TRACK_HEIGHT;

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
              label = entry.effectName.length > maxLabel - 4
                ? entry.effectName.substring(0, maxLabel - 5) + '\u2026'
                : entry.effectName;
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

    // ── Playhead ─────────────────────────────────────
    if (currentTime >= 0 && currentTime <= duration) {
      const px = LABEL_WIDTH + (currentTime / duration) * drawW;
      if (px >= LABEL_WIDTH && px <= w) {
        // Glow
        ctx.save();
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, HEADER_HEIGHT);
        ctx.lineTo(px, h);
        ctx.stroke();
        ctx.restore();

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
        ctx.fillText(fmt(currentTime), px, h - 2);
      }
    }
  }, [
    cues,
    sections,
    duration,
    currentTime,
    patchedFixtures,
    numFixtures,
    bpm,
    totalHeight,
    autoScriptData,
    getCuesForFixture,
    efxTracks,
    numEfxTracks,
    fixtureTracks,
    ftSelStart,
    ftSelEnd,
    ftSelFixture,
  ]);

  // ── RAF playhead — draws ONLY the moving playhead line, never clears the canvas
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || duration <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    let prevX = -1;

    const animate = () => {
      const ct = currentTimeRef.current;
      if (ct < 0 || ct > duration) { rafRef.current = requestAnimationFrame(animate); return; }

      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const drawW = w - LABEL_WIDTH;
      if (drawW <= 0) { rafRef.current = requestAnimationFrame(animate); return; }

      const px = Math.round(LABEL_WIDTH + (ct / duration) * drawW);
      if (px === prevX) { rafRef.current = requestAnimationFrame(animate); return; }

      const ctx = canvas.getContext('2d');
      if (!ctx) { rafRef.current = requestAnimationFrame(animate); return; }

      // Clear previous playhead position only
      if (prevX >= 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(0, prevX - 2), 0, 4, totalHeight);
        ctx.clip();
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(Math.max(0, prevX - 2), 0, 4, totalHeight);
        ctx.restore();
      }

      prevX = px;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Playhead line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, totalHeight);
      ctx.stroke();

      // Triangle at top
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px - 5, -6);
      ctx.lineTo(px + 5, -6);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafRef.current); prevX = -1; };
  }, [totalHeight, duration]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden border border-gray-800/50 cursor-pointer select-none"
        style={{ height: `${totalHeight}px`, backgroundColor: '#0a0a0f' }}
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
            {fmt(ftSelRef.current.start)} → {fmt(ftSelRef.current.end)} · {patchedFixtures[ftMenu.trackIdx]?.name}
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
              popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)';
              popup.innerHTML = '<div style="color:#06b6d4;font-size:13px;font-weight:600;margin-bottom:10px">Dimmer</div><div id="__dv" style="color:#06b6d4;font-size:24px;font-weight:700;margin:8px 0">200</div><input id="__dr" type="range" min="0" max="255" value="200" style="width:100%;accent-color:#06b6d4" /><div style="display:flex;gap:8px;margin-top:12px;justify-content:center"><button id="__dc" style="background:#06b6d4;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">OK</button><button id="__dx" style="background:#374151;color:#9ca3af;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer">Cancel</button></div>';
              document.body.appendChild(popup);
              const rng = popup.querySelector('#__dr') as HTMLInputElement;
              const lbl = popup.querySelector('#__dv')!;
              rng.oninput = () => { lbl.textContent = rng.value; };
              popup.querySelector('#__dc')!.addEventListener('click', () => {
                document.body.removeChild(popup);
                const block: DimmerBlock = { id: `db-${Date.now()}`, time: ftSelRef.current.start, endTime: ftSelRef.current.end, value: Number(rng.value) };
                const fixture = patchedFixtures[ftMenu.trackIdx];
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
              popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)';
              popup.innerHTML = '<div style="color:#fbbf24;font-size:13px;font-weight:600;margin-bottom:10px">Strobe Speed</div><div id="__sv" style="color:#fbbf24;font-size:24px;font-weight:700;margin:8px 0">8 Hz</div><input id="__sr" type="range" min="1" max="25" value="8" style="width:100%;accent-color:#f59e0b" /><div style="display:flex;gap:8px;margin-top:12px;justify-content:center"><button id="__sc" style="background:#f59e0b;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">OK</button><button id="__sx" style="background:#374151;color:#9ca3af;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer">Cancel</button></div>';
              document.body.appendChild(popup);
              const rng = popup.querySelector('#__sr') as HTMLInputElement;
              const lbl = popup.querySelector('#__sv')!;
              rng.oninput = () => { lbl.textContent = rng.value + ' Hz'; };
              popup.querySelector('#__sc')!.addEventListener('click', () => {
                document.body.removeChild(popup);
                const block: StrobeBlock = { id: `sb-${Date.now()}`, time: ftSelRef.current.start, endTime: ftSelRef.current.end, speed: Number(rng.value) };
                const fixture = patchedFixtures[ftMenu.trackIdx];
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
              popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5);min-width:260px';
              popup.innerHTML = '<div style="color:#22c55e;font-size:13px;font-weight:600;margin-bottom:10px">Movement</div><select id="__mp" style="width:100%;background:#1f1f2e;border:1px solid #374151;border-radius:6px;padding:6px;color:#d1d5db;font-size:12px;margin-bottom:8px"><option value="sweep">Sweep</option><option value="circle">Circle</option><option value="bounce">Bounce</option><option value="wave">Wave</option><option value="figure8">Figure-8</option><option value="zigzag">Zigzag</option><option value="diamond">Diamond</option><option value="spiral">Spiral</option><option value="heartbeat">Heartbeat</option><option value="randomWalk">Random Walk</option><option value="panOnly">Pan Only</option><option value="tiltOnly">Tilt Only</option><option value="static">Static</option></select><div id="__mv" style="color:#22c55e;font-size:18px;font-weight:700;margin:8px 0">80</div><input id="__ma" type="range" min="20" max="200" value="80" style="width:100%;accent-color:#22c55e" /><div style="display:flex;gap:8px;margin-top:12px;justify-content:center"><button id="__mc" style="background:#22c55e;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">OK</button><button id="__mx" style="background:#374151;color:#9ca3af;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer">Cancel</button></div>';
              document.body.appendChild(popup);
              const sel = popup.querySelector('#__mp') as HTMLSelectElement;
              const rng = popup.querySelector('#__ma') as HTMLInputElement;
              const lbl = popup.querySelector('#__mv')!;
              rng.oninput = () => { lbl.textContent = rng.value; };
              popup.querySelector('#__mc')!.addEventListener('click', () => {
                document.body.removeChild(popup);
                const block: MovementBlock = { id: `mb-${Date.now()}`, time: ftSelRef.current.start, endTime: ftSelRef.current.end, pattern: sel.value as MovementBlock['pattern'], amplitude: Number(rng.value) };
                const fixture = patchedFixtures[ftMenu.trackIdx];
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
              const fixture = patchedFixtures[ftMenu.trackIdx];
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
                <span className="text-gray-300 font-medium">{tooltip.efxEntry.effectName}</span>
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
      {/* ── Color Lane ── */}
      <div className="relative flex border-t-2 border-pink-900/40 bg-[#0a0a0f] overflow-hidden select-none" style={{ height: 40, paddingLeft: LABEL_WIDTH }}>
        <div className="absolute left-0 top-0 w-[90px] h-full flex items-center px-2 bg-[#0d0d18] z-10 border-r-2 border-pink-900/30">
          <span className="text-[10px] text-pink-400 font-bold tracking-wide">🎨 COLORS</span>
        </div>
        <div className="flex-1 relative h-full">
          {(colorEntries && colorEntries.length > 0 ? colorEntries : cues.filter(c => c.color).map((cue, i) => ({
            id: `cue-color-${i}`,
            time: cue.time,
            endTime: cues[i + 1]?.time || duration,
            color: cue.color,
          }))).map(ce => {
            const leftPct = (ce.time / duration) * 100;
            const widthPct = ((ce.endTime - ce.time) / duration) * 100;
            const wPct = Math.max(widthPct, 0.4);
            return (
              <div key={ce.id}
                className="absolute top-0 h-full flex items-center justify-center cursor-pointer hover:brightness-125 transition-all shadow-lg"
                style={{
                  left: `${leftPct}%`,
                  width: `${wPct}%`,
                  background: `linear-gradient(180deg, ${ce.color}dd, ${ce.color}88)`,
                  borderLeft: '1px solid rgba(255,255,255,0.15)',
                  borderRight: '1px solid rgba(255,255,255,0.1)',
                }}
              >
              </div>
            );
          })}
        </div>
      </div>
      {/* ── Strobe Lane ── */}
      <div className="relative flex border-t-2 border-amber-900/40 bg-[#0a0a0f] overflow-hidden select-none" style={{ height: 28, paddingLeft: LABEL_WIDTH }}>
        <div className="absolute left-0 top-0 w-[90px] h-full flex items-center px-2 bg-[#0d0d18] z-10 border-r-2 border-amber-900/30">
          <span className="text-[10px] text-amber-400 font-bold tracking-wide">⚡ STROBE</span>
        </div>
        <div className="flex-1 relative h-full">
          {(strobeEntries && strobeEntries.length > 0 ? strobeEntries : cues.filter(c => c.strobe).map((cue, i) => ({
            id: `cue-strobe-${i}`,
            time: cue.time,
            endTime: cues[i + 1]?.time || duration,
            speed: 10,
          }))).map(se => {
            const leftPct = (se.time / duration) * 100;
            const widthPct = ((se.endTime - se.time) / duration) * 100;
            return (
              <div key={se.id}
                className="absolute top-0 h-full flex items-center justify-center cursor-pointer border-r border-white/10 hover:brightness-125 transition-all"
                style={{
                  left: `${leftPct}%`,
                  width: `${Math.max(widthPct, 0.4)}%`,
                  background: 'repeating-linear-gradient(90deg, rgba(251,191,36,0.8) 0px, rgba(251,191,36,0.8) 3px, transparent 3px, transparent 6px)',
                }}
              >
                <span className="text-[9px] text-amber-200 font-bold drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">⚡</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* ── Dimmer Lane ── */}
      <div className="relative flex border-t border-gray-800/50 bg-[#0a0a0f] overflow-hidden select-none" style={{ height: 50, paddingLeft: LABEL_WIDTH }}>
        <div className="absolute left-0 top-0 w-[90px] h-full flex items-center px-2 bg-[#0a0a0f] z-10 border-r border-gray-800/50">
          <span className="text-[10px] text-cyan-400 font-semibold">💡 DIMMER</span>
        </div>
        <div className="flex-1 relative h-full">
          {(dimmerEntries && dimmerEntries.length > 0
            ? dimmerEntries
            : cues.map((cue, i) => ({
                id: `cue-dimmer-${i}`,
                time: cue.time,
                endTime: cues[i + 1]?.time || duration,
                value: Math.round(intensityToValue(cue.intensity) * 255),
              }))
          ).map(de => {
            const leftPct = (de.time / duration) * 100;
            const widthPct = ((de.endTime - de.time) / duration) * 100;
            const pct = Math.round(de.value / 255 * 100);
            const barH = Math.max(4, (de.value / 255) * 40);
            return (
              <div key={de.id}
                className="absolute bottom-1 flex flex-col items-center cursor-pointer border-r border-white/5 hover:brightness-110 transition-all"
                style={{
                  left: `${leftPct}%`,
                  width: `${Math.max(widthPct, 0.5)}%`,
                }}
              >
                {/* vertical bar proportional to intensity */}
                <div
                  className="w-[70%] rounded-t-sm"
                  style={{
                    height: barH,
                    background: `linear-gradient(180deg, rgba(6,182,212,${0.3 + pct/100 * 0.6}) 0%, rgba(6,182,212,0.15) 100%)`,
                    borderTop: pct > 0 ? '1px solid rgba(6,182,212,0.6)' : 'none',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
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
            <div className="flex justify-end gap-2">
              <button onClick={() => setGradientPicker(null)} className="px-4 py-2 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">Annuler</button>
              <button onClick={() => {
                if (!gradientPicker) return;
                const { endColor } = gradientPicker;
                const block = { id: 'cb-' + Date.now(), time: ftSelRef.current.start, endTime: ftSelRef.current.end, color: endColor };
                const fixture = patchedFixtures[gradientPicker.trackIdx];
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

    </div>
  );
};

export default TrackTimeline;
