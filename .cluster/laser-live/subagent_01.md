# Subagent 01 — Traceur des chemins DMX live

> TaskId: laser-live | Rôle : cartographier TOUS les chemins de sortie/lecture DMX et
> déterminer lequel ne produit pas un frame laser visible.
> Fichiers preuve : `.cluster/laser-live/dump-laser-frames.ts` (exécuté avec `npx tsx`,
> importe les fonctions RÉELLES de `src/`), `probe2.ts`, `verify-real.ts`.
> Aucune modification de `src/`.

---

## 1. Carte des chemins de sortie / lecture

Toutes les sorties réelles convergent vers **un seul backend** : le DmxEngine électron
(`electron/dmx/engine.ts`). `setChannels` (L848) écrit dans un SharedArrayBuffer ;
`frameLoop` (L539-625) envoie USB (`sendUsbFrame`), Art-Net (`sendArtNetFrame`),
sACN (`sendSacnFrame`). **Ce backend ne calcule rien : il recopie.** Le calcul des
valeurs par canal se fait exclusivement dans le renderer, côté amont.

| # | Chemin | Fonction de calcul | Fonction d'envoi | Bloc laser de computeDmxForCue ? |
|---|--------|--------------------|------------------|----------------------------------|
| A | **Lecture QuickShow live + AutoScript (.lmshow)** — `QuickShowView` L2299 → `useDmxPlayback` | `tick()` rAF **inline** (`src/hooks/dmx-playback.ts` L741-1150) : intensité, segments RGB, roue, shutter, pan/tilt, gobo/prisme/zoom/frost/iris/focus. **AUCUN bloc laser** (mode/pattern/scan/rot/vitesses/blank/rgb-laser absents — `isLaser` n'apparaît qu'à L1431, dans `computeDmxForCue`) | `dmxBridge.push(uniIdx, chVals, arbSource)` L1150 → `api.setChannels` IPC → `engine.ts setChannels` → USB/ArtNet/sACN | ❌ **JAMAIS** (sauf crossfade, voir B) |
| B | **Crossfade QuickShow** (gap entre cues < 0,3 s) | `computeDmxForCue` `src/hooks/dmx-playback.ts` L1171-1508, bloc laser L1431-1484 | fusionné dans la frame du tick (L1115-1125) puis `dmxBridge.push` | ✅ (à chaque occurrence) |
| C | **Audio AutoScript (widget Performance)** — génération | `genCuesLocal` → `computeDmxForCue` par cue (`PerformanceView.tsx` L1355, L1876) → `dmxCues[]` avec `channelValues` figés | replay `fireAutoDmx` → `dmxBridge.write('vc', …)` L1648 → IPC → backend | ✅ **à la génération** (frames figées rejouées telles quelles) |
| D | **AutoLoop / moteur SoundSwitch** (`SoundSwitchAutoloop` → `useAutoloopEngine`) | `AutoloopPlaybackEngine.evaluate` (`src/engine/autoloop-engine.ts` L252-274) : keyframes bruts issus de `generateAutoscript` (timelines produites par `autoloop-runtime.ts` `buildSoundswitchBanks`/`defaultLaserBeamCues`) | `createAutoLoopOutput` → `sendChannelsToHardwareAndStore` → `dmxBridge.write('auto-loop')` → IPC → backend | ❌ **jamais** — mais les cues laser sont explicites (voir 3) |
| E | **Auto Loop widget VC** (`startAutoLoop`, `auto-loop-player.ts`) | frames pré-calculées `generateLoopFromRecipe` (`auto-loops.ts`) re-matérialisées sur le patch | `sendChannelsToHardwareAndStore` (L84) → bridge | ❌ (valeurs stockées brutes) |
| F | **Contrôles manuels** (FixtureTest `useFixtureTest.ts`, Virtual Console, Simple Desk `performStore`, Chasers, RGB Matrix, design tools, song presets) | valeurs utilisateur/article | `dmxBridge.write/writeMerge/writeTransient` | ❌ (par nature) |
| G | **Aperçu DesignView / 3D** | miroir du buffer arbitré (`_channelCache`, `onVirtualDmx`) — **pas une sortie** | — | n/a |
| H | **computeDmxCues (`dmx-cues.ts` L549)** — contient un bloc laser beat-sync complet (L930-975) | **chemin mort** : aucun appelant dans `src/` (grep : définition seule) | — | ✅ mais jamais exécuté |

