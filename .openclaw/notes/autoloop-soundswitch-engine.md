# Autoloop SoundSwitch 2.9 — moteur intégré (port TS)

> Livré le 2026-08-21. Port de la sémantique Autoloop SoundSwitch 2.9 dans le moteur
> TypeScript de Light Maestro, à partir du prototype Python
> `.cluster/soundswitch-python/delivery/autoloop/`.

## Ce que ça ajoute (par rapport à `auto-loops.ts` existant)

La feature autoLoop existante (`auto-loops.ts` + `engine/auto-loop-player.ts`) est un
générateur de **chases** (couleur / mouvement / dimmer-pulse) par palette, matérialisés
en chaser éphémère ou en `LoopRecipe`. Elle n'a **pas** :

- de matrice **4 banques × 32 = 128** autoloops ;
- de modes de répétition **Infinite / Track Duration** ;
- d'**override** (joue sa durée puis rend la main au script) ;
- de **quantisation barline** ;
- de générateur « Autoscript » (timeline de keyframes alignés sur les bars).

Le nouveau moteur comble ces manques. Les deux systèmes cohabitent : l'ancien reste le
cœur des chases de la banque visuelle ; le nouveau est la couche « banques + modes +
lecture quantifiée ».

## Fichiers (tous dans `src/engine/`)

| Fichier | Rôle | Porte depuis |
|---|---|---|
| `autoloop-types.ts` | Modèle de données + maths (`clampDmx`, `computePan/Tilt`, timeline) | `models.py` |
| `autoscript-generator.ts` | Générateur procédural (greedy LRU couleurs, échantillonnage pan/tilt) | `generator.py` |
| `autoloop-engine.ts` | Machine à états `idle/script/override_loop` + interpolation + quantisation | `playback.py` |
| `autoloop-banks.ts` | Matrice 4×32 + `infinite/track_duration` + lock exclusif | `banks.py` |
| `autoloop-index.ts` | Baril de ré-export **pur** (testable en node, aucun import React/Electron) | — |
| `autoloop-adapter.ts` | Glue vers `dmxBridge` (source `'auto-loop'`, LTP 75) | — |

Tests : `src/__tests__/autoloop-engine.test.ts` (21 tests, miroir de `demo.py`) et
`src/__tests__/autoloop-runtime.test.ts` (7 tests, mapping patch → AutoloopFixture).

## Intégration UI (branchée)

| Fichier | Rôle |
|---|---|
| `src/engine/autoloop-runtime.ts` | Pont pur : `toAutoloopFixtures` (patch → AutoloopFixture via `analyzeFixture`), `buildSoundswitchBanks` (4×32) |
| `src/engine/autoloop-adapter.ts` | `createAutoLoopOutput` → route les adresses vers les univers via `sendChannelsToHardwareAndStore` (+ miroir 3D) |
| `src/hooks/use-autoloop-engine.ts` | Hook React : construit banque + moteur, avance sur horloge rAF (bar/beat depuis le BPM) |
| `src/components/SoundSwitchAutoloop.tsx` | Contrôles : banques 1-4, prev/next, play/stop, override, mode de répétition — monté en tête d'`AutoLoopsPanel` |

Le panneau « Loops auto » affiche désormais un bloc « SoundSwitch 2.9 » au-dessus de
la bibliothèque existante (`auto-loops.ts`), sans toucher à cette dernière.

## Intégration runtime

Le moteur est piloté par l'hôte via `onBarBeat(bar, beat)` (pas de boucle bloquante).
La sortie DMX passe par l'interface injectée `DmxOutput.send(channels)`. L'adaptateur
fournit l'implémentation réelle :

```ts
import { AutoloopPlaybackEngine } from './engine/autoloop-engine';
import { createDmxBridgeOutput } from './engine/autoloop-adapter';

const engine = new AutoloopPlaybackEngine(createDmxBridgeOutput(0), bpm);
engine.load(loop);      // charge un AutoloopTimeline
engine.trigger();       // démarre au prochain barline
engine.overrideWith(o); // joue par-dessus puis reprend le script
```

La source arbitre `'auto-loop'` (LTP 75) est déjà enregistrée par `auto-loop-player.ts` ;
`registerAutoLoopSource()` la ré-enregistre de façon idempotente.

## Décisions notables

- **`FixtureCategory` = `'Wash_Primary' | 'Wash_Secondary' | 'Spot'`** (PascalCase,
  valeurs exactes de l'enum Python). Les ids générés sont de la forme
  `autoscript-Wash_Primary-8b-1`.
- **`RepeatMode` = `'infinite' | 'track_duration'`** (valeurs exactes de l'enum Python).
- **Arrondi `Math.round`** (≠ `round()` Python = arrondi bancaire). Différence nulle en
  pratique (ne touche que les `.5` exacts, inexistants en sortie trigo).
- **Modulo positif** géré partout (`((x % n) + n) % n`) car le `%` JS est signé.
- **Un seul univers par sortie** (comme `ArtNetOutput` du prototype). Le multi-univers
  demanderait de faire porter l'univers par les keyframes — non fait.

## Validation

- `npx vitest run` → 201/201 tests (14 fichiers), exit 0.
- `npx tsc --noEmit` → zéro erreur projet entier.

## À suivre (non fait)

- Support multi-univers **par keyframe** : aujourd'hui le moteur émet des adresses
  plates par fixture ; deux fixtures de même `startAddress` sur des univers différents
  partagent la même valeur (limite héritée du modèle Python).
