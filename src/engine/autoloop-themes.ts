// ─── Autoloop — banques thématiques 4×32 ────────────────────────────────────
//
// Génère les 4 banques de la page AutoLoops en les ORGANISANT PAR THÈME :
//
//   0 · Couleurs — un slot par couleur pleine (« tout en bleu », « tout en
//       jaune », …) sur TOUTES les fixtures patchées.
//   1 · Effets   — mouvements (patterns `effect-engine`), strobe, respiration
//       d'intensité, gobo, prisme, beam, roue couleur, laser.
//   2 · Matrice  — motifs spatiaux (chase/vague/explosion/dégradé/arc-en-ciel)
//       calculés sur la grille de fixtures, via `rgb-matrix-patterns`.
//   3 · Mix      — compilation couleur + mouvement (+ strobe / respiration).
//
// Garanties :
//   * 4 × 32 = 128 slots TOUJOURS remplis (aucun bouton vide) dès qu'une
//     fixture est patchée — un slot inapplicable est remplacé par une
//     variante (rayon/vitesse/couleur) plutôt que laissé à `null` ;
//   * chaque loop porte `label` (libellé lisible) + `swatch` (couleur d'accent)
//     pour que l'UI n'affiche plus d'id cryptique ;
//   * tous les canaux détectés par l'analyseur sont exploités (RGB/roue/gate
//     laser/blanc/ambre/UV, dimmer remappé dans sa plage, strobe dédié…).
//
// Module PUR : zéro import React/Electron/store.

import type { DmxFixtureCapability } from '../hooks/dmx-cues';
import {
  AutoloopFixture,
  AutoloopTimeline,
  ChannelKey,
  FixtureCategory,
  BEATS_PER_BAR,
  clampDmx,
} from './autoloop-types';
import { BankManager, BANKS, PER_BANK } from './autoloop-banks';
import { loopColorLabel, loopMovementLabel, loopMatrixLabel, loopWord } from './autoloop-types';
import { evalEffect, type EffectPattern } from './effect-engine';
import { getPatternColor, hexToRgb } from './rgb-matrix-patterns';
import { findBestWheelCap } from './dmx-color';
import { capMid } from './fixture-analyzer';

// ─── Métadonnées des banques ────────────────────────────────────────────────

/** Identifiant thématique d'une banque (ordre = index de banque). */
export type BankThemeId = 'couleurs' | 'effets' | 'matrice' | 'mix';

export interface BankThemeMeta {
  id: BankThemeId;
  /** Libellé court affiché sur l'onglet de banque. */
  label: string;
  /** Aide-mémoire affiché en infobulle. */
  hint: string;
  /** Classes d'accent (texte) pour l'UI. */
  accent: string;
}

/** Les 4 banques thématiques, dans l'ordre de la matrice 4×32. */
export const BANK_THEMES: readonly BankThemeMeta[] = [
  {
    id: 'couleurs',
    label: 'Couleurs',
    hint: 'Look plein : toutes les fixtures dans une même couleur',
    accent: 'text-purple-300',
  },
  {
    id: 'effets',
    label: 'Effets',
    hint: 'Mouvements, strobe, intensité, gobo, prisme, beam, laser',
    accent: 'text-cyan-300',
  },
  {
    id: 'matrice',
    label: 'Matrice RGB',
    hint: 'Motifs spatiaux calculés sur la grille des fixtures',
    accent: 'text-emerald-300',
  },
  {
    id: 'mix',
    label: 'Mix',
    hint: 'Compilation : couleur + mouvement (+ strobe / respiration)',
    accent: 'text-amber-300',
  },
];

// ─── Palette « Couleurs » (exactement 32 teintes) ───────────────────────────

export interface ThemeColor {
  label: string;
  hex: string;
}

export const THEME_COLORS: readonly ThemeColor[] = [
  { label: 'Rouge', hex: '#ff0000' },
  { label: 'Vert', hex: '#00ff00' },
  { label: 'Bleu', hex: '#0000ff' },
  { label: 'Blanc', hex: '#ffffff' },
  { label: 'Jaune', hex: '#ffff00' },
  { label: 'Cyan', hex: '#00ffff' },
  { label: 'Magenta', hex: '#ff00ff' },
  { label: 'Orange', hex: '#ff8000' },
  { label: 'Violet', hex: '#8000ff' },
  { label: 'Rose', hex: '#ff4080' },
  { label: 'Lime', hex: '#80ff00' },
  { label: 'Turquoise', hex: '#00ffc8' },
  { label: 'Or', hex: '#ffc000' },
  { label: 'Indigo', hex: '#4000ff' },
  { label: 'Corail', hex: '#ff6f61' },
  { label: 'Saumon', hex: '#ffa07a' },
  { label: 'Chartreuse', hex: '#bfff00' },
  { label: 'Azur', hex: '#00bfff' },
  { label: 'Lavande', hex: '#b57edc' },
  { label: 'Bordeaux', hex: '#8b0036' },
  { label: 'Olive', hex: '#808000' },
  { label: 'Menthe', hex: '#3eb489' },
  { label: 'Pêche', hex: '#ffcba4' },
  { label: 'Émeraude', hex: '#50c878' },
  { label: 'Sarcelle', hex: '#008080' },
  { label: 'Prune', hex: '#dda0dd' },
  { label: 'Crème', hex: '#fff5e1' },
  { label: 'Argent', hex: '#c0c0c0' },
  { label: 'Néon rose', hex: '#ff1493' },
  { label: 'Néon vert', hex: '#39ff14' },
  { label: 'Néon bleu', hex: '#00e5ff' },
  { label: 'Ambre', hex: '#ffbf00' },
];

