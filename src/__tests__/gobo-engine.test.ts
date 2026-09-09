// gobo-engine — exploitation intelligente des roues de gobos.
// Garanties commerciales (toute fixture, toute def QLC+/OFL) :
//   1. Jamais de défilé continu : les changements de slot sont rares et tenus.
//   2. Des REPOS existent : longues plages à valeur constante.
//   3. Les slots animate (AUTO/SPIN/CHANGE/DITHER…) sont rares et dosés par l'énergie.
//   4. La valeur reste toujours à l'intérieur des caps de la def (capMid).
//   5. Proprement déterministe (temps == état, stable entre appels 60 fps).
import { describe, it, expect } from 'vitest';
import type { DmxFixtureCapability } from '../hooks/dmx-cues';
import { computeGoboValue, classifyGoboCap } from '../engine/gobo-engine';

const TONIO_LIKE: DmxFixtureCapability[] = [
  { min: 0, max: 71, name: 'FIXED GOBO' },
  { min: 72, max: 127, name: 'PATTERN DITHER' },
  { min: 128, max: 255, name: 'CHANGE PATTERN AUTO' },
];

const OPEN_LIKE: DmxFixtureCapability[] = [
  { min: 0, max: 8, name: 'Open' },
  { min: 9, max: 60, name: 'Gobo 1' },
  { min: 61, max: 127, name: 'Stars' },
  { min: 128, max: 191, name: 'Cross' },
];

function sweep(caps: DmxFixtureCapability[], seconds: number, stepSec: number, energy = 0.5) {
  const out: number[] = [];
  for (let t = 0; t <= seconds; t += stepSec) {
    out.push(computeGoboValue(caps, t, { bpm: 120, energy, seed: 7 }));
  }
  return out;
}

function transitions(seq: number[]): number {
  let n = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) n++;
  return n;
}

function maxRun(seq: number[]): number {
  let best = 0, cur = 0, prev: number | null = null;
  for (const v of seq) {
    if (v === prev) cur++;
    else { best = Math.max(best, cur); cur = 1; }
    prev = v;
  }
  return Math.max(best, cur);
}

describe('classifyGoboCap', () => {
  it('opère par nom (générique, sans cas par fixture)', () => {
    expect(classifyGoboCap({ min: 0, max: 10, name: 'Open' })).toBe('open');
    expect(classifyGoboCap({ min: 0, max: 10, name: 'No gobo' })).toBe('open');
    expect(classifyGoboCap({ min: 0, max: 10, name: 'FIXED GOBO' })).toBe('static');
    expect(classifyGoboCap({ min: 0, max: 10, name: 'Gobo 1' })).toBe('static');
    expect(classifyGoboCap({ min: 0, max: 10, name: 'Stars' })).toBe('static');
    expect(classifyGoboCap({ min: 0, max: 10, name: 'CHANGE PATTERN AUTO' })).toBe('animate');
    expect(classifyGoboCap({ min: 0, max: 10, name: 'Gobo Shake' })).toBe('animate');
    expect(classifyGoboCap({ min: 0, max: 10, name: 'Spin' })).toBe('animate');
  });
});

describe('computeGoboValue — TONIO-like (roue sans open, slots animate)', () => {
  const seq = sweep(TONIO_LIKE, 120, 0.5, 0.6);

  it('communique des valeurs max 2 par slot (capMid) uniquement', () => {
    const mids = new Set([36, 100, 192]); // (0+71)/2, (72+127)/2, (128+255)/2 arrondis
    for (const v of seq) expect(mids.has(v), `valeur gobo hors caps: ${v}`).toBe(true);
  });

  it('varie dans le temps (pas figé sur UN slot)', () => {
    expect(new Set(seq).size).toBeGreaterThan(1);
  });

  it('offre de longs REPOS (aucun défilé continu)', () => {
    expect(maxRun(seq)).toBeGreaterThanOrEqual(8); // ≥ 2 mesures sans changement
  });

  it('ne change que rarement (tenue ≥ 1 mesure)', () => {
    expect(transitions(seq)).toBeLessThan(seq.length * 0.5);
  });

  it('n’utilise les slots animate (dither/auto) que de façon RARE', () => {
    const animate = seq.filter((v) => v === 100 || v === 192).length;
    expect(animate).toBeLessThan(seq.length * 0.35);
  });

  it('reste silencieux en faible énergie (repos dominant)', () => {
    const calm = sweep(TONIO_LIKE, 120, 0.5, 0.15);
    const hot = sweep(TONIO_LIKE, 120, 0.5, 1);
    const changed = (s: number[]) => s.filter((v, i) => i === 0 || v !== s[i - 1]).length;
    expect(changed(calm)).toBeLessThan(changed(hot));
  });
});

describe('computeGoboValue — roue avec slot Open', () => {
  const seq = sweep(OPEN_LIKE, 120, 0.5, 0.6);

  it('utilise l’Open comme valeur de REPOS', () => {
    expect(maxRun(seq)).toBeGreaterThanOrEqual(8);
    expect(seq.filter((v) => v === 4).length).toBeGreaterThan(0); // (0+8)/2
  });

  it('garde le motif posé entre deux changements', () => {
    expect(transitions(seq)).toBeLessThan(seq.length * 0.5);
  });
});

describe('computeGoboValue — roue entièrement animate (dégénérée)', () => {
  const ALL_ANIM: DmxFixtureCapability[] = [
    { min: 0, max: 127, name: 'Auto pattern' },
    { min: 128, max: 255, name: 'Macro spin' },
  ];
  const seq = sweep(ALL_ANIM, 120, 0.5, 0.8);

  it('ne clignote jamais à chaque instant (repos ≥ 1 mesure)', () => {
    expect(maxRun(seq)).toBeGreaterThanOrEqual(4);
  });

  it('reste dans les caps (mids 64 / 192)', () => {
    for (const v of seq) expect(v === 64 || v === 192, `hors caps: ${v}`).toBe(true);
  });
});

describe('computeGoboValue — propriétés générales', () => {
  it('est déterministe (temps == état)', () => {
    const a = computeGoboValue(TONIO_LIKE, 12.34, { bpm: 120, energy: 0.6, seed: 7 });
    const b = computeGoboValue(TONIO_LIKE, 12.34, { bpm: 120, energy: 0.6, seed: 7 });
    expect(a).toBe(b);
  });

  it('varie selon la graine (units d’une même fixture ≠ en phase)', () => {
    const seedA = computeGoboValue(TONIO_LIKE, 30.00, { bpm: 120, energy: 0.6, seed: 1001 });
    const seedB = computeGoboValue(TONIO_LIKE, 30.00, { bpm: 120, energy: 0.6, seed: 1002 });
    // Les deux graines ne coïncident pas systématiquement : sur une fenêtre,
    // au moins une position doit diverger.
    let differs = 0;
    for (let t = 0; t < 60; t += 0.5) {
      const x = computeGoboValue(TONIO_LIKE, t, { bpm: 120, energy: 0.6, seed: 1001 });
      const y = computeGoboValue(TONIO_LIKE, t, { bpm: 120, energy: 0.6, seed: 1002 });
      if (x !== y) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('retourne 0 quand il n’y a pas de caps (canal muet → valeur basse stable)', () => {
    expect(computeGoboValue([], 5)).toBe(0);
  });
});