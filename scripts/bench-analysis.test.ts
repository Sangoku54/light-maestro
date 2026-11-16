/**
 * Benchmark de l'analyse audio (détection de sections + génération).
 *
 * Fichier hors suite de tests (suffixe .bench.ts, pas .test.ts) : lancé
 * manuellement pour mesurer avant/après optimisation.
 *
 *   npx vitest run scripts/bench-analysis.bench.ts
 */
import { describe, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeAudioBuffer } from '../src/hooks/audio-analysis';

const OUT = path.join(__dirname, '.bench-result.txt');
const log = (...parts: unknown[]) => {
  const line = parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ');
  console.log(line);
  try { fs.appendFileSync(OUT, line + '\n'); } catch { /* ignore */ }
};

/**
 * Morceau synthétique de 4 min avec structure musicale réaliste :
 * intro (calme) / verse / chorus (fort, avec basse) / bridge / drop.
 * Sert à exercised la détection de sections ET à mesurer le temps CPU.
 */
function makeTrack(sampleRate = 44100, seconds = 240): Float32Array {
  const n = sampleRate * seconds;
  const data = new Float32Array(n);
  const bpm = 128;
  const beat = 60 / bpm;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  // Sections : [début, fin, énergie, brillance]
  const sections: [number, number, number, number][] = [
    [0, 24, 0.22, 0.35],    // intro
    [24, 72, 0.5, 0.5],     // verse
    [72, 120, 0.95, 0.72],  // chorus
    [120, 144, 0.35, 0.3],  // bridge
    [144, 216, 0.9, 0.8],   // drop
    [216, 240, 0.2, 0.28],  // outro
  ];

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let amp = 0.5, bright = 0.5;
    for (const [s, e, a, b] of sections) {
      if (t >= s && t < e) { amp = a; bright = b; break; }
    }
    // kick sur chaque temps
    const phase = (t % beat) / beat;
    const kick = Math.exp(-phase * 18) * amp * 0.9;
    // basse continue (sert à la détection de tempo)
    const bass = Math.sin(2 * Math.PI * 55 * t) * amp * 0.5;
    // harmony + bruit haute fréquence selon la brillance de la section
    const harm = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t) * 0.6) * amp * 0.25;
    const air = rnd() * 2 * amp * bright * 0.5;
    // couloir transitoire à chaque changement de section (onset de structure)
    data[i] = kick + bass + harm + air;
  }
  return data;
}

