/**
 * Virtual Console — runtime d'exécution des tuiles (scène / chaser /
 * blackout / grandMaster / canal DMX).
 *
 * La logique vivait dans `VCButtonWidget` (closures React) : non testable, et
 * le pilotage MIDI ne marchait que si le widget était monté (page active).
 * Ce module la sort de la vue :
 *   - registre `Map<widgetId, Run>` → un run survit au changement de page ;
 *   - canal d'émission `vcOnRunChange` → la LED de la tuile suit l'état réel ;
 *   - injections (`__setVCSender`, `__setVCBlackoutFns`, `__setVCButtonFns`) →
 *     tests unitaires dans `src/__tests__/vc-runtime.test.ts` (aucun matériel
 *     requis).
 *
 * Sémantique conservée à l'identique par rapport à l'implémentation vue :
 * fade-in/hold/fade-out de la scène, timing par étape du chaser (fallback sur
 * la scène), extinction = zéro sur les canaux allumés en respectant le fadeOut.
 */

import { useShowStore, type SavedScene, type SavedChaser } from '../stores/showStore';
import { usePerformStore, applyWidgetSliderEffect } from '../stores/performStore';
import { sendChannelsToHardware } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import { generateEfxPanTilt } from '../hooks/fixture-tracks';
// Famille « playback » (playSong, audioAutoScript, autoLoop, bankLoop, loadShow)
// — sortie du composant React vers un runtime module-level (cf. vc-playback-runtime.ts).
// Dépendance UNIDIRECTIONNELLE : ce module n'importe jamais l'autre.
import {
  vcPlaybackPress,
  vcPlaybackDeactivate,
  vcPlaybackSetActive,
} from './vc-playback-runtime';

export type VCRunKind = 'scene' | 'chaser' | 'blackout' | 'grandmaster' | 'dmxchannel';
export const VC_SOURCE = 'vc';

/**
 * Source arbitre de la vague EFX des tuiles — séparée du statique 'vc',
 * comme 'scene-efx' vs 'design-test' côté édition : le mouvement écrase le
 * pan/tilt statique sans toucher au reste. LTP 84 : sous programmer (85,
 * la main reste à l'opérateur), au-dessus de vc (80).
 */
export const VC_EFX_SOURCE_ID = 'vc-efx';
let efxSourceRegistered = false;
function ensureEfxSource(): void {
  if (efxSourceRegistered) return;
  efxSourceRegistered = true;
  try { dmxBridge.registerSource(VC_EFX_SOURCE_ID, 'ltp', 84); } catch { /* */ }
}

// ─── Environnement (node-safe : tests sans DOM) ────────────

const hasRaf = typeof globalThis.requestAnimationFrame === 'function';
const frame = (cb: () => void): number =>
  hasRaf
    ? globalThis.requestAnimationFrame(() => cb())
    : (setTimeout(cb, 16) as unknown as number);
const unframe = (h: number) => {
  if (hasRaf) globalThis.cancelAnimationFrame(h);
  else clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
};
const now = (): number => Date.now();

// ─── Injections (tests) ────────────────────────────────────

export type VCSender = (channels: Record<number, number>) => void;

const defaultSender: VCSender = (channels) => {
  const s = useShowStore.getState();
  sendChannelsToHardware(channels, s.patchedFixtures, s.universes, VC_SOURCE).catch(() => {});
};
let send: VCSender = defaultSender;

let blackoutFns = {
  blackout: () => {
    if (typeof window === 'undefined') return;
    try { (window as any)?.lightMaestro?.dmx?.blackout?.(); } catch { /* */ }
  },
  restore: () => {
    if (typeof window === 'undefined') return;
    try { (window as any)?.lightMaestro?.dmx?.restore?.(); } catch { /* */ }
  },
};

/** Test hook : remplacer l'envoi DMX par une capture. `null` = valeur par défaut. */
export function __setVCSender(fn: VCSender | null): void {
  send = fn ?? defaultSender;
}

/** Test hook : remplacer blackout/restore (pas de `window` sous vitest). */
export function __setVCBlackoutFns(fns: Partial<typeof blackoutFns> | null): void {
  blackoutFns = fns
    ? { ...blackoutFns, ...fns }
    : {
        blackout: () => {
          if (typeof window === 'undefined') return;
          try { (window as any)?.lightMaestro?.dmx?.blackout?.(); } catch { /* */ }
        },
        restore: () => {
          if (typeof window === 'undefined') return;
          try { (window as any)?.lightMaestro?.dmx?.restore?.(); } catch { /* */ }
        },
      };
}

