import { describe, it, expect } from 'vitest';
import { buildRgbSegments, enrichWheelCaps, splitRgbw } from '../engine/dmx-color';
import type { DmxFixtureCapability } from '../hooks/dmx-cues';

const cc = (offset: number, name: string) => ({ offset, name });

describe('buildRgbSegments v2 : familles + laser RG sans bleu', () => {
  it('Tonio 6 arm : 3 familles (bee eye, beam, laser RG) -> 3 segments, b null pour le laser', () => {
    const segs = buildRgbSegments([
      cc(11, 'Bee eye red'), cc(12, 'Bee eye Green'), cc(13, 'Bee eye Blue'), cc(14, 'Bee eye white'),
      cc(15, 'Beam red'), cc(16, 'Beam green'), cc(17, 'Beam blue'), cc(18, 'Beam white'),
      cc(19, 'Red laser'), cc(20, 'Green laser'),
    ]);
    expect(segs.length).toBe(3);
    expect(segs[0]).toMatchObject({ r: 11, g: 12, b: 13, w: 14 });
    expect(segs[1]).toMatchObject({ r: 15, g: 16, b: 17, w: 18 });
    expect(segs[2]).toMatchObject({ r: 19, g: 20, b: null });
  });

  it('ordres entremêlés : chaque famille garde son propre jeu (le v1 mélangeait)', () => {
    const segs = buildRgbSegments([
      cc(0, 'Beam red'), cc(1, 'Spot red'),
      cc(2, 'Beam green'), cc(3, 'Spot green'),
      cc(4, 'Beam blue'), cc(5, 'Spot blue'),
    ]);
    expect(segs.length).toBe(2);
    expect(segs[0]).toMatchObject({ r: 0, g: 2, b: 4 });
    expect(segs[1]).toMatchObject({ r: 1, g: 3, b: 5 });
  });

  it('RGB simple sans préfixe : comportement v1 préservé', () => {
    const segs = buildRgbSegments([cc(5, 'Red'), cc(6, 'Green'), cc(7, 'Blue'), cc(8, 'White')]);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ r: 5, g: 6, b: 7, w: 8 });
  });

  it('canal fine jamais pris comme canal de couleur', () => {
    const segs = buildRgbSegments([cc(5, 'Red'), cc(6, 'Red fine'), cc(7, 'Green'), cc(8, 'Blue')]);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ r: 5, g: 7, b: 8 });
  });

  it('nom à lettre isolée : « B EYE RED » n\'est PAS du bleu', () => {
    // Régression Tonio 6 ARM : le « B » isolé de « B EYE RED » matchait
    // /\bblue|b\b/ → le canal R était aussi piloté en bleu et le vrai
    // canal bleu n'était jamais écrit.
    const segs = buildRgbSegments([
      cc(11, 'B EYE RED'), cc(12, 'B EYE GREEN'), cc(13, 'B EYE BLUE'), cc(14, 'B EYE WHITE'),
      cc(15, 'BEAM RED'), cc(16, 'BEAM GREEN'), cc(17, 'BEAM BLUE'), cc(18, 'BEAM WHITE'),
      cc(19, 'RED LASER'), cc(20, 'GREEN LASER'),
    ]);
    expect(segs.length).toBe(3);
    expect(segs[0]).toMatchObject({ r: 11, g: 12, b: 13, w: 14 });
    expect(segs[1]).toMatchObject({ r: 15, g: 16, b: 17, w: 18 });
    expect(segs[2]).toMatchObject({ r: 19, g: 20, b: null });
    // Aucun offset dupliqué entre segments
    const offs = segs.flatMap(s => [s.r, s.g, s.b, s.w].filter((o): o is number => o !== null));
    expect(new Set(offs).size).toBe(offs.length);
  });

  it('canaux couleur nommés R/G/B (une lettre) : un seul segment', () => {
    // Les defs « R », « G », « B » tombaient dans trois familles différentes
    // → aucun segment RGB → la couleur n'était jamais pilotée.
    const segs = buildRgbSegments([cc(0, 'R'), cc(1, 'G'), cc(2, 'B')]);
    expect(segs.length).toBe(1);
    expect(segs[0]).toMatchObject({ r: 0, g: 1, b: 2 });
  });

  it('canaux pixelisés Red1..Blue8 : 8 segments (barre 24 canaux)', () => {
    const chans: Array<{ offset: number; name: string }> = [];
    for (let p = 1; p <= 8; p++) {
      chans.push(cc((p - 1) * 3, `Red${p}`), cc((p - 1) * 3 + 1, `Green${p}`), cc((p - 1) * 3 + 2, `Blue${p}`));
    }
    const segs = buildRgbSegments(chans);
    expect(segs.length).toBe(8);
    expect(segs[0]).toMatchObject({ r: 0, g: 1, b: 2 });
    expect(segs[7]).toMatchObject({ r: 21, g: 22, b: 23 });
  });
});

describe('splitRgbw : le canal blanc est exploité SANS changer la couleur', () => {
  it('blanc pur → W=255 et RGB=0', () => {
    expect(splitRgbw(255, 255, 255)).toEqual({ r: 0, g: 0, b: 0, w: 255 });
  });
  it('rouge pur → W=0, RGB inchangé', () => {
    expect(splitRgbw(255, 0, 0)).toEqual({ r: 255, g: 0, b: 0, w: 0 });
  });
  it('rose pâle → composante achromatique extraite', () => {
    const out = splitRgbw(255, 200, 200);
    expect(out.w).toBe(200);
    expect(out.r).toBe(55);
    expect(out.g).toBe(0);
    expect(out.b).toBe(0);
  });
});

describe('enrichWheelCaps : couleurs déduites des noms', () => {
  it('cap « Yellow » sans color -> #ffff00, cap inconnue inchangée', () => {
    const caps = [
      { min: 0, max: 40, name: 'Open' },
      { min: 41, max: 80, name: 'Yellow' },
      { min: 81, max: 120, name: 'Deep Blue' },
      { min: 121, max: 160, name: 'Gobo 3' },
    ] as unknown as DmxFixtureCapability[];
    const out = enrichWheelCaps(caps);
    expect(out[0].color).toBeUndefined(); // Open : pas de couleur déduite
    expect(out[1].color).toBe('#ffff00');
    expect(out[2].color).toBe('#0000ff');
    expect(out[3].color).toBeUndefined();
  });

  it('caps vides -> [] ; cap déjà colorisée inchangée', () => {
    expect(enrichWheelCaps([])).toEqual([]);
    expect(enrichWheelCaps(null)).toEqual([]);
    const cap = { min: 0, max: 255, name: 'Red', color: '#aa0000' } as unknown as DmxFixtureCapability;
    expect(enrichWheelCaps([cap])[0].color).toBe('#aa0000');
  });
});
