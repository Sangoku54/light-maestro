/**
 * Scene Engine — Playback system for scenes, chasers, cue lists
 *
 * Combines QLC+'s robust scene/chaser system with SoundSwitch's
 * beat-synced playback and audio-reactive parameters.
 */

import { EventEmitter } from 'events';
import {
  ShowScene, ShowChaser, ShowCueList, ShowCue,
  ChaserStep, ShowRGBMatrix, ShowEffect,
} from './storage';
import { DMXEngine } from '../dmx/engine';
import { AudioAnalysis } from '../audio/analyzer';
import { AutoScriptEngine, AutoScriptState } from './autoscript';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

interface ActiveScene {
  scene: ShowScene;
  startTime: number;
  currentFade: number;
}

interface ActiveChaser {
  chaser: ShowChaser;
  currentStep: number;
  direction: 1 | -1;
  startTime: number;
  stepStartTime: number;
  state: PlaybackState;
}

interface ActiveCueList {
  cueList: ShowCueList;
  state: PlaybackState;
}

export class SceneEngine extends EventEmitter {
  private dmx: DMXEngine;
  private autoscript: AutoScriptEngine;
  private tickTimer: NodeJS.Timeout | null = null;

  // Active playbacks
  private activeScenes: Map<string, ActiveScene> = new Map();
  private activeChasers: Map<string, ActiveChaser> = new Map();
  private activeCueLists: Map<string, ActiveCueList> = new Map();
  private activeMatrices: Map<string, ShowRGBMatrix> = new Map();
  private activeEffects: Map<string, ShowEffect> = new Map();

  // External clock sources
  private externalBpm: number = 0;
  private timecode: number = 0;

  // Fixture lookup (for RGB Matrix, EFX)
  private fixturePositions: Map<string, { x: number; y: number }> = new Map();

  constructor(dmx: DMXEngine, autoscript: AutoScriptEngine) {
    super();
    this.dmx = dmx;
    this.autoscript = autoscript;
  }

  // ─── Lifecycle ───────────────────────────────────────────

