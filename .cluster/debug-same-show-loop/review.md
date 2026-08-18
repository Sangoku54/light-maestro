# Revue — « même show light sur toutes les boucles d'ambiance »

## Contexte
L'utilisateur joue 3 boucles d'ambiance différentes (`wash/energetic 106`, `wash/dark 70`, `wash/uplifting 101`) et voit **toujours le même show**. Le diagnostic runtime prouve pourtant que le **calcul DMX est correct et varié** (`cue0` magenta / bleu nuit / orange, `nCues=64`, `uni0=0`, `move0→mid=DIFF mid→last=DIFF`).

→ Le bug n'est **pas** dans le calcul. Il est en aval.

## Les 6 verdicts (cross-check)

| # | Réviseur | Verdict |
|---|----------|---------|
| 1 | Chemin écriture DMX | **OK** — `write()`/`writeTransient()` partagent le même flush (`getBuffer → pushBufferToConsumers → flushToHardware`). Aucune perte silencieuse. |
| 2 | Progression temporelle | **OK** — 64 cues/boucle, intervalle ≥ 250 ms, aucune collision de dédup. |
| 3 | Bug corrigé ? (après fix univers −1) | **Partiel** — le fix `universeIndex<0→0` était nécessaire mais insuffisant. |
| 4 | Cartographie univers renderer↔engine | **OK (exclu)** — `universeOrder[0] = "universe-1"`, `sabIndex=0`, tous les chemins résolvent `index → id → entry`. |
| 5 | Cycle de vie des sources | **⚠️ BUG RÉEL** — `simple-desk` (LTP 100) n'est **jamais relâchée**. `handleModeChange` ne relâche que `design-test`/`design-efx`/`fixture-onoff`. Aucun `release('simple-desk')` nulle part. |
| 6 | Chemin visualisation 3D | **⚠️ BUG RÉEL (cause principale)** — Stage3D lit `useAppStore.dmx.channelData`, mais les boucles n'écrivent que `dmxBridge.write('vc',…)` sans miroiter le store. |

## Cause racine (double)

1. **Visualisation 3D figée (cause principale du « même show » à l'écran).**
   - `Stage3D.tsx:1485-1498` lit `useAppStore.getState().dmx.channelData`.
   - Le moteur principal `dmx-playback.ts:1103-1107` fait un **double-write** : `setUniverseData(...)` + `dmxBridge.push(...)`. C'est pour ça que QuickShow/show-manager animent la 3D.
   - Les boucles d'ambiance (`AutoLoopsPanel.tsx`) n'écrivent **que** `dmxBridge.write('vc',…)` → la 3D ne reçoit jamais les valeurs → image périmée identique pour toutes les boucles.
   - `dmxBridge.getChannels()`/`onPush()` sont des API mortes (aucun appelant dans `src/`).

2. **Écrasement LTP par le Simple Desk (cause du « même show » sur le matériel).**
   - `simple-desk` LTP 100 > `vc` LTP 80 : si un fader du Simple Desk est resté monté, il épingle les canaux tenus et écrase la boucle.
   - `fixture-test` (LTP 90) : transitoire (~8,8 s), écrasement secondaire.
   - Scénario : Perform → Simple Desk → monter un fader → basculer sur « Boucles d'ambiance » → Jouer → `vc` écrasé par `simple-desk`.

## Correctif appliqué (AutoLoopsPanel.tsx)

1. **Miroir 3D** : `fire()` fait désormais `setUniverseData(cue.universe, cue.channelValues)` en plus de `dmxBridge.write('vc',…)` — aligné sur `dmx-playback`.
2. **Zéro miroir** : `zeroAllUniverses()` miroite aussi les zéros vers le store 3D (écran noir à l'arrêt).
3. **Reprise LTP** : `playLoop()` relâche `simple-desk` et `fixture-test` avant de démarrer la boucle.

## Vérification
- `tsc --noEmit` : exit 0 (propre).
- `vitest run` : 180/180 (12 fichiers). Exit 1 = artefact de warnings connu.

## Fragilités secondaires (non bloquantes, hors scope)
- `handleModeChange` (`App.tsx:385-395`) ne relâche pas `simple-desk`/`fixture-test` à la bascule d'onglet (le release est fait dans `playLoop`, plus ciblé).
- Pas de zéro-fill dans `engine.setChannels` (vs `outputArbiter.write` qui accepte `ch=0`).
- Index d'univers ordre-dépendant côté engine (résolu par `syncUniverses` mais fragile si multi-universe booté).
