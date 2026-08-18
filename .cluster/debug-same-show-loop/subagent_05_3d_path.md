# Subagent 05 — Verdict : perspective visualisation 3D

## VERDICT

**3D lit une source séparée/périmée** : `useAppStore.getState().dmx.channelData`.

La visualisation 3D (Stage3D) ne lit **PAS** le flux du bridge DMX
(`dmxBridge.getChannels()` / `dmxBridge.onPush()` / `_channelCache`). Elle lit un
**store Zustand séparé** (`useAppStore.dmx.channelData`), qui n'est mis à jour que
par `setUniverseData()` / `setChannelValue()`.

Or la boucle d'ambiance écrit **uniquement** via `dmxBridge.write('vc', …)`, qui
met à jour le cache interne du bridge + le matériel, **mais jamais le store**. Donc
quand une boucle d'ambiance joue, le matériel reçoit le DMX correct/varié (confirmé
par le diagnostic runtime), mais la 3D continue d'afficher les **dernières valeurs
écrites dans le store** (périmées, ou vides) → « le même show » à l'écran.

---

## Preuves (lignes exactes)

### 1. Stage3D lit le store, pas le bridge

`src/views/Stage3D.tsx`

- Import : `import { useAppStore } from '../stores/appStore';` (ligne 24).
  Aucun `import { dmxBridge }` — vérifié : grep `dmxBridge|getChannels|onPush|_channelCache`
  sur Stage3D.tsx ne renvoie **rien**.

- `updateDmxState` (lignes 1485-1487) :
  ```ts
  const dmxState = useAppStore.getState().dmx;
  let channelData = dmxState.channelData as Record<number, Uint8Array | number[]>;
  ```
- Lecture par fixture (ligne 1498) :
  ```ts
  let rawData: Uint8Array | number[] | undefined = channelData[f3d.universeIndex];
  ```
- Le render loop appelle `updateDmxState()` à 60 fps (lignes 51, 1034-1036) :
  ```ts
  const DMX_POLL_INTERVAL = 1000 / 60;
  ...
  if (now - lastDmxPollRef.current >= DMX_POLL_INTERVAL) {
    lastDmxPollRef.current = now;
    updateDmxState();
  }
  ```

→ Stage3D est donc un **polling** sur `channelData`, jamais un abonné du bridge.

### 2. `dmxBridge.write()` ne touche pas le store

`src/utils/dmx-bridge.ts`

- `write()` (lignes ~66-77) :
  ```ts
  write(sourceId, universe, channels) {
    if (!outputArbiter.write(sourceId, universe, channels)) return;
    cancelTransient(sourceId);
    const buffer = outputArbiter.getBuffer(universe);
    pushBufferToConsumers(universe, buffer);   // → cache module + listeners
    recordOutputTick();
    flushToHardware(universe, buffer);          // → matériel réel
  }
  ```
- `pushBufferToConsumers()` (lignes 48-53) ne met à jour **que** le cache module
  et les listeners :
  ```ts
  function pushBufferToConsumers(universe, buffer) {
    _channelCache.set(universe, buffer);        // cache module, pas le store
    for (const fn of listeners) { try { fn(universe, buffer); } catch (_) {} }
  }
  ```

→ Aucun appel à `useAppStore.setUniverseData` dans `dmx-bridge.ts`.

### 3. `getChannels()` et `onPush()` sont des API mortes

`src/utils/dmx-bridge.ts` lignes 168-177 définissent :
```ts
getChannels(universe) { return _channelCache.get(universe); }
onPush(fn) { listeners.add(fn); return () => listeners.delete(fn); }
```
Grep global `onPush|getChannels` sur `src/` : **aucun appelant** (seules les
définitions ressortent). Donc personne ne « repompe » le cache bridge vers le store.

### 4. La boucle d'ambiance écrit sans mirroir store

`src/views/AutoLoopsPanel.tsx`

- Dans le `fire()` de lecture (ligne 299) :
  ```ts
  try { dmxBridge.write('vc', cue.universe, cue.channelValues); } catch {}
  ```
- C'est **le seul** write DMX de la boucle. Grep `setUniverseData|setChannelValue|
  useAppStore|channelData|onVirtualDmx` sur AutoLoopsPanel.tsx → **rien**.

→ La boucle d'ambiance ne met jamais `useAppStore.dmx.channelData` à jour.

### 5. Contraste : le moteur de playback principal fait le double write

`src/hooks/dmx-playback.ts` lignes ~1103-1107 :
```ts
useAppStore.getState().setUniverseData(uniIdx, chVals);   // ← alimente la 3D
dmxBridge.push(uniIdx, chVals, arbSource);                 // ← matériel + cache bridge
```
C'est pour ça que QuickShow / show-manager / song-preset animent correctement la 3D,
mais pas la boucle d'ambiance.

### 6. Confirmation par la doc interne du code

`src/utils/dmx-helpers.ts` (fonction `sendChannelsToHardwareAndStore`, lignes ~169-177) :
```ts
/**
 * Send channel values to hardware AND mirror them into the appStore
 * so the 3D view shows exactly what the hardware receives.
 */
...
try { useAppStore.getState().setUniverseData(uniNum, vals); } catch {}
```
Cette fonction existe **précisément** parce que la 3D dépend du store : tout chemin
qui veut que la 3D reflète le matériel doit appeler `setUniverseData` explicitement.

---

## Conclusion

- Le calcul DMX des boucles est correct (le diagnostic runtime le prouve) et le
  matériel reçoit bien des cue0 différents → **le bug n'est pas en amont**.
- La 3D, elle, ne reflète pas cette sortie : elle lit
  `useAppStore.dmx.channelData`, que `AutoLoopsPanel` ne met jamais à jour.
- Résultat : l'écran affiche une image figée/périmée (la même pour toutes les
  boucles), d'où « le même show light est joué sur toutes les boucles d'ambiance ».

### Correctifs possibles (au choix, à valider avec le main agent)

1. **Mirroir dans la boucle** (aligné sur `dmx-playback.ts`) : dans le `fire()` de
   `AutoLoopsPanel.tsx`, après `dmxBridge.write('vc', …)`, ajouter
   `useAppStore.getState().setUniverseData(cue.universe, cue.channelValues);`.
2. **Refactor 3D vers le bridge** : faire lire Stage3D depuis
   `dmxBridge.getChannels(universe)` (ou s'abonner via `onPush`) au lieu de
   `useAppStore.dmx.channelData`. Plus coûteux (toucher au render loop + mapping
   universes), mais supprime le risque de désynchronisation pour toutes les sources
   futures.
