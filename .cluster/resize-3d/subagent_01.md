# Recensement des tailles 3D — sphères & lights — `src/views/Stage3D.tsx`

**Fichier analysé :** `light-maestro/src/views/Stage3D.tsx` (2329 lignes, 111 590 octets)
**Objet :** recenser toutes les tailles d'objets 3D de type sphère / light / glow / beam en vue de "diviser par 2 la taille des sphères et autres lights de la vue 3D".
**Méthode :** recherche exhaustive `SphereGeometry`, `CylinderGeometry`, `CircleGeometry`, `TorusGeometry`, `PlaneGeometry`, `BoxGeometry`, `PointLight`, `scale`, `size:`, `radius`, commentaires. Aucun fichier modifié.

> Note préalable : **pas de boule disco, pas de laser 3D dédié, pas de `vrsl` dans ce fichier.** Les fixtures laser (IODA…) sont rendues via la géométrie standard (tête + beam cone) ; leur spécificité est purement logique DMX (lignes 1560-1567). Le fichier ne contient **aucune** échelle (`group.scale`) appliquée aux fixtures — les tailles sont toutes en dur dans les constructeurs de géométrie.

---

## Tableau des occurrences

| Ligne | Code (extrait) | Valeur actuelle | Rôle | /2 ? |
|---|---|---|---|---|
| 504 | `new THREE.SphereGeometry(0.16, 24, 16), headMat` | rayon **0.16** | sphère fixture (tête moving_head) | **OUI** → 0.08 |
| 509 | `lightExit.position.set(0, -0.16, 0)` + commentaire `(y = -radius)` | position y **-0.16** (= rayon) | point de sortie lumière (accroche du beam) | **OUI (à suivre)** → -0.08 si rayon /2 |
| 648 | `new THREE.SphereGeometry(0.16, 24, 16), headMatDef` | rayon **0.16** | sphère fixture (type par défaut / inconnu) | **OUI** → 0.08 |
| 651 | `lightExitDef.position.set(0, -0.32, 0)` | position y **-0.32** (= 2×rayon, sous la sphère) | point de sortie lumière (défaut) | **OUI (à suivre)** — cf. ambiguïtés |
| 704 | `new THREE.SphereGeometry(0.11, 20, 14), extraMat` | rayon **0.11** | sphère fixture (têtes extra multi-bras, ex. Tonio 6 arm) | **OUI** → 0.055 |
| 706 | `exit.position.set(0, -0.20, 0)` | position y **-0.20** | point de sortie lumière (tête extra) | **OUI (à suivre)** si rayon /2 |
| 1306 | `const pointLight = new THREE.PointLight(0xffffff, 0, 8, 2)` | distance **8**, decay 2, pas de taille géométrique | light (point light dynamique par fixture, attachée au lightTarget) | Ambigü — voir synthèse |
| 1337 | `const ehLight = new THREE.PointLight(0xffffff, 0, 8, 2)` | distance **8**, decay 2 | light (point light des têtes extra) | Ambigü — voir synthèse |
| 1350-1351 | `const spotRadius = 0.6; … new THREE.CircleGeometry(spotRadius, 32)` | rayon **0.6** | glow/halo (spot lumineux au sol, désactivé — opacité 0, cf. ligne 1724) | **OUI** → 0.3 |
| 1368-1369 | `const glowRadius = 1.2; … new THREE.CircleGeometry(glowRadius, 32)` | rayon **1.2** | glow/halo (halo extérieur doux au sol, désactivé — opacité 0) | **OUI** → 0.6 |
| 572 | `const faceGeo = new THREE.CircleGeometry(0.20, 16)` | rayon **0.20** | light (face/lentille lumineuse du LED PAR — c'est par elle que sort le faisceau) | **OUI** → 0.10 |
| 80 | `const BEAM_LENGTH = 3.0;` | longueur **3.0** | laser/beam (longueur des cônes volumétriques, constante centrale) | Non (longueur, pas diamètre) — voir synthèse |
| 1313-1315 | `coneHeight = BEAM_LENGTH; coneRadiusBottom = coneHeight * Math.tan(0.15); new THREE.CylinderGeometry(0.03, coneRadiusBottom, coneHeight, 24, 1, true)` | top **0.03**, base ≈ **3×tan(0.15)≈0.45** (à beamAngle 0.15) | laser/beam (cône volumétrique de lumière par fixture) | Ambigü — voir synthèse |
| 1425 | `f3d.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true)` | top **0.03**, base `radius = ch*tan(beamAngle)` | laser/beam (régénéré au zoom DMX) | Ambigü — voir synthèse |
| 1430 | `eh.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true)` | top **0.03**, base `radius` | laser/beam (têtes extra) | Ambigü — voir synthèse |
| 1467 | `f3d.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true)` | top **0.03**, base `radius` | laser/beam (2ᵉ effet de position, même logique) | Ambigü — voir synthèse |
| 1473 | `eh.beamCone.geometry = new THREE.CylinderGeometry(0.03, radius, ch, 24, 1, true)` | top **0.03**, base `radius` | laser/beam (têtes extra, 2ᵉ effet) | Ambigü — voir synthèse |
| 467-468 | `new THREE.CylinderGeometry(0.08, 0.10, 0.04, 12), metalMat` | rayon 0.08/0.10, h 0.04 | autre (plaque de base moving_head) | Non (structure) |
| 483 / 487 | `new THREE.BoxGeometry(0.05, 0.32, 0.07)` (bras yoke) | 0.05×0.32×0.07 | autre (bras yoke moving_head) | Non (structure) |
| 491 | `new THREE.BoxGeometry(0.33, 0.04, 0.07)` (crossbar) | 0.33×0.04×0.07 | autre (traverse yoke) | Non (structure) |
| 524 | `new THREE.BoxGeometry(0.50, 0.15, 0.375)` | 0.50×0.15×0.375 | autre (corps scanner) | Non (structure) |
| 533 | `new THREE.CylinderGeometry(0.10, 0.10, 0.20, 12)` (mirror) | rayon 0.10, h 0.20 | autre (miroir scanner — surface de sortie du faisceau) | Ambigü (surface réfléchissante, pas une sphère) |
| 542 | `new THREE.BoxGeometry(0.05, 0.125, 0.05)` (bras scanner) | 0.05×0.125×0.05 | autre (bras miroir scanner) | Non (structure) |
| 558 | `new THREE.CylinderGeometry(0.20, 0.25, 0.45, 16)` (can LED PAR) | rayon 0.20/0.25, h 0.45 | autre (corps LED PAR) | Non (structure) |
| 565 | `new THREE.TorusGeometry(0.225, 0.025, 8, 16)` (face ring) | rayon 0.225, tube 0.025 | autre (anneau de façade LED PAR) | Non (structure) |
| 581 | `new THREE.CylinderGeometry(0.175, 0.15, 0.075, 16)` (base PAR) | rayon 0.175/0.15 | autre (pied LED PAR) | Non (structure) |
| 593 | `new THREE.BoxGeometry(0.50, 0.20, 0.25)` (strobe) | 0.50×0.20×0.25 | autre (corps strobe) | Non (structure) |
| 600 | `new THREE.PlaneGeometry(0.40, 0.125)` (reflector) | 0.40×0.125 | autre (réflecteur strobe — surface de sortie du faisceau) | Ambigü (surface, pas une sphère) |
| 625 | `new THREE.CylinderGeometry(0.07, 0.09, 0.04, 12)` (base défaut) | rayon 0.07/0.09 | autre (plaque base fixture défaut) | Non (structure) |
| 633 / 636 | `new THREE.BoxGeometry(0.04, 0.28, 0.06)` (yoke défaut) | 0.04×0.28×0.06 | autre (bras yoke défaut) | Non (structure) |
| 639 | `new THREE.BoxGeometry(0.28, 0.03, 0.06)` (crossbar défaut) | 0.28×0.03×0.06 | autre (traverse yoke défaut) | Non (structure) |
| 700 | `const radius = 0.34;` puis `eh.position.set(cos*radius, 0.30, sin*radius)` | rayon de disposition **0.34**, hauteur 0.30 | autre (cercle de placement des têtes extra autour du centre — pas une taille d'objet, un positionnement) | Non |
| 891-892 | `const chordR = 0.04; const diagR = 0.02;` | rayons tubes truss 0.04 / 0.02 | autre (poutres truss, non-lumière) | Non |
| 991 | `size: 0.15,` (PointsMaterial fumée) | taille points **0.15** | autre (particules de fumée/haze) | Ambigü (non-lumière) |
| 1144 / 1158 | `sprite.scale.set(personH, personH, 1)` / `set(personH/aspect, personH, 1)` | scale ≈ 1.6-1.75 m | autre (sprites musiciens, non-lumière) | Non |

---

## Synthèse

### (a) Occurrences à diviser par 2 (recommandé)

Cibles principales (sphères de fixtures) — **3 constructeurs + 3 positions de sortie liées** :

| Ligne | Élément | 0.16 → | 0.11 → |
|---|---|---|---|
| 504 | Sphère tête moving_head (`SphereGeometry(0.16, 24, 16)`) | **0.08** | — |
| 648 | Sphère tête type défaut (`SphereGeometry(0.16, 24, 16)`) | **0.08** | — |
| 704 | Sphère têtes extra multi-bras (`SphereGeometry(0.11, 20, 14)`) | — | **0.055** |
| 509 | `lightExit.position.y` moving_head (doit rester = −rayon) | **-0.08** | — |
| 706 | `exit.position.y` têtes extra | — | **-0.10** (moitié de 0.20) |

Objets "light" visibles (halos, faces lumineuses) :

| Ligne | Élément | → |
|---|---|---|
| 1350-1351 | Floor spot au sol (`spotRadius = 0.6`) | **0.3** |
| 1368-1369 | Floor glow au sol (`glowRadius = 1.2`) | **0.6** |
| 572 | Face/lentille LED PAR (`CircleGeometry(0.20)`) | **0.10** |

> ⚠️ NB : floor spot et floor glow sont **désactivés** (`opacity: 0`, voir commentaire ligne 1724 "Floor spot disabled: only beam cones from lens are shown") — le /2 n'aura aucun effet visible tant qu'ils restent off, mais c'est cohérent de les réduire quand même.

### (b) Occurrences ambigües

1. **Ligne 651** : `lightExitDef.position.set(0, -0.32, 0)` — vaut **2× le rayon** (0.32 vs 0.16). Soit c'est un bug existant (point de sortie 1 rayon trop bas), soit un décalage voulu. Si on divise le rayon par 2, il faut trancher : -0.08 (bas de sphère) ou -0.16 (conservation du ratio 2×). **À faire valider.**
2. **Lignes 1306 / 1337** : `PointLight(…, distance 8, decay 2)` — une PointLight n'a pas de taille géométrique ; sa "taille" est sa **distance d'influence** (8 m) et son intensity (0 → normIntensity×25 en playback). Diviser la distance par 2 (→ 4) rétrécirait le halo d'éclairage sur le sol — effet visuel possible, mais hors périmètre "taille des sphères". À décider.
3. **Beam cones (lignes 80, 1313-1315, 1425, 1430, 1467, 1473)** : cônes de lumière volumétriques — top `0.03`, base `ch×tan(beamAngle)`, longueur `BEAM_LENGTH = 3.0`. Ce sont des "lights", mais leur taille est pilotée par le vrai beam angle DMX (zoom). Les diviser par 2 déconnecterait le visuel de la donnée réelle. **Recommandation : ne pas toucher** (sauf `0.03` de rayon top, purement cosmétique, ou si l'utilisateur trouve les faisceaux trop épais — mais alors mieux vaut un facteur sur le rayon seulement, pas la longueur).
4. **Ligne 533 (miroir scanner, rayon 0.10)** et **ligne 600 (réflecteur strobe 0.40×0.125)** : surfaces de sortie du faisceau, pas des sphères ni des sources — **non** par défaut, sauf volonté d'homogénéiser tout l'éclairage.
5. **Ligne 991** : particules de fumée `size: 0.15` — non-lumière, laisser tel quel.

### (c) Constantes centralisées / points de fix unique

Il n'y a **pas** de constante globale type `FIXTURE_SPHERE_SIZE` — les rayons sont **en dur** dans 3 constructeurs différents (0.16, 0.16, 0.11). Un fix "en un seul point" est donc **impossible sans refactor** ; options :

1. **Refactor recommandé** : introduire en tête de fichier (près de `BEAM_LENGTH`, ligne 80) :
   - `const HEAD_SPHERE_RADIUS = 0.16;` → utilisé lignes 504 et 648 (+ position ligne 509)
   - `const EXTRA_HEAD_SPHERE_RADIUS = 0.11;` → ligne 704 (+ position ligne 706)
   - `const FLOOR_SPOT_RADIUS = 0.6;` / `const FLOOR_GLOW_RADIUS = 1.2;` → lignes 1350/1368
   - Puis diviser la valeur de chaque constante par 2 en un seul endroit.
2. **Fix minimal sans refactor** : éditer les 3 rayons (504, 648, 704) + les 3 positions de sortie (509, 651, 706) + les 3 tailles "light" (1350, 1368, 572) = **9 lignes**, en gardant la cohérence `lightExit.y = −rayon`.

### Rappels de cohérence pour le /2 des sphères
- `headGroup.position.y = 0.34` (ligne 502) et `= 0.30` (ligne 647) : hauteurs de groupe, pas des tailles — si la sphère rétrécit, on peut garder les hauteurs (léger vide sous la tête) ou les resserrer (optionnel, cosmétique).
- Les têtes extra : positionnement à rayon 0.34 / hauteur 0.30 (lignes 700-702) — distances, pas des tailles. Conserver.
- `fitMountRotation` (ligne 2536+) : rotations uniquement, rien à changer.

### Éléments absents du fichier (à vérifier ailleurs si besoin)
- **Boule disco** : introuvable (`Disco|disco|ball|Ball|vrsl` → aucun hit). Le rendu de boule disco, s'il existe, est ailleurs (autre composant ?).
- **Lasers visuels dédiés** : aucun — les lasers utilisent le beam cone standard.
- **Scales de groupes** : aucune `group.scale` / `setScale` sur les fixtures dans ce fichier.
