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
 *   slider + `value` 0..1), `/api/blackout`, `/api/grandmaster`.
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
  /**
   * URLs d'accès LAN `http://<ip>:<port>/?token=<token>` (une par IPv4 non-internal).
   * Remplies côté main (electron/main.ts) via os.networkInterfaces().
   */
  urls: string[];
  /** Erreur du dernier démarrage (ex. EADDRINUSE), null si aucun souci. */
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

/**
 * Snapshot d'état poussé par le renderer (`remote:state`) et servi tel quel
 * par `GET /api/state`. Le producteur réel est src/hooks/remote-trigger.ts
 * (même lot) : il pousse le snapshot directement (sans wrapper `{ state }`)
 * et inclut aussi latencyMs / dmxRunning / timestamp - champs facultatifs
 * ici car le serveur ne fait que relayer.
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
 * Commandes normalisées émises au renderer (canal `remote:command`).
 * Le renderer les consomme pour piloter le show (scènes, chasers, blackout, GM).
 */
export type RemoteCommand =
  | { type: 'scene'; id: string; action: 'play' | 'stop' | 'toggle' }
  | { type: 'chaser'; id: string; action: 'play' | 'stop' | 'next' | 'previous' }
  | { type: 'blackout'; on: boolean }
  | { type: 'grandMaster'; value: number }
  /**
   * Widget de la Console Virtuelle (bouton OU fader).
   * - press/release : momentané (sensibilité flash des boutons)
   * - toggle        : bascule (bouton momentané = press immédiat suivi de release
   *                   côté renderer)
   * - slider        : pilotage du fader par `value` (fraction 0..1 du range
   *                   [min, max] du widget)
   */
  | { type: 'widget'; id: string; action: 'press' | 'release' | 'toggle' | 'slider'; value?: number };

const SCENE_ACTIONS = new Set(['play', 'stop', 'toggle']);
const CHASER_ACTIONS = new Set(['play', 'stop', 'next', 'previous']);
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

  /** Le main fournit la fenêtre cible (mainWindow) - voir electron/main.ts. */
  setMainWindow(win: BrowserWindow | null): void {
    this.mainWindow = win;
  }

  /**
   * Token courant. JAMAIS loggé : seule utilisation autorisée = construction
   * des URLs LAN dans le handler `remote:getStatus` du main.
   */
  getToken(): string {
    return this.token;
  }

  /** Démarre le serveur HTTP (0.0.0.0, port par défaut 8080). Idempotent. */
  start(): RemoteStatus {
    if ((this.running || this.starting) && this.server) return this.getStatus();
    // Nettoie un éventuel serveur resté dans un état mort (ex. EADDRINUSE).
    this.stop();

    this.port = this.resolvePort();
    this.token = crypto.randomBytes(16).toString('hex');
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
      // Pas d'IP ni de token ici : l'URL complète s'affiche côté renderer.
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

    // L'écoute est asynchrone : on expose l'état transitoire `starting` (honnête),
    // puis `running` bascule à l'event `listening` (ou `lastError` à l'event `error`).
    this.starting = true;
    srv.listen(this.port, '0.0.0.0');
    return this.getStatus();
  }

  /** Arrête le serveur (libère le port) et efface token + snapshot. */
  stop(): void {
    this.lastError = null;
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.running = false;
    this.starting = false;
    this.startedAt = null;
    this.token = '';
    this.snapshot = null;
    // Détache les handlers de l'ancien serveur avant fermeture : un event résiduel
    // (ex. EADDRINUSE tardif) ne doit pas corrompre l'état d'un re-start rapide.
    if (this.onListening) srv.off('listening', this.onListening);
    if (this.onError) srv.off('error', this.onError);
    this.onListening = null;
    this.onError = null;
    try {
      srv.closeAllConnections();
      srv.close(() => {});
    } catch {
      // serveur jamais écouté : rien à fermer
    }
  }

  /** Statut courant (urls remplies côté main). */
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

  /** Met à jour le snapshot servi par GET /api/state (poussé par le renderer). */
  setSnapshot(snapshot: RemoteStateSnapshot | null): void {
    this.snapshot = snapshot;
  }

  // ─── Routage ───────────────────────────────────────────────────────────────

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
      // Tant qu'aucun snapshot horodaté n'a été poussé par le renderer, la page
      // reçoit `{ pending: true }` et affiche « Synchronisation… » au lieu d'un
      // état vide trompeur (scènes absentes, blackout off, GM 100).
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
      if (url.pathname === '/api/blackout') {
        return this.readJsonBody(req, res, (body) => this.handleBlackout(res, body));
      }
      if (url.pathname === '/api/grandmaster') {
        return this.readJsonBody(req, res, (body) => this.handleGrandMaster(res, body));
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

  /** Widget de la Console Virtuelle : bouton (press/release/toggle) ou fader (slider). */
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
        return this.sendJson(res, 400, { ok: false, error: "value must be a number in [0, 1] when action='slider'" });
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
    if (!this.emitCommand({ type: 'grandMaster', value })) {
      return this.sendJson(res, 503, { ok: false, error: 'renderer indisponible' });
    }
    this.sendJson(res, 200, { ok: true });
  }

  // ─── Auth / helpers ────────────────────────────────────────────────────────

  /** Header `X-Auth-Token` OU query `?token=`. Comparaison en temps constant. */
  private isAuthorized(req: http.IncomingMessage, url: URL): boolean {
    const header = req.headers['x-auth-token'];
    const candidate = (Array.isArray(header) ? header[0] : header) ?? url.searchParams.get('token') ?? '';
    if (!this.token) return false; // serveur arrêté / jamais démarré
    if (!candidate) return false;
    const a = crypto.createHash('sha256').update(candidate).digest();
    const b = crypto.createHash('sha256').update(this.token).digest();
    return crypto.timingSafeEqual(a, b);
  }

  private safeDecode(raw: string): string | null {
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }

  /** Lit le body JSON (limité à 64 Ko), puis invoque `done`. */
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

  /**
   * Émet une commande au renderer. Retourne false si la fenêtre cible est
   * absente ou détruite (le renderer ne peut plus recevoir la commande) :
   * les handlers répondent alors 503 au lieu d'un 200 mensonger.
   */
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

