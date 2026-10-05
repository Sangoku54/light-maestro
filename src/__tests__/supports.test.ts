/**
 * Supports physiques : taxonomie (pont, totem, trépied, sol) + barres
 * avant/arrière (longueur libre, suspendu/posé).
 */
import { describe, expect, it } from 'vitest';
import {
  needsSupportGeometry,
  resolveSupportKind,
  SUPPORT_KINDS,
  SUPPORT_LABELS,
  supportColumnHeight,
  isBarSupport,
  DEFAULT_BAR_SPAN,
  BAR_HUNG_DEFAULT,
} from '../utils/supports';

describe('supports — taxonomie des supports projecteurs', () => {
  it('expose les 6 supports (pont, totem, trépied, sol, barres) en ordre stable', () => {
    expect(SUPPORT_KINDS).toEqual(['truss', 'totem', 'tripod', 'floor', 'frontBar', 'backBar']);
    expect(SUPPORT_LABELS.truss).toBe('Pont');
    expect(SUPPORT_LABELS.totem).toBe('Totem');
    expect(SUPPORT_LABELS.tripod).toBe('Trépied');
    expect(SUPPORT_LABELS.floor).toBe('Sol');
    expect(SUPPORT_LABELS.frontBar).toBe('Barre avant');
    expect(SUPPORT_LABELS.backBar).toBe('Barre arrière');
  });

  it('résout le support effectif, absent/inconnu → pont (rendu historique)', () => {
    expect(resolveSupportKind(undefined)).toBe('truss');
    expect(resolveSupportKind('totem')).toBe('totem');
    expect(resolveSupportKind('tripod')).toBe('tripod');
    expect(resolveSupportKind('floor')).toBe('floor');
    expect(resolveSupportKind('frontBar')).toBe('frontBar');
    expect(resolveSupportKind('backBar')).toBe('backBar');
    expect(resolveSupportKind('grue')).toBe('truss');
  });

  it('calcule la hauteur de colonne depuis le plateau', () => {
    expect(supportColumnHeight(4.5, 1.5)).toBe(3);
    expect(supportColumnHeight(1.2, 1.5)).toBe(0);
  });

  it('ne dessine que totem/trépied au-dessus du plateau (barres : toujours)', () => {
    expect(needsSupportGeometry('truss', 3)).toBe(false);
    expect(needsSupportGeometry('floor', 3)).toBe(false);
    expect(needsSupportGeometry('totem', 3)).toBe(true);
    expect(needsSupportGeometry('tripod', 3)).toBe(true);
    expect(needsSupportGeometry('totem', 0.1)).toBe(false);
    // La barre flotte au-dessus de la tête : dessinée même à hauteur 0.
    expect(needsSupportGeometry('frontBar', 0)).toBe(true);
    expect(needsSupportGeometry('backBar', 0)).toBe(true);
  });

  it('barres : suspendues par défaut, longueur libre de 4 m', () => {
    expect(isBarSupport('frontBar')).toBe(true);
    expect(isBarSupport('backBar')).toBe(true);
    expect(isBarSupport('totem')).toBe(false);
    expect(isBarSupport('truss')).toBe(false);
    expect(DEFAULT_BAR_SPAN).toBe(4);
    expect(BAR_HUNG_DEFAULT).toBe(true);
  });
});
