# Subagent 01 — Trace indépendante DRY → 3D (QuickShow)

Date : 2026-08-23 · Portée : lecture seule, aucun code modifié.

## TL;DR

Le bouton **DRY ne casse pas la mise à jour 3D**. Le flag `dryRun` n'agit que dans
`dmxBridge.flushToHardware` (`dmx-bridge.ts:54`), qui coupe uniquement l'envoi hardware
(`api.setChannels`). La seule source lue par Stage3D est `appStore.channelData`, alimentée
par `setUniverseData`, qui **reste appelé** dans la boucle RAF quelle que soit la valeur de
`dryRunMode`.

Le symptôme « projecteurs 3D visibles mais aucun show » provient donc d'un **autre gate**
(voir Q2). Les deux candidats les plus probables, hors DRY :
- `dmxOutputEnabled === false` (bouton Zap, distinct de DRY) → gate `dmx-playback.ts:525`.
- mismatch d'index d'univers : le fix Stage3D « appStore.dmx.universes → showStore.universes »
  est **présent dans la working copy mais non commité** (`Stage3D.tsx:379`, diff non commité).
  Un build testé sur l'ancienne ligne lit `channelData` à un mauvais index → projecteurs
  présents (géométrie) mais jamais allumés, indépendamment de DRY.

---

## Q1 — `dryRunMode=true` casse-t-il `setUniverseData` ?

**Non.** `setUniverseData` est toujours appelé dans la boucle de lecture, y compris en dry-run.

Preuves fichier:ligne :

1. `dryRunRef` est **déclaré mais jamais utilisé** ensuite (code mort) :
   - `src/hooks/dmx-playback.ts:381` — `const dryRunRef=useRef(dryRunMode);dryRunRef.current=dryRunMode;`
   - Grep complet du fichier : aucune autre occurrence de `dryRunRef` (seule la ligne 381).
2. `dryRunMode` n'entre que dans un seul endroit :
   - `dmx-playback.ts:383` — `useEffect(()=>{ dmxBridge.setDryRun(dryRunMode); },[dryRunMode]);`
3. `setDryRun` ne fait qu'écrire un flag module :
   - `src/utils/dmx-bridge.ts:141-143` — `setDryRun(dryRun:boolean){ _dryRun = dryRun; }`
4. Le flag `_dryRun` n'est lu qu'à **un seul endroit**, la sortie hardware :
   - `dmx-bridge.ts:54` — `function flushToHardware(...){ if (_dryRun) return; ... api.setChannels(...) }`
5. La boucle RAF écrit le store **sans condition dryRun** :
   - `dmx-playback.ts:1113` — `useAppStore.getState().setUniverseData(uniIdx, chVals);`
   - `dmx-playback.ts:1118` — `if (onVirtualDmx) onVirtualDmx(uniIdx, chVals);`
   - (`onVirtualDmx` est rebranché sur `setUniverseData` dans QuickShowView, cf. Q3.)
6. Les seuls gates en tête de tick sont `dmxEnabledRef` et `analysis/cues`, **pas dryRun** :
   - `dmx-playback.ts:525` — `if(!dmxEnabledRef.current){...return;}`
   - `dmx-playback.ts:529` — `if(!analysis||c.length===0){...return;}`

Archéologie git (confirme le refactor) : commit `0a15075` a supprimé les anciens appels
`if(!dryRunRef.current) api.setChannels(...)` disséminés, et les a remplacés par
`dmxBridge.setDryRun()` + `flushToHardware` qui teste `_dryRun`. Il a laissé un **commentaire
orphelin** `// Dry-run mode: skip hardware DMX, keep store/3D updates` en
`dmx-playback.ts:498`, sans code en dessous. L'intention (garder store/3D, couper hardware)
est respectée par le code actuel.

---

## Q2 — Toutes les conditions empêchant l'allumage 3D pendant QuickShow

### A. Gates d'entrée de la boucle RAF (`dmx-playback.ts`)

