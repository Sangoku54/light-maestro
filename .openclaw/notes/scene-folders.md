# Dossiers de scènes — comportement & pièges

## Modèle de données (showStore.ts)
- `sceneFolders: string[]` = dossiers DÉCLARÉS (entités persistées).
- Chaque `SavedScene` a un champ `folder?: string` (normalisé via `normalizeFolderName`).
- `collectFolderNames(sceneFolders, scenes)` (src/utils/scene-utils ou équivalent) = union des dossiers déclarés + des dossiers dérivés des scènes, triée A→Z. Un dossier déclaré vide reste affiché (count 0).

## Actions (showStore.ts)
- `createFolder(name)` : crée une entité déclarée (normalisée, dédupliquée). Retourne le nom ou null si vide.
- `renameFolder(old, new)` : renomme l'entité déclarée ET met à jour le champ `folder` de toutes les scènes concernées.
- `clearFolder(name)` : désassigne toutes les scènes du dossier (folder → undefined), l'entité déclarée reste.
- `deleteFolder(name)` : désassigne les scènes PUIS retire l'entité déclarée. Les scènes ne sont JAMAIS supprimées (message de confirmation : « Les scènes restent (non classées) »).

## UI (DesignView.tsx, onglet Scènes)
- Chaque dossier est un chip : clic = filtre, drag&drop d'une scène dessus = déplacement, bouton poubelle au survol = suppression avec confirmation.
- La toolbar « dossier actif » (rename / retirer / supprimer) n'apparaît que quand un dossier est sélectionné dans le filtre.
- Cliquer la poubelle d'un chip bascule le filtre vers ce dossier pour afficher la confirmation ; « Annuler » ne restaure pas le filtre précédent (comportement voulu).

## ⚠️ Dossier système « auto-loops » — PROTÉGÉ
- `AUTO_LOOP_FOLDER = 'auto-loops'` (src/engine/auto-loops.ts) est taggé sur les scènes générées automatiquement.
- `purgeAutoLoops` filtre en stricte égalité `s.folder === AUTO_LOOP_FOLDER`.
- Si ce dossier était supprimé, ses scènes seraient désassignées → le purge ne les trouverait plus → résidus + doublons à la prochaine génération (pas de crash, mais scènes fantômes).
- **Protection en place** : la poubelle (chip ET toolbar) est masquée pour `AUTO_LOOP_FOLDER` (DesignView.tsx). `clearFolder` reste accessible sur ce dossier — ne pas l'utiliser sur auto-loops (effet équivalent sur le purge). Si le besoin de purge sain apparaît : réassigner les scènes à `AUTO_LOOP_FOLDER` ou relancer la génération.
