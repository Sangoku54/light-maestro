# Revue adverse — Patch "diviser par 2 les sphères/lights 3D" — `src/views/Stage3D.tsx`

**Relecteur :** subagent 02 (revue adverse)
**Méthode :** relecture du fichier patché (lecture des sections 460-720 et 1290-1400, grep exhaustifs `SphereGeometry` / `CircleGeometry` / `PointLight` / `lightExit` / `glow` / `radius` / `scale`), re-vérification de chaque valeur annoncée, calculs géométriques dans les repères locaux (group → armGroup → headGroup).
**Aucun fichier modifié.**

---

## A. Les 9 changements sont-ils présents ? — VERDICT : OK

| # | Annoncé | Constaté (ligne, valeur) | État |
|---|---|---|---|
| 1 | L504 `SphereGeometry(0.16→0.08)` tête moving_head | L504 `new THREE.SphereGeometry(0.08, 24, 16), headMat` | ✅ |
| 2 | L511 `lightExit.y -0.16→-0.08` | L511 `lightExit.position.set(0, -0.08, 0)` (commentaire L509 "y = -radius" conservé) | ✅ |
| 3 | L572 `CircleGeometry(0.20→0.10)` face LED PAR | L572 `new THREE.CircleGeometry(0.10, 16)` | ✅ |
| 4 | L648 `SphereGeometry(0.16→0.08)` tête défaut | L648 `new THREE.SphereGeometry(0.08, 24, 16), headMatDef` | ✅ |
| 5 | L651-653 sortie défaut **inchangée** `-0.32` + commentaire | L651-653 commentaire ("le yoke occupe l'espace sous la tête (0→0.28) ; rapprocher la sortie ferait traverser le bras par le faisceau"), L654 `lightExitDef.position.set(0, -0.32, 0)` | ✅ (mais cf. B) |
| 6 | L706 `SphereGeometry(0.11→0.055)` têtes extra | L706 `new THREE.SphereGeometry(0.055, 20, 14)` | ✅ |
| 7 | L710 `exit.y -0.20→-0.10` | L710 `exit.position.set(0, -0.10, 0)` — ratio 0.10/0.055 = 1.818 ≈ 0.20/0.11 = 1.818 | ✅ |
| 8 | L1352 `spotRadius 0.6→0.3` | L1352 `const spotRadius = 0.3;` (opacity 0, L1724 "Floor spot/glow visibility forced off") | ✅ |
| 9 | L1370 `glowRadius 1.2→0.6` | L1370 `const glowRadius = 0.6;` (idem invisible) | ✅ |

Les numéros de lignes du rapport initial (509/651/706) sont décalés de ±2 par rapport au fichier actuel (511/654/710) : simple décalage d'édition, sans conséquence.

---

## B. Raisonnement géométrique sur la sortie du type défaut (L654, inchangée à -0.32) — VERDICT : PROBLÈME

**Géométrie réelle (repère armGroup, armGroup.position.y = 0.10 dans group) :**
- Base : `CylinderGeometry(0.07, 0.09, 0.04)` à y=0.02 (**dans group**, pas armGroup) → y monde 0→0.04
- Bras yoke : `BoxGeometry(0.04, 0.28, 0.06)` à (±0.12, 0.14, 0) → y 0→0.28, x ±(0.10→0.14), z ±0.03
- Crossbar : `BoxGeometry(0.28, 0.03, 0.06)` à y=0.28 → y 0.265→0.295, x ±0.14
- headGroup : y=0.30 ; sphère réduite 0.08 → **bas de sphère à y=0.22** (armGroup)
- Sortie actuelle : 0.30 − 0.32 = **−0.02** (armGroup) = 0.08 (group)

**Le commentaire du code est géométriquement faux dans sa généralité.** "Rapprocher la sortie ferait traverser le bras par le faisceau" : si la sortie était à −0.08 (= bas de sphère, y=0.22 armGroup), le beam vertical (le cas nominal, le cône pointe en −Y local) descendrait en passant **entre** les bras : les bras sont à x=±0.12, le cône (top 0.03, ouverture tan(0.15) → rayon ≤ 0.063 au sol) garde une marge ≥ 0.05 dans toute la zone du yoke. **Aucune collision.** Le seul cas où le beam toucherait le yoke à −0.08 est un tilt à ±90° exact avec pan aligné sur l'axe X — et c'est exactement le comportement du moving_head (cf. ci-dessous).

**Ce que le choix −0.32 coûte réellement :**
1. **Gap visuel de 0.24 (3× le rayon !)** entre le bas de la sphère (0.22) et le point d'émission (−0.02) : le faisceau émerge dans le vide, très loin sous la tête. Avant le patch, le gap était déjà de 0.16 (1× rayon, le "2× rayon" signalé comme ambigu par le recensement) — le rétrécissement **amplifie** le défaut existant au lieu de le corriger.
2. **Le beam vertical traverse la base** : en descendant de y=0.08 (group), le cône (rayon ≈ 0.036 à y=0.04) passe **par le centre** de la plaque (rayon 0.07–0.09, y 0→0.04). Le faisceau semble émerger du socle.
3. **Incohérence totale avec le moving_head** : même design conceptuel (sphère dans un yoke en U), traitement opposé. Le moving_head (L511) garde la sortie **au bas exact de la sphère** (−0.08 = −rayon), avec un yoke plus grand (bras 0→0.32 armGroup, x=±0.14) — donc son beam horizontal à ±90° traverse lui aussi les bras, et c'est accepté. Rien ne justifie un traitement différent pour le défaut.

