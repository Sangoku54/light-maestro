import { describe, it, expect } from 'vitest';
import {
  evalEfxNormalized,
  generateEfxPanTilt,
  computeEfxOverrides,
} from '../hooks/fixture-tracks';
import type { EfxPattern } from '../stores/showStore';

const PATTERNS: EfxPattern[] = [
  'Circle', 'Line', 'Eight', 'Square', 'Triangle',
  'Infinity', 'Zigzag', 'Spiral', 'DoubleCircle', 'Heart',
  'Wave', 'Bounce', 'Cross',
];

const fixtures = [
  { id: 'fx-1', name: 'Wash 1', startAddress: 1, channelCount: 10, universeId: 'u1', tier: 'primary' },
];

describe('EFX preview == moteur (parité stricte)', () => {
  it('Circle t=0 pleine amplitude : valeurs DMX exactes connues', () => {
    // rawPan=cos(0)=1, rawTilt=sin(0)=0, w=h=1 → pan=128+127=255, tilt=128
    expect(generateEfxPanTilt('Circle', 0, 1, 1, 0, 0, 0)).toEqual({ pan: 255, tilt: 128 });
  });

  it('evalEfxNormalized <-> generateEfxPanTilt : mapping DMX cohérent sur les 10 patterns', () => {
    for (const pattern of PATTERNS) {
      for (const t of [0, 0.13, 0.5, 1.7]) {
        for (const [w, h] of [[1, 1], [0.5, 2], [2, 0.3]] as const) {
          const { x, y } = evalEfxNormalized(pattern, t, w, h, 30, 100, -50);
          const { pan, tilt } = generateEfxPanTilt(pattern, t, w, h, 30, 100, -50);
          expect(pan).toBe(Math.max(0, Math.min(255, Math.round(128 + x * 127))));
          expect(tilt).toBe(Math.max(0, Math.min(255, Math.round(128 + y * 127))));
        }
      }
    }
  });

  it('toutes valeurs DMX dans 0..255 (amplitudes et offsets extrêmes)', () => {
    for (const pattern of PATTERNS) {
      for (const t of [0, 0.33, 0.77]) {
        const { pan, tilt } = generateEfxPanTilt(pattern, t, 2, 2, 45, 400, -400);
        expect(pan).toBeGreaterThanOrEqual(0);
        expect(pan).toBeLessThanOrEqual(255);
        expect(tilt).toBeGreaterThanOrEqual(0);
        expect(tilt).toBeLessThanOrEqual(255);
      }
    }
  });

  it('aucun doublon : chaque pattern trace une forme distincte (cf. Eight/Infinity)', () => {
    // Échantillonne chaque pattern sur un cycle et compare les signatures.
    // Seule exception connue et assumée : Infinity == Eight déphasé (compat legacy).
    const signature = (p: EfxPattern): string => {
      const pts: string[] = [];
      for (let i = 0; i < 16; i++) {
        const { x, y } = evalEfxNormalized(p, i / 16, 1, 1, 0, 0, 0);
        pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      return pts.join('|');
    };
    const sigs = new Map<string, EfxPattern[]>();
    for (const p of PATTERNS) {
      const s = signature(p);
      sigs.set(s, [...(sigs.get(s) || []), p]);
    }
    const dupes = [...sigs.entries()].filter(([, ps]) => ps.length > 1);
    expect(dupes).toEqual([]);
  });

  it('base de temps absolue : même instant => même sortie quelle que soit la fenêtre d\u2019entrée', () => {
    const effects = [{ id: 'eff-1', pattern: 'Circle', speed: 0.5, width: 1, height: 1, rotation: 0, xOffset: 0, yOffset: 0 }];
    const mkTracks = (s: number, en: number) => [
      {
        id: 'et1', name: 'EFX 1',
        entries: [{ id: 'e1', time: s, endTime: en, effectId: 'eff-1' }],
        targetFixtures: { type: 'fixture', fixtureIds: ['fx-1'] },
      },
    ];
    // Même instant (t=7s), deux fenêtres d'entrée différentes → sortie identique.
    // (Avec l'ancienne formule entry-relative, on aurait eu 0.35 vs 0.15 cycles.)
    const a = computeEfxOverrides(mkTracks(0, 10) as any, 7, effects as any, fixtures as any, []);
    const b = computeEfxOverrides(mkTracks(4, 14) as any, 7, effects as any, fixtures as any, []);
    expect(a.get('fx-1')).toEqual(b.get('fx-1'));
  });

  it('spread = 0 : toutes les fixtures synchronisées (comportement historique)', () => {
    const effects = [{ id: 'eff-1', pattern: 'Circle', speed: 0.5, width: 1, height: 1, rotation: 0, xOffset: 0, yOffset: 0, spread: 0 }];
    const tracks = [{
      id: 'et1', name: 'EFX 1',
      entries: [{ id: 'e1', time: 0, endTime: 10, effectId: 'eff-1' }],
      targetFixtures: { type: 'fixture', fixtureIds: ['fx-1', 'fx-2', 'fx-3'] },
    }];
    const fxs = [
      { id: 'fx-1', startAddress: 1 }, { id: 'fx-2', startAddress: 11 }, { id: 'fx-3', startAddress: 21 },
    ];
    const m = computeEfxOverrides(tracks as any, 3.7, effects as any, fxs as any, []);
    expect(m.get('fx-1')).toEqual(m.get('fx-2'));
    expect(m.get('fx-2')).toEqual(m.get('fx-3'));
  });

  it('spread = 1 : vague complète — chaque fixture déphasée de 1/N cycle', () => {
    const effects = [{ id: 'eff-1', pattern: 'Circle', speed: 0.5, width: 1, height: 1, rotation: 0, xOffset: 0, yOffset: 0, spread: 1 }];
    const tracks = [{
      id: 'et1', name: 'EFX 1',
      entries: [{ id: 'e1', time: 0, endTime: 10, effectId: 'eff-1' }],
      targetFixtures: { type: 'fixture', fixtureIds: ['fx-1', 'fx-2', 'fx-3', 'fx-4'] },
    }];
    const fxs = [
      { id: 'fx-1', startAddress: 1 }, { id: 'fx-2', startAddress: 11 },
      { id: 'fx-3', startAddress: 21 }, { id: 'fx-4', startAddress: 31 },
    ];
    const t = 3.7;
    const m = computeEfxOverrides(tracks as any, t, effects as any, fxs as any, []);
    // Les 4 fixtures voient 4 phases distinctes (0, 0.25, 0.5, 0.75 ajouté au temps de base)
    const relTime = (t * 0.5 * 2) / (Math.PI * 2);
    const ids = ['fx-1', 'fx-2', 'fx-3', 'fx-4'];
    ids.forEach((fid, i) => {
      expect(m.get(fid)).toEqual(generateEfxPanTilt('Circle', relTime + i / 4, 1, 1, 0, 0, 0));
    });
    // Et elles ne sont pas toutes identiques (vrai déphasage, pas un no-op)
    expect(m.get('fx-1')).not.toEqual(m.get('fx-3'));
  });
});
