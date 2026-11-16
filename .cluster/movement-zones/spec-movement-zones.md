# Zones de mouvement — têtes mobiles (spec v2, corrigée après revue)

Date : 2026-08-20. Statut : principe validé par l'utilisateur + revue adverse du code effectuée.
Les corrections de la revue sont intégrées ci-dessous (marquées ✅revue).

## Problème

Les têtes mobiles bougent de façon identique et illogique : une tête au sol à gauche peut éclairer
l'extérieur gauche de la scène, celle de droite peut éclairer les musiciens, celle du pont arrière peut
éclairer l'arrière. Il faut **contraindre chaque tête à rester dans son « rayon d'action » physique**,
défini par sa position de montage.

## Principe retenu — « Zone de couverture » par pictogramme

Chaque tête mobile reçoit une zone définie par **2 axes** :
- **Pan (axe X)** : plage DMX `[panMin, panMax]`
- **Tilt (axe Y)** : plage DMX `[tiltMin, tiltMax]`

Le **pictogramme** encode la situation de montage. Le dessin = **un cône** :
- **pointe (apex)** = position de la tête mobile (la source),
- **ouverture** = direction réelle du balayage autorisé (vers la scène).

Terminologie : on parle de **« tête mobile »** (générique), pas de « wash » — ça couvre wash/spot/beam/lyre.

## Pictogrammes (plan = vue de dessus, cône = couverture pan)

| # | Pictogramme | Montage | Pan (X) DMX | Tilt (Y) DMX | Note |
|---|---|---|---|---|---|
| 1 | Tête mobile — sol gauche | apex à gauche, cône ouvert → droite (vers scène) | 128 → 255 | 128 → 255 | 180° devant, 0→90° au-dessus |
| 2 | Tête mobile — sol droite | apex à droite, cône ouvert → gauche | 0 → 128 | 128 → 255 | symétrique |
| 3 | Tête mobile — sol centre | apex avant-scène, cône ouvert → scène (symétrique) | 64 → 192 | 128 → 255 | ±45° |
| 4 | Tête mobile — pont arrière | apex en haut, cône ouvert → bas (vers scène) | 64 → 192 | 0 → 128 | pointe bas/avant |
| 5 | Tête mobile — pont avant | apex avant, cône ouvert → fond de scène | 64 → 192 | 0 → 128 | pointe vers le fond |
| 6 | Tête mobile — face public | cône large → public | 0 → 255 | 0 → 255 | balayage complet |
| 7 | Tête mobile — fixe | faisceau verrouillé (trait, pas de cône) | verrouillé | verrouillé | uplight / spot fixe |

## Conversion degrés ↔ DMX (✅revue : tilt corrigé)

Formules exactes trouvées dans `Stage3D.tsx` :
- **Pan** : `((val/255) − 0.5) × π × 3` ⇒ ±270°. **1 DMX ≈ 2,118°.**
- **Tilt** : `((val/255) − 0.5) × π` ⇒ **±90°**. **1 DMX ≈ 0,706°** (PAS ±135° — le « ×1.5 »
  de l'ancienne note `autoscript-movement-model.md` n'existe plus dans le code, l.1618/1628).

Conséquence : `tilt 128→213 = 0→+60°` (pas +90°). Le vrai +90° exige 255. Le tableau ci-dessus
a été recalculé avec la bonne conversion.

Neutre : DMX 128 partout (le système est centré sur 128, jamais 0). À noter : `128/255 ≠ 0,5`,
donc 128 ≈ +1,06° pan / +0,35° tilt — négligeable mais à connaître pour des bornes exactes.

## Sens du tilt selon le montage (✅revue : piège majeur)

DMX 128 = **zéro mécanique du moteur**, pas « horizontal » universel. Le neutre physique dépend
du montage (`_mountTilt` fixé dans `fitMountRotation`, Stage3D l.2520-2542) :
- **Sol (ground)** : `_mountTilt = π` → faisceau vers le **haut**.
- **Pont (top)** : `_mountTilt = 0` → faisceau vers le **bas**.
- **Pont arrière (rear)** : `_mountTilt = 0` + yoke à −π/2 → faisceau **horizontal avant**.

Le sol est la même tête retournée de π : **le même code tilt pointe en direction opposée** selon
sol vs pont. ⇒ La zone tilt doit être **consciente du `mountMode`** (ou définie dans l'espace de
montage). En v1 : les pictogrammes « sol » et « pont » sont deux presets distincts qui encodent
ce renversement — pas un preset unique partagé.

## Espace de référence : local à la fixture (✅revue : `heading`)

Le pan DMX s'exprime dans **l'espace local de la fixture** ; la 3D tourne le groupe de `heading`
(Stage3D l.423/1411/1454). Donc une zone pan est **relative au heading** : la zone **tourne avec
la fixture**. C'est physiquement naturel (le rayon d'action d'une lyre tourne avec elle) et c'est
**zéro trigo**. À documenter explicitement : le pictogramme n'encode PAS une direction monde pour
`heading ≠ 0`. Si on veut une zone alignée monde, soustraire le heading → v2.

## Points d'insertion (code existant)

1. **Donnée** — `FixturePos` (`src/stores/showStore.ts` l.161) : ajouter
   `zone?: { panMin; panMax; tiltMin; tiltMax }` (ou `zoneId` → preset). Persisté via `fixturePositions`.
2. **Moteur** — `src/hooks/dmx-playback.ts`, **3 chemins à couvrir** (✅revue) :
   - site 1 `useDmxPlayback` l.989 (pan) / l.994 (tilt) ;
   - site 2 `computeDmxForCue` l.1335 / l.1340 ;
   - **chemins EFX** l.914-922 (overrides `efxMap`/`efxPtOverrides` écrivent sans clamp) ;
   - et sur **tous les offsets** pan/tilt (multi-têtes).
3. **UI** — `Stage2DEditor` (où le `heading` se règle déjà) : rangée de pictogrammes + affichage
   du cône dans la 3D (réutiliser la conversion ±90° tilt pour que le cône colle au faisceau).

## Règle de priorité vs clamp scène existant (✅revue)

- `clampPanToStage`/`clampTiltToStage` (heuristique « garder sur scène » basée sur x/y, ignorant
  heading/mountMode) = **fallback par défaut** pour les fixtures **sans** zone.
- Si zone définie → **la zone remplace** le stage clamp pour cette fixture (l'utilisateur est
  l'autorité). Ne pas empiler naïvement : « face public » (pan 0→255) serait aussitôt re-bridé.
  Si cumul voulu : `zone` PUIS `stage` en garde-fou final, jamais l'inverse.

## Hors périmètre v1 (✅revue)

- **Fine pan/tilt 16-bit** : offsets présents mais jamais écrits par le moteur → ne pas clamper.
- **Pan 540°** : la correspondance 2,118°/DMX est propre aux 8-bit ±270° ; refuser les fixtures 540°.
- **Scanners** : miroir, géométrie et plages mécaniques différentes → écarter explicitement.
- **Zone alignée monde** (heading) : v2.
- **Aperçus PerformanceView/QuickShowView + chaserTakeover** : ces chemins n'ont pas `fixturePositions`
  (ou passent `undefined`) et n'ont jamais été clampés — non-régression, à traiter en v2 si besoin.

## Reste à faire avant codage

- Valider visuellement le cône dans la 3D (conversion ±90°), recalibrer les bornes exactes.
- Garantir que le neutre 128 reste dans la zone (sinon l'état « off » sort de zone).
