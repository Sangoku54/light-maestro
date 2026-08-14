/**
 * MTC Markers — logique pure des cues sur timecode (lot #15)
 *
 * Deux responsabilités, volontairement séparées du hook React
 * (src/hooks/mtc-trigger.ts) pour être testables en node :
 *
 *  1. `timecodeToMs` — conversion d'une position SMPTE HH:MM:SS:FF en
 *     millisecondes absolues, avec l'algorithme de comptage drop-frame
 *     pour le rate 29.97 (2 compteurs de frames sautés par minute, sauf
 *     les minutes divisibles par 10 — David Heidelberger). Les positions
 *     de marqueurs sont stockées en ms : indépendant du rate affiché.
 *  2. `evaluateMtcMarkers` — edge-trigger : quels marqueurs franchir entre
 *     la position précédente et la position courante. Anti-rebond par
 *     marqueur (un marqueur ne se déclenche qu'une fois par passage), et
 *     reset complet quand la timeline saute en arrière ou se relock
 *     (jump arrière / Full Frame en arrière) pour éviter les re-déclen-
 *     chements en rafale.
 */

import type { MtcRate } from '@electron/midi/mtc';

export type MtcMarkerTarget =
  | { type: 'scene'; sceneId: string }
  | { type: 'chaser'; chaserId: string };

export interface MtcMarker {
  id: string;
  name: string;
  /** Position en millisecondes depuis minuit (24 h). */
  positionMs: number;
  /** Rate utilisé pour l'AFFICHAGE/édition de la position en HH:MM:SS:FF
   *  (le stockage est en ms — indépendant du rate du flux). */
  rate: MtcRate;
  target: MtcMarkerTarget;
  action: 'play' | 'stop' | 'toggle';
  enabled: boolean;
}

export interface MtcMarkerEval {
  /** Marqueurs à déclencher maintenant (fenêtre (prevMs, currMs]). */
  toFire: MtcMarker[];
  /** La timeline a sauté en arrière (ou re-lock) : tout redevient jouable. */
  reset: boolean;
}

function rateToFps(rate: MtcRate): number {
  switch (rate) {
    case '24': return 24;
    case '25': return 25;
    default: return 30; // '30drop' compte en 30 nominal (compteurs sautés)
  }
}

/**
 * HH:MM:SS:FF → ms absolues depuis minuit. Pour 29.97 drop-frame, applique
 * le comptage SMPTE : les frames 0-1 sont sautées à chaque minute sauf les
 * minutes divisibles par 10 (l'algorithme retranche 2 compteurs ×
 * (totalMinutes − floor(totalMinutes/10))).
 */
