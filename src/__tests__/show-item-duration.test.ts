/**
 * Durées des blocs ajoutés aux pistes de show (ShowManager).
 *
 * Règle : la section créée respecte la durée programmée de la ressource
 * (chaser 10 s → bloc 10 s, scène 5 s → bloc 5 s). Replis si absente.
 */
import { describe, it, expect } from 'vitest';
import { showItemDuration } from '../utils/show-items';

describe('showItemDuration — respect des durées programmées', () => {
  it('ressource datée : durée reprise telle quelle', () => {
    expect(showItemDuration('scene', 5000)).toBe(5000);
    expect(showItemDuration('chaser', 10000)).toBe(10000);
    expect(showItemDuration('audio', 240000)).toBe(240000);
    expect(showItemDuration('matrix', 10000)).toBe(10000);
    expect(showItemDuration('efx', 4000)).toBe(4000);
  });

  it('scène infinie (0) ou absente : repli 10 s (bloc éditable ensuite)', () => {
    expect(showItemDuration('scene', 0)).toBe(10000);
    expect(showItemDuration('scene', undefined)).toBe(10000);
    expect(showItemDuration('scene', -100)).toBe(10000);
    expect(showItemDuration('scene', Number.NaN)).toBe(10000);
  });

  it('replis par type : chaser/matrice 10 s, EFX 4 s, défaut 5 s', () => {
    expect(showItemDuration('chaser', 0)).toBe(10000);
    expect(showItemDuration('matrix', undefined)).toBe(10000);
    expect(showItemDuration('efx', 0)).toBe(4000);
    expect(showItemDuration('audio', 0)).toBe(5000);
  });
});
