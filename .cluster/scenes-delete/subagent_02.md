# Revue adverse — Patch « suppression de dossier sur les chips » (DesignView.tsx)

**Agent :** subagent_02 (revue adverse)
**Date :** 2026-08-27
**Périmètre :** `src/views/DesignView.tsx` (~L628-671), flux de confirmation existant, `deleteFolder` (showStore), `purgeAutoLoops` (auto-loops.ts).
**Méthode :** lecture du code réel + `git diff` du fichier + `tsc --noEmit` (exit 0). Aucun fichier modifié.

---

## A. Cohérence du diff — VERDICT : OK

Le `git diff src/views/DesignView.tsx` (hunk `@@ -627,9 +629,8 @@`) correspond exactement au patch décrit. Comparaison ancien `<button>` / nouveau `<div class="group inline-flex">` :

| Élément | Ancien button | Nouveau div / boutons | Perdu ? |
|---|---|---|---|
| onClick filtre | `setSceneFilter(fo.value)` | bouton enfant 1 (L653-656) | Non |
| onDragOver | guard `dragSceneId` + preventDefault + dropEffect + `setDragOverFolder(fo.name)` | div (L634-639) | Non |
| onDragLeave | `setDragOverFolder(cur => cur === fo.name ? null : cur)` | div (L640-641) | Non |
| onDrop | preventDefault + stopPropagation + `handleDropOnFolder(fo.name)` | div (L642-645) | Non |
| title | `dropSceneHint` | bouton enfant 1 (L654) | Non (déplacé) |
| classes dragOverFolder | `border-purple-400 bg-purple-600/30 text-purple-200` etc. | div (L646-650) | Non |
| `text-[10px] rounded border transition-colors` | sur le button | sur le div | Non |

