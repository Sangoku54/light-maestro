# review.md — Chorégraphie spatiale 1.0.20 (lot 1)

## Revue adverse (subagent_04)
- **Bloquant #1 (corrigé)** : l'offset spatial s'appliquait aussi aux fixtures sous
  movement track utilisateur (`trackMovement`) → déphasage jusqu'à ±π sur la chorégraphie
  écrite à la main. Fix appliqué : garde `&& !trackMovement` sur le comptage + la phase,
  dans le tick (L1030/L1047) et computeDmxForCue (L1474/L1482).
- **Non-bloquant #5 (corrigé)** : chemin legacy genCues sans garde `movement === 'static'`
  → garde ajoutée (`profile.movement === 'static' ? 'off' : ...`).

## Non-bloquants reportés au lot 2 (documentés, pas bloquants)
- #2 : alternate en rig multi-univers — le tick compte mobileIdx par univers, compute
  globalement → parité divergente pendant un crossfade < 0.3s. Mono-univers : OK.
- #3 : comptage mobileIdx O(n) par fixture par frame quand spatialPattern existe
  (~µs à 30 fixtures, pas un risque 60fps). À précalculer en lot 2.
- #4 : buildPresetDmxCues + preview dmxCues ne passent pas fixturePositions → fallback
  grille dans les presets figés/preview. Acceptable (les presets sont statiques).
- #6 : docstring « lambda = full stage » approximative (coefficients 0.35-0.6 du pattern).
- #7 : fallbackPosition indexe les fixtures mobiles, pas la grille de patch du store.

## Vérifié OK par la revue adverse
Bornes mathématiques sans NaN, alternate = fixtures mobiles uniquement (2 chemins),
cues manuelles → 0, chaser takeover écrase après coup, EFX contourne le bloc,
TS strict propre, Stage3D inchangé (miroir DMX pur), 2 consommateurs useDmxPlayback
câblent fixturePositionsRef, rétro-compat presets 1.0.19.

## Validation finale
tsc 0 · vitest 299/299 (290 existants + 9 nouveaux spatial-choreo).
