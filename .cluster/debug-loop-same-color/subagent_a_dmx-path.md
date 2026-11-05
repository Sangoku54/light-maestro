# Trace d'écriture DMX — onglet « Loops auto » (QuickShow)

Sous-agent A — analyse lecture seule du chemin d'écriture DMX de la boucle unique.

## VERDICT

**Le chemin d'écriture de la boucle produit bien des RGB DIFFÉRENTS d'une frame à l'autre, et les envoie au hardware — OUI, à condition qu'aucune source LTP ≥ 80 ne les masque.**

En clair :
- La boucle elle-même est **correcte** : elle écrit `'vc'` avec des `channelValues` dont les canaux RGB changent à chaque cue (preuve ligne par ligne ci-dessous), et le mapping d'univers 0-based est cohérent jusqu'au port physique.
- Le bug observé (« toujours la même chose » alors que les blocs affichent des couleurs différentes) n'est **pas** dans la boucle : il vient de l'**arbitrage LTP** (`output-arbiter.ts`). Une source LTP de priorité ≥ 80 **résiduelle et jamais relâchée** (`simple-desk` = 100, `fixture-test` = 90, ou une écriture concurrente `vc` depuis le Virtual Console) fige les canaux RGB et masque la boucle `vc` (80).

---

## 1. Chemin exact de la boucle (preuve que les RGB changent)

### 1a. Les cues ont des couleurs et des temps distincts
`src/engine/theme-loop.ts`
- L54 `for (let beat = 0; beat < totalBeats; beat++)`
- L56 `time: Number((beat * beatSec).toFixed(3))` → temps distinct par beat
- L61 `color: palette[beat % palette.length]` → 4 couleurs cyclées (palette du thème)

⇒ 64 cues (16 mesures × 4 temps) avec `color` ≠ d'un cue à l'autre.

### 1b. `computeDmxCues` écrit le RGB de `cue.color` dans les canaux
`src/hooks/dmx-cues.ts`
- L578 `fa.universeIndex = universeOrder.indexOf(pf.universeId)` → `universe` **0-based** (index dans `universes[]`)
- L694 `const paletteColor = (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined`
- L696-697 `if (fa.rgbOffsets && paletteColor) { let [r, g, b] = hexToRgb(paletteColor); ...`
- L711-713 `channelValues[pf.startAddress + fa.rgbOffsets[0]] = r; ... = g; ... = b;`

⇒ le `channelValues` de chaque cue contient le RGB de sa couleur → **change d'une cue à l'autre**.

### 1c. `writeFrame` pousse chaque frame vers le bridge
`src/views/AutoLoopsPanel.tsx`
- L27 `function writeFrame(dmxs: DmxCue[])`
- L30 `dmxBridge.write('vc', dc.universe, dc.channelValues)`
- L139 `writeFrame(frames[0])` (première frame immédiate)
- L143-146 `setInterval(...) { ... writeFrame(frames[next]) }` (une frame par beat)

### 1d. Le bridge arbitre puis flush vers le hardware
`src/utils/dmx-bridge.ts`
- L65 `write(sourceId, universe, channels)` → L66 `outputArbiter.write(...)`
- L75 `flushToHardware(universe, buffer)`
- L53-57 `flushToHardware` → `api.setChannels(universe, buffer)` (= `ipcRenderer.invoke('dmx:setChannels', ...)`, preload.ts L11-12)

### 1e. L'engine mappe l'index d'univers vers le SAB puis le port
`electron/dmx/engine.ts`
- L848-856 `setChannels(universe, channels)` → L849 `getUniverseByIndex(universe)` → L929 `this.universeOrder[index]` → `entry.sabIndex * DMX_CHANNELS + ch - 1`
- `electron/dmx/worker.ts` : boucle 30 fps, lit le SAB, `postMessage({type:'frameSent'})` → main `handleFrameSent` (engine.ts) → `sendUsbFrame`/`sendArtNetFrame`/`sendSacnFrame`

**Conclusion trace : la boucle écrit des valeurs RGB qui changent à chaque beat, et ces valeurs atteignent le SAB puis le port DMX.**

---

## 2. Mapping d'univers : 0-based, cohérent, PAS d'off-by-one

- Côté renderer : `dc.universe` = `universeOrder.indexOf(pf.universeId)` (`dmx-cues.ts` L578), où `universeOrder = universes.map(u => String(u.id))` (AutoLoopsPanel L~99). `pf.universeId` et `u.id` sont tous deux `string` (`showStore.ts` L26 et L35) → `indexOf` fonctionne.
- Côté engine : `universeOrder` est aligné sur l'ordre de `showStore.universes` via `syncUniverses(configs)` (`App.tsx` `syncUniversesToEngine` L~206-236 → `engine.syncUniverses` qui pose `universeOrder = incomingIds.filter(...)`).

⇒ **index 0 = premier univers du tableau = premier univers du show.** Aucun décalage +1.

Réponse à « un univers index 0 écrit-il l'univers 1 physique ? » :
- **USB-DMX** : chaque univers a son propre dongle/port série (`usbOutputs` par univers, `engine.ts` `startUsbOutput`) — il n'y a **pas de numéro** d'univers physique à mapper ; l'index sélectionne le bon port.
- **Art-Net / sACN** : le numéro physique vient de la **config** (`artnetUniverse` défaut 0, `sacnUniverse` défaut 1), pas d'un `index+1` dans le code. L'index sert uniquement à choisir l'entrée univers, et l'entrée porte son propre numéro configuré.

