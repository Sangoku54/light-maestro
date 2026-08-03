
import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, FolderOpen, RefreshCw, Undo2, Redo2, Trash2, Zap, ZapOff, Pencil, Plus, Palette, Sun, Layers, Repeat, Upload, Music, Crosshair, Disc, Settings } from 'lucide-react';
import { useAppStore, type CustomPalette, type ColorPreset } from '../stores/appStore';
import { useShowStore, type PatchedFixture } from '../stores/showStore';
import { AudioFileUpload, useAudioFileLoader } from '../hooks/useAudioFileLoader';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { TrackAnalysis, TrackSection, SECTION_COLORS, keyToPalette, SectionAnalysis, AtmosphereType } from '../hooks/audio-analysis';
import type { GenreProfile } from '../hooks/audio-analysis';
import { computeFixtureTrackOverrides, type FixtureTrack } from '../hooks/fixture-tracks';
import { loadFixtureDefinitions, clearFixtureDefCache, type DmxCue, type DmxFixtureDefinition } from '../hooks/dmx-cues';
import { useDmxPlayback, computeDmxForCue } from '../hooks/dmx-playback';
import { Stage3D } from './Stage3D';
import TrackTimeline from './TrackTimeline';
import type { EfxTrack, EfxTrackEntry } from './TrackTimeline';

type EnrichedCue = DmxCue;

/* ─── Helpers ──────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
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
    movement: cfg.sectionAware ? (baseMovement[section] || 'sweep') : cfg.movement || 'sweep',
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

function genCues(
  sections: TrackSection[],
  bpm: number,
  beatDivision: number,
  cfg: any,
  manualCues: DmxCue[],
  regenSeed?: number,
  analysis?: TrackAnalysis | null,
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
    let prevColor = basePal[0];
    let prevIntensity = 'medium';
    let cueGlobalIdx = 0; // across all sections, guarantees palette[3] (green) is reached

    // Detect build→drop boundary for anticipation effect
    const dropStartTimes = new Set<number>();
    for (let si = 1; si < sections.length; si++) {
      if (sections[si].type === 'drop' && sections[si-1].type === 'build') {
        dropStartTimes.add(sections[si].startTime);
      }
    }

    for (const section of sections) {
      const dur = section.endTime - section.startTime;
      // Per-section custom palette override
      const sectionPal = (cfg.customPalette?.[section.type]?.length > 0) ? cfg.customPalette[section.type] : basePal;
      const numCues = Math.max(1, Math.floor(dur / interval));
      const isNextDrop = dropStartTimes.has(section.endTime);

      for (let i = 0; i < numCues; i++) {
        const t = section.startTime + i * interval;
        if (t >= section.endTime) break;

        const feat = getFeature(t);
        const onDownbeat = isDownbeat(t);
        const beatIdx = getBeatIndex(t);
        const beatStrong = beatIdx >= 0 && analysis!.beatStrengths?.[beatIdx] === 'strong';

        // Règle 1 : RMS → intensité réelle
        const rms = feat?.rms ?? 0.5;
        let intensity: string;
        if (rms > 0.75) intensity = 'very-high';
        else if (rms > 0.50) intensity = 'high';
        else if (rms > 0.25) intensity = 'medium';
        else if (rms > 0.10) intensity = 'low';
        else intensity = 'very-low';

        const centroid = feat?.centroid ?? 0.5;
        const onset = feat?.onset ?? 0;
        const bassRatio = feat ? feat.bass / Math.max(0.01, feat.mid + feat.high) : 1;

        // Règle 2 : Downbeat → guaranteed full palette cycle
        // Each downbeat advances to the next color, centroid biases ±20% (neighbor swap)
        const changeNow = onDownbeat || onset > 0.2 || i === 0;
        const strobe = beatStrong && rms > 0.35;

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

        // Color cycle: audio-driven timing — centroid speeds up high-energy, RMS governs swap rate
        const colorCycleSpeed = 0.5 + centroid * 1.5 + rms * 2.0; // 0.5-4.0 cycles per section
        const sectionProgressNorm = dur > 0 ? (t - section.startTime) / dur : 0;
        const paletteIdx = Math.floor(sectionProgressNorm * sectionPal.length * colorCycleSpeed) % sectionPal.length;
        prevColor = sectionPal[paletteIdx];
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
        prevIntensity = intensity;

        // Energy: RMS + section + drop anticipation boost
        let energy = Math.max(0.05, Math.min(0.99, rms * sectionEnergyMult * 0.85 + 0.15));
        if (dropAnticipation) {
          // Anticipation: energy dips slightly before the drop
          energy = Math.max(0.1, energy * (1 - (beatsUntilDrop / 2) * 0.3));
        }

        const colorTemp: 'warm' | 'neutral' | 'cool' =
          centroid < 0.35 ? 'warm' : centroid > 0.65 ? 'cool' : 'neutral';

        // Movement: use section name so DMX engine distributes per-fixture
        // (getSmartMovement assigns different patterns to each fixture)
        const movement = section.type; // 'intro'|'verse'|'chorus'|etc → getSmartMovement distributes

        // Amplitude: audio-driven, section-scaled
        const movementAmplitude = (() => {
          switch (section.type) {
            case 'intro': return 0.05 + rms * 0.15;
            case 'outro': return 0.05 + rms * 0.1;
            case 'verse': return 0.15 + rms * 0.4;
            case 'chorus': return 0.3 + bassRatio * 0.35;
            case 'drop': return 0.4 + bassRatio * 0.45;
            case 'bridge': return 0.15 + rms * 0.25;
            case 'build': return dropAnticipation
              ? 0.35 + (1 - beatsUntilDrop / 2) * 0.3  // ramps up before drop
              : 0.15 + sectionProgress * 0.5;
            default: return 0.3;
          }
        })();

        const movementSpeed = (() => {
          const baseSpeed = 0.3 + centroid * 0.6;
          if (beatStrong) return baseSpeed * 1.2;
          if (dropAnticipation) return baseSpeed * 1.5; // speed up before drop
          return baseSpeed;
        })();

        cues.push({
          time: t,
          section: section.type,
          effect: `${section.type} #${i + 1}`,
          intensity: dropAnticipation ? 'high' : prevIntensity,
          colors: sectionPal,
          color: prevColor,
          strobe: dropAnticipation ? false : strobe, // no strobe during anticipation
          energy,
          movement,
          movementAmplitude,
          movementSpeed,
          colorTemp,
          strobeProbability: dropAnticipation ? 0 : beatStrong ? 0.8 : 0.15,
          dimmerPulseOnBeat: section.type === 'drop' || section.type === 'chorus',
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
          colorTemp: profile.colorTemp,
          strobeProbability: profile.strobeProbability,
          dimmerPulseOnBeat: profile.dimmerPulseOnBeat,
          musicStyle: genre,
        });
      }
    }
  }

  // Manual cues (override) — common to both paths
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
): Promise<void> {
  if (!analysis) return;
  const data: any = {
    analysis,
    sections,
    quickShow: qs,
    manualCues,
    efxTracks,
    fixtureTracks,
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
  try {
    localStorage.setItem('light-maestro:lastProject', JSON.stringify(data));
    console.log('[saveProject] Auto-saved to localStorage');
  } catch (e) { console.error('Failed to auto-save project:', e); }

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

async function saveShow(sections: TrackSection[], qs: any) {
  const data = { sections, quickShow: qs, timestamp: new Date().toISOString(), version: 1 };
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
        if (data.quickShow) setQs(data.quickShow);
        if (data.sections) setSections(data.sections);
        if (data.manualCues) setManualCues(data.manualCues);
        if (data.efxTracks) setEfxTracks(data.efxTracks);
        if (data.fixtureTracks) setFixtureTracks(data.fixtureTracks);
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

/* ─── QuickShowView wrapper ─────────────────────────── */

