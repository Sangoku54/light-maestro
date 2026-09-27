/**
 * Audio Analyzer — Real-time beat detection & frequency analysis
 *
 * Audio-reactive lighting automation.
 * This engine provides:
 * - Real-time beat/BPM detection (onset detection algorithm)
 * - Frequency band analysis (low/mid/high — stems-style breakdown)
 * - Track structure detection (intro, verse, chorus, drop, outro)
 * - Energy level tracking for dynamic light intensity
 *
 * The actual audio buffer capture happens in the renderer process
 * via Web Audio API. This module processes received buffers.
 */

export interface AudioAnalysis {
  timestamp: number;
  // Beat detection
  beat: boolean;
  beatConfidence: number;   // 0-1
  bpm: number;
  beatPhase: number;        // 0-1, position within beat
  // Frequency bands
  lowEnergy: number;        // 20-250 Hz (bass)
  midEnergy: number;        // 250-4000 Hz (vocals, instruments)
  highEnergy: number;       // 4000-20000 Hz (cymbals, hats)
  // Overall energy
  totalEnergy: number;      // 0-1
  // Track structure
  section: 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'outro' | 'unknown';
  sectionChange: boolean;
  // Stem-style analysis
  drums: number;            // 0-1, transient density
  vocals: number;           // 0-1, mid-range melodic content
  harmonic: number;         // 0-1, harmonic richness
}

interface AnalysisConfig {
  beatThreshold: number;     // Onset detection threshold
  beatMinInterval: number;   // Min ms between beats
  bpmSmoothing: number;      // EMA smoothing for BPM
  historySize: number;       // Frames kept for section analysis
}

const DEFAULT_CONFIG: AnalysisConfig = {
  beatThreshold: 0.15,
  beatMinInterval: 120,      // ~500 BPM max
  bpmSmoothing: 0.3,
  historySize: 150,          // ~10s at 60fps analysis
};

export class AudioAnalyzer {
  private config: AnalysisConfig;
  private energyHistory: number[] = [];
  private beatHistory: number[] = [];
  private lastBeatTime: number = 0;
  private currentBpm: number = 0;
  private sectionEnergyProfile: number[] = [];
  private sectionChangeCounter: number = 0;
  private latest: AudioAnalysis;

  // Section detection state
  private sectionHistory: string[] = [];
  private sectionDuration: number = 0;

  constructor(config: Partial<AnalysisConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.latest = this.createEmptyAnalysis();
  }

  private createEmptyAnalysis(): AudioAnalysis {
    return {
      timestamp: Date.now(),
      beat: false,
      beatConfidence: 0,
      bpm: 0,
      beatPhase: 0,
      lowEnergy: 0,
      midEnergy: 0,
      highEnergy: 0,
      totalEnergy: 0,
      section: 'unknown',
      sectionChange: false,
      drums: 0,
      vocals: 0,
      harmonic: 0,
    };
  }

  // ─── Audio Device Enumeration ────────────────────────────

  async getDevices(): Promise<MediaDeviceInfo[]> {
    // This runs in main process but relies on renderer
    // In practice, devices are enumerated in renderer via Web Audio
    return [];
  }

  async startCapture(_deviceId: string): Promise<void> {
    // Renderer starts Web Audio capture
  }

  async stopCapture(): Promise<void> {
    this.energyHistory = [];
    this.beatHistory = [];
    this.sectionEnergyProfile = [];
    this.sectionHistory = [];
  }

  // ─── Core Analysis Pipeline ──────────────────────────────

  /**
   * Process a raw audio buffer from the renderer.
   * Called ~60 times/sec with the latest FFT data.
   */
  processBuffer(buffer: Float32Array): AudioAnalysis {
    const now = Date.now();

    // --- Frequency Band Analysis ---
    // Simulate stems: split spectrum into 3 bands
    const binCount = buffer.length;
    const lowBins = Math.floor(binCount * 0.06);   // ~0-250Hz
    const midBins = Math.floor(binCount * 0.4);     // ~250-4000Hz
    const highBins = binCount;                        // ~4000-20000Hz

    let lowSum = 0, midSum = 0, highSum = 0;
    for (let i = 0; i < binCount; i++) {
      const abs = Math.abs(buffer[i]);
      if (i < lowBins) lowSum += abs;
      else if (i < midBins) midSum += abs;
      else highSum += abs;
    }

    const lowEnergy = lowSum / lowBins;
    const midEnergy = midSum / (midBins - lowBins);
    const highEnergy = highSum / (highBins - midBins);
    const totalEnergy = (lowEnergy + midEnergy + highEnergy) / 3;

    // --- Beat Detection (Onset Detection) ---
    // Based on spectral flux: sudden increase in energy
    this.energyHistory.push(totalEnergy);
    if (this.energyHistory.length > this.config.historySize) {
      this.energyHistory.shift();
    }

    const beatResult = this.detectBeat(totalEnergy, now);

    // --- BPM Estimation ---
    if (beatResult.beat) {
      this.beatHistory.push(now);
      if (this.beatHistory.length > 48) this.beatHistory.shift(); // Keep last 48 beats
      this.currentBpm = this.estimateBpm();
    }

    // --- Track Section Detection ---
    this.sectionEnergyProfile.push(totalEnergy);
    if (this.sectionEnergyProfile.length > this.config.historySize) {
      this.sectionEnergyProfile.shift();
    }

    const sectionResult = this.detectSection(totalEnergy, lowEnergy, midEnergy, highEnergy);

    // --- Stem-style Analysis ---
    const drums = this.detectDrums(lowEnergy, beatResult.beat);
    const vocals = this.detectVocals(midEnergy);
    const harmonic = this.detectHarmonics(midEnergy, highEnergy);

    this.latest = {
      timestamp: now,
      beat: beatResult.beat,
      beatConfidence: beatResult.confidence,
      bpm: this.currentBpm,
      beatPhase: beatResult.phase,
      lowEnergy,
      midEnergy,
      highEnergy,
      totalEnergy,
      section: sectionResult.section,
      sectionChange: sectionResult.changed,
      drums,
      vocals,
      harmonic,
    };

    return this.latest;
  }

