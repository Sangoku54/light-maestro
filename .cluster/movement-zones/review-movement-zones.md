# Revue adverse — « Zones de mouvement » (spec v1)

Date : 2026-08-20. Relecteur : subagent. Objet : exactitude de la spec `spec-movement-zones.md`
contre le code réel. **Pas d'implémentation ici, uniquement des constats et des recommandations.**

Fichiers audités :
- `src/views/Stage3D.tsx` (conversion pan/tilt, `_mountTilt`, `heading`)
- `src/engine/dmx-movement.ts` (`clampPanToStage` / `clampTiltToStage`)
- `src/hooks/dmx-playback.ts` (sites de clamp + chemins EFX)
- `src/engine/fixture-analyzer.ts` (canaux fine / offsets multiples)
- `src/stores/showStore.ts` (`FixturePos`)
- `.openclaw/notes/autoscript-movement-model.md` (modèle centré 128)

---

## A. Conversion degrés ↔ DMX

**Verdict : pan CONFORME, tilt À CORRIGER (la spec utilise une valeur périmée).**

Formules exactes trouvées dans le code :

- **Pan** — `Stage3D.tsx` l.1610 :
  `panTarget = ((panVal / 255) − 0.5) × π × 3`
  ⇒ plage `[−1.5π, +1.5π]` = **±270°**. 1 DMX = 540/255 ≈ **2,118°**. ✓ conforme à la spec.

- **Tilt** — `Stage3D.tsx` l.1618 (tête principale) et l.1628 (têtes supplémentaires) :
  `dmxTilt = ((tiltVal / 255) − 0.5) × π`
  ⇒ plage `[−0.5π, +0.5π]` = **±90°**. 1 DMX = 180/255 ≈ **0,706°**.

**Écart :** la spec (et la note `autoscript-movement-model.md`, qui écrit « × π × 1.5 »)
annonce tilt = ±0,75π = ±135° (1,059°/DMX). Le facteur **×1,5 n'existe plus dans le code** :
la ligne 1618 lit bien `* Math.PI` sans `* 1.5`. La note est obsolète et la spec l'a héritée.

Conséquence directe sur le tableau de la spec (valeurs recalculées avec le vrai ±90°) :

| Zone spec | Annoncé | Réel (modèle ±90°) |
|---|---|---|
| sol : tilt 128 → 213 | « 0→90° au-dessus » | 0° → **+60°** (le vrai +90° exige 255) |
| pont arrière : 43 → 128 | « vers bas/avant » | **−60°** → 0° |
| face public : 43 → 213 | balayage complet | −60° → +60° (pas ±90°) |

Tous les angles tilt de la spec sont donc **sous-évalués d'un facteur 1,5**.
Les bornes pan (2,118°/DMX) sont, elles, exactes.

**Détail mineur (à garder en tête) :** le neutre DMX 128 n'est pas exactement 0 rad, car
`128/255 = 0,50196 ≠ 0,5`. À 128 : pan ≈ +0,0185 rad (+1,06°), tilt ≈ +0,0062 rad (+0,35°).
Négligeable mais à connaître si on veut des bornes « pile à 0° ».

---

## B. Sens du tilt et `_mountTilt`

**Verdict : direction qualitativement plausible, mais bornes à recalibrer + signe inversé selon le montage (à clarifier).**

Ce que dit le code :

1. **DMX 128 = zéro mécanique du moteur tilt**, pas « horizontal » ni « vers le haut »
   universellement. `tiltVal=128` ⇒ `dmxTilt≈0` ⇒ `rotation.x = _mountTilt + _staticTilt`
   (l.1619). Le faisceau est modélisé en −Y local (cône `CylinderGeometry` positionné
   `(0, −ch/2, 0)`, l.1422/1427).

2. **`_mountTilt`** est fixé dans `fitMountRotation` (l.2520-2542) :
   - `top` (pont) : `_mountTilt = 0` → faisceau **vers le bas** (commentaire `mountMode`
     l.171 : « top=down ») ;
   - `ground` (sol) : `_mountTilt = π` (l.2535, « tilt head 180° so beam points UP ») →
     faisceau **vers le haut** ;
   - `rear` (pont arrière) : `_mountTilt = 0` mais `armGroup.rotation.x = −π/2` (l.2532) →
     yoke horizontal, faisceau **vers l'avant**.

   Donc AU SOL, DMX 128 = **vertical vers le haut** ; AU PONT (top), DMX 128 = **vertical
   vers le bas** ; en `rear`, DMX 128 = **horizontal avant**. Le neutre physique dépend du
   montage.

3. **Inversion du signe tilt pour `ground`.** Le sol est littéralement la même tête retournée
   de π : pour `ground`, `rotation.x = π + dmxTilt`, ce qui **inverse la direction monde** du
   même code DMX. Avec heading 0, un tilt > 128 fait pencher le faisceau vers l'avant-scène
   pour un montage `top`, mais vers le fond de scène pour un montage `ground`.

   → **Un même preset « tilt 128→213 » pointe dans des directions opposées** selon qu'on
   l'applique à une lyre au sol ou au pont. La spec suppose un sens de tilt unique ; c'est
   inexact. Le preset doit être **conscient du `mountMode`** (ou défini en espace monde puis
   converti).

