import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generateAllThumbnails, getVariantsForCategory, type ThumbnailVariant } from '../utils/fixtureThumbnails';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Pause, Square, Trash2, GripVertical, Search, X, Edit2, Check, AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Zap, Save } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useShowStore, getFixtureColor, type PatchedFixture, type FixtureGroup, type SavedScene, type SavedChaser, type ChaserStep, type SavedCueList, type CueListCue, type ShowUniverse } from '../stores/showStore';
import { ShowManager } from './ShowManager';
import { Stage2DEditor } from './Stage2DEditor';
import { Stage3D } from './Stage3D';
import { useFixtureTest } from '../hooks/useFixtureTest';
import { loadFixtureDefinitions, type DmxFixtureDefinition, clearFixtureDefCache } from '../hooks/dmx-cues';
import { analyzeChannels } from '../engine/dmx-channel';
import { sendChannelsToHardware, sendToUniverse, sendFixtureOn, sendFixtureOff, sendChannelsToHardwareAndStore } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import { fixtureTestState } from '../utils/fixture-test-state';
import { useRgbMatrixStore } from '../stores/rgbmatrixStore';

/**
 * Design View — QLC+ Full Editor
 * 
 * Sidebar tabs control which editor section is shown.
 * Each section has its own sub-layout: list + editor panel.
 */

type EditorTab = 'fixtures' | 'groups' | 'scenes' | 'chasers' | 'show' | 'cuelists' | 'rgbmatrix' | 'efx' | 'stage' | 'settings';

/** True when a serial port looks like a DMX adapter (FTDI/Enttec/clones). */
function isDmxPort(p: any): boolean {
  const m = (p.manufacturer || '').toLowerCase();
  const fn = (p.friendlyName || '').toLowerCase();
  const pnp = (p.pnpId || '').toLowerCase();
  const vid = (p.vendorId || '').toLowerCase();
  const pid = (p.productId || '').toLowerCase();
  const isFtdi = vid === '0403';
  const isDmxName = m.includes('enttec') || m.includes('ftdi') || m.includes('dmx') ||
    m.includes('opto') || m.includes('usb serial') || m.includes('usb-serial') ||
    fn.includes('enttec') || fn.includes('ftdi') || fn.includes('dmx') ||
    fn.includes('opto') || fn.includes('usb serial') || fn.includes('usb-serial') ||
    pnp.includes('ftdi') || pnp.includes('dmx') || pnp.includes('enttec') ||
    pnp.includes('opto') || pnp.includes('0403');
  return isFtdi || isDmxName;
}

/** Full universe config payload for the DMX engine. */
function universeToEngineConfig(u: any): any {
  return {
    id: u.id,
    name: u.name,
    type: u.type,
    output: true,
    input: false,
    channels: u.channels,
    serialPort: u.serialPort || '',
    artnetIP: u.artnetIP || '',
    artnetSubnet: u.artnetSubnet ?? 0,
    artnetUniverse: u.artnetUniverse ?? 0,
    sacnUniverse: u.sacnUniverse ?? 1,
    sacnPriority: u.sacnPriority ?? 100,
    sacnReceive: u.sacnReceive,
    sacnMergeOutput: u.sacnMergeOutput,
  };
}

