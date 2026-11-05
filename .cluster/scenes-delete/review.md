# review.md — scenes-delete (suppression des dossiers de scènes)

## Constat initial
La suppression de dossier EXISTAIT déjà (store `deleteFolder` + toolbar de confirmation + traductions fr/en) mais n'était accessible que quand un dossier était sélectionné dans le filtre `<select>` → invisible à l'usage normal. L'utilisateur ne trouvait pas l'option.

## Patch livré (DesignView.tsx)
1. **Chip dossier** : `<button>` unique → `<div class="group inline-flex">` contenant le bouton filtre (comportement d'origine : onClick, drag&drop, title) + un bouton poubelle (Trash2 10px) au survol, `stopPropagation`, qui sélectionne le dossier ET ouvre la confirmation existante (`setSceneFilter(fo.value)` + `setConfirmDeleteFolder(fo.name)`).
2. **Protection auto-loops** : poubelle masquée (chip ET toolbar) pour `AUTO_LOOP_FOLDER` — sinon `purgeAutoLoops` (filtre strict `s.folder === 'auto-loops'`) casserait silencieusement (scènes désassignées = résidus + doublons). Import `AUTO_LOOP_FOLDER` depuis engine/auto-loops.
3. Documentation : `.openclaw/notes/scene-folders.md` (modèle, actions, pièges, protection).

## Revue adverse (subagent_02.md) : APPROUVÉ
- A. Diff cohérent, aucun handler perdu (filtre, DnD, surbrillance).
- B. HTML valide (div > 2 buttons), chip « Non classé » intact.
- C. Drag&drop intact (events DnD bubbent vers le div ; stopPropagation du trash sans effet sur le bouton frère).
- D. Confirmation fonctionnelle (batch React → toolbar), deleteFolder du bon dossier, filtre reset, chips recalculés.
- E. auto-loops : documenté + protection implémentée (recommandation retenue).
- F. Visuel : hauteur identique, +18 px de largeur par chip, poubelle perceptible sans hover (opacity-60).
- G. tsc 0 ; Trash2 importé ; clés i18n présentes en/fr.

## Validation
- tsc --noEmit : 0 erreur
- vitest : 299/299
- Pas de build exe (règle : accord utilisateur requis — l'utilisateur regroupe ses modifs).

## Notes
- WIP non commité présent dans le working copy (imports clampRect/groupByTier, ctxMenu clamp au rendu, indentation L733-734 irrégulière) — non touché, à vérifier par l'utilisateur.
- UX connue : la poubelle d'un chip bascule le filtre vers ce dossier pour la confirmation ; « Annuler » ne restaure pas le filtre précédent (voulu).
