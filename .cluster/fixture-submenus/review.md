# Revue adversarial — sous-menus de capacités & générateur d'autoscript

Date : 2026-08-23 · Reviewer : subagent (revue code, aucune modification des sources)
Fichiers relus : `src/engine/fixture-analyzer.ts`, `src/hooks/dmx-cues.ts`, `src/views/DesignView.tsx`, `src/engine/auto-loops.ts`, `src/views/AutoLoopsPanel.tsx`, `src/__tests__/auto-loops.test.ts`.

Vérifications factuelles effectuées :
- `npx vitest run src/__tests__/auto-loops.test.ts` → **30/30 tests passent**.
- `npx tsc --noEmit -p tsconfig.json` → **aucune erreur** dans les fichiers modifiés.
- Inspection des fixtures réelles : `resources/fixtures/robe-robin-300e.json`, `resources/fixtures/chauvet-slimpar-56.json`, `electron/fixtures/library.ts` (PRESET_TYPE_MAP GDTF).

---

## Problèmes

### HAUTE

**H1 — Les boucles beam (zoom/frost/iris/focus) sont inatteignables pour les fixtures réelles.**
- `src/engine/auto-loops.ts:204` `beamOffsetOf()` et `:477` `buildBeamLoop()` lisent `fa.zoomOffset / frostOffset / irisOffset / focusOffset`.
- Or `src/engine/fixture-analyzer.ts:186-197` ne peuple ces offsets QUE pour les types de canal dédiés `'Zoom'/'Frost'/'Focus'/'Iris'`.
- Les fixtures réelles utilisent `type: 'Beam'` pour ces canaux :
  - `resources/fixtures/robe-robin-300e.json` → `"name": "Focus", "type": "Beam"`.
  - `electron/fixtures/library.ts:156-159` → `BeamZoom/BeamFocus/BeamFrost/BeamIris → 'Beam'`.
- Le `case 'Beam':` (`fixture-analyzer.ts:201-202`) ne peuple que `fa.beamOffset`, qui n'est utilisé par **aucun** builder.
- Conséquence : `generateAutoLoops`/`generateLoopLibrary`/`generateLoopFromRecipe` filtrent `beamOffsetOf(...) !== null` → toujours `null` pour toute fixture bundlée/importée GDTF. Les 4 loops `beam-*` ne se génèrent que si l'utilisateur retape manuellement le type du canal en `'Zoom'/'Frost'/'Focus'/'Iris'` dans l'éditeur.
- **Fix** : dans `case 'Beam':`, détecter le sous-canal par nom (`/\bzoom\b/i`, `/\bfrost\b/i`, `/\biris\b/i`, `/\bfocus\b/i`) pour peupler les offsets dédiés ; OU faire retomber `beamOffsetOf` sur `fa.beamOffset` en fallback. (Le module dmx-color.ts fait déjà la même chose par nom pour RGB via `hasColorWord`.)

### MOYENNE

