# subagent_04.md — Review adverse du patch chorégraphie spatiale (1.0.20, lot 1)

Reviewer : subagent_04 (adversaire). Objet : relire le patch réel (spatialPhaseFor /
fallbackPosition / SPATIAL_BY_SECTION dans dmx-movement.ts ; injection dans le tick et
computeDmxForCue de dmx-playback.ts ; champs spatialPattern + fixturePositionsRef dans
QuickShowView / SongPresetPlayer ; test spatial-choreo.test.ts). Aucun fichier source modifié.

Vérifications effectuées : lecture des 2 chemins (tick L1028-1065, computeDmxForCue
L1460-1545), des 2 call-sites computeDmxForCue avec fixturePositions (tick crossfade L682-684
→ 11ᵉ arg passé ; preview QuickShowView L2343-2350 → non passé), buildPresetDmxCues (L120-140),
wiring des 2 consommateurs de useDmxPlayback, showStore.initFixturePosition, diff complet des
fichiers touchés, `npx vitest run src/__tests__/spatial-choreo.test.ts` → **9/9 passent**.

---

## Problèmes bloquants (à corriger avant livraison)

### 1. L'offset spatial s'applique AUSSI aux fixtures pilotées par un movement track (trackMovement)

**Fichier/ligne vérifiés :**
- `src/hooks/dmx-playback.ts` L1047 (tick) :
  `const phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase+(spatialPattern?spatialPhaseFor(fixturePositions?.[pf.id],spatialPattern,mobileIdx):0);`
- `src/hooks/dmx-playback.ts` L1482 (computeDmxForCue) :
  `const phase = cue.time * Math.PI * 2 * speedMult + spatialPhaseFor(fixturePositions?.[pf.id], spatialPattern, mobileIdx);`

**Explication :** dans les deux chemins, la phase ne tient pas compte de `trackMovement`
(défini juste au-dessus : L979-IIFE dans le tick, L1460 `fixtureTrackOverrides?.forcedMovements?.get(pf.id)` dans
computeDmxForCue). Résultat : quand une cue porte `spatialPattern` (c'est le cas de TOUTES les cues générées
par genCues), une fixture qui a un bloc de mouvement utilisateur sur la timeline reçoit un décalage de phase
allant jusqu'à ±π (wave/circle) ou π (alternate) sur son pattern **écrit à la main** — la chorégraphie
utilisateur est altérée. Le spec du plan (`.cluster/spatial-choreo/plan.md`, contrainte « manualCues/chaser/
disabledFixtures ») et la consigne de review (« Il devrait être ignoré pour elles — la phase spatiale ne doit
s'ajouter QUE quand le mouvement auto s'applique ») exigent l'inverse.

**Correction (patchable, 2 lignes) :**
```ts
// tick L1028-1036 : ne pas compter ni appliquer pour les fixtures sous track
const spatialPattern = (active as any).spatialPattern;
let mobileIdx = -1, totalMobile = 0;
if (spatialPattern && !trackMovement) { /* comptage inchangé */ }
// tick L1047 :
const phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase+(spatialPattern&&!trackMovement?spatialPhaseFor(fixturePositions?.[pf.id],spatialPattern,mobileIdx):0);
// computeDmxForCue L1472-1482 :
const spatialPattern = (cue as any).spatialPattern;
let mobileIdx = -1, totalMobile = 0;
if (spatialPattern && !trackMovement) { /* comptage inchangé */ }
const phase = cue.time * Math.PI * 2 * speedMult + (spatialPattern && !trackMovement ? spatialPhaseFor(fixturePositions?.[pf.id], spatialPattern, mobileIdx) : 0);
```
Nota : ce n'est PAS une régression des tracks — c'est un nouveau comportement introduit par le patch, sur un
chemin que le moteur existant ne touchait pas. À corriger avant livraison.

---

## Problèmes non bloquants / améliorations

### 2. Cohérence live vs crossfade : mobileIdx par-univers (tick) ≠ mobileIdx global (computeDmxForCue)

**Fichier/ligne :** tick L1028-1036 (boucle sur `fixtures` = liste PAR UNIVERS de `analysis.byUniverse`,
L754) vs computeDmxForCue L1474-1480 (boucle sur `analyses` = TOUS les patchedFixtures, L1343).

**Explication :** en multi-univers, le même fixture peut avoir un `mobileIdx` différent entre le tick
(recompté à zéro dans chaque univers) et le snapshot de crossfade (index global). Conséquences :
(a) `alternate` (build) — la parité peut diverger → saut de phase de π entre le live et le snapshot pendant
le fondu de 0,15 s ; (b) `fallbackPosition` — la cellule grille diffère. En mono-univers (le cas courant)
les deux comptages coïncident. C'est un vrai défaut de cohérence live/crossfade, mais limité aux rigs
multi-univers → non bloquant, à traiter.

