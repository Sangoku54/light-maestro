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

---

# Modèle v2 — enveloppes CONTINUES (2026-11-17)

## Pourquoi
Sur v1.0.44, le constat utilisateur : « les mouvements sont pourris —
toujours rapides, sans nuance de rapidité ni de dimmer ».

Le `movementSpeed` calculé par `genCues` n'était **pas consommé** : la boucle
section-aware (`autoscript-loops.ts`) imposait une vitesse constante par
type de section (`SECTION_BEATS_PER_CYCLE`), et l'échantillonnage
`Math.floor()` lisait la trajectoire **par paliers**.

## Nouveau modèle (règles)

1. **Deux enveloppes CONTINUES par section** (`src/engine/autoscript-envelopes.ts`) :
   - `speed` : multiplicateurs de vitesse de mouvement (moyenne ≈ 1) ;
   - `dimmer` : niveau 0..1 (enveloppe RMS + respiration au tempo + accents
     sur les beats forts + plancher de section + raccord d'entrée).
   Elles sont **optionnelles** : sans enveloppe, le moteur garde son
   comportement historique (anciens presets, cues manuels).
2. **Identifiant unique `envId`** porté par les cues → deux shows peuvent
   coexister (QuickShow + lecteur de preset) sans se voler leurs enveloppes.
   Registre plafonné à 96 enveloppes (évacuation FIFO).
3. **Cadence de base par section** (`SECTION_BEATS_PER_CYCLE`) :
   intro/outro 8 · verse/bridge 6 · chorus/build 4 · **drop 3** beats/tour.
   À 120 BPM : drop = 0,67 tour/s (avant 2,0 tours/s).
4. **Phase warped** : la phase cumulée avance au rythme de la vitesse locale
   (accélère sur les pics, ralentit dans les creux) mais la section boucle sur
   **le même nombre de tours** → la fin de section reste alignée sur le tempo.
5. **Interpolation linéaire** entre deux échantillons de la boucle
   (plus de `Math.floor()`) → trajectoire continue.
6. **Dimmer live** échantillonné à l'instant présent. Priorité :
   piste dimmer explicite > `forcedDimmerVal` > enveloppe > `mapIntensity`.
   `computeDmxForCue` lit la même enveloppe → crossfade et vue 3D cohérents
   avec la sortie matérielle.
7. **Resélection du pattern sur 8 beats** (rythme musical), pas toutes les
   N cues. Le pattern courant **persiste** entre deux resélections.
8. `intensityBand()` / `tierIntensityMultiplier()` (`dmx-color.ts`) sont la
   **source unique** des plages d'intensité et de la pondération de tier,
   partagées par l'enveloppe et par le chemin historique.

## Garde-fous

- Le centrage DMX 128/128 est inchangé (offsets autour du centre).
- La normalisation des loops amplifie toujours volontairement les patterns
  faibles (`static` occupe toute la course) — comportement verrouillé par un
  test, laissé intact.
- `movementSpeed` reste consommé par les phases prism/zoom/frost/iris/focus
  (`dmx-playback.ts`) — ne pas le supprimer.
- **Couleurs : ne pas y toucher.**

## Validation obligatoire

- `src/__tests__/show-auto-quality.test.ts` : hiérarchie de vitesse, bornes,
  nuance intra-section, dimmer continu, interpolation, reseed musical.
- `src/__tests__/yolo-fixture-probe.test.ts` : **timeline dense à 50 ms**
  (le sweep aux temps de cues ne détectait ni les paliers ni un dimmer figé).
- Mesures de référence (120 BPM) : tours/s intro 0,25 · verse 0,34 ·
  build 0,50 · **drop 0,66** · chorus 0,50 ; dimmer drop 134..255 DMX ;
  saut max par frame 0,022..0,125 (avant ≈ 0,785).

