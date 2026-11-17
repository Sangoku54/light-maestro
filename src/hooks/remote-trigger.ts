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
  midiCueListGo,
  midiCueListBack,
  midiCueListStop,
  midiPlaySongPreset,
  midiStopSongPreset,
} from '../engine/midi-actions';
import { vcPressWidget, vcSetSliderFraction } from '../engine/virtual-console-runtime';
import { vcPlaybackActiveIds } from '../engine/vc-playback-runtime';
import { useAppStore } from '../stores/appStore';
import { usePerformStore, type ConsoleWidget } from '../stores/performStore';
import { useGroupMastersStore } from '../stores/groupMastersStore';
import { useShowStore, findBestSongPreset, presetHasAudio } from '../stores/showStore';
import { getLatencyMs } from '../utils/latency-meter';

// ─── Types du contrat remote (miroir local de ce que l'agent serveur
// ─── enverra sur `remote:command` / attendra sur `remote:state`) ─────────
// NOTE : types.d.ts sera synchronisé quand le preload existera (agent
// serveur, lot #17) - on écrit contre ce contrat local en attendant.

export type RemoteSceneAction = 'play' | 'stop' | 'toggle';
export type RemoteChaserAction = 'play' | 'stop' | 'next' | 'previous';
export type RemoteCueListAction = 'go' | 'back' | 'stop';

/** Commande normalisée reçue du main (canal `remote:command`). */
export type RemoteCommand =
  | { type: 'scene'; id: string; action?: RemoteSceneAction }
  | { type: 'chaser'; id: string; action?: RemoteChaserAction }
  | { type: 'cueList'; id: string; action?: RemoteCueListAction }
  | { type: 'songPreset'; id: string; action?: 'play' | 'stop' }
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

export interface RemoteCueListEntry {
  id: string;
  name: string;
  active: boolean;
  currentCueIndex: number;
  totalCues: number;
}

export interface RemoteSongPresetEntry {
  id: string;
  name: string;
  active: boolean;
  hasAudio: boolean;
  duration: number;
}

/** Snapshot poussé au main (canal `remote:state`), throttlé 500 ms. */
export interface RemoteStateSnapshot {
  scenes: RemoteSceneState[];
  chasers: RemoteChaserState[];
  /** Cue Lists (séquences pré-programmées : go / back / stop). */
  cueLists?: RemoteCueListEntry[];
  /** SongPresets (QuickShow : presets pré-enregistrés audio + DMX). */
  songPresets?: RemoteSongPresetEntry[];
  /** Widgets de la Console Virtuelle (boutons + faders), exposés au Remote. */
  widgets?: RemoteWidgetEntry[];
  /** Noms des pages de la Console Virtuelle (pour le regroupement). */
  vcPages?: string[];
  blackout: boolean;
  /** Niveau du grand master 0..1 (source de vérité : moteur main getStatus). */
  grandMaster: number;
  /** Latence renderer (latency-meter), null si aucun échantillon. */
  latencyMs: number | null;
  dmxRunning: boolean;
  timestamp: number;
}

/** Widget de Console Virtuelle exposé au Remote (bouton ou fader). */
export interface RemoteWidgetEntry {
  id: string;
  type: 'button' | 'slider';
  /** Index de la page de la Console Virtuelle. */
  pageIndex: number;
  /** Libellé résolu (nom de scène / chaser / preset). */
  label: string;
  /** Type d'action du widget (scene, chaser, playSong, audioAutoScript…). */
  actionType: string;
  /** Couleur configurée dans la Console Virtuelle (hex). */
  color: string;
  /** 'flash' ou 'toggle' (vide = toggle). */
  flashMode: string;
  /** Bornes du fader (sliders uniquement). */
  min?: number;
  max?: number;
  /** Valeur courante du fader (sliders uniquement). */
  value?: number;
  /** Tuile « allumée » (scène en cours, preset en lecture…). */
  active: boolean;
}

/** Intervalle de push du snapshot (500 ms, throttlé avec garde anti-recouvrement). */
const PUSH_INTERVAL_MS = 500;

// ─── Flash (bouton momentané) piloté depuis le téléphone ──────────────────

/**
 * Relâchements programmés (widgetId → timer) : évite qu'un second tap
 * n'annule ou ne double le relâchement du premier.
 */
