/**
 * Global state management with Zustand
 *
 * Three modes (autoscript / manual / hybrid):
 * - quick: DJ-friendly, minimal controls, auto-script focus
 * - design: Full editor, scenes, chasers, cue lists
 * - perform: Virtual Console, MIDI control, live performance
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppMode = 'quick' | 'design' | 'perform';

// Sidebar tab keys per mode
export type QuickSidebarTab = 'autoscript' | 'efx' | 'colors' | 'loops';
export type DesignSidebarTab = 'fixtures' | 'groups' | 'scenes' | 'chasers' | 'show' | 'cuelists' | 'rgbmatrix' | 'efx' | 'stage' | 'settings';
export type PerformSidebarTab = 'vconsole' | 'midi' | 'remote' | 'mtc' | 'osc' | 'simpledesk' | 'stage' | 'cuelist' | 'settings';
export type SidebarTab = QuickSidebarTab | DesignSidebarTab | PerformSidebarTab;

// Custom color palette per section type
export interface CustomPalette {
  intro: string[];
  verse: string[];
  chorus: string[];
  bridge: string[];
  drop: string[];
  outro: string[];
  build: string[];
}

// Color preset (built-in or user-created)
export interface ColorPreset {
  id: string;
  name: string;
  colors: string[];
  builtin?: boolean;
}

// QuickShow control state (was local useState, now persistent)
export interface QuickShowTierConfig {
  primary: number;   // 100 = 100% in QuickShow UX, divided by 100 in DMX engine
  secondary: number; // 70 = 70%
  tertiary: number;  // 40 = 40%
}

export interface QuickShowState {
  audioActive: boolean;
  intensity: 'low' | 'medium' | 'high' | 'dynamic';
  colorScheme: string;
  musicStyle: string;
  movement: 'smooth' | 'sharp' | 'dynamic';
  beatDivision: 1 | 2 | 4 | 8;
  strobeLimit: number;
  panMaxDeg?: number; // pan sweep half-limit in degrees (0-270), default 270 = full
  tiltMaxDeg?: number; // tilt sweep half-limit in degrees (0-90), default 90 = full
  forcedPanMaxDeg?: Record<string, number>; // per-fixture pan half-limit override (key = fixture id)
  forcedTiltMaxDeg?: Record<string, number>; // per-fixture tilt half-limit override (key = fixture id)
  sectionAware: boolean;
  audioFileName: string;
  customPalette: CustomPalette;
  colorPresets: ColorPreset[];
  userPreset: string[];
  tierConfig: QuickShowTierConfig;
  forcedColors: Record<string, string>;
  forcedDimmer: Record<string, number>;
  forcedStrobe: Record<string, boolean>;
  audioReactive: boolean;
  showColorTrack: boolean;
  showStrobeTrack: boolean;
  showDimmerTrack: boolean;
  colorFadeMs: number; // 0-2000ms crossfade between palette colors
  customGradients: Record<string, { start: string; end: string }>;
  gradientPresets: Array<{ id: string; name: string; start: string; end: string }>;
  colorEntries: Array<{ id: string; time: number; endTime: number; color: string }>;
  dimmerEntries: Array<{ id: string; time: number; endTime: number; value: number }>;
  strobeEntries: Array<{ id: string; time: number; endTime: number; speed: number }>;
  useScenesInAutoscript: boolean;
  scenesAutoscriptWeight: number; // 0-100
}

// Live scene overrides (faders in Performance view) — applied on top of scene playback
export interface SceneLiveOverrides {
  masterDimmer: number;           // 0-255, global dimmer multiplier
  panTiltSpeedMul: number;        // 0.1-2.0, multiplies pan/tilt movement speed
  effectSpeedMul: number;         // 0.1-2.0, multiplies effect/chase speeds
  strobeSpeedMul: number;         // 0.1-2.0, multiplies strobe speeds
  perFixtureDimmer: Record<string, number>; // 0-255 per fixture
  /** Couleur maîtresse (#rrggbb) appliquée à TOUTES les fixtures RGB en un clic. null = désactivé. */
  masterColor: string | null;
  // Widget persistence
  savedWidgets: Array<{
    id: string;
    name: string;
    overrides: SceneLiveOverrides;
    createdAt: number;
  }>;
}

