/**
 * DMX Playback Hook — Direct on-the-fly DMX computation and hardware output.
 *
 * Computes DMX values ON EVERY FRAME for the current playback time,
 * then sends them directly to hardware via IPC.
 *
 * Architecture:
 *   Renderer → IPC setChannels → Engine writes SAB → Worker reads SAB
 *   Worker → frameSent → Engine dispatches to USB/ArtNet/sACN outputs
 *
 * NOTE-PROGRAMME (TODO): Exploitation maximale — chaque fixture doit exploiter
 *   100% de ses canaux. Per-pixel chase (rgbSegments) + Effect/Speed/Beam
 *   génériques ajoutés pour wall-washer/barres. À auditer fixture par fixture
 *   (voir fixture-analyzer.ts NOTE-PROGRAMME).
 */

import { useEffect, useRef } from 'react';
import type { PatchedFixture, FixtureGroup, FixtureTier } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureCapability } from './dmx-cues';
import { resolveTrackTargets, computeEfxOverrides, type EfxTrackRef, type FixtureTrack, type MovementBlock } from './fixture-tracks';

// ─── Color Track ref type (for DMX playback resolution) ──
export interface ColorTrackRef {
  id: string;
  entries: Array<{ id: string; time: number; endTime: number; color: string; endColor?: string }>;
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
  /** Display name (debug/diagnostics only). */
  name?: string;
}

export interface StrobeTrackRef {
  id: string;
  entries: Array<{ id: string; time: number; endTime: number; speed: number; endSpeed?: number }>;
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

export interface DimmerTrackRef {
  id: string;
  entries: Array<{ id: string; time: number; endTime: number; value: number; endValue?: number }>;
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

/** Compute per-fixture strobe overrides from active strobe track entries at a given time. */
export function computeStrobeTrackOverrides(
  strobeTracks: StrobeTrackRef[],
  currentTime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): Map<string, { active: boolean; speed: number }> {
  const result = new Map<string, { active: boolean; speed: number }>();
  for (const stItem of strobeTracks) {
    if (stItem.entries.length === 0) continue;
    const activeEntry = stItem.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!activeEntry || !stItem.targetFixtures) continue;
    const tf = stItem.targetFixtures;
    let targets: string[] = [];
    if (tf.type === 'all') {
      targets = patchedFixtures.map(f => f.id);
    } else if (tf.type === 'group' && tf.groupId) {
      const group = fixtureGroups.find(g => g.id === tf.groupId);
      targets = group?.fixtureIds || [];
    } else if (tf.type === 'fixture' && tf.fixtureIds) {
      targets = tf.fixtureIds;
    }
    for (const fid of targets) {
      let speed = activeEntry.speed;
      if (activeEntry.endSpeed !== undefined && activeEntry.endSpeed !== activeEntry.speed) {
        const dur = activeEntry.endTime - activeEntry.time;
        const t = dur > 0 ? Math.max(0, Math.min(1, (currentTime - activeEntry.time) / dur)) : 1;
        speed = activeEntry.speed + (activeEntry.endSpeed - activeEntry.speed) * t;
      }
      result.set(fid, { active: true, speed });
    }
  }
  return result;
}

/** Compute per-fixture dimmer overrides from active dimmer track entries at a given time. */
export function computeDimmerTrackOverrides(
  dimmerTracks: DimmerTrackRef[],
  currentTime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): Map<string, { active: boolean; value: number }> {
  const result = new Map<string, { active: boolean; value: number }>();
  for (const dtItem of dimmerTracks) {
    if (dtItem.entries.length === 0) continue;
    const activeEntry = dtItem.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!activeEntry || !dtItem.targetFixtures) continue;
    const tf = dtItem.targetFixtures;
    let targets: string[] = [];
    if (tf.type === 'all') {
      targets = patchedFixtures.map(f => f.id);
    } else if (tf.type === 'group' && tf.groupId) {
      const group = fixtureGroups.find(g => g.id === tf.groupId);
      targets = group?.fixtureIds || [];
    } else if (tf.type === 'fixture' && tf.fixtureIds) {
      targets = tf.fixtureIds;
    }
    for (const fid of targets) {
      let value = activeEntry.value;
      if (activeEntry.endValue !== undefined && activeEntry.endValue !== activeEntry.value) {
        const dur = activeEntry.endTime - activeEntry.time;
        const t = dur > 0 ? Math.max(0, Math.min(1, (currentTime - activeEntry.time) / dur)) : 1;
        value = activeEntry.value + (activeEntry.endValue - activeEntry.value) * t;
      }
      result.set(fid, { active: true, value });
    }
  }
  return result;
}

/** Compute per-fixture forced colors from active color track entries at a given time. */
export function computeColorTrackColors(
  colorTracks: ColorTrackRef[],
  currentTime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const ctItem of colorTracks) {
    if (!ctItem.entries || ctItem.entries.length === 0) continue;
    const activeEntry = ctItem.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!activeEntry || !ctItem.targetFixtures) continue;
    const tf = ctItem.targetFixtures;
    let targets: string[] = [];
    if (tf.type === 'all') {
      targets = patchedFixtures.map(f => f.id);
    } else if (tf.type === 'group' && tf.groupId) {
      const group = fixtureGroups.find(g => g.id === tf.groupId);
      targets = group?.fixtureIds || [];
    } else if (tf.type === 'fixture' && tf.fixtureIds) {
      targets = tf.fixtureIds;
    }
    // Sanitize color field: handle 0, undefined, or non-string values
    const entryColor = (typeof activeEntry.color === 'string' && activeEntry.color.startsWith('#'))
      ? activeEntry.color
      : (typeof (activeEntry as any).endColor === 'string' && (activeEntry as any).endColor?.startsWith('#'))
        ? (activeEntry as any).endColor
        : undefined;
    const entryEndColor = (typeof activeEntry.endColor === 'string' && activeEntry.endColor.startsWith('#'))
      ? activeEntry.endColor
      : undefined;
    for (const fid of targets) {
      if (entryEndColor && entryColor && entryEndColor !== entryColor) {
        const dur = activeEntry.endTime - activeEntry.time;
        const t = dur > 0 ? Math.max(0, Math.min(1, (currentTime - activeEntry.time) / dur)) : 1;
        const [sr, sg, sb] = hexToRgb(entryColor);
        const [er, eg, eb] = hexToRgb(entryEndColor);
        const r = Math.round(sr + (er - sr) * t);
        const g = Math.round(sg + (eg - sg) * t);
        const b = Math.round(sb + (eb - sb) * t);
        result.set(fid, `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`);
      } else if (entryColor) {
        result.set(fid, entryColor);
      }
    }
  }
  return result;
}

import type { SavedEffect } from '../stores/showStore';

/** A chaser track entry: a block on the timeline that references a saved chaser. */
export interface ChaserTrackEntryRef {
  id: string;
  time: number;
  endTime: number;
  chaserId: string;
  chaserName?: string;
}

/** Chaser track lane (mirror of the timeline type, for the playback engine). */
export interface ChaserTrackRef {
  id: string;
  entries: ChaserTrackEntryRef[];
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
  /** Display name (debug/diagnostics only). */
  name?: string;
}

export interface ShowTrackEntryRef {
  id: string;
  time: number;
  endTime: number;
  showId: string;
  showName?: string;
}
export interface ShowTrackRef {
  id: string;
  entries: ShowTrackEntryRef[];
  name?: string;
}

/**
 * Resolve chaser playback at an absolute time inside a block.
 * The chaser loops its steps (fadeIn → hold → fadeOut, exact ms) while the block is active,
 * then control is handed back to the autoscript. Deterministic per frame — no state needed.
 * Returns per-fixture address→value overrides for fully controlled fixtures.
 */
export function computeChaserTrackOverrides(
  chaserTracks: ChaserTrackRef[],
  chasers: Array<{ id: string; name?: string; steps: Array<{ sceneId: string; fadeIn?: number; hold?: number; fadeOut?: number }> }>,
  scenes: Array<{ id: string; channels: Record<number, number> }>,
  currentTime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): Map<string, Record<number, number>> {
  const controlled = new Map<string, Record<number, number>>();
  for (const tr of chaserTracks) {
    if (!tr.entries || tr.entries.length === 0) continue;
    const entry = tr.entries.find(e => {
      const s = Math.min(e.time, e.endTime), en = Math.max(e.time, e.endTime);
      return currentTime >= s && currentTime < en;
    });
    if (!entry) continue;
    const chaser = chasers.find(c => c.id === entry.chaserId);
    if (!chaser) continue;
    if (!chaser.steps || chaser.steps.length === 0) continue;

    // A chaser plays its OWN fixtures: targets = fixtures whose address range is
    // covered by the channels of the scenes referenced by the chaser steps.
    const sceneIds = new Set(chaser.steps.map(s => s.sceneId));
    const addrSet = new Set<number>();
    for (const sc of scenes) {
      if (sceneIds.has(sc.id) && sc.channels) {
        for (const addrStr of Object.keys(sc.channels)) addrSet.add(Number(addrStr));
      }
    }
    let targets: string[] = [];
    for (const pf of patchedFixtures) {
      for (let a = pf.startAddress; a < pf.startAddress + pf.channelCount; a++) {
        if (addrSet.has(a)) { targets.push(pf.id); break; }
      }
    }
    if (targets.length === 0) continue;

    // Deterministic step resolution: loop the chaser while the block is active
    // NOTE: currentTime/entry.time are in SECONDS, step durations are in MS →
    // convert elapsed time to ms before modulating against the cycle total.
    const cycles = chaser.steps.map(s => Math.max(1, (s.fadeIn || 0) + (s.hold || 0) + (s.fadeOut || 0)));
    const total = cycles.reduce((a, b) => a + b, 0);
    const pos = total > 0 ? Math.max(0, (currentTime - entry.time) * 1000) % total : 0;
    let acc = 0;
    let stepIdx = 0;
    for (let i = 0; i < cycles.length; i++) {
      if (pos < acc + cycles[i]) { stepIdx = i; break; }
      acc += cycles[i];
      stepIdx = i;
    }
    const step = chaser.steps[stepIdx];
    const sd = cycles[stepIdx] || 1;
    const within = pos - acc;
    const fi = Math.max(1, step.fadeIn || 0);
    const fo = Math.max(1, step.fadeOut || 0);
    let scale = 1;
    if (within < fi) scale = Math.min(1, within / fi);
    else if (within >= sd - fo) scale = Math.max(0, 1 - (within - (sd - fo)) / fo);
    else scale = 1;
    const scene = scenes.find(s => s.id === step.sceneId);
    if (!scene || !scene.channels) continue;
    const addrMap: Record<number, number> = {};
    for (const addrStr in scene.channels) {
      const addr = Number(addrStr);
      const val = Number(scene.channels[addrStr]);
      addrMap[addr] = Math.max(0, Math.min(255, Math.round(Number.isFinite(val) ? val * scale : 0)));
    }
    for (const fid of targets) controlled.set(fid, addrMap);
  }
  return controlled;
}

export function computeShowTrackOverrides(
  showTracks: ShowTrackRef[],
  shows: Array<{ id: string; name?: string; duration: number; tracks: Array<{ type: string; items: Array<{ startTime: number; duration: number; resourceId: string; fadeIn?: number; fadeOut?: number }>; muted?: boolean }> }>,
  scenes: Array<{ id: string; channels: Record<number, number> }>,
  chasers: Array<{ id: string; steps: Array<{ sceneId: string; fadeIn?: number; hold?: number; fadeOut?: number }> }>,
  currentTime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): Map<string, Record<number, number>> {
  const controlled = new Map<string, Record<number, number>>();
  if (!showTracks || showTracks.length === 0 || !shows || shows.length === 0) return controlled;
  for (const tr of showTracks) {
    if (!tr.entries || tr.entries.length === 0) continue;
    const entry = tr.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!entry) continue;
    const show = shows.find(s => s.id === entry.showId);
    if (!show || !show.tracks) continue;
    const elapsed = (currentTime - entry.time) * 1000; // show time in ms
    const merged: Record<number, number> = {};
    const mergeShow = (vals: Record<number, number>) => {
      for (const [k,v] of Object.entries(vals)) {
        const a = Number(k);
        const prev = merged[a];
        if (prev === undefined || v > prev) merged[a] = v;
      }
    };
    for (const st of show.tracks) {
      if ((st as any).muted) continue;
      for (const item of (st as any).items as Array<{ startTime: number; duration: number; resourceId: string; fadeIn?: number; fadeOut?: number }>) {
        if (elapsed < item.startTime || elapsed >= item.startTime + item.duration) continue;
        const itemElapsed = elapsed - item.startTime;
        let intensity = 1;
        const fi = item.fadeIn ?? 0, fo = item.fadeOut ?? 0;
        if (itemElapsed < fi && fi>0) intensity = itemElapsed/fi;
        else if (itemElapsed > item.duration - fo && fo>0) intensity = 1 - (itemElapsed - (item.duration - fo))/fo;
        if ((st as any).type === 'scene') {
          const sc = scenes.find(s => s.id === item.resourceId);
          if (!sc || !sc.channels) continue;
          const faded: Record<number, number> = {};
          for (const [addrStr,val] of Object.entries(sc.channels)) faded[Number(addrStr)] = Math.round(Number(val)*intensity);
          mergeShow(faded);
        } else if ((st as any).type === 'chaser') {
          const chaser = chasers.find(c => c.id === item.resourceId);
          if (!chaser || !chaser.steps.length) continue;
          const total = chaser.steps.reduce((a,s)=>a+Math.max(1,(s.fadeIn||0)+(s.hold||0)+(s.fadeOut||0)),0);
          if (total<=0) continue;
          const cyclePos = itemElapsed % total;
          let acc=0;
          for (const step of chaser.steps) {
            const sd = Math.max(1,(step.fadeIn||0)+(step.hold||0)+(step.fadeOut||0));
            if (cyclePos>=acc && cyclePos<acc+sd) {
              const stepElapsed = cyclePos-acc;
              let si=1;
              if (stepElapsed < (step.fadeIn||0) && (step.fadeIn||0)>0) si=stepElapsed/(step.fadeIn||0);
              else if (stepElapsed > sd-(step.fadeOut||0) && (step.fadeOut||0)>0) si=1-(stepElapsed-(sd-(step.fadeOut||0)))/(step.fadeOut||0);
              const sc = scenes.find(s=>s.id===step.sceneId);
              if (sc && sc.channels) {
                const faded: Record<number, number> = {};
                for (const [addrStr,val] of Object.entries(sc.channels)) faded[Number(addrStr)] = Math.round(Number(val)*si*intensity);
                mergeShow(faded);
              }
              break;
            }
            acc+=sd;
          }
        }
      }
    }
    if (Object.keys(merged).length===0) continue;
    // Determine fixtures touched by this show entry (HTP map to fixtures)
    const addrs = new Set<number>(Object.keys(merged).map(Number));
    const targets: string[] = [];
    for (const pf of patchedFixtures) {
      for (let a=pf.startAddress; a<pf.startAddress+pf.channelCount; a++) if (addrs.has(a)) { targets.push(pf.id); break; }
    }
    if (targets.length===0) {
      // fallback to all fixtures if show has no channel overlap (e.g. virtual)
      for (const pf of patchedFixtures) targets.push(pf.id);
    }
    for (const fid of targets) {
      const pf = patchedFixtures.find(p=>p.id===fid);
      if (!pf) continue;
      const perFix: Record<number, number> = {};
      for (const [addrStr,val] of Object.entries(merged)) {
        const a = Number(addrStr);
        if (a>=pf.startAddress && a<pf.startAddress+pf.channelCount) perFix[a]=val;
      }
      if (Object.keys(perFix).length>0) controlled.set(fid, perFix);
    }
  }
  return controlled;
}