1. **`isPlaying === false`** — l'effet de lecture ne tourne pas.
   - `dmx-playback.ts:446` — `if(!isPlaying){ ... }`
   - `dmx-playback.ts:1131` — `},[isPlaying]);` (l'effet RAF ne (re)monte que sur `isPlaying`).
2. **Absence de l'objet API DMX** — la boucle ne démarre jamais du tout.
   - `dmx-playback.ts:496-497` — `const api = window.lightMaestro?.dmx; if(!api)return;`
   - Dans l'app Electron réelle, `window.lightMaestro.dmx` est toujours exposé
     (`electron/preload.ts:3-5`), donc ce gate ne déclenche pas en production. Il est
     conceptuellement faux pour le dry-run (qui devrait fonctionner sans hardware) mais
     inopérant en Electron.
3. **`dmxOutputEnabled === false`** (bouton **Zap**, distinct de DRY) — bail immédiat, aucune
   écriture store/3D.
   - `dmx-playback.ts:380` — `dmxEnabledRef.current = dmxOutputEnabled;`
   - `dmx-playback.ts:525` — `if(!dmxEnabledRef.current){...return;}`
   - Le bouton DRY (`QuickShowView.tsx:3020`) ne touche **pas** `dmxOutputEnabled`
     (toggle séparé en `QuickShowView.tsx:3011`).
4. **`analysis === null`** — aucun canal analysé.
   - `dmx-playback.ts:529` — `if(!analysis||c.length===0){...return;}`
   - `analysisRef.current` est mis à `null` quand :
     - `patchedFixtures.length===0 || universes.length===0` → `dmx-playback.ts:392`
     - un `fixtureDef` est introuvable pour n'importe quelle fixture patched →
       `dmx-playback.ts:397` — `if(!def){analysisRef.current=null;return;}`
5. **`cues` vide** — aucun show généré (audio non analysé / `genCues` vide).
   - `dmx-playback.ts:529` (même ligne que ci-dessus).
   - Source des cues : `QuickShowView.tsx:2302` —
     `cues: (showB && cuesB.length>0 ? cuesB : cues)` ; `cues` vient de `genCues(...)`
     (`QuickShowView.tsx:2236-2239`).

### B. Dans le corps du tick (`dmx-playback.ts`)

6. **Freeze activé** (bouton Snowflake, distinct de DRY) — maintient la dernière frame,
   saute le calcul. Ne « tue » pas la 3D mais la fige.
   - `dmx-playback.ts:555` — `if (freezerRef.current?.current) {...}`
7. **Pas de cue active à `ct`** — hard cut à 0 (projecteurs éteints, pas « pas de show »).
   - `dmx-playback.ts:597` — `if(!active){ ... setUniverseData(uniIdx, zeroCh) ... }`
   - Cas typique : `ct` avant le 1er cue (`cue.time > ct`).
8. **Fin de show dépassée** — fade-out vers zéro.
   - `dmx-playback.ts:615-623` (zero-out après le dernier cue).
9. **Fixture désactivée** — saillie de la génération de valeurs.
   - `dmx-playback.ts:716` — `if (disabledFixturesRef?.current?.has(pf.id)) continue;`
10. **`chVals` vide** — aucune écriture de frame.
    - `dmx-playback.ts:1103-1105` — `let hasVals=false; for(const _ in chVals){hasVals=true;break;} if(hasVals){...}`
    - Cause possible : aucune voie intensity/rgb mappée sur les fixtures, ou toutes disabled.
11. **`sig` inchangé** — frame identique, pas d'écriture.
    - `dmx-playback.ts:1109` — `if(sig!==lastSig){...}` (la 1ère frame écrit toujours).
12. **Throttle store ~30 FPS** — n'empêche pas la 3D (cf. note « bypass » ci-dessous).
    - `dmx-playback.ts:1112` — `if(now-lastStoreUpdate>33){ setUniverseData(...) }`

### C. Côté lecture 3D (`Stage3D.tsx`)

13. **`channelData[universeIndex]` absent** → intensity 0 + auto-sweep (les projecteurs ne
    s'allument pas).
    - `Stage3D.tsx:1504` — `let rawData = channelData[f3d.universeIndex];`
    - `Stage3D.tsx:1524` — `if (!rawData) { ... intensity = 0 ... continue; }`
    - `universeIndex` est calculé depuis la liste des univers (cf. Q3) :
      `Stage3D.tsx:393-397` + `Stage3D.tsx:727` — `universeIndex: universeIndexMap.get(fixture.universeId) ?? 0`.
14. **Fixture sans voie d'intensité détectée** — intensity reste 0.
    - `Stage3D.tsx:1553` — `if (cm.intensityOffset !== null && cm.intensityOffset >= 0) {...} else if (cm.rgbOffsets) {...}`
15. **Shutter fermé** — intensity forcée à 0.
    - `Stage3D.tsx:1564-1571` — `shutterClosed = true; intensity = 0;` (shutter DMX ≤ 31).
16. **Blackout** — `Stage3D.tsx:1583` — `if (blackout) intensity = 0;`
17. **Fixture dans `disabledRef`** — `Stage3D.tsx:1584` — `if (disabledRef.current.has(f3d.id)) intensity = 0;`
18. **Grand Master bas** — atténue/éteint.
    - `Stage3D.tsx:1585` — `intensity = intensity * (grandMaster / 255);`

---

## Q3 — Stage3D lit-il exclusivement `appStore.channelData` ?

**Oui, exclusivement.** Aucun chemin alternatif vers Stage3D.

Preuves fichier:ligne :

1. Lecture unique dans la boucle de rendu :
   - `Stage3D.tsx:1492` — `const dmxState = useAppStore.getState().dmx;`
   - `Stage3D.tsx:1493` — `let channelData = dmxState.channelData as Record<number, Uint8Array | number[]>;`
   - `Stage3D.tsx:1504` — `channelData[f3d.universeIndex]`
   - Appelé à ~30 FPS depuis le render loop : `Stage3D.tsx:1040` — `updateDmxState();`
2. **Aucun import `dmxBridge` dans Stage3D** (imports : `useAppStore` ligne 24, `useShowStore` ligne 22).
3. Le cache du bridge est un cul-de-sac pour la 3D :
   - `dmx-bridge.ts:168-170` — `getChannels()` lit `_channelCache`. Utilisé uniquement par
     `src/engine/midi-actions.ts:357,361` et `src/views/PerformanceView.tsx:1912,1916,1993,1994,1998`
     (Virtual Console / MIDI), **jamais par Stage3D**.
   - `dmx-bridge.ts:173` — `onPush(fn)` : **aucun abonné** dans tout `src/` (grep `onPush` ne
     renvoie que la définition).
4. Le seul pont vers le store est donc l'écriture :
   - Direct : `dmx-playback.ts:1113` — `setUniverseData(uniIdx, chVals)`
   - Mirror : `dmx-playback.ts:1118` → `QuickShowView.tsx:2325-2327` —
     `onVirtualDmx: (uni, chVals) => { useAppStore.getState().setUniverseData(uni, chVals); }`
   - `setUniverseData` écrit `channelData[universe]` sans dépendance hardware :
     `src/stores/appStore.ts:415-438` (mutation in-place si `prev instanceof Uint8Array`, sinon
     recopie — la lecture pollée de Stage3D voit les valeurs à jour dans les deux cas).

### Cohérence des index d'univers (écriture ↔ lecture)

- Écriture : `uniIdx` = position de `pf.universeId` dans `analysis.uniIds` =
  `universes.map(u => String(u.id))`, où `universes` vient de QuickShowView →
  `useShowStore(s => s.universes)` (`QuickShowView.tsx:1620`).
- Lecture : `universeIndexMap` = position de `fixture.universeId` dans
  `useShowStore(s => s.universes)` (`Stage3D.tsx:379, 393-397`).
- **Les deux côtés utilisent `showStore.universes`** → les index sont alignés **dans la
  working copy actuelle**. C'est le résultat du fix non commité (`git diff src/views/Stage3D.tsx`) :
  l'ancienne ligne `const universes = useAppStore((s) => s.dmx.universes)` (default figé,
  jamais synchronisé) pouvait désaligner l'index et casser la 3D sur les shows multi-univers /
  univers renommés.

---

## Notes annexes / pièges identifiés

- **Throttle contourné** : le throttle 30 FPS (`dmx-playback.ts:1112`) ne bride pas la 3D,
  car `onVirtualDmx` (`dmx-playback.ts:1118` → `QuickShowView.tsx:2325-2327`) rappelle
  `setUniverseData` à **chaque** frame dont `sig` change. Le double appel `setUniverseData`
  (direct 1113 + mirror 1118) est redondant mais non cassant.
- **`lastSig`/`lastStoreUpdate` partagés** entre univers (`dmx-playback.ts:521-522`, déclarés
  hors de la boucle `analysis.byUniverse`) : risque de frame sautée en multi-univers, mais
  sans rapport avec DRY.
- **Commentaire orphelin** `dmx-playback.ts:498` : trace d'un bloc supprimé par le commit
  `0a15075` (refactor dry-run). Ne pas en déduire qu'un `if(dryRun) return` y manque : le
  comportement voulu est réalisé par `dmxBridge._dryRun`.
- **Conclusion de vérification** : le dry-run n'étant pas un gate du chemin store/3D, un
  diagnostic « DRY coupe la 3D » doit être re-qualifié. Les gates réellement bloquants sont
  listés en Q2 ; priorité de vérification : (a) `dmxOutputEnabled` réellement vrai au moment du
  test, (b) `analysis` non nul (`fixtureDef` manquant), (c) `cues` non vide, (d) build testé
  embarquant ou non le fix universes de `Stage3D.tsx`.
