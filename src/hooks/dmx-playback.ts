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
import { clampStrobeLimit, SECTION_MIN_INTENSITY } from './dmx-cues';
import { resolveTrackTargets, computeEfxOverrides, type EfxTrackRef, type FixtureTrack, type MovementBlock } from './fixture-tracks';
import { computeMatrixTrackColors, collectActiveMatrixIds, markMatrixPresetDriven, noteEngineTick } from './rgb-matrix-playback';

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

export interface SceneTrackEntryRef {
  id: string;
  time: number;
  endTime: number;
  sceneId: string;
  sceneName?: string;
}
export interface SceneTrackRef {
  id: string;
  entries: SceneTrackEntryRef[];
  name?: string;
}

/**
 * Log de diagnostic de priorité (dev) : actif uniquement lorsque
 * window.__LM_DEBUG_PRIO__ === true dans la console du renderer.
 * Ne fait rien (et ne coûte rien) dans les autres contextes/tests.
 */
function prioLog(...args: any[]) {
  if (typeof window !== 'undefined' &&
      ((window as any).__LM_DEBUG_PRIO__ === true ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('lmPrio') === '1'))) {
    // eslint-disable-next-line no-console
    console.info('[priorité]', ...args);
  }
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
    if (!chaser) { prioLog('chaser-track: chaser introuvable', entry.chaserId, 'lib=', chasers.length, 'ct=', currentTime.toFixed(2)); continue; }
    if (!chaser.steps || chaser.steps.length === 0) { prioLog('chaser-track: chaser sans steps', entry.chaserId, 'ct=', currentTime.toFixed(2)); continue; }

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
    if (!scene || !scene.channels) { prioLog('chaser-track: étape -> scène introuvable', step.sceneId, 'scenes='+scenes.length, 'chaser='+entry.chaserId); continue; }
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
    if (!show || !show.tracks) { prioLog('show-track: show introuvable', entry.showId, 'lib=', shows.length, 'ct=', currentTime.toFixed(2)); continue; }
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

/**
 * Scene track override — joue les canaux statiques d'une scène telle quelle
 * (prend le dessus sur l'autoscript). Pour chaque entrée active, les fixtures
 * qui couvrent au moins un canal de la scène sont forcées sur la valeur de la
 * scène pendant la plage [time, endTime[.
 */
export function computeSceneTrackOverrides(
  sceneTracks: SceneTrackRef[],
  scenes: Array<{ id: string; channels: Record<number, number> }>,
  currentTime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: { id: string; fixtureIds: string[] }[],
): Map<string, Record<number, number>> {
  const controlled = new Map<string, Record<number, number>>();
  if (!sceneTracks || sceneTracks.length === 0 || !scenes || scenes.length === 0) return controlled;
  for (const tr of sceneTracks) {
    if (!tr.entries || tr.entries.length === 0) continue;
    const entry = tr.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!entry) continue;
    const scene = scenes.find(sc => sc.id === entry.sceneId);
    if (!scene || !scene.channels) { prioLog('scene-track: scène introuvable', entry.sceneId, 'lib=', scenes.length, 'ct=', currentTime.toFixed(2)); continue; }
    const addrs = new Set<number>(Object.keys(scene.channels).map(Number));
    const targets: string[] = [];
    for (const pf of patchedFixtures) {
      for (let a = pf.startAddress; a < pf.startAddress + pf.channelCount; a++) {
        if (addrs.has(a)) { targets.push(pf.id); break; }
      }
    }
    if (targets.length === 0) {
      // Aucun recouvrement de canaux (scène virtuelle) : on ne force rien,
      // contrairement à un show qui pilote tout son contenu.
      continue;
    }
    for (const fid of targets) {
      const pf = patchedFixtures.find(p => p.id === fid);
      if (!pf) continue;
      const perFix: Record<number, number> = {};
      for (const [addrStr, raw] of Object.entries(scene.channels)) {
        const a = Number(addrStr);
        if (a >= pf.startAddress && a < pf.startAddress + pf.channelCount) {
          const v = Number(raw);
          perFix[a] = Math.max(0, Math.min(255, Math.round(Number.isFinite(v) ? v : 0)));
        }
      }
      if (Object.keys(perFix).length > 0) controlled.set(fid, perFix);
    }
  }
  return controlled;
}

/**
 * Crossfade dipless entre deux snapshots de scène (canaux bruts, pré-intensité).
 *
 * Règle anti-saccade : un canal absent d'un côté ne tombe JAMAIS à 0 — il
 * garde sa dernière valeur envoyée (`held`), sinon la valeur de l'autre côté
 * (tenue constante). Cas réel : une scène enregistrée avant l'ajout de
 * fixtures ne contient pas leurs canaux ; sans ça elles plongent au noir et
 * repartent en snap à chaque boucle.
 *
 * @param fromCh snapshot de départ (peut être partiel)
 * @param toCh snapshot d'arrivée (peut être partiel)
 * @param k 0..1 position dans la transition
 * @param intensity multiplicateur appliqué en sortie (fade de l'item)
 * @param held dernières valeurs brutes envoyées (tient lieu de mémoire)
 */
export function crossfadeSceneChannels(
  fromCh: Record<number | string, number> | undefined,
  toCh: Record<number | string, number> | undefined,
  k: number,
  intensity = 1,
  held?: Record<number, number>,
): Record<number, number> {
  const out: Record<number, number> = {};
  const addrs = new Set<number>();
  for (const src of [fromCh, toCh, held]) {
    if (!src) continue;
    for (const key of Object.keys(src)) addrs.add(Number(key));
  }
  const kk = Math.max(0, Math.min(1, k));
  for (const addr of addrs) {
    const a = fromCh?.[addr] ?? held?.[addr] ?? toCh?.[addr] ?? 0;
    const b = toCh?.[addr] ?? held?.[addr] ?? a;
    out[addr] = Math.round((a * (1 - kk) + b * kk) * intensity);
  }
  return out;
}

/**
 * Complète un snapshot brut avec les valeurs tenues (canaux connus mais
 * absents du snapshot courant) pour qu'un chaser ne lâche jamais un canal
 * en cours de route. Retourne un nouvel objet (ne mute pas).
 */
export function holdMissingChannels(
  curCh: Record<number | string, number>,
  held?: Record<number, number>,
): Record<number, number> {
  const out: Record<number, number> = { ...curCh };
  if (held) {
    for (const [key, v] of Object.entries(held)) {
      const addr = Number(key);
      if (!(addr in out)) out[addr] = v;
    }
  }
  return out;
}