/** Catalogue des mouvements exploitables (patterns `effect-engine`). */
const MOVE_PATTERNS: ReadonlyArray<{ pattern: EffectPattern; label: string }> = [
  { pattern: 'circle', label: 'Cercle' },
  { pattern: 'square', label: 'Carré' },
  { pattern: 'figure8', label: 'Huit' },
  { pattern: 'zigzag', label: 'Zigzag' },
  { pattern: 'sweep', label: 'Balayage' },
  { pattern: 'wave', label: 'Vague' },
  { pattern: 'bounce', label: 'Rebond' },
  { pattern: 'pulse', label: 'Pouls' },
  // Dérive : amplitude interne très faible (0.1) → normalisée comme les autres,
  // le bouton dérive lentement sur toute la course au lieu de rester figé.
  { pattern: 'static', label: 'Dérive' },
  { pattern: 'spiral', label: 'Spirale' },
  { pattern: 'heartbeat', label: 'Battement' },
  { pattern: 'randomWalk', label: 'Marche aléatoire' },
  { pattern: 'panOnly', label: 'Pan seul' },
  { pattern: 'tiltOnly', label: 'Tilt seul' },
  { pattern: 'diamond', label: 'Losange' },
  { pattern: 'intro', label: 'Intro' },
  { pattern: 'verse', label: 'Verset' },
  { pattern: 'chorus', label: 'Refrain' },
  { pattern: 'bridge', label: 'Pont' },
  { pattern: 'drop', label: 'Drop' },
  { pattern: 'outro', label: 'Outro' },
];

/** Durée d'un loop par défaut (bars) — 8 bars = 32 beats. */
const DEFAULT_BARS = 8;

/** Longueur en beats d'un loop par défaut. */
const DEFAULT_BEATS = DEFAULT_BARS * BEATS_PER_BAR;

// ─── Accumulateur de keyframes (avec dédoublonnage) ─────────────────────────

class KeyBuilder {
  readonly keys: ChannelKey[] = [];
  private last = new Map<string, number>();

  /** Pose une valeur sur une adresse DMX absolue (1-based). */
  set(addr: number, beat: number, value: number, ramp = 0): void {
    const ch = String(addr);
    const v = clampDmx(value);
    if (this.last.get(ch) === v) return; // valeur inchangée → clé redondante
    this.last.set(ch, v);
    this.keys.push({ channel: ch, beat, value: v, rampBeats: ramp });
  }

  /** Variante de `set` qui ignore le dédoublonnage (clé de maintien/raccord). */
  setForced(addr: number, beat: number, value: number, ramp = 0): void {
    const ch = String(addr);
    const v = clampDmx(value);
    this.last.set(ch, v);
    this.keys.push({ channel: ch, beat, value: v, rampBeats: ramp });
  }

  /** Dernière valeur posée sur une adresse (pour les fallbacks couleur). */
  lastValue(addr: number): number | undefined {
    return this.last.get(String(addr));
  }

  /**
   * Pose une suite dense de points (mouvement continu) : les valeurs consécutives
   * identiques sont fusionnées, et chaque clé reçoit pour `rampBeats` l'écart
   * réel avec la clé précédente — indispensable pour que l'interpolation
   * linéaire du moteur reproduise exactement la courbe échantillonnée.
   */
  setRun(addr: number, points: ReadonlyArray<{ beat: number; value: number }>): void {
    const ch = String(addr);
    const kept: Array<{ beat: number; value: number }> = [];
    for (const p of points) {
      const v = clampDmx(p.value);
      if (kept.length > 0 && kept[kept.length - 1].value === v) continue;
      kept.push({ beat: p.beat, value: v });
    }
    for (let i = 0; i < kept.length; i++) {
      const ramp = i === 0 ? 0 : kept[i].beat - kept[i - 1].beat;
      this.last.set(ch, kept[i].value);
      this.keys.push({ channel: ch, beat: kept[i].beat, value: kept[i].value, rampBeats: ramp });
    }
  }
}

// ─── Accès canaux ───────────────────────────────────────────────────────────

/** Adresse DMX absolue d'un canal logique, ou `null`. */
function off(fx: AutoloopFixture, logical: string): number | null {
  const o = fx.channelMap[logical];
  return o === undefined ? null : fx.address + o;
}

/** Tri numérique des suffixes : `pan` (0) < `pan2` < `pan10`. */
function suffixOrder(key: string, base: string): number {
  const rest = key.slice(base.length);
  return rest === '' ? 1 : parseInt(rest, 10) || 0;
}

function axesOf(fx: AutoloopFixture, base: 'pan' | 'tilt'): number[] {
  return Object.keys(fx.channelMap)
    .filter((k) => k === base || k.startsWith(base) && /^\d+$/.test(k.slice(base.length)))
    .sort((a, b) => suffixOrder(a, base) - suffixOrder(b, base))
    .map((k) => fx.address + fx.channelMap[k]);
}

function ledOffsets(fx: AutoloopFixture): number[] {
  return Object.keys(fx.channelMap)
    .filter((k) => /^led\d+$/.test(k))
    .sort()
    .map((k) => fx.address + fx.channelMap[k]);
}

function capsOf(fx: AutoloopFixture, logical: string): DmxFixtureCapability[] {
  return fx.capsByChannel?.[logical] ?? [];
}

// ─── Couleur ────────────────────────────────────────────────────────────────

function isNearWhite(rgb: [number, number, number]): boolean {
  return Math.min(rgb[0], rgb[1], rgb[2]) >= 200;
}

function isAmber(rgb: [number, number, number]): boolean {
  return rgb[0] >= 200 && rgb[1] >= 110 && rgb[2] <= 90;
}

function isUv(rgb: [number, number, number]): boolean {
  return rgb[2] >= 170 && rgb[0] <= 150 && rgb[1] <= 100;
}

/** Teinte HSV (0..1) d'un triplet RGB. */
function hueOf([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h / 6) + 1) % 1;
}

/** Position DMX d'une couleur sur la roue : cap le plus proche (caps-aware). */
function wheelValue(fx: AutoloopFixture, hex: string, rgb: [number, number, number]): number {
  const caps = capsOf(fx, 'wheel');
  if (caps.length > 0) {
    const best = findBestWheelCap(caps, hex);
    return best ? capMid(best) : capMid(caps[0]);
  }
  // Sans caps : teinte → position normalisée (approximation déterministe).
  const catPos: Record<string, number> = {
    red: 0.1, orange: 0.2, yellow: 0.3, green: 0.42, cyan: 0.55,
    blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02, black: 0.02,
  };
  const cat = classifyColorName(rgb);
  return Math.round((catPos[cat] ?? hueOf(rgb)) * 255);
}

function classifyColorName(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 40) return 'black';
  if (max - min < 30) return max > 200 ? 'white' : 'black';
  const h = hueOf(rgb) * 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 150) return 'green';
  if (h < 195) return 'cyan';
  if (h < 260) return 'blue';
  if (h < 300) return 'purple';
  return 'magenta';
}

/**
 * Écrit une couleur pleine sur une fixture (RGB / blanc / ambre / UV / roue /
 * gate laser / LED) — appelle `set` avec `beat = 0` (valeur tenue).
 */
