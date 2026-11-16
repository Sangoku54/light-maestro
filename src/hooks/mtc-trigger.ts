/**
 * MTC Triggers Hook (lot #15) — consomme `midi:mtc` (état décodé en main,
 * ≤ ~30 msg/s) et :
 *   1. met à jour l'état MTC courant dans performStore (panneau MTCPanel) ;
 *   2. déclenche les marqueurs timecode franchis (edge-trigger) vers le
 *      même moteur fade/hold que MIDI/Remote (midi-actions.ts, sources
 *      arbitre 'mtc' / 'mtc-chaser', LTP 72).
 *
 * Monté UNE SEULE FOIS dans app.tsx (global, comme useMidiTriggers) — les
 * cues timecode doivent fonctionner quelle que soit la vue active.
 *
 * Anti-rebond : un marqueur ne se déclenche qu'une fois par passage
 * (ensemble `played`). Jump arrière / re-lock → reset complet (tout
 * redevient jouable) sans déclenchement en rafale.
 */

import { useEffect, useRef } from 'react';
import type { MtcState } from '@electron/midi/mtc';
import {
  mtcPlayChaser,
  mtcPlayScene,
  mtcStopChaser,
  mtcStopScene,
  mtcToggleScene,
} from '../engine/midi-actions';
import {
  evaluateMtcMarkers,
  mtcStateToMs,
  type MtcMarker,
} from '../engine/mtc-markers';
import { useShowStore } from '../stores/showStore';
import { usePerformStore } from '../stores/performStore';

interface MtcApiContract {
  onMtc: (cb: (s: MtcState) => void) => (() => void) | void;
}

function getMtcApi(): MtcApiContract | null {
  const api = (window as any)?.lightMaestro?.midi;
  return api ? (api as unknown as MtcApiContract) : null;
}

export function useMtcTriggers(): void {
  // Refs : survit aux re-rendus sans re-souscription.
  const prevMsRef = useRef<number | null>(null);
  const playedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const api = getMtcApi();
    if (!api?.onMtc) {
      console.debug('[mtc-trigger] API MTC indisponible (preload absent) — cues non branchés');
      return;
    }

    const unsubscribe = api.onMtc((state) => {
      // 1) Miroir UI : le panneau MTC lit cet état (performStore).
      usePerformStore.getState().setMtcState(state);

      // 2) Edge-trigger des marqueurs.
      const markers = useShowStore.getState().mtcMarkers ?? [];
      const currMs = mtcStateToMs(state);
      if (currMs === null) {
        // Unlock : la timeline peut avoir bougé pendant l'absence de flux.
        // On vide l'ensemble « déjà joué » (tout redevient jouable — un
        // re-lock à une position antérieure re-déclenchera les marqueurs
        // franchis à nouveau, comportement des cue stacks timecode) et on
        // oublie la position. Le premier état locked (prevMs = null) ne
        // déclenche RIEN (pas de déluge au re-lock) ; la position repart
        // ensuite proprement.
        prevMsRef.current = null;
        playedRef.current = new Set();
        return;
      }

      const prevMs = prevMsRef.current;
      const evalResult = evaluateMtcMarkers(prevMs, currMs, markers, playedRef.current);
      if (evalResult.reset) {
        playedRef.current = new Set();
      }
      prevMsRef.current = currMs;

      for (const marker of evalResult.toFire) {
        console.debug(
          `[mtc-trigger] marqueur "${marker.name}" @ ${currMs}ms → ${marker.target.type} ${marker.action}`
        );
        dispatchMarker(marker);
        const next = new Set(playedRef.current);
        next.add(marker.id);
        playedRef.current = next;
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      prevMsRef.current = null;
      playedRef.current = new Set();
      // Remettre l'état UI à unlocked (aucun flux MTC après démontage).
      usePerformStore.getState().setMtcState({
        locked: false,
        hours: 0,
        minutes: 0,
        seconds: 0,
        frames: 0,
        rate: '30',
        fps: 30,
        lastSource: 'qf',
      });
    };
  }, []);
}

function dispatchMarker(marker: MtcMarker): void {
  const { target, action } = marker;
  if (target.type === 'scene') {
    if (action === 'play') mtcPlayScene(target.sceneId);
    else if (action === 'stop') mtcStopScene(target.sceneId);
    else mtcToggleScene(target.sceneId);
    return;
  }
  // chaser
  if (action === 'play') mtcPlayChaser(target.chaserId);
  else if (action === 'stop') mtcStopChaser(target.chaserId);
  // 'toggle' n'a pas de sens pour un chaser (play/stop seulement) — ignoré.
}
