import { describe, expect, it } from 'vitest';
import {
  mapAllInOneLabel,
  mapAllInOneToSections,
  parseAllInOneJson,
} from '../utils/allinone-import';

const BASE = {
  bpm: 120,
  beats: [0.5, 1.0, 1.5, 2.0],
  beat_positions: [1, 2, 3, 4],
  downbeats: [0.5],
};

describe('allinone-import — mapping des labels', () => {
  it('mappe les 6 labels directs', () => {
    expect(mapAllInOneLabel('intro')).toBe('intro');
    expect(mapAllInOneLabel('verse')).toBe('verse');
    expect(mapAllInOneLabel('chorus')).toBe('chorus');
    expect(mapAllInOneLabel('bridge')).toBe('bridge');
    expect(mapAllInOneLabel('outro')).toBe('outro');
  });

  it('mappe break/inst/solo vers bridge/verse/chorus', () => {
    expect(mapAllInOneLabel('break')).toBe('bridge');
    expect(mapAllInOneLabel('inst')).toBe('verse');
    expect(mapAllInOneLabel('solo')).toBe('chorus');
  });

  it('ignore start/end et labels inconnus', () => {
    expect(mapAllInOneLabel('start')).toBeNull();
    expect(mapAllInOneLabel('end')).toBeNull();
    expect(mapAllInOneLabel('nope')).toBeNull();
  });
});

describe('allinone-import — conversion', () => {
  it('convertit une structure complète en sections contiguës', () => {
    const r = mapAllInOneToSections({
      ...BASE,
      duration: 60,
      segments: [
        { start: 0, end: 0.3, label: 'start' },
        { start: 0.3, end: 10, label: 'intro' },
        { start: 10, end: 25, label: 'verse' },
        { start: 25, end: 40, label: 'chorus' },
        { start: 40, end: 50, label: 'bridge' },
        { start: 50, end: 59.7, label: 'outro' },
        { start: 59.7, end: 60, label: 'end' },
      ],
    });
    expect(r.sections.map((s) => s.type)).toEqual(['intro', 'verse', 'chorus', 'bridge', 'outro']);
    expect(r.sections[0].startTime).toBe(0.3);
    expect(r.bpm).toBe(120);
    expect(r.beats).toEqual([0.5, 1.0, 1.5, 2.0]);
  });

  it('trie, clamp et fusionne les voisins de même type', () => {
    const r = mapAllInOneToSections({
      duration: 100,
      segments: [
        { start: 50, end: 70, label: 'chorus' },
        { start: -5, end: 20, label: 'verse' },
        { start: 20, end: 40, label: 'verse' },
        { start: 70, end: 500, label: 'outro' },
      ],
    });
    expect(r.sections.map((s) => s.type)).toEqual(['verse', 'chorus', 'outro']);
    expect(r.sections[0].startTime).toBe(0);
    expect(r.sections[2].endTime).toBe(100);
  });

  it('absorbe les micro-segments (< 1s)', () => {
    const r = mapAllInOneToSections({
      duration: 60,
      segments: [
        { start: 0, end: 10, label: 'verse' },
        { start: 10, end: 10.4, label: 'chorus' },
        { start: 10.4, end: 30, label: 'chorus' },
      ],
    });
    expect(r.sections.map((s) => s.type)).toEqual(['verse', 'chorus']);
  });

  it('cale les frontières sur les temps (±0,3s)', () => {
    const r = mapAllInOneToSections({
      duration: 60,
      beats: [10.0, 20.0, 30.0],
      segments: [
        { start: 0, end: 10.2, label: 'verse' },
        { start: 10.2, end: 20.5, label: 'chorus' },
        { start: 20.5, end: 60, label: 'verse' },
      ],
    });
    // 10.2 → 10.0 (à 0,2s) ; 20.5 trop loin (0,5s) → gardé
    expect(r.sections[0].endTime).toBe(10);
    expect(r.sections[1].startTime).toBe(10);
    expect(r.sections[1].endTime).toBe(20.5);
  });

  it('rejette les entrées invalides', () => {
    expect(() => parseAllInOneJson('nope')).toThrow();
    expect(() => parseAllInOneJson('{"bpm":120}')).toThrow();
    expect(() => mapAllInOneToSections({ segments: [] })).toThrow();
    expect(() =>
      mapAllInOneToSections({ segments: [{ start: 0, end: 1, label: 'start' }] }),
    ).toThrow();
  });
});
