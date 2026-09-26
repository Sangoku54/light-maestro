/**
 * Perform Store — Virtual Console & Simple Desk state
 *
 * Holds widget layout, pages, grid settings for the Virtual Console
 * and per-universe channel data for the Simple Desk.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MtcState } from '@electron/midi/mtc';
import { dmxBridge } from '../utils/dmx-bridge';
import type { LoopRecipe } from '../engine/auto-loops';
import { useAppStore } from './appStore';
import { useShowStore } from './showStore';
import { buildAkaiSurfaceWidgets, type AkaiSurfacePreset } from './vc-presets';

/**
 * Effets DMX d'un fader de la Console Virtuelle (appelé à la fois par le
 * widget glissé à la souris et par un contrôleur MIDI en miroir).
 * `sourceId` permet à chaque source (vc / midi) de garder sa propre
 * contribution dans l'arbitrage `dmxBridge`.
 */
export function applyWidgetSliderEffect(
  config: ConsoleWidgetConfig,
  value: number,
  sourceId = 'vc',
): void {
  try {
    if (config.sliderFunction === 'grandMaster') {
      if (typeof window !== 'undefined') {
        (window as any)?.lightMaestro?.dmx?.applyGrandMaster(value / 255);
      }
      return;
    }
    if (config.sliderFunction === 'channel' && config.channelAddress) {
      // Merge per source+universe so two sliders on the same universe don't
      // drop each other (write-replace would keep only the last one).
      // NB : univers = index moteur (0 = première univers du projet).
      dmxBridge.writeMerge(sourceId, config.sliderUniverse ?? 0, {
        [config.channelAddress]: value,
      });
    }
  } catch { /* pas de matériel DMX (tests / aperçu) */ }
}

/**
 * Resolve the DMX engine universe index (0-based) for a Simple Desk universe id.
 * Prefers the canonical showStore universe list; falls back to legacy numeric ids.
 */
