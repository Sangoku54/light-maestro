
import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { clampRect } from '../components/clampedpopup';
import { useTranslation } from 'react-i18next';
import { Save, FolderOpen, Download, RefreshCw, Undo2, Redo2, Trash2, Zap, ZapOff, Pencil, Plus, Palette, Sun, Layers, Upload, Music, Crosshair, Snowflake, Sparkles } from 'lucide-react';
import { useAppStore, type CustomPalette, type ColorPreset } from '../stores/appStore';
import { useShowStore, type PatchedFixture, type SongPreset, type View3DState } from '../stores/showStore';
import { useClockStore } from '../stores/clockStore';
import { AudioFileUpload, useAudioFileLoader } from '../hooks/useAudioFileLoader';
import { TrackAnalysis, TrackSection, SECTION_COLORS, keyToPalette, SectionAnalysis, AtmosphereType } from '../hooks/audio-analysis';
import type { GenreProfile } from '../hooks/audio-analysis';
import { computeFixtureTrackOverrides, computeEfxOverrides, type FixtureTrack } from '../hooks/fixture-tracks';
import { loadFixtureDefinitions, clearFixtureDefCache, type DmxCue, type DmxFixtureDefinition } from '../hooks/dmx-cues';
import { useDmxPlayback, computeDmxForCue, computeColorTrackColors, type ColorTrackRef, type DimmerTrackRef, computeDimmerTrackOverrides, computeStrobeTrackOverrides, computeChaserTrackOverrides, type ChaserTrackRef } from '../hooks/dmx-playback';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { halfDegToDmxOffset, SPATIAL_BY_SECTION } from '../engine/dmx-movement';
import { DEFAULT_ROSTER, normalizeRoster, type MusicianRoster } from '../utils/musicians';
import { importCustomFixtureDefs } from '../utils/custom-fixtures';
import { MasterClockBar } from '../components/MasterClockBar';
import type { StageScene } from '../stores/showStore';
import { AutoLoopsPanel } from './AutoLoopsPanel';
import { Stage3D } from './Stage3D';
import TrackTimeline from './TrackTimeline';
import type { EfxTrack, EfxTrackEntry, ColorTrack, ColorTrackEntry, StrobeTrack, StrobeTrackEntry, DimmerTrack, DimmerTrackEntry, ChaserTrack, ChaserTrackEntry, ShowTrack, ShowTrackEntry, SceneTrack, SceneTrackEntry } from './TrackTimeline';

type EnrichedCue = DmxCue;

/* ─── PromptModal ─────────────────────────────────────────
 * Electron 21+ no longer supports window.prompt(). This inline
 * modal replaces it for the few places that ask for a name.
 */
const PromptModal: React.FC<{
  title: string;
  initial?: string;
  placeholder?: string;
  onCancel: () => void;
  onOk: (value: string) => void;
}> = ({ title, initial = '', placeholder = '', onCancel, onOk }) => {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = () => { if (value.trim()) onOk(value.trim()); };
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div
        className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[320px] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-gray-200 mb-3">{title}</p>
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={placeholder}
          className="w-full px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-200 outline-none focus:border-purple-500/60"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1 rounded text-xs text-gray-400 hover:bg-gray-800/60 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            className="px-3 py-1 rounded text-xs font-medium bg-purple-600/40 text-purple-200 hover:bg-purple-600/60 border border-purple-500/40 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Helpers ──────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

/* ─── Preset DMX cue baking (widget "Play Preset" snapshot) ───
 * Bakes ALL timeline track types (fixture / color / strobe / dimmer / efx)
 * into a static cue snapshot, so the Virtual Console widget plays the preset
 * exactly as authored in QuickShow (including user-added tracks).
 */
function buildPresetDmxCues(
  currentCues: any[],
  pf: any[],
  uni: any[],
  fDefs: Map<string, any>,
  tierMultipliers: { primary: number; secondary: number; tertiary: number },
  fixtureTracksRef: React.MutableRefObject<FixtureTrack[]>,
  colorTracksRef: React.MutableRefObject<ColorTrack[]>,
  strobeTracksRef: React.MutableRefObject<StrobeTrack[]>,
  dimmerTracksRef: React.MutableRefObject<DimmerTrackRef[]>,
  efxTracksRef: React.MutableRefObject<EfxTrack[]>,
  effectsRef: React.MutableRefObject<any[]>,
  fixtureGroupsRef: React.MutableRefObject<{ id: string; fixtureIds: string[] }[]>,
  chaserTracksRef: React.MutableRefObject<ChaserTrackRef[]>,
  chasersRef: React.MutableRefObject<any[]>,
  scenesRef: React.MutableRefObject<any[]>,
): DmxCue[] {
  const out: DmxCue[] = [];
  if (!(currentCues.length > 0 && pf.length > 0 && fDefs.size > 0)) return out;
  const uniIds = uni.map((u: any) => String(u.id));
  const fg = fixtureGroupsRef.current as any;

  // Precompute pan/tilt channel offsets per fixture (only needed for EFX tracks)
  const hasEfx = efxTracksRef.current.length > 0;
  const fxOffsets = hasEfx
    ? (() => {
        const m = new Map<string, { pan: number[]; tilt: number[]; universeIdx: number }>();
        for (const pfx of pf) {
          const def = fDefs.get(pfx.fixtureDefId);
          if (!def) continue;
          const fa = analyzeChannels(pfx, def);
          const uIdx = uniIds.indexOf(String(pfx.universeId));
          m.set(pfx.id, { pan: fa.panOffsets, tilt: fa.tiltOffsets, universeIdx: uIdx < 0 ? 0 : uIdx });
        }
        return m;
      })()
    : null;

  for (const cue of currentCues) {
    try {
      const overrides = computeFixtureTrackOverrides(fixtureTracksRef.current, cue.time, pf, fg);
      const ctc = computeColorTrackColors(colorTracksRef.current as any, cue.time, pf, fg);
      const sto = computeStrobeTrackOverrides(strobeTracksRef.current as any, cue.time, pf, fg);
      const dto = computeDimmerTrackOverrides(dimmerTracksRef.current as any, cue.time, pf, fg);
      const cho = computeChaserTrackOverrides(chaserTracksRef.current as any, chasersRef.current as any, scenesRef.current as any, cue.time, pf, fg);
      const efxPt = hasEfx
        ? computeEfxOverrides(efxTracksRef.current as any, cue.time, effectsRef.current, pf, fg)
        : null;
      const computed = computeDmxForCue(cue, pf, fDefs, uni as any, tierMultipliers, overrides, ctc, sto, dto, undefined, undefined, cho);
      for (const c of computed) {
        const channelValues: Record<number, number> = { ...c.channelValues };
        // Apply EFX track pan/tilt overrides (not handled by computeDmxForCue)
        if (efxPt && efxPt.size > 0 && fxOffsets) {
          for (const pfx of pf) {
            const pt = efxPt.get(pfx.id);
            if (!pt) continue;
            const off = fxOffsets.get(pfx.id);
            if (!off || off.universeIdx !== c.universe) continue;
            for (const po of off.pan) channelValues[pfx.startAddress + po] = pt.pan;
            for (const to of off.tilt) channelValues[pfx.startAddress + to] = pt.tilt;
          }
        }
        out.push({ time: cue.time, section: cue.section, universe: c.universe, channelValues, fixtureNames: [], fixtureCount: 0, effect: cue.effect, colors: cue.colors || [] });
      }
    } catch { /* skip individual cue errors */ }
  }
  return out;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function rotateHue(hex: string, degree: number): string {
  const [r, g, b] = hexToRgb(hex);
  const hsl = (r2: number, g2: number, b2: number): [number, number, number] => {
    const max = Math.max(r2, g2, b2), min = Math.min(r2, g2, b2);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l / 255];
    const d = max - min;
    const s = l > 127.5 ? d / (510 - max - min) : d / (max + min);
    let h2 = 0;
    if (max === r2) h2 = ((g2 - b2) / d + (g2 < b2 ? 6 : 0)) * 60;
    else if (max === g2) h2 = ((b2 - r2) / d + 2) * 60;
    else h2 = ((r2 - g2) / d + 4) * 60;
    return [h2, s, l / 255];
  };
  const [h, s, l] = hsl(r, g, b);
  const newH = (h + degree + 360) % 360;
  const toRgb = (h2: number, s2: number, l2: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * l2 - 1)) * s2;
    const x = c * (1 - Math.abs(((h2 / 60) % 2) - 1));
    const m = l2 - c / 2;
    let r3 = 0, g3 = 0, b3 = 0;
    if (h2 < 60) { r3 = c; g3 = x; b3 = 0; }
    else if (h2 < 120) { r3 = x; g3 = c; b3 = 0; }
    else if (h2 < 180) { r3 = 0; g3 = c; b3 = x; }
    else if (h2 < 240) { r3 = 0; g3 = x; b3 = c; }
    else if (h2 < 300) { r3 = x; g3 = 0; b3 = c; }
    else { r3 = c; g3 = 0; b3 = x; }
    return [Math.round((r3 + m) * 255), Math.round((g3 + m) * 255), Math.round((b3 + m) * 255)];
  };
  const [nr, ng, nb] = toRgb(newH, s, l);
  return '#' + [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
}

function complementaryPair(hex: string): [string, string] {
  return [hex, rotateHue(hex, 180)];
}

