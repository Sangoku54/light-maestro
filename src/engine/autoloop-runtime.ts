// ─── Pont runtime : patch Light Maestro → Autoloop SoundSwitch ──────────────
//
// Trait d'union entre le modèle de fixtures réel de Light Maestro
// (`PatchedFixture` + `analyzeFixture`) et le moteur Autoloop pur
// (`autoloop-*`). Ce module est **pur** (aucun import React/Electron/`window`) :
// il ne fait que mapper des structures et construire des banques, donc il est
// testable en node (vitest).

import type { PatchedFixture, FixtureTier } from '../stores/showStore';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';
import { analyzeFixture, capMid, synthPatternCaps } from './fixture-analyzer';
import { zeroDmxOffset } from './dmx-movement';
import { generateAutoscript, BankManager, BANKS } from './autoloop-index';
import type {
  AutoloopFixture,
  FixtureCategory,
  PositionCue,
  AttributeCue,
  AutoloopTimeline,
} from './autoloop-index';

/**
 * Mapping heuristique tier + présence pan/tilt → catégorie SoundSwitch.
 *
 * SoundSwitch distingue les « Washes » (faisceaux larges, fixes) des « Spots »
 * (moving heads). Light Maestro n'a pas cette notion exacte ; on la déduit :
 *   - fixture avec pan OU tilt → `Spot` (moving head) ;
 *   - sinon (wash/par/strobe fixe) → `Wash_Primary` si tier primaire,
 *     `Wash_Secondary` sinon.
 */
export function tierToCategory(tier: FixtureTier, hasPanTilt: boolean): FixtureCategory {
  if (hasPanTilt) return 'Spot';
  return tier === 'primary' ? 'Wash_Primary' : 'Wash_Secondary';
}

/**
 * Convertit les fixtures patchées en `AutoloopFixture[]`, en extrayant les
 * offsets de canaux via `analyzeFixture`.
 *
 * Le `channelMap` produit contient TOUS les canaux détectés par
 * `analyzeFixture` : pan/tilt multi-bras (suffixes `pan2`/`tilt2`…),
 * red/green/blue/white/amber/uv, dimmer, roue couleur, gobo, prisme,
 * zoom/frost/iris/focus, speed, shutter, effect, beam, led1/led2….
 * L'adresse de base (`address`) est le `startAddress` (1-based) ; l'univers est
 * l'index de `universeId` dans `universes` (comme `dispatchChannelsByFixture`).
 */
