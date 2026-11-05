# Plan — Vérification tracks customs + exploitation pan/tilt (post-1.0.20)

## Contexte
L'utilisateur demande de vérifier 2 points après la livraison 1.0.20 (chorégraphie spatiale) :
1. Les tracks customs créés par l'utilisateur prennent toujours le dessus sur l'autoscript.
2. Les channels pan/tilt des heads mobiles sont exploités au maximum (tous les bras, tous les moteurs), sans rejouer toujours les mêmes mouvements d'un preset à l'autre.

État connu du workspace (vérifié mainline) :
- Gardes `&& !trackMovement` en place : tick L1030 (comptage spatial) + L1047 (phase) ; compute L1474 + L1482.
- `motorCount = Math.max(panCount, tiltCount, 1)` : tick L963, compute L1461.
- Le fix bloquant de la revue adverse (fixtures sous track non déphasées par la chorégraphie) est appliqué depuis le build 1.0.20.

## Round 1 — 3 audits parallèles (dépendances : aucune)
1. **SA-A** « Vérificateur prise de contrôle des tracks » — audite TOUS les chemins où une track custom doit écraser l'autoscript : tick L975-1054 (trackMovement, amplitude/pattern/limites pan-tilt 128), compute L1463-1486 (forcedMovements), chaser takeover, EFX, manualCues, disabledFixtures, preview dmxCues, crossfades. Sortie : subagent_11.md.
2. **SA-B** « Auditeur exploitation pan/tilt max » — audite la couverture complète des canaux pan/tilt : analyse fixtures (panOffsets/tiltOffsets, exclusion des « fine »), motorCount par moteur, écriture de tous les offsets dans tick/compute/genCues, Stage3D extraHeads, limites pan/tilt, fixtures multi-bras. Sortie : subagent_12.md.
3. **SA-C** « Auditeur variété des mouvements entre presets » — audite la sélection des mouvements : les 14 patterns, selectMovementPattern par section, amplitudes/vitesses, motorPhase par moteur, movementPhase aléatoire, spatialPhaseFor par position, et cherche les répétitions (même mouvement systématique, patterns jamais sélectionnés, presets trop similaires). Sortie : subagent_13.md.

## Round 2 — revue adverse (dépend du round 1)
4. **SA-D** « Review adverse croisée » — croise les findings A/B/C, cherche les pièges manqués (track + panOnly/tiltOnly, crossfade section track↔auto, multi-univers, limites asymétriques, positions manquantes). Sortie : subagent_14.md. Conclusions → review.md.

## Livraison
- Corrections si findings bloquants (fix chirurgical + tsc + vitest).
- Rapport de vérification final (rapport de vérification par point, avec fichier+ligne).
- Pas de bump de version sauf correction nécessaire.
