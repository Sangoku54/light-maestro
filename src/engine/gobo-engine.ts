/**
 * gobo-engine — exploitation intelligente des roues de gobos.
 *
 * Problème : les générateurs historiques faisaient cycler la roue à chaque
 * beat / chaque frame (rotation continue, slot "micro-changer d'auto"), ce qui
 * produit un défilé permanent de motifs → visuellement "nauséeux" (surtout sur
 * les fixtures dont un slot macro fait tourner la roue en interne).
 *
 * Ce module remplace ce cyclage par une régie déterministe et stateless
 * (temps == état, donc aucune dérive entre les appels 60 fps, le crossfade et
 * la génération de cues) :
 *
 *   1. CLASSIFICATION des slots par nom (générique, marche pour toute def
 *      QLC+/OFL) :
 *        - 'open'    : pas de gobo (Open / Clear / White / Blank…)
 *        - 'static'  : un motif fixe (Gobo 1, étoiles, barreaux…)
 *        - 'animate' : slots qui bougent par eux-mêmes (AUTO, SPIN, ROTATE,
 *                      SHAKE, DITHER, CHANGE, SCROLL…) → potentiellement
 *                      épuisants / non pilotables précisément.
 *
 *   2. RÉGIE TEMPO par blocs de 2 mesures : un bloc "AVEC gobo" suit un bloc
 *      "REPOS" (déterministe, part d'activité dosée par l'énergie de section).
 *
 *   3. PENDANT LE REPOS : la roue est posée sur un slot de repos constant
 *      (slot Open si la def en a un, sinon premier slot statique) → vraie
 *      respiration, jamais de défilement.
 *
 *   4. PENDANT L'ACTIVITÉ : changement AU PLUS une fois par mesure (tenue ≥ 1
 *      mesure = le motif se pose), prédominance des motifs STATIQUES,
 *      "sortie de gobo" ponctuelle vers l'open, et slots ANIMATE réservés aux
 *      moments de forte énergie (drop/chorus) et de façon RARE.
 *
 * Tout est déterministe (seed + time) : le même morceau rejoue la même
 * chorégraphie gobo à chaque passage, et elle se reproduit identiquement sur
 * chaque unité d'une même fixture (seed ≠ par adresse pour varier les units).
 */
import type { DmxFixtureCapability } from '../hooks/dmx-cues';

export type GoboClass = 'open' | 'static' | 'animate';

export interface GoboComputeOpts {
  /** BPM du morceau (défaut 120). */
  bpm?: number;
  /** Énergie de section 0..1 (défaut 0.5) : dose la part d'activité gobo. */
  energy?: number;
  /** Seed de variabilité (mettre une valeur ≠ par fixture/adresse). */
  seed?: number;
}

/** Classification de slot gobo par nom (générique, sans cas par fixture). */
export function classifyGoboCap(cap: DmxFixtureCapability): GoboClass {
  const n = (cap.name ?? '').toLowerCase();
  if (/open|clear|white|blank|no gobo|no.?pattern|none|off/i.test(n)) return 'open';
  if (/auto|spin|rotate|shake|dither|change|scroll|movement|macro|index|bounce|wave|chase|rainbow|gobo ?2/i.test(n)) return 'animate';
  return 'static';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Hachage déterministe seed+mix → réel pseudo-aléatoire stable dans [0,1). */
function hash01(seed: number, mix: number): number {
  let h = (seed | 0) ^ (mix | 0);
  h = (h ^ (h >>> 16)) * 0x45d9f3b;
  h = (h ^ (h >>> 16)) * 0x45d9f3b;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function capMid(cap: DmxFixtureCapability): number {
  return Math.round((cap.min + cap.max) / 2);
}

/** Slot de repos : premier open, sinon premier statique, sinon premier
 *  slot non-animé (jamais un slot animé). */
function pickupHome(caps: DmxFixtureCapability[], open: DmxFixtureCapability[], stat: DmxFixtureCapability[]): DmxFixtureCapability {
  if (open.length > 0) return open[0];
  if (stat.length > 0) return stat[0];
  return caps.find((c) => classifyGoboCap(c) !== 'animate') ?? caps[0];
}

export function computeGoboValue(
  goboCaps: DmxFixtureCapability[],
  timeSec: number,
  opts?: GoboComputeOpts,
): number {
  if (!goboCaps || goboCaps.length === 0) return 0;
  const bpm = opts?.bpm ?? 120;
  const energy = clamp01(opts?.energy ?? 0.5);
  const seed = opts?.seed ?? 1;

  const open = goboCaps.filter((c) => classifyGoboCap(c) === 'open');
  const stat = goboCaps.filter((c) => classifyGoboCap(c) === 'static');
  const animate = goboCaps.filter((c) => classifyGoboCap(c) === 'animate');
  const home = pickupHome(goboCaps, open, stat);

  // Temps en beats, puis mesures (4 temps) et blocs de 2 mesures.
  const beat = Math.max(0, timeSec * bpm / 60);
  const bar = Math.floor(beat / 4);
  const block = Math.floor(bar / 2);

  // ── REPOS : les 2 mesures du bloc sont posées sur le slot home → respiration.
  const activeShare = 0.28 + 0.38 * energy; // 0.28 (calme) → 0.66 (drop)
  if (hash01(seed, block * 0x9e3779b1) >= activeShare) {
    return capMid(home);
  }

  // ── ACTIVITÉ : un seul changement par mesure (tenue ≥ 1 mesure).
  const r = hash01(seed, bar * 0x45d9f3b + 7);
  const animShare = animate.length > 0 ? 0.04 + 0.24 * energy : 0; // rare → post-drop
  const openShare = open.length > 0 ? 0.16 - 0.10 * energy : 0;    // brève sortie de gobo

  if (r < animShare) {
    const k = Math.floor(hash01(seed, bar * 0x5bd1e995 + 13) * animate.length) % animate.length;
    return capMid(animate[k]);
  }
  if (r < animShare + openShare) {
    return capMid(open[0]);
  }
  if (stat.length > 0) {
    const k = Math.floor(hash01(seed, bar * 0x27d4eb2f + 3) * stat.length) % stat.length;
    return capMid(stat[k]);
  }
  // Pas de slot statique : on reste sur le home (pas de défilement).
  return capMid(home);
}