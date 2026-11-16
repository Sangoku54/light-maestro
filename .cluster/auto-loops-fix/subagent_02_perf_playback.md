# Rapport — Lecture des auto loops depuis la Virtual Console (vue Performance)

**Objet** : cartographier le mécanisme de lecture existant dans `src/views/PerformanceView.tsx` et déterminer le point d'insertion le plus propre pour un widget « loop » dédié, SANS contrôleur DMX externe et SANS audio.

**Fichiers lus (lecture seule)** :
- `src/views/PerformanceView.tsx` (≈4400 lignes)
- `src/stores/performStore.ts`
- `src/utils/dmx-bridge.ts`
- `src/utils/dmx-helpers.ts`
- `src/engine/output-arbiter.ts`
- `src/engine/auto-loops.ts`
- `src/engine/midi-actions.ts`
- `src/views/AutoLoopsPanel.tsx`

---

## Synthèse en 3 points (avant le détail)

1. **Il existe déjà DEUX moteurs de lecture de chaser** dans le projet, et un troisième chemin (RAF de show). Le moteur le plus propre et le plus complet est `midiPlayChaser()` / `midiStopChaser()` dans `src/engine/midi-actions.ts` — c'est **lui qu'utilise déjà `AutoLoopsPanel.tsx`** pour jouer les auto loops matérialisées.
2. **Le widget chaser inline de `VCButtonWidget` (PerformanceView ~L1900-1969) est un moteur dégradé** : il ignore `chaser.direction`, n'utilise pas `chaser.speed` (BPM), écrit en source `'vc'` persistante, et ne « purge » pas la dernière frame à l'arrêt.
3. **Le point d'insertion le plus propre = réutiliser `midiPlayChaser`/`midiStopChaser`** (pattern `AutoLoopsPanel`) avec une nouvelle action de bouton `autoLoop`, au lieu de dupliquer un 4ᵉ moteur de frames DMX.

---

## (a) Mécanisme exact de lecture des chasers

### A.1 — Widget chaser de la Virtual Console (`VCButtonWidget`, `PerformanceView.tsx`)

- État local : `chaserRunningRef` (L1486), `chaserTimerRef` (L1485). Branch dans `activate()` à **L1900** : `if (config.actionType === 'chaser' && config.chaserId)`.
- `runStep()` (**L1905**) est une **récursion setTimeout/RAF** (pas un RAF global) :
  1. Cherche `chaser.steps[stepIndex]` puis la scène `step.sceneId`.
  2. Scène introuvable → **`setTimeout(runStep, 100)` (L1913)** : c'est le seul « délai fixe 100 ms » du code, réservé au **skip de scène manquante**, PAS au tempo.
  3. Timing d'un step (**L1920-1921**) :
     - `fadeIn  = step.fadeIn  ?? scene.fadeIn  ?? 0`
     - `fadeOut = step.fadeOut ?? scene.fadeOut ?? 0`
     - `hold    = step.hold   ?? (scene.duration > 0 ? scene.duration - fadeIn - fadeOut : 500)`
  4. `applyLevel(level)` → `sendChannelsToHardware(scaled, fixtures, universes, 'vc')` (**L1928**) → `dmxBridge.write('vc', …)` (LTP 80, **persistant**).
  5. fadeIn animé en RAF → `onHold()` (**L1945**) arme `setTimeout(…, hold)` → fadeOut animé en RAF → `nextStep()` → `stepIndex = (stepIndex + 1) % steps.length` → `runStep()` (boucle infinie).

- **Conclusion A.1** :
  - `hold`/`fadeIn`/`fadeOut` **par step sont bien respectés** (en millisecondes).
  - **`chaser.speed` (BPM) n'est JAMAIS lu** par ce moteur. Le BPM n'existe que figé dans `step.hold` au moment de la matérialisation (cf. A.4).
  - **`chaser.direction` est IGNORÉ** : avance toujours en `forward` (`stepIndex+1`), pas de `backward`/`bounce`.
  - Écriture **`'vc'` persistante**, sans `release` ni zéro à l'arrêt (voir piège C.2).

### A.2 — RAF loop « Show Playback Engine » (L216-552) et chasers de tracks de show (L387-406)

