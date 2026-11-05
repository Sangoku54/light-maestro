# Audit — Lecture des « Loops auto » via `midiPlayChaser`

**Sujet** : pourquoi l'onglet « Loops auto » (`AutoLoopsPanel`) ne produit pas une lecture fiable et stable sur les fixtures.
**Périmètre** : lecture seule, aucun fichier source modifié.
**Fichiers clés** : `src/views/AutoLoopsPanel.tsx`, `src/engine/auto-loops.ts`, `src/engine/midi-actions.ts`, `src/hooks/midi-trigger.ts`, `src/hooks/dmx-playback.ts`, `src/utils/dmx-bridge.ts`, `src/utils/dmx-helpers.ts`, `src/engine/output-arbiter.ts`, `src/views/QuickShowView.tsx`, `electron/dmx/engine.ts`.

---

## 1. Flux de bout en bout (tracé)

```
Clic carte (AutoLoopsPanel.handleToggle, AutoLoopsPanel.tsx:98)
  ├─ stopAll()                 → midiStopChaser sur chaque chaser lancé (midi-actions.ts:422)
  ├─ purgeStore()              → purgeAutoLoops() : supprime scènes+chasers "auto-loops" (auto-loops.ts:498)
  ├─ materializeAutoLoops([loop], useShowStore.getState())  (auto-loops.ts:465)
  │     → 1 scène par step  (channels = step.channels UNIQUEMENT, fadeIn/fadeOut=0, duration=holdMs)
  │     → 1 chaser           (steps → {sceneId, fadeIn:0, hold:holdMs, fadeOut:0}, speed, direction)
  └─ midiPlayChaser(chaserId)  (midi-actions.ts:404)
        └─ runChaserStep(chaserId, 0, 'midi-chaser')        (midi-actions.ts:323)
              ├─ lit scene du step → toChannelMap(scene.channels)
              ├─ applyLevel(1) → sendChannelsToHardwareAndStore(scaled, fixtures, universes, 'midi-chaser')
              │      (midi-actions.ts:364 → dmx-helpers.ts:170 → sendChannelsToHardware → dmxBridge.write)
              └─ onHold() → setTimeout(hold) → next() → runChaserStep(step suivant)
```

- `dmxBridge.write('midi-chaser', uniNum, vals)` → `outputArbiter.write` (persistant, **remplace** la contribution de la source, `output-arbiter.ts:105`) → `getBuffer` → `flushToHardware` → `api.setChannels(universe, buffer)` (`dmx-bridge.ts:57` → `electron/dmx/engine.ts:848`).
- Le hardware est piloté par un worker à 30 FPS qui **relit en continu le SharedArrayBuffer** (`engine.ts` FRAME_RATE=30) : les valeurs écrites persistent jusqu'à la prochaine écriture. Il n'y a **pas** de famine de trames côté matériel.

---

## 2. Réponses aux 4 questions de la mission

### 2.1 `midi-actions.ts` — que fait `midiPlayChaser`/`midiStopChaser` ?
- Ce ne sont **pas** des hooks. Ce sont des fonctions libres qui pilotent un **moteur chaser ad-hoc** (map module-level `activeChasers`) fait de `setTimeout` + `requestAnimationFrame` (`runChaserStep`, `midi-actions.ts:323-403`).
- Chaque step écrit **une seule fois** ses canaux via `sendChannelsToHardwareAndStore(..., sourceId)` (source `'midi-chaser'`, LTP 75), puis attend `hold` ms avant le step suivant.
- `midiStopChaser` (`midi-actions.ts:422`) annule le timer/RAF puis `flushZeros` (`midi-actions.ts:128`) : écriture **transitoire** de zéros (`writeTransient`, release après 2000 ms, `dmx-helpers.ts:82`).
- Sources arbiter dédiées enregistrées au chargement du module (`midi-actions.ts:88-101`) : `'midi'`/`'midi-chaser'` LTP 75, `'remote'`/`'remote-chaser'` 70, `'osc'` 71, `'mtc'` 72.

### 2.2 `src/hooks/midi-trigger.ts` — est-ce le chemin de lecture des loops ?
- **Non.** `useMidiTriggers` (monté dans `App.tsx:149`) ne consomme QUE les événements matériels `midi:trigger` (notes/CC/PGM). Il dispatche vers `midiPlayChaser` **uniquement** si un mapping MIDI physique cible un chaser (`midi-trigger.ts:83-87`).
- `AutoLoopsPanel` appelle `midiPlayChaser(chaserId)` **directement** (`AutoLoopsPanel.tsx:111`), sans passer par le hook. Donc le hook est **hors circuit** pour les loops : sa présence ou son absence ne change rien à la lecture des loops.
- ⚠️ Conséquence : la lecture des loops repose **entièrement** sur le moteur ad-hoc `midi-actions.ts`, jamais sur le moteur de lecture du renderer.

