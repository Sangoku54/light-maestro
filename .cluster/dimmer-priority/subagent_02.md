# Rapport Analyste — Chaîne « autoscript » vs track dimmer de show (priorité dimmer)

> Périmètre : analyse seule, aucun fichier de code modifié.
> Question posée : quand une « + track dimmer » du QuickShow écrit dimmer=100 et que l'autoscript écrit dimmer=255 en même temps, qui gagne et pourquoi ?
> Symptôme : la track dimmer ne prime pas sur **toutes** les fixtures en ce moment.

---

## (a) Le flux autoscript complet, avec fichiers + lignes

### a.1 — Ce qu'est « l'autoscript » côté QuickShow

L'autoscript de show = les cues générés depuis l'analyse de la chanson (`genCues` dans `src\views\QuickShowView.tsx`, consommés comme `CuePlayback[]`) joués par le moteur **`useDmxPlayback`** (`src\hooks\dmx-playback.ts`). **Il n'y a qu'UN SEUL moteur et UNE SEULE source d'arbiter** qui écrit à la fois l'autoscript ET les tracks de show (color/dimmer/strobe/EFX/fixture/chaser) : les tracks sont fusionnées dans la frame du moteur, pas dans l'arbitre.

Chemin complet d'une frame :

1. **RAF tick** — `dmx-playback.ts` l.617+ (`const tick=()=>{...}`), cadencé par `currentTimeRef` (horloge audio de `QuickShowView.tsx` l.2380-2388 ou `SongPresetPlayer.tsx` l.180-200).
2. **Cue active** = dernière cue avec `time <= ct` — `dmx-playback.ts` l.638-640 (`for(const cue of c){if(cue.time<=ct&&(!active||cue.time>active.time))active=cue;}`).
3. **Overrides par frame** :
   - couleurs track : `computeColorTrackColors` l.624-629 ;
   - **dimmer track** : `dimmerOverrides = computeDimmerTrackOverrides(dimmerTracksRef.current, ct, ...)` — l.747-749, calculé **uniquement si** `dimmerTracksRef?.current && dimmerTracksRef.current.length > 0` ;
   - strobe track l.735-737 ; EFX tracks l.725-728 ; fixture tracks l.751-769 ; chaser takeover l.1155-1191.
4. **Valeur dimmer de la cue (autoscript)** — l.779-797 : `dimmerVal = active.forcedDimmerVal ?? mapIntensity(active.intensity, effectiveEnergy, pf.tier, tierMultipliers)`. `mapIntensity` (`src\engine\dmx-color.ts`) donne ~180-255 × multiplicateur de tier pour `high`/`very-high`. Les fixture-tracks `dimmerBlocks` passent avant la cue (l.784-793).
5. **Override track dimmer** — l.798-803 :
   ```ts
   if (dimmerOverrides) { const dimmerOverride = dimmerOverrides.get(pf.id);
     if (dimmerOverride) { dimmerVal = Math.round(255 * dimmerOverride.value / 100); } }
   ```
6. **Écriture du canal intensité** — l.805-806 :
   ```ts
   const _dimmerTrackActive = !!(dimmerOverrides && dimmerOverrides.get(pf.id));
   if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;
     if(_dimmerTrackActive){chVals[addr]=dimmerVal;}                       // écriture INCONDITIONNELLE
     else if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;} // HTP intra-frame sinon
   ```
7. **Bloc densité par tiers (activeTiers)** — l.808-819 : si `active.activeTiers` existe et `pf.tier` n'y est pas → dimmer/shutter/strobe/RGB **forcés à 0** (exécuté APRÈS l'écriture de la track).
8. **Chemin RGB** — l.886 (réécriture HTP intra-frame, no-op si track active) et l.889 : si `fa.intensityOffset===null`, la track/cue dimmer s'applique en **scaling RGB** (`dScale = dimmerVal/255`).
9. **Shutter** — l.941-958 : shutter ouvert 255 (l.959) ou amplitude `8+dimmerVal/255*247` si pas de canal intensité (l.958).
10. **Push unique** — l.1239 : `dmxBridge.push(uniIdx, chVals, arbSource)` → `dmx-bridge.ts` l.105-107 → `write(sourceId,...)` l.65-77 → `outputArbiter.write` l.91 → `getBuffer` l.131 → cache 3D + `flushToHardware` (l.48-53).

