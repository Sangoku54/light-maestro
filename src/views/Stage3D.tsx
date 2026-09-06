/**
 * Stage3D - Real-time 3D Stage Visualizer
 *
 * Replaces the 2D stage view with a Three.js-powered 3D renderer.
 * Lights react in real-time to DMX channel values during show playback.
 *
 * Features:
 *  - Procedural fixture geometry (LED PAR, Moving Head, Scanner, Strobe, etc.)
 *  - Real-time light beams from PointLights synced to DMX intensity/color
 *  - Volumetric beam cones
 *  - Fixture channel analysis via fixture definitions
 *  - Camera presets (front, top, side, audience)
 *  - OrbitControls for free navigation
 *  - Smoke/haze particle simulation
 *  - 30fps DMX polling
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useShowStore, getFixtureColor, type PatchedFixture, type FixturePos, type StageScene, type View3DState } from '../stores/showStore';
import { analyzeFixtureChannels, type FixtureChannelAnalysis } from '../engine/fixture-analyzer';
import { solvePanTilt, solveTiltForFixedPan } from '../engine/aim-target';
import { useAppStore } from '../stores/appStore';
import { dmxBridge } from '../utils/dmx-bridge';
import {
  loadFixtureDefinitions,
  clearFixtureDefCache,
  type DmxFixtureDefinition,
  type DmxFixtureChannel,
  type DmxFixtureCapability,
} from '../hooks/dmx-cues';
import { useTranslation } from 'react-i18next';
import { Eye, Camera, Maximize2, ChevronUp, PanelTop, PanelRight, Users, GripVertical, X, LayoutGrid, Music, Zap, List, Search, Crosshair, Sparkles } from 'lucide-react';
import { DEFAULT_POSITIONS, DEFAULT_ROSTER, MUSICIAN_KINDS, MUSICIAN_LABELS, isRosterEmpty, normalizeRoster, rosterTotal, type MusicianKind, type MusicianRoster } from '../utils/musicians';
import clavierImg from '../assets/musicians/clavier.png';
import chanteuseImg from '../assets/musicians/chanteuse.png';
import chanteurImg from '../assets/musicians/chanteur.png';
import batteurImg from '../assets/musicians/batteur.png';
import bassisteImg from '../assets/musicians/bassiste.png';
import guitaristeImg from '../assets/musicians/guitariste.png';
import cuivreImg from '../assets/musicians/cuivre.png';
import { sendFixtureOn, sendFixtureOff } from '../utils/dmx-helpers';
import { fixtureTestState } from '../utils/fixture-test-state';
import { generateAllThumbnails, getVariantsForCategory } from '../utils/fixtureThumbnails';
import { useProgrammerStore } from '../stores/programmerStore';

// ─── Constants ───────────────────────────────────────────────

const STAGE_WIDTH = 10;  // meters
const STAGE_DEPTH = 8;   // meters
const TRUSS_HEIGHT = 3;  // meters
const STAGE_HEIGHT = 1.5;  // meters — stage elevation above ground
const STAGE_THICKNESS = 0.3;  // meters — stage platform thickness
const DMX_POLL_INTERVAL = 1000 / 60; // 60fps — smooth pan/tilt update every render frame
const PREVIEW_INTENSITY = 0.45;       // fixtures sélectionnées : niveau de prévisualisation des faisceaux
const MAX_TRAIL_POINTS = 80;
const TRAIL_ADD_INTERVAL = 100; // ms between trail samples
const GRID_SIZE = 1; // 1m grid squares

// ─── Frame the whole stage on open ──────────────────────────
// The 3D view often lives in a narrow dock, so the default camera can crop
// the stage and force the user to zoom out. This extends the camera along
// its current direction just enough to fit the whole stage volume
// (width × truss height × depth) with the current aspect — angles unchanged.
function ensureStageFits(
  camera: THREE.PerspectiveCamera,
  width: number,
  depth: number,
  pos: THREE.Vector3,
  target: THREE.Vector3,
): void {
  const size = new THREE.Vector3(width, TRUSS_HEIGHT + STAGE_HEIGHT, depth);
  const radius = size.length() / 2;
  const halfVFov = THREE.MathUtils.degToRad(camera.fov) / 2;
  const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect);
  const fitDist = (radius / Math.sin(Math.min(halfVFov, halfHFov))) * 1.08;
  const dir = pos.clone().sub(target);
  if (dir.lengthSq() < 0.001) dir.set(0, 0.2, -1);
  dir.normalize();
  if (pos.distanceTo(target) < fitDist) {
    pos.copy(target).addScaledVector(dir, fitDist);
  }
}

// ─── Virtual musicians (free-form roster + SVG silhouette textures) ──

const MUSICIAN_IMAGES: Record<MusicianKind, string> = {
  chanteur: chanteurImg,
  chanteuse: chanteuseImg,
  guitariste: guitaristeImg,
  bassiste: bassisteImg,
  clavier: clavierImg,
  batteur: batteurImg,
  cuivre: cuivreImg,
};

const MUSICIAN_HEIGHTS: Record<MusicianKind, number> = {
  chanteur: 1.75,
  chanteuse: 1.7,
  guitariste: 1.75,
  bassiste: 1.75,
  clavier: 1.65,
  batteur: 1.6,
  cuivre: 1.7,
};

// Beam cone length (m) — petit cône de lumière : s'arrête à la scène depuis la poutre (TRUSS_HEIGHT),
// au lieu de l'ancien 12.5 m qui traversait le sol et descendait ~9 m sous la scène.
const BEAM_LENGTH = 4.5; // +50 % par rapport à 3.0 (demande utilisateur)

// Horizontal spacing between two instances of the same kind (fraction of stage).
const MUSICIAN_SPREAD = 0.16;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// Build per-instance positions (id `${kind}-${i}`) from a roster, spreading
// multiple members of the same kind horizontally around the default x.
function buildRosterPositions(roster: MusicianRoster): Record<string, { x: number; z: number }> {
  const map: Record<string, { x: number; z: number }> = {};
  for (const kind of MUSICIAN_KINDS) {
    const count = roster[kind] ?? 0;
    if (count <= 0) continue;
    const base = DEFAULT_POSITIONS[kind];
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * MUSICIAN_SPREAD;
      map[`${kind}-${i}`] = { x: clamp01(base.x + offset), z: base.z };
    }
  }
  return map;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + url));
    img.src = url;
  });
}

// Remove a solid background (e.g. white) connected to the image borders,
// turning it transparent. Leaves already-transparent cutouts untouched.
function removeBackground(imageData: ImageData) {
  const { data, width, height } = imageData;
  const w = width, h = height;

  // Already a transparent cutout? (corners transparent) → leave as-is
  const cornerAlpha = [
    data[3],
    data[(w - 1) * 4 + 3],
    data[(h - 1) * w * 4 + 3],
    data[((h - 1) * w + (w - 1)) * 4 + 3],
  ];
  if (cornerAlpha.filter(a => a < 128).length >= 3) return;

  const ref = [
    (data[0] + data[(w - 1) * 4] + data[(h - 1) * w * 4] + data[((h - 1) * w + (w - 1)) * 4]) / 4,
    (data[1] + data[(w - 1) * 4 + 1] + data[(h - 1) * w * 4 + 1] + data[((h - 1) * w + (w - 1)) * 4 + 1]) / 4,
    (data[2] + data[(w - 1) * 4 + 2] + data[(h - 1) * w * 4 + 2] + data[((h - 1) * w + (w - 1)) * 4 + 2]) / 4,
  ];
  const tol = 60;

  const isBg = (x: number, y: number): boolean => {
    const o = (y * w + x) * 4;
    const dr = data[o] - ref[0], dg = data[o + 1] - ref[1], db = data[o + 2] - ref[2];
    return (dr * dr + dg * dg + db * db) <= tol * tol;
  };

  const visited = new Uint8Array(w * h);
  const queue: number[] = [];
  const seed = (x: number, y: number) => {
    if (isBg(x, y)) { visited[y * w + x] = 1; queue.push(y * w + x); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % w, y = (idx / w) | 0;
    const n = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of n) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nidx = ny * w + nx;
      if (visited[nidx]) continue;
      if (isBg(nx, ny)) { visited[nidx] = 1; queue.push(nidx); }
    }
  }

  for (let i = 0; i < visited.length; i++) {
    if (visited[i]) data[i * 4 + 3] = 0;
  }
}

async function loadMusicianTexture(kind: MusicianKind): Promise<THREE.CanvasTexture> {
  return loadCutoutTexture(MUSICIAN_IMAGES[kind]);
}

async function loadCutoutTexture(url: string): Promise<THREE.CanvasTexture> {
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  removeBackground(data);
  // All silhouettes are black: zero RGB of every opaque pixel (alpha kept)
  for (let i = 0; i < data.data.length; i += 4) {
    if (data.data[i + 3] > 0) { data.data[i] = 0; data.data[i + 1] = 0; data.data[i + 2] = 0; }
  }
  ctx.putImageData(data, 0, 0);

  // Crop to the opaque bounding box so the sprite shows just the figure
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data.data[(y * c.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return new THREE.CanvasTexture(c);

  const pad = 2;
  const cw = maxX - minX + 1 + pad * 2;
  const ch = maxY - minY + 1 + pad * 2;

  // White halo: draw the dark silhouette onto a padded canvas with a soft
  // white glow so the figure reads clearly against the near-black stage.
  const glow = 18; // px of halo around the figure
  const out = document.createElement('canvas');
  out.width = cw + glow * 2;
  out.height = ch + glow * 2;
  const octx = out.getContext('2d')!;
  octx.shadowColor = 'rgba(255,255,255,0.85)';
  octx.shadowBlur = glow;
  octx.drawImage(c, minX - pad, minY - pad, cw, ch, glow, glow, cw, ch);
  // Second pass strengthens the core without widening the halo further.
  octx.drawImage(c, minX - pad, minY - pad, cw, ch, glow, glow, cw, ch);
  octx.shadowBlur = 0;
  return new THREE.CanvasTexture(out);
}

// ─── Channel Analysis (mirrors dmx-cues.ts analyzeFixture) ──

// FixtureChannelMap is now FixtureChannelAnalysis from fixture-analyzer.ts
type FixtureChannelMap = FixtureChannelAnalysis;

// ─── Color wheel → hex (simplified) ──────────────────────────

function wheelValueToColor(
  value: number,
  caps: DmxFixtureCapability[] | null,
): THREE.Color {
  if (caps) {
    for (const cap of caps) {
      if (value >= cap.min && value <= cap.max && cap.color) {
        // Normalize: hex strings like "Red", "Green" are not valid
        const c = cap.color;
        if (c.startsWith('#')) return new THREE.Color(c);
        // Map color names to hex
        const named: Record<string, string> = {
          red: '#ff0000', green: '#00ff00', blue: '#0000ff',
          white: '#ffffff', yellow: '#ffff00', cyan: '#00ffff',
          magenta: '#ff00ff', orange: '#ff8800', purple: '#8800ff',
          amber: '#ffbf00', pink: '#ff69b4', uv: '#8800ff',
        };
        const hex = named[c.toLowerCase()];
        if (hex) return new THREE.Color(hex);
        return new THREE.Color(c); // try anyway
      }
    }
  }
  // Fallback : blanc neutre — l'arc-en-ciel calculé depuis la valeur DMX brute
  // rendait du jaune stable pour les valeurs 60-85 (roues non analysées).
  void value;
  return new THREE.Color(0xffffff);
}

// ─── Fixture 3D Object ───────────────────────────────────────

interface ExtraHead3D {
  headGroup: THREE.Group;       // Head group (tilt, X-axis rotation)
  lightTarget: THREE.Object3D;  // Light exit point
  pointLight?: THREE.PointLight;
  beamCone?: THREE.Mesh;
  tiltOffset: number;           // DMX offset (0-based) of this head's tilt channel
  _mountTilt: number;           // Mount-mode tilt compensation
}

interface Fixture3D {
  id: string;
  group: THREE.Group;           // Root group (positioned on stage)
  bodyMesh: THREE.Mesh;         // Fixture body
  thumbSprite?: THREE.Sprite;   // Thumbnail sprite (replaces sphere for non-moving fixtures)
  armGroup?: THREE.Group;       // Arm (pan, Y-axis rotation)
  headGroup?: THREE.Group;      // Head (tilt, X-axis rotation)
  lightTarget: THREE.Object3D;  // Where the light is attached
  pointLight?: THREE.PointLight;    // Dynamic point light
  beamCone?: THREE.Mesh;        // Volumetric beam cone
  extraHeads?: ExtraHead3D[];   // Additional tilt heads (multi-arm fixtures)
  floorSpot?: THREE.Mesh;       // Light spot on the floor
  floorGlow?: THREE.Mesh;       // Soft outer glow on floor
  // Movement pattern trail
  trailLine?: THREE.Line;
  trailPositions: THREE.Vector3[];
  trailLastAdd: number;
  channelMap: FixtureChannelMap;
  universeIndex: number;        // Index into channelData map
  mountMode: 'top' | 'ground' | 'rear'; // beam default direction
  beamAngle: number;            // beam opening angle in radians
  _staticTilt: number;          // static tilt offset from panel
  _mountTilt: number;           // mount-mode head tilt compensation (π for ground, 0 otherwise)
}

// ─── Component ────────────────────────────────────────────────

export const Stage3D: React.FC<{
  disabledFixtures?: Set<string>;
  musicians?: MusicianRoster;
  stageScene?: StageScene;
  onMusiciansChange?: (roster: MusicianRoster) => void;
  onStageSceneChange?: (cfg: StageScene) => void;
  /** External 3D view state (camera position/target, toolbar toggles).
   *  When provided, Stage3D uses it as the source of truth for those values
   *  and emits updates through `onView3DChange` whenever the user drags the
   *  camera or toggles a flag. When omitted, the component falls back to
   *  internal state (ephemeral UI chrome — old behavior). */
  view3D?: View3DState;
  onView3DChange?: (state: View3DState) => void;
  /** N'affiche l'option EFX Snapshot que si true — uniquement onglet Scènes (Design) */
  enableEfxApply?: boolean;
}> = ({ disabledFixtures, musicians: musiciansProp, stageScene: stageSceneProp, onMusiciansChange, onStageSceneChange, view3D: view3DProp, onView3DChange, enableEfxApply }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef<Set<string>>(new Set());
  disabledRef.current = disabledFixtures ?? new Set();
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fixturesRef = useRef<Map<string, Fixture3D>>(new Map());
  const timerRef = useRef<THREE.Timer>(new THREE.Timer());
  const musiciansGroupRef = useRef<THREE.Group | null>(null);
  const musiciansRef = useRef<{ sprite: THREE.Sprite; phase: number; baseY: number }[]>([]);
  const animFrameRef = useRef<number>(0);
  const lastDmxPollRef = useRef<number>(0);
  const dmxLastActivityRef = useRef<number>(0);
  const particlesRef = useRef<THREE.Points | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

  const [showBeamsInternal, setShowBeamsInternal] = useState(true);
  const [showLabelsInternal, setShowLabelsInternal] = useState(true);
  const [showSmokeInternal, setShowSmokeInternal] = useState(true);
  const [musiciansInternal, setMusiciansInternal] = useState<MusicianRoster>(DEFAULT_ROSTER);
  const musicianPositionsRef = useRef<Record<string, { x: number; z: number }>>(buildRosterPositions(DEFAULT_ROSTER));
  const dragMusicianRef = useRef<string | null>(null);
  const [fixtureDefsReady, setFixtureDefsReady] = useState(false);
  const [lightOn, setLightOn] = useState(false);
  const lastDmxFrameRef = useRef(performance.now());

  // ── Stage scene config ────────────────────────────
  const [stageSceneInternal, setStageSceneInternal] = useState<StageScene>('rear-front');

  // Controlled stage config (host supplies props) vs internal default
  const musicians = musiciansProp ?? musiciansInternal;
  const stageScene = stageSceneProp ?? stageSceneInternal;
  const handleMusiciansChange = (roster: MusicianRoster) => {
    const next = normalizeRoster(roster);
    setMusiciansInternal(next);
    onMusiciansChange?.(next);
  };
  const handleStageSceneChange = (cfg: StageScene) => {
    setStageSceneInternal(cfg);
    onStageSceneChange?.(cfg);
  };

  // ── Controlled 3D view state (camera + toolbar) ──
  // Same pattern as musicians/stageScene: prop wins when supplied, otherwise
  // we fall back to internal defaults (legacy behavior — panel detaches and the
  // toggles revert to local state).
  const view3DToggles: Required<Pick<View3DState, 'showBeams' | 'showSmoke' | 'showLabels'>> = {
    showBeams: view3DProp?.showBeams ?? showBeamsInternal,
    showSmoke: view3DProp?.showSmoke ?? showSmokeInternal,
    showLabels: view3DProp?.showLabels ?? showLabelsInternal,
  };
  const showBeams = view3DToggles.showBeams;
  const showSmoke = view3DToggles.showSmoke;
  const showLabels = view3DToggles.showLabels;
  // Direct mode is below — but expose the setter wrapper here for symmetry.
  const setShowBeams = (v: boolean | ((prev: boolean) => boolean)) => {
    const cur = view3DToggles.showBeams;
    const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(cur) : v;
    setShowBeamsInternal(next);
    if (view3DProp !== undefined) onView3DChange?.({ ...view3DProp, showBeams: next });
  };
  const setShowSmoke = (v: boolean | ((prev: boolean) => boolean)) => {
    const cur = view3DToggles.showSmoke;
    const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(cur) : v;
    setShowSmokeInternal(next);
    if (view3DProp !== undefined) onView3DChange?.({ ...view3DProp, showSmoke: next });
  };
  const setShowLabels = (v: boolean | ((prev: boolean) => boolean)) => {
    const cur = view3DToggles.showLabels;
    const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(cur) : v;
    setShowLabelsInternal(next);
    if (view3DProp !== undefined) onView3DChange?.({ ...view3DProp, showLabels: next });
  };

  // Capture current OrbitControls state and forward it to the parent so it
  // round-trips through .lmpreset. Coalesced via a microtask so a single drag
  // gesture (which fires dozens of `change` ticks) emits exactly one update.
  const emitView3DCameraRef = useRef<() => void>(() => {});
  emitView3DCameraRef.current = () => {
    if (view3DProp === undefined || !onView3DChange) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const cp = camera.position;
    const ct = controls.target;
    onView3DChange({
      ...view3DProp,
      cameraPosition: [cp.x, cp.y, cp.z],
      cameraTarget: [ct.x, ct.y, ct.z],
    });
  };
  const emitPendingRef = useRef(false);
  const emitView3DCameraCoalesced = useCallback(() => {
    // Microtask coalescing — OrbitControls fires 'change' on every pointer
    // move, but we only want one emission per drag gesture.
    if (emitPendingRef.current) return;
    emitPendingRef.current = true;
    queueMicrotask(() => {
      emitPendingRef.current = false;
      emitView3DCameraRef.current();
    });
  }, []);

  // Reset musician positions whenever the roster changes (manual or via prop)
  useEffect(() => {
    musicianPositionsRef.current = buildRosterPositions(musicians);
  }, [musicians]);
  const trussBeamsRef = useRef<{ back: THREE.Object3D | null; front: THREE.Object3D | null; left: THREE.Object3D | null; right: THREE.Object3D | null; poles: THREE.Object3D[] }>({ back: null, front: null, left: null, right: null, poles: [] });
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  // ── Sélection multiple 3D + mode Target ─────────────────
  const selectedFixtureIdRef = useRef<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const multiSelectedIdsRef = useRef<Set<string>>(new Set());
  const [targetMode, setTargetMode] = useState(false);
  const targetModeRef = useRef(false);
  const targetMarkerRef = useRef<THREE.Group | null>(null);

  // Miroirs du sélection courante pour les callbacks (pas de re-création).
  useEffect(() => { selectedFixtureIdRef.current = selectedFixtureId; }, [selectedFixtureId]);
  useEffect(() => {
    targetModeRef.current = targetMode;
    if (!targetMode && targetMarkerRef.current) targetMarkerRef.current.visible = false;
  }, [targetMode]);

  const selectSingleFixture = useCallback((fid: string) => {
    selectedFixtureIdRef.current = fid;
    multiSelectedIdsRef.current = new Set([fid]);
    setMultiSelectedIds(new Set([fid]));
    setSelectedFixtureId(fid);
  }, []);

  const clearFixtureSelection = useCallback(() => {
    selectedFixtureIdRef.current = null;
    multiSelectedIdsRef.current = new Set();
    setMultiSelectedIds(new Set());
    setSelectedFixtureId(null);
    setTargetMode(false);
    if (targetMarkerRef.current) targetMarkerRef.current.visible = false;
  }, []);
  const [showFixtureList, setShowFixtureList] = useState(false);
  const [fixtureSearch, setFixtureSearch] = useState('');
  const [leftDockCollapsed, setLeftDockCollapsed] = useState(true);
  const [musiciansMenuOpen, setMusiciansMenuOpen] = useState(false);
  const musiciansBtnRef = useRef<HTMLButtonElement>(null);
  const [musiciansMenuPos, setMusiciansMenuPos] = useState<{ top: number; left: number } | null>(null);
  const stageDims = useShowStore((s) => s.stageDims);
  const setStageDims = useShowStore((s) => s.setStageDims);
  // ── Resizable stage dimensions (width × depth, meters) ──
  // Fixture positions are normalized (0-1), so resizing scales hardware spacing proportionally.
  const stageDimsRef = useRef(stageDims);
  stageDimsRef.current = stageDims;
  const [draftDims, setDraftDims] = useState<{ width: string | number; depth: string | number }>({ width: stageDims.width, depth: stageDims.depth });
  const commitStageDims = () => {
    const wRaw = draftDims.width === '' ? NaN : Number(draftDims.width);
    const dRaw = draftDims.depth === '' ? NaN : Number(draftDims.depth);
    const w = Math.max(1, Number.isFinite(wRaw) ? wRaw : STAGE_WIDTH);
    const d = Math.max(1, Number.isFinite(dRaw) ? dRaw : STAGE_DEPTH);
    setStageDims({ width: w, depth: d });
    setDraftDims({ width: w, depth: d });
  };
  // ── Rotate selected fixture on drag ────────────────
  const dragRotateRef = useRef<{ startX: number; startY: number; fixtureId: string } | null>(null);
  const [hoveredFixtureId, setHoveredFixtureId] = useState<string | null>(null);
  const [directModeInternal, setDirectModeInternal] = useState(false);
  const directMode = view3DProp?.directMode ?? directModeInternal;
  const setDirectMode = (v: boolean | ((prev: boolean) => boolean)) => {
    const cur = view3DProp?.directMode ?? directModeInternal;
    const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(cur) : v;
    setDirectModeInternal(next);
    if (view3DProp !== undefined) onView3DChange?.({ ...view3DProp, directMode: next });
  };
  // Keep draft dims in sync when stageDims changes from store (preset load, external)
  useEffect(() => {
    setDraftDims({ width: stageDims.width, depth: stageDims.depth });
  }, [stageDims.width, stageDims.depth]);
  const panTiltDragRef = useRef<{ fixtureId: string; startX: number; startY: number; startPan: number; startTilt: number } | null>(null);

  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const fixturePositions = useShowStore((s) => s.fixturePositions);
  const setFixturePosition = useShowStore((s) => s.setFixturePosition);
  const initFixturePosition = useShowStore((s) => s.initFixturePosition);
  // Universes come from the showStore (the source of truth every DMX writer
  // keys `channelData` by). `appStore.dmx.universes` is a stale default that
  // is never synced — using it here broke the 3D mirror whenever showStore
  // universes differed (multi-universe shows, renamed universes).
  const universes = useShowStore((s) => s.universes);

  // ── Init fixture positions for new fixtures ────────────
  useEffect(() => {
    for (let i = 0; i < patchedFixtures.length; i++) {
      const pf = patchedFixtures[i];
      if (!fixturePositions[pf.id]) {
        initFixturePosition(pf.id, pf.fixtureType, i);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchedFixtures.map(f => f.id).join(',')]);

  // ── Universe ID → index mapping ────────────────────────
  const universeIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    universes.forEach((u, i) => map.set(u.id, i));
    return map;
  }, [universes]);

  // ── Load fixture definitions ───────────────────────────
  useEffect(() => {
    const ids = patchedFixtures.map(f => f.fixtureDefId).filter(Boolean);
    if (ids.length === 0) {
      setFixtureDefsReady(true);
      return;
    }
    let cancelled = false;
    loadFixtureDefinitions(ids).then(() => {
      if (!cancelled) setFixtureDefsReady(true);
    });
    return () => { cancelled = true; };
  }, [patchedFixtures.map(f => f.fixtureDefId).join(',')]);

  // Thumbnails cache (same source as Stage2DEditor) — id → dataUrl
  const thumbDataUrlMap = useMemo(() => {
    const m = new Map<string, string>();
    try { for (const v of generateAllThumbnails()) m.set(v.id, v.dataUrl); } catch { /* SSR */ }
    return m;
  }, []);
  const thumbTextureCache = useRef<Map<string, THREE.Texture>>(new Map());

  function getThumbTexture(id: string | undefined, fallbackType: string): THREE.Texture | null {
    const vid = id || getVariantsForCategory(fallbackType)[0]?.id;
    if (!vid) return null;
    const cached = thumbTextureCache.current.get(vid);
    if (cached) return cached;
    const url = thumbDataUrlMap.get(vid);
    if (!url) return null;
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    thumbTextureCache.current.set(vid, tex);
    return tex;
  }

  // ── Create procedural fixture geometry ──────────────────
  const createFixtureGeometry = useCallback((
    fixture: PatchedFixture,
    pos: FixturePos,
    channelMap: FixtureChannelMap,
    defs: Map<string, DmxFixtureDefinition>,
  ): Fixture3D => {
    const group = new THREE.Group();
    const stageX = (pos.x - 0.5) * stageDimsRef.current.width;
    const stageZ = (pos.y - 0.5) * stageDimsRef.current.depth;
    // Map h (0-1) to actual meters: 0 → 0m, 1 → 5m
    const stageY = STAGE_HEIGHT + pos.h * 5.0;
    group.position.set(stageX, stageY, stageZ);
    // Apply heading rotation (degrees → radians, Y axis rotation)
    group.rotation.y = ((pos.heading ?? 0) * Math.PI) / 180;
    // User data for raycasting identification
    group.userData = { fixtureId: fixture.id, fixtureType: fixture.fixtureType };

    const type = fixture.fixtureType || '';
    const tierColor = fixture.tier === 'primary' ? 0xa855f7
      : fixture.tier === 'secondary' ? 0x3b82f6 : 0x6b7280;

    let bodyMesh: THREE.Mesh;
    let lightTarget: THREE.Object3D;
    let armGroup: THREE.Group | undefined;
    let headGroup: THREE.Group | undefined;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.6,
      metalness: 0.3,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: tierColor,
      roughness: 0.4,
      metalness: 0.5,
      emissive: tierColor,
      emissiveIntensity: 0.3,
    });

    // Normalize: "Moving Head" → "moving_head", "Color Changer" → "color_changer", etc.
    const normalized = type.toLowerCase().replace(/[\s-]+/g, '_');
    switch (normalized) {
      case 'moving_head': {
        // Materials
        const metalMat = new THREE.MeshStandardMaterial({
          color: 0x2a2a35, roughness: 0.3, metalness: 0.8,
        });
        const headMat = new THREE.MeshStandardMaterial({
          color: tierColor, roughness: 0.35, metalness: 0.5,
          emissive: tierColor, emissiveIntensity: 0.2,
        });

        // ── BASE: minimal anchor disc ──
        const basePlate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.10, 0.04, 12), metalMat);
        basePlate.position.y = 0.02;
        group.add(basePlate);

        bodyMesh = basePlate;

        // ── YOKE: U-shaped metal bracket (pans on Y) ──
        armGroup = new THREE.Group();
        armGroup.position.y = 0.13;
        armGroup.name = 'arm';

        const yokeMat = new THREE.MeshStandardMaterial({
          color: 0x333340, roughness: 0.4, metalness: 0.75,
        });
        // Left arm
        const la = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.07), yokeMat);
        la.position.set(-0.14, 0.16, 0);
        armGroup.add(la);
        // Right arm
        const ra = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.07), yokeMat);
        ra.position.set(0.14, 0.16, 0);
        armGroup.add(ra);
        // Crossbar
        const xb = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.04, 0.07), yokeMat);
        xb.position.y = 0.32;
        armGroup.add(xb);

        group.add(armGroup);

        // ── HEAD: sphere (orientation-agnostic, beam exits at bottom point) ──
        headGroup = new THREE.Group();
        headGroup.position.y = 0.34;
        headGroup.name = 'head';

        // Tï¿½te moving_head : sphï¿½re (orientation-agnostic, beam exits at bottom point)
        const headBody = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 24, 16), headMat);
        headBody.position.set(0, 0, 0);
        headBody.castShadow = true;
        headGroup.add(headBody);

        // Light exit at bottom point of sphere (y = -radius)
        const lightExit = new THREE.Group();
        lightExit.position.set(0, -0.08, 0);
        lightExit.name = 'lightExit';
        headGroup.add(lightExit);

        armGroup.add(headGroup);

        lightTarget = lightExit;

        break;
      }

      // ── Scanner ───────────────────────────────────
      case 'scanner': {
        const baseGeo = new THREE.BoxGeometry(0.50, 0.15, 0.375);
        const base = new THREE.Mesh(baseGeo, accentMat);
        base.position.y = 0.075;
        group.add(base);

        // Mirror head
        headGroup = new THREE.Group();
        headGroup.position.y = 0.25;

        const mirrorGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.20, 12);
        const mirror = new THREE.Mesh(mirrorGeo, new THREE.MeshStandardMaterial({
          color: 0xcccccc, roughness: 0.1, metalness: 0.8,
        }));
        mirror.rotation.x = Math.PI / 2;
        mirror.position.y = 0.10;
        headGroup.add(mirror);

        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.125, 0.05),
          bodyMat,
        );
        arm.position.y = 0.05;
        headGroup.add(arm);

        group.add(headGroup);

        bodyMesh = base;
        lightTarget = mirror;
        break;
      }

      // ── LED PAR ───────────────────────────────────
      case 'led_par': {
        // Can body
        const canGeo = new THREE.CylinderGeometry(0.20, 0.25, 0.45, 16);
        const can = new THREE.Mesh(canGeo, bodyMat);
        can.position.y = 0.225;
        group.add(can);

        // Face ring
        const faceRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.225, 0.025, 8, 16),
          accentMat,
        );
        faceRing.position.y = 0.45;
        group.add(faceRing);

        // Light face (flat disc)
        const faceGeo = new THREE.CircleGeometry(0.10, 16);
        const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
          color: 0x111111, roughness: 0.2, metalness: 0.1,
        }));
        face.rotation.x = -Math.PI / 2;
        face.position.y = 0.453;
        group.add(face);

        // Small base
        const baseGeo = new THREE.CylinderGeometry(0.175, 0.15, 0.075, 16);
        const base = new THREE.Mesh(baseGeo, accentMat);
        base.position.y = 0.0375;
        group.add(base);

        bodyMesh = can;
        lightTarget = face;
        break;
      }

      // ── Strobe ────────────────────────────────────
      case 'strobe': {
        const boxGeo = new THREE.BoxGeometry(0.50, 0.20, 0.25);
        const box = new THREE.Mesh(boxGeo, accentMat);
        box.position.y = 0.10;
        group.add(box);

        // Front face with reflector texture look
        const reflector = new THREE.Mesh(
          new THREE.PlaneGeometry(0.40, 0.125),
          new THREE.MeshStandardMaterial({
            color: 0xdddddd, roughness: 0.3, metalness: 0.4,
          }),
        );
        reflector.position.set(0, 0.10, 0.1275);
        group.add(reflector);

        bodyMesh = box;
        lightTarget = reflector;
        break;
      }

      // ── Default / unknown type: sphere head like moving_head ──
      default: {
        // Materials
        const metalMat = new THREE.MeshStandardMaterial({
          color: 0x2a2a35, roughness: 0.3, metalness: 0.8,
        });
        const headMatDef = new THREE.MeshStandardMaterial({
          color: tierColor, roughness: 0.35, metalness: 0.5,
          emissive: tierColor, emissiveIntensity: 0.2,
        });

        // Base plate: minimal anchor disc
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.04, 12), metalMat);
        base.position.y = 0.02;
        group.add(base);

        // Yoke arms
        armGroup = new THREE.Group();
        armGroup.position.y = 0.10;
        const yokeMat = new THREE.MeshStandardMaterial({ color: 0x333340, roughness: 0.4, metalness: 0.75 });
        const la2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.06), yokeMat);
        la2.position.set(-0.12, 0.14, 0);
        armGroup.add(la2);
        const ra2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.06), yokeMat);
        ra2.position.set(0.12, 0.14, 0);
        armGroup.add(ra2);
        const xb2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.06), yokeMat);
        xb2.position.y = 0.28;
        armGroup.add(xb2);
        group.add(armGroup);

        // Head: sphere
        headGroup = new THREE.Group();
        headGroup.position.y = 0.30;
        headGroup.name = 'head';
        const headBody = new THREE.Mesh(new THREE.SphereGeometry(0.08, 24, 16), headMatDef);
        headBody.castShadow = true;
        headGroup.add(headBody);
        const lightExitDef = new THREE.Group();
        // Light exit at bottom point of sphere (y = -radius)
        lightExitDef.position.set(0, -0.08, 0);
        lightExitDef.name = 'lightExit';
        headGroup.add(lightExitDef);
        armGroup.add(headGroup);

        bodyMesh = base;
        lightTarget = lightExitDef;
        break;
      }
    }

    // If fixture has pan/tilt channels but no arm/head yet, create them
    if (!armGroup && !headGroup) {
      const hasPan = channelMap.panOffset !== null;
      const hasTilt = channelMap.tiltOffset !== null;
      if (hasPan || hasTilt) {
        armGroup = new THREE.Group();
        armGroup.position.y = 0.15;
        armGroup.name = 'arm';

        headGroup = new THREE.Group();
        headGroup.position.y = 0;
        headGroup.name = 'head';

        // Move bodyMesh and lightTarget into head → arm → group
        group.remove(bodyMesh);
        if (lightTarget !== bodyMesh) group.remove(lightTarget);
        headGroup.add(bodyMesh);
        if (lightTarget !== bodyMesh) headGroup.add(lightTarget);
        armGroup.add(headGroup);
        group.add(armGroup);
      }
    }

    // Multi-arm fixtures (e.g. Tonio 6 arm): one extra head per additional tilt channel.
    // Heads are arranged in a circle around the center and share the arm (pan).
    const extraHeads: ExtraHead3D[] = [];
    const extraTilts = (channelMap.tiltOffsets?.length ?? 0) > 1
      ? channelMap.tiltOffsets.slice(1)
      : [];
    if (extraTilts.length > 0 && armGroup) {
      const extraMat = new THREE.MeshStandardMaterial({
        color: tierColor, roughness: 0.35, metalness: 0.5,
        emissive: tierColor, emissiveIntensity: 0.2,
      });
      const n = extraTilts.length;
      extraTilts.forEach((off, k) => {
        const angle = (k / n) * Math.PI * 2;
        const radius = 0.34;
        const eh = new THREE.Group();
        eh.position.set(Math.cos(angle) * radius, 0.30, Math.sin(angle) * radius);
        eh.name = 'extraHead';
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), extraMat);
        sphere.castShadow = true;
        eh.add(sphere);
        const exit = new THREE.Group();
        exit.position.set(0, -0.10, 0);
        exit.name = 'lightExit';
        eh.add(exit);
        armGroup.add(eh);
        extraHeads.push({ headGroup: eh, lightTarget: exit, tiltOffset: off, _mountTilt: 0 });
      });
    }

    group.castShadow = false;
    group.receiveShadow = false;

    // ── Thumbnail sprite: remplace la sphère / body par l'icône fixture ──
    let thumbSprite: THREE.Sprite | undefined;
    const tex = getThumbTexture(fixture.thumbnailId, fixture.fixtureType);
    if (tex) {
      const hasMovement = (channelMap.panOffsets?.length ?? 0) > 0 || (channelMap.tiltOffsets?.length ?? 0) > 0 || !!armGroup;
      const scale = 0.55 * (pos.thumbnailScale ?? 0.75) / 0.75;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true });
      thumbSprite = new THREE.Sprite(mat);
      thumbSprite.scale.set(scale, scale, 1);
      thumbSprite.userData.fixtureId = fixture.id;
      // Attach inside headGroup if moving, otherwise at group center
      if (headGroup) {
        // Hide sphere mesh, keep lightExit
        for (const c of [...headGroup.children]) {
          if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry instanceof THREE.SphereGeometry) (c as THREE.Mesh).visible = false;
        }
        thumbSprite.position.set(0, 0, 0);
        headGroup.add(thumbSprite);
      } else {
        // Static fixture: hide body box/cylinder, show sprite slightly above
        (bodyMesh as any).visible = false;
        thumbSprite.position.set(0, 0.35, 0);
        group.add(thumbSprite);
      }
      // Extra heads also get thumbnails (smaller)
      for (const eh of extraHeads) {
        for (const c of [...eh.headGroup.children]) {
          if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry instanceof THREE.SphereGeometry) (c as THREE.Mesh).visible = false;
        }
        const ehMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true });
        const ehSpr = new THREE.Sprite(ehMat);
        ehSpr.scale.set(scale * 0.7, scale * 0.7, 1);
        ehSpr.position.set(0, 0, 0);
        eh.headGroup.add(ehSpr);
      }
    }

    return {
      id: fixture.id,
      group,
      bodyMesh,
      thumbSprite,
      armGroup,
      headGroup,
      lightTarget,
      channelMap,
      universeIndex: universeIndexMap.get(fixture.universeId) ?? 0,
      mountMode: pos.mountMode || 'top',
      beamAngle: pos.beamAngle ?? 0.15,
      _staticTilt: (pos.tilt ?? 0) * Math.PI / 180,
      _mountTilt: 0,
      trailPositions: [],
      trailLastAdd: 0,
      extraHeads: extraHeads.length > 0 ? extraHeads : undefined,
    };
  }, [universeIndexMap, thumbDataUrlMap]);

  // ── Scene initialization ──────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const W = container.clientWidth;
    const H = container.clientHeight;

    // Local stage dimensions (shadow module defaults) — scene rebuilds on resize
    const STAGE_WIDTH = stageDims.width;
    const STAGE_DEPTH = stageDims.depth;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);
    scene.fog = new THREE.FogExp2(0x0a0a18, 0.0008);
    // Environment map so metallic materials (aluminum truss, fixtures) read as bright metal
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();
    sceneRef.current = scene;

    // Camera — audience view by default, pulled back so the whole stage fits
    // (a saved preset camera, if any, is applied right after by the view3D effect)
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, Math.max(80, STAGE_WIDTH + STAGE_DEPTH + 60));
    const defaultTarget = new THREE.Vector3(0, STAGE_HEIGHT + 1.5, 0);
    const defaultPos = new THREE.Vector3(0, 1.2, -STAGE_DEPTH / 2 - 4);
    ensureStageFits(camera, STAGE_WIDTH, STAGE_DEPTH, defaultPos, defaultTarget);
    camera.position.copy(defaultPos);
    camera.lookAt(defaultTarget);
    cameraRef.current = camera;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(defaultTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = Math.max(30, STAGE_WIDTH + STAGE_DEPTH + 20);
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.update();
    controlsRef.current = controls;

    // Forward every free-flight camera change to the parent so it persists in
    // the preset. emitView3DCameraCoalesced microtask-collapses the burst of
    // 'change' events fired during a single drag gesture into one update.
    controls.addEventListener('change', emitView3DCameraCoalesced);

    // ── Lighting ───────────────────────────────────
    // Ambient
    const ambient = new THREE.AmbientLight(0x1a1a3e, 0.6);
    scene.add(ambient);

    // Hemisphere (sky/ground)
    const hemiLight = new THREE.HemisphereLight(0x1a1a3e, 0x0a0a14, 0.4);
    scene.add(hemiLight);

    // ── Floor ──────────────────────────────────────
    // Floor plane (ground level, extended under the audience camera)
    const floorGeo = new THREE.PlaneGeometry(STAGE_WIDTH + 8, STAGE_DEPTH + 18);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -4);
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid (on ground level)
    const gridHelper = new THREE.PolarGridHelper(
      Math.max(STAGE_WIDTH, STAGE_DEPTH) / 2 + 5,
      64,
      32,
      64,
      0x2a2a4e,
      0x2a2a4e,
    );
    gridHelper.position.set(0, 0.005, -4);
    scene.add(gridHelper);

    // Stage volume (3D box for thickness)
    const stageVolumeGeo = new THREE.BoxGeometry(STAGE_WIDTH + 0.1, STAGE_THICKNESS, STAGE_DEPTH + 0.1);
    const stageVolumeMat = new THREE.MeshStandardMaterial({
      color: 0x111122,
      roughness: 0.8,
      metalness: 0.1,
    });
    const stageVolume = new THREE.Mesh(stageVolumeGeo, stageVolumeMat);
    stageVolume.position.y = STAGE_HEIGHT - STAGE_THICKNESS / 2;
    stageVolume.receiveShadow = true;
    stageVolume.castShadow = true;
    scene.add(stageVolume);

    // Stage platform top
    const stageGeo = new THREE.PlaneGeometry(STAGE_WIDTH, STAGE_DEPTH);
    const stageMat = new THREE.MeshStandardMaterial({
      color: 0x151525,
      roughness: 0.7,
      metalness: 0.05,
    });
    const stage = new THREE.Mesh(stageGeo, stageMat);
    stage.rotation.x = -Math.PI / 2;
    stage.position.y = STAGE_HEIGHT + 0.01;
    stage.receiveShadow = true;
    scene.add(stage);

    // Stage edge line
    const edgeGeo = new THREE.EdgesGeometry(stageGeo);
    const edgeLine = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0x3a3a5e, linewidth: 1 }),
    );
    edgeLine.rotation.x = -Math.PI / 2;
    edgeLine.position.y = STAGE_HEIGHT + 0.015;
    scene.add(edgeLine);

    // Stage front lip overlay (reinforces the edge visually)
    const lipGeo = new THREE.BoxGeometry(STAGE_WIDTH + 0.05, 0.04, 0.15);
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a4a,
      roughness: 0.5,
      metalness: 0.4,
    });
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.position.set(0, STAGE_HEIGHT, -(STAGE_DEPTH / 2) - 0.07);
    scene.add(lip);

    // ── Truss (Prolyte H30-style triangular truss) ──
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0xc8d0db, roughness: 0.22, metalness: 0.95,
    });

    // Helper: cylinder strut between two points (used for diagonal web members)
    const makeStrut = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len < 1e-4) return null;
      const geo = new THREE.CylinderGeometry(r, r, len, 6);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(a).addScaledVector(dir, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return m;
    };

    // Build a 3-chord triangular truss along local X, then orient to the target axis
    const buildTriTruss = (length: number, axis: 'x' | 'y' | 'z') => {
      const g = new THREE.Group();
      const chordR = 0.04;   // main chord tube radius
      const diagR = 0.02;    // diagonal web tube radius
      const triW = 0.55;     // triangle base width
      const triH = 0.55;     // triangle height (apex to base)
      const half = length / 2;

      // 3 main chords (top apex + two bottom booms) running the full length
      const chordGeo = new THREE.CylinderGeometry(chordR, chordR, length, 10);
      chordGeo.rotateZ(Math.PI / 2); // cylinder Y-axis -> X-axis
      const chordYs = [triH / 2, -triH / 2, -triH / 2];
      const chordZs = [0, -triW / 2, triW / 2];
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(chordGeo, trussMat);
        c.position.set(0, chordYs[i], chordZs[i]);
        g.add(c);
      }

      // Warren/chevron diagonal web + bottom lateral rungs
      const panel = 0.5;
      const nPanels = Math.max(1, Math.round(length / panel));
      const p = length / nPanels;
      const top = (x: number) => new THREE.Vector3(x, triH / 2, 0);
      const botL = (x: number) => new THREE.Vector3(x, -triH / 2, -triW / 2);
      const botR = (x: number) => new THREE.Vector3(x, -triH / 2, triW / 2);

      for (let i = 0; i <= nPanels; i++) {
        const x = -half + i * p;
        // bottom lateral rung (closes the triangle base at each node)
        const rung = makeStrut(botL(x), botR(x), diagR, trussMat);
        if (rung) g.add(rung);
        // chevron: two diagonals from top node down to the two bottom nodes of next panel
        if (i < nPanels) {
          const xn = x + p;
          const d1 = makeStrut(top(x), botL(xn), diagR, trussMat);
          const d2 = makeStrut(top(x), botR(xn), diagR, trussMat);
          if (d1) g.add(d1);
          if (d2) g.add(d2);
        }
      }

      // Orient along the requested axis
      if (axis === 'z') g.rotation.y = Math.PI / 2;
      else if (axis === 'y') g.rotation.z = Math.PI / 2;
      return g;
    };

    const hw = STAGE_WIDTH / 2;
    const hd = STAGE_DEPTH / 2;
    const th = TRUSS_HEIGHT;

    // Back beam (always visible)
    const backBeam = buildTriTruss(STAGE_WIDTH, 'x');
    backBeam.position.set(0, STAGE_HEIGHT + th, hd);
    scene.add(backBeam);

    // Front beam (rear-front / full)
    const frontBeam = buildTriTruss(STAGE_WIDTH, 'x');
    frontBeam.position.set(0, STAGE_HEIGHT + th, -hd);
    frontBeam.visible = true;
    scene.add(frontBeam);

    // Left beam (full only)
    const leftBeam = buildTriTruss(STAGE_DEPTH, 'z');
    leftBeam.position.set(-hw, STAGE_HEIGHT + th, 0);
    leftBeam.visible = false;
    scene.add(leftBeam);

    // Right beam (full only)
    const rightBeam = buildTriTruss(STAGE_DEPTH, 'z');
    rightBeam.position.set(hw, STAGE_HEIGHT + th, 0);
    rightBeam.visible = false;
    scene.add(rightBeam);

    // Store beam refs
    trussBeamsRef.current = { back: backBeam, front: frontBeam, left: leftBeam, right: rightBeam, poles: [] };

    // Vertical support towers (4 corners, triangular truss columns)
    const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]];
    for (const [cx, cz] of corners) {
      const pole = buildTriTruss(TRUSS_HEIGHT, 'y');
      pole.position.set(cx, STAGE_HEIGHT + th / 2, cz);
      pole.userData = { corner: `${cx > 0 ? 'right' : 'left'}-${cz > 0 ? 'back' : 'front'}` };
      scene.add(pole);
      trussBeamsRef.current.poles.push(pole);
    }

    // ── Smoke/Haze particles ───────────────────────
    const particleCount = 300;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * STAGE_WIDTH * 1.5;
      positions[i * 3 + 1] = STAGE_HEIGHT + Math.random() * 4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * STAGE_DEPTH * 1.5;
      velocities[i] = 0.2 + Math.random() * 0.5;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x888899,
      size: 0.15,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    particles.userData = { velocities };
    scene.add(particles);
    particlesRef.current = particles;

    // ── Render loop ────────────────────────────────
    const timer = timerRef.current;

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      const dt = Math.min(timer.getDelta(), 0.1);
      controls.update();

      // Animate smoke particles
      if (showSmoke && particles.visible) {
        const posArr = particles.geometry.attributes.position.array as Float32Array;
        const vels = particles.userData.velocities as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          posArr[i * 3 + 1] += vels[i] * dt * 0.3;
          if (posArr[i * 3 + 1] > STAGE_HEIGHT + 4) {
            posArr[i * 3 + 1] = STAGE_HEIGHT;
            posArr[i * 3] = (Math.random() - 0.5) * STAGE_WIDTH * 1.5;
            posArr[i * 3 + 2] = (Math.random() - 0.5) * STAGE_DEPTH * 1.5;
          }
        }
        particles.geometry.attributes.position.needsUpdate = true;
      }

      // Animate musicians (subtle sway)
      const mg = musiciansGroupRef.current;
      if (mg && mg.visible) {
        const t = timer.getElapsed();
        for (const m of musiciansRef.current) {
          m.sprite.position.y = m.baseY + Math.sin(t * 1.6 + m.phase) * 0.025;
          m.sprite.rotation.z = Math.sin(t * 0.9 + m.phase) * 0.04;
        }
      }

      // DMX polling (30fps)
      const now = performance.now();
      if (now - lastDmxPollRef.current >= DMX_POLL_INTERVAL) {
        lastDmxPollRef.current = now;
        updateDmxState();
      }

      renderer.render(scene, camera);
    };

    animate();

    // ── Cleanup ────────────────────────────────────
    return () => {
      controls.removeEventListener('change', emitView3DCameraCoalesced);
      cancelAnimationFrame(animFrameRef.current);
      // Dispose fixtures (geometries/materials/textures)
      for (const f3d of fixturesRef.current.values()) {
        try { scene.remove(f3d.group); } catch {}
        try { disposeFixture3D(f3d); } catch {}
      }
      fixturesRef.current.clear();
      // Dispose particles
      if (particlesRef.current) {
        try { scene.remove(particlesRef.current); } catch {}
        try { particlesRef.current.geometry.dispose(); } catch {}
        try { (particlesRef.current.material as any)?.dispose?.(); } catch {}
        particlesRef.current = null;
      }
      // Dispose truss
      try {
        const tb = trussBeamsRef.current;
        [tb.back, tb.front, tb.left, tb.right, ...(tb.poles || [])].forEach((o: any) => {
          if (!o) return;
          try { scene.remove(o); } catch {}
          o.traverse?.((c: any) => {
            try { c.geometry?.dispose?.(); } catch {}
            try {
              if (Array.isArray(c.material)) c.material.forEach((m: any) => m?.dispose?.());
              else c.material?.dispose?.();
            } catch {}
          });
        });
        trussBeamsRef.current = { back: null, front: null, left: null, right: null, poles: [] };
      } catch {}
      // Dispose musicians
      if (musiciansGroupRef.current) {
        try { scene.remove(musiciansGroupRef.current); } catch {}
        musiciansGroupRef.current.traverse((o: any) => {
          if (o instanceof THREE.Sprite) {
            try { (o.material as any).map?.dispose?.(); } catch {}
            try { (o.material as any)?.dispose?.(); } catch {}
          }
        });
        musiciansGroupRef.current = null;
      }
      musiciansRef.current = [];
      // Dispose env
      try { (envTex as any)?.dispose?.(); } catch {}
      try { if (scene.environment) (scene.environment as any).dispose?.(); } catch {}
      scene.environment = null;
      (scene as any).background = null;
      (scene as any).fog = null;
      renderer.dispose();
      controls.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [stageDims]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Overlay gizmo (axes) ──────────────────────────
  // Minimal gizmo via HTML (évite 2e renderer) — coin bas-gauche
  const Gizmo: React.FC = () => (
    <div className="absolute bottom-2 left-2 w-10 h-10 rounded bg-black/40 border border-white/10 flex items-center justify-center text-[8px] text-white/60 pointer-events-none select-none">XYZ</div>
  );

  // ── Apply external 3D view state ───────────────────────
  // When the parent (preset) hands us a `view3DProp`, sync the camera to its
  // position/target. We compare values (not array identity) so that the
  // microtask-coalesced self-emit from the drag handler doesn't re-trigger
  // an apply on every render.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const cp = view3DProp?.cameraPosition;
    const ct = view3DProp?.cameraTarget;
    if (!cp || !ct) return;
    const same = (a: [number, number, number], b: [number, number, number]) =>
      Math.abs(a[0]-b[0]) < 1e-4 && Math.abs(a[1]-b[1]) < 1e-4 && Math.abs(a[2]-b[2]) < 1e-4;
    const cur = camera.position;
    const tgt = controls.target;
    const currentPos: [number, number, number] = [cur.x, cur.y, cur.z];
    const currentTgt: [number, number, number] = [tgt.x, tgt.y, tgt.z];
    if (same(currentPos, cp) && same(currentTgt, ct)) return;
    camera.position.set(cp[0], cp[1], cp[2]);
    controls.target.set(ct[0], ct[1], ct[2]);
    controls.update();
  }, [view3DProp?.cameraPosition, view3DProp?.cameraTarget]);

  // ── Handle resize ───────────────────────────────────
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!container || !camera || !renderer) return;
      const W = container.clientWidth;
      const H = container.clientHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W, H);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Handle container resize (floating window) ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const el = containerRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      if (!el || !camera || !renderer) return;
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (W === 0 || H === 0) return;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W, H);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Show/hide smoke ────────────────────────────────
  useEffect(() => {
    if (particlesRef.current) {
      particlesRef.current.visible = showSmoke;
    }
  }, [showSmoke]);

  // ── Virtual musicians: build sprites for the selected config ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Dispose previous group
    const prev = musiciansGroupRef.current;
    if (prev) {
      if (prev.parent) prev.parent.remove(prev);
      prev.traverse((o) => {
        if (o instanceof THREE.Sprite) {
          const m = (o as THREE.Sprite).material as THREE.SpriteMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
    }
    musiciansRef.current = [];
    musiciansGroupRef.current = null;

    if (isRosterEmpty(musicians)) return;

    const group = new THREE.Group();
    group.name = 'musicians';
    musiciansGroupRef.current = group;

    const dims = stageDimsRef.current;
    const refs: { sprite: THREE.Sprite; phase: number; baseY: number }[] = [];

    let i = 0;
    for (const kind of MUSICIAN_KINDS) {
      const count = musicians[kind] ?? 0;
      for (let j = 0; j < count; j++) {
        const id = `${kind}-${j}`;
        const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: true, depthTest: true });
        mat.visible = false; // hidden until the image texture loads
        const sprite = new THREE.Sprite(mat);
        sprite.userData.musicianId = id;
        const personH = MUSICIAN_HEIGHTS[kind];
        sprite.scale.set(personH, personH, 1); // placeholder; aspect set on load
        const baseY = STAGE_HEIGHT + personH / 2;
        const pos = musicianPositionsRef.current[id] ?? DEFAULT_POSITIONS[kind];
        sprite.position.set((pos.x - 0.5) * dims.width, baseY, (pos.z - 0.5) * dims.depth);
        group.add(sprite);
        refs.push({ sprite, phase: i * 1.3, baseY });

        loadMusicianTexture(kind)
          .then(tex => {
            mat.map = tex;
            mat.needsUpdate = true;
            mat.visible = true;
            const img = tex.image as HTMLCanvasElement;
            const aspect = img.height / img.width;
            sprite.scale.set(personH / aspect, personH, 1);
          })
          .catch(() => {});
        i++;
      }
    }

    musiciansRef.current = refs;
    scene.add(group);
  }, [musicians, stageDims]);

  // ── Virtual musicians: drag to reposition on stage ──
  useEffect(() => {
    const dom = rendererRef.current?.domElement;
    if (!dom) return;

    const pick = (e: PointerEvent): string | null => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      if (!container || !camera) return null;
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const sprites = musiciansRef.current.map((m) => m.sprite);
      if (sprites.length === 0) return null;
      const hits = raycasterRef.current.intersectObjects(sprites, false);
      if (hits.length === 0) return null;
      return (hits[0].object.userData.musicianId as string) ?? null;
    };

    const stagePoint = (e: PointerEvent): THREE.Vector3 | null => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      if (!container || !camera) return null;
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -STAGE_HEIGHT);
      const out = new THREE.Vector3();
      return raycasterRef.current.ray.intersectPlane(plane, out) ? out : null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const id = pick(e);
      if (!id) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      dragMusicianRef.current = id;
      const controls = controlsRef.current;
      if (controls) controls.enabled = false;
    };

    const onMove = (e: PointerEvent) => {
      const id = dragMusicianRef.current;
      if (!id) return;
      const p = stagePoint(e);
      if (!p) return;
      const dims = stageDimsRef.current;
      const nx = THREE.MathUtils.clamp((p.x + dims.width / 2) / dims.width, 0.03, 0.97);
      const nz = THREE.MathUtils.clamp((p.z + dims.depth / 2) / dims.depth, 0.03, 0.97);
      musicianPositionsRef.current[id] = { x: nx, z: nz };
      const m = musiciansRef.current.find((mm) => mm.sprite.userData.musicianId === id);
      if (m) {
        m.sprite.position.x = (nx - 0.5) * dims.width;
        m.sprite.position.z = (nz - 0.5) * dims.depth;
      }
    };

    const onUp = () => {
      if (dragMusicianRef.current) {
        const controls = controlsRef.current;
        if (controls) controls.enabled = true;
        dragMusicianRef.current = null;
      }
    };

    dom.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [stageDims]);

  // ── Truss visibility by stage scene ────────────────
  useEffect(() => {
    const tr = trussBeamsRef.current;
    const isEmpty = stageScene === 'empty';
    // Back beam — hidden en scène vide
    if (tr.back) tr.back.visible = !isEmpty;
    // Front beam: rear-front or full
    if (tr.front) tr.front.visible = !isEmpty && stageScene !== 'rear';
    // Side beams: full only
    if (tr.left) tr.left.visible = !isEmpty && stageScene === 'full';
    if (tr.right) tr.right.visible = !isEmpty && stageScene === 'full';
    // Poles: back corners always visible sauf vide; front corners pour rear-front/full
    for (const pole of tr.poles) {
      const corner: string = pole.userData.corner || '';
      if (isEmpty) {
        pole.visible = false;
      } else if (corner.includes('back')) {
        pole.visible = true;
      } else {
        pole.visible = stageScene !== 'rear';
      }
    }
  }, [stageScene]);

  // ── Sync fixtures when definitions ready ────────────
  useEffect(() => {
    if (!fixtureDefsReady) return;
    const defsPromise = loadFixtureDefinitions(
      patchedFixtures.map(f => f.fixtureDefId).filter(Boolean),
    );

    defsPromise.then(defs => {
      const scene = sceneRef.current;
      if (!scene) return;

      const currentIds = new Set(patchedFixtures.map(f => f.id));
      const existingIds = new Set(fixturesRef.current.keys());

      // Remove fixtures that are no longer patched
      for (const [id, f3d] of fixturesRef.current) {
        if (!currentIds.has(id)) {
          scene.remove(f3d.group);
          if (f3d.pointLight) scene.remove(f3d.pointLight);
          if (f3d.beamCone) scene.remove(f3d.beamCone);
          if (f3d.floorSpot) scene.remove(f3d.floorSpot);
          if (f3d.floorGlow) scene.remove(f3d.floorGlow);
          if (f3d.trailLine) { scene.remove(f3d.trailLine); f3d.trailLine.geometry.dispose(); (f3d.trailLine.material as THREE.Material).dispose(); }
          disposeFixture3D(f3d);
          fixturesRef.current.delete(id);
        }
      }

      // Add new fixtures
      for (const pf of patchedFixtures) {
        if (existingIds.has(pf.id)) continue;

        const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: pf.fixtureType === 'moving_head' || pf.fixtureType === 'scanner' ? 0.6 : 0.3, heading: 0 };
        const channelMap = analyzeFixtureChannels(pf, defs.get(pf.fixtureDefId));
        const f3d = createFixtureGeometry(pf, pos, channelMap, defs);
        scene.add(f3d.group);

        // PointLight & beam cone share lightTarget (lightExit at lens face z=0.325)
        const pointLight = new THREE.PointLight(0xffffff, 0, 8, 2);
        pointLight.position.set(0, 0, 0);
        pointLight.visible = showBeams;
        f3d.lightTarget.add(pointLight);
        f3d.pointLight = pointLight;

        // Create beam cone - attached to lightTarget (lens), points along local -Y then rotated by headGroup
        const coneHeight = BEAM_LENGTH;
        const coneRadiusBottom = coneHeight * Math.tan(0.15);
        const coneGeo = new THREE.CylinderGeometry(0.03, coneRadiusBottom, coneHeight, 24, 1, true);
        const coneMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.raycast = () => {}; // beam is visual only — never a pick target
        f3d.mountMode = pos.mountMode || 'top';
        f3d.beamAngle = pos.beamAngle ?? 0.15;
        // Cone starts at origin (lens) and extends down in local space
        cone.position.set(0, -coneHeight / 2, 0);
        cone.visible = showBeams;
        // Attach to lightTarget (lightExit) - follows pan/tilt from lens face
        f3d.lightTarget.add(cone);
        f3d.beamCone = cone;

        // Extra heads: one point light + beam cone per arm
        for (const eh of f3d.extraHeads ?? []) {
          const ehLight = new THREE.PointLight(0xffffff, 0, 8, 2);
          ehLight.visible = showBeams;
          eh.lightTarget.add(ehLight);
          eh.pointLight = ehLight;
          const ehCone = new THREE.Mesh(coneGeo, coneMat.clone());
          ehCone.raycast = () => {}; // beam is visual only — never a pick target
          ehCone.position.set(0, -coneHeight / 2, 0);
          ehCone.visible = showBeams;
          eh.lightTarget.add(ehCone);
          eh.beamCone = ehCone;
        }

        // ── Floor spot (light circle on stage floor) ──
        const spotRadius = 0.3;
        const spotGeo = new THREE.CircleGeometry(spotRadius, 32);
        const spotMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const floorSpot = new THREE.Mesh(spotGeo, spotMat);
        floorSpot.rotation.x = -Math.PI / 2;
        floorSpot.position.y = 0.015;
        floorSpot.visible = showBeams;
        scene.add(floorSpot);
        f3d.floorSpot = floorSpot;

        // ── Floor glow (larger soft outer ring) ──
        const glowRadius = 0.6;
        const glowGeo = new THREE.CircleGeometry(glowRadius, 32);
        const glowMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const floorGlow = new THREE.Mesh(glowGeo, glowMat);
        floorGlow.rotation.x = -Math.PI / 2;
        floorGlow.position.y = 0.012;
        floorGlow.visible = showBeams;
        scene.add(floorGlow);
        f3d.floorGlow = floorGlow;

        fixturesRef.current.set(pf.id, f3d);

        // Movement trail line
        const trailGeo = new THREE.BufferGeometry();
        const trailVerts = new Float32Array(MAX_TRAIL_POINTS * 3);
        trailVerts.fill(0);
        trailGeo.setAttribute('position', new THREE.BufferAttribute(trailVerts, 3));
        trailGeo.setDrawRange(0, 0);
        const trailMat = new THREE.LineBasicMaterial({
          color: 0x8b5cf6,
          transparent: true,
          opacity: 0.6,
          linewidth: 1,
          depthTest: true,
          depthWrite: false,
        });
        const trailLine = new THREE.Line(trailGeo, trailMat);
        scene.add(trailLine);
        f3d.trailLine = trailLine;
      }

      // Update existing fixture positions
      for (const pf of patchedFixtures) {
        const f3d = fixturesRef.current.get(pf.id);
        if (!f3d) continue;
        const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 };
        const stageX = (pos.x - 0.5) * stageDimsRef.current.width;
        const stageZ = (pos.y - 0.5) * stageDimsRef.current.depth;
        const stageY = STAGE_HEIGHT + pos.h * 5.0;
        f3d.group.position.set(stageX, stageY, stageZ);
        f3d.group.rotation.y = ((pos.heading ?? 0) * Math.PI) / 180;
        if (pos.mountMode) f3d.mountMode = pos.mountMode;
        fitMountRotation(f3d, pos.mountMode || 'top');
        f3d._staticTilt = ((pos.tilt ?? 0) * Math.PI) / 180;
        // Update beam angle (zoom)
        if (pos.beamAngle !== undefined && f3d.beamCone) {
          f3d.beamAngle = pos.beamAngle;
          const ch = BEAM_LENGTH;
          const radius = ch * Math.tan(pos.beamAngle);
          f3d.beamCone.geometry?.dispose();
          f3d.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true);
          f3d.beamCone.position.set(0, -ch / 2, 0);
          for (const eh of f3d.extraHeads ?? []) {
            if (!eh.beamCone) continue;
            eh.beamCone.geometry?.dispose();
            eh.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true);
            eh.beamCone.position.set(0, -ch / 2, 0);
          }
        }
      }
    });

    return () => {
      // Clean up all fixtures on unmount
      for (const f3d of fixturesRef.current.values()) {
        disposeFixture3D(f3d);
      }
      fixturesRef.current.clear();
    };
  }, [fixtureDefsReady, patchedFixtures, showBeams, createFixtureGeometry, stageDims]);

  // ── Update fixture positions from store ─────────────
  // Separate effect - only updates positions, doesn't recreate geometry
  useEffect(() => {
    for (const pf of patchedFixtures) {
      const f3d = fixturesRef.current.get(pf.id);
      if (!f3d) continue;
      const pos = fixturePositions[pf.id];
      if (!pos) continue;
      const stageX = (pos.x - 0.5) * stageDimsRef.current.width;
      const stageZ = (pos.y - 0.5) * stageDimsRef.current.depth;
      const stageY = STAGE_HEIGHT + pos.h * 5.0;
      f3d.group.position.set(stageX, stageY, stageZ);
      f3d.group.rotation.y = ((pos.heading ?? 0) * Math.PI) / 180;
      if (pos.mountMode) f3d.mountMode = pos.mountMode;
      fitMountRotation(f3d, pos.mountMode || 'top');
      f3d._staticTilt = ((pos.tilt ?? 0) * Math.PI) / 180;
      if (pos.beamAngle !== undefined && f3d.beamCone) {
        f3d.beamAngle = pos.beamAngle;
        const ch = BEAM_LENGTH;
        const radius = ch * Math.tan(pos.beamAngle);
        f3d.beamCone.geometry?.dispose();
        f3d.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true);
        // Cone position: starts at origin (lens), extends down
        f3d.beamCone.position.set(0, -ch / 2, 0);
        for (const eh of f3d.extraHeads ?? []) {
          if (!eh.beamCone) continue;
          eh.beamCone.geometry?.dispose();
          eh.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true);
          eh.beamCone.position.set(0, -ch / 2, 0);
        }
      }
    }
  }, [fixturePositions, patchedFixtures]);

  // ── Show/hide beams toggle ──────────────────────────
  useEffect(() => {
    for (const f3d of fixturesRef.current.values()) {
      if (f3d.pointLight) f3d.pointLight.visible = showBeams;
      if (f3d.beamCone) f3d.beamCone.visible = showBeams;
      if (f3d.floorSpot) f3d.floorSpot.visible = showBeams;
      if (f3d.floorGlow) f3d.floorGlow.visible = showBeams;
    }
  }, [showBeams]);

  // ── DMX update function (called from render loop) ───
  const updateDmxState = useCallback(() => {
    const dmxState = useAppStore.getState().dmx;
    // Use arbitrated buffer (LTP fidèle: auto-loop LTP75 > quickshow HTP40) au lieu de channelData brut
    const bridged: Record<number, Uint8Array | number[]> = {};
    const uniCount = universes.length || 1;
    for (let u = 0; u < uniCount; u++) {
      const buf = dmxBridge.getChannels(u);
      if (buf) {
        const arr = new Uint8Array(512);
        for (const [chStr, v] of Object.entries(buf)) { const ch = Number(chStr); if (ch >= 1 && ch <= 512) arr[ch - 1] = v as number; }
        bridged[u] = arr;
      }
    }
    const hasBridged = Object.keys(bridged).length > 0;
    let channelData = hasBridged ? bridged : (dmxState.channelData as Record<number, Uint8Array | number[]>);
    const blackout = dmxState.blackout ?? false;
    const grandMaster = dmxState.grandMaster ?? 255;
    const maxPanTiltSpeed = dmxState.panTiltMaxSpeed ?? 120;
    const nowFrame = performance.now();
    const dt = Math.min(0.1, (nowFrame - lastDmxFrameRef.current) / 1000);
    lastDmxFrameRef.current = nowFrame;

    for (const f3d of fixturesRef.current.values()) {
      // Get DMX data for this fixture's universe (or synthesize from test override)
      const testVals = fixtureTestState.get(f3d.id);
      let rawData: Uint8Array | number[] | undefined = channelData[f3d.universeIndex];
      if (testVals) {
        // Merge test values over real data when available (keeps engine/modale pan-tilt).
        // Otherwise start from a neutral buffer with pan/tilt centered (128) so the beam
        // points forward instead of defaulting to DMX 0 (pointing down).
        const pfOv = patchedFixtures.find(f => f.id === f3d.id);
        const cmOv = f3d.channelMap;
        const baseAddrOv = pfOv ? pfOv.startAddress - 1 : 0;
        const base = rawData instanceof Uint8Array ? rawData : (rawData ? new Uint8Array(Object.values(rawData)) : undefined);
        const buf = base ? new Uint8Array(base) : new Uint8Array(512);
        if (!base) {
          for (const po of cmOv.panOffsets ?? []) { if (po >= 0) buf[baseAddrOv + po] = 128; }
          for (const to of cmOv.tiltOffsets ?? []) { if (to >= 0) buf[baseAddrOv + to] = 128; }
        }
        for (const [addrStr, v] of Object.entries(testVals)) {
          const idx = Number(addrStr) - 1;
          if (idx >= 0 && idx < 512) buf[idx] = v;
        }
        rawData = buf;
      }
      if (!rawData) {
        if (f3d.pointLight) f3d.pointLight.intensity = 0;
        if (f3d.beamCone) { (f3d.beamCone.material as THREE.MeshBasicMaterial).opacity = 0; }
        // Auto-sweep: slow stage scan when no DMX for 3+ seconds
        const idleSec = (performance.now() - dmxLastActivityRef.current) / 1000;
        if (idleSec > 3 && f3d.armGroup && f3d.headGroup) {
          const t = performance.now() * 0.001;
          const panTarget = Math.sin(t * 0.4) * 0.7 * Math.PI;
          const tiltTarget = f3d._mountTilt + Math.sin(t * 0.35 + 1.2) * 0.35 * Math.PI + (f3d._staticTilt ?? 0);
          f3d.armGroup.rotation.y += (panTarget - f3d.armGroup.rotation.y) * 0.15;
          f3d.headGroup.rotation.x += (tiltTarget - f3d.headGroup.rotation.x) * 0.15;
          (f3d.extraHeads ?? []).forEach((eh, k) => {
            const ehTarget = eh._mountTilt + Math.sin(t * 0.35 + 1.2 + (k + 1) * 1.1) * 0.35 * Math.PI + (f3d._staticTilt ?? 0);
            eh.headGroup.rotation.x += (ehTarget - eh.headGroup.rotation.x) * 0.15;
          });
        }
        continue;
      }
      // Normalize data to Uint8Array-like access
      const data = rawData instanceof Uint8Array ? rawData : new Uint8Array(Object.values(rawData));

      const pf = patchedFixtures.find(f => f.id === f3d.id);
      if (!pf) continue;

      const baseAddr = pf.startAddress - 1;
      const cm = f3d.channelMap;

      // --- Intensity ---
      let intensity = 0;
      if (cm.intensityOffset !== null && cm.intensityOffset >= 0) {
        intensity = data[baseAddr + cm.intensityOffset] ?? 0;
      } else if (cm.rgbOffsets) {
        const r = data[baseAddr + cm.rgbOffsets[0]] ?? 0;
        const g = data[baseAddr + cm.rgbOffsets[1]] ?? 0;
        const b = cm.rgbOffsets[2] !== undefined ? (data[baseAddr + cm.rgbOffsets[2]] ?? 0) : 0;
        intensity = Math.max(r, g, b);
      } else if (cm.isLaser && cm.wheelOffset !== null) {
        // Laser à roue (IODA…) : pas de dimmer — allumé dès que la roue porte
        // une couleur (la lecture écrit toujours une valeur > 0).
        const w = data[baseAddr + cm.wheelOffset] ?? 0;
        intensity = w > 2 ? 255 : 0;
      } else if (cm.isLaser && cm.laserModeOffset !== null) {
        // Laser simple (mode DMX toujours > 0 en lecture) : allumé = mode écrit.
        const m = data[baseAddr + cm.laserModeOffset] ?? 0;
        intensity = m > 2 ? 255 : 0;
      }

      // --- Shutter / Strobe ---
      let strobeHz = 0;
      let shutterClosed = false;
      if (cm.shutterOffset !== null && cm.shutterOffset >= 0) {
        const shutterVal = data[baseAddr + cm.shutterOffset] ?? 255;
        // DMX shutter ranges: 0-31=closed, 32-63=open, 64-95=strobe slow, 96-127=strobe fast
        // 128-179=strobe speed legacy, 180-254=DMX strobe speed (180+speed*3), 255=open (not strobe)
        if (shutterVal <= 31) {
          shutterClosed = true;
          intensity = 0;
        } else if (shutterVal >= 180 && shutterVal < 255) {
          // DMX formula: speed = (val - 180) / 3 Hz — exclude 255 which means "shutter open"
          strobeHz = Math.max(1, (shutterVal - 180) / 3);
        } else if (shutterVal >= 32 && shutterVal <= 63) {
          // Open — leave intensity as-is
        } else if (shutterVal >= 64 && shutterVal <= 179) {
          // Standard strobe range with rate ramp
          strobeHz = Math.max(1, (shutterVal - 64) / 6);
        }
      }

      // Canal Strobe dédié (strobeOffset) : 0 = pas de strobe, valeurs hautes =
      // strobe (mêmes formules DMX que le shutter). Ne ferme JAMAIS la lumière
      // (pas de shutterClosed : 0 = off, pas « closed »).
      if (cm.strobeOffset !== null && cm.strobeOffset >= 0) {
        const strobeVal = data[baseAddr + cm.strobeOffset] ?? 0;
        if (strobeVal >= 180 && strobeVal < 255) {
          strobeHz = Math.max(1, (strobeVal - 180) / 3);   // DMX strobe speed
        } else if (strobeVal >= 64 && strobeVal <= 179) {
          strobeHz = Math.max(1, (strobeVal - 64) / 6);    // strobe standard
        } else if (strobeVal >= 8 && strobeVal < 64) {
          strobeHz = Math.max(1, (strobeVal - 8) / 14);    // plage basse (bee-eye : 8+ = strobe)
        }
      }

      if (blackout) intensity = 0;
      if (disabledRef.current.has(f3d.id)) intensity = 0;
      intensity = intensity * (grandMaster / 255);

      // Apply strobe blink
      if (strobeHz > 0) {
        const phase = (performance.now() * 0.001 * strobeHz) % 1;
        if (phase > 0.5) intensity = 0; // 50% duty cycle blink
      }
      const normIntensity = intensity / 255;

      // Fixtures sélectionnées : allume un niveau de prévisualisation pour
      // voir où pointe le faisceau (indispensable pour vérifier le Target).
      const isAimSelected = selectedFixtureIdRef.current === f3d.id || multiSelectedIdsRef.current.has(f3d.id);
      const visIntensity = isAimSelected ? Math.max(normIntensity, PREVIEW_INTENSITY) : normIntensity;

      // --- Color ---
      let color = new THREE.Color(0xffffff);
      if (cm.rgbOffsets && cm.rgbOffsets.length >= 3) {
        const r = (data[baseAddr + cm.rgbOffsets[0]] ?? 0) / 255;
        const g = (data[baseAddr + cm.rgbOffsets[1]] ?? 0) / 255;
        const b = (data[baseAddr + cm.rgbOffsets[2]] ?? 0) / 255;
        if (r > 0 || g > 0 || b > 0) color.setRGB(r, g, b);
      } else if (cm.wheelOffset !== null) {
        const wheelVal = data[baseAddr + cm.wheelOffset] ?? 0;
        color = wheelValueToColor(wheelVal, cm.wheelCaps);
      }

      // --- Pan/Tilt (QLC+ model: arm=pan/Y, head=tilt/X) — les lasers sans
      // pan/tilt typés utilisent leurs axes scan X/Y (IODA…) en équivalent. ---
      const panVal = cm.panOffset !== null ? (data[baseAddr + cm.panOffset] ?? 128)
        : (cm.scanXOffset !== null ? (data[baseAddr + cm.scanXOffset] ?? 128) : 128);
      const tiltVal = cm.tiltOffset !== null ? (data[baseAddr + cm.tiltOffset] ?? 128)
        : (cm.scanYOffset !== null ? (data[baseAddr + cm.scanYOffset] ?? 128) : 128);
      dmxLastActivityRef.current = performance.now();

      // Rate-limited tracking: beam cannot turn faster than the real fixture motor
      // (maxPanTiltSpeed in °/s), so the 3D view matches the physical movement speed.
      if (f3d.armGroup) {
        const panTarget = ((panVal / 255) - 0.5) * Math.PI * 3;
        let panDelta = panTarget - f3d.armGroup.rotation.y;
        while (panDelta > Math.PI) panDelta -= 2 * Math.PI;
        while (panDelta < -Math.PI) panDelta += 2 * Math.PI;
        const panMaxStep = (maxPanTiltSpeed * Math.PI / 180) * dt;
        f3d.armGroup.rotation.y += Math.max(-panMaxStep, Math.min(panMaxStep, panDelta));
      }
      if (f3d.headGroup) {
        const dmxTilt = ((tiltVal / 255) - 0.5) * Math.PI;
        const tiltTarget = f3d._mountTilt + dmxTilt + (f3d._staticTilt ?? 0);
        const tiltDelta = tiltTarget - f3d.headGroup.rotation.x;
        const tiltMaxStep = (maxPanTiltSpeed * Math.PI / 180) * dt;
        f3d.headGroup.rotation.x += Math.max(-tiltMaxStep, Math.min(tiltMaxStep, tiltDelta));
      }

      // Extra heads: per-arm tilt, same color/intensity as the main head
      for (const eh of f3d.extraHeads ?? []) {
        const ehTiltVal = data[baseAddr + eh.tiltOffset] ?? 128;
        const dmxTilt = ((ehTiltVal / 255) - 0.5) * Math.PI;
        const ehTarget = eh._mountTilt + dmxTilt + (f3d._staticTilt ?? 0);
        const ehDelta = ehTarget - eh.headGroup.rotation.x;
        const ehMaxStep = (maxPanTiltSpeed * Math.PI / 180) * dt;
        eh.headGroup.rotation.x += Math.max(-ehMaxStep, Math.min(ehMaxStep, ehDelta));
        if (eh.pointLight) {
          eh.pointLight.color.copy(color);
          eh.pointLight.intensity = visIntensity * 25;
        }
        if (eh.beamCone) {
          const m = eh.beamCone.material as THREE.MeshBasicMaterial;
          m.color.copy(color);
          m.opacity = visIntensity * 0.35;
          eh.beamCone.visible = showBeams && visIntensity > 0.005;
        }
      }

      // --- Movement trail: sample beam hit on stage floor ---
      const nowTrail = performance.now();
      if (nowTrail - f3d.trailLastAdd >= TRAIL_ADD_INTERVAL && normIntensity > 0.05) {
        f3d.trailLastAdd = nowTrail;
        // Get beam origin (lightTarget world position)
        const origin = new THREE.Vector3();
        f3d.lightTarget.getWorldPosition(origin);
        // Get beam direction (-Z in local space, rotated by head/arm)
        const dir = new THREE.Vector3(0, 0, -1);
        const headWorld = new THREE.Matrix4();
        if (f3d.headGroup) {
          f3d.headGroup.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3());
          dir.applyQuaternion(f3d.headGroup.quaternion);
        }
        // Ray-plane intersection with stage floor (y=0)
        if (Math.abs(dir.y) > 0.001) {
          const t = -origin.y / dir.y;
          if (t > 0 && t < 50) {
            const hit = origin.clone().addScaledVector(dir, t);
            // Clamp to stage bounds
            hit.x = Math.max(-stageDimsRef.current.width/2, Math.min(stageDimsRef.current.width/2, hit.x));
            hit.z = Math.max(-stageDimsRef.current.depth/2, Math.min(stageDimsRef.current.depth/2, hit.z));
            hit.y = 0.05; // slight offset above floor
            f3d.trailPositions.push(hit);
            if (f3d.trailPositions.length > MAX_TRAIL_POINTS) {
              f3d.trailPositions.shift();
            }
          }
        }
      }
      // Update trail line geometry
      if (f3d.trailLine && f3d.trailPositions.length >= 2) {
        const geo = f3d.trailLine.geometry;
        const posAttr = geo.attributes.position as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        const n = f3d.trailPositions.length;
        for (let i = 0; i < n; i++) {
          const p = f3d.trailPositions[i];
          arr[i * 3] = p.x;
          arr[i * 3 + 1] = p.y;
          arr[i * 3 + 2] = p.z;
        }
        // Fade older points by z-fighting them slightly higher
        const mat = f3d.trailLine.material as THREE.LineBasicMaterial;
        mat.opacity = normIntensity > 0.01 ? 0.6 : 0.3;
        geo.setDrawRange(0, n);
        posAttr.needsUpdate = true;
      }

      // --- Update PointLight ---
      if (f3d.pointLight) {
        f3d.pointLight.color.copy(color);
        f3d.pointLight.intensity = visIntensity * 25;
      }

      // --- Update beam cone ---
      if (f3d.beamCone) {
        const mat = f3d.beamCone.material as THREE.MeshBasicMaterial;
        mat.color.copy(color);
        mat.opacity = visIntensity * 0.35;
        f3d.beamCone.visible = showBeams && visIntensity > 0.005;
      }

      // --- Floor spot disabled: only beam cones from lens are shown ---
      // Floor spot/glow visibility forced off
      if (f3d.floorSpot) f3d.floorSpot.visible = false;

      // --- Body visibility: always show geometry so mount rotation is visible
    if (visIntensity > 0.01) {
        const bodyMat = f3d.bodyMesh.material as THREE.MeshStandardMaterial;
        if (Array.isArray(bodyMat)) {
          for (const m of bodyMat) { m.emissive = color; m.emissiveIntensity = visIntensity * 0.8; }
        } else {
          bodyMat.emissive = color;
          bodyMat.emissiveIntensity = visIntensity * 0.8;
        }
      } else {
        const bodyMat = f3d.bodyMesh.material as THREE.MeshStandardMaterial;
        if (Array.isArray(bodyMat)) {
          for (const m of bodyMat) { m.emissiveIntensity = 0; }
        } else {
          bodyMat.emissiveIntensity = 0;
        }
      }
    }
  }, [patchedFixtures, showBeams]);

  // ── Camera presets ──────────────────────────────────
  // ── Camera presets ──────────────────────────────────
  const setCameraPreset = useCallback((preset: string) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const target = new THREE.Vector3(0, STAGE_HEIGHT + 1.5, 0);
    let pos: THREE.Vector3;

    switch (preset) {
      case 'front':
        pos = new THREE.Vector3(0, STAGE_HEIGHT + 2, stageDimsRef.current.depth / 2 + 6);
        break;
      case 'top':
        pos = new THREE.Vector3(0, 14, 0.1);
        break;
      case 'side':
        pos = new THREE.Vector3(stageDimsRef.current.width / 2 + 6, STAGE_HEIGHT + 2, 0);
        break;
      case 'audience':
        pos = new THREE.Vector3(0, 1.2, -stageDimsRef.current.depth / 2 - 4);
        break;
      default:
        return;
    }

    // Keep the preset angle but pull back if the stage would be cropped
    ensureStageFits(camera, stageDimsRef.current.width, stageDimsRef.current.depth, pos, target);

    // Animate camera
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startTime = performance.now();
    const duration = 800;

    const animateCamera = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1.0);
      // Ease in-out
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      camera.position.lerpVectors(startPos, pos, ease);
      controls.target.lerpVectors(startTarget, target, ease);
      controls.update();

      if (t < 1) {
        requestAnimationFrame(animateCamera);
      } else {
        emitView3DCameraRef.current();
      }
    };
    requestAnimationFrame(animateCamera);
  }, []);

  // ── Focus camera on a fixture (used by the quick-select list) ──
  const focusFixture = useCallback((fid: string) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const pos = fixturePositions[fid];
    if (!camera || !controls || !pos) return;
    const dims = stageDimsRef.current;
    const target = new THREE.Vector3(
      (pos.x - 0.5) * dims.width,
      STAGE_HEIGHT + (pos.h ?? 0) * 5.0,
      (pos.y - 0.5) * dims.depth
    );
    // Keep the current viewing direction, pull closer
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 0.001) dir.set(0.3, 0.5, 1);
    dir.normalize();
    const dist = Math.max(3, (pos.h ?? 0) * 5.0 + 2.5);
    const dest = target.clone().add(dir.multiplyScalar(dist));
    dest.y = Math.max(dest.y, STAGE_HEIGHT + 0.8);

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startTime = performance.now();
    const duration = 600;
    const animateCamera = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1.0);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      camera.position.lerpVectors(startPos, dest, ease);
      controls.target.lerpVectors(startTarget, target, ease);
      controls.update();
      if (t < 1) {
        requestAnimationFrame(animateCamera);
      } else {
        emitView3DCameraRef.current();
      }
    };
    requestAnimationFrame(animateCamera);
  }, [fixturePositions]);

  // ── Mode Target : pick du point visé (raycast décor complet) ────
  const pickTargetPoint = useCallback((e: React.MouseEvent<HTMLDivElement>): THREE.Vector3 | null => {
    const container = containerRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!container || !camera || !scene) return null;
    const rect = container.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, camera);
    // Tout ce qui est pickable : meshes + sprites de la scène, en excluant
    // les fixtures (et le ciel : gridHelper est une Line, déjà exclue).
    const pick: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      let p: THREE.Object3D | null = obj;
      while (p) {
        if (p.userData?.fixtureId) return;
        p = p.parent;
      }
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) pick.push(obj);
    });
    const hits = raycasterRef.current.intersectObjects(pick, false);
    if (hits.length === 0) return null;
    return hits[0].point.clone();
  }, []);

  const ensureTargetMarker = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return null;
    let mk = targetMarkerRef.current;
    if (!mk) {
      mk = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.23, 36),
        new THREE.MeshBasicMaterial({ color: 0x00ffd0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      mk.add(ring);
      mk.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x00ffd0 }),
      ));
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
        new THREE.MeshBasicMaterial({ color: 0x00ffd0, transparent: true, opacity: 0.6 }),
      );
      pole.position.y = 0.15;
      mk.add(pole);
      mk.visible = false;
      targetMarkerRef.current = mk;
    }
    if (!mk.parent) scene.add(mk);
    return mk;
  }, []);

  // ── Vise toutes les fixtures sélectionnées vers un point (pan/tilt DMX) ──
  const aimFixturesAtPoint = useCallback((point: THREE.Vector3) => {
    const ids: string[] = multiSelectedIdsRef.current.size > 0
      ? [...multiSelectedIdsRef.current]
      : (selectedFixtureIdRef.current ? [selectedFixtureIdRef.current] : []);
    if (ids.length === 0) return;
    const prog = useProgrammerStore.getState().channels;
    const setCh = useProgrammerStore.getState().setChannel;
    for (const fid of ids) {
      const f3d = fixturesRef.current.get(fid);
      const pf = patchedFixtures.find((f) => f.id === fid);
      // Seules les fixtures qui tournent réellement en 3D (arm = pan) sont visées.
      if (!f3d || !pf || !f3d.armGroup) continue;
      const cm = f3d.channelMap;
      const panCh = cm.panOffset ?? cm.panOffsets?.[0] ?? null;
      const tiltCh = cm.tiltOffset ?? cm.tiltOffsets?.[0] ?? null;
      if (panCh === null || tiltCh === null) continue;
      const panAddr = pf.startAddress + panCh;
      const curPan = prog[panAddr] ?? 128;
      const exitPos = new THREE.Vector3();
      f3d.lightTarget.getWorldPosition(exitPos);
      const solved = solvePanTilt(
        { x: exitPos.x, y: exitPos.y, z: exitPos.z },
        { x: point.x, y: point.y, z: point.z },
        {
          headingRad: f3d.group.rotation.y,
          mountTilt: f3d._mountTilt ?? 0,
          staticTilt: f3d._staticTilt ?? 0,
          armRotX: f3d.armGroup.rotation.x ?? 0,
          panCurrent: curPan,
        },
      );
      if (!solved) continue;
      // Écriture programmeur (LTP 85) — même signature que le drag Direct.
      const writePan = (v: number) => {
        for (const off of (cm.panOffsets ?? [])) setCh(pf.startAddress + off, v);
        if (cm.panOffset !== null && !(cm.panOffsets ?? []).includes(cm.panOffset)) setCh(pf.startAddress + cm.panOffset, v);
      };
      const writeTilt = (v: number) => {
        for (const off of (cm.tiltOffsets ?? [])) setCh(pf.startAddress + off, v);
        if (cm.tiltOffset !== null && !(cm.tiltOffsets ?? []).includes(cm.tiltOffset)) setCh(pf.startAddress + cm.tiltOffset, v);
      };
      writePan(solved.pan);
      writeTilt(solved.tilt);
      // Capture « look » : dimmer, couleur, strobe/shutter depuis le live
      // (dmxBridge arbitré) — défauts visibles (dimmer 255, couleur blanche,
      // shutter ouvert) si le live est éteint, pour que la scène enregistrée
      // montre le faisceau visé, pas une tête éteinte.
      const liveCh = dmxBridge.getChannels(f3d.universeIndex);
      const readLive = (off: number): number | undefined => {
        const v = liveCh?.[pf.startAddress + off];
        return typeof v === 'number' ? v : undefined;
      };
      // Dimmer
      if (cm.intensityOffset !== null && cm.intensityOffset >= 0) {
        const v = readLive(cm.intensityOffset) ?? 0;
        setCh(pf.startAddress + cm.intensityOffset, v > 0 ? v : 255);
      }
      // Couleur : segments RGB(A/W/UV) sinon rgbOffsets sinon roue
      const segs = cm.rgbSegments ?? [];
      if (segs.length > 0) {
        const any = segs.some((s) =>
          (readLive(s.r) ?? 0) > 0 || (s.g !== null && (readLive(s.g) ?? 0) > 0) || (s.b !== null && (readLive(s.b) ?? 0) > 0));
        for (const s of segs) {
          setCh(pf.startAddress + s.r, any ? (readLive(s.r) ?? 0) : 255);
          if (s.g !== null) setCh(pf.startAddress + s.g, any ? (readLive(s.g) ?? 0) : 255);
          if (s.b !== null) setCh(pf.startAddress + s.b, any ? (readLive(s.b) ?? 0) : 255);
          if (s.w !== null) setCh(pf.startAddress + s.w, any ? (readLive(s.w) ?? 0) : 255);
          if (s.a !== null && s.a !== undefined) setCh(pf.startAddress + s.a, any ? (readLive(s.a) ?? 0) : 255);
          if (s.uv !== null && s.uv !== undefined) setCh(pf.startAddress + s.uv, any ? (readLive(s.uv) ?? 0) : 255);
        }
      } else if (cm.rgbOffsets && cm.rgbOffsets.length > 0) {
        const any = cm.rgbOffsets.some((o) => (readLive(o) ?? 0) > 0);
        for (const o of cm.rgbOffsets) setCh(pf.startAddress + o, any ? (readLive(o) ?? 0) : 255);
      } else if (cm.wheelOffset !== null && cm.wheelOffset >= 0) {
        const v = readLive(cm.wheelOffset) ?? 0;
        let wv = v;
        if (v <= 2) {
          const white = cm.wheelCaps?.find((c) => {
            const n = (c.color ?? '').toLowerCase();
            return n === 'white' || n === 'open' || /^#fff/i.test(n);
          }) ?? cm.wheelCaps?.[0];
          wv = white ? Math.round((white.min + white.max) / 2) : 255;
        }
        setCh(pf.startAddress + cm.wheelOffset, wv);
      }
      // Strobe dédié : copie du live (0 si aucun)
      if (cm.strobeOffset !== null && cm.strobeOffset >= 0) {
        setCh(pf.startAddress + cm.strobeOffset, readLive(cm.strobeOffset) ?? 0);
      }
      // Shutter : garantit l'ouverture (jamais fermé à 0-31) tout en gardant
      // un éventuel strobe shutter live (32-255).
      if (cm.shutterOffset !== null && cm.shutterOffset >= 0) {
        const v = readLive(cm.shutterOffset) ?? 255;
        setCh(pf.startAddress + cm.shutterOffset, v > 31 ? v : 255);
      }
      // Bras complémentaires (Tonio 6 arm) : même pan, tilt propre par tête.
      for (const eh of f3d.extraHeads ?? []) {
        const ehPos = new THREE.Vector3();
        eh.lightTarget.getWorldPosition(ehPos);
        const sub = solveTiltForFixedPan(
          { x: ehPos.x, y: ehPos.y, z: ehPos.z },
          { x: point.x, y: point.y, z: point.z },
          solved.phi,
          {
            headingRad: f3d.group.rotation.y,
            mountTilt: eh._mountTilt ?? f3d._mountTilt ?? 0,
            staticTilt: f3d._staticTilt ?? 0,
            armRotX: f3d.armGroup.rotation.x ?? 0,
          },
        );
        if (sub) setCh(pf.startAddress + eh.tiltOffset, sub.tilt);
      }
    }
  }, [patchedFixtures]);

  // ── Canvas click handler (raycasting) ─────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!container || !camera) return;

    // Mode Target : un clic vise TOUTES les fixtures sélectionnées.
    // Agit uniquement sur le clic (pas le mousedown) pour laisser OrbitControls
    // dragger librement sans re-viser pendant l'orbite.
    if (targetModeRef.current) {
      if (e.type !== 'click') return;
      const pt = pickTargetPoint(e);
      if (pt) {
        aimFixturesAtPoint(pt);
        const mk = ensureTargetMarker();
        if (mk) {
          mk.position.copy(pt);
          mk.visible = true;
        }
      }
      return;
    }

    // La sélection/direct-drag est traitée UNE fois, sur mousedown : le
    // conteneur est aussi bindé sur onClick → les deux événements (mousedown
    // puis click) déclencheraient un double toggle avec Ctrl+clic.
    if (e.type !== 'mousedown') return;

    const rect = container.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, camera);

    const targets: THREE.Object3D[] = [];
    for (const f3d of fixturesRef.current.values()) {
      f3d.group.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) targets.push(child);
      });
    }

    const intersects = raycasterRef.current.intersectObjects(targets, false);

    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData?.fixtureId) obj = obj.parent;
      if (obj?.userData?.fixtureId) {
        const fid = obj.userData.fixtureId as string;
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        if (additive) {
          selectedFixtureIdRef.current = fid;
          const next = new Set(multiSelectedIdsRef.current);
          if (next.has(fid)) next.delete(fid); else next.add(fid);
          multiSelectedIdsRef.current = next;
          setMultiSelectedIds(new Set(next));
          if (fid !== selectedFixtureId) setSelectedFixtureId(fid);
        } else {
          selectedFixtureIdRef.current = fid;
          multiSelectedIdsRef.current = new Set([fid]);
          setMultiSelectedIds(new Set([fid]));
          if (fid !== selectedFixtureId) setSelectedFixtureId(fid);
        }
        // Direct mode : init pan/tilt drag on mousedown over selected fixture
        if (directMode && fid === selectedFixtureId) {
          const f3d = fixturesRef.current.get(fid);
          if (f3d) {
            const pf = patchedFixtures.find(f => f.id === fid);
            const prog = useProgrammerStore.getState().channels;
            const panAddr = pf ? pf.startAddress + (f3d.channelMap.panOffset ?? f3d.channelMap.panOffsets?.[0] ?? 0) : 0;
            const tiltAddr = pf ? pf.startAddress + (f3d.channelMap.tiltOffset ?? f3d.channelMap.tiltOffsets?.[0] ?? 0) : 0;
            const curPan = prog[panAddr] ?? 128;
            const curTilt = prog[tiltAddr] ?? 128;
            panTiltDragRef.current = { fixtureId: fid, startX: e.clientX, startY: e.clientY, startPan: curPan, startTilt: curTilt };
            if (controlsRef.current) controlsRef.current.enabled = false;
            e.preventDefault();
          }
        }
      }
    } else {
      // Clic à côté du panneau : on ne désélectionne PAS — la modale reste
      // ouverte (fermeture via le X du panneau). Sinon le moindre clic sur le
      // canvas faisait disparaître la modale en cours d'édition.
    }
  }, [selectedFixtureId, directMode, patchedFixtures, pickTargetPoint, aimFixturesAtPoint, ensureTargetMarker]);

  // ── Hover handler ────────────────────────────────────
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!container || !camera) return;

    const rect = container.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, camera);

    const targets: THREE.Object3D[] = [];
    for (const f3d of fixturesRef.current.values()) {
      f3d.group.traverse((child) => {
        if (child instanceof THREE.Mesh) targets.push(child);
      });
    }

    const intersects = raycasterRef.current.intersectObjects(targets, false);
    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData?.fixtureId) {
        obj = obj.parent;
      }
      setHoveredFixtureId(obj?.userData?.fixtureId as string ?? null);
    } else {
      setHoveredFixtureId(null);
    }
  }, []);

  // ── Rotate selected fixture on drag (position) + Direct Pan/Tilt via programmer ──
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      // Direct Pan/Tilt has priority when directMode
      if (panTiltDragRef.current) {
        const { fixtureId, startX, startY, startPan, startTilt } = panTiltDragRef.current;
        const f3d = fixturesRef.current.get(fixtureId);
        const pf = patchedFixtures.find(f => f.id === fixtureId);
        if (!f3d || !pf) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const pan = Math.max(0, Math.min(255, Math.round(startPan + dx * 0.7)));
        const tilt = Math.max(0, Math.min(255, Math.round(startTilt - dy * 0.7)));
        // Push to programmer (LTP 85) — visible en 3D + hardware, enregistrable via Store
        const cm = f3d.channelMap;
        const setProg = useProgrammerStore.getState().setChannel;
        for (const off of (cm.panOffsets ?? [])) setProg(pf.startAddress + off, pan);
        if (cm.panOffset !== null && !(cm.panOffsets ?? []).includes(cm.panOffset)) setProg(pf.startAddress + cm.panOffset, pan);
        for (const off of (cm.tiltOffsets ?? [])) setProg(pf.startAddress + off, tilt);
        if (cm.tiltOffset !== null && !(cm.tiltOffsets ?? []).includes(cm.tiltOffset)) setProg(pf.startAddress + cm.tiltOffset, tilt);
        // Fallback: si pas de pan/tilt DMX, bouge la tare visuelle
        if ((cm.panOffsets?.length ?? 0) === 0 && cm.panOffset === null && (cm.tiltOffsets?.length ?? 0) === 0 && cm.tiltOffset === null) {
          const h = ((pan - 128) / 128) * 90;
          const t = ((tilt - 128) / 128) * 45;
          setFixturePosition(fixtureId, { heading: h, tilt: t });
        }
        if (controlsRef.current) controlsRef.current.enabled = false;
        return;
      }
      if (!dragRotateRef.current) return;
      const { startX, startY, fixtureId } = dragRotateRef.current;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const pos = fixturePositions[fixtureId];
      if (!pos) return;
      const newHeading = ((pos.heading ?? 0) + dx * 0.5 + 360) % 360;
      const newTilt = Math.max(-90, Math.min(90, (pos.tilt ?? 0) - dy * 0.3));
      setFixturePosition(fixtureId, { heading: newHeading, tilt: newTilt });
      dragRotateRef.current = { startX: ev.clientX, startY: ev.clientY, fixtureId };
    };
    const onUp = () => {
      if (panTiltDragRef.current) {
        panTiltDragRef.current = null;
        if (controlsRef.current) controlsRef.current.enabled = true;
      }
      dragRotateRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [fixturePositions, setFixturePosition, patchedFixtures]);

  // ── Selected fixture info ────────────────────────────
  const selectedFixture = selectedFixtureId
    ? patchedFixtures.find(f => f.id === selectedFixtureId) ?? null
    : null;
  const selectedPos = selectedFixtureId
    ? fixturePositions[selectedFixtureId] ?? null
    : null;
  const hoveredFixture = hoveredFixtureId
    ? patchedFixtures.find(f => f.id === hoveredFixtureId) ?? null
    : null;

  // Toggle the selected fixture ON (dimmer max + white) / OFF on hardware + 3D
  const handleFixtureOn = async () => {
    if (!selectedFixture) return;
    if (fixtureTestState.has(selectedFixture.id)) {
      setLightOn(false);
      try { await sendFixtureOff(selectedFixture, patchedFixtures, universes); } catch { /* hardware not available */ }
    } else {
      setLightOn(true);
      try {
        const defs = await loadFixtureDefinitions([selectedFixture.fixtureDefId]);
        const def = defs.get(selectedFixture.fixtureDefId);
        const channels = def?.modes?.[selectedFixture.modeIndex]?.channels ?? [];
        await sendFixtureOn(selectedFixture, channels, patchedFixtures, universes);
      } catch { /* hardware not available */ }
    }
  };

  // Keep the button state in sync with the global test state when selection changes
  useEffect(() => {
    setLightOn(selectedFixture ? fixtureTestState.has(selectedFixture.id) : false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFixture?.id]);

  // ── EFX snapshot — uniquement si enableEfxApply (onglet Scènes) ──
  const effects = useShowStore((s) => s.effects);
  const [selectedEfxId, setSelectedEfxId] = useState<string>('');
  const handleApplyEfxSnapshot = useCallback(async () => {
    const efx = effects.find((e) => e.id === selectedEfxId);
    if (!efx) return;
    const sceneId = (window as any).__lm_selectedSceneId as string | null;
    const store = useShowStore.getState();
    // Snapshot : fige le pattern EFX à phase 0 (centre du pattern) comme valeurs DMX statiques — prévisualisable en 3D dans l'onglet Scène
    const targetIds = efx.fixtureIds.length > 0 ? new Set(efx.fixtureIds) : selectedFixtureId ? new Set([selectedFixtureId]) : new Set<string>();
    if (targetIds.size === 0) return;
    // Calcule le point du pattern à phase 0 (même math que l'aperçu live DesignView.tsx:3657)
    const phase = 0;
    const rx = efx.width * 0.7;
    const ry = efx.height * 0.7;
    const rotRad = (efx.rotation * Math.PI) / 180;
    const ox = (efx.xOffset / 255) * 0.3;
    const oy = (efx.yOffset / 255) * 0.3;
    let px = 0, py = 0;
    const seg = phase / (Math.PI * 2);
    switch (efx.pattern) {
      case 'Circle': px = Math.cos(phase) * rx; py = Math.sin(phase) * ry; break;
      case 'Line': { const lp = seg % 1; const lineX = lp < 0.5 ? (lp * 2) * 2 - 1 : (1 - (lp - 0.5) * 2) * 2 - 1; px = lineX * rx; py = 0; break; }
      case 'Eight': px = Math.sin(phase) * rx; py = Math.sin(phase * 2) * ry * 0.5; break;
      case 'Square': { const s = seg * 4; const sIdx = Math.floor(s) % 4; const sFrac = s - Math.floor(s); const cs: [number, number][] = [[1,1],[-1,1],[-1,-1],[1,-1]]; const ce: [number, number][] = [[-1,1],[-1,-1],[1,-1],[1,1]]; px = (cs[sIdx][0] + (ce[sIdx][0] - cs[sIdx][0]) * sFrac) * rx; py = (cs[sIdx][1] + (ce[sIdx][1] - cs[sIdx][1]) * sFrac) * ry; break; }
      case 'Triangle': { const ta = seg * 3; const ti = Math.floor(ta) % 3; const tf = ta - Math.floor(ta); const tv: [number, number][] = [[0,-1],[-0.866,0.5],[0.866,0.5]]; const tn = tv[(ti+1)%3]; px = (tv[ti][0] + (tn[0]-tv[ti][0])*tf)*rx; py = (tv[ti][1] + (tn[1]-tv[ti][1])*tf)*ry; break; }
      case 'Infinity': px = Math.cos(phase) * rx; py = Math.sin(phase * 2) * ry * 0.5; break;
      case 'Zigzag': { const z = (seg % 1) * 2 - 1; px = z * rx; const zs = seg * 8; const zi = Math.floor(zs); const zf = zs - zi; const zy = zi % 2 === 0 ? -1 + zf * 2 : 1 - zf * 2; py = zy * ry; break; }
      case 'Spiral': { const sc = seg % 1; const sr = 0.2 + sc * 0.8; px = Math.cos(phase) * rx * sr; py = Math.sin(phase) * ry * sr; break; }
      case 'DoubleCircle': { const dc = Math.cos(phase) * rx; const ds = Math.sin(phase) * ry; const dc2 = Math.cos(phase + Math.PI) * rx * 0.5; const ds2 = Math.sin(phase + Math.PI) * ry * 0.5; const blending = (Math.sin(phase * 3) + 1) / 2; px = dc * (1 - blending) + dc2 * blending; py = ds * (1 - blending) + ds2 * blending; break; }
      case 'Heart': { const t = phase; const hx = 16 * Math.pow(Math.sin(t), 3); const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); px = (hx / 16) * rx; py = (hy / 16) * -ry; break; }
      default: px = Math.cos(phase) * rx; py = Math.sin(phase) * ry; break;
    }
    const rx2 = px * Math.cos(rotRad) - py * Math.sin(rotRad) + ox;
    const ry2 = px * Math.sin(rotRad) + py * Math.cos(rotRad) + oy;
    const dmxPan = Math.round(Math.max(0, Math.min(255, 128 + rx2 * 127)));
    const dmxTilt = Math.round(Math.max(0, Math.min(255, 128 + ry2 * 127)));
    // Construit les canaux DMX du snapshot (pan/tilt + dimmer 255 pour visibilité 3D)
    const snapshot: Record<number, number> = {};
    for (const fid of targetIds) {
      const pf = store.patchedFixtures.find((f) => f.id === fid);
      if (!pf) continue;
      // Résout les offsets pan/tilt via la définition du fixture (comme l'aperçu live)
      try {
        const def = await window.lightMaestro.fixtures.getDefinition(pf.fixtureDefId);
        const mode = def?.modes?.[pf.modeIndex];
        if (!mode) continue;
        for (let ci = 0; ci < mode.channels.length; ci++) {
          const ch = mode.channels[ci];
          const addr = pf.startAddress + ci;
          if (ch.type === 'Pan') snapshot[addr] = dmxPan;
          else if (ch.type === 'Tilt') snapshot[addr] = dmxTilt;
          else if (ch.type === 'Intensity') snapshot[addr] = 255;
        }
      } catch {}
      // Fallback via fixturePositions si pas de définition : on marque au moins le pan/tilt via le store 3D (visuel)
      const f3d = fixturesRef.current.get(fid);
      if (f3d?.channelMap) {
        if (f3d.channelMap.panOffset !== null && f3d.channelMap.panOffset !== undefined) snapshot[pf.startAddress + f3d.channelMap.panOffset] = dmxPan;
        if (f3d.channelMap.tiltOffset !== null && f3d.channelMap.tiltOffset !== undefined) snapshot[pf.startAddress + f3d.channelMap.tiltOffset] = dmxTilt;
        if (f3d.channelMap.intensityOffset !== null) snapshot[pf.startAddress + f3d.channelMap.intensityOffset] = 255;
      }
    }
    // Applique l'EFX à la scène : snapshot + lien dynamique (efxId) pour rejouer l'EFX en continu pendant la durée de la scène
    // Libère d'abord l'aperçu design-efx (LTP 70) sinon il masque scene-efx (LTP 75) pendant 3s
    try { dmxBridge.release('design-efx'); } catch {}
    if (sceneId) {
      const sc = store.getScene(sceneId);
      if (sc) {
        const tag = ` [EFX:${efx.name}]`;
        const merged = { ...sc.channels, ...snapshot };
        store.updateScene(sceneId, { name: sc.name.includes('[EFX:') ? sc.name : sc.name + tag, channels: merged, efxId: efx.id } as any);
        // Push immédiat + flag pour que l'aperçu EFX ne blackout pas ces fixtures dans les 2s qui suivent
        (window as any).__lm_efxSnapshotApplied = { sceneId, efxId: efx.id, at: Date.now() };
        try { const { sendChannelsToHardwareAndStore } = await import('../utils/dmx-helpers'); await sendChannelsToHardwareAndStore(merged, store.patchedFixtures, store.universes); } catch {}
      }
    } else {
      // Nouvelle scène : reprend la durée courante de l'éditeur si dispo, sinon 0 = infini (l'EFX ne doit pas s'arrêter seul)
      const curDur = (document.querySelector('input[data-scene-duration]') as HTMLInputElement)?.valueAsNumber ?? 0;
      const dur = Number.isFinite(curDur) && curDur > 0 ? curDur : 0;
      const newId = store.createScene(`Scene + ${efx.name}`);
      store.updateScene(newId, { name: `Scene + ${efx.name}`, channels: snapshot, efxId: efx.id, duration: dur } as any);
      (window as any).__lm_selectedSceneId = newId;
      (window as any).__lm_efxSnapshotApplied = { sceneId: newId, efxId: efx.id, at: Date.now() };
      try { const { sendChannelsToHardwareAndStore } = await import('../utils/dmx-helpers'); await sendChannelsToHardwareAndStore(snapshot, store.patchedFixtures, store.universes); } catch {}
    }
    try { (window as any).__lm_toast?.(`EFX "${efx.name}" appliqué à la scène — prévisualisation 3D à jour`, 'success'); } catch {}
  }, [effects, selectedEfxId, selectedFixtureId]);

  // ── Render ──────────────────────────────────────────
  const filteredFixtures = fixtureSearch.trim()
    ? patchedFixtures.filter((f) =>
        (f.name || '').toLowerCase().includes(fixtureSearch.toLowerCase()) ||
        String(f.startAddress).includes(fixtureSearch.trim())
      )
    : patchedFixtures;

  return (
    <div className="h-full flex flex-col bg-[#08080e]">
      {/* Header pro — groupé, lisible en régie */}
      <div className="h-11 border-b border-gray-800/40 flex items-center px-3 gap-2 shrink-0 bg-[#0d0d14] overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          <span className="text-xs font-bold tracking-widest text-gray-300 flex items-center gap-1.5">
            <Eye size={14} className="text-purple-400" /> {t('stage3D.title')}
          </span>
          <span className="w-px h-5 bg-gray-800" />
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Caméra</span>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/30 border border-gray-800/50">
            <button onClick={() => setCameraPreset('front')} className="px-2 py-1 rounded text-[10px] text-gray-400 hover:text-white hover:bg-white/10 flex items-center gap-1" title={t('stage3D.frontView')}><PanelTop size={11} /> {t('stage3D.front')}</button>
            <button onClick={() => setCameraPreset('top')} className="px-2 py-1 rounded text-[10px] text-gray-400 hover:text-white hover:bg-white/10 flex items-center gap-1" title={t('stage3D.topView')}><ChevronUp size={11} /> {t('stage3D.top')}</button>
            <button onClick={() => setCameraPreset('side')} className="px-2 py-1 rounded text-[10px] text-gray-400 hover:text-white hover:bg-white/10 flex items-center gap-1" title={t('stage3D.sideView')}><PanelRight size={11} /> {t('stage3D.side')}</button>
            <button onClick={() => setCameraPreset('audience')} className="px-2 py-1 rounded text-[10px] text-gray-400 hover:text-white hover:bg-white/10 flex items-center gap-1" title={t('stage3D.audienceView')}><Users size={11} /> {t('stage3D.audience')}</button>
          </div>
          <span className="w-px h-5 bg-gray-800" />
          <button onClick={() => setDirectMode((v) => !v)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 transition-all ${directMode ? 'bg-violet-600 text-white border-violet-500 shadow' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600'}`} title={directMode ? t('stage3D.directOnTitle') : t('stage3D.directOffTitle')}>
            <Crosshair size={12} /> {directMode ? t('stage3D.directOn') : t('stage3D.direct')}
          </button>
        </div>
        <div className="flex-1 min-w-[12px]" />
        <div className="flex items-center gap-2 min-w-max">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider hidden lg:inline">Scène</span>
          <div className="relative flex items-center">
            <LayoutGrid size={12} className="text-gray-400 absolute left-2 pointer-events-none" />
            <select value={stageScene} onChange={(e) => handleStageSceneChange(e.target.value as StageScene)} className="bg-black/30 text-gray-300 text-[10px] pl-7 pr-2 py-1.5 rounded-lg border border-gray-700/50 hover:border-gray-600 focus:outline-none focus:border-purple-500/50" title="Configuration de scène">
              <option value="empty" className="bg-[#0d0d14]">Scène vide</option>
              <option value="rear" className="bg-[#0d0d14]">Pont arrière</option>
              <option value="rear-front" className="bg-[#0d0d14]">Pont arrière + avant</option>
              <option value="full" className="bg-[#0d0d14]">Arrière + avant + 2 côtés</option>
            </select>
          </div>
          <div className="hidden md:flex items-center gap-1 bg-black/20 border border-gray-800/50 rounded-lg px-2 py-1">
            <Maximize2 size={11} className="text-gray-500" />
            <input type="number" min={1} step={0.5} value={draftDims.width} onChange={(e) => setDraftDims((prev) => ({ ...prev, width: e.target.value }))} onBlur={commitStageDims} onKeyDown={(e) => { if (e.key === 'Enter') commitStageDims(); }} className="w-11 bg-transparent text-gray-200 text-[10px] text-center focus:outline-none" aria-label="Largeur" />
            <span className="text-gray-600 text-[10px]">×</span>
            <input type="number" min={1} step={0.5} value={draftDims.depth} onChange={(e) => setDraftDims((prev) => ({ ...prev, depth: e.target.value }))} onBlur={commitStageDims} onKeyDown={(e) => { if (e.key === 'Enter') commitStageDims(); }} className="w-11 bg-transparent text-gray-200 text-[10px] text-center focus:outline-none" aria-label="Profondeur" />
            <span className="text-gray-600 text-[10px]">m</span>
          </div>
          <div className="relative flex items-center">
            <Music size={12} className="text-gray-400 absolute left-2 pointer-events-none" />
            <button ref={musiciansBtnRef} onClick={() => setMusiciansMenuOpen(v => !v)} className="bg-black/30 text-gray-300 text-[10px] pl-7 pr-2 py-1.5 rounded-lg border border-gray-700/50 hover:border-gray-600 focus:outline-none focus:border-purple-500/50 whitespace-nowrap" title="Présence musiciens/chanteurs sur scène">
              {rosterTotal(musicians) > 0 ? `Musiciens · ${rosterTotal(musicians)}` : 'Musiciens'}
            </button>
          </div>
        </div>
      </div>
      {/* Musiciens popup — centrée comme toutes les modales */}
      {musiciansMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setMusiciansMenuOpen(false)}>
          <div className="w-64 rounded-lg border border-gray-700/60 bg-[#0d0d14] shadow-xl shadow-black/60 p-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-gray-800">
              <span className="text-[10px] font-medium text-gray-300">Musiciens sur scène</span>
              <button onClick={() => handleMusiciansChange({})} className="text-[9px] text-gray-500 hover:text-purple-300" title="Retirer tous les musiciens">Tout retirer</button>
            </div>
            {MUSICIAN_KINDS.map(kind => {
              const count = musicians[kind] ?? 0;
              const checked = count > 0;
              return (
                <div key={kind} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-800/30">
                  <input type="checkbox" checked={checked} onChange={() => handleMusiciansChange({ ...musicians, [kind]: checked ? 0 : 1 })} className="accent-purple-500 w-3 h-3 cursor-pointer shrink-0" />
                  <span className={`flex-1 text-[10px] ${checked ? 'text-gray-200' : 'text-gray-500'}`}>{MUSICIAN_LABELS[kind]}</span>
                  <button onClick={() => handleMusiciansChange({ ...musicians, [kind]: Math.max(0, count - 1) })} disabled={count <= 0} className="w-5 h-5 rounded bg-gray-800/60 text-gray-300 text-[11px] leading-none hover:bg-gray-700/60 disabled:opacity-30" aria-label={`Réduire ${MUSICIAN_LABELS[kind]}`}>−</button>
                  <span className="w-5 text-center text-[10px] text-gray-200 tabular-nums">{count}</span>
                  <button onClick={() => handleMusiciansChange({ ...musicians, [kind]: Math.min(8, count + 1) })} className="w-5 h-5 rounded bg-gray-800/60 text-gray-300 text-[11px] leading-none hover:bg-gray-700/60" aria-label={`Augmenter ${MUSICIAN_LABELS[kind]}`}>+</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Toolbar legacy — conservée cachée pour compat, le nouveau header la remplace */}
      <div className="hidden">
      {/* Toolbar */}
      <div className="h-10 border-b border-gray-800/30 flex items-center px-4 gap-3 shrink-0 bg-[#0d0d14] overflow-x-auto">
        <div className="flex items-center gap-3 min-w-max">
        <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <Eye size={14} className="text-purple-400" /> {t('stage3D.title')}
        </span>
        <button
          onClick={() => setDirectMode(v => !v)}
          className={`px-2.5 py-1 rounded text-[10px] font-semibold border flex items-center gap-1 transition-colors ${directMode ? 'bg-violet-600 text-white border-violet-500 shadow' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'}`}
          title={directMode ? t('stage3D.directOnTitle') : t('stage3D.directOffTitle')}
        >
          <Crosshair size={12} /> {directMode ? t('stage3D.directOn') : t('stage3D.direct')}
        </button>

        <div className="w-px h-4 bg-gray-800" />

        {/* Camera presets */}
        <button
          onClick={() => setCameraPreset('front')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title={t('stage3D.frontView')}
        >
          <PanelTop size={12} /> {t('stage3D.front')}
        </button>
        <button
          onClick={() => setCameraPreset('top')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title={t('stage3D.topView')}
        >
          <ChevronUp size={12} /> {t('stage3D.top')}
        </button>
        <button
          onClick={() => setCameraPreset('side')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title={t('stage3D.sideView')}
        >
          <PanelRight size={12} /> {t('stage3D.side')}
        </button>
        <button
          onClick={() => setCameraPreset('audience')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title={t('stage3D.audienceView')}
        >
          <Users size={12} /> {t('stage3D.audience')}
        </button>

        <div className="w-px h-4 bg-gray-800" />

        {/* Stage scene selector */}
        <div className="relative flex items-center">
          <LayoutGrid size={12} className="text-gray-400 absolute left-2 pointer-events-none" />
          <select
            value={stageScene}
            onChange={e => handleStageSceneChange(e.target.value as StageScene)}
            className="bg-gray-800/40 text-gray-300 text-[10px] pl-7 pr-2 py-1 rounded border border-gray-700/40 appearance-none cursor-pointer hover:border-gray-600/60 focus:outline-none focus:border-purple-500/50"
            title="Configuration de scène"
          >
            <option value="empty" className="bg-[#0d0d14]">Scène vide</option>
            <option value="rear" className="bg-[#0d0d14]">Pont arrière</option>
            <option value="rear-front" className="bg-[#0d0d14]">Pont arrière + avant</option>
            <option value="full" className="bg-[#0d0d14]">Arrière + avant + 2 côtés</option>
          </select>
        </div>

        <div className="w-px h-4 bg-gray-800" />

        {/* Stage size — resizable without upper limit; fixtures scale proportionally */}
        <div className="flex items-center gap-1" title="Dimensions de la scène (largeur × profondeur, en mètres)">
          <Maximize2 size={12} className="text-gray-500" />
          <input
            type="number"
            min={1}
            step={0.5}
            value={draftDims.width}
            onChange={e => setDraftDims(prev => ({ ...prev, width: Number(e.target.value) }))}
            onBlur={commitStageDims}
            onKeyDown={e => { if (e.key === 'Enter') commitStageDims(); }}
            className="w-12 bg-gray-800/40 text-gray-200 text-[10px] px-1 py-0.5 rounded border border-gray-700/40 focus:outline-none focus:border-purple-500/50"
            aria-label="Largeur de la scène (m)"
          />
          <span className="text-gray-600 text-[10px]">×</span>
          <input
            type="number"
            min={1}
            step={0.5}
            value={draftDims.depth}
            onChange={e => setDraftDims(prev => ({ ...prev, depth: Number(e.target.value) }))}
            onBlur={commitStageDims}
            onKeyDown={e => { if (e.key === 'Enter') commitStageDims(); }}
            className="w-12 bg-gray-800/40 text-gray-200 text-[10px] px-1 py-0.5 rounded border border-gray-700/40 focus:outline-none focus:border-purple-500/50"
            aria-label="Profondeur de la scène (m)"
          />
          <span className="text-gray-600 text-[10px]">m</span>
        </div>

        <div className="w-px h-4 bg-gray-800" />

        <div className="relative flex items-center" title="Configuration des musiciens sur scène (glissez-les pour les déplacer)">
          <Music size={12} className="text-gray-400 absolute left-2 pointer-events-none" />
          <button
            ref={musiciansBtnRef}
            onClick={() => {
              if (!musiciansMenuOpen && musiciansBtnRef.current) {
                const r = musiciansBtnRef.current.getBoundingClientRect();
                setMusiciansMenuPos({
                  top: Math.min(r.bottom + 6, window.innerHeight - 340),
                  left: Math.max(8, Math.min(r.left, window.innerWidth - 272)),
                });
              }
              setMusiciansMenuOpen(v => !v);
            }}
            className="bg-gray-800/40 text-gray-300 text-[10px] pl-7 pr-2 py-1 rounded border border-gray-700/40 cursor-pointer hover:border-gray-600/60 focus:outline-none focus:border-purple-500/50 whitespace-nowrap"
          >
            {rosterTotal(musicians) > 0 ? `Musiciens · ${rosterTotal(musicians)}` : 'Musiciens'}
          </button>
        </div>

        <button
          onClick={() => setShowFixtureList(v => !v)}
          className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-colors ${
            showFixtureList ? 'bg-purple-600/20 text-purple-300' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
          }`}
          title="Liste des fixtures — retrouver rapidement une light"
        >
          <List size={12} /> Fixtures
        </button>

        <div className="flex-1" />

        <span className="text-[10px] text-gray-600">
          {patchedFixtures.length} fixtures · glisser pour orbiter · clic pour sélectionner · liste « Fixtures » pour retrouver une light
        </span>
        </div>
      </div>
      </div>{/* fin toolbar legacy cachée */}

      {/* Corps pro : Left dock + Centre 3D + Right dock */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left dock — Fixtures (rétractable) */}
        {!leftDockCollapsed ? (
          <div className="w-[260px] shrink-0 border-r border-gray-800/50 bg-[#0d0d14]/80 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-gray-800/50">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Fixtures</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-purple-300 font-mono">{filteredFixtures.length}</span>
                  <button onClick={() => setLeftDockCollapsed(true)} className="w-5 h-5 rounded bg-black/30 border border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600 flex items-center justify-center" title="Réduire la liste">
                    <ChevronUp size={10} className="rotate-[-90deg]" />
                  </button>
                </div>
              </div>
            <div className="mt-2 relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input value={fixtureSearch} onChange={(e) => setFixtureSearch(e.target.value)} placeholder="Rechercher…" className="w-full pl-7 pr-2 py-1.5 bg-black/30 border border-gray-800 rounded-lg text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredFixtures.length === 0 ? (
              <div className="text-xs text-gray-600 text-center py-8">Aucun projecteur</div>
            ) : filteredFixtures.map((f) => {
              const isSel = selectedFixtureId === f.id || multiSelectedIds.has(f.id);
              return (
              <button key={f.id} onClick={() => { selectSingleFixture(f.id); focusFixture(f.id); }} className={`w-full text-left px-2.5 py-2 rounded-lg border flex items-center gap-2 transition-all ${isSel ? 'bg-purple-600/15 border-purple-500/40 text-purple-200' : 'bg-black/20 border-gray-800/50 text-gray-400 hover:bg-white/[0.04] hover:border-gray-700'}`}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getFixtureColor(patchedFixtures.findIndex(p=>p.id===f.id)) }} />
                <span className="flex-1 min-w-0 truncate text-xs font-medium">{f.name}</span>
                <span className="text-[10px] text-gray-500 font-mono">{f.startAddress}</span>
              </button>
              );
            })}
          </div>
          <div className="p-2 border-t border-gray-800/50 text-[10px] text-gray-600">Glisser sur le canvas pour orbiter • Clic = sélectionner • Ctrl+clic = multi • Target = viser</div>
        </div>
        ) : (
          <div className="w-8 shrink-0 border-r border-gray-800/50 bg-[#0d0d14]/60 flex flex-col items-center py-2 gap-2">
            <button onClick={() => setLeftDockCollapsed(false)} className="w-6 h-6 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/30 flex items-center justify-center" title="Ouvrir la liste fixtures">
              <List size={12} />
            </button>
            <span className="text-[9px] text-gray-600 [writing-mode:vertical-lr] tracking-widest uppercase">Fixtures</span>
            <span className="text-[9px] text-purple-400 font-mono">{filteredFixtures.length}</span>
          </div>
        )}

        {/* Centre 3D */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#08080e] relative">
      {/* 3D Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative cursor-grab active:cursor-grabbing"
        onClick={handleCanvasClick}
        onMouseDown={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
      >
        {!fixtureDefsReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#08080e]/80 z-10">
            <div className="text-center">
              <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-gray-500">Loading fixture definitions...</p>
            </div>
          </div>
        )}

        {/* Hovered fixture label */}
        {hoveredFixture && !selectedFixture && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#1a1a28] border border-gray-700/80 rounded-lg px-3 py-1.5 text-xs text-gray-300 pointer-events-none z-20 shadow-xl">
            <span className="font-medium text-gray-200">{hoveredFixture.name}</span>
            <span className="text-gray-600 ml-2">{hoveredFixture.fixtureType}</span>
          </div>
        )}

        {/* Mode Target beacon */}
        {targetMode && selectedFixture && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/50 bg-cyan-600/20 text-[11px] font-semibold text-cyan-200 pointer-events-none shadow-xl">
            <Crosshair size={12} />
            Mode cible — cliquez un point de la scène
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-100 font-mono">
              {multiSelectedIds.size > 0 ? multiSelectedIds.size : 1}
            </span>
          </div>
        )}

        {/* Fixture quick-select list — search + click to select & zoom */}
        {showFixtureList && (
          <div
            className="absolute top-3 left-3 z-20 w-72 max-h-[75%] bg-[#12121a] border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/50 shrink-0">
              <span className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                <List size={12} className="text-purple-400" /> Fixtures ({filteredFixtures.length})
              </span>
              <button onClick={() => setShowFixtureList(false)} className="text-gray-600 hover:text-gray-300 transition-colors" title="Fermer">
                <X size={14} />
              </button>
            </div>
            <div className="p-2 border-b border-gray-800/50 shrink-0">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  autoFocus
                  value={fixtureSearch}
                  onChange={(e) => setFixtureSearch(e.target.value)}
                  placeholder="Nom ou n° DMX…"
                  className="w-full bg-gray-800/50 border border-gray-700/50 rounded pl-7 pr-2 py-1.5 text-xs text-gray-300 placeholder-gray-600 outline-none focus:border-purple-500/50"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 py-1">
              {filteredFixtures.length === 0 ? (
                <div className="text-xs text-gray-600 text-center py-6 px-3">Aucune fixture ne correspond</div>
              ) : (
                filteredFixtures.map((f, idx) => {
                  const uniIdx = universeIndexMap.get(f.universeId);
                  const isSel = selectedFixtureId === f.id || multiSelectedIds.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() => { selectSingleFixture(f.id); setShowFixtureList(false); focusFixture(f.id); }}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        isSel ? 'bg-purple-600/15' : 'hover:bg-gray-800/30'
                      }`}
                    >
                      <span className={`w-6 h-6 shrink-0 rounded-md border flex items-center justify-center text-[10px] font-mono ${
                        isSel ? 'bg-purple-600/20 border-purple-500/40 text-purple-300' : 'bg-gray-800 border-gray-700/50 text-gray-400'
                      }`}>{idx + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-gray-200 truncate">{f.name}</span>
                        <span className="block text-[9px] text-gray-600 truncate">
                          {f.fixtureType} · U{(uniIdx ?? 0) + 1} @ {f.startAddress}
                        </span>
                      </span>
                      <Crosshair size={12} className="text-gray-600 shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Selected fixture editor - floating panel, draggable by header only */}
        {selectedFixture && selectedPos && (
          <div
            className="fixed bg-[#12121a] border border-purple-500/30 rounded-xl shadow-2xl min-w-[240px] max-h-[85vh] overflow-y-auto"
            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3 cursor-grab active:cursor-grabbing border-b border-gray-800/50"
              onMouseDown={(e) => {
                const panel = e.currentTarget.parentElement! as HTMLElement;
                // Centre initial via transform → passer en coordonnées left/top fixes au premier drag
                const rect = panel.getBoundingClientRect();
                const ox = e.clientX - rect.left;
                const oy = e.clientY - rect.top;
                // Figer la position actuelle en left/top et retirer le transform de centrage
                panel.style.left = rect.left + 'px';
                panel.style.top = rect.top + 'px';
                panel.style.transform = 'none';
                panel.style.right = 'auto';
                const onMove = (ev: MouseEvent) => {
                  panel.style.left = Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - 120)) + 'px';
                  panel.style.top = Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 40)) + 'px';
                };
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            >
              <div className="flex items-center gap-2">
                <GripVertical size={12} className="text-gray-600" />
                <span className="text-sm font-semibold text-gray-200">{selectedFixture.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                  selectedFixture.tier === 'primary' ? 'bg-purple-500/20 text-purple-400' :
                  selectedFixture.tier === 'secondary' ? 'bg-blue-500/20 text-blue-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>{selectedFixture.tier}</span>
                <button
                  onClick={handleFixtureOn}
                  className={`px-2.5 py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition-colors border ${lightOn
                    ? 'bg-green-500/25 text-green-300 border-green-500/50'
                    : 'bg-green-600/15 text-green-400 border-green-700/40 hover:bg-green-600/25'}`}
                  title={lightOn ? 'Éteindre' : 'Allumer (dimmer max + blanc)'}
                >
                  <Zap size={11} />
                  {lightOn ? 'Éteindre' : 'Allumer'}
                </button>
              </div>
              <button
                onClick={clearFixtureSelection}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="p-4">

            {/* Position sliders */}
            <div className="space-y-3">
              {/* X Position */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">X Position</span>
                  <span className="text-gray-400 font-mono">{(selectedPos.x * stageDims.width).toFixed(1)}m</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFixturePosition(selectedFixture.id, { x: Math.max(0, Math.min(1, (selectedPos.x - 0.01))) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedPos.x}
                    onChange={(e) => setFixturePosition(selectedFixture.id, { x: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-purple-500 cursor-pointer"
                  />
                  <button onClick={() => setFixturePosition(selectedFixture.id, { x: Math.max(0, Math.min(1, (selectedPos.x + 0.01))) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                </div>
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>0m</span><span>{stageDims.width}m</span>
                </div>
              </div>

              {/* Z/Depth Position */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Z Depth</span>
                  <span className="text-gray-400 font-mono">{(selectedPos.y * stageDims.depth).toFixed(1)}m</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFixturePosition(selectedFixture.id, { y: Math.max(0, Math.min(1, (selectedPos.y - 0.01))) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedPos.y}
                    onChange={(e) => setFixturePosition(selectedFixture.id, { y: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-purple-500 cursor-pointer"
                  />
                  <button onClick={() => setFixturePosition(selectedFixture.id, { y: Math.max(0, Math.min(1, (selectedPos.y + 0.01))) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                </div>
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>0m</span><span>{stageDims.depth}m</span>
                </div>
              </div>

              {/* Height */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Height</span>
                  <span className="text-gray-400 font-mono">{(selectedPos.h * 5.0).toFixed(1)}m</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFixturePosition(selectedFixture.id, { h: Math.max(0, Math.min(1, (selectedPos.h - 0.01))) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedPos.h}
                    onChange={(e) => setFixturePosition(selectedFixture.id, { h: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-purple-500 cursor-pointer"
                  />
                  <button onClick={() => setFixturePosition(selectedFixture.id, { h: Math.max(0, Math.min(1, (selectedPos.h + 0.01))) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                </div>
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>0m</span><span>5m</span>
                </div>
              </div>

              {/* Quick height presets */}
              <div className="flex gap-1">
                <button
                  onClick={() => setFixturePosition(selectedFixture.id, { h: 0.6 })}
                  className={`flex-1 px-2 py-1 rounded text-[9px] transition-colors ${
                    Math.abs(selectedPos.h - 0.6) < 0.01
                      ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                      : 'bg-gray-800/50 text-gray-500 hover:text-gray-300 border border-gray-700'
                  }`}
                >
                  Truss 3m
                </button>
                <button
                  onClick={() => setFixturePosition(selectedFixture.id, { h: 0.3 })}
                  className={`flex-1 px-2 py-1 rounded text-[9px] transition-colors ${
                    Math.abs(selectedPos.h - 0.3) < 0.01
                      ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                      : 'bg-gray-800/50 text-gray-500 hover:text-gray-300 border border-gray-700'
                  }`}
                >
                  Ground 1.5m
                </button>
                <button
                  onClick={() => setFixturePosition(selectedFixture.id, { h: 0.8 })}
                  className={`flex-1 px-2 py-1 rounded text-[9px] transition-colors ${
                    Math.abs(selectedPos.h - 0.8) < 0.01
                      ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                      : 'bg-gray-800/50 text-gray-500 hover:text-gray-300 border border-gray-700'
                  }`}
                >
                  High 4m
                </button>
              </div>

              {/* Mount mode */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Mount</span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {([
                    { v: 'top' as const, label: 'Top', icon: '🔽' },
                    { v: 'ground' as const, label: 'Ground', icon: '🔼' },
                    { v: 'rear' as const, label: 'Rear', icon: '▶' },
                  ]).map(opt => (
                    <button key={opt.v}
                      onClick={() => setFixturePosition(selectedFixture.id, {
                        mountMode: opt.v,
                        ...(opt.v === 'ground' ? { h: 0 } : {}),
                      })}
                      className={`px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${
                        (selectedPos.mountMode || 'top') === opt.v
                          ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                          : 'bg-gray-800/50 text-gray-500 hover:text-gray-300 border border-gray-700'
                      }`}
                    >
                      <span className="mr-1">{opt.icon}</span>{opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Direct DMX — intensity + couleur (programmer) */}
              <div className="space-y-2 p-2 rounded-lg bg-violet-600/10 border border-violet-500/20">
                <div className="text-[10px] font-semibold text-violet-300">Direct — programmer (violet)</div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]"><span className="text-gray-500">Dimmer</span><span className="text-violet-300 font-mono">{useProgrammerStore.getState().channels[selectedFixture ? (patchedFixtures.find(f=>f.id===selectedFixture.id)?.startAddress ?? 0) + (fixturesRef.current.get(selectedFixture.id)?.channelMap.intensityOffset ?? 0) : 0] ?? 0}</span></div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => {
                      const f3d = fixturesRef.current.get(selectedFixture!.id);
                      const pf = patchedFixtures.find(f=>f.id===selectedFixture!.id);
                      if (!f3d || !pf) return;
                      const addr = pf.startAddress+(f3d.channelMap.intensityOffset ?? 0);
                      const cur = useProgrammerStore.getState().channels[addr] ?? 0;
                      const v = Math.max(0, cur - 1);
                      const setCh = useProgrammerStore.getState().setChannel;
                      if (f3d.channelMap.intensityOffset!==null) setCh(addr, v);
                      (document.querySelector('input[type="range"][min="0"][max="255"]') as HTMLInputElement | null)?.dispatchEvent(new Event('input', {bubbles:true}));
                    }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                    <input type="range" min={0} max={255} defaultValue={useProgrammerStore.getState().channels[selectedFixture ? (patchedFixtures.find(f=>f.id===selectedFixture.id)?.startAddress ?? 0) + (fixturesRef.current.get(selectedFixture.id)?.channelMap.intensityOffset ?? 0) : 0] ?? 0}
                      onChange={(e)=>{
                        const f3d = fixturesRef.current.get(selectedFixture!.id);
                        const pf = patchedFixtures.find(f=>f.id===selectedFixture!.id);
                        if (!f3d || !pf) return;
                        const v = Number(e.target.value);
                        const addrs: number[] = [];
                        if (f3d.channelMap.intensityOffset!==null) addrs.push(pf.startAddress+f3d.channelMap.intensityOffset);
                        for (const o of f3d.channelMap.rgbOffsets ?? []) addrs.push(pf.startAddress+o);
                        for (const seg of f3d.channelMap.rgbSegments ?? []) { addrs.push(pf.startAddress+seg.r); if(seg.g!==null) addrs.push(pf.startAddress+seg.g); if(seg.b!==null) addrs.push(pf.startAddress+seg.b); }
                        if (addrs.length===0 && f3d.channelMap.intensityOffset!==null) addrs.push(pf.startAddress+f3d.channelMap.intensityOffset);
                        const setCh = useProgrammerStore.getState().setChannel;
                        if (f3d.channelMap.intensityOffset!==null) setCh(pf.startAddress+f3d.channelMap.intensityOffset, v);
                        else for (const a of addrs) setCh(a, v);
                      }} className="flex-1 h-1 accent-violet-500 cursor-pointer" />
                    <button onClick={() => {
                      const f3d = fixturesRef.current.get(selectedFixture!.id);
                      const pf = patchedFixtures.find(f=>f.id===selectedFixture!.id);
                      if (!f3d || !pf) return;
                      const addr = pf.startAddress+(f3d.channelMap.intensityOffset ?? 0);
                      const cur = useProgrammerStore.getState().channels[addr] ?? 0;
                      const v = Math.min(255, cur + 1);
                      const setCh = useProgrammerStore.getState().setChannel;
                      if (f3d.channelMap.intensityOffset!==null) setCh(addr, v);
                    }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                  </div>
                </div>
                <div className="flex gap-1">
                  {['#ff0000','#00ff00','#0000ff','#ffff00','#ffffff'].map(hex=>(
                    <button key={hex} onClick={()=>{
                      const f3d = fixturesRef.current.get(selectedFixture!.id);
                      const pf = patchedFixtures.find(f=>f.id===selectedFixture!.id);
                      if (!f3d || !pf) return;
                      const setCh = useProgrammerStore.getState().setChannel;
                      const hexToRgb = (h:string)=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)] as [number,number,number];
                      const [r,g,b]=hexToRgb(hex);
                      for (const seg of f3d.channelMap.rgbSegments ?? []) {
                        setCh(pf.startAddress+seg.r, r); setCh(pf.startAddress+seg.g, g); if(seg.b!==null) setCh(pf.startAddress+seg.b, b); if(seg.w!==null) setCh(pf.startAddress+seg.w, 0);
                      }
                      if ((f3d.channelMap.rgbSegments?.length ?? 0)===0) {
                        for (const off of f3d.channelMap.rgbOffsets ?? []) {
                          const idx = f3d.channelMap.rgbOffsets!.indexOf(off);
                          setCh(pf.startAddress+off, idx===0?r:idx===1?g:b);
                        }
                      }
                      if (f3d.channelMap.wheelOffset!==null) {
                        // approx wheel position
                        setCh(pf.startAddress+f3d.channelMap.wheelOffset, hex==='#ff0000'?10:hex==='#00ff00'?60:hex==='#0000ff'?120:hex==='#ffff00'?30:0);
                      }
                    }} style={{backgroundColor:hex}} className="w-6 h-6 rounded border border-gray-700 hover:scale-110 transition-transform" title={hex} />
                  ))}
                  <input type="color" defaultValue="#ff0064" onChange={(e)=>{
                    const hex=e.target.value;
                    const f3d = fixturesRef.current.get(selectedFixture!.id);
                    const pf = patchedFixtures.find(f=>f.id===selectedFixture!.id);
                    if (!f3d || !pf) return;
                    const setCh = useProgrammerStore.getState().setChannel;
                    const [r,g,b]=[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
                    for (const seg of f3d.channelMap.rgbSegments ?? []) { setCh(pf.startAddress+seg.r,r); setCh(pf.startAddress+seg.g,g); if(seg.b!==null) setCh(pf.startAddress+seg.b,b); }
                  }} className="w-6 h-6 rounded border border-gray-700 cursor-pointer p-0" />
                </div>
                <button onClick={() => setTargetMode((v) => !v)} className={`mt-1 w-full px-2.5 py-1.5 rounded-md text-[10px] font-bold flex items-center justify-center gap-1.5 border transition-all ${targetMode ? 'bg-cyan-600/30 text-cyan-200 border-cyan-500/50 shadow' : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600'}`} title={targetMode ? 'Quitter le mode cible' : 'Viser un point : sélectionne 1+ projecteurs (Ctrl+clic en 3D), puis cliquez un point de la scène → pan/tilt DMX en direct'}>
                  <Crosshair size={12} /> {targetMode ? 'Cible active — cliquez la 3D' : 'Target (viser un point)'}
                </button>
                <div className="text-[9px] text-gray-500">Drag sur la fixture en mode Direct = Pan/Tilt. Store pour créer Scene/EFX/Show.</div>
                <div className="flex gap-1.5">
                  <button onClick={()=>{
                    const prog = useProgrammerStore.getState().channels;
                    if (Object.keys(prog).length===0) return;
                    const f3d = fixturesRef.current.get(selectedFixture!.id);
                    const pf = patchedFixtures.find(f=>f.id===selectedFixture!.id);
                    const s = useShowStore.getState();
                    const panAddr = pf ? pf.startAddress + (f3d?.channelMap.panOffset ?? f3d?.channelMap.panOffsets?.[0] ?? 0) : 0;
                    const tiltAddr = pf ? pf.startAddress + (f3d?.channelMap.tiltOffset ?? f3d?.channelMap.tiltOffsets?.[0] ?? 0) : 0;
                    const pan = prog[panAddr] ?? 128; const tilt = prog[tiltAddr] ?? 128;
                    const xOff = Math.round(((pan-128)/128)*120);
                    const yOff = Math.round(((tilt-128)/128)*120);
                    const id = s.createEffect(`EFX 3D ${s.effects.length+1}`);
                    s.updateEffect(id, { name:`EFX 3D ${s.effects.length}`, pattern:'Circle', width:1, height:1, rotation:0, speed:0.5, xOffset:xOff, yOffset:yOff, fixtureIds: selectedFixture ? [selectedFixture.id] : [] });
                  }} className="flex-1 py-1 rounded bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 text-[10px] font-medium hover:bg-cyan-600/30">Rec EFX</button>
                  <button onClick={()=>{
                    const prog = useProgrammerStore.getState().channels;
                    if (Object.keys(prog).length===0) return;
                    const s = useShowStore.getState();
                    const scId = s.createScene(`Scene 3D ${s.scenes.length+1}`);
                    s.updateScene(scId, { name:`Scene 3D ${s.scenes.length}`, channels:{...prog}, fadeIn:0, fadeOut:0, duration:0 });
                    const shId = s.createShow(`Show 3D ${s.shows.length+1}`);
                    const show = s.shows.find(sh=>sh.id===shId);
                    if (show) s.updateShow(shId, { tracks:[{ id:`trk-${Date.now()}`, name:'Scene Track', type:'scene', items:[{ id:`tmi-${Date.now()}`, startTime:0, duration:5000, resourceId:scId, fadeIn:0, fadeOut:0, name:s.scenes.find(sc=>sc.id===scId)?.name || 'Scene 3D' }], muted:false, solo:false }] as any });
                  }} className="flex-1 py-1 rounded bg-amber-600/20 text-amber-300 border border-amber-500/30 text-[10px] font-medium hover:bg-amber-600/30">Rec Show</button>
                </div>
              </div>

              {/* Pan/Tilt tare — visual only, does NOT touch DMX */}
              {selectedFixture && selectedFixture.fixtureType && (() => {
                const f3d = fixturesRef.current.get(selectedFixture.id);
                const hasPan = f3d?.channelMap?.panOffset !== null && f3d?.channelMap?.panOffset !== undefined;
                const hasTilt = f3d?.channelMap?.tiltOffset !== null && f3d?.channelMap?.tiltOffset !== undefined;
                const hasPanTilt = hasPan || hasTilt;
                return hasPanTilt ? (
                  <>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Pan (tare visuelle)</span>
                  <span className="text-gray-400 font-mono">{((selectedPos.heading ?? 0)).toFixed(0)}°</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFixturePosition(selectedFixture.id, { heading: Math.max(0, Math.min(360, (selectedPos.heading ?? 0) - 1)) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={5}
                    value={selectedPos.heading ?? 0}
                    onChange={(e) => setFixturePosition(selectedFixture.id, { heading: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-orange-500 cursor-pointer"
                  />
                  <button onClick={() => setFixturePosition(selectedFixture.id, { heading: Math.max(0, Math.min(360, (selectedPos.heading ?? 0) + 1)) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                </div>
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>0°</span><span>360°</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Tilt (tare visuelle)</span>
                  <span className="text-gray-400 font-mono">{((selectedPos.tilt ?? 0)).toFixed(0)}°</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFixturePosition(selectedFixture.id, { tilt: Math.max(-90, Math.min(90, (selectedPos.tilt ?? 0) - 1)) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                  <input
                    type="range"
                    min={-90}
                    max={90}
                    step={1}
                    value={selectedPos.tilt ?? 0}
                    onChange={(e) => setFixturePosition(selectedFixture.id, { tilt: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-blue-500 cursor-pointer"
                  />
                  <button onClick={() => setFixturePosition(selectedFixture.id, { tilt: Math.max(-90, Math.min(90, (selectedPos.tilt ?? 0) + 1)) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                </div>
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>-90°</span><span>+90°</span>
                </div>
              </div>
              <p className="text-[9px] text-gray-600">Réglage visuel uniquement — ne touche pas au DMX.</p>
                  </>
                ) : null;
              })()}

              {/* Thumbnail Scale */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Taille icône</span>
                  <span className="text-gray-400 font-mono">{((selectedPos.thumbnailScale ?? 0.75)).toFixed(2)}×</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { const v = Math.max(0.2, Math.min(2.0, (selectedPos.thumbnailScale ?? 0.75) - 0.05)); setFixturePosition(selectedFixture.id, { thumbnailScale: v }); const f3d = fixturesRef.current.get(selectedFixture.id); if (f3d?.thumbSprite) { const s = 0.55 * v / 0.75; f3d.thumbSprite.scale.set(s,s,1); } }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                  <input
                    type="range"
                    min={0.2}
                    max={2.0}
                    step={0.05}
                    value={selectedPos.thumbnailScale ?? 0.75}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setFixturePosition(selectedFixture.id, { thumbnailScale: v });
                      const f3d = fixturesRef.current.get(selectedFixture.id);
                      if (f3d?.thumbSprite) { const s = 0.55 * v / 0.75; f3d.thumbSprite.scale.set(s,s,1); }
                    }}
                    className="flex-1 h-1 accent-pink-500 cursor-pointer"
                  />
                  <button onClick={() => { const v = Math.max(0.2, Math.min(2.0, (selectedPos.thumbnailScale ?? 0.75) + 0.05)); setFixturePosition(selectedFixture.id, { thumbnailScale: v }); const f3d = fixturesRef.current.get(selectedFixture.id); if (f3d?.thumbSprite) { const s = 0.55 * v / 0.75; f3d.thumbSprite.scale.set(s,s,1); } }} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                </div>
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>0.2×</span><span>2.0×</span>
                </div>
              </div>

              {/* Beam Angle (Zoom) */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Beam Angle</span>
                  <span className="text-gray-400 font-mono">{((selectedPos.beamAngle ?? 0.15) * 180 / Math.PI).toFixed(0)}°</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setFixturePosition(selectedFixture.id, { beamAngle: Math.max(0.02, Math.min(0.8, (selectedPos.beamAngle ?? 0.15) - 0.01)) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">−</button>
                  <input
                    type="range"
                    min={0.02}
                    max={0.8}
                    step={0.01}
                    value={selectedPos.beamAngle ?? 0.15}
                    onChange={(e) => setFixturePosition(selectedFixture.id, { beamAngle: parseFloat(e.target.value) })}
                    className="flex-1 h-1 accent-cyan-500 cursor-pointer"
                  />
                  <button onClick={() => setFixturePosition(selectedFixture.id, { beamAngle: Math.max(0.02, Math.min(0.8, (selectedPos.beamAngle ?? 0.15) + 0.01)) })} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-[11px] shrink-0">+</button>
                </div>
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>1°</span><span>46°</span>
                </div>
              </div>

            </div>
            {/* EFX snapshot — uniquement si enableEfxApply (Scènes) */}
            {enableEfxApply && (
              <div className="mx-4 mb-3 p-3 rounded-xl bg-gradient-to-br from-violet-600/15 via-purple-600/10 to-cyan-600/10 border border-violet-500/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-bold tracking-widest text-violet-300 uppercase">✨ EFX Snapshot</span>
                  <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">Nouveau</span>
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed mb-2">Applique un effet enregistré à la scène en cours — la 3D fige la pose, la scène garde la mémoire.</p>
                <select value={selectedEfxId} onChange={(e) => setSelectedEfxId(e.target.value)} className="w-full bg-black/40 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-violet-500/50">
                  <option value="">— Choisir un EFX —</option>
                  {effects.map((efx) => (
                    <option key={efx.id} value={efx.id} className="bg-[#0d0d14]">{efx.name} · {efx.pattern}</option>
                  ))}
                </select>
                <button onClick={handleApplyEfxSnapshot} disabled={!selectedEfxId} className="mt-2 w-full py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-bold hover:from-violet-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-all">
                  <Sparkles size={12} /> Appliquer à la scène
                </button>
                {effects.length === 0 && <p className="text-[9px] text-gray-600 mt-1 text-center">Aucun EFX enregistré — crée-en dans Design → EFX</p>}
              </div>
            )}
            {/* Close button */}
            <div className="px-4 py-2 border-t border-gray-800/50">
              <button
                onClick={clearFixtureSelection}
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
              >
                Fermer
              </button>
            </div>
            </div>
          </div>
        )}
        </div>{/* fin Centre 3D */}
        {/* Right dock — EFX uniquement si enableEfxApply (Scènes) */}
        {enableEfxApply && !selectedFixture && (
          <div className="w-[300px] shrink-0 border-l border-gray-800/50 bg-[#0d0d14]/60 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-gray-800/50">
              <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Scène & EFX</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-violet-600/15 to-cyan-600/10 border border-violet-500/20">
                <div className="text-xs font-bold text-violet-300 mb-1">✨ Appliquer un EFX</div>
                <p className="text-[10px] text-gray-400 mb-2">Choisis un effet, il sera figé dans la scène en cours (ou nouvelle scène).</p>
                <select value={selectedEfxId} onChange={(e) => setSelectedEfxId(e.target.value)} className="w-full bg-black/40 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-violet-500/50">
                  <option value="">— Choisir un EFX —</option>
                  {effects.map((efx) => (
                    <option key={efx.id} value={efx.id} className="bg-[#0d0d14]">{efx.name} · {efx.pattern}</option>
                  ))}
                </select>
                <button onClick={handleApplyEfxSnapshot} disabled={!selectedEfxId} className="mt-2 w-full py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-bold hover:from-violet-500 hover:to-purple-500 disabled:opacity-40 flex items-center justify-center gap-1.5">
                  <Sparkles size={12} /> Appliquer à la scène
                </button>
              </div>
              <div className="p-2.5 rounded-lg bg-black/20 border border-gray-800/50">
                <div className="text-[10px] font-semibold text-gray-400 mb-1">Astuce pro</div>
                <p className="text-[10px] text-gray-500 leading-relaxed">Sélectionne une lyre à gauche, ajuste sa position avec `−/+`, puis fige un EFX — ta scène garde la pose exacte vue en 3D.</p>
              </div>
            </div>
          </div>
        )}
        {/* Fermeture du centre + row principale */}
        </div>
      </div>
      {/* Status bar pro */}
      <div className="h-6 border-t border-gray-800/50 bg-[#0d0d14] flex items-center px-3 gap-3 text-[10px] text-gray-500 shrink-0">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> 3D 30 fps</span>
        <span className="w-px h-3 bg-gray-800" />
        <span>{patchedFixtures.length} fixtures</span>
        {selectedFixture && <><span className="w-px h-3 bg-gray-800" /><span className="text-purple-300">{selectedFixture.name}</span></>}
        <span className="flex-1" />
        <span className="hidden md:inline">Glisser = orbiter • Clic = sélectionner • Ctrl+clic = multi • Target = viser un point</span>
      </div>
    </div>
  );
};

// ─── Helper: dispose fixture 3D resources ────────────────────

function disposeFixture3D(f3d: Fixture3D): void {
  if (f3d.thumbSprite) {
    (f3d.thumbSprite.material as THREE.SpriteMaterial).map?.dispose();
    (f3d.thumbSprite.material as THREE.Material).dispose();
  }
  f3d.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material?.dispose();
      }
    }
    if (child instanceof THREE.Sprite && child !== f3d.thumbSprite) {
      (child.material as THREE.SpriteMaterial).map?.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
  if (f3d.pointLight) {
    f3d.pointLight.dispose();
  }
  if (f3d.beamCone) {
    f3d.beamCone.geometry?.dispose();
    (f3d.beamCone.material as THREE.Material)?.dispose();
  }
  for (const eh of f3d.extraHeads ?? []) {
    if (eh.pointLight) eh.pointLight.dispose();
    if (eh.beamCone) {
      eh.beamCone.geometry?.dispose();
      (eh.beamCone.material as THREE.Material)?.dispose();
    }
  }
  if (f3d.floorSpot) {
    f3d.floorSpot.geometry?.dispose();
    (f3d.floorSpot.material as THREE.Material)?.dispose();
  }
  if (f3d.floorGlow) {
    f3d.floorGlow.geometry?.dispose();
    (f3d.floorGlow.material as THREE.Material)?.dispose();
  }
}

function fitMountRotation(f3d: Fixture3D, mode: string): void {
  // Keep the base at the bottom in all modes.
  // Rotate only the arm (rear) or head (ground), never the whole group.
  // This avoids the base disc appearing inverted.

  // Reset
  f3d.group.rotation.x = 0;
  if (f3d.armGroup) f3d.armGroup.rotation.x = 0;
  f3d._mountTilt = 0;

  if (mode === 'rear') {
    // Rotate the yoke horizontal (arm toward +Z, base stays at bottom)
    if (f3d.armGroup) f3d.armGroup.rotation.x = -Math.PI / 2;
  } else if (mode === 'ground') {
    // Keep yoke upright, tilt head 180° so beam points UP
    f3d._mountTilt = Math.PI;
  }
  // top: no modification (base at bottom, beam down)

  // Extra heads follow the mount compensation (no independent static tilt)
  for (const eh of f3d.extraHeads ?? []) {
    eh._mountTilt = f3d._mountTilt;
  }
}