Donc le mapping index→port est correct. (Seule exception trouvée : voir Bug 4, un `writeMerge('vc', 1, ...)` hardcodé.)

---

## 3. Conflit de sources — LA cause du « toujours la même chose »

Table de priorités (`src/engine/output-arbiter.ts` L35-46) :
- `simple-desk` LTP **100**
- `fixture-test` LTP **90**
- `vc` LTP **80** ← la source de la boucle AutoLoops
- (`midi` 75, `mtc` 72, `osc` 71, `remote` 70 enregistrés dynamiquement dans `midi-actions.ts` — tous **< 80** donc ne masquent pas `vc`)
- `song-preset` HTP 45, `quickshow` HTP 40, etc. (sources « lumière » HTP, masquées par tout LTP)

Arbitrage `getBuffer` (`output-arbiter.ts` L131-196) :
- L147 tri par priorité décroissante
- L154+ les LTP prennent leurs canaux en priorité : **une source LTP plus prioritaire qui détient un canal masque définitivement `vc` sur ce canal.**

### Bug 1 (CRITIQUE) — `simple-desk` jamais relâché en quittant le panneau
`src/stores/performStore.ts`
- L285 `dmxBridge.write('simple-desk', universeNum, uniValues)` (fader individuel)
- L301 `dmxBridge.write('simple-desk', universeNum, uniValues)` (bulk/range)
- L340 `dmxBridge.write('simple-desk', universeNum, sdClipboard)` (coller)
- **Seul** point de relâche : L322 `sdResetAll` → `dmxBridge.writeTransient('simple-desk', ..., allZero)` (auto-release 2 s).

`SimpleDeskPanel` (`PerformanceView.tsx` L~2400+) n'a **aucun cleanup de démontage** qui relâche `simple-desk`. ⇒ Si l'utilisateur a touché ne serait-ce qu'un fader Simple Desk (courant pour tester la sortie DMX), `simple-desk` (100) reste accroché à vie et **fige les canaux** concernés — la boucle `vc` (80) ne peut plus les changer.

### Bug 2 (CRITIQUE) — `fixture-test` non relâché en cas d'unmount en cours de test
`src/hooks/useFixtureTest.ts`
- L96 `dmxBridge.writeMerge('fixture-test', universeIndex, { [address]: value })`
- L103 `dmxBridge.release('fixture-test')` (dans `stopTest`, appelé L158 en fin de séquence)
- L279-285 cleanup d'unmount : annule seulement le RAF + `stoppedRef.current = true`, **sans** `release('fixture-test')`.

⇒ Une navigation pendant le test (l'étape **COLOUR** écrit précisément les canaux RGB, useFixtureTest.ts ~L190-210) laisse une contribution `fixture-test` (90) résiduelle qui **fige les canaux RGB** → « toujours la même couleur ».

### Bug 3 (ÉLEVÉ) — la source `vc` est PARTAGÉE entre AutoLoops et le Virtual Console
`src/views/PerformanceView.tsx` écrit aussi `'vc'` :
- L71 `writeTransient('vc', uniNum, z)` (zero)
- L382 / L406 / L503 `sendChannelsToHardware(..., 'vc')` (scènes)
- L1579 `dmxBridge.write('vc', cue.universe, cue.channelValues)` (AutoScript VC, boucle RAF)
- L1848 / L1928 `sendChannelsToHardware(scaled, ..., 'vc')` (fades)
- L3892 `sendChannelsToHardware(scene.channels, ..., 'vc')` (scène)

Comme les vues restent montées (`display:none`) — commentaire explicite AutoLoopsPanel L164-167 — une scène/chaser VC encore actif écrit `vc` en boucle à la **même priorité (80)** : dernier écrivain gagne, ce qui **écrase ou fige** les couleurs de la boucle AutoLoops.

### Bug 4 (MINEUR) — VC slider écrit un univers hardcodé
`src/views/PerformanceView.tsx` L2147 : `dmxBridge.writeMerge('vc', 1, { [config.channelAddress]: clamped })` → index d'univers **hardcodé `1`** au lieu de l'univers du widget. Sur un show mono-univers (index 0), cette écriture part dans un univers inexistant côté hardware (l'arbitre la stocke quand même à `universe 1`).

---

## Synthèse

| Point tracé | Verdict |
|---|---|
| RGB changent par frame dans la boucle | **OUI** (theme-loop L54-61 → dmx-cues L694-713 → AutoLoopsPanel L30/146) |
| Univers 0-based bien mappé vers le port | **OUI** (dmx-cues L578 = engine L929, ordre aligné par syncUniverses) |
| Hardware reçoit les frames | **OUI** (bridge L57 → engine L848 → worker 30fps) |
| Cause du « toujours pareil » | **Source LTP ≥ 80 résiduelle** : `simple-desk` (100) jamais relâché (performStore L285/301/340, seul L322), `fixture-test` (90) non relâché à l'unmount (useFixtureTest L279-285), ou `vc` concurrent depuis le Virtual Console (PerformanceView L1579 etc.) |

A_DONE