export const QuickShowView: React.FC<{ audioFile: ReturnType<typeof useAudioFileLoader> }> = ({ audioFile }) => {
  const { t } = useTranslation();
  const tab = useAppStore(s => s.quickSidebarTab);
  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div style={{ display: tab === 'autoscript' ? 'flex' : 'none' }} className="h-full flex-col">
        <AutoScriptPanel audioFile={audioFile} />
      </div>
      <div style={{ display: tab === 'audio' ? 'flex' : 'none' }} className="h-full flex-col">
        <AudioSourcePanel audioFile={audioFile} />
      </div>
      <div style={{ display: tab === 'colors' ? 'flex' : 'none' }} className="h-full flex-col">
        <ColorPresetsPanel />
      </div>
      <div style={{ display: tab === 'dj' ? 'flex' : 'none' }} className="h-full flex-col">
        <DjPanel />
      </div>
      <div style={{ display: tab === 'settings' ? 'flex' : 'none' }} className="h-full flex-col">
        <QuickSettingsPanel />
      </div>
    </div>
  );
};

/* ─── AudioSourcePanel ─────────────────────────────── */
const AudioSourcePanel: React.FC<{ audioFile: ReturnType<typeof useAudioFileLoader> }> = ({ audioFile }) => {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [systemAudioSupported, setSystemAudioSupported] = useState(false);
  const audioCapture = useAudioCapture();

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(devs => {
      const audioDevs = devs.filter(d => d.kind === 'audioinput');
      setDevices(audioDevs);
      // Check for system audio (loopback) support
      const hasLoopback = audioDevs.some(d => d.label.toLowerCase().includes('loopback') || d.label.toLowerCase().includes('stereo mix') || d.label.toLowerCase().includes('what you hear') || d.label.toLowerCase().includes('mixage stéréo'));
      setSystemAudioSupported(hasLoopback);
      if (audioDevs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioDevs[0].deviceId);
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <h2 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Music className="w-5 h-5 text-purple-400" />
        {t('sidebar.audioSource') || 'Source Audio'}
      </h2>

      {/* Audio file section */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4 mb-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Fichier Audio</h3>
        <div className="border-2 border-dashed border-gray-700 hover:border-purple-500/50 rounded-xl p-6 cursor-pointer bg-[#0a0a0f]"
          onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.onchange = async () => { const f = inp.files?.[0]; if (f) await audioFile.loadFile(f); }; inp.click(); }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) audioFile.loadFile(f); }}>
          <Upload className="w-8 h-8 text-gray-500 mx-auto mb-2" />
          <p className="text-xs text-gray-400">Glisser-déposer un fichier</p>
          <p className="text-[10px] text-gray-600 mt-1">MP3, WAV, FLAC, OGG, M4A</p>
          {audioFile.file && (
            <p className="text-xs text-purple-400 mt-2">{audioFile.file.name}</p>
          )}
        </div>
      </div>

      {/* Audio devices (system capture) */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Périphériques Audio Windows</h3>
        {devices.length === 0 ? (
          <p className="text-xs text-gray-600">Aucun périphérique audio détecté.</p>
        ) : (
          <div className="space-y-2">
            {devices.map(d => (
              <label key={d.deviceId} className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${selectedDeviceId === d.deviceId ? 'bg-purple-600/20 border border-purple-500/30' : 'bg-gray-800/30 border border-gray-700/30 hover:bg-gray-700/30'}`}>
                <input
                  type="radio"
                  name="audioDevice"
                  value={d.deviceId}
                  checked={selectedDeviceId === d.deviceId}
                  onChange={() => setSelectedDeviceId(d.deviceId)}
                  className="accent-purple-500"
                />
                <span className="text-xs text-gray-300">{d.label || `Périphérique ${d.deviceId.slice(0, 8)}`}</span>
                {d.label.toLowerCase().includes('loopback') || d.label.toLowerCase().includes('stereo mix') || d.label.toLowerCase().includes('mixage') ? (
                  <span className="text-[9px] bg-green-600/20 text-green-400 px-1.5 py-0.5 rounded">Loopback</span>
                ) : null}
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={async () => {
              try {
                await audioCapture.startCapture(selectedDeviceId);
              } catch { /* */ }
            }}
            disabled={!selectedDeviceId || audioCapture.isCapturing}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${audioCapture.isCapturing ? 'bg-red-600/20 text-red-300 border border-red-500/30' : 'bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30'} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {audioCapture.isCapturing ? 'Capture en cours...' : 'Démarrer la capture'}
          </button>
          {audioCapture.isCapturing && (
            <button
              onClick={() => audioCapture.stopCapture()}
              className="px-3 py-1.5 rounded text-xs bg-gray-700/30 text-gray-400 border border-gray-600/30 hover:bg-gray-700/50"
            >
              Arrêter
            </button>
          )}
        </div>
        {systemAudioSupported && (
          <p className="text-[10px] text-green-500/70 mt-2">Capture système (loopback) détectée — le son de vos applications sera analysé.</p>
        )}
        {!systemAudioSupported && devices.length > 0 && (
          <p className="text-[10px] text-amber-500/70 mt-2">Aucun périphérique loopback détecté. Activez « Mixage stéréo » dans les paramètres audio Windows pour capturer le son système.</p>
        )}
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
                    title={`${color} — clic pour modifier`}
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
                          title={`${color} — clic pour modifier`}
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
              onClick={() => {
                const name = prompt('Nom du preset :');
                if (!name) return;
                addColorPreset(name, activeColors);
              }}
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
    </div>
  );
};

/* ─── DjPanel ──────────────────────────────────────── */
const DjPanel: React.FC = () => {
  const { t } = useTranslation();
  const qs = useAppStore(s => s.quickShow);
  const setQs = useAppStore(s => s.setQuickShow);
  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <h2 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Disc className="w-5 h-5 text-amber-400" />
        {t('sidebar.djIntegration') || 'Intégration DJ'}
      </h2>
      <p className="text-xs text-gray-500 mb-6">Ces réglages sont synchronisés avec l'onglet AutoScript. Les modifications ici se reflètent immédiatement dans le show.</p>
      <div className="space-y-4">
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4">
          <label className="text-xs text-gray-400 block mb-2 font-semibold">Style Musical</label>
          <select
            value={qs.musicStyle || 'dance'}
            onChange={e => setQs({ musicStyle: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 w-full cursor-pointer"
          >
            {['dance','disco','techno','rock','rnb','reggaeton','latino','electro','house','dubstep','hiphop','funk','ballad'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-600 mt-1">Définit la palette de couleurs et l'énergie de base.</p>
        </div>
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4">
          <label className="text-xs text-gray-400 block mb-2 font-semibold">Palette de Couleurs</label>
          <select
            value={qs.colorScheme || 'auto'}
            onChange={e => setQs({ colorScheme: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 w-full cursor-pointer"
          >
            {['auto','warm','cool','party','monochrome','neon','pastel','dance','disco','techno','rock','rnb','reggaeton','latino','electro','house','dubstep','hiphop','funk'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4">
          <label className="text-xs text-gray-400 block mb-2 font-semibold">Intensité</label>
          <select
            value={qs.intensity || 'dynamic'}
            onChange={e => setQs({ intensity: e.target.value as any })}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 w-full cursor-pointer"
          >
            {['very-low','low','medium','high','very-high','dynamic'].map(i => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4">
          <label className="text-xs text-gray-400 block mb-2 font-semibold">Division de Beat</label>
          <select
            value={qs.beatDivision || 4}
            onChange={e => setQs({ beatDivision: Number(e.target.value) as any })}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 w-full cursor-pointer"
          >
            {[1,2,4,8].map(d => <option key={d} value={d}>1/{d}</option>)}
          </select>
          <p className="text-[10px] text-gray-600 mt-1">1/1 = lent, 1/8 = rapide.</p>
        </div>
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4">
          <label className="text-xs text-gray-400 block mb-2 font-semibold">Mouvement</label>
          <select
            value={qs.movement || 'dynamic'}
            onChange={e => setQs({ movement: e.target.value as any })}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 w-full cursor-pointer"
          >
            {['smooth','sharp','dynamic'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer bg-[#0d0d14] border border-gray-800/50 rounded-lg p-4">
          <input
            type="checkbox"
            checked={qs.sectionAware !== false}
            onChange={e => setQs({ sectionAware: e.target.checked })}
            className="w-4 h-4 accent-purple-500"
          />
          <span className="text-xs text-gray-300">Section-Aware (adapte l'intensité par partie)</span>
        </label>
      </div>
    </div>
  );
};

/* ─── QuickSettingsPanel ────────────────────────────── */
const QuickSettingsPanel: React.FC = () => {
  const { t } = useTranslation();
  const qs = useAppStore(s => s.quickShow);
  const setQs = useAppStore(s => s.setQuickShow);
  return (
    <div className="flex-1 flex flex-col p-6 overflow-y-auto">
      <h2 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5 text-gray-400" />
        {t('common.settings') || 'Settings'}
      </h2>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Strobe Limit (Hz)</label>
          <input
            type="range"
            min={1}
            max={25}
            value={qs.strobeLimit || 10}
            onChange={e => setQs({ strobeLimit: Number(e.target.value) })}
            className="w-full"
          />
          <span className="text-xs text-gray-500">{qs.strobeLimit || 10} Hz</span>
        </div>
        <div>
          <label className="text-xs text-gray-400 uppercase tracking-wider">{t('quickshow.fade', 'Fondu')} ({qs.colorFadeMs || 250}ms)</label>
          <input type="range" min={0} max={2000} step={50} value={qs.colorFadeMs || 250} onChange={e => setQs({ colorFadeMs: Number(e.target.value) })} className="w-full" />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Movement</label>
          <select
            value={qs.movement || 'dynamic'}
            onChange={e => setQs({ movement: e.target.value as any })}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-300 w-full"
          >
            {['smooth','sharp','dynamic'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Color Track Visible</label>
          <input
            type="checkbox"
            checked={qs.showColorTrack || false}
            onChange={e => setQs({ showColorTrack: e.target.checked })}
            className="w-4 h-4"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Strobe Track Visible</label>
          <input
            type="checkbox"
            checked={qs.showStrobeTrack || false}
            onChange={e => setQs({ showStrobeTrack: e.target.checked })}
            className="w-4 h-4"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Dimmer Track Visible</label>
          <input
            type="checkbox"
            checked={qs.showDimmerTrack || false}
            onChange={e => setQs({ showDimmerTrack: e.target.checked })}
            className="w-4 h-4"
          />
        </div>
      </div>
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

  const patchedFixtures = useShowStore(s => s.patchedFixtures);
  const fixtureGroups = useShowStore(s => s.fixtureGroups);
  const universes = useShowStore(s => s.universes);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [dmxOutputEnabled, setDmxOutputEnabled] = useState(true);
  const [dmxCues, setDmxCues] = useState<DmxCue[]>([]);
  const dmxCuesRef = useRef<DmxCue[]>([]);
  const lastDmxCuesRef = useRef<DmxCue[]>([]);
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
  const [manualCues, setManualCues] = useState<DmxCue[]>([]);
  const [efxTracks, setEfxTracks] = useState<EfxTrack[]>([]);
  const [fixtureTracks, setFixtureTracks] = useState<FixtureTrack[]>([]);
  const fixtureTracksRef = useRef<FixtureTrack[]>([]);
  fixtureTracksRef.current = fixtureTracks;
  const fixtureGroupsRef = useRef<{ id: string; fixtureIds: string[] }[]>([]);
  fixtureGroupsRef.current = useShowStore.getState().fixtureGroups;
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
  const firedRef = useRef<Set<string>>(new Set());

  /* ─── Undo/redo ──────────────────────────────────── */
  const undoHistoryRef = useRef<{ sections: TrackSection[]; manual: DmxCue[]; efx: EfxTrack[]; fixtureTracks: FixtureTrack[] }[]>([]);
  const redoHistoryRef = useRef<{ sections: TrackSection[]; manual: DmxCue[]; efx: EfxTrack[]; fixtureTracks: FixtureTrack[] }[]>([]);
  const canUndo = undoHistoryRef.current.length > 0;
  const canRedo = redoHistoryRef.current.length > 0;

  const pushHistory = useCallback(() => {
    undoHistoryRef.current.push({
      sections: [...sections],
      manual: [...manualCues],
      efx: [...efxTracks],
      fixtureTracks: [...fixtureTracks],
    });
    redoHistoryRef.current = [];
  }, [sections, manualCues, efxTracks, fixtureTracks]);

  const undo = useCallback(() => {
    const state = undoHistoryRef.current.pop();
    if (!state) return;
    redoHistoryRef.current.push({ sections: [...sections], manual: [...manualCues], efx: [...efxTracks], fixtureTracks: [...fixtureTracks] });
    setSections(state.sections);
    setManualCues(state.manual);
    setEfxTracks(state.efx);
    setFixtureTracks(state.fixtureTracks);
  }, [sections, manualCues, efxTracks, fixtureTracks]);

  const redo = useCallback(() => {
    const state = redoHistoryRef.current.pop();
    if (!state) return;
    undoHistoryRef.current.push({ sections: [...sections], manual: [...manualCues], efx: [...efxTracks], fixtureTracks: [...fixtureTracks] });
    setSections(state.sections);
    setManualCues(state.manual);
    setEfxTracks(state.efx);
    setFixtureTracks(state.fixtureTracks);
  }, [sections, manualCues, efxTracks, fixtureTracks]);

  const clearAudio = useCallback(() => {
    pushHistory();
    setSections([]);
    setManualCues([]);
    setEfxTracks([]);
    setFixtureTracks([]);
    // Reset audio file + analysis
    audioFile.clear();
  }, [pushHistory, audioFile]);

  /* ─── Custom palettes ────────────────────────────── */
  const [autoPal, setAutoPal] = useState<string>('');
  const lastAnalysisKeyRef = useRef<string>('');

  useEffect(() => {
    if (resolvedAnalysis?.key && resolvedAnalysis.key !== lastAnalysisKeyRef.current) {
      lastAnalysisKeyRef.current = resolvedAnalysis.key;
      const pal = keyToPalette[resolvedAnalysis.key];
      if (pal && pal !== qs.colorScheme && qs.colorScheme === 'auto') {
        setAutoPal(pal);
      }
    }
  }, [resolvedAnalysis, qs.colorScheme]);

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

  const onSectionClick = useCallback((idx: number) => {
    setPicker({ idx, x: 0, y: 0 });
  }, []);

  /* ─── Preset file dialog loader ───────────────── */
  const [presetsDropdown, setPresetsDropdown] = useState(false);
  const [savedPresets, setSavedPresets] = useState<Array<{ name: string; timestamp: string; data: any }>>([]);
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
  const effectiveBpm = useMemo(() => {
    if (syncMode === 'manual') return manualBpm;
    if (syncMode === 'tap' && tapBpm > 0) return tapBpm;
    return resolvedAnalysis?.bpm || 120;
  }, [syncMode, manualBpm, tapBpm, resolvedAnalysis]);

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
          if (data.quickShow) setQs(data.quickShow);
          if (data.sections) setSections(data.sections);
          if (data.manualCues) setManualCues(data.manualCues);
          if (data.efxTracks) setEfxTracks(data.efxTracks);
          if (data.fixtureTracks) setFixtureTracks(data.fixtureTracks);
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
            manualCues: data.manualCues || [],
            createdAt: new Date().toISOString(),
          }]);
        } catch (e) {
          console.error('Failed to load preset file:', e);
        }
        resolve();
      };
      inp.click();
    });
  }, [audioFile, setQs, setSections, setManualCues, setEfxTracks, setFixtureTracks]);

  const handleSaveAsPreset = useCallback(() => {
    const name = prompt(t('presetName') || 'Preset name:');
    if (!name) return;
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
        // Batch-compute DMX cues for VC playback
        const currentCues = genCues(sections, effectiveBpm, qs.beatDivision || 4, qs, manualCues, key, resolvedAnalysis);
        const store = useShowStore.getState();
        const pf = store.patchedFixtures;
        const uni = store.universes;
        const fDefs = fixtureDefsRef.current;
        const tierMultipliers = { primary: qs.tierConfig?.primary || 100, secondary: qs.tierConfig?.secondary || 70, tertiary: qs.tierConfig?.tertiary || 40 };
        let dmxCuesArray: DmxCue[] = [];
        if (currentCues.length > 0 && pf.length > 0 && fDefs.size > 0) {
          for (const cue of currentCues) {
            try {
              const overrides = computeFixtureTrackOverrides(fixtureTracksRef.current, cue.time, pf, fixtureGroupsRef.current);
              const computed = computeDmxForCue(cue, pf, fDefs, uni as any, tierMultipliers, overrides);
              for (const c of computed) {
                dmxCuesArray.push({
                  time: cue.time, section: cue.section, universe: c.universe,
                  channelValues: c.channelValues, fixtureNames: [], fixtureCount: 0,
                  effect: cue.effect, colors: cue.colors || [],
                });
              }
            } catch { /* skip individual cue errors */ }
          }
        }

        // Sync to showStore.songPresets (for VC widget)
        const audioFileName = resolvedAnalysis?.fileName || file?.name || name;
        const existingPresets = store.songPresets.filter(p => p.name !== name);
        store.setSongPresets([...existingPresets, {
          id: `qs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          audioFileBase64: audioDataUrl || '',
          audioFileName,
          dmxCues: dmxCuesArray,
          quickShow: qs,
          trackAnalysis: resolvedAnalysis,
          sections,
          efxTracks,
          manualCues,
          createdAt: new Date().toISOString(),
        }]);

        // Save to IPC
        const data: any = {
          analysis: resolvedAnalysis,
          sections,
          quickShow: qs,
          manualCues,
          efxTracks,
          fixtureTracks,
        };
        if (audioBase64Raw) data.audioDataBase64 = audioBase64Raw;
        const api = (window as any).lightMaestro?.presets;
        if (!api) { console.error('IPC presets API not available — window.lightMaestro.presets is undefined'); alert('Preset save failed: IPC bridge not loaded.'); return; }
        const list = await api.load();
        const newPreset = { name, timestamp: new Date().toISOString(), data };
        const updated = [...(Array.isArray(list) ? list : []), newPreset];
        await api.save(updated);
        setSavedPresets(updated);
      } catch (e) { console.error('Failed to save preset:', e); }
    })();
  }, [qs, resolvedAnalysis, sections, manualCues, efxTracks, fixtureTracks, audioFile, effectiveBpm, key]);

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
    pushHistory();
    setQs(qsData);
    if (sectionsData) setSections(sectionsData);
    if (manualCuesData) setManualCues(manualCuesData);
    if (efxTracksData) setEfxTracks(efxTracksData);
    if (fixtureTracksData) setFixtureTracks(fixtureTracksData);
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
    // Sync to showStore.songPresets (for VC widget)
    const store = useShowStore.getState();
    const existingPresets = store.songPresets.filter(p => p.name !== presetName);
    store.setSongPresets([...existingPresets, {
      id: `qs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: presetName,
      audioFileBase64: audioDataUrl,
      audioFileName: analysisData?.fileName || presetName,
      dmxCues: dmxCuesData || [],
      quickShow: qsData,
      trackAnalysis: analysisData,
      sections: sectionsData || [],
      efxTracks: efxTracksData || [],
      manualCues: manualCuesData || [],
      createdAt: new Date().toISOString(),
    }]);
    setPresetsDropdown(false);
  }, [setQs, setSections, setManualCues, setEfxTracks, setFixtureTracks, audioFile, pushHistory]);

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
    // no-op — replaced by full preset save/load
  }, []);

  /* ─── Cues generation ────────────────────────────── */
  const cues = useMemo(() => {
    if (sections.length === 0) return [];
    return genCues(sections, effectiveBpm, qs.beatDivision || 4, qs, manualCues, key, resolvedAnalysis);
  }, [sections, effectiveBpm, qs.beatDivision, qs.musicStyle, qs.colorScheme, qs.intensity, qs.movement, qs.sectionAware, qs.customPalette, qs.audioReactive, manualCues, key, resolvedAnalysis]);
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
      const computed = computeDmxForCue(
        cues[0],
        patchedFixtures,
        fixtureDefs,
        universes as any,
        { primary: qs.tierConfig?.primary || 100, secondary: qs.tierConfig?.secondary || 70, tertiary: qs.tierConfig?.tertiary || 40 },
        computeFixtureTrackOverrides(fixtureTracksRef.current, cues[0].time, patchedFixtures, fixtureGroupsRef.current),
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
  useDmxPlayback({
    isPlaying: audioFile.isPlaying,
    currentTimeRef: currentTimeRef,
    cues: cues as any,
    patchedFixtures,
    fixtureDefs,
    universes: universes.map(u => ({ id: u.id, name: u.name, type: u.type, channels: u.channels })) as any,
    dmxOutputEnabled,
    tierMultipliers: { primary: qs.tierConfig?.primary || 100, secondary: qs.tierConfig?.secondary || 70, tertiary: qs.tierConfig?.tertiary || 40 },
    overrideCuesRef: overrideCuesRef as any,
    fixtureTracksRef,
    fixtureGroupsRef,
    colorFadeMs: qs.colorFadeMs ?? 250,
    onVirtualDmx: (uni, chVals) => {
      const aps = useAppStore.getState();
      for (const [ch, val] of Object.entries(chVals)) {
        aps.setChannelValue(uni, Number(ch), val);
      }
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
    }
  }, [resolvedAnalysis]);

  /* ─── EFX handlers ──────────────────────────────── */
  const [efxTrackModal, setEfxTrackModal] = useState(false);
  const [fadeModal, setFadeModal] = useState(false);
  const [efxTrackName, setEfxTrackName] = useState('');
  const [efxTargetType, setEfxTargetType] = useState<'all' | 'group' | 'fixture'>('all');
  const [efxTargetGroupId, setEfxTargetGroupId] = useState('');
  const [efxTargetFixtureIds, setEfxTargetFixtureIds] = useState<string[]>([]);
  const [efxPattern, setEfxPattern] = useState<'static' | 'sweep' | 'circle' | 'pulse' | 'wave' | 'bounce' | 'figure8' | 'spiral' | 'zigzag' | 'heartbeat' | 'randomWalk' | 'diamond' | 'custom'>('static');

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
  const [float3DSize, setFloat3DSize] = useState({ w: 1920, h: 1080 });
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
      setFloat3DPos({ x: float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX, y: float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY });
    };
    const onUp = () => { float3DDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DPos]);

  const handleAddEfxTrack = useCallback(() => {
    const name = efxTrackName.trim();
    if (!name) return;
    pushHistory();
    const newTrack: EfxTrack = {
      id: `efxt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      entries: [],
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
  }, [pushHistory, efxTrackName, efxTargetType, efxTargetGroupId, efxTargetFixtureIds]);

  const openEfxTrackModal = useCallback(() => {
    setEfxTrackName('');
    setEfxTargetType('all');
    setEfxTargetGroupId('');
    setEfxTargetFixtureIds([]);
    setEfxTrackModal(true);
  }, []);

  const handleRemoveEfxTrack = useCallback((trackId: string) => {
    pushHistory();
    setEfxTracks(prev => prev.filter(t => t.id !== trackId));
  }, [pushHistory]);

  const handleInsertEfxToTrack = useCallback((trackId: string, time: number, effectId: string, effectName: string, pattern: string) => {
    setEfxTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        entries: [...t.entries, {
          time,
          endTime: Math.min(time + 4, resolvedAnalysis?.duration || 120),
          effectId,
          effectName,
          pattern,
          fixtureNames: [],
        }].sort((a, b) => a.time - b.time),
      };
    }));
  }, [resolvedAnalysis]);

  const handleEfxTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setEfxContextMenu({ trackId, time, x: clientX, y: clientY });
  }, []);

  const handleEfxEntryContextMenu = useCallback((trackId: string, entry: EfxTrackEntry, clientX: number, clientY: number) => {
    setEfxEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);

  const handleRemoveEfxEntry = useCallback((trackId: string, entryTime: number) => {
    setEfxTracks(prev => prev.map(t => {
      if (t.id !== trackId) return t;
      return { ...t, entries: t.entries.filter(e => e.time !== entryTime) };
    }));
    setEfxEntryMenu(null);
  }, []);

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
        <button title={t('save') || 'Save'} onClick={() => saveProject(resolvedAnalysis, sections, qs, audioFile, manualCues, efxTracks, fixtureTracks)} className="p-1 rounded text-gray-400 hover:text-white">
          <Save className="w-3.5 h-3.5" />
        </button>
        <button title={t('open') || 'Open'} onClick={() => loadProject(setQs, audioFile, setSections, setManualCues, setEfxTracks, setFixtureTracks)} className="p-1 rounded text-gray-400 hover:text-white">
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
              <button onClick={() => { setPresetsDropdown(false); handleSaveAsPreset(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                <Save className="w-3 h-3" /> Save Preset
              </button>
              <button onClick={() => { setPresetsDropdown(false); loadPresetFile(); }} className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                <FolderOpen className="w-3 h-3" /> Load from file...
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

        {/* Color scheme */}
        <select
          value={qs.colorScheme || 'auto'}
          onChange={e => setQs({ colorScheme: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
        >
          {['auto', 'warm', 'cool', 'party', 'monochrome', 'neon', 'pastel', 'dance', 'disco', 'techno', 'rock', 'rnb', 'reggaeton', 'latino', 'electro', 'house', 'dubstep', 'hiphop', 'funk'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

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
          {['very-low', 'low', 'medium', 'high', 'very-high', 'dynamic'].map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>

        {/* Section aware */}
        <Chip
          active={qs.sectionAware !== false}
          onClick={() => setQs({ sectionAware: !(qs.sectionAware !== false) })}
          label="Section"
          icon={<Layers className="w-3 h-3" />}
        />

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
      </div>

      {/* Row 2: Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/30 bg-[#0a0a0f] flex-wrap">
        {/* Color track toggle */}
        <Chip
          active={qs.showColorTrack}
          onClick={() => setQs({ showColorTrack: !qs.showColorTrack })}
          label="Color"
          icon={<Palette className="w-3 h-3" />}
          color="pink"
        />
        <Chip
          active={qs.showStrobeTrack}
          onClick={() => setQs({ showStrobeTrack: !qs.showStrobeTrack })}
          label="Strobe"
          icon={<Zap className="w-3 h-3" />}
          color="yellow"
        />
        <Chip
          active={qs.showDimmerTrack}
          onClick={() => setQs({ showDimmerTrack: !qs.showDimmerTrack })}
          label="Dimmer"
          icon={<Sun className="w-3 h-3" />}
          color="cyan"
        />

        <div className="h-4 border-l border-gray-700 mx-1" />

        {/* Entity insert buttons */}
        <Chip
          label="Scene"
          onClick={() => setShowScenePicker(v => !v)}
          icon={<Plus className="w-3 h-3" />}
        />
        {showScenePicker && entitySceneList.length > 0 && (
          <div ref={scenePickerRef} className="absolute z-40 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px] max-h-44 overflow-y-auto" style={{ marginTop: '80px' }}>
            {entitySceneList.map(s => (
              <button key={s.id} onClick={() => { handleInsertEntity(0, resolvedAnalysis?.duration || 60, 'scene', s.id); setShowScenePicker(false); }} className="w-full text-left px-3 py-1 text-[11px] text-gray-300 hover:bg-gray-800">
                {s.name}
              </button>
            ))}
          </div>
        )}

        <Chip
          label="Chaser"
          onClick={() => setShowChaserPicker(v => !v)}
          icon={<Repeat className="w-3 h-3" />}
        />
        {showChaserPicker && entityChaserList.length > 0 && (
          <div ref={chaserPickerRef} className="absolute z-40 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px] max-h-44 overflow-y-auto" style={{ marginTop: '80px' }}>
            {entityChaserList.map(c => (
              <button key={c.id} onClick={() => { handleInsertEntity(0, resolvedAnalysis?.duration || 60, 'chaser', c.id); setShowChaserPicker(false); }} className="w-full text-left px-3 py-1 text-[11px] text-gray-300 hover:bg-gray-800">
                {c.name}
              </button>
            ))}
          </div>
        )}

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

        <div className="flex-1" />

        {/* Section info */}
        <span className="text-[9px] text-gray-600">
          BPM: {effectiveBpm} · {t('sections') || 'Sections'}: {sections.length}
          {resolvedAnalysis?.key && ` · Key: ${resolvedAnalysis.key}`}
          {resolvedAnalysis?.atmosphere && ` · ${resolvedAnalysis.atmosphere}`}
        </span>
      </div>

      {/* Audio waveform + upload */}
      <div className="px-3 pt-2">
        <AudioFileUpload
          externalState={audioFile}
          onSelectionChange={onSelChange}
          onSectionClick={onSectionClick}
          sections={sections}
          onInsertEntity={handleInsertEntity}
          scenes={entitySceneList}
          chasers={entityChaserList}
          cueLists={entityCueListList}
          effects={entityEffectList}
        />
      </div>

      {/* TrackTimeline */}
      <div className="flex-1 px-3 py-2 overflow-auto">
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
          onSectionsChange={(newSecs: TrackSection[]) => { pushHistory(); setSections(newSecs); }}
          fixtureTracks={fixtureTracks}
          onFixtureTracksChange={setFixtureTracks}
          showColorTrack={qs.showColorTrack}
          showStrobeTrack={qs.showStrobeTrack}
          showDimmerTrack={qs.showDimmerTrack}
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

      {/* Section picker */}
      {picker !== null && (
        <div className="fixed z-50 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{ left: picker.x || 'auto', top: picker.y || 'auto' }}
          ref={(el) => { if (el) { const rect = el.getBoundingClientRect(); if (rect.bottom > window.innerHeight) el.style.top = 'auto'; } }}
        >
          {(['intro', 'verse', 'chorus', 'bridge', 'drop', 'outro', 'build', 'unknown'] as TrackSection['type'][]).map(type => (
            <button key={type}
              onClick={() => { changeType(picker.idx, type); setPicker(null); }}
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
            onClick={() => triggerAddColor(sections[picker.idx]?.type as keyof CustomPalette || 'unknown')}
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
          style={{ left: efxContextMenu.x, top: efxContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-cyan-400 uppercase tracking-wider border-b border-gray-800">
            Insert EFX at {efxContextMenu.time.toFixed(1)}s
          </div>
          {effectEntities.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-gray-500 italic">Aucun effet custom. Créez un effet de mouvement dans l'onglet EFX d'abord.</div>
          ) : (
            effectEntities.map(efx => (
              <button key={efx.id}
                onClick={() => {
                  handleInsertEfxToTrack(efxContextMenu.trackId, efxContextMenu.time, efx.id, efx.name, efx.pattern || 'Circle');
                  setEfxContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
              >
                <span className="text-[14px]">⚡</span>
                {efx.name}
              </button>
            ))
          )}
          <div className="border-t border-gray-800 my-0.5" />
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

      {/* EFX entry context menu */}
      {efxEntryMenu && (
        <div
          ref={efxEntryMenuRef}
          className="fixed z-50 bg-[#1a1a2e] border border-cyan-700/50 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: efxEntryMenu.x, top: efxEntryMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-cyan-400 uppercase tracking-wider border-b border-gray-800">
            {efxEntryMenu.entry.effectName} ({efxEntryMenu.entry.pattern})
          </div>
          <div className="px-3 py-1 text-[9px] text-gray-600">
            {efxEntryMenu.entry.time.toFixed(1)}s – {efxEntryMenu.entry.endTime.toFixed(1)}s
          </div>
          <button
            onClick={() => handleRemoveEfxEntry(efxEntryMenu.trackId, efxEntryMenu.entry.time)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800"
          >
            Remove entry
          </button>
          <button
            onClick={() => setEfxEntryMenu(null)}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-800"
          >
            Cancel
          </button>
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
      {showScenePicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowScenePicker(false)} />
      )}
      {showChaserPicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowChaserPicker(false)} />
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
            <Stage3D />
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
                <span className="text-sm font-semibold text-gray-200">New EFX Track</span>
                <button onClick={() => setEfxTrackModal(false)} className="text-gray-500 hover:text-white">✕</button>
              </div>

              {/* Track name */}
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
                <button onClick={() => setEfxTrackModal(false)}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">
                  Cancel
                </button>
                <button
                  onClick={handleAddEfxTrack}
                  disabled={!efxTrackName.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add Track
                </button>
              </div>
            </div>
          </div>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setEfxTrackModal(false)} />
        </>
      )}
    </div>
  );
};

