# review.md — resize-3d (diviser par 2 les sphères et lights de la vue 3D)

## Contexte
User : "divise pas 2 la tailles des sphères et autres lights de la vue 3d" → Stage3D.tsx.
Recensement : subagent_01.md (agent resize-3d-survey) — 9 lignes cibles, 3 ambigües, aucun scale de groupe, pas de boule disco/laser dédié.

## Patch appliqué (v1)
| Élément | Avant | Après |
|---|---|---|
| Tête moving_head (SphereGeometry) | 0.16 | 0.08 |
| Sortie light moving_head (y) | -0.16 | -0.08 |
| Tête type défaut (SphereGeometry) | 0.16 | 0.08 |
| Têtes extra multi-bras (SphereGeometry) | 0.11 | 0.055 |
| Sortie têtes extra (y) | -0.20 | -0.10 (ratio 1.82 conservé) |
| Face/lentille LED PAR (CircleGeometry) | 0.20 | 0.10 |
| Floor spot (spotRadius) | 0.6 | 0.3 |
| Floor glow (glowRadius) | 1.2 | 0.6 |

Décision initiale mainline : sortie du type défaut inchangée (-0.32) par crainte de traversée du yoke.

## Revue adverse (subagent_02.md) : À CORRIGER (1 point)
- **B. Sortie type défaut** : le raisonnement mainline était faux — les bras du yoke sont déportés à x=±0.12, le beam vertical passe entre eux (marge ≥ 0.05). Garder -0.32 crée un gap visuel de 0.24 = 3× le rayon (aggravé vs 0.16 avant) et une incohérence avec le moving_head (sortie au bas de sphère). → **Corrigé : -0.32 → -0.08**, commentaire réécrit en "Light exit at bottom point of sphere (y = -radius)".
- **C. Occurrences ratées : aucun.** 3 SphereGeometry + 3 CircleGeometry seulement, toutes patchées.
- **D. Régression : uniquement via B.** Ratio extra heads conservé (1.818), aucune collision nouvelle.
- **E. Hauteurs de groupes (0.34/0.30) : OK**, centres entre les bras, garder.
- Nettoyage : commentaire obsolète L503 "2x pour diagnostic visuel" → "beam exits at bottom point".

## Validation finale
- tsc 0 (avant et après correction)
- vitest 299/299
- Non touchés (justifiés) : beam cones (taille pilotée par le beam angle DMX réel), PointLights (distance d'influence 8 m, pas de taille géométrique — le halo au sol est piloté par elles), fumée (size 0.15), sprites musiciens, structures (truss, yoke, bases), miroir scanner / réflecteur strobe (surfaces de sortie, pas des sources).
- Version : 1.0.22.
