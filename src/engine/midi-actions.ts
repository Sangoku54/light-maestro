/**
 * MIDI Actions — actions renderer déclenchées par `midi:trigger` (M3 du plan MIDI).
 *
 * Le main (electron/main.ts L326-340) gère DÉJÀ directement, zéro IPC :
 *   - dmx-channel → dmxEngine.setChannel
 *   - blackout     → dmxEngine.blackout()/restore()
 *   - grandMaster  → dmxEngine.applyGrandMaster()
 * Tout ce qui vit côté renderer (scènes, chasers, cue lists, autoscript,
 * widgets) est dispatché ici depuis useMidiTriggers() (src/hooks/midi-trigger.ts).
 *
 * Sources arbiter dédiées :
 *   - 'midi'          (LTP 75) → scènes + cue lists
 *   - 'midi-chaser'   (LTP 75) → chasers
 *   - 'remote'        (LTP 70) → scènes (Remote web LAN, lot #17)
 *   - 'remote-chaser' (LTP 70) → chasers (Remote web LAN, lot #17)
 * Priorité 75 = juste sous le Virtual Console ('vc', 80) : un bouton VC
 * physique l'emporte sur un trigger MIDI sur les mêmes canaux ; au-dessus de
 * 'default' (50) et des sources HTP (quickshow 40, song-preset 45...).
 * Remote est sous MIDI (70) : un trigger MIDI concurrent reprend la main sur
 * une commande web, qui reste elle-même au-dessus de 'default' et des HTP.
 *
 * DETTE DOCUMENTÉE (backlog) : le moteur vivant scènes/chasers (fades, hold,
 * loop) est encapsulé dans VCButtonWidget (performanceview.tsx ~L1490-1900)
 * et n'est PAS réutilisable tel quel (refs + closures du composant, fichier
 * en cours de réécriture par l'agent panneau MIDI). Cette implémentation en
 * est un miroir comportemental (fadeIn/hold/fadeOut via RAF, écritures LTP
 * via sendChannelsToHardwareAndStore) sans toucher à performanceview.tsx.
 * Refactor à prévoir : extraire ce moteur dans un module partagé pour
 * supprimer la duplication → backlog « refactor VCButtonWidget ».
 */

import type { SavedChaser } from '../stores/showStore';
import { useShowStore } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';
import { usePerformStore } from '../stores/performStore';
import { sendChannelsToHardwareAndStore } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';

// ─── Contrat de types (miroir de electron/midi/manager.ts L18-38) ─────────
// NOTE : tant que l'agent « MIDI cœur main » n'a pas synchronisé
// src/types.d.ts (et le preload → onTrigger retourne unsubscribe), on écrit
// contre ce contrat local. À resynchroniser ensuite (voir rapport §5).
// L'event émis par le main (electron/main.ts) a la forme
// { mapping, value, rawValue, timestamp } — la cible vit dans mapping.target.

export type MidiTarget =
  | { type: 'dmx-channel'; universe: number; channel: number }
  | { type: 'widget'; widgetId: string; property: string }
  | { type: 'scene'; sceneId: string; action: 'play' | 'stop' | 'toggle' }
  | { type: 'chaser'; chaserId: string; action: 'play' | 'stop' | 'next' | 'previous' }
  | { type: 'cueList'; cueListId: string; action: 'go' | 'back' | 'stop' }
  | { type: 'blackout' }
  | { type: 'grandMaster' }
  | { type: 'autoscript'; action: 'toggle' | 'nextEffect' | 'intensity' };

export interface MidiTriggerEvent {
  /** Payload réel du main (electron/main.ts) : `{ mapping, value, rawValue,
   *  timestamp }` — la cible vit dans `mapping.target` (P0 revue). */
  mapping: {
    target: MidiTarget;
    midiType: 'note' | 'cc' | 'program';
  };
  /** Valeur normalisée par le main (normalizeMidiValue) — 0..127 avec le
   *  midiRange par défaut [0,127]. Les ranges custom (M2) ne sont pas
   *  reflétés ici : on normalise sur 127 (voir dette §5 du rapport). */
  value: number;
  /** Velocity/CC brut 0..127 ; undefined pour un Program Change. */
  rawValue: number;
  timestamp: number;
}

