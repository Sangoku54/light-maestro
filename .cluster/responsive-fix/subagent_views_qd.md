# Audit responsive — QuickShowView.tsx & DesignView.tsx

Contexte : fenêtre Electron minWidth 1024, maximisée au lancement. Vues rendues dans `<main class="flex-1 overflow-hidden">` (pas de scroll sur le main). Tout ce qui déborde est donc **clippé**, pas scrollable, sauf si un enfant porte son propre `overflow-auto`.

---

## QuickShowView.tsx (4432 lignes)

### Vue d'ensemble
La vue est **déjà globalement responsive**. Structure saine :
- Racine (l.2957) : `flex-1 flex flex-col h-full overflow-hidden`
- Toolbars (l.2959, l.3237) : `flex-wrap` → les contrôles se replient. OK.
- Zone TrackTimeline (l.3284) : `flex-1 px-3 py-2 overflow-auto` → scroll 2 axes interne. OK.
- Aucune hauteur fixe coupante (`min-h` absent, seul `min-h-0` l.3721). OK.

### Problèmes restants (mineurs)

**Q1 — Modales à largeur fixe sans `max-w-[95vw]`**
Symptôme : à moins de ~460px de largeur utile, les modales débordent de l'écran et leur bord droit est inaccessible.
- `QuickShowView.tsx:3746` — `w-[420px] max-h-[80vh] overflow-auto` (New EFX Track)
- `QuickShowView.tsx:4080` — `w-[420px] max-h-[80vh] overflow-auto` (New Color Track)
- `QuickShowView.tsx:4179` — `w-[420px] max-h-[80vh] overflow-auto` (New Strobe Track)
- `QuickShowView.tsx:4278` — `w-[420px] max-h-[80vh] overflow-auto` (New Dimmer Track)
- `QuickShowView.tsx:4377` — `w-[420px] max-h-[80vh] overflow-auto` (New Chaser Track)

Correctif minimal : ajouter `max-w-[95vw]` à chacune, comme c'est déjà le cas l.3527 (`w-[420px] max-w-[95vw]`).

**Q2 — Modale couleur (l.43)** : `w-[320px] p-4` — correcte à 1024px, RAS.

---

## DesignView.tsx (7329 lignes)

### Vue d'ensemble
Structure : racine `h-full flex flex-col` (l.78) → barre de sous-onglets (l.80) → zone éditeur `flex-1 flex overflow-hidden` (l.101) → sidebar `w-64` (l.113) + panneau éditeur `flex-1 overflow-y-auto p-4` (l.144).

### Problèmes critiques

**D1 — Barre de sous-onglets qui déborde horizontalement**
`DesignView.tsx:80` — `<div className="px-4 pt-3 pb-0 flex items-center gap-1 border-b border-gray-800/50">`
10 onglets alignés sans `flex-wrap` ni `overflow-x-auto`. Sous ~1100px de fenêtre, les onglets (settings, rgbmatrix, cuelists…) sortent du bord droit et sont **cliqués ni visibles** (parent `overflow-hidden`).
Correctif minimal : ajouter `overflow-x-auto` + `shrink-0` sur les boutons, ou `flex-wrap`. Recommandé :
`className="px-4 pt-3 pb-0 flex items-center gap-1 border-b border-gray-800/50 overflow-x-auto"` et sur chaque `<button>` ajouter `shrink-0`.

**D2 — Panneau éditeur sans `min-w-0` → contenu large clippé**
`DesignView.tsx:144` — `<div className="flex-1 overflow-y-auto p-4">`
En flex, `min-width:auto` empêche l'item de rétrécir sous la largeur intrinsèque de son contenu. Le contenu le plus large (DMX Address Map ≈ 984px, cf. D3) force le panneau à ≥ 984px ; avec la sidebar 256px, la ligne déborde et le parent `overflow-hidden` (l.101) **clippe** la partie droite sans scroll horizontal (le panneau n'a que `overflow-y-auto`).
Correctif minimal : ajouter `min-w-0` → `className="flex-1 min-w-0 overflow-y-auto p-4"`.

**D3 — DMX Address Map : grille à largeur fixe qui déborde**
Constantes `DesignView.tsx:4769-4772` : `CELL_SIZE=28`, `CELL_GAP=2`, `CHANNELS_PER_ROW=32`.
Largeur d'une ligne = 32×28 + 31×2 = 958px + gutter 24px ≈ **984px**.
Conteneur `DesignView.tsx:4887` : `<div className="p-3 flex justify-center">` → centrage sans `overflow-x-auto`. Grille `inline-flex flex-col` (l.4896). À 1024px de fenêtre, le panneau éditeur ne fait que ~736px (1024 − sidebar 256 − padding 32) : la grille déborde de ~250px, **clippée des deux côtés** (centrée), cellules inaccessibles au drag.
Correctif minimal : rendre le conteneur scrollable horizontalement :
`DesignView.tsx:4887` → `<div className="p-3 overflow-x-auto">` + garder un wrapper centré, ou `flex justify-center` remplacé par `overflow-x-auto` avec la grille en `mx-auto`. Option complémentaire : passer `CHANNELS_PER_ROW` en responsive (`32` → `16` sous `lg`) pour réduire la largeur à ~492px.