### a.2 — Quels canaux « dimmer » l'autoscript écrit-il (par fixture) ?

- **Un seul canal d'intensité par fixture** : `fa.intensityOffset` (offset 0-based du canal Dimmer/Intensity détecté par `analyzeChannels`, `src\engine\fixture-analyzer.ts` l.314-317 pour les hybrides Shutter/Dimmer, l.422-425 pour les LED). Écrit à l.806 et l.886.
- **Si pas de canal intensité détecté** : scaling des segments RGB (l.889) ou amplitude du shutter (l.958). **Pas de troisième voie.**
- **Jamais écrit par le tick QuickShow** :
  - `fa.ledIntensityOffsets[1..n]` (canaux dimmer secondaires des fixtures multi-LED / multi-bras — le 1er devient `intensityOffset`, `fixture-analyzer.ts` l.422-425 ; les suivants ne sont écrits nulle part dans `useDmxPlayback`, seulement par le moteur de chasers DMX `dmx-cues.ts` l.809-825 et cartographiés `led1..ledN` côté autoloop `autoloop-runtime.ts` l.86) ;
  - les canaux lasers (gates binaires recalculés chaque frame par `computeLaserChannels`, l.1233-1236 et l.1345-1380) — pas de dimmer appliqué.
- **Fine channels** : jamais touchés par le dimmer (ni par le générateur).

### a.3 — L'autre « autoscript » : générateur SoundSwitch (`autoscript-generator.ts`)

`generateAutoscript` (`src\engine\autoscript-generator.ts`) produit une timeline de `ChannelKey` **adresses DMX absolues** :
- attributs : `emitAttributeKeys` l.213-269 — écrit uniquement les canaux logiques présents dans `cue.values` (couleur, gobo, zoom…) résolus via `channelAddress` l.85-90 (`fixture.address + channelMap[logical]`). **Aucune cue dimmer n'est générée par les banks** (aucune occurrence de cue dimmer dans `autoloop-runtime.ts`/`autoloop-banks.ts` ; `'dimmer'` n'existe que dans le channelMap, `autoloop-runtime.ts` l.73).
- position : `emitPositionKeys` l.283-345 — pan/tilt multi-bras par beat.
- Lecture : `use-autoloop-engine.ts` → `AutoloopPlaybackEngine` (`autoloop-engine.ts`) → `createAutoLoopOutput` (`autoloop-adapter.ts` l.55-73) → `sendChannelsToHardwareAndStore(..., 'auto-loop')` (`dmx-helpers.ts` l.4-16) → source **`auto-loop`**.

### a.4 — VC AudioAutoScript (widgets Performance)

`PerformanceView.tsx` l.1594-1660 : rejoue des snapshots précalculés (`buildPresetDmxCues`, `QuickShowView.tsx` l.96-155, qui **intègre** les overrides dimmer track par cue : `dto` l.131, passé à `computeDmxForCue` l.137) en écrivant **`dmxBridge.write('vc', ...)`** (l.1640) — source LTP 80.

---

## (b) Enregistrement exact de la source autoscript dans l'arbiter

Table canonique — `src\engine\output-arbiter.ts` l.34-47 :

