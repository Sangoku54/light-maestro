# plan.md — Évaluation : le logo communique-t-il « contrôle lumière / création de show » au premier coup d'œil ?

## Tâche
Question utilisateur : « En voyant ce logo, comprend-on de suite que c'est un logiciel de contrôle de lumière et de création de show light ? »

## Ressources
- Logo à évaluer : `light-maestro/assets/logo/icon-full-1024.png` (+ `icon.svg`, `wordmark.svg`)
- Pipeline d'analyse : `C:\Users\vitte\.openclaw-autoclaw\skills\autoglm-image-recognition\` (upload-mix.py → image-recognition.py), exécution avec `$env:PYTHONIOENCODING="utf-8"`

## Décomposition parallèle (3 axes indépendants)
1. **Sous-agent A — « Premier regard » (utilisateur lambda)**
   - Rôle : regard naïf, SANS connaissance du contexte ni du nom. Que voit-on ? À quoi ça fait penser (baguette magique, DJ, musique, cinéma, lumière) ?
   - Sortie : `subagent_01_first_glance.md`
2. **Sous-agent B — « Codes de catégorie » (comparaison concurrentielle)**
   - Rôle : comparer les codes visuels des logiciels de contrôle lumière (QLC+, Madrix, Resolume, SoundSwitch, Lightjams, Chamsys) : gobos, faisceaux, faders, DMX, couleurs de scène. Le logo respecte-t-il ou trahit-il ces codes ? La concurrence est-elle reconnaissable au premier regard, et ce logo l'est-il ?
   - Sortie : `subagent_02_category_codes.md`
3. **Sous-agent C — « Sémiotique adverse » (avocat du diable)**
   - Rôle : chercher les contre-lectures. La baguette = chef d'orchestre (musique) ou baguette magique (fantaisie) plus que « contrôle lumière » ? Qu'est-ce qui, dans le logo, signale spécifiquement LUMIÈRE (pas son, pas magie) ? Niveau de reconnaissance à 3 tailles (icône 1024, topbar 28px, favicon 16px) ?
   - Sortie : `subagent_03_semiotics.md`

## Dépendances
- Les 3 sous-agents sont indépendants → un seul round parallèle.
- Chaque sous-agent doit d'abord uploader l'image (upload-mix.py) puis l'analyser (image-recognition.py) avec son prompt dédié, en français.

## Synthèse (mainline)
- Lire les 3 sorties, croiser, écrire `brief.md` avec verdict + conditions + recommandations.

## Livraison
- Réponse courte en français (conclusion de 1-2 paragraphes + points clés), pas de fichier DELIVERY (conclusion courte autorisée).
