/**
 * Cadre 2D de la scène (Stage2DEditor) — source unique de vérité.
 *
 * Proportions EXACTES de stageDims : AUCUN clamp d'aspect. Régression corrigée :
 * l'ancien `Math.max(0.2, Math.min(5, W/D))` écrasait l'aspect des scènes très
 * allongées (ex. 2 m × 20 m → aspect 0.1 forcé à 0.2). Les échelles pixels x/y
 * devenaient non uniformes et la rotation d'un plateau (`ctx.rotate`) dessinée
 * en espace pixel ne correspondait plus à la rotation monde (vue 3D) — les
 * plateaux secondaires rotatés étaient rendus avec de mauvaises proportions et
 * les fixtures posées dessus en 3D semblaient hors plateau en 2D.
 *
 * Avec un cadre à l'aspect vrai, l'échelle pixels est IDENTIQUE en X et Y
 * (px/m uniforme) : une rotation pixel ⇔ rotation monde.
 */

export interface StageFrame {
  /** Largeur du cadre scène en px. */
  sw: number;
  /** Hauteur du cadre scène en px. */
  sh: number;
  /** Décalage gauche (centrage horizontal dans le canvas). */
  padX: number;
  /** Décalage haut (centrage vertical dans le canvas). */
  padY: number;
}

export function computeStageFrame(
  widthPx: number,
  heightPx: number,
  stageDims: { width: number; depth: number },
): StageFrame {
  const availW = Math.max(80, widthPx);
  const availH = Math.max(80, heightPx);
  const aspect = stageDims.width / Math.max(0.001, stageDims.depth);
  let sw: number, sh: number;
  if (availW / availH > aspect) {
    sh = availH;
    sw = sh * aspect;
  } else {
    sw = availW;
    sh = sw / aspect;
  }
  return { sw, sh, padX: (widthPx - sw) / 2, padY: (heightPx - sh) / 2 };
}
