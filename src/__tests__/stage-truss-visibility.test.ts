/**
 * Visibilité des poutres structurelles — régression « ponts fantômes ».
 *
 * Bug : le rebuild de la scène 3D (changement de dimensions de scène ou de
 * plateaux) recrée les beams avec `visible = true` en dur. L'effet de synchro
 * ne réagissait qu'à `stageScene` (inchangé lors d'un rebuild) → les ponts
 * avant/arrière réapparaissaient sans avoir été demandés.
 *
 * Le fix applique `applyTrussVisibility` à la CRÉATION des beams et après
 * chaque rebuild. Ces tests simulent exactement ce flux : beams fraîchement
 * créés (tout visible) → application → visibilité attendue selon la scène.
 */
import { describe, it, expect } from 'vitest';
import { applyTrussVisibility, type TrussBeams } from '../utils/stage-truss-visibility';

/** Simule des beams fraîchement créés par le rebuild de scène : tout visible. */
function freshBeams(): TrussBeams {
  return {
    back: { visible: true },
    front: { visible: true },
    left: { visible: true },
    right: { visible: true },
    poles: [
      { visible: true, userData: { corner: 'left-back' } },
      { visible: true, userData: { corner: 'right-back' } },
      { visible: true, userData: { corner: 'left-front' } },
      { visible: true, userData: { corner: 'right-front' } },
    ],
  };
}

describe('applyTrussVisibility — pas de ponts fantômes après rebuild', () => {
  it('scène vide : beams reconstruits → TOUT caché (le bug rapporté)', () => {
    const tr = freshBeams(); // rebuild : tout visible en dur
    applyTrussVisibility(tr, 'empty');
    expect(tr.back?.visible).toBe(false);
    expect(tr.front?.visible).toBe(false);
    expect(tr.left?.visible).toBe(false);
    expect(tr.right?.visible).toBe(false);
    for (const pole of tr.poles) expect(pole.visible).toBe(false);
  });

  it('rear-front : back + front visibles, côtés cachés, poteaux arrière visibles', () => {
    const tr = freshBeams();
    applyTrussVisibility(tr, 'rear-front');
    expect(tr.back?.visible).toBe(true);
    expect(tr.front?.visible).toBe(true);
    expect(tr.left?.visible).toBe(false);
    expect(tr.right?.visible).toBe(false);
    const back = tr.poles.filter((p) => p.userData?.corner?.includes('back'));
    const front = tr.poles.filter((p) => p.userData?.corner?.includes('front'));
    for (const p of back) expect(p.visible).toBe(true);
    for (const p of front) expect(p.visible).toBe(true);
  });

  it('full : toutes les poutres visibles', () => {
    const tr = freshBeams();
    applyTrussVisibility(tr, 'full');
    expect(tr.back?.visible).toBe(true);
    expect(tr.front?.visible).toBe(true);
    expect(tr.left?.visible).toBe(true);
    expect(tr.right?.visible).toBe(true);
  });

  it('changement de scène inverse : full → empty re-cache tout', () => {
    const tr = freshBeams();
    applyTrussVisibility(tr, 'full');
    expect(tr.front?.visible).toBe(true);
    applyTrussVisibility(tr, 'empty');
    expect(tr.front?.visible).toBe(false);
    expect(tr.back?.visible).toBe(false);
  });
});
