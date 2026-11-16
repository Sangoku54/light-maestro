# Audit responsive — Vue 3D (Stage3D) & Timeline (TrackTimeline)

Date : 2026-08-19 — Analyste 3D/timeline
Fichiers analysés :
- `src/views/Stage3D.tsx` (2541 lignes)
- `src/views/TrackTimeline.tsx` (3814 lignes)
- Contexte d'usage (parents) : `PerformanceView.tsx`, `QuickShowView.tsx`, `DesignView.tsx`

---

## Verdict global (résumé exécutif)

**Le canvas 3D (Three.js) SUIT le redimensionnement.** Le resize est géré
(`window resize` + `ResizeObserver`, `renderer.setSize` + `camera.updateProjectionMatrix`).
Il reste un bug de *stale closure* mineur (voir §1.3).

**Le vrai bug de responsive est la timeline (TrackTimeline) :** son canvas 2D est
dessiné une seule fois et **ne se redessine jamais au redimensionnement** de la
fenêtre/du panneau. Pas de `ResizeObserver`, pas de listener `window resize`, et la
largeur n'est pas dans les dépendances de l'effet de dessin. C'est LE bug classique
« canvas figé », mais du côté timeline, pas 3D.

---

## 1. Stage3D — dimensionnement du canvas 3D

### 1.1 Initialisation (au mount)
- `Stage3D.tsx:739-740` — lit la taille du conteneur :
  ```ts
  const W = container.clientWidth;
  const H = container.clientHeight;
  ```
- `Stage3D.tsx:748` — `renderer.setSize(W, H);`
- `Stage3D.tsx:749` — `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));`
- `Stage3D.tsx:750` — `container.appendChild(renderer.domElement);`
- `Stage3D.tsx:766` — caméra `new THREE.PerspectiveCamera(50, W / H, ...)`.

### 1.2 Gestion du redimensionnement (PRÉSENTE et correcte)
- **Listener `window.resize`** — `Stage3D.tsx:1057-1072` :
  ```ts
  const handleResize = () => { ... W = container.clientWidth; H = ...;
    camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); };
  window.addEventListener('resize', handleResize);
  ```
  Ici `camera`/`renderer` sont relus frais via les refs → correct.
- **`ResizeObserver` sur le conteneur** — `Stage3D.tsx:1074-1090` :
  ```ts
  const ro = new ResizeObserver(() => {
    ... camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H); });
  ro.observe(container);
  ```
  → couvre aussi le redimensionnement de *panneaux* (fenêtre flottante 3D,
  split panes) sans resize de la fenêtre globale.

**Conclusion :** le canvas 3D recalcule bien `setSize` + `aspect` + `updateProjectionMatrix`.
Le « bug classique » (renderer figé) n'est PAS présent côté 3D.

### 1.3 Bug résiduel (mineur) — stale closure du ResizeObserver
- L'effet `ResizeObserver` (`Stage3D.tsx:1074-1090`) capture `camera` et `renderer`
  par **fermeture** au moment du montage (`const camera = cameraRef.current;`
  ligne 1076, `const renderer = rendererRef.current;` ligne 1077) avec `[]` en deps.
