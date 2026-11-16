# Audit responsive — PerformanceView.tsx

Fichier : `light-maestro/src/views/PerformanceView.tsx` (4432 lignes)
Méthode : lecture ciblée du JSX de rendu uniquement (pas de logique métier/stores/handlers).
Contexte : fenêtre `minWidth 1024`, maximisée au lancement, rendue dans `<main class="flex-1 overflow-hidden">` → wrapper `h-full flex-col`.

## Verdict global

La vue est **globalement bien construite** : les 8 panneaux suivent deux patterns sains :
- `h-full flex flex-col` + `flex-1 overflow-auto` (VirtualConsole, SimpleDesk) ;
- `h-full p-8 overflow-y-auto` (MIDI, Remote, OSC, CueList, Settings, MTC).

Pas de `grid-cols-[…px…]`, pas de `h-screen`/`vh` figé, pas de `min-h-screen`. Les vrais problèmes sont **ponctuels** : des cellules de texte non tronquées dans des rangées flex, des largeurs fixes sur des panneaux latéraux/modales, et l'absence de garde `overflow-x` sur les panneaux « page » à défilement vertical.

---

## 1. Conteneur racine

| Ligne | Classes | Statut |
|---|---|---|
| 615 | `h-full flex flex-col bg-[#0a0a0f]` (VirtualConsole) | OK |
| 2481 | `h-full flex flex-col bg-[#0a0a0f]` (SimpleDesk) | OK |
| 3002 / 3465 / 3738 / 3949 / 4135 / 4261 | `h-full p-8 overflow-y-auto` | ⚠️ voir §3 |

- `overflow-hidden` est géré par le parent `<main>` ; en interne VirtualConsole (701) et SimpleDesk (2550) utilisent `flex-1 overflow-auto` → défilement interne correct.
- **Défaut** : les panneaux « page » (`overflow-y-auto`) n'ont **pas de `overflow-x`** (ni `hidden`, ni `auto`). Tout contenu plus large que le conteneur (cf. §3 et §5) déborde horizontalement sans barre de défilement → clipping/glitch visuel.

## 2. Panneaux / colonnes à largeur fixe

| Ligne | Classes | Largeur | Symptôme |
|---|---|---|---|
| 2633 | `w-52 … shrink-0` (detail panel SimpleDesk) | 208 px | Colonne fixe qui ne se réduit jamais. À 1024 px elle rogne la grille de faders. |
| 883 | `w-[380px] max-h-[80vh]` (WidgetConfigModal) | 380 px | Modale à largeur figée, pas de `max-w-[90vw]` → déborde sous ~400 px. |
| 632 | `w-44` (palette « Add widget ») | 176 px | OK (menu flottant). |
| 4036 | `w-56 max-h-48` (dropdown « Add Cue ») | 224 px | OK (flottant, mais pas de `max-w-[90vw]`). |
| 830 | `min-w-[140px]` (ContextMenuPopup) | 140 px | OK (flottant). |
| 3120/3135/3150/3165 | `min-w-[160px]` (selects MIDI learn) | 160 px | OK (champ de formulaire). |

## 3. Enfants flex sans `min-w-0` (risque de débordement horizontal)

Bonnes pratiques déjà en place (ne pas casser) :
- 3058 `flex-1 min-w-0` (device MIDI) — OK
- 3511 / 3528 `flex-1 min-w-0 … truncate` (URL/token Remote) — OK

**Problème réel :**
- **4403** (MTC, liste des marqueurs) : `<span className="text-[10px] text-gray-500 shrink-0">{tgt.type}: {targetName}</span>` — **pas de `truncate`, pas de `min-w-0`, `shrink-0`**. Un nom de scène/chaser long **force la rangée plus large que le conteneur `max-w-2xl` (672 px)** → débordement horizontal invisible (le parent est `overflow-y-auto` sans `overflow-x`).
- 3835 (OSC mapping) : `flex justify-between gap-4` avec du texte `font-mono` long non wrappable (`/chaser/index/<n>/play · stop · next · previous`) — pas de `break-all`, mais court et statique → risque faible.
- 4086 (CueList, nom du cue) : `flex-1 text-sm truncate` **sans `min-w-0`**. Fonctionne en pratique (le `truncate` = `overflow:hidden` annule la taille min automatique en flex), mais fragile. Ajouter `min-w-0` est gratuit et défensif.
- 4402 (MTC, nom du marqueur) : `flex-1 text-xs truncate` — même remarque, ajouter `min-w-0`.