interface DMXState {
  running: boolean;
  blackout: boolean;
  grandMaster: number; // 0-255
  panTiltMaxSpeed: number; // max pan/tilt angular speed simulated in 3D (°/s), matches real fixture motors
  universes: Array<{
    id: string;
    name: string;
    type: string;
    output: boolean;
    channels: number;
  }>;
  channelData: Record<number, Uint8Array | number[]>; // universe → 512 channels
}

interface FixtureState {
  library: any[];           // All fixture definitions
  searchResults: any[];     // Filtered results
  selected: string | null;  // Selected fixture definition ID
  instances: Array<{
    id: string;
    definitionId: string;
    name: string;
    startAddress: number;
    universe: number;
    modeIndex: number;
    position: { x: number; y: number };
  }>;
}

interface ShowState {
  current: any | null;      // Currently loaded show
  dirty: boolean;           // Unsaved changes
  filePath: string | null;
  recentShows: string[];
}

interface AudioState {
  analyzing: boolean;
  deviceId: string | null;
  analysis: any | null;
  bpm: number;
}

interface AppState {
  mode: AppMode;

  // Active sidebar tab per mode
  quickSidebarTab: QuickSidebarTab;
  designSidebarTab: DesignSidebarTab;
  performSidebarTab: PerformSidebarTab;

  // QuickShow controls (persistent)
  quickShow: QuickShowState;

  dmx: DMXState;
  fixtures: FixtureState;
  show: ShowState;
  audio: AudioState;

  // Scene live overrides (faders in Performance view)
  sceneLiveOverrides: SceneLiveOverrides;

  // Unsaved changes tracking (NOT persisted - resets on reload)
  isDirty: boolean;
  dirtyAt: number;
  markDirty: () => void;
  markClean: () => void;

  // Photosensibilité : avertissement accepté (persisté — affiché une fois)
  safetyAccepted: boolean;
  acceptSafety: () => void;

  // Vue 3D : avertissement responsabilité accepté (persisté — affiché une fois)
  disclaimerAccepted: boolean;
  acceptDisclaimer: () => void;

  // Project identity (NOT persisted - session-only)
  projectName: string;
  setProjectName: (name: string) => void;
  presetName: string;
  setPresetName: (name: string) => void;

