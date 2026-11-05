# plan.md — Logo v3 : corriger la lecture « lumière » (validé par l'utilisateur : « vas y »)

## Contexte
Évaluation v2 (3 agents) : le logo se lit « baguette magique / app photo » au premier regard (~4,3/10). Correctifs validés :
1. Rubans naissant DE LA POINTE de la baguette (émanation lumineuse)
2. Étoile sparkle → cœur radieux / halo
3. Baguette translucide lumineuse (pointeur de lumière)
4. Bords nets façon faisceau (pas ruban de soie)
5. Cône de faisceau discret émanant de la pointe (code n°1 de la catégorie)
6. Favicon retravaillé (lisibilité 16px)
7. Wordmark : LIGHT dominant (blanc), MAESTRO secondaire (gris)

## Ressources
- Scripts v2 : `.openclaw/tmp/build-logo.cjs`, `.openclaw/tmp/build-favicon.cjs`, `.openclaw/tmp/render-logo.cjs` (sharp isolé dans `.openclaw/tmp/logo-tools`)
- Livrables existants : `assets/logo/` (v2, à remplacer)
- Pipeline éval : `C:\Users\vitte\.openclaw-autoclaw\skills\autoglm-image-recognition\`

## Étapes
1. **Round 1 — Spécification** (2 subagents parallèles) :
   - Sous-agent « Spec faisceau & halo » : définit les paramètres numériques du cône de faisceau (angle, longueur, opacité, dégradé) et du cœur radieux (forme, rayons, couleurs) pour signer « lumière » — sur la base des codes visuels des logiciels lumière (QLC+, Madrix, Resolume, Chamsys). Sortie : `spec_beam.md`
   - Sous-agent « Contre-spec géométrie » : vérifie la faisabilité dans la géométrie existante (spirale d'Archimède, 3 secteurs 120°) et propose les contraintes numériques (rayons, angles de départ des pétales à la pointe, épaisseur baguette). Sortie : `spec_geometry.md`
2. **Implémentation v3** (mainline) : modifier `build-logo.cjs` + `build-favicon.cjs` + `render-logo.cjs` selon les specs, re-render PNG.
3. **Round 2 — Évaluation v3** (3 subagents parallèles) : premier regard naïf, sémiotique adverse (3 tailles), codes de catégorie. Sorties `subagent_*.md`.
4. **Synthèse & itération** : croiser ; si v3 ≥ ~7/10 à l'œil naïf → livrer ; sinon 1 itération corrective max puis livrer avec état des lieux.
5. **Livraison** : mettre à jour `assets/logo/` + `public/`, rebuild app, commit, récap + MEDIA.

## Verdict attendu
Lecture « lumière » au premier regard : objectif ≥ 7/10 à l'œil naïf.
