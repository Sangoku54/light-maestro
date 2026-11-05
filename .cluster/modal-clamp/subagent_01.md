# Cartographie des fenêtres contextuelles — subagent_01

**Mission** : inventaire exhaustif (lecture seule) des popovers/menus contextuels/modales positionnés pouvant sortir de la fenêtre.
**État du code** : ⚠️ repo en cours de patchage parallèle au moment du scan (le composant `src/components/clampedpopup.tsx` + ses tests ont été créés PENDANT le scan ; QuickShowView est migré à ~60 %). Les numéros de ligne ci-dessous sont ceux de la dernière passe de vérification.

---

## Constat préalable

Un correctif existe déjà mais n'est appliqué que partiellement :

- `src/components/clampedpopup.tsx` — composant `ClampedPopup` + util `clampRect(x, y, w, h, vw, vh, margin=8)` (position après montage via `useLayoutEffect`, bornée à `[8, viewport − taille − 8]`). **Il n'est utilisé nulle part en tant que composant** (aucun import de `ClampedPopup` dans l'app ; seuls `clampRect` est importé).
- `src/__tests__/clamp-rect.test.ts` — tests unitaires de `clampRect` (OK).
- `clampRect` importé dans 3 fichiers : `useAudioFileLoader.tsx`, `DesignView.tsx`, `QuickShowView.tsx`.
- **Pas importé** dans : `PerformanceView.tsx`, `ShowManager.tsx`, `TrackTimeline.tsx`, `Stage3D.tsx`.

---

## A. Menus contextuels avec coordonnées BRUTES (aucun clamp) — 7 ⚠️ CRITIQUES

| Fichier | Ligne | Composant / state | Coordonnées actuelles | Risque | Correction |
|---|---|---|---|---|---|
| `src/views/QuickShowView.tsx` | 4063 | strobeEntryMenu (`min-w-160`) | `left: strobeEntryMenu.x, top: strobeEntryMenu.y` | droite + bas | `style={{ ...clampRect(strobeEntryMenu.x, strobeEntryMenu.y, 200, 240, innerWidth, innerHeight) }}` |
| `src/views/QuickShowView.tsx` | 4098 | dimmerInsertMenu (`min-w-180`) | `left: dimmerInsertMenu.x, top: dimmerInsertMenu.y` | droite + bas | `clampRect(..., 220, 240, ...)` |
| `src/views/QuickShowView.tsx` | 4128 | dimmerEntryMenu (`min-w-160`) | `left: dimmerEntryMenu.x, top: dimmerEntryMenu.y` | droite + bas | `clampRect(..., 200, 240, ...)` |
| `src/views/QuickShowView.tsx` | 4162 | chaserInsertMenu (`min-w-200`, `max-h-320`) | `left: chaserInsertMenu.x, top: chaserInsertMenu.y` | droite + bas | `clampRect(..., 240, 340, ...)` |
| `src/views/QuickShowView.tsx` | 4198 | chaserEntryMenu (`min-w-160`) | `left: chaserEntryMenu.x, top: chaserEntryMenu.y` | droite + bas | `clampRect(..., 200, 240, ...)` |
| `src/views/TrackTimeline.tsx` | 3207 | ftMenu — Fixture Track ctx (clic sur sélection, `min-w-180`) | `left: ftMenu.x, top: ftMenu.y` | droite + bas | `clampRect(ftMenu.x, ftMenu.y, 220, 240, ...)` + import |
| `src/views/TrackTimeline.tsx` | 3677 | blockMenu — Block ctx (color/dimmer/strobe/movement, `min-w-160`) | `left: blockMenu.x, top: blockMenu.y` | droite + bas | `clampRect(blockMenu.x, blockMenu.y, 200, 160, ...)` + import |

Déclencheurs (setState bruts `e.clientX/e.clientY`) : QuickShowView 2759 (scmPos track), 2763 (strobeEntryMenu), 2822 (dimmerInsertMenu), 2830 (dimmerEntryMenu), 2914 (chaserInsertMenu), 2922 (chaserEntryMenu) ; TrackTimeline 1332 (ftMenu), 1215/1222/1229/1236 (blockMenu).

---

## B. Clamp MANUEL approximatif (Math.min, taille hardcodée, marge 0) — 4 ⚠️

Défaut commun : marge 0, dimensions approximatives → si le menu grandit (i18n, contenu dynamique), il déborde quand même ; pas de bornage côté gauche/haut.

