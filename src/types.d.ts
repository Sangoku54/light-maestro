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

/** Client connecté au Remote (téléphone/tablette) — vu par le serveur HTTP. */
export interface RemoteClientEntry {
  /** Adresse IP distante. */
  ip: string;
  /** User-Agent du navigateur (pour identifier l'appareil). */
  agent: string;
  /** Timestamp de la 1re requête (ms). */
  firstSeen: number;
  /** Timestamp de la dernière requête (ms). */
  lastSeen: number;
  /** Nombre total de requêtes reçues. */
  requests: number;
}

/** Nature du réseau transportant une URL d'accès au Remote. */
export type RemoteNetworkKind = 'standalone' | 'wifi' | 'ethernet' | 'other';

/** Une interface réseau + l'URL d'accès correspondante (un QR par interface). */
export interface RemoteLanInterface {
  /** URL complète `http://<ip>:<port>/?token=<token>`. */
  url: string;
  /** Adresse IPv4 de l'interface. */
  address: string;
  /** Nom de l'interface tel que Windows l'affiche (« Wi-Fi », « Ethernet »…). */
  interfaceName: string;
  /** Nature du réseau (Wi-Fi, Ethernet, réseau autonome…). */
  kind: RemoteNetworkKind;
}

/** État opérationnel du point d'accès Wi-Fi créé par le PC. */
export type RemoteHotspotState = 'On' | 'Off' | 'InTransition' | 'Unknown';

/** Statut du mode autonome (« sans routeur ») renvoyé par les IPC `remote:hotspot*`. */
export interface RemoteHotspotStatus {
  /** L'API Windows de partage de connexion est disponible sur ce poste. */
  supported: boolean;
  /** État opérationnel du point d'accès. */
  state: RemoteHotspotState;
  /** SSID du réseau autonome (celui configuré par l'app), null si inconnu. */
  ssid: string | null;
  /** Mot de passe WPA2 du réseau autonome, null si inconnu. */
  passphrase: string | null;
  /** Nombre d'appareils actuellement connectés au point d'accès. */
  clients: number;
  /** IP du PC sur le réseau autonome (192.168.137.1), null si absent. */
  address: string | null;
  /** Message lisible en cas de problème, null sinon. */
  message: string | null;
}

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
  /** Appareils actuellement connectés au Remote (IP + navigateur + activité). */
  clients?: RemoteClientEntry[];
  /** Une entrée par interface réseau utilisable (QR code + libellé). */
  interfaces?: RemoteLanInterface[];
}

/** Règle entrante du pare-feu Windows concernant l'exécutable de l'app. */
export interface RemoteFirewallRule {
  /** Identifiant interne de la règle (GUID). */
  name: string;
  /** Nom affiché de la règle. */
  displayName: string;
  /** 'Allow' | 'Block'. */
  action: string;
  /** Profils concernés ('Any', 'Public'…). */
  profile: string;
  enabled: boolean;
  /** 'TCP' | 'UDP' | 'Any'. */
  protocol: string;
  /** Port local ('8080', 'Any'…). */
  localPort: string;
  /** Chemin du programme filtré. */
  program: string;
}

/** État du pare-feu vis-à-vis de l'exécutable de l'app. */
export interface RemoteFirewallStatus {
  platform: string;
  /** Exécutable réellement filtré par le pare-feu. */
  program: string;
  /** Une règle "Block" entrante concerne le programme → le téléphone est coupé. */
  blocked: boolean;
  /** Une règle "Allow" entrante TCP couvre le programme ET le port. */
  allowed: boolean;
  rules: RemoteFirewallRule[];
  /** L'exécutable tourne depuis un dossier temporaire (build portable). */
  portable: boolean;
  /** Message lisible si un blocage est détecté, sinon null. */
  message: string | null;
}

/** Informations réseau du PC (à comparer avec le réseau du téléphone). */
export interface RemoteNetworkInfo {
  /** SSID du Wi-Fi (null si Ethernet / Wi-Fi éteint / réseau masqué). */
  ssid: string | null;
  interfaceName: string | null;
  ipv4: string[];
  hostname: string;
}

/** Résultat de l'auto-test HTTP sur l'IP affichée dans le QR code. */
export interface RemoteLanProbe {
  url: string | null;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
}

/** Diagnostic complet renvoyé par l'IPC `remote:diagnostics`. */
export interface RemoteDiagnostics {
  firewall: RemoteFirewallStatus;
  network: RemoteNetworkInfo;
  probe: RemoteLanProbe;
}

/** Résultat de la tentative de réparation du pare-feu. */
export interface RemoteFirewallFix {
  ok: boolean;
  message: string;
  status: RemoteFirewallStatus;
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

/** Cue List dans le snapshot Remote. */
export interface RemoteCueListEntry {
  id: string;
  name: string;
  active: boolean;
  currentCueIndex: number;
  totalCues: number;
}

/** Cue List dans le snapshot Remote. */
export interface RemoteCueListEntry {
  id: string;
  name: string;
  active: boolean;
  currentCueIndex: number;
  totalCues: number;
}

/** SongPreset (QuickShow) dans le snapshot Remote. */
export interface RemoteSongPresetEntry {
  id: string;
  name: string;
  active: boolean;
  hasAudio: boolean;
  duration: number;
}

/** Widget de Console Virtuelle exposé au Remote. */
export interface RemoteWidgetEntry {
  id: string;
  type: 'button' | 'slider';
  pageIndex: number;
  label: string;
  actionType: string;
  color: string;
  flashMode: string;
  min?: number;
  max?: number;
  value?: number;
  active: boolean;
  /** Géométrie de la tuile sur le canvas du PC (px) — même disposition sur la tablette. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Snapshot servi par `GET /api/state` - le renderer le pousse sur le canal
 * `remote:state` (forme `{ state: RemoteStateSnapshot }` ou snapshot direct,
 * cf. src/hooks/remote-trigger.ts qui pousse la forme directe).
 */
export interface RemoteStateSnapshot {
  scenes?: RemoteSceneEntry[];
  chasers?: RemoteChaserEntry[];
  cueLists?: RemoteCueListEntry[];
  songPresets?: RemoteSongPresetEntry[];
  widgets?: RemoteWidgetEntry[];
  vcPages?: string[];
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
    // Protocole streaming : on transmet le manifeste + la liste des CLÉS de
    // blobs audio (jamais le base64 → pas d'OOM sur machine peu mémoire).
    save: (payload: { content: string; blobKeys?: string[] }) => Promise<string | { filePath: string; missingKeys?: string[] } | null | false>;
    open: () => Promise<{ content: string; filePath: string; blobKeys?: string[] } | null>;
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
    /** Diagnostic réseau : pare-feu Windows, SSID du Wi-Fi, auto-test LAN. */
    diagnostics: () => Promise<RemoteDiagnostics>;
    /** Répare le pare-feu (supprime les règles Block, crée la règle Allow). */
    openFirewall: () => Promise<RemoteFirewallFix>;
    /** Mode autonome : statut du point d'accès Wi-Fi créé par le PC. */
    hotspotStatus: () => Promise<RemoteHotspotStatus>;
    /** Mode autonome : démarre le point d'accès (SSID + mot de passe WPA2). */
    startHotspot: (ssid: string, passphrase: string) => Promise<RemoteHotspotStatus>;
    /** Mode autonome : arrête le point d'accès. */
    stopHotspot: () => Promise<RemoteHotspotStatus>;
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
