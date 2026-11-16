# Subagent 54 — Revue du correctif « dossiers de scènes » (sceneFolders)

Date : 2026-08-16 · Agent de revue (lecture seule) · Base : commit 1b4b219 + working tree en cours d'implémentation (le correctif a été implémenté pendant la revue — état final figé à 21:17)

**Verdict global : le plan est correctement implémenté sur le fond (store, save/load, rétro-compat, i18n). 3 vrais problèmes et 3 points mineurs à corriger avant livraison.**

---

## Point 1 — showStore.ts : OK (avec 1 incohérence mineure doc/comportement)

- `SavedScene.folder?: string` — `src/stores/showStore.ts:62-64` (interface l.56-64) : OK.
- `updateScene` Pick inclut `'folder'` — `showStore.ts:271` : OK.
- État initial `scenes: []` / `sceneFolders: []` — `showStore.ts:652-653` : OK.
- `setScenes` avec markDirty — `showStore.ts:744-749` (le plan citait l.707, la ligne a glissé après insertions, l'action existe bien) : OK.
- `setSceneFolders(folders)` — `showStore.ts:752-756` : normalise (`normalizeFolderName`), filtre les vides, markDirty. OK.
- `createFolder(name)` — `showStore.ts:680-691` : normalise, ignore vide, dédoublonne case-sensitive (`f === n`), markDirty, retourne `n` ou `null`. Conforme au plan.
- `renameFolder` ÉTENDU — `showStore.ts:693-713` : met à jour les scènes **et** `sceneFolders` (`filter(f => f !== from).concat(to && !includes(to) ? [to] : [])`). Dedup correct. OK.
- `clearFolder` inchangé (désassigne les scènes, ne touche pas `sceneFolders`) — `showStore.ts:715-726` : OK.
- `deleteFolder` — `showStore.ts:728-741` : retire de `sceneFolders` + désassigne les scènes + markDirty : OK.
- Autres constructions d'état/clones du store : aucun. `showStore` n'a PAS de middleware `persist` (seuls appStore/performStore/rgbmatrixStore en ont), aucune restauration au démarrage (`src/App.tsx:203` « ShowStore: no auto-load on startup »), aucun `useShowStore.setState({...})` global (seul `ShowManager.tsx:948` setState partiel sur `shows`). Aucun autre point d'injection.

⚠️ **Mineur (doc vs comportement)** : le commentaire au-dessus de `renameFolder` dit « Empty newName = clearFolder semantics (scenes become uncategorized) » (`showStore.ts:694-695`), mais avec `to === ''` l'implémentation **retire aussi le dossier déclaré** de `sceneFolders` (le `to &&` du concat). `clearFolder` garde le dossier, `renameFolder('x','')` le supprime. Non atteignable depuis l'UI (le handler renommage garde `if (v && v !== activeFolderName)`), mais incohérent au niveau contrat du store : soit aligner le comportement sur le commentaire (garder le dossier), soit corriger le commentaire.
⚠️ **Mineur (edge)** : `renameFolder('A','A')` (même nom) retire « A » de `sceneFolders` (le `includes(to)` est évalué sur la liste d'origine, donc pas de ré-ajout). Gardé par l'UI, mais à connaître.

## Point 2 — Points d'injection save/load : OK (tous les chemins couverts)

- `.lmproj` payload — `src/App.tsx:95` `sceneFolders: showState.sceneFolders` : OK.
- Reset « New » — `src/App.tsx:254` `ss.setSceneFolders([])` : OK.
- Load `.lmproj` — `src/App.tsx:285` `if (data.showStore.sceneFolders) ss.setSceneFolders(data.showStore.sceneFolders)` : OK.
- `.lmshow` payload — `src/views/ShowManager.tsx:910` : OK.
- Load `.lmshow` — `src/views/ShowManager.tsx:955` `if (Array.isArray(show.sceneFolders)) state.setSceneFolders(show.sceneFolders)` : OK (gardé par Array.isArray → rétro-compat sûre).
- `electron/show/storage.ts` ShowData — `storage.ts:152-154` `sceneFolders?: string[]` juste après `scenes: ShowScene[];` (l.151) : OK.
- **Autosave** : passe par `saveProject({silent})` → même payload (App.tsx l.88-101) → couvert : OK.
- **Export/import `.lmscene`** (`storage.ts:301-319`) : exporte `{ format, scene }` — le champ `folder` de la scène voyage avec elle ; à l'import, le dossier dérivé ressort via l'union `collectFolderNames`. Aucune entité `sceneFolders` dans le .lmscene : acceptable par design (une scène seule ne transporte pas la liste des dossiers). Aucun changement requis, à documenter.
- **Indexation SQLite `indexShow`** (`storage.ts:256-296`) : table `scenes` (id, show_id, name, channel_count) sans colonne folder. Ce n'est qu'un index de recherche reconstruit à chaque save → aucune perte. Pas de changement requis.
- **Type miroir renderer** : aucun — `src/types.d.ts:195` déclare `show.save(show: any, ...)` et le `ShowData` renderer vit dans `showStore.ts`. Rien à faire.

⚠️ **Mineur (fantôme à l'ouverture)** : au load `.lmproj`, si le fichier **n'a pas** `sceneFolders` (anciens fichiers), le store **garde les dossiers du projet précédent** en mémoire (le `if` ne reset pas). Comme les dossiers vides déclarés sont visibles dans le filtre, l'utilisateur verra des dossiers fantômes du projet précédent. Recommandation : `ss.setSceneFolders(data.showStore.sceneFolders || [])` (inconditionnel). Même schéma latent pour ShowManager load (sémantique de merge, moins critique).

## Point 3 — Rétro-compat : OK

- Fichiers sans `sceneFolders` → l'état reste `[]` (init `showStore.ts:653`) : OK.
- L'union avec les dossiers dérivés est garantie par `collectFolderNames(declared, scenes)` — `src/utils/scene-fixtures.ts:26-40` : normalise, dédoublonne (Set case-sensitive), trie A→Z, préserve les dossiers déclarés vides. OK.
- Aucun `undefined` cassant : `sceneFolders` est toujours un tableau dans le store (init `[]`, sélecteurs `useShowStore((s) => s.sceneFolders)`), tous les points d'entrée externes sont gardés (`if (data.showStore.sceneFolders)` App.tsx:285, `Array.isArray` ShowManager.tsx:955). `collectFolderNames` ne reçoit jamais `undefined`. OK.
- Tests ajoutés — `src/__tests__/scene-fixtures.test.ts:40-57` (`collectFolderNames` : union + dedup + tri, dossiers vides préservés). 12 tests passent (`vitest run`). OK.

## Point 4 — UI DesignView SceneList : PROBLÈME (2 vrais + 2 mineurs)

Ce qui est OK :
- Bouton « + Dossier » (`FolderPlus`) à côté du select — `src/views/DesignView.tsx:468-475`, avec état local `creatingFolder` (l.306) : OK.
- Input inline création : Enter → `createFolder` + filtre sur le dossier créé ; Escape → ferme (l.402-414). Conforme au plan.
- `folderOptions` = union déclarés ∪ dérivés, triée A→Z, compteurs (vides = 0) — `DesignView.tsx:318-330` (deps `[sceneFolders, scenes]`) : OK.
- Toolbar dossier actif — `DesignView.tsx:430-536` : ✎ rename (l.500-518, appelle `renameFolder` qui met à jour sceneFolders), ✕ clearFolder (l.519-524, le dossier reste listé), 🗑 `Trash2` deleteFolder avec confirmation inline (l.431-452, 525-531). Conforme au plan.
- Collisions : valeur `folder:<name>` préfixée (l.323) → aucun conflit avec les sentinelles `'unassigned'`/`'uncategorized'` ni les IDs fixtures (déjà commenté l.300-301 et vérifié dans `filteredScenes` l.349-356). OK.
- SceneEditor : `sceneFolders` sélecteur ajouté (l.697), `folderSuggestions` = `collectFolderNames(sceneFolders, scenes)` (l.699-701, deps correctes) — datalist = union. OK. Resync `[scene?.id]` inchangée et correcte.

🔴 **PROBLÈME 1 — État vide : le bouton « + Dossier » est inaccessible quand il n'y a aucune scène.** `DesignView.tsx:382-387` : `if (scenes.length === 0) { return (... "No scenes yet" ...) }` — le early-return court-circuite TOUTE la barre de filtre (et donc le bouton +Dossier ET le select). Conséquences : (a) impossible de créer le premier dossier dans un projet vierge — or le plan exige « création explicite avec bouton « + Dossier » » et « dossiers vides autorisés » ; (b) un projet chargé avec `sceneFolders` mais 0 scène masque les dossiers vides (non sélectionnables). **Correctif** : conditionner le early-return à `scenes.length === 0 && sceneFolders.length === 0` et intégrer un bouton « + Dossier » dans l'état vide dédié.

🔴 **PROBLÈME 2 — Le `onBlur` de l'input de création crée le dossier même quand l'utilisateur annule.** `DesignView.tsx:415-419` : `onBlur={(e) => { const n = createFolder(e.target.value); if (n) setSceneFilter(...); setCreatingFolder(false); }}`. Le bouton ✕ (l.421-426) ne peut PAS annuler après frappe : le mousedown sur ✕ déplace le focus → `blur` se déclenche AVANT le click → le dossier tapé est créé (puis l'input démonte, le click n'arrive même pas). Escape est à risque selon le navigateur (le blur natif au démontage d'un élément focalisé est tiré par Chrome). Le plan ne prévoyait que « Enter=créer, Escape=annuler ». **Correctif** : créer uniquement sur Enter (ou bouton ✓ dédié), `onBlur` ne fait que fermer — ou garde-flag ref (`cancelledRef`) posé par Escape/✕ et vérifié dans le blur.

⚠️ **Mineur 3 — Filtre périmé après rename.** Le rename (l.500-507) ne met pas à jour `sceneFilter` : après renommage du dossier actif, le select pointe sur `folder:<ancien nom>` (plus dans les options) → liste vide + message « Aucune scène dans ce dossier ». Recommandation : `setSceneFilter('folder:' + v)` après un rename réussi.

⚠️ **Mineur 4 — `folderOptions` : l'optgroup ne s'affiche que si `folderOptions.length > 0`** (l.445) — correct pour l'union, mais lié au PROBLÈME 1 (0 scène + 0 dossier → rien d'atteignable).

## Point 5 — i18n : OK (clés ajoutées, miroir strict vérifié programmatiquement)

- `fr.json:501-506` et `en.json:501-506` : `createFolder` (« Nouveau dossier » / « New folder »), `folderNamePlaceholder` (« Nom du dossier » / « Folder name »), `deleteFolder` (« Supprimer le dossier » / « Delete folder »), `confirmDeleteFolder` (« Supprimer « {{name}} » ? Les scènes restent (non classées). » / « Delete "{{name}}"? Scenes stay (uncategorized). »), `confirm`, `cancel`.
- UTF-8 vérifié propre (les « » et é/è sont intacts ; le mojibake vu en console était un artefact d'affichage PowerShell).
- Miroir strict fr/en : 18 clés chacune dans `design.scenes`, `JSON.stringify(keysFR) === JSON.stringify(keysEN)` → vrai.
- `cancel`/`confirm` existaient au niveau racine (fr.json:30-34) ; les nouvelles clés `design.scenes.cancel/confirm` sont ajoutées sous le bloc scenes — pas de conflit.
- Note : le plan prévoyait une clé séparée `deleteFolderKeepsScenes` ; elle est fusionnée dans `confirmDeleteFolder` (les deux langues l'annoncent) — acceptable, mais si l'on veut la réutiliser ailleurs, la sortir en clé dédiée.

## Point 6 — Pièges généraux : PROBLÈME (résumé des points 4-1/4-2 + OK partiels)

- Dossiers vides sélectionnables : OK quand `scenes.length > 0` (count 0 dans l'optgroup) ; **KO à 0 scène** (early-return, cf. Problème 4-1).
- État vide dédié : **absent** (l'état vide existant n'offre pas +Dossier).
- Resync du state local sur `[scene?.id]` : inchangée et correcte (`DesignView.tsx:678-701`).
- Interaction avec le filtre par fixture : OK (`filteredScenes` l.344-358, préfixes disjoints).
- `markDirty` sur chaque action : OK — createFolder, renameFolder, clearFolder, deleteFolder, setSceneFolders, setScenes appellent tous `useAppStore.getState().markDirty()`.
- Sélecteurs store disponibles dans DesignView : OK (`DesignView.tsx:294-298` SceneList, l.697 SceneEditor).
- Compilation : `tsc -p tsconfig.electron.json` et `tsc -p tsconfig.json` → exit 0 ; `vitest run scene-fixtures.test.ts` → 12/12 OK.

---

## Liste finale des corrections à apporter

1. **État vide (bloquant pour le plan)** — `DesignView.tsx:382-387` : changer la condition en `scenes.length === 0 && sceneFolders.length === 0` et ajouter un accès « + Dossier » dans l'état vide, pour que la création du premier dossier (vide) soit possible et que les dossiers vides chargés restent visibles.
2. **Blur de l'input de création (bloquant)** — `DesignView.tsx:415-419` : ne plus créer au `onBlur` (ou garde-flag annulation) ; création uniquement sur Enter (ou bouton ✓), Escape/✕ = vraie annulation. Cas déterministe : ✕ après frappe crée le dossier.
3. **Reset au load `.lmproj` (mineur mais visible)** — `App.tsx:285` : `ss.setSceneFolders(data.showStore.sceneFolders || [])` pour éviter les dossiers fantômes du projet précédent quand l'ancien fichier n'a pas le champ.
4. **Filtre périmé après rename (polish)** — `DesignView.tsx:500-507` : `setSceneFilter('folder:' + v)` après rename réussi.
5. **Cohérence doc/contrat `renameFolder` (polish)** — `showStore.ts:694-695` : soit garder le dossier déclaré quand `newName` est vide (aligner sur le commentaire « clearFolder semantics »), soit corriger le commentaire.
6. **Documenter** que `.lmscene` ne transporte pas `sceneFolders` (le dossier redevient « dérivé » à l'import — visible via l'union, mais pas déclaré) et que l'index SQLite n'indexe pas les dossiers (recherche uniquement).
