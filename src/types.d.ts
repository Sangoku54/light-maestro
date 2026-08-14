/// <reference types="vite/client" />

// NOTE: `export {}` makes this file a module so the `declare global`
// augmentation below is legal (TS2669 otherwise) and actually applied
// to Window - without it, `window.lightMaestro` stays unknown everywhere.

export {};

// MIDI types are defined once in the main process (electron/midi/manager.ts)
// and shared with the renderer through the preload API below.
import type { MidiDevice, MidiMapping, MidiTarget } from '@electron/midi/manager';

/** One external sACN source seen on a monitored universe. */
export interface SacnNetworkSource {
  cid: string;
  name: string;
  address: string;
  priority: number;
  active: boolean;
  lastSeenAt: number;
  packets: number;
  fps: number;
}

/** Per-universe sACN network state: what leaves (tx) and what arrives (rx). */
export interface SacnNetworkUniverse {
  universe: number;
  universeId: string;
  name: string;
  priority: number;
  // TX side
  outputEnabled: boolean;
  txActive: boolean;
  txFps: number;
  txPackets: number;
  txLastSendAt: number;
  // RX side
  receiveEnabled: boolean;
  receiving: boolean;
  rxFps: number;
  rxPps: number;
  rxPackets: number;
  rxLastFrameAt: number;
  sources: SacnNetworkSource[];
  mergeOutput: boolean;
}

/** `getStatus().network` - global sACN monitoring snapshot. */
export interface SacnNetworkStatus {
  enabled: boolean;
  errors: string[];
  universes: SacnNetworkUniverse[];
}

// ─── Remote web LAN (serveur HTTP embarqué, électron/remote/server.ts) ─────
// Miroir du contrat défini dans le main process : les types y sont définis
// dans electron/remote/server.ts et servis par l'IPC `remote:getStatus`.

/** Statut du serveur LAN retourné par `remote.getStatus()`. */
export interface RemoteStatus {
  running: boolean;
  port: number;
  /** Timestamp (ms) du dernier démarrage, null si arrêté. */
  startedAt: number | null;
  /** URLs d'accès LAN `http://<ip>:<port>/?token=<token>` (une par IPv4 non-internal). */
  urls: string[];
  /** Erreur du dernier démarrage (ex. EADDRINUSE), null si aucun souci. */
  lastError: string | null;
}

/** Entrée d'une scène dans le snapshot poussé au serveur HTTP. */
export interface RemoteSceneEntry {
  id: string;
  name?: string;
  active?: boolean;
}

/** Entrée d'un chaser dans le snapshot poussé au serveur HTTP. */
export interface RemoteChaserEntry {
  id: string;
  name?: string;
  active?: boolean;
}

/**
 * Snapshot servi par `GET /api/state` - le renderer le pousse sur le canal
 * `remote:state` (forme `{ state: RemoteStateSnapshot }` ou snapshot direct,
 * cf. src/hooks/remote-trigger.ts qui pousse la forme directe).
 */
export interface RemoteStateSnapshot {
  scenes?: RemoteSceneEntry[];
  chasers?: RemoteChaserEntry[];
  blackout?: boolean;
  grandMaster?: number;
  /** Latence renderer (latency-meter), null si aucun échantillon. */
  latencyMs?: number | null;
  dmxRunning?: boolean;
  timestamp?: number;
}

