/**
 * Presets de pages pour la Console Virtuelle.
 *
 * `buildAkaiSurfaceWidgets` construit une surface de contrôle type
 * Akai MIDIMIX (3 rangées de 8 pads + 8 faders) déjà pré-programmée :
 *   - rangée 1 : les 8 premières scènes du projet
 *   - rangée 2 : les 8 premiers chasers du projet
 *   - rangée 3 : Blackout + 7 boucles auto du catalogue (ou touches libres)
 *   - faders   : fader 1 = Grand Master, faders 2..8 = canaux DMX U1 Ch1..Ch7
 *
 * Fonction pure (pas de store) : testable telle quelle dans
 * `src/__tests__/vc-akai-surface.test.ts`. L'action du store ne fait que
 * générer les ids et pousser le résultat dans `vcWidgets`.
 */

import type { ConsoleWidget, ConsoleWidgetConfig } from './performStore';
import type { LoopRecipe } from '../engine/auto-loops';

export interface AkaiSurfacePreset {
  scenes: { id: string; name: string }[];
  chasers: { id: string; name: string }[];
  loops: LoopRecipe[];
}

/** Colonnes alignées sur la grille de 20 px (vcGridSnap). */
const COL_X = (i: number) => 20 + i * 120;
const FADER_X = (i: number) => 40 + i * 120;
const PAD_ROWS_Y = [40, 100, 160] as const;
const PAD_W = 100;
const PAD_H = 48;
const FADER_Y = 220;
const FADER_W = 60;
const FADER_H = 240;
const FRAME_W = 980;
const FRAME_H = 480;
const COLUMNS = 8;

const COLORS = {
  scene: '#a855f7',
  chaser: '#22c55e',
  blackout: '#ef4444',
  autoLoop: '#8b5cf6',
  free: '#64748b',
  frame: '#3b82f6',
  slider: '#f59e0b',
};

function pad(
  makeId: () => string,
  pageIndex: number,
  frameId: string,
  col: number,
  row: number,
  config: ConsoleWidgetConfig,
): ConsoleWidget {
  return {
    id: makeId(),
    type: 'button',
    x: COL_X(col),
    y: PAD_ROWS_Y[row],
    width: PAD_W,
    height: PAD_H,
    config,
    frameId,
    pageIndex,
  };
}

/**
 * Construit la surface Akai (frame + 24 pads + 8 faders).
 * @param makeId fabrique d'identifiants (injectable pour les tests)
 */
export function buildAkaiSurfaceWidgets(
  preset: AkaiSurfacePreset,
  pageIndex: number,
  makeId: () => string,
): ConsoleWidget[] {
  const scenes = preset.scenes ?? [];
  const chasers = preset.chasers ?? [];
  const loops = preset.loops ?? [];

  const frameId = makeId();
  const widgets: ConsoleWidget[] = [
    {
      id: frameId,
      type: 'frame',
      x: 0,
      y: 0,
      width: FRAME_W,
      height: FRAME_H,
      config: { title: 'Akai MIDIMIX', color: COLORS.frame },
      pageIndex,
    },
  ];

  // Rangée 1 : scènes
  for (let i = 0; i < COLUMNS; i++) {
    const scene = scenes[i];
    widgets.push(
      pad(makeId, pageIndex, frameId, i, 0, {
        actionType: 'scene',
        sceneId: scene?.id,
        label: scene?.name || `Scène ${i + 1}`,
        color: COLORS.scene,
      }),
    );
  }

  // Rangée 2 : chasers
  for (let i = 0; i < COLUMNS; i++) {
    const chaser = chasers[i];
    widgets.push(
      pad(makeId, pageIndex, frameId, i, 1, {
        actionType: 'chaser',
        chaserId: chaser?.id,
        label: chaser?.name || `Chaser ${i + 1}`,
        color: COLORS.chaser,
      }),
    );
  }

  // Rangée 3 : Blackout + boucles auto (touches libres en complément)
  for (let i = 0; i < COLUMNS; i++) {
    if (i === 0) {
      widgets.push(
        pad(makeId, pageIndex, frameId, i, 2, {
          actionType: 'blackout',
          label: 'Blackout',
          color: COLORS.blackout,
        }),
      );
      continue;
    }
    const loop = loops[i - 1];
    widgets.push(
      pad(makeId, pageIndex, frameId, i, 2, loop
        ? { actionType: 'autoLoop', autoLoopRecipe: loop, label: loop.name, color: COLORS.autoLoop }
        : { label: `Libre ${i}`, color: COLORS.free }),
    );
  }

  // Faders : GM + 7 canaux DMX
  for (let i = 0; i < COLUMNS; i++) {
    const config: ConsoleWidgetConfig = i === 0
      ? { sliderFunction: 'grandMaster', label: 'GM', min: 0, max: 255, step: 1 }
      : {
          sliderFunction: 'channel',
          sliderUniverse: 0,
          channelAddress: i,
          label: `Ch ${i}`,
          min: 0,
          max: 255,
          step: 1,
        };
    widgets.push({
      id: makeId(),
      type: 'slider',
      x: FADER_X(i),
      y: FADER_Y,
      width: FADER_W,
      height: FADER_H,
      config,
      frameId,
      pageIndex,
    });
  }

  return widgets;
}
