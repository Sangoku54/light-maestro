# Audit qualité — moteur auto-loops & matérialisation

Projet `light-maestro` · lecture seule · fichiers inspectés :
`src/engine/auto-loops.ts`, `src/engine/dmx-channel.ts`, `src/engine/dmx-color.ts`,
`src/engine/midi-actions.ts`, `src/utils/dmx-helpers.ts`, `src/stores/showStore.ts`,
`src/views/AutoLoopsPanel.tsx`, `src/views/PerformanceView.tsx`, `src/__tests__/auto-loops.test.ts`.

---

## 1. Sémantique VITESSE — `speed` (BPM) vs `hold` (ms)

**Constat clé : le champ `chaser.speed` (BPM) n'est lu par AUCUN moteur de lecture.**

`materializeAutoLoops` écrit trois choses redondantes (auto-loops.ts) :
- `duration: holdMs` sur la scène (auto-loops.ts:476) ;
- `hold: holdMs` sur chaque step du chaser (auto-loops.ts ~:478) ;
- `speed: loop.speedBpm` sur le chaser (auto-loops.ts:485).

Les trois moteurs qui jouent des chasers ne consomment **que** `step.hold` (avec
fallback `scene.duration`) et ignorent totalement `chaser.speed` :
- `midi-actions.ts:356` — `const hold = step.hold ?? (scene.duration > 0 ? … : 500)` ;
- `PerformanceView.tsx:1920` (VCButtonWidget) — même logique `step.hold ?? scene.duration` ;
- `PerformanceView.tsx:390-395` (timeline ShowManager) — `cycleDur = Σ(fadeIn+hold+fadeOut)`, `stepDur = step.fadeIn+step.hold+step.fadeOut`.

Donc **pas de double-comptage** : le tempo effectif est correctement piloté par
`hold = 60000/speedBpm` (auto-loops.ts:468). Le champ `speed` est un **champ mort /
trompeur** : si un futur moteur venait à l'honorer (ou si l'UI « éditeur de chaser »
l'affiche comme source de vérité), on obtiendrait un double tempo. Le seul levier de
tempo externe réel est le MIDI clock (`clockDurationScale()` × `120/clockBpm`,
midi-actions.ts:282/353), qui re-scalle `hold` quand un clock MIDI tourne.

→ **Classification : [MOYEN]** champ `speed` mort + triple encodage du timing. À
défaut de le brancher, il faut soit le supprimer, soit documenter que `hold` fait foi.

---

## 2. Génération — palettes & contraste

**`CHASE_COLORS` (petit générateur) reproduit exactement le défaut historique
« couleurs quasi identiques »** (auto-loops.ts:59) :

```ts
[168, 85, 247],   // violet
[139, 92, 246],   // violet quasi identique
[192, 132, 252],  // violet clair
[237, 232, 220],  // ivoire
```

Distances via la métrique interne `colorDistance` (dmx-color.ts) :
- couleur0 ↔ couleur1 ≈ **43** (quasiment imperceptible — même teinte, même luminosité) ;
- couleur1 ↔ couleur2 ≈ **110** (même famille violette, léger éclaircissement) ;
- couleur2 ↔ couleur3 ≈ **217** (seul vrai contraste, vers l'ivoire).

Conséquence : un color-chase par défaut (4 steps) est perçu comme « du violet qui
respire » avec un flash ivoire occasionnel — pas un chase de couleurs. Avec 2
fixtures adjacentes (cas courant), les steps 0→1 (violet/violet) sont invisibles.
Le test `auto-loops.test.ts` « rotates the color chase » ne vérifie que les valeurs
numériques, jamais la perception.

**`PALETTES` du library (auto-loops.ts:~100)** : 5/6 palettes sont bien contrastées
(`rainbow`, `warm`, `cool`, `party`, `white`). Mais l'entrée **`violet` réutilise le
même jeu défectueux** que `CHASE_COLORS`. → défaut non corrigé côté catalogue pour
cette palette.

→ **Classification : [MOYEN]** (qualité visuelle décevante, pas un crash). Correctif :
seuil de contraste (ex. Δ ≥ 60-80 entre couleurs adjacentes) et remplacement de la
famille violette.

---

## 3. Edge cases

### 3.1 Fixtures avec `rgbSegments` vides → **bloquant pour movement/strobe**
`buildMovementLoop` (auto-loops.ts:168) n'écrit que `panOffsets`/`tiltOffsets` +
`intensityOffset=255` + `shutterOffset=255`. **Aucun RGB.** De même `buildStrobeLoop`
(auto-loops.ts:233) n'écrit que intensity+shutter.

Un moving-head RGB (le cas le plus courant de « mover ») a pour unique source de
lumière ses canaux RGB : la loop movement **bouge la tête mais n'émet rien** (RGB à 0
= noir). Pire : `midiStopChaser` fait un `flushZeros` des canaux de l'ancien chaser
(midi-actions.ts ~:475), donc même en enchaînant color-chase → movement, le RGB
retombe à 0 et la tête s'éteint. Idem pour un strobe sur un mover RGB.

