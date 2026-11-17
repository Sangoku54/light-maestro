/**
 * autoscript-envelopes — enveloppes CONTINUES du show auto (vitesse + dimmer).
 *
 * Le moteur historique ne connaissait que deux grandeurs :
 *
 *  - une vitesse FIGÉE par type de section (`SECTION_BEATS_PER_CYCLE`) :
 *    le drop faisait 2 tours/seconde à 120 BPM, quelle que soit l'énergie
 *    du morceau ;
 *  - une intensité QUANTIFIÉE en 5 paliers (`very-low`…`very-high`) : le
 *    dimmer montait en escalier et tenait par paliers jusqu'à la cue
 *    suivante.
 *
 * D'où le constat « les mouvements sont toujours rapides, sans nuance de
 * rapidité ni de dimmer ».
 *
 * Ce module porte les deux enveloppes audio CONTINUES calculées par le
 * générateur (`genCues`) et consommées par le moteur de rejeu :
 *
 *  - `speed`  : multiplicateurs de vitesse de mouvement (moyenne 1). La
 *                boucle ACCÉLÈRE sur les pics et RALENTIT dans les passages
 *                creux, tout en bouclant proprement sur la section (cycles
 *                entiers → fin de section alignée sur le tempo).
 *  - `dimmer` : niveau 0..1 échantillonné en continu. Le dimmer SUIT
 *                l'enveloppe RMS, RESPIRE au tempo et s'ACCENTUE sur les
 *                beats forts (pompe).
 *
 * Stockage : registre module-level indexé par le début de section — même
 * mécanique que `setSectionChain` (autoscript-loops). Les enveloppes sont
 * OPTIONNELLES : sans enveloppe, le moteur garde son comportement historique
 * (anciens presets, cues manuels, shows sans analyse audio).
 */

/** Enveloppe d'une section : mouvement (speed) et dimmer (level). */
export interface SectionEnvelope {
  /** Multiplicateurs de vitesse de mouvement (moyenne ≈ 1). */
  speed: number[];
  /** Niveau de dimmer continu 0..1 (déjà plancheré). */
  dimmer: number[];
}

/**
 * Registre des enveloppes, indexé par un identifiant UNIQUE.
 *
 * L'identifiant est porté par les cues (`envId`) : deux shows peuvent
 * coexister dans l'application (QuickShow + lecteur de preset) et chacun
 * garde SES enveloppes, même si leurs sections commencent aux mêmes
 * temps. Un registre indexé par `sectionStart` confondrait les deux.
 */
const registry = new Map<number, SectionEnvelope>();
let nextEnvelopeId = 1;
/** Ordre d'insertion : permet de purger les enveloppes abandonnées. */
const insertionOrder: number[] = [];
/** Plafond mémoire (≈ 16 shows conservés). */
const MAX_ENVELOPES = 96;

/**
 * Enregistre les enveloppes d'un show et retourne les identifiants
 * attribués (à porter par les cues de chaque section).
 *
 * Le registre N'EST PAS purgé ici : deux shows peuvent coexister
 * (QuickShow + lecteur de preset) et chacun garde SES enveloppes, même si
 * leurs sections commencent aux mêmes temps. Les plus anciennes sont
 * évacuées au-delà du plafond.
 */
export function setSectionEnvelopes(
  list: SectionEnvelope[] | null | undefined,
): number[] {
  if (!list || list.length === 0) return [];
  const ids = list.map((env) => {
    const id = nextEnvelopeId++;
    registry.set(id, env);
    insertionOrder.push(id);
    return id;
  });
  while (insertionOrder.length > MAX_ENVELOPES) {
    const old = insertionOrder.shift();
    if (old !== undefined) registry.delete(old);
  }
  return ids;
}

/** Vide le registre (tests, changement de show). */
export function clearSectionEnvelopes(): void {
  registry.clear();
  insertionOrder.length = 0;
}

/** Enveloppe d'une section (null si aucune — replay historique). */
export function getSectionEnvelope(id: number | undefined | null): SectionEnvelope | null {
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  return registry.get(id) ?? null;
}

/**
 * Échantillonnage linéaire d'une courbe sur l'intervalle [start, end].
 * Retourne NaN si la courbe est absente (l'appelant garde son calcul).
 */
