import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, AppMode } from './stores/appStore';
import { useShowStore } from './stores/showStore';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { QuickShowView } from './views/QuickShowView';
import { DesignView } from './views/DesignView';
import { PerformanceView } from './views/PerformanceView';
import { AudioCaptureProvider } from './hooks/useAudioCapture';
import { useAudioFileLoader } from './hooks/useAudioFileLoader';
import { useRgbMatrixPlayback } from './hooks/rgb-matrix-playback';
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

const App: React.FC = () => {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Lifted to App level — audio survives ALL tab AND mode switches
  const audioFile = useAudioFileLoader();

  // RGB Matrix playback engine — runs globally, writes DMX directly
  useRgbMatrixPlayback();

  // ─── Close Guard ─────────────────────────────────────────
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [saving, setSaving] = useState(false);

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
    if (!api || !universes?.length) return;
    try {
      for (const u of universes) {
        await api.addUniverse({
          id: u.id, name: u.name, type: u.type || 'usb-dmx',
          output: true, input: false, channels: u.channels || 512,
          serialPort: u.serialPort || '', artnetIP: u.artnetIP || '',
          artnetSubnet: u.artnetSubnet ?? 0, artnetUniverse: u.artnetUniverse ?? 0,
          sacnUniverse: u.sacnUniverse ?? 1, sacnPriority: u.sacnPriority ?? 100,
        }).catch(() => {});
      }
    } catch {}
  };

  // ─── Project: New / Save / Open (.lmproj) ──────────
  useEffect(() => {
    (window as any).__lm_new = () => {
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
      ss.setFixturePositions([]);
      ss.setFixtureGroups([]);
      ss.setScenes([]);
      ss.setChasers([]);
      ss.setEffects([]);
      ss.setCueLists([]);
      ss.setShows([]);
      // Also remove persisted show-store from disk
      window.lightMaestro?.storage?.remove('show-store').catch(() => {});
      window.location.reload();
    };

    (window as any).__lm_open = async () => {
      try {
        const result = await window.lightMaestro?.project?.open();
        if (!result) return;
        const data = JSON.parse(result.content);
        const ss = useShowStore.getState();
        if (data.showStore) {
          if (data.showStore.patchedFixtures) ss.setPatchedFixtures(data.showStore.patchedFixtures);
          if (data.showStore.universes) { ss.setShowUniverses(data.showStore.universes); syncUniversesToEngine(data.showStore.universes); }
          if (data.showStore.fixturePositions) ss.setFixturePositions(data.showStore.fixturePositions);
          if (data.showStore.fixtureGroups) ss.setFixtureGroups(data.showStore.fixtureGroups);
          if (data.showStore.scenes) ss.setScenes(data.showStore.scenes);
          if (data.showStore.chasers) ss.setChasers(data.showStore.chasers);
          if (data.showStore.effects) ss.setEffects(data.showStore.effects);
          if (data.showStore.cueLists) ss.setCueLists(data.showStore.cueLists);
          if (data.showStore.shows) ss.setShows(data.showStore.shows);
        }
        if (data.appStore) {
          useAppStore.setState(data.appStore);
        }
        useAppStore.getState().markClean();
      } catch (e) { console.error('Failed to open project:', e); }
    };

    (window as any).__lm_save = async () => {
      try {
        const showState = useShowStore.getState();
        const appState = useAppStore.getState();
        const { isDirty, markDirty, markClean, ...persistable } = appState;
        const data = {
          appStore: persistable,
          showStore: {
            patchedFixtures: showState.patchedFixtures,
            universes: showState.universes,
            fixturePositions: showState.fixturePositions,
            fixtureGroups: showState.fixtureGroups,
            scenes: showState.scenes,
            chasers: showState.chasers,
            effects: showState.effects,
            cueLists: showState.cueLists,
            shows: showState.shows,
          },
          version: 1,
          timestamp: new Date().toISOString(),
        };
        const json = JSON.stringify(data, null, 2);
        const saved = await window.lightMaestro?.project?.save(json);
        if (saved) useAppStore.getState().markClean();
      } catch (e) { console.error('Failed to save project:', e); }
    };

    return () => {
      delete (window as any).__lm_new;
      delete (window as any).__lm_open;
      delete (window as any).__lm_save;
    };
  }, []);

  const handleSaveAndQuit = async () => {
    setSaving(true);
    try {
      // Save show state (patched fixtures + groups)
      const showState = useShowStore.getState();
      await window.lightMaestro.show.save({
        patchedFixtures: showState.patchedFixtures,
        universes: showState.universes,
        fixtureGroups: showState.fixtureGroups,
      });
    } catch {
      // Save may fail (dialog cancelled, etc.) — still quit since user chose to
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
          <main className="flex-1 overflow-hidden">
            <div style={{ display: mode === 'quick' ? 'flex' : 'none' }} className="h-full flex-col">
              <QuickShowView audioFile={audioFile} />
            </div>
            <div style={{ display: mode === 'design' ? 'flex' : 'none' }} className="h-full flex-col">
              <DesignView />
            </div>
            <div style={{ display: mode === 'perform' ? 'flex' : 'none' }} className="h-full flex-col">
              <PerformanceView />
            </div>
          </main>
        </div>

        {/* Status Bar */}
        <StatusBar />

        {/* ─── Close Guard Modal ──────────────────────────── */}
        {showCloseModal && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
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
  const dmxRunning = useAppStore((s) => s.dmx.running);
  const blackout = useAppStore((s) => s.dmx.blackout);
  const bpm = useAppStore((s) => s.audio.bpm);
  const analyzing = useAppStore((s) => s.audio.analyzing);

  return (
    <footer className="h-7 bg-[#0d0d14] border-t border-gray-800 flex items-center px-4 text-xs text-gray-500 gap-4 select-none">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${dmxRunning ? 'bg-green-500' : 'bg-gray-600'}`} />
        <span>{dmxRunning ? t('statusBar.dmxOn') : t('statusBar.dmxOff')}</span>
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
