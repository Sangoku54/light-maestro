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
import { useShowStore, type PatchedFixture, type FixturePos } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';
import {
  loadFixtureDefinitions,
  clearFixtureDefCache,
  type DmxFixtureDefinition,
  type DmxFixtureChannel,
  type DmxFixtureCapability,
} from '../hooks/dmx-cues';
import { Eye, Camera, Maximize2, ChevronUp, PanelTop, PanelRight, Users, GripVertical, X } from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────

const STAGE_WIDTH = 10;  // meters
const STAGE_DEPTH = 8;   // meters
const TRUSS_HEIGHT = 3;  // meters
const DMX_POLL_INTERVAL = 1000 / 30; // 30fps
const GRID_SIZE = 1; // 1m grid squares

// ─── Channel Analysis (mirrors dmx-cues.ts analyzeFixture) ──

interface FixtureChannelMap {
  intensityOffset: number | null;
  shutterOffset: number | null;
  rgbOffsets: number[] | null;
  wheelOffset: number | null;
  wheelCaps: DmxFixtureCapability[] | null;
  panOffset: number | null;
  tiltOffset: number | null;
  goboOffset: number | null;
}

function analyzeFixtureChannels(
  pf: PatchedFixture,
  def: DmxFixtureDefinition | undefined,
): FixtureChannelMap {
  const channels = def?.modes[pf.modeIndex]?.channels ?? [];
  const result: FixtureChannelMap = {
    intensityOffset: null,
    shutterOffset: null,
    rgbOffsets: null,
    wheelOffset: null,
    wheelCaps: null,
    panOffset: null,
    tiltOffset: null,
    goboOffset: null,
  };

  const colourChannels: { offset: number; name: string; caps?: DmxFixtureCapability[] }[] = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    switch (ch.type) {
      case 'Intensity':
        if (result.intensityOffset === null) result.intensityOffset = i;
        break;
      case 'Shutter':
        if (result.shutterOffset === null) result.shutterOffset = i;
        break;
      case 'Colour':
        colourChannels.push({ offset: i, name: ch.name, caps: ch.capabilities });
        break;
      case 'Pan':
        if (result.panOffset === null) result.panOffset = i;
        break;
      case 'Tilt':
        if (result.tiltOffset === null) result.tiltOffset = i;
        break;
      case 'Gobo':
        if (result.goboOffset === null) result.goboOffset = i;
        break;
    }
  }

  if (colourChannels.length >= 3) {
    const rIdx = colourChannels.findIndex(c => /red|\br\b/i.test(c.name));
    const gIdx = colourChannels.findIndex(c => /green|\bg\b/i.test(c.name));
    const bIdx = colourChannels.findIndex(c => /blue|\bb\b/i.test(c.name));
    if (rIdx >= 0 && gIdx >= 0 && bIdx >= 0) {
      result.rgbOffsets = [colourChannels[rIdx].offset, colourChannels[gIdx].offset, colourChannels[bIdx].offset];
    } else {
      result.rgbOffsets = colourChannels.slice(0, 3).map(c => c.offset);
    }
  } else if (colourChannels.length === 1) {
    result.wheelOffset = colourChannels[0].offset;
    result.wheelCaps = colourChannels[0].caps?.filter(c => c.color) ?? null;
  }

  return result;
}

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

interface Fixture3D {
  id: string;
  group: THREE.Group;           // Root group (positioned on stage)
  bodyMesh: THREE.Mesh;         // Fixture body
  armGroup?: THREE.Group;       // Arm (pan, Y-axis rotation)
  headGroup?: THREE.Group;      // Head (tilt, X-axis rotation)
  lightTarget: THREE.Object3D;  // Where the light is attached
  pointLight?: THREE.PointLight;    // Dynamic point light
  beamCone?: THREE.Mesh;        // Volumetric beam cone
  floorSpot?: THREE.Mesh;       // Light spot on the floor
  floorGlow?: THREE.Mesh;       // Soft outer glow on floor
  channelMap: FixtureChannelMap;
  universeIndex: number;        // Index into channelData map
  mountMode: 'top' | 'ground' | 'rear'; // beam default direction
  beamAngle: number;            // beam opening angle in radians
  _staticTilt: number;          // static tilt offset from panel
  _mountTilt: number;           // mount-mode head tilt compensation (π for ground, 0 otherwise)
}

// ─── Component ────────────────────────────────────────────────