export function sampleCurve(
  curve: number[] | undefined | null,
  start: number,
  end: number,
  time: number,
): number {
  if (!curve || curve.length === 0) return NaN;
  if (curve.length === 1) return curve[0];
  const dur = end - start;
  let p = dur > 0 ? (time - start) / dur : 0;
  if (!(p >= 0)) p = 0;
  else if (p > 1) p = 1;
  const x = p * (curve.length - 1);
  const i = Math.floor(x);
  const j = Math.min(curve.length - 1, i + 1);
  const f = x - i;
  return curve[i] + (curve[j] - curve[i]) * f;
}

// ─── Construction des enveloppes ────────────────────────────────

/** Source audio exploitable (sous-ensemble de `TrackAnalysis`). */
export interface EnvelopeAudioSource {
  duration: number;
  rmsCurve?: number[] | null;
  energyCurve?: number[] | null;
  onsetCurve?: number[] | null;
  lowCurve?: number[] | null;
  beats?: number[] | null;
  beatStrengths?: string[] | null;
}

export interface EnvelopeBuildOptions {
  sectionType: string;
  start: number;
  end: number;
  bpm: number;
  /** Bande d'intensité de la section : [plancher, plafond] en 0..1. */
  band: [number, number];
  /** Niveau de la fin de la section précédente (raccord d'entrée). */
  startLevel?: number;
  /** Plancher absolu 0..1 (plancher de section DMX). */
  floor?: number;
  /** Densité d'échantillonnage (échantillons par seconde). */
  samplesPerSecond?: number;
}

/**
 * Profondeur de respiration du dimmer, par type de section.
 * Les sections calmes respirent large et lent, les sections denses
 * respirent court (pompe) — comme sur un pupitre professionnel.
 */
const BREATH_DEPTH: Record<string, number> = {
  intro: 0.24, verse: 0.18, bridge: 0.26, chorus: 0.13, build: 0.11, drop: 0.09, outro: 0.26,
};

/** Période de la respiration, en beats. */
const BREATH_BEATS: Record<string, number> = {
  intro: 8, verse: 4, bridge: 8, chorus: 4, build: 4, drop: 2, outro: 8,
};

/** Profondeur de l'accent sur les beats forts / onsets. */
const ACCENT_DEPTH: Record<string, number> = {
  intro: 0.03, verse: 0.07, bridge: 0.05, chorus: 0.11, build: 0.10, drop: 0.13, outro: 0.02,
};

/** Bornes du multiplicateur de vitesse de mouvement. */
const SPEED_MIN = 0.45;
const SPEED_MAX = 1.9;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Moyenne glissante (rayon en échantillons) : lisse les à-coups audio. */
function smoothCurve(curve: number[], radius: number): number[] {
  if (curve.length <= 2 || radius <= 0) return curve.slice();
  const out = new Array<number>(curve.length);
  for (let i = 0; i < curve.length; i++) {
    let sum = 0;
    let count = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      if (k < 0 || k >= curve.length) continue;
      sum += curve[k];
      count++;
    }
    out[i] = count > 0 ? sum / count : curve[i];
  }
  return out;
}

/** Médiane d'une liste de nombres. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Construit les enveloppes continues (vitesse + dimmer) d'une section.
 *
 * La vitesse est normalisée à 1 en moyenne → le nombre de cycles de la
 * section ne change pas, seule la RÉPARTITION de la vitesse change (le
 * mouvement accélère sur les pics, ralentit dans les creux).
 */
