# Subagent C — Distinctivité perceptuelle des palettes « Loops auto »

**Objet** : mesurer si le bug « la boucle joue toujours la même chose » vient de palettes trop monotones.
**Méthode** : conversion hex→RGB→Lab (D65), distances ΔE76 (CIE76) et euclidienne RGB entre couleurs consécutives du cycle (1→2→3→4→1), différence de teinte (ΔHue en °), et simulation exacte de `applyHueShift` (source `dmx-color.ts`).

---

## 1. Couleurs par thème (RGB + HSL)

| Thème | Couleur | RGB | Hue | Sat | Lum | Famille |
|---|---|---|---|---|---|---|
| Violet | #a855f7 | 168,85,247 | 271° | 91% | 65% | violet |
| Violet | #8b5cf6 | 139,92,246 | 258° | 90% | 66% | violet |
| Violet | #c084fc | 192,132,252 | 270° | 95% | 75% | violet |
| Violet | #ede8dc | 237,232,220 | 42° | 32% | 90% | crème (quasi blanc) |
| Ocean | #1e3a8a | 30,58,138 | 224° | 64% | 33% | bleu nuit |
| Ocean | #0ea5e9 | 14,165,233 | 199° | 89% | 48% | cyan |
| Ocean | #22d3ee | 34,211,238 | 188° | 86% | 53% | cyan |
| Ocean | #e0f2fe | 224,242,254 | 204° | 94% | 94% | bleu très pâle |
| Ember | #7f1d1d | 127,29,29 | 0° | 63% | 31% | rouge sombre |
| Ember | #ea580c | 234,88,12 | 21° | 90% | 48% | orange |
| Ember | #f59e0b | 245,158,11 | 38° | 92% | 50% | orange/ambre |
| Ember | #fef3c7 | 254,243,199 | 48° | 97% | 89% | jaune pâle |
| Forest | #14532d | 20,83,45 | 144° | 61% | 20% | vert sombre |
| Forest | #16a34a | 22,163,74 | 142° | 76% | 36% | vert |
| Forest | #4ade80 | 74,222,128 | 142° | 69% | 58% | vert clair |
| Forest | #dcfce7 | 220,252,231 | 141° | 84% | 93% | vert très pâle |

**Constat immédiat** : chaque thème est un **dégradé monochromatique** (une seule famille de teinte) + un 4ᵉ swatch très pâle (L≈90) qui se lit comme un blanc.

---

## 2. Distances entre couleurs consécutives (cycle)

| Thème | Transition | ΔE76 | ΔRGB | ΔHue |
|---|---|---|---|---|
| Violet | #a855f7 → #8b5cf6 | 10.1 | 30 | 12° |
| Violet | #8b5cf6 → #c084fc | 25.0 | 67 | 12° |
| Violet | #c084fc → #ede8dc | 78.4 | 114 | 132° |
| Violet | #ede8dc → #a855f7 | 104.9 | 165 | 132° |
| Ocean | #1e3a8a → #0ea5e9 | 48.4 | 144 | 26° |
| Ocean | #0ea5e9 → #22d3ee | 31.4 | 50 | 11° |
| Ocean | #22d3ee → #e0f2fe | 37.3 | 193 | 16° |
| Ocean | #e0f2fe → #1e3a8a | 81.8 | 291 | 20° |
| Ember | #7f1d1d → #ea580c | 49.3 | 123 | 21° |
| Ember | #ea580c → #f59e0b | 35.9 | 71 | 17° |
| Ember | #f59e0b → #fef3c7 | 63.5 | 207 | 10° |
| Ember | #fef3c7 → #7f1d1d | 81.1 | 301 | 48° |
| Forest | #14532d → #16a34a | 42.4 | 85 | 2° |
| Forest | #16a34a → #4ade80 | 21.0 | 95 | 0° |
| Forest | #4ade80 → #dcfce7 | 56.0 | 181 | 1° |
| Forest | #dcfce7 → #14532d | 68.1 | 321 | 3° |

**Seuil de repère** : un ΔE76 < ~30 est à peine perceptible ; un ΔHue < ~15° est perçu comme « la même couleur » sur une source lumière.

**Lecture par thème** :
- **Violet** : 3 couleurs sur 4 ont la même teinte (258–271°, ΔHue=12° entre elles). Seule la transition vers le crème (132°) est visible → la boucle se lit « violet, violet, violet, blanc ».
- **Ocean** : les 4 sont bleu/cyan (188–224°). Écart de teinte max 36°, transitions souvent < 20° → perçu comme un dégradé de bleu.
- **Ember** : les 4 sont chauds (0–48°, rouge→jaune). Déjà plus étalé, mais toujours une seule famille chaude.
- **Forest** : **pire cas** — ΔHue = 0 à 3° sur tout le cycle. C'est strictement la même teinte verte, seule la luminosité varie. La boucle est perçue comme « toujours du vert ».

**Min/max pairwise ΔE76 intra-thème** : Violet 10.1 (quasi identiques), Ocean 31.4, Ember 35.9, Forest 21.0. Un swatch sur trois est donc souvent quasi indistinguable du voisin.

---

## 3. Vérification du hue-shift par tier (120° / 240°)

`applyHueShift` est une rotation HSL correcte (testée sur les 16 couleurs). Résultat pour Violet :