// ─── Effets bouton (grandMaster / canal DMX) ───────────────
// Même motif que blackoutFns : chemin réel par défaut (preload / dmxBridge),
// remplaçable sous vitest. Le `restore` exact (GM → 1, canal → 0) est capturé
// en closure sur le run à l'activation.

let buttonFns = {
  applyGrandMaster01: (v: number) => {
    if (typeof window === 'undefined') return;
    try { (window as any)?.lightMaestro?.dmx?.applyGrandMaster?.(v); } catch { /* */ }
  },
  setChannel: (universe: number, address: number, value: number) => {
    try { dmxBridge.writeMerge(VC_SOURCE, universe, { [address]: value }); } catch { /* */ }
  },
};

/** Test hook : remplacer les effets bouton (pas de DMX sous vitest). */
export function __setVCButtonFns(fns: Partial<typeof buttonFns> | null): void {
  buttonFns = fns
    ? { ...buttonFns, ...fns }
    : {
        applyGrandMaster01: (v: number) => {
          if (typeof window === 'undefined') return;
          try { (window as any)?.lightMaestro?.dmx?.applyGrandMaster?.(v); } catch { /* */ }
        },
        setChannel: (universe: number, address: number, value: number) => {
          try { dmxBridge.writeMerge(VC_SOURCE, universe, { [address]: value }); } catch { /* */ }
        },
      };
}

// ─── Vague EFX des scènes (efxId) ──────────────────────────
// Sans ça, une tuile « Bleu EFX » ne joue que le statique : le mouvement ne
// part jamais hors Configuration. Même math que la preview édition
// (fixture-tracks.ts) et même séparation de sources (vc-efx vs vc).

/** Résolution des canaux d'une fixture (une fois, à l'activation). */
export type VCDefResolver = (
  fixtureDefId: string,
  modeIndex: number,
) => Promise<{ channels: Array<{ type?: string }> } | null>;

const defaultDefResolver: VCDefResolver = async (fixtureDefId, modeIndex) => {
  try {
    if (typeof window === 'undefined') return null;
    const def = await (window as any)?.lightMaestro?.fixtures?.getDefinition?.(fixtureDefId);
    const mode = def?.modes?.[modeIndex];
    return mode ? { channels: mode.channels ?? [] } : null;
  } catch {
    return null;
  }
};

let defResolver: VCDefResolver = defaultDefResolver;

/** Test hook : remplacer la résolution des defs (pas de window sous vitest). */
export function __setVCDefResolver(fn: VCDefResolver | null): void {
  defResolver = fn ?? defaultDefResolver;
}

/** Envoi EFX par univers (source vc-efx). */
export type VCEfxSender = (universe: number, channels: Record<number, number>) => void;

const defaultEfxSender: VCEfxSender = (universe, channels) => {
  ensureEfxSource();
  try { dmxBridge.write(VC_EFX_SOURCE_ID, universe, channels); } catch { /* */ }
};

let efxSender: VCEfxSender = defaultEfxSender;

/** Test hook : capturer les frames EFX (pas de DMX sous vitest). */
export function __setVCEfxSender(fn: VCEfxSender | null): void {
  efxSender = fn ?? defaultEfxSender;
}

/** Tuiles avec vague EFX en cours (release de source scopée). */
const efxRuns = new Set<string>();

function releaseEfxSource(): void {
  if (efxRuns.size > 0) return; // une autre tuile vague encore
  try { dmxBridge.release(VC_EFX_SOURCE_ID); } catch { /* */ }
}

/** Arrête la vague EFX d'un run (annule rAF, retire du compteur, release). */
function stopRunEfx(run: Run): void {
  try { run.efxCancel?.(); } catch { /* */ }
  run.efxCancel = undefined;
  efxRuns.delete(run.widgetId);
  releaseEfxSource();
}

interface EfxTarget {
  universe: number;
  panAddr: number | null;
  tiltAddr: number | null;
  intensityAddr: number | null;
}

