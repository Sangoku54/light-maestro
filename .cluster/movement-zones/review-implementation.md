# Revue d'implémentation — Movement Zones

Revue adverse technique du diff non committé (HEAD propre). Fichiers audités :
`src/engine/dmx-movement.ts`, `src/stores/showStore.ts`, `src/hooks/dmx-playback.ts`,
`src/views/Stage2DEditor.tsx`, `src/views/TrackTimeline.tsx`.

Conventions vérifiées dans le code existant (source de vérité) :
- **Pan** : DMX 128 = avant local (0°), 0 = −270°, 255 = +270° (`Stage3D.tsx:1610` → `((panVal/255)-0.5)*π*3`).
- **Tilt** : DMX 128 = 0°, 0 = −90°, 255 = +90° (`Stage3D.tsx:1618` → `((tiltVal/255)-0.5)*π`), soit ≈ 0,706°/DMX sur 128 pas.

---

## A. Moteur — `clampPan` / `clampTilt` / `clampToZone`

**Verdict : OK**

- `clampPan` (`dmx-movement.ts:61-65`) : `if (!fp) return raw;` → `if (fp.zone) clamp zone` → sinon `clampPanToStage(raw, fp.x)`. L'ordre « zone > clamp scène > raw » est correct.
- `clampTilt` (`dmx-movement.ts:68-72`) : idem, symétrique.
- `clampToZone` (`dmx-movement.ts:53-58`) : min/max correct (`Math.max(min, Math.min(max, v))`) + `Math.round`. Aucun fallback scène (conforme au contrat documenté « pure min-max, no stage fallback »).
- **Non-régression vérifiée** : quand `zone` est absent (undefined) ou `null`, `fp.zone` est falsy → retombe exactement sur `clampPanToStage`/`clampTiltToStage` (ancien comportement). Quand `fp` est undefined → retourne `raw` (ancien code : `fp ? clamp... : raw`). Aucune différence de sortie pour les données sans zone.
- Note mineure : `clampPan`/`clampTilt` retournent `raw` **non arrondi** quand `fp` est undefined ; mais les deux sites d'appel passent déjà un `raw = Math.round(...)` (`dmx-playback.ts:993/997` et `1337/1341`), donc aucun changement de précision.

## B. Presets — cohérence des plages

**Verdict : OK (fonctionnel) + 2 points à clarifier**

- **Pan directionnel** : sol gauche `128→255` (avant local → +270°), sol droite `0→128` (−270° → avant local), sol centre `64→192` (centré sur 128). Cohérent avec la convention pan énoncée. ✓
- **Tilt** : sol `128→255` = 0°→+90° (≈ 0,709°/DMX), pont `0→128` = −90°→0° (≈ 0,703°/DMX). Cohérent avec la conversion tilt ±90°. ✓
- **Neutre 128** : toutes les presets incluent 128 dans les deux plages pan ET tilt → le neutre reste toujours dans la zone. ✓

Points à clarifier :

1. **`rear-truss` et `front-truss` sont des doublons fonctionnels** (`dmx-movement.ts:42-43`) : pan `64–192`, tilt `0–128` identiques, seule la valeur `dirDeg` (90 vs 270) diffère. En DMX, « Pont arrière » et « Pont avant » imposent exactement la même contrainte. Si l'intention était deux couvertures distinctes (avant-scène vs fond de scène), les plages devraient diverger ; sinon le doublon prête à confusion.
2. **Incohérence cosmétique de `dirDeg`** : le commentaire de l'interface (`dmx-movement.ts:31`) dit « 90 = down/audience », mais dans `Stage2DEditor` le `heading` 0 pointe vers le **haut** du canvas (`Stage2DEditor.tsx:332-339`, `cos(hRad−π/2)`) et est documenté « 0 = front (toward audience) ». Sous la convention « audience = bas » : rear-truss (90) ✓ et front-truss (270) ✓ mais floor-center (270 = fond) ✗. Sous la convention « audience = haut » : floor-center ✓ mais la paire truss est inversée. `dirDeg` n'affecte que le pictogramme (aucun impact DMX) → cosmétique uniquement.

## C. Câblage `dmx-playback` — zone appliquée partout ?

