/// <reference types="vite/client" />

// NOTE: `export {}` makes this file a module so the `declare global`
// augmentation below is legal (TS2669 otherwise) and actually applied
// to Window - without it, `window.lightMaestro` stays unknown everywhere.

export {};

// MIDI types are defined once in the main process (electron/midi/manager.ts)
// and shared with the renderer through the preload API below.
import type { MidiDevice, MidiMapping, MidiTarget } from '@electron/midi/manager';
import type { MtcRate, MtcState } from '@electron/midi/mtc';

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
  /** Vrai pendant la fenêtre asynchrone entre `listen()` et l'event `listening`/`error`. */
  starting: boolean;
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

/**
 * Statut du serveur OSC (électron/osc/server.ts) servi par `osc:getStatus`.
 * Les compteurs `packetsReceived`/`lastAddress` alimentent le voyant
 * d'activité du panneau OSC (preuve qu'un contrôleur parle bien au serveur).
 */
export interface OscStatus {
  running: boolean;
  /** Vrai pendant la fenêtre asynchrone entre `bind()` et l'event `listening`/`error`. */
  starting: boolean;
  port: number;
  /** Timestamp (ms) du dernier démarrage, null si arrêté. */
  startedAt: number | null;
  /** Erreur du dernier démarrage (ex. EADDRINUSE), null si aucun souci. */
  lastError: string | null;
  /** Nombre total de messages OSC traités (un datagramme bundle en compte plusieurs). */
  packetsReceived: number;
  /** Dernière adresse OSC traitée (voyant d'activité UI). */
  lastAddress: string | null;
  /** Timestamp (ms) de la dernière activité, null si aucune. */
  lastActivityAt: number | null;
}

/**
 * Commande OSC normalisée émise au renderer (canal `osc:command`). Miroir de
 * `RemoteCommand` (electron/remote/server.ts) + résolution par index 1-based
 * (`index` est 0-based dans la commande, cf. electron/osc/server.ts).
 */
export type OscCommand =
  | { type: 'scene'; id?: string; index?: number; action: 'play' | 'stop' | 'toggle' }
  | { type: 'chaser'; id?: string; index?: number; action: 'play' | 'stop' | 'next' | 'previous' }
  | { type: 'blackout'; on: boolean }
  | { type: 'grandMaster'; value: number };

// ─── Auto-Update ───
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

// ─── Crash Reporting ───
export interface CrashLogNotification {
  type: string;
  message: string;
  timestamp: number;
}

export interface CrashLogEntry {
  filename: string;
  size: number;
  mtime: number;
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
    importGDTF: (filePath: string) => Promise<any>;
    getAll: () => Promise<any[]>;
    getBudgetList: () => Promise<{ entries: { manufacturer: string; model: string; priceMin?: number; priceMax?: number; priceLabel?: string; type?: string; tags?: string[] }[] }>;
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
    /** État MTC (lot #15) : frame décodée / Full Frame / transition lock. */
    onMtc: (cb: (s: MtcState) => void) => () => void;
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
    save: (payload: { content: string; blobs?: { key: string; audioFileBase64: string }[] }) => Promise<string | { filePath: string } | null | false>;
    open: () => Promise<{ content: string; filePath: string; blobs?: { key: string; audioFileBase64: string }[] } | null>;
  };
  presets: {
    save: (presets: any[]) => Promise<void>;
    load: () => Promise<any[] | null>;
  };
  lastAudio: {
    save: (map: Record<string, { base64: string; fileName?: string; ts: string }>) => Promise<boolean>;
    load: () => Promise<Record<string, { base64: string; fileName?: string; ts: string }> | null>;
  };
  storage: {
    get: (key: string) => Promise<any>;
    set: (key: string, data: any) => Promise<boolean>;
    remove: (key: string) => Promise<void>;
    has: (key: string) => Promise<boolean>;
  };
  app: {
    setLocale: (locale: string) => Promise<void>;
    onBeforeClose: (callback: () => void) => () => void;
    closeAction: (action: 'save-and-quit' | 'discard') => Promise<void>;
    // Auto-update
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    installUpdate: () => Promise<boolean>;
    getUpdateStatus: () => Promise<UpdateStatus>;
    // Crash reporting
    onCrashLog: (callback: (data: CrashLogNotification) => void) => () => void;
    getCrashLogs: () => Promise<CrashLogEntry[]>;
    readCrashLog: (filename: string) => Promise<string | null>;
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

  // ─── OSC entrant (serveur UDP, electron/osc/server.ts) ───────────────────
  /** Statut du serveur OSC retourné par `osc.getStatus()`. */
  osc: {
    /** Statut du serveur UDP (running, port, compteurs d'activité). */
    getStatus: () => Promise<OscStatus>;
    /** Démarre le serveur UDP (port optionnel, défaut 9000 / env LM_OSC_PORT). */
    start: (port?: number) => Promise<OscStatus>;
    /** Arrête le serveur UDP et libère le port. */
    stop: () => Promise<OscStatus>;
    /** Commande OSC mappée reçue par le serveur UDP, forwardée au renderer. */
    onCommand: (callback: (cmd: unknown) => void) => () => void;
  };
}

declare global {
  interface Window {
    lightMaestro: LightMaestroAPI;
  }
}