// ─── Sources arbiter dédiées ──────────────────────────────────────────────

export const MIDI_SOURCE_ID = 'midi'; // scènes + cue lists
export const MIDI_CHASER_SOURCE_ID = 'midi-chaser'; // chasers
export const REMOTE_SOURCE_ID = 'remote'; // scènes — Remote web LAN (lot #17)
export const REMOTE_CHASER_SOURCE_ID = 'remote-chaser'; // chasers — Remote web LAN (lot #17)
export const OSC_SOURCE_ID = 'osc'; // scènes — OSC entrant (lot #16)
export const OSC_CHASER_SOURCE_ID = 'osc-chaser'; // chasers — OSC entrant (lot #16)
export const MTC_SOURCE_ID = 'mtc'; // scènes — timecode (lot #15)
export const MTC_CHASER_SOURCE_ID = 'mtc-chaser'; // chasers — timecode (lot #15)

let _sourcesRegistered = false;
function ensureSourcesRegistered(): void {
  if (_sourcesRegistered) return;
  _sourcesRegistered = true;
  // LTP 75 : sous 'vc' (80), au-dessus de 'default' (50) et des HTP.
  dmxBridge.registerSource(MIDI_SOURCE_ID, 'ltp', 75);
  dmxBridge.registerSource(MIDI_CHASER_SOURCE_ID, 'ltp', 75);
  // LTP 70 : sous 'midi' (75), au-dessus de 'default' (50) et des HTP.
  dmxBridge.registerSource(REMOTE_SOURCE_ID, 'ltp', 70);
  dmxBridge.registerSource(REMOTE_CHASER_SOURCE_ID, 'ltp', 70);
  // LTP 71 : entre 'remote' (70) et 'mtc' (72) — un contrôleur OSC (TouchOSC/
  // Lemur) reprend la main sur le web LAN, le timecode et le MIDI physique
  // reprennent la main sur l'OSC.
  dmxBridge.registerSource(OSC_SOURCE_ID, 'ltp', 71);
  dmxBridge.registerSource(OSC_CHASER_SOURCE_ID, 'ltp', 71);
  // LTP 72 : entre 'remote' (70) et 'midi' (75) — un trigger MIDI physique
  // reprend la main sur une cue timecode, qui reprend la main sur le web.
  dmxBridge.registerSource(MTC_SOURCE_ID, 'ltp', 72);
  dmxBridge.registerSource(MTC_CHASER_SOURCE_ID, 'ltp', 72);
}
ensureSourcesRegistered();

function getShowState() {
  const s = useShowStore.getState();
  return {
    scenes: s.scenes,
    chasers: s.chasers,
    fixtures: s.patchedFixtures,
    universes: s.universes,
  };
}

/** Normalise un Record<number, number> (clés string de JSON → number). */
function toChannelMap(record: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [addrStr, val] of Object.entries(record)) {
    const addr = Number(addrStr);
    if (Number.isFinite(addr)) out[addr] = Number(val);
  }
  return out;
}

/** Zéro transitoire (flush hardware + release source ~2 s) puis mirror store.
 *  Même pattern que sdResetAll / VC stop : le matériel reçoit les zéros, puis
 *  la source est relâchée pour que l'engine (quickshow…) reprenne la main. */
