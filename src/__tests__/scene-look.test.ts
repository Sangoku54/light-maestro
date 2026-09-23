import { describe, it, expect, beforeEach } from 'vitest';
import { captureFixtureLook, ensureFixtureLook, getFixtureChannelMaps, setFixtureChannelMaps, type LookChannelMap } from '../utils/scene-look';
import { useShowStore, type PatchedFixture } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';

/**
 * Bug « tuile créée mais rien ne joue » : une scène capturée sans dimmer
 * rejoue intensity=0 → faisceau invisible (3D + matériel).
 * captureFixtureLook / ensureFixtureLook forcent un look minimal.
 */

const pf: PatchedFixture = {
  id: 'mh1',
  fixtureDefId: 'def',
  modeIndex: 0,
  universeId: 'u1',
  startAddress: 64,
  channelCount: 16,
} as PatchedFixture;

const cm: LookChannelMap = {
  intensityOffset: 2,
  rgbOffsets: [3, 4, 5],
  strobeOffset: 6,
  shutterOffset: 7,
  wheelOffset: null,
  wheelCaps: null,
};

const cmWheel: LookChannelMap = {
  intensityOffset: 2,
  rgbOffsets: null,
  wheelOffset: 3,
  wheelCaps: [
    { color: 'Red', min: 0, max: 30 },
    { color: 'White', min: 61, max: 90 },
  ],
  strobeOffset: null,
  shutterOffset: null,
};

const cmRgbOnly: LookChannelMap = {
  intensityOffset: null,
  rgbOffsets: [3, 4, 5], // hors pan/tilt (0/1) — fixture RGB sans dimmer
  strobeOffset: null,
  shutterOffset: null,
  wheelOffset: null,
  wheelCaps: null,
};

beforeEach(() => {
  useShowStore.setState({ patchedFixtures: [pf], universes: [{ id: 'u1' }] as any, scenes: [] });
  useAppStore.setState({ dmx: { channelData: {} } as any });
  setFixtureChannelMaps(new Map());
  (globalThis as any).__lm_fixtureChannelMaps = undefined;
});

describe('captureFixtureLook — live éteint → look visible', () => {
  it('dimmer 255, RGB blanc, strobe 0, shutter ouvert', () => {
    const ch: Record<number, number> = {};
    captureFixtureLook(ch, pf, cm, {});
    expect(ch[64 + 2]).toBe(255);
    expect(ch[64 + 3]).toBe(255);
    expect(ch[64 + 4]).toBe(255);
    expect(ch[64 + 5]).toBe(255);
    expect(ch[64 + 6]).toBe(0);
    expect(ch[64 + 7]).toBe(255);
  });

  it('live allumé → copie dimmer/couleur/strobe existants', () => {
    const live = { [64 + 2]: 120, [64 + 3]: 10, [64 + 4]: 0, [64 + 5]: 200, [64 + 6]: 100, [64 + 7]: 64 };
    const ch: Record<number, number> = {};
    captureFixtureLook(ch, pf, cm, live);
    expect(ch[64 + 2]).toBe(120);
    expect(ch[64 + 3]).toBe(10);
    expect(ch[64 + 4]).toBe(0);
    expect(ch[64 + 5]).toBe(200);
    expect(ch[64 + 6]).toBe(100);
    expect(ch[64 + 7]).toBe(64);
  });

  it('roue de couleur : live éteint → cap blanc, sinon 255', () => {
    const ch: Record<number, number> = {};
    captureFixtureLook(ch, pf, cmWheel, {});
    expect(ch[64 + 3]).toBe(Math.round((61 + 90) / 2));
    expect(ch[64 + 2]).toBe(255);
  });

  it('ne touche PAS pan/tilt (offsets absents du look)', () => {
    const ch: Record<number, number> = { [64]: 180, [64 + 1]: 90 };
    captureFixtureLook(ch, pf, cm, {});
    expect(ch[64]).toBe(180);
    expect(ch[64 + 1]).toBe(90);
  });
});

describe('ensureFixtureLook — scène Target sans dimmer → forcée visible', () => {
  it('pan/tilt seuls dans la scène → intensity absente → 255', () => {
    const ch: Record<number, number> = { [64]: 180, [64 + 1]: 90 };
    ensureFixtureLook(ch, pf, cm);
    expect(ch[64]).toBe(180);
    expect(ch[64 + 1]).toBe(90);
    expect(ch[64 + 2]).toBe(255); // dimmer forcé
  });

  it('intensity déjà à 0 dans la scène → force 255 (live muet)', () => {
    const ch: Record<number, number> = { [64]: 180, [64 + 2]: 0 };
    ensureFixtureLook(ch, pf, cm);
    expect(ch[64 + 2]).toBe(255);
  });

  it('intensity déjà active → conservée', () => {
    const ch: Record<number, number> = { [64]: 180, [64 + 2]: 77 };
    ensureFixtureLook(ch, pf, cm);
    expect(ch[64 + 2]).toBe(77);
  });

  it('fixture NON touchée par la scène → aucune écriture', () => {
    const ch: Record<number, number> = { [1]: 255 }; // hors plage 64..79
    ensureFixtureLook(ch, pf, cm);
    expect(ch[64 + 2]).toBeUndefined();
  });

  it('channelMap null → no-op', () => {
    const ch: Record<number, number> = { [64]: 180 };
    ensureFixtureLook(ch, pf, null);
    expect(ch[64 + 2]).toBeUndefined();
  });

  it('RGB only : tout à 0 → force blanc (sinon intensity 0 en 3D)', () => {
    const ch: Record<number, number> = { [64]: 128, [64 + 1]: 128 }; // pan/tilt seuls
    ensureFixtureLook(ch, pf, cmRgbOnly);
    expect(ch[64 + 3]).toBe(255);
    expect(ch[64 + 4]).toBe(255);
    expect(ch[64 + 5]).toBe(255);
  });

  it('RGB only : couleur déjà active → conservée', () => {
    const ch: Record<number, number> = { [64 + 3]: 255, [64 + 4]: 0, [64 + 5]: 0 };
    ensureFixtureLook(ch, pf, cmRgbOnly);
    expect(ch[64 + 3]).toBe(255);
    expect(ch[64 + 4]).toBe(0);
  });

  it('shutter fermé (≤31) avec fixture touchée → ouvert 255', () => {
    const ch: Record<number, number> = { [64]: 180, [64 + 2]: 255, [64 + 7]: 0 };
    ensureFixtureLook(ch, pf, cm);
    expect(ch[64 + 7]).toBe(255);
  });
});

describe('getFixtureChannelMaps / setFixtureChannelMaps', () => {
  it('round-trip Map', () => {
    const m = new Map<string, LookChannelMap>([['mh1', cm]]);
    setFixtureChannelMaps(m);
    expect(getFixtureChannelMaps().get('mh1')?.intensityOffset).toBe(2);
  });

  it('sans publication → Map vide (pas de crash)', () => {
    (globalThis as any).__lm_fixtureChannelMaps = undefined;
    expect(getFixtureChannelMaps().size).toBe(0);
  });
});