export const DesignView: React.FC = () => {
  const { t } = useTranslation();
  const activeTab = useAppStore((s) => s.designSidebarTab) as EditorTab;
  const [showFixtureEditor, setShowFixtureEditor] = useState(false);
  const [editFixtureData, setEditFixtureData] = useState<any>(null);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      {/* Sub-tab bar */}
      <div className="px-4 pt-3 pb-0 flex items-center gap-1 border-b border-gray-800/50">
        {([
          { key: 'fixtures', label: t('design.tabs.fixtures') },
          { key: 'stage', label: 'Vue 2D' },
          { key: 'groups', label: t('design.tabs.groups') },
          { key: 'scenes', label: t('design.tabs.scenes') },
          { key: 'chasers', label: t('design.tabs.chasers') },
          { key: 'show', label: t('design.tabs.show') },
          { key: 'cuelists', label: t('design.tabs.cueLists') },
          { key: 'rgbmatrix', label: t('design.tabs.rgbMatrix') },
          { key: 'efx', label: t('design.tabs.efx') },
          { key: 'settings', label: t('common.settings') },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => useAppStore.getState().setDesignSidebarTab(tab.key)}
            className={cnEditorTab(activeTab === tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1 border-b border-gray-800" />
      </div>

      {/* Show Manager & Stage — full screen */}
      {activeTab === 'show' ? (
        <div className="flex-1 flex overflow-hidden">
          <ShowManager />
        </div>
      ) : activeTab === 'stage' ? (
        <div className="flex-1 flex overflow-hidden">
          <Stage2DEditor />
        </div>
      ) : (
      <>
      {/* Editor Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Item List */}
        <div className="w-64 border-r border-gray-800/50 flex flex-col">
          <div className="p-3 border-b border-gray-800/50">
            <button
              onClick={() => {
                if (activeTab === 'fixtures') setShowFixtureEditor(true);
                else if (activeTab === 'scenes') {
                  const id = useShowStore.getState().createScene('New Scene');
                  (window as any).__lm_selectedSceneId = id;
                } else if (activeTab === 'chasers') {
                  const id = useShowStore.getState().createChaser('New Chaser');
                  (window as any).__lm_selectedChaserId = id;
                } else if (activeTab === 'cuelists') {
                  const id = useShowStore.getState().createCueList('New Cue List');
                  (window as any).__lm_selectedCueListId = id;
                } else if (activeTab === 'efx') {
                  const id = useShowStore.getState().createEffect('New EFX');
                  (window as any).__lm_selectedEffectId = id;
                }
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg text-xs font-medium transition-colors"
            >
              <Plus size={14} />
              New {activeTab.slice(0, -1)}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <ItemList mode={activeTab} />
          </div>
        </div>

        {/* Right: Editor Panel */}
        <div className="flex-1 overflow-y-auto p-4">
          <EditorPanel mode={activeTab} onEditFixture={(f) => { setEditFixtureData(f); setShowFixtureEditor(true); }} />
        </div>
      </div>
      { showFixtureEditor && <FixtureEditorModal onClose={() => { setShowFixtureEditor(false); setEditFixtureData(null); }} preloadedFixture={editFixtureData} /> }
      </>
      )}
    </div>
  );
};

// ─── Helpers ───────────────────────────────────────────────

const cnEditorTab = (active: boolean) =>
  `flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-medium transition-all ${
    active ? 'bg-[#12121a] text-purple-300 border-t border-l border-r border-gray-800' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/20'
  }`;

// ─── Item Lists ────────────────────────────────────────────

const ItemList: React.FC<{ mode: EditorTab }> = ({ mode }) => {
  switch (mode) {
    case 'show':
      return (
        <div className="text-xs text-gray-600 text-center py-8">
          Show Manager uses its own interface
        </div>
      );
    case 'scenes':
      return <SceneList />;
    case 'chasers':
      return <ChaserList />;
    case 'cuelists':
      return <CueListList />;
    case 'fixtures':
      return <PatchedFixtureList />;
    case 'groups':
      return <GroupsList />;
    case 'rgbmatrix':
      return <RgbMatrixList />;
    case 'efx':
      return <EFXList />;
    default:
      return (
        <div className="text-xs text-gray-600 text-center py-8">
          No {mode} created yet
        </div>
      );
  }
};

// ─── Editor Panels ─────────────────────────────────────────

const EditorPanel: React.FC<{ mode: EditorTab; onEditFixture?: (f: any) => void }> = ({ mode, onEditFixture }) => {
  switch (mode) {
    case 'show': return <div />;
    case 'scenes': return <SceneEditor />;
    case 'chasers': return <ChaserEditor />;
    case 'cuelists': return <CueListEditor />;
    case 'rgbmatrix': return <RGBMatrixEditor />;
    case 'efx': return <EFXEditor />;
    case 'fixtures': return <FixturePatcher onEditFixture={onEditFixture} />;
    case 'groups': return <GroupsEditor />;
    case 'settings': return <DesignSettingsPanel />;
    case 'stage': return <Stage2DEditor />;
    default: return <EmptyPanel />;
  }
};

const EmptyPanel: React.FC = () => (
  <div className="flex items-center justify-center h-full text-gray-600 text-sm">
    Select an item from the list to edit
  </div>
);

// ─── Scene Editor ──────────────────────────────────────────

interface AnalyzedChannel {
  index: number;
  name: string;
  type: string;
  dmxAddress: number;
  defaultValue?: number;
  capabilities?: Array<{ min: number; max: number; name: string; color?: string }>;
}

interface AnalyzedFixtureChannels {
  fixture: PatchedFixture;
  channels: AnalyzedChannel[];
  rgbGroup?: { r: number; g: number; b: number }; // channel indices within this fixture
  panIdx?: number;
  tiltIdx?: number;
  dimmerIdx?: number;
  shutterIdx?: number;
  goboIdx?: number;
  colorWheelIdx?: number;
}

function analyzeFixtureChannels(
  fixture: PatchedFixture,
  modeChannels: Array<{ name: string; type: string; defaultValue?: number; capabilities?: any[] }>
): AnalyzedFixtureChannels {
  const channels: AnalyzedChannel[] = modeChannels.map((ch, i) => ({
    index: i,
    name: ch.name || `Ch ${i + 1}`,
    type: ch.type || 'Nothing',
    dmxAddress: fixture.startAddress + i,
    defaultValue: ch.defaultValue,
    capabilities: ch.capabilities,
  }));

  const result: AnalyzedFixtureChannels = { fixture, channels };

  // Identify key channels
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (ch.type === 'Intensity' && result.dimmerIdx === undefined) result.dimmerIdx = i;
    if (ch.type === 'Pan' && result.panIdx === undefined) result.panIdx = i;
    if (ch.type === 'Tilt' && result.tiltIdx === undefined) result.tiltIdx = i;
    if (ch.type === 'Shutter' && result.shutterIdx === undefined) result.shutterIdx = i;
    if (ch.type === 'Gobo' && result.goboIdx === undefined) result.goboIdx = i;
    if (ch.type === 'Colour' && result.colorWheelIdx === undefined && !result.rgbGroup) {
      // Check if this is part of an RGB group
      const name = ch.name.toUpperCase();
      if (name.includes('RED') || name.includes(' R ') || name.startsWith('R ')) {
        // Look for G and B in next 2 channels
        const nextG = channels[i + 1];
        const nextB = channels[i + 2];
        const gName = nextG?.name.toUpperCase() || '';
        const bName = nextB?.name.toUpperCase() || '';
        if (nextG?.type === 'Colour' && (gName.includes('GREEN') || gName.includes(' G '))) {
          if (nextB?.type === 'Colour' && (bName.includes('BLUE') || bName.includes(' B '))) {
            result.rgbGroup = { r: i, g: i + 1, b: i + 2 };
            continue;
          }
        }
      }
      if (!result.rgbGroup) result.colorWheelIdx = i;
    }
  }

  return result;
}

const SceneList: React.FC = () => {
  const scenes = useShowStore((s) => s.scenes);
  const createScene = useShowStore((s) => s.createScene);
  const deleteScene = useShowStore((s) => s.deleteScene);
  const setDesignSidebarTab = useAppStore((s) => s.setDesignSidebarTab);

  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number; sceneId: string; sceneName: string }>(
    { visible: false, x: 0, y: 0, sceneId: '', sceneName: '' }
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  useEffect(() => {
    if (!ctxMenu.visible) return;
    const dismiss = () => setCtxMenu((c) => ({ ...c, visible: false }));
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [ctxMenu.visible]);

  const handleCreate = () => {
    const id = createScene('New Scene');
    setSelectedSceneId(id);
  };

  // Expose selected scene ID for the editor panel
  useEffect(() => {
    (window as any).__lm_selectedSceneId = selectedSceneId;
  }, [selectedSceneId]);

  if (scenes.length === 0) {
    return (
      <div className="text-xs text-gray-600 text-center py-8">
        No scenes yet. Click "New Scene" to create one.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {scenes.map((scene) => {
          const activeChannels = Object.entries(scene.channels).filter(([, v]) => v > 0);
          const isSelected = selectedSceneId === scene.id;
          return (
            <div
              key={scene.id}
              onClick={() => setSelectedSceneId(scene.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, sceneId: scene.id, sceneName: scene.name });
              }}
              className={`px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
                isSelected ? 'bg-purple-600/15 border border-purple-500/20' : 'hover:bg-gray-800/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-300 truncate">{scene.name}</div>
                  <div className="text-[10px] text-gray-600">
                    {activeChannels.length} ch · {scene.duration > 0 ? `${(scene.duration / 1000).toFixed(1)}s` : '∞'}
                  </div>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(scene.id); }}
                    className="p-1 text-gray-500 hover:text-red-400"
                    title="Delete scene"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {/* Active channel badges */}
              {activeChannels.length > 0 && (
                <div className="flex gap-0.5 mt-1">
                  {activeChannels.slice(0, 3).map(([addr, val]) => (
                    <span key={addr} className="text-[8px] px-1 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                      @{addr}:{val}
                    </span>
                  ))}
                  {activeChannels.length > 3 && (
                    <span className="text-[8px] text-gray-600">+{activeChannels.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {ctxMenu.visible && (
        <div
          className="fixed z-[60] bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">
            {ctxMenu.sceneName}
          </div>
          <button
            onClick={() => {
              setConfirmDelete(ctxMenu.sceneId);
              setCtxMenu((c) => ({ ...c, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-red-600/20 hover:text-red-200 transition-colors flex items-center gap-2"
          >
            <Trash2 size={12} /> Delete Scene
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setConfirmDelete(null)}>
          <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 shadow-2xl w-80" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-2">Delete Scene?</h4>
            <p className="text-xs text-gray-400 mb-4">
              This will permanently delete this scene. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50">
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteScene(confirmDelete);
                  setConfirmDelete(null);
                  if (selectedSceneId === confirmDelete) setSelectedSceneId(null);
                }}
                className="px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded-lg text-xs text-red-300 hover:bg-red-600/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const SceneEditor: React.FC = () => {
  const scenes = useShowStore((s) => s.scenes);
  const updateScene = useShowStore((s) => s.updateScene);
  const createScene = useShowStore((s) => s.createScene);
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);

  // Refs to avoid stale closures in DMX handlers
  const patchedFixturesRef = useRef(patchedFixtures);
  patchedFixturesRef.current = patchedFixtures;
  const universesRef = useRef(universes);
  universesRef.current = universes;

  // Get selected scene ID from the SceneList via window hack
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  // Listen for scene selection
  useEffect(() => {
    const check = () => {
      const id = (window as any).__lm_selectedSceneId;
      if (id !== selectedSceneId) setSelectedSceneId(id);
    };
    const interval = setInterval(check, 100);
    return () => clearInterval(interval);
  }, [selectedSceneId]);

  const scene = scenes.find((s) => s.id === selectedSceneId) || null;

  // Local editing state
  const [editName, setEditName] = useState('');
  const [editFadeIn, setEditFadeIn] = useState(1000);
  const [editFadeOut, setEditFadeOut] = useState(1000);
  const [editDuration, setEditDuration] = useState(5000);
  const [editChannels, setEditChannels] = useState<Record<number, number>>({});
  const [expandedFixtures, setExpandedFixtures] = useState<Set<string>>(new Set());
  const [fixtureAnalyses, setFixtureAnalyses] = useState<Map<string, AnalyzedFixtureChannels>>(new Map());
  const [testActive, setTestActive] = useState(false);
  const dmxPushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestChannelsRef = useRef<Record<number, number>>({});

  // Sync local state from selected scene + push to DMX engine
  useEffect(() => {
    // Cancel any pending DMX push from previous scene edits
    if (dmxPushRef.current) { clearTimeout(dmxPushRef.current); dmxPushRef.current = null; }
    if (scene) {
      setEditName(scene.name);
      setEditFadeIn(scene.fadeIn);
      setEditFadeOut(scene.fadeOut);
      setEditDuration(scene.duration);
      setEditChannels({ ...scene.channels });
      latestChannelsRef.current = { ...scene.channels };
      // Push scene channels to DMX engine immediately
      if (Object.keys(scene.channels).length > 0) {
        sendChannelsToHardwareAndStore(scene.channels, patchedFixtures, universes).catch(() => {});
      }
    } else {
      setEditName('');
      setEditFadeIn(1000);
      setEditFadeOut(1000);
      setEditDuration(5000);
      setEditChannels({});
      latestChannelsRef.current = {};
      // Blackout — clear entire DMX universe. Transient (2 s): the zeros
      // flush the hardware, then the design-test source is released so the
      // playback engine regains control (a persistent LTP zero block would
      // keep the show dark forever after deselecting the scene).
      const zeros: Record<number, number> = {};
      for (let i = 1; i <= 512; i++) zeros[i] = 0;
      sendChannelsToHardwareAndStore(zeros, patchedFixtures, universes, 'design-test', 2000).catch(() => {});
    }
  }, [scene?.id]);

  // Load fixture definitions for all patched fixtures
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const analyses = new Map<string, AnalyzedFixtureChannels>();
      for (const pf of patchedFixtures) {
        try {
          const def = await window.lightMaestro.fixtures.getDefinition(pf.fixtureDefId);
          if (cancelled) return;
          const mode = def?.modes?.[pf.modeIndex];
          if (mode?.channels) {
            analyses.set(pf.id, analyzeFixtureChannels(pf, mode.channels));
          }
        } catch {
          // Fixture def not loadable — skip
        }
      }
      if (!cancelled) {
        setFixtureAnalyses(analyses);
        // Auto-expand all if no scene is selected yet
        if (!scene && analyses.size > 0) {
          setExpandedFixtures(new Set(analyses.keys()));
        }
      }
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchedFixtures.length, scene?.id]);

  // Cleanup DMX push timer on unmount
  useEffect(() => {
    return () => { if (dmxPushRef.current) clearTimeout(dmxPushRef.current); };
  }, []);

  const handleChannelChange = (address: number, value: number) => {
    const clamped = Math.round(Math.max(0, Math.min(255, value)));
    setEditChannels((prev) => {
      const next = { ...prev, [address]: clamped };
      // Push live to DMX engine using refs (avoids stale closure from React lifecycle)
      latestChannelsRef.current = next;
      if (dmxPushRef.current) clearTimeout(dmxPushRef.current);
      dmxPushRef.current = setTimeout(() => {
        sendChannelsToHardwareAndStore(latestChannelsRef.current, patchedFixturesRef.current, universesRef.current).catch(() => {});
      }, 16);
      return next;
    });
  };

  const handleSave = () => {
    if (!scene) {
      // Create new scene from current edits
      const newId = createScene(editName || 'New Scene');
      updateScene(newId, {
        name: editName || 'New Scene',
        channels: editChannels,
        fadeIn: editFadeIn,
        fadeOut: editFadeOut,
        duration: editDuration,
      });
      setSelectedSceneId(newId);
      (window as any).__lm_selectedSceneId = newId;
    } else {
      updateScene(scene.id, {
        name: editName,
        channels: editChannels,
        fadeIn: editFadeIn,
        fadeOut: editFadeOut,
        duration: editDuration,
      });
    }
  };

  const handleTest = async () => {
    if (testActive) return;
    setTestActive(true);
    try {
      await sendChannelsToHardwareAndStore(editChannels, patchedFixtures, universes);
      setTimeout(async () => {
        // Reset all channels to 0 — TRANSIENT (2 s): the zeros flush the
        // hardware, then the design-test source is released so the engine
        // regains control (a persistent LTP zero block would keep the
        // tested scene's channels dark forever).
        const zeros: Record<number, number> = {};
        for (const addr of Object.keys(editChannels)) {
          zeros[Number(addr)] = 0;
        }
        try { await sendChannelsToHardwareAndStore(zeros, patchedFixtures, universes, 'design-test', 2000); } catch {}
        setTestActive(false);
      }, 3000);
    } catch {
      setTestActive(false);
    }
  };

  const toggleExpand = (fixtureId: string) => {
    setExpandedFixtures((prev) => {
      const next = new Set(prev);
      if (next.has(fixtureId)) next.delete(fixtureId);
      else next.add(fixtureId);
      return next;
    });
  };

  const expandAll = () => setExpandedFixtures(new Set(patchedFixtures.map((f) => f.id)));
  const collapseAll = () => setExpandedFixtures(new Set());
  const allExpanded = expandedFixtures.size === patchedFixtures.length && patchedFixtures.length > 0;

  const activeChannelCount = Object.values(editChannels).filter((v) => v > 0).length;

  // Group fixtures by tier, sorted by name
  const fixturesByTier = React.useMemo(() => {
    const map: Record<string, typeof patchedFixtures> = {
      primary: [],
      secondary: [],
      tertiary: [],
    };
    for (const pf of patchedFixtures) {
      const tierGroup = pf.tier || 'primary';
      map[tierGroup].push(pf);
    }
    for (const tierGroup of Object.keys(map)) {
      map[tierGroup].sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [patchedFixtures]);

  const TIER_SECTION_META: Record<string, { icon: string }> = {
    primary: { icon: '🎯' },
    secondary: { icon: '🔹' },
    tertiary: { icon: '⬜' },
    other: { icon: '⚙️' },
  };
  const TIER_ORDER = ['primary', 'secondary', 'tertiary', 'other'];

  // ── If no scene selected, show empty state ──
  if (!scene && patchedFixtures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600">
        <div className="text-4xl mb-3 opacity-30">🎬</div>
        <div className="text-sm mb-1">No scene selected</div>
        <div className="text-xs mb-4">Create a new scene from the left panel to start editing</div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full min-h-[540px]">
      <div className="flex-1 min-w-0 space-y-5">
      {/* Scene name */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={editName}
          onChange={(e) => { setEditName(e.target.value); if (scene) updateScene(scene.id, { name: e.target.value }); }}
          className="flex-1 bg-transparent text-xl font-bold text-white outline-none border-b border-transparent hover:border-gray-700 focus:border-purple-500/50 transition-colors pb-0.5"
          placeholder="Scene Name"
        />
        <span className="text-[10px] text-gray-600">{activeChannelCount} ch active</span>
      </div>

      {/* Timing params */}
      <div className="flex gap-4">
        <ParamField label="Fade In" value={editFadeIn} unit="ms" onChange={(v) => { setEditFadeIn(v); if (scene) updateScene(scene.id, { fadeIn: v }); }} />
        <ParamField label="Fade Out" value={editFadeOut} unit="ms" onChange={(v) => { setEditFadeOut(v); if (scene) updateScene(scene.id, { fadeOut: v }); }} />
        <ParamField label="Duration" value={editDuration} unit="ms" onChange={(v) => { setEditDuration(v); if (scene) updateScene(scene.id, { duration: v }); }} />
      </div>
      <p className="text-[9px] text-gray-500 -mt-3">Duration = fenêtre totale (fades inclus). 0 = maintien infini.</p>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-purple-600/30 text-purple-200 rounded-lg text-xs font-semibold hover:bg-purple-600/50 active:bg-purple-600/60 flex items-center gap-1.5 transition-all border border-purple-500/30 hover:border-purple-400/60"
        >
          <SaveIcon size={14} /> Save Scene
        </button>
        <button
          onClick={handleTest}
          disabled={testActive}
          className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border ${
            testActive
              ? 'bg-green-600/20 text-green-300 border-green-500/30'
              : 'bg-green-600/10 text-green-400 border-green-500/20 hover:bg-green-600/20'
          }`}
        >
          <Play size={14} /> {testActive ? 'Testing...' : 'Test Scene'}
        </button>
        <div className="flex-1" />
        <button onClick={allExpanded ? collapseAll : expandAll} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors">
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Fixture-based channel editor */}
      {patchedFixtures.length === 0 ? (
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-8 text-center">
          <div className="text-3xl mb-2 opacity-30">💡</div>
          <div className="text-sm text-gray-400 mb-1">No fixtures patched</div>
          <div className="text-xs text-gray-600">
            Switch to the Fixtures tab to patch fixtures before editing scenes.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {TIER_ORDER.map((tierGroup) => {
            const tierFixtures = fixturesByTier[tierGroup] || [];
            if (tierFixtures.length === 0) return null;
            return (
              <TierFixtureSection
                key={tierGroup}
                tier={tierGroup}
                icon={TIER_SECTION_META[tierGroup]?.icon || '⬜'}
                fixtures={tierFixtures}
                fixtureAnalyses={fixtureAnalyses}
                expandedFixtures={expandedFixtures}
                toggleExpand={toggleExpand}
                editChannels={editChannels}
                handleChannelChange={handleChannelChange}
                allFixtures={patchedFixtures}
              />
            );
          })}
        </div>
      )}
      </div>
      {/* Live 3D preview of the programmed scene */}
      <div className="w-[46%] shrink-0 rounded-xl overflow-hidden border border-gray-800/50 bg-[#08080e] min-h-[540px] h-full">
        <Stage3D />
      </div>
    </div>
  );
};

// ─── Tier Fixture Section (Scene Editor) ────────────────

const TierFixtureSection: React.FC<{
  tier: string;
  icon: string;
  fixtures: PatchedFixture[];
  fixtureAnalyses: Map<string, AnalyzedFixtureChannels>;
  expandedFixtures: Set<string>;
  toggleExpand: (id: string) => void;
  editChannels: Record<number, number>;
  handleChannelChange: (address: number, value: number) => void;
  allFixtures: PatchedFixture[];
}> = ({ tier, icon, fixtures, fixtureAnalyses, expandedFixtures, toggleExpand, editChannels, handleChannelChange, allFixtures }) => {
  const [sectionExpanded, setSectionExpanded] = React.useState(true);
  const tierBadgeColors: Record<string, string> = {
    primary: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    secondary: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    tertiary: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setSectionExpanded((v) => !v)}
        className="w-full px-4 py-2 flex items-center gap-2 hover:bg-gray-800/10 transition-colors text-left"
      >
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-gray-300">{tier.charAt(0).toUpperCase() + tier.slice(1)}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${tierBadgeColors[tier] || tierBadgeColors.primary}`}>
          {fixtures.length}
        </span>
        <div className="flex-1" />
        <ChevronDown
          size={14}
          className={`text-gray-500 transition-transform ${sectionExpanded ? '' : '-rotate-90'}`}
        />
      </button>
      {sectionExpanded && (
        <div className="px-2 pb-2 space-y-2 border-t border-gray-800/30">
          {fixtures.map((pf) => {
            const analysis = fixtureAnalyses.get(pf.id);
            const isExpanded = expandedFixtures.has(pf.id);
            const cIdx = allFixtures.indexOf(pf);
            const color = getFixtureColor(cIdx);

            return (
              <div key={pf.id} className="bg-[#12121a] border border-gray-800/30 rounded-lg overflow-hidden">
                {/* Fixture header */}
                <button
                  onClick={() => toggleExpand(pf.id)}
                  className="w-full px-3 py-2 flex items-center gap-2 hover:bg-gray-800/10 transition-colors text-left"
                >
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-200 truncate flex items-center gap-1.5">
                      {pf.name}
                      <span className={`inline-block px-1 py-0 rounded text-[8px] ${
                        pf.tier === 'primary' ? 'bg-purple-500/20 text-purple-400' :
                        pf.tier === 'secondary' ? 'bg-blue-500/20 text-blue-400' :
                        pf.tier === 'other' ? 'bg-cyan-500/20 text-cyan-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>{pf.tier}</span>
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {pf.manufacturer} {pf.model} · {pf.modeName} · @{pf.startAddress}
                    </div>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`text-gray-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                  />
                </button>

                {/* Channel controls */}
                {isExpanded && analysis && (
                  <FixtureChannelEditor
                    analysis={analysis}
                    editChannels={editChannels}
                    handleChannelChange={handleChannelChange}
                  />
                )}

                {/* Collapsed or no analysis */}
                {isExpanded && !analysis && (
                  <div className="px-3 pb-2 text-xs text-gray-600 border-t border-gray-800/30 pt-2">
                    Fixture definition not available. Patch mode may be missing.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Fixture Channel Editor (extracted from SceneEditor) ──

const FixtureChannelEditor: React.FC<{
  analysis: AnalyzedFixtureChannels;
  editChannels: Record<number, number>;
  handleChannelChange: (address: number, value: number) => void;
}> = ({ analysis, editChannels, handleChannelChange }) => (
  <div className="px-3 pb-3 space-y-2 border-t border-gray-800/30">
    {/* Dimmer */}
    {analysis.dimmerIdx !== undefined && (() => {
      const ch = analysis.channels[analysis.dimmerIdx];
      return (
        <ChannelSlider
          icon="🔅"
          label={ch.name}
          address={ch.dmxAddress}
          value={editChannels[ch.dmxAddress] ?? ch.defaultValue ?? 0}
          onChange={(v) => handleChannelChange(ch.dmxAddress, v)}
          color="bg-yellow-500"
        />
      );
    })()}

    {/* RGB Group */}
    {analysis.rgbGroup && (() => {
      const r = analysis.channels[analysis.rgbGroup.r];
      const g = analysis.channels[analysis.rgbGroup.g];
      const b = analysis.channels[analysis.rgbGroup.b];
      const rv = editChannels[r.dmxAddress] ?? r.defaultValue ?? 0;
      const gv = editChannels[g.dmxAddress] ?? g.defaultValue ?? 0;
      const bv = editChannels[b.dmxAddress] ?? b.defaultValue ?? 0;
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">🎨 Color (RGB)</span>
            <span
              className="w-5 h-5 rounded border border-gray-600 shrink-0"
              style={{ backgroundColor: `rgb(${rv},${gv},${bv})` }}
            />
          </div>
          <ChannelSlider
            icon="R"
            label={r.name}
            address={r.dmxAddress}
            value={rv}
            onChange={(v) => handleChannelChange(r.dmxAddress, v)}
            color="bg-red-500"
          />
          <ChannelSlider
            icon="G"
            label={g.name}
            address={g.dmxAddress}
            value={gv}
            onChange={(v) => handleChannelChange(g.dmxAddress, v)}
            color="bg-green-500"
          />
          <ChannelSlider
            icon="B"
            label={b.name}
            address={b.dmxAddress}
            value={bv}
            onChange={(v) => handleChannelChange(b.dmxAddress, v)}
            color="bg-blue-500"
          />
        </div>
      );
    })()}

    {/* Color Wheel */}
    {analysis.colorWheelIdx !== undefined && (() => {
      const ch = analysis.channels[analysis.colorWheelIdx];
      const caps = ch.capabilities?.filter((c: any) => c.color) || [];
      const currentVal = editChannels[ch.dmxAddress] ?? ch.defaultValue ?? 0;
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">🎨 {ch.name}</span>
            {caps.length > 0 && (
              <span className="text-[10px] text-gray-500">{caps.length} named colors</span>
            )}
          </div>
          {caps.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {caps.map((cap: any, ci: number) => {
                const isActive = currentVal >= cap.min && currentVal <= cap.max;
                return (
                  <button
                    key={ci}
                    onClick={() => handleChannelChange(ch.dmxAddress, cap.min)}
                    className={`px-2 py-1 rounded text-[10px] transition-all flex items-center gap-1 ${
                      isActive
                        ? 'ring-1 ring-purple-400/50 bg-gray-800/80'
                        : 'bg-gray-800/30 hover:bg-gray-800/50'
                    }`}
                    title={`${cap.name} (${cap.min}–${cap.max})`}
                  >
                    {cap.color && (
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: cap.color }} />
                    )}
                    <span className={isActive ? 'text-purple-300' : 'text-gray-400'}>{cap.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <ChannelSlider
            icon="🎨"
            label="Value"
            address={ch.dmxAddress}
            value={currentVal}
            onChange={(v) => handleChannelChange(ch.dmxAddress, v)}
            color="bg-pink-500"
          />
        </div>
      );
    })()}

    {/* Pan / Tilt */}
    {(analysis.panIdx !== undefined || analysis.tiltIdx !== undefined) && (
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-gray-400">📍 Pan / Tilt</span>
        <div className="flex items-start gap-3">
          <div className="relative w-16 h-16 bg-gray-800/40 border border-gray-700 rounded-lg shrink-0 overflow-hidden">
            <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-700/50" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700/50" />
            <div
              className="absolute w-2 h-2 rounded-full bg-purple-400 shadow-md shadow-purple-500/50 transition-all duration-100"
              style={{
                left: `${(((editChannels[analysis.channels[analysis.panIdx!]?.dmxAddress] ?? 128)) / 255) * 100}%`,
                top: `${(((editChannels[analysis.channels[analysis.tiltIdx!]?.dmxAddress] ?? 128)) / 255) * 100}%`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          </div>
          <div className="flex-1 space-y-1.5">
            {analysis.panIdx !== undefined && (
              <ChannelSlider
                icon="↔"
                label={analysis.channels[analysis.panIdx].name}
                address={analysis.channels[analysis.panIdx].dmxAddress}
                value={editChannels[analysis.channels[analysis.panIdx].dmxAddress] ?? analysis.channels[analysis.panIdx].defaultValue ?? 128}
                onChange={(v) => handleChannelChange(analysis.channels[analysis.panIdx!].dmxAddress, v)}
                color="bg-blue-500"
              />
            )}
            {analysis.tiltIdx !== undefined && (
              <ChannelSlider
                icon="↕"
                label={analysis.channels[analysis.tiltIdx].name}
                address={analysis.channels[analysis.tiltIdx].dmxAddress}
                value={editChannels[analysis.channels[analysis.tiltIdx].dmxAddress] ?? analysis.channels[analysis.tiltIdx].defaultValue ?? 128}
                onChange={(v) => handleChannelChange(analysis.channels[analysis.tiltIdx!].dmxAddress, v)}
                color="bg-cyan-500"
              />
            )}
          </div>
        </div>
      </div>
    )}

    {/* Shutter / Strobe */}
    {analysis.shutterIdx !== undefined && (() => {
      const ch = analysis.channels[analysis.shutterIdx];
      const val = editChannels[ch.dmxAddress] ?? ch.defaultValue ?? 0;
      let zoneLabel = '';
      if (val <= 31) zoneLabel = 'Closed';
      else if (val <= 63) zoneLabel = 'Open';
      else if (val <= 95) zoneLabel = 'Strobe slow';
      else if (val <= 127) zoneLabel = 'Strobe med';
      else if (val <= 159) zoneLabel = 'Strobe fast';
      else if (val <= 191) zoneLabel = 'Pulse';
      else if (val <= 223) zoneLabel = 'Random';
      else zoneLabel = 'Open';
      return (
        <div className="space-y-1">
          <ChannelSlider
            icon="⚡"
            label={`${ch.name} — ${zoneLabel}`}
            address={ch.dmxAddress}
            value={val}
            onChange={(v) => handleChannelChange(ch.dmxAddress, v)}
            color="bg-purple-500"
          />
          <div className="flex gap-1 text-[8px] text-gray-600">
            <span className="px-1 border-r border-gray-700">0-31 Closed</span>
            <span className="px-1 border-r border-gray-700">32-63 Open</span>
            <span className="px-1 border-r border-gray-700">64-95 Slow</span>
            <span className="px-1 border-r border-gray-700">96-127 Med</span>
            <span className="px-1 border-r border-gray-700">128-159 Fast</span>
            <span className="px-1">160+ FX</span>
          </div>
        </div>
      );
    })()}

    {/* Gobo */}
    {analysis.goboIdx !== undefined && (() => {
      const ch = analysis.channels[analysis.goboIdx];
      const caps = ch.capabilities || [];
      const currentVal = editChannels[ch.dmxAddress] ?? ch.defaultValue ?? 0;
      return (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-gray-400">❄️ {ch.name}</span>
          {caps.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {caps.map((cap: any, ci: number) => {
                const isActive = currentVal >= cap.min && currentVal <= cap.max;
                return (
                  <button
                    key={ci}
                    onClick={() => handleChannelChange(ch.dmxAddress, cap.min)}
                    className={`px-2 py-1 rounded text-[10px] transition-all ${
                      isActive
                        ? 'ring-1 ring-cyan-400/50 bg-gray-800/80 text-cyan-300'
                        : 'bg-gray-800/30 hover:bg-gray-800/50 text-gray-400'
                    }`}
                  >
                    {cap.name}
                  </button>
                );
              })}
            </div>
          )}
          <ChannelSlider
            icon="❄️"
            label="Value"
            address={ch.dmxAddress}
            value={currentVal}
            onChange={(v) => handleChannelChange(ch.dmxAddress, v)}
            color="bg-cyan-500"
          />
        </div>
      );
    })()}

    {/* Other channels */}
    {analysis.channels
      .filter((ch) => {
        const idx = ch.index;
        if (idx === analysis.dimmerIdx) return false;
        if (idx === analysis.panIdx) return false;
        if (idx === analysis.tiltIdx) return false;
        if (idx === analysis.shutterIdx) return false;
        if (idx === analysis.goboIdx) return false;
        if (idx === analysis.colorWheelIdx) return false;
        if (analysis.rgbGroup) {
          if (idx === analysis.rgbGroup.r) return false;
          if (idx === analysis.rgbGroup.g) return false;
          if (idx === analysis.rgbGroup.b) return false;
        }
        return true;
      })
      .map((ch) => {
        const iconMap: Record<string, string> = {
          Intensity: '🔅', Pan: '↔️', Tilt: '↕️', Colour: '🎨',
          Gobo: '❄️', Shutter: '⚡', Speed: '⏱️', Prism: '💠',
          Effect: '✨', Beam: '🔦', Maintenance: '🔧', Nothing: '⬜',
        };
        const icon = iconMap[ch.type] || '•';
        return (
          <ChannelSlider
            key={ch.dmxAddress}
            icon={icon}
            label={`${ch.name} (${ch.type})`}
            address={ch.dmxAddress}
            value={editChannels[ch.dmxAddress] ?? ch.defaultValue ?? 0}
            onChange={(v) => handleChannelChange(ch.dmxAddress, v)}
            color="bg-gray-500"
          />
        );
      })}
  </div>
);

// ─── Channel Slider Component ──────────────────────────────

const ChannelSlider: React.FC<{
  icon: string;
  label: string;
  address: number;
  value: number;
  onChange: (v: number) => void;
  color: string;
}> = ({ icon, label, address, value, onChange, color }) => (
  <div className="flex items-center gap-2 group">
    <span className="text-xs w-5 text-center shrink-0" title={icon.length > 1 ? icon : ''}>{icon}</span>
    <div className="flex-1 min-w-0 flex items-center gap-2">
      <span className="text-[10px] text-gray-400 truncate w-28 shrink-0" title={label}>
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={255}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 cursor-pointer accent-purple-500"
        style={{ accentColor: color.startsWith('bg-') ? undefined : color }}
      />
      <span className="text-[10px] text-gray-300 font-mono w-8 text-right shrink-0">{value}</span>
      <span className="text-[8px] text-gray-600 w-8 text-right shrink-0 hidden group-hover:inline">@{address}</span>
    </div>
  </div>
);

// ─── Save Icon (minimal inline SVG since lucide doesn't have Save) ──

const SaveIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17,21 17,13 7,13 7,21" />
    <polyline points="7,3 7,8 15,8" />
  </svg>
);

// ─── Chaser List (Left Panel) ──────────────────────────────

const ChaserList: React.FC = () => {
  const chasers = useShowStore((s) => s.chasers);
  const createChaser = useShowStore((s) => s.createChaser);
  const deleteChaser = useShowStore((s) => s.deleteChaser);

  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number; id: string; name: string }>(
    { visible: false, x: 0, y: 0, id: '', name: '' }
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!ctxMenu.visible) return;
    const dismiss = () => setCtxMenu((c) => ({ ...c, visible: false }));
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [ctxMenu.visible]);

  useEffect(() => {
    (window as any).__lm_selectedChaserId = selectedId;
  }, [selectedId]);

  const handleCreate = () => {
    const id = createChaser('New Chaser');
    setSelectedId(id);
  };

  if (chasers.length === 0) {
    return (
      <div className="text-xs text-gray-600 text-center py-8">
        No chasers yet. Click "New Chaser" to create one.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {chasers.map((chaser) => {
          const isSelected = selectedId === chaser.id;
          return (
            <div
              key={chaser.id}
              onClick={() => setSelectedId(chaser.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, id: chaser.id, name: chaser.name });
              }}
              className={`px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
                isSelected ? 'bg-purple-600/15 border border-purple-500/20' : 'hover:bg-gray-800/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-300 truncate">{chaser.name}</div>
                  <div className="text-[10px] text-gray-600">
                    {chaser.steps.length} step{chaser.steps.length !== 1 ? 's' : ''} · {chaser.speed} BPM · {chaser.direction}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(chaser.id); }}
                  className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Delete chaser"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {ctxMenu.visible && (
        <div
          className="fixed z-[60] bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">{ctxMenu.name}</div>
          <button
            onClick={() => {
              setConfirmDelete(ctxMenu.id);
              setCtxMenu((c) => ({ ...c, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-red-600/20 hover:text-red-200 transition-colors flex items-center gap-2"
          >
            <Trash2 size={12} /> Delete Chaser
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setConfirmDelete(null)}>
          <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 shadow-2xl w-80" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-2">Delete Chaser?</h4>
            <p className="text-xs text-gray-400 mb-4">This will permanently delete this chaser. This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50">Cancel</button>
              <button
                onClick={() => {
                  deleteChaser(confirmDelete);
                  setConfirmDelete(null);
                  if (selectedId === confirmDelete) setSelectedId(null);
                }}
                className="px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded-lg text-xs text-red-300 hover:bg-red-600/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ─── Chaser Editor ─────────────────────────────────────────

const STEP_COLORS = [
  '#ff0064', '#6400ff', '#00c8ff', '#ffc800',
  '#00ff88', '#ff6600', '#ff00cc', '#00ffcc',
  '#cc00ff', '#ffcc00', '#0064ff', '#ff0099',
  '#ff8800', '#8800ff', '#00e5ff', '#ff0044',
];

const ChaserEditor: React.FC = () => {
  const chasers = useShowStore((s) => s.chasers);
  const scenes = useShowStore((s) => s.scenes);
  const updateChaser = useShowStore((s) => s.updateChaser);
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);

  // Get selected chaser ID from list
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const check = () => {
      const id = (window as any).__lm_selectedChaserId;
      if (id !== selectedId) setSelectedId(id);
    };
    const interval = setInterval(check, 100);
    return () => clearInterval(interval);
  }, [selectedId]);

  const chaser = chasers.find((c) => c.id === selectedId) || null;

  // Local edit state
  const [editName, setEditName] = useState('');
  const [editSteps, setEditSteps] = useState<ChaserStep[]>([]);
  const [editDirection, setEditDirection] = useState<SavedChaser['direction']>('forward');
  const [editSpeed, setEditSpeed] = useState(120);

  // Add step popover
  const [showAddStep, setShowAddStep] = useState(false);
  const [stepSearch, setStepSearch] = useState('');
  const addStepRef = useRef<HTMLDivElement>(null);

  // Close Add Step popover on outside click
  useEffect(() => {
    if (!showAddStep) return;
    const handler = (e: MouseEvent) => {
      if (addStepRef.current && !addStepRef.current.contains(e.target as Node)) {
        setShowAddStep(false);
        setStepSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddStep]);

  // Editing step values inline
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);

  // Playback state
  const [playState, setPlayState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [activeStepIdx, setActiveStepIdx] = useState(-1);
  const [stepProgress, setStepProgress] = useState(0); // 0-1 for current step
  const playRef = useRef<{ timer: ReturnType<typeof setInterval> | null; paused: boolean; currentIdx: number; bouncingForward: boolean; phase: 'fadeIn' | 'hold' | 'fadeOut'; phaseStart: number; phaseDuration: number; startChannelValues: Record<number, number> }>({
    timer: null, paused: false, currentIdx: 0, bouncingForward: true,
    phase: 'fadeIn', phaseStart: 0, phaseDuration: 0, startChannelValues: {},
  });

  // Sync local state from selected chaser
  useEffect(() => {
    if (chaser) {
      setEditName(chaser.name);
      setEditSteps([...chaser.steps]);
      setEditDirection(chaser.direction);
      setEditSpeed(chaser.speed);
      setPlayState('stopped');
      setActiveStepIdx(-1);
      setStepProgress(0);
      stopPlayback();
    } else {
      setEditName('');
      setEditSteps([]);
      setEditDirection('forward');
      setEditSpeed(120);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaser?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ──
  const persistChanges = useCallback((steps: ChaserStep[], dir?: SavedChaser['direction'], spd?: number) => {
    if (!chaser) return;
    const updates: any = {};
    if (steps !== undefined) updates.steps = steps;
    if (dir !== undefined) updates.direction = dir;
    if (spd !== undefined) updates.speed = spd;
    updateChaser(chaser.id, updates);
  }, [chaser, updateChaser]);

  const sceneById = useCallback((sceneId: string) => scenes.find((s) => s.id === sceneId), [scenes]);

  const getSceneName = useCallback((sceneId: string) => {
    const s = sceneById(sceneId);
    return s ? s.name : '(missing scene)';
  }, [sceneById]);

  const getStepDuration = (step: ChaserStep) => step.fadeIn + step.hold + step.fadeOut;

  const getChaserSequence = useCallback((): ChaserStep[] => {
    if (editDirection === 'backward') return [...editSteps].reverse();
    return editSteps;
  }, [editSteps, editDirection]);

  // ── Playback ──
  const stopPlayback = useCallback(() => {
    if (playRef.current.timer) {
      clearInterval(playRef.current.timer);
      playRef.current.timer = null;
    }
    // Blackout
    const zeros: Record<number, number> = {};
    for (const step of editSteps) {
      const scn = sceneById(step.sceneId);
      if (scn) {
        for (const addr of Object.keys(scn.channels)) {
          zeros[Number(addr)] = 0;
        }
      }
    }
    if (Object.keys(zeros).length > 0) {
      // TRANSIENT (2 s): the zeros flush the hardware, then the design-test
      // source is released so the engine regains control after stopping the
      // chaser playback (a persistent LTP zero block would keep those
      // channels dark forever).
      try { sendChannelsToHardware(zeros, patchedFixtures, universes, 'design-test', 2000); } catch {}
    }
  }, [editSteps, sceneById]);

  const startPlayback = useCallback(() => {
    if (editSteps.length === 0) return;
    stopPlayback();

    let currentIdx = 0;
    let bouncingForward = true;
    let phase: 'fadeIn' | 'hold' | 'fadeOut' = 'fadeIn';
    let phaseStart = Date.now();
    const seq = editDirection === 'backward' ? [...editSteps].reverse() : editSteps;

    if (seq.length === 0) return;

    const step = seq[0];
    // Tempo = pure speed multiplier, normalized so 120 BPM (default) = exact ms durations
    const speedMultiplier = editSpeed / 120;
    const fadeInScaled = (step.fadeIn ?? 0) * speedMultiplier;
    let phaseDuration = fadeInScaled || 100;

    // Get initial scene channels
    const initScene = sceneById(step.sceneId);
    if (initScene) {
      try { sendChannelsToHardware({}, patchedFixtures, universes, 'design-test'); } catch {}
    }

    const tick = () => {
      const now = Date.now();
      const elapsed = now - phaseStart;
      const progress = Math.min(1, elapsed / phaseDuration);

      const currentStep = seq[currentIdx];
      if (!currentStep) return;

      const scn = sceneById(currentStep.sceneId);
      if (!scn) {
        // Skip missing scene
        advanceStep();
        return;
      }

      // Calculate target values for this phase
      let targetValues: Record<number, number> = {};
      if (phase === 'fadeIn') {
        // Fade from 0 to full
        for (const [addrStr, val] of Object.entries(scn.channels)) {
          targetValues[Number(addrStr)] = Math.round(val * progress);
        }
      } else if (phase === 'hold') {
        targetValues = { ...scn.channels };
      } else if (phase === 'fadeOut') {
        // Fade from full to 0
        for (const [addrStr, val] of Object.entries(scn.channels)) {
          targetValues[Number(addrStr)] = Math.round(val * (1 - progress));
        }
      }

      try { sendChannelsToHardware(targetValues, patchedFixtures, universes, 'design-test'); } catch {}

      setActiveStepIdx(currentIdx);
      setStepProgress(progress);

      if (progress >= 1) {
        advanceStep();
      }
    };

    const advanceStep = () => {
      phaseStart = Date.now();
      const speedMultiplier = editSpeed / 120;
      const cur = seq[currentIdx];

      // Phase machine: fadeIn → hold → fadeOut → next step (exact ms durations at default tempo)
      if (phase === 'fadeIn' && cur) {
        phase = 'hold';
        phaseDuration = ((cur.hold ?? 0) * speedMultiplier) || 1;
        return;
      }
      if (phase === 'hold' && cur) {
        phase = 'fadeOut';
        phaseDuration = ((cur.fadeOut ?? 0) * speedMultiplier) || 1;
        return;
      }

      // fadeOut done → advance to next step
      const nextIdx = getNextStepIndex(currentIdx);

      if (editDirection === 'bounce') {
        if (bouncingForward && currentIdx >= seq.length - 1) {
          bouncingForward = false;
        } else if (!bouncingForward && currentIdx <= 0) {
          bouncingForward = true;
        }
        currentIdx = bouncingForward ? currentIdx + 1 : currentIdx - 1;
        if (currentIdx >= seq.length) currentIdx = seq.length - 2;
        if (currentIdx < 0) currentIdx = 1;
      } else {
        currentIdx = nextIdx;
      }

      if (currentIdx >= seq.length || currentIdx < 0) currentIdx = 0;

      const step = seq[currentIdx];
      if (!step) { currentIdx = 0; return; }

      phase = 'fadeIn';
      phaseDuration = ((step.fadeIn ?? 0) * speedMultiplier) || 1;
    };

    const getNextStepIndex = (idx: number) => {
      if (editDirection === 'forward') return idx + 1 >= seq.length ? 0 : idx + 1;
      if (editDirection === 'backward') return idx + 1 >= seq.length ? 0 : idx + 1;
      return idx + 1;
    };

    // Start tick
    playRef.current = {
      timer: setInterval(tick, 16), // ~60fps
      paused: false,
      currentIdx: 0,
      bouncingForward: true,
      phase: 'fadeIn',
      phaseStart,
      phaseDuration,
      startChannelValues: {},
    };

    setPlayState('playing');
    setActiveStepIdx(0);
    setStepProgress(0);
  }, [editSteps, editDirection, editSpeed, stopPlayback, sceneById]);

  const pausePlayback = useCallback(() => {
    if (playRef.current.timer) {
      clearInterval(playRef.current.timer);
      playRef.current.timer = null;
      playRef.current.paused = true;
    }
    setPlayState('paused');
  }, []);

  const resumePlayback = useCallback(() => {
    if (!playRef.current.paused) return;
    // For simplicity, restart from current step
    stopPlayback();
    startPlayback();
  }, [stopPlayback, startPlayback]);

  const handleStop = useCallback(() => {
    stopPlayback();
    setPlayState('stopped');
    setActiveStepIdx(-1);
    setStepProgress(0);
  }, [stopPlayback]);

  // ── Step actions ──
  const handleAddStep = (sceneId: string) => {
    // Prefill step timing from the scene (duration = total window incl fades)
    const sc = scenes.find((s) => s.id === sceneId);
    const fadeIn = sc?.fadeIn ?? 1000;
    const fadeOut = sc?.fadeOut ?? 1000;
    const hold = sc && sc.duration > 0 ? Math.max(0, sc.duration - fadeIn - fadeOut) : 2000;
    const newSteps = [...editSteps, { sceneId, fadeIn, hold, fadeOut }];
    setEditSteps(newSteps);
    persistChanges(newSteps);
    setShowAddStep(false);
    setStepSearch('');
  };

  const handleRemoveStep = (idx: number) => {
    const newSteps = editSteps.filter((_, i) => i !== idx);
    setEditSteps(newSteps);
    persistChanges(newSteps);
  };

  const handleMoveStep = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= editSteps.length) return;
    const newSteps = [...editSteps];
    [newSteps[idx], newSteps[newIdx]] = [newSteps[newIdx], newSteps[idx]];
    setEditSteps(newSteps);
    persistChanges(newSteps);
  };

  const handleUpdateStep = (idx: number, updates: Partial<ChaserStep>) => {
    const newSteps = editSteps.map((s, i) => i === idx ? { ...s, ...updates } : s);
    setEditSteps(newSteps);
    persistChanges(newSteps);
  };

  // ── Step search filter ──
  const filteredScenes = stepSearch.trim()
    ? scenes.filter((s) => (s.name || '').toLowerCase().includes(stepSearch.toLowerCase()))
    : scenes;

  // ── If no chaser selected ──
  if (!chaser) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600">
        <div className="text-4xl mb-3 opacity-30">🎞️</div>
        <div className="text-sm mb-1">No chaser selected</div>
        <div className="text-xs mb-4">Create a new chaser from the left panel to start editing</div>
      </div>
    );
  }

  const seq = getChaserSequence();
  const totalDuration = seq.reduce((sum, s) => sum + getStepDuration(s), 0);

  return (
    <div className="space-y-5">
      {/* Name + Playback Controls */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={editName}
          onChange={(e) => {
            setEditName(e.target.value);
            if (chaser) updateChaser(chaser.id, { name: e.target.value });
          }}
          className="flex-1 bg-transparent text-xl font-bold text-white outline-none border-b border-transparent hover:border-gray-700 focus:border-purple-500/50 transition-colors pb-0.5"
          placeholder="Chaser Name"
        />
        <span className="text-[10px] text-gray-600">{editSteps.length} step{editSteps.length !== 1 ? 's' : ''}</span>
        <div className="flex gap-1.5">
          {playState === 'stopped' && (
            <button onClick={startPlayback} disabled={editSteps.length === 0}
              className="p-2 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 disabled:opacity-30 transition-colors" title="Play">
              <Play size={16} />
            </button>
          )}
          {playState === 'playing' && (
            <button onClick={pausePlayback}
              className="p-2 rounded-lg bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 transition-colors" title="Pause">
              <Pause size={16} />
            </button>
          )}
          {playState === 'paused' && (
            <button onClick={resumePlayback}
              className="p-2 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors" title="Resume">
              <Play size={16} />
            </button>
          )}
          <button onClick={handleStop}
            className="p-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors" title="Stop">
            <Square size={16} />
          </button>
        </div>
      </div>

      {/* Direction + Speed */}
      <div className="flex items-center gap-6">
        {/* Direction */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Direction</span>
          <div className="flex bg-gray-800/40 rounded-lg p-0.5">
            {(['forward', 'backward', 'bounce'] as const).map((d) => (
              <button
                key={d}
                onClick={() => {
                  setEditDirection(d);
                  persistChanges(editSteps, d);
                }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  editDirection === d
                    ? 'bg-purple-600/40 text-purple-200'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Tempo</span>
          <input
            type="range"
            min={20}
            max={300}
            value={editSpeed}
            onChange={(e) => {
              const v = Number(e.target.value);
              setEditSpeed(v);
              persistChanges(editSteps, undefined, v);
            }}
            className="flex-1 h-1 accent-purple-500"
          />
          <span className="text-xs text-gray-300 font-mono w-10 text-right">{editSpeed}</span>
          <span className="text-[10px] text-gray-600">BPM</span>
          <span className="text-[9px] text-gray-700">(120 = temps réel)</span>
        </div>
      </div>

      {/* Playback indicator */}
      {playState !== 'stopped' && activeStepIdx >= 0 && (
        <div className="bg-[#0d0d14] border border-purple-500/20 rounded-lg px-3 py-2 flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[10px] text-green-400 font-medium uppercase tracking-wider">Playing</span>
          </div>
          <span className="text-xs text-gray-300">
            Step {activeStepIdx + 1}/{seq.length}
            {seq[activeStepIdx] && <span className="text-gray-500 ml-1">— {getSceneName(seq[activeStepIdx].sceneId)}</span>}
          </span>
          <div className="flex-1 mx-2">
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-75"
                style={{ width: `${stepProgress * 100}%` }}
              />
            </div>
          </div>
          <span className="text-[10px] text-gray-500">{Math.round(stepProgress * 100)}%</span>
        </div>
      )}

      {/* Step Sequencer */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl">
        <div className="px-4 py-2.5 border-b border-gray-800/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-400">Steps ({editSteps.length})</span>
            {totalDuration > 0 && (
              <span className="text-[10px] text-gray-600">
                Total: {(totalDuration / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setShowAddStep(!showAddStep)}
              className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-purple-600/10 transition-colors"
            >
              <Plus size={12} /> Add Step
            </button>
            {/* Scene popover */}
            {showAddStep && (
              <div ref={addStepRef} className="absolute right-0 top-full mt-1 z-50 bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl w-64 overflow-hidden">
                <div className="p-2 border-b border-gray-800/50">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={stepSearch}
                      onChange={(e) => setStepSearch(e.target.value)}
                      placeholder="Search scenes…"
                      className="w-full bg-gray-800/50 border border-gray-700 rounded pl-7 pr-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 outline-none focus:border-purple-500/50"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {scenes.length === 0 ? (
                    <div className="text-xs text-gray-600 text-center py-6 px-3">
                      No scenes created yet. Create scenes first.
                    </div>
                  ) : filteredScenes.length === 0 ? (
                    <div className="text-xs text-gray-600 text-center py-6">
                      No scenes match "{stepSearch}"
                    </div>
                  ) : (
                    filteredScenes.map((scene) => {
                      const activeCh = Object.values(scene.channels).filter((v) => v > 0).length;
                      return (
                        <button
                          key={scene.id}
                          onClick={() => handleAddStep(scene.id)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-800/30 transition-colors flex items-center justify-between group"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-gray-300 truncate">{scene.name}</div>
                            <div className="text-[10px] text-gray-600">{activeCh} active ch · {(scene.duration / 1000).toFixed(1)}s</div>
                          </div>
                          <Plus size={12} className="text-gray-600 group-hover:text-purple-400 shrink-0 ml-2" />
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step cards */}
        {editSteps.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-3xl mb-2 opacity-30">🎞️</div>
            <div className="text-xs text-gray-500 mb-3">No steps yet</div>
            <button
              onClick={() => setShowAddStep(true)}
              className="px-3 py-1.5 bg-purple-600/20 text-purple-300 rounded-lg text-xs hover:bg-purple-600/30 transition-colors"
            >
              <Plus size={12} className="inline mr-1" /> Add your first step
            </button>
          </div>
        ) : (
          <div className="p-3">
            {/* Horizontal timeline */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {editSteps.map((step, idx) => {
                const scn = sceneById(step.sceneId);
                const stepColor = STEP_COLORS[idx % STEP_COLORS.length];
                const isActive = playState !== 'stopped' && idx === activeStepIdx;
                const isEditing = editingStepIdx === idx;
                const duration = getStepDuration(step);
                const pctFadeIn = duration > 0 ? (step.fadeIn / duration) * 100 : 33;
                const pctHold = duration > 0 ? (step.hold / duration) * 100 : 34;
                const pctFadeOut = duration > 0 ? (step.fadeOut / duration) * 100 : 33;

                return (
                  <div
                    key={idx}
                    className={`shrink-0 rounded-lg overflow-hidden transition-all cursor-pointer ${
                      isActive
                        ? 'ring-2 ring-purple-400 shadow-lg shadow-purple-500/30 scale-105'
                        : 'hover:ring-1 hover:ring-gray-600'
                    }`}
                    style={{ width: 180 }}
                    onClick={() => setEditingStepIdx(isEditing ? null : idx)}
                  >
                    {/* Step header */}
                    <div className="px-3 py-2 flex items-center gap-2" style={{ backgroundColor: stepColor + '20', borderBottom: `2px solid ${stepColor}40` }}>
                      <span className="text-[10px] text-gray-500 font-mono w-5 shrink-0">{idx + 1}</span>
                      <span className="text-xs text-gray-200 truncate flex-1 min-w-0" title={scn?.name || 'N/A'}>
                        {scn?.name || '(no scene)'}
                      </span>
                      <div className="flex gap-0.5 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveStep(idx, -1); }}
                          disabled={idx === 0}
                          className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"
                          title="Move left"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveStep(idx, 1); }}
                          disabled={idx === editSteps.length - 1}
                          className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"
                          title="Move right"
                        >
                          <ChevronRight size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveStep(idx); }}
                          className="p-0.5 text-gray-600 hover:text-red-400"
                          title="Remove step"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Colored bar */}
                    <div className="h-2 flex" style={{ backgroundColor: '#1a1a2e' }}>
                      <div
                        className="h-full"
                        style={{
                          width: `${pctFadeIn}%`,
                          background: `linear-gradient(to right, transparent, ${stepColor}80)`,
                        }}
                        title={`Fade In: ${step.fadeIn}ms`}
                      />
                      <div
                        className="h-full"
                        style={{
                          width: `${pctHold}%`,
                          backgroundColor: stepColor,
                        }}
                        title={`Hold: ${step.hold}ms`}
                      />
                      <div
                        className="h-full"
                        style={{
                          width: `${pctFadeOut}%`,
                          background: `linear-gradient(to left, transparent, ${stepColor}80)`,
                        }}
                        title={`Fade Out: ${step.fadeOut}ms`}
                      />
                    </div>

                    {/* Timing values */}
                    <div className="px-3 py-1.5 bg-gray-800/20">
                      {isEditing ? (
                        <div className="flex items-center gap-1 text-[10px]">
                          <div className="flex-1 text-center">
                            <div className="text-gray-500">In</div>
                            <input
                              type="number"
                              value={step.fadeIn}
                              onChange={(e) => handleUpdateStep(idx, { fadeIn: Number(e.target.value) || 0 })}
                              className="w-full bg-gray-800/50 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-center outline-none focus:border-purple-500/50"
                              onClick={(e) => e.stopPropagation()}
                              min={0}
                            />
                            <div className="text-gray-600">ms</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-gray-500">Hold</div>
                            <input
                              type="number"
                              value={step.hold}
                              onChange={(e) => handleUpdateStep(idx, { hold: Number(e.target.value) || 0 })}
                              className="w-full bg-gray-800/50 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-center outline-none focus:border-purple-500/50"
                              onClick={(e) => e.stopPropagation()}
                              min={0}
                            />
                            <div className="text-gray-600">ms</div>
                          </div>
                          <div className="flex-1 text-center">
                            <div className="text-gray-500">Out</div>
                            <input
                              type="number"
                              value={step.fadeOut}
                              onChange={(e) => handleUpdateStep(idx, { fadeOut: Number(e.target.value) || 0 })}
                              className="w-full bg-gray-800/50 border border-gray-700 rounded px-1 py-0.5 text-gray-300 text-center outline-none focus:border-purple-500/50"
                              onClick={(e) => e.stopPropagation()}
                              min={0}
                            />
                            <div className="text-gray-600">ms</div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-gray-500">In: <span className="text-gray-300">{step.fadeIn}ms</span></span>
                          <span className="text-gray-500">Hold: <span className="text-gray-300">{step.hold}ms</span></span>
                          <span className="text-gray-500">Out: <span className="text-gray-300">{step.fadeOut}ms</span></span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Progress bar showing full chaser loop */}
      {playState !== 'stopped' && seq.length > 0 && (
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Timeline</div>
          <div className="h-3 bg-gray-800/50 rounded-full overflow-hidden flex">
            {seq.map((step, idx) => {
              const dur = getStepDuration(step);
              const pct = totalDuration > 0 ? (dur / totalDuration) * 100 : 0;
              const col = STEP_COLORS[idx % STEP_COLORS.length];
              return (
                <div
                  key={idx}
                  className={`h-full transition-all ${idx === activeStepIdx ? 'brightness-150' : 'opacity-60'}`}
                  style={{
                    width: `${pct}%`,
                    backgroundColor: col,
                    borderLeft: idx > 0 ? '1px solid #0d0d14' : 'none',
                  }}
                  title={`Step ${idx + 1}: ${getSceneName(step.sceneId)} (${(dur / 1000).toFixed(1)}s)`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── RGB Matrix Editor ─────────────────────────────────────

const PATTERNS: { value: string; label: string; icon: string }[] = [
  { value: 'solid', label: 'Solid', icon: '⬛' },
  { value: 'chase', label: 'Chase', icon: '🏃' },
  { value: 'wave', label: 'Wave', icon: '🌊' },
  { value: 'burst', label: 'Burst', icon: '💥' },
  { value: 'gradient', label: 'Gradient', icon: '🎨' },
  { value: 'rainbow', label: 'Rainbow', icon: '🌈' },
  { value: 'random', label: 'Random', icon: '🎲' },
  { value: 'pulse', label: 'Pulse', icon: '💓' },
  { value: 'strobe', label: 'Strobe', icon: '⚡' },
];

const DIRECTIONS = [
  { value: 'forward', label: '→' },
  { value: 'backward', label: '←' },
  { value: 'bounce', label: '⇄' },
];

const RgbMatrixList: React.FC = () => {
  const { matrices, activeMatrixId, setActiveMatrix, createMatrix, deleteMatrix, toggleMatrix } = useRgbMatrixStore();
  const fixtureGroups = useShowStore(s => s.fixtureGroups);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGroupId, setNewGroupId] = useState(fixtureGroups[0]?.id || '');

  useEffect(() => {
    if (fixtureGroups.length > 0 && !newGroupId) setNewGroupId(fixtureGroups[0].id);
  }, [fixtureGroups, newGroupId]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">RGB Matrices</span>
      </div>
      {!showNew ? (
        <button onClick={() => setShowNew(true)} className="w-full px-3 py-1.5 rounded text-xs bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 flex items-center gap-2 justify-center">
          <Plus className="w-3 h-3" /> New Matrix
        </button>
      ) : (
        <div className="space-y-1.5 p-2 bg-gray-800/30 rounded">
          <input autoFocus placeholder="Matrix name" value={newName} onChange={e => setNewName(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200" />
          <select value={newGroupId} onChange={e => setNewGroupId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200">
            {fixtureGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div className="flex gap-1">
            <button onClick={() => { if (newName.trim()) { createMatrix(newName.trim(), newGroupId); setNewName(''); setShowNew(false); } }}
              className="flex-1 px-2 py-1 rounded text-xs bg-purple-600 text-white">Create</button>
            <button onClick={() => setShowNew(false)} className="px-2 py-1 rounded text-xs bg-gray-700 text-gray-400">Cancel</button>
          </div>
        </div>
      )}
      {matrices.length === 0 ? (
        <div className="text-xs text-gray-600 text-center py-4">No RGB matrices yet.</div>
      ) : (
        matrices.map(m => (
          <div key={m.id} onClick={() => setActiveMatrix(m.id)}
            className={`px-3 py-1.5 cursor-pointer hover:bg-gray-800/50 flex items-center justify-between ${
              m.id === activeMatrixId ? 'bg-purple-600/10 border-l-2 border-l-purple-500' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate">{m.name}</div>
              <div className="text-[9px] text-gray-500">{m.pattern} · {m.cols}×{m.rows}</div>
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={(e) => { e.stopPropagation(); toggleMatrix(m.id); }}
                className={`p-0.5 rounded ${m.enabled ? 'text-green-400 bg-green-400/10' : 'text-gray-600 hover:text-gray-400'}`}>
                {m.enabled ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); deleteMatrix(m.id); }}
                className="p-0.5 rounded text-gray-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const RGBMatrixEditor: React.FC = () => {
  const { matrices, activeMatrixId, updateMatrix } = useRgbMatrixStore();
  const fixtureGroups = useShowStore(s => s.fixtureGroups);
  const [livePhase, setLivePhase] = useState(0);

  const active = matrices.find(m => m.id === activeMatrixId);

  // Live preview animation
  useEffect(() => {
    if (!active?.enabled) return;
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      setLivePhase(((performance.now() - start) / 1000) * active.speed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active?.id, active?.enabled, active?.speed]);

  if (!active) {
    return <div className="text-xs text-gray-600 text-center py-8">Select or create a matrix</div>;
  }

  const startRgb = parseInt(active.startColor.slice(1, 3), 16) || 255;
  const startG = parseInt(active.startColor.slice(3, 5), 16) || 0;
  const startB = parseInt(active.startColor.slice(5, 7), 16) || 0;

  const groupName = fixtureGroups.find(g => g.id === active.groupId)?.name || '?';

  return (
    <div className="space-y-4">
      <input type="text" value={active.name}
        onChange={e => updateMatrix(active.id, { name: e.target.value })}
        className="bg-transparent text-xl font-bold text-white outline-none block w-full" />
      <div className="text-[10px] text-gray-500">
        Group: <span className="text-gray-300">{groupName}</span> · {active.cols}×{active.rows}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left column: patterns + direction */}
        <div className="space-y-3">
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider">Pattern</label>
          <div className="grid grid-cols-3 gap-1">
            {PATTERNS.map(p => (
              <button key={p.value} onClick={() => updateMatrix(active.id, { pattern: p.value as any })}
                className={`px-2 py-1.5 rounded text-[10px] text-center ${
                  active.pattern === p.value
                    ? 'bg-purple-600/30 border border-purple-500/40 text-purple-300'
                    : 'bg-gray-800/50 border border-gray-700/30 text-gray-400 hover:bg-gray-700/50'}`}>
                {p.icon} {p.label}
              </button>
            ))}
          </div>

          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mt-3">Direction</label>
          <div className="flex gap-1">
            {DIRECTIONS.map(d => (
              <button key={d.value} onClick={() => updateMatrix(active.id, { direction: d.value as any })}
                className={`flex-1 px-2 py-1.5 rounded text-xs ${
                  active.direction === d.value
                    ? 'bg-purple-600/30 border border-purple-500/40 text-purple-300'
                    : 'bg-gray-800/50 border border-gray-700/30 text-gray-400'}`}>{d.label}</button>
            ))}
          </div>

          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mt-3">Grid</label>
          <div className="flex gap-2 mt-1">
            <div className="flex-1">
              <span className="text-[9px] text-gray-600">Cols: {active.cols}</span>
              <input type="range" min={1} max={16} value={active.cols}
                onChange={e => updateMatrix(active.id, { cols: Number(e.target.value) })}
                className="w-full accent-purple-500" />
            </div>
            <div className="flex-1">
              <span className="text-[9px] text-gray-600">Rows: {active.rows}</span>
              <input type="range" min={1} max={16} value={active.rows}
                onChange={e => updateMatrix(active.id, { rows: Number(e.target.value) })}
                className="w-full accent-purple-500" />
            </div>
          </div>
        </div>

        {/* Right column: params */}
        <div className="space-y-3">
          <label className="block text-[10px] text-gray-500 uppercase tracking-wider">
            Speed: {active.speed.toFixed(1)} Hz
          </label>
          <input type="range" min={0.1} max={10} step={0.1} value={active.speed}
            onChange={e => updateMatrix(active.id, { speed: Number(e.target.value) })}
            className="w-full accent-purple-500" />

          <label className="block text-[10px] text-gray-500 uppercase tracking-wider mt-3">
            Width: {active.width}%
          </label>
          <input type="range" min={5} max={100} value={active.width}
            onChange={e => updateMatrix(active.id, { width: Number(e.target.value) })}
            className="w-full accent-purple-500" />

          <div className="flex gap-3 mt-3">
            <div className="flex-1">
              <label className="text-[9px] text-gray-600 block">Start</label>
              <div className="flex items-center gap-1">
                <input type="color" value={active.startColor}
                  onChange={e => updateMatrix(active.id, { startColor: e.target.value })}
                  className="w-7 h-6 rounded border border-gray-700 cursor-pointer" />
                <span className="text-[9px] text-gray-500">{active.startColor}</span>
              </div>
            </div>
            {active.pattern !== 'rainbow' && active.pattern !== 'random' && active.pattern !== 'pulse' && active.pattern !== 'strobe' && (
              <div className="flex-1">
                <label className="text-[9px] text-gray-600 block">End</label>
                <div className="flex items-center gap-1">
                  <input type="color" value={active.endColor}
                    onChange={e => updateMatrix(active.id, { endColor: e.target.value })}
                    className="w-7 h-6 rounded border border-gray-700 cursor-pointer" />
                  <span className="text-[9px] text-gray-500">{active.endColor}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live preview grid */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-3">
        <div className="text-[10px] text-gray-500 mb-2">Live Preview</div>
        <div className="mx-auto" style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${active.cols}, 1fr)`,
          width: Math.min(180, 36 * active.cols),
          height: Math.min(180, 36 * active.rows),
          gap: 2,
        }}>
          {Array.from({ length: active.cols * active.rows }, (_, i) => {
            const col = i % active.cols;
            const row = Math.floor(i / active.cols);
            const cellIndex = row * active.cols + col;
            let color = '#1a1a2e';

            const phase = active.enabled ? livePhase : 0;
            switch (active.pattern) {
              case 'chase': {
                const chasePos = ((phase + cellIndex / (active.cols * active.rows)) % 1 + 1) % 1;
                const thresh = 1 - active.width / 100;
                if (chasePos >= thresh) {
                  const pos = (chasePos - thresh) / (1 - thresh);
                  const r = Math.round(startRgb + (parseInt(active.endColor.slice(1,3),16) - startRgb) * pos);
                  const g = Math.round(startG + (parseInt(active.endColor.slice(3,5),16) - startG) * pos);
                  const b = Math.round(startB + (parseInt(active.endColor.slice(5,7),16) - startB) * pos);
                  color = `rgb(${r},${g},${b})`;
                }
                break;
              }
              case 'rainbow': {
                const h = ((phase + cellIndex / (active.cols * active.rows)) % 1 + 1) % 1;
                color = `hsl(${Math.round(h * 360)}, 100%, 50%)`;
                break;
              }
              case 'gradient': {
                const pos = cellIndex / Math.max(1, active.cols * active.rows - 1);
                const r = Math.round(startRgb + (parseInt(active.endColor.slice(1,3),16) - startRgb) * pos);
                const g = Math.round(startG + (parseInt(active.endColor.slice(3,5),16) - startG) * pos);
                const b = Math.round(startB + (parseInt(active.endColor.slice(5,7),16) - startB) * pos);
                color = `rgb(${r},${g},${b})`;
                break;
              }
              case 'solid':
                color = `rgb(${startRgb},${startG},${startB})`;
                break;
              case 'pulse':
                const pv = 0.3 + 0.7 * Math.abs(Math.sin(phase * Math.PI));
                color = `rgb(${Math.round(startRgb*pv)},${Math.round(startG*pv)},${Math.round(startB*pv)})`;
                break;
              default:
                color = `rgb(${startRgb},${startG},${startB})`;
            }

            return (
              <div key={i} className="rounded-sm transition-colors duration-75"
                style={{ backgroundColor: color, width: '100%', height: '100%' }} />
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── Cue List Editor (Design mode — theater-style sequential playback) ──

const CueListList: React.FC = () => {
  const cueLists = useShowStore((s) => s.cueLists);
  const deleteCueList = useShowStore((s) => s.deleteCueList);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; x: number; y: number; id: string; name: string }>(
    { visible: false, x: 0, y: 0, id: '', name: '' }
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    (window as any).__lm_selectedCueListId = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!ctxMenu.visible) return;
    const dismiss = () => setCtxMenu((c) => ({ ...c, visible: false }));
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [ctxMenu.visible]);

  if (cueLists.length === 0) {
    return (
      <div className="text-xs text-gray-600 text-center py-8">
        No cue lists yet. Click "New Cue List" to create one.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {cueLists.map((cl) => {
          const isSelected = selectedId === cl.id;
          return (
            <div
              key={cl.id}
              onClick={() => setSelectedId(cl.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, id: cl.id, name: cl.name });
              }}
              className={`px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
                isSelected ? 'bg-purple-600/15 border border-purple-500/20' : 'hover:bg-gray-800/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-300 truncate">{cl.name}</div>
                  <div className="text-[10px] text-gray-600">
                    {cl.cues.length} cue{cl.cues.length !== 1 ? 's' : ''} · idx {cl.currentCueIndex + 1}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(cl.id); }}
                  className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {ctxMenu.visible && (
        <div className="fixed z-[60] bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">{ctxMenu.name}</div>
          <button onClick={() => { setConfirmDelete(ctxMenu.id); setCtxMenu((c) => ({ ...c, visible: false })); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-red-600/20 flex items-center gap-2">
            <Trash2 size={12} /> Delete Cue List
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setConfirmDelete(null)}>
          <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 shadow-2xl w-80" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-2">Delete Cue List?</h4>
            <p className="text-xs text-gray-400 mb-4">This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300">Cancel</button>
              <button onClick={() => { deleteCueList(confirmDelete); setConfirmDelete(null); if (selectedId === confirmDelete) setSelectedId(null); }}
                className="px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded-lg text-xs text-red-300">Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const CueListEditor: React.FC = () => {
  const cueLists = useShowStore((s) => s.cueLists);
  const scenes = useShowStore((s) => s.scenes);
  const updateCueList = useShowStore((s) => s.updateCueList);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const check = () => {
      const id = (window as any).__lm_selectedCueListId;
      if (id !== selectedId) setSelectedId(id);
    };
    const interval = setInterval(check, 100);
    return () => clearInterval(interval);
  }, [selectedId]);

  const cueList = cueLists.find((cl) => cl.id === selectedId) || null;
  const [editName, setEditName] = useState('');
  const [showAddScene, setShowAddScene] = useState(false);

  useEffect(() => {
    if (cueList) {
      setEditName(cueList.name);
    }
  }, [cueList?.id]);

  if (!cueList) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600">
        <div className="text-4xl mb-3 opacity-30">📋</div>
        <div className="text-sm mb-1">No cue list selected</div>
        <div className="text-xs">Create a cue list from the left panel</div>
      </div>
    );
  }

  const handleAddCue = (sceneId: string) => {
    const newCues = [
      ...cueList.cues,
      {
        id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sceneId,
        fadeIn: 1000,
        hold: 3000,
        fadeOut: 1000,
      } as CueListCue,
    ];
    updateCueList(cueList.id, { cues: newCues });
    setShowAddScene(false);
  };

  const handleRemoveCue = (cueId: string) => {
    updateCueList(cueList.id, { cues: cueList.cues.filter((c) => c.id !== cueId) });
  };

  const handleUpdateCue = (cueId: string, updates: Partial<CueListCue>) => {
    updateCueList(cueList.id, {
      cues: cueList.cues.map((c) => (c.id === cueId ? { ...c, ...updates } : c)),
    });
  };

  const handleMoveCue = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= cueList.cues.length) return;
    const newCues = [...cueList.cues];
    [newCues[idx], newCues[newIdx]] = [newCues[newIdx], newCues[idx]];
    updateCueList(cueList.id, { cues: newCues });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={editName}
          onChange={(e) => { setEditName(e.target.value); updateCueList(cueList.id, { name: e.target.value }); }}
          className="flex-1 bg-transparent text-xl font-bold text-white outline-none border-b border-transparent hover:border-gray-700 focus:border-purple-500/50 pb-0.5"
          placeholder="Cue List Name"
        />
        <span className="text-[10px] text-gray-600">{cueList.cues.length} cue{cueList.cues.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4">
        <p className="text-xs text-gray-400 leading-relaxed">
          Cue Lists are for <span className="text-purple-300 font-medium">theater-style sequential playback</span> — press "Go"
          to manually advance through each cue. Unlike Chasers (which loop automatically), Cue Lists
          give you frame-by-frame control ideal for theater, live events, and scripted shows.
        </p>
      </div>

      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl">
        <div className="px-4 py-2.5 border-b border-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">Cues ({cueList.cues.length})</span>
          <div className="relative">
            <button
              onClick={() => setShowAddScene(!showAddScene)}
              className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-purple-600/10"
            >
              <Plus size={12} /> Add Cue
            </button>
            {showAddScene && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl w-56 max-h-48 overflow-y-auto">
                {scenes.length === 0 ? (
                  <div className="text-xs text-gray-600 text-center py-4 px-3">No scenes created yet</div>
                ) : (
                  scenes.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleAddCue(s.id)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-800/30 text-xs text-gray-300 flex items-center justify-between"
                    >
                      <span className="truncate">{s.name}</span>
                      <span className="text-[10px] text-gray-600">{Object.values(s.channels).filter((v) => v > 0).length}ch</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {cueList.cues.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-3xl mb-2 opacity-30">📋</div>
            <div className="text-xs text-gray-500">No cues yet — add scenes above</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/20">
            {cueList.cues.map((cue, idx) => {
              const scene = scenes.find((s) => s.id === cue.sceneId);
              const isCurrent = cueList.currentCueIndex === idx;
              return (
                <div
                  key={cue.id}
                  className={`px-4 py-2.5 flex items-center gap-3 transition-colors ${
                    isCurrent ? 'bg-purple-600/10 border-l-2 border-l-purple-500' : ''
                  }`}
                >
                  <span className="text-[10px] text-gray-600 font-mono w-6 shrink-0">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-300 truncate">{scene?.name || '(missing scene)'}</div>
                    <div className="flex gap-2 text-[10px] text-gray-600 mt-0.5">
                      <span>In: {cue.fadeIn}ms</span>
                      <span>Hold: {cue.hold}ms</span>
                      <span>Out: {cue.fadeOut}ms</span>
                    </div>
                  </div>
                  <div className="flex gap-0.5 shrink-0">
                    <button
                      onClick={() => handleMoveCue(idx, -1)}
                      disabled={idx === 0}
                      className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <button
                      onClick={() => handleMoveCue(idx, 1)}
                      disabled={idx === cueList.cues.length - 1}
                      className="p-0.5 text-gray-600 hover:text-gray-300 disabled:opacity-20"
                    >
                      <ChevronRight size={12} />
                    </button>
                    <button
                      onClick={() => handleRemoveCue(cue.id)}
                      className="p-0.5 text-gray-600 hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── EFX List (Left Panel) ─────────────────────────────────

const EFXList: React.FC = () => {
  const effects = useShowStore((s) => s.effects);
  const deleteEffect = useShowStore((s) => s.deleteEffect);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    (window as any).__lm_selectedEffectId = selectedId;
  }, [selectedId]);

  if (effects.length === 0) {
    return (
      <div className="text-xs text-gray-600 text-center py-8">
        No EFX yet. Click "New EFX" to create one.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {effects.map((efx) => {
          const isSelected = selectedId === efx.id;
          return (
            <div
              key={efx.id}
              onClick={() => setSelectedId(efx.id)}
              className={`px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
                isSelected ? 'bg-purple-600/15 border border-purple-500/20' : 'hover:bg-gray-800/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-300 truncate">{efx.name}</div>
                  <div className="text-[10px] text-gray-600">
                    {efx.pattern} · {efx.fixtureIds.length} fixture{efx.fixtureIds.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(efx.id); }}
                  className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  title="Delete EFX"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setConfirmDelete(null)}>
          <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 shadow-2xl w-80" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-2">Delete EFX?</h4>
            <p className="text-xs text-gray-400 mb-4">This will permanently delete this EFX. This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50">
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteEffect(confirmDelete);
                  if (selectedId === confirmDelete) setSelectedId(null);
                  setConfirmDelete(null);
                }}
                className="px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded-lg text-xs text-red-300 hover:bg-red-600/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ─── EFX Editor ────────────────────────────────────────────

const EFX_PATTERNS = ['Circle', 'Line', 'Eight', 'Square', 'Triangle', 'Infinity', 'Zigzag', 'Spiral', 'DoubleCircle', 'Heart'] as const;
type EfxPattern = typeof EFX_PATTERNS[number];

const EFXEditor: React.FC = () => {
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const effects = useShowStore((s) => s.effects);
  const createEffect = useShowStore((s) => s.createEffect);
  const updateEffect = useShowStore((s) => s.updateEffect);
  const deleteEffect = useShowStore((s) => s.deleteEffect);

  const [pattern, setPattern] = useState<EfxPattern>('Circle');
  const [width, setWidth] = useState(1.0);
  const [height, setHeight] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [speed, setSpeed] = useState(0.5);
  const [xOffset, setXOffset] = useState(0);
  const [yOffset, setYOffset] = useState(0);
  const [efxName, setEfxName] = useState('EFX 1');
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<Set<string>>(new Set());
  const [editingEffectId, setEditingEffectId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);
  useEffect(() => { stoppedRef.current = stopped; }, [stopped]);

  // Listen for EFX selection from sidebar
  useEffect(() => {
    const check = () => {
      const id = (window as any).__lm_selectedEffectId;
      if (id !== editingEffectId) setEditingEffectId(id);
    };
    const interval = setInterval(check, 100);
    return () => clearInterval(interval);
  }, [editingEffectId]);

  // Load effect into editor when editing
  useEffect(() => {
    if (editingEffectId) {
      const efx = effects.find((e) => e.id === editingEffectId);
      if (efx) {
        setEfxName(efx.name);
        setPattern(efx.pattern);
        setWidth(efx.width);
        setHeight(efx.height);
        setRotation(efx.rotation);
        setSpeed(efx.speed);
        setXOffset(efx.xOffset);
        setYOffset(efx.yOffset);
        setSelectedFixtureIds(new Set(efx.fixtureIds));
      }
    }
  }, [editingEffectId, effects]);

  const toggleFixture = (fixtureId: string) => {
    setSelectedFixtureIds((prev) => {
      const next = new Set(prev);
      if (next.has(fixtureId)) next.delete(fixtureId);
      else next.add(fixtureId);
      return next;
    });
  };

  const handleSave = () => {
    const fixtureIds = Array.from(selectedFixtureIds);
    if (editingEffectId) {
      updateEffect(editingEffectId, {
        name: efxName,
        pattern,
        width,
        height,
        rotation,
        speed,
        xOffset,
        yOffset,
        fixtureIds,
      });
    } else {
      const newId = createEffect(efxName);
      updateEffect(newId, {
        pattern,
        width,
        height,
        rotation,
        speed,
        xOffset,
        yOffset,
        fixtureIds,
      });
      setEditingEffectId(newId);
    }
  };

  const handleNew = () => {
    setEditingEffectId(null);
    setEfxName(`EFX ${effects.length + 1}`);
    setPattern('Circle');
    setWidth(1.0);
    setHeight(1.0);
    setRotation(0);
    setSpeed(0.5);
    setXOffset(0);
    setYOffset(0);
    setSelectedFixtureIds(new Set());
  };

  // Animated phase
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPhase((p) => (p + dt * speed * 2) % (Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speed]);

  // ── Live DMX output for EFX preview ──
  const [fixtureDefs, setFixtureDefs] = useState<Map<string, DmxFixtureDefinition>>(new Map());

  // ── Pan/Tilt eligibility filter ──
  const [efxEligibleFixtureIds, setEfxEligibleFixtureIds] = useState<Set<string>>(new Set());
  const [efxDefsLoaded, setEfxDefsLoaded] = useState(false);
  useEffect(() => {
    const allIds = patchedFixtures.map((f) => f.fixtureDefId).filter(Boolean);
    if (allIds.length === 0) {
      setEfxEligibleFixtureIds(new Set());
      setEfxDefsLoaded(false);
      return;
    }
    loadFixtureDefinitions(allIds).then((defs) => {
      const eligible = new Set<string>();
      for (const pf of patchedFixtures) {
        const def = defs.get(pf.fixtureDefId);
        if (!def) continue;
        const analysed = analyzeChannels(pf, def);
        if (analysed.panOffsets.length > 0 || analysed.tiltOffsets.length > 0) {
          eligible.add(pf.id);
        }
      }
      setEfxEligibleFixtureIds(eligible);
      setEfxDefsLoaded(true);
    }).catch(() => {
      setEfxDefsLoaded(true); // Still mark as loaded on error to avoid infinite spinner
    });
  }, [patchedFixtures]);

  // Load fixture definitions for selected fixtures
  useEffect(() => {
    const ids = patchedFixtures
      .filter((f) => selectedFixtureIds.has(f.id))
      .map((f) => f.fixtureDefId)
      .filter(Boolean);
    if (ids.length === 0) return;
    loadFixtureDefinitions(ids)
      .then((defs) => {
        if (defs.size > 0) setFixtureDefs(defs);
      })
      .catch(() => {});
  }, [patchedFixtures, selectedFixtureIds]);

  // Live DMX RAF loop
  useEffect(() => {
    if (selectedFixtureIds.size === 0 || fixtureDefs.size === 0) return;

    let raf = 0;
    let startTime = performance.now();
    const patchedWithDefs = patchedFixtures
      .filter((f) => selectedFixtureIds.has(f.id))
      .map((f) => {
        const def = fixtureDefs.get(f.fixtureDefId);
        const mode = def?.modes[f.modeIndex];
        let panOff: number | null = null;
        let tiltOff: number | null = null;
        let panFineOff: number | null = null;
        let tiltFineOff: number | null = null;
        let dimmerOff: number | null = null;
        if (mode) {
          for (let ci = 0; ci < mode.channels.length; ci++) {
            const ch = mode.channels[ci];
            if (ch.type === 'Pan') {
              if (ch.name?.toLowerCase().includes('fine')) panFineOff = ci;
              else panOff = ci;
            }
            if (ch.type === 'Tilt') {
              if (ch.name?.toLowerCase().includes('fine')) tiltFineOff = ci;
              else tiltOff = ci;
            }
            if (ch.type === 'Intensity') dimmerOff = ci;
          }
        }
        return { fixture: f, panOff, tiltOff, panFineOff, tiltFineOff, dimmerOff };
      })
      .filter((f) => f.panOff !== null || f.tiltOff !== null); // only fixtures with movement

    if (patchedWithDefs.length === 0) return;

    const animate = () => {
      if (stoppedRef.current) {
        // Stopped: send center + dimmer=0 to freeze fixtures
        const byUniverse = new Map<string, Record<number, number>>();
        for (const f of patchedWithDefs) {
          const uniId = f.fixture.universeId;
          let vals = byUniverse.get(uniId);
          if (!vals) { vals = {}; byUniverse.set(uniId, vals); }
          if (f.dimmerOff !== null) vals[f.fixture.startAddress + f.dimmerOff] = 0;
          if (f.panOff !== null) vals[f.fixture.startAddress + f.panOff] = 128;
          if (f.tiltOff !== null) vals[f.fixture.startAddress + f.tiltOff] = 128;
        }
        for (const [uniId, vals] of byUniverse) {
          const uniNum = Math.max(0, (parseInt(uniId.replace(/\D/g, ''), 10) || 1) - 1);
          dmxBridge.write('design-efx', uniNum, vals);
        }
        raf = requestAnimationFrame(animate);
        return;
      }
      const elapsed = (performance.now() - startTime) / 1000;
      const phase = (elapsed * speed * 2) % (Math.PI * 2);

      const cx = 0;
      const cy = 0;
      const rx = width * 0.7;
      const ry = height * 0.7;
      const rotRad = (rotation * Math.PI) / 180;
      const ox = (xOffset / 255) * 0.3;
      const oy = (yOffset / 255) * 0.3;

      // Compute pattern point (same math as SVG preview)
      let px = 0;
      let py = 0;
      const seg = phase / (Math.PI * 2);
      switch (pattern) {
        case 'Circle':
          px = Math.cos(phase) * rx;
          py = Math.sin(phase) * ry;
          break;
        case 'Line': {
          const lp = seg % 1;
          const lineX = lp < 0.5 ? (lp * 2) * 2 - 1 : (1 - (lp - 0.5) * 2) * 2 - 1;
          px = lineX * rx;
          py = 0;
          break;
        }
        case 'Eight':
          px = Math.sin(phase) * rx;
          py = Math.sin(phase * 2) * ry * 0.5;
          break;
        case 'Square': {
          const s = seg * 4;
          const sIdx = Math.floor(s) % 4;
          const sFrac = s - Math.floor(s);
          const cs: [number, number][] = [
            [1, 1],
            [-1, 1],
            [-1, -1],
            [1, -1],
          ];
          const ce: [number, number][] = [
            [-1, 1],
            [-1, -1],
            [1, -1],
            [1, 1],
          ];
          px = (cs[sIdx][0] + (ce[sIdx][0] - cs[sIdx][0]) * sFrac) * rx;
          py = (cs[sIdx][1] + (ce[sIdx][1] - cs[sIdx][1]) * sFrac) * ry;
          break;
        }
        case 'Triangle': {
          const ta = seg * 3;
          const ti = Math.floor(ta) % 3;
          const tf = ta - Math.floor(ta);
          const tv: [number, number][] = [
            [0, -1],
            [-0.866, 0.5],
            [0.866, 0.5],
          ];
          const tn = tv[(ti + 1) % 3];
          px = (tv[ti][0] + (tn[0] - tv[ti][0]) * tf) * rx;
          py = (tv[ti][1] + (tn[1] - tv[ti][1]) * tf) * ry;
          break;
        }
        case 'Infinity':
          px = Math.cos(phase) * rx;
          py = Math.sin(phase * 2) * ry * 0.5;
          break;
        case 'Zigzag': {
          const z = (seg % 1) * 2 - 1;
          px = z * rx;
          const zs = seg * 8;
          const zi = Math.floor(zs);
          const zf = zs - zi;
          const zy = zi % 2 === 0 ? -1 + zf * 2 : 1 - zf * 2;
          py = zy * ry;
          break;
        }
        case 'Spiral': {
          const sc = seg % 1;
          const sr = 0.2 + sc * 0.8;
          px = Math.cos(phase) * rx * sr;
          py = Math.sin(phase) * ry * sr;
          break;
        }
        case 'DoubleCircle': {
          const dc = Math.cos(phase) * rx;
          const ds = Math.sin(phase) * ry;
          const dc2 = Math.cos(phase + Math.PI) * rx * 0.5;
          const ds2 = Math.sin(phase + Math.PI) * ry * 0.5;
          const blending = (Math.sin(phase * 3) + 1) / 2;
          px = dc * (1 - blending) + dc2 * blending;
          py = ds * (1 - blending) + ds2 * blending;
          break;
        }
        case 'Heart': {
          const t = phase;
          const hx = 16 * Math.pow(Math.sin(t), 3);
          const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          px = (hx / 16) * rx;
          py = (hy / 16) * -ry;
          break;
        }
      }
      // Apply rotation and offset
      const rx2 = px * Math.cos(rotRad) - py * Math.sin(rotRad) + ox;
      const ry2 = px * Math.sin(rotRad) + py * Math.cos(rotRad) + oy;

      // Map to DMX: -1..1 → 0..255, center at 128
      const dmxPan = Math.round(Math.max(0, Math.min(255, 128 + rx2 * 127)));
      const dmxTilt = Math.round(Math.max(0, Math.min(255, 128 + ry2 * 127)));

      // Send DMX for each selected fixture grouped by universe
      const byUniverse = new Map<string, Record<number, number>>();
      for (const f of patchedWithDefs) {
        const uniId = f.fixture.universeId;
        let vals = byUniverse.get(uniId);
        if (!vals) {
          vals = {};
          byUniverse.set(uniId, vals);
        }
        // Always set dimmer to full so EFX is visible
        if (f.dimmerOff !== null) vals[f.fixture.startAddress + f.dimmerOff] = 255;
        if (f.panOff !== null) vals[f.fixture.startAddress + f.panOff] = dmxPan;
        if (f.tiltOff !== null) vals[f.fixture.startAddress + f.tiltOff] = dmxTilt;
        if (f.panFineOff !== null) vals[f.fixture.startAddress + f.panFineOff] = dmxPan;
        if (f.tiltFineOff !== null) vals[f.fixture.startAddress + f.tiltFineOff] = dmxTilt;
      }
      for (const [uniId, vals] of byUniverse) {
        const uniNum = Math.max(0, (parseInt(uniId.replace(/\D/g, ''), 10) || 1) - 1);
        dmxBridge.write('design-efx', uniNum, vals);
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      // Blackout selected fixtures on unmount. TRANSIENT: the home/zero
      // values flush the hardware, then the design-efx source is released
      // after 2 s so the playback engine regains control (a plain write
      // would re-pin pan/tilt/dimmer of these fixtures forever).
      const byUniverse = new Map<string, Record<number, number>>();
      for (const f of patchedWithDefs) {
        const uniId = f.fixture.universeId;
        let vals = byUniverse.get(uniId);
        if (!vals) {
          vals = {};
          byUniverse.set(uniId, vals);
        }
        if (f.dimmerOff !== null) vals[f.fixture.startAddress + f.dimmerOff] = 0;
        if (f.panOff !== null) vals[f.fixture.startAddress + f.panOff] = 128;
        if (f.tiltOff !== null) vals[f.fixture.startAddress + f.tiltOff] = 128;
      }
      for (const [uniId, vals] of byUniverse) {
        const uniNum = Math.max(0, (parseInt(uniId.replace(/\D/g, ''), 10) || 1) - 1);
        dmxBridge.writeTransient('design-efx', uniNum, vals);
      }
    };
  }, [selectedFixtureIds, fixtureDefs, patchedFixtures, pattern, width, height, rotation, speed, xOffset, yOffset]);

  // Compute preview path points based on pattern
  const previewPoints = React.useMemo(() => {
    const points: { x: number; y: number }[] = [];
    const steps = 120;
    const cx = 0;
    const cy = 0;
    const rx = width * 0.7;
    const ry = height * 0.7;
    const rotRad = (rotation * Math.PI) / 180;
    const ox = (xOffset / 255) * 0.3;
    const oy = (yOffset / 255) * 0.3;

    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2 + phase;
      const seg = (t % (Math.PI * 2)) / (Math.PI * 2);
      let x = 0, y = 0;
      switch (pattern) {
        case 'Circle':
          x = Math.cos(t) * rx;
          y = Math.sin(t) * ry;
          break;
        case 'Line':
          const lp = seg % 1;
          const lineX = lp < 0.5 ? (lp * 2) * 2 - 1 : (1 - (lp - 0.5) * 2) * 2 - 1;
          x = lineX * rx;
          y = 0;
          break;
        case 'Eight':
          x = Math.sin(t) * rx;
          y = Math.sin(t * 2) * ry * 0.5;
          break;
        case 'Square':
          const s = seg * 4;
          const sIdx = Math.floor(s) % 4;
          const sFrac = s - Math.floor(s);
          const cs: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
          const ce: [number, number][] = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
          x = (cs[sIdx][0] + (ce[sIdx][0] - cs[sIdx][0]) * sFrac) * rx;
          y = (cs[sIdx][1] + (ce[sIdx][1] - cs[sIdx][1]) * sFrac) * ry;
          break;
        case 'Triangle':
          const ta = (t % (Math.PI * 2)) / (Math.PI * 2) * 3;
          const ti = Math.floor(ta) % 3;
          const tf = ta - Math.floor(ta);
          const tv: [number, number][] = [[0, -1], [-0.866, 0.5], [0.866, 0.5]];
          const tn = tv[(ti + 1) % 3];
          x = (tv[ti][0] + (tn[0] - tv[ti][0]) * tf) * rx;
          y = (tv[ti][1] + (tn[1] - tv[ti][1]) * tf) * ry;
          break;
        case 'Infinity':
          x = Math.cos(t) * rx;
          y = Math.sin(t * 2) * ry * 0.5;
          break;
        case 'Zigzag': {
          const zz = (seg % 1) * 2 - 1;
          x = zz * rx;
          const zs = seg * 8;
          const zi = Math.floor(zs);
          const zf = zs - zi;
          const zy = zi % 2 === 0 ? -1 + zf * 2 : 1 - zf * 2;
          y = zy * ry;
          break;
        }
        case 'Spiral': {
          const sc = seg % 1;
          const sr = 0.2 + sc * 0.8;
          x = Math.cos(t) * rx * sr;
          y = Math.sin(t) * ry * sr;
          break;
        }
        case 'DoubleCircle': {
          const dc = Math.cos(t) * rx;
          const ds = Math.sin(t) * ry;
          const dc2 = Math.cos(t + Math.PI) * rx * 0.5;
          const ds2 = Math.sin(t + Math.PI) * ry * 0.5;
          const blending = (Math.sin(t * 3) + 1) / 2;
          x = dc * (1 - blending) + dc2 * blending;
          y = ds * (1 - blending) + ds2 * blending;
          break;
        }
        case 'Heart': {
          const hx = 16 * Math.pow(Math.sin(t), 3);
          const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          x = (hx / 16) * rx;
          y = (hy / 16) * -ry;
          break;
        }
      }
      // Apply rotation and offset
      const rx2 = x * Math.cos(rotRad) - y * Math.sin(rotRad) + ox;
      const ry2 = x * Math.sin(rotRad) + y * Math.cos(rotRad) + oy;
      points.push({ x: rx2, y: ry2 });
    }
    return points;
  }, [pattern, width, height, rotation, speed, xOffset, yOffset, phase]);

  const pathD = React.useMemo(() => {
    if (previewPoints.length === 0) return '';
    return previewPoints
      .map((p, i) => {
        const cmd = i === 0 ? 'M' : 'L';
        return `${cmd} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
      })
      .join(' ');
  }, [previewPoints]);

  const trailPoints = React.useMemo<{ x: number; y: number; alpha?: number }[]>(() => {
    if (previewPoints.length < 10) return previewPoints;
    const currentIdx = Math.floor((phase / (Math.PI * 2)) * previewPoints.length) % previewPoints.length;
    const trail: { x: number; y: number; alpha: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = (currentIdx - i + previewPoints.length) % previewPoints.length;
      trail.push({ ...previewPoints[idx], alpha: 1 - i / 12 });
    }
    return trail;
  }, [previewPoints, phase]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={efxName}
          onChange={(e) => setEfxName(e.target.value)}
          className="flex-1 bg-transparent text-xl font-bold text-white outline-none border-b border-transparent hover:border-gray-700 focus:border-purple-500/50 transition-colors pb-0.5"
          placeholder="EFX Name"
        />
        {editingEffectId && (
          <span className="text-[10px] text-purple-400 px-2 py-0.5 rounded bg-purple-600/10 border border-purple-500/20">Editing</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-400">Pattern</label>
          <div className="flex flex-wrap gap-1.5">
            {EFX_PATTERNS.map((p) => (
              <button
                key={p}
                onClick={() => setPattern(p)}
                className={`px-3 py-2 rounded-md text-xs capitalize transition-all ${
                  pattern === p
                    ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30'
                    : 'bg-gray-800/30 text-gray-500 hover:bg-gray-700/30'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500">Speed: {(speed / Math.PI).toFixed(2)} Hz</label>
              <input
                type="range"
                min={0.3}
                max={0.8}
                step={0.01}
                value={speed}
                onChange={(e) => setSpeed(parseFloat(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500">Rotation: {rotation}°</label>
              <input
                type="range"
                min={0}
                max={360}
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500">Width: {width.toFixed(2)}</label>
              <input
                type="range"
                min={0.01}
                max={2}
                step={0.01}
                value={width}
                onChange={(e) => setWidth(parseFloat(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500">Height: {height.toFixed(2)}</label>
              <input
                type="range"
                min={0.01}
                max={2}
                step={0.01}
                value={height}
                onChange={(e) => setHeight(parseFloat(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500">X Offset: {xOffset}</label>
              <input
                type="range"
                min={-255}
                max={255}
                value={xOffset}
                onChange={(e) => setXOffset(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-gray-500">Y Offset: {yOffset}</label>
              <input
                type="range"
                min={-255}
                max={255}
                value={yOffset}
                onChange={(e) => setYOffset(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>
          </div>

          {/* Fixture multi-select */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-400">
              Fixtures ({selectedFixtureIds.size} selected)
            </label>
            {patchedFixtures.length === 0 ? (
              <div className="text-[10px] text-gray-600 italic py-1">
                No fixtures patched. Switch to the Fixtures tab first.
              </div>
            ) : !efxDefsLoaded ? (
              <div className="max-h-32 overflow-y-auto bg-gray-800/20 border border-gray-700/50 rounded-md p-1.5 space-y-0.5">
                {patchedFixtures.map((pf) => {
                  const isChecked = selectedFixtureIds.has(pf.id);
                  return (
                    <label
                      key={pf.id}
                      className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-800/30 cursor-pointer text-[11px] text-gray-300"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleFixture(pf.id)}
                        className="accent-purple-500"
                      />
                      <span className="truncate flex-1">{pf.name}</span>
                      <span className="text-[9px] text-gray-600 font-mono">@{pf.startAddress}</span>
                    </label>
                  );
                })}
              </div>
            ) : efxEligibleFixtureIds.size === 0 ? (
              <div className="text-[10px] text-gray-600 italic py-1">
                No fixtures with Pan/Tilt channels. Patch a moving head or scanner first.
              </div>
            ) : (
              <div className="max-h-32 overflow-y-auto bg-gray-800/20 border border-gray-700/50 rounded-md p-1.5 space-y-0.5">
                {patchedFixtures.filter((pf) => efxEligibleFixtureIds.has(pf.id)).map((pf) => {
                  const isChecked = selectedFixtureIds.has(pf.id);
                  return (
                    <label
                      key={pf.id}
                      className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-gray-800/30 cursor-pointer text-[11px] text-gray-300"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleFixture(pf.id)}
                        className="accent-purple-500"
                      />
                      <span className="truncate flex-1">{pf.name}</span>
                      <span className="text-[9px] text-gray-600 font-mono">@{pf.startAddress}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-purple-600/30 text-purple-200 rounded-lg text-xs font-semibold hover:bg-purple-600/50 active:bg-purple-600/60 flex items-center gap-1.5 transition-all border border-purple-500/30 hover:border-purple-400/60"
            >
              <SaveIcon size={14} /> {editingEffectId ? 'Update EFX' : 'Save EFX'}
            </button>
            <button
              onClick={() => setStopped((s) => !s)}
              className={`px-3 py-2 rounded-lg text-xs transition-all border ${
                stopped
                  ? 'bg-amber-600/20 text-amber-300 border-amber-500/30 hover:bg-amber-600/30'
                  : 'bg-red-600/20 text-red-300 border-red-500/30 hover:bg-red-600/30'
              }`}
            >
              {stopped ? '▶ Play' : '■ Stop'}
            </button>
            <button
              onClick={handleNew}
              className="px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
            >
              New
            </button>
          </div>
        </div>

        {/* Live animated preview */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-400">Live Preview — {pattern}</label>
          <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
            <svg
              viewBox="-1 -1 2 2"
              className="w-full aspect-square"
              style={{ background: '#0a0a0f' }}
            >
              {/* Grid */}
              <circle cx={0} cy={0} r={0.8} fill="none" stroke="#1a1a2e" strokeWidth={0.01} />
              <line x1={-1} y1={0} x2={1} y2={0} stroke="#1a1a2e" strokeWidth={0.005} />
              <line x1={0} y1={-1} x2={0} y2={1} stroke="#1a1a2e" strokeWidth={0.005} />

              {/* Path trail */}
              {trailPoints.map((tp, i) => {
                if (!tp) return null;
                return (
                <circle
                  key={i}
                  cx={tp.x}
                  cy={tp.y}
                  r={0.03 * (1 - i * 0.06)}
                  fill="#a855f7"
                  opacity={tp.alpha * 0.5}
                />
              );
              })}

              {/* Path outline */}
              <path
                d={pathD}
                fill="none"
                stroke="#a855f7"
                strokeWidth={0.015}
                opacity={0.3}
              />

              {/* Current position */}
              {previewPoints.length > 0 && (() => {
                const currentIdx = Math.floor((phase / (Math.PI * 2)) * (previewPoints.length - 1)) % previewPoints.length;
                const cp = previewPoints[currentIdx];
                if (!cp) return null;
                return (
                  <circle
                    cx={cp.x}
                    cy={cp.y}
                    r={0.06}
                    fill="#c084fc"
                    stroke="#ffffff"
                    strokeWidth={0.02}
                    style={{ filter: 'drop-shadow(0 0 3px #a855f7)' }}
                  />
                );
              })()}
            </svg>
          </div>
          <div className="flex gap-2 text-[10px] text-gray-600 justify-center">
            <span>{pattern}</span>
            <span>·</span>
            <span>{(speed / Math.PI).toFixed(1)} Hz</span>
            <span>·</span>
            <span>{previewPoints.length > 0 ? `${Math.round((phase / (Math.PI * 2) * 100) % 100)}%` : 'idle'}</span>
          </div>
        </div>
      </div>

      {/* Saved Effects list */}
      <div className="border-t border-gray-800/30 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-medium text-gray-400">Saved EFX ({effects.length})</span>
        </div>
        {effects.length === 0 ? (
          <div className="text-xs text-gray-600 text-center py-4">
            No EFX saved yet. Configure your pattern and click "Save EFX".
          </div>
        ) : (
          <div className="space-y-1">
            {effects.map((efx) => {
              const isEditing = editingEffectId === efx.id;
              const fixtureNames = efx.fixtureIds
                .map((fid) => patchedFixtures.find((pf) => pf.id === fid)?.name)
                .filter(Boolean)
                .join(', ') || 'All';
              return (
                <div
                  key={efx.id}
                  className={`px-3 py-2 rounded-lg flex items-center gap-2 group transition-colors ${
                    isEditing
                      ? 'bg-purple-600/15 border border-purple-500/20'
                      : 'bg-[#0d0d14] border border-gray-800/30 hover:border-gray-700'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-300 truncate">{efx.name}</div>
                    <div className="text-[10px] text-gray-600">
                      {efx.pattern} · {(efx.speed / Math.PI).toFixed(1)}Hz · {efx.fixtureIds.length} fixture{efx.fixtureIds.length !== 1 ? 's' : ''}
                      {fixtureNames && <span className="ml-1 truncate">({fixtureNames})</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingEffectId(efx.id)}
                    className="p-1 text-gray-500 hover:text-purple-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="Edit"
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(efx.id)}
                    className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setConfirmDelete(null)}>
          <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 shadow-2xl w-80" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-2">Delete EFX?</h4>
            <p className="text-xs text-gray-400 mb-4">This will permanently delete this EFX. This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50">
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteEffect(confirmDelete);
                  if (editingEffectId === confirmDelete) handleNew();
                  setConfirmDelete(null);
                }}
                className="px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded-lg text-xs text-red-300 hover:bg-red-600/30"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Fixture Patcher ───────────────────────────────────────
// Real DMX fixture patching with address map, search, and validation

interface FixtureDefResult {
  id: string;
  manufacturer: string;
  model: string;
  type: string;
  modes: Array<{ name: string; channels: Array<{ name: string; type: string }> }>;
}

type PatchStep = 'idle' | 'browse' | 'manufacturer' | 'searching' | 'modeSelect' | 'addressSet';

const FixturePatcher: React.FC<{ onEditFixture?: (f: any) => void }> = ({ onEditFixture }) => {
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const patchFixture = useShowStore((s) => s.patchFixture);
  const unpatchFixture = useShowStore((s) => s.unpatchFixture);
  const updateFixtureTier = useShowStore((s) => s.updateFixtureTier);
  const setFixtureName = useShowStore((s) => s.setFixtureName);
  const addShowUniverse = useShowStore((s) => s.addShowUniverse);
  const getNextFreeAddress = useShowStore((s) => s.getNextFreeAddress);
  const getUniverseMap = useShowStore((s) => s.getUniverseMap);

  // Fixtures currently lit by the test button (for visual feedback in the table)
  const [litSet, setLitSet] = useState<Set<string>>(new Set());

  // Toggle a patched fixture ON (dimmer max + white) / OFF to verify hardware wiring
  const handleTestLight = async (pf: PatchedFixture) => {
    if (fixtureTestState.has(pf.id)) {
      setLitSet((prev) => { const n = new Set(prev); n.delete(pf.id); return n; });
      try { await sendFixtureOff(pf, patchedFixtures, universes); } catch { /* hardware not available */ }
    } else {
      setLitSet((prev) => new Set(prev).add(pf.id));
      try {
        const def = await (window as any).lightMaestro?.fixtures?.getDefinition(pf.fixtureDefId);
        const channels = def?.modes?.[pf.modeIndex]?.channels ?? [];
        await sendFixtureOn(pf, channels, patchedFixtures, universes);
      } catch { /* hardware not available */ }
    }
  };

  const [selectedUniverseId, setSelectedUniverseId] = useState<string>('');
  const [hoveredFixtureId, setHoveredFixtureId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Add fixture modal
  const [showAdd, setShowAdd] = useState(false);
  const [step, setStep] = useState<PatchStep>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FixtureDefResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedDef, setSelectedDef] = useState<FixtureDefResult | null>(null);
  const [selectedModeIdx, setSelectedModeIdx] = useState(0);
  const [startAddress, setStartAddress] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [addTier, setAddTier] = useState<'primary' | 'secondary' | 'tertiary' | 'other'>('primary');
  const [addThumbnailId, setAddThumbnailId] = useState<string>('');
  const [addError, setAddError] = useState<string | null>(null);
  const [detailFixture, setDetailFixture] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Browse by manufacturer
  const [allFixtures, setAllFixtures] = useState<FixtureDefResult[]>([]);
  const [manufacturers, setManufacturers] = useState<{ name: string; count: number }[]>([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('');
  const [manufacturerFixtures, setManufacturerFixtures] = useState<FixtureDefResult[]>([]);

  // Budget < 100 € filter (bibliothèque curated, resources/fixtures/ofl/budget.json)
  const [budgetOnly, setBudgetOnly] = useState(false);
  const [budgetIds, setBudgetIds] = useState<Set<string>>(new Set());

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    fixtureId: string;
    fixtureName: string;
  }>({ visible: false, x: 0, y: 0, fixtureId: '', fixtureName: '' });

  // Dismiss context menu on any click
  useEffect(() => {
    if (!contextMenu.visible) return;
    const dismiss = () => setContextMenu((c) => ({ ...c, visible: false }));
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [contextMenu.visible]);

  // Auto-create default universe
  useEffect(() => {
    async function ensureUniverse() {
      const currentUniverses = useShowStore.getState().universes;
      if (currentUniverses.length > 0) {
        setSelectedUniverseId(currentUniverses[0].id);
        return;
      }

      try {
        // Try fetching from DMX engine via preload
        const dmxUniverses = await window.lightMaestro.dmx.getUniverses();
        if (dmxUniverses && dmxUniverses.length > 0) {
          const u = dmxUniverses[0];
          const showUniverse = {
            id: u.id || 'dmx-u-0',
            name: u.name || 'Universe 1',
            type: u.type || 'virtual',
            channels: u.channels || 512,
          };
          useShowStore.getState().addShowUniverse(showUniverse);
          setSelectedUniverseId(showUniverse.id);
          return;
        }
      } catch {
        // DMX engine not available, create default
      }

      // Create default USB-DMX universe
      const id = 'universe-1';
      useShowStore.getState().addShowUniverse({
        id,
        name: 'Universe 1',
        type: 'usb-dmx',
        channels: 512,
        serialPort: '',
      });
      // Sync to DMX engine
      try {
        await window.lightMaestro.dmx.addUniverse({ id, name: 'Universe 1', type: 'usb-dmx', output: true, input: false, channels: 512, serialPort: '' });
      } catch {
        // Engine might not be running — that's fine
      }
      setSelectedUniverseId(id);
    }
    ensureUniverse();
  }, []);

  // Filter fixtures for selected universe
  const universeFixtures = patchedFixtures.filter(
    (f) => f.universeId === selectedUniverseId
  );

  // Build channel map
  const handleBuildMap = useCallback(() => {
    if (!selectedUniverseId) return new Map<number, PatchedFixture>();
    return getUniverseMap(selectedUniverseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUniverseId, patchedFixtures]);

  const getMap = handleBuildMap;

  // Fixture index for coloring
  const fixtureColorIndex = new Map<string, number>();
  universeFixtures.forEach((f, i) => fixtureColorIndex.set(f.id, i));

  // ── Browse: load all fixtures & group by manufacturer ──
  const handleBrowse = async () => {
    setAddError(null);
    try {
      const all = await (window.lightMaestro.fixtures as any).getAll();
      const fixtureDefs: FixtureDefResult[] = (all || []).map((d: any) => ({
        id: d.id,
        manufacturer: d.manufacturer,
        model: d.model,
        type: d.type,
        modes: d.modes || [],
      }));
      setAllFixtures(fixtureDefs);

      // Budget < 100 € : jointure fabricant+modèle normalisés → ids
      try {
        const budget = await (window.lightMaestro.fixtures as any).getBudgetList();
        const ids = new Set<string>();
        for (const e of (budget?.entries || [])) {
          const key = `${e.manufacturer}-${e.model}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
          for (const f of fixtureDefs) {
            if (`${f.manufacturer}-${f.model}`.toLowerCase().replace(/[^a-z0-9]/g, '-') === key) ids.add(f.id);
          }
        }
        setBudgetIds(ids);
      } catch {
        setBudgetIds(new Set()); // bibliothèque budget indisponible → toggle inerte
      }

      // Group by manufacturer
      const counts: Record<string, number> = {};
      for (const f of fixtureDefs) {
        counts[f.manufacturer] = (counts[f.manufacturer] || 0) + 1;
      }
      const mfgs = Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setManufacturers(mfgs);
    } catch (e) {
      setAddError('Failed to load fixture library');
    }
  };

  // ── Select manufacturer from browse ──
  const handleSelectManufacturer = (name: string) => {
    setSelectedManufacturer(name);
    setManufacturerFixtures(
      allFixtures
        .filter((f) => f.manufacturer === name)
        .sort((a, b) => a.model.localeCompare(b.model))
    );
    setStep('manufacturer');
  };

  // ── Manufacturer: go back to browse ──
  const handleBackToBrowse = () => {
    setStep('browse');
    setSelectedManufacturer('');
    setManufacturerFixtures([]);
  };

  // ── Manufacturer: select fixture (same as search result) ──
  const handleSelectFromManufacturer = (def: FixtureDefResult) => {
    setSelectedDef(def);
    setSelectedModeIdx(0);
    setStep('modeSelect');
    setAddError(null);
  };

  // ── Search handler ──
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setAddError(null);
    try {
      const results = await window.lightMaestro.fixtures.search(query);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (e: any) {
      setSearchResults([]);
      setAddError(`Search failed: ${e?.message || 'Unknown error'}`);
    }
    setSearching(false);
  };

  // ── Switch from browse to search ──
  const handleOpenSearch = (query: string) => {
    setStep('searching');
    handleSearch(query);
  };

  // ── Select fixture definition ──
  const handleSelectDef = (def: FixtureDefResult) => {
    setSelectedDef(def);
    setSelectedModeIdx(0);
    setStep('modeSelect');
    setAddError(null);
  };

  // ── Go to address step ──
  const handleSelectMode = (modeIdx: number) => {
    setSelectedModeIdx(modeIdx);
    const def = selectedDef;
    if (!def) return;
    const mode = def.modes[modeIdx];
    if (!mode) return;
    const free = getNextFreeAddress(selectedUniverseId, mode.channels.length, quantity);
    setStartAddress(free > 0 ? free : 1);
    setStep('addressSet');
    setAddError(null);
  };

  // ── Confirm patch (batch) ──
  const handleConfirmPatch = () => {
    if (!selectedDef) return;
    const mode = selectedDef.modes[selectedModeIdx];
    if (!mode) return;

    const channels = mode.channels.length;
    const lastAddress = startAddress + channels * quantity - 1;

    // Validate last address fits in universe
    if (lastAddress > 512) {
      setAddError(
        `Batch of ${quantity} × ${channels}ch exceeds universe (${startAddress}–${lastAddress}, max 512)`
      );
      return;
    }

    // Pre-validate no overlaps with existing fixtures on this universe
    const existingFixtures = patchedFixtures.filter(
      (f) => f.universeId === selectedUniverseId
    );
    for (let i = 0; i < quantity; i++) {
      const addr = startAddress + i * channels;
      const end = addr + channels - 1;
      for (const pf of existingFixtures) {
        const pfEnd = pf.startAddress + pf.channelCount - 1;
        if (addr <= pfEnd && end >= pf.startAddress) {
          setAddError(
            `Address overlap: "${pf.name}" occupies ${pf.startAddress}–${pfEnd}, conflicts with fixture #${i + 1} at ${addr}–${end}`
          );
          return;
        }
      }
    }

    // Patch each fixture in sequence
    const baseName = `${selectedDef.manufacturer} ${selectedDef.model}`;
    for (let i = 0; i < quantity; i++) {
      const addr = startAddress + i * channels;
      const name =
        quantity > 1 ? `${baseName} #${i + 1}` : baseName;
      const result = patchFixture({
        fixtureDefId: selectedDef.id,
        manufacturer: selectedDef.manufacturer,
        model: selectedDef.model,
        fixtureType: selectedDef.type,
        modeIndex: selectedModeIdx,
        modeName: mode.name,
        universeId: selectedUniverseId,
        startAddress: addr,
        channelCount: channels,
        name,
        tier: addTier,
        thumbnailId: addThumbnailId || undefined,
      });

      if ('error' in result) {
        setAddError(result.error);
        return;
      }
    }

    resetAddModal();
  };

  const resetAddModal = () => {
    setShowAdd(false);
    setStep('idle');
    setSearchQuery('');
    setSearchResults([]);
    setSelectedDef(null);
    setSelectedModeIdx(0);
    setStartAddress(1);
    setQuantity(1);
    setAddError(null);
    setAllFixtures([]);
    setManufacturers([]);
    setSelectedManufacturer('');
    setManufacturerFixtures([]);
    setAddTier('primary');
    setAddThumbnailId('');
  };

  const handleBack = () => {
    if (step === 'modeSelect') {
      setStep(selectedDef?.manufacturer && allFixtures.length > 0 ? 'manufacturer' : 'searching');
      setAddError(null);
    } else if (step === 'addressSet') {
      setStep('modeSelect');
      setAddError(null);
    } else if (step === 'searching') {
      setStep('browse');
      setSearchQuery('');
      setSearchResults([]);
      setAddError(null);
    } else if (step === 'manufacturer') {
      handleBackToBrowse();
    }
  };

  // ── Rename ──
  const handleStartRename = (f: PatchedFixture) => {
    setEditingName(f.id);
    setEditNameValue(f.name);
  };

  const handleConfirmRename = () => {
    if (editingName && editNameValue.trim()) {
      setFixtureName(editingName, editNameValue.trim());
    }
    setEditingName(null);
  };

  // ── Error auto-dismiss ──
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // ── Show fixture detail ──
  const handleShowDetail = async (def: FixtureDefResult) => {
    setLoadingDetail(true);
    setDetailFixture(null);
    try {
      const full = await window.lightMaestro.fixtures.getDefinition(def.id);
      setDetailFixture(full);
    } catch {
      setDetailFixture(def); // fallback: show what we have
    }
    setLoadingDetail(false);
  };

  // ── Render ──
  return (
    <div className="space-y-5">
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-300">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header + Universe Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Fixture Patch</h2>
          <select
            value={selectedUniverseId}
            onChange={(e) => setSelectedUniverseId(e.target.value)}
            className="bg-gray-800/50 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-purple-500/50"
          >
            {universes.length === 0 && (
              <option value="">No universes</option>
            )}
            {universes.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.type})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            setShowAdd(true);
            setStep('browse');
            setSearchQuery('');
            setSearchResults([]);
            setAddError(null);
            setSelectedDef(null);
            setSelectedModeIdx(0);
            setStartAddress(1);
            setManufacturerFixtures([]);
            setSelectedManufacturer('');
            handleBrowse();
          }}
          className="px-4 py-2 bg-purple-600/30 text-purple-200 rounded-lg text-xs font-semibold hover:bg-purple-600/50 active:bg-purple-600/60 flex items-center gap-1.5 transition-all border border-purple-500/30 hover:border-purple-400/60 cursor-pointer"
        >
          <Plus size={14} /> Add Fixture
        </button>
      </div>

      {/* Réseau sACN — monitoring de ce qui part / arrive + toggle réception */}
      <NetworkMonitor />

      {/* DMX Address Map */}
      <DmxAddressMap
        universeId={selectedUniverseId}
        fixtures={universeFixtures}
        colorIndex={fixtureColorIndex}
        hoveredId={hoveredFixtureId}
        onHover={setHoveredFixtureId}
        onContextMenu={(e, fixtureId, fixtureName) => {
          e.preventDefault();
          setContextMenu({ visible: true, x: e.clientX, y: e.clientY, fixtureId, fixtureName });
        }}
      />

      {/* Patched Fixtures Table */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
        <div className="px-4 py-2 border-b border-gray-800/50 text-xs font-medium text-gray-400">
          Patched Fixtures ({universeFixtures.length})
        </div>
        {universeFixtures.length === 0 ? (
          <div className="p-6 text-center text-xs text-gray-600">
            No fixtures patched on this universe. Click "Add Fixture" to start.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/30 text-[10px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Tier</th>
                  <th className="text-left px-4 py-2 font-medium">Manufacturer</th>
                  <th className="text-left px-4 py-2 font-medium">Model</th>
                  <th className="text-left px-4 py-2 font-medium">Mode</th>
                  <th className="text-left px-4 py-2 font-medium">Address</th>
                  <th className="text-left px-4 py-2 font-medium">Ch</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/20">
                {universeFixtures.map((f) => {
                  const cIdx = fixtureColorIndex.get(f.id) ?? 0;
                  const color = getFixtureColor(cIdx);
                  return (
                    <tr
                      key={f.id}
                      className="hover:bg-gray-800/20 transition-colors"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, fixtureId: f.id, fixtureName: f.name });
                      }}
                      onMouseEnter={() => setHoveredFixtureId(f.id)}
                      onMouseLeave={() => setHoveredFixtureId(null)}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          {editingName === f.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editNameValue}
                                onChange={(e) => setEditNameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleConfirmRename();
                                  if (e.key === 'Escape') setEditingName(null);
                                }}
                                className="w-28 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200 outline-none"
                                autoFocus
                              />
                              <button onClick={handleConfirmRename} className="text-green-400 hover:text-green-300">
                                <Check size={12} />
                              </button>
                              <button onClick={() => setEditingName(null)} className="text-gray-500 hover:text-gray-300">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-gray-200 truncate max-w-[120px]">{f.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                          f.tier === 'primary' ? 'bg-purple-500/20 text-purple-400' :
                          f.tier === 'secondary' ? 'bg-blue-500/20 text-blue-400' :
                          f.tier === 'other' ? 'bg-cyan-500/20 text-cyan-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {f.tier}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-400">{f.manufacturer}</td>
                      <td className="px-4 py-2 text-gray-400">{f.model}</td>
                      <td className="px-4 py-2 text-gray-500">{f.modeName}</td>
                      <td className="px-4 py-2 text-gray-300 font-mono">{f.startAddress}</td>
                      <td className="px-4 py-2 text-gray-500 font-mono">{f.channelCount}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleStartRename(f)}
                            className="p-1 text-gray-600 hover:text-purple-400 transition-colors"
                            title="Rename"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => handleTestLight(f)}
                            className={`p-1 transition-colors ${litSet.has(f.id) ? 'text-green-400' : 'text-gray-600 hover:text-green-400'}`}
                            title={litSet.has(f.id) ? 'Éteindre' : 'Allumer (dimmer max + blanc)'}
                          >
                            <Zap size={12} />
                          </button>
                          <button
                            onClick={() => unpatchFixture(f.id)}
                            className="p-1 text-gray-600 hover:text-red-400 transition-colors"
                            title="Unpatch"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add Fixture Modal ── */}
      {showAdd && (
        <AddFixtureModal
          step={step}
          searchQuery={searchQuery}
          searchResults={step === 'searching' ? searchResults : []}
          searching={searching}
          selectedDef={selectedDef}
          selectedModeIdx={selectedModeIdx}
          startAddress={startAddress}
          quantity={quantity}
          error={addError}
          universeId={selectedUniverseId}
          manufacturers={manufacturers}
          selectedManufacturer={selectedManufacturer}
          manufacturerFixtures={manufacturerFixtures}
          allFixtures={allFixtures}
          tier={addTier}
          onSetTier={setAddTier}
          thumbnailId={addThumbnailId}
          onSetThumbnail={setAddThumbnailId}
          fixtureType={selectedDef?.type || ''}
          onSearch={handleSearch}
          onSelectDef={handleSelectDef}
          onSelectMode={handleSelectMode}
          onSetAddress={setStartAddress}
          onSetQuantity={setQuantity}
          onConfirm={handleConfirmPatch}
          onCancel={resetAddModal}
          onBack={handleBack}
          onSelectManufacturer={handleSelectManufacturer}
          onBackToBrowse={handleBackToBrowse}
          onSelectFromManufacturer={handleSelectFromManufacturer}
          onSwitchToSearch={handleOpenSearch}
          onShowDetail={handleShowDetail}
          getNextFree={getNextFreeAddress}
          budgetOnly={budgetOnly}
          budgetIds={budgetIds}
          onToggleBudget={setBudgetOnly}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu.visible && (
        <div
          className="fixed z-[60] bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">
            {contextMenu.fixtureName}
          </div>
          <button
            onClick={() => {
              handleStartRename(patchedFixtures.find(f => f.id === contextMenu.fixtureId)!);
              setContextMenu((c) => ({ ...c, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20 hover:text-purple-300 transition-colors flex items-center gap-2"
          >
            <Edit2 size={12} />
            Rename
          </button>
          <div className="my-1 border-t border-gray-800/60" />
          <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Groupe</div>
          {(['primary', 'secondary', 'tertiary', 'other'] as const).map((tier) => {
            const isCurrent = patchedFixtures.find((f) => f.id === contextMenu.fixtureId)?.tier === tier;
            return (
              <button
                key={tier}
                onClick={() => {
                  updateFixtureTier(contextMenu.fixtureId, tier);
                  setContextMenu((c) => ({ ...c, visible: false }));
                }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  isCurrent ? 'text-purple-300' : 'text-gray-300 hover:bg-purple-600/20 hover:text-purple-300'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${
                  tier === 'primary' ? 'bg-purple-400' : tier === 'secondary' ? 'bg-blue-400' : tier === 'other' ? 'bg-cyan-400' : 'bg-gray-400'
                }`} />
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
                {isCurrent && <Check size={12} className="ml-auto" />}
              </button>
            );
          })}
          <button
            onClick={() => {
              unpatchFixture(contextMenu.fixtureId);
              setContextMenu((c) => ({ ...c, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-red-600/20 hover:text-red-200 transition-colors flex items-center gap-2"
          >
            <Trash2 size={12} />
            Unpatch
          </button>
        </div>
      )}

      {/* Fixture detail modal */}
      {detailFixture && (
        <FixtureDetailModal
          fixture={detailFixture}
          onClose={() => setDetailFixture(null)}
          onEdit={onEditFixture}
        />
      )}
    </div>
  );
};

// ─── Channel type icon + color helpers ─────────────────────

const CHANNEL_ICONS: Record<string, string> = {
  Intensity: '🔅', Pan: '↔️', Tilt: '↕️', Colour: '🎨',
  Gobo: '❄️', Shutter: '⚡', Speed: '⏱️', Prism: '💠',
  Effect: '✨', Beam: '🔦', Maintenance: '🔧', Nothing: '⬜',
};

function channelTypeLabel(type: string): string {
  return (CHANNEL_ICONS[type] || '•') + ' ' + type;
}

function capabilityColorDots(capabilities: any[]): string {
  if (!capabilities?.length) return '';
  return capabilities
    .filter((c: any) => c.color)
    .map((c: any) => c.color)
    .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
    .slice(0, 8)
    .map((hex: string) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${hex};border:1px solid rgba(255,255,255,0.2);margin-left:2px" title="${hex}"></span>`)
    .join('');
}

// ─── Fixture Detail Modal ─────────────────────────────────

const FixtureDetailModal: React.FC<{
  fixture: any;
  onClose: () => void;
  onEdit?: (f: any) => void;
}> = ({ fixture, onClose, onEdit }) => {
  if (!fixture) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">{fixture.manufacturer} {fixture.model}</h3>
            <p className="text-[10px] text-gray-500">{fixture.type} · {fixture.modes?.length || 0} mode{fixture.modes?.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => { onClose(); onEdit(fixture); }}
                className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
              >
                <Edit2 size={12} /> Edit
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {fixture.modes?.map((mode: any, mi: number) => (
            <div key={mi} className="bg-[#0d0d14] border border-gray-800/50 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-800/30 flex items-center justify-between">
                <span className="text-xs font-semibold text-purple-300">{mode.name}</span>
                <span className="text-[10px] text-gray-600">{mode.channels?.length || 0} channels</span>
              </div>
              <div className="divide-y divide-gray-800/20">
                {mode.channels?.map((ch: any, ci: number) => {
                  const hasCaps = ch.capabilities?.some((c: any) => c.color);
                  const colorCaps = ch.capabilities?.filter((c: any) => c.color) || [];
                  return (
                  <div key={ci} className="px-3 py-2 flex items-center gap-2 text-xs">
                    <span className="text-gray-600 font-mono w-5 shrink-0">{ci + 1}</span>
                    <span className="text-gray-500 w-5 shrink-0 text-center">{CHANNEL_ICONS[ch.type] || '•'}</span>
                    <span className="text-gray-300 flex-1 min-w-0 truncate">{ch.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                      ch.type === 'Intensity' ? 'bg-yellow-500/15 text-yellow-400' :
                      ch.type === 'Colour' ? 'bg-pink-500/15 text-pink-400' :
                      ch.type === 'Pan' || ch.type === 'Tilt' ? 'bg-blue-500/15 text-blue-400' :
                      ch.type === 'Shutter' ? 'bg-purple-500/15 text-purple-400' :
                      ch.type === 'Gobo' ? 'bg-cyan-500/15 text-cyan-400' :
                      'bg-gray-800/50 text-gray-500'
                    }`}>{ch.type}</span>
                    {hasCaps && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        {colorCaps.slice(0, 6).map((cap: any, cci: number) => (
                          <span key={cci} className="w-3 h-3 rounded-full border border-white/20 inline-block"
                            style={{ backgroundColor: cap.color || '#666' }}
                            title={cap.name} />
                        ))}
                      </div>
                    )}
                    {ch.defaultValue != null && ch.defaultValue !== 0 && (
                      <span className="text-[10px] text-gray-600 shrink-0 w-10 text-right">{ch.defaultValue}</span>
                    )}
                  </div>
                )})}
              </div>
            </div>
          ))}
          {fixture.physical && (
            <div className="text-[10px] text-gray-600 space-y-1 grid grid-cols-2 gap-x-4">
              {fixture.physical.bulbType && <div>💡 Bulb: {fixture.physical.bulbType}</div>}
              {fixture.physical.bulbLumens && <div>🔆 Lumens: {fixture.physical.bulbLumens}</div>}
              {fixture.physical.weight && <div>⚖️ Weight: {fixture.physical.weight}kg</div>}
              {fixture.physical.lensDegMin != null && <div>🔍 Beam: {fixture.physical.lensDegMin}°{fixture.physical.lensDegMax ? `–${fixture.physical.lensDegMax}°` : ''}</div>}
              {fixture.physical.powerConsumption && <div>⚡ Power: {fixture.physical.powerConsumption}W</div>}
              {fixture.physical.DMXConnector && <div>🔌 DMX: {fixture.physical.DMXConnector}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── DMX Address Map ───────────────────────────────────────

const CELL_SIZE = 28;
const CELL_GAP = 2;
const CHANNELS_PER_ROW = 32;
const TOTAL_CHANNELS = 512;
const ROWS = Math.ceil(TOTAL_CHANNELS / CHANNELS_PER_ROW);
const ROW_LABEL_WIDTH = 24; // px — left gutter for row start channel numbers

interface DmxAddressMapProps {
  universeId: string;
  fixtures: PatchedFixture[];
  colorIndex: Map<string, number>;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onContextMenu: (e: React.MouseEvent, fixtureId: string, fixtureName: string) => void;
}

const DmxAddressMap: React.FC<DmxAddressMapProps> = ({
  fixtures,
  colorIndex,
  hoveredId,
  onHover,
  onContextMenu,
}) => {
  const moveFixture = useShowStore((s) => s.moveFixture);
  const gridRef = useRef<HTMLDivElement>(null);

  // Drag state
  const dragRef = useRef<{
    fixtureId: string;
    channelCount: number;
    originalAddr: number;
    targetAddr: number;
    dragging: boolean;
    valid: boolean;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ addr: number; count: number; valid: boolean } | null>(null);
  // Build a lookup: channel → fixture
  const channelOwner = new Map<number, { fixture: PatchedFixture; isFirst: boolean }>();
  for (const f of fixtures) {
    for (let i = 0; i < f.channelCount; i++) {
      channelOwner.set(f.startAddress + i, { fixture: f, isFirst: i === 0 });
    }
  }

  // Convert cursor position to DMX address using DOM hit-testing (100% precise)
  const addrFromCursor = useCallback((clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    // Walk up to find the cell div with data-dmx-addr
    let target: HTMLElement | null = el as HTMLElement;
    while (target && !target.dataset.dmxAddr) {
      target = target.parentElement;
    }
    if (!target?.dataset.dmxAddr) return null;
    const addr = parseInt(target.dataset.dmxAddr, 10);
    if (isNaN(addr) || addr < 1 || addr > TOTAL_CHANNELS) return null;
    return addr;
  }, []);

  // Drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !d.dragging) return;
      const addr = addrFromCursor(e.clientX, e.clientY);
      if (addr === null) return;
      const targetAddr = Math.max(1, Math.min(TOTAL_CHANNELS - d.channelCount + 1, addr));
      d.targetAddr = targetAddr;
      // Check for conflicts (exclude self)
      const end = targetAddr + d.channelCount - 1;
      let valid = targetAddr >= 1 && end <= TOTAL_CHANNELS;
      if (valid) {
        for (const f of fixtures) {
          if (f.id === d.fixtureId) continue;
          const fEnd = f.startAddress + f.channelCount - 1;
          if (targetAddr <= fEnd && end >= f.startAddress) { valid = false; break; }
        }
      }
      d.valid = valid;
      setDragPreview({ addr: targetAddr, count: d.channelCount, valid });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d || !d.dragging) return;
      d.dragging = false;
      if (d.targetAddr !== d.originalAddr && d.valid) {
        moveFixture(d.fixtureId, d.targetAddr);
      }
      setDragPreview(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [fixtures, addrFromCursor, moveFixture]);

  // Determine which channels should be highlighted by hover
  const hoverChannelSet = new Set<number>();

  const rows: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: number[] = [];
    for (let c = 0; c < CHANNELS_PER_ROW; c++) {
      const ch = r * CHANNELS_PER_ROW + c + 1;
      if (ch <= TOTAL_CHANNELS) row.push(ch);
    }
    rows.push(row);
  }

  return (
    <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-800/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-gray-400">DMX Address Map</span>
          <span className="text-[10px] text-gray-600">512 channels · drag fixtures to reassign addresses</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-600">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-[#1a1a2e] inline-block" /> Free
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-purple-500 inline-block" /> Occupied
          </span>
        </div>
      </div>
      <div className="p-3 flex justify-center">
        <div
          ref={gridRef}
          className="inline-flex flex-col relative"
          style={{ gap: CELL_GAP }}
        >
          {/* Column headers (every 2nd) */}
          <div className="flex items-end mb-0.5" style={{ gap: CELL_GAP, marginLeft: ROW_LABEL_WIDTH + CELL_GAP }}>
            {Array.from({ length: CHANNELS_PER_ROW }).map((_, ci) => {
              const ch = ci + 1;
              const showLabel = ch === 1 || ch % 2 === 0;
              return (
                <div
                  key={ci}
                  className="flex items-end justify-center"
                  style={{ width: CELL_SIZE, height: 14 }}
                >
                  {showLabel && (
                    <span className="text-[7px] text-gray-600 leading-none font-mono">
                      {ch}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {rows.map((row, ri) => (
            <div key={ri} className="flex items-center" style={{ gap: CELL_GAP }}>
              {/* Row label — start channel of this row */}
              <span
                className="text-[7px] text-gray-600 font-mono leading-none shrink-0 text-right"
                style={{ width: ROW_LABEL_WIDTH }}
              >
                {row[0]}
              </span>
              {row.map((ch) => {
                const owner = channelOwner.get(ch);
                const isHovered = hoverChannelSet.has(ch);
                const isFirst = owner?.isFirst;

                let bg = '#1a1a2e'; // free
                let borderColor: string | undefined;

                if (owner) {
                  const cIdx = colorIndex.get(owner.fixture.id) ?? 0;
                  const baseColor = getFixtureColor(cIdx);
                  bg = baseColor;
                  if (isFirst) {
                    // First channel = brighter (lighten by mixing with white)
                    borderColor = '#ffffff';
                  }
                  if (isHovered) {
                    // Brighten on hover
                    bg = lightenColor(baseColor, 0.35);
                  }
                }

                const title = owner
                  ? `${owner.fixture.name} · Ch ${ch}${isFirst ? ' (start)' : ''}`
                  : `Ch ${ch} — Free`;

                return (
                  <div
                    key={ch}
                    data-dmx-addr={ch}
                    title={title}
                    className={`rounded-sm transition-colors duration-75 relative flex items-center justify-center ${owner ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    style={{
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      backgroundColor: bg,
                      border: borderColor ? `1px solid ${borderColor}` : '1px solid transparent',
                    }}
                    onMouseDown={(e) => {
                      if (!owner || e.button !== 0) return;
                      e.preventDefault();
                      dragRef.current = {
                        fixtureId: owner.fixture.id,
                        channelCount: owner.fixture.channelCount,
                        originalAddr: owner.fixture.startAddress,
                        targetAddr: owner.fixture.startAddress,
                        dragging: true,
                        valid: true,
                      };
                    }}
                    onMouseEnter={() => owner && onHover(owner.fixture.id)}
                    onMouseLeave={() => onHover(null)}
                    onContextMenu={(e) => {
                      if (owner) {
                        e.preventDefault();
                        onContextMenu(e, owner.fixture.id, owner.fixture.name);
                      }
                    }}
                  >
                    {/* Channel number overlay */}
                    <span
                      className={`absolute inset-0 flex items-center justify-center font-mono leading-none pointer-events-none select-none ${owner ? 'text-[7px] text-white font-semibold' : 'text-[8px] text-gray-300'}`}
                    >
                      {ch <= 512 ? ch : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Drag preview overlay */}
          {dragPreview && (() => {
            const cellStep = CELL_SIZE + CELL_GAP;
            const startRow = Math.floor((dragPreview.addr - 1) / CHANNELS_PER_ROW);
            const startCol = (dragPreview.addr - 1) % CHANNELS_PER_ROW;
            // How many cells wide in a single row (clamp to row boundary)
            const cellsInFirstRow = Math.min(dragPreview.count, CHANNELS_PER_ROW - startCol);
            const remainingCells = dragPreview.count - cellsInFirstRow;
            const fullRows = remainingCells > 0 ? Math.floor(remainingCells / CHANNELS_PER_ROW) : 0;
            const lastRowCells = remainingCells > 0 ? remainingCells % CHANNELS_PER_ROW : 0;

            return (
              <div className="absolute inset-0 pointer-events-none z-10" style={{ top: 0, left: 0 }}>
                {/* First row */}
                <div
                  className={`absolute rounded-sm border-2 ${dragPreview.valid ? 'border-emerald-400 bg-emerald-400/20' : 'border-red-400 bg-red-400/20'}`}
                  style={{
                    left: startCol * cellStep,
                    top: startRow * cellStep,
                    width: cellsInFirstRow * cellStep - CELL_GAP,
                    height: CELL_SIZE,
                  }}
                />
                {/* Full middle rows */}
                {Array.from({ length: fullRows }).map((_, ri) => (
                  <div
                    key={ri}
                    className={`absolute rounded-sm border-2 ${dragPreview.valid ? 'border-emerald-400 bg-emerald-400/20' : 'border-red-400 bg-red-400/20'}`}
                    style={{
                      left: 0,
                      top: (startRow + 1 + ri) * cellStep,
                      width: CHANNELS_PER_ROW * cellStep - CELL_GAP,
                      height: CELL_SIZE,
                    }}
                  />
                ))}
                {/* Last partial row */}
                {lastRowCells > 0 && (
                  <div
                    className={`absolute rounded-sm border-2 ${dragPreview.valid ? 'border-emerald-400 bg-emerald-400/20' : 'border-red-400 bg-red-400/20'}`}
                    style={{
                      left: 0,
                      top: (startRow + 1 + fullRows) * cellStep,
                      width: lastRowCells * cellStep - CELL_GAP,
                      height: CELL_SIZE,
                    }}
                  />
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

// ─── Add Fixture Modal ─────────────────────────────────────

interface AddFixtureModalProps {
  step: PatchStep;
  searchQuery: string;
  searchResults: FixtureDefResult[];
  searching: boolean;
  selectedDef: FixtureDefResult | null;
  selectedModeIdx: number;
  startAddress: number;
  quantity: number;
  error: string | null;
  universeId: string;
  manufacturers: { name: string; count: number }[];
  selectedManufacturer: string;
  manufacturerFixtures: FixtureDefResult[];
  allFixtures: FixtureDefResult[];
  tier: 'primary' | 'secondary' | 'tertiary' | 'other';
  onSetTier: (tier: 'primary' | 'secondary' | 'tertiary' | 'other') => void;
  thumbnailId: string;
  onSetThumbnail: (id: string) => void;
  fixtureType: string;
  onSearch: (query: string) => void;
  onSelectDef: (def: FixtureDefResult) => void;
  onSelectMode: (modeIdx: number) => void;
  onSetAddress: (addr: number) => void;
  onSetQuantity: (qty: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onBack: () => void;
  onSelectManufacturer: (name: string) => void;
  onBackToBrowse: () => void;
  onSelectFromManufacturer: (def: FixtureDefResult) => void;
  onSwitchToSearch: (query: string) => void;
  onShowDetail: (def: FixtureDefResult) => void;
  getNextFree: (universeId: string, channels: number, quantity?: number) => number;
  budgetOnly: boolean;
  budgetIds: Set<string>;
  onToggleBudget: (on: boolean) => void;
}

const AddFixtureModal: React.FC<AddFixtureModalProps> = ({
  step,
  searchQuery,
  searchResults,
  searching,
  selectedDef,
  selectedModeIdx,
  startAddress,
  quantity,
  error,
  universeId,
  manufacturers,
  selectedManufacturer,
  manufacturerFixtures,
  allFixtures,
  tier,
  onSetTier,
  thumbnailId,
  onSetThumbnail,
  fixtureType,
  onSearch,
  onSelectDef,
  onSelectMode,
  onSetAddress,
  onSetQuantity,
  onConfirm,
  onCancel,
  onBack,
  onSelectManufacturer,
  onBackToBrowse,
  onSelectFromManufacturer,
  onSwitchToSearch,
  onShowDetail,
  getNextFree,
  budgetOnly,
  budgetIds,
  onToggleBudget,
}) => {
  const { t } = useTranslation();
  const mode =
    selectedDef && selectedModeIdx < selectedDef.modes.length
      ? selectedDef.modes[selectedModeIdx]
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">
            {step === 'browse' && 'Add Fixture — Browse by Manufacturer'}
            {step === 'manufacturer' && `Add Fixture — ${selectedManufacturer}`}
            {step === 'searching' && 'Add Fixture — Search Library'}
            {step === 'modeSelect' && `Select Mode — ${selectedDef?.manufacturer} ${selectedDef?.model}`}
            {step === 'addressSet' && 'Set DMX Address'}
          </h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-300">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Step: Browse by Manufacturer */}
          {step === 'browse' && (
            <div className="space-y-4">
              {/* Search bar */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    const q = e.target.value;
                    onSwitchToSearch(q);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim().length >= 1) {
                      onSwitchToSearch(searchQuery.trim());
                    }
                  }}
                  placeholder="Or search by manufacturer, model, or type…"
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-purple-500/50"
                />
              </div>
              <p className="text-xs text-gray-500">
                {manufacturers.length} manufacturers · {allFixtures.length} fixtures
              </p>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={budgetOnly}
                  onChange={(e) => onToggleBudget(e.target.checked)}
                  className="accent-purple-500"
                />
                {t('design.addFixtureModal.budgetOnly')}
                {budgetOnly && budgetIds.size > 0 && (
                  <span className="ml-1 text-[10px] text-purple-400">
                    ({t('design.addFixtureModal.budgetCount', { count: budgetIds.size })})
                  </span>
                )}
              </label>
              <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
                {(budgetOnly
                  ? manufacturers.filter((m) => allFixtures.some((f) => f.manufacturer === m.name && budgetIds.has(f.id)))
                  : manufacturers
                ).map((mfg) => {
                  const hue = (mfg.name.charCodeAt(0) * 37 + mfg.name.length * 53) % 360;
                  const previewColor = `hsl(${hue}, 60%, 35%)`;
                  return (
                    <button
                      key={mfg.name}
                      onClick={() => onSelectManufacturer(mfg.name)}
                      className="text-left p-3 rounded-lg border border-gray-800/50 hover:border-purple-500/40 hover:bg-gray-800/20 transition-all group"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: previewColor }}
                        />
                        <span className="text-xs text-gray-200 truncate group-hover:text-purple-200 transition-colors">
                          {mfg.name}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-600">
                        {budgetOnly
                          ? allFixtures.filter((f) => f.manufacturer === mfg.name && budgetIds.has(f.id)).length
                          : mfg.count} fixture{((budgetOnly
                            ? allFixtures.filter((f) => f.manufacturer === mfg.name && budgetIds.has(f.id)).length
                            : mfg.count) !== 1) ? 's' : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step: Manufacturer Fixtures */}
          {step === 'manufacturer' && (
            <div className="space-y-4">
              <button
                onClick={() => onBackToBrowse()}
                className="text-[10px] text-purple-400 hover:text-purple-300"
                type="button"
              >
                ← Back to manufacturers
              </button>
              <p className="text-xs text-gray-400">
                {manufacturerFixtures.length} fixture{manufacturerFixtures.length !== 1 ? 's' : ''} from{' '}
                <span className="text-gray-200 font-medium">{selectedManufacturer}</span>
              </p>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {manufacturerFixtures
                  .filter((def) => !budgetOnly || budgetIds.has(def.id))
                  .map((def) => (
                  <button
                    key={def.id}
                    onClick={() => onSelectFromManufacturer(def)}
                    onContextMenu={(e) => { e.preventDefault(); onShowDetail(def); }}
                    title="Right-click for full details"
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-800/40 transition-colors flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-sm text-gray-200">{def.model}</div>
                      <div className="text-[10px] text-gray-500">
                        {def.type}
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-600">
                      {def.modes.length} mode{def.modes.length !== 1 ? 's' : ''}
                      <ChevronDown size={12} className="inline ml-1 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-gray-700 text-center mt-1">Click to select · Right-click for full details</p>
            </div>
          )}
          {step === 'searching' && (
            <div className="space-y-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Search by manufacturer, model, or type…"
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-purple-500/50"
                  autoFocus
                />
              </div>

              {searching && (
                <div className="text-xs text-gray-500 text-center py-4">Searching…</div>
              )}

              {!searching && searchQuery.length > 0 && searchResults.length === 0 && (
                <div className="text-xs text-gray-600 text-center py-8">
                  No fixtures found for "{searchQuery}"
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {searchResults
                    .filter((def) => !budgetOnly || budgetIds.has(def.id))
                    .map((def) => (
                    <button
                      key={def.id}
                      onClick={() => onSelectDef(def)}
                      onContextMenu={(e) => { e.preventDefault(); onShowDetail(def); }}
                      title="Right-click for full details"
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-gray-800/40 transition-colors flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-sm text-gray-200">{def.model}</div>
                        <div className="text-[10px] text-gray-500">
                          {def.manufacturer} · {def.type}
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-600">
                        {def.modes.length} mode{def.modes.length !== 1 ? 's' : ''}
                        <ChevronDown size={12} className="inline ml-1 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searchResults.length > 0 && (
                <p className="text-[9px] text-gray-700 text-center mt-1">Click to select · Right-click for full details</p>
              )}
            </div>
          )}
          {step === 'modeSelect' && selectedDef && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                Choose a DMX mode for <span className="text-gray-200 font-medium">{selectedDef.model}</span>:
              </p>
              {selectedDef.modes.map((m, i) => (
                <button
                  key={i}
                  onClick={() => onSelectMode(i)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    i === selectedModeIdx
                      ? 'border-purple-500/50 bg-purple-600/10'
                      : 'border-gray-800/50 hover:border-gray-700 hover:bg-gray-800/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-200 font-medium">{m.name}</span>
                    <span className="text-xs text-gray-500 font-mono">{m.channels.length} ch</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.channels.slice(0, 8).map((ch, j) => (
                      <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800/60 text-gray-400">
                        {ch.type}
                      </span>
                    ))}
                    {m.channels.length > 8 && (
                      <span className="text-[9px] px-1.5 py-0.5 text-gray-600">
                        +{m.channels.length - 8} more
                      </span>
                    )}
                  </div>
                </button>
              ))}
              <button
                onClick={() => onBack()}
                className="text-[10px] text-gray-500 hover:text-gray-300 mt-1"
                type="button"
              >
                ← Back to {allFixtures.length > 0 ? 'manufacturer' : 'search'}
              </button>
            </div>
          )}

          {/* Step: Address */}
          {step === 'addressSet' && selectedDef && mode && (
            <div className="space-y-4">
              <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-3">
                <div className="text-xs text-gray-400">Fixture</div>
                <div className="text-sm text-gray-200 font-medium">
                  {selectedDef.manufacturer} {selectedDef.model}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Mode: {mode.name} · {mode.channels.length} channels
                  {quantity > 1 && (
                    <span className="text-purple-300 ml-2">× {quantity} units</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-400">Start DMX Address</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={513 - mode.channels.length * quantity}
                    value={startAddress}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) onSetAddress(Math.max(1, Math.min(512, v)));
                    }}
                    className="w-24 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono outline-none focus:border-purple-500/50"
                  />
                  <span className="text-xs text-gray-600">
                    {' · '}end: {startAddress + mode.channels.length * quantity - 1}
                    {startAddress + mode.channels.length * quantity - 1 > 512 && (
                      <span className="text-red-400 ml-1">⚠ Exceeds universe</span>
                    )}
                  </span>
                </div>
                <button
                  onClick={() => {
                    const free = getNextFree(universeId, mode.channels.length, quantity);
                    if (free > 0) onSetAddress(free);
                  }}
                  className="text-[10px] text-purple-400 hover:text-purple-300"
                  type="button"
                >
                  Auto-find first free address
                </button>
              </div>

              {/* Quantity */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">Quantity</label>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onSetQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    className="w-8 h-8 rounded-lg bg-gray-800/50 border border-gray-700 text-gray-300 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-mono"
                    type="button"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={quantity}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 1 && v <= 99) onSetQuantity(v);
                    }}
                    className="w-16 bg-gray-800/50 border border-gray-700 rounded-lg px-2 py-2 text-sm text-gray-200 font-mono text-center outline-none focus:border-purple-500/50"
                  />
                  <button
                    onClick={() => onSetQuantity(Math.min(99, quantity + 1))}
                    disabled={quantity >= 99}
                    className="w-8 h-8 rounded-lg bg-gray-800/50 border border-gray-700 text-gray-300 hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-sm font-mono"
                    type="button"
                  >
                    +
                  </button>
                  <span className="text-[10px] text-gray-600 ml-1">
                    {mode.channels.length * quantity} total ch
                  </span>
                </div>
              </div>

              {/* Live preview for batch */}
              {quantity > 1 && (() => {
                const channels = mode.channels.length;
                const previews = Array.from({ length: Math.min(quantity, 8) }, (_, i) => ({
                  idx: i + 1,
                  name: `${selectedDef.manufacturer} ${selectedDef.model} #${i + 1}`,
                  addr: startAddress + i * channels,
                  end: startAddress + i * channels + channels - 1,
                }));
                return (
                  <div className="bg-[#0d0d14] border border-gray-800/50 rounded-lg p-3 space-y-1">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                      Live Preview
                      {quantity > 8 && (
                        <span className="text-gray-600 ml-1">(first 8 of {quantity})</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 font-mono space-y-0.5">
                      {previews.map((p) => (
                        <div key={p.idx} className="flex items-center gap-2">
                          <span className="w-5 text-gray-600 text-right">#{p.idx}</span>
                          <span className="text-gray-300 truncate max-w-[180px]">{p.name}</span>
                          <span className="text-gray-500 whitespace-nowrap">
                            @ {p.addr}–{p.end}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Fixture Thumbnail / Gif selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-400">Fixture Preview</label>
                  <span className="text-[9px] text-gray-600">Choose how the fixture appears in 3D view</span>
                </div>
                {
  /* Use the imported getVariantsForCategory */
  (() => {
    const variants = getVariantsForCategory(fixtureType || 'moving_head');
    return (
      <div className="grid grid-cols-5 gap-2">
        {variants.length > 0 ? variants.map((v) => {
          const sel = thumbnailId === v.id;
          return (
            <button key={v.id}
              onClick={() => onSetThumbnail(v.id)}
              className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all ${sel ? 'border-purple-400 bg-purple-600/20' : 'border-gray-700/50 bg-gray-800/30 hover:bg-gray-700/30'}`}
              title={v.description}
            >
              <img src={v.dataUrl} className="w-10 h-10 rounded object-contain" />
              <span className="text-[8px] text-gray-400 leading-tight text-center">{v.label}</span>
            </button>
          );
        }) : <span className="text-[9px] text-gray-600">Loading…</span>}
      </div>
    );
  })()
}
              </div>

              {/* Tier selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-400">Fixture Tier</label>
                  <span className="text-[9px] text-gray-600">Tiers control show behavior (intensity/movement/strobe) — Groups control targeting</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'primary' as const, label: 'Primary', desc: 'Lead fixtures — full effects & movement', color: 'border-purple-500/50 bg-purple-600/10', activeColor: 'border-purple-400 bg-purple-600/30' },
                    { value: 'secondary' as const, label: 'Secondary', desc: 'Fill lights — balanced effects', color: 'border-blue-500/50 bg-blue-600/10', activeColor: 'border-blue-400 bg-blue-600/30' },
                    { value: 'tertiary' as const, label: 'Tertiary', desc: 'Ambient/wash — simple colors only', color: 'border-gray-500/50 bg-gray-600/10', activeColor: 'border-gray-400 bg-gray-600/30' },
                    { value: 'other' as const, label: 'Other', desc: 'Non catalogué — effets neutres', color: 'border-cyan-500/50 bg-cyan-600/10', activeColor: 'border-cyan-400 bg-cyan-600/30' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onSetTier(opt.value)}
                      className={`text-left p-2.5 rounded-lg border transition-all ${
                        tier === opt.value ? opt.activeColor : opt.color + ' hover:bg-gray-800/20'
                      }`}
                    >
                      <div className="text-xs font-medium text-gray-200">{opt.label}</div>
                      <div className="text-[9px] text-gray-500 mt-0.5 leading-tight">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={() => onBack()} className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50 transition-colors">
                  Back
                </button>
                <button
                  onClick={onConfirm}
                  disabled={!thumbnailId}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs transition-colors font-medium ${
                    thumbnailId
                      ? 'bg-purple-600/30 border border-purple-500/30 text-purple-200 hover:bg-purple-600/50'
                      : 'bg-gray-800/30 border border-gray-700/50 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {!thumbnailId ? 'Select a preview' : `Patch ${quantity > 1 ? `${quantity} Fixtures` : 'Fixture'}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Patched Fixture List (Left Panel) ─────────────────────

const PatchedFixtureList: React.FC = () => {
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const unpatchFixture = useShowStore((s) => s.unpatchFixture);
  const updateFixtureTier = useShowStore((s) => s.updateFixtureTier);
  const setFixtureName = useShowStore((s) => s.setFixtureName);
  const { testState, startTest, stopTest } = useFixtureTest();
  const [testingFixtureId, setTestingFixtureId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    fixtureId: string;
    fixtureName: string;
  }>({ visible: false, x: 0, y: 0, fixtureId: '', fixtureName: '' });

  // Dismiss context menu on any click
  useEffect(() => {
    if (!ctxMenu.visible) return;
    const dismiss = () => setCtxMenu((c) => ({ ...c, visible: false }));
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [ctxMenu.visible]);

  // Reset test state when test completes
  useEffect(() => {
    if (!testState.isRunning && testingFixtureId) {
      setTestingFixtureId(null);
    }
  }, [testState.isRunning, testingFixtureId]);

  const handleStartRename = (f: PatchedFixture) => {
    setEditingName(f.id);
    setEditNameValue(f.name);
  };

  const handleConfirmRename = () => {
    if (editingName && editNameValue.trim()) {
      setFixtureName(editingName, editNameValue.trim());
    }
    setEditingName(null);
  };

  if (patchedFixtures.length === 0) {
    return (
      <div className="text-xs text-gray-600 text-center py-8">
        No fixtures patched yet
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {patchedFixtures.map((f, i) => {
          const isTesting = testingFixtureId === f.id && testState.isRunning;
          return (
          <div
            key={f.id}
            className={`px-2 py-1.5 rounded-md hover:bg-gray-800/30 cursor-pointer text-xs flex items-center gap-2 ${isTesting ? 'bg-emerald-600/10 ring-1 ring-emerald-500/40' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, fixtureId: f.id, fixtureName: f.name });
            }}
          >
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: isTesting ? '#10b981' : getFixtureColor(i) }}
            />
            <div className="flex-1 min-w-0">
              {editingName === f.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmRename();
                      if (e.key === 'Escape') setEditingName(null);
                    }}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-200 outline-none"
                    autoFocus
                  />
                  <button onClick={handleConfirmRename} className="text-green-400 hover:text-green-300 shrink-0">
                    <Check size={12} />
                  </button>
                  <button onClick={() => setEditingName(null)} className="text-gray-500 hover:text-gray-300 shrink-0">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="text-gray-300 truncate">{f.name}</div>
              )}
              <div className="text-[10px] text-gray-600 flex items-center gap-1">
                <span className={`inline-block px-1 py-0 rounded text-[8px] ${
                  f.tier === 'primary' ? 'bg-purple-500/20 text-purple-400' :
                  f.tier === 'secondary' ? 'bg-blue-500/20 text-blue-400' :
                  f.tier === 'other' ? 'bg-cyan-500/20 text-cyan-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>{f.tier}</span>
                {f.model} · {f.channelCount}ch · @{f.startAddress}
              </div>
              {isTesting && (
                <div className="mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-emerald-400 font-medium">{testState.stepLabel}</span>
                    <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-75"
                        style={{ width: `${testState.progress * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (isTesting) {
                  stopTest();
                  setTestingFixtureId(null);
                  return;
                }
                // Load fixture definition to get channel types
                try {
                  const def = await (window as any).lightMaestro?.fixtures?.getDefinition(f.fixtureDefId);
                  const mode = def?.modes?.[f.modeIndex ?? 0];
                  const channels = mode?.channels || [];
                  setTestingFixtureId(f.id);
                  startTest({
                    universeIndex: universes.findIndex(u => u.id === f.universeId),
                    startAddress: f.startAddress,
                    channels,
                  });
                } catch {
                  // Fixture def not available — try a basic dimmer-only test
                  setTestingFixtureId(f.id);
                  startTest({
                    universeIndex: universes.findIndex(u => u.id === f.universeId),
                    startAddress: f.startAddress,
                    channels: [{ name: 'Dimmer', type: 'Intensity', offset: 0 }],
                  });
                }
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${
                isTesting
                  ? 'bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30'
                  : 'bg-gray-800/50 text-gray-500 hover:text-emerald-400 hover:bg-emerald-600/10 border border-transparent hover:border-emerald-500/30'
              }`}
              title={isTesting ? 'Stop test' : 'Test fixture'}
            >
              {isTesting ? (
                <Square size={10} />
              ) : (
                <Zap size={10} />
              )}
            </button>
          </div>
        )})}
      </div>

      {/* Context menu */}
      {ctxMenu.visible && (
        <div
          className="fixed z-[60] bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">
            {ctxMenu.fixtureName}
          </div>
          <button
            onClick={() => {
              handleStartRename(patchedFixtures.find(f => f.id === ctxMenu.fixtureId)!);
              setCtxMenu((c) => ({ ...c, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20 hover:text-purple-300 transition-colors flex items-center gap-2"
          >
            <Edit2 size={12} />
            Rename
          </button>
          <div className="my-1 border-t border-gray-800/60" />
          <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Groupe</div>
          {(['primary', 'secondary', 'tertiary', 'other'] as const).map((tier) => {
            const isCurrent = patchedFixtures.find((f) => f.id === ctxMenu.fixtureId)?.tier === tier;
            return (
              <button
                key={tier}
                onClick={() => {
                  updateFixtureTier(ctxMenu.fixtureId, tier);
                  setCtxMenu((c) => ({ ...c, visible: false }));
                }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  isCurrent ? 'text-purple-300' : 'text-gray-300 hover:bg-purple-600/20 hover:text-purple-300'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${
                  tier === 'primary' ? 'bg-purple-400' : tier === 'secondary' ? 'bg-blue-400' : tier === 'other' ? 'bg-cyan-400' : 'bg-gray-400'
                }`} />
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
                {isCurrent && <Check size={12} className="ml-auto" />}
              </button>
            );
          })}
          <button
            onClick={() => {
              unpatchFixture(ctxMenu.fixtureId);
              setCtxMenu((c) => ({ ...c, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-red-600/20 hover:text-red-200 transition-colors flex items-center gap-2"
          >
            <Trash2 size={12} />
            Unpatch
          </button>
        </div>
      )}
    </>
  );
};

// ─── Groups List (Left Panel) ────────────────────────────

const GROUPS_PRESET_COLORS = [
  '#ff0064', '#6400ff', '#00c8ff', '#ffc800', '#00ff88', '#ff6600',
];

const GroupsList: React.FC = () => {
  const groups = useShowStore((s) => s.fixtureGroups);
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const removeGroup = useShowStore((s) => s.removeGroup);
  const [ctxMenu, setCtxMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    groupId: string;
    groupName: string;
  }>({ visible: false, x: 0, y: 0, groupId: '', groupName: '' });

  useEffect(() => {
    if (!ctxMenu.visible) return;
    const dismiss = () => setCtxMenu((c) => ({ ...c, visible: false }));
    window.addEventListener('click', dismiss);
    return () => window.removeEventListener('click', dismiss);
  }, [ctxMenu.visible]);

  if (groups.length === 0) {
    return (
      <div className="text-xs text-gray-600 text-center py-8">
        No groups created yet
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {groups.map((g) => (
          <div
            key={g.id}
            className="px-2 py-1.5 rounded-md hover:bg-gray-800/30 cursor-pointer text-xs flex items-center gap-2"
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, groupId: g.id, groupName: g.name });
            }}
          >
            <span
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: g.color || '#6b7280' }}
            />
            <div className="flex-1 min-w-0">
              <div className="text-gray-300 truncate font-medium">{g.name}</div>
              <div className="text-[10px] text-gray-600">
                {g.fixtureIds.length} fixture{g.fixtureIds.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Context menu */}
      {ctxMenu.visible && (
        <div
          className="fixed z-[60] bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">
            {ctxMenu.groupName}
          </div>
          <button
            onClick={() => {
              removeGroup(ctxMenu.groupId);
              setCtxMenu((c) => ({ ...c, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-red-600/20 hover:text-red-200 transition-colors flex items-center gap-2"
          >
            <Trash2 size={12} />
            Delete Group
          </button>
        </div>
      )}
    </>
  );
};

// ─── Groups Editor (Right Panel) ─────────────────────────

const GroupsEditor: React.FC = () => {
  const fixtureGroups = useShowStore((s) => s.fixtureGroups);
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const addGroup = useShowStore((s) => s.addGroup);
  const removeGroup = useShowStore((s) => s.removeGroup);
  const renameGroup = useShowStore((s) => s.renameGroup);
  const updateGroupFixtures = useShowStore((s) => s.updateGroupFixtures);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(GROUPS_PRESET_COLORS[0]);
  const [newFixtureIds, setNewFixtureIds] = useState<string[]>([]);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editFixtureIds, setEditFixtureIds] = useState<string[]>([]);

  const resetCreate = () => {
    setShowCreate(false);
    setNewName('');
    setNewColor(GROUPS_PRESET_COLORS[0]);
    setNewFixtureIds([]);
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    addGroup(newName.trim(), newFixtureIds, newColor);
    resetCreate();
  };

  const handleStartEdit = (g: FixtureGroup) => {
    setEditGroupId(g.id);
    setEditName(g.name);
    setEditColor(g.color || GROUPS_PRESET_COLORS[0]);
    setEditFixtureIds([...g.fixtureIds]);
  };

  const handleSaveEdit = () => {
    if (!editGroupId || !editName.trim()) return;
    renameGroup(editGroupId, editName.trim());
    updateGroupFixtures(editGroupId, editFixtureIds);
    setEditGroupId(null);
  };

  const handleCancelEdit = () => setEditGroupId(null);

  const toggleFixture = (id: string, selected: string[], setSelected: (v: string[]) => void) => {
    if (selected.includes(id)) {
      setSelected(selected.filter((fid) => fid !== id));
    } else {
      setSelected([...selected, id]);
    }
  };

  // Group fixtures by name for display
  const fixtureNameMap = new Map(patchedFixtures.map((f) => [f.id, f]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Fixture Groups</h2>
          <p className="text-[10px] text-gray-500 mt-0.5 max-w-lg">
            Groups are user-defined subsets used to target specific fixtures in AutoScript cues.
            They differ from <span className="text-purple-400">Tiers</span>, which control automatic show behavior
            (intensity, movement, and strobe scaling in DMX cues).
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-purple-600/30 text-purple-200 rounded-lg text-xs font-semibold hover:bg-purple-600/50 active:bg-purple-600/60 flex items-center gap-1.5 transition-all border border-purple-500/30 hover:border-purple-400/60 cursor-pointer shrink-0 ml-4"
        >
          <Plus size={14} /> Create Group
        </button>
      </div>

      {fixtureGroups.length === 0 && !showCreate && (
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3 opacity-30">📦</div>
          <div className="text-sm text-gray-400 mb-1">No fixture groups yet</div>
          <div className="text-xs text-gray-600 mb-4">
            Groups let you target specific fixtures with cues and effects
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-purple-600/30 text-purple-200 rounded-lg text-xs font-medium hover:bg-purple-600/50 transition-all"
          >
            <Plus size={12} className="inline mr-1" /> Create First Group
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-[#0d0d14] border border-purple-500/30 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800/50 flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-300">New Group</span>
            <button onClick={resetCreate} className="text-gray-500 hover:text-gray-300">
              <X size={14} />
            </button>
          </div>
          <div className="p-4 space-y-4">
            {/* Name */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Front Wash, Moving Heads"
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-purple-500/50"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>

            {/* Color picker */}
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Color</label>
              <div className="flex gap-2">
                {GROUPS_PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      newColor === c ? 'border-white scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {/* Fixture multi-select */}
            <div className="space-y-2">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                Fixtures ({newFixtureIds.length} selected)
              </label>
              {patchedFixtures.length === 0 ? (
                <div className="text-xs text-gray-600 py-2">
                  No fixtures patched yet. Patch fixtures first.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1 bg-gray-800/20 rounded-lg p-2">
                  {patchedFixtures.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800/30 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={newFixtureIds.includes(f.id)}
                        onChange={() => toggleFixture(f.id, newFixtureIds, setNewFixtureIds)}
                        className="accent-purple-500 w-3.5 h-3.5"
                      />
                      <span className="text-xs text-gray-300 truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-gray-600">
                        {f.model} · {f.channelCount}ch
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={resetCreate}
                className="flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || newFixtureIds.length === 0}
                className="flex-1 px-3 py-2 bg-purple-600/30 border border-purple-500/30 rounded-lg text-xs text-purple-200 hover:bg-purple-600/50 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group cards */}
      <div className="space-y-3">
        {fixtureGroups.map((g) => {
          const isEditing = editGroupId === g.id;
          const cardColor = g.color || editColor || '#6b7280';
          return (
            <div
              key={g.id}
              className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden"
              style={{ borderLeft: `3px solid ${cardColor}` }}
            >
              {isEditing ? (
                /* Edit mode */
                <div className="p-4 space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500/50"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit(); }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">Color</label>
                    <div className="flex gap-2">
                      {GROUPS_PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setEditColor(c)}
                          className={`w-7 h-7 rounded-full border-2 transition-all ${
                            editColor === c ? 'border-white scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                      Fixtures ({editFixtureIds.length} selected)
                    </label>
                    <div className="max-h-48 overflow-y-auto space-y-1 bg-gray-800/20 rounded-lg p-2">
                      {patchedFixtures.map((f) => {
                        const fixtureId = String(f.id);
                        return (
                          <label
                            key={fixtureId}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800/30 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={editFixtureIds.includes(fixtureId)}
                              onChange={() => toggleFixture(fixtureId, editFixtureIds, setEditFixtureIds)}
                              className="accent-purple-500 w-3.5 h-3.5"
                            />
                            <span className="text-xs text-gray-300 truncate flex-1">{f.name}</span>
                            <span className="text-[10px] text-gray-600">
                              {f.model} · {f.channelCount}ch
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { removeGroup(g.id); setEditGroupId(null); }}
                      className="px-3 py-2 bg-red-600/15 text-red-300 rounded-lg text-xs hover:bg-red-600/25 transition-colors flex items-center gap-1.5"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={!editName.trim()}
                      className="px-3 py-2 bg-purple-600/30 border border-purple-500/30 rounded-lg text-xs text-purple-200 hover:bg-purple-600/50 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                /* Display mode */
                <div
                  className="p-4 flex items-center gap-3 cursor-pointer hover:bg-gray-800/10 transition-colors"
                  onClick={() => handleStartEdit(g)}
                >
                  {/* Draggable handle placeholder */}
                  <GripVertical size={16} className="text-gray-600 shrink-0" />
                  {/* Color dot */}
                  <span
                    className="w-3.5 h-3.5 rounded-sm shrink-0"
                    style={{ backgroundColor: cardColor }}
                  />
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 font-medium truncate">{g.name}</div>
                    <div className="text-xs text-gray-600">
                      {g.fixtureIds.length} fixture{g.fixtureIds.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {/* Edit hint */}
                  <span className="text-[10px] text-gray-600 hidden group-hover:inline">
                    Click to edit
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Color Utility ─────────────────────────────────────────

function lightenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, r + Math.round((255 - r) * amount));
  const lg = Math.min(255, g + Math.round((255 - g) * amount));
  const lb = Math.min(255, b + Math.round((255 - b) * amount));
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

// ─── Design Settings Panel ─────────────────────────────────

const DesignSettingsPanel: React.FC = () => {
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const showUniverses = useShowStore((s) => s.universes);
  const addShowUniverse = useShowStore((s) => s.addShowUniverse);
  const removeShowUniverse = useShowStore((s) => s.removeShowUniverse);
  const [serialPorts, setSerialPorts] = useState<any[]>([]);
  // Local mirror of universes for instant UI updates (bypasses Zustand stale-closure issues with selects)
  const [localUniverses, setLocalUniverses] = useState<ShowUniverse[]>([]);
  useEffect(() => {
    setLocalUniverses(showUniverses.map(u => ({ ...u })));
  }, [showUniverses]);
  const [portsLoading, setPortsLoading] = useState(false);
  const [dmxEngineRunning, setDmxEngineRunning] = useState(false);
  // Sync DMX engine state periodically (engine may be started by autoscript)
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const running = await window.lightMaestro.dmx.isRunning();
        if (!cancelled) setDmxEngineRunning(running);
      } catch { /* api not ready */ }
    };
    check(); // immediate
    const interval = setInterval(check, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  const refreshPorts = useCallback(async () => {
    setPortsLoading(true);
    try { const p = await window.lightMaestro.dmx.listSerialPorts(); setSerialPorts(p || []); } catch { setSerialPorts([]); }
    setPortsLoading(false);
  }, []);
  useEffect(() => { refreshPorts(); }, [refreshPorts]);
  const dmxStartingRef = useRef(false);
  const handleStartDmx = async () => {
    if (dmxStartingRef.current || dmxEngineRunning) return; // sync guard — no double-start
    dmxStartingRef.current = true;
    try {
      const running = await window.lightMaestro.dmx.isRunning();
      if (running) {
        setDmxEngineRunning(true);
        return;
      }
      // Sync showStore universes into the DMX engine before starting
      const universes = useShowStore.getState().universes;
      // Auto-detect a DMX adapter port when a usb-dmx universe has none configured
      let missingPort = universes.some((u: any) => u.type === 'usb-dmx' && !u.serialPort);
      if (missingPort) {
        try {
          const ports = await window.lightMaestro.dmx.listSerialPorts();
          const dmxPorts = (ports || []).filter(isDmxPort);
          const chosen = dmxPorts[0] || (ports && ports[0]);
          if (chosen) {
            const st = useShowStore.getState();
            st.setShowUniverses(st.universes.map((u: any) => u.type === 'usb-dmx' && !u.serialPort ? { ...u, serialPort: chosen.path } : u));
          }
        } catch { /* serial port listing unavailable */ }
      }
      const universes2 = useShowStore.getState().universes;
      for (const u of universes2) {
        try {
          await window.lightMaestro.dmx.addUniverse(universeToEngineConfig(u));
        } catch { /* already exists or not ready */ }
      }
      await window.lightMaestro.dmx.start();
      setDmxEngineRunning(true);
    } catch (e: any) {
      // Engine may already be running from autoscript — sync UI state instead
      if (e.message?.includes('already running')) {
        setDmxEngineRunning(true);
      } else {
        setSaveStatus('DMX start failed: ' + (e.message || 'Unknown'));
      }
    } finally {
      dmxStartingRef.current = false;
    }
  };

  // Auto-start DMX engine on mount (wait for universes to be ready first)
  const dmxStartAttempted = useRef(false);
  useEffect(() => {
    if (dmxStartAttempted.current) return;
    if (showUniverses.length === 0) return;
    dmxStartAttempted.current = true;
    handleStartDmx();
  }, [showUniverses.length]); // eslint-disable-line

  // Auto-detect a DMX serial port: keep polling while a usb-dmx universe has no
  // port assigned (the adapter may enumerate a few seconds after boot).
  useEffect(() => {
    let tries = 0;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || tries >= 15) return;
      tries++;
      const st = useShowStore.getState();
      const needs = st.universes.some((u: any) => u.type === 'usb-dmx' && !u.serialPort);
      if (!needs) return;
      try {
        const ports = await window.lightMaestro.dmx.listSerialPorts();
        const dmxPorts = (ports || []).filter(isDmxPort);
        const chosen = dmxPorts[0] || (ports && ports[0]);
        if (chosen) {
          const merged = st.universes.map((u: any) => u.type === 'usb-dmx' && !u.serialPort ? { ...u, serialPort: chosen.path } : u);
          st.setShowUniverses(merged);
          for (const u of merged) {
            if (u.type === 'usb-dmx') {
              window.lightMaestro.dmx.addUniverse(universeToEngineConfig(u)).catch(() => {});
            }
          }
          return;
        }
      } catch { /* ports not ready yet */ }
      setTimeout(tick, 2000);
    };
    tick();
    return () => { cancelled = true; };
  }, []);

  const handleStopDmx = async () => {
    try { await window.lightMaestro.dmx.stop(); setDmxEngineRunning(false); } catch (e: any) { setSaveStatus('DMX stop failed: ' + (e.message || 'Unknown')); }
  };
  const handleAddUniverse = () => {
    const id = 'universe-' + (showUniverses.length + 1);
    addShowUniverse({ id, name: 'Universe ' + (showUniverses.length + 1), type: 'usb-dmx', channels: 512, serialPort: '' });
  };
  const handleRemoveUniverse = (id: string) => removeShowUniverse(id);
  const handleUpdateUniverse = (id: string, updates: any) => {
    // 1. Update local state immediately → instant UI reaction (select re-renders with new value)
    setLocalUniverses(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    // 2. Push merged array to store (avoids stale closure / selector memoisation issues)
    const store = useShowStore.getState();
    const merged = store.universes.map(u => u.id === id ? { ...u, ...updates } : u);
    store.setShowUniverses(merged);
    // 3. Sync to the DMX engine right away: changing the port (or type) must
    //    start/restart the output without requiring a manual stop + start.
    const u = merged.find(x => x.id === id);
    if (u && window.lightMaestro?.dmx?.addUniverse) {
      window.lightMaestro.dmx.addUniverse(universeToEngineConfig(u)).catch(() => {});
    }
  };

  const handleSave = async () => {
    setSaveStatus(null);
    try {
      const state = useShowStore.getState();
      const project = {
        format: 'lightmaestro/design-v1',
        savedAt: new Date().toISOString(),
        scenes: state.scenes,
        chasers: state.chasers,
        cueLists: state.cueLists,
        fixtureGroups: state.fixtureGroups,
        universes: state.universes,
        patchedFixtures: state.patchedFixtures,
        fixturePositions: state.fixturePositions,
        songPresets: state.songPresets,
        effects: state.effects,
      };
      const json = JSON.stringify(project, null, 2);
      if (window.lightMaestro?.dialog?.saveFile) {
        await window.lightMaestro.dialog.saveFile(
          [{ name: 'Light Maestro Show', extensions: ['lmproject'] }],
          'show.lmproject',
          json
        );
        setSaveStatus('Show saved successfully!');
        useAppStore.getState().markClean();
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const el = document.createElement('a');
        el.href = url;
        el.download = 'show.lmproject';
        el.click();
        URL.revokeObjectURL(url);
        setSaveStatus('Show exported!');
        useAppStore.getState().markClean();
      }
    } catch (e: any) {
      setSaveStatus(`Save failed: ${e?.message || 'Unknown error'}`);
    }
  };

  const handleLoad = async () => {
    setLoadError(null);
    try {
      let content: string | null = null;
      if (window.lightMaestro?.dialog?.openFile) {
        const r = await window.lightMaestro.dialog.openFile([
          { name: 'Light Maestro Show', extensions: ['lmproject'] },
        ]);
        if (r) content = r.content;
      } else {
        content = await new Promise<string | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.lmproject';
          input.onchange = async () => {
            const file = input.files?.[0];
            resolve(file ? await file.text() : null);
          };
          input.click();
        });
      }
      if (!content) return;
      const project = JSON.parse(content);
      const state = useShowStore.getState();
      if (project.scenes) state.setScenes(project.scenes);
      if (project.chasers) state.setChasers(project.chasers);
      if (project.cueLists) state.setCueLists(project.cueLists);
      if (project.fixtureGroups) state.setFixtureGroups(project.fixtureGroups);
      if (project.patchedFixtures) state.setPatchedFixtures(project.patchedFixtures);
      if (project.universes) state.setShowUniverses(project.universes);
      if (project.fixturePositions) state.setFixturePositions(project.fixturePositions);
      if (project.songPresets) state.setSongPresets(project.songPresets);
      if (project.effects) state.setEffects(project.effects);
      // Clear selection refs
      (window as any).__lm_selectedSceneId = null;
      (window as any).__lm_selectedChaserId = null;
      setLoadError(null);
      setSaveStatus('Show loaded successfully!');
      useAppStore.getState().markClean();
    } catch (e: any) {
      setLoadError(`Load failed: ${e?.message || 'Unknown error'}`);
    }
  };

  const sceneCount = useShowStore((s) => s.scenes.length);
  const chaserCount = useShowStore((s) => s.chasers.length);
  const fixtureCount = useShowStore((s) => s.patchedFixtures.length);
  const groupCount = useShowStore((s) => s.fixtureGroups.length);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white">Design Settings</h2>

      {/* DMX Engine */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div><h3 className="text-sm font-semibold text-gray-200">DMX Engine</h3><p className="text-[10px] text-gray-500">Must be running before DMX output works</p></div>
          <div className="flex items-center gap-2">
            <span className={'w-2 h-2 rounded-full ' + (dmxEngineRunning ? 'bg-green-500' : 'bg-gray-600')} />
            <span className="text-[10px] text-gray-500">{dmxEngineRunning ? 'Running' : 'Stopped'}</span>
            {dmxEngineRunning ? (
              <button onClick={handleStopDmx} className="px-3 py-1.5 bg-red-600/30 text-red-300 rounded text-[10px] font-semibold hover:bg-red-600/50 border border-red-500/30">Stop</button>
            ) : (
              <button onClick={handleStartDmx} className="px-3 py-1.5 bg-green-600/30 text-green-300 rounded text-[10px] font-semibold hover:bg-green-600/50 border border-green-500/30">Start</button>
            )}
          </div>
        </div>
      </div>

      {/* Universes */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div><h3 className="text-sm font-semibold text-gray-200">DMX Universes</h3><p className="text-[10px] text-gray-500">Configure output: USB-DMX, ArtNet, sACN, or Virtual</p></div>
          <button onClick={handleAddUniverse} className="px-2 py-1 bg-purple-600/20 text-purple-300 rounded text-[10px] hover:bg-purple-600/30 border border-purple-500/30">+ Add</button>
        </div>
        {(localUniverses.length > 0 ? localUniverses : showUniverses).map((univ: any) => {
          const uType = univ.type || 'virtual';
          const uPort = univ.serialPort || '';
          const types = ['usb-dmx', 'artnet', 'sacn', 'virtual'] as const;
          const typeLabels: Record<string, string> = { 'usb-dmx': 'USB', artnet: 'ArtNet', sacn: 'sACN', virtual: 'Virtual' };
          const dmxPorts = serialPorts.filter(isDmxPort);
          // If no DMX-looking ports found, show ALL ports (user can pick any COM port)
          const showPorts = dmxPorts.length > 0 ? dmxPorts : serialPorts;
          return (
            <div key={univ.id} className="bg-[#12121a] border border-gray-800/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-300">{univ.name}</span>
                <div className="flex items-center gap-2">
                  <div className="flex rounded overflow-hidden border border-gray-700/50">
                    {types.map(t => (
                      <button
                        key={t}
                        onClick={() => handleUpdateUniverse(univ.id, { type: t })}
                        className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          uType === t
                            ? 'bg-purple-600 text-white'
                            : 'bg-[#0a0a0f] text-gray-500 hover:text-gray-300 hover:bg-[#1a1a25]'
                        }`}
                      >
                        {typeLabels[t]}
                      </button>
                    ))}
                  </div>
                  {showUniverses.length > 1 && <button onClick={() => handleRemoveUniverse(univ.id)} className="text-[10px] text-red-400 hover:text-red-300">✕</button>}
                </div>
              </div>
              <div className={`${uType === 'usb-dmx' ? '' : 'hidden'}`}>
                <div className="flex gap-1">
                  <select value={uPort} onChange={(e) => handleUpdateUniverse(univ.id, { serialPort: e.target.value })} className="flex-1 bg-[#0a0a0f] border border-gray-700/50 rounded px-2 py-1 text-[10px] text-gray-300">
                    <option value="">-- Select serial port --</option>
                    {showPorts.map((p: any) => <option key={p.path} value={p.path}>{p.path}{p.manufacturer ? ' - ' + p.manufacturer : ''}</option>)}
                  </select>
                  <button onClick={refreshPorts} disabled={portsLoading} className="px-2 py-1 bg-gray-800/50 text-gray-400 rounded text-[9px] hover:bg-gray-700/50" title="Refresh">{portsLoading ? '...' : '↻'}</button>
                </div>
                {!uPort && <p className="text-[9px] text-yellow-500 mt-1">⚠ Select a COM port for DMX output</p>}
              </div>
              <div className={`${uType === 'artnet' ? '' : 'hidden'}`}>
                <div className="flex gap-1"><input type="text" value={univ.artnetIP || '255.255.255.255'} onChange={(e) => handleUpdateUniverse(univ.id, { artnetIP: e.target.value })} placeholder="IP" className="flex-1 bg-[#0a0a0f] border border-gray-700/50 rounded px-2 py-1 text-[10px] text-gray-300" /><input type="number" value={univ.artnetSubnet || 0} onChange={(e) => handleUpdateUniverse(univ.id, { artnetSubnet: parseInt(e.target.value)||0 })} placeholder="Subnet" className="w-14 bg-[#0a0a0f] border border-gray-700/50 rounded px-2 py-1 text-[10px] text-gray-300" /><input type="number" value={univ.artnetUniverse || 0} onChange={(e) => handleUpdateUniverse(univ.id, { artnetUniverse: parseInt(e.target.value)||0 })} placeholder="Univ" className="w-14 bg-[#0a0a0f] border border-gray-700/50 rounded px-2 py-1 text-[10px] text-gray-300" /></div>
              </div>
              <div className={`${uType === 'sacn' ? '' : 'hidden'}`}>
                <div className="flex gap-1"><input type="number" value={univ.sacnUniverse || 1} onChange={(e) => handleUpdateUniverse(univ.id, { sacnUniverse: parseInt(e.target.value)||1 })} placeholder="Universe" className="w-20 bg-[#0a0a0f] border border-gray-700/50 rounded px-2 py-1 text-[10px] text-gray-300" /><input type="number" value={univ.sacnPriority || 100} onChange={(e) => handleUpdateUniverse(univ.id, { sacnPriority: parseInt(e.target.value)||100 })} placeholder="Priority" className="w-16 bg-[#0a0a0f] border border-gray-700/50 rounded px-2 py-1 text-[10px] text-gray-300" /></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save/Load */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-purple-600/30 text-purple-200 rounded-lg text-xs font-semibold hover:bg-purple-600/50 active:bg-purple-600/60 flex items-center gap-1.5 transition-all border border-purple-500/30 hover:border-purple-400/60"
        >
          <SaveIcon size={14} /> Save Show
        </button>
        <button
          onClick={handleLoad}
          className="px-4 py-2 bg-blue-600/20 text-blue-300 rounded-lg text-xs font-semibold hover:bg-blue-600/30 active:bg-blue-600/40 flex items-center gap-1.5 transition-all border border-blue-500/30 hover:border-blue-400/60"
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Load Show
        </button>
      </div>
      {saveStatus && (
        <div className={`text-xs px-3 py-2 rounded-lg ${
          saveStatus.includes('failed') || saveStatus.includes('Load failed')
            ? 'bg-red-900/20 border border-red-800/40 text-red-300'
            : 'bg-green-900/20 border border-green-800/40 text-green-300'
        }`}>
          {saveStatus}
        </div>
      )}
      {loadError && (
        <div className="text-xs px-3 py-2 rounded-lg bg-red-900/20 border border-red-800/40 text-red-300">
          {loadError}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 max-w-lg">
        {[
          { label: 'Scenes', value: `${sceneCount} scene${sceneCount !== 1 ? 's' : ''}` },
          { label: 'Chasers', value: `${chaserCount} chaser${chaserCount !== 1 ? 's' : ''}` },
          { label: 'Fixtures Patched', value: `${fixtureCount} fixture${fixtureCount !== 1 ? 's' : ''}` },
          { label: 'Fixture Groups', value: `${groupCount} group${groupCount !== 1 ? 's' : ''}` },
          { label: 'Default Fade In', value: '1000 ms' },
          { label: 'DMX Refresh Rate', value: '44 Hz' },
        ].map((s, i) => (
          <div key={i} className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-3 space-y-1">
            <div className="text-[10px] text-gray-500 uppercase">{s.label}</div>
            <div className="text-sm text-gray-300">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Fixture Editor Modal ────────────────────────────────

const FIXTURE_TYPES = [
  'Moving Head', 'LED PAR', 'Scanner', 'Strobe', 'Dimmer',
  'Smoke', 'Laser', 'Flower', 'Blinder', 'Wash', 'Spot', 'Beam', 'Other',
];

const CHANNEL_TYPES = [
  'Intensity', 'Pan', 'Tilt', 'Colour', 'Gobo', 'Shutter',
  'Strobe', 'Speed', 'Prism', 'Effect', 'Beam', 'Macro', 'Nothing', 'Maintenance',
];

interface EditorChannel {
  name: string;
  type: string;
  defaultValue?: number;
  capabilities?: Array<{ min: number; max: number; name: string; color?: string }>;
}

interface EditorMode {
  name: string;
  channels: EditorChannel[];
}

const FixtureEditorModal: React.FC<{ onClose: () => void; preloadedFixture?: any }> = ({ onClose, preloadedFixture }) => {
  const [tab, setTab] = useState<'create' | 'edit'>(preloadedFixture ? 'edit' : 'create');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create tab
  const [manufacturer, setManufacturer] = useState(preloadedFixture?.manufacturer || '');
  const [model, setModel] = useState(preloadedFixture?.model || '');
  const [fixtureType, setFixtureType] = useState(preloadedFixture?.type || 'Moving Head');
  const [createModes, setCreateModes] = useState<EditorMode[]>(
    preloadedFixture?.modes?.length > 0
      ? preloadedFixture.modes.map((m: any) => ({ name: m.name, channels: m.channels?.map((ch: any) => ({ name: ch.name, type: ch.type, defaultVal: ch.defaultValue ?? 0, caps: ch.capabilities?.map((c: any) => ({ min: c.min, max: c.max, name: c.name, color: c.color })) || [] })) || [] }))
      : [{ name: 'Default', channels: [] }]
  );
  // Physical properties (create tab)
  const [lampType, setLampType] = useState(preloadedFixture?.lampType || '');
  const [beamAngle, setBeamAngle] = useState(preloadedFixture?.beamAngle ?? 25);
  const [weight, setWeight] = useState(preloadedFixture?.weight ?? 0);
  const [power, setPower] = useState(preloadedFixture?.power ?? 0);
  const [width, setWidth] = useState(preloadedFixture?.width ?? 0);
  const [height, setHeight] = useState(preloadedFixture?.height ?? 0);
  const [depth, setDepth] = useState(preloadedFixture?.depth ?? 0);

  // Edit tab
  const [searchQuery, setSearchQuery] = useState('');
  const [allDefs, setAllDefs] = useState<FixtureDefResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [editManufacturer, setEditManufacturer] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editType, setEditType] = useState('');
  const [editModes, setEditModes] = useState<EditorMode[]>([]);

  // Load all defs for edit tab
  useEffect(() => {
    (async () => {
      try {
        const all = await (window.lightMaestro.fixtures as any).getAll();
        setAllDefs((all || []).map((d: any) => ({
          id: d.id, manufacturer: d.manufacturer, model: d.model,
          type: d.type, modes: d.modes || [],
        })));
      } catch { setError('Failed to load fixture library'); }
      setLoaded(true);
    })();
  }, []);

  // ESC key closes the modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = !searchQuery.trim() ? allDefs : allDefs.filter((d) =>
    (d.manufacturer || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.model || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.type || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Load a def for editing
  const handleLoadForEdit = async (id: string) => {
    setError(null); setSuccess(null);
    try {
      const full = await window.lightMaestro.fixtures.getDefinition(id);
      setSelectedEditId(id);
      setEditManufacturer(full.manufacturer || '');
      setEditModel(full.model || '');
      setEditType(full.type || '');
      setEditModes((full.modes || []).map((m: any) => ({
        name: m.name || '',
        channels: (m.channels || []).map((ch: any) => ({
          name: ch.name || '', type: ch.type || 'Nothing',
          defaultValue: ch.defaultValue,
          capabilities: ch.capabilities ? [...ch.capabilities] : undefined,
        })),
      })));
    } catch { setError('Failed to load fixture definition'); }
  };

  // Helpers
  const addMode = (target: 'create' | 'edit') => {
    const [modes, setModes] = target === 'create' ? [createModes, setCreateModes] as const : [editModes, setEditModes] as const;
    setModes([...modes, { name: `Mode ${modes.length + 1}`, channels: [] }]);
  };

  const removeMode = (target: 'create' | 'edit', idx: number) => {
    const [modes, setModes] = target === 'create' ? [createModes, setCreateModes] as const : [editModes, setEditModes] as const;
    if (modes.length <= 1) return;
    setModes(modes.filter((_, i) => i !== idx));
  };

  const setModeName = (target: 'create' | 'edit', mi: number, name: string) => {
    const [modes, setModes] = target === 'create' ? [createModes, setCreateModes] as const : [editModes, setEditModes] as const;
    setModes(modes.map((m, i) => i === mi ? { ...m, name } : m));
  };

  const addChannel = (target: 'create' | 'edit', mi: number) => {
    const [modes, setModes] = target === 'create' ? [createModes, setCreateModes] as const : [editModes, setEditModes] as const;
    setModes(modes.map((m, i) => i === mi ? { ...m, channels: [...m.channels, { name: `Channel ${m.channels.length + 1}`, type: 'Intensity' }] } : m));
  };

  const removeChannel = (target: 'create' | 'edit', mi: number, ci: number) => {
    const [modes, setModes] = target === 'create' ? [createModes, setCreateModes] as const : [editModes, setEditModes] as const;
    setModes(modes.map((m, i) => i === mi ? { ...m, channels: m.channels.filter((_, j) => j !== ci) } : m));
  };

  const updateChannel = (target: 'create' | 'edit', mi: number, ci: number, updates: Partial<EditorChannel>) => {
    const [modes, setModes] = target === 'create' ? [createModes, setCreateModes] as const : [editModes, setEditModes] as const;
    setModes(modes.map((m, i) =>
      i === mi ? { ...m, channels: m.channels.map((ch, j) => j === ci ? { ...ch, ...updates } : ch) } : m
    ));
  };

  const moveChannel = (target: 'create' | 'edit', mi: number, ci: number, dir: -1 | 1) => {
    const [modes, setModes] = target === 'create' ? [createModes, setCreateModes] as const : [editModes, setEditModes] as const;
    const ni = ci + dir;
    if (ni < 0 || ni >= modes[mi].channels.length) return;
    const chs = [...modes[mi].channels];
    [chs[ci], chs[ni]] = [chs[ni], chs[ci]];
    setModes(modes.map((m, i) => i === mi ? { ...m, channels: chs } : m));
  };

  const addCapability = (target: 'create' | 'edit', mi: number, ci: number) => {
    const [modes] = target === 'create' ? [createModes] as const : [editModes] as const;
    const ch = modes[mi].channels[ci];
    updateChannel(target, mi, ci, { capabilities: [...(ch.capabilities || []), { min: 0, max: 255, name: 'New Color', color: '#ff0000' }] });
  };

  const removeCapability = (target: 'create' | 'edit', mi: number, ci: number, capIdx: number) => {
    const [modes] = target === 'create' ? [createModes] : [editModes];
    const caps = (modes[mi].channels[ci].capabilities || []).filter((_, i) => i !== capIdx);
    updateChannel(target, mi, ci, { capabilities: caps.length ? caps : undefined });
  };

  const updateCapability = (target: 'create' | 'edit', mi: number, ci: number, capIdx: number, updates: Partial<{ min: number; max: number; name: string; color: string }>) => {
    const [modes] = target === 'create' ? [createModes] : [editModes];
    const caps = (modes[mi].channels[ci].capabilities || []).map((c, i) => i === capIdx ? { ...c, ...updates } : c);
    updateChannel(target, mi, ci, { capabilities: caps });
  };

  // Build def from form
  const buildDef = (isCreate: boolean) => {
    const mfg = isCreate ? manufacturer : editManufacturer;
    const mdl = isCreate ? model : editModel;
    const ft = isCreate ? fixtureType : editType;
    const modes = isCreate ? createModes : editModes;
    const id = `custom-${mfg.toLowerCase().replace(/\s+/g, '-')}-${mdl.toLowerCase().replace(/\s+/g, '-')}`;
    return {
      id,
      manufacturer: mfg.trim(),
      model: mdl.trim(),
      type: ft,
      modes: modes.map((m) => ({
        name: m.name || 'Default',
        channels: m.channels.map((ch) => {
          const c: any = { name: ch.name || 'Unnamed', type: ch.type };
          if (ch.defaultValue != null) c.defaultValue = ch.defaultValue;
          if (ch.capabilities?.length) c.capabilities = ch.capabilities;
          return c;
        }),
      })),
      // Physical properties
      ...(isCreate ? {
        lampType: lampType || undefined,
        beamAngle: beamAngle || undefined,
        weight: weight || undefined,
        power: power || undefined,
        width: width || undefined,
        height: height || undefined,
        depth: depth || undefined,
      } : {}),
    };
  };

  const handleSave = async (isCreate: boolean) => {
    setError(null); setSuccess(null);
    const mfg = isCreate ? manufacturer : editManufacturer;
    const mdl = isCreate ? model : editModel;
    if (!mfg.trim()) { setError('Manufacturer is required'); return; }
    if (!mdl.trim()) { setError('Model is required'); return; }
    try {
      await window.lightMaestro.fixtures.addCustom(buildDef(isCreate));
      clearFixtureDefCache(); // flush cache so new custom fixture is loaded next time
      setSuccess(`Fixture "${mfg.trim()} ${mdl.trim()}" saved!`);
      if (isCreate) {
        setManufacturer(''); setModel(''); setCreateModes([{ name: 'Default', channels: [] }]);
        setLampType(''); setBeamAngle(25); setWeight(0); setPower(0); setWidth(0); setHeight(0); setDepth(0);
      }
      // Refresh the edit-tab list
      try { const all = await (window.lightMaestro.fixtures as any).getAll();
        setAllDefs((all || []).map((d: any) => ({ id: d.id, manufacturer: d.manufacturer, model: d.model, type: d.type, modes: d.modes || [] })));
      } catch {}
      // Close modal after successful save
      setTimeout(() => onClose(), 800);
    } catch (e: any) { setError(`Save failed: ${e?.message || 'Unknown'}`); }
  };

  // ── render helpers ──
  const renderChannel = (target: 'create' | 'edit', mi: number, ch: EditorChannel, ci: number, total: number) => (
    <div key={ci} className="bg-gray-800/20 border border-gray-800/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-600 font-mono w-5 shrink-0">{ci + 1}</span>
        <input type="text" value={ch.name} onChange={(e) => updateChannel(target, mi, ci, { name: e.target.value })}
          className="flex-1 min-w-0 bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-purple-500/50" placeholder="Name" />
        <select value={ch.type} onChange={(e) => updateChannel(target, mi, ci, { type: e.target.value })}
          className="bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none shrink-0">
          {CHANNEL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="number" value={ch.defaultValue ?? ''} onChange={(e) => {
          const v = e.target.value === '' ? undefined : Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
          updateChannel(target, mi, ci, { defaultValue: v });
        }} placeholder="Def" className="w-14 bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none shrink-0" />
        <button onClick={() => moveChannel(target, mi, ci, -1)} disabled={ci === 0}
          className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-20 shrink-0" title="Move up">▲</button>
        <button onClick={() => moveChannel(target, mi, ci, 1)} disabled={ci === total - 1}
          className="p-1 text-gray-500 hover:text-gray-300 disabled:opacity-20 shrink-0" title="Move down">▼</button>
        <button onClick={() => removeChannel(target, mi, ci)} className="p-1 text-gray-500 hover:text-red-400 shrink-0" title="Remove channel"><X size={14} /></button>
      </div>
      {ch.type === 'Colour' && (
        <div className="ml-7 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Colors</span>
            <button onClick={() => addCapability(target, mi, ci)}
              className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
              <Plus size={10} /> Add
            </button>
          </div>
          {(ch.capabilities || []).map((cap, cci) => (
            <div key={cci} className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-600 w-5 shrink-0">{cci + 1}</span>
              <input type="number" value={cap.min} onChange={(e) => updateCapability(target, mi, ci, cci, { min: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
                className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="0" />
              <span className="text-[9px] text-gray-600">–</span>
              <input type="number" value={cap.max} onChange={(e) => updateCapability(target, mi, ci, cci, { max: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
                className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="255" />
              <input type="text" value={cap.name} onChange={(e) => updateCapability(target, mi, ci, cci, { name: e.target.value })}
                className="flex-1 min-w-0 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 outline-none" placeholder="Color name" />
              <input type="color" value={cap.color || '#ff0000'} onChange={(e) => updateCapability(target, mi, ci, cci, { color: e.target.value })}
                className="w-6 h-5 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0" />
              <button onClick={() => removeCapability(target, mi, ci, cci)} className="text-gray-500 hover:text-red-400 shrink-0" title="Remove color"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      {ch.type === 'Gobo' && (
        <div className="ml-7 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Gobo Patterns</span>
            <button onClick={() => addCapability(target, mi, ci)}
              className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
              <Plus size={10} /> Add
            </button>
          </div>
          {(ch.capabilities || []).map((cap, cci) => (
            <div key={cci} className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-600 w-5 shrink-0">{cci + 1}</span>
              <input type="number" value={cap.min} onChange={(e) => updateCapability(target, mi, ci, cci, { min: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
                className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="0" />
              <span className="text-[9px] text-gray-600">–</span>
              <input type="number" value={cap.max} onChange={(e) => updateCapability(target, mi, ci, cci, { max: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
                className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="255" />
              <input type="text" value={cap.name} onChange={(e) => updateCapability(target, mi, ci, cci, { name: e.target.value })}
                className="flex-1 min-w-0 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 outline-none" placeholder="Gobo name" />
              <button onClick={() => removeCapability(target, mi, ci, cci)} className="text-gray-500 hover:text-red-400 shrink-0" title="Remove gobo"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      {ch.type === 'Macro' && (
        <div className="ml-7 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-500 uppercase tracking-wider">Macros</span>
            <button onClick={() => addCapability(target, mi, ci)}
              className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
              <Plus size={10} /> Add
            </button>
          </div>
          {(ch.capabilities || []).map((cap, cci) => (
            <div key={cci} className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-600 w-5 shrink-0">{cci + 1}</span>
              <input type="number" value={cap.min} onChange={(e) => updateCapability(target, mi, ci, cci, { min: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
                className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="0" />
              <span className="text-[9px] text-gray-600">–</span>
              <input type="number" value={cap.max} onChange={(e) => updateCapability(target, mi, ci, cci, { max: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
                className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="255" />
              <input type="text" value={cap.name} onChange={(e) => updateCapability(target, mi, ci, cci, { name: e.target.value })}
                className="flex-1 min-w-0 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 outline-none" placeholder="Macro name" />
              <button onClick={() => removeCapability(target, mi, ci, cci)} className="text-gray-500 hover:text-red-400 shrink-0" title="Remove macro"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const modes = tab === 'create' ? createModes : editModes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[680px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Fixture Editor</h3>
          <span className="text-[10px] text-gray-600">Fill all fields then save</span>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex gap-1 border-b border-gray-800/30">
          {(['create', 'edit'] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setError(null); setSuccess(null); }}
              className={`px-4 py-2 rounded-t-lg text-xs font-medium transition-colors ${
                tab === t ? 'bg-purple-600/20 text-purple-300 border-t border-l border-r border-purple-500/30' : 'text-gray-500 hover:text-gray-300'
              }`}>
              {t === 'create' ? 'Create New' : 'Edit Existing'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-300">
              <AlertTriangle size={14} className="shrink-0" />{error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-900/20 border border-green-800/40 rounded-lg text-xs text-green-300">
              <Check size={14} className="shrink-0" />{success}
            </div>
          )}

          {tab === 'create' ? (
            /* ── CREATE NEW TAB ── */
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Manufacturer</label>
                  <input type="text" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}
                    className="w-full bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-purple-500/50" placeholder="e.g. Chauvet" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Model</label>
                  <input type="text" value={model} onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-purple-500/50" placeholder="e.g. Intimidator 150" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Type</label>
                  <select value={fixtureType} onChange={(e) => setFixtureType(e.target.value)}
                    className="w-full bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 outline-none">
                    {FIXTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Physical Properties (collapsible) */}
              <details className="bg-[#0d0d14] border border-gray-800/50 rounded-lg overflow-hidden">
                <summary className="px-3 py-2 cursor-pointer text-[10px] text-gray-500 uppercase tracking-wider hover:text-gray-300 select-none">
                  Physical Properties ▾
                </summary>
                <div className="p-3 grid grid-cols-3 gap-3 border-t border-gray-800/30">
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-600">Lamp Type</label>
                    <input type="text" value={lampType} onChange={(e) => setLampType(e.target.value)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" placeholder="e.g. LED 60W" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-600">Beam Angle (°)</label>
                    <input type="number" value={beamAngle || ''} onChange={(e) => setBeamAngle(parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" placeholder="25" min="0" max="360" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-600">Weight (kg)</label>
                    <input type="number" value={weight || ''} onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" placeholder="0" min="0" step="0.1" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-600">Power (W)</label>
                    <input type="number" value={power || ''} onChange={(e) => setPower(parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" placeholder="0" min="0" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-600">Width (mm)</label>
                    <input type="number" value={width || ''} onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" placeholder="0" min="0" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-600">Height (mm)</label>
                    <input type="number" value={height || ''} onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" placeholder="0" min="0" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-gray-600">Depth (mm)</label>
                    <input type="number" value={depth || ''} onChange={(e) => setDepth(parseInt(e.target.value) || 0)}
                      className="w-full bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" placeholder="0" min="0" />
                  </div>
                </div>
              </details>

              {createModes.map((mode, mi) => (
                <div key={mi} className="bg-[#0d0d14] border border-gray-800/50 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-800/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500">Mode {mi + 1}</span>
                      <input type="text" value={mode.name} onChange={(e) => setModeName('create', mi, e.target.value)}
                        className="bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none w-32" placeholder="Name" />
                      <span className="text-[10px] text-gray-600">{mode.channels.length} ch</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => addChannel('create', mi)}
                        className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-purple-600/10">
                        <Plus size={10} /> Channel
                      </button>
                      {createModes.length > 1 && (
                        <button onClick={() => removeMode('create', mi)} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-600/10">Remove</button>
                      )}
                    </div>
                  </div>
                  <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
                    {mode.channels.length === 0 ? (
                      <div className="text-[10px] text-gray-600 text-center py-4">No channels — click &quot;+ Channel&quot; to add</div>
                    ) : mode.channels.map((ch, ci) => renderChannel('create', mi, ch, ci, mode.channels.length))}
                  </div>
                </div>
              ))}
              <button onClick={() => addMode('create')}
                className="w-full px-3 py-2 border border-dashed border-gray-700 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors">
                <Plus size={12} className="inline mr-1" /> Add Mode
              </button>
            </div>
          ) : (
            /* ── EDIT EXISTING TAB ── */
            <div className="space-y-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by manufacturer, model, or type…"
                  className="w-full bg-gray-800/50 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-purple-500/50" />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {!loaded && <div className="text-xs text-gray-500 text-center py-4">Loading fixtures…</div>}
                {loaded && filtered.length === 0 && <div className="text-xs text-gray-600 text-center py-4">No fixtures found</div>}
                {filtered.slice(0, 50).map((def) => (
                  <button key={def.id} onClick={() => handleLoadForEdit(def.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center justify-between ${
                      selectedEditId === def.id ? 'bg-purple-600/10 border border-purple-500/30' : 'hover:bg-gray-800/30'
                    }`}>
                    <div>
                      <div className="text-xs text-gray-200">{def.manufacturer} {def.model}</div>
                      <div className="text-[10px] text-gray-500">{def.type} · {def.modes.length} mode{def.modes.length !== 1 ? 's' : ''}</div>
                    </div>
                    <ChevronDown size={12} className="text-gray-600 -rotate-90" />
                  </button>
                ))}
              </div>

              {selectedEditId && editModes.length > 0 && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">Manufacturer</label>
                      <input type="text" value={editManufacturer} onChange={(e) => setEditManufacturer(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-purple-500/50" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">Model</label>
                      <input type="text" value={editModel} onChange={(e) => setEditModel(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-200 outline-none focus:border-purple-500/50" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-500 uppercase tracking-wider">Type</label>
                      <select value={editType} onChange={(e) => setEditType(e.target.value)}
                        className="w-full bg-gray-800/50 border border-gray-700 rounded px-3 py-1.5 text-xs text-gray-300 outline-none">
                        {FIXTURE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  {editModes.map((mode, mi) => (
                    <div key={mi} className="bg-[#0d0d14] border border-gray-800/50 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 border-b border-gray-800/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500">Mode {mi + 1}</span>
                          <input type="text" value={mode.name} onChange={(e) => setModeName('edit', mi, e.target.value)}
                            className="bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none w-32" placeholder="Name" />
                          <span className="text-[10px] text-gray-600">{mode.channels.length} ch</span>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => addChannel('edit', mi)}
                            className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-purple-600/10">
                            <Plus size={10} /> Channel
                          </button>
                          {editModes.length > 1 && (
                            <button onClick={() => removeMode('edit', mi)} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-600/10">Remove</button>
                          )}
                        </div>
                      </div>
                      <div className="p-3 space-y-2 max-h-60 overflow-y-auto">
                        {mode.channels.length === 0 ? (
                          <div className="text-[10px] text-gray-600 text-center py-4">No channels — click &quot;+ Channel&quot; to add</div>
                        ) : mode.channels.map((ch, ci) => renderChannel('edit', mi, ch, ci, mode.channels.length))}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => addMode('edit')}
                    className="w-full px-3 py-2 border border-dashed border-gray-700 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors">
                    <Plus size={12} className="inline mr-1" /> Add Mode
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800/50 flex items-center justify-between">
          <span className="text-[10px] text-gray-600">Fixture saved to user data folder</span>
          <button onClick={() => handleSave(tab === 'create')}
            className="px-5 py-2 bg-purple-600/30 border border-purple-500/30 rounded-lg text-xs text-purple-200 hover:bg-purple-600/50 transition-colors font-medium flex items-center gap-1.5">
            <Save size={12} />
            Save Fixture
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Param Field ───────────────────────────────────────────

const ParamField: React.FC<{ label: string; value: number; unit: string; onChange: (v: number) => void }> =
  ({ label, value, unit, onChange }) => (
    <div className="space-y-1">
      <label className="block text-[10px] text-gray-500 uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-1">
        <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50" />
        <span className="text-[10px] text-gray-600">{unit}</span>
      </div>
    </div>
  );

// ─── Réseau sACN (Network Monitor) ─────────────────────────
// Monitoring de ce qui part (émetteur sACN) et de ce qui arrive
// (récepteur sACN, merge HTP des sources externes) par univers.
// Données : dmx.getStatus().network (poll 1s). Le toggle réception
// pilote l'API dmx:setSacnReceive côté moteur.

const fmtNetTime = (ts: number): string =>
  ts > 0 ? new Date(ts).toLocaleTimeString() : '—';

const fmtNetPackets = (n: number): string => n.toLocaleString('fr-FR');

const NetDot: React.FC<{ ok: boolean; off?: boolean; title: string }> = ({ ok, off, title }) => (
  <span
    title={title}
    className={`inline-block w-2 h-2 rounded-full shrink-0 ${
      off ? 'bg-gray-700' : ok ? 'bg-green-500' : 'bg-red-500'
    }`}
  />
);

const NetworkMonitor: React.FC = () => {
  const [network, setNetwork] = useState<{ enabled: boolean; errors: string[]; universes: any[] } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await (window as any).lightMaestro?.dmx?.getStatus?.();
        if (alive && s?.network) setNetwork(s.network);
      } catch { /* engine not available — keep last state */ }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const toggleReceive = async (universeId: string, enabled: boolean) => {
    setToggling(universeId);
    try {
      const s = await (window as any).lightMaestro?.dmx?.setSacnReceive?.(universeId, enabled);
      if (s?.network) setNetwork(s.network);
    } catch { /* engine off */ }
    finally { setToggling(null); }
  };

  const universes = network?.universes ?? [];

  return (
    <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-800/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-gray-400">Réseau sACN</span>
          <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className={`inline-block w-2 h-2 rounded-full ${network?.enabled ? 'bg-green-500' : 'bg-gray-700'}`} />
            {network?.enabled ? 'récepteur actif' : 'récepteur inactif'}
          </span>
          <span className="text-[10px] text-gray-600">ce qui part (émission) · ce qui arrive (réception, merge HTP)</span>
        </div>
        {!!network?.errors?.length && (
          <span className="flex items-center gap-1 text-[10px] text-red-400">
            <AlertTriangle size={11} /> {network.errors.length} erreur(s)
          </span>
        )}
      </div>

      {universes.length === 0 ? (
        <div className="p-4 text-center text-xs text-gray-600">
          Aucun univers sACN configuré — le monitoring réseau s'affiche ici pour les univers de type sACN.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/30 text-[10px] text-gray-500 uppercase tracking-wider">
                <th className="text-left px-4 py-2 font-medium">Univers</th>
                <th className="text-left px-4 py-2 font-medium">Émission (part)</th>
                <th className="text-left px-4 py-2 font-medium">Réception (arrive)</th>
                <th className="text-left px-4 py-2 font-medium">Sources reçues</th>
                <th className="text-right px-4 py-2 font-medium">Réception</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/20">
              {universes.map((u) => (
                <tr key={u.universeId} className="hover:bg-gray-800/20 transition-colors align-top">
                  {/* Univers */}
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-200">{u.name}</div>
                    <div className="text-[10px] text-gray-600 font-mono">U{u.universe} · prio {u.priority}</div>
                  </td>

                  {/* Émission */}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <NetDot ok={!!u.txActive && !!u.outputEnabled} title={u.txActive && u.outputEnabled ? 'Émission active' : 'Émission inactive'} />
                      <span className={u.txActive && u.outputEnabled ? 'text-gray-300' : 'text-gray-600'}>
                        {u.txActive && u.outputEnabled ? `${u.txFps} fps` : 'inactif'}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      {fmtNetPackets(u.txPackets)} paquets · dernière {fmtNetTime(u.txLastSendAt)}
                    </div>
                  </td>

                  {/* Réception */}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <NetDot ok={!!u.receiving} off={!u.receiveEnabled} title={!u.receiveEnabled ? 'Réception désactivée' : u.receiving ? 'Réception active' : 'Aucune trame reçue'} />
                      <span className={!u.receiveEnabled ? 'text-gray-600' : u.receiving ? 'text-gray-300' : 'text-red-400'}>
                        {!u.receiveEnabled ? 'désactivée' : u.receiving ? `${u.rxFps} fps` : 'aucune trame'}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      {u.rxPps} paquets/s · {fmtNetPackets(u.rxPackets)} reçus · dernière trame {fmtNetTime(u.rxLastFrameAt)}
                      {u.mergeOutput && <span className="text-purple-400/80"> · merge HTP → sortie</span>}
                    </div>
                  </td>

                  {/* Sources */}
                  <td className="px-4 py-2">
                    {u.sources.length === 0 ? (
                      <span className="text-[10px] text-gray-600">—</span>
                    ) : (
                      <div className="space-y-1">
                        {u.sources.map((s: any) => (
                          <div key={s.cid} className="flex items-center gap-1.5 text-[10px]">
                            <NetDot ok={!!s.active} title={s.active ? 'Source active' : 'Source inactive (timeout)'} />
                            <span className={s.active ? 'text-gray-300' : 'text-gray-600'}>
                              {s.name || 'inconnue'}
                            </span>
                            <span className="text-gray-600">{s.address}</span>
                            <span className="text-gray-600">prio {s.priority}</span>
                            <span className={s.active ? 'text-gray-500' : 'text-gray-700'}>
                              {s.active ? `${s.fps} fps` : 'timeout'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>

                  {/* Toggle réception */}
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => toggleReceive(u.universeId, !u.receiveEnabled)}
                      disabled={toggling === u.universeId}
                      title={u.receiveEnabled ? 'Désactiver la réception' : 'Activer la réception'}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all border cursor-pointer ${
                        u.receiveEnabled
                          ? 'bg-green-500/15 text-green-300 border-green-500/30 hover:bg-green-500/25'
                          : 'bg-gray-800/40 text-gray-500 border-gray-700 hover:bg-gray-700/40 hover:text-gray-300'
                      } ${toggling === u.universeId ? 'opacity-50' : ''}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${u.receiveEnabled ? 'bg-green-400' : 'bg-gray-600'}`} />
                      {u.receiveEnabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!network?.errors?.length && (
        <div className="px-4 py-2 border-t border-gray-800/50 space-y-0.5">
          {network.errors.slice(-5).map((e, i) => (
            <div key={i} className="text-[10px] text-red-400/80 flex items-center gap-1.5">
              <AlertTriangle size={10} className="shrink-0" /> {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