export function timecodeToMs(
  hours: number,
  minutes: number,
  seconds: number,
  frames: number,
  rate: MtcRate
): number {
  const fps = rateToFps(rate);
  const totalMinutes = hours * 60 + minutes;
  let frameCount = (totalMinutes * 60 + seconds) * fps + frames;
  if (rate === '30drop') {
    frameCount -= 2 * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  // (frames × 1000) / fps — évite l'erreur flottante de (1000/fps) × frames
  // et reste déterministe pour les tests (mêmes opérations des deux côtés).
  return (frameCount * 1000) / fps;
}

/** Convertit un MtcState (contrat main) en position ms (null si non locked). */
export function mtcStateToMs(state: {
  locked: boolean;
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  rate: MtcRate;
}): number | null {
  if (!state.locked) return null;
  return timecodeToMs(state.hours, state.minutes, state.seconds, state.frames, state.rate);
}

/**
 * ms → HH:MM:SS:FF (affichage/édition des marqueurs).
 *
 * Pour 29.97 DF, le comptage n'est PAS injectif : les frames 0-1 des
 * minutes non divisibles par 10 n'existent pas dans le flux (le compteur
 * saute de 00:00:59:29 à 00:01:00:02). On retrouve donc la minute totale
 * `tm` dont l'intervalle de comptage contient le nombre de frames, en
 * exigeant un TC LÉGAL en DF (frames ≥ 2 hors minutes ÷10) — round-trip
 * exact pour tout TC valide émis par un vrai flux.
 */
export function msToTimecode(
  ms: number,
  rate: MtcRate
): { hours: number; minutes: number; seconds: number; frames: number } {
  const fps = rateToFps(rate);
  const frameDuration = 1000 / fps;
  let frameNumber = Math.round(ms / frameDuration);

  if (rate === '30drop') {
    const framesPerMinute = fps * 60;
    const guess = Math.floor(frameNumber / framesPerMinute);
    // L'écart cumulé skip(tm) atteint ~1,44 min à 24 h (2 compteurs/min
    // sauf minutes ÷10) → une fenêtre de ±2 minutes couvre le pire cas.
    for (let tm = Math.max(0, guess - 2); tm <= Math.min(1439, guess + 2); tm++) {
      const skipped = 2 * (tm - Math.floor(tm / 10));
      const tcFrames = frameNumber + skipped;
      if (tcFrames >= tm * framesPerMinute && tcFrames < (tm + 1) * framesPerMinute) {
        const rest = tcFrames - tm * framesPerMinute;
        const seconds = Math.floor(rest / fps);
        const frames = rest % fps;
        // Légalité DF : seules les frames 0-1 de la PREMIÈRE seconde des
        // minutes non divisibles par 10 sont sautées par le compteur.
        const legal = tm % 10 === 0 || seconds > 0 || frames >= 2;
        if (legal) {
          return {
            hours: Math.floor(tm / 60),
            minutes: tm % 60,
            seconds,
            frames,
          };
        }
        // TC dans un trou de 2 frames (sautées en DF) → chercher la
        // minute suivante (l'écart est borné par ±1 min autour du guess).
      }
    }
  }

  const frames = frameNumber % fps;
  frameNumber = Math.floor(frameNumber / fps);
  const seconds = frameNumber % 60;
  frameNumber = Math.floor(frameNumber / 60);
  const minutes = frameNumber % 60;
  frameNumber = Math.floor(frameNumber / 60);
  const hours = frameNumber % 24;
  return { hours, minutes, seconds, frames };
}

/**
 * Un TC est-il valide pour le rate donné ? En 29.97 DF, les frames 0-1 de
 * la PREMIÈRE seconde d'une minute non divisible par 10 n'existent pas
 * dans le flux (elles sont sautées par le compteur : 00:01:00:00 et
 * :01 n'existent pas, mais 00:01:23:00 existe) — les rejeter à l'édition
 * évite les positions ambiguës (deux TC distincts mappant la même ms).
 */
export function isValidTimecode(
  hours: number,
  minutes: number,
  seconds: number,
  frames: number,
  rate: MtcRate
): boolean {
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return false;
  if (seconds < 0 || seconds > 59 || frames < 0 || frames > 29) return false;
  if (rate === '30drop' && minutes % 10 !== 0 && seconds === 0 && frames < 2) return false;
  return true;
}

/**
 * Évalue les marqueurs franchis entre `prevMs` (exclus) et `currMs`
 * (inclus).
 *
 * - `prevMs === null` (premier état reçu, re-lock) → rien à déclencher :
 *   on ne veut pas un déluge de cues au moment où le lock s'acquiert.
 * - `currMs < prevMs` (jump arrière / scrub / FF en arrière) → reset : le
 *   hook vide son ensemble « déjà joué » et ne déclenche rien ce tick.
 * - Sinon : chaque marqueur activé dont la position tombe dans la fenêtre
 *   et qui n'a pas déjà été joué est déclenché.
 */
export function evaluateMtcMarkers(
  prevMs: number | null,
  currMs: number,
  markers: readonly MtcMarker[],
  played: ReadonlySet<string>
): MtcMarkerEval {
  if (prevMs === null) return { toFire: [], reset: false };
  if (currMs < prevMs) return { toFire: [], reset: true };

  const toFire: MtcMarker[] = [];
  for (const marker of markers) {
    if (!marker.enabled) continue;
    if (marker.positionMs > prevMs && marker.positionMs <= currMs && !played.has(marker.id)) {
      toFire.push(marker);
    }
  }
  return { toFire, reset: false };
}
