/**
 * Sonde « 2 ACCU Spot Pro + matrice » — le fixture à ROUE (pas de RGB) est-elle
 * exploitable par la matrice ? Chaîne complète : analyse → live → couleurs
 * boutons → décodage 3D → piste scène.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { renderMatrixFrame, computeMatrixTrackColors } from '../hooks/rgb-matrix-playback';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import { findBestWheelCap } from '../engine/dmx-color';
import { wheelValueToColor } from '../views/Stage3D';
import type { PatchedFixture } from '../stores/showStore';

const QXF = path.join(process.cwd(), 'resources', 'fixtures', 'American-DJ-Accu-Spot-Pro.qxf');

describe('2 ACCU Spot Pro (roue couleur, sans RGB) + matrice', () => {
  let def: any;
  let fixtures: PatchedFixture[];
  const group = { id: 'g1', fixtureIds: ['accu-1', 'accu-2'] };
  const matrix = {
    id: 'm1', groupId: 'g1', pattern: 'solid', cols: 2, rows: 1,
    speed: 0.5, startColor: '#ff0000', endColor: '#0000ff', width: 100,
    direction: 'forward', offset: 0,
  };

  beforeAll(async () => {
    const lib = new FixtureLibrary();
    def = await lib.parseQLC(fs.readFileSync(QXF, 'utf-8'), QXF);
    fixtures = group.fixtureIds.map((id, i) => ({
      id, fixtureDefId: def.id,
      manufacturer: def.manufacturer, model: def.model,
      fixtureType: 'Moving Head', modeIndex: 1, modeName: def.modes[1].name,
      universeId: 'u1', startAddress: 1 + i * def.modes[1].channels.length,
      channelCount: def.modes[1].channels.length,
      name: 'ACCU ' + (i + 1), tier: 'primary',
    } as unknown as PatchedFixture));
  }, 30000);

  it('analyse : roue couleur détectée (pas de RGB), dimmer + shutter présents', () => {
    const fa = analyzeFixtureChannels(fixtures[0] as any, def);
    console.log('[ACCU] rgbOffsets:', fa.rgbOffsets, 'wheelOffset:', fa.wheelOffset, 'wheelCaps:', fa.wheelCaps?.length, 'dimmer:', fa.intensityOffset, 'shutter:', fa.shutterOffset);
    expect(fa.wheelOffset).not.toBeNull();
    expect(fa.wheelCaps!.length).toBeGreaterThan(3);
    expect(fa.intensityOffset).not.toBeNull();
  });

  it('live : les 2 fixtures reçoivent dimmer 255 + slot de roue', () => {
    const { perUniverse, resolved } = renderMatrixFrame(
      matrix as any, 0.1, fixtures, () => def, () => 0, 0.1,
    );
    const vals = perUniverse.get(0)!;
    console.log('[ACCU] resolved:', resolved, 'vals:', JSON.stringify(vals));
    expect(resolved).toBe(2);
    // Mode 14ch : dimmer offset 11, shutter offset 10, Colour offset 4
    for (let i = 0; i < 2; i++) {
      const base = 1 + i * def.modes[1].channels.length;
      expect(vals[base + 11], `dimmer ${i + 1}`).toBe(255);
      expect(vals[base + 4], `wheel ${i + 1}`).toBeDefined();
    }
  });

  it('couleurs boutons → slot le plus proche → décodage 3D fidèle', () => {
    const fa = analyzeFixtureChannels(fixtures[0] as any, def);
    const cases: Array<[string, number]> = [
      ['#ff0000', 40], ['#00ff00', 60], ['#0000ff', 60],
      ['#ffffff', 30], ['#ffff00', 60], ['#ff00ff', 60],
    ];
    for (const [button, tol] of cases) {
      const best = findBestWheelCap(fa.wheelCaps ?? [], button);
      expect(best, 'slot pour ' + button).toBeTruthy();
      const mid = Math.round((best!.min + best!.max) / 2);
      const c3d = wheelValueToColor(mid, fa.wheelCaps);
      const [r, g, b] = [parseInt(button.slice(1, 3), 16), parseInt(button.slice(3, 5), 16), parseInt(button.slice(5, 7), 16)];
      console.log(`button=${button} → "${best!.name}" [${best!.min}-${best!.max}] → 3D rgb(${Math.round(c3d.r * 255)},${Math.round(c3d.g * 255)},${Math.round(c3d.b * 255)})`);
      expect(Math.abs(c3d.r * 255 - r), 'R ' + button).toBeLessThanOrEqual(tol);
      expect(Math.abs(c3d.g * 255 - g), 'G ' + button).toBeLessThanOrEqual(tol);
      expect(Math.abs(c3d.b * 255 - b), 'B ' + button).toBeLessThanOrEqual(tol);
    }
  });

  it('piste scène : les 2 fixtures reçoivent leur couleur via computeDmxForCue', () => {
    const tracks = [{ id: 'mt', entries: [{ id: 'e1', time: 0, endTime: 10, matrixId: 'm1' }] }];
    const colors = computeMatrixTrackColors(tracks as any, 5, [group], [matrix as any]).colors;
    expect(colors.size).toBe(2);
    const cue = { time: 1, intensity: 'high', section: 'chorus', strobe: false, energy: 0.8 } as never;
    const res = computeDmxForCue(cue, fixtures, new Map([[def.id, def]]), [{ id: 'u1' }], undefined, undefined, colors);
    const chv = res[0].channelValues;
    // Mode 14ch 540deg : fixture 1 @1 → wheel (Colour) @5
    expect(chv[1 + 4], 'wheel accu-1').toBeDefined();
    const base2 = 1 + def.modes[1].channels.length;
    expect(chv[base2 + 4], 'wheel accu-2').toBeDefined();
  });
});
