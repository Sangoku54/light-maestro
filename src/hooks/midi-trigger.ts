/**
 * MIDI Triggers Hook (M3 du plan MIDI) — consomme `midi:trigger` (émis par le
 * main, electron/main.ts L342-366) et déclenche les actions renderer réelles.
 *
 * Monté UNE SEULE FOIS dans app.tsx (global, pas par vue). Se désabonne au
 * unmount quand le preload expose l'unsubscribe (contrat de l'agent
 * « MIDI cœur main » : onTrigger(cb) → unsubscribe) ; tant qu'il ne le fait
 * pas, le listener vit pour la durée de l'app — acceptable car monté au
 * niveau racine, l'App ne se démonte jamais en pratique.
 *
 * Dispatch :
 *  - dmx-channel / blackout / grandMaster → DÉJÀ traités dans le main (zéro
 *    IPC, electron/main.ts L326-340) → volontairement ignorés ici.
 *  - scene / chaser / cueList / autoscript / widget → src/engine/midi-actions.ts
 *
 * Garde anti-double-déclenchement : un rawValue === 0 (note-off velocity 0,
 * CC relâché) n'est PAS un « press » → ignoré pour les actions ponctuelles
 * (play/stop/toggle/next/previous/go/back) tant que le fix note-off (M1) du
 * main n'est pas en place. Un Program Change (rawValue undefined) reste
 * accepté. L'intensité autoscript et les widgets passent toujours (sémantique
 * de valeur, pas d'impulsion).
 */

import { useEffect } from 'react';
import type { MidiTriggerEvent } from '../engine/midi-actions';
import { useClockStore, clockFromMidiClock } from '../stores/clockStore';
import {
  midiAutoscript,
  midiChaserNext,
  midiChaserPrevious,
  midiCueListBack,
  midiCueListGo,
  midiCueListStop,
  midiPlayChaser,
  midiPlayScene,
  midiSetClock,
  midiStopChaser,
  midiStopScene,
  midiToggleScene,
  midiWidgetAction,
} from '../engine/midi-actions';

export function useMidiTriggers(): void {
  useEffect(() => {
    const midi = (window as any)?.lightMaestro?.midi;
    if (!midi?.onTrigger) {
      console.debug('[midi-trigger] API midi indisponible (preload absent) — hooks non branchés');
      return;
    }

    const handle = (raw: unknown): void => {
      if (!raw || typeof raw !== 'object') return;
      const t = raw as MidiTriggerEvent;
      // Le main envoie `{ mapping, value, rawValue, timestamp }` — la cible
      // vit dans `mapping.target` (P0 revue : ne jamais lire `t.target`).
      const { mapping, value, rawValue } = t;
      const target = mapping?.target;
      if (!target) return;

      // PGM 0 (program change #0) est un trigger VALIDE : seul le rawValue 0
      // des notes/CC (note-off / relâchement) est filtré.
      const isProgram = mapping.midiType === 'program';
      const release = !isProgram && rawValue === 0; // note-off / CC relâché
      console.debug(
        `[midi-trigger] ${target.type} ${JSON.stringify(target)} value=${value} raw=${rawValue}${release ? ' (release ignoré)' : ''}`
      );

      switch (target.type) {
        // ── Traités dans le main (zéro IPC) — le hook ne re-traite PAS ──
        case 'dmx-channel':
        case 'blackout':
        case 'grandMaster':
          return;

        case 'scene': {
          if (release) return;
          if (target.action === 'play') midiPlayScene(target.sceneId);
          else if (target.action === 'stop') midiStopScene(target.sceneId);
          else midiToggleScene(target.sceneId);
          return;
        }

        case 'chaser': {
          if (release) return;
          if (target.action === 'play') midiPlayChaser(target.chaserId);
          else if (target.action === 'stop') midiStopChaser(target.chaserId);
          else if (target.action === 'next') midiChaserNext(target.chaserId);
          else midiChaserPrevious(target.chaserId);
          return;
        }

        case 'cueList': {
          if (release) return;
          if (target.action === 'go') midiCueListGo(target.cueListId);
          else if (target.action === 'back') midiCueListBack(target.cueListId);
          else midiCueListStop(target.cueListId);
          return;
        }

        case 'autoscript': {
          if (release && target.action !== 'intensity') return;
          midiAutoscript(target.action, value);
          return;
        }

        case 'widget': {
          midiWidgetAction(target.widgetId, target.property, value, rawValue);
          return;
        }
      }
    };

    // Contrat : onTrigger(cb) → unsubscribe. Le preload actuel retourne encore
    // void (agent « MIDI cœur main » en cours) → cast défensif + fallback.
    const cleanups: Array<() => void> = [];
    const ret = midi.onTrigger(handle) as unknown;
    const unsubscribe = typeof ret === 'function' ? (ret as () => void) : undefined;
    if (!unsubscribe) {
      console.debug(
        "[midi-trigger] onTrigger ne retourne pas d'unsubscribe (preload pas encore à jour) — listener global, vit pour l'app"
      );
    } else {
      cleanups.push(unsubscribe);
    }

    // M5 — MIDI clock → tempo des chasers actifs (midi-actions scale les
    // durées de steps : 120 BPM = nominal, 240 BPM = ×0,5). Le main émet
    // midi:clock { bpm, running } (manager : ignoreTypes(true,false,true) + parse 0xF8).
    if (midi.onClock) {
      const clockHandler = (clock: { bpm: number; running: boolean }): void => {
        midiSetClock(clock.bpm, clock.running);
        // Master clock : le BPM reçu (Ableton/Triton/…) devient la source
        // pendant le transport. À l'arrêt (running=false) on rende la main :
        // la priorité Link > MIDI > Tap > Audio > Manual est rétablie.
        clockFromMidiClock(clock.bpm, clock.running);
        if (!clock.running && useClockStore.getState().source === 'midi') {
          // Retour explicite à 'manual' : tant que source === 'midi', le BPM
          // clock continuerait d'écraser l'analysé (QuickShowView :2232).
          useClockStore.setState({ source: 'manual' });
        }
      };
      const clockRet = midi.onClock(clockHandler) as unknown;
      const unsubscribeClock = typeof clockRet === 'function' ? (clockRet as () => void) : undefined;
      if (unsubscribeClock) cleanups.push(unsubscribeClock);
    }

    return () => {
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* best effort */
        }
      }
    };
  }, []);
}
