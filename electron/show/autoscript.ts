/**
 * AutoScript Engine — automatic light show generation
 *
 * Automatically generate lighting cues and effects based on real-time audio analysis.
 *
 * The engine combines:
 * - Beat-synced effects
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
  speedMultiplier: 'half' | 'normal' | 'double'; // Modulation de vitesse globale
  lockEffect: boolean; // Blocage : garde l'effet actuel, ne change plus
  // Section reactions
  sectionAware: boolean;  // Different effects per song section
  // Stem reactions
  drumReactive: boolean;  // Bass/kick reactive intensity
  vocalReactive: boolean; // Vocal-reactive colors
  colorHarmony: 'none' | 'complementary' | 'analogous' | 'triadic' | 'tetradic';
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
  activeHue: number;            // 0-360, hue de base pour les harmonies
  speedFactor: number;          // 0.5, 1.0, 2.0 (vitesse globale)
  isLocked: boolean;            // si true, l'effet ne change plus
  phraseBeats: number;          // beats écoulés dans la phrase courante (0..phraseLength-1)
  phraseLength: number;         // longueur de phrase en beats (4, 8, 16)
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
  speedMultiplier: 'normal',
  lockEffect: false,
  sectionAware: true,
  drumReactive: true,
  vocalReactive: true,
  colorHarmony: 'triadic',
  strobeLimit: 10,
  maxBrightness: 255,
};

// ─── Harmonie de couleurs professionnelle ────────────────────

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Génère une harmonie à partir d'une couleur de base (hue en 0-360).
// type: 'complementary' | 'analogous' | 'triadic' | 'tetradic' | 'monochromatic'
function buildHarmony(baseHue: number, type: string, count: number): number[][] {
  const colors: number[][] = [];
  const base = rgbToHsl(baseHue > 255 ? 255 : baseHue, 1, 0.5); // hue only used
  const h = base.h;
  const hues: number[] = [];
  if (type === 'complementary') {
    hues.push(h, (h + 180) % 360);
  } else if (type === 'analogous') {
    hues.push((h + 300) % 360, h, (h + 60) % 360);
  } else if (type === 'triadic') {
    hues.push(h, (h + 120) % 360, (h + 240) % 360);
  } else if (type === 'tetradic') {
    hues.push(h, (h + 90) % 360, (h + 180) % 360, (h + 270) % 360);
  } else {
    // monochromatic : même hue, saturation/luminosité variées
    for (let i = 0; i < count; i++) {
      colors.push(hslToRgb(h, Math.max(0.3, 1 - i * 0.15), 0.4 + i * 0.15));
    }
    return colors.slice(0, count);
  }
  for (let i = 0; i < count; i++) {
    const hue = hues[i % hues.length];
    const sat = 0.7 + (i % 3) * 0.1;
    const lig = 0.45 + (i % 2) * 0.15;
    colors.push(hslToRgb(hue, sat, lig));
  }
  return colors;
}

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
      activeHue: 0,
      speedFactor: 1.0,
      isLocked: false,
      phraseBeats: 0,
      phraseLength: 8,
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

    // 2. Vitesse globale : config + modulation par l'énergie musicale
    const baseSpeed = this.config.speedMultiplier === 'half' ? 0.5
      : this.config.speedMultiplier === 'double' ? 2.0 : 1.0;
    // En break-down on ralentit, en drop on accélère légèrement
    const energySpeed = 0.7 + analysis.totalEnergy * 0.6;
    this.state.speedFactor = Math.round(baseSpeed * energySpeed * 10) / 10;

    // 3. Phrasing musical : compte les beats dans une phrase de N beats
    // La résolution d'effet se fait en fin de phrase (ou sur downbeat) pour
    // éviter les changements incessants et donner du "souffle" au show.
    if (analysis.beat) {
      this.beatCount++;
      this.state.phraseBeats = (this.state.phraseBeats + 1) % this.state.phraseLength;
    }
    const phraseEnd = this.state.phraseBeats === 0 && this.beatCount > 0;

    // 4. Section-based effect selection (uniquement en fin de phrase)
    if (this.config.sectionAware && analysis.sectionChange && !this.state.isLocked) {
      this.selectEffectForSection(analysis.section);
      this.state.phraseBeats = 0;
    }

    // 5. Beat-synced effect changes (en fin de phrase, jamais verrouillé)
    if (this.config.beatSync && analysis.beat &&
        !this.state.isLocked && (phraseEnd || this.beatCount % this.config.beatDivision === 0)) {
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
    // Base hue dérivé des fréquences : basses → rouges/oranges, aigus → bleus/violets
    const bassHue = Math.round(analysis.lowEnergy * 60);        // 0-60 (rouge→orange)
    const midHue = Math.round(180 + analysis.midEnergy * 120);  // 180-300 (cyan→magenta)
    const highHue = Math.round(240 + analysis.highEnergy * 120); // 240-360 (bleu→rouge)

    // Choisit le hue dominant selon l'énergie
    const energies = [analysis.lowEnergy, analysis.midEnergy, analysis.highEnergy];
    const maxIdx = energies.indexOf(Math.max(...energies));
    const baseHue = [bassHue, midHue, highHue][maxIdx];

    // Boucle lentement le hue dans le temps pour du mouvement chromatique
    const timeShift = (Date.now() % 60000) / 60000 * 360;
    const hue = (baseHue + timeShift * 0.3) % 360;
    this.state.activeHue = hue;

    // Construit l'harmonie selon le réglage utilisateur
    if (this.config.colorHarmony !== 'none') {
      return buildHarmony(hue, this.config.colorHarmony, 5);
    }
    // Sans harmonie : dégradé simple autour du hue
    return buildHarmony(hue, 'monochromatic', 5);
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

    // Group Unison — tous les projecteurs jouent ensemble (impact maximum)
    this.effects.set('group-unison', {
      id: 'group-unison',
      name: 'Group Unison',
      category: 'peak',
      beatDivision: 2,
      minBpm: 80,
      maxBpm: 160,
      generate: (state, analysis, fixtureCount) => {
        const colorIdx = Math.floor(analysis.beatPhase * state.colorPalette.length) % state.colorPalette.length;
        const color = state.colorPalette[colorIdx];
        const pan = Math.round(128 + Math.sin(analysis.beatPhase * Math.PI * 2 * state.speedFactor) * 100);
        const intensities = Array(fixtureCount).fill(state.masterIntensity);
        const colors = Array(fixtureCount).fill(color);
        const panTilt = Array(fixtureCount).fill([pan, 128]);
        return {
          channels: {},
          colors,
          intensities,
          panTilt,
          strobe: Array(fixtureCount).fill(analysis.beat ? 12 : 0),
        };
      },
    });

    // Group Alternate — pair/impair alternent couleur et intensité
    this.effects.set('group-alternate', {
      id: 'group-alternate',
      name: 'Group Alternate',
      category: 'chase',
      beatDivision: 1,
      minBpm: 80,
      maxBpm: 160,
      generate: (state, analysis, fixtureCount) => {
        const colors: number[][] = [];
        const intensities: number[] = [];
        const panTilt: Array<[number, number]> = [];
        const flip = Math.floor(analysis.beatPhase * 2) % 2;
        for (let i = 0; i < fixtureCount; i++) {
          const isPair = i % 2 === 0;
          const active = flip === 0 ? isPair : !isPair;
          colors.push(active ? state.colorPalette[i % state.colorPalette.length] : [0, 0, 0]);
          intensities.push(active ? state.masterIntensity : 0);
          panTilt.push([128 + (active ? 30 : -30), 128]);
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

    // Group Wave — vague qui se déplace d'un projecteur à l'autre
    this.effects.set('group-wave', {
      id: 'group-wave',
      name: 'Group Wave',
      category: 'wave',
      beatDivision: 4,
      minBpm: 60,
      maxBpm: 140,
      generate: (state, analysis, fixtureCount) => {
        const colors: number[][] = [];
        const intensities: number[] = [];
        const panTilt: Array<[number, number]> = [];
        const speed = state.speedFactor;
        for (let i = 0; i < fixtureCount; i++) {
          const offset = i / Math.max(1, fixtureCount);
          const phase = analysis.beatPhase + offset;
          const intensity = Math.round(state.masterIntensity * (0.4 + 0.6 * Math.sin(phase * Math.PI * 2 * speed)));
          const hueIdx = Math.floor((phase * state.colorPalette.length) % state.colorPalette.length);
          colors.push(state.colorPalette[hueIdx]);
          intensities.push(Math.max(0, intensity));
          panTilt.push([Math.round(128 + Math.sin(phase * Math.PI * 2) * 60), 128]);
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

    // Group Circle — pan en cercle, tous ensemble
    this.effects.set('group-circle', {
      id: 'group-circle',
      name: 'Group Circle',
      category: 'wave',
      beatDivision: 4,
      minBpm: 60,
      maxBpm: 140,
      generate: (state, analysis, fixtureCount) => {
        const colors: number[][] = [];
        const intensities: number[] = [];
        const panTilt: Array<[number, number]> = [];
        const angle = analysis.beatPhase * Math.PI * 2 * state.speedFactor;
        const colorIdx = Math.floor((analysis.beatPhase * state.colorPalette.length) % state.colorPalette.length);
        const color = state.colorPalette[colorIdx];
        for (let i = 0; i < fixtureCount; i++) {
          colors.push(color);
          intensities.push(state.masterIntensity);
          panTilt.push([
            Math.round(128 + Math.sin(angle) * 100),
            Math.round(128 + Math.cos(angle) * 40),
          ]);
        }
        return {
          channels: {},
          colors,
          intensities,
          panTilt,
          strobe: Array(fixtureCount).fill(analysis.beat ? 8 : 0),
        };
      },
    });

    // Freeze Hold — fige l'état actuel (blocage artistique)
    this.effects.set('freeze-hold', {
      id: 'freeze-hold',
      name: 'Freeze Hold',
      category: 'breakdown',
      beatDivision: 8,
      minBpm: 60,
      maxBpm: 120,
      generate: (state, analysis, fixtureCount) => {
        const colorIdx = Math.floor(analysis.beatPhase * state.colorPalette.length) % state.colorPalette.length;
        const color = state.colorPalette[colorIdx];
        // Intensité pulsante lente pour éviter le noir total
        const pulse = 0.6 + Math.sin(analysis.beatPhase * Math.PI * 0.5) * 0.3;
        const intensities = Array(fixtureCount).fill(Math.round(state.masterIntensity * pulse));
        const colors = Array(fixtureCount).fill(color);
        const panTilt = Array(fixtureCount).fill([128, 128]);
        return {
          channels: {},
          colors,
          intensities,
          panTilt,
          strobe: Array(fixtureCount).fill(0),
        };
      },
    });
  }
}
