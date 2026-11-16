# Spec — Boucles auto : catalogue classifié + widget Performance

**Date** : 2026-08-20 · **Statut** : **implémenté** (1.0.14, commit `3aeddcc`).
**But** : voir toutes les boucles auto classées et lisibles dans QuickShow, et lancer une boucle précise depuis un widget Performance en un clic (live/concert).

---

## 1. Le flux cible (exprimé par l'utilisateur)

1. Dans **QuickShow → Loops auto**, je vois **toutes les boucles**, **classées** (ambiances / couleurs / mouvements / strobes) et **lisibles**.
2. Une boucle me plaît → je crée un **widget** dans **Performance**, je le **configure** pour pointer vers cette boucle.
3. En **live/concert** : un **clic / appui** sur le widget **lance** la boucle.

---

## 2. État actuel (vérifié dans le code)

| Brique | Existant | Manquant |
|---|---|---|
| Générateur | `generateLoopLibrary()` (`src/engine/auto-loops.ts`) — boucles typées `color-chase / movement / dimmer-pulse / strobe`, champs `id/name/tier/kind/fixtureIds/steps/speedBpm/direction` | Champ **recette portable** (palette/pattern explicites) |
| Onglet QuickShow | `AutoLoopsPanel.tsx` — grille de cartes (icône + nom + vitesse + direction) + play/stop + « Régénérer » | **Classement par catégorie**, filtres, recherche, « envoyer vers widget » |
| Widgets | `performStore.ts` : `WidgetType='button'` + `ButtonActionType` (dont `audioAutoScript`) + config | `actionType:'autoLoop'` + config loop + moteur live dédié |

---

## 3. Décisions d'architecture (les 2 questions en suspens, tranchées)

### Décision 1 — Persistance : le widget stocke une « recette » (pas un ID figé)

Une boucle n'est **pas** un instantané de fixtures : c'est une **recette portable** (type + palette/pattern + vitesse + rayon + direction + tier + nom), re-appliquée au **patch courant** au moment du play. C'est exactement le modèle SoundSwitch de la **« Master Track portable »** validé par la recherche.

- Le widget stocke la **recette** (`LoopRecipe`), pas des adresses DMX ni un id de chaser éphémère.
- Le catalogue étant **déterministe** (seed fixe), un même patch produit toujours les mêmes boucles → la recette reste stable.
- Avantage : **aucune référence cassée** si le patch change ; la boucle s'adapte aux fixtures présentes.

### Décision 2 — QuickShow : l'onglet « Loops auto » devient le **catalogue navigateur**

Pas de migration lourde : on **enrichit** `AutoLoopsPanel` pour qu'il soit le **catalogue classé + filtrable + lisible**, et ce même composant sert de **picker** dans la config du widget. Une seule source de vérité visuelle.

---

## 4. Conception détaillée

### 4.1 Type `LoopRecipe` (portable)

```ts
// engine/auto-loops.ts
export interface LoopRecipe {
  kind: AutoLoopKind;            // 'color-chase' | 'movement' | 'dimmer-pulse' | 'strobe'
  name: string;
  tier: FixtureTier;
  speedBpm: number;
  direction: AutoLoop['direction'];
  palette?: string;              // nom de palette (color-chase) : vivid/rainbow/warm/cool/party/white
  pattern?: string;              // nom de motif (movement) : circle/square/figure8/zigzag/sweep
  radius?: number;               // amplitude mouvement (36..116)
  chaseSteps?: number;           // nb de couleurs (color-chase)
}
```

- `AutoLoop` gagne une méthode `toRecipe(): LoopRecipe` (et `materializeRecipe(recipe, patch, defs): AutoLoop` pour rejouer).
- `generateLoopLibrary()` expose ces champs **explicitement** (aujourd'hui la palette/le pattern ne vivent que dans le nom).

### 4.2 Catalogue classifié (QuickShow → Loops auto)

- **Groupes par catégorie** (traduction FR) : `color-chase` → **Couleurs**, `movement` → **Mouvements**, `dimmer-pulse` → **Ambiances**, `strobe` → **Strobes**.
- **Barre de filtres** : « Toutes · Couleurs · Mouvements · Ambiances · Strobes » + **recherche** par nom.
- **Carte lisible** : icône catégorie (couleur d'accent) + nom + badge catégorie + vitesse (BPM) + direction + tier.
- **Action « → Widget »** sur chaque carte : ouvre Performance avec un nouveau widget pré-rempli pointant sur cette boucle.

### 4.3 Widget `actionType:'autoLoop'`

- `ButtonActionType` gagne `'autoLoop'` ; `ConsoleWidgetConfig` gagne `autoLoopRecipe?: LoopRecipe`.
- **Config du widget** = **picker de boucles** (réutilise le catalogue classifié) : on choisit une boucle → la recette est stockée dans le widget.
- **Rendu du bouton** : nom de la boucle + icône catégorie + badge tier. `flashMode` toggle (start/stop).

### 4.4 Moteur live (Design A, déjà cadré)

- `_startAutoLoop(recipe)` : `materializeRecipe` → **frame-locked engine** (source dédiée `auto-loop`, LTP 75) au lieu du chaser.
- **Frames complètes** (dimmer + shutter + couleur + pan/tilt) + **OFF total** (RGB=0, shutter=0, dimmer=0) — R1.
- **Fade par classe de canal** (dimmer+couleur en rampe, pan/tilt+shutter en snap) — R2 (tue le snap).
- **Mutex cédant** : priorité `manuel > chaser > auto-loop` ; l'autoLoop cède quand une source supérieure s'active — R4.
- **Miroir 3D** : la boucle est visible dans Stage3D.
- Clic widget = **toggle** (lance / arrête), état actif affiché sur le bouton.

---

## 5. Plan d'implémentation (ordre)

| Étape | Contenu | Livrable testable |
|---|---|---|
| **A** | Catalogue classifié (groupes + filtres + recherche + cartes lisibles) | Onglet Loops auto groupé |
| **B** | `LoopRecipe` portable (`toRecipe` / `materializeRecipe`) | Rejouer une recette = même boucle |
| **C** | Widget `autoLoop` (actionType + config picker + rendu bouton) | Widget branché sur une boucle |
| **D** | Moteur live frame-locked (source `auto-loop` + frames complètes + fade + mutex + miroir 3D) | Clic = lance en live |
| **E** | Tests (177+ nouveaux) + `tsc` + build **1.0.14** | exe portable + setup |

**Hypothèses par défaut** (si tu ne dis rien) : recette stockée dans le widget (Décision 1) ; onglet QuickShow = catalogue navigateur (Décision 2) ; seed du catalogue fixe (stable) ; catégories FR « Couleurs / Mouvements / Ambiances / Strobes ».

---

## 6. Non-périmètre (pour rester « une boucle simple »)

- Pas de crossfade entre boucles, pas de beat-grid DJ, pas d'assignation à des sections de morceau (conformément à la revue SoundSwitch).
- Pas de sets/banques de loops (R7, futur).