- `startShowPlayback()` (L221) monte un **RAF global** piloté par `performance.now() - startTime` (horloge réelle du show). Il lit `showData.tracks` → items `scene`/`chaser`/`efx`/`audio`.
- Branche chaser d'un item de track (**L387-406**) : **sémantique temporelle = ms**, **pas de BPM** :
  - `cycleDur = Σ(steps)(fadeIn + hold + fadeOut)` (ms)
  - `cyclePos = elapsed % cycleDur`
  - le step actif est trouvé par balayage cumulatif, `stepIntensity` dérive de `fadeIn`/`hold`/`fadeOut` du step.
  - Écrit via `sendChannelsToHardware(…, 'vc')` (L406), source `'vc'` persistante.
- **Conclusion A.2** : `hold` en **ms**, `speed` BPM non utilisé ici non plus. C'est un moteur « timecode show », distinct du widget. Il ne lit pas `chaser.direction` (toujours forward dans le balayage linéaire).

### A.3 — Moteur chaser partagé `midi-actions.ts` (celui à réutiliser)

- `midiPlayChaser(chaserId, sourceId)` (**midi-actions.ts ~L430**) et `midiStopChaser(chaserId)` (~L465) :
  - `runChaserStep()` reproduit fadeIn/hold/fadeOut **en ms**, avec **RAF + setTimeout**.
  - **Respecte `chaser.direction`** (`forward`/`backward`/`bounce`) via `nextStepIndex()` (~L340).
  - Scaling optionnel par horloge MIDI (`clockDurationScale()` = 120/BPM) — **inactif sans horloge** (retour à ×1).
  - Écrit via `sendChannelsToHardwareAndStore(…, sourceId)` → source **`'midi-chaser'`** (LTP 75, enregistrée L107-108), **et miroir vers appStore** (la 3D Stage3D suit).
  - `midiStopChaser()` fait un **`flushZeros`** transitoire (release ~2 s) sur tous les canaux des scènes du chaser → **pas de frame résiduelle**.
- **C'est déjà ce moteur qui joue les auto loops** : `AutoLoopsPanel.tsx` fait `materializeAutoLoops([loop], store)` puis `midiPlayChaser(chaserId)` (L106-109), `midiStopChaser` (L74), `purgeAutoLoops` (L76).

### A.4 — Lien speed (BPM) ↔ hold (ms) dans les auto loops

- `auto-loops.ts` : `materializeAutoLoops()` (**L467**) calcule `holdMs = max(50, round(60000 / loop.speedBpm))` et stocke :
  - scène : `fadeIn:0, fadeOut:0, duration:holdMs`
  - step chaser : `{ sceneId, fadeIn:0, hold:holdMs, fadeOut:0 }`
  - chaser : `speed: loop.speedBpm` (informatif, **non consommé par les moteurs**) + `direction`.
- Donc **le BPM est « cuit » dans `hold` en ms** à la matérialisation. Les moteurs de lecture n'ont besoin que de `hold`/`fade` par step.

---

## (b) Points d'insertion EXACTS pour un widget « auto loop » sans audio

**Recommandation principale : ne pas réécrire un moteur. Réutiliser `midiPlayChaser`/`midiStopChaser`** (moteur déjà éprouvé, direction-aware, purge propre) + `generateAutoLoops`/`generateLoopLibrary` + `materializeAutoLoops` (pattern `AutoLoopsPanel`).

