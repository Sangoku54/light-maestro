/**
 * Show Store â€” DMX fixture patch state management
 *
 * Holds the current show's patched fixtures and universe configuration.
 * Validates against address overlaps and universe boundaries.
 */

import { create } from 'zustand';
import type { MtcMarker } from '../engine/mtc-markers';
import type { DmxCue } from '../hooks/dmx-cues';
import { normalizeFolderName } from '../utils/scene-fixtures';
import type { MusicianRoster } from '../utils/musicians';
import type { FixtureSupport } from '../utils/supports';
import { defaultStageDecks, defaultNewDeckHeight, migrateStageDecks, sanitizeDeckUpdates, type StageDeck } from '../utils/stage-decks';
import { defaultStageRigs, makeRig, migrateStageRigs, sanitizeRigUpdates, type RigKind, type StageRig } from '../utils/stage-rigs';
import { useAppStore } from './appStore';
import { getLicenseLimits } from './licenseStore';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type FixtureTier = 'primary' | 'secondary' | 'tertiary' | 'other';

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
  /** Whether the fixture participates in auto-generated output (undefined = enabled). */
  enabled?: boolean;
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

// â”€â”€â”€ Scene Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€ Stage 3D configuration (persisted per scene, shared with Stage3D) â”€â”€â”€
// @deprecated â€” replaced by `musicians` (free-form roster). Kept only so scenes
// saved before the roster feature can still be read and migrated.
export type BandConfig = 'none' | 'solo' | 'solo-chanteuse' | 'duo' | 'trio' | 'quartet' | 'quintet' | 'sextet';
export type StageScene = 'rear' | 'rear-front' | 'full' | 'empty';

export interface SavedScene {
  id: string;
  name: string;
  channels: Record<number, number>; // DMX address â†’ value (0-255)
  fadeIn: number;   // ms
  fadeOut: number;  // ms
  duration: number; // ms (0 = infinite/hold)
  createdAt: string;
  /** Optional user-defined classification folder (e.g. "front", "strobe").
   *  Free string, normalized (trim + collapsed spaces) on write.
   *  Old files without this field load as "uncategorized". */
  folder?: string;
  /** @deprecated â€” old fixed band preset, superseded by `musicians`. */
  bandConfig?: BandConfig;
  /** Free-form musician roster (kind â†’ count) shown on the 3D stage. */
  musicians?: MusicianRoster;
  /** Truss layout. */
  stageScene?: StageScene;
  /** EFX liÃ© â€” si prÃ©sent, la scÃ¨ne rejoue l'EFX en continu pendant sa durÃ©e (au lieu d'un snapshot statique). */
  efxId?: string;
}

// â”€â”€â”€ Show Manager Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ShowTrackItem {
  id: string;
  startTime: number;  // milliseconds
  duration: number;
  resourceId: string; // sceneId, chaserId, songPresetId
  fadeIn: number;
  fadeOut: number;
  name: string;
  audioFileBase64?: string; // base64 data URL for audio tracks
  audioRef?: string; // blob externalisÃ© (userData/audio-<hash>.json) â€” sinon audio absent
}

export interface ShowTrack {
  id: string;
  name: string;
  type: 'scene' | 'chaser' | 'efx' | 'audio' | 'matrix';
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
  audioRef?: string; // blob audio externalisÃ© (userData/audio-<hash>.json)
  audioFileName?: string;
  /** Vue 3D associÃ©e au show (pont + musiciens). */
  musicians?: MusicianRoster;
  stageScene?: StageScene;
}

// â”€â”€â”€ Chaser Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ EFX Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type EfxPattern = 'Circle' | 'Line' | 'Eight' | 'Square' | 'Triangle' | 'Infinity' | 'Zigzag' | 'Spiral' | 'DoubleCircle' | 'Heart' | 'Wave' | 'Bounce' | 'Cross';

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
  /** DÃ©calage de phase entre fixtures (0..1 = fraction d'un cycle rÃ©partie
   *  sur tout le groupe : 0 = synchronisÃ©es, 1 = vague complÃ¨te sur un cycle). */
  spread?: number;
  fixtureIds: string[];
  createdAt: string;
}

// â”€â”€â”€ Cue List Types (Theater-style sequential playback) â”€â”€â”€â”€

export interface CueListCue {
  id: string;
  sceneId: string;
  fadeIn: number;  // ms
  hold: number;     // ms
  fadeOut: number;  // ms
  note?: string;
  follow?: boolean; // auto Go after hold
  linkTo?: number;  // index to jump to (0-based), undefined = next
}

