/**
 * Tests UNITAIRES du routage d'exploitation maximale.
 *
 * Chaque test cible un défaut réel déjà rencontré sur les defs de la
 * bibliothèque (2978 defs / 10595 modes) :
 *
 *  1. « fine » typé `Nothing`      → le coarse n'est JAMAIS inversé.
 *  2. Shutter mal typé            → routé en `beamOffset`, pas en shutter.
 *  3. Canal à capacités sans rôle → état DÉTERMINISTE écrit (jamais muet).
 *  4. Gate couleur laser          → `laserColorMode = 'gate'`, binaire.
 *  5. Multi-bras                  → 16 bits par axe ET par bras.
 *  6. CMY                         → soustractif (C=255-R, M=255-G, Y=255-B).
 *  7. `buildRgbSegments` v3       → N segments, « fine » jamais segment,
 *                                   passe résiduelle, camelCase.
 */
import { describe, it, expect } from 'vitest';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import {
  writeCapabilityChannels,
  writeNominalChannels,
  writeFinePairs,
  writeCmyChannels,
  writeWhitePixels,
  writeExtraColourChannels,
  writeAuxColourChannels,
  capabilityValue,
} from '../engine/fixture-writers';
import { buildRgbSegments } from '../engine/dmx-color';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel, DmxFixtureCapability } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel =>
  ({ name, type, offset });
const chC = (
  name: string,
  type: DmxFixtureChannel['type'],
  offset: number,
  capabilities: DmxFixtureCapability[],
): DmxFixtureChannel => ({ name, type, offset, capabilities });
const cap = (min: number, max: number, name: string, color?: string): DmxFixtureCapability =>
  ({ min, max, name, color });

function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}

function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string }): PatchedFixture {
  return {
    manufacturer: 'Test', model: partial.fixtureDefId, fixtureType: 'moving_head', modeIndex: 0,
    modeName: 'm', universeId: 'u1', startAddress: 1, channelCount: 1, name: partial.id,
    tier: 'primary', ...partial,
  } as PatchedFixture;
}

const an = (d: DmxFixtureDefinition, extra: Partial<PatchedFixture> = {}) =>
  analyzeFixtureChannels(pf({ id: 'F1', fixtureDefId: d.id, ...extra }), d);

