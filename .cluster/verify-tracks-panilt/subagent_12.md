# Audit exploitation pan/tilt — subagent 12

**Date** : 2026-08-27 — **Projet** : Light Maestro (Electron/React/TS)
**Méthode** : lecture des fichiers actuels (numéros de ligne vérifiés) + exécution réelle de l'analyseur via un test vitest temporaire (placé dans `src/__tests__/`, **supprimé après exécution**, aucune trace dans `git status`). Aucun fichier du projet modifié.
**Référence** : `.openclaw/notes/multi-pan-tilt.md` (cas Tonio 6 arm, pièges connus).

> Note de structure : l'analyseur a été **fusionné** dans `src/engine/fixture-analyzer.ts` (les anciens `dmx-cues.ts::analyzeFixture` et `dmx-channel.ts::analyzeChannels` n'existent plus que comme adaptateurs, respectivement L587 et L579). `dmx-channel.ts` est un fichier mort (voir 🟡-2).

---

## ✅ Vérifié OK

### 1. Collecte des offsets — TOUS les bras, fine exclus
- `src/engine/fixture-analyzer.ts` **L400-411** :
  - `case 'Pan'` : premier canal → `panOffset`, les suivants → `panOffsets.push(off)` ; un canal dont le nom matche `/\bfine\b/i` est **exclu** des bras et capturé comme `panFineOffset` (L405-406). Même logique pour Tilt (L410-411). Conforme à la règle « un canal nommé fine n'est PAS un bras ».
- **Preuve par exécution réelle** (vitest temporaire, 3/3 tests passés) :
  - Tonio 6 arm (22 canaux, 1 Pan « X Motor » + 7 Tilts « Bee-eyemotor » + « Motor 1-6 ») → log réel du module : `panOffsets: [0] tiltOffsets: [2,3,4,5,6,7,8]` — **exactement** la valeur attendue par la note.
  - Fixture 16-bit synthétique (Pan/Pan Fine/Tilt/Tilt Fine/Tilt 2/Tilt 2 Fine) → `panOffsets:[0]`, `tiltOffsets:[2,4]`, `panFineOffset=1`, `tiltFineOffset=3` (les 2 fine exclus des bras, le 2ᵉ tilt bien gardé comme bras).
  - Fixture asymétrique 1 pan + 3 tilts → `panOffsets:[0]`, `tiltOffsets:[1,2,3]`.
- `src/engine/dmx-movement.ts` : n'analyse pas les fixtures (pas nécessaire — il fournit `clampPanToStage`/`clampTiltToStage` L4-12, `getSmartMovement` L35, `spatialPhaseFor` L82). La sélection de mouvement est au niveau fixture, les bras sont gérés par les boucles moteur.
- `src/engine/autoloop-runtime.ts` **L61-62** : `channelMap` avec TOUS les bras (`pan`, `pan2`… / `tilt`, `tilt2`…) — export SoundSwitch multi-bras ✅.
- `src/engine/autoscript-generator.ts` **L318-321** : filtre tous les bras (`/^pan\d*$/`, `/^tilt\d*$/`) ✅.

### 2. motorCount — boucle moteurs pan ET tilt, cas asymétriques sûrs
- `src/hooks/dmx-playback.ts` **L963** (tick live) et **L1461** (computeDmxForCue) : `const motorCount = Math.max(panCount, tiltCount, 1)`.
- Écriture des deux axes sur chaque moteur avec **guardes par axe** :
  - Tick : L969 (EFX), L973 (EFX track override), L1055 (`if(m<panCount)`), L1062 (`if(m<tiltCount)`) — dans la boucle `for(m=0;m<motorCount;m++)` L1038.
  - compute : L1483 (boucle), L1537/L1542 (guardes).
  - Fallback amplitude=0 : **tous** les bras à 128 — tick L1080-1081 (`for(const po of fa.panOffsets)… for(const to of fa.tiltOffsets)`), compute L1549-1550. Jamais seulement le 1ᵉʳ canal.
- `src/engine/autoscript-generator.ts` **L332** : `motorCount = Math.max(panCount, tiltCount, 1)`, `phaseStep = 2π/motorCount` — même règle.

### 3. Cues générées — pan/tilt sur TOUS les offsets
- `src/hooks/dmx-cues.ts` **L855-857** (pan) et **L875-878** (tilt) : boucle `for (const po of fa.panOffsets.length > 0 ? fa.panOffsets : [fa.panOffset])` → écrit la valeur sur **tous** les bras, clampée `Math.max(0, Math.min(255, …))`. Idem tilt.
- `src/engine/autoscript-generator.ts` **emitPositionKeys L314-373** : un `ChannelKey` par bras **avec phase décalée par moteur** (`cue.phase + m * phaseStep`, effet vague) ; pan unique = « pan master » écrit une seule fois (L357-359), sinon boucle sur tous les pans (L361-368) ; boucle tilt indépendante (L346-352) — le générateur le plus complet.
- Moteur live : phase décalée par bras `motorPhase = m * (2π/motorCount)` (tick L1038, compute L1484) → effet vague multi-bras en live ✅.

