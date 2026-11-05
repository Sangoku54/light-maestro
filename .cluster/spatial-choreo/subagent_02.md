# Subagent 02 — Benchmark des patterns spatiaux (chorégraphie auto)

**Date** : 2026-08-26
**Mission** : recherche web sur la chorégraphie spatiale chez les leaders du marché (SoundSwitch, Madrix, Lightjams, Resolume, QLC+/Chamsys/ETC), puis spécification de patterns exploitables pour têtes mobiles (pan/tilt DMX 0-255, positions scène normalisées).

---

## 1. Recherche (sources réellement trouvées)

### SoundSwitch (auto-show DJ)
- **Position Cues** — https://support.soundswitch.com/en/support/solutions/articles/69000847598-soundswitch-pan-and-tilt-control-with-position-cues-
  L'outil d'auto-show de SoundSwitch ne programme pas de trajectoires arbitraires : il définit des **"Positions"** (valeurs pan/tilt précises par fixture, regroupées en zones de scène) et combine ces positions avec des **macros de mouvement** synchronisées au BPM/analyse musicale. Le show est découpé en **cues** qui s'enchaînent selon l'énergie et les sections du morceau. **Leçon** : la chorégraphie spatiale auto repose sur (a) un vocabulaire de positions, (b) des macro-mouvements (circle, sweep…) dont la vitesse est dérivée du BPM, (c) une sélection par section musicale — pas sur des trajectoires dessinées à la main.
- Discussion utilisateurs (difficulté/prise en main, contrôle pan/tilt) — https://www.facebook.com/groups/soundswitchusergroup/posts/2075635226329625/

### Madrix (pixel mapping, matrices LED)
- **SCE Bar Bounce** — https://help.madrix.com/m5/html/madrix/hidd_effect_sce_bar_bounce.html : effet « barres qui rebondissent sur les bords de la matrice » — c'est le pattern **bounce** : une forme (barre) se déplace, rebondit aux limites, vitesse réglable. Transposable en mouvement de faisceau : aller-retour linéaire avec réflexion aux bords.
- **Checkerboard paramétrique (MADRIX 5.8)** — https://www.facebook.com/MADRIX.DE/posts/new-in-madrix-58-sce-checkerboardparametric-effects-are-the-one-of-the-core-elem/1494060772760265/ : les effets SCE (effets paramétriques de la matrice) incluent checkerboard, waves, etc. — des formules **par pixel (x, y)** avec fréquence et direction, pas des animations pré-dessinées.
- **Mapping / Tiling / Rotation** — https://help.madrix.com/m5/html/madrix/hidd_map_dialog.html : un même effet peut être **mappé, tuilé, pivoté** sur différentes zones de l'installation — le même pattern sert partout, c'est le mapping qui crée la variation spatiale.
- **Leçon Madrix** : tout pattern est une **fonction f(x, y, t)** ; les briques de base sont waves (sinus progressifs), bounce (réflexion), checkerboard (parité), swirl/rotation, avec fréquence (Hz ou BPM) et direction. Le « tuilage » permet de répéter le pattern sur plusieurs groupes de fixtures.

### Lightjams (DMX, têtes mobiles)
- **Tutorial – Moving Head Patterns** — https://groups.google.com/g/lightjams/c/2yYJ9oxkr7Q : projet d'exemple de patterns de mouvement pour têtes mobiles (conseils : garder le tilt dans une plage raisonnable, ~80…).
- **Tutorial – Getting Started** — https://www.lightjams.com/tutorial.html : concepts de grids/sources — Lightjams pilote les fixtures **comme une grille de pixels** : chaque tête = un pixel, les patterns (sinus, cercles…) sont des fonctions de la position de la tête dans la grille, avec fréquence/phase/offset par fixture.
- **Template Editor** — https://www.lightjams.com/templateEditor.html : les têtes sont décrites comme fixtures avec canaux pan/tilt ; le logiciel applique les patterns à tous les canaux de mouvement.
- **Leçon Lightjams** : exactement le modèle demandé — **chaque moteur pan/tilt a une position dans une grille virtuelle, le pattern est une formule sur (x, y, index, temps)**, avec des décalages de phase par fixture qui créent les effets de vague/cascade.

