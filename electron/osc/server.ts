/**
 * Serveur OSC entrant (lot #16) — contrôle de Light Maestro depuis un
 * contrôleur OSC (TouchOSC, Lemur, consoles) sur le réseau local.
 *
 * - `node:dgram` uniquement (UDP, zéro dépendance npm).
 * - Écoute sur 0.0.0.0, port par défaut 9000 (convention TouchOSC outgoing ;
 *   le Remote web LAN est sur 8080 → aucun conflit). Override :
 *   `process.env.LM_OSC_PORT` ou port explicite passé à `start(port)`.
 * - Aucune authentification : même niveau de confiance que le Remote web LAN
 *   (LAN de confiance — tout appareil du réseau peut envoyer des commandes).
 *   Benchmark lot #16 : aucun concurrent (QLC+, Chamsys, Resolume, TouchOSC)
 *   n'authentifie l'OSC entrant.
 * - Toute commande OSC mappée est émise au renderer via
 *   `mainWindow.webContents.send('osc:command', command)` (canal dédié :
 *   le hook renderer `src/hooks/osc-trigger.ts` résout les index → id et
 *   dispatch avec les sources arbitre 'osc' LTP 71).
 * - Le main câble les canaux IPC : `osc:start` / `osc:stop` / `osc:getStatus`.
 *   Aucun import runtime d'electron (import type uniquement) : testable hors
 *   d'Electron, comme `electron/remote/server.ts`.
 *
 * Pièges couverts (spec `subagent_22_osc_spec.md`) :
 * - routes d'action = déclencheur à la réception, valeur IGNORÉE (sinon le
 *   release 0.0 d'un push button TouchOSC déclenche un stop fantôme) ;
 * - `/blackout` et `/grandmaster` lisent la valeur (f 0-1, i 1/0 / 0-100, T/F) ;
 * - bundles reçus, timetag ignoré (exécution immédiate dans l'ordre) ;
 * - paquets malformés → drop + log, jamais de crash ;
 * - EADDRINUSE → lastError + badge UI (pattern RemoteServer).
 */

import dgram from 'node:dgram';
import type { BrowserWindow } from 'electron';
import { OscParseError, parseOscPacket, MAX_PACKET_BYTES, type OscMessage, type OscPacket } from './osc-parser';