function putColor(kb: KeyBuilder, fx: AutoloopFixture, hex: string, rgb: [number, number, number], beat = 0): void {
  const r = off(fx, 'red');
  const g = off(fx, 'green');
  const b = off(fx, 'blue');
  const white = off(fx, 'white');
  const amber = off(fx, 'amber');
  const uv = off(fx, 'uv');

  if (r !== null && g !== null && b !== null) {
    kb.set(r, beat, rgb[0]);
    kb.set(g, beat, rgb[1]);
    kb.set(b, beat, rgb[2]);
    if (white !== null) kb.set(white, beat, isNearWhite(rgb) ? 255 : 0);
    if (amber !== null) kb.set(amber, beat, isAmber(rgb) ? 255 : 0);
    if (uv !== null) kb.set(uv, beat, isUv(rgb) ? 255 : 0);
    return;
  }

  // Pas de RGB : roue couleur (la vraie couleur), puis alternatives.
  const wheel = off(fx, 'wheel');
  if (wheel !== null) {
    kb.set(wheel, beat, wheelValue(fx, hex, rgb));
    return;
  }
  const gate = off(fx, 'laserColorGate');
  if (gate !== null) {
    const caps = capsOf(fx, 'laserColorGate');
    if (caps.length > 0) {
      const best = findBestWheelCap(caps, hex);
      kb.set(gate, beat, best ? capMid(best) : capMid(caps[0]));
    } else {
      kb.set(gate, beat, Math.round(hueOf(rgb) * 255));
    }
    return;
  }
  if (white !== null) {
    kb.set(white, beat, 255); // couleur non exprimable → au moins de la lumière
    return;
  }
  for (const addr of ledOffsets(fx)) kb.set(addr, beat, 255);
}

/**
 * Look de base : intensité (remappée dans la plage du canal), shutter ouvert,
 * master laser ouvert, blanking laser ouvert. `shutter: false` pour les loops
 * qui pilotent eux-mêmes le shutter (strobe).
 */
function putBase(
  kb: KeyBuilder,
  fx: AutoloopFixture,
  opts: { shutter?: boolean; dimmer?: number } = {},
): void {
  const dim = off(fx, 'dimmer');
  if (dim !== null) kb.set(dim, 0, mapDimmer(opts.dimmer ?? 255, fx));
  if (opts.shutter !== false) {
    const sh = off(fx, 'shutter');
    if (sh !== null) kb.set(sh, 0, 255);
  }
  const master = off(fx, 'laserMaster');
  if (master !== null) {
    const caps = capsOf(fx, 'laserMaster');
    const on = caps.find((c) => /^(on|open|enable|actif)/i.test(c.name ?? ''));
    const value = on ? capMid(on) : caps.length > 0 ? capMid(caps[caps.length - 1]) : 255;
    kb.set(master, 0, value);
  }
  const blank = off(fx, 'laserBlank');
  if (blank !== null) kb.set(blank, 0, 0);
  const mode = off(fx, 'laserMode');
  if (mode !== null) kb.set(mode, 0, 255);
}

/** Remappe un dimmer 0..255 dans la plage d'un canal hybride Dimmer/Strobe. */
function mapDimmer(raw: number, fx: AutoloopFixture): number {
  const range = fx.dimmerRange;
  if (!range || range.max <= range.min) return raw;
  return range.min + Math.round((Math.max(0, Math.min(255, raw)) / 255) * (range.max - range.min));
}

// ─── Mouvement ──────────────────────────────────────────────────────────────

/**
 * Écrit un pattern de mouvement sur les axes pan/tilt de `fx`.
 *
 * Deux pièges évités (les boutons Mouvement semblaient « inactifs ») :
 *
 *  1. **Anti-aliasing** : un keyframe par beat ne donne que `beatsPerCycle`
 *     positions distinctes par cycle. À 2 beats/cycle, `figure8` tombait
 *     exactement sur les zéros de `sin(p)` à CHAQUE beat (pan ET tilt figés) et
 *     `spiral` tuait le pan à 4 beats/cycle. On échantillonne donc à au moins
 *     8 points par cycle (jusqu'à 128 clés/loop), avec la rampe réelle entre
 *     les points.
 *  2. **Amplitude** : `evalEffect` livre des pics < 1 (outro 0.2, static 0.1,
 *     pulse 0.85…) donc le rayon demandé n'était jamais atteint — certains
 *     patterns bougeaient de 2 DMX. Chaque axe est recentré puis normalisé sur
 *     le rayon, dans la limite de la course disponible (centre ± marge).
 *
 * @returns true si la fixture possède au moins un axe.
 */
function putMovement(
  kb: KeyBuilder,
  fx: AutoloopFixture,
  pattern: EffectPattern,
  lengthBeats: number,
  radius: number,
  beatsPerCycle: number,
): boolean {
  const pans = axesOf(fx, 'pan');
  const tilts = axesOf(fx, 'tilt');
  if (pans.length === 0 && tilts.length === 0) return false;

  const motorCount = Math.max(pans.length, tilts.length, 1);
  const phaseStep = (2 * Math.PI) / motorCount;
  const centerPan = fx.centerPanDmx ?? 128;
  const centerTilt = fx.centerTiltDmx ?? 128;

  // ≥ 8 échantillons par cycle (borné à 128 clés par axe).
  const samples = Math.min(128, Math.max(8, Math.round((lengthBeats * 8) / beatsPerCycle)));
  const step = lengthBeats / samples;

  // Amplitude : plage observée sur les points réellement échantillonnés.
  let pMin = Infinity;
  let pMax = -Infinity;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < samples; i++) {
    const phase = ((i * step) / beatsPerCycle) * Math.PI * 2;
    for (let m = 0; m < motorCount; m++) {
      const [px, py] = evalEffect(pattern, phase, m * phaseStep);
      if (px < pMin) pMin = px;
      if (px > pMax) pMax = px;
      if (py < tMin) tMin = py;
      if (py > tMax) tMax = py;
    }
  }

  const amplitude = (min: number, max: number, center: number): number => {
    const half = (max - min) / 2;
    if (!Number.isFinite(half) || half < 1e-9) return 0; // axe inactif
    const headroom = Math.min(center, 255 - center); // course réellement disponible
    return Math.min(radius, headroom);
  };
  const rescale = (v: number, min: number, max: number, center: number, amp: number): number => {
    const half = (max - min) / 2;
    if (amp <= 0 || half < 1e-9) return center;
    return center + ((v - (min + max) / 2) * amp) / half;
  };

  const panAmp = amplitude(pMin, pMax, centerPan);
  const tiltAmp = amplitude(tMin, tMax, centerTilt);

  const emit = (
    addrs: number[],
    pick: (px: number, py: number) => number,
    min: number,
    max: number,
    center: number,
    amp: number,
  ): void => {
    for (let a = 0; a < addrs.length; a++) {
      const addr = addrs[a];
      if (amp <= 0) {
        // Axe non utilisé par ce pattern (ex. `panOnly`) : on pose le centre.
        kb.set(addr, 0, center, 0);
        continue;
      }
      const points: Array<{ beat: number; value: number }> = [];
      const spread = a * phaseStep;
      for (let i = 0; i < samples; i++) {
        const phase = ((i * step) / beatsPerCycle) * Math.PI * 2;
        const [px, py] = evalEffect(pattern, phase, spread);
        points.push({ beat: i * step, value: rescale(pick(px, py), min, max, center, amp) });
      }
      kb.setRun(addr, points);
    }
  };

  emit(pans, (px) => px, pMin, pMax, centerPan, panAmp);
  emit(tilts, (_px, py) => py, tMin, tMax, centerTilt, tiltAmp);
  return true;
}