// Stage-aware pan/tilt clamping to keep beams on stage
// ─── Extracted utilities (pure functions, no React) ──────
import { evalEffect, toDmx, type EffectPattern } from '../engine/effect-engine';
import type { RgbSegment } from '../engine/dmx-color';
import { hexToRgb, applyHueShift, TIER_HUE, classifyColor, mapIntensity, startsWithRgb, hasColorWord, isRed, isGreen, isBlue, isWhite, isPresetMode, buildRgbSegments, findBestWheelCap } from '../engine/dmx-color';
import type { ChannelAnalysis } from '../engine/fixture-analyzer';
import { analyzeChannels, capMid, pickLaserModeCap, laserGateValue, type FixtureChannelAnalysis } from '../engine/fixture-analyzer';
import { clampPanToStage, clampTiltToStage, SMART_MOVEMENTS, DEFAULT_SMART_MOVEMENTS, getSmartMovement, spatialPhaseFor } from '../engine/dmx-movement';
import { useAppStore } from '../stores/appStore';
import { dmxBridge } from '../utils/dmx-bridge';
import { recordAudioTick } from '../utils/latency-meter';


/**
 * Dispatch DMX channel values to the correct universe based on fixture address ranges.
 * Maps an address-based channel record to per-universe channel records.
 */
export function dispatchChannelsByFixture(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: { id: string }[],
): Map<number, Record<number, number>> {
  const uniIds = universes.map(u => String(u.id));
  const dispatched = new Map<number, Record<number, number>>();

  for (const pf of patchedFixtures) {
    const uniIdx = uniIds.indexOf(pf.universeId);
    const uniNum = uniIdx >= 0 ? uniIdx : 0;
    const base = pf.startAddress;
    const endAddr = base + pf.channelCount;

    const uniVals = dispatched.get(uniNum) || {};
    for (const addrStr in channelValues) {
      const val = channelValues[addrStr];
      const addr = Number(addrStr);
      if (addr >= base && addr < endAddr) {
        // HTP merge within universe
        const existing = uniVals[addr];
        if (existing === undefined || val > existing) {
          uniVals[addr] = val;
        }
      }
    }
    if (Object.keys(uniVals).length > 0) {
      dispatched.set(uniNum, uniVals);
    }
  }

  return dispatched;
}

// ─── Cue input type (compatible with genCues output) ───

export interface CuePlayback {
  time: number;
  section: string;
  effect: string;
  intensity: string;
  colors: string[];
  color: string;
  strobe: boolean;
  group?: string;
  colorTemp?: 'warm' | 'neutral' | 'cool';
  strobeProbability?: number;
  dimmerPulseOnBeat?: boolean;
  colorShiftSpeed?: number;
  movement?: 'static' | 'sweep' | 'circle' | 'pulse' | 'wave' | 'bounce' | 'figure8' | 'spiral' | 'zigzag' | 'heartbeat' | 'randomWalk' | 'diamond';
  movementAmplitude?: number;
  movementSpeed?: number;
  /** Chorégraphie spatiale par section : wave | circle | expand | contract | alternate | off. */
  spatialPattern?: string;
  energy?: number;
  /** Tiers de fixtures actifs pour cette cue (densité par section, ex. intro = ['primary']). */
  activeTiers?: string[];
  forcedColor?: string;
  forcedStrobe?: boolean;
  forcedDimmerVal?: number;
  strobeSpeed?: number;
}

export interface UniversePlayback {
  id: string;
  name: string;
  type?: string;
  channels?: number;
}

