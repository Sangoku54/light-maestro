import { describe, it, expect } from 'vitest';
import {
  tierToCategory,
  toAutoloopFixtures,
  defaultColorCues,
  defaultPositionCues,
  defaultLaserBeamCues,
  buildSoundswitchBanks,
  generateBankLoops,
  DEFAULT_BANK_CONFIGS,
} from '../engine/autoloop-runtime';
import { BANKS, PER_BANK, BankManager } from '../engine/autoloop-banks';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel => ({
  name,
  type,
  offset,
});

function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}

function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string }): PatchedFixture {
  return {
    manufacturer: 'Test',
    model: partial.fixtureDefId,
    fixtureType: 'moving_head',
    modeIndex: 0,
    modeName: 'm',
    universeId: 'u1',
    startAddress: 1,
    channelCount: 6,
    name: partial.id,
    tier: 'primary',
    ...partial,
  };
}

// Moving head : Pan@0, Tilt@1, Dimmer@2, R@3, G@4, B@5.
const mover = def('mover-rgb', [
  ch('Pan', 'Pan', 0),
  ch('Tilt', 'Tilt', 1),
  ch('Dimmer', 'Intensity', 2),
  ch('Red', 'Colour', 3),
  ch('Green', 'Colour', 4),
  ch('Blue', 'Colour', 5),
]);

// RGB wash (sans pan/tilt) : Dimmer@0, R@1, G@2, B@3.
const wash = def('wash-rgb', [
  ch('Dimmer', 'Intensity', 0),
  ch('Red', 'Colour', 1),
  ch('Green', 'Colour', 2),
  ch('Blue', 'Colour', 3),
]);

function defsOf(...defs: DmxFixtureDefinition[]): Map<string, DmxFixtureDefinition> {
  return new Map(defs.map((d) => [d.id, d]));
}

const universes = [{ id: 'u1' }, { id: 'u2' }];

describe('tierToCategory', () => {
  it('moving head (pan/tilt) → Spot', () => {
    expect(tierToCategory('primary', true)).toBe('Spot');
    expect(tierToCategory('secondary', true)).toBe('Spot');
  });

  it('fixe sans pan/tilt → Wash selon le tier', () => {
    expect(tierToCategory('primary', false)).toBe('Wash_Primary');
    expect(tierToCategory('secondary', false)).toBe('Wash_Secondary');
    expect(tierToCategory('tertiary', false)).toBe('Wash_Secondary');
  });
});

describe('toAutoloopFixtures', () => {
  it('mappe les offsets pan/tilt/rgb/dimmer vers channelMap', () => {
    const fixtures = [
      pf({ id: 'm1', fixtureDefId: 'mover-rgb', startAddress: 1 }),
      pf({ id: 'w1', fixtureDefId: 'wash-rgb', fixtureType: 'wash', startAddress: 9, tier: 'secondary' }),
    ];
    const mapped = toAutoloopFixtures(fixtures, defsOf(mover, wash), universes);

    const moverFixture = mapped.find((f) => f.id === 'm1')!;
    expect(moverFixture.category).toBe('Spot');
    expect(moverFixture.address).toBe(1);
    expect(moverFixture.channelMap).toEqual({ pan: 0, tilt: 1, dimmer: 2, red: 3, green: 4, blue: 5 });

    const w = mapped.find((f) => f.id === 'w1')!;
    expect(w.category).toBe('Wash_Secondary');
    expect(w.address).toBe(9);
    expect(w.channelMap).toEqual({ dimmer: 0, red: 1, green: 2, blue: 3 });
    expect(w.channelMap['pan']).toBeUndefined(); // pas de pan sur un wash
  });

  it("saute les fixtures désactivées et mappe l'univers", () => {
    const fixtures = [
      pf({ id: 'm1', fixtureDefId: 'mover-rgb', startAddress: 1 }),
      pf({ id: 'm2', fixtureDefId: 'mover-rgb', startAddress: 1, universeId: 'u2' }),
      pf({ id: 'm3', fixtureDefId: 'mover-rgb', startAddress: 9, enabled: false }),
    ];
    const mapped = toAutoloopFixtures(fixtures, defsOf(mover), universes);
    expect(mapped.map((f) => f.id)).toEqual(['m1', 'm2']);
    expect(mapped[0].universe).toBe(0);
    expect(mapped[1].universe).toBe(1);
  });
});

describe('buildSoundswitchBanks', () => {
  it('construit une matrice 4×32 avec des loops dans les banques', () => {
    const fixtures = toAutoloopFixtures(
      [
        pf({ id: 'm1', fixtureDefId: 'mover-rgb', startAddress: 1 }),
        pf({ id: 'w1', fixtureDefId: 'wash-rgb', fixtureType: 'wash', startAddress: 9 }),
      ],
      defsOf(mover, wash),
      universes,
    );
    const banks = buildSoundswitchBanks(fixtures);

    expect(banks).toBeInstanceOf(BankManager);
    expect(banks.banks.length).toBe(BANKS);
    expect(banks.banks.every((row) => row.length === PER_BANK)).toBe(true);

    // Au moins un loop non-null par banque (une catégorie est présente au minimum).
    for (let b = 0; b < BANKS; b++) {
      const nonNull = banks.banks[b].filter((l) => l !== null);
      expect(nonNull.length).toBeGreaterThan(0);
    }
  });

  it('les loops générés sont lisibles par le moteur (catégorie + clés)', () => {
    const fixtures = toAutoloopFixtures(
      [pf({ id: 'm1', fixtureDefId: 'mover-rgb', startAddress: 1 })],
      defsOf(mover),
      universes,
    );
    const loop = generateBankLoops(fixtures, DEFAULT_BANK_CONFIGS[0])[0];
    expect(loop.category).toBe('Spot');
    expect(loop.keys.length).toBeGreaterThan(0);
  });

  it('defaultColorCues / defaultPositionCues fournissent des cues cohérents', () => {
    expect(defaultColorCues().map((c) => c.attribute)).toEqual(['color', 'color', 'color', 'color']);
    expect(defaultPositionCues().map((p) => p.shape)).toEqual(['circle', 'figure_eight']);
  });

  it('cues laser SoundSwitch : rotations + vitesses oscillantes (plus de 160 figé)', () => {
    const cues = defaultLaserBeamCues();
    const attrs = cues.map((c) => c.attribute);
    expect(attrs).toContain('laserRot1');
    expect(attrs).toContain('laserSpeedScan');
    expect(attrs).toContain('laserSpeedPattern');

    // Chaque axe de rotation a 2 valeurs différentes (oscillation 70/186).
    for (const key of ['laserRot1', 'laserRot2', 'laserRot3']) {
      const perAxis = cues.filter((c) => c.attribute === key);
      expect(perAxis.length).toBe(2);
      expect(perAxis[0].values[key]).not.toBe(perAxis[1].values[key]);
    }

    // Vitesses : 96 ↔ 224, plus de valeur unique figée.
    const patt = cues.filter((c) => c.attribute === 'laserSpeedPattern').map((c) => c.values.laserSpeedPattern);
    expect(patt).toEqual(expect.arrayContaining([96, 224]));
    const scan = cues.filter((c) => c.attribute === 'laserSpeedScan').map((c) => c.values.laserSpeedScan);
    expect(scan).toEqual(expect.arrayContaining([96, 224]));
    expect(cues.some((c) => c.values.laserSpeedPattern === 160)).toBe(false);
  });
});