/** Démarre la vague EFX d'une scène (asynchrone : résolution des defs). */
function startSceneEfx(run: Run, efxId: string): void {
  void (async () => {
    try {
      const s = useShowStore.getState();
      const efx = (s.effects ?? []).find((e: any) => e.id === efxId);
      if (!efx || !Array.isArray(efx.fixtureIds) || efx.fixtureIds.length === 0) return;
      if (runs.get(run.widgetId) !== run || !run.running) return; // tuile déjà éteinte
      ensureEfxSource();
      const universes = s.universes ?? [];
      const targets: EfxTarget[] = [];
      for (const fid of efx.fixtureIds) {
        const pf = (s.patchedFixtures ?? []).find((f: any) => f.id === fid);
        if (!pf) continue;
        const resolved = await defResolver(pf.fixtureDefId, pf.modeIndex ?? 0);
        const channels = resolved?.channels ?? [];
        let panAddr: number | null = null;
        let tiltAddr: number | null = null;
        let intensityAddr: number | null = null;
        channels.forEach((ch: any, ci: number) => {
          if (ch?.type === 'Pan' && panAddr === null) panAddr = pf.startAddress + ci;
          else if (ch?.type === 'Tilt' && tiltAddr === null) tiltAddr = pf.startAddress + ci;
          else if (ch?.type === 'Intensity' && intensityAddr === null) intensityAddr = pf.startAddress + ci;
        });
        if (panAddr === null && tiltAddr === null) continue;
        const uniIdx = Math.max(0, universes.findIndex((u: any) => String(u?.id) === String(pf.universeId)));
        targets.push({ universe: uniIdx, panAddr, tiltAddr, intensityAddr });
      }
      if (targets.length === 0) return;
      if (runs.get(run.widgetId) !== run || !run.running) return;
      efxRuns.add(run.widgetId);
      const start = now();
      let raf = 0;
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        unframe(raf);
      };
      run.efxCancel = cancel;
      const spread = Number((efx as any).spread ?? 0);
      const speed = Number(efx.speed ?? 0.5);
      const tick = () => {
        if (cancelled || runs.get(run.widgetId) !== run || !run.running) return;
        const elapsed = (now() - start) / 1000;
        const tBase = (elapsed * speed * 2) / (Math.PI * 2);
        const byUniverse = new Map<number, Record<number, number>>();
        targets.forEach((t, sfi) => {
          const tCycles = targets.length > 1 && spread > 0 ? tBase + (sfi * spread) / targets.length : tBase;
          let pan = 128;
          let tilt = 128;
          try {
            const pt = generateEfxPanTilt(efx.pattern, tCycles, efx.width, efx.height, efx.rotation, efx.xOffset, efx.yOffset);
            if (Number.isFinite(pt.pan)) pan = pt.pan;
            if (Number.isFinite(pt.tilt)) tilt = pt.tilt;
          } catch { /* frame dégénérée : on garde le centre */ }
          let vals = byUniverse.get(t.universe);
          if (!vals) { vals = {}; byUniverse.set(t.universe, vals); }
          if (t.panAddr !== null) vals[t.panAddr] = pan;
          if (t.tiltAddr !== null) vals[t.tiltAddr] = tilt;
          if (t.intensityAddr !== null) vals[t.intensityAddr] = 255;
        });
        for (const [uni, vals] of byUniverse) {
          try { efxSender(uni, vals); } catch { /* sortie best effort */ }
        }
        raf = frame(tick);
      };
      raf = frame(tick);
    } catch {
      /* vague indisponible : le statique joue quand même */
    }
  })();
}

// ─── Registre des runs ─────────────────────────────────────

interface Run {
  widgetId: string;
  kind: VCRunKind;
  /** Scène ou chaser piloté par ce run (feedback LED sur la cible directe). */
  targetId?: string;
  /** Canaux pilotés par ce run (scène) ou union des étapes (chaser). */
  channels: Record<number, number>;
  fadeOut: number;
  /** Niveau courant 0..1 (piloté par les fades). */
  level: number;
  running: boolean;
  timers: Array<ReturnType<typeof setTimeout>>;
  frames: number[];
  /** Restauration exacte (grandMaster → 1, canal DMX → 0), capturée à l'activation. */
  restore?: () => void;
  /** Annulation de la vague EFX (scène à efxId), posée à l'activation. */
  efxCancel?: () => void;
}

