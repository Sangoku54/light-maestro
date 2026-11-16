/* Audio analysis: spectral MIR with novelty curve section detection,
 * multi-band beat tracking, self-similarity analysis, and pattern recognition.
 * Professional-grade Music Information Retrieval.
 *
 * Key improvements over v1:
 *  - Novelty curve (spectral flux) for cleaner section boundaries
 *  - Self-similarity matrix → repeating pattern detection (ABAB, AABA, ABABCB…)
 *  - Multi-band autocorrelation beat tracking with phase alignment
 *  - Spectral downbeat detection via bass/mid accentuation
 *  - True drop detection: energy peak preceded by a build-up (rising energy)
 *  - Bass/treble ratio for verse (voice-dominant mids) vs chorus (full-spectrum)
 *  - Full per-frame spectral features (centroid, flux, RMS curves)
 */

export type EnergyTrend = 'rising' | 'falling' | 'stable' | 'peak' | 'valley';

export interface SectionAnalysis {
  sectionIndex: number;
  sectionType: string;
  startTime: number;
  endTime: number;
  rmsMean: number;
  rmsVariance: number;
  rmsCurve: number[];
  spectralCentroid: number;
  spectralSpread: number;
  spectralFlatness: number;
  spectralRolloff: number;
  subBassRatio: number;
  bassRatio: number;
  harmonicRatio: number;
  dissonanceLevel: number;
  onsetDensity: number;
  onsetRegularity: number;
  energyTrend: EnergyTrend;
  isBuildUp: boolean;
  isBreakdown: boolean;
  isDrop: boolean;
}

export type AtmosphereType = 'energetic' | 'dark' | 'uplifting' | 'dreamy' | 'aggressive' | 'groovy' | 'epic';

export interface TrackSection {
  type: 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'outro' | 'build' | 'unknown';
  startTime: number;
  endTime: number;
  energy: number;
  color: string;
}

export interface TrackAnalysis {
  duration: number;
  sampleRate: number;
  bpm: number;
  beats: number[];
  beatPositions: number[];
  beatStrengths: ('strong' | 'weak')[];
  downbeats: number[];
  /** Optional: synthetic analyses (e.g. test fixtures) may omit section segmentation. */
  sections?: TrackSection[];
  energyCurve: number[];
  lowCurve: number[];
  midCurve: number[];
  highCurve: number[];
  /** Optional: synthetic analyses may omit waveform/file metadata. */
  waveform?: number[];
  fileName?: string;
  fileSize?: number;
  genre?: string;
  key?: string;
  /** Time signature as a string like "4/4" (informational field, used by presets). */
  timeSignature?: string;
  /** Confidence of the detected musical key (informational field, used by presets). */
  keyConfidence?: number;
  vocalCurve?: number[];
  onsetCurve?: number[];
  sectionAnalyses?: SectionAnalysis[];
  atmosphere?: AtmosphereType;
  spectralCentroidCurve?: number[];
  spectralFluxCurve?: number[];
  rmsCurve?: number[];
  noveltyCurve?: number[];
  sectionLabels?: string[];
}

export const SECTION_COLORS: Record<string, string> = {
  intro: '#3b82f6', verse: '#8b5cf6', chorus: '#ec4899',
  bridge: '#f59e0b', drop: '#ef4444', outro: '#6b7280', unknown: '#4b5563',
};

export interface GenreProfile {
  genre: string;
  label: string;
  confidence: number;
  bpm: number;
  palette: string;
  description: string;
}

export const keyToPalette: Record<string, string> = {
  'C': 'warm', 'C#': 'cool', 'D': 'party', 'D#': 'monochrome',
  'E': 'warm', 'F': 'warm', 'F#': 'cool', 'G': 'warm',
  'G#': 'monochrome', 'A': 'party', 'A#': 'cool', 'B': 'party',
  'Cm': 'cool', 'C#m': 'monochrome', 'Dm': 'cool', 'D#m': 'monochrome',
  'Em': 'cool', 'Fm': 'monochrome', 'F#m': 'cool', 'Gm': 'cool',
  'G#m': 'monochrome', 'Am': 'cool', 'A#m': 'monochrome', 'Bm': 'cool',
};

// ═══════════════════════════════════════════════════════════
// 0. Math utilities
// ═══════════════════════════════════════════════════════════

const r4 = (v: number) => Math.round(v * 10000) / 10000;

function mean(arr: number[]): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length > 0 ? s / arr.length : 0;
}

function std(arr: number[], m?: number): number {
  const mu = m ?? mean(arr);
  let vr = 0;
  for (let i = 0; i < arr.length; i++) vr += (arr[i] - mu) ** 2;
  return arr.length > 0 ? Math.sqrt(vr / arr.length) : 0;
}

function normalize(arr: number[]): number[] {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  max = Math.max(max, 0.0001);
  const result = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) result[i] = arr[i] / max;
  return result;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function smooth(arr: number[], window: number): number[] {
  const result = new Array(arr.length).fill(0);
  const half = Math.floor(window / 2);
  for (let i = 0; i < arr.length; i++) {
    const ws = Math.max(0, i - half);
    const we = Math.min(arr.length - 1, i + half);
    let s = 0;
    for (let j = ws; j <= we; j++) s += arr[j];
    result[i] = r4(s / (we - ws + 1));
  }
  return result;
}

function gaussianWindow(size: number, sigma: number): Float32Array {
  const w = new Float32Array(size);
  const center = (size - 1) / 2;
  for (let i = 0; i < size; i++) {
    w[i] = Math.exp(-0.5 * ((i - center) / sigma) ** 2);
  }
  return w;
}

function autocorrelation(signal: number[], maxLag?: number): number[] {
  const n = signal.length;
  const maxL = maxLag ?? n;
  const result = new Array(maxL).fill(0);
  const mu = mean(signal);
  for (let lag = 0; lag < maxL; lag++) {
    let num = 0;
    let count = 0;
    for (let i = 0; i < n - lag; i++) {
      num += (signal[i] - mu) * (signal[i + lag] - mu);
      count++;
    }
    result[lag] = count > 0 ? num / count : 0;
  }
  const r0 = Math.max(1e-10, result[0]);
  for (let lag = 1; lag < maxL; lag++) result[lag] /= r0;
  result[0] = 1;
  return result;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ═══════════════════════════════════════════════════════════
// 1. FFT in-place (Cooley-Tukey, radix-2)
// ═══════════════════════════════════════════════════════════

/**
 * Twiddle factors (cos/sin) par taille de FFT, calculés UNE SEULE FOIS.
 *
 * PERF : la version précédente calculait Math.cos/Math.sin dans la boucle de
 * butterflies → 11 264 appels transcendentiels par FFT × 2400 frames = ~27 M
 * appels Math.cos + 27 M Math.sin pour un morceau de 4 min. C'était 62 % du
 * temps total d'analyse. La table est calculée une fois par taille (2048
 * points = 1024 entrées) puis réutilisée pour toutes les frames.
 */
const _twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function getTwiddles(len: number): { cos: Float64Array; sin: Float64Array } {
  let t = _twiddleCache.get(len);
  if (!t) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      cos[k] = Math.cos(angle * k);
      sin[k] = Math.sin(angle * k);
    }
    t = { cos, sin };
    _twiddleCache.set(len, t);
  }
  return t;
}

function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      // PERF : swaps manuels — le destructuring [a[i], a[j]] = [a[j], a[i]]
      // alloue un tableau + un itérateur à CHAQUE inversion (2048 par FFT).
      let t = real[i]; real[i] = real[j]; real[j] = t;
      t = imag[i]; imag[i] = imag[j]; imag[j] = t;
    }
    let k = n >> 1;
    while (k <= j) { j -= k; k >>= 1; }
    j += k;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const tw = getTwiddles(len);
    const twCos = tw.cos;
    const twSin = tw.sin;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const cos = twCos[k];
        const sin = twSin[k];
        const tRe = real[i + k + half] * cos - imag[i + k + half] * sin;
        const tIm = real[i + k + half] * sin + imag[i + k + half] * cos;
        real[i + k + half] = real[i + k] - tRe;
        imag[i + k + half] = imag[i + k] - tIm;
        real[i + k] += tRe;
        imag[i + k] += tIm;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Time-domain band energy (fast approximation for curves)
// ═══════════════════════════════════════════════════════════

function bandEnergy(samples: Float32Array, sampleRate: number, lo: number, hi: number): number {
  const mid = Math.max(1, (lo + hi) / 2);
  const win = Math.max(2, Math.floor(sampleRate / (mid * 2)));
  const step = Math.max(1, Math.floor(win / 4));
  let energy = 0;
  let prev = samples[0];
  for (let i = step; i < samples.length; i += step) {
    const diff = samples[i] - prev;
    energy += diff * diff;
    prev = samples[i];
  }
  const count = Math.floor((samples.length - 1) / step) + 1;
  return count > 0 ? Math.sqrt(energy / count) : 0;
}

// ═══════════════════════════════════════════════════════════
// 3. Spectral frame analysis
// ═══════════════════════════════════════════════════════════

const FFT_SIZE = 2048;

interface SpectralFrame {
  mag: Float32Array;
  rms: number;
  bands: { sub: number; bass: number; lowMid: number; mid: number; high: number };
  rawBands: { sub: number; bass: number; lowMid: number; mid: number; high: number };
  centroid: number;
  spread: number;
  flatness: number;
  rolloff: number;
}

/**
 * Fenêtre de Hann pré-calculée par taille de FFT.
 *
 * PERF : le windowing calculait Math.cos() pour CHAQUE échantillon de CHAQUE
 * frame (2048 × 2400 frames = 4,9 M appels transcendentiels). La fenêtre ne
 * change pas d'une frame à l'autre → calculée une fois, réutilisée.
 */
const _hannCache = new Map<number, Float32Array>();

function getHannWindow(size: number): Float32Array {
  let w = _hannCache.get(size);
  if (!w) {
    w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    }
    _hannCache.set(size, w);
  }
  return w;
}

/** Buffers de travail de la FFT, réutilisés d'une frame à l'autre. */
const _fftBuffers = new Map<number, { real: Float32Array; imag: Float32Array }>();

function getFftBuffers(size: number): { real: Float32Array; imag: Float32Array } {
  let b = _fftBuffers.get(size);
  if (!b) {
    b = { real: new Float32Array(size), imag: new Float32Array(size) };
    _fftBuffers.set(size, b);
  }
  return b;
}

function computeSpectralFrame(
  data: Float32Array,
  offset: number,
  fftSize: number,
  sampleRate: number,
): SpectralFrame | null {
  if (offset + fftSize > data.length) return null;

  // PERF : buffers réutilisés (2 × 8 Ko par frame évités) + fenêtre Hann
  // pré-calculée (2048 Math.cos par frame évités).
  const buf = getFftBuffers(fftSize);
  const real = buf.real;
  const imag = buf.imag;
  const win = getHannWindow(fftSize);
  let sumSq = 0;

  for (let i = 0; i < fftSize; i++) {
    const sample = data[offset + i] * win[i];
    real[i] = sample;
    imag[i] = 0; // le buffer est réutilisé → il faut le remettre à zéro
    sumSq += sample * sample;
  }

  fftInPlace(real, imag);

  const binFreq = sampleRate / fftSize;
  const halfN = fftSize >> 1;
  const mag = new Float32Array(halfN);

  for (let i = 1; i < halfN; i++) {
    mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }

  // PERF : les 6 boucles séparées sur halfN (bandes, centroid, spread, flatness,
  // totalMag) sont fusionnées en 2 passes (le spread dépend du centroid, donc
  // il reste necessarily séparé). 6 × 1024 itérations par frame → 3.
  let sub = 0, bass = 0, lowMid = 0, mid = 0, high = 0;
  let cNum = 0, cDen = 0;
  let gSum = 0, aSum = 0, cnt = 0;
  let totalMag = 0;
  const epsilon = 1e-10;
  for (let i = 1; i < halfN; i++) {
    const freq = i * binFreq;
    const m = mag[i];
    // Bandes (20 Hz – 8 kHz)
    if (freq >= 20 && freq <= 8000) {
      if (freq < 60) sub += m;
      else if (freq < 250) bass += m;
      else if (freq < 500) lowMid += m;
      else if (freq < 2000) mid += m;
      else high += m;
    }
    // Statistiques de timbre (80 Hz – 12 kHz)
    if (freq >= 80 && freq <= 12000) {
      cNum += freq * m;
      cDen += m;
      const v = m > epsilon ? m : epsilon;
      gSum += Math.log(v);
      aSum += v;
      cnt++;
      totalMag += m;
    }
  }
  const totalBand = Math.max(1e-10, sub + bass + lowMid + mid + high);
  const centroid = cDen > 0 ? cNum / cDen : 0;
  const gMean = cnt > 0 ? Math.exp(gSum / cnt) : 0;
  const aMean = cnt > 0 ? aSum / cnt : epsilon;
  const flatness = Math.min(1, gMean / aMean);

  // Spread : dépend du centroid → 2ᵉ passe nécessaire.
  let sNum = 0, sDen = 0;
  for (let i = 1; i < halfN; i++) {
    const freq = i * binFreq;
    if (freq < 80 || freq > 12000) continue;
    sNum += (freq - centroid) ** 2 * mag[i];
    sDen += mag[i];
  }
  const spread = sDen > 0 ? Math.sqrt(sNum / sDen) : 0;

  // Spectral rolloff (85 % de l'énergie)
  let cumSum = 0, rolloffFreq = 8000;
  for (let i = 1; i < halfN; i++) {
    const freq = i * binFreq;
    if (freq < 80 || freq > 12000) continue;
    cumSum += mag[i];
    if (cumSum >= 0.85 * totalMag) { rolloffFreq = freq; break; }
  }

  return {
    mag,
    rms: Math.sqrt(Math.max(0, sumSq / fftSize)),
    bands: {
      sub: sub / totalBand,
      bass: bass / totalBand,
      lowMid: lowMid / totalBand,
      mid: mid / totalBand,
      high: high / totalBand,
    },
    rawBands: { sub, bass, lowMid, mid, high },
    centroid,
    spread,
    flatness,
    rolloff: rolloffFreq,
  };
}