export const Stage3D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fixturesRef = useRef<Map<string, Fixture3D>>(new Map());
  const timerRef = useRef<THREE.Timer>(new THREE.Timer());
  const animFrameRef = useRef<number>(0);
  const lastDmxPollRef = useRef<number>(0);
  const particlesRef = useRef<THREE.Points | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

  const [showBeams, setShowBeams] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showSmoke, setShowSmoke] = useState(true);
  const [fixtureDefsReady, setFixtureDefsReady] = useState(false);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  // ── Rotate selected fixture on drag ────────────────
  const dragRotateRef = useRef<{ startX: number; startY: number; fixtureId: string } | null>(null);
  const [hoveredFixtureId, setHoveredFixtureId] = useState<string | null>(null);

  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const fixturePositions = useShowStore((s) => s.fixturePositions);
  const setFixturePosition = useShowStore((s) => s.setFixturePosition);
  const initFixturePosition = useShowStore((s) => s.initFixturePosition);
  const universes = useAppStore((s) => s.dmx.universes);

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
    const stageX = (pos.x - 0.5) * STAGE_WIDTH;
    const stageZ = (pos.y - 0.5) * STAGE_DEPTH;
    // Map h (0-1) to actual meters: 0 → 0m, 1 → 5m
    const stageY = pos.h * 5.0;
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

        // T�te moving_head : sph�re (orientation-agnostic, 2x pour diagnostic visuel)
        const headBody = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 24, 16), headMat);
        headBody.position.set(0, 0, 0);
        headBody.castShadow = true;
        headGroup.add(headBody);

        // Light exit at bottom point of sphere (y = -radius)
        const lightExit = new THREE.Group();
        lightExit.position.set(0, -0.16, 0);
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
        const faceGeo = new THREE.CircleGeometry(0.20, 16);
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
        const headBody = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), headMatDef);
        headBody.castShadow = true;
        headGroup.add(headBody);
        const lightExitDef = new THREE.Group();
        lightExitDef.position.set(0, -0.32, 0);
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
    };
  }, [universeIndexMap]);

  // ── Scene initialization ──────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const W = container.clientWidth;
    const H = container.clientHeight;

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
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, 80);
    camera.position.set(0, 8, 12);
    camera.lookAt(0, 1.5, 0);
    cameraRef.current = camera;

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 30;
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
    // Floor plane
    const floorGeo = new THREE.PlaneGeometry(STAGE_WIDTH + 6, STAGE_DEPTH + 6);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid
    const gridHelper = new THREE.PolarGridHelper(
      Math.max(STAGE_WIDTH, STAGE_DEPTH) / 2 + 3,
      64,
      32,
      64,
      0x2a2a4e,
      0x2a2a4e,
    );
    gridHelper.position.y = 0.005;
    scene.add(gridHelper);

    // Stage platform
    const stageGeo = new THREE.PlaneGeometry(STAGE_WIDTH, STAGE_DEPTH);
    const stageMat = new THREE.MeshStandardMaterial({
      color: 0x151525,
      roughness: 0.7,
      metalness: 0.05,
    });
    const stage = new THREE.Mesh(stageGeo, stageMat);
    stage.rotation.x = -Math.PI / 2;
    stage.position.y = 0.01;
    stage.receiveShadow = true;
    scene.add(stage);

    // Stage edge
    const edgeGeo = new THREE.EdgesGeometry(stageGeo);
    const edgeLine = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0x3a3a5e, linewidth: 1 }),
    );
    edgeLine.rotation.x = -Math.PI / 2;
    edgeLine.position.y = 0.015;
    scene.add(edgeLine);

    // ── Truss ──────────────────────────────────────
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4e, roughness: 0.5, metalness: 0.7,
    });

    // Front truss
    const frontTruss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, STAGE_WIDTH, 8),
      trussMat,
    );
    frontTruss.rotation.z = Math.PI / 2;
    frontTruss.position.set(0, TRUSS_HEIGHT, -STAGE_DEPTH / 2);
    scene.add(frontTruss);

    // Back truss
    const backTruss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, STAGE_WIDTH, 8),
      trussMat,
    );
    backTruss.rotation.z = Math.PI / 2;
    backTruss.position.set(0, TRUSS_HEIGHT, STAGE_DEPTH / 2);
    scene.add(backTruss);

    // Vertical supports
    for (const x of [-STAGE_WIDTH / 2, STAGE_WIDTH / 2]) {
      for (const z of [-STAGE_DEPTH / 2, STAGE_DEPTH / 2]) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, TRUSS_HEIGHT, 8),
          trussMat,
        );
        pole.position.set(x, TRUSS_HEIGHT / 2, z);
        scene.add(pole);
      }
    }

    // ── Smoke/Haze particles ───────────────────────
    const particleCount = 300;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * STAGE_WIDTH * 1.5;
      positions[i * 3 + 1] = Math.random() * 4;
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
          if (posArr[i * 3 + 1] > 4) {
            posArr[i * 3 + 1] = 0;
            posArr[i * 3] = (Math.random() - 0.5) * STAGE_WIDTH * 1.5;
            posArr[i * 3 + 2] = (Math.random() - 0.5) * STAGE_DEPTH * 1.5;
          }
        }
        particles.geometry.attributes.position.needsUpdate = true;
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
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!container || !camera || !renderer) return;
    const ro = new ResizeObserver(() => {
      const W = container.clientWidth;
      const H = container.clientHeight;
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
        const coneHeight = 50;
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
        f3d.mountMode = pos.mountMode || 'top';
        f3d.beamAngle = pos.beamAngle ?? 0.15;
        // Cone starts at origin (lens) and extends down in local space
        cone.position.set(0, -coneHeight / 2, 0);
        cone.visible = showBeams;
        // Attach to lightTarget (lightExit) - follows pan/tilt from lens face
        f3d.lightTarget.add(cone);
        f3d.beamCone = cone;

        // ── Floor spot (light circle on stage floor) ──
        const spotRadius = 0.6;
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
        const glowRadius = 1.2;
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
      }

      // Update existing fixture positions
      for (const pf of patchedFixtures) {
        const f3d = fixturesRef.current.get(pf.id);
        if (!f3d) continue;
        const pos = fixturePositions[pf.id] || { x: 0.5, y: 0.3, h: 0.5, heading: 0 };
        const stageX = (pos.x - 0.5) * STAGE_WIDTH;
        const stageZ = (pos.y - 0.5) * STAGE_DEPTH;
        const stageY = pos.h * 5.0;
        f3d.group.position.set(stageX, stageY, stageZ);
        f3d.group.rotation.y = ((pos.heading ?? 0) * Math.PI) / 180;
        if (pos.mountMode) f3d.mountMode = pos.mountMode;
        fitMountRotation(f3d, pos.mountMode || 'top');
        f3d._staticTilt = ((pos.tilt ?? 0) * Math.PI) / 180;
        if (f3d.headGroup) f3d.headGroup.rotation.x = f3d._mountTilt + f3d._staticTilt;
        // Update beam angle (zoom)
        if (pos.beamAngle !== undefined && f3d.beamCone) {
          f3d.beamAngle = pos.beamAngle;
          const ch = 50;
          const radius = ch * Math.tan(pos.beamAngle);
          f3d.beamCone.geometry?.dispose();
          f3d.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true);
          f3d.beamCone.position.set(0, -ch / 2, 0);
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
  }, [fixtureDefsReady, patchedFixtures, showBeams, createFixtureGeometry]);

  // ── Update fixture positions from store ─────────────
  // Separate effect - only updates positions, doesn't recreate geometry
  useEffect(() => {
    for (const pf of patchedFixtures) {
      const f3d = fixturesRef.current.get(pf.id);
      if (!f3d) continue;
      const pos = fixturePositions[pf.id];
      if (!pos) continue;
      const stageX = (pos.x - 0.5) * STAGE_WIDTH;
      const stageZ = (pos.y - 0.5) * STAGE_DEPTH;
      const stageY = pos.h * 5.0;
      f3d.group.position.set(stageX, stageY, stageZ);
      f3d.group.rotation.y = ((pos.heading ?? 0) * Math.PI) / 180;
      if (pos.mountMode) f3d.mountMode = pos.mountMode;
      fitMountRotation(f3d, pos.mountMode || 'top');
      f3d._staticTilt = ((pos.tilt ?? 0) * Math.PI) / 180;
      if (f3d.headGroup) { f3d.headGroup.rotation.x = f3d._mountTilt + f3d._staticTilt; }
      if (pos.beamAngle !== undefined && f3d.beamCone) {
        f3d.beamAngle = pos.beamAngle;
        const ch = 50;
        const radius = ch * Math.tan(pos.beamAngle);
        f3d.beamCone.geometry?.dispose();
        f3d.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true);
        // Cone position: starts at origin (lens), extends down
        f3d.beamCone.position.set(0, -ch / 2, 0);
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

    for (const f3d of fixturesRef.current.values()) {
      // Get DMX data for this fixture's universe
      const rawData = channelData[f3d.universeIndex];
      if (!rawData) {
        if (f3d.pointLight) f3d.pointLight.intensity = 0;
        if (f3d.beamCone) { (f3d.beamCone.material as THREE.MeshBasicMaterial).opacity = 0; }
        // Apply static tilt even without DMX
        if (f3d.headGroup) f3d.headGroup.rotation.x = f3d._mountTilt + (f3d._staticTilt ?? 0);
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
      }

      if (blackout) intensity = 0;
      intensity = intensity * (grandMaster / 255);
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

      // --- Pan/Tilt (QLC+ model: arm=pan/Y, head=tilt/X) ---
      const panVal = cm.panOffset !== null ? (data[baseAddr + cm.panOffset] ?? 128) : 128;
      const tiltVal = cm.tiltOffset !== null ? (data[baseAddr + cm.tiltOffset] ?? 128) : 128;
      if (f3d.armGroup) {
        f3d.armGroup.rotation.y = ((panVal / 255) - 0.5) * Math.PI * 3;
      }
      if (f3d.headGroup) {
        // Tilt the whole head (geometry + lightExit together)
        const dmxTilt = ((tiltVal / 255) - 0.5) * Math.PI * 0.5;
        const staticTilt = f3d._staticTilt ?? 0;
        f3d.headGroup.rotation.x = f3d._mountTilt + dmxTilt + staticTilt;
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

    const target = new THREE.Vector3(0, 1.5, 0);
    let pos: THREE.Vector3;

    switch (preset) {
      case 'front':
        pos = new THREE.Vector3(0, 2, STAGE_DEPTH / 2 + 6);
        break;
      case 'top':
        pos = new THREE.Vector3(0, 14, 0.1);
        break;
      case 'side':
        pos = new THREE.Vector3(STAGE_WIDTH / 2 + 6, 2, 0);
        break;
      case 'audience':
        pos = new THREE.Vector3(0, 1.2, -STAGE_DEPTH / 2 - 4);
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

  // ── Render ──────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-[#08080e]">
      {/* Toolbar */}
      <div className="h-10 border-b border-gray-800/30 flex items-center px-4 gap-3 shrink-0 bg-[#0d0d14]">
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

        {/* Toggle buttons */}
        <button
          onClick={() => setShowBeams(v => !v)}
          className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-colors ${
            showBeams ? 'bg-purple-600/20 text-purple-400' : 'text-gray-600'
          }`}
        >
          <Eye size={12} /> Beams
        </button>
        <button
          onClick={() => setShowSmoke(v => !v)}
          className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-colors ${
            showSmoke ? 'bg-blue-600/20 text-blue-400' : 'text-gray-600'
          }`}
        >
          Smoke
        </button>
        <button
          onClick={() => setShowLabels(v => !v)}
          className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-colors ${
            showLabels ? 'bg-purple-600/20 text-purple-400' : 'text-gray-600'
          }`}
        >
          Labels
        </button>

        <div className="flex-1" />

        <span className="text-[10px] text-gray-600">
          {patchedFixtures.length} fixtures · drag to orbit · click to select
        </span>
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
                  panel.style.left = (ev.clientX - ox) + 'px';
                  panel.style.top = (ev.clientY - oy) + 'px';
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
                  <span className="text-gray-400 font-mono">{(selectedPos.x * STAGE_WIDTH).toFixed(1)}m</span>
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
                  <span>0m</span><span>{STAGE_WIDTH}m</span>
                </div>
              </div>

              {/* Z/Depth Position */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Z Depth</span>
                  <span className="text-gray-400 font-mono">{(selectedPos.y * STAGE_DEPTH).toFixed(1)}m</span>
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
                  <span>0m</span><span>{STAGE_DEPTH}m</span>
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

              {/* Heading / Rotation + Tilt - only for fixtures with Pan/Tilt channels */}
              {selectedFixture && selectedFixture.fixtureType && (() => {
                const f3d = fixturesRef.current.get(selectedFixture.id);
                const hasPan = f3d?.channelMap?.panOffset !== null && f3d?.channelMap?.panOffset !== undefined;
                const hasTilt = f3d?.channelMap?.tiltOffset !== null && f3d?.channelMap?.tiltOffset !== undefined;
                const hasPanTilt = hasPan || hasTilt;
                return hasPanTilt ? (
                  <>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Heading (Pan)</span>
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

              {/* Beam Tilt */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Tilt</span>
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

  // Apply mount-compensated head tilt
  if (f3d.headGroup) {
    f3d.headGroup.rotation.x = f3d._mountTilt + (f3d._staticTilt ?? 0);
  }
}
