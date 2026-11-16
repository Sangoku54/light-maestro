# Diagnostic — Conflit de sources DMX (couleurs timeline figées)

Sous-agent B (lecture seule, aucun fichier modifié hors ce rapport).

## 1. Verdict

**CONFLIT CONFIRMÉ.**

L'arbitre (`src/engine/output-arbiter.ts`) est volontairement conçu pour que toute
source LTP « contrôle » écrase les sources HTP « lumière » : `simple-desk` (LTP 100),
`fixture-test` (LTP 90), `vc` (LTP 80) gagnent TOUJOURS sur `quickshow` (HTP 40) sur
les canaux qu'ils détiennent. Le bug vient du fait que **plusieurs de ces sources LTP
sont écrites de façon persistante (`write`/`writeMerge`) sans jamais être relâchées**,
et que les chemins de « stop » censés les relâcher **ne s'exécutent jamais** car les
panneaux ne sont jamais démontés (navigation par `display:none`, pas par unmount).

Conséquence directe : pendant une lecture timeline (`quickshow`, HTP 40), une source
LTP qui tient les canaux RGB à une valeur fixe masque les couleurs des blocs →
« toujours la même couleur ».

## 2. Table des écritures / relâches par source

| Source (priorité/mode) | Écriture persistante (fichier:ligne) | Relâche | Verdict |
|---|---|---|---|
| `simple-desk` (LTP 100) | `performStore.ts:285` (`sdSetChannelValue` → `write`) ; `:301` (`sdSetBulkChannelValues`) ; `:340` (`sdPasteUniverse`) | Seulement `sdResetAll` `:322` via `writeTransient` (relâche après 2 s). **Aucun `release('simple-desk')` nulle part.** | ❌ **Reste tenue indéfiniment** après un mouvement de fader |
| `fixture-test` (LTP 90) | `useFixtureTest.ts:96` (`setDmxChannel` → `writeMerge`) | `useFixtureTest.ts:103` (`stopTest` → `release`). MAIS cleanup unmount (`useFixtureTest.ts` ~107-112) ne fait **pas** de release, et `App.tsx` ne relâche pas `fixture-test` au changement de mode. | ⚠️ Tenue si le panneau disparaît/test interrompu (DesignView reste monté, le RAF continue en arrière-plan) |
| `vc` (LTP 80) | `AutoLoopsPanel.tsx:30` (`writeFrame` → `write('vc')`) ; `PerformanceView.tsx:1579` (widget auto-audio → `write('vc')`) ; `PerformanceView.tsx:2147` (slider VC → `writeMerge('vc', 1, ...)`) | `writeTransient('vc')` dans `AutoLoopsPanel.tsx:50` et `PerformanceView.tsx:71` (relâche après 2 s), déclenché uniquement par `stop()` / fin d'audio. **Aucun `release('vc')` explicite.** | ❌ **`write` du slider VC jamais relâché** ; `writeFrame` de la boucle tenu tant que la boucle tourne |
| `midi`/`midi-chaser` (LTP 75), `remote` (70), `osc` (71), `mtc` (72) | `midi-actions.ts:747` (`writeMerge(MIDI_SOURCE_ID)`) ; scènes/chasers via `applySceneLevel`/`applyLevel` → `sendChannelsToHardwareAndStore` (persistant si pas de `transientMs`) | `flushZeros` (`midi-actions.ts:127-131`) → `sendChannelsToHardwareAndStore(..., 2000)` = `writeTransient`, relâche après 2 s | ✅ Bien scopé (relâche au stop), mais scène « infinite » tenue tant que pas de stop |
| `design-efx`/`design-test`/`fixture-onoff` (70/60/60) | `DesignView.tsx:3325,3461` (`write('design-efx')`) ; `dmx-bridge.ts:164` (`pushDesignChannel` → `write('design-test')`) | `App.tsx:388-390` (`release` au changement de mode `!== 'design'`) + cleanup `DesignView.tsx:3487` (`writeTransient`) | ✅ Relâchés au changement de mode |
| `quickshow` (HTP 40) — le playback timeline | `dmx-playback.ts:1107` (`dmxBridge.push(uniIdx, chVals, arbSource)`, `arbSource='quickshow'`) | HTP : n'a pas besoin d'être relâché, il cède devant tout LTP | ✅ (mais écrasé par tout LTP tenu) |

Registre complet des `release(...)` dans tout `src/` (grep exhaustif) : uniquement
`SongPresetPlayer.tsx:50` (`song-preset`), `useFixtureTest.ts:103` (`fixture-test`),
`App.tsx:388-390` (`design-test`/`design-efx`/`fixture-onoff`) et l'auto-release interne
de `writeTransient` (`dmx-bridge.ts:95`). **`simple-desk` et `vc` n'ont aucun `release`
explicite nulle part.**

## 3. Scénario exact qui provoque « toujours la même couleur »

### Scénario A — la boucle unique (AutoLoopsPanel) reste tenue en arrière-plan (le plus probable)

1. L'utilisateur ouvre l'onglet **Boucle unique** (tab `loops`) dans QuickShow et clique
   **« Jouer la boucle »** → `play()` (`AutoLoopsPanel.tsx:133-146`) arme un
   `setInterval` et appelle `writeFrame` qui écrit **`write('vc', …)`** (`:30`) à chaque
   beat. `vc` (LTP 80) tient alors les canaux RGB/dimmer/shutter/pan-tilt de toutes les
   fixtures patchées.
