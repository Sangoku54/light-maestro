import { describe, expect, it } from 'vitest';
import type { PatchedFixture, SavedScene } from '../stores/showStore';
import { buildSceneFixtureIndex, collectFolderNames, normalizeFolderName, sceneTouchesFixture, scenesWithoutFixture } from '../utils/scene-fixtures';

const fx = (id: string, name: string, startAddress: number, channelCount: number, universeId = 'u1'): PatchedFixture => ({
  id,
  fixtureDefId: 'def',
  manufacturer: 'M',
  model: 'Model',
  fixtureType: 'MovingHead',
  modeIndex: 0,
  modeName: 'Mode',
  universeId,
  startAddress,
  channelCount,
  name,
  tier: 'primary',
});

const scene = (id: string, channels: Record<number, number>): SavedScene => ({
  id,
  name: id,
  channels,
  fadeIn: 1000,
  fadeOut: 1000,
  duration: 5000,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('normalizeFolderName', () => {
  it('trims leading/trailing whitespace and collapses inner spaces', () => {
    expect(normalizeFolderName('  front  lights ')).toBe('front lights');
    expect(normalizeFolderName('front')).toBe('front');
    expect(normalizeFolderName('  ')).toBe('');
    expect(normalizeFolderName('')).toBe('');
    expect(normalizeFolderName('front   lights')).toBe('front lights');
  });
});

describe('collectFolderNames', () => {
  it('unions declared folders with derived ones, deduped and sorted', () => {
    const scenes: SavedScene[] = [
      { id: 'a', name: 'A', channels: {}, fadeIn: 0, fadeOut: 0, duration: 0, createdAt: '', folder: 'front' },
      { id: 'b', name: 'B', channels: {}, fadeIn: 0, fadeOut: 0, duration: 0, createdAt: '', folder: '  back  ' },
      { id: 'c', name: 'C', channels: {}, fadeIn: 0, fadeOut: 0, duration: 0, createdAt: '' },
    ];
    expect(collectFolderNames(['front', 'strobe', '  '], scenes)).toEqual(['back', 'front', 'strobe']);
  });

  it('keeps declared-but-empty folders (real entities)', () => {
    const scenes: SavedScene[] = [];
    expect(collectFolderNames(['empty folder'], scenes)).toEqual(['empty folder']);
  });
});

describe('sceneTouchesFixture', () => {
  it('returns true for an address inside the fixture range', () => {
    const f = fx('f1', 'Wash', 101, 16);
    expect(sceneTouchesFixture(scene('s', { 105: 255 }), f)).toBe(true);
  });

  it('is inclusive on startAddress and exclusive on end', () => {
    const f = fx('f1', 'Wash', 101, 16); // range [101, 117)
    expect(sceneTouchesFixture(scene('s', { 101: 255 }), f)).toBe(true);
    expect(sceneTouchesFixture(scene('s', { 116: 255 }), f)).toBe(true);
    expect(sceneTouchesFixture(scene('s', { 117: 255 }), f)).toBe(false);
  });

  it('ignores the value: a 0 channel still counts (closed shutter is data)', () => {
    const f = fx('f1', 'Wash', 1, 10);
    expect(sceneTouchesFixture(scene('s', { 5: 0 }), f)).toBe(true);
  });

  it('returns false when no address overlaps', () => {
    const f = fx('f1', 'Wash', 1, 10);
    expect(sceneTouchesFixture(scene('s', { 11: 255, 200: 128 }), f)).toBe(false);
  });

  it('returns false for an empty scene', () => {
    const f = fx('f1', 'Wash', 1, 10);
    expect(sceneTouchesFixture(scene('s', {}), f)).toBe(false);
  });
});

describe('buildSceneFixtureIndex', () => {
  it('maps multi-fixture scenes to every fixture they touch', () => {
    const fixtures = [fx('f1', 'Wash', 1, 10), fx('f2', 'Beam', 101, 10)];
    const scenes = [scene('s1', { 5: 255 }), scene('s2', { 5: 255, 105: 255 }), scene('s3', {})];
    const { byFixture, byScene } = buildSceneFixtureIndex(scenes, fixtures);

    expect(byFixture.get('f1')).toEqual(['s1', 's2']);
    expect(byFixture.get('f2')).toEqual(['s2']);
    expect(byScene.get('s2')).toEqual(['f1', 'f2']);
    expect(byScene.get('s1')).toEqual(['f1']);
    expect(byScene.has('s3')).toBe(false);
  });

  it('treats the same address on different universes as touching both fixtures', () => {
    const fixtures = [fx('f1', 'U1 Wash', 1, 10, 'u1'), fx('f2', 'U2 Wash', 1, 10, 'u2')];
    const scenes = [scene('s', { 3: 128 })];
    const { byFixture, byScene } = buildSceneFixtureIndex(scenes, fixtures);
    expect(byFixture.get('f1')).toEqual(['s']);
    expect(byFixture.get('f2')).toEqual(['s']);
    expect(byScene.get('s')).toEqual(['f1', 'f2']);
  });

  it('handles an empty patch', () => {
    const { byFixture, byScene } = buildSceneFixtureIndex([scene('s', { 1: 255 })], []);
    expect(byFixture.size).toBe(0);
    expect(byScene.size).toBe(0);
  });
});

describe('scenesWithoutFixture', () => {
  it('returns scenes that touch no fixture', () => {
    const fixtures = [fx('f1', 'Wash', 1, 10)];
    const scenes = [scene('s1', { 5: 255 }), scene('s2', {}), scene('s3', { 300: 255 })];
    const { byScene } = buildSceneFixtureIndex(scenes, fixtures);
    expect(scenesWithoutFixture(scenes, byScene).map((s) => s.id)).toEqual(['s2', 's3']);
  });
});
