import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, crashReporter, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { autoUpdater } from 'electron-updater';
import { RemoteServer, type RemoteStateSnapshot } from './remote/server';
import { OscServer } from './osc/server';
import { DMXEngine } from './dmx/engine';
import { FixtureLibrary } from './fixtures/library';
import { checkForFixtureUpdates, getUpdateStatus as getFixtureUpdateStatus } from './fixtures/updater';
import { ShowStorage } from './show/storage';
import { MidiManager, type MidiMapping, type MidiTarget } from './midi/manager';
import type { MtcState } from './midi/mtc';
import { AudioAnalyzer } from './audio/analyzer';
import { crashLogger } from './utils/crash-logger';
import { packProject, unpackProject } from './project-envelope';
import { LicenseStore } from './license/store';
import { loginWithLicense, registerWithLicense, startCheckout, LicenseError } from './license/server';

// Disable GPU cache to avoid permission errors on Windows
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-sandbox');
// Fix serialport V8 HandleScope crash in Electron worker threads
app.commandLine.appendSwitch('no-force-async-hooks-checks');
// Silence Chromium Autofill errors in DevTools console
app.commandLine.appendSwitch('disable-features', 'Autofill');
// Disable disk cache in dev so Vite-served modules are always fresh
if (!app.isPackaged) app.commandLine.appendSwitch('disable-http-cache');
process.env.UV_THREADPOOL_SIZE = '8';
app.setPath('userData', path.join(app.getPath('appData'), 'light-maestro'));
// Taskbar grouping/pinning on Windows (doit matcher l'appId du build).
if (process.platform === 'win32') app.setAppUserModelId('com.lightmaestro.app');

/** Icône de fenêtre (barre des tâches en dev) — PNG du dossier assets/logo/. */
function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), 'assets', 'logo', 'icon-512.png'),
    path.join(process.resourcesPath, 'app', 'assets', 'logo', 'icon-512.png'),
    path.join(process.cwd(), 'assets', 'logo', 'icon-512.png'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return undefined;
}

// ─── Crash reporter (native minidumps, local only — Phase 1) ───
if (app.isPackaged) {
  const minidumpDir = path.join(app.getPath('userData'), 'logs', 'minidumps');
  try { fs.mkdirSync(minidumpDir, { recursive: true }); } catch {}
  try {
    crashReporter.start({
      submitURL: '',
      uploadToServer: false,
      compress: true,
      ignoreSystemCrashHandler: true,
      extra: {
        appName: 'Light Maestro',
        appVersion: app.getVersion(),
        platform: process.platform,
      },
    });
  } catch (e) { console.error('[crashReporter] start failed:', e); }
}

// ─── Main process exception handlers ───
let isCrashing = false;
process.on('uncaughtException', (error: Error) => {
  if (isCrashing) return;
  isCrashing = true;
  crashLogger.log('uncaughtException', {
    message: error.message,
    stack: error.stack || '',
    name: error.name,
  });
  try { dmxEngine.blackout(); } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:crash-log', {
      type: 'uncaughtException',
      message: error.message,
      timestamp: Date.now(),
    });
  }
  setTimeout(() => app.quit(), 500);
});

process.on('unhandledRejection', (reason: unknown) => {
  crashLogger.log('unhandledRejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack || '' : '',
    name: reason instanceof Error ? reason.name : 'Unknown',
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:crash-log', {
      type: 'unhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      timestamp: Date.now(),
    });
  }
});

// ─── Auto-build before showing window (packaged app ships pre-built; dev always fresh) ───
let _autoBuildDone = false;
function ensureBuilt(): void {
  if (_autoBuildDone) return;
  const projectRoot = path.join(__dirname, '../..');
  const indexPath = path.join(__dirname, '../renderer/index.html');
  const isDev = !app.isPackaged;

  // In dev mode, always rebuild to avoid stale renderer cache
  if (fs.existsSync(indexPath) && !isDev) { _autoBuildDone = true; return; }

  try {
    execSync('npx vite build', { cwd: projectRoot, stdio: 'inherit' });
    _autoBuildDone = true;
  } catch (_) {
    console.error('Auto-build failed; make sure dependencies are installed (npm install)');
  }
}