### Resolume (VJ/DMX)
- **BPM sync** — https://resolume.com/support/en/bpm : tout ce qui est en « BPM Sync » se recalcule sur le **beat/bar/phrase** ; le « Resync » remet tout sur le 1er temps de la 1re mesure de la 1re phrase. **Leçon** : la synchro musicale se fait par **phase musicale globale** (beat, bar, phrase), pas par des timers indépendants — les patterns doivent être pilotés par un **horloge musicale** (phase = f(position dans la mesure)).
- **DMX Auto Map** — https://resolume.com/blog/6989 : les fonctions principales de chaque layer sont automatiquement mappées sur des canaux DMX → l'automatisation DMX se fait par **automapping de paramètres** (une valeur 0-255 par paramètre animé).
- Discussion sync BPM/DJ (Beat Doctor, Ableton Link) — https://www.facebook.com/groups/resolumegroup/posts/10159926103678277/ et https://www.reddit.com/r/resolume/comments/1apo3go/syncing_bpm_with_dj_at_show/

### QLC+, ETC, xLights (contexte console/scène)
- **QLC+ RGB Matrix « waves of colour »** — http://www.qlcplus.org/forum/viewtopic.php?t : effets de vagues gauche→droite sur les matrices ; **Smooth RGB Matrix** — https://www.qlcplus.org/forum/viewtopic.php?t : vague arc-en-ciel L→R sur 3 wash lights — l'effet onde est le pattern le plus demandé/le plus basique du marché.
- **ETC Hog 3 – figure eight** — https://community.etcconnect.com/control_consoles/legacy-consoles/f/legacy---wholehog-3/50097/how-to-do-a-figure-eight-pattern-in-effects-with-movers : le 8 (lemniscate) = sinus sur pan + sinus déphasé sur tilt — **les patterns de mouvement des consoles sont des Lissajous** (sin/cos avec rapport de fréquences et déphasage pan/tilt).
- **Reddit r/lightingdesign – effets favoris** — https://www.reddit.com/r/lightingdesign/comments/2ervob/favorite_types_of_moving_head_effects/ : classiques = circle, sweep, wave, bounce, avec des **offsets de phase par fixture** (snap-up / ramp-down).
- **xLights – cercles sur moving heads** — https://www.reddit.com/r/xlights/comments/1hmpqav/how_do_i_make_moving_heads_do_circles/ : les têtes traitées comme pixels d'une matrice, patterns mathématiques par position.
- Guide grand public (balayage/balayage doux, pan fine + tilt fine pour la fluidité) — https://betopperdj.com/blogs/news/how-to-control-moving-head-lights-with-a-dmx-controller-channel-guide-effect-programming

### Synthèse des principes du marché
1. **Pattern = fonction f(x, y, t)** sur une grille de fixtures (Lightjams, Madrix, xLights, QLC+). Le décalage entre fixtures vient de la **position (x, y)** et/ou de l'**index**.
2. **Familles universelles** : onde progressive (sinus, phase ∝ x), bounce (réflexion/triangle), checkerboard (parité de rangée+colonne), cercle/8 (Lissajous pan/tilt), expansion (phase ∝ distance au centre), croisements (2 groupes en opposition de phase).
3. **Synchro musicale** : horloge **BPM + position dans la mesure/la phrase** (Resolume BPM sync, SoundSwitch cues par section) ; vitesse exprimée en tours par beat ou par mesure, pas en Hz libres.
4. **Macro au-dessus des positions** : SoundSwitch combine positions statiques + macros de mouvement ; Madrix tuile un pattern sur plusieurs zones. → Les patterns doivent être **paramétrables en direction, fréquence, amplitude** et applicables **par groupe de fixtures**.