Rien n'a été perdu. Nuance mineure : le `title={dropSceneHint}` ne s'affiche plus au survol du trash (le div n'a pas de title) — le trash a son propre title `deleteFolder`. Comportement intentionnel, OK.

## B. Imbrication HTML — VERDICT : OK

- `div.group` > 2 `<button>` : HTML valide, pas de boutons imbriqués.
- Le chip « Non classé » (L672-691) reste un `<button>` unique, avec ses handlers dragover/dragleave/drop intacts (`handleDropOnFolder('')`).
- Le conteneur des chips est un `<div className="flex flex-wrap gap-1">` (L630) — le nouveau `div.group` n'est imbriqué dans aucun bouton. Aucun risque d'imbrication restant.

## C. Drag & drop intact — VERDICT : OK

- Drop sur n'importe quelle zone du div (y compris au-dessus du bouton trash) : les événements DnD **bubbent** du bouton enfant vers le div → `onDrop` du div → `handleDropOnFolder(fo.name)`. Aucun stopPropagation DnD sur les enfants. ✓
- `dragover` au-dessus du trash : bubble vers le div → `preventDefault()` → le drop reste autorisé + `setDragOverFolder(fo.name)` (surbrillance). ✓
- Click sur trash : `e.stopPropagation()` est appliqué. Les frères ne reçoivent jamais l'événement (pas de propagation latérale en DOM) → le bouton filtre n'est PAS déclenché. Le div n'a pas d'onClick → le stopPropagation est redondant aujourd'hui mais protecteur. ✓
- Transition div → bouton enfant pendant un drag : pas de `dragleave` intempestif (le pointeur reste dans la zone du div) → surbrillance stable. ✓

## D. Flux de confirmation complet — VERDICT : OK (1 note UX)

Chaîne vérifiée ligne par ligne :
1. Clic trash (L661-667) : `setSceneFilter(fo.value)` puis `setConfirmDeleteFolder(fo.name)`, même handler → **React 18 batch automatique** → un seul render → `activeFolderName = sceneFilter.slice('folder:'.length)` (L341) = `fo.name` → `confirmDeleteFolder === activeFolderName` (L553) → la toolbar passe en mode « Supprimer {name} ? ». ✓
2. `fo.name` provient de `collectFolderNames` (déjà normalisé) ; `deleteFolder` re-normalise (L742) → pas de mismatch. ✓
3. Confirmer (L559) : `deleteFolder(activeFolderName)` → store (showStore L741-753) : désassigne **toutes** les scènes du dossier (`folder → undefined`) **et** retire le dossier de `sceneFolders`. Puis `setSceneFilter('')` + `setConfirmDeleteFolder(null)`. ✓
4. Après suppression : filtre reset → toolbar disparaît (`activeFolderName === null`) ; `folderOptions` (L328-335) recalculé via `collectFolderNames(sceneFolders, scenes)` (scene-fixtures.ts L29-41) → le dossier disparaît des chips (plus déclaré, plus référencé). ✓
5. Suppression du dossier **actuellement filtré** : couvert par le point 4 (le Confirmer reset le filtre). ✓
6. `deleteFolder` idempotent (no-op si dossier inconnu) → pas de cas limite cassé. ✓

**Note UX (non bloquante) :** cliquer le trash d'un chip d'un **autre** dossier que le filtre courant bascule le filtre vers ce dossier (L662) avant d'afficher la confirmation ; si l'utilisateur annule, son filtre précédent est perdu. C'est le comportement voulu du patch (nécessaire pour afficher la toolbar au-dessus de la liste du dossier concerné), mais à connaître : la confirmation d'annulation ne restaure pas le filtre initial.

## E. Cas particulier « auto-loops » — VERDICT : OK (point documenté acceptable, à documenter)

Vérifié dans le code réel :
- `AUTO_LOOP_FOLDER = 'auto-loops'` (auto-loops.ts L951). `materializeAutoLoops` tagge les scènes `folder: 'auto-loops'` (L987) **sans déclarer le dossier dans `sceneFolders`** (les seuls `createFolder` sont dans DesignView L433/L475). Le chip « auto-loops » n'existe donc que par dérivation depuis les scènes (`collectFolderNames`).
- `purgeAutoLoops` (L1008-1019) filtre `s.folder === AUTO_LOOP_FOLDER` (comparaison **stricte**). Si l'utilisateur supprime le dossier via l'UI, `deleteFolder` désassigne les scènes → le purge ne les trouve plus → les vieilles scènes + chasers « Auto · … » restent **indéfiniment** (le purge est appelé à chaque changement de patch et avant chaque nouveau loop dans AutoLoopsPanel L91-93/L131-133, mais il ne matche plus rien).
- Impact réel : pollution persistante du show (scènes fantômes non classées + chasers orphelins jouables), **pas de crash** ; la garantie d'idempotence de `refreshAutoLoops` est rompue.

**Pré-existant** : la toolbar permettait déjà `deleteFolder('auto-loops')` quand le filtre était posé dessus. Le patch rend la suppression trivialement découvrable (un clic sur le trash du chip).

**Verdict : non bloquant, mais À DOCUMENTER** — recommandations :
1. **Documentation** : créer `.openclaw/notes/scene-folders.md` (à côté de multi-pan-tilt.md) mentionnant que le dossier `auto-loops` est un marqueur interne de régénération : ne pas le supprimer, sinon le purge ne retrouve plus les scènes (résidus + doublons).
2. **Protection recommandée (résolution future, hors scope du patch)** : ne pas afficher le bouton trash pour `fo.name === AUTO_LOOP_FOLDER` dans le chip (et idéalement dans la toolbar), ou le désactiver avec tooltip explicatif.

## F. Régressions visuelles — VERDICT : OK (2 notes mineures)

- Hauteur : `py-0.5` sur les deux boutons enfants + `text-[10px]` sur le div → hauteur identique à l'ancien button. `items-center` → alignement vertical centré. ✓
- Largeur : le trash ajoute ~18px par chip (icône 10px + `px-1`×2). `gap-1` du flex-wrap inchangé. Léger élargissement, sans impact.
- Hover : le texte « 📁 nom » hérite de `hover:text-purple-300` du div (pas de couleur propre sur le bouton filtre) ✓ ; le trash passe `text-gray-500 → hover:text-red-400` ✓.
- **Note 1 (tactile)** : `opacity-60` sur le trash — sans hover (écran tactile), il reste à 60 % d'opacité en `text-gray-500` sur `bg-gray-800/50` : discret mais perceptible. Découvrabilité moyenne sur tactile, acceptable pour un bouton destructif.
- **Note 2** : en surbrillance dragOver (`bg-purple-600/30`), le trash conserve sa couleur `text-gray-500` (le `text-purple-200` du div n'est pas hérité car couleur explicite) → lisibilité moyenne pendant le drag, sans conséquence fonctionnelle.

## G. TSC + cohérence TypeScript — VERDICT : OK

- `Trash2` importé ligne 5 (déjà utilisé ailleurs dans le fichier). ✓
- `confirmDeleteFolder` : `useState<string | null>` (L314) ; `setConfirmDeleteFolder(fo.name)` avec `fo.name: string` (dérivé de `collectFolderNames`) ✓ ; comparaison `confirmDeleteFolder === activeFolderName` cohérente (tous deux `string | null`). ✓
- `setSceneFilter(fo.value)` : `useState('')` → string ; `fo.value = 'folder:' + name` ✓.
- `npx tsc --noEmit -p tsconfig.json` → **exit 0, aucune erreur**. ✓
- Clés i18n `deleteFolder`, `confirmDeleteFolder`, `dropSceneHint` présentes dans `src/i18n/en.json` et `fr.json`. ✓

---

## VERDICT GLOBAL : APPROUVÉ

Le patch est fonctionnellement correct : aucun handler perdu (A), HTML valide sans boutons imbriqués (B), drag & drop intact y compris au-dessus du trash (C), flux de confirmation complet et cohérent y compris suppression du dossier filtré (D), zéro erreur TypeScript (E-non, G).

**Corrections / recommandations (non bloquantes, hors scope du patch) :**
1. **Documenter le dossier `auto-loops`** (point E) : créer `.openclaw/notes/scene-folders.md` — le dossier `auto-loops` est un marqueur interne de régénération ; le supprimer casse `purgeAutoLoops` (résidus + doublons). Protection recommandée : masquer/désactiver le trash pour `fo.name === AUTO_LOOP_FOLDER` (chip + toolbar).
2. **UX (note)** : le clic trash sur un chip d'un autre dossier que le filtre courant bascule le filtre ; en cas d'annulation, l'ancien filtre est perdu. Comportement assumé, mais à valider avec l'utilisateur si un retour en arrière du filtre est souhaité.
3. **Tactile (note)** : `opacity-60` permanent sans hover — si la cible principale est un écran tactile, passer à `opacity-70/80` ou garder la couleur pleine pour la découvrabilité.