// ═══════════════════════════════════════════════════════════
// 4. Spectral flux & novelty curve (MIR standard approach)
// ═══════════════════════════════════════════════════════════

function spectralFlux(prev: Float32Array, curr: Float32Array): number {
  let flux = 0;
  let total = 0;
  const len = Math.min(prev.length, curr.length);
  for (let i = 1; i < len; i++) {
    const diff = curr[i] - prev[i];
    if (diff > 0) flux += diff;
    total += curr[i];
  }
  return total > 0 ? flux / total : 0;
}

/**
 * Novelty curve (Foote) : diagonale d'une matrice d'auto-similarité, pondérée
 * par un noyau gaussien, enrichie du spectral flux.
 *
 * PERF : les features sont extraites UNE SEULE FOIS par frame dans un
 * Float32Array (avant : 2 tableaux de 8 floats ALLOCUÉS par frame × 9
 * kernels = ~180 000 allocations pour un morceau de 4 min), les normes sont
 * pré-calculées, et le spectral flux est fusionné en un seul passage sur les
 * magnitudes (avant : 2 passes, la somme recalculée à chaque frame).
 */
function computeNoveltyCurve(frames: SpectralFrame[]): number[] {
  if (frames.length < 2) return new Array(frames.length).fill(0);

  const n = frames.length;
  const kernelHalf = 4;
  const sigma = 1.5;
  const K = kernelHalf * 2 + 1;

  // Noyau gaussien pré-calculé
  const kernel = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const d = k - kernelHalf;
    kernel[k] = Math.exp(-0.5 * (d / sigma) ** 2);
  }

  // ── Features par frame (1 seule allocation) + normes pour la similarité ──
  const F = 8;
  const feat = new Float64Array(n * F);
  const norm = new Float64Array(n);
  const magSum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const o = i * F;
    feat[o] = f.bands.sub;
    feat[o + 1] = f.bands.bass;
    feat[o + 2] = f.bands.lowMid;
    feat[o + 3] = f.bands.mid;
    feat[o + 4] = f.bands.high;
    feat[o + 5] = f.centroid / 8000;
    feat[o + 6] = f.rms;
    feat[o + 7] = f.flatness;
    let s = 0;
    for (let k = 0; k < F; k++) s += feat[o + k] * feat[o + k];
    norm[i] = Math.sqrt(s);
    const mag = f.mag;
    let m = 0;
    for (let k = 0; k < mag.length; k++) m += mag[k];
    magSum[i] = m;
  }

  const novelty: number[] = new Array(n).fill(0);

  for (let i = kernelHalf; i < n - kernelHalf; i++) {
    let nov = 0;
    for (let k = -kernelHalf; k <= kernelHalf; k++) {
      const left = i + k;
      const right = i - k;
      if (left < 0 || left >= n || right < 0 || right >= n) continue;
      const w = kernel[k + kernelHalf];
      // 1 - cosinus, sans allocation ni racine par paire
      const ol = right * F;
      const orr = left * F;
      let dot = 0;
      for (let t = 0; t < F; t++) dot += feat[ol + t] * feat[orr + t];
      const denom = norm[right] * norm[left];
      const dist = denom > 0 ? 1 - dot / denom : 0;
      nov += w * dist;
    }
    novelty[i] = nov;
  }

  // Spectral flux en UNE passe (la somme des magnitudes est pré-calculée).
  for (let i = 1; i < n; i++) {
    const prev = frames[i - 1].mag;
    const curr = frames[i].mag;
    const len = Math.min(prev.length, curr.length);
    let flux = 0;
    for (let k = 0; k < len; k++) {
      const diff = curr[k] - prev[k];
      if (diff > 0) flux += diff;
    }
    const total = magSum[i];
    const sf = total > 0 ? flux / total : 0;
    novelty[i] = 0.3 * novelty[i] + 0.7 * sf;
  }

  const smoothed = smooth(novelty, 3);
  return normalize(smoothed);
}

// ═══════════════════════════════════════════════════════════
// 5. Section boundary detection (novelty curve peak picking)
// Two-pass: global threshold → local peak refinement with spectral contrast check
// ═══════════════════════════════════════════════════════════

export function detectSectionBoundaries(
  noveltyCurve: number[],
  energyCurve: number[],
  lowCurve: number[],
  spectralCentroidCurve: number[],
  analysisRate: number,
  duration: number,
  minSectionSec: number = 2,
): number[] {
  const n = noveltyCurve.length;
  if (n < 4) return [0, n - 1];

  // ── Seuil LOCAL (Foote 2000) : médiane de la novelty sur une fenêtre
  // glissante de ±2,5 s. Un seuil GLOBAL fixe donne une sensibilité inégale :
  // trop permissif dans les passages tranquilles (faux positifs) et trop strict
  // dans les passages bruyants (frontières manquées). La médiane locale suit
  // le niveau de la novelty locale → détection homogène sur tout le morceau
  // (méthodeFoote/librosa/madmom, celle de SoundSwitch).
  const medianWindow = Math.max(4, Math.floor(analysisRate * 5)); // ±2,5 s
  const BINS = 256;
  const hist = new Int32Array(BINS);
  const localMedian = new Float64Array(n);
  {
    // Histogramme glissant (les valeurs sont normalisées dans [0,1] → 256
    // bins suffisent) → médiane en O(1) amorti au lieu d'un tri par frame.
    const binOf = (v: number) => {
      const b = Math.floor(v * (BINS - 1));
      return b < 0 ? 0 : b > BINS - 1 ? BINS - 1 : b;
    };
    let count = 0;
    const halfW = medianWindow >> 1;
    // Pré-remplissage
    for (let i = 0; i < Math.min(n, halfW); i++) { hist[binOf(noveltyCurve[i])]++; count++; }
    for (let i = 0; i < n; i++) {
      // médiane de la fenêtre courante
      const target = (count + 1) >> 1;
      let acc = 0, med = 0;
      for (let b = 0; b < BINS; b++) {
        acc += hist[b];
        if (acc >= target) { med = b / (BINS - 1); break; }
      }
      localMedian[i] = med;
      // glissement
      const outIdx = i - halfW;
      if (outIdx >= 0) { hist[binOf(noveltyCurve[outIdx])]--; count--; }
      const inIdx = i + halfW + 1;
      if (inIdx < n) { hist[binOf(noveltyCurve[inIdx])]++; count++; }
    }
  }

  // Seuil global : plancher (évite les pics dans le bruit de fond) + garde-fou
  // absolu pour ne rien détecter dans un morceau sans structure.
  const sorted = [...noveltyCurve].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(n * 0.50)];
  const p75 = sorted[Math.floor(n * 0.75)];
  const p90 = sorted[Math.floor(n * 0.90)];
  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.floor(n * 0.99)];
  const globalFloor = Math.max(0.05, p50 * 0.25 + p75 * 0.35 + p90 * 0.25);

  const minGap = Math.floor(analysisRate * minSectionSec);
  const adaptiveWindow = Math.floor(analysisRate * 1.0); // Reduced from 1.5s

  // Pass 1: candidats = pics LOCAUX au-dessus du seuil local
  const candidates: number[] = [];
  for (let i = minGap; i < n - 1; i++) {
    const v = noveltyCurve[i];
    // Seuil local : médiane locale × facteur + marge absolue.
    // Le facteur > 1 garantit qu'un pic doit dépasser nettement le bruit local.
    // (facteur/marge ajustables pour l'étalonnage — cf. scripts/bench-analysis)
    const peakCfg = (globalThis as any).__LM_PEAK_CFG ?? { factor: 1.35, offset: 0.022 };
    const localThreshold = Math.max(globalFloor, localMedian[i] * peakCfg.factor + peakCfg.offset);
    if (v < localThreshold) continue;
    // Must be local peak
    if (!(v > noveltyCurve[i - 1] && v >= noveltyCurve[i + 1])) continue;
    // Must be top in local window
    const ws = Math.max(0, i - adaptiveWindow);
    const we = Math.min(n, i + adaptiveWindow);
    let isLocalMax = true;
    for (let j = ws; j < we; j++) {
      if (j !== i && noveltyCurve[j] > v) { isLocalMax = false; break; }
    }
    if (isLocalMax) candidates.push(i);
  }
  dlog('  candidates:', candidates.length, 'peaks (local threshold)');

  // Pass 2: spectral contrast check — reject weak boundaries
  const boundaries: number[] = [0];
  let lastBoundary = 0;

  for (const i of candidates) {
    if (i - lastBoundary < minGap) continue;

    // Spectral contrast: compare energy + centroid + bass before/after
    const halfWin = Math.floor(analysisRate * 0.8); // Reduced window
    const ba = Math.max(0, i - halfWin);
    const bb = i;
    const aa = i;
    const ab = Math.min(n, i + halfWin);

    const beforeE = mean(energyCurve.slice(ba, bb));
    const afterE = mean(energyCurve.slice(aa, ab));
    const beforeC = mean(spectralCentroidCurve.slice(ba, bb));
    const afterC = mean(spectralCentroidCurve.slice(aa, ab));
    const beforeB = mean(lowCurve.slice(ba, bb));
    const afterB = mean(lowCurve.slice(aa, ab));

    const energyContrast = Math.abs(afterE - beforeE) / Math.max(0.01, Math.max(afterE, beforeE));
    const centroidContrast = Math.abs(afterC - beforeC) / Math.max(0.01, Math.max(afterC, beforeC));
    const bassContrast = Math.abs(afterB - beforeB) / Math.max(0.01, Math.max(afterB, beforeB));

    const contrastScore = energyContrast * 0.5 + centroidContrast * 0.3 + bassContrast * 0.2;
    // Much lower thresholds: stronger novelty peaks need very little contrast
    const contrastThreshold = noveltyCurve[i] > p99 ? 0.008 :
                              noveltyCurve[i] > p95 ? 0.015 :
                              noveltyCurve[i] > p90 ? 0.025 :
                              noveltyCurve[i] > p75 ? 0.04 : 0.055;

    if (contrastScore > contrastThreshold) {
      boundaries.push(i);
      lastBoundary = i;
      dlog('  boundary at', r4(i / analysisRate), 'novelty=', noveltyCurve[i].toFixed(3), 'contrast=', contrastScore.toFixed(3), 'thresh=', contrastThreshold.toFixed(3));
    } else {
      dlog('  REJECTED at', r4(i / analysisRate), 'novelty=', noveltyCurve[i].toFixed(3), 'contrast=', contrastScore.toFixed(3), 'thresh=', contrastThreshold.toFixed(3));
    }
  }

  boundaries.push(n - 1);

  // Merge adjacent boundaries that are too close
  const merged: number[] = [0];
  for (let i = 1; i < boundaries.length - 1; i++) {
    if (boundaries[i] - merged[merged.length - 1] < minGap) {
      // Keep the one with higher novelty
      const prevN = noveltyCurve[merged[merged.length - 1]];
      const currN = noveltyCurve[boundaries[i]];
      if (currN > prevN) merged[merged.length - 1] = boundaries[i];
    } else {
      merged.push(boundaries[i]);
    }
  }
  merged.push(n - 1);

  return merged;
}