const pendingFlashReleases = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Durée de maintien d'un bouton « flash » déclenché depuis le Remote.
 *
 * Sur le PC, le bouton est relâché au relâchement de la souris : le moteur a
 * donc le temps de RENDRE la scène (quelques frames). Depuis la page mobile,
 * un tap produit un press+release synchrone : la scène était annulée avant
 * le moindre rendu → flash invisible. On impose donc un maintien minimal :
 *   - scène   : la durée de son fondu d'entrée (+ marge) → le flash est
 *               réellement visible, puis la scène s'éteint ;
 *   - chaser  : 1 s (au moins un pas de séquence visible) ;
 *   - autre   : 250 ms (noir, GM, canal DMX).
 */
export function flashHoldMs(widget: ConsoleWidget): number {
  const cfg = widget.config ?? {};
  if (cfg.actionType === 'scene') {
    const sceneId = typeof cfg.sceneId === 'string' ? cfg.sceneId : '';
    const scene = sceneId ? useShowStore.getState().scenes.find((s) => s.id === sceneId) : undefined;
    const fadeIn = Number(scene?.fadeIn ?? 0);
    return Math.max(200, Math.min(3000, (Number.isFinite(fadeIn) ? fadeIn : 0) + 150));
  }
  if (cfg.actionType === 'chaser') return 1000;
  return 250;
}

/** Programme le relâchement différé d'un bouton flash. */
export function scheduleFlashRelease(widgetId: string, widget: ConsoleWidget): void {
  const pending = pendingFlashReleases.get(widgetId);
  if (pending) {
    clearTimeout(pending);
    pendingFlashReleases.delete(widgetId);
  }
  const timer = setTimeout(() => {
    pendingFlashReleases.delete(widgetId);
    try {
      vcPressWidget(widgetId, false);
    } catch {
      /* widget supprimé entre-temps */
    }
  }, flashHoldMs(widget));
  pendingFlashReleases.set(widgetId, timer);
}

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

/** Test hook : dispatch direct d'une commande Remote (sans passer par l'IPC). */
export function __dispatchRemoteCommand(cmd: RemoteCommand): void {
  dispatchCommand(cmd);
}

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

    case 'cueList': {
      // Cue Lists (théâtre) : go = repère suivant, back = précédent, stop = reset.
      // Délègue aux fonctions MIDI existantes (midiCueListGo/Back/Stop).
      const action = cmd.action ?? 'go';
      if (action === 'go') midiCueListGo(cmd.id);
      else if (action === 'back') midiCueListBack(cmd.id);
      else if (action === 'stop') midiCueListStop(cmd.id);
      else console.warn(`[remote-trigger] cueList : action inconnue "${String(action)}" (id=${cmd.id})`);
      return;
    }

    case 'songPreset': {
      // SongPreset (QuickShow) : play = lance le preset (audio + DMX), stop = arrête.
      // Délègue au handler MIDI existant (midiPlaySongPreset / midiStopSongPreset).
      const action = cmd.action ?? 'play';
      if (action === 'play') midiPlaySongPreset(cmd.id);
      else if (action === 'stop') midiStopSongPreset();
      else console.warn(`[remote-trigger] songPreset : action inconnue "${String(action)}" (id=${cmd.id})`);
      return;
    }

    case 'widget': {
      // Widgets Console Virtuelle — délègue au runtime partagé
      // (`vcPressWidget`), qui couvre les DEUX familles d'actions :
      //   - « simple »   : scene, chaser, blackout, grandMaster, dmxChannel ;
      //   - « playback » : playSong, audioAutoScript, autoLoop, bankLoop, loadShow.
      // Un preset lancé depuis le téléphone joue donc l'audio + l'autoscript +
      // les lumières, exactement comme un clic sur la tuile du PC.
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
        if (!vcPressWidget(cmd.id, false)) {
          console.warn(`[remote-trigger] widget introuvable (id=${cmd.id})`);
        }
        return;
      }
      if (action === 'toggle') {
        const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === cmd.id);
        const flash = widget?.type === 'button' && widget.config?.flashMode === 'flash';
        if (!vcPressWidget(cmd.id, true)) {
          console.warn(`[remote-trigger] widget introuvable ou non pilotable (id=${cmd.id})`);
          return;
        }
        // Un bouton flash ne « vit » que pendant la pression. La page mobile
        // envoie un simple « toggle » (un tap) : on relâche donc APRÈS un
        // délai minimal, sinon press+release dans la MÊME frame annulait la
        // scène avant qu'elle n'ait eu le temps d'être rendue (flash
        // invisible côté téléphone).
        if (flash) scheduleFlashRelease(cmd.id, widget);
        return;
      }
      if (!vcPressWidget(cmd.id, true)) {
        console.warn(`[remote-trigger] widget introuvable ou non pilotable (id=${cmd.id})`);
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
    cueLists: show.cueLists.map((cl) => ({
      id: cl.id,
      name: cl.name,
      active: cl.currentCueIndex >= 0,
      currentCueIndex: cl.currentCueIndex,
      totalCues: cl.cues.length,
    })),
    songPresets: show.songPresets.map((sp) => ({
      id: sp.id,
      name: sp.name,
      active: false, // SongPreset n'a pas d'état "actif" persistant
      hasAudio: presetHasAudio(sp),
      duration: sp.trackAnalysis?.duration || 0,
    })),
    widgets: buildWidgetSnapshot(),
    vcPages: usePerformStore.getState().vcPages.map((p) => p.name),
    blackout,
    grandMaster,
    latencyMs: getLatencyMs(),
    dmxRunning: app.dmx.running,
    timestamp: Date.now(),
  };
}

