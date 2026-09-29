/**
 * Extinction de fin de matrice (rgb-matrix-playback).
 *
 * Quand plus aucune matrice n'est active, les dernières valeurs écrites
 * restaient figées dans l'arbitre (contribution persistante) : le motif
 * s'arrêtait mais les fixtures restaient allumées. flushMatrixIdle envoie
 * des zéros transitoires sur les adresses écrites puis vide le registre.
 */
import { describe, it, expect } from 'vitest';
import { flushMatrixIdle } from '../hooks/rgb-matrix-playback';

describe('flushMatrixIdle — extinction de fin de matrice', () => {
  it('zéros sur les adresses écrites puis registre vidé', () => {
    const sent: Array<{ uni: number; zeros: Record<number, number> }> = [];
    const lastAddrs = new Map<number, Set<number>>([
      [0, new Set([1, 2, 3])],
      [1, new Set([10])],
    ]);
    flushMatrixIdle(lastAddrs, (uni, zeros) => { sent.push({ uni, zeros }); });
    expect(sent).toEqual([
      { uni: 0, zeros: { 1: 0, 2: 0, 3: 0 } },
      { uni: 1, zeros: { 10: 0 } },
    ]);
    expect(lastAddrs.size).toBe(0);
  });

  it('registre vide : aucun envoi', () => {
    const sent: unknown[] = [];
    flushMatrixIdle(new Map(), (uni, zeros) => { sent.push([uni, zeros]); });
    expect(sent).toEqual([]);
  });
});
