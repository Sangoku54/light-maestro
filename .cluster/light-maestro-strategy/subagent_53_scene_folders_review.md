# Revue adversarial — Dossiers de scènes libres (`folder?: string`)

Date : 2026-08-16 · Réviseur : subagent 53 · Lecture seule, aucun fichier modifié.

## 1. Persistance — OK, avec 2 ajustements de type

- `showStore.ts:56` `SavedScene` : ajouter `folder?: string`.
- **`showStore.ts:262` `updateScene`** : `Partial<Pick<SavedScene, 'name'|'channels'|'fadeIn'|'fadeOut'|'duration'>>` doit gagner `'folder'` sinon erreur TS dès le premier `updateScene(id, {folder})`.
- Sauvegarde .lmshow : `ShowManager.tsx:909` sérialise `scenes` BRUT ; `electron/main.ts:425` → `ShowStorage.save` (`storage.ts:176`) = `JSON.stringify` brut. Aucune whitelist/validation → `folder` traverse.
- Chargement .lmshow : `ShowManager.tsx:953` `setScenes(show.scenes)` brut ; `ShowStorage.load` (`storage.ts:199`) = `JSON.parse` brut (warn seulement si schemaVersion > 1).
- .lmproj : `App.tsx:94` (save) et `App.tsx:282` (load) → bruts. Autosave (`main.ts:632`) → brut.
- **À corriger** : `storage.ts:17` `ShowScene` doit gagner `folder?: string` (hygiène TS ; l'assignabilité `SavedScene[]`→`ShowScene[]` reste valide sans, mais tout code typé electron qui lit/construit des scènes en aura besoin). `indexShow` l'ignore — OK.
- Bonus : `.lmscene` (export/import `storage.ts:301-319`) passe la scène en brut → `folder` survit sans changer le format.

## 2. Rétro-compatibilité — OK

Aucune validation stricte nulle part (cast `as ShowData`, schemaVersion tolérant). Anciens fichiers sans `folder` → `undefined` → traité « non classé » (`folder` falsy). Fichiers nouveaux chargés par une vieille version : champ ignoré, aucun rejet.

## 3. UX création — champ texte + datalist suffisant pour v1, mais prévoir 3 helpers

Les dossiers sont **dérivés** (pas d'entité) : renommage = renommer le champ de N scènes. Prévoir dans le store : `renameFolder(old, new)` (map sur scenes), `clearFolder(name)` (→ `folder: undefined`), et normalisation à la sauvegarde (**trim + espaces multiples**). Ne PAS case-folder silencieusement (« Front » ≠ « front » reste possible ; la datalist guide). Dossier vide → disparaît de lui-même (aucun état orphelin). Attention : le champ folder doit avoir son state local + resync dans le `useEffect [scene?.id]` (`DesignView.tsx:~575`), comme name/fade, sinon champ fantôme au changement de scène.

## 4. Filtre — à corriger (collision de valeurs + message trompeur)

Select `DesignView.tsx:371-387`, valeurs : `''`, `pf.id`, sentinel `'unassigned'`. **Risque** : valeur d'option = nom saisi par l'utilisateur → peut collider avec `'unassigned'`/`''`. **Correction** : préfixer `folder:${name}` (les ids fixtures `fx-…` ne collisionnent pas). Ordre : optgroup « Dossiers » (A→Z, « Non classé » en dernier), puis fixtures (ordre existant univers→adresse), « Toutes » hors optgroup. **`DesignView.tsx:364`** : `showEmptyFixture` vaut vrai pour un folder vide → message « Aucune scène pour ce projecteur » trompeur ; ajouter une branche folder. `filteredScenes` (`:317-331`) doit gérer le cas folder. Filtrer par folder OU fixture (select unique) : scène classée + touchant une fixture = un seul filtre actif — acceptable v1.

## 5. Contrainte additive — OK, aucun chemin playback touché

`dmx-playback.ts` : aucune référence à `__lm_selectedSceneId` ni à `folder` (grep vide). `scene-fixtures.ts:25-31` (`sceneTouchesFixture`) ne lit que `scene.channels` → prédicat partagé playback inchangé. `PerformanceView.tsx` résout les scènes par id (`find`) : champ extra ignoré ; `:1648` `setScenes` brut. Le hack `__lm_selectedSceneId` (écrit `DesignView.tsx:353`, poll `:538`) : filtrer n'efface PAS l'id → l'éditeur continue d'éditer la scène masquée, aucun crash (simple confusion visuelle possible). `:6037` remise à null au unmount — sans interaction.

## 6. i18n — clés à ajouter (fr + en, cohérentes)

- `design.scenes.folders` : « Dossiers » / « Folders » (label optgroup)
- `design.scenes.uncategorized` : « Non classé ({{count}}) » / « Uncategorized ({{count}}) » — **ne pas réutiliser** `unassigned` (« Sans projecteur ») : sémantique différente (pas de fixture ≠ pas de dossier)
- `design.scenes.folderPlaceholder` : « Dossier (optionnel) » / « Folder (optional) »
- `design.scenes.folder` : « Dossier » / « Folder » (label du champ)
- Utiliser `t()` dès le départ (le fichier mélange déjà dur + i18n).

## Pièges à éviter pendant l'implémentation

1. Oublier `'folder'` dans le Pick de `updateScene` (`showStore.ts:262`) → erreur TS (écueil n°1).
2. Option de folder sans préfixe → collision avec le sentinel `'unassigned'`.
3. Pas de resync `[scene?.id]` du state local folder → champ écrasé/fantôme.
4. Pas de trim → « front » vs « front␣ » = 2 dossiers.
5. « deleteFolder » qui supprimerait des scènes — non : `clearFolder` remet `folder: undefined`.
6. Toucher `scene-fixtures.ts` / `dmx-playback.ts` : prédicat partagé, folder n'y a rien à faire.
7. `showEmptyFixture` (`:364`) non ajusté → message « noScenesForFixture » pour un dossier vide.
8. Ajouter les clés i18n dans fr.json ET en.json, sinon fallback anglais partout.
9. Ne pas réordonner les fixtures du select (tri univers→adresse existant) pour insérer les dossiers.
10. markDirty : déjà géré par `updateScene` (`showStore.ts:650`) — rien à ajouter.
