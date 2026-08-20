/**
 * Auto Loop Player — moteur frame-locked dédié aux boucles auto lancées
 * depuis un widget Performance.
 *
 * Contrairement au panneau QuickShow (qui matérialise la boucle en chaser
 * éphémère), le widget stocke une `LoopRecipe` portable et ce moteur la
 * re-matérialise contre le patch courant au moment du play, puis fait défiler
 * les frames DMX en boucle via requestAnimationFrame sur une source arbitre
 * dédiée (`auto-loop`, LTP 75) — au-dessus de 'default' et des HTP, sous le
 * Virtual Console ('vc', 80) : un bouton VC manuel l'emporte sur la boucle.
 *
 * L'écriture passe par `sendChannelsToHardwareAndStore`, donc la boucle est
 * reflétée dans le store (miroir 3D) en plus du hardware.
 */

import type { PatchedFixture } from '../stores/showStore';
import { useShowStore } from '../stores/showStore';
import { loadFixtureDefinitions } from '../hooks/dmx-cues';
import { sendChannelsToHardwareAndStore } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import { generateLoopFromRecipe, type AutoLoop, type LoopRecipe } from './auto-loops';

/** Source arbitre dédiée aux boucles auto lancées depuis un widget. */
export const AUTO_LOOP_SOURCE_ID = 'auto-loop';

let _registered = false;
function ensureSource(): void {
  if (_registered) return;
  _registered = true;
  dmxBridge.registerSource(AUTO_LOOP_SOURCE_ID, 'ltp', 75);
}

interface ActiveLoop {
  raf: number;
  stepIndex: number;
  dir: 1 | -1;
  loop: AutoLoop;
  /** Union des canaux de tous les steps — sert au flush de zéros au stop. */
  channels: Record<number, number>;
}

const activeLoops = new Map<string, ActiveLoop>();

function nextIndex(loop: AutoLoop, h: ActiveLoop): number {
  const n = loop.steps.length;
  if (n === 0) return 0;
  const dir = loop.direction === 'backward' ? -1 : loop.direction === 'bounce' ? h.dir : 1;
  let idx = (h.stepIndex + dir) % n;
  if (idx < 0) idx += n;
  if (loop.direction === 'bounce') {
    if (idx === 0) h.dir = 1;
    else if (idx === n - 1) h.dir = -1;
  }
  return idx;
}

/**
 * Démarre la boucle `recipe` sous la clé `key` (typiquement l'id du widget).
 * Re-matérialise la recette sur le patch courant puis fait défiler les frames.
 */
export async function startAutoLoop(key: string, recipe: LoopRecipe): Promise<void> {
  ensureSource();
  stopAutoLoop(key);
  const store = useShowStore.getState();
  const patchedFixtures: PatchedFixture[] = store.patchedFixtures;
  if (!patchedFixtures || patchedFixtures.length === 0) return;
  let defs;
  try {
    defs = await loadFixtureDefinitions([...new Set(patchedFixtures.map((f) => f.fixtureDefId))]);
  } catch {
    return;
  }
  const loop = generateLoopFromRecipe(recipe, patchedFixtures, defs);
  if (!loop || loop.steps.length === 0) return;

  const channels: Record<number, number> = {};
  for (const step of loop.steps) Object.assign(channels, step.channels);

  const h: ActiveLoop = { raf: 0, stepIndex: 0, dir: 1, loop, channels };
  activeLoops.set(key, h);

  const universes = store.universes;
  const apply = (idx: number) => {
    sendChannelsToHardwareAndStore(loop.steps[idx].channels, patchedFixtures, universes, AUTO_LOOP_SOURCE_ID).catch(() => {});
  };
  apply(0);

  let last = performance.now();
  let acc = 0;
  const tick = (now: number) => {
    if (activeLoops.get(key) !== h) return;
    const dt = now - last;
    last = now;
    acc += dt;
    const ms = 60000 / Math.max(1, loop.speedBpm);
    while (acc >= ms) {
      acc -= ms;
      h.stepIndex = nextIndex(loop, h);
      apply(h.stepIndex);
    }
    h.raf = requestAnimationFrame(tick);
  };
  h.raf = requestAnimationFrame(tick);
}

/** Arrête la boucle `key` et relâche la source (flush de zéros transitoire). */
export function stopAutoLoop(key: string): void {
  const h = activeLoops.get(key);
  if (!h) return;
  cancelAnimationFrame(h.raf);
  activeLoops.delete(key);
  const store = useShowStore.getState();
  const zeros: Record<number, number> = {};
  for (const addrStr of Object.keys(h.channels)) zeros[Number(addrStr)] = 0;
  sendChannelsToHardwareAndStore(zeros, store.patchedFixtures, store.universes, AUTO_LOOP_SOURCE_ID, 2000).catch(() => {});
}

export function isAutoLoopActive(key: string): boolean {
  return activeLoops.has(key);
}

export function stopAllAutoLoops(): void {
  for (const key of [...activeLoops.keys()]) stopAutoLoop(key);
}