**Recommandation :** `lightExitDef.position.set(0, -0.08, 0)` (L654), soit le bas exact de la sphère réduite — cohérent avec le moving_head et avec le principe "y = −radius" commenté en L509. Le beam vertical ne touche pas le yoke (marge ≥ 0.05) ; la traversée des bras pour beams horizontaux extrêmes est le compromis déjà admis pour le moving_head. Supprimer ou réécrire le commentaire L651-653 (sa justification est fausse pour le cas nominal).

---

## C. Occurrences ratées par le recensement ? — VERDICT : OK (rien de bloquant)

Grep exhaustif du fichier patché : **3 et seulement 3** `SphereGeometry` (504, 648, 706) et **3** `CircleGeometry` (572, 1352, 1370) — toutes patchées. Pas d'occurrence de sphère oubliée. Pas de `group.scale`, pas de boule disco, pas de halo/sprite autour des têtes (les seuls sprites sont les musiciens, L1141-1160, non-lumière).

Cas "Ambigü" / "Non" du recensement, re-vérifiés :
- **L533 miroir scanner (rayon 0.10)** : c'est la tête du scanner et sa surface de sortie, pas une sphère ni une light. Ne pas réduire : défendable (le beam top 0.03 reste < 0.10). Discutable uniquement si l'on veut homogénéiser — à trancher avec l'utilisateur, pas un oubli.
- **L600 réflecteur strobe (0.40×0.125)** : surface de sortie, idem. OK.
- **L1308/L1339 PointLights (distance 8, decay 2)** : pas de géométrie visible ; la distance pilote l'éclairage du sol. La réduire changerait l'ambiance lumineuse, hors périmètre "taille des sphères". OK — **mais** à garder en tête : si l'utilisateur vise aussi le halo lumineux au sol, c'est par là qu'il faudra passer (distance et/ou intensité), à confirmer avec lui.
- **L993 fumée `size: 0.15`** : non-lumière. OK.
- **Beam cones (top 0.03, L1317/1427/1432/1469/1475)** : pilotés par le beamAngle DMX. Ne pas toucher : correct et documenté.
- Détail : le recensement n'a pas listé le **trailLine** (ligne ~1387) dans son tableau — c'est une ligne de trajectoire (violet, linewidth 1), ni sphère ni light : hors périmètre, non bloquant.

---

## D. Régressions introduites par le patch ? — VERDICT : PROBLÈME (uniquement via B)

- **Ratios préservés** : têtes extra 0.055/0.10 (ratio 1.818 identique à avant), moving_head sortie = −rayon, LED PAR face 0.10 > top de beam 0.03 (le cône sort proprement de la lentille), têtes extra disposées à radius 0.34 / hauteur 0.30 (beam descendant à ±0.34, hors du crossbar ±0.14 — pas de collision). Rien de cassé.
- **Seule vraie régression visuelle** : le type défaut (détaillé en B) — le rétrécissement de la sphère sans suivre la sortie transforme un gap préexistant de 0.16 en gap de 0.24 (3× rayon), faisceau émergeant du vide et traversant la base par le centre quand il pointe en bas. Préexistant en partie, mais **aggravé et non corrigé** par le patch.
- **Commentaire obsolète L503** : "sphère (orientation-agnostic, **2x pour diagnostic visuel**)" — la sphère est maintenant à 0.08 (taille normale) ; le commentaire est un vestige d'un doublage de debug. Nettoyage mineur.

---

## E. Hauteurs des groupes (headGroup.position.y 0.34 et 0.30) — VERDICT : OK

Ces hauteurs ancrent le **centre** de la sphère, pas sa taille. Avec la sphère réduite (rayon 0.08), le bas passe à 0.26 (moving_head) et 0.22 (défaut) en repère armGroup — la sphère reste entre les bras du yoke (distance aux bras x=±0.12/±0.14 > 0.08, aucun interpénétration), et le crossbar reste englobé par la tête comme avant. **Garder les hauteurs est correct** ; un resserrement serait purement cosmétique et risquerait de rapprocher la sphère du crossbar. Aucune action requise.

---

## VERDICT GLOBAL : À CORRIGER

Le patch est **9/9 correctement appliqué**, sans régression sur les ratios ni oubli d'occurrence — mais **1 point doit être corrigé avant livraison** :

### Correction requise (une seule ligne + commentaire)
1. **L654** : `lightExitDef.position.set(0, -0.32, 0)` → `lightExitDef.position.set(0, -0.08, 0)` — aligner la sortie du beam au bas exact de la sphère réduite (−0.08 = −rayon, même règle que le moving_head L511). Le beam vertical passe entre les bras du yoke sans collision (marge ≥ 0.05) ; la traversée des bras pour beams horizontaux à ±90° est le compromis déjà accepté pour le moving_head.
2. **L651-653** : réécrire/supprimer le commentaire — sa justification ("rapprocher la sortie ferait traverser le bras") est géométriquement fausse pour le cas nominal.

### Nettoyage optionnel (non bloquant)
3. **L503** : supprimer "2x pour diagnostic visuel" du commentaire (obsolète après le /2).
4. **À confirmer avec l'utilisateur** : les PointLights (distance 8, L1308/L1339) n'ont pas de taille visible — si le "halo au sol" est visé, il faudra ajuster distance/intensité séparément.

**Une fois la ligne 654 corrigée, le patch peut être livré** : le rendu sera cohérent sur les 3 types de tête (sortie du beam au bas de la sphère), les 9 objectifs de réduction atteints, aucune autre régression détectée.
