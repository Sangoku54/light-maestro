import { describe, it, expect } from 'vitest';
import { sameEfxEntry } from '../views/QuickShowView';
import type { EfxTrackEntry } from '../views/TrackTimeline';

const base: EfxTrackEntry = {
  time: 5,
  endTime: 15,
  effectId: 'eff-1',
  effectName: 'Circle',
  pattern: 'Circle',
  fixtureNames: [],
};

describe('sameEfxEntry — identité des entrées EFX', () => {
  it('matche par id stable quand les deux en ont un (mêmes time/endTime requis)', () => {
    const a: EfxTrackEntry = { ...base, id: 'e1' };
    const b: EfxTrackEntry = { ...base, id: 'e1' };
    expect(sameEfxEntry(a, b)).toBe(true);
  });

  it('ne matche PAS deux ids différents même à time/endTime identiques', () => {
    const a: EfxTrackEntry = { ...base, id: 'e1' };
    const b: EfxTrackEntry = { ...base, id: 'e2' };
    expect(sameEfxEntry(a, b)).toBe(false);
  });

  it('matche par id même si les bornes ont changé entre-temps', () => {
    const a: EfxTrackEntry = { ...base, id: 'e1', time: 5, endTime: 15 };
    const b: EfxTrackEntry = { ...base, id: 'e1', time: 9, endTime: 12 };
    expect(sameEfxEntry(a, b)).toBe(true);
  });

  it('fallback time+endTime quand aucun id (sauvegardes anciennes)', () => {
    const a: EfxTrackEntry = { ...base, time: 5, endTime: 15 };
    const b: EfxTrackEntry = { ...base, time: 5, endTime: 15 };
    expect(sameEfxEntry(a, b)).toBe(true);
  });

  it('fallback time+endTime quand un seul des deux a un id', () => {
    const a: EfxTrackEntry = { ...base, id: 'e1', time: 5, endTime: 15 };
    const b: EfxTrackEntry = { ...base, time: 5, endTime: 15 };
    expect(sameEfxEntry(a, b)).toBe(true);
  });

  it('ne matche pas des bornes différentes sans id', () => {
    const a: EfxTrackEntry = { ...base, time: 5, endTime: 15 };
    const b: EfxTrackEntry = { ...base, time: 8, endTime: 20 };
    expect(sameEfxEntry(a, b)).toBe(false);
  });
});