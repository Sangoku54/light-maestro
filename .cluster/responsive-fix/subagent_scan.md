# Scan largeurs/hauteurs codées en dur — Light Maestro `src/`

Contexte fenêtre : `minWidth 1024`, `minHeight 700`, maximise au lancement.
Fichiers exclus : `src/__tests__/**`, `*.d.ts`.
Motifs scannés : Tailwind arbitraire `w-/h-/min-w-/max-w-/min-h-/max-h-[NNNpx]`, classes fixes `w-64/72/80/96`, `min-w-screen`, styles inline `width/height: NNNpx`, grilles `gridTemplateColumns`/`grid-template-columns`/`minmax`, `table-fixed`/`<table>`/`<col>`, `<pre>`.

Légende gravité :
- **SÛR** : déborde ou comprime le contenu à coup sûr à 1024×768 (et souvent 1366×768).
- **PROBABLE** : risque réel selon le contenu/état.
- **OK** : valeur fixe mais sans risque de débordement (menu, popup, cap `truncate`, wrapper `overflow-x-auto`, ou `max-w-[95vw]` de garde).

---

## 1. Tailwind arbitraire largeur/hauteur ≥ 100px

### Largeur fixe `w-[NNNpx]`
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `App.tsx:435` | `w-[420px]` (modale close-guard) | OK (420 < 1024) |
| `views/DesignView.tsx:4692` | `w-[560px]` modale | OK (fit 1024) |
| `views/DesignView.tsx:5144` | `w-[480px]` modale | OK |
| `views/DesignView.tsx:6912` | `w-[680px]` modale | PROBABLE — 680px, aucun `max-w-[90vw]` de garde ; colle à 1024 |
| `views/PerformanceView.tsx:883` | `w-[380px]` modale | OK |
| `views/QuickShowView.tsx:43` | `w-[320px]` panel | OK |
| `views/QuickShowView.tsx:3527` | `w-[420px]` + `max-w-[95vw]` | OK (garde présente) |
| `views/QuickShowView.tsx:3746/4080/4179/4278/4377` | `w-[420px]` ×5 | OK |
| `views/ShowManager.tsx:1027` | `w-[180px]` sidebar gauche | SÛR (voir top 15) |
| `views/TrackTimeline.tsx:3408/3450/3488` | `w-[90px]` colonne label absolue ×3 | OK |
| `views/TrackTimeline.tsx:3531/3613` | `w-[420px]` + `max-w-[95vw]` | OK |
| `views/TrackTimeline.tsx:3657/3697` | `w-[340px]` + `max-w-[95vw]` | OK |
| `views/TrackTimeline.tsx:3738` | `w-[380px]` + `max-w-[95vw]` | OK |

### `min-w-[NNNpx]` (menus déroulants / popovers)
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `hooks/useAudioFileLoader.tsx:744` | `min-w-[150px]` | OK |
| `hooks/useAudioFileLoader.tsx:777/805/833/861` | `min-w-[160px]` ×4 | OK |
| `views/DesignView.tsx:779` | `min-w-[190px]` + `max-h-[80vh]` | OK |
| `views/DesignView.tsx:1736/2824/4594/5753/5872` | `min-w-[160px]` ×5 | OK |
| `views/PerformanceView.tsx:830` | `min-w-[140px]` | OK |
| `views/PerformanceView.tsx:3120/3135/3150/3165` | `min-w-[160px]` ×4 (inputs) | OK |
| `views/QuickShowView.tsx:3109` | `min-w-[220px]` | OK |
| `views/QuickShowView.tsx:3446` | `min-w-[300px]` + `max-w-[360px]` | PROBABLE — modale palette 300px min |
| `views/QuickShowView.tsx:3470` | `min-w-[120px]` | OK |
| `views/QuickShowView.tsx:3562/3605/3667/3885/3915/3980/4050` | `min-w-[160px]` ×7 | OK |
| `views/QuickShowView.tsx:3636` | `min-w-[360px]` dropdown | PROBABLE — 360px min, déborde près du bord droit |
| `views/QuickShowView.tsx:3950` | `min-w-[180px]` | OK |
| `views/QuickShowView.tsx:4014` | `min-w-[200px]` + `max-h-[320px]` | OK |
| `views/ShowManager.tsx:1260` | `min-w-[160px]` | OK |
| `views/ShowManager.tsx:1302` | `min-w-[180px]` | OK |
| `views/Stage3D.tsx:2217` | `min-w-[240px]` | PROBABLE — panneau 3D dans preview étroite (voir top 15) |
| `views/TrackTimeline.tsx:3190` | `min-w-[180px]` | OK |
| `views/TrackTimeline.tsx:3781` | `min-w-[160px]` | OK |

