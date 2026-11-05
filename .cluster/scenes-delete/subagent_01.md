# Recensement — Effacement de dossiers de scènes (onglet Scènes)

Date : 2026-08-27 · Agent : subagent_01 (lecture seule, aucun fichier modifié)
Commit de référence : `3aeddcc` (Thu Aug 20 23:22:41 2026 +0200)

---

## 1. Usages exhaustifs (`sceneFolders`, `deleteFolder`, `clearFolder`, `renameFolder`, `createFolder`, `collectFolderNames`, `normalizeFolderName`)

### 1.1 Store — `src/stores/showStore.ts` (seule source de vérité)
| Ligne | Rôle |
|---|---|
| 11 | import `normalizeFolderName` |
| 72-75 | `SavedScene.folder?: string` (classification libre) |
| 280-283 | état `sceneFolders: string[]` (entités déclarées) |
| 289-300 | types d'actions : `setSceneFolders`, `createFolder` (→ `string \| null`), `renameFolder`, `clearFolder`, `deleteFolder` |
| 667 | init `sceneFolders: []` |
| 696-704 | `createFolder` : normalise, refuse vide/duplicata (case-sensitive), `markDirty()` |
| 709-727 | `renameFolder` : renomme la liste déclarée **et** toutes les scènes ; `newName` vide = sémantique `clearFolder` (l'entité reste) |
| 729-738 | `clearFolder` : déclasse les scènes, l'entité dossier reste |
| 741-750 | `deleteFolder` : déclasse les scènes **et** retire l'entité de `sceneFolders` |
| 769-772 | `setSceneFolders` : normalise + filtre les vides |

Toutes les actions font `markDirty()` (persistance autosave propre).

### 1.2 Utilitaires — `src/utils/scene-fixtures.ts`
| Ligne | Rôle |
|---|---|
| 22-24 | `normalizeFolderName` (trim + collapse espaces) |
| 29-39 | `collectFolderNames(declared, scenes)` : union déclarés ∪ dérivés des `scene.folder`, dédupliqués, tri A→Z ; les dossiers déclarés-vides sont **préservés** |

### 1.3 UI — `src/views/DesignView.tsx` ← **SEUL endroit UI qui gère/affiche les dossiers**
| Ligne | Rôle |
|---|---|
| 298-302 | selectors store (`sceneFolders`, `createFolder`, `renameFolder`, `clearFolder`, `deleteFolder`) |
| 314 | état `confirmDeleteFolder: string \| null` |
| 329-336 | `folderOptions` = `collectFolderNames` + comptes live (déclaré-vide → count 0) |
| 341 | `activeFolderName` = filtre `folder:<name>` |
| 360-362 | logique de filtre par dossier |
| 371-382 | `handleDropOnFolder(folder)` : déplace la scène draguée ('' = retire du dossier) |
| 390-393 | états DnD : `dragSceneId`, `dragOverFolder` |
| 422-440 | projet vide : création de dossier toujours accessible (entités sans scènes) |
| 433, 475 | appels `createFolder(...)` + bascule du filtre sur le nouveau dossier |
| 514-521 | `<select>` : `<optgroup>` Dossiers (option par dossier + « Non classé ») |
| 542-543 | bouton « Nouveau dossier » |
| 550-612 | **toolbar du dossier actif** : confirmation de suppression (553-566), rename inline (571-589), actions rename/clear/delete (591-611) |
| 628-670 | **chips de dossiers** : div wrapper avec DnD + bouton filtre + **bouton corbeille au hover déjà présent (661-667)** |
| 674-694 | chip « Non classé » (cible de drop, `<button>` direct) |
| 753-755 | badge dossier sur chaque carte de scène |
| 802-834 | menu contextuel (clic droit) : « Déplacer vers le dossier », « Nouveau dossier… », « Non classé » |
| 908-911 | suggestions `datalist` de l'éditeur de scène |
| 1155-1170 | champ dossier (texte libre + datalist) dans l'éditeur |

### 1.4 Persistance (aucune UI de listing)
- `src/App.tsx` : 101 (sauvegarde projet : `sceneFolders` dans le snapshot) ; 260 (`setSceneFolders([])` au nouveau projet) ; 295-296 (chargement : `setSceneFolders(data.showStore.sceneFolders || [])` — **inconditionnel**, ne doit pas fuiter d'un projet précédent).
- `src/views/ShowManager.tsx` : 913 (export `.lmshow` embarque `sceneFolders`) ; 961 (import : `setSceneFolders`). Pas d'affichage de dossiers dans cette vue.
- `electron/show/storage.ts` : 154 (schéma `.lmshow`/`.lmscene`, champ optionnel, legacy OK) ; 239-242 (les dossiers ne sont **pas indexés** — re-dérivés de `scene.folder` au chargement ; round-trip brut par scène).

### 1.5 Moteur — `src/engine/auto-loops.ts` (impact indirect)
- 951 : `AUTO_LOOP_FOLDER = 'auto-loops'` — les scènes auto-générées sont **taguées** avec ce dossier ;
- 1004-1010 : `purgeAutoLoops`/refresh filtrent `s.folder === AUTO_LOOP_FOLDER` pour retrouver la génération précédente.
- ⚠️ Interaction : le dossier dérivé « auto-loops » apparaît dans les chips et est supprimable ; `deleteFolder('auto-loops')` déclasserait ces scènes → le purge/refresh suivant ne retrouverait plus les anciennes scènes (orphelins/doublons). Voir §4.5.

### 1.6 i18n
- `src/i18n/fr.json` 500-505 & `en.json` 500-505 : `renameFolder` / `clearFolder` / `createFolder` / `folderNamePlaceholder` / `deleteFolder` / `confirmDeleteFolder` (avec `{{name}}`).

### 1.7 Vues NON concernées (vérifié, grep `folder` case-insensitive sur tout `src/` + `electron/`)
- `QuickShowView.tsx` : uniquement l'icône `FolderOpen` (charger fichier) — **aucun usage de dossiers de scènes**.
- `PerformanceView.tsx` : aucune occurrence.
- `TopBar.tsx` : icône `FolderOpen` décorative.
- `electron/main.ts`, `electron/preload.ts` : aucune occurrence → **aucune fenêtre IPC n'expose les dossiers**.
- `electron/fixtures/library.ts` : commentaire sans lien.

**⇒ Confirmation : `DesignView.tsx` est le SEUL endroit UI où les dossiers sont gérés et affichés. Aucun autre écran n'a besoin de la même exposition.**

---

## 2. Tests couvrant les dossiers de scènes (`src/__tests__/`)

| Fichier | Lignes | Ce qui est vérifié |
|---|---|---|
| `scene-fixtures.test.ts` | 30-37 | `normalizeFolderName` : trim + collapse espaces, `''`/`'  '` → `''` (5 assertions) |
| `scene-fixtures.test.ts` | 40-53 | `collectFolderNames` : union déclarés ∪ dérivés, dédupliqués, tri A→Z ; **dossiers déclarés-vides préservés** (entités) |
| `auto-loops.test.ts` | 274-275, 293-294, 323-324, 327-328 | contrat de tag : toutes les scènes auto ont `folder === AUTO_LOOP_FOLDER` après materialize/refresh ; `purgeAutoLoops` retire les scènes taggées sans toucher aux scènes manuelles |
| `scene-3d-config.test.ts` | 10-57 | utilise `createScene`/`updateScene`/`getScene` mais **sans `folder`** — aucun impact dossier |

**Absence notable : aucun test ne couvre les actions store `createFolder` / `renameFolder` / `clearFolder` / `deleteFolder` ni l'état `sceneFolders`** (pas de `showStore.test.ts`).

**Ce qu'un patch UI ne doit PAS casser :**
1. Sémantique de `normalizeFolderName` (trim, collapse, vide→'') — utilisée par le store ET les tests.
2. Sémantique de `collectFolderNames` (déclaré-vide conservé, tri, dédup) — c'est ce qui fait réapparaître un dossier créé sans scène.
3. Le contrat de tag `auto-loops` (§1.5) — si le patch touche au store, ne jamais altérer les scènes taggées.
4. `setSceneFolders` **inconditionnel** au chargement de projet (App.tsx L296) — pas un point de patch, mais à connaître.

Un patch purement UI (DesignView.tsx + i18n) ne peut pas casser ces tests (aucun test UI des chips n'existe).

---

## 3. Encodage réel de `src/i18n/fr.json` — VERDICT

**Le fichier est SAIN. Rien à réécrire.**

Mesures brutes (bytes réels lus par `ReadAllBytes`) :
- Taille : **31 240 octets** · Lignes : 885 · BOM (EF BB BF) : **absent** · Séquence U+FFFD (EF BF BD) : **0** · Octets NUL : 0 · JSON valide · **propre dans git** (aucune modification en attente).
- Hexdump de la ligne 505 (clé `confirmDeleteFolder`) :
  `Supprimer 20 C2AB 20 {{name}} 20 C2BB 20 3F 20 Les sc C3A8 nes restent (non class C3A9 es).`
  → `C2 AB` = « , `C2 BB` = », `C3 A8` = è, `C3 A9` = é. **UTF-8 parfaitement valide.**
- Contenu réel de la ligne : `"confirmDeleteFolder": "Supprimer « {{name}} » ? Les scènes restent (non classées)."`

**Conclusion :** le « Supprimer � {{name}} � ? Les sc�nes restent (non class�es). » vu en console est un **artefact d'affichage** (codepage console PowerShell CP850/CP1252 qui affiche de l'UTF-8). Preuve : la même console mojibake les messages système (« Au caract�re Ligne ») et la sortie de `dir`. React/i18next importe le JSON en UTF-8 : le rendu in-app est correct. Aucune correction de fichier nécessaire. (`en.json` : 28 643 octets, pas de BOM non plus, ligne 505 correcte : `Delete "{{name}}"? Scenes stay (uncategorized).`)

---

## 4. Chips dans `DesignView.tsx` — contexte & pièges techniques

### ⚠️ Découverte majeure : le bouton de suppression au hover **EXISTE DÉJÀ**
Le chip n'est **pas** un `<button>` unique : c'est un `<div>` wrapper (L648-668) contenant **deux `<button>`** :
1. **Bouton filtre** (L653-659) : `onClick={() => setSceneFilter(fo.value)}` → 📁 {fo.name}
2. **Bouton corbeille** (L661-667) : `onClick={(e) => { e.stopPropagation(); setSceneFilter(fo.value); setConfirmDeleteFolder(fo.name); }}`, stylé `opacity-60 group-hover:opacity-100` — **visible au hover du chip** (`group` est sur le div L647).

La prémisse « le chip actuel est un `<button>` » (donc pas de bouton imbriqué possible) est **obsolète**. Le flux demandé fonctionne déjà : clic corbeille → filtre sur le dossier + `confirmDeleteFolder` → la toolbar (L553, condition `confirmDeleteFolder === activeFolderName`) affiche « Supprimer « name » ? » avec Confirmer/Annuler → `deleteFolder(activeFolderName); setSceneFilter(''); setConfirmDeleteFolder(null)` (L559).

### Pièges si on touche quand même aux chips
1. **Imbrication de boutons** : OK sur les chips de dossier (wrapper div, pas de bouton dans bouton). MAIS le chip **« Non classé »** (L674-694) est un vrai `<button>` avec handlers DnD dessus → **ne jamais y ajouter de bouton interne** (HTML invalide, React warning).
2. **Drag & drop sur le chip** : le div wrapper porte `onDragOver` (préventDefault + dropEffect 'move' + setDragOverFolder, seulement si `dragSceneId`), `onDragLeave`, `onDrop` (preventDefault + stopPropagation + `handleDropOnFolder`). Piège connu : `dragleave` se déclenche quand le pointeur entre dans un enfant (les 2 boutons) → le code compense par `setDragOverFolder((cur) => (cur === fo.name ? null : cur))` et le dragover suivant re-sette l'état (léger flicker accepté). Tout nouvel élément dans le chip hérite de ces handlers — ne pas y mettre de `onDragStart`, ne pas `stopPropagation` sur dragover.
3. **`stopPropagation`** : le bouton corbeille existant l'appelle déjà sur click (L662) — nécessaire car le click remonterait vers d'éventuels handlers ancêtres du conteneur. Conserver ce pattern pour tout bouton ajouté. **Manque** : le bouton corbeille n'a pas de `stopPropagation` sur **onDrop** — si l'utilisateur drague une scène et la lâche sur la corbeille, le drop remonte au div et `handleDropOnFolder` déplace la scène au lieu d'ouvrir la confirmation (rare, mais possible ; un `onDrop` avec `e.stopPropagation()` sur le bouton corbeille réglerait ça).
4. **`confirmDeleteFolder` réutilisable tel quel** : le chip le couple déjà avec `setSceneFilter(fo.value)` pour que `activeFolderName` matche (L663-665). Après suppression, le filtre est réinitialisé à `''` (L559) — le dossier disparaît proprement du filtre, des chips (plus d'entité ni de scènes classées) et du `<select>`. Si on veut une confirmation **inline sur le chip**, il faudra dupliquer le mini-état (le `confirmDeleteFolder` actuel est rendu uniquement dans la toolbar).
5. **Piège auto-loops (pré-existant, à surveiller)** : `collectFolderNames` dérive les dossiers des `scene.folder` → le dossier « auto-loops » apparaît dans les chips et est donc **déjà supprimable** par le bouton existant. `deleteFolder('auto-loops')` déclasserait les scènes auto-générées ; or `purgeAutoLoops`/`refreshAutoLoops` (auto-loops.ts L1010) filtrent `s.folder === AUTO_LOOP_FOLDER` pour nettoyer la génération précédente → à la prochaine régénération, les anciennes scènes ne seraient plus retrouvées (doublons). Non cassé par le patch demandé, mais option à considérer : exclure `AUTO_LOOP_FOLDER` des chips ou le protéger.
6. **Accessibilité mineure** : le bouton corbeille du chip n'a que `title`, pas d'`aria-label`.

### Code exact à connaître (L648-668)
```tsx
<div key={fo.value}
  onDragOver={(e) => { if (!dragSceneId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFolder(fo.name); }}
  onDragLeave={() => setDragOverFolder((cur) => (cur === fo.name ? null : cur))}
  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnFolder(fo.name); }}
  className={`group inline-flex items-center text-[10px] rounded border transition-colors ${dragOverFolder === fo.name ? 'border-purple-400 bg-purple-600/30 text-purple-200' : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:text-purple-300 hover:border-purple-500/50'}`}>
  <button onClick={() => setSceneFilter(fo.value)} title={t('design.scenes.dropSceneHint')} className="px-1.5 py-0.5">📁 {fo.name}</button>
  <button onClick={(e) => { e.stopPropagation(); setSceneFilter(fo.value); setConfirmDeleteFolder(fo.name); }}
    title={t('design.scenes.deleteFolder')}
    className="px-1 py-0.5 text-gray-500 hover:text-red-400 opacity-60 group-hover:opacity-100 transition-opacity">
    <Trash2 size={10} />
  </button>
</div>
```

---

## VERDICT

**RIEN D'AUTRE À PATCHER** pour la demande « effacer un dossier depuis l'onglet scènes » :
- Le store expose déjà `deleteFolder` (L741) et la toolbar gère déjà confirmation + suppression (L553-566, L605-609).
- **Le bouton corbeille au hover sur chaque chip existe déjà** (DesignView.tsx L661-667) et réutilise `confirmDeleteFolder` proprement.
- Aucun autre écran (QuickShowView, ShowManager, PerformanceView, IPC, export/import) ne liste ou ne gère les dossiers : DesignView est bien le seul point d'exposition.
- `fr.json` est valide (UTF-8 sans BOM, 0 × U+FFFD, propre git) — le « � » est un artefact console, aucune réécriture nécessaire.

Points facultatifs (non bloquants) si l'UX doit être affinée :
1. Vérifier que l'utilisateur **voit** le bouton corbeille : il est `opacity-60` → `group-hover:opacity-100` (le hover complet du chip est requis ; sur écran tactile il est invisible — un clic long ou un bouton toujours visible serait l'amélioration réelle).
2. `stopPropagation` manquant sur `onDrop` du bouton corbeille (drop de scène sur corbeille = déplacement au lieu de confirmation).
3. Dossier « auto-loops » supprimable par le chip → casse le contrat de purge d'auto-loops (envisager de l'exclure des chips ou de le protéger dans le store).