**Sortie réelle unique en bout de chaîne :** `electron/main.ts` L405 → `dmxEngine.setChannels`
→ `electron/dmx/engine.ts` (SAB + frameLoop → USB / Art-Net / sACN). Aucun calcul,
aucun bloc laser, aucun blackout par défaut hors `blackoutState` (fail-safe).

---

## 2. Frames DMX prouvées (dump-laser-frames.ts — exécuté, fonctions réelles importées)

Fixtures : `cameo/ioda-400-rgy.json` (11ch, patch @1), `american-dj/galaxian-3d.json` (5ch, patch @41).
Analyse réelle : IODA mode@0 (6 caps, pickLaserModeCap → DMX mode 210-255), pattern@2 (128 caps),
wheel@1 (11 caps), scanX@6, scanY@7, rot[4,5], zoom@8 ; Galaxian rgbOffsets[0,1], rot[2,3],
**pas** de mode/pattern/scan/shutter/intensité. Cue simulé : section=verse, intensity=medium
(energy 0,5), color `#ff0000`.

### Chemin A — tick live QuickShow/AutoScript (inline, SANS bloc laser)

| t | IODA-400-RGY | Galaxian-3D |
|---|--------------|-------------|
| 0 | ch2=20 ch9=96 | ∅ (aucun canal écrit) |
| 0,5 | ch2=20 ch9=142 | ∅ |
| 1 | ch2=20 ch9=124 | ∅ |
| 2 | ch2=20 ch9=50 | ∅ |
| 4 | ch2=20 ch9=68 | ∅ |
| 8 | ch2=20 ch9=142 | ∅ |
| 10 | ch2=20 ch9=96 | ∅ |

→ IODA : **canal Programme (ch1) jamais écrit → reste 0 = cap "Laser off" (0-9)** → éteint.
seule la roue couleur (ch2) et le canal indexé zoom (ch9) bougent. → Galaxian : **aucun canal écrit**
(rgbSegments ∅, wheel ∅, shutter ∅) → éteint.

### Chemin B — computeDmxForCue (réel : crossfade QuickShow + génération Audio AutoScript)

| t | IODA-400-RGY | Galaxian-3D |
|---|--------------|-------------|
| 0 | ch1=233 ch2=20 ch3=1 ch5=153 ch6=153 ch7=159 ch8=202 ch9=96 ch11=151 | ch41=255 ch42=0 ch43=103 ch44=103 |
| 0,5 | ch1=233 ch2=20 ch3=1 ch5=188 ch6=174 ch7=97 ch8=54 ch9=142 ch11=105 | ch41=255 ch42=0 ch43=68 ch44=82 |
| 1 | ch1=233 ch2=20 ch3=1 ch5=188 ch6=188 ch7=159 ch8=202 ch9=124 ch11=151 | ch41=255 ch42=0 ch43=68 ch44=68 |
| 2 | ch1=233 ch2=20 ch3=3 ch5=103 ch6=188 ch7=159 ch8=202 ch9=50 ch11=151 | ch41=255 ch42=0 ch43=153 ch44=68 |
| 4 | ch1=233 ch2=20 ch3=5 ch5=153 ch6=103 ch7=159 ch8=202 ch9=68 ch11=151 | ch41=255 ch42=0 ch43=103 ch44=153 |
| 8 | ch1=233 ch2=20 ch3=9 ch5=153 ch6=153 ch7=159 ch8=202 ch9=142 ch11=151 | ch41=255 ch42=0 ch43=103 ch44=103 |
| 10 | ch1=233 ch2=20 ch3=11 ch5=103 ch6=188 ch7=159 ch8=202 ch9=96 ch11=151 | ch41=255 ch42=0 ch43=153 ch44=68 |

→ IODA : **mode DMX (ch1=233), pattern cyclé toutes les 2 s (1→3→5→9→11), scans/rotations/vitesse
animés → visible en continu.** → Galaxian : **R=255 / G=0 (rouge plein), rotations animées → visible.**
⚠ piège confirmé : sans `paletteColor`, le bloc laser écrit `[255×energy, 255×energy, 0]` ;
avec l'énergie par défaut 0,1 → **26/26 sur R/G = quasi-éteint** (le seuil `laserGateValue` >22
n'existe que dans `dmx-cues.ts`, chemin mort).