function flushZeros(channels: Record<number, number>, sourceId: string): void {
  const { fixtures, universes } = getShowState();
  const zeros: Record<number, number> = {};
  for (const addrStr of Object.keys(channels)) zeros[Number(addrStr)] = 0;
  sendChannelsToHardwareAndStore(zeros, fixtures, universes, sourceId, 2000).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// Scènes — moteur fade in / hold / fade out (miroir VCButtonWidget)
// ═══════════════════════════════════════════════════════════

interface SceneHandle {
  raf: number;
  timer: ReturnType<typeof setTimeout> | null;
  channels: Record<number, number>;
  /** Source arbitre écrivaine ('midi' | 'remote') — sert au stop/toggle. */
  sourceId: string;
}

/** Scènes actuellement jouées (toutes sources) — sert au toggle/stop. */
const activeScenes = new Map<string, SceneHandle>();

function cancelSceneHandle(handle: SceneHandle | undefined): void {
  if (!handle) return;
  if (handle.raf) cancelAnimationFrame(handle.raf);
  if (handle.timer) clearTimeout(handle.timer);
}

/** Écrit le niveau 0..1 de la scène vers hardware + store (source arbitre). */
function applySceneLevel(level: number, channels: Record<number, number>, sourceId: string): void {
  const { fixtures, universes } = getShowState();
  const scaled: Record<number, number> = {};
  for (const [addrStr, val] of Object.entries(channels)) {
    scaled[Number(addrStr)] = Math.round(Number(val) * level);
  }
  sendChannelsToHardwareAndStore(scaled, fixtures, universes, sourceId).catch(() => {});
}

export function midiPlayScene(sceneId: string, sourceId: string = MIDI_SOURCE_ID): void {
  ensureSourcesRegistered();
  const { scenes } = getShowState();
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) {
    console.warn(`[midi] scene introuvable : ${sceneId}`);
    return;
  }
  const channels = toChannelMap(scene.channels);
  if (Object.keys(channels).length === 0) {
    console.warn(`[midi] scene "${scene.name}" (${sceneId}) : aucun canal enregistré`);
    return;
  }

  // Une nouvelle lecture remplace la lecture en cours de cette scène
  cancelSceneHandle(activeScenes.get(sceneId));
  const handle: SceneHandle = { raf: 0, timer: null, channels, sourceId };
  activeScenes.set(sceneId, handle);

  const fadeIn = Math.max(0, scene.fadeIn || 0);
  const fadeOut = Math.max(0, scene.fadeOut || 0);
  // Durée = fenêtre totale Y COMPRIS les fades (0 = maintien infini)
  const infinite = !scene.duration || scene.duration <= 0;
  const hold = infinite ? 0 : Math.max(0, scene.duration - fadeIn - fadeOut);

  const done = () => {
    activeScenes.delete(sceneId);
    flushZeros(channels, sourceId);
  };

  const scheduleFadeOut = (delay: number) => {
    handle.timer = setTimeout(() => {
      if (fadeOut > 0) {
        const start = performance.now();
        const anim = () => {
          const p = Math.min(1, (performance.now() - start) / fadeOut);
          applySceneLevel(1 - p, channels, sourceId);
          if (p < 1) handle.raf = requestAnimationFrame(anim);
          else done();
        };
        handle.raf = requestAnimationFrame(anim);
      } else {
        done();
      }
    }, delay);
  };

  if (fadeIn > 0) {
    const start = performance.now();
    const anim = () => {
      const p = Math.min(1, (performance.now() - start) / fadeIn);
      applySceneLevel(p, channels, sourceId);
      if (p < 1) handle.raf = requestAnimationFrame(anim);
      else {
        applySceneLevel(1, channels, sourceId);
        if (!infinite) scheduleFadeOut(hold);
      }
    };
    handle.raf = requestAnimationFrame(anim);
  } else {
    applySceneLevel(1, channels, sourceId);
    if (!infinite) scheduleFadeOut(hold);
  }
  console.debug(
    `[midi] scene play : "${scene.name}" (${sceneId}) fadeIn=${fadeIn}ms hold=${hold}ms fadeOut=${fadeOut}ms source=${sourceId}`
  );
}

export function midiStopScene(sceneId: string): void {
  const handle = activeScenes.get(sceneId);
  if (!handle) {
    console.debug(`[midi] scene stop : rien en cours pour ${sceneId}`);
    return;
  }
  cancelSceneHandle(handle);
  activeScenes.delete(sceneId);
  flushZeros(handle.channels, handle.sourceId);
  console.debug(`[midi] scene stop : ${sceneId}`);
}

export function midiToggleScene(sceneId: string, sourceId: string = MIDI_SOURCE_ID): void {
  if (activeScenes.has(sceneId)) midiStopScene(sceneId);
  else midiPlayScene(sceneId, sourceId);
}

/** Stop de toutes les scènes (utilisé par cueList stop) — flush par source. */
export function midiStopAllScenes(): void {
  if (activeScenes.size === 0) return;
  const bySource = new Map<string, Record<number, number>>();
  for (const handle of activeScenes.values()) {
    cancelSceneHandle(handle);
    const acc = bySource.get(handle.sourceId) ?? {};
    Object.assign(acc, handle.channels);
    bySource.set(handle.sourceId, acc);
  }
  activeScenes.clear();
  for (const [sid, chans] of bySource) flushZeros(chans, sid);
}

