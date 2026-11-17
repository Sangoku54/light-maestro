/**
 * autoscript-loops — boucles de mouvement section-aware pour l'autoscript.
 *
 * Le moteur historique évaluait un pattern(t) continu, décorrélé des beats :
 * tours non entiers par section, saccade aux frontières, amplitude écrasée
 * contre 0/255. Ici chaque section devient une VRAIE boucle :
 *
 *  1. cycles verrouillés sur les beats (durée × bpm ÷ beats/tour par section)
 *  2. échantillonnage anti-aliasé (≥ 8 points/tour, n borné à 128) lu par
 *     interpolation au tick → pas de coudes
 *  3. normalisation sur l'amplitude réelle du pattern (un 'static' à ±0.1
 *     occupe toute la course, un axe constant reste à 0)
 *  4. raccord de fin de section : la boucle démarre sur la dernière valeur de
 *     la précédente (fondu borné), donc plus de cassage à la frontière
 *  5. headroom : l'amplitude demandée est bornée à la course réelle du centre
 *     capturé → jamais de valeur plaquée sur une butée
 *
 * Sans bornes de section (anciens presets), `sectionMoveFor` renvoie null et
 * l'appelant garde son calcul analytique historique.
 */
import { evalEffect, type EffectPattern } from './effect-engine';
import { getSectionEnvelope } from './autoscript-envelopes';

/**
 * Beats nécessaires pour un tour complet, par type de section.
 *
 * Ces valeurs sont le TEMPO DE BASE du mouvement ; la nuance locale vient
 * de l'enveloppe audio (`autoscript-envelopes`) qui accélère ou ralentit
 * la phase à l'intérieur de la section.
 *
 * Avant : drop = 1 beat/tour → 2 tours/seconde à 120 BPM, chorus = 2 beats
 * → 1 tour/seconde. Le show « filait » en permanence, sans contraste.
 * Maintenant : le drop est le moment le plus rapide mais reste humain
 * (1 tour / 3 beats), le refrain tient 4 beats/tour, le couplet 6.
 */
export const SECTION_BEATS_PER_CYCLE: Record<string, number> = {
  intro: 8,
  outro: 8,
  verse: 6,
  bridge: 6,
  chorus: 4,
  build: 4,
  drop: 3,
};

/** Pattern de base appliqué quand la section n'a pas de movement explicite. */
export const SECTION_BASE_PATTERN: Record<string, EffectPattern> = {
  intro: 'wave',
  verse: 'sweep',
  bridge: 'figure8',
  chorus: 'circle',
  build: 'zigzag',
  drop: 'spiral',
  outro: 'static',
};

/** Limite haute du raccord (s) et part minimale de la section qu'il couvre. */
export const RAMP_MAX_SEC = 0.6;
export const RAMP_RATIO = 0.12;

/** Points utilisés pour mesurer l'amplitude réelle d'un pattern sur sa boucle. */
export const RANGE_SAMPLES = 64;

const MOVE_PATTERNS = new Set<string>([
  'circle', 'square', 'figure8', 'zigzag', 'sweep', 'wave', 'bounce', 'pulse',
  'static', 'spiral', 'heartbeat', 'randomWalk', 'panOnly', 'tiltOnly', 'diamond',
]);

export interface SectionLike {
  type?: string;
  startTime: number;
  endTime: number;
}

export interface SectionMoveLoop {
  key: string;
  pattern: EffectPattern;
  sectionType: string;
  start: number;
  end: number;
  cycles: number;
  samples: number;
  motors: number;
  /** Valeurs normalisées [-1,1] : index = motor * samples + i */
  pan: Float32Array;
  tilt: Float32Array;
  /** Phase cumulée de la boucle, en tours (diagnostic / tests). */
  warp: Float32Array;
  /** Part de la section couverte par le fondu depuis la fin de la précédente. */
  rampFrac: number;
  /** Boucle de la section précédente (null pour la première). */
  prev: SectionMoveLoop | null;
}

interface LoopCue {
  movement?: string;
  section?: string;
  sectionStart?: number;
  sectionEnd?: number;
  bpm?: number;
  /** Identifiant de l'enveloppe audio de la section (cf. autoscript-envelopes). */
  envId?: number;
}

let chain: SectionLike[] = [];
let chainMovements: Record<number, string> = {};
/** Identifiant d'enveloppe audio par section (cf. autoscript-envelopes). */
let chainEnvIds: Record<number, number> = {};
const cache = new Map<string, SectionMoveLoop>();