export function useDmxPlayback(options: {
  isPlaying: boolean; currentTimeRef: React.MutableRefObject<number>;
  cues: CuePlayback[]; patchedFixtures: PatchedFixture[];
  fixtureDefs: Map<string, DmxFixtureDefinition>; universes: UniversePlayback[];
  dmxOutputEnabled: boolean;
  tierMultipliers?: { primary: number; secondary: number; tertiary: number };
  strobeLimit?: number;
  colorFadeMs?: number;
  overrideCuesRef?: React.MutableRefObject<any[]>; // EFX + manual cues that override auto DMX
  fixtureTracksRef?: React.MutableRefObject<FixtureTrack[]>; // Fixture track overrides
  efxTracksRef?: React.MutableRefObject<EfxTrackRef[]>; // EFX track pan/tilt overrides
  effectsRef?: React.MutableRefObject<SavedEffect[]>; // Saved effect definitions
  fixtureGroupsRef?: React.MutableRefObject<{ id: string; fixtureIds: string[] }[]>;
  colorTracksRef?: React.MutableRefObject<ColorTrackRef[]>; // Color track overrides
  strobeTracksRef?: React.MutableRefObject<StrobeTrackRef[]>; // Strobe track overrides
  dimmerTracksRef?: React.MutableRefObject<DimmerTrackRef[] | null>; // Dimmer track overrides (highest priority for intensity)
  chaserTracksRef?: React.MutableRefObject<ChaserTrackRef[] | null>; // Chaser track takeover (full control of target fixtures)
  chasersRef?: React.MutableRefObject<Array<{ id: string; steps: Array<{ sceneId: string; fadeIn?: number; hold?: number; fadeOut?: number }> }>>; // Saved chasers
  scenesRef?: React.MutableRefObject<Array<{ id: string; channels: Record<number, number> }>>; // Saved scenes (for chaser steps)
  showTracksRef?: React.MutableRefObject<ShowTrackRef[] | null>; // Show track takeover (full show over autoscript)
  showsRef?: React.MutableRefObject<Array<{ id: string; name?: string; duration: number; tracks: Array<{ type: string; items: Array<{ startTime: number; duration: number; resourceId: string; fadeIn?: number; fadeOut?: number }>; muted?: boolean }> }>>;
  disabledFixturesRef?: React.MutableRefObject<Set<string>>; // Disabled fixture IDs
  fixturePositionsRef?: React.MutableRefObject<Record<string, { x: number; y: number; h?: number }>>; // For stage-aware pan/tilt
  panTiltLimitsRef?: React.MutableRefObject<{ pan: number; tilt: number; perFixture?: Record<string, { pan: number; tilt: number }> }>; // DMX half-amplitude limits for autoscript movement (128 = full)
  onVirtualDmx?: (universe: number, channelValues: Record<number, number>) => void; // Mirror for 3D view
  dryRunMode?: boolean; // Skip hardware DMX output, keep store/3D updates
  frozenRef?: React.MutableRefObject<boolean>; // Freeze: hold current DMX frame
  forceDropRef?: React.MutableRefObject<boolean>; // Force next tick to use drop parameters
  arbiterSource?: string; // Output-arbiter source id this engine writes as (default 'quickshow')
}): void {
  const {isPlaying,currentTimeRef,cues,patchedFixtures,fixtureDefs,universes,dmxOutputEnabled,tierMultipliers,strobeLimit=10,colorFadeMs=250,overrideCuesRef,fixtureTracksRef,efxTracksRef,effectsRef,fixtureGroupsRef,colorTracksRef,strobeTracksRef,dimmerTracksRef,chaserTracksRef,chasersRef,scenesRef,showTracksRef,showsRef,onVirtualDmx,disabledFixturesRef,fixturePositionsRef,panTiltLimitsRef,dryRunMode=false,frozenRef,forceDropRef,arbiterSource}=options;
  const arbSource = arbiterSource ?? 'quickshow';
  const cuesRef=useRef(cues);cuesRef.current=cues;
  const dmxEnabledRef=useRef(dmxOutputEnabled);dmxEnabledRef.current=dmxOutputEnabled;
  const dryRunRef=useRef(dryRunMode);dryRunRef.current=dryRunMode;
  // Keep the bridge dry-run flag in sync (hardware flush happens in the bridge)
  useEffect(()=>{ dmxBridge.setDryRun(dryRunMode); },[dryRunMode]);
  // When dry-run is enabled, stop the hardware engine so it stops retrying a
  // missing USB port (e.g. COM6) while the user previews in 3D. Turning dry-run
  // off lets the tick loop's engine re-check start it again on next play.
  useEffect(()=>{
    if(!dryRunMode)return;
    const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
    if(!api)return;
    api.stop().catch(()=>{});
  },[dryRunMode]);
  const lastChannelsRef=useRef<Map<number,Record<number,number>>>(new Map());
  // Dernier pan/tilt émis par fixture : quand une chaser track gèle une fixture
  // dont la scène ne porte pas le pan/tilt, on maintient la dernière position
  // au lieu de laisser l'autoscript animer (exigence "rester fixe").
  const chaserHoldRef=useRef<Map<string,{pan:number,tilt:number}>>(new Map());
  const freezerRef=useRef(frozenRef);freezerRef.current=frozenRef;
  const forceDropRefLocal=useRef(forceDropRef);forceDropRefLocal.current=forceDropRef;
  const patchedFixturesRef=useRef(patchedFixtures);patchedFixturesRef.current=patchedFixtures;

  // Pre-compute fixture channel analysis (re-computed when fixtures change)
  const analysisRef=useRef<{byUniverse:Map<number,ChannelAnalysis[]>;uniIds:string[];_key?:string}|null>(null);
  useEffect(()=>{
    if(patchedFixtures.length===0||universes.length===0){analysisRef.current=null;return;}
    const uniIds=universes.map(u=>String(u.id));
    const analyses:ChannelAnalysis[]=[];
    for(const pf of patchedFixtures){
      let def=fixtureDefs.get(pf.fixtureDefId);
      if(!def){
        const chCount=pf.channelCount||1;
        // Fallback intelligent basé sur le nom du modèle quand la définition
        // officielle n'existe pas. Cela permet à l'autoscript et au chaser de fonctionner.
        const model=(pf.model||'').toLowerCase();
        const channels: any[]=[];
        // Canal 0 : Dimmer
        channels.push({offset:0,name:'Dimmer',type:'Intensity'});
        // Canaux RGB basés sur le nom
        if(/rgbw|4in1|rwb/i.test(model)){
          channels.push({offset:1,name:'Red',type:'Colour'});
          channels.push({offset:2,name:'Green',type:'Colour'});
          channels.push({offset:3,name:'Blue',type:'Colour'});
          channels.push({offset:4,name:'White',type:'Colour'});
        }else if(/rgb/i.test(model)){
          channels.push({offset:1,name:'Red',type:'Colour'});
          channels.push({offset:2,name:'Green',type:'Colour'});
          channels.push({offset:3,name:'Blue',type:'Colour'});
        }
        // Pan/Tilt pour moving heads / beams
        if(/moving.?head|beam|spot|wash/i.test(model)){
          channels.push({offset:channels.length,name:'Pan',type:'Pan'});
          channels.push({offset:channels.length,name:'Tilt',type:'Tilt'});
        }
        // Compléter avec des canaux génériques
        while(channels.length<chCount){
          channels.push({offset:channels.length,name:`CH ${channels.length+1}`});
        }
        // Le mode par défaut doit exister à l'index modeIndex : les patched
        // fixtures utilisent ex. modeIndex=1 ("14-channel") et analyseChannels
        // lit def.modes[pf.modeIndex]. Un tableau d'un seul mode rendait
        // modes[1]/[2] undefined → canaux [] → analyse vide → aucune chaîne
        // écrite (fixtures muettes en lecture). On duplique le mode construit
        // jusqu'à couvrir l'index référencé par la fixture.
        const modeObj={name:'Default',channelCount:chCount,channels};
        const modes=new Array((pf.modeIndex||0)+1).fill(null).map(()=>({...modeObj,channels:[...channels]}));
        def={id:pf.fixtureDefId,manufacturer:pf.manufacturer||'Unknown',model:pf.model||pf.name,fixtureType:pf.fixtureType||'Unknown',modes,wheels:[]} as any;
      }
      const fa=analyzeChannels(pf,def);
      fa.universeIndex=uniIds.indexOf(pf.universeId);
      if(fa.universeIndex<0)fa.universeIndex=0;
      analyses.push(fa);
    }
    const byUniverse=new Map<number,ChannelAnalysis[]>();
    for(const fa of analyses){
      const list=byUniverse.get(fa.universeIndex)??[];
      list.push(fa);byUniverse.set(fa.universeIndex,list);
    }
    // Only update if data actually changed to avoid RAF loop re-mounts.
    // Le key inclut une signature des définitions : quand loadFixtureDefinitions
    // résout les vraies defs custom en async (après un premier passage en
    // fallback), le key change et l'analyse est recalculée — sinon une analyse
    // figée en fallback rendrait les fixtures muettes pour toute la lecture.
    const prev=analysisRef.current;
    const defsSig=patchedFixtures.map(pf=>{
      const d=fixtureDefs.get(pf.fixtureDefId);
      return d?`${d.id}|${d.modes?.length ?? -1}|${(d.modes[pf.modeIndex]?.channels?.length ?? -1)}`:'-';
    });
    const newKey=JSON.stringify({uniIds,counts:analyses.map(a=>a.fixture.id),defsSig});
    if(prev?._key!==newKey){
      analysisRef.current={byUniverse,uniIds,_key:newKey};
    }
  },[patchedFixtures,fixtureDefs,universes]);

  // Ensure DMX engine is started
  const engineStartedRef=useRef(false);
  useEffect(()=>{
    const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
    if(!api||universes.length===0)return;
    // Dry-run: don't start the hardware engine at all — the 3D preview is
    // written renderer-side (channelData) and never needs the USB/sACN backend.
    if(dryRunRef.current)return;
    let cancelled=false;
    (async()=>{
      try{
        if(await api.isRunning().catch(()=>false)){engineStartedRef.current=true;return;}
        await Promise.all(universes.map((u:any)=>api.addUniverse({
          id:u.id,name:u.name,type:u.type||'usb-dmx',output:true,input:false,
          channels:u.channels||512,serialPort:u.serialPort||'',
          artnetIP:u.artnetIP||'',artnetSubnet:u.artnetSubnet??0,artnetUniverse:u.artnetUniverse??0,
          sacnUniverse:u.sacnUniverse??1,sacnPriority:u.sacnPriority??100,
        }).catch(()=>{})));
        if(cancelled)return;
        await api.start().catch(()=>{});
        engineStartedRef.current=true;
      }catch{/* engine start is best-effort */}
    })();
    return()=>{cancelled=true;};
    // Only run on mount / when universes change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Main playback RAF loop
  const rafRef=useRef<number>(0);
  const hasPlayedRef=useRef(false);

  useEffect(()=>{
    if(!isPlaying){
      if(hasPlayedRef.current&&dmxEnabledRef.current){
        hasPlayedRef.current=false;
        const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
        const savedChannels = lastChannelsRef.current;
        if(savedChannels.size > 0 && api){
          // Fade-out on pause: step down to 0 over 200ms (quadratic ease-out)
          const fadeStart = performance.now() / 1000;
          const fadeDuration = 0.2;
          const tickFade = (now: number) => {
            const elapsed = (now / 1000) - fadeStart;
            if(elapsed >= fadeDuration){
              // Final zero
              for(let uniIdx=0;uniIdx<universes.length;uniIdx++){
                const black:Record<number,number>={};for(let ch=1;ch<=512;ch++)black[ch]=0;
                useAppStore.getState().setUniverseData(uniIdx, black);
                dmxBridge.push(uniIdx, black, arbSource);
                if(onVirtualDmx)onVirtualDmx(uniIdx,black);
              }
              return;
            }
            const t = elapsed / fadeDuration;
            const factor = 1.0 - (t * t);
            for(const[uniIdx,channels]of savedChannels.entries()){
              const faded:Record<number,number>={};
              for(const chStr in channels){
                const ch=Number(chStr);const val=channels[chStr];
                faded[Number(ch)]=Math.round(Number(val) * factor);
              }
              useAppStore.getState().setUniverseData(uniIdx, faded);
              dmxBridge.push(uniIdx, faded, arbSource);
              if(onVirtualDmx)onVirtualDmx(uniIdx,faded);
            }
            requestAnimationFrame(tickFade);
          };
          requestAnimationFrame(tickFade);
        }else{
          // No saved channels: zero immediately (fallback)
          for(let uniIdx=0;uniIdx<universes.length;uniIdx++){
            const black:Record<number,number>={};for(let ch=1;ch<=512;ch++)black[ch]=0;
            useAppStore.getState().setUniverseData(uniIdx, black);
            dmxBridge.push(uniIdx, black, arbSource);
            if(onVirtualDmx)onVirtualDmx(uniIdx,black);
          }
        }
      }
      return;
    }

    hasPlayedRef.current=true;
    const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
    // Dry-run preview must not require the hardware DMX API: the 3D mirror is
    // written renderer-side. Without this guard, a missing `lightMaestro.dmx`
    // killed the whole playback loop (and therefore the 3D show) even in DRY.
    if(!api && !dryRunRef.current)return;
    console.warn('[DMX-PLAYBACK] lecture démarrée —',
      'dryRun='+dryRunRef.current,
      'dmxOutput='+dmxEnabledRef.current,
      'api='+(!!api),
      'cues='+(cuesRef.current?.length ?? -1),
      'analysis='+(analysisRef.current ? 'ok' : 'NULL'),
      'universes='+universes.length,
      'fixtures='+patchedFixtures.length);
    // Dry-run mode: skip hardware DMX, keep store/3D updates. Hardware flush is
    // skipped in dmxBridge.flushToHardware; dryRunRef is checked at every engine
    // start/restart site below so the engine is never started in dry-run.


    // Ensure engine is started (re-attempt on first play tick if needed)
    if(!engineStartedRef.current && !dryRunRef.current){
      engineStartedRef.current=true;
      (async()=>{
        try{
          if(await api.isRunning().catch(()=>false))return;
          await Promise.all(universes.map((u:any)=>api.addUniverse({
            id:u.id,name:u.name,type:u.type||'usb-dmx',output:true,input:false,
            channels:u.channels||512,serialPort:u.serialPort||'',
            artnetIP:u.artnetIP||'',artnetSubnet:u.artnetSubnet??0,artnetUniverse:u.artnetUniverse??0,
            sacnUniverse:u.sacnUniverse??1,sacnPriority:u.sacnPriority??100,
          }).catch(()=>{})));
          await api.start().catch(()=>{});
        }catch{/* best effort */}
      })();
    }

    const movementPhase=Math.random()*1000;
    let lastSig=0;
    let lastStoreUpdate=0;

    // Color fade: EMA smoothing between palette changes (~250ms at 60fps)
    const fadeState=new Map();const FADE_ALPHA=colorFadeMs>0?1-Math.exp(Math.log(0.1)/(colorFadeMs/16.67)):0.98;
        const tick=()=>{
      if(!dmxEnabledRef.current){rafRef.current=requestAnimationFrame(tick);return;}
      const ct=currentTimeRef.current;
      const c=cuesRef.current;
      const analysis=analysisRef.current;
      if(!analysis||c.length===0){rafRef.current=requestAnimationFrame(tick);return;}
      // Re-arm the engine if the watchdog stopped/blacked it out mid-session
      // (checked ~every 2s at 60fps). The engine's start() now lifts
      // fail-safe blackouts, so output resumes without an app restart.
      (tick as any)._engineRecheck = ((tick as any)._engineRecheck ?? 119) + 1;
      if((tick as any)._engineRecheck >= 120){
        (tick as any)._engineRecheck = 0;
        if(dryRunRef.current)return; // dry-run: never (re)start the hardware engine
        (async()=>{
          try{
            const a=(window as any).lightMaestro?.dmx;
            if(!a)return;
            if(!(await a.isRunning().catch(()=>false))){
              await a.start().catch(()=>{});
            }
          }catch{/* best effort */}
        })();
      }
      // Latency meter: this cycle reads audio-derived state (audio clock,
      // section/energy from analysis) — mark the start of the audio→DMX cycle.
      recordAudioTick();
      // Freeze: hold last DMX frame, skip all computation
      if (freezerRef.current?.current) {
        const lastCh = lastChannelsRef.current;
        if (lastCh.size > 0) {
          for (const [uId, chMap] of lastCh) {
            const uIdx = analysis.uniIds.indexOf(String(uId));
            if (uIdx < 0) continue;
            const cpy = { ...chMap };
            dmxBridge.push(uId, cpy, arbSource);
            if (onVirtualDmx) onVirtualDmx(uId, { ...cpy });
          }
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const fixturePositions = fixturePositionsRef?.current;
      const panTiltLimits = panTiltLimitsRef?.current ?? { pan: 128, tilt: 128 };

      // ── Color track forced colors (compute early, used later in palette resolution) ──
      const ctRefData = colorTracksRef?.current || [];
      const colorTrackColors = computeColorTrackColors(
        ctRefData,
        ct,
        patchedFixturesRef.current,
        fixtureGroupsRef?.current || [],
      );
      // (diag colorTrack retiré prod — gardé seulement si __DEBUG__)

      // Find active cue: direct latest-before-ct, NO section grouping
      let active:CuePlayback|null=null;
      for(const cue of c){if(cue.time<=ct&&(!active||cue.time>active.time))active=cue;}
      // Pre-compute section for use throughout tick (isDrop, isChorus, strobe sectionMult, movement fallback)
      const sec:string = active?.section?.toLowerCase() ?? 'verse';
      // Standby / blackout at boundaries
      let fadeFactor = 1.0;
      // 2) No active cue → hard cut to 0
      if(!active){
        if(analysis){
          for(const[uniIdx]of analysis.byUniverse.entries()){
            const uid=analysis.uniIds[uniIdx];if(!uid)continue;
            const zeroCh:Record<number,number>={};
            for(let ch=1;ch<=512;ch++)zeroCh[ch]=0;
            useAppStore.getState().setUniverseData(uniIdx, zeroCh);
            dmxBridge.push(uniIdx, zeroCh, arbSource);
            if(onVirtualDmx)onVirtualDmx(uniIdx,zeroCh);
          }
        }
        rafRef.current=requestAnimationFrame(tick);
        return;
      }
      // 3) End fade-out: fade to black over 1.0s after last cue (quadratic ease-out)
      if(c.length>0 && ct > c[c.length-1].time){
        const fadeDuration = 1.0;
        const elapsed = ct - c[c.length-1].time;
        if(elapsed >= fadeDuration){
          if(analysis){
            for(const[uniIdx]of analysis.byUniverse.entries()){
              const uid=analysis.uniIds[uniIdx];if(!uid)continue;
              const zeroCh:Record<number,number>={};
              for(let ch=1;ch<=512;ch++)zeroCh[ch]=0;
              useAppStore.getState().setUniverseData(uniIdx, zeroCh);
              dmxBridge.push(uniIdx, zeroCh, arbSource);
              if(onVirtualDmx)onVirtualDmx(uniIdx,zeroCh);
            }
          }
          rafRef.current=requestAnimationFrame(tick);
          return;
        }
        const t = elapsed / fadeDuration;
        fadeFactor = 1.0 - (t * t);
      }

      // Dimmer track overrides: computed BEFORE the crossfade snapshot so the
      // next-cue blend also respects the track (highest priority for intensity).
      const dimmerOverrides = dimmerTracksRef?.current && dimmerTracksRef.current.length > 0
        ? computeDimmerTrackOverrides(dimmerTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
        : null;

      // Crossfade: find next cue and pre-compute its DMX values
      let nextCue:CuePlayback|null=null;
      let crossfadeT = 0;
      for(const cue of c){if(cue.time>ct&&(!nextCue||cue.time<nextCue.time))nextCue=cue;}
      let nextCueDmx:Array<{universe:number;channelValues:Record<number,number>}>|null=null;
      if(nextCue&&active){const gap=nextCue.time-active.time;if(gap>0&&gap<0.3){const window=Math.min(0.15,gap*0.5);const start=nextCue.time-window;if(ct>=start){crossfadeT=Math.min(1,(ct-start)/window);}}}
      // Pre-compute strobe overrides early so they're available for crossfade
      const strobeOverridesEarly = strobeTracksRef?.current && strobeTracksRef.current.length > 0
        ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
        : null;
      if(crossfadeT>0&&nextCue){
        try{
          // Track takeover in crossfade snapshot: the blend must not mix autoscript
          // movement into fixtures driven by user tracks (or a chaser).
          const ftoSnap: { forcedMovements: Map<string, { pattern: string; amplitude: number; speed?: number }> } = { forcedMovements: new Map() };
          if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
            for (const ft of fixtureTracksRef.current) {
              if (!ft.enabled) continue;
              const targets = resolveTrackTargets(ft, patchedFixturesRef.current, fixtureGroupsRef.current);
              if (targets.length === 0) continue;
              for (const b of ft.movementBlocks) {
                if (ct >= b.time && ct < b.endTime) {
                  for (const fid of targets) ftoSnap.forcedMovements.set(fid, { pattern: b.pattern, amplitude: b.amplitude, speed: b.speed });
                  break;
                }
              }
            }
          }
          const choSnap = computeChaserTrackOverrides(
            chaserTracksRef.current,
            chasersRef.current,
            scenesRef.current,
            ct,
            patchedFixturesRef.current,
            fixtureGroupsRef?.current || [],
          );
          nextCueDmx=computeDmxForCue(
            nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,ftoSnap,
            colorTrackColors,strobeOverridesEarly,dimmerOverrides,disabledFixturesRef?.current,fixturePositions,choSnap
          );
        }catch(e){crossfadeT=0;nextCueDmx=null;console.warn('[crossfade] computeDmxForCue failed, skipping:',e);}
      }


    const energy=active.energy??(active.intensity==='very-high'?0.95:active.intensity==='high'?0.8:active.intensity==='medium'?0.5:active.intensity==='low'?0.25:0.1);
    // Drop Now: force max energy + strobe for ~300ms via setTimeout
    let dropBoost = 0;
    if (forceDropRefLocal.current?.current) {
      dropBoost = 0.95;
      forceDropRefLocal.current.current = false;
      setTimeout(() => { dropBoost = 0; }, 300);
    }
    const effectiveEnergy = dropBoost > 0 ? dropBoost : energy;
    const isDrop=sec==='drop'||dropBoost>0;const isChorus=sec==='chorus';
    // Boost strobe during drop force
    const forcedStrobe = dropBoost > 0 ? true : active.forcedStrobe;

      // Pre-compute active EFX/manual override for this frame
      let efxActive:Record<number,number>|null=null;let efxTime=0;
      if(overrideCuesRef?.current){for(const oc of overrideCuesRef.current){if(oc.time<=ct&&oc.time>=efxTime){efxTime=oc.time;efxActive=oc.channelValues;}}}

// Pre-compute EFX track pan/tilt overrides for this frame
       const efxPtOverrides = efxTracksRef?.current && effectsRef?.current && efxTracksRef.current.some(t => t.entries.length > 0)
         ? computeEfxOverrides(efxTracksRef.current, ct, effectsRef.current, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
         : null;

      // Debug: log if EFX tracks exist but no overrides computed
      if (!efxPtOverrides || efxPtOverrides.size === 0) {
        if (efxTracksRef?.current && efxTracksRef.current.length > 0 && effectsRef?.current && effectsRef.current.length > 0) {
          const hasEntries = efxTracksRef.current.some(t => t.entries.length > 0);
          if (hasEntries) {}
        }
      }
      const efxMap=efxActive||{};

      // ── Hoist per-frame computations OUT of the fixture loop (perf P1) ──
      // Pre-compute once per frame instead of once per fixture
      // (dimmerOverrides is computed earlier, before the crossfade snapshot)
      const strobeOverrides = strobeOverridesEarly;
      // Pre-compute fixture-track targets for this frame
      const fixtureTrackTargets: Array<{ ft: FixtureTrack; targets: string[] }> = [];
      if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
        for (const ft of fixtureTracksRef.current) {
          if (!ft.enabled) { fixtureTrackTargets.push({ ft, targets: [] }); continue; }
          fixtureTrackTargets.push({ ft, targets: resolveTrackTargets(ft, patchedFixturesRef.current, fixtureGroupsRef.current) });
        }
      }
      // Build a per-fixture lookup: fixtureId → array of { ft, targets }
      const fixtureTrackMap = new Map<string, Array<{ ft: FixtureTrack; targets: string[] }>>();
      for (const entry of fixtureTrackTargets) {
        if (entry.targets.length === 0) continue;
        for (const fid of entry.targets) {
          if (!fixtureTrackMap.has(fid)) fixtureTrackMap.set(fid, []);
          fixtureTrackMap.get(fid)!.push(entry);
        }
      }

      // Chaser takeover, computed ONCE per frame BEFORE the fixture loop so the
      // autoscript movement/color below can yield to it. A chaser track entry
      // freezes its fixtures: pan/tilt + color come from the chaser scene,
      // not from the autoscript animation (which otherwise keeps moving).
      let chaserCtlFrame = new Map<string, Record<number, number>>();
      try {
        if (chaserTracksRef?.current && chasersRef?.current && scenesRef?.current) {
          chaserCtlFrame = computeChaserTrackOverrides(
            chaserTracksRef.current,
            chasersRef.current,
            scenesRef.current,
            ct,
            patchedFixturesRef.current,
            fixtureGroupsRef?.current || [],
          );
          // chaserCtlFrame ready
        }
      } catch { chaserCtlFrame = new Map<string, Record<number, number>>(); }

      for(const[uniIdx,fixtures]of analysis.byUniverse.entries()){
        const uid=analysis.uniIds[uniIdx];if(!uid)continue;
        const chVals:Record<number,number>={};

        for(let fi=0;fi<fixtures.length;fi++){
          const fa=fixtures[fi];const pf=fa.fixture;

          // Skip disabled fixtures
          if (disabledFixturesRef?.current?.has(pf.id)) continue;

          let dimmerVal = (() => {
            // Fixture track override check (pre-computed targets)
            const ftEntries = fixtureTrackMap.get(pf.id);
            if (ftEntries) {
              for (const { ft } of ftEntries) {
                const activeBlock = ft.dimmerBlocks.find(b => ct >= b.time && ct < b.endTime);
                if (activeBlock) {
                  let val = activeBlock.value;
                  if (activeBlock.endValue !== undefined && activeBlock.endValue !== activeBlock.value) {
                    const dur = activeBlock.endTime - activeBlock.time;
                    const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                    val = Math.round(activeBlock.value + (activeBlock.endValue - activeBlock.value) * t);
                  }
                  return val;
                }
              }
            }
            return active.forcedDimmerVal !== undefined ? active.forcedDimmerVal : mapIntensity(active.intensity, effectiveEnergy, pf.tier, tierMultipliers);
          })();
          // Dimmer track override (highest priority for intensity)
          if (dimmerOverrides) {
            const dimmerOverride = dimmerOverrides.get(pf.id);
            if (dimmerOverride) {
              dimmerVal = Math.round(255 * dimmerOverride.value / 100);
            }
          }
          const _dimmerTrackActive = !!(dimmerOverrides && dimmerOverrides.get(pf.id));
          if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(_dimmerTrackActive){chVals[addr]=dimmerVal;}else if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;}
          // Dimmer track: propagate to ALL intensity channels (LED heads 2..N)
          if(_dimmerTrackActive){for(const li of (fa.ledIntensityOffsets||[])){chVals[pf.startAddress+li]=dimmerVal;}}

// Densite par section (activeTiers) : les fixtures hors tiers actifs
           // sont eteintes (dimmer 0 + shutter 0 + gates laser 0). Le show
           // respire entre intro (primary seul) et drop (toutes les couches).
           // Les fixtures de tier 'other' sont toujours considerees comme actives.
           let _fixtureInactive = false;
           if (Array.isArray(active.activeTiers) && !active.activeTiers.includes(pf.tier) && pf.tier !== 'other' && !_dimmerTrackActive) {
             _fixtureInactive = true;
             if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = 0;
             if (fa.shutterOffset !== null) chVals[pf.startAddress + fa.shutterOffset] = 0;
             if (fa.strobeOffset !== null) chVals[pf.startAddress + fa.strobeOffset] = 0;
             if (fa.isLaser) {
               if (fa.rgbOffsets) for (const o of fa.rgbOffsets) chVals[pf.startAddress + o] = 0;
               if (fa.laserColorGateOffset !== null) chVals[pf.startAddress + fa.laserColorGateOffset] = 0;
             }
           }

          let paletteColor = (() => {
            // Color track override (highest priority)
            if (colorTrackColors.has(pf.id)) {
              return colorTrackColors.get(pf.id)!;
            }
            // Fixture track override check (pre-computed targets)
            const ftEntries2 = fixtureTrackMap.get(pf.id);
            if (ftEntries2) {
              for (const { ft } of ftEntries2) {
                const activeBlock = ft.colorBlocks.find(b => ct >= b.time && ct < b.endTime);
                if (activeBlock) {
                  if (activeBlock.endColor && activeBlock.endColor !== activeBlock.color) {
                    const dur = activeBlock.endTime - activeBlock.time;
                    const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                    const sr = parseInt(activeBlock.color.slice(1,3),16);
                    const sg = parseInt(activeBlock.color.slice(3,5),16);
                    const sb = parseInt(activeBlock.color.slice(5,7),16);
                    const er = parseInt(activeBlock.endColor.slice(1,3),16);
                    const eg = parseInt(activeBlock.endColor.slice(3,5),16);
                    const eb = parseInt(activeBlock.endColor.slice(5,7),16);
                    const rr = Math.round(sr + (er - sr) * t);
                    const rg = Math.round(sg + (eg - sg) * t);
                    const rb = Math.round(sb + (eb - sb) * t);
                    return '#' + [rr, rg, rb].map(v => v.toString(16).padStart(2,'0')).join('');
                  }
                  return activeBlock.color;
                }
              }
            }
            // Use the exact cue color so fixtures match what the UI shows
            if (active.colors.length > 0) {
              return active.forcedColor || active.color || active.colors[0] || undefined;
            }
            return active.forcedColor || active.color || undefined;
          })();

          const isColorTrack = colorTrackColors.has(pf.id);
          // Chaser takeover (couleur) : si le chaser pilote les canaux couleur
          // de cette fixture, on n'écrit PAS la couleur autoscript (rouge du
          // chaser conservé, pas de fuite blanc). Le merge chaser plus bas
          // écrit les valeurs du chaser.
          const chaserMapForColor = chaserCtlFrame.get(pf.id);
          let chaserOwnsColor = false;
          if (chaserMapForColor) {
            const colorAddrs = new Set<number>();
            for (const seg of fa.rgbSegments) {
              colorAddrs.add(pf.startAddress + seg.r);
              colorAddrs.add(pf.startAddress + seg.g);
              if (seg.b !== null) colorAddrs.add(pf.startAddress + seg.b);
              if (seg.w !== null) colorAddrs.add(pf.startAddress + seg.w);
            }
            if (fa.wheelOffset !== null) colorAddrs.add(pf.startAddress + fa.wheelOffset);
            for (const addrStr in chaserMapForColor) {
              if (colorAddrs.has(Number(addrStr))) { chaserOwnsColor = true; break; }
            }
          }
          if(fa.rgbSegments.length>0&&paletteColor&&!chaserOwnsColor){
            let[r,g,b]=hexToRgb(paletteColor);
            // Only apply tier hue shift to cue colors, NOT to user-specified color track colors
            if (!isColorTrack) {
              [r,g,b] = applyHueShift([r,g,b], TIER_HUE[pf.tier]);
              // Dynamic palette by energy: modulate saturation based on intensity
              const grayVal = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
              if (effectiveEnergy < 0.3) {
                // Low energy: desaturate toward gray
                const desat = 1 - effectiveEnergy * 3;
                r = Math.round(r + (grayVal - r) * desat);
                g = Math.round(g + (grayVal - g) * desat);
                b = Math.round(b + (grayVal - b) * desat);
                // Cool shift on intros/outros
                if (!isDrop && !isChorus) {
                  r = Math.round(r * (1 - (0.3 - effectiveEnergy) * 0.8));
                  b = Math.min(255, Math.round(b * (1 + (0.3 - effectiveEnergy) * 0.5)));
                }
              } else if (effectiveEnergy > 0.6) {
                // High energy: boost saturation (push away from gray)
                const boost = (effectiveEnergy - 0.6) * 0.4;
                r = Math.min(255, Math.round(r + (r - grayVal) * boost * 2.5));
                g = Math.min(255, Math.round(g + (g - grayVal) * boost * 2.5));
                b = Math.min(255, Math.round(b + (b - grayVal) * boost * 2.5));
              }
            }
            for(const po of fa.presetOverrideOffsets){chVals[pf.startAddress+po]=0;}
            if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(_dimmerTrackActive){chVals[addr]=dimmerVal;}else if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;}
            // Per-pixel RGB: barre LED / wall wash multi-segments → chase color + wave
            // Tous les canaux RGB de la fixture sont exploités (8×3=24 pour Wall Washer)
            {
              const segCount = fa.rgbSegments.length;
              const isMultiPixel = segCount > 1;
              for(let sIdx=0; sIdx<segCount; sIdx++){
                const seg = fa.rgbSegments[sIdx];
                let pr=r,pg=g,pb=b;
                if(isMultiPixel && !isColorTrack){
                  // Chase: décalage de teinte par pixel + propagation temporelle (beat)
                  const hueStep = 360/segCount;
                  const timeHue = (ct * 45 * (active.movementSpeed ?? 1)) % 360;
                  const segHue = (sIdx * hueStep * 0.6 + timeHue) % 360; // 0.6 = moins que full rainbow, garde cohérence palette
                  [pr,pg,pb] = applyHueShift([r,g,b], segHue * 0.35); // 35% du cercle = variation visible sans perdre teinte de section
                  // Wave d'intensité par pixel (exploite les 24 canaux avec niveaux distincts)
                  const wave = 0.75 + 0.25 * Math.sin((ct*2*Math.PI*0.8) + sIdx * (Math.PI*2/segCount));
                  pr = Math.round(pr * wave); pg = Math.round(pg * wave); pb = Math.round(pb * wave);
                }
                const key=pf.id+'_'+seg.r;let cur=fadeState.get(key);if(!cur){cur={r:pr,g:pg,b:pb};fadeState.set(key,cur);}else{cur.r=Math.round(cur.r+(pr-cur.r)*FADE_ALPHA);cur.g=Math.round(cur.g+(pg-cur.g)*FADE_ALPHA);cur.b=Math.round(cur.b+(pb-cur.b)*FADE_ALPHA);}chVals[pf.startAddress+seg.r]=cur.r;chVals[pf.startAddress+seg.g]=cur.g;if(seg.b!==null)chVals[pf.startAddress+seg.b]=cur.b;if(seg.w!==null)chVals[pf.startAddress+seg.w]=0;
                if(seg.a!==null) chVals[pf.startAddress+seg.a]=0;
                if(seg.uv!==null) chVals[pf.startAddress+seg.uv]=0;
              }
            }
            // Apply dimmer track/cue dimmer to RGB when no dedicated intensity channel
            if(fa.intensityOffset===null){const dScale=dimmerVal/255;for(const seg of fa.rgbSegments){chVals[pf.startAddress+seg.r]=Math.round((chVals[pf.startAddress+seg.r]??0)*dScale);chVals[pf.startAddress+seg.g]=Math.round((chVals[pf.startAddress+seg.g]??0)*dScale);if(seg.b!==null)chVals[pf.startAddress+seg.b]=Math.round((chVals[pf.startAddress+seg.b]??0)*dScale);if(seg.w!==null)chVals[pf.startAddress+seg.w]=Math.round((chVals[pf.startAddress+seg.w]??0)*dScale);}}
            // Exploit remaining generic channels (Effect / Speed / Beam / Zoom / Frost ...) pour exploitation maximale
            // Wall Washer / LED Bar : Effect (macros Point-to-Point) et Speed doivent bouger, pas rester à 0
            if(!fa.isLaser){
              if(fa.effectOffset!==null){
                const caps = fa.effectCaps;
                if(caps.length>0){
                  // Basse énergie → No function (0), haute énergie → cycle macros
                  let effVal:number;
                  if(effectiveEnergy < 0.3){
                    const off = caps.find(c=>c.min===0) || caps[0];
                    effVal = capMid(off);
                  } else {
                    const idx = Math.floor((ct*0.7) % caps.length);
                    effVal = capMid(caps[idx]);
                  }
                  chVals[pf.startAddress+fa.effectOffset]=effVal;
                } else {
                  chVals[pf.startAddress+fa.effectOffset]=0;
                }
              }
              if(fa.speedOffset!==null){
                chVals[pf.startAddress+fa.speedOffset]= Math.max(0, Math.min(255, Math.round(50 + effectiveEnergy*150 + Math.sin(ct*3)*10)));
              }
              if(fa.beamOffset!==null){
                // Beam générique : exploité comme zoom/focus léger si pas déjà géré par les FX dédiés
                if(chVals[pf.startAddress+fa.beamOffset]===undefined) chVals[pf.startAddress+fa.beamOffset]= Math.round(100 + effectiveEnergy*80);
              }
            }

          }else if(fa.wheelOffset!==null){
            const caps=fa.wheelCaps;
            if(paletteColor){
              let wheelVal:number;
              if(caps.length>0){const bestCap=findBestWheelCap(caps,paletteColor);wheelVal=bestCap?Math.round((bestCap.min+bestCap.max)/2):(()=>{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;const capIdx=Math.floor(wPos*caps.length)%caps.length;return Math.round((caps[capIdx].min+caps[capIdx].max)/2);})();}
              else{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;wheelVal=Math.round(wPos*255);}
              chVals[pf.startAddress+fa.wheelOffset]=wheelVal;
            } else if (caps.length > 0) {
              // Pas de couleur dans la cue : ramener la roue à la position
              // « open / white » pour ne pas rester bloqué sur une couleur
              // résiduelle (ex. jaune) laissée par une frame précédente.
              const openCap = findBestWheelCap(caps, '#ffffff');
              const idx = openCap
                ? caps.indexOf(openCap)
                : 0;
              chVals[pf.startAddress+fa.wheelOffset] = capMid(caps[idx]);
            }
          }

          // Strobe decision (partagée shutter + canal strobe dédié) — strobe track prioritaire même avec dimmer track
          const strobeTrackOverride = strobeOverrides ? (strobeOverrides.get(pf.id) || null) : null;
          const trackStrobe = (() => {
              const ftEntries3 = fixtureTrackMap.get(pf.id);
              if (ftEntries3) {
                for (const { ft } of ftEntries3) {
                  const activeBlock = ft.strobeBlocks.find(b => ct >= b.time && ct < b.endTime);
                  if (activeBlock) {
                    let speed = activeBlock.speed;
                    if (activeBlock.endSpeed && activeBlock.endSpeed !== activeBlock.speed) {
                      const dur = activeBlock.endTime - activeBlock.time;
                      const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                      speed = activeBlock.speed + (activeBlock.endSpeed - activeBlock.speed) * t;
                    }
                    return { active: true, speed };
                  }
                }
              }
              return null;
            })();
          const useStrobe = strobeTrackOverride
            ? strobeTrackOverride.active
            : trackStrobe
            ? trackStrobe.active
            : _dimmerTrackActive
            ? false
            : forcedStrobe !== undefined ? forcedStrobe : ((isDrop || isChorus || sec === 'build') && active.strobe && pf.tier === 'primary');
          const strobeSpeed = Math.min(strobeTrackOverride?.speed || trackStrobe?.speed || active.strobeSpeed || 10, strobeLimit);

          // Shutter
          if(fa.shutterOffset!==null){const sAddr=pf.startAddress+fa.shutterOffset;
            if (useStrobe) {
              // Adaptive strobe speed: section-dependent multiplier
              const sectionMult = isDrop ? 1.5 : isChorus ? 1.2 : sec === 'build' ? 1.3 : sec === 'bridge' ? 1.0 : sec === 'verse' ? 0.8 : 0.5;
              const adaptedSpeed = Math.min(strobeSpeed * sectionMult, strobeLimit);
              // Strobe track override: oscillate shutter between open/closed at the track speed
              if (strobeTrackOverride) {
                const strobePhase = Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                chVals[sAddr] = strobePhase >= 0 ? 255 : 0;
              }
              // Soft strobe: pulse dimmer + hold shutter open when fixture has separate intensity
              else if (fa.intensityOffset !== null && !trackStrobe) {
                const pulse = 0.5 + 0.5 * Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                const iAddr = pf.startAddress + fa.intensityOffset;
                if (!chVals[iAddr] || Math.round(dimmerVal * pulse) > chVals[iAddr]) chVals[iAddr] = Math.round(dimmerVal * pulse);
                chVals[sAddr] = 255; // shutter stays open
              } else {
                // For cue-based strobe without track, oscillate manually for visibility
                const strobePhase = Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                chVals[sAddr] = strobePhase >= 0 ? 255 : 0;
              }
            }
            else if(fa.intensityOffset===null){chVals[sAddr]=Math.max(8,Math.min(255,8+Math.round((dimmerVal/255)*247)));}
            else{chVals[sAddr]=255;}}
          // Canal Strobe dédié : off (0) = pas de strobe, sinon valeur de strobe
          // constante (le canal génère le clignotement lui-même — pas
          // d'oscillation 255/0 qui produirait un double effet). Jamais 255.
          if(fa.strobeOffset!==null){
            const stAddr=pf.startAddress+fa.strobeOffset;
            chVals[stAddr]=useStrobe
              ? Math.min(250,Math.max(8,Math.round(8+strobeSpeed*20)))
              : 0;
          }
          // No dedicated shutter channel: simulate strobe by oscillating dimmer/intensity
          if(fa.shutterOffset===null&&fa.strobeOffset===null){
            const strobeTrackOverride = strobeOverrides ? (strobeOverrides.get(pf.id) || null) : null;
            const trackStrobeNoShutter = (() => {
              const ftEntriesNS = fixtureTrackMap.get(pf.id);
              if (ftEntriesNS) {
                for (const { ft } of ftEntriesNS) {
                  const activeBlockNS = ft.strobeBlocks.find(b => ct >= b.time && ct < b.endTime);
                  if (activeBlockNS) return { active: true, speed: activeBlockNS.speed || 10 };
                }
              }
              return null;
            })();
            const useStrobeNoShutter = strobeTrackOverride
              ? strobeTrackOverride.active
              : trackStrobeNoShutter
              ? trackStrobeNoShutter.active
              : _dimmerTrackActive
              ? false
              : forcedStrobe !== undefined ? forcedStrobe : ((isDrop || isChorus) && active.strobe && pf.tier === 'primary');
            if (useStrobeNoShutter && fa.intensityOffset !== null) {
              const baseSpeedNS = Math.min(strobeTrackOverride?.speed || trackStrobeNoShutter?.speed || active.strobeSpeed || 10, strobeLimit);
              const sectionMultNS = isDrop ? 1.5 : isChorus ? 1.2 : sec === 'build' ? 1.3 : sec === 'bridge' ? 1.0 : sec === 'verse' ? 0.8 : 0.5;
              const adaptedSpeedNS = Math.min(baseSpeedNS * sectionMultNS, strobeLimit);
              const strobePhaseNS = Math.sin(ct * Math.PI * 2 * adaptedSpeedNS);
              const iAddrNS = pf.startAddress + fa.intensityOffset;
              chVals[iAddrNS] = strobePhaseNS >= 0 ? dimmerVal : 0;
            }
          }

          // PAN/TILT — check EFX override first, then chaser freeze, fall back to auto pattern
          const panCount=fa.panOffsets.length;const tiltCount=fa.tiltOffsets.length;const motorCount=Math.max(panCount,tiltCount,1);
          // Chaser takeover (mouvement) : si le chaser pilote le pan/tilt de
          // cette fixture, on fige sur ses valeurs (focus fixe, pas d'autoscript).
          // Le merge chaser plus bas réécrira ces mêmes valeurs.
          const chaserMapForMove = chaserCtlFrame.get(pf.id);
          const chaserOwnsFixture = !!chaserMapForMove;
          let chaserMoveVals: { pan?: number; tilt?: number } | null = null;
          if (chaserMapForMove) {
            const panAddrs = new Set(fa.panOffsets.map(o => pf.startAddress + o));
            const tiltAddrs = new Set(fa.tiltOffsets.map(o => pf.startAddress + o));
            let cp: number | undefined; let ct2: number | undefined;
            for (const addrStr in chaserMapForMove) {
              const a = Number(addrStr);
              if (cp === undefined && panAddrs.has(a)) cp = chaserMapForMove[addrStr];
              if (ct2 === undefined && tiltAddrs.has(a)) ct2 = chaserMapForMove[addrStr];
            }
            if (cp !== undefined || ct2 !== undefined) {
              chaserMoveVals = { pan: cp, tilt: ct2 };
            }
          }
          if(panCount>0||tiltCount>0){
            if (chaserOwnsFixture) {
              // Freeze total : la fixture est sous contrôle chaser.
              // Si la scène définit pan/tilt, on les utilise ; sinon on maintient
              // la dernière position connue (jamais le centre par défaut).
              const held = chaserHoldRef.current.get(pf.id);
              const pan = chaserMoveVals?.pan ?? held?.pan;
              const tilt = chaserMoveVals?.tilt ?? held?.tilt;
              if (pan !== undefined) {
                for(let m=0;m<motorCount;m++){
                  if(m<panCount) chVals[pf.startAddress+fa.panOffsets[m]]=pan;
                }
              }
              if (tilt !== undefined) {
                for(let m=0;m<motorCount;m++){
                  if(m<tiltCount) chVals[pf.startAddress+fa.tiltOffsets[m]]=tilt;
                }
              }
              chaserHoldRef.current.set(pf.id, {
                pan: pan ?? chaserHoldRef.current.get(pf.id)?.pan ?? 128,
                tilt: tilt ?? chaserHoldRef.current.get(pf.id)?.tilt ?? 128,
              });
            } else {
            let efxPan=NaN,efxTilt=NaN;
            if(panCount>0){const pa=pf.startAddress+fa.panOffsets[0];if(efxMap[pa]!==undefined)efxPan=efxMap[pa];}
            if(tiltCount>0){const ta=pf.startAddress+fa.tiltOffsets[0];if(efxMap[ta]!==undefined)efxTilt=efxMap[ta];}
            if(!isNaN(efxPan)||!isNaN(efxTilt)){
              for(let m=0;m<motorCount;m++){if(m<panCount)chVals[pf.startAddress+fa.panOffsets[m]]=isNaN(efxPan)?128:efxPan;if(m<tiltCount)chVals[pf.startAddress+fa.tiltOffsets[m]]=isNaN(efxTilt)?128:efxTilt;}
            }else if(efxPtOverrides?.has(pf.id)){
              // EFX track pan/tilt override (from saved effects on timeline)
              const ept = efxPtOverrides.get(pf.id)!;
              for(let m=0;m<motorCount;m++){if(m<panCount)chVals[pf.startAddress+fa.panOffsets[m]]=ept.pan;if(m<tiltCount)chVals[pf.startAddress+fa.tiltOffsets[m]]=ept.tilt;}
            }else{
              const trackMovement = (() => {
                const ftEntries4 = fixtureTrackMap.get(pf.id);
                if (ftEntries4) {
                  for (const { ft } of ftEntries4) {
                    const activeBlock = ft.movementBlocks.find(b => ct >= b.time && ct < b.endTime);
                    if (activeBlock) return activeBlock;
                  }
                }
                return null;
              })();
              // Amplitude par tier : la cue fixe le nominal (primary = plein),
              // les tiers suivent a 72 %/42 % -> couches visuelles distinctes.
              const tierAmpMult = pf.tier === 'primary' ? 1 : pf.tier === 'secondary' ? 0.72 : 0.42;
              const amplitude = trackMovement
                ? trackMovement.amplitude
                : active.movementAmplitude !== undefined
                  ? Math.max(4, Math.min(128, Math.round(active.movementAmplitude * tierAmpMult)))
                  : pf.tier === 'primary' ? 90 : pf.tier === 'secondary' ? 70 : 40;
                const movPattern = (() => {
                  if (trackMovement) return trackMovement.pattern;
                  // Section name → getSmartMovement distributes per-fixture (multi-fixture choreography)
                  // Explicit pattern names pass through directly
                  const cueMov = active.movement;
                  if (cueMov) {
                    const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
                    if (!explicitPatterns.has(cueMov)) {
                      // Section name → smart distribution
                      let mobileIdx = -1, totalMobile = 0;
                      for (const ffa of fixtures) {
                        if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                          if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
                          totalMobile++;
                        }
                      }
                      if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, cueMov, ct);
                      return cueMov;
                    }
                    // Explicit pattern — distribue pour les tiers non-primaires pour éviter le mur uni
                    if (pf.tier !== 'primary') {
                      let mobileIdx = -1, totalMobile = 0;
                      for (const ffa of fixtures) {
                        if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                          if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
                          totalMobile++;
                        }
                      }
                      if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, cueMov, ct);
                    }
                    return cueMov; // explicit pattern
                  }
                  // Fallback: smart distribution based on section
                  let mobileIdx = -1, totalMobile = 0;
                  for (const ffa of fixtures) {
                    if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                      if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
                      totalMobile++;
                    }
                  }
                  if (mobileIdx >= 0) {
                    return getSmartMovement(mobileIdx, totalMobile, sec, ct);
                  }
                  return sec;
                })();
              // Spatial choreography: per-fixture phase offset from real stage position
              const spatialPattern = (active as any).spatialPattern;
              let mobileIdx = -1, totalMobile = 0;
              if (spatialPattern && !trackMovement) {
                for (const ffa of fixtures) {
                  if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                    if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
                    totalMobile++;
                  }
                }
              }
              if(amplitude>0){for(let m=0;m<motorCount;m++){const motorPhase=m*(Math.PI*2/motorCount);const speedMult=Math.max(0.1,Math.min(2.5,active.movementSpeed??1));
                // Crossfade movement params: blend toward next cue (clamped)
                const curAmp = amplitude; const curSpd = speedMult;
                const nextSpdClamped = Math.max(0.1,Math.min(2.5,(nextCue as any)?.movementSpeed ?? curSpd));
                const blendAmp = (crossfadeT>0&&nextCue&&!trackMovement)
                  ? Math.round(curAmp*(1-crossfadeT) + (nextCue.movementAmplitude!==undefined?Math.max(4,Math.min(128,Math.round(nextCue.movementAmplitude*tierAmpMult))):curAmp)*crossfadeT)
                  : curAmp;
                const blendSpd = trackMovement
                  ? Math.max(0.1,Math.min(2.5,trackMovement.speed ?? curSpd))
                  : (crossfadeT>0&&nextCue
                  ? Math.max(0.1,Math.min(2.5,curSpd*(1-crossfadeT) + nextSpdClamped*crossfadeT))
                  : curSpd);
                const phase=(ct*Math.PI*2*blendSpd)+motorPhase+(trackMovement?0:movementPhase)+(spatialPattern&&!trackMovement?spatialPhaseFor(fixturePositions?.[pf.id],spatialPattern,mobileIdx):0);
                const [px, py] = evalEffect(movPattern as EffectPattern, phase, 0);
                const pfl = panTiltLimits.perFixture?.[pf.id];
                // Fixture-track movement blocks are user-authored (higher priority than autoscript): do not clamp them.
                const panLimit = trackMovement ? 128 : (pfl?.pan ?? panTiltLimits.pan);
                const tiltLimit = trackMovement ? 128 : (pfl?.tilt ?? panTiltLimits.tilt);
                if(m<panCount){
                  const raw = Math.max(0,Math.min(255,Math.round(128+px*blendAmp)));
                  const fp = fixturePositions?.[pf.id];
                  let pv = fp ? clampPanToStage(raw, fp.x) : raw;
                  pv = Math.max(128 - panLimit, Math.min(128 + panLimit, pv));
                  chVals[pf.startAddress+fa.panOffsets[m]] = pv;
                  if (m === 0) chaserHoldRef.current.set(pf.id, { ...(chaserHoldRef.current.get(pf.id) ?? { pan: pv, tilt: 128 }), pan: pv });
                }
                if(m<tiltCount){
                  const raw = Math.max(0,Math.min(255,Math.round(128+py*blendAmp)));
                  const fp = fixturePositions?.[pf.id];
                  let tv = fp ? clampTiltToStage(raw, fp.y) : raw;
                  tv = Math.max(128 - tiltLimit, Math.min(128 + tiltLimit, tv));
                  chVals[pf.startAddress+fa.tiltOffsets[m]] = tv;
                  if (m === 0) chaserHoldRef.current.set(pf.id, { ...(chaserHoldRef.current.get(pf.id) ?? { pan: 128, tilt: tv }), tilt: tv });
                }}
              }else{for(const po of fa.panOffsets)chVals[pf.startAddress+po]=128;for(const to of fa.tiltOffsets)chVals[pf.startAddress+to]=128;}
            } // fin else autoscript (chaser freeze ci-dessus)
            }
          }

          // GOBO / PRISM / ZOOM / FROST / IRIS / FOCUS — audio-reactive
          const fxEnergy = (active.energy ?? 0.5);
          const fxPhase = ct * Math.PI * 2 * (active.movementSpeed ?? 1);
          // FX (gobo/zoom/frost) modulés par section : profil optique propre à
          // chaque type (zoom serré en drop, frost diffus en bridge, gobo rapide
          // en drop/chorus, lent en intro/outro).
const _FXPROF: Record<string, [number, number, number, number]> = {
            intro: [0.4, 0.55, 0.75, 0.6], verse: [0.7, 0.5, 0.8, 0.3],
            chorus: [1.3, 0.35, 0.9, 0.1], bridge: [0.5, 0.6, 0.8, 0.7],
            drop: [2, 0.15, 0.7, 0], build: [1.6, 0.25, 0.85, 0.15],
            outro: [0.3, 0.6, 0.8, 0.5],
          };
          const _fxSec = ((active as any)?.section as string) || '';
          const _fxP = _FXPROF[_fxSec] || [1, 0.4, 0.85, 0.2];
          const fxPhase2 = fxPhase * _fxP[0];

          if(fa.goboOffset!==null){const gAddr=pf.startAddress+fa.goboOffset;
            if(fa.goboCaps.length>0){
              const gc=Math.max(1,fa.goboCaps.length);
              const gi=Math.floor((fxPhase2*0.5)%gc);
              chVals[gAddr]=Math.round((fa.goboCaps[gi].min+fa.goboCaps[gi].max)/2);
            }else{
              chVals[gAddr]=Math.round(fxEnergy*255);
            }
          }
          if(fa.prismOffset!==null){const pAddr=pf.startAddress+fa.prismOffset;
            chVals[pAddr]=Math.round(Math.max(0,Math.min(255,64+Math.sin(fxPhase2*0.7)*128*fxEnergy)));
          }
          if(fa.zoomOffset!==null){const zAddr=pf.startAddress+fa.zoomOffset;
            chVals[zAddr]=Math.round(Math.max(0,Math.min(255,64+Math.sin(fxPhase2*0.4)*96*(_fxP[1]+(_fxP[2]-_fxP[1])*fxEnergy)+64*fxEnergy)));
          }
          if(fa.frostOffset!==null){const fAddr=pf.startAddress+fa.frostOffset;
            chVals[fAddr]=Math.round(Math.max(0,Math.min(255,(255-fxEnergy*255)*(1-_fxP[3])+_fxP[3]*200)));
          }
          if(fa.irisOffset!==null){const iAddr=pf.startAddress+fa.irisOffset;
            chVals[iAddr]=Math.round(40+fxEnergy*200+Math.sin(fxPhase2*0.5)*15*fxEnergy);
          }
          if(fa.focusOffset!==null){const fcAddr=pf.startAddress+fa.focusOffset;
            chVals[fcAddr]=Math.round(80+fxEnergy*120+Math.sin(fxPhase2*0.3)*30);
          }

          // ─── Laser : bloc live du tick (même logique que computeDmxForCue) ───
          // Le tick principal ne calculait AUCUN canal laser (mode/pattern/scan/
          // rotations/vitesses/blank) : en lecture QuickShow/AutoScript, le mode
          // restait sur « Laser off » — d'où « ça ne fait rien, ou une apparition
          // brève au crossfade » (le bloc n'existait que dans computeDmxForCue,
          // appelé uniquement lors des fondus < 0,3 s). Appliqué à chaque frame.
          if (fa.isLaser) {
            if (_fixtureInactive) {
              // Fixture hors tiers actifs : éteindre TOUS les canaux laser
              // (mode, pattern, scan, rotation, blanking, gates couleur) pour
              // que le laser ne reste pas allumé en intro/outro/bridge.
              if (fa.laserModeOffset !== null) chVals[pf.startAddress + fa.laserModeOffset] = 0;
              if (fa.patternOffset !== null) chVals[pf.startAddress + fa.patternOffset] = 0;
              if (fa.scanXOffset !== null) chVals[pf.startAddress + fa.scanXOffset] = 0;
              if (fa.scanYOffset !== null) chVals[pf.startAddress + fa.scanYOffset] = 0;
              if (fa.laserSpeedScanOffset !== null) chVals[pf.startAddress + fa.laserSpeedScanOffset] = 0;
              if (fa.laserSpeedPatternOffset !== null) chVals[pf.startAddress + fa.laserSpeedPatternOffset] = 0;
              for (const off of fa.laserRotationOffsets) chVals[pf.startAddress + off] = 0;
              if (fa.blankOffset !== null) chVals[pf.startAddress + fa.blankOffset] = 0;
              if (fa.laserColorGateOffset !== null) chVals[pf.startAddress + fa.laserColorGateOffset] = 0;
              if (fa.rgbOffsets) for (const o of fa.rgbOffsets) chVals[pf.startAddress + o] = 0;
            } else {
              computeLaserChannels(fa, pf, chVals, ct, effectiveEnergy, paletteColor);
            }
          }
        }

        // Chaser track: merge chaser-driven channels
        if (chaserTracksRef?.current && chasersRef?.current && scenesRef?.current) {
          try {
            const chaserCtl = computeChaserTrackOverrides(
              chaserTracksRef.current,
              chasersRef.current,
              scenesRef.current,
              ct,
              patchedFixturesRef.current,
              fixtureGroupsRef?.current || [],
            );
            if (chaserCtl.size > 0) {
              for (const fa of fixtures) {
                const pfx = fa.fixture;
                const cmap = chaserCtl.get(pfx.id);
                if (!cmap) continue;
                // Merge chaser: only overwrite channels the chaser actually drives, keep dimmer/track elsewhere
                for (const addrStr in cmap) {
                  const v = cmap[addrStr];
                  const addr = Number(addrStr);
                  if (addr >= pfx.startAddress && addr < pfx.startAddress + pfx.channelCount) chVals[addr] = v;
                }
              }
            }
          } catch (e) {
            console.error('[chaserTrack] takeover error:', e);
          }
        }

        // Show track: show complet qui prend le dessus sur l'autoscript (priorité la plus haute)
        if (showTracksRef?.current && showsRef?.current && scenesRef?.current) {
          try {
            const showCtl = computeShowTrackOverrides(
              showTracksRef.current as any,
              showsRef.current as any,
              scenesRef.current as any,
              chasersRef?.current as any || [],
              ct,
              patchedFixturesRef.current,
              fixtureGroupsRef?.current || [],
            );
            if (showCtl.size > 0) {
              for (const fa of fixtures) {
                const pfx = fa.fixture;
                const cmap = showCtl.get(pfx.id);
                if (!cmap) continue;
                for (const addrStr in cmap) {
                  const v = cmap[addrStr];
                  const addr = Number(addrStr);
                  if (addr >= pfx.startAddress && addr < pfx.startAddress + pfx.channelCount) chVals[addr] = v;
                }
              }
            }
          } catch (e) {
            console.error('[showTrack] takeover error:', e);
          }
        }

        // Crossfade blend — skip si EFX track actif (sinon l'EFX stutter à chaque cue)
        if(crossfadeT>0&&nextCueDmx && !(efxPtOverrides && efxPtOverrides.size>0)){
          const nextUni=nextCueDmx.find(n=>n.universe===uniIdx);
          if(nextUni){
            const nextCh=nextUni.channelValues;
            const existing=new Set(Object.keys(chVals));
            for(const chStr of Object.keys(nextCh)){
              const ch=Number(chStr);
              chVals[ch]=existing.has(chStr)
                ?Math.round(chVals[ch]*(1-crossfadeT)+nextCh[ch]*crossfadeT)
                :Math.round(nextCh[ch]*crossfadeT);
            }
          }
        }

        // Apply master fade factor for end fade-out
        if (fadeFactor < 1.0) {
          for (const chStr in chVals) {
            chVals[Number(chStr)] = Math.round(chVals[Number(chStr)] * fadeFactor);
          }
        }

        {
          let hasVals=false;
          for(const _ in chVals){hasVals=true;break;}
          if(hasVals){
          // Numeric hash instead of string concatenation (P1.3 perf)
          let sig=uniIdx;
          for(const chStr in chVals){sig=(sig*31+Number(chStr)*17+chVals[chStr])|0;}
          if(sig!==lastSig){lastSig=sig;
            // Store update throttled 30fps, but always push to 3D mirror at 60fps via onVirtualDmx
            const now=performance.now();
            const doStore = now-lastStoreUpdate>33;
            if(doStore){
              useAppStore.getState().setUniverseData(uniIdx, chVals);
              lastStoreUpdate=now;
            }
            // Arbitrated bridge — computes final buffer and flushes to hardware
            dmxBridge.push(uniIdx, chVals, arbSource);
            if (onVirtualDmx) onVirtualDmx(uniIdx, doStore ? chVals : {...chVals});
            // Save for pause fade-out
            lastChannelsRef.current.set(uniIdx, {...chVals});
          }
          }
        }
      }
      rafRef.current=requestAnimationFrame(tick);
    };

    rafRef.current=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(rafRef.current);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isPlaying]);
}