const runs = new Map<string, Run>();
/** Fades d'extinction en cours (annulés si la tuile est relancée). */
const extinguishFrames = new Map<string, number>();
const listeners = new Set<(widgetId: string, running: boolean, kind: VCRunKind) => void>();

function notify(widgetId: string, running: boolean, kind: VCRunKind): void {
  // Registre unifié des tuiles « allumées » (famille simple ET famille
  // playback) : alimente la LED de la tuile et l'état renvoyé au Remote.
  vcPlaybackSetActive(widgetId, running);
  for (const cb of listeners) {
    try { cb(widgetId, running, kind); } catch { /* listener défaillant */ }
  }
}

/** Abonnement LED / état : renvoie la fonction de désabonnement. */
export function vcOnRunChange(
  cb: (widgetId: string, running: boolean, kind: VCRunKind) => void,
): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function vcIsRunning(widgetId: string): boolean {
  return runs.get(widgetId)?.running ?? false;
}

export function vcRunKind(widgetId: string): VCRunKind | null {
  return runs.get(widgetId)?.kind ?? null;
}

/**
 * Snapshot des runs actifs (tuiles allumées). Sert au feedback MIDI LED
 * (`src/hooks/use-midi-feedback.ts`) et au debug : une seule lecture du
 * registre plutôt qu'un `vcIsRunning` par widget.
 */
export function vcActiveRuns(): Array<{ widgetId: string; kind: VCRunKind; targetId?: string }> {
  const out: Array<{ widgetId: string; kind: VCRunKind; targetId?: string }> = [];
  for (const run of runs.values()) {
    if (run.running) out.push({ widgetId: run.widgetId, kind: run.kind, targetId: run.targetId });
  }
  return out;
}

function clearRun(run: Run): void {
  for (const t of run.timers) clearTimeout(t);
  run.timers.length = 0;
  for (const f of run.frames) unframe(f);
  run.frames.length = 0;
}

function cancelExtinguish(widgetId: string): void {
  const h = extinguishFrames.get(widgetId);
  if (h !== undefined) { unframe(h); extinguishFrames.delete(widgetId); }
}

function sendScaled(run: Pick<Run, 'channels'>, level: number): void {
  const scaled: Record<number, number> = {};
  for (const [addr, val] of Object.entries(run.channels)) {
    scaled[Number(addr)] = Math.round(Number(val) * level);
  }
  send(scaled);
}

/** Zéro les canaux allumés, à partir du niveau courant, avec le fadeOut. */
function extinguish(run: Run): void {
  const from = Math.max(0, Math.min(1, run.level));
  run.level = 0;
  cancelExtinguish(run.widgetId);
  if (run.fadeOut > 0 && from > 0) {
    const start = now();
    const step = () => {
      const p = Math.min(1, (now() - start) / run.fadeOut);
      sendScaled(run, from * (1 - p));
      if (p < 1) extinguishFrames.set(run.widgetId, frame(step));
      else { extinguishFrames.delete(run.widgetId); sendScaled(run, 0); }
    };
    extinguishFrames.set(run.widgetId, frame(step));
  } else {
    sendScaled(run, 0);
  }
}

function finishRun(run: Run): void {
  if (!run.running) return;
  run.running = false;
  stopRunEfx(run);
  clearRun(run);
  runs.delete(run.widgetId);
  console.debug(`[VC] run terminé (${run.kind}) : ${run.widgetId}`);
  notify(run.widgetId, false, run.kind);
}

/** Arrête un éventuel run précédent de la tuile (sans extinction). */
function replaceRun(widgetId: string): void {
  const prev = runs.get(widgetId);
  if (prev) {
    console.debug(`[VC] run remplacé (${prev.kind}) : ${widgetId}`);
    prev.running = false; stopRunEfx(prev); clearRun(prev); runs.delete(widgetId); notify(widgetId, false, prev.kind);
  }
  cancelExtinguish(widgetId);
}

function createRun(
  widgetId: string,
  kind: VCRunKind,
  channels: Record<number, number>,
  fadeOut: number,
  targetId?: string,
): Run {
  const run: Run = {
    widgetId, kind, channels, fadeOut, targetId,
    level: 0, running: true, timers: [], frames: [],
  };
  runs.set(widgetId, run);
  notify(widgetId, true, kind);
  return run;
}

// ─── Activation ────────────────────────────────────────────