// ─── Splash timing & background renderer build ─────────────
const MIN_SPLASH_MS = 8000;
let splashShownAt = 0;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rebuild the renderer in the background, AFTER the splash is shown, so the
// splash appears instantly on launch instead of waiting for `vite build`.
// Only the standalone launcher (.vbs/.bat) sets LIGHT_MAESTRO_LAUNCH=1; dev
// (`npm run dev`) has its own Vite dev server and packaged apps ship pre-built.
function buildRendererAsync(): Promise<void> {
  return new Promise((resolve) => {
    if (app.isPackaged || process.env.LIGHT_MAESTRO_LAUNCH !== '1') {
      resolve();
      return;
    }
    const projectRoot = path.join(__dirname, '../..');
    const child = spawn('npx', ['vite', 'build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', () => resolve());
    child.on('error', (err) => {
      console.error('Renderer rebuild failed:', err);
      resolve();
    });
  });
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const dmxEngine = new DMXEngine();
const fixtureLibrary = new FixtureLibrary();
const showStorage = new ShowStorage();
const midiManager = new MidiManager();
// Restore the persisted MIDI mapping at boot (file I/O, safe before ready)
void midiManager.loadMapping();
const audioAnalyzer = new AudioAnalyzer();
const remoteServer = new RemoteServer();
const oscServer = new OscServer();
const licenseStore = new LicenseStore();

// ─── Splash screen (animated loading window) ────────────────
function createSplashWindow() {
  splashShownAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 520,
    height: 360,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const splashPath = app.isPackaged
    ? path.join(__dirname, '../renderer/splash.html')
    : path.join(__dirname, '../../public/splash.html');
  splashWindow.loadFile(splashPath);
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function createWindow() {
  const isDev = !app.isPackaged;

  // In dev mode, Vite dev server handles everything — skip auto-build
  // In production, ensure dist exists before showing window
  if (!isDev) ensureBuilt();

  const windowIcon = resolveWindowIcon();
  mainWindow = new BrowserWindow({
    show: false,
    minWidth: 900,
    minHeight: 600,
    title: 'Light Maestro',
    ...(windowIcon ? { icon: windowIcon } : {}),
    backgroundColor: '#0a0a0f',
    // Frameless title bar with native window controls (min/max/close) kept
    // as an overlay: no white Windows title bar, but the window can still be
    // closed/minimized/maximized and dragged via the TopBar's drag-region.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0d14',
      symbolColor: '#cbd5e1',
      height: 48,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  remoteServer.setMainWindow(mainWindow);
  oscServer.setMainWindow(mainWindow);

  // ─── Démarrage auto du serveur Remote (LAN :8080) ────────────────────────
  // Le panneau Remote est utilisable dès le lancement (URLs + jeton disponibles
  // sans action manuelle). Préférence persistée dans userData
  // (`remote-prefs.json`, écrite par le panneau : Stop = autoStart:false,
  // Start = autoStart:true). Toute erreur (ex. EADDRINUSE) est exposée via
  // `lastError` dans `remote:getStatus` — pas de crash au démarrage.
  try {
    const prefsPath = path.join(app.getPath('userData'), 'remote-prefs.json');
    const prefs = fs.existsSync(prefsPath)
      ? (JSON.parse(fs.readFileSync(prefsPath, 'utf-8')) as { autoStart?: boolean } | null)
      : null;
    if (prefs && prefs.autoStart === false) {
      console.log('[remote] démarrage auto désactivé (remote-prefs.autoStart=false)');
    } else {
      remoteServer.start();
    }
  } catch (e) {
    console.warn('[remote] démarrage auto impossible :', e instanceof Error ? e.message : e);
  }

  // Show the main window once its first frame is painted, keeping the
  // animated splash visible until then (with a minimum display time so the
  // intro animation is actually seen, plus a safety fallback in case the
  // renderer never signals ready).
  const showMain = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.maximize();
      mainWindow.show();
    }
  };
  let mainRevealed = false;
  const revealMain = () => {
    if (mainRevealed) return;
    mainRevealed = true;
    closeSplash();
    showMain();
  };
  mainWindow.once('ready-to-show', () => {
    setTimeout(revealMain, splashWindow ? 500 : 0);
  });
  mainWindow.webContents.on('did-fail-load', () => revealMain());
  setTimeout(revealMain, 15_000);

  // Open DevTools after page loads (calling before load causes them to be hidden).
  // Dev-only: a packaged build must never auto-open DevTools.
  if (isDev) {
    const openDev = () => { try { mainWindow?.webContents.openDevTools({ mode: 'bottom' }); } catch {} };
    mainWindow.webContents.on('did-finish-load', openDev);
  }

  // Load strategy:
  //   1. Try Vite dev server (localhost:5173) — used by `npm run dev`
  //   2. Fall back to pre-built dist/renderer — used by .vbs/.bat launchers
  if (isDev && process.env.LIGHT_MAESTRO_LAUNCH !== '1') {
    const viteUrl = 'http://localhost:5173';
    const fallbackPath = path.join(__dirname, '../renderer/index.html');
    const tryVite = (attempt: number) => {
      fetch(viteUrl).then(() => {
        mainWindow!.loadURL(viteUrl);
      }).catch(() => {
        if (attempt < 5) setTimeout(() => tryVite(attempt + 1), 500);
        else {
          console.log('Vite not running, loading pre-built renderer');
          mainWindow!.loadFile(fallbackPath);
        }
      });
    };
    tryVite(0);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; remoteServer.setMainWindow(null); oscServer.setMainWindow(null); });

  // ─── Renderer crash handlers ───
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    crashLogger.log('render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      message: `Renderer process gone: ${details.reason} (exit code ${details.exitCode})`,
    });
    // Immediate blackout — don't wait for watchdog (2s delay)
    try { dmxEngine.blackout(); } catch (e) { console.error('[render-gone] blackout failed:', e); }
    try {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      } else {
        mainWindow.webContents.reload();
      }
    } catch (e) {
      crashLogger.log('renderer-reload-failed', {
        message: `Failed to reload renderer: ${e instanceof Error ? e.message : String(e)}`,
      });
      app.quit();
    }
  });

  let unresponsiveTimer: NodeJS.Timeout | null = null;
  mainWindow.webContents.on('unresponsive', () => {
    crashLogger.log('renderer-unresponsive', {
      message: 'Renderer became unresponsive',
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:crash-log', {
        type: 'unresponsive',
        message: 'Renderer became unresponsive',
        timestamp: Date.now(),
      });
    }
    unresponsiveTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        crashLogger.log('renderer-unresponsive-kill', {
          message: 'Renderer killed after 10s unresponsive timeout',
        });
        mainWindow.webContents.forcefullyCrashRenderer();
      }
    }, 10_000);
  });

  mainWindow.webContents.on('responsive', () => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
    }
  });

  // ─── Renderer console capture (diagnostic: logs/renderer-console.log) ───
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    try {
      const LOG_DIR = crashLogger.getLogDir();
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      const filepath = path.join(LOG_DIR, 'renderer-console.log');
      const tags: Record<number, string> = { 0: 'log', 1: 'warn', 2: 'error', 3: 'info', 4: 'debug' };
      const tag = tags[level] ?? String(level);
      fs.appendFileSync(filepath, `[${new Date().toISOString()}] [${tag}] ${message}\n    at ${sourceId}:${line}\n`, 'utf-8');
    } catch { /* diagnostic only, never throws */ }
  });

  // ─── Close guard: intercept close, let renderer decide ───
  mainWindow.on('close', (e) => {
    if (isQuitting) return; // allow actual close when explicitly quitting
    e.preventDefault();
    mainWindow?.webContents.send('app:before-close');
  });
}

