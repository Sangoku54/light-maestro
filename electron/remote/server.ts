/**
 * Serveur HTTP embarqué - contrôle LAN de Light Maestro (lot « Remote web LAN »).
 *
 * - `node:http` uniquement (zéro dépendance npm).
 * - Écoute sur 0.0.0.0, port par défaut 8080 (override : process.env.LM_REMOTE_PORT).
 * - Token d'auth généré à chaque démarrage (crypto.randomBytes(16).toString('hex')),
 *   requis en header `X-Auth-Token` OU en query `?token=`. 401 sinon.
 *   Le token n'est JAMAIS loggé ; il ne transite que dans les URLs retournées
 *   par le main (voir `remote:getStatus` dans electron/main.ts).
 * - Toute commande entrante est émise au renderer via
 *   `mainWindow.webContents.send('remote:command', command)` - la fenêtre cible
 *   est fournie par le main via `setMainWindow()`.
 * - Routes POST : `/api/scene/:id`, `/api/chaser/:id`,
 *   `/api/widget/:id` (Console Virtuelle : press | release | toggle |
 *   slider + `value` 0..1), `/api/blackout`, `/api/grandmaster`, `/api/stopall`.
 * - Le main câble les canaux IPC : `remote:start` / `remote:stop` /
 *   `remote:getStatus` (handles) et `remote:state` (push du snapshot).
 *   Ici, aucune importation runtime d'electron (import type uniquement) :
 *   le module est testable hors d'Electron (smoke test node).
 *
 * Types miroirs côté renderer : src/types.d.ts (RemoteStatus, RemoteStateSnapshot).
 */

import http from 'node:http';
import crypto from 'node:crypto';
import type { BrowserWindow } from 'electron';

/** Statut du serveur LAN, retourné par `RemoteServer.getStatus()` et l'IPC `remote:getStatus`. */
export interface RemoteStatus {
  running: boolean;
  /** Vrai pendant la fenêtre asynchrone entre `listen()` et l'event `listening`/`error`. */
  starting: boolean;
  port: number;
  /** Timestamp (ms) du dernier démarrage, null si arrêté. */
  startedAt: number | null;
  urls: string[];
  lastError: string | null;
}

/** Entrée d'une scène dans le snapshot poussé par le renderer. */
export interface RemoteSceneEntry {
  id: string;
  name?: string;
  active?: boolean;
}

/** Entrée d'un chaser dans le snapshot poussé par le renderer. */
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

/** SongPreset (QuickShow) dans le snapshot Remote. */
export interface RemoteSongPresetEntry {
  id: string;
  name: string;
  active: boolean;
  hasAudio: boolean;
  duration: number;
}

/**
 * Snapshot d'état poussé par le renderer (`remote:state`) et servi tel quel
 * par `GET /api/state`. Le producteur réel est src/hooks/remote-trigger.ts.
 */
export interface RemoteStateSnapshot {
  scenes?: RemoteSceneEntry[];
  chasers?: RemoteChaserEntry[];
  /** Cue Lists (séquences pré-programmées : go / back / stop). */
  cueLists?: RemoteCueListEntry[];
  /** SongPresets (QuickShow : presets pré-enregistrés audio + DMX). */
  songPresets?: RemoteSongPresetEntry[];
  /** Widgets de la Console Virtuelle (boutons + faders) exposés au Remote. */
  widgets?: RemoteWidgetEntry[];
  /** Noms des pages de la Console Virtuelle (regroupement par page). */
  vcPages?: string[];
  blackout?: boolean;
  grandMaster?: number;
  latencyMs?: number | null;
  dmxRunning?: boolean;
  timestamp?: number;
}

/** Widget de Console Virtuelle exposé au Remote (bouton ou fader). */
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
}

export type RemoteCommand =
  | { type: 'scene'; id: string; action: 'play' | 'stop' | 'toggle' }
  | { type: 'chaser'; id: string; action: 'play' | 'stop' | 'next' | 'previous' }
  | { type: 'cueList'; id: string; action: 'go' | 'back' | 'stop' }
  | { type: 'songPreset'; id: string; action: 'play' | 'stop' }
  | { type: 'blackout'; on: boolean }
  | { type: 'grandMaster'; value: number }
  | { type: 'widget'; id: string; action: 'press' | 'release' | 'toggle' | 'slider'; value?: number };

const SCENE_ACTIONS = new Set(['play', 'stop', 'toggle']);
const CHASER_ACTIONS = new Set(['play', 'stop', 'next', 'previous']);
const CUE_LIST_ACTIONS = new Set(['go', 'back', 'stop']);
const SONG_PRESET_ACTIONS = new Set(['play', 'stop']);
const WIDGET_ACTIONS = new Set(['press', 'release', 'toggle', 'slider']);
const MAX_BODY_BYTES = 64 * 1024;

export class RemoteServer {
  static readonly DEFAULT_PORT = 8080;

  private server: http.Server | null = null;
  private onListening: (() => void) | null = null;
  private onError: ((err: Error) => void) | null = null;
  private token = '';
  private port = RemoteServer.DEFAULT_PORT;
  private running = false;
  private starting = false;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private snapshot: RemoteStateSnapshot | null = null;
  private mainWindow: BrowserWindow | null = null;
  /** Pont vers le moteur DMX — défini par main.ts au démarrage. */
  private dmxBridge: {
    blackout: () => void;
    restore: () => void;
    applyGrandMaster: (level: number) => void;
    getStatus: () => { blackout?: boolean; grandMaster?: number };
  } | null = null;

  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  /** Injecte un pont DMX pour piloter le moteur directement (sans passer par le renderer). */
  setDmxBridge(dmx: NonNullable<RemoteServer['dmxBridge']>): void {
    this.dmxBridge = dmx;
  }