// ═══════════════════════════════════════════════════════════
// 6. Self-similarity matrix & repeating pattern detection
// ═══════════════════════════════════════════════════════════

export interface SegmentFeatures {
  startF: number;
  endF: number;
  startT: number;
  endT: number;
  energy: number;
  bassRatio: number;
  centroidNorm: number;
  flatness: number;
  subBassRatio: number;
}

function computeSegmentSimilarityMatrix(segments: SegmentFeatures[]): number[][] {
  const n = segments.length;
  const matrix: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    matrix[i] = new Array(n).fill(0);
  }
  if (n < 2) return matrix;

  // Standardize features (z-score) to avoid correlated features dominating
  // Bug #3 fix: raw cosine on [0,1]-correlated features made everything similar
  const featKeys = ['energy', 'bassRatio', 'centroidNorm', 'flatness', 'subBassRatio'] as const;
  const featMeans: Record<string, number> = {};
  const featStds: Record<string, number> = {};
  for (const k of featKeys) {
    const vals = segments.map(s => s[k]);
    featMeans[k] = mean(vals);
    featStds[k] = Math.max(1e-6, std(vals, featMeans[k]));
  }

  const getFeat = (s: SegmentFeatures) => featKeys.map(k => (s[k] - featMeans[k]) / featStds[k]);

  // Poids par feature : le TIMBRE (centroid, flatness, bass ratio) domine la
  // détection de répétition ; l'énergie est volontairement sous-pondérée pour
  // que deux occurrences d'un même motif (verse/chorus) se groupent même si
  // leur niveau d'énergie diffère légèrement.
  const weights = [0.5, 1.2, 1.5, 1.3, 1.0]; // energy, bassRatio, centroidNorm, flatness, subBassRatio

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const wsim = weightedCosine(getFeat(segments[i]), getFeat(segments[j]), weights);
      // Clamp to [0, 1]
      const clamped = Math.max(0, Math.min(1, wsim));
      matrix[i][j] = clamped;
      matrix[j][i] = clamped;
    }
  }
  return matrix;
}

/** Similarité cosinus pondérée (les poids accentuent les features timbrales). */
function weightedCosine(a: number[], b: number[], weights: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const w = weights[i] ?? 1;
    dot += w * a[i] * b[i];
    normA += w * a[i] * a[i];
    normB += w * b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

function detectRepeatingPatterns(
  ssm: number[][],
  similarityThreshold: number = 0.7,
): string[] {
  const n = ssm.length;
  if (n < 2) return n === 1 ? ['A'] : [];

  // Seuil ADAPTATIF : une paire est considérée « répétée » si sa similarité
  // dépasse nettement la médiane des similarités hors-diagonale (au lieu d'un
  // seuil absolu fragile qui dépend de l'échelle de la métrique).
  const offDiag: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) offDiag.push(ssm[i][j]);
  }
  const med = offDiag.length > 0 ? median(offDiag) : 0;
  const maxOff = offDiag.length > 0 ? Math.max(...offDiag) : 0;
  // Seuil adaptatif : entre la médiane et le max, mais jamais sous le seuil
  // plancher passé en argument.
  const adaptive = Math.max(similarityThreshold, med + (maxOff - med) * 0.35);

  const visited = new Array(n).fill(false);
  const clusters: number[][] = [];
  let nextLabel = 0;
  const labels = new Array(n).fill('');

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const cluster: number[] = [i];
    visited[i] = true;

    for (let j = i + 1; j < n; j++) {
      if (visited[j]) continue;
      if (ssm[i][j] >= adaptive) {
        let allSimilar = true;
        for (const c of cluster) {
          if (ssm[c][j] < adaptive * 0.8) {
            allSimilar = false;
            break;
          }
        }
        if (allSimilar) {
          cluster.push(j);
          visited[j] = true;
        }
      }
    }

    const labelChar = String.fromCharCode(65 + nextLabel);
    for (const idx of cluster) labels[idx] = labelChar;
    clusters.push(cluster);
    nextLabel++;
  }

  return labels;
}

// ═══════════════════════════════════════════════════════════
// 7. Section classification (spectral + repetition based)
// ═══════════════════════════════════════════════════════════

export interface ClassifiedSection {
  type: TrackSection['type'];
  structuralLabel: string;
  isRepeated: boolean;
  bassDominance: number;
  centroidLevel: number;
}

export function classifySections(
  segments: SegmentFeatures[],
  duration: number,
  structuralLabels: string[],
): ClassifiedSection[] {
  const N = segments.length;
  if (N === 0) return [];

  const result: ClassifiedSection[] = new Array(N).fill(null).map(() => ({
    type: 'unknown' as TrackSection['type'],
    structuralLabel: '',
    isRepeated: false,
    bassDominance: 0,
    centroidLevel: 0,
  }));

  for (let i = 0; i < N; i++) {
    result[i].structuralLabel = structuralLabels[i] || '?';
    result[i].bassDominance = segments[i].bassRatio;
    result[i].centroidLevel = segments[i].centroidNorm;
  }

  const labelCounts = new Map<string, number>();
  for (const l of structuralLabels) {
    labelCounts.set(l, (labelCounts.get(l) || 0) + 1);
  }
  for (let i = 0; i < N; i++) {
    result[i].isRepeated = (labelCounts.get(structuralLabels[i]) || 0) > 1;
  }

  // Énergie globale : référence relative (plus robuste que des seuils absolus).
  const globalMeanEnergy = mean(segments.map(s => s.energy));
  const maxEnergy = Math.max(...segments.map(s => s.energy));
  const energies = segments.map(s => s.energy);
  const energyStd = Math.max(0.01, std(energies, globalMeanEnergy));

  // Indique un pic d'énergie net (par rapport à la variabilité globale).
  const energyZ = (i: number) => (segments[i].energy - globalMeanEnergy) / energyStd;

  // Classe répétée la plus énergique = candidat chorus (plutôt qu'un seuil fixe).
  const maxLabelEnergy = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const l = structuralLabels[i];
    maxLabelEnergy.set(l, Math.max(maxLabelEnergy.get(l) ?? -Infinity, segments[i].energy));
  }
  const repeatedClasses = [...labelCounts.entries()].filter(([, c]) => c > 1);
  const highestRepeatedClass = repeatedClasses
    .reduce<{ label: string; energy: number } | null>((best, [l]) => {
      const e = maxLabelEnergy.get(l) ?? 0;
      if (!best || e > best.energy) return { label: l, energy: e };
      return best;
    }, null);

  // Localise le pic global d'énergie (candidat "drop").
  let dropIdx = -1;
  for (let i = 0; i < N; i++) {
    if (segments[i].energy === maxEnergy) { dropIdx = i; break; }
  }

  for (let i = 0; i < N; i++) {
    const seg = segments[i];
    const midPos = (seg.startT + seg.endT) / 2 / duration;
    const label = structuralLabels[i];
    const isRepeated = result[i].isRepeated;
    const z = energyZ(i);

    // ── Intro : au début du morceau ET énergie nettement basse.
    // On élargit la fenêtre de détection à 25% pour couvrir les intro plus longues.
    const isIntroPos = midPos < 0.25;
    const isIntroEnergy = seg.energy < globalMeanEnergy * 0.85;
    const isIntroZ = z < 0.5;
    if (isIntroPos && isIntroEnergy && isIntroZ) {
      result[i].type = 'intro';
      continue;
    }

    // ── Outro : en fin de morceau ET énergie basse.
    if (midPos > 0.85 && seg.energy < globalMeanEnergy * 0.95 && z < 0.3) {
      result[i].type = 'outro';
      continue;
    }

    // ── Chorus : la classe répétée de plus haute énergie, au-dessus de la moyenne.
    //    (à détecter AVANT le drop : un segment répété et énergique est le
    //     refrain, pas un drop — le drop est un événement non-répété.)
    if (isRepeated && highestRepeatedClass && label === highestRepeatedClass.label && seg.energy >= globalMeanEnergy) {
      result[i].type = 'chorus';
      continue;
    }

    // ── Drop : pic d'énergie net, NON répété, après une montée réelle.
    //    Seuil d'énergie abaissé pour capturer les drops subtils; le contraste
    //    montant est tout de même requis pour éviter les faux positifs.
    const risingBefore = i > 0 && seg.energy > segments[i - 1].energy * 1.1;
    const dropCandidate = !isRepeated && z > 0.8 && risingBefore && seg.energy > globalMeanEnergy * 1.1;
    if (dropCandidate && i > 0 && i < N - 1 && midPos > 0.2 && midPos < 0.85) {
      result[i].type = 'drop';
      continue;
    }

    // ── Build : segment montant juste avant le drop (ou chorus).
    if (i > 0 && i < N - 1) {
      const nextZ = energyZ(i + 1);
      const rising = seg.energy > segments[i - 1].energy;
      if (nextZ > 1.0 && rising && (i + 1 === dropIdx || !result[i].isRepeated)) {
        result[i].type = 'build';
        continue;
      }
    }

    // ── Bridge : non-répété ET énergie contrastée (sous la moyenne).
    if (!isRepeated && seg.energy < globalMeanEnergy * 0.95 && z < 0.3) {
      result[i].type = 'bridge';
      continue;
    }

    // ── Verse : classe(s) répétée(s) d'énergie moyenne/basse (pas le chorus principal).
    if (isRepeated && seg.energy < globalMeanEnergy * 1.1) {
      result[i].type = 'verse';
      continue;
    }

    // ── Repeated but high energy (secondary chorus / pre-chorus) ──
    if (isRepeated) {
      result[i].type = 'chorus';
      continue;
    }

    // ── Non-repeated sections: classify by energy/timbre + position ──
    const relativePos = midPos; // 0.0 to 1.0
    
    // High energy + bright = chorus (anywhere but especially middle)
    const isHighEnergy = seg.energy >= globalMeanEnergy * 1.15;
    const isBright = seg.centroidNorm > 0.55;
    const isBassHeavy = seg.bassRatio > 0.65;
    
    if (isHighEnergy && (isBright || !isBassHeavy)) {
      result[i].type = 'chorus';
    } 
    // Quiet sections = bridge (unless at very end = outro)
    else if (seg.energy < globalMeanEnergy * 0.65) {
      result[i].type = relativePos > 0.85 ? 'outro' : 'bridge';
    }
    // Mid-energy: position-based (verse early, bridge middle, pre-chorus late)
    else {
      if (relativePos < 0.3) {
        result[i].type = 'verse'; // early = verse
      } else if (relativePos > 0.75) {
        result[i].type = seg.energy > globalMeanEnergy ? 'chorus' : 'bridge'; // late = chorus/bridge
      } else {
        result[i].type = 'verse'; // middle = verse
      }
    }
  }

  // ── Stabilisation par label : un motif répété = un rôle de base unique ──
  // Évite les alternances verse/chorus/verse "au hasard" à l'intérieur du même
  // label structurel quand les énergies sont proches du seuil. Seuls les
  // événements (intro/outro/drop/build) peuvent déroger, pas les rôles.
  const labelEnergySum = new Map<string, number>();
  const labelEnergyCnt = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const l = structuralLabels[i] || '?';
    labelEnergySum.set(l, (labelEnergySum.get(l) ?? 0) + segments[i].energy);
    labelEnergyCnt.set(l, (labelEnergyCnt.get(l) ?? 0) + 1);
  }
  const labelRole = new Map<string, 'chorus' | 'verse'>();
  for (const [l, sum] of labelEnergySum) {
    if ((labelCounts.get(l) ?? 0) <= 1) continue;
    const avg = sum / Math.max(1, labelEnergyCnt.get(l) ?? 1);
    // Le label répété dominant ne devient chorus que s'il dépasse vraiment
    // la moyenne ; sinon (ex. un couplet répété sans refrain détecté) il
    // reste couplet. Les autres labels répétés exigent une marge plus nette.
    const isTop = !!highestRepeatedClass && l === highestRepeatedClass.label;
    const thresh = isTop ? 1.02 : 1.10;
    labelRole.set(l, avg >= globalMeanEnergy * thresh ? 'chorus' : 'verse');
  }
  for (let i = 0; i < N; i++) {
    const role = labelRole.get(structuralLabels[i] || '?');
    if (!role) continue;
    const t = result[i].type;
    if (t === 'verse' || t === 'chorus') result[i].type = role;
  }

  // ── Intro FORCÉE : le morceau commence toujours par une intro ──
  // Le 1er segment est l'intro (même s'il est énergique ou répété).
  // Extension uniquement sur les segments contigus de MÊME label, sous la
  // moyenne et dans les premiers 30% / 60s (vraie intro calme prolongée).
  if (N >= 1) {
    result[0].type = 'intro';
    const MAX_FORCED_INTRO_ABS = 60;
    const INTRO_POS_MAX = 0.30;
    const firstSegLabel = structuralLabels[0];
    let introRunEnd = 1;
    for (let i = 1; i < N; i++) {
      const segMid = (segments[i].startT + segments[i].endT) / 2;
      const segPos = segMid / duration;
      if (segPos > INTRO_POS_MAX || segMid >= MAX_FORCED_INTRO_ABS) break;
      if (structuralLabels[i] !== firstSegLabel) break;
      if (segments[i].energy >= globalMeanEnergy) break;
      result[i].type = 'intro';
      introRunEnd = i + 1;
    }
    // Reclassify any later false intros
    for (let i = introRunEnd; i < N; i++) {
      if (result[i].type === 'intro') result[i].type = result[i].isRepeated ? 'verse' : 'bridge';
    }
  }

  // ── Outro FORCÉE : le morceau se termine toujours par une outro ──
  // Le dernier segment est l'outro. Extension vers l'arrière uniquement sur
  // les segments contigus de MÊME label, sous la moyenne, dans les
  // derniers 20% / 60s (vraie sortie calme prolongée).
  if (N > 1) {
    const MAX_FORCED_OUTRO_ABS = 60;
    const OUTRO_POS_MIN = 0.80;
    const lastSegLabel = structuralLabels[N - 1];
    result[N - 1].type = 'outro';
    for (let i = N - 2; i >= 0; i--) {
      const segMid = (segments[i].startT + segments[i].endT) / 2;
      const segPos = segMid / duration;
      if (segPos < OUTRO_POS_MIN || (duration - segMid) >= MAX_FORCED_OUTRO_ABS) break;
      if (structuralLabels[i] !== lastSegLabel) break;
      if (segments[i].energy >= globalMeanEnergy) break;
      result[i].type = 'outro';
    }
  }

  // ── Garde-fou temporel : pas d'outro au milieu de la piste ──
  // (nettoie les faux outros créés par la classification principale)
  let outroRunStart = N;
  for (let j = N - 1; j >= 0; j--) {
    if (result[j].type === 'outro') outroRunStart = j;
    else break;
  }
  for (let i = 0; i < N; i++) {
    if (result[i].type === 'outro' && i < outroRunStart) result[i].type = result[i].isRepeated ? 'verse' : 'bridge';
  }

  // ── Lissage contextuel ──
  // Un drop isolé coincé entre deux chorus n'est pas un drop → chorus.
  for (let i = 0; i < N; i++) {
    if (result[i].type !== 'drop') continue;
    const prev = i > 0 ? result[i - 1].type : null;
    const next = i < N - 1 ? result[i + 1].type : null;
    if (prev === 'chorus' && next === 'chorus') result[i].type = 'chorus';
  }

  // Éliminer les 'unknown' restants par inférence contextuelle.
  for (let i = 0; i < N; i++) {
    if (result[i].type !== 'unknown') continue;
    const prevType = i > 0 ? result[i - 1].type : null;
    const nextType = i < N - 1 ? result[i + 1].type : null;
    if (prevType === 'chorus' || nextType === 'chorus') {
      result[i].type = 'bridge';
    } else {
      result[i].type = 'verse';
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// 8. Multi-band beat tracking with autocorrelation
// ═══════════════════════════════════════════════════════════

/** Fast bass ODF at high rate (50 Hz) using time-domain band energy.
 *  No FFT needed — uses bandEnergy() approximation on raw samples.
 *  This avoids freezing the renderer while giving 5x tempo resolution. */
function computeBassODFFast(data: Float32Array, sampleRate: number, beatRate: number = 50): number[] {
  const hopSize = Math.floor(sampleRate / beatRate);
  const numFrames = Math.floor(data.length / hopSize);
  const odf = new Array(numFrames).fill(0);
  const windowSize = Math.min(2048, hopSize);  // samples per window
  let prevSub = 0, prevBass = 0;
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    const end = Math.min(start + windowSize, data.length);
    if (end - start < 16) continue;
    const samples = data.subarray(start, end);
    // Sub-bass: 20-60 Hz (kick drum), Bass: 60-250 Hz
    const sub = bandEnergy(samples, sampleRate, 20, 60);
    const bass = bandEnergy(samples, sampleRate, 60, 250);
    if (i > 0) {
      const subDiff = Math.max(0, sub - prevSub);
      const bassDiff = Math.max(0, bass - prevBass);
      odf[i] = subDiff * 1.5 + bassDiff * 1.0;
    }
    prevSub = sub;
    prevBass = bass;
  }
  return odf;
}

/** Harmonic sum: reinforces fundamental tempo by summing autocorrelation
 *  at sub-multiples (τ, τ/2, τ/3, τ/4). Standard librosa technique. */function harmonicSum(acorr: number[], lag: number, maxLag: number, K: number = 4): number {
  let sum = 0;
  for (let k = 1; k <= K; k++) {
    const subLag = lag * k;  // librosa: sum multiples of fundamental lag (2×, 3×, 4×)
    if (subLag < 1 || subLag > maxLag) continue;
    // Linear interpolation for non-integer lags
    const lo = Math.floor(subLag);
    const hi = Math.ceil(subLag);
    const frac = subLag - lo;
    const val = (hi <= maxLag && hi !== lo)
      ? acorr[lo] * (1 - frac) + acorr[hi] * frac
      : acorr[lo];
    sum += val / k;  // higher harmonics contribute less
  }
  return sum;
}

/** Smooth ODF librosa-style: max-filter (1 frame) then mean-filter (3 frames).
 *  Reduces noise and produces a cleaner onset envelope for autocorrelation. */
function smoothODF(odf: number[]): number[] {
  const n = odf.length;
  if (n < 3) return odf;
  // Max filter: keep the local maximum within a 1-frame window
  const maxed = new Array(n);
  for (let i = 0; i < n; i++) {
    maxed[i] = Math.max(odf[i], odf[Math.max(0, i - 1)], odf[Math.min(n - 1, i + 1)]);
  }
  // Mean filter: 3-frame moving average
  const smoothed = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    smoothed[i] = (maxed[lo] + maxed[i] + maxed[hi]) / 3;
  }
  return smoothed;
}

