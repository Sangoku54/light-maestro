import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, AppMode } from './stores/appStore';
import { useShowStore } from './stores/showStore';
import { usePerformStore } from './stores/performStore';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { QuickShowView } from './views/QuickShowView';
import { DesignView } from './views/DesignView';
import { PerformanceView } from './views/PerformanceView';
import { AudioCaptureProvider } from './hooks/useAudioCapture';
import { useAudioFileLoader } from './hooks/useAudioFileLoader';
import { useRgbMatrixPlayback } from './hooks/rgb-matrix-playback';
import { useMidiTriggers } from './hooks/midi-trigger';
import { useRemoteTriggers } from './hooks/remote-trigger';
import { useMtcTriggers } from './hooks/mtc-trigger';
import { useOscTriggers } from './hooks/osc-trigger';
import { getLatencyMs } from './utils/latency-meter';
import { dmxBridge } from './utils/dmx-bridge';
import { collectCustomFixtureDefs, importCustomFixtureDefs } from './utils/custom-fixtures';
import { externalizeProjectAudio, writeAudioBlobs, resolveProjectAudio, resolveWidgetAudio, audioKeyOf, type ExtractedBlob } from './utils/project-audio';
import './styles/global.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, background: '#1a0000', color: '#ff4444', height: '100vh', fontFamily: 'monospace' }}>
          <h1>App Crash</h1>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{this.state.error?.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#994444', marginTop: 10 }}>{this.state.error?.stack?.slice(0, 500)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Project save (shared by Ctrl+S / __lm_save, Save & Quit and autosave) ───
const AUTOSAVE_INTERVAL_MS = 45 * 1000;

// Mutual exclusion: a manual save (save dialog open), a Save & Quit or an
// autosave in flight must never overlap another save.
let projectSaveInFlight = false;

/**
 * Serialize the FULL project (app store + show store incl. scenes/chasers/
 * effects/cueLists/shows/songPresets + virtual console widgets) and persist it.
 *
 * - silent=false → open the .lmproj save dialog (same path as Ctrl+S / __lm_save)
 * - silent=true  → write the userData autosave slot, no dialog, no toast
 *
 * Returns true when a snapshot was persisted. Never throws.
 */
async function saveProject(options: { silent?: boolean } = {}): Promise<boolean> {
  if (projectSaveInFlight) return false; // a save is already running — skip
  projectSaveInFlight = true;
  try {
    const showState = useShowStore.getState();
    const perfState = usePerformStore.getState();
    const appState = useAppStore.getState();
    const { isDirty, dirtyAt, markDirty, markClean, ...persistable } = appState;
    // Strip showData from widget configs (large binary, stored separately in show store)
    // but preserve showId and showName so the show can be found in the store on load.
    // Strip showData (gros binaire, stocké séparément dans le show store) et
    // externalise l'audio des widgets (ex. audioAutoScript : config.audioDataUrl
    // = data URL complète) — sinon le plafond de string V8 est déplacé, pas
    // supprimé.
    const widgetBlobs: ExtractedBlob[] = [];
    const widgets: any[] = [];
    for (const w of perfState.vcWidgets) {
      let out: any = w;
      if (out.config?.showData) {
        const { showData, ...rest } = out.config;
        out = { ...out, config: { ...rest, showId: showData.id, showName: showData.name } };
      }
      if (typeof out.config?.audioDataUrl === 'string' && out.config.audioDataUrl.length >= 1024) {
        try {
          const key = await audioKeyOf(out.config.audioDataUrl);
          widgetBlobs.push({ key, audioFileBase64: out.config.audioDataUrl });
          out = { ...out, config: { ...out.config, audioDataUrl: undefined, audioRef: key } };
        } catch { /* champ illisible → conservé tel quel */ }
      }
      widgets.push(out);
    }
    // Embarquer les définitions des fixtures custom : elles vivent dans
    // userData/fixtures et ne sont pas packagées → sans ça, un projet ouvert
    // sur une machine vierge ne peut pas résoudre ses fixtures patchées.
    const customFixtures = await collectCustomFixtureDefs(showState.patchedFixtures);
    // Externalise les blobs audio (songPresets ~55 Mo par chanson, shows,
    // tracks) hors du JSON du projet : au-delà de la taille maximale de
    // string de V8 (~536 Mo), JSON.stringify jette RangeError et la
    // sauvegarde échoue silencieusement (plus de sauvegarde possible après
    // ~8 presets paramétrés dans des widgets).
    const storage = (window as any).lightMaestro?.storage;
    const { presets: songPresetsOut, shows: showsOut, blobs } = await externalizeProjectAudio(
      showState.songPresets ?? [],
      showState.shows ?? [],
    );
    const data = {
      schemaVersion: 1,
      appStore: persistable,
      customFixtures,
      showStore: {
        patchedFixtures: showState.patchedFixtures,
        stageDims: showState.stageDims,
        universes: showState.universes,
        fixturePositions: showState.fixturePositions,
        fixtureGroups: showState.fixtureGroups,
        scenes: showState.scenes,
        sceneFolders: showState.sceneFolders,
        chasers: showState.chasers,
        effects: showState.effects,
        cueLists: showState.cueLists,
        shows: showsOut,
        songPresets: songPresetsOut,
        mtcMarkers: showState.mtcMarkers,
      },
      vcWidgets: widgets,
      version: 1,
      timestamp: new Date().toISOString(),
    };

    const allBlobs = [...blobs, ...widgetBlobs];
    const writeBlobs = async () => {
      if (storage?.set && storage?.has) await writeAudioBlobs(allBlobs, storage);
    };

    if (options.silent) {
      // No dialog: persist the full snapshot to the stable autosave slot.
      // NOTE: does NOT mark the project clean — only an explicit save (Ctrl+S /
      // Save & Quit) clears the dirty flag, so the quit save reminder stays active.
      // Les blobs sont écrits AVANT le snapshot : le fichier autosave ne doit
      // jamais référencer un blob pas encore sur disque.
      await writeBlobs();
      const ok = await (window as any).lightMaestro?.storage?.set('autosave', data);
      return !!ok;
    }

    const json = JSON.stringify(data, null, 2);
    const saved = await (window as any).lightMaestro?.project?.save(json);
    // Blobs écrits après le choix du chemin : si l'utilisateur annule, on ne
    // stocke rien pour rien.
    await writeBlobs();
    if (saved) {
      useAppStore.getState().markClean();
      // Set project name from save result (project:save resolves to the file path)
      const filePath = typeof saved === 'string' ? saved : saved?.filePath;
      if (filePath) {
        const fileName = String(filePath).split(/[/\\]/).pop()?.replace(/\.lmproj$/i, '') || '';
        useAppStore.getState().setProjectName(fileName || 'Sans titre');
      }
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to save project:', e);
    return false;
  } finally {
    projectSaveInFlight = false;
  }
}

const App: React.FC = () => {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Lifted to App level — audio survives ALL tab AND mode switches
  const audioFile = useAudioFileLoader();

  // RGB Matrix playback engine — runs globally, writes DMX directly
  useRgbMatrixPlayback();

  // MIDI triggers — global (scènes/chasers/cuelists/autoscript/widgets)
  useMidiTriggers();

  // Remote web LAN (lot #17) — commandes HTTP du serveur + push d'état
  useRemoteTriggers();

  // MTC entrant (lot #15) — cues sur timecode (global, toutes vues)
  useMtcTriggers();

  // OSC entrant (lot #16) — commandes UDP TouchOSC/Lemur (global, toutes vues)
  useOscTriggers();

  // Clear old persisted widgets from localStorage (now saved in project file)
  useEffect(() => {
    try {
      const key = 'light-maestro-perform';
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.state?.vcWidgets?.length > 0) {
          delete parsed.state.vcWidgets;
          localStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ─── Close Guard ─────────────────────────────────────────
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // ─── DMX Error Popup ────────────────────────────────────
  const [dmxError, setDmxError] = useState<string | null>(null);

  useEffect(() => {
    const api = (window as any).lightMaestro?.dmx;
    if (!api?.onError) return;
    const unsub = api.onError((msg: string) => {
      if (!dmxError) setDmxError(msg);
    });
    return unsub;
  }, [dmxError]);

  useEffect(() => {
    if (!window.lightMaestro?.app?.onBeforeClose) return;
    const unsub = window.lightMaestro.app.onBeforeClose(() => {
      if (useAppStore.getState().isDirty) {
        setShowCloseModal(true);
      } else {
        // No unsaved changes — close immediately
        window.lightMaestro.app.closeAction('discard');
      }
    });
    return unsub;
  }, []);

  // ─── ShowStore: no auto-load on startup (project starts fresh) ──

  const syncUniversesToEngine = async (universes: any[]) => {
    const api = (window as any).lightMaestro?.dmx;
    if (!api) return;
    const configs = (universes || []).map((u: any) => ({
      id: u.id, name: u.name, type: u.type || 'usb-dmx',
      output: true, input: false, channels: u.channels || 512,
      serialPort: u.serialPort || '', artnetIP: u.artnetIP || '',
      artnetSubnet: u.artnetSubnet ?? 0, artnetUniverse: u.artnetUniverse ?? 0,
      sacnUniverse: u.sacnUniverse ?? 1, sacnPriority: u.sacnPriority ?? 100,
    }));
    try {
      if (api.syncUniverses) {
        await api.syncUniverses(configs).catch(() => {});
      } else {
        for (const u of configs) await api.addUniverse(u).catch(() => {});
      }
    } catch { /* engine may not be ready yet */ }
  };

  // Keep the DMX engine's universe table mirroring showStore.universes so that
  // every output path (playback, Simple Desk, RGB matrix, design live-edit)
  // always has a registered hardware target — even right after a project load.
  const showUniverses = useShowStore((s) => s.universes);
  useEffect(() => {
    const id = setTimeout(() => syncUniversesToEngine(showUniverses), 150);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUniverses]);

  // ─── Project: New / Save / Open (.lmproj) ──────────
  useEffect(() => {
    (window as any).__lm_new = () => {
      // Clear project identity
      useAppStore.getState().setProjectName('');
      useAppStore.getState().setPresetName('');
      // Wipe persisted state
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('light-maestro') || k.startsWith('zustand')) {
          localStorage.removeItem(k);
        }
      });
      // Clear showStore
      const ss = useShowStore.getState();
      ss.setPatchedFixtures([]);
      ss.setShowUniverses([]);
      ss.setFixturePositions({});
      ss.setFixtureGroups([]);
      ss.setScenes([]);
      ss.setSceneFolders([]);
      ss.setChasers([]);
      ss.setEffects([]);
      ss.setCueLists([]);
      ss.setShows([]);
      ss.setSongPresets([]);
      ss.setMtcMarkers([]);
      usePerformStore.getState().vcSetWidgets([]);
      // Also remove persisted show-store from disk
      window.lightMaestro?.storage?.remove('show-store').catch(() => {});
      window.location.reload();
    };

    (window as any).__lm_open = async () => {
      try {
        const result = await window.lightMaestro?.project?.open();
        if (!result) return;
        const data = JSON.parse(result.content);
        // Ré-importer les fixtures custom embarquées AVANT que les fixtures
        // patchées ne tentent de résoudre leurs définitions (getDefinition).
        await importCustomFixtureDefs(data.customFixtures);
        // Extract project name from file path
        if (result.filePath) {
          const fileName = result.filePath.split(/[/\\]/).pop()?.replace(/\.lmproj$/i, '') || '';
          useAppStore.getState().setProjectName(fileName || 'Sans titre');
        }
        const ss = useShowStore.getState();
        // Résout les blobs audio externalisés (v2) AVANT l'hydratation des
        // stores — les widgets sont montés ensuite et doivent trouver leurs
        // shows/presets complets (résolution async awaitée avant vcSetWidgets).
        const storageApi = (window as any).lightMaestro?.storage;
        let resolvedShows: any[] = [];
        let resolvedPresets: any[] = [];
        if (storageApi?.get) {
          try {
            const r = await resolveProjectAudio(data.showStore?.songPresets ?? [], data.showStore?.shows ?? [], (k: string) => storageApi.get(k));
            resolvedShows = r.shows;
            resolvedPresets = r.presets;
          } catch (e) { console.warn('Failed to resolve project audio blobs:', e); }
        } else {
          // Pas d'API storage (web/tests) : blobs non résolus — le playback
          // DMX continue sur horloge virtuelle.
          resolvedShows = data.showStore?.shows ?? [];
          resolvedPresets = data.showStore?.songPresets ?? [];
        }
        if (data.showStore) {
          if (data.showStore.patchedFixtures) ss.setPatchedFixtures(data.showStore.patchedFixtures);
          if (data.showStore.stageDims) ss.setStageDims(data.showStore.stageDims);
          if (data.showStore.universes) { ss.setShowUniverses(data.showStore.universes); syncUniversesToEngine(data.showStore.universes); }
          if (data.showStore.fixturePositions) ss.setFixturePositions(data.showStore.fixturePositions);
          if (data.showStore.fixtureGroups) ss.setFixtureGroups(data.showStore.fixtureGroups);
          if (data.showStore.scenes) ss.setScenes(data.showStore.scenes);
          // Unconditional: a project without the field must not leak folders
          // from a previously opened project (sceneFolders is a plain list).
          ss.setSceneFolders(data.showStore.sceneFolders || []);
          if (data.showStore.chasers) ss.setChasers(data.showStore.chasers);
          if (data.showStore.effects) ss.setEffects(data.showStore.effects);
          if (data.showStore.cueLists) ss.setCueLists(data.showStore.cueLists);
          // Unconditional: un projet sans ces champs ne doit pas hériter des
          // shows/presets du projet précédent (blobs audio inclus).
          ss.setShows(resolvedShows);
          ss.setSongPresets(resolvedPresets);
          if (data.showStore.mtcMarkers) ss.setMtcMarkers(data.showStore.mtcMarkers);
        }
        if (data.appStore) {
          // Don't restore session-only fields from project file
          const { presetName: _discardedPreset, projectName: _discardedProj, ...restAppStore } = data.appStore;
          useAppStore.setState(restAppStore);
        }
        // Restore virtual console widgets
        if (data.vcWidgets && storageApi?.get) {
          try { data.vcWidgets = await resolveWidgetAudio(data.vcWidgets, (k: string) => storageApi.get(k)); } catch { /* blob absent */ }
        }
        if (data.vcWidgets) {
          usePerformStore.getState().vcSetWidgets(data.vcWidgets);
        } else {
          // Migration fallback: old .lmproj without vcWidgets → try localStorage
          try {
            const raw = localStorage.getItem('light-maestro-perform');
            if (raw) {
              const parsed = JSON.parse(raw);
              const oldWidgets = parsed?.state?.vcWidgets;
              if (Array.isArray(oldWidgets) && oldWidgets.length > 0) {
                usePerformStore.getState().vcSetWidgets(oldWidgets);
                useAppStore.getState().markDirty();
              }
            }
          } catch { /* no migration source */ }
        }
        useAppStore.getState().markClean();
      } catch (e) { console.error('Failed to open project:', e); }
    };

    (window as any).__lm_save = () => { saveProject(); };

    return () => {
      delete (window as any).__lm_new;
      delete (window as any).__lm_open;
      delete (window as any).__lm_save;
    };
  }, []);

  // ─── Global keyboard shortcuts ──────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        (window as any).__lm_save?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Autosave ───────────────────────────────────
  // Full-project snapshot every 45 s, only when there are unsaved changes.
  // Silent: no dialog, no toast. Skipped while another save is in flight
  // (manual Ctrl+S with the dialog open, or a Save & Quit in progress).
  useEffect(() => {
    let lastAutosaveAt = 0;
    const id = setInterval(async () => {
      const { isDirty, dirtyAt } = useAppStore.getState();
      if (!isDirty) return; // nothing new since last explicit save
      if (lastAutosaveAt >= dirtyAt) return; // snapshot already up to date
      const snapshotAt = dirtyAt; // capture before the async save (micro-race guard)
      const ok = await saveProject({ silent: true });
      if (ok) lastAutosaveAt = snapshotAt;
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const handleSaveAndQuit = async () => {
    setSaving(true);
    try {
      // Full project save (same path as Ctrl+S / __lm_save) — scenes, chasers,
      // effects, cue lists, shows, songPresets and VC widgets are all included.
      const saved = await saveProject();
      if (!saved) {
        // Save dialog cancelled/failed — still quit as the user chose, but keep
        // a silent autosave snapshot so the session stays recoverable.
        await saveProject({ silent: true });
      }
    } catch {
      // saveProject swallows its own errors — belt and braces, still quit
    }
    useAppStore.getState().markClean();
    setSaving(false);
    window.lightMaestro.app.closeAction('discard');
  };

  const handleDiscardAndQuit = () => {
    useAppStore.getState().markClean();
    window.lightMaestro.app.closeAction('discard');
  };

  const handleCancelClose = () => {
    setShowCloseModal(false);
  };

  const handleModeChange = useCallback((newMode: AppMode) => {
    // Leaving the design tools (or any view) releases the design-only
    // arbiter sources so the playback engine regains control — a scene
    // preview or fixture-on in the design panel must not keep pinning
    // channels (LTP) once the user switches to Perform/Quick.
    if (newMode !== 'design') {
      dmxBridge.release('design-test');
      dmxBridge.release('design-efx');
      dmxBridge.release('fixture-onoff');
    }
    setMode(newMode);
  }, [setMode]);

  // ─── Close Guard Modal ────────────────────────────
  return (
    <ErrorBoundary>
    <AudioCaptureProvider>
      <div className="app-shell bg-[#0a0a0f] text-gray-100 h-screen flex flex-col overflow-hidden">
        {/* Top Bar */}
        <TopBar
          mode={mode}
          onModeChange={handleModeChange}
        />

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <Sidebar mode={mode} collapsed={sidebarCollapsed} />

          {/* View Area — all views stay mounted, only one visible */}
          <main className="flex-1 overflow-hidden min-w-0">
            <div style={{ display: mode === 'quick' ? 'flex' : 'none' }} className="h-full flex-col min-w-0 overflow-hidden">
              <QuickShowView audioFile={audioFile} />
            </div>
            <div style={{ display: mode === 'design' ? 'flex' : 'none' }} className="h-full flex-col min-w-0 overflow-hidden">
              <DesignView />
            </div>
            <div style={{ display: mode === 'perform' ? 'flex' : 'none' }} className="h-full flex-col min-w-0 overflow-hidden">
              <PerformanceView />
            </div>
          </main>
        </div>

        {/* Status Bar */}
        <StatusBar />

        {/* ─── Close Guard Modal ──────────────────────────── */}
        {showCloseModal && (
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={handleCancelClose}
          >
            <div
              className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[420px] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-800/50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <span className="text-amber-400 text-lg">⚠</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{t('closeGuard.title')}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t('closeGuard.message')}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="p-6 space-y-3">
                <button
                  onClick={handleSaveAndQuit}
                  disabled={saving}
                  className="w-full px-4 py-3 bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm text-purple-200 hover:bg-purple-600/50 active:bg-purple-600/60 transition-all font-medium flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                >
                  {saving ? (
                    <>
                      <span className="w-4 h-4 border-2 border-purple-300 border-t-transparent rounded-full animate-spin" />
                      {t('closeGuard.saving')}
                    </>
                  ) : (
                    t('closeGuard.saveAndQuit')
                  )}
                </button>

                <button
                  onClick={handleDiscardAndQuit}
                  className="w-full px-4 py-3 bg-red-600/15 border border-red-700/30 rounded-lg text-sm text-red-300 hover:bg-red-600/25 active:bg-red-600/30 transition-all"
                >
                  {t('closeGuard.discardAndQuit')}
                </button>

                <button
                  onClick={handleCancelClose}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700/50 transition-all"
                >
                  {t('common.cancel')}
                </button>
              </div>

              {/* Footer hint */}
              <div className="px-6 py-3 border-t border-gray-800/50 bg-[#0d0d14]">
                <p className="text-[10px] text-gray-600 text-center">
                  {t('closeGuard.footer')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AudioCaptureProvider>
    </ErrorBoundary>
  );
};

const StatusBar: React.FC = () => {
  const { t } = useTranslation();
  const blackout = useAppStore((s) => s.dmx.blackout);
  const bpm = useAppStore((s) => s.audio.bpm);
  const analyzing = useAppStore((s) => s.audio.analyzing);

  // Live DMX output status, polled from the main-process engine
  const [dmxStatus, setDmxStatus] = useState<{
    running: boolean;
    frameRate: number;
    universes: Array<{ id: string; name: string; type: string; serialPort: string; artnetIP: string; sacnUniverse: number; active: boolean }>;
    lastError: string | null;
  } | null>(null);
  // Audio→DMX latency (renderer pipeline, rolling average over ~30 samples)
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const api = (window as any).lightMaestro?.dmx;
      if (!api?.getStatus) return;
      try { const s = await api.getStatus(); if (alive) setDmxStatus(s); } catch {}
      setLatencyMs(getLatencyMs());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <footer className="h-7 bg-[#0d0d14] border-t border-gray-800 flex items-center px-4 text-xs text-gray-500 gap-2 sm:gap-4 select-none">
      <div
        className="flex items-center gap-1.5 min-w-0 overflow-hidden"
        title={[
          ...(dmxStatus?.universes || []).map((u) =>
            `${u.name || u.id} · ${u.type}${
              u.type === 'usb-dmx' ? ' · ' + (u.serialPort || 'no port')
              : u.type === 'artnet' ? ' · ' + (u.artnetIP || 'broadcast')
              : ' · U' + u.sacnUniverse
            }${u.active ? '' : ' (inactive)'}`
          ),
          ...(dmxStatus?.lastError ? ['', '⚠ ' + dmxStatus.lastError] : []),
        ].join('\n')}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            dmxStatus?.lastError ? 'bg-red-500' : dmxStatus?.running ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
          }`}
        />
        <span className={dmxStatus?.lastError ? 'text-red-400' : ''}>
          {dmxStatus?.lastError
            ? t('statusBar.dmxOn') + ' ⚠'
            : dmxStatus?.running
            ? `${t('statusBar.dmxOn')} ${dmxStatus.frameRate} fps`
            : t('statusBar.dmxOff')}
        </span>
        <span
          className={
            'min-w-0 truncate ' +
            (latencyMs === null
              ? 'text-gray-600'
              : latencyMs < 30
              ? 'text-green-400'
              : latencyMs < 80
              ? 'text-amber-400'
              : 'text-red-400')
          }
          title="Latence pipeline renderer : lecture de l'état audio → trame DMX émise (IPC). N'inclut pas la latence matérielle (USB/ArtNet/sACN)."
        >
          {latencyMs === null ? 'Latence audio→DMX : —' : `Latence audio→DMX : ${Math.round(latencyMs)} ms`}
        </span>
      </div>
      {blackout && (
        <span className="text-red-400 font-bold animate-pulse">{t('statusBar.blackout')}</span>
      )}
      {analyzing && (
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span>{bpm > 0 ? `${Math.round(bpm)} BPM` : t('statusBar.listening')}</span>
        </div>
      )}
      <div className="flex-1" />
      <span>{t('app.version')}</span>
    </footer>
  );
};

export default App;