**Verdict : OK (câblage cœur correct) + notes sur les chemins qui échappent**

- **Deux sites de clamp** : tick `useDmxPlayback` (`dmx-playback.ts:994/998`) et `computeDmxForCue` (`dmx-playback.ts:1338/1342`) passent tous deux par `clampPan`/`clampTilt`. ✓
- **Deux branches EFX** :
  - `efxMap` (`dmx-playback.ts:919-924`) : clamp inline min/max + round sur les deux axes. ✓
  - `efxPtOverrides` (`dmx-playback.ts:926-931`) : `clampToZone(ept.pan, ept.tilt, zone0)`. ✓
- **Tous les offsets** : les deux branches itèrent `m < motorCount` (max pan/tilt) et gardent `m < panCount` / `m < tiltCount`. ✓ (conforme à la règle multi-pan/tilt du projet).
- **Neutre 128** : branche `efxMap` — `v = isNaN ? 128 : valeur` puis clampé ; 128 ∈ toutes les presets → l'état « off » ne fuit pas hors zone. ✓

Chemins qui échappent encore à la zone (à clarifier, aucun n'est une régression) :

1. **Branche « off »** (`dmx-playback.ts:1000` dans le tick, `1346-1347` dans `computeDmxForCue`) : écrit `128` **brut**, sans passer par `clampPan`/`clampTilt`. Bénin aujourd'hui (128 ∈ toutes les presets), mais deviendrait un bug si une future preset excluait 128.
2. **Aperçus hors playback principal** : `PerformanceView.tsx:1286` et `:1805`, `QuickShowView.tsx:134` et `:2215` appellent `computeDmxForCue` avec `fixturePositions = undefined` → pas de zone (ni de clamp scène, comportement pré-existant). De plus `QuickShowView.tsx:142-144` réapplique les overrides pan/tilt EFX **sans** clamp de zone.
3. **`chaserTakeover`** (`dmx-playback.ts:1388-1399`) : écrit les valeurs de scène (pan/tilt inclus) directement, sans clamp de zone.

## D. Type / portée / persistance

**Verdict : OK**

- `fixturePositions` local = `fixturePositionsRef?.current` (`dmx-playback.ts:563`), en portée pour tout le tick (utilisé `:645`, `:917`, `:994`, `:998`). ✓
- Paramètre `fixturePositions` de `computeDmxForCue` (`dmx-playback.ts:1148`) en portée, utilisé `:1338/:1342`. ✓
- Type : `FixturePos.zone` (`showStore.ts:170`) `{ panMin; panMax; tiltMin; tiltMax } | null`, structurellement identique à `MovementZone`. Compatible avec `clampPan`/`clampTilt` (objet de lookup, pas un littéral frais → pas de contrôle de propriétés en excès). ✓
- Persistance : `fixturePositions` est sérialisé tel quel (`JSON.stringify(getState().fixturePositions)`) dans `App.tsx:92`, `ShowManager.tsx:917`, `DesignView.tsx:6446/6505`, `PerformanceView.tsx:1676`. `zone` est donc inclus automatiquement ; `zone: null` est préservé ; les anciens projets sans `zone` → `undefined` → fallback clamp scène. ✓
- `setFixturePosition` (`showStore.ts:572-576`) fusionne `{ ...existant, ...pos }` → `{ zone: null }` efface correctement, et l'affectation d'un objet zone le remplace. ✓

## E. UI `Stage2DEditor` — sélecteur de zone

**Verdict : à corriger (détection d'état actif ambiguë)**

- Attribution : bouton preset → `setFixturePosition(id, { zone: {...} })` (`Stage2DEditor.tsx:571-573`), fusion correcte. ✓
- Effacement : bouton « ∅ Aucune » → `setFixturePosition(id, { zone: null })` (`:596`). ✓
- **Détection d'état actif non fiable** (`Stage2DEditor.tsx:563-566`) : compare les 4 valeurs `panMin/panMax/tiltMin/tiltMax` via `ids.every(...)`. Or `rear-truss` et `front-truss` ont des plages **identiques** → les deux boutons s'allument simultanément quand l'un est actif. Le modèle ne stockant que les 4 ranges (pas l'id de preset ni `dirDeg`), il est impossible de distinguer les deux. → stocker l'id de preset (ou différencier les plages) pour lever l'ambiguïté.
- **Géométrie SVG du cône** (`Stage2DEditor.tsx:18-33` et `579-584`) : le path `M apex L x1,y1 A r r 0 0 1 x2,y2 Z` est correct — `large-arc-flag=0` (cône < 180°), `sweep-flag=1` (sens horaire en coordonnées SVG y-vers-le-bas). Aucun NaN (size fixé à 26). Le cas `locked` dessine une ligne en pointillés. Aucun bug de rendu dans le calcul.
- Orientation du pictogramme : voir B.2 (cosmétique).

## F. `TrackTimeline` — contraste renforcé

**Verdict : OK**

- **Pas de fuite d'état canvas** : la bande de section modifie `ctx.font` (`:1895`), `ctx.fillStyle` (`:1897/:1899`) et `ctx.textAlign` (`:1900`). Vérification exhaustive : **chaque** `fillText` ultérieur du draw est précédé de son propre `ctx.font` (+ `ctx.textAlign`/`ctx.fillStyle` quand nécessaire) — lignes `1954-1956`, `1961-1962`, `1998-1999`, `2003-2004`, `2008-2009`, `2056-2057`, `2072-2073`, `2154-2155`, `2194-2195`, `2259-2261`, `2357-2359`, `2465-2467`, `2471-2478`, `2502-2505`, `2522-2523`, `2562-2563`, `2617-2620`, `2637-2638`, `2694-2697`, `2747-2750`, `2767-2768`, `2811-2813`, `2864-2867`, `2884-2885`, `2928-2930`, `2983-2986`, `2998-2999`, `3041-3044`, `3095-3097`. Aucun état ne fuit dans le dessin suivant. `textAlign='left'` est de toute façon la valeur par défaut du canvas. ✓
- **Syntaxe couleur 8 chiffres valide** : `SECTION_COLORS` (`audio-analysis.ts:86-90`) ne contient que des hex 6 chiffres (`#3b82f6`, `#8b5cf6`, …). `s.color + '40'` → `#3b82f640` (RRGGBBAA, 25 % — 0x40 = 64/255 ✓) et `s.color + 'd9'` → `#3b82f6d9` (85 % — 0xd9 = 217/255 ✓). Le pattern `s.color + '26'` pré-existait déjà (ancienne bande), donc validé en production (Electron/Chromium). ✓
- **Garde `sw <= 0`** (`:1887`) : évite un `fillRect` à largeur négative qui existait potentiellement avant. Amélioration. ✓

---

## À corriger avant commit (priorisé)

1. **[Élevé] `Stage2DEditor` — détection d'état actif ambiguë** (`Stage2DEditor.tsx:563-566`) : `rear-truss` et `front-truss` partagent des plages identiques → les deux boutons s'illuminent ; et le modèle `zone` (4 ranges seules) ne peut pas les distinguer. Options : stocker l'id de preset (ou `dirDeg`) dans `FixturePos.zone`, ou donner des plages distinctes à « Pont avant » / « Pont arrière ». Corrélat : ces deux presets sont des **doublons fonctionnels** en DMX (`dmx-movement.ts:42-43`).

2. **[Moyen / à clarifier] Chemins qui échappent à la zone** : aperçus `PerformanceView` / `QuickShowView` (fixturePositions = undefined) et `chaserTakeover` (`dmx-playback.ts:1388-1399`). Décider explicitement si la zone doit y être appliquée. Pas de régression (le clamp scène y était déjà absent), mais incohérence silencieuse.

3. **[Bas / à clarifier] Incohérence cosmétique `dirDeg`** : convention « audience = bas » (commentaire `dmx-movement.ts:31`) vs « audience = haut » (plan 2D `Stage2DEditor.tsx:332-339`). `floor-center` (`dirDeg 270`) et la paire truss ne peuvent pas être simultanément corrects. Aucun impact DMX.

4. **[Bas / note] Branche « off »** (`dmx-playback.ts:1000` et `1346-1347`) écrit `128` brut sans clamp. Bénin tant que 128 ∈ toutes les presets ; à sécuriser si une preset excluant 128 est ajoutée (router ce 128 par `clampPan`/`clampTilt`).

REVIEW_DONE