export interface FixturePos {
  x: number; // normalized 0-1 (stage width)
  y: number; // normalized 0-1 (stage depth)
  h: number; // height multiplier (0-1, maps to 0-5m range)
  heading: number; // rotation in degrees (0-360), 0=front (toward audience)
  tilt?: number; // static tilt in degrees (-90 to +90)
  zeroPan?: number; // point zÃ©ro pan (degrÃ©s) : dÃ©calage VISUEL du faisceau dans la 3D (comme une tare) ; le fader le dÃ©place en permanence
  zeroTilt?: number; // point zÃ©ro tilt (degrÃ©s) : dÃ©calage VISUEL du faisceau dans la 3D
  centerPan?: number; // centre du mouvement autoscript pan (degrÃ©s), set par Â« Capturer Â» : direction du byte actuel
  centerTilt?: number; // centre du mouvement autoscript tilt (degrÃ©s), set par Â« Capturer Â»
  beamAngle?: number; // beam opening angle in radians (0.02-0.8)
  thumbnailScale?: number; // sprite scale multiplier (0.2-2.0, default 0.75)
  mountMode?: 'top' | 'ground' | 'rear' | 'hanging'; // beam direction: top=down, ground=up, rear=forward, hanging=horizontal vers le public
  /** Support physique visible en 3D (pont/totem/trÃ©pied/sol). Absent = 'truss'
   *  (rendu historique : rien de dessinÃ©, projets existants inchangÃ©s). */
  support?: FixtureSupport;
  /** Longueur de barre (mÃ¨tres, 1-12) pour frontBar/backBar. Longueur LIBRE,
   *  jamais dÃ©rivÃ©e de la taille des plateaux. Absent = 4 m. */
  barSpan?: number;
  /** Barre suspendue par cÃ¢bles (true, dÃ©faut) vs posÃ©e sur pieds (false). */
  barHung?: boolean;
}

/**
 * Per-preset 3D view state. Captures everything the user can configure in the
 * floating Stage3D panel so it round-trips through .lmpreset (save â†’ export â†’
 * re-import â†’ load) and stays in sync when the same preset is loaded twice.
 *
 * - cameraPosition / cameraTarget â€” OrbitControls free-flight state (drag, zoom).
 *   Absent â†’ Stage3D falls back to the hardcoded "audience" preset.
 * - showBeams / showSmoke / showLabels / directMode â€” toolbar toggles.
 *
 * Optional fields are backward-compatible with presets saved before this type
 * existed (they just load as defaults).
 */
export interface View3DState {
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  showBeams?: boolean;
  showSmoke?: boolean;
  showLabels?: boolean;
  directMode?: boolean;
}

export interface SongPreset {
  id: string;
  name: string;
  /** Audio complet en base64. Absent si le blob est externalisÃ© (audioRef) â€”
   *  le playback DMX passe sur horloge virtuelle sans audio. */
  audioFileBase64?: string;
  audioRef?: string; // blob audio externalisÃ© (userData/audio-<hash>.json)
  audioFileName: string;
  dmxCues: DmxCue[];
  quickShow: any;
  trackAnalysis: any;
  sections: any[];
  efxTracks?: any[];
  manualCues?: DmxCue[];
  fixtureTracks?: any[];
  colorTracks?: any[];
  strobeTracks?: any[];
  dimmerTracks?: any[];
  chaserTracks?: any[];
  disabledFixtures?: string[];
  /** Vue 3D associÃ©e au preset (pont + musiciens). */
  musicians?: MusicianRoster;
  stageScene?: StageScene;
  /** Configuration de la vue 3D (camÃ©ra, options d'affichage) associÃ©e au preset. */
  view3D?: View3DState;
  createdAt: string;
}

