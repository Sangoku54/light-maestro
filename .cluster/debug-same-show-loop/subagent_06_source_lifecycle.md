# Sub-agent 06 — Cycle de vie des sources DMX (révision indépendante)

## VERDICT

> **OUI, `simple-desk` peut rester active (valeurs non relâchées) et ÉCRASER `vc`**,
> sur chaque canal qu'elle détient, à chaque frame arbitrée par
> `OutputArbiter.getBuffer()` (`src/engine/output-arbiter.ts`).
>
> **C'est le coupable principal et persistant du bug** « même show sur toutes les
> boucles d'ambiance » : `simple-desk` = LTP priority **100** > `vc` priority **80**,
> et RIEN ne la relâche au changement d'onglet ou de mode.
>
> **Secondairement** : `fixture-test` (LTP priority **90**) peut aussi écraser `vc`
> pendant qu'un test de fixture tourne (~8,8 s), car elle n'est relâchée que par
> `stopTest()`, jamais au changement d'onglet/mode.
>
> **Il n'existe AUCUN `releaseAll`/`clearAll` global.** Le bridge ne sait relâcher
> qu'une source à la fois (`dmxBridge.release(sourceId, universe?)`).

---

## 1. Qui écrit `simple-desk` ? (priority 100, LTP)

Écrit **de façon persistante** dans `src/stores/performStore.ts` (le Simple Desk
est rendu par `SimpleDeskPanel` dans `PerformanceView.tsx`, onglet « Simple Desk »
du mode Perform) :

| Ligne | Appel | Effet |
|------|-------|-------|
| `performStore.ts:289` | `dmxBridge.write('simple-desk', universeNum, uniValues)` | fader unitaire → **persistant** |
| `performStore.ts:305` | `dmxBridge.write('simple-desk', universeNum, uniValues)` | faders en masse (shift+glisser) → **persistant** |
| `performStore.ts:344` | `dmxBridge.write('simple-desk', universeNum, sdClipboard)` | coller l'univers → **persistant** |
| `performStore.ts:326` | `dmxBridge.writeTransient('simple-desk', universeNum, allZero)` | **reset explicite uniquement** → relâche après 2 s |

`write()` = `outputArbiter.write()` qui **remplace** la contribution de la source
sur l'univers et la **conserve indéfiniment** jusqu'à un `release()`.

### Le `release('simple-desk')` n'existe nulle part

Recherche exhaustive : le seul `release` lié à simple-desk est le timer interne de
`writeTransient` (reset). **Aucun code ne relâche `simple-desk`** quand l'utilisateur
quitte le Simple Desk, change d'onglet ou change de mode.

---

## 2. Le « release au changement d'onglet » n'existe pas (ou est incomplet)

`src/App.tsx:385-395` — `handleModeChange` (appelé par le TopBar au changement de
mode) :

```ts
const handleModeChange = useCallback((newMode: AppMode) => {
  if (newMode !== 'design') {
    dmxBridge.release('design-test');   // App.tsx:391
    dmxBridge.release('design-efx');    // App.tsx:392
    dmxBridge.release('fixture-onoff'); // App.tsx:393
  }
  setMode(newMode);
}, [setMode]);
```

→ Ne relâche que 3 sources « design ». **`simple-desk` et `fixture-test` ne sont
jamais relâchées ici.**

Le changement d'onglet *dans* un mode passe par `setSidebarTab()` (`Sidebar.tsx`),
qui ne fait que modifier une clé d'état — **aucune écriture DMX, aucun release**.

Enfin, `App.tsx` garde les 3 vues **montées** (`display:none`) :

```tsx
<div style={{ display: mode === 'quick' ? 'flex' : 'none' }} ...>
```

donc `SimpleDeskPanel` / `DesignView` ne se **démontent** jamais au changement de
mode : `sdChannelValues` (mémoire) et la contribution arbiter `simple-desk` survivent.

---

## 3. `fixture-test` (priority 90, LTP) — peut aussi persister (secondaire)

`src/hooks/useFixtureTest.ts` :

- `:96` `dmxBridge.writeMerge('fixture-test', universeIndex, { [address]: value })`
  → écrit en continu pendant le test (bouton « Test fixture » du panneau fixtures
  de `DesignView`, via `PatchedFixtureList`).
- `:99-103` `stopTest()` appelle `dmxBridge.release('fixture-test')` — mais **seulement**
  quand l'utilisateur clique « Stop » ou quand la séquence se termine (~8,8 s,
  `tick` → `stopTest()` à `:158`).
