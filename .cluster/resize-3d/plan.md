# plan.md — resize-3d (diviser par 2 les sphères et lights de la vue 3D)

## Tâche
L'utilisateur : "divise pas 2 la tailles des sphères et autres lights de la vue 3d" → toutes les sphères de fixtures et éléments lumineux de Stage3D.tsx doivent être réduits de moitié.

## Sous-tâches
1. **SA-1 Recensement** (subagent resize-3d-survey, lancé) : lister toutes les tailles (sphères fixtures, lights, glow, lasers) dans src/views/Stage3D.tsx avec lignes exactes → subagent_01.md
2. **Patch mainline** : diviser par 2 les occurrences identifiées (changement minimal, si constante centralisée → fix en un point)
3. **SA-2 Revue adverse** : vérifier que TOUTES les occurrences du rapport sont traitées, que rien d'autre (positions, collisions, caméra) n'a été cassé, cohérence des valeurs → subagent_02.md
4. **Validation** : tsc + vitest
5. **Build** : bump 1.0.22, build NSIS + portable, vérif bundle, copie DELIVERY

## Contraintes
- Bug visuel → pas testable par nous (pas d'app Electron) : changement minimal, log de debug si besoin, l'utilisateur testera (il a dit "je testerai plus tard")
- Ne pas toucher aux backups .openclaw/tmp/stage3d_*.tsx
- Version actuelle : 1.0.21 (livrée) → 1.0.22