export function vcActivateScene(widgetId: string, sceneId: string): boolean {
  const scene = useShowStore.getState().scenes.find((s: SavedScene) => s.id === sceneId);
  if (!scene) return false;
  replaceRun(widgetId);

  const channels: Record<number, number> = {};
  for (const [addr, val] of Object.entries(scene.channels ?? {})) channels[Number(addr)] = Number(val);

  const fadeIn = scene.fadeIn || 0;
  const fadeOut = scene.fadeOut || 0;
  const infinite = !scene.duration || scene.duration <= 0;
  const hold = infinite ? 0 : Math.max(0, scene.duration - fadeIn - fadeOut);

  const run = createRun(widgetId, 'scene', channels, fadeOut, sceneId);
  console.debug(`[VC] activate scene : ${widgetId} → ${sceneId} (dur=${scene.duration} in=${fadeIn} out=${fadeOut} hold=${hold})`);

  const applyLevel = (level: number) => {
    if (!run.running) return;
    run.level = level;
    sendScaled(run, level);
  };

  const scheduleFadeOut = (delay: number) => {
    run.timers.push(setTimeout(() => {
      if (!run.running) return;
      if (fadeOut > 0) {
        const start = now();
        const anim = () => {
          if (!run.running) return;
          const p = Math.min(1, (now() - start) / fadeOut);
          applyLevel(1 - p);
          if (p < 1) run.frames.push(frame(anim));
          else finishRun(run);
        };
        run.frames.push(frame(anim));
      } else {
        applyLevel(0);
        finishRun(run);
      }
    }, delay));
  };

  if (fadeIn > 0) {
    const start = now();
    const anim = () => {
      if (!run.running) return;
      const p = Math.min(1, (now() - start) / fadeIn);
      applyLevel(p);
      if (p < 1) run.frames.push(frame(anim));
      else { applyLevel(1); if (!infinite) scheduleFadeOut(hold); }
    };
    run.frames.push(frame(anim));
  } else {
    applyLevel(1);
    if (!infinite) scheduleFadeOut(hold);
  }
  // Vague EFX liée (efxId) : le mouvement part avec le statique, sur sa
  // propre source — sans ça, la tuile ne joue jamais la vague hors Configuration.
  const linkedEfxId = (scene as any)?.efxId as string | undefined;
  if (typeof linkedEfxId === 'string' && linkedEfxId.length > 0) {
    startSceneEfx(run, linkedEfxId);
  }
  return true;
}

export function vcActivateChaser(widgetId: string, chaserId: string): boolean {
  const getScenes = () => useShowStore.getState().scenes as SavedScene[];
  const chaser = (useShowStore.getState().chasers as SavedChaser[])
    .find((c) => c.id === chaserId);
  if (!chaser || !chaser.steps || chaser.steps.length === 0) return false;
  replaceRun(widgetId);

  // Union des canaux de toutes les étapes : tout éteint à la désactivation.
  const union: Record<number, number> = {};
  let maxFadeOut = 0;
  for (const st of chaser.steps) {
    const sc = getScenes().find((s) => s.id === st.sceneId);
    if (!sc?.channels) continue;
    for (const [addr, val] of Object.entries(sc.channels)) union[Number(addr)] = Number(val);
    maxFadeOut = Math.max(maxFadeOut, st.fadeOut ?? sc.fadeOut ?? 0);
  }

  const run = createRun(widgetId, 'chaser', union, maxFadeOut, chaserId);
  let stepIndex = 0;

  const applyLevel = (level: number) => {
    if (!run.running) return;
    run.level = level;
    sendScaled(run, level);
  };

  const runStep = () => {
    if (!run.running) return;
    const step = chaser.steps[stepIndex];
    if (!step) { finishRun(run); return; }
    const scene = getScenes().find((s) => s.id === step.sceneId);
    if (!scene) {
      stepIndex = (stepIndex + 1) % chaser.steps.length;
      run.timers.push(setTimeout(runStep, 100));
      return;
    }

    const fadeIn = step.fadeIn ?? scene.fadeIn ?? 0;
    const fadeOut = step.fadeOut ?? scene.fadeOut ?? 0;
    const hold = step.hold ?? (scene.duration > 0 ? Math.max(0, scene.duration - fadeIn - fadeOut) : 500);

    const stepChannels: Record<number, number> = {};
    for (const [addr, val] of Object.entries(scene.channels ?? {})) stepChannels[Number(addr)] = Number(val);

    const applyStep = (level: number) => {
      if (!run.running) return;
      run.level = level;
      const scaled: Record<number, number> = {};
      for (const [addr, val] of Object.entries(stepChannels)) scaled[Number(addr)] = Math.round(Number(val) * level);
      send(scaled);
    };

    const onHold = () => {
      run.timers.push(setTimeout(() => {
        if (!run.running) return;
        if (fadeOut > 0) {
          const start = now();
          const anim = () => {
            if (!run.running) return;
            const p = Math.min(1, (now() - start) / fadeOut);
            applyStep(1 - p);
            if (p < 1) run.frames.push(frame(anim));
            else nextStep();
          };
          run.frames.push(frame(anim));
        } else {
          applyStep(0);
          nextStep();
        }
      }, hold));
    };

    const nextStep = () => {
      if (!run.running) return;
      stepIndex = (stepIndex + 1) % chaser.steps.length;
      runStep();
    };

    if (fadeIn > 0) {
      const start = now();
      const anim = () => {
        if (!run.running) return;
        const p = Math.min(1, (now() - start) / fadeIn);
        applyStep(p);
        if (p < 1) run.frames.push(frame(anim));
        else onHold();
      };
      run.frames.push(frame(anim));
    } else {
      applyStep(1);
      onHold();
    }
  };

  runStep();
  return true;
}

