# plan.md — scenes-delete (suppression des dossiers de scènes)

## Contexte
User : « dans l'onglet scènes du menu configuration, on peut créer des dossiers mais pas les effacer → intègre cette option. » + consigne : PAS de build .exe sans accord explicite (préférence durable à enregistrer).

## Constat (recensement mainline)
- La suppression EXISTE déjà dans le store (`deleteFolder`, showStore.ts:741) : retire le dossier déclaré + désassigne ses scènes (folder → undefined). `clearFolder` (retirer les scènes sans supprimer le dossier) et `renameFolder` aussi.
- L'UI (DesignView.tsx) expose rename/clear/delete UNIQUEMENT dans la toolbar « dossier actif », visible seulement quand `activeFolderName !== null` (dossier sélectionné dans le `<select>` du filtre). Invisible à l'usage normal → l'utilisateur pense que ça n'existe pas.
- Traductions fr/en existantes : deleteFolder, confirmDeleteFolder, confirm, cancel, clearFolder, renameFolder, createFolder (i18n/fr.json:500-505, en.json:500-505).
- Chips de dossiers (DesignView.tsx:634+) : filtrent au clic, acceptent le drag&drop, mais n'ont AUCUNE action de gestion.

## Solution retenue
Exposer la suppression + gestion directement sur les chips de dossiers :
1. Restructurer le chip dossier (button → div.group) : bouton principal inchangé (filtre + drop), + bouton poubelle (Trash2 10px) visible au hover, `stopPropagation`, qui déclenche `setSceneFilter(fo.value); setConfirmDeleteFolder(fo.name)` → la toolbar de confirmation existante s'affiche. Zéro nouveau flux de confirmation.
2. Vérifier l'encodage de i18n/fr.json (accent suspect à la console) + corriger si réellement corrompu.

## Sous-tâches
1. SA-1 — Recenseur usages dossiers : tous les autres usages de `sceneFolders` / `deleteFolder` / `clearFolder` / `collectFolderNames` dans src/ (autres vues, engine, IPC, tests __tests__) ; vérifier que le chip DesignView est le seul point d'accès dossiers sans gestion ; lister les tests existants couvrant les dossiers (pour ne pas les casser) ; vérifier l'encodage réel de i18n/fr.json (ligne 505). Sortie : .cluster/scenes-delete/subagent_01.md
2. Mainline — patch DesignView.tsx (chip + trash hover) + fix fr.json si besoin.
3. SA-2 — Revue adverse du patch : HTML imbriqué interdit, drag&drop intact, stopPropagation, flux de confirmation, régressions visuelles possibles (chips wrap), cohérence store. Sortie : .cluster/scenes-delete/subagent_02.md
4. Validation : tsc + vitest (PAS de build exe — accord utilisateur requis).
5. Livraison : résumé + demande d'accord pour le build (regroupement de modifs possible).

## Dépendances
SA-1 → patch mainline → SA-2 → tsc/tests → livraison.
