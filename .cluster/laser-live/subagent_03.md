# subagent_03 — Auditeur des valeurs laser : formules, valeurs DMX exactes, fuites vers l'éteint

TaskId: laser-live · Round 1 · Lecture seule : **aucun fichier de `src/` n'a été modifié**.
Script de calcul exécutable : `.cluster/laser-live/subagent-03-calc.ts` (réimplémentation mot à mot des 4 chemins, sur les OFL réels ; lancer :
`npx vitest run --config .cluster/laser-live/vitest.config.ts`).
État audité : **working tree actuel** (fichiers modifiés le 25/08 17:57 — contiennent `laserGateValue`, voir §0).

---

## 0. Correction de contexte (working tree ≠ commit)

Au moment de l'audit, `src/hooks/dmx-playback.ts`, `src/hooks/dmx-cues.ts`,
`src/engine/fixture-analyzer.ts` **contiennent déjà des modifications non commitées** (git status *dirty*) qui ont introduit :

- `laserGateValue(v) = v > 22 ? 255 : 0` (fixture-analyzer.ts ~L25) appliqué aux canaux couleur laser **typés Shutter** (2 canaux R/G) :
  - dmx-playback.ts L1463-1473 (bloc « Couleur 2 canaux » de `computeDmxForCue`) ;
  - dmx-cues.ts L718-727 (section 2 de `computeDmxCues`, gate activée si `fa.isLaser && fa.laserColorMode === 'rgb' && fa.rgbSegments.length === 0`).

Cette gate **élimine déjà la zone « fermé 0-31 » et la zone strobe** pour les lasers 2 canaux sur les chemins B/C — mais elle crée un **binaire tout-ou-rien** (0 ou 255) et **ne couvre pas le tick live (chemin A)**.

---

## 1. Les 4 chemins d'écriture et leurs formules exactes