export function vcActivateBlackout(widgetId: string): boolean {
  replaceRun(widgetId);
  blackoutFns.blackout();
  createRun(widgetId, 'blackout', {}, 0);
  return true;
}

const clamp255 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : 0;
};

/**
 * Bouton Grand Master : applique `value` (0..255, défaut 0 = kill) et retient
 * la restauration exacte (GM → 255) jouée à `vcDeactivate`.
 */
export function vcActivateGrandMaster(widgetId: string, value255: number): boolean {
  const value = clamp255(value255);
  replaceRun(widgetId);
  buttonFns.applyGrandMaster01(value / 255);
  const run = createRun(widgetId, 'grandmaster', {}, 0);
  run.restore = () => buttonFns.applyGrandMaster01(1);
  return true;
}

/**
 * Bouton canal DMX : force `value` sur (univers moteur 0-based, adresse
 * 1..512) et retient la remise à zéro jouée à `vcDeactivate`.
 * @returns false si l'adresse est invalide (tuile non configurée).
 */
export function vcActivateDmxChannel(
  widgetId: string,
  universe: number,
  address: number,
  value255: number,
): boolean {
  const uni = Number.isFinite(Number(universe)) ? Math.max(0, Math.floor(Number(universe))) : 0;
  const addr = Math.floor(Number(address));
  if (!Number.isFinite(addr) || addr < 1 || addr > 512) return false;
  const value = clamp255(value255);
  replaceRun(widgetId);
  buttonFns.setChannel(uni, addr, value);
  const run = createRun(widgetId, 'dmxchannel', {}, 0);
  run.restore = () => buttonFns.setChannel(uni, addr, 0);
  return true;
}

// ─── Désactivation / extinction ────────────────────────────

/**
 * Désactive la tuile : annule timers/fades puis ÉTEINT ce qu'elle allumait
 * (fadeOut de la scène respecté, 0 = coupure immédiate). Pour un blackout,
 * désactiver RESTAURE (l'inverse exact) ; idem pour grandMaster (GM → 255)
 * et canal DMX (remise à zéro capturée à l'activation).
 */
export function vcDeactivate(widgetId: string): void {
  const run = runs.get(widgetId);
  if (!run) { console.debug(`[VC] deactivate sans run : ${widgetId}`); return; }
  console.debug(`[VC] deactivate (${run.kind}) : ${widgetId}`);
  stopRunEfx(run);
  cancelExtinguish(widgetId);
  if (run.kind === 'blackout') {
    finishRun(run);
    blackoutFns.restore();
    return;
  }
  if (run.kind === 'grandmaster' || run.kind === 'dmxchannel') {
    const restore = run.restore;
    finishRun(run);
    try { restore?.(); } catch { /* effet best effort */ }
    return;
  }
  run.running = false;
  clearRun(run);
  runs.delete(widgetId);
  notify(widgetId, false, run.kind);
  extinguish(run);
}

