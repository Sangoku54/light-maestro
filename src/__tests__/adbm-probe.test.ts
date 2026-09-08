import { describe, it, expect } from 'vitest';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { computeDmxForCue } from '../hooks/dmx-playback';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';

describe('ADB-Warp-M probe', () => {
  it('analyzes channels and computes DMX for the custom def', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const def = require('C:/Users/vitte/AppData/Roaming/light-maestro/fixtures/ADB-Warp-M.json') as DmxFixtureDefinition;

    const pf = {
      fixtureDefId: 'ADB-Warp-M',
      manufacturer: 'ADB',
      model: 'Warp M',
      fixtureType: 'Moving Head',
      modeIndex: 0,
      modeName: '34 Channel',
      universeId: 'universe-1',
      startAddress: 1,
      channelCount: 34,
      name: 'ADB Warp M',
      tier: 'primary',
      thumbnailId: 'mh-wash',
      id: 'fx-1788788587416-w4r6qetj',
    } as any;

    const defs = new Map<string, DmxFixtureDefinition>();
    defs.set('ADB-Warp-M', def);

    // ── Path A : def résolue (devrait fonctionner) ──────────────────────────
    const fa = analyzeChannels(pf, def);
    console.log('[PROBE] intensityOffset=', fa.intensityOffset,
      'pan=', fa.panOffsets, 'tilt=', fa.tiltOffsets,
      'rgbSegments=', fa.rgbSegments.length,
      'wheelOffset=', fa.wheelOffset,
      'shutterOffset=', fa.shutterOffset,
      'zoomOffset=', fa.zoomOffset,
      'presetOverride=', fa.presetOverrideOffsets);

    const cue = {
      time: 10,
      section: 'verse',
      intensity: 'high',
      color: '#ff0000',
      movement: 'sweep',
      effect: 'vegas',
      energy: 0.8,
      colors: ['#ff0000'],
    } as any;

    const dmx = computeDmxForCue(cue, [pf], defs, [{ id: 'universe-1' }], { primary: 100, secondary: 70, tertiary: 40 });
    expect(dmx.length).toBeGreaterThan(0);
    for (const d of dmx) {
      const keys = Object.keys(d.channelValues).map(Number).sort((a, b) => a - b);
      const nonzero = keys.filter(k => (d.channelValues[k] ?? 0) > 0);
      console.log('[PROBE-A resolved-def] universe=', d.universe, 'channels=', keys.join(','), 'nonzero=', nonzero.join(','));
    }

    // ── Path B : def NON résolue (fallback nom du modèle) ───────────────────
    // IMITE dmx-playback.ts L609-647 : défaut → def synthétique bâtie sur le nom.
    // "Warp M" ne matche ni rgb/rgbw ni moving-head/beam/spot/wash → Dimmer@0 seul.
    const chCount = pf.channelCount || 1;
    const model = (pf.model || '').toLowerCase();
    const fbChannels: any[] = [{ offset: 0, name: 'Dimmer', type: 'Intensity' }];
    while (fbChannels.length < chCount) fbChannels.push({ offset: fbChannels.length, name: `CH ${fbChannels.length + 1}` });
    const modeObj = { name: 'Default', channelCount: chCount, channels: fbChannels };
    const modes = new Array((pf.modeIndex || 0) + 1).fill(null).map(() => ({ ...modeObj, channels: [...fbChannels] }));
    const fbDef = { id: pf.fixtureDefId, manufacturer: pf.manufacturer || 'Unknown', model: pf.model || pf.name, fixtureType: pf.fixtureType || 'Unknown', modes, wheels: [] } as any;
    const faFallback = analyzeChannels(pf, fbDef);
    console.log('[PROBE-B fallback] intensityOffset=', faFallback.intensityOffset,
      'pan=', faFallback.panOffsets, 'tilt=', faFallback.tiltOffsets, 'rgbSegments=', faFallback.rgbSegments.length);
    const fbDefs = new Map<string, DmxFixtureDefinition>([['ADB-Warp-M', fbDef]]);
    const dmxB = computeDmxForCue(cue, [pf], fbDefs, [{ id: 'universe-1' }], { primary: 100, secondary: 70, tertiary: 40 });
    for (const d of dmxB) {
      const keys = Object.keys(d.channelValues).map(Number).sort((a, b) => a - b);
      const nonzero = keys.filter(k => (d.channelValues[k] ?? 0) > 0);
      console.log('[PROBE-B fallback] universe=', d.universe, 'channels=', keys.join(','), 'nonzero=', nonzero.join(','));
      console.log('[PROBE-B fallback] CH1 (Control sur Warp M) value=', d.channelValues[1], 'CH26 (vrai dimmer externe) value=', d.channelValues[26]);
    }
  });
});