→ **Classification : [SÉVÈRE]** — cause la plus probable du « ça ne fonctionne pas
normalement ». Correctif : injecter une couleur de remplissage (blanc ou couleur de
palette) dans les frames movement/strobe pour les fixtures RGB.

### 3.2 Multi-univers — collision d'adresses absolues
Les frames utilisent l'adresse **absolue** `pf.startAddress + offset`
(`absAddr`, auto-loops.ts ~:91), et `SavedScene.channels` est un
`Record<number, number>` **sans dimension universe** (showStore.ts:56-67).
`dispatchChannelsByFixture` (dmx-helpers.ts) re-diffuse une adresse vers *toutes* les
fixtures dont la plage la contient. Si deux fixtures de **deux univers différents**
partagent des plages d'adresses (très courant : chaque universe démarre à 1), leurs
clés se **collisionnent** dans la frame : dernier `put()` gagne, et le chase de
couleurs perd sa rotation (les deux fixtures affichent la même couleur).

→ **Classification : [MOYEN]** (hérité du modèle de scène mono-universe, latent tant
qu'on est en mono-universe, réel en multi-universe). À documenter / corriger au niveau
du modèle de scène.

### 3.3 Mover sans dimmer → OK (pas de crash)
`analyzeChannels` gère `def` undefined (`def?.modes[pf.modeIndex]?.channels ?? []`,
dmx-channel.ts) → analyse vide, fixture simplement ignorée des loops. Pas de crash.
Fixture avec def manquante → exclue silencieusement (un seul `console.log`).

### 3.4 Strobe via `shutterOffset` → **fréquence incohérente**
`buildStrobeLoop` a 2 steps et le tempo est « steps/minute » : cycle on/off =
`2 × 60000/speedBpm`. Avec `speeds = [80…170]` (auto-loops.ts:342), ça donne
**0,67–1,4 Hz** — un clignotement lent, pas un strobe. De plus, écrire `shutter`
0/255 bascule entre « fermé/ouvert » ou « plage de vitesse de strobe » selon la
fixture : sémantique incohérente combinée au toggle d'intensity.

→ **Classification : [MOYEN]** — le « strobe » n'en est pas un.

### 3.5 Fixtures désactivées → OK
`analyzeTiers` saute `pf.enabled === false` (auto-loops.ts:266). Testé et conforme.

### 3.6 Tier « other » → OK
`TIER_ORDER` inclut `'other'` (auto-loops.ts:48) ; le tier est itéré normalement.

### 3.7 Color-wheel uniquement (spot/scanner) → **aucun loop couleur**
`analyzeChannels` calcule `wheelOffset`/`wheelCaps`, mais auto-loops ne teste que
`rgbSegments` (filtre `rgb` auto-loops.ts:302 et :360). Une fixture à roue de couleur
(reposant sur `wheelCaps`) n'obtient que le movement, jamais de loop couleur.
→ **[MINEUR]** capacité analysée mais jamais exploitée.

### 3.8 Discontinuité du dimmer-pulse
`buildDimmerPulse` (auto-loops.ts:203) : sinus 8 steps 0→255→0 ; le dernier step
(t=0,875) vaut ~37, puis reboucle sur 0. Légère discontinuité. → **[MINEUR]**.

---

## 4. Cycle de vie — purge & unicité des ids

- `purgeAutoLoops` (auto-loops.ts ~:495) supprime les scènes du folder `auto-loops`
  **puis** les chasers dont un step référence ces scènes (ordre correct : chasers
  d'abord). Idempotent. → **[OK]**.
- Deux loops ne partagent jamais d'ids de scènes : `createScene` génère un id
  unique (`scn-<ts>-<rand>`, showStore.ts). Pas de collision possible.
  → **[OK]**.
- Les ids de loops du library sont uniques par appel (`loop.id = ${loop.id}-${seq++}`,
  auto-loops.ts ~:402), stable pour un seed donné. → **[OK]**.
- **Limite [MINEUR]** : `purgeAutoLoops` supprime tout chaser (y compris manuel) qui
  référence une scène auto, et toute scène manuelle que l'utilisateur aurait rangée
  dans le folder « auto-loops ». Risque faible mais réel.
- **Limite [MINEUR]** : `materializeAutoLoops` n'est pas idempotent en soi (pas de
  purge interne) ; si appelé sans purge préalable, il duplique scènes/chasers. Le
  panel purge avant (AutoLoopsPanel.tsx `handleToggle`), donc OK en pratique.

---

## 5. Couverture des tests (`src/__tests__/auto-loops.test.ts`)

**Couvert :**
- generateAutoLoops : patch vide, groupement par tier, écriture en adresses
  absolues, rotation du chase, centrage movement, skip des disabled, ré-exécution
  pure, loops par tier.
- Matérialisation : tagging folder, idempotence du refresh, préservation des scènes/
  chasers manuels, purge.
- Library : variété, déterminisme par seed, skip disabled/tiers vides, ids uniques.

**Manquant (pertinent pour la mission) :**
1. **Lecture temps réel / speed-hold** : aucun test ne vérifie que
   `hold = 60000/speedBpm` pilote le tempo, ni que `chaser.speed` est (ou non)
   consommé par `midiPlayChaser`. Le bug « speed mort » est donc invisible au CI.
2. **Strobe** : `generateAutoLoops` n'émet jamais `strobe` (seuls cc/mv/dp,
   auto-loops.ts:308-310) alors que `AutoLoopKind` le déclare (auto-loops.ts:19).
   `refreshAutoLoops` (chemin « petit générateur ») ne produira donc jamais de
   strobe. Incohérence non testée.
