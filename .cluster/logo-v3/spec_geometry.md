# Contre-spec géométrie — Logo Light Maestro v3

**Verdict de faisabilité : OUI.** Les 5 correctifs v3 sont réalisables par des diffs de quelques lignes sur
`light-maestro/.openclaw/tmp/build-logo.cjs` (+ `build-favicon.cjs`). **Aucune redéfinition de courbe n'est
nécessaire** : la formule existante de la spirale dégénère correctement avec `R_IN = 0` (voir §1.2).

---

## 1. Géométrie EXACTE actuelle (v2) — relevée à la ligne près

### 1.1 `build-logo.cjs` (canvas 512×512, PAS 600×600)

| Paramètre | Valeur v2 | Ligne |
|---|---|---|
| Canvas | `W = H = 512` | L12 |
| Centre / pointe baguette | `CX = 300, CY = 240` — **la pointe EST le centre du pinwheel** (pas 300,238 ; il n'y a aucun offset) | L13 |
| Rayons | `R_OUT = 182, R_IN = 30` | L14 |
| Segments / courbe | `steps = 80` (arc ext. 81 pts + retour 81 pts) | L18 |
| Pétales (3 × 120°) | `(−50°→70°)`, `(70°→190°)`, `(190°→310°)` | L38–L41 |
| Dégradés | g1 `#c084fc→#7c3aed`, g2 `#a855f7→#6d28d9`, g3 `#8b5cf6→#4c1d95`, diagonale objBoundingBox | L46–47 |
| Opacité pétales | `0.95` | L53 |
| Baguette | tip `(300,240)`, tail `(180.5, 363.7)` (`L=172`, `46°`, `x2 = 300−172·cos46°, y2 = 240+172·sin46°`), stroke `#ede8dc` w12 + surlignage blanc w3.5 @0.35 | L56–68 |
| Sparkle | étoile 4 branches, bras 40px, `translate(300,240)` | L65–67 |
| Fond icon-full | radial `#12121a→#0a0a0f` (r 72%) + glow `rgba(168,85,247,0.32)` cercle r=228 | L72–79 |
| Wordmark | groupe `translate(190−300, 158−240) scale(0.5)` réutilise `petalsBlock` + `batonAndSpark(1)` | L106–108 |

**Formule des pétales (spirale d'Archimède linéaire en θ, PAS un secteur simple) :**

- Aller (arc ext.) : `(CX + R_OUT·cos θ, CY + R_OUT·sin θ)`, θ : a0 → a1 (L20–22)
- Retour (spirale) : `r = R_IN + (R_OUT − R_IN)·i/steps`, θ : a1 → a0 (L24–27) — soit `r(θ) = R_IN + (R_OUT−R_IN)·(θ−a0)/(a1−a0)`
- Fermeture : `Z` = segment radial droit de `(a0, R_IN)` à `(a0, R_OUT)` (L34)

Chaque pétale est donc un « comma » : bord extérieur circulaire (r=182) + bord intérieur en spirale + arête
radiale droite. Les 3 spirales partent de r=30 et montent jusqu'au bord (r=182) à la fin de leur secteur :
**le centre du pinwheel est un vide spiralé à 3 bras** (le « trou » de r<30 est la taille actuelle de l'origine).

### 1.2 `build-favicon.cjs`

| Paramètre | Valeur v2 | Ligne |
|---|---|---|
| Canvas | `W = H = 512` | L6 |
| Centre / pointe | `CX = 300, CY = 250` | L7 |
| Rayons | `R_OUT = 235, R_IN = 20` | L8 |
| Pétale unique | a0 = −35°, a1 = 125° (160°) | L25 |
| Baguette | tip `(300,250)`, tail `(156.1, 388.9)` (`L=200`, `44°`), stroke w22 + blanc w6 @0.35 | L26–39 |
| Sparkle | étoile 64px | L40–42 |

---

## 2. Correctifs 1+2 — Pétales qui naissent de la pointe de la baguette

### 2.1 Réponse technique

**Garder la spirale d'Archimède, poser `R_IN = 0`.** C'est un changement d'UNE ligne (L14) :

```js
// build-logo.cjs L14
const R_OUT = 182, R_IN = 0;   // 30 -> 0
```

La formule L26 `r = R_IN + ((R_OUT - R_IN) * i) / steps` dégénère en `r = 182·i/80`, une spirale pure
`r(θ) = 182·(θ−a0)/120°` qui passe par l'origine. Le point `i=0` du retour est alors **exactement (300,240) =
pointe de la baguette** : les 3 spirales (les 3 lames du pinwheel) naissent toutes de la pointe. Le segment
radial de fermeture (Z) va de la pointe au bord : c'est une arête droite tip→bord, exactement le rendu
« faisceau » demandé en correctif 4.

**Nouvelles valeurs exactes (logo) :**

| Paramètre | v2 | **v3** | Commentaire |
|---|---|---|---|
| `R_IN` | 30 | **0** | convergence exacte sur (300,240) |
| `R_OUT` | 182 | **182** (inchangé) | le disque visuel reste identique |
| a0 / a1 | −50/70, 70/190, 190/310 | **inchangés** | aucun angle à modifier |
| `steps` | 80 | **80** (inchangé) | erreur de corde ≈ 0.016 px à 512 — inutile d'augmenter ; 96 possible sans gain visible |
| Opacité pétales | 0.95 | **1.0** | bords nets (correctif 4) : supprimer `opacity="0.95"` à L53 |

**Favicon :** `R_IN = 20 → 0` (L8), opacité `0.95 → 1.0` (L37). Convergence sur (300,250).

> Piège anti-crénelage : avec `R_IN = 0`, 3 fills + 3 fermetures Z convergent sur le même pixel. Un liseré
> clair peut apparaître au point triple. Il est masqué par le halo r=64 et le cœur (définis §4). Garde-fou
> optionnel si l'artefact persiste : `<circle cx="300" cy="240" r="3.5" fill="#8b5cf6"/>` posé juste avant le halo.

---

## 3. Correctif 3 — Cône de faisceau discret partant de la pointe

### 3.1 Positionnement

Le pinwheel remplit le disque : **un chevauchement dans le disque est inévitable, quel que soit l'angle.**
La seule question est de le rendre discret. Le faisceau doit être **au-delà de la pointe, dans le
prolongement de l'axe de la baguette** :

- Baguette v2 : de la pointe (300,240) vers le tail à **−134°** (écran) = direction `(−cos46°, +sin46°)`, bas-gauche.
- Faisceau : direction opposée **−46°** (haut-droite) = `(+cos46°, −sin46°)` — c'est le seul angle qui a du sens.

Il est posé **AU-DESSUS des pétales** (s'il est dessous, il est invisible dans le disque et « partirait » du
bord r=182 au lieu de la pointe — à proscrire).

### 3.2 Valeurs exactes

```js
// dans batonAndSpark() — après les lignes baguette, avant le halo
const LB = 260, HA = 8;                                   // longueur 260, demi-angle 8° (plein 16°)
const b1 = deg(-46 - HA), b2 = deg(-46 + HA);             // bords à -54° et -38°
const bx1 = 300 + LB * Math.cos(b1), by1 = 240 + LB * Math.sin(b1);   // (452.82,  29.66)
const bx2 = 300 + LB * Math.cos(b2), by2 = 240 + LB * Math.sin(b2);   // (504.88,  79.93)
// gradient le long de l'axe (apex -> extrémité (480.61, 52.97))
// <linearGradient id="beamg" gradientUnits="userSpaceOnUse" x1="300" y1="240" x2="480.61" y2="52.97">
//   <stop offset="0%" stop-color="rgba(255,255,255,0.40)"/>
//   <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
// </linearGradient>
// <path d="M300,240 L452.82,29.66 L504.88,79.93 Z" fill="url(#beamg)" opacity="0.28"/>
```

### 3.3 Tolerances (calculées, contrainte dominante = bord droit du canvas, 512−300 = 212 px)

| Paramètre | Max tolérable | **Recommandé** | Justification |
|---|---|---|---|
| Demi-angle | **12°** (L ≤ 283) | **8°** | > 12° : chevauchement multi-pétales visible + débord canvas ; 8° : largeur 51 px au bord du disque (2·182·tan8° = 51.2), encore lisible comme « rayon » |
| Longueur | **269 px** (à ha=8°, contrainte x=512) | **260 px** | à 260 : marge droite 7.1 px, marge haut 29.7 px. Ne JAMAIS dépasser 269 |
| Direction | — | **−46°** | prolongement exact de l'axe baguette |
| Opacité | **0.35** | **0.28** | au-delà de 0.35 le pétale 1 est lavé ; à 0.28 × pic 0.40 du gradient → effet ≈ 0.11, discret |

Chevauchement résiduel : le faisceau couvre −54°…−38°. Le pétale 1 couvre −50°…70° → le faisceau chevauche
le pétale 3 sur 4° (−54°…−50°). Invisible à 0.28 d'opacité (overlay). Si l'on veut un chevauchement STRICTEMENT
nul : demi-angle ≤ 4° (bord à −50°), ou variante « faisceau derrière les pétales » visible seulement hors du
disque — mais alors il ne part plus de la pointe (ne pas retenir).

**Favicon** : apex `(300,250)`, axe **−44°** (prolongement de la baguette à 44°), `L = 245`, `HA = 8°` →
bords à −52°/−36° : `(450.84, 56.94)` et `(498.21, 105.99)` ; extrémité d'axe `(476.24, 79.81)` ; gradient
`(300,250) → (476.24, 79.81)`.

---

## 4. Correctif 4 — Bords des pétales plus nets (rendu « faisceau »)

Trois leviers, cumulables, tous chiffrés :

1. **`R_IN = 0`** (§2) : chaque pétale gagne une arête radiale droite pointe→bord (l'arête Z). C'est le
   principal gain de netteté.
2. **Opacité 1.0** (L53) : supprimer la translucidité qui laissait le glow de fond brouiller les bords.
3. **Liseré lumineux sur l'arc extérieur** (nouveau, après `petalsBlock`) — arc de rayon **r = 180**
   (2 px d'inset pour ne pas être rogné par le viewport d'antialiasing), stroke `rgba(233,213,255,0.35)`
   width 1.5, fill none, `sweep-flag = 1` (sens horaire écran) :

```js
const RIM = [ [-50, 70], [70, 190], [190, 310] ];
// arcs exacts (r=180, centre 300,240) :
//   1 : M415.70,102.11 A180 180 0 0 1 361.56,409.14
//   2 : M361.56,409.14 A180 180 0 0 1 122.73,208.74
//   3 : M122.73,208.74 A180 180 0 0 1 415.70,102.11
```

(Arc 1 : start = (300+180·cos−50°, 240+180·sin−50°) = (415.70, 102.11) ; end = (300+180·cos70°, 240+180·sin70°) = (361.56, 409.14). Idem pour les suivants.)

**Favicon** : arc r = 233 (`R_OUT 235 − 2`), `M490.86,116.36 A233 233 0 0 1 166.36,440.86`,
stroke `rgba(233,213,255,0.35)` width 2.5 (échelle ≈ 1.67).

Dégradés : inchangés (les 3 stops actuels restent la signature colorée du pinwheel).

---

## 5. Correctif 5 — Baguette translucide lumineuse

Remplacer les 2 lignes L63–L64 par **3 couches** (mêmes extrémités : tip (300,240), tail (180.5, 363.7)) :

| Couche | stroke | width | opacity | Rôle |
|---|---|---|---|---|
| Glow | `rgba(255,255,255,0.10)` | **26** (×scale) | — | halo large, donne la « matière lumineuse » |
| Corps | `#ede8dc` | **13** (×scale) | **0.6** | translucide : les pétales percent à 40 % |
| Cœur | `#ffffff` | **5** (×scale) | **0.85** | fil lumineux central |

`stroke-linecap="round"` conservé. Optionnel : gradient le long de l'axe (userSpaceOnUse
`(300,240) → (180.5, 363.7)`), tip `#ffffff` → tail `#e8e2d6` pour une baguette qui « s'éteint » vers la main.

**Favicon** : glow 40 @ rgba(255,255,255,0.10), corps 24 @ #ede8dc 0.6, cœur 9 @ #ffffff 0.85
(tip (300,250), tail (156.1, 388.9)).

---

## 6. Correctif 3′ — Cœur radieux / halo à la pointe (remplace l'étoile)

Remplacer le groupe étoile (L65–67) par : halo radial + cœur blanc + noyau.

```js
// halo (avant la baguette, après le faisceau) :
<radialGradient id="tipglow" cx="50%" cy="50%" r="50%">
  <stop offset="0%"  stop-color="rgba(255,255,255,0.55)"/>
  <stop offset="40%" stop-color="rgba(255,255,255,0.20)"/>
  <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
</radialGradient>
<circle cx="300" cy="240" r="${64 * scale}" fill="url(#tipglow)"/>
// cœur (remplace la star) :
<g transform="translate(300,240) scale(${scale})">
  <path d="M0,20 C-5,12 -20,3 -20,-9 C-20,-17 -14,-23 -7,-23 C-2,-23 0,-19 0,-17 C0,-19 2,-23 7,-23 C14,-23 20,-17 20,-9 C20,3 5,12 0,20 Z" fill="#ffffff"/>
  <circle r="3.5" fill="#ffffff"/>
</g>
```

- Cœur : **40 px** de large × 43 px de haut (bbox x ±20, y −23…20), centré sur la pointe ; la pointe basse du
  cœur (0,20) repose sur l'axe de la baguette.
- Halo : **r = 64** (128 px de diamètre), posé AU-DESSUS des pétales (c'est lui qui porte la lisibilité).

### Tolérances (question 4 de la mission) — rendu à 28 px (échelle 28/512 = 0.0547)

| Paramètre | Max | Recommandé | À 28 px |
|---|---|---|---|
| Taille du cœur | **48 px** (→ 2.6 px à 28 px) | **40 px** | 2.2 px |
| Rayon du halo | **72 px** (→ 7.9 px, ≈ 40 % du disque de 20 px) | **64 px** | 7.0 px |

Au-delà de 48 px le cœur devient un blob (perte de la forme cœur) ; au-delà de r=72 le halo lave tout le
disque. Le halo déborde volontairement de la pointe (c'est sa fonction) ; le cœur, lui, ne déborde pas :
sa bbox reste dans un carré ±20 px autour de (300,240), soit 2.2 px à 28 px — lisible grâce au contraste
blanc pur + halo.

**Favicon** : halo r = **102**, cœur scale **1.6** (64 px), noyau r = 5.6.

---

## 7. Ordre de rendu final (logo et favicon, de bas en haut)

```
fond (icon-full) → pétales (opacity 1.0) → liserés d'arc (r=180) → faisceau (opacity 0.28)
→ halo (r=64) → baguette glow/body/core → cœur blanc + noyau
```

Cet ordre est déjà celui du code si les nouveaux blocs sont insérés dans `batonAndSpark()` (après la
baguette, l'étoile remplacée) et si `rimBlock` est appelé juste après `petalsBlock` dans `svgIcon` (L86)
et dans `wordmark` (L107).

**Wordmark** : suit automatiquement (mêmes fonctions, groupe `scale(0.5)`). Extrémité du faisceau dans le
canvas 1400×420 : `(190+(480.61−300)·0.5, 158+(52.97−240)·0.5) = (280.3, 64.5)` — aucune collision avec le
texte (qui commence à x = 356). ✓

---

## 8. Récapitulatif chiffré v3

| Élément | Logo (512×512) | Favicon (512×512) |
|---|---|---|
| Convergence pétales | (300,240) — `R_IN=0` | (300,250) — `R_IN=0` |
| Disque | R_OUT 182 inchangé | R_OUT 235 inchangé |
| Baguette | glow 26/0.10 · corps 13/0.6 · cœur 5/0.85 | 40/0.10 · 24/0.6 · 9/0.85 |
| Faisceau | ha 8°, L 260, axe −46°, op 0.28 | ha 8°, L 245, axe −44°, op 0.28 |
| Liseré arcs | r=180, rgba(233,213,255,0.35), w1.5 | r=233, même couleur, w2.5 |
| Halo | r=64 | r=102 |
| Cœur | 40 px + noyau 3.5 | 64 px + noyau 5.6 |

**Risques résiduels** (tous couverts) : liseré AA au point triple central (→ halo/cœur ou pastille
`#8b5cf6` r=3.5) ; débord canvas du faisceau (→ jamais L > 269 logo / 245 favicon) ; baguette réduite à
~0.7 px à 28 px (→ c'est le glow qui porte la matière, comportement attendu).