describe('bench — analyse audio', () => {
  it('mesure le temps d\'analyse d\'un morceau de 4 min', async () => {    const sampleRate = 44100;
    const data = makeTrack(sampleRate, 240);
    // analyzeAudioBuffer attend un AudioBuffer (getChannelData) — mock minimal.
    const buffer = {
      getChannelData: () => data,
      length: data.length,
      numberOfChannels: 1,
      sampleRate,
      duration: data.length / sampleRate,
    } as unknown as AudioBuffer;

    // Échauffement (JIT) — non mesuré
    analyzeAudioBuffer(buffer, sampleRate);

    const runs = 3;
    const times: number[] = [];
    let sections = 0;
    try { fs.writeFileSync(OUT, ''); } catch { /* ignore */ }
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const res = await analyzeAudioBuffer(buffer, sampleRate);
      const dt = performance.now() - t0;
      times.push(dt);
      sections = res.sections?.length ?? 0;
      log(
        `  run ${i + 1}: ${dt.toFixed(0)} ms — ${res.sections?.length ?? 0} sections, ` +
        `${res.beats?.length ?? 0} beats, ${res.downbeats?.length ?? 0} downbeats, ` +
        `bpm=${res.bpm?.toFixed?.(1) ?? res.bpm}, types=${(res.sections ?? []).map((s) => s.type).join(',')}`,
      );
    }
    const best = Math.min(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    log(`  BEST ${best.toFixed(0)} ms | AVG ${avg.toFixed(0)} ms | sections=${sections}`);
  }, 600000);

  it('QUALITÉ : F1 des frontières + exactitude des types (vérité terrain)', async () => {
    const sampleRate = 44100;
    const data = makeTrack(sampleRate, 240);
    const buffer = {
      getChannelData: () => data,
      length: data.length,
      numberOfChannels: 1,
      sampleRate,
      duration: data.length / sampleRate,
    } as unknown as AudioBuffer;
    // ── Vérité terrain (structure du signal synthétique) ──
    const TRUTH: { start: number; end: number; type: string }[] = [
      { start: 0, end: 24, type: 'intro' },
      { start: 24, end: 72, type: 'verse' },
      { start: 72, end: 120, type: 'chorus' },
      { start: 120, end: 144, type: 'bridge' },
      { start: 144, end: 216, type: 'drop' },
      { start: 216, end: 240, type: 'outro' },
    ];
    const TOL = 2.0; // tolérance de correspondance des frontières (s)

    const res = await analyzeAudioBuffer(buffer, sampleRate);
    const secs = res.sections ?? [];

    // ── Frontières : début de chaque section (hors 0) ──
    const truthBounds = TRUTH.slice(1).map((t) => t.start);
    const detBounds = secs.slice(1).map((s) => s.startTime);
    let tp = 0, fp = 0, fn = 0;
    const usedTruth = new Set<number>();
    for (const d of detBounds) {
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < truthBounds.length; i++) {
        if (usedTruth.has(i)) continue;
        const dist = Math.abs(truthBounds[i] - d);
        if (dist < bestD) { bestD = dist; bestI = i; }
      }
      if (bestI >= 0 && bestD <= TOL) { tp++; usedTruth.add(bestI); }
      else fp++;
    }
    fn = truthBounds.length - tp;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    // ── Types : section détectée → type attendu (chevauchement maximal) ──
    let typeOk = 0, typeTotal = 0;
    const details: string[] = [];
    for (const s of secs) {
      const mid = (s.startTime + s.endTime) / 2;
      const expected = TRUTH.find((t) => mid >= t.start && mid < t.end)?.type ?? '?';
      typeTotal++;
      const ok = expected === s.type;
      if (ok) typeOk++;
      details.push(`${s.type}${ok ? '✓' : `✗(attendu ${expected})`}@${s.startTime.toFixed(0)}s`);
    }

    log(`  QUALITÉ — frontières : TP=${tp} FP=${fp} FN=${fn} | précision=${(precision * 100).toFixed(0)}% rappel=${(recall * 100).toFixed(0)}% F1=${(f1 * 100).toFixed(0)}%`);
    log(`  QUALITÉ — types : ${typeOk}/${typeTotal} = ${((typeOk / Math.max(1, typeTotal)) * 100).toFixed(0)}%  [${details.join(' ')}]`);
    log(`  QUALITÉ — tempo : bpm=${res.bpm} (attendu 128) | downbeats=${res.downbeats?.length}`);
  }, 600000);

  it('QUALITÉ : balayage du seuil local (facteur / marge)', async () => {
    const sampleRate = 44100;
    const data = makeTrack(sampleRate, 240);
    const buffer = {
      getChannelData: () => data,
      length: data.length,
      numberOfChannels: 1,
      sampleRate,
      duration: data.length / sampleRate,
    } as unknown as AudioBuffer;

    const TRUTH = [0, 24, 72, 120, 144, 216];
    const TOL = 2.0;

    for (const factor of [1.1, 1.2, 1.3, 1.35, 1.45, 1.6]) {
      for (const offset of [0.008, 0.015, 0.022, 0.03]) {
        (globalThis as any).__LM_PEAK_CFG = { factor, offset };
        const res = await analyzeAudioBuffer(buffer, sampleRate);
        const secs = res.sections ?? [];
        const det = secs.slice(1).map((s) => s.startTime);
        let tp = 0, fp = 0;
        const used = new Set<number>();
        for (const d of det) {
          let bi = -1, bd = Infinity;
          for (let i = 0; i < TRUTH.length - 1; i++) {
            if (used.has(i)) continue;
            const dist = Math.abs(TRUTH[i + 1] - d);
            if (dist < bd) { bd = dist; bi = i; }
          }
          if (bi >= 0 && bd <= TOL) { tp++; used.add(bi); } else fp++;
        }
        const fn = (TRUTH.length - 1) - tp;
        const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
        const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
        log(`  f=${factor} o=${offset} → F1=${(f1 * 100).toFixed(0)}% (P=${(prec * 100).toFixed(0)} R=${(rec * 100).toFixed(0)}) TP=${tp} FP=${fp} FN=${fn} sections=${secs.length}`);
      }
    }
    delete (globalThis as any).__LM_PEAK_CFG;
  }, 900000);
});
