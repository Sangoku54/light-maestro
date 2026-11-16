/**
 * Sécurité strobe (prérequis commercialisation — photosensibilité).
 *
 * 1. `clampStrobeLimit` : toute limite saisie (projet, preset, MIDI) est
 *    ramenée dans [1, STROBE_SAFE_MAX=25] (défaut 10 si illisible).
 * 2. `computeDmxCues` (autoscript statique) : le taux de strobe calculé
 *    (jusqu'à 255 en drop AVANT ce fix — `strobeLimit` accepté mais jamais
 *    appliqué) est désormais plafonné par la limite sûre.
 * 3. `safetyAccepted` : l'avertissement first-run est persisté (une fois).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { computeDmxCues, clampStrobeLimit, STROBE_SAFE_MAX } from '../hooks/dmx-cues';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';
import type { PatchedFixture } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';

function loadTonioDef(): DmxFixtureDefinition {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'fixtures', 'custom', 'custom-tonio-6-arm.json'), 'utf8');
  return JSON.parse(raw);
}

function tonioFixture(): PatchedFixture {
  const def = loadTonioDef();
  return {
    id: 'tonio-safety',
    fixtureDefId: 'custom-tonio-6-arm',
    manufacturer: 'Tonio',
    model: '6 arm',
    fixtureType: 'Flower',
    modeIndex: 0,
    modeName: '22ch',
    universeId: 'u1',
    startAddress: 1,
    channelCount: def.modes[0].channels.length,
    name: 'Tonio safety',
    tier: 'primary',
  };
}

const dropCue = {
  time: 8, section: 'drop', effect: 'static', intensity: 'very-high',
  colors: ['#0000ff'], color: '#0000ff', strobe: true,
} as any;

describe('strobe — plafond sûr', () => {
  it('STROBE_SAFE_MAX = 25 (même échelle que le max du slider UI)', () => {
    expect(STROBE_SAFE_MAX).toBe(25);
  });

  it('clampStrobeLimit : défaut 10, plancher 1, plafond 25', () => {
    expect(clampStrobeLimit(undefined)).toBe(10);
    expect(clampStrobeLimit(Number.NaN)).toBe(10);
    expect(clampStrobeLimit('x')).toBe(10);
    expect(clampStrobeLimit(10)).toBe(10);
    expect(clampStrobeLimit(0)).toBe(1);
    expect(clampStrobeLimit(-5)).toBe(1);
    expect(clampStrobeLimit(25)).toBe(25);
    expect(clampStrobeLimit(255)).toBe(25);
    expect(clampStrobeLimit(500)).toBe(25);
  });

  it('computeDmxCues : strobe en drop plafonné à la limite par défaut (10), jamais 255', () => {
    const def = loadTonioDef();
    const defs = new Map<string, DmxFixtureDefinition>();
    defs.set('custom-tonio-6-arm', def);
    const out = computeDmxCues({
      cues: [dropCue], patchedFixtures: [tonioFixture()], fixtureDefs: defs, universeIds: ['u1'],
    });
    const drop = out.find((c) => c.section === 'drop')!;
    // Canal 11 = Strobe dédié : demandé (≥ 8) mais plafonné (≤ 10 par défaut)
    expect(drop.channelValues[11]).toBeGreaterThanOrEqual(8);
    expect(drop.channelValues[11]).toBeLessThanOrEqual(10);
  });

  it('computeDmxCues : même avec strobeLimit=500, le plafond absolu (25) tient', () => {
    const def = loadTonioDef();
    const defs = new Map<string, DmxFixtureDefinition>();
    defs.set('custom-tonio-6-arm', def);
    const out = computeDmxCues({
      cues: [dropCue], patchedFixtures: [tonioFixture()], fixtureDefs: defs,
      universeIds: ['u1'], strobeLimit: 500,
    });
    const drop = out.find((c) => c.section === 'drop')!;
    expect(drop.channelValues[11]).toBeLessThanOrEqual(25);
  });
});

describe('safety — acceptation persistée (first-run)', () => {
  it('défaut false, acceptSafety() → true', () => {
    useAppStore.setState({ safetyAccepted: false });
    expect(useAppStore.getState().safetyAccepted).toBe(false);
    useAppStore.getState().acceptSafety();
    expect(useAppStore.getState().safetyAccepted).toBe(true);
    // Remise à l'état initial pour les autres suites
    useAppStore.setState({ safetyAccepted: false });
  });
});
