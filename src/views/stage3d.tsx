/**
 * Stage3D — Real-time 3D Stage Visualizer
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
        return new THREE.Color(cap.color);
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

    switch (type) {
      // ── Moving Head (QLC+ model: base → arm(pans on Y) → head(tilts on X)) ──
      case 'moving_head': {
        const baseGeo = new THREE.CylinderGeometry(0.38, 0.45, 0.20, 16);
        const base = new THREE.Mesh(baseGeo, accentMat);
        base.position.y = 0.10;
        group.add(base);

        armGroup = new THREE.Group();
        armGroup.position.y = 0.20;
        armGroup.name = 'arm';

        const yokeMat = new THREE.MeshStandardMaterial({
          color: 0x2a2a3e, roughness: 0.5, metalness: 0.6,
        });

        const lp = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.30, 0.10), yokeMat);
        lp.position.set(-0.20, 0.15, 0);
        armGroup.add(lp);
        const rp = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.30, 0.10), yokeMat);
        rp.position.set(0.20, 0.15, 0);
        armGroup.add(rp);
        const cb = new THREE.Mesh(new THREE.BoxGeometry(0.475, 0.075, 0.10), yokeMat);
        cb.position.y = 0.30;
        armGroup.add(cb);

        group.add(armGroup);

        headGroup = new THREE.Group();
        headGroup.position.y = 0.15;
        headGroup.name = 'head';

        const headGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.40, 16);
        const head = new THREE.Mesh(headGeo, accentMat);
        head.rotation.z = Math.PI / 2;
        head.position.set(0, 0, 0.10);
        headGroup.add(head);

        const lensGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.075, 16);
        const lens = new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({
          color: 0xcccccc, roughness: 0.1, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.1,
        }));
        lens.rotation.z = Math.PI / 2;
        lens.position.set(0, 0, 0.325);
        headGroup.add(lens);

        armGroup.add(headGroup);

        bodyMesh = base;
        lightTarget = lens;
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

      // ── Dimmer, Fog, Smoke, Default ─────────────
      default: {
        const boxGeo = new THREE.BoxGeometry(0.375, 0.30, 0.30);
        const box = new THREE.Mesh(boxGeo, bodyMat);
        box.position.y = 0.15;
        group.add(box);

        const indicator = new THREE.Mesh(
          new THREE.SphereGeometry(0.075, 8, 8),
          accentMat,
        );
        indicator.position.y = 0.30;
        group.add(indicator);

        bodyMesh = box;
        lightTarget = indicator;
        break;
      }
    }

    group.castShadow = false;
    group.receiveShadow = false;

    return {
      id: fixture.id,
      group,
      bodyMesh,
      headGroup,
      lightTarget,
      channelMap,
      universeIndex: universeIndexMap.get(fixture.universeId) ?? 0,
      mountMode: pos.mountMode || 'top',
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

        // Create PointLight at lens position (no target needed —
        // beamCone handles visual direction, PointLight provides
        // realistic omnidirectional fill from the fixture lens)
        const pointLight = new THREE.PointLight(0xffffff, 0, 8, 2);
        pointLight.position.set(0, 0, 0);
        pointLight.visible = showBeams;
        f3d.lightTarget.add(pointLight);
        f3d.pointLight = pointLight;

        // Create beam cone (volumetric) — larger, more visible
        const coneHeight = 5;
        const coneRadiusBottom = coneHeight * Math.tan(0.45);
        const coneGeo = new THREE.CylinderGeometry(0.05, coneRadiusBottom, coneHeight, 24, 1, true);
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
        cone.position.y = -coneHeight / 2;
        cone.visible = showBeams;
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
  // Separate effect — only updates positions, doesn't recreate geometry
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
    // Normalize channelData: it may be a plain object after JSON deserialization
    let raw = dmxState.channelData;
    let channelData: Map<number, Uint8Array>;
    if (raw instanceof Map) {
      channelData = raw;
    } else if (raw && typeof raw === 'object') {
      // Reconstruct Map from plain object
      channelData = new Map<number, Uint8Array>();
      for (const key of Object.keys(raw)) {
        const val = (raw as any)[key];
        channelData.set(Number(key), val instanceof Uint8Array ? val : new Uint8Array(Object.values(val ?? {})));
      }
    } else {
      channelData = new Map<number, Uint8Array>();
    }
    const blackout = dmxState.blackout ?? false;
    const grandMaster = dmxState.grandMaster ?? 255;

    for (const f3d of fixturesRef.current.values()) {
      const data = channelData.get(f3d.universeIndex);
      if (!data) {
        // No DMX data for this universe
        if (f3d.pointLight) f3d.pointLight.intensity = 0;
        if (f3d.beamCone) {
          (f3d.beamCone.material as THREE.MeshBasicMaterial).opacity = 0;
        }
        continue;
      }

      // Find the patched fixture for address lookup
      const pf = patchedFixtures.find(f => f.id === f3d.id);
      if (!pf) continue;

      const baseAddr = pf.startAddress - 1; // 0-based
      const cm = f3d.channelMap;

      // --- Intensity ---
      let intensity = 0;
      if (cm.intensityOffset !== null) {
        intensity = data[baseAddr + cm.intensityOffset] ?? 0;
      } else {
        // No intensity channel: check if any color channel has value
        if (cm.rgbOffsets) {
          const r = data[baseAddr + cm.rgbOffsets[0]] ?? 0;
          const g = data[baseAddr + cm.rgbOffsets[1]] ?? 0;
          const b = data[baseAddr + cm.rgbOffsets[2]] ?? 0;
          intensity = Math.max(r, g, b);
        }
      }

      // Apply grand master + blackout
      if (blackout) intensity = 0;
      intensity = intensity * (grandMaster / 255);

      // Normalize to 0-1 for Three.js
      const normIntensity = intensity / 255;

      // --- Color ---
      let color = new THREE.Color(0xffffff);
      if (cm.rgbOffsets && cm.rgbOffsets.length >= 3) {
        const r = (data[baseAddr + cm.rgbOffsets[0]] ?? 0) / 255;
        const g = (data[baseAddr + cm.rgbOffsets[1]] ?? 0) / 255;
        const b = (data[baseAddr + cm.rgbOffsets[2]] ?? 0) / 255;
        if (r > 0 || g > 0 || b > 0) {
          color.setRGB(r, g, b);
        }
      } else if (cm.wheelOffset !== null) {
        const wheelVal = data[baseAddr + cm.wheelOffset] ?? 0;
        color = wheelValueToColor(wheelVal, cm.wheelCaps);
      }

      // --- Pan/Tilt ---
      if (f3d.headGroup) {
        const panVal = cm.panOffset !== null ? (data[baseAddr + cm.panOffset] ?? 128) : 128;
        const tiltVal = cm.tiltOffset !== null ? (data[baseAddr + cm.tiltOffset] ?? 128) : 128;
        // Map DMX 0-255 to radians: pan 540° (±270°), tilt 0-135° from straight down
        const panAngle = ((panVal / 255) - 0.5) * Math.PI * 3; // ±270°
        f3d.headGroup.rotation.y = panAngle;
        // Tilt: rotate X axis so the beam sweeps up/down
        // DMX 0=up-forward, 128=straight down, 255=down-backward
        const tiltNorm = (tiltVal - 128) / 127; // -1..+1
        f3d.headGroup.rotation.x = -tiltNorm * Math.PI * 0.4; // ±72°
      }

      // --- Update PointLight ---
      if (f3d.pointLight) {
        f3d.pointLight.color.copy(color);
        f3d.pointLight.intensity = normIntensity * 25; // Bright beams
      }

      // --- Update beam cone ---
      if (f3d.beamCone) {
        const mat = f3d.beamCone.material as THREE.MeshBasicMaterial;
        mat.color.copy(color);
        mat.opacity = normIntensity * 0.35; // More visible cone
        f3d.beamCone.visible = showBeams && normIntensity > 0.005;
      }

            // --- Update floor spot / wall spot (based on mountMode) ---
      if (f3d.floorSpot || f3d.floorGlow) {
        const worldPos = new THREE.Vector3();
        f3d.lightTarget.getWorldPosition(worldPos);
        // Beam direction depends on mount mode
        const mode = f3d.mountMode || 'top';
        const localDir = new THREE.Vector3(
          mode === 'rear' ? 0 : 0,
          mode === 'top' ? -1 : mode === 'ground' ? 1 : 0,
          mode === 'rear' ? -1 : 0
        );
        let hitX = worldPos.x;
        let hitY = 0;
        let hitZ = worldPos.z;
        let hitWall = false;
        if (f3d.headGroup) {
          const q = new THREE.Quaternion();
          f3d.headGroup.getWorldQuaternion(q);
          const dir = localDir.clone().applyQuaternion(q);
          // Project to floor (y=0) or to back wall (z=STAGE_DEPTH/2)
          if (mode === 'rear' && dir.z < -0.001) {
            const t = (STAGE_DEPTH/2 - worldPos.z) / dir.z;
            if (t > 0) { hitX = worldPos.x + dir.x * t; hitY = worldPos.y + dir.y * t; hitZ = STAGE_DEPTH/2; hitWall = true; }
          } else if (mode === 'ground' && dir.y > 0.001 && worldPos.y < 5) {
            const t = (5.0 - worldPos.y) / dir.y;
            hitX = worldPos.x + dir.x * t; hitZ = worldPos.z + dir.z * t;
          } else if (mode === 'top' && dir.y < -0.001 && worldPos.y > 0.01) {
            const t = -worldPos.y / dir.y;
            hitX = worldPos.x + dir.x * t; hitZ = worldPos.z + dir.z * t;
          } else {
            // Fallback: project straight per mode
            if (mode === 'ground') hitY = 5;
            hitZ = mode === 'rear' ? STAGE_DEPTH/2 : hitZ;
          }
        } else {
          // Fixed fixture: point straight to target surface
          if (mode === 'ground') hitY = 5;
          if (mode === 'rear') hitZ = STAGE_DEPTH/2;
        }
        const cx = Math.max(-STAGE_WIDTH/2, Math.min(STAGE_WIDTH/2, hitX));
        const cz = Math.max(-STAGE_DEPTH/2, Math.min(STAGE_DEPTH/2, hitZ));
        if (f3d.floorSpot) {
          f3d.floorSpot.position.set(cx, 0.015, cz);
          if (hitWall) f3d.floorSpot.position.set(cx, hitY, STAGE_DEPTH/2 - 0.01);
          const smat = f3d.floorSpot.material as THREE.MeshBasicMaterial;
          smat.color.copy(color);
          smat.opacity = normIntensity * 0.7;
          f3d.floorSpot.visible = showBeams && normIntensity > 0.005;
        }
        if (f3d.floorGlow) {
          f3d.floorGlow.position.set(cx, 0.012, cz);
          if (hitWall) f3d.floorGlow.position.set(cx, hitY, STAGE_DEPTH/2 - 0.01);
          const gmat = f3d.floorGlow.material as THREE.MeshBasicMaterial;
          gmat.color.copy(color);
          gmat.opacity = normIntensity * 0.25;
          f3d.floorGlow.visible = showBeams && normIntensity > 0.005;
        }
      }
      if (f3d.floorSpot || f3d.floorGlow) {
        const worldPos = new THREE.Vector3();
        f3d.lightTarget.getWorldPosition(worldPos);
        // For headGroup fixtures, use headGroup's quaternion to compute beam direction
        let hitX = worldPos.x;
        let hitZ = worldPos.z;
        if (f3d.headGroup) {
          const q = new THREE.Quaternion();
          f3d.headGroup.getWorldQuaternion(q);
          const localDir = new THREE.Vector3(0, 0, -1);
          localDir.applyQuaternion(q);
          if (localDir.y < -0.001 && worldPos.y > 0.01) {
            const t = -worldPos.y / localDir.y;
            hitX = worldPos.x + localDir.x * t;
            hitZ = worldPos.z + localDir.z * t;
          }
        }
        const cx = Math.max(-STAGE_WIDTH/2, Math.min(STAGE_WIDTH/2, hitX));
        const cz = Math.max(-STAGE_DEPTH/2, Math.min(STAGE_DEPTH/2, hitZ));
        if (f3d.floorSpot) {
          f3d.floorSpot.position.set(cx, 0.015, cz);
          const smat = f3d.floorSpot.material as THREE.MeshBasicMaterial;
          smat.color.copy(color);
          smat.opacity = normIntensity * 0.7;
          f3d.floorSpot.visible = showBeams && normIntensity > 0.005;
        }
        if (f3d.floorGlow) {
          f3d.floorGlow.position.set(cx, 0.012, cz);
          const gmat = f3d.floorGlow.material as THREE.MeshBasicMaterial;
          gmat.color.copy(color);
          gmat.opacity = normIntensity * 0.25;
          f3d.floorGlow.visible = showBeams && normIntensity > 0.005;
        }
      }

      // --- Update body emission (glow when active) ---
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
    const container = containerRef.current;
    const camera = cameraRef.current;
    if (!container || !camera) return;

    const rect = container.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, camera);

    // Gather all fixture group meshes
    const targets: THREE.Object3D[] = [];
    for (const f3d of fixturesRef.current.values()) {
      f3d.group.traverse((child) => {
        if (child instanceof THREE.Mesh) targets.push(child);
      });
    }

    const intersects = raycasterRef.current.intersectObjects(targets, false);

    if (intersects.length > 0) {
      // Walk up to find the fixture group
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData?.fixtureId) {
        obj = obj.parent;
      }
      if (obj?.userData?.fixtureId) {
        const fid = obj.userData.fixtureId as string;
        setSelectedFixtureId(fid === selectedFixtureId ? null : fid);
      }
    } else {
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
        onMouseMove={handleCanvasMouseMove}
      >
        {!fixtureDefsReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#08080e]/80 z-10">
            <div className="text-center">
              <div className="w-5 h-5 border-2 border-purple-500/30 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-gray-500">Loading fixture definitions…</p>
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

        {/* Selected fixture editor */}
        {selectedFixture && selectedPos && (
          <div
            className="absolute bottom-4 left-4 bg-[#12121a]/95 border border-purple-500/30 rounded-xl p-4 z-20 shadow-2xl backdrop-blur-sm min-w-[240px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
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
                      onClick={() => setFixturePosition(selectedFixture.id, { mountMode: opt.v })}
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

              {/* Heading / Rotation */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Heading</span>
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
  if (mode === 'rear') f3d.group.rotation.x = -Math.PI / 2;
  else if (mode === 'ground') f3d.group.rotation.x = Math.PI;
  else f3d.group.rotation.x = 0;
}
