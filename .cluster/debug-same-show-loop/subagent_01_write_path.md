# Revue chemin d'écriture DMX — Boucles d'ambiance (AutoLoopsPanel)

## VERDICT : **write path OK (aucune perte trouvée)**

Le chemin d'écriture `dmxBridge.write('vc', universe, channelValues)` (appelé chaque frame par `fire()`) et `dmxBridge.writeTransient('vc', universe, zeros)` (le STOP) empruntent **exactement le même code de flush vers le hardware**. Il n'existe **aucune** branche qui fasse perdre silencieusement `write()` tout en laissant passer `writeTransient()`. Par conséquent le bug « le même show est joué sur toutes les boucles » ne peut pas venir de ce chemin : il est **en amont** (génération des cues), pas dans l'écriture.

---

## 1. Traçage du chemin complet (avec lignes exactes)

### a) La boucle de lecture (renderer)
`src/views/AutoLoopsPanel.tsx`
- L275 `const fire = () => { ... }`
- L288 `try { dmxBridge.write('vc', cue.universe, cue.channelValues); } catch {}`
- L291 `rafRef.current = requestAnimationFrame(fire);`

`fire()` avance le temps (`performance.now()`), déduplique par `cue.time`/`cue.universe`, et écrit chaque cue une seule fois via `dmxBridge.write('vc', …)`. Logique correcte.

### b) Le bridge (renderer)
`src/utils/dmx-bridge.ts`
- L65-76 `write()` :
  ```
  if (!outputArbiter.write(sourceId, universe, channels)) return;  // L66
  cancelTransient(sourceId);                                       // L69
  const buffer = outputArbiter.getBuffer(universe);                // L70
  pushBufferToConsumers(universe, buffer);                         // L71
  recordOutputTick();                                              // L74
  flushToHardware(universe, buffer);                               // L75
  ```
- L86-99 `writeTransient()` :
  ```
  if (!outputArbiter.write(sourceId, universe, channels)) return;  // L87
  const buffer = outputArbiter.getBuffer(universe);                // L88
  pushBufferToConsumers(universe, buffer);                         // L89
  recordOutputTick();                                              // L90
  flushToHardware(universe, buffer);                               // L91
  cancelTransient(sourceId);                                       // L92
  transientTimers.set(sourceId, setTimeout(() => { ... this.release(sourceId); }, ms)); // L93-96
  ```

**Preuve clé :** les deux méthodes exécutent la même séquence `getBuffer → pushBufferToConsumers → recordOutputTick → flushToHardware`, avec le **même buffer arbitré**. La seule différence est `cancelTransient()` (avant vs après, simple `clearTimeout`, sans effet sur le flush) et le timer de `release()` transitoire (2 s) que seul `writeTransient()` pose. Aucune de ces différences n'affecte la sortie immédiate.

- L53-58 `flushToHardware()` :
  ```
  if (_dryRun) return;                    // gate dry-run
  const api = getDmxApi();
  if (!api) return;
  api.setChannels(universe, buffer).catch(() => {});
  ```

### c) L'arbitre (renderer, pur)
`src/engine/output-arbiter.ts`
- L38 `'vc': { mode: 'ltp', priority: 80 }` — source enregistrée à la construction (L66-68), jamais unregistered (aucun appel `unregisterSource` dans le code).
- L91-106 `write(id, universe, channels)` — remplace (ne merge pas) les valeurs de la source ; clamp chaque canal ; accepte `ch >= 0`.
- L131-176 `getBuffer(universe)` — fast path L136-139 : si une seule source, retourne ses valeurs telles quelles.

### d) IPC renderer → main
`electron/preload.ts` (début du fichier) :
```
setChannels: (universe, channels) => ipcRenderer.invoke('dmx:setChannels', universe, channels),
```
**Aucun throttle / debounce.** Chaque `write()` déclenche un `invoke` direct.

`electron/main.ts`
- L400-403 `ipcMain.handle('dmx:setChannels', …)` :
  ```
  if (!dmxEngine.isRunning()) { try { await dmxEngine.start(); } catch {} }
  dmxEngine.setChannels(universe, channels);
  ```

### e) Le moteur (main) → SAB → worker → hardware
`electron/dmx/engine.ts`
- L848-857 `setChannels(universe, channels)` :
  ```
  const entry = this.getUniverseByIndex(universe);      // L849
  if (!entry || this.blackoutState) return;             // L850
  const baseOffset = entry.sabIndex * DMX_CHANNELS;     // L851
  for (const [ch, val] of Object.entries(channels)) {   // L852
    const chNum = typeof ch === 'string' ? parseInt(ch, 10) : ch; // L853
    if (chNum < 1 || chNum > DMX_CHANNELS) continue;    // L854
    this.channelView[baseOffset + chNum - 1] = …;       // L855
  }
  ```
- L928-932 `getUniverseByIndex(index)` = `this.universes.get(this.universeOrder[index])`.

Le worker (`electron/dmx/worker.ts`) lit le SAB à 30 fps et notifie `frameSent` ; `handleFrameSent()` (engine.ts) envoie vers USB/Art-Net/sACN.

