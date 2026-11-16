# Rapport Analyste — Chaîne « + track dimmer » du QuickShow (priorité vs autoscript)

*Analyse statique, aucun fichier de code modifié. Tous les chemins sont relatifs à `light-maestro/`.*

## (a) Flux complet tracé, fichiers + lignes

### A.1 — Création côté UI (QuickShowView.tsx)

| Étape | Fichier:ligne | Contenu |
|---|---|---|
| Bouton « + track dimmer » | `src/views/QuickShowView.tsx:3615` → `openDimmerTrackModal` (l.2892-2898) | Ouvre le modal de création |
| Création de la track | `handleAddDimmerTrack` l.2815-2828 | `DimmerTrack { id, name, entries: [], targetFixtures: { type: 'all'\|'group'\|'fixture', groupId?, fixtureIds? } }` |
| Insertion d'un bloc dimmer | clic droit sur la lane → `handleDimmerTrackContextMenu` l.2869-2873 → menu `DimmerTrackInsertMenu` (l.1187-1255) → `handleInsertDimmerToTrack` l.2834-2849 | **Entry = `{ time, endTime: time + 10, value (0-100 %), endValue }`** — les sliders du menu sont bornés 0-100 (l.1198, l.1226). Durée fixe de 10 s par insertion. |
| Type UI | `src/views/TrackTimeline.tsx:143-155` | `DimmerTrackEntry { time, endTime, value, endValue? }`, `DimmerTrack { id, name, entries, targetFixtures }` |
| État React → ref moteur | `QuickShowView.tsx:1730-1732` | `dimmerTracksRef.current = dimmerTracks` (useEffect) |
| Injection dans le moteur | `QuickShowView.tsx:2402` | `dimmerTracksRef: dimmerTracksRef as any` passé à `useDmxPlayback` |

### A.2 — Résolution des cibles et valeurs (dmx-playback.ts)

- `DimmerTrackRef` : l.40-48 (même shape que `DimmerTrack`).
- **`computeDimmerTrackOverrides` : l.86-121.** Pour chaque track avec une entry active à `ct` (`currentTime >= e.time && currentTime < e.endTime`, l.93) :
  - cibles `all` → toutes les `patchedFixtures` (l.103) ;
  - cibles `group` → `group.fixtureIds` **sans filtrage sur les fixtures patchées existantes** (l.105) ;
  - cibles `fixture` → `fixtureIds` (l.107) ;
  - interpolation `value → endValue` sur la durée du bloc (l.113-118) ;
  - **la dernière track du tableau gagne** en cas de conflit sur une même fixture (`result.set` l.120).

### A.3 — Moteur live (tick RAF, `useDmxPlayback`)

Ordre exact des écritures sur le canal dimmer d'une fixture, à chaque frame :

1. **l.747-749** — `dimmerOverrides = computeDimmerTrackOverrides(dimmerTracksRef.current, ct, ...)` (une fois par frame). Si aucune track → `null`.
2. **l.760-777** — construction `fixtureTrackMap` (targets des `FixtureTrack` = lanes par fixture).
3. **l.779-800** — `dimmerVal` de base, par fixture, dans cet ordre de priorité interne :
   - bloc `dimmerBlocks` d'une FixtureTrack active (l.781-791, valeur 0-255 brute) ;
   - sinon `active.forcedDimmerVal` (jamais défini par genCues — champ mort) ;
   - sinon **autoscript** : `mapIntensity(active.intensity, effectiveEnergy, pf.tier, tierMultipliers)` (l.796).
