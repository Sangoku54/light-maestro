# Revue (S4) — Debug « Boucle unique joue toujours la même chose »

## Synthèse des 4 enquêteurs

| # | Axe | Verdict |
|---|-----|---------|
| A | Écriture DMX → hardware | **Correct** : RGB distincts par frame, univers 0-based cohérent, flush OK. Cause secondaire trouvée : sources LTP ≥ 80 jamais relâchées (`simple-desk` 100, `fixture-test` 90 à l'unmount, `vc` partagé avec Virtual Console). |
| B | Mouvement pan/tilt section loop | **Correct** : pan/tilt 64→192, amplitude 64 non nulle, perceptible. Cause écartée. |
| C | Distinctivité des palettes | **CAUSE PRINCIPALE** : 4 rampes monochromatiques (ΔHue 0–3° pour Forest, 12° pour Violet). ΔE76 min 10–36 → perçu comme « toujours la même couleur ». |
| D | Revue adversariale panneau | **ÉCHEC** (contexte perdu, 37 tool calls sans sortie). Remplacée par une revue mainline (voir ci-dessous). |

## Revue mainline d'AutoLoopsPanel.tsx (remplace D)

- `frames` : `Math.abs(dc.time - last) > 0.0001` regroupe correctement les cues par temps distincts (0, 0.5, 1.0, …) → **64 frames**, pas une seule. ✅
- `play()` : `stop()` puis `writeFrame(frames[0])` puis `setInterval(beatMs)` avec `next = (idx+1) % frames.length`. Avancement correct. `stop()` ne noircit que si `intervalRef.current` non nul (pas de blackout au premier play). ✅
- Effet `visible` : n'agit que si `intervalRef.current` actif, sinon no-op au montage. ✅
- `writeFrame` : `dc.universe` (0-based) utilisé pour `dmxBridge.write` ET `setUniverseData`, cohérent (confirmé par A). ✅
- **Aucun bug de blocage sur une frame unique.**

## Correctif appliqué (commit à suivre)

1. **`src/engine/theme-loop.ts`** — remplacement des 4 palettes monochromes par 4 palettes saturées bien séparées (min ΔE76 79–116) :
   - Neon `#ff0055 #00e5ff #7cff00 #8b00ff` (sweep)
   - Rave `#ff1a1a #1aff1a #1a1aff #ffcc00` (wave)
   - Arctic `#ff0055 #00ffcc #ffaa00 #4400ff` (pulse)
   - Magma `#ff3c00 #ffd400 #00ffcc #9b30ff` (circle)
2. **`src/views/AutoLoopsPanel.tsx`** — fallback par défaut `'Violet'` → `'Neon'` (cosmétique, [0] toujours défini).
3. **`src/hooks/usefixturetest.ts`** — ajout `dmxBridge.release('fixture-test')` au cleanup d'unmount (fuite LTP 90 signalée par A, cause possible de fige des RGB).

## Vérifications
- `tsc --noEmit` : exit 0.
- `vitest run` : 161/161 (12 fichiers).
- `vite build` : 1494 modules, OK.

## Restent (hors périmètre, préexistants)
- `simple-desk` : pas de release au démontage du panneau (mitigé par `handleModeChange` qui release en quittant `perform`).
- `vc` partagé entre AutoLoops et Virtual Console (PerformanceView) : risque de conflit à priorité égale 80 si une scène/chaser VC tourne pendant la boucle.
- `PerformanceView.tsx:2147` : slider VC univers hardcodé `1`.
