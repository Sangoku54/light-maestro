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
import { useShowStore, type PatchedFixture, type FixturePos, type StageScene } from '../stores/showStore';
import { analyzeFixtureChannels, type FixtureChannelAnalysis } from '../engine/fixture-analyzer';
import { useAppStore } from '../stores/appStore';
import {
  loadFixtureDefinitions,
  clearFixtureDefCache,
  type DmxFixtureDefinition,
  type DmxFixtureChannel,
  type DmxFixtureCapability,
} from '../hooks/dmx-cues';
import { Eye, Camera, Maximize2, ChevronUp, PanelTop, PanelRight, Users, GripVertical, X, LayoutGrid, Music, Zap, List, Search, Crosshair } from 'lucide-react';
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

// ─── Constants ───────────────────────────────────────────────

const STAGE_WIDTH = 10;  // meters
const STAGE_DEPTH = 8;   // meters
const TRUSS_HEIGHT = 3;  // meters
const STAGE_HEIGHT = 1.5;  // meters — stage elevation above ground
const STAGE_THICKNESS = 0.3;  // meters — stage platform thickness
const DMX_POLL_INTERVAL = 1000 / 60; // 60fps — smooth pan/tilt update every render frame
const MAX_TRAIL_POINTS = 80;
const TRAIL_ADD_INTERVAL = 100; // ms between trail samples
const GRID_SIZE = 1; // 1m grid squares

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
const BEAM_LENGTH = 3.0;

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
  // Fallback: map value 0-255 to hue
  return new THREE.Color().setHSL(value / 255, 1, 0.5);
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
}> = ({ disabledFixtures, musicians: musiciansProp, stageScene: stageSceneProp, onMusiciansChange, onStageSceneChange }) => {
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

  const [showBeams, setShowBeams] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showSmoke, setShowSmoke] = useState(true);
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

  // Reset musician positions whenever the roster changes (manual or via prop)
  useEffect(() => {
    musicianPositionsRef.current = buildRosterPositions(musicians);
  }, [musicians]);
  const trussBeamsRef = useRef<{ back: THREE.Object3D | null; front: THREE.Object3D | null; left: THREE.Object3D | null; right: THREE.Object3D | null; poles: THREE.Object3D[] }>({ back: null, front: null, left: null, right: null, poles: [] });
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [showFixtureList, setShowFixtureList] = useState(false);
  const [fixtureSearch, setFixtureSearch] = useState('');
  const [musiciansMenuOpen, setMusiciansMenuOpen] = useState(false);
  const musiciansBtnRef = useRef<HTMLButtonElement>(null);
  const [musiciansMenuPos, setMusiciansMenuPos] = useState<{ top: number; left: number } | null>(null);
  const stageDims = useShowStore((s) => s.stageDims);
  const setStageDims = useShowStore((s) => s.setStageDims);
  // ── Resizable stage dimensions (width × depth, meters) ──
  // Fixture positions are normalized (0-1), so resizing scales hardware spacing proportionally.
  const stageDimsRef = useRef(stageDims);
  stageDimsRef.current = stageDims;
  const [draftDims, setDraftDims] = useState({ width: stageDims.width, depth: stageDims.depth });
  const commitStageDims = () => {
    const w = Math.max(1, Number.isFinite(Number(draftDims.width)) ? Number(draftDims.width) : STAGE_WIDTH);
    const d = Math.max(1, Number.isFinite(Number(draftDims.depth)) ? Number(draftDims.depth) : STAGE_DEPTH);
    setStageDims({ width: w, depth: d });
    setDraftDims({ width: w, depth: d });
  };
  // ── Rotate selected fixture on drag ────────────────
  const dragRotateRef = useRef<{ startX: number; startY: number; fixtureId: string } | null>(null);
  const [hoveredFixtureId, setHoveredFixtureId] = useState<string | null>(null);

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

    return {
      id: fixture.id,
      group,
      bodyMesh,
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
  }, [universeIndexMap]);

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
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, Math.max(80, STAGE_WIDTH + STAGE_DEPTH + 60));
    camera.position.set(0, 1.2, -STAGE_DEPTH / 2 - 4); // audience view by default
    camera.lookAt(0, STAGE_HEIGHT + 1.5, 0);
    cameraRef.current = camera;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, STAGE_HEIGHT + 1.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = Math.max(30, STAGE_WIDTH + STAGE_DEPTH + 20);
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.update();
    controlsRef.current = controls;

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
      cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      controls.dispose();
      // Fixtures live in the old scene — drop them so the sync effect re-adds them on rebuild
      fixturesRef.current.clear();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [stageDims]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Back beam always visible
    if (tr.back) tr.back.visible = true;
    // Front beam: rear-front or full
    if (tr.front) tr.front.visible = stageScene !== 'rear';
    // Side beams: full only
    if (tr.left) tr.left.visible = stageScene === 'full';
    if (tr.right) tr.right.visible = stageScene === 'full';
    // Poles: back corners always visible; front corners for rear-front/full
    for (const pole of tr.poles) {
      const corner: string = pole.userData.corner || '';
      if (corner.includes('back')) {
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
    let channelData = dmxState.channelData as Record<number, Uint8Array | number[]>;
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
        const b = data[baseAddr + cm.rgbOffsets[2]] ?? 0;
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
          eh.pointLight.intensity = normIntensity * 25;
        }
        if (eh.beamCone) {
          const m = eh.beamCone.material as THREE.MeshBasicMaterial;
          m.color.copy(color);
          m.opacity = normIntensity * 0.35;
          eh.beamCone.visible = showBeams && normIntensity > 0.005;
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
        f3d.pointLight.intensity = normIntensity * 25;
      }

      // --- Update beam cone ---
      if (f3d.beamCone) {
        const mat = f3d.beamCone.material as THREE.MeshBasicMaterial;
        mat.color.copy(color);
        mat.opacity = normIntensity * 0.35;
        f3d.beamCone.visible = showBeams && normIntensity > 0.005;
      }

      // --- Floor spot disabled: only beam cones from lens are shown ---
      // Floor spot/glow visibility forced off
      if (f3d.floorSpot) f3d.floorSpot.visible = false;

      // --- Body visibility: always show geometry so mount rotation is visible
    if (normIntensity > 0.01) {
        const bodyMat = f3d.bodyMesh.material as THREE.MeshStandardMaterial;
        if (Array.isArray(bodyMat)) {
          for (const m of bodyMat) { m.emissive = color; m.emissiveIntensity = normIntensity * 0.8; }
        } else {
          bodyMat.emissive = color;
          bodyMat.emissiveIntensity = normIntensity * 0.8;
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
      if (t < 1) requestAnimationFrame(animateCamera);
    };
    requestAnimationFrame(animateCamera);
  }, [fixturePositions]);

  // ── Canvas click handler (raycasting) ─────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
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
      while (obj && !obj.userData?.fixtureId) obj = obj.parent;
      if (obj?.userData?.fixtureId) {
        const fid = obj.userData.fixtureId as string;
        if (fid !== selectedFixtureId) setSelectedFixtureId(fid);
      }
    } else {
      // Clicked empty space → deselect (no auto-rotate)
      setSelectedFixtureId(null);
    }
  }, [selectedFixtureId]);

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

  // ── Rotate selected fixture on drag ────────────────
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
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
    const onUp = () => { dragRotateRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [fixturePositions, setFixturePosition]);

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

  // ── Render ──────────────────────────────────────────
  const filteredFixtures = fixtureSearch.trim()
    ? patchedFixtures.filter((f) =>
        (f.name || '').toLowerCase().includes(fixtureSearch.toLowerCase()) ||
        String(f.startAddress).includes(fixtureSearch.trim())
      )
    : patchedFixtures;

  return (
    <div className="h-full flex flex-col bg-[#08080e]">
      {/* Toolbar */}
      <div className="h-10 border-b border-gray-800/30 flex items-center px-4 gap-3 shrink-0 bg-[#0d0d14] overflow-x-auto">
        <div className="flex items-center gap-3 min-w-max">
        <span className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <Eye size={14} className="text-purple-400" /> 3D Stage
        </span>

        <div className="w-px h-4 bg-gray-800" />

        {/* Camera presets */}
        <button
          onClick={() => setCameraPreset('front')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title="Front View"
        >
          <PanelTop size={12} /> Front
        </button>
        <button
          onClick={() => setCameraPreset('top')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title="Top View"
        >
          <ChevronUp size={12} /> Top
        </button>
        <button
          onClick={() => setCameraPreset('side')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title="Side View"
        >
          <PanelRight size={12} /> Side
        </button>
        <button
          onClick={() => setCameraPreset('audience')}
          className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 flex items-center gap-1"
          title="Audience View"
        >
          <Users size={12} /> Audience
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

        {musiciansMenuOpen && musiciansMenuPos && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMusiciansMenuOpen(false)} />
            <div
              className="fixed z-50 w-64 rounded-lg border border-gray-700/60 bg-[#0d0d14] shadow-xl shadow-black/60 p-2"
              style={{ top: musiciansMenuPos.top, left: musiciansMenuPos.left }}
            >
              <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-gray-800">
                <span className="text-[10px] font-medium text-gray-300">Musiciens sur scène</span>
                <button
                  onClick={() => handleMusiciansChange({})}
                  className="text-[9px] text-gray-500 hover:text-purple-300"
                  title="Retirer tous les musiciens"
                >
                  Tout retirer
                </button>
              </div>
              {MUSICIAN_KINDS.map(kind => {
                const count = musicians[kind] ?? 0;
                const checked = count > 0;
                return (
                  <div key={kind} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-800/30">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleMusiciansChange({ ...musicians, [kind]: checked ? 0 : 1 })}
                      className="accent-purple-500 w-3 h-3 cursor-pointer shrink-0"
                    />
                    <span className={`flex-1 text-[10px] ${checked ? 'text-gray-200' : 'text-gray-500'}`}>
                      {MUSICIAN_LABELS[kind]}
                    </span>
                    <button
                      onClick={() => handleMusiciansChange({ ...musicians, [kind]: Math.max(0, count - 1) })}
                      disabled={count <= 0}
                      className="w-5 h-5 rounded bg-gray-800/60 text-gray-300 text-[11px] leading-none hover:bg-gray-700/60 disabled:opacity-30"
                      aria-label={`Réduire ${MUSICIAN_LABELS[kind]}`}
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-[10px] text-gray-200 tabular-nums">{count}</span>
                    <button
                      onClick={() => handleMusiciansChange({ ...musicians, [kind]: Math.min(8, count + 1) })}
                      className="w-5 h-5 rounded bg-gray-800/60 text-gray-300 text-[11px] leading-none hover:bg-gray-700/60"
                      aria-label={`Augmenter ${MUSICIAN_LABELS[kind]}`}
                    >
                      +
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

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
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#1a1a28]/95 border border-gray-700/80 rounded-lg px-3 py-1.5 text-xs text-gray-300 pointer-events-none z-20 backdrop-blur-sm shadow-xl">
            <span className="font-medium text-gray-200">{hoveredFixture.name}</span>
            <span className="text-gray-600 ml-2">{hoveredFixture.fixtureType}</span>
          </div>
        )}

        {/* Fixture quick-select list — search + click to select & zoom */}
        {showFixtureList && (
          <div
            className="absolute top-3 left-3 z-20 w-72 max-h-[75%] bg-[#12121a]/95 border border-gray-800 rounded-xl shadow-2xl backdrop-blur-sm flex flex-col overflow-hidden"
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
                  return (
                    <button
                      key={f.id}
                      onClick={() => { setSelectedFixtureId(f.id); setShowFixtureList(false); focusFixture(f.id); }}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 transition-colors ${
                        selectedFixtureId === f.id ? 'bg-purple-600/15' : 'hover:bg-gray-800/30'
                      }`}
                    >
                      <span className={`w-6 h-6 shrink-0 rounded-md border flex items-center justify-center text-[10px] font-mono ${
                        selectedFixtureId === f.id ? 'bg-purple-600/20 border-purple-500/40 text-purple-300' : 'bg-gray-800 border-gray-700/50 text-gray-400'
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
            className="fixed bg-[#12121a]/95 border border-purple-500/30 rounded-xl shadow-2xl backdrop-blur-sm min-w-[240px]"
            style={{ right: 16, top: 80 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-3 cursor-grab active:cursor-grabbing border-b border-gray-800/50"
              onMouseDown={(e) => {
                const panel = e.currentTarget.parentElement!;
                const ox = e.clientX - panel.offsetLeft;
                const oy = e.clientY - panel.offsetTop;
                const onMove = (ev: MouseEvent) => {
                  panel.style.left = Math.max(0, Math.min(ev.clientX - ox, window.innerWidth - 120)) + 'px';
                  panel.style.top = Math.max(0, Math.min(ev.clientY - oy, window.innerHeight - 40)) + 'px';
                  panel.style.right = 'auto';
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
                onClick={() => setSelectedFixtureId(null)}
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
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedPos.x}
                  onChange={(e) => setFixturePosition(selectedFixture.id, { x: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-purple-500 cursor-pointer"
                />
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
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedPos.y}
                  onChange={(e) => setFixturePosition(selectedFixture.id, { y: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-purple-500 cursor-pointer"
                />
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
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedPos.h}
                  onChange={(e) => setFixturePosition(selectedFixture.id, { h: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-purple-500 cursor-pointer"
                />
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
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={5}
                  value={selectedPos.heading ?? 0}
                  onChange={(e) => setFixturePosition(selectedFixture.id, { heading: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-orange-500 cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>0°</span><span>360°</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Tilt (tare visuelle)</span>
                  <span className="text-gray-400 font-mono">{((selectedPos.tilt ?? 0)).toFixed(0)}°</span>
                </div>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  step={1}
                  value={selectedPos.tilt ?? 0}
                  onChange={(e) => setFixturePosition(selectedFixture.id, { tilt: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-blue-500 cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>-90°</span><span>+90°</span>
                </div>
              </div>
              <p className="text-[9px] text-gray-600">Réglage visuel uniquement — ne touche pas au DMX.</p>
                  </>
                ) : null;
              })()}

              {/* Beam Angle (Zoom) */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Beam Angle</span>
                  <span className="text-gray-400 font-mono">{((selectedPos.beamAngle ?? 0.15) * 180 / Math.PI).toFixed(0)}°</span>
                </div>
                <input
                  type="range"
                  min={0.02}
                  max={0.8}
                  step={0.01}
                  value={selectedPos.beamAngle ?? 0.15}
                  onChange={(e) => setFixturePosition(selectedFixture.id, { beamAngle: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-cyan-500 cursor-pointer"
                />
                <div className="flex justify-between text-[8px] text-gray-700">
                  <span>1°</span><span>46°</span>
                </div>
              </div>

            </div>
            {/* Close button */}
            <div className="px-4 py-2 border-t border-gray-800/50">
              <button
                onClick={() => setSelectedFixtureId(null)}
                className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
              >
                Close
              </button>
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Helper: dispose fixture 3D resources ────────────────────

function disposeFixture3D(f3d: Fixture3D): void {
  f3d.group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material?.dispose();
      }
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