/**
 * Pose l'ordre des sections (+ movement de la 1ʳᵉ cue de chacune) et vide
 * le cache. `envIds` associe à chaque section son enveloppe audio.
 */
export function setSectionChain(
  sections: SectionLike[],
  movements?: Record<number, string>,
  envIds?: Record<number, number>,
): void {
  chain = (sections || []).slice().sort((a, b) => a.startTime - b.startTime);
  chainMovements = movements || {};
  chainEnvIds = envIds || {};
  cache.clear();
}

export function sectionChain(): SectionLike[] {
  return chain;
}

export function clearSectionLoopCache(): void {
  cache.clear();
}

/** Nom de mouvement → pattern utilisable par evalEffect (null = inconnu). */
export function resolveMovePattern(name?: string | null): EffectPattern | null {
  if (!name) return null;
  if (MOVE_PATTERNS.has(name)) return name as EffectPattern;
  const base = SECTION_BASE_PATTERN[name];
  return base ?? null;
}

/** Section qui se termine pile là où `start` commence (frontière exacte sinon plus proche). */
function prevSectionBefore(start: number): SectionLike | null {
  let best: SectionLike | null = null;
  let bestGap = Infinity;
  for (const s of chain) {
    if (s.endTime > start + 0.01) continue;
    const gap = Math.abs(s.endTime - start);
    if (gap < bestGap) { best = s; bestGap = gap; }
  }
  return best;
}

function sectionTypeOf(start: number, end: number): string | null {
  for (const s of chain) {
    if (Math.abs(s.startTime - start) < 0.01 && Math.abs(s.endTime - end) < 0.01 && s.type) return s.type;
  }
  for (const s of chain) {
    if (Math.abs(s.endTime - end) < 0.01 && s.type) return s.type;
  }
  return null;
}

/** Amplitude réelle du pattern sur toute la portée de la boucle, par moteur et par axe. */
function patternRange(pattern: EffectPattern, cycles: number, motors: number): {
  panLo: Float32Array; panHi: Float32Array; tiltLo: Float32Array; tiltHi: Float32Array;
} {
  const panLo = new Float32Array(motors).fill(Infinity);
  const panHi = new Float32Array(motors).fill(-Infinity);
  const tiltLo = new Float32Array(motors).fill(Infinity);
  const tiltHi = new Float32Array(motors).fill(-Infinity);
  for (let m = 0; m < motors; m++) {
    const spread = m * (Math.PI * 2) / motors;
    for (let i = 0; i < RANGE_SAMPLES; i++) {
      const phase = (i / RANGE_SAMPLES) * cycles * Math.PI * 2;
      const [x, y] = evalEffect(pattern, phase, spread);
      if (x < panLo[m]) panLo[m] = x;
      if (x > panHi[m]) panHi[m] = x;
      if (y < tiltLo[m]) tiltLo[m] = y;
      if (y > tiltHi[m]) tiltHi[m] = y;
    }
  }
  return { panLo, panHi, tiltLo, tiltHi };
}

/**
 * Empreinte courte d'une courbe de vitesse (pour la clé de cache).
 */
function curveKey(curve?: number[] | null): string {
  if (!curve || curve.length === 0) return 'u';
  let h = 0;
  for (let i = 0; i < curve.length; i++) {
    h = (h * 31 + Math.round(curve[i] * 1000)) | 0;
  }
  return `c${curve.length}.${h}`;
}

/**
 * Phase cumulée d'une boucle, en tours.
 *
 * Sans courbe de vitesse : progression linéaire (comportement historique).
 * Avec une courbe : la phase avance AU RYTHME de la vitesse locale → le
 * mouvement accélère sur les pics et ralentit dans les creux, tout en
 * bouclant exactement le même nombre de tours sur la section (la fin de
 * section reste alignée sur le tempo).
 */