// ─── MIDI clock → tempo des chasers (M5) ──────────────────────────────────
// Le hook midi-trigger reçoit midi:clock { bpm, running } du main (manager :
// ignoreTypes(true,false,true) + parse 0xF8) et scale les durées de steps :
// 120 BPM = durée nominale (×1), 240 BPM = ×0,5, 60 BPM = ×2.
// Le scale s'applique aux steps suivants (les timers déjà armés ne sont pas
// recalculés) — v1 documentée, raffinement possible en v2.

let clockBpm = 0;
let clockRunning = false;

export function midiSetClock(bpm: number, running: boolean): void {
  clockBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
  clockRunning = running;
  console.debug(`[midi] clock → ${Math.round(clockBpm)} BPM ${running ? 'running' : 'stopped'}`);
}

/** Facteur de durée : < 1 quand le BPM dépasse 120 (steps plus courts). */
function clockDurationScale(): number {
  return clockRunning && clockBpm > 0 ? 120 / clockBpm : 1;
}

// ═══════════════════════════════════════════════════════════
// Chasers — boucle de steps fade in / hold / fade out (miroir VCButtonWidget)
// ═══════════════════════════════════════════════════════════

interface ChaserHandle {
  timer: ReturnType<typeof setTimeout> | null;
  raf: number;
  stepIndex: number;
  dir: 1 | -1; // sens courant (utile pour direction 'bounce')
  /** Source arbitre écrivaine ('midi-chaser' | 'remote-chaser'). */
  sourceId: string;
}

const activeChasers = new Map<string, ChaserHandle>();

function cancelChaserStep(handle: ChaserHandle): void {
  if (handle.timer) clearTimeout(handle.timer);
  if (handle.raf) cancelAnimationFrame(handle.raf);
  handle.timer = null;
  handle.raf = 0;
}

function nextStepIndex(chaser: SavedChaser, handle: ChaserHandle): number {
  const n = chaser.steps.length;
  if (n === 0) return 0;
  const dir =
    chaser.direction === 'backward' ? -1 :
    chaser.direction === 'bounce' ? handle.dir : 1;
  let idx = (handle.stepIndex + dir) % n;
  if (idx < 0) idx += n;
  if (chaser.direction === 'bounce') {
    if (idx === 0) handle.dir = 1;
    else if (idx === n - 1) handle.dir = -1;
  }
  return idx;
}

function runChaserStep(chaserId: string, startIndex: number, sourceId: string = MIDI_CHASER_SOURCE_ID): void {
  const { chasers, scenes, fixtures, universes } = getShowState();
  const chaser = chasers.find((c) => c.id === chaserId);
  if (!chaser || chaser.steps.length === 0) {
    activeChasers.delete(chaserId);
    return;
  }
  let handle = activeChasers.get(chaserId);
  if (!handle) {
    handle = { timer: null, raf: 0, stepIndex: 0, dir: 1, sourceId };
    activeChasers.set(chaserId, handle);
  } else {
    // Reprise d'un chaser déjà actif : le déclencheur le plus récent devient
    // l'écrivain arbitre (LTP) — un trigger MIDI concurrent reprend la main
    // sur une commande web et inversement.
    handle.sourceId = sourceId;
  }
  cancelChaserStep(handle);
  handle.stepIndex = ((startIndex % chaser.steps.length) + chaser.steps.length) % chaser.steps.length;

  const step = chaser.steps[handle.stepIndex];
  const scene = scenes.find((s) => s.id === step.sceneId);
  if (!scene) {
    // Scène manquante : passer rapidement au step suivant
    handle.timer = setTimeout(() => {
      runChaserStep(chaserId, nextStepIndex(chaser, handle));
    }, 100);
    return;
  }

  const tempoScale = clockDurationScale();
  const fadeIn = Math.max(0, (step.fadeIn ?? scene.fadeIn ?? 0) * tempoScale);
  const fadeOut = Math.max(0, (step.fadeOut ?? scene.fadeOut ?? 0) * tempoScale);
  const hold = Math.max(0, (step.hold ?? (scene.duration > 0 ? Math.max(0, scene.duration - fadeIn - fadeOut) : 500)) * tempoScale);
  const targetChannels = toChannelMap(scene.channels);

  const applyLevel = (level: number) => {
    const scaled: Record<number, number> = {};
    for (const [addrStr, val] of Object.entries(targetChannels)) {
      scaled[Number(addrStr)] = Math.round(Number(val) * level);
    }
    sendChannelsToHardwareAndStore(scaled, fixtures, universes, sourceId).catch(() => {});
  };

  const next = () => runChaserStep(chaserId, nextStepIndex(chaser, handle));

  const onHold = () => {
    handle.timer = setTimeout(() => {
      if (fadeOut > 0) {
        const start = performance.now();
        const anim = () => {
          const p = Math.min(1, (performance.now() - start) / fadeOut);
          applyLevel(1 - p);
          if (p < 1) handle.raf = requestAnimationFrame(anim);
          else next();
        };
        handle.raf = requestAnimationFrame(anim);
      } else {
        next();
      }
    }, hold);
  };

  if (fadeIn > 0) {
    const start = performance.now();
    const anim = () => {
      const p = Math.min(1, (performance.now() - start) / fadeIn);
      applyLevel(p);
      if (p < 1) handle.raf = requestAnimationFrame(anim);
      else {
        applyLevel(1);
        onHold();
      }
    };
    handle.raf = requestAnimationFrame(anim);
  } else {
    applyLevel(1);
    onHold();
  }
}

