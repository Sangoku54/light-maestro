// ─── Autoloop — Module 1 : modèle de données + maths ────────
//
// Port TypeScript pur (zéro dépendance React/Electron/`window`) du module
// `models.py` du prototype Python. Ce fichier EST le contrat figé : les
// modules `autoscript-generator.ts`, `autoloop-engine.ts` et `autoloop-banks.ts`
// importent leurs types d'ici.
//
// Un *Autoloop* est une timeline continue, alignée sur les bars
// (8/16/32/64/128 bars), remplie de keyframes posés sur le BeatGrid. Ce n'est
// PAS une liste de scenes : chaque clé décrit un état DMX (position, attribut)
// à un instant `beat` précis du loop.
//
// Ce module ne contient que des types et leurs mathématiques associées,
// plus le registre de libellés localisés ci-dessous (français par défaut,
// écrasé par le hook useLoopLocale — les tests gardent le français).

/** Libellés localisables des boucles générées (clés stables → texte). */
export interface LoopTextDict {
  kinds: Record<string, string>;
  words: Record<string, string>;
  /** hex couleur (minuscules) → nom. */
  colors: Record<string, string>;
  /** pattern de mouvement → nom. */
  movements: Record<string, string>;
  /** id de banque → { label, hint }. */
  themes: Record<string, { label: string; hint: string }>;
  /** libellé FR de recette matrice → libellé traduit. */
  matrix: Record<string, string>;
}

const _text: LoopTextDict = { kinds: {}, words: {}, colors: {}, movements: {}, themes: {}, matrix: {} };

/** Remplace (fusion) les libellés — appelé par useLoopLocale au changement de langue. */
export function setLoopLocaleText(partial: Partial<LoopTextDict>): void {
  for (const k of ['kinds', 'words', 'colors', 'movements', 'themes', 'matrix'] as const) {
    const part = (partial as Record<string, Record<string, unknown>>)[k];
    if (part) Object.assign(_text[k], part);
  }
}

/** Réinitialise les surcharges (français codé en dur). Test uniquement. */
export function resetLoopLocaleText(): void {
  _text.kinds = {};
  _text.words = {};
  _text.colors = {};
  _text.movements = {};
  _text.themes = {};
  _text.matrix = {};
}

/** Libellé de kind (boucle), repli = libellé français codé en dur. */
export function loopKindLabel(kind: string, fallback: string): string {
  return _text.kinds[kind] ?? fallback;
}

/** Mot de nommage (Chase, Strobe…), repli français. */
export function loopWord(key: string, fallback: string): string {
  return _text.words[key] ?? fallback;
}

/** Nom de couleur par hex, repli français. */
export function loopColorLabel(hex: string, fallback: string): string {
  return _text.colors[hex.toLowerCase()] ?? fallback;
}

/** Nom de mouvement par pattern, repli français. */
export function loopMovementLabel(pattern: string, fallback: string): string {
  return _text.movements[pattern] ?? fallback;
}

/** Libellé de recette matrice (repli = français codé en dur). */
export function loopMatrixLabel(french: string): string {
  return _text.matrix[french] ?? french;
}

/** Label/hint de banque thématique, null = garder les statiques. */
export function loopThemeText(id: string): { label: string; hint: string } | null {
  return (_text.themes[id] as { label: string; hint: string } | undefined) ?? null;
}

/** Nombre de beats par mesure (signature 4/4, hypothèse des boucles auto). */
export const BEATS_PER_BAR = 4;

import type { DmxFixtureCapability } from '../hooks/dmx-cues';

/** Mode de répétition d'un Autoloop. */
export type RepeatMode = 'infinite' | 'track_duration';

