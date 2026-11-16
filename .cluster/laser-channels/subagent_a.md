# Audit — Exploitation des canaux laser dans Light Maestro

Date : 2026-08-24 — Projet Light Maestro — **Autorité : working tree (fichiers sur disque)**, pas le commit HEAD.
Le working tree contient des **modifications non commitées** (git status : `M src/engine/auto-loops.ts`, `M src/engine/fixture-analyzer.ts`, `M src/hooks/dmx-cues.ts`, `M src/hooks/dmx-playback.ts`, `M src/views/AutoLoopsPanel.tsx`, `M src/views/PerformanceView.tsx`, `M src/__tests__/auto-loops.test.ts`… ; HEAD = `3aeddcc` v1.0.14). Toutes les lignes citées sont celles du **disque**, vérifiées par re-lecture ciblée. Des bouts de code laser (déphasage par fixture, Lissajous, vitesses oscillantes, steps 6-12) sont **déjà présents dans le working tree** : cet audit évalue l'état actuel, pas l'ancien commit.

**Verdict global :** le routing laser de l'analyseur (round 1) et les améliorations de variété (round 2) existent, mais l'exploitation reste **médiocre pour les fixtures laser réelles du repo** : (1) les axes de scan des lasers OFL les plus courants (IODA 400/600/1000, Twin Effect) sont **mal classés en « rotation »** → ils ne reçoivent **aucun balayage** ; (2) les **valeurs de pattern sont une séquence croissante déterministe**, identique seed après seed (preuve par exécution ci-dessous) ; (3) la boucle couleur est **tronquée au min des roues** (2 steps !) ; (4) le chemin **temps réel autoscript (dmx-playback) ignore 100 % des canaux laser** ; (5) `computeDmxCues` (le seul générateur autoscript qui exploite les lasers) est **du code mort, jamais appelé**.

---

## 1. Inventaire canal par canal

Légende : **DÉT** = détecté par `analyzeFixtureChannels` ? **AL** = écrit par les boucles auto (`auto-loops.ts`) ? **AS** = écrit par l'autoscript ? **VR** = écrit par le runtime SoundSwitch (`autoloop-runtime.ts`) ?