// ─── Effets ponctuels ───────────────────────────────────────────────────────

/** Canaux couleur pilotables (RGBW/UV + LED) d'une fixture. */
function colorAddrs(fx: AutoloopFixture): number[] {
  const out: number[] = [];
  for (const key of ['red', 'green', 'blue', 'white', 'amber', 'uv'] as const) {
    const addr = off(fx, key);
    if (addr !== null) out.push(addr);
  }
  out.push(...ledOffsets(fx));
  return out;
}

interface PulseTarget {
  addrs: number[];
  /** Valeur « éteint » par adresse. */
  lo: number[];
  /** Valeur « allumé » par adresse. */
  hi: number[];
}

/**
 * Cible de modulation d'intensité, par ordre de préférence.
 *
 *   strobe : strobe dédié → shutter → dimmer → master laser → mode laser
 *            (CLOSED ↔ MANUAL) → couleur (flash noir/blanc)
 *   pulse  : dimmer → master laser → mode laser → couleur
 *
 * Sans cette chaîne, une fixture RGB-only (UKing en mode 3 canaux), un laser
 * sans master (RGB ALIEN) ou un dimmer-less par restait muet sur les slots
 * « Strobe » / « Respiration ».
 */
function pulseTargetOf(
  kb: KeyBuilder,
  fx: AutoloopFixture,
  kind: 'strobe' | 'pulse',
): PulseTarget | null {
  if (kind === 'strobe') {
    const dedicated = off(fx, 'strobe');
    if (dedicated !== null) return { addrs: [dedicated], lo: [0], hi: [180] };
    const shutter = off(fx, 'shutter');
    if (shutter !== null) return { addrs: [shutter], lo: [0], hi: [255] };
  }

  const dim = off(fx, 'dimmer');
  if (dim !== null) return { addrs: [dim], lo: [mapDimmer(0, fx)], hi: [mapDimmer(255, fx)] };

  const master = off(fx, 'laserMaster');
  if (master !== null) {
    const caps = capsOf(fx, 'laserMaster');
    if (caps.length === 0) return { addrs: [master], lo: [0], hi: [255] };
    const on = caps.find((c) => /^(on|open|enable|actif)/i.test(c.name ?? ''));
    return {
      addrs: [master],
      lo: [capMid(caps[0])],
      hi: [on ? capMid(on) : capMid(caps[caps.length - 1])],
    };
  }

  const mode = off(fx, 'laserMode');
  if (mode !== null) {
    const caps = capsOf(fx, 'laserMode');
    const closed = caps.find((c) => /closed|close|off|rien|ferm|blackout/i.test(c.name ?? ''));
    const manual = caps.find((c) => /^(manual|open|on\b|actif|enable)/i.test(c.name ?? ''));
    if (closed !== undefined && manual !== undefined) {
      return { addrs: [mode], lo: [capMid(closed)], hi: [capMid(manual)] };
    }
  }

  const cols = colorAddrs(fx);
  if (cols.length > 0) {
    // « Allumé » = couleur déjà posée par le loop (Mix) ou blanc par défaut.
    return { addrs: cols, lo: cols.map(() => 0), hi: cols.map((a) => kb.lastValue(a) ?? 255) };
  }
  return null;
}

/**
 * Clignotement : la chaîne complète des cibles (voir `pulseTargetOf`), sinon
 * la fixture est intrinsèquement incapable de clignoter.
 */
function putStrobe(kb: KeyBuilder, fx: AutoloopFixture, lengthBeats: number, stepBeats: number): boolean {
  const target = pulseTargetOf(kb, fx, 'strobe');
  if (target === null) return false;
  for (let b = 0; b < lengthBeats; b += stepBeats) {
    const on = Math.round(b / stepBeats) % 2 === 0;
    const beat = Math.round(b * 100) / 100;
    for (let i = 0; i < target.addrs.length; i++) {
      kb.set(target.addrs[i], beat, on ? target.hi[i] : target.lo[i], 0);
    }
  }
  return true;
}

/** Respiration d'intensité (sine 0 → 1), une rampe par beat. */
function putDimmerPulse(kb: KeyBuilder, fx: AutoloopFixture, lengthBeats: number, periodBeats: number): boolean {
  const target = pulseTargetOf(kb, fx, 'pulse');
  if (target === null) return false;
  for (let beat = 0; beat < lengthBeats; beat++) {
    const t = 0.5 + 0.5 * Math.sin((beat / periodBeats) * Math.PI * 2 - Math.PI / 2);
    for (let i = 0; i < target.addrs.length; i++) {
      const v = target.lo[i] + (target.hi[i] - target.lo[i]) * t;
      kb.set(target.addrs[i], beat, v, beat === 0 ? 0 : 1);
    }
  }
  return true;
}

