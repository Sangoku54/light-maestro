/**
 * DMX Playback Hook — Direct on-the-fly DMX computation and hardware output.
 *
 * Computes DMX values ON EVERY FRAME for the current playback time,
 * then sends them directly to hardware via IPC.
 *
 * Architecture:
 *   Renderer → IPC setChannels → Engine writes SAB → Worker reads SAB
 *   Worker → frameSent → Engine dispatches to USB/ArtNet/sACN outputs
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
    if (!tr.entries || tr.entries.length === 0 || !tr.targetFixtures) continue;
    const entry = tr.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!entry) continue;
    const chaser = chasers.find(c => c.id === entry.chaserId);
    if (!chaser || !chaser.steps || chaser.steps.length === 0) continue;

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

// Stage-aware pan/tilt clamping to keep beams on stage
// ─── Extracted utilities (pure functions, no React) ──────
import type { RgbSegment } from '../engine/dmx-color';
import { hexToRgb, applyHueShift, TIER_HUE, classifyColor, mapIntensity, startsWithRgb, hasColorWord, isRed, isGreen, isBlue, isWhite, isPresetMode, buildRgbSegments, findBestWheelCap } from '../engine/dmx-color';
import type { ChannelAnalysis } from '../engine/fixture-analyzer';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { clampPanToStage, clampTiltToStage, SMART_MOVEMENTS, DEFAULT_SMART_MOVEMENTS, getSmartMovement } from '../engine/dmx-movement';
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
  energy?: number;
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
  disabledFixturesRef?: React.MutableRefObject<Set<string>>; // Disabled fixture IDs
  fixturePositionsRef?: React.MutableRefObject<Record<string, { x: number; y: number }>>; // For stage-aware pan/tilt
  onVirtualDmx?: (universe: number, channelValues: Record<number, number>) => void; // Mirror for 3D view
  dryRunMode?: boolean; // Skip hardware DMX output, keep store/3D updates
  frozenRef?: React.MutableRefObject<boolean>; // Freeze: hold current DMX frame
  forceDropRef?: React.MutableRefObject<boolean>; // Force next tick to use drop parameters
  arbiterSource?: string; // Output-arbiter source id this engine writes as (default 'quickshow')
}): void {
  const {isPlaying,currentTimeRef,cues,patchedFixtures,fixtureDefs,universes,dmxOutputEnabled,tierMultipliers,strobeLimit=10,colorFadeMs=250,overrideCuesRef,fixtureTracksRef,efxTracksRef,effectsRef,fixtureGroupsRef,colorTracksRef,strobeTracksRef,dimmerTracksRef,chaserTracksRef,chasersRef,scenesRef,onVirtualDmx,disabledFixturesRef,fixturePositionsRef,dryRunMode=false,frozenRef,forceDropRef,arbiterSource}=options;
  const arbSource = arbiterSource ?? 'quickshow';
  const cuesRef=useRef(cues);cuesRef.current=cues;
  const dmxEnabledRef=useRef(dmxOutputEnabled);dmxEnabledRef.current=dmxOutputEnabled;
  const dryRunRef=useRef(dryRunMode);dryRunRef.current=dryRunMode;
  // Keep the bridge dry-run flag in sync (hardware flush happens in the bridge)
  useEffect(()=>{ dmxBridge.setDryRun(dryRunMode); },[dryRunMode]);
  const lastChannelsRef=useRef<Map<number,Record<number,number>>>(new Map());
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
      const def=fixtureDefs.get(pf.fixtureDefId);
      if(!def){analysisRef.current=null;return;}
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
    // Only update if data actually changed to avoid RAF loop re-mounts
    const prev=analysisRef.current;
    const newKey=JSON.stringify({uniIds,counts:analyses.map(a=>a.fixture.id)});
    if(prev?._key!==newKey){
      analysisRef.current={byUniverse,uniIds,_key:newKey};
    }
  },[patchedFixtures,fixtureDefs,universes]);

  // Ensure DMX engine is started
  const engineStartedRef=useRef(false);
  useEffect(()=>{
    const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
    if(!api||universes.length===0)return;
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
    if(!api)return;
    // Dry-run mode: skip hardware DMX, keep store/3D updates


    // Ensure engine is started (re-attempt on first play tick if needed)
    if(!engineStartedRef.current){
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

      // ── Color track forced colors (compute early, used later in palette resolution) ──
      const ctRefData = colorTracksRef?.current || [];
      const colorTrackColors = computeColorTrackColors(
        ctRefData,
        ct,
        patchedFixturesRef.current,
        fixtureGroupsRef?.current || [],
      );
      // Diagnostic: log color tracks once every 120 frames (~2s)
      const _diagFrame2 = (tick as any)._ctDiagFrame ?? 0;
      (tick as any)._ctDiagFrame = _diagFrame2 + 1;
      if (_diagFrame2 % 120 === 0 && ctRefData.length > 0) {
        for (const ctItem of ctRefData) {
          const activeEntry = ctItem.entries.find(e => ct >= e.time && ct < e.endTime);
          console.log(`[colorTrack] "${ctItem.name}" targets=${ctItem.targetFixtures?.type} entries=${ctItem.entries.length} activeAt=${ct.toFixed(1)}: ${activeEntry ? `${activeEntry.color}→${activeEntry.endColor || 'N/A'} [${activeEntry.time.toFixed(1)}-${activeEntry.endTime.toFixed(1)}]` : '∅'}`);
        }
        const armId = patchedFixturesRef.current.find(f => f.name?.includes('6 arm'))?.id;
        if (armId) {
          console.log(`[colorTrack] Tonio 6 arm (${armId}) hasColorTrack: ${colorTrackColors.has(armId)} → ${colorTrackColors.get(armId) || '∅'}`);
        }
      }

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

      // Crossfade: find next cue and pre-compute its DMX values
      let nextCue:CuePlayback|null=null;
      let crossfadeT = 0;
      for(const cue of c){if(cue.time>ct&&(!nextCue||cue.time<nextCue.time))nextCue=cue;}
      let nextCueDmx:Array<{universe:number;channelValues:Record<number,number>}>|null=null;
      if(nextCue&&active){const gap=nextCue.time-active.time;if(gap>0&&gap<0.3){const window=Math.min(0.15,gap*0.5);const start=nextCue.time-window;if(ct>=start){crossfadeT=Math.min(1,(ct-start)/window);}}}
      if(crossfadeT>0&&nextCue){
        try{
          nextCueDmx=computeDmxForCue(
            nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,undefined,
            colorTrackColors,undefined,undefined,disabledFixturesRef?.current,fixturePositions
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
      const efxPtOverrides = efxTracksRef?.current && effectsRef?.current && efxTracksRef.current.length > 0
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
      const dimmerOverrides = dimmerTracksRef?.current && dimmerTracksRef.current.length > 0
        ? computeDimmerTrackOverrides(dimmerTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
        : null;
      const strobeOverrides = strobeTracksRef?.current && strobeTracksRef.current.length > 0
        ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
        : null;
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
          if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;}

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
          if(fa.rgbSegments.length>0&&paletteColor){
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
            // If intensityOffset was detected (including Dimmer/Shutter), set it
            if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;}
            for(const seg of fa.rgbSegments){const key=pf.id+'_'+seg.r;let cur=fadeState.get(key);if(!cur){cur={r:r,g:g,b:b};fadeState.set(key,cur);}else{cur.r=Math.round(cur.r+(r-cur.r)*FADE_ALPHA);cur.g=Math.round(cur.g+(g-cur.g)*FADE_ALPHA);cur.b=Math.round(cur.b+(b-cur.b)*FADE_ALPHA);}chVals[pf.startAddress+seg.r]=cur.r;chVals[pf.startAddress+seg.g]=cur.g;chVals[pf.startAddress+seg.b]=cur.b;if(seg.w!==null)chVals[pf.startAddress+seg.w]=0;}
            // Apply dimmer track/cue dimmer to RGB when no dedicated intensity channel
            if(fa.intensityOffset===null){const dScale=dimmerVal/255;for(const seg of fa.rgbSegments){chVals[pf.startAddress+seg.r]=Math.round((chVals[pf.startAddress+seg.r]??0)*dScale);chVals[pf.startAddress+seg.g]=Math.round((chVals[pf.startAddress+seg.g]??0)*dScale);chVals[pf.startAddress+seg.b]=Math.round((chVals[pf.startAddress+seg.b]??0)*dScale);if(seg.w!==null)chVals[pf.startAddress+seg.w]=Math.round((chVals[pf.startAddress+seg.w]??0)*dScale);}}

          }else if(fa.wheelOffset!==null&&paletteColor){
            const caps=fa.wheelCaps;
            let wheelVal:number;
            if(caps.length>0){const bestCap=findBestWheelCap(caps,paletteColor);wheelVal=bestCap?Math.round((bestCap.min+bestCap.max)/2):(()=>{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;const capIdx=Math.floor(wPos*caps.length)%caps.length;return Math.round((caps[capIdx].min+caps[capIdx].max)/2);})();}
            else{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;wheelVal=Math.round(wPos*255);}
            chVals[pf.startAddress+fa.wheelOffset]=wheelVal;
          }

          // Diagnostic: log actual RGB output for Tonio 6 arm after write
          const _diagFrame = (tick as any)._armDiagFrame ?? 0;
          (tick as any)._armDiagFrame = _diagFrame + 1;
          if (_diagFrame % 120 === 0 && pf.name?.includes('6 arm')) {
            const isCT = colorTrackColors.has(pf.id);
            console.log(`[dmx-out] Tonio 6 arm | source=${isCT?'colorTrack':'cue'} palette=${paletteColor||'∅'} dimmer=${dimmerVal}`,
              `| rgbSegments=${fa.rgbSegments.length>0?fa.rgbSegments.map(s=>`R${pf.startAddress+s.r}=${chVals[pf.startAddress+s.r]??0} G${pf.startAddress+s.g}=${chVals[pf.startAddress+s.g]??0} B${pf.startAddress+s.b}=${chVals[pf.startAddress+s.b]??0}`).join('; '):'∅'}`);
          }

          // Shutter
          if(fa.shutterOffset!==null){const sAddr=pf.startAddress+fa.shutterOffset;
            // Strobe track override (highest priority, pre-computed)
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
              : forcedStrobe !== undefined ? forcedStrobe : ((isDrop || isChorus) && active.strobe && pf.tier === 'primary');
            if (useStrobe) {
              // Adaptive strobe speed: section-dependent multiplier
              const sectionMult = isDrop ? 1.5 : isChorus ? 1.2 : sec === 'build' ? 1.3 : sec === 'bridge' ? 1.0 : sec === 'verse' ? 0.8 : 0.5;
              const baseSpeed = Math.min(strobeTrackOverride?.speed || trackStrobe?.speed || active.strobeSpeed || 10, strobeLimit);
              const adaptedSpeed = Math.min(baseSpeed * sectionMult, strobeLimit);
              // Soft strobe: pulse dimmer + hold shutter open when fixture has separate intensity
              if (fa.intensityOffset !== null && !strobeTrackOverride && !trackStrobe) {
                const pulse = 0.5 + 0.5 * Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                const iAddr = pf.startAddress + fa.intensityOffset;
                if (!chVals[iAddr] || Math.round(dimmerVal * pulse) > chVals[iAddr]) chVals[iAddr] = Math.round(dimmerVal * pulse);
                chVals[sAddr] = 255; // shutter stays open
              } else {
                chVals[sAddr] = Math.min(255, 180 + Math.floor(adaptedSpeed * 3));
              }
            }
            else if(fa.intensityOffset===null){chVals[sAddr]=Math.max(8,Math.min(255,8+Math.round((dimmerVal/255)*247)));}
            else{chVals[sAddr]=255;}}

          // PAN/TILT — check EFX override first, fall back to auto pattern
          const panCount=fa.panOffsets.length;const tiltCount=fa.tiltOffsets.length;const motorCount=Math.max(panCount,tiltCount,1);
          if(panCount>0||tiltCount>0){
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
              const amplitude = trackMovement
                ? trackMovement.amplitude
                : active.movementAmplitude !== undefined
                  ? Math.min(128, Math.max(0, Math.round(active.movementAmplitude)))
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
              if(amplitude>0){for(let m=0;m<motorCount;m++){const motorPhase=m*(Math.PI*2/motorCount);const speedMult=active.movementSpeed??1;
                // Crossfade movement params: blend toward next cue
                const curAmp = amplitude; const curSpd = speedMult;
                const blendAmp = (crossfadeT>0&&nextCue&&!trackMovement)
                  ? Math.round(curAmp*(1-crossfadeT) + (nextCue.movementAmplitude!==undefined?Math.min(128,Math.max(0,Math.round(nextCue.movementAmplitude))):curAmp)*crossfadeT)
                  : curAmp;
                const blendSpd = (crossfadeT>0&&nextCue&&!trackMovement)
                  ? curSpd*(1-crossfadeT) + (nextCue.movementSpeed??curSpd)*crossfadeT
                  : curSpd;
                const phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase;let px=0,py=0;
                switch(movPattern){case'intro':px=Math.sin(phase*.1)*.3;py=Math.cos(phase*.08+motorPhase)*.3;break;case'verse':px=Math.sin(phase*.25)*.5;py=Math.cos(phase*.2+motorPhase)*.4;break;case'chorus':px=Math.sin(phase*.5)*.7;py=Math.cos(phase*.5+motorPhase)*.7;break;case'bridge':px=Math.sin(phase*.3)*.5;py=Math.sin(phase*.6+motorPhase)*.5;break;case'drop':px=Math.sin(phase*.8)*.9;py=Math.cos(phase*1.2+motorPhase)*.6;break;case'outro':px=Math.sin(phase*.15)*.2;py=Math.cos(phase*.12+motorPhase)*.2;break;case'sweep':px=Math.sin(phase*.35+motorPhase)*.7;py=Math.cos(phase*.3+motorPhase)*.5;break;case'circle':px=Math.sin(phase*.5+motorPhase)*.7;py=Math.cos(phase*.5+motorPhase)*.7;break;case'bounce':px=Math.sin(phase*.4+motorPhase)*.5;py=Math.abs(Math.sin(phase*.8+motorPhase))*.8;break;case'wave':px=Math.sin(phase*.6+motorPhase)*.5;py=Math.sin(phase*.35+motorPhase*1.5)*.5;break;case'figure8':px=Math.sin(phase*.4+motorPhase)*.6;py=Math.sin(phase*.8+motorPhase)*.5;break;case'static':px=Math.sin(phase*.05+motorPhase)*.1;py=Math.cos(phase*.05+motorPhase)*.1;break;
                case'zigzag':{const saw=((phase/Math.PI)%2)-1;px=saw*.8;py=Math.sin(phase)>0?.5:-.5;}break;case'diamond':{px=(((phase/Math.PI)%2)-1)*.8;py=((((phase+Math.PI/2)/Math.PI)%2)-1)*.8;}break;case'spiral':{const r=.3+.7*Math.abs(Math.sin(phase*.3));px=Math.sin(phase*2)*r;py=Math.cos(phase*2)*r;}break;case'heartbeat':{const hp=((phase/(Math.PI*2))%1);const hb=hp<.15?1:hp<.3?.6:0;px=hb*Math.sin(phase*3);py=hb*Math.cos(phase*3);}break;case'randomWalk':px=Math.sin(phase*.7)*.5+Math.sin(phase*1.3)*.3+Math.cos(phase*2.1)*.2;py=Math.cos(phase*.6)*.5+Math.sin(phase*1.7)*.3+Math.sin(phase*2.3)*.2;break;case'panOnly':px=Math.sin(phase);py=0;break;case'tiltOnly':px=0;py=Math.sin(phase);break;
      default:px=Math.sin(phase*.35)*.4;py=Math.cos(phase*.3+motorPhase)*.4;}
                if(m<panCount){
                  const raw = Math.max(0,Math.min(255,Math.round(128+px*blendAmp)));
                  const fp = fixturePositions?.[pf.id];
                  chVals[pf.startAddress+fa.panOffsets[m]] = fp ? clampPanToStage(raw, fp.x) : raw;
                }
                if(m<tiltCount){
                  const raw = Math.max(0,Math.min(255,Math.round(128+py*blendAmp)));
                  const fp = fixturePositions?.[pf.id];
                  chVals[pf.startAddress+fa.tiltOffsets[m]] = fp ? clampTiltToStage(raw, fp.y) : raw;
                }}
              }else{for(const po of fa.panOffsets)chVals[pf.startAddress+po]=128;for(const to of fa.tiltOffsets)chVals[pf.startAddress+to]=128;}
            }
          }

          // GOBO / PRISM / ZOOM / FROST / IRIS / FOCUS — audio-reactive
          const fxEnergy = (active.energy ?? 0.5);
          const fxPhase = ct * Math.PI * 2 * (active.movementSpeed ?? 1);

          if(fa.goboOffset!==null){const gAddr=pf.startAddress+fa.goboOffset;
            if(fa.goboCaps.length>0){
              const gc=Math.max(1,fa.goboCaps.length);
              const gi=Math.floor((fxPhase*0.5)%gc);
              chVals[gAddr]=Math.round((fa.goboCaps[gi].min+fa.goboCaps[gi].max)/2);
            }else{
              chVals[gAddr]=Math.round(fxEnergy*255);
            }
          }
          if(fa.prismOffset!==null){const pAddr=pf.startAddress+fa.prismOffset;
            chVals[pAddr]=Math.round(Math.max(0,Math.min(255,64+Math.sin(fxPhase*0.7)*128*fxEnergy)));
          }
          if(fa.zoomOffset!==null){const zAddr=pf.startAddress+fa.zoomOffset;
            chVals[zAddr]=Math.round(64+Math.sin(fxPhase*0.4)*96*fxEnergy+64*fxEnergy);
          }
          if(fa.frostOffset!==null){const fAddr=pf.startAddress+fa.frostOffset;
            chVals[fAddr]=Math.round(Math.max(0,255-(fxEnergy*255)));
          }
          if(fa.irisOffset!==null){const iAddr=pf.startAddress+fa.irisOffset;
            chVals[iAddr]=Math.round(40+fxEnergy*200+Math.sin(fxPhase*0.5)*15*fxEnergy);
          }
          if(fa.focusOffset!==null){const fcAddr=pf.startAddress+fa.focusOffset;
            chVals[fcAddr]=Math.round(80+fxEnergy*120+Math.sin(fxPhase*0.3)*30);
          }
        }

        // Chaser track takeover: fully controlled fixtures get the chaser scene state
        if (chaserTracksRef?.current && chasersRef?.current && scenesRef?.current) {
          // Diagnostic: log chaser track state once every 120 frames (~2s)
          const _diagC = (tick as any)._chDiagFrame ?? 0;
          (tick as any)._chDiagFrame = _diagC + 1;
          try {
            const chaserCtl = computeChaserTrackOverrides(
              chaserTracksRef.current,
              chasersRef.current,
              scenesRef.current,
              ct,
              patchedFixturesRef.current,
              fixtureGroupsRef?.current || [],
            );
            if (_diagC % 120 === 0 && chaserTracksRef.current.length > 0) {
              for (const tr of chaserTracksRef.current) {
                const activeEntry = tr.entries.find(e => ct >= e.time && ct < e.endTime);
                console.log(`[chaserTrack] "${tr.name}" entries=${tr.entries.length} activeAt=${ct.toFixed(1)}: ${activeEntry ? `chaser=${activeEntry.chaserName || activeEntry.chaserId} [${activeEntry.time.toFixed(1)}-${activeEntry.endTime.toFixed(1)}] controls=${chaserCtl.size} fixtures` : '∅'}`);
              }
            }
            if (chaserCtl.size > 0) {
              for (const fa of fixtures) {
                const pfx = fa.fixture;
                const cmap = chaserCtl.get(pfx.id);
                if (!cmap) continue;
                for (let a = pfx.startAddress; a < pfx.startAddress + pfx.channelCount; a++) {
                  if (chVals[a] !== undefined) delete chVals[a];
                }
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

        // Crossfade blend: mix next cue values into current chVals
        if(crossfadeT>0&&nextCueDmx){
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
            // Throttle React store updates to ~30 FPS (P2.2 perf)
            const now=performance.now();
            if(now-lastStoreUpdate>33){
              useAppStore.getState().setUniverseData(uniIdx, chVals);
              lastStoreUpdate=now;
            }
            // Arbitrated bridge — computes final buffer and flushes to hardware
            dmxBridge.push(uniIdx, chVals, arbSource);
            if (onVirtualDmx) onVirtualDmx(uniIdx, chVals);
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
    forcedMovements?: Map<string, { pattern: string; amplitude: number }>;
  },
  colorTrackColors?: Map<string, string>,
  strobeTrackOverrides?: Map<string, { active: boolean; speed: number }>,
  dimmerTrackOverrides?: Map<string, { active: boolean; value: number }>,
  disabledFixtures?: Set<string>,
  fixturePositions?: Record<string, { x: number; y: number }>,
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
      if (dimmerTrackOverrides) {
        const dimmerOverride = dimmerTrackOverrides.get(pf.id);
        if (dimmerOverride) {
          dimmerVal = Math.round(255 * dimmerOverride.value / 100);
        }
      }
      if (fa.intensityOffset !== null) {
        const addr = pf.startAddress + fa.intensityOffset;
        if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
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
        for (const seg of fa.rgbSegments) {
          chVals[pf.startAddress + seg.r] = r;
          chVals[pf.startAddress + seg.g] = g;
          chVals[pf.startAddress + seg.b] = b;
          if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
        }
        // Apply dimmer track/cue dimmer to RGB when no dedicated intensity channel
        if (fa.intensityOffset === null) {
          const dScale = dimmerVal / 255;
          for (const seg of fa.rgbSegments) {
            chVals[pf.startAddress + seg.r] = Math.round((chVals[pf.startAddress + seg.r] ?? 0) * dScale);
            chVals[pf.startAddress + seg.g] = Math.round((chVals[pf.startAddress + seg.g] ?? 0) * dScale);
            chVals[pf.startAddress + seg.b] = Math.round((chVals[pf.startAddress + seg.b] ?? 0) * dScale);
            if (seg.w !== null) chVals[pf.startAddress + seg.w] = Math.round((chVals[pf.startAddress + seg.w] ?? 0) * dScale);
          }
        }
      } else if (fa.wheelOffset !== null && paletteColor) {
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
          chVals[sAddr] = Math.min(255, 180 + Math.floor(speed * 3));
        } else if (fa.intensityOffset === null) {
          chVals[sAddr] = Math.max(8, Math.min(255, 8 + Math.round((dimmerVal / 255) * 247)));
        } else {
          chVals[sAddr] = 255;
        }
      }

      const panCount = fa.panOffsets.length;
      const tiltCount = fa.tiltOffsets.length;
      const motorCount = Math.max(panCount, tiltCount, 1);
      if (panCount > 0 || tiltCount > 0) {
        const trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id);
        const amplitude = trackMovement
          ? trackMovement.amplitude
          : (cue as any).movementAmplitude !== undefined
            ? Math.min(128, Math.max(0, Math.round((cue as any).movementAmplitude)))
            : pf.tier === 'primary' ? 90 : pf.tier === 'secondary' ? 70 : 40;
        if (amplitude > 0) {
          const speedMult = (cue as any).movementSpeed ?? 1;
          const phase = cue.time * Math.PI * 2 * speedMult;
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

      if (fa.goboOffset !== null) {
        const gAddr = pf.startAddress + fa.goboOffset;
        if (fa.goboCaps.length > 0) {
          const goboCount = Math.max(1, fa.goboCaps.length);
          const goboIdx = Math.floor((fxPhase * 0.5) % goboCount);
          chVals[gAddr] = Math.round((fa.goboCaps[goboIdx].min + fa.goboCaps[goboIdx].max) / 2);
        } else {
          chVals[gAddr] = Math.round(fxEnergy * 255);
        }
      }

      if (fa.prismOffset !== null) {
        chVals[pf.startAddress + fa.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase * 0.7) * 128 * fxEnergy)));
      }

      if (fa.zoomOffset !== null) {
        chVals[pf.startAddress + fa.zoomOffset] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * fxEnergy + 64 * fxEnergy);
      }

      if (fa.frostOffset !== null) {
        chVals[pf.startAddress + fa.frostOffset] = Math.round(Math.max(0, 255 - (fxEnergy * 255)));
      }

      if (fa.irisOffset !== null) {
        chVals[pf.startAddress + fa.irisOffset] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase * 0.5) * 15 * fxEnergy);
      }

      if (fa.focusOffset !== null) {
        chVals[pf.startAddress + fa.focusOffset] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase * 0.3) * 30);
      }
    }

    // Chaser track takeover: fully controlled fixtures get the chaser scene state
    if (chaserTakeover && chaserTakeover.size > 0) {
      for (const fa of fixtures) {
        const pf = fa.fixture;
        const cmap = chaserTakeover.get(pf.id);
        if (!cmap) continue;
        for (let a = pf.startAddress; a < pf.startAddress + pf.channelCount; a++) {
          if (chVals[a] !== undefined) delete chVals[a];
        }
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