### 2.3 `dmx-bridge.ts` / `output-arbiter.ts` — sources, priorités, conflits
- Sources canoniques (`output-arbiter.ts:34-46`) : LTP contrôle (`simple-desk` 100, `fixture-test` 90, **`vc` 80**, `design-*` 70/60, `default` 50) ; HTP contenu (`song-preset` 45, **`quickshow` 40**, `show-manager` 35, `rgb-matrix` 30).
- Ajoutées par `midi-actions.ts` : `'midi-chaser'` **LTP 75** (juste sous `vc` 80, au-dessus de tous les HTP).
- Arbitrage (`getBuffer`, `output-arbiter.ts:131-176`) : les LTP prennent leurs canaux par priorité décroissante, puis les HTP remplissent le reste par max. **Sur les canaux écrits par le loop, `midi-chaser` (75) gagne bien face à `quickshow` (40) et `song-preset` (45).**
- **Conflit réel** : l'autoscript (`useDmxPlayback`, `dmx-playback.ts:349`, appelé `QuickShowView.tsx:2299`) écrit **tout l'univers chaque frame** sur `'quickshow'` (HTP 40, `dmx-playback.ts:378` `arbiterSource ?? 'quickshow'`) dès que l'audio joue. `AutoScriptPanel` reste **monté en permanence** même quand on est sur l'onglet « loops » (`QuickShowView.tsx:1188-1199`, `display:none` seulement). Deux moteurs non synchronisés écrivent donc les mêmes fixtures en parallèle.
- `PerformanceView` écrit en `'vc'` (LTP 80) pour ses scènes/chasers (`PerformanceView.tsx` ~1800-1950) : **un chaser VC l'emporterait sur un loop `midi-chaser` (75)**, mais Performance n'est monté que dans sa vue (pas simultanément avec QuickShow).

### 2.4 État « chaser en cours de lecture » — où vit-il ?
- **Moteur ad-hoc** : `activeChasers: Map<string, ChaserHandle>` en mémoire de module (`midi-actions.ts:290`), avancé par `setTimeout(hold)` + RAF. Aucun état React, aucun lien avec l'horloge audio, aucun `currentTime`.
- **Moteur de référence** (non utilisé par les loops) : `computeChaserTrackOverrides` (`dmx-playback.ts:199-280`) résout le step d'un chaser **déterministiquement depuis `currentTime`** (pas de timer, pas de drift, pas d'état), et fait un **takeover complet** des fixtures cibles dans le même RAF loop que l'autoscript (suppression des canaux autoscript de ces fixtures puis écriture de l'état de scène du chaser).

---

## 3. Problèmes classés

### [SÉVÈRE] S1 — Deux moteurs concurrents sur les mêmes fixtures, sans prise de contrôle complète
- Le loop (`midi-chaser` LTP 75, écriture **partielle** une fois par step, `midi-actions.ts:323-403`) coexiste avec l'autoscript (`quickshow` HTP 40, écriture **pleine** chaque frame, `dmx-playback.ts:525+` / `QuickShowView.tsx:2299`) qui reste actif sur l'onglet loops car `AutoScriptPanel` est toujours monté (`QuickShowView.tsx:1188-1199`).
- Résultat : un loop **ne prend pas la main sur toute la fixture**. Sur les canaux non couverts par le loop (ex. pan/tilt pendant un color-chase, couleur pendant un movement), l'autoscript continue d'animer. Le rendu n'est ni « le loop », ni « l'autoscript », mais un mélange instable qui dépend de l'état de lecture audio.
- Le mécanisme correct existe déjà : `computeChaserTrackOverrides` fait un takeover **complet** dans le **même** frame loop (`dmx-playback.ts:199`).

### [SÉVÈRE] S2 — Écriture partielle → état SAB résiduel / fixtures figées
- `materializeAutoLoops` crée des scènes ne contenant **que** `step.channels` (RGB xor pan/tilt xor intensity/shutter), jamais un état complet (`auto-loops.ts:465-497`).
- `outputArbiter.getBuffer` ne retourne que les canaux des sources actives (`output-arbiter.ts:131`), et `api.setChannels` n'écrit que les canaux présents (`engine.ts:848-858`).
- Quand l'autoscript est à l'arrêt (source `'quickshow'` inactive), le buffer ne contient que les ~3-6 canaux du loop : le reste de la fixture **conserve les valeurs SAB précédentes** (couleur/pan/tilt figés), que le worker renvoie indéfiniment à 30 FPS. → « le loop ne remplace pas l'état, il se superpose à un résidu ».

