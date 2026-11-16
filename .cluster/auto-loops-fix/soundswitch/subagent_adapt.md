# Adaptation SoundSwitch Autoloops → Light Maestro (Design A)

**Date** : 2026-08-20 · **Subagent** : ss_adapt (round 1/3)
**Objet** : cartographie concept-par-concept (adopter / adapter / ignorer) entre le système d'Autoloops SoundSwitch et le Design A Light Maestro.

---

## Rappel des invariants SoundSwitch (confirmés)

- Un **autoloop** = une séquence de **scenes complètes** (état total des fixtures : couleur + position + intensité + gobo + shutter) qui boucle.
- Les changements de scene sont **synchronisés au beat/bar** (durée d'une scene exprimée en beats/bars), avec **auto-BPM** (2.9) pour suivre le tempo sans beat grid importé.
- **Fade** : crossfade entre scenes sur N beats.
- **Loop groups** : des loops peuvent être groupés et assignés à des **sections** de morceau (intro/verse/chorus…) — change de loop selon la phrase.
- **Override** : un look manuel ou scripté **prend le dessus** sur l'autoloop (préférence « Autoloop Override » pour arbitrer loop vs script).
- **Strobe intégré** : « Loop Auto Strobe », strobe synchro beat inclus dans le loop.
- **Attribute cues** : modulation d'UN attribut (couleur / position / intensité / gobo / rotation) **superposée** à la scene, pour ajouter de la variation organique sans redéfinir la scene entière.
- **Déclenchement auto** : l'autoloop « prend le relais » quand le morceau n'a **pas de script** (c'est le cœur du produit).

Contraintes Light Maestro qui bornent l'adaptation : **pas de DJ logiciel externe, pas de beat grid importé, pas de timeline** ; mais **analyse audio déjà là** (`analyzeAudioBuffer` → BPM, sections, downbeats) ; scope = « une boucle simple jouable depuis un widget, sans refonte du moteur chaser, sans ambiance-classified ».

---

## Cartographie par concept

### (a) Loop = séquence de scenes / états complets
- **Verdict : ADOPTER** (déjà acté par Design A, mais le générateur v1 ne le fait pas encore).
- **Justification** : une source DMX dédiée `auto-loop` + merge HTP + miroir 3D n'acceptent **que des frames complètes**. Le générateur v1 émet des frames *partielles* (`AutoLoopStep` = `Record<adresse, valeur>` typé par loop) → c'est exactement la maladie qui a produit le bug « RGB résiduel sur OFF » du strobe relevé en review étape 1. SoundSwitch le fait nativement : chaque scene décrit tout.
- **Impact Design A** : Design A a raison (frames complètes), **aucun changement d'architecture** ; mais il faut **monter le générateur au niveau** : chaque step doit assembler une frame totale (dimmer + shutter + couleur + pan/tilt pour toutes les fixtures du loop), y compris l'état OFF (dimmer=0, shutter=0, **RGB=0**). Concrètement : conserver `AutoLoopStep` mais ajouter une étape de **matérialisation** qui fusionne les fills par type en une frame complète avant émission.

### (b) Sync beat/bar vs frame-locked
- **Verdict : ADAPTER** (frame-locked = base, beat-quantize = optionnel).
- **Justification** : sans beat grid importé ni timeline, la synchro beat/bar complète de SoundSwitch est hors de portée et coûteuse. Mais Light Maestro **calcule déjà BPM + downbeats** (`analyzeAudioBuffer`), donc on peut capter l'essentiel (les changements de scene qui « tombent » sur le beat) à très bas coût, sans moteur de beat-grid.
- **Impact Design A** : garder le moteur **frame-locked** tel quel (c'est le bon socle). Ajouter un flag optionnel `beatQuantize` dans la config du loop : quand BPM/downbeats sont disponibles, **snapper la transition de step sur le downbeat le plus proche** au lieu de l'horloge fixe. Pas de refonte, une interpolation d'horloge vers beat.

### (c) Fade entre étapes
- **Verdict : ADAPTER** (fade par **classe de canal**, pas toutes-attributs).
- **Justification** : le fade est ce qui sépare un loop « steppy » d'un loop pro. Mais un crossfade sur pan/tilt produit des balayages mécaniques moches et se bat avec le miroir 3D. SoundSwitch fade tout, mais sur têtes motorisées le mouvement reste « instantané » en pratique. Donc on fadera **intensité + couleur**, et on **snappera** position + shutter.
- **Impact Design A** : ajouter `fadeMs` (ou fraction de step) par loop. Dans le moteur frame-locked, à chaque transition de step, **ramper** la frame précédente vers la nouvelle sur la fenêtre de fade, **uniquement** sur les canaux fadeables (dimmer, RGB/RGBW — pas pan/tilt/shutter). Petit ajout moteur, gros gain visuel.

### (d) Loop groups assignés à des sections
- **Verdict : IGNORER** (pour le périmètre actuel).
- **Justification** : l'assignation section→loop exige un classifieur de sections + une UI de mapping + un mécanisme de switch de loop en cours de morceau. Le scope dit explicitement « une boucle simple » et « sans ambiance-classified ». Les données sections existent (`analyzeAudioBuffer`) mais les câbler vers du switching de loop est un chantier à part entière.
- **Impact Design A** : **aucun**. Le switch de loop reste manuel (widget). Noter : `analyzeAudioBuffer` est l'activateur futur si on décide d'étendre, mais pas maintenant.

### (e) Override / priorité entre sources
- **Verdict : ADOPTER** (la priorité), **ADAPTER** (le mécanisme au modèle source/merge existant).
- **Justification** : le **mutex** de Design A est déjà le bon primitif, mais il faut un **ordre de priorité explicite** entre sources, sinon l'autoLoop peut se battre avec le chaser/script. SoundSwitch arbitre manuel > script > autoloop ; Light Maestro doit encoder le même arbitrage au niveau du mutex, pas seulement dans le merge HTP.
- **Impact Design A** : définir un enum de priorité source (`manual > scripted/chaser > auto-loop`) et faire **céder le mutex** à l'autoLoop quand une source de priorité supérieure devient active (stop/pause du loop, reprise au clear). Le merge HTP continue de gérer la co-présence, mais la **propriété du mutex** respecte la priorité.

### (f) Strobe intégré
- **Verdict : ADOPTER** (déjà un type de loop v1), + **ADAPTER** (strobe beat-sync en option).
- **Justification** : le type `strobe` v1 couvre déjà le « Loop Auto Strobe ». Ce qui manque n'est pas la feature mais la **rigueur des frames** : OFF doit écrire dimmer=0, shutter=0 **et RGB=0** (point de contrôle 4 de la review étape 1, laissé en suggestion). En bonus, un strobe **calé sur le BPM** (déjà dispo) est un gain musical à coût nul.
- **Impact Design A** : minimal. Appliquer la suggestion étape 2 (`putRgbSegments(frame, pf, analysis, [0,0,0])` sur la frame OFF). Optionnel : dériver la cadence strobe du BPM quand il est connu.

### (g) Attribute cues (modulation au sein d'un loop)
- **Verdict : ADAPTER** (composition de primitives, pas de stack générique).
- **Justification** : les attribute cues de SoundSwitch sont la « machine à variation », et les 4 types v1 (`color-chase`, `movement`, `dimmer-pulse`, `strobe`) sont déjà des primitives de modulation d'un attribut. La pièce manquante est la **superposition** : SoundSwitch empile plusieurs attribute cues dans un même loop. Un stack générique est hors scope ; une **composition de 2 primitives existantes** capture l'essentiel.
- **Impact Design A** : ajouter un flag optionnel `compose` (ex. mouvement + color-chase) : **fusionner les frames partielles de deux types en une frame complète** par step (union des adresses, HTP par canal, puis complétion). Coût moyen, payoff visuel élevé. Sinon aucun.

### (h) Déclenchement auto quand pas de script
- **Verdict : ADAPTER** (fallback « idle », pas d'autoscript).
- **Justification** : le déclencheur natif (« pas de script ») ne se transpose pas — Light Maestro n'a ni script ni timeline. Mais l'esprit — un filet qui tourne quand rien d'autre ne pilote les lumières — se transpose en : **si aucune action de priorité supérieure n'est active depuis X secondes, démarrer le loop par défaut**. C'est un fallback d'inactivité, pas une détection d'autoscript.
- **Impact Design A** : ajouter un flag optionnel `autoStartWhenIdle` (+ délai) : quand le mutex est libre depuis X s, le loop configuré par défaut démarre. Bon marché, capte la valeur « il se passe toujours quelque chose ». Opt-in.

---

## Synthèse des verdicts

| # | Concept | Verdict |
|---|---------|---------|
| a | Loop = scenes complètes | ADOPTER |
| b | Sync beat/bar | ADAPTER (frame-locked + beat-quantize optionnel) |
| c | Fade entre étapes | ADAPTER (fade par classe de canal) |
| d | Loop groups → sections | IGNORER |
| e | Override / priorité sources | ADOPTER (priorité) + ADAPTER (mutex) |
| f | Strobe intégré | ADOPTER (+ beat-sync optionnel) |
| g | Attribute cues | ADAPTER (composition, pas stack générique) |
| h | Déclenchement auto | ADAPTER (fallback idle, pas autoscript) |

---

## Recommandation : top 5 des idées SoundSwitch à intégrer dans Design A

Classées par **impact / effort** (impact visuel & robustesse rapportés au coût d'implémentation).

| Rang | Idée | Impact | Effort | Action concrète |
|------|------|--------|--------|-----------------|
| **1** | **Frames complètes + RGB=0 sur OFF** | Élevé (tue les résidus HTP/ghosting, sécurise source dédiée + miroir 3D) | Faible (déjà ~90 % fait en étape 1) | Étendre le fill OFF au strobe (`putRgbSegments [0,0,0]`) + movers à roue de couleur ; matérialiser chaque step en frame totale |
| **2** | **Fade par classe de canal** | Élevé (look pro vs steppy) | Faible-moyen | `fadeMs`/loop ; rampe dimmer+couleur, snap pan/tilt/shutter |
| **3** | **Beat-quantize optionnel** | Élevé (musicalité) | Faible (réutilise `analyzeAudioBuffer`) | Flag `beatQuantize` ; snapper les transitions sur downbeats |
| **4** | **Priorité de sources + mutex cédant** | Moyen-élevé (robustesse, plus de sources qui se battent) | Moyen | Enum `manual > chaser > auto-loop` ; l'autoLoop cède le mutex sur prise de priorité supérieure |
| **5** | **Composition de 2 primitives** | Élevé (variation sans refonte) | Moyen | Flag `compose` ; fusion HTP de 2 frames partielles en une frame complète |

**À ne PAS faire maintenant** : loop groups assignés aux sections (d), synchro beat/bar complète, stack d'attribute cues générique, détection d'autoscript. Ces quatre-là sont soit couverts par un substitut bon marché ci-dessus (b→3, g→5, h→fallback idle), soit hors périmètre (d).

**Ordre de livraison suggéré** : 1 → 2 → 3 (bloc « qualité du loop »), puis 4 → 5 (bloc « intégration & richesse »).