- `:278-285` cleanup d'unmount : **ne fait AUCUN `release('fixture-test')`**
  (`stoppedRef.current = true; cancelAnimationFrame(...)` seulement).

Conséquences :
1. Si un test tourne et que l'utilisateur bascule sur « Boucles d'ambiance », le
   RAF continue (vue masquée mais montée) → `fixture-test` écrase `vc` sur les
   canaux de la fixture testée pendant toute la durée restante du test.
2. Le défaut « unmount sans release » est masqué en pratique par le fait que les
   vues ne se démontent pas au changement d'onglet ; il ne se manifesterait qu'à la
   fermeture de l'app (où l'arbiter meurt de toute façon).

→ `fixture-test` est **auto-limitée dans le temps** (~8,8 s), contrairement à
`simple-desk` qui est **persistante sans borne**.

---

## 4. Le bridge n'a pas de « release all »

`src/utils/dmx-bridge.ts` expose :

- `write(sourceId, universe, channels)` (`:86`)
- `writeTransient(sourceId, universe, channels, ms=2000)` (`:95`)
- `push(universe, channels, sourceId='quickshow')` (`:...`)
- `writeMerge(sourceId, universe, channels)`
- `release(sourceId, universe?)` (`:131`) — **par source seulement**
- `pushDesignChannel(...)` (source `design-test`)

**Aucun `clearAll` / `releaseAll` / `releaseAllSources` n'existe.** Aucun appelant
n'itère non plus sur toutes les sources pour tout relâcher.

---

## 5. Le chemin de la boucle d'ambiance (pour référence)

`src/views/AutoLoopsPanel.tsx` :

- `:299` `dmxBridge.write('vc', cue.universe, cue.channelValues)` → la boucle écrit
  dans la source `vc` (LTP 80).
- `:43-56` `zeroAllUniverses()` écrit `writeTransient('vc', ...)` (zéro, relâché 2 s).
- `:217-225` `stopPlay()` et l'effet d'unmount appellent `zeroAllUniverses()` —
  **ils ne touchent ni `simple-desk` ni `fixture-test`.**

Le calcul DMX de la boucle est correct (les `channelValues` de cue0 diffèrent entre
boucles) ; mais dès que `simple-desk` (ou `fixture-test`) détient ne serait-ce qu'un
canal (dimmer/RGB), l'arbitre (`output-arbiter.ts` `getBuffer`, tri par priorité
décroissante puis « LTP prend le canal, `taken` ») fige ces canaux à la valeur de la
source supérieure — identiques sur **toutes** les boucles → show figé identique.

---

## 6. Scénario de reproduction précis

1. Mode **Perform** → onglet **Simple Desk** → monter un ou plusieurs faders
   (ex. dimmer/RGB de la 1ʳᵉ fixture). → `performStore.sdSetChannelValue`
   (`:289`) → `dmxBridge.write('simple-desk', ...)` **persistant**.
2. Basculer en mode **Quick** (ou changer d'onglet) : `handleModeChange` ne relâche
   que design-test/design-efx/fixture-onoff ; `simple-desk` reste.
3. Onglet **« Boucles d'ambiance »** → **Jouer**. `playLoop` écrit `vc` (80) mais
   `simple-desk` (100) gagne sur les canaux qu'elle détient → toutes les boucles
   affichent ces canaux figés = **même show**.
4. Le diagnostic intégré de `playLoop` (`AutoLoopsPanel.tsx:267`) affiche
   `activeSrcs=[simple-desk,...]` et `preBuf[...]` → confirme la source coupable en
   une ligne de console.

---

## 7. Conclusion opérationnelle

- **Cause racine** : `simple-desk` est une source LTP persistante (priority 100)
  sans cycle de vie de relâchement ; `App.handleModeChange` et les changements
  d'onglet ne la relâchent pas.
- **Correctif attendu** : relâcher `simple-desk` (et `fixture-test`) quand on quitte
  le Simple Desk / le test, ou au changement de mode/onglet — symétriquement aux 3
  releases déjà présents dans `handleModeChange` (`App.tsx:391-393`), ou via un
  `releaseAll` global (à ajouter, il n'existe pas aujourd'hui).
- **Piège à éviter** : ne pas « zéroïser » `simple-desk` en persistant (un bloc LTP
  de zéros priority 100 blackouterait tout) ; utiliser `writeTransient` (relâche
  après 2 s) comme le fait déjà `sdResetAll` (`performStore.ts:326`).