export function midiPlayChaser(chaserId: string, sourceId: string = MIDI_CHASER_SOURCE_ID): void {
  ensureSourcesRegistered();
  const { chasers } = getShowState();
  const chaser = chasers.find((c) => c.id === chaserId);
  if (!chaser) {
    console.warn(`[midi] chaser introuvable : ${chaserId}`);
    return;
  }
  if (chaser.steps.length === 0) {
    console.warn(`[midi] chaser "${chaser.name}" : aucun step`);
    return;
  }
  // Si déjà actif, on repart du step courant (relance proprement)
  const existing = activeChasers.get(chaserId);
  runChaserStep(chaserId, existing ? existing.stepIndex : 0, sourceId);
  console.debug(`[midi] chaser play : "${chaser.name}" (${chaserId}) steps=${chaser.steps.length} dir=${chaser.direction} source=${sourceId}`);
}

export function midiStopChaser(chaserId: string): void {
  const handle = activeChasers.get(chaserId);
  if (!handle) {
    console.debug(`[midi] chaser stop : rien en cours pour ${chaserId}`);
    return;
  }
  cancelChaserStep(handle);
  activeChasers.delete(chaserId);
  // Zéro transitoire sur tous les canaux des scènes du chaser (source du handle)
  const { chasers, scenes } = getShowState();
  const chaser = chasers.find((c) => c.id === chaserId);
  if (chaser) {
    const all: Record<number, number> = {};
    for (const step of chaser.steps) {
      const scene = scenes.find((s) => s.id === step.sceneId);
      if (scene) Object.assign(all, toChannelMap(scene.channels));
    }
    flushZeros(all, handle.sourceId);
  }
  console.debug(`[midi] chaser stop : ${chaserId}`);
}

export function midiChaserNext(chaserId: string, sourceId: string = MIDI_CHASER_SOURCE_ID): void {
  const { chasers } = getShowState();
  const chaser = chasers.find((c) => c.id === chaserId);
  if (!chaser || chaser.steps.length === 0) return;
  const handle = activeChasers.get(chaserId);
  if (!handle) {
    runChaserStep(chaserId, 0, sourceId); // pas en cours → démarrer au premier step
    return;
  }
  runChaserStep(chaserId, (handle.stepIndex + 1) % chaser.steps.length, handle.sourceId);
}

export function midiChaserPrevious(chaserId: string, sourceId: string = MIDI_CHASER_SOURCE_ID): void {
  const { chasers } = getShowState();
  const chaser = chasers.find((c) => c.id === chaserId);
  if (!chaser || chaser.steps.length === 0) return;
  const handle = activeChasers.get(chaserId);
  if (!handle) {
    runChaserStep(chaserId, chaser.steps.length - 1, sourceId); // pas en cours → dernier step
    return;
  }
  runChaserStep(chaserId, (handle.stepIndex - 1 + chaser.steps.length) % chaser.steps.length, handle.sourceId);
}