**M2 — `isPresetMode` écarte silencieusement des canaux porteurs de capacités.**
- `src/engine/fixture-analyzer.ts:121-124` : `if (isPresetMode.test(chName)) { ...; continue; }` avec `isPresetMode = /presets?|macro|auto|sound/i` (`src/engine/dmx-color.ts:77`). Ce `continue` se produit AVANT le `switch (ch.type)` → le canal est exclu de toute analyse (effect/gobo/prism/speed/wheel y compris).
- Cas réels :
  - `resources/fixtures/chauvet-slimpar-56.json` → `"name": "Color Macro", "type": "Colour"` avec capabilities → exclu (pas de color-wheel).
  - Imports GDTF : `electron/fixtures/library.ts:128` `PositionPanTiltMacro → 'Effect'` et `:153` `PrismMacro → 'Prism'` → le nom affiché contient « Macro » → exclu (pas d'effect/prism).
- **Fix** : ne pas `continue` inconditionnellement ; reporter l'exclusion sur les canaux sans capabilities, ou exclure uniquement `ch.type === 'Macro'` (déjà couvert par `:127`), ou traiter les capabilities AVANT le test preset. Ajouter un test unitaire avec un canal `Effect` nommé « Macro ».

**M3 — Prism : capabilities ignorées + états codés en dur.**
- `src/engine/fixture-analyzer.ts:183-184` ne capture pas les caps prism (aucun champ `prismCaps` dans `FixtureChannelAnalysis`).
- `src/engine/auto-loops.ts:455` `PRISM_STATES = [128, 170, 255, 0]` écrit en dur, sans lien avec les plages réelles. Ex. `robe-robin-300e.json` prism = `0-10 Open / 11-255 3-facet` → 128 et 170 sont des valeurs arbitraires (ok par chance ici, mais pas garanties).
- **Fix** : ajouter `prismCaps: DmxFixtureCapability[]` à l'analyseur, et utiliser `capMid()` pour les états « inséré » (0 = retiré conservé).

### BASSE

**B4 — Builders non défensifs sur division/modulo (invariant porté par les appelants).**
- `src/engine/auto-loops.ts:351/383/423` : `Math.min(...map)` → `Infinity` sur tableau vide ; `:357/389/430` `% caps.length` → `NaN` si `caps.length === 0`.
- Aujourd'hui protégé : les 3 entrées (`generateAutoLoops`, `generateLoopLibrary`, `generateLoopFromRecipe`) exigent `wheelCaps.length > 0`, `goboCaps.length > 0`, `(effectCaps?.length ?? 0) > 0` avant d'appeler les builders. Aucune faille exploitable constatée.
- **Fix** : `if (capCount === 0) return { ... }` (ou `Math.max(1, ...)`) en tête de chaque builder pour rendre l'invariant local.

**B5 — Redondance `variant` vs `palette` + doc trompeuse.**
- `src/engine/auto-loops.ts:63,87` : `variant` est documenté « gobo · beam-* », mais `buildColorChase` l'utilise comme nom de palette (`palette: variant`) et `loopToRecipe` copie les deux (valeurs identiques pour color-chase).
- **Fix** : clarifier le commentaire ou séparer les deux champs.

**B6 — Gobo : le step 0 écrit speed=128 (stop) au lieu de rotation lente.**
- `src/engine/auto-loops.ts:392` : `128 + round(127 * step / capCount)` démarre à 128, qui est « stop » sur la plupart des roues (1-127 CW lent→rapide, 129-255 CCW).
- **Fix** : `129 + Math.round(126 * step / capCount)` si on veut démarrer en rotation.

**B7 — Effect : seul le premier canal Effect est capturé, même sans caps.**
- `src/engine/fixture-analyzer.ts:161-165` : `if (fa.effectOffset === null)` fige `effectCaps` sur le premier canal Effect ; si celui-ci n'a pas de caps (ex. `robe-robin-300e` « Prism Rotation » type Effect sans caps) et qu'un second en a, le second est ignoré → pas d'effect loop.
- **Fix** : capturer l'offset/caps du premier canal Effect **ayant** des caps.

---

## Points validés (non-régression)

- **P1 — Plages DMX** : color-wheel / gobo / effect écrivent bien `capMid(cap) = round((min+max)/2)` (`auto-loops.ts:198`), jamais 0/255 en dur. Vérifié sur la roue couleur du robin (White→5, Split→99, CCW→192). Prism/beam en dur sont justifiés par l'absence de caps continues (cf. M3 pour le prism).
- **P2 — Sécurité modulo** : tous les appels sont gardés par des filtres amont longueur>0 dans les 3 fonctions d'entrée (cf. B4).
- **P3 — Types** : `fixture-analyzer.ts` exporte bien `ChannelAnalysis` (alias de `FixtureChannelAnalysis`, `:38`) et `analyzeChannels` (`:306`). Tous les champs utilisés (`effectCaps`, `wheelCaps`, `goboCaps`, `speedOffset`, `zoomOffset`, `frostOffset`, `irisOffset`, `focusOffset`, `prismOffset`, `rgbSegments`, `panOffsets`, `tiltOffsets`, `intensityOffset`, `shutterOffset`) existent.
- **P4 — Exhaustivité** : `LOOP_KIND_LABEL` (`:25-37`), `LOOP_KIND_ORDER` (`:40-43`), `KIND_META` (`AutoLoopsPanel.tsx:10-23`) couvrent les 12 kinds. Les 2 `switch` sur `AutoLoopKind` (`generateLoopLibrary` `build()`, `generateLoopFromRecipe`) couvrent les 12 + `default`. Aucun autre `switch`/`Record` sur le kind n'existe (vérifié dans PerformanceView, auto-loop-player, SoundSwitchAutoloop).
- **P5 — Éditeur** : bloc unifié de capacités rendu pour tous les types (`DesignView.tsx:6974-7007`) ; le sélecteur couleur n'apparaît que pour `ch.type === 'Colour'` (`:6994`), et `addCapability` n'injecte `color` que pour Colour (`:6876-6882`). Mapping de préchargement corrigé (`defaultVal`→`defaultValue`, `caps`→`capabilities`) sans résidu.
- **`case 'Strobe':`** : ajouté au type (`dmx-cues.ts:40`) et à l'analyseur (`fixture-analyzer.ts:157-158`), traité comme Shutter. Cohérent.

---

## Verdict : **NO-GO**

Motif bloquant : **H1**. L'exigence 2 (« exploiter TOUS les sous-menus de TOUTES les fixtures ») n'est pas satisfaite pour les 4 capacités beam (zoom/frost/iris/focus), inaccessibles pour les fixtures réelles bundlées/importées GDTF (type `Beam`, non `Zoom/Frost/Focus/Iris`). Les boucles beam ne se matérialisent qu'après retapage manuel du type de canal dans l'éditeur — ce qui ne répond pas à « toutes les fixtures ».

M2 (exclusion `macro/auto/sound`) est à traiter dans la foulée car elle supprime aussi silencieusement des canaux effect/prism/gobo-speed de fixtures réelles. Color-wheel et gobo fonctionnent correctement sur les fixtures réelles testées (robin). Les 30 tests unitaires passent et le typage est propre ; aucun défaut de sécurité division/modulo exploitable.

## Résumé (8-12 lignes)

La refonte des sous-menus et des autoloops est globalement solide : plages DMX respectées via `capMid`, aucun crash modulo (filtres amont), types/exhaustivité propres, éditeur unifié correct (couleur préservée pour Colour), 30 tests verts, tsc sans erreur. Deux défauts empêchent le GO. **H1 (bloquant)** : les boucles `beam-zoom/frost/iris/focus` lisent `zoomOffset`…`focusOffset`, qui ne sont peuplés que pour les types dédiés `Zoom/Frost/Focus/Iris` ; or toutes les fixtures réelles (bundlées + import GDTF) typent ces canaux `Beam` (`library.ts:156-159`, `robe-robin-300e` « Focus »), et `case 'Beam'` ne remplit que `beamOffset` (inutilisé) → les 4 boucles beam ne se génèrent jamais pour elles. **M2** : `isPresetMode` (`/macro|auto|sound|preset/`) fait `continue` avant le switch de type et exclut des canaux porteurs de capacités (« Color Macro » chauvet, `PositionPanTiltMacro`/`PrismMacro` GDTF). Correctifs secondaires : prism sans caps (M3), builders non défensifs (B4), redondance `variant`/`palette` (B5), speed gobo à 128=stop (B6), premier canal Effect sans caps (B7). Verdict : **NO-GO** jusqu'à correction de H1 (+ M2 fortement recommandée).