/** Balayage de la roue couleur (caps-aware, sinon balayage linéaire). */
function putWheelSweep(kb: KeyBuilder, fx: AutoloopFixture, lengthBeats: number): boolean {
  const wheel = off(fx, 'wheel');
  if (wheel === null) return false;
  const caps = capsOf(fx, 'wheel');
  if (caps.length > 1) {
    const step = lengthBeats / caps.length;
    for (let beat = 0; beat < lengthBeats; beat++) {
      const idx = Math.floor(beat / step) % caps.length;
      kb.set(wheel, beat, capMid(caps[idx]), beat === 0 ? 0 : Math.max(1, Math.round(step)));
    }
  } else {
    for (let beat = 0; beat < lengthBeats; beat++) {
      kb.set(wheel, beat, (beat * (256 / lengthBeats)) % 256, 1);
    }
  }
  return true;
}

/** Séquence de gobos (statiques de préférence), snap entre chaque motif. */
function putGobo(kb: KeyBuilder, fx: AutoloopFixture, lengthBeats: number): boolean {
  const gobo = off(fx, 'gobo');
  if (gobo === null) return false;
  const caps = capsOf(fx, 'gobo');
  const open = caps.filter((c) => /\b(open|white|normal|no gobo)\b/i.test(c.name ?? ''));
  const stat = caps.filter((c) => /^(gobo|pattern)\s*\d+/i.test(c.name ?? ''));
  const pool = stat.length > 0 ? stat : caps.filter((c) => !open.includes(c));
  if (pool.length === 0) {
    // Aucune cap exploitable : oscillation douce 0..64 (jamais la zone de spin).
    for (let beat = 0; beat < lengthBeats; beat++) {
      kb.set(gobo, beat, Math.round(32 + 32 * Math.sin((beat / lengthBeats) * Math.PI * 2)), beat === 0 ? 0 : 2);
    }
    return true;
  }
  const step = Math.max(2, Math.floor(lengthBeats / Math.min(pool.length, 4)));
  for (let beat = 0, i = 0; beat < lengthBeats; beat += step, i++) {
    kb.set(gobo, beat, capMid(pool[i % pool.length]), 0);
  }
  return true;
}

/** Prisme : insertion/retrait (caps si disponibles, sinon 0 ↔ 96). */
function putPrism(kb: KeyBuilder, fx: AutoloopFixture, lengthBeats: number): boolean {
  const prism = off(fx, 'prism');
  if (prism === null) return false;
  const caps = capsOf(fx, 'prism');
  const seq = caps.length > 1 ? caps.map(capMid) : [0, 96, 0, 96];
  const step = Math.max(2, Math.round(lengthBeats / seq.length));
  for (let beat = 0, i = 0; beat < lengthBeats; beat += step, i++) {
    kb.set(prism, beat, seq[i % seq.length], beat === 0 ? 0 : step);
  }
  return true;
}

/** Oscillation d'un canal beam (plage sûre : jamais complètement fermé). */
function putBeamSwing(
  kb: KeyBuilder,
  fx: AutoloopFixture,
  channel: 'zoom' | 'frost' | 'iris' | 'focus',
  lengthBeats: number,
  lo: number,
  hi: number,
): boolean {
  const addr = off(fx, channel);
  if (addr === null) return false;
  for (let beat = 0; beat < lengthBeats; beat++) {
    const v = lo + (hi - lo) * (0.5 + 0.5 * Math.sin((beat / lengthBeats) * Math.PI * 2 - Math.PI / 2));
    kb.set(addr, beat, v, beat === 0 ? 0 : 2);
  }
  return true;
}

/** Vitesse de balayage des lasers (oscillation lente, jamais figée). */
function putLaserScanSpeed(kb: KeyBuilder, fx: AutoloopFixture, lengthBeats: number): boolean {
  const scan = off(fx, 'laserSpeedScan');
  const pattern = off(fx, 'laserSpeedPattern');
  const target = scan ?? pattern;
  if (target === null) return false;
  for (let beat = 0; beat < lengthBeats; beat++) {
    const v = 96 + Math.round(128 * (0.5 + 0.5 * Math.sin((beat / lengthBeats) * Math.PI * 4)));
    kb.set(target, beat, v, beat === 0 ? 0 : 2);
  }
  return true;
}

// ─── Motifs de matrice ──────────────────────────────────────────────────────

interface MatrixRecipe {
  pattern: string;
  label: string;
  start: string;
  end: string;
  width: number;
  /** Beats par cycle de motif (0 = statique : une seule clé). */
  beatsPerCycle: number;
}