| Source | Mode | Priorité | Émetteur |
|---|---|---|---|
| `simple-desk` | ltp | 100 | desk manuel |
| `fixture-test` | ltp | 90 | test fixture |
| `vc` | **ltp** | **80** | boutons VC + **AudioAutoScript** (`PerformanceView.tsx` l.1640) |
| `design-efx` | ltp | 70 | design |
| `design-test` / `fixture-onoff` | ltp | 60 | design/on-off |
| `default` | ltp | 50 | divers |
| **`song-preset`** | **htp** | **45** | `SongPresetPlayer` (`SongPresetPlayer.tsx` l.237) |
| **`quickshow`** | **htp** | **40** | lecture show QuickShow = autoscript + tracks (`dmx-playback.ts` l.382) |
| `show-manager` | htp | 35 | show manager |
| `rgb-matrix` | htp | 30 | matrice |
| **`auto-loop`** | **ltp** | **75** | boucles SoundSwitch (`autoloop-adapter.ts` l.40, `auto-loop-player.ts` l.30) |

- Le moteur QuickShow passe **sans** `arbiterSource` → défaut `'quickshow'` HTP 40 (`dmx-playback.ts` l.379-382). Le même moteur pour SongPresetPlayer passe `'song-preset'` HTP 45.
- `write()` **remplace** la contribution précédente de la source sur l'univers (`output-arbiter.ts` l.91-111 : « it does NOT merge ») — un canal non réécrit à la frame suivante **tombe du buffer** et retourné aux autres sources.
- `getBuffer` l.131-176 : tri par priorité décroissante puis seq ; **LTP** prend ses canaux en premier (`taken`, l.154-160), **HTP** se partagent le reste en **max par canal** (l.161-168, `Math.max` l.166). Égalité HTP → indifférent.

### Suspension / release / ducking liés aux tracks de show : **INEXISTANT**

`dmx-bridge.ts` (fichier entier relu) ne contient que `write` / `writeTransient` (timers de release transitoires l.32-43, pour stop/zero VC) / `writeMerge` / `release` / `setDryRun`. `output-arbiter.ts` ne connaît que mode + priorité. **Aucune logique ne suspend, n'atténue (ducking) ni ne relâche l'autoscript quand une track de show est active.** Ce n'est pas nécessaire dans le scénario mono-moteur, car la priorité track>autoscript est résolue **dans la frame** (l.798-806), avant même d'atteindre l'arbitre. Mais cela signifie aussi que **rien ne protège la track d'une source concurrente plus forte** (auto-loop, vc, song-preset).

---

## (c) Scénario de conflit résolu pas à pas — track dimmer=100 (→255) vs autoscript dimmer=255

### Cas 1 — scénario nominal QuickShow (UN seul moteur, source `quickshow`)

| # | Étape | Ligne | Résultat |
|---|---|---|---|
| 1 | Frame tick, cue active `high` | 638-640 | `active.intensity='high'` |
| 2 | `dimmerOverrides` = {fixture → {active, value:100}} pour les cibles d'une entrée active | 747-749 + 86-120 | map remplie pour les fixtures ciblées |
| 3 | `dimmerVal` initial = `mapIntensity('high',...)` ≈ 180-255×tier | 779-797 | ex. 255 |
| 4 | Override track : `dimmerVal = round(255×100/100) = 255` | 798-803 | la track REMPLACE la valeur cue |
| 5 | Écriture canal intensité : `_dimmerTrackActive` → `chVals[addr]=dimmerVal` **sans condition** | 805-806 | **la track gagne**, même pour descendre (track 10% → 25 écrit 25 alors que la cue demandait 255) |
| 6 | Réécriture RGB (HTP intra-frame) | 886 | no-op (même valeur déjà posée) |
| 7 | Push frame complète en UNE source | 1239 | `dmxBridge.push(uni, chVals, 'quickshow')` |
| 8 | Arbitre : une seule source sur ces canaux → fast path | output-arbiter 136-139 | buffer = chVals, hardware = track |

**Verdict cas 1 : LA TRACK GAGNE TOUJOURS.** L'autoscript ne « réécrit » jamais par-dessus dans la même frame : c'est la même variable `dimmerVal`, et la track est appliquée en dernier dans son calcul. Le conflit HTP/LTP de l'arbitre n'intervient **jamais** entre track et autoscript du même show.

### Cas 2 — DEUX sources HTP actives (preset widget + show QuickShow simultanés)