4. **l.801-804** — **override « + track dimmer »** : `dimmerVal = Math.round(255 * dimmerOverride.value / 100)` (valeur % → DMX). C'est LA prise de priorité sur l'autoscript, et elle écrase aussi le dimmer des FixtureTracks.
5. **l.805-806** — écriture : si `fa.intensityOffset !== null` → `chVals[startAddress + intensityOffset] = dimmerVal` **inconditionnellement** quand le track est actif (`_dimmerTrackActive`, l.805) ; sinon max-merge (`!chVals[addr] || dimmerVal > chVals[addr]`).
6. **l.808-818** — ⚠️ **bloc « densité par section » (activeTiers)** : si `active.activeTiers` existe et ne contient pas `pf.tier` → `chVals[intensityOffset] = 0`, `chVals[shutterOffset] = 0`, `chVals[strobeOffset] = 0`, gates laser à 0. **S'exécute APRÈS l'écriture du track (l.806) et l'écrase.**
7. **l.886** — re-max-merge du dimmer dans le bloc RGB (ne peut que remonter la valeur).
8. **l.887-889** — fallback fixtures sans canal intensity : dimmer appliqué en **échelle des RGB** (`dScale = dimmerVal/255`), seulement si `rgbSegments.length > 0` **et** une palette couleur a été calculée.
9. **l.947-951** — « soft strobe » : si strobe de cue actif sur une fixture à intensity+shutter, pulse `chVals[intensity] = dimmerVal × pulse` (ne peut que remonter au-dessus de la valeur du track).
10. **l.1162-1185** — takeover des chaser tracks : **supprime tous les canaux** (`delete chVals[a]`) des fixtures couvertes puis réécrit depuis la scène du chaser (l.1172-1175). Bat tout, y compris le dimmer track (par design).
11. **l.1202-1214** — blend de crossfade : mélange `chVals` avec la frame `nextCueDmx` calculée par `computeDmxForCue(..., undefined /* dimmerTrackOverrides */, ...)` (**l.736-741 — `undefined` passé en 9ᵉ argument**). Fenêtre : gap entre cues < 0,3 s, window ≤ 0,15 s (l.671-673).
12. **l.1218-1220** — fadeFactor global de fin de show.
13. **l.1239** — `dmxBridge.push(uniIdx, chVals, arbSource)` → clamp 0-255 (`src/utils/dmx-bridge.ts:161-163`).

### A.4 — Chemin « preset » (Virtual Console / PerformanceView)

- `src/components/SongPresetPlayer.tsx:107` : `dimmerTracksRef.current = preset.dimmerTracks || []` ; même moteur `useDmxPlayback` (l.226-250) avec `arbiterSource: 'song-preset'`. Mêmes forces et mêmes faiblesses.
- `src/views/PerformanceView.tsx:1120` : `dimmerTracks: p.dimmerTracks || []` à la sauvegarde du preset.

### A.5 — Aperçu UI vs live (désalignement prouvé)

- `QuickShowView.tsx:131-134` (`buildPresetDmxCues`) : l'aperçu appelle `computeDmxForCue(cue, ..., dto, ...)` **avec** les overrides dimmer.
- Or `computeDmxForCue` (l.1416-1429) applique bien le track (l.1421-1425 : `dimmerVal = 255 * value / 100`, puis écriture l.1426-1429) **mais ne contient PAS le bloc `activeTiers`** (présent uniquement dans le tick, l.808-818).
- Résultat : **l'aperçu timeline montre la track dimmer allumer des fixtures que le live garde éteintes** (celles hors tiers actifs).

### A.6 — Intention documentée

`src/__tests__/track-override-priority.test.ts:47-53` : *« dimmer track forces a dimmer value (**can go down**, overriding autoscript intensity) »*. Le contrat attendu est une priorité totale du track sur l'autoscript, y compris vers le bas.

---

## (b) Canaux dimmer couverts vs ignorés, par type de fixture

La détection se fait dans `src/engine/fixture-analyzer.ts` → `analyzeFixtureChannels` (aliasé `analyzeChannels`, l.636-640), utilisé par le tick (import l.272).

### ✅ Couverts (écriture directe du canal intensity)

| Cas | Règle | Preuve |
|---|---|---|
| Canal typé `Intensity` — **le premier seulement** | `case 'Intensity': if (fa.intensityOffset === null) ... else fa.ledIntensityOffsets.push(off)` | fixture-analyzer.ts l.427-431 |
| Canal nommé `*Dimmer*` typé `Shutter` (hybride OFL) | `isShutterDimmer = /\bdimmer\b/i.test(chName) && ch.type === 'Shutter'` | fixture-analyzer.ts l.322-325 |

Le track dimmer écrit UNIQUEMENT `fa.intensityOffset` (dmx-playback.ts l.806). **`ledIntensityOffsets` (2ᵉ, 3ᵉ… canaux Intensity) n'est jamais écrit dans le tick** — 0 occurrence dans `dmx-playback.ts` (il n'est utilisé que dans le chemin non-live `dmx-cues.ts:809-825`).

### ⚠️ Couverture partielle (fallback)

| Cas | Comportement | Limite |
|---|---|---|
| Fixture RGB sans canal intensity (`intensityOffset === null`, `rgbSegments > 0`) | dimmer appliqué en **scale multiplicatif des RGB** | dmx-playback.ts l.887-889 ; ne fonctionne que si une `paletteColor` a été résolue (sinon pas de RGB écrit du tout → le track ne se voit pas) |

### ❌ Ignorés (le track dimmer est sans effet ou partiel)

