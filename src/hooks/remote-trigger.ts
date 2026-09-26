/**
 * Remote Triggers Hook (lot #17 - Remote web LAN) - consomme `remote:command`
 * (relayé par le main, canal IPC reçu du serveur web) et déclenche le moteur
 * scènes/chasers (src/engine/midi-actions.ts) avec les sources arbitre
 * 'remote' (LTP 70) / 'remote-chaser' (LTP 70). Pousse aussi un snapshot
 * d'état (`remote:state`) vers le main toutes les 500 ms pour les clients web.
 *
 * Monté UNE SEULE FOIS dans app.tsx (global, juste à côté de useMidiTriggers).
 *
 * ─── CONTRAT INTER-AGENTS (agent serveur lot #17 - electron) ─────────────
 * Le preload DOIT exposer (contextBridge, sur window.lightMaestro.remote) :
 *   - onCommand(cb: (cmd: RemoteCommand) => void) => () => void
 *       ipcRenderer.on('remote:command', (_e, cmd) => cb(cmd))
 *       (retourne l'unsubscribe, comme midi.onTrigger)
 *   - pushState(snapshot: RemoteStateSnapshot) => void
 *       ipcRenderer.send('remote:state', snapshot)
 * Et pour que `{ type: 'grandMaster', value }` fonctionne, le main doit
 * exposer le canal `dmx:applyGrandMaster` (dmxEngine.applyGrandMaster(level))
 * et le preload `dmx.applyGrandMaster(level)` - optionnel : sans lui, la
 * commande grandMaster est ignorée proprement (log debug), les autres
 * commandes restent actives.
 * Tant que le preload n'expose pas `remote`, le hook se désactive en partie
 * sans crasher (cast défensif local + gardes typeof).
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react';
import {
  getActiveChasers,
  getActiveSceneIds,
  remoteChaserNext,
  remoteChaserPrevious,
  remotePlayChaser,
  remotePlayScene,
  remoteStopChaser,
  remoteStopScene,
  remoteToggleScene,
} from '../engine/midi-actions';
import { vcButtonPress, vcSetSliderFraction } from '../engine/virtual-console-runtime';
import { useAppStore } from '../stores/appStore';
import { usePerformStore } from '../stores/performStore';
import { useShowStore } from '../stores/showStore';
import { getLatencyMs } from '../utils/latency-meter';

// ─── Types du contrat remote (miroir local de ce que l'agent serveur
// ─── enverra sur `remote:command` / attendra sur `remote:state`) ─────────
// NOTE : types.d.ts sera synchronisé quand le preload existera (agent
// serveur, lot #17) - on écrit contre ce contrat local en attendant.

export type RemoteSceneAction = 'play' | 'stop' | 'toggle';
export type RemoteChaserAction = 'play' | 'stop' | 'next' | 'previous';

/** Commande normalisée reçue du main (canal `remote:command`). */
export type RemoteCommand =
  | { type: 'scene'; id: string; action?: RemoteSceneAction }
  | { type: 'chaser'; id: string; action?: RemoteChaserAction }
  | { type: 'blackout'; on?: boolean }
  | { type: 'grandMaster'; value?: number }
  /**
   * Widget de la Console Virtuelle piloté à distance (POST /api/widget/:id).
   * `slider` attend `value` (fraction 0..1 du range du fader).
   */
  | { type: 'widget'; id: string; action?: 'press' | 'release' | 'toggle' | 'slider'; value?: number };

export interface RemoteSceneState {
  id: string;
  name: string;
  active: boolean;
}

export interface RemoteChaserState {
  id: string;
  name: string;
  active: boolean;
  stepIndex: number;
}

/** Snapshot poussé au main (canal `remote:state`), throttlé 500 ms. */
export interface RemoteStateSnapshot {
  scenes: RemoteSceneState[];
  chasers: RemoteChaserState[];
  blackout: boolean;
  /** Niveau du grand master 0..1 (source de vérité : moteur main getStatus). */
  grandMaster: number;
  /** Latence renderer (latency-meter), null si aucun échantillon. */
  latencyMs: number | null;
  dmxRunning: boolean;
  timestamp: number;
}

/** Intervalle de push du snapshot (500 ms, throttlé avec garde anti-recouvrement). */
const PUSH_INTERVAL_MS = 500;

// ─── Accès défensif au preload ───────────────────────────────────────────
// Le preload de l'agent serveur (lot #17) n'existe pas encore : on cast
// `window.lightMaestro` en type local pour ne pas dépendre de types.d.ts.

interface RemotePreloadApi {
  onCommand?: (cb: (cmd: RemoteCommand) => void) => unknown;
  pushState?: (snapshot: RemoteStateSnapshot) => void;
  getStatus?: () => Promise<{ running: boolean }>;
}