| # | Fichier | Ligne (réf.) | Modification |
|---|---------|--------------|--------------|
| 1 | `src/stores/performStore.ts` | **L32-44** | Ajouter `'autoLoop'` à l'union `ButtonActionType`. |
| 2 | `src/stores/performStore.ts` | **L53-92** (`ConsoleWidgetConfig`) | Ajouter des champs config : `loopKind?: AutoLoopKind`, `loopTier?: FixtureTier`, `loopDirection?`, `loopSpeedBpm?: number`, `loopSeed?: number` (ou un `loopId` stable). |
| 3 | `src/views/PerformanceView.tsx` | **L920-941** | Dans le `<select>` du type d'action (`WidgetConfigModal`), ajouter `<option value="autoLoop">Loop auto</option>`. **NB : `audioAutoScript` n'y figure PAS aujourd'hui** (voir C.4). |
| 4 | `src/views/PerformanceView.tsx` | **~L1082** (à côté du bloc `audioAutoScript`) | Ajouter le bloc de config `{config.actionType === 'autoLoop' && (<AutoLoopConfig …/>)}` (choix tier/kind/speed/direction). |
| 5 | `src/views/PerformanceView.tsx` | **L1615** (`activate`) | Ajouter une branche `if (config.actionType === 'autoLoop') { … }` qui : `generateAutoLoops`/`generateLoopLibrary` → `materializeAutoLoops([loop], store)` → `midiPlayChaser(chaserId)` ; mémoriser `chaserId` dans un ref pour l'arrêt. |
| 6 | `src/views/PerformanceView.tsx` | **L1973** (`deactivate`) | Ajouter `midiStopChaser(chaserIdRef.current)` + `purgeAutoLoops(useShowStore.getState())` (ou au moins `midiStopChaser`). |
| 7 | `src/views/PerformanceView.tsx` | **L2075-2080** | Label du bouton : branche `config.actionType === 'autoLoop' ? (config.label || '⟳ Loop')`. |
| 8 | `src/views/PerformanceView.tsx` | **L1-20 (imports)** | Ajouter `import { generateLoopLibrary, materializeAutoLoops, purgeAutoLoops, type AutoLoop } from '../engine/auto-loops';` et `import { midiPlayChaser, midiStopChaser } from '../engine/midi-actions';`. |

**Alternative « génération paresseuse sans persister »** : si l'on veut éviter de créer des scènes/chasers dans le store, on peut générer les frames `AutoLoop.steps[].channels` directement et les jouer sur une horloge virtuelle RAF (copie du pattern `_startAudioAutoScript` L1524-1613 **moins l'audio**) en écrivant `dmxBridge.write('vc-loop', …)`. C'est plus léger mais **duplique un moteur** (à déconseiller sauf besoin de ne rien persister). Si cette voie est retenue, enregistrer une source dédiée `'vc-loop'` LTP 75 via `dmxBridge.registerSource` pour ne pas écraser `'vc'` (voir C.3).

---

## (c) Pièges identifiés

### [SÉVÈRE] C.1 — `audioAutoScript` non atteignable via l'UI
- `ButtonActionType` contient `'audioAutoScript'` (performStore L44), et le rendu `AudioAutoScriptConfig` existe (PerformanceView L1082), **mais le `<select>` (L920-941) ne propose que `scene` / `chaser` / `blackout` / `loadShow` / `playSong`**.
- → Un widget `audioAutoScript` n'est créable que par code/édition manuelle du projet. Toute nouvelle action de widget doit **impérativement être ajoutée au `<select>`** pour être atteignable.

### [SÉVÈRE] C.2 — Le widget chaser inline ne « purge » pas la dernière frame à l'arrêt
- `deactivate()` (L1973-1979) ne fait que `clearTimeout(chaserTimerRef)` + `chaserRunningRef=false`. **Aucun zéro / `release('vc')`** n'est émis.
- Or `applyLevel()` écrit en `'vc'` **persistant** (LTP 80). La dernière valeur (souvent `level=1`) **reste épinglée** dans la source `'vc'` jusqu'à ce qu'un autre write `'vc'` la remplace ou qu'un `writeTransient('vc', zeros)` (via `vcZeroAllUniverses`, L57) la libère.
- Pour le nouveau widget « loop » : utiliser `midiStopChaser()` qui fait le `flushZeros` — ou appeler `vcZeroAllUniverses()` à l'arrêt si l'on réutilise le moteur inline.

### [SÉVÈRE] C.3 — Conflit de source `'vc'` entre widgets (write = replace-all)
- `outputArbiter.write()` fait `uni.set(id, clean)` : **un write `'vc'` remplace TOUTE la contribution `'vc'` de l'univers** (pas un merge par canal).
- Conséquence : deux widgets `'vc'` sur le même univers **s'écrasent mutuellement** (un chaser écrase une scène, un autoScript écrase un chaser, etc.). `sendChannelsToHardware` avec `'vc'` (L382/406/1848/1928/3892) partagent tous le même slot.
- → Le widget « loop » ne doit **pas** écrire en `'vc'` s'il cohabite avec un chaser/scène/autoScript. Réutiliser `midiPlayChaser` (source `'midi-chaser'` dédiée) **isole proprement** la boucle des autres widgets.
- Priorités arbitre (output-arbiter.ts `DEFAULT_SOURCES`) : `simple-desk` 100 > `fixture-test` 90 > **`vc` 80** > `midi`/`midi-chaser` 75 > `remote` 70 > `design-efx` 70 > `design-test`/`fixture-onoff` 60 > `default` 50 > HTP (`song-preset` 45, `quickshow` 40, …). Un widget `'vc'` **l'emporte** donc sur une boucle `'midi-chaser'` sur les mêmes canaux.

