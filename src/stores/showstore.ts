/**
 * Show Store — DMX fixture patch state management
 *
 * Holds the current show's patched fixtures and universe configuration.
 * Validates against address overlaps and universe boundaries.
 */

import { create } from 'zustand';
import type { DmxCue } from '../hooks/dmx-cues';

// ─── Types ─────────────────────────────────────────────────

export type FixtureTier = 'primary' | 'secondary' | 'tertiary';

export interface PatchedFixture {
  id: string;
  fixtureDefId: string;
  manufacturer: string;
  model: string;
  fixtureType: string;
  modeIndex: number;
  modeName: string;
  universeId: string;
  startAddress: number;
  channelCount: number;
  name: string;
  tier: FixtureTier;
  thumbnailId?: string; // variant id from fixtureThumbnails
}

export interface ShowUniverse {
  id: string;
  name: string;
  type: string;
  channels: number;
  serialPort?: string;
  artnetIP?: string;
  artnetSubnet?: number;
  artnetUniverse?: number;
  sacnUniverse?: number;
  sacnPriority?: number;
}

export interface FixtureGroup {
  id: string;
  name: string;
  fixtureIds: string[];
  color?: string;
}

// ─── Scene Types ───────────────────────────────────────────

export interface SavedScene {
  id: string;
  name: string;
  channels: Record<number, number>; // DMX address → value (0-255)
  fadeIn: number;   // ms
  fadeOut: number;  // ms
  duration: number; // ms (0 = infinite/hold)
  createdAt: string;
}

// ─── Show Manager Types ──────────────────────────────────

export interface ShowTrackItem {
  id: string;
  startTime: number;  // milliseconds
  duration: number;
  resourceId: string; // sceneId, chaserId, songPresetId
  fadeIn: number;
  fadeOut: number;
  name: string;
  audioFileBase64?: string; // base64 data URL for audio tracks
}

export interface ShowTrack {
  id: string;
  name: string;
  type: 'scene' | 'chaser' | 'efx' | 'audio';
  items: ShowTrackItem[];
  muted: boolean;
  solo: boolean;
}

export interface ShowData {
  id: string;
  name: string;
  duration: number;
  tracks: ShowTrack[];
  audioFileBase64?: string;
  audioFileName?: string;
}

// ─── Chaser Types ──────────────────────────────────────────

export interface ChaserStep {
  sceneId: string;
  fadeIn: number;  // ms
  hold: number;    // ms
  fadeOut: number; // ms
}

export interface SavedChaser {
  id: string;
  name: string;
  steps: ChaserStep[];
  direction: 'forward' | 'backward' | 'bounce';
  speed: number; // BPM
}

// ─── EFX Types ───────────────────────────────────────────

export type EfxPattern = 'Circle' | 'Line' | 'Eight' | 'Square' | 'Triangle';

export interface SavedEffect {
  id: string;
  name: string;
  pattern: EfxPattern;
  width: number;
  height: number;
  rotation: number;
  speed: number;
  xOffset: number;
  yOffset: number;
  fixtureIds: string[];
  createdAt: string;
}

// ─── Cue List Types (Theater-style sequential playback) ────

export interface CueListCue {
  id: string;
  sceneId: string;
  fadeIn: number;  // ms
  hold: number;     // ms
  fadeOut: number;  // ms
  note?: string;
}

export interface FixturePos {
  x: number; // normalized 0-1 (stage width)
  y: number; // normalized 0-1 (stage depth)
  h: number; // height multiplier (0-1, maps to 0-5m range)
  heading: number; // rotation in degrees (0-360), 0=front (toward audience)
  tilt?: number; // static tilt in degrees (-90 to +90)
  beamAngle?: number; // beam opening angle in radians (0.02-0.8)
  mountMode?: 'top' | 'ground' | 'rear'; // beam direction: top=down, ground=up, rear=forward
}

export interface SongPreset {
  id: string;
  name: string;
  audioFileBase64: string;
  audioFileName: string;
  dmxCues: DmxCue[];
  quickShow: any;
  trackAnalysis: any;
  sections: any[];
  efxTracks?: any[];
  manualCues?: DmxCue[];
  createdAt: string;
}