### Chemin C — AutoLoop / SoundSwitch (moteur réel, 2 loops par banque : Spot=IODA, Wash_Primary=Galaxian)

Banque 0 — cible IODA : ch1=255 (mode DMX), ch3=16→48→80 (pattern cyclé), ch5/6=70/186 (rot),
ch11=96 (vitesse). ScanX/ScanY non écrits en banque 0 (pas de positionCue) → motif au centre.
Banque 0 — cible Galaxian : ch41=255→0, ch42=0→255 (rouge ↔ vert, bascule ~8 s), ch43/44=70/186 (rot).
Banques 1-3 : + pan/tilt (scan mappé) pour IODA (ch7/ch8 128↔228), ch9=0 (blank n'existe pas :
c'est le canal Drawing de l'OFL interprété zoom) → **visible en continu, animé.**

→ AutoLoop n'appelle PAS `computeDmxForCue`, mais ses cues par défaut sont explicitement
laser-safe : `laserMode: 255` (DMX mode), patterns, `laserBlank: 0`, couleurs R/G plein.

---

## 3. Verdicts

| Chemin | IODA-400-RGY | Galaxian-3D |
|--------|--------------|-------------|
| A. tick QuickShow/AutoScript live | **ÉTEINT** (Programme@0 jamais écrit = Laser off) | **ÉTEINT** (aucun canal écrit) |
| B. computeDmxForCue (crossfade / AudioAutoScript) | **VISIBLE EN CONTINU** (mode DMX 233, pattern+scan) | **VISIBLE** (R=255/G=0, rotations) — faible si cue sans couleur |
| C. AutoLoop SoundSwitch | **VISIBLE EN CONTINU** (mode 255, pattern, rotations) | **VISIBLE** (R/V alternés, rotations) |
| E. Auto loop widget / F. manuels | valeurs brutes (non concernés par le bloc laser) | idem |
| H. computeDmxCues (dmx-cues.ts) | **chemin mort** (aucun appelant) | idem |

---

## 4. Réponse à la question pivot

> **EXISTE-T-IL un chemin de sortie réel qui n'appelle PAS le bloc laser de computeDmxForCue ?**

**OUI — et c'est précisément le chemin que l'utilisateur appelle « lecture ».**

Le **tick de lecture principal** (`useDmxPlayback`, utilisé par la lecture QuickShow live ET par
la lecture AutoScript .lmshow dans `QuickShowView`) calcule ses frames **inline** (L741-1150)
avec une logique qui **ne contient aucun bloc laser**. Le bloc laser (mode DMX, pattern, scans,
rotations, vitesses, blank, canaux R/G des lasers) n'existe que dans `computeDmxForCue`
(L1431-1484), qui n'est appelé par ce tick **que dans le crossfade** (gap de < 0,3 s entre deux
cues, L670-682) — d'où le symptôme exact de l'utilisateur :

- **« ça ne fait rien »** : en lecture normale, pour l'IODA le canal Programme reste à 0
  (cap "Laser off") et pour la Galaxian aucun canal n'est écrit ;
- **« de temps en temps une apparition, toujours la même »** : quand deux cues sont espacés de
  moins de 0,3 s, le crossfade appelle `computeDmxForCue` → bloc laser complet pendant ~0,15 s
  → un frame quasi identique à chaque occurrence (même fixture, mêmes phases aux temps proches).

Les autres chemins « sans bloc laser » (AutoLoop, contrôles manuels) ne sont pas fautifs :
l'AutoLoop écrit des cues laser explicites (mode 255, patterns, blank 0) et les contrôles
manuels sont, par définition, sous la main de l'opérateur.

**Recommandation de correction (round 2, hors périmètre lecture seule)** : soit répliquer le
bloc laser (L1431-1484) dans le tick inline de `useDmxPlayback`, soit faire passer le rendu
principal par `computeDmxForCue` à chaque frame (coût : factoriser pour éviter la double
logique divergente — le tick et `computeDmxForCue` calculent déjà deux versions de la même
chose, ce qui est la cause racine du syndrome).