---

## 2. Vérification point par point (les 7 items demandés)

| # | Item | Constat | Verdict |
|---|---|---|---|
| 1 | Arbitrage LTP/HTP + priorité 'vc' | `'vc'` = **ltp, priority 80** (output-arbiter.ts L38). Bat `quickshow`(40)/`song-preset`(45)/`rgb-matrix`(30). Battu par `simple-desk`(100)/`fixture-test`(90)/`design-efx`(70). | OK |
| 2 | Mapping index d'univers → univers hardware | Renderer passe `universe=0` (diag `uni0=0`). Engine : `getUniverseByIndex(0)` → `universeOrder[0]`. **Même mapping pour write() et writeTransient().** | OK (fragilité latente, cf. §4) |
| 3 | Fusion getBuffer (Record adresse→valeur) | `getBuffer` renvoie `Record<number,number>`, adresses 1-based (clés = `pf.startAddress + offset`, confirmé dans `dmx-cues.ts`). Fast path mono-source = renvoi direct. | OK |
| 4 | Throttle / flush | **Aucun throttle** dans preload ; `invoke` direct par frame ; worker 30 fps. | OK |
| 5 | Gate dryRunMode | `_dryRun` (dmx-bridge.ts L27) bloquerait le flush (L54). Mais il bloque **aussi** writeTransient. STOP fonctionnant ⇒ `_dryRun === false`. | OK |
| 6 | Enregistrement de 'vc' | Présent dans `DEFAULT_SOURCES`, enregistré à la construction. Aucun `unregisterSource`. | OK |
| 7 | write() vs writeTransient() | Séquence de flush **byte-identiques** (voir §1b). Différence = `cancelTransient` + timer `release` (transitoire) uniquement. | OK |

---

## 3. Pourquoi write() NE PEUT PAS être perdu si writeTransient() fonctionne

- Les deux entrées sortent par `flushToHardware(universe, buffer)` (dmx-bridge.ts L75 vs L91), avec le **même** `buffer = outputArbiter.getBuffer(universe)`.
- `flushToHardware` ne dépend que de `_dryRun` et de `getDmxApi()` — deux conditions **identiques** pour les deux appels au même instant.
- `outputArbiter.write('vc', …)` retourne `false` uniquement si la source n'est pas enregistrée ; `'vc'` l'est toujours (L38, L66-68). Donc ni `write()` ni `writeTransient()` ne passent par le `return` anticipé L66/L87 pour `'vc'`.
- Le diagnostic runtime confirme déjà que le STOP (writeTransient zeros) éteint le matériel réel ⇒ le flush « renderer → IPC → SAB → worker → hardware » est fonctionnel. Le même mécanisme transporte donc les valeurs non-nulles de `fire()`.

**Conclusion :** aucune perte silencieuse n'est possible dans ce chemin. Si le matériel affiche « le même show » pour toutes les boucles alors que `cue0` est pourtant calculé correctement pour la boucle sélectionnée, la cause est que **toutes les boucles produisent en réalité les mêmes cues** (bug en amont dans `generateAmbianceLoops` / `buildLoop` / `computeDmxCues` / `computeLoopDmxCues`), et non un problème d'écriture. Le diag actuel ne montre que `cue0` de la boucle *sélectionnée* : il prouve que `cue0` est **interne varié** (magenta/jaune répartis par fixture) mais **ne prouve pas** que `cue0` diffère **entre** boucles. C'est la piste à creuser côté génération.

---

## 4. Observations secondaires (fragilités, NON bloquantes pour ce bug)

1. **`setChannels` n'écrit que les canaux présents, sans zéro-fill** (engine.ts L852-856). Les canaux absents d'un cue gardent leur valeur précédente dans le SAB. C'est cohérent avec le design arbitré (le bridge envoie le buffer complet de l'univers), mais attention : le fast-path `getBuffer` (output-arbiter.ts L136-139) renvoie **par référence** l'objet interne de la source. Sans danger ici (l'arbitre remplace, ne mute pas), mais à surveiller si un futur code mute le retour.

2. **Mapping index d'univers fragilisé** : le renderer indexe par position dans `universes[]` (indice 0 = 1er élément du tableau du store), et l'engine indexe par position d'insertion dans `universeOrder` (`addUniverse`/`syncUniverses`). Si l'ordre des univers du store diffère de l'ordre d'insertion côté engine, l'univers 0 du renderer ne pointerait pas sur le même univers hardware. Ce serait le même défaut pour write() ET writeTransient(), donc pas le différenciateur de ce bug — mais c'est un terrain glissant à vérifier si un jour les univers ne sont plus dans le même ordre des deux côtés.

3. **`outputArbiter.write` accepte `ch = 0`** (L94 : `if (ch < 0) continue`), tandis que `engine.setChannels` rejette `chNum < 1` (L854). Un canal d'adresse 0 serait donc stocké par l'arbitre puis silencieusement ignoré par le moteur. Les cues utilisent des adresses 1-based (`startAddress + offset`), donc sans impact pratique — à documenter.