---

## 2. Spécification des patterns

### Conventions communes

- Positions scène normalisées : `x, y ∈ [0, 1]` (x = gauche→droite, y = bas→haut, centre = 0.5).
- DMX : `pan = 128 + A·fx(phase)`, `tilt = 128 + A·fy(phase)`, avec `A ≤ 128` → jamais d'overflow (borné par 128±128 = [0, 255]).
- Temps : `t` en secondes. Fréquence : `f` en cycles/s. En mode BPM : `f = BPM / (60 · div)` où `div` = nombre de beats par cycle (div = 1 → un cycle par beat, div = 4 → un cycle par mesure en 4/4, div = 8 → demi-mesure…).
- Phase musicale globale : `θ = 2π · f · t` ; `θ₀` = offset de phase à l'activation (aligné sur le beat pour démarrer net).
- Multi-moteurs : chaque moteur (bras) d'une fixture a sa **propre position (x, y)** et son propre index → les formules ci-dessous s'appliquent telles quelles à chaque moteur, avec la position du bras.

**Exemple numérique standard utilisé partout** : 6 fixtures en ligne, `x = [0, 0.2, 0.4, 0.6, 0.8, 1.0]`, `y = 0.5`, index `i = 1..6`. Valeurs arrondies à l'entier DMX, `A = 80` (plage confortable, 64 < 128 OK), `t = 0`, `f` quelconque (les tableaux donnent les offsets, indépendants de f).

---

### P1 — Onde progressive (Wave)

