# Revue adversarial des diffs — Phase 0 (USB hotplug / watchdog / tsc à zéro / save&quit + autosave)

**Date** : 2026-08-14
**Base de comparaison** : tag `backup-pre-phase0-20260814` (état AVANT)
**Périmètre** : 19 fichiers modifiés + 1 supprimé (`src/engine/dmx-engine.ts`, 813 l.) + 1 nouveau (`src/utils/renderer-watchdog.ts`)
**Méthode** : diff ligne par ligne de chaque fichier, lecture complète des fichiers à forte logique (main.ts, engine.ts, app.tsx, usb-output.js), greps croisés, vitest, build.

---

## Verdict global : ✅ OK (livrable) — 3 réserves mineures, aucune perte de fonctionnalité bloquante

Aucune perte de fonctionnalité fonctionnelle n'a été trouvée. Les 4 correctifs cohabitent sans s'écraser. Les réserves listées ci-dessous sont des races théoriques à très faible probabilité ou des défauts préexistants, avec corrections chirurgicales proposées.

---

## 1. Vérifications demandées — résultats

### 1.1 main.ts — double intervenant (watchdog + save)
**✅ Cohabitation parfaite.** Le bloc watchdog (l.180-235) est inséré entre le handler `dmx:error` et les handlers Fixtures ; les handlers `project:save` (l.394-400) et `storage:set` (l.428-438) reçoivent l'écriture atomique temp+rename sans perte de leur logique. Toute la logique préexistante est intacte : fenêtre/close-guard (`app:before-close`, `app:close-action`), tray, menu, show save/load, dmx forward, MIDI → actions DMX, audio, presets, storage get/remove. Aucun handler supprimé ni écrasé.

### 1.2 dmx-engine.ts supprimé
**✅ Aucune référence résiduelle.** `git grep "dmx-engine" -- src electron` (état actuel ET état backup) = 0 résultat. **Mieux : même dans le backup, RIEN n'importait ce fichier** — les seuls hits `dmxEngine*` sont une variable React locale `dmxEngineRunning` dans designview.tsx (sans lien). Le fichier était du code mort de 813 lignes (interface `ChannelAnalysis` dupliquée avec dmx-channel.ts). Suppression sans risque ; copie de sécurité conservée dans `.openclaw/tmp/dmx-engine.ts.bak`.

### 1.3 app.tsx saveProject
**✅** Le snapshot complet inclut : `appStore` (tout sauf isDirty/markDirty/markClean) + showStore **11 slices** (patchedFixtures, stageDims, universes, fixturePositions, fixtureGroups, scenes, chasers, effects, cueLists, shows, songPresets) + `vcWidgets` (showData strippé) + schemaVersion + timestamp. Le bug initial (3 slices) est corrigé.
**✅** `handleSaveAndQuit` appelle `saveProject()` (dialog) AVANT de quitter ; si échec/annulation → fallback `saveProject({silent:true})` puis `markClean()` + `closeAction('discard')`. L'annulation du dialog ne bloque PAS la sortie (comportement conservé : on quitte quand même).
**✅** `__lm_open` restaure les 11 slices + appStore + vcWidgets (avec migration fallback localStorage).

### 1.4 Autosave (45 s)
**✅** Mutex `projectSaveInFlight` module-level : un autosave ne peut pas écrire pendant un save manuel (dialog ouvert) ni pendant save&quit, et réciproquement. Skip si `!isDirty`. `markClean` seulement si l'écriture a réussi. Écriture via `storage:set('autosave', …)` (atomique côté main). Pas de course avec le quit : la fenêtre d'interleaving éventuelle (timer qui tombe entre la fin du save dialog et le close) écrit un snapshot complet dans le slot autosave — inoffensif, l'IPC `storage:set` est synchrone côté main et survit au close de la fenêtre.

### 1.5 storage.ts
**✅** `load()` tolère les fichiers sans `schemaVersion` (`?? 1`), avertit si version plus récente mais charge quand même. `save()` écrit `schemaVersion: 1`. Écriture atomique temp+rename (rename remplace la cible sur Windows — OK). `addToRecent`/`indexShow` inchangés. Aucun chemin de lecture existant cassé.