### [SÉVÈRE] S3 — Mauvaise mécanique de lecture (timer/RAF ad-hoc vs moteur frame-locked)
- `runChaserStep` avance via `setTimeout(hold)` + RAF (`midi-actions.ts:340-403`) : **drift d'horloge**, aucune synchronisation avec l'audio/le BPM réel, pas de résolution continue (les valeurs sautent d'un step à l'autre toutes les `holdMs` ms, fadeIn/fadeOut = 0).
- Le moteur de lecture correct est **déterministe par frame** : `useDmxPlayback` + `computeChaserTrackOverrides` (résolution du step depuis `currentTime`, `dmx-playback.ts:199-280`), qui produit une sortie stable à 60 FPS dans le même pipeline que l'autoscript, sans état, sans timer.

### [MOYEN] M1 — Purge destructive + projet marqué « dirty » en continu
- `handleToggle` fait `stopAll()` + `purgeStore()` à **chaque clic** (`AutoLoopsPanel.tsx:98-117`) et `purgeAutoLoops` supprime scènes+chasers (`auto-loops.ts:498-512`). Or `createScene`/`updateScene`/`createChaser`/`deleteScene`/`deleteChaser` appellent `markDirty()` (`showStore.ts`).
- Préviewer un loop crée/supprime des entités persistantes et **salit le projet** à chaque interaction. Le patch-change effect (`AutoLoopsPanel.tsx:79-83`) et l'unmount (`:86-91`) aggravent : toute variation de patch purge.

### [MOYEN] M2 — Canaux « orphelins » en changeant de loop (stale)
- `outputArbiter.write` **remplace** la contribution de la source (`output-arbiter.ts:105`). Enchaîner `midiStopChaser(A)` (zéros transitoires, release 2 s) puis `midiPlayChaser(B)` : B **remplace** A dans `'midi-chaser'`, mais le `writeTransient` de stop est **annulé** par le `write` de play (`cancelTransient`, `dmx-bridge.ts:63`). Les canaux de A absents de B ne sont jamais remis à zéro → ils restent figés sur le SAB.

### [MOYEN] M3 — Dépendance implicite à l'état de lecture audio (comportement à 3 visages)
- Comportement différent selon l'historique audio : (a) audio jamais joué → `'quickshow'` inactif → écriture partielle + résidus SAB (S2) ; (b) audio joué puis pause → le chemin de pause a écrit 512 zéros dans `'quickshow'` (`dmx-playback.ts:456-490`) → le loop joue mais **blackoute tout le reste de l'univers** ; (c) audio en lecture → mélange loop+autoscript (S1). L'utilisateur perçoit trois comportements « pas normaux » différents selon le contexte.

### [MINEUR] m1 — Scènes de loop sans état complet
- Aucune scène matérialisée ne ferme le shutter/éteint les canaux des fixtures non ciblées par le loop (`auto-loops.ts:465-497`). Un color-chase laisse pan/tilt en l'état ; un movement laisse la couleur en l'état.

### [MINEUR] m2 — `duration` de scène incohérente
- `materializeAutoLoops` fixe `duration: holdMs` sur les scènes ET `hold: holdMs` sur les steps (`auto-loops.ts:470-486`). Le fallback `scene.duration - fadeIn - fadeOut` de `runChaserStep` (`midi-actions.ts:352`) n'est jamais exercé. Redondance sans effet mais source de confusion.

### [MINEUR] m3 — `holdMs` borné à 50 ms, pas de lissage
- `holdMs = max(50, 60000/speedBpm)` (`auto-loops.ts:469`) → à 170 BPM ≈ 353 ms, à 80 BPM = 750 ms. Sans fades, les loops (surtout dimmer-pulse/movement) sont **crénelés** (sauts discrets), pas fluides.

### [OK] O1 — La priorité LTP fait gagner le loop sur ses canaux
- Sur les canaux effectivement écrits, `midi-chaser` (LTP 75) > `quickshow`/`song-preset` (HTP 40/45). L'arbitrage est correct (`output-arbiter.ts:141-176`). « Ça joue », mais partiellement.

