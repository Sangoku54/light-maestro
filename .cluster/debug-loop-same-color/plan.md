# Debug « Boucle unique joue toujours la même chose »

## Symptôme utilisateur (verbatim)
« je suis dans quick show, 3e onglet 'Loops auto'. j'appuie sur jouer et ça joue
toujours la même chose (il n'y a pas d'onglet timeline), mais pas les blocs cues
de la loop auto. si je change d'onglet pendant la lecture, elle s'arrête. es-tu
sûr d'envoyer la bonne info aux fixtures ? »

## Faits établis en mainline (S1)
- `AutoLoopsPanel.tsx` : `play()` → `writeFrame(frames[0])` puis `setInterval(beatMs)` qui avance `frameIdxRef` et appelle `writeFrame(frames[next])`. Avance bien.
- `generateThemeLoop` : 64 cues (16 bars × 4 beats), `time` distincts (0, 0.5, 1.0, …), `color = palette[beat % palette.length]`.
- `computeDmxCues` : `paletteColor = forcedColor || color || colors[0]`, `hexToRgb` + `applyHueShift(TIER_HUE[tier])`, écrit R/G/B aux offsets. **Le test `theme-loop.test.ts` prouve que les valeurs RGB changent entre cues** (2 couleurs → 2 sorties distinctes).
- Palettes : Violet = 3 violets quasi identiques (#a855f7/#8b5cf6/#c084fc) + 1 ivoire (#ede8dc). Idem Ocean/Ember/Forest (3 nuances même teinte + 1 clair).
- `computeDmxCues` écrit `time: cue.time` → `frames` = 64 frames distinctes.

## Axes d'investigation (parallèles)
| # | Subagent | Axe | Output |
|---|----------|-----|--------|
| A | Trace écriture DMX → hardware | univers (0-based cohérent ?), source `vc` (LTP 80) enregistrée, buffer arbitré changeant, sources masquantes | subagent_A_dmx-path.md |
| B | Trace mouvement pan/tilt section `loop` | `getMovementConfig`/`computeMovement` pour sweep/wave/pulse/circle (ampl 64) : le pan/tilt bouge-t-il vraiment ? | subagent_B_movement.md |
| C | Distinctivité perceptuelle des palettes | RGB + Δ entre cues consécutifs (après hue-shift) pour les 4 thèmes ; recommandation palettes distinctes | subagent_C_palette.md |
| D | Revue adversariale panneau + régression | frames grouping, play/stop/visible, multi-univers, régression commit 3bba1e7 | subagent_D_review.md |

## Dépendances
Aucune — les 4 tournent en parallèle (S3). Puis revue (S4) et fix + livraison (S5).
