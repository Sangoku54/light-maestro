import { describe, it, expect } from 'vitest';
import { computeSceneTrackOverrides } from '../hooks/dmx-playback';

// Scène statique : canaux absolus (adresse DMX), fixtures patchées avec startAddress.
const scenes = [
  { id: 'sc-1', name: 'Rouge', channels: { 5: 255, 6: 255, 7: 0, 8: 0 } },   // Wash 1 addr 1: dimmer@5, R@6, G@7, B@8
  { id: 'sc-2', name: 'Bleu', channels: { 5: 200, 6: 0, 7: 0, 8: 255 } },
];

const tracks = [
  { id: 'scene-track-1', name: 'Scene Track 1', entries: [{ id: 'e1', time: 0, endTime: 6, sceneId: 'sc-1', sceneName: 'Rouge' }] },
];

const fixtures = [
  { id: 'fx-1', name: 'Wash 1', startAddress: 1, channelCount: 10, universeId: 'u1' },
  { id: 'fx-2', name: 'Mini 1', startAddress: 43, channelCount: 12, universeId: 'u1' },
];

const groups: { id: string; fixtureIds: string[] }[] = [];

describe('computeSceneTrackOverrides', () => {
  it('forces the scene channels on overlapping fixtures during the block', () => {
    for (const t of [0, 0.5, 3.2, 5.9]) {
      const map = computeSceneTrackOverrides(tracks as any, scenes as any, t, fixtures as any, groups as any);
      expect(map.has('fx-1')).toBe(true);
      expect(map.has('fx-2')).toBe(false); // aucun canal de la scène sur Mini 1
      const cmap = map.get('fx-1')!;
      expect(cmap[5]).toBe(255);
      expect(cmap[6]).toBe(255);
      expect(cmap[7]).toBe(0);
      expect(cmap[8]).toBe(0);
      // Seuls les canaux de la scène sont forcés, pas toute la fixture
      expect(Object.keys(cmap).length).toBe(4);
      for (const v of Object.values(cmap)) {
        expect(typeof v).toBe('number');
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it('returns empty map when no block is active', () => {
    const map = computeSceneTrackOverrides(tracks as any, scenes as any, 7.0, fixtures as any, groups as any);
    expect(map.size).toBe(0);
  });

  it('returns empty map when the scene is missing or has no channels', () => {
    const empty = computeSceneTrackOverrides(
      [{ id: 't', name: 't', entries: [{ id: 'e', time: 0, endTime: 10, sceneId: 'missing' }] }] as any,
      scenes as any,
      1.0,
      fixtures as any,
      groups as any,
    );
    expect(empty.size).toBe(0);
  });

  it('handles several overlapping scene tracks (last one wins on shared channels)', () => {
    const twoTracks = [
      ...tracks,
      { id: 'scene-track-2', name: 'Scene Track 2', entries: [{ id: 'e2', time: 0, endTime: 10, sceneId: 'sc-2', sceneName: 'Bleu' }] },
    ];
    const map = computeSceneTrackOverrides(twoTracks as any, scenes as any, 1.0, fixtures as any, groups as any);
    expect(map.get('fx-1')?.[5]).toBe(200); // Bleu (chan 5 dimmer = 200)
    expect(map.get('fx-1')?.[8]).toBe(255);
  });
});