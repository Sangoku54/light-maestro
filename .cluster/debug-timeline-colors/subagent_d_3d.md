# Diagnostic — « toujours la même couleur » : 3D figée ou DMX réel faux ?

## 1. VERDICT

Il y a **deux chemins de lecture différents** dans le code, qui donnent deux réponses différentes. C'est la clé du bug.

- **Chemin A — lecture timeline QuickShow (TrackTimeline joué via `useDmxPlayback`) :** le miroir vers le store **existe** (dmx-playback.ts:1103 + 1107). La 3D **n'est pas** figée par un miroir manquant. Store et hardware reçoivent le **même** `chVals` chaque frame (store throttlé à ~30 fps, hardware à 60 fps). Dans ce chemin, « toujours la même couleur » en 3D **ET** sur le hardware = **le DMX émis est réellement faux** (même couleur calculée en amont).

- **Chemin B — lecture « Show » (ShowManager, timeline de scènes/chasers, DesignView) :** ce chemin écrit **uniquement au bridge** via `sendChannelsToHardware(..., 'show-manager')` (dmx-helpers.ts:82-83), **sans AUCUN miroir store**. Le hardware reçoit la bonne couleur qui change, mais `appStore.dmx.channelData` n'est jamais mis à jour → **Stage3D figé pendant que le hardware est correct**. C'est exactement l'hypothèse 1.

- **Vecteur de divergence n°3 (arbitrage LTP/HTP) :** même dans le chemin A, le **hardware** reçoit le buffer **arbitré** (`outputArbiter.getBuffer`, dmx-bridge.ts:71), alors que le **store** reçoit le `chVals` **brut** de la source `quickshow`/`song-preset` (dmx-playback.ts:1103). Si une source LTP résiduelle (`vc` p80, `simple-desk` p100, `design-efx` p70, `design-test`/`fixture-onoff` p60, `fixture-test` p90, `default` p50) garde des canaux couleur, le **hardware** est épinglé sur sa couleur (figé) pendant que la **3D** suit le moteur (change). Là c'est l'inverse : **DMX réel faux (hardware figé), 3D correcte**.

**Conclusion pratique :** il faut d'abord savoir QUEL lecteur tourne. Si c'est le show timeline (ShowManager/DesignView), la 3D est figée à cause du miroir manquant. Si c'est le QuickShow/TrackTimeline, le miroir existe et c'est le calcul DMX qui est en cause.

---

## 2. CHEMIN EXACT valeur → cache → 3D → hardware (numéros de ligne)

### Émission (moteur de lecture, `src/hooks/dmx-playback.ts`)
1. Le moteur calcule `chVals: Record<number,number>` par universe/frame (boucle `analysis.byUniverse`, ~l.708 ; écriture RGB ~l.799-810, wheel ~l.818-821).
2. Frame principale (l.1093-1110) :
   - `if(sig!==lastSig)` (dédoublonnage de frames identiques, l.1098).
   - `if(now-lastStoreUpdate>33){ useAppStore.getState().setUniverseData(uniIdx, chVals); ... }` → **miroir store, throttlé ~30 fps** (l.1100-1103).
   - `dmxBridge.push(uniIdx, chVals, arbSource)` → **hardware, chaque frame** (l.1107).
   - `onVirtualDmx(uniIdx, chVals)` (l.1108) — doublon du miroir (QuickShowView le rebranche sur `setUniverseData`, QuickShowView.tsx:2277-2279).

### Bridge (`src/utils/dmx-bridge.ts`)
3. `push()` (l.105-107) → `write(sourceId, universe, channels)` (l.65).
4. `write` (l.65-76) :
   - `outputArbiter.write(...)` (l.66) — stocke la contribution de la source.
   - `getBuffer(universe)` (l.71) → buffer arbitré.
   - `pushBufferToConsumers` (l.72) → **met à jour le cache module `_channelCache`** (l.44-51, `_channelCache.set` l.46) + notifie les listeners (`onPush`, l.48-50).
   - `flushToHardware` (l.75) → `api.setChannels(universe, buffer)` (l.57) → IPC → `dmxEngine.setChannels` (electron/main.ts:400-402, engine.ts:848) → SharedArrayBuffer.