export interface SavedCueList {
  id: string;
  name: string;
  cues: CueListCue[];
  currentCueIndex: number;
}

// ─── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return `fx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateSceneId(): string {
  return `scn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateChaserId(): string {
  return `chs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateCueListId(): string {
  return `cl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateEffectId(): string {
  return `efx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateCueId(): string {
  return `cue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateTrackId(): string {
  return `trk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateTrackItemId(): string {
  return `tmi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateShowId(): string {
  return `show-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DMX_MAX_ADDRESS = 512;

interface ShowState {
  patchedFixtures: PatchedFixture[];
  universes: ShowUniverse[];

  // Actions
  patchFixture: (
    fixture: Omit<PatchedFixture, 'id'>
  ) => { id: string } | { error: string };
  moveFixture: (id: string, newAddress: number) => { error?: string };
  getFixturesByTier: (universeId: string, tier: FixtureTier) => PatchedFixture[];
  unpatchFixture: (id: string) => void;
  setFixtureName: (id: string, name: string) => void;
  setPatchedFixtures: (fixtures: PatchedFixture[]) => void;
  addShowUniverse: (config: ShowUniverse) => void;
  updateShowUniverse: (id: string, updates: Partial<ShowUniverse>) => void;
  removeShowUniverse: (id: string) => void;
  setShowUniverses: (universes: ShowUniverse[]) => void;
  getUniverseMap: (universeId: string) => Map<number, PatchedFixture>;
  getNextFreeAddress: (universeId: string, neededChannels: number, quantity?: number) => number;
  getFixtureById: (id: string) => PatchedFixture | undefined;

  // Fixture positions (shared between Stage2D and Stage3D)
  fixturePositions: Record<string, FixturePos>;
  setFixturePosition: (id: string, pos: Partial<FixturePos>) => void;
  setFixturePositions: (positions: Record<string, FixturePos>) => void;
  initFixturePosition: (id: string, fixtureType: string, index: number) => void;

  // Fixture groups
  fixtureGroups: FixtureGroup[];
  addGroup: (name: string, fixtureIds: string[], color?: string) => string;
  removeGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  updateGroupFixtures: (groupId: string, fixtureIds: string[]) => void;
  getGroupsByUniverse: (universeId: string) => FixtureGroup[];
  setFixtureGroups: (groups: FixtureGroup[]) => void;

  // Scenes
  scenes: SavedScene[];
  createScene: (name: string) => string;
  updateScene: (id: string, updates: Partial<Pick<SavedScene, 'name' | 'channels' | 'fadeIn' | 'fadeOut' | 'duration'>>) => void;
  deleteScene: (id: string) => void;
  getScene: (id: string) => SavedScene | undefined;
  setScenes: (scenes: SavedScene[]) => void;
  getSceneCount: () => number;

  // Chasers
  chasers: SavedChaser[];
  createChaser: (name: string) => string;
  updateChaser: (id: string, updates: Partial<Pick<SavedChaser, 'name' | 'steps' | 'direction' | 'speed'>>) => void;
  deleteChaser: (id: string) => void;
  getChaser: (id: string) => SavedChaser | undefined;
  setChasers: (chasers: SavedChaser[]) => void;
  getChaserCount: () => number;

  // Effects (EFX)
  effects: SavedEffect[];
  createEffect: (name: string) => string;
  updateEffect: (id: string, updates: Partial<Omit<SavedEffect, 'id' | 'createdAt'>>) => void;
  deleteEffect: (id: string) => void;
  getEffect: (id: string) => SavedEffect | undefined;
  setEffects: (effects: SavedEffect[]) => void;

  // Cue Lists (theater-style sequential playback)
  cueLists: SavedCueList[];
  createCueList: (name: string) => string;
  updateCueList: (id: string, updates: Partial<SavedCueList>) => void;
  deleteCueList: (id: string) => void;
  getCueList: (id: string) => SavedCueList | undefined;
  setCueLists: (cueLists: SavedCueList[]) => void;
  getCueListCount: () => number;

  // Shows (Show Manager)
  shows: ShowData[];
  createShow: (name: string) => string;
  updateShow: (id: string, updates: Partial<ShowData>) => void;
  deleteShow: (id: string) => void;
  getShow: (id: string) => ShowData | undefined;
  setShows: (shows: ShowData[]) => void;
  getShowCount: () => number;

  // Song Presets (Jukebox)
  songPresets: SongPreset[];
  addSongPreset: (preset: Omit<SongPreset, 'id' | 'createdAt'>) => string;
  removeSongPreset: (id: string) => void;
  updateSongPreset: (id: string, updates: Partial<SongPreset>) => void;
  setSongPresets: (presets: SongPreset[]) => void;
}

// ─── Store ─────────────────────────────────────────────────

export const useShowStore = create<ShowState>((set, get) => ({
  patchedFixtures: [],
  universes: [],

  patchFixture: (fixture) => {
    const { patchedFixtures } = get();

    // Validate address boundaries
    if (fixture.startAddress < 1 || fixture.startAddress > DMX_MAX_ADDRESS) {
      return {
        error: `Start address must be 1–${DMX_MAX_ADDRESS}, got ${fixture.startAddress}`,
      };
    }

    const endAddress = fixture.startAddress + fixture.channelCount - 1;
    if (endAddress > DMX_MAX_ADDRESS) {
      return {
        error: `Fixture addresses ${fixture.startAddress}–${endAddress} exceed universe boundary (max ${DMX_MAX_ADDRESS})`,
      };
    }

    // Check for overlap with existing fixtures on the same universe
    for (const pf of patchedFixtures) {
      if (pf.universeId !== fixture.universeId) continue;
      const pfEnd = pf.startAddress + pf.channelCount - 1;
      if (fixture.startAddress <= pfEnd && endAddress >= pf.startAddress) {
        return {
          error: `Address overlap: "${pf.name}" occupies ${pf.startAddress}–${pfEnd}, conflicts with ${fixture.startAddress}–${endAddress}`,
        };
      }
    }

    const id = generateId();
    const newFixture: PatchedFixture = { ...fixture, id };
    set({ patchedFixtures: [...patchedFixtures, newFixture] });
    // Mark project dirty
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return { id };
  },

  getFixturesByTier: (universeId, tier) => {
    return get().patchedFixtures.filter(
      (f) => f.universeId === universeId && f.tier === tier
    );
  },

  unpatchFixture: (id) => {
    set((state) => ({
      patchedFixtures: state.patchedFixtures.filter((f) => f.id !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  setFixtureName: (id, name) => {
    set((state) => ({
      patchedFixtures: state.patchedFixtures.map((f) =>
        f.id === id ? { ...f, name } : f
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  moveFixture: (id, newAddress) => {
    const { patchedFixtures } = get();
    const fixture = patchedFixtures.find((f) => f.id === id);
    if (!fixture) return { error: 'Fixture not found' };

    if (newAddress < 1 || newAddress > DMX_MAX_ADDRESS) {
      return { error: `Address must be 1–${DMX_MAX_ADDRESS}` };
    }

    const endAddress = newAddress + fixture.channelCount - 1;
    if (endAddress > DMX_MAX_ADDRESS) {
      return { error: `End address ${endAddress} exceeds maximum ${DMX_MAX_ADDRESS}` };
    }

    // Check overlap with OTHER fixtures (exclude self)
    for (const pf of patchedFixtures) {
      if (pf.id === id || pf.universeId !== fixture.universeId) continue;
      const pfEnd = pf.startAddress + pf.channelCount - 1;
      if (newAddress <= pfEnd && endAddress >= pf.startAddress) {
        return { error: `Overlap with "${pf.name}" (${pf.startAddress}–${pfEnd})` };
      }
    }

    set((state) => ({
      patchedFixtures: state.patchedFixtures.map((f) =>
        f.id === id ? { ...f, startAddress: newAddress } : f
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return {};
  },

  setPatchedFixtures: (fixtures) => {
    set({ patchedFixtures: fixtures });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  setShowUniverses: (universes) => {
    set({ universes });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  addShowUniverse: (config) =>
    set((state) => {
      // Deduplicate by id
      if (state.universes.some((u) => u.id === config.id)) return state;
      try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
      return {
        universes: [
          ...state.universes,
          {
            id: config.id,
            name: config.name,
            type: config.type,
            channels: config.channels ?? DMX_MAX_ADDRESS,
            serialPort: config.serialPort || '',
            artnetIP: config.artnetIP || '',
            artnetSubnet: config.artnetSubnet ?? 0,
            artnetUniverse: config.artnetUniverse ?? 0,
            sacnUniverse: config.sacnUniverse ?? 1,
            sacnPriority: config.sacnPriority ?? 100,
          },
        ],
      };
    }),

  removeShowUniverse: (id) => {
    set((state) => ({
      universes: state.universes.filter((u) => u.id !== id),
      patchedFixtures: state.patchedFixtures.filter((f) => f.universeId !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  updateShowUniverse: (id, updates) => {
    set((state) => ({
      universes: state.universes.map((u) =>
        u.id === id ? { ...u, ...updates } : u
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getUniverseMap: (universeId) => {
    const map = new Map<number, PatchedFixture>();
    const { patchedFixtures } = get();
    for (const pf of patchedFixtures) {
      if (pf.universeId !== universeId) continue;
      for (let i = 0; i < pf.channelCount; i++) {
        map.set(pf.startAddress + i, pf);
      }
    }
    return map;
  },

  getNextFreeAddress: (universeId, neededChannels, quantity = 1) => {
    const totalSpan = neededChannels * quantity;
    const { patchedFixtures } = get();
    const universeFixtures = patchedFixtures
      .filter((f) => f.universeId === universeId)
      .sort((a, b) => a.startAddress - b.startAddress);

    let nextAddr = 1;
    for (const pf of universeFixtures) {
      if (nextAddr + totalSpan - 1 < pf.startAddress) {
        return nextAddr;
      }
      nextAddr = Math.max(nextAddr, pf.startAddress + pf.channelCount);
    }

    if (nextAddr + totalSpan - 1 <= DMX_MAX_ADDRESS) {
      return nextAddr;
    }

    return -1; // No room
  },

  getFixtureById: (id) => {
    return get().patchedFixtures.find((f) => f.id === id);
  },

  // ── Fixture Positions ──
  fixturePositions: {},

  setFixturePosition: (id, pos) => {
    set((state) => ({
      fixturePositions: {
        ...state.fixturePositions,
        [id]: { ...(state.fixturePositions[id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 }), ...pos },
      },
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  setFixturePositions: (positions) => {
    set({ fixturePositions: positions });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  initFixturePosition: (id, fixtureType, index) => {
    set((state) => {
      if (state.fixturePositions[id]) return state;
      const col = index % 6;
      const row = Math.floor(index / 6);
      const isOverhead = fixtureType === 'moving_head' || fixtureType === 'scanner';
      return {
        fixturePositions: {
          ...state.fixturePositions,
          [id]: {
            x: 0.1 + col * 0.16,
            y: 0.1 + row * 0.18,
            h: isOverhead ? 0.6 : 0.3,
            heading: 0,
          },
        },
      };
    });
  },

  // ── Fixture Groups ──
  fixtureGroups: [],

  addGroup: (name, fixtureIds, color) => {
    const id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const group: FixtureGroup = { id, name, fixtureIds, color };
    set((state) => ({ fixtureGroups: [...state.fixtureGroups, group] }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return id;
  },

  removeGroup: (groupId) => {
    set((state) => ({
      fixtureGroups: state.fixtureGroups.filter((g) => g.id !== groupId),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  renameGroup: (groupId, name) => {
    set((state) => ({
      fixtureGroups: state.fixtureGroups.map((g) =>
        g.id === groupId ? { ...g, name } : g
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  updateGroupFixtures: (groupId, fixtureIds) => {
    set((state) => ({
      fixtureGroups: state.fixtureGroups.map((g) =>
        g.id === groupId ? { ...g, fixtureIds } : g
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getGroupsByUniverse: (universeId) => {
    const { fixtureGroups, patchedFixtures } = get();
    // Build a set of fixture IDs on the given universe
    const universeFixtureIds = new Set(
      patchedFixtures
        .filter((f) => f.universeId === universeId)
        .map((f) => f.id)
    );
    return fixtureGroups.filter((g) =>
      g.fixtureIds.some((fid) => universeFixtureIds.has(fid))
    );
  },

  setFixtureGroups: (groups) => {
    set({ fixtureGroups: groups });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  // ── Scenes ──
  scenes: [],

  createScene: (name) => {
    const id = generateSceneId();
    const scene: SavedScene = {
      id,
      name: name.trim() || `Scene ${get().scenes.length + 1}`,
      channels: {},
      fadeIn: 1000,
      fadeOut: 1000,
      duration: 5000,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ scenes: [...state.scenes, scene] }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return id;
  },

  updateScene: (id, updates) => {
    set((state) => ({
      scenes: state.scenes.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  deleteScene: (id) => {
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getScene: (id) => {
    return get().scenes.find((s) => s.id === id);
  },

  setScenes: (scenes) => {
    set({ scenes });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getSceneCount: () => get().scenes.length,

  // ── Chasers ──
  chasers: [],

  createChaser: (name) => {
    const id = generateChaserId();
    const chaser: SavedChaser = {
      id,
      name: name.trim() || `Chaser ${get().chasers.length + 1}`,
      steps: [],
      direction: 'forward',
      speed: 120,
    };
    set((state) => ({ chasers: [...state.chasers, chaser] }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return id;
  },

  updateChaser: (id, updates) => {
    set((state) => ({
      chasers: state.chasers.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  deleteChaser: (id) => {
    set((state) => ({
      chasers: state.chasers.filter((c) => c.id !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getChaser: (id) => {
    return get().chasers.find((c) => c.id === id);
  },

  setChasers: (chasers) => {
    set({ chasers });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getChaserCount: () => get().chasers.length,

  // ── Effects (EFX) ──
  effects: [],

  createEffect: (name) => {
    const id = generateEffectId();
    const effect: SavedEffect = {
      id,
      name: name.trim() || `EFX ${get().effects.length + 1}`,
      pattern: 'Circle',
      width: 1.0,
      height: 1.0,
      rotation: 0,
      speed: 1.0,
      xOffset: 0,
      yOffset: 0,
      fixtureIds: [],
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ effects: [...state.effects, effect] }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return id;
  },

  /** Seed built-in effects matching the 12 autoscript movement patterns */
  seedBuiltinEffects: () => {
    const state = get();
    if (state.effects.length > 0) return; // already seeded
    const builtins: Array<{ name: string; pattern: EfxPattern; width: number; height: number; speed: number }> = [
      { name: 'Sweep', pattern: 'Line', width: 1.0, height: 0.3, speed: 0.8 },
      { name: 'Circle', pattern: 'Circle', width: 0.7, height: 0.7, speed: 1.0 },
      { name: 'Pulse', pattern: 'Circle', width: 0.3, height: 0.3, speed: 2.0 },
      { name: 'Wave', pattern: 'Line', width: 0.2, height: 1.0, speed: 0.6 },
      { name: 'Bounce', pattern: 'Line', width: 0.15, height: 0.8, speed: 1.5 },
      { name: 'Figure 8', pattern: 'Eight', width: 0.6, height: 0.6, speed: 1.0 },
      { name: 'Spiral', pattern: 'Circle', width: 0.8, height: 0.8, speed: 0.5 },
      { name: 'Zigzag', pattern: 'Triangle', width: 1.0, height: 0.6, speed: 1.0 },
      { name: 'Heartbeat', pattern: 'Circle', width: 0.4, height: 0.4, speed: 1.8 },
      { name: 'Random Walk', pattern: 'Square', width: 0.5, height: 0.5, speed: 0.4 },
      { name: 'Diamond', pattern: 'Square', width: 0.6, height: 0.6, speed: 0.7 },
      { name: 'Static Frame', pattern: 'Square', width: 0.1, height: 0.1, speed: 0.1 },
    ];
    const now = new Date().toISOString();
    const seeded: SavedEffect[] = builtins.map((b, i) => ({
      id: `builtin-efx-${i}`,
      name: b.name,
      pattern: b.pattern,
      width: b.width,
      height: b.height,
      rotation: 0,
      speed: b.speed,
      xOffset: 0,
      yOffset: 0,
      fixtureIds: [],
      createdAt: now,
    }));
    set({ effects: seeded });
  },

  updateEffect: (id, updates) => {
    set((state) => ({
      effects: state.effects.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  deleteEffect: (id) => {
    set((state) => ({
      effects: state.effects.filter((e) => e.id !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getEffect: (id) => {
    return get().effects.find((e) => e.id === id);
  },

  setEffects: (effects) => {
    set({ effects });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  // ── Cue Lists (theater-style) ──
  cueLists: [],

  createCueList: (name) => {
    const id = generateCueListId();
    const cueList: SavedCueList = {
      id,
      name: name.trim() || `Cue List ${get().cueLists.length + 1}`,
      cues: [],
      currentCueIndex: -1,
    };
    set((state) => ({ cueLists: [...state.cueLists, cueList] }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return id;
  },

  updateCueList: (id, updates) => {
    set((state) => ({
      cueLists: state.cueLists.map((cl) =>
        cl.id === id ? { ...cl, ...updates } : cl
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  deleteCueList: (id) => {
    set((state) => ({
      cueLists: state.cueLists.filter((cl) => cl.id !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getCueList: (id) => {
    return get().cueLists.find((cl) => cl.id === id);
  },

  setCueLists: (cueLists) => {
    set({ cueLists });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getCueListCount: () => get().cueLists.length,

  // ── Shows (Show Manager) ──
  shows: [],

  createShow: (name) => {
    const id = generateShowId();
    const show: ShowData = {
      id,
      name: name.trim() || `Show ${get().shows.length + 1}`,
      duration: 60000, // default 60s
      tracks: [],
    };
    set((state) => ({ shows: [...state.shows, show] }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return id;
  },

  updateShow: (id, updates) => {
    set((state) => ({
      shows: state.shows.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  deleteShow: (id) => {
    set((state) => ({
      shows: state.shows.filter((s) => s.id !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getShow: (id) => {
    return get().shows.find((s) => s.id === id);
  },

  setShows: (shows) => {
    set({ shows });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  getShowCount: () => get().shows.length,

  // ── Song Presets (Jukebox) ──
  songPresets: [],

  addSongPreset: (preset) => {
    const id = generateId();
    const newPreset: SongPreset = {
      ...preset,
      id,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ songPresets: [...state.songPresets, newPreset] }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
    return id;
  },

  removeSongPreset: (id) => {
    set((state) => ({
      songPresets: state.songPresets.filter((p) => p.id !== id),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  updateSongPreset: (id, updates) => {
    set((state) => ({
      songPresets: state.songPresets.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    }));
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },

  setSongPresets: (presets) => {
    set({ songPresets: presets });
    try { const { useAppStore } = require('../stores/appStore'); useAppStore.getState().markDirty(); } catch { /* */ }
  },
}));

// ─── Fixture color palette ─────────────────────────────────

const FIXTURE_COLORS = [
  '#ff0064', '#6400ff', '#00c8ff', '#ffc800',
  '#00ff88', '#ff6600', '#ff00cc', '#00ffcc',
  '#cc00ff', '#ffcc00', '#0064ff', '#ff0099',
  '#44ff44', '#ff3300', '#9900ff', '#00e5ff',
  '#ff8800', '#8800ff', '#00ffaa', '#ff0044',
  '#4488ff', '#ff4488', '#44ffcc', '#ffaa00',
];

export function getFixtureColor(index: number): string {
  return FIXTURE_COLORS[index % FIXTURE_COLORS.length];
}