| Fichier | Ligne | Composant | Coordonnées actuelles | Risque | Correction |
|---|---|---|---|---|---|
| `src/views/PerformanceView.tsx` | 834 | ContextMenuPopup (widget VC, `min-w-140`) | `left: Math.min(x, innerWidth - 160), top: Math.min(y, innerHeight - 180)` | bas (menu ~200 px réel > 180) ; droite OK si ≥160 | `clampRect(x, y, 180, 220, ...)` + import |
| `src/views/ShowManager.tsx` | 1266 | contextMenu item (`min-w-160`) | `left: Math.min(x, innerWidth - 180), top: Math.min(y, innerHeight - 180)` | bas (3 boutons ≈ 150 px, OK mais marge 0) | `clampRect(..., 180, 180, ...)` |
| `src/views/ShowManager.tsx` | 1309-1310 | Add Item Popover (depuis `addItemBtnRect`, `max-h-300`) | `left: Math.min(rect.left, innerWidth - 200), top: Math.min(rect.bottom + 4, innerHeight - 320)` | bas si liste longue (> 300 px) ; marge 0 | `clampRect(rect.left, rect.bottom + 4, 200, 340, ...)` |
| `src/views/DesignView.tsx` | 719-720 | set de ctxMenu scènes | `x: Math.min(e.clientX, innerWidth - 210), y: Math.min(e.clientY, innerHeight - 280)` | redondant avec rendu (l.782) mais bornes fausses si fenêtre < 280 px | supprimer le clamp du set, garder le clampRect du rendu |

---

## C. clampRect avec dimensions HARDCODÉES approximatives — 7 ⚠️ léger

Correctifs en place, mais `w/h` passés à `clampRect` sont des estimations. Si le menu réel dépasse (surtout en hauteur), le bas peut encore sortir. Vérifier chaque dimension contre la taille réelle du menu.

| Fichier | Ligne | Composant | Dimensions passées | Risque résiduel |
|---|---|---|---|---|
| `src/views/QuickShowView.tsx` | 3618 | Section picker (section + palette couleurs, `min-w-120`) | `clampRect(x\|0, y\|0, 220, 320)` | + hack l.3619 (`rect.bottom > innerHeight → top='auto'`) qui **contredit le clamp** → à supprimer. Menu réel ≈ 350-400 px ? |
| `src/views/QuickShowView.tsx` | 3710 | efxContextMenu (`min-w-160`) | `clampRect(..., 200, 240)` | OK |
| `src/views/QuickShowView.tsx` | 3753 | efxEntryMenu (`min-w-160`) | `clampRect(..., 200, 240)` | OK |
| `src/views/QuickShowView.tsx` | 3784 | colorContextMenu (`min-w-360` + ColorTrackInsertMenu) | `clampRect(..., 380, 260)` | hauteur réelle ≈ 260-300 px → **bas** si clic en bas |
| `src/views/QuickShowView.tsx` | 3815 | colorEntryMenu (`min-w-160`) | `clampRect(..., 380, 260)` | largeur surdimensionnée (OK), hauteur OK |
| `src/views/QuickShowView.tsx` | 4033 | scmPos — Strobe track insert (`min-w-160` + insert menu) | `clampRect(..., 220, 240)` | hauteur ≈ 240-280 → **bas** possible |
| `src/hooks/useAudioFileLoader.tsx` | 746 | selMenu waveform ctx (`min-w-150`, + sous-menus) | `clampRect(..., 220, 260)` | menu + sous-menu > 260 px → **bas** possible |

---

## D. Popovers sous boutons (`top-full` / position relative au parent) — 7 ⚠️ modéré

Le parent étant dans la page, le débordement est surtout **vers le bas** (bouton près du bas de la fenêtre) ; `right-0` gère la droite, `left-0` non.

| Fichier | Ligne | Composant | Position | Risque |
|---|---|---|---|---|
| `src/views/PerformanceView.tsx` | 635 | Palette « Add Widget » (`w-44`) | `absolute top-full left-0` | bas (toolbar haut → faible) ; droite si bouton déplacé à droite |
| `src/views/PerformanceView.tsx` | 4124 | Dropdown « Add Cue » (`w-56 max-h-48`) | `absolute right-0 top-full` | **bas** si panel en bas de fenêtre |
| `src/views/DesignView.tsx` | 2383 | Popover « Add Step » (scènes, `w-64 max-h-48`) | `absolute right-0 top-full` | bas (dans éditeur de chaser, panel haut → faible) |
| `src/views/DesignView.tsx` | 3078 | Dropdown « Add Cue » (`w-56 max-h-48`) | `absolute right-0 top-full` | bas |
| `src/views/QuickShowView.tsx` | 3197 | Presets dropdown (`min-w-220`) | `absolute top-full right-0` | bas (toolbar haut → faible) |
| `src/views/QuickShowView.tsx` | 3376 | « Limites par head » (`min-w-250 max-h-72`) | `absolute left-0 top-full` (dans `<details>`) | **bas** (sidebar longue) + droite si panneau à droite |
| `src/components/layout/TopBar.tsx` | 277 | Tooltip update (`whitespace-nowrap`) | `absolute top-full right-0` | faible (tooltip) |

Correction recommandée : basculer ces popovers en `ClampedPopup` (position calculée après montage) ou clamp au set avec rect du bouton + marge 8.

---

## E. Sous-menus « Entity Insert » (`left-full`, ouvrent à DROITE du parent) — 4 ⚠️