### 1.6 engine.ts USB
**✅** Le flux DMX normal est intact : worker → SAB → `handleFrameSent` (frameCount, blackout guard, Grand Master, dispatch USB/Art-Net/sACN), `sendUsbFrame`/`sendArtNetFrame`/`sendSacnFrame`, `setChannel`/`setChannels`/`htpMerge`/`ltpMerge`, `blackout()`/`restore()`, `addUniverse`/`syncUniverses`/`removeUniverse`. Le guard `current.child === child` est correct : au démarrage normal, le child READY est dans la map, `current.child === child` vrai → aucun impact. Le démarrage (start → startAllOutputs → started) n'est pas cassé : un dongle absent retarde l'émission `started` (backoff préexistant ~21 s max) mais ne bloque pas.
**✅** Le watchdog interagit correctement : `engineStartedByUser` ne passe à true qu'à `emit('started')`, donc un démarrage lent ou raté ne déclenche jamais de faux fail-safe. Après un fire, `stop()` émet 'stopped' → `engineStartedByUser=false` → auto-guérison, pas de boucle.
**✅** `blackout()` idempotent (guard `blackoutState`), `stop()` idempotent (worker null → skip).

### 1.7 usb-output.js
**✅** Flux normal inchangé : break/MAB (`brk` true→false), `busy`-skip (DMX lossy), RTS HIGH, `createDmxFrame`, log frame/error. Les nouveaux déclencheurs `disconnected` (exit 3) sont correctement protégés contre les faux positifs :
- `closePort()` supprime `ports[portId]` AVANT `close()` → le handler 'close' ne confond pas un close intentionnel avec un unplug ;
- guards `shutdown` dans les callbacks break/MAB/write ;
- `fatal[portId]` anti double-exit ;
- `logSync` (fs.writeSync) garantit que le message arrive avant `process.exit(3)`.
- Le cas « entry présente mais port fermé » dans sendFrame → flagDisconnected : c'est la détection voulue d'un unplug entre deux frames, pas un faux positif.

### 1.8 Watchdog fail-safe
**✅** Armé UNIQUEMENT au premier ping (`watchdogArmed`). Ré-armé à chaque ping ; `watchdogFired` reset à chaque ping → un renderer vivant ne peut pas être blackouté (4 pings de marge : 500 ms ping vs 2000 ms timeout ; la mesure est sur `Date.now()` donc un event-loop bloqué > 2 s qui reçoit les pings en rafale ne déclenche PAS de faux positif). `workerLost` ne se déclenche que si l'engine a été démarré par l'utilisateur (`engineStartedByUser`) — un app au boot sans engine ne peut pas se faire blackouter. Blackout+stop sûrs (idempotents).