  getLatestAnalysis(): AudioAnalysis {
    return this.latest;
  }

  // ─── Beat Detection Algorithm ────────────────────────────
  // Spectral-flux onset detection with adaptive threshold

  private detectBeat(energy: number, now: number): { beat: boolean; confidence: number; phase: number } {
    const historyLen = this.energyHistory.length;
    if (historyLen < 5) return { beat: false, confidence: 0, phase: 0 };

    // Compute local average energy (last 43 frames = ~700ms)
    const windowSize = Math.min(43, historyLen - 1);
    const recent = this.energyHistory.slice(-windowSize - 1, -1);
    const localAvg = recent.reduce((a, b) => a + b, 0) / recent.length;

    // Compute spectral flux: difference from local average
    const flux = energy - localAvg;
    const threshold = this.config.beatThreshold * (1 + localAvg);

    // Adaptive threshold: increase after recent beat
    const timeSinceLastBeat = now - this.lastBeatTime;
    const adaptiveThreshold = threshold * (1 + Math.exp(-timeSinceLastBeat / 200));

    const beat = flux > adaptiveThreshold && timeSinceLastBeat > this.config.beatMinInterval;
    const confidence = Math.min(1, flux / (adaptiveThreshold * 2));

    // Beat phase (0-1 position within current beat interval)
    let phase = 0;
    if (this.currentBpm > 0) {
      const beatInterval = 60000 / this.currentBpm;
      phase = Math.min(1, timeSinceLastBeat / beatInterval);
    }

    if (beat) {
      this.lastBeatTime = now;
    }

    return { beat, confidence, phase };
  }

  // ─── BPM Estimation ──────────────────────────────────────
  // Auto-correlation of inter-beat intervals

  private estimateBpm(): number {
    if (this.beatHistory.length < 3) return this.currentBpm;

    // Compute inter-beat intervals
    const intervals: number[] = [];
    for (let i = 1; i < this.beatHistory.length; i++) {
      intervals.push(this.beatHistory[i] - this.beatHistory[i - 1]);
    }

    // Remove outliers (intervals > 2x median)
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const filtered = intervals.filter(i => i > median * 0.5 && i < median * 2);

    if (filtered.length === 0) return this.currentBpm;

    // Average interval → BPM
    const avgInterval = filtered.reduce((a, b) => a + b, 0) / filtered.length;
    const rawBpm = 60000 / avgInterval;

    // Clamp to reasonable BPM range
    const clamped = Math.max(60, Math.min(200, rawBpm));

    // EMA smoothing
    if (this.currentBpm === 0) {
      return clamped;
    }
    return this.currentBpm * (1 - this.config.bpmSmoothing) + clamped * this.config.bpmSmoothing;
  }

  // ─── Track Section Detection ─────────────────────────────
  // Detect intro, verse, chorus, drop, outro

  private detectSection(energy: number, low: number, mid: number, high: number): { section: AudioAnalysis['section']; changed: boolean } {
    if (this.sectionEnergyProfile.length < 50) {
      return { section: 'intro', changed: false };
    }

    // Compute rolling statistics
    const recent = this.sectionEnergyProfile.slice(-50);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min || 0.001;

    // Energy trend (slope over last 20 frames)
    const last20 = recent.slice(-20);
    const prev20 = recent.slice(-40, -20);
    const last20avg = last20.reduce((a, b) => a + b, 0) / 20;
    const prev20avg = prev20.reduce((a, b) => a + b, 0) / 20;
    const trend = (last20avg - prev20avg) / range;

    // Bass-to-mid ratio (high bass = drop/chorus)
    const bassRatio = low / (mid + high + 0.001);

    let section: AudioAnalysis['section'];

    if (energy < avg * 0.3) {
      section = 'outro';
    } else if (energy < avg * 0.5 && trend < 0) {
      section = 'bridge';
    } else if (trend > 0.15 && energy < avg * 0.7) {
      section = 'intro';
    } else if (energy > avg * 1.2 || bassRatio > 1.5) {
      section = 'drop';
    } else if (energy > avg * 1.05) {
      section = 'chorus';
    } else {
      section = 'verse';
    }

    // Detect section change
    this.sectionHistory.push(section);
    if (this.sectionHistory.length > 8) this.sectionHistory.shift();

    const lastSection = this.sectionHistory[this.sectionHistory.length - 2] || 'unknown';
    const changed = section !== lastSection;

    return { section, changed };
  }

  // ─── Stem Detection ──────────────────────────────────────

  private detectDrums(lowEnergy: number, isBeat: boolean): number {
    // Drum detection: transient peaks in low frequencies
    const drumScore = lowEnergy * 2 * (isBeat ? 1.5 : 0.5);
    return Math.min(1, drumScore);
  }

  private detectVocals(midEnergy: number): number {
    // Vocal detection: sustained mid-frequency energy
    return Math.min(1, midEnergy * 3);
  }

  private detectHarmonics(midEnergy: number, highEnergy: number): number {
    // Harmonic richness: balance of mid and high frequencies
    return Math.min(1, (midEnergy * 0.7 + highEnergy * 0.3) * 2);
  }
}