// ─── Snapshot de la Console Virtuelle ────────────────────────────────────
// Les widgets sont exposés au Remote (télécommande LAN) : boutons (avec leur
// couleur et leur état « allumé ») et faders (avec leur valeur). Le libellé
// est résolu côté PC (nom de la scène / du chaser / du preset) pour que la
// tablette affiche du texte lisible et non des identifiants techniques.

export function buildWidgetSnapshot(): RemoteWidgetEntry[] {
  const perf = usePerformStore.getState();
  const show = useShowStore.getState();
  const activeIds = new Set(vcPlaybackActiveIds());
  const groupMasters = useGroupMastersStore.getState().values;

  return perf.vcWidgets
    // Les masters de groupe sont exposés comme des FADERS : sans eux, le
    // téléphone ne pouvait pas piloter le plafond d'un groupe de fixtures.
    .filter((w) => w.type === 'button' || w.type === 'slider' || w.type === 'group-master')
    .map((w) => {
      const cfg = w.config ?? {};
      const isGroupMaster = w.type === 'group-master';
      let label = cfg.label || '';
      if (!label) {
        if (isGroupMaster) {
          label = show.fixtureGroups.find((g) => g.id === cfg.groupId)?.name || 'Master';
        } else if (cfg.actionType === 'scene' && cfg.sceneId) {
          label = show.scenes.find((s) => s.id === cfg.sceneId)?.name || '';
        } else if (cfg.actionType === 'chaser' && cfg.chaserId) {
          label = show.chasers.find((c) => c.id === cfg.chaserId)?.name || '';
        } else if (cfg.actionType === 'playSong') {
          const preset = cfg.songId
            ? findBestSongPreset(show.songPresets, cfg.songId, cfg.songName)
            : null;
          label = preset?.name || cfg.songName || '';
        } else if (cfg.actionType === 'audioAutoScript') {
          label = cfg.audioFileName || '';
        } else if (cfg.actionType === 'loadShow') {
          label = cfg.showName || '';
        } else if (cfg.actionType === 'dmxChannel') {
          label = `U${(cfg.dmxUniverse ?? 0) + 1} C${cfg.dmxAddress ?? '?'}`;
        } else if (cfg.actionType === 'grandMaster') {
          label = 'Grand Master';
        } else if (cfg.actionType === 'blackout') {
          label = 'Noir';
        }
      }
      const isSlider = w.type === 'slider' || isGroupMaster;
      const min = isGroupMaster ? 0 : Number(cfg.min ?? 0);
      const max = isGroupMaster ? 255 : Number(cfg.max ?? 255);
      // Source de vérité du plafond : groupMastersStore (le store des widgets
      // ne suit que le dernier mouvement de fader).
      const value = isGroupMaster
        ? (typeof groupMasters[cfg.groupId ?? ''] === 'number' ? groupMasters[cfg.groupId ?? ''] : 255)
        : perf.vcWidgetValues[w.id];
      return {
        id: w.id,
        type: isSlider ? 'slider' : 'button',
        pageIndex: w.pageIndex,
        label,
        actionType: isGroupMaster ? 'groupMaster' : (cfg.actionType || ''),
        color: cfg.color || '',
        flashMode: cfg.flashMode || '',
        min: isSlider ? min : undefined,
        max: isSlider ? max : undefined,
        value: isSlider ? (typeof value === 'number' ? value : min) : undefined,
        active: activeIds.has(w.id),
      };
    });
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