// Stage-aware pan/tilt clamping to keep beams on stage
// ─── Extracted utilities (pure functions, no React) ──────
import { evalEffect, toDmx, type EffectPattern } from '../engine/effect-engine';
import { sectionMoveFor, sectionPhase01, sampleSectionLoop, phaseToIndexOffset, movementAmp } from '../engine/autoscript-loops';
import { getSectionEnvelope, sampleCurve } from '../engine/autoscript-envelopes';
import type { RgbSegment } from '../engine/dmx-color';
import { hexToRgb, applyHueShift, TIER_HUE, classifyColor, mapIntensity, tierIntensityMultiplier, findBestWheelCap, wheelDegeneratePosition, splitRgbw } from '../engine/dmx-color';
import type { ChannelAnalysis } from '../engine/fixture-analyzer';
import { analyzeChannels, capMid, pickLaserModeCap, laserGateValue, mapIntensityVal, type FixtureChannelAnalysis } from '../engine/fixture-analyzer';
import { writeCapabilityChannels, writeAxisPair, snapValueToCaps, writeLaserGates, writeRgbSegment, scaleRgbSegment, writeNominalChannels, writeFinePairs, writeCmyChannels, writeWhitePixels, writeExtraColourChannels, writeAuxColourChannels } from '../engine/fixture-writers';
import { clampPanToStage, clampTiltToStage, SMART_MOVEMENTS, DEFAULT_SMART_MOVEMENTS, getSectionMovement, spatialPhaseFor, zeroDmxOffset, clampPanZoneDmx, clampTiltZoneDmx } from '../engine/dmx-movement';
import { computeGoboValue } from '../engine/gobo-engine';
import { useAppStore } from '../stores/appStore';
import { useProgrammerStore } from '../stores/programmerStore';
import { dmxBridge } from '../utils/dmx-bridge';
import { recordAudioTick } from '../utils/latency-meter';
import { manualTargetRef } from '../utils/manualTarget';
import { computeBlackoutTrackOverrides, type BlackoutTrackRef } from '../utils/blackoutTrack';
import { hasSceneAim, getSceneAim, computeAimDMX } from '../utils/sceneAim';


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
  // Scene live overrides (faders in Performance view) — applied on top of all playback
  sceneLiveOverridesRef?: React.MutableRefObject<{
    masterDimmer: number;           // 0-255
    panTiltSpeedMul: number;        // 0.1-2.0
    effectSpeedMul: number;         // 0.1-2.0
    strobeSpeedMul: number;         // 0.1-2.0
    perFixtureDimmer: Record<string, number>; // 0-255 per fixture
    /** Couleur maîtresse #rrggbb appliquée à toutes les fixtures RGB. null/absent = off. */
    masterColor?: string | null;
  }>;
  overrideCuesRef?: React.MutableRefObject<any[]>; // EFX + manual cues that override auto DMX
  fixtureTracksRef?: React.MutableRefObject<FixtureTrack[]>; // Fixture track overrides
  efxTracksRef?: React.MutableRefObject<EfxTrackRef[]>; // EFX track pan/tilt overrides
  effectsRef?: React.MutableRefObject<SavedEffect[]>; // Saved effect definitions
  fixtureGroupsRef?: React.MutableRefObject<{ id: string; fixtureIds: string[] }[]>;
  colorTracksRef?: React.MutableRefObject<ColorTrackRef[]>; // Color track overrides
  strobeTracksRef?: React.MutableRefObject<StrobeTrackRef[]>; // Strobe track overrides
  dimmerTracksRef?: React.MutableRefObject<DimmerTrackRef[] | null>; // Dimmer track overrides (highest priority for intensity)
  blackoutTracksRef?: React.MutableRefObject<BlackoutTrackRef[] | null>; // Blackout track overrides (intensity 0 + shutter fermé sur fixtures ciblées)
  chaserTracksRef?: React.MutableRefObject<ChaserTrackRef[] | null>; // Chaser track takeover (full control of target fixtures)
  chasersRef?: React.MutableRefObject<Array<{ id: string; steps: Array<{ sceneId: string; fadeIn?: number; hold?: number; fadeOut?: number }> }>>; // Saved chasers
  scenesRef?: React.MutableRefObject<Array<{ id: string; channels: Record<number, number> }>>; // Saved scenes (for chaser steps)
  showTracksRef?: React.MutableRefObject<ShowTrackRef[] | null>; // Show track takeover (full show over autoscript)
  showsRef?: React.MutableRefObject<Array<{ id: string; name?: string; duration: number; tracks: Array<{ type: string; items: Array<{ startTime: number; duration: number; resourceId: string; fadeIn?: number; fadeOut?: number }>; muted?: boolean }> }>>;
  sceneTracksRef?: React.MutableRefObject<SceneTrackRef[] | null>; // Scene track takeover (static scene config on its fixtures)
  matrixTracksRef?: React.MutableRefObject<any[] | null>; // Matrix track lanes: couleur (+ strobe du motif) chevauchant l'autoscript
  matricesRef?: React.MutableRefObject<any[]>; // Définitions de matrices RGB sauvegardées
  disabledFixturesRef?: React.MutableRefObject<Set<string>>; // Disabled fixture IDs
  fixturePositionsRef?: React.MutableRefObject<Record<string, { x: number; y: number; h?: number; zeroPan?: number; zeroTilt?: number; centerPan?: number; centerTilt?: number; mountMode?: string; tilt?: number; heading?: number }>>; // For stage-aware pan/tilt + centre du mouvement (capture)
  panTiltLimitsRef?: React.MutableRefObject<{ pan: number; tilt: number; perFixture?: Record<string, { pan: number; tilt: number }> }>; // DMX half-amplitude limits for autoscript movement (128 = full)
  onVirtualDmx?: (universe: number, channelValues: Record<number, number>) => void; // Mirror for 3D view
  dryRunMode?: boolean; // Skip hardware DMX output, keep store/3D updates
  frozenRef?: React.MutableRefObject<boolean>; // Freeze: hold current DMX frame
  forceDropRef?: React.MutableRefObject<boolean>; // Force next tick to use drop parameters
  arbiterSource?: string; // Output-arbiter source id this engine writes as (default 'quickshow')
}): void {
  const {isPlaying,currentTimeRef,cues,patchedFixtures,fixtureDefs,universes,dmxOutputEnabled,tierMultipliers,strobeLimit=10,colorFadeMs=250,overrideCuesRef,fixtureTracksRef,efxTracksRef,effectsRef,fixtureGroupsRef,colorTracksRef,strobeTracksRef,dimmerTracksRef,blackoutTracksRef,chaserTracksRef,chasersRef,scenesRef,showTracksRef,showsRef,sceneTracksRef,matrixTracksRef,matricesRef,onVirtualDmx,disabledFixturesRef,fixturePositionsRef,panTiltLimitsRef,dryRunMode=false,frozenRef,forceDropRef,arbiterSource,sceneLiveOverridesRef}=options;
  // Sécurité photosensibilité : le plafond utilisateur est lui-même plafonné
  // (vieux projet, preset ou entrée MIDI ne doivent jamais dépasser le max UI).
  const strobeLimitSafe = clampStrobeLimit(strobeLimit);
   // Keep a ref so the live tick can read the latest value without re-declaring
   // the const on every render (strobeLimit/colorFadeMs can change at runtime).
   const strobeLimitSafeRef = useRef(strobeLimitSafe);
   strobeLimitSafeRef.current = strobeLimitSafe;
   const colorFadeMsRef = useRef(colorFadeMs);
   colorFadeMsRef.current = colorFadeMs;
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
      // Univers inexistant (projet rechargé, univers supprimé) → la fixture est
      // IGNORÉE. L'ancien repli sur l'univers 0 la faisait piloter par erreur
      // les adresses d'autres fixtures (fixture parasite).
      fa.universeIndex=pf.universeId?uniIds.indexOf(String(pf.universeId)):0;
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

  useEffect(()=>{
    const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
    if(!api||universes.length===0)return;
    // Dry-run: don't start the hardware engine at all — the 3D preview is
    // written renderer-side (channelData) and never needs the USB/sACN backend.
    if(dryRunRef.current)return;
    let cancelled=false;
    (async()=>{
      try{
        if(await api.isRunning().catch(()=>false))return;
        await Promise.all(universes.map((u:any)=>api.addUniverse({
          id:u.id,name:u.name,type:u.type||'usb-dmx',output:true,input:false,
          channels:u.channels||512,serialPort:u.serialPort||'',
          artnetIP:u.artnetIP||'',artnetSubnet:u.artnetSubnet??0,artnetUniverse:u.artnetUniverse??0,
          sacnUniverse:u.sacnUniverse??1,sacnPriority:u.sacnPriority??100,
        }).catch(()=>{})));
        if(cancelled)return;
        await api.start().catch(()=>{});
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
    // Le programmeur (LTP 85) est un buffer « live design ». Au lancement de
    // la lecture (audio/autoscript), il doit être vidé sinon il écrase
    // l'autoscript (HTP 40/45) sur pan/tilt/couleur des fixtures qu'il tient :
    // les têtes ciblées resteraient figées/blanches au lieu d'osciller et de
    // se colorer avec le show.
    try { useProgrammerStore.getState().clear(); } catch { /* best effort */ }

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


    // Ensure engine is started. Re-attempt on EVERY play start (not just the
    // first session play): the fail-safe watchdog may have stopped/blacked out
    // the engine mid-session, and a fresh play must re-establish output right
    // away instead of waiting for the tick's ~2s _engineRecheck.
    if(!dryRunRef.current){
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
    const fadeState=new Map();
        const tick=()=>{
      if(!dmxEnabledRef.current){rafRef.current=requestAnimationFrame(tick);return;}
      // Posé chaque frame PENDANT la lecture uniquement : le hook RAF de
      // l'onglet Matrice s'efface (le lecteur possède la sortie). Hors
      // lecture le drapeau expire (< 600 ms) et la matrice reprend la main.
      if (isPlaying) noteEngineTick();
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
      // Pistes matrice : la couleur du motif (et son strobe éventuel) prend le
      // dessus sur l'autoscript, mais le mouvement et le dimmer restent à lui.
      const matrixTrack = computeMatrixTrackColors(
        matrixTracksRef?.current,
        ct,
        fixtureGroupsRef?.current || [],
        matricesRef?.current || [],
      );
      for (const [fid, hex] of matrixTrack.colors) colorTrackColors.set(fid, hex);
      // Marque les matrices actives sur pistes comme « pilotées par le preset »
      // → le hook RAF de l'onglet Matrice les ignore (plus de double pilote).
      // Vide le marquage hors lecture (pas de liste figée).
      markMatrixPresetDriven(
        matrixTracksRef?.current?.length && isPlaying
          ? collectActiveMatrixIds(matrixTracksRef.current, ct)
          : [],
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
      let strobeOverridesEarly: Map<string, { active: boolean; speed: number }> | null =
        strobeTracksRef?.current && strobeTracksRef.current.length > 0
          ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
          : null;
      // Le strobe du motif matrice s'ajoute là où aucune piste strobe explicite
      // ne pilote déjà la fixture.
      if (matrixTrack.strobe.size > 0) {
        if (!strobeOverridesEarly) strobeOverridesEarly = new Map();
        for (const [fid, v] of matrixTrack.strobe) {
          if (!strobeOverridesEarly.has(fid)) strobeOverridesEarly.set(fid, v);
        }
      }
      // Blackout track : fixtures à rendre inactives (noir) durant l'intervalle.
      let blackoutOverrides: Map<string, { active: boolean }> | null = null;
      if (blackoutTracksRef?.current && blackoutTracksRef.current.length > 0) {
        blackoutOverrides = computeBlackoutTrackOverrides(
          blackoutTracksRef.current,
          ct,
          patchedFixturesRef.current,
        );
      }
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
          // Show + Scene takeovers included in the crossfade snapshot too, so the
          // blended frame keeps the section channels instead of popping. Same
          // priority as the live engine on shared fixtures: chaser < show < scene.
          let mergedSnap: Map<string, Record<number, number>> | null =
            choSnap.size > 0 ? new Map(choSnap) : null;
          const mergeSnapCtl = (src: Map<string, Record<number, number>>) => {
            if (src.size === 0) return;
            if (!mergedSnap) mergedSnap = new Map();
            for (const [fid, cmap] of src.entries()) {
              const existing = mergedSnap.get(fid);
              if (!existing) { mergedSnap.set(fid, cmap); continue; }
              const out: Record<number, number> = { ...existing };
              for (const [a, v] of Object.entries(cmap)) out[Number(a)] = v;
              mergedSnap.set(fid, out);
            }
          };
          if (showTracksRef?.current && showsRef?.current && scenesRef?.current) {
            try {
              const showSnap = computeShowTrackOverrides(
                showTracksRef.current as any,
                showsRef.current as any,
                scenesRef.current as any,
                chasersRef?.current as any || [],
                ct,
                patchedFixturesRef.current,
                fixtureGroupsRef?.current || [],
              );
              mergeSnapCtl(showSnap);
            } catch (e) { /* show snapshot failed; keep the previous snapshot */ }
          }
          if (sceneTracksRef?.current && scenesRef?.current) {
            try {
              const sceneSnap = computeSceneTrackOverrides(
                sceneTracksRef.current,
                scenesRef.current as any,
                ct,
                patchedFixturesRef.current,
                fixtureGroupsRef?.current || [],
              );
              if (sceneSnap.size > 0) {
                // Scene runs last in the live tick → it wins on shared channels.
                mergeSnapCtl(sceneSnap);
                nextCueDmx=computeDmxForCue(
                   nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,ftoSnap,
                   colorTrackColors,strobeOverridesEarly,dimmerOverrides,disabledFixturesRef?.current,fixturePositions,mergedSnap,strobeLimitSafeRef.current
                 );
              }
            } catch (e) { /* scene snapshot failed; keep the previous snapshot */ }
          }
          if (nextCueDmx===null) {
            nextCueDmx=computeDmxForCue(
               nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,ftoSnap,
               colorTrackColors,strobeOverridesEarly,dimmerOverrides,disabledFixturesRef?.current,fixturePositions,mergedSnap ?? choSnap,strobeLimitSafeRef.current
             );
          }
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
    // Enveloppe CONTINUE du dimmer (autoscript) : niveau 0..1 échantillonné
    // AU TEMPS COURANT. Sans elle, le dimmer restait figé sur le palier de
    // la cue (escalier) — d'où l'absence totale de nuance.
    const envelopeDimmerLevel = (() => {
      const env = getSectionEnvelope((active as any)?.envId);
      if (!env) return undefined;
      const s = (active as any)?.sectionStart;
      const e = (active as any)?.sectionEnd;
      if (typeof s !== 'number' || typeof e !== 'number') return undefined;
      const v = sampleCurve(env.dimmer, s, e, ct);
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;
    })();
    // Plancher de section (identique au chemin statique) : chaque section a
    // son minimum, pour le contraste dramatique.
    const sectionDimmerFloor = SECTION_MIN_INTENSITY[sec] ?? 60;
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

      // Show + Scene takeovers, also computed ONCE per frame. They are re-applied
      // as the FINAL write per universe (after blend/fade) so the sections take
      // precedence over the autoscript on every channel they define.
      let showCtlFrame = new Map<string, Record<number, number>>();
      try {
        if (showTracksRef?.current && showsRef?.current && scenesRef?.current) {
          showCtlFrame = computeShowTrackOverrides(
            showTracksRef.current as any,
            showsRef.current as any,
            scenesRef.current as any,
            chasersRef?.current as any || [],
            ct,
            patchedFixturesRef.current,
            fixtureGroupsRef?.current || [],
          );
        }
      } catch { showCtlFrame = new Map<string, Record<number, number>>(); }
      let sceneCtlFrame = new Map<string, Record<number, number>>();
      try {
        if (sceneTracksRef?.current && scenesRef?.current) {
          sceneCtlFrame = computeSceneTrackOverrides(
            sceneTracksRef.current,
            scenesRef.current as any,
            ct,
            patchedFixturesRef.current,
            fixtureGroupsRef?.current || [],
          );
        }
      } catch { sceneCtlFrame = new Map<string, Record<number, number>>(); }

      // Debug périodique : dump ~4/s avec le flag (window.__LM_DEBUG_PRIO__=true ou
      // localStorage lmPrio=1), et automatiquement ~1/2s (sans flag) dès qu'il y a
      // des entrées de pistes ou un takeover actif — pour que le test soit toujours
      // observable. Sans pistes ni takeover : silence total.
      const debugPrioOn =
        (window as any).__LM_DEBUG_PRIO__ === true ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('lmPrio') === '1');
      const every = (tick as any)._dlog = ((tick as any)._dlog ?? 0) + 1;
      const trackEntries = (ref: any) => (ref?.current ?? []).reduce((n: number, t: any) => n + (t.entries?.length || 0), 0);
      const hasTrackActivity =
        trackEntries(sceneTracksRef) + trackEntries(chaserTracksRef) + trackEntries(showTracksRef) > 0 ||
        chaserCtlFrame.size + showCtlFrame.size + sceneCtlFrame.size > 0;
      if ((debugPrioOn && every % 15 === 0) || (hasTrackActivity && every % 120 === 0)) {
        const sample = (map: Map<string, Record<number, number>>) => {
          if (map.size === 0) return '-';
          let out = '';
          let n = 0;
          for (const [fid, vals] of map.entries()) {
            const chs = Object.keys(vals).map(Number).sort((a, b) => a - b);
            out += (out ? ' | ' : '') + fid + ':[' + chs.slice(0, 6).join(',') + (chs.length > 6 ? '…+' + (chs.length - 6) : '') + ']';
            if (++n >= 3) break;
          }
          return out;
        };
        console.info(
          '[priorité] ct=' + ct.toFixed(2) +
          ' | tracks(chaser=' + (chaserTracksRef?.current?.length ?? '?') +
          ' scene=' + (sceneTracksRef?.current?.length ?? '?') +
          ' show=' + (showTracksRef?.current?.length ?? '?') + ')' +
          ' | entries(chaser=' + (trackEntries(chaserTracksRef)) +
          ' scene=' + (trackEntries(sceneTracksRef)) + ')' +
          ' | lib(scenes=' + (scenesRef?.current?.length ?? '?') +
          ' chasers=' + (chasersRef?.current?.length ?? '?') +
          ' shows=' + (showsRef?.current?.length ?? '?') + ')' +
          ' | active(chaser=' + chaserCtlFrame.size +
          ' show=' + showCtlFrame.size +
          ' scene=' + sceneCtlFrame.size + ')',
          sceneCtlFrame.size ? 'scene=' + sample(sceneCtlFrame) : '',
          showCtlFrame.size ? 'show=' + sample(showCtlFrame) : '',
        );
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
            if (active.forcedDimmerVal !== undefined) return active.forcedDimmerVal;
            if (envelopeDimmerLevel !== undefined) {
              // Enveloppe audio continue : niveau du dimmer échantillonné à
              // l'instant présent (RMS + respiration + accents de beat).
              const tiered = Math.round(255 * envelopeDimmerLevel * tierIntensityMultiplier(pf.tier, tierMultipliers));
              return Math.max(tiered, sectionDimmerFloor);
            }
            return mapIntensity(active.intensity, effectiveEnergy, pf.tier, tierMultipliers);
          })();
          // Dimmer track override (highest priority for intensity)
          if (dimmerOverrides) {
            const dimmerOverride = dimmerOverrides.get(pf.id);
            if (dimmerOverride) {
              dimmerVal = Math.round(255 * dimmerOverride.value / 100);
            }
          }
          const _dimmerTrackActive = !!(dimmerOverrides && dimmerOverrides.get(pf.id));
           if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(_dimmerTrackActive){chVals[addr]=mapIntensityVal(dimmerVal,fa);}else if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=mapIntensityVal(dimmerVal,fa);}
           // Propagate intensity to ALL LED intensity channels (multi-head fixtures: spider, LED bar heads 2..N)
           for(const li of (fa.ledIntensityOffsets||[])){chVals[pf.startAddress+li]=dimmerVal;}

// Densite par section (activeTiers) : les fixtures hors tiers actifs
            // passent en veilleuse (plancher ~11 % + shutter ouvert) au lieu du
            // noir total — les faisceaux restent à peine visibles pendant que
            // le show respire entre intro (primary seul) et drop (toutes les
            // couches). Noir total = mouvement fantôme invisible (le cas
            // rapporté : secondaire qui bouge mais ne se voit pas).
            // Les fixtures de tier 'other' sont toujours considerees comme actives.
            // Une fixture dont le centre de mouvement a été « capturé »
            // (centerPan/centerTilt posés) est une mise en avant intentionnelle :
            // elle doit participer au show (couleur + mouvement) quelle que soit
            // sa densité de tier, sinon Target+Capture reste éteinte pendant
            // intro/bridge/outro (activeTiers réduit) alors que le reste bouge.
            const _captured = fixturePositions?.[pf.id];
            const _hasCapturedCenter = !!_captured && (
              (_captured.centerPan !== undefined && _captured.centerPan !== 0) ||
              (_captured.centerTilt !== undefined && _captured.centerTilt !== 0)
            );
            // ~11 % DMX : faisceau visible en salle noire, nettement en retrait.
            const INACTIVE_TIER_FLOOR = 28;
            let _fixtureInactive = false;
            if (Array.isArray(active.activeTiers) && !active.activeTiers.includes(pf.tier) && pf.tier !== 'other' && !_dimmerTrackActive && !_hasCapturedCenter) {
              _fixtureInactive = true;
              if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = mapIntensityVal(INACTIVE_TIER_FLOOR, fa);
              if (fa.shutterOffset !== null) chVals[pf.startAddress + fa.shutterOffset] = 255;
              if (fa.strobeOffset !== null) chVals[pf.startAddress + fa.strobeOffset] = 0;
if (fa.isLaser) {
                if (fa.rgbOffsets) for (const o of fa.rgbOffsets) chVals[pf.startAddress + o] = 0;
                if (fa.laserColorGateOffset !== null) chVals[pf.startAddress + fa.laserColorGateOffset] = 0;
                if (fa.laserMasterOffset !== null) chVals[pf.startAddress + fa.laserMasterOffset] = 0;
              }
              // RGB-only sans canal intensité (LED bars / wall washers) : teinte
              // du cue au plancher (le bloc palette est sauté pour les inactifs —
              // sans ça, noir total malgré le mouvement).
              if (!fa.isLaser) {
                const _floorHex = (active as any)?.forcedColor || (active as any)?.color || (active as any)?.colors?.[0] || '#ffffff';
                const [_fr0, _fg0, _fb0] = hexToRgb(_floorHex);
                const _fs = INACTIVE_TIER_FLOOR / 255;
                const _fch = [Math.round(_fr0 * _fs), Math.round(_fg0 * _fs), Math.round(_fb0 * _fs)];
                (fa.rgbOffsets || []).forEach((o, i) => { chVals[pf.startAddress + o] = _fch[i % 3]; });
                for (const seg of fa.rgbSegments) {
                  chVals[pf.startAddress + seg.r] = _fch[0];
                  chVals[pf.startAddress + seg.g] = _fch[1];
                  if (seg.b !== null) chVals[pf.startAddress + seg.b] = _fch[2];
                  if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
                }
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
          // RGB-only sans canal intensité (LED bars / wall washers, mobiles mal
          // patchés...) : une piste dimmer active doit RENDRE le dimmer visible.
          // Sans couleur de cue, on matérialise du blanc — le scaling dimmer
          // ci-dessous l'atténue ensuite. La piste dimmer surpasse la respiration.
          let effPaletteColor = paletteColor;
          if (!effPaletteColor && _dimmerTrackActive && fa.intensityOffset === null && fa.rgbSegments.length > 0) {
            effPaletteColor = '#ffffff';
          }
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
            // Pixels blancs autonomes et mélangeurs CMY = canaux couleur
            // aussi : le takeover du chaser doit les respecter.
            for (const o of fa.whitePixels) colorAddrs.add(pf.startAddress + o);
            for (const o of fa.extraColourChannels) colorAddrs.add(pf.startAddress + o.offset);
            if (fa.cmyOffsets.c !== null) colorAddrs.add(pf.startAddress + fa.cmyOffsets.c);
            if (fa.cmyOffsets.m !== null) colorAddrs.add(pf.startAddress + fa.cmyOffsets.m);
            if (fa.cmyOffsets.y !== null) colorAddrs.add(pf.startAddress + fa.cmyOffsets.y);
            for (const addrStr in chaserMapForColor) {
              if (colorAddrs.has(Number(addrStr))) { chaserOwnsColor = true; break; }
            }
          }
          // Couleur EFFECTIVE de la palette (décalage de tier + modulation
          // d'énergie) — partagée par les écritures RGB, CMY et pixels blancs
          // pour que les 3tress rendent EXACTEMENT la même couleur.
          const paletteRgbOf = (hex: string): [number, number, number] => {
            let [rr, gg, bb] = hexToRgb(hex);
            // Only apply tier hue shift to cue colors, NOT to user-specified color track colors
            if (!isColorTrack) {
              [rr, gg, bb] = applyHueShift([rr, gg, bb], TIER_HUE[pf.tier]);
              // Dynamic palette by energy: modulate saturation based on intensity
              const grayVal = Math.round(rr * 0.299 + gg * 0.587 + bb * 0.114);
              if (effectiveEnergy < 0.3) {
                // Low energy: desaturate toward gray
                const desat = 1 - effectiveEnergy * 3;
                rr = Math.round(rr + (grayVal - rr) * desat);
                gg = Math.round(gg + (grayVal - gg) * desat);
                bb = Math.round(bb + (grayVal - bb) * desat);
                // Cool shift on intros/outros
                if (!isDrop && !isChorus) {
                  rr = Math.round(rr * (1 - (0.3 - effectiveEnergy) * 0.8));
                  bb = Math.min(255, Math.round(bb * (1 + (0.3 - effectiveEnergy) * 0.5)));
                }
              } else if (effectiveEnergy > 0.6) {
                // High energy: boost saturation (push away from gray)
                const boost = (effectiveEnergy - 0.6) * 0.4;
                rr = Math.min(255, Math.round(rr + (rr - grayVal) * boost * 2.5));
                gg = Math.min(255, Math.round(gg + (gg - grayVal) * boost * 2.5));
                bb = Math.min(255, Math.round(bb + (bb - grayVal) * boost * 2.5));
              }
            }
            return [rr, gg, bb];
          };
          if(fa.rgbSegments.length>0&&effPaletteColor&&!chaserOwnsColor&&!_fixtureInactive){
            const [r,g,b]=paletteRgbOf(effPaletteColor);
            for(const po of fa.presetOverrideOffsets){chVals[pf.startAddress+po]=0;}
            if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(_dimmerTrackActive){chVals[addr]=mapIntensityVal(dimmerVal,fa);}else if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=mapIntensityVal(dimmerVal,fa);}
            // Per-pixel RGB: barre LED / wall wash multi-segments → chase color + wave
            // Tous les canaux RGB de la fixture sont exploités (8×3=24 pour Wall Washer)
            {
              const segCount = fa.rgbSegments.length;
              // Le chase par pixel (teinte + vague d'intensité) suppose des
              // segments = pixels INDÉPENDANTS (barre à pixels, matrice).
              // Une fixture à 2 jeux de LED (RGB + « uRed/uGreen/uBlue » d'une
              // Ovation E-910FC, par ex.) aurait sinon sa 2e moitié pilotée
              // en teinte COMPLEMENTAIRE -> couleur fausse. On reserve donc
              // le chase aux fixtures à 3 segments et plus.
              const isMultiPixel = segCount >= 3;
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
                const key=pf.id+'_'+seg.r;let cur=fadeState.get(key);if(!cur){cur={r:pr,g:pg,b:pb};fadeState.set(key,cur);}else{const _fa=colorFadeMsRef.current>0?1-Math.exp(Math.log(0.1)/(colorFadeMsRef.current/16.67)):0.98;cur.r=Math.round(cur.r+(pr-cur.r)*_fa);cur.g=Math.round(cur.g+(pg-cur.g)*_fa);cur.b=Math.round(cur.b+(pb-cur.b)*_fa);}
                // RGBW : la composante achromatique part sur le canal W → les
                // 4 canaux sont pilotés ET la couleur est EXACTEMENT la même
                // (même teinte, même luminance). Sans canal W, le triplet est
                // écrit tel quel (le split décalerait la teinte).
                let wr=cur.r,wg=cur.g,wb=cur.b,ww=0;
                if(seg.w!==null){const sp=splitRgbw(cur.r,cur.g,cur.b,seg.b!==null);wr=sp.r;wg=sp.g;wb=sp.b;ww=sp.w;}
                // Écriture coarse + LSB 16 bits (le « fine » porte la fraction,
                // jamais la valeur grossière).
                writeRgbSegment(chVals, pf.startAddress, seg, wr, wg, wb, ww);
              }
            }
            // Gates couleur laser (« Red laser », « Green laser ») : binaire
            // 0/255, jamais une valeur continue (zone fermée/stroboscope).
            writeLaserGates(chVals, pf.startAddress, fa, effPaletteColor);
            // Apply dimmer track/cue dimmer to RGB when no dedicated intensity channel
            if(fa.intensityOffset===null){const dScale=dimmerVal/255;for(const seg of fa.rgbSegments){scaleRgbSegment(chVals, pf.startAddress, seg, dScale);}}

          }else if(fa.wheelOffset!==null){
            const caps=fa.wheelCaps;
            if(paletteColor){
              const degPos = wheelDegeneratePosition(caps, fa, paletteColor, ct);
              if (degPos !== null) {
                chVals[pf.startAddress+fa.wheelOffset]=degPos;
              } else {
              let wheelVal:number;
              if(caps.length>0){const bestCap=findBestWheelCap(caps,paletteColor);wheelVal=bestCap?Math.round((bestCap.min+bestCap.max)/2):(()=>{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;const capIdx=Math.floor(wPos*caps.length)%caps.length;return Math.round((caps[capIdx].min+caps[capIdx].max)/2);})();}
              else{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;wheelVal=Math.round(wPos*255);}
              chVals[pf.startAddress+fa.wheelOffset]=wheelVal;
              }
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

          // ── Canaux couleur en doublon (2e zone / LED) ───────────
          // Ex. « Green 2 (inner leds) » : meme composante que le vert
          // principal -> la zone interne suit la couleur du show.
          if (fa.extraColourChannels.length > 0) {
            if (!chaserOwnsColor && !_fixtureInactive) {
              const [er, eg, eb]: [number, number, number] = effPaletteColor
                ? paletteRgbOf(effPaletteColor)
                : [255, 255, 255];
              const dScaleX = fa.intensityOffset === null ? dimmerVal / 255 : 1;
              writeExtraColourChannels(chVals, pf.startAddress, fa, er, eg, eb, dScaleX);
            }
          }

          // ── Fixture CMY (Cyan / Magenta / Yellow) ─────────────────
          // Couleur soustractive : C=255-R, M=255-G, Y=255-B. Sans ca, les
          // canaux CMY d'une fixture (Ayrton Domino) restaient muets, et le
          // fallback RGB envoyait du cyan sur le canal rouge.
          if (fa.cmyOffsets.c !== null || fa.cmyOffsets.m !== null || fa.cmyOffsets.y !== null) {
            if (!chaserOwnsColor && !_fixtureInactive) {
              const [cr, cg, cb]: [number, number, number] = effPaletteColor
                ? paletteRgbOf(effPaletteColor)
                : [255, 255, 255];
              writeCmyChannels(chVals, pf.startAddress, fa, cr, cg, cb);
            }
          }

          // ── Pixels blancs autonomes ───────────────────────────────
          // Barre a pixels blancs (sans triplet RGB associe) : ils recoivent
          // la composante achromatique de la palette (min R,G,B) -> une
          // palette blanche les allume, une palette saturee les laisse
          // eteints (la couleur reste celle de la palette).
          if (fa.whitePixels.length > 0) {
            if (!chaserOwnsColor && !_fixtureInactive) {
              const [wr, wg, wb]: [number, number, number] = effPaletteColor
                ? paletteRgbOf(effPaletteColor)
                : [255, 255, 255];
              writeWhitePixels(chVals, pf.startAddress, fa, wr, wg, wb);
            }
          }

          // ── Canaux génériques (Effect / Speed / Beam) ─────────────────
          // Exploitation maximale : ces canaux doivent être pilotés pour
          // TOUTES les fixtures (roue, macro, laser). Ils étaient dans la
          // seule branche RGB → une fixture à roue (moving head classique)
          // n'avait jamais son canal Effect/Speed/Beam écrit : vitesse
          // minimale et macros d'effet inactives pendant tout le show.
          if(fa.effectOffset!==null){
            const caps = fa.effectCaps;
            if(caps&&caps.length>0){
              // Basse énergie → cap « no function » (0), haute énergie → cycle macros
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
          // TOUTES les vitesses (pan/tilt, couleur, effet, rotation) : le
          // premier reste `speedOffset`, les autres suivent avec un léger
          // déphasage (sinon ils portent tous la même valeur).
          fa.speedOffsets.forEach((off,i)=>{
            const phase = ct*3 + i*0.9;
            chVals[pf.startAddress+off]= Math.max(0, Math.min(255, Math.round(50 + effectiveEnergy*150 + Math.sin(phase)*10)));
          });
          if(fa.beamOffset!==null){
            // Beam générique : exploité comme zoom/focus léger si pas déjà géré par les FX dédiés
            if(chVals[pf.startAddress+fa.beamOffset]===undefined) chVals[pf.startAddress+fa.beamOffset]= Math.round(100 + effectiveEnergy*80);
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
          const strobeSpeed = Math.min(strobeTrackOverride?.speed || trackStrobe?.speed || active.strobeSpeed || 10, strobeLimitSafe);

          // Shutter
          if(fa.shutterOffset!==null){const sAddr=pf.startAddress+fa.shutterOffset;
            if (useStrobe) {
              // Adaptive strobe speed: section-dependent multiplier
              const sectionMult = isDrop ? 1.5 : isChorus ? 1.2 : sec === 'build' ? 1.3 : sec === 'bridge' ? 1.0 : sec === 'verse' ? 0.8 : 0.5;
              const adaptedSpeed = Math.min(strobeSpeed * sectionMult, strobeLimitSafe);
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
            // Valeur = vitesse du strobe mappée sur la plage 0-255 du canal
            // (30 Hz = 255). L'ancien 8+speed*20 envoyait 208 pour une limite
            // de 10 Hz → le double de la vitesse photosensible demandée.
            chVals[stAddr]=useStrobe
              ? Math.min(250,Math.max(8,Math.round(strobeSpeed*255/30)))
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
              const baseSpeedNS = Math.min(strobeTrackOverride?.speed || trackStrobeNoShutter?.speed || active.strobeSpeed || 10, strobeLimitSafe);
              const sectionMultNS = isDrop ? 1.5 : isChorus ? 1.2 : sec === 'build' ? 1.3 : sec === 'bridge' ? 1.0 : sec === 'verse' ? 0.8 : 0.5;
              const adaptedSpeedNS = Math.min(baseSpeedNS * sectionMultNS, strobeLimitSafe);
              const strobePhaseNS = Math.sin(ct * Math.PI * 2 * adaptedSpeedNS);
              const iAddrNS = pf.startAddress + fa.intensityOffset;
              chVals[iAddrNS] = strobePhaseNS >= 0 ? mapIntensityVal(dimmerVal, fa) : mapIntensityVal(0, fa);
            }
          }

          // Blackout track override : intensité 0 + shutter fermé sur la fixture,
          // priorité absolue sur couleur, mouvement, strobe, gobo… déjà écrits.
          const blackoutActive = blackoutOverrides?.get(pf.id);
          if (blackoutActive) {
            if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = 0;
            for (const seg of fa.rgbSegments) {
              chVals[pf.startAddress + seg.r] = 0;
              if (seg.g !== null) chVals[pf.startAddress + seg.g] = 0;
              if (seg.b !== null) chVals[pf.startAddress + seg.b] = 0;
              if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
            }
            if (fa.shutterOffset !== null) chVals[pf.startAddress + fa.shutterOffset] = 0;
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
            // ── Cible de scène (aiming 3D) : priorité sur l'autoscript,
            // sous le chaser. Quand une cible est définie pour la fixture,
            // les pan/tilt sont calculés par solvePanTilt pour viser le point
            // 3D, pas par un pattern abstrait.
            let aimWritten = false;
            if (hasSceneAim(pf.id)) {
              const aimPos = fixturePositions?.[pf.id];
              if (aimPos) {
                const aim = computeAimDMX(
                  aimPos.x,
                  aimPos.y,
                  aimPos.h ?? 0,
                  getSceneAim(pf.id)!,
                  aimPos.heading ?? 0,
                  aimPos.mountMode ?? 'top',
                  aimPos.zeroPan,
                  aimPos.zeroTilt
                );
                if (aim) {
                  for (const po of fa.panOffsets) chVals[pf.startAddress + po] = aim.pan;
                  for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = aim.tilt;
                  chaserHoldRef.current.set(pf.id, { pan: aim.pan, tilt: aim.tilt });
                  aimWritten = true;
                }
              }
            }
            if (aimWritten) {
              // Cible appliquée : sauter le mouvement autoscript ci-dessous.
            } else if (chaserOwnsFixture) {
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
                  // Section name → getSectionMovement : le PATTERN est identique
                  // pour toutes les têtes mobiles (harmonie de look) — la
                  // géométrie vient du spatialPhaseFor (déphasage sur le rig).
                  // Explicit pattern names pass through directly
                  const cueMov = active.movement;
                  if (cueMov) {
                    const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
                    if (!explicitPatterns.has(cueMov)) {
                      // Section name → smart distribution (par section, pas par tête)
                      return getSectionMovement(cueMov, ct);
                    }
                    // Explicit pattern — distribue pour les tiers non-primaires pour éviter le mur uni
                    if (pf.tier !== 'primary') {
                      return getSectionMovement(cueMov, ct);
                    }
                    return cueMov; // explicit pattern
                  }
                  // Fallback: smart distribution based on section (par section)
                  return getSectionMovement(sec, ct);
                })();
              // Une fixture « capturée » doit continuer à bouger autour de sa
              // target même pendant les sections calmes (intro/outro/bridge) :
              // le pattern 'static' quasi immobile est remplacé par un doux cercle
              // centré sur le point capturé.
              const capturedFx = fixturePositions?.[pf.id];
              const capturedCenter = !!capturedFx && (
                (capturedFx.centerPan !== undefined && capturedFx.centerPan !== 0) ||
                (capturedFx.centerTilt !== undefined && capturedFx.centerTilt !== 0)
              );
              const effPattern = (capturedCenter && (movPattern === 'static')) ? 'circle' : movPattern;
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
// Centre du mouvement par fixture : posé par « Capturer » (centerPan/centerTilt),
              // appliqué que le cue ait unPattern (amplitude>0) ou non. Le zéro visuel
              // (zeroPan/zeroTilt) n'existe que dans le rendu 3D.
              const zpos = fixturePositions?.[pf.id];
                const zeroPd = zpos ? zeroDmxOffset(zpos.centerPan, 'pan') : 0;
                const zeroTd = zpos ? zeroDmxOffset(zpos.centerTilt, 'tilt') : 0;
              if(amplitude>0){
                // Boucle de mouvement section-aware (engine/autoscript-loops) :
                // la cue porte les bornes de sa section → la trajectoire est
                // lue dans une vraie boucle (échantillonnage anti-aliasé,
                // cycles verrouillés sur les beats, raccord de fin de section).
                // Sans bornes (anciens presets) → calcul analytique historique.
                const moveLoop = !trackMovement ? sectionMoveFor(active as any, motorCount) : null;
                const loopPhase01 = moveLoop ? sectionPhase01(active as any, ct) : 0;
                const loopOffset = moveLoop ? phaseToIndexOffset(
                  (trackMovement ? 0 : movementPhase) +
                  (spatialPattern && !trackMovement ? spatialPhaseFor(fixturePositions?.[pf.id], spatialPattern, mobileIdx) : 0),
                  moveLoop,
                ) : 0;
                for(let m=0;m<motorCount;m++){const motorPhase=m*(Math.PI*2/motorCount);const speedMult=Math.max(0.1,Math.min(2.5,active.movementSpeed??1));
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
                const [px, py] = moveLoop
                  ? sampleSectionLoop(moveLoop, loopPhase01, m, loopOffset)
                  : evalEffect(effPattern as EffectPattern, phase, 0);
                const pfl = panTiltLimits.perFixture?.[pf.id];
                // Fixture-track movement blocks are user-authored (higher priority than autoscript): do not clamp them.
                const panLimit = trackMovement ? 128 : (pfl?.pan ?? panTiltLimits.pan);
                const tiltLimit = trackMovement ? 128 : (pfl?.tilt ?? panTiltLimits.tilt);
                if(m<panCount){
                  const ampPan = movementAmp(blendAmp, 128 + zeroPd, panLimit);
                  const raw = Math.max(0,Math.min(255,Math.round(128+zeroPd + px*ampPan)));
                  const fp = fixturePositions?.[pf.id];
                  // Fixture avec centre capturé : on ne rencentre PAS vers la zone
                  // de scène (clampPanToStage annulerait le point visé) — on ne
                  // borne que autour du centre capturé.
                  let pv = (zeroPd !== 0 && fp) ? raw : (fp ? clampPanToStage(raw, fp.x) : raw);
                  pv = Math.max(128 + zeroPd - panLimit, Math.min(128 + zeroPd + panLimit, pv));
                  // Zone 180° (option B) : le pan ÉCRIT reste dans ±90° de la
                  // direction par défaut → le matériel ne va jamais derrière.
                  // Une visée délibérée (centre capturé) bypass le clamp.
                  if (!(zeroPd !== 0 && fp)) pv = clampPanZoneDmx(pv, fa.panMaxDeg ?? 540, fp?.zeroPan);
                  chVals[pf.startAddress+fa.panOffsets[m]] = pv;
                  // Canal "fine" 16 bits : la fraction de la position cible
                  // part dans le canal fine (le coarse porte la partie entiere).
                  const panFineOff = fa.panFineOffsets[m] ?? null;
                  if(panFineOff!==null){
                    if(pv===raw){
                      writeAxisPair(chVals, pf.startAddress+fa.panOffsets[m], pf.startAddress+panFineOff, 128+zeroPd + px*ampPan);
                    } else {
                      chVals[pf.startAddress+panFineOff] = 0;
                    }
                  }
                  if (m === 0) chaserHoldRef.current.set(pf.id, { ...(chaserHoldRef.current.get(pf.id) ?? { pan: pv, tilt: 128 }), pan: pv });
                }
                if(m<tiltCount){
                  const ampTilt = movementAmp(blendAmp, 128 + zeroTd, tiltLimit);
                  const raw = Math.max(0,Math.min(255,Math.round(128+zeroTd + py*ampTilt)));
                  const fp = fixturePositions?.[pf.id];
                  let tv = (zeroTd !== 0 && fp) ? raw : (fp ? clampTiltToStage(raw, fp.y) : raw);
                  tv = Math.max(128 + zeroTd - tiltLimit, Math.min(128 + zeroTd + tiltLimit, tv));
                  // Zone TILT moteur (miroir 3D) : ground jamais sous l'horizon.
                  if (!(zeroTd !== 0 && fp)) tv = clampTiltZoneDmx(tv, fa.tiltMaxDeg ?? 180, fp?.mountMode, fp?.tilt, fp?.zeroTilt);
                  chVals[pf.startAddress+fa.tiltOffsets[m]] = tv;
                  // Canal "fine" 16 bits (idem pan).
                  const tiltFineOff = fa.tiltFineOffsets[m] ?? null;
                  if(tiltFineOff!==null){
                    if(tv===raw){
                      writeAxisPair(chVals, pf.startAddress+fa.tiltOffsets[m], pf.startAddress+tiltFineOff, 128+zeroTd + py*ampTilt);
                    } else {
                      chVals[pf.startAddress+tiltFineOff] = 0;
                    }
                  }
                  if (m === 0) chaserHoldRef.current.set(pf.id, { ...(chaserHoldRef.current.get(pf.id) ?? { pan: 128, tilt: tv }), tilt: tv });
                }}
              }else{const fp = fixturePositions?.[pf.id];const mountMode = fp?.mountMode || (fp?.y !== undefined ? (fp.y > 0.75 ? 'rear' : fp.y < 0.25 ? 'ground' : fp.x < 0.25 || fp.x > 0.75 ? 'ground' : 'hanging') : 'top');const mountTd = (mountMode === 'rear' || mountMode === 'ground' || mountMode === 'hanging') ? -64 : 0;for(const po of fa.panOffsets)chVals[pf.startAddress+po]=Math.round(Math.max(0,Math.min(255,128+zeroPd)));for(const pfo of fa.panFineOffsets)if(pfo!==null)chVals[pf.startAddress+pfo]=0;for(const to of fa.tiltOffsets)chVals[pf.startAddress+to]=Math.round(Math.max(0,Math.min(255,128+zeroTd+mountTd)));for(const tfo of fa.tiltFineOffsets)if(tfo!==null)chVals[pf.startAddress+tfo]=0;}
              // Cible manuelle (target depuis la modale 3D) : verrouille pan/tilt
          // tant que l'utilisateur n'a pas reposé la cible ailleurs. Prend le
          // pas sur le mouvement autoscript et sur le neutre 128+zero.
          const manual = manualTargetRef.get(pf.id);
          if (manual) {
            const fp2 = fixturePositions?.[pf.id];
            const mountMode2 = fp2?.mountMode || (fp2?.y !== undefined ? (fp2.y > 0.75 ? 'rear' : fp2.y < 0.25 ? 'ground' : fp2.x < 0.25 || fp2.x > 0.75 ? 'ground' : 'hanging') : 'top');
            const mountTd2 = (mountMode2 === 'rear' || mountMode2 === 'ground' || mountMode2 === 'hanging') ? -64 : 0;
            for (const po of fa.panOffsets) chVals[pf.startAddress + po] = manual.pan;
            for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = Math.max(0, Math.min(255, manual.tilt + mountTd2));
            // Canaux "fine" 16 bits : la cible manuelle est une position
            // entiere → le fine vaut 0 (sinon la tete reste decalee).
            for (const pfo of fa.panFineOffsets) if (pfo !== null) chVals[pf.startAddress + pfo] = 0;
            for (const tfo of fa.tiltFineOffsets) if (tfo !== null) chVals[pf.startAddress + tfo] = 0;
          }
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
              // Régie gobo intelligente (tenues + repos), déterministe par
              // temps → stable entre 2 frames à 60 fps (aucun scintillement).
              chVals[gAddr]=computeGoboValue(fa.goboCaps, ct, {
                bpm: (active as any)?.bpm ?? 120,
                energy: fxEnergy,
                seed: 1000 + pf.startAddress,
              });
            }else{
              chVals[gAddr]=0; // canal gobo sans caps → position basse stable
            }
          }
          if(fa.prismOffset!==null){const pAddr=pf.startAddress+fa.prismOffset;
            // Valeur ramenee dans une cap reelle (ex. Open 0-9 / Prism In
            // 10-63 / CW 64-159) : sinon le prisme reste en rotation CW.
            chVals[pAddr]=snapValueToCaps(64+Math.sin(fxPhase2*0.7)*128*fxEnergy, fa.prismCaps);
          }
          if(fa.zoomOffset!==null){const zAddr=pf.startAddress+fa.zoomOffset;
            chVals[zAddr]=snapValueToCaps(64+Math.sin(fxPhase2*0.4)*96*(_fxP[1]+(_fxP[2]-_fxP[1])*fxEnergy)+64*fxEnergy, fa.zoomCaps);
          }
          if(fa.frostOffset!==null){const fAddr=pf.startAddress+fa.frostOffset;
            chVals[fAddr]=snapValueToCaps((255-fxEnergy*255)*(1-_fxP[3])+_fxP[3]*200, fa.frostCaps);
          }
          if(fa.irisOffset!==null){const iAddr=pf.startAddress+fa.irisOffset;
            chVals[iAddr]=snapValueToCaps(40+fxEnergy*200+Math.sin(fxPhase2*0.5)*15*fxEnergy, fa.irisCaps);
          }
          if(fa.focusOffset!==null){const fcAddr=pf.startAddress+fa.focusOffset;
            chVals[fcAddr]=snapValueToCaps(80+fxEnergy*120+Math.sin(fxPhase2*0.3)*30, fa.focusCaps);
          }

          // ── Canaux à capacités sans rôle dédié ───────────────────────
          // Rotation, polarité, direction, taille de motif… : ces canaux
          // n'ont pas de rôle dédié mais portent un ETAT (mode, vitesse,
          // sens). On leur écrit un état déterministe et connu plutôt que
          // de laisser le hardware figé sur une valeur arbitraire.
          writeCapabilityChannels(chVals, pf.startAddress, fa);

          // ── Canaux couleur AUXILIAIRES (orange, violet, bleu de fond) ──
          // Éteints (0) : les allumer ajouterait une couleur non demandée
          // et modifierait la couleur du show (validée par l'utilisateur).
          writeAuxColourChannels(chVals, pf.startAddress, fa);

          // ── Canaux nominaux (rôle deduit du LIBELLE) ───────────────
          // 2e zoom qui suit le 1er, 2e roue de gobo a l'etat neutre,
          // vitesse/rotation animees : plus aucun canal « parlant » muet.
          writeNominalChannels(chVals, pf.startAddress, fa, {
            time: ct,
            energy: effectiveEnergy,
          });

          // ── Octets LSB 16 bits (canaux « fine » apparies) ──────────
          // Le coarse porte une valeur entiere -> son LSB vaut 0. On
          // l'ecrit explicitement pour que la fixture lise une valeur
          // 16 bits stable (et non une valeur arbitraire).
          writeFinePairs(chVals, pf.startAddress, fa);

          // ─── Laser : bloc live du tick (même logique que computeDmxForCue) ───
          // Le tick principal ne calculait AUCUN canal laser (mode/pattern/scan/
          // rotations/vitesses/blank) : en lecture QuickShow/AutoScript, le mode
          // restait sur « Laser off » — d'où « ça ne fait rien, ou une apparition
          // brève au crossfade » (le bloc n'existait que dans computeDmxForCue,
          // appelé uniquement lors des fondus < 0,3 s). Appliqué à chaque frame.
          if (fa.isLaser) {
            if (_fixtureInactive || blackoutActive) {
              // Fixture hors tiers actifs OU en blackout : eteindre TOUS les
              // canaux laser (mode, pattern, scan, rotation, blanking, gates
              // couleur) pour que le laser ne reste pas allume. Avant, le bloc
              // laser réécrivait le master après le blackout → le faisceau
              // réapparaissait pendant un blackout.
              if (fa.laserModeOffset !== null) chVals[pf.startAddress + fa.laserModeOffset] = 0;
              if (fa.laserMasterOffset !== null) chVals[pf.startAddress + fa.laserMasterOffset] = 0;
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

        // ── Takeover final (dernière écriture, après blend + fade) ──
        // Les sections (chaser < show < scene) reçoivent leurs canaux en dernier :
        // rien ne peut ré-injecter l'autoscript par-dessus.
        const mergeFrame = (map: Map<string, Record<number, number>>) => {
          if (map.size === 0) return;
          for (const fa of fixtures) {
            const pfx = fa.fixture;
            const cmap = map.get(pfx.id);
            if (!cmap) continue;
            const base = pfx.startAddress, limit = base + pfx.channelCount;
            for (const addrStr in cmap) {
              const addr = Number(addrStr);
              if (addr >= base && addr < limit) chVals[addr] = cmap[addrStr];
            }
          }
        };
        mergeFrame(chaserCtlFrame);
        mergeFrame(showCtlFrame);
        mergeFrame(sceneCtlFrame);

        // ── Freeze pan/tilt non couverts ──
        // Une scène ne fige que les canaux qu'elle contient : sans ça, les axes
        // pan/tilt que la section n'a pas capturés continuent d'être animés par
        // l'autoscript (→ « la couleur se pose mais ça bouge toujours »). Dès
        // qu'une section contrôle une fixture, on verrouille donc ses pan/tilt :
        // valeur de la section si elle les définit, sinon valeur d'entrée figée
        // pendant toute la durée de la section (latch relâché à la fin).
        if (chaserCtlFrame.size + showCtlFrame.size + sceneCtlFrame.size > 0) {
          const takeFids = new Set<string>();
          for (const m of [chaserCtlFrame, showCtlFrame, sceneCtlFrame]) for (const k of m.keys()) takeFids.add(k);
          if (takeFids.size > 0) {
            let lock = (tick as any)._ptLock as Map<string, Map<number, number>> | undefined;
            if (!lock) { lock = new Map(); (tick as any)._ptLock = lock; }
            for (const k of lock.keys()) if (!takeFids.has(k)) lock.delete(k);
            for (const fa of fixtures) {
              const fid = fa.fixture.id;
              if (!takeFids.has(fid)) continue;
              const base = fa.fixture.startAddress;
              const pmC = chaserCtlFrame.get(fid), pmS = showCtlFrame.get(fid), pmN = sceneCtlFrame.get(fid);
              const ctrl = (pmC || pmS || pmN) ? { ...(pmC || {}), ...(pmS || {}), ...(pmN || {}) } : undefined;
              const addrs: number[] = [];
              for (const o of fa.panOffsets) addrs.push(base + o);
              if (fa.panOffset !== null && !addrs.includes(base + fa.panOffset)) addrs.push(base + fa.panOffset);
              for (const o of fa.tiltOffsets) addrs.push(base + o);
              if (fa.tiltOffset !== null && !addrs.includes(base + fa.tiltOffset)) addrs.push(base + fa.tiltOffset);
              for (const addr of addrs) {
                if (ctrl && ctrl[addr] !== undefined) continue; // la section pilote cet axe
                let fm = lock.get(fid);
                if (!fm) { fm = new Map(); lock.set(fid, fm); }
                if (!fm.has(addr)) fm.set(addr, chVals[addr] ?? 128);
                chVals[addr] = fm.get(addr)!;
              }
            }
          }
        }

        // Apply scene live overrides (master dimmer, per-fixture dimmer, master color)
        // These are global multipliers applied on top of all playback sources.
        // Lit DIRECTEMENT depuis l'appStore (le ref optionnel n'était câblé
        // nulle part → les faders LIVE de la console virtuelle n'avaient aucun
        // effet). getState() est peu coûteux et reste cohrent à chaque frame.
        {
          const overrides = sceneLiveOverridesRef?.current ?? useAppStore.getState().sceneLiveOverrides;
          const masterDimmer = overrides?.masterDimmer ?? 255;
          const perFixtureDimmer = overrides?.perFixtureDimmer ?? {};
          const masterColor = overrides?.masterColor ?? null;
          let mcr = -1, mcg = -1, mcb = -1;
          if (masterColor && /^#[0-9a-fA-F]{6}$/.test(masterColor)) {
            mcr = parseInt(masterColor.slice(1, 3), 16);
            mcg = parseInt(masterColor.slice(3, 5), 16);
            mcb = parseInt(masterColor.slice(5, 7), 16);
          }

          if (masterDimmer !== 255 || Object.keys(perFixtureDimmer).length > 0 || mcr >= 0) {
            for (const fa of fixtures) {
              const fid = fa.fixture.id;
              const pfDimmer = perFixtureDimmer[fid];
              const dimmerMul = pfDimmer !== undefined
                ? pfDimmer / 255
                : masterDimmer / 255;

              // Scale all intensity-related channels for this fixture
              const base = fa.fixture.startAddress;

              // ── Couleur maîtresse : TOUTES les fixtures RGB prennent la
              // couleur choisie en un clic (avant le scaling dimmer : la
              // teinte reste stable, seule l'intensité suit les faders).
              if (mcr >= 0) {
                for (const seg of (fa.rgbSegments || [])) {
                  if (seg.r !== null && seg.r !== undefined) chVals[base + seg.r] = mcr;
                  if (seg.g !== null && seg.g !== undefined) chVals[base + seg.g] = mcg;
                  if (seg.b !== null && seg.b !== undefined) chVals[base + seg.b] = mcb;
                  // W coupé pour préserver la teinte (RGBW) — le blanc pur
                  // (#ffffff) reste rendu par R+G+B à fond.
                  if (seg.w !== null && seg.w !== undefined) chVals[base + seg.w] = 0;
                }
              }

              // Main intensity channel
              if (fa.intensityOffset !== null) {
                const addr = base + fa.intensityOffset;
                if (chVals[addr] !== undefined) {
                  chVals[addr] = Math.round(chVals[addr] * dimmerMul);
                }
              }
              // LED intensity channels (multi-head)
              for (const li of (fa.ledIntensityOffsets || [])) {
                const addr = base + li;
                if (chVals[addr] !== undefined) {
                  chVals[addr] = Math.round(chVals[addr] * dimmerMul);
                }
              }
              // RGB segments (scale color values proportionally)
              for (const seg of (fa.rgbSegments || [])) {
                for (const ch of [seg.r, seg.g, seg.b, seg.w].filter(v => v !== null && v !== undefined)) {
                  const addr = base + ch;
                  if (chVals[addr] !== undefined) {
                    chVals[addr] = Math.round(chVals[addr] * dimmerMul);
                  }
                }
              }
              // Color wheel / laser gates
              if (fa.isLaser) {
                if (fa.laserColorGateOffset !== null) {
                  const addr = base + fa.laserColorGateOffset;
                  if (chVals[addr] !== undefined) {
                    chVals[addr] = Math.round(chVals[addr] * dimmerMul);
                  }
                }
                if (fa.laserMasterOffset !== null) {
                  const addr = base + fa.laserMasterOffset;
                  if (chVals[addr] !== undefined) {
                    chVals[addr] = Math.round(chVals[addr] * dimmerMul);
                  }
                }
              }
            }
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
  // Master/power switch : toujours OUVERT (cap non-off), sinon le laser risque
  // de rester éteint faute de valeur écrite (0 = OFF sur beaucoup de defs).
  // La valeur écrite est le MAX de la cap « ON » (et non son milieu) : un
  // master à mi-course = laser à 50 % de puissance en permanence.
  if (fa.laserMasterOffset !== null) {
    const masterOn = fa.laserMasterCaps.find(c => !/off|closure|closed|stop/i.test(c.name ?? ''))
      ?? fa.laserMasterCaps.find(c => c.min > 0)
      ?? fa.laserMasterCaps[0];
    chVals[pf.startAddress + fa.laserMasterOffset] = options?.blankWhenStrobe
      ? 0
      : (masterOn ? Math.max(0, Math.min(255, masterOn.max)) : 255);
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
  fixturePositions?: Record<string, { x: number; y: number; h?: number; zeroPan?: number; zeroTilt?: number; centerPan?: number; centerTilt?: number; mountMode?: string; tilt?: number; heading?: number }>,
   chaserTakeover?: Map<string, Record<number, number>>,
   strobeLimit?: number,
): Array<{ universe: number; channelValues: Record<number, number> }> {
  const uniIds = universes.map(u => String(u.id));
  const analyses: ChannelAnalysis[] = [];
  for (const pf of patchedFixtures) {
    const def = fixtureDefs.get(pf.fixtureDefId);
    const fa = analyzeChannels(pf, def);
    // Univers inexistant → fixture ignorée (pas de parasite sur l'univers 0).
    fa.universeIndex = pf.universeId ? uniIds.indexOf(String(pf.universeId)) : 0;
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
  // Enveloppe CONTINUE du dimmer (autoscript) : même source que le rejeu
  // live, échantillonnée au temps de la cue → le crossfade et la vue 3D
  // montrent exactement le même dimmer que la sortie matérielle.
  const envelopeDimmerLevel = (() => {
    const env = getSectionEnvelope((cue as any).envId);
    if (!env) return undefined;
    const s = (cue as any).sectionStart;
    const e = (cue as any).sectionEnd;
    if (typeof s !== 'number' || typeof e !== 'number') return undefined;
    const v = sampleCurve(env.dimmer, s, e, cue.time ?? 0);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;
  })();
  const sectionDimmerFloor = SECTION_MIN_INTENSITY[sec] ?? 60;

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
        : envelopeDimmerLevel !== undefined
          ? Math.max(
            Math.round(255 * envelopeDimmerLevel * tierIntensityMultiplier(pf.tier, tierMultipliers)),
            sectionDimmerFloor,
          )
          : mapIntensity(cue.intensity, energy, pf.tier, tierMultipliers);
      // Dimmer track override (highest priority for intensity)
      const dimmerOverride = dimmerTrackOverrides?.get(pf.id);
      if (dimmerOverride) {
        dimmerVal = Math.round(255 * dimmerOverride.value / 100);
      }
      if (fa.intensityOffset !== null) {
        const addr = pf.startAddress + fa.intensityOffset;
        if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = mapIntensityVal(dimmerVal, fa);
      }
       // Propagate intensity to ALL intensity channels (multi-head fixtures: spider, LED bar heads 2..N)
       // Main intensity channel already written above; this ensures LED heads 2..N stay in sync.
       for (const li of (fa.ledIntensityOffsets || [])) chVals[pf.startAddress + li] = dimmerVal;

      // Color track > fixture track > cue color
      let paletteColor = (colorTrackColors?.has(pf.id))
        ? colorTrackColors.get(pf.id)!
        : (fixtureTrackOverrides?.forcedColors?.has(pf.id))
        ? fixtureTrackOverrides.forcedColors.get(pf.id)!
        : (() => {
          return (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined;
        })();

      // RGB-only sans canal intensité : une piste dimmer visible exige une
      // couleur à scaler — fallback blanc quand la cue n'en fournit pas.
      let effPaletteColor = paletteColor;
      if (!effPaletteColor && dimmerOverride && fa.intensityOffset === null && fa.rgbSegments.length > 0) {
        effPaletteColor = '#ffffff';
      }

      if (fa.rgbSegments.length > 0 && effPaletteColor) {
        let [r, g, b] = hexToRgb(effPaletteColor);
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
            // RGBW : composante achromatique vers le canal W (couleur
            // identique, 4 canaux pilotes au lieu de 3).
            let sr=pr,sg=pg,sb=pb,sw=0;
            if (seg.w !== null) { const sp=splitRgbw(pr,pg,pb,seg.b!==null); sr=sp.r; sg=sp.g; sb=sp.b; sw=sp.w; }
            // Coarse + LSB 16 bits.
            writeRgbSegment(chVals, pf.startAddress, seg, sr, sg, sb, sw);
          }
        }
        // Gates couleur laser (« Red laser », « Green laser ») : binaire 0/255.
        writeLaserGates(chVals, pf.startAddress, fa, effPaletteColor);
        // Apply dimmer track/cue dimmer to RGB when no dedicated intensity channel
        if (fa.intensityOffset === null) {
          const dScale = dimmerVal / 255;
          for (const seg of fa.rgbSegments) {
            scaleRgbSegment(chVals, pf.startAddress, seg, dScale);
          }
        }
        // Exploit remaining generic channels pour snapshot (même logique que tick live, base cue.time)
        // → déplacé hors de la branche RGB (voir bloc commun plus bas).
      } else if (fa.wheelOffset !== null && paletteColor && (() => {
        // Snapshot path : ne pas écraser la couleur du chaser (roue) par l'autoscript
        const cmap = chaserTakeover?.get(pf.id);
        if (!cmap) return true;
        return cmap[pf.startAddress + fa.wheelOffset] === undefined;
      })()) {
        const caps = fa.wheelCaps;
        const degPos = wheelDegeneratePosition(caps, fa, paletteColor, (cue as any).time ?? 0);
        if (degPos !== null) {
          chVals[pf.startAddress + fa.wheelOffset] = degPos;
        } else {
        let wheelVal: number;
        if (caps.length > 0) {
          const bestCap = findBestWheelCap(caps, paletteColor);
          wheelVal = bestCap ? Math.round((bestCap.min + bestCap.max) / 2) : (() => {const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;const capIdx=Math.floor(wPos*caps.length)%caps.length;return Math.round((caps[capIdx].min+caps[capIdx].max)/2);})();
        } else {
          const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;wheelVal=Math.round(wPos*255);
        }
        chVals[pf.startAddress + fa.wheelOffset] = wheelVal;
        }
      }

      // Couleur effective (meme decalage de tier que la branche RGB) :
      // partagee par les écritures CMY et pixels blancs.
      const effPaletteRgb = (hex: string): [number, number, number] => {
        let [rr, gg, bb] = hexToRgb(hex);
        if (!colorTrackColors?.has(pf.id)) {
          [rr, gg, bb] = applyHueShift([rr, gg, bb], TIER_HUE[pf.tier]);
        }
        return [rr, gg, bb];
      };

      // ── Fixture CMY (Cyan / Magenta / Yellow) ─────────────────
      // Couleur soustractive : C=255-R, M=255-G, Y=255-B.
      if (fa.cmyOffsets.c !== null || fa.cmyOffsets.m !== null || fa.cmyOffsets.y !== null) {
        const [cr, cg, cb] = effPaletteColor ? effPaletteRgb(effPaletteColor) : [255, 255, 255];
        writeCmyChannels(chVals, pf.startAddress, fa, cr, cg, cb);
      }

      // ── Pixels blancs autonomes ───────────────────────────────
      // Composante achromatique de la palette (min R,G,B).
      if (fa.whitePixels.length > 0) {
        const [wr, wg, wb] = effPaletteColor ? effPaletteRgb(effPaletteColor) : [255, 255, 255];
        writeWhitePixels(chVals, pf.startAddress, fa, wr, wg, wb);
      }

      // ── Canaux couleur en doublon (2e zone / LED) ─────────────
      if (fa.extraColourChannels.length > 0) {
        const [er, eg, eb] = effPaletteColor ? effPaletteRgb(effPaletteColor) : [255, 255, 255];
        const dScaleX = fa.intensityOffset === null ? dimmerVal / 255 : 1;
        writeExtraColourChannels(chVals, pf.startAddress, fa, er, eg, eb, dScaleX);
      }

      // ── Canaux génériques (Effect / Speed / Beam) ───────────────────
      // Hors de la branche RGB : une fixture à roue (moving head classique)
      // n'avait jamais son canal Effect/Speed/Beam écrit.
      if(fa.effectOffset!==null){
        const caps = fa.effectCaps;
        if(caps&&caps.length>0){
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
      fa.speedOffsets.forEach((off,i)=>{
        const phase = ((cue as any).time ?? 0)*3 + i*0.9;
        chVals[pf.startAddress+off]= Math.max(0, Math.min(255, Math.round(50 + energy*150 + Math.sin(phase)*10)));
      });
      if(fa.beamOffset!==null && chVals[pf.startAddress+fa.beamOffset]===undefined){
        chVals[pf.startAddress+fa.beamOffset]= Math.round(100 + energy*80);
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
          const speed = Math.min(strobeTrackStrobe?.speed || trackStrobe?.speed || (cue as any).strobeSpeed || 10, clampStrobeLimit(strobeLimit ?? 10));
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
          const speed2 = Math.min(strobeTrackStrobe2?.speed || trackStrobe2?.speed || (cue as any).strobeSpeed || 10, clampStrobeLimit(strobeLimit ?? 10));
          // Même mapping que le live : la limite photosensible est respectée.
          chVals[stAddr2] = Math.min(250, Math.max(8, Math.round(speed2 * 255 / 30)));
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
            // Parité avec le live : l'amplitude de la cue est modulée par le tier
            // (primary 100 %, secondary 72 %, tertiary 42 %) — avant, le preset
            // matérialisé bougeait plus fort que le live.
            ? Math.min(128, Math.max(0, Math.round((cue as any).movementAmplitude * (pf.tier === 'primary' ? 1 : pf.tier === 'secondary' ? 0.72 : 0.42))))
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
          // Boucle de mouvement section-aware (même kernel que le live) :
          // la matérialisation d'un preset suit donc exactement le rendu live.
          const moveLoop = !trackMovement ? sectionMoveFor(cue as any, motorCount) : null;
          const loopPhase01 = moveLoop ? sectionPhase01(cue as any, cue.time) : 0;
          const loopOffset = moveLoop
            ? phaseToIndexOffset(
                spatialPattern && !trackMovement ? spatialPhaseFor(fixturePositions?.[pf.id], spatialPattern, mobileIdx) : 0,
                moveLoop,
              )
            : 0;
          for (let m = 0; m < motorCount; m++) {
            const motorPhase = m * (Math.PI * 2 / motorCount);
          const movSec = (() => {
              if (trackMovement) return trackMovement.pattern;
              // Section name → getSectionMovement : PATTERN identique pour
              // toutes les têtes (harmonie), déphasage via spatialPhaseFor.
              const cueMov = (cue as any).movement;
              if (cueMov) {
                const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
                if (!explicitPatterns.has(cueMov)) {
                  return getSectionMovement(cueMov, cue.time);
                }
                return cueMov;
              }
              return getSectionMovement(sec, cue.time);
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
            // Source de vérité : la boucle section-aware (normalisée, raccordée)
            // quand la cue porte ses bornes, sinon le calcul analytique ci-dessus.
            if (moveLoop) {
              [px, py] = sampleSectionLoop(moveLoop, loopPhase01, m, loopOffset);
            }
            if (m < panCount) {
              const rp = fixturePositions?.[pf.id];
              const zPd = zeroDmxOffset(rp?.centerPan, 'pan');
              const ampPan = movementAmp(amplitude, 128 + zPd, 128);
              const raw = Math.max(0, Math.min(255, Math.round(128 + zPd + px * ampPan)));
              const fp = fixturePositions?.[pf.id];
              let pv = (zPd !== 0 && fp) ? raw : (fp ? clampPanToStage(raw, fp.x) : raw);
              // Zone 180° moteur (option B) — bypass si centre capturé (visée délibérée)
              if (!(zPd !== 0 && fp)) pv = clampPanZoneDmx(pv, fa.panMaxDeg ?? 540, fp?.zeroPan);
              chVals[pf.startAddress + fa.panOffsets[m]] = pv;
              // Canal "fine" 16 bits : la fraction de la cible part dans le fine.
              const pFine = fa.panFineOffsets[m] ?? null;
              if (pFine !== null) {
                if (pv === raw) writeAxisPair(chVals, pf.startAddress + fa.panOffsets[m], pf.startAddress + pFine, 128 + zPd + px * ampPan);
                else chVals[pf.startAddress + pFine] = 0;
              }
            }
            if (m < tiltCount) {
              const rp = fixturePositions?.[pf.id];
              const zTd = zeroDmxOffset(rp?.centerTilt, 'tilt');
              const ampTilt = movementAmp(amplitude, 128 + zTd, 128);
              const raw = Math.max(0, Math.min(255, Math.round(128 + zTd + py * ampTilt)));
              const fp = fixturePositions?.[pf.id];
              let tv = (zTd !== 0 && fp) ? raw : (fp ? clampTiltToStage(raw, fp.y) : raw);
              // Zone TILT moteur (miroir 3D) — bypass si centre capturé
              if (!(zTd !== 0 && fp)) tv = clampTiltZoneDmx(tv, fa.tiltMaxDeg ?? 180, fp?.mountMode, fp?.tilt, fp?.zeroTilt);
              chVals[pf.startAddress + fa.tiltOffsets[m]] = tv;
              // Canal "fine" 16 bits (idem pan).
              const tFine = fa.tiltFineOffsets[m] ?? null;
              if (tFine !== null) {
                if (tv === raw) writeAxisPair(chVals, pf.startAddress + fa.tiltOffsets[m], pf.startAddress + tFine, 128 + zTd + py * ampTilt);
                else chVals[pf.startAddress + tFine] = 0;
              }
            }
          }
        } else {
          for (const po of fa.panOffsets) chVals[pf.startAddress + po] = 128;
          for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = 128;
          for (const pfo of fa.panFineOffsets) if (pfo !== null) chVals[pf.startAddress + pfo] = 0;
          for (const tfo of fa.tiltFineOffsets) if (tfo !== null) chVals[pf.startAddress + tfo] = 0;
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
          // Régie gobo intelligente (tenues + repos), jamais énergie*255 qui
          // déclencherait les slots macro du canal.
          chVals[gAddr] = computeGoboValue(fa.goboCaps, cue.time, {
            bpm: (cue as any)?.bpm ?? 120,
            energy: fxEnergy,
            seed: 1000 + pf.startAddress,
          });
        } else {
          chVals[gAddr] = 0; // canal gobo sans caps → position basse stable (jamais de macro)
        }
      }

      if (fa.prismOffset !== null) {
        chVals[pf.startAddress + fa.prismOffset] = snapValueToCaps(64 + Math.sin(fxPhase2 * 0.7) * 128 * fxEnergy, fa.prismCaps);
      }

      if (fa.zoomOffset !== null) {
        chVals[pf.startAddress + fa.zoomOffset] = snapValueToCaps(64 + Math.sin(fxPhase2 * 0.4) * 96 * (_fxP[1] + (_fxP[2] - _fxP[1]) * fxEnergy) + 64 * fxEnergy, fa.zoomCaps);
      }

      if (fa.frostOffset !== null) {
        chVals[pf.startAddress + fa.frostOffset] = snapValueToCaps((255 - fxEnergy * 255) * (1 - _fxP[3]) + _fxP[3] * 200, fa.frostCaps);
      }

      if (fa.irisOffset !== null) {
        chVals[pf.startAddress + fa.irisOffset] = snapValueToCaps(40 + fxEnergy * 200 + Math.sin(fxPhase2 * 0.5) * 15 * fxEnergy, fa.irisCaps);
      }

      if (fa.focusOffset !== null) {
        chVals[pf.startAddress + fa.focusOffset] = snapValueToCaps(80 + fxEnergy * 120 + Math.sin(fxPhase2 * 0.3) * 30, fa.focusCaps);
      }

      // Canaux à capacités sans rôle dédié : état déterministe écrit.
      writeCapabilityChannels(chVals, pf.startAddress, fa);

      // Canaux couleur auxiliaires : éteints (0) — la couleur du show est
      // validée par l'utilisateur, on n'ajoute aucune couleur.
      writeAuxColourChannels(chVals, pf.startAddress, fa);

      // Canaux nominaux (rôle deduit du LIBELLE) + octets LSB 16 bits.
      writeNominalChannels(chVals, pf.startAddress, fa, {
        time: cue.time ?? 0,
        energy,
      });
      writeFinePairs(chVals, pf.startAddress, fa);

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