### [MOYEN] C.4 — Purge / exclusivité avec `AutoLoopsPanel` (IDs chasers volatiles)
- `materializeAutoLoops` crée de **nouveaux ids** chaser/scène à chaque appel ; `purgeAutoLoops` supprime **toutes** les scènes du dossier `'auto-loops'` + les chasers qui les référencent.
- `AutoLoopsPanel` purge déjà au `patchKey` change et à l'unmount (AutoLoopsPanel L76, L82-86). Un widget VC « loop » qui matérialise aussi des loops **partage le même dossier `'auto-loops'`** → un `purgeAutoLoops` du widget détruirait les chasers en cours du panneau (et inversement).
- → Soit **réutiliser un loop déjà matérialisé** (éviter de re-créer), soit **ne pas purger en double**, soit donner au widget son propre dossier/tag. A minima : stop avant purge et ne jamais `midiStopChaser` un id qui n'est plus valide.

### [MOYEN] C.5 — Le moteur inline et le moteur `midi-actions` sont des doublons (dette documentée)
- Le commentaire d'en-tête de `midi-actions.ts` le dit explicitement : le moteur scène/chaser « vivant » est encapsulé dans `VCButtonWidget` (PerformanceView ~L1490-1900) et **n'est pas réutilisable tel quel** (refs/closures de composant) ; `midi-actions.ts` en est un « miroir comportemental ».
- Tout nouveau chemin de lecture doit **aller vers `midi-actions.ts`** (extraction future d'un module partagé) et **pas** recopier une 3ᵉ fois le pattern fade/hold.

### [MINEUR] C.6 — `vcZeroAllUniverses` est « par fixture patched », pas « par univers » strict
- `vcZeroAllUniverses` (L57-88) boucle sur `patchedFixtures` et déduit `uniNum` via `uniIds.indexOf(pf.universeId)`. Si une universe patched n'a aucune fixture, elle n'est pas zéroée. Sans impact pour les loops (elles visent des fixtures), mais à connaître si l'on élargit.

### [OK] C.7 — Ce qui est déjà sain
- `writeTransient` (dmx-bridge L100-117) + `release` (L126-138) = mécanisme de libération transitoire correct, utilisé par les stops/zéro.
- `midiStopChaser` fait le `flushZeros` (transitoire) : aucune frame résiduelle.
- `_startAudioAutoScript` (L1524-1613) est le **modèle « RAF + horloge virtuelle + mutex audio »** demandé : `registerAudioPlayback` (L102), `stopAllAudioPlayback` (L91), `fireAutoDmx` par `performance.now()`, `vcZeroAllUniverses()` en 1ʳᵉ frame et à l'arrêt. Pour un « loop sans audio », il suffit de **retirer le bloc audio** de ce modèle et de garder la boucle RAF de frames.

---

## Références de lignes utiles (PerformanceView.tsx)

- `vcZeroAllUniverses` : **L57**
- `stopAllAudioPlayback` : **L91** · `registerAudioPlayback` : **L102**
- Show Playback Engine : **L216** · `startShowPlayback` : **L221** · chaser de track : **L387-406**
- `WidgetConfigModal` : **L859** · `<select>` actionType : **L920** · options : **L937-941**
- bloc `audioAutoScript` config : **L1082** · bloc `chaser` config : **L1089**
- `AudioAutoScriptConfig` : **L1199**
- `VCButtonWidget` : **L1473** · `chaserTimerRef` L1485 · `chaserRunningRef` L1486
- `_startAudioAutoScript` : **L1524**
- `activate` : **L1615** · branche `audioAutoScript` L1742 · branche `scene` L1827 · branche `chaser` L1900 · `runStep` L1905 · `setTimeout(runStep,100)` L1913 · `onHold` L1945
- `deactivate` : **L1973** · label bouton : **L2075-2080**
- `genCuesLocal` : **L2304**
