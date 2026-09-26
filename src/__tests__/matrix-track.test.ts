import { describe, it, expect } from 'vitest';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { computeMatrixTrackColors } from '../hooks/rgb-matrix-playback';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel => ({ name, type, offset });

function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}

function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string }): PatchedFixture {
  return {
    manufacturer: 'Test', model: partial.fixtureDefId, fixtureType: 'moving_head', modeIndex: 0, modeName: 'm',
    universeId: 'u1', startAddress: 1, channelCount: 7, name: partial.id, tier: 'primary', ...partial,
  };
}

// Moving head RGB : pan/tilt + dimmer + shutter + RGB
const mhDef = def('mh', [
  ch('Pan', 'Pan', 0),
  ch('Tilt', 'Tilt', 1),
  ch('Dimmer', 'Intensity', 2),
  ch('Shutter', 'Shutter', 3),
  ch('Red', 'Colour', 4),
  ch('Green', 'Colour', 5),
  ch('Blue', 'Colour', 6),
]);

const fixtures = [
  pf({ id: 'fx-1', fixtureDefId: 'mh', startAddress: 1, channelCount: 7 }),
  pf({ id: 'fx-2', fixtureDefId: 'mh', startAddress: 11, channelCount: 7 }),
];

// Groupe volontairement inversé : fx-2 = cellule 0, fx-1 = cellule 1
const groups = [{ id: 'g1', fixtureIds: ['fx-2', 'fx-1'] }];

const tracks = [
  { id: 'mt1', name: 'MTX 1', entries: [{ id: 'e1', time: 0, endTime: 10, matrixId: 'm1', matrixName: 'Grad' }] },
];

function mx(pattern: string) {
  return {
    id: 'm1', groupId: 'g1', pattern, cols: 2, rows: 1,
    speed: 1, startColor: '#00ff00', endColor: '#ff0000', width: 100,
  };
}

describe('piste matrice : chevauche couleur + strobe de l\'autoscript, mouvement intact', () => {
  it('couleur : cellules suivent l\'ordre du groupe, uniquement pendant la plage', () => {
    const res = computeMatrixTrackColors(tracks as any, 5, groups, [mx('gradient') as any]);
    // Ordre du groupe (inversé) : fixtureIds[0]=fx-2 → cellule 0 (start), [1]=fx-1 → cellule 1 (end)
    expect(res.colors.get('fx-2')).toBe('#00ff00');
    expect(res.colors.get('fx-1')).toBe('#ff0000');
    // Hors plage → aucune couleur
    expect(computeMatrixTrackColors(tracks as any, 10, groups, [mx('gradient') as any]).colors.size).toBe(0);
    expect(computeMatrixTrackColors(tracks as any, -1, groups, [mx('gradient') as any]).colors.size).toBe(0);
    // Matrice inconnue → rien
    const orphan = [{ id: 'mt1', entries: [{ id: 'e', time: 0, endTime: 10, matrixId: 'missing' }] }];
    expect(computeMatrixTrackColors(orphan as any, 5, groups, [mx('gradient') as any]).colors.size).toBe(0);
  });

  it('motif strobe : couleur pleine constante + strobe actif, les autres motifs n\'activent pas le strobe', () => {
    const strobe = computeMatrixTrackColors(tracks as any, 5, groups, [mx('strobe') as any]);
    expect(strobe.colors.get('fx-1')).toBe('#00ff00'); // pleine couleur, pas de double clignotement
    expect(strobe.strobe.size).toBe(2);
    expect(strobe.strobe.get('fx-1')).toEqual({ active: true, speed: 8 });
    const rainbow = computeMatrixTrackColors(tracks as any, 5, groups, [mx('rainbow') as any]);
    expect(rainbow.strobe.size).toBe(0);
    expect(rainbow.colors.get('fx-1')).not.toBe('');
  });

  it('intégration : couleur matrice gagne, pan/tilt + dimmer restent pilotés par l\'autoscript', () => {
    const cue = { time: 1.0, intensity: 'high', section: 'chorus', strobe: false, energy: 0.8, movement: 'circle', color: '#ff0000' } as any;
    const defs = new Map([['mh', mhDef]]);
    const uni = [{ id: 'u1' }];
    const matrix = computeMatrixTrackColors(tracks as any, 5, groups, [mx('solid') as any]);

    const sans = computeDmxForCue(cue as never, fixtures, defs, uni, undefined, undefined, undefined);
    const avec = computeDmxForCue(cue as never, fixtures, defs, uni, undefined, undefined, matrix.colors);

    // fx-1 @addr 1 : R=5 G=6 B=7 → couleur matrice #00ff00 imposée
    const a = avec[0].channelValues;
    const s = sans[0].channelValues;
    expect([a[5], a[6], a[7]]).toEqual([0, 255, 0]);
    // ...alors que l'autoscript aurait piloté sa propre couleur cue (rouge)
    expect(s[5]).toBeGreaterThan(0);
    expect(s[5]).not.toBe(a[5]);
    // Mouvement autoscript identique avec/sans matrice (la matrice n'y touche pas)
    expect(a[1]).toBe(s[1]); // pan
    expect(a[2]).toBe(s[2]); // tilt
    // Dimmer autoscript identique avec/sans matrice
    expect(a[3]).toBe(s[3]);
    // Le mouvement est réellement animé (pas figé au centre)
    const plusTard = computeDmxForCue({ ...cue, time: 1.35 }, fixtures, defs, uni, undefined, undefined, matrix.colors);
    expect(plusTard[0].channelValues[1]).not.toBe(a[1]);
  });

  it('intégration : le strobe du motif matrice pilote le shutter', () => {
    const cue = { time: 1.0, intensity: 'high', section: 'chorus', strobe: false, energy: 0.8, color: '#00ff00' } as any;
    const defs = new Map([['mh', mhDef]]);
    const uni = [{ id: 'u1' }];
    const matrix = computeMatrixTrackColors(tracks as any, 5, groups, [mx('strobe') as any]);

    const sansStrobe = computeDmxForCue(cue, fixtures, defs, uni, undefined, undefined, matrix.colors);
    const avecStrobe = computeDmxForCue(cue, fixtures, defs, uni, undefined, undefined, matrix.colors, matrix.strobe);

    // Sans strobe : shutter ouvert (255) pour une fixture allumée
    expect(sansStrobe[0].channelValues[4]).toBe(255);
    // Avec le strobe de la matrice : valeur strobe, pas 255
    expect(avecStrobe[0].channelValues[4]).toBeLessThan(255);
    expect(avecStrobe[0].channelValues[4]).toBeGreaterThanOrEqual(16);
    // La couleur reste intacte pendant le strobe
    expect([avecStrobe[0].channelValues[5], avecStrobe[0].channelValues[6], avecStrobe[0].channelValues[7]]).toEqual([0, 255, 0]);
  });
});
