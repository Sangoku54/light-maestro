import { describe, it, expect } from 'vitest';
import { clampRect } from '../components/clampedpopup';

describe('clampRect (popovers dans la fenêtre)', () => {
  const vw = 800, vh = 600, m = 8;
  const w = 240, h = 160;

  it('laisse une position intérieure inchangée', () => {
    expect(clampRect(50, 50, w, h, vw, vh, m)).toEqual({ left: 50, top: 50 });
  });

  it('ramène un clic en bas à droite dans la fenêtre', () => {
    expect(clampRect(790, 590, w, h, vw, vh, m)).toEqual({ left: 800 - 240 - 8, top: 600 - 160 - 8 });
  });

  it('ramène un clic en haut à gauche (négatif) dans la fenêtre', () => {
    expect(clampRect(-20, -20, w, h, vw, vh, m)).toEqual({ left: 8, top: 8 });
  });

  it('ramène un clic sur le bord droit exact', () => {
    expect(clampRect(800, 300, w, h, vw, vh, m)).toEqual({ left: 552, top: 300 });
  });

  it('ramène un clic sur le bord bas exact', () => {
    expect(clampRect(400, 600, w, h, vw, vh, m)).toEqual({ left: 400, top: 432 });
  });

  it('un popover plus grand que le viewport est collé à la marge', () => {
    expect(clampRect(10, 10, 900, 700, vw, vh, m)).toEqual({ left: 8, top: 8 });
  });
});