**Important :** `_channelCache` (l.23) est bien mis à jour **à chaque frame** de playback (via `write`→`pushBufferToConsumers`). Mais **personne ne le lit pour la 3D** : voir §3.

### Arbitre (`src/engine/output-arbiter.ts`)
5. `write(id, universe, channels)` (l.91-106) : nettoie/clamp puis **`uni.set(id, clean)` (l.105) — remplace TOUTE la contribution de la source** (pas un merge).
6. `getBuffer(universe)` (l.131-177) :
   - Fast path 1 source (l.136-140) : retourne la contribution brute.
   - Sinon tri par priorité (l.143-150), LTP « prend » les canaux (l.152-160), HTP fait le max (l.161-168), fusion finale (l.170-172).
   - Sources canoniques : `DEFAULT_SOURCES` (l.34-47) — `quickshow` htp p40, `song-preset` htp p45, `show-manager` htp p35 ; LTP : `simple-desk` p100, `fixture-test` p90, `vc` p80, `design-efx` p70, `design-test`/`fixture-onoff` p60, `default` p50.

### Store (`src/stores/appStore.ts`)
7. `setUniverseData(universe, values)` (l.398-414) :
   - récupère/`crée` un `Uint8Array(512)` (l.400-407), **réutilise le même buffer** (mutation in-place, l.405-406),
   - n'écrit **que les clés présentes dans `values`** (boucle l.408-411) — **sémantique merge/update, PAS replace**,
   - `set({ dmx: {...dmx, channelData: {...raw, [universe]: data} } })` (l.414).

### Lecture 3D (`src/views/Stage3D.tsx`)
8. `animate()` (l.1000-1041) appelle `updateDmxState()` à chaque frame (l.1034-1036, `DMX_POLL_INTERVAL = 1000/60` l.51).
9. `updateDmxState` (l.1485) lit **le store** :
   - `const dmxState = useAppStore.getState().dmx;` (l.1486)
   - `channelData = dmxState.channelData` (l.1487)
   - `rawData = channelData[f3d.universeIndex]` (l.1498).
10. Couleur : si `cm.rgbOffsets` → lit R/G/B (l.1590-1595) ; sinon `cm.wheelOffset` → `wheelValueToColor` (l.1596-1598).
11. `f3d.universeIndex` est l'index 0-based dans la liste des univers (`universeIndexMap.get(fixture.universeId)`, l.389-392 et l.723) — **cohérent** avec `uniIdx` du moteur (`uniIds.indexOf(pf.universeId)`, dmx-playback.ts:399-401).

---

## 3. OÙ ÇA PEUT SE FIGER (et comment trancher 3D vs hardware)

**(a) Stage3D lit le STORE, pas le bridge.** `dmxBridge.getChannels()` (dmx-bridge.ts:168-170) et `dmxBridge.onPush()` (l.173-176) **n'ont AUCUN consommateur** (grep sur tout `src/` : seuls dmx-bridge.ts les définit). Le cache `_channelCache` est donc mis à jour pour rien côté 3D. La 3D dépend **à 100 %** de `appStore.dmx.channelData`.

**(b) Toutes les écritures DMX ne miroitent PAS le store.** Inventaire des writers :
- **miroir store présent** : moteur `useDmxPlayback` (dmx-playback.ts:460/474/485/601/619/1103), `sendChannelsToHardwareAndStore` (dmx-helpers.ts:171), `sendFixtureOn/Off` (dmx-helpers.ts:214/238).
- **bridge ONLY, sans miroir store** :
  - **ShowManager** (timeline show) → `sendChannelsToHardware(..., 'show-manager')` (ShowManager.tsx:138/233/256/346), qui appelle `dmxBridge.write` (dmx-helpers.ts:82-83) **sans** `setUniverseData`.
  - Simple Desk (`performStore.ts:285/301/322/340` → `dmxBridge.write('simple-desk', ...)`).
  - VC / AutoLoops (`AutoLoopsPanel.tsx:30/50`, `PerformanceView.tsx:71/1579/2147` → `'vc'`).
  - RGB matrix (`rgb-matrix-playback.ts:184`), fixture-test (`useFixtureTest.ts:96`), MIDI (`midi-actions.ts:747`), design-efx (`DesignView.tsx:3325/3461/3487`), song-preset zero (`SongPresetPlayer.tsx:53`).
  - **Freeze** du moteur : `dmxBridge.push` **sans** `setUniverseData` (dmx-playback.ts:556).

