/**
 * Probe décisive : parse le QXF RÉEL embarqué (resources/fixtures/ADB-Warp-M.qxf)
 * via le vrai parseur FixtureLibrary.parseQLC, puis analyse + calcule le DMX
 * exactement comme le fait dmx-playback.ts en session.
 *
 * But : savoir si, PENDANT le test de l'utilisateur (exe v1.0.35, ADB-Warp-M.json
 * absent de userData à 15:38-15:48), la def "ADB-Warp-M" était résolvable via le
 * QXF embarqué (→ chemin A = lumière OK) ou si parseQLC la résolvait différemment
 * (id ≠ 'ADB-Warp-M' / intensityOffset ≠ 25 → chemin fallback = ch1 Control = noir).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { computeDmxForCue } from '../hooks/dmx-playback';

const QXF = path.join(process.cwd(), 'resources', 'fixtures', 'ADB-Warp-M.qxf');

describe('ADB-Warp-M via le QXF embarqué (parseQLC réel)', () => {
  let lib: FixtureLibrary;
  let def: any;
  let parsedId: string | undefined;

  beforeAll(async () => {
    expect(fs.existsSync(QXF)).toBe(true);
    lib = new FixtureLibrary();
    const xml = fs.readFileSync(QXF, 'utf-8');
    const p = await lib.parseQLC(xml, QXF);
    parsedId = p?.id;
    def = p;
    console.log('[QXF-PROBE] parsed id=', parsedId, 'manufacturer=', p?.manufacturer, 'model=', p?.model);
    console.log('[QXF-PROBE] modes=', (p?.modes || []).map((m: any) => m.name).join(' | '));
  }, 30000);

  it('le QXF se parse et son id répond à get() (chemin getDefinition exact)', async () => {
    expect(def).toBeTruthy();
    if (def) lib.add(def);
    const lookups = ['ADB-Warp-M', 'ADB-Warp M', 'ADB-WARP-M', 'adb-warp-m', 'ADB-WARPM'];
    for (const id of lookups) {
      const hit = lib.get(id);
      console.log(`[QXF-PROBE] get('${id}') ->`, hit?.id ?? '(undefined)');
    }
  });

  it('la mode "34 Channel" analyse vers intensityOffset=25 (vrai dimmer externe)', () => {
    if (!def?.modes?.find((m: any) => m.name === '34 Channel')) {
      console.log('[QXF-PROBE] pas de mode 34 Channel — modes réels :',
        (def?.modes || []).map((m: any) => m.name));
      return;
    }
    const mode = def.modes.find((m: any) => m.name === '34 Channel');
    console.log('[QXF-PROBE] mode 34 Channel: nb canaux=', mode.channels.length);
    const chTypes: string[] = [];
    mode.channels.forEach((c: any, i: number) => {
      chTypes.push(`${i}:${c.name}=${c.type}`);
    });
    console.log('[QXF-PROBE] channels=', chTypes.join(' | '));

    const pf = {
      fixtureDefId: 'ADB-Warp-M', manufacturer: 'ADB', model: 'Warp M',
      fixtureType: 'Moving Head', modeIndex: 0, modeName: '34 Channel',
      universeId: 'universe-1', startAddress: 1, channelCount: 34,
      name: 'ADB Warp M', tier: 'primary', thumbnailId: 'mh-wash',
      id: 'fx-1788788587416-w4r6qetj',
    } as any;

    const fa = analyzeChannels(pf, def);
    console.log('[QXF-PROBE] analysis intensityOffset=', fa.intensityOffset,
      'pan=', fa.panOffsets, 'tilt=', fa.tiltOffsets,
      'rgbSegments=', fa.rgbSegments.length, 'wheelOffset=', fa.wheelOffset,
      'shutterOffset=', fa.shutterOffset, 'zoomOffset=', fa.zoomOffset);

    const cue = {
      time: 10, section: 'verse', intensity: 'high', color: '#ff0000',
      movement: 'sweep', effect: 'vegas', energy: 0.8, colors: ['#ff0000'],
    } as any;
    const defs = new Map<any, any>([['ADB-Warp-M', def]]);
    const dmx = computeDmxForCue(cue, [pf], defs, [{ id: 'universe-1' }], { primary: 100, secondary: 70, tertiary: 40 });
    for (const d of dmx) {
      const keys = Object.keys(d.channelValues).map(Number).sort((a, b) => a - b);
      const nonzero = keys.filter(k => (d.channelValues[k] ?? 0) > 0);
      console.log('[QXF-PROBE] universe=', d.universe, 'all=', keys.join(','), 'nonzero=', nonzero.join(','));
      console.log('[QXF-PROBE] CH1 value=', d.channelValues[1], '(Control=Fire/Park/Online)',
        ' CH25 External dimmer=', d.channelValues[25], ' CH26=', d.channelValues[26]);
    }
    expect(fa.intensityOffset).toBe(25);
    expect(nonzeroIncludes(dmx, 25) || nonzeroIncludes(dmx, 26)).toBe(true);
  });
});

function nonzeroIncludes(dmx: any[], ch: number): boolean {
  return dmx.some(d => (d.channelValues[ch] ?? 0) > 0);
}