`song-preset` (45) vs `quickshow` (40), même canal dimmer :
- arbiter l.161-168 : `htp.set(ch, Math.max(prev, vals[ch]))`.
- Track dimmer 100 → 255 côté `song-preset`, autoscript `quickshow` écrit 255 → max = 255 (indifférent). **Mais track 50% (128) vs autoscript 255 → max = 255 : l'autoscript gagne.** HTP ne permet PAS à une track de descendre une autre source.

### Cas 3 — source LTP concurrente (`auto-loop` 75, `vc` 80)

- arbiter l.153-160 : les LTP sont parcourus en premier et marquent `taken` : **quel que soit le dimmer écrit par la track** (même 0), une boucle auto active ou un snapshot VC AudioAutoScript qui écrit le canal dimmer **gagne toujours** — c'est un LTP au-dessus de tous les HTP.
- `vc` (AudioAutoScript) reste de plus **verrouillé** tant qu'il n'est pas relâché (LTP latch, aucune réécriture nécessaire).

---

## (d) Conditions dans lesquelles l'autoscript gagne à tort (explication du symptôme « pas sur TOUTES les fixtures »)

Dans le scénario nominal mono-moteur, la track gagne sur `intensityOffset`. Les fixtures qui « n'obéissent pas » sont celles qui passent par un des chemins ci-dessous :

1. **🥇 Bloc densité `activeTiers` (l.808-819) — l'autoscript écrase la track.** Exécuté APRÈS l'écriture track (l.806) : toute fixture dont `pf.tier` ∉ `active.activeTiers` de la cue courante a dimmer/shutter/strobe/RGB **forcés à 0**, même si la track dimmer la cible à 100. Symptôme typique : la track « prend » sur les fixtures du tier actif mais jamais sur les autres pendant les cues à tiers restreints (intro/build…).