/** Libellés FR sources des recettes matrice (clés stables du dict de locale). */
export function matrixRecipeLabels(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of MATRIX_RECIPES) {
    if (!seen.has(r.label)) { seen.add(r.label); out.push(r.label); }
  }
  return out;
}
/** Les 32 recettes de la banque « Matrice RGB ». */
const MATRIX_RECIPES: readonly MatrixRecipe[] = [
  { pattern: 'chase', label: 'Chase bleu', start: '#0066ff', end: '#ffffff', width: 30, beatsPerCycle: 2 },
  { pattern: 'chase', label: 'Chase blanc', start: '#ffffff', end: '#0066ff', width: 40, beatsPerCycle: 4 },
  { pattern: 'chase', label: 'Chase rouge', start: '#ff2200', end: '#ffd400', width: 25, beatsPerCycle: 2 },
  { pattern: 'chase', label: 'Chase vert', start: '#00ff66', end: '#ffffff', width: 35, beatsPerCycle: 4 },
  { pattern: 'chase', label: 'Chase violet', start: '#9900ff', end: '#00ffff', width: 30, beatsPerCycle: 6 },
  { pattern: 'chase', label: 'Chase arc-en-ciel', start: '#ff0044', end: '#0066ff', width: 45, beatsPerCycle: 2 },
  { pattern: 'wave', label: 'Vague bleue', start: '#0066ff', end: '#ffffff', width: 40, beatsPerCycle: 4 },
  { pattern: 'wave', label: 'Vague verte', start: '#00ff88', end: '#ffffff', width: 40, beatsPerCycle: 4 },
  { pattern: 'wave', label: 'Vague ambre', start: '#ffaa00', end: '#ffffff', width: 35, beatsPerCycle: 6 },
  { pattern: 'wave', label: 'Vague magenta', start: '#ff00aa', end: '#ffffff', width: 40, beatsPerCycle: 2 },
  { pattern: 'wave', label: 'Vague blanche', start: '#ffffff', end: '#0088ff', width: 50, beatsPerCycle: 4 },
  { pattern: 'wave', label: 'Vague cyan', start: '#00e5ff', end: '#003366', width: 40, beatsPerCycle: 6 },
  { pattern: 'burst', label: 'Explosion blanche', start: '#ffffff', end: '#0066ff', width: 30, beatsPerCycle: 4 },
  { pattern: 'burst', label: 'Explosion rouge', start: '#ff3300', end: '#000000', width: 35, beatsPerCycle: 4 },
  { pattern: 'burst', label: 'Explosion verte', start: '#00ff44', end: '#003300', width: 30, beatsPerCycle: 6 },
  { pattern: 'burst', label: 'Explosion dorée', start: '#ffcc00', end: '#663300', width: 40, beatsPerCycle: 2 },
  { pattern: 'burst', label: 'Explosion violette', start: '#aa44ff', end: '#000000', width: 35, beatsPerCycle: 8 },
  { pattern: 'gradient', label: 'Dégradé chaud', start: '#ff0000', end: '#ffff00', width: 100, beatsPerCycle: 0 },
  { pattern: 'gradient', label: 'Dégradé froid', start: '#0000ff', end: '#00ffff', width: 100, beatsPerCycle: 0 },
  { pattern: 'gradient', label: 'Dégradé nuit', start: '#4000ff', end: '#ff00aa', width: 100, beatsPerCycle: 0 },
  { pattern: 'gradient', label: 'Dégradé blanc→rose', start: '#ffffff', end: '#ff0066', width: 100, beatsPerCycle: 0 },
  { pattern: 'rainbow', label: 'Arc-en-ciel', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 8 },
  { pattern: 'rainbow', label: 'Arc-en-ciel rapide', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 3 },
  { pattern: 'rainbow', label: 'Arc-en-ciel lent', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 16 },
  { pattern: 'random', label: 'Éclats aléatoires', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 4 },
  { pattern: 'random', label: 'Éclats rapide', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 2 },
  { pattern: 'pulse', label: 'Pouls blanc', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 4 },
  { pattern: 'pulse', label: 'Pouls bleu', start: '#0066ff', end: '#0066ff', width: 100, beatsPerCycle: 4 },
  { pattern: 'pulse', label: 'Pouls rouge', start: '#ff2200', end: '#ff2200', width: 100, beatsPerCycle: 2 },
  { pattern: 'strobe', label: 'Strobe blanc', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 4 },
  { pattern: 'strobe', label: 'Strobe cyan', start: '#00e5ff', end: '#00e5ff', width: 100, beatsPerCycle: 4 },
  { pattern: 'solid', label: 'Aplat blanc', start: '#ffffff', end: '#ffffff', width: 100, beatsPerCycle: 0 },
];

// ─── Utilitaires de construction de loop ────────────────────────────────────

interface LoopMeta {
  id: string;
  label: string;
  theme: BankThemeId;
  swatch?: string;
  bars: number;
  category: FixtureCategory;
}

/**
 * Fenêtre (en beats) du raccord de fin de boucle : la dernière valeur est
 * ramenée à la valeur initiale sur au plus `CLOSE_MAX` beats, avec un clé de
 * maintien si la dernière clé est plus ancienne — sans quoi chaque loop
 * sauterait à sa bouclage (mouvement non périodique, chase, roue…).
 */
const CLOSE_MAX = 2;

/** Ajoute à chaque canal une clé de raccord à `lengthBeats` (valeur initiale). */
function closeLoop(kb: KeyBuilder, lengthBeats: number): void {
  const byChannel = new Map<string, ChannelKey[]>();
  for (const key of kb.keys) {
    const arr = byChannel.get(key.channel);
    if (arr) arr.push(key);
    else byChannel.set(key.channel, [key]);
  }
  for (const [channel, keys] of byChannel) {
    keys.sort((a, b) => a.beat - b.beat);
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (last.beat >= lengthBeats) continue;
    if (last.value === first.value) continue; // déjà raccord
    const addr = parseInt(channel, 10);
    if (Number.isNaN(addr)) continue;
    const span = lengthBeats - last.beat;
    if (span > CLOSE_MAX) kb.setForced(addr, lengthBeats - CLOSE_MAX, last.value, 0);
    kb.setForced(addr, lengthBeats, first.value, Math.min(span, CLOSE_MAX));
  }
}

function makeLoop(meta: LoopMeta, kb: KeyBuilder): AutoloopTimeline {
  closeLoop(kb, meta.bars * BEATS_PER_BAR);
  return {
    id: meta.id,
    label: meta.label,
    theme: meta.theme,
    swatch: meta.swatch,
    bars: meta.bars,
    category: meta.category,
    keys: kb.keys,
    positionCue: null,
  };
}

/** Catégorie dominante d'un jeu de fixtures (libellé affiché par l'UI). */
function dominantCategory(fixtures: AutoloopFixture[]): FixtureCategory {
  const counts = new Map<FixtureCategory, number>();
  for (const f of fixtures) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  let best: FixtureCategory = fixtures[0]?.category ?? 'Spot';
  let bestCount = -1;
  for (const [cat, n] of counts) {
    if (n > bestCount) {
      best = cat;
      bestCount = n;
    }
  }
  return best;
}

/** Remplit `target` avec exactement `PER_BANK` loops (clone si variante). */
function padToBank(target: AutoloopTimeline[], factory: () => AutoloopTimeline): void {
  let i = 0;
  while (target.length < PER_BANK) {
    const base = factory();
    target.push({ ...base, id: `${base.id}-v${i++}`, keys: [...base.keys] });
  }
  if (target.length > PER_BANK) target.length = PER_BANK;
}

// ─── Banque 0 · Couleurs ────────────────────────────────────────────────────

function buildColorBank(fixtures: AutoloopFixture[], category: FixtureCategory): AutoloopTimeline[] {
  const out: AutoloopTimeline[] = [];
  THEME_COLORS.forEach((color, i) => {
    const kb = new KeyBuilder();
    const rgb = hexToRgb(color.hex);
    for (const fx of fixtures) {
      putBase(kb, fx);
      putColor(kb, fx, color.hex, rgb);
    }
    out.push(
      makeLoop(
        { id: `theme-couleurs-${i + 1}`, label: loopColorLabel(color.hex, color.label), theme: 'couleurs', swatch: color.hex, bars: DEFAULT_BARS, category },
        kb,
      ),
    );
  });
  return out; // exactement 32
}

// ─── Banque 1 · Effets ──────────────────────────────────────────────────────

