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

export type VCRunKind = 'scene' | 'chaser' | 'blackout' | 'grandmaster' | 'dmxchannel';
export const VC_SOURCE = 'vc';

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
}

const runs = new Map<string, Run>();
/** Fades d'extinction en cours (annulés si la tuile est relancée). */
const extinguishFrames = new Map<string, number>();
const listeners = new Set<(widgetId: string, running: boolean, kind: VCRunKind) => void>();

function notify(widgetId: string, running: boolean, kind: VCRunKind): void {
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
    prev.running = false; clearRun(prev); runs.delete(widgetId); notify(widgetId, false, prev.kind);
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