| Couleur | +120° (secondary) | +240° (tertiary) |
|---|---|---|
| #a855f7 | #f7a855 (orange, 31°) | #55f7a8 (vert, 151°) |
| #8b5cf6 | #f68b5c (orange) | #5cf68b (vert) |
| #c084fc | #fcc084 (orange) | #84fcc0 (vert) |
| #ede8dc | #dcede8 (vert pâle) | #e8dced (violet pâle) |

**Conclusion sur le hue-shift** : le code est **correct** — le violet tourne bien en orange (120°) et en vert (240°). ⚠️ Nuance vs. l'énoncé « purple→vert, purple→orange » : l'ordre réel est **120°→orange, 240°→vert** (l'inverse de l'ordre cité). Les deux transformations existent, mais assignées aux tiers opposés.

**Deux limites fonctionnelles** :
1. **Le tier `primary` (le plus visible) a un shift de 0°** → il rejoue la palette brute monochrome. Le hue-shift ne diversifie que les groupes secondaires/tertiaires, il ne varie pas dans le temps.
2. **Les 4ᵉ swatches pâles** (#ede8dc, #e0f2fe, #fef3c7, #dcfce7) ont une chroma quasi nulle : après shift ils restent pastel/blancs. Sur une fixture DMX, ils se lisent comme « blanc », pas comme une couleur.

---

## 4. Verdict

**OUI — les palettes sont trop monotones, et c'est la cause majeure du bug perçu.**

Justification chiffrée :
- Les 4 thèmes sont des **rampes monochromatiques** : écart de teinte max intra-thème = 3° (Forest), 12° (Violet hors crème), 36° (Ocean), 48° (Ember).
- Sur le cycle de 4 couleurs, **au moins 2 à 3 transitions sur 4 ont un ΔHue < 20°** (souvent < 15°) → perçues comme « la même couleur ».
- Le ΔE76 minimum entre deux swatches d'un même thème tombe à **10.1 (Violet), 21.0 (Forest)** → sous le seuil de distinction nette.
- Le tier `primary` (shift 0°) diffuse la palette brute → le rendu dominant est donc exactement cette rampe monotone.

**Facteurs aggravants** (à noter, hors périmètre palette mais liés) :
- La boucle ne contient que **4 couleurs** répétées sur 64 cues (beat % 4) → le motif est court et identique toutes les 4 beats.
- Le hue-shift est **statique par fixture** (par tier), il n'ajoute pas de variété au cours du temps.

---

## 5. Recommandation — 4 nouvelles palettes DMX

Critères retenus : **saturation 100 %**, **4 teintes bien séparées** (écart de teinte ≥ ~70° entre voisins), **aucun swatch pâle/quasi blanc** (un blanc dilue le rendu DMX et résiste mal au hue-shift). Les 4 propositions ci-dessous conservent leur distinctivité même après rotation 120°/240° (teintes pures).

| Nom | Palette (hex) | Min ΔE76 pairwise | ΔE76 cycle (somme) | Teintes |
|---|---|---|---|---|
| **Neon** | `#ff0055` `#00e5ff` `#7cff00` `#8b00ff` | **116** | 608 | 340°, 186°, 91°, 273° |
| **Rave** | `#ff1a1a` `#1aff1a` `#1a1aff` `#ffcc00` | 84 | 710 | 0°, 120°, 240°, 48° |
| **Arctic** | `#ff0055` `#00ffcc` `#ffaa00` `#4400ff` | 82 | 588 | 340°, 168°, 40°, 256° |
| **Magma** | `#ff3c00` `#ffd400` `#00ffcc` `#9b30ff` | 79 | 500 | 14°, 50°, 168°, 271° |

Comparaison : les palettes actuelles ont un **min ΔE76 de 10 à 36** ; les propositions montent à **79–116**, soit un contraste perçu ~3 à 10× supérieur, avec des teintes réellement distinctes (rouge/vert/bleu/jaune/cyan/magenta/violet).

**À appliquer dans `src/engine/theme-loop.ts`** (remplacer les 4 entrées de `THEME_LOOP_PRESETS`), en gardant les mêmes `movement` :

```ts
{ name: 'Neon',   palette: ['#ff0055', '#00e5ff', '#7cff00', '#8b00ff'], movement: 'sweep' },
{ name: 'Rave',   palette: ['#ff1a1a', '#1aff1a', '#1a1aff', '#ffcc00'], movement: 'wave' },
{ name: 'Arctic', palette: ['#ff0055', '#00ffcc', '#ffaa00', '#4400ff'], movement: 'pulse' },
{ name: 'Magma',  palette: ['#ff3c00', '#ffd400', '#00ffcc', '#9b30ff'], movement: 'circle' },
```

**Recommandations complémentaires (optionnel, hors strict périmètre palette)** :
1. Faire varier le hue-shift **dans le temps** (ex. `applyHueShift([r,g,b], TIER_HUE[tier] + beat*30)`) pour que la boucle ne soit pas une simple répétition toutes les 4 beats.
2. Augmenter la longueur du cycle (ex. 6–8 couleurs par thème) pour casser la répétition courte.
3. Retirer les teints quasi blancs des palettes (ils se lisent comme du blanc sur DMX et se délavent au hue-shift).

---

C_DONE