3. **Movement/strobe sans couleur** : aucun test ne vérifie qu'un loop movement ou
   strobe éclaire réellement un mover RGB (i.e. écrit un canal de couleur). Le bug
   [SÉVÈRE] §3.1 passe au travers.
4. **Fixtures color-wheel** et **def manquante** (`defs.get` → undefined) : non
   testés (bien qu'inoffensifs).
5. **Multi-univers / collision d'adresses** : non testé.
6. **Contraste de palette (ΔE)** : non testé.
7. **Direction bounce/backward** : stockée, jamais vérifiée côté moteur
   (`nextStepIndex`, midi-actions.ts) dans le contexte des loops.
8. **Floor du hold (50 ms)** et **discontinuité dimmer-pulse** : non testés.

---

## Verdict

Le moteur est **architecturalement sain** : fonctions pures, séparation
génération/matérialisation, cleanup idempotent, gestion correcte des tiers/disabled,
multi-head pan/tilt exploité. Mais il n'est **pas suffisant tel quel** pour un widget
Performance, pour trois raisons :

1. **[SÉVÈRE]** Les loops movement et strobe n'écrivent jamais de couleur → **invisibles
   sur tout fixture RGB** (le cas dominant des moving-heads). C'est le point à
   corriger en priorité (injecter une couleur de remplissage).
2. **[MOYEN]** La palette par défaut `CHASE_COLORS` (et `PALETTES.violet`) a un ΔE
   quasi nul entre 3 de ses 4 couleurs → chase « statique » décevant. Il faut un
   contrôle de contraste.
3. **[MOYEN]** Le `chaser.speed` est un champ mort + triple encodage du timing, et le
   « strobe » est en réalité un clignotement 0,7–1,4 Hz. À clarifier (brancher `speed`
   ou le retirer ; vraie sémantique strobe via la plage de vitesse du shutter).

Les points [SÉVÈRE]/[MOYEN] ci-dessus + les gaps de tests (surtout speed/hold temps
réel et l'émission de couleur) doivent être traités avant de considérer le moteur
fiable pour un widget Performance. Le reste (lifecycle, ids, edge cases disabled/other/
def manquante) est correct.