function buildPhaseWarp(samples: number, cycles: number, speedCurve?: number[] | null): Float32Array {
  const warp = new Float32Array(samples);
  if (!speedCurve || speedCurve.length < 2) {
    for (let i = 0; i < samples; i++) warp[i] = (i / Math.max(1, samples - 1)) * cycles;
    return warp;
  }
  const v = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / Math.max(1, samples - 1)) * (speedCurve.length - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(speedCurve.length - 1, i0 + 1);
    const f = x - i0;
    v[i] = speedCurve[i0] + (speedCurve[i1] - speedCurve[i0]) * f;
  }
  let total = 0;
  for (let i = 0; i < samples; i++) total += v[i];
  if (total <= 1e-6) {
    for (let i = 0; i < samples; i++) warp[i] = (i / Math.max(1, samples - 1)) * cycles;
    return warp;
  }
  const cum = new Float32Array(samples);
  let acc = 0;
  for (let i = 0; i < samples; i++) {
    acc += v[i] / 2;                       // point milieu → phase continue
    cum[i] = acc;
    acc += v[i] / 2;
  }
  // Normalisation sur le dernier point : la boucle se referme EXACTEMENT
  // sur son nombre de tours (la fin de section reste alignée sur le tempo).
  const denom = cum[samples - 1] || 1;
  for (let i = 0; i < samples; i++) warp[i] = (cum[i] / denom) * cycles;
  return warp;
}

function buildLoop(
  section: SectionLike,
  pattern: EffectPattern,
  bpm: number,
  motors: number,
  withPrev: boolean,
  speedCurve?: number[] | null,
): SectionMoveLoop {
  const start = section.startTime;
  const end = section.endTime;
  const dur = Math.max(0.001, end - start);
  const sectionType = section.type || 'verse';
  const beatsPerCycle = SECTION_BEATS_PER_CYCLE[sectionType] ?? 4;
  const sectionBeats = (dur * bpm) / 60;
  const cycles = Math.max(1, Math.round(sectionBeats / beatsPerCycle));
  const samples = Math.min(128, Math.max(8, Math.round(cycles * 8)));
  const key = `${pattern}|${sectionType}|${start.toFixed(3)}|${end.toFixed(3)}|${bpm}|${motors}|${curveKey(speedCurve)}`;

  const pan = new Float32Array(motors * samples);
  const tilt = new Float32Array(motors * samples);
  const range = patternRange(pattern, cycles, motors);
  const warp = buildPhaseWarp(samples, cycles, speedCurve);
  const norm = (v: number, lo: number, hi: number): number => {
    const span = hi - lo;
    if (!(span > 1e-6)) return 0;
    return Math.max(-1, Math.min(1, (2 * (v - lo) / span) - 1));
  };
  for (let m = 0; m < motors; m++) {
    const spread = m * (Math.PI * 2) / motors;
    for (let i = 0; i < samples; i++) {
      const phase = warp[i] * Math.PI * 2;
      const [x, y] = evalEffect(pattern, phase, spread);
      const idx = m * samples + i;
      pan[idx] = norm(x, range.panLo[m], range.panHi[m]);
      tilt[idx] = norm(y, range.tiltLo[m], range.tiltHi[m]);
    }
  }

  const rampFrac = Math.min(RAMP_MAX_SEC, dur * RAMP_RATIO) / dur;

  let prev: SectionMoveLoop | null = null;
  if (withPrev) {
    const prevSec = prevSectionBefore(start);
    if (prevSec) {
      const prevType = prevSec.type || 'verse';
      const prevPattern =
        resolveMovePattern(chainMovements[prevSec.startTime]) ??
        SECTION_BASE_PATTERN[prevType] ??
        pattern;
      const prevEnv = getSectionEnvelope(chainEnvIds[prevSec.startTime]);
      prev = buildLoop(prevSec, prevPattern, bpm, motors, false, prevEnv?.speed);
    }
  }

  return { key, pattern, sectionType, start, end, cycles, samples, motors, pan, tilt, warp, rampFrac, prev };
}

