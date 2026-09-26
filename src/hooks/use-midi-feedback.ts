/**
 * Feedback MIDI — LED des contrôleurs (Akai MIDIMIX, padboards…)
 *
 * Les mappages vivent côté main (`userData/midi-mapping.json` → `MidiManager`)
 * et le port sortie est déjà ouvert par `connect()` — il ne manquait que
 * l'ÉTAT. Ce hook calcule l'état des cibles pilotables et le pousse vers
 * `window.lightMaestro.midi.feedback(entries)` uniquement quand ça change
 * (signature JSON = anti-spam, 1 IPC par changement réel, pas 4/s).
 *
 * Le main projette les entries sur les mappings `feedback !== false` et
 * envoie note-on / CC à 127 (LED ON) ou 0 (LED OFF) sur le port sortie.
 *
 * Cibles couvertes :
 *   - `widget:<id>` boutons de la Console Virtuelle (runtime P0 — un run
 *                   survit au changement de page, la LED suit l'état réel) ;
 *   - `scene:<id>`  scènes actives côté moteur MIDI/remote + scènes jouées
 *                   par une tuile (run `targetId`) ;
 *   - `chaser:<id>` idem pour les chasers ;
 *   - `blackout:`   état du noir total (appStore).
 *
 * Monté une fois dans `App.tsx`, à côté de `useMidiTriggers`.
 */
import { useEffect } from 'react';
import { getActiveChasers, getActiveSceneIds } from '../engine/midi-actions';
import { vcActiveRuns } from '../engine/virtual-console-runtime';
import { useAppStore } from '../stores/appStore';
import { usePerformStore } from '../stores/performStore';
import { useShowStore } from '../stores/showStore';

export interface MidiFeedbackEntry {
  type: 'widget' | 'scene' | 'chaser' | 'blackout';
  id?: string;
  on: boolean;
}

/** Intervalle de recalcul de l'état (l'envoi n'a lieu qu'en cas de changement). */
const POLL_MS = 250;

interface MidiFeedbackApi {
  feedback?: (entries: MidiFeedbackEntry[]) => unknown;
}

/**
 * État courant des cibles pilotables. Pur (aucun effet de bord) → testable
 * sous vitest sans DOM, cf. `src/__tests__/midi-feedback.test.ts`.
 */
export function collectMidiFeedbackEntries(): MidiFeedbackEntry[] {
  const entries: MidiFeedbackEntry[] = [];

  // Tuiles bouton de la Console Virtuelle (runtime indépendant de la page)
  const activeWidgets = new Set<string>();
  const activeScenesFromTiles = new Set<string>();
  const activeChasersFromTiles = new Set<string>();
  for (const run of vcActiveRuns()) {
    activeWidgets.add(run.widgetId);
    if (run.kind === 'scene' && run.targetId) activeScenesFromTiles.add(run.targetId);
    if (run.kind === 'chaser' && run.targetId) activeChasersFromTiles.add(run.targetId);
  }
  for (const w of usePerformStore.getState().vcWidgets) {
    if (w.type === 'button') entries.push({ type: 'widget', id: w.id, on: activeWidgets.has(w.id) });
  }

  // Scènes / chasers actifs : moteur MIDI-remote ∪ runs de la console
  const activeScenes = new Set<string>([...getActiveSceneIds(), ...activeScenesFromTiles]);
  for (const s of useShowStore.getState().scenes) {
    entries.push({ type: 'scene', id: s.id, on: activeScenes.has(s.id) });
  }
  const activeChasers = new Set<string>([
    ...getActiveChasers().map((c) => c.id),
    ...activeChasersFromTiles,
  ]);
  for (const c of useShowStore.getState().chasers) {
    entries.push({ type: 'chaser', id: c.id, on: activeChasers.has(c.id) });
  }

  entries.push({ type: 'blackout', on: useAppStore.getState().dmx.blackout === true });
  return entries;
}

/** Abonnement au store app pour invalider l'anti-spam quand le blackout change. */
export function useMidiFeedback(): void {
  useEffect(() => {
    const api = (window as unknown as { lightMaestro?: { midi?: MidiFeedbackApi } }).lightMaestro?.midi;
    if (typeof api?.feedback !== 'function') return; // preload absent (dev browser)

    let previous = '';
    const push = (): void => {
      try {
        const entries = collectMidiFeedbackEntries();
        const signature = JSON.stringify(entries);
        if (signature === previous) return;
        previous = signature;
        void api.feedback!(entries);
      } catch {
        /* feedback « best effort » : jamais bloquant pour la console */
      }
    };

    // État initial : efface les LEDs laissées par la session précédente, puis
    // suit les changements. (dmx.blackout vit dans appStore et n'est pas
    // réactif ici — le polling 250 ms le couvre aussi.)
    push();
    const id = window.setInterval(push, POLL_MS);
    return () => window.clearInterval(id);
  }, []);
}
