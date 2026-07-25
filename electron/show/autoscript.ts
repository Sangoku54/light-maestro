/**
 * AutoScript Engine — SoundSwitch-style automatic light show generation
 *
 * This is the core innovation from SoundSwitch: automatically generate
 * lighting cues and effects based on real-time audio analysis.
 *
 * The engine combines:
 * - Beat-synced effects (SoundSwitch)
 * - RGB Matrix patterns (QLC+)
 * - Dynamic intensity from energy levels
 * - Section-aware effect selection
 * - Stem-reactive color palettes
 */

import { AudioAnalysis } from '../audio/analyzer';

export interface AutoScriptConfig {
  enabled: boolean;
  // Effect selection
  intensity: 'low' | 'medium' | 'high' | 'dynamic'; // dynamic = follows audio energy
  colorScheme: 'warm' | 'cool' | 'party' | 'auto' | 'monochrome';
  movementStyle: 'smooth' | 'sharp' | 'dynamic';
  // Beat sync
  beatSync: boolean;
  beatDivision: 1 | 2 | 4 | 8; // Effects change every N beats
  // Section reactions
  sectionAware: boolean;  // Different effects per song section
  // Stem reactions
  drumReactive: boolean;  // Bass/kick reactive intensity
  vocalReactive: boolean; // Vocal-reactive colors
  // Safety
  strobeLimit: number;    // Max strobe speed (Hz)
  maxBrightness: number;  // Global brightness cap 0-255
}

export interface AutoScriptState {
  masterIntensity: number;      // 0-255
  colorPalette: number[][];     // Array of [R,G,B] colors
  activeEffect: string;         // Current effect ID
  effectIntensity: number;      // 0-1
  strobeRate: number;           // Hz
  panPosition: number;          // 0-255
  tiltPosition: number;         // 0-255
  movementSpeed: number;        // 0-1
}

export type EffectCategory = 
  | 'ambient'    // Slow, atmospheric
  | 'build'      // Rising energy
  | 'peak'       // High energy drops
  | 'breakdown'  // Low energy sections
  | 'fill'       // Transitions between sections
  | 'strobe'     // Fast rhythmic effects
  | 'chase'      // Sequential patterns
  | 'wave';      // Flowing movements

interface AutoEffect {
  id: string;
  name: string;
  category: EffectCategory;
  beatDivision: number;
  minBpm: number;
  maxBpm: number;
  // How this effect modifies DMX output
  generate: (state: AutoScriptState, analysis: AudioAnalysis, fixtures: number) => EffectOutput;
}

export interface EffectOutput {
  channels: Record<number, number>; // absolute channel → value
  colors: number[][];               // colors per fixture
  intensities: number[];            // intensity per fixture
  panTilt: Array<[number, number]>; // [pan, tilt] per fixture
  strobe: number[];                 // strobe rate per fixture (0 = off)
}

const DEFAULT_CONFIG: AutoScriptConfig = {
  enabled: false,
  intensity: 'dynamic',
  colorScheme: 'auto',
  movementStyle: 'dynamic',
  beatSync: true,
  beatDivision: 2,
  sectionAware: true,
  drumReactive: true,
  vocalReactive: true,
  strobeLimit: 10,
  maxBrightness: 255,
};

// ─── Color Palettes ────────────────────────────────────────

const COLOR_PALETTES: Record<string, number[][]> = {
  warm: [[255,80,0], [255,140,0], [255,200,50], [255,60,20], [200,40,0]],
  cool: [[0,100,255], [0,200,200], [100,0,255], [0,150,255], [50,50,200]],
  party: [[255,0,100], [0,255,100], [100,0,255], [255,200,0], [0,200,255]],
  monochrome: [[255,255,255], [200,200,200], [150,150,150], [100,100,100], [50,50,50]],
  auto: [[255,0,0], [0,255,0], [0,0,255], [255,255,0], [255,0,255], [0,255,255]],
};

// ─── Section-based Effect Selection ────────────────────────

const SECTION_EFFECTS: Record<string, EffectCategory[]> = {
  intro: ['ambient', 'wave'],
  verse: ['ambient', 'chase', 'wave'],
  chorus: ['chase', 'fill', 'peak'],
  drop: ['peak', 'strobe', 'chase'],
  bridge: ['ambient', 'breakdown', 'build'],
  outro: ['ambient', 'breakdown'],
};