function resolveUniverseIndex(sdUniverseId: string): number {
  try {
    const universes = useShowStore.getState().universes || [];
    const idx = universes.findIndex((u: any) => String(u.id) === String(sdUniverseId));
    if (idx >= 0) return idx;
  } catch { /* showStore unavailable */ }
  const n = parseInt(String(sdUniverseId).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? Math.max(0, n - 1) : 0;
}

// ─── Types ─────────────────────────────────────────────────

export type WidgetType = 'button' | 'slider' | 'frame';

export type ButtonActionType =
  | 'scene'
  | 'chaser'
  | 'showSequence'
  | 'blackout'
  | 'grandMaster'
  | 'flashScene'
  | 'go'
  | 'audioPlayPause'
  | 'dmxChannel'
  | 'loadShow'
  | 'playSong'
  | 'audioAutoScript'
  | 'autoLoop';

export type SliderFunctionType =
  | 'channel'
  | 'grandMaster'
  | 'chaseSpeed'
  | 'sceneFadeTime'
  | 'audioVolume';

export interface ConsoleWidgetConfig {
  // Button
  actionType?: ButtonActionType;
  sceneId?: string;
  chaserId?: string;
  showId?: string;
  showName?: string;
  showData?: any;
  cueListId?: string;
  songId?: string;
  songName?: string;
  dmxUniverse?: number;
  dmxAddress?: number;
  dmxValue?: number;
  grandMasterValue?: number;
  // Audio + AutoScript
  audioDataUrl?: string;
  audioFileName?: string;
  audioAnalysis?: any;
  audioCues?: any[];
  audioDuration?: number;
  autoScriptConfig?: any;
  // Auto loop (boucle du catalogue)
  autoLoopRecipe?: LoopRecipe;
  // Style
  color?: string;
  label?: string;
  flashMode?: 'flash' | 'toggle';
  // Slider
  channelAddress?: number;
  sliderUniverse?: number;
  sliderFunction?: SliderFunctionType;
  min?: number;
  max?: number;
  step?: number;
  // Frame
  title?: string;
  collapsed?: boolean;
  soloMode?: boolean;
  radioGroup?: boolean;
}

export interface ConsoleWidget {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  config: ConsoleWidgetConfig;
  frameId?: string;
  pageIndex: number;
}

export interface VirtualConsolePage {
  name: string;
}

// ─── Helpers ───────────────────────────────────────────────

function generateWidgetId(): string {
  return `vcw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_COLORS: Record<string, string> = {
  scene: '#a855f7',
  chaser: '#22c55e',
  blackout: '#ef4444',
  frame: '#3b82f6',
  slider: '#f59e0b',
};

// ─── Store ─────────────────────────────────────────────────

interface PerformState {
  // Virtual Console
  vcPages: VirtualConsolePage[];
  vcActivePage: number;
  vcWidgets: ConsoleWidget[];
  vcGridSnap: boolean;
  addingWidget: WidgetType | null;

  // Simple Desk
  sdUniverseId: string;
  sdChannelValues: Record<string, Record<number, number>>; // universeId -> channel -> value
  sdSelectedChannel: number | null;
  sdHighlightActive: boolean;
  sdClipboard: Record<number, number> | null;

  // MTC (lot #15) — état courant reçu du main (miroir UI, non persisté)
  mtcState: MtcState;
  setMtcState: (state: MtcState) => void;

  // VC Actions
  vcAddPage: (name?: string) => void;
  vcDeletePage: (index: number) => void;
  vcRenamePage: (index: number, name: string) => void;
  vcSetActivePage: (index: number) => void;
  vcAddWidget: (widget: Omit<ConsoleWidget, 'id'>) => string;
  vcUpdateWidget: (id: string, updates: Partial<ConsoleWidget>) => void;
  vcDeleteWidget: (id: string) => void;
  vcDuplicateWidget: (id: string) => void;
  vcSetGridSnap: (snap: boolean) => void;
  vcSetWidgets: (widgets: ConsoleWidget[]) => void;
  vcSetPages: (pages: VirtualConsolePage[]) => void;
  vcSetAddingWidget: (type: WidgetType | null) => void;
  /** Valeur courante d'un fader (runtime, non persistée) — miroir MIDI inclus. */
  vcWidgetValues: Record<string, number>;
  vcSetWidgetValue: (id: string, value: number) => void;
  /** Page pré-programmée type Akai MIDIMIX (frame + pads + faders). */
  vcAddAkaiSurfacePage: (preset: AkaiSurfacePreset) => number;

  // Simple Desk Actions
  sdSetChannelValue: (channel: number, value: number) => void;
  sdSetBulkChannelValues: (values: Record<number, number>) => void;
  sdSetSelectedChannel: (channel: number | null) => void;
  sdSetHighlightActive: (active: boolean) => void;
  sdResetAll: () => void;
  sdCopyUniverse: () => void;
  sdPasteUniverse: () => void;
  sdSetUniverseId: (id: string) => void;
}

export const usePerformStore = create<PerformState>()(
  persist(
    (set, get) => ({
  vcPages: [{ name: 'Main' }, { name: 'Spots' }, { name: 'Wash' }],
  vcActivePage: 0,
  vcWidgets: [],
  vcGridSnap: true,
  addingWidget: null,
  vcWidgetValues: {},

  sdUniverseId: 'u1',
  sdChannelValues: {},
  sdSelectedChannel: null,
  sdHighlightActive: false,
  sdClipboard: null,

  mtcState: {
    locked: false,
    hours: 0,
    minutes: 0,
    seconds: 0,
    frames: 0,
    rate: '30',
    fps: 30,
    lastSource: 'qf',
  },
  setMtcState: (state) => set({ mtcState: state }),

  // ── Virtual Console ──

  vcAddPage: (name) => {
    const pageName = name || `Page ${get().vcPages.length + 1}`;
    set((s) => ({ vcPages: [...s.vcPages, { name: pageName }] }));
    useAppStore.getState().markDirty();
  },

  vcDeletePage: (index) => {
    const { vcPages, vcWidgets, vcActivePage } = get();
    if (vcPages.length <= 1) return;
    const newPages = vcPages.filter((_, i) => i !== index);
    const newWidgets = vcWidgets.filter((w) => w.pageIndex !== index)
      .map((w) => ({
        ...w,
        pageIndex: w.pageIndex > index ? w.pageIndex - 1 : w.pageIndex,
      }));
    const newActive = Math.min(vcActivePage, newPages.length - 1);
    set({ vcPages: newPages, vcWidgets: newWidgets, vcActivePage: newActive });
    useAppStore.getState().markDirty();
  },

  vcSetActivePage: (index) => set({ vcActivePage: index }),

  vcRenamePage: (index, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    set((s) => ({
      vcPages: s.vcPages.map((p, i) => (i === index ? { ...p, name: trimmed } : p)),
    }));
    useAppStore.getState().markDirty();
  },

  vcAddWidget: (widget) => {
    const id = generateWidgetId();
    const newWidget: ConsoleWidget = { ...widget, id };
    set((s) => ({ vcWidgets: [...s.vcWidgets, newWidget] }));
    useAppStore.getState().markDirty();
    return id;
  },

  vcUpdateWidget: (id, updates) => {
    set((s) => ({
      vcWidgets: s.vcWidgets.map((w) => (w.id === id ? { ...w, ...updates } : w)),
    }));
    useAppStore.getState().markDirty();
  },

  vcDeleteWidget: (id) => {
    set((s) => ({
      vcWidgets: s.vcWidgets.filter((w) => w.id !== id),
    }));
    useAppStore.getState().markDirty();
  },

  vcDuplicateWidget: (id) => {
    const { vcWidgets } = get();
    const original = vcWidgets.find((w) => w.id === id);
    if (!original) return;
    const newId = generateWidgetId();
    const copy: ConsoleWidget = {
      ...original,
      id: newId,
      x: original.x + 20,
      y: original.y + 20,
    };
    set((s) => ({ vcWidgets: [...s.vcWidgets, copy] }));
    useAppStore.getState().markDirty();
  },

  vcSetGridSnap: (snap) => set({ vcGridSnap: snap }),

  vcSetWidgets: (widgets) => {
    set({ vcWidgets: widgets });
    useAppStore.getState().markDirty();
  },

  vcSetPages: (pages) => {
    set({ vcPages: pages });
    useAppStore.getState().markDirty();
  },

  vcSetAddingWidget: (type) => set({ addingWidget: type }),

  vcSetWidgetValue: (id, value) =>
    set((s) => ({ vcWidgetValues: { ...s.vcWidgetValues, [id]: value } })),

  vcAddAkaiSurfacePage: (preset) => {
    const pageIndex = get().vcPages.length;
    const widgets = buildAkaiSurfaceWidgets(preset, pageIndex, generateWidgetId);
    set((s) => ({
      vcPages: [...s.vcPages, { name: 'Akai MIDIMIX' }],
      vcWidgets: [...s.vcWidgets, ...widgets],
      vcActivePage: pageIndex,
    }));
    useAppStore.getState().markDirty();
    return pageIndex;
  },

  // ── Simple Desk ──

  sdSetChannelValue: (channel, value) => {
    const { sdUniverseId, sdChannelValues } = get();
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    const uniValues = { ...(sdChannelValues[sdUniverseId] || {}), [channel]: clamped };
    set({
      sdChannelValues: { ...sdChannelValues, [sdUniverseId]: uniValues },
    });
    // Send to DMX output through the output arbiter (Simple Desk is the
    // highest-priority LTP control source). Send the FULL current channel
    // map (not just this channel) so moving fader A then fader B keeps both
    // — the arbiter's write() replaces the source's whole contribution.
    try {
      const universeNum = resolveUniverseIndex(sdUniverseId);
      dmxBridge.write('simple-desk', universeNum, uniValues);
    } catch { /* DMX output not available in browser dev */ }
  },

  sdSetBulkChannelValues: (values) => {
    const { sdUniverseId, sdChannelValues } = get();
    const uniValues = { ...(sdChannelValues[sdUniverseId] || {}) };
    for (const [ch, val] of Object.entries(values)) {
      uniValues[Number(ch)] = Math.max(0, Math.min(255, Math.round(val)));
    }
    set({
      sdChannelValues: { ...sdChannelValues, [sdUniverseId]: uniValues },
    });
    // Send to DMX output through the output arbiter
    try {
      const universeNum = resolveUniverseIndex(sdUniverseId);
      dmxBridge.write('simple-desk', universeNum, uniValues);
    } catch { /* */ }
  },

  sdSetSelectedChannel: (channel) => set({ sdSelectedChannel: channel }),

  sdSetHighlightActive: (active) => set({ sdHighlightActive: active }),

  sdResetAll: () => {
    const { sdUniverseId, sdChannelValues } = get();
    const blank: Record<number, number> = {};
    set({
      sdChannelValues: { ...sdChannelValues, [sdUniverseId]: blank },
    });
    // Send all-zero to DMX through the output arbiter, TRANSIENT: release
    // after 2 s so the playback engine regains control (a persistent LTP
    // zero block would keep the show dark forever after a simple reset).
    try {
      const universeNum = resolveUniverseIndex(sdUniverseId);
      const allZero: Record<number, number> = {};
      for (let i = 1; i <= 512; i++) allZero[i] = 0;
      dmxBridge.writeTransient('simple-desk', universeNum, allZero);
    } catch { /* */ }
  },

  sdCopyUniverse: () => {
    const { sdUniverseId, sdChannelValues } = get();
    set({ sdClipboard: { ...(sdChannelValues[sdUniverseId] || {}) } });
  },

  sdPasteUniverse: () => {
    const { sdClipboard, sdUniverseId, sdChannelValues } = get();
    if (!sdClipboard) return;
    set({
      sdChannelValues: { ...sdChannelValues, [sdUniverseId]: { ...sdClipboard } },
    });
    // Send to DMX through the output arbiter
    try {
      const universeNum = resolveUniverseIndex(sdUniverseId);
      dmxBridge.write('simple-desk', universeNum, sdClipboard);
    } catch { /* */ }
  },

  sdSetUniverseId: (id) => set({ sdUniverseId: id, sdSelectedChannel: null }),
}),
{
  name: 'light-maestro-perform',
  partialize: (state) => ({
    vcPages: state.vcPages,
    vcActivePage: state.vcActivePage,
    vcGridSnap: state.vcGridSnap,
    // vcWidgets are persisted inside the project file, not localStorage
  }),
  onRehydrateStorage: () => (state, error) => {
    if (!error && state && Array.isArray((state as any).vcWidgets)) {
      (state as any).vcWidgets = [];
    }
  },
}
)
);
