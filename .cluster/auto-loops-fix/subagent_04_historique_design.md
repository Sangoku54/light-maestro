# Subagent 04 — Historique & principes de design pour un « widget loop » stable

Projet : `light-maestro` (Electron/React, contrôle DMX). Lecture seule.
Mission : reconstituer pourquoi les tentatives « auto loops » ont été annulées, et en déduire
les principes + une architecture recommandée pour un widget de loop jouable dans Performance.

État du code vérifié à la date du rapport :
- `src/engine/auto-loops.ts` **existe** (v1 survivant : `AutoLoop`, `AutoLoopStep`, `AutoLoopKind`,
  `generateAutoLoops`, `generateLoopLibrary`, `materializeAutoLoops`, `purgeAutoLoops`,
  `refreshAutoLoops`, `AUTO_LOOP_FOLDER`).
- `src/views/AutoLoopsPanel.tsx` **existe**, revenu à l'état v1 : `materializeAutoLoops([loop], store)`
  → `midiPlayChaser(chaserId)`, purge via `purgeAutoLoops`.
- `src/engine/theme-loop.ts` **supprimé** (confirmé par le rollback #2).
- `src/__tests__/auto-loops.test.ts` **existe** (seul test loop restant ; `theme-loop.test.ts` supprimé).

---

## (a) Causes d'échec / rollback — classées par gravité

### 🔴 Critique (casse la sortie DMX ou l'affichage, rend la feature inutilisable)

1. **Guerre de priorités LTP entre sources DMX non maîtrisée.**
   - `simple-desk` (priorité LTP **100**) n'était jamais relâchée et écrasait la source `vc`
     (LTP **80**) ; `fixture-test` (LTP **90**) n'était pas relâchée à l'unmount
     (`useFixtureTest.ts`). Résultat : RGB figés, sortie écrasée.
   - La source `vc` était **partagée** entre la boucle et la Virtual Console
     (`PerformanceView.tsx`), deux écrivains sur le même `sourceId` → conflit silencieux.

2. **Absence de miroir `appStore.dmx.channelData` (3D).**
   - Les boucles écrivaient uniquement via `dmxBridge.write('vc', …)`. La 3D
     (`Stage3D`) lisait `appStore.dmx.channelData` et ne voyait donc **rien** → divergence
     totale affichage / hardware. C'est l'une des causes racines nommées dans le rollback du 18/08.

3. **Blackout inconditionnel au `stop()`/montage.**
   - `AutoLoopsPanel.tsx:119-129` (v4) : `stop()` appelait `zeroAllUniverses()` même quand
     aucun intervalle ne tournait. L'effet `[patchKey, stop]` l'exécutait au premier montage
     de l'onglet et à chaque changement de patch → le rig s'éteignait ~2 s et écrasait la
     source HTP QuickShow (40). Problème « mineur » de la review adversarial, en réalité
     bloquant côté hardware (M1).

### 🟠 Haute (détruit la confiance produit → décision de rollback)

4. **Refontes sur-ingénierées empilées sans validation hardware de bout en bout.**
   - v2/v3 « Boucles d'ambiance » = 12 commits (`ambiance-classified loops`, `seed-driven
     variety`, `full autoscript timeline`, `cue-block colours`, …) jamais testés sur le rig.
     Bugs signalés (« cues autoscript non jouées, couleurs fausses ») → rollback #1.

5. **Duplication d'un moteur de lecture parallèle au moteur chaser.**
   - v4 `theme-loop.ts` + réécriture d'`AutoLoopsPanel` avec `setInterval` + `dmxBridge.write`
     par frame, réinventant un timing que le moteur chaser faisait déjà correctement. La v1
     (matérialisation → chaser) était simple et testée ; chaque refonte a réinventé la roue.

6. **Fatigue / ordre d'arrêt explicite de l'utilisateur.**
   - Après 2 refontes + 1 debug ratés, l'utilisateur : « reviens au rollback de 11h24 et
     arrête le dev auto-loops » (rollback #2, 16h53). Le coût de l'échec répété est la cause
     terminale : la feature entière a été retirée, pas seulement le bug.

### 🟡 Moyenne (bugs de perception / dette, pas bloquants isolément)

7. **Palettes monochromatiques non distinctes** (ΔE76 min 10–36, ΔHue 0–3° pour « Forest ») :
   le pipeline était correct mais les 4 thèmes cyclaient des couleurs quasi identiques →
   « la boucle joue toujours la même chose ». Bug de perception (S4 axe C), cause principale
   du debug « même couleur ».

8. **Dette / fuites non nettoyées** : `getTierColorIndex` mort (`dmx-cues.ts`), `simple-desk`
   sans release au démontage, import mort `computeDmxCues` dans `PerformanceView.tsx`, hex
   court `#abc` non géré dans les `hexToRgb` internes (`dmx-cues.ts`, `dmx-color.ts`).

---

## (b) Anti-patterns à éviter ABSOLUMENT

1. **Ne pas réinventer un moteur de loop parallèle** au moteur chaser existant (timing,
   fade, speed, release déjà testés). Toute refonte v2/v3/v4 l'a fait → échec.
2. **Ne jamais écrire une source DMX sans miroiter `channelData`** : toute écriture
   `dmxBridge.write` doit être accompagnée de `setUniverseData` (sinon désync 3D).
3. **Ne pas partager la source `vc`** entre un widget de loop et la Virtual Console :
   deux écrivains sur le même `sourceId` s'écrasent (priorité égale 80).
4. **`stop()` ne doit PAS être un blackout inconditionnel** : zéroïser seulement si une
   boucle jouait réellement ; scinder « arrêter la lecture » et « éteindre ».
5. **Ne pas empiler N commits de features sans test hardware** : livrer incrémental, valider
   visuellement chaque étape (règle « 2 livraisons non testées max » du workspace).
6. **Ne pas changer de modèle de données à chaque itération** (chaser ↔ RAF+setInterval) :
   choisir une représentation canonique et s'y tenir.
7. **Pas de feature creep** : ambiance-classified, seed-driven variety, full timeline… sont
   hors du besoin initial « boucle simple jouable depuis un widget ». Le scope drift a tué la v2/v3.
8. **Ne pas négliger la purge/release des sources LTP** au stop et à l'unmount (fuites 100/90/80).

---

## (c) Principes de design pour un widget loop stable

1. **Exclusivité de lecture** : un seul écrivain sur une **source DMX dédiée** (ex. `auto-loop`,
   LTP propre, distinct de `vc`). Mutex d'exclusivité (miroir de `registerAudioPlayback`) :
   un seul widget loop actif à la fois, tout démarrage stop proprement l'existant.
2. **Cycle de vie strict** : au start → register source + `api.addUniverse` + `api.start()` ;
   au stop/unmount → `release` de la source + `clearInterval`/`cancelAnimationFrame` +
   `vcZeroAllUniverses()` **uniquement si ça jouait**.
3. **Purge idempotente** : purger les entités matérialisées orphelines (scenes folder
   `auto-loops` + chasers) avant re-matérialisation ; un seul chaser actif par loop.
4. **Miroir 3D systématique** : chaque frame écrite via `dmxBridge.write` est aussi
   `setUniverseData` → la 3D et le hardware restent synchrones.
5. **Speed / hold cohérent** : pas de `setInterval` flottant. Horloge déterministe dérivée du
   BPM (ms/step = `60000/speedBpm`), avancement piloté par RAF sur `performance.now()` (ou
   réutiliser le timing du moteur chaser), gestion explicite `forward/backward/bounce` et
   du comportement de fin de cycle (boucle vs one-shot).
6. **Persistance** : réutiliser les entités déjà persistées (scenes+chasers dans `.lmproj`)
   plutôt que créer un nouveau type, sauf besoin avéré (voir §d).
7. **Palettes distinctes** : ΔE76 ≥ ~60 entre couleurs d'un même thème pour une perception
   nette du changement.
8. **Représentation canonique unique** : une loop = une séquence de **frames DMX concrètes**
   (`AutoLoopStep.channels: Record<adresse, valeur>`), pas une re-génération dépendante de l'audio.

---

## (d) Architecture recommandée — deux options

### Option A — Réutiliser `materializeAutoLoops` → chaser + `actionType: 'chaser'`

Widget Performance = bouton `actionType: 'chaser'` pointant sur le chaser matérialisé d'une loop.

- **Pour**
  - **Zéro nouveau type de store** : les loops sont déjà matérialisées en `SavedScene[]`
    (folder `auto-loops`) + `SavedChaser[]`, déjà persistés dans le `.lmproj`
    (`saveProject`/`__lm_open`). Aucun des 4 points d'extension n'est requis.
  - **Zéro nouveau moteur** : réutilise le moteur chaser existant (timing, speed BPM, fade,
    release) déjà couvert par les tests et déjà branché sur MIDI/VC. C'est exactement ce que
    fait `AutoLoopsPanel` v1 (`midiPlayChaser`).
  - **Chemin le plus court et le moins risqué** : c'est la seule approche qui a **survécu** à
    l'histoire (v1), contrairement à toutes les refontes parallèles.
- **Contre**
  - Le chaser matérialisé capture des **adresses DMX absolues** → fragile si le patch change :
    il faut **re-matérialiser** (idempotent) à chaque changement de patch, puis re-pointer le
    widget. À gérer explicitement.
  - **Pollution de la liste des chasers** : l'utilisateur voit des `auto-loops-xxx` parmi ses
    chasers ; nécessite un folder dédié + purge disciplinée.
  - Le timing (direction `bounce`, hold) est celui du chaser : vérifier que le moteur chaser
    couvre bien les besoins de la loop (sinon option B).

### Option B — Moteur de loop dédié sans audio + `actionType: 'autoLoop'`

Widget = `actionType: 'autoLoop'`, `config` portant la définition de loop (`AutoLoop`), exécuté
par un helper `_startAutoLoop` dédié (copie de `_startAudioAutoScript` **sans** `AudioContext`).

- **Pour**
  - **Isolation totale** : source DMX dédiée, pas de pollution de la liste de chasers, cycle
    de vie et mutex propres, contrôle fin speed/direction/hold.
  - **Indépendant du moteur chaser** : pas de dépendance au timing/fade du chaser.
- **Contre**
  - **Nouveau type de store** : les 4 points d'extension (`showStore` type+4 fonctions, 3 lignes
    `App.tsx`, `ButtonActionType`+`ConsoleWidgetConfig`, 5 points `PerformanceView.tsx`).
  - **Nouveau moteur RAF/intervalle = duplication** du timing déjà présent dans le chaser —
    c'est précisément le pattern qui a produit les bugs v4 (blackout, source partagée, désync 3D)
    si les principes §c ne sont pas rigoureusement respectés.
  - Risque plus élevé de re-rollback (coût historique déjà payé deux fois).