| Canal (famille) | Détecté | Routé vers | AL (auto-loops) | AS (autoscript) | VR (SoundSwitch) | Valeur typique | Ancre |
|---|---|---|---|---|---|---|---|
| Mode / Mode Select / Mode Selection (nom EXACT `^(mode\|mode select\|mode selection)$`) | ✅ | `laserModeOffset` + `laserModeCaps` | ✅ `capMid(pickLaserModeCap)` **figé** | ✅ idem **figé** | ✅ cue `laserMode: 255` | milieu du cap DMX/dynamic/auto | fixture-analyzer.ts:262 ; auto-loops.ts:544 ; dmx-cues.ts:928 ; autoloop-runtime.ts:161 |
| Mode **« Show Mode »/« Program »/« Show »** (noms réels OFL) | ❌ regex ancrée échoue | switch générique : `Shutter` (Program), `Effect` (Show) | ⚠️ écrit comme shutter (255 = DMX pour IODA, chanceux) ou **cyclé comme effet** | ⚠️ `effectOffset` cyclé → change de programme/son | ❌ | — | fixture-analyzer.ts:262 |
| Pattern Selection / Pattern | ✅ | `patternOffset` + `patternCaps` (caps bruts ; **synthèse 8 bandes** si vide) | ✅ **séquence croissante** `capMid(caps[(i+step)%len])` | ✅ idx = ⌊beat/8⌋%len — **séquentiel, idem pour tous les lasers** | ✅ 8 cues pattern | motif i → capMid(bande i) | fixture-analyzer.ts:283,447-449 ; auto-loops.ts:568 ; dmx-cues.ts:940 ; autoloop-runtime.ts:157-160 |
| Scan X (« Horizontal Angle/Movement/Position ») | ✅ nom `horizontal.*(angle\|movement\|position)` | `scanXOffset` | ✅ cercle/Lissajous, phase par fixture, radius 36-116 | ✅ sin + phase par adresse | ✅ mappé `pan` (si pan null) | 128±radius | fixture-analyzer.ts:274 ; auto-loops.ts:616-620 ; dmx-cues.ts:945 ; autoloop-runtime.ts:92 |
| Scan Y (« Vertical … ») | ✅ idem | `scanYOffset` | ✅ idem | ✅ cercle/Lissajous (1 laser sur 3, `startAddress%3===2`) | ✅ mappé `tilt` | 128±radius | fixture-analyzer.ts:277 ; auto-loops.ts:617-619 ; dmx-cues.ts:948-952 |
| **Axes « X Axis Moving » / « Y Axis Moving » (IODA 400/600/1000, Twin Effect)** | ❌ **capturés comme ROTATION** par `(x\|y\|z)[\s_-]?(rotation\|axis)` | `laserRotationOffsets` | ⚠️ sin 128±70 → sur un canal `BeamPosition@0-127 + Effect@128-255`, valeurs 58-198 : déclenche des **effets** à mi-temps | ⚠️ idem | ⚠️ mappé `laserRotN`, jamais écrit par les cues par défaut | 128+70·sin → **dépasse 127 => effets parasites** | fixture-analyzer.ts:271 (regex trop large) |
| Scanning Speed | ✅ `scann?ing\s*speed` | `laserSpeedScanOffset` | ✅ 128+64·sin (si le laser est dans `laserScans` — **pas le cas IODA**, misroutage) | ✅ 128+60·sin | ⚠️ mappé mais **aucune cue ne l'écrit** | 128±64 | fixture-analyzer.ts:265 ; auto-loops.ts:623-624 ; dmx-cues.ts:956-957 ; autoloop-runtime.ts:97 |
| Dynamic Pattern Speed | ✅ `(dynamic\|pattern).*speed` | `laserSpeedPatternOffset` | ✅ 128+64·sin(phase) | ✅ 128+64·sin | ✅ cue fixe `160` | oscille 64-192 | fixture-analyzer.ts:268 ; auto-loops.ts:577-578 ; dmx-cues.ts:959-960 ; autoloop-runtime.ts:163 |
| Rotation X/Y/Z (noms « Rotation Y-axis », « X Axis Rolling »…) | ✅ | `laserRotationOffsets[]` (0-3+ canaux) | ✅ sin déphasé par axe ET par fixture | ✅ sin + phase adresse | ❌ mappé `laserRot1..N`, **jamais écrit** par les cues par défaut | 128±70 | fixture-analyzer.ts:271-272 ; auto-loops.ts:572-574 ; dmx-cues.ts:961-963 ; autoloop-runtime.ts:99 |
| Blanking | ✅ `\bblank` | `blankOffset` | ✅ baseline **0** | ✅ 0, ou 255 en drop+strobe | ✅ cue `laserBlank: 0` | 0 | fixture-analyzer.ts:280-281 ; auto-loops.ts:545 ; dmx-cues.ts:966-968 ; autoloop-runtime.ts:162 |
| Couleur roue (ColorPreset) | ✅ | `wheelOffset` + `wheelCaps` | ✅ **steps = min des caps** (tronqué) | ✅ si pas de palette | ✅ 8 cues | capMid | auto-loops.ts:650,659 ; dmx-cues.ts:950-953 ; autoloop-runtime.ts:139-146 |
| RGB (laser 3 canaux R/G/B, ex. Boom Box Fx2) | ✅ (≥3 canaux) | `rgbSegments`/`rgbOffsets` | ✅ color-chase | ✅ palette | ✅ | — | fixture-analyzer.ts:445 |
| **Couleur 2 canaux R+G (Galaxian 3D)** | ❌ `colourChannels.length===2` ne matche **aucune branche** | perdu | ❌ jamais écrit (128 filet) | ❌ | ❌ | 128 | fixture-analyzer.ts (branches RGB/wheel 338-395) |
| Zoom | ✅ générique `/\bzoom\b/` | `zoomOffset` | ✅ baseline **255 figé** | ⚠️ générique (section 8 beam) | ⚠️ mappé zoom, pas de cue laser dédiée | 255 | fixture-analyzer.ts:302 ; auto-loops.ts:546 |
| Beam générique (« Laser Movement », « X Size ») | ⚠️ selon premier cap (Beam/Nothing) | `beamOffset` ou rien | ❌ beamOffset jamais écrit par builders laser | ⚠️ section 8 beam (traité comme zoom) | ❌ | 128/var | fixture-analyzer.ts:317-327 |
| Effet générique (« Wave Movement », « Folder », « Show », « Special Functions ») | ⚠️ selon premier cap | `effectOffset`+caps | ⚠️ boucle effect (si caps) | ⚠️ section 7 (cycle capMid) — **risque : change le show/le programme** | ❌ | capMid | dmx-cues.ts:895-900 (section 7) |
| Vitesse générique (« Rotation » seul, « Playback Speed », « Show Speed ») | ⚠️ | `speedOffset` | ⚠️ partiellement (loops beam/movement) | ✅ section 9 (40-255 par section) | ❌ | — | fixture-analyzer.ts:311-312 ; dmx-cues.ts:914-920 |
| « Drawing » (IODA), « X/Y Size », « Visible Points », « Scan Rate », « Release », « Reserved » (Impression) | ❌ type Nothing/Maintenance | rien | ❌ | ❌ (filet 128, dmx-cues.ts:980-983) | ❌ | 128 | — |
| Canal couleur « Color Segment » / « Macros » / « Dimmer Mode » (sélecteurs/macros) | ⚠️ preset override / rien | `presetOverrideOffsets`/`macroOffsets` | ❌ exclu volontairement | ❌ exclu | ❌ | — | fixture-analyzer.ts:229-243 |