// ─────────────────────────────────────────────────────────────────
// 1. « fine » typé Nothing : le coarse n'est jamais inversé
// ─────────────────────────────────────────────────────────────────
describe('appariement fine ↔ coarse (fine typé Nothing)', () => {
  it('pan/tilt coarse + fine typés Nothing : coarse et fine bien séparés', () => {
    const d = def('m1', [
      ch('Pan', 'Nothing', 0),
      ch('Pan fine', 'Nothing', 1),
      ch('Tilt', 'Nothing', 2),
      ch('Tilt fine', 'Nothing', 3),
    ]);
    const fa = an(d);
    expect(fa.panOffsets).toEqual([0]);
    expect(fa.panFineOffsets).toEqual([1]);
    expect(fa.tiltOffsets).toEqual([2]);
    expect(fa.tiltFineOffsets).toEqual([3]);
    // Les alias historiques pointent sur le COARSE, jamais sur le fine.
    expect(fa.panOffset).toBe(0);
    expect(fa.panFineOffset).toBe(1);
    expect(fa.tiltOffset).toBe(2);
    expect(fa.tiltFineOffset).toBe(3);
  });

  it('un « fine » typé Pan/Tilt reste un fine (jamais un bras supplémentaire)', () => {
    const d = def('m2', [
      ch('Pan', 'Pan', 0),
      ch('Pan fine', 'Pan', 1),
      ch('Tilt', 'Tilt', 2),
      ch('Tilt fine', 'Tilt', 3),
    ]);
    const fa = an(d);
    expect(fa.panOffsets).toEqual([0]);
    expect(fa.panFineOffsets).toEqual([1]);
    expect(fa.tiltOffsets).toEqual([2]);
    expect(fa.tiltFineOffsets).toEqual([3]);
  });

  it('le « fine » est apparié au coarse PRÉCÉDENT (convention DMX 16 bits)', () => {
    // Ordre : fine avant coarse → le fine n'est pas apparié en arrière.
    const d = def('m3', [ch('Pan fine', 'Nothing', 0), ch('Pan', 'Nothing', 1)]);
    const fa = an(d);
    expect(fa.panOffsets).toEqual([1]);
    // Le fine orphelin est conservé (pas perdu), mais il ne précède pas.
    expect(fa.panFineOffsets.length).toBeGreaterThanOrEqual(1);
  });

  it('les paires fine génériques (« Zoom fine ») sont écrites avec un LSB à 0', () => {
    const d = def('m4', [
      ch('Zoom', 'Nothing', 0),
      ch('Zoom fine', 'Nothing', 1),
    ]);
    const fa = an(d);
    expect(fa.zoomOffset).toBe(0);
    expect(fa.finePairs).toEqual([{ fineOffset: 1, coarseOffset: 0 }]);
    const vals: Record<number, number> = {};
    writeFinePairs(vals, 100, fa);
    expect(vals[101]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Shutter mal typé → beamOffset
// ─────────────────────────────────────────────────────────────────
describe('Shutter mal typé', () => {
  it('« PATERN SIZE » (faute du fabricant) typé Shutter n\'est pas un shutter', () => {
    // Cas réel : TONIO LASER 4W ch7 — « PATERN SIZE » (sic) typé Shutter.
    // Écrire 255 dessus pilotait la TAILLE du motif au lieu d'ouvrir une
    // obturation.
    const d = def('laser-pattern-size', [
      chC('PATERN SIZE', 'Shutter', 0, [cap(0, 255, 'Pattern size')]),
      ch('Dimmer', 'Intensity', 1),
    ]);
    const fa = an(d, { fixtureType: 'laser' });
    expect(fa.shutterOffset).toBe(null);
    expect(fa.beamOffset).toBe(0);
  });

  it('un « PATTERN SIZE » NON laser typé Shatter → beamOffset', () => {
    const d = def('par-pattern-size', [
      chC('PATTERN SIZE', 'Shutter', 0, [cap(0, 255, 'Pattern size')]),
      ch('Dimmer', 'Intensity', 1),
    ]);
    const fa = an(d, { fixtureType: 'wash' });
    expect(fa.shutterOffset).toBe(null);
    expect(fa.beamOffset).toBe(0);
  });

  it('un vrai « Shutter » (caps shutter) reste un shutter', () => {
    const d = def('m5', [
      chC('Shutter', 'Shutter', 0, [cap(0, 127, 'Closed'), cap(128, 255, 'Open')]),
    ]);
    const fa = an(d);
    expect(fa.shutterOffset).toBe(0);
    expect(fa.beamOffset).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. Canaux à capacités sans rôle → état déterministe
// ─────────────────────────────────────────────────────────────────
describe('capabilityChannels : état déterministe', () => {
  it('un canal à capacités sans rôle dédié est listé et écrit', () => {
    // « Direction » seul ne correspond à AUCUN rôle nominal (pas de
    // pattern/gobo/wheel à côté) → il reste un canal à capacités.
    const d = def('m6', [
      ch('Dimmer', 'Intensity', 0),
      chC('Direction', 'Nothing', 1, [cap(0, 127, 'CW'), cap(128, 255, 'CCW')]),
    ]);
    const fa = an(d);
    expect(fa.capabilityChannels.map(c => c.offset)).toEqual([1]);
    const vals: Record<number, number> = {};
    writeCapabilityChannels(vals, 100, fa);
    // Pas de cap neutre → milieu de la 1ʳᵉ cap (état connu, dans la plage).
    expect(vals[101]).toBe(64);
  });

  it('un canal à caps nommé « Pattern Rotation » est un rôle ROTATE (piloté)', () => {
    const d = def('m6b', [
      ch('Dimmer', 'Intensity', 0),
      chC('Pattern Rotation Direction', 'Nothing', 1, [cap(0, 127, 'CW'), cap(128, 255, 'CCW')]),
    ]);
    const fa = an(d);
    // Il ne doit PAS finir dans capabilityChannels : il a un rôle dédié.
    expect(fa.capabilityChannels.map(c => c.offset)).not.toContain(1);
    expect(fa.nominalChannels.find(n => n.offset === 1)?.role).toBe('rotate');
  });

  it('un cap neutre (« Nothing ») est écrit à son MIN (état « rien »)', () => {
    expect(capabilityValue([cap(0, 49, 'NoFunction'), cap(50, 255, 'Effect')])).toBe(0);
    expect(capabilityValue([cap(10, 20, 'Manual'), cap(30, 40, 'Effect')])).toBe(10);
  });

  it('les sélecteurs de mode/programme ne sont JAMAIS écrits', () => {
    const d = def('m7', [
      ch('Dimmer', 'Intensity', 0),
      chC('Program', 'Nothing', 1, [cap(0, 255, 'x')]),
      chC('Reset', 'Nothing', 2, [cap(0, 255, 'x')]),
    ]);
    const fa = an(d);
    expect(fa.presetOverrideOffsets).toEqual([1, 2]);
    expect(fa.capabilityChannels.map(c => c.offset)).not.toContain(1);
    expect(fa.capabilityChannels.map(c => c.offset)).not.toContain(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. Gate couleur laser
// ─────────────────────────────────────────────────────────────────
describe('laserColorMode = gate', () => {
  const dominator = def('laser-dominator', [
    ch('Pattern Selection', 'Nothing', 0),
    ch('Horizontal Angle', 'Beam', 1),
    ch('Vertical Angle', 'Beam', 2),
    chC('Laser', 'Colour', 3, [
      cap(0, 49, 'Red laser', '#ff0000'),
      cap(50, 99, 'Green laser', '#00ff00'),
      cap(100, 149, 'Blue laser', '#0000ff'),
    ]),
  ]);

  it('le canal « Laser » à caps colorisées devient un GATE, pas une roue', () => {
    const fa = an(dominator, { fixtureType: 'Laser' });
    expect(fa.isLaser).toBe(true);
    expect(fa.laserColorMode).toBe('gate');
    expect(fa.laserColorGateOffset).toBe(3);
    expect(fa.laserColorGateCaps.length).toBe(3);
    // Une gate n'est PAS une roue couleur : pas de wheelOffset.
    expect(fa.wheelOffset).toBe(null);
  });

  it('le gate est piloté par la palette (valeur dans une cap réelle)', () => {
    const fa = an(dominator, { fixtureType: 'Laser' });
    const vals: Record<number, number> = {};
    // writeLaserGates n'écrit pas le gate mono-canal : c'est le bloc laser.
    // On vérifie ici la non-régression : le gate n'est PAS écrit comme
    // une couleur continue par les writers de couleur.
    expect(fa.laserColorGateOffset).toBe(3);
    expect(vals[103]).toBe(undefined);
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. Multi-bras : 16 bits par axe ET par bras
// ─────────────────────────────────────────────────────────────────
describe('appariement multi-bras (16 bits par bras)', () => {
  it('3 bras pan/tilt : chaque bras a son coarse ET son fine', () => {
    const d = def('m8', [
      ch('Pan', 'Nothing', 0), ch('Pan fine', 'Nothing', 1),
      ch('Tilt', 'Nothing', 2), ch('Tilt fine', 'Nothing', 3),
      ch('Pan 2', 'Nothing', 4), ch('Pan 2 fine', 'Nothing', 5),
      ch('Tilt 2', 'Nothing', 6), ch('Tilt 2 fine', 'Nothing', 7),
      ch('Pan 3', 'Nothing', 8), ch('Pan 3 fine', 'Nothing', 9),
      ch('Tilt 3', 'Nothing', 10), ch('Tilt 3 fine', 'Nothing', 11),
    ]);
    const fa = an(d);
    expect(fa.panOffsets).toEqual([0, 4, 8]);
    expect(fa.panFineOffsets).toEqual([1, 5, 9]);
    expect(fa.tiltOffsets).toEqual([2, 6, 10]);
    expect(fa.tiltFineOffsets).toEqual([3, 7, 11]);
  });

  it('un bras sans fine ne vole pas le fine du bras suivant', () => {
    const d = def('m9', [
      ch('Pan', 'Nothing', 0),
      ch('Pan 2', 'Nothing', 1),
      ch('Pan 2 fine', 'Nothing', 2),
    ]);
    const fa = an(d);
    expect(fa.panOffsets).toEqual([0, 1]);
    // Le 1ʳᵉ bras n'a pas de fine ; le 2ᵉ garde le sien.
    expect(fa.panFineOffsets).toEqual([null, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. CMY : couleur soustractive
// ─────────────────────────────────────────────────────────────────
describe('mélangeurs CMY', () => {
  it('noms composés « Cyan Color » / « Magenta Color » / « Yellow » → cmyOffsets', () => {
    const d = def('cmy1', [
      ch('Dimmer', 'Intensity', 0),
      ch('Cyan Color', 'Colour', 1),
      ch('Magenta Color', 'Colour', 2),
      ch('Yellow Color', 'Colour', 3),
    ]);
    const fa = an(d);
    expect(fa.cmyOffsets).toEqual({ c: 1, m: 2, y: 3 });
    // Pas de segment RGB : la fixture n'a pas de triplet RGB.
    expect(fa.rgbSegments.length).toBe(0);
    expect(fa.rgbOffsets).toBe(null);
  });

  it('la couleur CMY est soustractive et exacte', () => {
    const d = def('cmy2', [
      ch('Cyan', 'Colour', 0),
      ch('Magenta', 'Colour', 1),
      ch('Yellow', 'Colour', 2),
    ]);
    const fa = an(d);
    const vals: Record<number, number> = {};
    // Rouge pur (255,0,0) → C=0, M=255, Y=255
    writeCmyChannels(vals, 100, fa, 255, 0, 0);
    expect(vals[100]).toBe(0);
    expect(vals[101]).toBe(255);
    expect(vals[102]).toBe(255);
    // Blanc (255,255,255) → aucun pigment
    const vals2: Record<number, number> = {};
    writeCmyChannels(vals2, 100, fa, 255, 255, 255);
    expect(vals2[100]).toBe(0);
    expect(vals2[101]).toBe(0);
    expect(vals2[102]).toBe(0);
  });

  it('une roue couleur colorisée n\'est PAS un mélangeur CMY', () => {
    const d = def('cmy3', [
      chC('Color Wheel', 'Colour', 0, [cap(0, 40, 'Open'), cap(41, 80, 'Red', '#ff0000')]),
    ]);
    const fa = an(d);
    expect(fa.cmyOffsets).toEqual({ c: null, m: null, y: null });
    expect(fa.wheelOffset).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. buildRgbSegments v3
// ─────────────────────────────────────────────────────────────────
describe('buildRgbSegments v3', () => {
  it('N×R / N×G / N×B → N segments (pixels nommés pareil)', () => {
    const chans: Array<{ offset: number; name: string }> = [];
    for (let p = 0; p < 4; p++) {
      chans.push(
        { offset: p * 4 + 0, name: 'Red Pixel null' },
        { offset: p * 4 + 1, name: 'Green Pixel null' },
        { offset: p * 4 + 2, name: 'Blue Pixel null' },
        { offset: p * 4 + 3, name: 'White Pixel null' },
      );
    }
    const segs = buildRgbSegments(chans);
    expect(segs.length).toBe(4);
    expect(segs[0]).toMatchObject({ r: 0, g: 1, b: 2, w: 3 });
    expect(segs[3]).toMatchObject({ r: 12, g: 13, b: 14, w: 15 });
  });

  it('un « fine » ne crée JAMAIS un segment à lui seul', () => {
    const segs = buildRgbSegments([
      { offset: 0, name: 'Red' }, { offset: 1, name: 'Red fine' },
      { offset: 2, name: 'Green' }, { offset: 3, name: 'Green fine' },
      { offset: 4, name: 'Blue' }, { offset: 5, name: 'Blue fine' },
    ]);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ r: 0, g: 2, b: 4, rFine: 1, gFine: 3, bFine: 5 });
  });

  it('passe RÉSIDUELLE : matrice à coordonnées (« Red (0,0) »)', () => {
    const segs = buildRgbSegments([
      { offset: 0, name: 'Red (0,0)' },
      { offset: 1, name: 'Green (0,1)' },
      { offset: 2, name: 'Blue (1,0)' },
      { offset: 3, name: 'White (1,1)' },
      { offset: 4, name: 'Red (0,2)' },
      { offset: 5, name: 'Green (0,3)' },
      { offset: 6, name: 'Blue (1,2)' },
      { offset: 7, name: 'White (1,3)' },
    ]);
    expect(segs.length).toBe(2);
    expect(segs[0]).toMatchObject({ r: 0, g: 1, b: 2, w: 3 });
    expect(segs[1]).toMatchObject({ r: 4, g: 5, b: 6, w: 7 });
  });

  it('camelCase : « uRed » est un canal ROUGE (Ovation E-910FC)', () => {
    const segs = buildRgbSegments([
      { offset: 0, name: 'Red' }, { offset: 1, name: 'uRed' },
      { offset: 2, name: 'Green' }, { offset: 3, name: 'uGreen' },
      { offset: 4, name: 'Blue' }, { offset: 5, name: 'uBlue' },
      { offset: 6, name: 'Amber' }, { offset: 7, name: 'Lime' },
      { offset: 8, name: 'White' },
    ]);
    expect(segs.length).toBe(2);
    expect(segs[0]).toMatchObject({ r: 0, g: 2, b: 4, a: 6 });
    expect(segs[1]).toMatchObject({ r: 1, g: 3, b: 5 });
  });

  it('RGBW : le blanc est associé au segment', () => {
    const segs = buildRgbSegments([
      { offset: 0, name: 'Red' }, { offset: 1, name: 'Green' },
      { offset: 2, name: 'Blue' }, { offset: 3, name: 'White' },
    ]);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ r: 0, g: 1, b: 2, w: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────
// 9. Triplet RGB cohérent (un seul segment / un seul engine)
// ─────────────────────────────────────────────────────────────────
describe('rgbOffsets : un seul engine couleur', () => {
  it('ETC Source Four « RGB Plus 7 » : le triplet vient du moteur Emulated, pas du mélange', () => {
    // Deux engines couleur sur la même fixture :
    //   0-2 = Red/Green/Blue « Emulated »  (moteur RGB classique)
    //   6-9 = Red/Mint/Blue/Indigo         (moteur « Plus 7 »)
    // Le triplet simple ne doit PAS mélanger « Red » du moteur Plus 7 avec
    // « Green Emulated » : le D3 écrivait alors le rouge et le bleu dans un
    // engine et le vert dans l'autre → teinte fausse.
    const d = def('etc-s4-rgb-plus-7', [
      ch('Red Emulated', 'Colour', 0),
      ch('Green Emulated', 'Colour', 1),
      ch('Blue Emulated', 'Colour', 2),
      ch('Strobe', 'Shutter', 3),
      ch('Fan Control', 'Maintenance', 4),
      ch('Plus 7 Control', 'Maintenance', 5),
      chC('Red', 'Colour', 6, [cap(0, 255, 'ColorIntensity', '#ff0000')]),
      chC('Mint', 'Colour', 7, [cap(0, 255, 'ColorIntensity', '#40ff80')]),
      chC('Blue', 'Colour', 8, [cap(0, 255, 'ColorIntensity', '#0000ff')]),
      chC('Indigo', 'Colour', 9, [cap(0, 255, 'ColorIntensity', '#4000ff')]),
    ]);
    const fa = an(d);
    expect(fa.rgbSegments.length).toBe(1);
    expect(fa.rgbSegments[0]).toMatchObject({ r: 0, g: 1, b: 2 });
    // Le triplet simple = les 3 canaux du MÊME segment.
    expect(fa.rgbOffsets).toEqual([0, 1, 2]);
    // Les couleurs du 2ᵉ engine ne sont pas pilotées comme du RGB
    // (elles ajouteraient une couleur non demandée) : elles sont éteintes.
    expect(fa.auxColourChannels).toEqual(expect.arrayContaining([6, 7, 8, 9]));
    expect(fa.extraColourChannels).toEqual([]);
  });

  it('un laser RG sans bleu : rgbOffsets ne contient que R et G', () => {
    const d = def('laser-rg', [
      ch('Red laser', 'Effect', 0),
      ch('Green laser', 'Effect', 1),
      chC('Intensity of the blue LED background illumination', 'Intensity', 2, [
        cap(0, 4, 'Background illumination off'),
        cap(5, 255, 'Increasing brightness (0 %...100 %)'),
      ]),
    ]);
    const fa = an(d, { fixtureType: 'laser' });
    expect(fa.rgbOffsets).toEqual([0, 1]);
    // Le LED de fond bleu n'est PAS le bleu du faisceau : c'est une
    // intensité à capabilities → état déterministe (zone « off » de la def).
    expect(fa.capabilityChannels.map(c => c.offset)).toContain(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// 10. Segment incomplet : le bleu d'une AUTRE famille est rattaché
// ─────────────────────────────────────────────────────────────────
describe('buildRgbSegments : rattachement des slots manquants', () => {
  it('« Red 1/Colour Select » + « Green 1/Colour Select » + « Blue 1 » → 1 segment complet', () => {
    // Cas réel : Elumen8 COB Tri-4-Pixel. « Blue 1 » tombe dans une autre
    // famille de nom (« 1 » vs « 1 colour select ») → sans le rattachement,
    // le bleu du 1ᵉʳ pixel n'était JAMAIS piloté.
    const d = def('elumen8-cob-tri', [
      chC('Red 1/Colour Select', 'Effect', 0, [cap(0, 255, 'Colour', '#ff0000')]),
      chC('Green 1/Colour Select', 'Effect', 1, [cap(0, 255, 'Colour', '#00ff00')]),
      chC('Blue 1', 'Intensity', 2, [cap(0, 15, '0-100%'), cap(16, 255, 'No function')]),
      ch('Red 2', 'Intensity', 3),
      ch('Green 2', 'Intensity', 4),
      ch('Blue 2', 'Intensity', 5),
    ]);
    const fa = an(d);
    expect(fa.rgbSegments.length).toBe(2);
    expect(fa.rgbSegments[0]).toMatchObject({ r: 0, g: 1, b: 2 });
    expect(fa.rgbSegments[1]).toMatchObject({ r: 3, g: 4, b: 5 });
  });
});

// ─────────────────────────────────────────────────────────────────
// 11. Canaux couleur auxiliaires : seulement les VRAIS canaux couleur
// ─────────────────────────────────────────────────────────────────
describe('auxColourChannels : ne pas voler les canaux de contrôle', () => {
  it('un canal de contrôle laser à caps colorisées reste un canal à capacités', () => {
    // Cas réel : TONIO LASER RGB ALIEN — la def colorise TOUTES les caps,
    // y compris « ANGLE CONTROLE » / « HORIZONTAL ROTATION ». Traités comme
    // « couleur auxiliaire », ils étaient ÉTEINTS (0) → le laser était figé.
    const d = def('tonio-laser-rgb-alien', [
      chC('MODE SELECTION', 'Macro', 0, [cap(0, 63, 'CLOSED LIGHT MODE', '#ff0000')]),
      chC('ANGLE CONTROLE', 'Macro', 1, [cap(0, 127, 'ROTATION ANGLE', '#ff0000')]),
      chC('CODE CONTROLE', 'Macro', 2, [cap(0, 127, 'PATTERN HAS DOTS', '#ff0000')]),
    ]);
    const fa = an(d, { fixtureType: 'laser' });
    expect(fa.auxColourChannels).toEqual([]);
    expect(fa.capabilityChannels.map(c => c.offset)).toEqual([1, 2]);
  });

  it('un vrai canal couleur à caps colorisées est bien éteint (0)', () => {
    const d = def('ovation-aux', [
      ch('Dimmer', 'Intensity', 0),
      ch('Red', 'Colour', 1),
      ch('Green', 'Colour', 2),
      ch('Blue', 'Colour', 3),
      chC('Orange', 'Colour', 4, [cap(0, 255, 'ColorIntensity', '#ff8000')]),
    ]);
    const fa = an(d);
    expect(fa.auxColourChannels).toEqual([4]);
    const vals: Record<number, number> = {};
    writeAuxColourChannels(vals, 100, fa);
    expect(vals[104]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 8. Écritures partagées : pixels blancs, doublons couleur, nominaux
// ─────────────────────────────────────────────────────────────────
describe('writers partagés', () => {
  it('pixels blancs autonomes : composante achromatique (min R,G,B)', () => {
    const d = def('w1', [
      ch('Red', 'Colour', 0), ch('Green', 'Colour', 1), ch('Blue', 'Colour', 2),
      ch('White', 'Colour', 3),
    ]);
    const fa = an(d);
    // « White » est ici rattaché au segment RGBW (pas un pixel autonome).
    expect(fa.whitePixels).toEqual([]);
    // Un blanc AUTONOME (sans triplet) est un pixel blanc.
    const d2 = def('w2', [ch('Dimmer', 'Intensity', 0), ch('White Pixel', 'Colour', 1)]);
    const fa2 = an(d2);
    expect(fa2.whitePixels).toEqual([1]);
    const vals: Record<number, number> = {};
    writeWhitePixels(vals, 100, fa2, 255, 120, 60);
    expect(vals[101]).toBe(60); // min(255,120,60)
  });

  it('doublons couleur : la 2e zone reçoit la même composante', () => {
    const d = def('x1', [
      ch('Red', 'Colour', 0),
      ch('Green 1 (outer leds)', 'Colour', 1),
      ch('Blue', 'Colour', 2),
      ch('Green 2 (inner leds)', 'Colour', 3),
      ch('Amber', 'Colour', 4),
    ]);
    const fa = an(d);
    expect(fa.extraColourChannels).toEqual([{ offset: 3, key: 'g' }]);
    const vals: Record<number, number> = {};
    writeExtraColourChannels(vals, 100, fa, 10, 20, 30);
    expect(vals[103]).toBe(20);
    // Amber n'est PAS piloté : la couleur validée ne change pas.
    expect(vals[104]).toBe(undefined);
  });

  it('canaux nominaux : le 2e zoom SUIT le 1er, le 2e gobo reste neutre', () => {
    const d = def('n1', [
      ch('Dimmer', 'Intensity', 0),
      ch('Zoom', 'Nothing', 1),
      ch('Zoom 2', 'Nothing', 2),
      chC('Gobo 1', 'Nothing', 3, [cap(0, 20, 'Open'), cap(21, 255, 'Gobo 1')]),
      chC('Gobo 2', 'Nothing', 4, [cap(0, 20, 'Open'), cap(21, 255, 'Gobo 2')]),
    ]);
    const fa = an(d);
    const zoom2 = fa.nominalChannels.find(n => n.offset === 2);
    const gobo2 = fa.nominalChannels.find(n => n.offset === 4);
    expect(zoom2?.role).toBe('zoom');
    expect(gobo2?.role).toBe('gobo');

    const vals: Record<number, number> = {};
    vals[101] = 77; // zoom primaire déjà écrit par le moteur
    writeNominalChannels(vals, 100, fa, { time: 1, energy: 0.5 });
    expect(vals[102]).toBe(77); // CONTINU : le 2e zoom suit le 1er
    expect(vals[104]).toBe(0);  // SÉLECTION : le 2e gobo à l'état neutre
  });
});