export class AutoScriptEngine {
  config: AutoScriptConfig;
  state: AutoScriptState;
  private effects: Map<string, AutoEffect> = new Map();
  private beatCount: number = 0;
  private currentCategory: EffectCategory = 'ambient';
  private lastEffectChange: number = 0;

  constructor(config: Partial<AutoScriptConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.createInitialState();
    this.registerBuiltInEffects();
  }

  private createInitialState(): AutoScriptState {
    return {
      masterIntensity: 128,
      colorPalette: COLOR_PALETTES.auto,
      activeEffect: 'color-wave',
      effectIntensity: 0.5,
      strobeRate: 0,
      panPosition: 128,
      tiltPosition: 128,
      movementSpeed: 0.5,
    };
  }

  // ─── Main Update Loop ────────────────────────────────────
  // Called every frame with latest audio analysis

  update(analysis: AudioAnalysis): AutoScriptState {
    if (!this.config.enabled) return this.state;

    // 1. Master intensity from energy
    if (this.config.intensity === 'dynamic') {
      this.state.masterIntensity = Math.round(
        analysis.totalEnergy * 255 * (this.config.maxBrightness / 255)
      );
    }

    // 2. Beat tracking
    if (analysis.beat) {
      this.beatCount++;
    }

    // 3. Section-based effect selection
    if (this.config.sectionAware && analysis.sectionChange) {
      this.selectEffectForSection(analysis.section);
    }

    // 4. Beat-synced effect changes
    if (this.config.beatSync && analysis.beat &&
        this.beatCount % this.config.beatDivision === 0) {
      this.advanceEffect(analysis);
    }

    // 5. Color palette from audio or scheme
    if (this.config.colorScheme === 'auto') {
      this.state.colorPalette = this.audioReactivePalette(analysis);
    } else {
      this.state.colorPalette = COLOR_PALETTES[this.config.colorScheme] || COLOR_PALETTES.auto;
    }

    // 6. Stem-reactive parameters
    if (this.config.drumReactive) {
      this.state.effectIntensity = analysis.drums;
      this.state.strobeRate = analysis.drums > 0.7
        ? Math.min(this.config.strobeLimit, analysis.drums * 15)
        : 0;
    }

    if (this.config.vocalReactive) {
      this.state.movementSpeed = 0.1 + analysis.vocals * 0.9;
    }

    // 7. Movement from audio
    this.state.panPosition = Math.round(128 + Math.sin(analysis.beatPhase * Math.PI * 2) * 127);
    this.state.tiltPosition = Math.round(128 + Math.cos(analysis.beatPhase * Math.PI * 1.5) * 127);

    return this.state;
  }

  // ─── Generate DMX Output ─────────────────────────────────

  generateOutput(analysis: AudioAnalysis, fixtureCount: number): EffectOutput {
    const effect = this.effects.get(this.state.activeEffect);
    if (!effect) {
      return this.generateDefaultOutput(fixtureCount);
    }
    return effect.generate(this.state, analysis, fixtureCount);
  }

