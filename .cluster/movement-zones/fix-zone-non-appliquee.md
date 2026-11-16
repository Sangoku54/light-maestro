# Correction — zone de mouvement non appliquée (v1.0.4)

Date : 2026-08-20. Bug corrigé dans les commits `6366f68` (fix) et `9d04ef1` (bump 1.0.4).

## Cause racine

`useDmxPlayback` lit `fixturePositions = fixturePositionsRef?.current` à **chaque frame**
(`dmx-playback.ts` l.563, dans la boucle `tick`). Or ce ref n'était passé par **aucun** appelant :

- `QuickShowView.tsx` (l.2252) : appel `useDmxPlayback({...})` **sans** `fixturePositionsRef`.
- `SongPresetPlayer.tsx` (l.226) : idem.

Conséquence : `fixturePositions` valait toujours `undefined` → `clampPan(raw, undefined)` / `clampTilt(raw, undefined)`
retournaient `raw` (aucun clamp). **Ni la zone, ni même l'ancien clamp scène (`clampPanToStage`), ne s'appliquaient.**
C'est pour ça que sélectionner ou non un pictogramme ne changeait rien : le moteur n'avait jamais les positions.

La vue 3D, elle, lit bien `fixturePositions` (showStore) et le DMX (appStore) — donc elle « aurait » pu refléter
la zone, mais le DMX qu'elle recevait n'était jamais clampé.

## Correction

- `QuickShowView.tsx` : abonnement à `fixturePositions` + `fixturePositionsRef` gardé en synchro, passé à `useDmxPlayback`.
- `SongPresetPlayer.tsx` : `fixturePositionsRef` créé et passé à `useDmxPlayback`.

Effet : la zone s'applique maintenant pendant la lecture (2 sites de clamp + chemins EFX, tous offsets).
**Note** : l'ancien clamp scène `clampPanToStage`/`clampTiltToStage` était lui aussi inactif → il s'applique désormais
aux fixtures **sans** zone (comportement scène attendu), ce qui peut modifier le rendu global par rapport à avant.

## Validation

- `tsc --noEmit` clean.
- `vitest` : 170/170 verts.
- exe `1.0.4` reconstruit, anciens `1.0.3` supprimés.

## Test sur PC live

1. Éditeur 2D → sélectionner chaque wash → lui attribuer son pictogramme (sol gauche / sol droite / pont arrière).
2. Lancer un show (QuickShow ou un preset).
3. Vérifier que chaque lyre reste dans son cône (ex. la lyre de gauche ne balaye que vers la scène, plus vers le mur).
