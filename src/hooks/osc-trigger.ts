/**
 * OSC Triggers Hook (lot #16 - OSC entrant) - consomme `osc:command`
 * (relayé par le main, canal IPC reçu du serveur UDP electron/osc/server.ts)
 * et déclenche le moteur scènes/chasers (src/engine/midi-actions.ts) avec
 * les sources arbitre 'osc' (LTP 71) / 'osc-chaser' (LTP 71).
 *
 * Monté UNE SEULE FOIS dans app.tsx (global, juste à côté de useRemoteTriggers
 * et useMidiTriggers).
 *
 * ─── CONTRAT (electron/osc/server.ts + electron/preload.ts) ──────────────
 * Le preload DOIT exposer (contextBridge, sur window.lightMaestro.osc) :
 *   - getStatus(): Promise<OscStatus>
 *   - start(port?: number): Promise<OscStatus>
 *   - stop(): Promise<OscStatus>
 *   - onCommand(cb: (cmd: OscCommand) => void) => () => void
 *       ipcRenderer.on('osc:command', (_e, cmd) => cb(cmd))
 * Le serveur n'envoie que des commandes MAPPÉES (mapOscAddress) - le hook
 * ne reçoit jamais d'adresse brute. Les commandes portent soit `id` (adresse
 * `/scene/<id>/...`), soit `index` 0-based (adresse `/scene/index/<n>/...`
 * où n est 1-based côté contrôleur) - l'index est résolu ici contre le show.
 * Blackout/grandMaster : mêmes chemins que Remote (dmx:applyGrandMaster
 * optionnel - ignoré proprement s'il manque).
 * ──────────────────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react';
import {
  oscChaserNext,
  oscChaserPrevious,
  oscPlayChaser,
  oscPlayScene,
  oscStopChaser,
  oscStopScene,
  oscToggleScene,
} from '../engine/midi-actions';
import { useAppStore } from '../stores/appStore';
import { useShowStore } from '../stores/showStore';

// ─── Types du contrat OSC (miroir local de electron/osc/server.ts) ───────

export type OscSceneAction = 'play' | 'stop' | 'toggle';
export type OscChaserAction = 'play' | 'stop' | 'next' | 'previous';

/** Commande normalisée reçue du main (canal `osc:command`). */
export type OscCommand =
  | { type: 'scene'; id?: string; index?: number; action: OscSceneAction }
  | { type: 'chaser'; id?: string; index?: number; action: OscChaserAction }
  | { type: 'blackout'; on: boolean }
  | { type: 'grandMaster'; value: number };

// ─── Accès défensif au preload ───────────────────────────────────────────

interface OscPreloadApi {
  onCommand?: (cb: (cmd: unknown) => void) => unknown;
}

interface OscDmxApi {
  blackout?: () => Promise<void>;
  restore?: () => Promise<void>;
  applyGrandMaster?: (level: number) => Promise<void>;
}

function getOscApi(): OscPreloadApi | undefined {
  return (window as unknown as { lightMaestro?: { osc?: OscPreloadApi } }).lightMaestro?.osc;
}

function getDmxApi(): OscDmxApi | undefined {
  return (window as unknown as { lightMaestro?: { dmx?: OscDmxApi } }).lightMaestro?.dmx;
}

function clamp01(value: unknown): number | null {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
}

// ─── Résolution index → id ───────────────────────────────────────────────
// Les adresses `/scene/index/<n>` et `/chaser/index/<n>` sont 1-based côté
// contrôleur (convention TouchOSC/QLC+) ; le serveur envoie `index` 0-based.
// L'ordre de référence est celui du show (scenes/chasers du store).

function resolveSceneId(cmd: { id?: string; index?: number }): string | null {
  if (cmd.id) return cmd.id;
  if (typeof cmd.index === 'number' && Number.isInteger(cmd.index) && cmd.index >= 0) {
    const scenes = useShowStore.getState().scenes;
    const scene = scenes[cmd.index];
    if (!scene) {
      console.warn(`[osc-trigger] scène index ${cmd.index + 1} introuvable (${scenes.length} scènes)`);
      return null;
    }
    return scene.id;
  }
  console.warn('[osc-trigger] commande scène sans id ni index - ignorée');
  return null;
}

