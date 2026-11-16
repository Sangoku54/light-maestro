# Audit coquille — Responsive (Light Maestro)

Fenêtre cible : minWidth 1024, minHeight 700, maximisée, titleBarOverlay (h 48, ~150px overlay à droite).
Le shell est pensé pour ≥1024px ; les défauts se jouent surtout entre 1024 et ~1440px.

---

## 1. TopBar

### 1.1 Header : `pr-[150px]` fixe + aucun `min-w-0`
- **Fichier** : `src/components/layout/TopBar.tsx:44`
- **Code** : `<header class="... pl-3 pr-[150px] gap-2 ... relative">`
- **Symptôme** : 150px réservés en dur à droite pour les contrôles overlay. Avec un titleBarOverlay Windows standard les boutons occupent ~138px ; 150 est une marge OK, mais cette réserve **rétrécit d'autant** la zone utile des chips/boutons. Surtout : le header et ses enfants n'ont ni `min-w-0` ni `overflow-hidden`, donc rien ne force le cluster gauche à se replier.
- **Correctif minimal** : réduire la réserve si l'overlay le permet (`pr-[138px]`), et ajouter `min-w-0` sur le header.

### 1.2 Chips Projet / Preset / Audio : `max-w` en pixels figés
- **Fichier** : `src/components/layout/TopBar.tsx:58` (`max-w-[180px]`), `:67` (`max-w-[160px]`), `:76` (`max-w-[200px]`)
- **Symptôme** : `truncate max-w-[NNNpx]` = largeur **plancher** en pixels. À 1024px : logo ~130px + chip Projet 180px + chip Preset 160px ≈ 470px à gauche, qui déborde sous le nav centré (voir 1.3). Les chips ne se contractent jamais en dessous de leur `max-w`.
- **Correctif minimal** : passer le `max-w` en unité fluide, ex. `max-w-[180px]` → `max-w-[26vw] md:max-w-[180px]`, et ajouter `min-w-0 overflow-hidden` au conteneur `div.flex.items-center.gap-2.no-drag` (ligne 52).

### 1.3 Nav sélecteur de mode en `absolute left-1/2` → chevauchement
- **Fichier** : `src/components/layout/TopBar.tsx:83`
- **Code** : `<nav class="absolute left-1/2 -translate-x-1/2 flex items-center ...">`
- **Symptôme** : le nav est **hors flux** et centré ; il chevauche tout contenu qui s'étend vers le centre (chips à gauche, boutons à droite). En dessous de ~1400px, les labels (affichés dès `sm`, ligne 97) + kbd (dès `lg`, ligne 98) élargissent le nav (~250px) et il recouvre visuellement les chips/boutons.
- **Correctif minimal** (sans refonte du positionnement) : monter les seuils d'affichage pour réduire l'emprise du nav :
  - ligne 97 : `hidden sm:inline` → `hidden md:inline` (labels mode)
  - ligne 98 : `hidden lg:inline` → `hidden xl:inline` (kbd raccourcis)
  → sous `md` le nav ne fait plus que 3 icônes (~100px), ce qui supprime la majorité des collisions.

### 1.4 Cluster de droite (Nouveau/Ouvrir/Enregistrer/langue/update/badge/blackout)
- **Fichier** : `src/components/layout/TopBar.tsx:114,123,132,185` (labels `hidden sm:inline`), `:265` (badge `hidden md:inline`)
- **Symptôme** : après le spacer `flex-1` (ligne 105), ce cluster ~5 boutons avec libellés occupe ~420px + les 150px de réserve ≈ 570px à droite. À 1024px, combiné au cluster gauche, le centre est saturé et le nav centré chevauche des deux côtés.
- **Correctif minimal** : `hidden sm:inline` → `hidden lg:inline` sur les libellés Nouveau/Ouvrir/Enregistrer/blackout (les icônes restent, avec `title` déjà présent en tooltip). Libère ~200px sous `lg`.

---

## 2. Coquille principale

### 2.1 `<main>` : correct en pratique, mais non explicite
- **Fichier** : `src/App.tsx:412` — `<main class="flex-1 overflow-hidden">`
- **Analyse** : `overflow-hidden` sur un item flex annule la taille minimale automatique (`min-width:auto` → 0). `<main>` ne fait donc **pas** déborder la rangée `flex-1 flex overflow-hidden` (ligne 407). C'est le point le plus sain de la coquille.
- **Recommandation** : ajouter `min-w-0` explicite sur `<main>` pour documenter l'intention et résister à tout futur changement (ex. retrait d'`overflow-hidden`).

