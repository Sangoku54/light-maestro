# Analyse Performance — Boucle Chaude DMX (RAF Loop)

**Date :** 2026-08-15  
**Subagent :** Analyse perf boucle chaude  
**Fichiers analysés :** `dmx-playback.ts`, `output-arbiter.ts`, `dmx-bridge.ts`, `dmx-cues.ts`, `appStore.ts`, `App.tsx`

---

## 1. État actuel de la boucle

### Architecture du tick

La boucle RAF est définie dans `useDmxPlayback()` → `useEffect([isPlaying])`. Un seul `requestAnimationFrame(tick)` est monté à l'activation du playback.

```
tick() → pour chaque univers → pour chaque fixture → calcule DMX → push au bridge
```

**Fréquence cible :** 60 FPS ( RAF natif, non throttlé ).  
Aucun mécanisme de skip-frame ou de throttle — le tick s'exécute à chaque frame du navigateur, qu'il y ait du changement ou non.

### Flux de données par frame

1. Lecture `currentTimeRef.current` ( temps audio )
2. Lecture `cuesRef.current` ( cues pré-calculés )
3. `computeColorTrackColors()` — Map fixture→couleur
4. Recherche du cue actif ( `for...of` sur tous les cues )
5. Pour chaque univers :
   - Pour chaque fixture :
     - Calcul dimmer ( avec override tracks )
     - Calcul couleur ( avec override tracks )
     - Calcul shutter/strobe ( avec override tracks )
     - Calcul pan/tilt ( avec EFX override ou pattern mouvement )
     - Calcul gobo/prism/zoom/frost/iris/focus
   - Override chaser ( si actif )
   - Crossfade blend ( si actif )
   - Signature de changement → `setUniverseData()` + `dmxBridge.push()`
6. `requestAnimationFrame(tick)`

---

## 2. Goulots d'étranglement identifiés

### 🔴 P1 — Allocations massives dans la boucle ( IMPACT CRITIQUE )

**Localisation :** `tick()` ligne ~548 → fin, et fonctions `compute*TrackOverrides()` appelées **par fixture**.

#### 2.1 `compute*TrackOverrides()` appelés dans la boucle fixture

Les fonctions suivantes sont appelées **à l'intérieur de la boucle `for (fi=0; fi<fixtures.length; fi++)`** :

- `computeDimmerTrackOverrides()` — ligne 692 → **appelé pour CHAQUE fixture**
- `computeStrobeTrackOverrides()` — ligne 794 → **appelé pour CHAQUE fixture**
- `computeColorTrackColors()` — ligne 548 → appelé une fois avant la boucle ( OK )
- `computeChaserTrackOverrides()` — ligne 969 → appelé une fois par univers ( OK )
- `computeEfxOverrides()` — ligne 647 → appelé une fois avant la boucle ( OK )

**Problème :** `computeDimmerTrackOverrides` et `computeStrobeTrackOverrides` allouent un `new Map()` à chaque appel, font un `.find()` sur les entries, un `.map()` sur les patchedFixtures, un `.find()` sur les groups — **pour chaque fixture**.

Avec N fixtures : **N × ( 2 Maps + 2× M entries.find + patchedFixtures.map + groups.find )** par frame.

Pour 20 fixtures : ~40 Maps + 40 array allocations + 40 `.find()` par frame, soit **~2400 allocations/seconde**.

#### 2.2 `resolveTrackTargets()` appelé par fixture

Dans les lambdas de dimmer, color et strobe, `resolveTrackTargets(ft, patchedFixtures, fixtureGroups)` est appelé pour chaque fixture track × chaque fixture. Si on a 5 fixture tracks et 20 fixtures = 100 appels/frame, chacun faisant un `.map()` ou `.filter()`.

#### 2.3 Allocations dans le tick principal