export function toAutoloopFixtures(
  patchedFixtures: PatchedFixture[],
  defs: Map<string, DmxFixtureDefinition>,
  universes: { id: string }[],
  positions?: Record<string, { centerPan?: number; centerTilt?: number }>,
): AutoloopFixture[] {
  const uniIds = universes.map((u) => String(u.id));
  const out: AutoloopFixture[] = [];

  for (const pf of patchedFixtures) {
    if (pf.enabled === false) continue;
    const def = defs.get(pf.fixtureDefId);
    const fa = analyzeFixture(pf, def);

    const channelMap: Record<string, number> = {};
    // Pan/Tilt — TOUS les bras (multi-pan-tilt), noms suffixés pan2/pan3…, tilt2/…
    fa.panOffsets.forEach((off, i) => { channelMap[i === 0 ? 'pan' : `pan${i + 1}`] = off; });
    fa.tiltOffsets.forEach((off, i) => { channelMap[i === 0 ? 'tilt' : `tilt${i + 1}`] = off; });
    if (fa.rgbOffsets) {
      if (fa.rgbOffsets[0] !== undefined) channelMap['red'] = fa.rgbOffsets[0];
      if (fa.rgbOffsets[1] !== undefined) channelMap['green'] = fa.rgbOffsets[1];
      if (fa.rgbOffsets[2] !== undefined) channelMap['blue'] = fa.rgbOffsets[2];
    }
    // Blanc / Ambre / UV — depuis le 1er segment RGB (RGBW/RGBA/RGBAW/RGBAUUV)
    const seg0 = fa.rgbSegments[0];
    if (seg0?.w != null) channelMap['white'] = seg0.w;
    if (seg0?.a != null) channelMap['amber'] = seg0.a;
    if (seg0?.uv != null) channelMap['uv'] = seg0.uv;
    if (fa.intensityOffset !== null) channelMap['dimmer'] = fa.intensityOffset;
    // Autres canaux (roue couleur, gobo, prisme, beam, vitesse, shutter, effet)
    if (fa.wheelOffset !== null) channelMap['wheel'] = fa.wheelOffset;
    if (fa.goboOffset !== null) channelMap['gobo'] = fa.goboOffset;
    if (fa.prismOffset !== null) channelMap['prism'] = fa.prismOffset;
    if (fa.zoomOffset !== null) channelMap['zoom'] = fa.zoomOffset;
    if (fa.frostOffset !== null) channelMap['frost'] = fa.frostOffset;
    if (fa.irisOffset !== null) channelMap['iris'] = fa.irisOffset;
    if (fa.focusOffset !== null) channelMap['focus'] = fa.focusOffset;
    if (fa.speedOffset !== null) channelMap['speed'] = fa.speedOffset;
    if (fa.shutterOffset !== null) channelMap['shutter'] = fa.shutterOffset;
    if (fa.effectOffset !== null) channelMap['effect'] = fa.effectOffset;
    if (fa.beamOffset !== null) channelMap['beam'] = fa.beamOffset;
    fa.ledIntensityOffsets.forEach((off, i) => { channelMap[`led${i + 1}`] = off; });

    const uniIdx = uniIds.indexOf(pf.universeId);
    // ── Laser : scan X/Y mappé vers pan/tilt (les PositionCue existants le
    // pilotent), plus des clés dédiées pour pattern/mode/blank/vitesses/rotations.
    if (fa.isLaser) {
      if (fa.scanXOffset !== null && fa.panOffset === null) channelMap['pan'] = fa.scanXOffset;
      if (fa.scanYOffset !== null && fa.tiltOffset === null) channelMap['tilt'] = fa.scanYOffset;
      if (fa.patternOffset !== null) channelMap['pattern'] = fa.patternOffset;
      if (fa.laserModeOffset !== null) channelMap['laserMode'] = fa.laserModeOffset;
      if (fa.blankOffset !== null) channelMap['laserBlank'] = fa.blankOffset;
      if (fa.laserSpeedScanOffset !== null) channelMap['laserSpeedScan'] = fa.laserSpeedScanOffset;
      if (fa.laserSpeedPatternOffset !== null) channelMap['laserSpeedPattern'] = fa.laserSpeedPatternOffset;
      fa.laserRotationOffsets.forEach((off, i) => { channelMap[`laserRot${i + 1}`] = off; });
    }

    const pos = positions?.[pf.id];
    const centerPanDmx = pos?.centerPan !== undefined ? 128 + zeroDmxOffset(pos.centerPan, 'pan') : undefined;
    const centerTiltDmx = pos?.centerTilt !== undefined ? 128 + zeroDmxOffset(pos.centerTilt, 'tilt') : undefined;

    out.push({
      id: pf.id,
      category: tierToCategory(pf.tier, fa.panOffset !== null || fa.tiltOffset !== null || fa.scanXOffset !== null || fa.scanYOffset !== null),
      universe: uniIdx >= 0 ? uniIdx : 0,
      address: pf.startAddress,
      channelMap,
      isLaser: fa.isLaser,
      centerPanDmx,
      centerTiltDmx,
    });
  }

  return out;
}

/** Les 4 couleurs de la démo SoundSwitch (cues d'attribut « color »). */
export function defaultColorCues(): AttributeCue[] {
  return [
    { id: 'c-red', attribute: 'color', values: { red: 255, green: 0, blue: 0 } },
    { id: 'c-green', attribute: 'color', values: { red: 0, green: 255, blue: 0 } },
    { id: 'c-blue', attribute: 'color', values: { red: 0, green: 0, blue: 255 } },
    { id: 'c-white', attribute: 'color', values: { red: 255, green: 255, blue: 255, white: 255 } },
  ];
}

/** Cues de position par défaut : un cercle et un huit (Lissajous 1:2). */
export function defaultPositionCues(): PositionCue[] {
  return [
    { id: 'circle', shape: 'circle', speed: Math.PI / 2, phase: 0, radius: 100 },
    { id: 'eight', shape: 'figure_eight', speed: Math.PI / 4, phase: 0, radius: 90 },
  ];
}

