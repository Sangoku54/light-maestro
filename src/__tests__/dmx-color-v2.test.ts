import { describe, it, expect } from 'vitest';
import { buildRgbSegments, enrichWheelCaps } from '../engine/dmx-color';
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
