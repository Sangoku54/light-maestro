# Relecture — Rétrécissement des plages pan des presets de zone

Objet : nouvelle valeur des `panMin/panMax` dans `MOVEMENT_ZONE_PRESETS` (`src/engine/dmx-movement.ts`).
Relecture : subagent `Relecteur plages pan zone` — 2026-08-20.

## Verdict

**Aucun problème bloquant ni moyen. La modification est correcte et cohérente.**

## Problèmes trouvés

1. **Documentation de spec devenue obsolète (gravité : mineur)**
   - Fichiers : `light-maestro/.cluster/movement-zones/spec-movement-zones.md` (lignes 29-31) et `light-maestro/.cluster/movement-zones/review-implementation.md` (ligne 27).
   - Ces docs décrivent encore les anciennes plages pan : « sol gauche 128→255 », « sol droite 0→128 », « sol centre 64→192 ». Le code applique désormais 128→170 / 86→128 / 107→149. Ce ne sont que des notes de travail (pas du code), donc sans impact fonctionnel, mais elles contredisent maintenant l'implémentation et pourraient induire en erreur une prochaine relecture.
   - (À noter : `zone-3d-cone.md` est, lui, à jour — lignes 43-45 décrivent bien les nouvelles bornes.)

Aucun autre problème détecté.

## Points vérifiés (tous conformes)

1. **Neutralité DMX 128** — chaque preset contient encore 128 en pan ET en tilt :
   - floor-left [128,170] ✓ · floor-right [86,128] ✓ · floor-center [107,149] ✓
   - rear-truss [107,149] ✓ · front-truss [107,149] ✓ · audience [0,255] ✓ · locked [128,128] ✓
   - Tilt inchangé : sol 128-255, pont 0-128, audience 0-255, locked 128-128 — 128 toujours inclus. L'état « off » (pan=tilt=128, écrit en dur aux lignes 927 et 1356-1357 de `dmx-playback.ts`, ou via EFX `v=128`) reste dans la zone. Le test « keeps the DMX neutral 128 inside every preset » le verrouille.

2. **Cohérence directionnelle** — floor-left `panMin=128, panMax=170` (>128, balaie vers la droite, `dirDeg=0`) et floor-right `panMin=86, panMax=128` (<128, balaie vers la gauche, `dirDeg=180`). Conforme à la convention pan du code (`pan>128` → `armGroup.rotation.y > 0`, direction `dirDeg=0`), et au test « encodes directional pan ».

3. **Plages TILT non modifiées** — sol 128→255, pont 0→128 (test « mount-aware tilt » vérifie floor-left et rear-truss). Aucune altération accidentelle.

4. **Priorité zone > clamp scène > brut** — `clampPan`/`clampTilt` (`dmx-movement.ts:66-83`) restent des min-max génériques sur `fp.zone.panMin/panMax` (aucune borne codée en dur) ; le fallback `clampPanToStage`/`clampTiltToStage` est inchangé. Les nouvelles bornes passent à travers `fixturePositions[id].zone` (écrites avec `id` par `Stage2DEditor`), consommées par `clampPan`/`clampTilt` (dmx-playback.ts:998, 1340-1341) et par le clamp EFX direct `zone0.panMin/panMax` (dmx-playback.ts:921-927). Aucune dépendance aux anciennes valeurs.

5. **Autres dépendances aux anciennes bornes** — vérifié exhaustivement (`Select-String` sur `panMin|panMax|MOVEMENT_ZONE_PRESETS|getMovementZonePreset` dans `src/`) :
   - `Stage2DEditor.tsx` : le pictogramme n'utilise que `dirDeg`/`halfDeg`/`locked` (inchangés) via `zoneConeGeometry` ; la détection d'état actif compare `zp.id === z.id` (les zones sont stockées avec `id`, donc rear-truss vs front-truss restent distinguables malgré des plages identiques). Le fallback « legacy » par comparaison de ranges ne se déclenche plus en pratique. Aucun impact.
   - `Stage3D.tsx` : `getMovementZonePreset` n'est utilisé que pour le cône (`dirDeg`/`halfDeg`), jamais pour `panMin/panMax`. Le rendu du faisceau lit les valeurs DMX réelles. Aucun impact.
   - `dmx-cues.ts:52` / `electron/fixtures/library.ts` : `panMax` = limite physique de fixture (QLC+), sans rapport avec les zones.
   - `showStore.ts:170`, `QuickShowView.tsx:1665`, `SongPresetPlayer.tsx:83` : simple type `FixturePos.zone`, générique.

6. **Cohérence du test « narrows pan vs the stage clamp »** — les hypothèses sur le clamp scène sont exactes :
   - x=0 → `[128,255]` (floor-left `panMax=170 < 255` ✓)
   - x=1 → `[0,128]` (floor-right `panMin=86 > 0` ✓)
   - x=0.5 → `[64,192]` (floor-center `107 > 64` et `149 < 192` ✓)
   - Vérifié par calcul direct de `clampPanToStage` : x=0 ⇒ `128 + max(0, min(128, d))` = `[128,255]` ; x=1 ⇒ `[0,128]` ; x=0.5 ⇒ `[64,192]`. Test correct.

## Observation (non bloquante, à confirmer visuellement)

Les trois presets floor-center / rear-truss / front-truss partagent désormais la même plage pan `[107,149]` (42 unités ≈ 90° de pan physique, cohérent avec `halfDeg=45` du cône 3D). rear-truss et front-truss sont de toute façon identiques en pan+tilt ([107,149] / [0,128]) et ne diffèrent que par `dirDeg` (90 vs 270) — situation préexistante, non introduite par cette modification. Le cône 3D et la détection d'état actif s'appuient sur `id`, donc sans régression fonctionnelle. L'effet visuel du rétrécissement (amplitude de balayage pan réduite d'environ 270° → 90°) reste à valider à l'œil dans l'app, conformément à la règle « test visuel avant livraison ».