### Chemin A — tick live `useDmxPlayback` (dmx-playback.ts L741-1170) — **le chemin de lecture principal** (QuickShowView L2299, SongPresetPlayer L226)
**AUCUNE occurrence de `fa.isLaser` dans le tick** (vérifié : seul L1431, dans `computeDmxForCue`). Les blocs écrits sont : intensité `mapIntensity`, couleur `rgbSegments`/wich, shutter, pan/tilt, gobo/prism/zoom/frost/iris/focus/beam, speed. **Ni mode, ni pattern, ni scanX/Y, ni rotations, ni blanking, ni `rgbOffsets` 2 canaux.**
Conséquence mécanique (output-arbiter.ts `write` = **remplacement total** de la contribution source) : les adresses laser absentes de `chVals` ne sont pas envoyées → le hardware **conserve la valeur précédente (0 à l'initialisation)** → laser éteint.

### Chemin B — `computeDmxForCue` (dmx-playback.ts L1171-1500, bloc laser L1431-1484)
Utilisé par : QuickShowView (aperçu L2262), PerformanceView (tracks/fit L1355/L1876), crossfade du tick (L678), VC.
Formules (recopiées mot à mot dans le script) :
- **Mode** : `capMid(pickLaserModeCap(laserModeCaps))` — `pickLaserModeCap` : `dmx|dynamic|manual` → `auto` → `max≥200 && min>0` → `min>0` → fallback 128-255 « DMX ».
- **Pattern** : `capMid(patternCaps[⌊laserT/2⌋ % n])` (toutes ~2 s).
- **Scan X/Y** : `round(128 + (60+round(energy*40)) * sin/cos(2π·laserT + phase))` ; Y lissajous si `addr%3===2`.
- **RGB 2 canaux (gate)** : `[rr0,gg0,bb0] = paletteColor ? hexToRgb(paletteColor) : [round(255·energy), round(255·energy), 0]` puis `rr = laserGateValue(rr0)` (**0 si ≤22, sinon 255**).
- **Vitesses** : `128 ± 60·sin(2πt+φ)` (scan), `128 ± 64·sin(2πt/4)` (pattern).
- **Rotations** : `128 ± 65·sin(2πt/(4(i+1))+φ)`.
- **Blanking** : `(drop||chorus) && strobe ? 255 : 0`.

### Chemin C — `computeDmxCues` (dmx-cues.ts) : couleur L710-727 + bloc 7b L931-977 + **filet de sécurité 128 L988-1003**
- Couleur RGB 2 canaux : idem gate (B) mais **uniquement si `paletteColor`** ; sinon les canaux restent non écrits → **filet**.
- Bloc 7b : identique à B (beat-sync : pattern `⌊beat/8⌋`, scan `128±round(90·…)`).
- **Filet** : `for c in 0..channelCount : if (channelValues[addr] === undefined) channelValues[addr] = 128;` → **tout canal laser non reconnu/non écrit reçoit 128** : pour un canal ShutterStrobe 16-239 = **strobe**, pour un canal « Nothing » type Macros = **macro autonome**.

### Chemin D — Autoloop/SoundSwitch (autoloop-runtime.ts L155-190 + moteur `AutoloopPlaybackEngine`)
- `defaultLaserBeamCues` : pattern synthétisé (8 motifs, `capMid`), **`laserMode : 255` en dur**, `laserBlank : 0`, vitesses 96/224, rotations 70/186.
- `defaultColorCues` : red/green/blue/white → `{red:255,green:0}`, `{0,255,0}`, `{0,0,255}`, `{255,255,255}` appliqués aux clés du channelMap (pour un laser R/G typé Shutter : `red@0 green@1`).
- Le moteur n'écrit **que les canaux présents dans la timeline** (`evaluate` L201-225) ; les autres conservent leur valeur DMX précédente. **`engine.channelMap` n'est jamais assigné par `use-autoloop-engine.ts`** — sans impact car le générateur encode les adresses absolues en chaîne.

---

## 2. Tableau des valeurs calculées (état actuel, script exécuté)

### GALAXIAN 3D (5ch : Red Laser@0, Green Laser@1 typés ShutterStrobe OFL : 0-7 Closed / 8-15 Open / 16-239 Strobe / 240-247 SoundActive / 248-255 Open ; Rotation@2-3 ; Macros@4)

|Énergie|Chemin|R@0|G@1|Zone OFL|Verdict|
|---|---|---|---|---|---|
|0.08|A (tick live)|—|—|(jamais écrit → 0)|**ÉTEINT** (0-7 Closed)|
|0.10|A|—|—|idem|**ÉTEINT**|
|0.25/0.5/0.8|A|—|—|idem|**ÉTEINT**|
|0.08|B (computeDmxForCue, sans palette)|0|0|round(255·0.08)=20 → gate 0|**ÉTEINT** (seuil : energy>0.0863)|
|0.10|B sans palette|255|255|Open (248-255)|allumé **binaire, identique**|
|0.25|B sans palette|255|255 (64→gate)|Open|allumé « toujours le même »|
|0.5|B sans palette|255|255 (128→gate)|Open|idem|
|0.8|B sans palette|255|255 (204→gate)|Open|idem|
|0.5|B palette **bleue** #0000ff|0|0|Closed|**ÉTEINT** (la plupart des palettes bleues/violettes/cyan)|
|0.5|B palette rouge|255|0|Rouge seul Open / vert Closed|apparition binaire|
|0.5|B palette jaune/blanche|255|255|Open|idem|
|0.1/0.5/0.8|C (dmx-cues, sans palette)|**128**|**128**|**16-239 = STROBE**|visuel strobe constant ; **+ Macros@4=128 = « Macro 8 » (120-135) autonome** → la fixture joue sa macro interne fixe|
|—|D (Autoloop, banques 0-3)|0↔255|0↔255|cues c-rouge/vert/blanc/bleu|alternance binaire ; cue **c-blue éteint** (0/0)|

> Le calcul demandé « passe-t-il sous 32 ? » : avec la gate actuelle, **la sortie n'est jamais entre 23 et 254** — elle saute de 0 (énergie ≤ 0.0863 soit `round(255·e) ≤ 22`) à 255. La réponse vraie à l'état du code : **0 sous energy 0.0863 (éteint), 255 au-dessus (allumé, toujours pareil)**. Sans la gate (ancien code), `round(255·e)` tombait dans **16-239 = strobe** pour 0.1→26, 0.25→64, 0.5→128, 0.8→204.

### IODA 400 RGY (11ch : Program@0, Color Presets@1, Pattern@2, Rotation@3, X/Y Rolling@4-5, X/Y Moving@6-7, Zoom@8, Drawing@9, Scanning Speed@10)

|Canal|Chemin B (computeDmxForCue, every frame)|Zone OFL|Verdict|
|---|---|---|---|
|Program@0 (mode)|`capMid(pick([0-9]off, 10-59/60-109 auto, 110-209 sound, 210-255 DMX mode))` = **233**|210-255 « DMX mode »|✅ **mode DMX écrit à CHAQUE frame** (B et C)|
|Pattern@2|cycle `⌊t/2⌋ % 128` (B) / `⌊beat/8⌋` (C) → capMid|motifs 1..128|✅ cycle OUI|
|Zoom@8|B : **jamais écrit** (∅) → reste 0 (manuel wide) ; C : **filet 128**|128-191 « Decreasing auto zooming »|⚠ zone **auto** (pas éteint, mais mouvement autonome non désiré)|
|Drawing@9|B : jamais écrit (∅) → 0 ; C : **filet 128**|128-255 « Auto drawing + de-drawing »|⚠ auto (sans danger)|
|Scanning Speed@10|`round(128+60·sin)` → **68..188**|188→128-255 « With gaps »|⚠ **faisceau troué** une partie du temps (zone « with gaps » dès ≥128)|
|Rotations@3/4/5|`128±65` → 63..193|0-127 indexing / 128+ auto|⚠ parfois auto|
|Chemin A (tick live)|**Program@0 JAMAIS écrit → 0 → « Laser off » (0-9)**|—|🔥 **ÉTEINT durablement** malgré wheel/zoom écrits|

### BOOM BOX FX2 (19ch : R Laser@1, G Laser@2 typés 0-127 Closed / 128-255 Open ; BeamStrobe@8 ; BeamDimmer@9 ; Show mode@16)

|Canal|Chemin B/C|Zone OFL|Verdict|
|---|---|---|---|
|Show mode@16|`pickLaserModeCap(11 caps)` = cap « Show 8 » [140-209] (`max≥200&&min>0`) → **175** |140-209 « Show 8 »|🔥 **SHOW AUTONOME** : les canaux R/G DMX sont **ignorés** par la fixture |
|Show mode@16 (D/Autoloop)|`laserMode: 255` en dur → 255|250-255 « Show 0 »|🔥 idem show autonome |
|R@1 / G@2|B : ∅ (rgbSegments.length=1 → la branche gate ne s'applique pas ; non écrit sans palette) ; C : **filet 128** (Open) ; A : jamais écrit → 0 (Closed)|—|A : **ÉTEINT** ; C : ouvert mais ignoré (mode Show 8) |
|BeamStrobe@8|A : 255 (Open) ; C : 100 en drop|—|ok (mais laser R/G éteint) |
|BeamDimmer@9|A : mapIntensity (128-230)|—|les **LED beams** s'allument → c'est **ce qu'on voit**, pas le laser |

---

## 3. Fuites vers l'éteint / états figés — causes racines

|#|Cause racine (fichier:ligne)|Effet|Fixtures|
|---|---|---|---|
|F1 **BLOQUANT**|Tick live sans bloc laser (dmx-playback.ts L741-1170 ; `isLaser` absent)|Les canaux laser ne sont jamais écrits pendant la lecture → bridge `write` replace-all → DMX reste à 0 → zones « off ». Le Galaxian ne reçoit **rien du tout** (0 canal écrit).|Galaxian, IODA (Program=0 « Laser off »), BoomBox (R/G=0 Closed)|
|F2 **CRITIQUE**|`pickLaserModeCap` choisit un cap « riche » (`max≥200&&min>0`) sur un canal « Show mode » (fixture-analyzer.ts L134-144)|Mode=175 « Show 8 » (B/C) ou 255 « Show 0 » (D) → la fixture BoomBox joue **son show interne** ; les canaux R/G DMX deviennent inopérants → « apparition toujours la même »|BoomBox FX2|
|F3 **CRITIQUE**|Filet de sécurité 128 (dmx-cues.ts L988-1003) appliqué aux canaux laser non écrits par le bloc 7b : R/G 2 canaux sans palette (bloc 7b ne les écrit pas) et « Macros » non reconnus|Galaxian : R=G=**128 = strobe OFL (16-239)** et **Macros=128 = Macro 8 autonome** → visuel reproductible à l'identique ; IODA : zoom/drawing partent en mode auto|Galaxian, IODA|
|F4 **CRITIQUE**|Gate binaire `laserGateValue` (fixture-analyzer.ts L25) + palettes spectrales non gatées par canal : palette bleue/violette/cyan → composantes R/G ≤ 22 → 0/0|Laser RG éteint pour toute palette sans rouge+vert ; quand allumé, **état toujours identique** (255/255 ou un seul canal) — « apparition rare, toujours la même »|Galaxian, BoomBox|
|F5 **MOYEN**|`Scanning Speed` = `128±60·sin` (dmx-playback.ts L1475, dmx-cues.ts L965) dépasse 127|Zone « With gaps » (128-255) → faisceau **troué/intermittent** une partie du temps|IODA|
|F6 **MOYEN**|`engine.channelMap` jamais rempli dans use-autoloop-engine.ts L47-190|Sans gravité (clés encodées en adresses absolues) mais toute logique « par nom » du moteur est inopérante|tous (chemin D)|
|F7 **AUTO schéma**|`intensityOffset=null` sur les lasers à roue (IODA) : la lecture live n'a aucun canal d'intensité sur lequel écrire|Dans 3D (Stage3D L1549-1556) le beam ne s'allume jamais pour une roue (vu par subagent_04) ; au hardware rien n'écrase le mode « off » tant que F1 n'est pas corrigé|IODA|

Valeur 0..31 sur shutter laser / 0 sur intensité / auto sur mode pendant la lecture — relevés :
- **0 sur canal laser** : tick live, canaux jamais écrits (F1) — Galaxian CH1-4, IODA CH1/3/5-8/10/11, BoomBox CH2/3/17.
- **0-31 sur shutter laser** : plus possible sur les chemins B/C depuis `laserGateValue` ; **reste possible via** le filet C sur les canaux Nothing (Macros) et via les cues Autoloop `c-blue` (0/0).
- **128 sur canal laser** : filet C (F3) — strobe Galaxian R/G, Macro 8, zoom/drawing auto IODA, R/G Open BoomBox.
- **Zone auto/sound sur canal mode** : BoomBox Show 8/Show 0 (F2) ; IODA est correct (233 = DMX). Le champ « Sound Active » 240-247 du Galaxian n'est jamais atteint (gate 255).

---

## 4. Correctifs minimaux recommandés (propositions — aucune écriture)

1. **Copier le bloc laser de `computeDmxForCue` (L1431-1484) dans le tick live** (mêmes phases/radii, `laserT = ct`). C'est le correctif central : sans lui, rien de ce qui suit n'est visible en lecture.
2. **`pickLaserModeCap` : exclure les caps « Show/Macro/Auto/Sound » quand un cap « NoFunction/off » existe**, sinon garder une valeur basse prioritaire (ex. `min>0 && max<=69` pour le BoomBox → « NoFunction » = canaux DMX actifs). Idem côté Autoloop : remplacer `laserMode: 255` en dur par le résolu via `pickLaserModeCap` (fixture-aware).
3. **Filet de sécurité : ne jamais écrire 128 sur un canal laser** ; si un canal laser est non reconnu/non écrit, plutôt : R/G gate → 255 (ouvert), Macros laser → **0** (NoFunction, pas de macro autonome), zoom/drawing laser → laisser la dernière valeur sûre.
4. **Gate binaire → échelle respectueuse du fixture** : pour les R/G typés Shutter `0-7 Closed / 8-15 Open / 16-239 Strobe / 248-255 Open`, écrire 255 (open) quand allumé — c'est déjà le cas — mais **garantir un canal ouvert par défaut** quand le laser est actif (ex. si palette sans rouge ni vert → allumer R+G au lieu de 0/0), pour supprimer la « rareté ».
5. **IODA : borner `Scanning Speed` à 0-127** (`min(127, …)`) ou réduire l'amplitude (`96±28`) pour ne jamais entrer dans « With gaps ».
6. (Cohérence 3D, détaillée par subagent_04) : consommer `scanX/scanY`, `patternOffset`, `laserRotationOffsets`, `zoomOffset` dans Stage3D et traiter `laserColorMode==='wheel'` comme allumé dès que le mode/roue sont hors zone off.

---

## 5. Fichiers produits (lecture seule, rien dans src/)

- `.cluster/laser-live/subagent-03-calc.ts` — script de calcul (réimplémentation mot à mot des 4 chemins ; assertions de non-régression sur `laserGateValue`).
- `.cluster/laser-live/vitest.config.ts` — config d'exécution (contourne l'exclusion `**/.cluster/**`).
- Ce rapport.

Exécution : `npx vitest run --config .cluster/laser-live/vitest.config.ts` (sortie console = rapport complet des valeurs).