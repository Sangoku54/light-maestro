import { describe, expect, it } from 'vitest';
import {
  needsSupportGeometry,
  resolveSupportKind,
  SUPPORT_KINDS,
  SUPPORT_LABELS,
  supportColumnHeight,
} from '../utils/supports';

describe('supports — taxonomie des supports projecteurs', () => {
  it('expose les 4 supports standards (pont, totem, trépied, sol)', () => {
    expect(SUPPORT_KINDS).toEqual(['truss', 'totem', 'tripod', 'floor']);
    expect(SUPPORT_LABELS.truss).toBe('Pont');
    expect(SUPPORT_LABELS.totem).toBe('Totem');
    expect(SUPPORT_LABELS.tripod).toBe('Trépied');
    expect(SUPPORT_LABELS.floor).toBe('Sol');
  });

  it('résout le support effectif, absent/inconnu → pont (rendu historique)', () => {
    expect(resolveSupportKind(undefined)).toBe('truss');
    expect(resolveSupportKind('totem')).toBe('totem');
    expect(resolveSupportKind('tripod')).toBe('tripod');
    expect(resolveSupportKind('floor')).toBe('floor');
    expect(resolveSupportKind('grue')).toBe('truss');
  });

  it('calcule la hauteur de colonne depuis le plateau', () => {
    expect(supportColumnHeight(4.5, 1.5)).toBe(3);
    expect(supportColumnHeight(1.2, 1.5)).toBe(0);
  });

  it('ne dessine que totem/trépied au-dessus du plateau', () => {
    expect(needsSupportGeometry('truss', 3)).toBe(false);
    expect(needsSupportGeometry('floor', 3)).toBe(false);
    expect(needsSupportGeometry('totem', 3)).toBe(true);
    expect(needsSupportGeometry('tripod', 3)).toBe(true);
    expect(needsSupportGeometry('totem', 0.1)).toBe(false);
  });
});
