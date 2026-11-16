/**
 * Sonde « 4 spots en groupe, matrice 2×2 » — reproduction du rapport utilisateur.
 *
 * Symptômes : 2/4 fixtures réagissent dans l'onglet matrice (3D), 3/4 dans les
 * scènes pré-enregistrées, et certaines couleurs ne correspondent pas aux
 * boutons. On rejoue la chaîne EXACTE :
 *   A. live (renderMatrixFrame) → chaque fixture reçoit-elle dimmer+wheel ?
 *      les cellules éteintes reçoivent-elles dimmer 0 ?
 *   B. arbitrage LTP → une cellule éteinte reste-t-elle éteinte ?
 *   C. piste scène (computeMatrixTrackColors + computeDmxForCue) → chaque
 *      fixture reçoit-elle sa couleur ? les cellules #000000 d'une roue ?
 *   D. décodage 3D (wheelValueToColor) → la couleur DMX correspond-elle à la
 *      couleur demandée (boutons) ?
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { renderMatrixFrame, computeMatrixTrackColors } from '../hooks/rgb-matrix-playback';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { outputArbiter } from '../engine/output-arbiter';
import { wheelValueToColor } from '../views/Stage3D';
import { findBestWheelCap } from '../engine/dmx-color';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import type { PatchedFixture } from '../stores/showStore';

const QXF = path.join(process.cwd(), 'resources', 'fixtures', 'AFX-Spot-60-LED.qxf');
const dmxC: any = null;

describe('4 AFX Spot 60 en groupe — matrice 2×2', () => {
  let def: any;
  let fixtures: PatchedFixture[];
  const group = { id: 'g1', fixtureIds: ['fx-1', 'fx-2', 'fx-3', 'fx-4'] };
  const matrix = {
    id: 'm1', groupId: 'g1', pattern: 'gradient', cols: 2, rows: 2,
    speed: 0.5, startColor: '#ff0000', endColor: '#0000ff', width: 100,
    direction: 'forward', offset: 0,
  };

  beforeAll(async () => {
    const lib = new FixtureLibrary();
    def = await lib.parseQLC(fs.readFileSync(QXF, 'utf-8'), QXF);
    fixtures = group.fixtureIds.map((id, i) => ({
      id, fixtureDefId: def.id,
      manufacturer: def.manufacturer, model: def.model,
      fixtureType: 'Moving Head', modeIndex: 0, modeName: def.modes[0].name,
      universeId: 'u1', startAddress: 1 + i * def.modes[0].channels.length,
      channelCount: def.modes[0].channels.length,
      name: 'AFX ' + (i + 1), tier: 'primary',
    } as unknown as PatchedFixture));
  }, 30000);

  it('A. live : LES 4 fixtures reçoivent dimmer + roue, cellules éteintes à dimmer 0', () => {
    const { perUniverse, resolved } = renderMatrixFrame(
      matrix as any, 0.13, fixtures,
      () => def, () => 0, 0.13,
    );
    const vals = perUniverse.get(0)!;
    expect(resolved).toBe(4); // 4/4 résolues
    // La def AFX : dimmer offset 5 (canal 6), wheel offset 7 (canal 8)
    // Fixture 1 @1 → dimmer @7, wheel @9 (cf. inspection def)
    // Chaque fixture reçoit son dimmer (0 ou 255 selon la cellule)
    for (let i = 0; i < 4; i++) {
      const base = 1 + i * def.modes[0].channels.length;
      const dimmerAddr = base + 5;
      expect(vals[dimmerAddr], `dimmer fixture ${i + 1}`).toBeDefined();
      expect([0, 255]).toContain(vals[dimmerAddr]);
    }
    // gradient 2×2 phase 0.13 : toutes les cellules ont une couleur (width 100 → jamais noir)
    // → dimmer 255 partout + roue écrite partout
    for (let i = 0; i < 4; i++) {
      const base = 1 + i * def.modes[0].channels.length;
      expect(vals[base + 5]).toBe(255);
      expect(vals[base + 7], `wheel fixture ${i + 1}`).toBeDefined();
    }
  });

  it('B. arbitrage : cellule éteinte (dimmer 0) reste éteinte malgré le preset', () => {
    // Simule : matrice éteint la fixture 1 (dimmer 0), preset la veut allumée
    outputArbiter.write('rgb-matrix', 0, { [1 + 5]: 0 });
    outputArbiter.write('song-preset', 0, { [1 + 5]: 255 });
    const buf = outputArbiter.getBuffer(0) as Record<number, number>;
    expect(buf[1 + 5]).toBe(0); // LTP matrice gagne
    outputArbiter.release('rgb-matrix', 0);
    outputArbiter.release('song-preset', 0);
  });

  it('C. piste scène : LES 4 fixtures reçoivent leur couleur', () => {
    const tracks = [{ id: 'mt', entries: [{ id: 'e1', time: 0, endTime: 10, matrixId: 'm1' }] }];
    const res = computeMatrixTrackColors(tracks as any, 5, [group], [matrix as any]);
    expect(res.colors.size).toBe(4);
    for (const id of group.fixtureIds) {
      expect(res.colors.get(id), id).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Couleurs des 4 cellules NON identiques (gradient rouge→bleu)
    const hexes = new Set(group.fixtureIds.map(id => res.colors.get(id)));
    expect(hexes.size).toBeGreaterThan(1);
  });

  it('D. décodage 3D : la couleur DMX écrite correspond au slot demandé', () => {
    // Pour une couleur cible (bouton), le slot de roue choisi doit redonner
    // une couleur VISUELLEMENT proche dans la 3D.
    for (const button of ['#ff0000', '#00ff00', '#0000ff'] as const) {
      const hex = button;
      // Reproduit le chemin renderMatrixFrame → findBestWheelCap → capMid
      // puis le décodage 3D wheelValueToColor.
      const analyzed = analyzeFixtureChannels(fixtures[0] as any, def);
      const best = findBestWheelCap(analyzed.wheelCaps ?? [], hex);
      expect(best, 'slot trouvé pour ' + hex).toBeTruthy();
      const mid = Math.round((best!.min + best!.max) / 2);
      const color3d = wheelValueToColor(mid, analyzed.wheelCaps);
      // La 3D doit retomber sur la MÊME famille de couleur (tolérance 60/255).
      // NB : wheelValueToColor retourne une THREE.Color (composantes 0..1).
      const [r, g, b] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      expect(Math.abs(color3d.r * 255 - r), 'R ' + hex).toBeLessThanOrEqual(60);
      expect(Math.abs(color3d.g * 255 - g), 'G ' + hex).toBeLessThanOrEqual(60);
      expect(Math.abs(color3d.b * 255 - b), 'B ' + hex).toBeLessThanOrEqual(60);
    }
  });

  it('E. intégration piste : computeDmxForCue applique la couleur matrice aux 4', () => {
    const tracks = [{ id: 'mt', entries: [{ id: 'e1', time: 0, endTime: 10, matrixId: 'm1' }] }];
    const colors = computeMatrixTrackColors(tracks as any, 5, [group], [matrix as any]).colors;
    const cue = { time: 1, intensity: 'high', section: 'chorus', strobe: false, energy: 0.8 } as never;
    const res = computeDmxForCue(cue, fixtures, new Map([[def.id, def]]), [{ id: 'u1' }], undefined, undefined, colors);
    // Résultat PAR UNIVERS : les 4 fixtures sont sur l'univers 0
    expect(res.length).toBe(1);
    const chv = res[0].channelValues;
    // Chaque fixture reçoit un canal roue écrit (couleur matrice appliquée)
    for (let i = 0; i < 4; i++) {
      const wheelAddr = 1 + i * def.modes[0].channels.length + 7;
      expect(chv[wheelAddr], `wheel fixture ${i + 1}`).toBeDefined();
    }
  });
});