function buildEffectBank(fixtures: AutoloopFixture[], category: FixtureCategory): AutoloopTimeline[] {
  const out: AutoloopTimeline[] = [];
  const has = (logical: string) => fixtures.some((fx) => fx.channelMap[logical] !== undefined);
  const hasAxis = fixtures.some((fx) => axesOf(fx, 'pan').length > 0 || axesOf(fx, 'tilt').length > 0);
  const length = DEFAULT_BEATS;

  const push = (label: string, swatch: string | undefined, build: (kb: KeyBuilder) => void) => {
    if (out.length >= PER_BANK) return;
    const kb = new KeyBuilder();
    for (const fx of fixtures) putBase(kb, fx);
    build(kb);
    out.push(
      makeLoop({ id: `theme-effets-${out.length + 1}`, label, theme: 'effets', swatch, bars: DEFAULT_BARS, category }, kb),
    );
  };

  // 1. Mouvements (patterns effect-engine) — 21 slots.
  if (hasAxis) {
    const radii = [96, 74, 112];
    const cycles = [4, 8, 2];
    MOVE_PATTERNS.forEach((mv, i) => {
      push(loopMovementLabel(mv.pattern, mv.label), undefined, (kb) => {
        for (const fx of fixtures) {
          putMovement(kb, fx, mv.pattern, length, radii[i % radii.length], cycles[i % cycles.length]);
        }
      });
    });
  }

  // 2. Lumière : strobe + respiration.
  push(loopWord('tmplStrobeSlow', 'Strobe lent'), undefined, (kb) => {
    for (const fx of fixtures) putStrobe(kb, fx, length, 1);
  });
  push(loopWord('tmplStrobeFast', 'Strobe rapide'), undefined, (kb) => {
    for (const fx of fixtures) putStrobe(kb, fx, length, 0.5);
  });
  push(loopWord('tmplBreathSlow', 'Respiration lente'), undefined, (kb) => {
    for (const fx of fixtures) putDimmerPulse(kb, fx, length, 8);
  });
  push(loopWord('tmplBreathFast', 'Respiration rapide'), undefined, (kb) => {
    for (const fx of fixtures) putDimmerPulse(kb, fx, length, 2);
  });

  // 3. Roue couleur / gobo / prisme / beam — seulement si détectés.
  if (has('wheel')) {
    push(loopWord('tmplWheel', 'Roue couleur'), undefined, (kb) => {
      for (const fx of fixtures) putWheelSweep(kb, fx, length);
    });
    push(loopWord('tmplWheelGrad', 'Roue → dégradé'), undefined, (kb) => {
      for (const fx of fixtures) putWheelSweep(kb, fx, Math.round(length / 2));
    });
  }
  if (has('gobo')) {
    push(loopWord('tmplGobo', 'Gobo'), undefined, (kb) => {
      for (const fx of fixtures) putGobo(kb, fx, length);
    });
    push(loopWord('tmplGoboFast', 'Gobo rapide'), undefined, (kb) => {
      for (const fx of fixtures) putGobo(kb, fx, Math.round(length / 2));
    });
  }
  if (has('prism')) {
    push(loopWord('tmplPrism', 'Prisme'), undefined, (kb) => {
      for (const fx of fixtures) putPrism(kb, fx, length);
    });
  }
  const beamSwings: Array<['zoom' | 'frost' | 'iris' | 'focus', string, number, number]> = [
    ['zoom', loopWord('tmplBeamZoom', 'Zoom large/étroit'), 24, 200],
    ['iris', loopWord('tmplBeamIris', 'Iris ouvre/ferme'), 48, 220],
    ['frost', loopWord('tmplBeamFrost', 'Frost doux/plein'), 0, 180],
    ['focus', loopWord('tmplBeamFocus', 'Focus proche/lointain'), 48, 208],
  ];
  for (const [channel, label, lo, hi] of beamSwings) {
    if (!has(channel)) continue;
    push(label, undefined, (kb) => {
      for (const fx of fixtures) putBeamSwing(kb, fx, channel, length, lo, hi);
    });
  }
  if (fixtures.some((fx) => fx.isLaser)) {
    push(loopWord('tmplLaserScan', 'Laser — balayage'), undefined, (kb) => {
      for (const fx of fixtures) putLaserScanSpeed(kb, fx, length);
    });
    push(loopWord('tmplLaserPattern', 'Laser — motif'), undefined, (kb) => {
      const pattern = (fx: AutoloopFixture) => off(fx, 'pattern');
      for (const fx of fixtures) {
        const addr = pattern(fx);
        if (addr === null) continue;
        const caps = capsOf(fx, 'pattern');
        if (caps.length < 2) continue;
        const step = Math.max(2, Math.round(length / Math.min(caps.length, 6)));
        for (let beat = 0, i = 0; beat < length; beat += step, i++) {
          kb.set(addr, beat, capMid(caps[i % caps.length]), beat === 0 ? 0 : step);
        }
      }
    });
  }

  // 4. Complément : on garantit 32 slots avec des variantes (aucun bouton vide).
  let variant = 0;
  while (out.length < PER_BANK) {
    const v = variant++;
    const kb = new KeyBuilder();
    let label: string;
    let swatch: string | undefined;

    if (hasAxis) {
      const mv = MOVE_PATTERNS[v % MOVE_PATTERNS.length];
      const radius = 60 + ((v * 17) % 61); // 60..120
      const cycles = [4, 6, 8, 2, 10][v % 5];
      const color = THEME_COLORS[v % THEME_COLORS.length];
      label = loopWord('tmplMoveRadiusColor', `${mv.label} ${radius} · ${color.label}`)
        .replace('{move}', loopMovementLabel(mv.pattern, mv.label))
        .replace('{radius}', String(radius))
        .replace('{color}', loopColorLabel(color.hex, color.label));
      swatch = color.hex;
      // Base lumière OBLIGATOIRE : un mouvement seul (pan/tilt sans dimmer
      // ni couleur) joue dans le noir — tuile « qui ne déclenche rien ».
      for (const fx of fixtures) {
        putBase(kb, fx);
        putMovement(kb, fx, mv.pattern, length, radius, cycles);
        putColor(kb, fx, color.hex, hexToRgb(color.hex));
      }
    } else {
      // Aucun axe : on varie la respiration + une couleur (slot toujours utile).
      const period = 2 + (v % 6);
      const color = THEME_COLORS[v % THEME_COLORS.length];
      label = loopWord('tmplBreathPeriod', `Respiration ${period}b · ${color.label}`)
        .replace('{period}', String(period))
        .replace('{color}', loopColorLabel(color.hex, color.label));
      swatch = color.hex;
      for (const fx of fixtures) {
        putBase(kb, fx);
        putDimmerPulse(kb, fx, length, period);
        putColor(kb, fx, color.hex, hexToRgb(color.hex));
      }
    }

    if (kb.keys.length === 0) {
      // Rien d'exploitable : couleur pleine (garantie d'un slot non vide).
      const color = THEME_COLORS[v % THEME_COLORS.length];
      label = loopColorLabel(color.hex, color.label);
      swatch = color.hex;
      for (const fx of fixtures) {
        putBase(kb, fx);
        putColor(kb, fx, color.hex, hexToRgb(color.hex));
      }
    }

    out.push(
      makeLoop({ id: `theme-effets-${out.length + 1}`, label, theme: 'effets', swatch, bars: DEFAULT_BARS, category }, kb),
    );
  }
  return out;
}

