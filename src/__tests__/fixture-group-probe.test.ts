// ─── Probe édition groupée de fixtures (Configuration > Scènes) ─────────────
//
// Vérifie la règle centrale : un canal n'est proposé en mode groupe que s'il
// existe à la MÊME position et avec le MÊME type dans TOUTES les fixtures
// sélectionnées. Toute écriture groupée doit toucher une adresse DMX par
// fixture du groupe — et une seule.

import { describe, it, expect } from 'vitest';
import {
  resolveGroupChannels,
  isHomogeneousGroup,
  fixtureIdentity,
  type AnalyzedFixtureLike,
} from '../utils/fixture-group';

/** Construit une fixture analysée à partir de (type, dmxAddress) par canal. */
function fixture(startAddress: number, types: string[]): AnalyzedFixtureLike {
  return {
    channels: types.map((type, i) => ({
      index: i,
      name: `${type} ${i + 1}`,
      type,
      dmxAddress: startAddress + i,
      defaultValue: 0,
    })),
  };
}

const WASH = ['Intensity', 'Colour', 'Colour', 'Colour', 'Shutter'];

describe('resolveGroupChannels — édition groupée', () => {
  it('fixture unique : tous les canaux sont communs', () => {
    const g = resolveGroupChannels([fixture(1, WASH)]);
    expect(g).toHaveLength(WASH.length);
    expect(g.every((c) => c.common)).toBe(true);
    expect(g[0].addresses).toEqual([1]);
  });

  it('fixtures identiques : 1 adresse DMX par fixture, dans l’ordre du groupe', () => {
    const g = resolveGroupChannels([fixture(1, WASH), fixture(11, WASH), fixture(21, WASH)]);
    expect(g).toHaveLength(WASH.length);
    expect(g.every((c) => c.common)).toBe(true);
    expect(g[0].addresses).toEqual([1, 11, 21]);
    expect(g[1].addresses).toEqual([2, 12, 22]);
    expect(g[4].addresses).toEqual([5, 15, 25]);
  });

  it('canal absent sur une fixture : canal NON commun (jamais de commande croisée)', () => {
    const g = resolveGroupChannels([fixture(1, WASH), fixture(11, WASH.slice(0, 3))]);
    const byPos = (p: number) => g.find((c) => c.pos === p)!;
    // Les 3 premiers canaux sont communs
    expect(byPos(0).common).toBe(true);
    expect(byPos(2).common).toBe(true);
    // Les 2 suivants n'existent que sur la 1re fixture → non communs
    expect(byPos(3).common).toBe(false);
    expect(byPos(4).common).toBe(false);
    expect(byPos(3).addresses).toEqual([]);
  });

  it('type différent à la même position : canal NON commun', () => {
    // La 2e fixture a un Gobo là où la 1re a un Pan
    const g = resolveGroupChannels([fixture(1, WASH), fixture(11, ['Intensity', 'Colour', 'Colour', 'Colour', 'Gobo'])]);
    const shutter = g.find((c) => c.pos === 4)!;
    expect(shutter.type).toBe('Shutter');
    expect(shutter.common).toBe(false);
    expect(shutter.addresses).toEqual([]);
    // Les canaux identiques restent communs
    expect(g.find((c) => c.pos === 0)!.common).toBe(true);
    expect(g.find((c) => c.pos === 1)!.common).toBe(true);
  });

  it('groupe vide ou sans canaux : aucun canal (fail-safe)', () => {
    expect(resolveGroupChannels([])).toEqual([]);
    expect(resolveGroupChannels([{ channels: [] }])).toEqual([]);
  });

  it('la position est l’index du mode, pas le nom du canal', () => {
    const g = resolveGroupChannels([fixture(1, ['Intensity', 'Pan', 'Tilt'])]);
    expect(g.map((c) => c.pos)).toEqual([0, 1, 2]);
    expect(g.map((c) => c.type)).toEqual(['Intensity', 'Pan', 'Tilt']);
  });
});

describe('Écriture groupée — propagation aux N fixtures', () => {
  it('une écriture de canal touche exactement une adresse par fixture', () => {
    const analyses = [fixture(1, WASH), fixture(11, WASH), fixture(21, WASH)];
    const g = resolveGroupChannels(analyses);
    const dimmer = g.find((c) => c.type === 'Intensity')!;

    // Simule l'écriture groupée (une seule adresse touchée par fixture)
    const written: number[] = [];
    for (const addr of dimmer.addresses) written.push(addr);

    expect(written).toEqual([1, 11, 21]);
    expect(new Set(written).size).toBe(3); // aucune adresse dupliquée
  });

  it('les canaux RGB du groupe pointent sur R/G/B de chaque fixture', () => {
    const analyses = [fixture(1, ['Intensity', 'Colour', 'Colour', 'Colour']), fixture(11, ['Intensity', 'Colour', 'Colour', 'Colour'])];
    const g = resolveGroupChannels(analyses);
    const rgb = [g.find((c) => c.pos === 1)!, g.find((c) => c.pos === 2)!, g.find((c) => c.pos === 3)!];
    expect(rgb.every((c) => c.common)).toBe(true);
    expect(rgb[0].addresses).toEqual([2, 12]);
    expect(rgb[1].addresses).toEqual([3, 13]);
    expect(rgb[2].addresses).toEqual([4, 14]);
  });
});

describe('Homogénéité du groupe', () => {
  const f = (over: Partial<{ manufacturer: string; model: string; modeName: string }>) => ({
    manufacturer: 'Test',
    model: 'Wash 300',
    modeName: '5ch',
    ...over,
  });

  it('même modèle + même mode → groupe homogène', () => {
    expect(isHomogeneousGroup([f({}), f({}), f({})])).toBe(true);
  });

  it('modèle différent → groupe hétérogène', () => {
    expect(isHomogeneousGroup([f({}), f({ model: 'Wash 500' })])).toBe(false);
  });

  it('mode différent → groupe hétérogène', () => {
    expect(isHomogeneousGroup([f({}), f({ modeName: '8ch' })])).toBe(false);
  });

  it('identité = fabricant + modèle + mode', () => {
    expect(fixtureIdentity(f({}))).toBe('Test Wash 300 · 5ch');
  });
});