### 2.2 Wrappers de vues : pas de `min-w-0` ni `overflow-hidden`
- **Fichier** : `src/App.tsx:414,417,420` — `<div class="h-full flex-col">` (×3, `display` contrôlé en inline style)
- **Symptôme** : ces divs sont enfants block de `<main>` (qui n'est **pas** `display:flex`). Leur contenu large (grids DMX, stage 3D, etc.) sera **clippé** par l'`overflow-hidden` de `<main>` au lieu de défiler ou se replier → impression de "non responsive", contenu coupé à droite.
- **Correctif minimal** : ajouter `min-w-0 overflow-hidden` aux 3 wrappers, et s'assurer que chaque vue interne possède son propre conteneur `overflow-auto`.

### 2.3 Sidebar : correcte
- **Fichier** : `src/components/layout/sidebar.tsx:32` (`w-12 ... shrink-0`, replié) et `:41` (`w-56 ... shrink-0 overflow-hidden`, déplié)
- **Analyse** : `shrink-0` empêche l'écrasement ; nav interne `overflow-y-auto` (ligne 42) assure le scroll vertical. Rien à corriger côté largeur.

---

## 3. StatusBar (footer h-7)

- **Fichier** : `src/App.tsx:527` — `<footer class="h-7 ... flex items-center px-4 text-xs gap-4 select-none">`
- **Symptôme** : le cluster gauche (`div.flex.items-center.gap-1.5`, ligne 528) contient dot + "DMX ON 44 fps" + "Latence audio→DMX : 123 ms" (span lignes 546-565). Aucun `min-w-0`, `truncate` ni `whitespace-nowrap`. À 1024px, avec la version à droite et l'espaceur `flex-1` (ligne 574), le texte de latence (~28 chars) force le cluster à sa taille intrinsèque → débordement horizontal / coupure.
- **Correctif minimal** :
  - ligne 528 : ajouter `min-w-0 overflow-hidden whitespace-nowrap` au cluster gauche
  - ligne 558 (span latence) : ajouter `truncate`
  - ligne 527 : `gap-4` → `gap-2 sm:gap-4`
  - Option : masquer le préfixe "Latence audio→DMX :" sous `md` (icône + title suffisent).

---

## 4. global.css

- **Fichier** : `src/styles/global.css:13-19` — `html, body, #root { height:100%; ... overflow: hidden; }`
- **Analyse** : `overflow:hidden` sur html/body/#root **fige tout scroll documentaire**. Cohérent pour un shell applicatif, mais conséquence directe : **chaque** zone scrollable doit gérer son propre `overflow-y-auto` ; sinon le contenu est coupé sans possibilité de scroll. C'est l'une des causes racines de l'impression "ne s'adapte pas" dès qu'une vue dépasse la hauteur.
- **Correctif minimal** : ne pas supprimer (le shell en dépend), mais vérifier que toutes les vues ont un conteneur scrollable interne. Optionnel : remplacer par `overflow: clip` sur `html/body` pour éviter tout scroll fantôme.
- **Fichier** : `src/styles/global.css:25-36` — `::-webkit-scrollbar { width:6px; height:6px; }` : fin, OK (s'applique aussi aux scrollbars horizontales).
- **Note** : `.drag-region`/`.no-drag` OK ; `[title] { position: relative; }` (fin de fichier) crée des contextes de positionnement parasites mais sans impact responsive.

---

## À corriger (liste priorisée)

1. **TopBar nav centré qui chevauche** (critique, visible dès ~1200px)
   - `TopBar.tsx:97` → `hidden sm:inline` ⇒ `hidden md:inline`
   - `TopBar.tsx:98` → `hidden lg:inline` ⇒ `hidden xl:inline`
2. **TopBar chips en pixels figés** (critique, 1024px)
   - `TopBar.tsx:58` → `max-w-[180px]` ⇒ `max-w-[26vw] md:max-w-[180px]`
   - `TopBar.tsx:67` → `max-w-[160px]` ⇒ `max-w-[22vw] md:max-w-[160px]`
   - `TopBar.tsx:76` → `max-w-[200px]` ⇒ `max-w-[28vw] md:max-w-[200px]`
   - `TopBar.tsx:52` → ajouter `min-w-0 overflow-hidden`
3. **TopBar cluster droit trop large** (important, <1100px)
   - `TopBar.tsx:114,123,132,185` → `hidden sm:inline` ⇒ `hidden lg:inline`
4. **Wrappers de vues sans garde-fou** (robustesse)
   - `App.tsx:412` → `<main>` : ajouter `min-w-0`
   - `App.tsx:414,417,420` → `h-full flex-col` ⇒ `h-full flex-col min-w-0 overflow-hidden`
5. **StatusBar débordement horizontal** (important, 1024px)
   - `App.tsx:528` → ajouter `min-w-0 overflow-hidden whitespace-nowrap`
   - `App.tsx:558` (span latence) → ajouter `truncate`
   - `App.tsx:527` → `gap-4` ⇒ `gap-2 sm:gap-4`
6. **Réserve overlay** (mineur, seulement si titleBarOverlay le permet)
   - `TopBar.tsx:44` → `pr-[150px]` ⇒ `pr-[138px]`