function computeOnsetFunction(frames: SpectralFrame[]): number[] {
  const n = frames.length;
  const odf = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    if (!prev || !curr) continue;

    // RMS energy onset: raw volume increase = beat
    const rmsDiff = Math.max(0, curr.rms - prev.rms);

    // Spectral flux from band deltas (normalized) — timbre change detector
    const bandWeights = { sub: 1.5, bass: 1.2, lowMid: 0.8, mid: 0.6, high: 0.4 };
    let flux = 0;
    const bands = ['sub', 'bass', 'lowMid', 'mid', 'high'];
    for (const band of bands) {
      const rawDiff = curr.rawBands[band] - prev.rawBands[band];
      const norm = curr.rawBands[band] + prev.rawBands[band] + 1;
      if (rawDiff > 0) flux += (rawDiff / norm) * bandWeights[band];
    }

    // Blend: RMS onset dominates (70%), spectral flux refines (30%)
    odf[i] = rmsDiff * 0.4 + flux * 0.6; // spectral-flux-weighted: reduces double-time bias
  }

  return odf;
}

function trackBeats(
  odf: number[],
  analysisRate: number,
  _lowCurve: number[],
  _midCurve: number[],
  _highCurve: number[],
  _energyCurve: number[],
  duration: number,
): { beats: number[]; bpm: number; beatStrengths: ('strong' | 'weak')[] } {
  const n = odf.length;
  if (n < 10) return { beats: [], bpm: 120, beatStrengths: [] };
  const rate = analysisRate;

  // ═══════════════════════════════════════════════════════════════
  // BPM DETECTION — Bass ODF autocorrelation + harmonic sum (no prior, data-driven)
  // ═══════════════════════════════════════════════════════════════
  // librosa-style approach (no tempo prior, data-driven):
  // 1. Autocorrelation on smoothed bass-filtered ODF
  // 2. Harmonic sum (K=4) to reinforce fundamental tempo
  // 3. Pick argmax + parabolic interpolation
  //
  // This is fundamentally different from the energy-derivative approach
  // which captures ALL onsets (incl. eighth-notes) and produces octave errors.
  // The ODF weights spectral changes over simple volume changes, and the
  // Restrict search to 50-240 BPM — harmonic sum naturally prefers fundamental tempo.
  //
  // BPM range 50-240 → lag range 0.25-1.2 s at analysisRate samples/sec
  const minBpm = 50, maxBpm = 240;
  const minLag = Math.floor((60 * rate) / maxBpm);
  const maxLag = Math.floor((60 * rate) / minBpm);

  // Autocorrelation on ODF only (onset detection function = spectral flux + RMS blend)
  const acorr = autocorrelation(odf, maxLag + 1);

  // Normalize autocorrelation to [0, 1] so scores are comparable across signals
  let maxAcorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acorr[lag] > maxAcorr) maxAcorr = acorr[lag];
  }
  if (maxAcorr === 0) maxAcorr = 1;

  // No tempo prior — librosa and madmom are purely data-driven.
  // A prior centered at 120 BPM pulls 105 → 119, which is worse, not better.
  // The harmonic sum + bass filter already disambiguate sub-divisions.

  // Score every lag: harmonic sum only (replaces raw autocorrelation × prior)
  let bestLag = minLag;
  let bestScore = -Infinity;
  const debugCandidates: { lag: number; bpm: number; acorr: number; hs: number; norm: number; score: number }[] = [];

  // First pass: compute HS for all lags and find the global maximum
  const hsValues = new Float64Array(maxLag + 1);
  let globalHsMax = 1e-10;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const hs = harmonicSum(acorr, lag, maxLag, 4);
    hsValues[lag] = hs;
    if (hs > globalHsMax) globalHsMax = hs;
  }

  // Second pass: score using properly normalized HS
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * rate / lag;
    const hs = hsValues[lag];
    const norm = hs / globalHsMax; // normalize by global maximum
    const score = norm;

    debugCandidates.push({
      lag, bpm: Math.round(bpm),
      acorr: Number(acorr[lag].toFixed(4)),
      hs: Number(hs.toFixed(4)),
      norm: Number(norm.toFixed(4)),
      score: Number(score.toFixed(4)),
    });

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bestBpm = Math.round(60 * rate / bestLag);

  // ══ Parabolic interpolation: sub-lag BPM precision ══
  // The ODF autocorrelation is sampled at integer lags (e.g., 5 → 120 BPM,
  // 6 → 100 BPM), but the true tempo often falls between two lags
  // (110 BPM → ideal lag ≈ 5.45). This misses the true autocorrelation peak.
  // Parabolic interpolation estimates the continuous peak from 3 adjacent lags.
  if (bestLag > minLag && bestLag < maxLag) {
    // Interpolate on harmonic sum (same function used for scoring), not raw acorr.
    // The raw acorr peak can be at a different lag than the HS peak.
    const a0 = hsValues[bestLag - 1];
    const a1 = hsValues[bestLag];
    const a2 = hsValues[bestLag + 1];
    const denom = 2 * (a0 - 2 * a1 + a2);
    if (Math.abs(denom) > 1e-9 && a1 > 0) {
      const offset = (a0 - a2) / denom;
      // Allow up to 0.95 lag offset: the harmonic sum can place bestLag one slot
      // away from the raw acorr peak. E.g., a 105 BPM track has higher raw acorr
      // at lag=6 (100 BPM) than lag=5 (120 BPM), but harmonic sum favors 120.
      // Parabola through HS[4,5,6] finds the true peak at lag≈5.71 → 105 BPM.
      if (Math.abs(offset) > 0.01 && Math.abs(offset) < 0.95) {
        const refinedLag = bestLag + offset;
        const refinedBpm = Math.round(60 * rate / refinedLag);
        if (refinedBpm >= 50 && refinedBpm <= 240 && refinedBpm !== bestBpm) {
          bestBpm = refinedBpm;
          bestLag = Math.round(refinedLag);
        }
      }
    }
  }

  // ══ Octave correction: check ODF autocorrelation at BPM/2 ══
  // For true double-time (drum & bass, 170+), ODF has almost no correlation at BPM/2.
  // For octave errors (ballad detected at 200), BPM/2 ≈ true tempo → high correlation at half-lag.
  if (bestBpm > 160) {
    const halfBpm = Math.round(bestBpm / 2);
    const halfLag = Math.round((60 * rate) / halfBpm);
    if (halfLag >= minLag && halfLag <= maxLag) {
      const halfNorm = acorr[halfLag] / maxAcorr;
      // Threshold 0.12: if 12%+ of max autocorrelation exists at BPM/2, it's an octave error.
      if (halfNorm > 0.12) {
        bestBpm = halfBpm;
        bestLag = halfLag;
      }
    }
  }

  // ══ Ellis (2007) Dynamic Programming beat tracking ══
  // Reference: "Beat Tracking by Dynamic Programming", JNMR 36(1), 51-60.
  // Same algorithm as librosa.beat.beat_track.
  //
  // Objective: find the sequence of beat times B = {b_1, ..., b_K} that maximizes:
  //   C(B) = Σ onset[b_k] - α * Σ (log((b_k - b_{k-1}) / τ))²
  // where τ = beatPeriod (estimated tempo), α = tightness penalty.
  //
  // DP recurrence:
  //   score[t] = onset[t] + max_{τ' in [τ*0.7, τ*1.5]} (score[t - τ'] - α * log(τ'/τ)²)
  //   back[t] = argmax τ'
  //
  // Then backtrace from the best score in the last ~beatPeriod frames.

  const beatPeriod = bestLag;
  const tightness = 100;  // librosa default (range ~1-1000; higher = stricter timing)
  const minBeatGap = Math.floor(beatPeriod * 0.7);  // 70% of beat period
  const maxBeatGap = Math.floor(beatPeriod * 1.5);  // 150% of beat period

  // Precompute transition penalty lookup: penalty[delta] = tightness * (log(delta/beatPeriod))²
  const penaltyTable = new Float64Array(maxBeatGap + 1);
  for (let delta = 1; delta <= maxBeatGap; delta++) {
    penaltyTable[delta] = tightness * Math.pow(Math.log(delta / beatPeriod), 2);
  }

  // DP arrays
  const dpScore = new Float64Array(n).fill(-Infinity);
  const dpBack = new Int32Array(n).fill(-1);  // previous beat index

  // Initialize: first beat can start anywhere in the first beatPeriod frames
  for (let t = 0; t < Math.min(beatPeriod, n); t++) {
    dpScore[t] = odf[t];
  }

  // Forward pass: for each frame, find the best previous beat
  for (let t = beatPeriod; t < n; t++) {
    let bestPrevScore = -Infinity;
    let bestPrevIdx = -1;
    // Search all valid previous beats (minBeatGap..maxBeatGap frames ago)
    const searchStart = Math.max(0, t - maxBeatGap);
    const searchEnd = t - minBeatGap;
    for (let prev = searchStart; prev <= searchEnd; prev++) {
      if (dpScore[prev] === -Infinity) continue;
      const delta = t - prev;
      const score = dpScore[prev] - penaltyTable[delta];
      if (score > bestPrevScore) {
        bestPrevScore = score;
        bestPrevIdx = prev;
      }
    }
    if (bestPrevIdx >= 0) {
      dpScore[t] = odf[t] + bestPrevScore;
      dpBack[t] = bestPrevIdx;
    }
  }

  // Backtrace: find the best ending frame in the last beatPeriod frames
  let bestEnd = n - 1;
  let bestEndScore = -Infinity;
  const endSearchStart = Math.max(0, n - beatPeriod);
  for (let t = endSearchStart; t < n; t++) {
    if (dpScore[t] > bestEndScore) {
      bestEndScore = dpScore[t];
      bestEnd = t;
    }
  }

  // Walk backwards through the back pointers
  const beatFrames: number[] = [];
  let current = bestEnd;
  while (current >= 0) {
    beatFrames.push(current);
    current = dpBack[current];
  }
  beatFrames.reverse();

  // Convert frame indices to seconds
  const beats: number[] = beatFrames.map(f => r4(f / rate));

  // Beat strengths based on ODF value at each beat
  const beatStrengths: ('strong' | 'weak')[] = [];
  // Compute mean ODF for threshold
  let odfSum = 0;
  for (let i = 0; i < n; i++) odfSum += odf[i];
  const odfMean = odfSum / n;
  for (let i = 0; i < beatFrames.length; i++) {
    const fi = beatFrames[i];
    const isBarStart = i % 4 === 0;  // assume 4/4
    const score2 = odf[fi] * 1.5 + (isBarStart ? 0.5 : 0);
    beatStrengths.push(score2 > odfMean * 1.5 ? 'strong' : 'weak');
  }

  return { beats, bpm: bestBpm, beatStrengths };
}

