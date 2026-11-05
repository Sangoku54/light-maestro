# Audit — Priorité des tracks customs sur l'autoscript (pan/tilt)

**Vérificateur** : subagent_11 · **Date** : 2026-08-27 · **Projet** : Light Maestro (HEAD `3aeddcc` + working tree non commité — numéros de ligne relevés sur le fichier ACTUEL)
**Périmètre** : `src/hooks/dmx-playback.ts` (1629 l.), `src/views/QuickShowView.tsx` (4624 l.), `src/hooks/fixture-tracks.ts`, `src/engine/dmx-movement.ts`, `src/views/TrackTimeline.tsx`, `src/components/SongPresetPlayer.tsx`
**Méthode** : lecture ligne à ligne des deux chemins (tick temps réel + computeDmxForCue), traçage de chaque injection de valeur dans phase/pan/tilt du bloc mouvement, vérification des appels (snapshot crossfade, preview, buildDmxCues).

---

## 1. Tick temps réel — fixture sous track de mouvement

**✅ Vérifié OK**
- **Détection du track** : `dmx-playback.ts:975-984` — `trackMovement` = premier `movementBlocks` actif (`ct >= b.time && ct < b.endTime`) dans `fixtureTrackMap` (construit `:736-741` via `resolveTrackTargets`, `fixture-tracks.ts:117-126`).
- **Amplitude** : `dmx-playback.ts:988-991` — `amplitude = trackMovement ? trackMovement.amplitude : …` (le tier multiplier autoscript n'est appliqué que hors track).
- **Pattern** : `dmx-playback.ts:994` — `if (trackMovement) return trackMovement.pattern;` → ni `getSmartMovement` ni le pattern de section ne remplacent un pattern track.
- **Crossfade params** : `dmx-playback.ts:1041-1043` (`blendAmp`) et `:1043-1045` (`blendSpd`) — tous deux gardés par `!trackMovement` : l'amplitude/speed de la next cue ne se blendent pas dans le calcul d'une fixture sous track.
- **Spatial (mobileIdx)** : `dmx-playback.ts:1030` — `if (spatialPattern && !trackMovement)` → le comptage de `mobileIdx` est sauté pour les tracks.
- **Spatial (phase)** : `dmx-playback.ts:1047` — `(spatialPattern&&!trackMovement?spatialPhaseFor(...):0)` → l'offset de phase spatial est bien coupé pour les tracks (le fix 1.0.20 est présent et cohérent).
- **Limites pan/tilt** : `dmx-playback.ts:1052-1054` — `panLimit/tiltLimit = trackMovement ? 128 : (pfl?.pan ?? panTiltLimits.pan)` → aucun clamp de course autoscript sur un bloc track (commentaire explicite L1051).
- **Amplitude 0** : `dmx-playback.ts:1064-1065` — pan/tilt forcés à 128 (centre), comportement voulu d'un bloc track à amplitude 0.

**🔴 Problèmes bloquants**

1. **`movementPhase` (phase aléatoire autoscript) injectée dans le track** — `dmx-playback.ts:554` (`const movementPhase=Math.random()*1000;` généré à chaque montage du hook) est ajouté **sans garde** dans la phase d'une fixture sous track : `dmx-playback.ts:1047` `phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase+(spatialPattern&&!trackMovement?…:0)`. Une fixture sous track démarre donc son bloc avec un déphasage aléatoire constant : le mouvement ne commence pas à la position de début de bloc (sweep qui démarre « en plein milieu », etc.).
   *Correction patchable* : conditionner l'injection, ex. `+(trackMovement?0:movementPhase)` dans la même ligne, ou intégrer `movementPhase` au ternaire existant : `(spatialPattern&&!trackMovement?spatialPhaseFor(...):0)+(trackMovement?0:movementPhase)`.

2. **La vitesse du mouvement track est celle de l'autoscript** — `MovementBlock` (`fixture-tracks.ts:45-53`) n'a **pas de champ `speed`** (seulement pattern/amplitude/endPattern/endAmplitude ; l'UI `TrackTimeline.tsx:1107` ne crée pas de vitesse non plus). Dans le tick, `speedMult=active.movementSpeed??1` (`dmx-playback.ts:1046`) et `blendSpd` gardé par `!trackMovement` retombe sur `curSpd=speedMult` (`:1043-1045`) → **la cadence du track est pilotée par `active.movementSpeed` de l'autoscript** (audio-reactive : `QuickShowView.tsx:768-774`, `0.3+centroid*0.6`, ×1.2 sur beat, ×1.5 en anticipation de drop). Pattern et amplitude du track sont respectés, mais l'utilisateur ne contrôle pas la vitesse de son track et elle varie avec l'analyse audio.
   *Correction patchable* : ajouter `speed?: number` à `MovementBlock` (`fixture-tracks.ts:45-53`) + UI, puis dans le tick : `const trackSpd = trackMovement && trackMovement.speed ? trackMovement.speed : speedMult;` et `blendSpd = (crossfadeT>0&&nextCue&&!trackMovement) ? … : (trackMovement ? trackSpd : curSpd);` (et idem `computeDmxForCue:1482` avec `trackMovement.speed ?? (cue as any).movementSpeed ?? 1`).

**🟡 Non-bloquants / risques**
- **`motorPhase` non gardé** — `dmx-playback.ts:1046` `motorPhase=m*(Math.PI*2/motorCount)` injecté dans `phase` (L1047) **et** dans les formules px/py (L1049-1050) même pour les tracks : les bras d'une fixture multi-pan/tilt sous track sont déphasés entre eux (effet vague autoscript appliqué au track). C'est la « phase décalée par bras » assumée par AGENTS.md pour l'autoscript ; pour un track custom l'utilisateur attend probablement le même geste sur tous les bras. Si on veut la neutraliser : `const motorPhase = trackMovement ? 0 : m*(Math.PI*2/motorCount);` (les deux chemins).
- **`clampPanToStage`/`clampTiltToStage` non gardés** — `dmx-playback.ts:1056-1057` (`let pv = fp ? clampPanToStage(raw, fp.x) : raw;` / tilt L1060-1061) : quand une position scène existe, le clamp géométrique autoscript borne le mouvement track (ex. un sweep voulu au-delà des bords de scène est réduit). Pas un fallback grille, mais une contrainte autoscript sur le track.
- **`endPattern`/`endAmplitude` jamais interpolés** — le moteur n'utilise que `amplitude`/`pattern` de début (`:988`, `:994`) ; un bloc track avec gradient de fin est joué à amplitude constante (fonctionnalité track non câblée, pas une intrusion autoscript).

---

## 2. computeDmxForCue (crossfades < 0,3 s + preview)

**✅ Vérifié OK**
- **Track détecté** : `dmx-playback.ts:1463` — `trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id)`.
- **Amplitude** : `:1464-1467` — track d'abord ; **Pattern** : `:1486` — `if (trackMovement) return trackMovement.pattern;`.
- **Gardes spatiales** : `:1474` (`if (spatialPattern && !trackMovement)` pour mobileIdx) et `:1482` (`spatialPattern&&!trackMovement?spatialPhaseFor(...):0` dans la phase) — fixes 1.0.20 présents et cohérents avec le tick.
- **Pas de déphasage par les PARAMÈTRES de crossfade** dans le calcul courant : le tick garde `blendAmp`/`blendSpd` par `!trackMovement` (cf. point 1).

**🔴 Problèmes bloquants**

3. **Le snapshot de la next cue est calculé SANS les tracks → le blend final du fondu mélange l'autoscript dans les fixtures sous track.** `dmx-playback.ts:683-688` : l'appel `computeDmxForCue(nextCue, …, tierMultipliers, undefined, colorTrackColors, strobeOverridesEarly, undefined, disabledFixturesRef?.current, fixturePositions)` passe `fixtureTrackOverrides = undefined` (6ᵉ arg) et n'a pas `chaserTakeover` (12ᵉ). Résultat : pendant tout crossfade (déclenché si `gap<0.3s`, fenêtre ≤ 0,15 s — L678-679), le blend final `dmx-playback.ts:1160-1171` (`chVals[ch]=existing.has(chStr)?round(chVals[ch]*(1-crossfadeT)+nextCh[ch]*crossfadeT):…`) interpole le pan/tilt **track** (chVals courant) avec le pan/tilt **autoscript** de la next cue (nextCh sans forcedMovements) → la fixture sous track dérive vers la position autoscript puis « claque » au retour, à chaque transition de cue rapprochée. Les gardes L1041-1045 protègent les paramètres, pas le blend final.
   *Correction patchable* : dans l'appel L683-688, passer les overrides tracks calculés à `ct` (ex. `computeFixtureTrackOverrides(fixtureTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current||[])` en 6ᵉ arg) et `computeChaserTrackOverrides(...)` en 12ᵉ — le snapshot reflétera alors l'état track ; variante minimale : exclure du blend les canaux pan/tilt des fixtures ayant un `trackMovement`/`chaserCtl` actif à `ct`.

**🟡 Non-bloquants / risques**
- `motorPhase` non gardé dans compute : `dmx-playback.ts:1492` — même constat que point 1 (déphasage inter-bras des tracks).
- `speedMult = (cue as any).movementSpeed ?? 1` non gardé : `dmx-playback.ts:1482` — la phase du snapshot track est cadencée par la vitesse autoscript de la cue (même famille que 🔴2, sans champ speed possible).
- `clampPanToStage`/`clampTiltToStage` non gardés dans compute : `dmx-playback.ts:1532-1533` et `:1536-1537`.

---

## 3. Chaser takeover

**✅ Vérifié OK**
- **Tick** : `dmx-playback.ts:1122-1158` — `computeChaserTrackOverrides` (déf. `:199-271`) détermine les fixtures dont la plage d'adresses est couverte par les scènes des steps du chaser actif ; pour chacune : `delete chVals[a]` sur toute la plage de canaux puis écriture des valeurs de la scène (`:1145-1156`). **Le takeover s'applique APRÈS tout le calcul fixture** (y compris mouvement auto) → le chaser écrase bien le mouvement auto.
- **computeDmxForCue** : `:1560-1572` — même logique `delete + write` via le paramètre `chaserTakeover`.
- Le champ `chaser` des cues n'existe pas — le takeover passe par les tracks chaser (`chaserTracksRef`), c'est le mécanisme en vigueur et il est correct.

**🟡 Non-bloquants / risques**
- Ordre tick : calcul → takeover chaser (`:1145-1156`) → **crossfade blend** (`:1160-1171`) → fade. Le blend peut donc diluer le chaser avec le snapshot (qui n'a pas le chaser — cf. 🔴3) pendant ~150 ms ; dès que la cue suivante devient active, le chaser reprend à 100 %.
- Priorité : une fixture dont les adresses sont couvertes par une scène de chaser voit son track de mouvement écrasé (chaser > track). Cohérent avec l'esprit « contrôle total » du chaser, à confirmer comme voulu côté produit.

---

## 4. EFX (effets sauvegardés)

**✅ Vérifié OK**
- **Tick** : `dmx-playback.ts:966-969` — `efxMap` (pan/tilt des override cues) écrit directement `efxPan/efxTilt` sur tous les moteurs, **avant** le bloc auto → bypass complet.
- **EFX tracks** : `dmx-playback.ts:970-974` — `efxPtOverrides` (`computeEfxOverrides`, `fixture-tracks.ts:261+`) écrit `ept.pan/ept.tilt` directement sur tous les moteurs → bypass du bloc mouvement auto (et du track) — priorité EFX track > mouvement track, OK entre tracks customs.
- **Preview** : `QuickShowView.tsx:136-139` — les EFX tracks sont appliqués en post sur `channelValues` (computeDmxForCue ne les gère pas) — chemin correct.

**🟡 Non-bloquants / risques**
- `efxMap` provient de `overrideCuesRef` (`dmx-playback.ts:705`), or ce ref **n'est jamais rempli** : `QuickShowView.tsx:1708` (déclaré, seul usage L2393) et `SongPresetPlayer.tsx:75/102/238` (toujours `[]`) → la branche L966-969 est morte en pratique (correctement prioritaire si un jour alimentée).
- Le snapshot de crossfade (🔴3) n'a pas non plus les EFX tracks → dilution EFX pendant les fondus, même famille que 🔴3.

---

## 5. ManualCues

**✅ Vérifié OK**
- **Pas de transformation spatiale** : dans `genCues`, les manual cues sont converties sans `spatialPattern` (`QuickShowView.tsx:847-861` — champ absent de l'objet poussé) → `(active as any).spatialPattern` est `undefined` dans le moteur → aucun offset spatial.
- **Couleur imposée** : la manual cue force sa palette via `cue.color`/`colors` (`:853-854`), appliquée par le chemin couleur standard (`dmx-playback.ts` tick et `computeDmxForCue` `cue.color/colors`).
- **Track prioritaire** : si un track de mouvement est actif au même moment, `trackMovement` est checké avant l'amplitude/pattern autoscript de la cue manuelle (`:988`, `:994`) → le track gagne sur le pan/tilt.
- Structure réelle d'une manual cue : `channelValues: {}` (`QuickShowView.tsx:2995-3005`) — elle ne transporte pas de valeurs brutes pan/tilt ; « telles quelles » est donc vrai pour ce qu'elles contiennent.

**🟡 Non-bloquants / risques**
- Aucun chemin dédié : `manual:true` n'est lu nulle part dans `dmx-playback.ts` ; la cue manuelle passe par le chemin autoscript avec `movement:'static'` (`QuickShowView.tsx:857`) → résidu de mouvement lent `static` (`dmx-playback.ts:1049` : ±0,1×amplitude tier ≈ ±9/7/4 DMX) et vitesse autoscript. Bénin mais pas « figé ».
- Si une manual cue contenait un jour des `channelValues` pan/tilt, ils seraient ignorés (efxMap inactif, cf. point 4).

---

## 6. DisabledFixtures

**✅ Vérifié OK**
- **Tick** : `dmx-playback.ts:753` — `if (disabledFixturesRef?.current?.has(pf.id)) continue;` avant **tout** calcul de canaux (dimmer, couleur, pan/tilt…).
- **computeDmxForCue** : `dmx-playback.ts:1377` — même skip en tête de boucle.

**🟡 Non-bloquants / risques**
- Le preview `dmxCues` (`QuickShowView.tsx:2343-2350`) ne passe pas `disabledFixtures` (10ᵉ arg `undefined`) → les fixtures désactivées restent dans l'aperçu (affichage uniquement, le hardware suit le tick).

---

## 7. Preview (QuickShowView)

**✅ Vérifié OK**
- **Chemin `dmxCues`** : `QuickShowView.tsx:2347-2349` — `computeDmxForCue(…, computeFixtureTrackOverrides(fixtureTracksRef.current, cues[0].time, …), ctc, undefined)` → `forcedMovements` **passés** → toutes les gardes `!trackMovement` de computeDmxForCue (point 2) s'appliquent au preview.
- **Chemin `buildDmxCues`** (export/aperçu complet) : `QuickShowView.tsx:128-145` — passe `overrides` (tracks), `ctc`, `sto`, `dto`, `cho` (chaser) + EFX en post → mêmes gardes.

**🟡 Non-bloquants / risques**
- Le useEffect preview est un **snapshot à `cues[0].time`** (L2343), pas au temps courant ; sans `fixturePositions` ni `disabledFixtures` (cf. point 6) — affichage statique seulement.

---

## 8. Positions manquantes / fallback

**✅ Vérifié OK**
- **Pas de fallback grille pour les tracks** : `spatialPhaseFor` a bien un fallback grille (`dmx-movement.ts:67-70` `fallbackPosition` + `:82-100` `pos ?? fallbackPosition(...)`), **mais** ce chemin est inaccessible aux fixtures sous track : coupé par `!trackMovement` au tick (`dmx-playback.ts:1030`, `:1047`) et dans compute (`:1474`, `:1482`). Une fixture sous track avec position absente ne reçoit aucun déphasage grille.
- **Valeurs pan/tilt** : `dmx-playback.ts:1056-1057` et `:1060-1061` — `fp ? clampPanToStage(raw, fp.x) : raw` → position absente = valeur brute, pas de grille de repli.
- ⚠️ Conséquence inverse à connaître : une fixture **sans track** avec position absente reçoit le fallback grille (comportement autoscript voulu, hors sujet tracks).

**🟡 Non-bloquants / risques**
- Clamp géométrique `clampPanToStage/clampTiltToStage` toujours appliqué aux tracks **quand une position existe** (cf. point 1, 🟡).

---

## Constats additionnels (hors périmètre strict mais utiles)

- **`channelOverrides` des fixture tracks ignorés par le moteur** : `fixture-tracks.ts:68` et `:161-166` remplissent `overrides` (addr→val), mais le tick construit son propre `fixtureTrackMap` (qui ne lit que les blocs, `dmx-playback.ts:736-741`) et `computeDmxForCue` n'utilise pas `.overrides` → un gobo/prism/zoom posé en override sur une track ne sort jamais en DMX.
- **`endPattern`/`endAmplitude`** (gradient de fin de bloc) jamais interpolés (tick `:988/:994`, compute `:1464/:1486`).
- Les fixes 1.0.20 (gardes `&& !trackMovement` L1030/L1047/L1474/L1482) sont bien présents, cohérents entre les deux chemins, et **suffisants pour le spatial** — ils ne couvrent pas `movementPhase`, `motorPhase`, la vitesse, ni le blend de snapshot.

---

## Synthèse

| # | Point | Verdict | Lignes clés |
|---|-------|---------|-------------|
| 1 | Tick : track > autoscript | 🔴 2 trous (phase aléatoire, vitesse autoscript) + 🟡 motorPhase/clamp | `dmx-playback.ts:1047`, `:1043-1046`, `:1056-1061` |
| 2 | computeDmxForCue / crossfade | 🔴 snapshot sans tracks → blend pollué ; gardes internes ✅ | `dmx-playback.ts:683-688`, `:1160-1171` |
| 3 | Chaser takeover | ✅ écrase après calcul ; 🟡 dilution pendant fondu | `dmx-playback.ts:1122-1158`, `:1560-1572` |
| 4 | EFX | ✅ bypass complet ; 🟡 absents du snapshot | `dmx-playback.ts:966-974` |
| 5 | ManualCues | ✅ pas de spatial ; 🟡 chemin standard (static), channelValues ignorés | `QuickShowView.tsx:847-861`, `:2995-3005` |
| 6 | DisabledFixtures | ✅ skip avant tout ; 🟡 preview non filtré | `dmx-playback.ts:753`, `:1377` |
| 7 | Preview | ✅ forcedMovements passés, gardes actives | `QuickShowView.tsx:2347-2349` |
| 8 | Positions manquantes | ✅ aucun fallback grille sur les tracks | `dmx-playback.ts:1030/1047/1474/1482` |

**Conclusion** : la hiérarchie de priorité (track > autoscript) est en place et correcte sur l'essentiel (amplitude, pattern, spatial, limites, chaser, EFX, fixtures désactivées, preview). **3 problèmes bloquants** restent : (1) `movementPhase` aléatoire injecté dans la phase des tracks (L1047), (2) vitesse des tracks imposée par l'autoscript (pas de champ speed dans `MovementBlock`), (3) snapshot de crossfade calculé sans les tracks/chaser → blend final qui « déphase » les fixtures sous track pendant ~150 ms à chaque transition de cue.