  private generateDefaultOutput(fixtureCount: number): EffectOutput {
    const intensities = Array(fixtureCount).fill(this.state.masterIntensity);
    const colors = Array(fixtureCount).fill([255, 255, 255]);
    const panTilt: Array<[number, number]> = Array(fixtureCount).fill([128, 128]);
    const strobe = Array(fixtureCount).fill(0);

    return {
      channels: {},
      colors,
      intensities,
      panTilt,
      strobe,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────

  private selectEffectForSection(section: string): void {
    const categories = SECTION_EFFECTS[section] || ['ambient'];
    const category = categories[Math.floor(Math.random() * categories.length)];
    this.currentCategory = category;

    const effectsInCategory = Array.from(this.effects.values())
      .filter(e => e.category === category);
    if (effectsInCategory.length > 0) {
      const effect = effectsInCategory[Math.floor(Math.random() * effectsInCategory.length)];
      this.state.activeEffect = effect.id;
      this.lastEffectChange = Date.now();
    }
  }

  private advanceEffect(analysis: AudioAnalysis): void {
    // Rotate through effects in current category for variety
    const effectsInCategory = Array.from(this.effects.values())
      .filter(e => e.category === this.currentCategory);

    if (effectsInCategory.length <= 1) return;

    const currentIndex = effectsInCategory.findIndex(e => e.id === this.state.activeEffect);
    const nextIndex = (currentIndex + 1) % effectsInCategory.length;
    this.state.activeEffect = effectsInCategory[nextIndex].id;
    this.lastEffectChange = Date.now();
  }

  private audioReactivePalette(analysis: AudioAnalysis): number[][] {
    // Map frequency content to colors
    const r = Math.round(analysis.lowEnergy * 255);
    const g = Math.round(analysis.midEnergy * 255);
    const b = Math.round(analysis.highEnergy * 255);

    return [
      [r, g, b],
      [r, Math.round(g * 0.7), Math.round(b * 0.5)],
      [Math.round(r * 0.5), g, Math.round(b * 0.7)],
      [Math.round(r * 0.7), Math.round(g * 0.5), b],
      [Math.round(r * 0.8), Math.round(g * 0.8), Math.round(b * 0.8)],
    ];
  }

  // ─── Built-in Effects ────────────────────────────────────

  private registerBuiltInEffects(): void {
    // Color Wave — smooth color transitions across fixtures
    this.effects.set('color-wave', {
      id: 'color-wave',
      name: 'Color Wave',
      category: 'wave',
      beatDivision: 4,
      minBpm: 60,
      maxBpm: 180,
      generate: (state, analysis, fixtureCount) => {
        const colors: number[][] = [];
        const intensities: number[] = [];
        const panTilt: Array<[number, number]> = [];

        for (let i = 0; i < fixtureCount; i++) {
          const paletteIdx = Math.floor(
            (i / fixtureCount + analysis.beatPhase) * state.colorPalette.length
          ) % state.colorPalette.length;
          colors.push(state.colorPalette[paletteIdx]);
          intensities.push(state.masterIntensity);
          panTilt.push([128, 128]);
        }

        return {
          channels: {},
          colors,
          intensities,
          panTilt,
          strobe: Array(fixtureCount).fill(0),
        };
      },
    });

    // Strobe Blast — high-energy strobe effect
    this.effects.set('strobe-blast', {
      id: 'strobe-blast',
      name: 'Strobe Blast',
      category: 'strobe',
      beatDivision: 1,
      minBpm: 100,
      maxBpm: 200,
      generate: (state, analysis, _count) => {
        const strobeOn = analysis.beat;
        const intensities = Array(_count).fill(strobeOn ? state.masterIntensity : 0);
        const colors = Array(_count).fill([255, 255, 255]);

        return {
          channels: {},
          colors,
          intensities,
          panTilt: Array(_count).fill([128, 128]),
          strobe: Array(_count).fill(strobeOn ? 15 : 0),
        };
      },
    });

    // Chase Sequence — sequential fixture activation
    this.effects.set('chase-sequence', {
      id: 'chase-sequence',
      name: 'Chase Sequence',
      category: 'chase',
      beatDivision: 1,
      minBpm: 60,
      maxBpm: 200,
      generate: (state, analysis, fixtureCount) => {
        const chaseStep = Math.floor(analysis.beatPhase * fixtureCount);
        const intensities = Array(fixtureCount).fill(0);
        const colors: number[][] = Array(fixtureCount).fill([0, 0, 0]);

        for (let i = 0; i < fixtureCount; i++) {
          if (i === chaseStep) {
            intensities[i] = state.masterIntensity;
            colors[i] = state.colorPalette[i % state.colorPalette.length];
          }
        }

        return {
          channels: {},
          colors,
          intensities,
          panTilt: Array(fixtureCount).fill([128, 128]),
          strobe: Array(fixtureCount).fill(0),
        };
      },
    });

    // Dimmer Pulse — smooth brightness oscillation
    this.effects.set('dimmer-pulse', {
      id: 'dimmer-pulse',
      name: 'Dimmer Pulse',
      category: 'ambient',
      beatDivision: 2,
      minBpm: 60,
      maxBpm: 140,
      generate: (state, analysis, fixtureCount) => {
        const pulse = 0.5 + Math.sin(analysis.beatPhase * Math.PI * 2) * 0.5;
        const intensity = Math.round(state.masterIntensity * pulse);
        const intensities = Array(fixtureCount).fill(intensity);
        const colors = Array(fixtureCount).fill(state.colorPalette[0]);

        return {
          channels: {},
          colors,
          intensities,
          panTilt: Array(fixtureCount).fill([128, 128]),
          strobe: Array(fixtureCount).fill(0),
        };
      },
    });

    // Pan Sweep — moving head sweep synchronized to audio
    this.effects.set('pan-sweep', {
      id: 'pan-sweep',
      name: 'Pan Sweep',
      category: 'fill',
      beatDivision: 4,
      minBpm: 60,
      maxBpm: 160,
      generate: (state, analysis, fixtureCount) => {
        const colors: number[][] = [];
        const intensities: number[] = [];
        const panTilt: Array<[number, number]> = [];

        for (let i = 0; i < fixtureCount; i++) {
          const offset = i / fixtureCount;
          const pan = Math.round(128 + Math.sin((analysis.beatPhase + offset) * Math.PI * 2) * 127);
          colors.push(state.colorPalette[i % state.colorPalette.length]);
          intensities.push(state.masterIntensity);
          panTilt.push([pan, 128]);
        }

        return {
          channels: {},
          colors,
          intensities,
          panTilt,
          strobe: Array(fixtureCount).fill(0),
        };
      },
    });

    // Build Up — rising intensity effect for transitions
    this.effects.set('build-up', {
      id: 'build-up',
      name: 'Build Up',
      category: 'build',
      beatDivision: 8,
      minBpm: 60,
      maxBpm: 140,
      generate: (state, analysis, fixtureCount) => {
        const buildProgress = analysis.beatPhase;
        const intensity = Math.round(state.masterIntensity * buildProgress);
        const colors = Array(fixtureCount).fill(
          buildProgress > 0.8 ? [255, 255, 255] : state.colorPalette[0]
        );

        return {
          channels: {},
          colors,
          intensities: Array(fixtureCount).fill(intensity),
          panTilt: Array(fixtureCount).fill([128, 128]),
          strobe: Array(fixtureCount).fill(buildProgress > 0.9 ? 10 : 0),
        };
      },
    });

    // Breakdown — sparse, moody lighting
    this.effects.set('breakdown', {
      id: 'breakdown',
      name: 'Breakdown',
      category: 'breakdown',
      beatDivision: 4,
      minBpm: 60,
      maxBpm: 120,
      generate: (state, _analysis, fixtureCount) => {
        // Only light every other fixture
        const colors: number[][] = [];
        const intensities: number[] = [];
        for (let i = 0; i < fixtureCount; i++) {
          colors.push(state.colorPalette[0]);
          intensities.push(i % 2 === 0 ? Math.round(state.masterIntensity * 0.4) : 0);
        }

        return {
          channels: {},
          colors,
          intensities,
          panTilt: Array(fixtureCount).fill([128, 128]),
          strobe: Array(fixtureCount).fill(0),
        };
      },
    });

    // Peak Drop — maximum impact effect
    this.effects.set('peak-drop', {
      id: 'peak-drop',
      name: 'Peak Drop',
      category: 'peak',
      beatDivision: 1,
      minBpm: 100,
      maxBpm: 200,
      generate: (state, analysis, fixtureCount) => {
        const colors: number[][] = [];
        const intensities: number[] = [];
        const panTilt: Array<[number, number]> = [];

        for (let i = 0; i < fixtureCount; i++) {
          // Rapid color cycling on beat
          const colorIdx = (this.beatCount + i) % state.colorPalette.length;
          colors.push(state.colorPalette[colorIdx]);
          intensities.push(state.masterIntensity);

          // Wide pan sweep
          const pan = Math.round(128 + Math.sin(analysis.beatPhase * Math.PI * 2 + i) * 127);
          panTilt.push([pan, 128 + Math.round(Math.sin(analysis.beatPhase * 3) * 63)]);
        }

        return {
          channels: {},
          colors,
          intensities,
          panTilt,
          strobe: Array(fixtureCount).fill(analysis.beat ? 10 : 0),
        };
      },
    });
  }
}