// ─── Page web embarquée (FR, dark theme, gros boutons tactiles) ─────────────
// Servie telle quelle par GET / - aucun build requis. Le token reçu en query
// est mémorisé dans sessionStorage puis réutilisé en header X-Auth-Token.
// NB : chaîne construite SANS backticks ni `${` (template TS) - concaténation.

const REMOTE_PAGE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Light Maestro - Contrôle à distance</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0a0a0f; color: #e8e8f0; }
  header { padding: 16px 20px; background: #12121a; border-bottom: 1px solid #26263a; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  header h1 { font-size: 18px; margin: 0; font-weight: 700; letter-spacing: 0.3px; }
  #status { font-size: 12px; color: #8b8ba3; text-align: right; }
  main { padding: 16px 20px 40px; max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }
  section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1.2px; color: #8b8ba3; margin: 0 0 10px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
  .card { background: #15151f; border: 1px solid #26263a; border-radius: 14px; padding: 14px; }
  .card.active { border-color: #4ade80; box-shadow: 0 0 0 1px #4ade80 inset; }
  .card h3 { margin: 0 0 12px; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card h3 .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #3a3a4e; margin-right: 8px; vertical-align: middle; }
  .card.active h3 .dot { background: #4ade80; }
  .btn { flex: 1; border: 1px solid #33334d; background: #1e1e2c; color: #e8e8f0; border-radius: 10px; padding: 12px 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn:active { transform: scale(0.96); }
  .btn.play { background: #14532d; border-color: #22c55e; color: #dcfce7; }
  .btn.stop { background: #7f1d1d; border-color: #ef4444; color: #fee2e2; }
  .btn.toggle { background: #1e3a8a; border-color: #3b82f6; color: #dbeafe; }
  .btn.next, .btn.prev { background: #4a2d7a; border-color: #8b5cf6; color: #ede9fe; }
  .row { display: flex; gap: 8px; margin-top: 10px; }
  #blackout { width: 100%; padding: 26px; font-size: 22px; font-weight: 800; letter-spacing: 1px; border-radius: 16px; border: 1px solid #26263a; background: #1a1a26; color: #e8e8f0; cursor: pointer; }
  #blackout.on { background: #dc2626; border-color: #ef4444; color: #fff; }
  .slider-wrap { display: flex; align-items: center; gap: 14px; background: #15151f; border: 1px solid #26263a; border-radius: 14px; padding: 12px 16px; }
  input[type="range"] { flex: 1; height: 44px; accent-color: #f59e0b; }
  .gm-value { font-size: 20px; font-weight: 700; min-width: 52px; text-align: right; color: #fbbf24; }
  .empty { color: #8b8ba3; font-size: 14px; padding: 8px 2px; }
  #error { position: fixed; left: 16px; right: 16px; bottom: 16px; background: #7f1d1d; color: #fee2e2; border: 1px solid #ef4444; border-radius: 12px; padding: 14px 16px; font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
<header><h1>Light Maestro</h1><div id="status">Connexion...</div></header>
<main>
  <section>
    <h2>Blackout</h2>
    <button id="blackout" type="button">NOIR TOTAL</button>
  </section>
  <section>
    <h2>Grand master</h2>
    <div class="slider-wrap">
      <input type="range" id="gm" min="0" max="100" value="100" aria-label="Grand master">
      <span class="gm-value" id="gmValue">100</span>
    </div>
  </section>
  <section>
    <h2>Scènes</h2>
    <div class="cards" id="scenes"></div>
  </section>
  <section>
    <h2>Chasers</h2>
    <div class="cards" id="chasers"></div>
  </section>
</main>
<div id="error" hidden></div>
<script>
(function () {
  'use strict';
  var token = sessionStorage.getItem('lmToken');
  if (!token) {
    token = new URLSearchParams(window.location.search).get('token');
    if (token) sessionStorage.setItem('lmToken', token);
  }
  var errorEl = document.getElementById('error');
  var statusEl = document.getElementById('status');
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    statusEl.textContent = 'Erreur';
  }
  function hideError() { errorEl.hidden = true; }
  if (!token) {
    showError('Token manquant - ouvrez cette page depuis Light Maestro (URL avec ?token=).');
    return;
  }

  var state = null;
  var lastGood = 0;

  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.headers['X-Auth-Token'] = token;
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) { showError('Accès refusé - token invalide. Rouvrez la page depuis Light Maestro.'); throw new Error('unauthorized'); }
      hideError();
      return r.json().catch(function () { return {}; });
    });
  }
  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Blackout
  var blackoutBtn = document.getElementById('blackout');
  blackoutBtn.addEventListener('click', function () {
    var next = !(state && state.blackout);
    post('api/blackout', { on: next }).catch(function () {});
  });

  // Grand master (envoi throttlé à 150 ms pendant le glissement)
  var gm = document.getElementById('gm');
  var gmValue = document.getElementById('gmValue');
  var gmTimer = null;
  gm.addEventListener('input', function () {
    gmValue.textContent = gm.value;
    if (gmTimer) clearTimeout(gmTimer);
    gmTimer = setTimeout(function () {
      post('api/grandmaster', { value: Number(gm.value) / 100 }).catch(function () {});
    }, 150);
  });

  // Rendu des listes
  function sceneCard(s) {
    var active = s.active ? ' active' : '';
    return '<div class="card' + active + '" data-id="' + esc(s.id) + '"><h3><span class="dot"></span>' + esc(s.name || s.id) + '</h3>' +
      '<div class="row">' +
      '<button class="btn play" data-act="play" type="button">Lecture</button>' +
      '<button class="btn stop" data-act="stop" type="button">Stop</button>' +
      '<button class="btn toggle" data-act="toggle" type="button">Bascule</button>' +
      '</div></div>';
  }
  function chaserCard(c) {
    var active = c.active ? ' active' : '';
    return '<div class="card' + active + '" data-id="' + esc(c.id) + '"><h3><span class="dot"></span>' + esc(c.name || c.id) + '</h3>' +
      '<div class="row">' +
      '<button class="btn prev" data-act="previous" type="button">◀</button>' +
      '<button class="btn play" data-act="play" type="button">Lecture</button>' +
      '<button class="btn stop" data-act="stop" type="button">Stop</button>' +
      '<button class="btn next" data-act="next" type="button">▶</button>' +
      '</div></div>';
  }

  function bindActions(containerId, endpoint) {
    var el = document.getElementById(containerId);
    el.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      var card = ev.target.closest('.card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      if (!id || !act) return;
      post(endpoint + '/' + encodeURIComponent(id), { action: act })
        .then(refresh)
        .catch(function () {});
    });
  }
  bindActions('scenes', 'api/scene');
  bindActions('chasers', 'api/chaser');

  function render() {
    if (!state) return;
    // Pas encore de snapshot horodaté côté serveur : la page reste en
    // « Synchronisation… » au lieu d'afficher un état vide trompeur.
    if (state.pending) {
      statusEl.textContent = 'Synchronisation...';
      return;
    }
    lastGood = Date.now();
    statusEl.textContent = 'Connecté - MAJ ' + new Date().toLocaleTimeString('fr-FR');
    blackoutBtn.classList.toggle('on', !!state.blackout);
    blackoutBtn.textContent = state.blackout ? 'NOIR TOTAL - ACTIF' : 'NOIR TOTAL';
    if (typeof state.grandMaster === 'number') {
      var pct = Math.max(0, Math.min(100, Math.round(state.grandMaster * 100)));
      gm.value = pct;
      gmValue.textContent = String(pct);
    }
    var scenes = state.scenes || [];
    var scenesEl = document.getElementById('scenes');
    scenesEl.innerHTML = scenes.length
      ? scenes.map(sceneCard).join('')
      : '<div class="empty">Aucune scène dans le show</div>';
    var chasers = state.chasers || [];
    var chasersEl = document.getElementById('chasers');
    chasersEl.innerHTML = chasers.length
      ? chasers.map(chaserCard).join('')
      : '<div class="empty">Aucun chaser dans le show</div>';
  }

  function poll() {
    api('api/state').then(function (s) {
      state = s;
      render();
    }).catch(function () {
      if (Date.now() - lastGood > 2500) statusEl.textContent = 'Serveur injoignable';
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