**Chemin temps réel QuickShow/AutoScript (`dmx-playback.ts:1171` `computeDmxForCue`) : aucune écriture laser.** Grep complet `scanX|scanY|patternOffset|laserMode|laserSpeed|laserRot|blankOffset|isLaser` sur dmx-playback.ts → **0 hit**. Le bloc consomme intensity/rgb/wheel/shutter/pan-tilt/gobo/prism/zoom/frost/iris/focus uniquement. Or c'est CE chemin qui joue en live (QuickShowView.tsx:2262, AutoScriptPanel → computeDmxForCue). Conséquence : en app, l'autoscript n'écrit **jamais** mode/pattern/scan/vitesses/rotations/blanking des lasers.

---

## 2. Preuve par exécution (modules réels importés, fixtures OFL réelles parsées)

J'ai exécuté `analyzeFixtureChannels` + `generateLoopLibrary` (working tree) contre les JSON OFL du repo, en répliquant le typage `library.ts` (premier cap → type). Résultats :

**Analyse de 8 fixtures laser réelles (mode max) :**

| Fixture (mode) | pattern | scanX/Y | rot[] | speedScan | wheel/rgb | mode | autres |
|---|---|---|---|---|---|---|---|
| IODA 400 RGY (11ch) | ✅ 2 (128 caps) | **❌ null/null** | [4,5,6,7] ⚠️ (X/Y Axis Moving inclus) | 10 | wheel 1 (11 caps) | ❌ (Program→shutter) | shutter=0, zoom=8, speed=3, blank=- |
| IODA 600 RGB (11ch) | idem | **❌** | idem | 10 | wheel | ❌ | idem |
| Glp Impression Laser (Normal 20ch) | ❌ | — (pan=0/tilt=2 réels ✅) | ∅ | ❌ | ❌ couleur (wheel vide) | ❌ | effect=5 (Folder), shutter=4 (Access), zoom=9, beam=10, speed=7, intensity=8 |
| Twin Effect Laser (10ch combined) | **❌ TOUT null** (« Channel 2…10 » → Nothing ; library.ts n'a aucun handling `reuse`, electron/fixtures/library.ts:1026,1072) | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Galaxian 3D (5ch) | ❌ | ❌ | ∅ | ❌ | **❌ R/G 2 canaux perdus** | ❌ | Macros→preset override |
| Inno Pocket Fusion (11ch) | ❌ | ❌ (Laser Movement→générique) | ∅ | ❌ | ❌ | ❌ | shutter=3, intensity=4, speed=5 |
| Stinger II (9ch) | ❌ | ❌ | ∅ | ❌ | ❌ | **❌ « Show Mode » non maté** | effect=8 (2 caps), speed=4 |
| Boom Box Fx2 (19ch) | ❌ | ❌ | ∅ | ❌ | ✅ rgb=[4,5,6] | ❌ | effect=3 (0 caps), shutter=8, intensity=9 |

**Réponse Q2 (preuve « toujours la même ») — patch 2×IODA + 1×DS-1000-like, 3 seeds :**

```
seed 0 : 16 loops laser/36
  [laser-color]  Couleur laser · primary 170bpm backward steps=2  wheelA=[4,12]
  [laser-pattern] Motifs laser · primary 110bpm backward steps=9  patternA=[1,3,5,7,9,11,13,15,17]   patternB=[3,5,7,9,11,13,15,17,19]
  [laser-scan]   Balayage laser · primary 135bpm backward steps=8 radius=83  scanXA=[-,-,-,-,-,-,-,-]  (IODA jamais écrit)
  ... (×6 couleurs identiques, ×5 motifs quasi identiques)
seed 1 : patternA=[1,3,5,7,9,11,13,15,17,19] ; wheelA=[4,12] ; scanXA=[-,-,-,-,-,-,-,-]
seed 2 : patternA=[1,3,5,7,9,11,13,15,17] ;     wheelA=[4,12] ; scanXA=[-,-,-,-,-,-,-,-]
```

- Les **valeurs** de pattern = `capMid(caps[step])` = 1,3,5,7,… : **identiques seed 0/1/2** — seul `steps` (6-12), `speed`, `direction`, `radius`, `shape` varient (ceux-là sont tirés au seed).
- `laser-color` : `wheelA=[4,12]` **partout** — 2 steps à cause de `capCount = min(caps)` (auto-loops.ts:650), et 6 cartes quasi identiques.
- Les 2 IODA : **aucun balayage** (scanX null → exclus de `laserScans`), mais leurs axes « X Axis Moving » reçoivent des sin de rotation qui dépassent 127 → **déclenchent les caps Effect** des axes.

---

## 3. Réponses aux questions

### Q1 — Quels canaux laser ne sont JAMAIS écrits par les générateurs ?
1. **Tous les canaux laser, dans le chemin live QuickShow/AutoScript** (`dmx-playback.ts:1171` computeDmxForCue) : mode, pattern, scanX/Y, speedScan, speedPattern, rotations, blanking — **zéro écriture** (grep: 0 hit). C'est le chemin utilisé à la lecture (QuickShowView.tsx:2262).
2. **`computeDmxCues` (dmx-cues.ts:549) est mort** : exporté mais **jamais appelé** dans src (grep `computeDmxCues(` → seul le code de définition). Son bloc laser 7b (dmx-cues.ts:922-971) ne s'exécute nulle part.
3. Canaux **jamais détectés** donc jamais écrits : « Drawing » (IODA), « X Size/Y Size », « Visible Points », « Scan Rate », « Release », « Reserved » (Impression), R/G du Galaxian 3D, tout le mode 10ch « combined » du Twin Effect, « Color Segment ».
4. `laserRotationOffsets` : écrits par auto-loops et computeDmxCues, **mais jamais par le runtime SoundSwitch** (autoloop-runtime.ts:153-166 — `defaultLaserBeamCues` n'a ni rot ni speedScan) et jamais par dmx-playback.
5. `laserSpeedScanOffset` : jamais écrit pour les IODA/Twin (misroutage → exclus de `laserScans`).
6. Sélecteurs de mode réels (« Show Mode » Stinger, « Program » IODA, « Show » Fusion) : jamais mis à une valeur sûre générique — écrits comme shutter/effect par accident.

### Q2 — Pourquoi « toujours la même qui revient » ?
1. **Valeurs de pattern déterministes et ascendantes** : `capMid(caps[(i+step)%len])` (auto-loops.ts:568) — la séquence 1,3,5,7,… **ne dépend pas du seed**. Le seed ne change que steps count/speed/direction/radius/shape. Preuve ci-dessus (identiques seeds 0/1/2).
2. **Boucle couleur tronquée au min des roues** (auto-loops.ts:650) : avec un laser à 2 caps dans le patch → 2 steps, 2 couleurs, toujours les mêmes.
3. **Seulement 3 kinds laser** (pattern/scan/color) et ~16/36 cartes laser dans un catalogue pour ~4 contenus distincts répétés (3-6 cartes quasi identiques chacune).
4. **PerformanceView fige `seed: 0`** (PerformanceView.tsx:877) : le même catalogue à chaque session. AutoLoopsPanel régénère via `setSeed(s+1)` (AutoLoopsPanel.tsx:146-149) mais les **valeurs** pattern/couleur restent identiques (cf. 1).
5. **Noms identiques** : `Motifs laser · primary` ×5, `Couleur laser · primary` ×6 (auto-loops.ts:586,632,672) → l'UI montre des cartes indistinguables ; `AutoLoopPicker` matche par kind+name+tier (PerformanceView.tsx:892-897) → premier match ; les recipes laser-color n'ont **aucun champ de variété** (loopToRecipe auto-loops.ts:1040-1053).
6. En autoscript (dmx-cues.ts, si jamais appelé) : idx pattern = ⌊beat/8⌋%len — **le même pour tous les lasers au même instant**, séquence ascendante ; scan radius figé 90.
7. **Le misroutage des axes de scan** prive le catalogue des « Balayage laser » pour les lasers réels les plus courants → l'utilisateur ne voit que motifs/couleurs répétés.

### Q3 — La variété inter-lasers existe-t-elle ?
**Partielle.** ✅ auto-loops : pattern décalé par fixture `(i+step)` (auto-loops.ts:568), rotations/scan phase `2πi/k` (572-574, 615) ; tests dédiés (laser-exploit.test.ts:168-200). ✅ computeDmxCues : scan/rotations/speeds phase par `startAddress%16`, Lissajous 1/3 (dmx-cues.ts:932,945-963).
❌ **Mais** : (a) pattern autoscript **identique** pour tous les lasers (pas de décalage), (b) les jumeaux commençant à des adresses avec même `%16`/`%3` restent synchrones, (c) surtout : les **IODA/Twin (les vraies fixtures) n'ont pas de scan** détecté → leurs axes « X Axis Moving » reçoivent des sin de rotation 58-198 qui **peuvent déclencher des effets** sur des caps `BeamPosition@0-127 + Effect@128-255` (comportement non chorégraphié), (d) dmx-playback ne déphase rien (rien n'est écrit).

### Q4 — Valeurs légales dans les définitions du repo (3 vraies fixtures)
- **Cameo IODA 400 RGY** (`resources/fixtures/ofl/cameo/ioda-400-rgy.json`, mode 11ch) : `Program` ShutterStrobe@0-9 (off) → Effect@10-209 (auto/sound) → **NoFunction@210-255 = DMX** ; `Color Presets` ColorPreset@0-63 (RGY/Yellow/Red/Green…) → Effect@64-255 (ColorJump / Multiple / ColorFade) ; **`Pattern Select` : 128 motifs, 2 DMX chacun (0-255)** ; `Rotation`/`X Axis Rolling`/`Y Axis Rolling` : Rotation@0-127, Effect@128-191, Rotation@192-255 ; `X Axis Moving`/`Y Axis Moving` : **BeamPosition@0-127, Effect@128-255** ; `Zoom` Zoom@0-127/Effect ; `Drawing` NoFunction@0/Effect@1-255 ; `Scanning Speed` Speed@0-127 (lent→rapide) / 128-255. → **les patterns vont de 0 à 255, pas seulement 1,3,5…17.**
- **JB Systems Twin Effect Laser** (modes 10ch A/B/C) : `laser-mode` (NoFunction/Effect), `Patterns` (11 grating patterns), `Zooming` (Pattern size 0-127 + Zoom in/out), rotations X/Y/Z (Rolling), X/Y Axis Moving, `colors` (ColorPreset + ColorJump), `Strobe`, grating rotation.
- **GLP Impression Laser** (mode Normal 20ch) : Pan/Pan fine/Tilt/Tilt fine, `Access` (ShutterStrobe), `Folder` (16 shows), `File` (Effets), `Playback Speed`, `Intensity`, `Zoom`, `X Size`/`Y Size`, `Rotation`, `X/Y Position`, `Visible Points`, `Scan Rate`, `Color`.

---

## 4. Tests existants (état disque — src/__tests__/laser-exploit.test.ts, 220+ lignes)

Couvert : détection fixtureType + signature (54-77) ; analyse EL-400 (pattern synthétisé, scan H/V, roue, vitesses) et DS-1000 (3 rotations, blanking, strobe) (79-106) ; helpers (synthPatternCaps, pickLaserModeCap jamais Off/Sound) (108-124) ; génération des 3 kinds + baseline (126-155) ; **round 2** : jumeaux scan déphasés, speedScan oscille, rotations déphasées, speedPattern oscille, Lissajous + cercle présents sur 12 seeds, steps 6-12 (159-220).
**Trou : tous les tests utilisent des fixtures synthétiques nommées « Horizontal/Vertical Movement », « Mode Select »… Aucun test sur les noms réels OFL (« X Axis Moving », « Show Mode », « Program », « Red/Green Laser » 2 canaux, « reuse »)** — c'est pourquoi le misroutage IODA et les pertes Galaxian/Twin passent inaperçus.

---

## 5. Propositions (classées impact/effort)

### P1 — ⬆️🔴 / faible — Corriger le misroutage des axes de scan dans l'analyseur
`src/engine/fixture-analyzer.ts:271` — la regex `(x|y|z)[\s_-]?(rotation|axis)` capture aussi « X Axis Moving »/« Y Axis Moving » (axes BeamPosition). Fix : traiter les axes de scan **avant** la rotation (règles horizontal/vertical enrichies : `/(x|y)\s*axis\s*(moving|position|angle)/` → scanX/scanY), et réserver la rotation aux noms contenant `rotat|rolling` + vérifier les caps (premier cap `BeamPosition` → scan, `Rotation` → rotation). Impact : débloque le balayage des IODA/Twin (les lasers les plus représentés) et supprime les sin parasites 128±70 sur des axes à caps Effect. Ajouter un test avec la définition réelle IODA 11ch.

### P2 — ⬆️🔴 / faible — Varier les VALEURS de pattern (pas seulement le compte de steps)
`src/engine/auto-loops.ts:568` (et recipe 1131-1134, dmx-cues.ts:940) : remplacer `capMid(caps[(i+step)%len])` par un parcours **non séquentiel** : départ aléatoire par loop (`caps[(start + i*S + step*J) % len]` avec start tiré au seed, pas 1/3/5), ou shuffle de `patternCaps` une fois par builder. En autoscript : idx = `(⌊beat/8⌋ * (1 + startAddress%3) ) % len` pour varier par fixture **et** par section (hash du nom de section). Exploite enfin les 128 motifs IODA au lieu des 6-12 premiers.

### P3 — ⬆️🔴 / faible — Boucle couleur : cycles per-fixture au lieu du min global
`src/engine/auto-loops.ts:650` : `capCount = Math.min(...)` tronque toute la boucle (2 steps avec un laser à 2 caps). Fix : `capCount = Math.max(1, ...max...)` avec wrap de chaque fixture sur ses propres caps (`caps[(i+step)%len]` gère déjà le wrap, auto-loops.ts:659) — chaque laser déroule toute sa roue, durée = la roue la plus longue. Idem si `capCount` sert au step de rotation (663-665). Bonus : ajouter les caps Effect couleur (ColorJump/ColorFade, IODA @64-255) comme « couleurs » de la roue.

### P4 — ⬆️🟠 / faible — Brancher les canaux laser dans le chemin live (dmx-playback)
`src/hooks/dmx-playback.ts:1171` (`computeDmxForCue`) : reporter le bloc 7b de dmx-cues.ts:922-971 (mode = pickLaserModeCap, pattern cycle, scan cercle/Lissajous phase par adresse, vitesses oscillantes, rotations, blanking 0/en strobe) à l'intérieur de la boucle fixtures (avec `fa.isLaser`). Effet immédiat : l'autoscript joué en live (QuickShowView.tsx:2262) cesse d'ignorer 100 % des canaux laser. Alternative plus propre : ré-exporter un helper `applyLaserChannels(fa, pf, channelValues, beat, ctx)` partagé entre dmx-cues et dmx-playback.

### P5 — 🟠 / moyen — Nouveau kind « laser-fx » (beam/zoom/strobe/effets + blanking)
`src/engine/auto-loops.ts` (kinds p.23-48, dispatch p.896-905) : builder `buildLaserFxLoop` qui exploite `effectOffset`+caps (Wave Movement, Drawing, granulation), `zoomOffset` (Pattern size 0-127 vs Zoom 128-255), `blankOffset` (strobe pattern 0/255 par step), et casse la « baseline figée » (laserBaseline 543-549 : zoom 255 + intensity 255 systématiques → les faire varier ici). Boucle : steps 8-16, alternance zoom large/étroit × effet cyclé × blank strobé.

### P6 — 🟠 / faible — Noms distincts + seed non figé pour le catalogue
`src/engine/auto-loops.ts:586,632,672` : inclure la variante dans le nom (`Motifs laser ×9 · primary`, `Balayage Lissajous r=83 · primary`, `Couleur laser 6t · primary`) pour que l'UI (AutoLoopsPanel, AutoLoopPicker) cesse d'afficher des cartes identiques et que les recipes se distinguent. `src/views/PerformanceView.tsx:877` : remplacer `seed: 0` par un seed dérivé de l'heure/session (comme AutoLoopsPanel) pour que le widget Performance n'ait pas le même catalogue à chaque lancement.

### P7 — 🟠 / moyen — Runtime SoundSwitch : cues rotations + vitesses de scan
`src/engine/autoloop-runtime.ts:153-166` (`defaultLaserBeamCues`) : ajouter des `AttributeCue` pour `laserRot1..N` (ramp lente sur 8-16 bars, déphasée par bar) et `laserSpeedScan` (alternance 64/192), et dans `toAutoloopFixtures` (l.91-100) mapper aussi les axes « X/Y Axis Moving » en pan/tilt quand ils portent un cap `BeamPosition` (complément de P1). Sans P1, ces cues resteront sans cible pour les IODA.

### P8 — 🟡 / moyen — Tests sur les fixtures RÉELLES du repo
`src/__tests__/laser-exploit.test.ts` : ajouter des cas avec les définitions OFL réelles (IODA 400 11ch : scanX/scanY détectés, pas dans rot[] ; Galaxian 3D : R/G capturés ; Twin 10ch-A : pattern synthétisé ; Stinger : « Show Mode » routé en laserMode ou explicitement ignoré). Ces tests sont la garantie que P1-P4 ne régressent pas. _(Attention : c'est le round 1 qui a créé les fixtures synthétiques « Horizontal Movement » — elles ne représentent aucun fixture du repo.)_

---

## 6. Fichiers/hooks de surfaçage (vérifiés)

- **UI boucles auto** : `src/views/AutoLoopsPanel.tsx` (EXISTE, contrairement à l'énoncé) — catalogue `generateLoopLibrary` count 36, seed d'état (l.35,46,109), « Régénérer » = seed+1 (l.146-149) ; embarqué dans QuickShowView tab « loops » (QuickShowView.tsx:1197) ; affiche aussi `SoundSwitchAutoloop` (l.106).
- **Widget Performance** : `PerformanceView.tsx` AutoLoopPicker — same seed 0 (l.877), `loopToRecipe` (l.898).
- **Autoscript live** : QuickShowView.tsx:2262 → `computeDmxForCue` (dmx-playback.ts:1171) — **aucun laser** ; `computeDmxCues` (dmx-cues.ts:549, bloc laser 922-971) **jamais appelé**.
- **Banques SoundSwitch** : `autoloop-runtime.ts` (channelMap 91-100, cues 139-166, injection 218-227) ; moteur pur `autoloop-engine.ts` (aucune référence laser).