// ═══════════════════════════════════════════════════════════
// 9. Downbeat detection (spectral accentuation)
// ═══════════════════════════════════════════════════════════

function detectDownbeats(
  beats: number[],
  beatStrengths: ('strong' | 'weak')[],
  frames: SpectralFrame[],
  analysisRate: number,
): number[] {
  if (beats.length < 8) {
    const downbeats: number[] = [];
    for (let i = 0; i < beats.length; i += 4) downbeats.push(beats[i]);
    return downbeats;
  }

  const beatScores: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    const frameIdx = Math.min(frames.length - 1, Math.floor(beats[i] * analysisRate));
    const frame = frames[frameIdx];
    let score = 0;
    if (frame) {
      score += frame.bands.bass * 1.5 + frame.bands.sub * 2.0;
      score += frame.rms * 0.8;
      score += (beatStrengths[i] === 'strong' ? 0.5 : 0);
    }
    beatScores.push(score);
  }

  let bestBarLen = 4;
  let bestScore = -Infinity;

  for (const barLen of [3, 4, 5]) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < beats.length; i += barLen) {
      score += beatScores[i] || 0;
      count++;
    }
    score = count > 0 ? score / count : 0;

    const intervals: number[] = [];
    for (let i = barLen; i < beats.length; i += barLen) {
      intervals.push(beats[i] - beats[i - barLen]);
    }
    let regBonus = 0;
    if (intervals.length > 1) {
      const iMean = mean(intervals);
      const iStd = std(intervals, iMean);
      regBonus = iMean > 0 ? Math.max(0, 1 - iStd / (iMean * 0.3)) : 0;
    }

    score += regBonus * 2;
    if (score > bestScore) {
      bestScore = score;
      bestBarLen = barLen;
    }
  }

  const downbeats: number[] = [];
  for (let i = 0; i < beats.length; i += bestBarLen) {
    downbeats.push(beats[i]);
  }

  return downbeats;
}

// ═══════════════════════════════════════════════════════════
// 10. Genre detection
// ═══════════════════════════════════════════════════════════

function detectGenre(
  energy: number[],
  low: number[],
  mid: number[],
  high: number[],
  bpm: number,
  beats: number[],
  spectralCentroidCurve: number[],
  spectralFluxCurve: number[],
  rmsCurve: number[],
  rawBassRatio: number,
): GenreProfile {
  const n = energy.length;
  const bassRatio = rawBassRatio;
  // Map raw bass ratio (can be 0.1–10+) to [0,1] via tanh so genre bassW values (0.2–0.95) match
  const bassRatioNorm = Math.tanh(bassRatio * 0.45);
  const eMean = mean(energy);
  const eVar = mean(energy.map(v => (v - eMean) ** 2));
  const eVarNorm = Math.min(2, eVar / (eMean * eMean + 0.001));

  const intervals = beats.slice(1).map((b, i) => b - beats[i]);
  const iMeanVal = mean(intervals);
  const beatReg = beats.length > 3
    ? 1 - Math.min(1, Math.sqrt(mean(intervals.map(i => (i - iMeanVal) ** 2))) / (iMeanVal + 0.001))
    : 0.5;

  const avgCentroid = mean(spectralCentroidCurve);
  const avgFlux = mean(spectralFluxCurve);

  // Onset density: count peaks in RMS curve
  let onsetCount = 0;
  for (let i = 2; i < n - 2; i++) {
    if (rmsCurve[i] > rmsCurve[i-1] && rmsCurve[i] > rmsCurve[i-2] &&
        rmsCurve[i] >= rmsCurve[i+1] && rmsCurve[i] >= rmsCurve[i+2] && rmsCurve[i] > 0.3) onsetCount++;
  }
  const onsetDensity = onsetCount / Math.max(1, n);

  // Energy envelope: calc shape features
  const third = Math.floor(n / 3);
  const firstThirdE = mean(energy.slice(0, third));
  const lastThirdE = mean(energy.slice(2 * third));
  const energyGrowth = lastThirdE > 0 ? (lastThirdE - firstThirdE) / lastThirdE : 0;
  const energyPersistence = mean(energy.slice(Math.floor(n * 0.25), Math.floor(n * 0.75)));

  // Sub-bass ratio (20-60Hz)
  const subBassRatio = mean(low.map(v => Math.min(1, v * 1.8)));

  // Harmonicity proxy: lower centroid + lower flux → more tonal
  const harmonicityScore = 1 - (avgCentroid * 0.5 + avgFlux * 0.5);

  // Detailed genre profiles with 7 dimensions each
  interface GenreDef { genre: string; label: string; desc: string; bMin: number; bMax: number; bassW: number; centroidW: number; onsetW: number; evarW: number; bregW: number; harmonicW: number; subBassW: number; energyGrowthW: number; pal: string; }
  const genres: GenreDef[] = [
    // --- Slow / Emotional ---
    { genre: 'ballad', label: 'Ballade', desc: 'Lente, émotionnelle, piano/voix', bMin: 55, bMax: 90, bassW: 0.3, centroidW: 0.35, onsetW: 0.1, evarW: 0.9, bregW: 0.15, harmonicW: 0.85, subBassW: 0.2, energyGrowthW: 0.1, pal: 'warm' },
    { genre: 'rnb', label: 'R&B', desc: 'Soul, groove modéré', bMin: 65, bMax: 100, bassW: 0.7, centroidW: 0.4, onsetW: 0.35, evarW: 0.5, bregW: 0.65, harmonicW: 0.7, subBassW: 0.5, energyGrowthW: 0.05, pal: 'warm' },

    // --- Mid-tempo / Groove ---
    { genre: 'hiphop', label: 'Hip-Hop', desc: 'Basses lourdes, trap/boom-bap', bMin: 65, bMax: 105, bassW: 0.95, centroidW: 0.25, onsetW: 0.4, evarW: 0.4, bregW: 0.55, harmonicW: 0.2, subBassW: 0.9, energyGrowthW: 0.0, pal: 'warm' },
    { genre: 'reggaeton', label: 'Reggaeton', desc: 'Dembow, latin urbain', bMin: 85, bMax: 105, bassW: 0.8, centroidW: 0.35, onsetW: 0.6, evarW: 0.3, bregW: 0.9, harmonicW: 0.3, subBassW: 0.75, energyGrowthW: 0.0, pal: 'reggaeton' },
    { genre: 'latin_pop', label: 'Latino/Pop', desc: 'Pop latin, reggaeton-pop', bMin: 85, bMax: 115, bassW: 0.65, centroidW: 0.5, onsetW: 0.5, evarW: 0.5, bregW: 0.7, harmonicW: 0.55, subBassW: 0.55, energyGrowthW: 0.1, pal: 'latino' },

    // --- Energetic / Dance ---
    { genre: 'disco', label: 'Disco', desc: 'Groovy, dansant, funk-disco', bMin: 110, bMax: 135, bassW: 0.65, centroidW: 0.5, onsetW: 0.55, evarW: 0.35, bregW: 0.8, harmonicW: 0.5, subBassW: 0.5, energyGrowthW: 0.05, pal: 'party' },
    { genre: 'dance', label: 'Dance', desc: 'Club, EDM commercial', bMin: 118, bMax: 140, bassW: 0.7, centroidW: 0.6, onsetW: 0.55, evarW: 0.45, bregW: 0.85, harmonicW: 0.35, subBassW: 0.55, energyGrowthW: 0.1, pal: 'dance' },
    { genre: 'electro', label: 'Electro', desc: 'Synthétique, moderne', bMin: 120, bMax: 140, bassW: 0.55, centroidW: 0.7, onsetW: 0.45, evarW: 0.35, bregW: 0.8, harmonicW: 0.25, subBassW: 0.45, energyGrowthW: 0.1, pal: 'electro' },
    { genre: 'house', label: 'House', desc: '4/4 kick, deep/progressive', bMin: 118, bMax: 130, bassW: 0.6, centroidW: 0.55, onsetW: 0.5, evarW: 0.25, bregW: 0.95, harmonicW: 0.3, subBassW: 0.6, energyGrowthW: 0.2, pal: 'house' },
    { genre: 'techno', label: 'Techno', desc: 'Industriel, hypnotique', bMin: 125, bMax: 150, bassW: 0.75, centroidW: 0.65, onsetW: 0.4, evarW: 0.15, bregW: 1.0, harmonicW: 0.1, subBassW: 0.7, energyGrowthW: 0.05, pal: 'techno' },
    { genre: 'trance', label: 'Trance', desc: 'Melodic, arpeggiated, progressive', bMin: 125, bMax: 150, bassW: 0.5, centroidW: 0.6, onsetW: 0.3, evarW: 0.2, bregW: 0.8, harmonicW: 0.3, subBassW: 0.4, energyGrowthW: 0.1, pal: 'techno' },
    { genre: 'dubstep', label: 'Dubstep', desc: 'Wobble bass, half-time feel', bMin: 135, bMax: 155, bassW: 0.9, centroidW: 0.55, onsetW: 0.3, evarW: 0.6, bregW: 0.5, harmonicW: 0.1, subBassW: 0.95, energyGrowthW: 0.1, pal: 'dubstep' },
    { genre: 'drum_and_bass', label: 'Drum & Bass', desc: 'Breakbeats rapides, bass', bMin: 160, bMax: 185, bassW: 0.75, centroidW: 0.6, onsetW: 0.7, evarW: 0.5, bregW: 0.6, harmonicW: 0.2, subBassW: 0.7, energyGrowthW: 0.05, pal: 'cool' },

    // --- Rock / Guitar ---
    { genre: 'rock', label: 'Rock', desc: 'Guitares, batterie live', bMin: 75, bMax: 150, bassW: 0.45, centroidW: 0.5, onsetW: 0.65, evarW: 0.75, bregW: 0.35, harmonicW: 0.4, subBassW: 0.3, energyGrowthW: 0.05, pal: 'rock' },
    { genre: 'metal', label: 'Metal', desc: 'Lourd, agressif, double pédale', bMin: 80, bMax: 180, bassW: 0.55, centroidW: 0.55, onsetW: 0.8, evarW: 0.85, bregW: 0.3, harmonicW: 0.15, subBassW: 0.4, energyGrowthW: 0.05, pal: 'monochrome' },

    // --- Funk / Soul ---
    { genre: 'funk', label: 'Funk', desc: 'Groovy, syncopé, slap bass', bMin: 90, bMax: 120, bassW: 0.6, centroidW: 0.5, onsetW: 0.7, evarW: 0.55, bregW: 0.55, harmonicW: 0.4, subBassW: 0.4, energyGrowthW: 0.05, pal: 'party' },
    { genre: 'jazz', label: 'Jazz', desc: 'Improvisation, swing', bMin: 60, bMax: 160, bassW: 0.35, centroidW: 0.45, onsetW: 0.4, evarW: 0.65, bregW: 0.2, harmonicW: 0.7, subBassW: 0.3, energyGrowthW: 0.05, pal: 'cool' },
  ];

  let best = genres[0];
  let bestScore = -Infinity;
  const allScores: { genre: string; total: number; bpmS: number; bassS: number; evarS: number; bregS: number; centroidS: number; onsetS: number; harmonicS: number; subBassS: number; growthS: number }[] = [];
  for (const g of genres) {
    const bpmRange = g.bMax - g.bMin;
    const bpmS = bpm >= g.bMin && bpm <= g.bMax
      ? 1.0
      : Math.max(0, 1 - Math.min(Math.abs(bpm - g.bMin), Math.abs(bpm - g.bMax)) / Math.max(bpmRange * 0.25, 5));
    const bassS = 1 - Math.abs(bassRatioNorm - g.bassW);
    const evarS = 1 - Math.abs(eVarNorm - g.evarW);
    const bregS = 1 - Math.abs(beatReg - g.bregW);
    const centroidS = 1 - Math.abs(avgCentroid - g.centroidW);
    const onsetS = 1 - Math.abs(onsetDensity - g.onsetW);
    const harmonicS = 1 - Math.abs(harmonicityScore - g.harmonicW);
    const subBassS = 1 - Math.abs(subBassRatio - g.subBassW);
    const growthS = 1 - Math.abs(energyGrowth - g.energyGrowthW);

    const score = bpmS * 0.18 + bassS * 0.15 + evarS * 0.10 + bregS * 0.12 +
                  centroidS * 0.12 + onsetS * 0.10 + harmonicS * 0.08 +
                  subBassS * 0.08 + growthS * 0.07;
    allScores.push({ genre: g.genre, total: score, bpmS, bassS, evarS, bregS, centroidS, onsetS, harmonicS, subBassS, growthS });
    if (score > bestScore) { bestScore = score; best = g; }
  }

  // Debug: log top 3 genre scores
  return {
    ...best,
    confidence: Math.round(Math.min(100, Math.max(25, bestScore * 100))),
    bpm,
    palette: best.pal,
    description: best.desc,
  };
}

