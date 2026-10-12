/**
 * Structures de scène libres : création, migration, assainissement.
 */
import { describe, it, expect } from 'vitest';
import {
  RIG_KINDS,
  defaultStageRigs,
  makeRig,
  migrateStageRigs,
  sanitizeRigUpdates,
  DEFAULT_RIG_SPANS,
  DEFAULT_RIG_HEIGHTS,
} from '../utils/stage-rigs';

describe('stage-rigs — structures libres', () => {
  it('scène nue par défaut (aucune structure imposée)', () => {
    expect(defaultStageRigs()).toEqual([]);
  });

  it('makeRig : type, dimensions et pose par défaut', () => {
    const truss = makeRig('r1', 'truss', 1);
    expect(truss).toMatchObject({ kind: 'truss', h: 3, span: 6, hung: true, rot: 0 });
    const bar = makeRig('r2', 'frontBar', 2);
    expect(bar).toMatchObject({ kind: 'frontBar', h: 3, span: 4, cy: 0.12 });
    expect(bar.name).toContain('Barre avant');
    const t = makeRig('r3', 'tBar', 1);
    expect(t).toMatchObject({ kind: 'tBar', h: 2.2, span: 0 });
    for (const kind of RIG_KINDS) {
      const rig = makeRig('x', kind, 1);
      expect(rig.cx).toBeGreaterThanOrEqual(0);
      expect(rig.cx).toBeLessThanOrEqual(1);
      expect(DEFAULT_RIG_HEIGHTS[kind]).toBeGreaterThan(0);
    }
  });

  it('migrate : données invalides → liste vide ; entrées corrompues bornées', () => {
    expect(migrateStageRigs(undefined)).toEqual([]);
    expect(migrateStageRigs(null)).toEqual([]);
    expect(migrateStageRigs('nope')).toEqual([]);
    const [rig] = migrateStageRigs([{ kind: 'tBar', cx: 9, h: -5, span: 999, rot: 450, hung: false }]);
    expect(rig.kind).toBe('tBar');
    expect(rig.cx).toBe(1.3);
    expect(rig.h).toBe(0);
    expect(rig.span).toBe(20);
    expect(rig.rot).toBe(90);
    expect(rig.hung).toBe(false);
    // Type inconnu → pont, valeurs par défaut.
    const [fallback] = migrateStageRigs([{ kind: 'grue' }]);
    expect(fallback.kind).toBe('truss');
    expect(fallback.h).toBe(DEFAULT_RIG_HEIGHTS.truss);
    expect(fallback.span).toBe(DEFAULT_RIG_SPANS.truss);
  });

  it('sanitize : frappe en cours ignorée, rot normalisée', () => {
    expect(sanitizeRigUpdates({ h: NaN })).toEqual({});
    expect(sanitizeRigUpdates({ cx: Infinity })).toEqual({});
    expect(sanitizeRigUpdates({ name: '  ' })).toEqual({});
    expect(sanitizeRigUpdates({ rot: 450 })).toEqual({ rot: 90 });
    expect(sanitizeRigUpdates({ hung: false })).toEqual({ hung: false });
    expect(sanitizeRigUpdates({ h: 4, span: 8 })).toEqual({ h: 4, span: 8 });
  });
});
