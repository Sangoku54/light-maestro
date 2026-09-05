/**
 * Preuve de différentiation des sections (autoscript).
 *
 * À RMS/centroid CONSTANTS (mix identique), chaque type de section doit
 * produire un show visiblement différent : palette propre, énergie
 * ordonnée (intro < verse < chorus <= drop), intensité nominale décalée,
 * probabilité de strobe réservée aux sections fortes.
 * Si ce test échoue, les sections se ressemblent à nouveau (régression).
 */
import { describe, it, expect } from 'vitest';
import type { TrackSection, TrackAnalysis } from '../hooks/audio-analysis';
// @ts-ignore — le fichier contient du JSX, genCues est du TS pur
import { genCues } from '../views/QuickShowView';

function makeSection(type: TrackSection['type'], startTime: number, endTime: number): TrackSection {
  return { type, startTime, endTime, energy: 0.5, color: '#888' };
}

const SECTIONS: TrackSection[] = [
  makeSection('intro', 0, 10),
  makeSection('verse', 10, 20),
  makeSection('chorus', 20, 30),
  makeSection('bridge', 30, 40),
  makeSection('build', 40, 50),
  makeSection('drop', 50, 60),
  makeSection('outro', 60, 70),
];

function analysis(rms = 0.5): TrackAnalysis {
  return {
    duration: 70,
    sampleRate: 44100,
    bpm: 128,
    beats: [],
    beatPositions: [],
    beatStrengths: [],
    timeSignature: '4/4',
    key: 'C',
    keyConfidence: 0.8,
    genre: JSON.stringify({ genre: 'techno' }),
    atmosphere: 'energetic',
    energyCurve: new Array(256).fill(0.5),
    rmsCurve: new Array(256).fill(rms),
    spectralCentroidCurve: new Array(256).fill(0.5),
    onsetCurve: new Array(256).fill(0),
    lowCurve: new Array(256).fill(0.3),
    midCurve: new Array(256).fill(0.3),
    highCurve: new Array(256).fill(0.3),
    downbeats: [],
  };
}

const cfg = { musicStyle: 'techno', colorScheme: 'auto', intensity: 'dynamic', movement: 'dynamic', beatDivision: 4, audioReactive: true, sectionAware: true, customPalette: [] };

function bySection(cues: any[]) {
  const m = new Map<string, any[]>();
  for (const c of cues) {
    const l = m.get(c.section) ?? [];
    l.push(c);
    m.set(c.section, l);
  }
  return m;
}

describe('différentiation des sections (autoscript)', () => {
  it('chaque section forte a sa propre palette (couleurs distinctes)', () => {
    const cues = genCues(SECTIONS, 128, 4, cfg, [], 7, analysis());
    const m = bySection(cues);
    const pal = (t: string) => [...new Set(m.get(t)![0].colors as string[])];
    const intro = pal('intro'), verse = pal('verse'), chorus = pal('chorus'), drop = pal('drop'), bridge = pal('bridge'), outro = pal('outro');
    expect(intro).not.toEqual(verse);
    expect(verse).not.toEqual(chorus);
    expect(chorus).not.toEqual(drop);
    expect(bridge).not.toEqual(chorus);
    expect(outro).not.toEqual(intro);
  });

  it('énergie moyenne ordonnée : intro < verse < chorus <= drop (à RMS constant)', () => {
    const cues = genCues(SECTIONS, 128, 4, cfg, [], 7, analysis());
    const m = bySection(cues);
    const meanE = (t: string) => {
      const arr = m.get(t)!.map((c) => c.energy as number);
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };
    const intro = meanE('intro'), verse = meanE('verse'), chorus = meanE('chorus'), drop = meanE('drop');
    expect(intro).toBeLessThan(verse);
    expect(verse).toBeLessThan(chorus);
    expect(drop).toBeGreaterThanOrEqual(chorus - 0.02);
  });

  it('intensité nominale décalée : drop/chorus montent plus haut que intro/verse à RMS égal', () => {
    const cues = genCues(SECTIONS, 128, 4, cfg, [], 7, analysis());
    const m = bySection(cues);
    const levels = (t: string) => new Set(m.get(t)!.map((c) => c.intensity));
    // RMS 0.5 : verse/intro restent medium, drop/chorus passent high.
    expect(levels('intro')).not.toContain('high');
    expect(levels('verse')).not.toContain('high');
    expect(levels('drop')).toContain('high');
    expect(levels('chorus')).toContain('high');
  });

  it('densité par section : activeTiers limité en intro, complet en drop', () => {
    const cues = genCues(SECTIONS, 128, 4, cfg, [], 7, analysis());
    const m = bySection(cues);
    const tiers = (t: string) => m.get(t)![0].activeTiers as string[];
    expect(tiers('intro')).toEqual(['primary']);
    expect(tiers('drop')).toContain('tertiary');
    expect(tiers('chorus')).toContain('tertiary');
    expect(tiers('verse')).not.toContain('tertiary');
  });

  it('probabilité de strobe réservée aux sections fortes (drop > chorus > intro)', () => {
    const cues = genCues(SECTIONS, 128, 4, cfg, [], 7, analysis());
    const m = bySection(cues);
    const meanP = (t: string) => {
      const arr = m.get(t)!.map((c) => c.strobeProbability as number);
      return arr.reduce((a, b) => a + b, 0) / arr.length;
    };
    expect(meanP('drop')).toBeGreaterThan(meanP('chorus'));
    expect(meanP('chorus')).toBeGreaterThan(meanP('intro'));
  });

  it('transition : fondu d\'intensité à la frontière intro→drop (pas de snap)', () => {
    // rms constant 0.5 : intro (boost 0.8) → rmsInt 0.4 → medium ; drop (boost 1.3) → rmsInt 0.65 → high.
    // Sans transition, le 1er cue du drop serait déjà 'high' ; avec le fondu, il
    // démarre à l'intensité de la fin de l'intro et converge sur ~2 beats.
    const S = [
      makeSection('intro', 0, 8),
      makeSection('drop', 8, 16),
    ];
    const cues = genCues(S, 128, 4, cfg, [], 7, analysis(0.5));
    const intro = cues.filter((c) => c.section === 'intro');
    const drop = cues.filter((c) => c.section === 'drop');
    expect(drop.length).toBeGreaterThan(4);
    // Le 1er cue du drop démarre à l'intensité de la fin de l'intro.
    expect(drop[0].intensity).toBe(intro[intro.length - 1].intensity);
    // La cible du drop est bien 'high' (les derniers cues l'atteignent).
    expect(drop[drop.length - 1].intensity).toBe('high');
    // Progression : plusieurs valeurs distinctes, pas un saut binaire.
    const values = new Set(drop.map((c) => c.intensity));
    expect(values.size).toBeGreaterThan(1);
  });
});