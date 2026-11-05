# Proposition — Auto loops : solution stable + widget Performance

**Statut** : proposition de solution (design + plan), **aucun code modifié**.
**Date** : 2026-08-20 · **Projet** : `light-maestro` (v1.0.12)
**Demande d'origine** : « faire fonctionner normalement les boucles auto » — les jouer depuis
un **widget de la vue Performance**, pour se passer d'un contrôleur DMX externe (« tout en 1 »).

---

## 1. Objectif

Un **widget « Loop auto »** dans la Virtual Console de Performance, qui joue une boucle
lumineuse autonome (sans audio, sans contrôleur externe) de façon **fiable, stable et
prévisible** sur les fixtures patchées.

---

## 2. Problème — pourquoi les boucles « ne jouent pas normalement »

Aujourd'hui, l'onglet « Loops auto » (`AutoLoopsPanel`, dans QuickShow) matérialise chaque loop
en scènes + un chaser, puis le lit via `midiPlayChaser()` (`midi-actions.ts`). Ce chemin **atteint
bien le hardware** (arbitre → SharedArrayBuffer → worker 30 FPS), mais le rendu est instable.

**Root causes (audit croisé 4 axes) :**

| # | Gravité | Cause | Où |
|---|---------|-------|-----|
| R1 | 🔴 SÉVÈRE | **Concurrence de moteurs** : l'autoscript `useDmxPlayback` reste monté en permanence dans QuickShow (`QuickShowView.tsx:1188-1199`, `:2299`) et réécrit tout l'univers chaque frame sur `quickshow`, pendant que le loop écrit en `midi-chaser`. Deux écrivains non synchronisés sur les mêmes fixtures → mélange loop+autoscript. | `dmx-playback.ts:349`, `midi-actions.ts:323-403` |
| R2 | 🔴 SÉVÈRE | **Scènes à état partiel** : un loop matérialisé ne contient que `step.channels` (RGB **ou** pan/tilt **ou** dimmer/shutter), jamais un état complet. À l'arrêt de l'autoscript, le buffer ne contient que ~3-6 canaux ; le reste de la fixture garde les **valeurs résiduelles du SAB** (figées) — ou se fait blackouter. | `auto-loops.ts:465-497` |
| R3 | 🔴 SÉVÈRE | **Mauvais moteur de lecture** : `midiPlayChaser` avance par `setTimeout` + RAF (drift d'horloge, pas de synchronisation BPM, sauts discrets tous les `holdMs` ms) au lieu d'une **résolution déterministe par frame**. | `midi-actions.ts:340-403` |
| R4 | 🔴 SÉVÈRE | **Movement/strobe sans couleur** : `buildMovementLoop` et `buildStrobeLoop` n'écrivent aucun canal RGB. Sur un moving-head RGB (le cas dominant), la tête **bouge mais n'émet rien** (noir). | `auto-loops.ts:168`, `:233` |
| R5 | 🟠 MOYEN | **Palette quasi identique** : `CHASE_COLORS` (et `PALETTES.violet`) a 3 couleurs sur 4 à ΔE ≈ 43 → chase perçu comme « statique » (même bug historique que le debug « même couleur »). | `auto-loops.ts:59`, `:100` |
| R6 | 🟠 MOYEN | **`chaser.speed` mort** + « strobe » = clignotement 0,7–1,4 Hz ; triple encodage du tempo (le seul levier réel = `hold` en ms). | `auto-loops.ts:467-485` |

**Conclusion** : les boucles ne sont ni « cassées » ni « absentes » — elles sont **lues par un
moteur parallèle à état partiel qui se dispute les fixtures avec l'autoscript**, au lieu d'être le
seul propriétaire de leurs fixtures dans un moteur frame-locked.

---

## 3. Leçons historiques (invariants à respecter)

Deux refontes déjà annulées (v2/v3 « Boucles d'ambiance », v4 `theme-loop`) ont échoué sur les
**mêmes** erreurs. À ne **jamais** reproduire :

1. **Pas de moteur de loop réinventé en parallèle du moteur chaser** (timing/fade/release déjà testés) — *sauf* que le moteur chaser existant est lui-même dégradé ici (R1/R3), donc on réutilise le **pattern frame-locked** déjà présent (`_startAudioAutoScript`), pas un 3ᵉ moteur de timers.
2. **Jamais écrire une source DMX sans miroiter `appStore.dmx.channelData`** (sinon désync 3D).
3. **Ne pas partager la source `vc`** (un write `vc` = replace-all, il écrase scènes/chasers/autoScript) : source dédiée obligatoire.
4. **`stop()` ≠ blackout inconditionnel** : zéroïser **uniquement si ça jouait**.
5. **Purge/release des sources LTP au stop et à l'unmount** (fuites 100/90/80).
6. **Pas de scope drift** : pas d'« ambiance-classified », de « seed-driven variety », ni de timeline complète. Le besoin = *une boucle simple jouable depuis un widget*.
7. **Une seule représentation canonique** : une loop = une **séquence de frames DMX complètes** par fixture, pas une re-génération dépendante de l'audio.

---

## 4. Solution recommandée

**Un widget Performance `actionType: 'autoLoop'`** qui génère une loop, puis la joue via un
**moteur frame-locked dédié** (pattern `_startAudioAutoScript` **sans l'audio**), sur une **source
DMX dédiée `auto-loop`**, avec **miroir 3D** et **lifecycle strict**.

### 4.1 Ce qu'on réutilise (pas de réinvention)

- Le **générateur** `generateLoopLibrary` / `generateAutoLoops` (`auto-loops.ts`) — corrigé (cf. 4.3).
- Le **modèle de données v1** `AutoLoop` / `AutoLoopStep` (frames DMX concrètes).
- Le **pattern frame-locked** de `_startAudioAutoScript` (`PerformanceView.tsx:1524-1613`) :
  RAF + horloge `performance.now()` + `fireAutoDmx` par frame + mutex `registerAudioPlayback`/
  `stopAllAudioPlayback` — en retirant le bloc `AudioContext`.

### 4.2 Ce qu'on ajoute

**Store (`performStore.ts`)**
- `ButtonActionType` (L32-44) : ajouter `'autoLoop'`.
- `ConsoleWidgetConfig` (L53-92) : champs `loopKind?`, `loopTier?`, `loopSpeedBpm?`,
  `loopDirection?`, `loopSeed?`, `loopPalette?`.

**Vue (`PerformanceView.tsx`)**
- `<select>` d'action (L920-941) : ajouter `<option value="autoLoop">Loop auto</option>`.
  *(⚠️ aujourd'hui `audioAutoScript` n'y figure pas → jamais atteignable ; on ne reproduit pas ce bug.)*
- Bloc config `AutoLoopConfig` (à côté du bloc `audioAutoScript`, ~L1082) : choix kind/tier/BPM/direction/palette.
- `activate()` (L1615) : branche `autoLoop` → `_startAutoLoop(config)`.
- `deactivate()` (L1973) : `_stopAutoLoop()` (release + zéro **seulement si actif**).
- Label bouton (L2075-2080) : `config.label || '⟳ Loop'`.

**Moteur (`_startAutoLoop`, nouveau helper dans PerformanceView)**
- Copie de `_startAudioAutoScript` **sans audio** : RAF, `performance.now()`, index de step =
  `floor(elapsed / holdMs) % steps.length` (déterministe, pas de timers), direction
  forward/backward/bounce.
- **Frames complètes** : chaque frame écrit **tous** les canaux des fixtures ciblées par la loop
  (dimmer + shutter + couleur + pan/tilt) → aucun résidu SAB (règle R2).
- **Source DMX dédiée** : `dmxBridge.registerSource('auto-loop', 'ltp', 75)` (distincte de `vc`),
  écriture via `sendChannelsToHardware(..., 'auto-loop')` **+ miroir `setUniverseData`** (3D).
- **Mutex** : `registerAutoLoop()`/`stopAutoLoop()` — un seul loop actif, démarrage = stop du précédent.
- **Lifecycle** : au stop/unmount → `release('auto-loop')` + `zeroAll` **uniquement si ça jouait**.

### 4.3 Corrections moteur préalables (non négociables)

| Fix | Gravité | Détail |
|-----|---------|--------|
| Couleur de remplissage movement/strobe | 🔴 | `buildMovementLoop`/`buildStrobeLoop` injectent une couleur (blanc ou couleur de palette) sur les fixtures RGB → plus jamais noir (R4). |
| Contraste palette | 🟠 | Remplacer `CHASE_COLORS` et `PALETTES.violet` par des couleurs ΔE ≥ 60 ; ajouter un test de seuil de contraste (R5). |
| Sémantique strobe | 🟠 | Utiliser la plage de vitesse du shutter (valeur 1..255 = fréquence) au lieu du toggle 0/255, si la fixture le supporte ; sinon dégrader proprement en blink rapide (R6). |
| Supprimer/neutraliser `chaser.speed` | 🟠 | Retirer le champ mort ou le documenter `hold` = seule source de tempo (R6). |

### 4.4 Ce qu'on NE fait pas (scope control)

- Pas de persistance de scènes/chasers matérialisés (évite `markDirty` à chaque clic + pollution de
  la liste de chasers). La config du loop vit **dans le widget** (déjà persisté via `.lmproj`).
- Pas de refonte du moteur chaser ni de `useDmxPlayback`.
- Pas de timeline, pas de génération « ambiance-classified », pas de seed-driven variety.
- Pas de changement du modèle de scène multi-univers (R hérité, hors périmètre).

---

## 5. Plan d'implémentation (par étapes testables, en attendant le GO)

1. **Correctifs moteur** (`auto-loops.ts`) : couleur de remplissage (R4), palettes contrastées (R5),
   sémantique strobe + suppression `chaser.speed` (R6). **+ tests unitaires** (contraste, couleur
   sur movement/strobe, sémantique hold).
2. **Store** : `'autoLoop'` dans `ButtonActionType` + champs config.
3. **Moteur `_startAutoLoop`** + enregistrement source `auto-loop` + mutex + lifecycle.
4. **UI widget** : `<select>` + `AutoLoopConfig` + branches activate/deactivate + label.
5. **Tests d'intégration** : résolution de step déterministe (direction, bounce, hold), mutex
   (un seul loop), release/zero uniquement si actif, miroir 3D.
6. **Build + validation visuelle sur le rig** (règle « 2 livraisons non testées max »).

---

## 6. Risques & mitigations

| Risque | Mitigation |
|--------|------------|
| Réintroduire un bug v4 (blackout, source partagée, désync 3D) | Respecter strictement les 3 invariants (source dédiée + miroir 3D + zero-si-actif), mutex unique, tests dédiés. |
| Conflit avec l'autoscript si l'utilisateur revient sur QuickShow | Le widget vit dans Performance (autoscript non monté) ; documenter que loop et autoscript ne coexistent pas. |
| Frames complètes = coût par frame | ~1-3 fixtures ciblées, écriture de ~6-15 canaux/frame → négligeable à 60 FPS. |
| Fixture multi-univers (collision d'adresses absolues) | Hérité du modèle de scène, hors périmètre ; documenté, à traiter séparément. |

---

## 7. Plan de tests

**Unitaires** (`auto-loops.test.ts` étendu) :
- movement/strobe écrivent une couleur sur fixture RGB ;
- contraste palette ≥ seuil ;
- `hold = 60000/speedBpm` pilote le tempo, `chaser.speed` non consommé ;
- direction forward/backward/bounce dans le moteur loop.

**Intégration** (nouveau `auto-loop-widget.test.ts`) :
- résolution de step déterministe depuis `currentTime` (pas de timers) ;
- mutex : démarrer un 2ᵉ loop arrête le 1ᵉʳ ;
- stop/unmount → release + zéro **uniquement si actif** ;
- miroir `channelData` (3D) à chaque frame.

---

## 8. Décision attendue

Recommandation : **GO** sur la solution §4 (widget `autoLoop` + moteur frame-locked + source
dédiée), en commençant par les correctifs moteur §4.3 (indispensables quoi qu'il arrive).

Deux points à trancher par l'utilisateur :
1. **Persistance des loops** : config stockée dans le widget (recommandé) vs matérialisation
   persistée en scènes/chasers (utile si on veut réutiliser les loops ailleurs).
2. **Coexistence QuickShow/Performance** : garder l'onglet « Loops auto » actuel tel quel (avec son
   chemin `midiPlayChaser`), ou le migrer aussi vers le nouveau moteur.
