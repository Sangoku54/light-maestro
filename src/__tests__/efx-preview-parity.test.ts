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
});
