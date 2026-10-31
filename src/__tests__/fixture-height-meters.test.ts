/**
 * Hauteur des fixtures en MÈTRES — migration et libération du plafond 5 m.
 *
 * Historique : h était un normalisé 0..1 mappé ×5 (plafond arbitraire 5 m).
 * h est désormais en mètres libres. Les sauvegardes anciennes (sans marqueur
 * `fixtureHeightUnit: 'm'`) sont migrées ×5 au chargement ; les nouvelles
 * portent le marqueur et ne sont JAMAIS re-multipliées (idempotence).
 */
import { describe, it, expect } from 'vitest';
import {
  migrateFixtureHeightsToMeters,
  loadFixturePositionsMeters,
  FIXTURE_HEIGHT_UNIT,
} from '../utils/fixture-height';
import type { FixturePos } from '../stores/showStore';

const OLD_POS: Record<string, FixturePos> = {
  a: { x: 0.5, y: 0.3, h: 0.6, heading: 0 } as FixturePos,  // 3 m en ancien format
  b: { x: 0.2, y: 0.8, h: 0.3, heading: 0 } as FixturePos,  // 1.5 m
  c: { x: 0.8, y: 0.5, h: 1, heading: 0 } as FixturePos,    // 5 m (ancien plafond)
};

describe('migration hauteur fixtures → mètres', () => {
  it('ancien format (sans marqueur) : h ×5 (0.6 → 3 m)', () => {
    const out = loadFixturePositionsMeters({ fixturePositions: OLD_POS });
    expect(out?.a.h).toBeCloseTo(3, 9);
    expect(out?.b.h).toBeCloseTo(1.5, 9);
    expect(out?.c.h).toBeCloseTo(5, 9);
  });

  it('nouveau format (marqueur m) : valeurs CONSERVÉES tel quel', () => {
    const newPos = { a: { x: 0.5, y: 0.3, h: 3, heading: 0 } as FixturePos };
    const out = loadFixturePositionsMeters({ fixturePositions: newPos, fixtureHeightUnit: FIXTURE_HEIGHT_UNIT });
    expect(out?.a.h).toBe(3);
  });

  it('IDEMPOTENCE : re-migrer des mètres amplifierait (×5) — le marqueur l\'empêche', () => {
    // Simulation double chargement d'un même projet ancien :
    const once = loadFixturePositionsMeters({ fixturePositions: OLD_POS })!;
    // Le fichier re-sauvegardé porte le marqueur → pas de re-multiplication.
    const twice = loadFixturePositionsMeters({ fixturePositions: once, fixtureHeightUnit: FIXTURE_HEIGHT_UNIT })!;
    expect(twice.a.h).toBeCloseTo(3, 9);
    expect(twice.c.h).toBeCloseTo(5, 9);
  });

  it('migrateFixtureHeightsToMeters : h absent/NaN → 0 m', () => {
    const out = migrateFixtureHeightsToMeters({ x: { x: 0.5, y: 0.3 } as FixturePos, y: { h: NaN } as unknown as FixturePos });
    expect(out.x.h).toBe(0);
    expect(out.y.h).toBe(0);
  });

  it('payload vide → undefined (aucun écrasement du store)', () => {
    expect(loadFixturePositionsMeters(undefined)).toBeUndefined();
    expect(loadFixturePositionsMeters({})).toBeUndefined();
  });
});
