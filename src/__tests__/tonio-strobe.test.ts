import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { computeDmxCues } from '../hooks/dmx-cues';
import { computeDmxForCue } from '../hooks/dmx-playback';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';

function loadTonioDef(): DmxFixtureDefinition {
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'fixtures', 'custom', 'custom-tonio-6-arm.json'), 'utf8');
  return JSON.parse(raw);
}

function tonioFixture(): PatchedFixture {
  const def = loadTonioDef();
  return {
    id: 'tonio-diag',
    fixtureDefId: 'custom-tonio-6-arm',
    manufacturer: 'Tonio',
    model: '6 arm',
    fixtureType: 'Flower',
    modeIndex: 0,
    modeName: '22ch',
    universeId: 'u1',
    startAddress: 1,
    channelCount: def.modes[0].channels.length,
    name: 'Tonio 6 arm diag',
    tier: 'primary',
  };
}

describe('Tonio 6 arm — canal Strobe dédié (fix strobe permanent)', () => {
  it('T1: analyse — le canal « Strobe » est un strobeOffset, jamais shutter/effect', () => {
    const fa = analyzeChannels(tonioFixture(), loadTonioDef());
    expect(fa.strobeOffset).toBe(10); // canal 11 « Strobe »
    expect(fa.shutterOffset).toBe(null);
    expect(fa.effectOffset).toBe(null);
    expect(fa.intensityOffset).toBe(9);
    expect(fa.panOffsets).toEqual([0]);
    expect(fa.tiltOffsets).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('T2: classification par nom — composite « Shutter / Strobe » et « Strobe Speed » exclus', () => {
    const def = loadTonioDef();
    const mk = (channels: any[]): PatchedFixture => ({
      id: 't2', fixtureDefId: 'x', manufacturer: 'x', model: 'x', fixtureType: 'Other',
      modeIndex: 0, modeName: 'm', universeId: 'u1', startAddress: 1, channelCount: channels.length,
      name: 't2', tier: 'primary',
    });
    const d = (channels: any[]): DmxFixtureDefinition => ({ id: 'x', manufacturer: 'x', model: 'x', modes: [{ name: 'm', channels }] });

    // « Shutter / Strobe » = vrai shutter composite → shutterOffset, PAS strobeOffset
    const composite = d([{ name: 'Shutter / Strobe', type: 'Shutter' }]);
    const faC = analyzeChannels(mk([{ name: 'Shutter / Strobe', type: 'Shutter' }]), composite);
    expect(faC.shutterOffset).toBe(0);
    expect(faC.strobeOffset).toBe(null);

    // « Strobe Speed » = paramètre → ni shutter ni strobe
    const faS = analyzeChannels(mk([{ name: 'Strobe Speed', type: 'Speed' }]), d([{ name: 'Strobe Speed', type: 'Speed' }]));
    expect(faS.strobeOffset).toBe(null);

    // « Strobe » simple typé Shutter (import QLC+) → strobeOffset (fix du 255 permanent)
    const faQ = analyzeChannels(mk([{ name: 'Strobe', type: 'Shutter' }]), d([{ name: 'Strobe', type: 'Shutter' }]));
    expect(faQ.strobeOffset).toBe(0);
    expect(faQ.shutterOffset).toBe(null);

    // Garde 0=Closed : « Strobe » dont la 1re cap couvre 0 en « Closed » → shutter
    const closedCaps = [{ min: 0, max: 7, name: 'Closed' }, { min: 8, max: 255, name: 'Strobe' }];
    const faG = analyzeChannels(mk([{ name: 'Strobe', type: 'Shutter', capabilities: closedCaps }]), d([{ name: 'Strobe', type: 'Shutter', capabilities: closedCaps }]));
    expect(faG.strobeOffset).toBe(null);
    expect(faG.shutterOffset).toBe(0);
  });

  it('T3: cues générées — canal Strobe à 0 hors strobe, valeur strobe en drop', () => {
    const def = loadTonioDef();
    const pf = tonioFixture();
    const defs = new Map<string, DmxFixtureDefinition>();
    defs.set('custom-tonio-6-arm', def);
    const cues = [
      { time: 0, section: 'verse', effect: 'static', intensity: 'high', colors: ['#ff0000'], color: '#ff0000', strobe: true },
      { time: 8, section: 'drop', effect: 'static', intensity: 'very-high', colors: ['#0000ff'], color: '#0000ff', strobe: true },
    ];
    const out = computeDmxCues({ cues: cues as any, patchedFixtures: [pf], fixtureDefs: defs, universeIds: ['u1'] });
    const verse = out.find((c) => c.section === 'verse')!;
    const drop = out.find((c) => c.section === 'drop')!;
    // startAddress=1 → canal 10 = Dimmer, canal 11 = Strobe
    expect(verse.channelValues[11]).toBe(0); // jamais 255, jamais 128 (pulse)
    expect(verse.channelValues[10]).toBeGreaterThan(0); // dimmer actif
    expect(drop.channelValues[11]).toBeGreaterThanOrEqual(8); // strobe demandé
    expect(drop.channelValues[11]).toBeLessThanOrEqual(255);
  });

  it('T5: playback live — pas de simulate dimmer quand strobeOffset ; strobe via le canal', () => {
    const def = loadTonioDef();
    const pf = tonioFixture();
    const defs = new Map<string, DmxFixtureDefinition>();
    defs.set('custom-tonio-6-arm', def);
    const universes = [{ id: 'u1' }];

    // Cue verse : strobe off → canal 11 = 0, dimmer normal
    const outVerse = computeDmxForCue(
      { time: 0, section: 'verse', intensity: 'high', strobe: true, energy: 0.8 } as any,
      [pf], defs, universes,
    );
    const v = outVerse[0].channelValues;
    expect(v[11]).toBe(0);
    expect(v[10]).toBeGreaterThan(0);

    // Cue drop : strobe on → canal 11 = valeur de strobe (8-250), dimmer normal
    // (PAS d'oscillation du dimmer : le simulate est exclu quand strobeOffset existe)
    const outDrop = computeDmxForCue(
      { time: 0, section: 'drop', intensity: 'very-high', strobe: true, energy: 0.95 } as any,
      [pf], defs, universes,
    );
    const d = outDrop[0].channelValues;
    expect(d[11]).toBeGreaterThanOrEqual(8);
    expect(d[11]).toBeLessThanOrEqual(250);
    expect(d[10]).toBeGreaterThan(0); // dimmer non oscillé
  });
});