→ Si un de ces writers bridge-only est actif pendant que la 3D est regardée, **la 3D garde la dernière valeur du store (figée) alors que le hardware reçoit la bonne valeur**. C'est le mécanisme le plus probable du symptôme « toujours la même couleur » **en 3D**.

**(c) Le throttle 30 fps n'est PAS un gel.** dmx-playback.ts:1100-1103 limite le store à ~30 fps (contre 60 fps pour le push l.1107). C'est cosmétique (pas un freeze), mais ça introduit un léger décalage 3D/hardware.

**(d) Divergence de sémantique store vs arbitre.** `setUniverseData` est **merge** (n'écrit que les clés de `values`, appStore.ts:408-411) alors que `outputArbiter.write` est **replace** par source (`uni.set(id, clean)`, output-arbiter.ts:105). Quand un canal sort du `chVals` du moteur (ex. `paletteColor` devient `undefined` → RGB non écrit, dmx-playback.ts:799), le store garde l'ancienne couleur pendant que le buffer arbitré ne l'émet plus. (NB : le hardware `engine.setChannels` ne remet pas non plus les canaux absents à zéro — engine.ts:848-857 — donc store et hardware restent globalement cohérents **en mono-source** ; la vraie divergence vient de l'arbitrage multi-sources, point (e).)

**(e) Arbitrage LTP/HTP = divergence hardware vs 3D.** Le hardware reçoit `getBuffer()` (arbitré), le store reçoit le `chVals` brut de la source moteur. Si une source LTP résiduelle possède les canaux couleur (Simple Desk, VC, design, fixture-test, `default`), `getBuffer` la fait gagner (output-arbiter.ts:152-160) → **hardware épinglé (figé), 3D qui change**. C'est le mécanisme inverse de (b).

**(f) La table de canaux couleur est la même des deux côtés.** `analyzeChannels` (utilisé par le moteur, dmx-playback.ts:272/397) est un alias de `analyzeFixtureChannels` (fixture-analyzer.ts:283-285), qui est ce que Stage3D utilise (`analyzeFixtureChannels`, Stage3D import l.25). Donc `rgbOffsets`/`wheelOffset`/`rgbSegments` sont identiques des deux côtés → **pas de bug de mapping de canal** ici.

---

## 4. CAUSE RACINE (si trouvée)

Pas une cause unique, mais un **défaut d'architecture du miroir** :

- **Stage3D dépend exclusivement du store** (`appStore.dmx.channelData`, Stage3D.tsx:1486-1498), mais **plusieurs chemins d'écriture DMX n'écrivent que le bridge** (ShowManager `show-manager`, Simple Desk, VC, design-efx, MIDI, fixture-test, rgb-matrix) via `dmxBridge.write` sans `setUniverseData` (dmx-helpers.ts:82-83, performStore.ts, AutoLoopsPanel.tsx, etc.).
- Conséquence : dès qu'un de ces chemins est actif (ou a laissé une source LTP résiduelle), **la 3D et le hardware se désynchronisent** — la 3D se fige sur la dernière valeur du store, ou le hardware se fige sur la source LTP.
- Le miroir du moteur de lecture QuickShow est **incomplet** : throttlé à ~30 fps (dmx-playback.ts:1100-1103) et en **sémantique merge** (appStore.ts:408-411) contrairement au replace de l'arbitre (output-arbiter.ts:105).

**Recommandation de fix ciblé (pour l'enquêteur, pas appliqué ici) :**
1. Faire de `pushBufferToConsumers` (dmx-bridge.ts:44-51) le **point unique de vérité** : y ajouter `useAppStore.getState().setUniverseData(universe, buffer)` pour que la 3D reflète le buffer **arbitré** (pas le chVals brut), et que **toutes** les sources (moteur, ShowManager, Simple Desk, VC, design, MIDI…) miroitent automatiquement.
2. Remplacer la sémantique merge de `setUniverseData` par un remplacement complet (écrire les 512 canaux, ou au moins zéro les canaux absents du buffer) pour ne jamais garder de valeur périmée en 3D.
3. Supprimer/limiter le throttle 33 ms qui décale la 3D du hardware.

D_DONE