| Ligne | Allocation | Fréquence |
|-------|-----------|-----------|
| 536 | `{ ...chMap }` ( spread freeze ) | Chaque frame quand frozen |
| 538 | `{ ...cpy }` ( spread pour onVirtualDmx ) | Chaque frame quand frozen |
| 1028 | `useAppStore.getState().setUniverseData(uniIdx, chVals)` | Chaque frame par univers |
| 1028 | `dmxBridge.push(uniIdx, chVals, arbSource)` | Chaque frame par univers |
| 469 | `Object.entries(channels)` dans fade-out | Par frame pendant fade |
| 582/600 | `zeroCh: Record<number,number>={}` + loop 1→512 | Quand pas de cue actif |

#### 2.4 `setUniverseData` → Zustand set() avec spread

Dans `appStore.ts` ligne 398 :
```ts
set({ dmx: { ...dmx, channelData: { ...(raw as any), [universe]: data } } });
```

À chaque frame, pour chaque univers :
- `new Uint8Array(prev)` — copie du buffer 512 octets
- `{ ...dmx }` — spread de l'objet dmx
- `{ ...(raw as any) }` — spread de channelData
- Nouvel objet `{ [universe]: data }`

Cela déclenche un **re-render React** de tous les composants subscribés à `dmx.channelData`.

### 🔴 P2 — `OutputArbiter.getBuffer()` alloue à chaque push ( IMPACT ÉLEVÉ )

**Localisation :** `output-arbiter.ts` ligne 134 → `getBuffer()`.

À chaque `dmxBridge.push()` → `write()` → `getBuffer()` :

1. `sorted: Array<{...}>` — nouveau tableau
2. Tri du tableau ( `sorted.sort()` )
3. `buffer: Record<number, number> = {}` — nouvel objet
4. `taken = new Set<number>()` — nouveau Set
5. `htp = new Map<number, number>()` — nouvelle Map
6. Boucle sur `Object.keys(vals)` pour chaque source

Avec 1 source active ( quickshow ) : 1 sort + 1 Set + 1 Map + 1 object par univers par frame.  
Avec plusieurs sources ( VC + design + quickshow ) : multiplicateur.

### 🟡 P3 — Signature de changement par string concatenation ( IMPACT MODÉRÉ )

**Localisation :** ligne ~1023.

```ts
const sig = String(uniIdx) + ':' + Object.entries(chVals)
  .sort((a,b) => Number(a[0]) - Number(b[0]))
  .map(([k,v]) => `${k}=${v}`)
  .join(',');
```

Pour chaque univers à chaque frame :
- `Object.entries(chVals)` — allocation tableau de paires
- `.sort()` — tri in-place
- `.map()` — nouveau tableau de strings
- `.join(',')` — concaténation string

Si `chVals` contient 50 channels : 50 paires + 50 strings + 1 string finale par univers par frame.

### 🟡 P4 — Re-render React déclenché à chaque frame ( IMPACT MODÉRÉ-ÉLEVÉ )

**Localisation :** `setUniverseData()` ligne 1028 + composants subscribés.

Le `set()` Zustand notifie tous les subscribers de `dmx.channelData`. Le composant `StatusBar` et la `Stage3D` view consomment ces données. Si la 3D view fait un re-render lourd à 60 FPS, cela entre en compétition avec le RAF loop pour le temps CPU.

Le guard `sig !== lastSig` limite le push au changement, mais en playback actif, les valeurs changent quasi-systématiquement ( pan/tilt en mouvement, dimmer pulse, etc. ).

### 🟡 P5 — `Object.entries()` / `Object.keys()` partout ( IMPACT MODÉRÉ )

Utilisation massive de `Object.entries()` et `Object.keys()` sur `Record<number, number>` dans :

- `dmx-playback.ts` : ~15 occurrences dans le tick
- `output-arbiter.ts` : 4 occurrences dans `getBuffer()` + `write()`
- `dmx-bridge.ts` : 2 occurrences dans `writeMerge()`