  start(updateRate: number = 44): void {
    this.stop();
    const interval = 1000 / updateRate;
    this.tickTimer = setInterval(() => this.tick(), interval);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  // ─── Main Tick ───────────────────────────────────────────
  // Called ~44 times/sec, computes all active playbacks

  private tick(): void {
    const now = performance.now();

    // 1. Compute scene outputs
    for (const [id, active] of this.activeScenes) {
      if (active.currentFade < 1) {
        active.currentFade = Math.min(1,
          (now - active.startTime) / active.scene.fadeIn
        );
      }
    }

    // 2. Compute chaser steps
    for (const [id, active] of this.activeChasers) {
      if (active.state !== 'playing') continue;

      const stepDuration = active.chaser.steps[active.currentStep]?.duration || active.chaser.duration;
      const elapsed = now - active.stepStartTime;

      if (elapsed >= stepDuration) {
        this.advanceChaserStep(active);
      }
    }

    // 3. Compute RGB matrices
    for (const [id, matrix] of this.activeMatrices) {
      // Matrix output computed on demand by renderer or here
    }

    // 4. Merge all outputs to DMX
    this.mergeOutputs();

    this.emit('tick');
  }

  // ─── Scene Playback ──────────────────────────────────────

  playScene(scene: ShowScene, universe: number = 0): void {
    const active: ActiveScene = {
      scene,
      startTime: performance.now(),
      currentFade: 0,
    };

    this.activeScenes.set(scene.id, active);

    // Apply scene channels to DMX
    for (const [chStr, value] of Object.entries(scene.channels)) {
      const parts = chStr.split('.');
      const targetUniverse = parts.length > 1 ? parseInt(parts[0]) : universe;
      const channel = parts.length > 1 ? parseInt(parts[1]) : parseInt(parts[0]);
      
      // If fade is 0, apply immediately
      if (scene.fadeIn === 0) {
        this.dmx.setChannel(targetUniverse, channel, value);
      }
    }

    this.emit('sceneStarted', scene.id);
  }

  stopScene(sceneId: string): void {
    const active = this.activeScenes.get(sceneId);
    if (!active) return;

    this.activeScenes.delete(sceneId);

    // Fade out if specified; only zero channels after fade completes
    if (active.scene.fadeOut > 0) {
      this.fadeOutScene(active, () => {
        for (const [chStr] of Object.entries(active.scene.channels)) {
          const parts = chStr.split('.');
          const univ = parts.length > 1 ? parseInt(parts[0]) : 0;
          const ch = parts.length > 1 ? parseInt(parts[1]) : parseInt(parts[0]);
          this.dmx.setChannel(univ, ch, 0);
        }
        this.emit('sceneStopped', sceneId);
      });
    } else {
      for (const [chStr] of Object.entries(active.scene.channels)) {
        const parts = chStr.split('.');
        const univ = parts.length > 1 ? parseInt(parts[0]) : 0;
        const ch = parts.length > 1 ? parseInt(parts[1]) : parseInt(parts[0]);
        this.dmx.setChannel(univ, ch, 0);
      }
      this.emit('sceneStopped', sceneId);
    }
  }

  private fadeOutScene(active: ActiveScene, onDone?: () => void): void {
    const startValue = 1;
    const duration = active.scene.fadeOut;
    const startTime = performance.now();

    const fadeInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const factor = 1 - progress;

      for (const [chStr, value] of Object.entries(active.scene.channels)) {
        const parts = chStr.split('.');
        const univ = parts.length > 1 ? parseInt(parts[0]) : 0;
        const ch = parts.length > 1 ? parseInt(parts[1]) : parseInt(parts[0]);
        this.dmx.setChannel(univ, ch, Math.round(value * factor));
      }

      if (progress >= 1) {
        clearInterval(fadeInterval);
        onDone?.();
      }
    }, 16);
  }

  // ─── Chaser Playback ─────────────────────────────────────
  // QLC+ style: sequential scene playback with various modes

  playChaser(chaser: ShowChaser): void {
    if (chaser.steps.length === 0) return;

    const active: ActiveChaser = {
      chaser,
      currentStep: 0,
      direction: 1,
      startTime: performance.now(),
      stepStartTime: performance.now(),
      state: 'playing',
    };

    this.activeChasers.set(chaser.id, active);
    this.executeChaserStep(active);

    this.emit('chaserStarted', chaser.id);
  }

  stopChaser(chaserId: string): void {
    const active = this.activeChasers.get(chaserId);
    if (!active) return;

    active.state = 'stopped';
    // Stop current step's scene
    const currentStep = active.chaser.steps[active.currentStep];
    if (currentStep) {
      this.stopScene(currentStep.sceneId);
    }
    this.activeChasers.delete(chaserId);

    this.emit('chaserStopped', chaserId);
  }

  pauseChaser(chaserId: string): void {
    const active = this.activeChasers.get(chaserId);
    if (active) {
      active.state = 'paused';
      this.emit('chaserPaused', chaserId);
    }
  }

  resumeChaser(chaserId: string): void {
    const active = this.activeChasers.get(chaserId);
    if (active) {
      active.state = 'playing';
      active.stepStartTime = performance.now();
      this.emit('chaserResumed', chaserId);
    }
  }

  private advanceChaserStep(active: ActiveChaser): void {
    const { chaser } = active;

    // Stop current scene
    const currentStep = chaser.steps[active.currentStep];
    this.stopScene(currentStep.sceneId);

    // Determine next step
    let nextStep = active.currentStep + active.direction;

    switch (chaser.runOrder) {
      case 'loop':
        if (nextStep >= chaser.steps.length) nextStep = 0;
        else if (nextStep < 0) nextStep = chaser.steps.length - 1;
        break;
      case 'single':
        if (nextStep >= chaser.steps.length || nextStep < 0) {
          this.stopChaser(chaser.id);
          return;
        }
        break;
      case 'pingpong':
        if (nextStep >= chaser.steps.length) {
          nextStep = chaser.steps.length - 2;
          active.direction = -1;
        } else if (nextStep < 0) {
          nextStep = 1;
          active.direction = 1;
        }
        break;
    }

    active.currentStep = nextStep;
    active.stepStartTime = performance.now();
    this.executeChaserStep(active);
  }

  private executeChaserStep(active: ActiveChaser): void {
    const step = active.chaser.steps[active.currentStep];
    // The scene should be loaded from show data
    // Here we just trigger via ID, the actual scene lookup happens externally
    this.emit('chaserStep', {
      chaserId: active.chaser.id,
      stepIndex: active.currentStep,
      sceneId: step.sceneId,
      duration: step.duration || active.chaser.duration,
    });
  }

  nextChaserStep(chaserId: string): void {
    const active = this.activeChasers.get(chaserId);
    if (active) {
      active.direction = 1;
      this.advanceChaserStep(active);
    }
  }

  previousChaserStep(chaserId: string): void {
    const active = this.activeChasers.get(chaserId);
    if (active) {
      active.direction = -1;
      this.advanceChaserStep(active);
    }
  }

  tapTempo(chaserId: string): void {
    // QLC+ style tap tempo: adjust chaser speed based on tap rhythm
    const now = performance.now();
    const active = this.activeChasers.get(chaserId);
    if (!active) return;

    // Store tap times (retained in closure)
    if (!this.tapTimes) this.tapTimes = new Map();
    const taps = this.tapTimes.get(chaserId) || [];
    taps.push(now);

    // Keep last 4 taps
    if (taps.length > 4) taps.shift();
    this.tapTimes.set(chaserId, taps);

    // Calculate BPM from tap intervals
    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = 60000 / avgInterval;

      // Update chaser tempo
      active.chaser.tempo = Math.round(bpm);
      this.emit('tempoChanged', { chaserId, bpm: Math.round(bpm) });
    }
  }

  private tapTimes: Map<string, number[]> = new Map();

  // ─── Cue List Playback ───────────────────────────────────
  // Theater-style cue stack (QLC+)

  goCue(cueList: ShowCueList): void {
    let active = this.activeCueLists.get(cueList.id);
    if (!active) {
      active = { cueList, state: 'playing' };
      this.activeCueLists.set(cueList.id, active);
    }

    const cue = cueList.cues[cueList.currentCueIndex];
    if (!cue) return;

    // Pre-wait
    if (cue.preWait > 0) {
      setTimeout(() => this.executeCue(cue, cueList), cue.preWait);
    } else {
      this.executeCue(cue, cueList);
    }
  }

  private executeCue(cue: ShowCue, cueList: ShowCueList): void {
    // Play the associated scene
    this.emit('cueExecuted', {
      cueListId: cueList.id,
      cueId: cue.id,
      sceneId: cue.sceneId,
      index: cueList.currentCueIndex,
    });

    // Post-wait then advance
    if (cue.postWait > 0) {
      setTimeout(() => {
        cueList.currentCueIndex = Math.min(cueList.currentCueIndex + 1, cueList.cues.length - 1);
        this.emit('cueAdvanced', { cueListId: cueList.id, index: cueList.currentCueIndex });

        // Auto-follow
        if (cueList.playback === 'auto') {
          const nextCue = cueList.cues[cueList.currentCueIndex];
          if (nextCue?.trigger === 'follow') {
            setTimeout(() => this.goCue(cueList), nextCue.duration);
          }
        }
      }, cue.postWait);
    } else {
      cueList.currentCueIndex = Math.min(cueList.currentCueIndex + 1, cueList.cues.length - 1);
    }
  }

  // ─── RGB Matrix Engine ───────────────────────────────────
  // QLC+ style: generate pixel data for grid-based effects

  getMatrixOutput(matrix: ShowRGBMatrix, time: number): number[][][] {
    const { width, height, pattern, colors, speed, direction } = matrix;
    const pixels: number[][][] = Array(height).fill(null).map(() => Array(width).fill(null).map((): number[] => [0, 0, 0]));

    const phase = (time * speed) % 1;
    const colorCount = colors.length;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let active = false;
        let colorIndex = 0;

        switch (pattern) {
          case 'solid':
            active = true;
            colorIndex = 0;
            break;

          case 'line': {
            let pos: number;
            switch (direction) {
              case 'left': pos = x / width; break;
              case 'right': pos = 1 - x / width; break;
              case 'up': pos = y / height; break;
              case 'down': pos = 1 - y / height; break;
              default: pos = x / width;
            }
            active = Math.abs(pos - phase) < 0.1;
            colorIndex = Math.floor(phase * colorCount);
            break;
          }

          case 'diamond': {
            const cx = width / 2;
            const cy = height / 2;
            const dist = Math.abs(x - cx) + Math.abs(y - cy);
            const maxDist = cx + cy;
            active = Math.abs(dist / maxDist - phase) < 0.1;
            colorIndex = Math.floor(dist / maxDist * colorCount);
            break;
          }

          case 'circle': {
            const cx = width / 2;
            const cy = height / 2;
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            const maxDist = Math.sqrt(cx ** 2 + cy ** 2);
            active = Math.abs(dist / maxDist - phase) < 0.1;
            colorIndex = Math.floor(dist / maxDist * colorCount);
            break;
          }

          case 'square': {
            const cx = Math.abs(x - width / 2) / (width / 2);
            const cy = Math.abs(y - height / 2) / (height / 2);
            const edge = Math.max(cx, cy);
            active = Math.abs(edge - phase) < 0.1;
            colorIndex = Math.floor(phase * colorCount);
            break;
          }

          case 'triangle': {
            const nx = x / width;
            const ny = y / height;
            const centerDist = Math.abs(nx - 0.5) + Math.abs(ny - 0.5);
            active = Math.abs(centerDist / 1 - phase) < 0.08;
            colorIndex = Math.floor(phase * colorCount);
            break;
          }

          case 'audio': {
            // Audio-reactive matrix — color/intensity from audio
            active = true;
            colorIndex = Math.floor(phase * colorCount);
            break;
          }
        }

        if (active) {
          pixels[y][x] = colors[colorIndex % colorCount];
        }
      }
    }

    return pixels;
  }

  // ─── EFX Engine ──────────────────────────────────────────
  // QLC+ style parametric effects for moving heads

  getEFXOutput(effect: ShowEffect, time: number, fixtureIndex: number, fixtureCount: number): [number, number] {
    const phase = (time * (effect.speed || 1) + fixtureIndex / fixtureCount) % 1;
    const angle = phase * Math.PI * 2;

    let x = 0, y = 0;
    const w = (effect.width || 127) / 255;
    const h = (effect.height || 127) / 255;

    switch (effect.pattern) {
      case 'circle':
        x = Math.cos(angle) * w;
        y = Math.sin(angle) * h;
        break;
      case 'line':
        x = (phase * 2 - 1) * w;
        y = 0;
        break;
      case 'eight': {
        const t = phase * Math.PI * 2;
        x = Math.sin(t) * w;
        y = Math.sin(t * 2) * h * 0.5;
        break;
      }
      case 'square':
        if (phase < 0.25) { x = (phase * 4) * 2 - 1; y = -1; }
        else if (phase < 0.5) { x = 1; y = ((phase - 0.25) * 4) * 2 - 1; }
        else if (phase < 0.75) { x = 1 - ((phase - 0.5) * 4) * 2; y = 1; }
        else { x = -1; y = 1 - ((phase - 0.75) * 4) * 2; }
        x *= w; y *= h;
        break;
      case 'triangle':
        if (phase < 0.33) { x = phase * 3 * 2 - 1; y = -1 + phase * 3; }
        else if (phase < 0.66) { x = 1 - (phase - 0.33) * 3 * 2; y = 1 - (phase - 0.33) * 3; }
        else { x = -1; y = (phase - 0.66) * 3 - 1; }
        x *= w; y *= h;
        break;
    }

    // Apply rotation
    if (effect.rotation) {
      const rot = effect.rotation * Math.PI / 180;
      const rx = x * Math.cos(rot) - y * Math.sin(rot);
      const ry = x * Math.sin(rot) + y * Math.cos(rot);
      x = rx; y = ry;
    }

    // Map to DMX values (128 = center)
    return [
      Math.round((x + 1) * 127.5 + (effect.xOffset || 0)),
      Math.round((y + 1) * 127.5 + (effect.yOffset || 0)),
    ];
  }

  // ─── Output Merging ──────────────────────────────────────

  private mergeOutputs(): void {
    // QLC+ style HTP merge: all active sources contribute
    // This is simplified; real implementation merges through DMXEngine.htpMerge()
    // The actual DMX output is already being written by setChannel calls
  }

  // ─── Audio Sync ──────────────────────────────────────────

  syncToAudio(analysis: AudioAnalysis): void {
    // Update autoscript engine
    const autoState = this.autoscript.update(analysis);

    // Adjust chaser tempos to match BPM
    if (this.externalBpm > 0) {
      for (const active of this.activeChasers.values()) {
        // Use external BPM or audio-detected BPM
        active.chaser.tempo = analysis.bpm || this.externalBpm;
      }
    }

    // Emit state for UI
    this.emit('audioAnalysis', { analysis, autoState });
  }

  setExternalBpm(bpm: number): void {
    this.externalBpm = bpm;
  }

  setTimecode(ms: number): void {
    this.timecode = ms;
  }
}
