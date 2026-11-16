# Plan — Sous-menus paramétrables + exploitation des capacités par l'autoscript

## Intention utilisateur
1. Toutes les options du menu déroulant « type de canal » (éditeur de fixtures) doivent
   avoir le sous-menu paramétrable (capacités min/max/nom, + couleur pour Colour).
   Aujourd'hui seuls Colour / Gobo / Macro l'ont.
2. L'autoscript (génération de boucles/cues) doit analyser et exploiter TOUS les
   sous-menus (= capacités) de TOUTES les fixtures, pas seulement RGB/pan-tilt/dimmer/shutter.

## État constaté (S1)
- Éditeur : `src/views/DesignView.tsx` → `FixtureEditorModal.renderChannel` (≈l.6944).
  `CHANNEL_TYPES` (l.6726) : Intensity, Pan, Tilt, Colour, Gobo, Shutter, Strobe, Speed,
  Prism, Effect, Beam, Macro, Nothing, Maintenance. Sous-menu capacités seulement pour
  Colour (couleur), Gobo, Macro (3 blocs dupliqués).
- Analyseur : `src/engine/fixture-analyzer.ts` `analyzeFixtureChannels()` produit
  wheelCaps, goboCaps, effectCaps, prismOffset, zoomOffset, frostOffset, irisOffset,
  focusOffset, beamOffset, speedOffset, macroOffsets… (switch : Intensity, Shutter, Effect,
  Pan, Tilt, Gobo, Prism, Zoom, Frost, Focus, Iris, Speed, Beam, Colour, Macro).
- Générateur boucles : `src/engine/auto-loops.ts` n'exploite QUE rgbSegments, pan/tilt,
  intensity, shutter. Ignore wheel/gobo/effect/prism/zoom/frost/iris/focus/speed/macro.
- Générateur temps réel : `src/hooks/dmx-cues.ts` `computeDmxCues()` exploite déjà
  wheel/gobo/prism/effect/speed/macro (plus complet).

## Sous-tâches
1. [subagent_editor_ui.md] Analyse + refactor éditeur : sous-menu capacités pour tous les
   types (un seul bloc paramétré), réconciliation CHANNEL_TYPES vs analyseur.
   → subagent `editor-submenu-analysis`.
2. [subagent_generator_caps.md] Analyse + proposition nouveaux AutoLoopKind (gobo, color
   wheel, effect, prism, zoom/frost/iris) + LoopRecipe + stratégie de test.
   → subagent `generator-caps-analysis`.
3. Implémentation (main) : appliquer les changements dans DesignView.tsx + auto-loops.ts
   (+ fixtures de test), en respectant cap.min/cap.max.
4. Revue adversarial (subagent) : vérifier l'implémentation (types, portée, non-régression).
5. Vérification : `tsc` electron + renderer, `vitest` (suite complète), livraison.

## Dépendances
1 et 2 en parallèle → 3 → 4 → 5.

## Fichiers de sortie
- `.cluster/fixture-submenus/subagent_editor_ui.md`
- `.cluster/fixture-submenus/subagent_generator_caps.md`
- `.cluster/fixture-submenus/review.md`