**Correction suggérée :** construire une fois par tick une `Map<fixtureId, mobileIdx>` globale (sur tous les
univers, hors boucle fixture) et l'utiliser aussi bien pour `spatialPhaseFor` que pour `getSmartMovement`
(qui a le même double comptage O(n) pré-existant). Cela règle à la fois le point 2 et le point 3.

### 3. Perf 60fps : comptage O(n²) par frame, y compris quand il ne sert à rien

**Fichier/ligne :** tick L1028-1036 ; computeDmxForCue L1472-1480.

**Explication :** dès qu'une cue porte `spatialPattern`, chaque fixture déclenche un scan O(n) de sa liste
pour retrouver son `mobileIdx`, à chaque frame, dans les deux chemins. En plus, ce comptage tourne **même
quand `amplitude === 0`** (le `if (spatialPattern)` précède le `if (amplitude>0)`) et même quand le pattern
est une valeur explicite. Coût réel : rig de 30 mobiles → ~900 itérations/frame ≈ quelques µs — **pas un
risque de chute à 60fps** (le code existant fait déjà 2 scans O(n) par fixture dans l'IIFE movPattern). C'est
donc une amélioration, pas un bug : précalculer `Map<fixtureId, mobileIdx>` une fois par tick (voir point 2)
et ne le faire que si `spatialPattern && !trackMovement && amplitude > 0`.

### 4. buildPresetDmxCues + preview dmxCues : fixturePositions jamais passé → grille de fallback au lieu des positions réelles

**Fichier/ligne :** `src/views/QuickShowView.tsx` L136 (buildPresetDmxCues → computeDmxForCue, 10ᵉ et 11ᵉ
args = `undefined`) et L2343-2350 (preview `dmxCues` de la timeline, 8 args → fixturePositions undefined).

**Explication :** la consigne de review supposait que L~2336 cassait la cohérence des crossfades live. **Ce
n'est pas le cas** : le vrai chemin de crossfade du hook passe bien les positions (dmx-playback.ts L682-684,
`..., disabledFixturesRef?.current, fixturePositions`). L'appel L2343 alimente uniquement la preview statique
de la timeline (dmxCues/enrichedCues), et buildPresetDmxCues alimente les dmxCues sauvegardés (consommés par
PerformanceView L1111, autoLoops). Ces chemins statiques calculent donc l'offset spatial avec
`fallbackPosition` (grille) au lieu des positions réelles → la preview et les presets figés diffèrent du live
dès que la scène réelle s'écarte de la grille 6×n. Impact visuel limité (un snapshot figé par cue), non bloquant.

**Correction suggérée :** passer `useShowStore.getState().fixturePositions` (ou le ref du composant) à
buildPresetDmxCues (nouveau paramètre) et au call L2343. 2 lignes.

### 5. Chemin legacy de genCues : pas de garde `movement === 'static'`

**Fichier/ligne :** `src/views/QuickShowView.tsx` L836 :
`spatialPattern: SPATIAL_BY_SECTION[section.type] ?? 'off'` — alors que le chemin audio-réactif garde
(L787) : `movement === 'static' ? 'off' : selectSpatialPattern(...)`.

**Explication :** en legacy, `profile.movement` peut être `'static'` (défaut intro, L259). La cue porte alors
`spatialPattern: 'wave'` → `spatialPhaseFor` ajoute un offset de phase au micro-balayage `static`
(amplitude 0.1 ≈ 10 pas DMX). Visuellement négligeable, mais l'invariant « static → off » documenté dans
le code et le test n'est pas respecté sur ce chemin.

**Correction suggérée :** `spatialPattern: profile.movement === 'static' ? 'off' : (SPATIAL_BY_SECTION[section.type] ?? 'off')`.

### 6. Doc/design : « lambda = full stage » approximatif

**Fichier/ligne :** `src/engine/dmx-movement.ts` L78-82 (docstring spatialPhaseFor).

**Explication :** l'offset est ajouté à `phase`, mais chaque pattern multiplie ensuite `phase` par son
coefficient (wave : 0.6, circle : 0.5, sweep : 0.35…). La cascade réelle couvre donc `0.6×2π` (wave), pas
`2π` — l'effet reste une vague gauche→droite correcte, mais pas le « full stage » annoncé. Si l'intention
est une vague pleine scène quel que soit le pattern, diviser l'offset par le coefficient du pattern (ou
l'ajouter après la multiplication). Cosmétique.

### 7. fallbackPosition ≠ grille du store quand des fixtures non-mobiles sont intercalées

**Fichier/ligne :** `src/engine/dmx-movement.ts` L66-70 vs `src/stores/showStore.ts` L597-607.

