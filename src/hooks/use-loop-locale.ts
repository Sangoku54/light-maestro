/**
 * Synchronise les libellés du moteur de boucles avec la langue UI.
 *
 * Les builders (auto-loops.ts, autoloop-themes.ts) lisent le registre
 * (autoloop-types.ts, français par défaut) au moment de la GÉNÉRATION :
 * ce hook le remplit depuis i18next à chaque changement de langue, et les
 * bibliothèques sont régénérées par les composants (dépendance langue).
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setLoopLocaleText } from '../engine/autoloop-types';
import { matrixRecipeLabels } from '../engine/autoloop-themes';

const WORD_KEYS = [
  'chase', 'colorChase', 'movement', 'dimmerPulse', 'strobe', 'colorWheel',
  'gobo', 'effect', 'prism', 'laserPatterns', 'laserScan', 'laserScan8',
  'laserColor', 'autoPrefix', 'tmplStrobeSlow', 'tmplStrobeFast',
  'tmplBreathSlow', 'tmplBreathFast', 'tmplWheel', 'tmplWheelGrad',
  'tmplGobo', 'tmplGoboFast', 'tmplPrism', 'tmplBeamZoom', 'tmplBeamIris',
  'tmplBeamFrost', 'tmplBeamFocus', 'tmplLaserScan', 'tmplLaserPattern',
  'tmplMoveRadiusColor', 'tmplBreathPeriod', 'tmplMixSuffixStrobe',
  'tmplMixSuffixBreath', 'tmplMixSuffixStrobeFast', 'tmplMixSuffixWheel',
  'tmplNoChannel',
];

const COLOR_HEXES = [
  '#ff0000', '#00ff00', '#0000ff', '#ffffff', '#ffff00', '#00ffff',
  '#ff00ff', '#ff8000', '#8000ff', '#ff4080', '#80ff00', '#00ffc8',
  '#ffc000', '#4000ff', '#ff6f61', '#ffa07a', '#bfff00', '#00bfff',
  '#b57edc', '#8b0036', '#808000', '#3eb489', '#ffcba4', '#50c878',
  '#008080', '#dda0dd', '#fff5e1', '#c0c0c0', '#ff1493', '#39ff14',
  '#00e5ff', '#ffbf00',
];

const MOVES = [
  'circle', 'square', 'figure8', 'zigzag', 'sweep', 'wave', 'bounce',
  'pulse', 'static', 'spiral', 'heartbeat', 'randomWalk', 'panOnly',
  'tiltOnly', 'diamond', 'intro', 'verse', 'chorus', 'bridge', 'drop', 'outro',
];

export function syncLoopLocale(t: (k: string) => string): void {
  const words: Record<string, string> = {};
  for (const k of WORD_KEYS) words[k] = t(`loops.engine.words.${k}`);
  const colors: Record<string, string> = {};
  for (const h of COLOR_HEXES) colors[h] = t(`loops.engine.colors.${h}`);
  const movements: Record<string, string> = {};
  for (const m of MOVES) movements[m] = t(`loops.engine.movements.${m}`);
  // Recettes matrice : clés = libellés FR sources (stables), cf. JSON.
  const matrix: Record<string, string> = {};
  for (const fr of matrixRecipeLabels()) matrix[fr] = t(`loops.engine.matrix.${fr}`);
  setLoopLocaleText({ words, colors, movements, matrix });
}

export function useLoopLocale(): void {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    syncLoopLocale(t as (k: string) => string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);
}
