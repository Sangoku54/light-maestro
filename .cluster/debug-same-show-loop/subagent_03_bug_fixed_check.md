# Vérification contradictoire — bug « même show sur toutes les boucles »

## VERDICT : bug probablement corrigé

Les deux commits sont confirmés, le chemin de calcul est correct et **distinct par boucle**
(vérifié code à l'appui), et le diagnostic runtime montre un `cue0` varié et un univers
correct. **Aucune cause résiduelle** n'a été trouvée qui ferait que deux boucles
(theme/ambiance/seed différents) produisent des `cue0` identiques.

Le seul point qui reste NON prouvé : le diagnostic n'a été observé que sur **une seule**
boucle (`wash/energetic`). La preuve minimale de confirmation = **jouer une 2ᵉ boucle
d'ambiance différente** et comparer la valeur `cue0=` du bandeau ambre.

---

## 1. Commits confirmés

```
913b41b fix(auto-loops): playLoop attend le chargement des defs (anti-race)
8932ed5 fix(auto-loops): fallback universe -1 + diagnostic runtime des boucles
```

- `8932ed5` ajoute `if (fa.universeIndex < 0) fa.universeIndex = 0;` dans
  `computeDmxCues` (src/hooks/dmx-cues.ts) — miroir exact de `dmx-playback.ts` (lignes 398-399).
- `913b41b` rend `playLoop` async et `await loadFixtureDefinitions(...)` au lieu de lire
  l'état `fixtureDefs` (vide si « Jouer » est cliqué avant la fin du chargement).

## 2. Le chemin seed/palette → DMX est **distinct par boucle** (vérifié dans le code)

### 2a. `buildLoop` (src/engine/ambiance-loops.ts)
- Le **seed** fait pivoter toute la palette : `paletteStart = seed % paletteLen`,
  `rotatedPalette = palette.slice(paletteStart) + palette.slice(0, paletteStart)`.
- Le cue stocke `colors: rotatedPalette` (palette entière pivotée) **et** `color` (couleur
  de la section). Donc le seed influence bien ce que `computeDmxCues` joue réellement.
- L'**ambiance** change `profile.palette` (ex. energetic = `#ff0064`, dark = `#14143c`,
  epic = `#ffffff`) et le **theme** change `movement` / `strobeMode` / `dimmerPulse`.

### 2b. `computeDmxCues` → couleur
- `paletteColorForTier(cue.colors, pf.tier, cueIndex)` :
  - tier `primary` → `colors[0]` (à cue0) = `rotatedPalette[0]` = **palette[seed % len]** ;
  - tier `secondary` → `colors[floor(len/3)]`, `tertiary` → `colors[floor(2·len/3)]`.
- RGB → `hexToRgb(paletteColor)` écrit r/g/b ; color wheel → `colorDistance` vers la cap
  la plus proche. **La couleur varie donc avec l'ambiance ET avec le seed.**

### 2c. `computeDmxCues` → mouvement
- `getMovementConfig(section, cue.movement)` : si le cue a un `movement` (fourni par le
  theme : wave/circle/bounce/sweep/static/spiral), il utilise `MOVEMENT_BY_TYPE[movement]`.
  Le pan/tilt à cue0 diffère selon le pattern (ex. `circle` → tilt=248, `bounce` →
  pan=128−amplitude, `sweep`/`wave` → centre).
- L'**intensité** (dimmer) diffère aussi selon la section du 1ᵉʳ cue (build=medium vs
  intro=low, etc.).

**Conclusion code** : deux boucles de theme OU ambiance différents produisent des
`channelValues` différents dès `cue0`. Aucun chemin ne force un output identique.

## 3. Ce que les deux fixes couvrent (et ce qu'ils ne couvrent pas)

| Fix | Symptôme qu'il corrige réellement |
|---|---|
| `8932ed5` (universe -1 → 0) | univers `-1` ⇒ `write('vc', -1, …)` = no-op ⇒ **aucune lumière** |
| `913b41b` (await defs) | defs vides ⇒ `analyzeFixture` sans channels ⇒ **`dmxCues` vide ⇒ aucun envoi** |

À noter (honnêteté contradictoire) : **aucun des deux commits ne décrit littéralement
« le même show sur toutes les boucles »** — ils corrigent « aucune lumière / aucun envoi ».
Si le symptôme utilisateur était réellement « show *identique* d'une boucle à l'autre »,
alors le diagnostic n'a pas encore été produit **sur deux boucles différentes** : c'est le
seul trou dans la preuve.

## 4. Cause résiduelle plausible (faible probabilité, à écarter par le test)

1. **Comparaison par tempo uniquement** : deux boucles `wash/energetic` slow vs fast ont un
   `cue0` **identique** (même palette[0], même section, même mouvement) — seule la vitesse
   diffère. C'est voulu, mais un utilisateur qui compare « Lent/Moyen/Rapide » d'un même
   couple verra « le même show » → ce n'est pas un bug.
2. **Race `playLoop` async** : deux clics « Jouer » très rapprochés sur deux boucles
   différentes lancent deux `fire()` concurrents. `stopPlay()` annule le 1ᵉʳ, donc en
   pratique le 2ᵉ gagne. Risque mineur, pas de « même show ».
3. **Fallback `?? loops[0]`** : si `selectedId` ne matche plus (après changement de
   filtre), « Jouer » joue `loops[0]` au lieu de la sélection. Cas marginal, pas « toutes
   les boucles ».

## 5. Preuve minimale à fournir par l'utilisateur

Jouer **deux boucles d'ambiance différente** (ex. `wash · Énergique` puis
`wash · Sombre`), et comparer le bandeau ambre :

- `cue0={…}` doit être **différent** (palette `#ff0064` vs `#14143c` ⇒ RGB différents) ;
- `uni0=` doit rester `0` (pas `-1`) ;
- `nCues=` doit être non nul (> 0), sinon retour au chemin « defs vides » de `913b41b`.

Si ces deux `cue0` diffèrent → **bug confirmé corrigé**. S'ils sont identiques alors que
theme/ambiance diffèrent → rouvrir l'enquête sur le chemin `dmxBridge.write`/arbitre
(sortie hardware), pas sur le calcul.