### [OK] O2 — Pas de blackout watchdog ni de famine hardware pendant les loops
- Le watchdog renderer ping ~500 ms (`electron/main.ts:455-507`) est indépendant et reste vivant (le renderer tourne). Le worker hardware renvoie le SAB à 30 FPS (`engine.ts` FRAME_RATE=30). Le problème n'est **pas** un blackout ni une absence d'envoi de trames.

### [OK] O3 — Matérialisation correcte (scènes/chasers bien créés)
- `createScene`/`updateScene`/`createChaser`/`updateChaser` propagent bien `channels` et `steps` (`showStore.ts`). `materializeAutoLoops` lit/écrit l'état de façon synchrone, donc `midiPlayChaser` trouve bien le chaser fraîchement créé.

---

## 4. Verdict

**Pourquoi les boucles ne « jouent pas normalement » :** `AutoLoopsPanel` matérialise chaque loop en chaser puis le lit via `midiPlayChaser`, un **moteur ad-hoc timer/RAF** (`midi-actions.ts:323-403`) **découplé du moteur de lecture réel**. Ce moteur :
1. n'écrit qu'un **sous-ensemble de canaux** une fois par step (pas de takeover complet) ;
2. écrit sur une **source LTP dédiée** (`midi-chaser`) en parallèle de l'autoscript `useDmxPlayback` qui, monté en permanence (`QuickShowView.tsx:1188-1199`, `:2299`), **réécrit tout l'univers chaque frame** sur `quickshow` dès que l'audio joue ;
3. laisse l'arbitrage produire **trois comportements différents** selon que l'audio n'a jamais joué / a été mis en pause / est en lecture (résidus SAB figés, blackout du reste, ou mélange loop+autoscript).

Le résultat est un rendu **instable, partiel et contextuel** — pas une lecture fiable.

**Mécanisme de lecture CORRECT à utiliser à la place de `midiPlayChaser` :** piloter le loop dans le **même pipeline frame-locked que l'autoscript** — `useDmxPlayback` (`dmx-playback.ts:349`) avec `computeChaserTrackOverrides` (`dmx-playback.ts:199`), qui résout le step du chaser **déterministiquement depuis `currentTime`** et fait un **takeover complet** des fixtures cibles (suppression des canaux autoscript puis écriture de l'état de scène), en une seule source (`quickshow`). Concrètement : au lieu d'appeler `midiPlayChaser`, l'onglet loops devrait soit (a) insérer le chaser matérialisé dans `chaserTracksRef`/`chasersRef`/`scenesRef` consommés par `useDmxPlayback`, soit (b) produire ses propres `CuePlayback` (frames DMX complets) et les injecter dans `cues`/`overrideCuesRef` du même `useDmxPlayback`, garantissant **un seul écrivain par canal**, une cadence 60 FPS et un état de fixture complet à chaque frame.

---

## 5. Synthèse (pour l'agent principal)

- Le chemin `AutoLoopsPanel → materializeAutoLoops → midiPlayChaser` **atteint bien le hardware** (arbitre + SAB + worker 30 FPS), mais lit les loops avec un **moteur chaser ad-hoc** (`midi-actions.ts`, source `midi-chaser` LTP 75, `setTimeout`/RAF par step) **découplé** du vrai moteur de lecture.
- **3 défauts SÉVÈRES** : (S1) concurrence avec l'autoscript `useDmxPlayback` toujours monté (`QuickShowView.tsx:1188-1199/2299`) qui réécrit l'univers chaque frame sur `quickshow` ; (S2) scènes de loop à **état partiel** → résidus SAB figés/blackout du reste ; (S3) mauvaise mécanique (timers avec drift) au lieu du moteur **déterministe par frame**.
- **Mécanique correcte** : jouer les loops via `useDmxPlayback` + `computeChaserTrackOverrides` (ou injecter des frames complets dans `cues`/`overrideCuesRef`), pour un takeover complet et une seule source/écrivain par canal.
- Le hook `useMidiTriggers` est **hors circuit** pour les loops (appel direct) : ce n'est pas lui qu'il faut corriger.
- Pistes de fix rapides pour le lot : supprimer l'appel `midiPlayChaser` dans `AutoLoopsPanel.handleToggle` (`:111`) au profit d'un branchement sur le moteur `useDmxPlayback`, et faire produire par `materializeAutoLoops` des **frames DMX complets** (tous les canaux des fixtures ciblées, shutter/pan/tilt/couleur inclus) plutôt que des scènes à canaux partiels.