**Explication :** `fallbackPosition` compte les mobiles uniquement (mobileIdx), `initFixturePosition` compte
tous les patchedFixtures (index patch). Avec des pars/washes intercalés, la grille de repli diffère de la
grille réelle du store. C'est un fallback (positions réelles prioritaires partout ailleurs) → non bloquant.
Si on veut l'alignement parfait, indexer le fallback sur l'index patch complet (impossible ici sans la liste
complète — acceptable en l'état).

---

## Vérifié OK

1. **Bornes mathématiques (point 2 de la consigne)** : wave/circle ∈ [−π, +π] ; expand/contract ∈
   [−2π·√0.5, +2π·√0.5] ≈ ±4.44 rad — bornés, pas de NaN pour x,y ∈ [0,1]. `fallbackPosition` protège les
   index négatifs (`Math.max(0, mobileIdx)`). `mobileIdx = -1` ne peut pas arriver en pratique quand
   `spatialPattern` est posé : dans les deux chemins, la fixture courante fait partie de la liste comptée
   (tick : même liste par-univers itérée ; computeDmxForCue : analyses couvre tous les patchedFixtures).
   Seul cas résiduel `-1 % 2 = -1` → alternate renvoie π (groupe impair) : comportement cohérent.

2. **Alternate = indices des mobiles uniquement (point 4)** : le filtre `panOffsets.length > 0 ||
   tiltOffsets.length > 0` est présent dans les deux chemins (tick L1030-1034, computeDmxForCue
   L1474-1478). ✓ (sous réserve du point 2 ci-dessus : par-univers vs global).

3. **Cues manuelles → offset 0 (point 5a)** : genCues pousse les manualCues avec `movement: 'static'` et
   sans champ `spatialPattern` (QuickShowView L853-866) → `spatialPattern` falsy → `spatialPhaseFor` renvoie
   0. Asserté par le test (« cues manuels : jamais de pattern spatial »). ✓

4. **Chaser tracks** : le takeover chaser écrase TOUS les canaux du fixture après le bloc mouvement
   (tick L1147-1158, computeDmxForCue L1609-1622) → l'offset spatial est intégralement remplacé. ✓

5. **EFX / override pan-tilt** : le bloc mouvement (et donc l'offset spatial) est contourné quand un EFX
   ou un override efxPt est actif (L972-986). ✓

6. **TS/strict (point 6)** : `spatialPattern` est déclaré sur `CuePlayback` (L336) ; lectures via
   `(active as any)` / `(cue as any)` sans erreur ; `fixturePositionsRef` élargi à `{x,y,h?}` de façon
   cohérente (interface hook L373, signature computeDmxForCue L1338, store FixturePos). buildPresetDmxCues
   passe les cues telles quelles à computeDmxForCue (gère `undefined` → 0). PerformanceView ne lit pas
   `spatialPattern` (grep : aucune occurrence). ✓

7. **Stage3D (point 7)** : aucun changement lié à la chorégraphie spatiale. Le diff Stage3D du working tree
   concerne les lasers (roue/scan), la source des univers (showStore) et le clamp du panneau drag — sans
   lien. La 3D reflète le DMX via `onVirtualDmx`/universeData, inchangé. ✓

8. **Cohérence live/crossfade dans le hook** : l'appel crossfade interne passe bien `fixturePositions`
   (L682-684) → mêmes positions et même pattern pour le snapshot ; le décalage pré-existant
   (`movementPhase` aléatoire absent du snapshot) n'est pas une régression du patch. ✓

9. **Les 2 consommateurs de useDmxPlayback câblent fixturePositionsRef** : QuickShowView L2380-2406,
   SongPresetPlayer L63-65 + L249 ; SongPresetPlayer régénère les cues via genCues → `spatialPattern`
   conservé → lecture preset cohérente avec le live. ✓

10. **Rétro-compat presets sauvegardés** : cues 1.0.19 sans `spatialPattern` → offset 0, comportement
    inchangé. ✓

11. **Tests** : `npx vitest run src/__tests__/spatial-choreo.test.ts` → 9/9 passés (7 ms). Le test genCues
    couvre aussi le cas « cues manuels sans spatialPattern ». ✓ (note : le test ne couvre pas le cas
    trackMovement — cf. problème bloquant n°1.)

12. **fallbackPosition == formule du store** : `0.1 + col*0.16`, `0.1 + row*0.18`, `col = idx % 6`,
    `row = floor(idx/6)` — identique à initFixturePosition (showStore L597-607). ✓ (hors point 7 ci-dessus.)

---

## Verdict

**Un problème bloquant** (n°1 : offset spatial appliqué aux fixtures sous movement track — à corriger
avant livraison, correction de 2 lignes fournie). **Six non-bloquants** (n°2-7), dont n°2/n°3 à traiter
ensemble par un précalcul `Map<fixtureId, mobileIdx>` global par tick. Le reste est sain ; en particulier
la consigne « crossfade via L2336 = fallback grille » ne se vérifie pas sur le chemin live (le hook passe
les positions), uniquement sur les chemins preview/presets figés (point 4).
