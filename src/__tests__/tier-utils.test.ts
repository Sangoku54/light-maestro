import { describe, expect, it } from 'vitest';
import { TIER_KEYS, groupByTier } from '../engine/tier-utils';

interface FakeFixture {
  id: string;
  name: string;
  tier?: string | null;
}

const pf = (id: string, tier?: string): FakeFixture => ({ id, name: id, tier });

describe('groupByTier', () => {
  it('régression crash : fixture en tier "other" ne déclenche plus undefined.push', () => {
    expect(() => groupByTier([pf('a', 'primary'), pf('b', 'other')])).not.toThrow();
  });

  it('pré-initialise les 4 buckets connus', () => {
    const map = groupByTier([]);
    for (const key of TIER_KEYS) {
      expect(Array.isArray(map[key])).toBe(true);
      expect(map[key]).toHaveLength(0);
    }
  });

  it('range les fixtures dans leur tier respectif', () => {
    const map = groupByTier([
      pf('p', 'primary'),
      pf('s', 'secondary'),
      pf('t', 'tertiary'),
      pf('o', 'other'),
    ]);
    expect(map.primary.map((f) => f.id)).toEqual(['p']);
    expect(map.secondary.map((f) => f.id)).toEqual(['s']);
    expect(map.tertiary.map((f) => f.id)).toEqual(['t']);
    expect(map.other.map((f) => f.id)).toEqual(['o']);
  });

  it('tier absent ou vide → bucket primary', () => {
    expect(groupByTier([pf('x')]).primary.map((f) => f.id)).toEqual(['x']);
    expect(groupByTier([{ id: 'y', name: 'y', tier: '' }]).primary.map((f) => f.id)).toEqual(['y']);
  });

  it('défense en profondeur : tier inconnu ne crashe pas et reçoit son bucket', () => {
    const map = groupByTier([pf('z', 'laser4d')]);
    expect(map.laser4d.map((f) => f.id)).toEqual(['z']);
  });
});