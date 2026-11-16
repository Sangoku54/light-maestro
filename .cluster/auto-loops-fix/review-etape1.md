# Revue critique — commit `a00a755` (auto-loops: fill visible + palette contrast)

**Date** : 2026-08-20
**Relecteur** : subagent revue étape 1
**Tests** : `npx vitest run src/__tests__/auto-loops.test.ts` → **19/19 passent**.

---

## Verdict global : PASS

Le correctif est correct, chirurgical et équivalent au code d'origine. Aucun bug d'adressage DMX ni régression détecté. Un point d'étape 2 (non bloquant) est signalé au §4.

---

## Problèmes trouvés

Aucun bloquant, aucun mineur. Une seule suggestion (étape 2, non bloquante) :

1. **[suggestion / étape 2]** `buildStrobeLoop` n'écrit pas RGB=0 sur la frame OFF (`src/engine/auto-loops.ts:256`). Voir point de contrôle 4.

---

## Points de contrôle

### 1. Adressage dans `putRgbSegments` — OK
`putRgbSegments` écrit `absAddr(pf, seg.r/g/b/w)` où `absAddr(pf, offset) = pf.startAddress + offset` (`auto-loops.ts:120-123`). Les offsets de `RgbSegment` (`r/g/b/w`) sont bien des offsets **relatifs au canal** (définis dans `buildRgbSegments`, `dmx-color.ts:81`, comme `colourChannels[i].offset`). La conversion est donc correcte et **strictement identique** à l'ancien bloc inline de `buildColorChase` (supprimé dans le diff, lignes 141-147 d'origine). Aucun changement d'adressage.

### 2. Équivalence du refactor — OK
Le bloc extrait est copié mot pour mot : même boucle `for (const seg of analysis.rgbSegments)`, mêmes 3 `put` R/G/B, même garde `if (seg.w !== null)` avec écriture de `0` sur W. La signature `c: readonly [number, number, number]` correspond au type des couleurs de palette. Aucun comportement perdu. Le comportement W=0 sur RGBW est conservé (identique à l'ancien chase).

### 3. Remplissage mouvement vs chase de couleur — OK (pas de conflit)
Confirmé : ces boucles sont des **scènes distinctes**. Dans `generateAutoLoops`, `rgb` et `movers` sont deux filtres séparés (`auto-loops.ts:311-321`), et chaque boucle est matérialisée en scènes/chasers **indépendants** (`materializeAutoLoops`, une scène par step). Un moving-head RGB est présent à la fois dans le loop `color-chase` (couleur palette) et dans le loop `movement` (fill blanc) — mais dans des scènes différentes, jamais dans la même frame. Le remplissage `VISIBLE_FILL` injecté en `auto-loops.ts:198` est à l'intérieur de `buildMovementLoop`, sur des `movers` uniquement. Aucune écriture concurrente dans une même frame. Un chevauchement éventuel ne surviendrait qu'en lecture simultanée (HTP) par l'utilisateur, ce qui n'est pas un bug de code.

### 4. Remplissage strobe OFF — OK (avec réserve étape 2)
`auto-loops.ts:256` : `if (on && analysis.rgbSegments.length > 0) putRgbSegments(...)`. Sur la frame OFF, le RGB n'est pas écrit → résidu potentiel du RGB de la frame ON **uniquement** dans un moteur de lecture à état partiel. Mais comme l'intensité (si `intensityOffset !== null`) et le shutter sont mis à 0 sur OFF (`auto-loops.ts:257-258`), la sortie est noire de toute façon. **Suggestion étape 2** : pour la robustesse (moteur HTP pur où le RGB résiduel pourrait se re-combiner, ou fixtures à shutter mais sans dimmer), écrire `putRgbSegments(frame, pf, analysis, [0,0,0])` sur la frame OFF. Non bloquant.

### 5. Renommage `violet` → `vivid` — OK
Aucune référence résiduelle au nom de palette `'violet'` : seuls restent des **commentaires** (`auto-loops.ts:58,61` et un commentaire de test `auto-loops.test.ts:105`) et les fixtures thumbnails `par-uv`/`uv-bar` (ultraviolet, sans rapport). `'vivid'` n'apparaît qu'à sa définition `auto-loops.ts:91` et circule via `pal.name` → `variant` → id/nom de loop (aucun lookup par nom de palette ailleurs). Les mots-clés "Violet" dans `dmx-color.ts`/`dmx-cues.ts` sont des mots-clés de wheel couleur (catégorie purple), sans rapport avec la palette.

### 6. Tests — OK
- **Fill mouvement** (`auto-loops.test.ts:145-156`) : vérifie `channels[12/13/14] === 255` sur chaque step pour `mover-rgb` (startAddress 9 → R@3=12, G@4=13, B@5=14). Teste réellement le comportement visé.
- **Fill strobe** (`auto-loops.test.ts:375-390`) : vérifie `on[3/4/5]=255` (RGB), `on[2]=255` (intensité), `off[2]=0`. Correct ; la baseline de `generateLoopLibrary` garantit un loop `strobe` (le fixture a `shutterOffset=0`), donc `find` réussit toujours.
- **Contraste palette** (`auto-loops.test.ts:158-173`) : calcule la distance RGB minimale entre les 4 couleurs du chase et exige ≥ 50. Teste réellement le contraste.
- **Rotation palette-agnostique** (`auto-loops.test.ts:117-129`) : remplace les valeurs codées en dur (168/139/192) par des invariants structurels — `Set(f1Reds).size === 4` (4 rouges distincts) et `f2Reds[i] === f1Reds[(i+1)%4]` (décalage de rotation). Correct et indépendant de la palette.

### 7. Contraste — OK (vérifié)
Distances euclidiennes de `CHASE_COLORS` (toutes les paires) :

| paire | distance |
|---|---|
| violet↔cyan | 203.75 |
| violet↔ambre | 240.09 |
| violet↔vert | 211.61 |
| cyan↔ambre | 334.89 |
| cyan↔vert | **172.70** |
| ambre↔vert | 187.95 |

**Minimum = 172.70 ≥ 50** → l'assertion du test est vérifiée. (Ancienne palette : min ≈ 29.85 entre les 2 premiers violets, cohérent avec le diagnostic "chase statique".)

---

## Note complémentaire (hors scope, non bloquant)

Les movers à **roue de couleur** (`wheelOffset != null`, pas de `rgbSegments`) ne reçoivent toujours pas de fill visible dans `buildMovementLoop` (le garde est `rgbSegments.length > 0`). Ce n'était pas l'objet de R4 (moving-head RGB) et `analyzeChannels` rend `rgbSegments`/`wheelOffset` mutuellement exclusifs, donc aucun conflit. À traiter éventuellement en étape 2 si on veut que les têtes à gobo/couleur-wheel soient aussi visibles en mouvement.