2. **🥈 Crossfade sans overrides dimmer (l.706-708 + blend l.1206-1213).** `computeDmxForCue(nextCue, ..., strobeOverridesEarly, **undefined**, ...)` — le 9ᵉ argument `dimmerTrackOverrides` est explicitement `undefined` (le compute de `dimmerOverrides` l.747 arrive d'ailleurs APRÈS ce bloc). Pendant la fenêtre de fondue (gap < 0,3 s, fenêtre ≤ 150 ms, l.696-698), la valeur finale est `chVals×(1-t) + nextCh×t` où `nextCh[intensité]` est l'intensité **autoscript sans track** → la track est diluée (saut/flash transitoire à chaque changement de cue rapproché).

3. **🥉 Sources concurrentes plus fortes** (cf. c.2/c.3) :
   - un widget Performance en **AudioAutoScript** (`vc` LTP 80) ou une **boucle auto** (`auto-loop` LTP 75) active pendant le show → leurs canaux dimmer battent la track du show ;
   - lecture simultanée d'un preset (`song-preset` HTP 45) et du show (`quickshow` HTP 40) → le max HTP fait gagner l'autoscript le plus lumineux ; une track ne peut pas assombrir l'autre source.

4. **Fixtures multi-dimmer (`ledIntensityOffsets`)** — `fixture-analyzer.ts` l.422-425 : seul le **premier** canal LED devient `intensityOffset` et reçoit la track (l.806). Les canaux LED2..N (bras 2..6 d'une fixture type Tonio 6 arm) ne sont **jamais écrits** par le tick QuickShow → les bras au-delà du premier ne suivent pas la track (et pas l'autoscript non plus : leurs canaux restent à leur dernière valeur hardware).

5. **Lasers (`fa.isLaser`)** — `computeLaserChannels` (l.1233-1236 tick, l.1604-1610 snapshot) : pas de canal d'intensité exploité ; gates binaires recalculés chaque frame par l'autoscript → la track dimmer est **sans effet** sur les lasers.

6. **Fixtures sans canal intensité détecté (`intensityOffset===null`)** :
   - avec RGB : track appliquée en scaling (l.889) ✓ ;
   - wheel + shutter : appliquée en amplitude shutter (l.958) ✓ ;
   - wheel **sans** shutter (ni RGB) : la track n'écrit **rien** — l'autoscript (roue, shutter absent) garde la main.

7. **Cibles de track silencieusement ignorées** — `computeDimmerTrackOverrides` l.93-96 : track ignorée si `targetFixtures` absent (vieux shows sauvés avant le champ) ou si **aucune entrée active à ct** (trous entre entrées → retour autoscript) ; `entries.find` ne prend que la **première** entrée active ; plusieurs tracks dimmer superposées → la **dernière du tableau** écrase les précédentes (`result.set` l.112-119).

---

## (e) Fix minimal préconisé

Le problème n'est **pas** dans l'arbitre (track et autoscript partagent la même source) : c'est le tick qui contient des chemins qui contournent l'override. Par ordre d'impact :

1. **Respecter la track dimmer dans le bloc `activeTiers`** (l.808-819) — condition n°1 la plus probable du symptôme :
   ```ts
   if (Array.isArray(active.activeTiers) && !active.activeTiers.includes(pf.tier) && !_dimmerTrackActive) { ... }
   ```
   (ou réécrire `chVals[addr]=dimmerVal` après le bloc tiers quand `_dimmerTrackActive`). L'utilisateur a explicitement posé une track : elle doit primer sur la densité automatique par tiers.

2. **Passer les overrides dimmer au snapshot de crossfade** — l.706-708 : remplacer le `undefined` par la map d'overrides. Il faut d'abord **remonter le calcul de `dimmerOverrides` (l.747-749) avant le bloc crossfade (~l.690)**, puis le passer en 9ᵉ argument. Supprime la dilution transitoire de la track à chaque changement de cue.

3. **Propager la track aux canaux dimmer secondaires** — l.806 : quand `_dimmerTrackActive`, écrire `dimmerVal` sur `fa.ledIntensityOffsets` **en plus** de `intensityOffset` (fixtures multi-bras/multi-LED). Une boucle `for (const off of [fa.intensityOffset, ...fa.ledIntensityOffsets])`.

4. **(Optionnel) Lasers** — passer un `dimScale = dimmerVal/255` dans `computeLaserChannels` (options déjà prévues l.1339 `options?: { blankWhenStrobe?: boolean }`) pour scaler gates/valeurs laser par la track.

5. **(Optionnel, si lecture simultanée preset + show doit être supportée)** — c'est le seul cas où l'**arbitre** doit être modifié : la piste propre est une **source dédiée pour les tracks de show**, ex. `show-tracks` en **LTP 78** (au-dessus de `auto-loop` 75 et `song-preset` 45, sous `vc` 80), à laquelle le moteur n'écrirait **que** les canaux intensité (+LED) des fixtures ciblées par une track dimmer active, le reste partant dans la source HTP habituelle. Alternative plus simple : un mutex de lecture (un seul moteur actif à la fois — c'est déjà partiellement le cas via `registerAudioPlayback` côté widgets). **Ne pas passer `quickshow` en LTP** : ça ferait gagner TOUT le show (mouvements, couleurs) sur les sources de contrôle, pas seulement la track dimmer.

### Réponse directe à la question 4

> « track dimmer=100 (255) vs autoscript=255 en même temps : qui gagne ? »

- **Même moteur QuickShow (cas réel du bug)** : la track gagne — écriture inconditionnelle `chVals[addr]=dimmerVal` (l.806) AVANT le push unique (l.1239) ; l'arbitre ne voit qu'une valeur. La track gagne aussi pour **descendre** (10% → 25).
- **Deux sources HTP** (preset + show) : `Math.max` de l'arbitre (output-arbiter l.166) → à 255 vs 255 indifférent ; mais la track ne peut jamais **assombrir** l'autre source.
- **Source LTP** (`auto-loop`/`vc`) : elle gagne toujours (l.154-160), track ou pas.