| Cas | Pourquoi | Preuve |
|---|---|---|
| Canal « Dimmer » / « Master Dimmer » typé autre chose (`Nothing`, `Undefined`, `Effect`, `Macro` sans caps…) | aucun route par nom hors le cas `type==='Shutter'` ; `Macro` sans caps est carrément skip | fixture-analyzer.ts l.315-317, l.427-431 |
| **Fixtures multi-têtes / multi-bras avec un canal Intensity PAR tête** (« Dimmer 1 », « Dimmer 2 »…) | seuls le 1ᵉʳ Intensity (l.806) est écrit ; les têtes 2..N restent à 0 (canaux absents de `chVals`) | fixture-analyzer.ts l.429 ; `ledIntensityOffsets` jamais écrit dans le tick |
| Fixtures couleur **roue** (wheel) sans canal Intensity reconnu | pas de RGB à scaler, pas d'intensity à écrire → aucun chemin dimmer | dmx-playback.ts l.887-889 (fallback RGB uniquement) |
| **Lasers** (gates R/G typés Shutter, pas de dimmer exploitable) | le bloc laser écrit les gates 0/255 lui-même ; `computeDimmerTrackOverrides` n'a pas de prise | dmx-playback.ts l.1120-1123 (`computeLaserChannels`), l.819-822 |
| « Dimmer Fine » (16 bits) | irait dans `ledIntensityOffsets` si un coarse `Intensity` le précède (non écrit par le tick) ; ne casse que si le fine précède le coarse | fixture-analyzer.ts l.427-431 |

### Sources concurrentes qui écrivent après le track (même frame)

1. `activeTiers` → 0 (l.808-818) — **écrase**.
2. Soft strobe de cue (l.947-951) — peut **remonter** au-dessus de la valeur du track.
3. Chaser track takeover (l.1162-1185) — **remplace tout** (par design).
4. Crossfade blend (l.1202-1214) — **mélange** avec une frame calculée sans le track.
5. `fadeFactor` fin de show (l.1218-1220) — atténue tout (attendu).

---

## (c) Les 3 suspects principaux de perte d'override, classés par vraisemblance

### 🥇 Suspect n°1 — Le bloc `activeTiers` écrase le dimmer track ( après coup)

**Preuve de code :**
```ts
// dmx-playback.ts l.805-806 — le track écrit :
const _dimmerTrackActive = !!(dimmerOverrides && dimmerOverrides.get(pf.id));
if(fa.intensityOffset!==null){const addr=...;if(_dimmerTrackActive){chVals[addr]=dimmerVal;}...}

// dmx-playback.ts l.808-818 — 2 lignes plus bas, l'autoscript reprend la main :
if (Array.isArray(active.activeTiers) && !active.activeTiers.includes(pf.tier)) {
  if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = 0;
  if (fa.shutterOffset !== null) chVals[pf.startAddress + fa.shutterOffset] = 0;
  ...
}
```
**Alimentation :** `genCues` pose `activeTiers: ACTIVE_TIERS[section.type]` sur CHAQUE cue (`QuickShowView.tsx:791`), avec (`QuickShowView.tsx:634-641`) :
- `intro` / `bridge` / `outro` → `['primary']` uniquement ;
- `verse` / `build` → `['primary','secondary']`.

**Symptôme prédit :** pendant intro/verse/bridge/build/outro, toute fixture **secondary ou tertiary** ciblée par la « + track dimmer » reste à dimmer 0 + shutter 0, quel que soit le bloc posé. Les fixtures **primary** fonctionnent. → **« ça marche sur certaines, pas sur d'autres »**, exactement le rapport utilisateur. Le shutter forcé à 0 tue même le fallback RGB-scale. Et l'aperçu timeline (`buildPresetDmxCues` l.134) ne passe pas par ce bloc → l'utilisateur voit le track « marcher » dans l'aperçu mais pas en live, ce qui aggrave la confusion.

### 🥈 Suspect n°2 — Fixtures sans `intensityOffset` reconnu / multi-canaux dimmer

**Preuve de code :**
- Détection restrictive : `case 'Intensity'` (premier seulement, le reste → `ledIntensityOffsets`) + cas nommé `*dimmer*`+`type 'Shutter'` (fixture-analyzer.ts l.322-325, l.427-431).
- Le tick n'écrit QUE `fa.intensityOffset` (dmx-playback.ts l.806) ; **aucune écriture de `ledIntensityOffsets`** dans tout `dmx-playback.ts` (0 occurrence).
- Fallback RGB-scale limité : l.887-889, conditionné à `rgbSegments.length > 0 && paletteColor`.

**Symptôme prédit :** dépendant du type de fixture — les fixtures à roue sans Intensity reconnu ne réagissent pas du tout au track ; les fixtures multi-têtes (ex. Tonio 6 arm avec un dimmer par bras) ne s'allument que sur le premier canal dimmer, les autres têtes restent noires. Variabilité par fixture = 2ᵉ explication plausible du « certaines oui, d'autres non ».