### 4. 3D (Stage3D.tsx) — une tête par tilt, pan master partagé
- **L688-712** : `extraHeads[]` — une tête par tilt supplémentaire (`channelMap.tiltOffsets.slice(1)`), réparties en cercle (`angle = k/n * 2π`, rayon 0.34) et attachées à `armGroup` → elles suivent le pan master.
- **L1633-1641** : pan appliqué **une seule fois** sur l'armGroup (rotation.y, ±270° → `((panVal/255)-0.5)*π*3`) ; tilt par tête avec **limite de vitesse °/s** (`maxPanTiltSpeed`) — L1636-1638 (tête principale) et L1642-1650 (chaque extraHead avec SON `tiltOffset`).
- **L1642-1658** : couleur, intensité, beamCone (opacité/visibilité) propagés aux têtes extra.
- **L1427-1431 / L1470-1474** : `beamAngle` (zoom) appliqué aux cones des bras ✅.
- **L1528-1540** : idle sweep appliqué à la tête principale ET aux extraHeads (L1535-1537) ✅.
- **L2536-2558** : `fitMountRotation` (compensation sol/plafond) propagée aux têtes extra (`eh._mountTilt = f3d._mountTilt`) ✅.
- **L1515-1516** : channelMap override → tous les pan/tilt offsets à 128 ✅.
- **Cohérence DMX** : le 3D lit `data[baseAddr + cm.panOffset]`, `data[baseAddr + cm.tiltOffset]` et `data[baseAddr + eh.tiltOffset]` — les **mêmes offsets** que le moteur écrit (L1630-1645) → le mouvement affiché correspond au DMX envoyé.

### 5. Limites — clampées par moteur, valeurs toujours 0-255
- `src/engine/dmx-movement.ts` **L4-12** : `clampPanToStage`/`clampTiltToStage` — clamp selon position de fixture, retour toujours dans [0,255].
- Tick live **L1052-1059** : `panLimit`/`tiltLimit` (panTiltLimitsRef, demi-amplitude, L602) appliqués **dans la boucle moteur** (`pv = Math.max(128-panLimit, Math.min(128+panLimit, pv))`) → limites par moteur ✅. Raw clampé 0-255 (L1056/L1063).
- Aucun overflow : clamp 0-255 présent à chaque point d'écriture — tick L1056/L1063, compute L1538/L1543, `computeMovement` dmx-cues L309-310, `computeDmxCues` L857/L878, `clampDmx` autoloop-types L145-147, `computePan`/`computeTilt` autoloop-types L165-185.

### 7. Cas asymétriques — pas de débordement
- Toutes les écritures en boucle moteur sont gardées par axe (`m<panCount` / `m<tiltCount`) : tick L969/L973/L1055/L1062, compute L1537/L1542. Aucun accès `panOffsets[m]` sans garde.
- autoscript-generator : boucles tilt (L346) et pan (L357-368) indépendantes — sûr si panCount ≠ tiltCount.
- Vérifié par test réel (1 pan + 3 tilts → analyse correcte).

---

## 🔴 Problèmes bloquants

**Aucun.** Tous les bras sont collectés, tous les moteurs sont écrits (avec guardes), les valeurs restent dans 0-255, le 3D rend tous les bras. La règle projet « jamais seulement le 1ᵉʳ canal » est respectée partout (live, crossfade, générateur de cues, autoscript, autoloop, 3D).

---

## 🟡 Non-bloquants / améliorations