/**
 * Catégorie de fixtures ciblée par un Autoloop.
 *
  * Les boucles auto regroupent les fixtures en « Washes » (faisceaux larges) et
 * « Spots » (faisceaux serrés mobiles). Un Autoloop ne pilote qu'une
 * catégorie à la fois.
 *
 * Les valeurs littérales reprennent EXACTEMENT celles de l'enum Python
 * `FixtureCategory` (voir `models.py`) : `WASH_PRIMARY = "Wash_Primary"`,
 * `WASH_SECONDARY = "Wash_Secondary"`, `SPOT = "Spot"`. Ce sont des chaînes
 * PascalCase (et non snake_case) car elles apparaissent telles quelles dans
 * les identifiants générés (`autoscript-Wash_Primary-16b-1`) et dans toute
 * sérialisation croisée avec le prototype.
 */
export type FixtureCategory = 'Wash_Primary' | 'Wash_Secondary' | 'Spot';

/** Forme de mouvement disponible pour un cue de position. */
export type MovementShape = 'circle' | 'figure_eight';

/**
 * Description DMX statique d'une fixture physique.
 *
 * Une fixture est identifiée par un `id` unique, appartient à un univers DMX et
 * occupe une plage de canaux contiguë à partir de `address` (1-based, convention
 * DMX). Le `channelMap` fait correspondre un attribut logique (« pan », « tilt »,
 * « red », « dimmer »…) à un *offset* de canal relatif à `address` (0-based).
 */
export interface AutoloopFixture {
  id: string;
  category: FixtureCategory;
  /** Index d'univers (0-based) — informatif. */
  universe: number;
  /** Adresse DMX de base (1-based). */
  address: number;
  /** Attribut logique → offset de canal (0-based). */
  channelMap: Record<string, number>;
  /** Fixture détectée comme laser (routage/exploitation dédiés). */
  isLaser?: boolean;
  /** Centre pan DMX (128±offset) injecté par « Capturer » — déplace l'oscillation autour de la pose cible. */
  centerPanDmx?: number;
  /** Centre tilt DMX (128±offset) injecté par « Capturer » — déplace l'oscillation autour de la pose cible. */
  centerTiltDmx?: number;
  /**
   * Capacités DMX par canal logique (`wheel`, `gobo`, `prism`, `strobe`,
   * `pattern`, `laserMaster`, `laserColorGate`…), injecté par le runtime pour
   * une exploitation fine (couleur exacte sur la roue, gobo statique…).
   */
  capsByChannel?: Record<string, DmxFixtureCapability[]>;
  /**
   * Plage d'intensité d'un canal hybride « Dimmer/Strobe » — un dimmer écrit
   * 0..255 doit y être remappé pour rester en zone intensité.
   */
  dimmerRange?: { min: number; max: number } | null;
}

/**
 * Cue de *position* : décrit un mouvement continu pan/tilt dans le loop.
 *
 * Le mouvement est porté par trois paramètres :
 * - `speed` (omega, rad/beat) : vitesse angulaire. Sur 4 beats (1 bar), un
 *   omega de π/2 décrit un tour complet (2π rad sur 4 beats).
 * - `phase` (rad) : décalage de départ de la trajectoire.
 * - `radius` (0..128) : amplitude DMX autour du centre.
 */
export interface PositionCue {
  id: string;
  shape: MovementShape;
  /** Vitesse angulaire omega, en rad/beat. */
  speed: number;
  /** Phase initiale, en rad. */
  phase: number;
  /** Amplitude DMX autour du centre (0..128). */
  radius: number;
  /** Centre pan (défaut 128 = centre optique). */
  centerPan?: number;
  /** Centre tilt (défaut 128 = centre optique). */
  centerTilt?: number;
}

/**
 * Cue d'*attribut* : décrit un changement d'état non-positionnel.
 *
 * - `values` : mapping canal logique → valeur DMX cible (0..255). Un même
 *   attribut peut piloter plusieurs canaux (ex. couleur = red + green + blue).
 * - `rampBeats` : durée d'interpolation (beats) pour atteindre les cibles ;
 *   0 = application instantanée (snap).
 * - `interpolate` : si false, on applique en snap même si `rampBeats` est non nul.
 */
export interface AttributeCue {
  id: string;
  /** "color", "gobo", "focus", "zoom", … */
  attribute: string;
  /** Canal logique → valeur DMX cible (0..255). */
  values: Record<string, number>;
  /** Durée d'interpolation (beats) ; 0 = snap. */
  rampBeats?: number;
  /** Autorise l'interpolation de la rampe (défaut true). */
  interpolate?: boolean;
}