// ─── Banque 2 · Matrice RGB ─────────────────────────────────────────────────

function gridOf(count: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

function buildMatrixBank(fixtures: AutoloopFixture[], category: FixtureCategory): AutoloopTimeline[] {
  const out: AutoloopTimeline[] = [];
  const { cols, rows } = gridOf(fixtures.length);
  const length = DEFAULT_BEATS;

  MATRIX_RECIPES.forEach((recipe, i) => {
    const kb = new KeyBuilder();
    const startRgb = hexToRgb(recipe.start);
    const endRgb = hexToRgb(recipe.end);
    const staticPattern = recipe.beatsPerCycle <= 0;
    const beatStep = staticPattern ? length : 1;

    for (const fx of fixtures) putBase(kb, fx);

    fixtures.forEach((fx, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      for (let beat = 0; beat < length; beat += beatStep) {
        const phase = recipe.beatsPerCycle > 0 ? beat / recipe.beatsPerCycle : 0;
        const [r, g, b] = getPatternColor(
          recipe.pattern, col, row, cols, rows, phase, startRgb, endRgb, recipe.width,
        );
        const ramp = beat === 0 ? 0 : 1;
        const rgb: [number, number, number] = [r, g, b];
        const red = off(fx, 'red');
        const green = off(fx, 'green');
        const blue = off(fx, 'blue');
        if (red !== null && green !== null && blue !== null) {
          kb.set(red, beat, r, ramp);
          kb.set(green, beat, g, ramp);
          kb.set(blue, beat, b, ramp);
          const white = off(fx, 'white');
          if (white !== null) kb.set(white, beat, isNearWhite(rgb) ? 255 : 0, ramp);
        } else {
          const hex = '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
          putColor(kb, fx, hex, rgb, beat);
        }
      }
    });

    out.push(
      makeLoop(
        { id: `theme-matrice-${i + 1}`, label: loopMatrixLabel(recipe.label), theme: 'matrice', swatch: recipe.start, bars: DEFAULT_BARS, category },
        kb,
      ),
    );
  });
  return out; // exactement 32
}

// ─── Banque 3 · Mix ─────────────────────────────────────────────────────────

function buildMixBank(fixtures: AutoloopFixture[], category: FixtureCategory): AutoloopTimeline[] {
  const out: AutoloopTimeline[] = [];
  const length = DEFAULT_BEATS;

  for (let i = 0; i < PER_BANK; i++) {
    const color = THEME_COLORS[i % THEME_COLORS.length];
    const mv = MOVE_PATTERNS[i % MOVE_PATTERNS.length];
    const variant = Math.floor(i / THEME_COLORS.length) % 8;
    const rgb = hexToRgb(color.hex);

    const kb = new KeyBuilder();
    for (const fx of fixtures) {
      putBase(kb, fx, { shutter: variant !== 6 });
      putColor(kb, fx, color.hex, rgb);
      putMovement(kb, fx, mv.pattern, length, [96, 76, 112][i % 3], [4, 8, 6, 2][i % 4]);
      if (variant === 4) putStrobe(kb, fx, length, 1);
      if (variant === 5) putDimmerPulse(kb, fx, length, 4);
      if (variant === 6) putStrobe(kb, fx, length, 0.5);
      if (variant === 7) putWheelSweep(kb, fx, length);
    }

    const suffix =
      variant === 4 ? loopWord('tmplMixSuffixStrobe', ' · Strobe') :
      variant === 5 ? loopWord('tmplMixSuffixBreath', ' · Respiration') :
      variant === 6 ? loopWord('tmplMixSuffixStrobeFast', ' · Strobe rapide') :
      variant === 7 ? loopWord('tmplMixSuffixWheel', ' · Roue') : '';

    out.push(
      makeLoop(
        {
          id: `theme-mix-${i + 1}`,
          label: `${loopColorLabel(color.hex, color.label)} · ${loopMovementLabel(mv.pattern, mv.label)}${suffix}`,
          theme: 'mix',
          swatch: color.hex,
          bars: DEFAULT_BARS,
          category,
        },
        kb,
      ),
    );
  }
  return out;
}

// ─── API publique ───────────────────────────────────────────────────────────

/**
 * Construit le `BankManager` 4×32 thématique :
 * banque 0 = Couleurs, 1 = Effets, 2 = Matrice RGB, 3 = Mix.
 *
 * Tous les 128 slots sont remplis dès qu'une fixture est patchée (variantes de
 * secours si une banque n'a pas assez de recettes applicables).
 */
export function buildThemedBanks(fixtures: AutoloopFixture[]): BankManager {
  const banks = new BankManager();
  if (fixtures.length === 0) return banks;
  const category = dominantCategory(fixtures);

  const builders = [buildColorBank, buildEffectBank, buildMatrixBank, buildMixBank];
  for (let bank = 0; bank < BANKS; bank++) {
    const loops = builders[bank](fixtures, category);
    padToBank(loops, () =>
      makeLoop(
        { id: `theme-${BANK_THEMES[bank].id}-fallback`, label: loopWord('tmplNoChannel', 'Aucun canal'), theme: BANK_THEMES[bank].id, bars: DEFAULT_BARS, category },
        new KeyBuilder(),
      ),
    );
    banks.populate(bank, loops);
  }
  return banks;
}