2. L'utilisateur bascule sur l'onglet **Autoscript / timeline** (`tab === 'autoscript'`).
   Or `QuickShowView.tsx:1178-1185` rend les trois onglets dans des `<div style={{display:
   tab==='…' ? 'flex':'none'}}>` : **le panneau AutoLoopsPanel n'est JAMAIS démonté**,
   il est seulement caché. Son cleanup d'unmount (`AutoLoopsPanel.tsx:164-168`) ne tourne
   pas ; aucun effet ne surveille `quickSidebarTab` ; **l'intervalle continue de tourner
   en arrière-plan** et continue d'écrire `vc` à chaque beat.
3. L'utilisateur lance la lecture timeline : `useDmxPlayback` (`QuickShowView.tsx:2252`)
   écrit sur la source `quickshow` (HTP 40) via `dmxBridge.push(..., 'quickshow')`
   (`dmx-playback.ts:1107`).
4. `outputArbiter.getBuffer` (`output-arbiter.ts:131`) applique d'abord les LTP triés par
   priorité : `vc` (80) prend tous ses canaux et bloque `quickshow` (40). Résultat : les
   RGB joués par la timeline sont **remplacés par la couleur du thème de la boucle** (ex.
   thème « Violet » → nuances fixes de violet) → **les blocs de la timeline affichent des
   couleurs différentes mais la sortie reste toujours la même couleur**.

### Scénario B — Simple Desk tenu indéfiniment (LTP 100)

1. Mode Perform → Simple Desk : l'utilisateur déplace un fader RGB. `handleSliderChange`
   (`PerformanceView.tsx:2437-2448`) → `sdSetChannelValue` (`performStore.ts:285`) fait un
   `write('simple-desk', …)` **persistant, jamais relâché**.
2. L'utilisateur repasse en mode Quick (timeline). `handleModeChange` (`App.tsx:384-393`)
   ne relâche que `design-test`/`design-efx`/`fixture-onoff` — **pas `simple-desk`**.
3. La timeline joue sur `quickshow` (HTP 40) ; `simple-desk` (LTP 100) garde le canal RGB
   à la valeur du fader → couleur fixe, quel que soit le bloc. Seul `sdResetAll`
   (`performStore.ts:322`, `writeTransient`) ou un redémarrage libère la source.

### Scénario C — slider Virtual Console tenu indéfiniment (LTP 80)

Le slider VC (`VCSliderWidget`) fait `writeMerge('vc', 1, {[channel]: clamped})`
(`PerformanceView.tsx:2147`) **sans aucun release**. Bouger un slider VC tient `vc` (LTP 80)
sur ce canal pour toujours et masque `quickshow`. (NB : univers codé en dur `1`, bug déjà
documenté en commentaire dans le code.)

## 4. Cause racine + localisation précise

**Cause racine (double) :**

1. **Architecture « tout reste monté » + écriture LTP persistante sans garde-fou.**
   Les vues ne sont jamais démontées (`App.tsx:414-420` et `QuickShowView.tsx:1178-1185`
   utilisent `display:none`), donc les seuls points de relâchement fiables sont les
   `release` explicites au changement de mode (`App.tsx:388-390`) — et ils ne couvrent ni
   `simple-desk`, ni `vc`, ni `fixture-test`.

2. **`write`/`writeMerge` sur une source LTP « contrôle » n'est jamais auto-relâché.**
   Le mécanisme de relâche existe (`writeTransient` → `dmx-bridge.ts:86-98`, timer 2 s →
   `release`) mais n'est utilisé que sur les chemins de « stop » explicites. Les chemins
   « jouer / bouger un fader / bouger un slider » écrivent en **persistant** et ne
   relâchent pas.

**Localisation précise du défaut principal (Scénario A) :**
- `src/views/AutoLoopsPanel.tsx:30` — `dmxBridge.write('vc', …)` persistant, boucle active.
- `src/views/AutoLoopsPanel.tsx:119-131` — `stop()` ne relâche `vc` (via `zeroAllUniverses`
  → `writeTransient`) **que si `intervalRef.current` est non nul**, et `stop()` n'est
  déclenché QUE par unmount réel (`:164-168`), changement de `patchKey` (`:158-160`) ou
  clic/`onChange`. **Rien ne l'appelle au changement d'onglet** (`QuickShowView.tsx:1184`
  ne fait que `display:none`).
- `src/views/QuickShowView.tsx:1175-1185` — tab switch sans démontage → l'intervalle de la
  boucle continue → `vc` reste tenu pendant la lecture timeline.

**Localisation précise des défauts secondaires :**
- `src/stores/performStore.ts:285,301,340` — `write('simple-desk')` persistant sans release ;
  seul `:322` est transitoire.
- `src/views/PerformanceView.tsx:2147` — `writeMerge('vc', 1, …)` du slider, sans release.
- `src/hooks/useFixtureTest.ts:96` vs `:103` — release uniquement dans `stopTest`, absent du
  cleanup unmount (`~:107-112`) et du changement de mode (`App.tsx`).

### Correctif recommandé (pour le main agent, non appliqué ici)

- **A (prioritaire)** : dans `QuickShowView`, démonter réellement `AutoLoopsPanel` quand
  `tab !== 'loops'` (render conditionnel `{tab==='loops' && <AutoLoopsPanel/>}`), OU faire
  `stop()` sur changement de `tab` via un effet, OU que `writeFrame` utilise
  `writeTransient('vc', …)`/relâche `vc` quand le panneau n'est plus visible.
- **B** : ajouter `dmxBridge.release('simple-desk')` (et `release('vc')`,
  `release('fixture-test')`) dans `App.tsx` `handleModeChange` à côté de `:388-390`, et/ou
  relâcher `simple-desk` quand on quitte l'onglet Simple Desk.
- **C** : relâcher `vc` à l'arrêt du slider VC / au changement d'onglet Perform, et corriger
  l'univers codé en dur `1` du slider.

B_DONE
