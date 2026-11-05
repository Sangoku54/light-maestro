# Plan — couverture universelle (toutes fixtures) + version 1.0.15

TaskId: coverage-generic
Objectif utilisateur : lire et exploiter TOUTES les fixtures (existantes, patchées, futures) via le chemin générique ; plus de cas par cas. Et incrémenter la version des exe (1.0.14 → 1.0.15).

## Sous-tâches
1. **Auditeur de couverture universelle** (subagent_01.md — dispatché) : scan des 619 fixtures OFL → lasers muets (I3), faux positifs (I4), valeurs hors [0,255] (I2), compteurs.
2. **Test d'invariant permanent** (src/__tests__/library-coverage.test.ts) : charge tout l'OFL, vérifie I1/I2/I3 à chaque run — garantit les fixtures « à venir » (nouveau fichier OFL ajouté → test le couvre).
3. **Correctifs génériques** : toute faille I2/I3 corrigée dans le moteur (pas par fixture).
4. **Version** : package.json 1.0.14 → 1.0.15 (+ package-lock si présent) → rebuild des 2 exe.
5. **Livraison** : exe vérifiés 1.0.15 + rapport de couverture.

## Dépendances
- 2/3 indépendants de 1 (le test révèle les mêmes trous que l'auditeur ; on croise).
- 4 dépend de 3 (on ne build que sur un moteur vert).
- 5 dépend de 4.

## Règles
- Aucun correctif « par fixture » : toute correction doit être générique (détection/écriture), sauf les tests.
- Scripts tsx dans .cluster/coverage-generic/.