4. **Cohérence des plages proposées :**
   - sol « 128→213 = au-dessus » : sens plausible (au neutre la lyre pointe déjà en haut,
     on balaye au-delà de la verticale), mais 213 = +60° et non +90° (voir A).
   - pont arrière « 43→128 = bas/avant » : sens plausible pour un faisceau partant du haut,
     mais 43 = −60° (pas la plage annoncée).
   - **Verdict : direction OK en première intention, valeurs numériques fausses et sens
     dépendant du `mountMode` → À CLARIFIER / recalibrer visuellement dans la 3D.**

---

## C. Le clamp existant `clampPanToStage` / `clampTiltToStage`

**Verdict : À FUSIONNER, pas à remplacer bêtement — avec une règle de priorité claire.**

Ce que font exactement ces fonctions (`dmx-movement.ts` l.4-12) :

- `clampPanToStage(panDmx, x)` : borne l'écart `d = panDmx − 128` dans
  `[−x·128, (1−x)·128]`. C'est un **heuristique « garder le faisceau sur scène »** basé sur
  la position horizontale `x` : à gauche (`x=0`) pan 128→255 (vers la droite/scène), à
  droite (`x=1`) pan 0→128, au centre (`x=0.5`) pan 64→192.
- `clampTiltToStage(tiltDmx, y)` : borne `d` dans `[−max(0.2,y)·128, min(1, y+0.3)·128]`.
  Même idée sur la profondeur `y` : les fixtures proches de l'avant sont restreintes pour ne
  pas éclairer le public, celles du fond ont la plage quasi complète.

Points factuels importants :
- Ce clamp est **automatique, dépend de la position (x,y), ignore `heading` et `mountMode`**,
  et n'est **pas** une zone utilisateur.
- Il est appliqué **seulement dans le chemin pattern auto** (branche `amplitude>0`) :
  site 1 `dmx-playback.ts` l.989 (pan) / l.994 (tilt) dans `useDmxPlayback` (l.349+),
  et site 2 l.1335 / l.1340 dans `computeDmxForCue` (l.1128+).
- Il est appliqué **par offset** (boucle `motorCount`), donc correct pour les multi-têtes.
- **Il n'est PAS appliqué aux chemins EFX** (voir E) ni aux écritures statiques à 128.

**Recommandation :**
- Garder `clampPanToStage`/`clampTiltToStage` comme **fallback par défaut** quand la fixture
  n'a **pas** de zone (préserve le comportement actuel).