Chaque `Object.entries()` alloue un tableau de paires `[string, value]`. Sur des records de 50-100 channels, c'est coûteux.

### 🟢 P6 — Pas de throttle ni skip-frame ( IMPACT FAIBLE-MODÉRÉ )

Le tick s'exécute à 60 FPS même si :
- Le matériel DMX ne supporte que 30 FPS ( USB DMX )
- Aucun cue n'a changé
- Le temps audio n'a pas avancé ( pause audio sans pause playback )

Le guard `sig !== lastSig` évite le push, mais toute la computation en amont s'exécute quand même.

---

## 3. Propositions d'optimisation

### Priorité 1 — Quick Wins ( faible effort, gain immédiat )

#### Fix 1.1 : Hoist `compute*TrackOverrides()` hors de la boucle fixture

**Problème :** `computeDimmerTrackOverrides` et `computeStrobeTrackOverrides` sont appelés par fixture alors qu'ils retournent une Map pour toutes les fixtures.

**Fix :** Appeler une fois avant la boucle `for (fi=0; ...)` et stocker dans une variable locale.

```ts
// AVANT ( par fixture ) :
for (let fi = 0; fi < fixtures.length; fi++) {
  if (dimmerTracksRef?.current) {
    const dto = computeDimmerTrackOverrides(...); // ← N× allocations
    const dimmerOverride = dto.get(pf.id);
  }
}

// APRÈS ( une fois par univers ) :
const dimmerOverrides = dimmerTracksRef?.current
  ? computeDimmerTrackOverrides(dimmerTracksRef.current, ct, ...)
  : null;
const strobeOverrides = strobeTracksRef?.current
  ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, ...)
  : null;
for (let fi = 0; fi < fixtures.length; fi++) {
  const dimmerOverride = dimmerOverrides?.get(pf.id);
  // ...
}
```

**Gain estimé :** -80% des allocations de Maps par frame ( de N×2 à 2 par univers ).  
**Complexité :** Très faible — déplacer 2 appels de fonction. ~30 min.

#### Fix 1.2 : Cache `resolveTrackTargets()` par fixture track

**Problème :** `resolveTrackTargets()` est appelé pour chaque fixture × chaque track.

**Fix :** Pré-calculer une Map `fixtureId → track` une fois par frame.

```ts
const trackTargetsCache = new Map<string, MovementBlock | null>();
if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
  for (const ft of fixtureTracksRef.current) {
    if (!ft.enabled) continue;
    const targets = resolveTrackTargets(ft, patchedFixturesRef.current, fixtureGroupsRef.current);
    for (const fid of targets) trackTargetsCache.set(fid + ':' + ft.id, ft);
  }
}
```

**Gain estimé :** -90% des appels `resolveTrackTargets()`.  
**Complexité :** Faible — wrapper avec cache. ~45 min.

#### Fix 1.3 : Remplacer la signature string par un hash numérique

**Problème :** Construction de string coûteuse pour détecter les changements.

**Fix :** Utiliser un hash numérique simple ( XOR des valeurs ).

```ts
let sig = uniIdx;
for (const k in chVals) sig = (sig * 31 + Number(k) * 17 + chVals[k]) | 0;
if (sig !== lastSig) { ... }
```

**Gain estimé :** Élimine toutes les allocations de la signature ( entries + sort + map + join ).  
**Complexité :** Très faible. ~15 min.

### Priorité 2 — Effort moyen ( gain significatif )

#### Fix 2.1 : `OutputArbiter.getBuffer()` — éviter le tri à chaque appel

**Problème :** Tri complet des sources + allocations ( Set, Map, Array ) à chaque frame.

**Fix :** 
- Maintenir les sources pré-triées par priorité à l'inscription ( liste triée immutable ).
- Réutiliser un buffer persistant au lieu d'en allouer un nouveau.
- Pour le cas courant ( 1 source HTP active ), court-circuiter le calcul.