### `max-w-[NNNpx]` (caps avec truncate — shrink OK)
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `components/layout/TopBar.tsx:58/67/76` | `max-w-[180px/160px/200px]` + `truncate` | OK |
| `views/DesignView.tsx:738` | `max-w-[100px]` + `truncate` | OK |
| `views/DesignView.tsx:4496` | `max-w-[120px]` + `truncate` | OK |
| `views/DesignView.tsx:5490` | `max-w-[180px]` + `truncate` | OK |
| `views/PerformanceView.tsx:3777` | `max-w-[200px]` | OK |
| `views/QuickShowView.tsx:978/996` | `max-w-[320px]` + `flex-wrap` | OK |
| `views/QuickShowView.tsx:3830` | `max-w-[250px]` + `truncate` | OK |

### Hauteur `h-/min-h-/max-h-[NNNpx]`
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `views/DesignView.tsx:1109` | `min-h-[540px]` conteneur éditeur scène | **SÛR** — voir top 15 |
| `views/DesignView.tsx:1226` | `min-h-[540px]` + `h-full` preview 3D | **SÛR** — voir top 15 |
| `views/DesignView.tsx:5208` | `max-h-[300px]` + `overflow-y-auto` | OK |
| `views/PerformanceView.tsx:2171/2583` | `min-h-[60px]` sliders | OK |
| `views/PerformanceView.tsx:2566` | `h-[120px]` placeholder fader | OK |
| `views/QuickShowView.tsx:4014` | `max-h-[320px]` + `overflow-auto` | OK |
| `views/ShowManager.tsx:1001/1033` | `h-[30px]` / `h-[50px]` rows | OK |
| `views/ShowManager.tsx:1246` | `h-[200px]` empty state | OK |
| `views/ShowManager.tsx:1302` | `max-h-[300px]` + `overflow-y-auto` | OK |

### Autre arbitraire ≥ 100px
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `components/layout/TopBar.tsx:44` | `pr-[150px]` (espace réservé boutons fenêtre) | PROBABLE — voir top 15 |

---

## 2. Classes Tailwind largeur fixe
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `components/layout/Sidebar.tsx:32` | `w-12` rail icônes | SÛR (cumul sidebars) |
| `components/layout/Sidebar.tsx:41` | `w-56` sidebar | SÛR (cumul sidebars) |
| `views/DesignView.tsx:113` | `w-64` sidebar interne Design | SÛR (cumul sidebars) |
| `views/DesignView.tsx:837/1756/2836/3084/3930` | `w-80` modales ×5 | OK (320px) |
| `views/DesignView.tsx:2256` | `w-64` dropdown | OK |
| `views/ShowManager.tsx:800/1358` | `w-80` modales ×2 | OK |
| `views/Stage3D.tsx:2062` | `w-64` panneau | PROBABLE (dans preview étroite) |
| `views/Stage3D.tsx:2158` | `w-72` + `max-h-[75%]` panneau | PROBABLE (dans preview étroite) |

Aucun `w-screen` / `min-w-screen` détecté.

---

## 3. Styles inline `width/height: NNNpx`
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `views/TrackTimeline.tsx:3208/3239` | `min-width:280px` popup native | OK (popup centré) |
| `views/TrackTimeline.tsx:3270` | `min-width:360px` popup native | OK |
| `hooks/useAudioFileLoader.tsx:903` | `width:60px;height:40px` color picker | OK |
| `styles/global.css:77-78, 94` | scrollbar 14px, range vertical 80px | OK |

Aucun inline ≥ 320px dans les composants React (le seul 360px est un popup DOM natif centré).

---

## 4. Grilles à colonnes fixes
| Fichier:ligne | Valeur | Gravité |
|---|---|---|
| `views/PerformanceView.tsx:2404` | `const CHANNELS_PER_ROW = 16` | **SÛR** — voir top 15 |
| `views/PerformanceView.tsx:2554-2555` | `gridTemplateColumns: repeat(16, 1fr)` + `gridAutoRows: minmax(120px, auto)` | **SÛR** — 16 colonnes figées |
| `views/DesignView.tsx:2697` | `gridTemplateColumns: repeat(${active.cols}, 1fr)` | PROBABLE — nb colonnes fixe selon config |
| `views/DesignView.tsx:5208` | `grid grid-cols-3` + `max-h-[300px] overflow-y-auto` | OK |

Aucun `grid-cols-[...px...]` ni `grid-template-columns` en CSS inline détecté.

---

