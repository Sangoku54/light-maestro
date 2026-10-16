/**
 * Test de la chaîne complète UI : parse QXF → mode.channels → analyzeFixtureChannels(local) → dimmerIdx/rgbGroup trouvés.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';

// Copie de la fonction locale analyzeFixtureChannels de DesignView.tsx
interface AnalyzedChannel {
  index: number;
  name: string;
  type: string;
  dmxAddress: number;
  defaultValue?: number;
  capabilities?: any[];
}
interface AnalyzedFixtureChannels {
  fixture: any;
  channels: AnalyzedChannel[];
  rgbGroup?: { r: number; g: number; b: number };
  panIdx?: number;
  tiltIdx?: number;
  dimmerIdx?: number;
  shutterIdx?: number;
  goboIdx?: number;
  colorWheelIdx?: number;
}

function analyzeFixtureChannels(
  fixture: any,
  modeChannels: Array<{ name: string; type: string; defaultValue?: number; capabilities?: any[]; offset?: number }>
): AnalyzedFixtureChannels {
  const channels: AnalyzedChannel[] = modeChannels.map((ch, i) => ({
    index: ch.offset ?? i,
    name: ch.name || `Ch ${i + 1}`,
    type: ch.type || 'Nothing',
    dmxAddress: fixture.startAddress + (ch.offset ?? i),
    defaultValue: ch.defaultValue,
    capabilities: ch.capabilities,
  }));

  const result: AnalyzedFixtureChannels = { fixture, channels };

  // Identify key channels
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (ch.type === 'Intensity' && result.dimmerIdx === undefined) result.dimmerIdx = i;
    if (ch.type === 'Pan' && result.panIdx === undefined) result.panIdx = i;
    if (ch.type === 'Tilt' && result.tiltIdx === undefined) result.tiltIdx = i;
    if (ch.type === 'Shutter' && result.shutterIdx === undefined) result.shutterIdx = i;
    if (ch.type === 'Gobo' && result.goboIdx === undefined) result.goboIdx = i;
  }

  // RGB group detection : two-pass. First pass scans for a true R-G-B
  // triplet (consecutive Colour channels named Red/Green/Blue). Only
  // after that pass completes do we fall back to colorWheelIdx, so that
  // non-RGB Colour channels like "Foreground Color" / "Background Color"
  // (Acme Dotline 360) don't hijack the slot.
  for (let i = 0; i < channels.length - 2; i++) {
    const c = channels[i];
    const n = c.name.toUpperCase();
    if (c.type !== 'Colour') continue;
    if (!/RED| R |^R$/.test(n)) continue;
    const g = channels[i + 1];
    const b = channels[i + 2];
    if (!g || g.type !== 'Colour') continue;
    if (!b || b.type !== 'Colour') continue;
    const gn = g.name.toUpperCase();
    const bn = b.name.toUpperCase();
    if (/GREEN| G |^G$/.test(gn) && /BLUE| B |^B$/.test(bn)) {
      result.rgbGroup = { r: i, g: i + 1, b: i + 2 };
      break;
    }
  }

  // Second pass : assign colorWheelIdx only to Colour channels not in rgbGroup
  if (!result.rgbGroup) {
    for (let i = 0; i < channels.length; i++) {
      if (channels[i].type === 'Colour' && result.colorWheelIdx === undefined) {
        result.colorWheelIdx = i;
      }
    }
  }

  return result;
}

const QXF = path.join(process.cwd(), 'resources', 'fixtures', 'Acme-Dotline360.qxf');

describe('UI analyse Dotline 360 — chaîne complète', () => {
  let def: any;

  beforeAll(async () => {
    expect(fs.existsSync(QXF)).toBe(true);
    const lib = new FixtureLibrary();
    const xml = fs.readFileSync(QXF, 'utf-8');
    def = await lib.parseQLC(xml, QXF);
    expect(def).toBeTruthy();
  }, 30000);

  it('mode 14ch : le local analyzer trouve dimmerIdx ET rgbGroup', () => {
    const mode = def.modes.find((m: any) => m.name === '14 Channel');
    expect(mode).toBeTruthy();
    console.log('[UI-ANALYZER] mode channels:', mode.channels.length);
    mode.channels.forEach((ch: any, i: number) => {
      console.log(`  ch${i}: name="${ch.name}" type="${ch.type}"`);
    });

    const pf = {
      fixtureDefId: def.id, manufacturer: 'Acme', model: 'Dotline360',
      fixtureType: 'Moving Head', modeIndex: def.modes.indexOf(mode), modeName: mode.name,
      universeId: 'u1', startAddress: 1, channelCount: mode.channels.length,
      name: 'Dotline', tier: 'primary', id: 'fx-dotline-ui-test',
    } as any;

    const result = analyzeFixtureChannels(pf, mode.channels);
    console.log('[UI-ANALYZER] result:', {
      dimmerIdx: result.dimmerIdx,
      rgbGroup: result.rgbGroup,
      tiltIdx: result.tiltIdx,
      panIdx: result.panIdx,
      channelCount: result.channels.length,
    });

    // Le test critique : dimmerIdx DOIT être trouvé
    expect(result.dimmerIdx).toBeDefined();
    expect(result.dimmerIdx).toBeGreaterThan(-1);
    // Et rgbGroup DOIT être trouvé (3 canaux Colour consécutifs)
    expect(result.rgbGroup).toBeDefined();
    expect(result.rgbGroup).not.toBeNull();
    // Vérifions que les adresses DMX sont correctes
    const dimCh = result.channels[result.dimmerIdx!];
    expect(dimCh.dmxAddress).toBe(pf.startAddress + 3); // Dimmer is at offset 3
    console.log('[UI-ANALYZER] dimmer channel:', dimCh);
  });

  it('ACCU Spot Pro 14ch : même vérif', async () => {
    const accuQxf = path.join(process.cwd(), 'resources', 'fixtures', 'American-DJ-Accu-Spot-Pro.qxf');
    expect(fs.existsSync(accuQxf)).toBe(true);
    const lib = new FixtureLibrary();
    const xml = fs.readFileSync(accuQxf, 'utf-8');
    const def2 = await lib.parseQLC(xml, accuQxf);
    expect(def2).toBeTruthy();

    const mode = def2.modes.find((m: any) => m.name.includes('14'));
    expect(mode).toBeTruthy();
    console.log('[ACCUSPOT] mode channels:', mode.channels.length);
    mode.channels.slice(0, 8).forEach((ch: any, i: number) => {
      console.log(`  ch${i}: name="${ch.name}" type="${ch.type}"`);
    });

    const pf = {
      fixtureDefId: def2.id, manufacturer: 'American DJ', model: 'ACCU Spot Pro',
      fixtureType: 'Moving Head', modeIndex: def2.modes.indexOf(mode), modeName: mode.name,
      universeId: 'u1', startAddress: 1, channelCount: mode.channels.length,
      name: 'AccuSpot', tier: 'primary', id: 'fx-accu-ui-test',
    } as any;

    const result = analyzeFixtureChannels(pf, mode.channels);
    console.log('[ACCUSPOT] result:', {
      dimmerIdx: result.dimmerIdx,
      rgbGroup: result.rgbGroup,
      tiltIdx: result.tiltIdx,
      panIdx: result.panIdx,
    });

    expect(result.dimmerIdx).toBeDefined();
    expect(result.panIdx).toBeDefined();
    expect(result.tiltIdx).toBeDefined();
  });
});