```ts
getBuffer(universe: number): Record<number, number> {
  const uni = this._values.get(universe);
  if (!uni || uni.size === 0) return {};
  // Fast path: single source
  if (uni.size === 1) {
    const [_, vals] = uni.entries().next().value;
    return vals;
  }
  // Slow path: multi-source arbitration ( existing logic )
  ...
}
```

**Gain estimé :** -90% du temps arbitrage dans le cas courant.  
**Complexité :** Moyenne — refactor de la classe. ~2h.

#### Fix 2.2 : Throttle `setUniverseData()` à 30 FPS

**Problème :** Le store React est mis à jour à 60 FPS, déclenchant des re-renders coûteux.

**Fix :** Séparer le push hardware ( 60 FPS ) du push React store ( 30 FPS ).

```ts
let lastStoreUpdate = 0;
// Dans le tick :
if (performance.now() - lastStoreUpdate > 33) {
  useAppStore.getState().setUniverseData(uniIdx, chVals);
  lastStoreUpdate = performance.now();
}
// Toujours pusher au hardware :
dmxBridge.push(uniIdx, chVals, arbSource);
```

**Gain estimé :** -50% des re-renders React, libère du temps CPU pour le tick.  
**Complexité :** Faible — ajouter un throttle. ~30 min.

#### Fix 2.3 : Remplacer `Object.entries()` par `for...in` ou itération directe

**Problème :** `Object.entries()` alloue un tableau de paires.

**Fix :** Utiliser `for (const chStr in chVals)` qui n'alloue rien.

```ts
// AVANT :
for (const [chStr, v] of Object.entries(chVals)) { ... }

// APRÈS :
for (const chStr in chVals) {
  const v = chVals[chStr];
  ...
}
```

**Gain estimé :** Élimine ~20 allocations de tableaux par frame.  
**Complexité :** Très faible — recherche/remplacer. ~30 min.

#### Fix 2.4 : `setUniverseData()` — éviter la copie Uint8Array

**Problème :** `new Uint8Array(prev)` copie 512 octets à chaque frame.

**Fix :** 
- Option A : Muter le Uint8Array existant ( pas de copie ).
- Option B : Utiliser un double-buffer ( deux Uint8Array, swap ).
- Option C : Passer une référence et laisser le consumer lire directement.

```ts
// Option A — mutation in-place :
setUniverseData: (universe, values) => {
  const { dmx } = get();
  const raw = dmx.channelData || {};
  let data = (raw as any)[universe];
  if (!(data instanceof Uint8Array)) {
    data = new Uint8Array(512);
  }
  for (const ch in values) {
    const idx = Number(ch) - 1;
    if (idx >= 0 && idx < 512) data[idx] = values[ch];
  }
  // Notifier sans copie — les readers doivent lire immédiatement
  set({ dmx: { ...dmx, channelData: { ...(raw as any), [universe]: data } } });
}
```

**Gain estimé :** -512 bytes d'allocation par univers par frame.  
**Complexité :** Faible — vérifier que les consumers ne gardent pas de référence. ~1h.

### Priorité 3 — Refactoring structurel ( gain à long terme )

#### Fix 3.1 : Typed arrays ( `Uint8Array[512]` ) pour les valeurs DMX

**Problème :** `Record<number, number>` ( object hash ) utilisé partout. Les engines pro ( QLC+, SoundSwitch ) utilisent des `Uint8Array` pour les channels.

**Fix :** 
- Remplacer `chVals: Record<number, number>` par `chVals: Uint8Array(512)`.
- L'indexation directe `chVals[addr]` est ~10× plus rapide qu'un lookup object.
- `Object.entries()` devient une simple boucle `for (let i = 0; i < 512; i++)`.

**Gain estimé :** -50% du temps de computation par frame, élimine toutes les allocations liées aux Records.  
**Complexité :** Élevée — toucher tous les fichiers. ~1 jour.

#### Fix 3.2 : Object pooling pour les buffers intermédiaires