### 🥉 Suspect n°3 — Crossfade calculé sans les overrides dimmer

**Preuve de code :**
```ts
// dmx-playback.ts l.736-741
nextCueDmx = computeDmxForCue(
  nextCue, ..., ftoSnap, colorTrackColors, strobeOverridesEarly,
  undefined,   // ← dimmerTrackOverrides NON passé
  disabledFixturesRef?.current, fixturePositions, choSnap);

// dmx-playback.ts l.1202-1214 — le blend tire chVals vers la frame sans track
chVals[ch] = existing.has(chStr)
  ? Math.round(chVals[ch]*(1-crossfadeT) + nextCh[ch]*crossfadeT)   // ← le dimmer du track est dilué
  : Math.round(nextCh[ch]*crossfadeT);
```
Fenêtre : `gap < 0.3` s et `window ≤ 0.15` s (l.671-673). Effet : à chaque transition de cue rapprochée, la valeur du dimmer track est momentanément tirée vers le `mapIntensity` de l'autoscript (jusqu'à 100 % nextCue à `crossfadeT → 1` sur les canaux écrits par les deux frames). Transitoire (≤ 150 ms par transition) mais réel ; note : le channel preview `computeDmxForCue` direct (l.134) passe bien `dto` — incohérence interne confirmant l'oubli.

**Candidats écartés :** chaser takeover (l.1162-1185) = takeover explicite par design ; soft-strobe pulse (l.947-951) = ne fait que remonter, mineur ; échelle % (0-100) cohérente entre l'UI (`DimmerTrackInsertMenu` sliders 0-100) et le moteur (l.802) — le clamp bridge (dmx-bridge.ts l.161) couvre les données legacy hors borne.

---

## (d) Fix minimal préconisé

### Fix 1 (le vrai fix, ~5 lignes) — exempter les fixtures ciblées par un dimmer track du bloc `activeTiers`

Dans le tick (`dmx-playback.ts`, l.808-818), sauter le black-out de densité quand un bloc dimmer track est actif sur la fixture — le track est une intention utilisateur explicite, priorité documentée par le test :

```ts
if (Array.isArray(active.activeTiers) && !active.activeTiers.includes(pf.tier)
    && !(_dimmerTrackActive)) {          // ← seule modif : la fixture a un dimmer track actif
  if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = 0;
  if (fa.shutterOffset !== null) chVals[pf.startAddress + fa.shutterOffset] = 0;
  ...
}
```
(`_dimmerTrackActive` est déjà calculé en l.805, juste au-dessus — aucun recalcul nécessaire. Alternative équivalente : déplacer l'écriture du dimmer track APRÈS le bloc activeTiers.)

### Fix 2 (cohérence crossfade, 1 ligne) — passer les overrides au computeDmxForCue du crossfade

`dmx-playback.ts` l.738 : remplacer `undefined` par `dimmerOverrides` (le map est déjà calculé à l.747 pour la frame courante ; pour être rigoureux, le calculer avant le bloc crossfade à partir du même `ct`).

### Fix 3 (multi-têtes, optionnel mais peu coûteux) — propager le dimmer du track aux canaux Intensity secondaires

À l.806, après l'écriture du canal principal, écrire la même valeur sur `fa.ledIntensityOffsets` quand `_dimmerTrackActive` :
```ts
if (_dimmerTrackActive) { for (const off of fa.ledIntensityOffsets) chVals[pf.startAddress + off] = dimmerVal; }
```
Cela couvre les fixtures multi-têtes à plusieurs canaux Intensity sans toucher au comportement autoscript.

### Non recommandé
Toucher à `ACTIVE_TIERS` ou à la densité par section en général : le black-out par tier est un effet voulu du show (« le show respire ») ; seul l'override utilisateur explicite doit le bypasser.

---

## Résumé exécutif

La « + track dimmer » écrit bien en priorité sur l'autoscript (dmx-playback.ts l.801-806, inconditionnel quand actif), **mais** : (1) deux lignes plus bas, le bloc de densité `activeTiers` remet dimmer+shutter à 0 pour les fixtures secondaires/tertiaires pendant intro/verse/bridge/build/outro — suspect n°1, explique le comportement par-fixture ; (2) seuls le premier canal `Intensity` (ou un `*Dimmer*` typé Shutter) sont pilotés — les multi-têtes et les fixtures mal typées échappent au track — suspect n°2 ; (3) le crossfade est calculé sans les overrides dimmer et dilue le track pendant ≤ 150 ms à chaque transition — suspect n°3. L'aperçu timeline (`buildPresetDmxCues`) passe les overrides mais pas le bloc activeTiers : il montre un résultat que le live ne reproduit pas.
