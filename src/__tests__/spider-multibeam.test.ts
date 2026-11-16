/**
 * Test : fixture spider RGBW multi-têtes — simulation d'un mode avec 4 pixels RGBW indépendants.
 */
import { describe, it, expect } from 'vitest';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import { dispatchChannelsByFixture, normalizeDmxBuffer } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';

// Crée une def "spider" synthétique : 4 têtes RGBW indépendantes
function makeSpiderDef() {
  const channels: any[] = [
    { name: 'LED1 Red', type: 'Colour', offset: 0 },
    { name: 'LED1 Green', type: 'Colour', offset: 1 },
    { name: 'LED1 Blue', type: 'Colour', offset: 2 },
    { name: 'LED1 White', type: 'Colour', offset: 3 },
    { name: 'LED2 Red', type: 'Colour', offset: 4 },
    { name: 'LED2 Green', type: 'Colour', offset: 5 },
    { name: 'LED2 Blue', type: 'Colour', offset: 6 },
    { name: 'LED2 White', type: 'Colour', offset: 7 },
    { name: 'LED3 Red', type: 'Colour', offset: 8 },
    { name: 'LED3 Green', type: 'Colour', offset: 9 },
    { name: 'LED3 Blue', type: 'Colour', offset: 10 },
    { name: 'LED3 White', type: 'Colour', offset: 11 },
    { name: 'LED4 Red', type: 'Colour', offset: 12 },
    { name: 'LED4 Green', type: 'Colour', offset: 13 },
    { name: 'LED4 Blue', type: 'Colour', offset: 14 },
    { name: 'LED4 White', type: 'Colour', offset: 15 },
  ];
  return {
    id: 'spider-test',
    manufacturer: 'Test',
    model: 'Spider-RGBW-4Head',
    type: 'Moving Head' as const,
    author: 'test',
    modes: [{ name: '4 Head RGBW', channels }],
  };
}

describe('Spider RGBW 4-têtes — analyse multi-segments', () => {
  const def = makeSpiderDef();

  it('analyse : 4 segments RGBW détectés', () => {
    const pf = {
      fixtureDefId: def.id, manufacturer: 'Test', model: 'Spider-RGBW-4Head',
      fixtureType: 'Moving Head', modeIndex: 0, modeName: '4 Head RGBW',
      universeId: 'u1', startAddress: 1, channelCount: 16,
      name: 'Spider', tier: 'primary', id: 'fx-spider-test',
    } as any;

    const fa = analyzeFixtureChannels(pf, def);
    console.log('[SPIDER] rgbSegments:', fa.rgbSegments?.length,
      'rgbOffsets:', fa.rgbOffsets,
      'intensityOffset:', fa.intensityOffset);

    expect(fa.rgbSegments!.length).toBe(4);
    // Vérif offsets de chaque segment
    expect(fa.rgbSegments![0].r).toBe(0);
    expect(fa.rgbSegments![0].g).toBe(1);
    expect(fa.rgbSegments![0].b).toBe(2);
    expect(fa.rgbSegments![0].w).toBe(3);
    expect(fa.rgbSegments![1].r).toBe(4);
    expect(fa.rgbSegments![1].g).toBe(5);
    expect(fa.rgbSegments![1].b).toBe(6);
    expect(fa.rgbSegments![1].w).toBe(7);
    expect(fa.rgbSegments![2].r).toBe(8);
    expect(fa.rgbSegments![3].r).toBe(12);
  });

  it('dispatch : les canaux atterrissent dans le bon univers', () => {
    const pf = {
      fixtureDefId: def.id, manufacturer: 'Test', model: 'Spider-RGBW-4Head',
      fixtureType: 'Moving Head', modeIndex: 0, modeName: '4 Head RGBW',
      universeId: 'u1', startAddress: 1, channelCount: 16,
      name: 'Spider', tier: 'primary', id: 'fx-spider-test',
    } as any;

    const programmer = { 1: 255, 2: 0, 3: 0, 6: 255, 7: 255, 10: 255 };
    const dispatched = dispatchChannelsByFixture(programmer, [pf], [{ id: 'u1' }] as any);
    const keys = Array.from(dispatched.keys());
    expect(keys.length).toBeGreaterThan(0);
    const vals = dispatched.get(Number(keys[0]))!;
    expect(vals[1]).toBe(255);  // LED1 Red
    expect(vals[6]).toBe(255);  // LED2 Blue
    expect(vals[10]).toBe(255); // LED3 Blue
  });
});