// ═══════════════════════════════════════════════════════════
// Remote web LAN (lot #17) — wrappers sources 'remote' / 'remote-chaser'
// ═══════════════════════════════════════════════════════════
// Le hook useRemoteTriggers() (src/hooks/remote-trigger.ts) consomme le canal
// `remote:command` et dispatch vers ces wrappers, qui délèguent au même
// moteur fade/hold que MIDI mais avec les sources arbitre dédiées (LTP 70,
// sous 'midi' 75). Le stop/toggle réutilise la source stockée dans le handle
// (la source qui a démarré la lecture), donc aucun comportement MIDI ne change.

export function remotePlayScene(sceneId: string): void {
  midiPlayScene(sceneId, REMOTE_SOURCE_ID);
}

export function remoteStopScene(sceneId: string): void {
  midiStopScene(sceneId);
}

export function remoteToggleScene(sceneId: string): void {
  midiToggleScene(sceneId, REMOTE_SOURCE_ID);
}

export function remotePlayChaser(chaserId: string): void {
  midiPlayChaser(chaserId, REMOTE_CHASER_SOURCE_ID);
}

export function remoteStopChaser(chaserId: string): void {
  midiStopChaser(chaserId);
}

export function remoteChaserNext(chaserId: string): void {
  midiChaserNext(chaserId, REMOTE_CHASER_SOURCE_ID);
}

export function remoteChaserPrevious(chaserId: string): void {
  midiChaserPrevious(chaserId, REMOTE_CHASER_SOURCE_ID);
}

// ████████████████████████████████████████████████████████████████████████
// OSC entrant (lot #16) — wrappers sources 'osc' / 'osc-chaser'
// ████████████████████████████████████████████████████████████████████████
// Le hook useOscTriggers() (src/hooks/osc-trigger.ts) consomme le canal
// `osc:command` et dispatch vers ces wrappers, qui délèguent au même moteur
// fade/hold que MIDI/Remote avec les sources arbitre dédiées (LTP 71, entre
// 'remote' 70 et 'mtc' 72). Le stop/toggle réutilise la source stockée dans
// le handle (la source qui a démarré la lecture) : une scène lancée par OSC
// ne peut être arrêtée que par OSC (ou un stop global), comme pour Remote.
// Le blackout et le grand master passent par les mêmes chemins que Remote
// (dmx:applyGrandMaster est optionnel — grandMaster est appliqué côté moteur
// par l'arbitre HTP/LTP).

export function oscPlayScene(sceneId: string): void {
  midiPlayScene(sceneId, OSC_SOURCE_ID);
}

export function oscStopScene(sceneId: string): void {
  midiStopScene(sceneId);
}

export function oscToggleScene(sceneId: string): void {
  midiToggleScene(sceneId, OSC_SOURCE_ID);
}

export function oscPlayChaser(chaserId: string): void {
  midiPlayChaser(chaserId, OSC_CHASER_SOURCE_ID);
}

export function oscStopChaser(chaserId: string): void {
  midiStopChaser(chaserId);
}

export function oscChaserNext(chaserId: string): void {
  midiChaserNext(chaserId, OSC_CHASER_SOURCE_ID);
}

export function oscChaserPrevious(chaserId: string): void {
  midiChaserPrevious(chaserId, OSC_CHASER_SOURCE_ID);
}

// ═══════════════════════════════════════════════════════════
// MTC entrant (lot #15) — wrappers sources 'mtc' / 'mtc-chaser'
// ═══════════════════════════════════════════════════════════
// Le hook useMtcTriggers() (src/hooks/mtc-trigger.ts) consomme le canal
// `midi:mtc` (état décodé en main) et dispatch vers ces wrappers, qui
// délèguent au même moteur fade/hold que MIDI/Remote avec les sources
// arbitre dédiées (LTP 72, entre 'remote' 70 et 'midi' 75). Le stop/toggle
// réutilise la source stockée dans le handle (la source qui a démarré la
// lecture), donc aucun comportement MIDI/Remote ne change.

export function mtcPlayScene(sceneId: string): void {
  midiPlayScene(sceneId, MTC_SOURCE_ID);
}