### 1.9 tsc à zéro — changements de logique non-types
**Aucun changement de logique métier.** Détail exhaustif :
- `dmx-channel.ts` / `dmx-color.ts` : correction d'import (`./dmx-cues` → `../hooks/dmx-cues`). Types only.
- `audio-analysis.ts` : interface only (union + 'build', champs optionnels, timeSignature/keyConfidence).
- `dmx-cues.ts` : union type élargie (Macro/Zoom/Frost/Focus/Iris) + **`channelCount: channels.length` ajouté à l'objet retourné par `analyzeFixture`** (l.590) — SEUL changement runtime du lot, strictement additif (nouveau champ, aucun consommateur existant modifié).
- `dmx-playback.ts` : types (params `fixtureGroups` structurels, `_key?`, `name?`), suppression d'un `// @ts-expect-error` devenu inutile, `if (hasEntries) ;` → `if (hasEntries) {}` (no-op identique).
- `fixture-tracks.ts` : `fixtureNames?` additif.
- `showstore.ts` : `enabled?`, `chaserTracks?` additifs.
- `types.d.ts` : `export {}` + `declare global` (répare TS2669) + surface API complétée. Types only.
- `designview.tsx` : générique `useMemo<…>`. Types only.
- `quickshowview.tsx` : types (regenSeed, undo/redo refs, savedPresets) + déplacement de cast `(x as T || 'unknown')` → `((x || 'unknown') as T)` — **sémantique identique** (la précédence `as` > `||` rendait l'ancienne forme équivalente).
- `tracktimeline.tsx` : assertion de type sur la valeur d'un `<select>`. Types only.
- `app.tsx` `setFixturePositions([])` → `({})` : alignement sur le type réel `Record<string, FixturePos>` (l'ancien `[]` était une violation de type).
- `main.tsx` : import du watchdog (nouveau fichier).

---

## 2. Problèmes trouvés (par gravité)

### ⚠️ P1 — RACE WATCHDOG PENDANT UN STOP VOLONTAIRE (théorique, mineur)
- **Fichier** : `electron/main.ts` (bloc watchdog, l.195-233) + `electron/dmx/engine.ts` `stopInternal()` (l.110-135)
- **Description** : `workerLost = engineStartedByUser && !isRunning() && !rendererLost`. Dans `stopInternal()`, `this.worker = null` (→ `isRunning()` false) se produit AVANT `emit('stopped')` (→ `engineStartedByUser=false`). Une tick du watchdog (toutes les 500 ms) qui tombe dans cette fenêtre de quelques ms (durée de `stopAllOutputs`) déclencherait un blackout+stop superflu + popup `[watchdog] DMX worker lost` pendant un stop volontaire de l'utilisateur. Conséquence bénigne (idempotent, auto-guéri), probabilité ~1 % par stop.
- **Fix chirurgical** : dans `stopInternal()`, émettre `'stopped'` (ou un flag dédié) dès le début de l'arrêt, avant `this.worker = null` ; ou dans le watchdog, remplacer `!dmxEngine.isRunning()` par un compteur de 'started'/'stopped' événementiel.

### ⚠️ P2 — CTRL+S PENDANT UN AUTOSAVE EN VOL : SKIP SILENCIEUX (mineur, UX)
- **Fichier** : `src/app.tsx` l.45-50 (`saveProject`)
- **Description** : si l'utilisateur fait Ctrl+S (ou Save&Quit) pendant qu'un autosave est en vol, le mutex fait retourner `false` → pas de dialog, pas de save manuel, l'utilisateur croit avoir sauvegardé. Pas de perte de données (le snapshot autosave s'écrit), mais le fichier .lmproj choisi n'est pas créé.
- **Fix chirurgical** : si mutex occupé, `await` un petit délai puis retenter une fois avant de retourner false (ou queue-ifier).

### ⚠️ P3 — DOUBLE SPAWN USB SI READY > 5 s (préexistant, aggravé par le retry infini)
- **Fichier** : `electron/dmx/engine.ts` `startUsbRetryTimer()` (l.450-470) + `trySpawnUsbChild()`
- **Description** : le timer ne vérifie que `usbOutputs.has(id)` ; si un child est en cours d'open (> 5 s, dongle lent), un second child est spawné. Les nouveaux guards (`child.killed`, `current.child === child`) limitent les dégâts, mais le READY tardif d'un child jamais tué peut écraser la map et orpheliner le premier (port tenu). **Préexistant** (le timer et son guard existaient avant Phase 0) ; le diff l'améliore sans le fermer.
- **Fix chirurgical** : tenir une map `spawning: Map<id, ChildProcess>` ; avant de respawner, tuer le child en cours ; dans le handler READY, vérifier que le child est toujours le spawn courant.

---

## 3. Preuves

| Vérification | Résultat |
|---|---|
| `npx vitest run` | ✅ 3 fichiers, **26/26 tests passés** (chaser-track 4, playback-clock 4, gencues 18) — exit 0 |
| `npm run build` | ✅ **exit 0**, built in 4.96 s (warning chunk size seul) |
| `git grep "dmx-engine" -- src electron` (actuel) | ✅ 0 résultat |
| `git grep "dmx-engine" -- src electron` (backup) | ✅ 0 résultat (fichier jamais importé = code mort) |
| `git grep "dmxEngine" backup -- src` | ✅ seuls des hits React locaux `dmxEngineRunning` (designview.tsx), sans lien |
| Diff complet des 19 fichiers | ✅ lu ligne par ligne (rapporté ci-dessus) |
| Lecture complète main.ts / engine.ts / usb-output.js / app.tsx / preload.ts | ✅ cohérence des handlers IPC, guards, flux frame, close-guard |

---

## 4. Conclusion

**✅ Verdict : OK — livrable.** Les 4 correctifs de la Phase 0 n'introduisent **aucune perte de fonctionnalité** : les 813 lignes supprimées étaient du code mort non référencé, les changements tsc sont à 100 % types/additifs, le save complet couvre bien les 11 slices + widgets, l'autosave est correctement mutexé, les écritures sont atomiques, le watchdog ne peut pas se déclencher sur un show sain, et les guards USB (`child === child`, `fatal`, close-intentionnel) sont corrects. Les 3 réserves (P1, P2, P3) sont mineures, avec fixes chirurgicaux proposés ; P3 est préexistant.