  // Actions
  setMode: (mode: AppMode) => void;
  setQuickSidebarTab: (tab: QuickSidebarTab) => void;
  setDesignSidebarTab: (tab: DesignSidebarTab) => void;
  setPerformSidebarTab: (tab: PerformSidebarTab) => void;
  setQuickShow: (partial: Partial<QuickShowState>) => void;
  setCustomPalette: (partial: Partial<CustomPalette>) => void;
  clearCustomPalette: () => void;
  addColorPreset: (name: string, colors: string[]) => string;
  updateColorPreset: (id: string, patch: Partial<Pick<ColorPreset, 'name' | 'colors'>>) => void;
  deleteColorPreset: (id: string) => void;
  setUserPreset: (colors: string[]) => void;
  setDMXRunning: (running: boolean) => void;
  setBlackout: (blackout: boolean) => void;
  setGrandMaster: (value: number) => void;
  setPanTiltMaxSpeed: (value: number) => void;
  setChannelValue: (universe: number, channel: number, value: number) => void;
  setUniverseData: (universe: number, values: Record<number, number>) => void;
  // Scene live overrides (faders)
  setSceneLiveOverrides: (partial: Partial<SceneLiveOverrides>) => void;
  resetSceneLiveOverrides: () => void;
  saveSceneOverridesWidget: (name: string) => void;
  loadSceneOverridesWidget: (widgetId: string) => void;
  deleteSceneOverridesWidget: (widgetId: string) => void;
  setAudioAnalysis: (analysis: any) => void;
  setAudioRunning: (running: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      mode: 'quick',

      quickSidebarTab: 'autoscript',
      designSidebarTab: 'scenes',
      performSidebarTab: 'vconsole',

      quickShow: {
        audioActive: false,
        audioFileName: '',
        intensity: 'dynamic',
        colorScheme: 'auto',
        musicStyle: 'dance',
        movement: 'dynamic',
        beatDivision: 2,
        strobeLimit: 10,
        panMaxDeg: 270,
        tiltMaxDeg: 90,
        forcedPanMaxDeg: {},
        forcedTiltMaxDeg: {},
        sectionAware: true,
        audioReactive: true,
        customPalette: {
          intro: [], verse: [], chorus: [], bridge: [],
          drop: [], outro: [], build: [],
        },
        colorPresets: [],
        userPreset: ['#ff5000', '#ff8c00', '#ffc832'],
        tierConfig: {
          primary: 100,
          secondary: 70,
          tertiary: 40,
        },
        forcedColors: {},
        forcedDimmer: {},
        forcedStrobe: {},
        showColorTrack: false,
        showStrobeTrack: false,
        showDimmerTrack: false,
        colorFadeMs: 250,
        customGradients: {},
        gradientPresets: [],
        colorEntries: [],
        dimmerEntries: [],
        strobeEntries: [],
        useScenesInAutoscript: false,
        scenesAutoscriptWeight: 30,
      },

      dmx: {
        running: false,
        blackout: false,
        grandMaster: 255,
        panTiltMaxSpeed: 120,
        universes: [
          { id: 'u1', name: 'Universe 1', type: 'virtual', output: true, channels: 512 },
        ],
        channelData: {},
      },

      // Live scene overrides (faders in Performance view) — applied on top of scene playback
      sceneLiveOverrides: {
        masterDimmer: 255,
        panTiltSpeedMul: 1.0,
        effectSpeedMul: 1.0,
        strobeSpeedMul: 1.0,
        perFixtureDimmer: {},
        masterColor: null,
        savedWidgets: [],
      } as SceneLiveOverrides,

      fixtures: {
        library: [],
        searchResults: [],
        selected: null,
        instances: [],
      },

      show: {
        current: null,
        dirty: false,
        filePath: null,
        recentShows: [],
      },

      audio: {
        analyzing: false,
        deviceId: null,
        analysis: null,
        bpm: 0,
      },

      isDirty: false,
      dirtyAt: 0,
      markDirty: () => set({ isDirty: true, dirtyAt: Date.now() }),
      markClean: () => set({ isDirty: false, dirtyAt: 0 }),

      safetyAccepted: false,
      acceptSafety: () => set({ safetyAccepted: true }),

      disclaimerAccepted: false,
      acceptDisclaimer: () => set({ disclaimerAccepted: true }),

      projectName: '',
      setProjectName: (name) => set({ projectName: name }),
      presetName: '',
      setPresetName: (name) => set({ presetName: name }),

      setMode: (mode) => set({ mode }),
      setQuickSidebarTab: (tab) => set({ quickSidebarTab: tab }),
      setDesignSidebarTab: (tab) => set({ designSidebarTab: tab }),
      setPerformSidebarTab: (tab) => set({ performSidebarTab: tab }),
      setQuickShow: (partial) =>
        set((state) => {
          // Detect if this is a full replacement (preset restore) vs partial update.
          // A full QuickShowState object has all keys; a partial update has only a few.
          const partialKeys = Object.keys(partial);
          const isFullReplace =
            partialKeys.length >= 8 ||
            ('intensity' in partial && 'colorScheme' in partial && 'movement' in partial && 'strobeLimit' in partial);

          if (isFullReplace) {
            // Full replacement - use the preset state directly, ensuring all nested
            // objects have safe defaults in case the preset is from an older version.
            const incoming = partial as any;
            return {
              quickShow: {
                audioActive: incoming.audioActive ?? state.quickShow.audioActive,
                audioFileName: incoming.audioFileName ?? '',
                intensity: incoming.intensity ?? 'dynamic',
                colorScheme: incoming.colorScheme ?? 'auto',
                musicStyle: incoming.musicStyle ?? 'dance',
                movement: incoming.movement ?? 'dynamic',
                beatDivision: incoming.beatDivision ?? 2,
                strobeLimit: incoming.strobeLimit ?? 10,
                panMaxDeg: incoming.panMaxDeg ?? 270,
                tiltMaxDeg: incoming.tiltMaxDeg ?? 90,
                sectionAware: incoming.sectionAware ?? true,
                customPalette: incoming.customPalette ?? { intro: [], verse: [], chorus: [], bridge: [], drop: [], outro: [], build: [] },
                colorPresets: Array.isArray(incoming.colorPresets) ? incoming.colorPresets : [],
                userPreset: Array.isArray(incoming.userPreset) ? incoming.userPreset : ['#ff5000', '#ff8c00', '#ffc832'],
                // Migration: handle both old (primaryMultiplier) and new (primary) property names
                tierConfig: incoming.tierConfig
                  ? {
                      primary: (incoming.tierConfig as any).primary ?? (incoming.tierConfig as any).primaryMultiplier ?? 100,
                      secondary: (incoming.tierConfig as any).secondary ?? (incoming.tierConfig as any).secondaryMultiplier ?? 70,
                      tertiary: (incoming.tierConfig as any).tertiary ?? (incoming.tierConfig as any).tertiaryMultiplier ?? 40,
                    }
                  : { primary: 100, secondary: 70, tertiary: 40 },
                forcedColors: incoming.forcedColors || {},
                forcedDimmer: incoming.forcedDimmer || {},
                forcedStrobe: incoming.forcedStrobe || {},
                forcedPanMaxDeg: incoming.forcedPanMaxDeg || {},
                forcedTiltMaxDeg: incoming.forcedTiltMaxDeg || {},
                showColorTrack: incoming.showColorTrack ?? false,
                showStrobeTrack: incoming.showStrobeTrack ?? false,
                showDimmerTrack: incoming.showDimmerTrack ?? false,
                audioReactive: incoming.audioReactive ?? true,
                colorFadeMs: incoming.colorFadeMs ?? 250,
                customGradients: incoming.customGradients ?? {},
                gradientPresets: Array.isArray(incoming.gradientPresets) ? incoming.gradientPresets : [],
                colorEntries: Array.isArray(incoming.colorEntries) ? incoming.colorEntries : [],
                dimmerEntries: Array.isArray(incoming.dimmerEntries) ? incoming.dimmerEntries : [],
                strobeEntries: Array.isArray(incoming.strobeEntries) ? incoming.strobeEntries : [],
              },
            };
          }

          // Partial update - merge into current state
          return {
            quickShow: {
              ...state.quickShow,
              colorPresets: state.quickShow.colorPresets || [],
              customPalette: state.quickShow.customPalette || {},
              ...partial,
            },
          };
        }),

      setCustomPalette: (partial) =>
        set((state) => ({
          quickShow: {
            ...state.quickShow,
            customPalette: { ...state.quickShow.customPalette, ...partial },
          },
        })),

      clearCustomPalette: () =>
        set((state) => ({
          quickShow: {
            ...state.quickShow,
            customPalette: {
              intro: [], verse: [], chorus: [], bridge: [],
              drop: [], outro: [], build: [],
            },
          },
        })),

      addColorPreset: (name, colors) => {
        const id = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        set((state) => ({
          quickShow: {
            ...state.quickShow,
            colorPresets: [...state.quickShow.colorPresets, { id, name, colors }],
          },
        }));
        return id;
      },

      updateColorPreset: (id, patch) =>
        set((state) => ({
          quickShow: {
            ...state.quickShow,
            colorPresets: state.quickShow.colorPresets.map((p) =>
              p.id === id ? { ...p, ...patch } : p
            ),
          },
        })),

      deleteColorPreset: (id) =>
        set((state) => ({
          quickShow: {
            ...state.quickShow,
            colorPresets: state.quickShow.colorPresets.filter((p) => p.id !== id),
          },
        })),

      setUserPreset: (colors) =>
        set((state) => ({
          quickShow: { ...state.quickShow, userPreset: colors },
        })),

      setDMXRunning: (running) =>
        set((state) => ({ dmx: { ...state.dmx, running } })),

      setBlackout: (blackout) =>
        set((state) => ({ dmx: { ...state.dmx, blackout } })),

      setGrandMaster: (value) =>
        set((state) => ({ dmx: { ...state.dmx, grandMaster: value } })),

      setPanTiltMaxSpeed: (value) =>
        set((state) => ({ dmx: { ...state.dmx, panTiltMaxSpeed: Math.max(20, Math.min(720, value)) } })),

      setChannelValue: (universe, channel, value) => {
        const { dmx } = get();
        const raw = dmx.channelData || {};
        const prev = (raw as any)[universe];
        let data: Uint8Array;
        if (prev instanceof Uint8Array) {
          data = prev;
        } else if (prev && typeof prev === 'object') {
          // Records 1-based (adresse DMX → valeur), possiblement creux :
          // expansion explicite, jamais Object.values() qui compacterait.
          data = new Uint8Array(512);
          for (const k in prev as Record<number, number>) {
            const ch = Number(k);
            if (ch >= 1 && ch <= 512) data[ch - 1] = (prev as any)[k];
          }
        } else {
          data = new Uint8Array(512);
        }
        data[channel - 1] = value;
        set({ dmx: { ...dmx, channelData: { ...(raw as any), [universe]: data } } });
      },

      setUniverseData: (universe: number, values: Record<number, number>) => {
        const { dmx } = get();
        const raw = dmx.channelData || {};
        const prev = (raw as any)[universe];
        let data: Uint8Array;
        if (prev instanceof Uint8Array) {
          data = prev; // mutate in-place — avoids 512-byte copy per frame
        } else if (prev && typeof prev === 'object') {
          // Records 1-based (adresse DMX → valeur), possiblement creux :
          // expansion explicite, jamais Object.values() qui compacterait.
          data = new Uint8Array(512);
          for (const k in prev as Record<number, number>) {
            const ch = Number(k);
            if (ch >= 1 && ch <= 512) data[ch - 1] = (prev as any)[k];
          }
        } else {
          data = new Uint8Array(512);
        }
        for (const chStr in values) {
          const idx = Number(chStr) - 1;
          if (idx >= 0 && idx < 512) data[idx] = values[chStr];
        }
        set({ dmx: { ...dmx, channelData: { ...(raw as any), [universe]: data } } });
      },

      // Scene live overrides (faders) — applied on top of scene/efx playback
      setSceneLiveOverrides: (partial: Partial<SceneLiveOverrides>) =>
        set((state) => ({
          sceneLiveOverrides: { ...state.sceneLiveOverrides, ...partial },
        })),

      resetSceneLiveOverrides: () =>
        set({
          sceneLiveOverrides: {
            masterDimmer: 255,
            panTiltSpeedMul: 1.0,
            effectSpeedMul: 1.0,
            strobeSpeedMul: 1.0,
            perFixtureDimmer: {},
            masterColor: null,
            savedWidgets: [],
          } as SceneLiveOverrides,
        }),

      saveSceneOverridesWidget: (name: string) =>
        set((state) => {
          const widget = {
            id: `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            overrides: { ...state.sceneLiveOverrides },
            createdAt: Date.now(),
          };
          // Remove the widget from savedWidgets before adding (to avoid duplication of the whole state)
          const { savedWidgets, ...overridesToSave } = state.sceneLiveOverrides;
          return {
            sceneLiveOverrides: {
              ...overridesToSave,
              savedWidgets: [...savedWidgets, widget],
            },
          };
        }),

      loadSceneOverridesWidget: (widgetId: string) =>
        set((state) => {
          const widget = state.sceneLiveOverrides.savedWidgets.find(w => w.id === widgetId);
          if (!widget) return state;
          const { savedWidgets, ...overrides } = widget.overrides;
          return {
            sceneLiveOverrides: {
              ...overrides,
              savedWidgets: state.sceneLiveOverrides.savedWidgets,
            },
          };
        }),

      deleteSceneOverridesWidget: (widgetId: string) =>
        set((state) => ({
          sceneLiveOverrides: {
            ...state.sceneLiveOverrides,
            savedWidgets: state.sceneLiveOverrides.savedWidgets.filter(w => w.id !== widgetId),
          },
        })),

      setAudioAnalysis: (analysis) =>
        set((state) => ({
          audio: {
            ...state.audio,
            analysis,
            bpm: analysis?.bpm || state.audio.bpm,
          },
        })),

      setAudioRunning: (running) =>
        set((state) => ({
          audio: { ...state.audio, analyzing: running },
        })),
    }),
    {
      name: 'light-maestro-store',
      partialize: (state) => ({
        mode: state.mode,
        quickShow: state.quickShow,
        quickSidebarTab: state.quickSidebarTab,
        designSidebarTab: state.designSidebarTab,
        performSidebarTab: state.performSidebarTab,
        safetyAccepted: state.safetyAccepted,
        disclaimerAccepted: state.disclaimerAccepted,
        dmx: {
          universes: state.dmx.universes,
          grandMaster: state.dmx.grandMaster,
          panTiltMaxSpeed: state.dmx.panTiltMaxSpeed,
        },
        show: {
          recentShows: state.show.recentShows,
        },
      }),
      merge: (persisted: any, current: any) => ({
        ...current,
        ...persisted,
        dmx: {
          ...current.dmx,
          ...(persisted.dmx || {}),
          channelData: current.dmx.channelData || {}, // Map - never overwritten by stale JSON
        },
      }),
    }
  )
);
