/**
 * Preuve : Acme Dotline 360 (QXF réel embarqué) — chaîne fader → bridge → lecture 3D.
 *
 * Contexte utilisateur : nouveau projet, fixture muette hors modale.
 * Le Dotline 360 est typé "Moving Head" (1 faisceau) avec Tilt sans Pan et
 * 6 pixels RGBW. Ce test parse son QXF réel, vérifie l'analyse (dimmer, RGB,
 * tilt trouvés) puis rejoue des écritures programmeur CREUSES (quelques
 * faders) jusqu'à la lecture normalisée de la 3D.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { dispatchChannelsByFixture, normalizeDmxBuffer } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import '../hooks/useProgrammerSync'; // source 'programmer' LTP 85

const QXF = path.join(process.cwd(), 'resources', 'fixtures', 'Acme-Dotline360.qxf');

describe('Acme Dotline 360 via le QXF embarqué (parseQLC réel)', () => {
  let def: any;

  beforeAll(async () => {
    expect(fs.existsSync(QXF)).toBe(true);
    const lib = new FixtureLibrary();
    const xml = fs.readFileSync(QXF, 'utf-8');
    def = await lib.parseQLC(xml, QXF);
    expect(def).toBeTruthy();
  }, 30000);

  it('mode 14ch : dimmer + RGB + tilt résolus (pas de pan)', () => {
    const mode = def.modes.find((m: any) => m.name === '14 Channel');
    expect(mode).toBeTruthy();
    const pf = {
      fixtureDefId: def.id, manufacturer: 'Acme', model: 'Dotline360',
      fixtureType: 'Moving Head', modeIndex: def.modes.indexOf(mode), modeName: mode.name,
      universeId: 'u1', startAddress: 1, channelCount: mode.channels.length,
      name: 'Dotline', tier: 'primary', id: 'fx-dotline-test',
    } as any;
    const fa: any = analyzeChannels(pf, def);
    console.log('[DOTLINE] intensityOffset=', fa.intensityOffset,
      'rgbOffsets=', fa.rgbOffsets, 'rgbSegments=', fa.rgbSegments?.length,
      'pan=', fa.panOffsets, 'tilt=', fa.tiltOffsets);
    // Dimmer ch4 (offset 3), RGB ch10-12 (offsets 9-11), Tilt ch1 (offset 0), pas de Pan
    expect(fa.intensityOffset).toBe(3);
    expect(fa.rgbOffsets).toEqual([9, 10, 11]);
    expect(fa.tiltOffsets).toContain(0);
    expect(fa.panOffsets ?? []).toEqual([]);
  });

  it('faders creux (dimmer+RGB) → lus aux bons index côté 3D', () => {
    dmxBridge.clearAll();
    const mode = def.modes.find((m: any) => m.name === '14 Channel');
    const pf = {
      fixtureDefId: def.id, manufacturer: 'Acme', model: 'Dotline360',
      fixtureType: 'Moving Head', modeIndex: def.modes.indexOf(mode), modeName: mode.name,
      universeId: 'u1', startAddress: 1, channelCount: mode.channels.length,
      name: 'Dotline', tier: 'primary', id: 'fx-dotline-test',
    } as any;
    // Faders : dimmer 255 (addr 4) + blanc (addr 10,11,12) — buffer CREUX, 4 canaux
    const programmer = { 4: 255, 10: 255, 11: 255, 12: 255 };
    const dispatched = dispatchChannelsByFixture(programmer, [pf], [{ id: 'u1' }] as any);
    expect(dispatched.get(0)).toBeDefined();
    for (const [uni, vals] of dispatched.entries()) dmxBridge.write('programmer', uni, vals);
    const raw = dmxBridge.getChannels(0);
    expect(raw).toBeDefined();
    // Lecture normalisée EXACTEMENT comme la boucle 3D
    const data = normalizeDmxBuffer(raw!);
    const fa: any = analyzeChannels(pf, def);
    const base = pf.startAddress - 1;
    expect(data[base + fa.intensityOffset]).toBe(255);
    expect(data[base + fa.rgbOffsets[0]]).toBe(255);
    expect(data[base + fa.rgbOffsets[1]]).toBe(255);
    expect(data[base + fa.rgbOffsets[2]]).toBe(255);
  });
});