interface RemoteDmxApi {
  blackout?: () => Promise<void>;
  restore?: () => Promise<void>;
  applyGrandMaster?: (level: number) => Promise<void>;
  getStatus?: () => Promise<unknown>;
}

function getRemoteApi(): RemotePreloadApi | undefined {
  return (window as unknown as { lightMaestro?: { remote?: RemotePreloadApi } }).lightMaestro?.remote;
}

function getDmxApi(): RemoteDmxApi | undefined {
  return (window as unknown as { lightMaestro?: { dmx?: RemoteDmxApi } }).lightMaestro?.dmx;
}

function clamp01(value: unknown): number | null {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
}

// ─── Dispatch des commandes ──────────────────────────────────────────────

function dispatchCommand(cmd: RemoteCommand): void {
  switch (cmd.type) {
    case 'scene': {
      // Un bouton web de scène = toggle par défaut (action explicite sinon).
      const action = cmd.action ?? 'toggle';
      if (action === 'play') remotePlayScene(cmd.id);
      else if (action === 'stop') remoteStopScene(cmd.id);
      else remoteToggleScene(cmd.id);
      return;
    }

    case 'chaser': {
      const action = cmd.action ?? 'play';
      if (action === 'play') remotePlayChaser(cmd.id);
      else if (action === 'stop') remoteStopChaser(cmd.id);
      else if (action === 'next') remoteChaserNext(cmd.id);
      else if (action === 'previous') remoteChaserPrevious(cmd.id);
      else console.warn(`[remote-trigger] chaser : action inconnue "${String(action)}" (id=${cmd.id})`);
      return;
    }

    case 'widget': {
      // Widgets Console Virtuelle — délègue au runtime (registre indépendant
      // de la page active : la tuile répond même si son onglet n'est pas ouvert).
      const action = cmd.action ?? 'press';
      if (action === 'slider') {
        const v = clamp01(cmd.value);
        if (v === null) {
          console.warn('[remote-trigger] widget slider : value manquante ou hors [0,1] - commande ignorée');
          return;
        }
        if (!vcSetSliderFraction(cmd.id, v)) {
          console.warn(`[remote-trigger] widget slider introuvable ou non-slider (id=${cmd.id})`);
        }
        return;
      }
      if (action === 'release') {
        if (!vcButtonPress(cmd.id, false)) {
          console.warn(`[remote-trigger] widget introuvable (id=${cmd.id})`);
        }
        return;
      }
      if (action === 'toggle') {
        const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === cmd.id);
        const flash = widget?.type === 'button' && widget.config?.flashMode === 'flash';
        if (!vcButtonPress(cmd.id, true)) {
          console.warn(`[remote-trigger] widget introuvable (id=${cmd.id})`);
          return;
        }
        // Un bouton flash ne « vit » que pendant la pression : l'impulsion web
        // est donc press immédiat + release (sinon il resterait allumé).
        if (flash) vcButtonPress(cmd.id, false);
        return;
      }
      if (!vcButtonPress(cmd.id, true)) {
        console.warn(`[remote-trigger] widget introuvable (id=${cmd.id})`);
      }
      return;
    }

    case 'blackout': {
      // on !== false → blackout ; on === false → restore. Le serveur web
      // envoie explicitement on:false pour lever le blackout.
      const api = getDmxApi();
      if (cmd.on === false) {
        if (!api?.restore) console.debug('[remote-trigger] blackout off : dmx.restore non exposé - ignoré');
        else void api.restore();
        useAppStore.getState().setBlackout(false);
      } else {
        if (!api?.blackout) console.debug('[remote-trigger] blackout on : dmx.blackout non exposé - ignoré');
        else void api.blackout();
        useAppStore.getState().setBlackout(true);
      }
      return;
    }

    case 'grandMaster': {
      const level = clamp01(cmd.value);
      if (level === null) {
        console.warn('[remote-trigger] grandMaster : value manquante ou invalide, commande ignorée');
        return;
      }
      const api = getDmxApi();
      if (!api?.applyGrandMaster) {
        console.debug(
          '[remote-trigger] grandMaster : dmx.applyGrandMaster non exposé par le preload (contrat lot #17) - commande ignorée'
        );
        return;
      }
      void api.applyGrandMaster(level);
      // Miroir store (0-255) pour que le snapshot/la 3D restent cohérents.
      useAppStore.getState().setGrandMaster(Math.round(level * 255));
      return;
    }
  }
}