## 5. Tableaux
| Fichier:ligne | Détail | Gravité |
|---|---|---|
| `views/DesignView.tsx:4440-4441` | `<div className="overflow-x-auto"><table className="w-full text-xs">` | OK (wrapper scroll) |
| `views/DesignView.tsx:7224-7225` | idem | OK |
| `App.tsx:38-39` | `<pre>` erreurs (ErrorBoundary) | OK (pre-wrap) |

Aucun `table-fixed`, aucun `width` sur `<table>`/`<col>`.

---

## 6. Flex/grid sans `min-w-0` (débordement texte/table)
- `min-w-0` est présent 27 fois → les enfants flex texte sont globalement bien protégés.
- `whitespace-nowrap` : 4 occurrences (TopBar tooltips + quelques labels) — risque faible.
- Cas évidents de débordement : aucun `<table>` ou `<pre>` directement enfant d'un flex sans garde. Les 2 tables sont dans `overflow-x-auto`.

---

## TOP 15 — coupables probables (1366×768 et 1024×768)

1. **`Sidebar.tsx:32` + `Sidebar.tsx:41` + `DesignView.tsx:113`** — cumul 3 sidebars fixes : `w-12`(48px) + `w-56`(224px) + `w-64`(256px) = **528px de chrome horizontal fixe** en mode Design. À 1024px il reste ~496px de contenu ; à 1366 ~838px. **SÛR** (compression maximale en Design).
2. **`DesignView.tsx:1109` + `:1226`** — `min-h-[540px]` sur l'éditeur + preview 3D. Avec TopBar 48px + footer 28px, il faut ≥616px utiles ; sur fenêtre 768px de haut le contenu est **coupé** (parent `overflow-hidden`). **SÛR** en vertical.
3. **`PerformanceView.tsx:2404` + `:2554`** — grille faders `repeat(16, 1fr)` figée à 16 colonnes. À 1024px (contenu ~750px) chaque colonne ≈ 45px : faders illisibles. **SÛR**.
4. **`TopBar.tsx:44`** — `pr-[150px]` fixe pour les boutons de fenêtre : rogne 150px de largeur utile quelle que soit la taille, + nav « mode switcher » en `absolute left-1/2` qui peut chevaucher les badges Projet/Preset/Audio à 1024px. **PROBABLE**.
5. **`DesignView.tsx:1226`** — `w-[46%] shrink-0` : la preview 3D garde 46% et ne rétrécit jamais ; combiné aux 528px de sidebars, le panneau gauche (flex-1 min-w-0) est écrasé. **PROBABLE**.
6. **`DesignView.tsx:6912`** — modale `w-[680px]` sans `max-w-[90vw]` : colle au min 1024px, aucun filet de sécurité. **PROBABLE**.
7. **`ShowManager.tsx:1027`** — sidebar `w-[180px]` supplémentaire dans ShowManager. **PROBABLE** (s'ajoute au chrome global).
8. **`Stage3D.tsx:2158` (`w-72`) + `:2062` (`w-64`) + `:2217` (`min-w-[240px]`)** — panneaux 3D fixes ; quand Stage3D est monté dans la preview `w-[46%]` de DesignView (~230-380px), un panneau de 288px **déborde**. **PROBABLE**.
9. **`QuickShowView.tsx:3446`** — modale `min-w-[300px] max-w-[360px]` : OK à 1024, mais palette rigide. **OK/PROBABLE**.
10. **`QuickShowView.tsx:3636`** — dropdown `min-w-[360px]` : déborde près du bord droit à 1024. **PROBABLE**.
11. **`DesignView.tsx:2697`** — `repeat(${active.cols}, 1fr)` : nb de colonnes piloté par config, non réactif à la largeur. **PROBABLE**.
12. **`QuickShowView.tsx:43`** — panel `w-[320px]` : OK seul, mais en Quick mode avec sidebars à 1024 il consomme une part fixe. **OK**.
13. **`DesignView.tsx:4692/5144`** — modales `w-[560px]`/`w-[480px]` : passent à 1024. **OK**.
14. **`App.tsx:435`** — modale `w-[420px]` close-guard. **OK**.
15. **`TrackTimeline.tsx:3531/3613` (`w-[420px]`) et `:3738` (`w-[380px]`)** — possèdent `max-w-[95vw]`, donc protégées. **OK** (bon modèle à généraliser).

**Synthèse** : le vrai point de blocage n'est pas tant les modales (la plupart ≤ 680px passent à 1024) que **(a)** l'empilement des sidebars fixes (~528px), **(b)** le `min-h-[540px]` vertical, **(c)** la grille faders figée à 16 colonnes, et **(d)** le `pr-[150px]` de la TopBar. Les `max-w-[95vw]` déjà présents dans QuickShowView/TrackTimeline sont le pattern à répliquer partout.
