# Modèle de mouvement AutoScript → Moteur → Vue 3D

Date : 2026-08-13 — Base de discussion validée avec l'utilisateur (question : « tous les mouvements sont calculés depuis pan/tilt à 0 ? »)

## Réponse verrouillée

**NON — tout le système est centré sur DMX 128/128 (position neutre), jamais sur la valeur DMX 0.**

La chaîne est cohérente de bout en bout : génération écrit des *offsets* autour du centre, moteur et 3D lisent autour du centre.

## 1. Génération (`genCues`, src/views/quickshowview.tsx)

- **Cadence** : une cue par intervalle de beat (section × BPM).
- **Champ pattern** (`selectMovementPattern` l.455-523) : pools par type de section (intro/verse/chorus/bridge/drop/outro/build) + biais genre (13) + atmosphère (8) + BPM (<85 → pas de zigzag/bounce/heartbeat) + énergie audio (RMS) + hash seedé (regenSeed pour variété).
- **Amplitude** (l.618-631) : DMX-scale, **capée à 128**. Commentaire du code : « Center is 128, so amplitude=128 means full edge-to-edge sweep ». Valeurs par section : intro 50-130, verse 80-180, chorus 110-220, drop 140-250 (cap 128), build rampe 70→240, anticipation drop 160-240.
- **Vitesse** (l.633-638) : `0.3 + centroid×0.6`, ×1.2 sur downbeat fort, ×1.5 avant drop.

## 2. Moteur temps réel (src/hooks/dmx-playback.ts, l.900-923)

- Chaque pattern produit des **offsets** `px`, `py` ∈ [-1, 1] (sin/cos centrés sur 0).
- Valeur finale : `pan = 128 + px × amplitude` (l.914), `tilt = 128 + py × amplitude` (l.919).
- Amplitude 0 ou pas de mouvement → `pan = tilt = 128` (l.923).
- Clamping scène : `clampPanToStage` / `clampTiltToStage` (src/engine/dmx-movement.ts) — aussi centré sur 128 (`128 + clamp(d)`).

## 3. Vue 3D (src/views/stage3d.tsx, l.1705-1715)

- `panVal = data[...] ?? 128`, `tiltVal = data[...] ?? 128` (défaut 128).
- Conversion : `((panVal/255) − 0.5) × π × 3` → **128 = 0 rad** (bras droit devant) ; 0 DMX = −1,5π (extrême).
- Tilt : `((tiltVal/255) − 0.5) × π × 1.5` + `_mountTilt` + `_staticTilt`.
- Lissage : `rotation += (cible − rotation) × 0.3` par frame (mouvement fluide vers la cible).

## Points d'attention pour la suite

- Si un faisceau 3D part d'une position extrême : ce n'est PAS la génération (toujours centrée 128) — vérifier clamping / position de montage / piste manuelle qui écrit une valeur absolue.
- La conception « amplitude = offset max autour du centre » signifie qu'un pattern n'a jamais de position absolue : tout est relatif.
- La génération des couleurs est validée par l'utilisateur — ne pas y toucher.