**Problème :** Chaque frame alloue des Maps, Sets, Arrays pour les overrides.

**Fix :** Pool d'objets réutilisés entre les frames.

```ts
const pool = {
  map: () => { /* retourne une Map nettoyée */ },
  set: () => { /* retourne un Set nettoyé */ },
};
```

**Gain estimé :** -95% des allocations GC-éligibles par frame.  
**Complexité :** Moyenne — wrapper les fonctions compute*. ~3h.

#### Fix 3.3 : Déplacer la computation DMX dans un Web Worker

**Problème :** La computation DMX bloque le thread principal, entre en compétition avec React rendering et la 3D.

**Fix :** Worker dédié qui reçoit `currentTime + cues + fixtures` et retourne `Uint8Array[512]` par univers. Le thread principal ne fait que `dmxBridge.push()`.

**Gain estimé :** Libère le main thread, render React fluide, tick DMX à fréquence stable.  
**Complexité :** Très élevée — refactoring de l'architecture. ~2-3 jours.

#### Fix 3.4 : Skip-frame intelligent

**Problème :** Le tick s'exécute même si rien n'a changé.

**Fix :** Détecter les cas où la sortie ne change pas :
- Temps audio n'a pas avancé ( ≤ 1ms de différence )
- Pas de tracks actifs ( pas de mouvement, pas de strobe )
- → Skip la computation complète, juste re-push la dernière frame

```ts
const lastTime = lastTimeRef.current;
if (Math.abs(ct - lastTime) < 0.001 && !hasActiveTracks) {
  rafRef.current = requestAnimationFrame(tick);
  return;
}
lastTimeRef.current = ct;
```

**Gain estimé :** -100% du temps de tick quand idle.  
**Complexité :** Faible — ajout d'un guard. ~30 min.

---

## 4. Résumé — Classement par impact/effort

| # | Fix | Impact | Effort | Priorité |
|---|-----|--------|--------|----------|
| 1.1 | Hoist compute*TrackOverrides | 🔴 Critique | 30 min | P1 |
| 1.2 | Cache resolveTrackTargets | 🔴 Critique | 45 min | P1 |
| 1.3 | Hash numérique au lieu de string sig | 🟡 Modéré | 15 min | P1 |
| 2.1 | Fast-path getBuffer() single source | 🟡 Élevé | 2h | P2 |
| 2.2 | Throttle setUniverseData 30 FPS | 🟡 Élevé | 30 min | P2 |
| 2.3 | for...in au lieu de Object.entries() | 🟡 Modéré | 30 min | P2 |
| 2.4 | Éviter copie Uint8Array dans setUniverseData | 🟡 Modéré | 1h | P2 |
| 3.1 | Uint8Array[512] partout | 🔴 Critique | 1 jour | P3 |
| 3.2 | Object pooling | 🟡 Élevé | 3h | P3 |
| 3.3 | Web Worker dédié | 🔴 Critique | 2-3 jours | P3 |
| 3.4 | Skip-frame intelligent | 🟢 Faible-Modéré | 30 min | P3 |

### Gains estimés cumulés ( P1 seul )

En appliquant uniquement les 3 fixes P1 ( ~1.5h de travail ) :
- **-80% des allocations de Maps** par frame ( hoist + cache )
- **-100% des allocations de strings** pour la signature
- **Gain CPU estimé :** 30-40% du temps de tick

### Gains estimés cumulés ( P1 + P2 )

Avec P1 + P2 ( ~5h de travail ) :
- **-90% des allocations** totales par frame
- **-50% des re-renders React**
- **Gain CPU estimé :** 50-60% du temps de tick
- **Stabilité FPS :** 60 FPS maintenable avec 30+ fixtures

### Cible production ( P1 + P2 + P3 )

Avec le refactoring Uint8Array + Worker :
- **0 allocation** par frame en steady-state
- **Thread principal libéré** pour React + 3D
- **Scale :** 100+ fixtures à 60 FPS stable