### 🟡-1 — Canaux fine : jamais écrits par le moteur live, écriture incorrecte dans le générateur de cues (point 6)
- **Moteur live** (`src/hooks/dmx-playback.ts`) : **aucune référence** à `panFineOffset`/`tiltFineOffset` (recherche exhaustive : 0 occurrence). `chVals` est un Record partiel (L747, L1370) ; `output-arbiter.ts` L95-109 ne conserve que les canaux écrits → les canaux fine ne sont **jamais pilotés** (ils gardent leur valeur initiale, typiquement 0). Résolution effective : **8-bit** (position coarse exacte — pas de position aberrante, le coarse suffit). Le 16-bit n'est simplement pas exploité, et les deux moteurs (live vs cues) sont **incohérents** entre eux.
- **Générateur de cues** (`src/hooks/dmx-cues.ts` **L858-859** pan, **L879-880** tilt) : `channelValues[…fa.panFineOffset] = pan;` — la **valeur coarse (0-255) est écrite dans le canal fine** au lieu du LSB (ou de 128/0). Pour un protocole 16-bit standard (fine = LSB), ça décale la position de `pan/256` de course ; selon firmware, interprétation aberrante possible.
- **Correction précise** :
  - Live (dmx-playback.ts, après chaque écriture coarse des blocs EFX/mouvement, ~L969/L973/L1055-1066 et L1537-1545) : si `fa.panFineOffset !== null` → `chVals[pf.startAddress + fa.panFineOffset] = 128;` (idem tilt) — ou mieux, tracking 16-bit réel : `fine = Math.round((value - coarse) * 256)` avec `coarse = Math.floor(value * 256 / 256)`.
  - dmx-cues.ts L858-859 / L879-880 : remplacer `= pan;` par `= 128;` (milieu du pas) ou par le LSB si l'on veut du vrai 16-bit.

### 🟡-2 — `src/engine/dmx-channel.ts` : fichier mort (analyseur partiel périmé)
- Ancien `analyzeChannels` (L31-41) : collecte les bras mais **sans** panFineOffset/tiltFineOffset/panOffset uniques et **sans** les cas spéciaux (laser, RGB, shutter hybride). Il n'est **plus importé nulle part** (seules des références en commentaire dans fixture-analyzer.ts L4/L121/L285…). Risque : qu'un futur import le réactive par erreur. → Supprimer ou le transformer en ré-export pur vers fixture-analyzer.

### 🟡-3 — `computeDmxForCue` (crossfade) n'applique pas les panTiltLimits (point 5)
- Le tick live applique `panTiltLimitsRef` par moteur (L1052-1059) mais `computeDmxForCue` (signature L1322-1355) ne reçoit **pas** le ref → pendant un crossfade, les snapshots intermédiaires peuvent dépasser la demi-amplitude configurée (les valeurs restent 0-255, donc pas d'overflow, mais la limite utilisateur est violée pendant le mix).
- **Correction** : passer `panTiltLimits` en paramètre de `computeDmxForCue` (l'appelant est à L682-684) et appliquer le même clamp dans les branches L1537-1545.

### 🟡-4 — Générateur de cues (computeDmxCues) : pas de phase par bras
- dmx-cues.ts L855-878 : la même valeur est copiée sur tous les bras (pas de `motorPhase`), contrairement au moteur live (L1038) et à autoscript (L333/L349). Les presets générés font bouger tous les bras **en phase** au lieu de l'effet vague. → Appliquer `phase = m * 2π/motorCount` dans le calcul du mouvement par bras.

### 🟡-5 — EFX override : tous les bras en phase (choix de design)
- Tick L969 : l'EFX (effet édité sur timeline) écrit la même valeur sur tous les bras (`efxPan`/`efxTilt` uniques) — pas d'effet vague par bras quand un EFX est actif. Comportement acceptable (l'EFX est un effet global), à documenter.

### 🟡-6 — 3D : extraHeads ne couvre que les TILTS supplémentaires
- Stage3D L689 : `extraTilts = tiltOffsets.slice(1)` — design « pan master partagé » (conforme à la note Tonio). Une fixture à **plusieurs PANS indépendants** (pan2/pan3 sans tilts multiples) n'aurait pas de rendu 3D par bras pan. Cas non couvert par la note ; à traiter si une telle fixture apparaît.

### 🟡-7 — Tests : aucun test multi-bras dans la suite
- `src/__tests__/gencues.test.ts` (82 it) et les autres tests ne vérifient **pas** panOffsets/tiltOffsets multi-bras. La preuve d'exécution de cet audit est passée via un test jetable (supprimé). → Ajouter un test permanent (Tonio : `[0]`/`[2..8]`, 16-bit : fine exclus, asymétrique) pour verrouiller la règle.

---

## Verdict

**Les 7 points demandés sont vérifiés et fonctionnels** : collecte multi-bras (y compris le cas Tonio 6 arm validé par exécution réelle), motorCount avec guardes asymétriques, cues multi-bras, 3D une tête par tilt avec pan master, limites par moteur sans overflow, cas asymétriques sûrs. **Aucun problème bloquant.** Les 🟡 se concentrent sur les canaux **fine** (jamais écrits en live — résolution 8-bit — et valeur coarse écrite dans le fine par le générateur de cues), l'absence de panTiltLimits dans le crossfade, et la perte de l'effet vague dans le générateur de cues statiques.
