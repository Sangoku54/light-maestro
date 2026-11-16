# Audit variété des mouvements — Light Maestro (QuickShow / moteur DMX)

**Objet** : vérifier que la génération automatique ne rejoue pas toujours les mêmes mouvements d'un preset à l'autre.
**Méthode** : lecture statique du code (lignes vérifiées dans les fichiers actuels) + simulation Node des formules réelles (hash/mulberry32/idx de `selectMovementPattern`, formules d'amplitude).
**Version auditées** : `QuickShowView.tsx` (221 620 o), `dmx-movement.ts` (4 533 o), `dmx-playback.ts`, `dmx-cues.ts`, `SongPresetPlayer.tsx`. Aucun fichier modifié.

---

## 1. Catalogue des patterns

### ✅ Vérifié OK — catalogue SMART_MOVEMENTS, 13 patterns, tous sélectionnables

`src/engine/dmx-movement.ts:34-41` — `SMART_MOVEMENTS` (13 patterns distincts) :
- intro : static, panOnly, tiltOnly, sweep, wave
- verse : sweep, wave, panOnly, figure8, randomWalk
- chorus : circle, sweep, spiral, diamond, figure8, bounce, wave
- bridge : figure8, wave, zigzag, randomWalk, spiral, diamond
- drop : bounce, zigzag, heartbeat, circle, spiral, diamond, randomWalk, wave
- outro : tiltOnly, panOnly, sweep, static, wave
- build : spiral, circle, wave, sweep, diamond, zigzag

`QuickShowView.tsx:522-529` — les pools de `selectMovementPattern` couvrent les 13 patterns. Chaque pattern du catalogue est atteignable au moins une fois : bounce/zigzag/heartbeat via le pool `drop` (L528) ou les biais genre (`dubstep` L539, `drum_and_bass` L540, `rock` L543, `metal` L544) ; static via intro/bridge et les seuils bas (L553) ; panOnly/tiltOnly via intro/verse/outro.

### 🔴 Problème bloquant — le 14ᵉ pattern nominal `pulse` est mort des deux côtés

- Le type officiel `MovementPattern` (`src/hooks/dmx-cues.ts:111-125`) liste **14 patterns**, dont `pulse`.
- `pulse` n'est **jamais** dans les pools de `selectMovementPattern` (`QuickShowView.tsx:522-529`) ni dans `SMART_MOVEMENTS` (`dmx-movement.ts:34-41`) → la génération auto ne le produit jamais.
- Au playback, `pulse` n'a **pas de case** dans les deux switchs : `dmx-playback.ts:1048-1050` (tick live) et `dmx-playback.ts:1516-1535` (`computeDmxForCue`) → il retombe sur `default` (Lissajous doux `sin(phase*.35)*.4`), pas sur un vrai « pulse ».
- Le mapping « pulse → bounce » existe pourtant déjà dans `MOVEMENT_BY_TYPE` (`dmx-cues.ts:164`) mais ce tableau n'est pas utilisé par le moteur actif.
- **Correction** : ajouter `case 'pulse':` à côté de `case 'bounce':` dans les deux switchs (`dmx-playback.ts:1048` et `:1516`), et l'ajouter au pool drop (L528) si on veut qu'il soit généré.

### 🟡 Amélioration — getSmartMovement / SMART_MOVEMENTS jamais utilisés par QuickShow

`getSmartMovement` (`dmx-movement.ts:56-65`, distribution de patterns **différents par fixture**) n'est appelé que lorsque `cue.movement` est un nom de section et non un pattern explicite (`dmx-playback.ts:999-1007` et `:1490-1498`). Or `genCues` produit **toujours** un pattern explicite (`QuickShowView.tsx:748`, `:836`) → ce catalogue multi-fixture n'est jamais utilisé par la génération QuickShow : toutes les fixtures reçoivent le même pattern (seulement différencié par motorPhase + spatial). Leviers inexploités : varier le pattern **par fixture** via getSmartMovement dans les cues générées.

---

## 2. Variété par section

### ✅ Vérifié OK — mode audio-réactif : pools distincts par section, variété intra-section réelle

`QuickShowView.tsx:522-529` : 7 pools différents (intro/verse/chorus/bridge/drop/outro/build). La sélection (`QuickShowView.tsx:590-598`) combine hash seedé (`secType_genre_atmo_seed`, L592), RMS/centroid et `rng()` → **simulation Node** (20 cues/section, seeds 0-3) : chaque section visite **4 à 5 patterns distincts** sur 20 cues ; aucun pattern ne domine toutes les sections (wave fréquent mais jamais exclusif).

### 🟡 Amélioration — deux cas de réduction forte du pool

1. **drop + `cfg.movement='smooth'`** : le filtre smooth (`QuickShowView.tsx:533-534`) retire zigzag/heartbeat/bounce/diamond du pool drop (L528) → il ne reste que `circle` → **tout drop en mode smooth = circle systématique**.
2. **Biais genre/atmo cumulés** (house + dreamy + smooth, L539/L564) : `wave` est ajouté aux pools de 6 sections sur 7 → sur-représentation possible d'un même pattern sur tout le show.

### 🔴 Problème bloquant — mode legacy (non audio-réactif) : un pattern figé par section, zéro variété entre presets

Quand `audioReactive` est faux (pas d'analyse), `QuickShowView.tsx:805-836` (branche legacy) : `movement: profile.movement` avec `baseMovement` **fixe par section** (`QuickShowView.tsx:262-264` : intro=static, verse=sweep, chorus=circle, bridge=figure8, drop=bounce, outro=sweep, build=spiral). Pire : si `cfg.sectionAware` est faux, c'est **un seul pattern pour tout le show** (L268 : `smooth→wave`, `sharp→zigzag`, `dynamic→sweep`). Deux presets legacy aux réglages identiques → mouvements strictement identiques. De plus, `getSmartMovement` n'intervient pas (patterns explicites) → même pattern pour toutes les fixtures.
**Correction** : router le legacy vers une variante seedée de `selectMovementPattern` (même avec des features neutres), ou au minimum appliquer `getSmartMovement` par fixture (les noms de section déclencheraient alors la distribution multi-fixture).

---

## 3. Amplitude / vitesse

### ✅ Vérifié OK — les champs varient en audio-réactif…

`QuickShowView.tsx:753-766` (amplitude par section, pilotée par rms/bassRatio/progress) et `:768-773` (vitesse = `0.3 + centroid*0.6`, ×1.2 sur beat fort, ×1.5 en anticipation de drop).

### 🔴 Problème bloquant — le cap `Math.min(128, …)` fige drop/chorus/build à 128 en permanence

Le cap L753 (`Math.min(128, …)`) rend le calcul **inopérant** pour les sections fortes — vérifié par simulation :
- **drop** : `140 + bassRatio*110` (L761) → **toujours 128** (le minimum 140 dépasse le cap) → amplitude de drop 100 % constante quelle que soit l'énergie ;
- **chorus** : `110 + bassRatio*110` (L760) → 128 dès `bassRatio ≥ 0.164` → quasi toujours 128 ;
- **build** : `70 + progress*160` (L764) → 128 dès `progress ≥ 0.36` ; en anticipation (`160 + …`) toujours 128.

Seules intro (50-130), outro (40-100), bridge (60-140) et verse basse énergie varient réellement. Le commentaire du code (« drop: 140-250 DMX (near full sweep) ») décrit une plage **inatteignable** par construction.
**Correction** : différencier drop/chorus par une autre variable que la plage brute (ex. scaler `px`/`py` avant clamp stage, ou plage utile 90-128 + variation par tier), ou abaisser les bornes basses des formules sous le cap.

### 🟡 Amélioration — vitesse sans profil par section, et figée en legacy

- La vitesse (`QuickShowView.tsx:768-773`) ne dépend que du centroid/beat : pas de multiplicateur par section (contrairement aux couleurs `SECTION_CYCLE_MULT` L709) → un verse rapide peut dépasser un drop. Ajouter un `SECTION_SPEED_MULT` (intro/bridge/outro lents, drop/chorus/build rapides).
- En legacy, les cues n'ont **ni movementAmplitude ni movementSpeed** (`QuickShowView.tsx:836`) → fallback figé par tier 90/70/40 et `speedMult = 1` (`dmx-playback.ts:1036-1038`).

---

## 4. Phases

### ✅ Vérifié OK — motorPhase et movementPhase

- `motorPhase = m*(2π/motorCount)` (`dmx-playback.ts:1038` tick live ; `:1484` computeDmxForCue) : chaque moteur est déphasé, y compris les multi-bras (`motorCount = max(panCount, tiltCount)` L1022) — conforme à la règle multi-pan/tilt du projet.
- `movementPhase = Math.random()*1000` (`dmx-playback.ts:554`) : défini **à chaque démarrage de lecture**, donc chaque lecture d'un même preset diffère des précédentes.

### 🟡 Amélioration — crossfade partiellement aligné

Le crossfade blend amplitude+vitesse (`dmx-playback.ts:1040-1045`) ✅, mais `computeDmxForCue` calcule `phase = cue.time * 2π * speedMult + spatial` **sans** `movementPhase` (`dmx-playback.ts:1502`), alors que le tick l'ajoute (L1047) → le snapshot pré-calculé du next cue (L682) est déphasé par rapport au live ; le blend canaux (L1166-1176) mélange donc des positions calculées avec deux phases différentes → micro-jitter au changement de cue (~150 ms). Pattern et spatial ne sont pas blendés (bascule franche au crossfade) — acceptable.

---

## 5. Répétition entre presets

### ✅ Vérifié OK — en direct, Regenerate change bien les séquences

`QuickShowView.tsx:3275` (`setKey(k => k+1)`, état local L1669) → `regenSeed` entre dans `seedSrc` (L495) et `hashKey` (L592). **Simulation Node** (formules réelles, seeds 0→3) : les distributions de patterns changent sur les 7 sections à chaque seed (ex. drop : `heartbeat×6 zigzag×6` en seed 0 → `bounce×5 diamond×5 heartbeat×5` en seed 1) ; tests existants `src/__tests__/gencues.test.ts:177` (« different regenSeed produces different effects/movement ») couvrent ce comportement.

### 🔴 Problème bloquant — la seed n'est JAMAIS persistée : tous les presets rejouent avec regenSeed = 0

Recherche exhaustive : `regenSeed` n'est **écrit nulle part** dans le projet (seulement paramètre de `genCues` `QuickShowView.tsx:450`, et lecture `SongPresetPlayer.tsx:100`). Conséquences :
1. `key` est un `useState` local (`QuickShowView.tsx:1669`) non persisté → `saveProject` (`QuickShowView.tsx:849` : `quickShow: qs`) et `handleSaveAsPreset` (L2122) sauvegardent un `qs` **sans** regenSeed ;
2. `SongPresetPlayer` lit `(qs).regenSeed ?? 0` (`SongPresetPlayer.tsx:100`) → **0 pour tous les presets** ;
3. Deux presets « différents » (mêmes genre/style/sections) rejouent donc les **mêmes patterns, mêmes amplitudes, mêmes vitesses, mêmes spatials** — le seul facteur résiduel est `movementPhase` aléatoire (positions absolues) et rien d'autre. La variété inter-presets est structurellement neutralisée au pipeline save/load.

**Correction (2 lignes)** : à l'enregistrement, stocker la seed dans le preset — ex. dans `handleSaveAsPreset`/`saveProject` : `const qsWithSeed = { ...qs, regenSeed: key }` et l'utiliser dans `genCues`/`data.quickShow` ; à la restauration, `const [key, setKey] = useState(qs?.regenSeed ?? 0)`. Le lecteur `SongPresetPlayer.tsx:100` fonctionnera alors tel quel.

---

## 6. Spatial (1.0.20)

### ✅ Vérifié OK — complémentaire, pas redondant

`SPATIAL_BY_SECTION` (`dmx-movement.ts:72-78` : intro/verse/bridge=wave, chorus=circle, build=alternate, drop=expand, outro=contract) + `selectSpatialPattern` (`QuickShowView.tsx:601-605`, avec exceptions : verse rms>0.55→circle, drop house→circle, rms<0.2→off). `spatialPhaseFor` (`dmx-movement.ts:89-100`) transforme les **positions réelles** de fixtures en décalages de phase (wave ≈ -2π·x, expand ≈ -2π·dist(centre), alternate = π sur indices impairs).

Le spatial agit sur la **phase entre fixtures** alors que le pattern définit la **forme du mouvement d'une tête** : c'est orthogonal (un pattern circle + spatial circle = anneau rotatif, un pattern quelconque + spatial expand = impulsion depuis le centre). Donc **pas redondant** ✅ — le spatial est d'ailleurs le seul mécanisme qui anime la scène en bloc.

### 🟡 Améliorations
- `QuickShowView.tsx:787` : `spatialPattern: movement === 'static' ? 'off' : …` → en static, aucune chorégraphie (voir §7).
- En legacy (`QuickShowView.tsx:836`), le spatial est fixe par section **et** appliqué même sur `static` (pas de ternaire 'off') → incohérence avec le chemin audio-réactif.
- `selectSpatialPattern` reçoit `energy` (valeur composite L787) dans un paramètre nommé `featRms` (L601) → le seuil `< 0.2` teste l'énergie, pas le RMS brut : comportement légèrement différent de l'intention documentée.

---

## 7. Statique

### 🟡 Amélioration — « static » = quasi figé, chorégraphie coupée

- En audio-réactif : `static` + `spatialPattern='off'` (`QuickShowView.tsx:787`) → les têtes ne bougent quasi plus.
- La case `static` du moteur (`dmx-playback.ts:1048`) garde une dérive très lente : `px = sin(phase*.05)*.1` → période de 15 à 60 s selon la vitesse → visuellement figé, surtout si l'amplitude de cue (50-130) est appliquée (dérive à ~10 % de l'amplitude).
- Contexte d'apparition : intro/bridge et RMS bas (`QuickShowView.tsx:550-553`) → le statisme est un choix assumé pour les moments calmes, mais sur un bridge long (> 20 s) la fatigue visuelle est réelle.
- **Amélioration** : autoriser un spatial doux (ex. wave lent) même en static, ou faire du « static » une vraie pose animée (légère respiration d'amplitude).

---

## Tableau de synthèse

| Section | Patterns possibles (audio-réactif, pool par défaut) | Amplitude (DMX, cap 128) | Vitesse (× centroid) | Phase | Spatial (1.0.20) | Legacy (non audio) |
|---|---|---|---|---|---|---|
| intro | static, panOnly, tiltOnly, wave (+genre) | 50-130 → varie (cap 128) | 0.3-0.9 ×1.2 beat | motorPhase m·2π/n + movementPhase aléatoire/lecture | wave (off si rms<0.2) | static fixe |
| verse | sweep, wave, figure8, randomWalk, tiltOnly | 80-180 → 85-128 (écrasé dès rms≥0.48) | idem | idem | wave (→circle si rms>0.55) | sweep fixe |
| chorus | circle, diamond, spiral, sweep, figure8 | 110-220 → **128 constant** (dès bass≥0.16) | idem | idem | circle | circle fixe |
| bridge | static, figure8, wave, randomWalk | 60-140 → varie (cap 128) | idem | idem | wave | figure8 fixe |
| drop | bounce, heartbeat, zigzag, diamond, circle (**circle seul si smooth**) | 140-250 → **128 constant toujours** | idem (×1.5 anticipation) | idem | expand (→circle si house) | bounce fixe |
| outro | sweep, wave, randomWalk, panOnly | 40-100 → varie, jamais capé | idem | idem | contract | sweep fixe |
| build | sweep, figure8, spiral, circle | 70-230 → **128 constant** dès progress≥0.36 | idem (×1.5 anticipation) | idem | alternate | spiral fixe |

**Lecture** : en audio-réactif, variété de patterns par section ✅ (4-5 patterns distincts par section en simulation), variété inter-presets ✅ en session (Regenerate) mais ❌ après sauvegarde/rejeu (seed perdue) ; amplitude réellement variable uniquement sur intro/outro/bridge/verse ; moteur : 13 patterns implémentés sur 14 déclarés (`pulse` mort).

---

## Verdict

- **Variété intra-show (audio-réactif)** : ✅ OK — patterns, phases et spatial réellement variés ; simulation à l'appui.
- **Variété entre presets** : 🔴 **neutralisée au pipeline save/load** — la seed de régénération n'est jamais persistée (`SongPresetPlayer.tsx:100` → `qs.regenSeed ?? 0`), et le mode legacy n'a aucune variété (`QuickShowView.tsx:262-268, 836`).
- **Amplitude** : 🔴 cap à 128 rendant drop/chorus/build constants (`QuickShowView.tsx:753`).
- **Pattern mort** : 🔴 `pulse` déclaré mais jamais généré ni implémenté (`dmx-cues.ts:111-125`, `dmx-playback.ts:1048/1516`).
- **Reste** : 🟡 (drop smooth → circle seul ; vitesse sans profil section ; static sans spatial ; getSmartMovement sous-exploité).