interface LightMaestroAPI {
  dmx: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    setChannel: (universe: number, channel: number, value: number) => Promise<void>;
    setChannels: (universe: number, channels: Record<number, number>) => Promise<void>;
    blackout: () => Promise<void>;
    restore: () => Promise<void>;
    getUniverses: () => Promise<any[]>;
    getStatus: () => Promise<any>;
    addUniverse: (config: any) => Promise<void>;
    syncUniverses: (configs: any[]) => Promise<void>;
    removeUniverse: (id: string) => Promise<void>;
    /** Toggle sACN reception for a universe; returns the fresh status. */
    setSacnReceive: (id: string, enabled: boolean) => Promise<any>;
    listSerialPorts: () => Promise<any[]>;
    isRunning: () => Promise<boolean>;
    /** Grand master 0..1 appliqué au moteur DMX (canal ajouté lot #17). */
    applyGrandMaster: (value: number) => Promise<void>;
    onError: (callback: (msg: string) => void) => () => void;
  };
  fixtures: {
    loadLibrary: () => Promise<any[]>;
    search: (query: string) => Promise<any[]>;
    getDefinition: (id: string) => Promise<any>;
    addCustom: (def: any) => Promise<void>;
    importQLC: (filePath: string) => Promise<any>;
    getAll: () => Promise<any[]>;
    reloadLibrary: () => Promise<{ count: number }>;
    getUpdateStatus: () => Promise<{ checking: boolean; lastCheck: number; lastSha: string; newCount: number; error?: string }>;
    onUpdateStatus: (callback: (status: any) => void) => void;
    onUpdateComplete: (callback: (data: { newCount: number }) => void) => void;
  };
  show: {
    save: (show: any, filePath?: string | { filePath: string; name: string }) => Promise<string>;
    load: (filePath: string) => Promise<any>;
    listRecent: () => Promise<string[]>;
    openDialog: () => Promise<any | null>;
  };
  midi: {
    listDevices: () => Promise<MidiDevice[]>;
    connect: (deviceId: string) => Promise<void>;
    disconnect: () => Promise<void>;
    getMapping: () => Promise<MidiMapping[]>;
    setMapping: (mapping: MidiMapping[]) => Promise<void>;
    addMapping: (mapping: MidiMapping) => Promise<void>;
    removeMapping: (id: string) => Promise<void>;
    startLearn: (target: MidiTarget) => Promise<void>;
    stopLearn: () => Promise<void>;
    onActivity: (cb: (a: { channel: number; type: string; note: number; value?: number }) => void) => () => void;
    onTrigger: (cb: (t: { mapping: MidiMapping; value: number; rawValue: number }) => void) => () => void;
    onStatus: (cb: (s: { connected: boolean; deviceId?: string }) => void) => () => void;
    onClock: (cb: (c: { bpm: number; running: boolean }) => void) => () => void;
    onMappingChanged: (cb: (m: MidiMapping[]) => void) => void;
  };
  audio: {
    getDevices: () => Promise<any[]>;
    startCapture: (deviceId: string) => Promise<void>;
    stopCapture: () => Promise<void>;
    pushBuffer: (buffer: Float32Array) => void;
    onAnalysis: (callback: (analysis: any) => void) => void;
    importFile: () => Promise<{ fileName: string; filePath: string; dataUrl: string } | null>;
  };
  dialog: {
    openFile: (filters: any[]) => Promise<{ filePath: string; content: string; name: string } | null>;
    saveFile: (filters: any[], defaultName: string, content: string) => Promise<{ filePath: string; name: string } | null>;
  };
  project: {
    save: (content: string) => Promise<string | { filePath: string } | null>;
    open: () => Promise<{ content: string; filePath: string } | null>;
  };
  presets: {
    save: (presets: any[]) => Promise<void>;
    load: () => Promise<any[] | null>;
  };
  storage: {
    get: (key: string) => Promise<any>;
    set: (key: string, data: any) => Promise<boolean>;
    remove: (key: string) => Promise<void>;
  };
  app: {
    onBeforeClose: (callback: () => void) => () => void;
    closeAction: (action: 'save-and-quit' | 'discard') => Promise<void>;
  };
  remote: {
    /** Statut du serveur LAN (running, port, URLs d'accès avec token). */
    getStatus: () => Promise<RemoteStatus>;
    /** Démarre le serveur HTTP embarqué. */
    start: () => Promise<RemoteStatus>;
    /** Arrête le serveur HTTP embarqué. */
    stop: () => Promise<RemoteStatus>;
    /** Commande reçue par le serveur LAN, forwardée au renderer (désabonnement). */
    onCommand: (callback: (cmd: unknown) => void) => () => void;
    /** Snapshot d'état poussé par le renderer vers le serveur LAN (cache HTTP). */
    pushState: (snapshot: RemoteStateSnapshot) => void;
  };
}

declare global {
  interface Window {
    lightMaestro: LightMaestroAPI;
  }
}