**D4 — Éditeur de scène : `min-h-[540px]` qui coupe le contenu à 768px**
`DesignView.tsx:1109` — `<div className="flex gap-4 h-full min-h-[540px]">`
`DesignView.tsx:1226` — panneau 3D `<div className="w-[46%] shrink-0 ... min-h-[540px] h-full">`
Le `min-h-[540px]` impose une hauteur minimale ; à 768px de fenêtre (barre d'onglets + padding + bordure consomment ~100px), le contenu excède la zone disponible et est **coupé en bas** (parent `overflow-hidden`, pas de scroll vertical sur ce bloc).
Correctif minimal : remplacer `min-h-[540px]` par `min-h-0` sur les deux lignes, et s'assurer que la colonne gauche scroll : `flex-1 min-w-0 space-y-5` (l.1110) → `flex-1 min-w-0 space-y-5 overflow-y-auto`.

**D5 — Panneau 3D `w-[46%] shrink-0` qui écrase l'éditeur**
`DesignView.tsx:1226` — `w-[46%] shrink-0` combiné à `flex gap-4` sans wrap : à largeur réduite, le panneau 3D garde 46% et `shrink-0` empêche la compression, écrasant la colonne gauche (`flex-1 min-w-0`) vers ~zéro.
Correctif minimal : `w-[46%] shrink-0` → `w-[46%] min-w-[280px]` et ajouter `flex-wrap` sur l.1109 pour que le 3D passe en dessous sur les très petites largeurs, OU supprimer `shrink-0` + garder `min-w-0` sur la gauche. Le plus sûr : l.1109 `flex gap-4 h-full min-h-0 flex-wrap`.

**D6 — Modales à largeur fixe sans `max-w-[95vw]`**
- `DesignView.tsx:4692` — Fixture Detail : `w-[560px] max-h-[85vh] flex flex-col`
- `DesignView.tsx:5144` — Add Fixture : `w-[480px] max-h-[80vh] flex flex-col`
- `DesignView.tsx:6912` — Fixture Editor : `w-[680px] max-h-[90vh] flex flex-col`
La 680px représente 66% de 1024px ; elle tient, mais sans garde-fou, toute fenêtre plus étroite (ou scaling UI) la fait déborder.
Correctif minimal : ajouter `max-w-[95vw]` (ou `max-w-[92vw]`) à chacune.

### Éléments déjà corrects (à ne pas toucher)
- Sidebar `w-64` (l.113) : fixe mais acceptable à 1024px (256px). Si besoin de gagner de la place : `w-56 xl:w-64`.
- Tableau « Patched Fixtures » : `overflow-x-auto` (l.4433). OK.
- Timeline chaser : `flex gap-2 overflow-x-auto` + cartes `shrink-0` width 180 (l.2311). OK.
- Listes latérales : `truncate` + `min-w-0` présents (l.731, l.1300, l.1714…). OK.
- Petites modales `w-80` (320px) l.837/1756/2836/3084/3930 : OK.

---

## Synthèse des correctifs par ordre d'impact

| # | Fichier:ligne | Symptôme | Correctif minimal |
|---|---|---|---|
| D1 | DesignView.tsx:80 | 10 onglets débordent sous ~1100px | `overflow-x-auto` + `shrink-0` sur boutons |
| D3 | DesignView.tsx:4887 | Grille DMX 984px clippée | `p-3 overflow-x-auto` (+ grille `mx-auto`) |
| D2 | DesignView.tsx:144 | Panneau éditeur ne rétrécit pas | ajouter `min-w-0` |
| D4 | DesignView.tsx:1109 & 1226 | Contenu coupé à 768px | `min-h-[540px]` → `min-h-0` (+ `overflow-y-auto` gauche) |
| D5 | DesignView.tsx:1226 | 3D `shrink-0` écrase l'éditeur | `min-w-[280px]` + `flex-wrap` sur 1109 |
| D6 | DesignView.tsx:4692/5144/6912 | Modales larges sans garde-fou | ajouter `max-w-[95vw]` |
| Q1 | QuickShowView.tsx:3746/4080/4179/4278/4377 | Modales 420px sans garde-fou | ajouter `max-w-[95vw]` |