function createTray() {
  buildTrayMenu();
}

type MainLocale = 'fr' | 'en';
let mainLocale: MainLocale = 'fr';

/** Libellés natifs (tray + dialogues) — le renderer pousse sa langue via app:set-locale. */
const MAIN_STRINGS: Record<MainLocale, Record<string, string>> = {
  fr: {
    trayShow: 'Afficher', trayHide: 'Masquer', trayQuit: 'Quitter',
    dlgOpenShow: 'Ouvrir un show', dlgOpenFile: 'Ouvrir un fichier',
    dlgSaveFile: 'Enregistrer le fichier', dlgImportAudio: 'Importer un fichier audio',
    dlgOpenProject: 'Ouvrir un projet', dlgRepairPresets: 'Dossier de presets à réparer (.lmpreset)',
    filterShow: 'Show Light Maestro', filterAudio: 'Audio', filterProject: 'Projet Light Maestro',
  },
  en: {
    trayShow: 'Show', trayHide: 'Hide', trayQuit: 'Quit',
    dlgOpenShow: 'Open Show', dlgOpenFile: 'Open File',
    dlgSaveFile: 'Save File', dlgImportAudio: 'Import Audio File',
    dlgOpenProject: 'Open Project', dlgRepairPresets: 'Presets folder to repair (.lmpreset)',
    filterShow: 'Light Maestro Show', filterAudio: 'Audio', filterProject: 'Light Maestro Project',
  },
};

function L(key: string): string {
  return MAIN_STRINGS[mainLocale]?.[key] ?? MAIN_STRINGS.en[key] ?? key;
}

function buildTrayMenu(): void {
  if (!tray) {
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('Light Maestro');
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: L('trayShow'), click: () => mainWindow?.show() },
    { label: L('trayHide'), click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: L('trayQuit'), click: () => { mainWindow?.webContents.send('app:before-close'); } }
  ]));
}

ipcMain.handle('app:set-locale', (_event, locale: unknown) => {
  if (locale === 'en' || locale === 'fr') {
    mainLocale = locale;
    try { buildTrayMenu(); } catch { /* tray pas encore créé */ }
  }
  return mainLocale;
});