/** Construction (cached) d'une boucle pour une section donnée. */
export function getSectionMoveLoop(
  section: SectionLike,
  pattern: EffectPattern,
  bpm = 120,
  motors = 1,
  withPrev = true,
  speedCurve?: number[] | null,
): SectionMoveLoop {
  const start = section.startTime;
  const end = section.endTime;
  const sectionType = section.type || 'verse';
  const key = `${pattern}|${sectionType}|${start.toFixed(3)}|${end.toFixed(3)}|${bpm}|${motors}|${curveKey(speedCurve)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const loop = buildLoop(section, pattern, bpm, motors, withPrev, speedCurve);
  cache.set(key, loop);
  if (loop.prev) {
    // La boucle précédente porte SA propre empreinte de vitesse (celle de
    // sa section) : on la range sous sa clé, pas sous celle de la
    // section courante.
    cache.set(loop.prev.key, loop.prev);
  }
  return loop;
}

/** Boucle de la cue, ou null si elle ne porte pas ses bornes de section. */
export function sectionMoveFor(cue: LoopCue, motors: number): SectionMoveLoop | null {
  const start = cue.sectionStart;
  const end = cue.sectionEnd;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (!(motors > 0)) return null;
  const bpm = typeof cue.bpm === 'number' && cue.bpm > 0 ? cue.bpm : 120;
  const sectionType = cue.section || sectionTypeOf(start, end) || 'verse';
  const pattern = resolveMovePattern(cue.movement) ?? SECTION_BASE_PATTERN[sectionType] ?? null;
  if (!pattern) return null;
  // Enveloppe audio de la section → la phase est warped par la vitesse
  // locale (accélère sur les pics, ralentit dans les creux).
  const env = getSectionEnvelope(cue.envId);
  return getSectionMoveLoop({ type: sectionType, startTime: start, endTime: end }, pattern, bpm, motors, true, env?.speed);
}

/** Position 0..1 dans la section (bornée). */
export function sectionPhase01(cue: { sectionStart?: number; sectionEnd?: number }, time: number): number {
  const start = cue.sectionStart;
  const end = cue.sectionEnd;
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return 0;
  const raw = (time - start) / (end - start);
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}

/** Décalage (radians → index d'échantillon) pour la phase spatiale / mouvement. */
export function phaseToIndexOffset(offsetRad: number, loop: SectionMoveLoop): number {
  if (!loop || loop.samples <= 0) return 0;
  const perTurn = loop.samples / Math.max(1, loop.cycles);
  const idx = Math.round((offsetRad / (Math.PI * 2)) * perTurn);
  return ((idx % loop.samples) + loop.samples) % loop.samples;
}

/**
 * Position dans la boucle : index entier + fraction pour l'interpolation.
 *
 * AVANT : `Math.floor()` → la tête sautait d'une position à l'autre (une
 * frame de 16 ms en montrait une seule) → mouvement « en escalier ».
 * MAINTENANT : la fraction est interpolée entre les deux échantillons
 * encadrants → trajectoire continue, comme l'annonce l'en-tête du module.
 */
function sampleIndex(loop: SectionMoveLoop, phase01: number, offset: number): { idx: number; frac: number } {
  const p = phase01 < 0 ? 0 : phase01 > 1 ? 1 : phase01;
  const base = Math.min(loop.samples - 1, Math.max(0, Math.floor(p * loop.samples)));
  const frac = p * loop.samples - base;
  const idx = (base + ((offset % loop.samples) + loop.samples)) % loop.samples;
  return { idx, frac };
}

/** Échantillon normalisé, sans raccord. */
export function sampleSectionLoopRaw(
  loop: SectionMoveLoop,
  phase01: number,
  motorIdx: number,
  offset = 0,
): [number, number] {
  const m = ((motorIdx % loop.motors) + loop.motors) % loop.motors;
  const { idx, frac } = sampleIndex(loop, phase01, offset);
  const next = (idx + 1) % loop.samples;
  const a = m * loop.samples + idx;
  const b = m * loop.samples + next;
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  return [
    loop.pan[a] + (loop.pan[b] - loop.pan[a]) * f,
    loop.tilt[a] + (loop.tilt[b] - loop.tilt[a]) * f,
  ];
}

/** Échantillon normalisé avec fondu de raccord depuis la fin de la section précédente. */
export function sampleSectionLoop(
  loop: SectionMoveLoop,
  phase01: number,
  motorIdx: number,
  offset = 0,
): [number, number] {
  const raw = sampleSectionLoopRaw(loop, phase01, motorIdx, offset);
  if (!loop.prev || !(loop.rampFrac > 0) || phase01 >= loop.rampFrac) return raw;
  const from = sampleSectionLoopRaw(loop.prev, 1, motorIdx, offset);
  const k = phase01 / loop.rampFrac;
  return [
    from[0] + (raw[0] - from[0]) * k,
    from[1] + (raw[1] - from[1]) * k,
  ];
}

/**
 * Amplitude autorisée pour un centre donné : jamais au-delà de la course
 * disponible (sinon la valeur serait plaquée sur 0 ou 255).
 */
export function movementAmp(wanted: number, center: number, limit = 128): number {
  const c = Math.max(0, Math.min(255, center));
  const headroom = Math.min(c, 255 - c);
  const amp = Math.min(Math.max(0, wanted), Math.max(0, limit));
  return Math.max(0, Math.min(amp, headroom));
}