/**
 * Un *keyframe* DMX élémentaire : un canal à une valeur donnée, à un `beat`
 * précis du loop.
 *
 * - `channel` : par convention le générateur encode l'**adresse DMX absolue en
 *   chaîne** (ex. `"13"`) pour rendre la timeline auto-suffisante ; le moteur
 *   accepte aussi un nom logique si `channelMap` est fourni.
 * - `beat` : position dans le loop (en beats depuis le début, 0 = départ).
 * - `value` : DMX 0..255.
 * - `rampBeats` : durée d'interpolation depuis le keyframe précédent ; 0 = snap.
 */
export interface ChannelKey {
  channel: string;
  beat: number;
  value: number;
  rampBeats?: number;
}

/**
 * La timeline complète d'un Autoloop.
 *
 * - `bars` : longueur en bars (8/16/32/64/128). Longueur en beats = `bars * 4`.
 * - `keys` : liste ordonnée des keyframes DMX remplissant le loop.
 * - `positionCue` : mouvement pan/tilt optionnel appliqué en continu.
 */
export interface AutoloopTimeline {
  id: string;
  bars: number;
  category: FixtureCategory;
  keys: ChannelKey[];
  positionCue?: PositionCue | null;
  /**
   * Libellé lisible affiché dans l'UI (« Bleu », « Cercle 96 », …).
   * Optionnel : les loops historiques (`autoscript-…`) n'en ont pas.
   */
  label?: string;
  /** Banque thématique d'origine (`couleurs`/`effets`/`matrice`/`mix`). */
  theme?: string;
  /** Couleur d'accent `#rrggbb` pour l'UI (pastille du slot). */
  swatch?: string;
}

/**
 * Borne une valeur DMX dans l'intervalle [0, 255] puis l'arrondit.
 *
 * Ordre des opérations : on borne d'abord dans [0, 255], puis on arrondit. Borner
 * avant d'arrondir évite qu'un 255.6 ne devienne 256.
 */
export function clampDmx(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}

/**
 * Longueur totale du loop en beats : `bars * 4` (4 temps par bar en 4/4).
 */
export function timelineLengthBeats(timeline: AutoloopTimeline): number {
  return timeline.bars * BEATS_PER_BAR;
}

/**
 * Position pan (canal DMX 0..255) à un instant `beat`.
 *
 * Cercle : `pan = center + r·cos(ω·beat + φ)` — le cosinus est la projection
 * horizontale du point qui tourne sur le cercle unité.
 *
 * Huit (Lissajous 1:2) : `pan = center + r·sin(ω·beat + φ)` — le pan oscille à
 * la fréquence de base, le tilt à la fréquence double.
 */
export function computePan(cue: PositionCue, beat: number): number {
  const center = cue.centerPan ?? 128;
  if (cue.shape === 'circle') {
    return clampDmx(center + cue.radius * Math.cos(cue.speed * beat + cue.phase));
  }
  return clampDmx(center + cue.radius * Math.sin(cue.speed * beat + cue.phase));
}

/**
 * Position tilt (canal DMX 0..255) à un instant `beat`.
 *
 * Cercle : `tilt = center + r·sin(ω·beat + φ)` — déphasé de π/2 par rapport au
 * cosinus du pan, ce qui garantit un cercle et non une diagonale.
 *
 * Huit : `tilt = center + r·sin(2·ω·beat + φ)` — le tilt oscille à fréquence
 * DOUBLE de celle du pan, dessinant les deux boucles du huit.
 */
export function computeTilt(cue: PositionCue, beat: number): number {
  const center = cue.centerTilt ?? 128;
  if (cue.shape === 'circle') {
    return clampDmx(center + cue.radius * Math.sin(cue.speed * beat + cue.phase));
  }
  return clampDmx(center + cue.radius * Math.sin(2 * cue.speed * beat + cue.phase));
}
