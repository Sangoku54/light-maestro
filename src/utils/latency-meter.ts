/**
 * Latency Meter — mesure de la latence du pipeline renderer audio→DMX.
 *
 * Méthode (chemin critique, honnête sur ce que la mesure représente) :
 *  - `recordAudioTick()` est appelé au début de chaque cycle de la boucle
 *    rAF de playback DMX (le tick qui lit l'état audio dérivé — horloge
 *    audio, section/énergie issues de l'analyse — et calcule la trame).
 *  - `recordOutputTick()` est appelé quand la trame DMX du cycle part vers
 *    le main process (funnel dmx-bridge, juste avant l'appel IPC
 *    `setChannels`).
 *  - Un échantillon = écart entre ces deux horodatages du MÊME cycle.
 *    C'est la latence du chemin critique RENDERER (état audio lu → trame
 *    émise via IPC). Ça n'inclut PAS la latence matérielle (IPC, écriture
 *    SAB, worker, USB/ArtNet/sACN, réponse des fixtures).
 *
 * Appariement : `recordOutputTick()` ne consomme un tick audio que s'il y en
 * a un en attente (posé par le cycle courant). Les émissions hors cycle
 * audio (ex. poussée manuelle d'un canal depuis le design panel) ne
 * produisent donc pas d'échantillon. Un écart > MAX_SAMPLE_MS indique qu'il
 * n'y a pas de corrélation même-cycle : l'échantillon est ignoré.
 *
 * Module pur, sans dépendance, testable (les horodatages sont injectables).
 */

/** Fenêtre glissante de la moyenne affichée (≈0,5 s à 60 fps). */
export const WINDOW_SIZE = 30;

/**
 * Garde-fou de corrélation même-cycle : au-delà, l'écart n'est pas
 * attribuable au pipeline analyse→émission du même cycle.
 */
export const MAX_SAMPLE_MS = 1000;

/** Instant du dernier tick d'analyse audio (ms, horloge performance.now). */
let lastAudioTickMs: number | null = null;

/** Un tick audio attend encore sa trame de sortie (même cycle). */
let audioTickPending = false;

/** Échantillons de latence (ms), fenêtre glissante. */
const samples: number[] = [];

/** Marque le début d'un cycle d'analyse audio (début du tick renderer). */
export function recordAudioTick(now: number = performance.now()): void {
  lastAudioTickMs = now;
  audioTickPending = true;
}

/**
 * Marque l'émission d'une trame DMX (juste avant l'appel IPC setChannels).
 * Consomme le tick audio en attente et enregistre l'écart du même cycle.
 */
export function recordOutputTick(now: number = performance.now()): void {
  if (!audioTickPending || lastAudioTickMs === null) return;
  audioTickPending = false;
  const delta = now - lastAudioTickMs;
  // Hors corrélation même-cycle (trame émise longtemps après le tick audio,
  // ou tick non suivi d'émission) → on ne pollue pas la mesure.
  if (delta < 0 || delta > MAX_SAMPLE_MS) return;
  samples.push(delta);
  if (samples.length > WINDOW_SIZE) samples.shift();
}

/**
 * Latence moyenne (ms) sur la fenêtre glissante, ou null si aucun échantillon.
 */
export function getLatencyMs(): number | null {
  if (samples.length === 0) return null;
  let sum = 0;
  for (const v of samples) sum += v;
  return sum / samples.length;
}

/** Réinitialise la mesure (fenêtre, tick en attente, horodatage). */
export function reset(): void {
  samples.length = 0;
  lastAudioTickMs = null;
  audioTickPending = false;
}

export interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

/** Statistiques complètes de la fenêtre courante (0/0/0/0 si vide). */
export function getStats(): LatencyStats {
  if (samples.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, avg: sum / samples.length, count: samples.length };
}
