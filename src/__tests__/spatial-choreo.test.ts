import { describe, it, expect } from 'vitest';
import { spatialPhaseFor, fallbackPosition, SPATIAL_BY_SECTION } from '../engine/dmx-movement';
import { genCues } from '../views/QuickShowView';

describe('chorégraphie spatiale (1.0.20)', () => {
  it('wave : décalage de phase proportionnel à x, nul au centre', () => {
    expect(spatialPhaseFor({ x: 0.5, y: 0.5 }, 'wave', 0)).toBeCloseTo(0, 9);
    expect(spatialPhaseFor({ x: 1, y: 0.5 }, 'wave', 0)).toBeCloseTo(-Math.PI, 9);
    expect(spatialPhaseFor({ x: 0, y: 0.5 }, 'wave', 0)).toBeCloseTo(Math.PI, 9);
    // deux fixtures symétriques → phases opposées (cascade gauche/droite)
    expect(spatialPhaseFor({ x: 0.2, y: 0.5 }, 'wave', 0)).toBeCloseTo(-spatialPhaseFor({ x: 0.8, y: 0.5 }, 'wave', 0), 9);
  });

  it('circle : phase croissante avec x (anneau tournant le long de la ligne)', () => {
    expect(spatialPhaseFor({ x: 0.5, y: 0.5 }, 'circle', 0)).toBeCloseTo(0, 9);
    expect(spatialPhaseFor({ x: 1, y: 0.5 }, 'circle', 0)).toBeCloseTo(Math.PI, 9);
  });

  it('expand : 0 au centre, -2π·d aux bords, symétrie miroir', () => {
    expect(spatialPhaseFor({ x: 0.5, y: 0.5 }, 'expand', 0)).toBeCloseTo(0, 9);
    expect(spatialPhaseFor({ x: 0, y: 0.5 }, 'expand', 0)).toBeCloseTo(-Math.PI, 9); // d=0.5
    expect(spatialPhaseFor({ x: 0.2, y: 0.5 }, 'expand', 0)).toBeCloseTo(spatialPhaseFor({ x: 0.8, y: 0.5 }, 'expand', 0), 9);
  });

  it('contract : signe opposé de expand (convergence vers le centre)', () => {
    const e = spatialPhaseFor({ x: 0.2, y: 0.3 }, 'expand', 0);
    const c = spatialPhaseFor({ x: 0.2, y: 0.3 }, 'contract', 0);
    expect(c).toBeCloseTo(-e, 9);
  });

  it('alternate : π sur les fixtures impaires, 0 sur les paires (sans position requise)', () => {
    expect(spatialPhaseFor(undefined, 'alternate', 0)).toBe(0);
    expect(spatialPhaseFor(undefined, 'alternate', 1)).toBe(Math.PI);
    expect(spatialPhaseFor(undefined, 'alternate', 2)).toBe(0);
    expect(spatialPhaseFor(undefined, 'alternate', 3)).toBe(Math.PI);
  });

  it('off / inconnu / undefined : retourne 0 (comportement actuel inchangé)', () => {
    expect(spatialPhaseFor({ x: 0.1, y: 0.2 }, 'off', 3)).toBe(0);
    expect(spatialPhaseFor({ x: 0.1, y: 0.2 }, undefined, 3)).toBe(0);
    expect(spatialPhaseFor({ x: 0.1, y: 0.2 }, 'weird', 3)).toBe(0);
  });

  it('fallback : grille par index mobile quand aucune position (formule initFixturePosition)', () => {
    const p0 = fallbackPosition(0);
    expect(p0.x).toBeCloseTo(0.1, 9);
    expect(p0.y).toBeCloseTo(0.1, 9);
    const p6 = fallbackPosition(6);
    expect(p6.x).toBeCloseTo(0.1, 9); // col = 6%6 = 0
    expect(p6.y).toBeCloseTo(0.28, 9); // row 1
    // une fixture sans position reçoit quand même une chorégraphie (pas d'effondrement)
    expect(spatialPhaseFor(undefined, 'wave', 0)).not.toBe(0);
  });

  it('mapping par section : drop → expand, chorus → circle, build → alternate', () => {
    expect(SPATIAL_BY_SECTION.drop).toBe('expand');
    expect(SPATIAL_BY_SECTION.chorus).toBe('circle');
    expect(SPATIAL_BY_SECTION.build).toBe('alternate');
    expect(SPATIAL_BY_SECTION.outro).toBe('contract');
    expect(SPATIAL_BY_SECTION.intro).toBe('wave');
  });

  it('genCues : les cues portent spatialPattern par section (drop expand, chorus circle, build alternate)', () => {
    const S = [
      { type: 'intro', startTime: 0, endTime: 10, energy: 0.5, color: '#888' },
      { type: 'chorus', startTime: 10, endTime: 20, energy: 0.5, color: '#888' },
      { type: 'build', startTime: 20, endTime: 30, energy: 0.5, color: '#888' },
      { type: 'drop', startTime: 30, endTime: 40, energy: 0.5, color: '#888' },
    ] as any;
    const cfg = { musicStyle: 'techno', colorScheme: 'auto', intensity: 'dynamic', movement: 'dynamic', beatDivision: 4 } as any;
    const analysis = {
      duration: 40, sampleRate: 44100, bpm: 128, beats: [], beatPositions: [], beatStrengths: [],
      timeSignature: '4/4', key: 'C', keyConfidence: 0.8, genre: JSON.stringify({ genre: 'techno' }),
      atmosphere: 'energetic', energyCurve: new Array(256).fill(0.5), rmsCurve: new Array(256).fill(0.5),
      spectralCentroidCurve: new Array(256).fill(0.5), onsetCurve: new Array(256).fill(0),
      lowCurve: new Array(256).fill(0.3), midCurve: new Array(256).fill(0.3), highCurve: new Array(256).fill(0.3),
      downbeats: [],
    } as any;
    const cues = genCues(S, 128, 4, cfg, [], 7, analysis);
    const bySec = (t: string) => cues.filter((c) => c.section === t && !c.manual);
    expect(bySec('drop').length).toBeGreaterThan(0);
    expect(bySec('drop')[0].spatialPattern).toBe('expand');
    expect(bySec('chorus')[0].spatialPattern).toBe('circle');
    expect(bySec('build')[0].spatialPattern).toBe('alternate');
    expect(bySec('intro')[0].spatialPattern).toBe('wave');
    // cues manuels : jamais de pattern spatial
    const cuesWithManual = genCues(S, 128, 4, cfg, [{ time: 1, effect: 'M', colors: ['#fff'], section: 'x' } as any], 7, analysis);
    const manual = cuesWithManual.find((c) => (c as any).manual);
    expect((manual as any).spatialPattern).toBeUndefined();
  });
});