// ─── IPC Handlers: Remote web LAN ────────────────────────────
// Serveur HTTP embarqué (0.0.0.0:8080, token d'auth). Les commandes
// reçues par HTTP sont émises au renderer par le serveur lui-même
// (fenêtre cible fournie via setMainWindow — cf. electron/remote/server.ts).
ipcMain.handle('remote:start', () => remoteServer.start());
ipcMain.handle('remote:stop', () => {
  remoteServer.stop();
  return remoteServer.getStatus();
});
ipcMain.handle('remote:getStatus', () => {
  const status = remoteServer.getStatus();
  if (!status.running) return status;
  // URLs LAN : http://<ip>:<port>/?token=<token> pour chaque IPv4 non-internal.
  const urls: string[] = [];
  const token = remoteServer.getToken();
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${status.port}/?token=${encodeURIComponent(token)}`);
      }
    }
  }
  return { ...status, urls };
});
// Le renderer pousse le snapshot (scènes/chasers/blackout/GM) vers le cache
// HTTP. Supporte les deux formes : { state: snapshot } ou snapshot direct.
// Réponse sans contenu (équivalent 204) : le push est fire-and-forget.
ipcMain.handle('remote:state', (_event, payload: unknown) => {
  const wrapped = payload as { state?: unknown } | null;
  remoteServer.setSnapshot((wrapped && 'state' in wrapped ? wrapped.state : payload) as RemoteStateSnapshot | null);
});

// ████████ IPC Handlers: OSC entrant ████████████████████████████████████
// Serveur UDP (0.0.0.0, port par défaut 9000, aucun token - LAN de confiance,
// parité Remote). Les commandes OSC mappées sont émises au renderer par le
// serveur lui-même (fenêtre cible fournie via setMainWindow, canal
// `osc:command` - cf. electron/osc/server.ts). Le port optionnel passé à
// `osc:start` vient du panneau UI (persisté côté renderer via storage).
ipcMain.handle('osc:start', (_event, port?: number) => oscServer.start(port));
ipcMain.handle('osc:stop', () => {
  oscServer.stop();
  return oscServer.getStatus();
});
ipcMain.handle('osc:getStatus', () => oscServer.getStatus());

// ─── IPC Handlers: DMX ───────────────────────────────────────
ipcMain.handle('dmx:start', async () => {
  try { await dmxEngine.start(); } catch (e: any) {
    if (!e?.message?.includes('already running')) throw e;
  }
});
ipcMain.handle('dmx:stop', async () => dmxEngine.stop());
ipcMain.handle('dmx:setChannel', async (_, universe: number, channel: number, value: number) => {
  if (!dmxEngine.isRunning()) { try { await dmxEngine.start(); } catch {} }
  dmxEngine.setChannel(universe, channel, value);
});
ipcMain.handle('dmx:setChannels', async (_, universe: number, channels: Record<number, number>) => {
  if (!dmxEngine.isRunning()) { try { await dmxEngine.start(); } catch {} }
  dmxEngine.setChannels(universe, channels);
});
ipcMain.handle('dmx:isRunning', async () => dmxEngine.isRunning());
ipcMain.handle('dmx:applyGrandMaster', async (_e, level: number) => {
  dmxEngine.applyGrandMaster(Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0);
});
ipcMain.handle('dmx:blackout', async () => dmxEngine.blackout());
ipcMain.handle('dmx:restore', async () => dmxEngine.restore());
ipcMain.handle('dmx:getUniverses', async () => dmxEngine.getUniverseConfigs());
ipcMain.handle('dmx:getStatus', async () => dmxEngine.getStatus());
// Network monitoring: toggle sACN reception for a universe at runtime
ipcMain.handle('dmx:setSacnReceive', async (_, id: string, enabled: boolean) => {
  dmxEngine.setSacnReceive(id, !!enabled);
  return dmxEngine.getStatus();
});
ipcMain.handle('dmx:addUniverse', async (_, config: any) => dmxEngine.addUniverse(config));
ipcMain.handle('dmx:syncUniverses', async (_, configs: any[]) => dmxEngine.syncUniverses(configs || []));
ipcMain.handle('dmx:removeUniverse', async (_, id: string) => dmxEngine.removeUniverse(id));
ipcMain.handle('dmx:listSerialPorts', async () => {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    // Log for debugging
    console.log('[dmx:listSerialPorts] Raw serialport.list() result:', JSON.stringify(ports.map((p: any) => ({
      path: p.path, manufacturer: p.manufacturer, pnpId: p.pnpId,
      vendorId: p.vendorId, productId: p.productId, friendlyName: p.friendlyName,
    }))));
    return ports
      .map((p: any) => ({
        path: p.path,
        manufacturer: p.manufacturer || '',
        serialNumber: p.serialNumber || '',
        pnpId: p.pnpId || '',
        vendorId: p.vendorId || '',
        productId: p.productId || '',
        friendlyName: p.friendlyName || '',
        locationId: p.locationId || '',
      }));
  } catch (err: any) {
    console.error('[dmx:listSerialPorts] ERROR:', err?.message || err);
    return [];
  }
});

// ── Forward DMX engine errors to renderer ──
dmxEngine.on('error', (err: Error) => {
  console.warn('[dmx] engine error:', err.message);
  mainWindow?.webContents.send('dmx:error', err.message);
});

// ─── Watchdog fail-safe: renderer heartbeat → auto blackout + auto-restore ───
// The renderer pings `watchdog:ping` every ~500 ms (src/utils/renderer-watchdog.ts).
// Fail-safe rules (safety live):
//   • Never armed before the FIRST ping — a slow startup is not a failure.
//   • Re-armed on every ping; a healthy renderer never gets blacked out.
//   • If no ping arrives for more than WATCHDOG_TIMEOUT_MS, the renderer is
//     presumed dead (crash / hang / RAF loop killed): blackout every output
//     (zero frame pushed on all universes) and stop the engine so the worker
//     stops emitting and USB/Art-Net/sACN outputs are closed — no stale frame
//     can stay on the wire.
//   • AUTO-RESTORE: as soon as the renderer pings again (>=2 pings after the
//     fail-safe fired), the blackout is lifted (engine.restore()). One
//     transient stall >WATCHDOG_TIMEOUT_MS (heavy WebGL / analysis / cue
//     generation at startup or mid-play) must NOT permanently kill DMX; the
//     renderer's own playback tick re-starts the engine within its ~2s
//     re-check, and the play-start path also re-establishes output.
//   • Additionally, if the DMX worker dies while the renderer is alive and the
//     engine was previously started (graceful stop emits 'stopped'), we blackout
//     too — the output pipeline is dead either way.
const WATCHDOG_PING_INTERVAL_MS = 500;
// Tolerate transient renderer jank (heavy WebGL compile, analysis, cue
// generation) without tripping the fail-safe: the watchdog must only engage
// for a genuinely dead/hung renderer, otherwise a >2s hiccup at startup or
// during playback would blackout DMX for the rest of the session.
const WATCHDOG_TIMEOUT_MS = 4000;
let watchdogLastPing = 0;
let watchdogArmed = false;       // becomes true after the first ping
let watchdogFired = false;       // fail-safe already engaged for this dead window
let watchdogTimer: NodeJS.Timeout | null = null;
let engineStartedByUser = false; // engine reported 'started' (not a graceful stop)
let pingsAfterFailSafe = 0;      // consecutive pings received since the fail-safe fired

ipcMain.on('watchdog:ping', () => {
  watchdogLastPing = Date.now();
  if (!watchdogArmed) {
    watchdogArmed = true;
    startWatchdogTimer();
  }
  if (watchdogFired) {
    // Renderer is breathing again after a fail-safe. The blackout must not
    // stay latched forever: auto-lift it so the renderer's own engine
    // restart (playback tick _engineRecheck / play-start) can re-establish
    // output. Without this, one transient stall >WATCHDOG_TIMEOUT_MS killed
    // DMX for the whole session — "audio plays but lights stay black".
    pingsAfterFailSafe++;
    if (pingsAfterFailSafe >= 2) {
      watchdogFired = false;
      pingsAfterFailSafe = 0;
      try { dmxEngine.restore(); } catch (e) { console.error('[watchdog] restore() failed:', e); }
    }
  }
});

dmxEngine.on('started', () => { engineStartedByUser = true; });
dmxEngine.on('stopped', () => { engineStartedByUser = false; });

function startWatchdogTimer(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    if (!watchdogArmed) return;
    const now = Date.now();
    const rendererLost = now - watchdogLastPing > WATCHDOG_TIMEOUT_MS;
    const workerLost = engineStartedByUser && !dmxEngine.isRunning() && !rendererLost;
    if (!rendererLost && !workerLost) return;
    if (watchdogFired) return;
    watchdogFired = true;
    watchdogArmed = false; // wait for the next ping before re-evaluating
    const reason = rendererLost ? 'renderer heartbeat lost' : 'DMX worker lost';
    console.error(`[watchdog] ${reason} — FAIL-SAFE BLACKOUT engaged`);
    try { dmxEngine.blackout(); } catch (e) { console.error('[watchdog] blackout() failed:', e); }
    dmxEngine.stop().catch((e: Error) => console.error('[watchdog] engine stop failed:', e?.message || e));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dmx:error', `[watchdog] ${reason}: fail-safe blackout engaged`);
    }
  }, WATCHDOG_PING_INTERVAL_MS);
}

// ─── IPC Handlers: Fixtures ──────────────────────────────────
ipcMain.handle('fixtures:loadLibrary', async () => fixtureLibrary.load());
ipcMain.handle('fixtures:search', async (_, query: string) => fixtureLibrary.search(query));
ipcMain.handle('fixtures:getDefinition', async (_, id: string) => fixtureLibrary.get(id));
ipcMain.handle('fixtures:addCustom', async (_, def: any) => fixtureLibrary.addCustom(def));
ipcMain.handle('fixtures:importQLC', async (_, filePath: string) => fixtureLibrary.importQLC(filePath));
ipcMain.handle('fixtures:importGDTF', async (_, filePath: string) => fixtureLibrary.importGDTF(filePath));
ipcMain.handle('fixtures:getAll', async () => fixtureLibrary.getAll());
ipcMain.handle('fixtures:getBudgetList', async () => fixtureLibrary.getBudgetList());
ipcMain.handle('fixtures:reloadLibrary', async () => {
  const count = await fixtureLibrary.load();
  return { count };
});
ipcMain.handle('fixtures:getUpdateStatus', async () => getFixtureUpdateStatus());

// ─── IPC Handlers: Show ──────────────────────────────────────
ipcMain.handle('show:save', async (_, show: any, filePath?: string) => showStorage.save(show, filePath));
ipcMain.handle('show:load', async (_, filePath: string) => {
    const rawShow = showStorage.load(filePath) as any; // .lmproj may have customFixtures not in ShowData interface

    // Add custom fixtures from the show file to the fixture library
    // so that fixtureDefId references resolve correctly during DMX playback
    if (rawShow.customFixtures && rawShow.customFixtures.length > 0) {
      for (const def of rawShow.customFixtures) {
        // Normalize the ID: the .lmproj stores IDs like "custom-stage-right-stage-wash-7x10w-led-moving-head"
        // FixtureLibrary.addCustom already handles the "custom-" prefix logic
        // and persists to userData/fixtures/.json for survival across launches.
        fixtureLibrary.addCustom(def);
      }
      console.log(`[main] Added ${rawShow.customFixtures.length} custom fixtures from show to library`);
    }

    // Return the show but strip customFixtures from the returned object
    // so the renderer doesn't see an unexpected property
    const { customFixtures, ...show } = rawShow;
    return show;
  });
ipcMain.handle('show:listRecent', async () => showStorage.listRecent());
ipcMain.handle('show:openDialog', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: L('dlgOpenShow'),
    filters: [{ name: L('filterShow'), extensions: ['lmshow'] }],
    properties: ['openFile'],
  });
  if (!filePaths || filePaths.length === 0) return null;
  return showStorage.load(filePaths[0]);
});

// ─── IPC Handlers: Generic File Dialog ──────────────────────
ipcMain.handle('dialog:openFile', async (_, filters: Electron.FileFilter[]) => {
  const { filePaths } = await dialog.showOpenDialog({
    title: L('dlgOpenFile'),
    filters: filters || [],
    properties: ['openFile'],
  });
  if (!filePaths || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  return { filePath, content, name: path.basename(filePath) };
});

ipcMain.handle('dialog:saveFile', async (_, filters: Electron.FileFilter[], defaultName: string, content: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: L('dlgSaveFile'),
    defaultPath: defaultName,
    filters: filters || [],
  });
  if (!filePath) return null;
  fs.writeFileSync(filePath, content, 'utf-8');
  return { filePath, name: path.basename(filePath) };
});

// ─── IPC Handlers: Audio ──────────────────────────────────────
ipcMain.handle('audio:import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: L('dlgImportAudio'),
    filters: [{ name: L('filterAudio'), extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff'] }],
    properties: ['openFile'],
  });
  if (!filePaths || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', aiff: 'audio/aiff' }[ext] || 'audio/mpeg';
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  return { fileName: path.basename(filePath), filePath, dataUrl };
});

// ─── IPC Handlers: All-In-One structure (option B, offline) ───
// Le renderer envoie le WAV décodé (base64) ; le main exécute
// scripts/allinone_import.py et renvoie le JSON de structure.
ipcMain.handle('allinone:check', async () => {
  const { checkAllInOne } = await import('./audio/allinone');
  return checkAllInOne();
});

ipcMain.handle('allinone:analyze', async (event, payload: { wavBase64: string; fileName: string; model?: string }) => {
  const { analyzeAllInOne } = await import('./audio/allinone');
  const sender = event.sender;
  return analyzeAllInOne(payload.wavBase64, payload.fileName || 'audio.wav', (msg) => {
    try { sender.send('allinone:progress', msg); } catch {}
  }, { model: payload.model });
});

ipcMain.handle('allinone:cancel', async () => {
  const { cancelAllInOne } = await import('./audio/allinone');
  return cancelAllInOne();
});

// ─── IPC Handlers: MIDI ──────────────────────────────────────
ipcMain.handle('midi:listDevices', async () => midiManager.listDevices());
ipcMain.handle('midi:connect', async (_, deviceId: string) => midiManager.connect(deviceId));
ipcMain.handle('midi:disconnect', async () => midiManager.disconnect());
ipcMain.handle('midi:getMapping', async () => midiManager.getMapping());
ipcMain.handle('midi:setMapping', async (_, mapping: MidiMapping[]) => midiManager.setMapping(mapping));
ipcMain.handle('midi:addMapping', async (_, mapping: MidiMapping) => midiManager.addMapping(mapping));
ipcMain.handle('midi:removeMapping', async (_, id: string) => midiManager.removeMapping(id));
ipcMain.handle('midi:startLearn', async (_, target: MidiTarget) => midiManager.startLearn(target));
ipcMain.handle('midi:stopLearn', async () => midiManager.stopLearn());
// Feedback LED : le renderer pousse l'état des tuiles (scènes/chasers/blackout
// et boutons de la Console Virtuelle), le main le projette sur les mappings
// `feedback !== false` vers le port sortie ouvert (cf. MidiManager).
ipcMain.handle('midi:feedback', (_event, entries: unknown) =>
  midiManager.sendFeedbackState(Array.isArray(entries) ? (entries as Array<{ type: string; id?: string; on: boolean }>) : []),
);

// ─── IPC Handlers: Licence ───────────────────────────────────
ipcMain.handle('license:getState', () => licenseStore.getState());
ipcMain.handle('license:login', async (_event, email: string, password: string) => {
  try {
    const result = await loginWithLicense(email, password);
    licenseStore.setLicense({
      edition: result.edition,
      email: result.email,
      displayName: result.displayName,
      token: result.token,
    });
    return { ok: true, state: licenseStore.getState() };
  } catch (e) {
    if (e instanceof LicenseError) {
      return { ok: false, code: e.code, message: e.message };
    }
    return { ok: false, code: 'network', message: 'Erreur inattendue' };
  }
});
ipcMain.handle('license:register', async (_event, email: string, password: string, displayName?: string) => {
  try {
    const result = await registerWithLicense(email, password, displayName);
    licenseStore.setLicense({
      edition: result.edition,
      email: result.email,
      displayName: result.displayName,
      token: result.token,
    });
    return { ok: true, state: licenseStore.getState() };
  } catch (e) {
    if (e instanceof LicenseError) {
      return { ok: false, code: e.code, message: e.message };
    }
    return { ok: false, code: 'network', message: 'Erreur inattendue' };
  }
});
ipcMain.handle('license:checkout', async (_event, edition: string) => {
  const token = licenseStore.getToken();
  if (!token) return { ok: false, code: 'invalid_token', message: 'Non connecté' };
  if (edition !== 'standard' && edition !== 'full') {
    return { ok: false, code: 'invalid_edition', message: 'Édition inconnue' };
  }
  const url = await startCheckout(token, edition);
  if (!url) return { ok: false, code: 'network', message: 'Checkout indisponible' };
  return { ok: true, url };
});
ipcMain.handle('license:openUrl', async (_event, url: string) => {
  try {
    if (!/^https:\/\//i.test(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});
ipcMain.handle('license:logout', () => {
  licenseStore.clear();
  return { ok: true, state: licenseStore.getState() };
});

// ─── MIDI → Action Execution ─────────────────────────────────
// The mapping engine emits 'mapped' when incoming MIDI matches a
// registered mapping. This listener translates mapped events into
// DMX engine calls (direct) or scene/chaser triggers (forwarded
// to renderer where show state lives).
midiManager.on('mapped', ({ mapping, value, rawValue, release }: {
  mapping: MidiMapping;
  value: number;
  rawValue: number;
  release: boolean;
}) => {
  const { target, midiChannel, midiType, midiValue } = mapping;

  // Always tell the renderer about MIDI activity (indicator light)
  mainWindow?.webContents.send('midi:activity', {
    channel: midiChannel,
    type: release ? 'note-off' : midiType,
    note: midiValue,
    value: rawValue,
  });

  switch (target.type) {
    // ── Direct DMX control (zero IPC latency) ──────────────
    case 'dmx-channel':
      // MIDI values are normalized 0..127; DMX channels are 0..255.
      dmxEngine.setChannel(target.universe, target.channel, Math.round((value / 127) * 255));
      break;

    case 'blackout':
      if (rawValue > 63) {
        dmxEngine.blackout();
      } else {
        dmxEngine.restore();
      }
      break;

    case 'grandMaster':
      dmxEngine.applyGrandMaster(value / 127);
      break;

    // ── Forward to renderer (scenes/chasers live in show state) ──
    case 'scene':
    case 'chaser':
    case 'cueList':
    case 'autoscript':
      // A note-off / release must NOT re-trigger play/toggle actions
      if (release) break;
      mainWindow?.webContents.send('midi:trigger', {
        mapping,
        value,
        rawValue,
        timestamp: Date.now(),
      });
      break;

    case 'widget':
      // Widgets are press/release sensitive (flash, slider drag): forward
      // BOTH press and release so the renderer can stop on release.
      mainWindow?.webContents.send('midi:trigger', {
        mapping,
        value,
        rawValue,
        timestamp: Date.now(),
      });
      break;
  }
});

// Forward MIDI connection status to renderer
midiManager.on('connected', (deviceId: string) => {
  mainWindow?.webContents.send('midi:status', { connected: true, deviceId });
});
midiManager.on('disconnected', () => {
  mainWindow?.webContents.send('midi:status', { connected: false });
});

// Forward MIDI clock (throttled ~4 Hz) and mapping changes to renderer
midiManager.on('clock', (clock: { bpm: number; running: boolean }) => {
  mainWindow?.webContents.send('midi:clock', clock);
});
midiManager.on('mappingChanged', (mapping: MidiMapping[]) => {
  mainWindow?.webContents.send('midi:mapping-changed', mapping);
});

// Forward MTC state (lot #15) — frame décodée / Full Frame / transition
// lock↔unlock, ≤ ~30 msg/s (jamais par QF brut).
midiManager.on('mtc', (state: MtcState) => {
  mainWindow?.webContents.send('midi:mtc', state);
});

// ─── IPC Handlers: Audio ─────────────────────────────────────
ipcMain.handle('audio:getDevices', async () => audioAnalyzer.getDevices());
ipcMain.handle('audio:startCapture', async (_, deviceId: string) => audioAnalyzer.startCapture(deviceId));
ipcMain.handle('audio:stopCapture', async () => audioAnalyzer.stopCapture());
ipcMain.handle('audio:getAnalysis', async () => audioAnalyzer.getLatestAnalysis());

// ─── Forward audio analysis from renderer ────────────────────
ipcMain.on('audio:pushBuffer', (_, buffer: Float32Array) => {
  audioAnalyzer.processBuffer(buffer);
  const analysis = audioAnalyzer.getLatestAnalysis();
  mainWindow?.webContents.send('audio:analysis', analysis);
});

// ─── IPC Handlers: Project (full-project save/load) ───
ipcMain.handle('project:save', async (_, payload: { content: string; blobs: any[] }) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: `lightmaestro-project-${Date.now()}.lmproj`,
    filters: [{ name: L('filterProject'), extensions: ['lmproj'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const { content, blobs = [] } = payload ?? {};
  await packProject(result.filePath, content ?? '', blobs ?? []);
  return result.filePath;
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: L('dlgOpenProject'),
    filters: [{ name: L('filterProject'), extensions: ['lmproj'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const { content, blobs } = await unpackProject(filePath);
  return { filePath, content, blobs };
});

// ─── IPC Handlers: Song Presets (file-based, avoids localStorage quota) ──
const presetsPath = path.join(app.getPath('userData'), 'presets.json');
const showStorePath = path.join(app.getPath('userData'), 'show-store.json');
ipcMain.handle('presets:save', async (_, presets: any[]) => {
  try { fs.writeFileSync(presetsPath, JSON.stringify(presets), 'utf-8'); return true; } catch (e) { console.error('Failed to save presets:', e); return false; }
});
ipcMain.handle('presets:load', async () => {
  try { if (fs.existsSync(presetsPath)) return JSON.parse(fs.readFileSync(presetsPath, 'utf-8')); return []; } catch (e) { console.error('Failed to load presets:', e); return []; }
});

// ─── Batch repair: ré-embarque l'audio manquant des .lmpreset ───
// Certains .lmpreset ont été exportés SANS son (confirmation "sans audio"
// validée, ou vieux build) : le poids vient alors de l'analyse, pas d'un MP3.
// Pour chaque fichier sans `audioDataBase64`, on cherche le dernier bon audio
// connu (last-audio.json, clé = nom du preset) et on le ré-embarque (raw
// base64, sans préfixe data:). Écriture atomique (tmp + rename). Ne touche
// jamais aux fichiers déjà OK ni à leur contenu hors audio.
ipcMain.handle('presets:repairAudio', async () => {
  const pick = await dialog.showOpenDialog(mainWindow!, {
    title: L('dlgRepairPresets'),
    properties: ['openDirectory'],
  });
  if (pick.canceled || pick.filePaths.length === 0) return null;
  const folder = pick.filePaths[0];
  let lastAudio: Record<string, { base64?: string; fileName?: string }> = {};
  try {
    if (fs.existsSync(lastAudioPath)) lastAudio = JSON.parse(fs.readFileSync(lastAudioPath, 'utf-8')) || {};
  } catch {}
  const report: {
    folder: string;
    total: number;
    alreadyOk: string[];
    repaired: { file: string; preset: string; audioLen: number }[];
    missing: { file: string; preset: string; expectedAudio: string }[];
    errors: { file: string; error: string }[];
  } = { folder, total: 0, alreadyOk: [], repaired: [], missing: [], errors: [] };
  let files: string[] = [];
  try {
    files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.lmpreset'));
  } catch (e: any) {
    return { ...report, errors: [{ file: folder, error: `Lecture dossier impossible : ${e?.message || e}` }] };
  }
  report.total = files.length;
  for (const file of files) {
    const full = path.join(folder, file);
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
      const inFile = typeof data.audioDataBase64 === 'string' ? data.audioDataBase64 : '';
      if (inFile.length > 0) { report.alreadyOk.push(file); continue; }
      const presetName: string = data?.quickShow?.name || file.replace(/\.lmpreset$/i, '');
      const entry = lastAudio[presetName];
      const raw = typeof entry?.base64 === 'string' ? entry.base64 : '';
      const stripped = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
      if (stripped.length === 0) {
        report.missing.push({
          file,
          preset: presetName,
          expectedAudio: (data?.analysis?.fileName as string) || '(nom audio inconnu)',
        });
        continue;
      }
      data.audioDataBase64 = stripped;
      const tmp = `${full}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, full);
      report.repaired.push({ file, preset: presetName, audioLen: stripped.length });
    } catch (e: any) {
      report.errors.push({ file, error: `${e?.message || e}` });
    }
  }
  return report;
});

