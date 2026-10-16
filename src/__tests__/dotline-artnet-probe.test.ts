/**
 * Test: Art-Net mode (96ch) creates 12 RGBW segments for spider-like multi-head rendering.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';

const QXF = path.join(process.cwd(), 'resources', 'fixtures', 'Acme-Dotline360.qxf');

describe('Art-Net mode — 12 LEDs → 12 RGBW segments', () => {
  let def: any;

  beforeAll(async () => {
    const lib = new FixtureLibrary();
    const xml = fs.readFileSync(QXF, 'utf-8');
    def = await lib.parseQLC(xml, QXF);
    expect(def).toBeTruthy();
  }, 30000);

  it('Art-Net mode : 12 segments RGBW, pas de pan/tilt', () => {
    const mode = def.modes.find((m: any) => m.name.includes('Art-Net'));
    expect(mode).toBeTruthy();
    // 12 LEDs * 4 channels (R/G/B/W) = 48 channels
    expect(mode.channels.length).toBeGreaterThanOrEqual(48);

    const pf = {
      fixtureDefId: def.id, manufacturer: 'Acme', model: 'Dotline360',
      fixtureType: 'Moving Head', modeIndex: def.modes.indexOf(mode), modeName: mode.name,
      universeId: 'u1', startAddress: 1, channelCount: mode.channels.length,
      name: 'Dotline-ArtNet', tier: 'primary', id: 'fx-dotline-artnet',
    } as any;

    const fa = analyzeFixtureChannels(pf, def);
    console.log('[ARTNET] rgbSegments:', fa.rgbSegments?.length,
      'rgbOffsets:', fa.rgbOffsets,
      'intensityOffset:', fa.intensityOffset,
      'ledIntensityOffsets:', fa.ledIntensityOffsets?.length,
      'panOffsets:', fa.panOffsets?.length,
      'tiltOffsets:', fa.tiltOffsets?.length);

    // Should have multiple RGBW segments (one per LED pixel)
    expect(fa.rgbSegments!.length).toBeGreaterThan(1);
    // No pan (this fixture only has tilt)
    expect(fa.panOffsets!.length).toBe(0);
  });

  it('12 segments → multi-head 3D : chaque tête lit sa propre couleur', () => {
    const mode = def.modes.find((m: any) => m.name.includes('Art-Net'));
    const pf = {
      fixtureDefId: def.id, manufacturer: 'Acme', model: 'Dotline360',
      fixtureType: 'Moving Head', modeIndex: def.modes.indexOf(mode), modeName: mode.name,
      universeId: 'u1', startAddress: 1, channelCount: mode.channels.length,
      name: 'Dotline-ArtNet', tier: 'primary', id: 'fx-dotline-artnet',
    } as any;

    const fa = analyzeFixtureChannels(pf, def);
    expect(fa.rgbSegments!.length).toBe(12);

    // Simulate DMX: set each LED to a different color
    const baseAddr = 0;
    const data = new Uint8Array(96);
    for (let i = 0; i < 12; i++) {
      const r = (i * 20) % 256;
      const g = (i * 40) % 256;
      const b = (i * 60) % 256;
      data[fa.rgbSegments![i].r] = r;
      data[fa.rgbSegments![i].g] = g;
      data[fa.rgbSegments![i].b!] = b;
      if (fa.rgbSegments![i].w !== null) data[fa.rgbSegments![i].w!] = 0;
    }

    // Verify each segment reads its own color
    for (let i = 0; i < 12; i++) {
      const seg = fa.rgbSegments![i];
      expect(data[baseAddr + seg.r]).toBe((i * 20) % 256);
      expect(data[baseAddr + seg.g]).toBe((i * 40) % 256);
      expect(data[baseAddr + seg.b!]).toBe((i * 60) % 256);
    }
  });
});