export interface SavedCueList {
  id: string;
  name: string;
  cues: CueListCue[];
  currentCueIndex: number;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Un preset a de l'audio si base64 direct ou rÃ©fÃ©rence de blob externalisÃ©. */
export function presetHasAudio(p: any): boolean {
  return !!(p?.audioFileBase64 || (p as any)?.audioDataBase64 || p?.audioRef);
}

/** Choisit le meilleur preset parmi les correspondances id/nom : celui qui a
 *  de l'audio d'abord. Le store peut contenir des doublons homonymes dont
 *  certains sans son (import d'un .lmpreset sans audio embarquÃ© ayant Ã©crasÃ©
 *  l'entrÃ©e) â€” le widget ne doit jamais jouer le doublon muet. */
export function findBestSongPreset(
  presets: SongPreset[], songId?: string, songName?: string,
): SongPreset | undefined {
  if (!Array.isArray(presets) || presets.length === 0) return undefined;
  const candidates: SongPreset[] = [];
  if (songId) {
    const byId = presets.find((p) => p.id === songId);
    if (byId) candidates.push(byId);
  }
  if (songName) {
    for (const p of presets) {
      if (p.name === songName && !candidates.includes(p)) candidates.push(p);
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates.find((p) => presetHasAudio(p as any)) ?? candidates[0];
}

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
  licenseLimitReached: 'fixture' | 'universe' | null;
  resetLicenseLimitReached: () => void;

  // Actions
  patchFixture: (
    fixture: Omit<PatchedFixture, 'id'>
  ) => { id: string } | { error: string };
  moveFixture: (id: string, newAddress: number) => { error?: string };
  getFixturesByTier: (universeId: string, tier: FixtureTier) => PatchedFixture[];
  unpatchFixture: (id: string) => void;
   copyFixtureId: (id: string) => void;
   pasteFixture: () => { id: string } | { error: string };
   duplicateFixture: (id: string) => { id: string } | { error: string };
  /** ID de la fixture en presse-papier 3D (Ctrl+C dans Stage3D). */
  _clipboardFixtureId: string | null;
  updateFixtureTier: (id: string, tier: FixtureTier) => void;
  setFixtureName: (id: string, name: string) => void;
  setPatchedFixtures: (fixtures: PatchedFixture[]) => void;
  addShowUniverse: (config: ShowUniverse) => ({ error?: string });
  updateShowUniverse: (id: string, updates: Partial<ShowUniverse>) => void;
  removeShowUniverse: (id: string) => void;
  setShowUniverses: (universes: ShowUniverse[]) => void;
  getUniverseMap: (universeId: string) => Map<number, PatchedFixture>;
  getNextFreeAddress: (universeId: string, neededChannels: number, quantity?: number) => number;
  getFixtureById: (id: string) => PatchedFixture | undefined;

  // Fixture positions (shared between Stage2D and Stage3D)
  fixturePositions: Record<string, FixturePos>;
  stageDims: { width: number; depth: number };
  setStageDims: (dims: { width: number; depth: number }) => void;
  /** Plateaux multi-rects (podium, runway en T…). Repère normalisé 0-1
   *  (même repère que FixturePos), hauteurs en mètres. Défaut = plateau
   *  unique identique à l'ancien rectangle (rendu inchangé). */
  stageDecks: StageDeck[];
  setStageDecks: (decks: StageDeck[]) => void;
  addStageDeck: (deck?: Partial<StageDeck>) => string;
  updateStageDeck: (id: string, updates: Partial<StageDeck>) => void;
  removeStageDeck: (id: string) => void;
  /** Retour à la configuration initiale (plateau unique historique). */
  resetStageDecks: () => void;
  /** Structures libres placées dans le décor (ponts, barres, totems, T),
   *  indépendantes des fixtures — avec ou sans projecteur dessus. */
  stageRigs: StageRig[];
  setStageRigs: (rigs: StageRig[]) => void;
  addStageRig: (kind: RigKind) => string;
  updateStageRig: (id: string, updates: Partial<StageRig>) => void;
   removeStageRig: (id: string) => void;
   /** Retour à la configuration initiale (aucune structure). */
   resetStageRigs: () => void;
   setFixturePosition: (id: string, pos: Partial<FixturePos>) => void;
  setFixturePositions: (positions: Record<string, FixturePos>) => void;
  initFixturePosition: (id: string, fixtureType: string, index: number) => void;

  // Project-level 3D view config (survives page changes + project reopen)
  /** Vocaux virtuels (silhouettes sur la scène 3D). Remplace bandConfig déprécié. */
  musicians?: MusicianRoster;
  setMusicians: (m: MusicianRoster) => void;
  /** Configuration de la vue 3D (caméra, options d'affichage) associée au preset. */
  view3D?: View3DState;
  setView3D: (v: View3DState) => void;
  /** Ponts/supports de la scène 3D (layout truss) au niveau projet. */
  stageScene?: StageScene;
  setProjectStageScene: (cfg: StageScene) => void;

  // Fixture groups
  fixtureGroups: FixtureGroup[];
  addGroup: (name: string, fixtureIds: string[], color?: string) => string;
  removeGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  updateGroupFixtures: (groupId: string, fixtureIds: string[]) => void;
  getGroupsByUniverse: (universeId: string) => FixtureGroup[];
  setFixtureGroups: (groups: FixtureGroup[]) => void;

  // Color palettes (rÃ©utilisables : appliquer + remplacer partout)
  colorPalettes: Array<{ id: string; name: string; hex: string; groupIds: string[] }>;
  addColorPalette: (name: string, hex: string, groupIds?: string[]) => string;
  updateColorPalette: (id: string, updates: { name?: string; hex?: string; groupIds?: string[] }) => void;
  removeColorPalette: (id: string) => void;

  // Scenes
  scenes: SavedScene[];
  /** Explicit user-created folder names (entities). Scenes reference them via
   *  SavedScene.folder. Folders derived from scenes (legacy/imported) stay
   *  visible through the union in the UI even when not listed here. */
  sceneFolders: string[];
  createScene: (name: string) => string;
  updateScene: (id: string, updates: Partial<Pick<SavedScene, 'name' | 'channels' | 'fadeIn' | 'fadeOut' | 'duration' | 'folder' | 'musicians' | 'stageScene'>>) => void;
  deleteScene: (id: string) => void;
  /** Duplique une scÃ¨ne (canaux, fondus, dossier, EFX liÃ©â€¦) avec un nouvel id. Retourne le nouvel id ou null. */
  duplicateScene: (id: string) => string | null;
  getScene: (id: string) => SavedScene | undefined;
  setScenes: (scenes: SavedScene[]) => void;
  setSceneFolders: (folders: string[]) => void;
  getSceneCount: () => number;

  // Scenes â€” folder classification (declared folders + derived ones)
  /** Create an explicit folder. Returns the normalized name or null if empty/duplicate. */
  createFolder: (name: string) => string | null;
  /** Rename a folder: updates the declared list AND every scene carrying it. */
  renameFolder: (oldName: string, newName: string) => void;
  /** Unassign every scene in a folder (never deletes scenes, folder stays). */
  clearFolder: (name: string) => void;
  /** Delete a declared folder: removes it from the list and unassigns its scenes. */
  deleteFolder: (name: string) => void;

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

  // MTC markers (lot #15) â€” cues sur timecode
  mtcMarkers: MtcMarker[];
  addMtcMarker: (marker: Omit<MtcMarker, 'id'>) => string;
  updateMtcMarker: (id: string, updates: Partial<MtcMarker>) => void;
  deleteMtcMarker: (id: string) => void;
  setMtcMarkers: (markers: MtcMarker[]) => void;
}

// â”€â”€â”€ Store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const UNIVERSE_STORAGE_KEY = 'lightmaestro.universes.v1';

function loadUniverses(): ShowUniverse[] {
  try {
    const raw = localStorage.getItem(UNIVERSE_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as ShowUniverse[];
    }
  } catch { /* storage unavailable */ }
  return [];
}

function saveUniverses(universes: ShowUniverse[]): void {
  try { localStorage.setItem(UNIVERSE_STORAGE_KEY, JSON.stringify(universes)); } catch { /* storage unavailable */ }
}

export const useShowStore = create<ShowState>((set, get) => ({
  patchedFixtures: [],
  stageDims: { width: 10, depth: 8 },
  stageDecks: defaultStageDecks(),
  stageRigs: defaultStageRigs(),
  universes: loadUniverses(),
  licenseLimitReached: null,
  musicians: undefined,
  view3D: undefined,
  stageScene: undefined,

  patchFixture: (fixture) => {
    const { patchedFixtures } = get();

    // Licence : limite de fixtures (Ã©dition gratuite = 1 fixture)
    try {
      const limit = getLicenseLimits().maxFixtures;
      if (Number.isFinite(limit) && patchedFixtures.length >= limit) {
        set({ licenseLimitReached: 'fixture' });
        return {
          error: `Licence gratuite limitÃ©e Ã  ${limit} fixture(s). Passez Ã  la version standard ou complÃ¨te pour en ajouter davantage.`,
        };
      }
    } catch { /* licence indisponible : pas de bridage */ }

    // Validate address boundaries
    if (fixture.startAddress < 1 || fixture.startAddress > DMX_MAX_ADDRESS) {
      return {
        error: `Start address must be 1â€“${DMX_MAX_ADDRESS}, got ${fixture.startAddress}`,
      };
    }

    const endAddress = fixture.startAddress + fixture.channelCount - 1;
    if (endAddress > DMX_MAX_ADDRESS) {
      return {
        error: `Fixture addresses ${fixture.startAddress}â€“${endAddress} exceed universe boundary (max ${DMX_MAX_ADDRESS})`,
      };
    }

    // Check for overlap with existing fixtures on the same universe
    for (const pf of patchedFixtures) {
      if (pf.universeId !== fixture.universeId) continue;
      const pfEnd = pf.startAddress + pf.channelCount - 1;
      if (fixture.startAddress <= pfEnd && endAddress >= pf.startAddress) {
        return {
          error: `Address overlap: "${pf.name}" occupies ${pf.startAddress}â€“${pfEnd}, conflicts with ${fixture.startAddress}â€“${endAddress}`,
        };
      }
    }

    const id = generateId();
    const newFixture: PatchedFixture = { ...fixture, id };
    set({ patchedFixtures: [...patchedFixtures, newFixture] });
    // Mark project dirty
    useAppStore.getState().markDirty();
    return { id };
  },

  getFixturesByTier: (universeId, tier) => {
    return get().patchedFixtures.filter(
      (f) => f.universeId === universeId && f.tier === tier
    );
  },

  unpatchFixture: (id) => {
    set((state) => {
      const newPositions = { ...state.fixturePositions };
      delete newPositions[id];
      return {
        patchedFixtures: state.patchedFixtures.filter((f) => f.id !== id),
        fixturePositions: newPositions,
      };
    });
    useAppStore.getState().markDirty();
  },

  copyFixtureId: (id) => {
    set({ _clipboardFixtureId: id });
  },

  pasteFixture: () => {
    const { patchedFixtures, _clipboardFixtureId: clipId } = get();
    if (!clipId) return { error: 'No fixture in clipboard' };
    const src = patchedFixtures.find((f) => f.id === clipId);
    if (!src) return { error: 'Clipboard fixture not found' };
    const nextAddr = get().getNextFreeAddress(src.universeId, src.channelCount, 1);
    if (nextAddr <= 0) return { error: 'No free address available' };
    const id = generateId();
    const cloned: PatchedFixture = { ...src, id, name: `${src.name} (copie)`, startAddress: nextAddr };
    set((state) => ({
      patchedFixtures: [...state.patchedFixtures, cloned],
      fixturePositions: {
        ...state.fixturePositions,
        [id]: { ...state.fixturePositions[clipId], x: (state.fixturePositions[clipId]?.x ?? 0.5) + 0.05 },
      },
    }));
    useAppStore.getState().markDirty();
    return { id };
  },

  duplicateFixture: (id: string) => {
    const { patchedFixtures } = get();
    const src = patchedFixtures.find((f) => f.id === id);
    if (!src) return { error: 'Fixture not found' };
    if (src.startAddress < 1) return { error: 'Invalid fixture address' };
    // Try first free address immediately after the source fixture
    const candidateAddr = src.startAddress + src.channelCount;
    const universeFixtures = patchedFixtures
      .filter((f) => f.universeId === src.universeId && f.id !== id)
      .sort((a, b) => a.startAddress - b.startAddress);
    let addr = candidateAddr;
    for (const pf of universeFixtures) {
      if (addr + src.channelCount - 1 < pf.startAddress) break;
      if (addr + src.channelCount - 1 >= pf.startAddress) {
        addr = Math.max(addr, pf.startAddress + pf.channelCount);
      }
    }
    if (addr + src.channelCount - 1 > DMX_MAX_ADDRESS) return { error: 'No free address available' };
    const newId = generateId();
    const cloned: PatchedFixture = { ...src, id: newId, name: `${src.name} (copie)`, startAddress: addr };
    set((state) => ({
      patchedFixtures: [...state.patchedFixtures, cloned],
      fixturePositions: {
        ...state.fixturePositions,
        [newId]: { ...state.fixturePositions[id], x: (state.fixturePositions[id]?.x ?? 0.5) + 0.05 },
      },
    }));
    useAppStore.getState().markDirty();
    return { id: newId };
  },

  setFixtureName: (id, name) => {
    set((state) => ({
      patchedFixtures: state.patchedFixtures.map((f) =>
        f.id === id ? { ...f, name } : f
      ),
    }));
    useAppStore.getState().markDirty();
  },

  moveFixture: (id, newAddress) => {
    const { patchedFixtures } = get();
    const fixture = patchedFixtures.find((f) => f.id === id);
    if (!fixture) return { error: 'Fixture not found' };

    if (newAddress < 1 || newAddress > DMX_MAX_ADDRESS) {
      return { error: `Address must be 1â€“${DMX_MAX_ADDRESS}` };
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
        return { error: `Overlap with "${pf.name}" (${pf.startAddress}â€“${pfEnd})` };
      }
    }

    set((state) => ({
      patchedFixtures: state.patchedFixtures.map((f) =>
        f.id === id ? { ...f, startAddress: newAddress } : f
      ),
    }));
    useAppStore.getState().markDirty();
    return {};
  },

  setPatchedFixtures: (fixtures) => {
    set({ patchedFixtures: fixtures });
    useAppStore.getState().markDirty();
  },

  updateFixtureTier: (id, tier) => {
    set((state) => ({
      patchedFixtures: state.patchedFixtures.map((f) => (f.id === id ? { ...f, tier } : f)),
    }));
    useAppStore.getState().markDirty();
  },

  setShowUniverses: (universes) => {
    set({ universes });
    saveUniverses(universes);
    useAppStore.getState().markDirty();
  },

  addShowUniverse: (config) => {
    // Licence : limite d'univers (gratuite + standard = 1 univers)
    try {
      const limit = getLicenseLimits().maxUniverses;
      if (Number.isFinite(limit) && get().universes.length >= limit) {
        set({ licenseLimitReached: 'universe' });
        return {
          error: `Licence actuelle limitÃ©e Ã  ${limit} univers. Passez Ã  la version complÃ¨te pour en ajouter davantage.`,
        };
      }
    } catch { /* licence indisponible : pas de bridage */ }

    set((state) => {
      // Deduplicate by id
      if (state.universes.some((u) => u.id === config.id)) return state;
      const next = [
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
      ];
      saveUniverses(next);
      useAppStore.getState().markDirty();
      return { universes: next };
    });
    return {};
  },

  removeShowUniverse: (id) => {
    set((state) => {
      const next = state.universes.filter((u) => u.id !== id);
      saveUniverses(next);
      return {
        universes: next,
        patchedFixtures: state.patchedFixtures.filter((f) => f.universeId !== id),
      };
    });
    useAppStore.getState().markDirty();
  },

  updateShowUniverse: (id, updates) => {
    set((state) => {
      const next = state.universes.map((u) =>
        u.id === id ? { ...u, ...updates } : u
      );
      saveUniverses(next);
      return { universes: next };
    });
    useAppStore.getState().markDirty();
  },

  resetLicenseLimitReached: () => {
    set({ licenseLimitReached: null });
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

  // â”€â”€ Fixture Positions â”€â”€
  fixturePositions: {},
  _clipboardFixtureId: null,

  setFixturePosition: (id, pos) => {
    set((state) => ({
      fixturePositions: {
        ...state.fixturePositions,
        [id]: { ...(state.fixturePositions[id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 }), ...pos },
      },
    }));
    useAppStore.getState().markDirty();
  },

  setFixturePositions: (positions) => {
    set({ fixturePositions: positions });
    useAppStore.getState().markDirty();
  },
  setStageDims: (dims) => {
    set({ stageDims: dims });
    useAppStore.getState().markDirty();
  },
  setStageDecks: (decks) => {
    set({ stageDecks: migrateStageDecks(decks) });
    useAppStore.getState().markDirty();
  },
  addStageDeck: (deck) => {
    const id = `deck-${Date.now().toString(36)}`;
    set((state) => ({
      stageDecks: [
        ...state.stageDecks,
        {
          id,
          name: `Plateau ${state.stageDecks.length + 1}`,
          cx: 0.5,
          cy: 0.7,
          w: 0.4,
          d: 0.3,
          // EmpilÃ© visible d'office (jamais enterrÃ©) ; l'utilisateur ajuste H ensuite.
          h: defaultNewDeckHeight(state.stageDecks),
          rot: 0,
          ...deck,
        },
      ],
    }));
    useAppStore.getState().markDirty();
    return id;
  },
  updateStageDeck: (id, updates) => {
    // Champs vides/invalides ignorÃ©s (jamais de NaN/0 accidentel en store).
    const clean = sanitizeDeckUpdates(updates);
    if (Object.keys(clean).length === 0) return;
    set((state) => ({
      stageDecks: state.stageDecks.map((d) => (d.id === id ? { ...d, ...clean } : d)),
    }));
    useAppStore.getState().markDirty();
  },
  removeStageDeck: (id) => {
    set((state) => ({
      // Toujours â‰¥ 1 plateau (la scÃ¨ne ne disparaÃ®t jamais).
      stageDecks: state.stageDecks.length > 1 ? state.stageDecks.filter((d) => d.id !== id) : state.stageDecks,
    }));
    useAppStore.getState().markDirty();
  },
  resetStageDecks: () => {
    set({ stageDecks: defaultStageDecks() });
    useAppStore.getState().markDirty();
  },
  setStageRigs: (rigs) => {
    set({ stageRigs: migrateStageRigs(rigs) });
    useAppStore.getState().markDirty();
  },
  addStageRig: (kind) => {
    const id = `rig-${Date.now().toString(36)}`;
    set((state) => {
      const sameKind = state.stageRigs.filter((r) => r.kind === kind).length;
      const rig = makeRig(id, kind, state.stageRigs.length + 1);
      if (sameKind > 0) {
        // DÃ©cale chaque nouveau support du mÃªme type pour ne pas l'empiler
        // exactement sur l'existant (sinon invisible, on croit que rien ne se passe).
        rig.cx = rig.cx + 0.07 * sameKind;
        const side = sameKind % 2 === 0 ? 1 : -1;
        rig.cy = rig.cy + side * 0.05 * Math.ceil(sameKind / 2);
      }
      return { stageRigs: [...state.stageRigs, rig] };
    });
    useAppStore.getState().markDirty();
    return id;
  },
  updateStageRig: (id, updates) => {
    const clean = sanitizeRigUpdates(updates);
    if (Object.keys(clean).length === 0) return;
    set((state) => ({
      stageRigs: state.stageRigs.map((r) => (r.id === id ? { ...r, ...clean } : r)),
    }));
    useAppStore.getState().markDirty();
  },
  removeStageRig: (id) => {
    set((state) => ({ stageRigs: state.stageRigs.filter((r) => r.id !== id) }));
    useAppStore.getState().markDirty();
  },
  resetStageRigs: () => {
    set({ stageRigs: defaultStageRigs() });
    useAppStore.getState().markDirty();
  },

   initFixturePosition: (id, fixtureType, index) => {
     set((state) => {
       if (state.fixturePositions[id]) return state;
       const col = index % 6;
       const row = Math.floor(index / 6);
       const isOverhead = fixtureType === 'moving_head' || fixtureType === 'scanner';
       // Auto-dÃ©tection du mountMode selon la position sur la scÃ¨ne :
       // - ArriÃ¨re (y > 0.75) : fixture Â« accrochÃ©e Â» derriÃ¨re â†’ faisceau vers l'avant
       // - Devant (y < 0.25) : fixture au sol devant â†’ faisceau vers l'arriÃ¨re
       // - CÃ´tÃ©s (x < 0.25 ou x > 0.75) : fixture latÃ©rale au sol â†’ faisceau vers le centre
       // - Centre : par dÃ©faut hanging (faisceau vers le public)
       const normX = 0.1 + col * 0.16;
       const normY = 0.1 + row * 0.18;
       let mountMode: FixturePos['mountMode'] = 'hanging';
       if (normY > 0.75) mountMode = 'rear';
       else if (normY < 0.25) mountMode = 'ground';
       else if (normX < 0.25 || normX > 0.75) mountMode = 'ground';
       return {
         fixturePositions: {
           ...state.fixturePositions,
           [id]: {
             x: normX,
             y: normY,
              h: isOverhead ? 3 : 1.5,
             heading: 0,
             mountMode,
           },
         },
       };
     });
   },

  // â”€â”€ Fixture Groups â”€â”€
  fixtureGroups: [],

  addGroup: (name, fixtureIds, color) => {
    const id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const group: FixtureGroup = { id, name, fixtureIds, color };
    set((state) => ({ fixtureGroups: [...state.fixtureGroups, group] }));
    useAppStore.getState().markDirty();
    return id;
  },

  removeGroup: (groupId) => {
    set((state) => ({
      fixtureGroups: state.fixtureGroups.filter((g) => g.id !== groupId),
    }));
    useAppStore.getState().markDirty();
  },

  renameGroup: (groupId, name) => {
    set((state) => ({
      fixtureGroups: state.fixtureGroups.map((g) =>
        g.id === groupId ? { ...g, name } : g
      ),
    }));
    useAppStore.getState().markDirty();
  },

  updateGroupFixtures: (groupId, fixtureIds) => {
    set((state) => ({
      fixtureGroups: state.fixtureGroups.map((g) =>
        g.id === groupId ? { ...g, fixtureIds } : g
      ),
    }));
    useAppStore.getState().markDirty();
  },

  // â”€â”€ Color palettes â”€â”€
  colorPalettes: [],
  addColorPalette: (name, hex, groupIds = []) => {
    const id = `pal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({
      colorPalettes: [...state.colorPalettes, { id, name, hex, groupIds }],
    }));
    useAppStore.getState().markDirty();
    return id;
  },
  updateColorPalette: (id, updates) => {
    set((state) => ({
      colorPalettes: state.colorPalettes.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
    useAppStore.getState().markDirty();
  },
  removeColorPalette: (id) => {
    set((state) => ({ colorPalettes: state.colorPalettes.filter((p) => p.id !== id) }));
    useAppStore.getState().markDirty();
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
    useAppStore.getState().markDirty();
  },

  // ── Project-level 3D view config ──
  setMusicians: (musicians) => {
    set({ musicians });
    useAppStore.getState().markDirty();
  },
  setView3D: (view3D) => {
    set({ view3D });
    useAppStore.getState().markDirty();
  },
  setProjectStageScene: (stageScene) => {
    set({ stageScene });
    useAppStore.getState().markDirty();
  },

  // â”€â”€ Scenes â”€â”€
  scenes: [],
  sceneFolders: [],

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
    useAppStore.getState().markDirty();
    return id;
  },

  updateScene: (id, updates) => {
    // Normalize folder and clamp numeric fields before persist
    const normalized: typeof updates = { ...updates };
    if ('folder' in normalized) {
      const n = normalizeFolderName((normalized.folder as string) || '');
      normalized.folder = n || undefined;
    }
    if ('fadeIn' in normalized) {
      const v = Number((normalized as any).fadeIn);
      normalized.fadeIn = Number.isFinite(v) ? Math.max(0, Math.min(60000, Math.round(v))) : undefined as any;
      if (normalized.fadeIn === undefined) delete (normalized as any).fadeIn;
    }
    if ('fadeOut' in normalized) {
      const v = Number((normalized as any).fadeOut);
      normalized.fadeOut = Number.isFinite(v) ? Math.max(0, Math.min(60000, Math.round(v))) : undefined as any;
      if (normalized.fadeOut === undefined) delete (normalized as any).fadeOut;
    }
    if ('duration' in normalized) {
      const v = Number((normalized as any).duration);
      normalized.duration = Number.isFinite(v) ? Math.max(0, Math.min(600000, Math.round(v))) : undefined as any;
      if (normalized.duration === undefined) delete (normalized as any).duration;
    }
    set((state) => ({
      scenes: state.scenes.map((s) =>
        s.id === id ? { ...s, ...normalized } : s
      ),
    }));
    useAppStore.getState().markDirty();
  },

  // Create an explicit folder. Returns the normalized name (or null when
  // empty / already declared â€” case-sensitive, no silent case-folding).
  createFolder: (name) => {
    const n = normalizeFolderName(name);
    if (!n) return null;
    const exists = get().sceneFolders.some((f) => f === n);
    if (exists) return null;
    set((state) => ({ sceneFolders: [...state.sceneFolders, n] }));
    useAppStore.getState().markDirty();
    return n;
  },

  // Rename a folder: updates the declared list AND every scene carrying it.
  // Empty newName = clearFolder semantics (scenes become uncategorized, the
  // declared folder entity stays â€” same contract as clearFolder).
  renameFolder: (oldName, newName) => {
    const from = normalizeFolderName(oldName);
    const to = normalizeFolderName(newName);
    if (!from || from === to) return;
    set((state) => ({
      scenes: state.scenes.map((s) => {
        const cur = normalizeFolderName(s.folder || '');
        if (!cur || cur !== from) return s;
        return { ...s, folder: to || undefined };
      }),
      sceneFolders: !to
        ? state.sceneFolders // folder entity stays (clearFolder semantics)
        : state.sceneFolders.includes(to)
          ? state.sceneFolders.filter((f) => f !== from)
          : [...state.sceneFolders.filter((f) => f !== from), to],
    }));
    useAppStore.getState().markDirty();
  },

  // Unassign every scene in a folder (never deletes scenes, folder stays).
  clearFolder: (name) => {
    const from = normalizeFolderName(name);
    if (!from) return;
    set((state) => ({
      scenes: state.scenes.map((s) =>
        normalizeFolderName(s.folder || '') === from ? { ...s, folder: undefined } : s
      ),
    }));
    useAppStore.getState().markDirty();
  },

  // Delete a declared folder: removes it from the list + unassigns its scenes.
  deleteFolder: (name) => {
    const from = normalizeFolderName(name);
    if (!from) return;
    set((state) => ({
      scenes: state.scenes.map((s) =>
        normalizeFolderName(s.folder || '') === from ? { ...s, folder: undefined } : s
      ),
      sceneFolders: state.sceneFolders.filter((f) => f !== from),
    }));
    useAppStore.getState().markDirty();
  },

  deleteScene: (id) => {
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id),
      chasers: state.chasers.map((c) => ({ ...c, steps: c.steps.filter((st) => st.sceneId !== id) })),
      cueLists: state.cueLists.map((cl) => ({ ...cl, cues: cl.cues.filter((cu) => cu.sceneId !== id) })),
    }));
    useAppStore.getState().markDirty();
  },

  duplicateScene: (id) => {
    const src = get().scenes.find((s) => s.id === id);
    if (!src) return null;
    const taken = new Set(get().scenes.map((s) => s.name));
    let name = `${src.name} (copie)`;
    for (let n = 2; taken.has(name); n++) name = `${src.name} (copie ${n})`;
    const copy: SavedScene = {
      ...src,
      id: generateSceneId(),
      name,
      channels: { ...src.channels },
      musicians: src.musicians ? { ...src.musicians } : undefined,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ scenes: [...state.scenes, copy] }));
    useAppStore.getState().markDirty();
    return copy.id;
  },

  getScene: (id) => {
    const s = get().scenes.find((s) => s.id === id);
    return s ? { ...s, channels: { ...s.channels } } : undefined;
  },

  setScenes: (scenes) => {
    set({ scenes });
    useAppStore.getState().markDirty();
  },

  setSceneFolders: (folders) => {
    set({ sceneFolders: folders.map((f) => normalizeFolderName(f)).filter(Boolean) });
    useAppStore.getState().markDirty();
  },

  getSceneCount: () => get().scenes.length,

  // â”€â”€ Chasers â”€â”€
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
    useAppStore.getState().markDirty();
    return id;
  },

  updateChaser: (id, updates) => {
    set((state) => ({
      chasers: state.chasers.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    }));
    useAppStore.getState().markDirty();
  },

  deleteChaser: (id) => {
    set((state) => ({
      chasers: state.chasers.filter((c) => c.id !== id),
    }));
    useAppStore.getState().markDirty();
  },

  getChaser: (id) => {
    return get().chasers.find((c) => c.id === id);
  },

  setChasers: (chasers) => {
    set({ chasers });
    useAppStore.getState().markDirty();
  },

  getChaserCount: () => get().chasers.length,

  // â”€â”€ Effects (EFX) â”€â”€
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
    useAppStore.getState().markDirty();
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
    useAppStore.getState().markDirty();
  },

  updateEffect: (id, updates) => {
    set((state) => ({
      effects: state.effects.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    }));
    useAppStore.getState().markDirty();
  },

  deleteEffect: (id) => {
    set((state) => ({
      effects: state.effects.filter((e) => e.id !== id),
    }));
    useAppStore.getState().markDirty();
  },

  getEffect: (id) => {
    return get().effects.find((e) => e.id === id);
  },

  setEffects: (effects) => {
    set({ effects });
    useAppStore.getState().markDirty();
  },

  // â”€â”€ Cue Lists (theater-style) â”€â”€
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
    useAppStore.getState().markDirty();
    return id;
  },

  updateCueList: (id, updates) => {
    set((state) => ({
      cueLists: state.cueLists.map((cl) =>
        cl.id === id ? { ...cl, ...updates } : cl
      ),
    }));
    useAppStore.getState().markDirty();
  },

  deleteCueList: (id) => {
    set((state) => ({
      cueLists: state.cueLists.filter((cl) => cl.id !== id),
    }));
    useAppStore.getState().markDirty();
  },

  getCueList: (id) => {
    return get().cueLists.find((cl) => cl.id === id);
  },

  setCueLists: (cueLists) => {
    set({ cueLists });
    useAppStore.getState().markDirty();
  },

  getCueListCount: () => get().cueLists.length,

  // â”€â”€ Shows (Show Manager) â”€â”€
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
    useAppStore.getState().markDirty();
    return id;
  },

  updateShow: (id, updates) => {
    set((state) => ({
      shows: state.shows.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    }));
    useAppStore.getState().markDirty();
  },

  deleteShow: (id) => {
    set((state) => ({
      shows: state.shows.filter((s) => s.id !== id),
    }));
    useAppStore.getState().markDirty();
  },

  getShow: (id) => {
    return get().shows.find((s) => s.id === id);
  },

  setShows: (shows) => {
    set({ shows });
    useAppStore.getState().markDirty();
  },

  getShowCount: () => get().shows.length,

  // â”€â”€ Song Presets (Jukebox) â”€â”€
  songPresets: [],

  addSongPreset: (preset) => {
    const id = generateId();
    const newPreset: SongPreset = {
      ...preset,
      id,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ songPresets: [...state.songPresets, newPreset] }));
    useAppStore.getState().markDirty();
    return id;
  },

  removeSongPreset: (id) => {
    set((state) => ({
      songPresets: state.songPresets.filter((p) => p.id !== id),
    }));
    useAppStore.getState().markDirty();
  },

  updateSongPreset: (id, updates) => {
    set((state) => ({
      songPresets: state.songPresets.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
    }));
    useAppStore.getState().markDirty();
  },

  setSongPresets: (presets) => {
    set({ songPresets: presets });
    useAppStore.getState().markDirty();
  },

  // â”€â”€ MTC markers (lot #15) â€” cues sur timecode â”€â”€
  mtcMarkers: [],

  addMtcMarker: (marker) => {
    const id = `mtc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    set((state) => ({ mtcMarkers: [...state.mtcMarkers, { ...marker, id }] }));
    useAppStore.getState().markDirty();
    return id;
  },

  updateMtcMarker: (id, updates) => {
    set((state) => ({
      mtcMarkers: state.mtcMarkers.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    }));
    useAppStore.getState().markDirty();
  },

  deleteMtcMarker: (id) => {
    set((state) => ({
      mtcMarkers: state.mtcMarkers.filter((m) => m.id !== id),
    }));
    useAppStore.getState().markDirty();
  },

  setMtcMarkers: (markers) => {
    set({ mtcMarkers: markers });
    useAppStore.getState().markDirty();
  },
}));

// â”€â”€â”€ Fixture color palette â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


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