- **Usage** : intro, verse, bridge. Le fond de teint chorégraphique : visible, lisible, jamais agressif.
- **Formule** : `phaseᵢ = θ + θ₀ − 2π · xᵢ / λ` — décalage **proportionnel à la position x** (λ = longueur d'onde en unités de scène ; λ = 1 → une onde complète sur la scène, λ = 2 → une demi-onde = « balayage » doux, λ = 0.5 → deux vagues).
  - `pan = 128 + A · sin(phaseᵢ)`, `tilt = 128 + A₂ · sin(2·phaseᵢ)` (optionnel : contre-ondulation verticale à double fréquence, classique « snake »).
- **Paramètres** : `A` (0-128, défaut 80), `A₂` (0-64, défaut 0), `λ` (0.25-4, défaut 1), direction (signe du terme −2πx/λ : + = de droite à gauche, − = de gauche à droite), `f` (défaut BPM/240 = 1 cycle/4 beats), `θ₀`.
- **Effet visuel** : les faisceaux se déplacent en cascade le long de la ligne — une « vague » qui traverse la scène en continu ; au BPM, chaque passage de vague tombe sur un temps fort.
- **Exemple** (λ = 1, A = 80, t = 0) :

  | fixture | x | phase (degrés) | sin | pan (0-255) |
  |---|---|---|---|---|
  | 1 | 0.0 | 0° | 0.000 | 128 |
  | 2 | 0.2 | −72° | −0.951 | 52 |
  | 3 | 0.4 | −144° | −0.588 | 81 |
  | 4 | 0.6 | −216° | +0.588 | 175 |
  | 5 | 0.8 | −288° | +0.951 | 204 |
  | 6 | 1.0 | −360° | 0.000 | 128 |

  À t = 1/(4f), les valeurs se décalent d'une fixture : la bosse de la vague (fixture 4-5) glisse vers la gauche → défilement continu.

---

### P2 — Alternance / Checkerboard

- **Usage** : build, pre-drop, verse énergique. Effet « chassé-croisé » pulsé, très rythmique.
- **Formule** : parité de grille + demi-période :
  - Ligne : `phaseᵢ = θ + θ₀ + π · ((i − 1) mod 2)`
  - Grille 2D : `phaseᵢ = θ + θ₀ + π · ((round(xᵢ·C) + round(yᵢ·R)) mod 2)` avec C, R = nb de colonnes/lignes virtuelles (C = 6 pour 6 fixtures en ligne → équivalent ligne).
  - `pan = 128 + A · sin(phaseᵢ)`, `tilt = 128 + A₂ · sin(phaseᵢ)` (les deux axes peuvent battre ensemble ou en quadrature).
- **Paramètres** : `A` (défaut 90), `A₂` (0-128), `f` (défaut BPM/60 = 1 cycle/beat), C/R (défaut : nb de fixtures), `θ₀`.
- **Effet visuel** : les fixtures paires et impaires sont en opposition de phase → les faisceaux **s'écartent et se resserrent en alternance à chaque battement** (ou chaque 2ᵉ battement selon div) ; en 2D ça devient un vrai damier qui s'inverse.
- **Exemple** (A = 80, t = 0 → ωt = 0, donc sin(π·parité) = 0 partout ; prenons t = 1/(4f) → θ = 90°) :

  | fixture | x | phase | sin | pan (0-255) |
  |---|---|---|---|---|
  | 1 | 0.0 | 90° | +1.000 | 208 |
  | 2 | 0.2 | 270° | −1.000 | 48 |
  | 3 | 0.4 | 90° | +1.000 | 208 |
  | 4 | 0.6 | 270° | −1.000 | 48 |
  | 5 | 0.8 | 90° | +1.000 | 208 |
  | 6 | 1.0 | 270° | −1.000 | 48 |

  Un quart de cycle plus tard, tout s'inverse : les 6 têtes « clignotent » en deux groupes opposés, synchro parfaite avec le kick.

---

### P3 — Expansion radiale depuis le centre

- **Usage** : drop, climax, outro. Le geste « tout s'ouvre depuis le centre » / « tout converge ».
- **Formule** : phase décalée par **distance au centre** : `dᵢ = √((xᵢ − 0.5)² + (yᵢ − 0.5)²)` (en ligne : `dᵢ = |xᵢ − 0.5|`), puis :
  - Expansion : `phaseᵢ = θ + θ₀ − k · dᵢ` (k = π/0.5 = 2π → une demi-onde du centre aux bords ; l'onde **part du centre**)
  - Contraction : `phaseᵢ = θ + θ₀ + k · dᵢ` (l'onde **rentre vers le centre**)
  - `pan = 128 + A · sin(phaseᵢ)`, `tilt = 128 + A · cos(phaseᵢ)` (optionnel : quadrature → mouvement circulaire d'expansion).
- **Paramètres** : `A` (défaut 100), `k` (défaut 2π), sens (exp/contr), `f` (défaut BPM/240, un cycle/4 beats), `θ₀`.
- **Effet visuel** : au drop, une impulsion naît au centre de la ligne et se propage vers les deux extrémités en s'amplifiant ; en contraction, tout le monde converge et « implose » sur le centre — le geste le plus lisible pour marquer une section.
- **Exemple** (k = 2π, A = 80, t = 0) :

  | fixture | x | d | phase | sin | pan (0-255) |
  |---|---|---|---|---|---|
  | 1 | 0.0 | 0.5 | −180° | 0.000 | 128 |
  | 2 | 0.2 | 0.3 | −108° | −0.951 | 52 |
  | 3 | 0.4 | 0.1 | −36° | −0.588 | 81 |
  | 4 | 0.6 | 0.1 | −36° | −0.588 | 81 |
  | 5 | 0.8 | 0.3 | −108° | −0.951 | 52 |
  | 6 | 1.0 | 0.5 | −180° | 0.000 | 128 |

  Symétrie miroir parfaite (le centre de la ligne x = 0.5 est entre les fixtures 3 et 4) : la « bosse » d'amplitude est au centre et se propage vers l'extérieur à mesure que t avance.

---

### P4 — Rotation / Cercle (Lissajous)

- **Usage** : chorus, drop long, breakdown (en slow). LE pattern signature des têtes mobiles.
- **Formule** : paramétrique 2D (cercle) :
  - `pan = 128 + A · cos(phaseᵢ)`, `tilt = 128 + A · sin(phaseᵢ)`
  - `phaseᵢ = θ + θ₀ + 2π · xᵢ / W` (W = longueur d'onde de phase le long de la ligne, défaut 1)
  - Variante **figure en 8** : `pan = 128 + A · sin(phaseᵢ)`, `tilt = 128 + A · sin(2·phaseᵢ)` (rapport 2:1, cf. ETC Hog).
- **Paramètres** : `A` (défaut 80), `W` (0.5-2), sens de rotation (signe du terme en x), `f` (défaut BPM/240), `θ₀`. Multi-moteurs : chaque bras exécute son propre cercle, le décalage de phase crée la vague.
- **Effet visuel** : chaque tête trace un cercle dans l'espace ; les cercles sont **décalés en phase le long de la ligne** → effet de « vague circulaire » qui court de gauche à droite (ou en 8, pour un effet plus « danse »). C'est le pattern qui démontre le mieux la synchro BPM : un tour complet = une mesure.
- **Exemple** (W = 1, A = 80, t = 0) :

  | fixture | x | phase | cos → pan | sin → tilt |
  |---|---|---|---|---|
  | 1 | 0.0 | 0° | 128 + 80 = **208** | 128 + 0 = **128** |
  | 2 | 0.2 | 72° | 128 + 25 = **153** | 128 + 76 = **204** |
  | 3 | 0.4 | 144° | 128 − 65 = **63** | 128 + 47 = **175** |
  | 4 | 0.6 | 216° | 128 − 65 = **63** | 128 − 47 = **81** |
  | 5 | 0.8 | 288° | 128 + 25 = **153** | 128 − 76 = **52** |
  | 6 | 1.0 | 360° | 128 + 80 = **208** | 128 + 0 = **128** |

  Les 6 têtes sont sur le même cercle, réparties à intervalles réguliers (72°) : le groupe forme un « anneau » virtuel qui tourne.

---

### P5 — Croisements (X / contre-marche)

- **Usage** : build, second chorus, section « conversation » entre 2 groupes.
- **Formule** : deux sous-groupes en **opposition de phase** sur le pan :
  - Groupe A (index pairs, `i mod 2 = 1`) : `pan = 128 + A · sin(θ + θ₀ − 2π·xᵢ/λ)`
  - Groupe B (index impairs) : `pan = 128 − A · sin(θ + θ₀ − 2π·xᵢ/λ)`
  - `tilt = 128 + A₂ · sin(θ + θ₀)` (commun, léger) — ou tilt fixe.
- **Paramètres** : `A` (défaut 100), `A₂` (0-64, défaut 0), `λ` (défaut 1), `f` (défaut BPM/60), règle d'appartenance (par index **ou** par moitié gauche/droite de scène), `θ₀`.
- **Effet visuel** : deux vagues qui se croisent en sens inverse — les faisceaux se « tissent » (les A passent entre les B à chaque cycle). Avec un tilt commun, les têtes se font face puis se tournent le dos : dialogue gauche/droite.
- **Exemple** (λ = 1, A = 80, t = 1/(4f) → θ = 90° ; positions x d'origine) :

  | fixture | x | groupe | sin | pan (0-255) |
  |---|---|---|---|---|
  | 1 | 0.0 | A | +1.000 | 128 + 80 = **208** |
  | 2 | 0.2 | B | −0.951 → −sin | 128 − (−76) = **204** |
  | 3 | 0.4 | A | +0.588 | 128 + 47 = **175** |
  | 4 | 0.6 | B | −0.588 → −sin | 128 − 47 = **81** |
  | 5 | 0.8 | A | +0.951 | 128 + 76 = **204** |
  | 6 | 1.0 | B | 0.000 | **128** |

  (Le détail des valeurs exactes dépend de l'instant ; l'essentiel : à tout instant, groupe A et groupe B sont en miroir autour de 128 → les faisceaux se croisent systématiquement.)

---

### P6 — Bounce (aller-retour avec rebond)

- **Usage** : bridge, breakdown, outro. Le plus « organique » / moins carré.
- **Formule** : onde **triangulaire** (aller-retour linéaire, pas de sinus) :
  - `tri(u) = 1 − 2·|frac(u) − 0.5|` avec `u = (θ + θ₀ + 2π·xᵢ/W) / (2π)` → oscille entre −1 (ou 1) et l'autre bord en ligne droite, **réflexion aux bords** (cf. Madrix Bar Bounce).
  - `pan = 128 + A · tri(u)`, `tilt = 128 + A₂ · sin(2π·u)` (optionnel).
- **Paramètres** : `A` (défaut 110), `W` (défaut 1 = une « barre » parcourt la scène), `f` (défaut BPM/120 = cycle sur 2 beats), `θ₀`.
- **Effet visuel** : une barre virtuelle de faisceaux traverse la scène, **rebondit sur les bords** et repart en sens inverse — accélération visuelle aux extrémités (le triangle va plus vite aux bords que le sinus), très lisible en ralenti.
- **Exemple** (W = 1, A = 80, t = 0) :

  | fixture | x | u | tri | pan (0-255) |
  |---|---|---|---|---|
  | 1 | 0.0 | 0.00 | 1.000 | 208 |
  | 2 | 0.2 | 0.20 | 0.400 | 160 |
  | 3 | 0.4 | 0.40 | 0.800 | 192 |
  | 4 | 0.6 | 0.60 | 0.800 | 192 |
  | 5 | 0.8 | 0.80 | 0.400 | 160 |
  | 6 | 1.0 | 1.00 | 1.000 | 208 |

  (Le « creux » de la barre est aux fixtures 2 et 5 ; à t = 1/(2f) le profil s'est inversé → la barre a traversé et rebondi.)

---

## 3. Recommandation — 3 patterns pour le premier lot

**Priorité 1 — P1 Onde progressive.** Le plus rentable : 1 ligne de formule (`sin(θ − 2πx/λ)`), effet immédiatement reconnaissable (« vague »), marche sur n'importe quelle section, tolère les positions approximatives (l'effet reste lisible même avec des x mal calibrés). C'est aussi le socle : P5 et P6 en dérivent par un signe ou une fonction de shape.

**Priorité 2 — P4 Rotation/Cercle.** Le pattern « signature » des têtes mobiles (SoundSwitch macros, Lightjams, consoles ETC : c'est le premier que tout le monde demande). Il utilise **pan ET tilt en quadrature** → valide le moteur 2D et la synchro BPM (1 tour = 1 mesure), et produit le meilleur « wow » en chorus/drop pour un coût de calcul quasi nul (cos/sin).

**Priorité 3 — P3 Expansion radiale.** Le geste le plus lisible pour **marquer le drop / la fin de build** (« tout s'ouvre »), visuellement distinct des deux premiers (symétrie miroir, phase ∝ distance) et il prouve que le système sait utiliser la **géométrie réelle de la scène** (centre, distances) — pas seulement l'ordre d'index. En bonus, il fournit le pattern de « contraction » gratuitement (inversion de signe) pour les outros.

**Pourquoi pas P2/P5/P6 d'abord** : P2 (checkerboard) et P5 (croisement) sont mathématiquement des cas particuliers de P1 (décalage de π par parité / signe opposé par groupe) — ils viendront quasi gratuitement après P1. P6 (bounce) demande une fonction de shape non-sinusoïdale (triangle) : utile mais pas bloquant pour un premier lot. → **Lot 1 : P1, P4, P3** couvre 3 familles mathématiques (phase linéaire en x, paramétrique 2D, phase radiale) et 3 moments musicaux (intro/verse, chorus/drop, drop/outro).

---

*Fichier de travail uniquement — aucun fichier source du projet n'a été modifié.*