export function mtcStopScene(sceneId: string): void {
  midiStopScene(sceneId);
}

export function mtcToggleScene(sceneId: string): void {
  midiToggleScene(sceneId, MTC_SOURCE_ID);
}

export function mtcPlayChaser(chaserId: string): void {
  midiPlayChaser(chaserId, MTC_CHASER_SOURCE_ID);
}

export function mtcStopChaser(chaserId: string): void {
  midiStopChaser(chaserId);
}

/** Ids des scènes actuellement jouées (toutes sources : midi + remote). */
export function getActiveSceneIds(): string[] {
  return [...activeScenes.keys()];
}

export interface ActiveChaserInfo {
  id: string;
  stepIndex: number;
}

/** Chasers actuellement en boucle (toutes sources), avec le step courant. */
export function getActiveChasers(): ActiveChaserInfo[] {
  return [...activeChasers.entries()].map(([id, h]) => ({ id, stepIndex: h.stepIndex }));
}

// ═══════════════════════════════════════════════════════════
// Cue Lists (théâtre : go / back / stop)
// ═══════════════════════════════════════════════════════════

export function midiCueListGo(cueListId: string): void {
  ensureSourcesRegistered();
  const store = useShowStore.getState();
  const cl = store.cueLists.find((c) => c.id === cueListId);
  if (!cl) {
    console.warn(`[midi] cueList introuvable : ${cueListId}`);
    return;
  }
  if (cl.cues.length === 0) {
    console.warn(`[midi] cueList "${cl.name}" : aucune cue`);
    return;
  }
  const nextIdx = cl.currentCueIndex < 0 ? 0 : (cl.currentCueIndex + 1) % cl.cues.length;
  store.updateCueList(cl.id, { currentCueIndex: nextIdx });
  const cue = cl.cues[nextIdx];
  console.debug(`[midi] cueList go : "${cl.name}" cue ${nextIdx + 1}/${cl.cues.length} → scene ${cue.sceneId}`);
  midiPlayScene(cue.sceneId);
}

export function midiCueListBack(cueListId: string): void {
  const store = useShowStore.getState();
  const cl = store.cueLists.find((c) => c.id === cueListId);
  if (!cl) {
    console.warn(`[midi] cueList introuvable : ${cueListId}`);
    return;
  }
  if (cl.cues.length === 0) return;
  const prevIdx = Math.max(0, cl.currentCueIndex < 0 ? 0 : cl.currentCueIndex - 1);
  store.updateCueList(cl.id, { currentCueIndex: prevIdx });
  const cue = cl.cues[prevIdx];
  console.debug(`[midi] cueList back : "${cl.name}" cue ${prevIdx + 1}/${cl.cues.length} → scene ${cue.sceneId}`);
  midiPlayScene(cue.sceneId);
}

export function midiCueListStop(cueListId: string): void {
  const store = useShowStore.getState();
  const cl = store.cueLists.find((c) => c.id === cueListId);
  if (cl) store.updateCueList(cl.id, { currentCueIndex: -1 });
  midiStopAllScenes();
  console.debug(`[midi] cueList stop : ${cueListId}`);
}

// ═══════════════════════════════════════════════════════════
// Autoscript (QuickShow) — audioActive / intensity globaux dans appstore
// ═══════════════════════════════════════════════════════════

export type AutoscriptAction = 'toggle' | 'nextEffect' | 'intensity';

/** Registre optionnel : le futur moteur autoscript (ou QuickShowView) peut
 *  s'y brancher pour capter les actions à la place du fallback appstore. */
let autoscriptHandler: ((action: AutoscriptAction, value: number) => void) | null = null;

export function registerMidiAutoscriptHandler(handler: (action: AutoscriptAction, value: number) => void): void {
  autoscriptHandler = handler;
}

export function unregisterMidiAutoscriptHandler(): void {
  autoscriptHandler = null;
}

const INTENSITY_LEVELS = ['low', 'medium', 'high', 'dynamic'] as const;