/**
 * Cues couleur « roue » pour les lasers ColorPreset : 8 positions réparties
 * sur la plage DMX (balayage de la roue). Appliquées uniquement aux fixtures
 * qui possèdent la clé `wheel` (`emitAttributeKeys` → `channelAddress` → null
 * sinon) ; sans effet sur les fixtures RGB.
 */
export function defaultLaserColorCues(): AttributeCue[] {
  return synthPatternCaps(8).map((cap, i) => ({
    id: `l-wheel-${i + 1}`,
    attribute: 'color',
    values: { wheel: capMid(cap) },
  }));
}

/**
 * Cues non-couleur des lasers : cycle de motifs (`pattern`), baseline mode DMX
 * (`laserMode` = plage haute, pilotable), blanking ouvert (`laserBlank` = 0),
 * vitesses de scan et de pattern **oscillantes** (96 ↔ 224, plus de valeur
 * figée), rotations des axes détectés (`laserRot1..3`, deux valeurs par axe
 * réparties dans la banque → oscillation). Appliquées uniquement aux fixtures
 * laser (clés absentes du channelMap des autres fixtures → ignorées).
 */
export function defaultLaserBeamCues(): AttributeCue[] {
  return [
    ...synthPatternCaps(8).map((cap, i) => ({
      id: `l-pattern-${i + 1}`,
      attribute: 'pattern',
      values: { pattern: capMid(cap) },
      interpolate: false,
    })),
    { id: 'l-mode', attribute: 'laserMode', values: { laserMode: 255 }, interpolate: false },
    { id: 'l-blank', attribute: 'laserBlank', values: { laserBlank: 0 }, interpolate: false },
    // Vitesses : oscillation (le générateur espace chaque cue sur la banque).
    { id: 'l-speed-scan-slow', attribute: 'laserSpeedScan', values: { laserSpeedScan: 96 }, interpolate: false },
    { id: 'l-speed-scan-fast', attribute: 'laserSpeedScan', values: { laserSpeedScan: 224 }, interpolate: false },
    { id: 'l-speed-pattern-slow', attribute: 'laserSpeedPattern', values: { laserSpeedPattern: 96 }, interpolate: false },
    { id: 'l-speed-pattern-fast', attribute: 'laserSpeedPattern', values: { laserSpeedPattern: 224 }, interpolate: false },
    // Rotations : deux valeurs par axe (128 ± 58) — ignorées si le laser
    // n'a pas l'axe correspondant dans son channelMap.
    ...(['laserRot1', 'laserRot2', 'laserRot3'] as const).flatMap((key, ri) => [
      { id: `l-rot-${ri + 1}-a`, attribute: key, values: { [key]: 70 }, interpolate: false },
      { id: `l-rot-${ri + 1}-b`, attribute: key, values: { [key]: 186 }, interpolate: false },
    ]),
  ];
}

/**
 * Cues d'attribut non-couleur (gobo/prisme/beam/effet) — exploitent les canaux
 * zoom/frost/iris/focus/gobo/prisme/speed/shutter/effect détectés par
 * l'analyseur. Le générateur les répartit (≥ 2 bars d'écart) et les applique
 * uniquement aux fixtures qui possèdent le canal (`channelAddress` → null sinon).
 */
export function defaultBeamCues(): AttributeCue[] {
  return [
    { id: 'b-gobo', attribute: 'gobo', values: { gobo: 128 }, interpolate: false },
    { id: 'b-prism', attribute: 'prism', values: { prism: 128 }, interpolate: false },
    { id: 'b-zoom-wide', attribute: 'zoom', values: { zoom: 0 }, rampBeats: 2 },
    { id: 'b-zoom-tight', attribute: 'zoom', values: { zoom: 255 }, rampBeats: 2 },
    { id: 'b-frost', attribute: 'frost', values: { frost: 255 }, rampBeats: 2 },
    { id: 'b-iris', attribute: 'iris', values: { iris: 64 }, rampBeats: 2 },
    { id: 'b-focus', attribute: 'focus', values: { focus: 128 }, rampBeats: 2 },
    { id: 'b-speed', attribute: 'speed', values: { speed: 128 } },
  ];
}

/** Configuration d'une banque : durée + jeu de cues. */
export interface BankConfig {
  targetBars: number;
  positionCues: PositionCue[];
  colorCues: AttributeCue[];
  /** Cues d'attribut non-couleur (gobo/prisme/beam/effet…) — optionnel. */
  beamCues?: AttributeCue[];
}