// ─── Snapshot d'état ─────────────────────────────────────────────────────
// Source de vérité pour blackout/grandMaster : getStatus() du moteur main
// (l'engine main applique déjà blackout/grandMaster pour MIDI, le store
// renderer ne les reflète pas). Repli sur le miroir appStore si l'API dmx
// n'est pas joignable (dev browser).

async function buildSnapshot(): Promise<RemoteStateSnapshot> {
  const show = useShowStore.getState();
  const app = useAppStore.getState();
  const activeScenes = new Set(getActiveSceneIds());
  const activeChasers = new Map<string, number>(getActiveChasers().map((c) => [c.id, c.stepIndex]));

  let blackout = app.dmx.blackout;
  let grandMaster = app.dmx.grandMaster / 255;
  try {
    const status = (await getDmxApi()?.getStatus?.()) as
      | { blackout?: boolean; grandMaster?: number }
      | undefined;
    if (status) {
      if (typeof status.blackout === 'boolean') blackout = status.blackout;
      const gm = Number(status.grandMaster);
      if (Number.isFinite(gm)) grandMaster = gm;
    }
  } catch {
    /* moteur indisponible - on garde le miroir store */
  }

  return {
    scenes: show.scenes.map((s) => ({ id: s.id, name: s.name, active: activeScenes.has(s.id) })),
    chasers: show.chasers.map((c) => {
      const stepIndex = activeChasers.get(c.id);
      return {
        id: c.id,
        name: c.name,
        active: stepIndex !== undefined,
        stepIndex: stepIndex ?? 0,
      };
    }),
    blackout,
    grandMaster,
    latencyMs: getLatencyMs(),
    dmxRunning: app.dmx.running,
    timestamp: Date.now(),
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────

/**
 * Monte le pont Remote web LAN : abonnement `remote:command` + push d'état
 * `remote:state` (500 ms). Désabonnement et clearInterval au unmount.
 */
export function useRemoteTriggers(): void {
  useEffect(() => {
    const remote = getRemoteApi();
    if (!remote) {
      console.debug('[remote-trigger] API remote absente du preload (contrat lot #17) - hook inactif');
      return;
    }

    const cleanups: Array<() => void> = [];

    // ── Entrée : remote:command ──
    if (typeof remote.onCommand === 'function') {
      const handle = (raw: unknown): void => {
        if (!raw || typeof raw !== 'object') return;
        const cmd = raw as RemoteCommand;
        console.debug(`[remote-trigger] commande reçue : ${JSON.stringify(cmd)}`);
        try {
          dispatchCommand(cmd);
        } catch (e) {
          console.warn('[remote-trigger] dispatch échoué', e);
        }
      };
      // Contrat : onCommand(cb) → unsubscribe (comme midi.onTrigger). Le
      // preload pas encore à jour retourne void → listener global acceptable
      // (monté au niveau racine, l'App ne se démonte jamais en pratique).
      const ret = remote.onCommand(handle) as unknown;
      const unsubscribe = typeof ret === 'function' ? (ret as () => void) : undefined;
      if (unsubscribe) cleanups.push(unsubscribe);
      else console.debug("[remote-trigger] onCommand ne retourne pas d'unsubscribe (preload partiel) - listener global");
    } else {
      console.debug('[remote-trigger] remote.onCommand absent - commandes web ignorées');
    }

    // ── Sortie : remote:state (push throttlé 500 ms) ──
    if (typeof remote.pushState === 'function') {
      let inFlight = false;
      // Ne pousse que si le serveur LAN tourne (pas d'IPC permanent ~4/s
      // quand le serveur est arrêté). Rafraîchi toutes les 3 s.
      let serverRunning = false;
      const refreshStatus = async (): Promise<void> => {
        try {
          const st = typeof remote.getStatus === 'function' ? await remote.getStatus() : null;
          serverRunning = !!st?.running;
        } catch {
          serverRunning = false;
        }
      };
      void refreshStatus();
      const statusTimer = window.setInterval(() => {
        void refreshStatus();
      }, 3000);
      cleanups.push(() => window.clearInterval(statusTimer));

      const push = async (): Promise<void> => {
        if (inFlight || !serverRunning) return; // pas de recouvrement ni de push si serveur éteint
        inFlight = true;
        try {
          const snapshot = await buildSnapshot();
          remote.pushState?.(snapshot);
        } catch (e) {
          console.warn("[remote-trigger] push d'état échoué", e);
        } finally {
          inFlight = false;
        }
      };
      const timer = window.setInterval(() => {
        void push();
      }, PUSH_INTERVAL_MS);
      cleanups.push(() => window.clearInterval(timer));
    } else {
      console.debug("[remote-trigger] remote.pushState absent - pas de push d'état");
    }

    return () => {
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* best effort */
        }
      }
    };
  }, []);
}