Le menu parent (selMenu, lui-même clampé à droite) touche le bord droit → le sous-menu `left-full` déborde **à droite** hors écran. `max-h-44` borne la hauteur mais pas `top-0` (débordement bas possible).

| Fichier | Ligne | Sous-menu |
|---|---|---|
| `src/hooks/useAudioFileLoader.tsx` | 778 | Scenes (`min-w-160 max-h-44`) |
| `src/hooks/useAudioFileLoader.tsx` | 806 | Chasers |
| `src/hooks/useAudioFileLoader.tsx` | 834 | Cue lists |
| `src/hooks/useAudioFileLoader.tsx` | 862 | Effects |

Correction : `right-full` (ouvrir à gauche) ou clamp via rect du parent ; sinon clampRect sur les coordonnées du parent + largeur du sous-menu.

---

## F. Fenêtres flottantes draggables (`fixed` + left/top pilotés au drag, sans clamp) — 4 ⚠️ faible

Draggable = récupérable par l'utilisateur, mais peuvent être poussées hors écran (titre inaccessible → impossible de les ramener). Clamp au drag recommandé.

| Fichier | Ligne | Fenêtre |
|---|---|---|
| `src/views/PerformanceView.tsx` | 764 | Floating 3D (drag l.152-157, resize l.167-172) |
| `src/views/QuickShowView.tsx` | 3858 | Floating 3D (drag 2528-2531, resize 2512-2517) |
| `src/views/DesignView.tsx` | 1282 | Floating 3D (drag 917-920, resize 927-930) |
| `src/views/Stage3D.tsx` | 2235 | Selected fixture editor (`right:16, top:80` puis drag DOM l.2244-2248 sans clamp) |

---

## G. Déjà corrects (hors sujet ou OK)

- **Modales centrées `fixed inset-0 flex items-center justify-center`** (hors sujet) : PromptModal (QuickShowView:40, App.tsx:440), WidgetConfigModal (PerformanceView:943), fadeModal (QuickShowView:3591), gradientPicker (QuickShowView:3672, TrackTimeline:3424), chaserPickModal (QuickShowView:4523), efxTrackModal/colorTrackModal/strobeTrackModal/dimmerTrackModal (QuickShowView:3892/4226/4325/4424), modales d'édition de blocs (TrackTimeline:3506/3550/3590/3631), confirmDelete (DesignView:838/1882/2962/3210/4056, ShowManager:800), AddFixtureModal (DesignView:4818), Budget (DesignView:5270), FixtureEditor (DesignView:7004), EditingItem (ShowManager:1362).
- **Popup DOM à la volée centrés** (TrackTimeline:3224/3255/3286 — `top:50%;left:50%;translate(-50%,-50%)`) : centrés, mais anti-pattern (appendChild DOM brut) à noter.
- **Stage3D:2064-2065** musicians menu : clamp manuel CORRECT (`Math.min(r.bottom+6, innerHeight-340)`, `Math.max(8, Math.min(r.left, innerWidth-272))`, marge 8).
- **Widgets VC** (PerformanceView:2130/2243/2342) : positionnement `widget.x/widget.y` en % du canvas — pas des popovers.
- **Stage2DEditor:465** : onContextMenu = simple `preventDefault` (pas de menu rendu).
- **Textarea copie invisible** (PerformanceView:3420) : hors sujet.

---

## Compte total des popovers à risque

- **Critique (aucun clamp)** : 7
- **Clamp manuel approximatif** : 4
- **clampRect à dimensions approximatives** : 7
- **Sous-menus `left-full` (risque droite)** : 4
- **Popovers `top-full` sous boutons** : 7
- **Fenêtres draggables sans clamp** : 4

**Total à traiter : 22** (7 critiques + 4 approximatifs + 7 résiduels + 4 sous-menus), dont **11 avec risque réel de sortie** (les 7 critiques + 4 sous-menus left-full). Les 7 `top-full` et 4 draggables sont des risques faibles/moderés.

## Recommandation générale

1. **Importer `clampRect` (et/ou `ClampedPopup`) partout** : PerformanceView, ShowManager, TrackTimeline, Stage3D.
2. Remplacer les clamps `Math.min` par `clampRect` **avec les dimensions réelles des menus** (ou `ClampedPopup` qui mesure après montage — aucune dimension à deviner).
3. **Mesurer** : les `clampRect` existants de QuickShowView utilisent des tailles devinées (260/320/240 px) — risque résiduel en bas ; `ClampedPopup` règle ça définitivement.
4. Supprimer le hack `el.style.top = 'auto'` (QuickShowView:3619) qui annule le clamp.
5. Sous-menus `left-full` : ouvrir vers la gauche (`right-full`) quand le parent est au bord droit.
6. Fenêtres draggables : clamper la position au drag (marge 8).
7. Popovers `top-full` : si le bouton est dans un conteneur en bas de fenêtre, prévoir ouverture vers le haut ou clamp.