// ═══════════════════════════════════════════════════════════
// Standalone DMX computation (for VC AudioAutoScript, etc.)
// ═══════════════════════════════════════════════════════════

/**
 * Bloc laser partagé (tick de lecture live ET computeDmxForCue) : écrit mode
 * DMX stable, pattern cyclé, scan X/Y (cercle/Lissajous), roue ou gates R/G
 * (binaire 0/255, jamais fermé/stroboscope), vitesses et rotations oscillantes,
 * blanking ouvert. Sans ce bloc, le canal mode d'un laser reste sur « Laser
 * off » → « ça ne fait rien » en lecture.
 */
export function computeLaserChannels(
  fa: FixtureChannelAnalysis,
  pf: PatchedFixture,
  chVals: Record<number, number>,
  laserT: number,
  energy: number,
  paletteColor: string | undefined,
  options?: { blankWhenStrobe?: boolean },
): void {
  const laserPhase = ((pf.startAddress % 16) / 16) * 2 * Math.PI;
  const lissajous = pf.startAddress % 3 === 2;
  const laserRadius = 60 + Math.round(energy * 40); // 60..100 selon l'énergie

  // Mode : toujours un mode pilotable en DMX (jamais sound/off).
  if (fa.laserModeOffset !== null) {
    chVals[pf.startAddress + fa.laserModeOffset] = capMid(pickLaserModeCap(fa.laserModeCaps));
  }
  // Pattern : cycle un motif toutes les ~2 s.
  if (fa.patternOffset !== null && fa.patternCaps.length > 0) {
    const idx = Math.floor(laserT / 2) % fa.patternCaps.length;
    chVals[pf.startAddress + fa.patternOffset] = capMid(fa.patternCaps[idx]);
  }
  // Scan X/Y : cercle (phase par fixture) ou Lissajous (1 laser sur 3).
  if (fa.scanXOffset !== null) {
    chVals[pf.startAddress + fa.scanXOffset] = Math.round(128 + laserRadius * Math.sin(2 * Math.PI * laserT + laserPhase));
  }
  if (fa.scanYOffset !== null) {
    const yv = lissajous
      ? Math.sin(4 * Math.PI * laserT + laserPhase)
      : Math.cos(2 * Math.PI * laserT + laserPhase);
    chVals[pf.startAddress + fa.scanYOffset] = Math.round(128 + laserRadius * yv);
  }
  // Roue couleur : cycle seulement si aucune couleur de palette écrite.
  if (fa.laserColorMode === 'wheel' && fa.wheelOffset !== null && fa.wheelCaps.length > 0
      && chVals[pf.startAddress + fa.wheelOffset] === undefined) {
    const idx = Math.floor(laserT / 2) % fa.wheelCaps.length;
    chVals[pf.startAddress + fa.wheelOffset] = capMid(fa.wheelCaps[idx]);
  }
  // Couleur 2 canaux (R+G / R+B / G+B, ex. Galaxian 3D) : écrire les
  // canaux existants si aucune couleur de palette n'a été écrite. Ce
  // sont des GATES (Red/Green Laser typés Shutter) : binaire 0/255,
  // jamais de zone fermée (0-31) ni stroboscope (milieu).
  if (fa.rgbOffsets && fa.rgbSegments.length === 0 && chVals[pf.startAddress + fa.rgbOffsets[0]] === undefined) {
    const [rr0, gg0, bb0] = paletteColor ? hexToRgb(paletteColor) : [Math.round(255 * energy), Math.round(255 * energy), 0];
    let rr = laserGateValue(rr0), gg = laserGateValue(gg0), bb = laserGateValue(bb0);
    // Palette non représentable (bleue/violette/cyan sur un laser R/G) :
    // ouvrir R+G plutôt que d'éteindre le laser (« ça ne fait rien »).
    const pairClosed =
      (fa.rgbOffsets[0] !== undefined ? rr === 0 : true) &&
      (fa.rgbOffsets[1] !== undefined ? gg === 0 : true) &&
      (fa.rgbOffsets[2] !== undefined ? bb === 0 : true);
    if (pairClosed && (rr0 > 22 || gg0 > 22 || bb0 > 22)) {
      rr = 255;
      gg = 255;
    }
    if (fa.rgbOffsets[0] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[0]] = rr;
    if (fa.rgbOffsets[1] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[1]] = gg;
    if (fa.rgbOffsets[2] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[2]] = bb;
  }
  // Gate couleur mono-canal (caps « Red laser / Green laser / … », ex.
  // Showtec Dominator) : ouvrir sur la couleur de la palette, sinon première
  // couleur non-blackout. Le bloc n'est appelé que si le laser est ouvert.
  if (fa.laserColorMode === 'gate' && fa.laserColorGateOffset !== null && chVals[pf.startAddress + fa.laserColorGateOffset] === undefined) {
    const colorCaps = fa.laserColorGateCaps.filter((c) =>
      /(red|green|blue|amber|cyan|magenta|yellow|white)/i.test(c.name ?? '') && !/blackout|off|closed|none/i.test(c.name ?? ''),
    );
    let target: DmxFixtureCapability | undefined;
    if (paletteColor) {
      const [rr, gg, bb] = hexToRgb(paletteColor);
      target = colorCaps.find((c) => (rr > 122 && /red/i.test(c.name!)) || (gg > 122 && /green/i.test(c.name!)) || (bb > 122 && /blue/i.test(c.name!))) ?? colorCaps[0];
    } else {
      target = colorCaps[0];
    }
    if (target) chVals[pf.startAddress + fa.laserColorGateOffset] = capMid(target);
  }
  // Vitesses + rotations : oscillent, déphasées par fixture. La vitesse de
  // scan reste bornée à 0-127 (au-delà, l'OFL IODA passe en « With gaps »).
  if (fa.laserSpeedScanOffset !== null) {
    chVals[pf.startAddress + fa.laserSpeedScanOffset] = Math.min(127, Math.round(128 + 60 * Math.sin(2 * Math.PI * laserT + laserPhase)));
  }
  if (fa.laserSpeedPatternOffset !== null) {
    chVals[pf.startAddress + fa.laserSpeedPatternOffset] = Math.round(128 + 64 * Math.sin(2 * Math.PI * laserT / 4));
  }
  fa.laserRotationOffsets.forEach((off, i) => {
    chVals[pf.startAddress + off] = Math.round(128 + 65 * Math.sin(2 * Math.PI * laserT / (4 * (i + 1)) + laserPhase));
  });
  // Blanking : ouvert sauf gate strobe en drop/chorus.
  if (fa.blankOffset !== null) {
    chVals[pf.startAddress + fa.blankOffset] = options?.blankWhenStrobe ? 255 : 0;
  }
}