// ─── IPC Handlers: Last known-good audio per preset name (file-based) ──
// Empêche un export silencieux SANS audio d'écraser (et donc de perdre) le
// dernier .lmpreset qui contenait le son : c'est le registre persistant qui
// permet de réutiliser le dernier bon audio même en session fraîche.
const lastAudioPath = path.join(app.getPath('userData'), 'last-audio.json');
ipcMain.handle('lastAudio:save', async (_, map: Record<string, { base64: string; fileName?: string; ts: string }>) => {
  try { fs.writeFileSync(lastAudioPath, JSON.stringify(map), 'utf-8'); return true; } catch (e) { console.error('Failed to save last-audio:', e); return false; }
});
ipcMain.handle('lastAudio:load', async () => {
  try { if (fs.existsSync(lastAudioPath)) return JSON.parse(fs.readFileSync(lastAudioPath, 'utf-8')); return {}; } catch { return {}; }
});

// ─── IPC Handlers: General storage (for showStore) ─────────
ipcMain.handle('storage:get', async (_, key: string) => {
  try { const p = path.join(app.getPath('userData'), `${key}.json`); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); return null; } catch { return null; }
});
ipcMain.handle('storage:set', async (_, key: string, data: any) => {
  try {
    const p = path.join(app.getPath('userData'), `${key}.json`);
    // Atomic write: temp + rename (used by the silent autosave — a crash
    // mid-write must not corrupt the recovery snapshot)
    const tmpPath = `${p}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmpPath, p);
    return true;
  } catch (e) { console.error('storage:set failed:', e); return false; }
});
ipcMain.handle('storage:remove', async (_, key: string) => {
  try { const p = path.join(app.getPath('userData'), `${key}.json`); if (fs.existsSync(p)) fs.unlinkSync(p); return true; } catch { return false; }
});
// Existence d'une clé (blob audio externalisé déjà écrit — les saves suivants
// ne réécrivent pas des dizaines de Mo inutilement).
ipcMain.handle('storage:has', async (_, key: string) => {
  try { const p = path.join(app.getPath('userData'), `${key}.json`); return fs.existsSync(p); } catch { return false; }
});

// ─── IPC Handlers: App Close Guard ──────────────────────────
ipcMain.handle('app:close-action', async (_event, action: 'save-and-quit' | 'discard') => {
  isQuitting = true;
  if (mainWindow) {
    mainWindow.close();
  }
});

// ─── IPC Handlers: Auto-Update ──────────────────────────────
type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let currentUpdateStatus: UpdateStatus = { state: 'idle' };

function sendUpdateStatus(status: UpdateStatus): void {
  currentUpdateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:update-status', status);
  }
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) {
    console.log('[autoUpdater] Dev mode — auto-update disabled');
    return;
  }

  // Only enable auto-update when a real update channel is configured.
  // electron-builder writes app-update.yml next to the app only when a publish
  // provider is active. Le provider est `generic` (URL dans package.json >
  // build.publish) : tant que l'URL pointe vers une infra inexistante, le
  // check échoue en 404 → état 'error' affiché, JAMAIS de crash ni de
  // fausse mise à jour. Runbook release : héberger latest.yml + .exe sous
  // l'URL configurée, puis `npm run dist` SANS `--publish never`.
  const hasUpdateChannel = fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  if (!hasUpdateChannel) {
    console.log('[autoUpdater] No update channel (app-update.yml absent) — auto-update disabled');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[autoUpdater] Checking for update...');
    sendUpdateStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[autoUpdater] Update available: v${info.version}`);
    sendUpdateStatus({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[autoUpdater] Up to date');
    sendUpdateStatus({ state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[autoUpdater] Update downloaded: v${info.version}`);
    sendUpdateStatus({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater] Error:', err?.message || err);
    sendUpdateStatus({ state: 'error', message: err?.message || String(err) });
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[autoUpdater] checkForUpdatesAndNotify failed:', err?.message || err);
  });
}

ipcMain.handle('app:install-update', async () => {
  if (currentUpdateStatus.state === 'downloaded') {
    isQuitting = true;
    setTimeout(() => autoUpdater.quitAndInstall(), 500);
    return true;
  }
  return false;
});

ipcMain.handle('app:get-update-status', async () => currentUpdateStatus);

// ─── IPC Handlers: Crash Logs ───────────────────────────────
ipcMain.handle('app:get-crash-logs', async () => crashLogger.listLogs());
ipcMain.handle('app:read-crash-log', async (_event, filename: string) => crashLogger.readLog(filename));

app.whenReady().then(async () => {
  // Remove the default Electron menu bar (File/Edit/View/Window/Help) —
  // the app is fully custom UI; editing shortcuts (Ctrl+C/V/X/A/Z) still
  // work natively in text fields via Chromium.
  Menu.setApplicationMenu(null);
  createSplashWindow();
  // Rebuild the renderer in the background (standalone launch flow only), then
  // enforce a minimum splash display time before revealing the main window.
  await buildRendererAsync();
  const splashElapsed = Date.now() - splashShownAt;
  if (splashElapsed < MIN_SPLASH_MS) await sleepMs(MIN_SPLASH_MS - splashElapsed);
  createWindow();
  createTray();
  setupAutoUpdater();
  try {
    await fixtureLibrary.load();
  } catch (err) {
    console.error('Failed to load fixture library:', err);
  }

  // Background OFL update check (non-blocking, fire-and-forget)
  try {
    checkForFixtureUpdates((status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fixtures:update-status', status);

        if (!status.checking && status.newCount > 0) {
          mainWindow.webContents.send('fixtures:update-complete', {
            newCount: status.newCount,
          });
        }
      }
    });
  } catch (err) {
    console.error('Fixture update check failed:', err);
  }
}).catch((err) => {
  console.error('App startup failed:', err);
});

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    // Guaranteed blackout before exit — 100ms for USB frame to flush
    try { dmxEngine.blackout(); } catch (e) { console.error('[before-quit] blackout failed:', e); }
    setTimeout(() => app.exit(), 100);
    return;
  }
});

app.on('window-all-closed', async () => {
  // Double safety: blackout before stop (before-quit already does it, but cover all paths)
  try { dmxEngine.blackout(); } catch {}
  await dmxEngine.stop();
  midiManager.disconnect();
  audioAnalyzer.stopCapture();
  remoteServer.stop();
  oscServer.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