/**
 * Point d'entrée commun UI + MIDI + Remote : applique la sémantique
 * press/release (flash = momentané, sinon toggle au note-on, release ignorée).
 *
 * Gère les DEUX familles d'actions :
 *   - « simple »  : scene, chaser, blackout, grandMaster, dmxChannel ;
 *   - « playback »: playSong, audioAutoScript, autoLoop, bankLoop, loadShow.
 *
 * @returns false si le widget est absent ou n'est pas un bouton.
 */
export function vcPressWidget(widgetId: string, press: boolean): boolean {
  // La famille playback est testée en premier : elle renvoie false si le
  // widget n'en fait pas partie (donc la famille simple prend le relais).
  if (vcPlaybackPress(widgetId, press)) return true;
  return vcButtonPress(widgetId, press);
}

/**
 * Désactive une tuile (arrête la lecture), quelle que soit sa famille.
 * Point d'entrée symétrique de `vcPressWidget` (relâchement d'un bouton flash).
 */
export function vcStopWidget(widgetId: string): void {
  const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === widgetId);
  const kind = widget?.config?.actionType;
  if (
    kind === 'playSong' ||
    kind === 'audioAutoScript' ||
    kind === 'autoLoop' ||
    kind === 'bankLoop' ||
    kind === 'loadShow'
  ) {
    vcPlaybackDeactivate(widgetId);
    return;
  }
  vcDeactivate(widgetId);
}

/**
 * Point d'entrée commun UI + MIDI : applique la sémantique press/release
 * (flash = momentané, sinon toggle au note-on, release ignorée).
 * @returns false si le widget est absent ou géré par la vue (autoLoop…)
 */
export function vcButtonPress(widgetId: string, press: boolean): boolean {
  const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === widgetId);
  if (!widget || widget.type !== 'button') return false;
  const cfg = widget.config ?? {};
  const kind = cfg.actionType;
  if (
    kind !== 'scene' &&
    kind !== 'chaser' &&
    kind !== 'blackout' &&
    kind !== 'grandMaster' &&
    kind !== 'dmxChannel'
  ) return false;

  const flash = cfg.flashMode === 'flash';
  const start = () => {
    if (kind === 'scene' && cfg.sceneId) vcActivateScene(widgetId, cfg.sceneId);
    else if (kind === 'chaser' && cfg.chaserId) vcActivateChaser(widgetId, cfg.chaserId);
    else if (kind === 'blackout') vcActivateBlackout(widgetId);
    else if (kind === 'grandMaster') vcActivateGrandMaster(widgetId, cfg.grandMasterValue ?? 0);
    else if (kind === 'dmxChannel') {
      // Adresse invalide = tuile non configurée : aucun run, aucun effet
      // (la LED reste éteinte, comme une scène sans sceneId).
      vcActivateDmxChannel(widgetId, cfg.dmxUniverse ?? 0, cfg.dmxAddress, cfg.dmxValue ?? 255);
    }
  };

  if (flash) {
    if (press) start(); else vcDeactivate(widgetId);
  } else if (press) {
    if (vcIsRunning(widgetId)) vcDeactivate(widgetId);
    else start();
  }
  return true;
}

/**
 * Applique une fraction 0..1 à un widget fader (Remote web LAN, MIDI).
 * La valeur est projetée sur [min, max] du widget, stockée dans
 * `vcWidgetValues` (pour que l'UI suive) puis routée vers le DMX via
 * `applyWidgetSliderEffect` (GM ou canal, univers du widget).
 * @returns false si le widget est absent ou n'est pas un slider
 */
export function vcSetSliderFraction(widgetId: string, fraction: number): boolean {
  const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === widgetId);
  if (!widget || widget.type !== 'slider') return false;
  const cfg = widget.config ?? {};
  const min = Number(cfg.min ?? 0);
  const max = Number(cfg.max ?? 255);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const value = Math.round(lo + (hi - lo) * f);
  usePerformStore.getState().vcSetWidgetValue(widgetId, value);
  applyWidgetSliderEffect(cfg, value, VC_SOURCE);
  return true;
}

/** Arrêt complet (changement de projet, purge). */
export function vcStopAllRuns(): void {
  for (const widgetId of [...runs.keys()]) vcDeactivate(widgetId);
}