---

## Synthèse & recommandation

L'histoire est sans ambiguïté : la **v1 « matérialisation en chaser »** est la seule approche qui a
survécu, parce qu'elle réutilise un moteur chaser testé et une persistance déjà en place ; les trois
refontes suivantes (v2/v3 ambiance, v4 `theme-loop`) ont toutes échoué sur les **mêmes** erreurs —
source DMX partagée/non relâchée, absence de miroir 3D, `stop()`=blackout inconditionnel, moteur
parallèle dupliqué, scope drift — jusqu'à l'ordre d'arrêt de l'utilisateur.

Recommandation : **Option A** — widget Performance `actionType: 'chaser'` pointant sur le chaser
matérialisé par `materializeAutoLoops`, avec re-matérialisation idempotente + purge à chaque
changement de patch et une source DMX dédiée (jamais `vc`), en réservant l'Option B (`actionType:
'autoLoop'` + moteur dédié) au seul cas où le timing du chaser s'avérerait insuffisant.

**En une phrase :** réutiliser la matérialisation en chaser existante (`materializeAutoLoops` +
`actionType: 'chaser'`) plutôt que de construire un moteur de loop parallèle, et concentrer tout
l'effort sur les trois invariants qui ont tué les tentatives précédentes : source DMX dédiée avec
miroir 3D, relâche/blackout uniquement si actif, et purge idempotente au changement de patch.
