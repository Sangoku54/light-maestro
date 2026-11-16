/**
 * Cadre 2D de la scène — proportions vraies + rotation des plateaux fidèle à la 3D.
 *
 * Régression (tuto.lmproj) : scène 2 m × 20 m (aspect 0.1). L'ancien clamp
 * `Math.max(0.2, Math.min(5, W/D))` forçait l'aspect à 0.2 → échelles px/m non
 * uniformes (80 px/m en X, 40 px/m en Y) → la rotation pixel d'un plateau rotaté
 * (rot=90°) ne correspondait plus à la rotation monde : le plateau secondaire
 * était dessiné avec de mauvaises proportions et les fixtures posées dessus en 3D
 * paraissaient hors plateau en 2D.
 */
import { describe, it, expect } from 'vitest';
import { computeStageFrame } from '../utils/stage-frame';
import { deckRectMeters } from '../utils/stage-decks';

// Config réelle du projet tuto.lmproj
const DIMS = { width: 2, depth: 20 };
const CANVAS = { w: 1000, h: 800 };
const DECK2 = { cx: 0.5, cy: 0.95, w: 1, d: 0.4, h: 1.5, rot: 90 };

describe('computeStageFrame — aspect vrai (aucun clamp)', () => {
  it('scène 2×20 m : l\'aspect 0.1 est PRÉSERVÉ (pas écrasé à 0.2)', () => {
    const f = computeStageFrame(CANVAS.w, CANVAS.h, DIMS);
    expect(f.sw / f.sh).toBeCloseTo(2 / 20, 9);
  });

  it('échelle pixels UNIFORME : px/m identiques en X et en Y', () => {
    const f = computeStageFrame(CANVAS.w, CANVAS.h, DIMS);
    const pxPerMx = f.sw / DIMS.width;
    const pxPerMy = f.sh / DIMS.depth;
    expect(pxPerMx).toBeCloseTo(pxPerMy, 9);
  });

  it('plateau rotaté 90° : empreinte pixel = empreinte monde (fidèle à la 3D)', () => {
    const f = computeStageFrame(CANVAS.w, CANVAS.h, DIMS);
    const r = deckRectMeters(DECK2 as never, DIMS);
    // Dessin 2D : rect (dw × dh) translaté au centre puis rotate(90°) en espace pixel.
    const dw = (r.w / DIMS.width) * f.sw;
    const dh = (r.d / DIMS.depth) * f.sh;
    const drawnHorizontal = dh; // après rotate 90°
    const drawnVertical = dw;
    // Empreinte monde après rotation : 8 m en X, 2 m en Z → converties avec l'échelle uniforme.
    const pxPerM = f.sw / DIMS.width;
    const worldHorizontal = r.d * pxPerM; // r.d = 8 m (devient la largeur au sol)
    const worldVertical = r.w * pxPerM;   // r.w = 2 m (devient la profondeur au sol)
    expect(drawnHorizontal).toBeCloseTo(worldHorizontal, 9);
    expect(drawnVertical).toBeCloseTo(worldVertical, 9);
  });

  it('fixture au centre du plateau rotaté : même pixel en 2D que le centre du plateau', () => {
    const f = computeStageFrame(CANVAS.w, CANVAS.h, DIMS);
    const r = deckRectMeters(DECK2 as never, DIMS);
    const deckCx = f.padX + ((r.x / DIMS.width) + 0.5) * f.sw;
    const deckCy = f.padY + ((r.z / DIMS.depth) + 0.5) * f.sh;
    // Une fixture posée au centre du plateau en 3D a pos.x = deck.cx, pos.y = deck.cy.
    const fx = f.padX + DECK2.cx * f.sw;
    const fy = f.padY + DECK2.cy * f.sh;
    expect(fx).toBeCloseTo(deckCx, 9);
    expect(fy).toBeCloseTo(deckCy, 9);
  });

  it('fixtures du projet (y=1, x 0.08→0.92) : toutes DANS l\'empreinte du plateau rotaté', () => {
    const f = computeStageFrame(CANVAS.w, CANVAS.h, DIMS);
    const r = deckRectMeters(DECK2 as never, DIMS);
    const deckCx = f.padX + ((r.x / DIMS.width) + 0.5) * f.sw;
    const deckCy = f.padY + ((r.z / DIMS.depth) + 0.5) * f.sh;
    const dw = (r.w / DIMS.width) * f.sw;
    const dh = (r.d / DIMS.depth) * f.sh;
    // Empreinte après rotation 90° : horizontal ±dh/2, vertical ±dw/2.
    const halfW = dh / 2;
    const halfH = dw / 2;
    for (const x of [0.083, 0.36, 0.637, 0.9246]) {
      const fx = f.padX + x * f.sw;
      expect(Math.abs(fx - deckCx)).toBeLessThanOrEqual(halfW + 1e-9);
    }
    const fy = f.padY + 1.0 * f.sh;
    expect(Math.abs(fy - deckCy)).toBeLessThanOrEqual(halfH + 1e-9);
  });

  it('scène classique 10×8 : inchangé (l\'ancien clamp ne s\'appliquait pas)', () => {
    const f = computeStageFrame(800, 600, { width: 10, depth: 8 });
    expect(f.sw / f.sh).toBeCloseTo(1.25, 9);
  });
});