- Quand une zone est définie, **la zone remplace** le clamp scène pour cette fixture (la zone
  utilisateur est l'autorité). Ne pas empiler naïvement les deux : le cas « face public »
  (pan 0→255, tilt 43→213) serait aussitôt re-bridé par `clampPanToStage`, ce qui tuerait la
  zone. Si on veut cumuler, il faut les composer comme `zone` PUIS `stage` (le stage clamp en
  garde-fou final), mais jamais l'inverse, et en acceptant que « face public » doive désactiver
  le stage clamp.

---

## D. Piège `heading` (rotation de la fixture)

**Verdict : À CLARIFIER — la zone pan doit être pensée « relative au heading » (la spec le
repousse en v2, mais c'est un piège v1 immédiat).**

Constat :
- Le clamp actuel n'utilise que `fp.x` / `fp.y` — **jamais `fp.heading`**.
- En 3D, le groupe entier est tourné : `group.rotation.y = heading × π/180`
  (l.423, l.1411, l.1454). Le pan DMX est donc exprimé dans **l'espace local de la fixture** ;
  la direction monde du faisceau = direction locale **tournée du heading**.

Conséquence d'imposer une plage pan absolue (ex. `[86,170]`) sur une fixture tournée :
- Le pictogramme suppose `heading=0` (pan 128 = « droit devant »). Pour `heading=90°`, le
  « centre » pan 128 pointe en fait vers le côté scène, et la zone `[86,170]` balaye un **arc
  pivoté de 90°** : elle ne correspond plus au « gauche→droite de la scène » du pictogramme.
- Pire : `clampPanToStage(raw, fp.x)` continue d'hypothétiser `heading=0`. Zone + clamp scène
  divergent alors (l'un en local, l'autre en monde supposé), et le faisceau peut être
  sur-contraint ou sortir de scène.

**Recommandation simple (v1) :**
- Définir la zone pan **dans l'espace local de la fixture** (plages DMX brutes, indépendantes
  du heading) et le **documenter explicitement** : « la zone tourne avec la fixture ». C'est
  en fait le comportement physiquement naturel (le rayon d'action d'une lyre tourne avec elle),
  et c'est zéro trigo.
- Ne **pas** prétendre que le pictogramme encode une direction monde : pour `heading≠0`, le
  cône pivote. Si l'utilisateur veut une zone **alignée sur le monde**, alors il faut soustraire
  le heading (trigo) — à repousser en v2 comme prévu, mais à annoncer pour ne pas surprendre.

---

## E. Cas limites qui casseraient un clamp min-max naïf

1. **Canaux « fine » pan/tilt (16-bit).** `panFineOffset`/`tiltFineOffset` existent
   (`fixture-analyzer.ts` l.38/41, remplis l.168/173) mais **ne sont jamais écrits** par
   `dmx-playback.ts` (aucune référence). Le moteur ne pilote que le canal grossier. Un clamp
   min-max sur le seul canal grossier laisse le canal fine à 0/périmé → sauts de 1/256 et
   bornes incohérentes pour les fixtures 16-bit.

2. **Fixtures pan 540°.** L'hypothèse « 0→255 = ±270° » de la spec est propre aux moving
   heads 8-bit 540° **ou** aux 270° standard ; une fixture pan 540° en 16-bit a une
   correspondance degré/DMX différente sur son canal grossier. Un clamp codé en dur sur
   « ±270° » est faux pour elles.

3. **Multi-têtes / bras (panOffsets[]/tiltOffsets[] de longueur > 1).** Le moteur boucle bien
   `motorCount` et clampe par offset (bon). Mais une zone « par fixture » doit être **appliquée
   à tous les offsets** (site 1 **et** site 2), et la 3D lit chaque tilt de tête séparément
   (l.1627-1629) : si on n'applique la zone qu'au premier offset, les têtes secondaires
   sortent de la zone.

4. **Scanners vs moving heads.** Les scanners ont un miroir (géométrie différente :
   `mirror.rotation.x = π/2` l.533) et des plages mécaniques réduites (±90° pan / ±45° tilt
   typiques). Le neutre et le sens ne sont pas les mêmes qu'une tête mobile. Le ±270° pan de
   la spec est **spécifique aux moving heads** ; appliquer `[86,170]` pan à un scanner est faux.

5. **Chemins EFX court-circuitent le clamp.** `dmx-playback.ts` l.914-922 : les overrides EFX
   (`efxMap` l.918, `efxPtOverrides` l.921) écrivent pan/tilt **directement dans `chVals` sans
   clamp**. Une zone posée uniquement aux deux sites de clamp sera **contournée pendant un EFX**.
   Il faut envelopper aussi ces chemins.

6. **Écritures statiques à 128.** Branches `amplitude==0` et `else` écrivent `128` sur tous
   les offsets. La plupart des zones pictogrammes incluent 128 (donc OK), mais une zone
   personnalisée ou « verrouillée » excluant 128 verrait l'état « off » fuiter hors zone. Le
   neutre doit être garanti dans la zone, ou l'état off doit être re-clampé.

7. **Deux sites de clamp à mettre à jour.** l.989/994 (`useDmxPlayback`) et l.1335/1340
   (`computeDmxForCue`). En oublier un = incohérence entre lecture live et calcul de cue.

8. **Une seule source de vérité (bénéfice, pas bug).** La 3D lit les mêmes `chVals` : une zone
   posée côté moteur est automatiquement reflétée dans la 3D. MAIS toute visualisation du cône
   en 3D devra réutiliser la **même conversion (±90° tilt, pas ±135°)** sinon le cône affiché
   ne correspondra pas au faisceau réel.

9. **Artefact 128.** `128/255 ≠ 0,5` → le neutre réel est +1,06° pan / +0,35° tilt. Une borne
   « exactement 128 » inclut donc ce petit décalage ; ne pas supposer 128 = pile 0°.

10. **Sens tilt inversé par `mountMode`** (voir B) : un preset tilt unique appliqué à une lyre
    au sol et une au pont pointe dans des directions opposées. La zone doit être
    `mountMode`-aware.

---

## Recommandations d'implémentation minimale

1. **Corriger la conversion tilt de la spec** : ±90° (0,706°/DMX), pas ±135°. Recalculer
   toutes les bornes tilt du tableau (128→213 = 0→+60° ; le vrai +90° = 255).
2. **Zone dans l'espace local fixture, priorité `zone > clamp scène`** : si zone définie,
   remplacer `clampPanToStage`/`clampTiltToStage` par `clampToZone` pour cette fixture ;
   sinon conserver le stage clamp comme fallback. Ne pas empiler les deux sauf en composant
   `zone` puis `stage`.
3. **Appliquer la zone aux DEUX sites** (`useDmxPlayback` l.989/994 **et** `computeDmxForCue`
   l.1335/1340) **et aux chemins EFX** (l.914-922), sur **tous les offsets** pan/tilt.
4. **Rendre la zone `mountMode`-aware** (ou la documenter comme « dans l'espace de montage »),
   et documenter que la zone **tourne avec le `heading`** (pas de direction monde en v1).
5. **Écarter explicitement du périmètre v1** : fine 16-bit, pan 540°, scanners — et refuser
   de clamper un scanner/16-bit tant que leur plage mécanique réelle n'est pas connue.
6. **Valider visuellement dans la 3D** (cône) avec la conversion ±90° avant de fiabiliser les
   pictogrammes ; ajouter un garde-fou pour que le neutre 128 reste dans la zone (sinon l'état
   « off » sort de zone).

REVIEW_DONE
