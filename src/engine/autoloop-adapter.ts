// ─── Autoloop SoundSwitch 2.9 — adaptateur vers la sortie DMX réelle ────────
//
// Contrairement au moteur pur (`autoloop-*.ts`), ce module importe `dmxBridge`
// (la sortie arbitrée de Light Maestro) : il est donc **hors** de la surface
// testée par vitest. Il fournit la glue minimale pour brancher un
// `AutoloopPlaybackEngine` sur le hardware :
//
//   const engine = new AutoloopPlaybackEngine(createDmxBridgeOutput(0), bpm);
//
// La source arbitre `'auto-loop'` (LTP 75) est déjà prévue par
// `auto-loop-player.ts` ; on la ré-enregistre ici de façon idempotente (les
// deux modules peuvent être importés dans n'importe quel ordre).

import { dmxBridge } from '../utils/dmx-bridge';
import { sendChannelsToHardwareAndStore, type UniverseInfo } from '../utils/dmx-helpers';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxOutput } from './autoloop-engine';

/**
 * Source arbitre dédiée aux Autoloops.
 *
 * Doit rester identique à `AUTO_LOOP_SOURCE_ID` de `auto-loop-player.ts`.
 * On ne l'importe pas depuis ce module pour éviter de tirer ses dépendances
 * React (le widget Performance) dans ce fichier d'adaptateur.
 */
export const AUTO_LOOP_SOURCE_ID = 'auto-loop';

let _registered = false;

/**
 * Enregistre (une seule fois) la source `'auto-loop'` en LTP 75.
 *
 * LTP 75 la place au-dessus de `default` (50) et des sources HTP (quickshow,
 * song-preset, show-manager…), mais sous le Virtual Console (`vc`, 80) : un
 * bouton VC manuel l'emporte sur la boucle auto.
 */
export function registerAutoLoopSource(): void {
  if (_registered) return;
  _registered = true;
  dmxBridge.registerSource(AUTO_LOOP_SOURCE_ID, 'ltp', 75);
}

/**
 * Construit un `DmxOutput` qui écrit via `dmxBridge.write` sur l'univers `universe`.
 *
 * Le protocole `DmxOutput.send(channels)` (adresse 1-based → valeur 0..255)
 * n'emporte pas d'univers ; comme dans le prototype Python (`ArtNetOutput`),
 * l'univers est fixé à la construction. Les Autoloops ciblant plusieurs univers
 * appelleront `createDmxBridgeOutput` une fois par univers.
 */
export function createDmxBridgeOutput(universe: number = 0): DmxOutput {
  registerAutoLoopSource();
  return {
    send(channels: Record<number, number>): void {
      dmxBridge.write(AUTO_LOOP_SOURCE_ID, universe, channels);
    },
  };
}

/**
 * Construit un `DmxOutput` qui route chaque adresse vers le bon univers via
 * `sendChannelsToHardwareAndStore` (dispatch par plages de patch) et miroite
 * dans le store 3D. C'est la sortie à utiliser côté app : elle gère
 * correctement le multi-univers, là où `createDmxBridgeOutput` fixe un seul
 * univers (cas du prototype / tests).
 */
export function createAutoLoopOutput(
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
): DmxOutput {
  registerAutoLoopSource();
  return {
    send(channels: Record<number, number>): void {
      sendChannelsToHardwareAndStore(channels, patchedFixtures, universes, AUTO_LOOP_SOURCE_ID).catch(() => {});
    },
  };
}