export function buildSectionEnvelope(
  src: EnvelopeAudioSource,
  opts: EnvelopeBuildOptions,
): SectionEnvelope {
  const start = opts.start;
  const end = opts.end;
  const dur = Math.max(0.001, end - start);
  const sps = opts.samplesPerSecond ?? 8;
  const n = Math.max(16, Math.min(512, Math.round(dur * sps)));
  const bpm = Math.max(40, opts.bpm || 120);
  const beatDur = 60 / bpm;

  const curveLen = src.rmsCurve?.length ?? 0;
  const idxAt = (t: number, len: number): number => {
    if (!len || !src.duration) return -1;
    return Math.min(len - 1, Math.max(0, Math.floor((t / src.duration) * len)));
  };
  const rmsAt = (t: number): number => {
    const i = idxAt(t, curveLen);
    return i < 0 ? 0.5 : (src.rmsCurve![i] ?? 0.5);
  };
  const onsetAt = (t: number): number => {
    const len = src.onsetCurve?.length ?? 0;
    const i = idxAt(t, len);
    return i < 0 ? 0 : (src.onsetCurve![i] ?? 0);
  };

  // ── Échantillonnage local de la section ───────────────────────
  const times: number[] = [];
  const rms: number[] = [];
  const onset: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + (i / (n - 1)) * dur;
    times.push(t);
    rms.push(rmsAt(t));
    onset.push(onsetAt(t));
  }

  // Normalisation LOCALE : 0 = creux de la section, 1 = pic de la section.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of rms) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  const norm = (v: number): number => (span > 1e-6 ? (v - lo) / span : 0.5);

  // ── VITESSE ───────────────────────────────────────────────────
  const rawSpeed: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = norm(rms[i]);
    const on = clamp01(onset[i]);
    rawSpeed.push(0.78 + 0.42 * e + 0.16 * on);
  }
  const speed = smoothCurve(rawSpeed, 2);
  let sum = 0;
  for (const v of speed) sum += v;
  const mean = sum / Math.max(1, speed.length);
  for (let i = 0; i < speed.length; i++) {
    speed[i] = Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed[i] / (mean || 1)));
  }

  // ── DIMMER ───────────────────────────────────────────────────
  const [bandLo, bandHi] = opts.band;
  // Le nominal se place dans le HAUT de la bande (le show garde son
  // énergie) mais laisse de la place à la respiration et aux accents.
  const base = bandLo + (bandHi - bandLo) * 0.62;
  const breathDepth = BREATH_DEPTH[opts.sectionType] ?? 0.18;
  const breathPeriod = (BREATH_BEATS[opts.sectionType] ?? 4) * beatDur;
  const accentDepth = ACCENT_DEPTH[opts.sectionType] ?? 0.07;

  // Accent : pic décroissant après chaque beat (fort = 1, faible = 0,35).
  const accent = new Array<number>(n).fill(0);
  const beats = src.beats ?? [];
  for (let bi = 0; bi < beats.length; bi++) {
    const bt = beats[bi];
    if (bt < start - beatDur || bt > end) continue;
    const strength = src.beatStrengths?.[bi] === 'strong' ? 1 : 0.35;
    for (let i = 0; i < n; i++) {
      const dt = times[i] - bt;
      if (dt < 0 || dt > beatDur * 1.2) continue;
      const v = strength * Math.exp(-dt / (beatDur * 0.35));
      if (v > accent[i]) accent[i] = v;
    }
  }

  const dimmer: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = norm(rms[i]);
    const follow = 0.62 + 0.38 * e;                    // suit l'enveloppe RMS
    const breathPhase = (times[i] / Math.max(0.01, breathPeriod)) * Math.PI * 2;
    const breath = 1 - breathDepth + breathDepth * (0.5 + 0.5 * Math.sin(breathPhase));
    const acc = accent[i] * accentDepth + clamp01(onset[i]) * accentDepth * 0.5;
    dimmer.push(clamp01(base * follow * breath * (1 + acc)));
  }

  // Raccord d'entrée : on part du niveau de fin de la section précédente
  // (pas de snap à la frontière) — 2 temps locaux, comme le fondu
  // d'intensité historique.
  if (typeof opts.startLevel === 'number' && Number.isFinite(opts.startLevel)) {
    const rampSec = Math.min(2 * beatDur, dur * 0.5);
    for (let i = 0; i < n; i++) {
      const k = rampSec > 0 ? Math.min(1, (times[i] - start) / rampSec) : 1;
      dimmer[i] = clamp01(opts.startLevel + (dimmer[i] - opts.startLevel) * k);
    }
  }

  const floor = clamp01(opts.floor ?? 0.15);
  for (let i = 0; i < n; i++) dimmer[i] = Math.max(floor, dimmer[i]);

  return { speed, dimmer };
}
