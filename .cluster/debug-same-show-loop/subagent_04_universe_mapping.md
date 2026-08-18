# Sub-agent 04 — Mapping d'univers renderer → engine → hardware

## VERDICT : mapping OK (univers 0 = "universe-1" confirmé, sabIndex=0)

Le chaînage d'univers est **cohérent de bout en bout** pour le cas « une seule
universe `universe-1` ». `getUniverseByIndex(0)` renvoie bien l'entrée de
`"universe-1"` avec `sabIndex = 0`, et le write atterrit bien dans le **bon bloc
SAB** (offset 0). Aucun scénario opérationnel (auto-création, sync, ordre
d'insertion) ne fait pointer `universeOrder[0]` vers autre chose **dans le cas à
une seule universe**. → **Ce n'est PAS la cause du bug** « même show sur toutes
les boucles ». Le suspect restant est en aval : arbitrage LTP (`output-arbiter`)
ou visualisation 3D (`Stage3D`).

---

## 1. La chaîne complète (renderer → engine → hardware)

### Renderer : calcul de l'index d'univers
- `src/views/AutoLoopsPanel.tsx:244` — `const universeIds = universes.map((u) => u.id);`
  où `universes = useShowStore((s) => s.universes)` (ordre du store).
- `src/views/AutoLoopsPanel.tsx:254` — `computeLoopDmxCues(loop, patchedFixtures, defs, universeIds)`.
- `src/hooks/dmx-cues.ts:584` — `const universeOrder = options.universeIds && options.universeIds.length > 0 ? options.universeIds : …`
  → l'ordre d'univers **est** l'ordre du store (même tableau, même ordre).
- `src/hooks/dmx-cues.ts:599-600` — `fa.universeIndex = universeOrder.indexOf(pf.universeId); if (fa.universeIndex < 0) fa.universeIndex = 0;`
  Avec `pf.universeId === "universe-1"` et `universeIds === ["universe-1"]` → `universeIndex = 0`.
- `src/hooks/dmx-cues.ts:975` — le cue est poussé avec `universe` = la clé numérique
  de `fixturesByUniverse` (donc `0`).

### Renderer : émission
- `src/views/AutoLoopsPanel.tsx:299` — `dmxBridge.write('vc', cue.universe, cue.channelValues)` → `write('vc', 0, …)`.
- `src/utils/dmx-bridge.ts:65-75` — `write()` → `outputArbiter.write('vc', 0, channels)` → `outputArbiter.getBuffer(0)` → `flushToHardware(0, buffer)`.
- `src/utils/dmx-bridge.ts:53-57` — `flushToHardware` → `api.setChannels(0, buffer)`.
  L'arbiter (`output-arbiter.ts`) n'opère **aucune ré-écriture d'index** : l'univers
  est un nombre brut (0), transmis tel quel.

### IPC
- `electron/preload.ts:10` — `setChannels: (universe, channels) => ipcRenderer.invoke('dmx:setChannels', universe, channels)`.
- `electron/main.ts:400-402` — handler `dmx:setChannels` → `dmxEngine.setChannels(universe, channels)`.

### Engine : résolution index → univers → bloc SAB
- `electron/dmx/engine.ts:848-855` — `setChannels(0, …)` → `const entry = this.getUniverseByIndex(0)` puis `const baseOffset = entry.sabIndex * DMX_CHANNELS`.
- `electron/dmx/engine.ts:928-931` — `getUniverseByIndex(index)` :
  ```
  const id = this.universeOrder[index];   // L929
  return this.universes.get(id);          // L931
  ```
  Avec `universeOrder = ["universe-1"]` → `id = "universe-1"` → `entry` (dont `sabIndex = 0`).

---

## 2. Pourquoi `sabIndex` est bien 0 (et pourquoi son découplage de `universeOrder` est sûr)

- `electron/dmx/engine.ts:67-70` — `universeOrder: string[] = []`, `nextSabIndex = 0`, `freeSabIndices: number[] = []`.
- `electron/dmx/engine.ts:655` — `const sabIndex = this.freeSabIndices.length > 0 ? this.freeSabIndices.pop()! : this.nextSabIndex++;`
  Première universe ajoutée sur un moteur vide → `sabIndex = 0`.
- `electron/dmx/engine.ts:658` — `this.universeOrder.push(config.id)` (ordre d'insertion).
- `electron/dmx/engine.ts:688` — `syncUniverses` réécrit l'ordre : `this.universeOrder = incomingIds.filter(id => this.universes.has(id))`.

**Point clé** : `sabIndex` et la position dans `universeOrder` sont **deux
mécanismes indépendants**. Mais ce n'est **pas un bug**, car :
- `getUniverseByIndex(index)` résout `index → id → entry` (L929→L931), et lit
  le `sabIndex` **de cette entrée** ;
- tous les chemins d'écriture/lecture du SAB utilisent ce même `entry.sabIndex` :
  - écriture : `baseOffset = entry.sabIndex * DMX_CHANNELS` (`engine.ts:851`, idem `:863`, `:875`) ;
  - sortie : `const offset = entry.sabIndex * DMX_CHANNELS` (`engine.ts:546`, boucle `handleFrameSent`) ;
  - lecture diagnostic : `getUniverseData`/`getAllData` utilisent `entry.sabIndex * DMX_CHANNELS`.

Donc, même si un `sabIndex` était recyclé (`freeSabIndices`, L697) ou découplé de la
position, l'univers est **toujours** écrit/lu dans **son** bloc, jamais dans un
bloc d'une autre universe. Aucune corruption de cible possible par ce biais.

---

## 3. Comment l'ordre store ↔ engine est maintenu identique

- `src/App.tsx:207-221` — `syncUniversesToEngine(universes)` mappe le store →
  `configs` **dans l'ordre du store**, puis `api.syncUniverses(configs)` (L218-219).
- `src/App.tsx:231` — effet débouncé 150 ms sur `showUniverses` : `setTimeout(() => syncUniversesToEngine(showUniverses), 150)`.
- `src/App.tsx:283` — appel explicite au chargement d'un projet : `syncUniversesToEngine(data.showStore.universes)`.
- `electron/main.ts:418` — `dmx:syncUniverses` → `dmxEngine.syncUniverses(configs)`.
- `electron/dmx/engine.ts:675-688` — `syncUniverses` : supprime les absentes, ajoute/met à jour,
  puis **réécrit `universeOrder` exactement dans l'ordre du tableau reçu**.

⇒ L'index renderer (position dans `universes[]`) et `universeOrder[]` du moteur sont
**toujours alignés** parce qu'ils dérivent du même tableau (`showStore.universes`).

Auto-création (`DesignView` fresh-install) :
- `src/views/DesignView.tsx` (≈L4050-4090) — si le store est vide, tente
  `window.lightMaestro.dmx.getUniverses()` puis, sinon, crée `'universe-1'` via
  `addShowUniverse` + `window.lightMaestro.dmx.addUniverse`. La universe est donc
  **déjà dans le store**, et l'effet `App.tsx:231` la re-synchronise (`syncUniverses`)
  → ordre cohérent.

---

## 4. Scénarios où `universeOrder[0]` ≠ `"universe-1"` — analyse

Aucun ne s'applique au bug courant (une seule universe) :

1. **Moteur déjà peuplé dans un ordre différent + `syncUniverses` jamais appelé.**
   Impossible en pratique : le moteur démarre **vide** à chaque lancement (état en
   mémoire uniquement) ; l'ordre n'est injecté que par `syncUniverses`/`addUniverse`
   depuis le renderer, qui est l'unique source d'autorité.

2. **Race 150 ms (débounce `App.tsx:231`).** Fenêtre où le moteur peut être vide si
   l'utilisateur joue une boucle < 150 ms après un changement d'univers. Conséquence :
   `getUniverseByIndex(0)` renvoie `undefined` → `setChannels` fait un **early-return**
   (`engine.ts:849-850`) → **aucune sortie**, pas une mauvaise cible. Non reproductible
   comme « même show sur toutes les boucles ».

3. **`getUniverseConfigs()` retourne l'ordre d'INSERTION de la Map, pas `universeOrder`.**
   `electron/dmx/engine.ts:718-719` — `Array.from(this.universes.values()).map(u => u.config)`.
   C'est une **asymétrie réelle** (ordre de Map vs `universeOrder`), mais elle ne joue
   que si `DesignView.ensureUniverse` lit `dmxUniverses[0]` **avec un moteur multi-universe
   déjà peuplé** au boot — or le moteur est vide au boot (`getUniverses()` → `[]` → fallback
   `'universe-1'`). Non applicable ici.

4. **Multi-universe avec ordre store ≠ ordre d'insertion moteur.** `syncUniverses` (L688)
   corrige l'ordre à chaque sync. Le seul risque serait un chemin qui écrit via un index
   **sans** que `syncUniverses` n'ait encore tourné — fenêtre couverte par la race 150 ms
   (point 2), qui produit « pas de sortie », pas « mauvaise universe ».

---

## 5. Conclusion pour la chasse au bug

- **Mapping d'univers : exclu.** `universe=0` pointe vers `"universe-1"` / `sabIndex=0`,
  chaîne vérifiée ligne par ligne. Les 3 boucles différentes écrivent leurs `channelValues`
  variés dans le **bon** bloc SAB.
- Comme le diagnostic runtime prouve déjà que les `channelValues` sont variés et corrects,
  et que le mapping d'univers est correct, les suspects restants sont :
  1. **Arbitrage LTP** (`src/engine/output-arbiter.ts`) — la source `'vc'` est LTP priority 80
     (L80 du fichier), et `zeroAllUniverses()` (`AutoLoopsPanel.tsx:43-54`) écrit en
     `writeTransient('vc', …)` avec libération à 2 s ; une persistance/staleness du buffer
     `'vc'` ou une interaction `stopPlay()/playLoop()` peut écraser les couleurs d'une boucle
     par celles d'une autre.
  2. **Visualisation 3D** (`Stage3D`) — le cache `_channelCache` de `dmx-bridge.ts` est lu
     par `getChannels(universe)` ; si la 3D lit un cache non remis à jour, elle affiche le même
     rendu pour toutes les boucles alors que le hardware reçoit des valeurs différentes.

Recommandation : concentrer l'enquête suivante sur le cycle de vie de la source `'vc'`
dans l'arbiter (write/persist/release/transient) et sur le refresh du cache 3D.