function resolveChaserId(cmd: { id?: string; index?: number }): string | null {
  if (cmd.id) return cmd.id;
  if (typeof cmd.index === 'number' && Number.isInteger(cmd.index) && cmd.index >= 0) {
    const chasers = useShowStore.getState().chasers;
    const chaser = chasers[cmd.index];
    if (!chaser) {
      console.warn(`[osc-trigger] chaser index ${cmd.index + 1} introuvable (${chasers.length} chasers)`);
      return null;
    }
    return chaser.id;
  }
  console.warn('[osc-trigger] commande chaser sans id ni index - ignorée');
  return null;
}

// ─── Dispatch des commandes ──────────────────────────────────────────────

function dispatchCommand(cmd: OscCommand): void {
  switch (cmd.type) {
    case 'scene': {
      const id = resolveSceneId(cmd);
      if (!id) return;
      if (cmd.action === 'play') oscPlayScene(id);
      else if (cmd.action === 'stop') oscStopScene(id);
      else oscToggleScene(id);
      return;
    }

    case 'chaser': {
      const id = resolveChaserId(cmd);
      if (!id) return;
      if (cmd.action === 'play') oscPlayChaser(id);
      else if (cmd.action === 'stop') oscStopChaser(id);
      else if (cmd.action === 'next') oscChaserNext(id);
      else if (cmd.action === 'previous') oscChaserPrevious(id);
      else console.warn(`[osc-trigger] chaser : action inconnue "${String(cmd.action)}" (id=${id})`);
      return;
    }

    case 'blackout': {
      // on=true → blackout ; on=false → restore. Le serveur mappe
      // `/blackout` avec valeur non-zéro = ON (cf. mapOscAddress).
      const api = getDmxApi();
      if (!cmd.on) {
        if (!api?.restore) console.debug('[osc-trigger] blackout off : dmx.restore non exposé - ignoré');
        else void api.restore();
        useAppStore.getState().setBlackout(false);
      } else {
        if (!api?.blackout) console.debug('[osc-trigger] blackout on : dmx.blackout non exposé - ignoré');
        else void api.blackout();
        useAppStore.getState().setBlackout(true);
      }
      return;
    }

    case 'grandMaster': {
      const level = clamp01(cmd.value);
      if (level === null) {
        console.warn('[osc-trigger] grandMaster : value manquante ou invalide, commande ignorée');
        return;
      }
      const api = getDmxApi();
      if (!api?.applyGrandMaster) {
        console.debug(
          '[osc-trigger] grandMaster : dmx.applyGrandMaster non exposé par le preload (contrat lot #16) - commande ignorée'
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

// ─── Hook ────────────────────────────────────────────────────────────────

/**
 * Monte le pont OSC entrant : abonnement `osc:command`. Désabonnement au
 * unmount (aucun push : le serveur OSC est entrant pur, le feedback OSC out
 * est prévu au lot v2 via le snapshot `remote:state` existant).
 */
export function useOscTriggers(): void {
  useEffect(() => {
    const osc = getOscApi();
    if (!osc) {
      console.debug('[osc-trigger] API osc absente du preload (contrat lot #16) - hook inactif');
      return;
    }

    const cleanups: Array<() => void> = [];

    if (typeof osc.onCommand === 'function') {
      const handle = (raw: unknown): void => {
        if (!raw || typeof raw !== 'object') return;
        const cmd = raw as OscCommand;
        console.debug(`[osc-trigger] commande reçue : ${JSON.stringify(cmd)}`);
        try {
          dispatchCommand(cmd);
        } catch (e) {
          console.warn('[osc-trigger] dispatch échoué', e);
        }
      };
      const ret = osc.onCommand(handle) as unknown;
      const unsubscribe = typeof ret === 'function' ? (ret as () => void) : undefined;
      if (unsubscribe) cleanups.push(unsubscribe);
      else console.debug("[osc-trigger] onCommand ne retourne pas d'unsubscribe (preload partiel) - listener global");
    } else {
      console.debug('[osc-trigger] osc.onCommand absent - commandes OSC ignorées');
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