/**
 * Les 4 configurations par défaut (une par banque) :
 *   - banque 0 : chasse couleur pure ;
 *   - banque 1 : cercle + couleurs ;
 *   - banque 2 : huit + couleurs ;
 *   - banque 3 : cercle + huit + 2 couleurs (plus dense).
 */
export const DEFAULT_BANK_CONFIGS: BankConfig[] = [
  { targetBars: 16, positionCues: [], colorCues: defaultColorCues() },
  { targetBars: 16, positionCues: [defaultPositionCues()[0]], colorCues: defaultColorCues() },
  { targetBars: 16, positionCues: [defaultPositionCues()[1]], colorCues: defaultColorCues() },
  { targetBars: 16, positionCues: defaultPositionCues(), colorCues: defaultColorCues().slice(0, 2), beamCues: defaultBeamCues() },
];

/**
 * Génère un loop par catégorie présente dans `fixtures`, pour une config donnée.
 */
export function generateBankLoops(
  fixtures: AutoloopFixture[],
  config: BankConfig,
): AutoloopTimeline[] {
  const categories = [...new Set(fixtures.map((f) => f.category))];
  return categories.map((category) => {
    // Les cues laser ne sont injectées que si la catégorie contient un laser.
    const hasLaser = fixtures.some((f) => f.category === category && f.isLaser);
    const laserColorCues = hasLaser ? defaultLaserColorCues() : [];
    const laserBeamCues = hasLaser ? defaultLaserBeamCues() : [];
    return generateAutoscript({
      targetBars: config.targetBars,
      fixtures,
      category,
      positionCues: config.positionCues,
      attributeCues: [...config.colorCues, ...laserColorCues, ...(config.beamCues ?? []), ...laserBeamCues],
    });
  });
}

/**
 * Construit le `BankManager` 4×32 à l'identique SoundSwitch 2.9 : 128 slots remplis.
 *
 * Chaque banque contient 32 loops (8/16/32/64 bars selon la banque), chaque slot
 * est une variation déterministe (positionCues + palette + targetBars) par catégorie.
 * Les 3 catégories (Wash_Primary, Wash_Secondary, Spot) tournent sur les slots
 * (slot % 3) pour garantir que chaque catégorie apparaît ~10× par banque.
 */
export function buildSoundswitchBanks(fixtures: AutoloopFixture[]): BankManager {
  const banks = new BankManager();
  const categories = [...new Set(fixtures.map((f) => f.category))] as FixtureCategory[];
  if (categories.length === 0) return banks;
  const barOptions = [8, 16, 32, 64];
  const posVariants: PositionCue[][] = [
    [],
    [defaultPositionCues()[0]],
    [defaultPositionCues()[1]],
    defaultPositionCues(),
  ];
  const colorPalettes: AttributeCue[][] = [
    defaultColorCues(),
    defaultColorCues().slice(0, 2),
    defaultColorCues().slice(1, 3),
    [...defaultColorCues()].reverse(),
  ];
  for (let bank = 0; bank < BANKS; bank++) {
    const loops: AutoloopTimeline[] = [];
    for (let slot = 0; slot < 32; slot++) {
      const targetBars = barOptions[(bank + Math.floor(slot / 8)) % barOptions.length];
      const pos = posVariants[slot % posVariants.length];
      const cols = colorPalettes[slot % colorPalettes.length];
      const category = categories[slot % categories.length];
      const hasLaser = fixtures.some((f) => f.category === category && f.isLaser);
      const laserColorCues = hasLaser ? defaultLaserColorCues() : [];
      const laserBeamCues = hasLaser ? defaultLaserBeamCues() : [];
      // Banque 3 (index 3) ajoute les beamCues, les autres restent couleur/movement purs (comme DEFAULT mais varié)
      const beam = bank === 3 && slot % 3 === 0 ? defaultBeamCues() : [];
      const loop = generateAutoscript({
        targetBars,
        fixtures,
        category,
        positionCues: pos,
        attributeCues: [...cols, ...laserColorCues, ...beam, ...laserBeamCues],
      });
      // ID lisible identique SoundSwitch: autoscript-Wash_Primary-16b-# (déjà généré)
      loops.push(loop);
    }
    // Remplit les 32 slots de la banque (populate ne remplit que les vides, ici banque vide → 32)
    banks.populate(bank, loops);
  }
  return banks;
}