// ═══════════════════════════════════════════════════════════
// 11. Key detection (Krumhansl-Schmuckler)
// ═══════════════════════════════════════════════════════════

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const KEY_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function detectKey(data: Float32Array, sampleRate: number): { key: string; confidence: number; isMinor: boolean } {
  const chroma = new Float32Array(12);
  const hopSize = Math.floor(sampleRate / 10);
  const fftSize = 2048;

  for (let offset = 0; offset + fftSize <= data.length; offset += hopSize) {
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = data[offset + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }
    fftInPlace(real, imag);
    const binFreq = sampleRate / fftSize;
    for (let i = 1; i < fftSize / 2; i++) {
      const freq = i * binFreq;
      if (freq < 80 || freq > 4000) continue;
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      const midiNote = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midiNote) % 12) + 12) % 12;
      chroma[pc] += mag;
    }
  }

  const maxC = Math.max(...chroma, 0.0001);
  const normChroma = Array.from(chroma).map(v => v / maxC);

  let bestKey = 'C', bestScore = -Infinity, bestIsMinor = false;
  for (let root = 0; root < 12; root++) {
    for (const [prof, isMin] of [[KK_MAJOR, false], [KK_MINOR, true]] as const) {
      let dot = 0;
      for (let i = 0; i < 12; i++) {
        dot += normChroma[i] * prof[(i - root + 12) % 12];
      }
      if (dot > bestScore) { bestScore = dot; bestKey = isMin ? KEY_LABELS[root] + 'm' : KEY_LABELS[root]; bestIsMinor = isMin; }
    }
  }

  const confidence = Math.round(Math.min(100, Math.max(15, (bestScore / 28) * 100)));
  return { key: bestKey, confidence, isMinor: bestIsMinor };
}

// ═══════════════════════════════════════════════════════════
// 12. Per-section spectral analysis
// ═══════════════════════════════════════════════════════════

const SPECTRAL_HOP_RATE = 10;
const RMS_RESAMPLE_POINTS = 20;

function resampleArray(arr: number[], targetLen: number): number[] {
  if (arr.length <= targetLen) return [...arr];
  const result: number[] = [];
  const step = (arr.length - 1) / (targetLen - 1);
  for (let i = 0; i < targetLen; i++) {
    const idx = i * step;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, arr.length - 1);
    const frac = idx - lo;
    result.push(r4(arr[lo] * (1 - frac) + arr[hi] * frac));
  }
  return result;
}

function findSpectralPeaks(mag: Float32Array, binFreq: number, minFreq: number, maxFreq: number): number[] {
  let meanVal = 0, count = 0;
  for (let i = 2; i < mag.length - 2; i++) { meanVal += mag[i]; count++; }
  meanVal /= count;
  let stdVal = 0;
  for (let i = 2; i < mag.length - 2; i++) { stdVal += (mag[i] - meanVal) ** 2; }
  stdVal = Math.sqrt(stdVal / count);
  const threshold = meanVal + stdVal * 0.5;

  const peaks: number[] = [];
  for (let i = 2; i < mag.length - 2; i++) {
    const freq = i * binFreq;
    if (freq < minFreq || freq > maxFreq) continue;
    if (mag[i] > threshold && mag[i] > mag[i - 1] && mag[i] > mag[i - 2] &&
        mag[i] > mag[i + 1] && mag[i] > mag[i + 2]) {
      peaks.push(freq);
    }
  }
  return peaks;
}

interface FrameFeatures {
  rms: number;
  centroid: number;
  spread: number;
  flatness: number;
  rolloff: number;
  subBassRatio: number;
  bassRatio: number;
  harmonicRatio: number;
  dissonance: number;
}

function analyzeFrame(data: Float32Array, offset: number, fftSize: number, sampleRate: number, binFreq: number): FrameFeatures {
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  let sumSq = 0;
  for (let i = 0; i < fftSize; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
    const sample = data[offset + i] * w;
    real[i] = sample;
    sumSq += sample * sample;
  }
  fftInPlace(real, imag);
  const mag = new Float32Array(fftSize / 2);
  for (let i = 1; i < fftSize / 2; i++) {
    mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }

  let cNum = 0, cDen = 0;
  for (let i = 1; i < fftSize / 2; i++) {
    const freq = i * binFreq;
    if (freq < 80 || freq > 12000) continue;
    cNum += freq * mag[i]; cDen += mag[i];
  }
  const centroid = cDen > 0 ? Math.min(1, Math.max(0, (cNum / cDen - 80) / 7920)) : 0;

  let sNum = 0, sDen = 0;
  for (let i = 1; i < fftSize / 2; i++) {
    const freq = i * binFreq;
    if (freq < 80 || freq > 12000) continue;
    sNum += Math.pow(freq - cNum / Math.max(1, cDen), 2) * mag[i]; sDen += mag[i];
  }
  const spread = sDen > 0 ? Math.min(1, Math.sqrt(sNum / sDen) / 8000) : 0;

  let gMean = 0, aMean = 0, cnt = 0;
  for (let i = 1; i < fftSize / 2; i++) {
    const freq = i * binFreq;
    if (freq < 80 || freq > 12000) continue;
    const v = Math.max(1e-10, mag[i]); gMean += Math.log(v); aMean += v; cnt++;
  }
  const flatness = cnt > 0 ? Math.min(1, Math.exp(gMean / cnt) / (aMean / cnt + 1e-10)) : 0;

  let totalMag = 0;
  for (let i = 1; i < fftSize / 2; i++) { const freq = i * binFreq; if (freq < 80 || freq > 12000) continue; totalMag += mag[i]; }
  let cumSum = 0, rolloffBin = fftSize / 2 - 1;
  for (let i = 1; i < fftSize / 2; i++) {
    const freq = i * binFreq; if (freq < 80 || freq > 12000) continue;
    cumSum += mag[i];
    if (cumSum >= 0.85 * totalMag) { rolloffBin = i; break; }
  }
  const rolloff = rolloffBin < fftSize / 2 ? Math.min(1, (rolloffBin * binFreq - 80) / 7920) : 0.5;

  let subBassE = 0, bassE = 0, lowE = 0, midE = 0;
  for (let i = 1; i < fftSize / 2; i++) {
    const freq = i * binFreq;
    if (freq < 20 || freq > 12000) continue;
    if (freq < 60) subBassE += mag[i];
    if (freq >= 60 && freq < 250) bassE += mag[i];
    if (freq >= 250 && freq < 2000) lowE += mag[i];
    if (freq >= 2000 && freq < 8000) midE += mag[i];
  }
  const totalE = Math.max(1e-6, subBassE + bassE + lowE + midE);
  const subBassRatio = subBassE / totalE;
  const bassRatioNum = (subBassE + bassE) / totalE;

  const peaks = findSpectralPeaks(mag, binFreq, 80, 4000);
  const harmonicRatio = peaks.length > 0
    ? Math.min(1, peaks.filter((_, i) => i < peaks.length - 1 && peaks[i + 1] / Math.max(1, peaks[i]) < 1.03).length / peaks.length)
    : 0;

  const roughness = peaks.length > 1
    ? Math.min(1, mean(peaks.slice(1).map((f, i) => {
        const df = f - peaks[i];
        return df > 5 && df < 120 ? 1 - Math.abs(df - 40) / 80 : 0;
      })))
    : 0;

  return {
    rms: Math.sqrt(sumSq / fftSize), centroid, spread, flatness, rolloff,
    subBassRatio, bassRatio: bassRatioNum, harmonicRatio, dissonance: roughness,
  };
}