- Or l'effet d'init de la scène se rebuild avec `[stageDims]` (`Stage3D.tsx:1053`),
  ce qui **recrée un nouveau renderer/camera** (et `dispose()` l'ancien, ligne 1045-1052).
- Après un changement de `stageDims` (dimensions de scène en mètres), le
  `ResizeObserver` continue d'appeler `setSize` sur l'**ancien renderer disposé**
  et `updateProjectionMatrix` sur l'ancienne caméra → plus d'effet visuel.
- Le listener `window resize` (ligne 1057-1072), lui, relit les refs fraîches, donc
  il « auto-répare » le problème à chaque resize de fenêtre. Seul un resize
  *uniquement* du conteneur (panneau) après un changement de stageDims est affecté.

**Correctif minimal :** lire les refs fraîches *dans* le callback du ResizeObserver
(comme le fait déjà `handleResize`) :
```ts
const ro = new ResizeObserver(() => {
  const container = containerRef.current;
  const camera = cameraRef.current;
  const renderer = rendererRef.current;
  if (!container || !camera || !renderer) return;
  ...
});
```

### 1.4 Conteneur du canvas
- Racine : `Stage3D.tsx:1948` — `<div className="h-full flex flex-col bg-[#08080e]">`
- Conteneur canvas : `Stage3D.tsx:2132-2134` —
  `<div ref={containerRef} className="flex-1 relative cursor-grab ...">`
- **Pas de largeur/hauteur en dur**, pas de `overflow-hidden` sur ce div (le canvas
  est en inline-px via `setSize`, donc il suit). La hauteur repose sur `h-full` →
  dépend de la chaîne parente.
- Parents vérifiés :
  - `PerformanceView.tsx:768` `<div className="flex-1 min-h-0 relative">` → OK (`min-h-0` présent).
  - `QuickShowView.tsx:3721` `<div className="flex-1 min-h-0 relative">` → OK.
  - `DesignView.tsx:1226` `<div className="w-[46%] shrink-0 ... min-h-[540px] h-full">` → largeur en % (responsive), hauteur bornée. OK.
- Aucun `overflow-hidden` manquant ne clippe le canvas 3D (le canvas est dimensionné
  exactement à `clientWidth/Height` du conteneur).

### 1.5 Usage de `window.innerWidth/innerHeight`
- `Stage3D.tsx:2046-2047` — uniquement pour **clamp la position du menu popup**
  « Musiciens » (pas de figeage de layout). Sans impact responsive structurel.

---

## 2. TrackTimeline — canvas 2D (LE vrai bug)

### 2.1 Dimensionnement du canvas (une seule fois)
- Effet de dessin : `TrackTimeline.tsx:1838-1851` :
  ```ts
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  const w = rect.width;
  const h = totalHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ```
- Le CSS `className="w-full h-full"` (`TrackTimeline.tsx:3184`) est **écrasé** par le
  style inline en px → le canvas ne se redimensionne pas par CSS.

### 2.2 Aucun mécanisme de redimensionnement
- **Pas de `ResizeObserver`** dans tout le fichier (vérifié).
- **Pas de listener `window resize`** dans tout le fichier (vérifié ; les seuls
  `resize` sont du drag-resize d'entrées de bloc, ex. `sectionResizeRef` ligne 701+).
- L'effet de dessin a une liste de dépendances (`TrackTimeline.tsx:3068-3089`) qui
  **ne contient pas la largeur du conteneur** (`cues, sections, duration, currentTime,
  patchedFixtures, tieredLayout, bpm, totalHeight, ...`).

**Conséquence (symptôme) :** au redimensionnement de la fenêtre/du panneau :
- Le canvas conserve ses anciennes dimensions en pixels.
- Rétrécissement → la partie droite (blocs, grille, ruler temps) est **tronquée/clippée**.
- Agrandissement → **bande vide** à droite, la grille ne s'étend pas.
- Le playhead (RAF) relit `rect.width` à chaque frame (`TrackTimeline.tsx:3118`), donc
  il se place selon la nouvelle largeur **sur un canvas figé** → désalignement
  playhead / contenu.

### 2.3 Largeur des pistes / colonnes de temps / scroll
- **Pas de `w-[NNNpx]` fixes pour les colonnes de temps** : l'axe temporel est
  proportionnel à la largeur disponible :
  `const drawW = (w - LABEL_WIDTH) * zoomLevel;` (`TrackTimeline.tsx:1857`).
  La durée totale est « compressée » dans la largeur → pas besoin de scroll horizontal
  pour le temps (choix de design différent d'une DAW classique).
- `LABEL_WIDTH = 90` (`TrackTimeline.tsx:279`) : gouttière de labels **fixe en px** —
  acceptable (colonne de noms), mais c'est la seule valeur « en dur » du layout horizontal.
- **Hauteurs de pistes fixes en px** : `TRACK_HEIGHT=30`, `HEADER_HEIGHT=32`, etc.
  (`TrackTimeline.tsx:270-279`) + `totalHeight` calculé (`TrackTimeline.tsx:595`).
  La hauteur totale est figée en px et posée sur le conteneur :
  `style={{ height: totalHeight px }}` (`TrackTimeline.tsx:3176`).
- **Scroll** : le conteneur timeline (`TrackTimeline.tsx:3175`) n'a **pas** de
  `overflow-x-auto` ni `overflow-y-auto` ; le scroll est délégué au parent
  `QuickShowView.tsx:3284` `<div className="flex-1 px-3 py-2 overflow-auto">`.
  → OK pour le scroll vertical, mais le canvas étant à `w-full` de la largeur visible,
  il n'y a **jamais** d'overflow horizontal à scroller (le zoom compresse tout).
- **Header aligné ?** Le header (ruler temps) est **dessiné dans le même canvas**
  (`TrackTimeline.tsx:1900-1950`, dessiné ligne 1931-1945), donc il reste aligné avec
  le contenu tant que le canvas n'est pas redimensionné. Le problème d'alignement ne
  vient pas du scroll mais du non-redessin au resize (le header et le contenu restent
  *entre eux* alignés, mais *ensemble* figés à l'ancienne largeur).

### 2.4 Constantes de taille / innerWidth
- `TrackTimeline.tsx:1122` et `1197` : `const duration = duration || 120000;` — simple
  fallback quand la durée est nulle (pas une taille de layout).
- Aucun `window.innerWidth/innerHeight`, aucun `1200/1920/1024` figeant le layout.

---

## 3. Liste priorisée des correctifs

1. **[P0 — bug principal] TrackTimeline : redessiner au resize.**
   Ajouter un `ResizeObserver` (ou listener `window resize`) qui, sur changement de
   largeur du conteneur, re-déclenche le redraw du canvas. Correctif minimal :
   - soit ajouter la largeur du conteneur aux deps de l'effet de dessin et maintenir
     un state `containerWidth` mis à jour par `ResizeObserver` ;
   - soit extraire la logique de dessin dans une fonction `draw()` appelée depuis un
     `ResizeObserver` qui ré-applique `canvas.width/style.width` puis redessine.
   Fichier : `TrackTimeline.tsx:1838-1851` (sizing) + `3068-3089` (deps) + ajout d'un
   effet `ResizeObserver` autour du `containerRef` (ligne 3176).

2. **[P0 — robustesse] TrackTimeline : gérer le `devicePixelRatio` au resize.**
   `canvas.width = w*dpr` est calculé au draw initial uniquement ; au resize il faut
   recalculer avec le dpr courant (déjà fait au draw initial, à conserver dans le
   redraw). Idem re-scale du ctx `ctx.scale(dpr, dpr)`.

3. **[P1 — Stage3D] Corriger la stale closure du ResizeObserver.**
   Relire `containerRef.current` / `cameraRef.current` / `rendererRef.current` **dans**
   le callback (comme `handleResize`), au lieu de capturer au mount.
   Fichier : `Stage3D.tsx:1074-1090`.

4. **[P2 — cohérence] Stage3D : envisager de fusionner les deux effets resize**
   (window + ResizeObserver) en un seul, avec un handler unique relisant les refs
   fraîches, pour éviter la duplication et le risque de divergence.

5. **[P2 — non bloquant] TrackTimeline : gouttière label.**
   `LABEL_WIDTH=90` fixe est acceptable ; si besoin, la passer en `clamp()` pour les
   très petites largeurs. Pas urgent.

---

## Note de synthèse pour l'équipe

- **3D : déjà responsive.** Ne pas réécrire le resize 3D — juste corriger la stale
  closure (§1.3).
- **Timeline : c'est là qu'est le bug.** Le canvas 2D est statique ; tout le travail
  consiste à ajouter un redraw piloté par `ResizeObserver` sur `containerRef`.
- Aucun layout en dur type `1200/1920/1024` n'a été trouvé dans ces deux fichiers ;
  les seules valeurs fixes sont les hauteurs de pistes (px, vertical, légitimes) et la
  gouttière `LABEL_WIDTH`.
