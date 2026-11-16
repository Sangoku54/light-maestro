/**
 * Test de la chaîne complète UI : parse QXF → mode.channels → analyzeFixtureChannels(local) → dimmerIdx/rgbGroup trouvés.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';

// La fonction testée est celle RÉELLEMENT exécutée par l'application
// (extraite de DesignView.tsx vers src/utils/ui-fixture-channels.ts). Avant
// cette extraction, ce test portait une COPIE du code : il passait même si
// l'implémentation de production était cassée.
import { analyzeFixtureChannels } from '../utils/ui-fixture-channels';

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