function analyzeSections(
  buffer: AudioBuffer,
  sections: TrackSection[],
  beats: number[],
  onsets: number[],
): SectionAnalysis[] {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const fftSize = FFT_SIZE;
  const hopSize = Math.floor(sampleRate / SPECTRAL_HOP_RATE);
  const binFreq = sampleRate / fftSize;

  const results: SectionAnalysis[] = [];
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si];
    const startSample = Math.floor(s.startTime * sampleRate);
    const endSample = Math.floor(s.endTime * sampleRate);
    const nFramesSec = Math.floor((endSample - startSample) / hopSize);
    if (nFramesSec < 2) continue;

    const frameFeats: FrameFeatures[] = [];
    for (let f = 0; f < nFramesSec && startSample + f * hopSize + fftSize <= data.length; f++) {
      frameFeats.push(analyzeFrame(data, startSample + f * hopSize, fftSize, sampleRate, binFreq));
    }
    if (frameFeats.length < 2) continue;

    const rmsVals = frameFeats.map(f => f.rms);
    const centroids = frameFeats.map(f => f.centroid);
    const spreads = frameFeats.map(f => f.spread);
    const flatnesses = frameFeats.map(f => f.flatness);
    const rolloffs = frameFeats.map(f => f.rolloff);
    const subBassRatios = frameFeats.map(f => f.subBassRatio);
    const bassRatios = frameFeats.map(f => f.bassRatio);
    const harmonicRatios = frameFeats.map(f => f.harmonicRatio);
    const dissonances = frameFeats.map(f => f.dissonance);

    const rmsMeanVal = mean(rmsVals);
    const rmsVar = mean(rmsVals.map(v => (v - rmsMeanVal) ** 2));

    const onsetCount = onsets.filter(o => o >= s.startTime && o < s.endTime).length;
    const onsetDen = sectionDur(s) > 0 ? onsetCount / sectionDur(s) : 0;

    const sectionOnsets = onsets.filter(o => o >= s.startTime && o < s.endTime);
    let onsetReg = 0;
    if (sectionOnsets.length > 2) {
      const intervals = sectionOnsets.slice(1).map((o, i) => o - sectionOnsets[i]);
      const iMn = mean(intervals);
      onsetReg = iMn > 0 ? 1 - Math.min(1, Math.sqrt(mean(intervals.map(i => (i - iMn) ** 2))) / iMn) : 0;
    }

    let trend: EnergyTrend = 'stable';
    if (rmsVals.length > 5) {
      const first3 = mean(rmsVals.slice(0, 3));
      const last3 = mean(rmsVals.slice(-3));
      const diff = last3 - first3;
      const maxV = Math.max(...rmsVals);
      const relMax = maxV > 0 ? Math.max(...rmsVals.slice(rmsVals.length - Math.floor(rmsVals.length / 3))) / maxV : 0;
      if (diff > 0.02) trend = 'rising';
      else if (diff < -0.02) trend = 'falling';
      else if (relMax > 0.9) trend = 'peak';
      else if (relMax < 0.3) trend = 'valley';
    }

    const energyCurveHalf = rmsVals.length > 4
      ? mean(rmsVals.slice(0, Math.floor(rmsVals.length / 2)))
      : rmsMeanVal;
    const energyCurveLastQuarter = rmsVals.length > 4
      ? mean(rmsVals.slice(-Math.floor(rmsVals.length / 4)))
      : rmsMeanVal;
    const isBuildUp = energyCurveLastQuarter > energyCurveHalf * 1.3;

    const isDrop = s.type === 'drop' || (rmsVar < 0.02 && rmsMeanVal > 0.3);

    const rmsCurve = resampleArray(rmsVals, RMS_RESAMPLE_POINTS);

    results.push({
      sectionIndex: si,
      sectionType: s.type,
      startTime: s.startTime, endTime: s.endTime,
      rmsMean: r4(rmsMeanVal), rmsVariance: r4(rmsVar),
      rmsCurve: rmsCurve.map(r4),
      spectralCentroid: r4(mean(centroids)),
      spectralSpread: r4(mean(spreads)),
      spectralFlatness: r4(mean(flatnesses)),
      spectralRolloff: r4(mean(rolloffs)),
      subBassRatio: r4(mean(subBassRatios)),
      bassRatio: r4(mean(bassRatios)),
      harmonicRatio: r4(mean(harmonicRatios)),
      dissonanceLevel: r4(mean(dissonances)),
      onsetDensity: r4(onsetDen),
      onsetRegularity: r4(onsetReg),
      energyTrend: trend,
      isBuildUp,
      isBreakdown: rmsMeanVal < 0.15 && onsetDen < 1,
      isDrop,
    });
  }
  return results;
}

function sectionDur(s: TrackSection): number { return s.endTime - s.startTime; }

// ═══════════════════════════════════════════════════════════
// 13. Atmosphere classification
// ═══════════════════════════════════════════════════════════

function classifyAtmosphere(sectionAnalyses: SectionAnalysis[], bpm: number): AtmosphereType {
  if (sectionAnalyses.length === 0) return 'energetic';
  const n = sectionAnalyses.length;
  let avgRms = 0, avgCentroid = 0, avgFlatness = 0, avgBass = 0, avgHarmonic = 0, avgDissonance = 0, avgOnsetDensity = 0, avgOnsetRegularity = 0;
  let riseCount = 0, peakCount = 0, breakdownCount = 0;
  for (const sa of sectionAnalyses) {
    avgRms += sa.rmsMean; avgCentroid += sa.spectralCentroid; avgFlatness += sa.spectralFlatness;
    avgBass += sa.bassRatio; avgHarmonic += sa.harmonicRatio; avgDissonance += sa.dissonanceLevel;
    avgOnsetDensity += sa.onsetDensity; avgOnsetRegularity += sa.onsetRegularity;
    if (sa.energyTrend === 'rising') riseCount++;
    if (sa.energyTrend === 'peak') peakCount++;
    if (sa.isBreakdown) breakdownCount++;
  }
  avgRms /= n; avgCentroid /= n; avgFlatness /= n; avgBass /= n; avgHarmonic /= n; avgDissonance /= n;
  avgOnsetDensity /= n; avgOnsetRegularity /= n;

  const scores: { atmo: AtmosphereType; score: number }[] = [];

  scores.push({
    atmo: 'energetic',
    score: avgRms * 0.3 + avgOnsetDensity * 0.25 + avgCentroid * 0.2 + (bpm > 100 && bpm < 145 ? 0.15 : 0) + (peakCount / n) * 0.1,
  });
  scores.push({
    atmo: 'dark',
    score: avgBass * 0.3 + avgDissonance * 0.25 + (1 - avgCentroid) * 0.2 + (bpm < 110 ? 0.15 : 0) + avgFlatness * 0.1,
  });
  scores.push({
    atmo: 'uplifting',
    score: avgCentroid * 0.3 + (1 - avgBass) * 0.2 + (riseCount / n) * 0.25 + (avgRms > 0.3 ? 0.15 : 0) + avgHarmonic * 0.1,
  });
  scores.push({
    atmo: 'dreamy',
    score: avgFlatness * 0.25 + (1 - avgOnsetDensity) * 0.2 + avgHarmonic * 0.2 + (avgRms < 0.3 ? 0.15 : 0) + (1 - avgDissonance) * 0.2,
  });
  scores.push({
    atmo: 'aggressive',
    score: avgDissonance * 0.3 + avgOnsetDensity * 0.25 + (bpm > 120 ? 0.15 : 0) + avgRms * 0.15 + (peakCount / n) * 0.15,
  });
  scores.push({
    atmo: 'groovy',
    score: avgOnsetRegularity * 0.25 + (1 - Math.abs(avgRms - 0.5)) * 0.2 + avgBass * 0.2 + (1 - Math.abs(avgCentroid - 0.5)) * 0.15 + avgOnsetDensity * 0.1 + (bpm > 90 && bpm < 135 ? 0.1 : 0),
  });
  scores.push({
    atmo: 'epic',
    score: avgRms * 0.25 + avgHarmonic * 0.25 + (riseCount / n) * 0.2 + avgCentroid * 0.15 + (peakCount / n) * 0.15,
  });

  scores.sort((a, b) => b.score - a.score);
  return scores[0].atmo;
}

// ═══════════════════════════════════════════════════════════
// 14. MAIN: analyzeAudioBuffer — entry point
// ═══════════════════════════════════════════════════════════

// Debug flag — set to true to log analysis pipeline
const DEBUG_ANALYSIS = true;

function dlog(...args: unknown[]) {
  if (DEBUG_ANALYSIS) console.log('[ANALYSIS]', ...args);
}