export function midiAutoscript(action: AutoscriptAction, value: number): void {
  if (autoscriptHandler) {
    autoscriptHandler(action, value);
    return;
  }
  try {
    const app = useAppStore.getState();
    if (action === 'toggle') {
      const next = !app.quickShow.audioActive;
      app.setQuickShow({ audioActive: next });
      console.debug(`[midi] autoscript toggle → audioActive=${next}`);
    } else if (action === 'intensity') {
      const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value / 127 : 0));
      const level = INTENSITY_LEVELS[Math.min(3, Math.floor(v * 4))];
      app.setQuickShow({ intensity: level });
      console.debug(`[midi] autoscript intensity → ${level} (${Math.round(v * 100)} %)`);
    } else {
      console.warn(
        "[midi] autoscript nextEffect : pas d'état « effet courant » global dans QuickShow — brancher via registerMidiAutoscriptHandler (dette M3)"
      );
    }
  } catch (e) {
    console.warn('[midi] autoscript : échec', e);
  }
}

// ═══════════════════════════════════════════════════════════
// Widgets VC (par id) — registre + fallback best-effort sur la config
// ═══════════════════════════════════════════════════════════

type WidgetMidiHandler = (property: string, value: number, rawValue: number) => void;

const widgetHandlers = new Map<string, WidgetMidiHandler>();

/** Le refactor de VCButtonWidget (backlog) doit appeler ça au mount de chaque
 *  widget pour que le trigger MIDI pilote le VRAI composant (état visuel LED
 *  compris). Tant que ce n'est pas fait, le fallback config ci-dessous
 *  s'applique (pas de retour visuel sur le bouton). */
export function registerMidiWidgetHandler(widgetId: string, handler: WidgetMidiHandler): void {
  widgetHandlers.set(widgetId, handler);
}

export function unregisterMidiWidgetHandler(widgetId: string): void {
  widgetHandlers.delete(widgetId);
}

const warnedWidgets = new Set<string>();

export function midiWidgetAction(widgetId: string, property: string, value: number, rawValue: number): void {
  const handler = widgetHandlers.get(widgetId);
  if (handler) {
    handler(property, value, rawValue);
    return;
  }

  // Fallback : traduire la config du widget (performstore) en action réelle.
  try {
    const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === widgetId);
    if (!widget) {
      if (!warnedWidgets.has(widgetId)) {
        warnedWidgets.add(widgetId);
        console.warn(
          `[midi] widget ${widgetId} : introuvable dans le Virtual Console — brancher via registerMidiWidgetHandler (dette M3, refactor VCButtonWidget)`
        );
      }
      return;
    }
    const cfg = widget.config ?? {};
    const press = !(rawValue === 0); // undefined (PGM) = press

    if (widget.type === 'button') {
      if (cfg.actionType === 'scene' && cfg.sceneId) {
        if (press) midiPlayScene(cfg.sceneId);
        else midiStopScene(cfg.sceneId);
      } else if (cfg.actionType === 'chaser' && cfg.chaserId) {
        if (press) midiPlayChaser(cfg.chaserId);
        else midiStopChaser(cfg.chaserId);
      } else if (cfg.actionType === 'blackout') {
        const dmx = (window as any)?.lightMaestro?.dmx;
        if (press) dmx?.blackout?.();
        else dmx?.restore?.();
      } else if (!warnedWidgets.has(widgetId)) {
        warnedWidgets.add(widgetId);
        console.warn(
          `[midi] widget ${widgetId} (actionType=${cfg.actionType}) : action non traduisible — registre requis (dette M3)`
        );
      }
    } else if (widget.type === 'slider') {
      const v255 = Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value / 127 : 0)) * 255);
      if (cfg.sliderFunction === 'channel' && cfg.channelAddress) {
        dmxBridge.writeMerge(MIDI_SOURCE_ID, cfg.sliderUniverse ?? 0, { [cfg.channelAddress]: v255 });
      } else if (cfg.sliderFunction === 'grandMaster') {
        (window as any)?.lightMaestro?.dmx?.applyGrandMaster?.(v255 / 255);
      } else if (!warnedWidgets.has(widgetId)) {
        warnedWidgets.add(widgetId);
        console.warn(
          `[midi] widget slider ${widgetId} (sliderFunction=${cfg.sliderFunction}) : non supporté — registre requis (dette M3)`
        );
      }
    }
  } catch (e) {
    console.warn('[midi] widget : échec', e);
  }
}