## 4. Hauteurs fixes (risque de coupure à ~768 px de haut)

| Ligne | Classes | Analyse |
|---|---|---|
| 617 / 2483 | `h-10` toolbar + `shrink-0` | OK (header fixe 40 px). |
| 2724 | `h-6` status bar + `shrink-0` | OK (footer fixe 24 px). |
| 2566 | `w-12 h-[120px]` (fader caché en mode highlight) | Placeholder statique, OK. |
| 2171 / 2583 | `min-h-[60px]` (piste slider) | Minimum raisonnable, OK. |
| 2555 | `gridAutoRows: 'minmax(120px, auto)'` (SimpleDesk) | Chaque rangée ≥ 120 px ; à 768 px on voit ~5 rangées puis défilement (géré par 2550 `overflow-auto`). **Pas de coupure**, mais densité faible. |
| 762 | `minWidth: 320, minHeight: 200` (floating 3D) | Fenêtre flottante, OK. |
| 2279 | `style={{ height: widget.height - 32 }}` (VCFrameWidget) | Taille pilotée par l'utilisateur, widget dans canvas scrollable. OK. |

Aucune hauteur figée de type `h-[768px]` ne coupe le contenu ; les zones scrollables sont correctes. **Le seul point de vigilance** est la grille SimpleDesk : `minmax(120px, auto)` empêche la compression verticale — acceptable car scrollable, mais si on veut densifier à basse résolution, passer à `minmax(80px, auto)`.

## 5. `window.innerWidth/innerHeight` et constantes figées

| Ligne | Usage | Analyse |
|---|---|---|
| 831 | `style={{ left: Math.min(x, window.innerWidth - 160), top: Math.min(y, window.innerHeight - 180) }}` (ContextMenuPopup) | **Magic numbers 160/180** (taille supposée du menu). Fonctionnel mais fragile : si le menu grandit, le clamp est faux. Corriger : `max-w-[90vw]` sur le menu + clamp via `getBoundingClientRect`. |
| 762 | `float3DPos` / `float3DSize` (state persisté) | Position absolue stockée ; après un redimensionnement de fenêtre, la fenêtre 3D peut rester hors-champ. Mineur. |
| 2554-2556 | `repeat(${CHANNELS_PER_ROW}, 1fr)` + `maxWidth: CHANNELS_PER_ROW * 52` (832 px) + `gridAutoRows: minmax(120px, auto)` | CHANNELS_PER_ROW=16 (ligne 2404), constante de 52 px/canal (ligne 2556). Grille `1fr` → **se compresse** à basse largeur (les colonnes rétrécissent, sliders `w-3` centrés). `maxWidth` ne fait que plafonner. **Comportement OK**, pas de scroll horizontal forcé à 1024 px. |

---

## Top 5 correctifs (classes minimales, pas de refonte)

1. **`4403`** — MTC target label : `text-[10px] text-gray-500 shrink-0` → `text-[10px] text-gray-500 min-w-0 truncate max-w-[40%]` (retirer `shrink-0`, laisser tronquer).
2. **`3002 / 3465 / 3738 / 3949 / 4135 / 4261`** — panneaux `h-full p-8 overflow-y-auto` → `h-full p-8 overflow-y-auto overflow-x-hidden` (garde-fou horizontal).
3. **`2633`** — detail panel SimpleDesk : `w-52 … shrink-0` → `w-44 xl:w-52 … shrink-0` (ou `hidden md:flex` si on veut un repli réel).
4. **`883`** — modale widget : `w-[380px] max-h-[80vh] overflow-y-auto` → `w-[380px] max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto`.
5. **`4086` / `4402`** — cellules texte `flex-1 … truncate` → `flex-1 min-w-0 … truncate` (défensif) ; et sur la rangée cue (4092/4095/4099) consolider les 3 colonnes `w-16` (ex. `hidden sm:inline` sur « Hold ») pour laisser de l'air au nom sous ~1280 px.

**Bonus mineur** : `831` remplacer les magic numbers `160/180` par un `max-w-[90vw]` + clamp rect ; `4036`/`632` ajouter `max-w-[90vw]` aux menus flottants.