  getToken(): string {
    return this.token;
  }

  /**
   * Démarre le serveur HTTP (0.0.0.0, port par défaut 8080). Idempotent.
   *
   * @param presetToken Token à utiliser. Si fourni (persistant côté main),
   *   l'URL d'accès reste IDENTIQUE d'un redémarrage à l'autre — indispensable
   *   pour que la tablette reconnecte seule après un redémarrage du PC.
   *   Sinon, un token aléatoire est généré (comportement historique).
   */
  start(presetToken?: string): RemoteStatus {
    if ((this.running || this.starting) && this.server) return this.getStatus();
    this.stop();

    this.port = this.resolvePort();
    this.token =
      presetToken && /^[0-9a-f]{32}$/i.test(presetToken)
        ? presetToken
        : crypto.randomBytes(16).toString('hex');
    this.startedAt = Date.now();
    this.lastError = null;

    const srv = http.createServer((req, res) => {
      try {
        this.handleRequest(req, res);
      } catch (err) {
        console.error('[remote] erreur de requête HTTP:', err);
        if (!res.destroyed && !res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'internal error' }));
        }
      }
    });
    this.server = srv;

    this.onListening = () => {
      this.running = true;
      this.starting = false;
      console.log(`[remote] serveur HTTP LAN démarré sur le port ${this.port}`);
    };
    this.onError = (err: Error) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        this.lastError = `Port ${this.port} déjà utilisé (EADDRINUSE) - serveur LAN non démarré`;
        console.error(`[remote] port ${this.port} déjà utilisé - serveur LAN non démarré`);
      } else {
        this.lastError = err.message;
        console.error('[remote] erreur serveur HTTP:', err.message);
      }
      this.running = false;
      this.starting = false;
    };
    srv.on('listening', this.onListening);
    srv.on('error', this.onError);

    this.starting = true;
    srv.listen(this.port, '0.0.0.0');
    return this.getStatus();
  }

  stop(): void {
    this.lastError = null;
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.running = false;
    this.starting = false;
    this.startedAt = null;
    // Le token N'EST PAS effacé : il est rechargé depuis le disque au prochain
    // démarrage (main.ts) et doit rester identique pour que les URL d'accès
    // (QR code) déjà distribuées sur les téléphones continuent de fonctionner.
    this.snapshot = null;
    if (this.onListening) srv.off('listening', this.onListening);
    if (this.onError) srv.off('error', this.onError);
    this.onListening = null;
    this.onError = null;
    try {
      srv.closeAllConnections();
      srv.close(() => {});
    } catch {
      // serveur jamais écouté
    }
  }

  getStatus(): RemoteStatus {
    return {
      running: this.running,
      starting: this.starting,
      port: this.port,
      startedAt: this.startedAt,
      urls: [],
      lastError: this.lastError,
    };
  }

  setSnapshot(snapshot: RemoteStateSnapshot | null): void {
    this.snapshot = snapshot;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return this.sendJson(res, 400, { ok: false, error: 'invalid url' });
    }

    if (!this.isAuthorized(req, url)) {
      return this.sendJson(res, 401, { ok: false, error: 'unauthorized' });
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return this.sendHtml(res, 200, REMOTE_PAGE_HTML);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const snap = this.snapshot;
      if (!snap || typeof snap.timestamp !== 'number') {
        return this.sendJson(res, 200, { pending: true });
      }
      return this.sendJson(res, 200, snap);
    }

    if (req.method === 'POST') {
      const scene = /^\/api\/scene\/([^/]+)$/.exec(url.pathname);
      if (scene) {
        return this.readJsonBody(req, res, (body) => {
          const id = this.safeDecode(scene[1]);
          if (id === null) return this.sendJson(res, 400, { ok: false, error: 'invalid id' });
          return this.handleScene(res, id, body);
        });
      }
      const chaser = /^\/api\/chaser\/([^/]+)$/.exec(url.pathname);
      if (chaser) {
        return this.readJsonBody(req, res, (body) => {
          const id = this.safeDecode(chaser[1]);
          if (id === null) return this.sendJson(res, 400, { ok: false, error: 'invalid id' });
          return this.handleChaser(res, id, body);
        });
      }
      const widget = /^\/api\/widget\/([^/]+)$/.exec(url.pathname);
      if (widget) {
        return this.readJsonBody(req, res, (body) => {
          const id = this.safeDecode(widget[1]);
          if (id === null) return this.sendJson(res, 400, { ok: false, error: 'invalid id' });
          return this.handleWidget(res, id, body);
        });
      }
      const cueList = /^\/api\/cueList\/([^/]+)$/.exec(url.pathname);
      if (cueList) {
        return this.readJsonBody(req, res, (body) => {
          const id = this.safeDecode(cueList[1]);
          if (id === null) return this.sendJson(res, 400, { ok: false, error: 'invalid id' });
          return this.handleCueList(res, id, body);
        });
      }
      const songPreset = /^\/api\/songPreset\/([^/]+)$/.exec(url.pathname);
      if (songPreset) {
        return this.readJsonBody(req, res, (body) => {
          const id = this.safeDecode(songPreset[1]);
          if (id === null) return this.sendJson(res, 400, { ok: false, error: 'invalid id' });
          return this.handleSongPreset(res, id, body);
        });
      }
      if (url.pathname === '/api/blackout') {
        return this.readJsonBody(req, res, (body) => this.handleBlackout(res, body));
      }
      if (url.pathname === '/api/grandmaster') {
        return this.readJsonBody(req, res, (body) => this.handleGrandMaster(res, body));
      }
      if (url.pathname === '/api/stopall') {
        return this.readJsonBody(req, res, (body) => this.handleStopAll(res, body));
      }
    }

    return this.sendJson(res, 404, { ok: false, error: 'not found' });
  }

  private handleScene(res: http.ServerResponse, id: string, body: unknown): void {
    const action = (body as { action?: unknown } | null)?.action;
    if (typeof action !== 'string' || !SCENE_ACTIONS.has(action)) {
      return this.sendJson(res, 400, { ok: false, error: "action must be 'play' | 'stop' | 'toggle'" });
    }
    if (!this.emitCommand({ type: 'scene', id, action: action as 'play' | 'stop' | 'toggle' })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  private handleChaser(res: http.ServerResponse, id: string, body: unknown): void {
    const action = (body as { action?: unknown } | null)?.action;
    if (typeof action !== 'string' || !CHASER_ACTIONS.has(action)) {
      return this.sendJson(res, 400, { ok: false, error: "action must be 'play' | 'stop' | 'next' | 'previous'" });
    }
    if (!this.emitCommand({ type: 'chaser', id, action: action as 'play' | 'stop' | 'next' | 'previous' })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  private handleCueList(res: http.ServerResponse, id: string, body: unknown): void {
    const action = (body as { action?: unknown } | null)?.action;
    if (typeof action !== 'string' || !CUE_LIST_ACTIONS.has(action)) {
      return this.sendJson(res, 400, { ok: false, error: "action must be 'go' | 'back' | 'stop'" });
    }
    if (!this.emitCommand({ type: 'cueList', id, action: action as 'go' | 'back' | 'stop' })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  private handleSongPreset(res: http.ServerResponse, id: string, body: unknown): void {
    const action = (body as { action?: unknown } | null)?.action;
    if (typeof action !== 'string' || !SONG_PRESET_ACTIONS.has(action)) {
      return this.sendJson(res, 400, { ok: false, error: "action must be 'play' | 'stop'" });
    }
    if (!this.emitCommand({ type: 'songPreset', id, action: action as 'play' | 'stop' })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  private handleWidget(res: http.ServerResponse, id: string, body: unknown): void {
    const b = body as { action?: unknown; value?: unknown } | null;
    const rawAction = typeof b?.action === 'string' ? b.action : 'press';
    if (!WIDGET_ACTIONS.has(rawAction)) {
      return this.sendJson(res, 400, { ok: false, error: "action must be 'press' | 'release' | 'toggle' | 'slider'" });
    }
    const action = rawAction as 'press' | 'release' | 'toggle' | 'slider';
    let value: number | undefined;
    if (action === 'slider') {
      const v = b?.value;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
        return this.sendJson(res, 400, { ok: false, error: "value must be a number in [0, 1]" });
      }
      value = v;
    }
    if (!this.emitCommand({ type: 'widget', id, action, value })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  private handleBlackout(res: http.ServerResponse, body: unknown): void {
    const on = (body as { on?: unknown } | null)?.on;
    if (typeof on !== 'boolean') {
      return this.sendJson(res, 400, { ok: false, error: 'on must be a boolean' });
    }
    // Appel direct au moteur DMX via le pont — fonctionne depuis un navigateur externe.
    if (this.dmxBridge) {
      (on ? this.dmxBridge.blackout() : this.dmxBridge.restore());
      return this.sendJson(res, 200, { ok: true });
    }
    if (!this.emitCommand({ type: 'blackout', on })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  private handleGrandMaster(res: http.ServerResponse, body: unknown): void {
    const value = (body as { value?: unknown } | null)?.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      return this.sendJson(res, 400, { ok: false, error: 'value must be a number in [0, 1]' });
    }
    if (this.dmxBridge) {
      this.dmxBridge.applyGrandMaster(value);
      return this.sendJson(res, 200, { ok: true });
    }
    if (!this.emitCommand({ type: 'grandMaster', value })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  private handleStopAll(res: http.ServerResponse, body: unknown): void {
    // Stop toutes les scènes et chasers actifs (forward au renderer).
    const show = this.snapshot;
    const scenes = show?.scenes || [];
    const chasers = show?.chasers || [];
    let pending = 0;
    scenes.forEach((s) => {
      if (s.active) { pending++; this.emitCommand({ type: 'scene', id: s.id, action: 'stop' }); }
    });
    chasers.forEach((c) => {
      if (c.active) { pending++; this.emitCommand({ type: 'chaser', id: c.id, action: 'stop' }); }
    });
    // Toujours répondre 200 même si le renderer n'est pas dispo —
    // le client web ne peut pas savoir laquelle a échoué individuellement.
    this.sendJson(res, 200, { ok: true, stopped: pending });
  }

  // ─── Auth / helpers ────────────────────────────────────────────────────────

  private isAuthorized(req: http.IncomingMessage, url: URL): boolean {
    const header = req.headers['x-auth-token'];
    const candidate = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get('token') ?? '';
    if (!this.token) return false;
    if (!candidate) return false;
    const a = crypto.createHash('sha256').update(candidate).digest();
    const b = crypto.createHash('sha256').update(this.token).digest();
    return crypto.timingSafeEqual(a, b);
  }

  private safeDecode(raw: string): string | null {
    try { return decodeURIComponent(raw); } catch { return null; }
  }

  private readJsonBody(req: http.IncomingMessage, res: http.ServerResponse, done: (body: unknown) => void): void {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        over = true;
        this.sendJson(res, 413, { ok: false, error: 'body too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over || res.destroyed || res.writableEnded) return;
      let parsed: unknown = {};
      if (chunks.length > 0) {
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        } catch {
          return this.sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
        }
      }
      done(parsed);
    });
    req.on('error', () => {});
  }

  private emitCommand(command: RemoteCommand): boolean {
    const win = this.mainWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
    win.webContents.send('remote:command', command);
    return true;
  }

  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    if (res.destroyed || res.writableEnded) return;
    const payload = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(payload);
  }

  private sendHtml(res: http.ServerResponse, status: number, html: string): void {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  }

  private resolvePort(): number {
    const raw = process.env.LM_REMOTE_PORT;
    if (!raw) return RemoteServer.DEFAULT_PORT;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
    console.warn(`[remote] LM_REMOTE_PORT invalide (« ${raw} ») - port ${RemoteServer.DEFAULT_PORT} utilisé`);
    return RemoteServer.DEFAULT_PORT;
  }
}

// ─── Page web embarquée (FR, dark theme, contrôles tactiles optimisés) ───────
// Servie par GET / - aucun build requis. Le token reçu en query
// est mémorisé dans sessionStorage puis réutilisé en header X-Auth-Token.

const REMOTE_PAGE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Light Maestro - Contrôle</title>
<style>
  :root { color-scheme: dark; --red:#ef4444; --green:#22c55e; --amber:#f59e0b; --blue:#3b82f6; --purple:#a855f7; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0a0a0f; color: #e8e8f0; }
  header { padding: 14px 20px; background: #12121a; border-bottom: 1px solid #26263a; display: flex; align-items: center; justify-content: space-between; gap: 12px; position: sticky; top: 0; z-index: 10; }
  header h1 { font-size: 17px; margin: 0; font-weight: 700; }
  #status { font-size: 12px; display: flex; align-items: center; gap: 6px; }
  #status .dot { width: 8px; height: 8px; border-radius: 50%; background: #3a3a4e; display: inline-block; }
  #status.ok .dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
  #status.err .dot { background: var(--red); }
  main { padding: 14px 16px 60px; max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  section h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #8b8ba3; margin: 0 0 8px; }

  /* ── Blackout ── */
  #blackout { width: 100%; padding: 24px 16px; font-size: 19px; font-weight: 800; letter-spacing: 1.5px; border-radius: 16px; border: 2px solid #26263a; background: #1a1a26; color: #e8e8f0; cursor: pointer; touch-action: manipulation; transition: all .15s; }
  #blackout:active { transform: scale(.97); }
  #blackout.on { background: linear-gradient(135deg,#991b1b,#dc2626); border-color: var(--red); color: #fff; box-shadow: 0 0 24px rgba(239,68,68,.35); }

  /* ── Stop All ── */
  #stopAll { width: 100%; padding: 16px; font-size: 15px; font-weight: 700; letter-spacing: .8px; border-radius: 12px; border: 2px solid #26263a; background: #1a1a26; color: #e8e8f0; cursor: pointer; touch-action: manipulation; transition: all .12s; }
  #stopAll:active { transform: scale(.97); background: #1e1e2c; }

  /* ── Grand Master ── */
  .gm-wrap { display: flex; align-items: center; gap: 14px; background: #15151f; border: 1px solid #26263a; border-radius: 14px; padding: 14px 18px; }
  input[type="range"] { flex: 1; height: 44px; accent-color: var(--amber); }
  .gm-val { font-size: 24px; font-weight: 800; min-width: 60px; text-align: right; color: var(--amber); }

  /* ── Onglets ── */
  .tabs { display: flex; gap: 6px; background: #12121a; border: 1px solid #26263a; border-radius: 12px; padding: 5px; position: sticky; top: 52px; z-index: 9; }
  .tab { flex: 1; padding: 11px 6px; border-radius: 9px; font-size: 13px; font-weight: 700; color: #8b8ba3; background: transparent; border: 0; cursor: pointer; touch-action: manipulation; }
  .tab.on { background: #26263a; color: #fff; }
  .tab .badge { display: inline-block; margin-left: 5px; font-size: 10px; opacity: .7; }

  /* ── Cartes (scènes / chasers) ── */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .card { background: #15151f; border: 1px solid #26263a; border-radius: 12px; padding: 12px 14px; }
  .card.on { border-color: var(--green); box-shadow: 0 0 0 1px var(--green) inset; }
  .card h3 { margin: 0 0 10px; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 8px; }
  .card h3 .dot { width: 9px; height: 9px; border-radius: 50%; background: #3a3a4e; flex-shrink: 0; }
  .card.on h3 .dot { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .btn { flex: 1; border: 1px solid #33334d; background: #1e1e2c; color: #e8e8f0; border-radius: 9px; padding: 12px 5px; font-size: 12px; font-weight: 600; cursor: pointer; touch-action: manipulation; transition: filter .1s; }
  .btn:active { transform: scale(.94); filter: brightness(1.2); }
  .btn.play { background: #14532d; border-color: var(--green); color: #dcfce7; }
  .btn.stop { background: #7f1d1d; border-color: var(--red); color: #fee2e2; }
  .btn.toggle { background: #1e3a8a; border-color: var(--blue); color: #dbeafe; }
  .btn.nav { background: #4a2d7a; border-color: var(--purple); color: #ede9fe; }
  .row { display: flex; gap: 6px; }

  /* ── Console virtuelle ── */
  .pages { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .page-chip { padding: 8px 14px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid #33334d; background: #1a1a26; color: #8b8ba3; cursor: pointer; touch-action: manipulation; }
  .page-chip.on { background: #26263a; color: #fff; border-color: #55557a; }
  .vc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .vc-btn { position: relative; border-radius: 12px; padding: 16px 12px; font-size: 13px; font-weight: 700; text-align: center; cursor: pointer; touch-action: manipulation; border: 2px solid #26263a; background: #1a1a26; color: #e8e8f0; overflow: hidden; transition: transform .1s, filter .1s; min-height: 64px; display: flex; align-items: center; justify-content: center; }
  .vc-btn:active { transform: scale(.95); }
  .vc-btn .lbl { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .vc-btn.on { color: #fff; }
  .vc-btn .badge { position: absolute; top: 6px; right: 8px; font-size: 9px; opacity: .8; font-weight: 600; }
  .vc-fader { background: #15151f; border: 1px solid #26263a; border-radius: 12px; padding: 10px 12px; }
  .vc-fader .fhead { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .vc-fader .fname { font-size: 12px; font-weight: 600; color: #b8b8cc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vc-fader .fval { font-size: 13px; font-weight: 800; color: var(--amber); flex-shrink: 0; }
  .vc-fader input[type="range"] { width: 100%; height: 38px; }
  .empty { color: #8b8ba3; font-size: 13px; text-align: center; padding: 16px 0; }
  #error { position: fixed; left: 12px; right: 12px; bottom: 12px; background: #7f1d1d; color: #fee2e2; border: 1px solid var(--red); border-radius: 10px; padding: 12px 14px; font-size: 13px; font-weight: 600; z-index: 99; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<header><h1>Light Maestro</h1><div id="status"><span class="dot"></span><span>Connexion...</span></div></header>
<main>
  <section>
    <h2>Blackout</h2>
    <button id="blackout" type="button">NOIR TOTAL</button>
  </section>
  <section>
    <h2>Arrêt d'urgence</h2>
    <button id="stopAll" type="button">&#9632; STOP ALL &mdash; Arrêter tout</button>
  </section>
  <section>
    <h2>Grand master</h2>
    <div class="gm-wrap">
      <input type="range" id="gm" min="0" max="100" value="100">
      <span class="gm-val" id="gmValue">100%</span>
    </div>
  </section>

  <div class="tabs">
    <button class="tab on" data-tab="scenes" type="button">Scènes</button>
    <button class="tab" data-tab="chasers" type="button">Chasers</button>
    <button class="tab" data-tab="cueLists" type="button">Cue Lists</button>
    <button class="tab" data-tab="presets" type="button">Presets</button>
    <button class="tab" data-tab="console" type="button">Console</button>
  </div>

  <div id="panel-scenes">
    <div class="cards" id="scenes"></div>
  </div>
  <div id="panel-chasers" class="hidden">
    <div class="cards" id="chasers"></div>
  </div>
  <div id="panel-cueLists" class="hidden">
    <div class="cards" id="cueLists"></div>
  </div>
  <div id="panel-presets" class="hidden">
    <div class="cards" id="presets"></div>
  </div>
  <div id="panel-console" class="hidden">
    <div class="pages" id="vcPages"></div>
    <div class="vc-grid" id="vcWidgets"></div>
  </div>
</main>
<div id="error" hidden></div>
<script>
(function () {
  'use strict';

  // Le token présent dans l'URL (QR code) PRIME : c'est toujours le plus
  // récent. Le sessionStorage ne sert que de secours (rechargement de la
  // page sans query string).
  var urlToken = new URLSearchParams(window.location.search).get('token');
  var token = urlToken || sessionStorage.getItem('lmToken');
  if (token) sessionStorage.setItem('lmToken', token);

  var errorEl = document.getElementById('error');
  var statusEl = document.getElementById('status');
  var statusText = statusEl.querySelector('span:last-child');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    statusEl.className = 'err';
    statusText.textContent = 'Erreur';
  }
  function hideError() {
    errorEl.hidden = true;
    statusEl.className = 'ok';
  }
  if (!token) {
    showError('Token manquant — rouvrez la page depuis le QR code de Light Maestro.');
    return;
  }

  var state = null;
  var lastGood = 0;
  var activeTab = 'scenes';
  var vcPage = 0;

  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.headers['X-Auth-Token'] = token;
    return fetch(path, opts).then(function (res) {
      if (res.status === 401) {
        showError('Accès refusé — re-scannez le QR code affiché dans Light Maestro.');
        sessionStorage.removeItem('lmToken');
        throw new Error('unauthorized');
      }
      // 400 / 413 / 503 : la commande a été REFUSÉE. Avant, ces codes were
      // traités comme des succès (le .json() renvoyait le message d'erreur et
      // l'UI restait muette) → l'utilisateur croyait que la commande passait.
      if (!res.ok) {
        showError(res.status === 503
          ? 'Light Maestro est indisponible (fermeture en cours). Relance le logiciel sur le PC.'
          : res.status === 413
            ? 'Requête refusée par le PC (trop volumineuse).'
            : 'Commande refusée par le PC (erreur ' + res.status + ').');
        throw new Error('http ' + res.status);
      }
      hideError();
      return res.json().catch(function () { return {}; });
    }, function (err) {
      // Panne réseau : le PC ne répond plus (serveur arrêté, Wi-Fi coupé,
      // pare-feu bloquant). On l'affiche au lieu de laisser un écran muet.
      showError('Connexion au PC impossible — vérifie que le téléphone est sur le même Wi-Fi et que le serveur Remote est démarré.');
      throw err;
    });
  }
  function post(path, body) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }
  function esc(s) {
    var map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return map[c];
    });
  }

  // Couleur de tuile VC : valide avant injection dans un attribut style.
  // Une couleur corrompue (projet importé/édité à la main) contenant un
  // guillemet aurait cassé l'attribut HTML → injection dans la page mobile.
  function safeColor(c) {
    var s = String(c == null ? '' : c).trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : '#a855f7';
  }

  // ── Onglets ──────────────────────────────────────
  var tabButtons = document.querySelectorAll('.tab');
  Array.prototype.forEach.call(tabButtons, function (btn) {
    btn.addEventListener('click', function () {
      activeTab = btn.getAttribute('data-tab');
      Array.prototype.forEach.call(tabButtons, function (b) {
        b.classList.toggle('on', b === btn);
      });
      document.getElementById('panel-scenes').classList.toggle('hidden', activeTab !== 'scenes');
      document.getElementById('panel-chasers').classList.toggle('hidden', activeTab !== 'chasers');
      document.getElementById('panel-cueLists').classList.toggle('hidden', activeTab !== 'cueLists');
      document.getElementById('panel-presets').classList.toggle('hidden', activeTab !== 'presets');
      document.getElementById('panel-console').classList.toggle('hidden', activeTab !== 'console');
    });
  });

  // ── Blackout ─────────────────────────────────────
  var blackoutBtn = document.getElementById('blackout');
  blackoutBtn.addEventListener('click', function () {
    var next = !(state && state.blackout);
    blackoutBtn.disabled = true;
    post('api/blackout', { on: next })
      .catch(function () {})
      .finally(function () { blackoutBtn.disabled = false; });
  });

  // ── Stop All (appui long 0.8 s = confirmation) ────
  var stopAllBtn = document.getElementById('stopAll');
  var stopTimer = null;
  var stopArmed = false;
  function armStopAll() {
    stopArmed = false;
    stopTimer = setTimeout(function () {
      stopArmed = true;
      stopAllBtn.style.background = '#7f1d1d';
      stopAllBtn.style.borderColor = 'var(--red)';
      sendStopAll();
    }, 800);
  }
  function cancelStopAll() {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    if (!stopArmed) {
      stopAllBtn.style.background = '';
      stopAllBtn.style.borderColor = '';
    }
  }
  function sendStopAll() {
    post('api/stopall', {})
      .catch(function () {})
      .finally(function () {
        stopAllBtn.style.background = '';
        stopAllBtn.style.borderColor = '';
      });
  }
  stopAllBtn.addEventListener('touchstart', function (e) { e.preventDefault(); armStopAll(); });
  stopAllBtn.addEventListener('touchend', cancelStopAll);
  stopAllBtn.addEventListener('touchcancel', cancelStopAll);
  stopAllBtn.addEventListener('mousedown', armStopAll);
  stopAllBtn.addEventListener('mouseup', cancelStopAll);
  stopAllBtn.addEventListener('mouseleave', cancelStopAll);

  // ── Grand master ─────────────────────────────────
  var gmSlider = document.getElementById('gm');
  var gmValue = document.getElementById('gmValue');
  var gmTimer = null;
  gmSlider.addEventListener('input', function () {
    var pct = Number(gmSlider.value);
    gmValue.textContent = pct + '%';
    if (gmTimer) clearTimeout(gmTimer);
    gmTimer = setTimeout(function () {
      post('api/grandmaster', { value: pct / 100 }).catch(function () {});
    }, 100);
  });

  // ── Rendu des cartes (scènes / chasers) ───────────
  function sceneCard(s) {
    var cls = s.active ? ' on' : '';
    return '<div class="card' + cls + '" data-id="' + esc(s.id) + '">'
      + '<h3><span class="dot"></span>' + esc(s.name || s.id) + '</h3>'
      + '<div class="row">'
      + '<button class="btn play" data-a="play" type="button">&#9654; Lire</button>'
      + '<button class="btn stop" data-a="stop" type="button">&#9632; Stop</button>'
      + '<button class="btn toggle" data-a="toggle" type="button">&#8644; Bascule</button>'
      + '</div></div>';
  }

  function cueListCard(c) {
    var cls = c.active ? ' on' : '';
    var cueInfo = c.totalCues > 0 ? (' — repère ' + (c.currentCueIndex + 1) + '/' + c.totalCues) : '';
    return '<div class="card' + cls + '" data-id="' + esc(c.id) + '">'
      + '<h3><span class="dot"></span>' + esc(c.name || c.id) + cueInfo + '</h3>'
      + '<div class="row">'
      + '<button class="btn nav" data-a="back" type="button">&#9664; Précédent</button>'
      + '<button class="btn play" data-a="go" type="button">&#9654; Suivant</button>'
      + '<button class="btn stop" data-a="stop" type="button">&#9632; Stop</button>'
      + '</div></div>';
  }

  function presetCard(p) {
    var cls = p.active ? ' on' : '';
    var audioBadge = p.hasAudio ? '&#128266;' : '&#128263;';
    var dur = p.duration ? (' — ' + Math.floor(p.duration / 60) + ':' + String(p.duration % 60).padStart(2, '0')) : '';
    return '<div class="card' + cls + '" data-id="' + esc(p.id) + '">'
      + '<h3><span class="dot"></span>' + esc(p.name || p.id) + dur + '</h3>'
      + '<div class="row">'
      + '<button class="btn play" data-a="play" type="button">' + audioBadge + ' &#9654; Lire</button>'
      + '<button class="btn stop" data-a="stop" type="button">&#9632; Stop</button>'
      + '</div></div>';
  }

  function chaserCard(c) {
    var cls = c.active ? ' on' : '';
    return '<div class="card' + cls + '" data-id="' + esc(c.id) + '">'
      + '<h3><span class="dot"></span>' + esc(c.name || c.id) + '</h3>'
      + '<div class="row">'
      + '<button class="btn nav" data-a="previous" type="button">&#9664;</button>'
      + '<button class="btn play" data-a="play" type="button">&#9654; Lire</button>'
      + '<button class="btn stop" data-a="stop" type="button">&#9632; Stop</button>'
      + '<button class="btn nav" data-a="next" type="button">&#9654;&#9654;</button>'
      + '</div></div>';
  }

  function bindActions(containerId, endpoint) {
    var el = document.getElementById(containerId);
    el.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      var card = ev.target.closest('.card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var act = btn.getAttribute('data-a');
      if (!id || !act) return;
      btn.disabled = true;
      post(endpoint + '/' + encodeURIComponent(id), { action: act })
        .then(refresh)
        .catch(function () {})
        .finally(function () { btn.disabled = false; });
    });
  }
  bindActions('scenes', 'api/scene');
  bindActions('chasers', 'api/chaser');
  bindActions('cueLists', 'api/cueList');
  bindActions('presets', 'api/songPreset');

  // ── Rendu de la Console Virtuelle ────────────────
  var ACTION_LABELS = {
    scene: 'Scène',
    chaser: 'Chaser',
    blackout: 'Noir',
    grandMaster: 'GM',
    dmxChannel: 'Canal',
    playSong: 'Preset',
    audioAutoScript: 'Audio',
    autoLoop: 'Boucle',
    bankLoop: 'Banque',
    loadShow: 'Show'
  };

  function vcButtonTile(w) {
    var color = safeColor(w.color);
    var on = w.active ? ' on' : '';
    var bg = w.active ? color + '55' : color + '18';
    var bd = w.active ? color : color + '55';
    var badge = ACTION_LABELS[w.actionType] || '';
    return '<button class="vc-btn' + on + '" type="button" data-id="' + esc(w.id) + '"'
      + ' style="background:' + bg + ';border-color:' + bd + (w.active ? ';box-shadow:0 0 18px ' + color + '66' : '') + '">'
      + '<span class="lbl">' + esc(w.label || w.id) + '</span>'
      + (badge ? '<span class="badge">' + esc(badge) + '</span>' : '')
      + '</button>';
  }

  function vcFaderTile(w) {
    var min = Number(w.min == null ? 0 : w.min);
    var max = Number(w.max == null ? 255 : w.max);
    var val = Number(w.value == null ? min : w.value);
    var lo = Math.min(min, max);
    var hi = Math.max(min, max);
    var span = hi - lo;
    var pct = span > 0 ? Math.round(((val - lo) / span) * 100) : 0;
    return '<div class="vc-fader" data-id="' + esc(w.id) + '">'
      + '<div class="fhead"><span class="fname">' + esc(w.label || w.id) + '</span>'
      + '<span class="fval" data-v="' + esc(w.id) + '">' + val + '</span></div>'
      + '<input type="range" data-fader="' + esc(w.id) + '" min="0" max="100" value="' + pct + '">'
      + '</div>';
  }

  function renderConsole() {
    var widgets = state.widgets || [];
    var pages = state.vcPages || [];

    // Signature STRUCTURELLE : si elle ne change pas, on ne touche pas au
    // DOM (le fader reste sous le doigt, pas de clignotement).
    var structSig = pages.join(',') + '#' + vcPage + '#';
    widgets.forEach(function (w) {
      structSig += w.id + '|' + w.type + '|' + (w.label || '') + '|' + (w.color || '') + '|' + w.pageIndex + ';';
    });

    if (structSig !== consoleSig) {
      consoleSig = structSig;
      vcEls = {};

      var pagesEl = document.getElementById('vcPages');
      pagesEl.innerHTML = pages.length > 1
        ? pages.map(function (name, i) {
            return '<button class="page-chip' + (i === vcPage ? ' on' : '') + '" type="button" data-page="' + i + '">'
              + esc(name) + '</button>';
          }).join('')
        : '';

      var visible = widgets.filter(function (w) {
        return pages.length > 1 ? w.pageIndex === vcPage : true;
      });
      var buttons = visible.filter(function (w) { return w.type === 'button'; });
      var sliders = visible.filter(function (w) { return w.type === 'slider'; });

      var html = '';
      if (buttons.length) {
        html += '<div class="vc-grid">' + buttons.map(vcButtonTile).join('') + '</div>';
      }
      if (sliders.length) {
        html += '<div class="vc-grid" style="margin-top:10px">' + sliders.map(vcFaderTile).join('') + '</div>';
      }
      if (!html) html = '<div class="empty">Aucun widget dans cette page</div>';
      document.getElementById('vcWidgets').innerHTML = html;

      var grid = document.getElementById('vcWidgets');
      Array.prototype.forEach.call(grid.querySelectorAll('.vc-btn'), function (el) {
        vcEls[el.getAttribute('data-id')] = { btn: el };
      });
      Array.prototype.forEach.call(grid.querySelectorAll('input[data-fader]'), function (el) {
        var id = el.getAttribute('data-fader');
        vcEls[id] = vcEls[id] || {};
        vcEls[id].input = el;
        vcEls[id].val = grid.querySelector('[data-v="' + id + '"]');
      });
    }

    // Mise a jour de l'etat EN PLACE (allumage, valeur du fader).
    widgets.forEach(function (w) {
      var refs = vcEls[w.id];
      if (!refs) return;
      if (w.type === 'button') {
        if (!refs.btn) return;
        var color = safeColor(w.color);
        refs.btn.classList.toggle('on', !!w.active);
        refs.btn.style.background = w.active ? color + '55' : color + '18';
        refs.btn.style.borderColor = w.active ? color : color + '55';
        refs.btn.style.boxShadow = w.active ? '0 0 18px ' + color + '66' : 'none';
      } else if (w.type === 'slider') {
        if (!refs.input || typeof w.value !== 'number') return;
        var lo = Math.min(Number(w.min == null ? 0 : w.min), Number(w.max == null ? 255 : w.max));
        var hi = Math.max(Number(w.min == null ? 0 : w.min), Number(w.max == null ? 255 : w.max));
        var span = hi - lo;
        var pct = span > 0 ? Math.round(((w.value - lo) / span) * 100) : 0;
        // On n'ecrase PAS la position si l'utilisateur est en train de
        // glisser le curseur : sinon le fader revient en arriere sous le doigt.
        var pending = Date.now() - (vcPending[w.id] || 0) < 2000;
        if (!dragging && !pending && document.activeElement !== refs.input) {
          refs.input.value = pct;
          if (refs.val) refs.val.textContent = String(w.value);
        }
      }
    });
  }

  // Actions console : bouton (toggle) et fader (slider).
  document.getElementById('vcWidgets').addEventListener('click', function (ev) {
    var btn = ev.target.closest('.vc-btn');
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    if (!id) return;
    btn.disabled = true;
    post('api/widget/' + encodeURIComponent(id), { action: 'toggle' })
      .then(refresh)
      .catch(function () {})
      .finally(function () { btn.disabled = false; });
  });

  document.getElementById('vcWidgets').addEventListener('input', function (ev) {
    var input = ev.target.closest('input[data-fader]');
    if (!input) return;
    var id = input.getAttribute('data-fader');
    var widget = (state.widgets || []).filter(function (w) { return w.id === id; })[0];
    if (!widget) return;
    var lo = Math.min(Number(widget.min == null ? 0 : widget.min), Number(widget.max == null ? 255 : widget.max));
    var hi = Math.max(Number(widget.min == null ? 0 : widget.min), Number(widget.max == null ? 255 : widget.max));
    var fraction = Number(input.value) / 100;
    var value = Math.round(lo + (hi - lo) * fraction);
    var label = document.querySelector('[data-v="' + id + '"]');
    if (label) label.textContent = String(value);
    vcPending[id] = Date.now();
    post('api/widget/' + encodeURIComponent(id), { action: 'slider', value: fraction })
      .catch(function () {});
  });

  document.getElementById('vcPages').addEventListener('click', function (ev) {
    var chip = ev.target.closest('.page-chip');
    if (!chip) return;
    vcPage = Number(chip.getAttribute('data-page')) || 0;
    consoleSig = null;
    renderConsole();
  });

  // Drapeau "l'utilisateur bouge un fader" : le snapshot ne doit pas
  // repositionner le curseur sous son doigt.
  var dragging = false;
  document.getElementById('vcWidgets').addEventListener('pointerdown', function (ev) {
    if (ev.target.closest('input[data-fader]')) dragging = true;
  });
  window.addEventListener('pointerup', function () { dragging = false; });
  window.addEventListener('pointercancel', function () { dragging = false; });

  // ── Mise à jour de l'affichage ───────────────────
  // Rendus incrementaux : le snapshot arrive toutes les 500 ms, on ne
  // reconstruit le DOM que si la STRUCTURE a change (liste, libelles,
  // couleurs). Sans ca, un fader en cours de glissement serait reinitialise
  // a chaque push et le doigt perdrait le curseur.
  var scenesSig = null;
  var chasersSig = null;
  var consoleSig = null;
  var vcEls = {};
  // Derniere valeur saisie localement (timestamp) par fader : le snapshot ne
  // doit pas repositionner le curseur tant que le PC n'a pas confirme.
  var vcPending = {};

  function renderScenes() {
    var scenes = state.scenes || [];
    var sig = scenes.map(function (x) { return x.id + '|' + (x.active ? 1 : 0); }).join(';');
    if (sig === scenesSig) return;
    scenesSig = sig;
    document.getElementById('scenes').innerHTML = scenes.length
      ? scenes.map(sceneCard).join('')
      : '<div class="empty">Aucune scene</div>';
  }

  function renderChasers() {
    var chasers = state.chasers || [];
    var sig = chasers.map(function (x) { return x.id + '|' + (x.active ? 1 : 0); }).join(';');
    if (sig === chasersSig) return;
    chasersSig = sig;
    document.getElementById('chasers').innerHTML = chasers.length
      ? chasers.map(chaserCard).join('')
      : '<div class="empty">Aucun chaser</div>';
  }

  function renderCueLists() {
    var cueLists = state.cueLists || [];
    var sig = cueLists.map(function (x) { return x.id + '|' + (x.active ? 1 : 0); }).join(';');
    if (sig === cueListsSig) return;
    cueListsSig = sig;
    document.getElementById('cueLists').innerHTML = cueLists.length
      ? cueLists.map(cueListCard).join('')
      : '<div class="empty">Aucune Cue List</div>';
  }

  var cueListsSig = null;

  function renderPresets() {
    var presets = state.songPresets || [];
    var sig = presets.map(function (x) { return x.id + '|' + (x.active ? 1 : 0); }).join(';');
    if (sig === presetsSig) return;
    presetsSig = sig;
    document.getElementById('presets').innerHTML = presets.length
      ? presets.map(presetCard).join('')
      : '<div class="empty">Aucun preset</div>';
  }

  var presetsSig = null;

  function render() {
    if (!state) return;
    if (state.pending) {
      statusText.textContent = 'Synchronisation...';
      return;
    }
    lastGood = Date.now();
    statusText.textContent = 'Connecté';
    blackoutBtn.classList.toggle('on', !!state.blackout);
    blackoutBtn.textContent = state.blackout ? 'NOIR TOTAL — ACTIF' : 'NOIR TOTAL';
    if (typeof state.grandMaster === 'number') {
      var pct = Math.max(0, Math.min(100, Math.round(state.grandMaster * 100)));
      gmSlider.value = pct;
      gmValue.textContent = pct + '%';
    }
    renderScenes();
    renderChasers();
    renderCueLists();
    renderPresets();
    renderConsole();
  }

  function poll() {
    api('api/state')
      .then(function (s) {
        state = s;
        render();
      })
      .catch(function () {
        if (Date.now() - lastGood > 2500) statusText.textContent = 'Hors ligne';
      });
  }
  function refresh() { poll(); }

  poll();
  setInterval(poll, 500);
})();
</script>
</body>
</html>
`;
