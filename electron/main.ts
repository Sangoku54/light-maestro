import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { DMXEngine } from './dmx/engine';
import { FixtureLibrary } from './fixtures/library';
import { checkForFixtureUpdates, getUpdateStatus as getFixtureUpdateStatus } from './fixtures/updater';
import { ShowStorage } from './show/storage';
import { MidiManager } from './midi/manager';
import { AudioAnalyzer } from './audio/analyzer';

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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const dmxEngine = new DMXEngine();
const fixtureLibrary = new FixtureLibrary();
const showStorage = new ShowStorage();
const midiManager = new MidiManager();
const audioAnalyzer = new AudioAnalyzer();

function createWindow() {
  const isDev = !app.isPackaged;

  // In dev mode, Vite dev server handles everything — skip auto-build
  // In production, ensure dist exists before showing window
  if (!isDev) ensureBuilt();

  mainWindow = new BrowserWindow({
    show: false,
    minWidth: 1024,
    minHeight: 700,
    title: 'Light Maestro',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Maximize at launch
  mainWindow.maximize();
  mainWindow.show();

  // Load strategy:
  //   1. Try Vite dev server (localhost:5173) — used by `npm run dev`
  //   2. Fall back to pre-built dist/renderer — used by .vbs/.bat launchers
  mainWindow.webContents.openDevTools({ mode: 'bottom' });
  if (isDev) {
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

  mainWindow.on('closed', () => { mainWindow = null; });

  // ─── Close guard: intercept close, let renderer decide ───
  mainWindow.on('close', (e) => {
    if (isQuitting) return; // allow actual close when explicitly quitting
    e.preventDefault();
    mainWindow?.webContents.send('app:before-close');
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Light Maestro');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => { mainWindow?.webContents.send('app:before-close'); } }
  ]));
}

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
ipcMain.handle('dmx:blackout', async () => dmxEngine.blackout());
ipcMain.handle('dmx:restore', async () => dmxEngine.restore());
ipcMain.handle('dmx:getUniverses', async () => dmxEngine.getUniverseConfigs());
ipcMain.handle('dmx:addUniverse', async (_, config: any) => dmxEngine.addUniverse(config));
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

// ─── IPC Handlers: Fixtures ──────────────────────────────────
ipcMain.handle('fixtures:loadLibrary', async () => fixtureLibrary.load());
ipcMain.handle('fixtures:search', async (_, query: string) => fixtureLibrary.search(query));
ipcMain.handle('fixtures:getDefinition', async (_, id: string) => fixtureLibrary.get(id));
ipcMain.handle('fixtures:addCustom', async (_, def: any) => fixtureLibrary.addCustom(def));
ipcMain.handle('fixtures:importQLC', async (_, filePath: string) => fixtureLibrary.importQLC(filePath));
ipcMain.handle('fixtures:getAll', async () => fixtureLibrary.getAll());
ipcMain.handle('fixtures:reloadLibrary', async () => {
  const count = await fixtureLibrary.load();
  return { count };
});
ipcMain.handle('fixtures:getUpdateStatus', async () => getFixtureUpdateStatus());

// ─── IPC Handlers: Show ──────────────────────────────────────
ipcMain.handle('show:save', async (_, show: any, filePath?: string) => showStorage.save(show, filePath));
ipcMain.handle('show:load', async (_, filePath: string) => showStorage.load(filePath));
ipcMain.handle('show:listRecent', async () => showStorage.listRecent());
ipcMain.handle('show:openDialog', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Open Show',
    filters: [{ name: 'Light Maestro Show', extensions: ['lmshow'] }],
    properties: ['openFile'],
  });
  if (!filePaths || filePaths.length === 0) return null;
  return showStorage.load(filePaths[0]);
});

// ─── IPC Handlers: Audio ──────────────────────────────────────
ipcMain.handle('audio:import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Import Audio File',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff'] }],
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

// ─── IPC Handlers: MIDI ──────────────────────────────────────
ipcMain.handle('midi:listDevices', async () => midiManager.listDevices());
ipcMain.handle('midi:connect', async (_, deviceId: string) => midiManager.connect(deviceId));
ipcMain.handle('midi:disconnect', async () => midiManager.disconnect());
ipcMain.handle('midi:getMapping', async () => midiManager.getMapping());
ipcMain.handle('midi:setMapping', async (_, mapping: any) => midiManager.setMapping(mapping));
ipcMain.on('midi:event', (_, event) => midiManager.handleEvent(event));

// ─── MIDI → Action Execution ─────────────────────────────────
// The mapping engine emits 'mapped' when incoming MIDI matches a
// registered mapping. This listener translates mapped events into
// DMX engine calls (direct) or scene/chaser triggers (forwarded
// to renderer where show state lives).
midiManager.on('mapped', ({ mapping, value, rawValue }: {
  mapping: import('./midi/manager').MidiMapping;
  value: number;
  rawValue: number;
}) => {
  const { target, midiChannel, midiType, midiValue } = mapping;

  // Always tell the renderer about MIDI activity (indicator light)
  mainWindow?.webContents.send('midi:activity', {
    channel: midiChannel,
    type: midiType,
    note: midiValue,
    velocity: rawValue,
    target,
    timestamp: Date.now(),
  });

  switch (target.type) {
    // ── Direct DMX control (zero IPC latency) ──────────────
    case 'dmx-channel':
      dmxEngine.setChannel(target.universe, target.channel, value);
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
    case 'widget':
    case 'autoscript':
      mainWindow?.webContents.send('midi:trigger', {
        target,
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
ipcMain.handle('project:save', async (_, content: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: `lightmaestro-project-${Date.now()}.lmproj`,
    filters: [{ name: 'Light Maestro Project', extensions: ['lmproj'] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return result.filePath;
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open Project',
    filters: [{ name: 'Light Maestro Project', extensions: ['lmproj'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  return { filePath, content };
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

// ─── IPC Handlers: General storage (for showStore) ─────────
ipcMain.handle('storage:get', async (_, key: string) => {
  try { const p = path.join(app.getPath('userData'), `${key}.json`); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); return null; } catch { return null; }
});
ipcMain.handle('storage:set', async (_, key: string, data: any) => {
  try { fs.writeFileSync(path.join(app.getPath('userData'), `${key}.json`), JSON.stringify(data), 'utf-8'); return true; } catch (e) { console.error('storage:set failed:', e); return false; }
});
ipcMain.handle('storage:remove', async (_, key: string) => {
  try { const p = path.join(app.getPath('userData'), `${key}.json`); if (fs.existsSync(p)) fs.unlinkSync(p); return true; } catch { return false; }
});

// ─── IPC Handlers: App Close Guard ──────────────────────────
ipcMain.handle('app:close-action', async (_event, action: 'save-and-quit' | 'discard') => {
  isQuitting = true;
  if (mainWindow) {
    mainWindow.close();
  }
});

app.whenReady().then(async () => {
  createWindow();
  createTray();
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

app.on('window-all-closed', async () => {
  await dmxEngine.stop();
  midiManager.disconnect();
  audioAnalyzer.stopCapture();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
