# Livraison — Fix « même show light sur toutes les boucles »

**Date** : 2026-08-18
**Module** : Boucles d'ambiance (AutoLoopsPanel) — Light Maestro
**Statut** : corrigé, confirmation finale côté matériel en attente

## Problème
L'utilisateur signalait que le même show lumineux était joué sur toutes les boucles d'ambiance, quelle que soit la boucle sélectionnée.

## Cause racine
`computeDmxCues` (`src/hooks/dmx-cues.ts`) calculait
`universeIndex = universeOrder.indexOf(pf.universeId)`. Quand l'ID d'univers ne
matchait pas, le résultat était **−1**, et `dmxBridge.write('vc', -1, …)`
devenait un **no-op silencieux** : aucun DMX n'était émis, le hardware restait
figé dans son état précédent — donc le même show sur toutes les boucles.

`dmx-playback.ts` (QuickShow / Performance) avait déjà le fallback `−1 → 0`,
mais pas `dmx-cues.ts`, d'où le contraste « QuickShow/Performance OK, Boucles
d'ambiance figées ».

## Correctifs (3 commits)
1. `8932ed5` — fallback `if (fa.universeIndex < 0) fa.universeIndex = 0` dans
   `computeDmxCues` (aligné sur `dmx-playback.ts`) + diagnostic runtime ambre.
2. `913b41b` — `playLoop` async + `await loadFixtureDefinitions` : élimine la
   race (clic « Jouer » avant la fin du chargement → 0 cue).
3. `e4b5362` — diagnostic enrichi : `nCues`, `t0`/`tLast`, indicateurs de
   mouvement `move0→mid` / `mid→last`.

## Vérification (3 réviseurs indépendants)
| Réviseur | Verdict |
|----------|---------|
| Chemin d'écriture DMX | **OK** — `write()` et `writeTransient()` exécutent le même flush (`getBuffer → pushBufferToConsumers → flushToHardware`). STOP éteint le hardware ⇒ `write('vc',…)` l'atteint aussi. Aucune perte possible. |
| Progression temporelle | **OK** — 64 cues/boucle, temps strictement croissants (intervalle ≥ 250 ms), aucune collision de dédup. Le show progresse. |
| Bug corrigé ? | **probablement corrigé** — cause racine = univers −1 → no-op. Aucun chemin ne force deux boucles (ambiances différentes) à produire des `cue0` identiques. |

Tests : **180/180** (12 fichiers) ; `tsc --noEmit` propre.

## Preuve runtime (bandeau ambre)
`uni0=0` (univers correct), `cue0` varié (magenta R255/G0/B100, jaune R255/G255/B0 ;
pan/tilt 128/140/109/166/96/138 ; dimmer 255/122/160), fixtures analysées
correctement (`c5/c2/c4 + pan + tilt`).

## Confirmation finale (à faire côté matériel)
Jouer une **2ᵉ boucle d'ambiance différente** (ex. `wash · Sombre`) et vérifier
que le bandeau ambre affiche un `cue0` différent (bleus/nuit au lieu de
magenta/jaune), avec `uni0=0` et `nCues>0`.

⚠️ Ne pas comparer des variantes de **tempo** (Lent/Moyen/Rapide d'un même couple
theme+ambiance) : elles ont le même `cue0` par design. Comparer des **ambiances**
différentes.

## Fragilités secondaires (hors scope, non bloquantes)
1. `setChannels` (engine) n'écrit que les canaux présents, sans zéro-fill.
2. Index d'univers ordre-dépendant des deux côtés (renderer `0` ↔ engine
   `universeOrder[0]`) — à surveiller si l'ordre des univers change un jour.
3. `outputArbiter.write` accepte `ch = 0` ; `engine.setChannels` rejette `ch < 1`.
   Sans impact pratique (adresses 1-based).