function resolvePaletteColors(paletteName: string, cfg?: any): string[] {
  const autoKey = cfg?.detectedKey;
  const autoPal = autoKey ? keyToPalette[autoKey] : undefined;
  const pal = paletteName === 'auto' ? (autoPal || 'party') : paletteName;

  const palettes: Record<string, string[]> = {
    ballad: ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#e8baff'],
    dance: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'],
    disco: ['#ff0a54', '#ff7096', '#ffd60a', '#5cf64a', '#00b4d8', '#7209b7'],
    techno: ['#00ff88', '#00c8ff', '#6400ff', '#ff0064', '#00e5ff', '#cc00ff'],
    rock: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'],
    rnb: ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c084fc', '#ff99cc'],
    reggaeton: ['#facc15', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#f97316'],
    latino: ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#ec4899', '#facc15'],
    electro: ['#00ffff', '#ff00ff', '#ffff00', '#ff8800', '#00ff88', '#cc00ff'],
    house: ['#ff0064', '#ffc800', '#00c8ff', '#00ff88', '#a855f7', '#ff4500'],
    dubstep: ['#00ffaa', '#8b00ff', '#ff0044', '#00d4ff', '#ff8800', '#ccff00'],
    hiphop: ['#ff6600', '#ffcc00', '#ff0064', '#00c8ff', '#6400ff', '#ff0088'],
    funk: ['#ff0064', '#ffc800', '#00ff88', '#ff6600', '#6400ff', '#ffcc00'],
    warm: ['#ffb347', '#ff7f50', '#ff6347', '#ffd700', '#ff8c00', '#dc143c'],
    cool: ['#00bfff', '#1e90ff', '#7b68ee', '#00ced1', '#3cb371', '#4682b4'],
    party: ['#ff0064', '#ffc800', '#00c8ff', '#00ff88', '#6400ff', '#ff4500'],
    monochrome: ['#ffffff', '#e5e5e5', '#cccccc', '#999999', '#666666', '#333333'],
    neon: ['#ff0064', '#00ffcc', '#cc00ff', '#ffff00', '#00ff88', '#ff6600'],
    pastel: ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#e8baff'],
  };

  return palettes[pal] || palettes['dance'];
}

function getSectionProfile(section: string, cfg: any): {
  intensity: string;
  colors: string[];
  color: string;
  strobe: boolean;
  movement: string;
  colorTemp: 'warm' | 'neutral' | 'cool';
  strobeProbability: number;
  dimmerPulseOnBeat: boolean;
} {
  const pal = resolvePaletteColors(cfg.colorScheme || 'auto', cfg);
  const baseIntensity: Record<string, string> = {
    intro: 'low', verse: 'medium', chorus: 'high', bridge: 'low', drop: 'very-high', outro: 'low', build: 'medium',
  };
  const baseStrobe: Record<string, boolean> = {
    intro: false, verse: false, chorus: true, bridge: false, drop: true, outro: false, build: false,
  };
  const baseMovement: Record<string, string> = {
    intro: 'static', verse: 'sweep', chorus: 'circle', bridge: 'figure8', drop: 'bounce', outro: 'sweep', build: 'spiral',
  };
  const baseColorTemp: Record<string, string> = {
    intro: 'cool', verse: 'neutral', chorus: 'warm', bridge: 'cool', drop: 'warm', outro: 'cool', build: 'neutral',
  };
  const sectionColors = cfg.customPalette?.[section] && cfg.customPalette[section].length > 0
    ? cfg.customPalette[section]
    : pal;
  return {
    intensity: cfg.sectionAware ? (baseIntensity[section] || 'medium') : cfg.intensity || 'dynamic',
    colors: sectionColors,
    color: sectionColors[0] || '#ff0064',
    strobe: cfg.sectionAware ? (baseStrobe[section] || false) : false,
    movement: cfg.sectionAware ? (baseMovement[section] || 'sweep') : (({ smooth: 'wave', sharp: 'zigzag', dynamic: 'sweep' } as Record<string, string>)[cfg.movement] || cfg.movement || 'sweep'),
    colorTemp: (baseColorTemp[section] || 'neutral') as 'warm' | 'neutral' | 'cool',
    strobeProbability: baseStrobe[section] ? 0.8 : 0.2,
    dimmerPulseOnBeat: section === 'drop' || section === 'chorus',
  };
}

function getBeatInterval(bpm: number, beatDivision: number): number {
  return (60 / bpm) * (4 / beatDivision);
}

function generateEffects(
  section: string,
  time: number,
  bpm: number,
  beatDivision: number,
  cfg: any,
): any[] {
  const profile = getSectionProfile(section, cfg);
  const interval = getBeatInterval(bpm, beatDivision);
  const effects: any[] = [];
  if (profile.strobe) {
    effects.push({ time, type: 'strobe', speed: bpm * 2 });
  }
  if (profile.dimmerPulseOnBeat) {
    effects.push({ time, type: 'dimmer-pulse', bpm, interval });
  }
  return effects;
}

function applySectionChange(
  sections: TrackSection[],
  startTime: number,
  endTime: number,
  newType: TrackSection['type'],
): TrackSection[] {
  const sorted = [...sections].sort((a, b) => a.startTime - b.startTime);
  const newSections: TrackSection[] = [];
  for (const s of sorted) {
    if (s.endTime <= startTime || s.startTime >= endTime) {
      newSections.push({ ...s });
      continue;
    }
    if (s.startTime < startTime) {
      newSections.push({ ...s, endTime: startTime });
    }
    newSections.push({
      type: newType,
      startTime: Math.max(s.startTime, startTime),
      endTime: Math.min(s.endTime, endTime),
      energy: s.energy,
      color: SECTION_COLORS[newType] || '#4b5563',
    });
    if (s.endTime > endTime) {
      newSections.push({ ...s, startTime: endTime });
    }
  }
  return newSections.sort((a, b) => a.startTime - b.startTime);
}

/** Merge adjacent sections of the same type into one continuous section */
function mergeAdjacentSections(sections: TrackSection[]): TrackSection[] {
  if (sections.length <= 1) return sections;
  const sorted = [...sections].sort((a, b) => a.startTime - b.startTime);
  const merged: TrackSection[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.type === s.type && last.endTime >= s.startTime - 0.01) {
      // Extend the last section instead of pushing a new one
      last.endTime = Math.max(last.endTime, s.endTime);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function expandEntityToCues(
  entityType: string,
  entityId: string,
  startTime: number,
  endTime: number,
  sections: TrackSection[],
  bpm: number,
  beatDivision: number,
  cfg: any,
  scenes: any[],
  chasers: any[],
  cueLists: any[],
  effects: any[],
): any[] {
  const cues: any[] = [];
  const dur = endTime - startTime;
  const interval = getBeatInterval(bpm, beatDivision);

  if (entityType === 'scene') {
    const scene = scenes.find((s: any) => s.id === entityId);
    if (scene) {
      for (let t = startTime; t < endTime; t += interval) {
        cues.push({
          time: t,
          section: 'scene',
          effect: scene.name,
          intensity: 'high',
          colors: ['#ffffff'],
          color: '#ffffff',
          strobe: false,
          entityId,
          entityType: 'scene',
        });
      }
    }
  } else if (entityType === 'chaser') {
    const chaser = chasers.find((c: any) => c.id === entityId);
    if (chaser && chaser.steps.length > 0) {
      const stepDur = dur / chaser.steps.length;
      chaser.steps.forEach((step: any, i: number) => {
        cues.push({
          time: startTime + i * stepDur,
          section: 'chaser',
          effect: `${chaser.name}/${step.sceneId}`,
          intensity: 'high',
          colors: ['#ff0064'],
          color: '#ff0064',
          strobe: true,
          entityId,
          entityType: 'chaser',
        });
      });
    }
  } else if (entityType === 'cuelist') {
    const cl = cueLists.find((c: any) => c.id === entityId);
    if (cl && cl.cues.length > 0) {
      const cueDur = dur / cl.cues.length;
      cl.cues.forEach((cue: any, i: number) => {
        cues.push({
          time: startTime + i * cueDur,
          section: 'cuelist',
          effect: `${cl.name} #${i + 1}`,
          intensity: 'high',
          colors: ['#ff0064'],
          color: '#ff0064',
          strobe: false,
          entityId,
          entityType: 'cuelist',
        });
      });
    }
  } else if (entityType === 'efx') {
    const efx = effects.find((e: any) => e.id === entityId);
    if (efx) {
      const numCues = Math.max(1, Math.floor(dur / interval));
      for (let i = 0; i < numCues; i++) {
        cues.push({
          time: startTime + i * interval,
          section: 'efx',
          effect: efx.name,
          intensity: 'high',
          colors: ['#00c8ff'],
          color: '#00c8ff',
          strobe: false,
          entityId,
          entityType: 'efx',
        });
      }
    }
  }


  return cues;
}

export function genCues(
  sections: TrackSection[],
  bpm: number,
  beatDivision: number,
  cfg: any,
  manualCues: DmxCue[],
  regenSeed?: number | string,
  analysis?: TrackAnalysis | null,
  scenes?: Array<{ id: string; name: string; channels: Record<number, number> }>,
): any[] {
  const cues: any[] = [];
  const interval = getBeatInterval(bpm, beatDivision);
  const genre = cfg.musicStyle || 'dance';
  const basePal = resolvePaletteColors(cfg.colorScheme || 'auto', cfg);
  const audioReactive = cfg.audioReactive !== false && !!analysis;

  // ── Audio feature helpers ──
  const getFrameIdx = (time: number): number => {
    if (!analysis?.duration) return -1;
    const curveLen = analysis.rmsCurve?.length || 100;
    return Math.min(curveLen - 1, Math.max(0, Math.floor((time / analysis.duration) * curveLen)));
  };
  const getFeature = (time: number) => {
    const fi = getFrameIdx(time);
    if (fi < 0) return null;
    return {
      rms: analysis!.rmsCurve?.[fi] ?? 0.5,
      centroid: analysis!.spectralCentroidCurve?.[fi] ?? 0.5,
      onset: analysis!.onsetCurve?.[fi] ?? 0,
      energy: analysis!.energyCurve?.[fi] ?? 0.5,
      bass: analysis!.lowCurve?.[fi] ?? 0.3,
      mid: analysis!.midCurve?.[fi] ?? 0.3,
      high: analysis!.highCurve?.[fi] ?? 0.3,
    };
  };
  const isDownbeat = (time: number): boolean => {
    if (!analysis?.downbeats) return false;
    for (const db of analysis.downbeats) { if (Math.abs(db - time) < 0.06) return true; }
    return false;
  };
  const getBeatIndex = (time: number): number => {
    if (!analysis?.beats) return -1;
    for (let i = 0; i < analysis.beats.length; i++) {
      if (Math.abs(analysis.beats[i] - time) < 0.06) return i;
    }
    return -1;
  };

  if (audioReactive) {
    // ═══════════════════════════════════════════════════════
    // AUDIO-REACTIVE ENGINE v2
    // ═══════════════════════════════════════════════════════
    const seedSrc = sections.map(s => s.type + s.startTime).join('') + (regenSeed ?? '');
    const rng = mulberry32(hash(seedSrc));
    let prevColor = basePal[0];
    let prevIntensity = 'medium';
    let cueGlobalIdx = 0; // across all sections, guarantees palette[3] (green) is reached
    // ── Transitions de section : fondu d'intensité sur les 2 premiers beats ──
    // À un changement de section, le dimmer démarre à l'intensité de la section
    // précédente et rejoint progressivement la cible (fini les snaps aux frontières).
    const INTENSITY_SCORE: Record<string, number> = { 'very-low': 0.1, low: 0.25, medium: 0.5, high: 0.8, 'very-high': 0.95 };
    const scoreToIntensity = (s: number): string =>
      s >= 0.875 ? 'very-high' : s >= 0.65 ? 'high' : s >= 0.375 ? 'medium' : s >= 0.175 ? 'low' : 'very-low';
    let prevSectionIntensity: number | null = null;
    let lastSectionType = '';

    // ── Genre + atmosphere extraction for movement selection ──
    // cfg.musicStyle explicitly overrides detected genre
    let detectedGenre = 'dance', detectedAtmosphere = '';
    try {
      const g = analysis ? JSON.parse(analysis.genre || '{}') : {};
      detectedGenre = cfg.musicStyle || g.genre || genre;
      detectedAtmosphere = analysis?.atmosphere || '';
    } catch { detectedGenre = genre; }

    // ── Movement pattern selector: audio-driven, genre-aware ──
    const selectMovementPattern = (secType: string, featRms: number, featCentroid: number, featBass: number, isBeatStrong: boolean, isDropAnticipation: boolean, cueIdx: number): string => {
      // Pool of patterns per section type
      const pools: Record<string, string[]> = {
        intro:  ['static', 'panOnly', 'tiltOnly', 'wave'],
        verse:  ['sweep', 'wave', 'figure8', 'randomWalk', 'tiltOnly'],
        chorus: ['circle', 'diamond', 'spiral', 'sweep', 'figure8'],
        bridge: ['static', 'figure8', 'wave', 'randomWalk'],
        drop:   ['bounce', 'heartbeat', 'zigzag', 'diamond', 'circle'],
        outro:  ['sweep', 'wave', 'randomWalk', 'panOnly'],
        build:  ['sweep', 'figure8', 'spiral', 'circle', 'pulse'],
      };
      let pool = pools[secType] || ['sweep', 'circle', 'wave'];

      // Genre bias: add/remove patterns based on genre character
      switch (detectedGenre) {
        case 'techno':    pool = [...pool, 'circle', 'spiral']; pool = pool.filter(p => p !== 'randomWalk'); break;
        case 'house':     pool = [...pool, 'circle', 'wave']; break;
        case 'dubstep':   pool = [...pool, 'heartbeat', 'zigzag']; pool = pool.filter(p => p !== 'static' && p !== 'panOnly'); break;
        case 'drum_and_bass': pool = [...pool, 'zigzag', 'bounce']; pool = pool.filter(p => p !== 'static'); break;
        case 'hiphop':    pool = [...pool, 'static', 'panOnly']; pool = pool.filter(p => p !== 'circle' && p !== 'spiral'); break;
        case 'rock':      pool = [...pool, 'zigzag', 'randomWalk']; break;
        case 'metal':     pool = [...pool, 'zigzag', 'diamond', 'heartbeat']; pool = pool.filter(p => p !== 'static' && p !== 'wave'); break;
        case 'ballad':    pool = [...pool, 'static', 'panOnly']; pool = pool.filter(p => p !== 'zigzag' && p !== 'bounce'); break;
        case 'funk':      pool = [...pool, 'figure8', 'wave']; break;
        case 'disco':     pool = [...pool, 'circle', 'diamond']; break;
        case 'rnb':       pool = [...pool, 'wave', 'tiltOnly']; break;
        case 'electro':   pool = [...pool, 'diamond', 'spiral']; break;
        case 'jazz':      pool = [...pool, 'randomWalk', 'static']; pool = pool.filter(p => p !== 'zigzag' && p !== 'bounce'); break;
        case 'reggaeton': pool = [...pool, 'bounce', 'heartbeat']; break;
      }

      // Atmosphere bias
      switch (detectedAtmosphere) {
        case 'energetic':  pool = [...pool, 'circle', 'diamond']; break;
        case 'dark':       pool = [...pool, 'spiral', 'wave']; pool = pool.filter(p => p !== 'circle' && p !== 'diamond'); break;
        case 'aggressive': pool = [...pool, 'zigzag', 'heartbeat', 'bounce']; pool = pool.filter(p => p !== 'static' && p !== 'wave' && p !== 'panOnly'); break;
        case 'dreamy':     pool = [...pool, 'wave', 'spiral']; pool = pool.filter(p => p !== 'zigzag' && p !== 'bounce' && p !== 'heartbeat'); break;
        case 'groovy':     pool = [...pool, 'figure8', 'wave', 'circle']; break;
        case 'epic':       pool = [...pool, 'spiral', 'diamond', 'circle']; break;
        case 'uplifting':  pool = [...pool, 'circle', 'wave', 'sweep']; break;
      }

      // Movement style bias (menu 'smooth'/'sharp'/'dynamic') — applied on top of genre/atmosphere
      if (cfg.movement === 'smooth') {
        pool = pool.filter(p => !['zigzag','heartbeat','bounce','diamond'].includes(p));
        if (pool.length === 0) pool = ['wave','sweep','figure8','static'];
      } else if (cfg.movement === 'sharp') {
        pool = pool.filter(p => !['static','panOnly','wave','tiltOnly'].includes(p));
        if (pool.length === 0) pool = ['zigzag','heartbeat','bounce','diamond'];
      }

      // BPM bias: fast→more aggressive, slow→more gentle
      if (detectedGenre === 'dubstep' || detectedGenre === 'drum_and_bass' || bpm > 150) {
        if (!isDropAnticipation) pool = pool.filter(p => p !== 'static');
      }
      if (bpm < 85) {
        pool = pool.filter(p => p !== 'zigzag' && p !== 'heartbeat' && p !== 'bounce');
        if (!pool.includes('static')) pool.push('static');
      }

      // Audio feature bias: centroid/energy/rms influence selection
      if (isBeatStrong && (featRms > 0.5 || isDropAnticipation)) {
        const strongPrefs = ['bounce', 'heartbeat', 'zigzag', 'diamond', 'circle'];
        const hasStrong = pool.some(p => strongPrefs.includes(p));
        if (hasStrong && !isDropAnticipation) pool = pool.filter(p => p !== 'static' && p !== 'panOnly');
      }
      if (featRms < 0.2 && !isDropAnticipation) {
        pool = pool.filter(p => p !== 'bounce' && p !== 'zigzag' && p !== 'heartbeat');
        if (!pool.includes('static')) pool.push('static');
      }

      // Dedupe and select — varie par cue (i) pour éviter la monotonie intra-section
      const deduped = [...new Set(pool)];
      // Ajoute square/pulse aux pools où ils manquaient (chorus/drop)
      if (secType === 'chorus' && !deduped.includes('square')) deduped.push('square');
      if (secType === 'drop' && !deduped.includes('pulse')) deduped.push('pulse');
      const hashKey = `${secType}_${detectedGenre}_${detectedAtmosphere}_${regenSeed ?? 0}_${cueIdx}`;
      const h = hash(hashKey);
      // Resélection forcée toutes les 6 cues pour éviter qu'une section entière reste sur le même pattern
      const jitter = (cueIdx % 6 === 0) ? (cueIdx * 7) : 0;
      const idx = Math.abs(h + jitter + Math.floor(featRms * 7 + featCentroid * 11 + rng() * 13) + cueIdx * 3) % deduped.length;
      return deduped[idx];
    };

    // Spatial choreography selector: per-section stage gesture (wave/circle/expand/...).
    // The real stage positions turn the chosen movement into a scene-wide pattern
    // (vague L-R, cercle, expansion depuis le centre, alternance pair/impair).
    const selectSpatialPattern = (secType: string, featRms: number, movement: string): string => {
      // Ne coupe jamais totalement l'intro — même en statique, une vague lente reste plus vivante que 'off'
      if (featRms < 0.15) return 'off';
      if (movement === 'static' && secType === 'intro') return 'wave';
      if (secType === 'verse' && featRms > 0.55) return 'circle';
      if (secType === 'drop' && detectedGenre === 'house') return 'circle';
      return SPATIAL_BY_SECTION[secType] || 'off';
    };

    // Detect build→drop boundary for anticipation effect
    const dropStartTimes = new Set<number>();
    for (let si = 1; si < sections.length; si++) {
      if (sections[si].type === 'drop' && sections[si-1].type === 'build') {
        dropStartTimes.add(sections[si].startTime);
      }
    }

    // --- Differenciation par section (palette, cycle, intensite, strobe) ---
    // Identite visuelle propre a chaque type de section : les autres logiciels
    // (SoundSwitch, ShowKontrol...) varient couleurs + energie + densite par
    // section ; ici on fixe des palettes/cycles/boost dedies.
    const DEFAULT_SECTION_PALETTES: Record<string, string[]> = {
      intro:  ['#334155', '#475569', '#64748b', '#1e293b'],
      verse:  ['#1e90ff', '#00ced1', '#4682b4', '#0ea5e9'],
      chorus: ['#ff0064', '#ffc800', '#ff4500', '#ff8c00'],
      bridge: ['#7b68ee', '#8a2be2', '#4b0082', '#a855f7'],
      drop:   ['#ff0000', '#ff6600', '#ffff00', '#ff2d2d'],
      outro:  ['#1e3a5f', '#223a5e', '#1a2744'],
      build:  ['#ff8c00', '#ff4500', '#ff0064', '#ffaa00'],
    };
    const SECTION_CYCLE_MULT: Record<string, number> = { intro: 0.4, verse: 0.7, chorus: 1.4, bridge: 0.5, drop: 1.8, outro: 0.3, build: 1.0 };
    const SECTION_INTENSITY_BOOST: Record<string, number> = { intro: 0.8, verse: 0.9, chorus: 1.1, drop: 1.3, outro: 0.7, bridge: 0.85, build: 1.05 };
    const SECTION_STROBE_PROB: Record<string, number> = { drop: 0.9, chorus: 0.6, build: 0.35 };
    // Densite par section : les tiers de fixtures actives (couches).
    // Intro = rien que le primary -> le show respire ; drop = tout le monde.
    const ACTIVE_TIERS: Record<string, string[]> = {
      intro: ['primary'],
      verse: ['primary', 'secondary'],
      chorus: ['primary', 'secondary', 'tertiary'],
      bridge: ['primary'],
      build: ['primary', 'secondary'],
      drop: ['primary', 'secondary', 'tertiary'],
      outro: ['primary'],
    };

    for (const section of sections) {
      const dur = section.endTime - section.startTime;
      // Per-section custom palette override
      // Palette : override custom > palette auto par section > base palette.
      // La palette par section ne sapplique que sur colorScheme auto (defaut) ;
      // un schema choisi par l'utilisateur garde son identite sur toutes les sections.
      const sectionPal = (cfg.customPalette?.[section.type]?.length > 0)
        ? cfg.customPalette[section.type]
        : (cfg.colorScheme === 'auto' && DEFAULT_SECTION_PALETTES[section.type])
          ? DEFAULT_SECTION_PALETTES[section.type]
          : basePal;
      const numCues = Math.max(1, Math.floor(dur / interval));
      const isNextDrop = dropStartTimes.has(section.endTime);

      for (let i = 0; i < numCues; i++) {
        const t = section.startTime + i * interval;
        if (t >= section.endTime) break;

        const feat = getFeature(t);
        const onDownbeat = isDownbeat(t);
        const beatIdx = getBeatIndex(t);
        const beatStrong = beatIdx >= 0 && analysis!.beatStrengths?.[beatIdx] === 'strong';

        // Règle 1 : RMS → intensité réelle (sauf si l'utilisateur force un niveau via le menu Intensité)
        const rms = feat?.rms ?? 0.5;
        // Boost nominal par section : a mix egal, un drop atteint very-high
        // bien plus tot qu un intro (seuils RMS decales).
        const rmsInt = Math.min(1, rms * (SECTION_INTENSITY_BOOST[section.type] ?? 1));
        let intensity: string;
        if (cfg.intensity && cfg.intensity !== 'dynamic') {
          intensity = cfg.intensity; // niveau forcé (very-low…very-high) — 'dynamic' = piloté par l'audio
        } else if (rmsInt > 0.75) intensity = 'very-high';
        else if (rmsInt > 0.50) intensity = 'high';
        else if (rmsInt > 0.25) intensity = 'medium';
        else if (rmsInt > 0.10) intensity = 'low';
        else intensity = 'very-low';

        const centroid = feat?.centroid ?? 0.5;
        const onset = feat?.onset ?? 0;
        const bassRatio = feat ? feat.bass / Math.max(0.01, feat.mid + feat.high) : 1;

        // Règle 2 : Downbeat → guaranteed full palette cycle
        // Each downbeat advances to the next color, centroid biases ±20% (neighbor swap)
        const changeNow = onDownbeat || onset > 0.2 || i === 0;
        // Strobe piloté par l'énergie ET l'attaque réelle du beat : un pic d'onset
        // (attaque percussive) déclenche le flash même hors « beatStrong », et un
        // onset très fort (peak drop) déclenche sur toute section énergique.
        // Sinon, retombe sur la règle historique (drop/chorus/build + beat fort + rms).
        const onsetTriggersStrobe = onset > 0.55;
        const isStrongSection = (section.type === 'drop' || section.type === 'chorus' || section.type === 'build');
        const strobe =
          (isStrongSection && beatStrong && rms > 0.35) ||
          (onsetTriggersStrobe && (isStrongSection || rms > 0.5));

        // Règle 3 : Drop anticipation (build→drop)
        const beatsUntilDrop = isNextDrop ? Math.floor((section.endTime - t) / (60 / bpm)) : 999;
        const dropAnticipation = beatsUntilDrop <= 2 && beatsUntilDrop >= 0;

        // Section energy curve
        const sectionProgress = dur > 0 ? (t - section.startTime) / dur : 0;
        let sectionEnergyMult = 1;
        switch (section.type) {
          case 'intro': sectionEnergyMult = 0.3 + sectionProgress * 0.4; break;
          case 'verse': sectionEnergyMult = 0.5 + sectionProgress * 0.3; break;
          case 'chorus': sectionEnergyMult = 0.8 + Math.sin(sectionProgress * Math.PI) * 0.2; break;
          case 'drop': sectionEnergyMult = 0.9 + Math.sin(sectionProgress * Math.PI) * 0.1; break;
          case 'bridge': sectionEnergyMult = 0.4 + Math.sin(sectionProgress * Math.PI) * 0.3; break;
          case 'build': sectionEnergyMult = 0.4 + sectionProgress * (dropAnticipation ? 0.7 : 0.55); break;
          case 'outro': sectionEnergyMult = 0.3 + (1 - sectionProgress) * 0.3; break;
        }

        // Color cycle: plus varié par cue — centre sur le temps ET l'index de cue, pas seulement la progression
        const colorCycleSpeed = (0.5 + centroid * 1.5 + rms * 2.0) * (SECTION_CYCLE_MULT[section.type] ?? 1);
        const sectionProgressNorm = dur > 0 ? (t - section.startTime) / dur : 0;
        const cueJitter = (i * 5 + (beatStrong ? 2 : 0) + Math.floor(rng() * 5)) % sectionPal.length;
        const paletteIdx = (Math.floor(sectionProgressNorm * sectionPal.length * colorCycleSpeed) + cueJitter) % sectionPal.length;
        prevColor = sectionPal[paletteIdx];
        // Accent couleur sur les forts temps : pousse vers une couleur chaude/froide selon centroid
        if (beatStrong && sectionPal.length > 1) {
          const accentIdx = centroid > 0.6 ? 0 : centroid < 0.35 ? sectionPal.length - 1 : paletteIdx;
          if (rng() < 0.35) prevColor = sectionPal[accentIdx];
        }
        // Gradient interpolation: blend start→end color across section duration
        const gradient = cfg.customGradients?.[section.type] as { start: string; end: string } | undefined;
        if (gradient && gradient.start !== gradient.end) {
          const [sr, sg, sb] = hexToRgb(gradient.start);
          const [er, eg, eb] = hexToRgb(gradient.end);
          const t = sectionProgressNorm;
          const rr = Math.round(sr + (er - sr) * t);
          const rg = Math.round(sg + (eg - sg) * t);
          const rb = Math.round(sb + (eb - sb) * t);
          prevColor = '#' + [rr, rg, rb].map(v => v.toString(16).padStart(2, '0')).join('');
        }
        // Transition d'intensité entre sections : fondu sur 2 beats (fade-in)
        // depuis l'intensité de la fin de la section précédente (pas de snap).
        let fadedIntensity = intensity;
        if (lastSectionType !== section.type) {
          prevSectionIntensity = (lastSectionType === '') ? null : (INTENSITY_SCORE[prevIntensity] ?? 0.5);
          lastSectionType = section.type;
        }
        if (prevSectionIntensity !== null) {
          const fadeT = Math.min(1, (t - section.startTime) / (2 * interval));
          const targetScore = INTENSITY_SCORE[intensity] ?? 0.5;
          fadedIntensity = scoreToIntensity(prevSectionIntensity + (targetScore - prevSectionIntensity) * fadeT);
        }
        prevIntensity = fadedIntensity;

        // Energy: RMS + section + drop anticipation boost
        let energy = Math.max(0.05, Math.min(0.99, rms * sectionEnergyMult * 0.85 + 0.15));
        if (dropAnticipation) {
          // Anticipation: energy dips slightly before the drop
          energy = Math.max(0.1, energy * (1 - (beatsUntilDrop / 2) * 0.3));
        }

        const colorTemp: 'warm' | 'neutral' | 'cool' =
          centroid < 0.35 ? 'warm' : centroid > 0.65 ? 'cool' : 'neutral';

        // Movement: audio-driven, genre-aware pattern selection
        const movement = selectMovementPattern(section.type, rms, centroid, bassRatio, beatStrong, dropAnticipation, i);

        // Amplitude: DMX-scale (0-255), audio-driven, section-scaled + jitter par cue pour éviter l'uniformité
        // Center is 128, so amplitude=128 means full edge-to-edge sweep.
        // Values capped at 128 to prevent DMX overflow (excess just saturates at 0/255).
        const baseAmp = (() => {
          switch (section.type) {
            case 'intro': return 50 + rms * 78;           // 50-130 DMX
            case 'outro': return 40 + rms * 60;           // 40-100 DMX
            case 'verse': return 80 + rms * 48;          // 80-180 DMX
            case 'chorus': return 90 + bassRatio * 38;   // 110-220 DMX
            case 'drop': return 100 + bassRatio * 28;     // 140-250 DMX (near full sweep)
            case 'bridge': return 60 + rms * 68;           // 60-140 DMX
            case 'build': return dropAnticipation
              ? 100 + (1 - beatsUntilDrop / 2) * 28       // ramps 160→240 before drop
              : 60 + sectionProgress * 68;                // ramps 70→230 across section
            default: return 80;
          }
        })();
        const ampJitter = (Math.sin(i * 1.7) * 12 + (rng() - 0.5) * 16); // ±12-16 DMX par cue
        const movementAmplitude = Math.min(128, Math.max(12, Math.round(baseAmp + ampJitter)));

        const movementSpeed = (() => {
          const baseSpeed = 0.3 + centroid * 0.6;
          const jitter = (Math.sin(i * 2.3) * 0.12 + (rng() - 0.5) * 0.1); // ±0.12 par cue
          let s = baseSpeed + jitter;
          if (beatStrong) s *= 1.2;
          if (dropAnticipation) s *= 1.5; // speed up before drop
          return Math.max(0.15, Math.min(2.5, s));
        })();

        cues.push({
          time: t,
          section: section.type,
          effect: `${section.type} #${i + 1}`,
          intensity: dropAnticipation && !(cfg.intensity && cfg.intensity !== 'dynamic') ? 'high' : prevIntensity,
          colors: sectionPal,
          color: prevColor,
          strobe: dropAnticipation ? false : strobe, // no strobe during anticipation
          energy,
          movement,
          movementAmplitude,
          movementSpeed,
          spatialPattern: selectSpatialPattern(section.type, energy, movement),
          colorTemp,
          strobeProbability: dropAnticipation ? 0 : (SECTION_STROBE_PROB[section.type] ?? (beatStrong ? 0.8 : 0.15)),
          dimmerPulseOnBeat: section.type === 'drop' || section.type === 'chorus',
          activeTiers: ACTIVE_TIERS[section.type],
          musicStyle: genre,
          dropAnticipation: dropAnticipation || undefined,
        });
      }
    }
  } else {
    // ═══════════════════════════════════════════════════════
    // LEGACY: cycle-based (non-audio-reactive)
    // ═══════════════════════════════════════════════════════
    const seedSrc = genre + (cfg.colorScheme || '') + sections.map(s => s.type + s.startTime).join('') + (regenSeed ?? '');
    const rng = mulberry32(hash(seedSrc));

    for (const section of sections) {
      const profile = getSectionProfile(section.type, cfg);
      const customColors = cfg.customPalette?.[section.type];
      const sectionPal = (customColors && customColors.length > 0) ? customColors : basePal;

      const dur = section.endTime - section.startTime;
      const numCues = Math.max(1, Math.floor(dur / interval));
      const beatOffset = Math.floor(rng() * 4);

      const sectionEnergyMap: Record<string, number> = {
        intro: 0.15, verse: 0.35, chorus: 0.7, bridge: 0.2, drop: 0.95, outro: 0.1, build: 0.5,
      };

      for (let i = 0; i < numCues; i++) {
        const t = section.startTime + i * interval;
        if (t >= section.endTime) break;

        const baseEnergy = sectionEnergyMap[section.type] ?? 0.4;
        const energy = baseEnergy + rng() * 0.2;
        const colorIdx = i % sectionPal.length;
        const color = sectionPal[colorIdx];

        cues.push({
          time: t,
          section: section.type,
          effect: `${section.type} #${i + 1}`,
          intensity: profile.intensity,
          colors: sectionPal,
          color,
          strobe: profile.strobe && (i + beatOffset) % Math.max(1, Math.floor(4 / beatDivision)) === 0,
          energy: Math.max(0.05, Math.min(0.99, energy)),
          movement: profile.movement,
          spatialPattern: SPATIAL_BY_SECTION[section.type] ?? 'off',
          colorTemp: profile.colorTemp,
          strobeProbability: profile.strobeProbability,
          dimmerPulseOnBeat: profile.dimmerPulseOnBeat,
          musicStyle: genre,
        });
      }
    }
  }

  // Manual cues (override) - common to both paths
  if (manualCues && manualCues.length > 0) {
    for (const mc of manualCues) {
      cues.push({
        time: mc.time,
        section: mc.section || 'manual',
        effect: mc.effect || 'Manual',
        intensity: 'high',
        colors: mc.colors,
        color: mc.colors[0] || '#ffffff',
        strobe: false,
        energy: 0.8,
        movement: 'static',
        colorTemp: 'neutral' as const,
        strobeProbability: 0,
        dimmerPulseOnBeat: false,
        musicStyle: genre,
        manual: true,
      });
    }
  }

  // Injecte les scènes utilisateur si activé (30% pondération par défaut)
  if (cfg?.useScenesInAutoscript && Array.isArray(scenes) && scenes.length > 0) {
    const weight = Math.max(0, Math.min(100, cfg.scenesAutoscriptWeight ?? 30)) / 100;
    for (const cue of cues) {
      if (Math.random() < weight) {
        const sc = scenes[Math.floor(Math.random() * scenes.length)];
        if (sc && sc.channels && Object.keys(sc.channels).length > 0) {
          // Extrait une couleur dominante de la scène (moyenne des canaux RGB si >3 canaux, sinon couleur brute)
          const vals = Object.values(sc.channels) as number[];
          const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
          const isBright = avg > 80;
          // Si la scène a beaucoup de canaux allumés (>6), on la considère comme 'scène complexe' et on l'injecte en forcedColor
          const hex = `rgb(${Math.round(80+Math.random()*175)},${Math.round(40+Math.random()*120)},${Math.round(120+Math.random()*135)})`;
          // Heuristique simple : si la scène a un nom, on l'utilise comme effet
          (cue as any).forcedSceneId = sc.id;
          (cue as any).forcedSceneName = sc.name;
          // On force une couleur issue de la scène (teinte stable par scène → hex, car le canvas fait `color + '80'` → hsl+80 crash)
          const h = sc.name.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % 360;
          const hslToHex = (hh:number,s:number,l:number):string=>{const c=(1-Math.abs(2*l/100-1))*s/100;const x=c*(1-Math.abs((hh/60)%2-1));const m=l/100-c/2;let r=0,g=0,b=0;if(hh<60){r=c;g=x;}else if(hh<120){r=x;g=c;}else if(hh<180){g=c;b=x;}else if(hh<240){g=x;b=c;}else if(hh<300){r=x;b=c;}else{r=c;b=x;}const toHex=(v:number)=>Math.round((v+m)*255).toString(16).padStart(2,'0');return `#${toHex(r)}${toHex(g)}${toHex(b)}`;};
          cue.colors = [hslToHex(h,75,55), hslToHex((h+30)%360,70,50)];
          cue.color = cue.colors[0];
          if (isBright) cue.intensity = 'high';
        }
      }
    }
  }

  const sorted = cues.sort((a, b) => a.time - b.time);
  const deduped: typeof sorted = [];
  for (const cue of sorted) {
    const last = deduped[deduped.length - 1];
    if (!last || cue.time - last.time > 0.01) {
      deduped.push(cue);
    }
  }
  return deduped;
}

async function saveProject(
  analysis: TrackAnalysis | null,
  sections: TrackSection[],
  qs: any,
  audioFile: ReturnType<typeof useAudioFileLoader>,
  manualCues: DmxCue[],
  efxTracks: EfxTrack[],
  fixtureTracks: FixtureTrack[],
  colorTracks: ColorTrack[],
  strobeTracks: StrobeTrack[],
  dimmerTracks: DimmerTrack[],
  chaserTracks: ChaserTrack[],
  showTracks: ShowTrack[],
  sceneTracks: SceneTrack[],
  disabledFixtures: Set<string>,
): Promise<void> {
  if (!analysis) return;
  const data: any = {
    analysis,
    sections,
    quickShow: { ...qs, regenSeed: (qs as any).regenSeed ?? 0 },
    manualCues,
    efxTracks,
    colorTracks,
    strobeTracks,
    dimmerTracks,
    chaserTracks,
    showTracks,
    sceneTracks,
    fixtureTracks,
    disabledFixtures: [...disabledFixtures],
    audioFileName: analysis.fileName,
    timestamp: new Date().toISOString(),
    version: 1,
  };
  // Include audio base64 for full export
  const file = audioFile.file;
  if (file) {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx > 0) data.audioDataBase64 = dataUrl.slice(commaIdx + 1);
    } catch (e) { console.error('Failed to encode audio for export:', e); }
  }

  // ── Auto-save to localStorage for next launch ──
  // Exclude audioDataBase64 - it can be 10+ MB and exceeds localStorage quota
  const { audioDataBase64: _, ...localData } = data;
  try {
    localStorage.setItem('light-maestro:lastProject', JSON.stringify(localData));
    console.log('[saveProject] Auto-saved to localStorage');
  } catch (e) {
    // localStorage full - try without large arrays
    try {
      const slim = { ...localData, manualCues: [], efxTracks: [], colorTracks: [], strobeTracks: [], dimmerTracks: [], chaserTracks: [], fixtureTracks: [] };
      localStorage.setItem('light-maestro:lastProject', JSON.stringify(slim));
      console.log('[saveProject] Auto-saved (slim) to localStorage');
    } catch (e2) {
      console.warn('[saveProject] Could not auto-save: localStorage full');
    }
  }

  // ── File download ──
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${analysis.fileName.replace(/\.[^.]+$/, '')}.lmpreset`;
  a.click();
  URL.revokeObjectURL(url);
}

async function saveShow(sections: TrackSection[], qs: any, efxTracks: EfxTrack[], colorTracks: ColorTrack[], strobeTracks: StrobeTrack[], dimmerTracks: DimmerTrack[], chaserTracks: ChaserTrack[], showTracks: ShowTrack[], sceneTracks: SceneTrack[], fixtureTracks: FixtureTrack[]) {
  const data = { sections, quickShow: qs, efxTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks, fixtureTracks, timestamp: new Date().toISOString(), version: 1 };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `lightmaestro-show-${Date.now()}.lmshow`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadProject(
  setQs: (qs: any) => void,
  audioFile: ReturnType<typeof useAudioFileLoader>,
  setSections: (secs: TrackSection[]) => void,
  setManualCues: (cues: DmxCue[]) => void,
  setEfxTracks: (tracks: EfxTrack[]) => void,
  setFixtureTracks: (tracks: FixtureTrack[]) => void,
  setColorTracks: (tracks: ColorTrack[]) => void,
  setStrobeTracks: (tracks: StrobeTrack[]) => void,
  setDimmerTracks: (tracks: DimmerTrack[]) => void,
  setChaserTracks: (tracks: ChaserTrack[]) => void,
  setShowTracks: (tracks: ShowTrack[]) => void,
  setSceneTracks: (tracks: SceneTrack[]) => void,
  setDisabledFixtures?: (ids: Set<string>) => void,
  setFixtureDefsRef?: React.Dispatch<React.SetStateAction<Map<string, DmxFixtureDefinition>>>,
): Promise<void> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.lmpreset,.lmshow,.lmproj';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) { resolve(); return; }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // Ré-importer les fixtures custom embarquées dans le fichier (.lmproj /
        // .lmshow) AVANT que les fixtures patchées ne résolvent leurs
        // définitions (getDefinition). Sans cet import, def = fallback seul
        // mode (déjà corrigé), voire analyse vide pour les fixtures dont le
        // modeIndex > 0 (canaux [] → aucune chaîne écrite en lecture).
        try {
          await importCustomFixtureDefs(data.customFixtures);
        } catch (e3) {
          console.warn('importCustomFixtureDefs failed in loadProject:', e3);
        }
        // Rafraîchir les définitions : l'import custom ci-dessus (addCustom)
        // vient d'enrichir la bibliothèque. Le useEffect de preload tourné au
        // mount ne capturerait pas ces defs → fixtures en fallback (analyses
        // vides). On invalide le cache et on re-résout proprement.
        if (setFixtureDefsRef) {
          try {
            clearFixtureDefCache();
            const ids = [...new Set(useShowStore.getState().patchedFixtures.map((f: any) => f?.fixtureDefId).filter(Boolean))];
            const defs = await loadFixtureDefinitions(ids);
            setFixtureDefsRef(defs);
          } catch (e4) {
            console.warn('reload fixture defs failed in loadProject:', e4);
          }
        }
        if (data.quickShow) setQs(data.quickShow);
        // Set preset name from file
        const importedPresetName = data.quickShow?.name || file.name.replace(/\.(lmpreset|lmshow|lmproj)$/i, '');
        useAppStore.getState().setPresetName(importedPresetName);
        if (data.sections) setSections(data.sections);
        if (data.manualCues) setManualCues(data.manualCues);
        if (data.efxTracks) setEfxTracks(data.efxTracks);
        if (data.colorTracks) setColorTracks(data.colorTracks);
        if (data.strobeTracks) setStrobeTracks(data.strobeTracks);
        if (data.dimmerTracks) setDimmerTracks(data.dimmerTracks);
        if (data.chaserTracks) setChaserTracks(data.chaserTracks);
        if (data.showTracks) setShowTracks(data.showTracks);
        if (data.sceneTracks) setSceneTracks(data.sceneTracks);
        if (data.fixtureTracks) setFixtureTracks(data.fixtureTracks);
        if (setDisabledFixtures) setDisabledFixtures(data.disabledFixtures ? new Set(data.disabledFixtures) : new Set());
        if (data.analysis) {
          if (data.audioDataBase64) {
            try {
              const dataUrl = `data:audio/mpeg;base64,${data.audioDataBase64}`;
              await audioFile.restoreWithAudio(data.analysis, dataUrl);
            } catch (e2) {
              console.error('restoreWithAudio failed in loadProject:', e2);
              audioFile.restoreAnalysis(data.analysis);
            }
          } else {
            audioFile.restoreAnalysis(data.analysis);
          }
        }
      } catch (e) {
        console.error('Failed to load project:', e);
      }
      resolve();
    };
    inp.click();
  });
}

/* ─── Chip component ────────────────────────────────── */

const Chip: React.FC<{
  active?: boolean;
  onClick?: () => void;
  label: string;
  color?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  tooltip?: string;
}> = ({ active, onClick, label, color, icon, disabled, tooltip }) => (
  <button
    title={tooltip}
    disabled={disabled}
    onClick={onClick}
    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
      active
        ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
        : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:bg-gray-700/50 hover:text-gray-300'
    } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
  >
    {icon && <span className="text-[11px]">{icon}</span>}
    {label}
  </button>
);

/* ─── ColorTrackInsertMenu ────────────────────────── */

const COLOR_PALETTE = ['#FF0000','#FF6600','#FFCC00','#00FF00','#00FFFF','#0066FF','#9900FF','#FF00FF','#FFFFFF','#FF9999','#99FF99','#99CCFF','#FFB366','#FF66B2','#66FFB2','#B266FF'];

/** Identifie une entrée EFX par son id stable quand elle existe, sinon par time+endTime (anciens saves). */
export const sameEfxEntry = (a: EfxTrackEntry, b: EfxTrackEntry): boolean =>
  (a.id && b.id) ? a.id === b.id : (a.time === b.time && a.endTime === b.endTime);

/* ─── QuickShowView wrapper ─────────────────────────── */

export const QuickShowView: React.FC<{ audioFile: ReturnType<typeof useAudioFileLoader> }> = ({ audioFile }) => {
  const { t } = useTranslation();
  const tab = useAppStore(s => s.quickSidebarTab);
  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div style={{ display: tab === 'autoscript' ? 'flex' : 'none' }} className="h-full flex-col">
        <AutoScriptPanel audioFile={audioFile} />
      </div>
      <div style={{ display: tab === 'colors' ? 'flex' : 'none' }} className="h-full flex-col">
        <ColorPresetsPanel />
      </div>
      <div style={{ display: tab === 'loops' ? 'flex' : 'none' }} className="h-full flex-col">
        <AutoLoopsPanel />
      </div>
    </div>
  );
};

/* ─── ColorPresetsPanel ────────────────────────────── */

const BUILTIN_PALETTES: Record<string, string> = {
  auto: 'Auto (clé détectée)', dance: 'Dance', disco: 'Disco', techno: 'Techno',
  rock: 'Rock', rnb: 'R&B', reggaeton: 'Reggaeton', latino: 'Latino',
  electro: 'Electro', house: 'House', dubstep: 'Dubstep', hiphop: 'Hip-Hop',
  funk: 'Funk', ballad: 'Ballad', warm: 'Warm', cool: 'Cool',
  neon: 'Neon', pastel: 'Pastel', monochrome: 'Monochrome', party: 'Party',
};

const SECTION_TYPES: (keyof CustomPalette)[] = ['intro', 'verse', 'chorus', 'bridge', 'drop', 'outro', 'build'];

const ColorPresetsPanel: React.FC = () => {
  const { t } = useTranslation();
  const qs = useAppStore(s => s.quickShow);
  const setQs = useAppStore(s => s.setQuickShow);
  const setCustomPalette = useAppStore(s => s.setCustomPalette);
  const clearCustomPalette = useAppStore(s => s.clearCustomPalette);
  const addColorPreset = useAppStore(s => s.addColorPreset);
  const deleteColorPreset = useAppStore(s => s.deleteColorPreset);
  const [activeTab, setActiveTab] = useState<'live' | 'sections' | 'presets'>('live');
  const [promptOpen, setPromptOpen] = useState(false);
  const presets = qs.colorPresets || [];
  const customPal = qs.customPalette || { intro: [], verse: [], chorus: [], bridge: [], drop: [], outro: [], build: [] };

  // Resolve active palette colors
  const activeColors = useMemo(
    () => resolvePaletteColors(qs.colorScheme || 'auto', { musicStyle: qs.musicStyle }),
    [qs.colorScheme, qs.musicStyle],
  );

  // Change a single color in the active palette (updates userPreset + switches to 'user' scheme)
  const handleActiveColorChange = useCallback((idx: number, color: string) => {
    const newColors = [...activeColors];
    newColors[idx] = color;
    setQs({ userPreset: newColors, colorScheme: 'user' });
  }, [activeColors, setQs]);

  // Add a color to the active palette
  const handleAddActiveColor = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = '#ffffff';
    inp.style.position = 'fixed';
    inp.style.opacity = '0';
    document.body.appendChild(inp);
    inp.click();
    inp.onchange = () => {
      document.body.removeChild(inp);
      setQs({ userPreset: [...activeColors, inp.value], colorScheme: 'user' });
    };
  }, [activeColors, setQs]);

  // Remove a color from the active palette
  const handleRemoveActiveColor = useCallback((idx: number) => {
    if (activeColors.length <= 1) return;
    const newColors = activeColors.filter((_, i) => i !== idx);
    setQs({ userPreset: newColors, colorScheme: 'user' });
  }, [activeColors, setQs]);

  // Change color scheme
  const handleColorSchemeChange = useCallback((scheme: string) => {
    setQs({
      colorScheme: scheme,
      // Reset userPreset when switching to a built-in palette so resolvePaletteColors works
      ...(scheme !== 'user' ? { userPreset: resolvePaletteColors(scheme, { musicStyle: qs.musicStyle }) } : {}),
    });
  }, [setQs, qs.musicStyle]);

  // Per-section: add a color
  const handleSectionAddColor = useCallback((sectionType: keyof CustomPalette) => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = SECTION_COLORS[sectionType] || '#ff0064';
    inp.style.position = 'fixed';
    inp.style.opacity = '0';
    document.body.appendChild(inp);
    inp.click();
    inp.onchange = () => {
      document.body.removeChild(inp);
      setCustomPalette({ [sectionType]: [...(customPal[sectionType] || []).slice(0, 5), inp.value] });
    };
  }, [customPal, setCustomPalette]);

  // Per-section: edit a color
  const handleSectionColorEdit = useCallback((sectionType: keyof CustomPalette, idx: number) => {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = (customPal[sectionType] || [])[idx] || '#ff0000';
    inp.style.position = 'fixed';
    inp.style.opacity = '0';
    document.body.appendChild(inp);
    inp.click();
    inp.onchange = () => {
      document.body.removeChild(inp);
      const arr = [...(customPal[sectionType] || [])];
      arr[idx] = inp.value;
      setCustomPalette({ [sectionType]: arr });
    };
  }, [customPal, setCustomPalette]);

  // Per-section: remove a color
  const handleSectionColorRemove = useCallback((sectionType: keyof CustomPalette, idx: number) => {
    const arr = (customPal[sectionType] || []).filter((_, i) => i !== idx);
    setCustomPalette({ [sectionType]: arr });
  }, [customPal, setCustomPalette]);

  // Per-section: reset
  const handleSectionReset = useCallback((sectionType: keyof CustomPalette) => {
    setCustomPalette({ [sectionType]: [] });
  }, [setCustomPalette]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="p-4 pb-0">
        <h2 className="text-lg font-semibold text-gray-200 mb-3 flex items-center gap-2">
          <Palette className="w-5 h-5 text-pink-400" />
          {t('sidebar.colorPresets') || 'Gestionnaire de Palette'}
        </h2>

        {/* Tab switcher */}
        <div className="flex gap-0.5 bg-gray-800/30 rounded-lg p-0.5 mb-4">
          {([
            ['live', 'Palette Active'],
            ['sections', 'Par Section'],
            ['presets', 'Presets'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                activeTab === key
                  ? 'bg-purple-600/30 text-purple-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Palette Active ── */}
      {activeTab === 'live' && (
        <div className="px-4 pb-4 space-y-4">
          {/* Color scheme selector */}
          <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-3">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-2">Style de Palette</label>
            <div className="flex flex-wrap gap-1">
              {Object.entries(BUILTIN_PALETTES).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => handleColorSchemeChange(key)}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    qs.colorScheme === key
                      ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                      : 'bg-gray-800/40 text-gray-400 border border-gray-700/30 hover:bg-gray-700/40'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Active palette preview */}
          <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                Couleurs Actives
                <span className="text-gray-600 ml-1">
                  ({qs.colorScheme === 'user' ? 'Personnalisé' : qs.colorScheme})
                </span>
              </label>
              <button
                onClick={handleAddActiveColor}
                className="px-2 py-0.5 rounded text-[10px] text-purple-400 border border-purple-500/30 hover:bg-purple-600/20 transition-colors"
              >
                + Ajouter
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {activeColors.map((color, i) => (
                <div key={i} className="relative group">
                  <button
                    onClick={() => {
                      const inp = document.createElement('input');
                      inp.type = 'color';
                      inp.value = color;
                      inp.style.position = 'fixed';
                      inp.style.opacity = '0';
                      document.body.appendChild(inp);
                      inp.click();
                      inp.onchange = () => {
                        document.body.removeChild(inp);
                        handleActiveColorChange(i, inp.value);
                      };
                    }}
                    className="w-10 h-10 rounded-full border-2 border-gray-600 hover:border-purple-400 hover:scale-110 transition-all cursor-pointer shadow-lg"
                    style={{ backgroundColor: color }}
                    title={`${color} - clic pour modifier`}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveActiveColor(i); }}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600/80 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                    title="Supprimer"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {/* Color hex list */}
            <div className="mt-3 flex flex-wrap gap-1">
              {activeColors.map((color, i) => (
                <code key={i} className="text-[9px] bg-gray-900/60 px-1.5 py-0.5 rounded text-gray-500 font-mono">
                  {color}
                </code>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Par Section ── */}
      {activeTab === 'sections' && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">
              Palette personnalisée par type de section
            </p>
            <button
              onClick={() => clearCustomPalette()}
              className="px-2 py-0.5 rounded text-[10px] text-red-400 border border-red-500/20 hover:bg-red-600/10 transition-colors"
            >
              Tout réinitialiser
            </button>
          </div>
          {SECTION_TYPES.map(st => {
            const colors = customPal[st] || [];
            const hasCustom = colors.length > 0;
            return (
              <div key={st} className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: SECTION_COLORS[st] || '#4b5563' }}
                    />
                    <span className="text-xs font-medium text-gray-300 capitalize">{st}</span>
                    {!hasCustom && (
                      <span className="text-[9px] text-gray-600">(palette globale)</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleSectionAddColor(st)}
                      className="px-2 py-0.5 rounded text-[10px] text-purple-400 border border-purple-500/30 hover:bg-purple-600/20 transition-colors"
                    >
                      + Couleur
                    </button>
                    {hasCustom && (
                      <button
                        onClick={() => handleSectionReset(st)}
                        className="px-2 py-0.5 rounded text-[10px] text-red-400 border border-red-500/20 hover:bg-red-600/10 transition-colors"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
                {hasCustom ? (
                  <div className="flex flex-wrap gap-2">
                    {colors.map((color, ci) => (
                      <div key={ci} className="relative group">
                        <button
                          onClick={() => handleSectionColorEdit(st, ci)}
                          className="w-9 h-9 rounded-full border-2 border-gray-600 hover:border-purple-400 hover:scale-110 transition-all cursor-pointer"
                          style={{ backgroundColor: color }}
                          title={`${color} - clic pour modifier`}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSectionColorRemove(st, ci); }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600/80 text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                          title="Supprimer"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 opacity-30">
                    {activeColors.slice(0, 4).map((color, i) => (
                      <span key={i} className="w-6 h-6 rounded-full border border-gray-700" style={{ backgroundColor: color }} />
                    ))}
                    <span className="text-[10px] text-gray-600 self-center ml-1">héritée</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Tab: Presets ── */}
      {activeTab === 'presets' && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">
              Vos palettes sauvegardées
            </p>
            <button
              onClick={() => setPromptOpen(true)}
              className="px-2 py-0.5 rounded text-[10px] text-purple-400 border border-purple-500/30 hover:bg-purple-600/20 transition-colors"
            >
              + Sauvegarder la palette active
            </button>
          </div>
          {presets.length === 0 ? (
            <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-6 text-center">
              <Palette className="w-8 h-8 text-gray-700 mx-auto mb-2" />
              <p className="text-xs text-gray-500">Aucun preset sauvegardé.</p>
              <p className="text-[10px] text-gray-600 mt-1">
                Créez une palette dans l'onglet « Palette Active », puis sauvegardez-la ici.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {presets.map(p => (
                <div key={p.id} className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {p.colors.slice(0, 6).map((c, i) => (
                        <span key={i} className="w-4 h-4 rounded-full border border-gray-600" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <span className="text-sm text-gray-300 flex-1">{p.name}</span>
                    <button
                      onClick={() => {
                        // Apply this preset: switch to user scheme with these colors
                        setQs({ userPreset: p.colors, colorScheme: 'user' });
                      }}
                      className="text-[10px] px-2 py-1 bg-purple-600/20 rounded text-purple-300 hover:bg-purple-600/30 transition-colors"
                    >
                      Appliquer
                    </button>
                    <button
                      onClick={() => deleteColorPreset(p.id)}
                      className="text-[10px] px-2 py-1 text-red-400 hover:bg-red-600/10 rounded transition-colors"
                    >
                      Supprimer
                    </button>
                  </div>
                  {/* Color hex codes */}
                  <div className="mt-2 flex flex-wrap gap-0.5">
                    {p.colors.map((c, i) => (
                      <code key={i} className="text-[8px] bg-gray-900/60 px-1 py-0.5 rounded text-gray-600 font-mono">{c}</code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-gray-800/30 mt-auto">
        <p className="text-[9px] text-gray-700">
          La palette par section remplace la palette active pour les sections concernées.
          Le panneau AutoScript permet aussi l'édition contextuelle.
        </p>
      </div>
      {promptOpen && (
        <PromptModal
          title="Nom du preset :"
          onCancel={() => setPromptOpen(false)}
          onOk={(name) => { addColorPreset(name, activeColors); setPromptOpen(false); }}
        />
      )}
    </div>
  );
};

/* ─── AutoScriptPanel ───────────────────────────────── */

const AutoScriptPanel: React.FC<{ audioFile: ReturnType<typeof useAudioFileLoader> }> = ({ audioFile }) => {
  const { t } = useTranslation();
  const qs = useAppStore(s => s.quickShow);
  const setQs = useAppStore(s => s.setQuickShow);
  const [sections, setSections] = useState<TrackSection[]>([]);
  const [key, setKey] = useState(0);
  const [picker, setPicker] = useState<{ idx: number; x: number; y: number } | null>(null);

  const [gradientPicker, setGradientPicker] = useState(null);  const a = audioFile.analysis;
  const [hasEverHadAnalysis, setHasEverHadAnalysis] = useState(false);
  if (a && !hasEverHadAnalysis) setHasEverHadAnalysis(true);
  const stableAnalysis = useRef(a);
  if (a) stableAnalysis.current = a;
  const resolvedAnalysis = a || stableAnalysis.current;

  // Sync detected genre from audio analysis to musicStyle
  useEffect(() => {
    const ga = resolvedAnalysis;
    if (!ga) return;
    try {
      const g = JSON.parse(ga.genre || '{}');
      if (g.genre && g.genre !== qs.musicStyle) {
        setQs({ musicStyle: g.genre });
      }
    } catch { /* ignore parse errors */ }
  }, [resolvedAnalysis]);

  const patchedFixtures = useShowStore(s => s.patchedFixtures);
  const fixtureGroups = useShowStore(s => s.fixtureGroups);
  const universes = useShowStore(s => s.universes);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [dmxOutputEnabled, setDmxOutputEnabled] = useState(true);
  const [dryRunMode, setDryRunMode] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  const forceDropRef = useRef(false);
  const [dmxCues, setDmxCues] = useState<DmxCue[]>([]);
  const dmxCuesRef = useRef<DmxCue[]>([]);
  const lastDmxCuesRef = useRef<DmxCue[]>([]);
  // A/B comparison
  const [cuesB, setCuesB] = useState<any[]>([]);
  const [showB, setShowB] = useState(false);
  const [compareStyle, setCompareStyle] = useState<string>('house');
  const lastEnrichedCuesRef = useRef<EnrichedCue[]>([]);
  const overrideCuesRef = useRef<DmxCue[]>([]);
  const [syncMode, setSyncMode] = useState<'internal' | 'manual' | 'tap'>('internal');
  const [manualBpm, setManualBpm] = useState(128);
  const [showForceColor, setShowForceColor] = useState(false);
  const forceColorRef = useRef<HTMLDivElement>(null);
  const [showScenePicker, setShowScenePicker] = useState(false);
  const [showChaserPicker, setShowChaserPicker] = useState(false);
  const scenePickerRef = useRef<HTMLDivElement>(null);
  const chaserPickerRef = useRef<HTMLDivElement>(null);
  // Electron 21+ has no window.prompt() — inline modal for preset naming
  const [promptAction, setPromptAction] = useState<'save' | 'export' | null>(null);
  const [manualCues, setManualCues] = useState<DmxCue[]>([]);
  const [disabledFixtures, setDisabledFixtures] = useState<Set<string>>(new Set());
  const disabledFixturesRef = useRef<Set<string>>(new Set());
  // Vue 3D par preset (pont + musiciens)
  const [qsMusicians, setQsMusicians] = useState<MusicianRoster>(DEFAULT_ROSTER);
  const [qsStageScene, setQsStageScene] = useState<StageScene>('rear-front');
  // Camera + toolbar state of the floating 3D view. Persisted with the preset
  // so that reloading the preset restores the view the user configured.
  const [qsView3D, setQsView3D] = useState<View3DState | undefined>(undefined);
  disabledFixturesRef.current = disabledFixtures;
  const [efxTracks, setEfxTracks] = useState<EfxTrack[]>([]);
  const [colorTracks, setColorTracks] = useState<ColorTrack[]>([]);
  const colorTracksRef = useRef<ColorTrack[]>([]);
  colorTracksRef.current = colorTracks;
  const [strobeTracks, setStrobeTracks] = useState<StrobeTrack[]>([]);
  const strobeTracksRef = useRef<StrobeTrack[]>([]);
  strobeTracksRef.current = strobeTracks;
  const [dimmerTracks, setDimmerTracks] = useState<DimmerTrack[]>([]);
  const dimmerTracksRef = useRef<DimmerTrackRef[]>([]);
  dimmerTracksRef.current = dimmerTracks as any;
  const [chaserTracks, setChaserTracks] = useState<ChaserTrack[]>([]);
  const chaserTracksRef = useRef<ChaserTrackRef[]>([]);
  chaserTracksRef.current = chaserTracks as any;
  const [showTracks, setShowTracks] = useState<ShowTrack[]>([]);
  const showTracksRef = useRef<ShowTrack[]>([]);
  showTracksRef.current = showTracks as any;
  const [sceneTracks, setSceneTracks] = useState<SceneTrack[]>([]);
  const sceneTracksRef = useRef<SceneTrack[]>([]);
  sceneTracksRef.current = sceneTracks as any;
  const [fixtureTracks, setFixtureTracks] = useState<FixtureTrack[]>([]);
  const fixtureTracksRef = useRef<FixtureTrack[]>([]);
  fixtureTracksRef.current = fixtureTracks;
  const fixtureGroupsRef = useRef<{ id: string; fixtureIds: string[] }[]>([]);
  fixtureGroupsRef.current = useShowStore.getState().fixtureGroups;
  const chasersRef = useRef<any[]>([]);
  chasersRef.current = useShowStore.getState().chasers;
  const scenesRef = useRef<any[]>([]);
  scenesRef.current = useShowStore.getState().scenes;
  const showsRef = useRef<any[]>([]);
  showsRef.current = useShowStore.getState().shows;
  const efxTracksRef = useRef<EfxTrack[]>([]);
  efxTracksRef.current = efxTracks;
  const panTiltLimitsRef = useRef<{ pan: number; tilt: number; perFixture?: Record<string, { pan: number; tilt: number }> }>({ pan: 128, tilt: 128, perFixture: {} });
  panTiltLimitsRef.current = {
    pan: halfDegToDmxOffset(qs.panMaxDeg ?? 270, 'pan'),
    tilt: halfDegToDmxOffset(qs.tiltMaxDeg ?? 90, 'tilt'),
    perFixture: Object.fromEntries(
      patchedFixtures.map(pf => {
        const degPan = qs.forcedPanMaxDeg?.[pf.id] ?? qs.panMaxDeg ?? 270;
        const degTilt = qs.forcedTiltMaxDeg?.[pf.id] ?? qs.tiltMaxDeg ?? 90;
        return [pf.id, { pan: halfDegToDmxOffset(degPan, 'pan'), tilt: halfDegToDmxOffset(degTilt, 'tilt') }];
      }),
    ),
  };
  const effectsRef = useRef<any[]>([]);
  effectsRef.current = useShowStore.getState().effects;

  const setForcedPanMax = useCallback((fixtureId: string, deg: number | null) => {
    const m = { ...(qs.forcedPanMaxDeg || {}) };
    if (deg === null) delete m[fixtureId]; else m[fixtureId] = deg;
    setQs({ forcedPanMaxDeg: m });
  }, [qs.forcedPanMaxDeg, setQs]);
  const setForcedTiltMax = useCallback((fixtureId: string, deg: number | null) => {
    const m = { ...(qs.forcedTiltMaxDeg || {}) };
    if (deg === null) delete m[fixtureId]; else m[fixtureId] = deg;
    setQs({ forcedTiltMaxDeg: m });
  }, [qs.forcedTiltMaxDeg, setQs]);

  const fixtureDefsRef = useRef<Map<string, DmxFixtureDefinition>>(new Map());
  const cuesRef = useRef<any[]>([]);
  const [efxContextMenu, setEfxContextMenu] = useState<{ trackId: string; time: number; x: number; y: number } | null>(null);
  const [efxEntryMenu, setEfxEntryMenu] = useState<{ trackId: string; entry: EfxTrackEntry; x: number; y: number } | null>(null);
  const efxContextRef = useRef<HTMLDivElement>(null);
  const efxEntryMenuRef = useRef<HTMLDivElement>(null);

  const sceneEntities = useShowStore(s => s.scenes);
  const chaserEntities = useShowStore(s => s.chasers);
  const cueListEntities = useShowStore(s => s.cueLists);
  const effectEntities = useShowStore(s => s.effects).filter((e: any) => !e.id.startsWith('builtin-efx-'));
  const entitySceneList = useMemo(() => sceneEntities.map(s => ({ id: s.id, name: s.name })), [sceneEntities]);
  const entityChaserList = useMemo(() => chaserEntities.map(c => ({ id: c.id, name: c.name })), [chaserEntities]);
  const entityCueListList = useMemo(() => cueListEntities.map(cl => ({ id: cl.id, name: cl.name })), [cueListEntities]);
  const entityEffectList = useMemo(() => effectEntities.map(e => ({ id: e.id, name: e.name })), [effectEntities]);

  useEffect(() => {
    (window as any).__lm_loadAudioFile = async (file: File) => { await audioFile.loadFile(file); audioFile.play(); };
    (window as any).__lm_triggerPlay = () => { if (audioFile.isPlaying) audioFile.pause(); else audioFile.play(); };
    (window as any).__lm_setDmxCues = (cues: DmxCue[]) => { dmxCuesRef.current = cues; setDmxCues(cues); };
    (window as any).__lm_setQuickShow = (qs: any) => { setQs(qs); };
    return () => {
      delete (window as any).__lm_loadAudioFile;
      delete (window as any).__lm_triggerPlay;
      delete (window as any).__lm_setDmxCues;
      delete (window as any).__lm_setQuickShow;
    };
  }, [audioFile, a, sections, qs, setQs, setSections, manualCues, efxTracks, setEfxTracks]);

  const [tapBpm, setTapBpm] = useState(0);
  const tapRef = useRef<number[]>([]);
  const [fixtureDefs, setFixtureDefs] = useState<Map<string, DmxFixtureDefinition>>(new Map());

  // Moving-head fixtures (those with pan/tilt channels) — for per-head limit overrides
  const movingHeads = useMemo(() => {
    return patchedFixtures.filter(pf => {
      const def = fixtureDefs.get(pf.fixtureDefId);
      if (!def) return false;
      const fa = analyzeChannels(pf, def);
      return (fa.panOffsets?.length || 0) > 0 || (fa.tiltOffsets?.length || 0) > 0;
    });
  }, [patchedFixtures, fixtureDefs]);

  const firedRef = useRef<Set<string>>(new Set());

  /* ─── Undo/redo ──────────────────────────────────── */
  const undoHistoryRef = useRef<{ sections: TrackSection[]; manual: DmxCue[]; efx: EfxTrack[]; fixtureTracks: FixtureTrack[]; colorTracks: ColorTrack[]; strobeTracks: StrobeTrack[]; dimmerTracks: DimmerTrack[]; chaserTracks: ChaserTrack[]; showTracks: ShowTrack[]; sceneTracks: SceneTrack[]; disabledFixtures: Set<string> }[]>([]);
  const redoHistoryRef = useRef<{ sections: TrackSection[]; manual: DmxCue[]; efx: EfxTrack[]; fixtureTracks: FixtureTrack[]; colorTracks: ColorTrack[]; strobeTracks: StrobeTrack[]; dimmerTracks: DimmerTrack[]; chaserTracks: ChaserTrack[]; showTracks: ShowTrack[]; sceneTracks: SceneTrack[]; disabledFixtures: Set<string> }[]>([]);
  const canUndo = undoHistoryRef.current.length > 0;
  const canRedo = redoHistoryRef.current.length > 0;

  const pushHistory = useCallback(() => {
    undoHistoryRef.current.push({
      sections: [...sections],
      manual: [...manualCues],
      efx: [...efxTracks],
      fixtureTracks: [...fixtureTracks],
      colorTracks: [...colorTracks],
      strobeTracks: [...strobeTracks],
      dimmerTracks: [...dimmerTracks],
      chaserTracks: [...chaserTracks],
      showTracks: [...showTracks],
      sceneTracks: [...sceneTracks],
      disabledFixtures: new Set(disabledFixtures),
    });
    redoHistoryRef.current = [];
  }, [sections, manualCues, efxTracks, fixtureTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks, disabledFixtures]);

    const restoreState = (state: any) => {
    setSections(state.sections);
    setManualCues(state.manual);
    setEfxTracks(state.efx);
    setFixtureTracks(state.fixtureTracks);
    setColorTracks(state.colorTracks);
    setStrobeTracks(state.strobeTracks);
    setDimmerTracks(state.dimmerTracks);
    setChaserTracks(state.chaserTracks || []);
    setShowTracks(state.showTracks || []);
    setSceneTracks(state.sceneTracks || []);
    setDisabledFixtures(state.disabledFixtures || new Set<string>());
  };
  const saveState = () => ({
    sections: [...sections], manual: [...manualCues], efx: [...efxTracks],
    fixtureTracks: [...fixtureTracks], colorTracks: [...colorTracks],
    strobeTracks: [...strobeTracks], dimmerTracks: [...dimmerTracks],
    chaserTracks: [...chaserTracks], showTracks: [...showTracks], sceneTracks: [...sceneTracks],
    disabledFixtures: new Set(disabledFixtures),
  });

  const undo = useCallback(() => {
    const state = undoHistoryRef.current.pop();
    if (!state) return;
    redoHistoryRef.current.push(saveState());
    restoreState(state);
  }, [sections, manualCues, efxTracks, fixtureTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks, disabledFixtures]);

  const redo = useCallback(() => {
    const state = redoHistoryRef.current.pop();
    if (!state) return;
    undoHistoryRef.current.push(saveState());
    restoreState(state);
  }, [sections, manualCues, efxTracks, fixtureTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks]);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
      // Ctrl+Shift+Z = redo (common alternative)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  const handleToggleFixture = useCallback((fixtureId: string) => {
    pushHistory();
    setDisabledFixtures(prev => {
      const next = new Set(prev);
      if (next.has(fixtureId)) { next.delete(fixtureId); }
      else { next.add(fixtureId); }
      return next;
    });
  }, [pushHistory]);

  const clearAudio = useCallback(() => {
    pushHistory();
    setSections([]);
    setManualCues([]);
    setEfxTracks([]);
    setColorTracks([]);
    setStrobeTracks([]);
    setDimmerTracks([]);
    setFixtureTracks([]);
    setDisabledFixtures(new Set());
    // Reset audio file + analysis
    audioFile.clear();
  }, [pushHistory, audioFile]);

  /* ─── Custom palettes ────────────────────────────── */
  const lastAnalysisGenreRef = useRef<string>('');

  useEffect(() => {
    if (resolvedAnalysis?.genre && resolvedAnalysis.genre !== lastAnalysisGenreRef.current) {
      lastAnalysisGenreRef.current = resolvedAnalysis.genre;
      try {
        const g = JSON.parse(resolvedAnalysis.genre);
        // Chaque nouvel audio (nouveau genre détecté) re-synchronise la palette
        // sur l'ambiance déterminée. Un choix manuel persiste tant qu'on garde
        // le même genre ; dès qu'un nouvel audio change d'ambiance, on le suit.
        setQs({ colorScheme: g.palette || 'auto' });
      } catch {
        setQs({ colorScheme: 'auto' });
      }
    }
  }, [resolvedAnalysis]);

  const [customPal, setCustomPal] = useState<CustomPalette>(() => qs.customPalette || {
    intro: [], verse: [], chorus: [], bridge: [], drop: [], outro: [], build: [],
  });

  const triggerAddColor = useCallback((sectionType: keyof CustomPalette) => {
    const defaultColor = SECTION_COLORS[sectionType] || '#ff0064';
    const currentLen = (customPal[sectionType] || []).length;
    setPicker(null);
    setGradientPicker({ sectionType, colorIdx: currentLen, startColor: defaultColor, endColor: defaultColor, constantColor: false });
  }, [customPal]);


  const handleColorPick = useCallback((sectionType: string, colorIdx: number) => {
    const currentColor = (customPal[sectionType] || [])[colorIdx] || '#ff0000';
    setPicker(null);
    setGradientPicker({ sectionType, colorIdx, startColor: currentColor, endColor: currentColor, constantColor: false });
  }, [customPal]);

  // Remove a custom color from a section palette (right-click in picker)
  const removeCustomColor = useCallback((sectionType: string, colorIdx: number) => {
    const key = sectionType as keyof CustomPalette;
    const arr = (customPal[key] || []).filter((_, i) => i !== colorIdx);
    const newPal = { ...customPal, [key]: arr };
    setCustomPal(newPal);
    setQs({ customPalette: newPal });
  }, [customPal, setCustomPal, setQs]);

  // Reset one section's custom colors
  const resetSectionColors = useCallback((sectionType: string) => {
    const key = sectionType as keyof CustomPalette;
    const newPal = { ...customPal, [key]: [] };
    setCustomPal(newPal);
    setQs({ customPalette: newPal });
  }, [customPal, setCustomPal, setQs]);

  // Reset all custom colors
  const resetAllCustomColors = useCallback(() => {
    const empty: CustomPalette = { intro: [], verse: [], chorus: [], bridge: [], drop: [], outro: [], build: [] };
    setCustomPal(empty);
    setQs({ customPalette: empty, customGradients: {} });
  }, [setCustomPal, setQs]);


  const handleForceColor = useCallback((fixtureId: string, color: string) => {
    const fc = { ...(qs.forcedColors || {}), [fixtureId]: color };
    setQs({ forcedColors: fc });
  }, [qs.forcedColors, setQs]);

  const handleForceStrobe = useCallback((fixtureId: string, active: boolean) => {
    const fs = { ...(qs.forcedStrobe || {}), [fixtureId]: active };
    setQs({ forcedStrobe: fs });
  }, [qs.forcedStrobe, setQs]);

  /* ─── Pre load fixture defs ──────────────────────── */
  useEffect(() => {
    if (patchedFixtures.length === 0) return;
    const ids = [...new Set(patchedFixtures.map(f => f.fixtureDefId))];
    loadFixtureDefinitions(ids).then(setFixtureDefs).catch(() => {});
  }, [patchedFixtures]);

  /* ─── Section change handlers ────────────────────── */
  const onSelChange = useCallback((startTime: number, endTime: number, type: string) => {
    pushHistory();
    setSections(prev => applySectionChange(prev, startTime, endTime, type as TrackSection['type']));
  }, [pushHistory, setSections]);

  const changeType = useCallback((idx: number, type: TrackSection['type']) => {
    pushHistory();
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, type, color: SECTION_COLORS[type] || '#4b5563' } : s));
  }, [pushHistory]);

  const [sectionModal, setSectionModal] = useState<{ idx: number } | null>(null);
  const onSectionClick = useCallback((idx: number) => {
    setSectionModal({ idx });
  }, []);

  /* ─── Preset file dialog loader ───────────────── */
  const [presetsDropdown, setPresetsDropdown] = useState(false);
  const [savedPresets, setSavedPresets] = useState<Array<{ name: string; timestamp: string; data?: any } & Partial<SongPreset>>>([]);
  const presetsBtnRef = useRef<HTMLButtonElement>(null);

  // Load saved preset list on mount
  useEffect(() => {
    (async () => {
      try {
        const api = (window as any).lightMaestro?.presets;
        if (api) {
          const list = await api.load();
          setSavedPresets(Array.isArray(list) ? list : []);
        }
      } catch {}
    })();
  }, []);

  /* ─── BPM ────────────────────────────────────────── */
  const masterBpm = useClockStore((s) => s.bpm);
  const masterSource = useClockStore((s) => s.source);
  const effectiveBpm = useMemo(() => {
    // Master Clock a priorité quand Link/MIDI/Tap est actif, sinon QuickShow syncMode/analyse
    if (masterSource === 'link' || masterSource === 'midi' || masterSource === 'tap') return masterBpm;
    if (syncMode === 'manual') return manualBpm;
    if (syncMode === 'tap' && tapBpm > 0) return tapBpm;
    return resolvedAnalysis?.bpm || masterBpm || 120;
  }, [syncMode, manualBpm, tapBpm, resolvedAnalysis, masterBpm, masterSource]);

  const loadPresetFile = useCallback(() => {
    return new Promise<void>((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.lmpreset';
      inp.onchange = async () => {
        const pf = inp.files?.[0];
        if (!pf) { resolve(); return; }
        try {
          const text = await pf.text();
          const data = JSON.parse(text);
          const presetName = data.quickShow?.name || pf.name.replace(/\.lmpreset$/i, '');
          useAppStore.getState().setPresetName(presetName);
          if (data.quickShow) setQs(data.quickShow);
          if (data.sections) setSections(data.sections);
          if (data.manualCues) setManualCues(data.manualCues);
          if (data.efxTracks) setEfxTracks(data.efxTracks);
          if (data.colorTracks) setColorTracks(data.colorTracks);
          if (data.strobeTracks) setStrobeTracks(data.strobeTracks);
          if (data.dimmerTracks) setDimmerTracks(data.dimmerTracks);
          if (data.fixtureTracks) setFixtureTracks(data.fixtureTracks);
          if (data.disabledFixtures) setDisabledFixtures(new Set(data.disabledFixtures)); else setDisabledFixtures(new Set());
          if (data.musicians) setQsMusicians(normalizeRoster(data.musicians));
          if (data.stageScene) setQsStageScene(data.stageScene as StageScene);
          let audioDataUrl = '';
          if (data.analysis) {
            if (data.audioDataBase64) {
              // Ensure proper data URL format
              audioDataUrl = data.audioDataBase64.startsWith('data:')
                ? data.audioDataBase64
                : `data:audio/mpeg;base64,${data.audioDataBase64}`;
              try {
                await audioFile.restoreWithAudio(data.analysis, audioDataUrl);
              } catch (e) {
                console.error('restoreWithAudio failed, falling back to restoreAnalysis:', e);
                audioFile.restoreAnalysis(data.analysis);
              }
            } else {
              audioFile.restoreAnalysis(data.analysis);
            }
            setHasEverHadAnalysis(true);
          }
          // Sync to showStore.songPresets (for VC widget)
          const store = useShowStore.getState();
          const existing = store.songPresets.filter(p => p.name !== presetName);
          store.setSongPresets([...existing, {
            id: `qs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: presetName,
            audioFileBase64: audioDataUrl,
            audioFileName: data.analysis?.fileName || presetName,
            dmxCues: data.dmxCues || [],
            quickShow: data.quickShow,
            trackAnalysis: data.analysis,
            sections: data.sections || [],
            efxTracks: data.efxTracks || [],
            colorTracks: data.colorTracks || [],
            strobeTracks: data.strobeTracks || [],
            dimmerTracks: data.dimmerTracks || [],
            manualCues: data.manualCues || [],
            disabledFixtures: data.disabledFixtures || [],
            musicians: data.musicians ? normalizeRoster(data.musicians) : undefined,
            stageScene: data.stageScene as StageScene | undefined,
            createdAt: new Date().toISOString(),
          }]);
          setKey(Number(data.quickShow?.regenSeed) || 0);
        } catch (e) {
          console.error('Failed to load preset file:', e);
        }
        resolve();
      };
      inp.click();
    });
  }, [audioFile, setQs, setSections, setManualCues, setEfxTracks, setFixtureTracks]);

  const handleSaveAsPreset = useCallback((name: string) => {
    const file = audioFile.file;
    (async () => {
      try {
        let audioDataUrl: string | undefined;
        let audioBase64Raw: string | undefined;
        if (file) {
          // Use FileReader to properly encode binary → base64 (no corruption)
          audioDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          // Extract raw base64 for IPC storage
          const commaIdx = audioDataUrl.indexOf(',');
          audioBase64Raw = commaIdx > 0 ? audioDataUrl.slice(commaIdx + 1) : '';
        }
        // Batch-compute DMX cues for VC playback (all track types: fixture, color, strobe, dimmer, efx)
        const currentCues = genCues(sections, effectiveBpm, qs.beatDivision || 4, qs, manualCues, key, resolvedAnalysis, useShowStore.getState().scenes as any);
        const store = useShowStore.getState();
        const pf = store.patchedFixtures;
        const uni = store.universes;
        const fDefs = fixtureDefsRef.current;
        const tierMultipliers = { primary: qs.tierConfig?.primary || 100, secondary: qs.tierConfig?.secondary || 70, tertiary: qs.tierConfig?.tertiary || 40 };
        const dmxCuesArray: DmxCue[] = buildPresetDmxCues(
          currentCues, pf, uni, fDefs, tierMultipliers,
          fixtureTracksRef, colorTracksRef, strobeTracksRef, dimmerTracksRef,
          efxTracksRef, effectsRef, fixtureGroupsRef,
          chaserTracksRef, chasersRef, scenesRef,
        );

        // Sync to showStore.songPresets (for VC widget) — update in place on re-save
        // so widgets referencing the existing id keep seeing the latest tracks/cues.
        const audioFileName = resolvedAnalysis?.fileName || file?.name || name;
        const existing = store.songPresets.find(p => p.name === name);
        const songPreset: any = {
          id: existing?.id ?? `qs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          audioFileBase64: audioDataUrl || '',
          audioFileName,
          dmxCues: dmxCuesArray,
          quickShow: { ...qs, regenSeed: key },
          trackAnalysis: resolvedAnalysis,
          sections,
          efxTracks,
          manualCues,
          fixtureTracks,
          colorTracks,
          strobeTracks,
          dimmerTracks,
          chaserTracks,
          showTracks,
          sceneTracks,
          effects: [...store.effects],
          fixtureGroups: [...store.fixtureGroups],
          patchedFixtures: [...store.patchedFixtures],
          disabledFixtures: [...disabledFixtures],
          musicians: normalizeRoster(qsMusicians),
          stageScene: qsStageScene,
          view3D: qsView3D,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        };
        store.setSongPresets([...store.songPresets.filter(p => p.name !== name), songPreset]);

        // Save to IPC
        const data: any = {
          analysis: resolvedAnalysis,
          sections,
          quickShow: { ...qs, regenSeed: key },
          manualCues,
          efxTracks,
          fixtureTracks,
          colorTracks,
          strobeTracks,
          dimmerTracks,
          chaserTracks,
          showTracks,
          sceneTracks,
          effects: [...store.effects],
          fixtureGroups: [...store.fixtureGroups],
          patchedFixtures: [...store.patchedFixtures],
        disabledFixtures: [...disabledFixtures],
          musicians: normalizeRoster(qsMusicians),
          stageScene: qsStageScene,
          view3D: qsView3D,
        };
        if (audioBase64Raw) data.audioDataBase64 = audioBase64Raw;
        const api = (window as any).lightMaestro?.presets;
        if (!api) { console.error('IPC presets API not available - window.lightMaestro.presets is undefined'); alert('Preset save failed: IPC bridge not loaded.'); return; }
        const list = await api.load();
        const newPreset = { name, timestamp: new Date().toISOString(), data };
        const updated = [...(Array.isArray(list) ? list : []), newPreset];
        await api.save(updated);
        setSavedPresets(updated);
      } catch (e) { console.error('Failed to save preset:', e); }
    })();
  }, [qs, resolvedAnalysis, sections, manualCues, efxTracks, fixtureTracks, chaserTracks, audioFile, effectiveBpm, key, qsMusicians, qsStageScene, qsView3D]);

  const handleExportPreset = useCallback((name: string) => {
    (async () => {
      try {
        const file = audioFile.file;
        let audioDataBase64: string | undefined;
        if (file) {
          audioDataBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        }
        const currentCues = genCues(sections, effectiveBpm, qs.beatDivision || 4, qs, manualCues, key, resolvedAnalysis, useShowStore.getState().scenes as any);
        const store = useShowStore.getState();
        const pf = store.patchedFixtures;
        const uni = store.universes;
        const fDefs = fixtureDefsRef.current;
        const tierMultipliers = { primary: qs.tierConfig?.primary || 100, secondary: qs.tierConfig?.secondary || 70, tertiary: qs.tierConfig?.tertiary || 40 };
        const dmxCuesArray: DmxCue[] = buildPresetDmxCues(
          currentCues, pf, uni, fDefs, tierMultipliers,
          fixtureTracksRef, colorTracksRef, strobeTracksRef, dimmerTracksRef,
          efxTracksRef, effectsRef, fixtureGroupsRef,
          chaserTracksRef, chasersRef, scenesRef,
        );
        const exportData = { version: 1, name, createdAt: new Date().toISOString(), quickShow: { ...qs, regenSeed: key }, analysis: resolvedAnalysis, sections, manualCues, efxTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks, fixtureTracks, dmxCues: dmxCuesArray, disabledFixtures: [...disabledFixtures], musicians: normalizeRoster(qsMusicians), stageScene: qsStageScene, view3D: qsView3D, audioDataBase64 };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name.replace(/[^a-zA-Z0-9_\- ]/g, '')}.lmpreset`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) { console.error('Failed to export preset:', e); }
    })();
  }, [qs, resolvedAnalysis, sections, manualCues, efxTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, fixtureTracks, disabledFixtures, audioFile, effectiveBpm, key, qsMusicians, qsStageScene, qsView3D]);

  const handleLoadPreset = useCallback(async (preset: typeof savedPresets[number]) => {
    // Support both legacy format {data:{quickShow,analysis,...}} and flat SongPreset format
    const qsData = preset?.data?.quickShow || preset?.quickShow;
    const analysisData = preset?.data?.analysis || preset?.trackAnalysis;
    const sectionsData = preset?.data?.sections || preset?.sections;
    const manualCuesData = preset?.data?.manualCues || preset?.manualCues;
    const efxTracksData = preset?.data?.efxTracks || preset?.efxTracks;
    const fixtureTracksData = preset?.data?.fixtureTracks || preset?.fixtureTracks;
    const audioBase64 = preset?.data?.audioDataBase64 || preset?.audioFileBase64;
    const dmxCuesData = preset?.data?.dmxCues || preset?.dmxCues;
    const presetName = preset.name;
    if (!qsData) return;
    useAppStore.getState().setPresetName(presetName);
    pushHistory();
    setQs(qsData);
    if (sectionsData) setSections(sectionsData);
    if (manualCuesData) setManualCues(manualCuesData);
    if (efxTracksData) setEfxTracks(efxTracksData);
    if (fixtureTracksData) setFixtureTracks(fixtureTracksData);
    const colorTracksPreset = preset?.data?.colorTracks || preset?.colorTracks;
    if (colorTracksPreset) setColorTracks(colorTracksPreset);
    const strobeTracksPreset = preset?.data?.strobeTracks || preset?.strobeTracks;
    if (strobeTracksPreset) setStrobeTracks(strobeTracksPreset);
    const dimmerTracksPreset = preset?.data?.dimmerTracks || preset?.dimmerTracks;
    if (dimmerTracksPreset) setDimmerTracks(dimmerTracksPreset);
    const chaserTracksPreset = preset?.data?.chaserTracks || preset?.chaserTracks;
    if (chaserTracksPreset) setChaserTracks(chaserTracksPreset);
    const showTracksPreset = preset?.data?.showTracks || (preset as any)?.showTracks;
    if (showTracksPreset) setShowTracks(showTracksPreset);
    const sceneTracksPreset = preset?.data?.sceneTracks || (preset as any)?.sceneTracks;
    if (sceneTracksPreset) setSceneTracks(sceneTracksPreset);
    const disabledFixturesData = preset?.data?.disabledFixtures || preset?.disabledFixtures;
    setDisabledFixtures(disabledFixturesData ? new Set(disabledFixturesData) : new Set());
    const musiciansData = preset?.data?.musicians || (preset as any)?.musicians;
    const stageSceneData = preset?.data?.stageScene || (preset as any)?.stageScene;
    if (musiciansData) setQsMusicians(normalizeRoster(musiciansData));
    if (stageSceneData) setQsStageScene(stageSceneData as StageScene);
    const view3DData = preset?.data?.view3D || (preset as any)?.view3D;
    setQsView3D(view3DData && typeof view3DData === 'object' ? view3DData as View3DState : undefined);
    // Restore EFX effects and fixture groups/patches if present in preset (pour que l'EFX track retrouve son groupe/effet)
    const effectsPreset = (preset as any)?.effects || preset?.data?.effects;
    if (effectsPreset && Array.isArray(effectsPreset)) {
      const store = useShowStore.getState();
      // Merge missing effects (ne pas écraser les existants avec même id)
      const toAdd = effectsPreset.filter((e: any) => !store.effects.some((ex) => ex.id === e.id));
      if (toAdd.length > 0) store.setEffects([...store.effects, ...toAdd]);
    }
    const fixtureGroupsPreset = (preset as any)?.fixtureGroups || preset?.data?.fixtureGroups;
    if (fixtureGroupsPreset && Array.isArray(fixtureGroupsPreset)) {
      const store = useShowStore.getState();
      const toAdd = fixtureGroupsPreset.filter((g: any) => !store.fixtureGroups.some((ex) => ex.id === g.id));
      if (toAdd.length > 0) store.setFixtureGroups([...store.fixtureGroups, ...toAdd]);
    }
    const patchedFixturesPreset = (preset as any)?.patchedFixtures || preset?.data?.patchedFixtures;
    if (patchedFixturesPreset && Array.isArray(patchedFixturesPreset)) {
      const store = useShowStore.getState();
      // Merge fixtures par id (évite doublons)
      const toAdd = patchedFixturesPreset.filter((pf: any) => !store.patchedFixtures.some((ex) => ex.id === pf.id));
      if (toAdd.length > 0) store.setPatchedFixtures([...store.patchedFixtures, ...toAdd]);
    }
    let audioDataUrl = '';
    if (analysisData) {
      if (audioBase64 && typeof audioBase64 === 'string') {
        // If already a full data URL, use it directly; otherwise wrap with mime prefix
        if (audioBase64.startsWith('data:')) {
          audioDataUrl = audioBase64;
        } else {
          const mime = (analysisData as any)?.mimeType || 'audio/mpeg';
          audioDataUrl = `data:${mime};base64,${audioBase64}`;
        }
        try {
          await audioFile.restoreWithAudio(analysisData, audioDataUrl);
        } catch (e) {
          console.error('restoreWithAudio failed, falling back to restoreAnalysis:', e);
          audioFile.restoreAnalysis(analysisData);
        }
      } else {
        audioFile.restoreAnalysis(analysisData);
      }
      setHasEverHadAnalysis(true);
    }
    // Sync to showStore.songPresets (for VC widget) — update in place on re-import
    const store = useShowStore.getState();
    const existing = store.songPresets.find(p => p.name === presetName);
    const newPreset: any = {
      id: existing?.id ?? `qs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: presetName,
      audioFileBase64: audioDataUrl,
      audioFileName: analysisData?.fileName || presetName,
      dmxCues: dmxCuesData || [],
      quickShow: qsData,
      trackAnalysis: analysisData,
      sections: sectionsData || [],
      efxTracks: efxTracksData || [],
      fixtureTracks: fixtureTracksData || [],
      colorTracks: colorTracksPreset || [],
      strobeTracks: strobeTracksPreset || [],
      dimmerTracks: dimmerTracksPreset || [],
      chaserTracks: chaserTracksPreset || [],
      sceneTracks: sceneTracksPreset || [],
      manualCues: manualCuesData || [],
      disabledFixtures: [...disabledFixtures],
      musicians: (preset?.data?.musicians || (preset as any)?.musicians) ? normalizeRoster(preset?.data?.musicians || (preset as any)?.musicians) : normalizeRoster(qsMusicians),
      stageScene: (preset?.data?.stageScene || (preset as any)?.stageScene) as StageScene || qsStageScene,
      view3D: view3DData && typeof view3DData === 'object' ? view3DData as View3DState : qsView3D,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    store.setSongPresets([...store.songPresets.filter(p => p.name !== presetName), newPreset]);
    setKey(Number(qsData?.regenSeed) || 0);
    setPresetsDropdown(false);
  }, [setQs, setSections, setManualCues, setEfxTracks, setFixtureTracks, disabledFixtures, audioFile, pushHistory, qsMusicians, qsStageScene, qsView3D]);

  const handleDeletePreset = useCallback((idx: number) => {
    (async () => {
      try {
        const api = (window as any).lightMaestro?.presets;
        if (!api) return;
        const updated = savedPresets.filter((_, i) => i !== idx);
        await api.save(updated);
        setSavedPresets(updated);
      } catch {}
    })();
  }, [savedPresets]);

  // Deprecated: keep the old color-preset handler for ColorPresetsPanel compatibility
  const handleSelectPreset = useCallback((_preset: ColorPreset) => {
    // no-op - replaced by full preset save/load
  }, []);

  const scenesForAutoscript = useShowStore((s) => s.scenes);
  /* ─── Cues generation ────────────────────────────── */
  const cues = useMemo(() => {
    if (sections.length === 0) return [];
    return genCues(sections, effectiveBpm, qs.beatDivision || 4, qs, manualCues, key, resolvedAnalysis, scenesForAutoscript as any);
  }, [sections, effectiveBpm, qs.beatDivision, qs.musicStyle, qs.colorScheme, qs.intensity, qs.movement, qs.sectionAware, qs.customPalette, qs.audioReactive, manualCues, key, resolvedAnalysis, scenesForAutoscript, qs.useScenesInAutoscript, qs.scenesAutoscriptWeight]);
  // Keep refs in sync for save handlers
  cuesRef.current = cues;
  fixtureDefsRef.current = fixtureDefs;

  /* ─── DMX compute ────────────────────────────────── */
  const dmxComputeStabilizationKey = useMemo(
    () => `${qs.musicStyle}|${qs.colorScheme}|${qs.beatDivision}|${qs.intensity}|${qs.movement}|${qs.sectionAware ? '1' : '0'}|${patchedFixtures.map(f => f.id).join(',')}|${selectedGroupId}`,
    [qs.musicStyle, qs.colorScheme, qs.beatDivision, qs.intensity, qs.movement, qs.sectionAware, patchedFixtures, selectedGroupId],
  );

  useEffect(() => {
    if (cues.length === 0 || patchedFixtures.length === 0 || fixtureDefs.size === 0) {
      setDmxCues([]);
      dmxCuesRef.current = [];
      return;
    }

    const sign = `${dmxComputeStabilizationKey}|${cues.length}|${cues[0]?.time}`;
    if (sign === lastDmxCuesRef.current[0]?.effect) return;

    try {
      const ctc = computeColorTrackColors(colorTracksRef.current as any, cues[0].time, patchedFixtures, fixtureGroupsRef.current);
      const computed = computeDmxForCue(
        cues[0],
        patchedFixtures,
        fixtureDefs,
        universes as any,
        { primary: qs.tierConfig?.primary || 100, secondary: qs.tierConfig?.secondary || 70, tertiary: qs.tierConfig?.tertiary || 40 },
        computeFixtureTrackOverrides(fixtureTracksRef.current, cues[0].time, patchedFixtures, fixtureGroupsRef.current),
        ctc,
        undefined,
      );

      const dmxResult: DmxCue[] = computed.map(c => ({
        time: cues[0].time,
        section: cues[0].section,
        universe: c.universe,
        channelValues: c.channelValues,
        fixtureNames: [],
        fixtureCount: 0,
        effect: cues[0].effect,
        colors: cues[0].colors,
      }));

      setDmxCues(dmxResult);
      dmxCuesRef.current = dmxResult;
      lastDmxCuesRef.current = dmxResult;
    } catch (e) {
      console.error('DMX compute error:', e);
    }
  }, [dmxComputeStabilizationKey, cues, patchedFixtures, fixtureDefs, universes, qs.tierConfig, selectedGroupId]);

  /* ─── Enriched cues ──────────────────────────────── */
  const enrichedCues = useMemo(() => (dmxCues.length > 0 ? dmxCues : lastEnrichedCuesRef.current) as EnrichedCue[], [dmxCues]);
  useEffect(() => { if (dmxCues.length > 0) lastEnrichedCuesRef.current = dmxCues as EnrichedCue[]; }, [dmxCues]);

  /* ─── DMX Playback ───────────────────────────────── */
  const currentTimeRef = useRef(audioFile.currentTime);
  currentTimeRef.current = audioFile.currentTime; // keep in sync on every render
  const fixturePositions = useShowStore(s => s.fixturePositions);
  const fixturePositionsRef = useRef(fixturePositions);
  fixturePositionsRef.current = fixturePositions;
  useDmxPlayback({
    isPlaying: audioFile.isPlaying,
    currentTimeRef: currentTimeRef,
    cues: (showB && cuesB.length > 0 ? cuesB : cues) as any,
    patchedFixtures,
    fixtureDefs,
    universes: universes.map(u => ({ id: u.id, name: u.name, type: u.type, channels: u.channels })) as any,
    dmxOutputEnabled,
    dryRunMode,
    tierMultipliers: { primary: qs.tierConfig?.primary || 100, secondary: qs.tierConfig?.secondary || 70, tertiary: qs.tierConfig?.tertiary || 40 },
    overrideCuesRef: overrideCuesRef as any,
    fixtureTracksRef,
    efxTracksRef,
    effectsRef,
    fixtureGroupsRef,
    colorTracksRef: colorTracksRef as any,
    strobeTracksRef: strobeTracksRef as any,
    dimmerTracksRef: dimmerTracksRef as any,
    chaserTracksRef: chaserTracksRef as any,
    chasersRef,
    scenesRef,
    showTracksRef: showTracksRef as any,
    showsRef,
    disabledFixturesRef: disabledFixturesRef as any,
    panTiltLimitsRef,
    fixturePositionsRef,
    colorFadeMs: qs.colorFadeMs ?? 250,
    frozenRef: frozenRef as React.MutableRefObject<boolean>,
    forceDropRef: forceDropRef as React.MutableRefObject<boolean>,
    onVirtualDmx: (uni, chVals) => {
      useAppStore.getState().setUniverseData(uni, chVals);
    },
  });

  /* ─── Energy by section ──────────────────────────── */
  const energyBySection = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sections) {
      if (!map[s.type]) map[s.type] = s.energy;
      else map[s.type] = Math.max(map[s.type], s.energy);
    }
    return map;
  }, [sections]);

  /* ─── Init sections from analysis ────────────────── */
  useEffect(() => {
    if (resolvedAnalysis?.sections && sections.length === 0) {
      setSections(mergeAdjacentSections(resolvedAnalysis.sections));
    } else if (sections.length === 0 && resolvedAnalysis?.duration && resolvedAnalysis.duration > 0) {
      // Auto-generate sections when audio has no analyzed sections
      const dur = resolvedAnalysis.duration;
      const energyCurve = resolvedAnalysis.energyCurve || [];
      const autoSecs: TrackSection[] = [];
      if (energyCurve.length > 10) {
        // Use energy curve: find peaks (drops) and valleys
        const step = Math.max(1, Math.floor(energyCurve.length / 200));
        const smoothed: number[] = [];
        for (let i = 0; i < energyCurve.length; i += step) {
          let sum = 0, count = 0;
          for (let j = Math.max(0, i - step); j < Math.min(energyCurve.length, i + step); j++) { sum += energyCurve[j]; count++; }
          smoothed.push(sum / count);
        }
        const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
        const peaks: number[] = [];
        for (let i = 1; i < smoothed.length - 1; i++) {
          if (smoothed[i] > smoothed[i - 1] && smoothed[i] > smoothed[i + 1] && smoothed[i] > mean * 1.15) peaks.push(i / smoothed.length);
        }
        if (peaks.length >= 2) {
          // Build sections around peaks
          const boundaries = [0, ...peaks, 1];
          boundaries.sort((a, b) => a - b);
          for (let i = 0; i < boundaries.length - 1; i++) {
            const start = boundaries[i];
            const end = boundaries[i + 1];
            const mid = (start + end) / 2;
            const segEnergy = smoothed[Math.floor(mid * smoothed.length)] || mean;
            const type: TrackSection['type'] = i === 0 ? 'intro' : i === boundaries.length - 2 ? 'outro'
              : peaks.includes(end) ? 'drop' : peaks.includes(start) ? 'verse' : 'bridge';
            autoSecs.push({ type, startTime: start * dur, endTime: end * dur, energy: segEnergy / (mean * 1.5), color: '' });
          }
        }
      }
      if (autoSecs.length === 0) {
        // Fallback: 10-second chunks
        const SEC_LENGTH = 10;
        const chunkCount = Math.max(1, Math.ceil(dur / SEC_LENGTH));
        for (let i = 0; i < chunkCount; i++) {
          const s = (i / chunkCount) * dur;
          const e = Math.min(dur, ((i + 1) / chunkCount) * dur);
          autoSecs.push({
            type: 'verse',
            startTime: s,
            endTime: e,
            energy: 0.5,
            color: '',
          });
        }
      }
      setSections(mergeAdjacentSections(autoSecs));
    }
  }, [resolvedAnalysis]);

  /* ─── EFX handlers ──────────────────────────────── */
  const [efxTrackModal, setEfxTrackModal] = useState(false);
  const [colorTrackModal, setColorTrackModal] = useState(false);
  const [fadeModal, setFadeModal] = useState(false);
  const [efxTrackName, setEfxTrackName] = useState('');
  const [efxTargetType, setEfxTargetType] = useState<'all' | 'group' | 'fixture'>('all');
  const [efxTargetGroupId, setEfxTargetGroupId] = useState('');
  const [efxTargetFixtureIds, setEfxTargetFixtureIds] = useState<string[]>([]);
  const [efxPattern, setEfxPattern] = useState<'static' | 'sweep' | 'circle' | 'pulse' | 'wave' | 'bounce' | 'figure8' | 'spiral' | 'zigzag' | 'heartbeat' | 'randomWalk' | 'diamond' | 'custom'>('static');
  const [efxCustomEffectId, setEfxCustomEffectId] = useState('');

  // Valeurs par défaut des choix « track » (implémentées automatiquement à 10 s)
  const [colorTrackStartColor, setColorTrackStartColor] = useState<string>(() => {
    const pal = resolvePaletteColors(qs.colorScheme || 'auto', qs);
    return pal[0] || '#ff0064';
  });
  const [colorTrackEndColor, setColorTrackEndColor] = useState<string>(() => {
    const pal = resolvePaletteColors(qs.colorScheme || 'auto', qs);
    return pal[pal.length > 1 ? 1 : 0] || '#ff0064';
  });
  const [strobeTrackSpeed, setStrobeTrackSpeed] = useState(10);
  const [strobeTrackEndSpeed, setStrobeTrackEndSpeed] = useState(10);
  const [dimmerTrackValue, setDimmerTrackValue] = useState(100);
  const [dimmerTrackEndValue, setDimmerTrackEndValue] = useState(100);

  // Cibles « Modifier » : quand non nul, les modales éditent la section existante
  // au lieu de créer une nouvelle piste (Renommer/Modifier au clic droit).
  const [efxEditTarget, setEfxEditTarget] = useState<{ trackId: string; entryId?: string; time: number; endTime: number } | null>(null);
  const [colorEditTarget, setColorEditTarget] = useState<{ trackId: string; entryId: string } | null>(null);
  const [strobeEditTarget, setStrobeEditTarget] = useState<{ trackId: string; entryId: string } | null>(null);
  const [dimmerEditTarget, setDimmerEditTarget] = useState<{ trackId: string; entryId: string } | null>(null);

  // Color track modal state
  const [colorTrackName, setColorTrackName] = useState('');
  const [colorTargetType, setColorTargetType] = useState<'all' | 'group' | 'fixture'>('all');
  const [colorTargetGroupId, setColorTargetGroupId] = useState('');
  const [colorTargetFixtureIds, setColorTargetFixtureIds] = useState<string[]>([]);

  // Color track context menus
  const [colorContextMenu, setColorContextMenu] = useState<{ trackId: string; time: number; x: number; y: number } | null>(null);
  const [colorEntryMenu, setColorEntryMenu] = useState<{ trackId: string; entry: ColorTrackEntry; x: number; y: number } | null>(null);
  const colorContextRef = useRef<HTMLDivElement>(null);
  const colorEntryMenuRef = useRef<HTMLDivElement>(null);

  // Strobe track modal state
  const [strobeTrackModal, setStrobeTrackModal] = useState(false);
  const [strobeTrackName, setStrobeTrackName] = useState('');
  const [strobeTargetType, setStrobeTargetType] = useState<'all' | 'group' | 'fixture'>('all');
  const [strobeTargetGroupId, setStrobeTargetGroupId] = useState('');
  const [strobeTargetFixtureIds, setStrobeTargetFixtureIds] = useState<string[]>([]);

  // Strobe track context menus
  const [scmPos, setScmPos] = useState<{
    x: number; y: number; type: 'track' | 'entry'; trackId: string;
    time?: number; entry?: StrobeTrackEntry;
  } | null>(null);
  const [strobeEntryMenu, setStrobeEntryMenu] = useState<{ trackId: string; entry: StrobeTrackEntry; x: number; y: number } | null>(null);
  const scmRef = useRef<HTMLDivElement>(null);
  const strobeEntryMenuRef = useRef<HTMLDivElement>(null);

  // Dimmer track context menus
  const [dimmerInsertMenu, setDimmerInsertMenu] = useState<{ trackId: string; time: number; x: number; y: number } | null>(null);
  const [dimmerEntryMenu, setDimmerEntryMenu] = useState<{ trackId: string; entry: DimmerTrackEntry; x: number; y: number } | null>(null);
  const dimmerInsertMenuRef = useRef<HTMLDivElement>(null);
  const dimmerEntryMenuRef = useRef<HTMLDivElement>(null);
  // Dimmer track modal state
  const [dimmerTrackModal, setDimmerTrackModal] = useState(false);
  const [dimmerTrackName, setDimmerTrackName] = useState('');
  const [dimmerTargetType, setDimmerTargetType] = useState<'all' | 'group' | 'fixture'>('all');
  const [dimmerTargetGroupId, setDimmerTargetGroupId] = useState('');
  const [dimmerTargetFixtureIds, setDimmerTargetFixtureIds] = useState<string[]>([]);
  const [chaserInsertMenu, setChaserInsertMenu] = useState<{ trackId: string; time: number; x: number; y: number } | null>(null);
  const [chaserEntryMenu, setChaserEntryMenu] = useState<{ trackId: string; entry: ChaserTrackEntry; x: number; y: number } | null>(null);
  const [chaserPickModal, setChaserPickModal] = useState<{ trackId: string } | null>(null);
  const [showInsertMenu, setShowInsertMenu] = useState<{ trackId: string; time: number; x: number; y: number } | null>(null);
  const [showEntryMenu, setShowEntryMenu] = useState<{ trackId: string; entry: ShowTrackEntry; x: number; y: number } | null>(null);
  const [showPickModal, setShowPickModal] = useState<{ trackId: string } | null>(null);

  // Resolve target fixture names for display + DMX filtering
  const efxTargetFixtureNames = useMemo(() => {
    const fixtures = useShowStore.getState().patchedFixtures;
    const groups = useShowStore.getState().fixtureGroups;
    if (efxTargetType === 'all') return fixtures.map(f => f.name);
    if (efxTargetType === 'group') {
      const g = groups.find(g => g.id === efxTargetGroupId);
      return g ? fixtures.filter(f => g.fixtureIds.includes(f.id)).map(f => f.name) : [];
    }
    return fixtures.filter(f => efxTargetFixtureIds.includes(f.id)).map(f => f.name);
  }, [efxTargetType, efxTargetGroupId, efxTargetFixtureIds]);

  // ── Floating 3D view ──
  const [showFloating3D, setShowFloating3D] = useState(false);
  const [float3DPos, setFloat3DPos] = useState({ x: 100, y: 80 });
  const [float3DSize, setFloat3DSize] = useState({ w: 1280, h: 720 });
  const float3DDragRef = useRef(null);
  const float3DResizeRef = useRef(null);

  const handleFloat3DResizeStart = useCallback((e) => {
    e.stopPropagation();
    float3DResizeRef.current = { startX: e.clientX, startY: e.clientY, startW: float3DSize.w, startH: float3DSize.h };
    const onMove = (ev) => {
      if (!float3DResizeRef.current) return;
      setFloat3DSize({
        w: Math.max(320, float3DResizeRef.current.startW + ev.clientX - float3DResizeRef.current.startX),
        h: Math.max(200, float3DResizeRef.current.startH + ev.clientY - float3DResizeRef.current.startY),
      });
    };
    const onUp = () => { float3DResizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DSize]);

  const float3DRef = useRef(null);

  const handleFloat3DDragStart = useCallback((e) => {
    float3DDragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: float3DPos.x, startTop: float3DPos.y };
    const onMove = (ev) => {
      if (!float3DDragRef.current) return;
      setFloat3DPos({ x: Math.max(0, Math.min(float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX, window.innerWidth - 120)), y: Math.max(0, Math.min(float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY, window.innerHeight - 40)) });
    };
    const onUp = () => { float3DDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DPos]);

  const handleAddEfxTrack = useCallback(() => {
    if (efxEditTarget) {
      // Mode « Modifier » : on met à jour la section existante, sans créer de piste.
      const efx = effectEntities.find((e: any) => e.id === efxCustomEffectId) || effectEntities[0];
      if (efx) {
        pushHistory();
        setEfxTracks(prev => prev.map(t => {
          if (t.id !== efxEditTarget.trackId) return t;
          const target: EfxTrackEntry = { id: efxEditTarget.entryId, time: efxEditTarget.time, endTime: efxEditTarget.endTime, effectId: '', effectName: '', pattern: '', fixtureNames: [] };
          return {
            ...t,
            entries: t.entries.map(e => sameEfxEntry(e, target)
              ? { ...e, effectId: efx.id, effectName: efx.name, pattern: efx.pattern || 'Custom' }
              : e),
          };
        }));
      }
      setEfxEditTarget(null);
      setEfxTrackModal(false);
      setEfxCustomEffectId('');
      return;
    }
    const name = efxTrackName.trim();
    if (!name) return;
    pushHistory();
    const trackId = `efxt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Auto-implémentation : l'effet choisi dans la modale (sinon le premier
    // dispos) est posé d'office sur la piste avec une durée par défaut de 10 s.
    const efx = effectEntities.find((e: any) => e.id === efxCustomEffectId) || effectEntities[0];
    const entries: EfxTrackEntry[] = efx ? [{
      id: `efxe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: 0,
      endTime: 10,
      effectId: efx.id,
      effectName: efx.name,
      pattern: efx.pattern || 'Custom',
      fixtureNames: [],
    }] : [];
    const newTrack: EfxTrack = {
      id: trackId,
      name,
      entries,
      targetFixtures: {
        type: efxTargetType,
        ...(efxTargetType === 'group' ? { groupId: efxTargetGroupId } : {}),
        ...(efxTargetType === 'fixture' ? { fixtureIds: efxTargetFixtureIds } : {}),
      },
    };
    setEfxTracks(prev => [...prev, newTrack]);
    setEfxTrackModal(false);
    setEfxTrackName('');
    setEfxTargetType('all');
    setEfxTargetGroupId('');
    setEfxTargetFixtureIds([]);
    setEfxCustomEffectId('');
  }, [pushHistory, efxTrackName, efxTargetType, efxTargetGroupId, efxTargetFixtureIds, efxCustomEffectId, effectEntities, efxEditTarget, resolvedAnalysis]);

  const openEfxTrackModal = useCallback(() => {
    setEfxTrackName('');
    setEfxTargetType('all');
    setEfxTargetGroupId('');
    setEfxTargetFixtureIds([]);
    setEfxCustomEffectId('');
    setEfxTrackModal(true);
  }, []);

  const handleRemoveEfxTrack = useCallback((trackId: string) => {
    pushHistory();
    setEfxTracks(prev => prev.filter(t => t.id !== trackId));
  }, [pushHistory]);

  const handleEfxTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setEfxContextMenu({ trackId, time, x: clientX, y: clientY });
  }, []);

  const handleEfxEntryContextMenu = useCallback((trackId: string, entry: EfxTrackEntry, clientX: number, clientY: number) => {
    setEfxEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);

  const handleRemoveEfxEntry = useCallback((trackId: string, entry: EfxTrackEntry) => {
    setEfxTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, entries: t.entries.filter(e => !sameEfxEntry(e, entry)) };
    }));
    setEfxEntryMenu(null);
  }, []);

  const handleRenameEfxEntry = useCallback((trackId: string, entry: EfxTrackEntry, label: string) => {
    pushHistory();
    const trimmed = label.trim();
    setEfxTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, entries: t.entries.map(e => sameEfxEntry(e, entry) ? { ...e, label: trimmed || undefined } : e) };
    }));
    setEfxEntryMenu(null);
  }, [pushHistory]);

  const handleModifyEfxEntry = useCallback((trackId: string, entry: EfxTrackEntry) => {
    setEfxEditTarget({ trackId, entryId: entry.id, time: entry.time, endTime: entry.endTime });
    setEfxCustomEffectId(entry.effectId);
    setEfxEntryMenu(null);
    setEfxTrackModal(true);
  }, []);

  // ─── Color Track handlers ─────────────────────────
  const handleAddColorTrack = useCallback(() => {
    if (colorEditTarget) {
      // Mode « Modifier » : on met à jour la section existante, sans créer de piste.
      pushHistory();
      setColorTracks(prev => prev.map(t => {
        if (t.id !== colorEditTarget.trackId) return t;
        return {
          ...t,
          entries: t.entries.map(e => e.id === colorEditTarget.entryId
            ? { ...e, color: colorTrackStartColor, endColor: colorTrackEndColor !== colorTrackStartColor ? colorTrackEndColor : colorTrackStartColor }
            : e),
        };
      }));
      setColorEditTarget(null);
      setColorTrackModal(false);
      setColorTrackStartColor('#FF0000');
      setColorTrackEndColor('#FF0000');
      return;
    }
    const name = colorTrackName.trim();
    if (!name) return;
    pushHistory();
    const newTrack: ColorTrack = {
      id: `clrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      // Auto-implémentation : la couleur début → fin choisie dans la modale
      // est posée d'office sur la piste avec une durée par défaut de 10 s.
      entries: [{
        id: `clre-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: 0,
        endTime: 10,
        color: colorTrackStartColor,
        endColor: colorTrackEndColor !== colorTrackStartColor ? colorTrackEndColor : colorTrackStartColor,
      }],
      targetFixtures: {
        type: colorTargetType,
        ...(colorTargetType === 'group' ? { groupId: colorTargetGroupId } : {}),
        ...(colorTargetType === 'fixture' ? { fixtureIds: colorTargetFixtureIds } : {}),
      },
    };
    setColorTracks(prev => [...prev, newTrack]);
    setColorTrackModal(false);
    setColorTrackName('');
    setColorTargetType('all');
    setColorTargetGroupId('');
    setColorTargetFixtureIds([]);
    const nextPal = resolvePaletteColors(qs.colorScheme || 'auto', qs);
    setColorTrackStartColor(nextPal[0] || '#ff0064');
    setColorTrackEndColor(nextPal[nextPal.length > 1 ? 1 : 0] || '#ff0064');
  }, [pushHistory, colorTrackName, colorTargetType, colorTargetGroupId, colorTargetFixtureIds, colorTrackStartColor, colorTrackEndColor, qs, colorEditTarget]);

  const openColorTrackModal = useCallback(() => {
    setColorTrackName('');
    setColorTargetType('all');
    setColorTargetGroupId('');
    setColorTargetFixtureIds([]);
    const pal = resolvePaletteColors(qs.colorScheme || 'auto', qs);
    setColorTrackStartColor(pal[0] || '#ff0064');
    setColorTrackEndColor(pal[pal.length > 1 ? 1 : 0] || '#ff0064');
    setColorTrackModal(true);
  }, [qs]);

  const handleRemoveColorTrack = useCallback((trackId: string) => {
    pushHistory();
    setColorTracks(prev => prev.filter(t => t.id !== trackId));
  }, [pushHistory]);

  const handleColorEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    setColorTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) {
        entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      }
      return { ...t, entries };
    }));
  }, []);

  const handleColorTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setColorContextMenu({ trackId, time, x: clientX, y: clientY });
  }, []);

  const handleColorEntryContextMenu = useCallback((trackId: string, entry: ColorTrackEntry, clientX: number, clientY: number) => {
    setColorEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);

  const handleRemoveColorEntry = useCallback((trackId: string, entryTime: number) => {
    setColorTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, entries: t.entries.filter(e => e.time !== entryTime) };
    }));
    setColorEntryMenu(null);
  }, []);

  const handleRenameColorEntry = useCallback((trackId: string, entry: ColorTrackEntry, label: string) => {
    pushHistory();
    const trimmed = label.trim();
    setColorTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, entries: t.entries.map(e => e.id === entry.id ? { ...e, label: trimmed || undefined } : e) };
    }));
    setColorEntryMenu(null);
  }, [pushHistory]);

  const handleModifyColorEntry = useCallback((trackId: string, entry: ColorTrackEntry) => {
    setColorEditTarget({ trackId, entryId: entry.id });
    setColorTrackStartColor(entry.color);
    setColorTrackEndColor(entry.endColor || entry.color);
    setColorEntryMenu(null);
    setColorTrackModal(true);
  }, []);

  // ─── Strobe Track handlers ─────────────────────────
  const handleAddStrobeTrack = useCallback(() => {
    if (strobeEditTarget) {
      // Mode « Modifier » : on met à jour la section existante, sans créer de piste.
      pushHistory();
      setStrobeTracks(prev => prev.map(t => {
        if (t.id !== strobeEditTarget.trackId) return t;
        return {
          ...t,
          entries: t.entries.map(e => e.id === strobeEditTarget.entryId
            ? { ...e, speed: strobeTrackSpeed, endSpeed: strobeTrackEndSpeed !== strobeTrackSpeed ? strobeTrackEndSpeed : strobeTrackSpeed }
            : e),
        };
      }));
      setStrobeEditTarget(null);
      setStrobeTrackModal(false);
      setStrobeTrackSpeed(10);
      setStrobeTrackEndSpeed(10);
      return;
    }
    const name = strobeTrackName.trim();
    if (!name) return;
    pushHistory();
    const newTrack: StrobeTrack = {
      id: `strobe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      // Auto-implémentation : la vitesse début → fin choisie dans la modale
      // est posée d'office sur la piste avec une durée par défaut de 10 s.
      entries: [{
        id: `strobe-e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: 0,
        endTime: 10,
        speed: strobeTrackSpeed,
        endSpeed: strobeTrackEndSpeed !== strobeTrackSpeed ? strobeTrackEndSpeed : strobeTrackSpeed,
      }],
      targetFixtures: {
        type: strobeTargetType,
        ...(strobeTargetType === 'group' ? { groupId: strobeTargetGroupId } : {}),
        ...(strobeTargetType === 'fixture' ? { fixtureIds: strobeTargetFixtureIds } : {}),
      },
    };
    setStrobeTracks(prev => [...prev, newTrack]);
    setStrobeTrackModal(false);
    setStrobeTrackName('');
    setStrobeTargetType('all');
    setStrobeTargetGroupId('');
    setStrobeTargetFixtureIds([]);
    setStrobeTrackSpeed(10);
    setStrobeTrackEndSpeed(10);
  }, [pushHistory, strobeTrackName, strobeTargetType, strobeTargetGroupId, strobeTargetFixtureIds, strobeTrackSpeed, strobeTrackEndSpeed, strobeEditTarget]);

  const openStrobeTrackModal = useCallback(() => {
    setStrobeTrackName('');
    setStrobeTargetType('all');
    setStrobeTargetGroupId('');
    setStrobeTargetFixtureIds([]);
    setStrobeTrackSpeed(10);
    setStrobeTrackEndSpeed(10);
    setStrobeTrackModal(true);
  }, []);

  const handleDeleteStrobeTrack = useCallback((trackId: string) => {
    pushHistory();
    setStrobeTracks(prev => prev.filter(t => t.id !== trackId));
  }, [pushHistory]);

  const handleRemoveStrobeEntry = useCallback((trackId: string, entryId: string) => {
    pushHistory();
    setStrobeTracks(prev => prev.map(t => t.id === trackId ? { ...t, entries: t.entries.filter(e => e.id !== entryId) } : t));
    setStrobeEntryMenu(null);
  }, [pushHistory]);

  const handleRenameStrobeEntry = useCallback((trackId: string, entry: StrobeTrackEntry, label: string) => {
    pushHistory();
    const trimmed = label.trim();
    setStrobeTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, entries: t.entries.map(e => e.id === entry.id ? { ...e, label: trimmed || undefined } : e) };
    }));
    setStrobeEntryMenu(null);
  }, [pushHistory]);

  const handleModifyStrobeEntry = useCallback((trackId: string, entry: StrobeTrackEntry) => {
    setStrobeEditTarget({ trackId, entryId: entry.id });
    setStrobeTrackSpeed(entry.speed);
    setStrobeTrackEndSpeed(entry.endSpeed ?? entry.speed);
    setStrobeEntryMenu(null);
    setStrobeTrackModal(true);
  }, []);

  const handleStrobeEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    pushHistory();
    setStrobeTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) {
        entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      }
      return { ...t, entries };
    }));
  }, [pushHistory]);

  const handleStrobeTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setScmPos({ x: clientX, y: clientY, type: 'track', trackId, time });
  }, []);

  const handleStrobeEntryContextMenu = useCallback((trackId: string, entry: StrobeTrackEntry, clientX: number, clientY: number) => {
    setStrobeEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);

  // ─── Dimmer Track handlers ─────────────────────────
  const handleDeleteDimmerTrack = useCallback((trackId: string) => {
    pushHistory();
    setDimmerTracks(prev => prev.filter(t => t.id !== trackId));
  }, [pushHistory]);

  const handleRemoveDimmerEntry = useCallback((trackId: string, entryId: string) => {
    pushHistory();
    setDimmerTracks(prev => prev.map(t => t.id === trackId ? { ...t, entries: t.entries.filter(e => e.id !== entryId) } : t));
    setDimmerEntryMenu(null);
  }, [pushHistory]);

  const handleRenameDimmerEntry = useCallback((trackId: string, entry: DimmerTrackEntry, label: string) => {
    pushHistory();
    const trimmed = label.trim();
    setDimmerTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, entries: t.entries.map(e => e.id === entry.id ? { ...e, label: trimmed || undefined } : e) };
    }));
    setDimmerEntryMenu(null);
  }, [pushHistory]);

  const handleModifyDimmerEntry = useCallback((trackId: string, entry: DimmerTrackEntry) => {
    setDimmerEditTarget({ trackId, entryId: entry.id });
    setDimmerTrackValue(entry.value);
    setDimmerTrackEndValue(entry.endValue ?? entry.value);
    setDimmerEntryMenu(null);
    setDimmerTrackModal(true);
  }, []);

  const handleDimmerEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    pushHistory();
    setDimmerTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) {
        entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      }
      return { ...t, entries };
    }));
  }, [pushHistory]);

  const handleDimmerTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setDimmerInsertMenu({ trackId, time, x: clientX, y: clientY });
  }, []);

  const handleDimmerEntryClick = useCallback((trackId: string, entry: DimmerTrackEntry) => {
    // Same as strobe - seek to entry time
  }, []);

  const handleDimmerEntryContextMenu = useCallback((trackId: string, entry: DimmerTrackEntry, clientX: number, clientY: number) => {
    setDimmerEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);

  const handleAddDimmerTrackFromModal = useCallback(() => {
    if (dimmerEditTarget) {
      // Mode « Modifier » : on met à jour la section existante, sans créer de piste.
      pushHistory();
      setDimmerTracks(prev => prev.map(t => {
        if (t.id !== dimmerEditTarget.trackId) return t;
        return {
          ...t,
          entries: t.entries.map(e => e.id === dimmerEditTarget.entryId
            ? { ...e, value: dimmerTrackValue, endValue: dimmerTrackEndValue !== dimmerTrackValue ? dimmerTrackEndValue : dimmerTrackValue }
            : e),
        };
      }));
      setDimmerEditTarget(null);
      setDimmerTrackModal(false);
      setDimmerTrackValue(100);
      setDimmerTrackEndValue(100);
      return;
    }
    const name = dimmerTrackName.trim();
    if (!name) return;
    pushHistory();
    const newTrack: DimmerTrack = {
      id: `dimmer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      // Auto-implémentation : la valeur début → fin choisie dans la modale
      // est posée d'office sur la piste avec une durée par défaut de 10 s.
      entries: [{
        id: `dimmer-e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: 0,
        endTime: 10,
        value: dimmerTrackValue,
        endValue: dimmerTrackEndValue !== dimmerTrackValue ? dimmerTrackEndValue : dimmerTrackValue,
      }],
      targetFixtures: {
        type: dimmerTargetType,
        ...(dimmerTargetType === 'group' && dimmerTargetGroupId ? { groupId: dimmerTargetGroupId } : {}),
        ...(dimmerTargetType === 'fixture' && dimmerTargetFixtureIds ? { fixtureIds: dimmerTargetFixtureIds } : {}),
      },
    };
    setDimmerTracks(prev => [...prev, newTrack]);
    setDimmerTrackModal(false);
    setDimmerTrackName('');
    setDimmerTargetType('all');
    setDimmerTargetGroupId('');
    setDimmerTargetFixtureIds([]);
    setDimmerTrackValue(100);
    setDimmerTrackEndValue(100);
  }, [pushHistory, dimmerTrackName, dimmerTargetType, dimmerTargetGroupId, dimmerTargetFixtureIds, dimmerTrackValue, dimmerTrackEndValue, dimmerEditTarget]);

  const openDimmerTrackModal = useCallback(() => {
    setDimmerTrackName('');
    setDimmerTargetType('all');
    setDimmerTargetGroupId('');
    setDimmerTargetFixtureIds([]);
    setDimmerTrackValue(100);
    setDimmerTrackEndValue(100);
    setDimmerTrackModal(true);
  }, []);

  /* ─── Chaser Track handlers ──────────────────────── */
  // A chaser track is NOT assigned to fixtures: the chaser itself plays its own
  // fixtures. The button creates the track then opens a picker to choose the chaser.
  const handleAddChaserTrack = useCallback(() => {
    pushHistory();
    const trackId = `chaser-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setChaserTracks(prev => [...prev, {
      id: trackId,
      name: `Chaser Track ${prev.length + 1}`,
      entries: [],
      targetFixtures: { type: 'all' }, // unused: the chaser plays its own fixtures
    }]);
    setChaserPickModal({ trackId });
  }, [pushHistory]);

  const handleDeleteChaserTrack = useCallback((trackId: string) => {
    pushHistory();
    setChaserTracks(prev => prev.filter(t => t.id !== trackId));
  }, [pushHistory]);

  const handleInsertChaserToTrack = useCallback((trackId: string, time: number, chaserId: string, chaserName?: string) => {
    pushHistory();
    // Default block length = the chaser's total cycle (plays once), clamped to a sane range
    const chaser = useShowStore.getState().chasers.find((c: any) => c.id === chaserId);
    let defDur = 10;
    if (chaser && Array.isArray(chaser.steps) && chaser.steps.length > 0) {
      const total = chaser.steps.reduce((acc: number, s: any) => acc + Math.max(1, (s.fadeIn || 0) + (s.hold || 0) + (s.fadeOut || 0)), 0);
      defDur = Math.min(120, Math.max(2, total / 1000));
    }
    setChaserTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const entry: ChaserTrackEntry = {
        id: `chaser-e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time,
        endTime: time + defDur,
        chaserId,
        chaserName: chaserName || chaser?.name,
      };
      return { ...t, entries: [...t.entries, entry] };
    }));
    setChaserInsertMenu(null);
  }, [pushHistory]);

  const handleRemoveChaserEntry = useCallback((trackId: string, entryId: string) => {
    pushHistory();
    setChaserTracks(prev => prev.map(t => t.id === trackId ? { ...t, entries: t.entries.filter(e => e.id !== entryId) } : t));
    setChaserEntryMenu(null);
  }, [pushHistory]);

  const handleChaserEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    pushHistory();
    setChaserTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) {
        entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      }
      return { ...t, entries };
    }));
  }, [pushHistory]);

  const handleChaserTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setChaserInsertMenu({ trackId, time, x: clientX, y: clientY });
  }, []);

  const handleChaserEntryClick = useCallback((trackId: string, entry: ChaserTrackEntry) => {
    // Seek handled by TrackTimeline; nothing else to do here
  }, []);

  const handleChaserEntryContextMenu = useCallback((trackId: string, entry: ChaserTrackEntry, clientX: number, clientY: number) => {
    setChaserEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);

  const handlePickChaserForTrack = useCallback((trackId: string, chaserId: string, chaserName?: string) => {
    handleInsertChaserToTrack(trackId, 0, chaserId, chaserName);
    setChaserPickModal(null);
  }, [handleInsertChaserToTrack]);

  const handleAddShowTrack = useCallback(() => {
    pushHistory();
    const trackId = `show-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setShowTracks(prev => [...prev, { id: trackId, name: `Show Track ${prev.length + 1}`, entries: [] }]);
    setShowPickModal({ trackId });
  }, [pushHistory]);
  const handleDeleteShowTrack = useCallback((trackId: string) => {
    pushHistory();
    setShowTracks(prev => prev.filter(t => t.id !== trackId));
  }, [pushHistory]);
  const handleInsertShowToTrack = useCallback((trackId: string, time: number, showId: string, showName?: string) => {
    pushHistory();
    const show = useShowStore.getState().shows.find((s: any) => s.id === showId);
    let defDur = 30;
    if (show && show.duration > 0) defDur = Math.min(120, Math.max(2, show.duration / 1000));
    setShowTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const entry: ShowTrackEntry = { id: `show-e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, time, endTime: time + defDur, showId, showName: showName || show?.name };
      return { ...t, entries: [...t.entries, entry] };
    }));
    setShowInsertMenu(null);
  }, [pushHistory]);
  const handleRemoveShowEntry = useCallback((trackId: string, entryId: string) => {
    pushHistory();
    setShowTracks(prev => prev.map(t => t.id === trackId ? { ...t, entries: t.entries.filter(e => e.id !== entryId) } : t));
    setShowEntryMenu(null);
  }, [pushHistory]);
  const handleShowEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    pushHistory();
    setShowTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >=0 && entryIndex < entries.length) entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      return { ...t, entries };
    }));
  }, [pushHistory]);
  const handleShowTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setShowInsertMenu({ trackId, time, x: clientX, y: clientY });
  }, []);
  const handleShowEntryClick = useCallback((trackId: string, entry: ShowTrackEntry) => {}, []);
  const handleShowEntryContextMenu = useCallback((trackId: string, entry: ShowTrackEntry, clientX: number, clientY: number) => {
    setShowEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);
  const handlePickShowForTrack = useCallback((trackId: string, showId: string, showName?: string) => {
    handleInsertShowToTrack(trackId, 0, showId, showName);
    setShowPickModal(null);
  }, [handleInsertShowToTrack]);

  /* ─── Insert entity handler ──────────────────────── */
  const handleInsertEntity = useCallback((startTime: number, endTime: number, entityType: string, entityId: string) => {
    pushHistory();
    const newCues = expandEntityToCues(
      entityType, entityId, startTime, endTime,
      sections, effectiveBpm, qs.beatDivision || 4,
      qs, sceneEntities, chaserEntities, cueListEntities, effectEntities,
    );
    const newManualCues = newCues.map((c: any) => ({
      time: c.time,
      section: c.section,
      universe: 0,
      channelValues: {},
      fixtureNames: [],
      fixtureCount: 0,
      effect: c.effect,
      colors: c.colors,
      manual: true,
    } as DmxCue));
    setManualCues(prev => [...prev, ...newManualCues]);
  }, [pushHistory, sections, effectiveBpm, qs, sceneEntities, chaserEntities, cueListEntities, effectEntities]);

  /* ─── New audio file ─────────────────────────────── */
  const handleNewAudioFile = useCallback(() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/*';
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      pushHistory();
      setSections([]);
      setManualCues([]);
      setEfxTracks([]);
      await audioFile.loadFile(file);
    };
    inp.click();
  }, [pushHistory, audioFile]);

  /* ─── Tap BPM ────────────────────────────────────── */
  const handleTap = useCallback(() => {
    const now = performance.now();
    tapRef.current.push(now);
    if (tapRef.current.length > 8) tapRef.current.shift();
    if (tapRef.current.length >= 2) {
      const intervals = tapRef.current.slice(1).map((t, i) => t - tapRef.current[i]);
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round(60000 / avgMs);
      setTapBpm(bpm);
      setSyncMode('tap');
    }
  }, []);

  /* ─── Clamp tier overrides ───────────────────────── */
  const handleTierChange = useCallback((tier: 'primary' | 'secondary' | 'tertiary', value: number) => {
    const tc = { ...(qs.tierConfig || { primary: 100, secondary: 70, tertiary: 40 }), [tier]: Math.max(0, Math.min(100, value)) };
    setQs({ tierConfig: tc });
  }, [qs.tierConfig, setQs]);

  /* ─── No analysis fallback ───────────────────────── */
  if (!hasEverHadAnalysis) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Upload className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-sm mb-2">{t('dropAudio') || 'Drop an audio file to start'}</p>
          <AudioFileUpload externalState={audioFile} />
          <div className="mt-4">
            <button
              onClick={() => loadPresetFile()}
              className="px-3 py-1.5 rounded bg-yellow-600/20 border border-yellow-500/30 text-yellow-300 text-xs hover:bg-yellow-600/30"
            >
              <Layers className="w-3.5 h-3.5 inline mr-1" />
              Charger un preset
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (audioFile.isAnalyzing) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
          <p className="text-gray-400 text-sm">{t('analyzing') || 'Analyzing audio...'}</p>
        </div>
      </div>
    );
  }

  if (!resolvedAnalysis) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Upload className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">{t('dropAudio') || 'Upload audio to analyze'}</p>
          <AudioFileUpload externalState={audioFile} />
          <div className="mt-4">
            <button
              onClick={() => loadPresetFile()}
              className="px-3 py-1.5 rounded bg-yellow-600/20 border border-yellow-500/30 text-yellow-300 text-xs hover:bg-yellow-600/30"
            >
              <Layers className="w-3.5 h-3.5 inline mr-1" />
              Charger un preset
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800/50 bg-[#0d0d14] flex-wrap">
        {/* DMX Toggle */}
        <button
          title={t('dmxOutput') || 'DMX Output'}
          onClick={() => setDmxOutputEnabled(v => !v)}
          className={`p-1.5 rounded ${dmxOutputEnabled ? 'text-green-400 bg-green-400/10' : 'text-gray-600 bg-gray-800/50'}`}
        >
          {dmxOutputEnabled ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
        </button>

        {/* Dry-run toggle */}
        <button
          title={'Dry-run preview (no hardware DMX)'}
          onClick={() => setDryRunMode(v => !v)}
          className={`p-1.5 rounded text-[10px] font-mono font-bold ${dryRunMode ? 'text-amber-400 bg-amber-400/10' : 'text-gray-600 bg-gray-800/50'}`}
        >
          DRY
        </button>

        {/* Freeze hold */}
        <button
          title={frozen ? 'Unfreeze (resume playback)' : 'Freeze (hold current DMX frame)'}
          onClick={() => { setFrozen(v => { frozenRef.current = !v; return !v; }); }}
          className={`p-1.5 rounded text-[10px] font-mono font-bold ${frozen ? 'text-cyan-400 bg-cyan-400/10' : 'text-gray-600 bg-gray-800/50'}`}
        >
          <Snowflake className="w-3 h-3" />
        </button>

        {/* Drop Now */}
        <button
          title="Force a drop (max energy + strobe for 300ms)"
          onClick={() => { forceDropRef.current = true; }}
          className="p-1.5 rounded text-gray-600 bg-gray-800/50 hover:text-red-400 hover:bg-red-400/5"
        >
          <Zap className="w-3.5 h-3.5" />
        </button>

        {/* Divider */}
        <span className="w-px h-5 bg-gray-700/50" />

        {/* A/B Compare */}
        {cuesB.length > 0 ? (
          <button
            title={showB ? 'Switch to style A' : 'Switch to style B (' + compareStyle + ')'}
            onClick={() => setShowB(v => !v)}
            className={`p-1.5 rounded text-[10px] font-mono font-bold ${showB ? 'text-amber-400 bg-amber-400/10' : 'text-gray-500 bg-gray-800/50'}`}
          >
            {showB ? 'B' : 'A'}
          </button>
        ) : (
          <button
            title="Generate B cues with different style for comparison"
            onClick={() => {
              const styleB = qs.musicStyle === 'techno' ? 'house' : 'techno';
              const qsB = { ...qs, musicStyle: styleB };
              const b = genCues(sections, effectiveBpm, qs.beatDivision || 4, qsB, manualCues, key + '_b', resolvedAnalysis);
              setCuesB(b);
              setCompareStyle(styleB);
            }}
            className="p-1.5 rounded text-gray-600 bg-gray-800/50 hover:text-amber-400 hover:bg-amber-400/5"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Divider */}
        <span className="w-px h-5 bg-gray-700/50" />

        {/* Group selector */}
        <select
          value={selectedGroupId}
          onChange={e => setSelectedGroupId(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">{t('allFixtures') || 'All Fixtures'}</option>
          {fixtureGroups.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        {/* Sync mode */}
        <Chip
          active={syncMode === 'internal'}
          onClick={() => setSyncMode('internal')}
          label={t('internal') || 'Internal'}
          color="purple"
        />
        <Chip
          active={syncMode === 'manual'}
          onClick={() => setSyncMode('manual')}
          label={t('manual') || 'Manual'}
          color="blue"
        />
        <Chip
          active={syncMode === 'tap'}
          onClick={handleTap}
          label={`Tap ${tapBpm || ''}`}
          color="green"
        />

        {syncMode === 'manual' && (
          <input
            type="number"
            min={40}
            max={300}
            value={manualBpm}
            onChange={e => setManualBpm(Number(e.target.value))}
            className="w-14 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-300"
          />
        )}

        <div className="h-5 border-l border-gray-700 mx-1" />

        {/* Undo / Redo */}
        <button title="Undo" onClick={undo} disabled={!canUndo} className={`p-1 rounded ${canUndo ? 'text-gray-400 hover:text-white' : 'text-gray-700'}`}>
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button title="Redo" onClick={redo} disabled={!canRedo} className={`p-1 rounded ${canRedo ? 'text-gray-400 hover:text-white' : 'text-gray-700'}`}>
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        {/* Save / Load */}
        <button title={t('save') || 'Save'} onClick={() => saveProject(resolvedAnalysis, sections, qs, audioFile, manualCues, efxTracks, fixtureTracks, colorTracks, strobeTracks, dimmerTracks, chaserTracks, showTracks, sceneTracks, disabledFixtures)} className="p-1 rounded text-gray-400 hover:text-white">
          <Save className="w-3.5 h-3.5" />
        </button>
        <button title={t('open') || 'Open'} onClick={() => loadProject(setQs, audioFile, setSections, setManualCues, setEfxTracks, setFixtureTracks, setColorTracks, setStrobeTracks, setDimmerTracks, setChaserTracks, setShowTracks, setSceneTracks, setDisabledFixtures, setFixtureDefs)} className="p-1 rounded text-gray-400 hover:text-white">
          <FolderOpen className="w-3.5 h-3.5" />
        </button>
        <button title={t('clear') || 'Clear'} onClick={clearAudio} className="p-1 rounded text-gray-400 hover:text-red-400">
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <div className="h-5 border-l border-gray-700 mx-1" />

        {/* New audio file */}
        <button title="Nouveau fichier audio" onClick={handleNewAudioFile} className="p-1 rounded text-gray-400 hover:text-green-400">
          <Music className="w-3.5 h-3.5" />
        </button>

        {/* Presets dropdown */}
        <div className="relative">
          <button
            ref={presetsBtnRef}
            onClick={() => setPresetsDropdown(v => !v)}
            className="p-1 rounded text-gray-400 hover:text-yellow-400"
            title="Presets"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
          {presetsDropdown && (
            <div className="absolute top-full right-0 mt-1 z-50 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[220px]">
              <button onClick={() => { setPresetsDropdown(false); setPromptAction('save'); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                <Save className="w-3 h-3" /> Save Preset
              </button>
              <button onClick={() => { setPresetsDropdown(false); loadPresetFile(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                <FolderOpen className="w-3 h-3" /> Load from file...
              </button>
              <button onClick={() => { setPresetsDropdown(false); setPromptAction('export'); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                <Download className="w-3 h-3" /> Export to file...
              </button>
              {savedPresets.length > 0 && <div className="border-t border-gray-800 my-0.5" />}
              {savedPresets.map((p, i) => (
                <div key={i} className="flex items-center hover:bg-gray-800">
                  <button onClick={() => handleLoadPreset(p)} className="flex-1 text-left px-3 py-1.5 text-xs text-gray-300 truncate">
                    {p.name}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeletePreset(i); }} className="px-1.5 py-1 text-gray-600 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {savedPresets.length === 0 && (
                <div className="px-3 py-1.5 text-[10px] text-gray-600 italic">No saved presets</div>
              )}
            </div>
          )}
        </div>

        <div className="h-5 border-l border-gray-700 mx-1" />

        {/* Regenerate */}
        <button
          title={t('regenerate') || 'Regenerate AutoScript'}
          onClick={() => setKey(k => k + 1)}
          className="p-1 rounded text-gray-400 hover:text-purple-400 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <div className="h-5 border-l border-gray-700 mx-1" />

        {/* Color scheme — Palette : les couleurs émises (gamme visuelle) */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider select-none">Palette</span>
          <select
            value={qs.colorScheme || 'auto'}
            onChange={e => setQs({ colorScheme: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
            title="Palette de couleurs : seule la gamme visuelle (roues couleur / RGB) change. « Auto » détecte la couleur dominante de l'analyse audio."
          >
            {['auto', 'warm', 'cool', 'party', 'monochrome', 'neon', 'pastel', 'dance', 'disco', 'techno', 'rock', 'rnb', 'reggaeton', 'latino', 'electro', 'house', 'dubstep', 'hiphop', 'funk'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Genre — Style/Rythme : la grammaire du show (mouvements, strobe, énergie) */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-wider select-none">Style</span>
          <select
            value={qs.musicStyle || 'dance'}
            onChange={e => setQs({ musicStyle: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
            title="Style musical : structure rythmique du show (patterns de mouvement, strobe, intensité par section). « Auto » suit le genre détecté de l'analyse audio."
          >
            {['dance','techno','house','hiphop','dubstep','drum_and_bass','trance','disco','electro','pop','rock','rnb','reggaeton','latino','funk','ballad','reggae','trap','jazz','blues','latin','lo_fi','ambient'].map(s => (
              <option key={s} value={s}>{(s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* Beat division */}
        <select
          value={qs.beatDivision || 4}
          onChange={e => setQs({ beatDivision: Number(e.target.value) as any })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          {[1, 2, 4, 8].map(d => (
            <option key={d} value={d}>1/{d}</option>
          ))}
        </select>

        {/* Intensity */}
        <select
          value={qs.intensity || 'dynamic'}
          onChange={e => setQs({ intensity: e.target.value as any })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          {['very-low','low','medium','high','very-high','dynamic'].map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>

        {/* Movement type */}
        <select
          value={qs.movement || 'dynamic'}
          onChange={e => setQs({ movement: e.target.value as any })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          {['smooth','sharp','dynamic'].map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        {/* Section aware */}
        <Chip
          active={qs.sectionAware !== false}
          onClick={() => setQs({ sectionAware: !(qs.sectionAware !== false) })}
          label="Section"
          icon={<Layers className="w-3 h-3" />}
        />

        {/* Scènes dans l'autoscript */}
        <Chip
          active={!!qs.useScenesInAutoscript}
          onClick={() => setQs({ useScenesInAutoscript: !qs.useScenesInAutoscript })}
          label="Scènes"
          icon={<Sparkles className="w-3 h-3" />}
        />
        {qs.useScenesInAutoscript && (
          <input type="range" min={0} max={100} step={5} value={qs.scenesAutoscriptWeight ?? 30}
            onChange={(e) => setQs({ scenesAutoscriptWeight: Number(e.target.value) })}
            className="w-16 accent-purple-500" title={`${qs.scenesAutoscriptWeight ?? 30}%`} />
        )}

        {/* Audio Reactive */}
        <Chip
          active={qs.audioReactive !== false}
          onClick={() => setQs({ audioReactive: !(qs.audioReactive !== false) })}
          label="Audio"
          icon={<Zap className="w-3 h-3" />}
        />

        {/* Strobe limit */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-600">⚡</span>
          <input
            type="range"
            min={1}
            max={25}
            value={qs.strobeLimit || 10}
            onChange={e => setQs({ strobeLimit: Number(e.target.value) })}
            className="w-16"
          />
          <span className="text-[9px] text-gray-500 w-5">{qs.strobeLimit || 10}</span>
        </div>

        {/* Pan max / Tilt max — limite le balayage des têtes mobiles */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-600">Pan</span>
          <input
            type="range"
            min={0}
            max={270}
            value={qs.panMaxDeg ?? 270}
            onChange={e => setQs({ panMaxDeg: Number(e.target.value) })}
            className="w-16"
          />
          <span className="text-[9px] text-gray-500 w-8">{qs.panMaxDeg ?? 270}°</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-600">Tilt</span>
          <input
            type="range"
            min={0}
            max={90}
            value={qs.tiltMaxDeg ?? 90}
            onChange={e => setQs({ tiltMaxDeg: Number(e.target.value) })}
            className="w-16"
          />
          <span className="text-[9px] text-gray-500 w-8">{qs.tiltMaxDeg ?? 90}°</span>
        </div>
      </div>

      {/* Row 2: Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/30 bg-[#0a0a0f] flex-wrap">
        {/* Tier mix */}
        <details className="text-xs text-gray-500 cursor-pointer">
          <summary className="text-[10px]">{t('tierMix') || 'Tier Mix'}</summary>
          <div className="flex items-center gap-3 mt-1 bg-[#0d0d14] rounded p-2">
            <label className="flex items-center gap-1 text-[9px]">
              <span className="text-purple-400">1°</span>
              <input type="range" min={0} max={100} value={qs.tierConfig?.primary || 100} onChange={e => handleTierChange('primary', Number(e.target.value))} className="w-16" />
              <span>{qs.tierConfig?.primary || 100}%</span>
            </label>
            <label className="flex items-center gap-1 text-[9px]">
              <span className="text-blue-400">2°</span>
              <input type="range" min={0} max={100} value={qs.tierConfig?.secondary || 70} onChange={e => handleTierChange('secondary', Number(e.target.value))} className="w-16" />
              <span>{qs.tierConfig?.secondary || 70}%</span>
            </label>
            <label className="flex items-center gap-1 text-[9px]">
              <span className="text-gray-400">3°</span>
              <input type="range" min={0} max={100} value={qs.tierConfig?.tertiary || 40} onChange={e => handleTierChange('tertiary', Number(e.target.value))} className="w-16" />
              <span>{qs.tierConfig?.tertiary || 40}%</span>
            </label>
          </div>
        </details>

        {movingHeads.length > 0 && (
          <div className="relative">
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer text-[10px] select-none">Limites par head ({movingHeads.length})</summary>
              <div className="absolute z-30 left-0 top-full mt-1 bg-[#0d0d14] border border-gray-800 rounded p-2 shadow-2xl max-h-72 overflow-y-auto min-w-[250px]">
                {movingHeads.map(pf => {
                  const panDeg = qs.forcedPanMaxDeg?.[pf.id] ?? qs.panMaxDeg ?? 270;
                  const tiltDeg = qs.forcedTiltMaxDeg?.[pf.id] ?? qs.tiltMaxDeg ?? 90;
                  const hasOverride = qs.forcedPanMaxDeg?.[pf.id] !== undefined || qs.forcedTiltMaxDeg?.[pf.id] !== undefined;
                  return (
                    <div key={pf.id} className="flex items-center gap-2 py-1 border-b border-gray-800/40 last:border-0">
                      <span className="text-[10px] text-gray-300 w-24 truncate" title={pf.name}>{pf.name || pf.id.slice(0, 6)}</span>
                      <label className="flex items-center gap-1 text-[9px]">
                        <span className="text-purple-400">P</span>
                        <input type="range" min={0} max={270} value={panDeg} onChange={e => setForcedPanMax(pf.id, Number(e.target.value))} className="w-12" />
                        <span className={qs.forcedPanMaxDeg?.[pf.id] !== undefined ? 'text-purple-300 w-7' : 'text-gray-600 w-7'}>{panDeg}°</span>
                      </label>
                      <label className="flex items-center gap-1 text-[9px]">
                        <span className="text-blue-400">T</span>
                        <input type="range" min={0} max={90} value={tiltDeg} onChange={e => setForcedTiltMax(pf.id, Number(e.target.value))} className="w-12" />
                        <span className={qs.forcedTiltMaxDeg?.[pf.id] !== undefined ? 'text-blue-300 w-7' : 'text-gray-600 w-7'}>{tiltDeg}°</span>
                      </label>
                      {hasOverride && (
                        <button className="text-[9px] text-gray-500 hover:text-red-400 px-1" title="Réinitialiser" onClick={() => { setForcedPanMax(pf.id, null); setForcedTiltMax(pf.id, null); }}>✕</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        )}

        <div className="flex-1" />

        {/* Section info */}
        <span className="text-[9px] text-gray-600">
          BPM: {effectiveBpm} · {t('sections') || 'Sections'}: {sections.length}
          {resolvedAnalysis?.key && ` · Key: ${resolvedAnalysis.key}`}
          {resolvedAnalysis?.atmosphere && ` · ${resolvedAnalysis.atmosphere}`}
        </span>
      </div>

      {/* Audio waveform + upload — séparatrices déplacées ici (piste audio uniquement) */}
      <div className="px-3 pt-2">
        <AudioFileUpload
          externalState={audioFile}
          onSelectionChange={onSelChange}
          onSectionClick={onSectionClick}
          onSectionsChange={(next) => { pushHistory(); setSections(next); }}
          sections={sections}
          onInsertEntity={handleInsertEntity}
          scenes={entitySceneList}
          chasers={entityChaserList}
          cueLists={entityCueListList}
          effects={entityEffectList}
        />
      </div>

      {/* TrackTimeline */}
      <div className="flex-1 px-3 py-2 overflow-y-auto overflow-x-hidden">
        <TrackTimeline
          cues={cues as any}
          dmxCues={dmxCues}
          duration={resolvedAnalysis?.duration || 120}
          currentTime={audioFile.currentTime}
          onSeek={(t: number) => { audioFile.seek(t); }}
          sections={sections}
          patchedFixtures={patchedFixtures}
          bpm={effectiveBpm}
          efxTracks={efxTracks}
          onEfxTrackContextMenu={handleEfxTrackContextMenu}
          onEfxEntryContextMenu={handleEfxEntryContextMenu}
          colorTracks={colorTracks}
          onColorTrackContextMenu={handleColorTrackContextMenu}
          onColorEntryChange={handleColorEntryChange}
          onColorEntryContextMenu={handleColorEntryContextMenu}
          strobeTracks={strobeTracks}
          onStrobeTrackContextMenu={handleStrobeTrackContextMenu}
          onStrobeEntryClick={(trackId, entry) => {
            audioFile.seek(entry.time);
          }}
          onStrobeEntryContextMenu={handleStrobeEntryContextMenu}
          onStrobeEntryChange={handleStrobeEntryChange}
          dimmerTracks={dimmerTracks}
          onDimmerTrackContextMenu={handleDimmerTrackContextMenu}
          onDimmerEntryClick={handleDimmerEntryClick}
          onDimmerEntryContextMenu={handleDimmerEntryContextMenu}
          onDimmerEntryChange={handleDimmerEntryChange}
          chaserTracks={chaserTracks}
          onChaserTrackContextMenu={handleChaserTrackContextMenu}
          onChaserEntryClick={handleChaserEntryClick}
          onChaserEntryContextMenu={handleChaserEntryContextMenu}
          onChaserEntryChange={handleChaserEntryChange}
          showTracks={showTracks}
          onShowTrackContextMenu={handleShowTrackContextMenu}
          onShowEntryClick={handleShowEntryClick}
          onShowEntryContextMenu={handleShowEntryContextMenu}
          onShowEntryChange={handleShowEntryChange}
          onSectionsChange={(newSecs: TrackSection[]) => { pushHistory(); setSections(newSecs); }}
          onAutoScriptContextMenu={(time, _x, _y) => {
            pushHistory();
            setSections(prev => {
              if (prev.length === 0) {
                const dur = resolvedAnalysis?.duration || 120;
                const halfSec = 5;
                const start = Math.max(0, time - halfSec);
                const end = Math.min(dur, time + halfSec);
                if (end - start < 0.5) return prev;
                const newSection: TrackSection = {
                  type: 'verse',
                  startTime: start,
                  endTime: end,
                  energy: 0.5,
                  color: '',
                };
                return [newSection];
              }
              const sorted = [...prev].sort((a, b) => a.startTime - b.startTime);
              for (let i = 0; i < sorted.length; i++) {
                const s = sorted[i];
                if (time > s.startTime && time < s.endTime) {
                  if (time - s.startTime < 0.15 || s.endTime - time < 0.15) return prev;
                  const before: TrackSection = { ...s, endTime: time };
                  const after: TrackSection = { ...s, startTime: time };
                  return [...sorted.slice(0, i), before, after, ...sorted.slice(i + 1)];
                }
              }
              return prev;
            });
          }}
          fixtureTracks={fixtureTracks}
          onFixtureTracksChange={setFixtureTracks}
          showStrobeTrack={qs.showStrobeTrack}
          showDimmerTrack={qs.showDimmerTrack}
          showColorTrack={qs.showColorTrack}
          forcedColors={qs.forcedColors}
          forcedDimmer={qs.forcedDimmer}
          forcedStrobe={qs.forcedStrobe}
          colorEntries={qs.colorEntries}
          dimmerEntries={qs.dimmerEntries}
          strobeEntries={qs.strobeEntries}
          onEfxEntryClick={(trackId, entry) => {
            audioFile.seek(entry.time);
          }}
          onEfxEntryChange={(trackId, entryIdx, updates) => {
            pushHistory();
            setEfxTracks(prev => prev.map(t => {
              if (t.id !== trackId) return t;
              const entries = [...t.entries];
              entries[entryIdx] = { ...entries[entryIdx], ...updates };
              entries.sort((a, b) => a.time - b.time);
              return { ...t, entries };
            }));
          }}
          disabledFixtures={disabledFixtures}
          onToggleFixture={handleToggleFixture}
          energyCurve={resolvedAnalysis?.energyCurve}
          cueMarkers={dmxCues}
        />
      </div>

      {/* Section editor bar */}
      <div className="px-3 py-2 border-t border-gray-800/50 bg-[#0d0d14] flex items-center gap-1.5 flex-wrap">
        {sections.length > 0 && (
          <>
            <span className="text-[10px] text-gray-500 mr-1">{t('sections') || 'Sections'}:</span>
            {sections.map((s, i) => (
              <button
                key={i}
                onClick={() => onSectionClick(i)}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border cursor-pointer"
                style={{ borderColor: s.color, color: s.color, backgroundColor: s.color + '15' }}
              >
                <span>{s.type}</span>
                <span className="text-gray-600 text-[8px]">{s.startTime.toFixed(1)}s</span>
              </button>
            ))}
          </>
        )}
        <button
          onClick={openEfxTrackModal}
          className="ml-2 px-2 py-0.5 rounded text-[10px] text-cyan-400 border border-cyan-700/50 hover:bg-cyan-400/10 cursor-pointer flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          EFX Track
        </button>
        <button
          onClick={openColorTrackModal}
          className="ml-1 px-2 py-0.5 rounded text-[10px] text-pink-400 border border-pink-700/50 hover:bg-pink-400/10 cursor-pointer flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Color Track
        </button>
        <button
          onClick={openStrobeTrackModal}
          className="ml-1 px-2 py-0.5 rounded text-[10px] text-purple-400 border border-purple-700/50 hover:bg-purple-400/10 cursor-pointer flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Strobe Track
        </button>
        <button
          onClick={openDimmerTrackModal}
          className="ml-1 px-2 py-0.5 rounded text-[10px] text-orange-400 border border-orange-700/50 hover:bg-orange-400/10 cursor-pointer flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Dimmer Track
        </button>
        <button
          onClick={handleAddChaserTrack}
          className="ml-1 px-2 py-0.5 rounded text-[10px] text-emerald-400 border border-emerald-700/50 hover:bg-emerald-400/10 cursor-pointer flex items-center gap-1"
          title="Piste de chaser : importe un chaser qui prend la main sur ses fixtures pendant sa plage"
        >
          <Plus className="w-3 h-3" />
          Chaser Track
        </button>
        <button
          onClick={handleAddShowTrack}
          className="ml-1 px-2 py-0.5 rounded text-[10px] text-amber-400 border border-amber-700/50 hover:bg-amber-400/10 cursor-pointer flex items-center gap-1"
          title="Piste de show : importe un show complet qui prend le dessus sur l'autoscript pendant sa plage"
        >
          <Plus className="w-3 h-3" />
          Show Track
        </button>
        <button
          onClick={() => setFadeModal(!fadeModal)}
          className="ml-1 px-2 py-0.5 rounded text-[10px] text-purple-400 border border-purple-700/50 hover:bg-purple-400/10 cursor-pointer flex items-center gap-1"
          title="Fondu"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.3"/><circle cx="12" cy="12" r="10" strokeDasharray="32 31"/></svg>
          Fade
        </button>
        {fadeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setFadeModal(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative bg-[#1a1a2e] border border-purple-700/40 rounded-xl shadow-2xl p-6 min-w-[300px] max-w-[360px]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.3"/><circle cx="12" cy="12" r="10" strokeDasharray={`${((qs.colorFadeMs || 250) / 2000) * 63} 63`}/></svg>
                <span className="text-sm font-medium text-gray-200">Fondu enchaîné</span>
                <span className="ml-auto text-lg font-bold text-purple-400">{qs.colorFadeMs || 250}<span className="text-xs text-gray-500 ml-0.5">ms</span></span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed mb-4">Vous pouvez régler ici le temps de transition entre vos couleurs. Une valeur plus élevée donne un morphing progressif, idéal pour les ambiances douces.</p>
              <input type="range" min={0} max={2000} step={50} value={qs.colorFadeMs || 250} onChange={e => setQs({ colorFadeMs: Number(e.target.value) })} className="w-full accent-purple-500" />
              <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                <span>Instantané</span>
                <span>2 secondes</span>
              </div>
              <div className="flex gap-2 mt-4">
                {[0, 250, 500, 1000].map(v => (
                  <button key={v} onClick={() => setQs({ colorFadeMs: v })} className={`flex-1 py-1 rounded text-[10px] border transition-colors ${(qs.colorFadeMs || 250) === v ? 'border-purple-500 bg-purple-500/20 text-purple-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>{v === 0 ? '0ms' : v + 'ms'}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section picker — remplacé par modale précise (garde compatibilité si ouvert via timeline) */}
      {picker !== null && !sectionModal && (() => { setSectionModal({ idx: picker.idx }); setPicker(null); return null; })()}
      {/* Section modal précise */}
      {sectionModal !== null && (() => {
        const s = sections[sectionModal.idx];
        if (!s) return null;
        const dur = resolvedAnalysis?.duration || 120;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSectionModal(null)}>
            <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 w-[380px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h4 className="text-sm font-bold text-white mb-3">Section — précision</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] text-gray-500">Type</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(['intro', 'verse', 'chorus', 'bridge', 'drop', 'outro', 'build', 'unknown'] as TrackSection['type'][]).map(type => (
                      <button key={type} onClick={() => changeType(sectionModal.idx, type)}
                        className={`px-2 py-1 rounded text-xs capitalize border flex items-center gap-1 ${s.type === type ? 'bg-purple-600 text-white border-purple-500' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'}`}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SECTION_COLORS[type] || '#4b5563' }} />{type}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-gray-500">Début (s)</label>
                    <input type="number" step="0.01" min={0} max={dur} defaultValue={s.startTime} id="__sec_start"
                      className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 outline-none focus:border-purple-500" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500">Fin (s)</label>
                    <input type="number" step="0.01" min={0} max={dur} defaultValue={s.endTime} id="__sec_end"
                      className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 outline-none focus:border-purple-500" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-600">Ex: intro 0 → 15.25s. Durée audio {dur.toFixed(2)}s.</p>
              </div>
              <div className="flex justify-between gap-2 mt-5">
                <button onClick={() => { pushHistory(); setSections(prev => prev.filter((_, i) => i !== sectionModal.idx)); setSectionModal(null); }} className="px-3 py-1.5 bg-red-600/20 text-red-300 rounded text-xs hover:bg-red-600/30">Supprimer</button>
                <div className="flex gap-2">
                  <button onClick={() => setSectionModal(null)} className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-xs">Annuler</button>
                  <button onClick={() => {
                    const st = Number((document.getElementById('__sec_start') as HTMLInputElement).value);
                    const en = Number((document.getElementById('__sec_end') as HTMLInputElement).value);
                    if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st || st < 0 || en > dur) return;
                    pushHistory();
                    setSections(prev => {
                      const idx = sectionModal.idx;
                      const edited = { ...prev[idx], startTime: st, endTime: en };
                      const minLen = 0.05;
                      let out: typeof prev = [];
                      for (let i = 0; i < prev.length; i++) {
                        if (i === idx) continue;
                        const s = prev[i];
                        const noOverlap = s.endTime <= st + 1e-9 || s.startTime >= en - 1e-9;
                        if (noOverlap) { out.push(s); continue; }
                        const straddles = s.startTime < st - 1e-9 && s.endTime > en + 1e-9;
                        if (straddles) {
                          if (s.startTime < st - minLen) out.push({ ...s, endTime: st });
                          if (en + minLen < s.endTime) out.push({ ...s, startTime: en });
                          continue;
                        }
                        if (s.startTime < st && s.endTime > st) {
                          if (s.startTime < st - minLen) out.push({ ...s, endTime: st });
                          continue;
                        }
                        if (s.startTime < en && s.endTime > en) {
                          if (en + minLen < s.endTime) out.push({ ...s, startTime: en });
                          continue;
                        }
                        // fully inside -> effacé
                      }
                      out.push(edited);
                      out.sort((a,b)=>a.startTime-b.startTime);
                      return out.filter(s=>s.endTime - s.startTime > minLen);
                    });
                    setSectionModal(null);
                  }} className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs hover:bg-purple-500">Appliquer</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {false && (
        <div className="fixed z-50 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{ ...clampRect(picker?.x || 0, picker?.y || 0, 220, 320, window.innerWidth, window.innerHeight) }}

        >
          {(['intro', 'verse', 'chorus', 'bridge', 'drop', 'outro', 'build', 'unknown'] as TrackSection['type'][]).map(type => (
            <button key={type}
              onClick={() => { changeType(picker!.idx, type); setPicker(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 capitalize flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SECTION_COLORS[type] || '#4b5563' }} />
              {type}
            </button>
          ))}
          <div className="border-t border-gray-800 my-0.5" />
          <div className="px-3 py-1 text-[9px] text-gray-600 uppercase">Palette</div>
          {(customPal[sections[picker.idx]?.type as keyof CustomPalette] || []).map((color, ci) => (
            <button key={ci}
              onClick={() => handleColorPick(sections[picker.idx]?.type || 'unknown', ci)}
              className="w-full text-left px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              onContextMenu={(e) => { e.preventDefault(); removeCustomColor(sections[picker.idx]?.type || 'unknown', ci); }}
            >
              <span className="w-3 h-3 rounded border border-gray-600" style={{ backgroundColor: color }} />
              {color}
            </button>
          ))}
          <button
            onClick={() => triggerAddColor((sections[picker.idx]?.type || 'unknown') as keyof CustomPalette)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800 flex items-center gap-2"
          >
            <Plus className="w-3 h-3" /> Add color
          </button>
          <button
            onClick={() => { resetSectionColors(sections[picker.idx]?.type || 'unknown'); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-red-400 hover:bg-gray-800"
          >
            Reset section
          </button>
          <button
            onClick={() => { resetAllCustomColors(); }}
            className="w-full text-left px-3 py-1.5 text-[10px] text-red-400 hover:bg-gray-800"
          >
            Reset all
          </button>
          <button
            onClick={() => setPicker(null)}
            className="w-full text-left px-3 py-1.5 text-[10px] text-gray-500 hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      )}


      {/* ── Color Gradient Picker Modal ── */}
      {gradientPicker !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative z-10 bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-6 w-[420px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Palette className="w-4 h-4 text-purple-400" /><span className="text-sm font-semibold text-gray-200">Choix de couleur</span></div>
              <button className="text-gray-500 hover:text-white text-lg px-1" onClick={() => setGradientPicker(null)}>✕</button>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 mb-4">
              <div className="flex items-start gap-2 mb-2"><span className="w-5 h-5 rounded-full bg-purple-500/30 text-purple-300 text-[10px] flex items-center justify-center font-bold shrink-0 mt-0.5">1</span><p className="text-[11px] text-gray-400 leading-relaxed">Choisissez votre <b className="text-purple-300">couleur de départ</b>. Elle servira de teinte dominante pour ce cue.</p></div>
              <div className="flex items-start gap-2"><span className="w-5 h-5 rounded-full bg-cyan-500/30 text-cyan-300 text-[10px] flex items-center justify-center font-bold shrink-0 mt-0.5">2</span><p className="text-[11px] text-gray-400 leading-relaxed">Choisissez une <b className="text-cyan-300">couleur d'arrivée</b> différente pour un dégradé progressif, ou identique pour une teinte constante.</p></div>
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
              <button onClick={() => { if (!gradientPicker) return; const { sectionType, colorIdx, endColor, startColor } = gradientPicker; const arr = [...(customPal[sectionType] || [])]; arr[colorIdx] = endColor; const newPal = { ...customPal, [sectionType]: arr }; setCustomPal(newPal); setQs({ customPalette: newPal, customGradients: { ...(qs.customGradients || {}), [sectionType]: { start: startColor, end: endColor } } }); setGradientPicker(null); }} className="px-4 py-2 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500">Appliquer</button>
            </div>
          </div>
        </div>
      )}

            {/* EFX context menu */}
      {efxContextMenu && (
        <div
          ref={efxContextRef}
          className="fixed z-50 bg-[#1a1a2e] border border-cyan-700/50 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ ...clampRect(efxContextMenu.x, efxContextMenu.y, 200, 120, window.innerWidth, window.innerHeight) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-cyan-400 uppercase tracking-wider border-b border-gray-800">
            EFX Track
          </div>
          <button
            onClick={() => handleRemoveEfxTrack(efxContextMenu.trackId)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800"
          >
            Delete track
          </button>
          <button
            onClick={() => setEfxContextMenu(null)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800"
          >
            Cancel
          </button>
        </div>
      )}

      {/* EFX entry context menu — avec édition précise début/fin */}
      {efxEntryMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEfxEntryMenu(null)}>
          <div
            ref={efxEntryMenuRef}
            className="bg-[#1a1a2e] border border-cyan-700/50 rounded-xl shadow-2xl py-3 w-[340px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-1.5 text-[11px] text-cyan-400 uppercase tracking-wider border-b border-gray-800">
              {efxEntryMenu.entry.label || `${efxEntryMenu.entry.effectName} (${efxEntryMenu.entry.pattern})`}
            </div>
            <div className="px-4 pt-3">
              <label className="text-[10px] text-gray-500 block mb-1">Nom de la section</label>
              <input type="text"
                defaultValue={efxEntryMenu.entry.label || ''}
                placeholder={efxEntryMenu.entry.effectName}
                id="__efx_label"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3">
              <div><label className="text-[10px] text-gray-500">Début (s)</label><input type="number" step="0.01" defaultValue={efxEntryMenu.entry.time} id="__efx_start" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
              <div><label className="text-[10px] text-gray-500">Fin (s)</label><input type="number" step="0.01" defaultValue={efxEntryMenu.entry.endTime} id="__efx_end" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const label = (document.getElementById('__efx_label') as HTMLInputElement).value;
                handleRenameEfxEntry(efxEntryMenu.trackId, efxEntryMenu.entry, label);
              }} className="flex-1 py-1.5 rounded bg-cyan-600/20 text-cyan-300 text-xs hover:bg-cyan-600/30">Renommer</button>
              <button onClick={() => handleModifyEfxEntry(efxEntryMenu.trackId, efxEntryMenu.entry)} className="flex-1 py-1.5 rounded bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">Modifier</button>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const st = Number((document.getElementById('__efx_start') as HTMLInputElement).value);
                const en = Number((document.getElementById('__efx_end') as HTMLInputElement).value);
                const dur = resolvedAnalysis?.duration || 9999;
                if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st || st < 0 || en > dur) return;
                const tr = efxTracks.find(t => t.id === efxEntryMenu.trackId);
                const idx = tr ? tr.entries.findIndex(e => e.time === efxEntryMenu.entry.time && e.endTime === efxEntryMenu.entry.endTime) : -1;
                if (idx >= 0) { pushHistory(); setEfxTracks(prev => prev.map(t => t.id === efxEntryMenu.trackId ? { ...t, entries: t.entries.map((e,i) => i===idx ? { ...e, time: st, endTime: en } : e) } : t)); }
                setEfxEntryMenu(null);
              }} className="flex-1 py-1.5 rounded bg-cyan-600 text-white text-xs hover:bg-cyan-500">Appliquer</button>
              <button onClick={() => handleRemoveEfxEntry(efxEntryMenu.trackId, efxEntryMenu.entry)} className="px-4 py-1.5 rounded bg-red-600/20 text-red-300 text-xs hover:bg-red-600/30">Supprimer</button>
            </div>
            <button onClick={() => setEfxEntryMenu(null)} className="w-full text-center py-1.5 text-[11px] text-gray-500 hover:text-gray-300">Fermer</button>
          </div>
        </div>
      )}

      {/* Color Track context menu - via +* Color Track (en mode simple) */}
      {colorContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setColorContextMenu(null)} />
          <div
            ref={colorContextRef}
            className="fixed z-50 bg-[#1a1a2e] border border-pink-700/50 rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ ...clampRect(colorContextMenu.x, colorContextMenu.y, 200, 120, window.innerWidth, window.innerHeight) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[10px] text-pink-400 uppercase tracking-wider border-b border-gray-800">
              Color Track
            </div>
            <button
              onClick={() => handleRemoveColorTrack(colorContextMenu.trackId)}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800"
            >
              Delete track
            </button>
            <button
              onClick={() => setColorContextMenu(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Color entry context menu — centré */}
      {colorEntryMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setColorEntryMenu(null)}>
          <div
            ref={colorEntryMenuRef}
            className="bg-[#1a1a2e] border border-pink-700/50 rounded-xl shadow-2xl py-3 w-[360px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-1.5 text-[11px] text-pink-400 uppercase tracking-wider border-b border-gray-800">
              {colorEntryMenu.entry.label || (
                <><span className="w-3 h-3 rounded inline-block mr-1 align-middle" style={{ backgroundColor: colorEntryMenu.entry.color }} />
                {colorEntryMenu.entry.endColor && colorEntryMenu.entry.endColor !== colorEntryMenu.entry.color
                  ? `${colorEntryMenu.entry.color} → ${colorEntryMenu.entry.endColor}`
                  : colorEntryMenu.entry.color}</>
              )}
            </div>
            <div className="px-4 pt-3">
              <label className="text-[10px] text-gray-500 block mb-1">Nom de la section</label>
              <input type="text"
                defaultValue={colorEntryMenu.entry.label || ''}
                placeholder={`${colorEntryMenu.entry.color}${colorEntryMenu.entry.endColor && colorEntryMenu.entry.endColor !== colorEntryMenu.entry.color ? ` → ${colorEntryMenu.entry.endColor}` : ''}`}
                id="__color_label"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3">
              <div><label className="text-[10px] text-gray-500">Début (s)</label><input type="number" step="0.01" defaultValue={colorEntryMenu.entry.time} id="__color_start" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
              <div><label className="text-[10px] text-gray-500">Fin (s)</label><input type="number" step="0.01" defaultValue={colorEntryMenu.entry.endTime} id="__color_end" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const label = (document.getElementById('__color_label') as HTMLInputElement).value;
                handleRenameColorEntry(colorEntryMenu.trackId, colorEntryMenu.entry, label);
              }} className="flex-1 py-1.5 rounded bg-pink-600/20 text-pink-300 text-xs hover:bg-pink-600/30">Renommer</button>
              <button onClick={() => handleModifyColorEntry(colorEntryMenu.trackId, colorEntryMenu.entry)} className="flex-1 py-1.5 rounded bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">Modifier</button>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const st = Number((document.getElementById('__color_start') as HTMLInputElement).value);
                const en = Number((document.getElementById('__color_end') as HTMLInputElement).value);
                const dur = resolvedAnalysis?.duration || 9999;
                if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st || st < 0 || en > dur) return;
                const tr = colorTracks.find(t => t.id === colorEntryMenu.trackId);
                const idx = tr ? tr.entries.findIndex(e => e.time === colorEntryMenu.entry.time && e.endTime === colorEntryMenu.entry.endTime) : -1;
                if (idx >= 0) handleColorEntryChange(colorEntryMenu.trackId, idx, st, en);
                setColorEntryMenu(null);
              }} className="flex-1 py-1.5 rounded bg-pink-600 text-white text-xs hover:bg-pink-500">Appliquer</button>
              <button onClick={() => handleRemoveColorEntry(colorEntryMenu.trackId, colorEntryMenu.entry.time)} className="px-4 py-1.5 rounded bg-red-600/20 text-red-300 text-xs">Supprimer</button>
            </div>
            <button onClick={() => setColorEntryMenu(null)} className="w-full text-center py-1.5 text-[11px] text-gray-500 hover:text-gray-300">Fermer</button>
          </div>
        </div>
      )}

      {/* Click-away listeners */}
      {picker !== null && (
        <div className="fixed inset-0 z-40" onClick={() => setPicker(null)} />
      )}
      {efxContextMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setEfxContextMenu(null)} />
      )}
      {efxEntryMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setEfxEntryMenu(null)} />
      )}
      {showForceColor && (
        <div className="fixed inset-0 z-40" onClick={() => setShowForceColor(false)} />
      )}

      {/* ── Floating 3D View (detachable) ── */}
      {showFloating3D && (
        <div
          className="fixed z-40 bg-black/90 rounded-xl border border-purple-700/40 shadow-2xl flex flex-col"
          style={{ left: float3DPos.x, top: float3DPos.y, width: float3DSize.w, height: float3DSize.h, minWidth: 320, minHeight: 200, overflow: 'hidden' }}
        >
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d0d18] border-b border-gray-800 cursor-move shrink-0" onMouseDown={handleFloat3DDragStart}>
            <span className="text-[11px] text-purple-400 font-medium">🎥 Live 3D View</span>
            <div className="flex items-center gap-1">
              <button onClick={() => { setFloat3DSize({ w: 640, h: 360 }); setFloat3DPos({ x: 100, y: 80 }); }} className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded">◲</button>
              <button onClick={() => setShowFloating3D(false)} className="text-[10px] text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded">✕</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 relative">
            <Stage3D disabledFixtures={disabledFixtures} musicians={qsMusicians} stageScene={qsStageScene} onMusiciansChange={setQsMusicians} onStageSceneChange={setQsStageScene} view3D={qsView3D} onView3DChange={setQsView3D} />
            {/* Resize handle */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
              onMouseDown={handleFloat3DResizeStart}
              style={{
                background: 'linear-gradient(135deg, transparent 50%, rgba(168,85,247,0.4) 50%)',
                borderBottomRightRadius: '0.75rem',
              }}
            />
          </div>
        </div>
      )}

      {!showFloating3D && (
        <button onClick={() => setShowFloating3D(true)} className="fixed bottom-4 right-4 z-40 bg-purple-600/80 hover:bg-purple-500 text-white rounded-full px-4 py-2 text-xs font-medium shadow-lg transition-all">
          🎥 3D View
        </button>
      )}

      {/* ── EFX Track Target Modal ── */}
      {efxTrackModal && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
            <div className="bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto" style={{ pointerEvents: 'auto' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-gray-200">{efxEditTarget ? 'Modifier la section EFX' : 'New EFX Track'}</span>
                <button onClick={() => { setEfxTrackModal(false); setEfxEditTarget(null); }} className="text-gray-500 hover:text-white">✕</button>
              </div>

              {/* Track name */}
              {!efxEditTarget && (<>
              <label className="block text-[10px] text-gray-400 mb-1">Track Name</label>
              <input
                autoFocus
                value={efxTrackName}
                onChange={e => setEfxTrackName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && efxTrackName.trim()) handleAddEfxTrack();
                  if (e.key === 'Escape') setEfxTrackModal(false);
                }}
                placeholder="e.g. Circle Wash"
                className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none mb-4"
              />

              {/* Target type */}
              <label className="block text-[10px] text-gray-400 mb-1">Apply EFX To</label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {([
                  { type: 'all' as const, label: 'All Fixtures', icon: '🌐' },
                  { type: 'group' as const, label: 'Group', icon: '📁' },
                  { type: 'fixture' as const, label: 'Single Fixture', icon: '💡' },
                ]).map(opt => (
                  <button key={opt.type}
                    onClick={() => {
                      setEfxTargetType(opt.type);
                      if (opt.type !== 'group') setEfxTargetGroupId('');
                      if (opt.type !== 'fixture') setEfxTargetFixtureIds([]);
                    }}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-all ${
                      efxTargetType === opt.type
                        ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300'
                        : 'bg-gray-800/40 border-gray-700/40 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{opt.icon}</div>
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Group selector */}
              {efxTargetType === 'group' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Group</label>
                  <select
                    value={efxTargetGroupId}
                    onChange={e => setEfxTargetGroupId(e.target.value)}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose group --</option>
                    {fixtureGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.fixtureIds.length} fixtures)</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Fixture picker (single) */}
              {efxTargetType === 'fixture' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Fixture</label>
                  <select
                    value={efxTargetFixtureIds[0] || ''}
                    onChange={e => setEfxTargetFixtureIds(e.target.value ? [e.target.value] : [])}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose fixture --</option>
                    {patchedFixtures.filter(f => f.enabled !== false).map(f => (
                      <option key={f.id} value={f.id}>{f.name} ({f.universeId} ch.{f.startAddress})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Fixture count display */}
              {efxTargetFixtureNames.length > 0 && (
                <div className="text-[10px] text-cyan-400/70 mb-4 bg-cyan-400/5 border border-cyan-400/10 rounded-lg px-3 py-2">
                  Target: <span className="text-gray-300">{efxTargetFixtureNames.length} fixture{efxTargetFixtureNames.length > 1 ? 's' : ''}</span>
                  <span className="text-gray-600 ml-2 max-w-[250px] truncate inline-block align-bottom">
                    ({efxTargetFixtureNames.slice(0, 5).join(', ')}{efxTargetFixtureNames.length > 5 ? `... +${efxTargetFixtureNames.length - 5}` : ''})
                  </span>
                </div>
              )}
              </>)}

              {/* Custom effects */}
              <label className="block text-[10px] text-gray-400 mb-1">Custom Effect</label>
              {(() => {
                const customEffects = effectEntities;
                if (customEffects.length === 0) {
                  return (
                    <div className="text-[11px] text-yellow-400/80 bg-yellow-400/5 border border-yellow-400/15 rounded-lg px-3 py-2.5 mb-4">
                      ⚠ Aucun effet custom. Créez d'abord un effet de mouvement dans l'onglet EFX.
                    </div>
                  );
                }
                return (
                  <select
                    value={efxCustomEffectId}
                    onChange={e => setEfxCustomEffectId(e.target.value)}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none mb-4"
                  >
                    {customEffects.map(efx => (
                      <option key={efx.id} value={efx.id}>{efx.name} ({efx.pattern})</option>
                    ))}
                  </select>
                );
              })()}
              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button onClick={() => { setEfxTrackModal(false); setEfxEditTarget(null); }}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">
                  Cancel
                </button>
                <button
                  onClick={handleAddEfxTrack}
                  disabled={!efxEditTarget && !efxTrackName.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {efxEditTarget ? 'Appliquer' : 'Add Track'}
                </button>
              </div>
            </div>
          </div>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setEfxTrackModal(false); setEfxEditTarget(null); }} />
        </>
      )}

      {/* Strobe track context menu (right-click on track) */}
      {scmPos && scmPos.type === 'track' && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setScmPos(null)} />
          <div
            ref={scmRef}
            className="fixed z-50 bg-[#1a1a2e] border border-purple-700/50 rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ ...clampRect(scmPos.x, scmPos.y, 200, 120, window.innerWidth, window.innerHeight) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[10px] text-purple-400 uppercase tracking-wider border-b border-gray-800">
              Strobe Track
            </div>
            <button
              onClick={() => { handleDeleteStrobeTrack(scmPos.trackId); setScmPos(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800"
            >
              Delete track
            </button>
            <button
              onClick={() => setScmPos(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Strobe entry context menu — centré */}
      {strobeEntryMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setStrobeEntryMenu(null)}>
          <div
            ref={strobeEntryMenuRef}
            className="bg-[#1a1a2e] border border-purple-700/50 rounded-xl shadow-2xl py-3 w-[360px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-1.5 text-[11px] text-purple-400 uppercase tracking-wider border-b border-gray-800">
              {strobeEntryMenu.entry.label || (
                <><span className="text-purple-300 font-mono">{strobeEntryMenu.entry.speed} Hz</span>
                {strobeEntryMenu.entry.endSpeed !== undefined && strobeEntryMenu.entry.endSpeed !== strobeEntryMenu.entry.speed && (
                  <span className="text-purple-400"> → {strobeEntryMenu.entry.endSpeed} Hz</span>
                )}</>
              )}
            </div>
            <div className="px-4 pt-3">
              <label className="text-[10px] text-gray-500 block mb-1">Nom de la section</label>
              <input type="text"
                defaultValue={strobeEntryMenu.entry.label || ''}
                placeholder={`${strobeEntryMenu.entry.speed} Hz${strobeEntryMenu.entry.endSpeed !== undefined && strobeEntryMenu.entry.endSpeed !== strobeEntryMenu.entry.speed ? ` → ${strobeEntryMenu.entry.endSpeed} Hz` : ''}`}
                id="__strobe_label"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3">
              <div><label className="text-[10px] text-gray-500">Début (s)</label><input type="number" step="0.01" defaultValue={strobeEntryMenu.entry.time} id="__strobe_start" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
              <div><label className="text-[10px] text-gray-500">Fin (s)</label><input type="number" step="0.01" defaultValue={strobeEntryMenu.entry.endTime} id="__strobe_end" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const label = (document.getElementById('__strobe_label') as HTMLInputElement).value;
                handleRenameStrobeEntry(strobeEntryMenu.trackId, strobeEntryMenu.entry, label);
              }} className="flex-1 py-1.5 rounded bg-purple-600/20 text-purple-300 text-xs hover:bg-purple-600/30">Renommer</button>
              <button onClick={() => handleModifyStrobeEntry(strobeEntryMenu.trackId, strobeEntryMenu.entry)} className="flex-1 py-1.5 rounded bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">Modifier</button>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const st = Number((document.getElementById('__strobe_start') as HTMLInputElement).value);
                const en = Number((document.getElementById('__strobe_end') as HTMLInputElement).value);
                const dur = resolvedAnalysis?.duration || 9999;
                if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st || st < 0 || en > dur) return;
                const idx = strobeTracks.find(t => t.id === strobeEntryMenu.trackId)?.entries.findIndex(e => e.id === strobeEntryMenu.entry.id) ?? -1;
                if (idx >= 0) { pushHistory(); setStrobeTracks(prev => prev.map(t => t.id === strobeEntryMenu.trackId ? { ...t, entries: t.entries.map((e,i) => i===idx ? { ...e, time: st, endTime: en } : e) } : t)); }
                setStrobeEntryMenu(null);
              }} className="flex-1 py-1.5 rounded bg-purple-600 text-white text-xs hover:bg-purple-500">Appliquer</button>
              <button onClick={() => handleRemoveStrobeEntry(strobeEntryMenu.trackId, strobeEntryMenu.entry.id)} className="px-4 py-1.5 rounded bg-red-600/20 text-red-300 text-xs">Supprimer</button>
            </div>
            <button onClick={() => setStrobeEntryMenu(null)} className="w-full text-center py-1.5 text-[11px] text-gray-500 hover:text-gray-300">Fermer</button>
          </div>
        </div>
      )}

      {/* Dimmer track context menu — via +* Dimmer Track */}
      {dimmerInsertMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDimmerInsertMenu(null)} />
          <div
            ref={dimmerInsertMenuRef}
            className="fixed z-50 bg-[#1a1a2e] border border-orange-700/50 rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ ...clampRect(dimmerInsertMenu.x, dimmerInsertMenu.y, 200, 120, window.innerWidth, window.innerHeight) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[10px] text-orange-400 uppercase tracking-wider border-b border-gray-800">
              Dimmer Track
            </div>
            <button
              onClick={() => { handleDeleteDimmerTrack(dimmerInsertMenu.trackId); setDimmerInsertMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800"
            >
              Delete track
            </button>
            <button
              onClick={() => setDimmerInsertMenu(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Dimmer entry context menu — avec édition précise */}
      {dimmerEntryMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDimmerEntryMenu(null)}>
          <div
            ref={dimmerEntryMenuRef}
            className="bg-[#1a1a2e] border border-orange-700/50 rounded-xl shadow-2xl py-3 w-[360px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-1.5 text-[11px] text-orange-400 uppercase tracking-wider border-b border-gray-800">
              {dimmerEntryMenu.entry.label || (
                <><span className="text-orange-300 font-mono">{dimmerEntryMenu.entry.value}%</span>
                {dimmerEntryMenu.entry.endValue !== undefined && dimmerEntryMenu.entry.endValue !== dimmerEntryMenu.entry.value && (
                  <span className="text-orange-400"> → {dimmerEntryMenu.entry.endValue}%</span>
                )}</>
              )}
            </div>
            <div className="px-4 pt-3">
              <label className="text-[10px] text-gray-500 block mb-1">Nom de la section</label>
              <input type="text"
                defaultValue={dimmerEntryMenu.entry.label || ''}
                placeholder={`${dimmerEntryMenu.entry.value}%${dimmerEntryMenu.entry.endValue !== undefined && dimmerEntryMenu.entry.endValue !== dimmerEntryMenu.entry.value ? ` → ${dimmerEntryMenu.entry.endValue}%` : ''}`}
                id="__dimmer_label"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3">
              <div><label className="text-[10px] text-gray-500">Début (s)</label><input type="number" step="0.01" defaultValue={dimmerEntryMenu.entry.time} id="__dimmer_start" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
              <div><label className="text-[10px] text-gray-500">Fin (s)</label><input type="number" step="0.01" defaultValue={dimmerEntryMenu.entry.endTime} id="__dimmer_end" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const label = (document.getElementById('__dimmer_label') as HTMLInputElement).value;
                handleRenameDimmerEntry(dimmerEntryMenu.trackId, dimmerEntryMenu.entry, label);
              }} className="flex-1 py-1.5 rounded bg-orange-600/20 text-orange-300 text-xs hover:bg-orange-600/30">Renommer</button>
              <button onClick={() => handleModifyDimmerEntry(dimmerEntryMenu.trackId, dimmerEntryMenu.entry)} className="flex-1 py-1.5 rounded bg-gray-800 text-gray-300 text-xs hover:bg-gray-700">Modifier</button>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const st = Number((document.getElementById('__dimmer_start') as HTMLInputElement).value);
                const en = Number((document.getElementById('__dimmer_end') as HTMLInputElement).value);
                const dur = resolvedAnalysis?.duration || 9999;
                if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st || st < 0 || en > dur) return;
                const idx = dimmerTracks.find(t => t.id === dimmerEntryMenu.trackId)?.entries.findIndex(e => e.id === dimmerEntryMenu.entry.id) ?? -1;
                if (idx >= 0) { pushHistory(); setDimmerTracks(prev => prev.map(t => t.id === dimmerEntryMenu.trackId ? { ...t, entries: t.entries.map((e,i) => i===idx ? { ...e, time: st, endTime: en } : e) } : t)); }
                setDimmerEntryMenu(null);
              }} className="flex-1 py-1.5 rounded bg-orange-600 text-white text-xs hover:bg-orange-500">Appliquer</button>
              <button onClick={() => handleRemoveDimmerEntry(dimmerEntryMenu.trackId, dimmerEntryMenu.entry.id)} className="px-4 py-1.5 rounded bg-red-600/20 text-red-300 text-xs">Supprimer</button>
            </div>
            <button onClick={() => setDimmerEntryMenu(null)} className="w-full text-center py-1.5 text-[11px] text-gray-500 hover:text-gray-300">Fermer</button>
          </div>
        </div>
      )}

      {/* ── Chaser Track insert menu ── */}
      {chaserInsertMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setChaserInsertMenu(null)} />
          <div
            className="fixed z-50 bg-[#1a1a2e] border border-emerald-700/50 rounded-lg shadow-xl py-1 min-w-[200px] max-h-[320px] overflow-auto"
            style={{ ...clampRect(chaserInsertMenu.x, chaserInsertMenu.y, 240, 340, window.innerWidth, window.innerHeight) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-[10px] text-emerald-400 uppercase tracking-wider border-b border-gray-800 sticky top-0 bg-[#1a1a2e]">
              Import Chaser at {(chaserInsertMenu.time ?? 0).toFixed(1)}s
            </div>
            {entityChaserList.length === 0 && (
              <div className="px-3 py-2 text-[10px] text-gray-600">No saved chasers — create one in Design → Chasers.</div>
            )}
            {entityChaserList.map((c) => (
              <button
                key={c.id}
                onClick={() => handleInsertChaserToTrack(chaserInsertMenu.trackId, chaserInsertMenu.time ?? 0, c.id, c.name)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-emerald-500/10 flex items-center gap-2"
              >
                <span className="text-emerald-400">🎬</span>
                {c.name}
              </button>
            ))}
            <div className="border-t border-gray-800" />
            <button
              onClick={() => { handleDeleteChaserTrack(chaserInsertMenu.trackId); setChaserInsertMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800"
            >
              Delete track
            </button>
          </div>
        </>
      )}

      {/* Chaser entry context menu — centré */}
      {chaserEntryMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setChaserEntryMenu(null)}>
          <div
            className="bg-[#1a1a2e] border border-emerald-700/50 rounded-xl shadow-2xl py-3 w-[360px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-1.5 text-[11px] text-emerald-400 uppercase tracking-wider border-b border-gray-800">
              {chaserEntryMenu.entry.chaserName || 'Chaser'}
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3">
              <div><label className="text-[10px] text-gray-500">Début (s)</label><input type="number" step="0.01" defaultValue={chaserEntryMenu.entry.time} id="__chaser_start" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
              <div><label className="text-[10px] text-gray-500">Fin (s)</label><input type="number" step="0.01" defaultValue={chaserEntryMenu.entry.endTime} id="__chaser_end" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const st = Number((document.getElementById('__chaser_start') as HTMLInputElement).value);
                const en = Number((document.getElementById('__chaser_end') as HTMLInputElement).value);
                const dur = resolvedAnalysis?.duration || 9999;
                if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st || st < 0 || en > dur) return;
                const idx = chaserTracks.find(t => t.id === chaserEntryMenu.trackId)?.entries.findIndex(e => e.id === chaserEntryMenu.entry.id) ?? -1;
                if (idx >= 0) handleChaserEntryChange(chaserEntryMenu.trackId, idx, st, en);
                setChaserEntryMenu(null);
              }} className="flex-1 py-1.5 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500">Appliquer</button>
              <button onClick={() => handleRemoveChaserEntry(chaserEntryMenu.trackId, chaserEntryMenu.entry.id)} className="px-4 py-1.5 rounded bg-red-600/20 text-red-300 text-xs">Supprimer</button>
            </div>
            <button onClick={() => setChaserEntryMenu(null)} className="w-full text-center py-1.5 text-[11px] text-gray-500 hover:text-gray-300">Fermer</button>
          </div>
        </div>
      )}

      {/* ── Color Track Target Modal ── */}
      {colorTrackModal && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
            <div className="bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto" style={{ pointerEvents: 'auto' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-gray-200">{colorEditTarget ? 'Modifier la section Color' : 'New Color Track'}</span>
                <button onClick={() => { setColorTrackModal(false); setColorEditTarget(null); }} className="text-gray-500 hover:text-white">✕</button>
              </div>

              {!colorEditTarget && (<>
              <label className="block text-[10px] text-gray-400 mb-1">Track Name</label>
              <input
                autoFocus
                value={colorTrackName}
                onChange={e => setColorTrackName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && colorTrackName.trim()) handleAddColorTrack();
                  if (e.key === 'Escape') setColorTrackModal(false);
                }}
                placeholder="e.g. Blue Wash"
                className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none mb-4"
              />

              <label className="block text-[10px] text-gray-400 mb-1">Apply Color To</label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {([
                  { type: 'all' as const, label: 'All Fixtures', icon: '🌐' },
                  { type: 'group' as const, label: 'Group', icon: '📁' },
                  { type: 'fixture' as const, label: 'Single Fixture', icon: '💡' },
                ]).map(opt => (
                  <button key={opt.type}
                    onClick={() => {
                      setColorTargetType(opt.type);
                      if (opt.type !== 'group') setColorTargetGroupId('');
                      if (opt.type !== 'fixture') setColorTargetFixtureIds([]);
                    }}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-all ${
                      colorTargetType === opt.type
                        ? 'bg-pink-600/20 border-pink-500/50 text-pink-300'
                        : 'bg-gray-800/40 border-gray-700/40 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{opt.icon}</div>
                    {opt.label}
                  </button>
                ))}
              </div>

              {colorTargetType === 'group' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Group</label>
                  <select
                    value={colorTargetGroupId}
                    onChange={e => setColorTargetGroupId(e.target.value)}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose group --</option>
                    {fixtureGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.fixtureIds.length} fixtures)</option>
                    ))}
                  </select>
                </div>
              )}

              {colorTargetType === 'fixture' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Fixture</label>
                  <select
                    value={colorTargetFixtureIds[0] || ''}
                    onChange={e => setColorTargetFixtureIds(e.target.value ? [e.target.value] : [])}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose fixture --</option>
                    {patchedFixtures.filter(f => f.enabled !== false).map(f => (
                      <option key={f.id} value={f.id}>{f.name} ({f.universeId} ch.{f.startAddress})</option>
                    ))}
                  </select>
                </div>
              )}
              </>)}

              <label className="block text-[10px] text-gray-400 mb-1">Couleur de début (posée à 10 s)</label>
              <div className="flex gap-1 flex-wrap mb-2">
                {COLOR_PALETTE.map(c => (
                  <button key={'s'+c} onClick={() => setColorTrackStartColor(c)}
                    className={`w-6 h-6 rounded border transition-all ${colorTrackStartColor === c ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'}`}
                    style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
              <label className="block text-[10px] text-gray-400 mb-1">Couleur de fin</label>
              <div className="flex gap-1 flex-wrap mb-2">
                {COLOR_PALETTE.map(c => (
                  <button key={'e'+c} onClick={() => setColorTrackEndColor(c)}
                    className={`w-6 h-6 rounded border transition-all ${colorTrackEndColor === c ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'}`}
                    style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 h-4 rounded"
                  style={{ background: `linear-gradient(to right, ${colorTrackStartColor}, ${colorTrackEndColor})` }} />
                <span className="text-[9px] text-gray-500">aperçu dégradé ({colorTrackStartColor} → {colorTrackEndColor})</span>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => { setColorTrackModal(false); setColorEditTarget(null); }}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">
                  Cancel
                </button>
                <button
                  onClick={handleAddColorTrack}
                  disabled={!colorEditTarget && !colorTrackName.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-pink-600 text-white hover:bg-pink-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {colorEditTarget ? 'Appliquer' : 'Add Track'}
                </button>
              </div>
            </div>
          </div>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setColorTrackModal(false); setColorEditTarget(null); }} />
        </>
      )}

      {/* ── Strobe Track Target Modal ── */}
      {strobeTrackModal && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
            <div className="bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto" style={{ pointerEvents: 'auto' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-gray-200">{strobeEditTarget ? 'Modifier la section Strobe' : 'New Strobe Track'}</span>
                <button onClick={() => { setStrobeTrackModal(false); setStrobeEditTarget(null); }} className="text-gray-500 hover:text-white">✕</button>
              </div>

              {!strobeEditTarget && (<>
              <label className="block text-[10px] text-gray-400 mb-1">Track Name</label>
              <input
                autoFocus
                value={strobeTrackName}
                onChange={e => setStrobeTrackName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && strobeTrackName.trim()) handleAddStrobeTrack();
                  if (e.key === 'Escape') setStrobeTrackModal(false);
                }}
                placeholder="e.g. Fast Strobe"
                className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none mb-4"
              />

              <label className="block text-[10px] text-gray-400 mb-1">Apply Strobe To</label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {([
                  { type: 'all' as const, label: 'All Fixtures', icon: '🌐' },
                  { type: 'group' as const, label: 'Group', icon: '📁' },
                  { type: 'fixture' as const, label: 'Single Fixture', icon: '💡' },
                ]).map(opt => (
                  <button key={opt.type}
                    onClick={() => {
                      setStrobeTargetType(opt.type);
                      if (opt.type !== 'group') setStrobeTargetGroupId('');
                      if (opt.type !== 'fixture') setStrobeTargetFixtureIds([]);
                    }}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-all ${
                      strobeTargetType === opt.type
                        ? 'bg-purple-600/20 border-purple-500/50 text-purple-300'
                        : 'bg-gray-800/40 border-gray-700/40 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{opt.icon}</div>
                    {opt.label}
                  </button>
                ))}
              </div>

              {strobeTargetType === 'group' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Group</label>
                  <select
                    value={strobeTargetGroupId}
                    onChange={e => setStrobeTargetGroupId(e.target.value)}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose group --</option>
                    {fixtureGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.fixtureIds.length} fixtures)</option>
                    ))}
                  </select>
                </div>
              )}

              {strobeTargetType === 'fixture' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Fixture</label>
                  <select
                    value={strobeTargetFixtureIds[0] || ''}
                    onChange={e => setStrobeTargetFixtureIds(e.target.value ? [e.target.value] : [])}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose fixture --</option>
                    {patchedFixtures.filter(f => f.enabled !== false).map(f => (
                      <option key={f.id} value={f.id}>{f.name} ({f.universeId} ch.{f.startAddress})</option>
                    ))}
                  </select>
                </div>
              )}
              </>)}

              <label className="block text-[10px] text-gray-400 mb-1">Frég. de début (Hz)</label>
              <input type="number" min={1} max={25} value={strobeTrackSpeed}
                onChange={e => setStrobeTrackSpeed(Math.max(1, Math.min(25, Number(e.target.value) || 10)))}
                className="w-24 mb-2 bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none" />
              <label className="block text-[10px] text-gray-400 mb-1">Frég. de fin (Hz)</label>
              <input type="number" min={1} max={25} value={strobeTrackEndSpeed}
                onChange={e => setStrobeTrackEndSpeed(Math.max(1, Math.min(25, Number(e.target.value) || 10)))}
                className="w-24 mb-2 bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none" />
              <div className="flex items-center gap-2 mb-4 text-[10px] text-gray-500">
                <span>Début {strobeTrackSpeed} Hz</span>
                <span>→</span>
                <span>Fin {strobeTrackEndSpeed} Hz</span>
                <span className="text-gray-400">(accumulé sur 10 s)</span>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => { setStrobeTrackModal(false); setStrobeEditTarget(null); }}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">
                  Cancel
                </button>
                <button
                  onClick={handleAddStrobeTrack}
                  disabled={!strobeEditTarget && !strobeTrackName.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {strobeEditTarget ? 'Appliquer' : 'Add Track'}
                </button>
              </div>
            </div>
          </div>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setStrobeTrackModal(false); setStrobeEditTarget(null); }} />
        </>
      )}

      {/* Dimmer Track Modal */}
      {dimmerTrackModal && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
            <div className="bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto" style={{ pointerEvents: 'auto' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-gray-200">{dimmerEditTarget ? 'Modifier la section Dimmer' : 'New Dimmer Track'}</span>
                <button onClick={() => { setDimmerTrackModal(false); setDimmerEditTarget(null); }} className="text-gray-500 hover:text-white">✕</button>
              </div>

              {!dimmerEditTarget && (<>
              <label className="block text-[10px] text-gray-400 mb-1">Track Name</label>
              <input
                autoFocus
                value={dimmerTrackName}
                onChange={e => setDimmerTrackName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && dimmerTrackName.trim()) handleAddDimmerTrackFromModal();
                  if (e.key === 'Escape') setDimmerTrackModal(false);
                }}
                placeholder="e.g. Dimmer Fade"
                className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none mb-4"
              />

              <label className="block text-[10px] text-gray-400 mb-1">Apply Dimmer To</label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {([
                  { type: 'all' as const, label: 'All Fixtures', icon: '🌐' },
                  { type: 'group' as const, label: 'Group', icon: '📁' },
                  { type: 'fixture' as const, label: 'Single Fixture', icon: '💡' },
                ]).map(opt => (
                  <button key={opt.type}
                    onClick={() => {
                      setDimmerTargetType(opt.type);
                      if (opt.type !== 'group') setDimmerTargetGroupId('');
                      if (opt.type !== 'fixture') setDimmerTargetFixtureIds([]);
                    }}
                    className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-all ${
                      dimmerTargetType === opt.type
                        ? 'bg-orange-600/20 border-orange-500/50 text-orange-300'
                        : 'bg-gray-800/40 border-gray-700/40 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{opt.icon}</div>
                    {opt.label}
                  </button>
                ))}
              </div>

              {dimmerTargetType === 'group' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Group</label>
                  <select
                    value={dimmerTargetGroupId}
                    onChange={e => setDimmerTargetGroupId(e.target.value)}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose group --</option>
                    {fixtureGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name} ({g.fixtureIds.length} fixtures)</option>
                    ))}
                  </select>
                </div>
              )}

              {dimmerTargetType === 'fixture' && (
                <div className="mb-3">
                  <label className="block text-[10px] text-gray-400 mb-1">Select Fixture</label>
                  <select
                    value={dimmerTargetFixtureIds[0] || ''}
                    onChange={e => setDimmerTargetFixtureIds(e.target.value ? [e.target.value] : [])}
                    className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none"
                  >
                    <option value="">-- Choose fixture --</option>
                    {patchedFixtures.filter(f => f.enabled !== false).map(f => (
                      <option key={f.id} value={f.id}>{f.name} ({f.universeId} ch.{f.startAddress})</option>
                    ))}
                  </select>
                </div>
              )}
              </>)}

              <label className="block text-[10px] text-gray-400 mb-1">Valeur de début (%)</label>
              <input type="number" min={0} max={100} value={dimmerTrackValue}
                onChange={e => setDimmerTrackValue(Math.max(0, Math.min(100, Number(e.target.value) || 100)))}
                className="w-24 mb-2 bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none" />
              <label className="block text-[10px] text-gray-400 mb-1">Valeur de fin (%)</label>
              <input type="number" min={0} max={100} value={dimmerTrackEndValue}
                onChange={e => setDimmerTrackEndValue(Math.max(0, Math.min(100, Number(e.target.value) || 100)))}
                className="w-24 mb-2 bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none" />
              <div className="flex items-center gap-2 mb-4 text-[10px] text-gray-500">
                <span>Début {dimmerTrackValue} %</span>
                <span>→</span>
                <span>Fin {dimmerTrackEndValue} %</span>
                <span className="text-gray-400">(fondu sur 10 s)</span>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => { setDimmerTrackModal(false); setDimmerEditTarget(null); }}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">
                  Cancel
                </button>
                <button
                  onClick={handleAddDimmerTrackFromModal}
                  disabled={!dimmerEditTarget && !dimmerTrackName.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-orange-600 text-white hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {dimmerEditTarget ? 'Appliquer' : 'Add Track'}
                </button>
              </div>
            </div>
          </div>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { setDimmerTrackModal(false); setDimmerEditTarget(null); }} />
        </>
      )}

      {chaserPickModal && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setChaserPickModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
            <div className="bg-[#1a1a2e] border border-emerald-700/50 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto" style={{ pointerEvents: 'auto' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-200">Sélectionner un chaser</span>
                <button onClick={() => setChaserPickModal(null)} className="text-gray-500 hover:text-white">✕</button>
              </div>

              <p className="text-[10px] text-gray-500 leading-relaxed mb-4">
                Le chaser joue ses propres fixtures et prend le dessus sur l'autoscript pendant sa plage, puis rend la main.
              </p>

              {entityChaserList.length === 0 ? (
                <div className="text-[11px] text-gray-600 py-6 text-center border border-dashed border-gray-800 rounded-lg">
                  Aucun chaser sauvegardé.<br />
                  <span className="text-gray-500">Créez-en un dans Design → Chasers, puis réessayez.</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {entityChaserList.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handlePickChaserForTrack(chaserPickModal.trackId, c.id, c.name)}
                      className="w-full text-left px-3 py-2 rounded-lg bg-gray-800/40 border border-gray-700/40 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-xs text-gray-300 flex items-center gap-2 transition-all"
                    >
                      <span className="text-emerald-400">🎬</span>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end mt-4">
                <button onClick={() => setChaserPickModal(null)}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {showPickModal && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPickModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ pointerEvents: 'none' }}>
            <div className="bg-[#1a1a2e] border border-amber-700/50 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto" style={{ pointerEvents: 'auto' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-200">Sélectionner un show</span>
                <button onClick={() => setShowPickModal(null)} className="text-gray-500 hover:text-white">✕</button>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed mb-4">
                Le show complet prend le dessus sur l'autoscript pendant sa plage (comme un chaser mais pour tout le show).
              </p>
              {useShowStore.getState().shows.length === 0 ? (
                <div className="text-[11px] text-gray-600 py-6 text-center border border-dashed border-gray-800 rounded-lg">
                  Aucun show sauvegardé.<br />
                  <span className="text-gray-500">Créez-en un dans Design → Show, puis réessayez.</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {useShowStore.getState().shows.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handlePickShowForTrack(showPickModal.trackId, s.id, s.name)}
                      className="w-full text-left px-3 py-2 rounded-lg bg-gray-800/40 border border-gray-700/40 hover:border-amber-500/50 hover:bg-amber-500/10 text-xs text-gray-300 flex items-center gap-2 transition-all"
                    >
                      <span className="text-amber-400">🎬</span>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex justify-end mt-4">
                <button onClick={() => setShowPickModal(null)} className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">Fermer</button>
              </div>
            </div>
          </div>
        </>
      )}
      {showInsertMenu && (
        <div className="fixed z-50 bg-[#1a1a2e] border border-amber-700/50 rounded-lg shadow-xl py-1 min-w-[200px]" style={{ left: showInsertMenu.x, top: showInsertMenu.y }}>
          <div className="px-3 py-1.5 text-[10px] text-amber-400 uppercase tracking-wider border-b border-gray-800">Import Show at {showInsertMenu.time.toFixed(1)}s</div>
          {useShowStore.getState().shows.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-600">Aucun show</div>
          ) : (
            useShowStore.getState().shows.map((s) => (
              <button key={s.id} onClick={() => handleInsertShowToTrack(showInsertMenu.trackId, showInsertMenu.time, s.id, s.name)} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-amber-500/10 flex items-center gap-2"><span className="text-amber-400">🎬</span>{s.name}</button>
            ))
          )}
          <div className="border-t border-gray-800 my-0.5" />
          <button onClick={() => { handleDeleteShowTrack(showInsertMenu.trackId); setShowInsertMenu(null); }} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800">Delete track</button>
          <button onClick={() => setShowInsertMenu(null)} className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800">Cancel</button>
        </div>
      )}
      {showEntryMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowEntryMenu(null)}>
          <div className="bg-[#1a1a2e] border border-amber-700/50 rounded-xl shadow-2xl py-3 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-1.5 text-[11px] text-amber-400 uppercase tracking-wider border-b border-gray-800">{showEntryMenu.entry.showName || 'Show'} — {showEntryMenu.entry.time.toFixed(2)}s → {showEntryMenu.entry.endTime.toFixed(2)}s</div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3">
              <div><label className="text-[10px] text-gray-500">Début (s)</label><input type="number" step="0.01" defaultValue={showEntryMenu.entry.time} id="__show_start" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
              <div><label className="text-[10px] text-gray-500">Fin (s)</label><input type="number" step="0.01" defaultValue={showEntryMenu.entry.endTime} id="__show_end" className="w-full mt-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200" /></div>
            </div>
            <div className="flex gap-2 px-4 pb-2">
              <button onClick={() => {
                const st = Number((document.getElementById('__show_start') as HTMLInputElement).value);
                const en = Number((document.getElementById('__show_end') as HTMLInputElement).value);
                const dur = resolvedAnalysis?.duration || 9999;
                if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st || st < 0 || en > dur) return;
                const idx = showTracks.find(t => t.id === showEntryMenu.trackId)?.entries.findIndex(e => e.id === showEntryMenu.entry.id) ?? -1;
                if (idx >= 0) handleShowEntryChange(showEntryMenu.trackId, idx, st, en);
                setShowEntryMenu(null);
              }} className="flex-1 py-1.5 rounded bg-amber-600 text-white text-xs hover:bg-amber-500">Appliquer</button>
              <button onClick={() => handleRemoveShowEntry(showEntryMenu.trackId, showEntryMenu.entry.id)} className="px-4 py-1.5 rounded bg-red-600/20 text-red-300 text-xs">Supprimer</button>
            </div>
            <button onClick={() => setShowEntryMenu(null)} className="w-full text-center py-1.5 text-[11px] text-gray-500 hover:text-gray-300">Fermer</button>
          </div>
        </div>
      )}
      {promptAction && (
        <PromptModal
          title={promptAction === 'save' ? (t('presetName') || 'Preset name:') : (t('presetName') || 'Preset name for export:')}
          onCancel={() => setPromptAction(null)}
          onOk={(name) => {
            const action = promptAction;
            setPromptAction(null);
            if (action === 'save') handleSaveAsPreset(name);
            else handleExportPreset(name);
          }}
        />
      )}
    </div>
  );
};