/** Statut du serveur OSC, retourné par `OscServer.getStatus()` et l'IPC `osc:getStatus`. */
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
 * Commande normalisée émise au renderer (canal `osc:command`).
 * Miroir de `RemoteCommand` (electron/remote/server.ts) + résolution par index
 * 1-based (les ids réels `scn-<ts>-<rand>` sont inutilisables sur un contrôleur
 * statique TouchOSC/Lemur). L'index est RÉSOLU côté renderer (le show y vit).
 * Convention : `index` est 0-based dans la commande (n-1 de l'adresse `/index/<n>`).
 */
export type OscCommand =
  | { type: 'scene'; id?: string; index?: number; action: 'play' | 'stop' | 'toggle' }
  | { type: 'chaser'; id?: string; index?: number; action: 'play' | 'stop' | 'next' | 'previous' }
  | { type: 'blackout'; on: boolean }
  | { type: 'grandMaster'; value: number };

const SCENE_ACTIONS = new Set(['play', 'stop', 'toggle']);
const CHASER_ACTIONS = new Set(['play', 'stop', 'next', 'previous']);

/**
 * Mappe une adresse OSC vers une commande normalisée. Fonction PURE, exportée
 * pour les tests. Retourne `null` si l'adresse est inconnue ou invalide
 * (action inconnue, index ≤ 0, valeur hors bornes) — l'appelant ignore.
 *
 * Règles de mapping (spec lot #16, §3.2-3.4) :
 * - `/scene/<id>/play|stop|toggle`, `/scene/index/<n>/...` : routes d'action —
 *   déclencheur à la réception, la valeur d'argument est IGNORÉE (un push
 *   button TouchOSC envoie 1.0 au press et 0.0 au release ; le release ne
 *   doit pas produire un stop fantôme). 0 ou N arguments acceptés.
 * - `/chaser/<id>/play|stop|next|previous`, `/chaser/index/<n>/...` : idem.
 * - `/blackout` : valeur lue — `T`/`F`, `f` 1.0/0.0, `i` 1/0 ; non-zéro = ON.
 *   Sans argument : ON (message = déclencheur blackout).
 * - `/grandmaster` : `f` 0-1 (TouchOSC/QLC+/Resolume) OU `i` 0-100 (Chamsys) ;
 *   `/grandmaster/<v>` : valeur dans l'adresse. Hors bornes → null.
 * - Multi-args (multislider Lemur) : 1er argument pris, le reste ignoré.
 */
export function mapOscAddress(msg: OscMessage): OscCommand | null {
  const address = msg.address;
  if (!address.startsWith('/')) return null;
  const segments = address.slice(1).split('/');
  if (segments.length === 0 || segments[0] === '') return null;

  // /scene/<id>/<action> et /scene/index/<n>/<action>
  if (segments[0] === 'scene') {
    if (segments.length === 3) {
      const action = segments[2];
      if (!SCENE_ACTIONS.has(action)) return null;
      const id = decodeURIComponentSafe(segments[1]);
      if (!id) return null;
      return { type: 'scene', id, action: action as 'play' | 'stop' | 'toggle' };
    }
    if (segments.length === 4 && segments[1] === 'index') {
      const action = segments[3];
      if (!SCENE_ACTIONS.has(action)) return null;
      const n = parseIndex(segments[2]);
      if (n === null) return null;
      return { type: 'scene', index: n - 1, action: action as 'play' | 'stop' | 'toggle' };
    }
    return null;
  }

  // /chaser/<id>/<action> et /chaser/index/<n>/<action>
  if (segments[0] === 'chaser') {
    if (segments.length === 3) {
      const action = segments[2];
      if (!CHASER_ACTIONS.has(action)) return null;
      const id = decodeURIComponentSafe(segments[1]);
      if (!id) return null;
      return { type: 'chaser', id, action: action as 'play' | 'stop' | 'next' | 'previous' };
    }
    if (segments.length === 4 && segments[1] === 'index') {
      const action = segments[3];
      if (!CHASER_ACTIONS.has(action)) return null;
      const n = parseIndex(segments[2]);
      if (n === null) return null;
      return { type: 'chaser', index: n - 1, action: action as 'play' | 'stop' | 'next' | 'previous' };
    }
    return null;
  }

  // /blackout — la valeur compte (non-zéro = ON) ; sans argument : ON.
  if (segments.length === 1 && segments[0] === 'blackout') {
    return { type: 'blackout', on: firstArgToBoolean(msg) };
  }

  // /grandmaster et /grandmaster/<v>
  if (segments[0] === 'grandmaster') {
    let value: number | null = null;
    if (segments.length === 1) {
      value = firstArgToLevel(msg);
    } else if (segments.length === 2) {
      value = parseLevelFromString(segments[1]);
    }
    if (value === null) return null;
    return { type: 'grandMaster', value };
  }

  return null;
}

/** Décode un segment d'id (tolère le percent-encoding, échoue proprement). */
function decodeURIComponentSafe(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/** Parse un index 1-based strictement positif depuis une string. */
function parseIndex(segment: string): number | null {
  if (!/^\d+$/.test(segment)) return null;
  const n = Number(segment);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Valeur booléenne du 1er argument : `T` → true, `F` → false, `i`/`f` →
 * non-zéro = true. Absent → true (message = déclencheur).
 */
function firstArgToBoolean(msg: OscMessage): boolean {
  const arg = msg.args[0];
  if (!arg) return true;
  switch (arg.type) {
    case 'T':
      return true;
    case 'F':
      return false;
    case 'i':
      return arg.value !== 0;
    case 'f':
      return arg.value !== 0;
    default:
      // s/b : valeur inconnue → non-zéro est le comportement le moins surprenant ? Non :
      // une string n'est pas un niveau ; on traite comme déclencheur ON.
      return true;
  }
}

/** Niveau 0..1 depuis le 1er argument : `f` 0-1, `i` 0-100 (Chamsys). */
function firstArgToLevel(msg: OscMessage): number | null {
  const arg = msg.args[0];
  if (!arg) return null;
  switch (arg.type) {
    case 'f':
      return arg.value >= 0 && arg.value <= 1 ? arg.value : null;
    case 'i':
      return arg.value >= 0 && arg.value <= 100 ? arg.value / 100 : null;
    default:
      return null;
  }
}

/** Niveau 0..1 depuis une string (valeur dans l'adresse, ex. /grandmaster/0.5). */
function parseLevelFromString(segment: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(segment)) return null;
  const value = Number(segment);
  if (!Number.isFinite(value)) return null;
  return value >= 0 && value <= 1 ? value : null;
}

export class OscServer {
  static readonly DEFAULT_PORT = 9000;

  private socket: dgram.Socket | null = null;
  private onListening: (() => void) | null = null;
  private onError: ((err: Error) => void) | null = null;
  private onMessage: ((buf: Buffer) => void) | null = null;
  private port = OscServer.DEFAULT_PORT;
  private running = false;
  private starting = false;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  /** Nombre total de messages OSC traités (un datagramme bundle en compte plusieurs). */
  private packetsReceived = 0;
  private lastAddress: string | null = null;
  private lastActivityAt: number | null = null;
  private mainWindow: BrowserWindow | null = null;

  /** Le main fournit la fenêtre cible (mainWindow) — voir electron/main.ts. */
  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  /** Démarre le serveur UDP (0.0.0.0, port par défaut 9000). Idempotent. */
  start(port?: number): OscStatus {
    if ((this.running || this.starting) && this.socket) return this.getStatus();
    // Nettoie un éventuel socket resté dans un état mort (ex. EADDRINUSE).
    this.stop();

    this.port = this.resolvePort(port);
    this.startedAt = Date.now();
    this.lastError = null;
    this.packetsReceived = 0;
    this.lastAddress = null;
    this.lastActivityAt = null;

    const socket = dgram.createSocket('udp4');
    this.socket = socket;

    this.onListening = () => {
      this.running = true;
      this.starting = false;
      console.log(`[osc] serveur UDP démarré sur le port ${this.port}`);
    };
    this.onError = (err: Error) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        this.lastError = `Port ${this.port} déjà utilisé (EADDRINUSE) - serveur OSC non démarré`;
        console.error(`[osc] port ${this.port} déjà utilisé - serveur OSC non démarré`);
      } else {
        this.lastError = err.message;
        console.error('[osc] erreur serveur UDP:', err.message);
      }
      this.running = false;
      this.starting = false;
    };
    this.onMessage = (buf: Buffer) => this.handleDatagram(buf);
    socket.on('listening', this.onListening);
    socket.on('error', this.onError);
    socket.on('message', this.onMessage);

    // L'écoute est asynchrone : on expose l'état transitoire `starting`, puis
    // `running` à l'event `listening` (ou `lastError` à l'event `error`).
    this.starting = true;
    socket.bind(this.port, '0.0.0.0');
    return this.getStatus();
  }

  /** Arrête le serveur (libère le port) et remet les compteurs à zéro. */
  stop(): void {
    this.lastError = null;
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.running = false;
    this.starting = false;
    this.startedAt = null;
    this.packetsReceived = 0;
    this.lastAddress = null;
    this.lastActivityAt = null;
    // Détache les handlers avant fermeture : un event résiduel (ex. EADDRINUSE
    // tardif) ne doit pas corrompre l'état d'un re-start rapide.
    if (this.onListening) socket.off('listening', this.onListening);
    if (this.onError) socket.off('error', this.onError);
    if (this.onMessage) socket.off('message', this.onMessage);
    this.onListening = null;
    this.onError = null;
    this.onMessage = null;
    try {
      socket.close();
    } catch {
      // socket jamais bindé : rien à fermer
    }
  }

  /** Statut courant (compteurs inclus pour le voyant d'activité du panneau). */
  getStatus(): OscStatus {
    return {
      running: this.running,
      starting: this.starting,
      port: this.port,
      startedAt: this.startedAt,
      lastError: this.lastError,
      packetsReceived: this.packetsReceived,
      lastAddress: this.lastAddress,
      lastActivityAt: this.lastActivityAt,
    };
  }

  /** Port : paramètre explicite > 0 > env LM_OSC_PORT > défaut 9000. */
  private resolvePort(port?: number): number {
    if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535) {
      return port;
    }
    const env = Number(process.env.LM_OSC_PORT);
    if (Number.isInteger(env) && env > 0 && env <= 65535) {
      return env;
    }
    return OscServer.DEFAULT_PORT;
  }

  /** Datagramme UDP reçu : parse → walk (bundles) → mapping → emit. */
  private handleDatagram(buf: Buffer): void {
    if (buf.length > MAX_PACKET_BYTES) {
      console.debug(`[osc] datagramme ignoré (${buf.length} octets > max ${MAX_PACKET_BYTES})`);
      return;
    }
    let packet: OscPacket;
    try {
      packet = parseOscPacket(buf);
    } catch (err) {
      if (err instanceof OscParseError) {
        console.debug(`[osc] paquet malformé ignoré: ${err.message}`);
      } else {
        console.debug('[osc] erreur inattendue:', err);
      }
      return;
    }
    this.walk(packet);
  }

  /** Parcours récursif (bundles imbriqués) : chaque message → mapping → emit. */
  private walk(packet: OscPacket): void {
    if (packet.kind === 'message') {
      this.handleMessage(packet.message);
    } else {
      for (const element of packet.elements) {
        this.walk(element);
      }
    }
  }

  private handleMessage(msg: OscMessage): void {
    this.packetsReceived++;
    this.lastAddress = msg.address;
    this.lastActivityAt = Date.now();
    const command = mapOscAddress(msg);
    if (!command) {
      // Adresse inconnue ou invalide : ignorée proprement (jamais d'erreur).
      console.debug(`[osc] adresse non mappée: ${msg.address}`);
      return;
    }
    this.emitCommand(command);
  }

  /** Émet la commande au renderer ; false si la fenêtre est morte. */
  private emitCommand(command: OscCommand): boolean {
    const win = this.mainWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      console.debug('[osc] fenêtre absente, commande ignorée:', command.type);
      return false;
    }
    win.webContents.send('osc:command', command);
    return true;
  }
}