export function computeDmxForCue(
  cue: CuePlayback & { energy?: number },
  patchedFixtures: PatchedFixture[],
  fixtureDefs: Map<string, DmxFixtureDefinition>,
  universes: { id: string }[],
  tierMultipliers?: { primary: number; secondary: number; tertiary: number },
  fixtureTrackOverrides?: {
    forcedColors?: Map<string, string>;
    forcedDimmers?: Map<string, number>;
    forcedStrobes?: Map<string, { active: boolean; speed: number }>;
    forcedMovements?: Map<string, { pattern: string; amplitude: number; speed?: number }>;
  },
  colorTrackColors?: Map<string, string>,
  strobeTrackOverrides?: Map<string, { active: boolean; speed: number }>,
  dimmerTrackOverrides?: Map<string, { active: boolean; value: number }>,
  disabledFixtures?: Set<string>,
  fixturePositions?: Record<string, { x: number; y: number; h?: number }>,
  chaserTakeover?: Map<string, Record<number, number>>,
): Array<{ universe: number; channelValues: Record<number, number> }> {
  const uniIds = universes.map(u => String(u.id));
  const analyses: ChannelAnalysis[] = [];
  for (const pf of patchedFixtures) {
    const def = fixtureDefs.get(pf.fixtureDefId);
    const fa = analyzeChannels(pf, def);
    fa.universeIndex = uniIds.indexOf(pf.universeId);
    if (fa.universeIndex < 0) fa.universeIndex = 0;
    analyses.push(fa);
  }
  const byUniverse = new Map<number, ChannelAnalysis[]>();
  for (const fa of analyses) {
    const list = byUniverse.get(fa.universeIndex) ?? [];
    list.push(fa);
    byUniverse.set(fa.universeIndex, list);
  }

  const energy = cue.energy ?? (
    cue.intensity === 'very-high' ? 0.95 :
    cue.intensity === 'high' ? 0.8 :
    cue.intensity === 'medium' ? 0.5 :
    cue.intensity === 'low' ? 0.25 : 0.1
  );
  const isDrop = cue.section.toLowerCase() === 'drop';
  const isChorus = cue.section.toLowerCase() === 'chorus';
  const sec = cue.section.toLowerCase();

  const results: Array<{ universe: number; channelValues: Record<number, number> }> = [];

  for (const [uniIdx, fixtures] of byUniverse.entries()) {
    const chVals: Record<number, number> = {};

    for (let fi = 0; fi < fixtures.length; fi++) {
      const fa = fixtures[fi];
      const pf = fa.fixture;

      // Skip disabled fixtures
      if (disabledFixtures?.has(pf.id)) continue;

      let dimmerVal = (fixtureTrackOverrides?.forcedDimmers?.has(pf.id))
        ? fixtureTrackOverrides.forcedDimmers.get(pf.id)!
        : mapIntensity(cue.intensity, energy, pf.tier, tierMultipliers);
      // Dimmer track override (highest priority for intensity)
      const dimmerOverride = dimmerTrackOverrides?.get(pf.id);
      if (dimmerOverride) {
        dimmerVal = Math.round(255 * dimmerOverride.value / 100);
      }
      if (fa.intensityOffset !== null) {
        const addr = pf.startAddress + fa.intensityOffset;
        if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
      }
      // Dimmer track: force-write the main intensity channel and propagate to
      // ALL intensity channels (LED heads 2..N) — the track outranks cues.
      if (dimmerOverride) {
        if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = dimmerVal;
        for (const li of (fa.ledIntensityOffsets || [])) chVals[pf.startAddress + li] = dimmerVal;
      }

      // Color track > fixture track > cue color
      let paletteColor = (colorTrackColors?.has(pf.id))
        ? colorTrackColors.get(pf.id)!
        : (fixtureTrackOverrides?.forcedColors?.has(pf.id))
        ? fixtureTrackOverrides.forcedColors.get(pf.id)!
        : (() => {
          return (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined;
        })();

      if (fa.rgbSegments.length > 0 && paletteColor) {
        let [r, g, b] = hexToRgb(paletteColor);
        // Skip tier hue shift for user-specified color track colors
        if (!colorTrackColors?.has(pf.id)) {
          [r, g, b] = applyHueShift([r, g, b], TIER_HUE[pf.tier]);
        }
        // Force Color Preset/Macro channels to 0 for raw RGB control
        for (const po of fa.presetOverrideOffsets) { chVals[pf.startAddress + po] = 0; }
        {
          const segCount = fa.rgbSegments.length;
          const isMulti = segCount > 1 && !colorTrackColors?.has(pf.id);
          for(let sIdx=0; sIdx<segCount; sIdx++){
            const seg = fa.rgbSegments[sIdx];
            let pr=r,pg=g,pb=b;
            if(isMulti){
              const hueStep = 360/segCount;
              const segHue = (sIdx * hueStep * 0.6) % 360;
              [pr,pg,pb] = applyHueShift([r,g,b], segHue * 0.35);
            }
            chVals[pf.startAddress + seg.r] = pr;
            chVals[pf.startAddress + seg.g] = pg;
            if (seg.b !== null) chVals[pf.startAddress + seg.b] = pb;
            if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
            if ((seg as any).a !== null && (seg as any).a !== undefined) chVals[pf.startAddress + (seg as any).a] = 0;
            if ((seg as any).uv !== null && (seg as any).uv !== undefined) chVals[pf.startAddress + (seg as any).uv] = 0;
          }
        }
        // Apply dimmer track/cue dimmer to RGB when no dedicated intensity channel
        if (fa.intensityOffset === null) {
          const dScale = dimmerVal / 255;
          for (const seg of fa.rgbSegments) {
            chVals[pf.startAddress + seg.r] = Math.round((chVals[pf.startAddress + seg.r] ?? 0) * dScale);
            chVals[pf.startAddress + seg.g] = Math.round((chVals[pf.startAddress + seg.g] ?? 0) * dScale);
            if (seg.b !== null) chVals[pf.startAddress + seg.b] = Math.round((chVals[pf.startAddress + seg.b] ?? 0) * dScale);
            if (seg.w !== null) chVals[pf.startAddress + seg.w] = Math.round((chVals[pf.startAddress + seg.w] ?? 0) * dScale);
          }
        }
        // Exploit remaining generic channels pour snapshot (même logique que tick live, base cue.time)
        if(!fa.isLaser){
          if(fa.effectOffset!==null){
            const caps = fa.effectCaps;
            if(caps.length>0){
              let effVal:number;
              if(energy < 0.3){
                const off = caps.find(c=>c.min===0) || caps[0];
                effVal = capMid(off);
              } else {
                const idx = Math.floor(((cue as any).time*0.7) % caps.length);
                effVal = capMid(caps[idx]);
              }
              chVals[pf.startAddress+fa.effectOffset]=effVal;
            } else {
              chVals[pf.startAddress+fa.effectOffset]=0;
            }
          }
          if(fa.speedOffset!==null){
            chVals[pf.startAddress+fa.speedOffset]= Math.max(0, Math.min(255, Math.round(50 + energy*150)));
          }
          if(fa.beamOffset!==null && chVals[pf.startAddress+fa.beamOffset]===undefined){
            chVals[pf.startAddress+fa.beamOffset]= Math.round(100 + energy*80);
          }
        }
      } else if (fa.wheelOffset !== null && paletteColor && (() => {
        // Snapshot path : ne pas écraser la couleur du chaser (roue) par l'autoscript
        const cmap = chaserTakeover?.get(pf.id);
        if (!cmap) return true;
        return cmap[pf.startAddress + fa.wheelOffset] === undefined;
      })()) {
        const caps = fa.wheelCaps;
        let wheelVal: number;
        if (caps.length > 0) {
          const bestCap = findBestWheelCap(caps, paletteColor);
          wheelVal = bestCap ? Math.round((bestCap.min + bestCap.max) / 2) : (() => {const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;const capIdx=Math.floor(wPos*caps.length)%caps.length;return Math.round((caps[capIdx].min+caps[capIdx].max)/2);})();
        } else {
          const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;wheelVal=Math.round(wPos*255);
        }
        chVals[pf.startAddress + fa.wheelOffset] = wheelVal;
      }

      if (fa.shutterOffset !== null) {
        const sAddr = pf.startAddress + fa.shutterOffset;
        const strobeTrackStrobe = strobeTrackOverrides?.get(pf.id);
        const trackStrobe = fixtureTrackOverrides?.forcedStrobes?.get(pf.id);
        const useStrobe = strobeTrackStrobe
          ? strobeTrackStrobe.active
          : trackStrobe 
          ? trackStrobe.active
          : (cue as any).forcedStrobe !== undefined ? (cue as any).forcedStrobe : ((isDrop || isChorus) && cue.strobe && pf.tier === 'primary');
        if (useStrobe) {
          const speed = Math.min(strobeTrackStrobe?.speed || trackStrobe?.speed || (cue as any).strobeSpeed || 10, 10);
          // Use a value in the typical strobe capability range (16-131) instead of 180-255 (shutter open)
          chVals[sAddr] = Math.min(131, 16 + Math.floor(speed * 11));
        } else if (fa.intensityOffset === null) {
          chVals[sAddr] = Math.max(8, Math.min(255, 8 + Math.round((dimmerVal / 255) * 247)));
        } else {
          chVals[sAddr] = 255;
        }
      }

      // Canal Strobe dédié (snapshot/crossfade) : off par défaut, valeur de
      // strobe quand le strobe est demandé. Jamais 255 (strobe max permanent).
      if (fa.strobeOffset !== null) {
        const stAddr2 = pf.startAddress + fa.strobeOffset;
        const strobeTrackStrobe2 = strobeTrackOverrides?.get(pf.id);
        const trackStrobe2 = fixtureTrackOverrides?.forcedStrobes?.get(pf.id);
        const useStrobe2 = strobeTrackStrobe2
          ? strobeTrackStrobe2.active
          : trackStrobe2
          ? trackStrobe2.active
          : (cue as any).forcedStrobe !== undefined ? (cue as any).forcedStrobe : ((isDrop || isChorus) && cue.strobe && pf.tier === 'primary');
        if (useStrobe2) {
          const speed2 = Math.min(strobeTrackStrobe2?.speed || trackStrobe2?.speed || (cue as any).strobeSpeed || 10, 10);
          chVals[stAddr2] = Math.min(250, Math.max(8, Math.round(8 + speed2 * 20)));
        } else {
          chVals[stAddr2] = 0;
        }
      }

      const panCount = fa.panOffsets.length;
      const tiltCount = fa.tiltOffsets.length;
      const motorCount = Math.max(panCount, tiltCount, 1);
      if (panCount > 0 || tiltCount > 0) {
        const trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id);
        const speedMult = trackMovement?.speed ?? (cue as any).movementSpeed ?? 1;
        const amplitude = trackMovement
          ? trackMovement.amplitude
          : (cue as any).movementAmplitude !== undefined
            ? Math.min(128, Math.max(0, Math.round((cue as any).movementAmplitude)))
            : pf.tier === 'primary' ? 90 : pf.tier === 'secondary' ? 70 : 40;
        if (amplitude > 0) {
          // Spatial choreography: keep crossfade snapshots coherent with the live tick
          const spatialPattern = (cue as any).spatialPattern;
          let mobileIdx = -1, totalMobile = 0;
          if (spatialPattern && !trackMovement) {
            for (const a of analyses) {
              if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {
                if (a.fixture.id === pf.id) mobileIdx = totalMobile;
                totalMobile++;
              }
            }
          }
          const phase = cue.time * Math.PI * 2 * speedMult + (spatialPattern && !trackMovement ? spatialPhaseFor(fixturePositions?.[pf.id], spatialPattern, mobileIdx) : 0);
          for (let m = 0; m < motorCount; m++) {
            const motorPhase = m * (Math.PI * 2 / motorCount);
            const movSec = (() => {
              if (trackMovement) return trackMovement.pattern;
              // Section name → getSmartMovement distributes per-fixture (multi-fixture choreography)
              const cueMov = (cue as any).movement;
              if (cueMov) {
                const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
                if (!explicitPatterns.has(cueMov)) {
                  let mobileIdx = -1, totalMobile = 0;
                  for (const a of analyses) {
                    if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {
                      if (a.fixture.id === pf.id) mobileIdx = totalMobile;
                      totalMobile++;
                    }
                  }
                  if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, cueMov, cue.time);
                  return cueMov;
                }
                return cueMov;
              }
              let mobileIdx = -1, totalMobile = 0;
              for (const a of analyses) {
                if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {
                  if (a.fixture.id === pf.id) mobileIdx = totalMobile;
                  totalMobile++;
                }
              }
              if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, sec, cue.time);
              return sec;
            })();
            let px = 0, py = 0;
            switch (movSec) {
              case 'intro': px = Math.sin(phase * .1) * .3; py = Math.cos(phase * .08 + motorPhase) * .3; break;
              case 'verse': px = Math.sin(phase * .25) * .5; py = Math.cos(phase * .2 + motorPhase) * .4; break;
              case 'chorus': px = Math.sin(phase * .5) * .7; py = Math.cos(phase * .5 + motorPhase) * .7; break;
              case 'bridge': px = Math.sin(phase * .3) * .5; py = Math.sin(phase * .6 + motorPhase) * .5; break;
              case 'drop': px = Math.sin(phase * .8) * .9; py = Math.cos(phase * 1.2 + motorPhase) * .6; break;
              case 'outro': px = Math.sin(phase * .15) * .2; py = Math.cos(phase * .12 + motorPhase) * .2; break;
              case 'sweep': px = Math.sin(phase * .35 + motorPhase) * .7; py = Math.cos(phase * .3 + motorPhase) * .5; break;
              case 'circle': px = Math.sin(phase * .5 + motorPhase) * .7; py = Math.cos(phase * .5 + motorPhase) * .7; break;
              case 'bounce': px = Math.sin(phase * .4 + motorPhase) * .5; py = Math.abs(Math.sin(phase * .8 + motorPhase)) * .8; break;
              case 'wave': px = Math.sin(phase * .6 + motorPhase) * .5; py = Math.sin(phase * .35 + motorPhase * 1.5) * .5; break;
              case 'figure8': px = Math.sin(phase * .4 + motorPhase) * .6; py = Math.sin(phase * .8 + motorPhase) * .5; break;
              case 'static': px = Math.sin(phase * .05 + motorPhase) * .1; py = Math.cos(phase * .05 + motorPhase) * .1; break;
              case 'pulse': px = Math.sin(phase * .9 + motorPhase) * .25; py = Math.abs(Math.sin(phase * 1.8 + motorPhase)) * .85; break;
              case 'zigzag': { const saw = ((phase / Math.PI) % 2) - 1; px = saw * .8; py = Math.sin(phase) > 0 ? .5 : -.5; } break;
              case 'diamond': { px = (((phase / Math.PI) % 2) - 1) * .8; py = ((((phase + Math.PI / 2) / Math.PI) % 2) - 1) * .8; } break;
              case 'spiral': { const r = .3 + .7 * Math.abs(Math.sin(phase * .3)); px = Math.sin(phase * 2) * r; py = Math.cos(phase * 2) * r; } break;
              case 'heartbeat': { const hp = ((phase / (Math.PI * 2)) % 1); const hb = hp < .15 ? 1 : hp < .3 ? .6 : 0; px = hb * Math.sin(phase * 3); py = hb * Math.cos(phase * 3); } break;
              case 'randomWalk': px = Math.sin(phase * .7) * .5 + Math.sin(phase * 1.3) * .3 + Math.cos(phase * 2.1) * .2; py = Math.cos(phase * .6) * .5 + Math.sin(phase * 1.7) * .3 + Math.sin(phase * 2.3) * .2; break;
              case 'panOnly': px = Math.sin(phase); py = 0; break;
              case 'tiltOnly': px = 0; py = Math.sin(phase); break;
              default: px = Math.sin(phase * .35) * .5; py = Math.cos(phase * .3 + motorPhase) * .5;
            }
            if (m < panCount) {
              const raw = Math.max(0, Math.min(255, Math.round(128 + px * amplitude)));
              const fp = fixturePositions?.[pf.id];
              chVals[pf.startAddress + fa.panOffsets[m]] = fp ? clampPanToStage(raw, fp.x) : raw;
            }
            if (m < tiltCount) {
              const raw = Math.max(0, Math.min(255, Math.round(128 + py * amplitude)));
              const fp = fixturePositions?.[pf.id];
              chVals[pf.startAddress + fa.tiltOffsets[m]] = fp ? clampTiltToStage(raw, fp.y) : raw;
            }
          }
        } else {
          for (const po of fa.panOffsets) chVals[pf.startAddress + po] = 128;
          for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = 128;
        }
      }

      // GOBO / PRISM / ZOOM / FROST / IRIS / FOCUS — audio-reactive
      const fxEnergy = (cue as any).energy ?? 0.5;
      const fxPhase = cue.time * Math.PI * 2 * ((cue as any).movementSpeed ?? 1);
      const _FXPROF: Record<string, [number, number, number, number]> = {
        intro: [0.4, 0.55, 0.75, 0.6], verse: [0.7, 0.5, 0.8, 0.3],
        chorus: [1.3, 0.35, 0.9, 0.1], bridge: [0.5, 0.6, 0.8, 0.7],
        drop: [2, 0.15, 0.7, 0], build: [1.6, 0.25, 0.85, 0.15],
        outro: [0.3, 0.6, 0.8, 0.5],
      };
      const _fxP = _FXPROF[sec] || [1, 0.4, 0.85, 0.2];
      const fxPhase2 = fxPhase * _fxP[0];

      if (fa.goboOffset !== null) {
        const gAddr = pf.startAddress + fa.goboOffset;
        if (fa.goboCaps.length > 0) {
          const goboCount = Math.max(1, fa.goboCaps.length);
          const goboIdx = Math.floor((fxPhase2 * 0.5) % goboCount);
          chVals[gAddr] = Math.round((fa.goboCaps[goboIdx].min + fa.goboCaps[goboIdx].max) / 2);
        } else {
          chVals[gAddr] = Math.round(fxEnergy * 255);
        }
      }

      if (fa.prismOffset !== null) {
        chVals[pf.startAddress + fa.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase2 * 0.7) * 128 * fxEnergy)));
      }

      if (fa.zoomOffset !== null) {
        chVals[pf.startAddress + fa.zoomOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase2 * 0.4) * 96 * (_fxP[1] + (_fxP[2] - _fxP[1]) * fxEnergy) + 64 * fxEnergy)));
      }

      if (fa.frostOffset !== null) {
        chVals[pf.startAddress + fa.frostOffset] = Math.round(Math.max(0, Math.min(255, (255 - fxEnergy * 255) * (1 - _fxP[3]) + _fxP[3] * 200)));
      }

      if (fa.irisOffset !== null) {
        chVals[pf.startAddress + fa.irisOffset] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase2 * 0.5) * 15 * fxEnergy);
      }

      if (fa.focusOffset !== null) {
        chVals[pf.startAddress + fa.focusOffset] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase2 * 0.3) * 30);
      }

      // ── Laser : exploitation live (mode, pattern, scan, vitesses, rotations, blanking) ──
      // Jamais statique, jamais synchrone : phase par fixture, cercle ou
      // Lissajous, vitesses oscillantes. C'est CE chemin (QuickShow/AutoScript
      // live) qui joue en concert — les lasers doivent bouger ici aussi.
      if (fa.isLaser) {
        computeLaserChannels(fa, pf, chVals, cue.time, energy, paletteColor, {
          blankWhenStrobe: (isDrop || isChorus) && !!cue.strobe,
        });
      }
    }

    // Chaser track: merge only chaser-driven channels
    if (chaserTakeover && chaserTakeover.size > 0) {
      for (const fa of fixtures) {
        const pf = fa.fixture;
        const cmap = chaserTakeover.get(pf.id);
        if (!cmap) continue;
        for (const addrStr in cmap) {
          const v = cmap[addrStr];
          const addr = Number(addrStr);
          if (addr >= pf.startAddress && addr < pf.startAddress + pf.channelCount) chVals[addr] = v;
        }
      }
    }

    results.push({ universe: uniIdx, channelValues: chVals });
  }

  return results.filter(r => Object.keys(r.channelValues).length > 0);
}