/** Yield to the event loop so the renderer watchdog can ping the main process.
 *  Without this, long synchronous analysis blocks the watchdog → FAIL-SAFE BLACKOUT. */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function analyzeAudioBuffer(
  buffer: AudioBuffer,
  fileName: string,
  fileSize: number,
): Promise<TrackAnalysis> {
  const duration = buffer.duration;
  const sampleRate = buffer.sampleRate;
  const data = buffer.getChannelData(0);

  const analysisRate = 10;  // 10 Hz for spectral analysis (FFT-based, heavier)
  const hopSize = Math.floor(sampleRate / analysisRate);
  const numFrames = Math.floor(data.length / hopSize);

  // ══ Phase A: Per-frame spectral analysis (FFT at 10 Hz) ══
  const spectralFrames: SpectralFrame[] = [];
  const energyCurve: number[] = [];
  const lowCurve: number[] = []
  const midCurve: number[] = [];
  const highCurve: number[] = [];
  // Raw magnitude curves for rhythm tracking (not normalized — pulses with beats)
  const rawLowCurve: number[] = [];
  const rawHighCurve: number[] = [];
  const waveform: number[] = [];
  const spectralCentroidCurve: number[] = [];
  const spectralFluxCurveRaw: number[] = [];
  const rmsCurveRaw: number[] = [];

  let prevMag: Float32Array | null = null;

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;

    // Yield every 200 frames (~20s at 10 Hz) so the watchdog can ping
    if (frame > 0 && frame % 200 === 0) await yieldToEventLoop();

    const sframe = computeSpectralFrame(data, start, FFT_SIZE, sampleRate);
    if (sframe) {
      spectralFrames.push(sframe);
      energyCurve.push(sframe.rms);
      lowCurve.push(sframe.rawBands.bass + sframe.rawBands.sub * 0.5);
      midCurve.push(sframe.rawBands.lowMid + sframe.rawBands.mid * 0.6);
      highCurve.push(sframe.rawBands.high);
      spectralCentroidCurve.push(r4(Math.min(1, Math.max(0, (sframe.centroid - 80) / 7920))));
      rmsCurveRaw.push(sframe.rms);
      // Waveform peak from time domain chunk
      const chunk = data.slice(start, Math.min(start + hopSize, data.length));
      let peak = 0;
      for (let i = 0; i < chunk.length; i++) { const a = Math.abs(chunk[i]); if (a > peak) peak = a; }
      waveform.push(peak);

      if (prevMag) {
        spectralFluxCurveRaw.push(spectralFlux(prevMag, sframe.mag));
      } else {
        spectralFluxCurveRaw.push(0);
      }
      prevMag = sframe.mag;
    } else {
      const last = spectralFrames[spectralFrames.length - 1];
      spectralFrames.push(last);
      energyCurve.push(last?.rms ?? energyCurve[energyCurve.length - 1] ?? 0);
      lowCurve.push(lowCurve[lowCurve.length - 1] ?? 0);
      midCurve.push(midCurve[midCurve.length - 1] ?? 0);
      highCurve.push(highCurve[highCurve.length - 1] ?? 0);
      spectralCentroidCurve.push(spectralCentroidCurve[spectralCentroidCurve.length - 1] || 0);
      spectralFluxCurveRaw.push(0);
      rmsCurveRaw.push(rmsCurveRaw[rmsCurveRaw.length - 1] || 0);
    }
  }

  const normEnergy = normalize(energyCurve);
  const normLow = normalize(lowCurve);
  const normMid = normalize(midCurve);
  const normHigh = normalize(highCurve);
  const spectralFluxCurve = normalize(spectralFluxCurveRaw);

  // Bass ratio from RAW data (before independent normalization destroys band relationships)
  const rawBassRatio = lowCurve.length > 0
    ? lowCurve.reduce((s, v, i) => s + v / (midCurve[i] + highCurve[i] + 0.001), 0) / lowCurve.length
    : 0.5;
  const rmsCurve = normalize(rmsCurveRaw);

  await yieldToEventLoop();

  // ══ Phase B: Novelty curve & section boundaries ══
  const noveltyCurve = computeNoveltyCurve(spectralFrames);
  dlog('noveltyCurve:', noveltyCurve.length, 'pts, max=', Math.max(...noveltyCurve).toFixed(3));
  
  // Dynamic minSectionSec: vise 8-12 sections musicales (phrases ~15-30s),
  // avec une durée mini ~9-12s pour éviter les micro-sections de 6-7s.
  const targetSections = Math.max(8, Math.min(12, Math.floor(duration / 20)));
  const avgSectionSec = duration / targetSections;
  const dynamicMinSectionSec = Math.max(9, Math.min(12, avgSectionSec / 2));
  dlog('targetSections:', targetSections, 'avgSectionSec:', avgSectionSec.toFixed(1), 'minSectionSec:', dynamicMinSectionSec.toFixed(1));
  const boundaries = detectSectionBoundaries(noveltyCurve, normEnergy, normLow, spectralCentroidCurve, analysisRate, duration, dynamicMinSectionSec);
  dlog('boundaries (initial):', boundaries.map(b => r4(b / analysisRate)), '→', boundaries.length - 1, 'sections');

  // Fallback: si trop peu de frontières, réessaie avec 6s mini (reste musical).
  if (boundaries.length < 5) {
    const fallbackBoundaries = detectSectionBoundaries(noveltyCurve, normEnergy, normLow, spectralCentroidCurve, analysisRate, duration, 6);
    if (fallbackBoundaries.length > boundaries.length) {
      boundaries.splice(0, boundaries.length, ...fallbackBoundaries);
      dlog('boundaries (fallback):', fallbackBoundaries.map(b => r4(b / analysisRate)), '→', fallbackBoundaries.length - 1, 'sections');
    }
  }

  // ══ Phase C: Build segments with spectral features ══
  // Bug #6 fix: extract real spectral flatness curve from spectralFrames
  // Bug #7 fix: extract subBass from rawBands.sub (independent from normLow)
  const spectralFlatnessCurve: number[] = [];
  const subBassRawCurve: number[] = [];
  for (const sf of spectralFrames) {
    spectralFlatnessCurve.push(sf.flatness);
    subBassRawCurve.push(sf.rawBands.sub);
  }
  const normSubBass = normalize(subBassRawCurve);

  const segments: SegmentFeatures[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const sf = boundaries[i];
    const ef = boundaries[i + 1];
    if (ef <= sf) continue;

    const segE = normEnergy.slice(sf, ef);
    const segBass = normLow.slice(sf, ef);
    const segCentroids = spectralCentroidCurve.slice(sf, ef);
    const segFlatness = spectralFlatnessCurve.slice(sf, ef);
    const segSubBass = normSubBass.slice(sf, ef);

    const avgE = segE.length > 0 ? r4(mean(segE)) : 0;
    const avgBassRatio = segE.length > 0
      ? r4(mean(segBass.map((v: number, j: number) => v / (normMid[j + sf] + normHigh[j + sf] + 0.001))))
      : 0;
    const avgCentroid = segCentroids.length > 0 ? r4(mean(segCentroids)) : 0;
    const avgFlatness = segFlatness.length > 0 ? r4(mean(segFlatness)) : 0;
    const avgSubBass = segSubBass.length > 0 ? r4(mean(segSubBass)) : 0;

    segments.push({
      startF: sf, endF: ef,
      startT: r4(sf / analysisRate),
      endT: Math.min(duration, r4(ef / analysisRate)),
      energy: avgE,
      bassRatio: avgBassRatio,
      centroidNorm: avgCentroid,
      flatness: avgFlatness,
      subBassRatio: avgSubBass,
    });
  }

  if (segments.length === 0) {
    segments.push({
      startF: 0, endF: Math.max(0, Math.floor(data.length / hopSize) - 1),
      startT: 0, endT: duration,
      energy: r4(mean(normEnergy)),
      bassRatio: 0.5,
      centroidNorm: r4(mean(spectralCentroidCurve)),
      flatness: 0.5,
      subBassRatio: 0.3,
    });
  }

  await yieldToEventLoop();

  // ══ Phase D: Beat tracking FIRST (needed for section alignment) ══
  // Bass ODF at 50 Hz using fast time-domain band energy
  const beatRate = 50;
  const bassOdf = smoothODF(computeBassODFFast(data, sampleRate, beatRate));

  const { beats, bpm, beatStrengths } = trackBeats(bassOdf, beatRate, normLow, normMid, normHigh, energyCurve, duration);

  const nFrames = Math.floor(data.length / hopSize);
  const downbeats = detectDownbeats(beats, beatStrengths, spectralFrames, analysisRate);
  dlog('beats:', beats.length, 'bpm:', bpm, 'downbeats:', downbeats.length);

  // ══ Phase E: Self-similarity matrix & pattern detection ══
  const ssm = computeSegmentSimilarityMatrix(segments);
  // Lower threshold (0.55) + adaptive: more discriminating for fine-grained structure
  const structuralLabels = detectRepeatingPatterns(ssm, 0.55);
  dlog('structuralLabels:', structuralLabels, 'unique:', new Set(structuralLabels).size);
  
  // Debug: if all same label, force differentiation by energy peaks
  const uniqueLabels = new Set(structuralLabels);
  if (uniqueLabels.size === 1 && segments.length > 3) {
    // Re-label by energy: high energy = B, low = A, medium = C
    const energies = segments.map(s => s.energy);
    const maxE = Math.max(...energies);
    const minE = Math.min(...energies);
    const midE = (maxE + minE) / 2;
    for (let i = 0; i < structuralLabels.length; i++) {
      if (energies[i] > midE * 1.1) structuralLabels[i] = 'B';
      else if (energies[i] < midE * 0.9) structuralLabels[i] = 'A';
      else structuralLabels[i] = 'C';
    }
    dlog('structuralLabels (relabelled):', structuralLabels);
  }

  // ══ Phase F: Align section boundaries to downbeats ══
  // Snap les FRONTIÈRES partagées (pas chaque segment indépendamment) pour
  // garantir des sections contiguës, monotones, sans chevauchement ni trou.
  const MIN_SNAP_GAP = 4; // secondes mini entre deux frontières snappées
  const rawBoundsSec = boundaries.map(b => r4(b / analysisRate));
  const snappedBounds: number[] = [];
  let prevB = -Infinity;
  for (let bi = 0; bi < rawBoundsSec.length; bi++) {
    const t = rawBoundsSec[bi];
    // Première frontière = 0, dernière = duration (pas de snap).
    if (bi === 0) { snappedBounds.push(0); prevB = 0; continue; }
    if (bi === rawBoundsSec.length - 1) { snappedBounds.push(r4(duration)); prevB = duration; continue; }
    let best = t;
    let bestD = Infinity;
    for (const db of downbeats) {
      const d = Math.abs(db - t);
      if (d < bestD && d <= 2.0) { bestD = d; best = db; }
    }
    // Monotonie + gap mini : sinon on garde la valeur d'origine repoussée.
    if (best <= prevB + MIN_SNAP_GAP) best = Math.max(t, prevB + MIN_SNAP_GAP);
    if (best >= duration) best = duration;
    best = r4(best);
    snappedBounds.push(best);
    prevB = best;
  }
  const alignedSegments: SegmentFeatures[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const startT = snappedBounds[i] ?? seg.startT;
    const endT = Math.min(duration, snappedBounds[i + 1] ?? seg.endT);
    alignedSegments.push({ ...seg, startT, endT });
  }
  dlog('alignedBounds:', snappedBounds);
  dlog('alignedSegments:', alignedSegments.map(s => `${r4(s.startT)}-${r4(s.endT)}`));

  // ══ Phase G: Classify sections (spectral + repetition) ══
  const classified = classifySections(alignedSegments, duration, structuralLabels);
  dlog('classified:', classified.map(c => `${c.type} (rep=${c.isRepeated}, label=${c.structuralLabel})`));

  // ══ Phase H: Merge adjacent same-type sections ══
  // Fusionne les voisins de même type quand ils partagent le même label,
  // OU quand le bloc fusionné reste court (< 24s) : évite les fragments
  // verse,verse / chorus,chorus qui font "hasard".
  const maxMergeDuration = duration * 0.20;
  const mergedTypes: TrackSection['type'][] = [classified[0]?.type || 'unknown'];
  const mergedSegs: SegmentFeatures[] = [alignedSegments[0]];
  const mergedLabels: string[] = [structuralLabels[0] || '?'];

  for (let i = 1; i < classified.length; i++) {
    const wouldBeDuration = alignedSegments[i].endT - mergedSegs[mergedSegs.length - 1].startT;
    const sameType = classified[i].type === mergedTypes[mergedTypes.length - 1];
    const sameLabel = structuralLabels[i] === mergedLabels[mergedLabels.length - 1];
    // Intro/outro ne fusionnent qu'entre elles quand c'est le même motif
    // (évite intro+intro ou outro+outro fragmentés, sans absorber les voisins).
    const boundaryType = classified[i].type === 'intro' || classified[i].type === 'outro'
      || mergedTypes[mergedTypes.length - 1] === 'intro' || mergedTypes[mergedTypes.length - 1] === 'outro';
    if (sameType && (sameLabel || (!boundaryType && wouldBeDuration < 24)) && wouldBeDuration < maxMergeDuration) {
      mergedSegs[mergedSegs.length - 1] = {
        ...mergedSegs[mergedSegs.length - 1],
        endF: alignedSegments[i].endF,
        endT: alignedSegments[i].endT,
        energy: r4((mergedSegs[mergedSegs.length - 1].energy + alignedSegments[i].energy) / 2),
      };
    } else {
      mergedTypes.push(classified[i].type);
      mergedSegs.push(alignedSegments[i]);
      mergedLabels.push(structuralLabels[i] || '?');
    }
  }
  dlog('merged:', mergedTypes, '→', mergedTypes.length, 'sections');

  // ══ Phase I: Build output sections ══
  const sections: TrackSection[] = [];
  for (let si = 0; si < mergedSegs.length; si++) {
    const seg = mergedSegs[si];
    sections.push({
      type: mergedTypes[si],
      startTime: seg.startT,
      endTime: seg.endT,
      energy: seg.energy,
      color: SECTION_COLORS[mergedTypes[si]],
    });
  }

  await yieldToEventLoop();

// ══ Phase J: Onset detection (multi-band flux) ══
  const onsets: number[] = [];
  for (let i = 3; i < nFrames; i++) {
    const flux = Math.max(0, normEnergy[i] - normEnergy[i - 1]) * 0.4 +
                 Math.max(0, normLow[i] - normLow[i - 1]) * 0.35 +
                 Math.max(0, normMid[i] - normMid[i - 1]) * 0.15 +
                 Math.max(0, normHigh[i] - normHigh[i - 1]) * 0.1;
    if (flux > mean(normEnergy.slice(Math.max(0, i - 10), i)) * 0.8) {
      onsets.push(i / analysisRate);
    }
  }

  const onsetCurve: number[] = new Array(nFrames).fill(0);
  for (const t of onsets) {
    const fi = Math.floor(t * analysisRate);
    if (fi < nFrames) onsetCurve[fi] = 1;
  }

  // ══ Phase K: Vocal curve ══
  const vocalCurve: number[] = [];
  for (let frame = 0; frame < nFrames; frame++) {
    const a = normLow[frame] + normMid[frame] + normHigh[frame];
    const g = Math.cbrt(
      Math.max(0.0001, normLow[frame]) *
      Math.max(0.0001, normMid[frame]) *
      Math.max(0.0001, normHigh[frame]),
    );
    vocalCurve.push(Math.min(1, g / (a / 3 + 0.001)));
  }

  // ══ Phase L: Genre, key, section analysis, atmosphere ══
  const genre = detectGenre(normEnergy, normLow, normMid, normHigh, bpm, beats, spectralCentroidCurve, spectralFluxCurve, rmsCurve, rawBassRatio);

  await yieldToEventLoop();

  const keyResult = detectKey(data, sampleRate);
  const sectionAnalyses = analyzeSections(buffer, sections, beats, onsets);
  const atmosphere = classifyAtmosphere(sectionAnalyses, bpm);

  return {
    duration, sampleRate, bpm,
    beats, beatPositions: beats, beatStrengths, downbeats,
    sections,
    energyCurve: normEnergy,
    lowCurve: normLow,
    midCurve: normMid,
    highCurve: normHigh,
    waveform,
    fileName, fileSize,
    genre: JSON.stringify(genre),
    key: keyResult.key,
    vocalCurve, onsetCurve,
    sectionAnalyses,
    atmosphere,
    spectralCentroidCurve,
    spectralFluxCurve,
    rmsCurve,
    noveltyCurve,
    sectionLabels: mergedLabels,
  };
}
